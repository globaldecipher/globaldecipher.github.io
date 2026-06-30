import { useEffect, useMemo, useState } from "react";
import Pane from "./Pane";
import { relFilterAllows, useExplorer } from "../lib/store";
import type { Entity, Relationship, RelationshipType, SourceRef } from "../types";

type RelFilter = "all" | "splits" | "alliances" | "rivals" | "financing" | "ideological";

interface Connection {
  key: string;
  direction: "outbound" | "inbound";
  origin: Entity;
  related: Entity;
  relationship: Relationship;
}

const RELATION_META: Record<RelationshipType, { label: string; color: string }> = {
  "split-from":       { label: "Splinter link", color: "#BA7517" },
  "successor":        { label: "Successor link", color: "#BA7517" },
  "parent":           { label: "Parent link", color: "#b91c2c" },
  "allied":           { label: "Allied with", color: "#3B6D11" },
  "rival":            { label: "Rival", color: "#A32D2D" },
  "financed-by":      { label: "Funding link", color: "#534AB7" },
  "ideological-link": { label: "Ideological link", color: "#888780" },
  "member-of":        { label: "Membership link", color: "#b91c2c" },
  "leads":            { label: "Leadership link", color: "#b91c2c" }
};

const FILTERS: { id: RelFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "alliances", label: "Allies" },
  { id: "rivals", label: "Rivals" },
  { id: "splits", label: "Splinters" },
  { id: "financing", label: "Funding" },
  { id: "ideological", label: "Ideology" }
];

const TYPE_ORDER: RelationshipType[] = [
  "allied",
  "rival",
  "split-from",
  "parent",
  "member-of",
  "leads",
  "financed-by",
  "ideological-link",
  "successor"
];

const ENTITY_ID_ALIASES: Record<string, string> = {
  "al-qaeda": "org-al-qaeda",
  "islamic-state": "org-islamic-state"
};

const ENTITY_NAME_OVERRIDES: Record<string, string> = {
  "afghan-taliban": "Afghan Taliban",
  "haqqani-network": "Haqqani Network",
  "al-qaeda": "Al-Qaeda"
};

function resolveRelated(byId: Map<string, Entity>, id: string): Entity {
  const canonical = ENTITY_ID_ALIASES[id] ?? id;
  const existing = byId.get(canonical);
  if (existing) return existing;

  const name =
    ENTITY_NAME_OVERRIDES[id] ??
    id.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
  return {
    id,
    type: "organization",
    name,
    short: name,
    stub: true
  };
}

function formatPeriod(from?: string, to?: string) {
  if (!from && !to) return "Date not recorded";

  const human = (value: string) => {
    const match = value.match(/^(\d{4})(?:-(\d{2}))?/);
    if (!match) return value;
    if (!match[2]) return match[1];
    return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" })
      .format(new Date(`${match[1]}-${match[2]}-01T00:00:00Z`));
  };

  if (from && to) return `${human(from)}–${human(to)}`;
  if (from) return `Since ${human(from)}`;
  return `Until ${human(to!)}`;
}

