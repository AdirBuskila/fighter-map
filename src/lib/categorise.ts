import type { Category } from "./types";

/**
 * Guess our category from Google's place types, so the submitter only has to
 * correct it rather than choose from fourteen options with a thumb.
 * Order matters: the first rule that matches wins.
 */
const RULES: Array<[Category, string[]]> = [
  ["cafe", ["cafe", "coffee_shop", "bakery", "ice_cream_shop", "dessert_shop"]],
  ["restaurant", ["restaurant", "meal_takeaway", "meal_delivery", "bar", "pub", "food"]],
  ["hotel", ["hotel", "lodging", "resort_hotel", "motel", "hostel", "extended_stay_hotel"]],
  ["zimmer", ["bed_and_breakfast", "guest_house", "cottage", "campground", "farmstay"]],
  ["spa", ["spa", "wellness_center", "massage", "sauna", "beauty_salon"]],
  ["shoes", ["shoe_store"]],
  ["clothing", ["clothing_store", "boutique", "department_store"]],
  ["sports", ["sporting_goods_store", "gym", "fitness_center", "sports_complex", "bicycle_store"]],
  ["electronics", ["electronics_store", "cell_phone_store", "computer_store", "home_goods_store"]],
  ["toys", ["toy_store", "baby_store", "child_care_agency"]],
  ["jewelry", ["jewelry_store", "watch_store"]],
  [
    "attraction",
    [
      "tourist_attraction", "amusement_park", "water_park", "zoo", "museum",
      "movie_theater", "aquarium", "national_park", "park", "bowling_alley",
      "night_club", "event_venue",
    ],
  ],
  ["gov_service", ["local_government_office", "city_hall", "post_office", "courthouse"]],
];

export function guessCategory(types: readonly string[] | undefined): Category {
  if (!types || types.length === 0) return "other";
  const set = new Set(types);
  for (const [category, googleTypes] of RULES) {
    if (googleTypes.some((type) => set.has(type))) return category;
  }
  return "other";
}

/**
 * Pull a city out of a Google formatted address. Israeli addresses come back
 * as "street number, city, Israel", so the segment before the country is the
 * one worth keeping.
 */
export function guessCity(formattedAddress: string | null | undefined): string | null {
  if (!formattedAddress) return null;
  const parts = formattedAddress
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^ישראל$|^israel$/i.test(part));
  if (parts.length === 0) return null;
  const candidate = parts[parts.length - 1];
  // A trailing postcode is not a city.
  if (/^\d[\d\s]*$/.test(candidate)) {
    return parts.length > 1 ? parts[parts.length - 2] : null;
  }
  return candidate.replace(/\s*\d{5,}\s*$/, "").trim() || null;
}
