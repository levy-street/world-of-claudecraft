// Structural views of the sim state the recorder reads, kept minimal so unit
// tests script a fake sim and the real Sim satisfies them at the hook site.
// The recorder is a read-only observer: nothing in server/parse/ may mutate
// the sim, draw rng, or import DOM/render/ui code.
import type { FightParticipant, Surface } from './contract';
import type { ParseCounters } from './counters';

export interface RecorderEntityView {
  id: number;
  templateId: string;
  level: number;
  dead?: boolean;
  ownerId?: number | null;
  inCombat?: boolean;
  castingAbility?: string | null;
  castTotal?: number;
  castTargetId?: number | null;
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

/** The slice of Sim the recorder observes each tick. */
export interface RecorderSim {
  tickCount: number;
  entities: ReadonlyMap<number, RecorderEntityView>;
  arenaMatches: ReadonlyMap<number, ArenaMatchView>;
  bgMatches: ReadonlyMap<number, BgMatchView>;
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
}
