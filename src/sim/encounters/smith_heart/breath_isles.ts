// The Islands of the Wind, the Guardian of the Breath's 50 percent phase
// (docs/design/raid/smith_heart.md section 7.2; the team's design of
// 2026-11-17, replacing the Gale Bulwark's rounds). Every number is
// breath_isle_ids.ts ISLE_TUNING and the tier's ISLE_TIERS row.
//
//   The lock      at half health nothing takes the guardian lower: it is
//                 untouchable from the moment it crosses (a Knotted Gale in
//                 play is thrown or bursts first: the ball and the phase never
//                 meet), then it closes its Gale Cocoon and channels Skyrend
//                 Nova (the tier's `novaSeconds`): if the bar ends, the nova
//                 kills every player of the claim on every tier, whatever
//                 shields them (the team's ask of 2026-11-25: a failed DPS
//                 check is a wipe, never a survivable hit; game masters
//                 excepted, as the shared wipe spares them).
//   The isles     Captain Thessaly raises two Updrafts on the Cornice, east
//                 and west: step in and the wind carries you to the first
//                 isle of that side; the raid splits in two. Three isles a
//                 side, climbing round the rim, one way and the other. Each
//                 isle's adds rise as its Updraft opens (breath_isle_adds.ts:
//                 a different fight on each); once they have all fallen,
//                 Thessaly raises the Updraft on to the next.
//   The storm     each isle's Closing Storm (a ring on its floor, closing)
//                 starts as its first rider lands: when it runs out, Sky's
//                 Reckoning rains strikes on everyone on the isle (each under
//                 a player, on a short warning: keep moving) until the isle
//                 is done.
//   The stones    the last isle of each side holds a Stillstone, woken when
//                 that isle's adds have fallen (Heroic: two Squall Fragments
//                 rise to guard it): a player targets it and channels Still
//                 the Gale (a 5 s use any landed hit breaks). Both stilled:
//                 the cocoon shatters, the nova is cut, the wind carries every
//                 player on the isles home and the storm breaks (phase 2).
//   A wipe        every body on an isle (alive or not) is set back on the
//                 Cornice; nothing of the phase stays.
//
// Deterministic: the riders and the adds are in id order; the only rng draws
// are the damage rolls. Every visible state rides existing fields
// (breath_isle_ids.ts says which): no wire or IWorld change.

import { carryBody, setDownBody } from '../../carried_body';
import { carriesLoad } from '../../combat/carried_load';
import { BREATH_ISLES } from '../../content/smith_heart_layout';
import { MOBS } from '../../data';
import { createMob } from '../../entity';
import { KIT_USE_LOCKED_AURA, KIT_USE_SPENT_AURA } from '../../mob/trash_kit/encounter_use';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { clearCastIf, dropEncounterBody, startBar } from '../sunken_bastion/claim';
import { clearGales, clearWindAuras, setWind, thessalyOf } from './breath_gale';
import { BREATH_AURAS, BREATH_CASTS, BREATH_OBJECTS, timedTemplate } from './breath_ids';
import {
  isleRoles,
  isleTier,
  livingIsleAdds,
  playersOnIsle,
  raiseIsleAdd,
  stepIsleAdds,
} from './breath_isle_adds';
import { cornicePads, isleAt, isleSpots, rideArc } from './breath_isle_geometry';
import { holdIsleAdds } from './breath_isle_hold';
import {
  closingTemplate,
  ISLE_AURAS,
  ISLE_CASTS,
  ISLE_CUES,
  ISLE_MOBS,
  ISLE_NAMES,
  padTemplate,
  rideTemplate,
  stoneRate,
  ISLE_TUNING as T,
} from './breath_isle_ids';
import {
  type BreathScope,
  corniceListeners,
  dropAura,
  dropBreathObject,
  living,
  local,
  putMarker,
  spawnBreathObject,
} from './breath_scope';
import { clearShoves } from './breath_shove';
import type { BreathFightState, BreathIsles, BreathRide } from './breath_state';
import { clearCalm } from './breath_thessaly';
import { breathSay } from './breath_voice';
import { breakFeat } from './feat_attempt';

/** A fresh phase (the pull's state). */
export function freshIsles(): BreathIsles {
  return {
    stage: 'idle',
    elapsed: 0,
    at: null,
    burst: false,
    isles: BREATH_ISLES.map(() => ({
      woken: false,
      cleared: false,
      closing: null,
      closingId: null,
      reckon: 0,
      stoneId: null,
      stilled: false,
      stoneProgress: 0,
    })),
    adds: [],
    pads: [],
    rides: [],
    strikes: [],
    shoves: [],
    grace: {},
  };
}

