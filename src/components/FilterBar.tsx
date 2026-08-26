"use client";

import { CATEGORY_LABELS, CATEGORY_ORDER, type BenefitType, type Category } from "@/lib/types";

export type Filters = {
  query: string;
  benefit: BenefitType | null;
  categories: Set<Category>;
  nearMe: boolean;
};

type Props = {
  filters: Filters;
  counts: Record<string, number>;
  total: number;
  nearMeBusy: boolean;
  nearMeError: string | null;
  onChange: (next: Filters) => void;
};

export default function FilterBar({
  filters,
  counts,
  total,
  nearMeBusy,
  nearMeError,
  onChange,
}: Props) {
  function setBenefit(benefit: BenefitType | null) {
    onChange({ ...filters, benefit });
  }

  function toggleCategory(category: Category) {
    const next = new Set(filters.categories);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    onChange({ ...filters, categories: next });
  }

  const active = CATEGORY_ORDER.filter((category) => (counts[category] ?? 0) > 0);

  return (
    <div className="hairline bg-surface">
      {/* Search comes first, above the filters.
          Somebody arriving with a place in mind should not have to work out
          which category it belongs to first, and the one person who tried the
          app before launch went looking for a search box and found only the
          one on /add, which searches the world rather than this map. */}
      <div className="px-3 pt-2">
        <div className="search-field">
          <SearchMark />
          <label htmlFor="place-search" className="sr-only">
            חיפוש מקום, עיר או כתובת
          </label>
          <input
            id="place-search"
            type="search"
            autoComplete="off"
            value={filters.query}
            onChange={(event) => onChange({ ...filters, query: event.target.value })}
            placeholder="חיפוש לפי שם, עיר או כתובת"
            style={{ fontSize: "var(--text-base)" }}
          />
          {filters.query !== "" && (
            <button
              type="button"
              onClick={() => onChange({ ...filters, query: "" })}
              aria-label="ניקוי החיפוש"
              className="tap shrink-0 px-1 text-ink-faint"
            >
              {/* A multiplication sign, not an x: it is symmetric, so it does
                  not lean the wrong way in a right to left line. */}
              ×
            </button>
          )}
        </div>
      </div>

      <div className="flex items-stretch gap-2 px-3 pt-2">
        <div
          role="radiogroup"
          aria-label="סוג הטבה"
          className="flex flex-1 overflow-hidden border-2 border-line-strong"
          style={{ borderRadius: "var(--radius)" }}
        >
          <SegmentButton
            selected={filters.benefit === null}
            onClick={() => setBenefit(null)}
            label="הכל"
          />
          <SegmentButton
            selected={filters.benefit === "fighter_card"}
            onClick={() => setBenefit("fighter_card")}
            label="פייטר"
            mark="fighter"
          />
          <SegmentButton
            selected={filters.benefit === "vacation_voucher"}
            onClick={() => setBenefit("vacation_voucher")}
            label="שובר חופשה"
            mark="voucher"
          />
        </div>

        <span
          className="flex shrink-0 items-center tabular-nums text-ink-soft"
          style={{ fontSize: "var(--text-xs)" }}
        >
          {total} מקומות
        </span>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2">
        <button
          type="button"
          aria-pressed={filters.nearMe}
          onClick={() => onChange({ ...filters, nearMe: !filters.nearMe })}
          disabled={nearMeBusy}
          className={`chip tap shrink-0 gap-1.5 px-3 font-bold ${
            filters.nearMe
              ? "border-fighter bg-fighter text-on-fighter"
              : "border-line-strong"
          }`}
        >
          <LocationMark on={filters.nearMe} />
          {nearMeBusy ? "מאתר" : "קרוב אליי"}
        </button>

        <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden="true" />

        {active.map((category) => {
          const selected = filters.categories.has(category);
          return (
            <button
              key={category}
              type="button"
              aria-pressed={selected}
              onClick={() => toggleCategory(category)}
              className={`chip tap shrink-0 px-2.5 ${
                selected
                  ? "border-fighter bg-fighter-tint text-fighter"
                  : "text-ink-soft"
              }`}
            >
              {CATEGORY_LABELS[category]}
              <span className="tabular-nums opacity-70">{counts[category]}</span>
            </button>
          );
        })}
      </div>

      {nearMeError && (
        <p
          role="alert"
          className="px-3 pb-2 text-warn"
          style={{ fontSize: "var(--text-xs)" }}
        >
          {nearMeError}
        </p>
      )}

    </div>
  );
}

/** A magnifier, so the field reads as search before the placeholder is read. */
function SearchMark() {
  return (
    <svg
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      className="shrink-0 text-ink-faint"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.4 10.4 L14 14" />
    </svg>
  );
}

/** A small crosshair, so the control reads as "locate" before it is read. */
function LocationMark({ on }: { on: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={on ? 2.2 : 1.8}
    >
      <circle cx="8" cy="8" r="3" />
      <path d="M8 0.5v3M8 12.5v3M0.5 8h3M12.5 8h3" strokeLinecap="round" />
    </svg>
  );
}

function SegmentButton({
  selected,
  onClick,
  label,
  mark,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  mark?: "fighter" | "voucher";
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-2 font-semibold ${
        selected ? "bg-fighter text-on-fighter" : "bg-surface text-ink-soft"
      }`}
      style={{ fontSize: "var(--text-sm)" }}
    >
      {mark && (
        <span
          aria-hidden="true"
          className={`mark mark-${mark}`}
          style={selected ? { background: "currentColor" } : undefined}
        />
      )}
      {label}
    </button>
  );
}
