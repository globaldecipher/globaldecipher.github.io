import { useMemo, useState } from "react";
import type { SourceRef } from "../types";

interface Props {
  text: string;
  sources: SourceRef[];
}

const CITATION_ID_PATTERN = "(?:src-[a-z0-9-]+|\\d+)";

type Part =
  | { type: "text"; value: string }
  | { type: "cite"; value: string[] };

function citationGroupRegex(): RegExp {
  return new RegExp(`\\[\\s*(${CITATION_ID_PATTERN}(?:\\s*,\\s*${CITATION_ID_PATTERN})*)\\s*\\]`, "gi");
}

function splitCitationIds(group: string): string[] {
  return [...new Set(group.split(/\s*,\s*/).map((id) => id.toLowerCase()))];
}

export function extractCitationIds(text: string): string[] {
  return [...text.matchAll(citationGroupRegex())].flatMap((match) => splitCitationIds(match[1]));
}

export function replaceCitationGroups(
  text: string,
  replacement: (ids: string[]) => string
): string {
  return text.replace(citationGroupRegex(), (_match, group: string) => replacement(splitCitationIds(group)));
}

function tokenise(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  text.replace(citationGroupRegex(), (match, group: string, offset: number) => {
    if (offset > last) parts.push({ type: "text", value: text.slice(last, offset) });
    parts.push({ type: "cite", value: splitCitationIds(group) });
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
    for (const s of sources) m.set(s.id.toLowerCase(), s);
    return m;
  }, [sources]);
  return (
    <span>
      {parts.map((p, i) =>
        p.type === "text"
          ? <span key={i}>{p.value}</span>
          : <CitationGroup key={i} ids={p.value} sources={p.value.map((id) => byId.get(id)).filter((source): source is SourceRef => Boolean(source))} />
      )}
    </span>
  );
}

function CitationGroup({ ids, sources }: { ids: string[]; sources: SourceRef[] }) {
  if (ids.length === 1) return <CiteChip id={ids[0]} src={sources[0]} />;
  return <MultiCiteChip ids={ids} sources={sources} />;
}

function interactiveWrapperProps(setOpen: (open: boolean) => void) {
  return {
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: (event: React.FocusEvent<HTMLSpanElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }
  };
}

function CiteChip({ id, src }: { id: string; src?: SourceRef }) {
  const [open, setOpen] = useState(false);
  const label = citationLabel(src);
  const detailId = `source-${id}`;
  const commonProps = {
    className: "citation-chip",
    "aria-describedby": src ? detailId : undefined,
    "aria-label": src ? `Source: ${src.title}` : "Profile source"
  };

  return (
    <span className="citation-wrap" {...interactiveWrapperProps(setOpen)}>
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

function MultiCiteChip({ ids, sources }: { ids: string[]; sources: SourceRef[] }) {
  const [open, setOpen] = useState(false);
  const detailId = `sources-${ids.join("-")}`;
  const count = ids.length;

  return (
    <span className="citation-wrap" {...interactiveWrapperProps(setOpen)}>
      <button
        type="button"
        className="citation-chip citation-chip-group"
        aria-expanded={open}
        aria-controls={detailId}
        aria-label={`Inspect ${count} cited sources`}
        onClick={() => setOpen(!open)}
      >
        <span>{count} sources</span>
        <span className="citation-chip-arrow" aria-hidden="true">+</span>
      </button>
      {open && (
        <span id={detailId} className="citation-tooltip citation-tooltip-group" role="group" aria-label="Cited sources">
          <span className="citation-tooltip-kicker">Cited sources</span>
          {sources.map((source) => (
            source.url ? (
              <a
                key={source.id}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="citation-source-row"
              >
                <span className="citation-tooltip-title">{source.title}</span>
                <span className="citation-tooltip-meta">
                  {[source.outlet, source.author, source.date].filter(Boolean).join(" · ")}
                </span>
                <span className="citation-tooltip-action">Open source ↗</span>
              </a>
            ) : (
              <span key={source.id} className="citation-source-row">
                <span className="citation-tooltip-title">{source.title}</span>
                <span className="citation-tooltip-meta">
                  {[source.outlet, source.author, source.date].filter(Boolean).join(" · ")}
                </span>
              </span>
            )
          ))}
          {sources.length === 0 && (
            <span className="citation-tooltip-meta">Source details are recorded in the profile evidence.</span>
          )}
        </span>
      )}
    </span>
  );
}
