import { useEffect, useMemo, useState } from "react";
import type { Entity, Relationship, RelationshipType } from "../types";
import { selectedEntity, useExplorer } from "../lib/store";

interface GraphEdge {
  from: string;
  to: string;
  relationship: Relationship;
}

interface PathStep extends GraphEdge {
  current: string;
  next: string;
}

const TARGET_ALIASES: Record<string, string> = {
  "al-qaeda": "org-al-qaeda",
  "islamic-state": "org-islamic-state"
};

const RELATION_LABEL: Record<RelationshipType, string> = {
  parent: "parent organisation",
  "split-from": "split from",
  allied: "allied with",
  rival: "rival of",
  "financed-by": "financed by",
  "ideological-link": "ideologically linked",
  successor: "succeeded",
  "member-of": "member of",
  leads: "leads"
};

const GUIDED_QUESTIONS = [
  { label: "Leadership succession", prompt: "Summarise the leadership succession, including dates, fates and evidence gaps." },
  { label: "Splinters and reunifications", prompt: "Explain the documented splinters, mergers and reunifications around this actor." },
  { label: "Allies and rivals", prompt: "Compare this actor's documented alliances and rivalries. Separate confirmed links from analytical assessments." },
  { label: "Geographic footprint", prompt: "Describe the documented geographic footprint and how it has changed over time." }
];

function canonicalTarget(byId: Map<string, Entity>, id: string) {
  const canonical = TARGET_ALIASES[id] ?? id;
  return byId.has(canonical) ? canonical : id;
}

function graphEdges(byId: Map<string, Entity>): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const entity of byId.values()) {
    for (const relationship of entity.relationships ?? []) {
      const target = canonicalTarget(byId, relationship.to);
      edges.push({ from: entity.id, to: target, relationship });
    }
  }
  return edges;
}

function incidentCount(entity: Entity) {
  return (entity.attacks ?? []).length;
}

function casualtyCount(entity: Entity) {
  return (entity.attacks ?? []).reduce((sum, attack) => sum + (attack.casualties ?? 0), 0);
}

function countrySet(entity: Entity) {
  return new Set(
    [entity.country, ...(entity.countries ?? []), ...(entity.aor ?? []).map((point) => point.label)]
      .filter(Boolean) as string[]
  );
}

function relationCount(edges: GraphEdge[], id: string) {
  return edges.filter((edge) => edge.from === id || edge.to === id).length;
}

function neighbourSet(edges: GraphEdge[], id: string) {
  const neighbours = new Set<string>();
  for (const edge of edges) {
    if (edge.from === id) neighbours.add(edge.to);
    if (edge.to === id) neighbours.add(edge.from);
  }
  return neighbours;
}

function directRelationships(edges: GraphEdge[], left: string, right: string) {
  return edges.filter((edge) =>
    (edge.from === left && edge.to === right) || (edge.from === right && edge.to === left)
  );
}

function shortestPath(edges: GraphEdge[], start: string, target: string): PathStep[] | null {
  if (start === target) return [];
  const adjacency = new Map<string, { next: string; edge: GraphEdge }[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from)!.push({ next: edge.to, edge });
    adjacency.get(edge.to)!.push({ next: edge.from, edge });
  }

  const queue = [start];
  const visited = new Set([start]);
  const previous = new Map<string, { node: string; edge: GraphEdge }>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const candidate of adjacency.get(current) ?? []) {
      if (visited.has(candidate.next)) continue;
      visited.add(candidate.next);
      previous.set(candidate.next, { node: current, edge: candidate.edge });
      if (candidate.next === target) {
        const path: PathStep[] = [];
        let cursor = target;
        while (cursor !== start) {
          const step = previous.get(cursor);
          if (!step) return null;
          path.unshift({ ...step.edge, current: step.node, next: cursor });
          cursor = step.node;
        }
        return path;
      }
      queue.push(candidate.next);
    }
  }
  return null;
}

function sourceCount(entity: Entity) {
  return new Set((entity.sources ?? []).map((source) => source.url || source.id)).size;
}

