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
import sys
import uuid

import requests

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


def submission(place_id: str, name: str, **overrides) -> dict:
    body = {
        "googlePlaceId": place_id,
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

    # A fresh id per run, so the script is rerunnable without a database reset.
    gpid = "ChIJ_test_" + uuid.uuid4().hex[:12]

    print("A. somebody adds a place")
    status, body = post("/api/submissions", submission(gpid, "בורגר בדיקה"), "10.0.0.1")
    check("a new place is accepted", status, 200)
    check("and waits for a second opinion", body.get("outcome"), "pending")
    place_id = body.get("placeId")
    if not place_id:
        print("\nno placeId came back, cannot continue")
        return 1

    status, body = post("/api/submissions",
                        submission(gpid, "בורגר בדיקה", benefitVacationVoucher=True),
                        "10.0.0.1")
    check("the same person again is not a second opinion",
          body.get("outcome"), "confirmed_existing")

    detail = requests.get(f"{BASE}/place/{place_id}", timeout=30)
    check("a pending place is not readable yet", detail.status_code, 404)

    status, body = post("/api/submissions", submission(gpid, "בורגר בדיקה"), "10.0.0.2")
    check("a second person confirms it", body.get("outcome"), "confirmed_existing")

    detail = requests.get(f"{BASE}/place/{place_id}", timeout=30)
    check("two independent people publish it", detail.status_code, 200)
    check("and the page carries the name", "בורגר בדיקה" in detail.text, True)
    check("the voucher benefit the first person added survived",
          "שובר חופשה" in detail.text, True)

    near = requests.get(f"{BASE}/api/places/near?lat=32.0853&lng=34.7818&radius=2000",
                        timeout=30).json()
    check("places_near finds it through the API",
          any(p["id"] == place_id for p in near.get("places", [])), True)

    print("\nB. somebody reports it stopped working")
    for i, ip in enumerate(("10.0.0.3", "10.0.0.3", "10.0.0.3"), start=1):
        post("/api/reports", {"placeId": place_id, "kind": "not_working"}, ip)
    detail = requests.get(f"{BASE}/place/{place_id}", timeout=30)
    check("three taps from one person do not flip it",
          "דווח שלא עבד" in detail.text, False)

    post("/api/reports", {"placeId": place_id, "kind": "not_working"}, "10.0.0.4")
    post("/api/reports", {"placeId": place_id, "kind": "not_working"}, "10.0.0.5")
    detail = requests.get(f"{BASE}/place/{place_id}", timeout=30)
    check("three independent reporters flip it", "דווח שלא עבד" in detail.text, True)
    check("and it is still readable, not hidden", detail.status_code, 200)

    near = requests.get(f"{BASE}/api/places/near?lat=32.0853&lng=34.7818&radius=2000",
                        timeout=30).json()
    check("a flipped place stays on the map",
          any(p["id"] == place_id for p in near.get("places", [])), True)

    print("\nC. what the endpoints refuse")
    status, body = post("/api/reports", {"placeId": "not-a-uuid", "kind": "confirm"}, "10.0.0.9")
    check("a malformed id is rejected", status, 400)
    status, body = post("/api/reports",
                        {"placeId": str(uuid.uuid4()), "kind": "confirm"}, "10.0.0.9")
    check("a report for a place that does not exist", status, 404)
    status, body = post("/api/submissions",
                        submission("ChIJ_x", "x", benefitFighterCard=False), "10.0.0.9")
    check("a submission with no benefit selected", status, 400)
    check("and it says so in Hebrew", "הטבה" in body.get("error", ""), True)
    status, body = post("/api/reports",
                        {"placeId": place_id, "kind": "confirm", "note": "x" * 201},
                        "10.0.0.9")
    check("an over-long note", status, 400)

    print("\nD. the rate limit")
    limited_at = None
    for attempt in range(1, 8):
        status, body = post("/api/reports",
                            {"placeId": place_id, "kind": "confirm"}, "10.0.0.20")
        if status == 429:
            limited_at = attempt
            break
    check("five reports an hour, then a refusal", limited_at, 6)

    print("\nE. moderation")
    status, body = post("/api/admin", {"action": "list", "password": "wrong"}, "10.0.0.30")
    check("a wrong password is refused", status, 401)

    status, body = post("/api/admin",
                        {"action": "list", "password": args.admin_password}, "10.0.0.30")
    check("the queue loads", status, 200)
    check("and the flipped place is in it",
          any(row["id"] == place_id for row in body.get("flagged", [])), True)

    status, body = post("/api/admin",
                        {"action": "restore", "placeId": place_id,
                         "password": args.admin_password}, "10.0.0.30")
    check("a moderator restores it", status, 200)

    post("/api/reports", {"placeId": place_id, "kind": "not_working"}, "10.0.0.6")
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
