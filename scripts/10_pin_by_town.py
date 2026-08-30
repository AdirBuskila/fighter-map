#!/usr/bin/env python3
"""
Give a town pin to the places that could not be given a doorway.

476 published places had no coordinates at all and so were invisible on the
map. That is most of the corpus. Both geocoding passes had already run over
them -- 03_locate.py against a local index of every named business in Israel,
then 03b_locate_remote.py against Nominatim and Photon -- and these were the
leftovers, because OpenStreetMap has never heard of most small Israeli
businesses.

But it has heard of every town. 396 of the 476 carry one, and a settlement
geocodes cleanly where a hairdresser does not.

WHAT THIS TRADES, STATED PLAINLY.

NEXT.md says a place at the centroid of its town "is on the map, looks right,
and sends somebody to the wrong building", and refuses to do it. That
objection is right about the first and third parts and this script does not
argue with them. It attacks the middle one. A pin that is *labelled*
approximate does not look right; it looks approximate. So every row written
here gets location_precision = 'town', the map draws it differently, and its
page says in words that the point is the settlement rather than the address.

The reader who wants the door still gets it: googleMapsUrl() searches Maps for
the name and town, and Google does know these shops.

WHAT IT WILL NOT DO.

  * It will not touch a row that already has a point. Anything geocoded to a
    doorway, or pinned by a person in /admin, is left exactly alone -- this
    only ever fills a hole.
  * It will not invent a town. 80 rows have nothing but a name, and they stay
    unpinned and listed, because "somewhere in Israel" is not a location.
  * It spreads a town's places over a small deterministic disc rather than
    stacking them, and that decision is worth defending because the instinct
    is to call it faking precision.

    Stacked, sixty-six places in Eilat are one coordinate. MapLibre clusters
    them all the way in, and at maximum zoom the reader sees a single pin and
    can reach exactly one of the sixty-six; the other sixty-five exist only in
    the list. That is not more honest, it is just less useful.

    What makes spreading safe here is that these points are no longer anything
    anyone is sent to. googleMapsUrl() and wazeUrl() treat a town pin as no
    pin and search by name and town instead, so nothing navigates to the dot.
    Its only job is to say "one of these is somewhere around here", and for
    that a small disc says it better than a spike.

    The offset is derived from the place id, so it is stable across reruns --
    a pin that wanders between deploys would look like the data changed.
  * It will not write a point outside the country. Every centroid is checked
    against the same box the submission form enforces.

Idempotent. A second run finds nothing, because the rows it wrote now have a
location.

    export NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=...
    python scripts/10_pin_by_town.py --dry-run
    python scripts/10_pin_by_town.py
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import io
import json
import math
import os
import sys
import time

import requests

CACHE = os.path.join("data", "town_centres.json")
UA = "fighter-map/1.0 (community benefit map for Israeli reservists)"
# The same box /add enforces on a pasted link, and the same one the seed
# scripts check. A geocoder that quietly answers with the middle of the
# Atlantic is the classic way a batch like this goes wrong.
BOUNDS = (29.4, 33.45, 34.2, 35.95)

# A settlement, not a road or a shop. Nominatim will happily return a street
# called after a town, and a street centroid is a different and worse lie.
SETTLEMENT_KINDS = ("place", "boundary", "landuse")


# Roughly a quarter of a degree of longitude per kilometre at this latitude.
# 400m is small enough to sit inside any real settlement and large enough that
# the dots separate at street zoom.
SPREAD_M = 400.0


def offset_for(place_id: str, lat: float, lng: float) -> tuple[float, float]:
    """A small, stable displacement from the town centre.

    Derived from the id rather than randomised, so the same place lands on the
    same dot on every run. A pin that moved between deploys would read as the
    data having changed.

    The angle and the radius come from different slices of the digest, and the
    radius is square-rooted so the points spread evenly over the disc instead
    of bunching in the middle, which is what makes a cluster of them read as a
    scatter rather than a smudge.
    """
    digest = hashlib.sha256(place_id.encode("utf-8")).digest()
    angle = (int.from_bytes(digest[:4], "big") / 0xFFFFFFFF) * 2 * math.pi
    radius = math.sqrt(int.from_bytes(digest[4:8], "big") / 0xFFFFFFFF) * SPREAD_M
    d_lat = (radius * math.cos(angle)) / 111_320.0
    d_lng = (radius * math.sin(angle)) / (111_320.0 * math.cos(math.radians(lat)))
    return round(lat + d_lat, 6), round(lng + d_lng, 6)


def resolve_town(session: requests.Session, name: str):
    for params in (
        {"q": name, "format": "jsonv2", "limit": 5, "countrycodes": "il",
         "featuretype": "settlement", "accept-language": "he"},
        {"q": name, "format": "jsonv2", "limit": 5, "accept-language": "he"},
    ):
        try:
            response = session.get("https://nominatim.openstreetmap.org/search",
                                   params=params, timeout=25)
            hits = response.json() if response.status_code == 200 else []
        except Exception:
            hits = []
        # Nominatim's usage policy is one request a second, and it is enforced.
        time.sleep(1.15)
        for hit in hits:
            lat, lng = float(hit["lat"]), float(hit["lon"])
            if not (BOUNDS[0] <= lat <= BOUNDS[1] and BOUNDS[2] <= lng <= BOUNDS[3]):
                continue
            if hit.get("category") not in SETTLEMENT_KINDS:
                continue
            return {"lat": round(lat, 6), "lng": round(lng, 6),
                    "matched": hit.get("display_name", "")[:120]}
    return None


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Pin unlocated places at their town")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        sys.exit("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
    headers = {"apikey": key, "Authorization": "Bearer " + key,
               "Content-Type": "application/json"}

    probe = requests.get("%s/rest/v1/places" % url, headers=headers, timeout=30,
                         params={"select": "location_precision", "limit": 1})
    if probe.status_code >= 300:
        sys.exit("places.location_precision is missing, so migration 0007 has not "
                 "been run.\nPaste supabase/migrations/0007_location_precision.sql "
                 "into the SQL editor first.\nPostgREST said: %s" % probe.text[:200])

    rows = requests.get("%s/rest/v1/places" % url, headers=headers, timeout=60,
                        params={"status": "eq.published", "location": "is.null",
                                "is_chain": "eq.false", "is_online": "eq.false",
                                "city": "not.is.null",
                                "select": "id,name_he,city", "limit": "5000"}).json()
    if not rows:
        print("nothing to pin: every published place with a town already has a point")
        return 0

    towns = collections.Counter(r["city"] for r in rows)
    cache = json.load(io.open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    todo = [t for t in towns if t not in cache]
    print("%d places across %d towns; %d towns already cached, %d to look up"
          % (len(rows), len(towns), len(towns) - len(todo), len(todo)))

    if todo:
        os.makedirs("data", exist_ok=True)
        session = requests.Session()
        session.headers["User-Agent"] = UA
        for index, town in enumerate(todo, 1):
            cache[town] = resolve_town(session, town)
            print("  %3d/%3d %s %s" % (index, len(todo),
                                       "ok  " if cache[town] else "MISS", town))
            if index % 15 == 0:
                json.dump(cache, io.open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
        json.dump(cache, io.open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)

    updates, skipped = [], collections.Counter()
    for row in rows:
        centre = cache.get(row["city"])
        if not centre:
            skipped[row["city"]] += 1
            continue
        lat, lng = offset_for(row["id"], centre["lat"], centre["lng"])
        if not (BOUNDS[0] <= lat <= BOUNDS[1] and BOUNDS[2] <= lng <= BOUNDS[3]):
            sys.exit("%s resolved outside Israel: %s" % (row["city"], centre))
        updates.append({"id": row["id"], "city": row["city"], "lat": lat, "lng": lng})

    print("\n%d places will get a town pin, %d left unpinned"
          % (len(updates), sum(skipped.values())))
    if skipped:
        print("  towns that would not resolve: %s" % dict(skipped))
    print("\n  biggest stacks (they cluster on the map):")
    for town, n in collections.Counter(u["city"] for u in updates).most_common(8):
        print("     %-18s %d places" % (town, n))

    if args.dry_run:
        print("\ndry run, nothing written")
        return 0

    written = 0
    for update in updates:
        response = requests.patch(
            "%s/rest/v1/places" % url,
            headers={**headers, "Prefer": "return=minimal"},
            params={"id": "eq.%s" % update["id"]},
            data=json.dumps({
                "location": "SRID=4326;POINT(%s %s)" % (update["lng"], update["lat"]),
                "location_precision": "town",
                # It has a point now, so the 0006 flag no longer describes it.
                # Each flag gets to mean one thing: pin_unavailable is "no point
                # at all", location_precision is "the point is only the town".
                "pin_unavailable": False,
            }),
            timeout=30,
        )
        if response.status_code >= 300:
            sys.exit("write failed on %s: %s %s"
                     % (update["id"], response.status_code, response.text[:300]))
        written += 1
        if written % 50 == 0:
            print("  %d/%d" % (written, len(updates)))

    print("\npinned %d places at their town centre" % written)
    print("Every one is location_precision='town'. The map draws them muted and")
    print("their pages say the point is the settlement, not the address.")
    print("\nLoad the site twice before concluding anything is wrong: this writes")
    print("straight to PostgREST, so revalidatePath never runs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
