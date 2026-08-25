#!/usr/bin/env python3
"""
Phase 2 - turn raw spreadsheet cells into canonical place records.

A cell is free text written by a reservist on their phone. One cell can hold
several places, a phone number, a URL mangled by the PDF's bidi layout, an
editorial aside, or a report that a place STOPPED honouring the card. Claude
does the reading; this script does the bookkeeping around it.

    raw_rows.json
      -> one cell per (row, benefit type)
      -> collapse identical cell texts (many are reported verbatim twice)
      -> Claude, batched, structured output          [cached on disk]
      -> expand back to every source occurrence
      -> scrub private mobile numbers
      -> fuzzy dedup + brand alias merge
      -> normalized.json + needs_review.json

Idempotent and resumable. Every Claude response is cached in
data/llm_cache.json keyed by (prompt version, model, cell text), so a rerun
after a crash costs nothing for work already done, and re-running after a
prompt edit only re-asks what actually changed.

Usage:
    python scripts/02_normalize.py                  # full run
    python scripts/02_normalize.py --limit 50       # try it on 50 cells
    python scripts/02_normalize.py --offline        # cache only, no API calls
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IN_PATH = ROOT / "data" / "raw_rows.json"
OUT_PATH = ROOT / "data" / "normalized.json"
REVIEW_PATH = ROOT / "data" / "needs_review.json"
CACHE_PATH = ROOT / "data" / "llm_cache.json"

DEFAULT_MODEL = "claude-sonnet-4-6"
BATCH_SIZE = 25

# Bump when the prompt or schema changes; old cache entries are then ignored
# instead of silently mixing two generations of output.
PROMPT_VERSION = "v1"

CATEGORIES = [
    "restaurant", "cafe", "hotel", "zimmer", "spa", "clothing", "shoes",
    "sports", "electronics", "toys", "jewelry", "attraction", "gov_service",
    "other",
]
KINDS = ["single_location", "chain", "online_only", "unclear"]

MIN_CONFIDENCE = 0.6
FUZZ_THRESHOLD = 88

# --------------------------------------------------------------- the prompt

SYSTEM_PROMPT = """\
You normalise crowd-sourced Hebrew reports about where an Israeli reservist \
benefit card was accepted. Each input cell is free text typed by a member of \
the public, extracted from a PDF of a Google Sheet.

Return one entry per DISTINCT PLACE mentioned in a cell. A cell may contain \
zero, one, or several places.

Field rules:

name_he      The canonical Hebrew name of the business, cleaned. Drop opinions \
             ("ממליץ מאוד"), drop the city when it is a separate word you put \
             in city_hint, keep the name a human would search for. Never \
             invent a name that is not in the text.
name_en      The Latin-script brand name IF this is a brand that is commonly \
             written in Latin letters (Skechers, Fox, H&M, Castro, Decathlon, \
             Renuar, Zara, Adidas, Mania Jeans, Golf). Otherwise null. This is \
             used to merge Hebrew and Latin spellings of one brand, so be \
             consistent: always spell a given brand the same way.
city_hint    The Israeli city, town, moshav or kibbutz if stated. Otherwise \
             null. A mall or branch name is not a city.
kind         single_location - one specific branch or venue.
             chain           - a national brand with many branches and no \
                               branch given in the text.
             online_only     - a website or online service with no physical \
                               location (an online licence renewal, a website \
                               purchase, a delivery app).
             unclear         - you cannot tell what business this is, or the \
                               text is a comment rather than a place.
category     One of: restaurant, cafe, hotel, zimmer, spa, clothing, shoes, \
             sports, electronics, toys, jewelry, attraction, gov_service, \
             other. zimmer means a rural guest cabin. Use other rather than \
             guessing.
phone        An Israeli phone number if present, digits and dashes only. \
             Otherwise null.
