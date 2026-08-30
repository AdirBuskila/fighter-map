// What the "open this place" buttons actually hand to Google and to Waze.
//
// Run with:  npm run urls
//
// This exists because of two bugs that a type checker cannot see, both of
// which are encoded below as cases:
//
//   1. googleMapsUrl() used to append `&query=<name>` after the coordinates.
//      A repeated query parameter is resolved to the last one, so every
//      *pinned* place opened as a name search and silently discarded the point
//      we had geocoded for it. The URL was well-formed and the button worked,
//      which is exactly why nobody noticed.
//
//   2. Without a pin it searched the bare name. Roughly half the corpus has no
//      coordinates, and "קמיליון" on its own is a word rather than a shop, so
//      the fallback that was supposed to rescue those rows mostly did not.
//
// Node 22 strips the types at load, so this imports src/lib/format.ts directly
// rather than restating the URL shapes in a fixture, which is how a table like
// this normally rots.
import { googleMapsUrl, wazeUrl } from "../src/lib/format.ts";

const BASE = {
  id: "x", provider_ref: null, name_he: "", name_en: null, category: "other",
  is_chain: false, is_online: false, lat: null, lng: null,
  location_precision: "exact", address_he: null,
  city: null, phone: null, url: null, benefit_fighter_card: true,
  benefit_vacation_voucher: false, note_he: null, source: "pdf_import",
  status: "published", confirm_count: 0, report_count: 0,
  first_reported_at: null, last_confirmed_at: null, distance_m: null,
};
const place = (over) => ({ ...BASE, ...over });

let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    failed += 1;
    console.log(`  FAIL  ${label}\n          got  ${actual}\n          want ${expected}`);
  } else {
    console.log(`  ok    ${label}`);
  }
  return ok;
}

console.log("google maps");

check(
  "a pinned place goes to its point, and only its point",
  googleMapsUrl(place({ name_he: "בת-חן שריג", city: "בית אל", lat: 31.9432512, lng: 35.2266116 })),
  "https://www.google.com/maps/search/?api=1&query=31.9432512%2C35.2266116",
);

check(
  "a pinned URL carries exactly one query parameter",
  (googleMapsUrl(place({ name_he: "x", lat: 31.8, lng: 35.3 })).match(/[?&]query=/g) || []).length,
  1,
);

check(
  "no pin searches the name and the town together",
  decodeURIComponent(googleMapsUrl(place({ name_he: "קמיליון", city: "תל אביב" }))),
  "https://www.google.com/maps/search/?api=1&query=קמיליון תל אביב",
);

check(
  "a street makes the search sharper still",
  decodeURIComponent(googleMapsUrl(place({
    name_he: "גולף", address_he: "דרך קדם 5", city: "מעלה אדומים",
  }))),
  "https://www.google.com/maps/search/?api=1&query=גולף דרך קדם 5 מעלה אדומים",
);

check(
  "a town already inside the address is not repeated",
  decodeURIComponent(googleMapsUrl(place({
    name_he: "צ'קפוינט", address_he: "הנפח, חיפה", city: "חיפה",
  }))),
  "https://www.google.com/maps/search/?api=1&query=צ'קפוינט הנפח, חיפה",
);

check(
  "a town already inside the name is not repeated either",
  decodeURIComponent(googleMapsUrl(place({
    name_he: "אושיקה מעלה אדומים",
    city: "מעלה אדומים",
  }))),
  "https://www.google.com/maps/search/?api=1&query=אושיקה מעלה אדומים",
);

check(
  "a name on its own is still a usable link, just a vague one",
  decodeURIComponent(googleMapsUrl(place({ name_he: "תמנון" }))),
  "https://www.google.com/maps/search/?api=1&query=תמנון",
);

// A town pin is a point, but not one worth navigating to: it is the middle
// of the settlement. Sending somebody there is worse than sending them to a
// search, because the map app announces they have arrived in the wrong place.
check(
  "a town pin is not treated as a location",
  decodeURIComponent(googleMapsUrl(place({ name_he: "קמיליון", city: "תל אביב", lat: 32.0853, lng: 34.7818, location_precision: "town" }))),
  "https://www.google.com/maps/search/?api=1&query=קמיליון תל אביב",
);

console.log("\nwaze");

check(
  "a pinned place navigates to the point",
  wazeUrl(place({ name_he: "בת-חן שריג", lat: 31.9432512, lng: 35.2266116 })),
  "https://waze.com/ul?ll=31.9432512,35.2266116&navigate=yes",
);

check(
  "without a pin it searches the same terms Google gets",
  decodeURIComponent(wazeUrl(place({ name_he: "קמיליון", city: "תל אביב" }))),
  "https://waze.com/ul?q=קמיליון תל אביב",
);

check(
  "and waze searches for it rather than driving to the town centre",
  decodeURIComponent(wazeUrl(place({ name_he: "קמיליון", city: "תל אביב", lat: 32.0853, lng: 34.7818, location_precision: "town" }))),
  "https://waze.com/ul?q=קמיליון תל אביב",
);

console.log(failed === 0 ? "\nall cases passed" : `\n${failed} failures`);
process.exit(failed === 0 ? 0 : 1);
