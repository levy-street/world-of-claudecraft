import { describe, expect, it } from 'vitest';
import { soulRendPrewarmTargets } from '../src/render/characters/soul_rend_prewarm_core';

const mesh = (name: string, weaponVfxMesh = false) => ({ name, userData: { weaponVfxMesh } });

describe('soulRendPrewarmTargets', () => {
  it('takes every snapshotted surface, in the snapshot order', () => {
    const chest = mesh('chest');
    const hair = mesh('hair');
    const targets = soulRendPrewarmTargets({
      originalMaterials: [
        [chest, 'chest-mat'],
        [hair, ['hair-mat', 'hair-tips']],
      ],
    });
    expect(targets).toEqual([
      { source: chest, original: 'chest-mat' },
      { source: hair, original: ['hair-mat', 'hair-tips'] },
    ]);
  });

  it('never takes the weapon VFX rig, whose materials the skin handle owns', () => {
    const chest = mesh('chest');
    const ribbon = mesh('weapon-ribbon', true);
    const targets = soulRendPrewarmTargets({
      originalMaterials: [
        [chest, 'chest-mat'],
        [ribbon, 'ribbon-mat'],
      ],
    });
    expect(targets.map((target) => target.source)).toEqual([chest]);
  });

  it('takes the far mesh, but only when it has materials to repaint', () => {
    const far = mesh('far');
    expect(
      soulRendPrewarmTargets({
        originalMaterials: [],
        farMesh: far,
        farMaterials: 'far-mat',
      }),
    ).toEqual([{ source: far, original: 'far-mat' }]);
    expect(
      soulRendPrewarmTargets({ originalMaterials: [], farMesh: far, farMaterials: null }),
    ).toEqual([]);
    expect(
      soulRendPrewarmTargets({ originalMaterials: [], farMesh: null, farMaterials: 'far-mat' }),
    ).toEqual([]);
    // The far mesh answers to the same weapon-VFX rule as the rest.
    expect(
      soulRendPrewarmTargets({
        originalMaterials: [],
        farMesh: mesh('far-vfx', true),
        farMaterials: 'far-mat',
      }),
    ).toEqual([]);
  });

  it('takes nothing from a body torn down while the prewarm waited for its idle slot', () => {
    const chest = mesh('chest');
    const far = mesh('far');
    expect(
      soulRendPrewarmTargets({
        originalMaterials: [[chest, 'chest-mat']],
        farMesh: far,
        farMaterials: 'far-mat',
        disposed: true,
      }),
    ).toEqual([]);
    // ...and the same inputs alive DO produce targets, so the empty result
    // above is the disposed arm and not an empty fixture.
    expect(
      soulRendPrewarmTargets({
        originalMaterials: [[chest, 'chest-mat']],
        farMesh: far,
        farMaterials: 'far-mat',
      }),
    ).toHaveLength(2);
  });

  it('reads a Map snapshot as happily as an array of pairs', () => {
    const chest = mesh('chest');
    const targets = soulRendPrewarmTargets({
      originalMaterials: new Map([[chest, 'chest-mat']]),
    });
    expect(targets).toEqual([{ source: chest, original: 'chest-mat' }]);
  });
});
