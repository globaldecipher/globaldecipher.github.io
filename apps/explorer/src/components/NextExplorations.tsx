import { useMemo } from "react";
import { selectedEntity, useExplorer } from "../lib/store";
import type { Entity } from "../types";

const ENTITY_ID_ALIASES: Record<string, string> = {
  "al-qaeda": "org-al-qaeda",
  "islamic-state": "org-islamic-state"
};

export default function NextExplorations() {
  const ent = useExplorer(selectedEntity);
  const byId = useExplorer((state) => state.byId);
  const select = useExplorer((state) => state.select);
  const setResearchMode = useExplorer((state) => state.setResearchMode);
  const setCompareId = useExplorer((state) => state.setCompareId);
  const setPathTargetId = useExplorer((state) => state.setPathTargetId);

  const related = useMemo(() => {
    if (!ent) return [] as Entity[];
    const ids: string[] = [];
    for (const relationship of ent.relationships ?? []) {
      ids.push(ENTITY_ID_ALIASES[relationship.to] ?? relationship.to);
    }
    for (const candidate of byId.values()) {
      if ((candidate.relationships ?? []).some((relationship) => relationship.to === ent.id)) {
        ids.push(candidate.id);
      }
    }
    return [...new Set(ids)]
      .map((id) => byId.get(id))
      .filter((entity): entity is Entity => Boolean(entity))
      .sort((left, right) => Number(Boolean(left.stub)) - Number(Boolean(right.stub)) || left.name.localeCompare(right.name))
      .slice(0, 4);
  }, [byId, ent]);

  if (!ent) return null;
  const first = related[0] ?? null;
  const second = related[1] ?? first;

  function showMode(mode: "compare" | "path", target: Entity | null) {
    if (!target) return;
    setResearchMode(mode);
    if (mode === "compare") setCompareId(target.id);
    else setPathTargetId(target.id);
    setTimeout(() => document.querySelector(".investigation-tools")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function showSources() {
    window.dispatchEvent(new CustomEvent("tgd:dossier-tab", { detail: "sources" }));
    document.getElementById("explorer-profile")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="next-explorations print-hidden" aria-labelledby="next-explorations-title">
      <header>
        <p className="browse-eyebrow">Keep investigating</p>
        <h2 id="next-explorations-title">Useful next steps from {ent.short ?? ent.name}</h2>
      </header>
      <div>
        {first && (
          <button type="button" onClick={() => select(first.id)}>
            <span>Open connected actor</span>
            <strong>{first.name}</strong>
            <small>Continue into its dossier →</small>
          </button>
        )}
        {first && (
          <button type="button" onClick={() => showMode("compare", first)}>
            <span>Compare</span>
            <strong>{ent.short ?? ent.name} vs {first.short ?? first.name}</strong>
            <small>See shared and contrasting evidence →</small>
          </button>
        )}
        {second && (
          <button type="button" onClick={() => showMode("path", second)}>
            <span>Trace connection</span>
            <strong>Route to {second.short ?? second.name}</strong>
            <small>Follow the documented path →</small>
          </button>
        )}
        {(ent.sources ?? []).length > 0 && (
          <button type="button" onClick={showSources}>
            <span>Review evidence</span>
            <strong>{ent.sources!.length} profile sources</strong>
            <small>Inspect the underlying records →</small>
          </button>
        )}
      </div>
    </section>
  );
}