// ---- who stands where -----------------------------------------------------------------------

/** Living players of the claim standing on an isle's floor, with its index
 *  (entity-id order). */
export function islePlayers(ctx: SimContext, inst: InstanceSlot): { p: Entity; isle: number }[] {
  const o = ctx.instanceOriginOf(inst);
  const out: { p: Entity; isle: number }[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead || e.ghost || e.carriedBy !== undefined) continue;
    const i = isleAt(e.pos.x - o.x, e.pos.z - o.z);
    if (i < 0 || Math.abs(e.pos.y - BREATH_ISLES[i].h) > 4) continue;
    out.push({ p: e, isle: i });
  }
  return out.sort((a, b) => a.p.id - b.p.id);
}

// ---- the lock and the start ------------------------------------------------------------------

/** Has the guardian reached the phase (half health in the Wind half, not
 *  yet run)? From that moment it is untouchable. */
export function islesReached(s: BreathScope): boolean {
  return (
    s.st.half === 'wind' && s.st.isles.stage === 'idle' && s.boss.hp <= s.boss.maxHp * T.at + 1e-9
  );
}

/** The lock: at half health the guardian is held there, untouchable, until
 *  the phase is over. Returns true when the phase may begin this tick (no
 *  Knotted Gale in play: the ball is thrown or bursts first). */
export function lockForIsles(s: BreathScope): boolean {
  if (!islesReached(s)) return false;
  const b = s.boss;
  b.damageImmune = true;
  b.hp = Math.max(b.hp, Math.min(b.maxHp, Math.ceil(b.maxHp * T.at) - 1));
  return !s.st.heart;
}

/** The guardian closes its Gale Cocoon and begins Skyrend Nova; Thessaly
 *  raises the two Updrafts. Exported for the dev trigger and the tests. */
export function startIsles(s: BreathScope): boolean {
  const st = s.st;
  const b = s.boss;
  if (st.half !== 'wind' || st.isles.stage !== 'idle' || !living(b)) return false;
  st.half = 'isles';
  const isl = st.isles;
  isl.stage = 'nova';
  isl.elapsed = 0;
  isl.at = { ...b.pos };
  b.damageImmune = true;
  b.hp = Math.min(b.hp, Math.max(1, Math.ceil(b.maxHp * T.at) - 1));
  // Whatever the Wind half had in flight goes: its bar, the blow, the
  // circle, the vortex, the roar's throws, the loose gales.
  if (st.bar) {
    clearCastIf(b, st.bar.castId);
    st.bar = null;
  }
  clearCastIf(b, ...Object.values(BREATH_CASTS));
  st.gap = 0;
  clearWindAuras(s.ctx, s.inst, b.id);
  clearCalm(s.ctx, s.inst, st);
  clearGales(s.ctx, s.inst, st);
  dropBreathObject(s.ctx, s.inst, st.vortex?.objectId ?? null);
  st.vortex = null;
  if (st.roar) clearShoves(s, st.roar.slides);
  st.roar = null;
  for (const p of corniceListeners(s.ctx, s.inst)) dropAura(p, BREATH_AURAS.blowMark);
  setWind(s, 'calm', 0, st.wind.bearing);
  const tier = isleTier(s);
  putMarker(b, ISLE_AURAS.cocoon, ISLE_NAMES.cocoon, tier.novaSeconds + 30, b.id, {
    value: 0,
    value2: 2,
  });
  // Held where it stands: a root of its own (its control immunity lets its
  // own aura in), so the chase's stall clock never walks it home.
  s.ctx.applyAura(b, {
    id: ISLE_AURAS.hold,
    name: ISLE_NAMES.cocoon,
    kind: 'root',
    remaining: tier.novaSeconds + 30,
    duration: tier.novaSeconds + 30,
    value: 0,
    sourceId: b.id,
    school: 'nature',
    unbreakableControl: true,
    undispellable: true,
  });
  startBar(b, ISLE_CASTS.nova, tier.novaSeconds, null, true);
  s.ctx.emit({
    type: 'spellfx',
    sourceId: b.id,
    targetId: b.id,
    school: 'nature',
    fx: 'nova',
    ability: ISLE_CUES.cocoonUp,
  });
  openPad(s, -1, 0);
  openPad(s, -1, 3);
  breathSay(s, b, 'guardian', 'isles');
  breathSay(s, thessalyOf(s.ctx, s.inst), 'thessaly', 'isles');
  return true;
}

