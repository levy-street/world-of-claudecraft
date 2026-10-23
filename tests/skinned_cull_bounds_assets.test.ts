// The padded cull sphere is only sound if it sits on the body, and where it
// sits depends on a property of the SHIPPED rigs that no synthetic fixture
// carries: the kit creatures hang each skinned mesh under the exporter's x100
// unit node and ship quantized positions whose dequantization lives in the
// inverse binds. A skinned vertex never passes through its mesh node, so a
// sphere centred in geometry space landed tens of yards off those bodies and
// three culled the face, the eyes and the teeth off a mob standing in plain
// view (the Orchard Treant drew as one curved band). The skeleton enemies
// carry the same hazard in a milder form: their merged body is rebaked into
// one part's quantized frame.
//
// This drives the real committed GLBs through the real assembly (the per-URL
// optimize, the rig merge, the shared skeleton, CharacterVisual) and asks
// three's own question of every skinned part: does the sphere it will be
// frustum-tested with contain the vertices it stands for?
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { characterRigRadius } from '../src/render/character_cull_core';
import type { CharacterVisual as CharacterVisualClass } from '../src/render/characters/visual';

const GLB_JSON = 0x4e4f534a;
const GLB_BIN = 0x004e4942;
const TEXTURE_EXTENSIONS = new Set(['KHR_texture_basisu', 'EXT_texture_webp', 'EXT_texture_avif']);

type Json = Record<string, unknown>;

interface GlbChunks {
  json: Json;
  bin: Uint8Array;
}

function readGlb(url: string): GlbChunks | null {
  const path = `public/${url}`;
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  let json: Json | null = null;
  let bin: Uint8Array = new Uint8Array(0);
  for (let off = 12; off < buf.byteLength; ) {
    const length = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + length);
    if (type === GLB_JSON) json = JSON.parse(data.toString('utf8')) as Json;
    else if (type === GLB_BIN) bin = data;
    off += 8 + length;
  }
  return json === null ? null : { json, bin };
}

const tableLength = (json: Json, key: string): number =>
  Array.isArray(json[key]) ? (json[key] as unknown[]).length : 0;

/** Drop every `*Texture` slot under a material, wherever an extension put it. */
function dropTextureSlots(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) dropTextureSlots(item);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const record = node as Json;
  for (const key of Object.keys(record)) {
    if (key.endsWith('Texture')) delete record[key];
    else dropTextureSlots(record[key]);
  }
}

/**
 * The same GLB with its images, textures and texture slots removed, so the
 * loader builds the node graph, the skins and the geometry in plain Node with
 * no image decoder. Nothing this suite reads (frames, binds, positions,
 * weights) lives in a texture.
 */
function withoutTextures({ json, bin }: GlbChunks): ArrayBuffer {
  const bare: Json = structuredClone(json);
  delete bare.images;
  delete bare.textures;
  delete bare.samplers;
  dropTextureSlots(bare.materials);
  for (const list of ['extensionsUsed', 'extensionsRequired']) {
    if (!Array.isArray(bare[list])) continue;
    bare[list] = (bare[list] as string[]).filter((name) => !TEXTURE_EXTENSIONS.has(name));
  }
  const text = Buffer.from(JSON.stringify(bare), 'utf8');
  const jsonLength = Math.ceil(text.byteLength / 4) * 4;
  const binLength = Math.ceil(bin.byteLength / 4) * 4;
  const out = Buffer.alloc(12 + 8 + jsonLength + 8 + binLength, 0x20);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.byteLength, 8);
  out.writeUInt32LE(jsonLength, 12);
  out.writeUInt32LE(GLB_JSON, 16);
  text.copy(out, 20);
  const binAt = 20 + jsonLength;
  out.writeUInt32LE(binLength, binAt);
  out.writeUInt32LE(GLB_BIN, binAt + 4);
  out.fill(0, binAt + 8);
  Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength).copy(out, binAt + 8);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

function parseGlb(url: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  const glb = readGlb(url);
  if (glb === null) return Promise.reject(new Error(`missing GLB: ${url}`));
  return new Promise((resolve, reject) => {
    new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parse(withoutTextures(glb), '', (gltf) => resolve(gltf), reject);
  });
}

function stubGltf() {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
  return { scene, animations: [new THREE.AnimationClip('Idle', 1, [])] };
}

interface PartReading {
  key: string;
  part: string;
  culled: boolean;
  /** Sphere radius minus the farthest skinned vertex: anything but a
   *  non-negative number means three can cull this part while its vertices
   *  are still inside the view. */
  slack: number;
  /** The same reading for a sphere centred where the geometry's own bounds
   *  sit, pushed through the mesh node: the placement that shipped the bug. */
  geometryCentredSlack: number;
  /** How far the tested centre sits from the rig's own centre. */
  centreOffRig: number;
}

