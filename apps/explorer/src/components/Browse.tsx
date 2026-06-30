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
  const [investigationQuery, setInvestigationQuery] = useState("");

  const deepCount = entities.filter((e) => !e.stub).length;
  const sources = new Set(entities.flatMap((e) => (e.sources ?? []).map((s) => s.url || s.id))).size;
  const countries = useMemo(
    () => [...new Set(entities.map((e) => e.country).filter(Boolean) as string[])].sort(),
    [entities]
  );
  const featured = FEATURED_IDS
    .map((id) => entities.find((e) => e.id === id))
    .filter(Boolean) as Entity[];
  const investigationMatches = useMemo(() => {
    const query = investigationQuery.trim().toLowerCase();
    if (!query) return featured.slice(0, 3);
    return entities
      .filter((entity) =>
        [entity.name, entity.short, ...(entity.aliases ?? [])]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query))
      )
      .sort((a, b) => Number(Boolean(a.stub)) - Number(Boolean(b.stub)) || a.name.localeCompare(b.name))
      .slice(0, 6);
  }, [entities, featured, investigationQuery]);

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
        <div className="browse-hero-main">
          <p className="browse-kicker">
            <span>Research index</span>
            <span>Pakistan theatre</span>
          </p>
          <h1>Pakistan militant network index</h1>
          <p className="browse-deck">
            A working directory of organisations, leaders, fronts and their documented
            connections—built for tracing a name, testing a link and following the evidence.
          </p>
          <div className="browse-investigate">
            <label htmlFor="browse-investigate-input">Investigate an actor</label>
            <div>
              <input
                id="browse-investigate-input"
                type="search"
                value={investigationQuery}
                onChange={(event) => setInvestigationQuery(event.target.value)}
                placeholder="Try TTP, ISKP or Noor Wali Mehsud"
              />
              <button
                type="button"
                disabled={investigationMatches.length === 0}
                onClick={() => investigationMatches[0] && select(investigationMatches[0].id)}
              >
                Open dossier →
              </button>
            </div>
            {investigationQuery && (
              <div className="browse-investigate-results" aria-label="Matching actors">
                {investigationMatches.length ? investigationMatches.map((entity) => (
                  <button key={entity.id} type="button" onClick={() => select(entity.id)}>
                    <strong>{entity.short ?? entity.name}</strong>
                    <span>{[TYPE_LABEL[entity.type], entity.country, coverageLabel(entity)].filter(Boolean).join(" · ")}</span>
                  </button>
                )) : (
                  <p>No matching actor. Try an alias or browse the index below.</p>
                )}
              </div>
            )}
          </div>
          <div className="browse-actions">
            <a href="#record-directory">Browse {entities.length} records</a>
            {featured[0] && (
              <button type="button" onClick={() => select(featured[0].id)}>
                Open the TTP dossier <span aria-hidden="true">→</span>
              </button>
            )}
          </div>
        </div>
        <aside className="browse-brief" aria-label="Database coverage">
          <p className="browse-brief-label">At a glance</p>
          <dl>
            <div><dt>Indexed records</dt><dd>{entities.length}</dd></div>
            <div><dt>Sourced dossiers</dt><dd>{deepCount}</dd></div>
            <div><dt>Source links</dt><dd>{sources}</dd></div>
          </dl>
          <p>
            Basic records identify a known actor. Sourced dossiers add narrative,
            chronology, relationships and citations. Coverage is stated on every record.
          </p>
        </aside>
      </section>

      <section className="browse-section" aria-labelledby="featured-title">
        <div className="browse-section-head">
          <div>
            <p className="browse-eyebrow">Editor’s selection</p>
            <h2 id="featured-title">Selected dossiers</h2>
          </div>
          <p>Three useful entry points into the present Pakistan–Afghanistan militant landscape.</p>
        </div>
        <div className="featured-grid">
          {featured.map((ent, index) => (
            <button
              key={ent.id}
              type="button"
              onClick={() => select(ent.id)}
              className="featured-card"
              aria-label={`Open deep profile: ${ent.name}`}
            >
              <span className="featured-index" aria-hidden="true">0{index + 1}</span>
              <span className="featured-card-copy">
                <small>{[TYPE_LABEL[ent.type], ent.country, ent.status].filter(Boolean).join(" · ")}</small>
                <strong>{ent.name}</strong>
              </span>
              <span>{previewText(ent.summary) || "Open the sourced research profile."}</span>
              <span className="featured-open">View dossier <span aria-hidden="true">↗</span></span>
            </button>
          ))}
        </div>
      </section>

      <section id="record-directory" className="browse-section browse-directory" aria-labelledby="directory-title">
        <div className="browse-section-head">
          <div>
            <p className="browse-eyebrow">Research directory</p>
            <h2 id="directory-title">The index</h2>
          </div>
          <p>Search a name above, or narrow the working index by depth, record type and country.</p>
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
