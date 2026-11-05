// The Islands of the Wind's organic floors (Jose's call of 2026-11-04,
// src/sim/content/smith_heart_isle_floor.ts): each isle's walk is an
// irregular outline (an apron toward the Cornice, bays, promontories and a
// narrow rock tongue) with a ledge or two a stride up, its lip open to the
// void. Pinned here over the pure shape AND a real Sim claim:
//   - the shape: bays, a tongue, ledges only a stride up, every spot the
//     fight uses (the landing, the Homeward Gale's circle, the adds) well
//     inside, the rune ring clear of every bay;
//   - walking the outline: just inside is the isle's floor, just outside the
//     void; no wall stands on any isle edge (every cliff run open, no
//     collider), and a body walks up a ledge;
//   - falling at a bay kills (the void's own death, the corpse laid back on
//     the Cornice), a ride lands on the isle's pad, the adds rise inside and
//     are held to their isle's floor.

import { describe, expect, it } from 'vitest';
import { isleRuneRing } from '../src/render/smith_heart_fx/breath_isles_fx_core';
import {
  bearingDeg,
  ISLE_FLOOR_SPECS,
  ISLE_LEDGE_MAX_RISE,
  isIsleFloorOf,
  isleRimRadius,
} from '../src/sim/content/smith_heart_isle_floor';
import {
  BREATH,
  BREATH_ISLE_REACH,
  BREATH_ISLES,
  SMITH_HEART_FIELD,
} from '../src/sim/content/smith_heart_layout';
import { ISLE_TUNING as IT, isleAt, isleSpots } from '../src/sim/encounters/smith_heart';
import { onIsleFloor } from '../src/sim/encounters/smith_heart/breath_isle_hold';
import { islePlayers } from '../src/sim/encounters/smith_heart/breath_isles';
import {
  authoredFieldCliffRuns,
  authoredFieldColliders,
  authoredFieldHeight,
} from '../src/sim/instances/authored_field';
import { MAX_STEP_HEIGHT } from '../src/sim/physics/character';
import { DT, type Entity } from '../src/sim/types';
import { type BreathFight, breathFight } from './helpers/breath_fight';

const F = SMITH_HEART_FIELD;
const C = BREATH.cornice;
const ticks = (s: number) => Math.round(s / DT);

function toward(i: number): number {
  const isle = BREATH_ISLES[i];
  return bearingDeg(isle.x, isle.z, C.x, C.z);
}

/** The rim's reach at compass bearing `deg` of isle `i`. */
function rim(i: number, deg: number): number {
  return isleRimRadius(ISLE_FLOOR_SPECS[BREATH_ISLES[i].id], toward(i), deg);
}

function at(i: number, deg: number, r: number): { x: number; z: number } {
  const isle = BREATH_ISLES[i];
  const a = (deg * Math.PI) / 180;
  return { x: isle.x + Math.sin(a) * r, z: isle.z + Math.cos(a) * r };
}

/** Is the disc at (x, z) of radius `r` wholly on isle `i`'s floor? */
function discOnIsle(i: number, x: number, z: number, r: number): boolean {
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    if (isleAt(x + Math.sin(a) * r, z + Math.cos(a) * r) !== i) return false;
  }
  return isleAt(x, z) === i;
}

/** The bay bearings of isle `i`: the rim's local minima well under its
 *  nominal reach. */
function bays(i: number): number[] {
  const out: number[] = [];
  const r = BREATH_ISLES[i].r;
  for (let d = 0; d < 360; d += 2.5) {
    const here = rim(i, d);
    if (here < r - 1.4 && here <= rim(i, d - 2.5) && here <= rim(i, d + 2.5)) out.push(d);
  }
  return out;
}

