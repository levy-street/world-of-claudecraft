// Session A2: the Duels subsystem, MOVED verbatim out of the Sim monolith behind
// the SimContext seam. Move-not-rewrite: statements, branch order, iteration order,
// and the player-facing emit literals are preserved EXACTLY. The duel state
// (`this.duels` / `this.duelInvites`) stays on Sim and is reached through SimContext
// live views (like E1's roster collections + A1's invite maps); Sim keeps thin
// same-named delegates so every foreign caller (the dealDamage 1-HP duel guard,
// leave/disconnect handling, and the HUD command path) resolves unchanged.
//
// `clearAurasFromSource` stays on Sim (it has non-duel callers) and is consumed
// here via SimContext; `entityInDungeon` / `hasPendingSocialInvite` likewise stay
// on Sim and are read through the seam.

import type { DuelState } from '../sim';
import type { SimContext } from '../sim_context';
import { DT, dist2d } from '../types';

const DUEL_COUNTDOWN = 3;
const DUEL_FORFEIT_DISTANCE = 60;

export function duelRequest(ctx: SimContext, targetPid: number, pid?: number): void {
  const r = ctx.resolve(pid);
  const target = ctx.players.get(targetPid);
  const targetE = ctx.entities.get(targetPid);
  if (!r || !target || !targetE) return;
  if (targetPid === r.meta.entityId) return;
  if (
    ctx.entityInDungeon(r.e, 'nythraxis_boss_arena') ||
    ctx.entityInDungeon(targetE, 'nythraxis_boss_arena')
  ) {
    ctx.error(r.meta.entityId, 'You cannot duel in Nythraxis Raid Arena.');
    return;
  }
  if (ctx.duels.has(r.meta.entityId) || ctx.duels.has(targetPid)) {
    ctx.error(r.meta.entityId, 'A duel is already in progress.');
    return;
  }
  if (dist2d(r.e.pos, targetE.pos) > 30) {
    ctx.error(r.meta.entityId, 'Target is too far away.');
    return;
  }
  if (ctx.hasPendingSocialInvite(targetPid)) {
    ctx.error(r.meta.entityId, `${target.name} already has a pending invitation.`);
    return;
  }
  ctx.duelInvites.set(targetPid, { fromPid: r.meta.entityId, expires: ctx.time + 30 });
  ctx.emit({
    type: 'duelRequest',
    fromPid: r.meta.entityId,
    fromName: r.meta.name,
    pid: targetPid,
  });
  ctx.emit({
    type: 'log',
    text: `You have challenged ${target.name} to a duel.`,
    color: '#fa6',
    pid: r.meta.entityId,
  });
}

export function duelAccept(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const invite = ctx.duelInvites.get(r.meta.entityId);
  if (!invite || invite.expires < ctx.time) {
    ctx.error(r.meta.entityId, 'The challenge has expired.');
    return;
  }
  ctx.duelInvites.delete(r.meta.entityId);
  const other = ctx.players.get(invite.fromPid);
  if (!other) return;
  const otherE = ctx.entities.get(invite.fromPid);
  if (
    !otherE ||
    ctx.entityInDungeon(r.e, 'nythraxis_boss_arena') ||
    ctx.entityInDungeon(otherE, 'nythraxis_boss_arena')
  ) {
    ctx.error(r.meta.entityId, 'You cannot duel in Nythraxis Raid Arena.');
    return;
  }
  if (ctx.duels.has(invite.fromPid) || ctx.duels.has(r.meta.entityId)) {
    ctx.error(r.meta.entityId, 'A duel is already in progress.');
    return;
  }
  const duel: DuelState = {
    a: invite.fromPid,
    b: r.meta.entityId,
    state: 'countdown',
    timer: DUEL_COUNTDOWN,
  };
  ctx.duels.set(duel.a, duel);
  ctx.duels.set(duel.b, duel);
  for (const dPid of [duel.a, duel.b]) {
    ctx.emit({ type: 'duelCountdown', seconds: DUEL_COUNTDOWN, pid: dPid });
  }
}

export function duelDecline(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const invite = ctx.duelInvites.get(r.meta.entityId);
  ctx.duelInvites.delete(r.meta.entityId);
  if (invite) {
    ctx.emit({
      type: 'log',
      text: `${r.meta.name} declines your challenge.`,
      color: '#fa6',
      pid: invite.fromPid,
    });
  }
}

export function updateDuels(ctx: SimContext): void {
  const seen = new Set<DuelState>();
  for (const duel of ctx.duels.values()) {
    if (seen.has(duel)) continue;
    seen.add(duel);
    const ea = ctx.entities.get(duel.a);
    const eb = ctx.entities.get(duel.b);
    if (!ea || !eb) {
      endDuel(ctx, duel, null);
      continue;
    }
    if (duel.state === 'countdown') {
      const before = Math.ceil(duel.timer);
      duel.timer -= DT;
      const after = Math.ceil(duel.timer);
      if (after < before && after > 0) {
        for (const dPid of [duel.a, duel.b])
          ctx.emit({ type: 'duelCountdown', seconds: after, pid: dPid });
      }
      if (duel.timer <= 0) {
        duel.state = 'active';
        for (const dPid of [duel.a, duel.b]) {
          ctx.emit({ type: 'log', text: 'The duel has begun!', color: '#fa6', pid: dPid });
          ctx.emit({ type: 'duelStart', pid: dPid });
        }
      }
      continue;
    }
    // forfeit by running away or dying to something else
    if (dist2d(ea.pos, eb.pos) > DUEL_FORFEIT_DISTANCE) {
      endDuel(ctx, duel, null);
    } else if (ea.dead) {
      endDuel(ctx, duel, duel.b);
    } else if (eb.dead) {
      endDuel(ctx, duel, duel.a);
    }
  }
}

// winnerPid null = draw/cancelled
export function endDuel(ctx: SimContext, duel: DuelState, winnerPid: number | null): void {
  ctx.duels.delete(duel.a);
  ctx.duels.delete(duel.b);
  const aMeta = ctx.players.get(duel.a);
  const bMeta = ctx.players.get(duel.b);
  const ea = ctx.entities.get(duel.a);
  const eb = ctx.entities.get(duel.b);
  // stop the combatants from swinging at each other
  for (const e of [ea, eb]) {
    if (e) e.ccDr.clear();
    if (e && e.targetId !== null && (e.targetId === duel.a || e.targetId === duel.b)) {
      e.autoAttack = false;
    }
  }
  if (ea) ctx.clearAurasFromSource(ea, duel.b);
  if (eb) ctx.clearAurasFromSource(eb, duel.a);
  if (winnerPid !== null && aMeta && bMeta) {
    const winner = winnerPid === duel.a ? aMeta : bMeta;
    const loser = winnerPid === duel.a ? bMeta : aMeta;
    ctx.emit({ type: 'duelEnd', winnerName: winner.name, loserName: loser.name });
    // Only decided duels count; timed-out or cancelled duels resolve with a
    // null winner and count nothing.
    ctx.bumpDeedStat(winner, 'duelsWon', 1);
    ctx.bumpDeedStat(loser, 'duelsLost', 1);
  } else if (aMeta && bMeta) {
    for (const dPid of [duel.a, duel.b]) {
      ctx.emit({ type: 'log', text: 'The duel has ended.', color: '#fa6', pid: dPid });
    }
  }
}

export function duelFor(ctx: SimContext, pid: number): DuelState | null {
  return ctx.duels.get(pid) ?? null;
}
