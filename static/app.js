import { createRecorder } from './recorder.js';

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Build DOM safely (text is always set via textContent, never innerHTML). */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : String(c));
  return node;
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).detail || msg; } catch {}
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return res;
}
const getJSON = async (p) => (await api(p)).json();
const postJSON = async (p, body) =>
  (await api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

function setStatus(node, text, kind = '') { node.textContent = text; node.className = `status ${kind}`; }
const b64ToBlob = (b64, type) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });

const KO_GENDER = { female: '여성', male: '남성', neutral: '중성', Female: '여성', Male: '남성', Unspecified: '미지정' };
const KO_PITCH = { PITCH_LOW: '낮음', PITCH_MEDIUM: '중간', PITCH_HIGH: '높음' };
const KO_ACCENT_LIB = { 'Seoul Korean': '서울', 'Busan Korean': '부산' };

// Accents for voice design (keys match the 1,347 prompt templates). [label, Korean prompt phrase]
const ACCENTS = {
  'Seoul Korean': ['서울 표준어', '자연스러운 서울 표준어'],
  'Seoul Standard': ['서울 표준(아나운서풍)', '방송 아나운서처럼 또렷한 서울 표준어'],
  'Seoul Casual': ['서울 캐주얼', '편안하고 요즘스러운 서울 말투'],
  'Seoul Prestige': ['서울 격식/고급', '품위 있고 격식 있는 서울 말투'],
  'Formal Educator': ['격식체 교육자', '격식 있고 교양 있는 표준어'],
  'Gyeongsang Busan': ['경상도(부산)', '경상도(부산) 사투리'],
  'Busan Korean': ['부산 사투리', '억센 부산 사투리'],
  'Jeolla': ['전라도', '전라도 사투리'],
  'Chungcheong': ['충청도', '느긋하고 구수한 충청도 사투리'],
  'Gangwon': ['강원도', '강원도 사투리'],
  'Global Kyopo': ['해외 교포', '재미교포 억양이 섞인 한국어'],
};
// chip label (adnominal form) -> stem used when chaining with "-고"
const TONES = {
  '따뜻한': '따뜻하', '차분한': '차분하', '밝고 경쾌한': '밝고 경쾌하', '활기찬': '활기차',
  '부드러운': '부드럽', '신뢰감 있는': '신뢰감 있', '친근한': '친근하', '유머러스한': '유머러스하',
  '낮고 울림 있는': '낮고 울림 있', '또렷한': '또렷하', '느긋한': '느긋하', '공감하는': '공감하',
};
const CONTEXTS = {
  '팟캐스트': '팟캐스트를 진행하는', '뉴스': '뉴스를 전하는', '전화 상담': '전화로 고객을 응대하는',
  '다큐 내레이션': '자연 다큐멘터리를 내레이션하는', '버스 옆자리 수다': '버스 옆자리에서 편하게 수다 떠는',
  '광고': '광고 내레이션을 하는', '강의': '수업을 진행하는', '오디오북': '오디오북을 읽어 주는',
};
// Full audio-tag list from the Gemini 3.8 Flash TTS notebook: tag -> Korean meaning (tooltip).
const AUDIO_TAGS = {
  argh: '으악(짜증)', breath: '숨소리', exhales: '숨 내쉬기', cackle: '깔깔(악당 웃음)', cheer: '환호',
  chuckle: '킥킥', cough: '기침', cry: '울음', gasp: '헉(놀람)', giggle: '키득키득',
  groan: '끙(신음)', growl: '으르렁', grunt: '끙(힘쓰기)', grr: '그르르', hiss: '쉿/쉭',
  laugh: '웃음', moan: '앓는 소리', pant: '헐떡임', pff: '푸흣(어이없음)', phew: '휴(안도)',
  scream: '비명', shout: '외침', shriek: '날카로운 비명', sigh: '한숨', sneeze: '재채기',
  snicker: '낄낄', snort: '콧방귀', sob: '흐느낌', 'throat-clearing': '헛기침', tsk: '쯧',
  whimper: '훌쩍임', whispers: '속삭임', yawn: '하품', 'short pause': '짧은 쉼', 'long pause': '긴 쉼',
};

// ---------- tabs ----------
const tabs = $$('[role="tab"]');
function selectTab(tab, focus = true) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
  }
  if (focus) tab.focus();
  if (tab.id === 'tab-voices') loadVoices();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (k) selectTab(tabs[(i + k + tabs.length) % tabs.length]);
    if (e.key === 'Home') selectTab(tabs[0]);
    if (e.key === 'End') selectTab(tabs.at(-1));
  });
});
const goTab = (id) => selectTab($(`#${id}`), false);

