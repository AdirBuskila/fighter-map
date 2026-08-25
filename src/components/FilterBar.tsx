"use client";

import { CATEGORY_LABELS, CATEGORY_ORDER, type BenefitType, type Category } from "@/lib/types";

export type Filters = {
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
      <div className="flex items-center gap-2 px-3 py-2">
        <div
          role="radiogroup"
          aria-label="סוג הטבה"
          className="flex overflow-hidden rounded-[--radius] border-2 border-line-strong"
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

        <button
          type="button"
          aria-pressed={filters.nearMe}
          onClick={() => onChange({ ...filters, nearMe: !filters.nearMe })}
          disabled={nearMeBusy}
          className={`btn shrink-0 px-3 ${
            filters.nearMe ? "border-fighter bg-fighter-tint text-fighter" : ""
          }`}
          style={{ fontSize: "var(--text-sm)" }}
        >
          {nearMeBusy ? "מאתר" : "קרוב אליי"}
        </button>

        <span
          className="mr-auto shrink-0 tabular-nums text-ink-soft"
          style={{ fontSize: "var(--text-xs)" }}
        >
          {total} מקומות
        </span>
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

      <div className="flex gap-1.5 overflow-x-auto px-3 pb-2">
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
    </div>
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
      className={`flex items-center gap-1.5 px-3 font-semibold ${
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
