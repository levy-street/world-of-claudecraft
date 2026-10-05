// @vitest-environment happy-dom
// The WOC far LOD wears the near body's modular head, through the real
// CharacterVisual far path with only asset IO stubbed (woc_far_bake.ts,
// woc_far_head.ts, woc_far_tint.ts): the whole head is ONE far group drawn by the
// merged tint layer (every piece one material can draw folded into it, each vertex
// tagged with the slot of its material, a flat-coloured piece on the atlas's white
// cell), a piece the merged material cannot draw keeps a group of its own, the
// chosen colours ride the layer's uniforms (a colour change is a uniform write),
// the face the near head draws is frozen into the far pose (chin, tuck, bald crown,
// the helm's raised crown), close faces share one bake, a body still waiting for
// its head draws no far mesh at all, and the body size carries into the far band.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WocFarBake } from '../src/render/characters/woc_far_bake';
import type { WocFarHeadTint } from '../src/render/characters/woc_far_tint';
import { wocHeadTintRef } from '../src/render/characters/woc_head_look_core';
import {
  WOC_HEAD_MERGE_LAYER,
  WOC_HEAD_MERGE_MAX_SLOTS,
  WOC_HEAD_MERGE_ROLE_CODE,
  WOC_HEAD_MERGE_ROLES,
} from '../src/render/characters/woc_head_merge_core';
import type { Entity } from '../src/sim/types';
// The fixture body, its armor and head files, the stubbed loader and the real visual
// built on them are shared with the merged-draw suite (tests/woc_merge_visual.test.ts).
import {
  BALL_L,
  BASE,
  BASE_DELTA,
  BOX,
  BOXED,
  BROW_L,
  DEFAULT_MATERIALS,
  DEFAULT_MESHES,
  FLAT_MESHES,
  FULL_PIERCINGS,
  wocVisualHarness as harness,
  IDLE,
  KEY,
  LINER,
  LINER_CHIN_DELTA,
  LINER_L,
  LINER_R,
  LIP_RING,
  meshUv,
  NOSE,
  player,
  QUIFF_SCALP,
  QUIFF_STRANDS,
  releaseWocVisualHarness,
  SWEPT,
  TEXTURED_MESHES,
  UNDERCUT_SCALP,
  UNDERCUT_STRANDS,
  WHITE,
  type WocHarnessVisual,
  type WocVisualHarness,
} from './helpers/woc_visual_harness';

type Harness = WocVisualHarness;
type Visual = WocHarnessVisual;

function far(root: THREE.Object3D): THREE.Mesh {
  const mesh = root.getObjectByName('character_far_mesh') as THREE.Mesh | undefined;
  if (!mesh) throw new Error('no far mesh');
  return mesh;
}

function farMaterials(root: THREE.Object3D): THREE.Material[] {
  const m = far(root).material;
  return Array.isArray(m) ? m : [m];
}

const mapName = (m: THREE.Material): string => (m as THREE.MeshStandardMaterial).map?.name ?? '';

/** The far material drawing the group whose map is named `name`. */
function farMaterialFor(root: THREE.Object3D, name: string): THREE.Material {
  const hit = farMaterials(root).find((m) => mapName(m) === name);
  if (!hit) throw new Error(`no far group draws ${name}`);
  return hit;
}

/** The vertices the far group on material `at` draws (one run of the index buffer). */
function groupVertices(geo: THREE.BufferGeometry, at: number): number[] {
  const groups = geo.groups.filter((g) => g.materialIndex === at);
  if (groups.length !== 1 || !geo.index) throw new Error(`far group ${at} is not one run`);
  const seen = new Set<number>();
  for (let i = groups[0].start; i < groups[0].start + groups[0].count; i++) {
    seen.add(geo.index.getX(i));
  }
  return [...seen];
}

/** The far vertices cut from the fixture mesh tagged with `uv`. */
function verticesAt(geo: THREE.BufferGeometry, uv: readonly [number, number]): number[] {
  const attr = geo.getAttribute('uv');
  const out: number[] = [];
  for (let i = 0; i < attr.count; i++) {
    if (attr.getX(i) === uv[0] && attr.getY(i) === uv[1]) out.push(i);
  }
  return out;
}

/** The bake a visual's far mesh is drawn from. */
function farBake(v: Visual): WocFarBake {
  const lease = (v as unknown as { wocFarLease: { bake: WocFarBake } | null }).wocFarLease;
  if (!lease) throw new Error('the visual holds no far bake');
  return lease.bake;
}

/** The far head group: the material that draws it, its slot table and its vertices. */
function farHead(v: Visual) {
  const bake = farBake(v);
  const at = bake.tints.findIndex((t) => t !== null && 'slots' in t);
  if (at < 0) throw new Error('the far mesh has no merged head group');
  return {
    at,
    tint: bake.tints[at] as WocFarHeadTint,
    material: farMaterials(v.root)[at],
    vertices: groupVertices(far(v.root).geometry, at),
  };
}

/** Whether the far mesh has a merged head group at all. */
const hasFarHead = (v: Visual): boolean => farBake(v).tints.some((t) => t !== null && 'slots' in t);

/** The FILE material a hung head mesh draws (on the live rig, which shares it with the
 *  throwaway the far bake reads). */
function fileMaterial(h: Harness, v: Visual, mesh: string): THREE.Material {
  const node = v.root.getObjectByName(mesh);
  const material = node ? h.heads.wocHeadFileMaterial(node) : null;
  if (!material) throw new Error(`${mesh} is no hung head mesh`);
  return material;
}

/** The slot of the far head's table that stands for a head mesh's material (-1: none). */
function slotOf(h: Harness, v: Visual, mesh: string): number {
  const uuid = fileMaterial(h, v, mesh).uuid;
  return farHead(v).tint.slots.findIndex((slot) => slot.material === uuid);
}

/** The head meshes the far bake draws (the drawn pieces' meshes), on the live rig. */
function drawnHeadMeshes(h: Harness, v: Visual): THREE.Mesh[] {
  const parts = (v as unknown as { wocFarParts: ReadonlySet<string> }).wocFarParts;
  const out: THREE.Mesh[] = [];
  for (const name of parts) {
    if (!name.startsWith('WocHead_')) continue;
    v.root.getObjectByName(name)?.traverse((o) => {
      if (h.heads.wocHeadFileMaterial(o)) out.push(o as THREE.Mesh);
    });
  }
  return out;
}

/** Every distinct file material the drawn head pieces wear: the far groups the head
 *  cost when each material was a group. */
function drawnHeadMaterials(h: Harness, v: Visual): number {
  return new Set(drawnHeadMeshes(h, v).map((mesh) => h.heads.wocHeadFileMaterial(mesh))).size;
}

/** How many vertices the named head meshes have between them, read off the pack's own
 *  geometry on the live rig (never off the bake under test). */
