// Vael the Fogbinder on the Beacon Crown (docs/design/dungeon-rework/
// sunken_bastion.md, "Boss 3"): Death itself, a hooded reaper with a great
// scythe. Find the real Vael among his shadow copies, and never stand in
// front of the player he rises behind.
//
//   Entrance        buried under the crown until the group climbs onto it,
//                   he rises and speaks round the Fogbeacon, untouchable,
//                   then takes his place and fights (vael_intro.ts).
//   Shadowstep      a chain of three steps about every 33 s (first at 12 s), each
//                   behind a different player: he sinks (untouchable), a
//                   shadow pool opens behind the mark, he rises out of it and
//                   sweeps the scythe through their back (vael_shadowstep.ts).
//   Heroic extra    Grave Shadow: each pool lingers and burns.
//
//   Mist Surge      every 12 s (first at 6 s) a 1.5 s bar, then 30 to 40 frost to
//                   everyone within 12 yd (every 8 s under a quarter: Last Hymn).
//   Drowned Thralls two at 60 and 30 percent (the template's summonAdds).
//   Fog Veil        at 70 and 40 percent the fog gathers (he stills and speaks
//                   the warning, untouchable, then sinks: vael_veil_gather.ts),
//                   and four figures rise on the rim (Vael and three Fog
//                   Shades, identical); all four channel the Drowning Hymn for
//                   18 s (frost to everyone every second, 8 rising by 3 every
//                   3 s). The Fogbeacon's beam sweeps the roof every 4 s: in it
//                   a shade turns see-through (Hollow Shade) while the real
//                   Vael's lantern flares (Beacon-Lit); each tell outlasts the
//                   beam by 1.5 s. Striking the real Vael for 5 percent of his
//                   health breaks the veil (the hymn ends, he staggers 4 s and
//                   takes 20 percent more damage for 10 s). Striking a shade
//                   bursts it (Fogburst: 50 to 60 frost in 6 yd and a 2 s stun).
//   Heroic          Drifting Shades: the four figures shift one place round the
//                   rim every 5 s. Mistbound: a burst shade leaves a thrall.
//
// Zero rng in every pick (the real slot and the ring's phase are hashed); the
// only draws are the damage rolls.

import { spawnKitAdd } from '../../mob/trash_kit/spawn';
import { kitHash } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type VaelFightState } from '../../types';
import {
  claimObjectAt,
  claimPlayers,
  dropAuraById,
  grantClaimDeed,
  localOf,
  mechanicDamage,
} from './claim';
import {
  BEACON,
  BEACON_LAMP_TEMPLATE,
  CROWN,
  DROWNED_THRALL_ID,
  FOG_SHADE_ID,
  inBeam,
  VAEL_BEACON_LIT,
  VAEL_DROWNING_HYMN,
  VAEL_EXPOSED,
  VAEL_FOG_VEIL,
  VAEL_FOGBURST,
  VAEL_HYMN_DROWNING,
  VAEL_MIST_SURGE,
  VAEL_SHADE_HOLLOW,
  VAEL_STAGGER,
  VAEL_TUNING,
  VAEL_VEIL_RISE,
  veilBeamYaw,
  veilSlots,
} from './ids';
import { rearmVaelIntro, tickVaelIntro } from './vael_intro';
import { clearGraves, endReap, startShadowstep, stepGraves, stepReap } from './vael_shadowstep';
import { endVeilGather, startVeilGather, stepVeilGather } from './vael_veil_gather';

export { startShadowstep } from './vael_shadowstep';

const T = VAEL_TUNING;
export const VAEL_DEED = 'dgn_vael_beacon';

function freshState(): VaelFightState {
  return {
    kind: 'vael',
    surgeTimer: T.surgeFirst,
    veils: 0,
    veil: null,
    burst: false,
    reapTimer: T.reapFirst,
    reaps: 0,
    reap: null,
    graves: [],
    gather: null,
  };
}

function clearCastOf(e: Entity, castId: string): void {
  if (e.castingAbility !== castId) return;
  e.castingAbility = null;
  e.castRemaining = 0;
  e.castTotal = 0;
  e.castTargetId = null;
  e.channeling = false;
}

