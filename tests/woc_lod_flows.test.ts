// The coarser levels of detail through every geometry transform a WOC body's pieces pass
// (src/render/assets/geometry_lod.ts carries them): the rebake and the part merge
// (rig_merge.ts), the palette narrowing (skin_gpu_layout.ts), the armor binder and the store's
// attach (woc_armor_bind.ts, woc_armor_packs.ts), the merged armor (woc_armor_merge.ts) and the
// merged head (woc_head_merge.ts). The rule each one keeps: a transform that keeps the vertex
// order copies the levels, a merge offsets each part's levels exactly as it offsets the part's
// own index, and a merge always folds a piece's SOURCE geometry, whatever level it draws.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const loads = vi.hoisted(() => ({ pending: new Map<string, (gltf: unknown) => void>() }));
vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(
    (url: string) =>
      new Promise((resolve) => {
        loads.pending.set(url, resolve);
      }),
  ),
  releaseGltf: vi.fn(),
}));

import {
  geometryLodLevelOf,
  geometryLodOf,
  geometryLodSourceOf,
  geometryLodVariant,
  setGeometryLod,
} from '../src/render/assets/geometry_lod';
import { mergeSkinnedParts, rebakeGeometry } from '../src/render/characters/rig_merge';
import { optimizeSkinGpuLayout } from '../src/render/characters/skin_gpu_layout';
import { prepareWocArmor, wocRigBindOf } from '../src/render/characters/woc_armor_bind';
import { wocArmorPackUrl } from '../src/render/characters/woc_armor_core';
import {
  mergeWocArmorGeometry,
  type WocArmorMergePart,
} from '../src/render/characters/woc_armor_merge';
import {
  attachWocArmorPack,
  ensureWocArmorPack,
  releaseWocArmorContainer,
  wocArmorPieces,
} from '../src/render/characters/woc_armor_packs';
import type { WocCharacterManifest } from '../src/render/characters/woc_character_manifest';
import {
  mergeWocHeadGeometry,
  type WocHeadMergePiece,
} from '../src/render/characters/woc_head_merge';

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A row of `cells` quads at height `y`: 2 * (cells + 1) vertices, 2 * cells triangles, its
 *  mid level every other quad and its far level the first quad (or as `levels` says). */
function quads(
  cells: number,
  y = 0,
  levels: { mid?: boolean; far?: boolean } = { mid: true, far: true },
): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let i = 0; i <= cells; i++) positions.push(i * 0.1, y, 0, i * 0.1, y + 0.1, 0);
  const index: number[] = [];
  for (let i = 0; i < cells; i++) {
    const a = i * 2;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(
      positions.map(() => 0.5),
      3,
    ),
  );
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((cells + 1) * 4), 2));
  g.setIndex(index);
  const mid = index.filter((_, k) => Math.floor(k / 6) % 2 === 0);
  setGeometryLod(g, {
    mid: levels.mid ? new THREE.BufferAttribute(new Uint16Array(mid), 1) : undefined,
    far: levels.far ? new THREE.BufferAttribute(new Uint16Array(index.slice(0, 6)), 1) : undefined,
  });
  return g;
}

/** Weight every vertex to joint 0. */
function skinned(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) w[i * 4] = 1;
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
  return g;
}

/** Each triangle of `list` over `geometry`'s positions (mapped through `m`), as a sorted key. */
function triangleKeys(
  positions: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  list: ArrayLike<number>,
  m: THREE.Matrix4 = new THREE.Matrix4(),
  flip = false,
): string[] {
  const v = new THREE.Vector3();
  const corner = (i: number): string => {
    v.fromBufferAttribute(positions, i).applyMatrix4(m);
    return [v.x, v.y, v.z].map((c) => c.toFixed(4)).join(',');
  };
  const out: string[] = [];
  for (let k = 0; k + 2 < list.length; k += 3) {
    const a = corner(list[k]);
    const b = corner(list[flip ? k + 2 : k + 1]);
    const c = corner(list[flip ? k + 1 : k + 2]);
    // a triangle is its corners in winding order, from any starting corner
    const turns = [`${a}|${b}|${c}`, `${b}|${c}|${a}`, `${c}|${a}|${b}`].sort();
    out.push(turns[0]);
  }
  return out.sort();
}

const listOf = (attribute: THREE.BufferAttribute | null | undefined): number[] =>
  attribute ? [...attribute.array] : [];

