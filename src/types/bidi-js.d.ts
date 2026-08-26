/**
 * bidi-js ships no types. Only the two calls the social card needs are
 * declared, rather than a hand-written copy of the whole surface that would
 * drift out of date.
 */
declare module "bidi-js" {
  type EmbeddingLevels = {
    levels: Uint8Array;
    paragraphs: Array<{ start: number; end: number; level: number }>;
  };

  type Bidi = {
    getEmbeddingLevels(
      text: string,
      baseDirection?: "ltr" | "rtl" | "auto",
    ): EmbeddingLevels;
    /** Ranges of the string that must be reversed to reach visual order. */
    getReorderSegments(
      text: string,
      embeddingLevels: EmbeddingLevels,
      start?: number,
      end?: number,
    ): Array<[number, number]>;
  };

  export default function bidiFactory(): Bidi;
}
