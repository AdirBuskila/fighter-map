import type { Category } from "./types";

/**
 * Map an OSM key/value pair onto our category list, so the submitter only has
 * to correct the guess rather than pick from fourteen options with a thumb.
 * Photon returns the raw tag, e.g. osm_key="shop", osm_value="shoes".
 */
const OSM_CATEGORY: Record<string, Category> = {
  "amenity:restaurant": "restaurant",
  "amenity:fast_food": "restaurant",
  "amenity:food_court": "restaurant",
  "amenity:bar": "restaurant",
  "amenity:pub": "restaurant",
  "amenity:cafe": "cafe",
  "amenity:ice_cream": "cafe",
  "amenity:cinema": "attraction",
  "amenity:theatre": "attraction",
  "amenity:nightclub": "attraction",
  "shop:bakery": "cafe",
  "shop:pastry": "cafe",
  "shop:clothes": "clothing",
  "shop:boutique": "clothing",
  "shop:fashion": "clothing",
  "shop:department_store": "clothing",
  "shop:shoes": "shoes",
  "shop:sports": "sports",
  "shop:bicycle": "sports",
  "shop:outdoor": "sports",
  "shop:electronics": "electronics",
  "shop:mobile_phone": "electronics",
  "shop:computer": "electronics",
  "shop:toys": "toys",
  "shop:baby_goods": "toys",
  "shop:jewelry": "jewelry",
  "shop:watches": "jewelry",
  "tourism:hotel": "hotel",
  "tourism:hostel": "hotel",
  "tourism:motel": "hotel",
  "tourism:resort": "hotel",
  "tourism:guest_house": "zimmer",
  "tourism:chalet": "zimmer",
  "tourism:apartment": "zimmer",
  "tourism:attraction": "attraction",
  "tourism:museum": "attraction",
  "tourism:theme_park": "attraction",
  "tourism:zoo": "attraction",
  "leisure:fitness_centre": "sports",
  "leisure:sports_centre": "sports",
  "leisure:water_park": "attraction",
  "leisure:bowling_alley": "attraction",
  "amenity:spa": "spa",
  "shop:beauty": "spa",
  "shop:massage": "spa",
  "office:government": "gov_service",
  "amenity:townhall": "gov_service",
};

export function guessCategoryFromOsm(
  key: string | null,
  value: string | null,
): Category {
  if (!key || !value) return "other";
  return OSM_CATEGORY[`${key}:${value}`] ?? "other";
}
