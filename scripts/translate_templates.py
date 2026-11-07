"""Add Korean role/description fields to the prompt templates (data/korean_voices.json).

- role_ko        : fixed dictionary below (48 roles)
- description_ko : Gemini text translation of each unique English description,
                   phrased as a voice-design prompt fragment. Cached in
                   data/description_ko_cache.json so re-runs only translate new ones.

This calls a Gemini TEXT model (not TTS). Usage:
    uv run python scripts/translate_templates.py
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from google import genai

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
DATA = ROOT / "data" / "korean_voices.json"
CACHE = ROOT / "data" / "description_ko_cache.json"
MODEL = os.environ.get("TRANSLATE_MODEL", "gemini-2.5-flash")
BATCH = 80

ROLE_KO = {
    "tour guide": "투어 가이드", "tech support agent": "기술지원 상담원", "sales associate": "판매 직원",
    "parent": "부모", "journalist": "기자", "instructional video host": "교육 영상 진행자", "sibling": "형제/자매",
    "customer service agent": "고객센터 상담원", "architect": "건축가", "social worker": "사회복지사",
    "dating coach": "연애 코치", "podcast interviewer": "팟캐스트 인터뷰어", "fitness trainer": "피트니스 트레이너",
    "doctor": "의사", "friend": "친구", "best friend": "절친", "grandparent": "조부모", "storyteller": "이야기꾼",
    "person giving driving directions": "길 안내자", "influencer": "인플루언서", "comedian": "코미디언",
    "librarian": "사서", "fashion consultant": "패션 컨설턴트", "music teacher": "음악 선생님",
    "cooking show host": "요리쇼 진행자", "music producer": "음악 프로듀서", "executive assistant": "비서",
    "professor": "교수", "counselor": "상담가", "matchmaker": "중매인", "chess instructor": "체스 강사",
    "nutritionist": "영양사", "nature documentary narrator": "자연 다큐 내레이터", "teacher": "선생님",
    "therapist": "심리 치료사", "grad student": "대학원생", "tutor": "과외 선생님", "hotel concierge": "호텔 컨시어지",
    "lawyer": "변호사", "musician": "뮤지션", "sports coach": "스포츠 코치", "aunt/uncle": "이모/삼촌",
    "mentor": "멘토", "writing tutor": "글쓰기 튜터", "lifestyle coach": "라이프스타일 코치",
    "reality tv star": "리얼리티 TV 스타", "radio host": "라디오 진행자", "political activist": "정치 활동가",
}

PROMPT = """다음은 TTS 음성 디자인용 목소리 설명(영어)입니다. 각 항목을 자연스러운 한국어 한 문장으로 번역하세요.
규칙:
- 목소리의 성격·톤·말투·상황을 묘사하는 문장으로 쓰세요 (예: "느긋하고 격려하는 듯한 편안한 말투").
- 억양/지역/성별/역할 정보가 들어 있으면 그대로 한국어로 옮기세요 (Chungcheong → 충청도, Gyeongsang/Busan → 경상도/부산, Jeolla → 전라도, Gangwon → 강원도, Seoul → 서울, Kyopo → 교포).
- "[not specified]", 밑줄(_) 같은 데이터 표기는 자연스럽게 정리하세요.
- 입력과 같은 순서로, 같은 개수의 문자열을 담은 JSON 배열만 출력하세요.

입력:
{items}"""


def main() -> None:
    voices = json.loads(DATA.read_text(encoding="utf-8"))
    cache: dict[str, str] = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    todo = sorted({v["description"] for v in voices if v["description"] and v["description"] not in cache})
    print(f"{len(cache)} cached, {len(todo)} to translate with {MODEL}")

    if todo:
        client = genai.Client(enterprise=True, project=os.environ["PROJECT_ID"], location="global")
        for i in range(0, len(todo), BATCH):
            chunk = todo[i:i + BATCH]
            for attempt in range(6):
                try:
                    res = client.models.generate_content(
                        model=MODEL,
                        contents=PROMPT.format(items=json.dumps(chunk, ensure_ascii=False, indent=0)),
                        config={"response_mime_type": "application/json", "temperature": 0.2},
                    )
                    break
                except Exception as e:  # 429 TPM quota / transient 5xx
                    if attempt == 5:
                        raise
                    wait = 20 * (attempt + 1)
                    print(f"  retry in {wait}s: {str(e)[:80]}", flush=True)
                    time.sleep(wait)
            out = json.loads(res.text)
            if len(out) != len(chunk):
                raise SystemExit(f"batch {i}: got {len(out)} translations for {len(chunk)} items")
            cache.update(dict(zip(chunk, out)))
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"  translated {min(i + BATCH, len(todo))}/{len(todo)}", flush=True)

    missing_roles = sorted({v["role"] for v in voices if v["role"] and v["role"].lower() not in ROLE_KO})
    if missing_roles:
        print("WARN roles without Korean name:", missing_roles)
    for v in voices:
        v["role_ko"] = ROLE_KO.get(v["role"].lower(), v["role"]) if v["role"] else ""
        v["description_ko"] = cache.get(v["description"], "")
    DATA.write_text(json.dumps(voices, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"updated {DATA.relative_to(ROOT)} ({len(voices)} templates)")


if __name__ == "__main__":
    main()
