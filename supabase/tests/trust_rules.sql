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
do $$ begin raise notice E'\nA. the review queue releases a place at two vouches'; end $$;
-- ===========================================================================

-- Since 0004 a submission arrives published (section G), so this path is now
-- the review queue: an imported row with no pin, or one an admin has parked.
-- The rule that frees it is unchanged, and still worth holding down.
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
                 'pending', 'a parked place stays parked on one vouch');
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

-- ===========================================================================
do $$ begin raise notice E'\nG. a submission reaches the map at once'; end $$;
-- ===========================================================================

-- Exactly what /api/submissions inserts since 0004: published, not pending.
insert into places (
  id, provider_ref, source_key, name_he, category, is_chain, is_online,
  location, address_he, city, benefit_fighter_card, benefit_vacation_voucher,
  source, status, first_reported_at
) values (
  '33333333-3333-3333-3333-333333333333', 'osm:node/999003', 'osm:node/999003',
  'פלאפל בדיקה', 'restaurant', false, false,
  'SRID=4326;POINT(34.7700 32.0700)', 'אלנבי 5, תל אביב', 'תל אביב',
  true, false, 'user_submission', 'published', now()
);
insert into reports (place_id, kind, benefit_type, ip_hash)
values ('33333333-3333-3333-3333-333333333333', 'new_submission', 'fighter_card', 'ip-nina');

select assert_eq((select status from places where id = '33333333-3333-3333-3333-333333333333'),
                 'published', 'a submission is on the map immediately');
select assert_eq((select confirm_count from places where id = '33333333-3333-3333-3333-333333333333'),
                 1, 'standing on exactly one person');
select assert_eq((select count(*)::int from places_all()
                  where id = '33333333-3333-3333-3333-333333333333'),
                 1, 'and the map query returns it');

-- The client cannot tell "one submitter" from "one confirmer on an imported
-- row" without this, and it has to draw them differently.
select assert_eq((select source from places_all()
                  where id = '33333333-3333-3333-3333-333333333333'),
                 'user_submission', 'places_all carries source through');
select assert_eq((select source from place_by_id('33333333-3333-3333-3333-333333333333')),
                 'user_submission', 'and so does place_by_id');
select assert_eq((select source from places_near(32.0700, 34.7700, 5000)
                  where id = '33333333-3333-3333-3333-333333333333'),
                 'user_submission', 'and so does places_near');

-- Cleanup must never be dearer than noise: one person put this here, one
-- person can take it away.
insert into reports (place_id, kind, ip_hash)
values ('33333333-3333-3333-3333-333333333333', 'not_working', 'ip-omer');
select assert_eq((select report_count from places where id = '33333333-3333-3333-3333-333333333333'),
                 1, 'one failure report is counted');
select assert_eq((select status from places where id = '33333333-3333-3333-3333-333333333333'),
                 'reported_not_working', 'and pulls a single source place at once');

-- ===========================================================================
do $$ begin raise notice E'\nH. a second vouch earns the three report rule'; end $$;
-- ===========================================================================

insert into places (
  id, provider_ref, source_key, name_he, category, location, city,
  benefit_fighter_card, source, status, first_reported_at
) values (
  '44444444-4444-4444-4444-444444444444', 'osm:node/999004', 'osm:node/999004',
  'קפה בדיקה', 'cafe', 'SRID=4326;POINT(34.7750 32.0750)', 'תל אביב',
  true, 'user_submission', 'published', now()
);
insert into reports (place_id, kind, ip_hash)
values ('44444444-4444-4444-4444-444444444444', 'new_submission', 'ip-pini');
insert into reports (place_id, kind, ip_hash)
values ('44444444-4444-4444-4444-444444444444', 'confirm', 'ip-rina');

select assert_eq((select confirm_count from places where id = '44444444-4444-4444-4444-444444444444'),
                 2, 'two independent people vouch for it');

insert into reports (place_id, kind, ip_hash)
values ('44444444-4444-4444-4444-444444444444', 'not_working', 'ip-shai');
select assert_eq((select status from places where id = '44444444-4444-4444-4444-444444444444'),
                 'published', 'now one report is no longer enough');
insert into reports (place_id, kind, ip_hash)
values ('44444444-4444-4444-4444-444444444444', 'not_working', 'ip-tal');
select assert_eq((select status from places where id = '44444444-4444-4444-4444-444444444444'),
                 'published', 'nor two');
insert into reports (place_id, kind, ip_hash)
values ('44444444-4444-4444-4444-444444444444', 'not_working', 'ip-uri');
select assert_eq((select status from places where id = '44444444-4444-4444-4444-444444444444'),
                 'reported_not_working', 'three independent reporters still flip it');

-- ===========================================================================
do $$ begin raise notice E'\nI. the imported corpus is not single source'; end $$;
-- ===========================================================================

-- An imported row has confirm_count = 0 because nobody has pressed confirm on
-- the site, not because one person invented it. Reading that count alone would
-- make one report enough to empty the seed corpus, which is the whole map on
-- day one. This is the assertion that catches it.
insert into places (
  id, source_key, name_he, category, location, city,
  benefit_fighter_card, source, status, first_reported_at
) values (
  '55555555-5555-5555-5555-555555555555', 'k6', 'מסעדת ייבוא', 'restaurant',
  'SRID=4326;POINT(34.7800 32.0800)', 'תל אביב',
  true, 'pdf_import', 'published', now()
);
select assert_eq((select confirm_count from places where id = '55555555-5555-5555-5555-555555555555'),
                 0, 'an imported place starts at zero vouches');

