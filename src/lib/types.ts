export type BenefitType = "fighter_card" | "vacation_voucher";

export type PlaceStatus =
  | "published"
  | "pending"
  | "rejected"
  | "reported_not_working";

/**
 * Where a row came from.
 *
 * This rides along with every place because the trust rules read differently
 * depending on it: a `user_submission` with one vouch is one person's word and
 * can be pulled by one report, while a `pdf_import` with none came from a
 * spreadsheet many reservists wrote into and still takes three.
 */
export type PlaceSource = "pdf_import" | "user_submission";

export type Category =
  | "restaurant"
  | "cafe"
  | "hotel"
  | "zimmer"
  | "spa"
  | "clothing"
  | "shoes"
  | "sports"
  | "electronics"
  | "toys"
  | "jewelry"
  | "attraction"
  | "gov_service"
  | "other";

/** One row as `places_near` and `places_all` return it. */
export type Place = {
  id: string;
  /** Stable external identity, e.g. "osm:node/4798363423". */
  provider_ref: string | null;
  name_he: string;
  name_en: string | null;
  category: Category;
  is_chain: boolean;
  is_online: boolean;
  lat: number | null;
  lng: number | null;
  address_he: string | null;
  city: string | null;
  phone: string | null;
  url: string | null;
  benefit_fighter_card: boolean;
  benefit_vacation_voucher: boolean;
  note_he: string | null;
  source: PlaceSource;
  status: PlaceStatus;
  confirm_count: number;
  report_count: number;
  first_reported_at: string | null;
  last_confirmed_at: string | null;
  distance_m: number | null;
};

/** A chain branch found live in the browser. Never written to the database. */
export type EphemeralBranch = {
  key: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  brandId: string;
};

export const CATEGORY_LABELS: Record<Category, string> = {
  restaurant: "מסעדות",
  cafe: "בתי קפה",
  hotel: "מלונות",
  zimmer: "צימרים",
  spa: "ספא",
  clothing: "ביגוד",
  shoes: "הנעלה",
  sports: "ספורט",
  electronics: "אלקטרוניקה",
  toys: "צעצועים",
  jewelry: "תכשיטים",
  attraction: "אטרקציות",
  gov_service: "שירותי ממשלה",
  other: "אחר",
};

export const CATEGORY_ORDER: Category[] = [
  "restaurant",
  "cafe",
  "hotel",
  "zimmer",
  "clothing",
  "shoes",
  "sports",
  "toys",
  "electronics",
  "jewelry",
  "attraction",
  "spa",
  "gov_service",
  "other",
];

export const BENEFIT_LABELS: Record<BenefitType, string> = {
  fighter_card: "כרטיס פייטר",
  vacation_voucher: "שובר חופשה",
};

/** Israel, framed so the whole country fits on a phone in portrait. */
export const ISRAEL_CENTER = { lat: 31.5, lng: 34.95 };
export const ISRAEL_DEFAULT_ZOOM = 7;

/** Where suggestions go. Subject is prefilled so the inbox stays sortable. */
export const CONTACT_EMAIL = "adirbu98@gmail.com";
export const CONTACT_MAILTO =
  `mailto:${CONTACT_EMAIL}?subject=` + encodeURIComponent("מפת הטבות פייטר");

export const LEGAL_NOTICE =
  "אתר קהילתי לא רשמי. המידע מבוסס על דיווחי משתמשים ואינו מהווה התחייבות של מפעיל הכרטיס. ייתכנו שינויים, מומלץ לוודא בבית העסק.";