describe('the Islands of the Wind: an organic floor', () => {
  it('bites in bays, swells out in promontories and a narrow tongue, never a disc', () => {
    BREATH_ISLES.forEach((isle, i) => {
      const radii: number[] = [];
      for (let d = 0; d < 360; d += 2.5) radii.push(rim(i, d));
      const lo = Math.min(...radii);
      const hi = Math.max(...radii);
      expect(lo, isle.id).toBeLessThan(isle.r - 1.8);
      expect(hi, isle.id).toBeGreaterThan(isle.r + 2.8);
      expect(BREATH_ISLE_REACH[i]).toBeCloseTo(hi, 1);
      // At least two separate bays.
      const b = bays(i);
      expect(b.length, isle.id).toBeGreaterThanOrEqual(2);
      // A tongue: the rim past r + 2.5 over a short run of bearings only
      // (narrow), but at least a yard and a half wide two yards in from its tip.
      let run = 0;
      let best = 0;
      for (const r of [...radii, ...radii]) {
        run = r > isle.r + 2.5 ? run + 1 : 0;
        best = Math.max(best, run);
      }
      expect(best * 2.5, isle.id).toBeLessThan(16);
      const tipDeg = radii.indexOf(hi) * 2.5;
      let width = 0;
      for (let d = -20; d <= 20; d += 0.5) {
        const p = at(i, tipDeg + d, hi - 2);
        if (isleAt(p.x, p.z) === i) width += ((hi - 2) * Math.PI * 0.5) / 180;
      }
      expect(width, isle.id).toBeGreaterThan(1.5);
    });
    // Each isle its own outline (never one turned).
    const a = BREATH_ISLES.map((_, i) => bays(i).length + BREATH_ISLE_REACH[i]);
    expect(a[0]).not.toBeCloseTo(a[1], 2);
  });

  it('raises a ledge or two on each, a stride up, never a wall', () => {
    BREATH_ISLES.forEach((isle) => {
      const ledges = F.surfaces.filter(
        (s) => s.id !== isle.id && isIsleFloorOf(s.id, isle.id) && s.kind === 'poly',
      );
      expect(ledges.length, isle.id).toBeGreaterThanOrEqual(1);
      expect(ledges.length, isle.id).toBeLessThanOrEqual(2);
      for (const s of ledges) {
        if (s.kind !== 'poly') continue;
        expect(s.h - isle.h).toBeGreaterThan(0.3);
        expect(s.h - isle.h).toBeLessThanOrEqual(ISLE_LEDGE_MAX_RISE + 1e-6);
        expect(s.hidden).toBe(true);
      }
      // Neighbouring ground on the isle never differs by more than a stride.
      for (let d = 0; d < 360; d += 2) {
        let prev = Number.NaN;
        for (let r = 0; r < rim(BREATH_ISLES.indexOf(isle), d) - 0.3; r += 0.3) {
          const p = at(BREATH_ISLES.indexOf(isle), d, r);
          const h = authoredFieldHeight(F, p.x, p.z);
          if (!Number.isNaN(prev)) expect(Math.abs(h - prev)).toBeLessThan(MAX_STEP_HEIGHT * 0.65);
          prev = h;
        }
      }
    });
  });

  it("keeps every spot of the fight well inside: the landing, the Gale's circle, the adds", () => {
    isleSpots().forEach((s, i) => {
      const h = BREATH_ISLES[i].h;
      // The landing and the adds on the isle's own height (never a ledge),
      // with a yard and a half of floor all round.
      for (const p of [s.land, ...s.adds]) {
        expect(discOnIsle(i, p.x, p.z, 1.5), `${i} ${p.x} ${p.z}`).toBe(true);
        expect(authoredFieldHeight(F, p.x, p.z)).toBe(h);
      }
      // The Homeward Gale's drawn disc (1.2 of its reach) and a half yard more.
      expect(discOnIsle(i, s.home.x, s.home.z, IT.circleR * 1.2 + 0.5)).toBe(true);
      // The Mender's interrupt: a melee raider can stand on floor within 2
      // yd of it, all round.
      const m = s.adds[1];
      expect(discOnIsle(i, m.x, m.z, 2)).toBe(true);
      // The fight's rune ring stays on the floor past every bay.
      const ring = isleRuneRing(i);
      for (let d = 0; d < 360; d += 2.5) expect(rim(i, d) - ring.outer).toBeGreaterThan(0.3);
    });
  });

  it('walks the outline: the isle just inside, the void just outside, no wall on any edge', () => {
    BREATH_ISLES.forEach((isle, i) => {
      for (let d = 0; d < 360; d += 2.5) {
        const r = rim(i, d);
        const inP = at(i, d, r - 0.4);
        const outP = at(i, d, r + 0.6);
        expect(isleAt(inP.x, inP.z), `${isle.id} ${d}`).toBe(i);
        expect(authoredFieldHeight(F, inP.x, inP.z) - isle.h).toBeGreaterThanOrEqual(0);
        expect(authoredFieldHeight(F, inP.x, inP.z) - isle.h).toBeLessThanOrEqual(
          ISLE_LEDGE_MAX_RISE + 1e-6,
        );
        expect(isleAt(outP.x, outP.z)).toBe(-1);
        expect(authoredFieldHeight(F, outP.x, outP.z)).toBe(F.voidHeight);
      }
    });
    const runs = authoredFieldCliffRuns(F).filter((r) => r.surface.startsWith('breath_isle'));
    expect(runs.length).toBeGreaterThan(40);
    for (const r of runs) expect(r.open, `${r.surface} ${r.ax} ${r.az}`).toBe(true);
    // And no collider stands round any isle.
    for (const c of authoredFieldColliders(F, 0)) {
      BREATH_ISLES.forEach((isle, i) => {
        expect(Math.hypot(c.x - isle.x, c.z - isle.z)).toBeGreaterThan(BREATH_ISLE_REACH[i] + 1);
      });
    }
  });
});

