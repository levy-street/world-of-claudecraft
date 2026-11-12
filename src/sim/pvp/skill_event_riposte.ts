// Riposte (skill event 10, owner card 2026-11-12): a free-for-all fencing yard
// fought on hearts. One attack, one guard, one feint and a sidestep:
//
//   lunge     a half-second wind-up everyone can see, then a thrust at the
//             nearest fighter in front within LUNGE_RANGE: one heart;
//   guard     raised for up to GUARD_MAX seconds. A lunge landing in its first
//             PERFECT_WINDOW is a riposte: the attacker is staggered (no verbs)
//             for STAGGER seconds. A guard held the full time leaves you open
//             (no verbs) for OPEN_AFTER_GUARD. Pressing guard again lowers it;
//   feint     cancels your own wind-up, to draw out an early guard;
//   sidestep  a short dash.
//
// Anti-passive: a fencer who has not lunged for PASSIVE_LIMIT seconds cannot
// guard. Win: the last fencer with hearts left, who took at least one heart.
// The lunge resolves on the per-tick hook, never the once-a-second pass, so the
// quarter-second guard window is exact at 20 Hz.

import { relocateSwept } from '../combat/heroic_leap';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { kitFor, type RiposteKitState, verbReady } from './skill_event_kit';
import { heartFighting, lastFighterStandingTick } from './skill_event_last_standing';
import type { ActiveSkillEvent, SkillEventRuleSet, SkillEventStance } from './skill_events';

export const RIPOSTE_LUNGE_WINDUP = 0.5;
export const RIPOSTE_LUNGE_RANGE = 5;
export const RIPOSTE_LUNGE_RECOVERY = 0.4;
export const RIPOSTE_PERFECT_WINDOW = 0.25;
export const RIPOSTE_GUARD_MAX = 1;
export const RIPOSTE_OPEN_AFTER_GUARD = 2;
export const RIPOSTE_STAGGER = 1.5;
export const RIPOSTE_FEINT_COOLDOWN = 4;
export const RIPOSTE_SIDESTEP_COOLDOWN = 6;
export const RIPOSTE_SIDESTEP_DISTANCE = 6;
export const RIPOSTE_PASSIVE_LIMIT = 10;
/** Half-angle of the lunge's reach in front of the fencer. */
const LUNGE_CONE_COS = Math.cos(Math.PI / 3);

function riposteState(ev: ActiveSkillEvent, pid: number): RiposteKitState {
  const kit = kitFor(ev, pid);
  if (!kit.riposte) {
    kit.riposte = {
      lungeAt: null,
      guardFrom: null,
      guardUntil: null,
      openUntil: 0,
      lastLungeAt: ev.startsAt,
    };
  }
  return kit.riposte;
}

/** The nearest living fighter in front of `p` within lunge range, or null. */
export function lungeTarget(ctx: SimContext, ev: ActiveSkillEvent, p: Entity): Entity | null {
  const fx = Math.sin(p.facing);
  const fz = Math.cos(p.facing);
  let best: Entity | null = null;
  let bestD = RIPOSTE_LUNGE_RANGE;
  for (const pid of ev.hearts.keys()) {
    if (pid === p.id) continue;
    const t = ctx.entities.get(pid);
    if (!heartFighting(ev, t)) continue;
    const dx = t.pos.x - p.pos.x;
    const dz = t.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) continue;
    if (d > 0.01 && (dx * fx + dz * fz) / d < LUNGE_CONE_COS) continue;
    best = t;
    bestD = d;
  }
  return best;
}

function busy(st: RiposteKitState, now: number): boolean {
  return now < st.openUntil || st.lungeAt !== null;
}

