// Hash routing: /network-graph/#iskp — no Worker route changes required, and
// browser back/forward works naturally. The hash always wins over the
// in-app `selectedId`, so the URL is the source of truth.

import { useExplorer } from "./store";

const PREFIX = "#";

function readHash(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.replace(/^#/, "").trim();
  return raw ? decodeURIComponent(raw) : null;
}

function writeHash(id: string | null) {
  const target = id ? `${PREFIX}${encodeURIComponent(id)}` : "";
  const current = window.location.hash;
  if (current === target) return;
  if (id) {
    history.pushState(null, "", target || window.location.pathname);
  } else {
    history.pushState(null, "", window.location.pathname);
  }
}

export function initRouter() {
  if (typeof window === "undefined") return () => {};
  const { byId, select, setResearchMode, setCompareId, setPathTargetId } = useExplorer.getState();
  // A valid hash opens a record directly. Without a hash, show the browse
  // screen so first-time visitors can understand the database before choosing.
  const fromHash = readHash();
  const initial = fromHash && byId.has(fromHash) ? fromHash : null;
  select(initial);
  if (initial) {
    const params = new URLSearchParams(window.location.search);
    const compare = params.get("compare");
    const path = params.get("path");
    if (compare && compare !== initial && byId.has(compare)) {
      setCompareId(compare);
      setResearchMode("compare");
    } else if (path && path !== initial && byId.has(path)) {
      setPathTargetId(path);
      setResearchMode("path");
    }
  }

  // React to back/forward.
  const onPop = () => {
    const id = readHash();
    if (id && useExplorer.getState().byId.has(id)) {
      useExplorer.getState().select(id);
    } else if (!id) {
      useExplorer.getState().select(null);
    }
  };
  window.addEventListener("popstate", onPop);

  // Mirror in-app selection changes to the URL.
  const unsub = useExplorer.subscribe((state, prev) => {
    if (state.selectedId !== prev.selectedId) writeHash(state.selectedId);
  });

  return () => {
    window.removeEventListener("popstate", onPop);
    unsub();
  };
}
