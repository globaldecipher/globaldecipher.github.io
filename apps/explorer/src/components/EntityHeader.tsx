import { useExplorer, selectedEntity } from "../lib/store";
import type { Entity } from "../types";
import ProfileActions from "./ProfileActions";

function initials(name: string): string {
  return name
    .replace(/[()]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

function typeAccent(t: Entity["type"]): { bg: string; ring: string; label: string } {
  switch (t) {
    case "person":            return { bg: "bg-violet",       ring: "ring-violet/40",        label: "Person" };
    case "attack":            return { bg: "bg-danger",       ring: "ring-danger/40",        label: "Attack" };
    case "financing_entity":  return { bg: "bg-warning",      ring: "ring-warning/40",       label: "Financing" };
    case "front":             return { bg: "bg-muted-light",  ring: "ring-muted-light/40",   label: "Front" };
    default:                  return { bg: "bg-accent",       ring: "ring-accent/40",        label: "Organisation" };
  }
}

function subtitle(e: Entity): string {
  const bits: string[] = [];
  if (e.status) bits.push(e.status[0].toUpperCase() + e.status.slice(1));
  if (e.founded) bits.push(`Founded ${e.founded.slice(0, 4)}`);
  if (e.dissolved) bits.push(`Dissolved ${e.dissolved.slice(0, 4)}`);
  if (e.ideology) bits.push(e.ideology);
  if (e.country) bits.push(e.country);
  return bits.join(" · ");
}

interface Stat { value: number | string; label: string; mute?: boolean }

function buildStats(e: Entity, relationshipCount: number): Stat[] {
  const countries = new Set<string>([...(e.countries ?? []), ...(e.aor ?? []).map((a) => a.label).filter(Boolean) as string[]]);
  const designations = (e.designations ?? []).length;
  const leaders = (e.leaders ?? []).length;
  const attacks = (e.attacks ?? []).length;
  const casualties = (e.attacks ?? []).reduce((sum, a) => sum + (a.casualties ?? 0), 0);
  return [
    { value: attacks || "—", label: "Attacks" },
    { value: casualties ? casualties.toLocaleString() : "—", label: "Casualties" },
    { value: leaders || "—", label: "Leaders" },
    { value: designations || "—", label: "Designations" },
    { value: countries.size || "—", label: "Countries" },
    { value: relationshipCount || "—", label: "Relations" }
  ];
}

export default function EntityHeader() {
  const ent = useExplorer(selectedEntity);
  const byId = useExplorer((state) => state.byId);

  if (!ent) {
    return (
      <div className="px-5 py-4 border-b border-line-light dark:border-line-dark bg-page-light dark:bg-page-dark shrink-0">
        <p className="pane-label">No entity selected. Use the search bar above or press ⌘K.</p>
      </div>
    );
  }
  const accent = typeAccent(ent.type);
  const inboundRelationshipCount = [...byId.values()].reduce(
    (count, candidate) =>
      count + (candidate.relationships ?? []).filter((relationship) => relationship.to === ent.id).length,
    0
  );
  const stats = buildStats(ent, (ent.relationships ?? []).length + inboundRelationshipCount);

  return (
    <section className="explorer-profile-header shrink-0 bg-page-light dark:bg-page-dark border-b border-line-light dark:border-line-dark" aria-labelledby="entity-title">
      <div className="entity-header-main">
        <div
          className={`grid place-items-center h-12 w-12 sm:h-14 sm:w-14 rounded-editorial ${accent.bg} text-white font-bold text-[14px] shrink-0 ring-2 ${accent.ring}`}
          aria-hidden="true"
        >
          {initials(ent.short ?? ent.name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
            <span className="pane-label">{accent.label}</span>
            <span className={`coverage-badge ${ent.stub ? "coverage-basic" : "coverage-deep"}`}>
              {ent.stub ? "Basic record" : "Deep profile"}
            </span>
          </div>
          <h1 id="entity-title" className="entity-name text-[22px] sm:text-[26px] leading-tight mt-0.5" title={ent.name}>
            {ent.name}
          </h1>
          <div className="text-meta text-muted-light dark:text-muted-dark mt-0.5">
            {subtitle(ent)}
          </div>
          {ent.aliases && ent.aliases.length > 0 && (
            <div className="text-[11px] text-dim-light dark:text-dim-dark mt-0.5 truncate">
              Also: {ent.aliases.slice(0, 6).join(" · ")}
            </div>
          )}
        </div>

        <div className="entity-header-actions">
          <div className="designation-list">
            {(ent.designations ?? []).slice(0, 8).map((d, i) => (
              <span
                key={i}
                className="px-1.5 h-6 inline-flex items-center gap-1 text-[10px] uppercase tracking-eyebrow border-hair border-line-light dark:border-line-dark text-ink-light dark:text-ink-dark"
                title={[d.body.replace(/_/g, " "), d.ref, d.date].filter(Boolean).join(" · ")}
              >
                {d.body.replace(/_/g, " ")}
                {d.ref && <span className="text-muted-light dark:text-muted-dark font-normal normal-case tracking-normal text-[10px]">{d.ref.slice(0, 8)}</span>}
              </span>
            ))}
          </div>
          <ProfileActions ent={ent} />
        </div>
      </div>

      {ent.stub && (
        <p className="basic-record-note">
          Basic records contain verified index facts and designation context. Empty research panels are hidden until deeper sourcing is complete.
        </p>
      )}

      <div className="entity-stats">
        {stats.map((s, i) => (
          <div
            key={i}
            className="px-3 sm:px-5 py-2 border-r-hair border-line-light dark:border-line-dark last:border-r-0"
          >
            <div className="entity-name text-[22px] leading-none">{s.value}</div>
            <div className="pane-label mt-1">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