function vertexCount(v: Visual, ...meshes: readonly string[]): number {
  let n = 0;
  for (const name of meshes) {
    const mesh = v.root.getObjectByName(name) as THREE.Mesh | undefined;
    if (!mesh?.geometry) throw new Error(`${name} is no hung head mesh`);
    n += mesh.geometry.getAttribute('position').count;
  }
  return n;
}

/** The mean baked position of some far vertices. */
function centroidOf(root: THREE.Object3D, at: readonly number[]): THREE.Vector3 {
  if (at.length === 0) throw new Error('no far vertex to average');
  const pos = far(root).geometry.getAttribute('position');
  const c = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (const i of at) c.add(p.fromBufferAttribute(pos, i));
  return c.divideScalar(at.length);
}

/** The mean baked position of the far vertices cut from one textured fixture mesh. */
function farCentroid(root: THREE.Object3D, mesh: string): THREE.Vector3 {
  return centroidOf(root, verticesAt(far(root).geometry, meshUv(mesh)));
}

afterEach(() => releaseWocVisualHarness());

describe('the WOC far LOD wears the near head', () => {
  it('freezes the face the near head draws: chin, scalp tuck and bald crown', async () => {
    const h = await harness();
    const shape = (chinWidth: number) => ({ ...h.DEFAULT_APPEARANCE.headShape, chinWidth });
    const plain = h.farVisual({
      ...h.DEFAULT_APPEARANCE,
      headHair: 'topknot',
      headShape: shape(0),
    });
    const y0 = farCentroid(plain.root, BASE).y;
    const chin = h.farVisual({
      ...h.DEFAULT_APPEARANCE,
      headHair: 'topknot',
      headShape: shape(1),
    });
    const tucked = h.farVisual({
      ...h.DEFAULT_APPEARANCE,
      headHair: 'swept',
      headShape: shape(0),
    });
    const bald = h.farVisual({ ...h.DEFAULT_APPEARANCE, headHair: 'bald', headShape: shape(0) });
    const s = h.normScale;
    expect(farCentroid(chin.root, BASE).y - y0).toBeCloseTo(BASE_DELTA.FS_Chin_Softness * s, 5);
    expect(farCentroid(tucked.root, BASE).y - y0).toBeCloseTo(BASE_DELTA.FS_Tuck_swept * s, 5);
    expect(farCentroid(bald.root, BASE).y - y0).toBeCloseTo(BASE_DELTA.FS_Bald_Crown * s, 5);
    // a flat-coloured piece is posed like any other: the liners (the vertices on the
    // atlas's white cell) carry a chin morph of their own, and the uv they are handed
    // for the fold keeps the posed positions
    const liners = (v: Visual): number =>
      centroidOf(v.root, verticesAt(far(v.root).geometry, WHITE)).y;
    expect(liners(chin) - liners(plain)).toBeCloseTo(LINER_CHIN_DELTA * s, 5);
    // the default look's chin (0.65) is baked too, not the pack's zero
    const byDefault = h.farVisual({ ...h.DEFAULT_APPEARANCE, headHair: 'topknot' });
    expect(farCentroid(byDefault.root, BASE).y - y0).toBeCloseTo(
      0.65 * BASE_DELTA.FS_Chin_Softness * s,
      5,
    );
    for (const v of [plain, chin, tucked, bald, byDefault]) v.dispose();
  });

  it('freezes the bald crown a hair-hiding helm raises on the near head', async () => {
    const h = await harness();
    const app = {
      ...h.DEFAULT_APPEARANCE,
      headHair: 'topknot',
      headShape: { ...h.DEFAULT_APPEARANCE.headShape, chinWidth: 0 },
    };
    const bare = h.farVisual(app);
    const helmed = h.farVisual(app, { helmet: 'some-helm' });
    const s = h.normScale;
    expect(farCentroid(helmed.root, BASE).y - farCentroid(bare.root, BASE).y).toBeCloseTo(
      BASE_DELTA.FS_Bald_Crown * s,
      5,
    );
    bare.dispose();
    helmed.dispose();
  });

  it('shares one bake across a far-grid cell and bakes a new face across cells', async () => {
    const h = await harness();
    const at = (chinWidth: number) =>
      h.farVisual({
        ...h.DEFAULT_APPEARANCE,
        headShape: { ...h.DEFAULT_APPEARANCE.headShape, chinWidth },
      });
    const a = at(0.66);
    const b = at(0.7);
    const c = at(0.8);
    expect(far(b.root).geometry).toBe(far(a.root).geometry);
    expect(far(c.root).geometry).not.toBe(far(a.root).geometry);
    for (const v of [a, b, c]) v.dispose();
  });

  it('re-bakes a live body whose face crosses the grid, and only then', async () => {
    const h = await harness();
    const app = (chinWidth: number) => ({
      ...h.DEFAULT_APPEARANCE,
      headShape: { ...h.DEFAULT_APPEARANCE.headShape, chinWidth },
    });
    const v = h.farVisual(app(0.66));
    const first = far(v.root);
    v.setWocHeadLook(app(0.7)); // same cell: no work
    v.setFar(true);
    expect(far(v.root)).toBe(first);
    expect(h.gates).toHaveLength(0);
    v.setWocHeadLook(app(1));
    h.nextFrame();
    v.setFar(true);
    expect(h.gates).toHaveLength(1); // the new face mints behind the far gate
    expect(far(v.root)).not.toBe(first);
    expect(far(v.root).visible).toBe(false); // the rig stands in while it links
    v.dispose();
  });

  it("bakes the far head only once the look's files are hung: never a bald or partial head", async () => {
    const quiff = 'models/chars/players/woc/head_type_a_hair_quiff.glb';
    const h = await harness({ headPack: true, held: [quiff] });
    const idle = {
      speed: 0,
      moving: false,
      running: false,
      airborne: false,
      backwards: false,
      dead: false,
      casting: false,
      swimming: false,
      submerged: false,
      swimPitch: 0,
      wading: false,
      sitting: false,
    };
    // the player's hairstyle is still streaming: the body waits for its head, so neither
    // its rig nor its far mesh draws, and the far set holds no head piece
    const v = h.farVisual({ ...h.DEFAULT_APPEARANCE, headHair: 'quiff' });
    expect(hasFarHead(v)).toBe(false);
    expect(farMaterials(v.root).map(mapName)).toEqual(['body']);
    expect(far(v.root).visible).toBe(false);
    expect(v.root.getObjectByName('character_model_wrap')?.visible).toBe(false);
    // the file lands: the next frame hangs it behind the gate, the body still undrawn
    h.releases.get(quiff)?.();
    await vi.waitFor(() => expect(h.heads.wocHeadFileResident(quiff)).toBe(true));
    v.update(0.05, idle, true);
    expect(h.gates).toHaveLength(1);
    expect(far(v.root).visible).toBe(false);
    expect(v.root.getObjectByName('character_model_wrap')?.visible).toBe(false);
    // revealed: the head goes live, the next frame re-dresses, and the far set re-bakes
    for (const gate of h.gates.splice(0)) gate.settle();
    v.update(0.05, idle, true);
    h.nextFrame();
    v.setFar(true);
    for (const gate of h.gates.splice(0)) gate.settle();
    v.setFar(true);
    const head = farHead(v);
    expect(mapName(head.material)).toBe('atlas');
    expect(slotOf(h, v, BASE)).toBeGreaterThanOrEqual(0);
    expect(slotOf(h, v, QUIFF_STRANDS)).toBeGreaterThanOrEqual(0);
    expect(slotOf(h, v, QUIFF_SCALP)).toBeGreaterThanOrEqual(0);
    expect(h.wocHeadMergedTintOf(head.material)?.hair.value?.name).toBe(QUIFF_STRANDS);
    expect(h.wocHeadMergedTintOf(head.material)?.scalp.value?.name).toBe(QUIFF_SCALP);
    // and the body draws: its far mesh stands in, complete with its head
    expect(far(v.root).visible).toBe(true);
    v.dispose();
  });

  it('carries the body size into the far band', async () => {
    const h = await harness();
    const v = h.farVisual({ ...h.DEFAULT_APPEARANCE, bodyScale: 0.95 });
    expect(v.setBodyScale(0.95)).toBe(true);
    v.root.updateMatrixWorld(true);
    const scale = new THREE.Vector3().setFromMatrixScale(far(v.root).matrixWorld);
    expect(scale.y).toBeCloseTo(0.95, 6);
    const proxy = v.root.getObjectByName('character_shadow_proxy');
    if (proxy)
      expect(new THREE.Vector3().setFromMatrixScale(proxy.matrixWorld).y).toBeCloseTo(0.95, 6);
    v.dispose();
  });
});

