// Knight-Commander Olen on the Breach Bastion: a FALLEN PALADIN. He swore to
// hold the Bastion and the sea took it with him; the oath endures, drowned and
// corrupted, and so does the holy light he fought with, gone dark with brine.
//
//   Hallowed Brine        every 14 s (first at 6 s) a 1.2 s bar: he drives his
//                         sword into the flags and a 9 yd pool of dark holy
//                         sea-water wells up where he stands, for 15 s: 18 a
//                         second to every player in it, and while HE stands in
//                         it he takes 40 percent less damage. The tank drags
//                         him out of it.
//   Rebounding Bulwark    every 18 s (first at 11 s) a 1.5 s bar on a non-tank
//                         player: he hurls his kite shield at them (60 to 70
//                         physical), and it rebounds to the nearest player not
//                         yet struck within 10 yd, up to 3 players, then flies
//                         home to him. Do not stand together.
//   Sentence of the Tide  every 22 s (first at 16 s) a 1 s bar (he points his
//                         sword) marks a non-tank player; 5 s later a column of
//                         drowned light falls on them: 110 to 125 holy to
//                         everyone within 6 yd of the mark. Take it away from
//                         the group.
//   Unbroken Oath         at half health he kneels and plants his sword (1.5 s)
//                         and a water bubble seals him (immune) while two
//                         Drowned Sergeants of his garrison rise round him;
//                         killing both breaks the bubble and leaves him
//                         Breached (stunned 4 s, 20 percent more damage taken
//                         for 10 s). His vigil lasts 60 s at most.
//   Reaping Arc           his kept cleave (the template's `cleave`).
//   Heroic                a 10 yd brine of 26 a second, four rebounds, an 8 yd
//                         Sentence, three soldiers.
//
// The pressure math (against the retired Oathbound Charge) is on OLEN_KIT.
// Zero rng in every pick (hashed through pickMarkTargets, nearest-player
// rebounds with ties to the lower id); the only draws are the damage rolls.

import { BASTION_BUTTRESSES, BREACH_BASTION } from '../../content/sunken_bastion_layout';
import { spawnKitAdd } from '../../mob/trash_kit/spawn';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type OlenFightState } from '../../types';
import {
  claimObjectAt,
  claimPlayers,
  clearCastIf,
  dropAuraById,
  dropEncounterObject,
  grantClaimDeed,
  localOf,
  mechanicDamage,
  pickMarkTargets,
  spawnEncounterObject,
  startBar,
} from './claim';
import {
  BUTTRESS_TEMPLATES,
  brineRadius,
  bulwarkChain,
  HALLOWED_BRINE_TEMPLATE,
  OLEN_BREACHED,
  OLEN_BREACHED_VULN,
  OLEN_BRINE_HALLOWED,
  OLEN_HALLOWED_BRINE,
  OLEN_IN_BRINE,
  OLEN_KIT,
  OLEN_OATH_KNEEL,
  OLEN_OATH_VIGIL,
  OLEN_REBOUNDING_BULWARK,
  OLEN_SENTENCED,
  OLEN_SOLDIER_ID,
  OLEN_TIDE_SENTENCE,
  OLEN_UNBROKEN_OATH,
  sentenceRadius,
} from './ids';

const T = OLEN_KIT;
export const OLEN_DEED = 'dgn_olen_buttress';
/** The vigil's longest wait (its channel bar): then the Oath ends unbroken. */
export const OLEN_VIGIL_MAX = 60;

type OlenBar = 'brine' | 'bulwark' | 'sentence';

function freshState(): OlenFightState {
  return {
    kind: 'olen',
    brineTimer: T.brineFirst,
    bulwarkTimer: T.bulwarkFirst,
    sentenceTimer: T.sentenceFirst,
    casts: 0,
    bar: null,
    pools: [],
    brineTick: 1,
    bulwark: null,
    sentence: null,
    oath: 'none',
    oathT: 0,
    soldierIds: [],
    oathSpot: null,
    rebounded: false,
  };
}

const BAR_ID: Record<OlenBar, string> = {
  brine: OLEN_HALLOWED_BRINE,
  bulwark: OLEN_REBOUNDING_BULWARK,
  sentence: OLEN_TIDE_SENTENCE,
};
const BAR_SECONDS: Record<OlenBar, number> = {
  brine: T.brineCast,
  bulwark: T.bulwarkCast,
  sentence: T.sentenceCast,
};