/** The claim's Fogbeacon lamp object (its facing carries the beam's yaw). */
export function beaconLamp(ctx: SimContext, inst: InstanceSlot): Entity | null {
  const e = claimObjectAt(ctx, inst, BEACON.x, BEACON.z);
  return e?.templateId === BEACON_LAMP_TEMPLATE ? e : null;
}

function place(ctx: SimContext, inst: InstanceSlot, e: Entity, x: number, z: number): void {
  const o = ctx.instanceOriginOf(inst);
  const g = ctx.groundPos(o.x + x, o.z + z);
  e.pos.x = g.x;
  e.pos.y = g.y;
  e.pos.z = g.z;
  e.prevPos = { ...e.pos };
  // Face the Fogbeacon (they sing to it).
  e.facing = Math.atan2(BEACON.x - x, BEACON.z - z);
  e.prevFacing = e.facing;
}

/** A veil figure rises out of the roof (the Emerge rise, on a short bar). */
function riseFromFog(e: Entity): void {
  e.castingAbility = VAEL_VEIL_RISE;
  e.castTotal = T.veilRiseSeconds;
  e.castRemaining = T.veilRiseSeconds;
  e.castTargetId = null;
  e.channeling = false;
}

/** The figure's bar this tick: still rising, else the hymn (its bar runs on
 *  the veil's own clock). */
function veilBar(e: Entity, elapsed: number): void {
  if (elapsed < T.veilRiseSeconds) {
    if (e.castingAbility !== VAEL_VEIL_RISE) riseFromFog(e);
    e.castRemaining = Math.max(0, T.veilRiseSeconds - elapsed);
    return;
  }
  if (e.castingAbility !== VAEL_DROWNING_HYMN) channelHymn(e);
  e.castRemaining = Math.max(0, T.hymnSeconds - elapsed);
}

function channelHymn(e: Entity): void {
  e.castingAbility = VAEL_DROWNING_HYMN;
  e.castTotal = T.hymnSeconds;
  e.castRemaining = T.hymnSeconds;
  e.castTargetId = null;
  e.channeling = true;
}

/** The fog takes Vael: he and three shades rise out of the roof together
 *  (none simply appears), then all four begin the hymn. */
export function startFogVeil(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VaelFightState,
): void {
  st.veils++;
  const phase = (kitHash(boss.id, st.veils * 13) % 360) * (Math.PI / 180);
  const slots = veilSlots(phase);
  const realSlot = kitHash(boss.id, st.veils * 31 + 7) % 4;
  const home = localOf(ctx, inst, boss);
  clearCastOf(boss, VAEL_MIST_SURGE);
  const o = ctx.instanceOriginOf(inst);
  const shadeIds: number[] = [];
  const players = claimPlayers(ctx, inst);
  for (let k = 0; k < 4; k++) {
    if (k === realSlot) {
      shadeIds.push(boss.id);
      continue;
    }
    const victim = players[0] ?? null;
    const shade = spawnKitAdd(
      ctx,
      inst,
      boss,
      FOG_SHADE_ID,
      o.x + slots[k].x,
      o.z + slots[k].z,
      victim,
    );
    if (!shade) {
      shadeIds.push(-1);
      continue;
    }
    // Indistinguishable at a glance: his health, his level, his name.
    shade.maxHp = boss.maxHp;
    shade.hp = boss.hp;
    shade.level = boss.level;
    place(ctx, inst, shade, slots[k].x, slots[k].z);
    riseFromFog(shade);
    shadeIds.push(shade.id);
  }
  place(ctx, inst, boss, slots[realSlot].x, slots[realSlot].z);
  riseFromFog(boss);
  ctx.applyAura(boss, {
    id: VAEL_FOG_VEIL,
    name: 'Fog Veil',
    kind: 'buff_dr',
    remaining: T.hymnSeconds,
    duration: T.hymnSeconds,
    value: 0,
    sourceId: boss.id,
    school: 'frost',
  });
  st.veil = {
    elapsed: 0,
    hpAt: boss.hp,
    realSlot,
    shadeIds,
    phase,
    beamStart: (kitHash(boss.id, st.veils * 53 + 3) % 360) * (Math.PI / 180),
    tick: 1,
    drift: T.driftEvery,
    home,
    shadeHp: boss.hp,
  };
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'frost',
    fx: 'nova',
    ability: VAEL_FOG_VEIL,
  });
}

