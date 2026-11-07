// Microphone recorder that outputs 24 kHz mono 16-bit WAV (what the Voices API expects).
// Records with MediaRecorder, then decodes + resamples via OfflineAudioContext in the browser,
// so the server never needs ffmpeg.

const TARGET_RATE = 24000;

export function createRecorder(root, { maxSeconds = 0, minSeconds = 0, onChange = () => {} } = {}) {
  root.innerHTML = `
    <div class="rec-row">
      <button type="button" class="btn btn-rec" data-act="toggle">● 녹음 시작</button>
      <span class="rec-time" aria-live="off">0.0초</span>
      <div class="rec-meter" aria-hidden="true"><span></span></div>
    </div>
    <p class="rec-msg" role="status"></p>
    <audio controls hidden></audio>`;
  const btn = root.querySelector('[data-act="toggle"]');
  const timeEl = root.querySelector('.rec-time');
  const meter = root.querySelector('.rec-meter > span');
  const msg = root.querySelector('.rec-msg');
  const audio = root.querySelector('audio');

  let state = 'idle'; // idle | recording | processing
  let stream, mediaRec, chunks, ctx, analyser, raf, startedAt, autoStop;

  const setMsg = (text, cls = '') => { msg.textContent = text; msg.className = `rec-msg ${cls}`; };

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      setMsg('마이크에 접근할 수 없습니다. 브라우저에서 마이크 권한을 허용해 주세요.', 'warn');
      return;
    }
    chunks = [];
    mediaRec = new MediaRecorder(stream);
    mediaRec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mediaRec.onstop = finish;

    ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    startedAt = performance.now();
    const tick = () => {
      const sec = (performance.now() - startedAt) / 1000;
      timeEl.textContent = `${sec.toFixed(1)}초${maxSeconds ? ` / ${maxSeconds}초` : ''}`;
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      meter.style.inlineSize = `${Math.min(100, peak * 140)}%`;
      raf = requestAnimationFrame(tick);
    };
    tick();
    if (maxSeconds) autoStop = setTimeout(stop, maxSeconds * 1000);

    mediaRec.start();
    state = 'recording';
    btn.textContent = '■ 녹음 정지';
    audio.hidden = true;
    setMsg('녹음 중입니다…');
    onChange(null);
  }

  function stop() {
    if (state !== 'recording') return;
    clearTimeout(autoStop);
    cancelAnimationFrame(raf);
    meter.style.inlineSize = '0';
    state = 'processing';
    btn.disabled = true;
    setMsg('오디오 변환 중…');
    mediaRec.stop();
    stream.getTracks().forEach((t) => t.stop());
  }

  async function finish() {
    try {
      const blob = new Blob(chunks, { type: mediaRec.mimeType });
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      ctx.close();
      let seconds = decoded.duration;
      if (maxSeconds) seconds = Math.min(seconds, maxSeconds);
      const wav = await toWav(decoded, seconds);
      audio.src = URL.createObjectURL(wav);
      audio.hidden = false;
      timeEl.textContent = `${seconds.toFixed(1)}초`;
      if (minSeconds && seconds < minSeconds) {
        setMsg(`녹음이 ${seconds.toFixed(1)}초로 너무 짧습니다. ${minSeconds}초 이상 녹음해 주세요.`, 'warn');
        onChange(null);
      } else {
        setMsg('녹음이 끝났습니다. 재생해서 확인하고, 다시 녹음하려면 버튼을 누르세요.');
        onChange(wav);
      }
    } catch (e) {
      setMsg(`오디오를 처리하지 못했습니다: ${e.message}`, 'warn');
      onChange(null);
    } finally {
      state = 'idle';
      btn.disabled = false;
      btn.textContent = '● 다시 녹음';
    }
  }

  btn.addEventListener('click', () => (state === 'recording' ? stop() : state === 'idle' && start()));
  return { reset() { audio.hidden = true; audio.removeAttribute('src'); timeEl.textContent = '0.0초'; setMsg(''); btn.textContent = '● 녹음 시작'; onChange(null); } };
}

async function toWav(audioBuffer, seconds) {
  const length = Math.ceil(seconds * TARGET_RATE);
  const offline = new OfflineAudioContext(1, length, TARGET_RATE);
  const src = offline.createBufferSource();
  src.buffer = audioBuffer; // multi-channel input is down-mixed to mono by the 1-channel context
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), TARGET_RATE);
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
