# Where this is up to

Everything below is committed and deployed. Three things are open.

## 1. Blocker: run `supabase/migrations/0003_lock_reports.sql`

Until this runs on the production database, **anyone can write to it**. The
anon key ships in the JavaScript bundle, so a visitor can POST straight to
PostgREST and skip the route handler, and with it both guards: Turnstile, and
the rate limit (which counts by an `ip_hash` the caller supplies themselves).

Demonstrated on a local copy: three requests with invented reporter ids flipped
a published place to `reported_not_working`. Two more would publish any pending
submission.

Nothing in the app changes when you run it. Every write already uses the
service role key.

To check whether it has been run, POST a deliberately invalid report as anon:
`42501 permission denied` means closed, `23503 foreign key violation` means the
insert was permitted and the hole is still open.

## 2. Turnstile is not configured

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are empty, so the
bot check is silently skipped. The five-per-hour rate limit still applies once
0003 is in. dash.cloudflare.com, five minutes, keys into Vercel.

## 3. Open question: should user submissions auto-publish?

Today a submitted place sits in `pending` until a second person adds the same
one. The plan for this site is a WhatsApp message asking people to add places
themselves, and an addition that does not appear reads as broken, which works
against exactly that.

Auto-publishing is a one-line change in `src/app/api/submissions/route.ts`
(`status: "pending"` becomes `"published"`). The risk is low: a submitter
cannot invent a location, they are rate limited, Turnstile gates bots, and
`/admin` plus the "לא עבד לי" flow clean up anything bad.

Not decided. Left as specified.

## Also worth knowing

- 209 of 610 imported places have coordinates. OSM does not know most small
  Israeli businesses. The other 396 sit in `/admin`, where a moderator can
  search and pin one in a few seconds. Chipping at that queue is the single
  best way to make the map denser.
- `npm run smoke` drives a real browser, desktop and mobile. Two of the worst
  bugs here were invisible to every other suite.
- README has the full setup, pipeline and test story.