/** Thessaly raises the Updraft from `from` (-1 the Cornice) to isle `to`,
 *  and that isle's adds rise. */
function openPad(s: BreathScope, from: number, to: number): void {
  const isl = s.st.isles;
  if (isl.pads.some((p) => p.to === to)) return;
  const spots = isleSpots();
  const at = from < 0 ? cornicePads()[spots[to].side] : spots[from].pad;
  if (!at) return;
  const e = spawnBreathObject(
    s.ctx,
    s.inst,
    padTemplate(from, to),
    ISLE_NAMES.pad,
    at.x,
    at.z,
    T.padR,
  );
  isl.pads.push({ from, to, objectId: e.id });
  const o = s.ctx.instanceOriginOf(s.inst);
  s.ctx.emit({
    type: 'spellfxAt',
    x: o.x + at.x,
    z: o.z + at.z,
    school: 'nature',
    fx: 'burst',
    radius: T.padR,
    ability: ISLE_CUES.padUp,
  });
  wakeIsle(s, to);
}

/** An isle's adds rise. */
function wakeIsle(s: BreathScope, i: number): void {
  const state = s.st.isles.isles[i];
  if (state.woken) return;
  state.woken = true;
  const sp = isleSpots()[i];
  isleRoles(sp.step).forEach((role, k) => {
    const at = sp.adds[k % sp.adds.length];
    raiseIsleAdd(s, i, role, at.x, at.z);
  });
  const o = s.ctx.instanceOriginOf(s.inst);
  s.ctx.emit({
    type: 'spellfxAt',
    x: o.x + sp.x,
    z: o.z + sp.z,
    school: 'nature',
    fx: 'burst',
    radius: sp.r,
    ability: ISLE_CUES.isleWake,
  });
}

// ---- the isles' progress ---------------------------------------------------------------------

/** An isle's adds have all fallen: on to the next (or the stone wakes). */
function stepClears(s: BreathScope): void {
  const isl = s.st.isles;
  const spots = isleSpots();
  for (let i = 0; i < isl.isles.length; i++) {
    const st = isl.isles[i];
    if (!st.woken || st.cleared) continue;
    if (livingIsleAdds(s, i).length > 0) continue;
    st.cleared = true;
    if (spots[i].step < 2) openPad(s, i, i + 1);
    else wakeStone(s, i);
    if (spots[i].step < 2) {
      // The isle is done: its storm stands down.
      endClosing(s, i);
      breathSay(s, thessalyOf(s.ctx, s.inst), 'thessaly', 'updraft');
    }
  }
}

/** The last isle's Stillstone wakes (Heroic: two Squall Fragments rise to
 *  guard it). */
function wakeStone(s: BreathScope, i: number): void {
  const st = s.st.isles.isles[i];
  if (st.stoneId !== null) return;
  const sp = isleSpots()[i];
  const stone = sp.stone;
  if (!stone) return;
  const e = raiseStone(s, stone.x, stone.z);
  if (e) st.stoneId = e.id;
  if (s.st.difficulty !== 'normal') {
    const on = playersOnIsle(s, i);
    for (const k of [0, 1]) {
      const at = sp.adds[k];
      const f = raiseIsleAdd(s, i, 'fragment', at.x, at.z);
      if (f && on.length > 0) s.ctx.aggroMob(f, on[k % on.length], false);
    }
  }
  breathSay(s, thessalyOf(s.ctx, s.inst), 'thessaly', 'stone');
}

/** The Stillstone's usable body (the G3 use's body): held by the
 *  encounter, untouchable, never hostile. */
function raiseStone(s: BreathScope, x: number, z: number): Entity | null {
  const template = MOBS[ISLE_MOBS.stillstone];
  if (!template) return null;
  const o = s.ctx.instanceOriginOf(s.inst);
  const e = createMob(
    s.ctx.nextId++,
    template,
    template.maxLevel,
    s.ctx.groundPos(o.x + x, o.z + z),
  );
  e.spawnPos = { ...e.pos };
  e.prevPos = { ...e.pos };
  e.encounterHeld = true;
  e.damageImmune = true;
  e.hostile = false;
  s.ctx.addEntity(e);
  s.inst.mobIds.push(e.id);
  s.boss.summonedIds.push(e.id);
  return e;
}

