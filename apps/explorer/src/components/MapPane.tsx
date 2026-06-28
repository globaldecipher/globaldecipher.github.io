import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Pane from "./Pane";
import { useExplorer, selectedEntity } from "../lib/store";

type Layer = "aor" | "attacks" | "leadership";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export default function MapPane() {
  const ent = useExplorer(selectedEntity);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [layers, setLayers] = useState<Set<Layer>>(new Set(["aor", "attacks"]));

  // Init once
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [69.0, 32.5],
      zoom: 4.2,
      attributionControl: { compact: true },
      antialias: true
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    // Keep the canvas inside the pane — MapLibre captures its container size
    // once at init, so we have to feed it layout changes explicitly.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const features = useMemo(() => {
    if (!ent) return { aor: [], attacks: [], leadership: [] };
    return {
      aor: (ent.aor ?? []).filter((p) => p.lat && p.lng),
      attacks: (ent.attacks ?? []).filter((a) => a.lat && a.lng),
      leadership: ent.headquarters ? [ent.headquarters] : []
    };
  }, [ent]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ent) return;
    function paint(map: maplibregl.Map) {
      // Wipe previous overlay layers + sources we own.
      ["tgd-aor", "tgd-aor-heat", "tgd-attacks", "tgd-attacks-halo", "tgd-attacks-circle", "tgd-leadership", "tgd-leadership-ring", "tgd-leadership-symbol"].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      ["tgd-aor-src", "tgd-attacks-src", "tgd-leadership-src"].forEach((id) => {
        if (map.getSource(id)) map.removeSource(id);
      });

      if (layers.has("aor") && features.aor.length > 0) {
        map.addSource("tgd-aor-src", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: features.aor.map((p) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [p.lng!, p.lat!] },
              properties: { label: p.label ?? "", intensity: p.intensity ?? 0.5 }
            }))
          }
        });
        map.addLayer({
          id: "tgd-aor-heat",
          type: "heatmap",
          source: "tgd-aor-src",
          paint: {
            "heatmap-weight": ["coalesce", ["get", "intensity"], 0.5],
            "heatmap-radius": 38,
            "heatmap-intensity": 1,
            "heatmap-opacity": 0.7,
            "heatmap-color": [
              "interpolate", ["linear"], ["heatmap-density"],
              0, "rgba(185,28,44,0)",
              0.2, "rgba(185,28,44,0.18)",
              0.5, "rgba(186,117,23,0.5)",
              0.8, "rgba(163,45,45,0.8)",
              1, "rgba(163,45,45,0.95)"
            ]
          }
        });
      }

      if (layers.has("attacks") && features.attacks.length > 0) {
        map.addSource("tgd-attacks-src", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: features.attacks.map((a) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [a.lng!, a.lat!] },
              properties: {
                label: a.location ?? "",
                casualties: a.casualties ?? 0,
                date: a.date,
                summary: a.summary ?? "",
                attackType: a.type ?? ""
              }
            }))
          }
        });
        // Outer halo for visibility on light tiles
        map.addLayer({
          id: "tgd-attacks-halo",
          type: "circle",
          source: "tgd-attacks-src",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "casualties"], 0, 9, 200, 26],
            "circle-color": "#A32D2D",
            "circle-opacity": 0.15
          }
        });
        map.addLayer({
          id: "tgd-attacks-circle",
          type: "circle",
          source: "tgd-attacks-src",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "casualties"], 0, 4, 200, 14],
            "circle-color": "#A32D2D",
            "circle-opacity": 0.92,
            "circle-stroke-color": "#FFFFFF",
            "circle-stroke-width": 1.2
          }
        });
        // Click popup
        map.on("click", "tgd-attacks-circle", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties || {};
          const [lng, lat] = (f.geometry as any).coordinates;
          const html = `
            <div style="font-family: 'IBM Plex Sans', sans-serif; font-size: 12px; line-height: 1.45; max-width: 220px;">
              <div style="font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6B6B6B;">${p.date}</div>
              <div style="font-family: 'Source Serif 4', Georgia, serif; font-weight: 500; font-size: 14px; margin: 2px 0 4px;">${p.label}</div>
              <div style="color: #A32D2D; font-weight: 600;">${p.casualties || 0} killed</div>
              ${p.attackType ? `<div style="color: #6B6B6B; font-size: 11px; margin-top: 2px;">${p.attackType}</div>` : ""}
              ${p.summary ? `<div style="margin-top: 6px;">${p.summary}</div>` : ""}
            </div>`;
          new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "260px" })
            .setLngLat([lng, lat])
            .setHTML(html)
            .addTo(map);
        });
        map.on("mouseenter", "tgd-attacks-circle", () => map.getCanvas().style.cursor = "pointer");
        map.on("mouseleave", "tgd-attacks-circle", () => map.getCanvas().style.cursor = "");
      }

      if (layers.has("leadership") && features.leadership.length > 0) {
        map.addSource("tgd-leadership-src", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: features.leadership.map((p) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [p.lng, p.lat] },
              properties: { label: p.label ?? "Headquarters" }
            }))
          }
        });
        map.addLayer({
          id: "tgd-leadership-ring",
          type: "circle",
          source: "tgd-leadership-src",
          paint: {
            "circle-radius": 16,
            "circle-color": "#b91c2c",
            "circle-opacity": 0.18
          }
        });
        map.addLayer({
          id: "tgd-leadership",
          type: "circle",
          source: "tgd-leadership-src",
          paint: {
            "circle-radius": 7,
            "circle-color": "#b91c2c",
            "circle-stroke-color": "#FFFFFF",
            "circle-stroke-width": 2
          }
        });
        map.on("click", "tgd-leadership", (e) => {
          const f = e.features?.[0]; if (!f) return;
          const [lng, lat] = (f.geometry as any).coordinates;
          new maplibregl.Popup({ closeButton: true, maxWidth: "240px" })
            .setLngLat([lng, lat])
            .setHTML(`<div style="font-family:'IBM Plex Sans',sans-serif;font-size:12px;"><div style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#6B6B6B;">Primary base</div><div style="font-family:'Source Serif 4',Georgia,serif;font-weight:500;font-size:14px;margin-top:2px;">${f.properties?.label ?? "Headquarters"}</div></div>`)
            .addTo(map);
        });
      }

      // Auto-fit
      const coords: [number, number][] = [];
      features.aor.forEach((p) => coords.push([p.lng!, p.lat!]));
      features.attacks.forEach((p) => coords.push([p.lng!, p.lat!]));
      features.leadership.forEach((p) => coords.push([p.lng, p.lat]));
      if (coords.length > 1) {
        const bounds = coords.reduce(
          (b, c) => b.extend(c),
          new maplibregl.LngLatBounds(coords[0], coords[0])
        );
        map.fitBounds(bounds, { padding: 50, duration: 700, maxZoom: 6.5 });
      } else if (coords.length === 1) {
        map.flyTo({ center: coords[0], zoom: 6, duration: 700 });
      }
    }
    if (map.isStyleLoaded()) paint(map);
    else map.once("load", () => paint(map));
  }, [ent, features, layers]);

  const toggleLayer = (l: Layer) =>
    setLayers((s) => {
      const next = new Set(s);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });

  return (
    <Pane
      label="Area of Operations"
      toolbar={
        <div className="flex gap-1">
          {(["aor", "attacks", "leadership"] as Layer[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => toggleLayer(l)}
              className={
                "text-[10px] uppercase tracking-eyebrow px-2 h-6 border-hair " +
                (layers.has(l)
                  ? "bg-accent border-accent text-white"
                  : "border-line-light dark:border-line-dark text-muted-light dark:text-muted-dark hover:border-accent hover:text-accent")
              }
            >
              {l === "aor" ? "AOR" : l[0].toUpperCase() + l.slice(1)}
            </button>
          ))}
        </div>
      }
    >
      <div ref={containerRef} className="h-full w-full" />
    </Pane>
  );
}
