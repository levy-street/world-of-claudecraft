// Material merging for placed assets (render/mesh_merge.ts): same-material
// kit nodes fuse into one geometry in the template's root frame with their
// node transforms baked in, storey groups merge separately so the interior
// reveal keeps working, and everything a shader patch or a mirror depends on
// stays on its own draw.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  bakeGeometry,
  mergeBaked,
  mergeSignature,
  mergeStaticMeshes,
} from '../src/render/mesh_merge';
import { templateSubs } from '../src/render/placed_batches';

const quad = (): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  );
  g.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
  );
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
};

const meshAt = (material: THREE.Material, x: number, name = 'node'): THREE.Mesh => {
  const m = new THREE.Mesh(quad(), material);
  m.name = name;
  m.position.x = x;
  return m;
};

const positionsOf = (geometry: THREE.BufferGeometry): number[] =>
  Array.from(geometry.getAttribute('position').array as Float32Array);

describe('mergeSignature', () => {
  it('matches meshes that share material, layout, index and shadow flags', () => {
    const mat = new THREE.MeshStandardMaterial();
    const a = meshAt(mat, 0);
    const b = meshAt(mat, 5);
    expect(mergeSignature(a, mat)).toBe(mergeSignature(b, mat));
    const other = new THREE.MeshStandardMaterial();
    expect(mergeSignature(a, mat)).not.toBe(mergeSignature(meshAt(other, 0), other));
    b.castShadow = !a.castShadow; // a caster and a non-caster never share a draw
    expect(mergeSignature(a, mat)).not.toBe(mergeSignature(b, mat));
  });

  it('refuses a shader-patched material, a self-posing mesh and a multi-material mesh', () => {
    const patched = new THREE.MeshStandardMaterial();
    patched.onBeforeCompile = () => {}; // tree sway / ship motion idiom
    expect(mergeSignature(meshAt(patched, 0), patched)).toBeNull();
    const mat = new THREE.MeshStandardMaterial();
    const posing = meshAt(mat, 0);
    posing.onBeforeRender = () => {}; // the fire puffs
    expect(mergeSignature(posing, mat)).toBeNull();
    const multi = new THREE.Mesh(quad(), [mat, new THREE.MeshStandardMaterial()]);
    expect(mergeSignature(multi, mat)).toBeNull();
  });
});

describe('bakeGeometry', () => {
  it('bakes the node transform into float32 positions and flips a mirrored winding', () => {
    const baked = bakeGeometry(quad(), new THREE.Matrix4().makeTranslation(10, 0, 0));
    expect(baked).not.toBeNull();
    expect(positionsOf(baked as THREE.BufferGeometry).slice(0, 3)).toEqual([10, 0, 0]);
    const mirrored = bakeGeometry(quad(), new THREE.Matrix4().makeScale(-1, 1, 1));
    expect(mirrored).not.toBeNull();
    // triangle 0,1,2 becomes 0,2,1 so the mirrored part still faces front
    expect(Array.from((mirrored as THREE.BufferGeometry).index?.array ?? [])).toEqual([
      0, 2, 1, 0, 3, 2,
    ]);
  });

  it('widens a quantized (normalized int16) position before baking', () => {
    const g = new THREE.BufferGeometry();
    const q = new THREE.BufferAttribute(
      new Int16Array([0, 0, 0, 32767, 0, 0, 32767, 32767, 0]),
      3,
      true,
    );
    g.setAttribute('position', q);
    const baked = bakeGeometry(g, new THREE.Matrix4().makeTranslation(40, 0, 0));
    const pos = positionsOf(baked as THREE.BufferGeometry);
    expect(pos[0]).toBe(40);
    expect(pos[3]).toBeCloseTo(41, 3);
    expect((baked as THREE.BufferGeometry).getAttribute('position').array).toBeInstanceOf(
      Float32Array,
    );
  });

  it('leaves a mirrored non-indexed part alone', () => {
    const g = quad().toNonIndexed();
    expect(bakeGeometry(g, new THREE.Matrix4().makeScale(-1, 1, 1))).toBeNull();
  });
});

