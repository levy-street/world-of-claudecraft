import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import {
  shamanEarthContact,
  shamanEarthImpactKind,
  shamanFaultwakeOpening,
} from '../src/render/ability_vfx/shaman_earth_impacts';
import type { ShamanComposition } from '../src/render/shaman_vfx_specs';
import { SHAMAN_VFX_FULL_SPECS } from '../src/render/shaman_vfx_specs';

function draw(id: string, action?: ShamanComposition['action'], tier = 0, opening = false) {
  const paths: { points: THREE.Vector3[]; width: number; life: number }[] = [];
  const at = { x: 10, y: 2.7, z: 20 };
  const host = {
    groundYAt: (x: number, z: number) => x * 0.015 + z * 0.01,
    fragmentsAt: vi.fn<NonNullable<SequencerHost['fragmentsAt']>>(),
    burstAt: vi.fn<SequencerHost['burstAt']>(),
    flipbookAt: vi.fn<SequencerHost['flipbookAt']>(),
    bakedAt: vi.fn<NonNullable<SequencerHost['bakedAt']>>(),
    decalXZ: vi.fn<SequencerHost['decalXZ']>(),
    pathRibbon: vi.fn<SequencerHost['pathRibbon']>((_color, width, life, fill) => {
      const buffer = Array.from({ length: 12 }, () => new THREE.Vector3());
      const count = fill(buffer);
      paths.push({ points: buffer.slice(0, count), width, life });
    }),
  };
  const spec = SHAMAN_VFX_FULL_SPECS[id];
  const shape = { ...spec.shaman!, ...(action ? { action, radius: 1.25, weight: 0.75 } : {}) };
  (opening ? shamanFaultwakeOpening : shamanEarthContact)(
    host as unknown as SequencerHost,
    { abilityId: id, sourceX: 10, sourceZ: 16, tier } as SeqSlot,
    shape,
    at,
    0x72796b,
    0xe0d7a4,
  );
  return { host, paths, at, shape };
}