// ---- over a real claim ------------------------------------------------------------------------

function pulled(n = 4): BreathFight {
  const f = breathFight(n, 23);
  expect(f.dev('/dev heart breath pull')).toBe(true);
  f.tick(2);
  f.dev('/dev heart breath calm');
  const st = f.state();
  if (st) {
    st.wind.remaining = 9999;
    st.inhaleTimer = 9999;
    st.circleTimer = 9999;
  }
  const b = f.boss();
  f.players.forEach((p, k) => {
    if (!b.threat.has(p.id)) b.threat.set(p.id, 10 - k);
  });
  return f;
}

function crossMark(f: BreathFight, frac: number): number {
  const b = f.boss();
  b.hp = Math.floor(b.maxHp * frac) - 1;
  for (let k = 0; k < ticks(3) && !f.state()?.isles.round; k++) f.tick();
  return f.state()?.isles.round?.isles[0] as number;
}

/** Walk `p` along compass bearing `deg` for up to `seconds` (stops early on
 *  death). */
function walk(f: BreathFight, p: Entity, deg: number, seconds: number, keepAlive = true): void {
  p.facing = (deg * Math.PI) / 180;
  const meta = f.sim.players.get(p.id);
  if (!meta) throw new Error('no meta');
  meta.moveInput.forward = true;
  for (let k = 0; k < ticks(seconds) && !p.dead; k++) f.tick(1, keepAlive);
  meta.moveInput.forward = false;
}