// ---------- preview playback (card play button only) ----------
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect fill="currentColor" x="7" y="7" width="10" height="10" rx="2"/></svg>';
const icon = (svg) => { const s = document.createElement('span'); s.className = 'ico'; s.innerHTML = svg; return s; }; // static, trusted markup only
const playerAudio = $('#player-audio');
let playingBtn = null;
function setPlayBtn(btn, playing) {
  btn.replaceChildren(icon(playing ? ICON_STOP : ICON_PLAY));
  btn.setAttribute('aria-pressed', String(playing));
  btn.closest('.vcard')?.classList.toggle('playing', playing);
}
function resetPlayingBtn() {
  if (!playingBtn) return;
  setPlayBtn(playingBtn, false);
  playingBtn = null;
}
function playPreview(v, btn) {
  const wasThis = playingBtn === btn;
  playerAudio.pause();
  resetPlayingBtn();
  if (wasThis) return; // second click on the same card = stop
  playingBtn = btn;
  setPlayBtn(btn, true);
  playerAudio.src = `/api/catalog/${encodeURIComponent(v.id)}/preview`;
  playerAudio.play().catch((e) => { if (e.name !== 'AbortError' && playingBtn === btn) resetPlayingBtn(); });
}
// No 'pause' listener: it fires asynchronously and would reset the next card's button.
playerAudio.addEventListener('ended', resetPlayingBtn);

// ---------- 1. catalog (play only) ----------
let catalog = [];
const personaParts = (p = '') => {
  const m = p.match(/^(.*?)\s*(?:\(([^)]+)\))?$/);
  return { category: (m?.[1] || p).trim(), role: m?.[2] || '' };
};
const ageOf = (d = '') => d.match(/^(\d+)-year-old/)?.[1];
const KO_CAT = {
  'Storyteller & Narrator': '스토리텔러 · 내레이터',
  'Video Voiceover & Host / Training Voiceover': '영상 보이스오버 · 진행',
  'High-Trust Advisor / Authoritative Advisor': '신뢰형 어드바이저',
  'Concierge & EA': '컨시어지 · 비서',
  'News & Podcast Host / Podcaster': '뉴스 · 팟캐스트',
  'Advertising Pitch & Commerce / Commercial Voiceover': '광고 · 커머스',
  'Tech Support Agent / Tech Advisor': '기술지원',
  'Customer Support Agent / Call Center Agent': '고객지원 · 콜센터',
  'Companion & Peer / Digital Assistant': '동반자 · 디지털 비서',
  'Coach & Motivational Guide': '코치',
  'Educational Tutor': '교육 튜터',
};
const KO_ROLE = {
  'Nature Documentary Narrator': '자연 다큐 내레이터', 'Instructional Video Host': '교육 영상 진행자',
  'Lawyer': '변호사', 'Tour Guide': '투어 가이드', 'Journalist': '기자', 'Fashion Consultant': '패션 컨설턴트',
  'Architect': '건축가', 'Social Worker': '사회복지사', 'Sibling': '형제/자매', 'Influencer': '인플루언서',
  'Sales Associate': '판매 직원', 'Executive Assistant': '비서', 'Dating Coach': '연애 코치',
  'Nutritionist': '영양사', 'Best Friend': '절친', 'Parent': '부모', 'Aunt/Uncle': '이모/삼촌',
  'Cooking Show Host': '요리쇼 진행자', 'Counselor': '상담가', 'Music Teacher': '음악 선생님',
  'Friend': '친구', 'Customer Service Agent': '고객센터 상담원', 'Podcast Interviewer': '팟캐스트 인터뷰어',
  'Radio Host': '라디오 진행자', 'Writing Tutor': '글쓰기 튜터',
};
const koCat = (c) => KO_CAT[c] || c;
// Persona = the role in parentheses; voices without one use their category.
const personaOf = (v) => { const { category, role } = personaParts(v.persona); return role || category; };
const koPersona = (p) => KO_ROLE[p] || KO_CAT[p] || p;

function fillSelect(sel, values, label = (v) => v) {
  for (const v of values) sel.append(el('option', { value: v }, label(v)));
}
const byKo = (label) => (a, b) => label(a).localeCompare(label(b), 'ko');

async function loadCatalog() {
  catalog = await getJSON('/api/catalog');
  const uniq = (f) => [...new Set(catalog.map(f).filter(Boolean))].sort();
  fillSelect($('#f-accent'), uniq((v) => v.accent), (v) => KO_ACCENT_LIB[v] || v);
  fillSelect($('#f-gender'), uniq((v) => v.gender), (v) => KO_GENDER[v] || v);
  fillSelect($('#f-pitch'), ['PITCH_LOW', 'PITCH_MEDIUM', 'PITCH_HIGH'], (v) => KO_PITCH[v]);
  fillSelect($('#f-cat'), uniq((v) => personaParts(v.persona).category).sort(byKo(koCat)), koCat);
  fillSelect($('#f-persona'), uniq(personaOf).sort(byKo(koPersona)), koPersona);
  $('#st-total').textContent = catalog.length;
  $('#st-accent').textContent = uniq((v) => v.accent).length;
  $('#st-persona').textContent = uniq(personaOf).length;
  renderCatalog();
}

