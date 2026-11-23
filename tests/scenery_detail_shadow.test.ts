import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { preserveSceneryShadow } from '../src/render/scenery_detail_shadow';

describe('scenery colour detail leaves the shadow representation unchanged', () => {
  it('uses original indices during shadows and restores reduced indices for colour', () => {
    const full = new THREE.SphereGeometry(2, 16, 8);
    const reduced = full.clone();
    reduced.setIndex([0, 1, 2]);
    const mesh = new THREE.Mesh(reduced, new THREE.MeshStandardMaterial());
    const before = vi.fn(),
      after = vi.fn();
    mesh.onBeforeShadow = before;
    mesh.onAfterShadow = after;
    const index = reduced.index;
    const restore = preserveSceneryShadow(mesh, full, 1);
    const args = [null, mesh, null, null, reduced, null, null] as unknown as Parameters<
      typeof mesh.onBeforeShadow
    >;
    mesh.onBeforeShadow(...args);
    expect(reduced.index).toBe(full.index);
    expect(reduced.attributes.position).toBe(full.attributes.position);
    expect(before).toHaveBeenCalledTimes(1);
    mesh.onAfterShadow(...args);
    expect(reduced.index).toBe(index);
    expect(after).toHaveBeenCalledTimes(1);
    restore();
    expect(mesh.onBeforeShadow).toBe(before);
    expect(mesh.onAfterShadow).toBe(after);
  });

  it('keeps the complete original batch in shadows while colour is partitioned', () => {
    const source = new THREE.SphereGeometry();
    const mesh = new THREE.InstancedMesh(source, new THREE.MeshStandardMaterial(), 8);
    mesh.count = 0;
    preserveSceneryShadow(mesh, source, 8);
    const args = [null, mesh, null, null, source, null, null] as unknown as Parameters<
      typeof mesh.onBeforeShadow
    >;
    mesh.onBeforeShadow(...args);
    expect(mesh.count).toBe(8);
    mesh.onAfterShadow(...args);
    expect(mesh.count).toBe(0);
    // VSM also draws receivers: detail children must contribute no duplicate
    // caster there even though their colour pass still receives shadows.
    const child = new THREE.InstancedMesh(source, mesh.material, 4);
    preserveSceneryShadow(child, source, 0);
    child.onBeforeShadow(...args);
    expect(child.count).toBe(0);
    child.onAfterShadow(...args);
    expect(child.count).toBe(4);
  });
});
