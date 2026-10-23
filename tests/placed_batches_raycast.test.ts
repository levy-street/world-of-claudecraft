// Picking batched placements (render/placed_batches.ts). three's InstancedMesh
// raycast culls against a bounding sphere computed ONCE (the first rendered
// frame or raycast) and never refreshed, so a batch that gained or moved
// instances afterwards kept testing the old sphere: every copy outside it (a
// tree streamed in later, a rock dragged elsewhere) became unclickable in the
// Studio, whose exact-hit picking has no loose fallback. The fix must also
// never null the sphere, which the renderer would recompute every frame.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { type BatchSub, PlacedBatches } from '../src/render/placed_batches';

const PATH = 'models/test_tree.glb';

/** A unit box template: one sub-mesh, no node transform. */
const boxSubs = (): BatchSub[] => [
  {
    geometry: new THREE.BoxGeometry(1, 1, 1),
    material: new THREE.MeshBasicMaterial(),
    local: new THREE.Matrix4(),
    sources: [0],
    sourceLocals: [new THREE.Matrix4()],
  },
];

const at = (x: number, z = 0): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(x, 0, z);

/** The placement id under a straight-down ray at (x, z), or null. */
function pickAt(batches: PlacedBatches, x: number, z = 0): number | null {
  const raycaster = new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
  for (const hit of raycaster.intersectObject(batches.group, true)) {
    if (hit.instanceId === undefined) continue;
    const id = batches.idAt(hit.object, hit.instanceId);
    if (id !== null) return id;
  }
  return null;
}

/** The batch's one InstancedMesh (every test uses a single-sub template). */
const meshOf = (batches: PlacedBatches): THREE.InstancedMesh =>
  batches.group.children[0] as THREE.InstancedMesh;

describe('PlacedBatches raycast bounds', () => {
  it('picks an instance attached after an earlier raycast', () => {
    const subs = boxSubs();
    const batches = new PlacedBatches();
    batches.attach(1, PATH, subs, at(0));
    expect(pickAt(batches, 0)).toBe(1); // first raycast computes the sphere
    batches.attach(2, PATH, subs, at(100));
    expect(pickAt(batches, 100)).toBe(2);
  });

  it('picks an instance at its new spot after its matrix moved', () => {
    const subs = boxSubs();
    const batches = new PlacedBatches();
    batches.attach(1, PATH, subs, at(0));
    batches.attach(2, PATH, subs, at(2));
    expect(pickAt(batches, 2)).toBe(2);
    batches.setMatrix(2, at(-150, 40));
    expect(pickAt(batches, -150, 40)).toBe(2);
    expect(pickAt(batches, 2)).toBeNull();
  });

  it('picks the copy swapped into a freed slot after a detach', () => {
    const subs = boxSubs();
    const batches = new PlacedBatches();
    batches.attach(1, PATH, subs, at(0));
    batches.attach(2, PATH, subs, at(3));
    expect(pickAt(batches, 0)).toBe(1);
    batches.detach(1);
    batches.attach(3, PATH, subs, at(80));
    expect(pickAt(batches, 0)).toBeNull();
    expect(pickAt(batches, 3)).toBe(2);
    expect(pickAt(batches, 80)).toBe(3);
  });

  it('picks copies attached into a grown batch after an earlier raycast', () => {
    const subs = boxSubs();
    const batches = new PlacedBatches();
    // Nine copies outgrow the initial capacity of 8; the raycast then
    // computes the grown mesh's bounds, and the next copies still fit in it.
    for (let id = 0; id < 9; id++) batches.attach(id, PATH, subs, at(id * 10));
    expect(pickAt(batches, 0)).toBe(0);
    for (let id = 9; id < 16; id++) batches.attach(id, PATH, subs, at(id * 10));
    for (let id = 0; id < 16; id++) expect(pickAt(batches, id * 10)).toBe(id);
  });

  it('picks past bounds the renderer froze, as a rendered frame does', () => {
    const subs = boxSubs();
    const batches = new PlacedBatches();
    batches.attach(1, PATH, subs, at(0));
    // WebGLRenderer computes a sorted object's sphere on its first frame.
    meshOf(batches).computeBoundingSphere();
    batches.attach(2, PATH, subs, at(60, -60));
    expect(pickAt(batches, 60, -60)).toBe(2);
  });

  it('never nulls the sphere on a write, so a frame never pays a recompute', () => {
    const subs = boxSubs();
    const batches = new PlacedBatches();
    batches.attach(1, PATH, subs, at(0));
    const mesh = meshOf(batches);
    mesh.computeBoundingSphere();
    const sphere = mesh.boundingSphere;
    batches.attach(2, PATH, subs, at(40));
    batches.setMatrix(1, at(-40));
    batches.detach(2);
    expect(mesh.boundingSphere).toBe(sphere);
    // the pick-time recompute refills that same sphere in place
    expect(pickAt(batches, -40)).toBe(1);
    expect(mesh.boundingSphere).toBe(sphere);
  });

  it('recomputes only on the first raycast after a write, never after a detach', () => {
    const subs = boxSubs();
    const batches = new PlacedBatches();
    batches.attach(1, PATH, subs, at(0));
    batches.attach(2, PATH, subs, at(5));
    const recompute = vi.spyOn(meshOf(batches), 'computeBoundingSphere');
    expect(pickAt(batches, 0)).toBe(1);
    expect(recompute).toHaveBeenCalledTimes(1);
    expect(pickAt(batches, 5)).toBe(2); // no write since: no recompute
    expect(recompute).toHaveBeenCalledTimes(1);
    batches.setMatrix(2, at(30));
    expect(pickAt(batches, 30)).toBe(2);
    expect(recompute).toHaveBeenCalledTimes(2);
    batches.detach(1);
    expect(pickAt(batches, 30)).toBe(2);
    expect(recompute).toHaveBeenCalledTimes(2);
  });

  it('picks a copy whose attach grew the batch after an earlier raycast', () => {
    const subs = boxSubs();
    const batches = new PlacedBatches();
    for (let id = 0; id < 8; id++) batches.attach(id, PATH, subs, at(id * 10));
    const before = meshOf(batches);
    expect(pickAt(batches, 70)).toBe(7); // bounds of the full capacity-8 mesh
    batches.attach(8, PATH, subs, at(-90, 90)); // the ninth copy grows it
    expect(meshOf(batches)).not.toBe(before);
    expect(pickAt(batches, -90, 90)).toBe(8);
    expect(pickAt(batches, 0)).toBe(0);
  });
});
