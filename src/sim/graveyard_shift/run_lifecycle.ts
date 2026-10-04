// Start, end and per-tick watch of a Graveyard Shift run. The owner is moved
// into a private Crypt slot and back; every way of leaving it (a command, a
// teleport, a logout, a death, a party) ends the run through endGraveyardShift,
// which hands back the carried pools and pet on an arena-style clean slate.
// Draws no rng.

import { dismissOwnedGuardians } from '../combat/guardians';
import { despawnTemporaryNecromancyUndead } from '../combat/necromancy';
import { CLASSES, dungeonAt, isArenaPos, isDelvePos } from '../data';
import { gliderActionsLocked } from '../glider_action_lock';
import { instanceClaimHolds, instanceOriginOf, leaveDungeon } from '../instances/dungeons';
import { isInJailCage } from '../jail';
import { forceDismount } from '../mounts';
import { restorePetFromDelveStash, stowPetForDelve } from '../pet/pet_commands';
import { cancelProfessionSessionOnDisplacement } from '../professions/session_teardown';
import { persistedResource } from '../serialize_resource';
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
import { graveyardShiftRunSeed } from './bot_brain';
import { updateGraveyardShiftBots } from './bot_driver';
import { sayGraveyardShiftGiveUp, updateGraveyardShiftSay } from './bot_say';
import { partyGivesUp, partyWiped, updateGraveyardShiftCorpseRuns } from './corpse_run';
import { GRAVEYARD_SHIFT_MIN_LEVEL } from './grave_entry';
import {
  endShiftAtGrave,
  graveyardShiftEligibleFor,
  tibbsFor,
  tibbsSay,
  updateGraveyardShiftGrave,
} from './grave_staging';
import { applyMorthenIdentity, removeMorthenIdentity } from './morthen_transform';
import { graveyardShiftOutroEnd, startLossOutro, startWonOutro } from './outro';
import {
  dismissGraveyardShiftAllies,
  spawnGraveyardShiftAllies,
  updateGraveyardShiftAllies,
} from './run_allies';
import { GRAVEYARD_SHIFT_ARRIVAL, graveyardShiftDoorDrop } from './run_layout';
import { removeGraveyardShiftOpening, spawnGraveyardShiftOpening } from './run_opening';
import { removeGraveyardShiftParty, spawnGraveyardShiftParty } from './run_party';
import { claimGraveyardShiftSlot, releaseGraveyardShiftSlot } from './run_slot';
import {
  type GraveyardShiftOutcome,
  type GraveyardShiftRun,
  graveyardShiftRunKey,
} from './run_state';

export { GRAVEYARD_SHIFT_MIN_LEVEL };

// A shift that neither side finishes (a stuck bot, an idle owner) ends here.
export const GRAVEYARD_SHIFT_MAX_SECONDS = 15 * 60;
// Concurrent runs per realm (owner pick): 4 of the Hollow Crypt's slots at most,
// the rest stay free for real groups.
export const GRAVEYARD_SHIFT_MAX_CONCURRENT_RUNS = 4;

// Why the owner cannot start a shift right now, or null. Dev-channel English,
// read by the dev command; the grave answers any refusal with one Tibbs line.
export function canStartGraveyardShift(
  ctx: SimContext,
  pid: number,
  entry: 'dev' | 'grave' = 'dev',
): string | null {
  // Every host runs it (the save override, the session edges, the per-viewer
  // grave and the client mirror make it safe online); the dev entry alone stays
  // behind dev commands.
  if (entry === 'dev' && !ctx.devCommands) return 'Graveyard Shift needs dev commands.';
  const r = ctx.resolve(pid);
  if (!r || r.e.dead || r.e.ghost) return 'You cannot start a shift right now.';
  if (ctx.graveyardShiftRuns.has(pid)) return 'You are already on shift.';
  // A realm shares its Hollow Crypt slots with real groups: a few shifts at once.
  if (ctx.graveyardShiftRuns.size >= GRAVEYARD_SHIFT_MAX_CONCURRENT_RUNS) {
    return 'Every crypt is busy. Try again soon.';
  }
  if (r.e.level < GRAVEYARD_SHIFT_MIN_LEVEL) {
    return `You must be level ${GRAVEYARD_SHIFT_MIN_LEVEL} to cover a shift.`;
  }
  const { e, meta } = r;
  if (dungeonAt(e.pos.x) || isArenaPos(e.pos.x) || isDelvePos(e.pos.x)) {
    return 'Leave the instance first.';
  }
  if (ctx.partyOf(pid)) return 'Leave your party first.';
  if (e.inCombat) return 'Leave combat first.';
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
export function startGraveyardShift(
  ctx: SimContext,
  pid: number,
  entry: 'dev' | 'grave' = 'dev',
): string | null {
  const gate = canStartGraveyardShift(ctx, pid, entry);
  if (gate) return gate;
  const r = ctx.resolve(pid);
  if (!r) return 'You cannot start a shift right now.';
  const key = graveyardShiftRunKey(pid);
  const slot = claimGraveyardShiftSlot(ctx, key);
  if (!slot) return 'Every crypt is busy. Try again soon.';
  const p = r.e;
  const pools = snapshotArenaReturnPools(p);
  const savedResource = persistedResource(
    CLASSES[r.meta.cls].resourceType,
    p.resourceType,
    p.resource,
    p.savedMana,
  );
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
    entry,
    key,
    slot,
    pools,
    savedResource,
    petStowed: !stashedBefore && ctx.delvePetStash.has(pid),
    parked,
    startedTick: ctx.tickCount,
    seed: graveyardShiftRunSeed(ctx.cfg.seed, ctx.tickCount, pid),
    bots: [],
    allyIds: [],
    packIds: [],
    corpseIds: [],
    raisedCorpseIds: new Set(),
    engaged: false,
    noticed: false,
    pendingOutcome: null,
    outro: null,
  };
  ctx.graveyardShiftRuns.set(pid, run);
  spawnGraveyardShiftParty(ctx, run);
  spawnGraveyardShiftAllies(ctx, run, p);
  spawnGraveyardShiftOpening(ctx, run, p);
  return null;
}

