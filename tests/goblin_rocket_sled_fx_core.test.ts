import { describe, expect, it } from 'vitest';
import {
  GOBLIN_ROCKET_SLED_FX_IDLE,
  GOBLIN_ROCKET_SLED_FX_VISIBLE_MIN,
  type GoblinRocketSledFxPlan,
  type GoblinRocketSledFxState,
  stepGoblinRocketSledFx,
} from '../src/render/goblin_rocket_sled_fx_core';

const plan = (): GoblinRocketSledFxPlan => ({
  visible: false,
  intensity: 0,
  outerLength: 0,
  outerWidth: 0,
  innerLength: 0,
  opacity: 0,
  flutter: 0,
  particleStrength: 0,
  smokeStrength: 0,
  reverseBlend: 0,
  ignition: 0,
  ignitionAge: -1,
  ignitionBurst: false,
  thrustSpool: 0,
  airborneOverburn: 0,
  jetHunt: 0,
  takeoffBurst: false,
  landingBurst: false,
  stationaryPressure: 0,
});

const state = (overrides: Partial<GoblinRocketSledFxState> = {}): GoblinRocketSledFxState => ({
  intensity: 0,
  reverseBlend: 0,
  ignitionAge: -1,
  ignitionCooldown: 0,
  nonForwardTime: 0,
  forwardAge: 0,
  fullBoreLatched: false,
  wasForward: false,
  wasAirborne: false,
  airborneBlend: 0,
  landingAge: -1,
  ...overrides,
});

function step(
  state: GoblinRocketSledFxState,
  out: GoblinRocketSledFxPlan,
  overrides: Partial<Parameters<typeof stepGoblinRocketSledFx>[1]> = {},
): GoblinRocketSledFxPlan {
  return stepGoblinRocketSledFx(
    state,
    {
      dt: 1 / 60,
      time: 0,
      mounted: true,
      moving: false,
      backwards: false,
      airborne: false,
      speed: 0,
      reducedMotion: false,
      ...overrides,
    },
    out,
  );
}

