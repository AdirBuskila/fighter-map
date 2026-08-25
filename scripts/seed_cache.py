#!/usr/bin/env python3
"""
Write normalisation results straight into 02_normalize.py's cache.

The Phase 2 cache is keyed by (prompt version, model, cell text), so anything
written here is indistinguishable from a live API response: 02_normalize.py
will find it, skip the call, and produce the same output. Two uses:

  * seed the pipeline without an ANTHROPIC_API_KEY at all
  * pin a hand-corrected result so a rerun stops getting it wrong

Input is JSON Lines, one cell per line:

    {"text": "<the raw cell, byte-identical to raw_rows.json>",
     "places": [ {...place object...}, ... ]}

Usage:
    python scripts/seed_cache.py data/handoff.jsonl
    python scripts/seed_cache.py data/handoff.jsonl --model claude-sonnet-4-6
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from importlib.machinery import SourceFileLoader

_norm = SourceFileLoader("_norm", str(Path(__file__).resolve().parent / "02_normalize.py")).load_module()

REQUIRED = set(_norm.PLACE_SCHEMA["required"])


def validate(place: dict, line_no: int) -> None:
    missing = REQUIRED - set(place)
    if missing:
        sys.exit("line %d: place is missing %s" % (line_no, ", ".join(sorted(missing))))
    if place["kind"] not in _norm.KINDS:
        sys.exit("line %d: bad kind %r" % (line_no, place["kind"]))
    if place["category"] not in _norm.CATEGORIES:
        sys.exit("line %d: bad category %r" % (line_no, place["category"]))
    if place["status"] not in ("works", "reported_not_working"):
        sys.exit("line %d: bad status %r" % (line_no, place["status"]))
    if not 0.0 <= float(place["confidence"]) <= 1.0:
        sys.exit("line %d: confidence out of range" % line_no)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("jsonl", type=Path)
    ap.add_argument("--model", default=_norm.DEFAULT_MODEL)
    ap.add_argument("--cache", type=Path, default=_norm.CACHE_PATH)
    ap.add_argument("--raw", type=Path, default=_norm.IN_PATH,
                    help="raw_rows.json, used to check the cell text really exists")
    args = ap.parse_args()

    known = set()
    if args.raw.exists():
        for row in json.loads(args.raw.read_text(encoding="utf-8")):
            for field in ("fighter_card", "vacation_voucher"):
                if row.get(field):
                    known.add(row[field].strip())

    cache = _norm.load_cache(args.cache)
    added = unknown = 0
    for line_no, line in enumerate(args.jsonl.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        entry = json.loads(line)
        text = entry["text"].strip()
        if known and text not in known:
            print("  line %d: no such cell in raw_rows.json: %r" % (line_no, text[:60]),
                  file=sys.stderr)
            unknown += 1
            continue
        for place in entry["places"]:
            validate(place, line_no)
        cache[_norm.cache_key(args.model, text)] = entry["places"]
        added += 1

    _norm.save_cache(args.cache, cache)
    print("seeded %d cells (%d unmatched) -> %s" % (added, unknown, args.cache))
    print("cache now holds %d entries" % len(cache))


if __name__ == "__main__":
    main()
