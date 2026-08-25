"use client";

import { useState } from "react";
import { currentPosition } from "@/lib/geo";
import type { EphemeralBranch, Place } from "@/lib/types";

type Props = {
  place: Place;
  onBranches?: (brand: Place, branches: EphemeralBranch[]) => void;
};

/**
 * A national chain is stored once, as a brand with no coordinates. Pinning
 * every branch would mean maintaining a store list this project has no way to
 * keep accurate, so branches are resolved live from the reader's position and
 * thrown away when they navigate. Nothing found here is ever written back.
 */
export default function ChainBranches({ place, onBranches }: Props) {
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function findNearby() {
    setBusy(true);
    setError(null);
    try {
      const centre = await currentPosition();
      const params = new URLSearchParams({
        q: place.name_en ?? place.name_he,
        limit: "12",
        lat: String(centre.lat),
        lng: String(centre.lng),
      });
      const response = await fetch(`/api/search?${params}`);
      const body = (await response.json()) as {
        results?: Array<{
          providerRef: string;
          name: string;
          address: string | null;
          lat: number;
          lng: number;
        }>;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "החיפוש נכשל");

      const branches: EphemeralBranch[] = (body.results ?? []).map((result) => ({
        key: `${place.id}:${result.providerRef}`,
        name: result.name,
        address: result.address,
        lat: result.lat,
        lng: result.lng,
        brandId: place.id,
      }));

      setCount(branches.length);
      onBranches?.(place, branches);
      if (branches.length === 0) {
        setError("לא מצאנו סניפים קרובים אליכם");
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "החיפוש נכשל. נסו שוב בעוד רגע",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn px-3"
        style={{ fontSize: "var(--text-sm)" }}
        onClick={(event) => {
          event.stopPropagation();
          void findNearby();
        }}
        disabled={busy}
      >
        {busy ? "מחפש סניפים" : "סניפים קרובים אליי"}
      </button>
      {count != null && count > 0 && (
        <span className="text-ink-soft" style={{ fontSize: "var(--text-xs)" }}>
          {count} סניפים סומנו על המפה
        </span>
      )}
      {error && (
        <span
          role="alert"
          className="text-warn"
          style={{ fontSize: "var(--text-xs)" }}
        >
          {error}
        </span>
      )}
    </span>
  );
}