function displayName(byId: Map<string, Entity>, id: string) {
  return byId.get(id)?.short ?? byId.get(id)?.name ??
    id.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function activePeriod(relationship: Relationship) {
  if (relationship.from && relationship.to_date) return `${relationship.from}–${relationship.to_date}`;
  if (relationship.from) return `since ${relationship.from}`;
  if (relationship.to_date) return `until ${relationship.to_date}`;
  return "date not recorded";
}

function pathRelationLabel(step: PathStep) {
  const forward = step.current === step.from;
  if (forward) return RELATION_LABEL[step.relationship.type];
  if (step.relationship.type === "split-from") return "origin of splinter";
  if (step.relationship.type === "parent") return "has branch";
  if (step.relationship.type === "financed-by") return "finances";
  if (step.relationship.type === "successor") return "succeeded by";
  if (step.relationship.type === "member-of") return "includes";
  if (step.relationship.type === "leads") return "led by";
  return RELATION_LABEL[step.relationship.type];
}

function describeRelationship(edge: GraphEdge, byId: Map<string, Entity>) {
  const left = displayName(byId, edge.from);
  const right = displayName(byId, edge.to);
  const relation = edge.relationship.type;
  if (relation === "split-from") return `${left} split from ${right}`;
  if (relation === "parent") return `${right} is the parent organisation of ${left}`;
  if (relation === "financed-by") return `${left} is financed by ${right}`;
  if (relation === "successor") return `${left} succeeded ${right}`;
  if (relation === "member-of") return `${left} is a member of ${right}`;
  if (relation === "leads") return `${left} leads ${right}`;
  return `${left} is ${RELATION_LABEL[relation]} ${right}`;
}

export default function InvestigationTools() {
  const ent = useExplorer(selectedEntity);
  const byId = useExplorer((state) => state.byId);
  const mode = useExplorer((state) => state.researchMode);
  const compareId = useExplorer((state) => state.compareId);
  const pathTargetId = useExplorer((state) => state.pathTargetId);
  const setMode = useExplorer((state) => state.setResearchMode);
  const setCompareId = useExplorer((state) => state.setCompareId);
  const setPathTargetId = useExplorer((state) => state.setPathTargetId);
  const openAsk = useExplorer((state) => state.openAsk);
  const select = useExplorer((state) => state.select);
  const [copyStatus, setCopyStatus] = useState("");

  const edges = useMemo(() => graphEdges(byId), [byId]);
  const candidates = useMemo(
    () => [...byId.values()]
      .filter((entity) => entity.id !== ent?.id)
      .sort((a, b) => Number(Boolean(a.stub)) - Number(Boolean(b.stub)) || a.name.localeCompare(b.name)),
    [byId, ent?.id]
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("compare");
    url.searchParams.delete("path");
    if (mode === "compare" && compareId) url.searchParams.set("compare", compareId);
    if (mode === "path" && pathTargetId) url.searchParams.set("path", pathTargetId);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setCopyStatus("");
  }, [mode, compareId, pathTargetId]);

  if (!ent) return null;

  const subject = ent;
  const comparison = compareId ? byId.get(compareId) ?? null : null;
  const pathTarget = pathTargetId ? byId.get(pathTargetId) ?? null : null;
  const path = pathTarget ? shortestPath(edges, subject.id, pathTarget.id) : null;

  async function copyView() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyStatus("Link copied");
    } catch {
      setCopyStatus("Copy the address from your browser");
    }
  }

  async function copyBrief() {
    const lines = [`TGD Explorer research view`, `Subject: ${subject.name}`];
    if (mode === "compare" && comparison) {
      const direct = directRelationships(edges, subject.id, comparison.id);
      const primaryNeighbours = neighbourSet(edges, subject.id);
      const comparisonNeighbours = neighbourSet(edges, comparison.id);
      const shared = [...primaryNeighbours]
        .filter((id) => comparisonNeighbours.has(id))
        .map((id) => displayName(byId, id));
      lines.push(
        `Comparison: ${subject.name} vs ${comparison.name}`,
        `Recorded relationships: ${relationCount(edges, subject.id)} vs ${relationCount(edges, comparison.id)}`,
        `Recorded attacks: ${incidentCount(subject)} vs ${incidentCount(comparison)}`,
        `Direct links: ${direct.length ? direct.map((edge) => describeRelationship(edge, byId)).join("; ") : "None recorded"}`,
        `Shared connections: ${shared.length ? shared.join(", ") : "None recorded"}`
      );
    }
    if (mode === "path" && pathTarget) {
      lines.push(`Connection path: ${subject.name} to ${pathTarget.name}`);
      if (path) {
        lines.push(
          path.reduce(
            (text, step) => `${text} —[${pathRelationLabel(step)}; ${activePeriod(step.relationship)}]→ ${displayName(byId, step.next)}`,
            subject.short ?? subject.name
          )
        );
      } else {
        lines.push("No documented route in the current TGD index.");
      }
    }
    lines.push(
      "Research note: a documented path does not by itself prove operational coordination.",
      window.location.href
    );
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopyStatus("Research brief copied");
    } catch {
      setCopyStatus("Copy unavailable in this browser");
    }
  }

  return (
    <section className="investigation-tools" aria-labelledby="investigation-tools-title">
      <header className="investigation-tools-head">
        <div>
          <p className="browse-eyebrow">Research workspace</p>
          <h2 id="investigation-tools-title">Investigate {ent.short ?? ent.name}</h2>
        </div>
        <nav aria-label="Research mode">
          <button type="button" className={mode === "overview" ? "is-active" : ""} onClick={() => setMode("overview")}>
            Questions
          </button>
          <button type="button" className={mode === "compare" ? "is-active" : ""} onClick={() => setMode("compare")}>
            Compare
          </button>
          <button type="button" className={mode === "path" ? "is-active" : ""} onClick={() => setMode("path")}>
            Trace connection
          </button>
        </nav>
      </header>

      {mode === "overview" && (
        <div className="investigation-question-grid">
          {GUIDED_QUESTIONS.map((question) => (
            <button key={question.label} type="button" onClick={() => openAsk(question.prompt)}>
              <span>Ask Explorer</span>
              <strong>{question.label}</strong>
              <b aria-hidden="true">→</b>
            </button>
          ))}
        </div>
      )}

      {mode === "compare" && (
        <div className="investigation-mode">
          <label>
            Compare with
            <select value={compareId ?? ""} onChange={(event) => setCompareId(event.target.value || null)}>
              <option value="">Choose another actor</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}{candidate.stub ? " — basic record" : ""}
                </option>
              ))}
            </select>
          </label>
          {comparison ? (
            <Comparison
              primary={ent}
              comparison={comparison}
              edges={edges}
              byId={byId}
              onOpen={() => select(comparison.id)}
              onAsk={() => openAsk(
                `Compare ${ent.name} with ${comparison.name}. Cover leadership, relationships, geographic footprint, attacks and the limits of the available evidence.`
              )}
            />
          ) : (
            <EmptyTool message="Choose an actor to compare relationships, incidents, geography and source depth." />
          )}
        </div>
      )}

      {mode === "path" && (
        <div className="investigation-mode">
          <label>
            Trace a path to
            <select value={pathTargetId ?? ""} onChange={(event) => setPathTargetId(event.target.value || null)}>
              <option value="">Choose a destination</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </select>
          </label>
          {pathTarget ? (
            <ConnectionPath
              start={ent}
              target={pathTarget}
              path={path}
              byId={byId}
              onOpen={(id) => select(id)}
              onAsk={() => openAsk(
                path
                  ? `Explain the documented connection path between ${ent.name} and ${pathTarget.name}. Distinguish direct evidence from analytical links and identify any evidence gaps.`
                  : `Is there a documented connection between ${ent.name} and ${pathTarget.name}? Explain what the available evidence can and cannot establish.`
              )}
            />
          ) : (
            <EmptyTool message="Choose a second actor. Explorer will find the shortest documented route through the network." />
          )}
        </div>
      )}

      {(mode === "compare" && comparison || mode === "path" && pathTarget) && (
        <footer className="investigation-share">
          <button type="button" onClick={() => void copyBrief()}>Copy research brief</button>
          <button type="button" onClick={() => void copyView()}>Copy this research view</button>
          <span aria-live="polite">{copyStatus}</span>
        </footer>
      )}
    </section>
  );
}

