// The renderer's transient point-light pool (src/render/light_pulses.ts): a talent flash
// steals the dimmest live light when the pool is full, while an ambient flicker
// (pulseIfFree, a burning mudfin hut) only ever takes a free one, so it can never cut a
// talent moment short.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LightPulses, lightPulsePoolSize } from '../src/render/light_pulses';

describe('LightPulses.pulseIfFree', () => {
  it('lights a free light, and never steals a live one once the pool is full', () => {
    const pulses = new LightPulses(new THREE.Scene());
    const cap = lightPulsePoolSize();
    expect(cap).toBeGreaterThan(0);
    const at = new THREE.Vector3(1, 2, 3);
    for (let i = 0; i < cap; i++) expect(pulses.pulseIfFree(at, 'fire', 5, 1, 9)).toBe(true);
    pulses.update(0.1);
    const lit = pulses.lights.map((light) => [light.position.x, light.intensity]);
    for (const [, intensity] of lit) expect(intensity).toBeGreaterThan(0);
    // full: the flicker is simply skipped, every live light untouched
    expect(pulses.pulseIfFree(new THREE.Vector3(50, 0, 50), 'fire', 9, 1, 9)).toBe(false);
    expect(pulses.lights.map((light) => [light.position.x, light.intensity])).toEqual(lit);
    // a talent flash still steals one
    pulses.pulse(new THREE.Vector3(50, 0, 50), 'arcane');
    expect(pulses.lights.some((light) => light.position.x === 50)).toBe(true);
    // and once the pulses fade, the flicker lights again, lifted into the light's place
    pulses.update(2);
    expect(pulses.pulseIfFree(at, 'fire', 5, 0.4, 11)).toBe(true);
    const flicker = pulses.lights.find((light) => light.distance === 11);
    expect(flicker?.position.y).toBeCloseTo(at.y + 1.1, 6);
  });
});
