-- Move off Google Places onto OpenStreetMap.
--
-- Nothing about the design changes: a physical place still needs one stable
-- external identity so two people reporting the same shop land on the same
-- row. Only the issuer of that identity changes, from a Google place_id to an
-- OSM ref like "osm:node/4798363423".
--
-- Renaming rather than adding a column, because a field called
-- google_place_id holding an OSM ref is exactly the kind of quiet lie that
-- costs somebody an afternoon later.
--
-- Safe to run on a database that already has 0001 applied and rows loaded.

alter table places rename column google_place_id to provider_ref;

comment on column places.provider_ref is
  'Stable external identity, "osm:node/123" or "osm:way/123". Null for a chain
   or an online service, which have no single location. Coordinates and address
   are a refreshable cache; this is what actually identifies the place.';

comment on column places.source_key is
  'Importer key. The provider ref, or chain:<name> / online:<name>.';

comment on column places.location is
  'Refreshable cache of the OSM position. provider_ref is the real identity.';

comment on column places.review_reason is
  'Why this row is waiting: no_osm_match, low_match_confidence, low_confidence.';

-- The three read functions name the column in their bodies and in their
-- RETURNS TABLE, and Postgres will not let CREATE OR REPLACE change an output
-- column name, so they are dropped and rebuilt.

drop function if exists places_near(double precision, double precision, integer, text, text[], integer);
drop function if exists places_all(text, text[], integer);
drop function if exists place_by_id(uuid);

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
         p.provider_ref,
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
  select p.id, p.provider_ref, p.name_he, p.name_en, p.category,
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
  select p.id, p.provider_ref, p.name_he, p.name_en, p.category,
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

grant execute on function places_near  to anon, authenticated, service_role;
grant execute on function places_all   to anon, authenticated, service_role;
grant execute on function place_by_id  to anon, authenticated, service_role;
