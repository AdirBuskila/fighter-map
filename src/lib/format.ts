import type { Place } from "./types";

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 183;

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

export function isStale(place: Place): boolean {
  const signal = lastSignal(place);
  if (!signal) return true;
  return Date.now() - new Date(signal).getTime() > SIX_MONTHS_MS;
}

export function wazeUrl(place: Place): string {
  if (place.lat != null && place.lng != null) {
    return `https://waze.com/ul?ll=${place.lat},${place.lng}&navigate=yes`;
  }
  return `https://waze.com/ul?q=${encodeURIComponent(place.name_he)}`;
}

export function googleMapsUrl(place: Place): string {
  if (place.google_place_id) {
    const query = encodeURIComponent(place.name_he);
    return `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${place.google_place_id}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name_he)}`;
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** Absolute URL for a link the user typed as "example.co.il". */
export function externalUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
