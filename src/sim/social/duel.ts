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
import { DT, dist2d, type Entity } from '../types';

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
  if (duelFor(ctx, r.meta.entityId) || duelFor(ctx, targetPid)) {
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
  if (duelFor(ctx, invite.fromPid) || duelFor(ctx, r.meta.entityId)) {
    ctx.error(r.meta.entityId, 'A duel is already in progress.');
    return;
  }
  const duel: DuelState = {
    a: invite.fromPid,
    b: r.meta.entityId,
    state: 'countdown',
    timer: DUEL_COUNTDOWN,
    controlled: new Map([
      [invite.fromPid, new Set<number>()],
      [r.meta.entityId, new Set<number>()],
    ]),
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
    // Already ended (either by an earlier same-tick lethal hit or a stale
    // entry awaiting purge): nothing left to evaluate, just fall through to
    // the purge sweep below.
    if (duel.endedTick !== undefined) continue;
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
    // Remember what each side CONTROLS while it is still resolvable. An Aura
    // carries only `sourceId`, so once a pet despawns nothing can map its dot
    // back to the owner; the clamp meanwhile treats that dot as the opponent's
    // for the whole bout. Recording the id here is what lets the end clear
    // exactly what the clamp was protecting against.
    for (const dPid of [duel.a, duel.b]) {
      const pet = ctx.petOf(dPid);
      if (pet) duel.controlled?.get(dPid)?.add(pet.id);
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
  // Purge every duel endDuel() marked ended (this tick or, in the rare case
  // it was ended outside a tick entirely, an earlier one) now that combat for
  // this tick has fully resolved. Deferring the delete out of endDuel() is
  // what lets a reciprocal lethal hit landing later in the SAME tick still
  // find the duel and get clamped instead of producing a real death.
  for (const [pid, duel] of ctx.duels) {
    if (duel.endedTick !== undefined) ctx.duels.delete(pid);
  }
}

/**
 * Strip every aura on `target` whose source resolves, through `pvpController`,
 * to the player `controllerPid`: the opponent themselves and anything they
 * control. Delegates the removal to `clearAurasFromSource` per distinct source
 * so the fade events and the stat recalc stay that function's business.
 *
 * An `Aura` carries only `sourceId`, so a dot from a pet that has already
 * DESPAWNED cannot be attributed to its owner by any reader at the moment the
 * duel ends. That is what `controlled` is for: the duel records the ids while
 * they are still resolvable (see `updateDuels`), and this clears against that
 * set as well, so a despawned source is covered too.
 *
 * The raw-id fallback below is still load-bearing for the case `controlled`
 * cannot cover: a duel restored or hand-built without the map (it is optional).
 */
function clearAurasFromController(
  ctx: SimContext,
  target: Entity | undefined,
  controllerPid: number,
  controlled: ReadonlySet<number> | undefined,
): void {
  if (!target) return;
  const sources = new Set<number>();
  for (const a of target.auras) {
    const src = ctx.entities.get(a.sourceId);
    // Resolving through pvpController is what widens this past the opponent's
    // own id to anything they control. When the source ENTITY is gone (a pet
    // that died or was dismissed between the last tick and the end) there is
    // nothing left to resolve, so fall back to the raw id comparison this
    // replaced: never clear less than the old code did.
    const byController = src
      ? ctx.pvpController(src)?.id === controllerPid
      : a.sourceId === controllerPid;
    // ...or it came from something the opponent controlled at any point in the
    // bout, which is the only way to catch a source that has since despawned.
    if (byController || controlled?.has(a.sourceId)) sources.add(a.sourceId);
  }
  for (const sourceId of sources) ctx.clearAurasFromSource(target, sourceId);
}

// winnerPid null = draw/cancelled
export function endDuel(ctx: SimContext, duel: DuelState, winnerPid: number | null): void {
  // Idempotent: a same-tick reciprocal lethal hit re-enters here after the
  // first hit already ended this same duel (the damage-clamp lookup in
  // combat/damage.ts still matches it via endedTick). Only the first call
  // performs the actual teardown and stat/emit side effects.
  if (duel.endedTick !== undefined) return;
  duel.endedTick = ctx.tickCount;
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
  // Clear what the OPPONENT did, using the same definition of "the opponent"
  // the lethal clamp uses. The clamp resolves a damage source through
  // pvpController, so anything the opponent controls (their pet) cannot kill a
  // duelist for the whole bout; clearing only auras stamped with the opponent's
  // own entity id left a pet's dot ticking on a body handed back at 1 hp with no
  // clamp left, and the next tick killed for real. Two halves of one duel must
  // not disagree about whose doing something was.
  clearAurasFromController(ctx, ea, duel.b, duel.controlled?.get(duel.b));
  clearAurasFromController(ctx, eb, duel.a, duel.controlled?.get(duel.a));
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
  const duel = ctx.duels.get(pid);
  // An ended duel lingers in ctx.duels until updateDuels() purges it at
  // tick-tail (see endDuel above); every consumer except the damage-clamp
  // lookup in combat/damage.ts must keep seeing it as gone the instant it
  // ends, matching the old synchronous-delete behavior.
  return duel && duel.endedTick === undefined ? duel : null;
}
