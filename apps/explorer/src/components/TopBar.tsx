import { useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import { useExplorer } from "../lib/store";
import type { Entity } from "../types";

const TYPE_LABEL: Record<string, string> = {
  organization: "Organisation",
  person: "Person",
  attack: "Attack",
  financing_entity: "Financing",
  front: "Front"
};

export default function TopBar() {
  const entities = useExplorer((s) => s.entities);
  const select = useExplorer((s) => s.select);
  const toggleAsk = useExplorer((s) => s.toggleAsk);
  const askOpen = useExplorer((s) => s.askOpen);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const fuse = useMemo(
    () =>
      new Fuse(entities, {
        keys: ["name", "short", "aliases", "summary"],
        threshold: 0.32,
        includeScore: false,
        minMatchCharLength: 2
      }),
    [entities]
  );

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return fuse.search(query).slice(0, 20).map((r) => r.item);
  }, [fuse, query]);

  // Group by entity type, max 5 per group.
  const grouped = useMemo(() => {
    const buckets: Record<string, Entity[]> = {};
    for (const e of results) {
      const k = e.type;
      buckets[k] = buckets[k] || [];
      if (buckets[k].length < 5) buckets[k].push(e);
    }
    return Object.entries(buckets);
  }, [results]);

  const flat = useMemo(() => grouped.flatMap(([, list]) => list), [grouped]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function pick(e: Entity) {
    select(e.id);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (flat[highlight]) pick(flat[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <header className="relative flex items-center gap-3 px-4 h-16 border-b-hair border-line-light dark:border-line-dark bg-surface-light dark:bg-surface-dark shrink-0">
      <a href="/" className="flex items-center gap-2 shrink-0" aria-label="TGD home">
        <span className="font-mono text-[10px] tracking-[0.18em] text-muted-light dark:text-muted-dark">THE GLOBAL DECIPHER</span>
      </a>
      <span className="text-line-light dark:text-line-dark">/</span>
      <span className="entity-name text-[15px]">Explorer</span>

      <div className="relative ml-6 flex-1 max-w-xl">
        <input
          ref={inputRef}
          type="search"
          spellCheck={false}
          placeholder="Search organisations, people, attacks…    ⌘K"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
          className="w-full bg-transparent border-hair border-line-light dark:border-line-dark px-3 h-9 text-meta placeholder:text-dim-light dark:placeholder:text-dim-dark focus:outline-none focus:border-accent"
        />
        {open && flat.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-surface-light dark:bg-surface-dark border-hair border-line-light dark:border-line-dark z-30 shadow-sm max-h-[60vh] overflow-auto">
            {grouped.map(([type, list]) => (
              <div key={type}>
                <div className="pane-label px-3 pt-2 pb-1">{TYPE_LABEL[type] ?? type}</div>
                {list.map((e) => {
                  const idx = flat.indexOf(e);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onMouseDown={() => pick(e)}
                      onMouseEnter={() => setHighlight(idx)}
                      className={
                        "w-full text-left px-3 py-2 grid grid-cols-[1fr_auto] gap-3 items-center " +
                        (idx === highlight
                          ? "bg-page-light dark:bg-page-dark"
                          : "")
                      }
                    >
                      <div>
                        <div className="entity-name text-meta">{e.name}</div>
                        {e.aliases && e.aliases.length > 0 && (
                          <div className="text-[11px] text-muted-light dark:text-muted-dark truncate">
                            {e.aliases.slice(0, 3).join(" · ")}
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] uppercase tracking-eyebrow text-dim-light dark:text-dim-dark">
                        {e.country ?? e.region ?? ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => toggleAsk()}
          className={
            "h-9 px-3 text-meta border-hair font-medium tracking-[0.02em] " +
            (askOpen
              ? "bg-accent text-white border-accent"
              : "border-line-light dark:border-line-dark text-accent hover:bg-page-light dark:hover:bg-page-dark")
          }
          aria-pressed={askOpen}
        >
          Ask the database ↗
        </button>
      </div>
    </header>
  );
}
