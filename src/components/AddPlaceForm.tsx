"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import PlacePicker, { type PickedPlace } from "./PlacePicker";
import GoogleLinkPicker from "./GoogleLinkPicker";
import Turnstile from "./Turnstile";
import { CATEGORY_LABELS, CATEGORY_ORDER, type Category } from "@/lib/types";

const NOTE_LIMIT = 200;

export default function AddPlaceForm() {
  return <Form />;
}

function Form() {
  const router = useRouter();
  const [picked, setPicked] = useState<PickedPlace | null>(null);
  const [emptyQuery, setEmptyQuery] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>("other");
  const [fighter, setFighter] = useState(false);
  const [voucher, setVoucher] = useState(false);
  const [note, setNote] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The new place's id travels with the outcome, because the whole point of
  // publishing on arrival is that the contributor gets to go and look at it.
  const [done, setDone] = useState<{
    outcome: "published" | "confirmed_existing";
    placeId: string | null;
  } | null>(null);

  const handlePick = useCallback((place: PickedPlace) => {
    setPicked((previous) => {
      // The link picker re-emits on every keystroke in its name field, so only
      // a genuinely different place may reset a category the person chose by
      // hand. Comparing the ref alone is not enough: a link with no Google id
      // sends null, and two of those in a row are not the same place.
      const same =
        previous !== null &&
        previous.providerRef === place.providerRef &&
        previous.lat === place.lat &&
        previous.lng === place.lng;
      if (!same) setCategory(place.category);
      return place;
    });
    setError(null);
  }, []);
  const handleClear = useCallback(() => setPicked(null), []);
  const handleEmpty = useCallback((query: string | null) => setEmptyQuery(query), []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!picked) {
      setError("בחרו מקום מרשימת החיפוש");
      return;
    }
    if (!fighter && !voucher) {
      setError("סמנו לפחות סוג הטבה אחד");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerRef: picked.providerRef,
          nameHe: picked.nameHe,
          lat: picked.lat,
          lng: picked.lng,
          addressHe: picked.addressHe,
          city: picked.city,
          category,
          benefitFighterCard: fighter,
          benefitVacationVoucher: voucher,
          note: note.trim() || undefined,
          turnstileToken: token ?? undefined,
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        outcome?: "published" | "confirmed_existing";
        placeId?: string;
      };
      if (!res.ok) {
        setError(body.error ?? "השליחה נכשלה. נסו שוב בעוד רגע");
        return;
      }
      const placeId = body.placeId ?? null;
      setDone({ outcome: body.outcome ?? "published", placeId });
      // Either branch ends on that place's page, so warm it while the reader
      // is still looking at the confirmation.
      if (placeId) router.prefetch(`/place/${placeId}`);
    } catch {
      setError("אין חיבור לרשת. בדקו את החיבור ונסו שוב");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const added = done.outcome !== "confirmed_existing";
    return (
      <div role="status">
        <h2 className="font-extrabold" style={{ fontSize: "var(--text-xl)" }}>
          {added ? "המקום נוסף למפה" : "המקום כבר במפה, והדיווח שלכם נוסף לו"}
        </h2>
        <p className="mt-2 text-ink-soft" style={{ fontSize: "var(--text-base)" }}>
          {added
            ? "הוא מסומן כרגע כדיווח אחד. ברגע שעוד מישהו יאשר שההטבה עבדה שם, הסימון יתמלא."
            : "עדכנו את סוגי ההטבה לפי מה שסימנתם."}
        </p>
        <div className="mt-6 flex gap-2">
          {/* Straight to the pin. Somebody who just added a place and cannot
              find it assumes nothing happened, and does not add a second. */}
          <button
            type="button"
            className="btn btn-primary px-4"
            onClick={() => router.push(done.placeId ? `/place/${done.placeId}` : "/map")}
          >
            {added ? "הצגת המקום" : "מעבר למקום"}
          </button>
          <button
            type="button"
            className="btn px-4"
            onClick={() => {
              setDone(null);
              setPicked(null);
              setFighter(false);
              setVoucher(false);
              setNote("");
            }}
          >
            הוספת מקום נוסף
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <PlacePicker onPick={handlePick} onClear={handleClear} onEmpty={handleEmpty} />

      <GoogleLinkPicker
        open={emptyQuery !== null}
        suggestedName={emptyQuery ?? ""}
        onPick={handlePick}
        onClear={handleClear}
      />

      {picked && (
        <div
          className="mt-3 border-r-4 border-fighter bg-fighter-tint px-3 py-2"
          style={{ fontSize: "var(--text-sm)" }}
        >
          <strong className="font-bold">{picked.nameHe}</strong>
          {picked.addressHe && (
            <span className="block text-ink-soft">{picked.addressHe}</span>
          )}
        </div>
      )}

      <fieldset className="mt-6 border-0 p-0">
        <legend className="mb-2 font-bold" style={{ fontSize: "var(--text-base)" }}>
          מה עבד שם?
        </legend>
        <div className="flex flex-col gap-2">
          <BenefitCheck
            checked={fighter}
            onChange={setFighter}
            label="כרטיס פייטר"
            mark="fighter"
          />
          <BenefitCheck
            checked={voucher}
            onChange={setVoucher}
            label="שובר חופשה"
            mark="voucher"
          />
        </div>
      </fieldset>

      <div className="mt-6">
        <label
          htmlFor="category"
          className="mb-1 block font-bold"
          style={{ fontSize: "var(--text-base)" }}
        >
          קטגוריה
        </label>
        <select
          id="category"
          className="field"
          value={category}
          onChange={(event) => setCategory(event.target.value as Category)}
        >
          {CATEGORY_ORDER.map((value) => (
            <option key={value} value={value}>
              {CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6">
        <label
          htmlFor="note"
          className="mb-1 block font-bold"
          style={{ fontSize: "var(--text-base)" }}
        >
          הערה, לא חובה
        </label>
        <textarea
          id="note"
          className="field"
          rows={3}
          maxLength={NOTE_LIMIT}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="למשל: רק בקופה הראשית, לא במשלוחים"
        />
        <p
          className="mt-1 text-ink-faint tabular-nums"
          style={{ fontSize: "var(--text-2xs)" }}
        >
          {note.length} מתוך {NOTE_LIMIT}
        </p>
      </div>

      <Turnstile onToken={setToken} />

      {error && (
        <p role="alert" className="mt-4 text-warn" style={{ fontSize: "var(--text-sm)" }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        className="verdict verdict-yes mt-6 w-full"
        disabled={busy}
      >
        {busy ? "שולח" : "שליחה"}
      </button>
    </form>
  );
}

function BenefitCheck({
  checked,
  onChange,
  label,
  mark,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  mark: "fighter" | "voucher";
}) {
  return (
    <label
      className={`tap flex cursor-pointer items-center gap-3 border-2 px-3 ${
        checked ? "border-fighter bg-fighter-tint" : "border-line-strong"
      }`}
      style={{ borderRadius: "var(--radius)" }}
    >
      <input
        type="checkbox"
        className="h-5 w-5 accent-[var(--fighter)]"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden="true" className={`mark mark-${mark}`} />
      <span className="font-semibold">{label}</span>
    </label>
  );
}