// ---------------------------------------------------------------------------
// rig_merge.ts and skin_gpu_layout.ts
// ---------------------------------------------------------------------------

describe('rebake and palette narrowing keep the vertex order, so they copy the levels', () => {
  it('rebakeGeometry carries a copy of each level', () => {
    const source = quads(4);
    const out = rebakeGeometry(source, new THREE.Matrix4().makeTranslation(1, 2, 3));
    expect(listOf(geometryLodOf(out)?.mid)).toEqual(listOf(geometryLodOf(source)?.mid));
    expect(listOf(geometryLodOf(out)?.far)).toEqual(listOf(geometryLodOf(source)?.far));
    expect(geometryLodOf(out)?.mid).not.toBe(geometryLodOf(source)?.mid);
  });

  it('optimizeSkinGpuLayout carries them onto the geometry it narrows', () => {
    const bone = new THREE.Bone();
    const geometry = skinned(quads(3));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    const root = new THREE.Group();
    root.add(mesh);
    optimizeSkinGpuLayout(root, { keepPalette: true });
    // the joint attribute narrowed to bytes: a new geometry, the same vertices
    expect(mesh.geometry).not.toBe(geometry);
    expect(listOf(geometryLodOf(mesh.geometry)?.mid)).toEqual(listOf(geometryLodOf(geometry)?.mid));
  });

  it('rebakeGeometry of a variant rebakes its source and draws the same level of the result', () => {
    const source = quads(4);
    const out = rebakeGeometry(
      geometryLodVariant(source, 'mid'),
      new THREE.Matrix4().makeTranslation(0, 1, 0),
    );
    expect(geometryLodLevelOf(out)).toBe('mid');
    const rebaked = geometryLodSourceOf(out);
    expect(rebaked).not.toBe(source);
    expect(listOf(rebaked.index)).toEqual(listOf(source.index));
    expect(listOf(out.index)).toEqual(listOf(geometryLodOf(source)?.mid));
  });

  it('mergeSkinnedParts over parts drawn at mid folds their sources and draws the mid', () => {
    const bone = new THREE.Bone();
    const material = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    root.add(bone);
    const skeleton = new THREE.Skeleton([bone]);
    const parts = [skinned(quads(4, 0)), skinned(quads(2, 1, { far: true }))];
    for (const [i, g] of parts.entries()) {
      const mesh = new THREE.SkinnedMesh(geometryLodVariant(g, 'mid'), material);
      mesh.name = `part${i}`;
      root.add(mesh);
      mesh.bind(skeleton);
    }
    mergeSkinnedParts(root);
    const merged = root.children.find((o) => o.name === 'part0_bodymerged') as THREE.SkinnedMesh;
    expect(merged).toBeDefined();
    // the merged mesh draws the level its canonical part drew...
    expect(geometryLodLevelOf(merged.geometry)).toBe('mid');
    const source = geometryLodSourceOf(merged.geometry);
    const pos = source.getAttribute('position');
    // ...over a merge of the parts' level 0, whose mid is each part's mid (or level 0)
    const expectLod0 = parts.flatMap((g) =>
      triangleKeys(g.getAttribute('position'), g.index?.array ?? []),
    );
    expect(triangleKeys(pos, source.index?.array ?? [])).toEqual(expectLod0.sort());
    const expectMid = parts.flatMap((g) =>
      triangleKeys(g.getAttribute('position'), (geometryLodOf(g)?.mid ?? g.index)?.array ?? []),
    );
    expect(triangleKeys(pos, merged.geometry.index?.array ?? [])).toEqual(expectMid.sort());
  });

  it('mergeSkinnedParts offsets each part level exactly like the merged index', () => {
    const bone = new THREE.Bone();
    const material = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    root.add(bone);
    const skeleton = new THREE.Skeleton([bone]);
    const parts = [skinned(quads(4, 0)), skinned(quads(2, 1, { far: true })), skinned(quads(3, 2))];
    for (const [i, g] of parts.entries()) {
      const mesh = new THREE.SkinnedMesh(g, material);
      mesh.name = `part${i}`;
      root.add(mesh);
      mesh.bind(skeleton);
    }
    mergeSkinnedParts(root);
    const merged = root.children.find((o) => o.name === 'part0_bodymerged') as THREE.SkinnedMesh;
    expect(merged).toBeDefined();
    const geometry = merged.geometry;
    const pos = geometry.getAttribute('position');
    const lod = geometryLodOf(geometry);
    // the merged mid draws exactly each part's mid (its level 0 where it has none)
    const expectMid = parts.flatMap((g) =>
      triangleKeys(g.getAttribute('position'), (geometryLodOf(g)?.mid ?? g.index)?.array ?? []),
    );
    expect(triangleKeys(pos, lod?.mid?.array ?? [])).toEqual(expectMid.sort());
    const expectFar = parts.flatMap((g) =>
      triangleKeys(g.getAttribute('position'), geometryLodOf(g)?.far?.array ?? []),
    );
    expect(triangleKeys(pos, lod?.far?.array ?? [])).toEqual(expectFar.sort());
    // and level 0 is untouched: every part's own triangles
    const expectLod0 = parts.flatMap((g) =>
      triangleKeys(g.getAttribute('position'), g.index?.array ?? []),
    );
    expect(triangleKeys(pos, geometry.index?.array ?? [])).toEqual(expectLod0.sort());
  });
});

