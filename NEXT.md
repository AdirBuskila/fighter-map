# Where this is up to

Migrations 0001 to 0005 are applied to the production database, and
everything resting on them is committed and deployed. Turnstile is still open,
and so is a queue of 20 pins that predate a fix described below.

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

- 206 of 673 imported places have coordinates. OSM does not know most small
  Israeli businesses. The other 425 sit in `/admin`, where a moderator can
  search and pin one in a few seconds. Chipping at that queue is still the
  single best way to make the map denser, and it is now the only way the
  places whose town the index cannot resolve will ever get a pin.
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
