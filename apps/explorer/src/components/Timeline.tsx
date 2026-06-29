import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import Pane from "./Pane";
import { useExplorer, selectedEntity } from "../lib/store";
import type { Entity, TimelineEvent } from "../types";

const EVENT_COLOR: Record<TimelineEvent["type"], string> = {
  founded: "#b91c2c",
  dissolved: "#888780",
  "leadership-change": "#534AB7",
  split: "#BA7517",
  merger: "#3B6D11",
  attack: "#A32D2D",
  designation: "#64748B"
};

const EVENT_LABEL: Record<TimelineEvent["type"], string> = {
  founded: "Founded",
  dissolved: "Dissolved",
  "leadership-change": "Leadership",
  split: "Split",
  merger: "Merger",
  attack: "Attack",
  designation: "Designation"
};

function eventKey(event: TimelineEvent) {
  return `${event.date}::${event.type}::${event.label}`;
}

function collectEvents(ent: Entity): TimelineEvent[] {
  const explicit = [...(ent.events ?? [])];
  const coveredDates = new Set(explicit.map((event) => `${event.date}::${event.type}`));
  const attacks = (ent.attacks ?? [])
    .filter((attack) => attack.date && !coveredDates.has(`${attack.date}::attack`))
    .map((attack): TimelineEvent => ({
      date: attack.date,
      type: "attack",
      label: `${attack.location ?? "Attack"} — ${attack.casualties ?? "unknown number"} killed`,
      significance: attack.casualties
        ? Math.min(1, Math.log10(Math.max(2, attack.casualties)) / 2.4)
        : 0.5,
      sources: attack.sources
    }));

  return [...explicit, ...attacks].sort((a, b) => a.date.localeCompare(b.date));
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

export default function Timeline() {
  const ent = useExplorer(selectedEntity);
  const ref = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const events = useMemo(() => (ent ? collectEvents(ent) : []), [ent]);
  const selectedEvent = useMemo(
    () => events.find((event) => eventKey(event) === selectedKey) ?? null,
    [events, selectedKey]
  );

  useEffect(() => {
    setSelectedKey(null);
  }, [ent?.id]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      const rect = node.getBoundingClientRect();
      setSize((previous) => (
        previous.w === rect.width && previous.h === rect.height
          ? previous
          : { w: rect.width, h: rect.height }
      ));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    if (!ref.current || !ent || events.length === 0) return;

    const rect = ref.current.getBoundingClientRect();
    const width = size.w || rect.width;
    const height = size.h || rect.height;
    if (width === 0 || height === 0) {
      const frame = requestAnimationFrame(() => setSize({ w: rect.width, h: rect.height }));
      return () => cancelAnimationFrame(frame);
    }

    const margin = { top: 18, right: 18, bottom: 28, left: 18 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    const firstDate = ent.founded ? new Date(ent.founded) : d3.min(events, (event) => new Date(event.date))!;
    const lastEventDate = d3.max(events, (event) => new Date(event.date))!;
    const lastDate = ent.dissolved
      ? new Date(ent.dissolved)
      : d3.max([lastEventDate, new Date()])!;
    const x = d3.scaleTime().domain([firstDate, lastDate]).range([0, chartWidth]).nice();
    const radius = d3.scaleSqrt().domain([0, 1]).range([4, 8]);
    const root = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const baselineY = chartHeight - 2;

    const axis = d3.axisBottom(x)
      .ticks(Math.max(4, Math.floor(chartWidth / 105)))
      .tickSizeOuter(0);
    const axisGroup = root.append("g")
      .attr("transform", `translate(0,${baselineY})`)
      .call(axis as any);
    axisGroup.selectAll("text")
      .attr("font-family", "'IBM Plex Mono', monospace")
      .attr("font-size", 10)
      .attr("fill", "currentColor")
      .attr("opacity", 0.75);
    axisGroup.selectAll(".domain")
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.3);
    axisGroup.selectAll(".tick line")
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.16);

    const yearTicks = x.ticks(d3.timeYear.every(2)!);
    root.append("g")
      .selectAll("line")
      .data(yearTicks)
      .join("line")
      .attr("x1", (date) => x(date))
      .attr("x2", (date) => x(date))
      .attr("y1", 0)
      .attr("y2", baselineY)
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.055)
      .attr("stroke-dasharray", "1 3");

    const positioned = events.map((event) => ({ ...event, x: x(new Date(event.date)) }));
    const layerHeight = 20;
    const slotCount = Math.max(2, Math.floor((baselineY - 8) / layerHeight));
    const lastInSlot: number[] = Array(slotCount).fill(-Infinity);
    const withLayer = positioned.map((event) => {
      let slot = 0;
      for (let index = 0; index < slotCount; index++) {
        if (event.x - lastInSlot[index] > 20) {
          slot = index;
          break;
        }
        if (index === slotCount - 1) slot = index;
      }
      lastInSlot[slot] = event.x;
      return { ...event, slot };
    });

    const selected = withLayer.find((event) => eventKey(event) === selectedKey);
    if (selected) {
      root.append("line")
        .attr("x1", selected.x)
        .attr("x2", selected.x)
        .attr("y1", 0)
        .attr("y2", baselineY)
        .attr("stroke", EVENT_COLOR[selected.type])
        .attr("stroke-width", 1.25)
        .attr("stroke-dasharray", "2 3")
        .attr("stroke-opacity", 0.55);
    }

    const dots = root.selectAll("g.key-event")
      .data(withLayer)
      .enter()
      .append("g")
      .attr("class", "key-event")
      .attr("transform", (event) => (
        `translate(${event.x}, ${baselineY - 12 - event.slot * layerHeight})`
      ))
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr("aria-label", (event) => `${formatDate(event.date)}: ${event.label}`)
      .attr("aria-pressed", (event) => eventKey(event) === selectedKey ? "true" : "false")
      .style("cursor", "pointer")
      .on("click", (_event, datum) => setSelectedKey(eventKey(datum)))
      .on("keydown", (keyboardEvent: KeyboardEvent, datum) => {
        if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
          keyboardEvent.preventDefault();
          setSelectedKey(eventKey(datum));
        }
      });

    dots.append("line")
      .attr("x1", 0)
      .attr("x2", 0)
      .attr("y1", 0)
      .attr("y2", (event) => 12 + event.slot * layerHeight)
      .attr("stroke", (event) => EVENT_COLOR[event.type])
      .attr("stroke-opacity", 0.22);

    dots.filter((event) => eventKey(event) === selectedKey)
      .append("circle")
      .attr("r", (event) => radius(event.significance ?? 0.4) + 4)
      .attr("fill", "none")
      .attr("stroke", (event) => EVENT_COLOR[event.type])
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.55);

    dots.append("circle")
      .attr("r", (event) => radius(event.significance ?? 0.4))
      .attr("fill", (event) => EVENT_COLOR[event.type])
      .attr("stroke", "#FFFFFF")
      .attr("stroke-width", 1.2);

    dots.append("title").text((event) => `${formatDate(event.date)} — ${event.label}`);
  }, [ent, events, selectedKey, size]);

  if (!ent) {
    return (
      <Pane label="Key events">
        <div className="p-4 text-meta text-muted-light dark:text-muted-dark">
          Select an entity to see its key events.
        </div>
      </Pane>
    );
  }

  const visibleTypes = [...new Set(events.map((event) => event.type))];
  const sourcesById = new Map((ent.sources ?? []).map((source) => [source.id, source]));

  return (
    <Pane
      label="Key events"
      className="key-events-pane"
      toolbar={<span className="key-events-count">{events.length} recorded</span>}
    >
      <div className="key-events-content">
        <div className="key-events-guide">
          <p>
            Each dot is a dated milestone. Larger dots mark events recorded as more significant.
            Select any dot or row for its evidence.
          </p>
          <Legend types={visibleTypes} />
        </div>

        <div className="key-events-chart" aria-label="Key events chart">
          <svg ref={ref} className="w-full h-full text-ink-light dark:text-ink-dark" />
        </div>

        {events.length > 0 ? (
          <ol className="key-events-list" aria-label="Chronological event list">
            {events.map((event) => {
              const key = eventKey(event);
              const active = key === selectedKey;
              const evidence = (event.sources ?? [])
                .map((id) => sourcesById.get(id))
                .filter(Boolean);
              return (
                <li key={key} className={active ? "is-selected" : ""}>
                  <button
                    type="button"
                    className="key-event-row"
                    onClick={() => setSelectedKey(active ? null : key)}
                    aria-pressed={active}
                  >
                    <span className="key-event-marker" style={{ background: EVENT_COLOR[event.type] }} />
                    <span className="key-event-date">{formatDate(event.date)}</span>
                    <span className="key-event-copy">
                      <span className="key-event-type">{EVENT_LABEL[event.type]}</span>
                      <strong>{event.label}</strong>
                    </span>
                    <span className="key-event-open" aria-hidden="true">{active ? "−" : "+"}</span>
                  </button>
                  {active && (
                    <div className="key-event-evidence" aria-live="polite">
                      <span>Evidence</span>
                      {evidence.length > 0 ? (
                        <ul>
                          {evidence.map((source) => source && (
                            <li key={source.id}>
                              {source.url ? (
                                <a href={source.url} target="_blank" rel="noopener noreferrer">
                                  {source.title}
                                </a>
                              ) : (
                                source.title
                              )}
                              <small>{[source.outlet, source.date].filter(Boolean).join(" · ")}</small>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No source link has been attached to this milestone yet.</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="key-events-empty">No dated events are recorded for this profile yet.</p>
        )}
      </div>
    </Pane>
  );
}

function Legend({ types }: { types: TimelineEvent["type"][] }) {
  return (
    <div className="key-events-legend" aria-label="Event colour guide">
      {types.map((type) => (
        <span key={type}>
          <i style={{ background: EVENT_COLOR[type] }} />
          {EVENT_LABEL[type]}
        </span>
      ))}
    </div>
  );
}
