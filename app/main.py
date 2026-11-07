"""FastAPI backend: Korean voice catalog, voice design, voice replication, TTS.

API and static frontend are served from the same port.
Nothing user-generated is persisted by this server:
  - replication recordings (consent / source) are processed in memory only
  - designed-voice samples and TTS results are returned directly, not stored
GCS is used read-only for pre-generated catalog previews.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import time
import wave
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from google import genai
from google.cloud import storage
from pydantic import BaseModel, Field

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
PROJECT_ID = os.environ.get("PROJECT_ID") or os.environ.get("GOOGLE_CLOUD_PROJECT")
LOCATION = os.environ.get("LOCATION", "global")
GCS_BUCKET = os.environ.get("GCS_BUCKET", "")
PREVIEW_PREFIX = "catalog/"

MODELS = {"flash": "gemini-3.8-flash-tts"}  # this app uses Gemini 3.8 Flash TTS only

# Official Korean consent statement (voice-replication docs). Must be read verbatim.
CONSENT_KO = "저는 이 음성의 소유자이며, Google Cloud를 사용하여 제 음성의 합성 모델을 생성하는 데 동의했습니다."

# Read-along passages for the replication source recording (~20-30 s each).
SAMPLE_TEXTS = [
    "아침 안개가 천천히 걷히자 항구로 첫 번째 고깃배들이 돌아왔습니다. 갈매기들은 하늘을 맴돌며 서로를 불렀고, "
    "골목 모퉁이 빵집에서는 갓 구운 빵 냄새가 바닷바람을 타고 퍼져 나갔습니다. 사람들이 쉽게 기억하지 못하는 "
    "평범하고 조용한 하루였지만, 몇 년이 지난 지금 제가 가장 자주 떠올리는 날이 바로 그날입니다.",
    "주말이면 저는 가끔 동네 도서관에 들러 오래된 책들을 구경합니다. 누렇게 바랜 종이 냄새와 조용히 책장을 넘기는 "
    "소리가 마음을 편안하게 해 주거든요. 창가 자리에 앉아 따뜻한 차 한 잔을 마시며 책을 읽다 보면, 어느새 해가 "
    "기울고 하루가 훌쩍 지나가 있습니다. 그런 시간이 제게는 가장 소중한 휴식입니다.",
    "지난봄, 친구들과 함께 제주도로 여행을 다녀왔습니다. 푸른 바다를 따라 해안 도로를 달리고, 노란 유채꽃밭에서 "
    "사진도 잔뜩 찍었지요. 저녁에는 작은 식당에서 갓 잡은 생선으로 만든 요리를 먹으며 밤늦도록 이야기를 나눴습니다. "
    "다음에는 가족들과 함께 다시 꼭 가 보고 싶어요.",
]

app = FastAPI(title="Korean Voice Studio")

_client: genai.Client | None = None
_bucket: storage.Bucket | None = None
_preview_cache: tuple[float, set[str]] = (0.0, set())
_DATA = ROOT / "data"
# Playable catalog: ko-KR Extended Voice Library voices from voices.list (scripts/list_korean_library.py).
CATALOG: list[dict] = json.loads((_DATA / "korean_library_voices.json").read_text(encoding="utf-8"))
# Prompt templates for voice design: the 1,347-entry HTML catalog (its IDs are not callable library voices).
TEMPLATES: list[dict] = json.loads((_DATA / "korean_voices.json").read_text(encoding="utf-8"))
_scripts_path = _DATA / "preview_scripts.json"
SCRIPTS: dict = json.loads(_scripts_path.read_text(encoding="utf-8")) if _scripts_path.exists() else {}


def client() -> genai.Client:
    global _client
    if _client is None:
        if not PROJECT_ID:
            raise HTTPException(500, "PROJECT_ID is not set (.env)")
        _client = genai.Client(enterprise=True, project=PROJECT_ID, location=LOCATION)
    return _client


def bucket() -> storage.Bucket:
    global _bucket
    if _bucket is None:
        if not GCS_BUCKET:
            raise HTTPException(500, "GCS_BUCKET is not set (.env)")
        _bucket = storage.Client(project=PROJECT_ID).bucket(GCS_BUCKET)
    return _bucket


def pcm_to_wav(pcm: bytes, rate: int = 24000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def ensure_wav(data: bytes, mime: str | None) -> bytes:
    """TTS/Voices API may return headerless audio/l16 PCM; wrap it in a WAV header."""
    if data[:4] == b"RIFF":
        return data
    rate = 24000
    if mime and (m := re.search(r"rate=(\d+)", mime)):
        rate = int(m.group(1))
    return pcm_to_wav(data, rate)


def api_error(e: Exception) -> HTTPException:
    # Voices API errors carry `status_code`; generate_content errors carry `code`.
    code = getattr(e, "status_code", None) or getattr(e, "code", None)
    status = code if isinstance(code, int) and 400 <= code < 600 else 502
    return HTTPException(status, getattr(e, "message", None) or str(e))


# ---------- config & catalog ----------

@app.get("/api/config")
def config():
    return {
        "models": MODELS,
        "consent_statement": CONSENT_KO,
        "sample_texts": SAMPLE_TEXTS,
        "project_set": bool(PROJECT_ID),
        "bucket_set": bool(GCS_BUCKET),
    }


def preview_ids() -> set[str]:
    """Voice IDs that already have a pre-generated preview in GCS (cached 5 min)."""
    global _preview_cache
    ts, ids = _preview_cache
    if time.time() - ts < 300:
        return ids
    try:
        ids = {
            b.name[len(PREVIEW_PREFIX):-4]
            for b in bucket().list_blobs(prefix=PREVIEW_PREFIX)
            if b.name.endswith(".wav")
        }
    except Exception:
        ids = set()
    _preview_cache = (time.time(), ids)
    return ids


@app.get("/api/catalog")
def catalog():
    have = preview_ids() if GCS_BUCKET else set()
    return [
        {**v, "has_preview": v["id"] in have, "script": SCRIPTS.get(v["id"], {})}
        for v in CATALOG
    ]


@app.get("/api/templates")
def templates():
    return TEMPLATES


@app.get("/api/catalog/{voice_id}/preview")
def catalog_preview(voice_id: str):
    if not re.fullmatch(r"[\w\-]+", voice_id):
        raise HTTPException(400, "invalid voice id")
    blob = bucket().blob(f"{PREVIEW_PREFIX}{voice_id}.wav")
    if not blob.exists():
        raise HTTPException(404, "preview not generated yet")
    return StreamingResponse(
        blob.open("rb"),
        media_type="audio/wav",
        headers={"Cache-Control": "private, max-age=86400"},
    )


# ---------- stored voices (designed + replicated) ----------

def voice_summary(v) -> dict:
    prompted = getattr(v, "prompted", None)
    prompt = prompted.get("input") if isinstance(prompted, dict) else getattr(prompted, "input", None)
    expire = getattr(v, "expire_time", None)
    vtype = str(getattr(v, "type", "") or "").lower()
    return {
        "id": v.id,
        "display_name": getattr(v, "display_name", None),
        "type": "replicated" if "replicated" in vtype else "prompted" if "prompted" in vtype else vtype,
        "gender": getattr(v, "gender", None),
        "language_code": getattr(v, "language_code", None),
        "prompt": prompt,
        "expire_time": expire.isoformat() if hasattr(expire, "isoformat") else expire,
    }


@app.get("/api/voices")
def list_voices():
    out, token = [], None
    try:
        while True:
            res = client().voices.list(type_=["prompted", "replicated"], page_size=100, page_token=token)
            out += [voice_summary(v) for v in (res.voices or [])]
            token = getattr(res, "next_page_token", None)
            if not token:
                break
    except Exception as e:
        raise api_error(e)
    return out


@app.get("/api/voices/{voice_id}/sample")
def voice_sample(voice_id: str):
    try:
        v = client().voices.get(id=voice_id)
    except Exception as e:
        raise api_error(e)
    if not getattr(v, "sample_audio", None) or not v.sample_audio.data:
        raise HTTPException(404, "no sample for this voice")
    raw = v.sample_audio.data
    data = base64.b64decode(raw) if isinstance(raw, str) else raw
    return Response(ensure_wav(data, v.sample_audio.mime_type), media_type="audio/wav")


@app.delete("/api/voices/{voice_id}")
def delete_voice(voice_id: str):
    try:
        client().voices.delete(id=voice_id)
    except Exception as e:
        raise api_error(e)
    return {"deleted": voice_id}


# ---------- voice design ----------

class DesignRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=100)
    gender: str | None = None  # "female" | "male" | None
    prompt: str = Field(min_length=10, max_length=2000)


@app.post("/api/voices/design")
def design_voice(req: DesignRequest):
    voice = {
        "type": "VOICE_TYPE_PROMPTED",
        "display_name": req.display_name,
        "language_code": "ko-KR",
        "prompted": {"input": req.prompt},
    }
    if req.gender in ("female", "male"):
        voice["gender"] = req.gender
    # store must be True and model must NOT be set for designed voices.
    # "Voice generation did not complete" is intermittent and creates no voice, so retry it.
    for attempt in range(3):
        try:
            v = client().voices.create(store=True, voice=voice, timeout=90)
            break
        except Exception as e:
            if attempt < 2 and "did not complete" in str(e).lower():
                time.sleep(1.5)
                continue
            raise api_error(e)
    sample = None
    if getattr(v, "sample_audio", None) and v.sample_audio.data:
        raw = v.sample_audio.data
        data = base64.b64decode(raw) if isinstance(raw, str) else raw
        sample = base64.b64encode(ensure_wav(data, v.sample_audio.mime_type)).decode()
    return {"voice": voice_summary(v), "sample_wav_b64": sample}


# ---------- utterance suggestion for a voice description ----------

UTTERANCE_MODEL = os.environ.get("UTTERANCE_MODEL", "gemini-2.5-flash")
UTTERANCE_INSTRUCTION = """당신은 TTS 데모용 대사 작가입니다.
사용자가 주는 '목소리 설명'(화자의 나이·성별·역할·억양/사투리·톤·상황)을 읽고,
그 화자가 바로 그 상황에서 실제로 할 법한 한국어 대사를 작성하세요.