// ---------------------------------------------------------------------------
// The armor binder and the store's attach
// ---------------------------------------------------------------------------

const manifest: WocCharacterManifest = {
  schemaVersion: 1,
  rigId: 'fixture',
  fit: 'male',
  baseNodes: ['Character_Body'],
  appearance: {},
  defaultAppearance: {},
  armorSlots: { chest: { label: 'Chest' }, head: { label: 'Head' } },
  items: {
    chest: { label: 'Chest', slot: 'chest', set: 'lodkit', nodes: ['Chest', 'Waist'] },
    helm: { label: 'Helm', slot: 'head', set: 'lodkit', nodes: ['Helm'] },
  },
  defaultEquipment: { chest: 'chest', head: 'helm' },
  animationNames: [],
};

/** A rig of two bones (root, head) under `scene`, its skeleton, and a skinned body on it. */
function rig(scene: THREE.Object3D, withBody: boolean): THREE.Skeleton {
  const root = new THREE.Bone();
  root.name = 'root';
  const head = new THREE.Bone();
  head.name = 'head';
  head.position.set(0, 1.5, 0);
  root.add(head);
  scene.add(root);
  scene.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([root, head]);
  if (withBody) {
    const body = new THREE.SkinnedMesh(skinned(quads(2)), new THREE.MeshStandardMaterial());
    body.name = 'Character_Body';
    scene.add(body);
    body.bind(skeleton);
  }
  return skeleton;
}

/** The armor file: a chest and a waist skinned on one material (the binder merges them), and
 *  a helm rigid on the head bone, every piece with its levels. */
function armorFile(): THREE.Group {
  const scene = new THREE.Group();
  const skeleton = rig(scene, false);
  const plate = new THREE.MeshStandardMaterial({ name: 'plate' });
  for (const [name, cells, y] of [
    ['Chest', 4, 1],
    ['Waist', 2, 0.5],
  ] as const) {
    const mesh = new THREE.SkinnedMesh(skinned(quads(cells, y)), plate);
    mesh.name = name;
    scene.add(mesh);
    mesh.bind(skeleton);
  }
  const helm = new THREE.Mesh(quads(3, 0, { mid: true }), plate);
  helm.name = 'Helm';
  scene.getObjectByName('head')?.add(helm);
  return scene;
}

