// The Quarryheart Charger's body-rig decisions (src/render/quarryheart_charger_fx_core.ts): the
// heartbeat, the arrival timeline, the gait emission rates and what reduced motion drops, the
// motion levers, and the hoof-strike latch that leaves the ember and frost prints.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOUNT_REAR_SECONDS } from '../src/render/mount_rear_core';
import {
  createQuarryheartHoofState,
  QUARRYHEART_ASSEMBLE_SECONDS,
  QUARRYHEART_BEAT_PERIOD,
  QUARRYHEART_CEN_SCALE,
  QUARRYHEART_CORE_BIND,
  QUARRYHEART_HOOF_DOWN,
  QUARRYHEART_HOOF_UP,
  QUARRYHEART_REAR_STRIKE_SECONDS,
  QUARRYHEART_SUMMON_GRACE_SECONDS,
  type QuarryheartArrival,
  type QuarryheartMotion,
  type QuarryheartRates,
  quarryheartArrival,
  quarryheartBeat,
  quarryheartBurstPolicy,
  quarryheartHoofStrike,
  quarryheartKeepsHalo,
  quarryheartMotion,
  quarryheartPlaysArrival,
  quarryheartPrintKind,
  quarryheartRates,
  quarryheartWhole,
} from '../src/render/quarryheart_charger_fx_core';

const arrival = (): QuarryheartArrival => ({
  assemble: 0,
  ignite: 0,
  wind: 0,
  flash: 0,
  done: false,
});
const rates = (): QuarryheartRates => ({ sparks: 0, embers: 0, frost: 0, trail: 0 });

describe('the heartbeat', () => {
  it('peaks on the lub, carries a softer dub, and goes quiet between beats', () => {
    const lub = quarryheartBeat(0.06 * QUARRYHEART_BEAT_PERIOD, false);
    const dub = quarryheartBeat(0.26 * QUARRYHEART_BEAT_PERIOD, false);
    const quiet = quarryheartBeat(0.7 * QUARRYHEART_BEAT_PERIOD, false);
    expect(lub).toBeGreaterThan(0.95);
    expect(dub).toBeGreaterThan(0.5);
    expect(dub).toBeLessThan(lub);
    expect(quiet).toBeLessThan(0.05);
    // periodic, and defined for a negative clock
    expect(quarryheartBeat(0.3, false)).toBeCloseTo(
      quarryheartBeat(0.3 + QUARRYHEART_BEAT_PERIOD, false),
      6,
    );
    expect(quarryheartBeat(-0.3, false)).toBeGreaterThanOrEqual(0);
  });

  it('never leaves 0..1, and under reduced motion is a slow breath with no spike', () => {
    let maxStep = 0;
    let prev = quarryheartBeat(0, true);
    for (let t = 0; t <= 3 * QUARRYHEART_BEAT_PERIOD; t += 0.01) {
      for (const calm of [false, true]) {
        const b = quarryheartBeat(t, calm);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(1);
      }
      const c = quarryheartBeat(t, true);
      maxStep = Math.max(maxStep, Math.abs(c - prev));
      prev = c;
    }
    // a sine over 1.2 s moves at most ~0.026 per 10 ms; the beat's lub rises far faster
    expect(maxStep).toBeLessThan(0.03);
    expect(Math.abs(quarryheartBeat(0.06, false) - quarryheartBeat(0.0, false))).toBeGreaterThan(
      0.3,
    );
  });
});

describe('the arrival', () => {
  it('flies the plates home over the assembly, the core catching first and the wind last', () => {
    const a = arrival();
    quarryheartArrival(0, false, a);
    expect(a.assemble).toBe(0);
    expect(a.wind).toBe(0);
    expect(a.done).toBe(false);
    quarryheartArrival(0.2, false, a);
    expect(a.ignite).toBeGreaterThan(0.3); // the heart has caught
    expect(a.wind).toBe(0); // the mane has not
    expect(a.flash).toBeGreaterThan(0);
    quarryheartArrival(QUARRYHEART_ASSEMBLE_SECONDS * 0.5, false, a);
    expect(a.assemble).toBeCloseTo(0.5, 6);
    quarryheartArrival(QUARRYHEART_ASSEMBLE_SECONDS, false, a);
    expect(a.assemble).toBe(1);
    expect(a.ignite).toBeCloseTo(1, 6);
    quarryheartArrival(QUARRYHEART_ASSEMBLE_SECONDS * 1.12, false, a);
    expect(a.done).toBe(true);
    expect(a.wind).toBeCloseTo(1, 6);
    expect(a.flash).toBeLessThan(0.01);
  });

  it('skips the flight under reduced motion: home from the first frame, the fire fading up', () => {
    const a = arrival();
    quarryheartArrival(0, true, a);
    expect(a.assemble).toBe(1);
    expect(a.flash).toBe(0);
    expect(a.ignite).toBe(0);
    quarryheartArrival(0.6, true, a);
    expect(a.ignite).toBe(1);
    expect(a.done).toBe(true);
  });

  it('plays only for a body drawn soon after its summon edge', () => {
    expect(quarryheartPlaysArrival(null)).toBe(false);
    expect(quarryheartPlaysArrival(0)).toBe(true);
    expect(quarryheartPlaysArrival(QUARRYHEART_SUMMON_GRACE_SECONDS)).toBe(true);
    expect(quarryheartPlaysArrival(QUARRYHEART_SUMMON_GRACE_SECONDS + 0.01)).toBe(false);
    expect(quarryheartPlaysArrival(-1)).toBe(false);
    expect(quarryheartWhole(arrival())).toEqual({
      assemble: 1,
      ignite: 1,
      wind: 1,
      flash: 0,
      done: true,
    });
  });
});

