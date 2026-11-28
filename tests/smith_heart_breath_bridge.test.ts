// The Wind Bridge's curved current over the chasm (encounters/smith_heart/
// breath_bridge.ts, its curve breath_bridge_path.ts; Jose's call of
// 2026-11-25): step into either mouth and the wind lifts you and carries you
// along the curve to the far side in a few seconds, both ways, a flowing
// carry (never a blink), set down softly. Gone on the pull (a rider mid-way
// set down at the nearer end, never dropped), back after a wipe or the
// kill. Deterministic. Its look: render/smith_heart_fx/breath_bridge_fx_core.ts.

import { describe, expect, it } from 'vitest';
import {
  BRIDGE_LOOK,
  bridgeArc,
  bridgeShown,
  bridgeStrand,
  bridgeStreamPath,
  stepBridgeForm,
} from '../src/render/smith_heart_fx/breath_bridge_fx_core';
import { CORNICE_BRIDGE, CORNICE_LANDING } from '../src/sim/content/smith_heart_layout';
import {
  BRIDGE_OBJECT,
  BRIDGE_RIDE_OBJECT,
  BRIDGE_TUNING,
  bridgeMouthAt,
} from '../src/sim/encounters/smith_heart/breath_bridge';
import { bridgeCurve } from '../src/sim/encounters/smith_heart/breath_bridge_path';
import { inBreathArena } from '../src/sim/encounters/smith_heart/breath_geometry';
import { ISLE_AURAS } from '../src/sim/encounters/smith_heart/breath_isle_ids';
import type { Entity } from '../src/sim/types';
import { type BreathFight, breathFight } from './helpers/breath_fight';

const ticks = (s: number) => Math.round(s * 20);
const B = CORNICE_BRIDGE;

const bridgeObjects = (f: BreathFight) =>
  f.objects(BRIDGE_OBJECT).filter((e) => e.templateId === BRIDGE_OBJECT).length;

/** A claim at rest: the raid on the landing, the guardian reset (the helper
 *  sets the raid on the Cornice, which wakes it). */
function atRest(n: number): BreathFight {
  const f = breathFight(n, 23);
  for (const p of f.players) f.put(p, CORNICE_LANDING.x, CORNICE_LANDING.z + 2);
  expect(f.dev('/dev heart breath reset')).toBe(true);
  f.tick(4);
  return f;
}
const riding = (p: Entity) => p.auras.some((a) => a.id === ISLE_AURAS.riding);

interface Ride {
  /** Seconds from the step in until set down (-1 never). */
  seconds: number;
  /** The most one tick moved the body (yards), and its highest rise. */
  maxStep: number;
  rise: number;
  end: { x: number; z: number };
  dead: boolean;
  carriedAll: boolean;
}

/** Step `p` into the mouth at `mouth` and follow its ride for `seconds`. */
function ride(f: BreathFight, p: Entity, mouth: { x: number; z: number }, seconds: number): Ride {
  f.put(p, mouth.x, mouth.z);
  const y0 = p.pos.y;
  const out: Ride = {
    seconds: -1,
    maxStep: 0,
    rise: 0,
    end: f.local(p),
    dead: false,
    carriedAll: true,
  };
  let last = { ...p.pos };
  let began = -1;
  for (let i = 0; i < ticks(seconds); i++) {
    f.tick(1);
    const step = Math.hypot(p.pos.x - last.x, p.pos.y - last.y, p.pos.z - last.z);
    last = { ...p.pos };
    if (p.carriedBy !== undefined && began < 0) began = i;
    if (began >= 0 && out.seconds < 0) {
      out.maxStep = Math.max(out.maxStep, step);
      out.rise = Math.max(out.rise, p.pos.y - y0);
      if (p.carriedBy === undefined) out.seconds = (i - began) / 20;
      else if (!riding(p)) out.carriedAll = false;
    }
  }
  out.end = f.local(p);
  out.dead = p.dead;
  return out;
}