const AVATAR_HUES = [262, 230, 199, 172, 330, 24, 290, 150];
const hueOf = (id) => AVATAR_HUES[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR_HUES.length];

function renderCatalog() {
  const q = $('#q').value.trim().toLowerCase();
  const fa = $('#f-accent').value, fg = $('#f-gender').value, fp = $('#f-pitch').value;
  const fc = $('#f-cat').value, fr = $('#f-persona').value;
  const rows = catalog.filter((v) =>
    (!fa || v.accent === fa) && (!fg || v.gender === fg) && (!fp || v.pitch === fp) &&
    (!fc || personaParts(v.persona).category === fc) && (!fr || personaOf(v) === fr) &&
    (!q || [v.id, v.persona, koPersona(personaOf(v)), v.description, v.script?.text].join(' ').toLowerCase().includes(q)));

  $('#count').textContent = rows.length === catalog.length
    ? `전체 ${catalog.length}개 보이스`
    : `${catalog.length}개 중 ${rows.length}개 보이스`;
  playingBtn = null;
  playerAudio.pause();

  if (!rows.length) {
    $('#rows').replaceChildren(el('li', { class: 'empty grid-empty' }, '조건에 맞는 보이스가 없습니다. 필터를 조정해 보세요.'));
    return;
  }
  $('#rows').replaceChildren(...rows.map((v) => {
    const { category } = personaParts(v.persona);
    const age = ageOf(v.description);
    const title = koPersona(personaOf(v));
    const btn = el('button', {
      type: 'button', class: 'play', 'aria-pressed': 'false',
      'aria-label': `${title} ${v.id} 미리듣기`, disabled: !v.has_preview,
    }, icon(ICON_PLAY));
    btn.addEventListener('click', () => playPreview(v, btn));
    const eq = el('span', { class: 'eq', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i'));
    return el('li', {},
      el('article', { class: 'vcard', style: `--h:${hueOf(v.id)}` },
        el('header', {},
          el('div', { class: 'avatar' }, btn, eq),
          el('div', { class: 'vhead' },
            el('h3', {}, title, el('span', { class: 'vcat' }, koCat(category))),
            el('ul', { class: 'tags', role: 'list' },
              el('li', { class: 'tag tag-accent' }, KO_ACCENT_LIB[v.accent] || v.accent),
              el('li', { class: 'tag' }, KO_GENDER[v.gender] || v.gender),
              el('li', { class: 'tag' }, `피치 ${KO_PITCH[v.pitch] || '-'}`),
              age && el('li', { class: 'tag' }, `${age}세`))),
        ),
        el('blockquote', { class: 'quote', title: v.script?.text || '' }, v.script?.text || ''),
        el('footer', {},
          el('span', { class: 'style', lang: 'en', title: v.script?.style || '' }, v.script?.style || ''),
          el('code', { class: 'vid', title: v.id }, v.id)),
      ));
  }));
}
['#q', '#f-accent', '#f-gender', '#f-pitch', '#f-cat', '#f-persona'].forEach((s) => $(s).addEventListener('input', renderCatalog));

// ---------- 2. voice design ----------
let templates = [];
let promptDirty = false;
const dForm = $('#design-form');

for (const [key, [label]] of Object.entries(ACCENTS)) $('#d-accent').append(el('option', { value: key }, label));
const chip = (name, label, value) =>
  el('label', {}, el('input', { type: 'checkbox', name, value }), label);
$('#d-tones').append(...Object.keys(TONES).map((ko) => chip('tone', ko, ko)));
$('#d-contexts').append(...Object.keys(CONTEXTS).map((ko) => chip('ctx', ko, ko)));

/** Builds a Korean voice-design prompt, e.g.
 *  "30대 여성 투어 가이드입니다. 억센 부산 사투리로 말합니다. 목소리는 따뜻하고 활기찬 느낌입니다. 팟캐스트를 진행하는 듯한 말투입니다." */
function composePrompt() {
  const accent = ACCENTS[$('#d-accent').value]?.[1] || '자연스러운 표준어';
  const gender = { female: '여성', male: '남성' }[dForm.querySelector('[name="d-gender"]:checked')?.value] || '';
  const age = $('#d-age').value;
  const role = $('#d-role').value.trim() || '화자';
  const tones = $$('[name="tone"]:checked', dForm).map((c) => c.value);
  const ctx = $$('[name="ctx"]:checked', dForm).map((c) => CONTEXTS[c.value]);
  const extra = $('#d-extra').value.trim();
  const parts = [`${[age, gender, role].filter(Boolean).join(' ')}입니다.`, `${accent}로 말합니다.`];
  if (tones.length) {
    const chain = [...tones.slice(0, -1).map((t) => `${TONES[t]}고`), tones.at(-1)].join(' ');
    parts.push(`목소리는 ${chain} 느낌입니다.`);
  }
  if (ctx.length) parts.push(`${ctx.join(' 또는 ')} 듯한 말투입니다.`);
  if (extra) parts.push(extra);
  return parts.join(' ');
}
function recompose(force = false) {
  if (promptDirty && !force) return;
  const next = composePrompt();
  if (next === $('#d-prompt').value) return;
  $('#d-prompt').value = next;
  promptDirty = false;
  scheduleUtterance();
}
dForm.addEventListener('input', (e) => {
  if (e.target.id === 'd-prompt') { promptDirty = true; scheduleUtterance(); return; }
  if (e.target.closest('.preset-box') || ['d-name', 'd-utter'].includes(e.target.id)) return;
  recompose();
});
$('#d-recompose').addEventListener('click', () => recompose(true));
$('#d-reset').addEventListener('click', () => {
  dForm.reset();
  utterDirty = false;
  setStatus($('#d-utter-status'), '');
  $('#preset-box').open = false;
  recompose(true);
  setStatus($('#d-status'), '');
});

const tplRole = (t) => t.role_ko || t.role || '';
const tplDesc = (t) => t.description_ko || t.description || '';
const NO_ROLE = '__none__';

async function loadTemplates() {
  templates = await getJSON('/api/templates');
  const accents = [...new Set(templates.map((t) => t.accent))].sort();
  fillSelect($('#p-accent'), accents, (a) => ACCENTS[a]?.[0] || a);
  const roles = [...new Set(templates.map(tplRole).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  fillSelect($('#role-list'), roles);
  fillSelect($('#p-role'), [...roles, NO_ROLE], (r) => (r === NO_ROLE ? '(역할 없음)' : r));
  renderTemplates();
}
function renderTemplates() {
  const q = $('#p-q').value.trim().toLowerCase(), a = $('#p-accent').value, g = $('#p-gender').value, r = $('#p-role').value;
  const hits = templates.filter((t) => (!a || t.accent === a) && (!g || t.gender === g) &&
    (!r || (r === NO_ROLE ? !tplRole(t) : tplRole(t) === r)) &&
    (!q || `${tplRole(t)} ${tplDesc(t)} ${t.role} ${t.description}`.toLowerCase().includes(q)));
  $('#p-count').textContent = `${hits.length}개 중 ${Math.min(hits.length, 100)}개 표시`;
  $('#p-list').replaceChildren(...hits.slice(0, 100).map((t) => el('li', {},
    el('button', { type: 'button', onclick: () => applyTemplate(t) },
      el('span', {}, el('span', { class: 'badge badge-accent' }, ACCENTS[t.accent]?.[0] || t.accent), ' ',
        el('strong', {}, tplRole(t) || '(역할 없음)'), ' · ', KO_GENDER[t.gender] || t.gender),
      el('span', { class: 'meta' }, tplDesc(t))))));
}
['#p-q', '#p-accent', '#p-gender', '#p-role'].forEach((s) => $(s).addEventListener('input', renderTemplates));

function applyTemplate(t) {
  $('#d-accent').value = ACCENTS[t.accent] ? t.accent : 'Seoul Korean';
  const g = { Female: 'female', Male: 'male' }[t.gender] ?? '';
  dForm.querySelector(`[name="d-gender"][value="${g}"]`).checked = true;
  $('#d-role').value = tplRole(t);
  $$('[name="tone"], [name="ctx"]', dForm).forEach((c) => { c.checked = false; });
  $('#d-extra').value = tplDesc(t);
  $('#d-name').value = `${ACCENTS[t.accent]?.[0] || t.accent} ${tplRole(t) || '목소리'} (${KO_GENDER[t.gender] || ''})`;
  recompose(true);
  $('#preset-box').open = false;
  $('#d-name').focus();
  setStatus($('#d-status'), '프롬프트 템플릿의 값으로 채웠습니다. 프롬프트를 확인하고 필요하면 수정한 뒤 생성하세요.');
}

// Step 2 input: generate an utterance that fits the ① description (role · dialect · situation).
let utterDirty = false, utterSeq = 0, utterTimer = 0, utterPending = null;
const fetchUtterance = async (prompt) => (await postJSON('/api/utterance', { prompt })).text;
async function generateUtterance(force = false) {
  const prompt = $('#d-prompt').value.trim();
  if ((utterDirty && !force) || prompt.length < 5) return;
  const seq = ++utterSeq;
  const status = $('#d-utter-status');
  setStatus(status, '①에 맞는 발화를 만드는 중…');
  utterPending = fetchUtterance(prompt).then((text) => {
    if (seq !== utterSeq || (utterDirty && !force)) return;
    $('#d-utter').value = text;
    utterDirty = false;
    setStatus(status, '');
  }).catch((err) => { if (seq === utterSeq) setStatus(status, `발화 생성 실패: ${err.message}`, 'error'); })
    .finally(() => { if (seq === utterSeq) utterPending = null; });
  return utterPending;
}
function scheduleUtterance() {
  clearTimeout(utterTimer);
  if (!utterDirty) utterTimer = setTimeout(() => { utterTimer = 0; generateUtterance(); }, 1200);
}
$('#d-utter').addEventListener('input', () => { utterDirty = true; clearTimeout(utterTimer); });
$('#d-utter-gen').addEventListener('click', () => { utterDirty = false; clearTimeout(utterTimer); generateUtterance(true); });

/** Step 2: speak `text` with `voiceId` via /api/tts (generate_content). Returns a WAV Blob. */
const speak = async (voiceId, text) => (await api('/api/tts', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ voice: voiceId, text, model: 'flash' }),
})).blob();

/** Live progress tracker rendered into the result panel. */
function createProgress(steps) {
  const body = $('#d-result-body');
  body.className = 'progress-wrap';
  const items = steps.map(([label, hint]) => {
    const time = el('span', { class: 'p-time' });
    const li = el('li', { class: 'p-step', dataset: { state: 'pending' } },
      el('span', { class: 'p-icon', 'aria-hidden': 'true' }),
      el('div', {}, el('strong', {}, label), hint && el('span', { class: 'meta' }, hint)),
      time);
    return { li, time, t0: 0 };
  });
  body.replaceChildren(el('ol', { class: 'progress', 'aria-live': 'polite' }, ...items.map((i) => i.li)));
  let timer = 0;
  const tick = (it) => { it.time.textContent = `${Math.floor((performance.now() - it.t0) / 1000)}초`; };
  return {
    start(i) {
      const it = items[i];
      it.li.dataset.state = 'active';
      it.t0 = performance.now();
      tick(it);
      clearInterval(timer);
      timer = setInterval(() => tick(it), 1000);
    },
    done(i, state = 'done') { clearInterval(timer); items[i].li.dataset.state = state; if (items[i].t0) tick(items[i]); },
    skip(i) { items[i].li.dataset.state = 'skipped'; },
    stop() { clearInterval(timer); },
  };
}

const friendlyDesignError = (msg) => /did not complete|rephras/i.test(msg)
  ? '모델이 이 설명으로 목소리를 완성하지 못했습니다(목소리는 생성되지 않음). 설명을 더 짧고 구체적으로 바꾸거나 다시 시도해 보세요.'
  : msg;

dForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#d-name').value.trim(), prompt = $('#d-prompt').value.trim();
  if (!name) { $('#d-name').focus(); return setStatus($('#d-status'), '목소리 이름을 입력하세요.', 'error'); }
  if (prompt.length < 10) { $('#d-prompt').focus(); return setStatus($('#d-status'), '목소리 설명 프롬프트가 너무 짧습니다.', 'error'); }
  const btn = $('#d-submit');
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.setAttribute('aria-busy', 'true');
  const label = btn.textContent;
  btn.textContent = '생성 중…';
  $('#design-result').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const p = createProgress([
    ['발화 준비', '①에 맞는 대사 확인'],
    ['목소리 생성', 'voices.create · 보통 15~40초 (실패 시 자동 재시도)'],
    ['발화 음성 생성', 'generate_content · 새 목소리로 읽기'],
  ]);
  let step = 0;
  try {
    p.start(0);
    setStatus($('#d-status'), '진행 중… 오른쪽 결과 패널에서 단계를 확인하세요.');
    // Make sure ② reflects the latest ① before speaking it.
    if (utterTimer && !utterDirty) { clearTimeout(utterTimer); utterTimer = 0; generateUtterance(); }
    if (utterPending) await utterPending;
    const utter = $('#d-utter').value.trim();
    if (!utter) throw new Error('들어볼 발화를 입력하세요.');
    p.done(0);

    step = 1; p.start(1);
    const gender = dForm.querySelector('[name="d-gender"]:checked')?.value || null;
    const res = await postJSON('/api/voices/design', { display_name: name, gender, prompt });
    res.voice.display_name ||= name; // create response may not echo display_name
    p.done(1);

    step = 2; p.start(2);
    let utterBlob = null, utterErr = null;
    try { utterBlob = await speak(res.voice.id, utter); p.done(2); } catch (err) { utterErr = err.message; p.done(2, 'error'); }
    await new Promise((r) => setTimeout(r, 400)); // let the final check mark show briefly
    showDesignResult(res, prompt, utter, utterBlob, utterErr);
    setStatus($('#d-status'), utterErr ? '목소리는 만들었지만 발화 생성에 실패했습니다.' : '완료! 오른쪽에서 결과를 들어보세요.', utterErr ? 'error' : 'ok');
  } catch (err) {
    p.done(step, 'error');
    for (let i = step + 1; i < 3; i++) p.skip(i);
    const msg = step === 1 ? friendlyDesignError(err.message) : err.message;
    setStatus($('#d-status'), `실패: ${msg}`, 'error');
    $('#d-result-body').append(el('p', { class: 'status error p-error' }, msg));
  } finally {
    p.stop();
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.removeAttribute('aria-busy');
    btn.textContent = label;
  }
});

