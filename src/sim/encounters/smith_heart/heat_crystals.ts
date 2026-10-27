// The Guardian of the Heat's Kindled Crystals (docs/design/raid/smith_heart.md
// section 7.4; Baleroc's crystals in Firelands as a concept only).
//
//   Shed Heat      every 30 s (first at 14) a 2.5 s bar, planted: the
//                  guardian pours its heat into the floor and the rise spots
//                  show where crystals will tear up (two: one each side of
//                  the channel; heroic three).
//   The crystals   stand 20 s and cannot be attacked. Every 2 s each fires a
//                  Kindled Ray at the NEAREST living player within 10 yd: the
//                  ray burns them (a hit and a stack of Crystal Burn) and
//                  takes 3 heat off the guardian. Nobody that near, the ray
//                  goes back into the guardian and adds 3 heat. So the raid
//                  keeps someone in every crystal's reach, and rotates them
//                  as the burns stack.
//   Crystal Burn   6% more spell damage taken a stack (the fight's fire is all
//                  spell damage), one stack fading every 6 s since the last
//                  (10 s on heroic).
//
// Deterministic: the sockets are hashed (heat_geometry.ts pickSockets), a ray
// picks the nearest body (the lower id on a tie); the only rng draws are the
// damage rolls, in crystal order.

import { HEARTH_CRYSTAL_SOCKETS } from '../../content/smith_heart_layout';
import { DT, type Entity } from '../../types';
import { clearCastIf } from '../sunken_bastion/claim';
import { addHeat } from './heat_gauge';
import { type HBody, nearestInReach, pickSockets } from './heat_geometry';
import {
  burnAmp,
  crystalTemplate,
  HEAT_AURAS,
  HEAT_CASTS,
  HEAT_CUES,
  HEAT_NAMES,
  riseTemplate,
  HEAT_TUNING as T,
} from './heat_ids';
import {
  at,
  auraOf,
  beginBar,
  cueAt,
  dropAura,
  dropFightObject,
  fireHit,
  type HeatScope,
  livePlayers,
  raidWarn,
  roll,
  spawnFightObject,
} from './heat_scope';
import type { HeatBurn, HeatCrystal } from './heat_state';
import { heatSay } from './heat_voice';

// ---- Shed Heat ---------------------------------------------------------------------

/** The rise spots of the next wave of crystals (one each side of the
 *  channel, heroic's third alternating). */
function spawnRises(s: HeatScope): void {
  const st = s.st;
  st.shedTimer = T.shedEvery;
  for (const socket of pickSockets(st.sheds, s.rules.crystals)) {
    const p = HEARTH_CRYSTAL_SOCKETS[socket];
    const obj = spawnFightObject(
      s.ctx,
      s.inst,
      riseTemplate(T.shedCast),
      HEAT_NAMES.crystal,
      p.x,
      p.z,
      T.crystalR,
    );
    st.rises.push({ objectId: obj.id, socket, x: p.x, z: p.z });
  }
  st.sheds++;
}

/** Begin Shed Heat: the bar, and the rise spots where its crystals will
 *  tear up. Exported for the dev trigger. */
export function startShed(s: HeatScope): void {
  beginBar(s, HEAT_CASTS.shed, T.shedCast);
  spawnRises(s);
  raidWarn(s, s.boss, 'crystals', 'Kindled Crystals rise! Stand in their rays to cool the Hearth!');
  heatSay(s, s.boss, 'shed');
}

/** Shed Heat lands (or its bar was cut: the crystals rise all the same):
 *  every rise spot becomes a Kindled Crystal. */
export function landShed(s: HeatScope): void {
  const st = s.st;
  for (const r of st.rises) {
    dropFightObject(s.ctx, s.inst, r.objectId);
    const obj = spawnFightObject(
      s.ctx,
      s.inst,
      crystalTemplate(T.crystalLife),
      HEAT_NAMES.crystal,
      r.x,
      r.z,
      T.crystalR,
    );
    st.crystals.push({
      objectId: obj.id,
      socket: r.socket,
      x: r.x,
      z: r.z,
      life: T.crystalLife,
      rayIn: T.rayFirst,
      target: null,
    });
    cueAt(s, HEAT_CUES.rise, r.x, r.z, T.crystalR);
  }
  st.rises = [];
}

/** Raise crystals at once (no bar), for the dev trigger. Returns how many. */
export function riseNow(s: HeatScope): number {
  const st = s.st;
  if (st.bar?.castId === HEAT_CASTS.shed) {
    clearCastIf(s.boss, HEAT_CASTS.shed);
    st.bar = null;
  }
  if (st.rises.length === 0) spawnRises(s);
  const n = st.rises.length;
  landShed(s);
  return n;
}

// ---- Crystal Burn -------------------------------------------------------------------

/** A player's burn entry (made on first need). */
function burnOf(s: Pick<HeatScope, 'st'>, id: number): HeatBurn {
  let b = s.st.burns[id];
  if (!b) {
    b = { stacks: 0, decay: 0 };
    s.st.burns[id] = b;
  }
  return b;
}

/** Write the burn onto the player's debuff: its stacks, the spell damage
 *  taken they add, the time to the next stack's fading. */
