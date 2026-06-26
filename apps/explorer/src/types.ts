// Single source-of-truth shape for every record displayed in the Explorer.
// Stored once per entity. Relationships are asymmetric; the graph builder
// reads both directions so authors don't duplicate the same edge.

export type EntityType =
  | "organization"
  | "person"
  | "attack"
  | "financing_entity"
  | "front";

export type EntityStatus = "active" | "dormant" | "defunct" | "deceased" | "detained";

export interface LatLng {
  lat: number;
  lng: number;
  label?: string;
  intensity?: number;
}

export interface Designation {
  body: string; // "UN_1267" | "US_OFAC" | "FATF" | "PAK_NACTA" | …
  date?: string; // ISO date
  ref?: string; // listing id, e.g. QDe.132
  url?: string;
  sources?: string[];
}

export interface Leader {
  name: string;
  role?: string;
  from?: string;
  to?: string;
  fate?: string;
  entityRef?: string; // optional id of a person entity for cross-linking
  sources?: string[];
}

export interface FinancingClaim {
  method: string; // "cryptocurrency" | "hawala" | "donations" | …
  detail?: string;
  sources?: string[];
}

export interface AttackEvent {
  date: string;
  location?: string;
  lat?: number;
  lng?: number;
  casualties?: number;
  type?: string; // "SVBIED" | "Complex assault" | "Targeted killing" | …
  summary?: string;
  sources?: string[];
}

export type RelationshipType =
  | "parent"
  | "split-from"
  | "allied"
  | "rival"
  | "financed-by"
  | "ideological-link"
  | "successor"
  | "member-of"
  | "leads";

export interface Relationship {
  to: string; // target entity id
  type: RelationshipType;
  from?: string;
  to_date?: string;
  note?: string;
  sources?: string[];
}

export interface SourceRef {
  id: string; // e.g. "src3" — referenced by every claim that needs citation
  title: string;
  url?: string;
  author?: string;
  date?: string;
  outlet?: string;
}

export interface TimelineEvent {
  date: string;
  type: "attack" | "leadership-change" | "split" | "designation" | "merger" | "founded" | "dissolved";
  label: string;
  significance?: number; // 0..1, drives dot radius
  sources?: string[];
}

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  short?: string;     // short label used inside the graph
  aliases?: string[];
  founded?: string;
  dissolved?: string;
  status?: EntityStatus;
  ideology?: string;
  region?: string;
  country?: string;
  countries?: string[];
  headquarters?: LatLng;
  aor?: LatLng[];
  designations?: Designation[];
  leaders?: Leader[];
  financing?: FinancingClaim[];
  attacks?: AttackEvent[];
  events?: TimelineEvent[];
  relationships?: Relationship[];
  summary?: string;
  sources?: SourceRef[];
  /** Author-visible flag — true if the record is a transformed stub awaiting depth */
  stub?: boolean;
}

export interface EntityDataset {
  meta: {
    title: string;
    last_updated: string;
    coverage: string;
  };
  entities: Entity[];
}