function showDesignResult({ voice, sample_wav_b64 }, prompt, utter, utterBlob, utterErr) {
  const body = $('#d-result-body');
  body.className = '';
  const sample = sample_wav_b64
    ? el('audio', { controls: true, src: URL.createObjectURL(b64ToBlob(sample_wav_b64, 'audio/wav')) })
    : el('p', { class: 'hint' }, '자동 생성 샘플이 반환되지 않았습니다.');

  const text = el('textarea', { id: 'd-test-text', rows: 3 }, utter);
  const testAudio = el('audio', { controls: true, hidden: !utterBlob });
  if (utterBlob) testAudio.src = URL.createObjectURL(utterBlob);
  const testStatus = el('p', { class: 'status', role: 'status' });
  if (utterErr) setStatus(testStatus, `발화 생성 실패: ${utterErr}`, 'error');
  const testBtn = el('button', { type: 'button', class: 'btn btn-primary' }, '다시 생성');
  testBtn.addEventListener('click', async () => {
    if (!text.value.trim()) return setStatus(testStatus, '문장을 입력하세요.', 'error');
    testBtn.disabled = true;
    setStatus(testStatus, '음성 생성 중…');
    try {
      testAudio.src = URL.createObjectURL(await speak(voice.id, text.value.trim()));
      testAudio.hidden = false;
      testAudio.play().catch(() => {});
      setStatus(testStatus, '');
    } catch (err) {
      setStatus(testStatus, `실패: ${err.message}`, 'error');
    } finally {
      testBtn.disabled = false;
    }
  });

  body.replaceChildren(
    el('h3', {}, voice.display_name || voice.id),
    el('p', {}, el('code', {}, voice.id)),
    el('div', { class: 'test-box' },
      el('label', { for: 'd-test-text' }, '② 발화 (새 목소리로 읽은 문장)'),
      testAudio,
      testStatus,
      text,
      el('div', { class: 'test-actions' },
        el('button', { type: 'button', class: 'btn', onclick: async (ev) => {
          const b = ev.currentTarget; // currentTarget is null after await
          b.disabled = true;
          setStatus(testStatus, '①에 맞는 새 발화를 만드는 중…');
          try { text.value = await fetchUtterance(prompt); setStatus(testStatus, ''); }
          catch (err) { setStatus(testStatus, `발화 생성 실패: ${err.message}`, 'error'); }
          b.disabled = false;
        } }, '✨ 다른 발화'),
        testBtn),
      el('div', { class: 'test-actions' },
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => useInPlayground(voice.id) },
          `${$('#tab-voices').textContent} 탭에서 열기 →`))),
    el('details', { class: 'prompt-used' },
      el('summary', {}, '① 목소리 설명 프롬프트 · 자동 생성 샘플'),
      el('p', { class: 'meta' }, prompt),
      sample),
  );
  (utterBlob ? testAudio : sample).play?.().catch(() => {});
}
$('#d-prompt').value = composePrompt(); // initial fill; no utterance call on page load

