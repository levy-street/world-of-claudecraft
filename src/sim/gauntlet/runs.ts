// The Gauntlet run lifecycle: the recruiter, the auto-filling lobby, the
// phase machine (lobby -> staging -> [trial -> interlude]* -> podium -> done),
// join/leave/forfeit, and the viewer-scoped wire projection. Trial mechanics
// live in their own trial_* modules; this file only sequences them.
//
// State lives on Sim (`gauntletRuns`, `gauntletRecruiterId`,
// `nextGauntletRunId`, the host-fed `gauntletEventOpen` flag), reached through
// the SimContext seam. Determinism: every draw comes from the per-run stream
// (run.rng, seeded at lobby creation exactly like fiesta's per-match stream);
// an idle or active gauntlet never touches the shared sim rng.

import {
  GAUNTLET,
  GAUNTLET_RECRUITER_ID,
  GAUNTLET_RECRUITER_NPC_ID,
  GAUNTLET_VENUE,
} from '../content/gauntlet';
import {
  dungeonAt,
  GAUNTLET_SLOT_COUNT,
  gauntletOrigin,
  isArenaPos,
  isDelvePos,
  isGauntletPos,
  MINIGAME_HUB,
  MINIGAME_HUB_MARO,
  NPCS,
} from '../data';
import { createNpc } from '../entity';
import { restorePetFromDelveStash, stowPetForDelve } from '../pet/pet_commands';
import { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import { DT, type GauntletRunView } from '../types';
import {
  idleScript,
  placeContestantsAt,
  planSentinelScripts,
  rollNpcContestant,
  spawnNpcContestants,
  stagingSpot,
} from './contestants';
import { holdPodiumOccupants, releasePodiumSeat, seatPodium } from './podium';
import type { GauntletRun } from './state';
import { startCourt, updateCourt } from './trial_court';

// The Final Court's combat-core seam, surfaced through the gauntlet's public
// module so the Sim coordinator reaches it as gauntletMod.* (isHostileTo consults
// gauntletCourtFoes; dealDamage consults the other two, bound onto SimContext).
export {
  gauntletCourtContestant,
  gauntletCourtFoes,
  gauntletCourtTakedown,
} from './trial_court';

import { gauntletEchoTap, seatEchoField, startEcho, updateEcho } from './trial_echo';
import { gauntletPullCircleClick, seatPullField, startPull, updatePull } from './trial_pull';
import { startSentinel, updateSentinel } from './trial_sentinel';
import {
  gauntletTraceSigils,
  seatSigilsField,
  sigilCoverage,
  sigilCoveredMask,
  startSigils,
  updateSigils,
} from './trial_sigils';
import { seatSpanField, startSpan, updateSpan } from './trial_span';
import { aliveContestants, eliminateContestant, emitToRunPlayers } from './vitality';

export function gauntletRunForPlayer(ctx: SimContext, pid: number): GauntletRun | null {
  return ctx.gauntletRuns.find((r) => r.playerStates.has(pid)) ?? null;
}

export function canJoinGauntlet(
  ctx: SimContext,
  pid: number,
  opts?: { ignoreEventOpen?: boolean },
): string | null {
  const r = ctx.resolve(pid);
  if (!r || r.e.dead) return 'You cannot enter the Gauntlet right now.';
  // Practice ignores the event window (an always-on training harness); the queue
  // and spectate still require the event to be open.
  if (!opts?.ignoreEventOpen && !ctx.gauntletEventOpen)
    return 'The Gauntlet is not open right now.';
  if (gauntletRunForPlayer(ctx, pid)) return 'You are already in the Gauntlet.';
  if (ctx.gauntletQueue.some((u) => u.pid === pid)) return 'You are already in the Gauntlet queue.';
  if (ctx.gauntletSpectators.has(pid)) return 'Stop spectating before you enter the Gauntlet.';
  if (dungeonAt(r.e.pos.x)) return 'Leave the dungeon first.';
  if (isArenaPos(r.e.pos.x)) return 'Leave the arena first.';
  if (isDelvePos(r.e.pos.x)) return 'Leave the delve first.';
  if (ctx.tradeFor(pid)) return 'You cannot enter the Gauntlet while trading.';
  if (ctx.duelFor(pid)) return 'You cannot enter the Gauntlet during a duel.';
  if (ctx.arenaMatches.has(pid)) return 'You cannot enter the Gauntlet during an arena match.';
  // Cross-activity exclusion, the other half of which lives at each queue's
  // own join gate (arenaQueueJoin / hcQueueJoin reject gauntlet members): a
  // pending arena, fiesta, or castle-race queue would teleport-fight this run.
  const queuedElsewhere =
    ctx.arenaQueue1v1.includes(pid) ||
    ctx.arenaQueue2v2.some((u) => u.pids.includes(pid)) ||
    ctx.arenaQueueFiesta.some((u) => u.pids.includes(pid)) ||
    ctx.hcQueue.some((u) => u.pid === pid) ||
    ctx.hcMatches.has(pid);
  if (queuedElsewhere) return 'You cannot enter the Gauntlet right now.';
  // No recruiter standing = no join, full stop: the geo-gate must never
  // silently pass while the event flag and the spawn are out of step.
  const recruiter =
    ctx.gauntletRecruiterId !== null ? ctx.entities.get(ctx.gauntletRecruiterId) : undefined;
  if (!recruiter) return 'The Gauntlet is not open right now.';
  const d = Math.hypot(r.e.pos.x - recruiter.pos.x, r.e.pos.z - recruiter.pos.z);
  if (d > GAUNTLET.joinRadius) return 'You must speak to the Herald to enter the Gauntlet.';
  return null;
}

// True if a QUEUED player has since wandered into a conflicting activity (a
// dungeon/arena/delve, an arena/hc match, a trade, or a duel), so the rolling
// matchmaker must drop them from the queue before it teleports them into a game.
// Mirrors the cross-activity guards in canJoinGauntlet (which additionally runs
// the event-window + recruiter-radius gate that a waiting queuer is exempt from).
export function gauntletQueueConflict(ctx: SimContext, pid: number): boolean {
  const e = ctx.entities.get(pid);
  if (!e) return true;
  return (
    !!dungeonAt(e.pos.x) ||
    isArenaPos(e.pos.x) ||
    isDelvePos(e.pos.x) ||
    ctx.arenaMatches.has(pid) ||
    ctx.hcMatches.has(pid) ||
    !!ctx.tradeFor(pid) ||
    !!ctx.duelFor(pid)
  );
}

// Open a fresh run in a free venue slot, or null if the venue is full. The queue
// matchmaker and Practice share this; `countdownS` sets the lobby fill window
// (the long walk-up wait, or the short rolling-queue beat) and `practice` marks a
// private solo run the matchmaker and spectators skip.
export function openLobbyRun(
  ctx: SimContext,
  opts?: { practice?: boolean; countdownS?: number },
): GauntletRun | null {
  const usedSlots = new Set(ctx.gauntletRuns.map((g) => g.slot));
  let slot = -1;
  for (let i = 0; i < GAUNTLET_SLOT_COUNT; i++) {
    if (!usedSlots.has(i)) {
      slot = i;
      break;
    }
  }
  if (slot < 0) return null;
  // Per-run deterministic stream, seeded off the sim clock + run id (the fiesta
  // idiom): never the shared draw stream.
  const seed = (ctx.tickCount * 2654435761 + ctx.nextGauntletRunId * 40503) >>> 0;
  const run: GauntletRun = {
    id: ctx.nextGauntletRunId++,
    slot,
    practice: opts?.practice ?? false,
    seed,
    rng: new Rng(seed),
    origin: gauntletOrigin(slot),
    phase: 'lobby',
    trialIndex: 0,
    phaseEndsAt: ctx.time + (opts?.countdownS ?? GAUNTLET.lobbyFillS),
    prizePool: GAUNTLET.prizeBase,
    contestants: [],
    playerStates: new Map(),
    trial: null,
    watcherId: null,
    podium: null,
    emptyFor: 0,
  };
  ctx.gauntletRuns.push(run);
  return run;
}

// Seat a player into a filling lobby (roster entry + saved state). The caller has
// already gated eligibility and the roster cap.
export function addPlayerToLobby(ctx: SimContext, run: GauntletRun, pid: number): void {
  const e = ctx.entities.get(pid);
  if (!e) return;
  run.contestants.push({
    entityId: pid,
    player: true,
    name: e.name,
    vitality: GAUNTLET.vitalityMax,
    skill: 0,
    cls: 'warrior', // unused for players: they wear their own entity
    skin: 0,
    eliminatedAtTrial: null,
    script: idleScript(),
  });
  run.playerStates.set(pid, {
    savedPos: { ...e.pos },
    savedHp: e.hp,
    spectating: false,
    momentumX: 0,
    momentumZ: 0,
    heldAt: null,
    heldUntil: 0,
    finishedAt: null,
    bestZ: 0,
  });
}

// The instant walk-up join (offline + tests): join the filling lobby (opening one
// if none is filling), starting on the spot when cfg.gauntletInstantLobby is set.
// The player-facing button online is gauntletQueueJoin (gauntlet/modes.ts).
export function gauntletJoin(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  const gate = canJoinGauntlet(ctx, id);
  if (gate) {
    ctx.error(id, gate);
    return;
  }
  let run: GauntletRun | null =
    ctx.gauntletRuns.find((g) => !g.practice && g.phase === 'lobby') ?? null;
  // maxRealPlayers is a hard cap at the door, not just the start-early trigger: a
  // same-tick join burst must never overfill the roster.
  if (run && run.contestants.filter((c) => c.player).length >= GAUNTLET.maxRealPlayers) {
    ctx.error(id, 'The Gauntlet is full. Try again soon.');
    return;
  }
  if (!run) {
    run = openLobbyRun(ctx);
    if (!run) {
      ctx.error(id, 'The Gauntlet is full. Try again soon.');
      return;
    }
  }
  addPlayerToLobby(ctx, run, id);
  emitLobbyState(ctx, run);
  // Single-player worlds skip the fill window: nobody else can ever join, so the
  // run backfills with contestants and starts on the spot.
  if (ctx.cfg.gauntletInstantLobby && run.phase === 'lobby') startRun(ctx, run);
}

// Leave the run at any point: lobby, mid-trial (a forfeit), spectating, or
// after the podium. Restores the pre-run position and the stowed pet.
export function gauntletLeave(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const run = gauntletRunForPlayer(ctx, r.meta.entityId);
  if (!run) return;
  removePlayerFromRun(ctx, run, r.meta.entityId, true);
}

// Detach a player from the run. `restore` teleports them back to their saved
// position (false when they are already elsewhere: died and released, or some
// other system teleported them out of the band).
export function removePlayerFromRun(
  ctx: SimContext,
  run: GauntletRun,
  pid: number,
  restore: boolean,
): void {
  const ps = run.playerStates.get(pid);
  if (!ps) return;
  // The Final Court normalizes a fighter's maxHp; a player leaving mid-court
  // (forfeit / disconnect / stranded) must have their real stats restored FIRST,
  // so the hp restores below clamp against the real maxHp, not the pool.
  if (run.trial?.kind === 'court') {
    const f = run.trial.fighters.get(pid);
    const fe = ctx.entities.get(pid);
    if (f && fe && fe.maxHp !== f.savedMaxHp) ctx.recalcPlayer(fe);
  }
  // Leaving mid-ceremony: drop this player's podium pose so the per-tick pin
  // stops yanking them back to the step after they have been sent home.
  releasePodiumSeat(run, pid);
  const c = run.contestants.find((k) => k.entityId === pid);
  if (run.phase === 'lobby') {
    // The roster is not final yet: withdraw entirely.
    if (c) run.contestants.splice(run.contestants.indexOf(c), 1);
  } else if (c && c.eliminatedAtTrial === null && run.phase !== 'podium' && run.phase !== 'done') {
    // Walking out mid-run is a forfeit: the field sees the knockout.
    eliminateContestant(ctx, run, c, false);
  }
  run.playerStates.delete(pid);
  const e = ctx.entities.get(pid);
  if (e && run.phase !== 'lobby') {
    e.targetId = null; // drop any mirrored court foe so the open-world frame is clean
    e.autoAttack = false; // stop swinging on leave (a mid-court forfeit must not keep auto-attacking)
    restorePlayerHp(ctx, pid, ps);
    if (restore) {
      e.pos = { ...ps.savedPos };
      e.prevPos = { ...e.pos };
      ctx.rebucket(e);
    }
    restorePetFromDelveStash(ctx, pid);
  }
  if (run.phase === 'lobby') {
    if (run.playerStates.size === 0) disposeRun(ctx, run);
    else emitLobbyState(ctx, run);
  }
}

// Disconnect / removePlayer cleanup, called by the Sim coordinator: the
// character is leaving the world, so never teleport, just detach (their saved
// position is NOT restored; they reconnect wherever persistence put them).
export function gauntletOnPlayerRemoved(ctx: SimContext, pid: number): void {
  const run = gauntletRunForPlayer(ctx, pid);
  if (run) removePlayerFromRun(ctx, run, pid, false);
}

export function emitLobbyState(ctx: SimContext, run: GauntletRun): void {
  const remainingS = Math.max(0, run.phaseEndsAt - ctx.time);
  emitToRunPlayers(ctx, run, (pid) => ({
    type: 'gauntletPhase',
    phase: 'lobby',
    trialIndex: 0,
    survivors: run.contestants.length,
    remainingS,
    pid,
  }));
}

function emitPhase(ctx: SimContext, run: GauntletRun): void {
  const survivors = aliveContestants(run).length;
  const remainingS = Math.max(0, run.phaseEndsAt - ctx.time);
  emitToRunPlayers(ctx, run, (pid) => ({
    type: 'gauntletPhase',
    phase: run.phase,
    trialIndex: run.trialIndex,
    survivors,
    remainingS,
    pid,
  }));
}

// Lobby -> staging: finalize the roster (NPC backfill), spawn the field and
// the watcher, teleport the players onto the staging line-up.
export function startRun(ctx: SimContext, run: GauntletRun): void {
  const players = run.contestants.filter((c) => c.player);
  const backfill = Math.max(0, GAUNTLET.fieldSize - run.contestants.length);
  for (let i = 0; i < backfill; i++) run.contestants.push(rollNpcContestant(run));
  spawnNpcContestants(ctx, run, players.length);
  // No watcher ENTITY: the venue's Stone Warden effigy is the watcher (its
  // head and lamps follow the grun light state client-side), and a small NPC
  // standing under a monument reads as a glitch. run.watcherId stays null.
  run.phase = 'staging';
  run.phaseEndsAt = ctx.time + GAUNTLET.stagingS;
  for (let i = 0; i < players.length; i++) {
    const e = ctx.entities.get(players[i].entityId);
    const meta = ctx.players.get(players[i].entityId);
    if (!e || !meta) continue;
    stowPetForDelve(ctx, players[i].entityId);
    const pos = stagingSpot(run, i, run.contestants.length);
    e.pos = { x: pos.x, y: 0, z: pos.z };
    e.prevPos = { ...e.pos };
    e.facing = 0;
    e.targetId = null;
    e.autoAttack = false;
    ctx.rebucket(e);
    if (!run.practice) meta.gauntletStats.runs++; // Practice never touches the ladder
    const ps = run.playerStates.get(players[i].entityId);
    if (ps) {
      // Pin everyone on their mark until the trial opens ("take your marks"
      // is a hold, not a head start): the staging case below snaps held
      // players back each tick, and startTrial releases the pin.
      ps.heldAt = { ...e.pos };
      ps.heldUntil = run.phaseEndsAt;
      // Re-capture the real hp at the teleport (not at join: lobby players
      // are still out in the world and their hp can move), then the per-tick
      // mirror below takes the entity hp over for the run's duration.
      ps.savedHp = e.hp;
    }
  }
  emitPhase(ctx, run);
}

// Every contestant's entity hp mirrors their event vitality while the run is
// live, so nameplates, target frames, and party frames all show the one meter
// that matters in here. Runs in the end-of-tick block AFTER the regen pass,
// so the mirror always wins the tick; the real hp is restored on elimination
// and on leaving the run.
function mirrorVitalityHp(ctx: SimContext, run: GauntletRun): void {
  for (const c of run.contestants) {
    if (c.eliminatedAtTrial !== null) continue;
    const e = ctx.entities.get(c.entityId);
    if (!e || e.dead) continue;
    e.hp = Math.max(1, Math.round((e.maxHp * c.vitality) / GAUNTLET.vitalityMax));
  }
}

// Put a player's real hp back (capped by hpMax in case gear changed mid-run).
function restorePlayerHp(ctx: SimContext, pid: number, ps: { savedHp: number }): void {
  const e = ctx.entities.get(pid);
  if (e && !e.dead) e.hp = Math.max(1, Math.min(ps.savedHp, e.maxHp));
}

// The staging pin: players stand on their marks until the trial opens. This
// runs in the end-of-tick system block, after the movement pass, so any
// displacement this tick is snapped back before it is ever broadcast.
function holdStagedPlayers(ctx: SimContext, run: GauntletRun): void {
  for (const [pid, ps] of run.playerStates) {
    if (!ps.heldAt || ps.spectating) continue;
    const e = ctx.entities.get(pid);
    if (!e) continue;
    e.pos.x = ps.heldAt.x;
    e.pos.y = ps.heldAt.y;
    e.pos.z = ps.heldAt.z;
    ps.momentumX = 0;
    ps.momentumZ = 0;
  }
}

// The desk trials play at an apparatus, not on your feet: their input is the
// slab stroke, the circle click, or the stone click, so the player is seated
// at the station and held there (movement trials stay free).
function isDeskTrial(kind: string | undefined): boolean {
  return kind === 'sigils' || kind === 'pull' || kind === 'echo';
}

// The instance-local arena a trial kind is played at, so the field can be moved
// there the instant its interlude opens. Null for the sentinel (it has staging,
// not an interlude) and unknown kinds.
function trialArenaAnchor(kind: string | undefined): { x: number; z: number } | null {
  const V = GAUNTLET_VENUE;
  switch (kind) {
    case 'sigils':
      return { x: V.sigils.x, z: V.sigils.z };
    case 'pull':
      return { x: V.pull.x, z: V.pull.z + V.pull.width / 2 + 3 }; // south of the pit, not on it
    case 'echo':
      return { x: V.echo.x, z: V.echo.z };
    case 'span':
      return { x: V.span.x, z: V.span.z };
    case 'court':
      return { x: V.court.x, z: V.court.z };
    default:
      return null;
  }
}

// Transport the whole field to the NEXT trial's arena and pin the live players
// there for the interlude countdown, so you arrive as the 'trial cleared' +
// countdown appear (not when the countdown finishes). It is a "waiting" line-up;
// startTrial re-seats everyone at their exact stations when the trial begins
// (and clears these pins for the movement trials).
function positionFieldForNextTrial(ctx: SimContext, run: GauntletRun): void {
  const nextKind = GAUNTLET.trials[run.trialIndex + 1];
  const anchor = trialArenaAnchor(nextKind);
  if (!anchor) return;
  // Stand the field in the NEXT trial's REAL layout (lined up on the rope, at
  // the etching lecterns, at the memory desks, squared up at the crossing), not
  // a generic blob, so the interlude reads as "everyone's already in position."
  // Each seat helper is positioning-only and rng-free. The court pairs its duels
  // with an rng draw at its own start, so it keeps the generic gather here
  // (drawing rng in the interlude would shift the court's stream).
  switch (nextKind) {
    case 'sigils':
      seatSigilsField(ctx, run);
      break;
    case 'pull':
      seatPullField(ctx, run);
      break;
    case 'echo':
      seatEchoField(ctx, run);
      break;
    case 'span':
      seatSpanField(ctx, run);
      break;
    default:
      placeContestantsAt(ctx, run, anchor.x, anchor.z, 6);
  }
  for (const [pid, ps] of run.playerStates) {
    if (ps.spectating) continue;
    const e = ctx.entities.get(pid);
    if (!e) continue;
    ps.heldAt = { ...e.pos };
    ps.heldUntil = run.phaseEndsAt;
    ps.momentumX = 0;
    ps.momentumZ = 0;
  }
}

function startTrial(ctx: SimContext, run: GauntletRun): void {
  const kind = GAUNTLET.trials[run.trialIndex];
  for (const ps of run.playerStates.values()) {
    ps.finishedAt = null;
    ps.bestZ = 0;
    ps.momentumX = 0;
    ps.momentumZ = 0;
    ps.heldAt = null;
  }
  run.phase = 'trial';
  switch (kind) {
    case 'sentinel':
      planSentinelScripts(run);
      run.phaseEndsAt = ctx.time + GAUNTLET.sentinel.durationS;
      run.trial = startSentinel(ctx, run);
      break;
    case 'sigils':
      run.phaseEndsAt = ctx.time + GAUNTLET.sigils.durationS;
      run.trial = startSigils(ctx, run);
      break;
    case 'pull':
      run.phaseEndsAt = ctx.time + GAUNTLET.pull.durationS;
      run.trial = startPull(ctx, run);
      break;
    case 'echo':
      run.phaseEndsAt = ctx.time + GAUNTLET.echo.durationS;
      run.trial = startEcho(ctx, run);
      break;
    case 'span':
      run.phaseEndsAt = ctx.time + GAUNTLET.span.durationS;
      run.trial = startSpan(ctx, run);
      break;
    case 'court':
      run.phaseEndsAt = ctx.time + GAUNTLET.court.durationS;
      run.trial = startCourt(ctx, run);
      break;
  }
  // Desk trials seat and hold you at your station: pin every live player
  // exactly where the trial module just seated them. The trial arm of the
  // driver re-pins each tick; the pin releases at the next startTrial (top of
  // this function) and on knockout (eliminateContestant clears heldAt before
  // parking the spectator).
  if (isDeskTrial(kind)) {
    for (const [pid, ps] of run.playerStates) {
      if (ps.spectating) continue;
      const e = ctx.entities.get(pid);
      if (!e) continue;
      ps.heldAt = { ...e.pos };
      ps.heldUntil = run.phaseEndsAt;
    }
  }
  emitPhase(ctx, run);
}

// One tick of whatever trial is live; true = resolved (the module has dealt
// its end-of-trial damage and culled the NPC field toward its target).
function updateTrial(ctx: SimContext, run: GauntletRun): boolean {
  switch (run.trial?.kind) {
    case 'sentinel':
      return updateSentinel(ctx, run, DT);
    case 'sigils':
      return updateSigils(ctx, run, DT);
    case 'pull':
      return updatePull(ctx, run, DT);
    case 'echo':
      return updateEcho(ctx, run, DT);
    case 'span':
      return updateSpan(ctx, run, DT);
    case 'court':
      return updateCourt(ctx, run, DT);
    default:
      return true;
  }
}

// Trial-input command routers (the IWorld actions land here): each validates
// that the sender is a LIVE contestant in the matching live trial, then hands
// the input to the owning module. Silent drops on mismatch: stale packets
// after a knockout or a phase flip are normal, not errors.
function liveTrialFor(ctx: SimContext, pid: number): GauntletRun | null {
  const run = gauntletRunForPlayer(ctx, pid);
  if (!run || run.phase !== 'trial' || !run.trial) return null;
  const ps = run.playerStates.get(pid);
  if (!ps || ps.spectating) return null;
  return run;
}

export function gauntletTrace(ctx: SimContext, pid: number | undefined, pts: number[]): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const run = liveTrialFor(ctx, r.meta.entityId);
  if (!run || run.trial?.kind !== 'sigils') return;
  gauntletTraceSigils(ctx, run, run.trial, r.meta.entityId, pts);
}

