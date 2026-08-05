// VENDORED COPY of woc-parse-service contract/types.ts. Do not edit here:
// edit the service repo's contract/, then re-copy this file verbatim below the
// vendor banner. Version safety is enforced at the wire, not at boot: every
// batch header carries v = CONTRACT_VERSION and the service rejects unknown
// majors with a stable error code, so a drifted copy fails loudly on the
// first shipped batch.

// The telemetry wire contract between the game repo's server/parse/ recorder and
// woc-parse-service. NDJSON, gzip-compressed per batch, POSTed to
// POST /ingest/v1/batch with the x-woc-parse-secret header. The first line of a
// batch is the BatchHeader; every subsequent line is one ParseRecord.
//
// The game repo vendors this file by copy at server/parse/contract.ts. Both sides
// assert CONTRACT_VERSION at boot; bump it on any breaking change. Additive,
// optional fields do not need a bump: the service stores unknown record types and
// unknown fields raw (forward compatibility with newer game builds).
//
// Rules the contract encodes (see PLAN-combat-parse-service.md section 4):
// - Every record carries the sim tick; wall-clock lives on the batch header only.
// - Batches are at-least-once: the service dedupes on batchId and upserts fights
//   by (realm, env, fightId).
// - Fight-scoped streaming, not fight-buffered: a crash mid-fight leaves a partial
//   fight the service closes as outcome 'reset' after a silence timeout.

export const CONTRACT_VERSION = 1;

export type ParseEnv = 'prod' | 'qa' | 'pbe' | 'dev';

export type Surface = 'arena' | 'raid' | 'dungeon' | 'rift' | 'battleground';

export type Segment = 'boss' | 'trash' | 'match' | 'floor' | 'run';

export type GroupType = 'party' | 'raid' | 'team';

export type FightOutcome =
  | 'kill'
  | 'wipe'
  | 'reset'
  | 'clear'
  | 'abandon'
  | 'win_a'
  | 'win_b'
  | 'draw';

/** First line of every batch. The only record that carries wall-clock time. */
export interface BatchHeader {
  t: 'batch';
  /** Contract major version; the service rejects unknown majors. */
  v: number;
  /** Unique per batch; the service's dedupe key for at-least-once replay. */
  batchId: string;
  realm: string;
  env: ParseEnv;
  /** Game build, e.g. '0.35.0'. Selects the content pack at render time. */
  build: string;
  sentAtMs: number;
}

/** One fight participant, keyed by stable character identity, never entity id. */
export interface FightParticipant {
  /** Intra-fight actor reference only; entity ids are per-login and reused. */
  entityId: number;
  characterId: number;
  name: string;
  class: string;
  spec: string | null;
  level: number;
  /** Arena/battleground team; null for PvE surfaces. */
  team: 'a' | 'b' | null;
  /** serializeCharacter output at fight open (talents, gear, ratings), verbatim. */
  snapshot: unknown;
}

export interface ArenaFrame {
  format: string;
  ratingA: number;
  ratingB: number;
  practice: boolean;
}

export interface RiftFrame {
  rank: string;
  baseLevel: number;
  floor: number;
  portalZone: string;
}

export interface FightOpenRecord {
  t: 'fight_open';
  /** Realm-scoped unique id minted by the recorder. */
  fightId: string;
  surface: Surface;
  /** Encounter/dungeon/rift/arena key, e.g. 'nythraxis', 'hollow_crypt'. */
  key: string;
  difficulty: string | null;
  segment: Segment;
  groupType: GroupType;
  startedTick: number;
  arena?: ArenaFrame;
  rift?: RiftFrame;
  participants: FightParticipant[];
}

/** A participant joining an already-open fight (late add). */
export interface ParticipantJoinRecord {
  t: 'join';
  fightId: string;
  tick: number;
  participant: FightParticipant;
}

