// The Mere Hydra's Combined Breath (docs/design/dungeon-rework/drowned_temple.md
// 4.3; the owner-approved proposal in the Temple encounter pass): between two
// Tsunamis two heads twine their necks and fuse their elements, always in the
// same order so a group learns it.
//
//   Frostlocked Torrent  ICE + WATER: the water head's torrent lane, frozen as
//                    it flies: 90 to 110 frost and a 2 s freeze to everyone in
//                    the lane (no shove). The lane stays standing as an ICE
//                    WALL across the lagoon for 20 s, and the next Tsunami
//                    BREAKS on it: its lee is as safe as a rim column's
//                    (heroic: the shattering wall cuts anyone hugging it).
//   Venom Current    VENOM + WATER: the venom head seeds three pools as the bar
//                    opens (the Venom Spit's own burst), then every venom pool
//                    swells and slides 7 yd out from the pool's middle down a
//                    painted current, burning 30 a second.
//   Toxic Rime       ICE + VENOM: seeded the same way; every venom pool freezes
//                    into a crystal you can stand on for 4 s, then it bursts in
//                    6 yd (100 to 120).
//
// Whoever wields each element takes part (ids.ts hydraElementOwners), so a
// lone survivor carrying both elements casts the combo alone: killing heads
// concentrates the combos, it never silences them. The slots, the hold on the
// plain bars and the pricing are in ids.ts HYDRA_COMBO_TUNING.
//
// Zero rng in every pick (the victims hash on the combo count, their own salt,
// so the plain attacks' victims are untouched); the only draws are the damage
// rolls, in player order.

import { inLane } from '../../mob/trash_kit/lane';
import { kitHash } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { angleTo, DT, type Entity, type HydraFightState } from '../../types';
import {
  claimPlayers,
  clearCastOf,
  dropEncounterObject,
  mechanicDamage,
  spawnTempleObject,
  startCast,
} from './claim';
import { poolPlayers } from './hydra_elements';
import {
  BRINE_SPIT_TEMPLATE,
  HYDRA_BRINE_SPIT,
  HYDRA_COMBO_CASTS,
  HYDRA_COMBO_ELEMENTS,
  HYDRA_COMBO_ORDER,
  HYDRA_COMBO_TUNING,
  HYDRA_FROZEN,
  HYDRA_ICE_WALL_SHATTER,
  HYDRA_RIME_BURST,
  HYDRA_TUNING,
  type HydraComboKind,
  hydraElementOwners,
  ICE_WALL_TEMPLATE,
  iceWallDistance,
  iceWallFrom,
  iceWallInPath,
  iceWallMiddle,
  inIceWallLee,
  RIME_CRYSTAL_TEMPLATE,
  type TsunamiSide,
  VENOM_CURRENT_TEMPLATE,
  venomCurrentHeading,
} from './ids';

const C = HYDRA_COMBO_TUNING;
const T = HYDRA_TUNING;

/** The Tsunami clock readings the combos open at, for a claim's difficulty. */
export function comboSlots(inst: InstanceSlot): readonly number[] {
  return inst.difficulty === 'heroic' ? C.comboAtHeroic : C.comboAt;
}

/** Is a combo due or running (the heads start no plain breath or torrent)? */
export function comboHolding(inst: InstanceSlot, st: HydraFightState): boolean {
  if (st.combo) return true;
  if (st.tsunamis < 1 || st.tsunami) return false;
  const slot = comboSlots(inst)[st.comboSlot];
  return slot !== undefined && st.tsunamiTimer <= slot + C.comboHold;
}

/** The kind the next combo will be (the fixed order, round and round). */
export function nextComboKind(st: HydraFightState): HydraComboKind {
  return HYDRA_COMBO_ORDER[st.combos % HYDRA_COMBO_ORDER.length];
}

function free(ctx: SimContext, h: Entity | null): h is Entity {
  return h !== null && !h.dead && h.castingAbility === null && !ctx.isStunned(h);
}

