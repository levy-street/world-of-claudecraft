import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { objectDisplayName } from '../src/render/entity_labels';
import { buildSoulwell, disposeSoulwellVisual, SOULWELL_VISUAL_SPEC } from '../src/render/soulwell';
import { createGroundObject } from '../src/sim/entity';
import { setLanguage } from '../src/ui/i18n';

describe('Soulwell presentation', () => {
  it('keeps the authored three-pillar, three-stone silhouette', () => {
    expect(SOULWELL_VISUAL_SPEC).toMatchObject({
      pillarCount: 3,
      stoneCount: 3,
      footprintRadius: 1.45,
    });
    const { group } = buildSoulwell(42);
    expect(group.name).toBe('soulwell_42');
    expect(group.userData.soulwellStones).toBeInstanceOf(THREE.Group);
    expect(group.userData.soulwellStones.children).toHaveLength(3);
  });

  it('disposes every owned per-instance material exactly once on interest churn', () => {
    const { group } = buildSoulwell(43);
    const ownedMaterials = group.userData.soulwellOwnedMaterials as THREE.Material[];
    // basinMaterial plus the three energy-ring materials: the only materials
    // this one soulwell instance actually owns.
    expect(ownedMaterials).toHaveLength(4);
    const disposals = ownedMaterials.map((material) => vi.spyOn(material, 'dispose'));

    disposeSoulwellVisual(group);
    disposeSoulwellVisual(group);

    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('never disposes the surfaceMat-derived materials shared across soulwells', () => {
    // baseMat/stoneMat/edgeMat/runeMat/soulMat come from the module-level
    // surfaceMat dedupe cache (see gfx.ts): two soulwells built with the same
    // colors get back the SAME material instances. Disposing one soulwell
    // must never poison the material a second, still-live soulwell is using.
    const { group: groupA } = buildSoulwell(60);
    const { group: groupB } = buildSoulwell(61);

    const collectMaterials = (root: THREE.Object3D): Set<THREE.Material> => {
      const materials = new Set<THREE.Material>();
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of meshMaterials) materials.add(material);
      });
      return materials;
    };

    const materialsA = collectMaterials(groupA);
    const materialsB = collectMaterials(groupB);
    const sharedMaterials = [...materialsA].filter((material) => materialsB.has(material));
    const uniqueToA = [...materialsA].filter((material) => !materialsB.has(material));

    // Five shared materials: baseMat, stoneMat, edgeMat, runeMat, soulMat.
    expect(sharedMaterials).toHaveLength(5);
    // Four per-instance materials: basinMaterial plus the three energy rings.
    expect(uniqueToA).toHaveLength(4);

    const sharedDisposeSpies = sharedMaterials.map((material) => vi.spyOn(material, 'dispose'));
    const ownedDisposeSpies = uniqueToA.map((material) => vi.spyOn(material, 'dispose'));

    disposeSoulwellVisual(groupA);

    for (const spy of sharedDisposeSpies) expect(spy).not.toHaveBeenCalled();
    for (const spy of ownedDisposeSpies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('uses the localized ability name for the world-object nameplate', () => {
    setLanguage('en');
    const well = createGroundObject(44, 'soulwell', 'Soulwell', { x: 0, y: 0, z: 0 });
    well.templateId = 'soulwell';
    expect(objectDisplayName(well)).toBe('Soulwell');
  });
});