/** A body channeling Still the Gale on `stoneId` (a cut channel is none). */
function channels(p: Entity | undefined, stoneId: number): p is Entity {
  return !!p && !p.dead && p.castingAbility === ISLE_CASTS.still && p.castTargetId === stoneId;
}

/** The players channeling `stoneId` this tick (entity-id order). */
function stoneChannelers(s: BreathScope, stoneId: number): Entity[] {
  const out: Entity[] = [];
  for (const meta of s.ctx.players.values()) {
    const p = s.ctx.entities.get(meta.entityId);
    if (channels(p, stoneId)) out.push(p);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Keep a stone's shared charge aura in step (value: progress, value2: how
 *  many channel), written only when it changes. */
function showCharge(s: BreathScope, body: Entity, progress: number, n: number): void {
  const a = body.auras.find((x) => x.id === ISLE_AURAS.stoneCharge);
  if (a) {
    a.value = progress;
    a.value2 = n;
    return;
  }
  putMarker(body, ISLE_AURAS.stoneCharge, ISLE_NAMES.still, 3600, s.boss.id, {
    permanent: true,
    value: progress,
    value2: n,
  });
}

/** Lock a stone while its isle has adds standing (Heroic's Fragments rise to
 *  guard it), unlock it once they fall. Returns whether it is locked. */
function lockStone(s: BreathScope, i: number, body: Entity): boolean {
  const locked = livingIsleAdds(s, i).length > 0;
  const has = body.auras.some((a) => a.id === KIT_USE_LOCKED_AURA);
  if (locked && !has)
    putMarker(body, KIT_USE_LOCKED_AURA, ISLE_NAMES.still, 3600, s.boss.id, { permanent: true });
  else if (!locked && has) dropAura(body, KIT_USE_LOCKED_AURA);
  return locked;
}

/** The least a channeler's bar may show left, so the cast never completes by
 *  itself (the shared bar, below, decides the stilling). */
const BAR_FLOOR = 0.2;

/** The Stillstones' ONE shared channel each (Jose's design change of
 *  2026-11-18): every player on the isle may channel at once, the shared
 *  progress filling at stoneRate(n) of one's pace (the tier's
 *  stoneSoloSeconds alone); each channeler's own bar shows the shared share
 *  and the time left at this pace. A hit cuts one channel (the trash
 *  engine's G3 rule), never the bar, which never decays. Locked while its
 *  isle's adds stand. Full: stilled once, every channel on it cut. */
function stepStones(s: BreathScope): void {
  const isl = s.st.isles;
  const tier = isleTier(s);
  let stilled = 0;
  for (let i = 0; i < isl.isles.length; i++) {
    const st = isl.isles[i];
    if (st.stilled) {
      stilled++;
      continue;
    }
    if (st.stoneId === null) continue;
    const body = s.ctx.entities.get(st.stoneId);
    if (!body) continue;
    const locked = lockStone(s, i, body);
    const chan = locked ? [] : stoneChannelers(s, body.id);
    if (locked) for (const p of stoneChannelers(s, body.id)) clearCastIf(p, ISLE_CASTS.still);
    const n = chan.length;
    st.stoneProgress = Math.min(1, st.stoneProgress + (DT * stoneRate(n)) / tier.stoneSoloSeconds);
    const full = st.stoneProgress >= 1 - 1e-9 || body.kitUseCompletedBy !== undefined;
    body.kitUseCompletedBy = undefined;
    showCharge(s, body, full ? 1 : st.stoneProgress, n);
    if (!full) {
      // Each one's bar: the shared share, its seconds the time left at this pace.
      const whole = n > 0 ? tier.stoneSoloSeconds / stoneRate(n) : tier.stoneSoloSeconds;
      for (const p of chan) {
        p.castTotal = whole;
        p.castRemaining = Math.max(BAR_FLOOR, (1 - st.stoneProgress) * whole);
      }
      continue;
    }
    for (const p of chan) clearCastIf(p, ISLE_CASTS.still);
    st.stilled = true;
    stilled++;
    putMarker(body, ISLE_AURAS.cocoon, ISLE_NAMES.still, 3600, s.boss.id, { permanent: true });
    // Spent: no press, click or channel takes it again (Jose's playtest of
    // 2026-11-18: "it lets me light the crystal many times").
    putMarker(body, KIT_USE_SPENT_AURA, ISLE_NAMES.still, 3600, s.boss.id, { permanent: true });
    s.ctx.emit({
      type: 'spellfx',
      sourceId: body.id,
      targetId: s.boss.id,
      school: 'nature',
      fx: 'beam',
      ability: ISLE_CUES.stilled,
    });
    endClosing(s, i);
  }
  const cocoon = s.boss.auras.find((a) => a.id === ISLE_AURAS.cocoon);
  if (cocoon) cocoon.value = stilled;
  if (stilled >= 2) endNova(s, false);
}

// ---- the Closing Storm and Sky's Reckoning ---------------------------------------------------

/** The isle's storm begins (its first rider landed). */
function beginClosing(s: BreathScope, i: number): void {
  const st = s.st.isles.isles[i];
  if (st.closing !== null || st.cleared || st.stilled || s.st.isles.stage !== 'nova') return;
  const whole = isleTier(s).closingSeconds;
  st.closing = whole;
  st.reckon = 0;
  const sp = isleSpots()[i];
  const e = spawnBreathObject(
    s.ctx,
    s.inst,
    closingTemplate(i, whole, whole),
    ISLE_NAMES.closing,
    sp.x,
    sp.z,
    sp.r,
  );
  st.closingId = e.id;
}

/** The isle is done: its ring goes (its strikes still landing run out). */
function endClosing(s: BreathScope, i: number): void {
  const st = s.st.isles.isles[i];
  dropBreathObject(s.ctx, s.inst, st.closingId);
  st.closingId = null;
}

function stepClosing(s: BreathScope): void {
  const isl = s.st.isles;
  const tier = isleTier(s);
  for (let i = 0; i < isl.isles.length; i++) {
    const st = isl.isles[i];
    if (st.closing === null || st.closingId === null) continue;
    const before = Math.ceil(st.closing - 1e-9);
    st.closing = Math.max(0, st.closing - DT);
    const obj = s.ctx.entities.get(st.closingId);
    if (obj && Math.ceil(st.closing - 1e-9) !== before)
      obj.templateId = closingTemplate(i, st.closing, tier.closingSeconds);
    if (st.closing > 1e-9) continue;
    if (st.reckon === 0)
      s.ctx.emit({
        type: 'spellfxAt',
        x: obj?.pos.x ?? 0,
        z: obj?.pos.z ?? 0,
        school: 'nature',
        fx: 'burst',
        radius: isleSpots()[i].r,
        ability: ISLE_CUES.reckoning,
      });
    st.reckon -= DT;
    if (st.reckon > 1e-9) continue;
    st.reckon = tier.reckonEvery;
    // A strike under every player on the isle (where they stand now), but
    // never under one channeling its Stillstone: the storm will not strike
    // the stone's calm (a channel any hit breaks would be hopeless once the
    // storm closed; the bot passes of 2026-11-18). Their neighbours' strikes
    // still reach them.
    for (const p of playersOnIsle(s, i)) {
      if (p.castingAbility === ISLE_CASTS.still) continue;
      const at = local(s.ctx, s.inst, p);
      const e = spawnBreathObject(
        s.ctx,
        s.inst,
        timedTemplate(BREATH_OBJECTS.strikePrefix, T.reckonWarn),
        ISLE_NAMES.reckoning,
        at.x,
        at.z,
        T.reckonR,
      );
      isl.strikes.push({ objectId: e.id, isle: i, x: at.x, z: at.z, remaining: T.reckonWarn });
    }
  }
}

function stepStrikes(s: BreathScope): void {
  const isl = s.st.isles;
  if (isl.strikes.length === 0) return;
  const share = isleTier(s).reckonShare;
  const keep = [];
  for (const k of isl.strikes) {
    k.remaining -= DT;
    if (k.remaining > 1e-9) {
      keep.push(k);
      continue;
    }
    dropBreathObject(s.ctx, s.inst, k.objectId);
    for (const p of playersOnIsle(s, k.isle)) {
      const at = local(s.ctx, s.inst, p);
      if (Math.hypot(at.x - k.x, at.z - k.z) > T.reckonR) continue;
      s.ctx.dealDamage(
        s.boss,
        p,
        Math.round(p.maxHp * share),
        false,
        'nature',
        ISLE_NAMES.reckoning,
        'hit',
        true,
      );
    }
  }
  isl.strikes = keep;
}

// ---- the nova and the way home ---------------------------------------------------------------

/** The nova's end: cut by the stones (`burst` false) or run out. Every
 *  player on the isles rides home; the storm breaks once they are down. */
function endNova(s: BreathScope, burst: boolean): void {
  const isl = s.st.isles;
  const b = s.boss;
  if (isl.stage !== 'nova') return;
  isl.stage = 'home';
  isl.elapsed = 0;
  isl.burst = burst;
  clearCastIf(b, ISLE_CASTS.nova);
  b.channeling = false;
  dropAura(b, ISLE_AURAS.cocoon);
  dropAura(b, ISLE_AURAS.hold);
  s.ctx.emit({
    type: 'spellfx',
    sourceId: b.id,
    targetId: b.id,
    school: 'nature',
    fx: 'nova',
    ability: burst ? ISLE_CUES.novaBurst : ISLE_CUES.cocoonBreak,
  });
  if (burst) {
    breakFeat(s.st);
    novaWipe(s);
  } else breathSay(s, b, 'guardian', 'bulwark');
  // The adds and the pads go; everyone out on the isles rides home.
  for (const a of isl.adds) dropEncounterBody(s.ctx, s.inst, b, a.id);
  isl.adds = [];
  for (const p of isl.pads) dropBreathObject(s.ctx, s.inst, p.objectId);
  isl.pads = [];
  for (let i = 0; i < isl.isles.length; i++) endClosing(s, i);
  clearShoves(s, isl.shoves);
  for (const { p, isle } of islePlayers(s.ctx, s.inst)) startRide(s, p, isle, 'home');
}

/** Skyrend Nova run out: every living player of the claim dies, on every
 *  tier, whatever shields them (an absorb, an immunity, a cheat-death: the
 *  damage path caps a huge hit, so a death of its own follows it). A real
 *  game master (or the profiler's invulnerable stand-in) is spared, as the
 *  shared wipe spares them. */
export function novaWipe(s: Pick<BreathScope, 'ctx' | 'inst' | 'boss'>): void {
  for (const p of corniceListeners(s.ctx, s.inst)) {
    if (p.dead || p.ghost) continue;
    if (p.gm || (p.profilerInvulnerable && s.ctx.devCommands)) continue;
    s.ctx.dealDamage(s.boss, p, p.hp + p.maxHp * 10, false, 'nature', ISLE_NAMES.nova, 'hit', true);
    if (!p.dead) s.ctx.handleDeath(p, s.boss, ISLE_NAMES.nova);
  }
}

/** The way home over: the storm breaks (phase 2). */
function finishIsles(s: BreathScope, startStorm: (s: BreathScope) => boolean): void {
  const isl = s.st.isles;
  isl.stage = 'done';
  s.boss.damageImmune = false;
  // The dead left out there are laid on the Cornice by their isle.
  homeTheStranded(s.ctx, s.inst, s.st);
  for (const k of isl.strikes) dropBreathObject(s.ctx, s.inst, k.objectId);
  isl.strikes = [];
  for (const st of isl.isles) {
    if (st.stoneId !== null) dropEncounterBody(s.ctx, s.inst, s.boss, st.stoneId);
    st.stoneId = null;
  }
  s.st.half = 'wind';
  startStorm(s);
}

// ---- the pads and the rides ------------------------------------------------------------------

/** May `p` take a ride now (alive, free, out of its grace)? */
function mayRide(st: BreathFightState, p: Entity): boolean {
  if (p.dead || p.carriedBy !== undefined || carriesLoad(p)) return false;
  if ((st.isles.grace[p.id] ?? -1) > st.clock) return false;
  return !st.isles.rides.some((r) => r.playerId === p.id);
}

/** Set `p` riding the gale to isle `i` (out) or home from it. Exported for
 *  the dev trigger and the tests. */
export function startRide(
  s: Pick<BreathScope, 'ctx' | 'inst' | 'st' | 'boss'>,
  p: Entity,
  i: number,
  dir: 'out' | 'home',
): boolean {
  if (!mayRide(s.st, p)) return false;
  const spots = isleSpots()[i];
  const o = s.ctx.instanceOriginOf(s.inst);
  const at = local(s.ctx, s.inst, p);
  // Home: fanned round the side's landing so a group never lands in a heap.
  const fan = (p.id % 5) - 2;
  const end =
    dir === 'out' ? spots.land : { x: spots.back.x + fan * 1.2, z: spots.back.z - fan * 0.6 };
  const from = { x: at.x, y: p.pos.y, z: at.z };
  const to = { x: end.x, y: s.ctx.groundPos(o.x + end.x, o.z + end.z).y, z: end.z };
  const obj = spawnBreathObject(
    s.ctx,
    s.inst,
    rideTemplate(dir, i, T.rideSeconds),
    ISLE_NAMES.riding,
    at.x,
    at.z,
    1,
  );
  obj.pos = { ...p.pos };
  carryBody(p, obj.id);
  s.ctx.applyAura(p, {
    id: ISLE_AURAS.riding,
    name: ISLE_NAMES.riding,
    kind: 'stun',
    remaining: T.rideSeconds + 1,
    duration: T.rideSeconds + 1,
    value: 0,
    sourceId: s.boss.id,
    school: 'nature',
    unbreakableControl: true,
    undispellable: true,
  });
  s.st.isles.rides.push({
    playerId: p.id,
    objectId: obj.id,
    isle: i,
    dir,
    from,
    to,
    t: 0,
    total: T.rideSeconds,
  });
  s.ctx.emit({
    type: 'spellfxAt',
    x: p.pos.x,
    z: p.pos.z,
    school: 'nature',
    fx: 'burst',
    radius: T.padR,
    ability: ISLE_CUES.rideUp,
  });
  return true;
}

/** Every ride one tick along its arc; a landed one sets its body down. */
function stepRides(s: BreathScope): void {
  const st = s.st;
  if (st.isles.rides.length === 0) return;
  const o = s.ctx.instanceOriginOf(s.inst);
  const keep: BreathRide[] = [];
  for (const r of st.isles.rides) {
    const p = s.ctx.entities.get(r.playerId);
    const obj = s.ctx.entities.get(r.objectId);
    if (p?.dead && obj && p.carriedBy === r.objectId) {
      landRide(s, p, r, true);
      continue;
    }
    if (!p || !obj || p.carriedBy !== r.objectId) {
      if (p) dropAura(p, ISLE_AURAS.riding);
      dropBreathObject(s.ctx, s.inst, r.objectId);
      continue;
    }
    r.t = Math.min(r.total, r.t + DT);
    const at = rideArc(r.from, r.to, r.t / r.total);
    p.pos.x = o.x + at.x;
    p.pos.y = at.y;
    p.pos.z = o.z + at.z;
    obj.prevPos = { ...obj.pos };
    obj.pos = { ...p.pos };
    s.ctx.rebucket(p);
    s.ctx.rebucket(obj);
    if (r.t + 1e-9 < r.total) {
      keep.push(r);
      continue;
    }
    landRide(s, p, r);
  }
  st.isles.rides = keep;
}

function landRide(s: BreathScope, p: Entity, r: BreathRide, dead = false): void {
  const o = s.ctx.instanceOriginOf(s.inst);
  const ground = s.ctx.groundPos(o.x + r.to.x, o.z + r.to.z);
  p.pos.x = ground.x;
  p.pos.z = ground.z;
  setDownBody(p, ground.y);
  p.prevPos = { ...p.pos };
  s.ctx.rebucket(p);
  dropAura(p, ISLE_AURAS.riding);
  dropBreathObject(s.ctx, s.inst, r.objectId);
  s.st.isles.grace[p.id] = s.st.clock + T.rideGrace;
  s.ctx.emit({
    type: 'spellfxAt',
    x: ground.x,
    z: ground.z,
    school: 'nature',
    fx: 'burst',
    radius: 3,
    ability: ISLE_CUES.rideDown,
  });
  if (dead || r.dir !== 'out') return;
  beginClosing(s, r.isle);
  // The isle's adds turn on whoever the wind set down among them.
  for (const e of livingIsleAdds(s, r.isle)) if (!e.inCombat) s.ctx.aggroMob(e, p, false);
}

/** The Updrafts take whoever steps in. */
function stepPads(s: BreathScope): void {
  const isl = s.st.isles;
  if (isl.stage !== 'nova') return;
  const spots = isleSpots();
  const pads = cornicePads();
  for (const pad of isl.pads) {
    const c = pad.from < 0 ? pads[spots[pad.to].side] : spots[pad.from].pad;
    if (!c) continue;
    const who = pad.from < 0 ? s.players : playersOnIsle(s, pad.from);
    for (const p of who) {
      if (!mayRide(s.st, p)) continue;
      const at = local(s.ctx, s.inst, p);
      if (Math.hypot(at.x - c.x, at.z - c.z) > T.padR) continue;
      startRide(s, p, pad.to, 'out');
    }
  }
}

// ---- the tick and the wipe ------------------------------------------------------------------

/** One tick of the phase (rides in any half: a rider in flight is always
 *  brought down). `startStorm` breaks the storm at its end (breath_storm.ts,
 *  passed in to keep the import one way). */
export function stepIsles(s: BreathScope, startStorm: (s: BreathScope) => boolean): void {
  const isl = s.st.isles;
  holdIsleAdds(s.ctx, s.inst, s.st);
  stepRides(s);
  if (isl.stage === 'nova') {
    isl.elapsed += DT;
    const b = s.boss;
    b.damageImmune = true;
    // Held where it closed its cocoon, channeling, no swing.
    if (isl.at && (b.pos.x !== isl.at.x || b.pos.z !== isl.at.z)) {
      b.pos.x = isl.at.x;
      b.pos.y = isl.at.y;
      b.pos.z = isl.at.z;
      s.ctx.rebucket(b);
    }
    b.swingTimer = Math.max(b.swingTimer, 0.6);
    const whole = isleTier(s).novaSeconds;
    if (b.castingAbility !== ISLE_CASTS.nova) startBar(b, ISLE_CASTS.nova, whole, null, true);
    b.castRemaining = Math.max(0, whole - isl.elapsed);
    b.castTotal = whole;
    stepIsleAdds(s);
    stepClears(s);
    stepStones(s);
    stepPads(s);
    stepClosing(s);
    if (isl.stage === 'nova' && isl.elapsed + 1e-9 >= whole) endNova(s, true);
  } else if (isl.stage === 'home') {
    isl.elapsed += DT;
    s.boss.damageImmune = true;
    if (isl.elapsed + 1e-9 >= T.homeSeconds && isl.rides.length === 0) finishIsles(s, startStorm);
  }
  stepStrikes(s);
}

/** Every body left on an isle (alive or dead) is set back on the Cornice by
 *  its side's landing. */
function homeTheStranded(ctx: SimContext, inst: InstanceSlot, st: BreathFightState): void {
  const o = ctx.instanceOriginOf(inst);
  const spots = isleSpots();
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p) continue;
    const i = isleAt(p.pos.x - o.x, p.pos.z - o.z);
    if (i < 0 || Math.abs(p.pos.y - BREATH_ISLES[i].h) >= 6) continue;
    const back = spots[i].back;
    const at = ctx.groundPos(o.x + back.x, o.z + back.z);
    if (p.carriedBy !== undefined) setDownBody(p, at.y);
    p.pos = at;
    p.prevPos = { ...at };
    p.onGround = true;
    ctx.rebucket(p);
  }
  st.isles.grace = {};
}

