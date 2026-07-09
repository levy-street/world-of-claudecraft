// The Gauntlet's three player-facing join modes, layered on the run lifecycle in
// runs.ts:
//   - Queue: a fair, FIFO, rolling matchmaker. Players wait in gauntletQueue; the
//     matchmaker forms the next game from the FRONT the moment no live queue game
//     is running (sequential rolling, "when one ends the next starts"). A rejoiner
//     goes to the BACK so nobody jumps the wait.
//   - Practice: an instant private solo run against a full field of NPC bots,
//     available even when the event window is closed. Never records ladder stats.
//   - Spectate: a free-roaming observer who is in no run, sees the watched run's
//     standings, and renders at 20% opacity to other players.
//
// Backing state lives on Sim (`gauntletQueue`, `gauntletSpectators`), reached
// through the SimContext seam. Determinism: this module draws NO shared-stream rng
// (the queue is pure list ops; run internals keep drawing from the per-run stream
// in runs.ts), so the parity draw-order gate is untouched.

import { GAUNTLET, GAUNTLET_LAYOUT } from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import {
  addPlayerToLobby,
  canJoinGauntlet,
  emitLobbyState,
  gauntletQueueConflict,
  gauntletRunForPlayer,
  gauntletSpectatorWatchedRun,
  gauntletLeave as leaveRun,
  openLobbyRun,
  removePlayerFromRun,
  startRun,
} from './runs';

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

// 1-based position in the rolling queue, or 0 when not queued.
export function gauntletQueuePosition(ctx: SimContext, pid: number): number {
  return ctx.gauntletQueue.findIndex((u) => u.pid === pid) + 1;
}

export function gauntletQueueJoin(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  if (ctx.gauntletQueue.some((u) => u.pid === id)) return; // already waiting
  const gate = canJoinGauntlet(ctx, id);
  if (gate) {
    ctx.error(id, gate);
    return;
  }
  ctx.gauntletQueue.push({ pid: id, joinedAtTick: ctx.tickCount });
  ctx.notice(id, 'You join the Gauntlet queue.');
}

export function gauntletQueueLeave(ctx: SimContext, pid: number): void {
  if (!ctx.gauntletQueue.some((u) => u.pid === pid)) return;
  ctx.gauntletQueue = ctx.gauntletQueue.filter((u) => u.pid !== pid);
  ctx.notice(pid, 'You leave the Gauntlet queue.');
}

// The rolling matchmaker, run each tick BEFORE the run driver. A no-op (no draws,
// no writes) while the queue is empty, so idle worlds and the parity goldens are
// untouched.
export function updateGauntletQueue(ctx: SimContext): void {
  // Prune players who logged out, died, already got into a run, or wandered into
  // a conflicting activity (a dungeon/arena/delve/trade/duel) while waiting: the
  // matchmaker must never teleport such a player out of what they are doing.
  if (ctx.gauntletQueue.length > 0) {
    ctx.gauntletQueue = ctx.gauntletQueue.filter((u) => {
      const e = ctx.entities.get(u.pid);
      return (
        !!e && !e.dead && !gauntletRunForPlayer(ctx, u.pid) && !gauntletQueueConflict(ctx, u.pid)
      );
    });
  }
  if (ctx.gauntletQueue.length === 0 || !ctx.gauntletEventOpen) return;
  // Sequential rolling: only one live queue game at a time. Wait while any
  // non-practice run exists; it disposes at the end of its podium, and the next
  // tick forms the next game from the front of the queue.
  if (ctx.gauntletRuns.some((run) => !run.practice)) return;
  // Form the next game: a short-countdown lobby seated from the front of the queue
  // (up to the real-player cap); startRun backfills the rest of the field with NPCs.
  const run = openLobbyRun(ctx, { countdownS: GAUNTLET.queueCountdownS });
  if (!run) return; // venue full (a practice run holds every slot); retry next tick
  const take = Math.min(GAUNTLET.maxRealPlayers, ctx.gauntletQueue.length);
  const seated = ctx.gauntletQueue.slice(0, take);
  ctx.gauntletQueue = ctx.gauntletQueue.slice(take);
  for (const u of seated) addPlayerToLobby(ctx, run, u.pid);
  emitLobbyState(ctx, run);
  // Single-player worlds skip the fill window (nobody else can ever join).
  if (ctx.cfg.gauntletInstantLobby) startRun(ctx, run);
}

