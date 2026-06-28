import { useEffect, useState } from "react";
import Pane from "./Pane";
import { useExplorer, selectedEntity } from "../lib/store";
import CitationText from "./Citation";
import type { Entity } from "../types";

type Tab = "overview" | "leadership" | "financing" | "attacks" | "sources";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "leadership", label: "Leadership" },
  { id: "financing", label: "Financing" },
  { id: "attacks", label: "Attacks" },
  { id: "sources", label: "Sources" }
];

export default function Dossier() {
  const ent = useExplorer(selectedEntity);
  const [tab, setTab] = useState<Tab>("overview");
  const availableTabs = ent
    ? TABS.filter((item) => {
        if (item.id === "overview") return true;
        if (item.id === "leadership") return (ent.leaders ?? []).length > 0;
        if (item.id === "financing") return (ent.financing ?? []).length > 0;
        if (item.id === "attacks") return (ent.attacks ?? []).length > 0;
        return (ent.sources ?? []).length > 0;
      })
    : TABS.slice(0, 1);

  useEffect(() => {
    if (!availableTabs.some((item) => item.id === tab)) setTab("overview");
  }, [availableTabs, tab]);

  if (!ent) {
    return (
      <Pane label="Dossier">
        <div className="p-4 text-meta text-muted-light dark:text-muted-dark">Select an entity to load its dossier.</div>
      </Pane>
    );
  }

  return (
    <Pane label="Profile" className="explorer-dossier">
      <div className="dossier-tabs">
        {availableTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              "px-4 py-2.5 text-[0.88rem] border-b-2 " +
              (tab === t.id
                ? "border-accent text-ink-light dark:text-ink-dark font-semibold"
                : "border-transparent text-muted-light dark:text-muted-dark hover:text-ink-light dark:hover:text-ink-dark")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-5 text-body">
        {tab === "overview" && <Overview ent={ent} />}
        {tab === "leadership" && <Leadership ent={ent} />}
        {tab === "financing" && <Financing ent={ent} />}
        {tab === "attacks" && <Attacks ent={ent} />}
        {tab === "sources" && <Sources ent={ent} />}
      </div>
    </Pane>
  );
}

function dl(rows: [string, React.ReactNode][]) {
  return (
    <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 text-meta">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="pane-label pt-[2px]">{k}</dt>
          <dd className="text-body">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Overview({ ent }: { ent: Entity }) {
  const sources = ent.sources ?? [];
  return (
    <div className="space-y-4">
      {ent.stub && (
        <p className="text-[13px] text-warning border-l-2 border-warning pl-3">
          Basic record: verified index facts are available, while deeper narrative and relationship research is still being prepared.
        </p>
      )}
      <p className="leading-[1.6]">
        <CitationText text={ent.summary ?? ""} sources={sources} />
      </p>
      {dl([
        ["Aliases", (ent.aliases ?? []).join(" · ") || "—"],
        ["Founded", ent.founded ?? "—"],
        ["Status", ent.status ?? "—"],
        ["Ideology", ent.ideology ?? "—"],
        ["Region", [ent.region, ent.country].filter(Boolean).join(" · ") || "—"],
        ["AOR", (ent.aor ?? []).map((a) => a.label).filter(Boolean).join(" · ") || "—"]
      ])}
    </div>
  );
}

function Leadership({ ent }: { ent: Entity }) {
  const list = ent.leaders ?? [];
  if (list.length === 0) return <p className="text-muted-light dark:text-muted-dark text-meta">No leadership data yet.</p>;
  return (
    <ol className="space-y-3 list-none">
      {list.map((l, i) => (
        <li key={i} className="border-l-2 border-line-light dark:border-line-dark pl-3">
          <div className="entity-name text-name">{l.name}</div>
          <div className="text-meta text-muted-light dark:text-muted-dark">
            {[l.role, [l.from, l.to ?? "present"].filter(Boolean).join("–")].filter(Boolean).join(" · ")}
          </div>
          {l.fate && (
            <div className="text-meta mt-1">
              <CitationText text={l.fate} sources={ent.sources ?? []} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function Financing({ ent }: { ent: Entity }) {
  const list = ent.financing ?? [];
  if (list.length === 0) return <p className="text-muted-light dark:text-muted-dark text-meta">No financing data yet.</p>;
  return (
    <ul className="space-y-3 list-none">
      {list.map((f, i) => (
        <li key={i} className="border-l-2 border-violet pl-3">
          <div className="font-medium">{f.method}</div>
          {f.detail && (
            <div className="text-meta">
              <CitationText text={`${f.detail} ${(f.sources ?? []).map((s) => `[${s}]`).join(" ")}`} sources={ent.sources ?? []} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Attacks({ ent }: { ent: Entity }) {
  const list = (ent.attacks ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));
  if (list.length === 0) return <p className="text-muted-light dark:text-muted-dark text-meta">No attack record yet.</p>;
  return (
    <ul className="space-y-3 list-none">
      {list.map((a, i) => (
        <li key={i} className="border-l-2 border-danger pl-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{a.date}</span>
            {a.casualties != null && (
              <span className="text-meta text-danger">{a.casualties} killed</span>
            )}
          </div>
          <div className="text-meta text-muted-light dark:text-muted-dark">{[a.location, a.type].filter(Boolean).join(" · ")}</div>
          {a.summary && (
            <div className="text-meta mt-1">
              <CitationText text={`${a.summary} ${(a.sources ?? []).map((s) => `[${s}]`).join(" ")}`} sources={ent.sources ?? []} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Sources({ ent }: { ent: Entity }) {
  const list = ent.sources ?? [];
  if (list.length === 0) return <p className="text-muted-light dark:text-muted-dark text-meta">No sources yet.</p>;
  return (
    <ol className="space-y-2 list-decimal pl-5 text-meta">
      {list.map((s) => (
        <li key={s.id} id={`source-${s.id}`}>
          <span className="entity-name">{s.title}</span>
          <span className="text-muted-light dark:text-muted-dark"> — {[s.outlet, s.author, s.date].filter(Boolean).join(" · ")}</span>
          {s.url && (
            <>
              {" — "}
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent underline break-all">
                {s.url}
              </a>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