/** Hold him on a spot for a bar or the vigil: no step, no swing. */
function hold(ctx: SimContext, inst: InstanceSlot, boss: Entity, x: number, z: number): void {
  const o = ctx.instanceOriginOf(inst);
  const g = ctx.groundPos(o.x + x, o.z + z);
  boss.pos.x = g.x;
  boss.pos.y = g.y;
  boss.pos.z = g.z;
  boss.swingTimer = Math.max(boss.swingTimer, 0.6);
  ctx.grid.update(boss);
}

/** Put (or refresh) a quiet marker aura (it refreshes every tick, so it goes
 *  straight onto the list instead of through applyAura's log). */
function marker(
  e: Entity,
  id: string,
  name: string,
  seconds: number,
  sourceId: number,
  kind: 'slow' | 'buff_dr',
  value: number,
): void {
  const a = e.auras.find((x) => x.id === id);
  if (a) {
    // Topped up only once it has run down by half: a body standing in the
    // brine does not rewrite its aura (and its wire record) every tick.
    if (a.remaining < seconds * 0.5) a.remaining = seconds;
    a.value = value;
    return;
  }
  e.auras.push({
    id,
    name,
    kind,
    remaining: seconds,
    duration: seconds,
    value,
    sourceId,
    school: 'holy',
    undispellable: true,
  });
}

/** Start one of his bars (dev triggers and the cadence). */
export function startOlenBar(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: OlenFightState,
  what: OlenBar,
): boolean {
  if (st.bar || st.oath === 'kneel' || st.oath === 'vigil') return false;
  if (what === 'bulwark' && st.bulwark) return false;
  if (what === 'sentence' && st.sentence) return false;
  let targetId = boss.id;
  if (what !== 'brine') {
    const busy = new Set<number>(st.sentence ? [st.sentence.markId] : []);
    const salt = st.casts * 3 + (what === 'bulwark' ? 1 : 2);
    const pick = pickMarkTargets(boss, claimPlayers(ctx, inst), 1, salt, busy);
    if (!pick[0]) return false;
    targetId = pick[0].id;
  }
  st.casts++;
  const at = localOf(ctx, inst, boss);
  st.bar = { what, targetId, x: at.x, z: at.z };
  startBar(boss, BAR_ID[what], BAR_SECONDS[what], targetId === boss.id ? null : targetId);
  const t = targetId === boss.id ? null : ctx.entities.get(targetId);
  if (t) boss.facing = Math.atan2(t.pos.x - boss.pos.x, t.pos.z - boss.pos.z);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId,
    school: 'holy',
    fx: 'windup',
    ability: BAR_ID[what],
  });
  if (what === 'brine') st.brineTimer = T.brineEvery;
  else if (what === 'bulwark') st.bulwarkTimer = T.bulwarkEvery;
  else st.sentenceTimer = T.sentenceEvery;
  return true;
}

/** A bar lands. */
function landBar(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: OlenFightState): void {
  const bar = st.bar;
  if (!bar) return;
  st.bar = null;
  clearCastIf(boss, BAR_ID[bar.what]);
  if (bar.what === 'brine') {
    const radius = brineRadius(inst.difficulty === 'heroic');
    const at = localOf(ctx, inst, boss);
    const pool = spawnEncounterObject(
      ctx,
      inst,
      HALLOWED_BRINE_TEMPLATE,
      'Hallowed Brine',
      at.x,
      at.z,
      boss.facing,
      radius,
    );
    st.pools.push({ objectId: pool.id, x: at.x, z: at.z, radius, remaining: T.brineSeconds });
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'holy',
      fx: 'nova',
      ability: OLEN_HALLOWED_BRINE,
    });
    return;
  }
  const target = ctx.entities.get(bar.targetId);
  if (!target || target.dead || target.ghost) return;
  if (bar.what === 'bulwark') {
    st.bulwark = { chain: [target.id], hop: 0, t: 0, home: false };
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: target.id,
      school: 'physical',
      fx: 'projectile',
      ability: OLEN_REBOUNDING_BULWARK,
    });
    return;
  }
  st.sentence = { markId: target.id, remaining: T.sentenceSeconds };
  marker(target, OLEN_SENTENCED, 'Sentence of the Tide', T.sentenceSeconds, boss.id, 'slow', 1);
  // The splash's reach rides the mark (value2), so every client paints the
  // ring the sim strikes, heroic or not.
  const mark = target.auras.find((a) => a.id === OLEN_SENTENCED);
  if (mark) mark.value2 = sentenceRadius(inst.difficulty === 'heroic');
}