/** Burst one shade: Fogburst round it, a thrall on heroic, and it is gone. */
function burstShade(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VaelFightState,
  shade: Entity,
): void {
  st.burst = true;
  ctx.emit({
    type: 'spellfx',
    sourceId: shade.id,
    targetId: shade.id,
    school: 'frost',
    fx: 'nova',
    ability: VAEL_FOGBURST,
  });
  for (const p of claimPlayers(ctx, inst)) {
    if (dist2d(p.pos, shade.pos) > T.fogburstRadius) continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.fogburstMin, T.fogburstMax),
      false,
      'frost',
      'Fogburst',
      'hit',
      true,
    );
    if (p.dead) continue;
    ctx.applyAura(p, {
      id: VAEL_FOGBURST,
      name: 'Fogburst',
      kind: 'stun',
      remaining: T.fogburstStun,
      duration: T.fogburstStun,
      value: 0,
      sourceId: boss.id,
      school: 'frost',
    });
  }
  // Mistbound (heroic): the burst shade leaves a Drowned Thrall behind.
  if (inst.difficulty === 'heroic') {
    const players = claimPlayers(ctx, inst);
    const victim = players.length > 0 ? players[kitHash(shade.id, 5) % players.length] : null;
    spawnKitAdd(ctx, inst, boss, DROWNED_THRALL_ID, shade.pos.x, shade.pos.z, victim);
  }
  dropShade(ctx, boss, shade);
}

function dropShade(ctx: SimContext, boss: Entity, shade: Entity): void {
  boss.summonedIds = boss.summonedIds.filter((id) => id !== shade.id);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (e?.targetId === shade.id) e.targetId = null;
  }
  ctx.dropEntity(shade.id);
}

/** The veil ends: the hymn stops and every shade that still stands dissolves. */
function endVeil(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: VaelFightState): void {
  const veil = st.veil;
  if (!veil) return;
  st.veil = null;
  clearCastOf(boss, VAEL_DROWNING_HYMN);
  clearCastOf(boss, VAEL_VEIL_RISE);
  boss.auras = boss.auras.filter((a) => a.id !== VAEL_FOG_VEIL && a.id !== VAEL_BEACON_LIT);
  for (const p of claimPlayers(ctx, inst)) dropAuraById(p, VAEL_HYMN_DROWNING);
  for (const id of veil.shadeIds) {
    if (id === boss.id || id < 0) continue;
    const shade = ctx.entities.get(id);
    if (shade) dropShade(ctx, boss, shade);
  }
}

function breakVeil(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: VaelFightState): void {
  endVeil(ctx, inst, boss, st);
  ctx.applyAura(boss, {
    id: VAEL_STAGGER,
    name: 'Veil Broken',
    kind: 'stun',
    remaining: T.staggerSeconds,
    duration: T.staggerSeconds,
    value: 0,
    sourceId: boss.id,
    school: 'frost',
    unbreakableControl: true,
  });
  ctx.applyAura(boss, {
    id: VAEL_EXPOSED,
    name: 'Veil Broken',
    kind: 'vulnerability',
    remaining: T.exposedSeconds,
    duration: T.exposedSeconds,
    value: T.exposed,
    sourceId: boss.id,
    school: 'frost',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'holy',
    fx: 'detonate',
    ability: VAEL_STAGGER,
  });
}

