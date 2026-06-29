import { lazy, Suspense, useEffect, useLayoutEffect, useState } from "react";
import type { EntityDataset } from "./types";
import { selectedEntity, useExplorer } from "./lib/store";
import { initRouter } from "./lib/router";
import TopBar from "./components/TopBar";
import EntityHeader from "./components/EntityHeader";
import Dossier from "./components/Dossier";
import Relationships from "./components/Relationships";
import Timeline from "./components/Timeline";
import AskPanel from "./components/AskPanel";
import Browse from "./components/Browse";

const MapPane = lazy(() => import("./components/MapPane"));

type MobilePane = "profile" | "network" | "timeline" | "map";

function LoadingPane() {
  return (
    <div className="grid h-full place-items-center border border-line-light bg-page-light text-meta text-muted-light dark:border-line-dark dark:bg-page-dark dark:text-muted-dark rounded-editorial">
      Loading map…
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydrate = useExplorer((s) => s.hydrate);
  const ent = useExplorer(selectedEntity);
  const entities = useExplorer((s) => s.entities);
  const askOpen = useExplorer((s) => s.askOpen);
  const toggleAsk = useExplorer((s) => s.toggleAsk);
  const [mobilePane, setMobilePane] = useState<MobilePane>("profile");
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 1024px)").matches);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && useExplorer.getState().askOpen) {
        toggleAsk(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleAsk]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    fetch(`${import.meta.env.BASE_URL}data/entities.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<EntityDataset>;
      })
      .then((data) => {
        hydrate(data.entities);
        cleanup = initRouter();
        setReady(true);
      })
      .catch((err) => setError(err.message));
    return () => { if (cleanup) cleanup(); };
  }, [hydrate]);

  useEffect(() => {
    setMobilePane("profile");
  }, [ent?.id]);

  useLayoutEffect(() => {
    // The browse directory can be several screens tall. A selected profile is
    // a new research view, so never inherit the directory's scroll position.
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [ent?.id]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  if (error) {
    return (
      <div className="grid place-items-center flex-1 p-6">
        <div className="max-w-md text-center">
          <p className="pane-label mb-2">Explorer failed to load</p>
          <p className="text-meta text-muted-light dark:text-muted-dark">{error}</p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="grid place-items-center flex-1">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-1.5">
            <span className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: "120ms" }} />
            <span className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: "240ms" }} />
          </div>
          <p className="pane-label">Loading entity database…</p>
        </div>
      </div>
    );
  }

  const inboundRelationships = ent
    ? entities.some((candidate) => (candidate.relationships ?? []).some((rel) => rel.to === ent.id))
    : false;
  const panes = ent
    ? {
        profile: true,
        network: (ent.relationships ?? []).length > 0 || inboundRelationships,
        timeline: (ent.events ?? []).length > 0 || (ent.attacks ?? []).length > 0,
        map:
          (ent.aor ?? []).some((point) => point.lat != null && point.lng != null) ||
          (ent.attacks ?? []).some((attack) => attack.lat != null && attack.lng != null) ||
          Boolean(ent.headquarters?.lat != null && ent.headquarters?.lng != null)
      }
    : null;
  const mobilePanes = panes
    ? ([
        ["profile", "Profile"],
        panes.network ? ["network", "Connections"] : null,
        panes.timeline ? ["timeline", "Events"] : null,
        panes.map ? ["map", "Map"] : null
      ].filter(Boolean) as [MobilePane, string][])
    : [];
  const paneCount = panes
    ? 1 + Number(panes.network) + Number(panes.timeline) + Number(panes.map)
    : 0;

  function renderPane(id: MobilePane) {
    if (id === "profile") return <Dossier />;
    if (id === "network") return <Relationships />;
    if (id === "timeline") return <Timeline />;
    return <Suspense fallback={<LoadingPane />}><MapPane /></Suspense>;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar />
      {!ent ? (
        <Browse />
      ) : (
        <>
          <EntityHeader />

          {!desktop ? (
            <>
              <nav className="mobile-pane-tabs" aria-label="Profile sections">
                {mobilePanes.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMobilePane(id)}
                    className={mobilePane === id ? "is-active" : ""}
                    aria-pressed={mobilePane === id}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <main className={`mobile-pane-stage ${mobilePane === "profile" ? "is-profile" : "is-visual"}`}>
                {renderPane(mobilePane)}
              </main>
            </>
          ) : (
            <main
              className="explorer-desktop-grid grid gap-3 p-3 flex-1 min-h-0 bg-paper2-light dark:bg-paper2-dark"
              style={{
                gridTemplateColumns: paneCount > 1 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)",
                gridTemplateRows: paneCount > 2 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)",
                minHeight: "640px"
              }}
            >
              <Dossier />
              {panes?.network && <Relationships />}
              {panes?.timeline && <Timeline />}
              {panes?.map && <Suspense fallback={<LoadingPane />}><MapPane /></Suspense>}
            </main>
          )}
        </>
      )}
      {askOpen && <AskPanel />}
    </div>
  );
}
