import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PaladinAscensionVisual } from '../src/render/paladin_ascension_visual';

const ACTIVE_PLAN = { active: true, charges: 5, lastCharge: false };

function requiredObject(visual: PaladinAscensionVisual, name: string): THREE.Object3D {
  const object = visual.group.getObjectByName(name);
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
    expect(visual.group.children.map((child) => child.name).sort()).toEqual([
      'paladin-ascension-ground-seal',
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
    }

    visual.dispose();
  });

  it('levitates only the character rig while the crown follows it', () => {
    const visual = new PaladinAscensionVisual(1.8);
    const worldRoot = new THREE.Group();
    const characterRoot = new THREE.Group();
    worldRoot.position.set(12, 4, -3);
    characterRoot.position.y = 0.25;
    worldRoot.add(characterRoot, visual.group);

    visual.update(ACTIVE_PLAN, 1, false, characterRoot);
    const crown = requiredObject(visual, 'paladin-ascension-solar-crown');
    expect(characterRoot.position.y).toBeCloseTo(0.33);
    expect(crown.position.y).toBeCloseTo(2.08);
    expect(worldRoot.position.toArray()).toEqual([12, 4, -3]);

    visual.update({ active: false, charges: 0, lastCharge: false }, 0.1, false, characterRoot);
    expect(visual.group.visible).toBe(false);
    expect(characterRoot.position.y).toBeCloseTo(0.25);
    visual.dispose();
  });

  it('wires visual levitation to the character rig instead of the world entity root', () => {
    const rendererSource = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    );
    expect(rendererSource).toMatch(
      /syncPaladinAscensionVisual\([\s\S]*?this\.reducedMotion\(\),\s*v\.visual\.root,\s*\)/,
    );
  });
});
