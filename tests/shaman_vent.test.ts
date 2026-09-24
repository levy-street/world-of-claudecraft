import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { shamanCast, shamanHeal } from '../src/render/ability_vfx/shaman_events';
import { drawShamanThunderVent } from '../src/render/ability_vfx/shaman_vent';

function fixture() {
  const points = Array.from({ length: 12 }, () => new THREE.Vector3());
  const paths: number[][][] = [];
  const fx = {
    anchorOf: vi.fn(() => ({ x: 11, y: 2, z: -7 })),
    pathRibbon: vi.fn((_c, _w, _d, fill) => {
      const count = fill(points);
      paths.push(points.slice(0, count).map((p) => p.toArray()));
    }),
    flipbookAt: vi.fn(),
    burstAt: vi.fn(),
    shakeAt: vi.fn(),
    abilityAudio: vi.fn(),
    sequenceShamanRelease: vi.fn(),
    sequenceShamanContact: vi.fn(),
    sequenceInstant: vi.fn(),
  };
  const host = {
    fx: fx as unknown as AbilityVfxFx,
    variant: (id: string) => (id === 'unleash_weapon' ? 'unleash_weapon_water' : id),
    tier: () => 0,
    gesture: vi.fn(),
  };
  return { fx, host, paths };
}

describe('authoritative Shaman vent presentation', () => {
  it.each([undefined, 0, 4, 6])('does not infer a full bank from level %s', (level) => {
    const h = fixture();
    expect(
      shamanCast(h.host, {
        sourceId: 1,
        targetId: 2,
        school: 'nature',
        ability: 'earth_shock',
        fx: 'procSurge',
        level,
      }),
    ).toBe(true);
    expect(h.fx.flipbookAt).not.toHaveBeenCalled();
    expect(h.host.gesture).not.toHaveBeenCalled();
    expect(h.fx.sequenceShamanRelease).not.toHaveBeenCalled();
  });
  it('adds one return stroke on the actual recipient without another cast or damage callback', () => {
    const h = fixture();
    shamanCast(h.host, {
      sourceId: 1,
      targetId: 2,
      school: 'nature',
      ability: 'earth_shock',
      fx: 'procSurge',
      level: 5,
    });
    expect(h.fx.anchorOf).toHaveBeenCalledExactlyOnceWith(2, 0.55);
    expect(h.fx.flipbookAt).toHaveBeenCalledTimes(1);
    expect(h.fx.flipbookAt.mock.calls[0].slice(0, 3)).toEqual([11, 2, -7]);
    expect(h.paths).toHaveLength(3);
    for (const path of h.paths) expect(path[0]).toEqual([11, 2, -7]);
    expect(h.paths.flat(2).every(Number.isFinite)).toBe(true);
    expect(h.fx.sequenceShamanContact).not.toHaveBeenCalled();
    expect(h.fx.sequenceShamanRelease).not.toHaveBeenCalled();
    expect(h.host.gesture).not.toHaveBeenCalled();
  });
  it('keeps a field vent at its authoritative point even without a caster view', () => {
    const h = fixture();
    drawShamanThunderVent(h.host.fx, -25, 0.85, 13, 4.8, 1);
    expect(h.fx.anchorOf).not.toHaveBeenCalled();
    expect(h.paths).toHaveLength(2);
    for (const path of h.paths) expect(path[0]).toEqual([-25, 0.85, 13]);
    expect(h.fx.flipbookAt).toHaveBeenCalledTimes(1);
  });
  it("owns only Lifespring's tagged companion while one real heal keeps its water", () => {
    const h = fixture();
    shamanHeal(h.host, { sourceId: 1, targetId: 2, ability: 'Unleash Weapon', amount: 200 });
    expect(
      shamanCast(h.host, {
        sourceId: 1,
        targetId: 2,
        school: 'nature',
        ability: 'unleash_weapon',
        fx: 'echoBurst',
      }),
    ).toBe(true);
    expect(h.fx.sequenceShamanContact).toHaveBeenCalledTimes(1);
    expect(h.fx.sequenceShamanRelease).not.toHaveBeenCalled();
    expect(h.host.gesture).not.toHaveBeenCalled();
    expect(
      shamanCast(h.host, { sourceId: 1, targetId: 2, school: 'nature', fx: 'echoBurst' }),
    ).toBe(false);
  });
});
