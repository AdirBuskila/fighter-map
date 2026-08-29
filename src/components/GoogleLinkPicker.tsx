"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import MiniMap from "./MiniMap";
import type { PickedPlace } from "./PlacePicker";

type Resolved = {
  lat: number;
  lng: number;
  providerRef: string | null;
  name: string | null;
  city: string | null;
  address: string | null;
};

const NAME_LIMIT = 160;

/**
 * Add a place the search cannot find, by pasting its Google Maps link.
 *
 * The search is still the better path when it works: it supplies an address, a
 * category and an identity that joins with the imported corpus. So this sits
 * underneath it and opens by itself when a search comes back empty, which is
 * the moment somebody would otherwise give up and send an email instead. Those
 * emails are what this exists to stop.
 */
export default function GoogleLinkPicker({
  open,
  suggestedName,
  onPick,
  onClear,
}: {
  open: boolean;
  suggestedName: string;
  onPick: (place: PickedPlace) => void;
  onClear: () => void;
}) {
  const fieldId = useId();
  const [expanded, setExpanded] = useState(false);
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Paste, then edit, then paste again: a resolve still in flight must not
  // overwrite a newer one's answer.
  const attempt = useRef(0);

  useEffect(() => {
    if (open) setExpanded(true);
  }, [open]);

  const resolve = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      setResolved(null);
      onClear();
      if (!trimmed) {
        setError(null);
        return;
      }
      const mine = (attempt.current += 1);
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/resolve-link?url=${encodeURIComponent(trimmed)}`,
        );
        const body = (await response.json()) as Resolved & { error?: string };
        if (mine !== attempt.current) return;
        if (!response.ok) {
          setError(body.error ?? "לא הצלחנו לקרוא את הקישור");
          return;
        }
        setResolved(body);
        setName((current) => current || body.name || suggestedName);
      } catch {
        if (mine !== attempt.current) return;
        setError("אין חיבור לרשת. בדקו את החיבור ונסו שוב");
      } finally {
        if (mine === attempt.current) setBusy(false);
      }
    },
    [onClear, suggestedName],
  );

  // Hand the pick up whenever both halves are present. The name is the half a
  // link cannot supply reliably, so it is a field the person fills rather than
  // a guess the form makes silently.
  useEffect(() => {
    const trimmed = name.trim();
    if (!resolved || !trimmed) {
      onClear();
      return;
    }
    onPick({
      providerRef: resolved.providerRef,
      nameHe: trimmed,
      lat: resolved.lat,
      lng: resolved.lng,
      addressHe: resolved.address,
      city: resolved.city,
      category: "other",
    });
  }, [resolved, name, onPick, onClear]);

  if (!expanded) {
    return (
      <button
        type="button"
        className="tap mt-3 block text-ink-soft underline"
        style={{ fontSize: "var(--text-sm)" }}
        onClick={() => setExpanded(true)}
      >
        לא מצאתם את בית העסק? הדביקו קישור מגוגל מפות
      </button>
    );
  }

  return (
    <div
      className="mt-4 border-2 border-line-strong px-3 py-3"
      style={{ borderRadius: "var(--radius)" }}
    >
      <label
        htmlFor={fieldId}
        className="mb-1 block font-bold"
        style={{ fontSize: "var(--text-base)" }}
      >
        קישור מגוגל מפות
      </label>
      <input
        id={fieldId}
        className="field"
        type="url"
        inputMode="url"
        dir="ltr"
        autoComplete="off"
        placeholder="https://maps.app.goo.gl/..."
        value={link}
        onChange={(event) => {
          setLink(event.target.value);
          void resolve(event.target.value);
        }}
      />
      <p className="mt-1 text-ink-faint" style={{ fontSize: "var(--text-xs)" }}>
        {busy
          ? "בודק את הקישור"
          : "בגוגל מפות: חפשו את בית העסק, לחצו שיתוף, העתקת קישור, והדביקו כאן."}
      </p>

      {error && (
        <p role="alert" className="mt-2 text-warn" style={{ fontSize: "var(--text-sm)" }}>
          {error}
        </p>
      )}

      {resolved && (
        <>
          <MiniMap lat={resolved.lat} lng={resolved.lng} label={name || undefined} />
          {resolved.address && (
            <p className="mt-1 text-ink-soft" style={{ fontSize: "var(--text-sm)" }}>
              {resolved.address}
            </p>
          )}

          <label
            htmlFor={`${fieldId}-name`}
            className="mb-1 mt-3 block font-bold"
            style={{ fontSize: "var(--text-base)" }}
          >
            שם בית העסק
          </label>
          <input
            id={`${fieldId}-name`}
            className="field"
            type="text"
            maxLength={NAME_LIMIT}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="למשל: עמנואל שלם"
          />
          <p className="mt-1 text-ink-faint" style={{ fontSize: "var(--text-xs)" }}>
            בדקו שהסימון על המפה הוא באמת בית העסק, ושהשם כתוב כמו שאנשים מכירים אותו.
          </p>
        </>
      )}
    </div>
  );
}