describe('the Wind Bridge current', () => {
  it('its objects are no other Breath object (never read as the wind, a calm or a pad)', () => {
    for (const id of [BRIDGE_OBJECT, BRIDGE_RIDE_OBJECT])
      for (const prefix of [
        'sh_breath_wind_',
        'sh_breath_calm_',
        'sh_breath_strike_',
        'sh_breath_charged_',
        'sh_breath_cradle_',
        'sh_breath_knot_',
        'sh_breath_updraft_',
        'sh_breath_gale_ride_',
        'sh_breath_closing_',
      ])
        expect(id.startsWith(prefix), `${id} ${prefix}`).toBe(false);
  });

  it('curves: up over the chasm and down, swept sideways, mouth to mouth', () => {
    const a = bridgeCurve(0, 60);
    const b = bridgeCurve(1, 60);
    expect(a.x).toBeCloseTo(B.landing.x, 6);
    expect(b.x).toBeCloseTo(B.cornice.x, 6);
    let rise = 0;
    let sweep = 0;
    let last = a;
    for (let i = 1; i <= 100; i++) {
      const p = bridgeCurve(i / 100, 60);
      rise = Math.max(rise, p.y - 60);
      sweep = Math.max(sweep, Math.abs(p.z - B.landing.z));
      // Smooth: no step jumps.
      expect(Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z)).toBeLessThan(1.2);
      last = p;
    }
    expect(rise).toBeGreaterThan(B.apex * 0.8);
    expect(sweep).toBeGreaterThan(B.bend * 0.8);
    expect(bridgeMouthAt(B.landing.x, B.landing.z)).toBe('landing');
    expect(bridgeMouthAt(B.cornice.x, B.cornice.z)).toBe('cornice');
    expect(bridgeMouthAt(B.landingDrop.x, B.landingDrop.z)).toBeNull();
    expect(bridgeMouthAt(B.corniceDrop.x, B.corniceDrop.z)).toBeNull();
    expect(inBreathArena(B.corniceDrop.x, B.corniceDrop.z)).toBe(true);
    expect(inBreathArena(B.cornice.x, B.cornice.z)).toBe(true);
  });

  it('carries a body out to the Cornice: lifted, held, flowing, set down clear of the mouth', () => {
    const f = atRest(1);
    const p = f.players[0];
    expect(bridgeObjects(f)).toBe(1);
    const r = ride(f, p, B.landing, BRIDGE_TUNING.rideSeconds + 2);
    expect(r.dead).toBe(false);
    expect(r.carriedAll).toBe(true);
    expect(r.seconds).toBeGreaterThan(BRIDGE_TUNING.rideSeconds - 0.15);
    expect(r.seconds).toBeLessThan(BRIDGE_TUNING.rideSeconds + 0.15);
    expect(r.rise).toBeGreaterThan(B.apex * 0.8);
    // Never a blink: no tick near a third of the way.
    expect(r.maxStep).toBeLessThan(1.5);
    expect(Math.hypot(r.end.x - B.corniceDrop.x, r.end.z - B.corniceDrop.z)).toBeLessThan(0.6);
    expect(riding(p)).toBe(false);
    expect(p.onGround).toBe(true);
  });

  it('carries a body home to the landing the same way', () => {
    const f = atRest(1);
    const p = f.players[0];
    const r = ride(f, p, B.cornice, BRIDGE_TUNING.rideSeconds + 2);
    expect(r.dead).toBe(false);
    expect(r.seconds).toBeGreaterThan(BRIDGE_TUNING.rideSeconds - 0.15);
    expect(Math.hypot(r.end.x - B.landingDrop.x, r.end.z - B.landingDrop.z)).toBeLessThan(0.6);
    expect(Math.hypot(r.end.x - CORNICE_LANDING.x, r.end.z - CORNICE_LANDING.z)).toBeLessThan(
      CORNICE_LANDING.r,
    );
  });

  it('goes on the pull: no mouth takes anyone, a rider mid-way is set down at the nearer end', () => {
    for (const [start, nearer] of [
      [B.landing, B.landingDrop],
      [B.cornice, B.corniceDrop],
    ] as const) {
      const f = atRest(2);
      const p = f.players[1];
      f.put(p, start.x, start.z);
      // A third of the way over, then the raid on the Cornice pulls.
      f.tick(ticks(BRIDGE_TUNING.rideSeconds / 3));
      expect(p.carriedBy).toBeDefined();
      f.put(f.players[0], 0, 192);
      expect(f.dev('/dev heart breath pull')).toBe(true);
      f.tick(ticks(BRIDGE_TUNING.rideSeconds));
      expect(bridgeObjects(f)).toBe(0);
      expect(p.dead).toBe(false);
      expect(p.carriedBy).toBeUndefined();
      const at = f.local(p);
      expect(Math.hypot(at.x - nearer.x, at.z - nearer.z)).toBeLessThan(0.6);
      // In the fight a mouth takes nobody.
      f.put(p, B.landing.x, B.landing.z);
      f.tick(4);
      expect(p.carriedBy).toBeUndefined();
    }
  });

  it('comes back after a wipe and after the kill', () => {
    const f = breathFight(1, 23);
    f.tick(4);
    expect(f.dev('/dev heart breath pull')).toBe(true);
    f.tick(4);
    expect(bridgeObjects(f)).toBe(0);
    f.put(f.players[0], CORNICE_LANDING.x, CORNICE_LANDING.z);
    expect(f.dev('/dev heart breath reset')).toBe(true);
    f.tick(4);
    expect(bridgeObjects(f)).toBe(1);
    f.put(f.players[0], 0, 192);
    expect(f.dev('/dev heart breath pull')).toBe(true);
    f.tick(4);
    expect(bridgeObjects(f)).toBe(0);
    expect(f.dev('/dev heart kill breath')).toBe(true);
    f.tick(4);
    expect(bridgeObjects(f)).toBe(1);
  });

  it('is deterministic', () => {
    const run = () => {
      const f = atRest(1);
      const p = f.players[0];
      const trail: number[] = [];
      f.put(p, B.landing.x + 1, B.landing.z - 1);
      for (let i = 0; i < ticks(BRIDGE_TUNING.rideSeconds + 1); i++) {
        f.tick(1);
        trail.push(p.pos.x, p.pos.y, p.pos.z);
      }
      return trail;
    };
    expect(run()).toEqual(run());
  });
});

