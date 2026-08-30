# Where this is up to

Migrations 0001 to 0006 are applied to the production database. **0007 is
written, committed and NOT applied** — see the top item below. Turnstile is
still open, and so is a queue of 20 pins that predate a fix described further
down.

## 1. Migration 0007 is waiting, and 390 pins are waiting behind it

`supabase/migrations/0007_location_precision.sql` adds `location_precision`
and threads it through the three read RPCs. Until it is applied the column is
absent, the RPCs return 23 fields, `place.location_precision` is `undefined`
in the client, and every comparison against `"town"` is false — so the app
behaves exactly as it did before. Nothing is broken by the wait; nothing is
gained either.

Paste the file into the SQL editor, then:

```bash
python scripts/10_pin_by_town.py --dry-run   # says what it would write
python scripts/10_pin_by_town.py             # writes it
```

That takes the map from **271 pins to about 661**. The 390 it adds are pinned
at their town rather than their doorway, and every one of them says so: faded
on the map, spelled out on its page, and excluded from navigation links. See
"A pin that is only a town" below for why that is a trade worth making and
what defends it.

To check 0007 took:

```sql
select location_precision, count(*) from places
 where location is not null group by 1;
```

Before the pin script that returns one row, `exact`. After it, two.

**The /admin backlog is gone.** It was 482 places; it is now 6. They were not
pinned — they were published without a pin, which is a different and better
answer. See "A place we cannot pin" below.

Migration 0005 **is** applied — that was checked directly rather than assumed,
by calling the function it adds:

```
POST /rest/v1/rpc/place_near_match  ->  200 []
```

200 with an empty array means the function exists and matched nothing. A 404
carrying `PGRST202` would mean it was never run. So a link submission near an
existing place merges onto it instead of laying a duplicate pin, and the note
that used to stand here saying otherwise was stale.

## 1. Turnstile is not configured

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are empty, so the
bot check is skipped. The five-per-hour rate limit still applies, and since
0003 that limit counts an `ip_hash` the server computes rather than one the
caller sends, so it is real. dash.cloudflare.com, five minutes, keys into
Vercel.

## The places people wrote in about are loaded

`scripts/07_add_reported.py` had been written but never actually run, so none
of its rows were in the database. It has now been run: nine places, eight
pinned and published, `reported:oshika-maale-adumim` still waiting in `/admin`
because neither OSM nor Google has a business by that name in Maale Adumim.

Two of them are one business. בת-חן שריג is a shop in בית אל **and** a web shop
at bsarig.com that takes the card from anywhere, and `places_location_shape`
forbids a single row from being both pinned and online, so it is two rows. The
online one carries `provider_ref = null` deliberately: the ftid means "the door
in בית אל", and lending it to the web shop would make a later /add of the
physical shop merge into the online row and lose the pin.

## The August sheet export is folded in

`places.csv`, a later export of the same Google Sheet `fighter.pdf` was
printed from, is now a second input to Phase 1. Of its 998 benefit cells, 925
were already in `raw_rows.json`; **73 were not** and are now loaded:

- **63** reported after the PDF snapshot ended on 2026-08-23
- **10** voucher cells on rows the PDF *did* extract, whose voucher column its
  ruling lines dropped

Those 73 cells normalised to 75 new places and 6 updates to existing ones. 80
rows went to Supabase: 26 published (12 pinned, 14 chains and online shops
that carry no pin by design), 54 waiting in `/admin`. The database went from
935 places to 1009, and no trust counter moved.

Three things worth knowing about that run:

- **קלאב הוטל אילת was already there**, added through `/add` by a reservist
  who also vouched for it. `provider_ref` is unique, so the insert failed
  loudly rather than laying a second pin on the same door, which is the
  constraint doing its job. That row was dropped from the load.
- **Two cells were too vague to pin.** A bare "תמנון" and a bare "קמיליון",
  with no city, where the corpus already knows four תמנון and a קמיליון in
  פתח תקווה. Left at confidence 0.5 they go to `/admin`; at 0.6 the locate
  pass had matched them on name alone and put תמנון on the Beer Sheva row and
  קמיליון near Ma'ale Adumim.
- **Five pins were verified wrong by hand and demoted** before loading, all of
  them matches that cleared the 25 km gate but sat in the wrong town, plus one
  street Nominatim returned instead of a shop. They carry
  `review_reason = wrong_osm_match`.

