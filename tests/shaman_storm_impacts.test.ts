import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { shamanStormContact } from '../src/render/ability_vfx/shaman_storm_impacts';
import type { ShamanComposition } from '../src/render/shaman_vfx_specs';

const shape: ShamanComposition = {
  element: 'storm',
  action: 'bolt',
  radius: 2.9,
  height: 4.2,
  weight: 1.55,
};
function draw(abilityId = 'lightning_bolt', targetId = 2, tier = 0, at = { x: 0, y: 1, z: 0 }) {
  const paths: {
    color: number;
    width: number;
    life: number;
    points: number[][];
    preserve: boolean | undefined;
  }[] = [];
  const flipbookAt = vi.fn(),
    burstAt = vi.fn();
  const host = {
    groundYAt: () => 0,
    pathRibbon: (color, width, life, fill, _brushed, _motion, preserve) => {
      const values: number[][] = [];
      const points = Array.from({ length: 12 }, (_, i) => ({
        set: (x: number, y: number, z: number) => {
          values[i] = [x, y, z];
        },
      }));
      expect(fill(points)).toBe(12);
      paths.push({ color, width, life, points: values, preserve });
    },
    flipbookAt,
    burstAt,
  } as Pick<SequencerHost, 'pathRibbon' | 'flipbookAt' | 'burstAt'>;
  const slot = { abilityId, targetId, casterId: 1, tier, sourceX: -4, sourceZ: -2 } as SeqSlot;
  shamanStormContact(host as SequencerHost, slot, shape, at, 0x63baff, 0xe4faff);
  return { paths, sheets: flipbookAt.mock.calls, bursts: burstAt.mock.calls };
}

