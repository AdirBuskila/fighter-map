"use client";

import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { useEffect, useRef, useState } from "react";
import { guessCategory, guessCity } from "@/lib/categorise";
import { currentPosition } from "@/lib/geo";
import type { Category } from "@/lib/types";

export type PickedPlace = {
  googlePlaceId: string;
  nameHe: string;
  lat: number;
  lng: number;
  addressHe: string | null;
  city: string | null;
  category: Category;
};

/**
 * Google's PlaceAutocompleteElement, restricted to Israel.
 *
 * Deliberately not a text input. Identity has to come from Google, or two
 * people reporting the same shop create two rows that can never be joined and
 * "is it worth walking in" stops having a single answer.
 *
 * It is a web component Google renders itself, so it is mounted imperatively
 * into a host div rather than returned from JSX.
 */
export default function PlacePicker({
  onPick,
  onClear,
}: {
  onPick: (place: PickedPlace) => void;
  onClear: () => void;
}) {
  const placesLib = useMapsLibrary("places");
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = host.current;
    if (!placesLib || !container) return;
    if (!placesLib.PlaceAutocompleteElement) {
      setError("החיפוש לא נטען. ודאו שה Places API פעיל במפתח של הדפדפן");
      return;
    }

    const element = new placesLib.PlaceAutocompleteElement({
      includedRegionCodes: ["il"],
      requestedLanguage: "he",
      requestedRegion: "IL",
    });
    element.id = "place-picker-input";
    element.style.width = "100%";
    container.replaceChildren(element);
    setReady(true);

    // Bias suggestions to wherever the reader is standing, which is almost
    // always the shop they are about to report. A refusal here is not worth
    // surfacing: the search still works country-wide.
    void currentPosition()
      .then((position) => {
        element.locationBias = { center: position, radius: 20000 };
      })
      .catch(() => undefined);

    async function handleSelect(event: google.maps.places.PlacePredictionSelectEvent) {
      setError(null);
      try {
        const { place } = await event.placePrediction.toPlace().fetchFields({
          fields: ["id", "displayName", "formattedAddress", "location", "types"],
        });
        if (!place.location) {
          setError("למקום הזה אין נקודת ציון בגוגל. נסו לבחור אותו מהרשימה שוב");
          return;
        }
        const address = place.formattedAddress ?? null;
        onPick({
          googlePlaceId: place.id,
          nameHe: place.displayName ?? "",
          lat: place.location.lat(),
          lng: place.location.lng(),
          addressHe: address,
          city: guessCity(address),
          category: guessCategory(place.types ?? undefined),
        });
      } catch {
        setError("לא הצלחנו לקרוא את פרטי המקום. נסו לבחור אותו שוב");
      }
    }

    function handleInput() {
      // Typing after a pick invalidates it: the form must not submit a
      // place_id that no longer matches what the box says.
      onClear();
    }

    // The element's typed addEventListener overload is not exposed on the
    // constructed instance, so the cast happens here, at the boundary. The
    // event type itself is checked: PlaceAutocompleteElementEventMap in
    // @types/google.maps maps "gmp-select" to PlacePredictionSelectEvent.
    const selectListener = handleSelect as unknown as EventListener;
    element.addEventListener("gmp-select", selectListener);
    element.addEventListener("input", handleInput);
    return () => {
      element.removeEventListener("gmp-select", selectListener);
      element.removeEventListener("input", handleInput);
      container.replaceChildren();
    };
  }, [placesLib, onPick, onClear]);

  return (
    <div>
      <label
        htmlFor="place-picker-input"
        className="mb-1 block font-bold"
        style={{ fontSize: "var(--text-base)" }}
      >
        איזה מקום?
      </label>
      <div ref={host} className="min-h-[48px]" />
      {!ready && !error && (
        <p className="mt-1 text-ink-faint" style={{ fontSize: "var(--text-xs)" }}>
          טוען את החיפוש
        </p>
      )}
      <p className="mt-1 text-ink-faint" style={{ fontSize: "var(--text-xs)" }}>
        התחילו להקליד ובחרו מהרשימה. הבחירה ממלאת את הכתובת והקטגוריה לבד.
      </p>
      {error && (
        <p role="alert" className="mt-1 text-warn" style={{ fontSize: "var(--text-sm)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