export function gauntletPullCircle(ctx: SimContext, pid: number | undefined, id: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const run = liveTrialFor(ctx, r.meta.entityId);
  if (!run || run.trial?.kind !== 'pull') return;
  gauntletPullCircleClick(ctx, run, run.trial, r.meta.entityId, id);
}

export function gauntletEcho(ctx: SimContext, pid: number | undefined, stone: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const run = liveTrialFor(ctx, r.meta.entityId);
  if (!run || run.trial?.kind !== 'echo') return;
  gauntletEchoTap(ctx, run, run.trial, r.meta.entityId, stone);
}

// Rank the field for the podium: live players by finish time then progress,
// then surviving NPCs by skill, then the fallen in reverse elimination order.
function computePodium(ctx: SimContext, run: GauntletRun): void {
  const alive = aliveContestants(run);
  const players = alive
    .filter((c) => c.player && !run.playerStates.get(c.entityId)?.spectating)
    .sort((a, b) => {
      const pa = run.playerStates.get(a.entityId);
      const pb = run.playerStates.get(b.entityId);
      const fa = pa?.finishedAt ?? Number.POSITIVE_INFINITY;
      const fb = pb?.finishedAt ?? Number.POSITIVE_INFINITY;
      if (fa !== fb) return fa - fb;
      return (pb?.bestZ ?? 0) - (pa?.bestZ ?? 0);
    });
  const npcs = alive.filter((c) => !c.player).sort((a, b) => b.skill - a.skill);
  const fallen = run.contestants.filter((c) => c.eliminatedAtTrial !== null).reverse();
  const ranked = [...players, ...npcs, ...fallen];
  const names = [ranked[0]?.name ?? '', ranked[1]?.name ?? '', ranked[2]?.name ?? ''];
  run.podium = {
    first: names[0],
    second: names[1],
    third: names[2],
    winnerEntityId: ranked[0]?.entityId ?? null,
  };
  // Practice is a training harness: it seats the podium and emits the ceremony
  // below, but never records ladder stats (best trial / wins).
  if (!run.practice) {
    for (const c of run.contestants) {
      if (!c.player) continue;
      const meta = ctx.players.get(c.entityId);
      if (!meta) continue;
      const cleared = c.eliminatedAtTrial === null ? GAUNTLET.trials.length : c.eliminatedAtTrial;
      if (cleared > meta.gauntletStats.bestTrial) meta.gauntletStats.bestTrial = cleared;
      if (run.podium.winnerEntityId === c.entityId) meta.gauntletStats.wins++;
    }
  }
  // Pose the top finishers on the winners' stand for the ceremony (the champion
  // arrives on the podium the instant it opens, not teleported home at the end).
  seatPodium(ctx, run, ranked);
  emitToRunPlayers(ctx, run, (pid) => ({
    type: 'gauntletPodium',
    first: names[0],
    second: names[1],
    third: names[2],
    won: run.podium?.winnerEntityId === pid,
    pid,
  }));
}

