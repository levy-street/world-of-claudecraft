// The Lady of the Bonechill's Frozen Embrace (lady.ts): she seizes a non-tank
// (two on heroic) and rises into the air with them held to her breast, the
// held frozen in place (an unbreakable stun) and burning with cold. If the
// group deals a set share of her health while she hangs there she lets go and
// sets them down gently; otherwise, when the hold runs out, she drops them and
// the ice takes them (Shattering Fall, dealt when they land).
//
// The held bodies are CARRIED (carried_body.ts): their own locomotion stands
// down, this module pins their pose each tick after the mob AI, and the stun
// stands the online client's prediction down, so every client draws them in
// the air exactly where the sim holds them. Zero rng in the picks; the only
// draws are the damage rolls, victims in their stored order.

import { carryBody, dropBody, setDownBody } from '../../carried_body';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import type { LadyFightState } from './boss_state';
import {
  claimPlayers,
  clearCastIf,
  dropAuraById,
  localOf,
  mechanicDamage,
  startBar,
} from './claim';
import {
  LADY_EMBRACE_DROPPED,
  LADY_EMBRACE_HOLD,
  LADY_EMBRACE_RELEASED,
  LADY_EMBRACED,
  LADY_SHATTERING_FALL,
  LADY_TUNING,
} from './lady_ids';

const T = LADY_TUNING;
/** How far in front of her the held hang, and how far apart two are. */
export const EMBRACE_REACH = 1.5;
export const EMBRACE_SPREAD = 1.1;
/** The held hang this much above her feet (in her arms, at her breast). */
export const EMBRACE_LIFT = 1.4;
/** A dropped body that has not landed in this long lands anyway (a ledge). */
const FALL_GIVE_UP = 3;

/** Her height over the floor `t` seconds into a phase. Pure. */
export function embraceHeight(phase: 'rise' | 'hold' | 'descend', t: number, from: number): number {
  if (phase === 'rise') {
    const k = Math.min(1, Math.max(0, t / T.embraceRise));
    return T.embraceHeight * k * k * (3 - 2 * k);
  }
  if (phase === 'hold') return T.embraceHeight + Math.sin(t * 2.4) * 0.15;
  const k = Math.min(1, Math.max(0, t / T.embraceSetDown));
  return from * (1 - k * k);
}

/** Where held body `k` of `n` hangs (instance-local offset from her). Pure. */
export function embraceSlot(yaw: number, k: number, n: number): { dx: number; dz: number } {
  const side = n <= 1 ? 0 : (k === 0 ? -1 : 1) * (EMBRACE_SPREAD / 2);
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // Screen-right of a facing f is (-cos f, sin f).
  return { dx: fx * EMBRACE_REACH - fz * side, dz: fz * EMBRACE_REACH + fx * side };
}

function freeze(ctx: SimContext, boss: Entity, p: Entity, seconds: number): void {
  dropAuraById(p, LADY_EMBRACED);
  ctx.applyAura(p, {
    id: LADY_EMBRACED,
    name: 'Frozen Embrace',
    kind: 'stun',
    remaining: seconds,
    duration: seconds,
    value: 0,
    sourceId: boss.id,
    school: 'frost',
    unbreakableControl: true,
    undispellable: true,
  });
}

/** The bar lands: she takes hold of her victims and begins to rise. */
export function seizeVictims(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: LadyFightState,
  ids: readonly number[],
): boolean {
  const victims = ids.filter((id) => {
    const p = ctx.entities.get(id);
    return p !== undefined && !p.dead && !p.ghost && p.carriedBy === undefined;
  });
  if (victims.length === 0) return false;
  const at = localOf(ctx, inst, boss);
  st.embrace = {
    victims,
    phase: 'rise',
    t: 0,
    hpAt: boss.hp,
    x: at.x,
    z: at.z,
    floorY: boss.pos.y,
    yaw: boss.facing,
    released: false,
    from: 0,
  };
  for (const id of victims) {
    const p = ctx.entities.get(id) as Entity;
    // Whatever carried them a moment ago (a leap, a climb, a charge, a follow)
    // is over: she holds them now.
    p.leap = null;
    p.climb = null;
    p.chargeTargetId = null;
    p.followTargetId = null;
    carryBody(p, boss.id);
    freeze(ctx, boss, p, T.embraceRise + T.embraceHold + T.embraceSetDown + FALL_GIVE_UP + 1);
  }
  startBar(boss, LADY_EMBRACE_HOLD, T.embraceRise + T.embraceHold, null, true);
  return true;
}

/** Pin her and every held body at height `h` over her floor. */
function pin(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: LadyFightState,
  h: number,
): void {
  const e = st.embrace;
  if (!e) return;
  const o = ctx.instanceOriginOf(inst);
  boss.pos.x = o.x + e.x;
  boss.pos.z = o.z + e.z;
  boss.pos.y = e.floorY + h;
  boss.facing = e.yaw;
  boss.swingTimer = Math.max(boss.swingTimer, 0.6);
  ctx.grid.update(boss);
  const n = e.victims.length;
  e.victims.forEach((id, k) => {
    const p = ctx.entities.get(id);
    if (!p || p.carriedBy !== boss.id) return;
    const s = embraceSlot(e.yaw, k, n);
    p.pos.x = boss.pos.x + s.dx;
    p.pos.z = boss.pos.z + s.dz;
    p.pos.y = boss.pos.y + EMBRACE_LIFT;
    // Facing her, held to her breast.
    p.facing = e.yaw + Math.PI;
    ctx.grid.update(p);
  });
}

