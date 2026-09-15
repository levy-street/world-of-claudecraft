import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  PaladinAscensionVisual,
  syncPaladinAscensionVisual,
} from '../src/render/paladin_ascension_visual';

const ACTIVE_PLAN = { active: true, charges: 5, lastCharge: false };

function requiredObject(visual: PaladinAscensionVisual, name: string): THREE.Object3D {
  const object = visual.group.getObjectByName(name) ?? visual.crown.getObjectByName(name);
  if (!object) throw new Error(`missing ${name}`);
  return object;
}

describe('PaladinAscensionVisual', () => {
  it('shows only the solar crown and the ground seal', () => {
    const visual = new PaladinAscensionVisual(1.8);
    visual.update(ACTIVE_PLAN, 0, false);

    const groundSeal = requiredObject(visual, 'paladin-ascension-ground-seal');
    const crown = requiredObject(visual, 'paladin-ascension-solar-crown');

    expect(visual.group.visible).toBe(true);
    expect(visual.crown.visible).toBe(true);
    // the seal and the crown are split across two parents: the seal stays on
    // the view group (the ground), the crown rides the rider anchor (the saddle)
    expect(visual.group.children.map((child) => child.name)).toEqual([
      'paladin-ascension-ground-seal',
    ]);
    expect(visual.crown.children.map((child) => child.name)).toEqual([
      'paladin-ascension-solar-crown',
    ]);
    expect(groundSeal.scale.x).toBeCloseTo(1.65);
    expect(crown.position.y).toBeGreaterThan(1.8);
    expect(crown).toBeInstanceOf(THREE.Group);

    const crownBand = crown.getObjectByName('paladin-ascension-crown-band');
    const crownProngs = crown.getObjectByName('paladin-ascension-crown-prongs');
    const crownJewels = crown.getObjectByName('paladin-ascension-crown-jewels');
    if (!(crownBand instanceof THREE.Mesh)) throw new Error('missing 3D crown band');
    expect(crownBand.geometry).toBeInstanceOf(THREE.CylinderGeometry);
    expect(crownBand.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((crownBand.material as THREE.MeshStandardMaterial).metalness).toBeGreaterThan(0.5);
    expect(crownProngs).toBeInstanceOf(THREE.InstancedMesh);
    expect(crownJewels).toBeInstanceOf(THREE.InstancedMesh);
    expect((crownProngs as THREE.InstancedMesh).count).toBe(8);
    expect((crownJewels as THREE.InstancedMesh).count).toBe(8);

    for (const removed of [
      'paladin-ascension-solar-shoulders',
      'paladin-ascension-chest-medallion',
      'paladin-ascension-light-mantle',
      'paladin-ascension-activation-sweep',
    ]) {
      expect(visual.group.getObjectByName(removed)).toBeUndefined();
      expect(visual.crown.getObjectByName(removed)).toBeUndefined();
    }

    visual.dispose();
  });

  it('levitates only the character rig while the crown follows it', () => {
    const visual = new PaladinAscensionVisual(1.8);
    const worldRoot = new THREE.Group();
    const characterRoot = new THREE.Group();
    worldRoot.position.set(12, 4, -3);
    characterRoot.position.y = 0.25;
    worldRoot.add(characterRoot, visual.group, visual.crown);

    visual.update(ACTIVE_PLAN, 1, false, characterRoot);
    const crown = requiredObject(visual, 'paladin-ascension-solar-crown');
    expect(characterRoot.position.y).toBeCloseTo(0.33);
    expect(crown.position.y).toBeCloseTo(2.08);
    expect(worldRoot.position.toArray()).toEqual([12, 4, -3]);

    visual.update({ active: false, charges: 0, lastCharge: false }, 0.1, false, characterRoot);
    expect(visual.group.visible).toBe(false);
    expect(visual.crown.visible).toBe(false);
    expect(characterRoot.position.y).toBeCloseTo(0.25);
    visual.dispose();
  });

  it('seats the crown on the rider anchor and the seal on the view group', () => {
    const group = new THREE.Group();
    group.position.set(2, 10, 3);
    const riderAnchor = new THREE.Group();
    riderAnchor.position.y = 1.15; // the saddle lift
    group.add(riderAnchor);
    const visual = syncPaladinAscensionVisual(null, group, riderAnchor, 1.8, ACTIVE_PLAN, 0, false);
    if (!visual) throw new Error('visual not built');
    expect(visual.group.parent).toBe(group);
    expect(visual.crown.parent).toBe(riderAnchor);
    group.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    requiredObject(visual, 'paladin-ascension-solar-crown').getWorldPosition(world);
    expect(world.y).toBeCloseTo(10 + 1.15 + 1.8 + 0.2 + 0.08, 5);
    requiredObject(visual, 'paladin-ascension-ground-seal').getWorldPosition(world);
    expect(world.y).toBeCloseTo(10 + 0.055, 5);
    visual.dispose();
    expect(visual.group.parent).toBeNull();
    expect(visual.crown.parent).toBeNull();
  });

  it('wires visual levitation to the character rig instead of the world entity root', () => {
    const rendererSource = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    );
    expect(rendererSource).toMatch(
      /syncPaladinAscensionVisual\(\s*v\.paladinAscensionVisual,\s*v\.group,\s*v\.riderAnchor,[\s\S]*?this\.reducedMotion\(\),\s*v\.visual\.root,\s*\)/,
    );
  });
});
