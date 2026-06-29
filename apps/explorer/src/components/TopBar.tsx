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
  const selectedId = useExplorer((s) => s.selectedId);
  const selected = useExplorer((s) => (s.selectedId ? s.byId.get(s.selectedId) ?? null : null));
  const select = useExplorer((s) => s.select);
  const toggleAsk = useExplorer((s) => s.toggleAsk);
  const askOpen = useExplorer((s) => s.askOpen);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">(
    () => document.documentElement.dataset.theme === "dark" ? "dark" : "light"
  );
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
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
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

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.dataset.theme = next;
    document.getElementById("theme-color-meta")?.setAttribute("content", next === "dark" ? "#0f1318" : "#f7f5ef");
    try {
      window.localStorage.setItem("tgd-theme", next);
    } catch {
      // The visible theme still changes when storage is unavailable.
    }
    setTheme(next);
  }

  return (
    <header className="explorer-topbar">
      <div className="flex min-w-0 items-center gap-3 shrink-0">
        <a href="/" className="brand-link" aria-label="The Global Decipher home">
          <span className="sm:hidden">TGD</span>
          <span className="hidden sm:inline">THE GLOBAL DECIPHER</span>
        </a>
        <span className="text-line-light dark:text-line-dark select-none" aria-hidden="true">/</span>
        <button
          type="button"
          onClick={() => select(null)}
          className="entity-name text-[17px] hover:text-accent"
          aria-current={selectedId ? undefined : "page"}
        >
          Explorer
        </button>
      </div>

      <nav className="site-links" aria-label="TGD sections">
        <a href="/news/">News</a>
        <a href="/opinion/">Opinion</a>
        <a href="/monitoring/">Monitoring</a>
        <a href="/incident-map/">Incident Map</a>
        <a href="/reports/">Reports</a>
        <a href="/profiles/">Profiles</a>
      </nav>

      <div className="explorer-search">
        <input
          ref={inputRef}
          type="search"
          spellCheck={false}
          placeholder="Search organisations and people…    ⌘K"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
          className="w-full bg-transparent border border-line-light dark:border-line-dark rounded-editorial px-4 h-10 text-[0.88rem] placeholder:text-dim-light dark:placeholder:text-dim-dark focus:outline-none focus:border-accent"
        />
        {open && flat.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-page-light dark:bg-page-dark border border-line-light dark:border-line-dark rounded-editorial z-30 shadow-editorial-md max-h-[60vh] overflow-auto">
            {grouped.map(([type, list]) => (
              <div key={type}>
                <div className="pane-label px-4 pt-3 pb-1">{TYPE_LABEL[type] ?? type}</div>
                {list.map((e) => {
                  const idx = flat.indexOf(e);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onMouseDown={() => pick(e)}
                      onMouseEnter={() => setHighlight(idx)}
                      className={
                        "w-full text-left px-4 py-2.5 grid grid-cols-[1fr_auto] gap-3 items-center " +
                        (idx === highlight
                          ? "bg-paper2-light dark:bg-paper2-dark"
                          : "")
                      }
                    >
                      <div>
                        <div className="entity-name text-[0.92rem]">{e.name}</div>
                        {e.aliases && e.aliases.length > 0 && (
                          <div className="text-[0.72rem] text-muted-light dark:text-muted-dark truncate">
                            {e.aliases.slice(0, 3).join(" · ")}
                          </div>
                        )}
                      </div>
                      <span className="text-[0.68rem] uppercase tracking-eyebrow text-dim-light dark:text-dim-dark font-mono">
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
          onClick={toggleTheme}
          className="theme-switch"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3.5" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15Z" />
            </svg>
          )}
          <span>{theme === "dark" ? "Light" : "Dark"}</span>
        </button>
        {selected && !selected.stub && (
          <button
            type="button"
            onClick={() => toggleAsk()}
            className={
              "topbar-action " +
              (askOpen
                ? "bg-accent text-white border-accent"
                : "border-line-light dark:border-line-dark text-accent hover:bg-page-light dark:hover:bg-page-dark")
            }
            aria-pressed={askOpen}
          >
            <span className="hidden sm:inline">Ask the database</span>
            <span className="sm:hidden">Ask AI</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          className="topbar-action xl:hidden"
          aria-expanded={menuOpen}
          aria-controls="explorer-site-menu"
        >
          {menuOpen ? "✕" : "Menu"}
        </button>
      </div>

      {menuOpen && (
        <nav id="explorer-site-menu" className="mobile-site-menu" aria-label="TGD sections">
          <a href="/news/">News</a>
          <a href="/opinion/">Opinion</a>
          <a href="/monitoring/">Monitoring</a>
          <a href="/incident-map/">Incident Map</a>
          <a href="/reports/">Reports</a>
          <a href="/profiles/">Profiles</a>
          <a href="/contact/">Contact</a>
        </nav>
      )}
    </header>
  );
}
