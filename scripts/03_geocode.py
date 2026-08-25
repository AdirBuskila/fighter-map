#!/usr/bin/env python3
"""
Phase 3 - resolve single locations to a Google place_id and seed the database.

Only `kind: single_location` is geocoded. A chain is stored once as a brand and
the app resolves nearby branches live from the user's position; an online-only
service has no coordinates at all.

The Google place_id is the permanent key. Latitude, longitude and the formatted
address are a refreshable cache: Google is allowed to move a pin or restyle an
address, and re-running this script picks that up without changing identity.

Cost control:
  * a field mask so each Text Search bills the cheapest tier that carries
    location, and nothing more
  * every response cached in data/geocode_cache.json keyed by the query string,
    so a rerun after a crash or a threshold change costs nothing
  * 10 requests per second, exponential backoff on 429 and 5xx

Anything whose returned displayName is less than --min-confidence similar to the
query goes to the review queue instead of being published: a wrong pin on a map
is worse than a missing one.

Output:
    data/places.json        ready to load into Postgres
    data/needs_review.json  appended to, not overwritten

Usage:
    export GOOGLE_MAPS_SERVER_KEY=...
    python scripts/03_geocode.py
    python scripts/03_geocode.py --limit 20 --verbose
    python scripts/03_geocode.py --offline      # cache only, no API calls
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

import requests
from importlib.machinery import SourceFileLoader
from rapidfuzz import fuzz

ROOT = Path(__file__).resolve().parent.parent
IN_PATH = ROOT / "data" / "normalized.json"
OUT_PATH = ROOT / "data" / "places.json"
REVIEW_PATH = ROOT / "data" / "needs_review.json"
CACHE_PATH = ROOT / "data" / "geocode_cache.json"

ENDPOINT = "https://places.googleapis.com/v1/places:searchText"

# Field masks control the billing tier. Everything here is Essentials or Pro;
# adding reviews, opening hours or photos would jump a tier per request.
FIELD_MASK = ",".join(
    [
        "places.id",
        "places.displayName",
        "places.location",
        "places.formattedAddress",
        "places.types",
        "places.primaryType",
    ]
)

# A rectangle around Israel, used as a bias rather than a hard restriction so a
# place just over a boundary still resolves.
ISRAEL_BIAS = {
    "rectangle": {
        "low": {"latitude": 29.45, "longitude": 34.20},
        "high": {"latitude": 33.35, "longitude": 35.95},
    }
}

RATE_LIMIT_PER_SEC = 10
MIN_MATCH_CONFIDENCE = 0.75


# ------------------------------------------------------------------ matching


# Reuse Phase 2's name folding so both stages agree on what "the same name" means.
_norm = SourceFileLoader("_norm", str(ROOT / "scripts" / "02_normalize.py")).load_module()
canon = _norm.canon


def match_confidence(query: str, display_name: str) -> float:
    """How well does what we asked for match what Google returned?"""
    a, b = canon(query), canon(display_name)
    if not a or not b:
        return 0.0
    return max(fuzz.token_set_ratio(a, b), fuzz.partial_ratio(a, b)) / 100.0


def build_query(place: dict) -> str:
    parts = [place["name_he"]]
    if place.get("city"):
        parts.append(place["city"])
    return " ".join(parts)


# --------------------------------------------------------------------- http


class Geocoder:
    def __init__(self, api_key: str, cache: dict, cache_path: Path, offline: bool):
        self.key = api_key
        self.cache = cache
        self.cache_path = cache_path
        self.offline = offline
        self.session = requests.Session()
        self.last_call = 0.0
        self.calls = 0

    def _throttle(self) -> None:
        gap = 1.0 / RATE_LIMIT_PER_SEC
        wait = gap - (time.monotonic() - self.last_call)
        if wait > 0:
            time.sleep(wait)
        self.last_call = time.monotonic()

    def search(self, query: str) -> dict | None:
        """Return the raw Google response for a query, cached forever."""
        if query in self.cache:
            return self.cache[query]
        if self.offline:
            return None

        body = {
            "textQuery": query,
            "languageCode": "he",
            "regionCode": "IL",
            "locationBias": ISRAEL_BIAS,
            "maxResultCount": 3,
        }
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.key,
            "X-Goog-FieldMask": FIELD_MASK,
        }

        for attempt in range(5):
            self._throttle()
            try:
                r = self.session.post(ENDPOINT, json=body, headers=headers, timeout=20)
            except requests.RequestException as exc:
                if attempt == 4:
                    print("  network error on %r: %s" % (query, exc), file=sys.stderr)
                    return None
                time.sleep(2**attempt + random.random())
                continue

            self.calls += 1
            if r.status_code == 200:
                data = r.json()
                self.cache[query] = data
                self.save()
                return data
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2**attempt + random.random())
                continue
            print("  %d on %r: %s" % (r.status_code, query, r.text[:200]), file=sys.stderr)
            return None

        print("  gave up on %r after 5 attempts" % query, file=sys.stderr)
        return None

    def save(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.cache_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.cache, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.cache_path)


# --------------------------------------------------------------------- main


def resolve(place: dict, geocoder: Geocoder, min_conf: float) -> tuple:
    """Return (record, reason). reason is None when the place is publishable."""
    query = build_query(place)
    data = geocoder.search(query)
    if data is None:
        return place, "not_geocoded"
    results = data.get("places") or []
    if not results:
        return place, "no_google_result"

    city = place.get("city")
    best, best_conf = None, 0.0
    for cand in results:
        name = (cand.get("displayName") or {}).get("text", "")
        address = cand.get("formattedAddress") or ""
        # Google answers in Hebrew, but a brand may come back in Latin, so give
        # the Latin spelling a chance too.
        conf = match_confidence(query, name)
        if place.get("name_en"):
            conf = max(conf, match_confidence(place["name_en"], name))
        # partial_ratio scores "לחם בשר" against "לחם בשר ירושלים" as perfect, so
        # a branch in the wrong city would sail through. Make the address agree.
        if city and canon(city) not in canon(address):
            conf *= 0.6
        if conf > best_conf:
            best, best_conf = cand, conf

    if best is None:
        return place, "no_google_result"

    out = dict(place)
    out["google_place_id"] = best["id"]
    out["name_google"] = (best.get("displayName") or {}).get("text")
    out["lat"] = best["location"]["latitude"]
    out["lng"] = best["location"]["longitude"]
    out["address_he"] = best.get("formattedAddress")
    out["google_types"] = best.get("types", [])
    out["google_primary_type"] = best.get("primaryType")
    out["match_confidence"] = round(best_conf, 3)
    out["geocode_query"] = query

    if best_conf < min_conf:
        return out, "low_match_confidence"
    return out, None


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Geocode single locations via Places API (New)")
    ap.add_argument("--in", dest="src", type=Path, default=IN_PATH)
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    ap.add_argument("--review", type=Path, default=REVIEW_PATH)
    ap.add_argument("--cache", type=Path, default=CACHE_PATH)
    ap.add_argument("--min-confidence", type=float, default=MIN_MATCH_CONFIDENCE)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    key = os.environ.get("GOOGLE_MAPS_SERVER_KEY", "")
    if not key and not args.offline:
        sys.exit(
            "GOOGLE_MAPS_SERVER_KEY is not set.\n"
            "Set it and rerun, or use --offline to work from the cache."
        )

    places = json.loads(args.src.read_text(encoding="utf-8"))
    cache = {}
    if args.cache.exists():
        cache = json.loads(args.cache.read_text(encoding="utf-8"))
    geocoder = Geocoder(key, cache, args.cache, args.offline)

    to_locate = [p for p in places if p["kind"] == "single_location"]
    if args.limit:
        to_locate = to_locate[: args.limit]
    passthrough = [p for p in places if p["kind"] != "single_location"]

    published, review = [], []
    reasons = {}
    for i, place in enumerate(to_locate, 1):
        record, reason = resolve(place, geocoder, args.min_confidence)
        if reason:
            record["review_reason"] = reason
            reasons[reason] = reasons.get(reason, 0) + 1
            review.append(record)
        else:
            published.append(record)
        if args.verbose:
            print("  %4d/%d  %-28s -> %s" % (
                i, len(to_locate), place["name_he"][:28],
                reason or "%.2f %s" % (record["match_confidence"], record["name_google"])))
        elif i % 50 == 0:
            print("  %d/%d" % (i, len(to_locate)))

    for place in passthrough:
        record = dict(place)
        record["google_place_id"] = None
        record["lat"] = record["lng"] = None
        record["address_he"] = None
        record["match_confidence"] = None
        published.append(record)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(published, ensure_ascii=False, indent=2), encoding="utf-8")

    # Phase 2 also writes to this file. Keep its entries, replace ours, so a
    # rerun with a different threshold does not pile up stale rows.
    GEOCODE_REASONS = {"not_geocoded", "no_google_result", "low_match_confidence"}
    kept = []
    if args.review.exists():
        kept = [
            r
            for r in json.loads(args.review.read_text(encoding="utf-8"))
            if r.get("review_reason") not in GEOCODE_REASONS
        ]
    args.review.write_text(
        json.dumps(kept + review, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    located = [p for p in published if p.get("google_place_id")]
    print("\n" + "=" * 62)
    print("CHECKPOINT 3")
    print("=" * 62)
    print("single locations attempted : %d" % len(to_locate))
    print("geocoded and published     : %d (%.1f%%)"
          % (len(located), 100 * len(located) / max(len(to_locate), 1)))
    print("routed to review           : %d" % len(review))
    for reason, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
        print("    %-22s %d" % (reason, n))
    print("chains stored (no geocode) : %d" % sum(1 for p in passthrough if p["is_chain"]))
    print("online only (no geocode)   : %d" % sum(1 for p in passthrough if p["is_online"]))
    print("live API calls this run    : %d  (cache holds %d queries)"
          % (geocoder.calls, len(geocoder.cache)))

    if located:
        print("\n10 random matches to spot check:")
        for p in random.Random(11).sample(located, min(10, len(located))):
            print("  %-26s %-12s conf %.2f" % (p["name_he"][:26], p["city"] or "", p["match_confidence"]))
            print("     %s" % p["address_he"])
            print("     https://www.google.com/maps/search/?api=1&query=%s,%s&query_place_id=%s"
                  % (p["lat"], p["lng"], p["google_place_id"]))

    print("\nwrote %s" % args.out)


if __name__ == "__main__":
    main()
