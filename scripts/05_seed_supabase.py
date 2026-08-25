#!/usr/bin/env python3
"""
Phase 3b - load the pipeline output into Supabase.

Upserts on places.source_key, so running this again after re-geocoding updates
the pins and addresses in place rather than duplicating anything, and never
touches confirm_count, report_count or last_confirmed_at: those belong to the
people using the site, not to the import.

    data/places.json        -> status 'published'
    data/needs_review.json  -> status 'pending', with review_reason set

Usage:
    export NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=...
    python scripts/05_seed_supabase.py
    python scripts/05_seed_supabase.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
PLACES_PATH = ROOT / "data" / "places.json"
REVIEW_PATH = ROOT / "data" / "needs_review.json"

BATCH = 250

# Columns the import owns. Anything not listed here is left to the site: the
# trust counters, the timestamps people generate, the moderator's decisions.
COLUMNS = [
    "source_key", "google_place_id", "name_he", "name_en", "category",
    "is_chain", "is_online", "location", "address_he", "city", "phone", "url",
    "benefit_fighter_card", "benefit_vacation_voucher", "note_he", "source",
    "status", "review_reason", "first_reported_at",
]


def source_key(place: dict) -> str:
    if place.get("google_place_id"):
        return place["google_place_id"]
    prefix = "chain" if place.get("is_chain") else "online" if place.get("is_online") else "unlocated"
    slug = re.sub(r"\s+", " ", place["name_he"]).strip().lower()
    city = (place.get("city") or "").strip().lower()
    return f"{prefix}:{slug}" + (f"@{city}" if city else "")


def to_row(place: dict, status: str) -> dict:
    lat, lng = place.get("lat"), place.get("lng")
    location = None
    if lat is not None and lng is not None and not (place.get("is_chain") or place.get("is_online")):
        location = f"SRID=4326;POINT({lng} {lat})"

    return {
        "source_key": source_key(place),
        "google_place_id": place.get("google_place_id"),
        "name_he": place["name_he"][:160],
        "name_en": place.get("name_en"),
        "category": place["category"],
        "is_chain": bool(place.get("is_chain")),
        "is_online": bool(place.get("is_online")),
        "location": location,
        "address_he": place.get("address_he"),
        "city": place.get("city"),
        "phone": place.get("phone"),
        "url": place.get("url"),
        "benefit_fighter_card": bool(place.get("benefit_fighter_card")),
        "benefit_vacation_voucher": bool(place.get("benefit_vacation_voucher")),
        "note_he": place.get("note_he"),
        "source": "pdf_import",
        "status": status,
        "review_reason": place.get("review_reason") or (
            "low_confidence" if status == "pending" and not place.get("review_reason") else None
        ),
        "first_reported_at": place.get("first_reported_at"),
    }


def publishable(row: dict) -> bool:
    """The database rejects a published physical place with no pin, so catch it
    here with a message that says which row and why."""
    if row["status"] != "published":
        return True
    return bool(row["is_chain"] or row["is_online"] or row["location"])


def upsert(url: str, key: str, rows: list, dry_run: bool) -> int:
    endpoint = f"{url.rstrip('/')}/rest/v1/places?on_conflict=source_key"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        # merge-duplicates makes this an upsert; ignore-duplicates would skip
        # updates and the geocode refresh would never land.
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    written = 0
    for start in range(0, len(rows), BATCH):
        chunk = rows[start : start + BATCH]
        if dry_run:
            written += len(chunk)
            continue
        response = requests.post(endpoint, headers=headers, json=chunk, timeout=60)
        if response.status_code >= 300:
            print("  batch at %d failed: %s %s"
                  % (start, response.status_code, response.text[:400]), file=sys.stderr)
            continue
        written += len(chunk)
        print("  %d/%d" % (min(start + BATCH, len(rows)), len(rows)))
    return written


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Load places into Supabase")
    ap.add_argument("--places", type=Path, default=PLACES_PATH)
    ap.add_argument("--review", type=Path, default=REVIEW_PATH)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not (url and key) and not args.dry_run:
        sys.exit(
            "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, "
            "or pass --dry-run to check the payload without writing."
        )

    if not args.places.exists():
        sys.exit(
            f"{args.places} does not exist. Run scripts/03_geocode.py first "
            "(it turns normalized.json into places.json)."
        )

    published = [to_row(p, "published") for p in json.loads(args.places.read_text(encoding="utf-8"))]
    pending = []
    if args.review.exists():
        pending = [to_row(p, "pending") for p in json.loads(args.review.read_text(encoding="utf-8"))]

    # A source_key can appear in both files if the geocoder was re-run with a
    # different threshold. The published copy wins.
    published_keys = {row["source_key"] for row in published}
    pending = [row for row in pending if row["source_key"] not in published_keys]

    rejected = [row for row in published if not publishable(row)]
    if rejected:
        print("moving %d rows without a pin to the review queue:" % len(rejected))
        for row in rejected[:10]:
            print("   %s" % row["name_he"])
        for row in rejected:
            row["status"] = "pending"
            row["review_reason"] = row["review_reason"] or "not_geocoded"
        pending += rejected
        published = [row for row in published if publishable(row)]

    rows = [{k: row.get(k) for k in COLUMNS} for row in published + pending]

    print("%d published, %d pending, %d total" % (len(published), len(pending), len(rows)))
    if args.dry_run:
        print("\ndry run, nothing written. sample row:")
        print(json.dumps(rows[0], ensure_ascii=False, indent=2))
        return

    written = upsert(url, key, rows, args.dry_run)
    print("\nupserted %d of %d rows" % (written, len(rows)))
    print("check the map at http://localhost:3000")


if __name__ == "__main__":
    main()
