"use client";

import {
  AttributionControl,
  setRTLTextPlugin,
  Map as MlMap,
  Marker,
  NavigationControl,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { isSingleSource } from "@/lib/format";
import type { LatLng } from "@/lib/geo";
import {
  ISRAEL_CENTER,
  ISRAEL_DEFAULT_ZOOM,
  type EphemeralBranch,
  type Place,
} from "@/lib/types";

type Props = {
  places: Place[];
  branches: EphemeralBranch[];
  origin: LatLng | null;
  selectedId: string | null;
  selectionFrom: "map" | "list" | null;
  onSelect: (id: string, from: "map" | "list") => void;
};

/**
 * MapLibre does not reorder bidirectional text on its own, so without this
 * every Hebrew label on the map renders backwards: נצרת came out as תרצנ and
 * רמלה as הלמר. The plugin is self-hosted rather than pulled from a CDN, so
 * the map has no third-party runtime dependency beyond its tiles.
 *
 * Loaded lazily (false), so it never blocks first paint, and guarded because
 * calling it twice throws.
 */
let rtlRequested = false;
function ensureRtlText(): void {
  if (rtlRequested) return;
  rtlRequested = true;
  try {
    setRTLTextPlugin("/rtl-text.js", true);
  } catch (cause) {
    console.error("[maplibre] RTL text plugin failed", cause);
  }
}

const SRC = "places";
const SRC_BRANCH = "branches";

/**
 * OpenFreeMap vector tiles, MapLibre renderer, styles in public/map.
 *
 * No key, no billing account, no per-load charge. The styles are ours rather
 * than theirs: coastline, roads and town names only, so the sole colour on the
 * map is our own dots. A default basemap arrives full of pink hospitals and
 * yellow shops that our data then has to compete with.
 */
export default function MapView({
  places,
  branches,
  origin,
  selectedId,
  selectionFrom,
  onSelect,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const originMarker = useRef<Marker | null>(null);
  const lastPanned = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // --- create once -------------------------------------------------------
  useEffect(() => {
    if (!host.current || map.current) return;

    ensureRtlText();

    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const styleFor = (isDark: boolean) => `/map/${isDark ? "dark" : "light"}.json`;

    const instance = new MlMap({
      container: host.current,
      style: styleFor(dark.matches),
      center: [ISRAEL_CENTER.lng, ISRAEL_CENTER.lat],
      zoom: ISRAEL_DEFAULT_ZOOM,
      attributionControl: false,
      // No maxBounds. Israel is about 4 degrees wide, which is narrower than
      // the viewport covers at the country-wide zoom, so the constraint could
      // never be satisfied and the camera never settled: MapLibre resolved the
      // tile source and then requested not one tile. minZoom keeps the reader
      // from drifting off to the Atlantic instead.
      minZoom: 6.5,
    });
    map.current = instance;

    instance.addControl(new NavigationControl({ showCompass: false }), "top-left");
    instance.addControl(new AttributionControl({ compact: true }), "bottom-left");

    // Development only: lets tools/probe_map.js interrogate the live map.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __map?: MlMap }).__map = instance;
    }

    instance.on("error", (event) => {
      console.error("[maplibre]", (event as unknown as { error?: Error }).error?.message ?? event);
    });

    instance.on("load", () => {
      installLayers(instance);
      ready.current = true;
      paint(instance, places, branches);
    });

    // Re-adding the layers is required after a style swap: setStyle throws away
    // every source and layer that was not part of the new style document.
    const onScheme = (event: MediaQueryListEvent) => {
      instance.setStyle(styleFor(event.matches));
      instance.once("styledata", () => {
        installLayers(instance);
        paint(instance, places, branches);
      });
    };
    dark.addEventListener("change", onScheme);

    instance.on("click", "clusters", (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      if (clusterId == null) return;
      const source = instance.getSource(SRC) as GeoJSONSource;
      void source.getClusterExpansionZoom(clusterId).then((zoom) => {
        instance.easeTo({
          center: (feature!.geometry as GeoJSON.Point).coordinates as [number, number],
          zoom,
        });
      });
    });

    instance.on("click", "pins", (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === "string") onSelectRef.current(id, "map");
    });

    for (const layer of ["clusters", "pins", "branch-pins"]) {
      instance.on("mouseenter", layer, () => {
        instance.getCanvas().style.cursor = "pointer";
      });
      instance.on("mouseleave", layer, () => {
        instance.getCanvas().style.cursor = "";
      });
    }

    return () => {
      dark.removeEventListener("change", onScheme);
      instance.remove();
      map.current = null;
      ready.current = false;
    };
    // Created once on purpose; data changes are pushed through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- push data ---------------------------------------------------------
  useEffect(() => {
    if (map.current && ready.current) paint(map.current, places, branches);
  }, [places, branches]);

  // --- selection ---------------------------------------------------------
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready.current) return;
    instance.setFilter("pin-selected", ["==", ["get", "id"], selectedId ?? ""]);

    // A tap in the list pans the map. A tap on the map must not pan it again,
    // or the pin slides out from under the finger that just hit it.
    if (!selectedId || selectionFrom !== "list") return;
    if (lastPanned.current === selectedId) return;
    lastPanned.current = selectedId;
    const place = places.find((p) => p.id === selectedId);
    if (place?.lat != null && place.lng != null) {
      instance.easeTo({
        center: [place.lng, place.lat],
        zoom: Math.max(instance.getZoom(), 13),
        duration: prefersReducedMotion() ? 0 : 600,
      });
    }
  }, [selectedId, selectionFrom, places]);

  // --- the reader's own position ----------------------------------------
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    originMarker.current?.remove();
    originMarker.current = null;
    if (!origin) return;

    // Fly there. Without this the list quietly changes and the map still shows
    // the whole country, which answers none of "what is near me".
    instance.easeTo({
      center: [origin.lng, origin.lat],
      zoom: Math.max(instance.getZoom(), 11),
      duration: prefersReducedMotion() ? 0 : 900,
    });

    const dot = document.createElement("span");
    dot.className = "origin-dot";
    dot.title = "המיקום שלכם";
    originMarker.current = new Marker({ element: dot })
      .setLngLat([origin.lng, origin.lat])
      .addTo(instance);
  }, [origin]);

  return <div ref={host} className="h-full w-full" />;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** CSS custom properties are not available to the WebGL canvas, so read them. */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