phone_kind   business  - the number is published for a business (a hotel \
                         desk, a restaurant, a landline).
             personal  - the number looks like a private individual's mobile, \
                         for example a small zimmer or workshop run by one \
                         person who left their own number.
             none      - no phone in the text.
             When you are unsure between business and personal, say personal.
url          A URL if present. The PDF's right-to-left layout scrambles \
             URLs: slashes and the scheme get moved around, so "/https:/" and \
             "/www.example.co.il" in one cell means "https://www.example.co.il". \
             Reconstruct the intended URL. Otherwise null.
note_he      A short useful Hebrew note the reader needs, for example a \
             restriction ("רק בסניף הגדול", "דרך האתר בלבד"). Not an opinion, \
             not a repeat of the name. Otherwise null. Maximum 120 characters. \
             Sentence case, no exclamation marks, and never use an em dash.
status       reported_not_working - the writer says it did NOT work, stopped \
                                    working, or contradicts an earlier report \
                                    ("מופיע שאפשר, מסתבר שאי אפשר").
             works                - anything else.
confidence   0.0 to 1.0. How sure you are that name_he identifies a real \
             findable business. Text that is a person's name, a testimonial, \
             or too vague to search for gets below 0.6.

If a cell contains no identifiable place at all, return an empty places list \
for it.

