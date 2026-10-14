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
    worldRoot.add(characterRoot, visual.group, visual.crown);

    // The renderer's rider placement rewrites the rig root every frame before
    // the visual runs (placeRider or the mount attitude pass).
    characterRoot.position.y = 0.25;
    visual.update(ACTIVE_PLAN, 1, false, characterRoot);
    const crown = requiredObject(visual, 'paladin-ascension-solar-crown');
    expect(characterRoot.position.y).toBeCloseTo(0.33);
    expect(crown.position.y).toBeCloseTo(2.08);
    expect(worldRoot.position.toArray()).toEqual([12, 4, -3]);

    characterRoot.position.y = 0.25;
    visual.update({ active: false, charges: 0, lastCharge: false }, 0.1, false, characterRoot);
    expect(visual.group.visible).toBe(false);
    expect(visual.crown.visible).toBe(false);
    expect(characterRoot.position.y).toBeCloseTo(0.25);
    visual.dispose();
  });

  // The rider-root regression behind "the riding pose is broken, mostly on
  // paladins": the visual used to latch the rig root's height the first frame
  // it saw it and write that height back every frame for the life of the view
  // (it is built on the first Ascension and never torn down until the view
  // goes). A paladin who ascended on foot then sat at ground level under every
  // later mount; one who ascended in the saddle floated at seat height after
  // dismounting. Each frame below runs the renderer's order: place the rider,
  // then sync the visual.
  const SEAT = 1.15;
  const INACTIVE_PLAN = { active: false, charges: 0, lastCharge: false };
  function frame(
    visual: PaladinAscensionVisual,
    root: THREE.Object3D,
    placedY: number,
    plan: typeof ACTIVE_PLAN,
  ): number {
    root.position.y = placedY;
    visual.update(plan, 1 / 60, false, root);
    return root.position.y;
  }

  it('lets a paladin who ascended on foot sit the saddle of a later mount', () => {
    const visual = new PaladinAscensionVisual(1.8);
    const root = new THREE.Group();
    expect(frame(visual, root, 0, ACTIVE_PLAN)).toBeCloseTo(0.08);
    expect(frame(visual, root, 0, INACTIVE_PLAN)).toBe(0);
    // Mounts up after the Ascension ended: the seat must survive the visual.
    expect(frame(visual, root, SEAT, INACTIVE_PLAN)).toBe(SEAT);
    expect(frame(visual, root, SEAT, INACTIVE_PLAN)).toBe(SEAT);
    // Ascends again in the saddle: the hover rides on top of the seat.
    expect(frame(visual, root, SEAT, ACTIVE_PLAN)).toBeCloseTo(SEAT + 0.08);
    expect(frame(visual, root, SEAT, ACTIVE_PLAN)).toBeCloseTo(SEAT + 0.08);
    visual.dispose();
  });

  it('drops a paladin who ascended in the saddle back to the ground on dismount', () => {
    const visual = new PaladinAscensionVisual(1.8);
    const root = new THREE.Group();
    expect(frame(visual, root, SEAT, ACTIVE_PLAN)).toBeCloseTo(SEAT + 0.08);
    expect(frame(visual, root, 0, ACTIVE_PLAN)).toBeCloseTo(0.08);
    expect(frame(visual, root, 0, INACTIVE_PLAN)).toBe(0);
    visual.dispose();
  });

  it('follows a seat that moves every frame (the bob, a seat bone)', () => {
    const visual = new PaladinAscensionVisual(1.8);
    const root = new THREE.Group();
    for (const y of [SEAT, SEAT + 0.03, SEAT - 0.02, SEAT + 0.01]) {
      expect(frame(visual, root, y, INACTIVE_PLAN)).toBe(y);
      expect(frame(visual, root, y, ACTIVE_PLAN)).toBeCloseTo(y + 0.08);
    }
    visual.dispose();
  });

  it('never moves the rig root on dispose', () => {
    const visual = new PaladinAscensionVisual(1.8);
    const root = new THREE.Group();
    frame(visual, root, 0, ACTIVE_PLAN);
    root.position.y = SEAT;
    visual.dispose();
    expect(root.position.y).toBe(SEAT);
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

  it('syncs after both rider placements, since the hover adds to the placed height', () => {
    // The hover is additive on top of this frame's seat, so the visual must run
    // AFTER both writers of the rider height (placeRider, and the mount
    // attitude pass inside updateMountPresentation). Run before them, the lift
    // is overwritten; with no placement in between, it would climb every frame.
    const rendererSource = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    );
    const sync = rendererSource.search(/syncPaladinAscensionVisual\(\s*v\.paladinAscensionVisual/);
    const place = rendererSource.indexOf('placeRider(v, v.visual.root,');
    const mount = rendererSource.indexOf('updateMountPresentation(v, {');
    expect(place).toBeGreaterThan(0);
    expect(mount).toBeGreaterThan(0);
    expect(sync).toBeGreaterThan(Math.max(place, mount));
  });
});