/** The heads that wield a combo's two elements now (one head when a survivor
 *  carries both), or null when one of the elements has nobody. */
export function comboHeads(
  heads: readonly (Entity | null)[],
  kind: HydraComboKind,
): Entity[] | null {
  const owners = hydraElementOwners(heads.map((h) => !h || h.dead));
  const out: Entity[] = [];
  for (const el of HYDRA_COMBO_ELEMENTS[kind]) {
    const i = owners[el];
    const h = i === null ? null : heads[i];
    if (!h) return null;
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

/** The venom head seeds up to three pools under hashed players (the Venom
 *  Spit's own warned burst), so the combo always has venom to work. */
function seedVenom(ctx: SimContext, inst: InstanceSlot, head: Entity, st: HydraFightState): void {
  const players = poolPlayers(ctx, inst);
  const o = ctx.instanceOriginOf(inst);
  const picked: Entity[] = [];
  for (let k = 0; k < T.spitCount && picked.length < players.length; k++) {
    const pool = players.filter((p) => !picked.includes(p));
    picked.push(pool[kitHash(head.id, 9000 + st.combos * 7 + k) % pool.length]);
  }
  for (const p of picked) {
    const x = p.pos.x - o.x;
    const z = p.pos.z - o.z;
    const obj = spawnTempleObject(ctx, inst, BRINE_SPIT_TEMPLATE, 'Venom Spit', x, z, T.spitRadius);
    st.spits.push({ x, z, remaining: T.spitWarn, objectId: obj.id });
  }
  if (picked.length > 0) {
    ctx.emit({
      type: 'spellfx',
      sourceId: head.id,
      targetId: picked[0].id,
      school: 'nature',
      fx: 'windup',
      ability: HYDRA_BRINE_SPIT,
    });
  }
}

/**
 * Start a Combined Breath (the next in the order unless `kind` is given): a
 * bar on every head that takes part. Returns false while one of them is busy
 * or an element has nobody to wield it.
 */
export function startCombo(
  ctx: SimContext,
  inst: InstanceSlot,
  heads: readonly (Entity | null)[],
  st: HydraFightState,
  kind: HydraComboKind = nextComboKind(st),
): boolean {
  if (st.combo || st.tsunami) return false;
  const part = comboHeads(heads, kind);
  if (!part || part.some((h) => !free(ctx, h))) return false;
  const players = poolPlayers(ctx, inst);
  if (players.length === 0) return false;
  const owners = hydraElementOwners(heads.map((h) => !h || h.dead));
  const water = owners[2] === null ? null : heads[owners[2]];
  let yaw = part[0].facing;
  let victimId: number | null = null;
  if (kind === 'frostlock' && water) {
    // The frozen lane takes the torrent's aim: someone who is not the tank.
    const inReach = players.filter(
      (p) => Math.hypot(p.pos.x - water.pos.x, p.pos.z - water.pos.z) <= T.torrentLength + 4,
    );
    const pool0 = inReach.length > 0 ? inReach : players;
    const others = pool0.filter((p) => p.id !== water.aggroTargetId);
    const pool = others.length > 0 ? others : pool0;
    const victim = pool[kitHash(water.id, 8000 + st.combos) % pool.length];
    yaw = angleTo(water.pos, victim.pos);
    victimId = victim.id;
  }
  st.combo = { kind, headIds: part.map((h) => h.id), remaining: C.comboCast, yaw };
  st.combos++;
  for (const h of part) {
    // The heads twine toward each other; the water head aims its lane.
    const mate = part.find((m) => m !== h);
    const face = kind === 'frostlock' && h === water ? yaw : mate ? angleTo(h.pos, mate.pos) : yaw;
    h.facing = face;
    h.prevFacing = face;
    startCast(h, HYDRA_COMBO_CASTS[kind], C.comboCast, victimId);
  }
  if (kind !== 'frostlock') {
    const venom = owners[1] === null ? null : heads[owners[1]];
    if (venom) seedVenom(ctx, inst, venom, st);
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: part[0].id,
    targetId: part[part.length - 1].id,
    school: kind === 'current' ? 'nature' : 'frost',
    fx: 'windup',
    ability: HYDRA_COMBO_CASTS[kind],
  });
  return true;
}

function landFrostlock(
  ctx: SimContext,
  inst: InstanceSlot,
  source: Entity,
  st: HydraFightState,
  yaw: number,
): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: source.id,
    targetId: source.id,
    school: 'frost',
    fx: 'heavyBolt',
    ability: HYDRA_COMBO_CASTS.frostlock,
  });
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead) continue;
    const { x, z } = source.pos;
    if (!inLane(x, z, yaw, T.torrentLength, T.torrentHalfWidth, p.pos.x, p.pos.z)) continue;
    ctx.dealDamage(
      source,
      p,
      mechanicDamage(ctx, source, C.frostMin, C.frostMax),
      false,
      'frost',
      'Frostlocked Torrent',
      'hit',
      true,
    );
    if (p.dead) continue;
    ctx.applyAura(p, {
      id: HYDRA_FROZEN,
      name: 'Frozen',
      kind: 'stun',
      remaining: C.freezeSeconds,
      duration: C.freezeSeconds,
      value: 0,
      sourceId: source.id,
      school: 'frost',
    });
  }
  // The lane stands on as a wall of ice across the lagoon.
  if (st.iceWall) dropEncounterObject(ctx, inst, st.iceWall.objectId);
  const o = ctx.instanceOriginOf(inst);
  const line = iceWallFrom(source.pos.x - o.x, source.pos.z - o.z, yaw);
  const mid = iceWallMiddle(line);
  const obj = spawnTempleObject(
    ctx,
    inst,
    ICE_WALL_TEMPLATE,
    'Ice Wall',
    mid.x,
    mid.z,
    line.length,
  );
  obj.facing = yaw;
  obj.prevFacing = yaw;
  // It stands its 20 s, and always until the next wave has landed on it (a
  // heroic early slot raises it 28 s before that wave rises).
  const toWave = st.tsunamiTimer + T.tsunamiCast + 1;
  st.iceWall = { ...line, remaining: Math.max(C.wallSeconds, toWave), objectId: obj.id };
}

