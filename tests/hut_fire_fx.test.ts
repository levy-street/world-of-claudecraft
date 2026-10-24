// A torched mudfin hut burning (src/render/hut_fire_fx.ts), driven through a
// fake particle pool, light and smoke plume: the `worldObjectBurning` event
// starts a timed fire sized to the hut, it emits flame, embers and smoke along
// hut_fire_core.ts's timeline, flickers a warm light while it burns (only ever
// into a free light), hands its plume to the smoke painter until the last puff
// is gone, and ends.
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  HUT_FIRE_BURN_SECONDS,
  HUT_FIRE_RATES,
  HUT_FIRE_TOTAL_SECONDS,
  type HutFireBody,
  type HutFireKind,
} from '../src/render/hut_fire_core';
import { HutFireFx } from '../src/render/hut_fire_fx';
import type { HutSmokePlume, HutSmokeView } from '../src/render/hut_smoke';
import { HUT_SMOKE_END_SECONDS } from '../src/render/hut_smoke_core';
import { MUDFIN_HUT_MODELS, MUDFIN_HUTS } from '../src/sim/mudfin_huts';
import type { SimEvent } from '../src/sim/types';

interface Emit {
  kind: HutFireKind;
  body: HutFireBody;
  rate: number;
}

interface Pulse {
  at: number;
  y: number;
  intensity: number;
  duration: number;
}

function harness(withSmoke = false) {
  const bursts: { x: number; y: number; z: number; school: string }[] = [];
  const emits: Emit[] = [];
  const pulses: Pulse[] = [];
  const paints: { ages: number[]; camX: number; camZ: number }[] = [];
  const clock = { t: 0 };
  const mesh = { visible: false };
  const smoke = {
    mesh,
    update(plumes: Iterable<HutSmokePlume>, camX: number, camZ: number) {
      const ages = [...plumes].map((p) => p.age);
      mesh.visible = ages.length > 0;
      paints.push({ ages, camX, camZ });
    },
    dispose() {},
  } as unknown as HutSmokeView;
  let lightFree = true;
  const fx = new HutFireFx(
    {
      burst: (at: THREE.Vector3, school: string) =>
        bursts.push({ x: at.x, y: at.y, z: at.z, school }),
      hutFire: (kind, body, rate) => emits.push({ kind, body: { ...body }, rate }),
    },
    () => 2,
    withSmoke ? smoke : null,
  );
  fx.setLight({
    pulseIfFree: (at: THREE.Vector3, _school: string, intensity = 0, duration = 0) => {
      if (!lightFree) return false;
      pulses.push({ at: clock.t, y: at.y, intensity, duration });
      return true;
    },
  });
  const run = (seconds: number, dt = 1 / 20): void => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      clock.t += dt;
      fx.update(dt);
    }
  };
  const setLightFree = (free: boolean) => {
    lightFree = free;
  };
  return { fx, bursts, emits, pulses, paints, run, setLightFree, mesh };
}

const HUT = MUDFIN_HUTS[1];
const burning = (objectId: number, x = HUT.x, z = HUT.z): SimEvent => ({
  type: 'worldObjectBurning',
  objectId,
  x,
  z,
});

