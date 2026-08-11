// Structural views of the sim state the recorder reads, kept minimal so unit
// tests script a fake sim and the real Sim satisfies them at the hook site.
// The recorder is a read-only observer: nothing in server/parse/ may mutate
// the sim, draw rng, or import DOM/render/ui code.
import type { FightParticipant, Surface } from './contract';
import type { ParseCounters } from './counters';

export interface RecorderEntityView {
  id: number;
  templateId: string;
  /** Display name; feeds the fight_close actor roster so the dashboard can
   * label mob entity ids. The live Sim entity always carries one. */
  name: string;
  level: number;
  hp?: number;
  maxHp?: number;
  dead?: boolean;
  inCombat?: boolean;
  ownerId?: number | null;
  castingAbility?: string | null;
  castRemaining?: number;
  castTotal?: number;
  castTargetId?: number | null;
  threat?: ReadonlyMap<number, number>;
  auras?: readonly { id: string; name: string; sourceId: number; stacks?: number }[];
}

export interface ArenaMatchView {
  id: number;
  format: string;
  teamA: number[];
  teamB: number[];
  state: string;
  ratingA: number;
  ratingB: number;
  defeated: ReadonlySet<number>;
  practice?: boolean;
  fiesta?: unknown;
  yumi?: unknown;
}

export interface BgMatchView {
  id: number;
  teams: [number[], number[]];
  state: string;
  winner: number | null;
  scores: [number, number];
  rated: boolean;
  devEnded: boolean;
  grouped: boolean;
  ratingAvg: [number, number];
}

export interface InstanceSlotView {
  dungeonId: string;
  difficulty: string;
  slot: number;
  partyKey: string | null;
  mobIds: readonly number[];
}

export interface RiftInstanceView {
  instanceId: number;
  tier: string | null;
  baseLevel: number;
  floorIndex: number;
  floorCount: number;
  bossId: number | null;
  outcome: string;
  memberIds: ReadonlySet<number>;
  portalId: number | null;
}

export interface RiftPortalView {
  id: number;
  zoneName: string;
}

/** The slice of Sim the recorder observes each tick. */
export interface RecorderSim {
  tickCount: number;
  entities: ReadonlyMap<number, RecorderEntityView>;
  arenaMatches: ReadonlyMap<number, ArenaMatchView>;
  bgMatches: ReadonlyMap<number, BgMatchView>;
  instances: readonly InstanceSlotView[];
  riftInstances: readonly RiftInstanceView[];
  naturalRiftPortals: readonly RiftPortalView[];
}

/** Wire-record consumer; the production sink is the BatchShipper. */
export interface RecordSink {
  enqueue(record: Record<string, unknown>): void;
}

/** Host services the segmenters need; game.ts supplies the production one. */
export interface SegmenterHost {
  sim: RecorderSim;
  sink: RecordSink;
  counters: ParseCounters;
  /** Full participant identity + snapshot; null when the pid has no session. */
  resolveParticipant(pid: number): FightParticipant | null;
  nextFightId(): string;
  surfaceEnabled(surface: Surface): boolean;
  /** Boss detection by mob template (MOBS boss flag in production). */
  isBossTemplate(templateId: string): boolean;
}
