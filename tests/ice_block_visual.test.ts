import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GFX } from '../src/render/gfx';
import { IceBlockVisual, syncIceBlockVisual } from '../src/render/ice_block_visual';

describe('Ice Block visual', () => {
  it('builds a translucent coffin tall enough to enclose its character', () => {
    const visual = new IceBlockVisual(1.8);

    expect(visual.group.visible).toBe(false);
    visual.update(true, 1);

    expect(visual.group.visible).toBe(true);
    const shell = visual.group.getObjectByName('ice-block-shell') as THREE.Mesh;
    expect(shell).toBeInstanceOf(THREE.Mesh);
    expect(shell.material).toBeInstanceOf(
      GFX.standardMaterials ? THREE.MeshStandardMaterial : THREE.MeshLambertMaterial,
    );
    expect((shell.material as THREE.MeshStandardMaterial).transparent).toBe(true);
    expect((shell.material as THREE.MeshStandardMaterial).opacity).toBeLessThan(0.6);
    expect(visual.group.getObjectByName('ice-block-facets')).toBeUndefined();

    const bounds = new THREE.Box3().setFromObject(visual.group);
    expect(bounds.max.y - bounds.min.y).toBeGreaterThan(1.8);
    expect(bounds.max.y).toBeGreaterThan(2.25);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(1.5);
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(1.15);
    expect(visual.group.getObjectByName('ice-block-shards')).toBeInstanceOf(THREE.InstancedMesh);
  });

  it('reveals upward, caps at full size, and resets cleanly on reactivation', () => {
    const visual = new IceBlockVisual(1.8);
    const originalGroup = visual.group;

    visual.update(true, 0.04);
    expect(visual.group.visible).toBe(true);
    expect(visual.activatedThisFrame).toBe(true);
    const firstHeight = visual.group.scale.y;
    expect(firstHeight).toBeGreaterThan(0.04);
    expect(firstHeight).toBeLessThan(1);

    visual.update(true, 0.04);
    expect(visual.activatedThisFrame).toBe(false);
    expect(visual.group).toBe(originalGroup);
    expect(visual.group.scale.y).toBeGreaterThan(firstHeight);
    visual.update(true, 10);
    expect(visual.group.scale.toArray()).toEqual([1, 1, 1]);

    visual.update(false, 0.016);
    expect(visual.group.visible).toBe(false);
    expect(visual.activatedThisFrame).toBe(false);

    visual.update(true, 0);
    expect(visual.group.visible).toBe(true);
    expect(visual.activatedThisFrame).toBe(true);
    expect(visual.group.scale.y).toBe(0.04);
    visual.update(true, -1);
    expect(visual.group.scale.y).toBe(0.04);
  });

  it('lazy-creates once on the owning group and releases its instance buffer', () => {
    const parent = new THREE.Group();
    let visual = syncIceBlockVisual(null, parent, 1.8, false, 0.016);
    expect(visual).toBeNull();
    expect(parent.children).toHaveLength(0);

    visual = syncIceBlockVisual(visual, parent, 1.8, true, 0.016);
    expect(visual).not.toBeNull();
    expect(parent.children).toEqual([visual?.group]);
    const first = visual;
    visual = syncIceBlockVisual(visual, parent, 1.8, true, 0.016);
    expect(visual).toBe(first);
    expect(parent.children).toHaveLength(1);
    visual = syncIceBlockVisual(visual, parent, 1.8, false, 0.016);
    expect(visual?.group.visible).toBe(false);

    const shards = visual?.group.getObjectByName('ice-block-shards') as THREE.InstancedMesh;
    let disposed = false;
    shards.addEventListener('dispose', () => {
      disposed = true;
    });
    visual?.dispose();
    expect(disposed).toBe(true);
  });

  it('scales around both short and tall character models while staying grounded', () => {
    for (const characterHeight of [1, 2.4]) {
      const visual = new IceBlockVisual(characterHeight);
      visual.update(true, 1);
      const bounds = new THREE.Box3().setFromObject(visual.group);
      expect(bounds.min.y).toBeGreaterThanOrEqual(0);
      expect(bounds.min.y).toBeLessThan(0.1);
      expect(bounds.max.y).toBeGreaterThan(characterHeight);
    }
  });

  it('is wired to the renderer through the existing aura pass', () => {
    const rendererPath = fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url));
    const renderer = readFileSync(rendererPath, 'utf8');

    expect(renderer).toContain("if (a.id === 'ice_block' && a.kind === 'stasis')");
    expect(renderer).toContain('v.iceBlockVisual = syncIceBlockVisual(');
    expect(renderer).toContain("if (iceBlockActivated) this.activeVisual(v)?.playEmote('wave', 1)");
    expect(renderer).toContain('v.iceBlockVisual?.dispose()');
  });
});