function landCurrent(
  ctx: SimContext,
  inst: InstanceSlot,
  source: Entity,
  st: HydraFightState,
): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: source.id,
    targetId: source.id,
    school: 'nature',
    fx: 'nova',
    ability: HYDRA_COMBO_CASTS.current,
  });
  for (const v of st.venom) {
    const obj = ctx.entities.get(v.objectId);
    const yaw = venomCurrentHeading(v.x, v.z);
    if (obj) {
      obj.templateId = VENOM_CURRENT_TEMPLATE;
      obj.scale = C.currentRadius;
      obj.facing = yaw;
      obj.prevFacing = yaw;
    }
    st.currents.push({
      x: v.x,
      z: v.z,
      yaw,
      slide: C.currentSlideSeconds,
      remaining: C.currentSlideSeconds + C.currentLinger,
      tick: 1,
      objectId: v.objectId,
    });
  }
  st.venom = [];
}

function landRime(ctx: SimContext, source: Entity, st: HydraFightState): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: source.id,
    targetId: source.id,
    school: 'frost',
    fx: 'nova',
    ability: HYDRA_COMBO_CASTS.rime,
  });
  for (const v of st.venom) {
    const obj = ctx.entities.get(v.objectId);
    if (obj) {
      obj.templateId = RIME_CRYSTAL_TEMPLATE;
      obj.scale = C.rimeRadius;
    }
    st.crystals.push({ x: v.x, z: v.z, remaining: C.rimeSeconds, objectId: v.objectId });
  }
  st.venom = [];
}

