// Knight-Commander Olen on the Breach Bastion (docs/design/dungeon-rework/
// sunken_bastion.md, "Boss 1"): bait his Oathbound Charge into a buttress.
//
//   Oathbound Charge  every 18 s (first at 10 s) Olen marks the FARTHEST non-tank
//                     player and a 4 yd lane runs from him through them to the
//                     rim (a 2.5 s bar, his aim locked). He charges the lane:
//                     150 to 180 physical and a 6 yd side knockback to everyone
//                     in it. A lane that ends in a standing buttress crashes him
//                     into it: Breached (5 s stun, 30 percent more damage taken
//                     for 8 s) and the buttress cracks (two crashes break it).
//                     A lane that ends at the open rim grants Unbroken Oath (10
//                     percent more damage per stack, for the fight).
//   Reaping Arc       his kept cleave (the template's `cleave`).
//   Heroic            Crumbling Rampart: a buttress breaks on its first crash.
//                     Undertow Wake: the lane floods for 8 s after the charge (25
//                     frost a second and a 50 percent slow to anyone in it).
//
// Zero rng in every pick (the farthest player, ties to the lower id); the only
// draws are the landing damage rolls, in entity-id order.

import { BASTION_BUTTRESSES } from '../../content/sunken_bastion_layout';
import { applyKnockback } from '../../knockback';
import { laneSide } from '../../mob/trash_kit/lane';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type OlenFightState } from '../../types';
import {
  claimObjectAt,
  claimPlayers,
  dropEncounterObject,
  grantClaimDeed,
  localOf,
  mechanicDamage,
  spawnEncounterObject,
} from './claim';
import {
  BUTTRESS_TEMPLATES,
  type ButtressState,
  buttressStateOf,
  inOathLane,
  OLEN_BREACHED,
  OLEN_BREACHED_VULN,
  OLEN_OATHBOUND_CHARGE,
  OLEN_TUNING,
  OLEN_UNBROKEN_OATH,
  OLEN_UNDERTOW,
  oathLaneEnd,
  UNDERTOW_TEMPLATE,
} from './ids';

const T = OLEN_TUNING;
export const OLEN_DEED = 'dgn_olen_buttress';

function freshState(): OlenFightState {
  return {
    kind: 'olen',
    chargeTimer: T.chargeFirst,
    lane: null,
    dash: null,
    oath: 0,
    everOath: false,
    wakes: [],
  };
}

/** The buttress object of `id` in this claim, and its state. */
function buttress(
  ctx: SimContext,
  inst: InstanceSlot,
  id: string,
): { e: Entity; state: ButtressState } | null {
  const b = BASTION_BUTTRESSES.find((x) => x.id === id);
  if (!b) return null;
  const e = claimObjectAt(ctx, inst, b.x, b.z);
  const state = e ? buttressStateOf(e.templateId) : null;
  return e && state ? { e, state } : null;
}

/** Buttress ids still standing (intact or cracked) in this claim. */
export function standingButtresses(ctx: SimContext, inst: InstanceSlot): Set<string> {
  const out = new Set<string>();
  for (const b of BASTION_BUTTRESSES) {
    const got = buttress(ctx, inst, b.id);
    if (got && got.state !== 'broken') out.add(b.id);
  }
  return out;
}

function setButtress(e: Entity, state: ButtressState): void {
  e.templateId = BUTTRESS_TEMPLATES[state];
  e.name =
    state === 'intact' ? 'Buttress' : state === 'cracked' ? 'Cracked Buttress' : 'Broken Buttress';
}

/** The farthest living non-tank player (ties to the lower id), else the tank. */
export function pickChargeTarget(boss: Entity, players: readonly Entity[]): Entity | null {
  let best: Entity | null = null;
  let bestD = -1;
  for (const p of players) {
    if (p.id === boss.aggroTargetId) continue;
    const d = dist2d(p.pos, boss.pos);
    if (d > bestD + 1e-9) {
      best = p;
      bestD = d;
    }
  }
  if (best) return best;
  return players.find((p) => p.id === boss.aggroTargetId) ?? null;
}

function clearOurCast(boss: Entity): void {
  if (boss.castingAbility !== OLEN_OATHBOUND_CHARGE) return;
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  boss.castTargetId = null;
  boss.channeling = false;
}