describe('Goblin Rocket Sled exhaust envelope', () => {
  it('keeps the stopped pilot below the visible-plume threshold', () => {
    const fxState = state();
    const out = plan();
    for (let i = 0; i < 360; i++) step(fxState, out, { time: i / 60 });
    expect(fxState.intensity).toBeCloseTo(GOBLIN_ROCKET_SLED_FX_IDLE, 5);
    expect(fxState.intensity).toBeLessThan(GOBLIN_ROCKET_SLED_FX_VISIBLE_MIN);
    expect(out.visible).toBe(false);
    expect(out.particleStrength).toBe(0);
  });

  it('spools into a bright bounded moving plume with particles', () => {
    const fxState = state();
    const out = plan();
    for (let i = 0; i < 120; i++) {
      step(fxState, out, { moving: true, speed: 10, time: i / 60 });
    }
    expect(out.visible).toBe(true);
    expect(out.intensity).toBeGreaterThan(0.98);
    expect(out.intensity).toBeLessThanOrEqual(1);
    expect(out.outerLength).toBeGreaterThan(out.innerLength);
    expect(out.particleStrength).toBeGreaterThan(0.98);
    expect(out.smokeStrength).toBeGreaterThan(0);
  });

  it('winds down after stopping and immediately resets on dismount', () => {
    const fxState = state({ intensity: 1 });
    const out = plan();
    step(fxState, out, { moving: false, speed: 0 });
    expect(out.intensity).toBeLessThan(1);
    expect(out.intensity).toBeGreaterThan(GOBLIN_ROCKET_SLED_FX_IDLE);

    step(fxState, out, { mounted: false, moving: true, speed: 10 });
    expect(fxState.intensity).toBe(0);
    expect(out).toMatchObject({
      visible: false,
      intensity: 0,
      opacity: 0,
      particleStrength: 0,
      smokeStrength: 0,
    });
  });

  it('reduces flutter without suppressing readable combustion', () => {
    const normalState = state({ intensity: 1 });
    const reducedState = state({ intensity: 1 });
    const normal = step(normalState, plan(), {
      moving: true,
      speed: 10,
      time: 0.42,
      reducedMotion: false,
    });
    const reduced = step(reducedState, plan(), {
      moving: true,
      speed: 10,
      time: 0.42,
      reducedMotion: true,
    });
    expect(Math.abs(reduced.flutter)).toBeCloseTo(Math.abs(normal.flutter) * 0.25, 6);
    expect(reduced.visible).toBe(true);
    expect(reduced.particleStrength).toBe(normal.particleStrength);
  });

  it('is stable across common frame rates over the same elapsed time', () => {
    const run = (dt: number): number => {
      const fxState = state();
      const out = plan();
      for (let time = 0; time < 1 - 1e-9; time += dt) {
        step(fxState, out, { dt, time, moving: true, speed: 7 });
      }
      return fxState.intensity;
    };
    expect(run(1 / 30)).toBeCloseTo(run(1 / 60), 5);
    expect(run(1 / 60)).toBeCloseTo(run(1 / 120), 5);
  });

  it('crossfades to a short blue-state reverse plume with no detached trail', () => {
    const fxState = state({ intensity: 1 });
    const out = plan();
    for (let i = 0; i < 12; i++) {
      step(fxState, out, { moving: true, backwards: true, speed: 5, time: i / 60 });
    }
    expect(out.reverseBlend).toBe(1);
    expect(out.visible).toBe(true);
    expect(out.outerLength).toBeLessThan(0.5);
    expect(out.particleStrength).toBe(0);
    expect(out.smokeStrength).toBe(0);
    expect(out.opacity).toBeCloseTo(0.78, 5);
  });

  it('keeps fast small flames during spool, then fires full bore near the one-second audio hit', () => {
    const fxState = state();
    const out = plan();
    for (let i = 0; i < 8; i++) step(fxState, out);
    const initial = step(fxState, out, { moving: true, speed: 8 });
    expect(initial.ignitionBurst).toBe(false);
    expect(initial.thrustSpool).toBeCloseTo(0.16);
    const initialLength = initial.outerLength;
    for (let i = 0; i < 45; i++) step(fxState, out, { moving: true, speed: 8 });
    expect(out.ignitionBurst).toBe(false);
    expect(out.thrustSpool).toBeGreaterThan(0.5);
    expect(out.thrustSpool).toBeLessThan(0.7);
    expect(out.outerLength).toBeGreaterThan(initialLength);
    let burst: GoblinRocketSledFxPlan | null = null;
    for (let i = 0; i < 20; i++) {
      const next = step(fxState, out, { moving: true, speed: 8 });
      if (next.ignitionBurst) burst = { ...next };
    }
    expect(burst).not.toBeNull();
    expect(burst?.ignition).toBe(1);
    expect(burst?.thrustSpool).toBe(1);
    const bloomWidth = burst!.outerWidth;
    const bloomLength = burst!.outerLength;
    const next = step(fxState, out, { moving: true, speed: 8 });
    expect(next.ignitionBurst).toBe(false);
    for (let i = 0; i < 30; i++) step(fxState, out, { moving: true, speed: 8 });
    expect(out.ignition).toBe(0);
    expect(out.outerWidth).toBeLessThan(bloomWidth);
    expect(out.outerLength).toBeGreaterThan(bloomLength);
  });

  it('cancels an early spool and restarts it from small flame on re-press', () => {
    const fxState = state();
    const out = plan();
    for (let i = 0; i < 30; i++) step(fxState, out, { moving: true, speed: 8 });
    expect(out.thrustSpool).toBeGreaterThan(0.3);
    step(fxState, out, { moving: false, speed: 0 });
    expect(out.thrustSpool).toBe(0);
    expect(out.ignitionBurst).toBe(false);
    step(fxState, out, { moving: true, speed: 8 });
    expect(out.thrustSpool).toBeCloseTo(0.16);
    expect(out.ignitionBurst).toBe(false);
  });

  it('overburns on takeoff, hunts asymmetrically in flight, and coughs once on landing', () => {
    const fxState = state({ intensity: 1, forwardAge: 1, fullBoreLatched: true, wasForward: true });
    const out = plan();
    const takeoff = step(fxState, out, {
      moving: true,
      airborne: true,
      speed: 10,
      time: 0.17,
    });
    expect(takeoff.takeoffBurst).toBe(true);
    expect(takeoff.landingBurst).toBe(false);
    const takeoffLength = takeoff.outerLength;
    for (let i = 0; i < 20; i++) {
      step(fxState, out, { moving: true, airborne: true, speed: 10, time: 0.17 + i / 60 });
    }
    expect(out.takeoffBurst).toBe(false);
    expect(out.airborneOverburn).toBeGreaterThan(0.98);
    expect(Math.abs(out.jetHunt)).toBeGreaterThan(0);
    expect(out.outerLength).toBeGreaterThan(takeoffLength);
    const landing = step(fxState, out, { moving: true, airborne: false, speed: 10 });
    expect(landing.landingBurst).toBe(true);
    expect(landing.takeoffBurst).toBe(false);
    const next = step(fxState, out, { moving: true, airborne: false, speed: 10 });
    expect(next.landingBurst).toBe(false);
    expect(next.outerWidth).toBeGreaterThan(0);
  });

  it('uses compact white-gold pressure cups instead of long plumes for a standing jump', () => {
    const fxState = state();
    const out = plan();
    const takeoff = step(fxState, out, {
      moving: false,
      airborne: true,
      speed: 0,
      time: 0.13,
    });
    expect(takeoff.takeoffBurst).toBe(true);
    expect(takeoff.visible).toBe(true);
    expect(takeoff.stationaryPressure).toBeGreaterThan(0.8);
    expect(takeoff.outerLength).toBeLessThan(0.21);
    expect(takeoff.airborneOverburn).toBe(0);
    expect(takeoff.particleStrength).toBe(0);
    for (let i = 0; i < 10; i++) {
      step(fxState, out, { moving: false, airborne: true, speed: 0, time: 0.13 + i / 60 });
    }
    expect(out.takeoffBurst).toBe(false);
    expect(out.outerLength).toBeLessThan(0.21);
    const landing = step(fxState, out, { moving: false, airborne: false, speed: 0 });
    expect(landing.landingBurst).toBe(true);
    expect(landing.stationaryPressure).toBe(0);
  });
});