/** The shield in flight: each leg lands, strikes, and finds its rebound. */
function stepBulwark(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: OlenFightState): void {
  const b = st.bulwark;
  if (!b) return;
  b.t += DT;
  if (b.t < T.bulwarkHop - 1e-6) return;
  b.t = 0;
  if (b.home) {
    st.bulwark = null;
    return;
  }
  const hitId = b.chain[b.hop];
  const hit = ctx.entities.get(hitId);
  if (hit && !hit.dead && !hit.ghost) {
    ctx.dealDamage(
      boss,
      hit,
      mechanicDamage(ctx, boss, T.bulwarkMin, T.bulwarkMax),
      false,
      'physical',
      'Rebounding Bulwark',
      'hit',
      true,
    );
    if (b.hop > 0) st.rebounded = true;
  }
  const max = inst.difficulty === 'heroic' ? T.bulwarkHitsHeroic : T.bulwarkHits;
  let next: number | null = null;
  if (hit && b.chain.length < max) {
    const o = ctx.instanceOriginOf(inst);
    const others = claimPlayers(ctx, inst)
      .filter((p) => !b.chain.includes(p.id))
      .map((p) => ({ id: p.id, x: p.pos.x - o.x, z: p.pos.z - o.z }));
    const from = { id: hit.id, x: hit.pos.x - o.x, z: hit.pos.z - o.z };
    next = bulwarkChain(from, others, T.bulwarkReach, 2)[1] ?? null;
  }
  b.hop++;
  if (next !== null) {
    b.chain.push(next);
  } else {
    // Nobody left in reach: it flies home to his arm.
    b.home = true;
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: hitId,
    targetId: next ?? boss.id,
    school: 'physical',
    fx: 'projectile',
    ability: OLEN_REBOUNDING_BULWARK,
  });
}

/** The marked player's countdown, then the column of drowned light. */
function stepSentence(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: OlenFightState): void {
  const s = st.sentence;
  if (!s) return;
  s.remaining -= DT;
  if (s.remaining > 1e-6) return;
  st.sentence = null;
  const mark = ctx.entities.get(s.markId);
  if (!mark) return;
  dropAuraById(mark, OLEN_SENTENCED);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: mark.id,
    school: 'holy',
    fx: 'detonate',
    ability: OLEN_TIDE_SENTENCE,
  });
  const radius = sentenceRadius(inst.difficulty === 'heroic');
  for (const p of claimPlayers(ctx, inst)) {
    if (dist2d(p.pos, mark.pos) > radius) continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.sentenceMin, T.sentenceMax),
      false,
      'holy',
      'Sentence of the Tide',
      'hit',
      true,
    );
  }
}

/** The brine pools: they burn whoever stands in them, shield him, and dry. */
function stepPools(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: OlenFightState): void {
  const o = ctx.instanceOriginOf(inst);
  for (const pool of st.pools) pool.remaining -= DT;
  for (const pool of st.pools)
    if (pool.remaining <= 0) dropEncounterObject(ctx, inst, pool.objectId);
  st.pools = st.pools.filter((p) => p.remaining > 0);
  const inPool = (e: Entity) =>
    st.pools.some((p) => Math.hypot(e.pos.x - o.x - p.x, e.pos.z - o.z - p.z) <= p.radius);
  // Standing in his own brine shields him: the tank must drag him out.
  if (inPool(boss))
    marker(boss, OLEN_BRINE_HALLOWED, 'Brine-Hallowed', 1, boss.id, 'buff_dr', T.brineShield);
  else dropAuraById(boss, OLEN_BRINE_HALLOWED);
  st.brineTick -= DT;
  const pulse = st.brineTick <= 1e-6;
  if (pulse) st.brineTick += 1;
  const per = inst.difficulty === 'heroic' ? T.brinePerSecondHeroic : T.brinePerSecond;
  for (const p of claimPlayers(ctx, inst)) {
    if (!inPool(p)) {
      dropAuraById(p, OLEN_IN_BRINE);
      continue;
    }
    marker(p, OLEN_IN_BRINE, 'Hallowed Brine', 1, boss.id, 'slow', 1);
    if (!pulse) continue;
    ctx.dealDamage(
      boss,
      p,
      Math.max(1, Math.round(per * (boss.mechanicDamageMult ?? 1))),
      false,
      'holy',
      'Hallowed Brine',
      'hit',
      true,
    );
  }
}