// ---------- 3. voice replication ----------
let cfg = {};
let consentWav = null, sourceWav = null, sampleIdx = 0;
const steps = $$('#r-steps li');
function gotoStep(n) {
  $$('.r-step').forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
  steps.forEach((li, i) => {
    li.toggleAttribute('aria-current', i === n - 1);
    if (i === n - 1) li.setAttribute('aria-current', 'step');
    li.classList.toggle('done', i < n - 1);
  });
  $(`.r-step[data-step="${n}"] h2`).focus?.();
  if (n === 4) {
    $('#r-review-consent').src = URL.createObjectURL(consentWav);
    $('#r-review-source').src = URL.createObjectURL(sourceWav);
  }
}
$$('[data-goto]').forEach((b) => b.addEventListener('click', () => gotoStep(Number(b.dataset.goto))));

const consentBoxes = $$('.r-consent');
const step1Ready = () => { $('#r-next-1').disabled = !(consentBoxes.every((c) => c.checked) && $('#r-name').value.trim()); };
consentBoxes.forEach((c) => c.addEventListener('change', step1Ready));
$('#r-name').addEventListener('input', step1Ready);
$('#r-next-1').addEventListener('click', () => gotoStep(2));
$('#r-next-2').addEventListener('click', () => gotoStep(3));
$('#r-next-3').addEventListener('click', () => gotoStep(4));

