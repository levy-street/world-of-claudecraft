// @vitest-environment happy-dom
// The WOC shadow stand-in (src/render/characters/woc_shadow_stand_in.ts) on the SHIPPED
// files, through the real assets.ts pipeline with only the loader stubbed: both body fits'
// base, animation library and head core, parsed as the game parses them (textures are
// stripped first: no KTX2 transcoder runs headless, and a silhouette reads none). Pins what
// the stand-in promises on real data: a shipped base really does end at the neck, about a
// seventh short of its crown, the ellipsoid that stands in for the missing head is the
// shipped bald head's box to within a tenth of the neck-to-crown span on every face (half a
// shadow texel at the working map size), and the key's stand-in is the body MID-IDLE with
// that head, over only the vertices its far level draws. The per-look far bake
// (woc_far_bake.ts) is held to the same files here: its vertices are exactly the ones its
// far index draws (the shipped attributes are interleaved and quantized, which no fixture
// is), and they stand where a body posed by this suite's own mixer stands.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WOC_ANATOMY_TOP } from '../src/render/characters/woc_armor_core';
import { wocStandInHead } from '../src/render/characters/woc_shadow_stand_in_core';

const publicFile = (url: string): Buffer =>
  readFileSync(path.resolve(__dirname, '..', 'public', url));

/** A GLB with every texture reference taken out of its JSON (the binary chunk as is). */
function withoutTextures(file: Buffer): ArrayBuffer {
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8'));
  delete json.textures;
  delete json.images;
  delete json.samplers;
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
    for (const extension of Object.values(material.extensions ?? {}) as Record<string, unknown>[]) {
      for (const key of Object.keys(extension)) if (key.endsWith('Texture')) delete extension[key];
    }
  }
  const keep = (list?: string[]): string[] =>
    (list ?? []).filter((name) => name !== 'KHR_texture_basisu');
  json.extensionsUsed = keep(json.extensionsUsed);
  json.extensionsRequired = keep(json.extensionsRequired);
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const chunk = Buffer.from(text);
  const rest = file.subarray(20 + jsonLength);
  const out = Buffer.alloc(20 + chunk.length + rest.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(chunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  chunk.copy(out, 20);
  rest.copy(out, 20 + chunk.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/** The shipped files this suite reads for real (the bodies, both animation libraries and
 *  the head cores); every other url gets an empty scene. */
const SHIPPED = /models\/chars\/players\/(woc\/(base_|anims_|head_type_[ab]_core)|woc_keyed\/woc_)/;

/** The game's own parse of a shipped file: the meshopt decoder and the level-of-detail
 *  plugin, as assets/loader.ts registers them. */
async function parseShipped(url: string) {
  const { wocLodPlugin } = await import('../src/render/assets/woc_lod_plugin');
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.register(wocLodPlugin);
  return loader.parseAsync(withoutTextures(publicFile(url)), '');
}

async function shipped(key: string) {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn((url: string) =>
      SHIPPED.test(url)
        ? parseShipped(url)
        : Promise.resolve({ scene: new THREE.Group(), animations: [] }),
    ),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    releaseGltf: vi.fn(),
  }));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const { VISUALS } = await import('../src/render/characters/manifest');
  const def = VISUALS[key];
  const manifest = def?.wocCharacter;
  if (!def || !manifest) throw new Error(`${key} is no WOC key`);
  const assets = await import('../src/render/characters/assets');
  await assets.charactersReady();
  await vi.waitFor(() => expect(assets.visualAssetsResident(key)).toBe(true), {
    timeout: 60_000,
  });
  const heads = await import('../src/render/characters/woc_head_packs');
  const catalog = await import('../src/render/characters/woc_head_catalog');
  const type = catalog.wocHeadTypeForGender(manifest.fit);
  heads.ensureWocHeadFile(catalog.wocHeadCoreUrl(type));
  await vi.waitFor(
    () => expect(heads.wocHeadFileResident(catalog.wocHeadCoreUrl(type))).toBe(true),
    { timeout: 60_000 },
  );
  return { def, manifest, assets, base: catalog.wocHeadBaseNode(type) };
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  await import('../src/render/characters/assets');
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../src/render/assets/loader');
});

