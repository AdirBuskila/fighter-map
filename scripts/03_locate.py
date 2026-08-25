#!/usr/bin/env python3
"""
Phase 3 - resolve single locations against the local OSM index.

Replaces the Google Places geocoder. Instead of 610 billed API calls it matches
against data/osm_pois.json, which 03a_osm_extract.py builds once from a
Geofabrik extract. No key, no card, no rate limit, and retries are free, which
matters because the matching thresholds want tuning against real output.

The OSM ref (node/123456) is the permanent identity, the same role the Google
place_id played: two people reporting the same shop land on the same row.
Coordinates and address are a refreshable cache; re-running after a newer
extract updates them without changing identity.

Two hard guards against confident nonsense, which is the failure mode that
matters. A wrong pin is worse than a missing one:

  1. Name similarity needs BOTH token_set_ratio and token_sort_ratio. Set ratio
     alone scores a subset as a perfect 100, so "לחם בשר" would match
     "לחם בשר ירושלים" and every other branch equally.
  2. If the reporter named a city, the candidate has to be within
     --city-radius of that city. This is the strong one: Photon happily
     returned a Jerusalem detention centre for a Jerusalem cafe, and geography
     rejects that instantly.

Usage:
    python scripts/03_locate.py
    python scripts/03_locate.py --verbose
    python scripts/03_locate.py --min-confidence 0.85
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from importlib.machinery import SourceFileLoader
from pathlib import Path

from rapidfuzz import fuzz, process

ROOT = Path(__file__).resolve().parent.parent
IN_PATH = ROOT / "data" / "normalized.json"
POIS = ROOT / "data" / "osm_pois.json"
LOCALITIES = ROOT / "data" / "osm_places.json"
OUT_PATH = ROOT / "data" / "places.json"
REVIEW_PATH = ROOT / "data" / "needs_review.json"

_norm = SourceFileLoader("_norm", str(ROOT / "scripts" / "02_normalize.py")).load_module()
canon = _norm.canon
skeleton = _norm.skeleton

# Words that describe what a business IS, not which one it is. They appear in
# hundreds of names, so they inflate every score: "מלון הילטון" scored 0.80
# against "מלון הרלינגטון" purely on the shared "מלון". Matching is therefore
# gated on the distinctive remainder, not on the whole string.
GENERIC_WORDS = {
    "מלון", "מלונות", "בית", "אכסניה", "אכסניית", "הוסטל", "צימר", "צימרים",
    "וילה", "וילות", "כפר", "נופש", "אירוח", "סוויטת", "סוויטות",
    "מסעדה", "מסעדת", "קפה", "בר", "פאב", "פיצה", "פיצרייה", "שווארמה",
    "פלאפל", "חומוס", "סושי", "בורגר", "המבורגר", "שיפודי", "שיפודיה",
    "גלידת", "גלידה", "מאפיית", "מאפייה", "בייקרי", "קונדיטוריה",
    "חנות", "חנויות", "רשת", "סניף", "סניפי", "מרכז", "מועדון", "יקב",
    "נעלי", "ביגוד", "בגדי", "אתר", "משרד",
    "hotel", "cafe", "coffee", "restaurant", "bar", "pizza", "burger",
    "the", "and", "of",
}


def distinctive(text: str) -> str:
    """The part of a name that says WHICH business, with the type words gone."""
    words = [w for w in canon(text).split() if w not in GENERIC_WORDS]
    return " ".join(words)


# 0.87, chosen by reading the band rather than by feel. Of the 25 matches that
# scored between 0.80 and 0.87, about twenty were wrong in the same way:
# בייבי פארם -> ביוטי פארם, שוק דגים -> רק דגים, משהו -> משה, מלון פרא -> מלון פארק.
# Five were real. Cutting here costs those five and prevents the twenty, and
# the twenty are not lost, they go to /admin. A wrong pin is worse than a
# missing one, and a wrong pin nobody notices is worst of all.
MIN_CONFIDENCE = 0.87
MIN_CORE = 80.0
CITY_RADIUS_KM = 25.0
CANDIDATES = 12

LOCATE_REASONS = {"no_osm_match", "low_match_confidence", "not_located"}


def haversine_km(a_lat, a_lon, b_lat, b_lon) -> float:
    r = 6371.0
    dlat = math.radians(b_lat - a_lat)
    dlon = math.radians(b_lon - a_lon)
    h = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat))
         * math.sin(dlon / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(h))


def build_locality_index(rows: list) -> dict:
    """canon(name) -> (lat, lon), preferring the largest settlement of that name."""
    rank = {"city": 0, "town": 1, "village": 2, "suburb": 3, "neighbourhood": 4, "hamlet": 5}
    index: dict = {}
    for row in sorted(rows, key=lambda r: rank.get(r["kind"], 9)):
        for name in (row["name"], row.get("name_he"), row.get("name_en")):
            if not name:
                continue
            key = canon(name)
            if key and key not in index:
                index[key] = (row["lat"], row["lon"])
    return index


def build_search_space(pois: list) -> tuple:
    """Every name a POI answers to, flattened, with a pointer back to its row."""
    names: list = []
    owner: list = []
    for i, poi in enumerate(pois):
        for name in (poi["name"], poi.get("name_he"), poi.get("name_en"), poi.get("brand")):
            if not name:
                continue
            folded = canon(name)
            if folded:
                names.append(folded)
                owner.append(i)
    return names, owner


def locate(place: dict, pois, names, owner, localities, min_conf, radius_km) -> tuple:
    query = canon(place["name_he"])
    query_core = distinctive(place["name_he"])
    if not query:
        return place, "no_osm_match"

    city = place.get("city")
    centre = localities.get(canon(city)) if city else None

    hits = process.extract(query, names, scorer=fuzz.token_set_ratio,
                           limit=CANDIDATES, score_cutoff=min_conf * 100)
    best, best_score = None, 0.0
    for _, set_score, position in hits:
        poi = pois[owner[position]]
        folded = names[position]

        # Set ratio alone scores a subset as perfect. Require the length
        # sensitive one as well, or every branch of a chain matches equally.
        sort_score = fuzz.token_sort_ratio(query, folded)
        if sort_score < 75:
            continue

        # And the distinctive part has to carry its own weight. This is what
        # separates Hilton from Harlington once "מלון" stops counting.
        core = distinctive(folded)
        if query_core and core:
            core_score = max(fuzz.token_set_ratio(query_core, core),
                             fuzz.token_set_ratio(skeleton(query_core), skeleton(core)))
            if core_score < MIN_CORE:
                continue
        elif query_core or core:
            continue  # one side is nothing but type words, so nothing to compare

        # Geography is the reliable guard. If the reporter named a city and the
        # candidate is not near it, it is a different business with the same
        # name, not a better answer.
        if centre is not None:
            distance = haversine_km(centre[0], centre[1], poi["lat"], poi["lon"])
            if distance > radius_km:
                continue

        score = (set_score * 0.6 + sort_score * 0.4) / 100.0
        if score > best_score:
            best, best_score = poi, score

    if best is None:
        return place, "no_osm_match"

    out = dict(place)
    out["provider_ref"] = "osm:" + best["osm"]
    out["name_osm"] = best["name"]
    out["lat"] = best["lat"]
    out["lng"] = best["lon"]
    out["address_he"] = ", ".join(
        p for p in (
            " ".join(p for p in (best.get("street"), best.get("housenumber")) if p) or None,
            best.get("city") or place.get("city"),
        ) if p
    ) or None
    out["phone"] = out.get("phone") or best.get("phone")
    out["url"] = out.get("url") or best.get("website")
    out["osm_category"] = best["category"]
    out["match_confidence"] = round(best_score, 3)

    if best_score < min_conf:
        return out, "low_match_confidence"
    return out, None


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Match places against the local OSM index")
    ap.add_argument("--in", dest="src", type=Path, default=IN_PATH)
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    ap.add_argument("--review", type=Path, default=REVIEW_PATH)
    ap.add_argument("--min-confidence", type=float, default=MIN_CONFIDENCE)
    ap.add_argument("--city-radius", type=float, default=CITY_RADIUS_KM)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    for path in (POIS, LOCALITIES):
        if not path.exists():
            sys.exit("%s is missing. Run scripts/03a_osm_extract.py first." % path.name)

    pois = json.loads(POIS.read_text(encoding="utf-8"))
    localities = build_locality_index(json.loads(LOCALITIES.read_text(encoding="utf-8")))
    names, owner = build_search_space(pois)
    print("index: %d businesses, %d searchable names, %d localities"
          % (len(pois), len(names), len(localities)))

    places = json.loads(args.src.read_text(encoding="utf-8"))
    to_locate = [p for p in places if p["kind"] == "single_location"]
    if args.limit:
        to_locate = to_locate[: args.limit]
    passthrough = [p for p in places if p["kind"] != "single_location"]

    published, review, reasons = [], [], {}
    for i, place in enumerate(to_locate, 1):
        record, reason = locate(place, pois, names, owner, localities,
                                args.min_confidence, args.city_radius)
        if reason:
            record = dict(record)
            record["review_reason"] = reason
            reasons[reason] = reasons.get(reason, 0) + 1
            review.append(record)
        else:
            published.append(record)
        if args.verbose:
            print("  %4d/%d  %-26s -> %s" % (
                i, len(to_locate), place["name_he"][:26],
                reason or "%.2f %s" % (record["match_confidence"], record["name_osm"])))
        elif i % 100 == 0:
            print("  %d/%d" % (i, len(to_locate)))

    for place in passthrough:
        record = dict(place)
        record["provider_ref"] = None
        record["lat"] = record["lng"] = None
        record["address_he"] = None
        record["match_confidence"] = None
        published.append(record)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(published, ensure_ascii=False, indent=2), encoding="utf-8")

    kept = []
    if args.review.exists():
        kept = [r for r in json.loads(args.review.read_text(encoding="utf-8"))
                if r.get("review_reason") not in LOCATE_REASONS]
    args.review.write_text(json.dumps(kept + review, ensure_ascii=False, indent=2),
                           encoding="utf-8")

    located = [p for p in published if p.get("provider_ref")]
    print("\n" + "=" * 62)
    print("CHECKPOINT 3")
    print("=" * 62)
    print("single locations attempted : %d" % len(to_locate))
    print("matched and published      : %d (%.1f%%)"
          % (len(located), 100 * len(located) / max(len(to_locate), 1)))
    print("routed to review           : %d" % len(review))
    for reason, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
        print("    %-22s %d" % (reason, n))
    print("chains stored (no pin)     : %d" % sum(1 for p in passthrough if p["is_chain"]))
    print("online only (no pin)       : %d" % sum(1 for p in passthrough if p["is_online"]))

    if located:
        print("\n10 random matches to spot check:")
        for p in random.Random(11).sample(located, min(10, len(located))):
            print("  %-24s %-12s conf %.2f  -> %s"
                  % (p["name_he"][:24], p["city"] or "", p["match_confidence"], p["name_osm"]))
            print("     https://www.openstreetmap.org/%s" % p["provider_ref"].split(":", 1)[1])
    print("\nwrote %s" % args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