// Rejoin from the podium: detach from the finished game and re-queue at the BACK
// (fairness). Bypasses the walk-up gate: a rejoiner has just played and is at the
// venue, not standing next to the recruiter.
export function gauntletRejoin(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  const run = gauntletRunForPlayer(ctx, id);
  if (run) removePlayerFromRun(ctx, run, id, true);
  if (ctx.gauntletQueue.some((u) => u.pid === id)) return;
  ctx.gauntletQueue.push({ pid: id, joinedAtTick: ctx.tickCount });
  ctx.notice(id, 'You rejoin the Gauntlet queue.');
}

// ---------------------------------------------------------------------------
// Practice
// ---------------------------------------------------------------------------

export function gauntletPractice(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  // Practice ignores the event window (always-on training), but still requires
  // the player be free (not in a run/queue/spectating) and beside the recruiter.
  const gate = canJoinGauntlet(ctx, id, { ignoreEventOpen: true });
  if (gate) {
    ctx.error(id, gate);
    return;
  }
  const run = openLobbyRun(ctx, { practice: true });
  if (!run) {
    ctx.error(id, 'The Gauntlet is full. Try again soon.');
    return;
  }
  addPlayerToLobby(ctx, run, id);
  startRun(ctx, run); // instant solo run vs the field of NPC bots
}

// ---------------------------------------------------------------------------
// Spectate
// ---------------------------------------------------------------------------

export function gauntletSpectate(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  const gate = canJoinGauntlet(ctx, id);
  if (gate) {
    ctx.error(id, gate);
    return;
  }
  const e = r.e;
  // A spectator keeps their own body and never fights, so their hp is left alone
  // (it just regenerates as normal): only the pre-spectate spot is banked.
  ctx.gauntletSpectators.set(id, { savedPos: { ...e.pos } });
  e.spectator = true;
  // Drop into a vantage on the terrace of the run they'll watch (if any), then
  // they roam freely on foot (normal movement + collision).
  const run = gauntletSpectatorWatchedRun(ctx, id);
  if (run) {
    e.pos = ctx.groundPos(
      run.origin.x + GAUNTLET_LAYOUT.spectatorX,
      run.origin.z + GAUNTLET_LAYOUT.spectatorZ,
    );
    e.prevPos = { ...e.pos };
    ctx.rebucket(e);
  }
  ctx.notice(id, 'You slip into the stands to watch the Gauntlet.');
}

function stopSpectating(ctx: SimContext, pid: number): void {
  const spec = ctx.gauntletSpectators.get(pid);
  if (!spec) return;
  ctx.gauntletSpectators.delete(pid);
  const e = ctx.entities.get(pid);
  if (e) {
    e.spectator = false;
    e.pos = { ...spec.savedPos };
    e.prevPos = { ...e.pos };
    ctx.rebucket(e);
  }
  ctx.notice(pid, 'You leave the stands.');
}

// ---------------------------------------------------------------------------
// Unified leave + disconnect
// ---------------------------------------------------------------------------

// The one "leave" verb the IWorld surface exposes: dequeue, stop spectating, or
// leave a run, whichever the player is currently in.
export function gauntletLeave(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  if (ctx.gauntletQueue.some((u) => u.pid === id)) {
    gauntletQueueLeave(ctx, id);
    return;
  }
  if (ctx.gauntletSpectators.has(id)) {
    stopSpectating(ctx, id);
    return;
  }
  leaveRun(ctx, id);
}

// Disconnect cleanup (called from the Sim coordinator while the leaver is still in
// players/entities, BEFORE runs.gauntletOnPlayerRemoved): drop them from the queue
// and clear any spectator seat so a logout never strands either state.
export function gauntletModesOnPlayerRemoved(ctx: SimContext, pid: number): void {
  if (ctx.gauntletQueue.some((u) => u.pid === pid))
    ctx.gauntletQueue = ctx.gauntletQueue.filter((u) => u.pid !== pid);
  const spec = ctx.gauntletSpectators.get(pid);
  if (spec) {
    ctx.gauntletSpectators.delete(pid);
    const e = ctx.entities.get(pid);
    if (e) {
      e.spectator = false;
      e.pos = { ...spec.savedPos };
      e.prevPos = { ...e.pos };
      ctx.rebucket(e);
    }
  }
}
