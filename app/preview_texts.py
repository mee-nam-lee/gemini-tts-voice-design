"""Per-voice Korean preview scripts for the 117 ko-KR Extended Voice Library voices.

Each voice gets:
  - text : a Korean sentence matching its role (persona). Busan voices read Busan dialect.
  - style: the voice's own tone description from the API (passed as speech_metadata.style).
Roles with several voices rotate through variants so previews don't all sound identical.
Used by scripts/pregenerate_previews.py.
"""

from __future__ import annotations

import re

SEOUL: dict[str, list[str]] = {
    "nature documentary narrator": [
        "새벽 안개가 걷히자, 숲은 서서히 깨어나기 시작합니다. 생명의 하루가 다시 시작되는 순간입니다.",
        "끝없이 펼쳐진 갯벌 위로 수천 마리의 철새가 내려앉습니다. 이들의 긴 여정은 이제 막 절반을 지났습니다.",
        "깊은 바닷속, 햇빛이 닿지 않는 이곳에도 생명은 놀라운 방식으로 살아가고 있습니다.",
        "가을이 오면 이 계곡의 단풍나무들은 겨울을 준비하며 저마다의 색으로 물들어 갑니다.",
    ],
    "instructional video host": [
        "자, 오늘은 아주 간단한 방법을 알려 드릴게요. 첫 번째 단계부터 차근차근 따라와 주세요.",
        "이 설정 메뉴에서 오른쪽 위 버튼을 누르면 됩니다. 어렵지 않죠? 바로 다음 단계로 넘어가 볼게요.",
        "준비물은 딱 세 가지예요. 영상 끝까지 보시면 누구나 쉽게 완성하실 수 있습니다.",
    ],
    "lawyer": [
        "계약서에 서명하시기 전에 이 조항은 반드시 확인하셔야 합니다. 나중에 분쟁의 소지가 될 수 있어요.",
        "현재 상황에서는 합의를 먼저 시도해 보시는 것이 시간과 비용 면에서 유리합니다.",
        "말씀하신 내용을 정리해 보면, 법적으로 충분히 다퉈 볼 여지가 있는 사안입니다.",
    ],
    "tour guide": [
        "여러분, 이쪽을 봐 주세요. 이곳은 조선 시대에 지어진 궁궐로, 지금부터 함께 천천히 둘러보겠습니다.",
        "오른쪽 창밖으로 보이는 산이 바로 북한산입니다. 사진 찍기 좋은 명소이니 놓치지 마세요.",
        "이 골목은 백 년 넘은 한옥들이 모여 있는 곳이에요. 다음 코스까지는 걸어서 오 분 정도 걸립니다.",
    ],
    "journalist": [
        "오늘 오전, 서울 도심에서 대규모 문화 축제가 열려 수많은 시민들이 현장을 찾았습니다.",
        "정부는 내년부터 청년 주거 지원 정책을 대폭 확대한다고 밝혔습니다. 자세한 내용 전해 드립니다.",
        "이번 주말 전국에 강한 비가 예보되면서, 기상청은 시설물 관리에 각별히 유의해 달라고 당부했습니다.",
    ],
    "fashion consultant": [
        "이 재킷은 어깨선이 자연스러워서 청바지에도, 슬랙스에도 잘 어울려요.",
        "올가을에는 차분한 브라운 톤이 대세예요. 니트 하나만 바꿔도 분위기가 확 달라지죠.",
        "체형을 보완하려면 상의는 조금 짧게, 하의는 하이웨이스트로 맞춰 보세요.",
    ],
    "architect": [
        "이 건물은 자연광이 깊숙이 들어오도록 남쪽 면 전체를 유리로 설계했습니다.",
        "거실과 주방 사이 벽을 없애면 공간이 훨씬 넓고 개방감 있게 느껴질 거예요.",
        "외장재는 지역에서 나는 석재를 사용해서 주변 풍경과 자연스럽게 어우러지도록 했습니다.",
    ],
    "social worker": [
        "많이 힘드셨겠어요. 천천히 말씀해 주세요. 저희가 도와드릴 수 있는 방법을 함께 찾아볼게요.",
        "신청 서류는 제가 같이 확인해 드릴게요. 혼자 걱정하지 않으셔도 괜찮습니다.",
        "다음 주에 다시 한번 방문드려서 지내시는 데 불편한 점은 없는지 살펴볼게요.",
    ],
    "sales associate": [
        "이 제품은 이번 시즌 신상품인데요, 지금 구매하시면 사은품도 함께 챙겨 드려요.",
        "찾으시는 사이즈 창고에 있는지 바로 확인해 드릴게요. 잠시만 기다려 주세요.",
    ],
    "sibling": ["야, 내 충전기 또 가져갔지? 다 쓰면 제자리에 좀 갖다 놔.",
                "엄마가 저녁에 다 같이 밥 먹자는데, 너 오늘 몇 시에 들어와?"],
    "dating coach": ["첫 만남에서는 너무 많은 걸 보여주려 하지 마세요. 상대의 이야기에 진심으로 귀 기울이는 게 핵심이에요.",
                     "답장이 늦는다고 너무 조급해하지 마세요. 여유 있는 모습이 오히려 더 매력적이랍니다."],
    "executive assistant": ["대표님, 오후 두 시 회의가 세 시로 변경되었습니다. 자료는 메일로 보내 드렸어요.",
                            "내일 오전 출장 항공권과 호텔 예약 모두 확정되었습니다."],
    "nutritionist": ["아침 식사는 꼭 챙기시고, 단백질과 채소를 골고루 드시는 게 중요해요.",
                     "간식이 당길 때는 과자 대신 견과류 한 줌을 드셔 보세요."],
    "aunt/uncle": ["어머, 우리 조카 많이 컸네! 이번 방학에는 이모랑 맛있는 거 먹으러 가자.",
                   "삼촌이 어릴 때는 말이야, 이 동네가 전부 논밭이었어."],
    "best friend": ["야, 나 오늘 진짜 대박 소식 있어. 일단 앉아 봐, 놀라지 말고 들어.",
                    "괜찮아, 너 진짜 잘하고 있어. 오늘은 맛있는 거 먹고 푹 쉬자."],
    "cooking show host": ["팬이 충분히 달궈지면 마늘을 먼저 넣어 주세요. 이 향이 바로 맛의 비결이에요.",
                          "자, 완성된 요리를 접시에 담아 볼게요. 색감까지 정말 먹음직스럽죠?"],
    "counselor": ["그런 감정이 드는 건 아주 자연스러운 일이에요. 지금 어떤 마음이 드는지 조금 더 이야기해 볼까요?",
                  "오늘 여기까지 오신 것만으로도 큰 용기를 내신 거예요."],
    "music teacher": ["자, 이번에는 손목에 힘을 빼고 다시 한번 쳐 볼까요? 리듬을 천천히 느껴 보세요.",
                      "좋아요, 방금 그 부분 정말 좋았어요. 이번엔 조금 더 부드럽게 이어 볼까요?"],
    "parent": ["얘들아, 밥 먹자! 손 씻고 와서 따뜻할 때 얼른 먹어.",
               "오늘 학교에서 재밌는 일 있었어? 엄마한테 얘기해 줘."],
    "educational tutor": ["이 문제는 공식을 외우기보다 원리를 이해하는 게 중요해요. 같이 한 단계씩 풀어 볼까요?"],
    "friend": ["이번 주말에 뭐 해? 시간 되면 새로 생긴 카페 같이 가 보자."],
    "influencer": ["여러분 안녕! 오늘은 제가 요즘 푹 빠진 꿀템을 소개해 드릴게요. 끝까지 봐 주세요!"],
    "podcast interviewer": ["오늘 귀한 게스트를 모셨습니다. 먼저 청취자분들께 간단히 자기소개 부탁드릴게요."],
    "radio host": ["여러분의 퇴근길을 함께하는 저녁 라디오, 오늘도 따뜻한 사연과 음악으로 찾아왔습니다."],
    "tech support agent / tech advisor": ["불편을 드려 죄송합니다. 먼저 공유기 전원을 껐다가 삼십 초 후에 다시 켜 주시겠어요?"],
    "customer service agent": ["고객님, 문의해 주셔서 감사합니다. 주문하신 상품은 내일 오후까지 도착할 예정입니다."],
    "writing tutor": ["이 문단은 주장은 좋은데, 근거를 한 가지만 더 추가하면 훨씬 설득력이 생길 거예요."],
}

