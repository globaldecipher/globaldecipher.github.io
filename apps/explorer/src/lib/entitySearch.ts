import Fuse from "fuse.js";
import type { Entity } from "../types";

export const TYPE_LABEL: Record<Entity["type"], string> = {
  organization: "Organisation",
  person: "Person",
  attack: "Attack",
  financing_entity: "Financing",
  front: "Front"
};

export interface EntitySearchRecord {
  entity: Entity;
  names: string;
  aliases: string;
  people: string;
  places: string;
  relationships: string;
  incidents: string;
  evidence: string;
  themes: string;
}

export interface EntitySearchResult {
  entity: Entity;
  reason: string;
}

const ENTITY_ID_ALIASES: Record<string, string> = {
  "al-qaeda": "org-al-qaeda",
  "islamic-state": "org-islamic-state"
};

function clean(values: Array<string | undefined | null>) {
  return values.filter(Boolean).join(" · ");
}

export function coverageLabel(entity: Entity) {
  return entity.stub ? "Basic record" : "Deep profile";
}

export function buildEntitySearchIndex(entities: Entity[], byId: Map<string, Entity>) {
  return entities.map((entity): EntitySearchRecord => {
    const outbound = (entity.relationships ?? []).flatMap((relationship) => {
      const related = byId.get(ENTITY_ID_ALIASES[relationship.to] ?? relationship.to);
      return [
        relationship.type.replace(/-/g, " "),
        related?.name,
        related?.short,
        relationship.note
      ];
    });
    const inbound = entities.flatMap((candidate) =>
      (candidate.relationships ?? [])
        .filter((relationship) =>
          (ENTITY_ID_ALIASES[relationship.to] ?? relationship.to) === entity.id
        )
        .flatMap((relationship) => [
          relationship.type.replace(/-/g, " "),
          candidate.name,
          candidate.short,
          relationship.note
        ])
    );
    return {
      entity,
      names: clean([entity.name, entity.short]),
      aliases: clean(entity.aliases ?? []),
      people: clean((entity.leaders ?? []).flatMap((leader) => [leader.name, leader.role])),
      places: clean([
        entity.country,
        entity.region,
        ...(entity.countries ?? []),
        ...(entity.aor ?? []).map((point) => point.label),
        entity.headquarters?.label
      ]),
      relationships: clean([...outbound, ...inbound]),
      incidents: clean((entity.attacks ?? []).flatMap((attack) => [
        attack.location,
        attack.type,
        attack.summary,
        attack.date
      ])),
      evidence: clean([
        ...(entity.sources ?? []).flatMap((source) => [source.title, source.outlet, source.author]),
        ...(entity.designations ?? []).flatMap((designation) => [
          designation.body.replace(/_/g, " "),
          designation.ref
        ])
      ]),
      themes: clean([
        entity.ideology,
        entity.summary,
        ...(entity.financing ?? []).flatMap((claim) => [claim.method, claim.detail])
      ])
    };
  });
}

export function createEntitySearch(records: EntitySearchRecord[]) {
  return new Fuse(records, {
    keys: [
      { name: "names", weight: 1 },
      { name: "aliases", weight: 0.92 },
      { name: "people", weight: 0.82 },
      { name: "places", weight: 0.72 },
      { name: "relationships", weight: 0.68 },
      { name: "incidents", weight: 0.58 },
      { name: "themes", weight: 0.5 },
      { name: "evidence", weight: 0.4 }
    ],
    threshold: 0.3,
    includeScore: true,
    minMatchCharLength: 2,
    ignoreLocation: true
  });
}

function matchingValue(query: string, values: Array<string | undefined | null>) {
  const normalized = query.toLowerCase();
  return values.find((value) => value?.toLowerCase().includes(normalized));
}

function matchReason(record: EntitySearchRecord, query: string) {
  const entity = record.entity;
  if (matchingValue(query, [entity.name, entity.short])) return "Name or acronym";

  const alias = matchingValue(query, entity.aliases ?? []);
  if (alias) return `Alias: ${alias}`;

  const leader = (entity.leaders ?? []).find((item) =>
    matchingValue(query, [item.name, item.role])
  );
  if (leader) return `Leader: ${leader.name}`;

  const place = matchingValue(query, [
    entity.country,
    entity.region,
    ...(entity.countries ?? []),
    ...(entity.aor ?? []).map((point) => point.label),
    entity.headquarters?.label
  ]);
  if (place) return `Place: ${place}`;

  const relationship = (entity.relationships ?? []).find((item) =>
    matchingValue(query, [
      item.type.replace(/-/g, " "),
      item.note,
      record.relationships
    ])
  );
  if (relationship) return "Documented connection";

  const incident = (entity.attacks ?? []).find((item) =>
    matchingValue(query, [item.location, item.type, item.summary, item.date])
  );
  if (incident) return `Incident: ${incident.location ?? incident.date}`;

  const designation = (entity.designations ?? []).find((item) =>
    matchingValue(query, [item.body.replace(/_/g, " "), item.ref])
  );
  if (designation) return `Designation: ${designation.body.replace(/_/g, " ")}`;

  const source = (entity.sources ?? []).find((item) =>
    matchingValue(query, [item.title, item.outlet, item.author])
  );
  if (source) return `Source: ${source.outlet ?? source.title}`;

  if (matchingValue(query, [entity.ideology])) return `Theme: ${entity.ideology}`;
  return "Profile text";
}

export function searchEntityIndex(
  search: Fuse<EntitySearchRecord>,
  query: string,
  limit = 20
): EntitySearchResult[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  return search.search(trimmed, { limit }).map(({ item }) => ({
    entity: item.entity,
    reason: matchReason(item, trimmed)
  }));
}