Phase 2 needed no API key. The 72 distinct new cells were normalised by hand
into `data/csv_handoff.jsonl` and written into the Phase 2 cache with
`scripts/seed_cache.py`, which is what that script is for, so
`02_normalize.py --offline` reproduces the whole corpus from cache.

## 20 live pins predate the city-gate fix

The gate that rejects a candidate too far from the city the reporter named
used to be skipped whenever the locality index could not place that city, and
the index has no node for תל אביב, מודיעין or פרדס חנה. `03_locate.py` and
`03b_locate_remote.py` now refuse the match instead, and POI `addr:city`
medians widen the index. But **20 rows already published carry a pin placed
while the gate was off**, listed in the run that produced them; hand-checking
a sample found מיני אלנבי and מלון דן, both tagged תל אביב, pinned in
Jerusalem. Nothing has been changed about them - they are live, and re-pinning
or retiring them is a call worth making deliberately rather than as a side
effect of an import.

Two smaller things that fix would not catch, both still open:

- **25 km is generous in the centre of the country.** H&M reported in רמלה
  matched a branch 18 km away in Kiryat Ono and still cleared the gate.
  Tightening the radius needs its own tuning pass over the whole corpus.
- **Nominatim returns streets.** `/api/search` learned to drop `highway`,
  `place` and `landuse` features; `03b_locate_remote.py` never did, which is
  how a street named לביא became a candidate for a clothes shop in מודיעין.

## A pin that is only a town

476 published places had no coordinates at all, so they could not be seen on
the map. Both geocoding passes had already run over them; these were the
leftovers, because OpenStreetMap has never heard of most small Israeli
businesses. It knows every town, though, and 396 of the 476 carry one. 115 of
their 120 towns resolve, covering 389 rows. One more was recovered from a name
that contained its town. The remaining 79 have nothing but a name and stay
listed without a pin, because "somewhere in Israel" is not a location.

This document previously refused exactly this, and the reasoning still stands
in full: a place at the centroid of its town "is on the map, looks right, and
sends somebody to the wrong building". Three clauses, and only the middle one
is now false. A pin that is labelled approximate does not look right; it looks
approximate. So:

- `location_precision` is `'exact'` or `'town'`, and unlike `pin_unavailable`
  it **does** go through the read RPCs, because the client has to render it.
  A reader must never see a dot without also seeing what it is worth, and
  `lat is null` cannot say that when the row has a lat. `Place` is 24 fields.
- the map draws a town pin at 45% opacity. Not a colour and not a shape:
  colour already means the benefit, hollow already means a single report, and
  both were chosen together to survive colour blindness.
- the place page says it in words and offers the Google search by name and
  town, which is what actually finds the door.
- **nothing navigates to a town pin.** `googleMapsUrl()` and `wazeUrl()` treat
  it as no pin at all and fall back to searching. Without this, Waze would
  have accepted the point and driven a reservist to the middle of Eilat
  announcing they had arrived. `npm run urls` holds it down.

The points are spread over a 400m disc around the town, deterministically from
the place id, rather than stacked on the centroid. Stacked, sixty-six places
in Eilat are one coordinate: MapLibre clusters them all the way in and the
reader can reach exactly one of them. Spreading is safe *because* nothing
navigates to these points — the dot's only job is to say "one of these is
around here", and a disc says that better than a spike. Measured over Eilat's
sixty-six: all within 400m, median 286m out, nearest neighbours a median 50m
apart, every point distinct and stable across runs.

## A place we cannot pin

`places_published_needs_pin` used to require a physical place to carry a point
before it could be published, which was right: publishing a row whose location
nobody has checked is how a place ends up on the map in the wrong building.
The cost was that 482 real places, whose details reservists had written down,
were invisible because a geocoder could not find a doorway.

Migration 0006 adds `pin_unavailable`, and the constraint now accepts it. It
means *somebody looked and it cannot be located*, as against a pending row
without it, which still means *nobody has looked yet*. `scripts/08_publish_unpinned.py`
set it on 476 rows.

Nothing about the map changed. `places_all` and `places_near` both filter
`location is not null`, so a pinless row cannot reach the map however the flag
is set, and `place_by_id` never filtered on location, so those pages already
worked. The read side needed no new column either — `lat is null` is what the
UI keys on — which is why the three RPCs and the 23-field `Place` contract are
untouched.