function Comparison({
  primary,
  comparison,
  edges,
  byId,
  onOpen,
  onAsk
}: {
  primary: Entity;
  comparison: Entity;
  edges: GraphEdge[];
  byId: Map<string, Entity>;
  onOpen: () => void;
  onAsk: () => void;
}) {
  const primaryNeighbours = neighbourSet(edges, primary.id);
  const comparisonNeighbours = neighbourSet(edges, comparison.id);
  const sharedNeighbours = [...primaryNeighbours]
    .filter((id) => comparisonNeighbours.has(id))
    .map((id) => byId.get(id))
    .filter((entity): entity is Entity => Boolean(entity));
  const primaryCountries = countrySet(primary);
  const comparisonCountries = countrySet(comparison);
  const sharedCountries = [...primaryCountries].filter((country) => comparisonCountries.has(country));
  const direct = directRelationships(edges, primary.id, comparison.id);

  return (
    <article className="comparison-result">
      <div className="comparison-summary">
        <div>
          <span>Primary actor</span>
          <strong>{primary.short ?? primary.name}</strong>
        </div>
        <div className="comparison-versus">versus</div>
        <div>
          <span>Comparison actor</span>
          <strong>{comparison.short ?? comparison.name}</strong>
        </div>
      </div>

      <div className="comparison-metrics">
        <Metric label="Relations" left={relationCount(edges, primary.id)} right={relationCount(edges, comparison.id)} />
        <Metric label="Recorded attacks" left={incidentCount(primary)} right={incidentCount(comparison)} />
        <Metric label="Recorded casualties" left={casualtyCount(primary)} right={casualtyCount(comparison)} />
        <Metric label="Profile sources" left={sourceCount(primary)} right={sourceCount(comparison)} />
      </div>

      <div className="comparison-findings">
        <p>
          <span>Direct relationship</span>
          <strong>
            {direct.length
              ? direct
                .map((edge) => `${describeRelationship(edge, byId)} · ${activePeriod(edge.relationship)}`)
                .join("; ")
              : "No direct link recorded"}
          </strong>
        </p>
        <p>
          <span>Shared connections</span>
          <strong>{sharedNeighbours.length ? sharedNeighbours.map((entity) => entity.short ?? entity.name).join(", ") : "None recorded"}</strong>
        </p>
        <p>
          <span>Shared geography</span>
          <strong>{sharedCountries.length ? sharedCountries.join(", ") : "None recorded"}</strong>
        </p>
      </div>

      <div className="investigation-result-actions">
        <button type="button" onClick={onAsk}>Ask Explorer for analysis</button>
        <button type="button" onClick={onOpen}>Open {comparison.short ?? comparison.name} →</button>
      </div>
    </article>
  );
}