function yearFrom(value?: string) {
  const match = value?.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function activeInYear(relationship: Relationship, year: number | null) {
  if (year == null) return true;
  const start = yearFrom(relationship.from);
  const end = yearFrom(relationship.to_date);
  return (start == null || start <= year) && (end == null || end >= year);
}

function relationshipPhrase(connection: Connection) {
  const { type } = connection.relationship;
  const incoming = connection.direction === "inbound";

  if (type === "allied") return "works alongside";
  if (type === "rival") return "competes with";
  if (type === "ideological-link") return "shares ideological ties with";
  if (type === "split-from") return "has a splinter history with";
  if (type === "financed-by") return incoming ? "receives financing from" : "is financed by";
  if (type === "leads") return incoming ? "is led by" : "leads";
  if (type === "member-of") return incoming ? "includes" : "is a member of";
  if (type === "parent") return incoming ? "is linked as a parent of" : "is linked to its parent";
  if (type === "successor") return incoming ? "was succeeded by" : "succeeded";
  return "is connected to";
}

function collectSources(connection: Connection, subject: Entity): SourceRef[] {
  const ids = connection.relationship.sources ?? [];
  if (ids.length === 0) return [];

  const candidates = [
    ...(subject.sources ?? []),
    ...(connection.origin.sources ?? []),
    ...(connection.related.sources ?? [])
  ];
  return ids
    .map((id) => candidates.find((source) => source.id === id))
    .filter((source): source is SourceRef => Boolean(source));
}

export default function Relationships() {
  const ent = useExplorer((state) =>
    state.selectedId ? state.byId.get(state.selectedId) ?? null : null
  );
  const byId = useExplorer((state) => state.byId);
  const select = useExplorer((state) => state.select);
  const filter = useExplorer((state) => state.relFilter);
  const setFilter = useExplorer((state) => state.setRelFilter);
  const openAsk = useExplorer((state) => state.openAsk);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const connections = useMemo(() => {
    if (!ent) return [] as Connection[];

    const found: Connection[] = [];
    const seen = new Set<string>();

    const add = (
      origin: Entity,
      related: Entity | undefined,
      relationship: Relationship,
      direction: Connection["direction"]
    ) => {
      if (!related) return;
      const key = `${origin.id}:${relationship.type}:${relationship.to}`;
      if (seen.has(key)) return;
      seen.add(key);
      found.push({ key, direction, origin, related, relationship });
    };

    for (const relationship of ent.relationships ?? []) {
      add(ent, resolveRelated(byId, relationship.to), relationship, "outbound");
    }

    for (const candidate of byId.values()) {
      for (const relationship of candidate.relationships ?? []) {
        if (relationship.to === ent.id) {
          add(candidate, candidate, relationship, "inbound");
        }
      }
    }

    return found.sort((a, b) => {
      const typeDifference =
        TYPE_ORDER.indexOf(a.relationship.type) - TYPE_ORDER.indexOf(b.relationship.type);
      return typeDifference || a.related.name.localeCompare(b.related.name);
    });
  }, [byId, ent]);

  useEffect(() => {
    setSelectedKey(null);
    setSelectedYear(null);
    setFilter("all");
  }, [ent?.id, setFilter]);

  const recordedYears = connections
    .flatMap((connection) => [
      yearFrom(connection.relationship.from),
      yearFrom(connection.relationship.to_date)
    ])
    .filter((year): year is number => year != null);
  const minYear = recordedYears.length ? Math.min(...recordedYears) : new Date().getFullYear();
  const maxYear = Math.max(new Date().getFullYear(), ...(recordedYears.length ? recordedYears : [minYear]));
  const visibleConnections = connections.filter((connection) =>
    relFilterAllows(connection.relationship.type, filter) &&
    activeInYear(connection.relationship, selectedYear)
  );
  const selected =
    visibleConnections.find((connection) => connection.key === selectedKey) ??
    visibleConnections[0] ??
    null;

  if (!ent) return null;

  return (
    <Pane
      label="Connection paths"
      className="relationship-paths-pane"
      toolbar={<span className="relationship-count">{connections.length} documented</span>}
    >
      <div className="relationship-paths">
        <header className="relationship-intro">
          <div className="relationship-subject">
            <span>Starting point</span>
            <strong>{ent.short ?? ent.name}</strong>
            {ent.short && ent.short !== ent.name && <small>{ent.name}</small>}
          </div>
          <div className="relationship-guide">
            <p>
              Start with {ent.short ?? ent.name}. Choose a connection to see exactly who is linked,
              how the relationship works and when it was recorded.
            </p>
            <nav className="relationship-filters" aria-label="Filter connections by relationship">
              {FILTERS.map((item) => {
                const count =
                  item.id === "all"
                    ? connections.length
                    : connections.filter((connection) =>
                        relFilterAllows(connection.relationship.type, item.id)
                      ).length;
                if (item.id !== "all" && count === 0) return null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={filter === item.id ? "is-active" : ""}
                    onClick={() => setFilter(item.id)}
                    aria-pressed={filter === item.id}
                  >
                    {item.label} <span>{count}</span>
                  </button>
                );
              })}
            </nav>
            {recordedYears.length > 0 && (
              <div className="relationship-time-filter">
                <label>
                  <span>Relationship date</span>
                  <select
                    aria-label="Network year"
                    value={selectedYear ?? ""}
                    onChange={(event) => setSelectedYear(event.target.value ? Number(event.target.value) : null)}
                  >
                    <option value="">All years</option>
                    {Array.from({ length: maxYear - minYear + 1 }, (_, index) => maxYear - index)
                      .map((year) => <option key={year} value={year}>{year}</option>)}
                  </select>
                </label>
              </div>
            )}
          </div>
        </header>

        {selected ? (
          <div className="relationship-workbench">
            <nav className="relationship-index" aria-label={`Connections to ${ent.name}`}>
              {visibleConnections.map((connection) => {
                const meta = RELATION_META[connection.relationship.type];
                const active = connection.key === selected.key;
                return (
                  <button
                    key={connection.key}
                    type="button"
                    className={active ? "relationship-index-row is-active" : "relationship-index-row"}
                    onClick={() => setSelectedKey(connection.key)}
                    aria-pressed={active}
                  >
                    <i style={{ background: meta.color }} />
                    <span>
                      <small>{meta.label}</small>
                      <strong>{connection.related.name}</strong>
                    </span>
                    <em>{formatPeriod(connection.relationship.from, connection.relationship.to_date)}</em>
                    <b aria-hidden="true">→</b>
                  </button>
                );
              })}
            </nav>

            <ConnectionDetail
              connection={selected}
              subject={ent}
              canOpen={byId.has(selected.related.id)}
              onOpen={() => select(selected.related.id)}
              onAsk={() => openAsk(
                `Explain the documented ${RELATION_META[selected.relationship.type].label.toLowerCase()} between ${ent.name} and ${selected.related.name}. Use the relationship note, dates and available profile sources, and clearly identify any evidence gaps.`
              )}
            />
          </div>
        ) : (
          <div className="relationship-empty">
            <strong>No connections in this view.</strong>
            <span>Choose another relationship type to continue.</span>
          </div>
        )}
      </div>
    </Pane>
  );
}

