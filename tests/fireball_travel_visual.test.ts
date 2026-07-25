import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  FireballTravelVisual,
  syncFireballTravelVisual,
} from '../src/render/fireball_travel_visual';

describe('Fireball travel visual', () => {
  it('builds a large layered fireball with a hot core, flame shell, trail, and embers', () => {
    const visual = new FireballTravelVisual();

    expect(visual.group.name).toBe('fireball-travel-form');
    expect(visual.group.getObjectByName('fireball-travel-core')).toBeInstanceOf(THREE.Mesh);
    expect(visual.group.getObjectByName('fireball-travel-flame-shell')).toBeInstanceOf(THREE.Mesh);
    expect(visual.group.getObjectByName('fireball-travel-tail')).toBeInstanceOf(THREE.Group);
    const flames = visual.group.getObjectByName(
      'fireball-travel-tail-flames',
    ) as THREE.InstancedMesh;
    const embers = visual.group.getObjectByName('fireball-travel-embers') as THREE.InstancedMesh;
    expect(flames).toBeInstanceOf(THREE.InstancedMesh);
    expect(flames.count).toBe(5);
    expect(embers).toBeInstanceOf(THREE.InstancedMesh);
    expect(embers.count).toBeGreaterThanOrEqual(8);
    const core = visual.group.getObjectByName('fireball-travel-core') as THREE.Mesh;
    core.geometry.computeBoundingSphere();
    expect(core.geometry.boundingSphere?.radius).toBeGreaterThanOrEqual(0.7);
  });

  it('stretches and brightens the trail while moving, then hides cleanly', () => {
    const visual = new FireballTravelVisual();
    const tail = visual.group.getObjectByName('fireball-travel-tail') as THREE.Group;
    visual.update(true, 1 / 60, 0);
    const idleLength = tail.scale.z;
    visual.update(true, 1 / 60, 1);
    expect(tail.scale.z).toBeGreaterThan(idleLength);
    expect(visual.group.visible).toBe(true);

    visual.update(false, 1 / 60, 0);
    expect(visual.group.visible).toBe(false);
  });

  it('animates deterministically and reuses one visual across sync calls', () => {
    const a = new FireballTravelVisual();
    const b = new FireballTravelVisual();
    for (let i = 0; i < 20; i++) {
      a.update(true, 1 / 60, 0.8);
      b.update(true, 1 / 60, 0.8);
    }
    const emberA = a.group.getObjectByName('fireball-travel-embers') as THREE.InstancedMesh;
    const emberB = b.group.getObjectByName('fireball-travel-embers') as THREE.InstancedMesh;
    const matrixA = new THREE.Matrix4();
    const matrixB = new THREE.Matrix4();
    emberA.getMatrixAt(3, matrixA);
    emberB.getMatrixAt(3, matrixB);
    expect(matrixA.toArray()).toEqual(matrixB.toArray());

    const parent = new THREE.Group();
    const synced = syncFireballTravelVisual(null, parent, true, 1 / 60, 1);
    expect(synced).not.toBeNull();
    expect(parent.children).toContain(synced?.group);
    expect(syncFireballTravelVisual(synced, parent, true, 1 / 60, 1)).toBe(synced);
  });

  it('uses a reduced-detail presentation for distant Mage views', () => {
    const visual = new FireballTravelVisual();
    visual.update(true, 1 / 60, 1, false);

    expect(visual.group.getObjectByName('fireball-travel-core')?.visible).toBe(true);
    expect(visual.group.getObjectByName('fireball-travel-flame-shell')?.visible).toBe(true);
    expect(visual.group.getObjectByName('fireball-travel-tail')?.visible).toBe(false);
    expect(visual.group.getObjectByName('fireball-travel-embers')?.visible).toBe(false);
  });

  it('is wired to the renderer aura pass and cleaned up with the entity view', () => {
    const rendererPath = fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url));
    const renderer = readFileSync(rendererPath, 'utf8');

    expect(renderer).toContain("if (a.kind === 'form_fireball') hasFireballForm = true");
    expect(renderer).toContain('v.fireballTravelVisual = syncFireballTravelVisual(');
    expect(renderer).toContain('v.fireballTravelVisual?.dispose()');
    expect(renderer).toContain('v.visual.root.visible = active === v.visual && !fireballForm');
  });
});