/** Mark the next charge: the lane locks on the victim's spot now. */
export function markOathboundCharge(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: OlenFightState,
): boolean {
  const victim = pickChargeTarget(boss, claimPlayers(ctx, inst));
  if (!victim) return false;
  const at = localOf(ctx, inst, boss);
  const yaw = Math.atan2(victim.pos.x - boss.pos.x, victim.pos.z - boss.pos.z);
  const end = oathLaneEnd(at.x, at.z, yaw, standingButtresses(ctx, inst));
  st.lane = { x: at.x, z: at.z, yaw, length: end.length, buttress: end.buttress };
  st.chargeTimer = T.chargeEvery;
  boss.castingAbility = OLEN_OATHBOUND_CHARGE;
  boss.castTotal = T.chargeCast;
  boss.castRemaining = T.chargeCast;
  boss.castTargetId = victim.id;
  boss.channeling = false;
  boss.facing = yaw;
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: victim.id,
    school: 'physical',
    fx: 'windup',
    ability: OLEN_OATHBOUND_CHARGE,
  });
  return true;
}

/** The charge sets off: everyone standing in the lane is struck and thrown aside. */
function launch(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: OlenFightState): void {
  const lane = st.lane;
  if (!lane) return;
  st.lane = null;
  clearOurCast(boss);
  st.dash = { ...lane, t: 0 };
  const o = ctx.instanceOriginOf(inst);
  for (const p of claimPlayers(ctx, inst)) {
    const px = p.pos.x - o.x;
    const pz = p.pos.z - o.z;
    if (!inOathLane(lane.x, lane.z, lane.yaw, lane.length + 1, px, pz)) continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.min, T.max),
      false,
      'physical',
      'Oathbound Charge',
      'hit',
      true,
    );
    if (p.dead) continue;
    // Thrown to the side of the lane it stood on, away from the centre line.
    const side = laneSide(lane.x, lane.z, lane.yaw, px, pz) >= 0 ? 1 : -1;
    const along = (px - lane.x) * Math.sin(lane.yaw) + (pz - lane.z) * Math.cos(lane.yaw);
    const cx = o.x + lane.x + Math.sin(lane.yaw) * along - Math.cos(lane.yaw) * side * 0.05;
    const cz = o.z + lane.z + Math.cos(lane.yaw) * along + Math.sin(lane.yaw) * side * 0.05;
    applyKnockback(ctx, { ...boss, pos: { x: cx, y: p.pos.y, z: cz } }, p, T.knockback);
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'physical',
    fx: 'nova',
    ability: OLEN_OATHBOUND_CHARGE,
  });
}

/** The charge reaches its end: a crash into a buttress, or the rim. */
function arrive(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: OlenFightState): void {
  const dash = st.dash;
  if (!dash) return;
  st.dash = null;
  const heroic = inst.difficulty === 'heroic';
  const hit = dash.buttress ? buttress(ctx, inst, dash.buttress) : null;
  if (hit && hit.state !== 'broken') {
    // Crumbling Rampart (heroic): a buttress breaks on its first crash.
    setButtress(hit.e, heroic || hit.state === 'cracked' ? 'broken' : 'cracked');
    ctx.applyAura(boss, {
      id: OLEN_BREACHED,
      name: 'Breached',
      kind: 'stun',
      remaining: T.breachedStun,
      duration: T.breachedStun,
      value: 0,
      sourceId: boss.id,
      school: 'physical',
      unbreakableControl: true,
    });
    ctx.applyAura(boss, {
      id: OLEN_BREACHED_VULN,
      name: 'Breached',
      kind: 'vulnerability',
      remaining: T.breachedVulnSeconds,
      duration: T.breachedVulnSeconds,
      value: T.breachedVuln,
      sourceId: boss.id,
      school: 'physical',
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: hit.e.id,
      school: 'physical',
      fx: 'detonate',
      ability: OLEN_BREACHED,
    });
  } else {
    st.oath++;
    st.everOath = true;
    boss.auras = boss.auras.filter((a) => a.id !== OLEN_UNBROKEN_OATH);
    ctx.applyAura(boss, {
      id: OLEN_UNBROKEN_OATH,
      name: 'Unbroken Oath',
      kind: 'buff_dmg_done',
      remaining: 3600,
      duration: 3600,
      permanent: true,
      value: T.oathPerStack * st.oath,
      stacks: st.oath,
      sourceId: boss.id,
      school: 'physical',
    });
  }
  // Undertow Wake (heroic): the lane floods behind him.
  if (heroic && dash.length > 1) {
    const obj = spawnEncounterObject(
      ctx,
      inst,
      UNDERTOW_TEMPLATE,
      'Undertow Wake',
      dash.x,
      dash.z,
      dash.yaw,
      dash.length,
    );
    st.wakes.push({ ...dash, remaining: T.wakeSeconds, tick: 1, objectId: obj.id });
  }
}

