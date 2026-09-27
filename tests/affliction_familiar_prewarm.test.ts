// The Affliction familiar's prewarm home and first-attach gate
// (src/render/affliction_familiar.ts, staged by buildPlayerPrewarmGroup in
// src/render/zone_prewarm_groups.ts).
//
// The familiar is a clone of the deferred-preloaded Maledict Eye GLB, attached
// in the live loop under the local player's view when the local warlock is in
// the Affliction spec. Nothing staged it, and the attach was a bare add, so
// its program linked inside a drawn frame on every session's first switch into
// the spec. Two halves are pinned here:
// - the boot prewarm stages the very model the live draw clones, for a LOCAL
//   warlock of any spec (a talent switch can come mid-session), never for any
//   other class, and does nothing before the deferred model has loaded;
// - the first attach rides the compile gate (hidden until it settles), and a
//   re-attach after a spec switch re-adds the same root: no second gate, no new
//   clone, no new or disposed material, so nothing can relink.
//
// The GLB's textures are KTX2, which Node cannot decode, so the loader is
// mocked with a scene built to the GLB's own layout (read from its JSON chunk
// below): one Mesh, POSITION + NORMAL + TEXCOORD_0, one double-sided standard
// material with a base colour, a normal and a metallic-roughness texture.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drawProgramSignature } from '../src/render/draw_program_signature_core';
import type { Entity } from '../src/sim/types';
import { ALL_CLASSES } from '../src/sim/types';
import type { IWorld } from '../src/world_api';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

const state = vi.hoisted(() => ({
  preloads: [] as (() => Promise<unknown>)[],
  scene: null as THREE.Group | null,
}));

vi.mock('../src/render/assets/preload', () => ({
  registerDeferredPreload: (start: () => Promise<unknown>) => state.preloads.push(start),
}));

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: async () => {
    if (!state.scene) throw new Error('fixture scene not built');
    return { scene: state.scene };
  },
}));

// Only the familiar is under test in the player-archetype group, so every rig
// build answers "assets unavailable" (the builder's own skip arm).
vi.mock('../src/render/characters', () => ({
  createCharacterVisual: () => null,
}));

// The module registers its deferred preload only in a browser (a `window`
// check at import), so a bare `window` is stubbed for that one import and
// removed before anything else loads.
const preloadsBefore = state.preloads.length;
(globalThis as { window?: unknown }).window = {};
const { AfflictionFamiliar, buildAfflictionFamiliarPrewarmStandIn } = await import(
  '../src/render/affliction_familiar'
);
delete (globalThis as { window?: unknown }).window;
// The familiar's own deferred preload: the one its module registered at import
// (the modules imported after it register theirs too, and are not run here).
const familiarPreloads = state.preloads.slice(preloadsBefore);
const { buildPlayerPrewarmGroup } = await import('../src/render/zone_prewarm_groups');

const REPO_ROOT = path.join(__dirname, '..');
const GLB_PATH = path.join(REPO_ROOT, 'public/models/props/maledict_eye.glb');
const NO_DEADLINE = Number.MAX_SAFE_INTEGER;
const STAND_IN_NAME = 'affliction-familiar:prewarm';

interface GlbJson {
  materials: {
    doubleSided?: boolean;
    pbrMetallicRoughness?: { baseColorTexture?: unknown; metallicRoughnessTexture?: unknown };
    normalTexture?: unknown;
  }[];
  meshes: { primitives: { attributes: Record<string, number>; material: number }[] }[];
}

function glbJson(): GlbJson {
  const bytes = readFileSync(GLB_PATH);
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as GlbJson;
}

