// Exhaust decisions: how hard each phase smokes, and the single moment the
// launch flame is allowed to fire.
//
// The flame timing is the part worth pinning. It is aimed at a transient
// INSIDE an authored take, not at a state change, so an off-by-a-phase or a
// missing latch does not throw, it just fires in the wrong place or fires
// every frame for three seconds.

import { describe, expect, it } from 'vitest';
import {
  EXHAUST_FLAME_AT,
  exhaustFlameDue,
  exhaustFlameRearms,
  exhaustSmokeRate,
  RALLYCART_EXHAUST_PORTS,
} from '../src/render/vehicle_exhaust_core';

describe('exhaustSmokeRate', () => {
  it('smokes even when parked', () => {
    // The cart idles audibly from summon onward, and parked is when a rider
    // actually looks at the back of it.
    expect(exhaustSmokeRate('idle', false, false)).toBeGreaterThan(0);
  });

  it('smokes hardest under power', () => {
    const idle = exhaustSmokeRate('idle', false, false);
    const starting = exhaustSmokeRate('starting', false, false);
    const moving = exhaustSmokeRate('moving', false, false);
    expect(starting).toBeGreaterThan(idle);
    expect(moving).toBeGreaterThan(starting);
  });

  it('trails off on the winddown rather than cutting', () => {
    const moving = exhaustSmokeRate('moving', false, false);
    const stopping = exhaustSmokeRate('stopping', false, false);
    expect(stopping).toBeLessThan(moving);
    expect(stopping).toBeGreaterThan(0);
  });

  it('thins out in reverse, which is a lower gear and not a second launch', () => {
    expect(exhaustSmokeRate('moving', true, false)).toBeLessThan(
      exhaustSmokeRate('moving', false, false),
    );
  });

  it('works harder turning on the spot than sitting still', () => {
    // Load, but going nowhere: the same reasoning that gives a pivot the
    // reverse pitch bend.
    expect(exhaustSmokeRate('idle', false, true)).toBeGreaterThan(
      exhaustSmokeRate('idle', false, false),
    );
  });
});

describe('exhaustFlameDue', () => {
  it('fires at the transient inside the windup, not at its start', () => {
    expect(exhaustFlameDue('starting', 0, false)).toBe(false);
    expect(exhaustFlameDue('starting', EXHAUST_FLAME_AT - 0.01, false)).toBe(false);
    expect(exhaustFlameDue('starting', EXHAUST_FLAME_AT, false)).toBe(true);
  });

  it('is one event per launch, not a burst every frame after it', () => {
    // Without the latch this would keep firing for the remaining three seconds
    // of the windup take.
    expect(exhaustFlameDue('starting', 1.2, true)).toBe(false);
  });

  it('never fires outside the windup', () => {
    for (const phase of ['idle', 'moving', 'stopping'] as const) {
      expect(exhaustFlameDue(phase, 9, false)).toBe(false);
    }
  });

  it('re-arms once the engine leaves the windup, so the next launch fires', () => {
    expect(exhaustFlameRearms('starting')).toBe(false);
    expect(exhaustFlameRearms('moving')).toBe(true);
    expect(exhaustFlameRearms('idle')).toBe(true);
  });

  it('lands inside the take rather than past the end of it', () => {
    // The windup take runs 3.63s. A flame offset past that would never fire,
    // because the phase moves to 'moving' the instant the clip ends.
    expect(EXHAUST_FLAME_AT).toBeGreaterThan(0);
    expect(EXHAUST_FLAME_AT).toBeLessThan(3.63);
  });
});

describe('RALLYCART_EXHAUST_PORTS', () => {
  it('has four pipes in two symmetric pairs', () => {
    expect(RALLYCART_EXHAUST_PORTS).toHaveLength(4);
    const left = RALLYCART_EXHAUST_PORTS.filter((p) => p.x < 0);
    const right = RALLYCART_EXHAUST_PORTS.filter((p) => p.x > 0);
    expect(left).toHaveLength(2);
    expect(right).toHaveLength(2);
  });

  it('vents them all from the back of the car, at the same height', () => {
    for (const p of RALLYCART_EXHAUST_PORTS) {
      expect(p.z).toBeLessThan(-0.4);
      expect(p.y).toBeCloseTo(0.114, 2);
    }
  });

  it('leans density onto the rough pipes and off the clean one', () => {
    // Cosmetic and deliberate: three of the four tubes are rough, so they
    // smoke harder to break up their outline. The clean one stays visible.
    const clean = RALLYCART_EXHAUST_PORTS[0];
    for (const p of RALLYCART_EXHAUST_PORTS.slice(1)) {
      expect(p.weight).toBeGreaterThan(clean.weight);
    }
  });
});