/** Every add, pad, ride, strike and the cocoon go; every body on an isle
 *  (alive or dead) and every rider is set back on the Cornice (a wipe, a
 *  reset, the end). */
export function clearIsles(
  ctx: SimContext,
  inst: InstanceSlot,
  st: BreathFightState,
  boss: Entity,
): void {
  const isl = st.isles;
  dropAura(boss, ISLE_AURAS.cocoon);
  dropAura(boss, ISLE_AURAS.hold);
  clearCastIf(boss, ISLE_CASTS.nova);
  if (isl.stage === 'nova' || isl.stage === 'home') boss.damageImmune = false;
  for (const a of isl.adds) dropEncounterBody(ctx, inst, boss, a.id);
  isl.adds = [];
  for (const p of isl.pads) dropBreathObject(ctx, inst, p.objectId);
  isl.pads = [];
  for (const k of isl.strikes) dropBreathObject(ctx, inst, k.objectId);
  isl.strikes = [];
  for (const s of isl.isles) {
    dropBreathObject(ctx, inst, s.closingId);
    s.closingId = null;
    if (s.stoneId !== null) dropEncounterBody(ctx, inst, boss, s.stoneId);
    s.stoneId = null;
  }
  clearShoves({ ctx }, isl.shoves);
  const o = ctx.instanceOriginOf(inst);
  for (const r of isl.rides) {
    const p = ctx.entities.get(r.playerId);
    if (p) {
      // A rider in the air is set down on the Cornice by its side's landing.
      dropAura(p, ISLE_AURAS.riding);
      const back = isleSpots()[r.isle].back;
      const at = ctx.groundPos(o.x + back.x, o.z + back.z);
      if (p.carriedBy !== undefined) setDownBody(p, at.y);
      p.pos = at;
      p.prevPos = { ...at };
      p.onGround = true;
      ctx.rebucket(p);
    }
    dropBreathObject(ctx, inst, r.objectId);
  }
  isl.rides = [];
  homeTheStranded(ctx, inst, st);
}

/** The adds of the phase (dev readout, tests). */
export function isleAdds(st: BreathFightState) {
  return st.isles.adds;
}
