import { fold } from "./search";
import type { Place } from "./types";

/**
 * Paid placements: these rows go to the top of the list whenever they pass
 * the reader's filters, and they always say so.
 *
 * The label is not optional. A reader trusts this list because it is
 * community-reported, and Israeli consumer protection law requires paid
 * content to be marked as such, so a sponsored row that looked organic would
 * be both a lie and a liability. Promotion changes the order, never the
 * filters: a sponsor that does not match what somebody searched for is not
 * shown to them.
 *
 * Matched by name because that is what is known when a deal is made; set `id`
 * once the place is on the map to pin it to that exact row. `until` is the
 * last day of the paid period, so a lapsed deal stops by itself.
 */
type Sponsorship = { name: string; id?: string; until: string };

export const SPONSORSHIPS: Sponsorship[] = [
  { name: "אלומה פיור סקין", until: "2026-12-31" },
];

const active = () => {
  const today = new Date().toISOString().slice(0, 10);
  return SPONSORSHIPS.filter((s) => s.until >= today);
};

export function isSponsored(place: Place): boolean {
  const name = fold(place.name_he);
  return active().some((s) => (s.id ? s.id === place.id : name.includes(fold(s.name))));
}

/** Sponsored rows first, everything else in the order it already had. */
export function sponsoredFirst(places: Place[]): Place[] {
  const top = places.filter(isSponsored);
  if (top.length === 0) return places;
  return [...top, ...places.filter((place) => !isSponsored(place))];
}
