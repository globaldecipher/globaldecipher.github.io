import { useEffect, useMemo, useRef, useState } from "react";
import { useExplorer } from "../lib/store";
import type { Entity } from "../types";
import EntityPicker from "./EntityPicker";
import {
  buildEntitySearchIndex,
  coverageLabel,
  createEntitySearch,
  searchEntityIndex,
  TYPE_LABEL
} from "../lib/entitySearch";

type CoverageFilter = "all" | "deep" | "basic";
type TypeFilter = "all" | Entity["type"];
type StartMode = "find" | "compare" | "path" | "browse";

const FEATURED_IDS = [
  "tehreek-e-taliban-pakistan",
  "iskp",
  "sanaullah-ghafari"
];

const BROWSE_STATE_KEY = "tgd-explorer-browse-state";

interface BrowseState {
  coverage: CoverageFilter;
  type: TypeFilter;
  country: string;
  query: string;
}

function savedBrowseState(): BrowseState {
  const fallback: BrowseState = { coverage: "all", type: "all", country: "all", query: "" };
  try {
    return { ...fallback, ...JSON.parse(window.sessionStorage.getItem(BROWSE_STATE_KEY) ?? "{}") };
  } catch {
    return fallback;
  }
}

function previewText(value = "") {
  return value.replace(/\s*\[(?:src-[a-z0-9-]+|\d+)\]/gi, "").replace(/\s+/g, " ").trim();
}

