import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { objectDisplayName } from '../src/render/entity_labels';
import { GRAND_PORTAL_VISUAL_SPEC } from '../src/render/grand_portal';
import { HELLGATE_VISUAL_SPEC } from '../src/render/hellgate';
import {
  buildSummonedObject,
  disposeSummonedObjectVisual,
  isSummonedObjectItem,
  SUMMONED_OBJECT_VISUALS,
  syncSummonedObjectVisual,
} from '../src/render/summoned_objects';
import { OWNED_MATERIALS_KEY } from '../src/render/summoned_prop_kit';
import { createGroundObject } from '../src/sim/entity';
import { setLanguage } from '../src/ui/i18n';

// Sibling of tests/soulwell_visual.test.ts for the registry that now fronts the
// Soulwell, the Grand Portal and the Hellgate props. Materials from surfaceMat
// are a global dedupe cache, so the shared-vs-owned split is the load-bearing
// contract: an interest-churn dispose must never poison a still-live sibling.

function collectMaterials(root: THREE.Object3D): Set<THREE.Material> {
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) materials.add(material);
  });
  return materials;
}

describe('summoned object visual registry', () => {
  it('registers exactly the three summoned party props by objectItemId', () => {
    expect(Object.keys(SUMMONED_OBJECT_VISUALS).sort()).toEqual([
      'grand_portal',
      'hellgate',
      'soulwell',
    ]);
    for (const id of ['soulwell', 'grand_portal', 'hellgate']) {
      expect(isSummonedObjectItem(id), id).toBe(true);
    }
    expect(isSummonedObjectItem('mailbox')).toBe(false);
    expect(isSummonedObjectItem(undefined)).toBe(false);
    expect(isSummonedObjectItem('__proto__')).toBe(false);
  });

  it('names each root by item and entity id, reports its height, builds deterministically', () => {
    const portal = buildSummonedObject('grand_portal', 7);
    expect(portal.group.name).toBe('grand_portal_7');
    expect(portal.height).toBe(GRAND_PORTAL_VISUAL_SPEC.height);
    const gate = buildSummonedObject('hellgate', 9);
    expect(gate.group.name).toBe('hellgate_9');
    expect(gate.height).toBe(HELLGATE_VISUAL_SPEC.height);
    expect(gate.group.userData.hellgateEmbers.children).toHaveLength(
      HELLGATE_VISUAL_SPEC.emberCount,
    );
    expect(buildSummonedObject('soulwell', 11).group.name).toBe('soulwell_11');
    const a = buildSummonedObject('hellgate', 21).group.userData.hellgateEmbers as THREE.Group;
    const b = buildSummonedObject('hellgate', 21).group.userData.hellgateEmbers as THREE.Group;
    const c = buildSummonedObject('hellgate', 22).group.userData.hellgateEmbers as THREE.Group;
    const positions = (g: THREE.Group) => g.children.map((e) => e.position.toArray().join(','));
    expect(positions(a)).toEqual(positions(b));
    expect(positions(a)).not.toEqual(positions(c));
  });

  it.each(['grand_portal', 'hellgate'] as const)(
    '%s disposes each owned material exactly once across a double dispose',
    (itemId) => {
      const { group: groupA } = buildSummonedObject(itemId, 60);
      const { group: groupB } = buildSummonedObject(itemId, 61);
      const materialsA = collectMaterials(groupA);
      const materialsB = collectMaterials(groupB);
      const shared = [...materialsA].filter((material) => materialsB.has(material));
      const owned = [...materialsA].filter((material) => !materialsB.has(material));
      // Both props keep their surfaceMat stone and rune materials shared and own
      // only the additive swirl/ember MeshBasicMaterials.
      expect(shared.length).toBeGreaterThanOrEqual(3);
      expect(owned.length).toBeGreaterThanOrEqual(4);
      for (const material of owned) expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect(new Set(groupA.userData[OWNED_MATERIALS_KEY] as THREE.Material[])).toEqual(
        new Set(owned),
      );

      const sharedSpies = shared.map((material) => vi.spyOn(material, 'dispose'));
      const ownedSpies = owned.map((material) => vi.spyOn(material, 'dispose'));
      disposeSummonedObjectVisual(groupA);
      disposeSummonedObjectVisual(groupA);
      for (const spy of sharedSpies) expect(spy).not.toHaveBeenCalled();
      for (const spy of ownedSpies) expect(spy).toHaveBeenCalledTimes(1);
    },
  );

  it('sync animates the swirl, embers and light without throwing', () => {
    for (const itemId of ['soulwell', 'grand_portal', 'hellgate']) {
      const { group } = buildSummonedObject(itemId, 5);
      expect(() => syncSummonedObjectVisual(itemId, group, 1.5, 5)).not.toThrow();
      expect(() => syncSummonedObjectVisual(itemId, group, 12.25, 5)).not.toThrow();
    }
    const { group } = buildSummonedObject('hellgate', 5);
    const ember = group.userData.hellgateEmbers.children[0] as THREE.Object3D;
    const before = ember.position.y;
    syncSummonedObjectVisual('hellgate', group, 1.0, 5);
    const at1 = ember.position.y;
    syncSummonedObjectVisual('hellgate', group, 1.5, 5);
    expect(at1).not.toBe(before);
    expect(ember.position.y).not.toBe(at1);
    const portal = buildSummonedObject('grand_portal', 5).group;
    const light = portal.userData.grandPortalLight as THREE.PointLight;
    const base = light.intensity;
    syncSummonedObjectVisual('grand_portal', portal, 0.7, 5);
    expect(light.intensity).not.toBe(base);
    // An unregistered item id, or a root no entry owns, is ignored, never a throw.
    expect(() => syncSummonedObjectVisual('mailbox', portal, 1, 5)).not.toThrow();
    expect(() => disposeSummonedObjectVisual(new THREE.Group())).not.toThrow();
  });

  it('labels the Hellgate by its ability name and the Grand Portal by its object name', () => {
    setLanguage('en');
    const gate = createGroundObject(44, 'hellgate', 'Hellgate', { x: 0, y: 0, z: 0 });
    gate.templateId = 'hellgate';
    expect(objectDisplayName(gate)).toBe('Hellgate');
    const portal = createGroundObject(45, 'grand_portal', 'Grand Portal', { x: 0, y: 0, z: 0 });
    portal.templateId = 'grand_portal';
    expect(objectDisplayName(portal)).toBe('Grand Portal');
  });
});