describe('the Wind Bridge look (pure core)', () => {
  it('lays the stream on the ride curve at a body middle, strands round it', () => {
    const path = bridgeStreamPath(60);
    expect(path).toHaveLength(BRIDGE_LOOK.samples + 1);
    expect(path[0].y).toBeCloseTo(60 + BRIDGE_LOOK.lift, 6);
    const mid = BRIDGE_LOOK.samples >> 1;
    const s = bridgeStrand(path, 0);
    const d = Math.hypot(s[mid].x - path[mid].x, s[mid].y - path[mid].y, s[mid].z - path[mid].z);
    expect(d).toBeGreaterThan(BRIDGE_LOOK.radius * 0.5);
    expect(d).toBeLessThan(BRIDGE_LOOK.radius);
  });

  it('jumps short jagged arcs along the stream (a cosmetic source, no rng)', () => {
    const path = bridgeStreamPath(60);
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const arc = bridgeArc(path, 20, 1, rand);
    expect(arc).toHaveLength(BRIDGE_LOOK.arcSegments + 1);
    const a = arc[0];
    const b = arc[arc.length - 1];
    expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeLessThan(BRIDGE_LOOK.arcReach * 2.5);
  });

  it('forms over its seconds while up and is gone (nothing drawn) over its dissolve', () => {
    let f = 0;
    for (let i = 0; i < ticks(BRIDGE_TUNING.form) - 1; i++) f = stepBridgeForm(f, true, 1 / 20);
    expect(f).toBeGreaterThan(0.9);
    expect(f).toBeLessThan(1);
    f = stepBridgeForm(f, true, 1);
    expect(f).toBe(1);
    expect(bridgeShown(f)).toBe(true);
    for (let i = 0; i < ticks(BRIDGE_TUNING.dissolve) + 1; i++)
      f = stepBridgeForm(f, false, 1 / 20);
    expect(f).toBe(0);
    expect(bridgeShown(f)).toBe(false);
  });
});