describe('the Islands of the Wind: standing on the new floor', () => {
  it('a ride lands on the pad, on the floor; the adds rise inside the isle', () => {
    const f = pulled();
    const i = crossMark(f, 0.7);
    const p = f.players[2];
    const s = isleSpots()[i];
    f.put(p, s.path.x, s.path.z);
    f.tick(ticks(IT.rideSeconds + 0.6));
    const l = f.local(p);
    expect(Math.hypot(l.x - s.land.x, l.z - s.land.z)).toBeLessThan(0.05);
    expect(p.pos.y).toBeCloseTo(BREATH_ISLES[i].h, 3);
    const adds = f.state()?.isles.adds ?? [];
    expect(adds.length).toBe(2);
    for (const a of adds) {
      const e = f.sim.ctx.entities.get(a.id) as Entity;
      const q = f.local(e);
      expect(onIsleFloor(i, q.x, q.z, e.pos.y)).toBe(true);
    }
  });

  it('walks up a ledge and stands on it, still on the isle and in the fight', () => {
    const f = pulled();
    const i = crossMark(f, 0.7);
    const p = f.players[2];
    const isle = BREATH_ISLES[i];
    const ledge = F.surfaces.find((s) => s.id === `${isle.id}_ledge_1`);
    if (!ledge || ledge.kind !== 'poly') throw new Error('no ledge');
    // The ledge's middle bearing: the mean bearing of its rim points.
    let sx = 0;
    let sz = 0;
    for (const [x, z] of ledge.points) {
      sx += x - isle.x;
      sz += z - isle.z;
    }
    const deg = ((Math.atan2(sx, sz) * 180) / Math.PI + 360) % 360;
    const start = at(i, deg, 4);
    f.put(p, start.x, start.z);
    f.tick(2);
    expect(p.pos.y).toBeCloseTo(isle.h, 2);
    // Up onto it (a stride), stopping short of its rim.
    const target = rim(i, deg) - 1.2;
    p.facing = (deg * Math.PI) / 180;
    const meta = f.sim.players.get(p.id);
    if (!meta) throw new Error('no meta');
    meta.moveInput.forward = true;
    for (let k = 0; k < ticks(4); k++) {
      f.tick();
      const q = f.local(p);
      if (Math.hypot(q.x - isle.x, q.z - isle.z) >= target) break;
    }
    meta.moveInput.forward = false;
    f.tick(4);
    const q = f.local(p);
    expect(p.dead).toBe(false);
    expect(isleAt(q.x, q.z)).toBe(i);
    expect(p.pos.y).toBeGreaterThan(isle.h + 0.3);
    expect(islePlayers(f.sim.ctx, f.inst).map((e) => e.p.id)).toContain(p.id);
    expect(f.boss().threat.has(p.id)).toBe(true);
  });

  it('walked off at a bay, a raider falls into the void and dies; laid back on the Cornice', () => {
    BREATH_ISLES.forEach((isle, i) => {
      const f = pulled();
      crossMark(f, 0.7);
      const p = f.players[2];
      const deg = bays(i)[0];
      const start = at(i, deg, rim(i, deg) - 1.5);
      f.put(p, start.x, start.z);
      f.tick(2);
      expect(isleAt(f.local(p).x, f.local(p).z)).toBe(i);
      walk(f, p, deg, 1.2, false);
      // Off the rim: no wall held them.
      const off = f.local(p);
      expect(isleAt(off.x, off.z)).toBe(-1);
      for (let k = 0; k < ticks(12) && !p.dead; k++) f.tick(1, false);
      f.tick(1, false);
      expect(p.dead, isle.id).toBe(true);
      const back = f.local(p);
      expect(Math.hypot((back.x - C.x) / C.rx, (back.z - C.z) / C.rz)).toBeLessThan(1);
      expect(p.pos.y).toBeGreaterThan(C.h - 3);
    });
  });

  it('holds the adds to their isle: a Sentinel stepped off the rim is set back on its floor', () => {
    const f = pulled();
    const i = crossMark(f, 0.7);
    const adds = f.state()?.isles.adds ?? [];
    const sentinel = adds.find((a) => a.role === 'sentinel');
    if (!sentinel) throw new Error('no sentinel');
    const e = f.sim.ctx.entities.get(sentinel.id) as Entity;
    f.tick(2);
    const deg = bays(i)[0];
    const over = f.world(0, 0);
    const out = at(i, deg, rim(i, deg) + 2);
    // Shoved out over the bay, its feet over the void.
    e.pos.x = over.x + out.x;
    e.pos.z = over.z + out.z;
    e.pos.y = BREATH_ISLES[i].h - 2;
    f.tick(1);
    const q = f.local(e);
    expect(onIsleFloor(i, q.x, q.z, e.pos.y)).toBe(true);
    expect(e.dead).toBe(false);
    // And it keeps fighting on the floor for a while.
    f.tick(ticks(3));
    const q2 = f.local(e);
    expect(onIsleFloor(i, q2.x, q2.z, e.pos.y)).toBe(true);
  });

  it('lets an add thrown up over its own isle land, never snapping it back mid-air', () => {
    const f = pulled();
    const i = crossMark(f, 0.7);
    const sentinel = (f.state()?.isles.adds ?? []).find((a) => a.role === 'sentinel');
    if (!sentinel) throw new Error('no sentinel');
    const e = f.sim.ctx.entities.get(sentinel.id) as Entity;
    f.tick(2);
    const isle = BREATH_ISLES[i];
    // Over the isle's middle, two yards up (a knockback's arc), off its
    // last floor spot.
    const o = f.world(0, 0);
    const spot = at(i, 0, 1.5);
    e.pos.x = o.x + spot.x;
    e.pos.z = o.z + spot.z;
    e.pos.y = isle.h + 2;
    e.onGround = false;
    f.tick(1);
    const q = f.local(e);
    expect(Math.hypot(q.x - spot.x, q.z - spot.z)).toBeLessThan(1);
  });

  it('keeps a Sentinel chasing across a bay on its floor and in the fight', () => {
    const f = pulled();
    const i = crossMark(f, 0.7);
    const sentinel = (f.state()?.isles.adds ?? []).find((a) => a.role === 'sentinel');
    if (!sentinel) throw new Error('no sentinel');
    const e = f.sim.ctx.entities.get(sentinel.id) as Entity;
    const p = f.players[2];
    // The raider across the deepest bay from where the Sentinel is put.
    const deg = bays(i)[0];
    const r = rim(i, deg);
    const near = at(i, deg - 28, r - 1.2);
    const far = at(i, deg + 28, r - 1.2);
    const o = f.world(0, 0);
    e.pos.x = o.x + near.x;
    e.pos.z = o.z + near.z;
    e.pos.y = BREATH_ISLES[i].h;
    f.put(p, far.x, far.z);
    e.threat.set(p.id, 1e6);
    e.aggroTargetId = p.id;
    for (let k = 0; k < ticks(10); k++) {
      f.tick();
      const q = f.local(e);
      expect(onIsleFloor(i, q.x, q.z, e.pos.y)).toBe(true);
    }
    expect(e.dead).toBe(false);
    expect(e.aiState).not.toBe('evade');
    expect(e.threat.size).toBeGreaterThan(0);
  });

  it("lays back only a summit's own corpse: never one on a floor, never the next slot's", () => {
    const f = pulled();
    const [a, b] = [f.players[2], f.players[3]];
    // A corpse lying on the Cornice's floor stays where it fell.
    f.put(a, C.x - 10, C.z);
    f.tick(2, false);
    f.sim.ctx.dealDamage(null, a, a.hp + 1, false, 'physical', null, 'hit', true);
    f.tick(2, false);
    expect(a.dead).toBe(true);
    const lay = f.local(a);
    f.tick(20, false);
    expect(Math.hypot(f.local(a).x - lay.x, f.local(a).z - lay.z)).toBeLessThan(0.01);
    // A corpse in the void past this claim's band (the next slot's) is not
    // carried onto this Cornice.
    f.sim.ctx.dealDamage(null, b, b.hp + 1, false, 'physical', null, 'hit', true);
    f.tick(1, false);
    expect(b.dead).toBe(true);
    const o = f.world(0, 0);
    b.pos = { x: o.x + 0, y: F.voidHeight, z: o.z + 260 };
    b.prevPos = { ...b.pos };
    f.tick(20, false);
    expect(f.local(b).z).toBeGreaterThan(250);
    expect(b.pos.y).toBeLessThan(F.voidHeight + 3);
  });
});
