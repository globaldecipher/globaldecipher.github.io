import { create } from "zustand";
import type { Entity, RelationshipType } from "../types";

type RelFilter = "all" | "splits" | "alliances" | "rivals" | "financing" | "ideological";

interface ExplorerState {
  entities: Entity[];
  byId: Map<string, Entity>;
  selectedId: string | null;
  relFilter: RelFilter;
  timeWindow: { center: string; deltaDays: number } | null;
  askOpen: boolean;

  hydrate: (entities: Entity[]) => void;
  select: (id: string | null) => void;
  setRelFilter: (f: RelFilter) => void;
  setTimeWindow: (center: string | null, deltaDays?: number) => void;
  toggleAsk: (open?: boolean) => void;
}

export const useExplorer = create<ExplorerState>((set) => ({
  entities: [],
  byId: new Map(),
  selectedId: null,
  relFilter: "all",
  timeWindow: null,
  askOpen: false,

  hydrate: (entities) => {
    const byId = new Map<string, Entity>();
    for (const e of entities) byId.set(e.id, e);
    set({ entities, byId });
  },
  select: (id) => set({ selectedId: id, timeWindow: null }),
  setRelFilter: (f) => set({ relFilter: f }),
  setTimeWindow: (center, deltaDays = 90) =>
    set({ timeWindow: center ? { center, deltaDays } : null }),
  toggleAsk: (open) => set((s) => ({ askOpen: typeof open === "boolean" ? open : !s.askOpen }))
}));

export function selectedEntity(state: ExplorerState): Entity | null {
  return state.selectedId ? state.byId.get(state.selectedId) ?? null : null;
}

export function relFilterAllows(type: RelationshipType, filter: RelFilter): boolean {
  if (filter === "all") return true;
  if (filter === "splits") return type === "split-from" || type === "successor";
  if (filter === "alliances") return type === "allied" || type === "parent" || type === "member-of";
  if (filter === "rivals") return type === "rival";
  if (filter === "financing") return type === "financed-by";
  if (filter === "ideological") return type === "ideological-link";
  return true;
}

/** Bidirectional neighbour walker. */
export function neighborhood(byId: Map<string, Entity>, rootId: string, depth = 1): Set<string> {
  const out = new Set<string>([rootId]);
  let frontier = new Set<string>([rootId]);
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const id of frontier) {
      const node = byId.get(id);
      if (!node) continue;
      for (const r of node.relationships ?? []) {
        if (!out.has(r.to)) next.add(r.to);
      }
      // Walk inbound edges
      for (const other of byId.values()) {
        for (const r of other.relationships ?? []) {
          if (r.to === id && !out.has(other.id)) next.add(other.id);
        }
      }
    }
    for (const id of next) out.add(id);
    frontier = next;
  }
  return out;
}