/** Let one held body go: gently onto the floor, or dropped from where it hangs. */
function letGo(
  ctx: SimContext,
  boss: Entity,
  st: LadyFightState,
  p: Entity,
  gentle: boolean,
): void {
  if (p.carriedBy !== boss.id) return;
  if (gentle) {
    setDownBody(p, ctx.groundPos(p.pos.x, p.pos.z).y);
    dropAuraById(p, LADY_EMBRACED);
    ctx.grid.update(p);
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: p.id,
      school: 'frost',
      fx: 'nova',
      ability: LADY_EMBRACE_RELEASED,
    });
    return;
  }
  dropBody(p);
  st.falling.push({ playerId: p.id, t: 0 });
  st.dropped = true;
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: p.id,
    school: 'frost',
    fx: 'projectile',
    ability: LADY_EMBRACE_DROPPED,
  });
}

/** One tick of the Embrace: the rise, the hold (the cold, the break check, the
 *  drop) and her descent. Returns true while it owns her. */
export function stepEmbrace(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: LadyFightState,
  perSecondTick: boolean,
): boolean {
  const e = st.embrace;
  if (!e) return false;
  // A held body that died, left the claim or was taken away is no longer
  // held: the fallen are laid on the ice, the rest let go where they are.
  const present = new Set(claimPlayers(ctx, inst).map((p) => p.id));
  e.victims = e.victims.filter((id) => {
    const p = ctx.entities.get(id);
    if (p && present.has(id) && p.carriedBy === boss.id) return true;
    if (!p) return false;
    if (p.carriedBy === boss.id) {
      if (p.dead || p.ghost) setDownBody(p, ctx.groundPos(p.pos.x, p.pos.z).y);
      else dropBody(p);
      ctx.grid.update(p);
    }
    // Let go (here, or already by the carry's own reach check): unfrozen.
    dropAuraById(p, LADY_EMBRACED);
    return false;
  });
  e.t += DT;
  if (e.phase === 'rise' || e.phase === 'hold') {
    if (perSecondTick) {
      for (const id of e.victims) {
        const p = ctx.entities.get(id) as Entity;
        ctx.dealDamage(
          boss,
          p,
          Math.max(1, Math.round(T.embracePerSecond * (boss.mechanicDamageMult ?? 1))),
          false,
          'frost',
          'Frozen Embrace',
          'hit',
          true,
        );
      }
    }
    const dealt = e.hpAt - boss.hp;
    const broken = dealt >= T.embraceBreakShare * boss.maxHp - 1e-6;
    if (e.phase === 'rise') {
      pin(ctx, inst, boss, st, embraceHeight('rise', e.t, 0));
      if (e.t >= T.embraceRise - 1e-6) {
        e.phase = 'hold';
        e.t = 0;
      }
    } else {
      pin(ctx, inst, boss, st, embraceHeight('hold', e.t, 0));
    }
    const timedOut = e.phase === 'hold' && e.t >= T.embraceHold - 1e-6;
    if (e.victims.length === 0 || broken || timedOut) {
      e.released = broken || e.victims.length === 0;
      e.from = boss.pos.y - e.floorY;
      e.phase = 'descend';
      e.t = 0;
      clearCastIf(boss, LADY_EMBRACE_HOLD);
      if (!e.released)
        for (const id of [...e.victims]) {
          const p = ctx.entities.get(id);
          if (p) letGo(ctx, boss, st, p, false);
        }
    }
    return true;
  }
  // Descending: a released body rides down in her arms and is set down at the end.
  const h = embraceHeight('descend', e.t, e.from);
  pin(ctx, inst, boss, st, h);
  if (e.t < T.embraceSetDown - 1e-6) return true;
  for (const id of [...e.victims]) {
    const p = ctx.entities.get(id);
    if (p) letGo(ctx, boss, st, p, true);
  }
  boss.pos.y = e.floorY;
  ctx.grid.update(boss);
  st.embrace = null;
  return false;
}

/** The dropped bodies: the impact when each one lands, and the stun lifts. */
export function stepFalling(ctx: SimContext, boss: Entity, st: LadyFightState): void {
  if (st.falling.length === 0) return;
  const keep: LadyFightState['falling'] = [];
  for (const f of st.falling) {
    f.t += DT;
    const p = ctx.entities.get(f.playerId);
    if (!p || p.dead || p.ghost) continue;
    if (!p.onGround && f.t < FALL_GIVE_UP) {
      keep.push(f);
      continue;
    }
    dropAuraById(p, LADY_EMBRACED);
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: p.id,
      school: 'frost',
      fx: 'detonate',
      ability: LADY_SHATTERING_FALL,
    });
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.dropMin, T.dropMax),
      false,
      'physical',
      'Shattering Fall',
      'hit',
      true,
    );
  }
  st.falling = keep;
}

/** The fight ended mid-Embrace (a kill, a wipe, a reset): everyone she holds is
 *  set down gently, the falling land unharmed, and she stands on her floor. */
export function endEmbrace(ctx: SimContext, boss: Entity, st: LadyFightState): void {
  const e = st.embrace;
  if (e) {
    for (const id of e.victims) {
      const p = ctx.entities.get(id);
      if (p && p.carriedBy === boss.id) {
        setDownBody(p, ctx.groundPos(p.pos.x, p.pos.z).y);
        dropAuraById(p, LADY_EMBRACED);
        ctx.grid.update(p);
      }
    }
    if (!boss.dead) boss.pos.y = e.floorY;
    clearCastIf(boss, LADY_EMBRACE_HOLD);
  }
  for (const f of st.falling) {
    const p = ctx.entities.get(f.playerId);
    if (p) dropAuraById(p, LADY_EMBRACED);
  }
  st.embrace = null;
  st.falling = [];
}