/** Advance the combo bar in flight; it lands when it runs out. */
export function stepCombo(
  ctx: SimContext,
  inst: InstanceSlot,
  heads: readonly (Entity | null)[],
  st: HydraFightState,
): void {
  const c = st.combo;
  if (!c) return;
  const castId = HYDRA_COMBO_CASTS[c.kind];
  const part = heads.filter(
    (h): h is Entity =>
      h !== null && !h.dead && c.headIds.includes(h.id) && h.castingAbility === castId,
  );
  if (part.length === 0) {
    // Every head that took part fell (or was cut off): the breath dies with it.
    st.combo = null;
    return;
  }
  c.remaining -= DT;
  for (const h of part) {
    h.castRemaining = Math.max(0, c.remaining);
    h.swingTimer = Math.max(h.swingTimer, 0.6);
    h.facing = h.prevFacing;
  }
  if (c.remaining > 0) return;
  for (const h of part) clearCastOf(h, castId);
  st.combo = null;
  const owners = hydraElementOwners(heads.map((h) => !h || h.dead));
  const water = owners[2] === null ? null : heads[owners[2]];
  if (c.kind === 'frostlock') {
    const src = water && part.includes(water) ? water : part[0];
    landFrostlock(ctx, inst, src, st, c.yaw);
  } else if (c.kind === 'current') {
    landCurrent(ctx, inst, part[0], st);
  } else {
    landRime(ctx, part[0], st);
  }
}

/** Open the slot that is due (the Tsunami clock reached it). */
export function stepComboSlots(
  ctx: SimContext,
  inst: InstanceSlot,
  heads: readonly (Entity | null)[],
  st: HydraFightState,
): void {
  if (st.combo || st.tsunami || st.tsunamis < 1) return;
  const slot = comboSlots(inst)[st.comboSlot];
  if (slot === undefined || st.tsunamiTimer > slot) return;
  if (st.tsunamiTimer < C.comboLatest) {
    // Too close to the wave: this slot passes.
    st.comboSlot++;
    return;
  }
  if (startCombo(ctx, inst, heads, st)) st.comboSlot++;
}

/** The standing hazards a combo left: the Ice Wall melts, the currents slide
 *  and burn, the crystals count down and burst. */
export function stepComboHazards(
  ctx: SimContext,
  inst: InstanceSlot,
  st: HydraFightState,
  source: Entity,
): void {
  const o = ctx.instanceOriginOf(inst);
  const w = st.iceWall;
  if (w) {
    w.remaining -= DT;
    // A wall never melts with a wave in flight: the wave settles it.
    if (w.remaining <= 0 && !st.tsunami) {
      dropEncounterObject(ctx, inst, w.objectId);
      st.iceWall = null;
    }
  }
  const speed = C.currentSlide / C.currentSlideSeconds;
  for (let i = st.currents.length - 1; i >= 0; i--) {
    const c = st.currents[i];
    c.remaining -= DT;
    if (c.slide > 0) {
      const step = Math.min(DT, c.slide);
      c.slide -= DT;
      c.x += Math.sin(c.yaw) * speed * step;
      c.z += Math.cos(c.yaw) * speed * step;
      const obj = ctx.entities.get(c.objectId);
      if (obj) {
        obj.pos = ctx.groundPos(o.x + c.x, o.z + c.z);
        ctx.rebucket(obj);
      }
    }
    c.tick -= DT;
    if (c.tick <= 0) {
      c.tick += 1;
      for (const p of claimPlayers(ctx, inst)) {
        if (p.dead || Math.hypot(p.pos.x - o.x - c.x, p.pos.z - o.z - c.z) > C.currentRadius)
          continue;
        const amount = Math.max(
          1,
          Math.round(C.currentPerSecond * (source.mechanicDamageMult ?? 1)),
        );
        ctx.dealDamage(source, p, amount, false, 'nature', 'Venom Current', 'hit', true);
      }
    }
    if (c.remaining > 0) continue;
    dropEncounterObject(ctx, inst, c.objectId);
    st.currents.splice(i, 1);
  }
  for (let i = st.crystals.length - 1; i >= 0; i--) {
    const k = st.crystals[i];
    k.remaining -= DT;
    if (k.remaining > 0) continue;
    ctx.emit({
      type: 'spellfx',
      sourceId: source.id,
      targetId: k.objectId,
      school: 'frost',
      fx: 'nova',
      ability: HYDRA_RIME_BURST,
    });
    for (const p of claimPlayers(ctx, inst)) {
      if (p.dead || Math.hypot(p.pos.x - o.x - k.x, p.pos.z - o.z - k.z) > C.rimeRadius) continue;
      ctx.dealDamage(
        source,
        p,
        mechanicDamage(ctx, source, C.rimeMin, C.rimeMax),
        false,
        'frost',
        'Toxic Rime',
        'hit',
        true,
      );
    }
    dropEncounterObject(ctx, inst, k.objectId);
    st.crystals.splice(i, 1);
  }
}

