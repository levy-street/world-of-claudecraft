import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { drawIronguard } from '../src/render/ability_vfx/ironguard';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { drawWarriorShield } from '../src/render/ability_vfx/warrior_shield';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';

type Cast = 'quake' | 'shield';

/** These are the rendered strips, not merely successful admissions: a later
 * successful admission can evict a previously accepted primary footprint. */
function draw(casts: Cast[]) {
  const texture = new THREE.Texture();
  const ribbons = new AbilityVfxRibbons(new THREE.Scene(), () => null, {
    ribbon: texture,
    noise: texture,
  } as AbilityVfxTextures);
  const pathRibbon = vi.fn<SequencerHost['pathRibbon']>(
    (color, width, duration, fill, brushed, motion, preserve, priority, sweep, follow) =>
      ribbons.spawnPath(
        color,
        width,
        duration,
        fill,
        brushed,
        motion,
        preserve,
        follow,
        priority,
        sweep,
      ),
  );
  const host = new Proxy(
    {
      anchorOf: (id: number, fraction: number, out: { x: number; y: number; z: number }) =>
        Object.assign(out, { x: id === 1 ? 0 : 14, y: fraction * 2, z: id === 3 ? 2 : 0 }),
      facingAt: () => 0,
      groundYAt: () => 0,
      crestAt: vi.fn(() => false),
      bakedAt: vi.fn(() => false),
      weaponFace: vi.fn<NonNullable<SequencerHost['weaponFace']>>((_id, _hand, out, normal) => {
        Object.assign(out, { x: 14, y: 1.4, z: 0.65 });
        Object.assign(normal, { x: 0, y: 0, z: 1 });
        return true;
      }),
      pathRibbon,
    },
    {
      get(target, key) {
        if (!(key in target)) Reflect.set(target, key, vi.fn());
        return Reflect.get(target, key);
      },
    },
  ) as unknown as SequencerHost;
  try {
    for (const cast of casts) {
      const id = cast === 'quake' ? 'thunder_clap' : 'shield_slam';
      const slot = {
        abilityId: id,
        casterId: cast === 'quake' ? 1 : 2,
        targetId: 3,
        tier: 0,
        componentOutcomes: 1,
        physicalSecondary: false,
        spec: WARRIOR_VFX_FULL_SPECS[id],
      } as SeqSlot;
      expect(
        cast === 'quake' ? drawIronguard(host, slot, 0) : drawWarriorShield(host, slot, 0),
      ).toBe(true);
    }
    ribbons.update(0.02, new THREE.Vector3(8, 8, 20), false);
    const geo = (ribbons as unknown as { geo: THREE.BufferGeometry }).geo;
    const index = geo.getIndex();
    if (!index) throw new Error('Missing ribbon indices');
    const used = Math.max(...Array.from(index.array).slice(0, geo.drawRange.count)) + 1;
    // Each authored brushed path packs its 34 samples into two two-sided strips.
    const verticesPerPath = 34 * 2 * 2;
    expect(used % verticesPerPath).toBe(0);
    const positions = geo.getAttribute('position').array;
    const chunks = Array.from({ length: used / verticesPerPath }, (_, i) =>
      Array.from(positions).slice(i * verticesPerPath * 3, (i + 1) * verticesPerPath * 3),
    );
    if (casts.includes('shield')) {
      const receiving = vi.mocked(host.flipbookAt).mock.calls.filter((call) => call[0] === 14);
      expect(receiving).toHaveLength(1);
      expect(receiving[0][2]).toBeCloseTo(1.72);
      expect(receiving[0][3]).toBe(4.6);
      expect(receiving[0][5]).toBe('contact_crush');
      expect(host.contact).toHaveBeenCalledExactlyOnceWith(
        2,
        3,
        'physical-crush',
        expect.any(Number),
        'shield_slam',
        0,
      );
    }
    return chunks;
  } finally {
    ribbons.dispose();
    texture.dispose();
  }
}

it.each([
  ['quake', 'shield'],
  ['shield', 'quake'],
] as Cast[][])(
  'preserves complete cold Quake and primary Shieldcrack when %s precedes %s',
  (...casts) => {
    const quake = draw(['quake']);
    const shield = draw(['shield']);
    expect(quake).toHaveLength(12);
    // The first four paths outline the real shield and its transfer to the body;
    // the next pair is the primary receiving crease. Side creases are decorative.
    expect(shield.length).toBeGreaterThanOrEqual(6);
    const required = [...quake, ...shield.slice(0, 6)];
    const crowded = draw(casts);
    for (const [i, path] of required.entries())
      expect(
        crowded.some(
          (actual) => actual.length === path.length && actual.every((v, j) => v === path[j]),
        ),
        `Primary ${i < 12 ? 'Quake branch' : 'Shieldcrack strip'} ${i < 12 ? i : i - 12} was evicted`,
      ).toBe(true);
  },
);