# Busan voices: Busan / Gyeongsang dialect scripts.
BUSAN: dict[str, list[str]] = {
    "sibling": [
        "니 내 충전기 또 갖고 갔제? 다 썼으면 제자리에 좀 갖다 놔라.",
        "엄마가 저녁에 다 같이 밥 묵자 카던데, 니 오늘 몇 시에 들어오노?",
        "아이고, 니 또 늦잠 잤나? 빨리 씻고 나온나, 늦겠다.",
    ],
    "influencer": [
        "여러분 안녕하세요! 오늘은 부산 해운대 맛집 소개해 드릴게예. 진짜 억수로 맛있습니더!",
        "이거 요즘 제가 매일 쓰는 건데예, 함 써 보이소. 완전 강추합니더!",
        "오늘 광안리 야경 보러 왔는데, 와, 진짜 직이네예. 같이 구경하입시더!",
    ],
    "tech support agent / tech advisor": [
        "불편 드려가 죄송합니더. 먼저 공유기 전원을 껐다가 삼십 초 뒤에 다시 켜 보이소.",
        "화면 오른쪽 위에 설정 버튼 보이지예? 그거 한번 눌러 보시겠습니꺼?",
    ],
    "architect": ["이 건물은예, 바다 쪽으로 창을 크게 내가 어디서든 바다가 보이도록 설계했습니더."],
    "customer service agent": ["고객님, 연락 주셔서 고맙습니더. 주문하신 물건은 내일 오후까지 도착할 겁니더."],
    "executive assistant": ["대표님, 오후 두 시 회의가 세 시로 바뀌었습니더. 자료는 메일로 보내 드렸어예."],
    "nutritionist": ["아침은 꼭 챙겨 드시고예, 단백질하고 채소를 골고루 드시는 게 제일 중요합니더."],
    "radio host": ["부산의 저녁을 함께하는 라디오, 오늘도 따뜻한 사연하고 노래로 찾아왔습니더."],
    "writing tutor": ["이 문단은 주장은 좋은데예, 근거를 하나만 더 넣으면 훨씬 설득력 있을 깁니더."],
}

