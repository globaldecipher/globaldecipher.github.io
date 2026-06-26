import { useMemo, useState } from "react";
import type { SourceRef } from "../types";

interface Props {
  text: string;
  sources: SourceRef[];
}

const TOKEN_RE = /\[(src-[a-z0-9-]+|\d+)\]/gi;

interface Part { type: "text" | "cite"; value: string }

function tokenise(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  text.replace(TOKEN_RE, (match, id, offset) => {
    if (offset > last) parts.push({ type: "text", value: text.slice(last, offset) });
    parts.push({ type: "cite", value: String(id) });
    last = offset + match.length;
    return match;
  });
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

export default function CitationText({ text, sources }: Props) {
  const parts = useMemo(() => tokenise(text), [text]);
  const byId = useMemo(() => {
    const m = new Map<string, SourceRef>();
    for (const s of sources) m.set(s.id, s);
    return m;
  }, [sources]);
  return (
    <span>
      {parts.map((p, i) =>
        p.type === "text"
          ? <span key={i}>{p.value}</span>
          : <CiteChip key={i} id={p.value} src={byId.get(p.value)} />
      )}
    </span>
  );
}

function CiteChip({ id, src }: { id: string; src?: SourceRef }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block align-baseline">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="mx-0.5 text-[10px] text-accent border-hair border-accent/40 px-1 rounded-sm align-super hover:bg-accent hover:text-white"
        aria-describedby={`pop-${id}`}
      >
        [{id}]
      </button>
      {open && src && (
        <span
          role="tooltip"
          id={`pop-${id}`}
          className="absolute left-0 top-full mt-1 w-72 z-20 bg-surface-light dark:bg-surface-dark border-hair border-line-light dark:border-line-dark p-2 text-[12px] leading-snug shadow-sm"
        >
          <span className="block font-medium text-ink-light dark:text-ink-dark">{src.title}</span>
          <span className="block text-muted-light dark:text-muted-dark mt-1">
            {[src.outlet, src.author, src.date].filter(Boolean).join(" · ")}
          </span>
          {src.url && (
            <a href={src.url} target="_blank" rel="noopener noreferrer" className="block mt-1 text-accent underline">
              {src.url.replace(/^https?:\/\//, "").slice(0, 48)}…
            </a>
          )}
        </span>
      )}
    </span>
  );
}