createRecorder($('#rec-consent'), {
  maxSeconds: 20,
  minSeconds: 2,
  onChange: (wav) => { consentWav = wav; $('#r-next-2').disabled = !wav; },
});
createRecorder($('#rec-source'), {
  maxSeconds: 30,
  minSeconds: 10,
  onChange: (wav) => { sourceWav = wav; $('#r-next-3').disabled = !wav; },
});

function showSample() {
  const list = cfg.sample_texts || [];
  if (!list.length) return;
  sampleIdx = (sampleIdx + list.length) % list.length;
  $('#r-sample-text').textContent = list[sampleIdx];
  $('#r-sample-idx').textContent = `문단 ${sampleIdx + 1} / ${list.length}`;
}
$('#r-sample-prev').addEventListener('click', () => { sampleIdx--; showSample(); });
$('#r-sample-next').addEventListener('click', () => { sampleIdx++; showSample(); });

let replicatedId = null;
$('#r-create').addEventListener('click', async () => {
  const btn = $('#r-create');
  btn.disabled = true;
  setStatus($('#r-status'), '복제 목소리를 만드는 중… (동의문 확인 포함, 최대 2분)');
  const fd = new FormData();
  fd.append('display_name', $('#r-name').value.trim());
  fd.append('consent_confirmed', 'true');
  fd.append('consent_audio', consentWav, 'consent.wav');
  fd.append('source_audio', sourceWav, 'source.wav');
  try {
    const { voice } = await (await api('/api/voices/replicate', { method: 'POST', body: fd })).json();
    replicatedId = voice.id;
    setStatus($('#r-status'), `생성 완료: ${voice.id}`, 'ok');
    $('#r-result').hidden = false;
    steps.forEach((li) => li.classList.add('done'));
  } catch (err) {
    setStatus($('#r-status'), `실패: ${err.message} — 동의문을 한 글자도 빠짐없이 읽었는지 확인하고 다시 녹음해 보세요.`, 'error');
  } finally {
    btn.disabled = false;
  }
});
$('#r-test-btn').addEventListener('click', async () => {
  if (!replicatedId) return;
  const btn = $('#r-test-btn');
  btn.disabled = true;
  try {
    const blob = await (await api('/api/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice: replicatedId, text: $('#r-test-text').value, model: 'flash' }),
    })).blob();
    const a = $('#r-test-audio');
    a.src = URL.createObjectURL(blob);
    a.hidden = false;
    a.play().catch(() => {});
  } catch (err) {
    setStatus($('#r-status'), `TTS 실패: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ---------- 4. designed voices: browse + TTS ----------
let myVoices = [], selectedId = '';
const KO_VTYPE = { prompted: '보이스 디자인', replicated: '보이스 복제' };
const fmtDate = (iso) => { const d = iso && new Date(iso); return d && !isNaN(d) ? `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}` : ''; };

async function loadVoices() {
  setStatus($('#v-status'), '불러오는 중…');
  try {
    myVoices = await getJSON('/api/voices');
    setStatus($('#v-status'), '');
    renderVoices();
  } catch (err) {
    setStatus($('#v-status'), `목록을 불러오지 못했습니다: ${err.message}`, 'error');
  }
}

function renderVoices() {
  const type = $('#v-filter').querySelector('input:checked').value;
  const list = myVoices.filter((v) => !type || v.type === type);
  $('#v-count').textContent = `${list.length}개`;
  if (!list.length) {
    $('#v-list').replaceChildren(el('li', { class: 'empty' },
      myVoices.length ? '이 종류의 목소리가 없습니다.' : '저장된 목소리가 없습니다. 보이스 디자인 탭에서 만들어 보세요.'));
  } else {
    $('#v-list').replaceChildren(...list.map((v) => {
      const audio = el('audio', { controls: true, hidden: true });
      const radio = el('input', { type: 'radio', name: 'v-pick', value: v.id, checked: v.id === selectedId });
      radio.addEventListener('change', () => selectVoice(v));
      return el('li', { class: 'v-item' },
        el('label', { class: 'v-choice' }, radio,
          el('div', { class: 'v-body' },
            el('div', { class: 'v-head' },
              el('span', { class: 'v-name' }, v.display_name || '(이름 없음)'),
              el('span', { class: `badge ${v.type === 'replicated' ? '' : 'badge-accent'}` }, KO_VTYPE[v.type] || v.type),
              v.gender && el('span', { class: 'tag' }, KO_GENDER[v.gender] || v.gender)),
            v.prompt && el('p', { class: 'v-prompt', title: v.prompt }, v.prompt),
            el('div', { class: 'v-meta' },
              el('code', { class: 'vid' }, v.id),
              v.expire_time && el('span', { class: 'meta' }, `만료 예정 ${fmtDate(v.expire_time)}`)))),
        el('div', { class: 'v-actions' },
          v.type === 'prompted' && el('button', {
            type: 'button', class: 'btn btn-sm', onclick: async (e) => {
              const b = e.currentTarget; b.disabled = true;
              try {
                audio.src = URL.createObjectURL(await (await api(`/api/voices/${encodeURIComponent(v.id)}/sample`)).blob());
                audio.hidden = false; audio.play().catch(() => {});
              } catch (err) { setStatus($('#v-status'), `샘플을 불러오지 못했습니다: ${err.message}`, 'error'); }
              b.disabled = false;
            },
          }, '생성 샘플 듣기'),
          el('button', {
            type: 'button', class: 'btn btn-sm btn-danger', onclick: async () => {
              if (!confirm(`"${v.display_name || v.id}" 목소리를 삭제할까요? 되돌릴 수 없습니다.`)) return;
              try {
                await api(`/api/voices/${encodeURIComponent(v.id)}`, { method: 'DELETE' });
                if (selectedId === v.id) selectVoice(null);
                loadVoices();
              } catch (err) { setStatus($('#v-status'), `삭제 실패: ${err.message}`, 'error'); }
            },
          }, '삭제')),
        audio);
    }));
  }
  const sel = myVoices.find((v) => v.id === selectedId);
  selectVoice(sel || null);
}
$('#v-filter').addEventListener('change', renderVoices);
$('#v-filter').querySelector('input[value=""]').checked = true; // ignore browser form-state restore
$('#v-refresh').addEventListener('click', loadVoices);

function selectVoice(v) {
  selectedId = v?.id || '';
  $('#t-voice').value = selectedId;
  $('#t-submit').disabled = !v;
  const box = $('#t-selected');
  if (!v) {
    box.className = 't-selected empty';
    box.replaceChildren('왼쪽 목록에서 목소리를 선택하세요.');
    return;
  }
  box.className = 't-selected';
  box.replaceChildren(
    el('span', { class: 'meta' }, '선택한 목소리'),
    el('strong', {}, v.display_name || '(이름 없음)'),
    el('code', { class: 'vid' }, v.id));
}

/** Called from the design / replicate result panels. */
function useInPlayground(id) {
  selectedId = id;
  goTab('tab-voices'); // triggers loadVoices(), which re-selects `selectedId`
  $('#t-text').focus();
}

$('#t-tags').append(...Object.entries(AUDIO_TAGS).map(([t, ko]) => el('button', {
  type: 'button', class: 'chip', title: ko, onclick: () => {
    const ta = $('#t-text'), tag = `<${t}> `;
    const { selectionStart: s, selectionEnd: e2, value } = ta;
    ta.value = value.slice(0, s) + tag + value.slice(e2);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = s + tag.length;
  },
}, `<${t}>`)));

// Style presets: Korean label -> English style value (docs examples are English).
const STYLE_CHIPS = {
  '신나게': 'excited and energetic', '차분하게': 'calm and reassuring', '따뜻하게': 'warm and friendly',
  '속삭이듯': 'whispering softly', '빠르게': 'speaking quickly', '천천히 또박또박': 'slowly and clearly',
  '슬프게': 'sad and subdued', '뉴스 앵커처럼': 'professional news anchor',
};
$('#t-style-chips').append(...Object.entries(STYLE_CHIPS).map(([ko, en]) => el('button', {
  type: 'button', class: 'chip chip-ko', title: en,
  onclick: () => { const i = $('#t-style'); i.value = i.value === en ? '' : en; syncStyleChips(); },
}, ko)));

function syncStyleChips() {
  $$('#t-style-chips button').forEach((b) => b.setAttribute('aria-pressed', String(b.title === $('#t-style').value.trim())));
}
$('#t-style').addEventListener('input', syncStyleChips);

$('#tts-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const voice = $('#t-voice').value.trim(), text = $('#t-text').value.trim();
  if (!voice) return setStatus($('#t-status'), '먼저 왼쪽 목록에서 목소리를 선택하세요.', 'error');
  if (!text) return setStatus($('#t-status'), '읽을 문장을 입력하세요.', 'error');
  const btn = $('#t-submit');
  btn.disabled = true;
  btn.classList.add('is-loading');
  setStatus($('#t-status'), '음성 생성 중…');
  try {
    const blob = await (await api('/api/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice, text, style: $('#t-style').value.trim() || null, model: 'flash' }),
    })).blob();
    const url = URL.createObjectURL(blob);
    const a = $('#t-audio');
    a.src = url; a.hidden = false; a.play().catch(() => {});
    const dl = $('#t-download');
    dl.href = url; dl.download = `tts-${voice}.wav`; dl.hidden = false;
    setStatus($('#t-status'), '완료 (서버에 저장되지 않습니다)', 'ok');
  } catch (err) {
    setStatus($('#t-status'), `실패: ${err.message}`, 'error');
  } finally {
    btn.disabled = !$('#t-voice').value;
    btn.classList.remove('is-loading');
  }
});

// ---------- init ----------
(async () => {
  try {
    cfg = await getJSON('/api/config');
    $('#r-consent-text').textContent = cfg.consent_statement;
    showSample();
    const missing = [!cfg.project_set && 'PROJECT_ID', !cfg.bucket_set && 'GCS_BUCKET'].filter(Boolean);
    if (missing.length) {
      const w = $('#config-warning');
      w.textContent = `.env에 ${missing.join(', ')} 값이 없습니다. 일부 기능이 동작하지 않습니다.`;
      w.hidden = false;
    }
  } catch (err) { console.error(err); }
  loadCatalog().catch((err) => { $('#count').textContent = `Curated Preset 보이스 로드 실패: ${err.message}`; });
  loadTemplates().catch(console.error);
})();