describe('the armor binder and the store', () => {
  it('prepares templates carrying the merged levels and rigid parts over their own geometry', () => {
    const base = new THREE.Group();
    rig(base, true);
    const file = armorFile();
    const chest = file.getObjectByName('Chest') as THREE.SkinnedMesh;
    const waist = file.getObjectByName('Waist') as THREE.SkinnedMesh;
    const helmGeometry = (file.getObjectByName('Helm') as THREE.Mesh).geometry;
    const prepared = prepareWocArmor(cloneSkinned(file), wocRigBindOf(base) as never);
    expect(prepared.templates).toHaveLength(1);
    const template = prepared.templates[0].geometry;
    const pos = template.getAttribute('position');
    // the binder rebakes into the base bind: compare by vertex number, the order it keeps
    const offset = chest.geometry.getAttribute('position').count;
    const expected = [
      ...listOf(geometryLodOf(chest.geometry)?.mid),
      ...listOf(geometryLodOf(waist.geometry)?.mid).map((i) => i + offset),
    ];
    expect(listOf(geometryLodOf(template)?.mid)).toEqual(expected);
    expect(geometryLodOf(template)?.far?.count).toBe(12);
    expect(pos.count).toBe(offset + waist.geometry.getAttribute('position').count);
    // the helm hangs over the parse's own geometry, levels and all
    let rigidGeometry: THREE.BufferGeometry | null = null;
    prepared.rigid[0].node.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) rigidGeometry = (o as THREE.Mesh).geometry;
    });
    expect(rigidGeometry).toBe(helmGeometry);
  });

  it('attaches every part over its shared variant of the level the character draws', async () => {
    const url = wocArmorPackUrl('male', 'lodkit', 'medium');
    ensureWocArmorPack(url);
    loads.pending.get(url)?.({ scene: armorFile(), animations: [] });
    await vi.waitFor(() => expect(loads.pending.has(url)).toBe(true));
    await Promise.resolve();
    const build = (): THREE.Group => {
      const model = new THREE.Group();
      rig(model, true);
      return model;
    };
    const crowd = build();
    const full = build();
    const crowdKit = attachWocArmorPack(crowd, url, 'lodkit', manifest, 'mid');
    const fullKit = attachWocArmorPack(full, url, 'lodkit', manifest, 'lod0');
    expect(crowdKit).not.toBeNull();
    expect(fullKit).not.toBeNull();
    const meshesOf = (container: THREE.Object3D): THREE.Mesh[] => {
      const out: THREE.Mesh[] = [];
      for (const piece of wocArmorPieces(container)) {
        piece.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
        });
      }
      return out.sort((a, b) => (a.name < b.name ? -1 : 1));
    };
    const crowdMeshes = meshesOf(crowdKit as THREE.Group);
    const fullMeshes = meshesOf(fullKit as THREE.Group);
    expect(crowdMeshes.map((m) => m.name)).toEqual(fullMeshes.map((m) => m.name));
    for (const [i, mesh] of crowdMeshes.entries()) {
      const source = fullMeshes[i].geometry;
      expect(geometryLodLevelOf(source), mesh.name).toBe('lod0');
      expect(mesh.geometry, mesh.name).toBe(geometryLodVariant(source, 'mid'));
      expect(geometryLodLevelOf(mesh.geometry), mesh.name).toBe('mid');
      expect(geometryLodSourceOf(mesh.geometry), mesh.name).toBe(source);
    }
    releaseWocArmorContainer(crowdKit as THREE.Group);
    releaseWocArmorContainer(fullKit as THREE.Group);
  });
});

// ---------------------------------------------------------------------------
// The merged armor and the merged head fold sources and carry the levels
// ---------------------------------------------------------------------------

describe('the merged armor', () => {
  /** A part drawing `geometry`, folded as stored or moved and flipped. */
  const part = (
    geometry: THREE.BufferGeometry,
    toBind: THREE.Matrix4 | null = null,
    flip = false,
  ): WocArmorMergePart => ({
    mesh: new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial()),
    toBind,
    normalToBind: toBind ? new THREE.Matrix3().setFromMatrix4(toBind) : null,
    joints: null,
    bone: toBind ? 0 : null,
    flip,
  });

  it('folds each part from its source (level 0 untouched) and carries the offset levels', () => {
    const a = skinned(quads(4, 0));
    const b = skinned(quads(2, 1, { far: true }));
    const mirror = new THREE.Matrix4().makeScale(-1, 1, 1);
    const sources = mergeWocArmorGeometry([part(a), part(b, mirror, true)], 2);
    // the same parts as a crowd character draws them: their mid variants
    const crowd = mergeWocArmorGeometry(
      [part(geometryLodVariant(a, 'mid')), part(geometryLodVariant(b, 'mid'), mirror, true)],
      2,
    );
    expect(listOf(crowd.index)).toEqual(listOf(sources.index));
    expect(listOf(geometryLodOf(crowd)?.mid)).toEqual(listOf(geometryLodOf(sources)?.mid));
    const pos = sources.getAttribute('position');
    const expectMid = [
      ...triangleKeys(a.getAttribute('position'), geometryLodOf(a)?.mid?.array ?? []),
      // b has no mid: its level 0, mirrored and flipped as the fold flips it
      ...triangleKeys(b.getAttribute('position'), b.index?.array ?? [], mirror, true),
    ].sort();
    expect(triangleKeys(pos, geometryLodOf(sources)?.mid?.array ?? [])).toEqual(expectMid);
    const expectFar = [
      ...triangleKeys(a.getAttribute('position'), geometryLodOf(a)?.far?.array ?? []),
      ...triangleKeys(b.getAttribute('position'), geometryLodOf(b)?.far?.array ?? [], mirror, true),
    ].sort();
    expect(triangleKeys(pos, geometryLodOf(sources)?.far?.array ?? [])).toEqual(expectFar);
    // a variant of the merged geometry draws that list over the same buffers
    const variant = geometryLodVariant(sources, 'mid');
    expect(variant.getAttribute('position')).toBe(pos);
  });
});

