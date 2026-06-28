import { useEffect, useMemo, useRef, useState } from "react";
import { useExplorer, selectedEntity, neighborhood } from "../lib/store";
import type { Entity, SourceRef } from "../types";
import CitationText from "./Citation";

interface Turn {
  role: "user" | "assistant";
  content: string;
  cited?: SourceRef[];
}

function flattenSources(entities: Entity[]): SourceRef[] {
  const map = new Map<string, SourceRef>();
  for (const e of entities) for (const s of e.sources ?? []) if (!map.has(s.id)) map.set(s.id, s);
  return [...map.values()];
}

const SUGGESTIONS = [
  "Summarise leadership succession",
  "What financing methods are documented?",
  "List the deadliest attacks since 2020",
  "Compare this group with a key rival",
  "Which designations apply, and when?"
];

export default function AskPanel() {
  const ent = useExplorer(selectedEntity);
  const byId = useExplorer((s) => s.byId);
  const close = useExplorer((s) => () => s.toggleAsk(false));

  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const contextEntities = useMemo(() => {
    if (!ent) return [] as Entity[];
    const ids = neighborhood(byId, ent.id, 2);
    return [...ids].map((id) => byId.get(id)!).filter(Boolean);
  }, [ent, byId]);

  const contextSources = useMemo(() => flattenSources(contextEntities), [contextEntities]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, streaming]);

  async function send(text?: string) {
    const question = (text ?? input).trim();
    if (!question || streaming || !ent) return;
    setInput("");
    setError(null);
    const next: Turn[] = [...turns, { role: "user", content: question }, { role: "assistant", content: "" }];
    setTurns(next);
    setStreaming(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityId: ent.id,
          question,
          history: turns
            .filter((turn) => turn.content)
            .slice(-6)
            .map((turn) => ({ role: turn.role, content: turn.content })),
          context: { entities: contextEntities.map(stripForPrompt) }
        })
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || `Research assistant unavailable (HTTP ${res.status}).`);
      }
      const data = await res.json();
      const answer = data?.answer ?? "No response generated.";
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== "assistant") return prev;
        return [...prev.slice(0, -1), { ...last, content: answer }];
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to reach the research assistant.");
    } finally {
      setStreaming(false);
    }
  }

  if (!ent) return null;

  const lastTurn = turns[turns.length - 1];
  const showTypingDots = streaming && lastTurn?.role === "assistant" && !lastTurn.content;

  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-label="Ask the database"
      className="fixed top-0 right-0 bottom-0 w-full sm:w-[440px] bg-page-light dark:bg-page-dark border-l border-line-light dark:border-line-dark z-40 flex flex-col shadow-[-20px_0_40px_-20px_rgba(0,0,0,0.25)] dark:shadow-none"
    >
      <header className="flex items-center justify-between px-4 h-14 border-b-hair border-line-light dark:border-line-dark">
        <div className="min-w-0">
          <div className="pane-label flex items-center gap-2">
            Ask the database
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          </div>
          <div className="entity-name text-meta truncate">{ent.name}</div>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close panel"
          className="text-meta text-muted-light dark:text-muted-dark hover:text-ink-light dark:hover:text-ink-dark p-1.5"
        >
          ✕
        </button>
      </header>

      <div ref={logRef} className="flex-1 min-h-0 overflow-auto px-4 py-4 space-y-4">
        {turns.length === 0 && (
          <div className="text-meta text-muted-light dark:text-muted-dark space-y-3">
            <p>
              Ask in plain English. Answers cite source IDs like{" "}
              <code className="text-accent">[src-iskp-1]</code> that link back to the dossier.
            </p>
            <div className="space-y-1.5">
              <div className="pane-label">Try</div>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setInput(s); void send(s); }}
                    className="text-[12px] text-left px-2.5 py-1 border-hair border-line-light dark:border-line-dark text-ink-light dark:text-ink-dark hover:border-accent hover:text-accent transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "" : "border-l-2 border-accent pl-3"}>
            <div className="pane-label mb-1">{t.role === "user" ? "You" : "Database"}</div>
            <div className="text-body whitespace-pre-wrap leading-[1.55]">
              {t.role === "assistant" ? (
                showTypingDots && i === turns.length - 1 ? (
                  <span className="inline-flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: "120ms" }} />
                    <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: "240ms" }} />
                  </span>
                ) : (
                  <CitationText text={t.content} sources={contextSources} />
                )
              ) : (
                t.content
              )}
            </div>
          </div>
        ))}

        {error && (
          <div className="text-meta text-danger border-l-2 border-danger pl-3">{error}</div>
        )}
      </div>

      <footer className="border-t-hair border-line-light dark:border-line-dark p-2">
        <form
          onSubmit={(e) => { e.preventDefault(); void send(); }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask about ${ent.short ?? ent.name}…`}
            className="flex-1 bg-transparent border-hair border-line-light dark:border-line-dark h-9 px-3 text-meta focus:outline-none focus:border-accent"
            autoFocus
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="h-9 px-4 bg-accent text-white text-meta font-medium disabled:opacity-40"
          >
            {streaming ? "…" : "Ask"}
          </button>
        </form>
        <p className="mt-1 text-[10px] uppercase tracking-eyebrow text-dim-light dark:text-dim-dark">
          Gemini answers are bound to TGD profile data, rate-limited, and should be verified before citing.
        </p>
      </footer>
    </aside>
  );
}

function stripForPrompt(e: Entity) {
  return {
    id: e.id,
    name: e.name,
    aliases: e.aliases,
    type: e.type,
    founded: e.founded,
    dissolved: e.dissolved,
    status: e.status,
    ideology: e.ideology,
    country: e.country,
    countries: e.countries,
    summary: e.summary,
    designations: e.designations,
    leaders: e.leaders,
    financing: e.financing,
    attacks: e.attacks,
    relationships: e.relationships,
    sources: e.sources
  };
}