// Tear the run down: send remaining players home, drop the field.
function endRun(ctx: SimContext, run: GauntletRun): void {
  for (const pid of [...run.playerStates.keys()]) removePlayerFromRun(ctx, run, pid, true);
  disposeRun(ctx, run);
}

function disposeRun(ctx: SimContext, run: GauntletRun): void {
  for (const c of run.contestants) {
    if (!c.player && c.entityId !== 0 && ctx.entities.has(c.entityId)) ctx.dropEntity(c.entityId);
  }
  if (run.watcherId !== null && ctx.entities.has(run.watcherId)) ctx.dropEntity(run.watcherId);
  run.phase = 'done';
  const i = ctx.gauntletRuns.indexOf(run);
  if (i >= 0) ctx.gauntletRuns.splice(i, 1);
}

// Self-healing forfeit: a run participant who is dead or outside the band
// (another system teleported them: released spirit, arena, a dev command)
// has left the run's reality; detach them without a restore.
function sweepStrandedPlayers(ctx: SimContext, run: GauntletRun): void {
  for (const pid of [...run.playerStates.keys()]) {
    const e = ctx.entities.get(pid);
    if (!e || e.dead || !isGauntletPos(e.pos.x)) removePlayerFromRun(ctx, run, pid, false);
  }
}