insert into reports (place_id, kind, ip_hash)
values ('55555555-5555-5555-5555-555555555555', 'not_working', 'ip-vered');
select assert_eq((select status from places where id = '55555555-5555-5555-5555-555555555555'),
                 'published', 'one report does not pull an imported place');
insert into reports (place_id, kind, ip_hash)
values ('55555555-5555-5555-5555-555555555555', 'not_working', 'ip-yossi');
select assert_eq((select status from places where id = '55555555-5555-5555-5555-555555555555'),
                 'published', 'two do not either');
insert into reports (place_id, kind, ip_hash)
values ('55555555-5555-5555-5555-555555555555', 'not_working', 'ip-zohar');
select assert_eq((select status from places where id = '55555555-5555-5555-5555-555555555555'),
                 'reported_not_working', 'three do, exactly as before');

-- ===========================================================================
do $$ begin raise notice E'\nJ. confirming a place must not weaken it'; end $$;
-- ===========================================================================

-- The trap in reading confirm_count without source: an imported place that one
-- person confirmed lands on 1, the same figure a fresh submission carries. If
-- the count alone decided, pressing confirm would move a place from needing
-- three reports to needing one, so vouching for somewhere would make it easier
-- to remove. That is backwards, and nobody would ever see it happen.
insert into places (
  id, source_key, name_he, category, location, city,
  benefit_vacation_voucher, source, status, first_reported_at
) values (
  '66666666-6666-6666-6666-666666666666', 'k7', 'צימר ייבוא', 'zimmer',
  'SRID=4326;POINT(35.5000 32.9000)', 'צפת',
  true, 'pdf_import', 'published', now()
);
insert into reports (place_id, kind, ip_hash)
values ('66666666-6666-6666-6666-666666666666', 'confirm', 'ip-alon');
select assert_eq((select confirm_count from places where id = '66666666-6666-6666-6666-666666666666'),
                 1, 'one confirmer puts an imported place on the same count as a submission');

insert into reports (place_id, kind, ip_hash)
values ('66666666-6666-6666-6666-666666666666', 'not_working', 'ip-bar');
select assert_eq((select report_count from places where id = '66666666-6666-6666-6666-666666666666'),
                 1, 'the report is counted');
select assert_eq((select status from places where id = '66666666-6666-6666-6666-666666666666'),
                 'published', 'but confirming it did not make it easier to remove');


-- ===========================================================================
do $$ begin raise notice E'\nK. the near match that stands in for a shared identity'; end $$;
-- ===========================================================================

-- A Google link and an OSM pick for the same shop do not join on their refs,
-- because they come from different issuers. Proximity plus name is what joins
-- them instead, and it has to be both: two shops in one mall are metres apart
-- and must stay two rows, while the same shop pinned twice is metres apart and
-- must become one.
insert into places (
  id, source_key, name_he, category, location, city,
  benefit_fighter_card, source, status, first_reported_at
) values (
  '77777777-7777-7777-7777-777777777777', 'k8', 'גולף מעלה אדומים', 'clothing',
  'SRID=4326;POINT(35.2980 31.7770)', 'מעלה אדומים',
  true, 'user_submission', 'published', now()
), (
  '88888888-8888-8888-8888-888888888888', 'k9', 'זיפ מעלה אדומים', 'clothing',
  -- Roughly 30 m from the row above: the next unit along in the same mall.
  'SRID=4326;POINT(35.2983 31.7771)', 'מעלה אדומים',
  true, 'user_submission', 'published', now()
);

select assert_eq(
  (select id from place_near_match(31.7770, 35.2981, 'גולף מעלה אדומים')),
  '77777777-7777-7777-7777-777777777777'::uuid,
  'the same shop pinned a few metres off matches itself');

-- The name people type is usually the brand alone, while the row carries the
-- branch. Plain trigram similarity scores this pair 0.294 and would file the
-- report as a new place next door to itself.
select assert_eq(
  (select id from place_near_match(31.7770, 35.2980, 'גולף')),
  '77777777-7777-7777-7777-777777777777'::uuid,
  'the brand on its own still matches its branch');

-- The case that made this function use word_similarity rather than
-- similarity. Every shop in the mall carries the same town in its name, so the
-- shared suffix dominates the trigram set: similarity() scores this 0.522
-- against גולף and 0.545 against זיפ, and a third brand would have been
-- swallowed by whichever it happened to sort above.
select assert_eq(
  (select count(*)::int from place_near_match(31.7770, 35.2981, 'קסטרו מעלה אדומים')),
  0,
  'a third brand in the same mall matches neither neighbour');

select assert_eq(
  (select count(*)::int from place_near_match(31.7771, 35.2983, 'אושיקה')),
  0,
  'a different shop in the same mall does not match');

select assert_eq(
  (select count(*)::int from place_near_match(31.7900, 35.2980, 'גולף מעלה אדומים')),
  0,
  'the same name a kilometre away does not match');

-- A rejected row must not quietly absorb a new submission and come back.
update places set status = 'rejected'
 where id = '88888888-8888-8888-8888-888888888888';
select assert_eq(
  (select count(*)::int from place_near_match(31.7771, 35.2983, 'זיפ מעלה אדומים')),
  0,
  'a rejected place is not a merge candidate');

do $$ begin raise notice E'\nall trust rule tests passed'; end $$;
