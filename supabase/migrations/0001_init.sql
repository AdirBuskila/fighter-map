-- Fighter Map - initial schema
--
-- Design notes that are not obvious from the column list:
--
-- * google_place_id is the identity of a physical place. Coordinates and the
--   formatted address are a refreshable cache; re-running the geocoder may
--   update them and that is fine. A chain or an online service has no
--   place_id, hence the column is nullable and merely UNIQUE, not the key.
-- * Every write goes through a Next.js route handler using the service role
--   key. The anon role can read published places and insert reports, nothing
--   else, so a leaked anon key cannot create or edit a place.
-- * The trust rules (auto publish at two confirmations, flip to
--   reported_not_working at three failures in sixty days) live in a trigger
--   rather than in the API route, so the invariant holds no matter who writes.

create extension if not exists postgis;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- places

create table if not exists places (
  id                       uuid primary key default gen_random_uuid(),
  google_place_id          text unique,
  -- Stable natural key for the importer. A geocoded place uses its Google id;
  -- a chain or an online service has no Google id, so it gets "chain:name" or
  -- "online:name". This is what makes re-running the seed an upsert instead of
  -- a duplicate, without pretending a brand has a place_id.
  source_key               text unique,
  name_he                  text not null,
  name_en                  text,
  category                 text not null,
  is_chain                 boolean not null default false,
  is_online                boolean not null default false,
  location                 geography(point, 4326),
  address_he               text,
  city                     text,
  phone                    text,
  url                      text,
  benefit_fighter_card     boolean not null default false,
  benefit_vacation_voucher boolean not null default false,
  note_he                  text,
  source                   text not null,
  status                   text not null default 'published',
  confirm_count            int not null default 0,
  report_count             int not null default 0,
  first_reported_at        timestamptz,
  last_confirmed_at        timestamptz,
  review_reason            text,
  created_at               timestamptz not null default now(),

  constraint places_source_check
    check (source in ('pdf_import', 'user_submission')),
  constraint places_status_check
    check (status in ('published', 'pending', 'rejected', 'reported_not_working')),
  constraint places_category_check
    check (category in ('restaurant','cafe','hotel','zimmer','spa','clothing',
                        'shoes','sports','electronics','toys','jewelry',
                        'attraction','gov_service','other')),
  -- At least one benefit, or the row says nothing.
  constraint places_has_benefit
    check (benefit_fighter_card or benefit_vacation_voucher),
  -- A chain or an online service must never carry a pin.
  constraint places_location_shape
    check (not (is_chain or is_online) or location is null),
  -- A physical place needs a pin before it is published, but may sit in the
  -- review queue without one: that is exactly what the queue is for.
  constraint places_published_needs_pin
    check (status <> 'published'
           or is_chain or is_online
           or location is not null)
);

create index if not exists places_location_idx on places using gist (location);
create index if not exists places_name_trgm_idx on places using gin (name_he gin_trgm_ops);
create index if not exists places_status_idx on places (status);
create index if not exists places_category_idx on places (category);
create index if not exists places_city_idx on places (city);

comment on column places.source_key is
  'Importer key. Google place id, or chain:<name> / online:<name>.';

comment on column places.review_reason is
  'Why this row is waiting: low_match_confidence, no_google_result, low_confidence.';

comment on column places.location is
  'Refreshable cache of the Google pin. google_place_id is the real identity.';

-- ---------------------------------------------------------------- reports

create table if not exists reports (
  id           uuid primary key default gen_random_uuid(),
  place_id     uuid not null references places (id) on delete cascade,
  kind         text not null,
  benefit_type text,
  note         text,
  created_at   timestamptz not null default now(),
  -- Set when a moderator restores a place. The old failure reports stay for
  -- the record but stop counting, otherwise the next single report would
  -- recompute the same total and immediately re-flip the place.
  superseded_at timestamptz,
  ip_hash      text not null,

  constraint reports_kind_check
    check (kind in ('confirm', 'not_working', 'new_submission')),
  constraint reports_benefit_check
    check (benefit_type is null
           or benefit_type in ('fighter_card', 'vacation_voucher')),
  constraint reports_note_length
    check (note is null or char_length(note) <= 200)
);