function showBurn(s: HeatScope, p: Entity, burn: HeatBurn): void {
  if (burn.stacks <= 0) {
    dropAura(p, HEAT_AURAS.burn);
    return;
  }
  // A hair past the sim's own decay, so the stack fades here first.
  const remaining = burn.decay + 0.25;
  const a = auraOf(p, HEAT_AURAS.burn);
  if (a) {
    a.stacks = burn.stacks;
    a.value = burnAmp(burn.stacks);
    a.remaining = remaining;
    a.duration = s.rules.burnDecay + 0.25;
    return;
  }
  s.ctx.applyAura(p, {
    id: HEAT_AURAS.burn,
    name: HEAT_NAMES.burn,
    kind: 'spellvuln',
    remaining,
    duration: s.rules.burnDecay + 0.25,
    value: burnAmp(burn.stacks),
    stacks: burn.stacks,
    sourceId: s.boss.id,
    school: 'fire',
    undispellable: true,
  });
}

/** Add `n` stacks of Crystal Burn to `p` (the decay starts again). Exported
 *  for the dev trigger. */
export function addBurn(s: HeatScope, p: Entity, n = 1): number {
  if (p.dead) return 0;
  const burn = burnOf(s, p.id);
  burn.stacks = Math.max(0, Math.min(T.burnMax, burn.stacks + n));
  burn.decay = s.rules.burnDecay;
  showBurn(s, p, burn);
  return burn.stacks;
}

/** One tick of every burn: a stack fades every `burnDecay` seconds since the
 *  last change. */
export function stepBurns(s: HeatScope): void {
  for (const key of Object.keys(s.st.burns)) {
    const id = Number(key);
    const burn = s.st.burns[id];
    const p = s.ctx.entities.get(id);
    if (!p || p.dead || !s.players.some((q) => q.id === id)) {
      if (p) dropAura(p, HEAT_AURAS.burn);
      delete s.st.burns[id];
      continue;
    }
    burn.decay -= DT;
    if (burn.decay > 1e-9) continue;
    burn.stacks--;
    burn.decay = s.rules.burnDecay;
    showBurn(s, p, burn);
    if (burn.stacks <= 0) delete s.st.burns[id];
  }
}

// ---- the crystals -------------------------------------------------------------------

/** One crystal fires its Kindled Ray: at the nearest player in reach (a hit,
 *  a burn, the heat cooled), else back into the guardian (the heat raised).
 *  Returns the player struck, or null. Exported for the tests. */
export function fireRay(s: HeatScope, c: HeatCrystal): Entity | null {
  const bodies: HBody[] = [];
  const live = livePlayers(s);
  for (const p of live) {
    const here = at(s, p);
    bodies.push({ id: p.id, x: here.x, z: here.z });
  }
  const near = nearestInReach({ x: c.x, z: c.z }, bodies, T.rayRange);
  const st = s.st;
  if (!near) {
    c.target = null;
    st.raysBack++;
    s.ctx.emit({
      type: 'spellfx',
      sourceId: c.objectId,
      targetId: s.boss.id,
      school: 'fire',
      fx: 'beam',
      ability: HEAT_CUES.beamBack,
    });
    addHeat(s, T.rayBack);
    return null;
  }
  const p = live.find((q) => q.id === near.id) as Entity;
  c.target = p.id;
  st.rays++;
  s.ctx.emit({
    type: 'spellfx',
    sourceId: c.objectId,
    targetId: p.id,
    school: 'fire',
    fx: 'beam',
    ability: HEAT_CUES.beam,
  });
  // The burn first: this ray already lands on the stack it gives.
  addBurn(s, p);
  fireHit(s, p, roll(s, T.rayMin, T.rayMax), HEAT_NAMES.ray);
  addHeat(s, -T.rayCool);
  return p;
}

/** One tick of the crystals: their rays, their burning out. */
export function stepCrystals(s: HeatScope): void {
  const st = s.st;
  for (const c of st.crystals) {
    c.life -= DT;
    if (c.life <= 1e-9) continue;
    c.rayIn -= DT;
    if (c.rayIn > 1e-9) continue;
    c.rayIn += T.rayEvery;
    fireRay(s, c);
  }
  const gone = st.crystals.filter((c) => c.life <= 1e-9);
  if (gone.length === 0) return;
  for (const c of gone) {
    dropFightObject(s.ctx, s.inst, c.objectId);
    cueAt(s, HEAT_CUES.fade, c.x, c.z, T.crystalR);
  }
  st.crystals = st.crystals.filter((c) => c.life > 1e-9);
}

/** Every crystal and rise spot off the floor, every burn off its player. */
export function clearCrystals(s: Pick<HeatScope, 'ctx' | 'inst' | 'st'>): void {
  const st = s.st;
  for (const r of st.rises) dropFightObject(s.ctx, s.inst, r.objectId);
  for (const c of st.crystals) dropFightObject(s.ctx, s.inst, c.objectId);
  st.rises = [];
  st.crystals = [];
  for (const key of Object.keys(st.burns)) {
    const p = s.ctx.entities.get(Number(key));
    if (p) dropAura(p, HEAT_AURAS.burn);
  }
  st.burns = {};
}
