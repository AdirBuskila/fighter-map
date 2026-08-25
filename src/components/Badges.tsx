import type { Place } from "@/lib/types";
import { formatDate, isStale, lastSignal } from "@/lib/format";

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

/** Warnings, in the order a reader needs them. */
export function StatusBadges({ place }: { place: Place }) {
  const stale = isStale(place);
  return (
    <>
      {place.status === "reported_not_working" && (
        <span className="chip chip-warn">דווח שלא עבד</span>
      )}
      {place.status === "pending" && <span className="chip">ממתין לאישור</span>}
      {stale && place.status !== "reported_not_working" && (
        <span className="chip chip-stale">לא מאומת לאחרונה</span>
      )}
    </>
  );
}

export function LastSignalLine({ place }: { place: Place }) {
  const date = formatDate(lastSignal(place));
  if (!date) return null;
  const verb = place.last_confirmed_at ? "אומת" : "דווח";
  return (
    <span className="text-ink-faint" style={{ fontSize: "var(--text-2xs)" }}>
      {verb} לאחרונה ב{date}
    </span>
  );
}
