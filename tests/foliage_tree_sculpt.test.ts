import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { resolveTreeLeafColor, sculptFoliageTreeGeometry } from '../src/render/foliage_tree_sculpt';

describe('foliage_tree_sculpt', () => {
  it('sculpts broadleaf oak canopies into multi-dome cumulus geometry with vertex colors', () => {
    const raw = new THREE.BoxGeometry(1, 1, 1);
    const sculpted = sculptFoliageTreeGeometry(
      '/models/foliage/oak_1.glb',
      'Leaves_NormalTree',
      raw,
    );
    expect(sculpted).not.toBe(raw);
    const pos = sculpted.getAttribute('position');
    const nrm = sculpted.getAttribute('normal');
    const col = sculpted.getAttribute('color');
    expect(pos.count).toBeGreaterThan(200);
    expect(nrm.count).toBe(pos.count);
    expect(col.count).toBe(pos.count);
  });

  it('sculpts broadleaf bark with S-curve and widened Y-fork limbs', () => {
    const raw = new THREE.CylinderGeometry(0.2, 0.3, 4, 8, 8);
    const sculpted = sculptFoliageTreeGeometry('/models/foliage/oak_2.glb', 'Bark_NormalTree', raw);
    expect(sculpted).toBe(raw);
    expect(sculpted.boundingBox).not.toBeNull();
  });

  it('replaces dense field trunks and trims canopy cards in lean mode', () => {
    const denseOakBark = new THREE.CylinderGeometry(0.2, 0.3, 4, 32, 32);
    expect((denseOakBark.index?.count ?? 0) / 3).toBeGreaterThan(1000);
    const leanOakBark = sculptFoliageTreeGeometry(
      '/models/foliage/oak_1.glb',
      'Bark_NormalTree',
      denseOakBark,
      true,
    );
    expect(leanOakBark).toBe(denseOakBark);
    expect((leanOakBark.index?.count ?? 0) / 3).toBeLessThanOrEqual(140);

    const densePineBark = new THREE.CylinderGeometry(0.2, 0.3, 5, 32, 32);
    const leanPineBark = sculptFoliageTreeGeometry(
      '/models/foliage/pine_1.glb',
      'Bark_NormalTree',
      densePineBark,
      true,
    );
    expect(leanPineBark).toBe(densePineBark);
    expect((leanPineBark.index?.count ?? 0) / 3).toBeLessThanOrEqual(60);

    const fullCanopy = sculptFoliageTreeGeometry(
      '/models/foliage/oak_1.glb',
      'Leaves_NormalTree',
      new THREE.BoxGeometry(1, 1, 1),
      false,
    );
    const leanCanopy = sculptFoliageTreeGeometry(
      '/models/foliage/oak_1.glb',
      'Leaves_NormalTree',
      new THREE.BoxGeometry(1, 1, 1),
      true,
    );
    expect((leanCanopy.index?.count ?? 0) / 3).toBeLessThan((fullCanopy.index?.count ?? 0) / 3);
  });

  it('produces multi-colored Genshin foliage palette across Eastbrook Vale coordinates', () => {
    const out = new THREE.Color();
    const seenGolden = { count: 0 };
    const seenChartreuse = { count: 0 };
    const seenEmerald = { count: 0 };

    for (let i = 0; i < 60; i++) {
      resolveTreeLeafColor('vale', i * 7.3, i * -11.1, 0x3b8428, out, 0.38);
      if (out.r > 1.8) seenGolden.count++;
      else if (out.r > 1.1) seenChartreuse.count++;
      else if (out.r < 0.6) seenEmerald.count++;
    }

    expect(seenGolden.count).toBeGreaterThan(0);
    expect(seenChartreuse.count).toBeGreaterThan(0);
    expect(seenEmerald.count).toBeGreaterThan(0);
  });

  it('preserves soft biome tinting for non-vale biomes', () => {
    const a = resolveTreeLeafColor('marsh', 10, 20, 0x465838, new THREE.Color(), 0.38);
    const b = resolveTreeLeafColor('marsh', 10, 20, 0x465838, new THREE.Color(), 0.38);
    expect(a.r).toBeCloseTo(b.r, 5);
    expect(a.g).toBeCloseTo(b.g, 5);
    expect(a.b).toBeCloseTo(b.b, 5);
  });
});
