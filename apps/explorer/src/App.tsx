import { useEffect, useState } from "react";
import type { EntityDataset } from "./types";
import { useExplorer } from "./lib/store";
import { initRouter } from "./lib/router";
import TopBar from "./components/TopBar";
import EntityHeader from "./components/EntityHeader";
import Dossier from "./components/Dossier";
import Relationships from "./components/Relationships";
import Timeline from "./components/Timeline";
import MapPane from "./components/MapPane";
import AskPanel from "./components/AskPanel";

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydrate = useExplorer((s) => s.hydrate);
  const askOpen = useExplorer((s) => s.askOpen);
  const toggleAsk = useExplorer((s) => s.toggleAsk);

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

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar />
      <EntityHeader />
      <main
        className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 flex-1 min-h-0"
        style={{ gridTemplateRows: "repeat(2, minmax(0, 1fr))", minHeight: "640px" }}
      >
        <Dossier />
        <Relationships />
        <Timeline />
        <MapPane />
      </main>
      {askOpen && <AskPanel />}
    </div>
  );
}
