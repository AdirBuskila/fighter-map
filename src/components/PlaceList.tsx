"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { BenefitChips, KindChip, LastSignalLine, StatusBadges } from "./Badges";
import ChainBranches from "./ChainBranches";
import VerdictButtons from "./VerdictButtons";
import { formatDistance, isUnverified } from "@/lib/format";
import { CATEGORY_LABELS, type EphemeralBranch, type Place } from "@/lib/types";

type Props = {
  places: Place[];
  selectedId: string | null;
  selectionFrom: "map" | "list" | null;
  onSelect: (id: string, from: "map" | "list") => void;
  onBranches?: (brand: Place, branches: EphemeralBranch[]) => void;
  emptyMessage: string;
};

export default function PlaceList({
  places,
  selectedId,
  selectionFrom,
  onSelect,
  onBranches,
  emptyMessage,
}: Props) {
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  // A tap on the map scrolls this list to the matching card. A tap in the list
  // must not scroll itself, or the row jumps out from under the finger.
  useEffect(() => {
    if (!selectedId || selectionFrom !== "map") return;
    rowRefs.current
      .get(selectedId)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId, selectionFrom]);

  if (places.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="font-bold" style={{ fontSize: "var(--text-lg)" }}>
          אין מקומות שמתאימים לסינון
        </p>
        <p className="mt-2 text-ink-soft" style={{ fontSize: "var(--text-sm)" }}>
          {emptyMessage}
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {places.map((place) => {
        const selected = place.id === selectedId;
        return (
          <li
            key={place.id}
            ref={(node) => {
              if (node) rowRefs.current.set(place.id, node);
              else rowRefs.current.delete(place.id);
            }}
            className={selected ? "bg-fighter-tint" : undefined}
          >
            <div
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              onClick={() => onSelect(place.id, "list")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(place.id, "list");
                }
              }}
              className="w-full cursor-pointer px-3 pb-3 pt-3 text-right"
            >
              <div className="flex items-baseline gap-2">
                <h3
                  className={`font-extrabold ${
                    place.status === "reported_not_working"
                      ? "text-ink-soft line-through decoration-1"
                      : ""
                  }`}
                  style={{ fontSize: "var(--text-lg)", lineHeight: 1.25 }}
                >
                  {place.name_he}
                </h3>
                {place.distance_m != null && (
                  <span
                    className="mr-auto shrink-0 tabular-nums text-ink-soft"
                    style={{ fontSize: "var(--text-xs)" }}
                  >
                    {formatDistance(place.distance_m)}
                  </span>
                )}
              </div>

              <p
                className="mt-0.5 text-ink-soft"
                style={{ fontSize: "var(--text-sm)" }}
              >
                {[CATEGORY_LABELS[place.category], place.city]
                  .filter(Boolean)
                  .join(" · ")}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <BenefitChips place={place} />
                <KindChip place={place} />
                <StatusBadges place={place} />
              </div>

              {/* Rows without a badge are the ones nobody has confirmed here
                  yet, which is most of the imported set. Say how old the
                  information is instead of leaving the row silent. */}
              {isUnverified(place) && place.status === "published" && (
                <p className="mt-1">
                  <LastSignalLine place={place} />
                </p>
              )}

              {place.note_he && (
                <p
                  className="mt-2 text-ink-soft"
                  style={{ fontSize: "var(--text-sm)" }}
                >
                  {place.note_he}
                </p>
              )}

            </div>

            {selected && (
              <div className="px-3 pb-3">
                {/* Both actions the dataset depends on live here, one tap from
                    the map. Burying "it stopped working" behind a detail page
                    is how a map slowly fills with places that closed. */}
                <VerdictButtons place={place} compact />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link
                    href={`/place/${place.id}`}
                    className="btn px-3"
                    style={{ fontSize: "var(--text-sm)" }}
                  >
                    ניווט ופרטים
                  </Link>
                  {place.is_chain && (
                    <ChainBranches place={place} onBranches={onBranches} />
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
