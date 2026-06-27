import { useEffect, useRef, useState } from "react";
import type { Entity } from "../types";

function citationFor(ent: Entity): string {
  const accessed = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date());
  const url = `${window.location.origin}${import.meta.env.BASE_URL}#${encodeURIComponent(ent.id)}`;
  return `${ent.name}. TGD Explorer, The Global Decipher. Accessed ${accessed}. ${url}`;
}

export default function ProfileActions({ ent }: { ent: Entity }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"copied" | "selected" | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const citation = citationFor(ent);

  useEffect(() => {
    if (!open) return;
    fieldRef.current?.focus();
    fieldRef.current?.select();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(citation);
      setStatus("copied");
    } catch {
      fieldRef.current?.focus();
      fieldRef.current?.select();
      setStatus("selected");
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 print-hidden">
      <button
        type="button"
        onClick={() => { setStatus(null); setOpen(true); }}
        className="action-button action-button-secondary"
      >
        Cite profile
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="action-button action-button-primary"
      >
        Print / save PDF
      </button>
      <span className="sr-only" aria-live="polite">
        {status === "copied" ? "Citation copied to clipboard." : status === "selected" ? "Citation selected for manual copying." : ""}
      </span>
      {open && (
        <div className="citation-dialog-backdrop" onMouseDown={() => setOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="citation-dialog-title"
            className="citation-dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="browse-eyebrow">TGD Explorer citation</p>
            <h2 id="citation-dialog-title">Cite this profile</h2>
            <p>Copy the prepared citation below. It includes a direct link to this record.</p>
            <textarea ref={fieldRef} readOnly value={citation} rows={5} aria-label="Prepared citation" />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void copy()} className="action-button action-button-primary">
                {status === "copied" ? "Copied" : status === "selected" ? "Text selected" : "Copy citation"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="action-button action-button-secondary">
                Close
              </button>
              {status === "selected" && <small>Press Ctrl+C or ⌘C to copy.</small>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
