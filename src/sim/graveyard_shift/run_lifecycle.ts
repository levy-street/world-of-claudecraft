// Start, end and per-tick watch of a Graveyard Shift run. The owner is moved
// into a private Crypt slot and back; every way of leaving it (a command, a
// teleport, a logout, a death, a party) ends the run through endGraveyardShift,
// which hands back the carried pools and pet on an arena-style clean slate.
// Draws no rng.

import { dismissOwnedGuardians } from '../combat/guardians';
import { despawnTemporaryNecromancyUndead } from '../combat/necromancy';
import { dungeonAt, isArenaPos, isDelvePos } from '../data';
import { gliderActionsLocked } from '../glider_action_lock';
import { instanceClaimHolds, instanceOriginOf, leaveDungeon } from '../instances/dungeons';
import { isInJailCage } from '../jail';
import { forceDismount } from '../mounts';
import { restorePetFromDelveStash, stowPetForDelve } from '../pet/pet_commands';
import { cancelProfessionSessionOnDisplacement } from '../professions/session_teardown';
import { shadowActionsLocked } from '../shadow_action_lock';
import type { SimContext } from '../sim_context';
import {
  arenaQueuedFormat,
  readyArenaFighter,
  restoreArenaReturnPools,
  snapshotArenaReturnPools,
} from '../social/arena';
import { bgGroupContaining } from '../social/battleground';
import { revivePlayerAt } from '../spirit';
import { settleTeleportArrival } from '../teleport_arrival';
import { TICK_RATE } from '../types';
import { wispMazeActionsLocked } from '../wisp_maze_action_lock';
import { applyMorthenIdentity, removeMorthenIdentity } from './morthen_transform';
import { GRAVEYARD_SHIFT_ARRIVAL, graveyardShiftDoorDrop } from './run_layout';
import { removeGraveyardShiftParty, spawnGraveyardShiftParty } from './run_party';
import { claimGraveyardShiftSlot, releaseGraveyardShiftSlot } from './run_slot';
import {
  type GraveyardShiftOutcome,
  type GraveyardShiftRun,
  graveyardShiftRunKey,
} from './run_state';

export const GRAVEYARD_SHIFT_MIN_LEVEL = 10;

// A shift that neither side finishes (a stuck bot, an idle owner) ends here.
export const GRAVEYARD_SHIFT_MAX_SECONDS = 15 * 60;

// Why the owner cannot start a shift right now, or null. Dev-channel English:
// the run is reachable only through /dev while it is a prototype.
export function canStartGraveyardShift(ctx: SimContext, pid: number): string | null {
  // Offline only: a server would autosave the run's state over the real
  // character, and the online client would rebuild the bar from it.
  if (!ctx.cfg.offlineHost || !ctx.devCommands) return 'Graveyard Shift runs offline only.';
  const r = ctx.resolve(pid);
  if (!r || r.e.dead || r.e.ghost) return 'You cannot start a shift right now.';
  if (ctx.graveyardShiftRuns.has(pid)) return 'You are already on shift.';
  if (r.e.level < GRAVEYARD_SHIFT_MIN_LEVEL) {
    return `You must be level ${GRAVEYARD_SHIFT_MIN_LEVEL} to cover a shift.`;
  }
  const { e, meta } = r;
  if (dungeonAt(e.pos.x) || isArenaPos(e.pos.x) || isDelvePos(e.pos.x)) {
    return 'Leave the instance first.';
  }
  if (ctx.partyOf(pid)) return 'Leave your party first.';
  if (ctx.tradeFor(pid) || ctx.duelFor(pid)) return 'Finish your trade or duel first.';
  if (ctx.arenaMatches.has(pid) || ctx.bgMatches.has(pid)) return 'Finish your match first.';
  if (arenaQueuedFormat(ctx, pid) !== null || bgGroupContaining(ctx, pid) !== null) {
    return 'Leave the queue first.';
  }
  if (
    meta.vehicle ||
    gliderActionsLocked(meta.worldQuestLog) ||
    shadowActionsLocked(meta.worldQuestLog) ||
    wispMazeActionsLocked(meta.worldQuestLog)
  ) {
    return 'Finish your current activity first.';
  }
  if (e.jailed || isInJailCage(e.pos) || e.ferryRide) return 'You cannot start a shift from here.';
  return null;
}

