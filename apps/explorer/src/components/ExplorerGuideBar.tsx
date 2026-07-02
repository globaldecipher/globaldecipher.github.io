import { useEffect, useMemo, useState } from "react";
import { selectedEntity, useExplorer } from "../lib/store";

const SECTION_IDS = [
  ["explorer-profile", "Overview"],
  ["explorer-connections", "Connections"],
  ["explorer-events", "Events"],
  ["explorer-map", "Map"]
] as const;

export default function ExplorerGuideBar() {
  const ent = useExplorer(selectedEntity);
  const byId = useExplorer((state) => state.byId);
  const select = useExplorer((state) => state.select);
  const recentIds = useExplorer((state) => state.recentIds);
  const [active, setActive] = useState("explorer-profile");
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const inboundRelationships = useMemo(
    () => ent
      ? [...byId.values()].some((candidate) =>
          (candidate.relationships ?? []).some((relationship) => relationship.to === ent.id)
        )
      : false,
    [byId, ent]
  );
  const available = useMemo(() => {
    if (!ent) return [];
    return SECTION_IDS.filter(([id]) => {
      if (id === "explorer-connections") {
        return (ent.relationships ?? []).length > 0 || inboundRelationships;
      }
      if (id === "explorer-events") {
        return (ent.events ?? []).length > 0 || (ent.attacks ?? []).length > 0;
      }
      if (id === "explorer-map") {
        return (ent.aor ?? []).length > 0 || (ent.attacks ?? []).some((attack) => attack.lat && attack.lng) || Boolean(ent.headquarters);
      }
      return true;
    });
  }, [ent, inboundRelationships]);
  const recent = recentIds
    .filter((id) => id !== ent?.id)
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, 3);

  useEffect(() => {
    const update = () => {
      const visible = available
        .map(([id]) => ({ id, top: document.getElementById(id)?.getBoundingClientRect().top ?? Infinity }))
        .filter((item) => Number.isFinite(item.top))
        .sort((left, right) => Math.abs(left.top - 230) - Math.abs(right.top - 230))[0];
      if (visible) setActive(visible.id);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    document.body.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      document.body.removeEventListener("scroll", update);
    };
  }, [available]);

  if (!ent) return null;

  function goTo(id: string) {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openSources() {
    window.dispatchEvent(new CustomEvent("tgd:dossier-tab", { detail: "sources" }));
    goTo("explorer-profile");
  }

  return (
    <>
      <nav className="explorer-guide-bar print-hidden" aria-label="Explore this dossier">
        <button type="button" className="explorer-back-results" onClick={() => select(null)}>
          ← Back to results
        </button>
        <div className="explorer-section-links">
          {available.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={active === id ? "is-active" : ""}
              onClick={() => goTo(id)}
              aria-current={active === id ? "location" : undefined}
            >
              {label}
            </button>
          ))}
          {(ent.sources ?? []).length > 0 && (
            <button type="button" onClick={openSources}>
              Sources <span>{ent.sources!.length}</span>
            </button>
          )}
        </div>
        <div className="explorer-guide-actions">
          {recent.length > 0 && (
            <div className="explorer-recent-inline">
              <span>Recent</span>
              {recent.map((entity) => entity && (
                <button key={entity.id} type="button" onClick={() => select(entity.id)}>
                  {entity.short ?? entity.name}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="evidence-guide-button" onClick={() => setEvidenceOpen(true)}>
            How evidence works
          </button>
        </div>
      </nav>

      {evidenceOpen && (
        <div className="evidence-guide-backdrop" onMouseDown={() => setEvidenceOpen(false)}>
          <section
            className="evidence-guide-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="evidence-guide-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="browse-eyebrow">Reading the Explorer</p>
            <h2 id="evidence-guide-title">What the evidence labels mean</h2>
            <dl>
              <div>
                <dt>Deep profile</dt>
                <dd>A sourced dossier with narrative, chronology, relationships and citations.</dd>
              </div>
              <div>
                <dt>Basic record</dt>
                <dd>A verified index entry. It may identify an actor without a complete research narrative.</dd>
              </div>
              <div>
                <dt>Documented connection</dt>
                <dd>A relationship recorded in TGD’s dataset. It does not by itself prove current operational coordination.</dd>
              </div>
              <div>
                <dt>Evidence pending</dt>
                <dd>The relationship is indexed, but a direct public citation has not yet been attached to that specific claim.</dd>
              </div>
            </dl>
            <p>
              This profile currently contains <strong>{(ent.sources ?? []).length} source links</strong>.
              Open citations and source records before relying on a claim for publication.
            </p>
            <button type="button" onClick={() => setEvidenceOpen(false)}>Close guide</button>
          </section>
        </div>
      )}
    </>
  );
}
