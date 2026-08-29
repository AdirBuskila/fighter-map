#!/usr/bin/env python3
"""
Add the places people wrote in about.

These arrived as WhatsApp messages and emails rather than through /add, which
is the whole reason the Google Maps link path now exists: the OSM typeahead
cannot find a single one of them, so the people who wanted to add them could
not, and wrote instead.

Two provenances, and they must not be treated alike.

  SELF_REPORTED  a business telling us about itself. No report is attached, so
                 confirm_count stays 0, the row draws hollow, and one
                 "לא עבד לי" pulls it. A business listing earns no more trust
                 than its own word until a reservist confirms it.

  WITNESSED      a reservist saying the card worked for them personally, at a
                 named place, on a named day. That is a real new_submission
                 report and it counts as one person's vouch.

note_he says which of the two it is, so a page never implies a reservist has
been somewhere nobody has been.

COORDINATES ARE THE PART THAT GOES WRONG SILENTLY. A row with lat/lng None is
loaded as 'pending' with review_reason='no_osm_match' and waits in /admin,
where a moderator searches and pins it in a few seconds. That is deliberately
better than a guessed pin: a place at the centroid of its town is on the map,
looks right, and sends somebody to the wrong building.

Idempotent on source_key, so rerunning updates rather than duplicating. Filling
in a coordinate later and rerunning is the intended way to promote a row out of
the queue.

The reports are NOT idempotent the same way -- a rerun inserts a second row.
That is harmless: apply_report() counts distinct ip_hash, so the count does not
move. Worth knowing before you read the reports table and wonder.

    export NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=...
    python scripts/07_add_reported.py --dry-run
    python scripts/07_add_reported.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import requests

FROM_BUSINESS = "הפרטים נמסרו על ידי העסק עצמו, וטרם אומתו על ידי מילואימניק."
FROM_RESERVIST = "דווח על ידי מילואימניק ששילם שם בכרטיס פייטר."

# A business telling us about itself.
SELF_REPORTED = [
    {
        "source_key": "reported:emanuel-shalem-mishor-adumim",
        "name_he": "עמנואל שלם ייצור ומסחר",
        "city": "מישור אדומים",
        "address_he": "אופירה 6, מישור אדומים",
        "phone": "02-5906006",
        "category": "other",
        "fighter": True,
        "voucher": False,
        # Nominatim knows רחוב אופירה in מישור אדומים and nothing inside it, so
        # this is the street rather than the door. Mishor Adumim is an
        # industrial estate of short streets and the row carries the house
        # number in address_he, which is what anybody navigating will use.
        "lat": 31.79588,
        "lng": 35.33687,
        "provider_ref": None,
        "note_he": "15% הנחה על ביגוד Carhartt בתשלום בכרטיס פייטר. " + FROM_BUSINESS,
    },
    {
        "source_key": "reported:shilo-zimmer-menucha-besimcha",
        "name_he": "צימר מנוחה בשמחה",
        "city": "שילה",
        "address_he": "שילה",
        "phone": "054-6344873",
        "category": "zimmer",
        # Voucher only, and that is not an oversight. The card is for goods;
        # lodging is what the מלונות/מילואים voucher is for, which is the
        # correction the owner sent in with the listing.
        "fighter": False,
        "voucher": True,
        # The village, not the door. This one has no Google listing at all, so
        # there is nothing more exact to be had, and the note says so rather
        # than letting the pin imply a precision it does not have.
        "lat": 32.05522,
        "lng": 35.29949,
        "provider_ref": None,
        "note_he": "צימר זוגי עם ג'קוזי ומרפסת נוף. הסימון על היישוב שילה, לא על הצימר עצמו. "
                   + FROM_BUSINESS,
    },
]

# A reservist who paid there.
WITNESSED = [
    {
        "source_key": "reported:gofna-shilo",
        # Google lists it as "גופנה - מסעדת שף הררית". The reporter called it
        # גופנא, which is what somebody looking for it will type.
        "name_he": "גופנא - מסעדת שף הררית",
        "city": "שילה",
        "address_he": "שילה הקדומה",
        "phone": "050-6576116",
        "category": "restaurant",
        "fighter": True,
        "voucher": False,
        "lat": 32.0512254,
        "lng": 35.291046,
        "provider_ref": "gmaps:ftid/0x151cd9988e4acb5d:0x3e1b948d6d63712",
        "note_he": FROM_RESERVIST,
    },
    {
        "source_key": "reported:golf-maale-adumim",
        "name_he": "גולף מעלה אדומים",
        "city": "מעלה אדומים",
        "address_he": "דרך קדם 5, קניון עופר אדומים, קומה 1",
        "phone": "073-7091077",
        "category": "clothing",
        "fighter": True,
        "voucher": False,
        "lat": 31.7716621,
        "lng": 35.2985222,
        "provider_ref": "gmaps:ftid/0x1503294a153571ed:0xd483dac83d27324c",
        "note_he": FROM_RESERVIST,
    },
    {
        "source_key": "reported:zip-maale-adumim",
        "name_he": "זיפ מעלה אדומים",
        "city": "מעלה אדומים",
        "address_he": "דרך קדם 5, קניון עופר אדומים, קומה 2",
        "phone": "02-5353602",
        "category": "clothing",
        "fighter": True,
        "voucher": False,
        # 67 m from גולף above, in the same mall. That is inside the 75 m the
        # merge searches, so these two rows are the live case for why
        # place_near_match tests the name with word_similarity: plain trigram
        # similarity scores this pair 0.571 and would fuse them into one shop.
        "lat": 31.7715233,
        "lng": 35.2978326,
        "provider_ref": "gmaps:ftid/0x1503294bcbd1c157:0x5a2c5e54d930dbdf",
        "note_he": FROM_RESERVIST,
    },
    {
        "source_key": "reported:oshika-maale-adumim",
        "name_he": "אושיקה מעלה אדומים",
        "city": "מעלה אדומים",
        "address_he": None,
        "phone": None,
        "category": "clothing",
        "fighter": True,
        "voucher": False,
        # Neither OSM nor Google has a business by this name in Maale Adumim,
        # under this spelling or any near it, so there is nothing to pin it to.
        # It waits in /admin rather than taking the mall's own coordinates,
        # which would put a shop on the map that may not be in that building.
        "lat": None,
        "lng": None,
        "provider_ref": None,
        "note_he": FROM_RESERVIST,
    },
]

# Rough box around Israel, the same one /add enforces on a pasted link. A
# geocoder that quietly returns the middle of the Atlantic is the classic way a
# batch like this goes wrong, and six rows is few enough that a wrong one would
# sit on the map for weeks unnoticed.
BOUNDS = (29.4, 33.4, 34.2, 35.9)


def row_for(place: dict, now: str) -> dict:
    located = place["lat"] is not None and place["lng"] is not None
    return {
        "source_key": place["source_key"],
        # Google's own id where the business has a listing, which is what lets
        # a later /add submission of the same link land on this row instead of
        # beside it. Null where it has none: the only refs on offer there were
        # the street or the mall, and writing "this row IS קניון אדומים" is a
        # false identity that a submission of the mall itself collides with.
        "provider_ref": place["provider_ref"],
        "name_he": place["name_he"],
        "category": place["category"],
        "is_chain": False,
        "is_online": False,
        "location": (
            "SRID=4326;POINT(%s %s)" % (place["lng"], place["lat"]) if located else None
        ),
        "address_he": place["address_he"],
        "city": place["city"],
        "phone": place["phone"],
        "benefit_fighter_card": place["fighter"],
        "benefit_vacation_voucher": place["voucher"],
        "note_he": place["note_he"],
        "source": "user_submission",
        "status": "published" if located else "pending",
        "review_reason": None if located else "no_osm_match",
        "first_reported_at": now,
    }


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Load places people wrote in about")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    lat_lo, lat_hi, lng_lo, lng_hi = BOUNDS
    for place in SELF_REPORTED + WITNESSED:
        if place["lat"] is None:
            continue
        if not (lat_lo <= place["lat"] <= lat_hi and lng_lo <= place["lng"] <= lng_hi):
            sys.exit("%s is outside Israel: %s" % (place["source_key"], place))
        if len(place["note_he"]) > 200:
            sys.exit("%s note is %d chars, limit is 200" % (place["source_key"], len(place["note_he"])))

    now = datetime.now(timezone.utc).isoformat()
    rows = [row_for(p, now) for p in SELF_REPORTED + WITNESSED]
    witnessed_keys = {p["source_key"] for p in WITNESSED}

    located = [r for r in rows if r["location"]]
    queued = [r for r in rows if not r["location"]]
    print("%d places: %d pinned, %d waiting in /admin for a pin"
          % (len(rows), len(located), len(queued)))
    for row in rows:
        print("  %-44s %-14s %-11s %s"
              % (row["source_key"], row["city"], row["status"],
                 "witness" if row["source_key"] in witnessed_keys else "business"))

    if queued:
        print("\n%d still without a pin. A Google Maps link resolves one in a paste," % len(queued))
        print("and rerunning this promotes it out of the queue.")

    if args.dry_run:
        print("\ndry run, nothing sent")
        return 0

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        sys.exit("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")

    headers = {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    }

    response = requests.post(
        "%s/rest/v1/places?on_conflict=source_key" % url.rstrip("/"),
        headers={**headers, "Prefer": "resolution=merge-duplicates,return=representation"},
        data=json.dumps(rows, ensure_ascii=False).encode("utf-8"),
        timeout=60,
    )
    if response.status_code >= 300:
        sys.exit("write failed %s: %s" % (response.status_code, response.text[:400]))

    written = response.json()
    print("\nupserted %d rows" % len(written))
    for row in written:
        print("  %s  %-24s %s" % (row["id"], row["name_he"][:24], row["status"]))

    # One vouch each for the places a reservist actually stood in.
    reports = [
        {
            "place_id": row["id"],
            "kind": "new_submission",
            "benefit_type": "fighter_card",
            "note": None,
            "ip_hash": "reported-by-message",
        }
        for row in written
        if row["source_key"] in witnessed_keys
    ]
    if reports:
        report_response = requests.post(
            "%s/rest/v1/reports" % url.rstrip("/"),
            headers={**headers, "Prefer": "return=minimal"},
            data=json.dumps(reports, ensure_ascii=False).encode("utf-8"),
            timeout=60,
        )
        if report_response.status_code >= 300:
            sys.exit("report write failed %s: %s"
                     % (report_response.status_code, report_response.text[:400]))
        print("\n%d vouches recorded, one per witnessed place" % len(reports))

    print("\nLoad the site twice before concluding anything is wrong: this writes")
    print("straight to PostgREST, so revalidatePath never runs and the homepage")
    print("serves its cached copy until the window expires.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