create index if not exists reports_place_idx
  on reports (place_id, kind, created_at desc) where superseded_at is null;
create index if not exists reports_rate_idx on reports (ip_hash, created_at desc);

-- ------------------------------------------------------------ trust rules

create or replace function apply_report()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  vouches    int;
  failures   int;
  cur_status text;
begin
  select status into cur_status from places where id = new.place_id;

  if new.kind in ('confirm', 'new_submission') then
    -- "Independent" means a distinct person, so count reporters, not rows.
    -- The submission itself counts as its author vouching for the place:
    -- requiring two further confirmations would mean three people before
    -- anything reaches the map, and on a community tool this size nothing
    -- would ever get there. Submitter plus one corroborator is two
    -- independent people, which is what the rule is protecting against.
    select count(distinct ip_hash) into vouches
      from reports
     where place_id = new.place_id
       and kind in ('confirm', 'new_submission')
       and superseded_at is null;

    update places
       set confirm_count     = vouches,
           last_confirmed_at = now(),
           -- Nothing else about status changes here. A place flipped to
           -- reported_not_working stays that way until a human looks at it,
           -- and /admin surfaces the ones collecting confirmations again.
           status = case when cur_status = 'pending' and vouches >= 2
                         then 'published' else cur_status end
     where id = new.place_id;

  elsif new.kind = 'not_working' then
    -- Distinct reporters here too. Counting rows would let one person flip
    -- any place off the map by tapping the button three times.
    select count(distinct ip_hash) into failures
      from reports
     where place_id = new.place_id
       and kind = 'not_working'
       and superseded_at is null
       and created_at > now() - interval '60 days';

    update places
       set report_count = failures,
           status = case when failures >= 3 and cur_status = 'published'
                         then 'reported_not_working' else cur_status end
     where id = new.place_id;
  end if;

  return new;
end;
$$;

drop trigger if exists reports_apply on reports;
create trigger reports_apply
  after insert on reports
  for each row execute function apply_report();

-- --------------------------------------------------------------- searching