// Maro Half-Mask, the Gauntlet recruiter, stands PERMANENTLY in the Proving
// Grounds hub (see data.ts MINIGAME_HUB): the join is still gated by the
// host-fed `gauntletEventOpen` flag (canJoinGauntlet), but his presence no
// longer signals the window. Spawned at world init at a reserved id with zero
// rng (the spawnHcHerald idiom), so the parity goldens never see him.
export function spawnGauntletRecruiter(ctx: SimContext): void {
  if (ctx.entities.has(GAUNTLET_RECRUITER_ID)) return;
  const def = NPCS[GAUNTLET_RECRUITER_NPC_ID];
  const pos = ctx.groundPos(
    MINIGAME_HUB.x + MINIGAME_HUB_MARO.x,
    MINIGAME_HUB.z + MINIGAME_HUB_MARO.z,
  );
  const e = createNpc(GAUNTLET_RECRUITER_ID, def, pos);
  // Face the centre of the ring (facing = atan2 toward the target; the room
  // centre is at -local from Maro's mark).
  e.facing = Math.atan2(-MINIGAME_HUB_MARO.x, -MINIGAME_HUB_MARO.z);
  e.prevFacing = e.facing;
  ctx.addEntity(e);
  ctx.gauntletRecruiterId = e.id;
}

