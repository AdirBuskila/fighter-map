"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
// Imported here as well as in MapView, because /add never renders MapView and
// without the stylesheet .maplibregl-marker has no positioning: the pin lays
// out as a full-width block below the map instead of sitting on the point.
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * The parsed point, drawn.
 *
 * A wrong pin is the main way adding a place by link goes wrong, and it is
 * completely invisible as text: nobody reads "31.8005, 35.3105" and notices it
 * is the wrong side of town. So the form shows it rather than stating it.
 *
 * Non-interactive on purpose. Correcting a pin by hand is what the submission
 * design refuses, and a map that pans invites exactly that.
 */

/** The palette is defined in CSS and swaps with the colour scheme, so the
 *  marker reads it rather than hard-coding a hex that would be wrong in one
 *  theme and invisible against the other. */
function fighterColour(): string {
  if (typeof window === "undefined") return "#1b4fd8";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--fighter")
    .trim();
  return value || "#1b4fd8";
}

export default function MiniMap({
  lat,
  lng,
  label,
}: {
  lat: number;
  lng: number;
  label?: string;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const styleFor = (isDark: boolean) => `/map/${isDark ? "dark" : "light"}.json`;

    const instance = new maplibregl.Map({
      container: host.current,
      style: styleFor(dark.matches),
      center: [lng, lat],
      zoom: 15,
      interactive: false,
      attributionControl: false,
    });

    const marker = new maplibregl.Marker({ color: fighterColour() })
      .setLngLat([lng, lat])
      .addTo(instance);

    const onScheme = (event: MediaQueryListEvent) => {
      instance.setStyle(styleFor(event.matches));
    };
    dark.addEventListener("change", onScheme);

    return () => {
      dark.removeEventListener("change", onScheme);
      marker.remove();
      instance.remove();
    };
  }, [lat, lng]);

  return (
    <div
      ref={host}
      role="img"
      aria-label={label ? `מפה: ${label}` : "מפה עם המיקום שנבחר"}
      className="mt-2 h-40 w-full overflow-hidden border-2 border-line-strong"
      style={{ borderRadius: "var(--radius)" }}
    />
  );
}
