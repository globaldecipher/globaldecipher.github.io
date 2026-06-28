#!/usr/bin/env node
// Transform /static/data/network-pakistan.json (legacy schema) into the Explorer's
// entity schema, then merge in any hand-authored deep-dive entities from
// src/data/entities.deep.json. Deep records always override stubs.
//
//   npm run data
//
// Output: public/data/entities.json (committed; loaded by the React app).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PAK_JSON = resolve(here, "../../../static/data/network-pakistan.json");
const DEEP_JSON = resolve(here, "../src/data/entities.deep.json");
const OUT_JSON = resolve(here, "../public/data/entities.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const pak = readJson(PAK_JSON);

const sourceIndex = pak.sourceIndex || {};
const allSources = Object.entries(sourceIndex).map(([id, v]) => ({
  id,
  title: v.label || id,
  url: v.url
}));

const RELTYPE_MAP = {
  "splinter": "split-from",
  "successor": "successor",
  "predecessor": "split-from",
  "merged": "successor",
  "merger": "successor",
  "umbrella": "parent",
  "parent": "parent",
  "front": "parent",
  "ideological": "ideological-link",
  "ally": "allied",
  "allied": "allied",
  "rival": "rival",
  "rivalry": "rival",
  "financier": "financed-by",
  "financed-by": "financed-by",
  "leader": "leads",
  "leads": "leads",
  "member": "member-of",
  "member-of": "member-of"
};

// A small number of legacy records predate explicit entity typing. Keep these
// corrections close to the transformer so every generated Explorer dataset
// receives the same research-safe classification.
const TYPE_OVERRIDES = {
  "tehreek-e-taliban-pakistan": "organization",
  "baitullah-mehsud": "person",
  "org-al-qaeda": "organization",
  "org-islamic-state": "organization",
  "org-iskp": "organization",
  "sanaullah-ghafari": "person",
  "hafiz-saeed": "person",
  "masood-azhar": "person",
  "balochistan-liberation-army": "organization"
};

const NAME_OVERRIDES = {
  "org-al-qaeda": "Al-Qaeda",
  "org-islamic-state": "Islamic State",
  "org-iskp": "Islamic State Khorasan Province"
};

// The deep ISKP profile is canonical. Redirect the old index-only record so
// search and relationship views do not show two versions of the same group.
const ID_REDIRECTS = {
  "org-iskp": "iskp"
};

function mapRelType(t) {
  if (!t) return "ideological-link";
  return RELTYPE_MAP[t.toLowerCase()] || "ideological-link";
}

function canonicalId(id) {
  return ID_REDIRECTS[id] || id;
}

function normalizeStatus(status) {
  const value = String(status || "").trim();
  if (!value) return "active";
  if (/^un[- ]listed$/i.test(value)) return "UN-listed";
  return value.toLowerCase();
}

function entityFromNode(node) {
  const isOrg = !node.type || node.type === "organisation" || node.type === "organization";
  const isPerson = node.type === "individual" || node.type === "person";
  const type = TYPE_OVERRIDES[node.id] || (isPerson ? "person" : isOrg ? "organization" : "front");
  const id = canonicalId(node.id);

  // Pull legacy sources by id reference
  const sources = (node.sources || [])
    .map((id) => sourceIndex[id]
      ? { id, title: sourceIndex[id].label || id, url: sourceIndex[id].url }
      : { id, title: id })
    .filter(Boolean);

  const designations = (node.designations || []).map((d) => {
    // Patterns like "UN ISIL and Al-Qaida list: QDe.132"
    const m = String(d).match(/^([^:]+):\s*(.+)$/);
    if (m) return { body: m[1].trim().toUpperCase(), ref: m[2].trim() };
    return { body: String(d) };
  });

  return {
    id,
    type,
    name: NAME_OVERRIDES[node.id] || node.label || id.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    aliases: node.aliases || [],
    status: normalizeStatus(node.status),
    ideology: node.category || node.role || "",
    region: node.region || "South Asia",
    country: node.country || "Pakistan",
    countries: node.countries || [node.country].filter(Boolean),
    designations,
    summary: node.summary || "",
    sources,
    stub: true
  };
}

const baseById = new Map();
for (const node of pak.nodes || []) {
  const entity = entityFromNode(node);
  const existing = baseById.get(entity.id);
  baseById.set(entity.id, existing ? {
    ...existing,
    ...entity,
    aliases: [...new Set([...(existing.aliases || []), ...(entity.aliases || [])])],
    sources: [...new Map([...(existing.sources || []), ...(entity.sources || [])].map((source) => [source.id, source])).values()],
    designations: [...(existing.designations || []), ...(entity.designations || [])]
  } : entity);
}
const baseEntities = [...baseById.values()];

// Map legacy edges into relationship arrays on each source entity.
for (const e of pak.edges || []) {
  if (!e?.source || !e?.target) continue;
  const source = canonicalId(e.source);
  const target = canonicalId(e.target);
  if (source === target) continue;
  const owner = baseById.get(source);
  if (!owner) continue;
  owner.relationships = owner.relationships || [];
  owner.relationships.push({
    to: target,
    type: mapRelType(e.type),
    note: e.label
  });
}

// Merge deep-authored entities. They override every field on collision.
let deep = { entities: [] };
try { deep = readJson(DEEP_JSON); } catch (_e) { /* file optional */ }

const finalById = new Map();
for (const e of baseEntities) finalById.set(e.id, e);
for (const e of (deep.entities || [])) {
  const existing = finalById.get(e.id) || {};
  finalById.set(e.id, { ...existing, ...e, stub: false });
}

const result = {
  meta: {
    title: "TGD Explorer entity dataset",
    last_updated: new Date().toISOString().slice(0, 10),
    coverage: "Pakistan-theatre militant organisations, factions, fronts, and key actors. Deep-coverage seed: ISKP and TTP."
  },
  entities: [...finalById.values()].sort((a, b) => a.name.localeCompare(b.name))
};

mkdirSync(dirname(OUT_JSON), { recursive: true });
writeFileSync(OUT_JSON, JSON.stringify(result, null, 2), "utf8");

const deepCount = result.entities.filter((e) => !e.stub).length;
console.log(`build-entities: wrote ${result.entities.length} entities (${deepCount} deep, ${result.entities.length - deepCount} stub) → ${OUT_JSON}`);
