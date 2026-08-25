"use client";

import { MarkerClusterer, type Marker } from "@googlemaps/markerclusterer";
import {
  AdvancedMarker,
  Map,
  useMap,
} from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useRef, useState } from "react";
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

export default function MapView(props: Props) {
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";
  return (
    <Map
      mapId={mapId}
      defaultCenter={ISRAEL_CENTER}
      defaultZoom={ISRAEL_DEFAULT_ZOOM}
      gestureHandling="greedy"
      disableDefaultUI
      zoomControl
      clickableIcons={false}
      className="h-full w-full"
    >
      <Pins {...props} />
    </Map>
  );
}

function Pins({
  places,
  branches,
  origin,
  selectedId,
  selectionFrom,
  onSelect,
}: Props) {
  const map = useMap();
  const [markers, setMarkers] = useState<Record<string, Marker>>({});
  const previousSelection = useRef<string | null>(null);

  const clusterer = useMemo(() => {
    if (!map) return null;
    return new MarkerClusterer({ map, renderer: clusterRenderer() });
  }, [map]);

  useEffect(() => {
    if (!clusterer) return;
    clusterer.clearMarkers();
    clusterer.addMarkers(Object.values(markers));
  }, [clusterer, markers]);

  useEffect(() => () => clusterer?.clearMarkers(), [clusterer]);

  // A tap in the list pans the map. A tap on the map must not pan it again, or
  // the pin slides out from under the finger that just hit it.
  useEffect(() => {
    if (!map || !selectedId || selectionFrom !== "list") return;
    if (previousSelection.current === selectedId) return;
    previousSelection.current = selectedId;
    const place = places.find((candidate) => candidate.id === selectedId);
    if (place?.lat != null && place.lng != null) {
      map.panTo({ lat: place.lat, lng: place.lng });
      if ((map.getZoom() ?? 0) < 13) map.setZoom(13);
    }
  }, [map, places, selectedId, selectionFrom]);

  function setMarkerRef(marker: Marker | null, key: string) {
    setMarkers((current) => {
      if ((marker && current[key]) || (!marker && !current[key])) return current;
      const next = { ...current };
      if (marker) next[key] = marker;
      else delete next[key];
      return next;
    });
  }

  return (
    <>
      {origin && (
        <AdvancedMarker position={origin} title="המיקום שלכם" zIndex={1}>
          <span className="block h-3.5 w-3.5 rounded-full border-2 border-white bg-ink shadow-[0_0_0_3px_rgba(27,79,216,0.35)]" />
        </AdvancedMarker>
      )}

      {places.map((place) =>
        place.lat == null || place.lng == null ? null : (
          <AdvancedMarker
            key={place.id}
            position={{ lat: place.lat, lng: place.lng }}
            title={place.name_he}
            zIndex={place.id === selectedId ? 30 : 10}
            ref={(marker) => setMarkerRef(marker, place.id)}
            onClick={() => onSelect(place.id, "map")}
          >
            <PlaceDot place={place} selected={place.id === selectedId} />
          </AdvancedMarker>
        ),
      )}

      {branches.map((branch) => (
        <AdvancedMarker
          key={branch.key}
          position={{ lat: branch.lat, lng: branch.lng }}
          title={branch.name}
          zIndex={20}
        >
          <span
            className="block rounded-full border-2 border-dashed"
            style={{
              width: 16,
              height: 16,
              borderColor: "var(--fighter)",
              background: "var(--surface)",
            }}
          />
        </AdvancedMarker>
      ))}
    </>
  );
}

/**
 * Shape, not just colour: circle for the fighter card, diamond for the
 * vacation voucher, a ringed circle when a place takes both. The transparent
 * padding around the dot is the tap target, which is why it is far larger than
 * the ink.
 */
function PlaceDot({ place, selected }: { place: Place; selected: boolean }) {
  const dead = place.status === "reported_not_working";
  const both = place.benefit_fighter_card && place.benefit_vacation_voucher;
  const voucherOnly = place.benefit_vacation_voucher && !place.benefit_fighter_card;

  const fill = dead
    ? "var(--ink-faint)"
    : voucherOnly
      ? "var(--voucher)"
      : "var(--fighter)";
  const size = selected ? 20 : 13;

  return (
    <span
      style={{
        display: "flex",
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span
        style={{
          width: size,
          height: size,
          background: fill,
          border: `2px solid ${selected ? "var(--ink)" : "#ffffff"}`,
          borderRadius: voucherOnly ? 2 : "50%",
          transform: voucherOnly ? "rotate(45deg)" : undefined,
          boxShadow: both ? `0 0 0 3px var(--voucher)` : "0 1px 2px rgba(0,0,0,0.4)",
          opacity: dead ? 0.65 : 1,
        }}
      />
    </span>
  );
}

/** Clusters read as counts, in the fighter blue, never as a heat blob. */
function clusterRenderer() {
  return {
    render({ count, position }: { count: number; position: google.maps.LatLng }) {
      const div = document.createElement("div");
      div.style.cssText = [
        "display:flex",
        "align-items:center",
        "justify-content:center",
        `width:${count < 10 ? 34 : count < 100 ? 40 : 46}px`,
        `height:${count < 10 ? 34 : count < 100 ? 40 : 46}px`,
        "border-radius:50%",
        "background:var(--fighter)",
        "color:var(--on-fighter)",
        "border:2px solid #ffffff",
        "font-weight:800",
        "font-size:13px",
        "font-variant-numeric:tabular-nums",
      ].join(";");
      div.textContent = String(count);
      return new google.maps.marker.AdvancedMarkerElement({
        position,
        content: div,
        zIndex: 5,
      });
    },
  };
}
