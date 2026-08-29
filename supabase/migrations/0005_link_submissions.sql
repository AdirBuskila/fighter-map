-- A place can now arrive as a Google Maps link, so identity has a second
-- issuer and the refs no longer join.
--
-- 0002 moved identity onto OpenStreetMap and rested one rule on it: two people
-- reporting the same shop land on the same row. That rule is what makes "is it
-- worth walking in" have a single answer. It holds as long as there is one
-- issuer of identity, and /add accepting a Google link means there is not:
-- osm:node/123 and gmaps:ftid/0x..:0x.. for the same shop are two strings that
-- will never be equal.
--
-- This is what replaces the join. Near in space AND near in name, because
-- either alone is wrong in a way that shows up immediately: two shops in one
-- shopping centre are thirty metres apart and must stay two rows, and a chain
-- has the same name in forty towns.
--
-- The name test is word_similarity, not similarity, and the difference is not
-- cosmetic. Israeli business names vary by gaining or losing a town or a
-- category word around the brand, and plain trigram similarity is wrong in
-- both directions on exactly that:
--
--   similarity('גולף מעלה אדומים', 'זיפ מעלה אדומים')  = 0.571
--   similarity('גולף',             'גולף מעלה אדומים') = 0.294
--
-- The shared suffix dominates the trigram set, so two different shops in one
-- mall score higher than the same shop written two ways. Any threshold you
-- pick from those numbers is wrong. word_similarity asks the question that
-- actually matters -- does one name appear as a whole word-extent inside the
-- other -- and separates the same cases cleanly:
--
--   'גולף' / 'גולף מעלה אדומים'                = 1.000   merge
--   'גופנא' / 'מסעדת גופנא'                    = 1.000   merge
--   'עמנואל שלם' / 'עמנואל שלם ייצור ומסחר'    = 1.000   merge
--   'גולף מעלה אדומים' / 'זיפ מעלה אדומים'     = 0.750   keep apart
--   'בורגר בדיקה' / 'פלאפל בדיקה'              = 0.545   keep apart
--
-- 0.9 sits in that gap. It is deliberately strict, because the two errors do
-- not cost the same: a false split is a duplicate pin, which is visible on the
-- map and a moderator can merge, while a false merge silently files one
-- business's report against another and nobody ever finds out. A near-miss
-- spelling ('אושיקה' / 'אושיקא', 0.714) therefore falls on the split side.
--
-- Read this together with 0004. A merged submission becomes a confirm on the
-- existing row, so a place that was standing on one person's word gains its
-- second voucher and stops being one report away from removal. That is the
-- correct outcome and it is why the radius is tight: 75 m is a building, not a
-- street.

create or replace function place_near_match(
  p_lat      double precision,
  p_lng      double precision,
  p_name     text,
  p_radius_m integer default 75
)
returns table (
  id              uuid,
  name_he         text,
  name_similarity real,
  distance_m      double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select p.id,
         p.name_he,
         greatest(word_similarity(p.name_he, p_name),
                  word_similarity(p_name, p.name_he)),
         st_distance(p.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)
    from places p
   -- 'pending' and 'rejected' are excluded deliberately. Merging into a
   -- rejected row would resurrect something a moderator threw out, without
   -- anyone choosing to. 'reported_not_working' is included, because a fresh
   -- report on a flipped place is exactly the "they changed their policy back"
   -- signal /admin exists to show a person.
   where p.status in ('published', 'reported_not_working')
     and p.location is not null
     and st_dwithin(p.location,
                    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
                    p_radius_m)
     -- Symmetric, because which of the two names is the longer one is an
     -- accident of who typed first. word_similarity(a, b) alone would merge
     -- 'גולף' into 'גולף מעלה אדומים' but not the reverse.
     and greatest(word_similarity(p.name_he, p_name),
                  word_similarity(p_name, p.name_he)) > 0.9
   order by greatest(word_similarity(p.name_he, p_name),
                     word_similarity(p_name, p.name_he)) desc,
            st_distance(p.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) asc
   limit 1;
$$;

grant execute on function place_near_match to service_role;

comment on function place_near_match is
  'Best existing row within p_radius_m whose name is similar to p_name, or no
   rows. Stands in for a shared provider_ref now that a place can arrive from
   Google as well as from OpenStreetMap.';