function stepVeil(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: VaelFightState): void {
  const veil = st.veil;
  if (!veil) return;
  veil.elapsed += DT;
  // The beam turns over the roof; the lamp object carries its yaw to every client.
  const lamp = beaconLamp(ctx, inst);
  if (lamp) {
    lamp.facing = veilBeamYaw(veil.beamStart, veil.elapsed);
    lamp.prevFacing = lamp.facing;
  }
  // The real one is struck hard enough: the veil breaks.
  if (veil.hpAt - boss.hp >= boss.maxHp * T.breakShare) {
    breakVeil(ctx, inst, boss, st);
    return;
  }
  // A struck shade bursts; the rest keep his health and stay on their spots.
  for (let k = 0; k < veil.shadeIds.length; k++) {
    const id = veil.shadeIds[k];
    if (id === boss.id || id < 0) continue;
    const shade = ctx.entities.get(id);
    if (!shade || shade.dead) {
      veil.shadeIds[k] = -1;
      continue;
    }
    if (shade.hp < veil.shadeHp - 0.5) {
      burstShade(ctx, inst, boss, st, shade);
      veil.shadeIds[k] = -1;
      continue;
    }
    shade.hp = boss.hp;
    veilBar(shade, veil.elapsed);
    shade.swingTimer = Math.max(shade.swingTimer, 1);
  }
  // Drifting Shades (heroic): every figure shifts one place round the rim.
  if (inst.difficulty === 'heroic') {
    veil.drift -= DT;
    if (veil.drift <= 0) {
      veil.drift += T.driftEvery;
      veil.phase += Math.PI / 2;
    }
  }
  veil.shadeHp = boss.hp;
  const slots = veilSlots(veil.phase);
  for (let k = 0; k < veil.shadeIds.length; k++) {
    const id = veil.shadeIds[k];
    const e = id >= 0 ? ctx.entities.get(id) : undefined;
    if (!e) continue;
    const at = localOf(ctx, inst, e);
    if (e === boss) {
      // The real one holds his spot exactly, every tick, as still as his
      // shades: his chase would walk him a step toward his target each tick,
      // and a snap back only past half a yard drew a stutter that only he
      // showed (a tell the beam is meant to be the only way to read).
      place(ctx, inst, e, slots[k].x, slots[k].z);
      ctx.grid.update(e);
    } else if (Math.hypot(at.x - slots[k].x, at.z - slots[k].z) > 0.5)
      place(ctx, inst, e, slots[k].x, slots[k].z);
    else e.facing = Math.atan2(BEACON.x - at.x, BEACON.z - at.z);
    e.swingTimer = Math.max(e.swingTimer, 1);
  }
  veilBar(boss, veil.elapsed);
  // The beam's tell: whatever figure it touches wears it a breath longer (the
  // real one Beacon-Lit, a shade Hollow), so every client and the HUD read
  // the same reveal the renderer draws.
  if (lamp) {
    for (const id of veil.shadeIds) {
      const e = id >= 0 ? ctx.entities.get(id) : undefined;
      if (!e) continue;
      const at = localOf(ctx, inst, e);
      if (!inBeam(lamp.facing, at.x, at.z)) continue;
      if (e === boss) beamTell(e, VAEL_BEACON_LIT, 'Beacon-Lit');
      else beamTell(e, VAEL_SHADE_HOLLOW, 'Hollow Shade');
    }
  }
  // The hymn swells: frost to everyone on the roof every second.
  veil.tick -= DT;
  if (veil.tick <= 0) {
    veil.tick += 1;
    const amount = T.hymnBase + T.hymnStep * Math.floor(veil.elapsed / T.hymnStepEvery);
    const o = ctx.instanceOriginOf(inst);
    for (const p of claimPlayers(ctx, inst)) {
      if (Math.hypot(p.pos.x - o.x - CROWN.x, p.pos.z - o.z - CROWN.z) > CROWN.r + 10) continue;
      drowning(p, boss.id, T.hymnSeconds - veil.elapsed);
      ctx.dealDamage(
        boss,
        p,
        Math.max(1, Math.round(amount * (boss.mechanicDamageMult ?? 1))),
        false,
        'frost',
        'Drowning Hymn',
        'hit',
        true,
      );
    }
  }
  if (veil.elapsed >= T.hymnSeconds) endVeil(ctx, inst, boss, st);
}

/** Put (or keep) the beam's tell on a figure for the linger. */
function beamTell(e: Entity, id: string, name: string): void {
  const a = e.auras.find((x) => x.id === id);
  if (a) {
    // Topped up only once it has run down a quarter: a figure standing in
    // the beam does not rewrite its aura (and its wire record) every tick.
    if (a.remaining < T.beamLinger * 0.75) a.remaining = T.beamLinger;
    return;
  }
  e.auras.push({
    id,
    name,
    kind: 'buff_dr',
    remaining: T.beamLinger,
    duration: T.beamLinger,
    value: 0,
    sourceId: e.id,
    school: 'holy',
    undispellable: true,
  });
}

