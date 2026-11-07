"""List Korean voices in the Extended Voice Library via the Voices API (read-only).

No TTS / audio generation - only `voices.list`. Writes:
  data/korean_library_voices.json  (all fields returned by the API)
  data/korean_library_voices.csv   (id, accent, gender, pitch, persona, description)

Usage:
    uv run python scripts/list_korean_library.py [--project PROJECT_ID]
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv
from google import genai

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
FIELDS = ("id", "display_name", "language_code", "accent", "gender", "pitch", "persona", "description")


def to_dict(v) -> dict:
    if hasattr(v, "model_dump"):
        d = v.model_dump(exclude_none=True)
    else:
        d = dict(v)
    d.pop("sample_audio", None)
    return d


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default=os.environ.get("PROJECT_ID"))
    ap.add_argument("--language", default="ko-KR")
    args = ap.parse_args()
    project = args.project or subprocess.run(
        ["gcloud", "config", "get-value", "project"], capture_output=True, text=True
    ).stdout.strip()

    client = genai.Client(enterprise=True, project=project, location="global")
    voices, token = [], None
    while True:
        # Server-side metadata filters (language_code, accent...) return
        # "not supported in this environment", so list all and filter locally.
        res = client.voices.list(type_=["prebuilt"], page_size=500, page_token=token)
        voices += [to_dict(v) for v in (res.voices or [])]
        token = getattr(res, "next_page_token", None)
        if not token:
            break

    voices = [v for v in voices if str(v.get("language_code", "")).startswith(args.language.split("-")[0])]
    out = ROOT / "data"
    (out / "korean_library_voices.json").write_text(json.dumps(voices, ensure_ascii=False, indent=1), encoding="utf-8")
    with open(out / "korean_library_voices.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(voices)

    print(f"project={project}  voices={len(voices)}")
    for k in ("accent", "gender", "pitch", "persona"):
        print(f"{k:8}: {dict(Counter(str(v.get(k, '')) for v in voices).most_common(30))}")


if __name__ == "__main__":
    main()