// The targeted interact on Tibbs: the player took the shift. A refusal (a
// party, a fight, a queue) is one Tibbs line rather than a dev message.
export function acceptGraveyardShiftFromTibbs(ctx: SimContext, pid: number, tibbsId: number): void {
  // Only the player who woke him holds his offer: the Tibbs answered must be theirs.
  if (tibbsFor(ctx, pid)?.id !== tibbsId) return;
  // Won once is won: Tibbs is still up for his report, but the shift is closed.
  if (!graveyardShiftEligibleFor(ctx, pid)) {
    tibbsSay(ctx, pid, 'covered');
    return;
  }
  if (canStartGraveyardShift(ctx, pid, 'grave') !== null) {
    tibbsSay(ctx, pid, 'busy');
    return;
  }
  tibbsSay(ctx, pid, startGraveyardShift(ctx, pid, 'grave') === null ? 'accept' : 'busy');
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
  leaving = false,
): void {
  ctx.graveyardShiftRuns.delete(run.ownerPid);
  // Tibbs' report counts, taken before the party and the allies are cleared.
  const report = {
    sent: run.bots.reduce((sum, bot) => sum + bot.deaths, 0),
    saved: run.allyIds.filter((id) => ctx.entities.get(id)?.dead === false).length,
  };
  removeGraveyardShiftParty(ctx, run);
  dismissGraveyardShiftAllies(ctx, run);
  removeGraveyardShiftOpening(ctx, run);
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
    if (run.entry === 'dev') {
      ctx.emit({
        type: 'log',
        text: `[dev] Graveyard Shift ended (${outcome}).`,
        pid: run.ownerPid,
      });
    }
  }
  releaseGraveyardShiftSlot(ctx, run.slot, run.key);
  if (run.entry === 'grave') endShiftAtGrave(ctx, run, outcome, report, leaving);
}

/** The owner is leaving the world (logout, a dropped connection, jail): the run
 *  ends now, before the host's save, never a tick later. A won scene keeps its
 *  win (the deed and the pay are already granted); anything else aborts. */
export function graveyardShiftResolveLeave(ctx: SimContext, pid: number): void {
  const run = ctx.graveyardShiftRuns.get(pid);
  if (!run) return;
  // The outcome the next tick would have reached: a won scene stays won, a loss
  // already decided (the lethal-blow clamp, the lost scene) stays lost.
  const lost = run.pendingOutcome === 'lost' || run.outro?.kind === 'lost';
  const outcome = run.outro?.kind === 'won' ? 'won' : lost ? 'lost' : 'aborted';
  endGraveyardShift(ctx, run, outcome, true);
}

// Anything Morthen still has in flight must not land from the restored real character.
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
    ctx.graveyardShiftRuns.botPids.delete(run.bots[i].pid);
    if (bot) ctx.removePlayer(run.bots[i].pid);
    run.bots.splice(i, 1);
  }
}

// The single per-tick entry: every exit the run did not decide itself is caught
// here, one tick late at most. Free when no run exists.
export function updateGraveyardShift(ctx: SimContext): void {
  updateGraveyardShiftGrave(ctx);
  if (ctx.graveyardShiftRuns.size === 0) return;
  // A run's teardown deletes only its own entry, which Map iteration allows.
  for (const run of ctx.graveyardShiftRuns.values()) {
    updateGraveyardShiftSay(ctx, run);
    const p = ctx.entities.get(run.ownerPid);
    const outroEnd = graveyardShiftOutroEnd(ctx, run);
    if (!p || !ctx.players.has(run.ownerPid)) endGraveyardShift(ctx, run, 'aborted');
    else if (outroEnd) endGraveyardShift(ctx, run, outroEnd);
    else if (run.pendingOutcome === 'lost' && !run.outro) startLossOutro(ctx, run);
    else if (run.pendingOutcome && run.pendingOutcome !== 'lost') {
      endGraveyardShift(ctx, run, run.pendingOutcome);
    } else if (p.dead) {
      // A won fight stays won (its deed and pay are granted): a stray hit in the
      // won scene cannot turn it into a loss.
      endGraveyardShift(ctx, run, run.outro?.kind === 'won' ? 'won' : 'lost');
    } else if (run.outro) {
      // A won owner who gets out some other way has still finished the shift.
      if (!instanceClaimHolds(run.slot, p.pos)) endGraveyardShift(ctx, run, run.outro.kind);
    } else if (run.slot.partyKey !== run.key || !instanceClaimHolds(run.slot, p.pos)) {
      endGraveyardShift(ctx, run, 'aborted');
    } else if (ctx.partyOf(run.ownerPid)) endGraveyardShift(ctx, run, 'aborted');
    else if (ctx.tickCount - run.startedTick >= GRAVEYARD_SHIFT_MAX_SECONDS * TICK_RATE) {
      endGraveyardShift(ctx, run, 'aborted');
    } else {
      pruneStrayBots(ctx, run);
      updateGraveyardShiftCorpseRuns(ctx, run);
      if (partyWiped(ctx, run)) startWonOutro(ctx, run);
      else if (partyGivesUp(ctx, run)) {
        sayGraveyardShiftGiveUp(ctx, run);
        startWonOutro(ctx, run);
      } else {
        updateGraveyardShiftAllies(ctx, run);
        updateGraveyardShiftBots(ctx, run);
      }
    }
  }
}
