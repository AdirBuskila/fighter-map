"use client";

import { useEffect, useId, useRef, useState } from "react";
import { currentPosition } from "@/lib/geo";
import type { Category } from "@/lib/types";

export type PickedPlace = {
  providerRef: string;
  nameHe: string;
  lat: number;
  lng: number;
  addressHe: string | null;
  city: string | null;
  category: Category;
};

type Result = {
  providerRef: string;
  name: string;
  address: string | null;
  city: string | null;
  category: Category;
  lat: number;
  lng: number;
};

/**
 * Search for the place, then pick it from the list.
 *
 * Typing alone is never enough. Identity has to come from the provider, or two
 * people reporting the same shop create two rows that can never be joined, and
 * "is it worth walking in" stops having a single answer. So the form carries a
 * providerRef and the submit button stays disabled until a result is chosen.
 *
 * This is our own combobox rather than a vendor widget, which means the ARIA is
 * right, the keyboard works, and it looks like the rest of the app instead of
 * like an iframe someone dropped in.
 */
export default function PlacePicker({
  onPick,
  onClear,
}: {
  onPick: (place: PickedPlace) => void;
  onClear: () => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const here = useRef<{ lat: number; lng: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Bias results to wherever the reader is standing. A refusal is not worth
  // surfacing: search still works country-wide without it.
  useEffect(() => {
    void currentPosition()
      .then((position) => {
        here.current = position;
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    // Debounced, because this hits somebody else's free service on every
    // keystroke otherwise.
    const timer = window.setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: term, limit: "8" });
        if (here.current) {
          params.set("lat", String(here.current.lat));
          params.set("lng", String(here.current.lng));
        }
        const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
        const body = (await response.json()) as { results?: Result[]; error?: string };
        if (!response.ok) {
          setError(body.error ?? "החיפוש נכשל, נסו שוב");
          return;
        }
        setResults(body.results ?? []);
        setActive(-1);
        setOpen(true);
      } catch (cause) {
        if ((cause as Error)?.name !== "AbortError") {
          setError("אין חיבור לרשת. בדקו את החיבור ונסו שוב");
        }
      } finally {
        setBusy(false);
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, []);

  function choose(result: Result) {
    setQuery(result.name);
    setOpen(false);
    setActive(-1);
    onPick({
      providerRef: result.providerRef,
      nameHe: result.name,
      lat: result.lat,
      lng: result.lng,
      addressHe: result.address,
      city: result.city,
      category: result.category,
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={box} className="relative">
      <label
        htmlFor="place-search"
        className="mb-1 block font-bold"
        style={{ fontSize: "var(--text-base)" }}
      >
        איזה מקום?
      </label>
      <input
        id="place-search"
        className="field"
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        placeholder="שם העסק, למשל לחם בשר"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          // Typing after a pick invalidates it: the form must never submit a
          // ref that no longer matches what the box says.
          onClear();
        }}
        onKeyDown={onKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
      />

      <p className="mt-1 text-ink-faint" style={{ fontSize: "var(--text-xs)" }}>
        {busy ? "מחפש" : "הקלידו ובחרו מהרשימה. הבחירה ממלאת כתובת וקטגוריה לבד."}
      </p>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto border-2 border-line-strong bg-surface"
          style={{ borderRadius: "var(--radius)" }}
        >
          {results.length === 0 && !busy && (
            <li className="px-3 py-3 text-ink-soft" style={{ fontSize: "var(--text-sm)" }}>
              לא מצאנו מקום בשם הזה. נסו שם קצר יותר, או בלי סוג העסק.
            </li>
          )}
          {results.map((result, index) => (
            <li
              key={result.providerRef}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(result);
              }}
              className={`tap cursor-pointer border-t border-line px-3 py-2 first:border-t-0 ${
                index === active ? "bg-fighter-tint" : ""
              }`}
            >
              <span className="block font-bold" style={{ fontSize: "var(--text-base)" }}>
                {result.name}
              </span>
              {result.address && (
                <span
                  className="block text-ink-soft"
                  style={{ fontSize: "var(--text-sm)" }}
                >
                  {result.address}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-1 text-warn" style={{ fontSize: "var(--text-sm)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
