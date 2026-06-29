import { useEffect, useMemo, useRef, useState } from "react";
import { useExplorer, selectedEntity, neighborhood } from "../lib/store";
import type { Entity, SourceRef } from "../types";
import ResearchAnswer from "./ResearchAnswer";

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
const CLIENT_TIMEOUT_MS = 16_000;

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
    const ids = neighborhood(byId, ent.id, 1);
    return [...ids].map((id) => byId.get(id)!).filter(Boolean);
  }, [ent, byId]);

  const contextSources = useMemo(() => flattenSources(contextEntities), [contextEntities]);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    if (streaming) {
      log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
      return;
    }
    const latestAnswer = log.querySelector<HTMLElement>(".research-answer:last-of-type");
    if (latestAnswer) latestAnswer.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [turns, streaming]);

  async function send(text?: string) {
    const question = (text ?? input).trim();
    if (!question || streaming || !ent) return;
    setInput("");
    setError(null);
    const next: Turn[] = [...turns, { role: "user", content: question }, { role: "assistant", content: "" }];
    setTurns(next);
    setStreaming(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
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
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        return last?.role === "assistant" && !last.content ? prev.slice(0, -1) : prev;
      });
      setError(
        e?.name === "AbortError"
          ? "The research assistant reached its 15-second limit. Please try a narrower question."
          : e?.message ?? "Failed to reach the research assistant."
      );
    } finally {
      window.clearTimeout(timeout);
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
      className="ask-panel fixed top-0 right-0 bottom-0 w-full sm:w-[520px] bg-page-light dark:bg-page-dark border-l border-line-light dark:border-line-dark z-40 flex flex-col shadow-[-20px_0_40px_-20px_rgba(0,0,0,0.25)] dark:shadow-none"
    >
      <header className="ask-panel-header">
        <div className="min-w-0">
          <div className="ask-panel-heading">
            <span className="pane-label">Ask the database</span>
            <span className="ask-mode">Evidence mode</span>
          </div>
          <div className="entity-name text-meta truncate">{ent.name}</div>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close panel"
          className="ask-close"
        >
          ×
        </button>
      </header>

      <div ref={logRef} className="ask-log" aria-live="polite">
        {turns.length === 0 && (
          <div className="ask-welcome">
            <span className="ask-welcome-eyebrow">Research this profile</span>
            <h2>Interrogate the evidence, not just the headline.</h2>
            <p>
              Ask a focused question about leadership, attacks, financing, relationships, or designations.
              Every factual answer links back to the profile evidence.
            </p>
            <div className="ask-suggestions">
              <div className="pane-label">Suggested questions</div>
              <div className="ask-suggestion-grid">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setInput(s); void send(s); }}
                    className="ask-suggestion"
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <strong>{s}</strong>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          t.role === "user" ? (
            <section key={i} className="research-question">
              <span className="pane-label">Research question</span>
              <p>{t.content}</p>
            </section>
          ) : showTypingDots && i === turns.length - 1 ? (
            <section key={i} className="research-answer research-answer-loading" aria-label="Preparing research brief">
              <header className="research-answer-head">
                <div>
                  <span className="research-answer-kicker">TGD research brief</span>
                  <span className="research-answer-status">Reviewing evidence</span>
                </div>
              </header>
              <div className="research-loading-lines" aria-hidden="true">
                <span /><span /><span />
              </div>
            </section>
          ) : (
            <ResearchAnswer key={i} text={t.content} sources={contextSources} />
          )
        ))}

        {error && (
          <div className="ask-error">
            <strong>Research desk unavailable</strong>
            <span>{error}</span>
          </div>
        )}
      </div>

      <footer className="ask-composer">
        <form
          onSubmit={(e) => { e.preventDefault(); void send(); }}
          className="ask-composer-form"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask about ${ent.short ?? ent.name}…`}
            aria-label={`Ask about ${ent.short ?? ent.name}`}
            autoFocus
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
          >
            {streaming ? "Reviewing…" : "Ask"}
          </button>
        </form>
        <p className="ask-evidence-policy">
          <span aria-hidden="true">✓</span>
          Answers use TGD profile evidence. Inspect cited sources before publication.
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