// Moves the owner into a fresh private slot. Returns the refusal, or null.
export function startGraveyardShift(ctx: SimContext, pid: number): string | null {
  const gate = canStartGraveyardShift(ctx, pid);
  if (gate) return gate;
  const r = ctx.resolve(pid);
  if (!r) return 'You cannot start a shift right now.';
  const key = graveyardShiftRunKey(pid);
  const slot = claimGraveyardShiftSlot(ctx, key);
  if (!slot) return 'Every crypt is busy. Try again soon.';
  const p = r.e;
  const pools = snapshotArenaReturnPools(p);
  forceDismount(ctx, p);
  despawnTemporaryNecromancyUndead(ctx, pid);
  dismissOwnedGuardians(ctx, pid);
  const stashedBefore = ctx.delvePetStash.has(pid);
  stowPetForDelve(ctx, pid);
  cancelProfessionSessionOnDisplacement(ctx, p);
  const origin = instanceOriginOf(slot);
  p.pos = ctx.groundPos(origin.x + GRAVEYARD_SHIFT_ARRIVAL.x, origin.z + GRAVEYARD_SHIFT_ARRIVAL.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  settleTeleportArrival(p);
  p.facing = GRAVEYARD_SHIFT_ARRIVAL.facing;
  p.prevFacing = GRAVEYARD_SHIFT_ARRIVAL.facing;
  readyArenaFighter(ctx, p, { clearPrep: true });
  const parked = applyMorthenIdentity(ctx, r.meta, p);
  const run: GraveyardShiftRun = {
    ownerPid: pid,
    key,
    slot,
    pools,
    petStowed: !stashedBefore && ctx.delvePetStash.has(pid),
    parked,
    startedTick: ctx.tickCount,
    bots: [],
    pendingOutcome: null,
  };
  ctx.graveyardShiftRuns.set(pid, run);
  spawnGraveyardShiftParty(ctx, run);
  return null;
}

// Hands the real character back and frees the slot. Inside the claim the owner
// is walked out to the Crypt door; a dead owner (corpse or released ghost, since
// Release can land before this tick) is revived at that same door; already
// outside alive (a teleport took them), they are restored where they stand.
// Like every arena-shaped mode, the clean slate sheds the auras carried in.
export function endGraveyardShift(
  ctx: SimContext,
  run: GraveyardShiftRun,
  outcome: GraveyardShiftOutcome,
): void {
  ctx.graveyardShiftRuns.delete(run.ownerPid);
  removeGraveyardShiftParty(ctx, run);
  const p = ctx.entities.get(run.ownerPid);
  const meta = ctx.players.get(run.ownerPid);
  if (p && meta) {
    fizzleProjectilesFrom(ctx, run.ownerPid);
    removeMorthenIdentity(ctx, meta, p, run.parked);
    const died = p.dead || p.ghost;
    if (died) {
      const door = graveyardShiftDoorDrop();
      revivePlayerAt(ctx, run.ownerPid, ctx.groundPos(door.x, door.z), 1);
    }
    readyArenaFighter(ctx, p, { clearPrep: true });
    restoreArenaReturnPools(ctx, p, run.pools);
    if (instanceClaimHolds(run.slot, p.pos)) leaveDungeon(ctx, run.ownerPid);
    if (run.petStowed) restorePetFromDelveStash(ctx, run.ownerPid);
    if (!died) ctx.emit({ type: 'respawn', pid: run.ownerPid });
    ctx.emit({ type: 'log', text: `[dev] Graveyard Shift ended (${outcome}).`, pid: run.ownerPid });
  }
  releaseGraveyardShiftSlot(ctx, run.slot, run.key);
}

// A kit bolt still in flight must not land from the restored real character.
function fizzleProjectilesFrom(ctx: SimContext, pid: number): void {
  const retained = ctx.pendingProjectiles.filter((proj) => proj.sourceId !== pid);
  if (retained.length === ctx.pendingProjectiles.length) return;
  for (const proj of ctx.pendingProjectiles) if (proj.sourceId === pid) proj.fizzle?.();
  ctx.pendingProjectiles = retained;
}

// A bot that leaves the claim (a door trigger, a knockback through a wall) is
// out of the fight: it leaves the run rather than stalling it.
function pruneStrayBots(ctx: SimContext, run: GraveyardShiftRun): void {
  for (let i = run.bots.length - 1; i >= 0; i--) {
    const bot = ctx.entities.get(run.bots[i].pid);
    if (bot && instanceClaimHolds(run.slot, bot.pos)) continue;
    if (bot) ctx.removePlayer(run.bots[i].pid);
    run.bots.splice(i, 1);
  }
}

// The single per-tick entry: every exit the run did not decide itself is caught
// here, one tick late at most. Free when no run exists.
export function updateGraveyardShift(ctx: SimContext): void {
  if (ctx.graveyardShiftRuns.size === 0) return;
  for (const run of [...ctx.graveyardShiftRuns.values()]) {
    const p = ctx.entities.get(run.ownerPid);
    if (!p || !ctx.players.has(run.ownerPid)) endGraveyardShift(ctx, run, 'aborted');
    else if (run.pendingOutcome) endGraveyardShift(ctx, run, run.pendingOutcome);
    else if (p.dead) endGraveyardShift(ctx, run, 'lost');
    else if (run.slot.partyKey !== run.key || !instanceClaimHolds(run.slot, p.pos)) {
      endGraveyardShift(ctx, run, 'aborted');
    } else if (ctx.partyOf(run.ownerPid)) endGraveyardShift(ctx, run, 'aborted');
    else if (ctx.tickCount - run.startedTick >= GRAVEYARD_SHIFT_MAX_SECONDS * TICK_RATE) {
      endGraveyardShift(ctx, run, 'aborted');
    } else {
      pruneStrayBots(ctx, run);
      if (run.bots.every((bot) => ctx.entities.get(bot.pid)?.dead !== false)) {
        endGraveyardShift(ctx, run, 'won');
      }
    }
  }
}
