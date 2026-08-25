-- Integration test for the two flows the whole project depends on:
--   * somebody adds a place that takes the card
--   * somebody reports that a place stopped taking it
--
-- Runs against a real Postgres with PostGIS and the migration applied. It
-- asserts on the trigger's behaviour rather than on the API code, because the
-- trigger is where the rules actually live, and it exercises the exact
-- statements the route handlers issue, including the EWKT location literal
-- PostgREST sends for a geography column.
--
--   docker run -d --name fighter-pg -e POSTGRES_PASSWORD=test \
--     -e POSTGRES_DB=fighter -p 55432:5432 postgis/postgis:16-3.4
--   psql -f supabase/migrations/0001_init.sql
--   psql -f supabase/tests/trust_rules.sql
--
-- Any failure raises, so ON_ERROR_STOP=1 makes this usable in CI.

\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert_eq(actual anyelement, expected anyelement, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception '% : expected %, got %', label, expected, actual;
  end if;
  raise notice '  ok  % (%)', label, actual;
end;
$$;

create or replace function assert_raises(stmt text, label text)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice '  ok  % (rejected: %)', label, left(sqlerrm, 60);
    return;
  end;
  raise exception '% : expected the statement to be rejected, it was accepted', label;
end;
$$;

truncate reports, places cascade;

-- ===========================================================================
do $$ begin raise notice E'\nA. somebody adds a place'; end $$;
-- ===========================================================================

-- Exactly what /api/submissions inserts for a place nobody has reported yet.
insert into places (
  id, provider_ref, source_key, name_he, category, is_chain, is_online,
  location, address_he, city, benefit_fighter_card, benefit_vacation_voucher,
  source, status, first_reported_at
) values (
  '11111111-1111-1111-1111-111111111111', 'osm:node/999001', 'osm:node/999001',
  'בורגר בדיקה', 'restaurant', false, false,
  'SRID=4326;POINT(34.7818 32.0853)', 'דיזנגוף 1, תל אביב', 'תל אביב',
  true, false, 'user_submission', 'pending', now()
);

insert into reports (place_id, kind, benefit_type, ip_hash)
values ('11111111-1111-1111-1111-111111111111', 'new_submission', 'fighter_card', 'ip-alice');

select assert_eq((select status from places where id = '11111111-1111-1111-1111-111111111111'),
                 'pending', 'a new submission waits in pending');
select assert_eq((select confirm_count from places where id = '11111111-1111-1111-1111-111111111111'),
                 1, 'the submitter counts as the first vouch');

-- The same person again is not a second opinion.
insert into reports (place_id, kind, ip_hash)
values ('11111111-1111-1111-1111-111111111111', 'confirm', 'ip-alice');
select assert_eq((select confirm_count from places where id = '11111111-1111-1111-1111-111111111111'),
                 1, 'the same reporter twice still counts once');
select assert_eq((select status from places where id = '11111111-1111-1111-1111-111111111111'),
                 'pending', 'and does not publish the place');

-- A second, independent person does publish it.
insert into reports (place_id, kind, ip_hash)
values ('11111111-1111-1111-1111-111111111111', 'confirm', 'ip-bob');
select assert_eq((select confirm_count from places where id = '11111111-1111-1111-1111-111111111111'),
                 2, 'two independent people');
select assert_eq((select status from places where id = '11111111-1111-1111-1111-111111111111'),
                 'published', 'two independent vouches publish the place');
select assert_eq((select last_confirmed_at is not null from places where id = '11111111-1111-1111-1111-111111111111'),
                 true, 'last_confirmed_at is stamped');

-- The same place submitted again must collide, which is why the route looks it
-- up by provider_ref first and turns the second submission into a confirm.
select assert_raises(
  $q$insert into places (provider_ref, source_key, name_he, category, location,
                         benefit_fighter_card, source, status)
     values ('osm:node/999001', 'dupe', 'בורגר בדיקה', 'restaurant',
             'SRID=4326;POINT(34.78 32.08)', true, 'user_submission', 'pending')$q$,
  'a duplicate provider_ref cannot create a second row');

-- ===========================================================================
do $$ begin raise notice E'\nB. somebody reports it stopped working'; end $$;
-- ===========================================================================

-- One angry person tapping three times must not take a place off the map.
insert into reports (place_id, kind, ip_hash) values
  ('11111111-1111-1111-1111-111111111111', 'not_working', 'ip-carol'),
  ('11111111-1111-1111-1111-111111111111', 'not_working', 'ip-carol'),
  ('11111111-1111-1111-1111-111111111111', 'not_working', 'ip-carol');

select assert_eq((select report_count from places where id = '11111111-1111-1111-1111-111111111111'),
                 1, 'three taps from one person count as one report');
select assert_eq((select status from places where id = '11111111-1111-1111-1111-111111111111'),
                 'published', 'and the place stays on the map');

-- Three different people is the real signal.
insert into reports (place_id, kind, ip_hash)
values ('11111111-1111-1111-1111-111111111111', 'not_working', 'ip-dave');
select assert_eq((select status from places where id = '11111111-1111-1111-1111-111111111111'),
                 'published', 'two reporters is still not enough');

insert into reports (place_id, kind, ip_hash)
values ('11111111-1111-1111-1111-111111111111', 'not_working', 'ip-erin');
select assert_eq((select report_count from places where id = '11111111-1111-1111-1111-111111111111'),
                 3, 'three independent reporters');
select assert_eq((select status from places where id = '11111111-1111-1111-1111-111111111111'),
                 'reported_not_working', 'three reporters flip the place');

-- Flipped is not hidden: a place that stopped taking the card is useful.
select assert_eq((select count(*)::int from places_all()
                  where id = '11111111-1111-1111-1111-111111111111'),
                 1, 'a flipped place is still returned to the map');
select assert_eq((select count(*)::int from places_near(32.0853, 34.7818, 5000)
                  where id = '11111111-1111-1111-1111-111111111111'),
                 1, 'and still returned by places_near');

-- ===========================================================================
do $$ begin raise notice E'\nC. a moderator puts it back'; end $$;
-- ===========================================================================

-- Exactly what /api/admin does for the restore action.
update reports set superseded_at = now()
 where place_id = '11111111-1111-1111-1111-111111111111'
   and kind = 'not_working' and superseded_at is null;
update places set status = 'published', report_count = 0, review_reason = null
 where id = '11111111-1111-1111-1111-111111111111';

insert into reports (place_id, kind, ip_hash)
values ('11111111-1111-1111-1111-111111111111', 'not_working', 'ip-frank');

select assert_eq((select report_count from places where id = '11111111-1111-1111-1111-111111111111'),
                 1, 'retired reports stop counting after a restore');
select assert_eq((select status from places where id = '11111111-1111-1111-1111-111111111111'),
                 'published', 'so one new report does not re-flip it');

-- ===========================================================================
do $$ begin raise notice E'\nD. the 60 day window'; end $$;
-- ===========================================================================

update reports set created_at = now() - interval '61 days'
 where place_id = '11111111-1111-1111-1111-111111111111' and kind = 'not_working';

insert into reports (place_id, kind, ip_hash) values
  ('11111111-1111-1111-1111-111111111111', 'not_working', 'ip-gil'),
  ('11111111-1111-1111-1111-111111111111', 'not_working', 'ip-hana');

select assert_eq((select report_count from places where id = '11111111-1111-1111-1111-111111111111'),
                 2, 'reports older than 60 days fall out of the count');
select assert_eq((select status from places where id = '11111111-1111-1111-1111-111111111111'),
                 'published', 'and cannot flip the place on their own');

-- ===========================================================================
do $$ begin raise notice E'\nE. the shapes the database refuses'; end $$;
-- ===========================================================================

select assert_raises(
  $q$insert into places (source_key, name_he, category, source, status,
                         benefit_fighter_card)
     values ('k1', 'בלי נקודה', 'other', 'pdf_import', 'published', true)$q$,
  'a published physical place needs a pin');

select assert_raises(
  $q$insert into places (source_key, name_he, category, is_chain, location,
                         source, status, benefit_fighter_card)
     values ('k2', 'רשת עם פין', 'other', true, 'SRID=4326;POINT(34.8 32.1)',
             'pdf_import', 'published', true)$q$,
  'a chain must not carry a pin');

select assert_raises(
  $q$insert into places (source_key, name_he, category, location, source, status)
     values ('k3', 'בלי הטבה', 'other', 'SRID=4326;POINT(34.8 32.1)',
             'pdf_import', 'published')$q$,
  'a place with no benefit says nothing and is refused');

select assert_raises(
  $q$insert into reports (place_id, kind, ip_hash)
     values ('11111111-1111-1111-1111-111111111111', 'sabotage', 'ip-x')$q$,
  'an unknown report kind is refused');

select assert_raises(
  $q$insert into reports (place_id, kind, note, ip_hash)
     values ('11111111-1111-1111-1111-111111111111', 'confirm',
             repeat('a', 201), 'ip-x')$q$,
  'a note over 200 characters is refused');

-- A place that is only in the review queue may sit without a pin.
insert into places (source_key, name_he, category, source, status,
                    review_reason, benefit_fighter_card)
values ('k4', 'ממתין בלי פין', 'other', 'pdf_import', 'pending',
        'no_google_result', true);
select assert_eq((select status from places where source_key = 'k4'),
                 'pending', 'the review queue accepts a place with no pin');

-- ===========================================================================
do $$ begin raise notice E'\nF. what the app reads back'; end $$;
-- ===========================================================================

insert into places (id, source_key, name_he, category, location, city,
                    benefit_vacation_voucher, source, status)
values ('22222222-2222-2222-2222-222222222222', 'k5', 'מלון בדיקה חיפה', 'hotel',
        'SRID=4326;POINT(34.9896 32.7940)', 'חיפה', true, 'pdf_import', 'published');

-- Tel Aviv to Haifa, geodesic, is 81 km. Not 78: that is the planar answer,
-- and getting it wrong here would mean the radius filter is lying too.
select assert_eq((select round(distance_m / 1000)::int
                    from places_near(32.0853, 34.7818, 200000)
                   where id = '22222222-2222-2222-2222-222222222222'),
                 81, 'places_near measures Tel Aviv to Haifa in kilometres');
select assert_eq((select count(*)::int from places_near(32.0853, 34.7818, 5000)
                  where id = '22222222-2222-2222-2222-222222222222'),
                 0, 'and a 5 km radius excludes it');
select assert_eq((select count(*)::int
                    from places_near(32.0853, 34.7818, 200000, 'vacation_voucher')),
                 1, 'the benefit filter narrows to voucher places');
select assert_eq((select count(*)::int
                    from places_near(32.0853, 34.7818, 200000, null, array['hotel'])),
                 1, 'the category filter works');
select assert_eq((select round(lat::numeric, 4)
                    from place_by_id('22222222-2222-2222-2222-222222222222')),
                 32.7940, 'place_by_id unpacks the pin into numbers');
select assert_eq((select round(lng::numeric, 4)
                    from place_by_id('22222222-2222-2222-2222-222222222222')),
                 34.9896, 'and gets longitude the right way round');
select assert_eq((select count(*)::int from places_all() p
                    join places q on q.id = p.id where q.source_key = 'k4'),
                 0, 'a pending place is never served to the map');
select assert_eq((select count(*)::int from place_by_id(
                    (select id from places where source_key = 'k4'))),
                 0, 'and place_by_id refuses to serve it either');

do $$ begin raise notice E'\nall trust rule tests passed'; end $$;
