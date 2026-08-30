#!/usr/bin/env python3
"""
Publish the places nobody could pin.

482 imported rows sit in /admin with no coordinates. That is not a queue
nobody has touched: 03_locate.py matched them against a local index of every
named business in Israel, and 03b_locate_remote.py then asked Nominatim and
Photon about each one. These are what is left after both passes, and the
reason is the same every time -- OpenStreetMap has never heard of most small
Israeli businesses. Waiting for a moderator to place 482 pins by hand is
waiting for something that was never going to happen.

They do not need a pin to be useful. `googleMapsUrl()` without coordinates
falls back to a Maps *search* for the name and town, and Google does know
these shops. The reader's question is "does the card work here" -- the pin was
only ever how we answered "and where is here".

So this flips them to published and sets `pin_unavailable`, which is the
column 0006 adds for exactly this: somebody looked, it cannot be located, show
it anyway. A pending row *without* that flag still means what it always meant,
which is that nobody has looked yet.

Three things this deliberately does not do:

  * it does not touch rows that already have a point. A pending row with
    coordinates is a different case -- it is waiting on a person's judgement,
    not on a geocoder -- and it stays waiting.
  * it does not clear review_reason. The row is no longer waiting, but
    'no_osm_match' is still true and still the honest answer to "why is there
    no pin", so it stays as the audit trail.
  * it does not put anything on the map. places_all and places_near both
    filter `location is not null`, so a pinless row cannot reach the map
    however this flag is set. They appear in the list, beside the chains.

Idempotent: rerunning matches nothing, because the rows are no longer pending.

    export NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=...
    python scripts/08_publish_unpinned.py --dry-run
    python scripts/08_publish_unpinned.py
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import sys

import requests

SELECT = "id,name_he,city,address_he,category,source,review_reason"
# Physical places only, with no point, still waiting. Chains and online shops
# are already published without one and must not be swept up here.
FILTERS = {
    "status": "eq.pending",
    "location": "is.null",
    "is_chain": "eq.false",
    "is_online": "eq.false",
}


def search_terms(row: dict) -> str:
    """Mirror of searchTerms() in src/lib/format.ts.

    Duplicated deliberately, and kept tiny for that reason: it exists so the
    dry run prints the query the reader will actually be sent to Google with.
    A preview that drifts from the real thing is worse than no preview, which
    is why tools/place_urls.mjs holds the TypeScript one down with cases.
    """
    parts = [row["name_he"]]
    if row.get("address_he"):
        parts.append(row["address_he"])
    said = "%s %s" % (row["name_he"], row.get("address_he") or "")
    if row.get("city") and row["city"] not in said:
        parts.append(row["city"])
    return " ".join(parts)


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Publish places that cannot be pinned")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        sys.exit("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")

    headers = {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    }

    # 0006 has to be in first, or the write fails halfway through with a
    # column-not-found and the reason is buried in a PostgREST error string.
    probe = requests.get("%s/rest/v1/places" % url, headers=headers, timeout=30,
                         params={"select": "pin_unavailable", "limit": 1})
    if probe.status_code >= 300:
        sys.exit(
            "places.pin_unavailable is missing, so migration 0006 has not been run.\n"
            "Paste supabase/migrations/0006_pin_unavailable.sql into the SQL editor "
            "first.\nPostgREST said: %s" % probe.text[:200]
        )

    rows = requests.get("%s/rest/v1/places" % url, headers=headers, timeout=60,
                        params={**FILTERS, "select": SELECT, "limit": "5000"}).json()
    if not rows:
        print("nothing to publish: no pending physical places without a point")
        return 0

    with_city = [r for r in rows if r.get("city")]
    without = [r for r in rows if not r.get("city")]
    print("%d places to publish without a pin" % len(rows))
    print("  %d carry a town, so the Maps search has something to bite on" % len(with_city))
    print("  %d have only a name; the search will be vague, and that is known"
          % len(without))
    print("\n  by reason: %s"
          % dict(collections.Counter(r.get("review_reason") for r in rows)))
    print("  by source: %s"
          % dict(collections.Counter(r.get("source") for r in rows)))
    print("\n  top towns: %s"
          % collections.Counter(r["city"] for r in with_city).most_common(6))
    print("\n  a sample of what the reader will search for:")
    for row in rows[:8]:
        print("     %s" % search_terms(row))

    if args.dry_run:
        print("\ndry run, nothing written")
        return 0

    response = requests.patch(
        "%s/rest/v1/places" % url,
        headers={**headers, "Prefer": "return=representation"},
        params=FILTERS,
        data=json.dumps({"status": "published", "pin_unavailable": True}),
        timeout=120,
    )
    if response.status_code >= 300:
        sys.exit("write failed %s: %s" % (response.status_code, response.text[:400]))

    written = response.json()
    print("\npublished %d places without a pin" % len(written))
    print("They are in the list, not on the map: places_all filters")
    print("`location is not null`, so this cannot put a dot anywhere.")
    print("\nLoad the site twice before concluding anything is wrong -- this writes")
    print("straight to PostgREST, so revalidatePath never runs and the homepage")
    print("serves its cached copy until the window expires.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
