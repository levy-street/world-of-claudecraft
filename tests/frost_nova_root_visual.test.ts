import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  FrostNovaRootVisual,
  isFrostNovaRootAura,
  syncFrostNovaRootVisual,
} from '../src/render/frost_nova_root_visual';
import { GFX } from '../src/render/gfx';

describe('Frost Nova root visual', () => {
  it('builds a compact translucent ice restraint around the feet', () => {
    const visual = new FrostNovaRootVisual(1.8);

    expect(visual.group.visible).toBe(false);
    visual.update(true, 1);

    const base = visual.group.getObjectByName('frost-nova-root-base') as THREE.Mesh;
    expect(base).toBeInstanceOf(THREE.Mesh);
    expect(base.material).toBeInstanceOf(
      GFX.standardMaterials ? THREE.MeshStandardMaterial : THREE.MeshLambertMaterial,
    );
    expect((base.material as THREE.Material).transparent).toBe(true);
    expect((base.material as THREE.MeshStandardMaterial).opacity).toBeLessThan(0.8);
    expect(visual.group.getObjectByName('frost-nova-root-shards')).toBeInstanceOf(
      THREE.InstancedMesh,
    );

    const bounds = new THREE.Box3().setFromObject(visual.group);
    expect(bounds.min.y).toBeGreaterThanOrEqual(0);
    expect(bounds.min.y).toBeLessThan(0.05);
    expect(bounds.max.y).toBeGreaterThan(0.35);
    expect(bounds.max.y).toBeLessThan(0.9);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(0.9);
    expect(bounds.max.x - bounds.min.x).toBeLessThan(1.7);
  });

  it('reveals from the ground and disappears immediately with the root aura', () => {
    const visual = new FrostNovaRootVisual(1.8);

    visual.update(true, 0.03);
    expect(visual.group.visible).toBe(true);
    const firstHeight = visual.group.scale.y;
    expect(firstHeight).toBeGreaterThan(0);
    expect(firstHeight).toBeLessThan(1);

    visual.update(true, 1);
    expect(visual.group.scale.toArray()).toEqual([1, 1, 1]);
    visual.update(false, 0.016);
    expect(visual.group.visible).toBe(false);

    visual.update(true, 0);
    expect(visual.group.visible).toBe(true);
    expect(visual.group.scale.y).toBeGreaterThan(0);
    expect(visual.group.scale.y).toBeLessThan(0.1);
    expect(visual.group.scale.x).toBeCloseTo(0.88);
    expect(visual.group.scale.z).toBeCloseTo(0.88);
  });

  it('scales within readable limits for both tiny and very tall character rigs', () => {
    const tiny = new FrostNovaRootVisual(0.2);
    const tall = new FrostNovaRootVisual(10);
    const tinyContent = tiny.group.getObjectByName('frost-nova-root-content');
    const tallContent = tall.group.getObjectByName('frost-nova-root-content');

    expect(tinyContent?.scale.toArray()).toEqual([0.72, 0.72, 0.72]);
    expect(tallContent?.scale.toArray()).toEqual([1.35, 1.35, 1.35]);
  });

  it('recognizes the authoritative roots from Atadura de Hielo and Ring of Frost', () => {
    expect(isFrostNovaRootAura({ id: 'frost_nova_root', kind: 'root' })).toBe(true);
    expect(isFrostNovaRootAura({ id: 'rings_of_frost_root', kind: 'root' })).toBe(true);
    expect(isFrostNovaRootAura({ id: 'frost_nova_root', kind: 'slow' })).toBe(false);
    expect(isFrostNovaRootAura({ id: 'rings_of_frost_root', kind: 'slow' })).toBe(false);
    expect(isFrostNovaRootAura({ id: 'arena_root', kind: 'root' })).toBe(false);
  });

  it('lazy-creates once on the affected entity and releases its instance buffer', () => {
    const parent = new THREE.Group();
    let visual = syncFrostNovaRootVisual(null, parent, 1.8, false, 0.016);
    expect(visual).toBeNull();

    visual = syncFrostNovaRootVisual(visual, parent, 1.8, true, 0.016);
    expect(parent.children).toEqual([visual?.group]);
    const first = visual;
    visual = syncFrostNovaRootVisual(visual, parent, 1.8, true, 0.016);
    expect(visual).toBe(first);
    expect(parent.children).toHaveLength(1);

    const shards = visual?.group.getObjectByName('frost-nova-root-shards') as THREE.InstancedMesh;
    let disposeCount = 0;
    shards.addEventListener('dispose', () => {
      disposeCount++;
    });
    visual?.dispose();
    visual?.dispose();
    expect(disposeCount).toBe(1);
  });

  it('is driven only by authoritative frost-root auras', () => {
    const rendererPath = fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url));
    const renderer = readFileSync(rendererPath, 'utf8');

    expect(renderer).toContain('if (isFrostNovaRootAura(a)) hasFrostNovaRoot = true');
    expect(renderer).toContain('v.frostNovaRootVisual = syncFrostNovaRootVisual(');
    expect(renderer).toContain('v.frostNovaRootVisual?.dispose()');
  });
});
