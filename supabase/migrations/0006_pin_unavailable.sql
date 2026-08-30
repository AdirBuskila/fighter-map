-- A place we cannot pin is still worth showing.
--
-- 482 imported places have no coordinates, because OpenStreetMap has never
-- heard of most small Israeli businesses. Both geocoding passes have already
-- run against them; these are the leftovers, not a queue nobody has touched.
-- They sat invisible in /admin waiting for a moderator to place each one by
-- hand, which is several days of work that nobody was going to do.
--
-- They do not actually need a pin to be useful. A reader who taps one gets
-- `googleMapsUrl()`, which without coordinates falls back to a Maps *search*
-- for the business by name and town -- and Google, unlike OSM, knows these
-- shops. "Where exactly is it" was never the question the card had to answer;
-- "does the card work here, and what is this place called" was.
--
-- What stopped that was places_published_needs_pin. It required a physical
-- place to carry a point before it could be published, and it was right to:
-- publishing a row whose location nobody has checked is how a place ends up
-- on the map in the wrong building. The guard should not be dropped, it
-- should be made possible to answer.
--
-- So: an explicit opt-in. pin_unavailable means somebody decided this place
-- cannot be pinned and is still worth listing -- as opposed to nobody having
-- looked yet, which is what a pending row without it still means. The
-- constraint reads the same as before for every row that does not set it.
--
-- Deliberately NOT added to places_near, places_all or place_by_id. The map
-- queries already filter `location is not null`, so a pinless row cannot
-- reach the map however this column is set, and place_by_id never filtered on
-- location, so these pages already render. The read side needs no new column:
-- `lat is null` is what the UI keys on, and that is already returned. Leaving
-- the three RPCs alone also leaves the Place type at 23 fields, which is the
-- contract scripts/check_migration.py holds down.

alter table places
  add column if not exists pin_unavailable boolean not null default false;

comment on column places.pin_unavailable is
  'Reviewed and cannot be located: publish it without a point, and let the '
  'reader find it by name in Google Maps. Not the same as "not looked at yet".';

alter table places
  drop constraint if exists places_published_needs_pin;

alter table places
  add constraint places_published_needs_pin
    check (status <> 'published'
           or is_chain or is_online
           or pin_unavailable
           or location is not null);

-- The list query reads these by status and a null location, and there are
-- enough of them now that a sequential scan of the table is wasteful.
create index if not exists places_unpinned_idx
  on places (status)
  where location is null and not is_chain and not is_online;