/** Does the Ice Wall shelter a spot (instance-local) from a wave from `side`? */
export function iceWallShelters(
  st: HydraFightState,
  side: TsunamiSide,
  x: number,
  z: number,
): boolean {
  const w = st.iceWall;
  return w !== null && iceWallInPath(w, side) && inIceWallLee(w, side, x, z);
}

/** A wave from `side` has landed: if the Ice Wall stood in its path it breaks
 *  (heroic: its shards cut anyone hugging it). Returns true when it broke. */
export function breakIceWall(
  ctx: SimContext,
  inst: InstanceSlot,
  source: Entity,
  st: HydraFightState,
  side: TsunamiSide,
): boolean {
  const w = st.iceWall;
  if (!w || !iceWallInPath(w, side)) return false;
  ctx.emit({
    type: 'spellfx',
    sourceId: source.id,
    targetId: w.objectId,
    school: 'frost',
    fx: 'nova',
    ability: HYDRA_ICE_WALL_SHATTER,
  });
  if (inst.difficulty === 'heroic') {
    const o = ctx.instanceOriginOf(inst);
    for (const p of claimPlayers(ctx, inst)) {
      if (p.dead || iceWallDistance(w, p.pos.x - o.x, p.pos.z - o.z) > C.shardReach) continue;
      ctx.dealDamage(
        source,
        p,
        mechanicDamage(ctx, source, C.shardMin, C.shardMax),
        false,
        'frost',
        'Ice Shards',
        'hit',
        true,
      );
    }
  }
  dropEncounterObject(ctx, inst, w.objectId);
  st.iceWall = null;
  return true;
}

/** The fight ended: the wall melts, the currents and crystals drain, and a
 *  combo bar in flight is cut. */
export function clearCombo(
  ctx: SimContext,
  inst: InstanceSlot,
  heads: readonly (Entity | null)[],
  st: HydraFightState,
): void {
  if (st.iceWall) dropEncounterObject(ctx, inst, st.iceWall.objectId);
  for (const c of st.currents) dropEncounterObject(ctx, inst, c.objectId);
  for (const k of st.crystals) dropEncounterObject(ctx, inst, k.objectId);
  st.iceWall = null;
  st.currents = [];
  st.crystals = [];
  st.combo = null;
  for (const h of heads) {
    if (!h) continue;
    for (const id of Object.values(HYDRA_COMBO_CASTS)) clearCastOf(h, id);
  }
  // A freeze still on someone thaws with the fight.
  for (const p of claimPlayers(ctx, inst)) {
    if (p.auras.some((a) => a.id === HYDRA_FROZEN))
      p.auras = p.auras.filter((a) => a.id !== HYDRA_FROZEN);
  }
}
