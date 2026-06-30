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

export function citationLabel(src?: SourceRef): string {
  if (!src) return "Source";
  const outlet = src.outlet?.trim();
  if (!outlet) return "Source";

  const shortened: Record<string, string> = {
    "U.S. Department of State": "State Department",
    "Financial Action Task Force": "FATF",
    "UN Security Council": "UN Security Council",
    "Government of Pakistan": "Pakistan Government"
  };
  return shortened[outlet] ?? outlet;
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
  const label = citationLabel(src);
  const detailId = `source-${id}`;
  const commonProps = {
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
    className: "citation-chip",
    "aria-describedby": src ? detailId : undefined,
    "aria-label": src ? `Source: ${src.title}` : "Profile source"
  };

  return (
    <span className="citation-wrap">
      {src?.url ? (
        <a {...commonProps} href={src.url} target="_blank" rel="noopener noreferrer">
          <span>{label}</span>
          <span className="citation-chip-arrow" aria-hidden="true">↗</span>
        </a>
      ) : (
        <span {...commonProps} tabIndex={0} role="note">
          <span>{label}</span>
        </span>
      )}
      {open && src && (
        <span
          role="tooltip"
          id={detailId}
          className="citation-tooltip"
        >
          <span className="citation-tooltip-kicker">Source</span>
          <span className="citation-tooltip-title">{src.title}</span>
          <span className="citation-tooltip-meta">
            {[src.outlet, src.author, src.date].filter(Boolean).join(" · ")}
          </span>
          {src.url && (
            <span className="citation-tooltip-action">Open original source ↗</span>
          )}
        </span>
      )}
    </span>
  );
}