/** At half health: he kneels and the bubble seals him (dev trigger too). */
export function beginOath(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: OlenFightState,
): boolean {
  if (st.oath !== 'none') return false;
  if (st.bar) clearCastIf(boss, BAR_ID[st.bar.what]);
  st.bar = null;
  st.oath = 'kneel';
  st.oathT = 0;
  st.oathSpot = localOf(ctx, inst, boss);
  st.soldierIds = [];
  startBar(boss, OLEN_OATH_KNEEL, T.oathKneel, null);
  boss.damageImmune = true;
  dropAuraById(boss, OLEN_UNBROKEN_OATH);
  boss.auras.push({
    id: OLEN_UNBROKEN_OATH,
    name: 'Unbroken Oath',
    kind: 'buff_dr',
    remaining: OLEN_VIGIL_MAX + T.oathKneel,
    duration: OLEN_VIGIL_MAX + T.oathKneel,
    value: 0,
    sourceId: boss.id,
    school: 'holy',
    undispellable: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'holy',
    fx: 'windup',
    ability: OLEN_OATH_KNEEL,
  });
  return true;
}

/** A spot kept inside the Breach Bastion's rim (instance-local). */
function onBastion(x: number, z: number): { x: number; z: number } {
  const dx = x - BREACH_BASTION.x;
  const dz = z - BREACH_BASTION.z;
  const d = Math.hypot(dx, dz);
  const r = BREACH_BASTION.r - 4;
  if (d <= r) return { x, z };
  return { x: BREACH_BASTION.x + (dx / d) * r, z: BREACH_BASTION.z + (dz / d) * r };
}

/** His soldiers rise round him, spread evenly, each on a hashed player. */
function raiseSoldiers(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: OlenFightState,
): void {
  const n = inst.difficulty === 'heroic' ? T.oathSoldiersHeroic : T.oathSoldiers;
  const players = claimPlayers(ctx, inst);
  const victims = pickMarkTargets(boss, players, n, st.casts * 3 + 7);
  const o = ctx.instanceOriginOf(inst);
  for (let k = 0; k < n; k++) {
    const a = boss.facing + Math.PI / 2 + (k * Math.PI * 2) / n;
    // Kept on the Breach Bastion's floor (he may kneel by its open rim).
    const at = onBastion(
      boss.pos.x - o.x + Math.sin(a) * T.oathSoldierRing,
      boss.pos.z - o.z + Math.cos(a) * T.oathSoldierRing,
    );
    const x = o.x + at.x;
    const z = o.z + at.z;
    const victim = victims[k % Math.max(1, victims.length)] ?? players[0] ?? null;
    const soldier = spawnKitAdd(ctx, inst, boss, OLEN_SOLDIER_ID, x, z, victim);
    if (!soldier) continue;
    // They rise facing out from their kneeling commander.
    soldier.facing = Math.atan2(soldier.pos.x - boss.pos.x, soldier.pos.z - boss.pos.z);
    soldier.prevFacing = soldier.facing;
    st.soldierIds.push(soldier.id);
    ctx.emit({
      type: 'spellfx',
      sourceId: soldier.id,
      targetId: soldier.id,
      school: 'holy',
      fx: 'nova',
      ability: OLEN_OATH_VIGIL,
    });
  }
}

/** The bubble bursts: his soldiers fell (Breached), or the vigil ran out. */
function endOath(ctx: SimContext, boss: Entity, st: OlenFightState, broken: boolean): void {
  st.oath = 'done';
  st.oathSpot = null;
  clearCastIf(boss, OLEN_OATH_KNEEL, OLEN_OATH_VIGIL);
  boss.damageImmune = false;
  dropAuraById(boss, OLEN_UNBROKEN_OATH);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'holy',
    fx: 'detonate',
    ability: OLEN_UNBROKEN_OATH,
  });
  if (!broken) return;
  ctx.applyAura(boss, {
    id: OLEN_BREACHED,
    name: 'Breached',
    kind: 'stun',
    remaining: T.oathBrokenStun,
    duration: T.oathBrokenStun,
    value: 0,
    sourceId: boss.id,
    school: 'holy',
    unbreakableControl: true,
  });
  ctx.applyAura(boss, {
    id: OLEN_BREACHED_VULN,
    name: 'Breached',
    kind: 'vulnerability',
    remaining: T.oathBrokenVulnSeconds,
    duration: T.oathBrokenVulnSeconds,
    value: T.oathBrokenVuln,
    sourceId: boss.id,
    school: 'holy',
  });
}

