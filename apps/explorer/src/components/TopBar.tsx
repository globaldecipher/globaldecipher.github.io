import { useEffect, useMemo, useRef, useState } from "react";
import { useExplorer } from "../lib/store";
import {
  buildEntitySearchIndex,
  coverageLabel,
  createEntitySearch,
  type EntitySearchResult,
  searchEntityIndex,
  TYPE_LABEL
} from "../lib/entitySearch";

export default function TopBar() {
  const entities = useExplorer((s) => s.entities);
  const selected = useExplorer((s) => (s.selectedId ? s.byId.get(s.selectedId) ?? null : null));
  const byId = useExplorer((s) => s.byId);
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

  const todayLabel = useMemo(
    () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    []
  );

  const index = useMemo(() => buildEntitySearchIndex(entities, byId), [byId, entities]);
  const search = useMemo(() => createEntitySearch(index), [index]);

  const results = useMemo(() => {
    return searchEntityIndex(search, query, 20);
  }, [query, search]);

  // Group by entity type, max 5 per group.
  const grouped = useMemo(() => {
    const buckets: Record<string, EntitySearchResult[]> = {};
    for (const result of results) {
      const k = result.entity.type;
      buckets[k] = buckets[k] || [];
      if (buckets[k].length < 5) buckets[k].push(result);
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

  useEffect(() => {
    setQuery("");
    setOpen(false);
  }, [selected?.id]);

  function pick(result: EntitySearchResult) {
    select(result.entity.id);
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
    <header className="explorer-shell">
      <div className="explorer-header-stack">
        <div className="explorer-header-utility">
          <button
            type="button"
            onClick={toggleTheme}
            className="header-icon-button"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`${theme === "dark" ? "Light" : "Dark"} mode`}
          >
            {theme === "dark" ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 12.8A8.7 8.7 0 1 1 11.2 3a6.8 6.8 0 0 0 9.8 9.8Z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              inputRef.current?.focus();
              setOpen(true);
            }}
            className="header-icon-button"
            aria-label="Search Explorer database"
            title="Search Explorer database"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </button>
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

        <a href="/" className="brand-link explorer-brand-center" aria-label="The Global Decipher home">
          <span className="explorer-brand-picture">
            <img
              className="explorer-brand-logo explorer-brand-logo-light"
              src="/assets/brand/tgd-logo-header-420-v2.png"
              alt="The Global Decipher"
              width="420"
              height="420"
            />
            <img
              className="explorer-brand-logo explorer-brand-logo-dark"
              src="/assets/brand/tgd-logo-footer-420-v2.png"
              alt=""
              width="420"
              height="420"
            />
          </span>
        </a>

        <div className="explorer-header-date">{todayLabel}</div>

        <nav className="site-links explorer-nav-centered" aria-label="TGD sections">
          <a href="/news/">News</a>
          <a href="/opinion/">Opinion</a>
          <a href="/incident-map/">Incident Map</a>
          <a href="/network-graph/" aria-current="page">Network Graph</a>
          <a href="/reports/">Reports</a>
          <a href="/contact/">Contact</a>
        </nav>
      </div>

      <div className="explorer-tool-row">
        <div className="explorer-search-context">
          <span>Explorer database</span>
          <small>Organisations, people and fronts</small>
        </div>
        <div className={query ? "explorer-search has-query" : "explorer-search"}>
          <input
            ref={inputRef}
            type="search"
            spellCheck={false}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            aria-controls="explorer-search-results"
            aria-label="Search the Explorer database"
            placeholder="Search actors, leaders, places, attacks or connections…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
            onFocus={(event) => {
              setOpen(true);
              if (selected && query === (selected.short ?? selected.name)) {
                event.currentTarget.select();
              }
            }}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKey}
          />
          {query && (
            <button
              type="button"
              className="explorer-search-clear"
              aria-label="Clear Explorer search"
              title="Clear search"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setQuery("");
                setHighlight(0);
                setOpen(false);
                inputRef.current?.focus();
              }}
            >
              ×
            </button>
          )}
          {open && query.trim().length >= 2 && (
            <div className="explorer-search-results" id="explorer-search-results" role="listbox">
              {flat.length > 0 ? (
                <>
              {grouped.map(([type, list]) => (
                <div key={type}>
                  <div className="pane-label px-4 pt-3 pb-1">
                    {TYPE_LABEL[type as keyof typeof TYPE_LABEL] ?? type}
                  </div>
                  {list.map((result) => {
                    const idx = flat.indexOf(result);
                    const entity = result.entity;
                    return (
                      <button
                        key={entity.id}
                        type="button"
                        role="option"
                        aria-selected={idx === highlight}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          pick(result);
                        }}
                        onMouseEnter={() => setHighlight(idx)}
                        className={idx === highlight ? "is-highlighted" : ""}
                      >
                        <div>
                          <div className="entity-name text-[0.92rem]">{entity.name}</div>
                          <div className="explorer-search-reason">{result.reason}</div>
                        </div>
                        <span>
                          <b className={`coverage-dot ${entity.stub ? "is-basic" : "is-deep"}`} />
                          {[entity.country ?? entity.region, coverageLabel(entity)].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
                </>
              ) : (
                <div className="explorer-search-empty">
                  <strong>No record matched “{query.trim()}”</strong>
                  <span>Try an alias, leader, country, designation or a shorter phrase.</span>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setQuery("");
                      setOpen(false);
                      select(null);
                    }}
                  >
                    Browse the full index →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {selected && !selected.stub && (
          <button
            type="button"
            onClick={() => toggleAsk()}
            className={askOpen ? "explorer-ask-action is-active" : "explorer-ask-action"}
            aria-pressed={askOpen}
          >
            Ask the database
          </button>
        )}
      </div>

      {menuOpen && (
        <nav id="explorer-site-menu" className="mobile-site-menu" aria-label="TGD sections">
          <a href="/news/">News</a>
          <a href="/opinion/">Opinion</a>
          <a href="/incident-map/">Incident Map</a>
          <a href="/network-graph/">Network Graph</a>
          <a href="/reports/">Reports</a>
          <a href="/contact/">Contact</a>
        </nav>
      )}
    </header>
  );
}
