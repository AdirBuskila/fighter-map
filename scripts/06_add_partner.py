#!/usr/bin/env python3
"""
Add branches a business has written in to tell us about.

The map is built from reservists reporting where the card actually worked, and
that is still the point. But businesses do email, and turning a chain away
because it told us itself rather than waiting for someone to report it would be
silly: the branches are real and somebody standing outside one wants to know.

So this loads them, and marks them for what they are.

Each branch goes in as a normal user_submission with NO report attached, which
leaves confirm_count at zero. That matters, because it is what the trust rules
read: a row on a single account of itself draws hollow on the map, and one
"לא עבד לי" is enough to pull it. A business listing earns no more trust than
one person's word until a reservist confirms it, which is exactly right.

note_he says where the details came from, so the page never implies a
reservist has been there.

Idempotent: keyed on source_key, so rerunning updates rather than duplicating.
Re-running after a correction is the intended way to fix a branch. Verified by
running it twice: five rows, no duplicate keys, confirm_count untouched.

One wrinkle worth knowing. This writes straight to PostgREST, so it never
passes through a route handler and revalidatePath is never called. The branch
pages appear at once because their ids have never been rendered, but the
homepage keeps serving its cached copy for up to the two minute window, and
then one more request to prime it: the first request after the window expires
gets the stale page and only kicks off the rebuild. So after running this,
load the site twice before concluding anything is wrong.

    export NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=...
    python scripts/06_add_partner.py --dry-run
    python scripts/06_add_partner.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import requests

PROVENANCE = "הפרטים נמסרו על ידי הרשת עצמה, וטרם אומתו על ידי מילואימניק."

# Coordinates from Nominatim, each checked against the town it should be in.
#
# provider_ref stays null on purpose. OpenStreetMap has no record of this chain
# anywhere, so the only refs on offer were the malls the branches sit in, and
# writing "this row IS קניון הנגב" would be a false identity that a later
# submission of the mall itself would collide with. A null ref costs nothing
# here: confirming a place does not need one, only adding one through /add
# does, and nobody can add a shop OSM has never heard of.
BRANCHES = [
    {
        "source_key": "partner:touch-store-kfar-saba",
        "name_he": "Touch Store כפר סבא",
        "city": "כפר סבא",
        "address_he": "עתיר ידע 2, קניון אושילנד",
        "phone": "09-7429099",
        "lat": 32.16545,
        "lng": 34.92856,
    },
    {
        "source_key": "partner:touch-store-kiryat-ono",
        "name_he": "Touch Store קרית אונו",
        "city": "קרית אונו",
        # The email said הקלנית. The street is הכלנית, which is what OSM, the
        # municipality and any navigation app know it as, and the pin below is
        # on it, a block behind the mall exactly as described.
        "address_he": "הכלנית 13, מאחורי הקניון",
        "phone": "03-5344554",
        "lat": 32.05635,
        "lng": 34.86342,
    },
    {
        "source_key": "partner:touch-store-yavne",
        "name_he": "Touch Store יבנה",
        "city": "יבנה",
        "address_he": "הנחשול 22, מתחם קרסו גרין",
        "phone": "08-9554088",
        "lat": 31.86296,
        "lng": 34.73920,
    },
    {
        "source_key": "partner:touch-store-rishon",
        "name_he": "Touch Store ראשון לציון",
        "city": "ראשון לציון",
        "address_he": "ילדי טהרן 3, סינמה סיטי",
        "phone": "03-7168897",
        "lat": 31.98391,
        "lng": 34.77112,
    },
    {
        "source_key": "partner:touch-store-beer-sheva",
        "name_he": "Touch Store באר שבע",
        "city": "באר שבע",
        "address_he": "קניון הנגב, צומת אלי כהן",
        "phone": "08-9952233",
        "lat": 31.24371,
        "lng": 34.79476,
    },
]

# Rough box around Israel. A geocoder that quietly returns the middle of the
# Atlantic is the classic way a batch like this goes wrong, and five rows is
# few enough that a wrong one would sit on the map for weeks unnoticed.
BOUNDS = (29.4, 33.4, 34.2, 35.9)


def row_for(branch: dict, now: str) -> dict:
    return {
        "source_key": branch["source_key"],
        "provider_ref": None,
        "name_he": branch["name_he"],
        "name_en": "Touch Store",
        "category": "electronics",
        "is_chain": False,
        "is_online": False,
        "location": "SRID=4326;POINT(%s %s)" % (branch["lng"], branch["lat"]),
        "address_he": branch["address_he"],
        "city": branch["city"],
        "phone": branch["phone"],
        "benefit_fighter_card": True,
        "benefit_vacation_voucher": False,
        "note_he": PROVENANCE,
        "source": "user_submission",
        "status": "published",
        "first_reported_at": now,
    }


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Load partner-supplied branches")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    lat_lo, lat_hi, lng_lo, lng_hi = BOUNDS
    for branch in BRANCHES:
        if not (lat_lo <= branch["lat"] <= lat_hi and lng_lo <= branch["lng"] <= lng_hi):
            sys.exit("%s is outside Israel: %s" % (branch["source_key"], branch))

    now = datetime.now(timezone.utc).isoformat()
    rows = [row_for(b, now) for b in BRANCHES]

    print("%d branches" % len(rows))
    for row in rows:
        print("  %-34s %-26s %s" % (row["source_key"], row["city"], row["phone"]))

    if args.dry_run:
        print("\ndry run, nothing sent")
        return 0

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        sys.exit("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")

    response = requests.post(
        "%s/rest/v1/places?on_conflict=source_key" % url.rstrip("/"),
        headers={
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
        data=json.dumps(rows, ensure_ascii=False).encode("utf-8"),
        timeout=60,
    )
    if response.status_code >= 300:
        sys.exit("write failed %s: %s" % (response.status_code, response.text[:400]))

    written = response.json()
    print("\nupserted %d rows" % len(written))
    for row in written:
        print("  %s  %s" % (row["id"], row["name_he"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
