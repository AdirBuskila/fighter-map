"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import FilterBar, { type Filters } from "./FilterBar";
import PlaceList from "./PlaceList";

// MapLibre touches window on import, so it must never run during SSR.
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-surface-sunk" />,
});
import { currentPosition, type LatLng } from "@/lib/geo";
import type { Category, EphemeralBranch, Place } from "@/lib/types";

type Props = { mapped: Place[]; unmapped: Place[] };

const NEAR_RADIUS_M = 25000;

export default function Explorer({ mapped, unmapped }: Props) {
  const [filters, setFilters] = useState<Filters>({
    benefit: null,
    categories: new Set<Category>(),
    nearMe: false,
  });
  const [nearby, setNearby] = useState<Place[] | null>(null);
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [nearBusy, setNearBusy] = useState(false);
  const [nearError, setNearError] = useState<string | null>(null);
  const [branches, setBranches] = useState<EphemeralBranch[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionFrom, setSelectionFrom] = useState<"map" | "list" | null>(null);

  const showBranches = useCallback(
    (_brand: Place, found: EphemeralBranch[]) => setBranches(found),
    [],
  );

  const select = useCallback((id: string, from: "map" | "list") => {
    setSelectedId((current) => (current === id && from === "list" ? null : id));
    setSelectionFrom(from);
  }, []);

  async function changeFilters(next: Filters) {
    const turningOn = next.nearMe && !filters.nearMe;
    setFilters(next);

    if (!next.nearMe) {
      setNearby(null);
      setOrigin(null);
      setNearError(null);
      return;
    }
    if (!turningOn) return;

    setNearBusy(true);
    setNearError(null);
    try {
      const position = await currentPosition();
      setOrigin(position);
      const params = new URLSearchParams({
        lat: String(position.lat),
        lng: String(position.lng),
        radius: String(NEAR_RADIUS_M),
      });
      const res = await fetch(`/api/places/near?${params}`);
      const body = (await res.json()) as { places?: Place[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "החיפוש נכשל");
      setNearby(body.places ?? []);
    } catch (cause) {
      setNearError(
        cause instanceof Error ? cause.message : "לא הצלחנו לחפש לפי מיקום",
      );
      setFilters({ ...next, nearMe: false });
    } finally {
      setNearBusy(false);
    }
  }

  const source = filters.nearMe && nearby ? nearby : mapped;

  const matches = useCallback(
    (place: Place) => {
      if (filters.benefit === "fighter_card" && !place.benefit_fighter_card) return false;
      if (filters.benefit === "vacation_voucher" && !place.benefit_vacation_voucher) return false;
      if (filters.categories.size > 0 && !filters.categories.has(place.category)) return false;
      return true;
    },
    [filters],
  );

  const visibleMapped = useMemo(() => source.filter(matches), [source, matches]);
  const visibleUnmapped = useMemo(
    () => (filters.nearMe ? [] : unmapped.filter(matches)),
    [unmapped, matches, filters.nearMe],
  );

  // Counts come from the benefit-filtered set, not the fully filtered one, so
  // a chip always shows how many it would reveal rather than dropping to zero
  // the moment another chip is picked.
  const counts = useMemo(() => {
    const pool = [...source, ...(filters.nearMe ? [] : unmapped)].filter((place) => {
      if (filters.benefit === "fighter_card") return place.benefit_fighter_card;
      if (filters.benefit === "vacation_voucher") return place.benefit_vacation_voucher;
      return true;
    });
    const out: Record<string, number> = {};
    for (const place of pool) out[place.category] = (out[place.category] ?? 0) + 1;
    return out;
  }, [source, unmapped, filters.benefit, filters.nearMe]);

  const total = visibleMapped.length + visibleUnmapped.length;

  const body = (
    <div className="flex flex-1 flex-col lg:flex-row-reverse">
      {/* The map pane must never be sized by its sibling. As a plain flex
          child it grew to the height of all 417 list rows, 60,000px, WebGL
          clamped the canvas to 4096 and exactly one tile ever loaded. It gets
          its own height at both breakpoints, and sticks on desktop so it stays
          in view while the list scrolls the page. */}
      <div className="h-[60vh] shrink-0 self-start lg:sticky lg:h-[calc(100dvh-var(--header-h))] lg:top-[var(--header-h)] lg:w-[58%] lg:flex-1">
        <MapView
          places={visibleMapped}
          branches={branches}
          origin={origin}
          selectedId={selectedId}
          selectionFrom={selectionFrom}
          onSelect={select}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:w-[42%] lg:max-w-[520px] lg:flex-none">
        <div className="sticky top-0 z-20 lg:top-[var(--header-h)]">
          <FilterBar
            filters={filters}
            counts={counts}
            total={total}
            nearMeBusy={nearBusy}
            nearMeError={nearError}
            onChange={(next) => void changeFilters(next)}
          />
        </div>

        <PlaceList
          places={visibleMapped}
          selectedId={selectedId}
          selectionFrom={selectionFrom}
          onSelect={select}
          onBranches={showBranches}
          emptyMessage={
            filters.nearMe
              ? "אין מקומות ברדיוס 25 קילומטר. כבו את קרוב אליי כדי לראות את כל הארץ."
              : "נסו לבטל חלק מהסינונים, או להוסיף מקום שאתם מכירים."
          }
        />

        {visibleUnmapped.length > 0 && (
          <>
            <h2
              className="hairline bg-surface-sunk px-3 py-2 font-bold text-ink-soft"
              style={{ fontSize: "var(--text-sm)" }}
            >
              רשתות ואתרים, בלי מיקום קבוע
            </h2>
            <PlaceList
              places={visibleUnmapped}
              selectedId={selectedId}
              selectionFrom={selectionFrom}
              onSelect={select}
              onBranches={showBranches}
              emptyMessage=""
            />
          </>
        )}
      </div>
    </div>
  );

  return body;
}
