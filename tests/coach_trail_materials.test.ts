// The Proving Shore coach's guidance materials (src/render/coach_trail_materials.ts):
// one page-wide set, staged by the boot manifest through the ability-material
// lane, worn by the live trail and by a stand-in that draws every material on
// the object kind the trail draws it with. The measured defect: the island's
// first accepted quest linked the ribbon, ring and aura programs inside a live
// frame, and every ribbon rebuild disposed the sole material holding one.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { ABILITY_MATERIAL_SOURCES } from '../src/render/ability_material_prewarm';
import { CoachTrail } from '../src/render/coach_trail';
import {
  buildCoachTrailStandIn,
  coachTrailMaterials,
  resetCoachTrailMaterialsForTest,
} from '../src/render/coach_trail_materials';

const read = (path: string): string =>
  readFileSync(new URL(path, new URL('../', import.meta.url)), 'utf8').replace(/^\s*\/\/.*$/gm, '');

afterEach(() => resetCoachTrailMaterialsForTest());

describe('coach trail materials', () => {
  it('mints one set per page and hands the same objects to every caller', () => {
    const a = coachTrailMaterials();
    const b = coachTrailMaterials();
    expect(b).toBe(a);
    expect(Object.keys(a).sort()).toEqual(['areaRing', 'aura', 'beam', 'ribbon', 'ring']);
    // A map on each textured material (a DataTexture stands in where no
    // document exists, the same `map` program key either way).
    expect(a.ribbon.map).toBeInstanceOf(THREE.Texture);
    expect(a.aura.map).toBeInstanceOf(THREE.Texture);
    expect(a.beam.map).toBeInstanceOf(THREE.Texture);
    expect(a.ring.map).toBeNull();
    for (const material of Object.values(a)) {
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.blending).toBe(THREE.AdditiveBlending);
    }
  });

  it('the stand-in draws every material on the object kind the trail draws it with', () => {
    const mats = coachTrailMaterials();
    const standIn = buildCoachTrailStandIn();
    const byMaterial = new Map<THREE.Material, THREE.Object3D>();
    standIn.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.Material | undefined;
      if (material) byMaterial.set(material, object);
    });
    expect(byMaterial.size).toBe(5);
    expect(byMaterial.get(mats.aura)).toBeInstanceOf(THREE.Sprite);
    for (const key of ['ribbon', 'ring', 'beam', 'areaRing'] as const) {
      expect((byMaterial.get(mats[key]) as THREE.Mesh).isMesh).toBe(true);
    }
    // The attribute sets three keys the programs on: position+uv for the
    // ribbon, position only for the area ring.
    const ribbon = byMaterial.get(mats.ribbon) as THREE.Mesh;
    expect(Object.keys(ribbon.geometry.attributes).sort()).toEqual(['position', 'uv']);
    const areaRing = byMaterial.get(mats.areaRing) as THREE.Mesh;
    expect(Object.keys(areaRing.geometry.attributes)).toEqual(['position']);
    expect(standIn.children.every((child) => !child.visible)).toBe(true);
  });

  it('rides the ability-material prewarm lane', () => {
    const source = ABILITY_MATERIAL_SOURCES.find((entry) => entry.id === 'coach-trail');
    expect(source).toBeDefined();
    expect(source?.module).toBe('coach_trail_materials.ts');
    const mats = coachTrailMaterials();
    expect(new Set(source?.materials())).toEqual(new Set(Object.values(mats)));
  });

  it('the live trail wears the shared set and never mints or disposes a material', () => {
    const scene = new THREE.Group();
    const trail = new CoachTrail(scene, () => 0);
    const mats = coachTrailMaterials();
    const plan = {
      key: 'a',
      points: [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 8, z: 2 },
      ],
    } as unknown as Parameters<CoachTrail['update']>[0];
    trail.update(plan, { x: 1, z: 1 }, { x: 5, z: 5 }, { x: 2, z: 2, radius: 3 }, 0, 1 / 60);
    const worn = new Map<THREE.Material, THREE.Object3D>();
    scene.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.Material | undefined;
      if (material) worn.set(material, object);
    });
    expect(new Set(worn.keys())).toEqual(new Set(Object.values(mats)));
    // Every object lives under the one root, built at construction.
    for (const object of worn.values()) expect(object.parent).toBe(trail.group);
    expect(trail.group.parent).toBe(scene);
    const ribbon = worn.get(mats.ribbon) as THREE.Mesh;
    const firstGeometry = ribbon.geometry;
    expect(ribbon.visible).toBe(true);
    // A new route: the ribbon geometry is swapped on the SAME mesh, the
    // material and the mesh are the ones the compile gate already linked.
    const plan2 = { ...plan, key: 'b' } as unknown as Parameters<CoachTrail['update']>[0];
    trail.update(plan2, { x: 1, z: 1 }, null, { x: 9, z: 9, radius: 2 }, 1, 1 / 60);
    expect(ribbon.geometry).not.toBe(firstGeometry);
    expect(ribbon.material).toBe(mats.ribbon);
    expect(trail.group.children).toHaveLength(5);
    // No route: hidden, never removed or disposed.
    trail.update(null, null, null, null, 2, 1 / 60);
    expect(ribbon.visible).toBe(false);
    expect(trail.group.children).toHaveLength(5);
    // Source pin: no material or texture is minted in the trail itself, and
    // nothing is added to the scene after the constructor.
    const src = read('src/render/coach_trail.ts');
    expect(src).not.toContain('new THREE.MeshBasicMaterial');
    expect(src).not.toContain('new THREE.SpriteMaterial');
    expect(src).not.toContain('new THREE.CanvasTexture');
    expect(src).not.toMatch(/Mat\?\.dispose\(\)|\.material\.dispose\(\)/);
    expect(src).not.toContain('scene.add(');
    expect(src.match(/attachSceneGroupGated\(/g)).toHaveLength(1);
    expect(src).toContain('coachTrailMaterials()');
  });

  it('the root stays hidden until the compile gate links it, then shows (the gated attach)', async () => {
    const scene = new THREE.Group();
    let release = (): void => {};
    const gated: THREE.Object3D[] = [];
    const trail = new CoachTrail(
      scene,
      () => 0,
      (target) => {
        gated.push(target);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    );
    expect(gated).toEqual([trail.group]);
    expect(trail.group.parent).toBe(scene);
    expect(trail.group.visible).toBe(false);
    trail.update(null, { x: 1, z: 1 }, null, null, 0, 1 / 60);
    expect(trail.group.visible).toBe(false);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(trail.group.visible).toBe(true);
  });

  it('the renderer hands the guidance its compile gate (source pin)', () => {
    const renderer = read('src/render/renderer.ts');
    expect(renderer).toContain(
      'new IslandGuidance(this.scene, this.groundSample, (t) => this.compileGate(t))',
    );
  });
});
