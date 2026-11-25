// The Wind Bridge over the chasm (encounters/smith_heart/breath_bridge.ts;
// Jose's call of 2026-11-25, in place of the Gale Crossing's pads): walked
// both ways out of the fight, gone the moment the guardian fights (a body on
// it carried off to an end, never killed by it going), the void's while the
// fight runs, back after a wipe or the kill. Deterministic.

import { describe, expect, it } from 'vitest';
import {
  bridgeDeck,
  bridgeShown,
  stepBridgeForm,
} from '../src/render/smith_heart_fx/breath_bridge_fx_core';
import { CORNICE_BRIDGE, CORNICE_LANDING } from '../src/sim/content/smith_heart_layout';
import {
  BRIDGE_ENDS,
  BRIDGE_OBJECT,
  BRIDGE_TUNING,
  bridgeCarryEnd,
  onBridgeStrip,
} from '../src/sim/encounters/smith_heart/breath_bridge';
import { inBreathArena } from '../src/sim/encounters/smith_heart/breath_geometry';
import type { Entity } from '../src/sim/types';
import { type BreathFight, breathFight } from './helpers/breath_fight';

const ticks = (s: number) => Math.round(s * 20);
const B = CORNICE_BRIDGE;
const MID = { x: (B.from.x + B.to.x) / 2, z: B.from.z };

/** Walk `p` toward instance-local (x, z) for `seconds`. */
function walk(f: BreathFight, p: Entity, to: { x: number; z: number }, seconds: number): void {
  const meta = f.sim.players.get(p.id);
  if (!meta) throw new Error('meta');
  for (let i = 0; i < ticks(seconds); i++) {
    const at = f.local(p);
    p.facing = Math.atan2(to.x - at.x, to.z - at.z);
    meta.moveInput.forward = Math.hypot(to.x - at.x, to.z - at.z) > 0.6;
    f.tick(1);
  }
  meta.moveInput.forward = false;
}

const bridgeObjects = (f: BreathFight) => f.objects(BRIDGE_OBJECT).length;

describe('the Wind Bridge', () => {
  it('its object is no other Breath object (never read as the wind, a calm or a pad)', () => {
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
      expect(BRIDGE_OBJECT.startsWith(prefix), prefix).toBe(false);
  });

  it('spans the chasm: its strip is floor between the landing and the Cornice', () => {
    expect(onBridgeStrip(MID.x, MID.z)).toBe(true);
    expect(onBridgeStrip(CORNICE_LANDING.x, CORNICE_LANDING.z)).toBe(false);
    expect(onBridgeStrip(0, 196)).toBe(false);
    expect(inBreathArena(BRIDGE_ENDS.cornice.x, BRIDGE_ENDS.cornice.z)).toBe(true);
    expect(BRIDGE_TUNING.dissolve).toBeCloseTo(1.5, 6);
    expect(BRIDGE_TUNING.form).toBeCloseTo(1.5, 6);
  });

  it('is walked both ways out of the fight, its object up', () => {
    const f = breathFight(1, 23);
    const p = f.players[0];
    expect(bridgeObjects(f)).toBe(1);
    f.put(p, CORNICE_LANDING.x, CORNICE_LANDING.z);
    walk(f, p, { x: BRIDGE_ENDS.cornice.x + 4, z: B.to.z }, 6);
    let at = f.local(p);
    expect(p.dead).toBe(false);
    expect(inBreathArena(at.x, at.z)).toBe(true);
    walk(f, p, { x: CORNICE_LANDING.x, z: CORNICE_LANDING.z }, 6);
    at = f.local(p);
    expect(p.dead).toBe(false);
    expect(Math.hypot(at.x - CORNICE_LANDING.x, at.z - CORNICE_LANDING.z)).toBeLessThan(
      CORNICE_LANDING.r,
    );
  });

  it('picks the end a body is carried to: the way it heads, else the nearer', () => {
    expect(bridgeCarryEnd(MID.x, Math.PI / 2)).toBe('cornice');
    expect(bridgeCarryEnd(MID.x, -Math.PI / 2)).toBe('landing');
    expect(bridgeCarryEnd(B.to.x - 3, 0)).toBe('cornice');
    expect(bridgeCarryEnd(B.from.x + 3, 0)).toBe('landing');
  });

  it('goes on the pull: a body on it is carried off to an end, alive, never left on it', () => {
    for (const [facing, end] of [
      [Math.PI / 2, 'cornice'],
      [-Math.PI / 2, 'landing'],
    ] as const) {
      const f = breathFight(2, 23);
      const p = f.players[1];
      f.put(p, MID.x, MID.z);
      p.facing = facing;
      f.tick(1);
      expect(f.dev('/dev heart breath pull')).toBe(true);
      f.tick(4);
      expect(bridgeObjects(f)).toBe(0);
      let maxStep = 0;
      let last = f.local(p);
      for (let i = 0; i < ticks(BRIDGE_TUNING.dissolve + 3); i++) {
        f.tick(1);
        const at = f.local(p);
        maxStep = Math.max(maxStep, Math.hypot(at.x - last.x, at.z - last.z));
        last = at;
      }
      const at = f.local(p);
      expect(p.dead, end).toBe(false);
      expect(onBridgeStrip(at.x, at.z), end).toBe(false);
      const want = BRIDGE_ENDS[end];
      expect(Math.abs(at.x - want.x), end).toBeLessThan(2);
      // Gently: a slide, never a blink.
      expect(maxStep).toBeLessThan(1);
    }
  });

  it('is the void in the fight: a body that steps onto its strip falls', () => {
    const f = breathFight(2, 23);
    expect(f.dev('/dev heart breath pull')).toBe(true);
    f.tick(ticks(BRIDGE_TUNING.dissolve) + 4);
    const p = f.players[1];
    p.maxHp = 50000;
    p.hp = 50000;
    f.put(p, BRIDGE_ENDS.cornice.x, BRIDGE_ENDS.cornice.z);
    walk(f, p, { x: MID.x, z: MID.z }, 3);
    expect(p.dead).toBe(true);
    // Its body laid back on the floor at the strip's end, never in the void.
    const at = f.local(p);
    expect(onBridgeStrip(at.x, at.z)).toBe(false);
  });

  it('comes back after a wipe and after the kill', () => {
    const f = breathFight(1, 23);
    expect(f.dev('/dev heart breath pull')).toBe(true);
    f.tick(4);
    expect(bridgeObjects(f)).toBe(0);
    // A wipe: the raid off the Cornice (on the landing), the fight reset.
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
      const f = breathFight(2, 23);
      const p = f.players[1];
      f.put(p, MID.x - 2, MID.z + 1);
      p.facing = 0;
      f.tick(1);
      f.dev('/dev heart breath pull');
      f.tick(ticks(BRIDGE_TUNING.dissolve + 2));
      return { at: f.local(p), dead: p.dead };
    };
    expect(run()).toEqual(run());
  });
});

describe('the Wind Bridge look (pure core)', () => {
  it('lies over the chasm alone, a little onto each rim', () => {
    const D = bridgeDeck();
    const west = D.x - D.length / 2;
    const east = D.x + D.length / 2;
    expect(west).toBeGreaterThan(CORNICE_LANDING.x + CORNICE_LANDING.r - 3);
    expect(onBridgeStrip(west + 2, D.z)).toBe(true);
    expect(onBridgeStrip(east - 2, D.z)).toBe(true);
    expect(D.width).toBe(B.halfWidth * 2);
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
