// The Graveyard Shift run record and its lookups. One run per owner; the
// registry is the Sim-owned `ctx.graveyardShiftRuns` map (keyed by owner pid),
// so the state lives on Sim and this module only reads it.

import type { BotSteer } from '../bots/steer';
import type { Rng } from '../rng';
import type { ArenaReturnPools, InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import type { PlayerClass } from '../types';
import type { BotSayState } from './bot_say';
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
  readonly cls: PlayerClass;
  readonly brain: BotBrainState;
  // The corpse run (corpse_run.ts): deaths so far, the tick of the current
  // death (null while standing), and walking back in, not yet heard arriving.
  deaths: number;
  diedTick: number | null;
  returning: boolean;
}

// The scene a shift ends on (outro.ts), once the fight is decided.
export interface GraveyardShiftOutro {
  readonly kind: 'lost' | 'won';
  readonly startedTick: number;
  // The Staff Exit's ground object on a win, once it stands.
  portalId: number | null;
  // Set when the owner steps through the Staff Exit.
  leaving: boolean;
}

export interface GraveyardShiftRun {
  readonly ownerPid: number;
  // How the shift began: the dev command, or Tibbs at his grave (a grave shift
  // ends back in front of him, grave_staging.ts).
  readonly entry: 'dev' | 'grave';
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
  // The opening's pack (also among the allies while it stands) and cleared-room
  // corpses (run_opening.ts): the teardown drops both, a fallen pack mob too.
  readonly packIds: number[];
  readonly corpseIds: number[];
  // Corpses Raise the Fallen already used (each rises once).
  readonly raisedCorpseIds: Set<number>;
  // The party is fighting (the opening's pack starts it at once).
  engaged: boolean;
  // The party has noticed Morthen himself (he came within its notice radius):
  // until then nobody targets or answers him.
  noticed: boolean;
  // Set by a mid-tick decision (a command or, later, a lethal hit); the run tick
  // tears down, never the code path that decided.
  pendingOutcome: GraveyardShiftOutcome | null;
  // The closing scene, null while the fight is on.
  outro: GraveyardShiftOutro | null;
  // The adventurers' say-line state (bot_say.ts), created on its first tick.
  say?: BotSayState;
}

export function graveyardShiftRunKey(ownerPid: number): string {
  return `gshift:${ownerPid}`;
}

export function graveyardShiftRunFor(ctx: SimContext, pid: number): GraveyardShiftRun | null {
  return ctx.graveyardShiftRuns.get(pid) ?? null;
}

// Whether a pid is one of a run's adventurers. Keyed on the roster, not the
// marker aura: a death strips auras, and a fallen adventurer is still one.
export function isGraveyardShiftBotPid(ctx: SimContext, pid: number): boolean {
  for (const run of ctx.graveyardShiftRuns.values()) {
    if (run.bots.some((bot) => bot.pid === pid)) return true;
  }
  return false;
}