type IconKind = "fighter" | "voucher" | "both" | "dead";

/**
 * Shape, not just colour: circle for the fighter card, diamond for the
 * vacation voucher, a ringed circle for a place that takes both. Someone with
 * no colour vision at all still reads the map correctly.
 *
 * Fill carries a third fact. A solid mark is a place at least two independent
 * people have vouched for; a hollow one is somebody's single report, published
 * the moment they sent it. Hollow rather than a new colour on purpose: the two
 * benefit colours are the map's whole vocabulary and were chosen together to
 * survive red-green colour blindness, so a third would have to fight both.
 * Filled against outlined survives any vision at all, and it reads as what it
 * means, an entry not yet filled in.
 */
function drawIcon(kind: IconKind, selected: boolean, single: boolean): ImageData {
  const size = 44;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const mid = size / 2;
  const r = selected ? 11 : 7;

  const ink =
    kind === "dead" ? token("--ink-faint", "#6d737b")
    : kind === "voucher" ? token("--voucher", "#a66100")
    : token("--fighter", "#1b4fd8");
  const paper = token("--surface", "#ffffff");

  const shape = () => {
    ctx.beginPath();
    if (kind === "voucher") {
      ctx.moveTo(mid, mid - r);
      ctx.lineTo(mid + r, mid);
      ctx.lineTo(mid, mid + r);
      ctx.lineTo(mid - r, mid);
      ctx.closePath();
    } else {
      ctx.arc(mid, mid, r, 0, Math.PI * 2);
    }
  };

  // A halo under everything, so a hollow mark still separates from a road or a
  // coastline. A solid mark gets this from its own outline; a hollow one has
  // no fill to hide behind.
  if (single) {
    ctx.beginPath();
    ctx.arc(mid, mid, r + (kind === "both" ? 5.5 : 2.5), 0, Math.PI * 2);
    ctx.fillStyle = paper;
    ctx.fill();
  }

  if (kind === "both") {
    ctx.beginPath();
    ctx.arc(mid, mid, r + 3.5, 0, Math.PI * 2);
    if (single) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = token("--voucher", "#a66100");
      ctx.stroke();
    } else {
      ctx.fillStyle = token("--voucher", "#a66100");
      ctx.fill();
    }
  }

  shape();
  ctx.fillStyle = single ? paper : ink;
  ctx.fill();
  ctx.lineWidth = single ? 3 : 2.5;
  ctx.strokeStyle = single ? ink : selected ? token("--ink", "#0e1116") : "#ffffff";
  ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
}