/** The loader's scene for the GLB, built from its JSON the way GLTFLoader maps it. */
function fixtureScene(): THREE.Group {
  const json = glbJson();
  expect(json.meshes).toHaveLength(1);
  expect(json.meshes[0].primitives).toHaveLength(1);
  const primitive = json.meshes[0].primitives[0];
  const source = json.materials[primitive.material];
  const material = new THREE.MeshStandardMaterial();
  material.side = source.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  if (source.pbrMetallicRoughness?.baseColorTexture) {
    material.map = new THREE.Texture();
    material.map.colorSpace = THREE.SRGBColorSpace;
  }
  if (source.pbrMetallicRoughness?.metallicRoughnessTexture) {
    const texture = new THREE.Texture();
    material.metalnessMap = texture;
    material.roughnessMap = texture;
  }
  if (source.normalTexture) material.normalMap = new THREE.Texture();
  const geometry = new THREE.BufferGeometry();
  const attributeNames: Record<string, [string, number]> = {
    POSITION: ['position', 3],
    NORMAL: ['normal', 3],
    TEXCOORD_0: ['uv', 2],
  };
  for (const name of Object.keys(primitive.attributes)) {
    const mapped = attributeNames[name];
    expect(mapped, `unmapped GLB attribute ${name}`).toBeDefined();
    geometry.setAttribute(
      mapped[0],
      new THREE.Float32BufferAttribute(new Array(9).fill(0), mapped[1]),
    );
  }
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(geometry, material));
  return scene;
}

function makeHost(playerClass: string) {
  return {
    sim: { player: { pos: { x: 0, y: 0, z: 0 } }, cfg: { playerClass } },
    prewarmEntity: (kind: string, templateId: string, color: number, scale: number) =>
      ({ kind, templateId, color, scale }) as unknown as Entity,
    storePooledObject: () => {},
    templateIdsInZone: () => [],
    prewarmedMobTemplates: new Set<string>(),
    prewarmedNpcModels: new Set<string>(),
  };
}

function warlockWorld(spec: string | null): IWorld {
  const player = {
    id: 7,
    kind: 'player',
    templateId: 'warlock',
    dead: false,
    scale: 1,
    auras: [],
  } as unknown as Entity;
  return {
    playerId: player.id,
    player,
    talentSpec: spec,
    entities: new Map([[player.id, player]]),
  } as unknown as IWorld;
}

function coverageOf(root: THREE.Object3D) {
  const signatures = new Set<string>();
  const keys = new Set<string>();
  const materials = new Set<THREE.Material>();
  for (const draw of drawsUnder(root)) {
    signatures.add(drawProgramSignature(draw.object, draw.material));
    for (const key of threeProgramKeys(draw.material, draw.object).split('\n')) keys.add(key);
    materials.add(draw.material);
  }
  return { signatures, keys, materials };
}

