import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildEntitySearchIndex,
  coverageLabel,
  createEntitySearch,
  searchEntityIndex,
  TYPE_LABEL
} from "../lib/entitySearch";
import { useExplorer } from "../lib/store";

interface EntityPickerProps {
  label: string;
  value: string | null;
  onChange: (id: string | null) => void;
  excludeId?: string | null;
  placeholder?: string;
}

export default function EntityPicker({
  label,
  value,
  onChange,
  excludeId = null,
  placeholder = "Search a name, alias, leader or place"
}: EntityPickerProps) {
  const entities = useExplorer((state) => state.entities);
  const byId = useExplorer((state) => state.byId);
  const recentIds = useExplorer((state) => state.recentIds);
  const selected = value ? byId.get(value) ?? null : null;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const index = useMemo(() => buildEntitySearchIndex(entities, byId), [entities, byId]);
  const search = useMemo(() => createEntitySearch(index), [index]);
  const matches = useMemo(
    () => searchEntityIndex(search, query, 8).filter(({ entity }) => entity.id !== excludeId),
    [excludeId, query, search]
  );
  const suggestions = useMemo(() => {
    const recent = recentIds
      .filter((id) => id !== excludeId && id !== value)
      .map((id) => byId.get(id))
      .filter(Boolean);
    const deep = entities.filter((entity) =>
      !entity.stub && entity.id !== excludeId && entity.id !== value
    );
    return [...new Map([...recent, ...deep].map((entity) => [entity!.id, entity!])).values()].slice(0, 6);
  }, [byId, entities, excludeId, recentIds, value]);
  const visible = query.trim().length >= 2
    ? matches
    : suggestions.map((entity) => ({ entity, reason: recentIds.includes(entity.id) ? "Recently viewed" : "Deep profile" }));

  useEffect(() => {
    setQuery(selected ? selected.short ?? selected.name : "");
  }, [selected?.id]);

  function pick(id: string) {
    onChange(id);
    const entity = byId.get(id);
    setQuery(entity ? entity.short ?? entity.name : "");
    setOpen(false);
    setHighlight(0);
    inputRef.current?.blur();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, visible.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && visible[highlight]) {
      event.preventDefault();
      pick(visible[highlight].entity.id);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <label className="entity-picker">
      <span>{label}</span>
      <div className={selected ? "entity-picker-field has-selection" : "entity-picker-field"}>
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          onFocus={(event) => {
            setOpen(true);
            if (selected) event.currentTarget.select();
          }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {(query || selected) && (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange(null);
              setQuery("");
              setHighlight(0);
              setOpen(true);
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        )}
        {open && (
          <div className="entity-picker-menu" role="listbox">
            <p>{query.trim().length >= 2 ? `${visible.length} matches` : "Suggested records"}</p>
            {visible.length > 0 ? visible.map(({ entity, reason }, index) => (
              <button
                key={entity.id}
                type="button"
                role="option"
                aria-selected={entity.id === value}
                className={index === highlight ? "is-highlighted" : ""}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(entity.id);
                }}
                onMouseEnter={() => setHighlight(index)}
              >
                <span>
                  <strong>{entity.name}</strong>
                  <small>{reason}</small>
                </span>
                <em>{[TYPE_LABEL[entity.type], entity.country, coverageLabel(entity)].filter(Boolean).join(" · ")}</em>
              </button>
            )) : (
              <div className="entity-picker-empty">
                <strong>No matching record</strong>
                <span>Try an alias, leader, country or shorter phrase.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </label>
  );
}
