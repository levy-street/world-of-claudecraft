// Moving parts of placed building clones (render/placed_movers.ts): the bank's
// vault door. The lock runs first (wheel, bolts), then the leaf swings; a
// click reverses a door mid-run; each stage crosses exactly one sound cue.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  MOVER_LOCK_SHARE,
  MOVER_SECONDS,
  moverCues,
  moverFraction,
  moverMotionOf,
  PlacedMovers,
  stepMoverTime,
} from '../src/render/placed_movers';

describe('mover timeline', () => {
  it('turns the lock before the leaf swings, and swings only after', () => {
    expect(moverFraction('spin', 0)).toBe(0);
    expect(moverFraction('spin', MOVER_LOCK_SHARE)).toBe(1);
    expect(moverFraction('slide', MOVER_LOCK_SHARE / 2)).toBeCloseTo(0.5, 5);
    expect(moverFraction('swing', MOVER_LOCK_SHARE)).toBe(0);
    expect(moverFraction('swing', 1)).toBe(1);
    expect(moverFraction('swing', (1 + MOVER_LOCK_SHARE) / 2)).toBeCloseTo(0.5, 5);
  });

  it('steps toward its target and stops there', () => {
    expect(stepMoverTime(0, 1, MOVER_SECONDS / 2)).toBeCloseTo(0.5, 6);
    expect(stepMoverTime(0.9, 1, MOVER_SECONDS)).toBe(1);
    expect(stepMoverTime(0.1, 0, MOVER_SECONDS)).toBe(0);
  });

  it('crosses each cue once, opening and shutting', () => {
    expect(moverCues(0, 0.1)).toEqual(['unlock']);
    expect(moverCues(0.1, 0.5)).toEqual(['swing']);
    expect(moverCues(0.5, 1)).toEqual([]);
    expect(moverCues(1, 0.9)).toEqual(['swing']);
    expect(moverCues(0.5, 0.2)).toEqual(['shut']);
    expect(moverCues(0.2, 0)).toEqual(['lock']);
    expect(moverCues(0.4, 0.4)).toEqual([]);
  });

  it("reads a node's motion extras and ignores anything else", () => {
    const o = new THREE.Object3D();
    expect(moverMotionOf(o)).toBeNull();
    o.userData.wocMover = { kind: 'swing', axis: 'y', angle: -1.5708, name: 'G_MOV_vault_door' };
    expect(moverMotionOf(o)).toEqual({ kind: 'swing', axis: 'y', angle: -1.5708, dist: undefined });
    o.userData.wocMover = { kind: 'bounce', axis: 'y' };
    expect(moverMotionOf(o)).toBeNull();
  });
});

describe('PlacedMovers', () => {
  const clone = () => {
    const model = new THREE.Group();
    const scene = new THREE.Scene();
    scene.add(model);
    const door = new THREE.Group();
    door.name = 'G_MOV_vault_door';
    door.position.set(1.4, 0.45, 5.84);
    door.userData.wocMover = { kind: 'swing', axis: 'y', angle: -Math.PI / 2 };
    const leaf = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 3.5, 0.42),
      new THREE.MeshBasicMaterial(),
    );
    leaf.position.set(-1.4, 1.75, 0.21);
    door.add(leaf);
    const bolts = new THREE.Group();
    bolts.userData.wocMover = { kind: 'slide', axis: 'x', dist: 0.3 };
    door.add(bolts);
    model.add(door);
    // frozen like a placed clone: locals are only recomposed by the movers
    model.traverse((o) => {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
    model.updateMatrixWorld(true);
    return { model, door, bolts, leaf };
  };

  it('swings the leaf and slides the bolts over a full open, then back', () => {
    const { model, door, bolts } = clone();
    const movers = new PlacedMovers();
    const owner = {};
    movers.add(owner, model);
    expect(movers.count).toBe(1);
    movers.toggle(1);
    const cues: string[] = [];
    for (let i = 0; i < 60; i++)
      for (const c of movers.update(MOVER_SECONDS / 50).cues) cues.push(c.cue);
    expect(door.rotation.y).toBeCloseTo(-Math.PI / 2, 5);
    expect(bolts.position.x).toBeCloseTo(0.3, 5);
    // the matrices followed (the clone is frozen)
    expect(new THREE.Vector3().setFromMatrixPosition(bolts.matrixWorld).x).toBeCloseTo(1.4, 5);
    const leafEdge = new THREE.Vector3(-2.8, 0, 0).applyMatrix4(door.matrixWorld);
    expect(leafEdge.x).toBeCloseTo(1.4, 4);
    expect(leafEdge.z).toBeCloseTo(5.84 - 2.8, 4); // out into the hall (glTF -z = Blender +y)
    expect(cues).toEqual(['unlock', 'swing']);
    movers.toggle(1);
    for (let i = 0; i < 60; i++)
      for (const c of movers.update(MOVER_SECONDS / 50).cues) cues.push(c.cue);
    expect(door.rotation.y).toBeCloseTo(0, 6);
    expect(bolts.position.x).toBeCloseTo(0, 6);
    expect(cues).toEqual(['unlock', 'swing', 'swing', 'shut', 'lock']);
  });

  it('is clicked through its leaf, and not while hidden', () => {
    const { model, door } = clone();
    const movers = new PlacedMovers();
    movers.add({}, model);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 2, 20), new THREE.Vector3(0, 0, -1));
    expect(movers.pick(ray)?.id).toBe(1);
    door.visible = false;
    expect(movers.pick(ray)).toBeNull();
  });

  it('forgets the sets whose clone went away', () => {
    const { model } = clone();
    const movers = new PlacedMovers();
    movers.add({}, model);
    movers.prune(() => false);
    expect(movers.count).toBe(0);
  });
});
