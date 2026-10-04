// The end of a shift, played in the Crypt before anyone is sent home. A loss
// holds a short scene: Morthen lies defeated (a lockout aura the client draws
// as the death pose; he never really dies), the party stands down and gloats,
// and the run ends after LOSS_OUTRO_TICKS (shift_end_marks.ts; the client
// fades out over the last LOSS_FADE_TICKS). A win clears the party out and opens the Staff Exit behind
// the throne: the owner leaves through it whenever they like, or the run ends
// on its own after WON_OUTRO_MAX_TICKS. Fixed timings, no rng.

import { createGroundObject } from '../entity';
import { instanceOriginOf } from '../instances/dungeons';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';
import { dist2d, TICK_RATE } from '../types';
import { grantBossForADay } from './grave_staging';
import { dismissGraveyardShiftAllies } from './run_allies';
import { GRAVEYARD_SHIFT_DUNGEON_ID, GRAVEYARD_SHIFT_STAFF_EXIT } from './run_layout';
import type { GraveyardShiftOutcome, GraveyardShiftRun } from './run_state';
import {
  DEFEATED_AURA_ID,
  DEFEATED_AURA_NAME,
  LOSS_OUTRO_TICKS,
  STAFF_EXIT_NAME,
} from './shift_end_marks';

export const WON_OUTRO_MAX_TICKS = 180 * TICK_RATE;
// Walking into the Staff Exit takes it, like a dungeon door.
export const STAFF_EXIT_TRIGGER_RADIUS = 2.5;

export function defeatedAura(ownerId: number): Aura {
  return {
    id: DEFEATED_AURA_ID,
    name: DEFEATED_AURA_NAME,
    // A total lockout through the ordinary stun rules (no move, cast or swing);
    // pushed directly, past the identity's CC immunity, which guards the fight.
    kind: 'stun',
    remaining: LOSS_OUTRO_TICKS / TICK_RATE + 1,
    duration: LOSS_OUTRO_TICKS / TICK_RATE + 1,
    undispellable: true,
    value: 0,
    sourceId: ownerId,
    school: 'physical',
  };
}

function standDown(ctx: SimContext, e: Entity): void {
  if (e.castingAbility) ctx.cancelCast(e);
  e.autoAttack = false;
  const meta = ctx.players.get(e.id);
  if (meta) meta.moveInput.forward = false;
}

export function startLossOutro(ctx: SimContext, run: GraveyardShiftRun): void {
  run.outro = { kind: 'lost', startedTick: ctx.tickCount, portalId: null, leaving: false };
  const owner = ctx.entities.get(run.ownerPid);
  if (owner) {
    standDown(ctx, owner);
    owner.targetId = null;
    owner.auras.push(defeatedAura(owner.id));
  }
  for (const bot of run.bots) {
    const e = ctx.entities.get(bot.pid);
    if (e && !e.dead) standDown(ctx, e);
  }
  dismissGraveyardShiftAllies(ctx, run);
}

// The stock dungeon exit object under its own name, joined to the slot's
// objects so freeing the slot tears it down.
function openStaffExit(ctx: SimContext, run: GraveyardShiftRun): number {
  const origin = instanceOriginOf(run.slot);
  const exit = createGroundObject(
    ctx.nextId++,
    '',
    STAFF_EXIT_NAME,
    ctx.groundPos(origin.x + GRAVEYARD_SHIFT_STAFF_EXIT.x, origin.z + GRAVEYARD_SHIFT_STAFF_EXIT.z),
  );
  exit.templateId = 'dungeon_exit';
  exit.dungeonId = GRAVEYARD_SHIFT_DUNGEON_ID;
  exit.objectItemId = null;
  exit.lootable = true;
  ctx.addEntity(exit);
  run.slot.objectIds.push(exit.id);
  return exit.id;
}

export function startWonOutro(ctx: SimContext, run: GraveyardShiftRun): void {
  run.outro = { kind: 'won', startedTick: ctx.tickCount, portalId: null, leaving: false };
  // The one who gave up walks out; the fallen stay where they lie.
  for (const bot of run.bots) {
    const e = ctx.entities.get(bot.pid);
    if (e && !e.dead) ctx.removePlayer(bot.pid);
  }
  for (const id of run.allyIds) {
    const ally = ctx.entities.get(id);
    if (ally) ally.petMode = 'passive';
  }
  run.outro.portalId = openStaffExit(ctx, run);
  // The deed lands with the win: its banner and sound tell the fight is over.
  grantBossForADay(ctx, run);
}

/** The outcome the outro ends on this tick, or null while it plays. */
export function graveyardShiftOutroEnd(
  ctx: SimContext,
  run: GraveyardShiftRun,
): GraveyardShiftOutcome | null {
  const outro = run.outro;
  if (!outro) return null;
  const elapsed = ctx.tickCount - outro.startedTick;
  if (outro.kind === 'lost') return elapsed >= LOSS_OUTRO_TICKS ? 'lost' : null;
  const owner = ctx.entities.get(run.ownerPid);
  const exit = outro.portalId !== null ? ctx.entities.get(outro.portalId) : undefined;
  if (owner && exit && dist2d(owner.pos, exit.pos) <= STAFF_EXIT_TRIGGER_RADIUS) {
    outro.leaving = true;
  }
  return outro.leaving || elapsed >= WON_OUTRO_MAX_TICKS ? 'won' : null;
}