/** Every skinned part of a built rig, read the way three will test it. */
function readParts(
  key: string,
  visual: CharacterVisualClass,
): { parts: PartReading[]; unread: string[] } {
  const parts: PartReading[] = [];
  const unread: string[] = [];
  const vertex = new THREE.Vector3();
  const rigCentre = new THREE.Vector3(0, visual.height * 0.5, 0);
  visual.root.updateMatrixWorld(true);
  visual.root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    if (mesh.boundingSphere === null) {
      unread.push(`${key}/${mesh.name}`);
      return;
    }
    const tested = mesh.boundingSphere.clone().applyMatrix4(mesh.matrixWorld);
    if (mesh.geometry.boundingSphere === null) mesh.geometry.computeBoundingSphere();
    const geometryCentre = (mesh.geometry.boundingSphere as THREE.Sphere).center
      .clone()
      .applyMatrix4(mesh.matrixWorld);
    let farthest = 0;
    let farthestFromGeometryCentre = 0;
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
      farthest = Math.max(farthest, vertex.distanceTo(tested.center));
      farthestFromGeometryCentre = Math.max(
        farthestFromGeometryCentre,
        vertex.distanceTo(geometryCentre),
      );
    }
    parts.push({
      key,
      part: mesh.name,
      culled: mesh.frustumCulled,
      slack: tested.radius - farthest,
      geometryCentredSlack: tested.radius - farthestFromGeometryCentre,
      centreOffRig: tested.center.distanceTo(rigCentre),
    });
  });
  return { parts, unread };
}