규칙:
- 2~3문장, 전체 60~130자.
- 설명에 사투리가 있으면 모든 문장의 어미와 어휘를 그 사투리로 쓰세요. 표준어 문장이 섞이면 안 됩니다.
  (예: 충청도 "~했슈", "~그려", "~겨", "~유" / 부산·경상도 "~했나", "~아이가", "~카이", "~하이소" / 전라도 "~했당께", "~잉", "~부러" / 강원도 "~했드래요", "~나요")
- 설명된 상황이 대사 내용만 들어도 분명히 알 수 있어야 합니다. 그 상황에서만 나올 구체적인 말을 넣으세요.
  (예: 버스 옆자리 수다 → 정류장·창밖·내릴 곳 이야기를 옆 친구에게 말하듯 / 팟캐스트 → 청취자·게스트에게 말하듯 / 전화 상담 → 고객 응대 문구)
- 상황이 없으면 화자의 역할에 어울리는 대사를 쓰세요.
- 톤(밝음, 차분함, 유머 등)이 말투에 묻어나게 쓰세요.
- 어울리면 오디오 태그를 최대 1개 넣을 수 있습니다: <laugh> <chuckle> <giggle> <sigh> <gasp> <short pause>
- 따옴표, 화자 이름, 설명 없이 대사 본문만 출력하세요."""


class UtteranceRequest(BaseModel):
    prompt: str = Field(min_length=5, max_length=2000)


@app.post("/api/utterance")
def suggest_utterance(req: UtteranceRequest):
    try:
        res = client().models.generate_content(
            model=UTTERANCE_MODEL,
            contents=f"목소리 설명:\n{req.prompt}",
            config={"system_instruction": UTTERANCE_INSTRUCTION, "temperature": 0.7,
                    "thinking_config": {"thinking_budget": 0}},
        )
    except Exception as e:
        raise api_error(e)
    text = (res.text or "").strip().strip('"“”').strip()
    if not text:
        raise HTTPException(502, "empty utterance")
    return {"text": text, "model": UTTERANCE_MODEL}


# ---------- voice replication ----------

MAX_UPLOAD = 5 * 1024 * 1024  # 30 s of 24 kHz mono 16-bit PCM is ~1.4 MB


async def read_wav(f: UploadFile, label: str) -> bytes:
    data = await f.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, f"{label} recording is too large")
    if data[:4] != b"RIFF":
        raise HTTPException(400, f"{label} must be a WAV file")
    return data


@app.post("/api/voices/replicate")
async def replicate_voice(
    display_name: str = Form(..., min_length=1, max_length=100),
    consent_confirmed: bool = Form(...),
    consent_audio: UploadFile = File(...),
    source_audio: UploadFile = File(...),
):
    if not consent_confirmed:
        raise HTTPException(400, "consent checkboxes must be confirmed")
    consent = await read_wav(consent_audio, "consent")
    source = await read_wav(source_audio, "source")
    try:
        v = client().voices.create(
            store=True,
            voice={
                "type": "VOICE_TYPE_REPLICATED",
                "display_name": display_name,
                "replicated": {
                    "source_audio": {"mime_type": "audio/wav", "data": base64.b64encode(source).decode()},
                    "consent_audio": {"mime_type": "audio/wav", "data": base64.b64encode(consent).decode()},
                },
            },
            timeout=120,
        )
    except Exception as e:
        raise api_error(e)
    finally:
        del consent, source  # recordings are never persisted
    return {"voice": voice_summary(v)}


# ---------- TTS ----------

class TTSRequest(BaseModel):
    voice: str = Field(min_length=1)
    text: str = Field(min_length=1, max_length=4000)
    style: str | None = Field(default=None, max_length=300)
    model: str = "flash"


@app.post("/api/tts")
def tts(req: TTSRequest):
    model = MODELS.get(req.model)
    if not model:
        raise HTTPException(400, "unknown model")
    part: dict = {"text": req.text}
    if req.style:
        part["speech_metadata"] = {"style": req.style}
    try:
        res = client().models.generate_content(
            model=model,
            contents=[{"role": "user", "parts": [part]}],
            config={
                "response_modalities": ["AUDIO"],
                "speech_config": {"voice_config": {"voice": req.voice}},
            },
        )
        inline = res.candidates[0].content.parts[0].inline_data
    except Exception as e:
        raise api_error(e)
    return Response(ensure_wav(inline.data, inline.mime_type), media_type="audio/wav")


# ---------- static frontend (same port) ----------

STATIC = ROOT / "static"


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