describe.each([
  ['player_warrior', 'male'],
  ['player_warrior_female', 'female'],
] as const)('the shipped %s body and its stand-in', (key, fit) => {
  it('ends at the neck, and the ellipsoid stands where its bald head does', async () => {
    const { def, manifest, assets, base } = await shipped(key);
    expect(manifest.fit).toBe(fit);
    const { applyWocPartVisibility, resolveWocPartNodes } = await import(
      '../src/render/characters/woc_parts'
    );
    const { wocAnatomyParts } = await import('../src/render/characters/woc_parts_core');
    const { applyWocHeadBakeVisibility } = await import(
      '../src/render/characters/woc_head_dressing'
    );
    // the bare body with its bald head shown, at rest: the pose the body is measured in
    const model = assets.assembleModel({ ...def, attach: [] }, null, null, null, {
      skipDecals: true,
      wocArmor: [],
      wocLod: 'far',
    });
    applyWocPartVisibility(
      resolveWocPartNodes(model, manifest),
      manifest,
      wocAnatomyParts(manifest),
    );
    applyWocHeadBakeVisibility(model, new Set([base]));
    model.updateMatrixWorld(true);
    const body = new THREE.Box3();
    const bald = new THREE.Box3();
    const p = new THREE.Vector3();
    for (const mesh of assets.composedFarMeshes(model)) {
      let ofHead = false;
      for (let o: THREE.Object3D | null = mesh; o; o = o.parent) if (o.name === base) ofHead = true;
      const position = mesh.geometry.getAttribute('position');
      const skinned = mesh as unknown as THREE.SkinnedMesh;
      for (let i = 0; i < position.count; i++) {
        p.fromBufferAttribute(position, i);
        if (skinned.isSkinnedMesh) skinned.applyBoneTransform(i, p);
        p.applyMatrix4(mesh.matrixWorld);
        (ofHead ? bald : body).expandByPoint(p);
      }
    }
    expect(body.isEmpty()).toBe(false);
    expect(bald.isEmpty()).toBe(false);
    // a base file ends at the neck: its top is well short of the crown it is normalized by,
    // so a silhouette of the body alone is about a seventh short
    const crown = WOC_ANATOMY_TOP[fit];
    const neckTop = body.max.y;
    const span = crown - neckTop;
    expect(span / crown).toBeGreaterThan(0.12);
    expect(span / crown).toBeLessThan(0.2);
    // ...and the bald head is what fills it (its own crown just under the anatomy's: the
    // anatomy was measured with hair on)
    expect(bald.max.y).toBeGreaterThan(crown - 0.1 * span);
    expect(bald.max.y).toBeLessThanOrEqual(crown + 1e-6);
    expect(bald.min.y).toBeLessThan(neckTop);

    const bone = model.getObjectByName('head');
    if (!bone) throw new Error('no head bone');
    const at = bone.getWorldPosition(new THREE.Vector3());
    const head = wocStandInHead(neckTop, crown, [at.x, at.y, at.z]);
    if (!head) throw new Error('no stand-in head');
    // every face of the ellipsoid's box within a tenth of the span of the bald head's
    const tolerance = 0.1 * span;
    for (const [axis, i] of [
      ['x', 0],
      ['y', 1],
      ['z', 2],
    ] as const) {
      const low = head.center[i] - head.radii[i];
      const high = head.center[i] + head.radii[i];
      expect(Math.abs(low - bald.min[axis]), `${fit} ${axis} low`).toBeLessThan(tolerance);
      expect(Math.abs(high - bald.max[axis]), `${fit} ${axis} high`).toBeLessThan(tolerance);
    }
  }, 40_000);

  it("is the key's bake: mid-idle, with its head, over the far level's vertices only", async () => {
    const { def, assets } = await shipped(key);
    const prep = assets.prepareVisual(key);
    // no far mesh for a WOC key, only the stand-in
    expect(prep.idleGeo).toBeNull();
    const standIn = prep.shadowGeo;
    if (!standIn) throw new Error('no stand-in');
    expect(Object.keys(standIn.attributes)).toEqual(['position']);
    standIn.computeBoundingBox();
    const box = standIn.boundingBox;
    if (!box) throw new Error('no box');
    // MID-IDLE: the arms hang, so the silhouette is far narrower than it is tall. At the
    // rest pose (the arms straight out) it is about as wide as it is tall.
    const width = box.max.x - box.min.x;
    const height = box.max.y - box.min.y;
    expect(width).toBeLessThan(0.6 * height);
    // WITH its head: it stands as tall as the body it shadows, to within the little the
    // idle stoops (a headless one stops a seventh short)
    expect(box.min.y).toBeCloseTo(0, 1);
    expect(height).toBeGreaterThan(0.95 * def.height);
    expect(height).toBeLessThan(1.02 * def.height);
    // over the far level's vertices only: well under half of the body's own
    let bodyVertices = 0;
    const model = assets.assembleModel({ ...def, attach: [] }, null, null, null, {
      skipDecals: true,
      wocArmor: [],
      wocLod: 'far',
    });
    model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) bodyVertices += mesh.geometry.getAttribute('position').count;
    });
    expect(bodyVertices).toBeGreaterThan(1000);
    expect(standIn.getAttribute('position').count).toBeLessThan(0.5 * bodyVertices);
  }, 40_000);

  it("bakes a look's far LOD over exactly the vertices its far level draws, where the posed body stands", async () => {
    const { def, manifest, assets, base } = await shipped(key);
    const farBake = await import('../src/render/characters/woc_far_bake');
    const { applyWocPartVisibility, resolveWocPartNodes } = await import(
      '../src/render/characters/woc_parts'
    );
    const { wocAnatomyParts } = await import('../src/render/characters/woc_parts_core');
    const { applyWocHeadBakeVisibility } = await import(
      '../src/render/characters/woc_head_dressing'
    );
    // the look: the bare body with its bald head, no armor file
    const parts = new Set<string>([...wocAnatomyParts(manifest), base]);
    const lease = farBake.retainWocFarBake(key, parts, [], null);
    if (!lease) throw new Error('no far bake');
    const baked = lease.bake.geo;

    // The reference, built here: the same look on a model of its own, posed mid-idle by
    // a mixer of its own, and every vertex its far index reaches placed by hand.
    const prep = assets.prepareVisual(key);
    const model = assets.assembleModel({ ...def, attach: [] }, null, null, null, {
      skipDecals: true,
      wocArmor: [],
      wocLod: 'far',
    });
    applyWocPartVisibility(resolveWocPartNodes(model, manifest), manifest, parts);
    applyWocHeadBakeVisibility(model, parts);
    const idle = prep.clips.get(def.clips.idle);
    if (!idle) throw new Error('no idle clip');
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(idle).play();
    mixer.update(Math.min(0.5, idle.duration * 0.5));
    model.updateMatrixWorld(true);
    const norm = new THREE.Matrix4()
      .makeTranslation(0, prep.yOffset, 0)
      .multiply(new THREE.Matrix4().makeRotationY(def.yaw ?? 0))
      .multiply(new THREE.Matrix4().makeScale(prep.normScale, prep.normScale, prep.normScale));
    const want = new THREE.Box3();
    const p = new THREE.Vector3();
    let drawnVertices = 0;
    let everyVertex = 0;
    let triangles = 0;
    for (const mesh of assets.composedFarMeshes(model)) {
      const position = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.index;
      if (!index) throw new Error(`${mesh.name} has no index`);
      const skinned = mesh as unknown as THREE.SkinnedMesh;
      const seen = new Set<number>();
      for (let k = 0; k < index.count; k++) {
        const i = index.getX(k);
        if (seen.has(i)) continue;
        seen.add(i);
        p.fromBufferAttribute(position, i);
        if (skinned.isSkinnedMesh) skinned.applyBoneTransform(i, p);
        want.expandByPoint(p.applyMatrix4(mesh.matrixWorld).applyMatrix4(norm));
      }
      drawnVertices += seen.size;
      everyVertex += position.count;
      triangles += index.count / 3;
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(model);

    // exactly the vertices its far level draws: every one is drawn, none is missing, and
    // they are well under the geometry's own (the far level is a fraction of level 0)
    const bakedIndex = baked.index;
    if (!bakedIndex) throw new Error('the far bake has no index');
    expect(baked.getAttribute('position').count).toBe(drawnVertices);
    expect(new Set(Array.from(bakedIndex.array)).size).toBe(drawnVertices);
    expect(bakedIndex.count / 3).toBe(triangles);
    expect(drawnVertices).toBeGreaterThan(1000);
    expect(drawnVertices).toBeLessThan(0.75 * everyVertex);
    // ...standing where the posed body stands: mid-idle, never at rest (the arms hang, so
    // the silhouette is far narrower than the T of the rest pose), on every face of its box
    baked.computeBoundingBox();
    const got = baked.boundingBox as THREE.Box3;
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(Math.abs(got.min[axis] - want.min[axis]), `${fit} ${axis} low`).toBeLessThan(1e-3);
      expect(Math.abs(got.max[axis] - want.max[axis]), `${fit} ${axis} high`).toBeLessThan(1e-3);
    }
    expect(got.max.x - got.min.x).toBeLessThan(0.6 * (got.max.y - got.min.y));
    lease.release();
  }, 40_000);
});