describe('mergeStaticMeshes', () => {
  const build = () => {
    const wall = new THREE.MeshStandardMaterial({ name: 'wall' });
    const roof = new THREE.MeshStandardMaterial({ name: 'roof' });
    const root = new THREE.Group();
    root.add(meshAt(wall, 0, 'wall_a'), meshAt(wall, 2, 'wall_b'), meshAt(roof, 0, 'trim'));
    const storey = new THREE.Group();
    storey.name = 'G_H2';
    storey.position.y = 5;
    storey.add(meshAt(roof, 0, 'roof_a'), meshAt(roof, 3, 'roof_b'), meshAt(wall, 9, 'gable'));
    root.add(storey);
    return { root, storey, wall, roof };
  };

  it('fuses same-material meshes per storey group and keeps the groups', () => {
    const { root, storey } = build();
    const result = mergeStaticMeshes(root, ['G_H1', 'G_H2', 'G_H3']);
    expect(result.meshesBefore).toBe(6);
    // root: walls fuse (2->1), trim alone; storey: roofs fuse (2->1), gable alone
    expect(result.meshesAfter).toBe(4);
    expect(result.geometries).toHaveLength(2);
    expect(root.getObjectByName('G_H2')).toBe(storey);
    const meshesUnder = (o: THREE.Object3D) =>
      o.children.filter((c) => (c as THREE.Mesh).isMesh).map((c) => c.name);
    expect(meshesUnder(root)).toEqual(['trim', 'merged:wall']);
    expect(meshesUnder(storey)).toEqual(['gable', 'merged:roof']);
    // the storey's own offset is NOT baked: hiding G_H2 still hides its roof
    const fusedRoof = storey.getObjectByName('merged:roof') as THREE.Mesh;
    const pos = positionsOf(fusedRoof.geometry);
    expect(pos.slice(0, 3)).toEqual([0, 0, 0]);
    expect(pos.slice(12, 15)).toEqual([3, 0, 0]);
  });

  it('never fuses a moving part: a G_MOV_* mesh keeps its node, its siblings merge round it', () => {
    const gold = new THREE.MeshStandardMaterial({ name: 'gold' });
    const root = new THREE.Group();
    const door = new THREE.Group();
    door.name = 'G_MOV_vault_door';
    door.add(meshAt(gold, 0, 'leaf_a'), meshAt(gold, 1, 'leaf_b'));
    const wheel = meshAt(gold, 0.5, 'G_MOV_vault_wheel'); // one primitive: the node IS the mesh
    door.add(wheel);
    root.add(door, meshAt(gold, 5, 'frame_a'), meshAt(gold, 6, 'frame_b'));
    mergeStaticMeshes(root, ['G_INT*', 'G_MOV*']);
    expect(root.getObjectByName('G_MOV_vault_wheel')).toBe(wheel);
    expect(wheel.parent).toBe(door);
    // the leaf's own pieces fuse inside the door's bucket, the frame's in the root's
    expect(door.children.filter((c) => c.name === 'merged:gold')).toHaveLength(1);
    expect(root.children.filter((c) => c.name === 'merged:gold')).toHaveLength(1);
  });

  it('bakes the node offsets of the fused pieces into the geometry', () => {
    const { root } = build();
    mergeStaticMeshes(root, ['G_H2']);
    const fusedWall = root.getObjectByName('merged:wall') as THREE.Mesh;
    const pos = positionsOf(fusedWall.geometry);
    expect(pos).toHaveLength(8 * 3);
    expect(pos.slice(12, 15)).toEqual([2, 0, 0]);
    expect(fusedWall.geometry.index?.count).toBe(12);
  });
});

describe('templateSubs material merge', () => {
  it('collapses same-material kit nodes into one batch piece with its sources', () => {
    const wall = new THREE.MeshStandardMaterial({ name: 'wall' });
    const roof = new THREE.MeshStandardMaterial({ name: 'roof' });
    const object = new THREE.Group();
    object.add(meshAt(wall, 0), meshAt(roof, 0), meshAt(wall, 4));
    const subs = templateSubs(object);
    expect(subs).not.toBeNull();
    expect(subs).toHaveLength(2);
    const fused = (subs ?? [])[0];
    expect(fused.sources).toEqual([0, 2]);
    expect(fused.owned).toBe(true);
    expect(fused.local.equals(new THREE.Matrix4())).toBe(true);
    expect(positionsOf(fused.geometry).slice(12, 15)).toEqual([4, 0, 0]);
    expect((subs ?? [])[1].sources).toEqual([1]);
    // opt-out keeps one piece per node
    expect(templateSubs(object, false)).toHaveLength(3);
  });

  it('mergeBaked returns null for incompatible layouts and releases the parts', () => {
    const a = quad();
    const b = quad();
    b.deleteAttribute('uv');
    expect(mergeBaked([a, b])).toBeNull();
  });
});
