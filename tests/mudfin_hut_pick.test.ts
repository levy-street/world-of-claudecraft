// The torchable mudfin huts' click volume (src/render/mudfin_hut_pick.ts): the
// `ground_murloc_hut` entity is only an invisible cylinder over the props.ts
// scenery hut, through the one pick-only table, so a click on the hut walls
// reaches it and no quest crate or loot sparkle is built inside the hut.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildMudfinHutPickBody, MUDFIN_HUT_PICK } from '../src/render/mudfin_hut_pick';
import { buildPickOnlyObjectBody, isPickOnlyObjectTemplate } from '../src/render/pick_only_objects';
import { MUDFIN_HUT_MODELS, MUDFIN_HUT_TEMPLATE_ID } from '../src/sim/mudfin_huts';

describe('mudfin hut pick volume', () => {
  it('is registered as a pick-only template', () => {
    expect(isPickOnlyObjectTemplate(MUDFIN_HUT_TEMPLATE_ID)).toBe(true);
    expect(isPickOnlyObjectTemplate('ground_lost_caravan_goods')).toBe(false);
  });

  it('covers the wider wall of both hut designs, up to the taller roof', () => {
    const specs = Object.values(MUDFIN_HUT_MODELS);
    for (const spec of specs) expect(MUDFIN_HUT_PICK.radius).toBeGreaterThan(spec.radius);
    expect(MUDFIN_HUT_PICK.radius).toBeLessThan(Math.max(...specs.map((s) => s.radius)) + 0.5);
    expect(MUDFIN_HUT_PICK.height).toBe(Math.max(...specs.map((s) => s.height)));
  });

  it('builds an invisible, shadowless cylinder standing on the ground', () => {
    const { group, height } = buildPickOnlyObjectBody(MUDFIN_HUT_TEMPLATE_ID);
    expect(height).toBe(MUDFIN_HUT_PICK.height);
    expect(group.children).toHaveLength(1);
    const proxy = group.children[0] as THREE.Mesh;
    expect(proxy.visible).toBe(false);
    expect(proxy.castShadow).toBe(false);
    proxy.geometry.computeBoundingBox();
    const box = proxy.geometry.boundingBox as THREE.Box3;
    expect(box.max.x).toBeCloseTo(MUDFIN_HUT_PICK.radius, 6);
    expect(proxy.position.y + box.min.y).toBeCloseTo(0, 6);
    expect(proxy.position.y + box.max.y).toBeCloseTo(MUDFIN_HUT_PICK.height, 6);
    // a fresh body per entity: no shared group between two huts
    expect(buildMudfinHutPickBody().group).not.toBe(group);
  });

  it('is hit by a ray aimed at the hut wall', () => {
    const { group } = buildMudfinHutPickBody();
    group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 1.5, 10), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObject(group, true).length).toBeGreaterThan(0);
  });
});
