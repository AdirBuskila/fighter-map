# Where this is up to

Migrations 0001 to 0005 are applied to the production database, and
everything resting on them is committed and deployed. One optional item is
open.

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

- 209 of 610 imported places have coordinates. OSM does not know most small
  Israeli businesses. The other 396 sit in `/admin`, where a moderator can
  search and pin one in a few seconds. Chipping at that queue is still the
  single best way to make the map denser.
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
