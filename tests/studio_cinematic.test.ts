import { describe, expect, it } from 'vitest';
import { StudioCinematicDirector } from '../src/vfx_studio/cinematic_director';
import { CINEMATIC_SCORES, cinematicEnvelope } from '../src/vfx_studio/cinematic_score_core';

describe('studio camera performances', () => {
  it('restores the exact user camera after a shot or an immediate opt-out', () => {
    const camera = { camDist: 15, camPitch: 0.6, camYaw: 3, punchFov: () => {} };
    const director = new StudioCinematicDirector();
    director.event({ type: 'castStart', entityId: 1, ability: 'pyroblast', time: 2 }, 1, camera);
    director.update(1, camera, true);
    expect(camera.camDist).toBeLessThan(15);
    camera.camYaw += 0.3; // User framing input remains underneath the additive stroke.
    director.update(0.1, camera, false);
    expect(camera.camDist).toBeCloseTo(15);
    expect(camera.camPitch).toBeCloseTo(0.6);
    expect(camera.camYaw).toBeCloseTo(3.3);
    director.clear(camera);
    expect(camera.camYaw).toBeCloseTo(3.3);
  });
  it('ignores other players and throttles a chain to one contact stroke', () => {
    const lens: number[] = [],
      camera = { camDist: 15, camPitch: 0.6, camYaw: 3, punchFov: (v: number) => lens.push(v) };
    const director = new StudioCinematicDirector();
    const contact = {
      type: 'heal2' as const,
      sourceId: 2,
      targetId: 3,
      amount: 50,
      crit: false,
      ability: 'Cascading Mend',
      abilityId: 'chain_heal',
    };
    director.event(contact, 1, camera);
    expect(lens).toHaveLength(0);
    director.event({ ...contact, sourceId: 1 }, 1, camera);
    expect(lens).toHaveLength(0);
    director.moment('chain_heal', 'impact', 2, 1, camera);
    expect(lens).toHaveLength(0);
    director.moment('chain_heal', 'impact', 1, 1, camera);
    director.moment('chain_heal', 'impact', 1, 1, camera);
    expect(lens).toHaveLength(1);
    for (let i = 0; i < 40; i++) director.update(0.05, camera, true);
    expect(camera.camDist).toBeCloseTo(15);
    expect(camera.camPitch).toBeCloseTo(0.6);
    expect(camera.camYaw).toBeCloseTo(3);
  });
  it('authors distinct school scores and bounded envelopes with silent endpoints', () => {
    expect(new Set(Object.values(CINEMATIC_SCORES).map((s) => JSON.stringify(s))).size).toBe(8);
    for (const phase of ['release', 'impact'] as const) {
      expect(cinematicEnvelope(phase, 1, 1)).toBe(0);
      for (let i = 0; i <= 100; i++)
        expect(cinematicEnvelope(phase, i / 100, 1)).toBeGreaterThanOrEqual(0);
    }
  });
});
