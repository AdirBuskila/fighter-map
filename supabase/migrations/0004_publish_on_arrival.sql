-- A place reaches the map the moment somebody adds it.
--
-- 0001 held a submission in 'pending' until a second, independent person added
-- the same place. That rule is right for a map with traffic and wrong for one
-- without: the two people who both know the same cafe in Ashdod are not both
-- finding this site in the same week. In practice a contributor added a place,
-- saw nothing appear, and concluded the site was broken. For a project whose
-- entire growth plan is "people add places themselves", that is fatal.
--
-- So the trade is reversed. Publishing becomes cheap and reversible instead of
-- expensive and safe:
--
--   * the route inserts 'published' rather than 'pending'
--   * a place standing on one person's word is DRAWN differently, so the map
--     never claims more than it knows (see StatusBadges and drawIcon)
--   * and one person is enough to take such a place back off
--
-- The last point is what makes this safe. Under 0001 one person could publish
-- but three had to agree to remove, so noise cost one report and cleanup cost
-- three. On a map anybody can write to, that asymmetry fills it with junk.
--
-- Note what a submitter still cannot do. They cannot type a place: /add only
-- accepts a pick from the search provider, so every row is a real business at
-- real coordinates. They cannot exceed five submissions an hour, counted from
-- an ip_hash the server computes rather than one the caller sends, which is
-- what 0003 bought and why 0003 must be applied before this.
--
-- The lie still available to a submitter is narrow: that a real business
-- honours the card when it does not. That is exactly the lie the not_working
-- flow is built to catch, and below it now catches it on one report.

-- ------------------------------------------------------------- trust rules

create or replace function apply_report()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  vouches     int;
  failures    int;
  needed      int;
  cur_status  text;
  cur_source  text;
  cur_vouches int;
begin
  select status, source, confirm_count
    into cur_status, cur_source, cur_vouches
    from places where id = new.place_id;

  if new.kind in ('confirm', 'new_submission') then
    -- "Independent" means a distinct person, so count reporters, not rows.
    select count(distinct ip_hash) into vouches
      from reports
     where place_id = new.place_id
       and kind in ('confirm', 'new_submission')
       and superseded_at is null;

    update places
       set confirm_count     = vouches,
           last_confirmed_at = now(),
           -- Submissions arrive published now, so this only still fires for
           -- the review queue: an imported row with no pin, or one an admin
           -- has parked. Two independent vouches release it, as before.
           status = case when cur_status = 'pending' and vouches >= 2
                         then 'published' else cur_status end
     where id = new.place_id;

  elsif new.kind = 'not_working' then
    select count(distinct ip_hash) into failures
      from reports
     where place_id = new.place_id
       and kind = 'not_working'
       and superseded_at is null
       and created_at > now() - interval '60 days';

    -- How many independent people it takes to pull a place off the map.
    --
    -- Three normally. One if the place only ever stood on a single person's
    -- word, so that removing noise is never dearer than adding it. Earning a
    -- second vouch is what buys a place the three-report protection, which
    -- also gives a moderator a way to make a restore stick: confirm it.
    --
    -- The imported corpus is deliberately outside this. Those rows carry
    -- confirm_count = 0 because nobody has pressed confirm on the site yet,
    -- not because one person invented them: they came from a spreadsheet many
    -- reservists wrote into, and they are what makes the map worth opening on
    -- day one. Treating them as single-source would let one report empty it.
    needed := case
                when cur_source = 'user_submission' and cur_vouches <= 1 then 1
                else 3
              end;

    update places
       set report_count = failures,
           status = case when failures >= needed and cur_status = 'published'
                         then 'reported_not_working' else cur_status end
     where id = new.place_id;
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------------- reads
--
-- The three read functions gain `source`, because the rule above is not
-- something the client can infer: confirm_count = 1 reads identically on a
-- submission with one voucher and on an imported row somebody confirmed once,
-- and those two must not be drawn the same way. Postgres will not let CREATE
-- OR REPLACE add a column to a RETURNS TABLE, so they are dropped and rebuilt,
-- exactly as 0002 had to.

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
         p.address_he, p.city, p.phone, p.url,
         p.benefit_fighter_card, p.benefit_vacation_voucher, p.note_he,
         p.source, p.status, p.confirm_count, p.report_count,
         p.first_reported_at, p.last_confirmed_at,
         null::double precision
    from places p
   where p.id = p_id
     and p.status in ('published', 'reported_not_working');
$$;

grant execute on function places_near  to anon, authenticated, service_role;
grant execute on function places_all   to anon, authenticated, service_role;
grant execute on function place_by_id  to anon, authenticated, service_role;

comment on column places.confirm_count is
  'Distinct people who have vouched for this place ON THIS SITE. A user
   submission counts its own author, so 1 means nobody has corroborated it yet,
   while 0 on an imported row means nobody has pressed confirm. Those are not
   the same fact, which is why source has to travel alongside it.';
