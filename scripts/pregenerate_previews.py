"""Pre-generate preview audio for the 117 ko-KR library voices and upload to GCS.

!! Calls Gemini TTS (billed). Without --yes it only prints the plan.

Each voice reads its own script from app/preview_texts.py (role-matched text,
Busan dialect for Busan voices, the voice's tone description as style) with
gemini-3.8-flash-tts. Output: gs://$GCS_BUCKET/catalog/{voice_id}.wav
Existing objects are skipped, so re-running resumes / retries failures.
The full plan is also written to data/preview_scripts.json for review.

Usage:
    uv run python scripts/pregenerate_previews.py                 # plan only
    uv run python scripts/pregenerate_previews.py --limit 3 --yes
    uv run python scripts/pregenerate_previews.py --yes
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.preview_texts import build_scripts  # noqa: E402

load_dotenv(ROOT / ".env")
MODEL = "gemini-3.8-flash-tts"
PREFIX = "catalog/"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--yes", action="store_true", help="Actually call TTS and upload (billed)")
    ap.add_argument("--limit", type=int, default=0, help="Max voices to generate this run")
    ap.add_argument("--only", nargs="*", help="Only these voice IDs")
    ap.add_argument("--force", action="store_true", help="Regenerate even if the object exists")
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--retries", type=int, default=5)
    args = ap.parse_args()

    voices = json.loads((ROOT / "data" / "korean_library_voices.json").read_text(encoding="utf-8"))
    scripts = build_scripts(voices)
    (ROOT / "data" / "preview_scripts.json").write_text(
        json.dumps(scripts, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    ids = [v["id"] for v in voices if not args.only or v["id"] in args.only]

    if not args.yes:
        for vid in ids[: args.limit or len(ids)]:
            s = scripts[vid]
            print(f"{vid:<26} [{s['role']}] style='{s['style']}'\n    {s['text']}")
        print(f"\n{len(ids)} voices. Plan saved to data/preview_scripts.json. Re-run with --yes to generate.")
        return

    project, bucket_name = os.environ.get("PROJECT_ID"), os.environ.get("GCS_BUCKET")
    if not project or not bucket_name:
        sys.exit("PROJECT_ID and GCS_BUCKET must be set in .env")

    from google import genai
    from google.cloud import storage

    from app.main import ensure_wav

    client = genai.Client(enterprise=True, project=project, location="global")
    bucket = storage.Client(project=project).bucket(bucket_name)

    existing = set() if args.force else {
        b.name[len(PREFIX):-4] for b in bucket.list_blobs(prefix=PREFIX) if b.name.endswith(".wav")
    }
    todo = [vid for vid in ids if vid not in existing]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(existing)} already in gs://{bucket_name}/{PREFIX}, generating {len(todo)}", flush=True)

    def work(vid: str) -> str:
        s = scripts[vid]
        part = {"text": s["text"]}
        if s["style"]:
            part["speech_metadata"] = {"style": s["style"]}
        for attempt in range(args.retries):
            try:
                res = client.models.generate_content(
                    model=MODEL,
                    contents=[{"role": "user", "parts": [part]}],
                    config={
                        "response_modalities": ["AUDIO"],
                        "speech_config": {"voice_config": {"voice": vid}},
                    },
                )
                inline = res.candidates[0].content.parts[0].inline_data
                blob = bucket.blob(f"{PREFIX}{vid}.wav")
                # GCS custom metadata must be ASCII-safe in headers; store the script JSON-escaped.
                blob.metadata = {"model": MODEL, "script": json.dumps(s)}
                blob.upload_from_string(ensure_wav(inline.data, inline.mime_type), content_type="audio/wav")
                return "ok"
            except Exception as e:  # retry 429 / 5xx with backoff
                if attempt == args.retries - 1:
                    return f"FAILED: {e}"
                time.sleep(min(60, 2**attempt + random.random()))
        return "FAILED"

    ok = fail = 0
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {pool.submit(work, vid): vid for vid in todo}
        for i, fut in enumerate(as_completed(futures), 1):
            status = fut.result()
            ok, fail = (ok + 1, fail) if status == "ok" else (ok, fail + 1)
            print(f"[{i}/{len(todo)}] {futures[fut]}: {status}", flush=True)
    print(f"\nDone. ok={ok} failed={fail}. Re-run to retry failures (existing files are skipped).")


if __name__ == "__main__":
    main()
