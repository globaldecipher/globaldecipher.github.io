import { useMemo, useState } from "react";
import { useExplorer } from "../lib/store";
import type { Entity } from "../types";

type CoverageFilter = "all" | "deep" | "basic";
type TypeFilter = "all" | Entity["type"];

const FEATURED_IDS = [
  "tehreek-e-taliban-pakistan",
  "iskp",
  "sanaullah-ghafari"
];

const TYPE_LABEL: Record<Entity["type"], string> = {
  organization: "Organisation",
  person: "Person",
  attack: "Attack",
  financing_entity: "Financing",
  front: "Front"
};

function coverageLabel(ent: Entity) {
  return ent.stub ? "Basic record" : "Deep profile";
}

function previewText(value = "") {
  return value.replace(/\s*\[(?:src-[a-z0-9-]+|\d+)\]/gi, "").replace(/\s+/g, " ").trim();
}

export default function Browse() {
  const entities = useExplorer((s) => s.entities);
  const select = useExplorer((s) => s.select);
  const [coverage, setCoverage] = useState<CoverageFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [country, setCountry] = useState("all");

  const deepCount = entities.filter((e) => !e.stub).length;
  const sources = new Set(entities.flatMap((e) => (e.sources ?? []).map((s) => s.url || s.id))).size;
  const countries = useMemo(
    () => [...new Set(entities.map((e) => e.country).filter(Boolean) as string[])].sort(),
    [entities]
  );
  const featured = FEATURED_IDS
    .map((id) => entities.find((e) => e.id === id))
    .filter(Boolean) as Entity[];

  const filtered = useMemo(
    () =>
      entities
        .filter((e) => coverage === "all" || (coverage === "deep" ? !e.stub : e.stub))
        .filter((e) => type === "all" || e.type === type)
        .filter((e) => country === "all" || e.country === country)
        .sort((a, b) => Number(Boolean(a.stub)) - Number(Boolean(b.stub)) || a.name.localeCompare(b.name)),
    [entities, coverage, type, country]
  );

  return (
    <main className="explorer-browse flex-1">
      <section className="browse-hero">
        <div className="max-w-3xl">
          <p className="browse-eyebrow">TGD Research Database</p>
          <h1>Trace the people, organisations and relationships behind the headlines.</h1>
          <p>
            Start with a researched profile or browse the wider Pakistan-theatre index.
            Every record shows its coverage level, sources and known gaps before you open it.
          </p>
        </div>
        <div className="browse-metrics" aria-label="Database coverage">
          <div><strong>{entities.length}</strong><span>Records</span></div>
          <div><strong>{deepCount}</strong><span>Deep profiles</span></div>
          <div><strong>{Math.max(0, entities.length - deepCount)}</strong><span>Basic records</span></div>
          <div><strong>{sources}</strong><span>Source links</span></div>
        </div>
      </section>

      <section className="browse-section" aria-labelledby="featured-title">
        <div className="browse-section-head">
          <div>
            <p className="browse-eyebrow">Recommended starting points</p>
            <h2 id="featured-title">Featured research</h2>
          </div>
          <p>Deep profiles contain sourced narrative, leadership, attacks and linked visual evidence.</p>
        </div>
        <div className="featured-grid">
          {featured.map((ent) => (
            <button
              key={ent.id}
              type="button"
              onClick={() => select(ent.id)}
              className="featured-card"
              aria-label={`Open deep profile: ${ent.name}`}
            >
              <span className="coverage-badge coverage-deep">Deep profile</span>
              <strong>{ent.name}</strong>
              <span>{previewText(ent.summary) || "Open the sourced research profile."}</span>
              <small>{[ent.country, ent.status].filter(Boolean).join(" · ")}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="browse-section browse-directory" aria-labelledby="directory-title">
        <div className="browse-section-head">
          <div>
            <p className="browse-eyebrow">Browse the index</p>
            <h2 id="directory-title">All records</h2>
          </div>
          <p>Use search above for a name or narrow this directory by coverage, type and country.</p>
        </div>

        <div className="directory-filters" aria-label="Record filters">
          <label>
            Coverage
            <select value={coverage} onChange={(e) => setCoverage(e.target.value as CoverageFilter)}>
              <option value="all">All coverage</option>
              <option value="deep">Deep profiles</option>
              <option value="basic">Basic records</option>
            </select>
          </label>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value as TypeFilter)}>
              <option value="all">All types</option>
              <option value="organization">Organisations</option>
              <option value="person">People</option>
              <option value="front">Fronts</option>
            </select>
          </label>
          <label>
            Country
            <select value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="all">All countries</option>
              {countries.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <p role="status">{filtered.length} matching {filtered.length === 1 ? "record" : "records"}</p>
        </div>

        <div className="record-list">
          {filtered.map((ent) => (
            <button
              key={ent.id}
              type="button"
              onClick={() => select(ent.id)}
              className="record-row"
              aria-label={`Open ${coverageLabel(ent).toLowerCase()}: ${ent.name}`}
            >
              <span className={`coverage-badge ${ent.stub ? "coverage-basic" : "coverage-deep"}`}>
                {coverageLabel(ent)}
              </span>
              <span>
                <strong>{ent.name}</strong>
                <small>{[TYPE_LABEL[ent.type], ent.country, ent.status].filter(Boolean).join(" · ")}</small>
              </span>
              <span aria-hidden="true">Open →</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
