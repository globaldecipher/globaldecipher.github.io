import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import Pane from "./Pane";
import { useExplorer, selectedEntity } from "../lib/store";
import type { Entity, TimelineEvent } from "../types";

const EVENT_COLOR: Record<TimelineEvent["type"], string> = {
  "founded":             "#185FA5",
  "dissolved":           "#888780",
  "leadership-change":   "#534AB7",
  "split":               "#BA7517",
  "merger":              "#3B6D11",
  "attack":              "#A32D2D",
  "designation":         "#16181D"
};

function collectEvents(ent: Entity): TimelineEvent[] {
  const out: TimelineEvent[] = [...(ent.events ?? [])];
  for (const a of ent.attacks ?? []) {
    if (a.date) out.push({
      date: a.date,
      type: "attack",
      label: `${a.location ?? "Attack"} — ${a.casualties ?? "?"} killed`,
      significance: a.casualties ? Math.min(1, Math.log10(Math.max(2, a.casualties)) / 2.4) : 0.5,
      sources: a.sources
    });
  }
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = `${e.date}::${e.label}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export default function Timeline() {
  const ent = useExplorer(selectedEntity);
  const setTimeWindow = useExplorer((s) => s.setTimeWindow);
  const timeWindow = useExplorer((s) => s.timeWindow);
  const ref = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const events = useMemo(() => (ent ? collectEvents(ent) : []), [ent]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const ro = new ResizeObserver(() => {
      const r = node.getBoundingClientRect();
      setSize((prev) => (prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }));
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    if (!ref.current || !ent || events.length === 0) return;
    const rect = ref.current.getBoundingClientRect();
    const width = size.w || rect.width;
    const height = size.h || rect.height;
    if (width === 0 || height === 0) {
      const id = requestAnimationFrame(() => setSize({ w: rect.width, h: rect.height }));
      return () => cancelAnimationFrame(id);
    }
    const margin = { top: 36, right: 20, bottom: 30, left: 20 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    const minDate = ent.founded ? new Date(ent.founded) : d3.min(events, (e) => new Date(e.date))!;
    const maxDate = ent.dissolved ? new Date(ent.dissolved) : new Date();
    const x = d3.scaleTime().domain([minDate, maxDate]).range([0, w]).nice();
    const r = d3.scaleSqrt().domain([0, 1]).range([3, 11]);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const baselineY = h - 8;

    // Period band (founded → dissolved or today)
    g.append("rect")
      .attr("x", x(minDate))
      .attr("y", baselineY - 3)
      .attr("width", Math.max(2, x(maxDate) - x(minDate)))
      .attr("height", 4)
      .attr("fill", ent.dissolved ? "#888780" : "#185FA5")
      .attr("fill-opacity", ent.dissolved ? 0.25 : 0.18);

    // Time-window highlight (when a dot is selected, shade ±delta)
    if (timeWindow) {
      const c = new Date(timeWindow.center);
      const delta = timeWindow.deltaDays * 86400_000;
      const w0 = x(new Date(c.getTime() - delta));
      const w1 = x(new Date(c.getTime() + delta));
      g.append("rect")
        .attr("x", Math.max(0, w0))
        .attr("y", 0)
        .attr("width", Math.max(2, Math.min(w, w1) - Math.max(0, w0)))
        .attr("height", h)
        .attr("fill", "#185FA5")
        .attr("fill-opacity", 0.05);
    }

    // Axis
    const axis = d3.axisBottom(x).ticks(Math.max(4, Math.floor(w / 110))).tickSizeOuter(0);
    const axisG = g.append("g")
      .attr("transform", `translate(0,${baselineY})`)
      .call(axis as any);
    axisG.selectAll("text")
      .attr("font-family", "'IBM Plex Mono', monospace")
      .attr("font-size", 10)
      .attr("fill", "currentColor")
      .attr("opacity", 0.8);
    axisG.selectAll(".domain").attr("stroke", "currentColor").attr("stroke-opacity", 0.25);
    axisG.selectAll(".tick line").attr("stroke", "currentColor").attr("stroke-opacity", 0.18);

    // Year tick markers above baseline
    const yearTicks = x.ticks(d3.timeYear.every(2)!);
    g.append("g")
      .selectAll("line")
      .data(yearTicks)
      .join("line")
      .attr("x1", (d) => x(d))
      .attr("x2", (d) => x(d))
      .attr("y1", baselineY - 4)
      .attr("y2", 6)
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.05)
      .attr("stroke-dasharray", "1 3");

    // Stack events when they collide on x
    const positioned = events.map((e) => ({ ...e, x: x(new Date(e.date)) }));
    const layerHeight = 22;
    const slotCount = Math.max(3, Math.floor((baselineY - 14) / layerHeight));
    const lastInSlot: number[] = Array(slotCount).fill(-Infinity);
    const minGap = 22;
    const withLayer = positioned.map((e) => {
      let slot = 0;
      for (let i = 0; i < slotCount; i++) {
        if (e.x - lastInSlot[i] > minGap) { slot = i; break; }
        if (i === slotCount - 1) { slot = i; }
      }
      lastInSlot[slot] = e.x;
      return { ...e, slot };
    });

    const dots = g.selectAll("g.event")
      .data(withLayer).enter()
      .append("g")
      .attr("class", "event")
      .attr("transform", (d) => `translate(${d.x}, ${baselineY - 12 - d.slot * layerHeight})`)
      .style("cursor", "pointer")
      .on("click", (_e, d) => setTimeWindow(d.date, 90));

    // Drop line connecting dot to baseline
    dots.append("line")
      .attr("x1", 0).attr("x2", 0)
      .attr("y1", 0).attr("y2", (d) => 12 + d.slot * layerHeight)
      .attr("stroke", (d) => EVENT_COLOR[d.type])
      .attr("stroke-opacity", 0.25)
      .attr("stroke-width", 1);

    dots.append("circle")
      .attr("r", (d) => r(d.significance ?? 0.4))
      .attr("fill", (d) => EVENT_COLOR[d.type])
      .attr("stroke", "#FFFFFF")
      .attr("stroke-width", 1);

    dots.append("title").text((d) => `${d.date} — ${d.label}`);
  }, [ent, events, setTimeWindow, size, timeWindow]);

  if (!ent) {
    return (
      <Pane label="Timeline">
        <div className="p-4 text-meta text-muted-light dark:text-muted-dark">Select an entity to see its timeline.</div>
      </Pane>
    );
  }

  return (
    <Pane
      label="Timeline"
      toolbar={
        <div className="flex items-center gap-2">
          <Legend />
          {timeWindow && (
            <button
              type="button"
              onClick={() => setTimeWindow(null)}
              className="text-[10px] uppercase tracking-eyebrow text-accent hover:underline"
            >
              Clear filter
            </button>
          )}
        </div>
      }
    >
      <div className="relative h-full p-2">
        <svg ref={ref} className="w-full h-full text-ink-light dark:text-ink-dark" />
        {events.length === 0 && (
          <p className="absolute inset-0 grid place-items-center text-meta text-muted-light dark:text-muted-dark pointer-events-none">
            No events recorded yet.
          </p>
        )}
      </div>
    </Pane>
  );
}

function Legend() {
  const items: { t: TimelineEvent["type"]; label: string }[] = [
    { t: "attack", label: "Attack" },
    { t: "leadership-change", label: "Leadership" },
    { t: "split", label: "Split" },
    { t: "merger", label: "Merger" },
    { t: "designation", label: "Designation" }
  ];
  return (
    <div className="hidden md:flex items-center gap-2 text-[10px] uppercase tracking-eyebrow text-muted-light dark:text-muted-dark">
      {items.map((i) => (
        <span key={i.t} className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: EVENT_COLOR[i.t] }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