function ConnectionDetail({
  connection,
  subject,
  canOpen,
  onOpen,
  onAsk
}: {
  connection: Connection;
  subject: Entity;
  canOpen: boolean;
  onOpen: () => void;
  onAsk: () => void;
}) {
  const meta = RELATION_META[connection.relationship.type];
  const sources = collectSources(connection, subject);
  const subjectLabel = subject.short ?? subject.name;
  const relatedLabel = connection.related.short ?? connection.related.name;
  const profileSourceCount = new Set([
    ...(subject.sources ?? []).map((source) => source.url || source.id),
    ...(connection.related.sources ?? []).map((source) => source.url || source.id)
  ]).size;

  return (
    <article className="relationship-detail" aria-live="polite">
      <div className="relationship-route">
        <div className="relationship-route-node is-subject">
          <span>Selected subject</span>
          <strong>{subjectLabel}</strong>
        </div>
        <div className="relationship-route-link">
          <span style={{ color: meta.color }}>{meta.label}</span>
          <div style={{ color: meta.color }} aria-hidden="true">
            <i />
            <b>→</b>
          </div>
          <small>{formatPeriod(connection.relationship.from, connection.relationship.to_date)}</small>
        </div>
        <div className="relationship-route-node">
          <span>{connection.related.type.replace("_", " ")}</span>
          <strong>{relatedLabel}</strong>
        </div>
      </div>

      <p className="relationship-statement">
        <strong>{subjectLabel}</strong> {relationshipPhrase(connection)}{" "}
        <strong>{connection.related.name}</strong>.
      </p>
      <p className="relationship-note">
        {connection.relationship.note ??
          "The relationship is recorded in the index; a fuller narrative assessment is still being prepared."}
      </p>

      <footer className="relationship-detail-footer">
        <div>
          <span>Evidence</span>
          {sources.length > 0 ? (
            sources.map((source) =>
              source.url ? (
                <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
                  {source.outlet ?? source.title} ↗
                </a>
              ) : (
                <small key={source.id}>{source.outlet ?? source.title}</small>
              )
            )
          ) : (
            <>
              <small>Direct citation pending for this relationship claim</small>
              {profileSourceCount > 0 && <small>{profileSourceCount} profile sources available for contextual review</small>}
            </>
          )}
        </div>
        <div className="relationship-detail-actions">
          <button type="button" onClick={onAsk}>Ask Explorer</button>
          <button type="button" onClick={onOpen} disabled={!canOpen}>
            {canOpen ? (
              <>Open {relatedLabel} <span aria-hidden="true">→</span></>
            ) : (
              "Profile in preparation"
            )}
          </button>
        </div>
      </footer>
    </article>
  );
}