Return every input index exactly once, in order."""

PLACE_SCHEMA = {
    "type": "object",
    "properties": {
        "name_he": {"type": "string"},
        "name_en": {"type": ["string", "null"]},
        "city_hint": {"type": ["string", "null"]},
        "kind": {"type": "string", "enum": KINDS},
        "category": {"type": "string", "enum": CATEGORIES},
        "phone": {"type": ["string", "null"]},
        "phone_kind": {"type": "string", "enum": ["business", "personal", "none"]},
        "url": {"type": ["string", "null"]},
        "note_he": {"type": ["string", "null"]},
        "status": {"type": "string", "enum": ["works", "reported_not_working"]},
        "confidence": {"type": "number"},
    },
    "required": [
        "name_he", "name_en", "city_hint", "kind", "category", "phone",
        "phone_kind", "url", "note_he", "status", "confidence",
    ],
    "additionalProperties": False,
}

BATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "cells": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "places": {"type": "array", "items": PLACE_SCHEMA},
                },
                "required": ["index", "places"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["cells"],
    "additionalProperties": False,
}

# ------------------------------------------------------------ text helpers

GERESH = dict.fromkeys(map(ord, "׳'’`′"), "'")
GERSHAYIM = dict.fromkeys(map(ord, "״“”″"), '"')
# Hebrew digraphs first, so ג' becomes j rather than g + quote.
DIGRAPHS = [("ג'", "j"), ("צ'", "ch"), ("ז'", "zh"), ("ת'", "th"), ("ד'", "dh")]
TRANSLIT = {
    "א": "", "ב": "b", "ג": "g", "ד": "d", "ה": "h", "ו": "v", "ז": "z",
    "ח": "h", "ט": "t", "י": "y", "כ": "k", "ך": "k", "ל": "l", "מ": "m",
    "ם": "m", "נ": "n", "ן": "n", "ס": "s", "ע": "", "פ": "p", "ף": "p",
    "צ": "ts", "ץ": "ts", "ק": "k", "ר": "r", "ש": "sh", "ת": "t",
}

# Israeli mobile prefixes. A 05x number is the one shape that is plausibly a
# private individual's, so it is the one we are careful with.
MOBILE_RE = re.compile(r"\b0(5\d)[\s\-.]?(\d{3})[\s\-.]?(\d{4})\b")


def canon(text: str) -> str:
    """Fold a name to a comparable form: no punctuation, no case, no quotes."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).translate(GERESH).translate(GERSHAYIM)
    text = text.lower()
    text = re.sub(r"[^\w\s']", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def skeleton(text: str) -> str:
    """Consonant skeleton, so Hebrew and Latin spellings of a brand can meet.

    סקצ'רס -> skchrs, skechers -> skchrs.
    """
    text = canon(text)
    for heb, lat in DIGRAPHS:
        text = text.replace(heb, lat)
    out = []
    for ch in text:
        if ch in TRANSLIT:
            out.append(TRANSLIT[ch])
        elif ch.isascii() and ch.isalpha():
            out.append("" if ch in "aeiou" else ch)
        elif ch.isdigit():
            out.append(ch)  # "עידן 2000" and "עידו 2000" only differ outside the digits
        elif ch.isspace():
            out.append(" ")
    return re.sub(r"\s+", " ", "".join(out)).strip()


# Brands the source data spells several ways. Keys are skeletons; the value is
# the spelling we publish. Extend this as the review queue turns up more.
BRAND_ALIASES = {
    "ydn 2000": "עידן 2000",       # עידן 2000
    "ydv 2000": "עידן 2000",       # עידו 2000, a typo in the source sheet
    "skchrs": "סקצ'רס",            # סקצ'רס / skechers
    "skchr": "סקצ'רס",             # סקצ׳ר
    "skttsrs": "סקצ'רס",           # סקטצרס
    "mnyh jyns": "מאניה ג'ינס",    # מאניה ג׳ינס / מניה ג׳ינס
    "mnyh gyns": "מאניה ג'ינס",    # מאניה גינס
    "mn jns": "מאניה ג'ינס",       # Mania jeans / jeans Mania
}


def _alias_key(text: str) -> str:
    """Word order varies ("Mania jeans" / "jeans Mania"), so sort the tokens."""
    return " ".join(sorted(skeleton(text).split()))


_ALIAS_INDEX = {_alias_key(k): v for k, v in BRAND_ALIASES.items()}


def alias_of(name_he: str, name_en: str | None) -> str | None:
    for candidate in (name_en, name_he):
        if candidate:
            hit = _ALIAS_INDEX.get(_alias_key(candidate))
            if hit:
                return hit
    return None


def scrub_phone(place: dict, keep_personal: bool) -> dict:
    """Drop private individuals' mobile numbers before anything is published."""
    phone = place.get("phone")
    if not phone:
        place["phone"] = None
        return place
    is_mobile = bool(MOBILE_RE.search(phone))
    personal = place.get("phone_kind") == "personal" or (
        is_mobile and place.get("phone_kind") != "business"
    )
    if personal and not keep_personal:
        place["phone"] = None
        place["phone_redacted"] = True
    return place


def strip_mobiles(text: str | None) -> str | None:
    """Belt and braces: no raw mobile survives into a published note."""
    if not text:
        return text
    return re.sub(MOBILE_RE, "", text).strip(" ,-") or None


def mask_mobiles(text: str | None) -> str | None:
    """Keep the shape of the source text for the admin queue, lose the number."""
    if not text:
        return text
    return MOBILE_RE.sub("05X-XXXXXXX", text)


# ------------------------------------------------------------ cell assembly


def collect_cells(rows: list) -> tuple:
    """Return (unique_texts, occurrences) where occurrences[text] is a list of
    every (benefit, reported_at, page, row) that produced that exact text."""
    occurrences = defaultdict(list)
    for r in rows:
        for field, benefit in (
            ("fighter_card", "fighter_card"),
            ("vacation_voucher", "vacation_voucher"),
        ):
            text = (r.get(field) or "").strip()
            if not text:
                continue
            occurrences[text].append(
                {
                    "benefit": benefit,
                    "reported_at": r.get("reported_at"),
                    "page": r.get("page"),
                    "row": r.get("row"),
                }
            )
    return list(occurrences.keys()), occurrences


# ------------------------------------------------------------------- cache


def cache_key(model: str, text: str) -> str:
    raw = "\x00".join([PROMPT_VERSION, model, text])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def load_cache(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print("  cache is corrupt, starting a fresh one", file=sys.stderr)
    return {}


def save_cache(path: Path, cache: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


# --------------------------------------------------------------- the model


def build_client(model: str):
    try:
        import anthropic
    except ImportError:
        sys.exit("pip install -r requirements.txt (anthropic SDK missing)")
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        # An `ant auth login` profile also works, so only warn.
        print("  note: no ANTHROPIC_API_KEY in env, relying on an ant profile")
    return anthropic.Anthropic(max_retries=5)


def ask_batch(client, model: str, texts: list) -> dict:
    """Normalise up to BATCH_SIZE cells. Returns {index: [place, ...]}."""
    numbered = "\n".join("%d. %s" % (i, t) for i, t in enumerate(texts))
    response = client.messages.create(
        model=model,
        max_tokens=16000,
        system=SYSTEM_PROMPT,
        thinking={"type": "adaptive"},
        output_config={
            "effort": "medium",
            "format": {"type": "json_schema", "schema": BATCH_SCHEMA},
        },
        messages=[{"role": "user", "content": "Cells:\n" + numbered}],
    )
    text = next(b.text for b in response.content if b.type == "text")
    data = json.loads(text)
    return {c["index"]: c["places"] for c in data["cells"]}


def normalise_texts(client, model: str, texts: list, cache: dict, cache_path: Path,
                    batch_size: int, offline: bool) -> dict:
    """Fill the cache for every text. Returns {text: [place, ...]}."""
    pending = [t for t in texts if cache_key(model, t) not in cache]
    if pending and offline:
        print("  offline: %d of %d cells are not cached and will be skipped"
              % (len(pending), len(texts)))
    elif pending:
        print("  %d of %d cells need Claude (%d already cached)"
              % (len(pending), len(texts), len(texts) - len(pending)))
        for start in range(0, len(pending), batch_size):
            batch = pending[start:start + batch_size]
            for attempt in range(3):
                try:
                    result = ask_batch(client, model, batch)
                    break
                except Exception as exc:  # parse failure, transient API error
                    if attempt == 2:
                        print("    batch at %d failed: %s" % (start, exc), file=sys.stderr)
                        result = {}
                        break
                    time.sleep(2 ** attempt)
            for i, text in enumerate(batch):
                if i in result:
                    cache[cache_key(model, text)] = result[i]
            save_cache(cache_path, cache)  # resumable after every batch
            print("    %d/%d cells" % (min(start + batch_size, len(pending)), len(pending)))

    return {t: cache[cache_key(model, t)] for t in texts if cache_key(model, t) in cache}


# ------------------------------------------------------------------- dedup


def dedup_group(place: dict) -> str:
    """Blocking key. Only places in the same group are compared pairwise."""
    if place["kind"] == "chain":
        return "chain"
    if place["kind"] == "online_only":
        return "online"
    return "loc:" + canon(place.get("city") or "")


def same_place(a: dict, b: dict, threshold: int) -> bool:
    """Is this the same business under two spellings?

    token_set_ratio alone is not enough: it scores a subset as a perfect 100, so
    `מלון דן` would swallow `מלון דן פנורמה` and `BBB` would swallow `BBB Kids`.
    Requiring token_sort_ratio as well restores length sensitivity. Cross-script
    matching is deliberately NOT fuzzy - a vowel-free consonant skeleton makes
    short names collide (`H&O` scored against `S.H Grooming`), so Hebrew and
    Latin spellings meet only through the alias table or an identical name_en.

    Anything this misses is not lost: Phase 3 resolves single locations to a
    Google place_id, which is unique in the database and merges them there.
    """
    from rapidfuzz import fuzz

    if a.get("alias") and a["alias"] == b.get("alias"):
        return True
    en_a, en_b = canon(a.get("name_en") or ""), canon(b.get("name_en") or "")
    if en_a and en_a == en_b:
        return True
    na, nb = canon(a["name_he"]), canon(b["name_he"])
    if na == nb:
        return True
    return (
        fuzz.token_set_ratio(na, nb) >= threshold
        and fuzz.token_sort_ratio(na, nb) >= threshold
    )


def merge_places(places: list, threshold: int) -> list:
    """Fuzzy-merge by name, keeping the widest set of benefits and dates.

    A national chain merges on brand alone. A single location must also agree on
    city, otherwise `לחם בשר` and `לחם בשר ירושלים` collapse into one card.
    """
    groups = defaultdict(list)
    for p in places:
        groups[dedup_group(p)].append(p)

    merged = []
    for group in groups.values():
        # Longest name first, so the fuller spelling becomes the canonical one.
        group.sort(key=lambda p: (-len(p["name_he"]), p["name_he"]))
        clusters = []
        for p in group:
            target = next((c for c in clusters if same_place(p, c[0], threshold)), None)
            if target is not None:
                target.append(p)
            else:
                clusters.append([p])
        merged.extend(collapse(c) for c in clusters)
    return merged


def collapse(cluster: list) -> dict:
    """Fold one cluster of duplicate reports into a single record."""
    head = dict(cluster[0])
    if head.get("alias"):
        head["name_he"] = head["alias"]

    dates = sorted(d for p in cluster for d in p["reported_dates"] if d)
    notes, sources = [], []
    for p in cluster:
        if p.get("note_he") and p["note_he"] not in notes:
            notes.append(p["note_he"])
        sources.extend(p["sources"])

    head["benefit_fighter_card"] = any(p["benefit_fighter_card"] for p in cluster)
    head["benefit_vacation_voucher"] = any(p["benefit_vacation_voucher"] for p in cluster)
    head["note_he"] = strip_mobiles(" ".join(notes)[:200] or None)
    head["first_reported_at"] = dates[0] if dates else None
    head["last_reported_at"] = dates[-1] if dates else None
    head["report_count"] = len(sources)
    head["sources"] = sources
    head["merged_names"] = sorted({p["name_he"] for p in cluster})
    head["confidence"] = max(p["confidence"] for p in cluster)
    # One "it stopped working" report is worth surfacing even if others differ.
    head["status"] = (
        "reported_not_working"
        if any(p["status"] == "reported_not_working" for p in cluster)
        else "works"
    )
    for key in ("city", "phone", "url", "name_en"):
        head[key] = next((p.get(key) for p in cluster if p.get(key)), None)
    head.pop("reported_dates", None)
    head.pop("alias", None)
    return head


# -------------------------------------------------------------------- main


def build_records(by_text: dict, occurrences: dict, keep_personal: bool) -> list:
    records = []
    for text, places in by_text.items():
        occ = occurrences[text]
        for place in places:
            p = scrub_phone(dict(place), keep_personal)
            records.append(
                {
                    "name_he": p["name_he"].strip(),
                    "name_en": (p.get("name_en") or None),
                    "city": (p.get("city_hint") or None),
                    "kind": p["kind"],
                    "category": p["category"],
                    "phone": p.get("phone"),
                    "phone_redacted": p.get("phone_redacted", False),
                    "url": p.get("url") or None,
                    "note_he": strip_mobiles(p.get("note_he")),
                    "status": p["status"],
                    "confidence": float(p["confidence"]),
                    "is_chain": p["kind"] == "chain",
                    "is_online": p["kind"] == "online_only",
                    "benefit_fighter_card": any(o["benefit"] == "fighter_card" for o in occ),
                    "benefit_vacation_voucher": any(
                        o["benefit"] == "vacation_voucher" for o in occ
                    ),
                    "reported_dates": [o["reported_at"] for o in occ if o["reported_at"]],
                    "sources": [
                        {"page": o["page"], "row": o["row"], "benefit": o["benefit"],
                         "raw": text if keep_personal else mask_mobiles(text)}
                        for o in occ
                    ],
                    "alias": alias_of(p["name_he"], p.get("name_en")),
                }
            )
    return records


def report(records: list, merged: list, review: list, cells: int) -> None:
    print("\n" + "=" * 62)
    print("CHECKPOINT 2")
    print("=" * 62)
    print("cells sent to Claude        : %d" % cells)
    print("places extracted            : %d" % len(records))
    print("after dedup                 : %d" % len(merged))
    if records:
        print("dedup collapse ratio        : %.1f%% (%d rows removed)"
              % (100 * (1 - len(merged) / len(records)), len(records) - len(merged)))
    print("routed to needs_review.json : %d" % len(review))

    for label, key in (("kind", "kind"), ("category", "category"), ("status", "status")):
        print("\nby %s:" % label)
        for value, n in Counter(m[key] for m in merged).most_common():
            print("  %-18s %4d" % (value, n))

    print("\nbenefit coverage:")
    print("  fighter card       %4d" % sum(m["benefit_fighter_card"] for m in merged))
    print("  vacation voucher   %4d" % sum(m["benefit_vacation_voucher"] for m in merged))
    print("  both               %4d" % sum(
        m["benefit_fighter_card"] and m["benefit_vacation_voucher"] for m in merged))

    multi = [m for m in merged if len(m["merged_names"]) > 1]
    print("\nmerged spellings (%d groups), first 15:" % len(multi))
    for m in multi[:15]:
        print("  %-28s <- %s" % (m["name_he"], " | ".join(m["merged_names"])))

    print("\n20 entries from needs_review.json:")
    for r in review[:20]:
        print("  [%.2f %-14s] %-30s  raw: %s"
              % (r["confidence"], r["kind"], r["name_he"][:30],
                 (r["sources"][0]["raw"] if r["sources"] else "")[:60]))


def main() -> None:
    # Hebrew in a Windows console needs this or the report prints as mojibake.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Normalise raw cells into place records")
    ap.add_argument("--in", dest="src", type=Path, default=IN_PATH)
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    ap.add_argument("--review", type=Path, default=REVIEW_PATH)
    ap.add_argument("--cache", type=Path, default=CACHE_PATH)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    ap.add_argument("--threshold", type=int, default=FUZZ_THRESHOLD)
    ap.add_argument("--limit", type=int, help="only process the first N cells")
    ap.add_argument("--offline", action="store_true", help="use the cache, never call the API")
    ap.add_argument("--keep-personal-phones", action="store_true",
                    help="do not redact private mobile numbers (never for committed data)")
    args = ap.parse_args()

    rows = json.loads(args.src.read_text(encoding="utf-8"))
    texts, occurrences = collect_cells(rows)
    if args.limit:
        texts = texts[: args.limit]
    print("%d rows -> %d cells -> %d unique cell texts"
          % (len(rows), sum(len(v) for v in occurrences.values()), len(texts)))

    cache = load_cache(args.cache)
    client = None if args.offline else build_client(args.model)
    by_text = normalise_texts(client, args.model, texts, cache, args.cache,
                              args.batch_size, args.offline)
    if not by_text:
        sys.exit("nothing normalised: set ANTHROPIC_API_KEY and rerun without --offline")

    records = build_records(by_text, occurrences, args.keep_personal_phones)
    publishable = [r for r in records
                   if r["confidence"] >= MIN_CONFIDENCE and r["kind"] != "unclear"]
    unclear = [r for r in records
               if r["confidence"] < MIN_CONFIDENCE or r["kind"] == "unclear"]

    merged = merge_places(publishable, args.threshold)
    review = merge_places(unclear, args.threshold)

    merged.sort(key=lambda m: (m["kind"], m["name_he"]))
    review.sort(key=lambda m: m["confidence"])

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    args.review.write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding="utf-8")

    report(records, merged, review, len(by_text))
    print("\nwrote %s and %s" % (args.out, args.review))


if __name__ == "__main__":
    main()
