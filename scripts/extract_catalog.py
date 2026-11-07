"""Extract the Korean voice catalog into data/korean_voices.json.

Source: the `const RAW_DATA = [...]` array embedded in korean_voice_catalog.html.
This script makes NO TTS / Gemini API calls - it only downloads and reshapes JSON.

Usage:
    CATALOG_URL=https://.../korean_voice_catalog.html uv run python scripts/extract_catalog.py
    uv run python scripts/extract_catalog.py --html local_copy.html
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from collections import Counter
from pathlib import Path

CATALOG_URL = os.environ.get("CATALOG_URL", "")  # URL of korean_voice_catalog.html (or use --html)
ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "data" / "korean_voices.json"

# Fields kept from RAW_DATA. Google Drive URLs are dropped on purpose:
# previews are pre-generated into our own GCS bucket instead.
KEEP = ("voice_id", "language", "accent", "gender", "role", "age", "description")


def normalize_role(role: str) -> str:
    """'tech_support_agent' -> 'tech support agent', '[not specified]' -> ''."""
    role = (role or "").strip().replace("_", " ")
    return "" if role.lower() in {"[not specified]", "not specified"} else role


def load_html(html_path: str | None) -> str:
    if html_path:
        return Path(html_path).read_text(encoding="utf-8")
    if not CATALOG_URL:
        raise SystemExit("Set CATALOG_URL or pass --html <file>")
    with urllib.request.urlopen(CATALOG_URL, timeout=60) as resp:
        return resp.read().decode("utf-8")


def extract(html: str) -> list[dict]:
    m = re.search(r"const\s+RAW_DATA\s*=\s*(\[.*?\]);", html, re.S)
    if not m:
        raise SystemExit("RAW_DATA array not found in catalog HTML")
    raw = json.loads(m.group(1))

    seen: set[str] = set()
    voices: list[dict] = []
    for item in raw:
        vid = (item.get("voice_id") or "").strip()
        if not vid or vid in seen:
            continue
        seen.add(vid)
        v = {k: (item.get(k) or "").strip() for k in KEEP}
        v["role"] = normalize_role(v["role"])
        v["language"] = v["language"] or "ko-KR"
        voices.append(v)
    voices.sort(key=lambda v: (v["accent"], v["role"], v["gender"], v["voice_id"]))
    return voices, len(raw)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--html", help="Local catalog HTML file instead of downloading")
    args = ap.parse_args()

    voices, raw_count = extract(load_html(args.html))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(voices, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"RAW_DATA entries : {raw_count}")
    print(f"Unique voices    : {len(voices)}  -> {OUT_PATH.relative_to(ROOT)}")
    print(f"Languages        : {dict(Counter(v['language'] for v in voices))}")
    print(f"Accents          : {dict(Counter(v['accent'] for v in voices).most_common())}")
    print(f"Genders          : {dict(Counter(v['gender'] for v in voices).most_common())}")
    print(f"Roles ({len({v['role'] for v in voices})})       : "
          f"{dict(Counter(v['role'] or '(none)' for v in voices).most_common())}")


if __name__ == "__main__":
    sys.exit(main())