export default function Browse() {
  const entities = useExplorer((s) => s.entities);
  const byId = useExplorer((s) => s.byId);
  const recentIds = useExplorer((s) => s.recentIds);
  const select = useExplorer((s) => s.select);
  const setResearchMode = useExplorer((s) => s.setResearchMode);
  const setCompareId = useExplorer((s) => s.setCompareId);
  const setPathTargetId = useExplorer((s) => s.setPathTargetId);
  const initialState = useMemo(savedBrowseState, []);
  const [coverage, setCoverage] = useState<CoverageFilter>(initialState.coverage);
  const [type, setType] = useState<TypeFilter>(initialState.type);
  const [country, setCountry] = useState(initialState.country);
  const [investigationQuery, setInvestigationQuery] = useState(initialState.query);
  const [startMode, setStartMode] = useState<StartMode>("find");
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [secondaryId, setSecondaryId] = useState<string | null>(null);
  const investigateRef = useRef<HTMLInputElement | null>(null);

  const deepCount = entities.filter((e) => !e.stub).length;
  const sources = new Set(entities.flatMap((e) => (e.sources ?? []).map((s) => s.url || s.id))).size;
  const countries = useMemo(
    () => [...new Set(entities.map((e) => e.country).filter(Boolean) as string[])].sort(),
    [entities]
  );
  const featured = FEATURED_IDS
    .map((id) => entities.find((e) => e.id === id))
    .filter(Boolean) as Entity[];
  const searchIndex = useMemo(() => buildEntitySearchIndex(entities, byId), [byId, entities]);
  const search = useMemo(() => createEntitySearch(searchIndex), [searchIndex]);
  const investigationMatches = useMemo(() => {
    if (!investigationQuery.trim()) {
      return featured.slice(0, 3).map((entity) => ({ entity, reason: "Suggested deep profile" }));
    }
    return searchEntityIndex(search, investigationQuery, 8);
  }, [featured, investigationQuery, search]);
  const queryMatches = useMemo(
    () => new Set(searchEntityIndex(search, investigationQuery, entities.length).map(({ entity }) => entity.id)),
    [entities.length, investigationQuery, search]
  );

  const filtered = useMemo(
    () =>
      entities
        .filter((e) => investigationQuery.trim().length < 2 || queryMatches.has(e.id))
        .filter((e) => coverage === "all" || (coverage === "deep" ? !e.stub : e.stub))
        .filter((e) => type === "all" || e.type === type)
        .filter((e) => country === "all" || e.country === country)
        .sort((a, b) => Number(Boolean(a.stub)) - Number(Boolean(b.stub)) || a.name.localeCompare(b.name)),
    [entities, investigationQuery, queryMatches, coverage, type, country]
  );
  const recent = recentIds.map((id) => byId.get(id)).filter(Boolean).slice(0, 4) as Entity[];

  useEffect(() => {
    window.sessionStorage.setItem(BROWSE_STATE_KEY, JSON.stringify({
      coverage,
      type,
      country,
      query: investigationQuery
    }));
  }, [country, coverage, investigationQuery, type]);

  function chooseStartMode(mode: StartMode) {
    setStartMode(mode);
    setPrimaryId(null);
    setSecondaryId(null);
    if (mode === "find") {
      setTimeout(() => investigateRef.current?.focus(), 0);
    }
    if (mode === "browse") {
      setTimeout(() => document.getElementById("record-directory")?.scrollIntoView({ behavior: "smooth" }), 0);
    }
  }

  function openGuidedView() {
    if (!primaryId || !secondaryId) return;
    select(primaryId);
    if (startMode === "compare") {
      setResearchMode("compare");
      setCompareId(secondaryId);
    } else {
      setResearchMode("path");
      setPathTargetId(secondaryId);
    }
  }

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
          <div className="browse-pathways" aria-label="Choose how to explore">
            {([
              ["find", "Find an actor", "Search names, aliases and leaders"],
              ["compare", "Compare two actors", "See differences and shared links"],
              ["path", "Trace a connection", "Follow a documented route"],
              ["browse", "Browse the index", `Filter all ${entities.length} records`]
            ] as const).map(([id, label, note]) => (
              <button
                key={id}
                type="button"
                className={startMode === id ? "is-active" : ""}
                onClick={() => chooseStartMode(id)}
              >
                <span>{label}</span>
                <small>{note}</small>
              </button>
            ))}
          </div>
          {(startMode === "compare" || startMode === "path") && (
            <div className="browse-pathway-builder">
              <div>
                <EntityPicker
                  label="Starting actor"
                  value={primaryId}
                  onChange={setPrimaryId}
                  excludeId={secondaryId}
                />
                <span aria-hidden="true">{startMode === "compare" ? "vs" : "→"}</span>
                <EntityPicker
                  label={startMode === "compare" ? "Comparison actor" : "Destination actor"}
                  value={secondaryId}
                  onChange={setSecondaryId}
                  excludeId={primaryId}
                />
              </div>
              <button type="button" disabled={!primaryId || !secondaryId} onClick={openGuidedView}>
                {startMode === "compare" ? "Open comparison" : "Trace this connection"} →
              </button>
            </div>
          )}
          <div className="browse-investigate">
            <label htmlFor="browse-investigate-input">Investigate an actor</label>
            <div>
              <input
                ref={investigateRef}
                id="browse-investigate-input"
                type="search"
                value={investigationQuery}
                onChange={(event) => setInvestigationQuery(event.target.value)}
                placeholder="Try TTP, ISKP or Noor Wali Mehsud"
              />
              <button
                type="button"
                disabled={investigationMatches.length === 0}
                onClick={() => investigationMatches[0] && select(investigationMatches[0].entity.id)}
              >
                Open dossier →
              </button>
            </div>
            {investigationQuery && (
              <div className="browse-investigate-results" aria-label="Matching actors">
                {investigationMatches.length ? investigationMatches.map(({ entity, reason }) => (
                  <button key={entity.id} type="button" onClick={() => select(entity.id)}>
                    <span>
                      <strong>{entity.short ?? entity.name}</strong>
                      <small>{reason}</small>
                    </span>
                    <em>{[TYPE_LABEL[entity.type], entity.country, coverageLabel(entity)].filter(Boolean).join(" · ")}</em>
                  </button>
                )) : (
                  <div className="browse-no-results">
                    <strong>No matching record</strong>
                    <span>Try an alias, leader, country, designation or shorter phrase.</span>
                    <button type="button" onClick={() => {
                      setInvestigationQuery("");
                      chooseStartMode("browse");
                    }}>
                      Browse the full index →
                    </button>
                  </div>
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
          {recent.length > 0 && (
            <div className="browse-recent">
              <span>Recently viewed</span>
              {recent.map((entity) => (
                <button key={entity.id} type="button" onClick={() => select(entity.id)}>
                  <strong>{entity.short ?? entity.name}</strong>
                  <small>{entity.country ?? entity.region ?? TYPE_LABEL[entity.type]}</small>
                </button>
              ))}
            </div>
          )}
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
          {filtered.length > 0 ? filtered.map((ent) => (
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
          )) : (
            <div className="directory-empty">
              <strong>No records match this combination.</strong>
              <span>Clear the search or reset the filters to reopen the full directory.</span>
              <button type="button" onClick={() => {
                setInvestigationQuery("");
                setCoverage("all");
                setType("all");
                setCountry("all");
              }}>
                Reset search and filters
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