async function loadModel(): Promise<void> {
  state.scene = fixtureScene();
  expect(familiarPreloads).toHaveLength(1);
  await familiarPreloads[0]();
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('Affliction familiar boot prewarm', () => {
  it('stages nothing before the deferred model has loaded', () => {
    expect(buildAfflictionFamiliarPrewarmStandIn('warlock')).toBeNull();
    const built = buildPlayerPrewarmGroup(makeHost('warlock'), NO_DEADLINE);
    expect(built.group.getObjectByName(STAND_IN_NAME)).toBeUndefined();
  });

  it('covers every live draw of the familiar for a local warlock', async () => {
    await loadModel();
    const built = buildPlayerPrewarmGroup(makeHost('warlock'), NO_DEADLINE);
    const standIn = built.group.getObjectByName(STAND_IN_NAME);
    expect(standIn).toBeDefined();
    const staged = coverageOf(standIn as THREE.Object3D);
    expect(staged.materials.size).toBeGreaterThan(0);

    const host = new THREE.Group();
    const familiar = new AfflictionFamiliar();
    familiar.update(warlockWorld('affliction'), new Map([[7, { group: host }]]), true, 0);
    const live = host.getObjectByName('affliction-familiar');
    expect(live).toBeDefined();
    const liveDraws = drawsUnder(live as THREE.Object3D);
    expect(liveDraws.length).toBeGreaterThan(0);
    for (const draw of liveDraws) {
      expect(staged.signatures).toContain(drawProgramSignature(draw.object, draw.material));
      for (const key of threeProgramKeys(draw.material, draw.object).split('\n')) {
        expect(staged.keys).toContain(key);
      }
      // The clone shares the loader cache's material, so the program the boot
      // links is held by the very instance the live familiar draws.
      expect(staged.materials).toContain(draw.material);
    }
  });

  it('never stages the familiar for any other local class', async () => {
    await loadModel();
    const modelMaterial = ((state.scene as THREE.Group).children[0] as THREE.Mesh)
      .material as THREE.Material;
    // The loaded model is stageable: the warlock arm is the control.
    expect(buildAfflictionFamiliarPrewarmStandIn('warlock')).not.toBeNull();
    for (const cls of ALL_CLASSES.filter((c) => c !== 'warlock')) {
      expect(buildAfflictionFamiliarPrewarmStandIn(cls), cls).toBeNull();
      const built = buildPlayerPrewarmGroup(makeHost(cls), NO_DEADLINE);
      expect(built.group.getObjectByName(STAND_IN_NAME), cls).toBeUndefined();
      expect(coverageOf(built.group).materials.has(modelMaterial), cls).toBe(false);
    }
  });
});

describe('Affliction familiar first-attach gate', () => {
  let host: THREE.Group;
  let views: Map<number, { group: THREE.Group }>;
  let gateCalls: THREE.Object3D[];
  let gate: ReturnType<typeof deferred>;
  let factoryCalls: number;
  let familiar: InstanceType<typeof AfflictionFamiliar>;
  let model: THREE.Mesh;

  beforeEach(() => {
    host = new THREE.Group();
    views = new Map([[7, { group: host }]]);
    gateCalls = [];
    gate = deferred();
    factoryCalls = 0;
    model = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    familiar = new AfflictionFamiliar(
      () => (target: THREE.Object3D) => {
        gateCalls.push(target);
        return gate.promise;
      },
      () => {
        factoryCalls++;
        return model.clone();
      },
    );
  });

  it('keeps the first attach hidden until the compile gate settles', async () => {
    const world = warlockWorld('affliction');
    familiar.update(world, views, true, 0);
    const root = host.getObjectByName('affliction-familiar') as THREE.Object3D;
    expect(root).toBeDefined();
    expect(gateCalls).toEqual([root]);
    expect(root.visible).toBe(false);
    familiar.update(world, views, true, 1);
    await flush();
    expect(root.visible).toBe(false);
    gate.resolve();
    await flush();
    expect(root.visible).toBe(true);
    expect(gateCalls).toHaveLength(1);
  });

  it('re-attaches after spec switches with no second gate and no new clone or material', async () => {
    const world = warlockWorld('affliction');
    familiar.update(world, views, true, 0);
    const root = host.getObjectByName('affliction-familiar') as THREE.Object3D;
    gate.resolve();
    await flush();
    const firstMaterials = coverageOf(root).materials;
    const disposed: THREE.Material[] = [];
    for (const material of firstMaterials) {
      material.addEventListener('dispose', () => disposed.push(material));
    }
    for (let round = 0; round < 2; round++) {
      world.talentSpec = 'necromancy';
      familiar.update(world, views, true, 2 + round * 2);
      expect(host.getObjectByName('affliction-familiar')).toBeUndefined();
      world.talentSpec = 'affliction';
      familiar.update(world, views, true, 3 + round * 2);
      const again = host.getObjectByName('affliction-familiar') as THREE.Object3D;
      expect(again).toBe(root);
      expect(again.visible).toBe(true);
      expect(coverageOf(again).materials).toEqual(firstMaterials);
    }
    expect(gateCalls).toHaveLength(1);
    expect(factoryCalls).toBe(1);
    expect(disposed).toEqual([]);
  });

  it('a re-attach while the first gate is pending stays hidden until it settles', async () => {
    const world = warlockWorld('affliction');
    familiar.update(world, views, true, 0);
    const root = host.getObjectByName('affliction-familiar') as THREE.Object3D;
    world.talentSpec = 'necromancy';
    familiar.update(world, views, true, 1);
    world.talentSpec = 'affliction';
    familiar.update(world, views, true, 2);
    expect(host.getObjectByName('affliction-familiar')).toBe(root);
    expect(root.visible).toBe(false);
    gate.resolve();
    await flush();
    expect(root.visible).toBe(true);
    expect(gateCalls).toHaveLength(1);
  });

  it('attaches at once when the renderer has no gate (no parallel compile)', () => {
    const ungated = new AfflictionFamiliar(
      () => undefined,
      () => model.clone(),
    );
    ungated.update(warlockWorld('affliction'), views, true, 0);
    const root = host.getObjectByName('affliction-familiar') as THREE.Object3D;
    expect(root).toBeDefined();
    expect(root.visible).toBe(true);
  });
});