function Metric({ label, left, right }: { label: string; left: number; right: number }) {
  return (
    <div>
      <strong>{left.toLocaleString()}</strong>
      <span>{label}</span>
      <strong>{right.toLocaleString()}</strong>
    </div>
  );
}

function ConnectionPath({
  start,
  target,
  path,
  byId,
  onOpen,
  onAsk
}: {
  start: Entity;
  target: Entity;
  path: PathStep[] | null;
  byId: Map<string, Entity>;
  onOpen: (id: string) => void;
  onAsk: () => void;
}) {
  if (!path) {
    return (
      <article className="connection-path-result is-empty">
        <p>
          No documented route currently connects <strong>{start.name}</strong> and <strong>{target.name}</strong>.
          This means the index has no path—not that no real-world relationship exists.
        </p>
        <button type="button" onClick={onAsk}>Ask Explorer about the evidence gap</button>
      </article>
    );
  }

  return (
    <article className="connection-path-result">
      <header>
        <span>Shortest documented route</span>
        <strong>{path.length} {path.length === 1 ? "connection" : "connections"}</strong>
      </header>
      <ol>
        <li>
          <button type="button" onClick={() => onOpen(start.id)}>{start.short ?? start.name}</button>
        </li>
        {path.map((step, index) => {
          const next = step.next;
          const item = (
            <li key={`${step.from}:${step.to}:${index}`}>
              <span>
                {pathRelationLabel(step)}
                <small>{activePeriod(step.relationship)}</small>
              </span>
              <button
                type="button"
                onClick={() => onOpen(next)}
                disabled={!byId.has(next)}
                title={byId.has(next) ? undefined : "Profile in preparation"}
              >
                {displayName(byId, next)}
              </button>
            </li>
          );
          return item;
        })}
      </ol>
      <p>
        A path shows how records are connected in TGD’s index. It does not by itself prove operational coordination.
      </p>
      <div className="investigation-result-actions">
        <button type="button" onClick={onAsk}>Ask Explorer to explain this path</button>
        <button type="button" onClick={() => onOpen(target.id)}>Open {target.short ?? target.name} →</button>
      </div>
    </article>
  );
}

function EmptyTool({ message }: { message: string }) {
  return (
    <div className="investigation-empty">
      <span aria-hidden="true">↗</span>
      <p>{message}</p>
    </div>
  );
}