-- Places near a point, nearest first. Chains and online services have no
-- location and are deliberately absent: the app fetches those separately and
-- resolves chain branches live from the browser.
create or replace function places_near(
  p_lat        double precision,
  p_lng        double precision,
  p_radius_m   integer default 25000,
  p_benefit    text    default null,
  p_categories text[]  default null,
  p_limit      integer default 300
)
returns table (
  id                       uuid,
  google_place_id          text,
  name_he                  text,
  name_en                  text,
  category                 text,
  is_chain                 boolean,
  is_online                boolean,
  lat                      double precision,
  lng                      double precision,
  address_he               text,
  city                     text,
  phone                    text,
  url                      text,
  benefit_fighter_card     boolean,
  benefit_vacation_voucher boolean,
  note_he                  text,
  status                   text,
  confirm_count            int,
  report_count             int,
  first_reported_at        timestamptz,
  last_confirmed_at        timestamptz,
  distance_m               double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select p.id,
         p.google_place_id,
         p.name_he,
         p.name_en,
         p.category,
         p.is_chain,
         p.is_online,
         st_y(p.location::geometry) as lat,
         st_x(p.location::geometry) as lng,
         p.address_he,
         p.city,
         p.phone,
         p.url,
         p.benefit_fighter_card,
         p.benefit_vacation_voucher,
         p.note_he,
         p.status,
         p.confirm_count,
         p.report_count,
         p.first_reported_at,
         p.last_confirmed_at,
         st_distance(p.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) as distance_m
    from places p
   where p.status in ('published', 'reported_not_working')
     and p.location is not null
     and st_dwithin(p.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_radius_m)
     and (p_benefit is null
          or (p_benefit = 'fighter_card'     and p.benefit_fighter_card)
          or (p_benefit = 'vacation_voucher' and p.benefit_vacation_voucher))
     and (p_categories is null or p.category = any (p_categories))
   order by p.location <-> st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
   limit p_limit;
$$;

-- Everything with a pin, for the initial country-wide view. Same shape as
-- places_near so the client can treat the two identically.
create or replace function places_all(
  p_benefit    text   default null,
  p_categories text[] default null,
  p_limit      integer default 2000
)
returns table (
  id                       uuid,
  google_place_id          text,
  name_he                  text,
  name_en                  text,
  category                 text,
  is_chain                 boolean,
  is_online                boolean,
  lat                      double precision,
  lng                      double precision,
  address_he               text,
  city                     text,
  phone                    text,
  url                      text,
  benefit_fighter_card     boolean,
  benefit_vacation_voucher boolean,
  note_he                  text,
  status                   text,
  confirm_count            int,
  report_count             int,
  first_reported_at        timestamptz,
  last_confirmed_at        timestamptz,
  distance_m               double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select p.id, p.google_place_id, p.name_he, p.name_en, p.category,
         p.is_chain, p.is_online,
         st_y(p.location::geometry), st_x(p.location::geometry),
         p.address_he, p.city, p.phone, p.url,
         p.benefit_fighter_card, p.benefit_vacation_voucher, p.note_he,
         p.status, p.confirm_count, p.report_count,
         p.first_reported_at, p.last_confirmed_at,
         null::double precision
    from places p
   where p.status in ('published', 'reported_not_working')
     and p.location is not null
     and (p_benefit is null
          or (p_benefit = 'fighter_card'     and p.benefit_fighter_card)
          or (p_benefit = 'vacation_voucher' and p.benefit_vacation_voucher))
     and (p_categories is null or p.category = any (p_categories))
   order by p.name_he
   limit p_limit;
$$;

-- One place by id, with the pin already unpacked into numbers. PostgREST hands
-- a geography column back as WKB hex, which is useless to the browser.
create or replace function place_by_id(p_id uuid)
returns table (
  id                       uuid,
  google_place_id          text,
  name_he                  text,
  name_en                  text,
  category                 text,
  is_chain                 boolean,
  is_online                boolean,
  lat                      double precision,
  lng                      double precision,
  address_he               text,
  city                     text,
  phone                    text,
  url                      text,
  benefit_fighter_card     boolean,
  benefit_vacation_voucher boolean,
  note_he                  text,
  status                   text,
  confirm_count            int,
  report_count             int,
  first_reported_at        timestamptz,
  last_confirmed_at        timestamptz,
  distance_m               double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select p.id, p.google_place_id, p.name_he, p.name_en, p.category,
         p.is_chain, p.is_online,
         st_y(p.location::geometry), st_x(p.location::geometry),
         p.address_he, p.city, p.phone, p.url,
         p.benefit_fighter_card, p.benefit_vacation_voucher, p.note_he,
         p.status, p.confirm_count, p.report_count,
         p.first_reported_at, p.last_confirmed_at,
         null::double precision
    from places p
   where p.id = p_id
     and p.status in ('published', 'reported_not_working');
$$;

-- --------------------------------------------------------------------- rls

alter table places  enable row level security;
alter table reports enable row level security;

drop policy if exists places_anon_select on places;
create policy places_anon_select on places
  for select
  to anon, authenticated
  -- reported_not_working is readable on purpose. A place that stopped taking
  -- the card is useful information; the app greys it out and badges it.
  using (status in ('published', 'reported_not_working'));

-- Anon may insert a report directly, as specified. Note the consequence: the
-- rate limit and the Turnstile check live in the route handler, so a caller
-- who goes straight to PostgREST with the anon key skips both. To close that,
-- change `to anon, authenticated` to `to service_role` here; the app keeps
-- working because every write it makes already uses the service role key.
drop policy if exists reports_anon_insert on reports;
create policy reports_anon_insert on reports
  for insert
  to anon, authenticated
  with check (true);

-- No select policy on reports: the raw feed carries ip_hash values.
-- No insert, update or delete policy on places: those go through a route
-- handler holding the service role key, which bypasses RLS.

grant execute on function places_near  to anon, authenticated;
grant execute on function places_all   to anon, authenticated;
grant execute on function place_by_id  to anon, authenticated;