/** The frustum of a camera placed at `eye` and aimed at `target`. */
function frustumOf(camera: THREE.Camera, eye: THREE.Vector3, target: THREE.Vector3): THREE.Frustum {
  camera.position.copy(eye);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  return new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

describe('skinned cull bounds on the shipped creature and enemy rigs', () => {
  let CharacterVisual: typeof CharacterVisualClass;
  /** Skinned rigs that ship flat materials and no atlas: the kit creatures. */
  let kitKeys: string[] = [];
  /** The skeleton enemy pack, whose merged bodies carry the milder hazard. */
  let enemyKeys: string[] = [];
  const heights = new Map<string, number>();
  const readings = new Map<string, PartReading[]>();
  const unread: string[] = [];
  const visuals = new Map<string, CharacterVisualClass>();

  beforeAll(async () => {
    vi.resetModules();
    const { VISUALS } = await import('../src/render/characters/manifest');
    // Picked by what the rigs ARE rather than from a list that would go stale.
    const skinned = Object.entries(VISUALS).filter(([, def]) => {
      if (def.modular || def.lazyPreload) return false;
      const glb = readGlb(def.url);
      return glb !== null && tableLength(glb.json, 'skins') > 0;
    });
    kitKeys = skinned
      .filter(([, def]) =>
        [def.url, ...(def.animUrls ?? [])].every((url) => {
          const glb = readGlb(url);
          return glb !== null && tableLength(glb.json, 'images') === 0;
        }),
      )
      .map(([key]) => key);
    enemyKeys = skinned
      .filter(([key, def]) => def.url.includes('/chars/enemies/') && !kitKeys.includes(key))
      .map(([key]) => key);
    const keys = [...kitKeys, ...enemyKeys];
    // Only the files these rigs are built from load for real; every other boot
    // asset is a stand-in box.
    const real = new Set<string>();
    for (const key of keys) {
      const def = VISUALS[key];
      for (const url of [def.url, ...(def.animUrls ?? [])]) real.add(url);
      heights.set(key, def.height);
    }
    const parsed = new Map<string, Promise<ReturnType<typeof stubGltf>>>();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn((url: string) => {
        const clean = url.replace(/^\//, '').replace(/[?#].*$/, '');
        let hit = parsed.get(clean);
        if (!hit) {
          hit = real.has(clean) ? parseGlb(clean) : Promise.resolve(stubGltf());
          parsed.set(clean, hit);
        }
        return hit;
      }),
      loadHdr: vi.fn(() => new Promise(() => undefined)),
      loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      releaseGltf: vi.fn(),
    }));

    const { charactersReady } = await import('../src/render/characters/assets');
    await charactersReady();
    ({ CharacterVisual } = await import('../src/render/characters/visual'));
    for (const key of keys) {
      const visual = new CharacterVisual(key, 0xffffff, 0);
      visuals.set(key, visual);
      const read = readParts(key, visual);
      readings.set(key, read.parts);
      unread.push(...read.unread);
    }
  }, 120_000);

  afterAll(() => {
    for (const visual of visuals.values()) visual.dispose();
    vi.doUnmock('../src/render/assets/loader');
    vi.resetModules();
  });

  const allParts = (): PartReading[] => [...readings.values()].flat();

  it('covers the rigs players reported, and the whole of both families', () => {
    // The Orchard Treant (the report), plus one of each body shape around it.
    for (const key of [
      'mob_treant',
      'mob_murloc',
      'mob_stag',
      'mob_fox',
      'mob_yeti',
      'mob_troll',
    ]) {
      expect(kitKeys, `${key} left the kit set: re-read how this suite picks its rigs`).toContain(
        key,
      );
    }
    for (const key of ['skel_minion', 'skel_warrior', 'skel_golem']) {
      expect(enemyKeys, `${key} left the enemy set`).toContain(key);
    }
    // Floors sit AT the shipped counts, so a rig silently leaving either family
    // (a new atlas, a lazy flag, a moved file) fails here instead of shrinking
    // what the cases below prove. A rig joining passes.
    expect(kitKeys.length).toBeGreaterThanOrEqual(29);
    expect(enemyKeys.length).toBeGreaterThanOrEqual(13);
    for (const key of [...kitKeys, ...enemyKeys]) {
      expect(readings.get(key)?.length, `${key} built no skinned part`).toBeGreaterThan(0);
    }
    expect(unread, 'a skinned part with no sphere at all was skipped').toEqual([]);
  });

  it('still tests rigs that break a sphere centred in geometry space', () => {
    // The teeth of this suite: on these assets a geometry-space centre misses
    // the body outright. If a re-export ever makes that placement harmless,
    // this says so, rather than the cases below passing for no reason.
    const treant = readings.get('mob_treant') ?? [];
    expect(treant.length, 'the treant should still be a multi-part rig').toBeGreaterThan(1);
    for (const part of treant) expect(part.geometryCentredSlack).toBeLessThan(-20);
    const wouldLoseAPart = (keys: string[]) =>
      keys.filter((key) => (readings.get(key) ?? []).some((part) => part.geometryCentredSlack < 0));
    expect(wouldLoseAPart(kitKeys).length).toBeGreaterThanOrEqual(28);
    // The skeleton golem is the enemy whose merged body already escaped at rest.
    expect(wouldLoseAPart(enemyKeys)).toContain('skel_golem');
  });

  it('gives three a sphere that contains every skinned part it stands for', () => {
    // `!(slack >= 0)` rather than `slack < 0`: a NaN sphere fails open in three
    // (never culled), and must not read as contained here.
    const lost = allParts()
      .filter((part) => !(part.slack >= 0))
      .map((part) => `${part.key}/${part.part}: ${part.slack.toFixed(2)}`);
    expect(lost).toEqual([]);
  });

  it('centres every one of those spheres within one rig radius of the rig', () => {
    // The premise the doubled radius is derived from, read off the real chains.
    const astray = allParts()
      .filter((part) => {
        const reach = characterRigRadius(heights.get(part.key) as number, 1);
        return !(part.centreOffRig <= reach + 1e-6);
      })
      .map((part) => `${part.key}/${part.part}: ${part.centreOffRig.toFixed(2)}`);
    expect(astray).toEqual([]);
  });

  it('keeps those parts cullable, rather than buying the fix with an exemption', () => {
    const exempt = allParts()
      .filter((part) => !part.culled)
      .map((part) => `${part.key}/${part.part}`);
    expect(exempt).toEqual([]);
  });

  it('draws every part of a treant the camera, or the sun, is looking at', () => {
    const visual = visuals.get('mob_treant') as CharacterVisualClass;
    const height = heights.get('mob_treant') as number;
    const body = new THREE.Vector3(0, height * 0.5, 0);
    visual.root.updateMatrixWorld(true);
    const partsCulledBy = (frustum: THREE.Frustum): string[] => {
      const culled: string[] = [];
      visual.root.traverse((object) => {
        const mesh = object as THREE.SkinnedMesh;
        if (!mesh.isSkinnedMesh) return;
        if (mesh.frustumCulled && !frustum.intersectsObject(mesh)) culled.push(mesh.name);
      });
      return culled;
    };
    // The reported view: a dozen yards back, looking level at the body.
    const eye = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400);
    expect(partsCulledBy(frustumOf(eye, new THREE.Vector3(0, height * 0.5, 12), body))).toEqual([]);
    // And the shadow pass asks the same of the sun's ortho box, tight on the rig.
    const sun = new THREE.OrthographicCamera(-4, 4, 4, -4, 1, 200);
    expect(partsCulledBy(frustumOf(sun, new THREE.Vector3(30, 60, 20), body))).toEqual([]);
    // Looking the other way, the whole rig is culled: the sphere is not a blanket.
    const away = frustumOf(
      eye,
      new THREE.Vector3(0, height * 0.5, 12),
      new THREE.Vector3(0, 0, 60),
    );
    expect(partsCulledBy(away).length).toBe((readings.get('mob_treant') ?? []).length);
  });
});