const casts = [
  'earth_shock',
  'earthquake',
  'earthbind',
  'stormstrike_earth',
  'unleash_weapon_earth',
  'rockbiter_weapon',
];
describe('Shaman earth force and material identities', () => {
  it('breaks Jolt into thin opposing flakes and fine ejecta without a giant lead wedge', () => {
    const h = draw('earth_shock');
    const rock = h.host.fragmentsAt.mock.calls;
    expect(rock).toHaveLength(4);
    // The renderer multiplies size by force. Keep the SAME physical size ceiling
    // while allowing the heavy flakes to fly more slowly close to the ground.
    expect(
      Math.max(
        ...rock.map(
          (call) =>
            Math.min(5, Math.max(0.25, call[11] ?? Infinity)) *
            Math.min(1.6, Math.max(0.3, call[6])),
        ),
      ),
    ).toBeLessThanOrEqual(3.2 * 1.6);
    for (const call of rock.slice(0, 2)) {
      expect(call[6]).toBeLessThanOrEqual(1.01);
      expect(call[11]).toBeLessThanOrEqual(5);
      expect(call[2] - h.host.groundYAt(call[1], call[3])).toBeCloseTo(
        call === rock[0] ? 0.09 : 0.12,
      );
    }
    expect((rock[0][11] ?? 0) * rock[0][6]).toBeCloseTo(1.6 * 3.15, 8);
    expect((rock[1][11] ?? 0) * rock[1][6]).toBeGreaterThanOrEqual(1.35 * 2.3);
    expect(rock.every((call) => (call[13] ?? Infinity) <= 0.6)).toBe(true);
    const fine = rock.filter((call) => (call[11] ?? Infinity) <= 1.4);
    expect(fine.reduce((n, call) => n + call[5], 0)).toBeGreaterThanOrEqual(8);
    expect(rock.some((call) => call[7] < -0.5)).toBe(true);
    expect(rock.some((call) => call[7] > 0.5)).toBe(true);
    expect(new Set(rock.map((call) => call[9])).size).toBe(4);
    expect(h.host.flipbookAt.mock.calls[0][3]).toBe(h.shape.radius * 5.25);
  });

  it('gives Faultwake uneven shearing shoulders, small splinters and separated trailing powder', () => {
    const h = draw('earthquake');
    const rock = h.host.fragmentsAt.mock.calls;
    expect(rock.reduce((n, call) => n + call[5], 0)).toBe(9);
    expect(rock.some((call) => (call[11] ?? Infinity) <= 1)).toBe(true);
    expect(rock.every((call) => (call[13] ?? Infinity) <= 0.6)).toBe(true);
    expect(new Set(rock.map((call) => call[4])).size).toBeGreaterThanOrEqual(3);
    const powder = h.host.burstAt.mock.calls.filter((call) => call[6] === 'shaman_mist');
    expect(powder).toHaveLength(2);
    expect(powder[0][0]).not.toBe(powder[1][0]);
    expect(powder[0][8]).toBeLessThan(powder[1][8] ?? -Infinity);
    expect(h.paths).toHaveLength(1);
    expect(Math.abs(h.paths[0].points[11].x - h.paths[0].points[0].x)).toBeGreaterThan(
      h.shape.radius,
    );
    expect(h.host.flipbookAt.mock.calls[0][3]).toBe(h.shape.radius * 1.85);
  });

  it.each([
    ['earth_shock', 12, 7, 102, 44],
    ['stormstrike_earth', 11, 6, 65, 29],
    ['unleash_weapon_earth', 14, 7, 83, 36],
  ] as const)(
    '%s preserves both existing per-cast density budgets',
    (id, fullRock, lowRock, fullDust, lowDust) => {
      for (const tier of [0, 1]) {
        const h = draw(id, undefined, tier);
        expect(h.host.fragmentsAt.mock.calls.reduce((n, c) => n + c[5], 0)).toBeLessThanOrEqual(
          tier ? lowRock : fullRock,
        );
        expect(h.host.burstAt.mock.calls.reduce((n, c) => n + c[4], 0)).toBeLessThanOrEqual(
          tier ? lowDust : fullDust,
        );
      }
    },
  );

  it.each([0, 1])(
    'separates Faultwake crack contact from its climax within one cast budget at tier %s',
    (tier) => {
      const opening = draw('earthquake', undefined, tier, true);
      const climax = draw('earthquake', undefined, tier);
      expect(opening.host.flipbookAt).not.toHaveBeenCalled();
      expect(opening.host.fragmentsAt).not.toHaveBeenCalled();
      expect(opening.host.bakedAt).not.toHaveBeenCalled();
      expect(opening.paths).toHaveLength(2);
      expect(opening.host.burstAt.mock.calls.length).toBeGreaterThan(0);
      for (const path of opening.paths) {
        expect(path.life).toBeGreaterThanOrEqual(0.38);
        for (const p of path.points) {
          expect(p.y).toBeCloseTo(opening.host.groundYAt(p.x, p.z) + 0.065);
          expect(Math.hypot(p.x - opening.at.x, p.z - opening.at.z)).toBeLessThan(
            opening.shape.radius * 0.5,
          );
        }
      }
      expect(climax.host.flipbookAt.mock.calls[0][3]).toBe(8 * 1.85);
      expect(
        climax.host.fragmentsAt.mock.calls.reduce((count, call) => count + call[5], 0),
      ).toBeLessThanOrEqual(tier === 0 ? 9 : 6);
      expect(opening.paths.length + climax.paths.length).toBeLessThanOrEqual(3);
      const particles = [...opening.host.burstAt.mock.calls, ...climax.host.burstAt.mock.calls];
      expect(particles.reduce((count, call) => count + call[4], 0)).toBeLessThanOrEqual(
        tier === 0 ? 75 : 33,
      );
    },
  );

  it.each(['earth_shock', 'stormstrike_earth', 'unleash_weapon_earth'])(
    '%s resolves a fast granular hit then displaced slower dust without increasing the impact footprint',
    (id) => {
      const h = draw(id);
      const grains = h.host.burstAt.mock.calls.filter((call) => call[6] === 'shaman_grit');
      const powder = h.host.burstAt.mock.calls.filter((call) => call[6] === 'shaman_mist');
      expect(grains).toHaveLength(2);
      expect(powder).toHaveLength(1);
      expect(grains[0][8] ?? 0).toBe(0);
      expect(grains[1][8]).toBeGreaterThan(0);
      expect(powder[0][8]).toBeGreaterThan(grains[1][8] ?? Infinity);
      expect(powder[0][7]).toBeGreaterThan(grains[1][7] ?? Infinity);
      expect(powder[0].slice(0, 3)).not.toEqual(grains[0].slice(0, 3));
      expect(h.host.fragmentsAt.mock.calls.every((c) => (c[13] ?? Infinity) <= 1.35)).toBe(true);
      expect(h.host.flipbookAt.mock.calls[0][3]).toBeGreaterThanOrEqual(h.shape.radius * 5);
      expect(h.host.burstAt.mock.calls.reduce((n, c) => n + c[4], 0)).toBeLessThanOrEqual(
        id === 'earth_shock' ? 102 : id === 'stormstrike_earth' ? 65 : 83,
      );
    },
  );

  it.each(casts)('%s stays inside fixed shared primitive budgets at both detail tiers', (id) => {
    const high = draw(id),
      low = draw(id, undefined, 1);
    for (const h of [high, low]) {
      expect(h.host.fragmentsAt.mock.calls.reduce((n, c) => n + c[5], 0)).toBeLessThanOrEqual(16);
      expect(h.paths.length).toBeLessThanOrEqual(4);
      expect(h.host.flipbookAt.mock.calls.length).toBeLessThanOrEqual(1);
      expect(h.host.bakedAt.mock.calls.length).toBeLessThanOrEqual(1);
      expect(
        h.paths.flatMap((p) => p.points).every((p) => p.toArray().every(Number.isFinite)),
      ).toBe(true);
      expect(h.host.burstAt.mock.calls.every((c) => (c[8] ?? 0) <= 0.2)).toBe(true);
    }
    const count = (h: typeof high) => h.host.burstAt.mock.calls.reduce((n, c) => n + c[4], 0);
    expect(count(low)).toBeLessThan(count(high));
  });

  it('distinguishes a rising Jolt, a shearing strike, and a forward heavy crush', () => {
    const jolt = draw('earth_shock'),
      cleave = draw('stormstrike_earth'),
      ram = draw('unleash_weapon_earth');
    expect(jolt.host.flipbookAt.mock.calls[0][5]).toBe('shaman_dust');
    // Jolt now throws a low lateral pressure fan beneath its rising core.
    expect(jolt.host.flipbookAt.mock.calls[0][9]).toBeCloseTo(1.24);
    expect(jolt.host.bakedAt.mock.calls[0][13]).toBeGreaterThanOrEqual(2.5);
    expect(jolt.paths.some((p) => p.points.at(-1)!.y - p.points[0].y > 2)).toBe(true);
    expect(cleave.host.flipbookAt.mock.calls[0][5]).toBe('shaman_earth_cleave');
    expect(cleave.host.flipbookAt.mock.calls[0][8]).toBeLessThan(-0.6);
    expect(cleave.host.flipbookAt.mock.calls[0][9]).toBeGreaterThan(1.5);
    expect(cleave.paths.every((p) => p.life < 0.2)).toBe(true);
    expect(cleave.host.fragmentsAt.mock.calls.every((c) => c[13]! <= 0.55)).toBe(true);
    expect(ram.host.flipbookAt.mock.calls[0][9]).toBeGreaterThan(1.2);
    expect(ram.host.flipbookAt.mock.calls[0][5]).toBe('shaman_earth_ram');
    expect(ram.paths.every((p) => p.points.at(-1)!.z > p.points[0].z + 3)).toBe(true);
    for (const h of [jolt, cleave, ram])
      expect(h.host.decalXZ).toHaveBeenCalledWith(
        10,
        20,
        expect.any(Number),
        expect.any(Number),
        'shaman_fracture',
        0.72,
      );
  });

  it('keeps capture seams low and converging while Faultwake spreads over its field', () => {
    const grip = draw('earthbind'),
      fault = draw('earthquake');
    expect(grip.host.flipbookAt).not.toHaveBeenCalled();
    for (const { points } of grip.paths) {
      const distance = (p: THREE.Vector3) => Math.hypot(p.x - grip.at.x, p.z - grip.at.z);
      expect(distance(points.at(-1)!)).toBeLessThan(distance(points[0]) * 0.4);
      for (const p of points) expect(p.y - grip.host.groundYAt(p.x, p.z)).toBeLessThan(0.11);
    }
    const centres = fault.host.fragmentsAt.mock.calls.map((c) => c[1]);
    expect(Math.max(...centres) - Math.min(...centres)).toBeGreaterThan(fault.shape.radius * 0.8);
    expect(fault.host.flipbookAt.mock.calls[0][9]).toBeGreaterThan(1.4);
    expect(fault.host.flipbookAt.mock.calls[0][5]).toBe('shaman_earth_fault');
  });

  it.each(['earthquake', 'earthbind'])('%s victim contacts cannot replay the area cast', (id) => {
    expect(shamanEarthImpactKind(id, 'jolt')).toBe('aftershock');
    const h = draw(id, 'jolt');
    expect(h.host.fragmentsAt.mock.calls.reduce((n, c) => n + c[5], 0)).toBe(4);
    expect(h.paths).toHaveLength(1);
    expect(h.host.flipbookAt.mock.calls[0][3]).toBeLessThan(4);
    expect(h.host.bakedAt).not.toHaveBeenCalled();
    expect(h.host.decalXZ).not.toHaveBeenCalled();
  });

  it('assembles minerals at the weapon without an invented ground hit', () => {
    const h = draw('rockbiter_weapon');
    expect(h.host.flipbookAt).not.toHaveBeenCalled();
    expect(h.host.bakedAt).not.toHaveBeenCalled();
    expect(h.host.decalXZ).not.toHaveBeenCalled();
    for (const p of h.paths.flatMap((p) => p.points)) {
      expect(Math.abs(p.y - h.at.y)).toBeLessThanOrEqual(0.25);
      expect(Math.hypot(p.x - h.at.x, p.z - h.at.z)).toBeLessThanOrEqual(0.7);
    }
    expect(h.host.fragmentsAt.mock.calls[0].slice(1, 4)).toEqual([h.at.x, h.at.y, h.at.z]);
    expect(h.host.burstAt.mock.calls.every((c) => c[1] === h.at.y)).toBe(true);
  });
});