/** The hymn's mark on a player on the crown: its time left is the hymn's. */
function drowning(p: Entity, bossId: number, left: number): void {
  const seconds = Math.max(0.5, left);
  const a = p.auras.find((x) => x.id === VAEL_HYMN_DROWNING);
  if (a) {
    a.remaining = seconds;
    return;
  }
  p.auras.push({
    id: VAEL_HYMN_DROWNING,
    name: 'Drowning Hymn',
    // A mark, not a slow: the value leaves the runner at full speed.
    kind: 'slow',
    remaining: seconds,
    duration: T.hymnSeconds,
    value: 1,
    sourceId: bossId,
    school: 'frost',
    undispellable: true,
  });
}

function stepSurge(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: VaelFightState): void {
  if (boss.castingAbility === VAEL_MIST_SURGE) {
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining > 0) return;
    clearCastOf(boss, VAEL_MIST_SURGE);
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'frost',
      fx: 'nova',
      ability: VAEL_MIST_SURGE,
    });
    for (const p of claimPlayers(ctx, inst)) {
      if (dist2d(p.pos, boss.pos) > T.surgeRadius) continue;
      ctx.dealDamage(
        boss,
        p,
        mechanicDamage(ctx, boss, T.surgeMin, T.surgeMax),
        false,
        'frost',
        'Mist Surge',
        'hit',
        true,
      );
    }
    return;
  }
  if (ctx.isStunned(boss) || boss.castingAbility !== null) return;
  st.surgeTimer -= DT;
  if (st.surgeTimer > 0) return;
  const share = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  st.surgeTimer = share < T.lastHymnBelow ? T.lastHymnEvery : T.surgeEvery;
  boss.castingAbility = VAEL_MIST_SURGE;
  boss.castTotal = T.surgeCast;
  boss.castRemaining = T.surgeCast;
  boss.castTargetId = null;
  boss.channeling = false;
}

/** The fight ended: the fog lifts and the lamp returns to its idle sweep. */
export function resetVael(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const st = boss.bastionFight?.kind === 'vael' ? boss.bastionFight : null;
  if (st) {
    const home = st.veil?.home;
    endVeil(ctx, inst, boss, st);
    if (home && !boss.dead) place(ctx, inst, boss, home.x, home.z);
    endReap(ctx, inst, boss, st);
    endVeilGather(boss, st);
    clearGraves(ctx, inst, st);
    // A wipe: the next climb plays the short entrance.
    rearmVaelIntro(boss);
  }
  clearCastOf(boss, VAEL_MIST_SURGE);
  boss.bastionFight = undefined;
}

/** One tick of Vael's fight. */
export function tickVael(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): void {
  // His entrance owns him until he takes his place.
  if (tickVaelIntro(ctx, inst, boss, engaged)) return;
  let st = boss.bastionFight?.kind === 'vael' ? boss.bastionFight : null;
  if (boss.dead) {
    if (st) {
      if (!st.burst) grantClaimDeed(ctx, inst, VAEL_DEED);
      endVeil(ctx, inst, boss, st);
      endReap(ctx, inst, boss, st);
      endVeilGather(boss, st);
      clearGraves(ctx, inst, st);
      boss.bastionFight = undefined;
    }
    return;
  }
  if (!engaged) {
    if (st) resetVael(ctx, inst, boss);
    return;
  }
  if (!st) {
    st = freshState();
    boss.bastionFight = st;
  }
  stepGraves(ctx, inst, boss, st);
  if (st.gather) {
    if (stepVeilGather(ctx, inst, boss, st)) startFogVeil(ctx, inst, boss, st);
    return;
  }
  if (st.veil) {
    stepVeil(ctx, inst, boss, st);
    return;
  }
  if (st.reap) {
    stepReap(ctx, inst, boss, st);
    return;
  }
  const share = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  if (st.veils < T.veilAt.length && share <= T.veilAt[st.veils] && !ctx.isStunned(boss)) {
    startVeilGather(ctx, inst, boss, st);
    return;
  }
  if (boss.castingAbility === null && !ctx.isStunned(boss)) {
    st.reapTimer -= DT;
    if (st.reapTimer <= 0 && startShadowstep(ctx, inst, boss, st)) return;
  }
  stepSurge(ctx, inst, boss, st);
}
