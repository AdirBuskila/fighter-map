import type { Place } from "@/lib/types";
import { formatDate, isFresh, isStale, lastSignal } from "@/lib/format";

/**
 * Benefit chips. Shape carries the meaning as well as colour: a circle for the
 * fighter card, a diamond for the vacation voucher. Someone with no colour
 * vision at all still reads these correctly.
 */
export function BenefitChips({ place }: { place: Place }) {
  return (
    <>
      {place.benefit_fighter_card && (
        <span className="chip chip-fighter">
          <span aria-hidden="true" className="mark mark-fighter" />
          פייטר
        </span>
      )}
      {place.benefit_vacation_voucher && (
        <span className="chip chip-voucher">
          <span aria-hidden="true" className="mark mark-voucher" />
          שובר חופשה
        </span>
      )}
    </>
  );
}

export function KindChip({ place }: { place: Place }) {
  if (place.is_chain) return <span className="chip">רשת ארצית</span>;
  if (place.is_online) return <span className="chip">אונליין</span>;
  return null;
}

/** Badges, in the order a reader needs them. At most one appears per place. */
export function StatusBadges({ place }: { place: Place }) {
  if (place.status === "reported_not_working") {
    return <span className="chip chip-warn">דווח שלא עבד</span>;
  }
  if (place.status === "pending") {
    return <span className="chip">ממתין לאישור</span>;
  }
  if (isStale(place)) {
    return <span className="chip chip-stale">לא מאומת לאחרונה</span>;
  }
  if (isFresh(place)) {
    return <span className="chip chip-ok">אומת החודש</span>;
  }
  return null;
}

/**
 * The age of the information, as a plain sentence rather than a badge. Most
 * imported places land here: reported once by somebody in the spreadsheet and
 * never confirmed on the site since.
 */
export function LastSignalLine({ place }: { place: Place }) {
  const date = formatDate(lastSignal(place));
  if (!date) {
    return (
      <span className="text-ink-faint" style={{ fontSize: "var(--text-2xs)" }}>
        מהדיווחים המקוריים, בלי תאריך
      </span>
    );
  }
  return (
    <span className="text-ink-faint" style={{ fontSize: "var(--text-2xs)" }}>
      {place.last_confirmed_at ? `אומת לאחרונה ב${date}` : `דווח ב${date}`}
    </span>
  );
}
