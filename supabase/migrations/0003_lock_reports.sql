-- Close the direct-write hole before the site is public.
--
-- 0001 let the anon role insert into reports, which read naturally enough:
-- "anon can select published places and insert reports". The consequence only
-- becomes obvious with the site in front of real people.
--
-- The anon key is public by design; it ships in the JavaScript bundle. So
-- anyone could POST straight to PostgREST, skip our route handler, and with it
-- skip both guards that make the trust rules mean anything:
--
--   * Turnstile, because that is checked in the route
--   * the rate limit, because it counts rows by ip_hash and the caller was
--     supplying the ip_hash themselves
--
-- Demonstrated before writing this: three requests with invented reporter ids
-- flipped a published place to reported_not_working. Two more would publish any
-- pending submission. Neither needed anything a visitor does not already have.
--
-- Every write the app makes already goes through a route handler holding the
-- service role key, so restricting this costs the application nothing. What it
-- buys is that the ip_hash is once again something we compute from the request
-- rather than something the caller asserts.

drop policy if exists reports_anon_insert on reports;

revoke insert on reports from anon, authenticated;

-- Reads stay open: the map is public and that is the point.
-- Writes go through /api/reports and /api/submissions, which hash the caller's
-- address themselves, enforce five reports an hour, and verify Turnstile.
create policy reports_service_insert on reports
  for insert
  to service_role
  with check (true);

comment on table reports is
  'Append only, and only via a route handler. The anon role may not insert:
   it would be supplying its own ip_hash, which is the value the whole
   "independent reporters" rule counts.';