describe('the merged head', () => {
  /** A piece mesh drawing `geometry` with a face morph posed, placed by `toRoot`. */
  const piece = (
    geometry: THREE.BufferGeometry,
    toRoot: THREE.Matrix4,
    slot: number,
  ): WocHeadMergePiece => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    return { mesh, toRoot, slot, flatUv: null };
  };

  it('draws at mid exactly the union of the pieces mid triangles, folding their sources', () => {
    const base = quads(6, 0);
    // a morph that moves the base up: the fold bakes it, and it rides every level alike
    const n = base.getAttribute('position').count;
    const delta = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) delta[i * 3 + 1] = 0.5;
    base.morphAttributes.position = [new THREE.Float32BufferAttribute(delta, 3)];
    base.morphTargetsRelative = true;
    const brow = quads(2, 1, { far: true });
    const mirrored = new THREE.Matrix4().makeScale(-1, 1, 1);
    const pieces = (draw: (g: THREE.BufferGeometry) => THREE.BufferGeometry) => {
      const p = [
        piece(draw(base), new THREE.Matrix4().makeTranslation(0, 2, 0), 0),
        piece(draw(brow), mirrored, 1),
      ];
      (p[0].mesh as THREE.Mesh).morphTargetInfluences = [1];
      return p;
    };
    const full = mergeWocHeadGeometry(pieces((g) => g));
    const crowd = mergeWocHeadGeometry(pieces((g) => geometryLodVariant(g, 'mid')));
    // a crowd character folds the same buffer: level 0 and every level match
    expect(listOf(crowd.index)).toEqual(listOf(full.index));
    expect(listOf(geometryLodOf(crowd)?.mid)).toEqual(listOf(geometryLodOf(full)?.mid));
    expect([...crowd.getAttribute('position').array]).toEqual([
      ...full.getAttribute('position').array,
    ]);
    // the merged mid, as positions: the base's mid (posed and placed) and the brow's level 0
    // (it has no mid), mirrored and flipped as the fold flips it
    const posed = new THREE.BufferAttribute(
      new Float32Array(base.getAttribute('position').array).map((v, k) =>
        k % 3 === 1 ? v + 0.5 : v,
      ),
      3,
    );
    const expected = [
      ...triangleKeys(
        posed,
        geometryLodOf(base)?.mid?.array ?? [],
        new THREE.Matrix4().makeTranslation(0, 2, 0),
      ),
      ...triangleKeys(brow.getAttribute('position'), brow.index?.array ?? [], mirrored, true),
    ].sort();
    expect(
      triangleKeys(full.getAttribute('position'), geometryLodOf(full)?.mid?.array ?? []),
    ).toEqual(expected);
    // and its far level: the base's far, the brow's far
    const expectFar = [
      ...triangleKeys(
        posed,
        geometryLodOf(base)?.far?.array ?? [],
        new THREE.Matrix4().makeTranslation(0, 2, 0),
      ),
      ...triangleKeys(
        brow.getAttribute('position'),
        geometryLodOf(brow)?.far?.array ?? [],
        mirrored,
        true,
      ),
    ].sort();
    expect(
      triangleKeys(full.getAttribute('position'), geometryLodOf(full)?.far?.array ?? []),
    ).toEqual(expectFar);
  });

  it('carries no level when no piece has one', () => {
    const plain = quads(2, 0, {});
    const out = mergeWocHeadGeometry([
      piece(plain, new THREE.Matrix4(), 0),
      piece(quads(1, 1, {}), new THREE.Matrix4(), 1),
    ]);
    expect(geometryLodOf(out)).toBeNull();
    expect(geometryLodVariant(out, 'mid')).toBe(out);
  });
});
