#!/usr/bin/env python3
"""
Phase 3c - ask the free geocoders about whatever the local index missed.

03_locate.py matches against a Geofabrik extract, which is fast, free and
offline but only knows what is tagged as a business in OSM. That leaves a few
hundred places with no coordinates, which matters: a place with no pin cannot
appear on the map and cannot answer "what is near me", which is the whole
point of the app.

So this pass asks two free, key-free services about the leftovers:

  Nominatim  OSM's own geocoder. Conservative: it returns nothing rather than
             something wrong, which is the failure mode we want.
  Photon     OSM typeahead. Finds more, and confidently returns nonsense (it
             offered a Jerusalem detention centre for a Jerusalem cafe), so it
             is gated exactly as hard as everything else.

Both are run by volunteers. Nominatim's policy is one request per second with
a real User-Agent; Photon asks only that you be reasonable. Every response is
cached in data/remote_locate_cache.json, so reruns and threshold changes cost
them nothing.

A candidate has to clear the same two guards the local pass uses. A remote
answer earns no extra trust for having cost a network round trip:

  1. the DISTINCTIVE part of the name must match, not just the whole string,
     because the generic word inflates everything
  2. if the reporter named a city, the answer must be within --city-radius of
     it, which is what kills the confident nonsense

Usage:
    python scripts/03b_locate_remote.py
    python scripts/03b_locate_remote.py --verbose --limit 40
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from importlib.machinery import SourceFileLoader
from pathlib import Path

import requests
from rapidfuzz import fuzz

ROOT = Path(__file__).resolve().parent.parent
PLACES = ROOT / "data" / "places.json"
REVIEW = ROOT / "data" / "needs_review.json"
LOCALITIES = ROOT / "data" / "osm_places.json"
CACHE = ROOT / "data" / "remote_locate_cache.json"

_locate = SourceFileLoader("_locate", str(ROOT / "scripts" / "03_locate.py")).load_module()
canon, skeleton = _locate.canon, _locate.skeleton
distinctive, haversine_km = _locate.distinctive, _locate.haversine_km
build_locality_index = _locate.build_locality_index
MIN_CORE = _locate.MIN_CORE

NOMINATIM = "https://nominatim.openstreetmap.org/search"
PHOTON = "https://photon.komoot.io/api/"
UA = "fighter-map/1.0 (community map for Israeli reservists; adirbu98@gmail.com)"
NOMINATIM_DELAY = 1.1
OSM_TYPES = {"N": "node", "W": "way", "R": "relation",
             "node": "node", "way": "way", "relation": "relation"}

RETRYABLE = {"no_osm_match", "low_match_confidence", "not_located", "not_geocoded"}


def build_query(place: dict) -> str:
    """What we type into the geocoder. The city matters: without it a name like
    "הבקתה" matches a dozen unrelated places across the country."""
    parts = [place["name_he"]]
    if place.get("city"):
        parts.append(place["city"])
    return " ".join(parts)


def load_cache() -> dict:
    if CACHE.exists():
        try:
            return json.loads(CACHE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print("  cache was corrupt, starting fresh", file=sys.stderr)
    return {}


def save_cache(cache: dict) -> None:
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    tmp = CACHE.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    tmp.replace(CACHE)


def ask_nominatim(session: requests.Session, query: str) -> list:
    r = session.get(
        NOMINATIM,
        params={"q": query, "format": "jsonv2", "limit": 5,
                "countrycodes": "il", "accept-language": "he"},
        timeout=25,
    )
    if r.status_code != 200:
        return []
    out = []
    for row in r.json():
        kind = OSM_TYPES.get(row.get("osm_type") or "")
        if not kind or not row.get("osm_id"):
            continue
        out.append({
            "name": row.get("name") or (row.get("display_name") or "").split(",")[0],
            "context": row.get("display_name") or "",
            "lat": float(row["lat"]),
            "lon": float(row["lon"]),
            "ref": "osm:%s/%s" % (kind, row["osm_id"]),
            "via": "nominatim",
        })
    return out


def ask_photon(session: requests.Session, query: str, centre) -> list:
    params = {"q": query, "limit": 5, "lang": "default", "bbox": "34.2,29.4,35.9,33.4"}
    if centre:
        params["lat"], params["lon"] = centre[0], centre[1]
    r = session.get(PHOTON, params=params, timeout=25)
    if r.status_code != 200:
        return []
    out = []
    for feature in r.json().get("features", []):
        props = feature.get("properties") or {}
        coords = (feature.get("geometry") or {}).get("coordinates")
        kind = OSM_TYPES.get(props.get("osm_type") or "")
        if not coords or not props.get("name") or not kind or not props.get("osm_id"):
            continue
        out.append({
            "name": props["name"],
            "context": ", ".join(
                str(props[k]) for k in ("street", "city", "county") if props.get(k)
            ),
            "lat": coords[1],
            "lon": coords[0],
            "ref": "osm:%s/%s" % (kind, props["osm_id"]),
            "via": "photon",
        })
    return out


def judge(place: dict, candidates: list, localities: dict,
          min_conf: float, radius_km: float):
    """The same two guards the local pass applies, on the same thresholds."""
    query = canon(place["name_he"])
    query_core = distinctive(place["name_he"])
    city = place.get("city")
    centre = localities.get(canon(city)) if city else None

    best, best_score = None, 0.0
    for cand in candidates:
        folded = canon(cand["name"])
        if not folded:
            continue

        set_score = fuzz.token_set_ratio(query, folded)
        sort_score = fuzz.token_sort_ratio(query, folded)
        if sort_score < 75:
            continue

        core = distinctive(cand["name"])
        if query_core and core:
            core_score = max(
                fuzz.token_set_ratio(query_core, core),
                fuzz.token_set_ratio(skeleton(query_core), skeleton(core)),
            )
            if core_score < MIN_CORE:
                continue
        elif query_core or core:
            continue

        if centre is not None:
            away = haversine_km(centre[0], centre[1], cand["lat"], cand["lon"])
            if away > radius_km:
                continue

        score = (set_score * 0.6 + sort_score * 0.4) / 100.0
        if score > best_score:
            best, best_score = cand, score

    if best is None or best_score < min_conf:
        return None
    return best, round(best_score, 3)


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Geocode the leftovers via free services")
    ap.add_argument("--min-confidence", type=float, default=_locate.MIN_CONFIDENCE)
    ap.add_argument("--city-radius", type=float, default=_locate.CITY_RADIUS_KM)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--offline", action="store_true", help="cache only, no requests")
    args = ap.parse_args()

    for path in (PLACES, REVIEW, LOCALITIES):
        if not path.exists():
            sys.exit("%s is missing. Run scripts/03_locate.py first." % path.name)

    places = json.loads(PLACES.read_text(encoding="utf-8"))
    review = json.loads(REVIEW.read_text(encoding="utf-8"))
    localities = build_locality_index(json.loads(LOCALITIES.read_text(encoding="utf-8")))

    todo = [r for r in review
            if r.get("review_reason") in RETRYABLE and r.get("kind") == "single_location"]
    keep = [r for r in review if r not in todo]
    if args.limit:
        keep += todo[args.limit:]
        todo = todo[: args.limit]

    print("%d places have no pin, asking Nominatim and Photon about each" % len(todo))

    cache = load_cache()
    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept": "application/json"})

    found, missing, live_calls = [], [], 0
    by_service = {"nominatim": 0, "photon": 0}

    for i, place in enumerate(todo, 1):
        query = build_query(place)
        entry = cache.get(query)

        if entry is None and not args.offline:
            try:
                nominatim = ask_nominatim(session, query)
                time.sleep(NOMINATIM_DELAY)
                photon = ask_photon(session, query,
                                    localities.get(canon(place.get("city") or "")))
                live_calls += 2
            except requests.RequestException as exc:
                print("  %-26s network error: %s" % (query[:26], str(exc)[:50]),
                      file=sys.stderr)
                nominatim, photon = [], []
            entry = {"nominatim": nominatim, "photon": photon}
            cache[query] = entry
            if live_calls % 40 == 0:
                save_cache(cache)
        elif entry is None:
            entry = {"nominatim": [], "photon": []}

        verdict = judge(place, entry["nominatim"] + entry["photon"],
                        localities, args.min_confidence, args.city_radius)

        if verdict:
            cand, score = verdict
            record = dict(place)
            record.pop("review_reason", None)
            record.update({
                "provider_ref": cand["ref"],
                "name_osm": cand["name"],
                "lat": cand["lat"],
                "lng": cand["lon"],
                "address_he": cand.get("context") or place.get("city"),
                "match_confidence": score,
                "located_by": cand["via"],
            })
            found.append(record)
            by_service[cand["via"]] += 1
            if args.verbose:
                print("  %4d/%d %-24s -> %.2f %-26s [%s]"
                      % (i, len(todo), place["name_he"][:24], score,
                         cand["name"][:26], cand["via"]))
        else:
            missing.append(place)
            if args.verbose:
                print("  %4d/%d %-24s -> nothing" % (i, len(todo), place["name_he"][:24]))

        if not args.verbose and i % 25 == 0:
            print("  %d/%d  (+%d located)" % (i, len(todo), len(found)))

    save_cache(cache)

    # A newly located place moves out of the review queue and into places.json.
    existing = {p.get("source_key") or p["name_he"] for p in places}
    added = [r for r in found
             if (r.get("source_key") or r["name_he"]) not in existing]
    places.extend(added)
    PLACES.write_text(json.dumps(places, ensure_ascii=False, indent=2), encoding="utf-8")
    REVIEW.write_text(json.dumps(keep + missing, ensure_ascii=False, indent=2),
                      encoding="utf-8")

    located = [p for p in places if p.get("provider_ref")]
    print("\n" + "=" * 62)
    print("located %d more (%d Nominatim, %d Photon)"
          % (len(found), by_service["nominatim"], by_service["photon"]))
    print("live requests this run : %d  (cache holds %d queries)" % (live_calls, len(cache)))
    print("still with no pin      : %d" % len(missing))
    print("places with a pin now  : %d" % len(located))
    print("wrote %s and %s" % (PLACES.name, REVIEW.name))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