function installLayers(map: MlMap): void {
  for (const kind of ["fighter", "voucher", "both", "dead"] as const) {
    // A place reported not working is grey whoever reported it, so it needs no
    // hollow twin: "this stopped working" is already the whole story.
    for (const single of kind === "dead" ? [false] : [false, true]) {
      for (const selected of [false, true]) {
        const base = single ? `${kind}-new` : kind;
        const name = selected ? `${base}-on` : base;
        if (map.hasImage(name)) map.removeImage(name);
        map.addImage(name, drawIcon(kind, selected, single), { pixelRatio: 2 });
      }
    }
  }

  if (!map.getSource(SRC)) {
    map.addSource(SRC, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterRadius: 46,
      clusterMaxZoom: 13,
    });
  }
  if (!map.getSource(SRC_BRANCH)) {
    map.addSource(SRC_BRANCH, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  const fighter = token("--fighter", "#1b4fd8");
  const onFighter = token("--on-fighter", "#ffffff");

  if (!map.getLayer("clusters")) {
    map.addLayer({
      id: "clusters",
      type: "circle",
      source: SRC,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": fighter,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 100, 24],
      },
    });
    map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: SRC,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 13,
      },
      paint: { "text-color": onFighter },
    });
    map.addLayer({
      id: "pins",
      type: "symbol",
      source: SRC,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": ["get", "icon"],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    map.addLayer({
      id: "pin-selected",
      type: "symbol",
      source: SRC,
      filter: ["==", ["get", "id"], ""],
      layout: {
        "icon-image": ["concat", ["get", "icon"], "-on"],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    map.addLayer({
      id: "branch-pins",
      type: "circle",
      source: SRC_BRANCH,
      paint: {
        "circle-radius": 7,
        "circle-color": token("--surface", "#ffffff"),
        "circle-stroke-color": fighter,
        "circle-stroke-width": 2,
      },
    });
  }
}

function iconFor(place: Place): string {
  if (place.status === "reported_not_working") return "dead";
  const kind =
    place.benefit_fighter_card && place.benefit_vacation_voucher ? "both"
    : place.benefit_vacation_voucher ? "voucher"
    : "fighter";
  // The selected layer builds its own name with concat(icon, "-on"), so the
  // suffix goes here and both variants stay in step by construction.
  return isSingleSource(place) ? `${kind}-new` : kind;
}

function paint(map: MlMap, places: Place[], branches: EphemeralBranch[]): void {
  const source = map.getSource(SRC) as GeoJSONSource | undefined;
  source?.setData({
    type: "FeatureCollection",
    features: places
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng!, p.lat!] },
        properties: { id: p.id, icon: iconFor(p), name: p.name_he },
      })),
  });

  const branchSource = map.getSource(SRC_BRANCH) as GeoJSONSource | undefined;
  branchSource?.setData({
    type: "FeatureCollection",
    features: branches.map((b) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [b.lng, b.lat] },
      properties: { name: b.name },
    })),
  });
}