function action(ctx: SimContext, ev: ActiveSkillEvent, pid: number, verb: string): boolean {
  const p = ctx.entities.get(pid);
  if (!heartFighting(ev, p)) return false;
  const kit = kitFor(ev, pid);
  const st = riposteState(ev, pid);
  const now = ctx.time;
  switch (verb) {
    case 'lunge': {
      if (busy(st, now) || st.guardFrom !== null || !verbReady(kit, 'lunge', now)) return false;
      st.lungeAt = now + RIPOSTE_LUNGE_WINDUP;
      st.lastLungeAt = now;
      return true;
    }
    case 'guard': {
      if (st.guardFrom !== null) {
        // A second press lowers the guard early, with no penalty.
        st.guardFrom = null;
        st.guardUntil = null;
        return true;
      }
      if (busy(st, now)) return false;
      if (now - st.lastLungeAt > RIPOSTE_PASSIVE_LIMIT) return false;
      st.guardFrom = now;
      st.guardUntil = now + RIPOSTE_GUARD_MAX;
      return true;
    }
    case 'feint': {
      if (st.lungeAt === null || !verbReady(kit, 'feint', now)) return false;
      st.lungeAt = null;
      kit.readyAt.set('feint', now + RIPOSTE_FEINT_COOLDOWN);
      return true;
    }
    case 'sidestep': {
      if (now < st.openUntil || !verbReady(kit, 'sidestep', now)) return false;
      relocateSwept(ctx, p, {
        x: p.pos.x + Math.sin(p.facing) * RIPOSTE_SIDESTEP_DISTANCE,
        y: p.pos.y,
        z: p.pos.z + Math.cos(p.facing) * RIPOSTE_SIDESTEP_DISTANCE,
      });
      kit.readyAt.set('sidestep', now + RIPOSTE_SIDESTEP_COOLDOWN);
      return true;
    }
    default:
      return false;
  }
}

/** Land one fencer's lunge now. */
function landLunge(ctx: SimContext, ev: ActiveSkillEvent, p: Entity, st: RiposteKitState): void {
  st.lungeAt = null;
  kitFor(ev, p.id).readyAt.set('lunge', ctx.time + RIPOSTE_LUNGE_RECOVERY);
  const t = lungeTarget(ctx, ev, p);
  if (!t) return;
  const guard = riposteState(ev, t.id);
  if (guard.guardFrom !== null) {
    if (ctx.time - guard.guardFrom <= RIPOSTE_PERFECT_WINDOW) {
      // A riposte: the attacker reels, open to a free hit.
      st.openUntil = ctx.time + RIPOSTE_STAGGER;
      st.guardFrom = null;
      st.guardUntil = null;
    }
    return; // any raised guard turns the thrust aside
  }
  ev.verbHitFrom = p.id;
  try {
    ctx.dealDamage(p, t, 1, false, 'physical', null, 'hit');
  } finally {
    ev.verbHitFrom = null;
  }
}

function everyTick(ctx: SimContext, ev: ActiveSkillEvent): void {
  const now = ctx.time;
  for (const [pid, kit] of ev.kits) {
    const st = kit.riposte;
    if (!st) continue;
    const p = ctx.entities.get(pid);
    if (!heartFighting(ev, p)) {
      st.lungeAt = null;
      st.guardFrom = null;
      st.guardUntil = null;
      continue;
    }
    if (st.guardUntil !== null && now >= st.guardUntil) {
      // Held the whole time: left open.
      st.guardFrom = null;
      st.guardUntil = null;
      st.openUntil = now + RIPOSTE_OPEN_AFTER_GUARD;
    }
    if (st.lungeAt !== null && now >= st.lungeAt) landLunge(ctx, ev, p, st);
  }
}

/** The fencer's tell: winding up, guarding, or open. */
function stanceOf(
  ctx: SimContext,
  ev: ActiveSkillEvent,
  pid: number,
): SkillEventStance | undefined {
  const st = ev.kits.get(pid)?.riposte;
  if (!st) return undefined;
  if (st.lungeAt !== null) return { stance: 'lunge' };
  if (st.guardFrom !== null) return { stance: 'guard' };
  if (ctx.time < st.openUntil) return { stance: 'open' };
  return undefined;
}

export const RIPOSTE_RULES: SkillEventRuleSet = {
  stanceOf,
  killsToWin: Number.POSITIVE_INFINITY,
  action,
  everyTick,
  tick: lastFighterStandingTick,
};
