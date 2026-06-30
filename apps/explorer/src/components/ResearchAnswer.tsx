import { Fragment, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { SourceRef } from "../types";
import CitationText, {
  citationLabel,
  extractCitationIds,
  replaceCitationGroups
} from "./Citation";

interface Props {
  text: string;
  sources: SourceRef[];
}

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string; evidence: boolean }
  | { type: "unordered"; items: string[] }
  | { type: "ordered"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] };

const BLOCK_START_RE = /^(#{1,3})\s+|^\s*[-*•]\s+|^\s*\d+[.)]\s+|^\s*>\s+/;

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isEvidenceNote(text: string): boolean {
  return /^(evidence|verification)\s+note\s*:/i.test(text)
    || /^this information is verified/i.test(text)
    || /^verified against/i.test(text);
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line || /^-{3,}$/.test(line)) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().includes("|")) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    if (/^[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^[-*•]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ type: "unordered", items });
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^\d+[.)]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ type: "ordered", items });
      continue;
    }

    if (/^>\s+/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^>\s+(.+)$/);
        if (!match) break;
        quote.push(match[1]);
        index += 1;
      }
      blocks.push({ type: "quote", text: quote.join(" ") });
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || BLOCK_START_RE.test(next)) break;
      if (next.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) break;
      paragraph.push(next);
      index += 1;
    }
    const paragraphText = paragraph.join(" ");
    blocks.push({ type: "paragraph", text: paragraphText, evidence: isEvidenceNote(paragraphText) });
  }

  return blocks;
}

function InlineText({ text, sources }: Props) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}><CitationText text={part.slice(2, -2)} sources={sources} /></strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={index}>{part.slice(1, -1)}</code>;
        }
        if (part.startsWith("*") && part.endsWith("*")) {
          return <em key={index}><CitationText text={part.slice(1, -1)} sources={sources} /></em>;
        }
        return <CitationText key={index} text={part} sources={sources} />;
      })}
    </>
  );
}

function renderBlock(block: Block, index: number, sources: SourceRef[]): ReactNode {
  if (block.type === "heading") {
    const Tag = block.level === 1 ? "h3" : "h4";
    return <Tag key={index}><InlineText text={block.text} sources={sources} /></Tag>;
  }
  if (block.type === "unordered") {
    return (
      <ul key={index}>
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}><InlineText text={item} sources={sources} /></li>
        ))}
      </ul>
    );
  }
  if (block.type === "ordered") {
    return (
      <ol key={index}>
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}><InlineText text={item} sources={sources} /></li>
        ))}
      </ol>
    );
  }
  if (block.type === "quote") {
    return <blockquote key={index}><InlineText text={block.text} sources={sources} /></blockquote>;
  }
  if (block.type === "table") {
    return (
      <div className="research-table-wrap" key={index}>
        <table>
          <thead>
            <tr>
              {block.headers.map((header, cellIndex) => (
                <th key={cellIndex}><InlineText text={header} sources={sources} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {block.headers.map((_, cellIndex) => (
                  <td key={cellIndex}>
                    <InlineText text={row[cellIndex] ?? ""} sources={sources} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <p key={index} className={block.evidence ? "research-evidence-note" : undefined}>
      {block.evidence && <span aria-hidden="true">✓</span>}
      <InlineText text={block.text} sources={sources} />
    </p>
  );
}

export default function ResearchAnswer({ text, sources }: Props) {
  const [copied, setCopied] = useState(false);
  const normalizedText = useMemo(() => text.replace(/\]\s+([.,;:!?])/g, "]$1"), [text]);
  const copyText = useMemo(() => {
    const byId = new Map(sources.map((source) => [source.id.toLowerCase(), source]));
    return replaceCitationGroups(normalizedText, (ids) => {
      const labels = [...new Set(
        ids
          .map((id) => byId.get(id))
          .filter((source): source is SourceRef => Boolean(source))
          .map((source) => citationLabel(source))
      )];
      return labels.length > 0 ? `(${labels.join("; ")})` : "";
    });
  }, [normalizedText, sources]);
  const blocks = useMemo(() => parseBlocks(normalizedText), [normalizedText]);
  const citedSourceCount = useMemo(() => {
    const sourceIds = new Set(sources.map((source) => source.id.toLowerCase()));
    return new Set(extractCitationIds(normalizedText).filter((id) => sourceIds.has(id))).size;
  }, [normalizedText, sources]);

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article className="research-answer">
      <header className="research-answer-head">
        <div>
          <span className="research-answer-kicker">TGD research brief</span>
          <span className="research-answer-status">Profile evidence</span>
        </div>
        <button type="button" onClick={() => void copyAnswer()} aria-label="Copy research answer">
          {copied ? "Copied" : "Copy"}
        </button>
      </header>
      <div className="research-answer-body">
        {blocks.map((block, index) => (
          <Fragment key={index}>{renderBlock(block, index, sources)}</Fragment>
        ))}
      </div>
      <footer className="research-answer-foot">
        <span>{citedSourceCount || "No"} cited source{citedSourceCount === 1 ? "" : "s"}</span>
        <span>{citedSourceCount > 0 ? "Open a citation to inspect the evidence" : "Review the profile sources before publication"}</span>
      </footer>
    </article>
  );
}