describe('the gait rates and the motion levers', () => {
  it('smoulders standing, sheds more walking, throws the trail only at a gallop', () => {
    const idle = quarryheartRates(false, false, false, rates());
    const walk = { ...quarryheartRates(true, false, false, rates()) };
    const run = { ...quarryheartRates(true, true, false, rates()) };
    expect(idle.trail).toBe(0);
    expect(idle.embers).toBeGreaterThan(0);
    expect(walk.embers).toBeGreaterThan(idle.embers);
    expect(run.trail).toBeGreaterThan(walk.trail);
    expect(run.sparks).toBeGreaterThan(walk.sparks);
  });

  it('reduced motion drops the crackle and the streaking trail and keeps the slow embers', () => {
    for (const [moving, running] of [
      [false, false],
      [true, false],
      [true, true],
    ] as const) {
      const r = quarryheartRates(moving, running, true, rates());
      expect(r.sparks).toBe(0);
      expect(r.trail).toBe(0);
      expect(r.embers).toBeGreaterThan(0);
    }
    const calm: QuarryheartMotion = quarryheartMotion(true, {
      float: 1,
      wave: 1,
      crackle: 1,
      flow: 1,
    });
    expect(calm.float).toBe(0);
    expect(calm.crackle).toBe(0);
    expect(calm.wave).toBeLessThan(1);
    expect(calm.flow).toBeLessThan(1);
    expect(calm.flow).toBeGreaterThan(0);
    const full = quarryheartMotion(false, { float: 0, wave: 0, crackle: 0, flow: 0 });
    expect(full.float).toBeGreaterThan(0);
    expect(full.wave).toBe(1);
    expect(full.crackle).toBe(1);
    expect(full.flow).toBe(1);
  });
});

describe('what the tier and reduced motion keep of the extras', () => {
  it('draws the halo from the Medium effects tier up, never on Low', () => {
    expect(quarryheartKeepsHalo('low')).toBe(false);
    for (const tier of ['medium', 'high', 'ultra', 'insane'] as const) {
      expect(quarryheartKeepsHalo(tier), tier).toBe(true);
    }
  });

  it('reduced motion drops every flash, ring and spray from the one-shot bursts', () => {
    expect(quarryheartBurstPolicy(true, { flash: true, spray: true })).toEqual({
      flash: false,
      spray: false,
    });
    expect(quarryheartBurstPolicy(false, { flash: false, spray: false })).toEqual({
      flash: true,
      spray: true,
    });
  });
});

describe('the hoof strike', () => {
  it('strikes once as a hoof comes down, re-arms only once it is lifted clear', () => {
    const s = createQuarryheartHoofState();
    expect(quarryheartHoofStrike(s, 0.32)).toBe(false); // first sight seeds, never strikes
    expect(quarryheartHoofStrike(s, 0.33)).toBe(false); // still planted
    expect(quarryheartHoofStrike(s, QUARRYHEART_HOOF_UP - 0.01)).toBe(false); // not clear yet
    expect(quarryheartHoofStrike(s, QUARRYHEART_HOOF_DOWN - 0.01)).toBe(false); // so no re-strike
    expect(quarryheartHoofStrike(s, 0.8)).toBe(false); // lifted
    expect(quarryheartHoofStrike(s, 0.45)).toBe(false); // falling, not down yet
    expect(quarryheartHoofStrike(s, 0.33)).toBe(true); // the strike
    expect(quarryheartHoofStrike(s, 0.32)).toBe(false);
    expect(QUARRYHEART_HOOF_UP).toBeGreaterThan(QUARRYHEART_HOOF_DOWN);
  });

  it('a hoof first seen in the air strikes on its first landing', () => {
    const s = createQuarryheartHoofState();
    expect(quarryheartHoofStrike(s, 0.9)).toBe(false);
    expect(quarryheartHoofStrike(s, 0.33)).toBe(true);
  });

  it('burns with the forehooves and freezes with the hind', () => {
    expect([0, 1, 2, 3].map(quarryheartPrintKind)).toEqual(['ember', 'ember', 'frost', 'frost']);
  });
});

describe('the core numbers agree with the build', () => {
  it('pins the heart and the centroid scale to the Blender build (Z up, -Y forward)', () => {
    const body = readFileSync(
      path.join(__dirname, '..', 'scripts/assets/quarryheart_charger/charger_body.py'),
      'utf8',
    );
    const core = /^CORE = Vector\(\(([^)]*)\)\)/m.exec(body);
    expect(core, 'CORE moved or changed shape in charger_body.py').not.toBeNull();
    const [bx, by, bz] = (core as RegExpExecArray)[1].split(',').map(Number);
    // Blender (x, y, z) is glTF (x, z, -y)
    expect(QUARRYHEART_CORE_BIND).toEqual([bx, bz, -by]);
    const scale = /^CEN_SCALE = ([\d.]+)/m.exec(body);
    expect(Number((scale as RegExpExecArray)[1])).toBe(QUARRYHEART_CEN_SCALE);
  });

  it('strikes the rear inside the rear clip, after the forehooves have come down', () => {
    expect(QUARRYHEART_REAR_STRIKE_SECONDS).toBeGreaterThan(0.6 * MOUNT_REAR_SECONDS);
    expect(QUARRYHEART_REAR_STRIKE_SECONDS).toBeLessThan(MOUNT_REAR_SECONDS);
  });
});
