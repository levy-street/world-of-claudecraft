// The three-side binding of the piece cut (src/render/compile_gate_pieces.ts):
// which nodes of a gated root form a piece (exactly the material carriers
// three's compile() prepares: mesh, points, line, sprite), keyed on the material
// tuple's identity plus the program variant three's cache key reads off the
// object and its geometry, and the per-piece work the gate queue runs: one
// representative compile per piece.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { PieceDeadline } from '../src/render/compile_gate';
import { linkPiecesOf, linkPieceWork } from '../src/render/compile_gate_pieces';

function mesh(material: THREE.Material | THREE.Material[], name = ''): THREE.Mesh {
  const built = new THREE.Mesh(new THREE.BufferGeometry(), material);
  built.name = name;
  return built;
}

describe('linkPiecesOf', () => {
  it('groups the carriers by material identity, in traversal order, every carrier kept', () => {
    const root = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial();
    const torso = mesh(skin, 'torso');
    const eyes = mesh(new THREE.MeshBasicMaterial(), 'eyes');
    const legs = mesh(skin, 'legs');
    const attach = new THREE.Group();
    const cape = mesh(new THREE.MeshStandardMaterial(), 'cape');
    attach.add(cape);
    root.add(torso, eyes, legs, attach);
    expect(linkPiecesOf(root)).toEqual([[torso, legs], [eyes], [cape]]);
  });

  it('keys a multi-material mesh on the whole tuple, so it is not the piece of any single member', () => {
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    const pair = mesh([a, b], 'pair');
    const pairAgain = mesh([a, b], 'pairAgain');
    const swapped = mesh([b, a], 'swapped');
    const lone = mesh(a, 'lone');
    const root = new THREE.Group();
    root.add(pair, lone, pairAgain, swapped);
    expect(linkPiecesOf(root)).toEqual([[pair, pairAgain], [lone], [swapped]]);
  });

  it('covers every carrier kind three compile() prepares, and skips what it skips', () => {
    // three's compile(): mesh, points, line or sprite with a material; a bare
    // group, a light, a bone, or a mesh whose material slot is empty prepare
    // nothing and belong to no piece.
    const root = new THREE.Group();
    const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
    const empty = mesh(new THREE.MeshBasicMaterial(), 'empty');
    empty.material = null as unknown as THREE.Material;
    root.add(new THREE.PointLight(), new THREE.Bone(), points, line, sprite, empty);
    expect(linkPiecesOf(root)).toEqual([[points], [line], [sprite]]);
  });

  it('splits one material across program variants: skinned, instanced and static are three pieces', () => {
    // three keys a program on object.isSkinnedMesh and object.isInstancedMesh
    // (WebGLPrograms.getParameters), so the same material on a static mesh, a
    // skinned mesh and an instanced mesh links three programs.
    const shared = new THREE.MeshStandardMaterial();
    const statue = mesh(shared, 'statue');
    const torso = new THREE.SkinnedMesh(new THREE.BufferGeometry(), shared);
    torso.name = 'torso';
    const legs = new THREE.SkinnedMesh(new THREE.BufferGeometry(), shared);
    legs.name = 'legs';
    const crowd = new THREE.InstancedMesh(new THREE.BufferGeometry(), shared, 4);
    crowd.name = 'crowd';
    const bust = mesh(shared, 'bust');
    const root = new THREE.Group();
    root.add(statue, torso, crowd, legs, bust);
    expect(linkPiecesOf(root)).toEqual([[statue, bust], [torso, legs], [crowd]]);
  });

  it('splits one material across geometry variants three reads: morph targets, an instance colour, attributes', () => {
    const shared = new THREE.MeshStandardMaterial();
    const plain = mesh(shared, 'plain');
    const morphed = mesh(shared, 'morphed');
    morphed.geometry.morphAttributes.position = [new THREE.BufferAttribute(new Float32Array(3), 3)];
    const morphedToo = mesh(shared, 'morphedToo');
    morphedToo.geometry.morphAttributes.position = [
      new THREE.BufferAttribute(new Float32Array(3), 3),
    ];
    const lit = mesh(shared, 'lit');
    lit.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(3), 3));
    const tinted = new THREE.InstancedMesh(new THREE.BufferGeometry(), shared, 2);
    tinted.name = 'tinted';
    tinted.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(6), 3);
    const untinted = new THREE.InstancedMesh(new THREE.BufferGeometry(), shared, 2);
    untinted.name = 'untinted';
    const root = new THREE.Group();
    root.add(plain, morphed, lit, tinted, morphedToo, untinted);
    expect(linkPiecesOf(root)).toEqual([
      [plain],
      [morphed, morphedToo],
      [lit],
      [tinted],
      [untinted],
    ]);
  });

  it('ignores castShadow: the shadow arm twins every mesh, so a caster and a non-caster share one piece', () => {
    // Casting is a runtime distance toggle, so the host's shadow arm swaps a
    // depth twin onto every mesh of the piece whatever castShadow reads at
    // gate time; a caster and a non-caster of one material and variant link
    // exactly the same programs, and a second piece would be a cache hit
    // paying a whole-scene light walk for nothing.
    const shared = new THREE.MeshStandardMaterial();
    const decal = mesh(shared, 'decal');
    const wall = mesh(shared, 'wall');
    wall.castShadow = true;
    const fence = mesh(shared, 'fence');
    fence.castShadow = true;
    const root = new THREE.Group();
    root.add(decal, wall, fence);
    expect(linkPiecesOf(root)).toEqual([[decal, wall, fence]]);
  });

  it('ignores receiveShadow: three feeds it as a uniform, not a program key input', () => {
    const shared = new THREE.MeshStandardMaterial();
    const lit = mesh(shared, 'lit');
    const shaded = mesh(shared, 'shaded');
    shaded.receiveShadow = true;
    const root = new THREE.Group();
    root.add(lit, shaded);
    expect(linkPiecesOf(root)).toEqual([[lit, shaded]]);
  });

  it('gives a lone mesh root one piece of itself, and a carrier-less root none', () => {
    const lone = mesh(new THREE.MeshStandardMaterial(), 'batch');
    expect(linkPiecesOf(lone)).toEqual([[lone]]);
    expect(linkPiecesOf(new THREE.Group())).toEqual([]);
  });
});

