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
  GAUNTLET_LAYOUT,
  GAUNTLET_RECRUITER_NPC_ID,
  GAUNTLET_WATCHER_NPC_ID,
} from '../content/gauntlet';
import {
  dungeonAt,
  GAUNTLET_SLOT_COUNT,
  gauntletOrigin,
  isArenaPos,
  isDelvePos,
  isGauntletPos,
  NPCS,
} from '../data';
import { createNpc } from '../entity';
import { restorePetFromDelveStash, stowPetForDelve } from '../pet/pet_commands';
import { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import { DT, type GauntletRunView } from '../types';
import {
  planSentinelScripts,
  rollNpcContestant,
  spawnNpcContestants,
  stagingSpot,
} from './contestants';
import type { GauntletRun } from './state';
import { startSentinel, updateSentinel } from './trial_sentinel';
import { aliveContestants, eliminateContestant, emitToRunPlayers } from './vitality';

export function gauntletRunForPlayer(ctx: SimContext, pid: number): GauntletRun | null {
  return ctx.gauntletRuns.find((r) => r.playerStates.has(pid)) ?? null;
}

function canJoinGauntlet(ctx: SimContext, pid: number): string | null {
  const r = ctx.resolve(pid);
  if (!r || r.e.dead) return 'You cannot enter the Gauntlet right now.';
  if (!ctx.gauntletEventOpen) return 'The Gauntlet is not open right now.';
  if (gauntletRunForPlayer(ctx, pid)) return 'You are already in the Gauntlet.';
  if (dungeonAt(r.e.pos.x)) return 'Leave the dungeon first.';
  if (isArenaPos(r.e.pos.x)) return 'Leave the arena first.';
  if (isDelvePos(r.e.pos.x)) return 'Leave the delve first.';
  if (ctx.tradeFor(pid)) return 'You cannot enter the Gauntlet while trading.';
  if (ctx.duelFor(pid)) return 'You cannot enter the Gauntlet during a duel.';
  if (ctx.arenaMatches.has(pid)) return 'You cannot enter the Gauntlet during an arena match.';
  const recruiter =
    ctx.gauntletRecruiterId !== null ? ctx.entities.get(ctx.gauntletRecruiterId) : undefined;
  if (recruiter) {
    const d = Math.hypot(r.e.pos.x - recruiter.pos.x, r.e.pos.z - recruiter.pos.z);
    if (d > GAUNTLET.joinRadius) return 'You must speak to the Herald to enter the Gauntlet.';
  }
  return null;
}

// Join the filling lobby (opening one if none is filling). Players stay where
// they are during the lobby; the run teleports everyone to the staging area
// when it starts.
export function gauntletJoin(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  const gate = canJoinGauntlet(ctx, id);
  if (gate) {
    ctx.error(id, gate);
    return;
  }
  let run = ctx.gauntletRuns.find((g) => g.phase === 'lobby');
  if (!run) {
    const usedSlots = new Set(ctx.gauntletRuns.map((g) => g.slot));
    let slot = -1;
    for (let i = 0; i < GAUNTLET_SLOT_COUNT; i++) {
      if (!usedSlots.has(i)) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      ctx.error(id, 'The Gauntlet is full. Try again soon.');
      return;
    }
    // Per-run deterministic stream, seeded off the sim clock + run id (the
    // fiesta idiom): never the shared draw stream.
    const seed = (ctx.tickCount * 2654435761 + ctx.nextGauntletRunId * 40503) >>> 0;
    run = {
      id: ctx.nextGauntletRunId++,
      slot,
      seed,
      rng: new Rng(seed),
      origin: gauntletOrigin(slot),
      phase: 'lobby',
      trialIndex: 0,
      phaseEndsAt: ctx.time + GAUNTLET.lobbyFillS,
      prizePool: GAUNTLET.prizeBase,
      contestants: [],
      playerStates: new Map(),
      trial: null,
      watcherId: null,
      podium: null,
      emptyFor: 0,
    };
    ctx.gauntletRuns.push(run);
  }
  run.contestants.push({
    entityId: id,
    player: true,
    name: r.e.name,
    vitality: GAUNTLET.vitalityMax,
    skill: 0,
    eliminatedAtTrial: null,
    script: { speed: 0, fumbleOnFlip: null },
  });
  run.playerStates.set(id, {
    savedPos: { ...r.e.pos },
    spectating: false,
    momentumX: 0,
    momentumZ: 0,
    heldAt: null,
    heldUntil: 0,
    finishedAt: null,
    bestZ: 0,
  });
  emitLobbyState(ctx, run);
  // Single-player worlds skip the fill window: nobody else can ever join, so
  // the run backfills with contestants and starts on the spot.
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
function removePlayerFromRun(
  ctx: SimContext,
  run: GauntletRun,
  pid: number,
  restore: boolean,
): void {
  const ps = run.playerStates.get(pid);
  if (!ps) return;
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

function emitLobbyState(ctx: SimContext, run: GauntletRun): void {
  emitToRunPlayers(ctx, run, (pid) => ({
    type: 'gauntletPhase',
    phase: 'lobby',
    trialIndex: 0,
    survivors: run.contestants.length,
    pid,
  }));
}

function emitPhase(ctx: SimContext, run: GauntletRun): void {
  const survivors = aliveContestants(run).length;
  emitToRunPlayers(ctx, run, (pid) => ({
    type: 'gauntletPhase',
    phase: run.phase,
    trialIndex: run.trialIndex,
    survivors,
    pid,
  }));
}

// Lobby -> staging: finalize the roster (NPC backfill), spawn the field and
// the watcher, teleport the players onto the staging line-up.
function startRun(ctx: SimContext, run: GauntletRun): void {
  const players = run.contestants.filter((c) => c.player);
  const backfill = Math.max(0, GAUNTLET.fieldSize - run.contestants.length);
  for (let i = 0; i < backfill; i++) run.contestants.push(rollNpcContestant(run));
  spawnNpcContestants(ctx, run, players.length);
  const t = GAUNTLET.sentinel;
  const watcherDef = NPCS[GAUNTLET_WATCHER_NPC_ID];
  const watcher = createNpc(ctx.nextId++, watcherDef, {
    x: run.origin.x,
    y: 0,
    z: run.origin.z + t.fieldLength + GAUNTLET_LAYOUT.watcherMargin,
  });
  watcher.facing = 0; // back to the field: green
  ctx.addEntity(watcher);
  run.watcherId = watcher.id;
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
    meta.gauntletStats.runs++;
  }
  run.phase = 'staging';
  run.phaseEndsAt = ctx.time + GAUNTLET.stagingS;
  emitPhase(ctx, run);
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
  if (kind === 'sentinel') {
    planSentinelScripts(run);
    run.phase = 'trial';
    run.phaseEndsAt = ctx.time + GAUNTLET.sentinel.durationS;
    run.trial = startSentinel(ctx, run);
  }
  emitPhase(ctx, run);
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
  for (const c of run.contestants) {
    if (!c.player) continue;
    const meta = ctx.players.get(c.entityId);
    if (!meta) continue;
    const cleared = c.eliminatedAtTrial === null ? GAUNTLET.trials.length : c.eliminatedAtTrial;
    if (cleared > meta.gauntletStats.bestTrial) meta.gauntletStats.bestTrial = cleared;
    if (run.podium.winnerEntityId === c.entityId) meta.gauntletStats.wins++;
  }
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

// Recruiter spawn management: stands in the town square only while the event
// window is open.
function updateRecruiter(ctx: SimContext): void {
  const id = ctx.gauntletRecruiterId;
  if (ctx.gauntletEventOpen && id === null) {
    const def = NPCS[GAUNTLET_RECRUITER_NPC_ID];
    const e = createNpc(ctx.nextId++, def, ctx.groundPos(def.pos.x, def.pos.z));
    ctx.addEntity(e);
    ctx.gauntletRecruiterId = e.id;
  } else if (!ctx.gauntletEventOpen && id !== null) {
    if (ctx.entities.has(id)) ctx.dropEntity(id);
    ctx.gauntletRecruiterId = null;
  }
}

// The per-tick driver, called from the coordinator's end-of-tick system block.
export function updateGauntletRuns(ctx: SimContext): void {
  updateRecruiter(ctx);
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
        if (ctx.time >= run.phaseEndsAt) startTrial(ctx, run);
        break;
      case 'trial': {
        const done = updateSentinel(ctx, run, DT);
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
            emitPhase(ctx, run);
          }
        }
        break;
      }
      case 'interlude':
        if (ctx.time >= run.phaseEndsAt) {
          run.trialIndex++;
          startTrial(ctx, run);
        }
        break;
      case 'podium':
        if (ctx.time >= run.phaseEndsAt) endRun(ctx, run);
        break;
      case 'done':
        break;
    }
  }
}

// The viewer-scoped wire projection (the `grun` self key and
// IWorldGauntlet.gauntletRun). Absolute deadlines only, so the serialized view
// changes rarely and the wire delta can elide it.
export function gauntletRunWire(ctx: SimContext, pid: number): GauntletRunView | null {
  const run = gauntletRunForPlayer(ctx, pid);
  if (!run) return null;
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
    finished: ps?.finishedAt !== null && ps?.finishedAt !== undefined,
    originX: run.origin.x,
    originZ: run.origin.z,
    sentinel:
      trial && trial.kind === 'sentinel'
        ? { light: trial.light, until: trial.flipAt, fieldLength: GAUNTLET.sentinel.fieldLength }
        : null,
    podium: run.podium
      ? { first: run.podium.first, second: run.podium.second, third: run.podium.third }
      : null,
  };
}