function stepOath(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: OlenFightState): void {
  const spot = st.oathSpot ?? localOf(ctx, inst, boss);
  hold(ctx, inst, boss, spot.x, spot.z);
  st.oathT += DT;
  if (st.oath === 'kneel') {
    if (boss.castingAbility === OLEN_OATH_KNEEL)
      boss.castRemaining = Math.max(0, T.oathKneel - st.oathT);
    if (st.oathT < T.oathKneel - 1e-6) return;
    clearCastIf(boss, OLEN_OATH_KNEEL);
    st.oath = 'vigil';
    st.oathT = 0;
    startBar(boss, OLEN_OATH_VIGIL, OLEN_VIGIL_MAX, null, true);
    raiseSoldiers(ctx, inst, boss, st);
    return;
  }
  if (boss.castingAbility === OLEN_OATH_VIGIL)
    boss.castRemaining = Math.max(0, OLEN_VIGIL_MAX - st.oathT);
  const standing = st.soldierIds.some((id) => {
    const e = ctx.entities.get(id);
    return e !== undefined && !e.dead;
  });
  if (!standing) endOath(ctx, boss, st, true);
  else if (st.oathT >= OLEN_VIGIL_MAX) endOath(ctx, boss, st, false);
}

function dropPools(ctx: SimContext, inst: InstanceSlot, st: OlenFightState): void {
  for (const p of st.pools) dropEncounterObject(ctx, inst, p.objectId);
  st.pools = [];
}

function clearMarks(ctx: SimContext, inst: InstanceSlot): void {
  for (const p of claimPlayers(ctx, inst)) {
    dropAuraById(p, OLEN_SENTENCED);
    dropAuraById(p, OLEN_IN_BRINE);
  }
}

/** The fight ended (a wipe, an evade, a reset): the brine dries, the bubble
 *  lifts, the marks clear, every buttress stands whole. */
export function resetOlen(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const st = boss.bastionFight;
  if (st?.kind === 'olen') {
    dropPools(ctx, inst, st);
    if (st.bar) clearCastIf(boss, BAR_ID[st.bar.what]);
  }
  clearCastIf(boss, OLEN_OATH_KNEEL, OLEN_OATH_VIGIL);
  boss.damageImmune = false;
  boss.auras = boss.auras.filter(
    (a) => a.id !== OLEN_UNBROKEN_OATH && a.id !== OLEN_BRINE_HALLOWED,
  );
  clearMarks(ctx, inst);
  boss.bastionFight = undefined;
  if (boss.dead) return;
  for (const b of BASTION_BUTTRESSES) {
    const e = claimObjectAt(ctx, inst, b.x, b.z);
    if (e && e.templateId !== BUTTRESS_TEMPLATES.intact) {
      e.templateId = BUTTRESS_TEMPLATES.intact;
      e.name = 'Buttress';
    }
  }
}

/** Olen was slain: the deed, then the tidy-up. */
function concludeOlen(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: OlenFightState): void {
  if (!st.rebounded) grantClaimDeed(ctx, inst, OLEN_DEED);
  dropPools(ctx, inst, st);
  clearMarks(ctx, inst);
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
  stepPools(ctx, inst, boss, st);
  stepBulwark(ctx, inst, boss, st);
  stepSentence(ctx, inst, boss, st);
  if (st.oath === 'kneel' || st.oath === 'vigil') {
    stepOath(ctx, inst, boss, st);
    return;
  }
  const share = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  if (st.oath === 'none' && share <= T.oathAt) {
    beginOath(ctx, inst, boss, st);
    return;
  }
  if (st.bar) {
    const bar = st.bar;
    if (boss.castingAbility !== BAR_ID[bar.what]) {
      st.bar = null;
      return;
    }
    hold(ctx, inst, boss, bar.x, bar.z);
    const t = ctx.entities.get(bar.targetId);
    if (t && t !== boss) boss.facing = Math.atan2(t.pos.x - boss.pos.x, t.pos.z - boss.pos.z);
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining <= 1e-6) landBar(ctx, inst, boss, st);
    return;
  }
  if (ctx.isStunned(boss) || boss.castingAbility !== null) return;
  st.brineTimer -= DT;
  st.bulwarkTimer -= DT;
  st.sentenceTimer -= DT;
  // One bar at a time: the brine first (the tank's move), then the shield,
  // then the Sentence; one that cannot start yet (nobody to mark) waits.
  if (st.brineTimer <= 0 && startOlenBar(ctx, inst, boss, st, 'brine')) return;
  if (st.bulwarkTimer <= 0 && startOlenBar(ctx, inst, boss, st, 'bulwark')) return;
  if (st.sentenceTimer <= 0) startOlenBar(ctx, inst, boss, st, 'sentence');
}