describe('linkPieceWork', () => {
  const live: PieceDeadline = { fired: false };
  const noSettle = () => Promise.resolve();

  it('runs ONE colour arm, ONE shadow arm, then ONE settle per piece, on its representative, nothing reparented', async () => {
    // legs shares torso's key (same material, both static): a cache hit that
    // would only repeat the whole-scene light walk, so it is not compiled.
    const skin = new THREE.MeshStandardMaterial();
    const torso = mesh(skin, 'torso');
    const legs = mesh(skin, 'legs');
    const eyes = mesh(new THREE.MeshBasicMaterial(), 'eyes');
    const root = new THREE.Group();
    root.add(torso, eyes, legs);
    const arms: string[] = [];
    const color = vi.fn((node: THREE.Object3D) => {
      arms.push(`color:${node.name}`);
      return Promise.resolve();
    });
    const shadow = vi.fn((node: THREE.Object3D) => {
      arms.push(`shadow:${node.name}`);
      return Promise.resolve();
    });
    const settle = vi.fn((node: THREE.Object3D, _deadline: PieceDeadline) => {
      arms.push(`settle:${node.name}`);
      return Promise.resolve();
    });
    const work = linkPieceWork(root, color, shadow, settle);
    expect(work).toHaveLength(2);
    await work[0](live);
    expect(arms).toEqual(['color:torso', 'shadow:torso', 'settle:torso']);
    await work[1](live);
    expect(arms.slice(3)).toEqual(['color:eyes', 'shadow:eyes', 'settle:eyes']);
    expect(color).toHaveBeenCalledTimes(2);
    expect(shadow).toHaveBeenCalledTimes(2);
    expect(settle).toHaveBeenCalledTimes(2);
    expect(color).not.toHaveBeenCalledWith(legs);
    expect(settle).not.toHaveBeenCalledWith(legs, expect.anything());
    for (const node of [torso, legs, eyes]) expect(node.parent).toBe(root);
  });

  it('hands the settle the piece OWN deadline, after both compiles resolved', async () => {
    // The settle polls the driver until every variant is ready or the piece's
    // deadline fires: it must see the deadline the gate armed for THIS piece,
    // and it must not start before the shadow arm resolved (its programs are
    // among the variants).
    const root = mesh(new THREE.MeshStandardMaterial(), 'batch');
    const deadline: PieceDeadline = { fired: false };
    let resolveShadow!: () => void;
    const seen: Array<{ node: THREE.Object3D; deadline: PieceDeadline }> = [];
    const work = linkPieceWork(
      root,
      () => Promise.resolve(),
      () => new Promise<void>((resolve) => (resolveShadow = resolve)),
      (node, handed) => {
        seen.push({ node, deadline: handed });
        return Promise.resolve();
      },
    );
    const piece = work[0](deadline);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([]);
    resolveShadow();
    await piece;
    expect(seen).toEqual([{ node: root, deadline }]);
    expect(seen[0].deadline).toBe(deadline);
  });

  it('resolves the piece only once its settle resolved, so a gate settles no earlier than its slowest variant', async () => {
    const root = mesh(new THREE.MeshStandardMaterial(), 'batch');
    let resolveSettle!: () => void;
    const work = linkPieceWork(
      root,
      () => Promise.resolve(),
      () => Promise.resolve(),
      () => new Promise<void>((resolve) => (resolveSettle = resolve)),
    );
    let done = false;
    const piece = work[0](live).then(() => (done = true));
    for (let index = 0; index < 6; index++) await Promise.resolve();
    expect(done).toBe(false);
    resolveSettle();
    await piece;
    expect(done).toBe(true);
  });

  it('compiles a skinned node of the same material as its own piece: a different program', async () => {
    const skin = new THREE.MeshStandardMaterial();
    const statue = mesh(skin, 'statue');
    const torso = new THREE.SkinnedMesh(new THREE.BufferGeometry(), skin);
    torso.name = 'torso';
    const root = new THREE.Group();
    root.add(statue, torso);
    const compiled: string[] = [];
    const arm = (node: THREE.Object3D) => {
      compiled.push(node.name);
      return Promise.resolve();
    };
    const work = linkPieceWork(root, arm, arm, noSettle);
    expect(work).toHaveLength(2);
    for (const piece of work) await piece(live);
    expect(compiled).toEqual(['statue', 'statue', 'torso', 'torso']);
  });

  it('starts the first colour arm synchronously inside the work call, so the queue books its prologue', () => {
    // The queue's syncMs (and the budget it feeds) stops at the work
    // function's first await: a first arm deferred to a microtask would run
    // outside every unit, unbooked and unpaced, the very cost the cut exists to
    // pace.
    const root = mesh(new THREE.MeshStandardMaterial(), 'batch');
    let started = false;
    const work = linkPieceWork(
      root,
      () => {
        started = true;
        return new Promise(() => {});
      },
      () => Promise.resolve(),
      noSettle,
    );
    void work[0](live);
    expect(started).toBe(true);
  });

  it('is empty for a root without a material carrier', () => {
    expect(linkPieceWork(new THREE.Group(), vi.fn(), vi.fn(), noSettle)).toEqual([]);
  });
});
