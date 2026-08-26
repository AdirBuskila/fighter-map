#!/usr/bin/env python3
"""
End-to-end test of the two flows through the actual route handlers.

The trust rules are tested at the database level in
supabase/tests/trust_rules.sql. This covers everything above that: Zod
validation, the rate limiter, the duplicate-submission branch, and in
particular whether PostgREST accepts the EWKT literal the submission route
sends for a geography column, which raw SQL cannot tell you.

Needs the local stack and the dev server:

    npx supabase start
    npm run dev
    python scripts/test_api.py

Reporters are distinguished by X-Forwarded-For, which is what the route hashes,
so one process can act as several people.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid

import requests

CATEGORIES = {
    "restaurant", "cafe", "hotel", "zimmer", "spa", "clothing", "shoes",
    "sports", "electronics", "toys", "jewelry", "attraction", "gov_service",
    "other",
}

BASE = "http://localhost:3000"
PASSED, FAILED = [], []


def check(label: str, actual, expected) -> None:
    if actual == expected:
        PASSED.append(label)
        print("  ok    %-52s %s" % (label, actual))
    else:
        FAILED.append(label)
        print("  FAIL  %-52s expected %r, got %r" % (label, expected, actual))


def post(path: str, body: dict, ip: str) -> tuple:
    response = requests.post(
        BASE + path,
        json=body,
        headers={"X-Forwarded-For": ip, "Content-Type": "application/json"},
        timeout=30,
    )
    try:
        return response.status_code, response.json()
    except json.JSONDecodeError:
        return response.status_code, {"raw": response.text[:200]}


def submission(provider_ref: str, name: str, **overrides) -> dict:
    body = {
        "providerRef": provider_ref,
        "nameHe": name,
        "lat": 32.0853,
        "lng": 34.7818,
        "addressHe": "דיזנגוף 1, תל אביב",
        "city": "תל אביב",
        "category": "restaurant",
        "benefitFighterCard": True,
        "benefitVacationVoucher": False,
    }
    body.update(overrides)
    return body


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser()
    ap.add_argument("--admin-password", default="local-test-password")
    args = ap.parse_args()

    try:
        requests.get(BASE, timeout=10)
    except requests.RequestException:
        sys.exit("the dev server is not answering on %s. Run npm run dev." % BASE)

    # A fresh id AND a fresh set of reporters per run. The rate limit is per
    # reporter per hour and counted in the database, so reusing fixed addresses
    # would make the second run of the day fail on the first request.
    run = uuid.uuid4().hex[:12]
    ref = "osm:node/9" + run[:8]

    actors: dict = {}

    def ip(label: str) -> str:
        """A stable, valid address per actor, unique to this run."""
        actors.setdefault(label, len(actors) + 1)
        return "198.51.%d.%d" % (int(run[:2], 16), actors[label])

    print("A. somebody adds a place")
    status, body = post("/api/submissions", submission(ref, "בורגר בדיקה"), ip("alice"))
    check("a new place is accepted", status, 200)
    check("and it is on the map at once", body.get("outcome"), "published")
    place_id = body.get("placeId")
    if not place_id:
        print("\nno placeId came back, cannot continue")
        return 1

    detail = requests.get(f"{BASE}/place/{place_id}", timeout=30)
    check("the place is readable immediately", detail.status_code, 200)
    check("and says plainly that one person reported it",
          "דיווח אחד" in detail.text, True)

    status, body = post("/api/submissions",
                        submission(ref, "בורגר בדיקה", benefitVacationVoucher=True),
                        ip("alice"))
    check("the same person again is not a second opinion",
          body.get("outcome"), "confirmed_existing")

    detail = requests.get(f"{BASE}/place/{place_id}", timeout=30)
    check("so it is still standing on one report", "דיווח אחד" in detail.text, True)

    status, body = post("/api/submissions", submission(ref, "בורגר בדיקה"), ip("bob"))
    check("a second person confirms it", body.get("outcome"), "confirmed_existing")

    detail = requests.get(f"{BASE}/place/{place_id}", timeout=30)
    check("two independent people fill the mark in",
          "דיווח אחד" in detail.text, False)
    check("and the page carries the name", "בורגר בדיקה" in detail.text, True)
    check("the voucher benefit the first person added survived",
          "שובר חופשה" in detail.text, True)

    near = requests.get(f"{BASE}/api/places/near?lat=32.0853&lng=34.7818&radius=2000",
                        timeout=30).json()
    check("places_near finds it through the API",
          any(p["id"] == place_id for p in near.get("places", [])), True)

    print("\nB. somebody reports it stopped working")
    carol = ip("carol")
    for _ in range(3):
        post("/api/reports", {"placeId": place_id, "kind": "not_working"}, carol)
    detail = requests.get(f"{BASE}/place/{place_id}", timeout=30)
    check("three taps from one person do not flip it",
          "דווח שלא עבד" in detail.text, False)

    post("/api/reports", {"placeId": place_id, "kind": "not_working"}, ip("dave"))
    post("/api/reports", {"placeId": place_id, "kind": "not_working"}, ip("erin"))
    detail = requests.get(f"{BASE}/place/{place_id}", timeout=30)
    check("three independent reporters flip it", "דווח שלא עבד" in detail.text, True)
    check("and it is still readable, not hidden", detail.status_code, 200)

    near = requests.get(f"{BASE}/api/places/near?lat=32.0853&lng=34.7818&radius=2000",
                        timeout=30).json()
    check("a flipped place stays on the map",
          any(p["id"] == place_id for p in near.get("places", [])), True)

    print("\nC. one report is enough when one person is all there is")
    # The counterweight to publishing on arrival. Section B just showed that a
    # corroborated place takes three independent reporters to pull. A place
    # nobody has backed up must not: if adding costs one person and removing
    # costs three, a map anybody can write to fills with noise it cannot shed.
    solo_ref = "osm:node/7" + run[:8]
    status, body = post("/api/submissions",
                        submission(solo_ref, "פלאפל בדיקה"), ip("nina"))
    check("a second place is added by one person", status, 200)
    solo_id = body.get("placeId")

    post("/api/reports", {"placeId": solo_id, "kind": "not_working"}, ip("omer"))
    detail = requests.get(f"{BASE}/place/{solo_id}", timeout=30)
    check("and one report takes it straight back off",
          "דווח שלא עבד" in detail.text, True)

    print("\nD. what the endpoints refuse")
    status, body = post("/api/reports", {"placeId": "not-a-uuid", "kind": "confirm"}, ip("bad"))
    check("a malformed id is rejected", status, 400)
    status, body = post("/api/reports",
                        {"placeId": str(uuid.uuid4()), "kind": "confirm"}, ip("bad"))
    check("a report for a place that does not exist", status, 404)
    status, body = post("/api/submissions",
                        submission("osm:node/1", "x", benefitFighterCard=False), ip("bad"))
    check("a submission with no benefit selected", status, 400)
    check("and it says so in Hebrew", "הטבה" in body.get("error", ""), True)
    status, body = post("/api/reports",
                        {"placeId": place_id, "kind": "confirm", "note": "x" * 201},
                        ip("bad"))
    check("an over-long note", status, 400)

    print("\nE. the rate limit")
    # A reporter who has spent nothing yet, so the count starts at zero
    # however many times this script has run in the last hour.
    flooder = ip("flood")
    limited_at = None
    for attempt in range(1, 8):
        status, body = post("/api/reports",
                            {"placeId": place_id, "kind": "confirm"}, flooder)
        if status == 429:
            limited_at = attempt
            break
    check("five reports an hour, then a refusal", limited_at, 6)

    print(chr(10) + "F. place search")
    # The one piece with an external dependency, so worth asserting on rather
    # than assuming. Castro is a big chain and well mapped in OSM.
    found = requests.get(f"{BASE}/api/search",
                         params={"q": "קסטרו", "limit": 5}, timeout=30)
    check("search answers", found.status_code, 200)
    hits = found.json().get("results", [])
    check("and finds a well known chain", len(hits) > 0, True)
    if hits:
        check("every hit carries an osm ref",
              all(h["providerRef"].startswith("osm:") for h in hits), True)
        check("and real coordinates",
              all(isinstance(h["lat"], float) for h in hits), True)
        check("and a category the app understands",
              all(h["category"] in CATEGORIES for h in hits), True)
    short = requests.get(f"{BASE}/api/search", params={"q": "a"}, timeout=30)
    check("a one letter query is not sent upstream", short.json().get("results"), [])

    print(chr(10) + "G. pinning a place the geocoders could not find")
    # A few hundred imported places have no coordinates because OSM simply
    # does not know them. The queue lets a moderator search and pin one,
    # which is their only path onto the map.
    svc = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    base = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    if svc and base:
        made = requests.post(
            base + "/rest/v1/places",
            headers={"apikey": svc, "Authorization": "Bearer " + svc,
                     "Content-Type": "application/json",
                     "Prefer": "return=representation"},
            json=[{"source_key": "unlocated:test-" + run,
                   "name_he": "מקום בלי נקודה",
                   "category": "other", "source": "pdf_import", "status": "pending",
                   "review_reason": "no_osm_match", "benefit_fighter_card": True}],
            timeout=30).json()
        check("a place with no pin can sit in the queue", len(made), 1)
        pinless = made[0]["id"]

        status, _ = post("/api/admin", {"action": "locate", "placeId": pinless,
                                        "password": args.admin_password}, ip("mod"))
        check("locate with nothing chosen is refused", status, 400)

        status, _ = post("/api/admin", {
            "action": "locate", "placeId": pinless, "password": args.admin_password,
            "location": {"providerRef": "osm:node/8" + run[:8], "lat": 32.0853,
                         "lng": 34.7818,
                         "addressHe": "דיזנגוף 1",
                         "city": "תל אביב"}}, ip("mod"))
        check("a moderator pins it", status, 200)

        detail = requests.get(f"{BASE}/place/{pinless}", timeout=30)
        check("and it becomes published and readable", detail.status_code, 200)
        near = requests.get(f"{BASE}/api/places/near",
                            params={"lat": 32.0853, "lng": 34.7818, "radius": 2000},
                            timeout=30).json()
        check("and it answers what is near me",
              any(p["id"] == pinless for p in near.get("places", [])), True)
    else:
        print("  skipped, no service role key in the environment")

    print("\nH. moderation")
    status, body = post("/api/admin", {"action": "list", "password": "wrong"}, ip("mod"))
    check("a wrong password is refused", status, 401)

    status, body = post("/api/admin",
                        {"action": "list", "password": args.admin_password}, ip("mod"))
    check("the queue loads", status, 200)
    check("and the flipped place is in it",
          any(row["id"] == place_id for row in body.get("flagged", [])), True)

    status, body = post("/api/admin",
                        {"action": "restore", "placeId": place_id,
                         "password": args.admin_password}, ip("mod"))
    check("a moderator restores it", status, 200)

    post("/api/reports", {"placeId": place_id, "kind": "not_working"}, ip("frank"))
    detail = requests.get(f"{BASE}/place/{place_id}", timeout=30)
    check("and one new report does not re-flip it",
          "דווח שלא עבד" in detail.text, False)

    print("\n%d passed, %d failed" % (len(PASSED), len(FAILED)))
    if FAILED:
        for label in FAILED:
            print("  failed: %s" % label)
        return 1
    print("both flows work end to end")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