// The per-tick driver, called from the coordinator's end-of-tick system block.
export function updateGauntletRuns(ctx: SimContext): void {
  for (const run of [...ctx.gauntletRuns]) {
    if (run.phase !== 'lobby') sweepStrandedPlayers(ctx, run);
    if (run.playerStates.size === 0 && run.phase !== 'lobby') {
      run.emptyFor += DT;
      if (run.emptyFor >= GAUNTLET.emptyTimeoutS) {
        disposeRun(ctx, run);
        continue;
      }
    } else {
      run.emptyFor = 0;
    }
    // The Final Court fights on REAL hp (normalized per fighter), reverse-
    // mirroring vitality FROM hp itself, so the usual vitality->hp mirror is
    // suppressed while it runs or it would fight the combat.
    if (run.phase !== 'lobby' && run.phase !== 'done' && run.trial?.kind !== 'court')
      mirrorVitalityHp(ctx, run);
    switch (run.phase) {
      case 'lobby': {
        const players = run.contestants.filter((c) => c.player).length;
        if (players === 0) {
          disposeRun(ctx, run);
          break;
        }
        if (ctx.time >= run.phaseEndsAt || players >= GAUNTLET.maxRealPlayers) startRun(ctx, run);
        break;
      }
      case 'staging':
        holdStagedPlayers(ctx, run);
        if (ctx.time >= run.phaseEndsAt) startTrial(ctx, run);
        break;
      case 'trial': {
        // The desk-trial station pin: same snap-back as staging, gated to the
        // seated kinds (sentinel/span/court are movement trials and stay
        // free; the sentinel manages its own catch-stun holds).
        if (isDeskTrial(run.trial?.kind)) holdStagedPlayers(ctx, run);
        const done = updateTrial(ctx, run);
        if (done) {
          run.trial = null;
          if (run.trialIndex + 1 >= GAUNTLET.trials.length) {
            run.phase = 'podium';
            run.phaseEndsAt = ctx.time + GAUNTLET.podiumS;
            computePodium(ctx, run);
            emitPhase(ctx, run);
          } else {
            run.phase = 'interlude';
            run.phaseEndsAt = ctx.time + GAUNTLET.interludeS;
            // Transport to the next arena NOW (as the countdown appears), not
            // when it finishes: you wait out the cooldown standing at the next
            // game's venue.
            positionFieldForNextTrial(ctx, run);
            emitPhase(ctx, run);
          }
        }
        break;
      }
      case 'interlude':
        holdStagedPlayers(ctx, run); // keep the field pinned at the next arena for the countdown
        if (ctx.time >= run.phaseEndsAt) {
          run.trialIndex++;
          startTrial(ctx, run);
        }
        break;
      case 'podium':
        holdPodiumOccupants(ctx, run); // keep the finishers posed on the stand
        if (ctx.time >= run.phaseEndsAt) endRun(ctx, run);
        break;
      case 'done':
        break;
    }
  }
}

