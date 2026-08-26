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

/** Which colour runs down the edge of the row. Shape and colour again, so the
 *  benefit is readable while scrolling without spending a chip on it. */
function railOf(place: Place): "fighter" | "voucher" | "both" | "dead" {
  if (place.status === "reported_not_working") return "dead";
  if (place.benefit_fighter_card && place.benefit_vacation_voucher) return "both";
  if (place.benefit_vacation_voucher) return "voucher";
  return "fighter";
}

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
            className={`rail rail-${railOf(place)} ${selected ? "selected-panel" : ""}`}
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
              className="w-full cursor-pointer py-2.5 pe-3 ps-4 text-right"
            >
              {/* Destination on the right, distance in its own column on the
                  left, exactly as a road sign sets them. The column is a fixed
                  width with tabular figures so the numbers line up down the
                  list and the eye can scan them without reading each row. */}
              <div className="flex items-baseline gap-3">
                <h3
                  className={`min-w-0 flex-1 font-extrabold ${
                    place.status === "reported_not_working"
                      ? "text-ink-soft line-through decoration-1"
                      : ""
                  }`}
                  style={{ fontSize: "var(--text-lg)", lineHeight: 1.25 }}
                >
                  {place.name_he}
                </h3>
                {place.distance_m != null && (
                  <span className="distance-column">
                    {formatDistance(place.distance_m)}
                  </span>
                )}
              </div>

              <p
                className="text-ink-soft"
                style={{ fontSize: "var(--text-sm)" }}
              >
                {[CATEGORY_LABELS[place.category], place.city]
                  .filter(Boolean)
                  .join(" · ")}
              </p>

              {/* Chips and the age of the information share one line. They
                  were two, and on a phone that is a whole row of scrolling
                  spent on metadata. */}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <BenefitChips place={place} />
                <KindChip place={place} />
                <StatusBadges place={place} />
                {isUnverified(place) && place.status === "published" && (
                  <LastSignalLine place={place} />
                )}
              </div>

              {place.note_he && (
                <p
                  className="mt-1.5 text-ink-soft"
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