/** Capture-time enrichments only the recorder can compute (state joins). */
export interface EventEnrichment {
  /** Pet attribution: the owning player's entityId, joined at drain time. */
  ownerId?: number;
  /** Aura attribution state-join (until the sim emits these on the event). */
  auraSourceId?: number;
  auraId?: string;
  auraStacks?: number;
}

export interface EventRecord {
  t: 'ev';
  fightId: string;
  tick: number;
  /** The drained SimEvent, verbatim. The service stores it raw. */
  ev: Record<string, unknown>;
  x?: EventEnrichment;
}

/**
 * Synthesized mob cast timeline: mobs and bosses never emit cast events, so the
 * recorder derives these from castingAbility transitions on boss/elite mobs.
 */
export interface BossCastRecord {
  t: 'bosscast';
  fightId: string;
  tick: number;
  bossId: number;
  ability: string;
  action: 'start' | 'stop' | 'interrupted';
  /** Total cast seconds, present on 'start'. */
  castTotal?: number;
}

/** Encounter phase transitions and (later) battleground objective records. */
export interface MechRecord {
  t: 'mech';
  fightId: string;
  tick: number;
  kind: 'phase' | 'objective';
  bossId?: number;
  phase?: number;
  detail?: string;
}

/**
 * Sampled continuous streams (positions 2 Hz, hp/resources/threat 1 Hz).
 * Reserved by the contract now; the recorder starts emitting these in the
 * samples/replay phase. data layout per kind is documented in the plan (5.3).
 */
export interface SampleRecord {
  t: 'sample';
  fightId: string;
  tick: number;
  kind: 'pos' | 'res' | 'threat';
  data: unknown[];
}

export interface ParticipantTotals {
  damage: number;
  taken: number;
  healing: number;
  overheal: number;
  absorbed: number;
  deaths: number;
  /** RESERVED: always 0 until sim fidelity round 2 lands castStop reasons;
   * dashboards must render these as unavailable, never as measured zeros. */
  interrupts: number;
  /** RESERVED: always 0 until dispel events carry attribution (round 2). */
  dispels: number;
  activeMs: number;
}

export interface FightCloseRecord {
  t: 'fight_close';
  fightId: string;
  endedTick: number;
  durationMs: number;
  outcome: FightOutcome;
  /** True when the per-fight raw event cap tripped; rollups remain complete. */
  truncated: boolean;
  /** Recorder-side totals, keyed by characterId as a string. */
  rollup: { perParticipant: Record<string, ParticipantTotals> };
}

/**
 * One character row of the daily census snapshot exported by the game host.
 * Carries zero account data by construction: the exporter never reads accounts.
 */
export interface CensusRecord {
  t: 'census';
  /** Snapshot day, YYYY-MM-DD; the service upserts per (realm, day, characterId). */
  snapshotDate: string;
  characterId: number;
  name: string;
  class: string;
  level: number;
  vlevel: number;
  spec: string | null;
  talents: unknown | null;
  equipment: unknown | null;
  prestigeRank: number;
  counters: Record<string, number> | null;
  arena: unknown | null;
  dungeonClears: unknown | null;
  delveClears: unknown | null;
  playtimeSeconds: number;
  playSessions: number;
  createdAt: string | null;
  lastLogin: string | null;
}

/** A versioned content dictionary (abilities, mobs, encounters, specs). */
export interface ContentPackRecord {
  t: 'content_pack';
  build: string;
  payload: unknown;
}

export type ParseRecord =
  | FightOpenRecord
  | ParticipantJoinRecord
  | EventRecord
  | BossCastRecord
  | MechRecord
  | SampleRecord
  | FightCloseRecord
  | CensusRecord
  | ContentPackRecord;

export type BatchLine = BatchHeader | ParseRecord;

/** Every known record discriminator, for validators on both sides. */
export const RECORD_TYPES = [
  'batch',
  'fight_open',
  'join',
  'ev',
  'bosscast',
  'mech',
  'sample',
  'fight_close',
  'census',
  'content_pack',
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];