describe('Shaman receiving lightning composition', () => {
  it('attaches asymmetric branches to the lead, preserves a large footprint and expires the hot skeleton fast', () => {
    const h = draw();
    expect(h.paths).toHaveLength(3);
    expect(h.paths[0].points[0]).toEqual([0, 1, 0]);
    expect(h.paths[1].points[0]).toEqual(h.paths[0].points[3]);
    expect(h.paths[2].points[0]).toEqual(h.paths[0].points[6]);
    expect(h.paths[0].width).toBeGreaterThan(h.paths[1].width * 2);
    for (const path of h.paths) {
      expect(path.life).toBeLessThanOrEqual(0.17);
      expect(path.width).toBeLessThanOrEqual(0.18);
      expect(path.preserve).toBe(true);
      expect(path.points.flat().every(Number.isFinite)).toBe(true);
    }
    expect(Math.hypot(...h.paths[0].points[11])).toBeGreaterThan(shape.radius * 1.7);
    expect(h.sheets).toHaveLength(1);
    expect(h.sheets[0][3]).toBeGreaterThanOrEqual(shape.radius * 4.3);
    expect(h.sheets[0][3] * h.sheets[0][9]).toBeGreaterThanOrEqual(shape.radius * 4.3);
    expect(h.sheets[0][7]).toBeLessThanOrEqual(0.36);
  });
  it('varies recipient fractures and Arc Bolt versus Skybranch without consuming ambient randomness', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('ambient RNG');
    });
    try {
      const bolt = draw();
      expect(draw()).toEqual(bolt);
      expect(draw('lightning_bolt', 3).paths).not.toEqual(bolt.paths);
      const chain = draw('chain_lightning');
      expect(chain.paths).not.toEqual(bolt.paths);
      expect(chain.sheets[0][3]).toBeGreaterThan(bolt.sheets[0][3]);
      expect(chain.sheets[0][5]).toBe('shaman_skybranch');
      expect(bolt.sheets[0][5]).toBe('shaman_storm');
      expect(chain.paths[0].points[11]).toEqual([0, 1, 0]);
      expect(chain.paths[0].points[0][1]).toBeGreaterThan(7);
      expect(chain.paths[1].points[11][1]).toBeLessThan(chain.paths[1].points[0][1]);
    } finally {
      random.mockRestore();
    }
  });
  it.each([0, 1])(
    'Skybranch descends from the sky into each actual recipient at tier %s',
    (tier) => {
      for (const targetId of [2, 3, 17]) {
        const at = { x: targetId * 3, y: 2.7, z: -9 };
        const h = draw('chain_lightning', targetId, tier, at);
        const leader = h.paths[0].points;
        expect(leader[11]).toEqual([at.x, at.y, at.z]);
        expect(leader[0][1] - at.y).toBeGreaterThan(6);
        expect(Math.hypot(leader[0][0] - at.x, leader[0][2] - at.z)).toBeLessThan(shape.radius);
        expect(leader.every((p, i) => i === 0 || p[1] < leader[i - 1][1])).toBe(true);
        for (let k = 1; k < h.paths.length; k++) {
          const branch = h.paths[k].points;
          expect(branch[0]).toEqual(leader[k === 1 ? 3 : 6]);
          expect(branch[0][1]).toBeGreaterThan(at.y + 2);
          expect(branch[11][1]).toBeLessThan(branch[0][1]);
          expect(branch.every((p) => p[1] > at.y)).toBe(true);
        }
        expect(h.sheets[0].slice(0, 3)).toEqual([at.x, at.y, at.z]);
        expect(h.bursts[0].slice(0, 3)).toEqual([at.x, at.y, at.z]);
        const arc = draw('lightning_bolt', targetId, tier, at).paths[0].points;
        expect(arc[0]).toEqual([at.x, at.y, at.z]);
        expect(Math.hypot(arc[11][0] - at.x, arc[11][2] - at.z)).toBeGreaterThan(shape.radius * 2);
      }
    },
  );
  it('preserves the white atlas core and splits across the receiver rather than making an upward crown', () => {
    const h = draw();
    const sheetTint = new THREE.Color(h.sheets[0][4]);
    // These are linear channels, exactly the multiplier the shader receives.
    // A blue sRGB tint can look pale in code yet erase most of the white core.
    expect(Math.min(sheetTint.r, sheetTint.g, sheetTint.b)).toBeGreaterThan(0.85);
    const leadTint = new THREE.Color(h.paths[0].color);
    expect(Math.min(leadTint.r, leadTint.g, leadTint.b)).toBeGreaterThan(0.85);
    const lead = h.paths[0].points[11];
    const counter = h.paths[1].points[11];
    expect(lead[0] * counter[0] + lead[2] * counter[2]).toBeLessThan(0);
    expect(lead[1] - 1).toBeLessThan(Math.hypot(lead[0], lead[2]) * 0.3);
    expect(h.bursts[2].slice(0, 3)).toEqual([0, 1, 0]);
  });
  it('keeps the four-recipient composition bounded and protects already active paths', () => {
    const chain = [2, 3, 4, 5].map((id) => draw('chain_lightning', id));
    expect(chain.flatMap((h) => h.paths)).toHaveLength(12);
    expect(chain.flatMap((h) => h.sheets)).toHaveLength(4);
    const lite = draw('chain_lightning', 2, 1);
    expect(lite.paths).toHaveLength(2);
    expect(lite.sheets).toHaveLength(1);
    expect(lite.sheets[0][3]).toBe(chain[0].sheets[0][3]);
    expect(lite.bursts.reduce((sum, b) => sum + b[4], 0)).toBeLessThan(
      chain[0].bursts.reduce((sum, b) => sum + b[4], 0),
    );
    expect(draw('chain_lightning', 2, 2)).toEqual({ paths: [], sheets: [], bursts: [] });
  });
  it('keeps one dominant contact and small ion breakup inside the initial 200 milliseconds', () => {
    const h = draw();
    expect(h.bursts).toHaveLength(3);
    expect(h.bursts[0][8] ?? 0).toBe(0);
    for (const burst of h.bursts) {
      expect(burst[6]).toBe('shaman_sparks');
      expect(burst[8] ?? 0).toBeLessThanOrEqual(0.2);
    }
    expect(h.bursts[2][4]).toBeLessThan(h.bursts[0][4] / 3);
    expect(h.bursts[2][7]).toBeLessThan(0.1);
  });
  it('fits four contacts plus their live links in the actual pool and cleans up under reduced motion', () => {
    const texture = new THREE.Texture();
    const pool = new AbilityVfxRibbons(new THREE.Scene(), (_id, _height, out) => out ?? null, {
      ribbon: texture,
      noise: texture,
    } as AbilityVfxTextures);
    const paths = (pool as unknown as { arcs: { active: boolean }[] }).arcs;
    const host = {
      groundYAt: () => 0,
      pathRibbon: (color, width, life, fill, brushed, motion, preserve) =>
        pool.spawnPath(color, width, life, fill, brushed, motion, preserve),
      burstAt: vi.fn(),
      flipbookAt: vi.fn(),
    } as Pick<SequencerHost, 'pathRibbon' | 'burstAt' | 'flipbookAt'>;
    try {
      const capacity = paths.length;
      for (let i = 0; i < 4; i++) {
        expect(
          pool.spawnPath(
            0x63baff,
            0.1,
            0.2,
            (points) => {
              points[0].set(i, 1, 0);
              points[1].set(i + 1, 1, 0);
              return 2;
            },
            false,
            null,
            true,
          ),
        ).toBe(true);
        shamanStormContact(
          host as SequencerHost,
          {
            abilityId: 'chain_lightning',
            targetId: i + 2,
            casterId: 1,
            tier: 0,
            sourceX: -4,
            sourceZ: -2,
          } as SeqSlot,
          shape,
          { x: i * 3, y: 1, z: 0 },
          0x63baff,
          0xe4faff,
        );
      }
      expect(paths.filter((p) => p.active)).toHaveLength(16);
      pool.update(0.02, new THREE.Vector3(0, 3, 10), true);
      expect(paths.filter((p) => p.active)).toHaveLength(16);
      pool.update(0.5, new THREE.Vector3(0, 3, 10), true);
      expect(paths.filter((p) => p.active)).toHaveLength(0);
      expect(paths).toHaveLength(capacity);
    } finally {
      pool.dispose();
      texture.dispose();
    }
  });
});
