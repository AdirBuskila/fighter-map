import type { Place } from "./types";

/**
 * Text matching for the search box, over places already in the browser.
 *
 * This is deliberately not a request. The whole mapped set is here already for
 * the map to draw, so filtering it costs nothing, works with no connection,
 * and answers on the keystroke. A round trip would be slower and would tell
 * somebody else what the reader is looking for.
 */

/** Combining marks: Latin diacritics from NFKD, then niqqud and te'amim. */
const MARKS = /[̀-֑ͯ-ׇ]/g;
/** Geresh and gershayim, typographic and ASCII: בי״ס, בי'ס, ביס. */
const QUOTES = /[׳״'"`‘’“”]/g;
/** Maqaf, hyphen and the dashes, used interchangeably in street names. */
const DASHES = /[־‐-―-]/g;

/**
 * Fold away the marks that stop two spellings of one name from matching.
 *
 * Hebrew business names are written inconsistently. Geresh and gershayim have
 * a typographic form and an ASCII stand-in and are dropped altogether about as
 * often; the maqaf, the hyphen and the en dash all turn up in the same street
 * name; and niqqud, rare in a name, does appear in imported addresses. None of
 * that should decide whether somebody finds their falafel place.
 *
 * The classes above are written as escapes on purpose. They are invisible
 * characters, and a range built from pasted glyphs is a range nobody can
 * review afterwards.
 */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(MARKS, "")
    .replace(QUOTES, "")
    .replace(DASHES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Everything about a place worth typing into a search box. */
function haystack(place: Place): string {
  return fold(
    [place.name_he, place.name_en, place.city, place.address_he]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * Every word of the query has to appear somewhere, in any order.
 *
 * Order-independent because "קפה חיפה" and "חיפה קפה" are one intent, and
 * word by word rather than whole-string because a reader types the name and
 * the town without knowing the address field already carries the town.
 *
 * Substring rather than prefix: Hebrew glues the definite article and most
 * one-letter prepositions onto the front of a word, so a prefix test would
 * fail to find הבורגר for somebody who typed בורגר.
 */
export function matchesQuery(place: Place, words: string[]): boolean {
  if (words.length === 0) return true;
  const hay = haystack(place);
  return words.every((word) => hay.includes(word));
}

/** Split a raw query once, so the list is not re-folded for every row. */
export function queryWords(query: string): string[] {
  return fold(query).split(" ").filter(Boolean);
}
