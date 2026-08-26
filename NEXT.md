# Where this is up to

Everything below is committed, deployed, and applied to the production
database. Migrations 0001 to 0004 are all in. One optional item is open.

## 1. Turnstile is not configured

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are empty, so the
bot check is skipped. The five-per-hour rate limit still applies, and since
0003 that limit counts an `ip_hash` the server computes rather than one the
caller sends, so it is real. dash.cloudflare.com, five minutes, keys into
Vercel.

## How contribution works

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
