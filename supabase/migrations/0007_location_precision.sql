-- A pin we know is only roughly right, said out loud.
--
-- 476 published places had no coordinates and so could not be seen on the map
-- at all. 396 of them carry a town, and a town can be geocoded even when the
-- business cannot: OpenStreetMap has never heard of most small Israeli shops
-- but it knows every settlement in the country.
--
-- Pinning those at their town centre is a trade the project had previously
-- refused, and the reason is written down in NEXT.md: "a place at the centroid
-- of its town is on the map, looks right, and sends somebody to the wrong
-- building". That objection is correct and this migration does not pretend
-- otherwise. What it changes is the second half -- "looks right" -- because a
-- pin that says it is approximate does not look right, it looks approximate.
--
-- So location_precision is not decoration. It is the thing that makes the
-- trade acceptable:
--
--   'exact'  the point is the doorway. Everything geocoded before now.
--   'town'   the point is the middle of the settlement, and the business is
--            somewhere in it. The map draws these differently, the place page
--            says so in words, and the Google Maps search by name and town
--            stays the honest way to actually find the door.
--
-- Defaulting to 'exact' is safe: every row that exists today was pinned by a
-- geocoder that matched the business itself, or by a person in /admin.
--
-- This one DOES go into the three read RPCs, unlike pin_unavailable in 0006.
-- The difference is that the client has to render it -- a reader cannot be
-- allowed to see a dot without also seeing that it is approximate -- and
-- `lat is null` cannot carry that, because these rows do have a lat. The
-- Place type goes to 24 fields and scripts/check_migration.py holds the three
-- functions to the same shape.

-- WHY THESE FUNCTIONS ARE DROPPED AND NOT JUST REPLACED.
--
-- CREATE OR REPLACE FUNCTION cannot change a function's return type, and a
-- RETURNS TABLE list *is* its return type, so adding a column to it fails
-- with:
--
--   42P13: cannot change return type of existing function
--   DETAIL: Row type defined by OUT parameters is different.
--
-- Hence an explicit DROP against the exact argument signature. That in turn
-- has a consequence worth stating, because it is the kind of thing that takes
-- a site down quietly: DROP FUNCTION discards the function's grants. 0001
-- gives anon EXECUTE on all three, and anon is the role the public site reads
-- with, so every one of them is re-granted at the bottom of this file. A drop
-- without those three lines would leave the map returning "permission denied"
-- for everybody who is not logged in.

alter table places
  add column if not exists location_precision text not null default 'exact';

alter table places
  drop constraint if exists places_location_precision_check;

alter table places
  add constraint places_location_precision_check
    check (location_precision in ('exact', 'town'));

comment on column places.location_precision is
  'exact = the point is the business. town = the point is the middle of the '
  'settlement and the business is somewhere in it; the UI must say so.';

-- Only a row with a point can have a precision worth reading, and the map
-- queries filter on location anyway, so this stays a partial index.
create index if not exists places_precision_idx
  on places (location_precision)
  where location is not null;

drop function if exists places_near(double precision, double precision, integer, text, text[], integer);

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
  provider_ref             text,
  name_he                  text,
  name_en                  text,
  category                 text,
  is_chain                 boolean,
  is_online                boolean,
  lat                      double precision,
  lng                      double precision,
  location_precision       text,
  address_he               text,
  city                     text,
  phone                    text,
  url                      text,
  benefit_fighter_card     boolean,
  benefit_vacation_voucher boolean,
  note_he                  text,
  source                   text,
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
         p.provider_ref,
         p.name_he,
         p.name_en,
         p.category,
         p.is_chain,
         p.is_online,
         st_y(p.location::geometry) as lat,
         st_x(p.location::geometry) as lng,
         p.location_precision,
         p.address_he,
         p.city,
         p.phone,
         p.url,
         p.benefit_fighter_card,
         p.benefit_vacation_voucher,
         p.note_he,
         p.source,
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

drop function if exists places_all(text, text[], integer);

create or replace function places_all(
  p_benefit    text   default null,
  p_categories text[] default null,
  p_limit      integer default 2000
)
returns table (
  id                       uuid,
  provider_ref             text,
  name_he                  text,
  name_en                  text,
  category                 text,
  is_chain                 boolean,
  is_online                boolean,
  lat                      double precision,
  lng                      double precision,
  location_precision       text,
  address_he               text,
  city                     text,
  phone                    text,
  url                      text,
  benefit_fighter_card     boolean,
  benefit_vacation_voucher boolean,
  note_he                  text,
  source                   text,
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
  select p.id, p.provider_ref, p.name_he, p.name_en, p.category,
         p.is_chain, p.is_online,
         st_y(p.location::geometry), st_x(p.location::geometry),
         p.location_precision,
         p.address_he, p.city, p.phone, p.url,
         p.benefit_fighter_card, p.benefit_vacation_voucher, p.note_he,
         p.source, p.status, p.confirm_count, p.report_count,
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

drop function if exists place_by_id(uuid);

create or replace function place_by_id(p_id uuid)
returns table (
  id                       uuid,
  provider_ref             text,
  name_he                  text,
  name_en                  text,
  category                 text,
  is_chain                 boolean,
  is_online                boolean,
  lat                      double precision,
  lng                      double precision,
  location_precision       text,
  address_he               text,
  city                     text,
  phone                    text,
  url                      text,
  benefit_fighter_card     boolean,
  benefit_vacation_voucher boolean,
  note_he                  text,
  source                   text,
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
  select p.id, p.provider_ref, p.name_he, p.name_en, p.category,
         p.is_chain, p.is_online,
         st_y(p.location::geometry), st_x(p.location::geometry),
         p.location_precision,
         p.address_he, p.city, p.phone, p.url,
         p.benefit_fighter_card, p.benefit_vacation_voucher, p.note_he,
         p.source, p.status, p.confirm_count, p.report_count,
         p.first_reported_at, p.last_confirmed_at,
         null::double precision
    from places p
   where p.id = p_id
     and p.status in ('published', 'reported_not_working');
$$;

-- Restoring what the DROPs above took away. Not optional; see the note at the
-- top. 0002 and 0004 repeat these for the same reason.
grant execute on function places_near  to anon, authenticated, service_role;
grant execute on function places_all   to anon, authenticated, service_role;
grant execute on function place_by_id  to anon, authenticated, service_role;