describe('the WOC far head is ONE draw', () => {
  it('bakes the whole head as one group, whatever the number of pieces', async () => {
    const h = await harness();
    const worn = { chest: 'some-chest' };
    const cases = [
      // the default look: thirteen meshes on twelve materials (the liners share one)
      { v: h.farVisual({ ...h.DEFAULT_APPEARANCE }, worn), meshes: 13, materials: 12 },
      // bald and clean shaven: two fewer
      {
        v: h.farVisual({ ...h.DEFAULT_APPEARANCE, headHair: 'bald', headBeard: 'none' }, worn),
        meshes: 11,
        materials: 10,
      },
      // a hairstyle of two meshes: one more
      {
        v: h.farVisual({ ...h.DEFAULT_APPEARANCE, headHair: 'undercut' }, worn),
        meshes: 14,
        materials: 13,
      },
    ];
    expect(cases[0].meshes).toBe(DEFAULT_MESHES.length);
    expect(cases[0].materials).toBe(DEFAULT_MATERIALS);
    for (const { v, meshes, materials } of cases) {
      const geo = far(v.root).geometry;
      // a group per material was `materials` head groups beside the body's and the
      // armor's: the head is one now
      expect(drawnHeadMaterials(h, v)).toBe(materials);
      expect(geo.groups).toHaveLength(3);
      expect(farMaterials(v.root)).toHaveLength(3);
      expect(farMaterials(v.root).map(mapName).sort()).toEqual(['armor', 'atlas', 'body']);
      const head = farHead(v);
      const drawn = drawnHeadMeshes(h, v);
      expect(drawn).toHaveLength(meshes);
      expect(head.vertices).toHaveLength(
        drawn.reduce((n, mesh) => n + mesh.geometry.getAttribute('position').count, 0),
      );
      expect(head.tint.slots).toHaveLength(materials);
      // drawn two sided with no piece baked twice: the one sided head's back faces are
      // the merged layer's to drop (pinned with its rows below)
      expect(fileMaterial(h, v, BASE).side).toBe(THREE.FrontSide);
      expect(head.material.side).toBe(THREE.DoubleSide);
      // three runs that cover the index buffer exactly once, a material each
      const runs = [...geo.groups].sort((a, b) => a.start - b.start);
      let next = 0;
      for (const run of runs) {
        expect(run.start).toBe(next);
        next += run.count;
      }
      expect(next).toBe(geo.index?.count);
      expect(runs.map((run) => run.materialIndex).sort()).toEqual([0, 1, 2]);
    }
    for (const { v } of cases) v.dispose();
  });

  it('tags every head vertex with the slot of its material, and every other vertex with 0', async () => {
    const h = await harness();
    const v = h.farVisual({ ...h.DEFAULT_APPEARANCE }, { chest: 'some-chest' });
    const geo = far(v.root).geometry;
    const head = farHead(v);
    const inHead = new Set(head.vertices);
    const slot = geo.getAttribute('aWocHmSlot');
    expect(slot.itemSize).toBe(1);
    expect(slot.count).toBe(geo.getAttribute('position').count);
    // an index, read as the number it is (a normalized byte would arrive as slot / 255)
    expect(slot.normalized).toBe(false);
    // it is the attribute the head material's vertex stage reads: the layer names it in
    // woc_head_tint.ts and the bake writes it in woc_far_head.ts, and on two names the
    // far head would draw every vertex as slot 0
    const stage = {
      uniforms: {},
      vertexShader: 'void main() {\n#include <begin_vertex>\n}',
      fragmentShader: 'void main() {\n#include <map_fragment>\n}',
    };
    head.material.onBeforeCompile(stage as never, {} as never);
    const declared = [...stage.vertexShader.matchAll(/attribute \w+ (\w+);/g)].map((m) => m[1]);
    expect(declared).toEqual(['aWocHmSlot']);
    // each textured mesh's vertices (found by the uv they were cut with) sit in the head
    // group and carry the slot that stands for that mesh's own material
    const used = new Set<number>();
    const sizes = new Set<number>();
    for (const mesh of TEXTURED_MESHES) {
      const at = verticesAt(geo, meshUv(mesh));
      const want = slotOf(h, v, mesh);
      expect(at, mesh).toHaveLength(vertexCount(v, mesh));
      expect(want, mesh).toBeGreaterThanOrEqual(0);
      expect(
        at.every((i) => inHead.has(i) && slot.getX(i) === want),
        mesh,
      ).toBe(true);
      used.add(want);
      sizes.add(at.length);
    }
    // (the fixture's meshes are not all one size, or a slot written with another mesh's
    // vertex count would still land on the right vertices)
    expect(sizes.size).toBeGreaterThan(1);
    // the two liners share one material, and so one slot: the head's other vertices
    const liner = slotOf(h, v, LINER_L);
    expect(liner).toBeGreaterThanOrEqual(0);
    expect(slotOf(h, v, LINER_R)).toBe(liner);
    expect(used.has(liner)).toBe(false);
    expect(head.vertices.filter((i) => slot.getX(i) === liner)).toHaveLength(
      vertexCount(v, ...FLAT_MESHES),
    );
    used.add(liner);
    // twelve materials, twelve slots, numbered from 0: one each, no gap
    expect([...used].sort((a, b) => a - b)).toEqual(
      Array.from({ length: DEFAULT_MATERIALS }, (_, i) => i),
    );
    // the body and the armor read slot 0: only the head group's material reads the tag
    const others: number[] = [];
    for (let i = 0; i < slot.count; i++) if (!inHead.has(i)) others.push(i);
    expect(others).toHaveLength(2 * BOX);
    expect(others.every((i) => slot.getX(i) === 0)).toBe(true);
    v.dispose();
  });

  it("puts a flat-coloured piece on the atlas's white cell, in the bake only", async () => {
    const h = await harness();
    const v = h.farVisual({ ...h.DEFAULT_APPEARANCE });
    const geo = far(v.root).geometry;
    const slot = geo.getAttribute('aWocHmSlot');
    const liner = slotOf(h, v, LINER_L);
    // exactly the liners' vertices sit on the white cell: the merged material samples the
    // atlas for every slot, and a flat colour must read white there
    const white = verticesAt(geo, WHITE);
    expect(white).toHaveLength(vertexCount(v, ...FLAT_MESHES));
    expect(white.every((i) => slot.getX(i) === liner)).toBe(true);
    // the pack's own geometry, shared by every character, is never written: it has no uv
    const packed = v.root.getObjectByName(LINER_L) as THREE.Mesh;
    expect(packed.geometry.getAttribute('uv')).toBeUndefined();
    v.dispose();
  });

  it('draws the head group with the merged layer: the look colours, a row per slot, the hair and beard textures', async () => {
    const h = await harness();
    const app = {
      ...h.DEFAULT_APPEARANCE,
      hairHue: 0,
      hairSat: 1,
      hairLight: 0.5,
      skinHue: 24,
      skinSat: 0.4,
      skinLight: 0.2,
    };
    const v = h.farVisual(app, { chest: 'some-chest' });
    const head = farHead(v);
    const u = h.wocHeadMergedTintOf(head.material);
    if (!u) throw new Error('the far head group does not wear the merged layer');
    expect(h.wocHeadTintOf(head.material)).toBeNull();
    expect(head.material.customProgramCacheKey()).toContain('woc_head_tint|merged|');
    // its source's name earns no worn detail layer on the tier derivation, as no folded
    // piece's does (a piece whose name would is left out: woc_head_merge.ts mergeable)
    expect(head.material.name).toBe('woc_head_merged');
    expect(h.riggedWornFamilyFor(head.material.name)).toBeNull();
    // the core atlas rides `map`; the hairstyle's and the beard's textures their own
    // samplers (this cut has no scalp cap of its own)
    expect(mapName(head.material)).toBe('atlas');
    expect(u.hair.value?.name).toBe(SWEPT);
    expect(u.beard.value?.name).toBe(BOXED);
    expect(u.scalp.value).toBeNull();
    // the look's four colours, at full strength
    expect(u.mix.value).toBe(1);
    const colors = h.colorsOf(app);
    WOC_HEAD_MERGE_ROLES.forEach((role, i) => {
      expect(u.tints.value[i].toArray(), role).toEqual(colors[role]);
    });
    // one row per slot: its tint role and reference, and the surface the FAR tier derives
    // for its own material, relative to the merged material's own
    const base = h.surfaceOf(head.material);
    const rows = new Map<string, number>();
    for (const mesh of DEFAULT_MESHES) rows.set(mesh, slotOf(h, v, mesh));
    expect(new Set(rows.values()).size).toBe(head.tint.slots.length);
    for (const [mesh, i] of rows) {
      const file = fileMaterial(h, v, mesh);
      const ref = wocHeadTintRef('a', file.name);
      expect(u.ref.value[i].toArray(), mesh).toEqual(
        ref ? [...ref.ref, WOC_HEAD_MERGE_ROLE_CODE[ref.role]] : [0, 0, 0, 0],
      );
      const own = h.farSurface(file);
      expect(u.col.value[i].toArray(), mesh).toEqual([
        own.color[0] / base.color[0],
        own.color[1] / base.color[1],
        own.color[2] / base.color[2],
        head.tint.slots[i].layer,
      ]);
      expect(u.emi.value[i].toArray(), mesh).toEqual([
        own.emissive[0] - base.emissive[0],
        own.emissive[1] - base.emissive[1],
        own.emissive[2] - base.emissive[2],
        own.roughness,
      ]);
      // ...its metalness, and whether its own material drew its front faces only
      expect(u.surf.value[i].toArray(), mesh).toEqual([
        own.metalness,
        file.side === THREE.DoubleSide ? 0 : 1,
      ]);
    }
    // ...which on this tier reads: each role tinted against its own reference, the hair
    // and the beard on their own textures, the liner untinted, flat-coloured and a little
    // metallic, and every roughness the far tier's (the body band holds the liner's 0.95
    // down to 0.9), never the file's raw value nor the merged material's own
    const row = (mesh: string): number => rows.get(mesh) ?? -1;
    expect(u.ref.value[row(BASE)].w).toBe(WOC_HEAD_MERGE_ROLE_CODE.skin);
    expect(u.ref.value[row(SWEPT)].w).toBe(WOC_HEAD_MERGE_ROLE_CODE.hair);
    expect(u.ref.value[row(BROW_L)].w).toBe(WOC_HEAD_MERGE_ROLE_CODE.brow);
    expect(u.ref.value[row(BALL_L)].w).toBe(WOC_HEAD_MERGE_ROLE_CODE.eye);
    expect(u.ref.value[row(LINER_L)].w).toBe(0);
    expect(u.col.value[row(BASE)].toArray()).toEqual([1, 1, 1, WOC_HEAD_MERGE_LAYER.atlas]);
    expect(u.col.value[row(SWEPT)].w).toBe(WOC_HEAD_MERGE_LAYER.hair);
    expect(u.col.value[row(BOXED)].w).toBe(WOC_HEAD_MERGE_LAYER.beard);
    expect(u.col.value[row(LINER_L)].toArray()).toEqual([...LINER, WOC_HEAD_MERGE_LAYER.atlas]);
    expect(u.surf.value[row(LINER_L)].x).toBe(0.25);
    expect(u.surf.value[row(BASE)].x).toBe(0);
    expect(u.emi.value[row(LINER_L)].w).toBe(0.9);
    expect(u.emi.value[row(BASE)].w).toBe(0.6);
    expect(u.emi.value[row(SWEPT)].w).toBe(0.72);
    // the one sided head and eyeballs among two sided brows, hair and liner: the group is
    // drawn two sided and the layer's one sided variant drops their back faces, which is
    // what culling did when each was a draw
    expect(u.surf.value[row(BASE)].y).toBe(1);
    expect(u.surf.value[row(BALL_L)].y).toBe(1);
    expect(u.surf.value[row(BROW_L)].y).toBe(0);
    expect(u.surf.value[row(SWEPT)].y).toBe(0);
    expect(u.surf.value[row(LINER_L)].y).toBe(0);
    expect(u.oneSided).toBe(true);
    expect(head.material.defines).toHaveProperty('WOC_HM_ONE_SIDED');
    // the rows past the table stay inert
    for (let i = head.tint.slots.length; i < WOC_HEAD_MERGE_MAX_SLOTS; i++) {
      expect(u.ref.value[i].toArray()).toEqual([0, 0, 0, 0]);
      expect(u.col.value[i].toArray()).toEqual([1, 1, 1, 0]);
    }
    // the body's own atlas still takes the skin tint against the body's own reference,
    // through the suit skin layer (its own program), at full strength on its own suit
    const bodyMat = farMaterialFor(v.root, 'body');
    const body = h.wocHeadTintOf(bodyMat);
    expect(body?.role).toBe('skin');
    expect(body?.surface).toBe('suit');
    expect(body?.mix.value).toBe(1);
    expect(bodyMat.customProgramCacheKey()).toContain('woc_head_tint|skin_suit|');
    expect(body?.ref.value.toArray()).toEqual([...h.WOC_BODY_SKIN_REF.a.ref]);
    expect(body?.tint.value.toArray()).toEqual(colors.skin);
    // the armor keeps its own colours: no layer at all
    const armor = farMaterialFor(v.root, 'armor');
    expect(h.wocHeadTintOf(armor)).toBeNull();
    expect(h.wocHeadMergedTintOf(armor)).toBeNull();
    v.dispose();
  });

  it('shares one bake and one program between two characters, each on its own colours', async () => {
    const h = await harness();
    const red = { ...h.DEFAULT_APPEARANCE, hairHue: 0, hairSat: 1, hairLight: 0.5 };
    const blue = { ...red, hairHue: 240 };
    const a = h.farVisual(red, { chest: 'some-chest' });
    const b = h.farVisual(blue, { chest: 'some-chest' });
    // the same parts and face: one baked mesh, its slot table included
    expect(far(b.root).geometry).toBe(far(a.root).geometry);
    expect(farBake(b)).toBe(farBake(a));
    // two characters, two clones, ONE program key (the colours are uniforms)
    const headA = farHead(a).material;
    const headB = farHead(b).material;
    expect(headA).not.toBe(headB);
    expect(headA.customProgramCacheKey()).toBe(headB.customProgramCacheKey());
    const hair = WOC_HEAD_MERGE_ROLES.indexOf('hair');
    expect(h.wocHeadMergedTintOf(headA)?.tints.value[hair].toArray()).toEqual(h.colorsOf(red).hair);
    expect(h.wocHeadMergedTintOf(headB)?.tints.value[hair].toArray()).toEqual(
      h.colorsOf(blue).hair,
    );
    // the untinted armor is the shared far clone itself
    expect(farMaterialFor(a.root, 'armor')).toBe(farMaterialFor(b.root, 'armor'));
    a.dispose();
    b.dispose();
  });

  it('keeps the back-face drop out of a head whose every piece is two sided', async () => {
    // Type B's head: nothing to drop, so its far head links the variant without the drop
    const h = await harness({ headPack: true, allTwoSided: true });
    const v = h.farVisual({ ...h.DEFAULT_APPEARANCE });
    const head = farHead(v);
    const u = h.wocHeadMergedTintOf(head.material);
    expect(fileMaterial(h, v, BASE).side).toBe(THREE.DoubleSide);
    expect(head.tint.slots.every((slot) => !slot.oneSided)).toBe(true);
    expect(u?.oneSided).toBe(false);
    expect(head.material.defines ?? {}).not.toHaveProperty('WOC_HM_ONE_SIDED');
    for (let i = 0; i < head.tint.slots.length; i++) expect(u?.surf.value[i].y).toBe(0);
    v.dispose();
  });

  it('recolours a baked far body in place: a uniform write, never a bake, a link or a material', async () => {
    const h = await harness();
    const app = { ...h.DEFAULT_APPEARANCE, hairHue: 0, hairSat: 1 };
    const v = h.farVisual(app);
    const mesh = far(v.root);
    const before = [...farMaterials(v.root)];
    const head = farHead(v).material;
    const key = head.customProgramCacheKey();
    const next = { ...app, hairHue: 120, skinLight: 0.15, eyeHue: 200 };
    expect(v.setWocHeadLook(next)).toBe(true);
    v.setFar(true);
    expect(far(v.root)).toBe(mesh);
    expect(h.gates).toHaveLength(0);
    // the very materials it drew with, the head's included
    const after = farMaterials(v.root);
    expect(after).toHaveLength(before.length);
    expect(after.every((m, i) => m === before[i])).toBe(true);
    expect(head.customProgramCacheKey()).toBe(key);
    const u = h.wocHeadMergedTintOf(head);
    const colors = h.colorsOf(next);
    expect(colors.hair).not.toEqual(h.colorsOf(app).hair);
    WOC_HEAD_MERGE_ROLES.forEach((role, i) => {
      expect(u?.tints.value[i].toArray(), role).toEqual(colors[role]);
    });
    // ...and the body's skin layer with them
    expect(h.wocHeadTintOf(farMaterialFor(v.root, 'body'))?.tint.value.toArray()).toEqual(
      colors.skin,
    );
    v.dispose();
  });

  it('keeps a piece the merged material cannot draw in a group of its own', async () => {
    const h = await harness({
      headPack: true,
      unfoldable: { [NOSE]: 'own-texture', [BROW_L]: 'cutout' },
    });
    const v = h.farVisual(
      { ...h.DEFAULT_APPEARANCE, headPiercing: 'full' },
      { chest: 'some-chest' },
    );
    const geo = far(v.root).geometry;
    const slot = geo.getAttribute('aWocHmSlot');
    // the head, the nose, the brow, the piercings, the armor and the body
    expect(geo.groups).toHaveLength(6);
    const head = farHead(v);
    const inHead = new Set(head.vertices);
    expect(head.vertices).toHaveLength(
      vertexCount(v, ...DEFAULT_MESHES) - vertexCount(v, NOSE, BROW_L),
    );
    expect(head.tint.slots).toHaveLength(DEFAULT_MATERIALS - 2);
    /** The one far group drawing vertex `i`, and the material it draws with. */
    const groupAt = new Map<number, number>();
    for (const g of geo.groups) {
      const at = g.materialIndex ?? -1;
      for (const i of groupVertices(geo, at)) groupAt.set(i, at);
    }
    const groupOf = (i: number) => {
      const at = groupAt.get(i) ?? -1;
      return { vertices: groupVertices(geo, at), material: farMaterials(v.root)[at] };
    };
    for (const [mesh, role, map] of [
      [NOSE, 'skin', NOSE],
      [BROW_L, 'brow', 'atlas'],
    ] as const) {
      // no slot stands for it, and its vertices read slot 0 outside the head group...
      expect(slotOf(h, v, mesh), mesh).toBe(-1);
      const at = verticesAt(geo, meshUv(mesh));
      expect(at, mesh).toHaveLength(vertexCount(v, mesh));
      expect(
        at.every((i) => !inHead.has(i) && slot.getX(i) === 0),
        mesh,
      ).toBe(true);
      // ...in a group that is that one piece, on its own material under its role's own
      // layer, exactly as every head piece baked before the fold
      const own = groupOf(at[0]);
      expect([...own.vertices].sort(), mesh).toEqual([...at].sort());
      expect(mapName(own.material), mesh).toBe(map);
      expect(h.wocHeadMergedTintOf(own.material), mesh).toBeNull();
      expect(h.wocHeadTintOf(own.material)?.role, mesh).toBe(role);
      expect(h.wocHeadTintOf(own.material)?.mix.value, mesh).toBe(1);
      expect(own.material.customProgramCacheKey(), mesh).toContain(`woc_head_tint|${role}|`);
    }
    // the pieces that DO fold keep their own slots, though the groups left out now sit
    // between them in the walk (the bake lays the head's vertices out together)
    for (const mesh of TEXTURED_MESHES) {
      if (mesh === NOSE || mesh === BROW_L) continue;
      const want = slotOf(h, v, mesh);
      const at = verticesAt(geo, meshUv(mesh));
      expect(want, mesh).toBeGreaterThanOrEqual(0);
      expect(at, mesh).toHaveLength(vertexCount(v, mesh));
      expect(
        at.every((i) => inHead.has(i) && slot.getX(i) === want),
        mesh,
      ).toBe(true);
    }
    // the piercings: the gold's name earns the worn metal layer, which the merged material
    // does not carry, so the seven of them stay one group on their own untinted material
    expect(slotOf(h, v, LIP_RING)).toBe(-1);
    const rest: number[] = [];
    for (let i = 0; i < slot.count; i++) {
      const owner = mapName(groupOf(i).material);
      if (!inHead.has(i) && owner === '') rest.push(i);
    }
    expect(rest).toHaveLength(vertexCount(v, ...FULL_PIERCINGS));
    expect(rest.every((i) => slot.getX(i) === 0)).toBe(true);
    const gold = groupOf(rest[0]);
    expect([...gold.vertices].sort()).toEqual([...rest].sort());
    expect(h.wocHeadMergedTintOf(gold.material)).toBeNull();
    expect(h.wocHeadTintOf(gold.material)).toBeNull();
    // a flat-coloured piece left out of the fold keeps the inert uv it always baked with
    expect(verticesAt(geo, WHITE)).toHaveLength(vertexCount(v, ...FLAT_MESHES));
    v.dispose();
  });

  it('bakes a head whose base cannot fold exactly as before: a group per material, no slot attribute', async () => {
    // the base head is the merged material's source: without it nothing folds, though
    // every other piece on its own would
    const h = await harness({ headPack: true, unfoldable: { [BASE]: 'cutout' } });
    const v = h.farVisual({ ...h.DEFAULT_APPEARANCE }, { chest: 'some-chest' });
    const geo = far(v.root).geometry;
    expect(hasFarHead(v)).toBe(false);
    expect(Object.keys(geo.attributes).sort()).toEqual(['normal', 'position', 'uv']);
    // a group per head material, then the armor's and the body's, a material each and
    // nothing riding behind them
    const groups = DEFAULT_MATERIALS + 2;
    expect(geo.groups).toHaveLength(groups);
    expect(farBake(v).mats).toHaveLength(groups);
    expect(farBake(v).isBody).toHaveLength(groups);
    expect(farMaterials(v.root)).toHaveLength(groups);
    // every piece under its own role's layer (the body under the suit's), the liners and
    // the armor under none, and no merged layer anywhere
    expect(farMaterials(v.root).some((m) => h.wocHeadMergedTintOf(m) !== null)).toBe(false);
    const roles = farMaterials(v.root).map((m) => h.wocHeadTintOf(m)?.role ?? 'none');
    const count = (role: string): number => roles.filter((r) => r === role).length;
    expect([count('skin'), count('hair'), count('brow'), count('eye'), count('none')]).toEqual([
      6, 2, 2, 2, 2,
    ]);
    // the flat liners keep the inert uv they always baked with
    expect(verticesAt(geo, WHITE)).toHaveLength(0);
    v.dispose();
  });

  it('keeps the layer, its variant and its uniforms on a ghosted far head', async () => {
    const h = await harness();
    const app = { ...h.DEFAULT_APPEARANCE, hairHue: 0, hairSat: 1 };
    const v = h.farVisual(app);
    const plain = farHead(v).material;
    const u = h.wocHeadMergedTintOf(plain);
    v.setGhost(true);
    // the translucent clones link hidden behind the gate, on the far geometry itself (it
    // carries the slot attribute the layer reads), and swap in on the next frame
    expect(h.gates).toHaveLength(1);
    const staged: THREE.Mesh[] = [];
    h.gates[0].target.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) staged.push(o as THREE.Mesh);
    });
    h.gates.splice(0)[0].settle();
    v.update(0.05, IDLE, true);
    const ghost = farHead(v).material;
    expect(ghost).not.toBe(plain);
    expect(ghost.transparent).toBe(true);
    expect(staged.some((m) => m.material === ghost && m.geometry === far(v.root).geometry)).toBe(
      true,
    );
    // the clone is the same program variant (the hook, its key and the one sided define
    // all come back with it) and SHARES the head's uniforms
    expect(ghost.customProgramCacheKey()).toBe(plain.customProgramCacheKey());
    expect(ghost.defines).toHaveProperty('WOC_HM_ONE_SIDED');
    expect(h.wocHeadMergedTintOf(ghost)).toBe(u);
    // ...so a colour change still reaches the head while it is ghosted, as a uniform write
    const next = { ...app, hairHue: 120 };
    expect(v.setWocHeadLook(next)).toBe(true);
    expect(farHead(v).material).toBe(ghost);
    expect(u?.tints.value[WOC_HEAD_MERGE_ROLES.indexOf('hair')].toArray()).toEqual(
      h.colorsOf(next).hair,
    );
    v.dispose();
  });

  it('folds a hairstyle of two materials: on one texture as two hair slots, on two with the cap on the scalp layer', async () => {
    const h = await harness();
    // the undercut: strands and scalp cap sample one texture, so both ride the hair sampler
    const undercut = h.farVisual({ ...h.DEFAULT_APPEARANCE, headHair: 'undercut' });
    expect(far(undercut.root).geometry.groups).toHaveLength(2);
    const one = farHead(undercut);
    const strands = slotOf(h, undercut, UNDERCUT_STRANDS);
    const cap = slotOf(h, undercut, UNDERCUT_SCALP);
    expect(strands).toBeGreaterThanOrEqual(0);
    expect(cap).toBeGreaterThanOrEqual(0);
    expect(cap).not.toBe(strands);
    expect(one.tint.slots[strands].layer).toBe(WOC_HEAD_MERGE_LAYER.hair);
    expect(one.tint.slots[cap].layer).toBe(WOC_HEAD_MERGE_LAYER.hair);
    const uOne = h.wocHeadMergedTintOf(one.material);
    expect(uOne?.hair.value?.name).toBe(UNDERCUT_STRANDS);
    expect(uOne?.scalp.value).toBeNull();
    // the quiff: its cap samples a second texture, the merged material's scalp sampler, so
    // the body and the head are still the only two groups
    const quiff = h.farVisual({ ...h.DEFAULT_APPEARANCE, headHair: 'quiff' });
    expect(far(quiff.root).geometry.groups).toHaveLength(2);
    const two = farHead(quiff);
    const cut = slotOf(h, quiff, QUIFF_STRANDS);
    const scalp = slotOf(h, quiff, QUIFF_SCALP);
    expect(two.tint.slots[cut]?.layer).toBe(WOC_HEAD_MERGE_LAYER.hair);
    expect(two.tint.slots[scalp]?.layer).toBe(WOC_HEAD_MERGE_LAYER.scalp);
    const uTwo = h.wocHeadMergedTintOf(two.material);
    expect(uTwo?.hair.value?.name).toBe(QUIFF_STRANDS);
    expect(uTwo?.scalp.value?.name).toBe(QUIFF_SCALP);
    expect(uTwo?.col.value[scalp].w).toBe(WOC_HEAD_MERGE_LAYER.scalp);
    // each against its own measured reference (the cap's grain is lighter than the cut)
    expect(uTwo?.ref.value[cut].toArray()).toEqual([
      ...(wocHeadTintRef('a', 'hair_quiff')?.ref ?? []),
      WOC_HEAD_MERGE_ROLE_CODE.hair,
    ]);
    expect(uTwo?.ref.value[scalp].toArray()).toEqual([
      ...(wocHeadTintRef('a', 'hair_quiff_scalp')?.ref ?? []),
      WOC_HEAD_MERGE_ROLE_CODE.hair,
    ]);
    undercut.dispose();
    quiff.dispose();
  });

  it('mints the merged far head hidden behind the far gate', async () => {
    const h = await harness();
    const v = new h.CharacterVisual(KEY, 0xffffff, 0);
    v.setFarBakeGate((target, settle) => h.gates.push({ target, settle }));
    v.setWocEquipment({}, false);
    v.setWocHeadLook({ ...h.DEFAULT_APPEARANCE, hairHue: 0, hairSat: 1 });
    h.nextFrame();
    v.setFar(true);
    expect(h.gates).toHaveLength(1);
    const mesh = far(v.root);
    // what the gate compiles IS the tinted set, and nothing draws it before it links
    expect(h.gates[0].target.getObjectByName('character_far_mesh')).toBe(mesh);
    expect(h.wocHeadMergedTintOf(farHead(v).material)).not.toBeNull();
    expect(mesh.visible).toBe(false);
    expect(v.root.getObjectByName('character_model_wrap')?.visible).toBe(true);
    h.gates[0].settle();
    v.setFar(true);
    expect(mesh.visible).toBe(true);
    v.dispose();
  });

  it("holds each slot's far derivation with the far set, and lets go of it with the set", async () => {
    const h = await harness();
    const v = new h.CharacterVisual(KEY, 0xffffff, 0);
    v.setWocEquipment({ chest: 'some-chest' }, false);
    v.setWocHeadLook({ ...h.DEFAULT_APPEARANCE });
    const near = h.claimed();
    h.nextFrame();
    v.setFar(true);
    // one far clone per group, and one per head slot (never drawn: its surface is the
    // slot's row), all on the far set's one lease
    const head = farHead(v);
    const groups = far(v.root).geometry.groups.length;
    expect(groups).toBe(3);
    expect(head.tint.slots).toHaveLength(DEFAULT_MATERIALS);
    expect(h.claimed() - near).toBe(groups + head.tint.slots.length);
    // the bake names them behind the groups: each slot's own file material, derived as
    // the head pieces always were at distance (never as the body: no atlas, no body flags)
    const bake = farBake(v);
    expect(bake.mats).toHaveLength(groups + head.tint.slots.length);
    expect(head.tint.sources).toEqual(head.tint.slots.map((_, slot) => groups + slot));
    expect(head.tint.sources.map((at) => bake.mats[at].uuid)).toEqual(
      head.tint.slots.map((slot) => slot.material),
    );
    expect(bake.isBody.slice(groups)).toEqual(head.tint.slots.map(() => false));
    expect(bake.isBody[head.at]).toBe(false);
    // none of the slots' clones reaches the mesh: one material per group
    expect(farMaterials(v.root)).toHaveLength(groups);
    // an equipment edge drops the far set: every one of its claims goes, the slots' too
    v.setWocEquipment({}, false);
    expect(v.root.getObjectByName('character_far_mesh')).toBeUndefined();
    expect(h.claimed()).toBe(near);
    h.nextFrame();
    v.setFar(true);
    expect(h.claimed() - near).toBe(2 + head.tint.slots.length);
    v.dispose();
    expect(h.claimed()).toBe(0);
  });

  it('frees its merged far clone with the visual', async () => {
    const h = await harness();
    const v = h.farVisual({ ...h.DEFAULT_APPEARANCE });
    const head = farHead(v).material;
    const disposed = vi.fn();
    head.addEventListener('dispose', disposed);
    v.dispose();
    expect(disposed).toHaveBeenCalledOnce();
  });

  it('stays one group on the low tier, its rows read off the Lambert rebuild', async () => {
    const h = await harness({ headPack: true, lowTier: true });
    const v = h.farVisual({ ...h.DEFAULT_APPEARANCE }, { chest: 'some-chest' });
    expect(far(v.root).geometry.groups).toHaveLength(3);
    const head = farHead(v);
    expect((head.material as THREE.MeshLambertMaterial).isMeshLambertMaterial).toBe(true);
    expect(head.tint.slots).toHaveLength(DEFAULT_MATERIALS);
    const u = h.wocHeadMergedTintOf(head.material);
    if (!u) throw new Error('the low tier far head does not wear the merged layer');
    expect(u.mix.value).toBe(1);
    expect(u.hair.value?.name).toBe(SWEPT);
    const base = h.surfaceOf(head.material);
    const liner = slotOf(h, v, LINER_L);
    const own = h.farSurface(fileMaterial(h, v, LINER_L));
    // the tier's readability lift is on both sides of the ratio, and the floor it adds is
    // the slot's own (a share of its own colour), carried as a delta
    expect(own.color).not.toEqual([...LINER]);
    expect(own.emissive).not.toEqual(base.emissive);
    expect(u.col.value[liner].toArray()).toEqual([
      own.color[0] / base.color[0],
      own.color[1] / base.color[1],
      own.color[2] / base.color[2],
      WOC_HEAD_MERGE_LAYER.atlas,
    ]);
    expect(u.emi.value[liner].toArray()).toEqual([
      own.emissive[0] - base.emissive[0],
      own.emissive[1] - base.emissive[1],
      own.emissive[2] - base.emissive[2],
      own.roughness,
    ]);
    // ...which on this tier reads (assets.ts applyLowReadabilityLift): every colour 7.5
    // percent of the way to white, a glow floor of 4.5 percent of it, and neither a
    // roughness nor a metalness of its own on a Lambert. The head material is white, so
    // its floor is the 4.5 percent each slot's own is carried against.
    const lifted = (c: number): number => c + (1 - c) * 0.075;
    expect(base.color).toEqual([1, 1, 1]);
    expect(base.emissive).toEqual([0.045, 0.045, 0.045]);
    LINER.forEach((c, channel) => {
      expect(u.col.value[liner].getComponent(channel)).toBeCloseTo(lifted(c), 12);
      expect(u.emi.value[liner].getComponent(channel)).toBeCloseTo((lifted(c) - 1) * 0.045, 12);
    });
    expect(u.emi.value[liner].w).toBe(1);
    expect(u.surf.value[liner].toArray()).toEqual([0, 0]);
    v.dispose();
  });
});

