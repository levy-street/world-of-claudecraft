import { describe, expect, it } from 'vitest';
import {
  createEnvironmentBlend,
  createEnvironmentMapTransition,
  dampedValue,
  easedFogFar,
  easedFogNear,
  SKY_ENVIRONMENT_RESPONSE,
  stepEnvironmentBlend,
  stepEnvironmentMapTransition,
  ZONE_ENVIRONMENT_RESPONSE,
} from '../src/render/environment_transition_core';

type Realm = 'vale' | 'marsh' | 'peaks';

function stepFor(seconds: number, fps: number, step: (dt: number) => void): void {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) step(1 / fps);
}

describe('environment transition core', () => {
  it('eases zone atmosphere over several seconds and stays frame-rate independent', () => {
    let at30 = 0;
    let at120 = 0;
    stepFor(2, 30, (dt) => {
      at30 = dampedValue(at30, 1, dt, ZONE_ENVIRONMENT_RESPONSE);
    });
    stepFor(2, 120, (dt) => {
      at120 = dampedValue(at120, 1, dt, ZONE_ENVIRONMENT_RESPONSE);
    });

    expect(at30).toBeCloseTo(at120, 10);
    expect(at30).toBeGreaterThan(0.7);
    expect(at30).toBeLessThan(0.85);

    stepFor(3, 60, (dt) => {
      at30 = dampedValue(at30, 1, dt, ZONE_ENVIRONMENT_RESPONSE);
    });
    expect(at30).toBeGreaterThan(0.96);
  });

  it('eases an atmospheric fog reduction but clamps immediately for unbuilt ground', () => {
    const atmospheric = easedFogFar(700, 165, 850, 1 / 60);
    expect(atmospheric).toBeGreaterThan(690);
    expect(atmospheric).toBeLessThan(700);

    const residencyClamped = easedFogFar(700, 700, 120, 1 / 60);
    expect(residencyClamped).toBe(120);
    expect(easedFogNear(75, 75, residencyClamped, 1 / 60)).toBe(66);
  });

  it('finishes the visible sky endpoint before handing off to the next pair', () => {
    const state = createEnvironmentBlend<Realm>({ from: 'vale', to: 'marsh', t: 0.72 });
    const target = { from: 'marsh' as const, to: 'peaks' as const, t: 0.35 };

    stepEnvironmentBlend(state, target, 1 / 60, SKY_ENVIRONMENT_RESPONSE);
    expect(state.from).toBe('vale');
    expect(state.to).toBe('marsh');
    expect(state.t).toBeGreaterThan(0.72);

    let handedOffAt = -1;
    for (let frame = 0; frame < 600; frame++) {
      stepEnvironmentBlend(state, target, 1 / 60, SKY_ENVIRONMENT_RESPONSE);
      if (state.from === 'marsh' && state.to === 'peaks') {
        handedOffAt = frame;
        break;
      }
    }

    expect(handedOffAt).toBeGreaterThan(0);
    expect(state.t).toBe(0);
    stepFor(1, 60, (dt) => {
      stepEnvironmentBlend(state, target, dt, SKY_ENVIRONMENT_RESPONSE);
    });
    expect(state.t).toBeGreaterThan(0);
    expect(state.t).toBeLessThan(target.t);
  });

  it('cross-fades a teleport between unrelated skies instead of replacing the dome', () => {
    const state = createEnvironmentBlend<Realm>({ from: 'vale', to: 'vale', t: 0 });
    const target = { from: 'peaks' as const, to: 'peaks' as const, t: 0 };

    stepEnvironmentBlend(state, target, 1 / 60, SKY_ENVIRONMENT_RESPONSE);
    expect(state).toMatchObject({ from: 'vale', to: 'peaks' });
    expect(state.t).toBe(0);

    stepFor(1, 60, (dt) => {
      stepEnvironmentBlend(state, target, dt, SKY_ENVIRONMENT_RESPONSE);
    });
    expect(state.t).toBeGreaterThan(0.45);
    expect(state.t).toBeLessThan(0.65);
  });

  it('fades IBL down before swapping maps, then restores the new realm gradually', () => {
    const state = createEnvironmentMapTransition<Realm>('vale', 0.22);
    let swap: Realm | null = null;

    stepFor(0.5, 60, (dt) => {
      swap ??= stepEnvironmentMapTransition(state, 'marsh', 0.22, dt);
    });
    expect(swap).toBeNull();
    expect(state.intensity).toBeGreaterThan(0.22 * 0.16);

    stepFor(0.75, 60, (dt) => {
      swap ??= stepEnvironmentMapTransition(state, 'marsh', 0.22, dt);
    });
    expect(swap).toBe('marsh');
    expect(state.current).toBe('marsh');
    expect(state.intensity).toBeLessThan(0.22 * 0.2);

    stepFor(1, 60, (dt) => {
      stepEnvironmentMapTransition(state, 'marsh', 0.22, dt);
    });
    expect(state.intensity).toBeGreaterThan(0.1);
    expect(state.intensity).toBeLessThan(0.18);
  });
});