describe('HutFireFx', () => {
  it('ignores every other event', () => {
    const { fx, bursts } = harness();
    fx.handleEvent({ type: 'log', text: 'x' } as unknown as SimEvent);
    expect(fx.burning()).toEqual([]);
    expect(bursts).toEqual([]);
  });

  it('catches with fire bursts ringed round the eaves, not hidden inside the hut', () => {
    const { fx, bursts } = harness();
    fx.handleEvent(burning(7));
    expect(fx.burning()).toEqual([7]);
    const spec = MUDFIN_HUT_MODELS[HUT.model];
    expect(bursts.length).toBeGreaterThanOrEqual(4);
    for (const b of bursts) expect(b.school).toBe('fire');
    const ring = bursts.filter((b) => Math.hypot(b.x - HUT.x, b.z - HUT.z) > spec.radius);
    expect(ring.length).toBeGreaterThanOrEqual(4);
    // and one over the roof
    expect(bursts.some((b) => b.y > 2 + spec.height * 0.8)).toBe(true);
  });

  it('sizes the fire to the hut it is burning', () => {
    const { fx, emits } = harness();
    fx.handleEvent(burning(1));
    fx.update(0.5);
    const spec = MUDFIN_HUT_MODELS[HUT.model];
    expect(emits[0].body).toEqual({
      x: HUT.x,
      y: 2,
      z: HUT.z,
      radius: spec.radius,
      height: spec.height,
    });
  });

  it('still finds the hut from a position rounded on the way over the wire', () => {
    const { fx, emits } = harness();
    fx.handleEvent(burning(1, HUT.x + 0.3, HUT.z - 0.2));
    fx.update(0.5);
    const spec = MUDFIN_HUT_MODELS[HUT.model];
    expect(emits[0].body.radius).toBe(spec.radius);
    expect(emits[0].body.height).toBe(spec.height);
  });

  it('burns flame and embers for ten seconds, then only smoke, then nothing', () => {
    const { fx, emits, run } = harness();
    fx.handleEvent(burning(1));
    run(5);
    const midFire = emits.filter((e) => e.kind === 'flame');
    expect(midFire.length).toBeGreaterThan(0);
    expect(Math.max(...midFire.map((e) => e.rate))).toBeCloseTo(HUT_FIRE_RATES.flame, 6);
    emits.length = 0;
    run(HUT_FIRE_BURN_SECONDS - 5 + 0.5);
    emits.length = 0;
    run(2);
    expect(emits.some((e) => e.kind === 'flame' || e.kind === 'ember')).toBe(false);
    expect(emits.some((e) => e.kind === 'smoke')).toBe(true);
    run(HUT_FIRE_TOTAL_SECONDS);
    expect(fx.burning()).toEqual([]);
    emits.length = 0;
    fx.update(1);
    expect(emits).toEqual([]);
  });

  it('flickers a warm light while the flames burn, one pulse at a time', () => {
    const { fx, pulses, run } = harness();
    fx.handleEvent(burning(1));
    run(HUT_FIRE_BURN_SECONDS - 1);
    // a flicker, not one long glow: more than a pulse a second
    expect(pulses.length).toBeGreaterThan(HUT_FIRE_BURN_SECONDS - 1);
    for (const p of pulses) expect(p.intensity).toBeGreaterThan(0);
    // each pulse has faded before the next one lights: one light per hut at most
    for (let i = 1; i < pulses.length; i++) {
      expect(pulses[i].at - pulses[i - 1].at).toBeGreaterThanOrEqual(pulses[i - 1].duration);
    }
    run(1.5);
    pulses.length = 0;
    run(3);
    expect(pulses).toEqual([]);
  });

  it('never fights a talent flash for a light: a full pool just skips the flicker', () => {
    const { fx, pulses, run, setLightFree } = harness();
    setLightFree(false);
    fx.handleEvent(burning(1));
    run(3);
    expect(pulses).toEqual([]);
    // the fire burns on regardless, and lights again once a light is free
    expect(fx.burning()).toEqual([1]);
    setLightFree(true);
    run(1);
    expect(pulses.length).toBeGreaterThan(0);
  });

  it('restarts the fire when the same hut is torched again', () => {
    const { fx, emits, run } = harness();
    fx.handleEvent(burning(1));
    run(HUT_FIRE_BURN_SECONDS + 1);
    fx.handleEvent(burning(1));
    emits.length = 0;
    run(3);
    expect(emits.some((e) => e.kind === 'flame')).toBe(true);
    expect(fx.burning()).toEqual([1]);
  });

  it('burns several huts at once, each on its own clock', () => {
    const { fx, run } = harness();
    fx.handleEvent(burning(1));
    run(5);
    fx.handleEvent(burning(2, MUDFIN_HUTS[0].x, MUDFIN_HUTS[0].z));
    run(HUT_FIRE_TOTAL_SECONDS - 5 + 0.1);
    expect(fx.burning()).toEqual([2]);
  });

  it('thins the fire under reduced motion, and clear() puts every fire out', () => {
    const a = harness();
    a.fx.handleEvent(burning(1));
    a.fx.update(3, false);
    const b = harness();
    b.fx.handleEvent(burning(1));
    b.fx.update(3, true);
    const full = a.emits.find((e) => e.kind === 'flame')?.rate ?? 0;
    const thin = b.emits.find((e) => e.kind === 'flame')?.rate ?? 0;
    expect(thin).toBeCloseTo(full / 2, 6);
    b.fx.clear();
    expect(b.fx.burning()).toEqual([]);
  });

  it('still burns a hut the table does not list, at a mushroom hut size', () => {
    const { fx, emits } = harness();
    fx.handleEvent(burning(9, 500, 500));
    fx.update(1);
    expect(emits[0].body.radius).toBeGreaterThan(0.5);
    expect(emits[0].body.height).toBeGreaterThan(1.5);
  });
});

describe('HutFireFx smoke plume', () => {
  it('hands each burning hut to the plume painter with its age, for the frame camera', () => {
    const { fx, paints, run } = harness(true);
    fx.prepareDraw(1, 2);
    expect(paints).toEqual([]);
    fx.handleEvent(burning(1));
    run(4);
    fx.prepareDraw(-60, 240);
    const last = paints[paints.length - 1];
    expect(last.camX).toBe(-60);
    expect(last.camZ).toBe(240);
    expect(last.ages).toHaveLength(1);
    expect(last.ages[0]).toBeCloseTo(4, 6);
  });

  it('keeps a hut smoking after its flames, until the last puff is gone', () => {
    const { fx, emits, paints, run, mesh } = harness(true);
    fx.handleEvent(burning(1));
    run(HUT_FIRE_TOTAL_SECONDS + 1);
    // the flame particles are done, the plume is not
    emits.length = 0;
    run(0.5);
    expect(emits).toEqual([]);
    expect(fx.burning()).toEqual([1]);
    fx.prepareDraw(0, 0);
    expect(paints[paints.length - 1].ages).toHaveLength(1);
    // then it goes out, and the painter is told once to hide
    run(HUT_SMOKE_END_SECONDS - HUT_FIRE_TOTAL_SECONDS);
    expect(fx.burning()).toEqual([]);
    fx.prepareDraw(0, 0);
    expect(paints[paints.length - 1].ages).toEqual([]);
    expect(mesh.visible).toBe(false);
    const painted = paints.length;
    fx.prepareDraw(0, 0);
    expect(paints.length).toBe(painted);
  });

  it('clears the plume with the fires', () => {
    const { fx, paints, run, mesh } = harness(true);
    fx.handleEvent(burning(1));
    run(3);
    fx.prepareDraw(0, 0);
    expect(mesh.visible).toBe(true);
    fx.clear();
    expect(paints[paints.length - 1].ages).toEqual([]);
    expect(mesh.visible).toBe(false);
  });
});