// Which live run a free-roaming spectator watches: the active (non-done,
// non-practice) run nearest their position by origin distance, else null.
// Deterministic (no rng); ties resolve by array order (slot allocation order).
export function gauntletSpectatorWatchedRun(ctx: SimContext, pid: number): GauntletRun | null {
  const live = ctx.gauntletRuns.filter((r) => !r.practice && r.phase !== 'done');
  if (live.length === 0) return null;
  const e = ctx.entities.get(pid);
  if (!e) return live[0];
  let best: GauntletRun | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const r of live) {
    const d = Math.hypot(e.pos.x - r.origin.x, e.pos.z - r.origin.z);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

// The watched-run view for a free-roaming spectator: the run's shared standings,
// phase, and the global trial state the venue renders from (the warden light, the
// rope drag, the span reveals), but no personal vitality or per-player trial input.
function gauntletSpectatorWire(ctx: SimContext, pid: number): GauntletRunView | null {
  if (!ctx.gauntletSpectators.has(pid)) return null;
  const run = gauntletSpectatorWatchedRun(ctx, pid);
  if (!run) return null;
  const trial = run.trial;
  return {
    phase: run.phase,
    trialIndex: run.trialIndex,
    trialCount: GAUNTLET.trials.length,
    endsAt: run.phaseEndsAt,
    survivors: aliveContestants(run).length,
    total: run.contestants.length,
    prizePool: run.prizePool,
    vitality: 0,
    vitalityMax: GAUNTLET.vitalityMax,
    spectating: true,
    practice: false, // spectators never watch a private practice run
    finished: false,
    originX: run.origin.x,
    originZ: run.origin.z,
    board: run.contestants.map((k) => ({
      name: k.name,
      vitality: k.vitality,
      out: k.eliminatedAtTrial !== null,
      you: false,
    })),
    sentinel:
      trial && trial.kind === 'sentinel'
        ? { light: trial.light, until: trial.flipAt, fieldLength: GAUNTLET.sentinel.fieldLength }
        : null,
    sigils: null,
    pull:
      trial?.kind === 'pull'
        ? {
            marker: Math.round(trial.marker * 10) / 10,
            winThreshold: GAUNTLET.pull.winThreshold,
            kx: Math.round(trial.kx * 20) / 20,
            circle: null,
          }
        : null,
    echo: null,
    span: trial?.kind === 'span' ? { steps: GAUNTLET.span.steps, revealed: trial.revealed } : null,
    podium: run.podium
      ? { first: run.podium.first, second: run.podium.second, third: run.podium.third }
      : null,
  };
}

// The viewer-scoped wire projection (the `grun` self key and
// IWorldGauntlet.gauntletRun). Absolute deadlines only, so the serialized view
// changes rarely and the wire delta can elide it.
export function gauntletRunWire(ctx: SimContext, pid: number): GauntletRunView | null {
  const run = gauntletRunForPlayer(ctx, pid);
  // Free-roaming spectators are in no run: give them the watched run's board.
  if (!run) return gauntletSpectatorWire(ctx, pid);
  const ps = run.playerStates.get(pid);
  const c = run.contestants.find((k) => k.entityId === pid);
  const trial = run.trial;
  return {
    phase: run.phase,
    trialIndex: run.trialIndex,
    trialCount: GAUNTLET.trials.length,
    endsAt: run.phaseEndsAt,
    survivors: aliveContestants(run).length,
    total: run.contestants.length,
    prizePool: run.prizePool,
    vitality: c?.vitality ?? 0,
    vitalityMax: GAUNTLET.vitalityMax,
    spectating: ps?.spectating ?? false,
    practice: run.practice,
    finished: ps?.finishedAt !== null && ps?.finishedAt !== undefined,
    originX: run.origin.x,
    originZ: run.origin.z,
    // The standings board: every contestant in roster order (players first,
    // then the NPC backfill). vitality is the raw event pool (integer already),
    // out flags a knockout, you marks the viewer's own row. Only changes on a
    // vitality hit or a knockout, so the wire delta elides quiet ticks.
    board: run.contestants.map((k) => ({
      name: k.name,
      vitality: k.vitality,
      out: k.eliminatedAtTrial !== null,
      you: k.entityId === pid,
    })),
    sentinel:
      trial && trial.kind === 'sentinel'
        ? { light: trial.light, until: trial.flipAt, fieldLength: GAUNTLET.sentinel.fieldLength }
        : null,
    // Per-trial viewer substates. Continuous values are QUANTIZED here so the
    // serialized view only changes on meaningful movement and the wire delta
    // still elides quiet ticks.
    sigils: (() => {
      if (trial?.kind !== 'sigils') return null;
      const sp = trial.players.get(pid);
      if (!sp) return null;
      return {
        shapeSeed: sp.shapeSeed,
        shapeId: sp.shapeId,
        crack: Math.round(sp.crack),
        crackMax: GAUNTLET.sigils.crackMax,
        progress: Math.round(sigilCoverage(sp) * 100) / 100,
        coveredMask: sigilCoveredMask(sp),
      };
    })(),
    pull: (() => {
      if (trial?.kind !== 'pull') return null;
      const c = ps?.spectating ? undefined : trial.circles.get(pid);
      return {
        // ABSOLUTE marker (+ = team 0 winning): the teams stand on the
        // rope now, so the meter is the physical rope, never a
        // viewer-relative bar.
        marker: Math.round(trial.marker * 10) / 10,
        winThreshold: GAUNTLET.pull.winThreshold,
        // The eased translation the sim drags every grip (and pin) by: the
        // venue renders the rope FROM this so hands never leave the rope.
        kx: Math.round(trial.kx * 20) / 20,
        // The viewer's live circle rides whole (absolute spawnAt + the rolled
        // shrink), so it only changes when a circle resolves and quiet ticks
        // still delta-elide.
        circle: c
          ? {
              id: c.id,
              spawnAt: c.spawnAt,
              shrinkS: c.shrinkS,
              startSize: GAUNTLET.pull.circleStartSize,
              targetSize: GAUNTLET.pull.circleTargetSize,
            }
          : null,
      };
    })(),
    echo: (() => {
      if (trial?.kind !== 'echo') return null;
      const ep = trial.players.get(pid);
      if (!ep) return null;
      return {
        stones: GAUNTLET.echo.stones,
        round: ep.round,
        rounds: GAUNTLET.echo.rounds,
        seq: ep.seq,
        showStartAt: ep.showStartAt,
        stepS: GAUNTLET.echo.stepS,
        inputEndsAt: ep.inputEndsAt,
        progress: ep.progress,
        done: ep.done,
      };
    })(),
    span: trial?.kind === 'span' ? { steps: GAUNTLET.span.steps, revealed: trial.revealed } : null,
    podium: run.podium
      ? { first: run.podium.first, second: run.podium.second, third: run.podium.third }
      : null,
  };
}
