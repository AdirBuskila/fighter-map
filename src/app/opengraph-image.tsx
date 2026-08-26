import { ImageResponse } from "next/og";
import bidiFactory from "bidi-js";
import { readFile } from "fs/promises";
import path from "path";

const bidi = bidiFactory();

/**
 * Hand satori text already in visual order.
 *
 * satori does no bidi reordering, and ignores `direction: rtl`, so a Hebrew
 * string renders backwards: מפת הטבות פייטר came out as רטייפ תובטה תפמ. This
 * is the same trap the PDF extractor and the map labels both hit, from the
 * other side: there we converted visual order back to logical, here we go
 * logical to visual.
 *
 * A naive reverse would do for pure Hebrew, but not for the comma in the
 * subtitle or any Latin, so this runs the real algorithm.
 *
 * One consequence: a pre-reversed string must never be allowed to wrap. Line
 * breaking has to happen in LOGICAL order, and satori would break the visual
 * one, which puts the start of the sentence on the second line. So any text
 * long enough to wrap is split into lines here and each line reversed on its
 * own.
 */
function visual(text: string): string {
  const levels = bidi.getEmbeddingLevels(text, "rtl");
  const chars = [...text];
  for (const [start, end] of bidi.getReorderSegments(text, levels)) {
    const flipped = chars.slice(start, end + 1).reverse();
    for (let i = 0; i < flipped.length; i += 1) chars[start + i] = flipped[i];
  }
  return chars.join("");
}

/**
 * The card WhatsApp, Telegram and Twitter show when somebody shares the link.
 *
 * This matters more than it looks: the plan for this site is one message
 * passed between reservists, and a link with no preview reads as spam. So the
 * card is the masthead, blown up: the signage panel, the white keyline set in
 * from the edge, and the two benefit marks that are the legend for the whole
 * map.
 *
 * Heebo is committed to the repo rather than fetched, so the card never
 * depends on a network call at build or request time. Two static cuts, not the
 * variable original: satori cannot read a variable font and fails with an
 * opaque "cannot read properties of undefined". tools/make_fonts.py
 * regenerates them.
 */

export const alt = "מפת הטבות פייטר";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const dir = path.join(process.cwd(), "src", "app", "_fonts");
  const [regular, bold] = await Promise.all([
    readFile(path.join(dir, "Heebo-Regular.ttf")),
    readFile(path.join(dir, "Heebo-ExtraBold.ttf")),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "#143fb0",
          fontFamily: "Heebo",
          position: "relative",
        }}
      >
        {/* The keyline. The one device that says road sign. */}
        <div
          style={{
            position: "absolute",
            top: 26,
            right: 26,
            bottom: 26,
            left: 26,
            border: "3px solid rgba(255,255,255,0.45)",
            borderRadius: 6,
            display: "flex",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              background: "#ffffff",
              display: "flex",
            }}
          />
          <div
            style={{
              width: 42,
              height: 42,
              background: "#e0a03a",
              transform: "rotate(45deg)",
              display: "flex",
            }}
          />
        </div>

        <div
          style={{
            marginTop: 34,
            fontSize: 88,
            fontWeight: 800,
            color: "#ffffff",
            letterSpacing: -1,
            display: "flex",
          }}
        >
          {visual("מפת הטבות פייטר")}
        </div>

        <div
          style={{
            marginTop: 20,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          {[
            "איפה באמת עובד כרטיס פייטר ושובר החופשה",
            "לפי דיווחי מילואימניקים בשטח",
          ].map((line) => (
            <div
              key={line}
              style={{ display: "flex", fontSize: 34, color: "#cfdcff" }}
            >
              {visual(line)}
            </div>
          ))}
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 58,
            fontSize: 24,
            color: "rgba(255,255,255,0.62)",
            display: "flex",
          }}
        >
          {visual("אתר קהילתי לא רשמי")}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Heebo", data: regular, style: "normal", weight: 400 },
        { name: "Heebo", data: bold, style: "normal", weight: 800 },
      ],
    },
  );
}