function stepWakes(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: OlenFightState): void {
  if (st.wakes.length === 0) return;
  const o = ctx.instanceOriginOf(inst);
  const players = claimPlayers(ctx, inst);
  for (const w of st.wakes) {
    w.remaining -= DT;
    w.tick -= DT;
    if (w.tick > 0) continue;
    w.tick += 1;
    for (const p of players) {
      if (!inOathLane(w.x, w.z, w.yaw, w.length, p.pos.x - o.x, p.pos.z - o.z)) continue;
      ctx.dealDamage(
        boss,
        p,
        Math.max(1, Math.round(T.wakePerSecond * (boss.mechanicDamageMult ?? 1))),
        false,
        'frost',
        'Undertow Wake',
        'hit',
        true,
      );
      if (p.dead) continue;
      ctx.applyAura(p, {
        id: OLEN_UNDERTOW,
        name: 'Undertow Wake',
        kind: 'slow',
        remaining: 1.5,
        duration: 1.5,
        value: T.wakeSlow,
        sourceId: boss.id,
        school: 'frost',
      });
    }
  }
  for (const w of st.wakes.filter((x) => x.remaining <= 0))
    dropEncounterObject(ctx, inst, w.objectId);
  st.wakes = st.wakes.filter((w) => w.remaining > 0);
}

/** The fight ended (a wipe, an evade, a reset): the bastion stands whole again. */
export function resetOlen(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const st = boss.bastionFight;
  if (st?.kind === 'olen') for (const w of st.wakes) dropEncounterObject(ctx, inst, w.objectId);
  clearOurCast(boss);
  boss.auras = boss.auras.filter((a) => a.id !== OLEN_UNBROKEN_OATH);
  boss.bastionFight = undefined;
  if (boss.dead) return;
  for (const b of BASTION_BUTTRESSES) {
    const got = buttress(ctx, inst, b.id);
    if (got) setButtress(got.e, 'intact');
  }
}

/** Olen was slain: the deed, then the tidy-up (the buttresses stay as they fell). */
function concludeOlen(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: OlenFightState): void {
  if (!st.everOath) grantClaimDeed(ctx, inst, OLEN_DEED);
  for (const w of st.wakes) dropEncounterObject(ctx, inst, w.objectId);
  boss.bastionFight = undefined;
}

/** One tick of Olen's fight. */
export function tickOlen(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): void {
  let st = boss.bastionFight?.kind === 'olen' ? boss.bastionFight : null;
  if (boss.dead) {
    if (st) concludeOlen(ctx, inst, boss, st);
    return;
  }
  if (!engaged) {
    if (st) resetOlen(ctx, inst, boss);
    return;
  }
  if (!st) {
    st = freshState();
    boss.bastionFight = st;
  }
  stepWakes(ctx, inst, boss, st);
  const o = ctx.instanceOriginOf(inst);
  if (st.dash) {
    const d = st.dash;
    d.t += DT;
    const k = Math.min(1, d.t / T.dashSeconds);
    boss.pos.x = o.x + d.x + Math.sin(d.yaw) * d.length * k;
    boss.pos.z = o.z + d.z + Math.cos(d.yaw) * d.length * k;
    boss.pos.y = ctx.groundPos(boss.pos.x, boss.pos.z).y;
    boss.facing = d.yaw;
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    if (k >= 1) arrive(ctx, inst, boss, st);
    return;
  }
  if (st.lane) {
    const lane = st.lane;
    if (boss.castingAbility !== OLEN_OATHBOUND_CHARGE) {
      st.lane = null;
      return;
    }
    // Planted for the bar: aim locked, no swing, no step.
    boss.pos.x = o.x + lane.x;
    boss.pos.z = o.z + lane.z;
    boss.facing = lane.yaw;
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining <= 0) launch(ctx, inst, boss, st);
    return;
  }
  if (ctx.isStunned(boss)) return;
  st.chargeTimer -= DT;
  if (st.chargeTimer <= 0 && boss.castingAbility === null) markOathboundCharge(ctx, inst, boss, st);
}
