# Where this is up to

Everything below is committed and deployed.

## 1. Run `supabase/migrations/0004_publish_on_arrival.sql`

**The app expects it.** Until it runs, `/api/submissions` inserts
`status: 'published'` into a schema whose read functions do not yet return
`source`, so `isSingleSource` is undefined for every row: nothing gets the
דיווח אחד badge or the hollow pin, and a single failure report cannot pull a
one-person place. Paste it into the Supabase SQL editor.

It is safe to run on a live database. It replaces one trigger function and
rebuilds the three read functions; it touches no rows.

`0003_lock_reports.sql` is already applied (probe returns `42501 permission
denied`, which is what closed means). 0004 depends on it: the rate limit is
what keeps publish-on-arrival honest, and that limit only counts anything when
the `ip_hash` is computed by the server rather than sent by the caller.

## 2. Turnstile is not configured

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are empty, so the
bot check is skipped. The five-per-hour rate limit still applies.
dash.cloudflare.com, five minutes, keys into Vercel.

## How contribution works now

Decided and built, replacing the old "wait for a second person" rule:

- a submission is **published the moment it is sent**, and the contributor is
  taken straight to its page
- it is drawn **hollow on the map** and badged **דיווח אחד** until a second,
  independent person vouches for it
- while it is on one person's word, **one failure report pulls it**. Two
  vouches earn it the normal three-report protection
- the imported corpus is explicitly outside that rule. Those rows sit at
  `confirm_count = 0` because nobody has pressed confirm here, not because one
  person invented them, so they still take three reports

`supabase/tests/trust_rules.sql` sections G to J hold all four of those down,
including the one that bites: reading `confirm_count` without `source` would
make *confirming* an imported place halve the reports needed to remove it.

## Also worth knowing

- 209 of 610 imported places have coordinates. OSM does not know most small
  Israeli businesses. The other 396 sit in `/admin`, where a moderator can
  search and pin one in a few seconds. Chipping at that queue is still the
  single best way to make the map denser.
- `npm run smoke` drives a real browser, desktop and mobile, 24 checks. Three
  of the worst bugs here were invisible to every other suite, the most recent
  being a masthead that carried `sticky top-0` and scrolled away anyway,
  because an unlayered `.masthead { position: relative }` outranked it.
- Share **`https://fighter-map.vercel.app`**, never a link copied from a
  Vercel deployment page. Deployment URLs are covered by Standard Protection
  and demand a Vercel login; the production alias is public.
- README has the full setup, pipeline and test story.
