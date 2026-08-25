"use client";

import { useState } from "react";
import type { BenefitType, Place } from "@/lib/types";

type Sent = "confirm" | "not_working" | null;

/**
 * The signature control.
 *
 * Every other place on the page is flat; this pair has a real bottom edge that
 * compresses under a press, because it is the only thing standing between this
 * dataset and slow rot. It answers one question in one tap, from a phone, held
 * in one hand, outside a shop.
 */
export default function VerdictButtons({
  place,
  compact = false,
}: {
  place: Place;
  compact?: boolean;
}) {
  const [sent, setSent] = useState<Sent>(null);
  const [busy, setBusy] = useState<Sent>(null);
  const [error, setError] = useState<string | null>(null);

  // When a place carries only one benefit there is nothing to ask about, so
  // the report is attributed to it automatically.
  const onlyBenefit: BenefitType | null =
    place.benefit_fighter_card && !place.benefit_vacation_voucher
      ? "fighter_card"
      : place.benefit_vacation_voucher && !place.benefit_fighter_card
        ? "vacation_voucher"
        : null;

  async function send(kind: "confirm" | "not_working") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placeId: place.id,
          kind,
          benefitType: onlyBenefit,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "השליחה נכשלה, נסו שוב בעוד רגע");
        return;
      }
      setSent(kind);
    } catch {
      setError("אין חיבור לרשת. בדקו את החיבור ונסו שוב");
    } finally {
      setBusy(null);
    }
  }

  if (sent) {
    return (
      <div>
        <p
          className="verdict verdict-done"
          role="status"
          style={{ fontWeight: 600 }}
        >
          {sent === "confirm"
            ? "תודה, סימנו שההטבה עבדה כאן"
            : "תודה, הדיווח נרשם"}
        </p>
        <p
          className="mt-2 text-ink-faint"
          style={{ fontSize: "var(--text-2xs)" }}
        >
          {sent === "confirm"
            ? "הדיווח מעדכן את תאריך האימות של המקום."
            : "שלושה דיווחים כאלה בתוך 60 יום מסמנים את המקום כלא עובד."}
        </p>
      </div>
    );
  }

  return (
    <div>
      {!compact && (
        <p className="mb-2 font-bold" style={{ fontSize: "var(--text-base)" }}>
          הייתם כאן? עדכנו את השאר
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="verdict verdict-yes"
          onClick={() => send("confirm")}
          disabled={busy !== null}
        >
          {busy === "confirm" ? "שולח" : "עבד לי"}
        </button>
        <button
          type="button"
          className="verdict verdict-no"
          onClick={() => send("not_working")}
          disabled={busy !== null}
        >
          {busy === "not_working" ? "שולח" : "לא עבד לי"}
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-2 text-warn"
          style={{ fontSize: "var(--text-sm)" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