What makes it work is `searchTerms()` in `src/lib/format.ts`. Without a point,
`googleMapsUrl()` searches Maps for the business, and the query has to be
specific enough to land: "קמיליון" is a word, "קמיליון תל אביב" is a shop. It
adds the town and the street, and skips the town when the name or address
already carries it — Israeli branch names carry their town constantly, and
"אושיקה מעלה אדומים מעלה אדומים" is a worse query than the name alone.

That work also turned up a live bug in the *pinned* path: the URL appended
`&query=<name>` after the coordinates, and a repeated query parameter resolves
to the last one, so every pinned place opened as a name search and discarded
the point we had geocoded for it. `npm run urls` holds both halves down.

The site went from 526 published places to 1003.

## How contribution works

- there are **two ways in**. The OpenStreetMap typeahead is still first,
  because when it works it supplies an address, a category and an identity
  that joins with the imported corpus. Underneath it sits a **Google Maps
  link**, which opens by itself the moment a search returns nothing
- a link submission may carry **no `provider_ref` at all**, when the link is a
  dropped pin rather than a listed business. That is deliberate: minting
  `gmaps:at/31.80,35.31` would write a false identity a later submission
  collides with. `place_near_match()` is the dedupe there
- a submission is **published the moment it is sent**, and the contributor is
  taken straight to its page
- it is drawn **hollow on the map** and badged **דיווח אחד** until a second,
  independent person vouches for it
- while it stands on one person's word, **one failure report pulls it**. Two
  vouches earn it the normal three-report protection
- the imported corpus is explicitly outside that rule. Those rows sit at
  `confirm_count = 0` because nobody has pressed confirm here, not because one
  person invented them, so they still take three reports

`supabase/tests/trust_rules.sql` sections G to J hold all four down, including
the one that bites: reading `confirm_count` without `source` would make
*confirming* an imported place halve the reports needed to remove it.

To check 0004 is in, from the SQL editor:

```sql
select position('cur_source' in prosrc) > 0 as new_trust_rule
  from pg_proc where proname = 'apply_report';
```

`true` means the one-report rule is live. The read side shows up without SQL:
`places_all` returns 23 columns including `source`.

## Also worth knowing

- **`/api/search` drops non-business OSM features**, and that is load-bearing
  rather than cosmetic. Photon indexes all of OpenStreetMap, so a shop it has
  never heard of does not return nothing — it returns streets and villages of
  a similar name. בת חן שריג used to come back as six residential streets
  called בת חן, in six towns that are not בית אל. Two things went wrong at
  once: the list looked like an answer, so the shop could be pinned in the
  wrong town, and because the list was not empty the Google Maps link stayed
  collapsed, since `PlacePicker` only offers it when a search returns nothing.
  Filtering `highway`, `place`, `landuse` and friends turns six wrong answers
  into none, which is the state the form already handles. Verified against
  live Photon: the chains (קסטרו, ארומה, רמי לוי, זארה) are untouched at 8 of
  8. It does not fix everything — a *different* clothes shop genuinely called
  בת חן, in פתח תקווה, is a business and still comes back.
- `/api/resolve-link` is **the only outbound fetch a stranger can trigger** in
  this app. It will only ever request `maps.app.goo.gl`, `goo.gl`, `g.co` and
  `share.google`, re-checks the host at every redirect hop, and stops at four
  hops and six seconds. Anything else is parsed without a socket being opened. Do not
  "simplify" it into fetching whatever URL it is handed; `scripts/test_api.py`
  section J holds it down with the AWS metadata address and a
  `goo.gl.evil.example` lookalike

- 271 places have coordinates and are on the map. OSM does not know most
  small Israeli businesses, and both geocoding passes had already given up on
  the rest, so pinning them by hand was the only route left and nobody was
  going to walk it. They are published without a pin instead: they appear in
  the list and their page opens a Google Maps *search* for the name and town.
  Pinning one is still worth doing — a pin is what puts it on the map — but it
  is no longer what stands between a place and being useful.
- `npm run smoke` drives a real browser, desktop and mobile, 24 checks locally
  and 17 against production, where the map internals are not exposed. Three of
  the worst bugs here were invisible to every other suite, the most recent
  being a masthead that carried `sticky top-0` and scrolled away anyway,
  because an unlayered `.masthead { position: relative }` outranked it.
- Share **`https://fighter-map.vercel.app`**, never a link copied from a
  Vercel deployment page. Deployment URLs are covered by Standard Protection
  and demand a Vercel login; the production alias is public. One tester was
  turned away by exactly this.
- README has the full setup, pipeline and test story.