describe('a WOC body waits for its head (a base file ends at the neck)', () => {
  const QUIFF = 'models/chars/players/woc/head_type_a_hair_quiff.glb';

  it('the world view builds a character only once its own head files are resident', async () => {
    const h = await harness({ headPack: true, held: [QUIFF] });
    const { createCharacterVisual, characterBuildStreaming } = await import(
      '../src/render/characters/index'
    );
    const e = player({ ...h.DEFAULT_APPEARANCE, headHair: 'quiff' });
    // base, library, core and beards are resident; its hairstyle is still on the wire
    expect(createCharacterVisual(e)).toBeNull();
    expect(characterBuildStreaming()).toBe(true);
    expect(createCharacterVisual(e)).toBeNull(); // every frame until it lands
    h.releases.get(QUIFF)?.();
    await vi.waitFor(() => expect(h.heads.wocHeadFileResident(QUIFF)).toBe(true));
    const v = createCharacterVisual(e);
    expect(characterBuildStreaming()).toBe(false);
    expect(v).not.toBeNull();
    // born with its head live, so it draws from its first frame
    expect(v?.wocHeadLook?.look.hair).toBe('quiff');
    expect(v?.root.getObjectByName('character_model_wrap')?.visible).toBe(true);
    v?.dispose();
  });

  it('a speculative build (no fetch) never waits on a head, and a mob on a WOC body waits for the default look', async () => {
    const swept = 'models/chars/players/woc/head_type_a_hair_swept.glb';
    const h = await harness({ headPack: true, held: [swept] });
    const { createCharacterVisual, characterBuildStreaming } = await import(
      '../src/render/characters/index'
    );
    // a mob drawn on the same body wears the type's default look (swept hair): it waits too
    const mob = { ...player({}), kind: 'mob', modularAppearance: undefined } as unknown as Entity;
    vi.spyOn(await import('../src/render/characters/manifest'), 'visualKeyFor').mockReturnValue(
      KEY,
    );
    expect(createCharacterVisual(mob)).toBeNull();
    expect(characterBuildStreaming()).toBe(true);
    // the zone prewarm's speculative build fetches nothing and waits on nothing
    const speculative = createCharacterVisual(mob, undefined, { fetchStreamed: false });
    expect(speculative).not.toBeNull();
    expect(characterBuildStreaming()).toBe(false);
    speculative?.dispose();
    h.releases.get(swept)?.();
    await vi.waitFor(() => expect(h.heads.wocHeadFileResident(swept)).toBe(true));
    const v = createCharacterVisual(mob);
    expect(v).not.toBeNull();
    v?.dispose();
  });

  it('a head file that failed to load never hides a character: the body builds and draws without it', async () => {
    const h = await harness({ headPack: true, failed: [QUIFF] });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { createCharacterVisual, characterBuildStreaming } = await import(
      '../src/render/characters/index'
    );
    const e = player({ ...h.DEFAULT_APPEARANCE, headHair: 'quiff' });
    // the first ask kicks the fetch
    createCharacterVisual(e)?.dispose();
    await vi.waitFor(() => expect(h.heads.wocHeadFileState(QUIFF)).toBe('failed'));
    const v = createCharacterVisual(e);
    expect(characterBuildStreaming()).toBe(false);
    expect(v).not.toBeNull();
    // no head (its look never completed), but the body is on screen
    expect(v?.wocHeadLook).toBeNull();
    expect(v?.root.getObjectByName('character_model_wrap')?.visible).toBe(true);
    v?.dispose();
  });

  it('a body built directly (a preview) draws nothing until its head is live', async () => {
    const h = await harness({ headPack: true, held: [QUIFF] });
    const idle = {
      speed: 0,
      moving: false,
      running: false,
      airborne: false,
      backwards: false,
      dead: false,
      casting: false,
      swimming: false,
      submerged: false,
      swimPitch: 0,
      wading: false,
      sitting: false,
    } as never;
    const v = new h.CharacterVisual(KEY, 0xffffff, 0);
    const wrap = v.root.getObjectByName('character_model_wrap');
    // born undrawn: no look yet
    expect(wrap?.visible).toBe(false);
    v.setWocHeadLook({ ...h.DEFAULT_APPEARANCE, headHair: 'quiff' });
    v.update(0.05, idle, true);
    expect(wrap?.visible).toBe(false);
    h.releases.get(QUIFF)?.();
    await vi.waitFor(() => expect(h.heads.wocHeadFileResident(QUIFF)).toBe(true));
    // hung behind the reveal: still nothing, then live and drawn on the next frames
    v.setFarBakeGate((_target, settle) => settle());
    v.update(0.05, idle, true);
    v.update(0.05, idle, true);
    expect(v.wocHeadLook?.look.hair).toBe('quiff');
    expect(wrap?.visible).toBe(true);
    // and it never hides for its head again: a later hairstyle holds the old one meanwhile
    v.setWocHeadLook({ ...h.DEFAULT_APPEARANCE, headHair: 'mohawk' });
    v.update(0.05, idle, true);
    expect(wrap?.visible).toBe(true);
    v.dispose();
  });
});
