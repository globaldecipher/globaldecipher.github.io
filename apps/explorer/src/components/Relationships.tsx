import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import Pane from "./Pane";
import { useExplorer, relFilterAllows } from "../lib/store";
import type { Entity, RelationshipType } from "../types";

const EDGE_COLOR: Record<RelationshipType, string> = {
  "split-from":       "#BA7517",
  "successor":        "#BA7517",
  "parent":           "#185FA5",
  "allied":           "#3B6D11",
  "rival":            "#A32D2D",
  "financed-by":      "#534AB7",
  "ideological-link": "#888780",
  "member-of":        "#185FA5",
  "leads":            "#185FA5"
};

const FILTERS = [
  { id: "all",         label: "All" },
  { id: "splits",      label: "Splits" },
  { id: "alliances",   label: "Alliances" },
  { id: "rivals",      label: "Rivals" },
  { id: "financing",   label: "Financing" },
  { id: "ideological", label: "Ideological" }
] as const;

interface GNode {
  id: string; label: string; type: Entity["type"]; degree: number; stub?: boolean;
  x?: number; y?: number; fx?: number | null; fy?: number | null;
}
interface GEdge { source: string | GNode; target: string | GNode; type: RelationshipType; allowed: boolean }

export default function Relationships() {
  const ent = useExplorer((s) => (s.selectedId ? s.byId.get(s.selectedId) ?? null : null));
  const byId = useExplorer((s) => s.byId);
  const select = useExplorer((s) => s.select);
  const filter = useExplorer((s) => s.relFilter);
  const setFilter = useExplorer((s) => s.setRelFilter);
  const ref = useRef<SVGSVGElement | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => { setExpanded(new Set()); }, [ent?.id]);

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

  const { nodes, edges } = useMemo(() => {
    if (!ent) return { nodes: [] as GNode[], edges: [] as GEdge[] };
    const centerId = ent.id;
    const seen = new Map<string, GNode>();
    const edgeList: GEdge[] = [];

    function pushNode(id: string, degree: number) {
      if (seen.has(id)) {
        const n = seen.get(id)!;
        if (degree < n.degree) n.degree = degree;
        return;
      }
      const e = byId.get(id);
      seen.set(id, {
        id,
        label: e?.short ?? e?.name ?? id,
        type: e?.type ?? "organization",
        degree,
        stub: e?.stub
      });
    }
    pushNode(centerId, 0);

    const dedupeKey = (a: string, b: string, t: string) => `${a}|${t}|${b}`;
    const seenEdges = new Set<string>();

    const enqueueEdges = (sourceId: string, depth: number) => {
      const node = byId.get(sourceId);
      if (!node) return;
      for (const r of node.relationships ?? []) {
        pushNode(r.to, depth + 1);
        const k = dedupeKey(sourceId, r.to, r.type);
        if (seenEdges.has(k)) continue;
        seenEdges.add(k);
        edgeList.push({ source: sourceId, target: r.to, type: r.type, allowed: relFilterAllows(r.type, filter) });
      }
      for (const other of byId.values()) {
        for (const r of other.relationships ?? []) {
          if (r.to === sourceId) {
            pushNode(other.id, depth + 1);
            const k = dedupeKey(other.id, sourceId, r.type);
            if (seenEdges.has(k)) continue;
            seenEdges.add(k);
            edgeList.push({ source: other.id, target: sourceId, type: r.type, allowed: relFilterAllows(r.type, filter) });
          }
        }
      }
    };

    enqueueEdges(centerId, 0);
    for (const id of expanded) enqueueEdges(id, 1);
    return { nodes: [...seen.values()], edges: edgeList };
  }, [ent, byId, filter, expanded]);

  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    if (!ent || nodes.length === 0) return;
    const rect = ref.current!.getBoundingClientRect();
    const width = size.w || rect.width;
    const height = size.h || rect.height;
    if (width === 0 || height === 0) {
      const id = requestAnimationFrame(() => setSize({ w: rect.width, h: rect.height }));
      return () => cancelAnimationFrame(id);
    }

    const root = svg.append("g");

    // Arrow markers per edge color
    const defs = svg.append("defs");
    for (const [type, color] of Object.entries(EDGE_COLOR)) {
      defs.append("marker")
        .attr("id", `arr-${type}`)
        .attr("viewBox", "0 -4 8 8")
        .attr("refX", 22)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-3.6L7,0L0,3.6Z")
        .attr("fill", color)
        .attr("opacity", 0.8);
    }

    const sim = d3
      .forceSimulation(nodes as unknown as d3.SimulationNodeDatum[])
      .force(
        "link",
        d3.forceLink(edges as unknown as d3.SimulationLinkDatum<d3.SimulationNodeDatum>[])
          .id((d: any) => d.id)
          .distance((d: any) => (d.allowed ? 130 : 150))
          .strength((d: any) => (d.allowed ? 0.55 : 0.2))
      )
      .force("charge", d3.forceManyBody().strength(-340))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide(38));

    const edgeSel = root.append("g")
      .attr("class", "edges")
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr("stroke", (d) => EDGE_COLOR[d.type] ?? "#888")
      .attr("stroke-width", (d) => (d.allowed ? 1.4 : 0.7))
      .attr("stroke-opacity", (d) => (d.allowed ? 0.78 : 0.08))
      .attr("marker-end", (d) => (d.allowed ? `url(#arr-${d.type})` : null));

    const group = root.append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("class", "node")
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr("aria-label", (d: any) => `Open ${d.label}`)
      .style("cursor", "pointer")
      .on("click", (_e, d: any) => select(d.id))
      .on("keydown", (event: KeyboardEvent, d: any) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(d.id);
        }
      });

    // Halo (subtle): a soft second ring on the centre node so it reads as anchored
    group.filter((d: any) => d.id === ent.id)
      .append("circle")
      .attr("r", 22)
      .attr("fill", "none")
      .attr("stroke", "#185FA5")
      .attr("stroke-opacity", 0.18);

    const r = (d: any) => (d.id === ent.id ? 14 : 9);
    group.append("circle")
      .attr("r", r)
      .attr("fill", (d: any) => (d.id === ent.id ? "#185FA5" : "#FFFFFF"))
      .attr("stroke", (d: any) => (d.id === ent.id ? "#0E4581" : d.stub ? "#9A9893" : "#16181D"))
      .attr("stroke-width", 1.1);

    // Type glyph in centre of node (initial letter)
    group.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", 3.5)
      .attr("font-size", (d: any) => (d.id === ent.id ? 11 : 9))
      .attr("font-family", "'IBM Plex Mono', monospace")
      .attr("fill", (d: any) => (d.id === ent.id ? "#FFFFFF" : "#16181D"))
      .text((d: any) => (d.type === "person" ? "i" : d.type === "attack" ? "!" : "○"));

    // Label with hit-rect for better hover/clicks
    const labelG = group.append("g")
      .attr("transform", (d: any) => `translate(0, ${r(d) + 14})`);
    labelG.append("rect")
      .attr("x", -50).attr("y", -8).attr("width", 100).attr("height", 16)
      .attr("fill", "currentColor")
      .attr("fill-opacity", 0.001);
    labelG.append("text")
      .attr("class", "label")
      .attr("text-anchor", "middle")
      .attr("dy", 4)
      .attr("font-size", 10.5)
      .attr("font-family", "'IBM Plex Mono', monospace")
      .attr("fill", "currentColor")
      .text((d: any) => d.label);

    // Expand-handle on neighbours
    const handle = group
      .filter((d: any) => d.id !== ent.id && !expanded.has(d.id))
      .append("g")
      .attr("transform", "translate(14, -14)")
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr("aria-label", (d: any) => `Expand relationships for ${d.label}`)
      .style("cursor", "cell")
      .on("click", (e: any, d: any) => {
        e.stopPropagation();
        setExpanded((set) => new Set(set).add(d.id));
      })
      .on("keydown", (event: KeyboardEvent, d: any) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          setExpanded((set) => new Set(set).add(d.id));
        }
      });
    handle.append("circle").attr("r", 10).attr("fill", "#185FA5");
    handle.append("text")
      .attr("text-anchor", "middle").attr("dy", 4)
      .attr("font-size", 11).attr("fill", "#FFFFFF").attr("font-weight", 700).text("+");

    // Drag handlers
    const drag = d3.drag<SVGGElement, GNode>()
      .on("start", (event, d) => {
        if (!event.active) sim.alphaTarget(0.25).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x; d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        // Keep nodes pinned where the user drops them.
      });
    group.call(drag as any);

    sim.on("tick", () => {
      edgeSel
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);
      group.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => { sim.stop(); };
  }, [nodes, edges, ent, select, expanded, size]);

  return (
    <Pane
      label="Relationships"
      toolbar={
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id as any)}
              className={
                "text-[10px] uppercase tracking-eyebrow px-2 h-6 border-hair transition-colors " +
                (filter === f.id
                  ? "bg-accent border-accent text-white"
                  : "border-line-light dark:border-line-dark text-muted-light dark:text-muted-dark hover:text-accent hover:border-accent")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="relative h-full">
        <svg ref={ref} className="absolute inset-0 w-full h-full text-ink-light dark:text-ink-dark" />
        <Legend />
        <div className="absolute top-2 right-2 text-[10px] uppercase tracking-eyebrow text-dim-light dark:text-dim-dark pointer-events-none">
          Drag nodes · click + to expand
        </div>
      </div>
    </Pane>
  );
}

function Legend() {
  return (
    <div className="absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-eyebrow text-muted-light dark:text-muted-dark">
      {(["split-from", "parent", "allied", "rival", "financed-by", "ideological-link"] as RelationshipType[]).map((t) => (
        <span key={t} className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-[2px]" style={{ background: EDGE_COLOR[t] }} />
          {t.replace("-", " ")}
        </span>
      ))}
    </div>
  );
}