DEFAULT_SEOUL = "안녕하세요. 오늘 하루는 어떠셨나요? 제 목소리로 여러분께 이야기를 들려드릴게요."
DEFAULT_BUSAN = "안녕하십니꺼. 오늘 하루는 우째 보내셨습니꺼? 제 목소리로 이야기 하나 들려드릴게예."


def role_of(voice: dict) -> str:
    """'Storyteller & Narrator (Nature Documentary Narrator)' -> 'nature documentary narrator'."""
    persona = voice.get("persona") or ""
    m = re.search(r"\(([^)]+)\)\s*$", persona)
    return (m.group(1) if m else persona).strip().lower()


def style_of(voice: dict) -> str:
    """Tone part of the API description, e.g. 'Voice is light, airy, and precise'."""
    tail = re.sub(r"^.*?Speaks [A-Za-z ]+?\.\s*", "", voice.get("description") or "").strip()
    return tail.rstrip(".")


def build_scripts(voices: list[dict]) -> dict[str, dict]:
    """voice_id -> {text, style, role}. Deterministic: variants rotate by order within role+accent."""
    counters: dict[tuple[str, str], int] = {}
    out: dict[str, dict] = {}
    for v in sorted(voices, key=lambda x: x["id"]):
        busan = v.get("accent") == "Busan Korean"
        role = role_of(v)
        pool = (BUSAN if busan else SEOUL).get(role) or [DEFAULT_BUSAN if busan else DEFAULT_SEOUL]
        key = (v.get("accent", ""), role)
        i = counters.get(key, 0)
        counters[key] = i + 1
        out[v["id"]] = {"text": pool[i % len(pool)], "style": style_of(v), "role": role}
    return out
