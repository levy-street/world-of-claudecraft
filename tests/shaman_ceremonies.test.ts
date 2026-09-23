import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { shamanCeremony } from '../src/render/ability_vfx/shaman_ceremonies';
import { SHAMAN_VFX_FULL_SPECS } from '../src/render/shaman_vfx_specs';

const activations = [
  'bloodlust',
  'stoneward',
  'lightning_shield',
  'ghost_wolf',
  'ancestor_return',
  'elemental_trance',
  'elemental_mastery',
  'primal_exaltation_storm',
  'primal_exaltation_earth',
  'primal_exaltation_fire',
  'primal_exaltation_wind',
  'primal_exaltation_water',
];

function capture(id: string, tier = 0, facing = 0) {
  const at = { x: 13, y: 27, z: -8 };
  const floor = 4;
  const paths: Vector3[][] = [];
  const host = {
    facingAt: () => facing,
    groundYAt: vi.fn(() => floor),
    pathRibbon: vi.fn<SequencerHost['pathRibbon']>((_color, _width, _life, fill) => {
      const points = Array.from({ length: 24 }, () => new Vector3());
      paths.push(points.slice(0, fill(points)));
      return true;
    }),
    burstAt: vi.fn<SequencerHost['burstAt']>(),
    flipbookAt: vi.fn<SequencerHost['flipbookAt']>(),
    fragmentsAt: vi.fn<NonNullable<SequencerHost['fragmentsAt']>>(),
    waterVolume: vi.fn<NonNullable<SequencerHost['waterVolume']>>(),
    bakedAt: vi.fn<NonNullable<SequencerHost['bakedAt']>>(),
  };
  const slot = { abilityId: id, spec: SHAMAN_VFX_FULL_SPECS[id], tier, casterId: 5 } as SeqSlot;
  shamanCeremony(host as unknown as SequencerHost, slot, at, 0x458bad, 0xb4dfde);
  return { host, paths, at, floor };
}

describe('Shaman activation compositions', () => {
  it.each(activations)(
    '%s stays inside the shared pool allowance and reduces distant particles',
    (id) => {
      const full = capture(id);
      const lite = capture(id, 1);
      for (const { host, paths } of [full, lite]) {
        expect(paths.length).toBeLessThanOrEqual(4);
        expect(host.flipbookAt.mock.calls.length).toBeLessThanOrEqual(1);
        expect(host.waterVolume.mock.calls.length).toBeLessThanOrEqual(2);
        expect(host.burstAt.mock.calls.length).toBeGreaterThan(0);
        expect(host.burstAt.mock.calls.every((call) => call[6].startsWith('shaman_'))).toBe(true);
        expect(host.burstAt.mock.calls.some((call) => (call[8] ?? 0) > 0)).toBe(true);
        expect(paths.flat().every((point) => point.toArray().every(Number.isFinite))).toBe(true);
      }
      const count = (h: typeof full) =>
        h.host.burstAt.mock.calls.reduce((sum, call) => sum + call[4], 0);
      expect(count(lite)).toBeLessThan(count(full));
    },
  );

  it('Battlecall opens a broad overhead canopy while leaving the central body unobscured by ribbons', () => {
    const { paths, at, floor } = capture('bloodlust');
    const points = paths.flat();
    expect(
      Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
    ).toBeGreaterThan(10);
    expect(Math.max(...points.map((p) => p.y)) - floor).toBeGreaterThan(4);
    expect(points.every((p) => Math.abs(p.x - at.x) > 0.75)).toBe(true);
    expect(paths.every((path) => path[0].distanceTo(path[path.length - 1]) > 2)).toBe(true);
  });

  it('all Primal specializations gather water, fire and air before the lightning crown', () => {
    for (const element of ['earth', 'fire', 'water', 'storm', 'wind']) {
      const h = capture(`primal_exaltation_${element}`);
      expect(h.host.waterVolume.mock.calls).toHaveLength(2);
      expect(h.host.waterVolume.mock.calls.every(([from, to]) => to.y > from.y)).toBe(true);
      const kinds = h.host.burstAt.mock.calls.map((call) => call[6]);
      expect(kinds).toContain('shaman_embers');
      expect(kinds).toContain('shaman_runoff');
      expect(kinds).toContain('shaman_mist');
      const colors = h.host.pathRibbon.mock.calls.map((call) => call[0]);
      expect(colors).toContain(0xffa148);
      expect(colors).toContain(0x84eddf);
      expect(colors).toContain(0xc8ece7);
      expect(h.host.flipbookAt).not.toHaveBeenCalled();
    }
    const water = capture('primal_exaltation_water');
    const storm = capture('primal_exaltation_storm');
    expect(water.host.waterVolume.mock.calls[0][4]).toBeGreaterThan(
      storm.host.waterVolume.mock.calls[0][4],
    );
  });

  it('revival ascends in separate open trails at the supplied recipient position', () => {
    const { paths, at, floor, host } = capture('ancestor_return');
    expect(paths).toHaveLength(4);
    expect(host.groundYAt).toHaveBeenCalledWith(at.x, at.z);
    for (const path of paths) {
      expect(path[0].y).toBeLessThan(floor + 0.5);
      expect(path[path.length - 1].y).toBeGreaterThan(floor + 4);
      expect(path.every((p) => Math.abs(p.x - at.x) >= 1)).toBe(true);
      expect(path.every((p, index) => index === 0 || p.y > path[index - 1].y)).toBe(true);
    }
    expect(host.flipbookAt).not.toHaveBeenCalled();
    expect(host.fragmentsAt).not.toHaveBeenCalled();
  });

  it.each(['stoneward', 'lightning_shield'])(
    '%s remains a concise protective gesture below the face',
    (id) => {
      const { paths, floor, host } = capture(id);
      expect(Math.max(...paths.flat().map((p) => p.y)) - floor).toBeLessThanOrEqual(2);
      if (id === 'stoneward') expect(host.flipbookAt).not.toHaveBeenCalled();
      else {
        expect(host.flipbookAt).toHaveBeenCalledOnce();
        expect(host.flipbookAt.mock.calls[0][5]).toBe('shaman_ward_charge');
        expect(host.flipbookAt.mock.calls[0][7]).toBeLessThanOrEqual(0.4);
      }
      expect(host.pathRibbon.mock.calls.every((call) => call[2] <= 0.4)).toBe(true);
    },
  );

  it('rotates the authored silhouette and particle emitters with wearer facing', () => {
    const base = capture('bloodlust');
    const turned = capture('bloodlust', 0, Math.PI / 2);
    for (let p = 0; p < base.paths.length; p++) {
      for (let i = 0; i < base.paths[p].length; i++) {
        const a = base.paths[p][i],
          b = turned.paths[p][i];
        expect(b.x - base.at.x).toBeCloseTo(a.z - base.at.z);
        expect(b.z - base.at.z).toBeCloseTo(-(a.x - base.at.x));
        expect(b.y).toBe(a.y);
      }
    }
    const a = base.host.burstAt.mock.calls[0],
      b = turned.host.burstAt.mock.calls[0];
    expect(b[0] - base.at.x).toBeCloseTo(a[2] - base.at.z);
    expect(b[2] - base.at.z).toBeCloseTo(-(a[0] - base.at.x));
  });
});
