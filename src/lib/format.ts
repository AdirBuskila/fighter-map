import type { Place } from "./types";

const DAY_MS = 1000 * 60 * 60 * 24;
const SIX_MONTHS_MS = DAY_MS * 183;
const ONE_MONTH_MS = DAY_MS * 30;

/** Distance the way someone standing on a pavement would say it. */
export function formatDistance(metres: number | null): string | null {
  if (metres == null) return null;
  if (metres < 950) return `${Math.round(metres / 10) * 10} מ׳`;
  return `${(metres / 1000).toFixed(metres < 9500 ? 1 : 0)} ק״מ`;
}

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/** The most recent moment anybody vouched for this place. */
export function lastSignal(place: Place): string | null {
  return place.last_confirmed_at ?? place.first_reported_at;
}

/**
 * Verified once, but a long time ago.
 *
 * Deliberately false when last_confirmed_at is null. Falling back to
 * first_reported_at instead would badge 772 of the 857 imported places on the
 * first day, because the seed spreadsheet is a historical dump: a warning on
 * ninety percent of rows is decoration, and it buries the rows that really
 * did go quiet. A place nobody has confirmed here yet is a different fact,
 * and it gets stated plainly instead.
 */
export function isStale(place: Place): boolean {
  if (!place.last_confirmed_at) return false;
  return Date.now() - new Date(place.last_confirmed_at).getTime() > SIX_MONTHS_MS;
}

/** Nobody has vouched for this place on the site yet. */
export function isUnverified(place: Place): boolean {
  return !place.last_confirmed_at;
}

/**
 * Confirmed in the last month. This is the scarce signal on a crowd-sourced
 * map, so it is the one worth spending a badge on.
 */
export function isFresh(place: Place): boolean {
  if (!place.last_confirmed_at) return false;
  return Date.now() - new Date(place.last_confirmed_at).getTime() <= ONE_MONTH_MS;
}

export function wazeUrl(place: Place): string {
  if (place.lat != null && place.lng != null) {
    return `https://waze.com/ul?ll=${place.lat},${place.lng}&navigate=yes`;
  }
  return `https://waze.com/ul?q=${encodeURIComponent(place.name_he)}`;
}

/**
 * Deep links out. These are plain URLs, not API calls: no key, no billing, no
 * account. Coordinates beat a name search when we have them, because a name
 * search lands the reader on whichever branch the provider feels like.
 */
export function googleMapsUrl(place: Place): string {
  if (place.lat != null && place.lng != null) {
    const label = encodeURIComponent(place.name_he);
    return `https://www.google.com/maps/search/?api=1&query=${place.lat}%2C${place.lng}&query=${label}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name_he)}`;
}

/** The place as OpenStreetMap knows it, so a reader can fix a wrong pin. */
export function osmUrl(place: Place): string | null {
  if (!place.provider_ref?.startsWith("osm:")) return null;
  return `https://www.openstreetmap.org/${place.provider_ref.slice(4)}`;
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** Absolute URL for a link the user typed as "example.co.il". */
export function externalUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
