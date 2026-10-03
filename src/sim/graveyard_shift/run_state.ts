// The Graveyard Shift run record and its lookups. One run per owner; the
// registry is the Sim-owned `ctx.graveyardShiftRuns` map (keyed by owner pid),
// so the state lives on Sim and this module only reads it.

import type { BotSteer } from '../bots/steer';
import type { Rng } from '../rng';
import type { ArenaReturnPools, InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import type { MorthenParked } from './morthen_transform';

export type GraveyardShiftOutcome = 'won' | 'lost' | 'aborted';

// One adventurer's decision state (bot_driver.ts), session-only.
export interface BotBrainState {
  readonly rng: Rng;
  readonly steer: BotSteer;
  goalId: number | null;
  seenCast: string | null;
  kickAt: number | null;
  healTargetId: number | null;
  healAt: number;
}

export interface GraveyardShiftBot {
  readonly pid: number;
  readonly role: 'tank' | 'healer' | 'dps';
  readonly brain: BotBrainState;
}

export interface GraveyardShiftRun {
  readonly ownerPid: number;
  // The claimed slot's partyKey, distinct from every instanceKeyFor key so
  // Reset All Instances and the dungeon door never resolve this claim.
  readonly key: string;
  readonly slot: InstanceSlot;
  // What the owner carried in, handed back on every exit (arena parenthesis).
  readonly pools: ArenaReturnPools;
  readonly petStowed: boolean;
  // The owner's real level and talent modifiers while they are Morthen.
  readonly parked: MorthenParked;
  // Sim tick the run started on (the stall timeout counts from it).
  readonly startedTick: number;
  // The run's private rng seed (bot_brain.ts graveyardShiftRunSeed).
  readonly seed: number;
  // The adventurer party, in roster order (spawn order is fixed).
  readonly bots: GraveyardShiftBot[];
  // Morthen's living skeleton allies (run_allies.ts), in spawn order.
  readonly allyIds: number[];
  // Corpses Raise the Fallen already used (each rises once).
  readonly raisedCorpseIds: Set<number>;
  // The party has noticed Morthen (he came close or landed a hit).
  engaged: boolean;
  // Set by a mid-tick decision (a command or, later, a lethal hit); the run tick
  // tears down, never the code path that decided.
  pendingOutcome: GraveyardShiftOutcome | null;
}

export function graveyardShiftRunKey(ownerPid: number): string {
  return `gshift:${ownerPid}`;
}

export function graveyardShiftRunFor(ctx: SimContext, pid: number): GraveyardShiftRun | null {
  return ctx.graveyardShiftRuns.get(pid) ?? null;
}
