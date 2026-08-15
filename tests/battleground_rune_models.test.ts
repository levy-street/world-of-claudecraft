// Contract pins for the three Thornhollow Fields rune pad bodies
// (`public/models/battleground/rune_{damage,defense,sprint}.glb`), the bodies
// `src/render/battleground_rune_model.ts` seats on the Battle, Ward and Sprint pads.
//
// WHY THIS SUITE EXISTS. Every other shipped GLB in this tree is produced by a
// committed deterministic exporter under `scripts/assets/` and pinned against a
// SOURCE FINGERPRINT over that exporter's inputs (the Eastbrook family, see
// `docs/image-to-glb-asset-workflow.md`). These three have no exporter: they
// predate their generator being checked in and their generation inputs are not
// reconstructible, so there is nothing honest to fingerprint. The exemption is
// documented in `scripts/assets/battleground/CLAUDE.md` and their provenance in
// `CREDITS.md`.
//
// What stands in for the missing fingerprint is this file: each shipped binary is
// pinned BOTH by sha256 of its exact committed bytes AND by parsed shape, so a
// silent re-export, a recompression, or an optimizer pass that changes what the
// pads actually are turns red instead of landing unnoticed. If an exporter is ever
// written for them, replace the sha256 pins with source-fingerprint pins and drop
// the exemption note.
//
// The parsed half is deliberately not a hash restatement: it reads the GLB
// container by hand (header, chunk table), then re-reads the same file through
// glTF-Transform and pins mesh/primitive/node/material/texture shape, the KTX2
// (`KHR_texture_basisu`) encoding the shipping base mandates
// (`tests/glb_texture_compression.test.ts`), and a byte budget that survives a
// deliberate re-pin of the hashes.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  battlegroundRuneModelPreloadInternalsForTest,
  RUNE_MODEL_DEFS,
} from '../src/render/battleground_rune_model';
import type { BgRuneType } from '../src/sim/social/battleground';

const REPO_ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
const MANIFEST_HASH_LENGTH = 12;

// The budget, as distinct from the exact byte pins below: the pins move whenever a
// re-export is consciously accepted, this does not. KTX2 payloads are LARGER on
// disk than the webp they replaced (they stay GPU-compressed in memory), so the
// floor guards against a stripped or texture-less re-export and the ceiling still
// catches an unoptimized one, which lands megabytes above this.
const RUNE_BYTE_FLOOR = 32 * 1024;
const RUNE_BYTE_CEILING = 128 * 1024;
// A rune pad is a 2.1yd token spinning on a disc; these are pocket-sized bodies.
const RUNE_TRIANGLE_CEILING = 1024;

interface RuneAssetContract {
  /** The BgRuneType whose RUNE_MODEL_DEFS entry points at this file. */
  readonly id: BgRuneType;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  /** Container chunk table: JSON chunk first, then the single BIN chunk. */
  readonly jsonChunkBytes: number;
  readonly binChunkBytes: number;
  readonly nodeName: string;
  readonly nodeTranslation: readonly [number, number, number];
  readonly meshName: string;
  readonly materialName: string;
  readonly textureName: string;
  readonly triangles: number;
  readonly vertices: number;
  /** POSITION accessor bounds (pre-node-transform). */
  readonly positionMin: readonly [number, number, number];
  readonly positionMax: readonly [number, number, number];
  /** Scene bounds (node transform applied), which is what the runtime measures. */
  readonly sceneMin: readonly [number, number, number];
  readonly sceneMax: readonly [number, number, number];
}

const RUNE_CONTRACTS: readonly RuneAssetContract[] = [
  {
    id: 'damage',
    url: '/models/battleground/rune_damage.glb',
    bytes: 75_316,
    sha256: '1e789f53a60751c8208025e403665cb730e93db13422d5b2224aed12f590de49',
    jsonChunkBytes: 1504,
    binChunkBytes: 73_784,
    nodeName: 'tripo_node_de6c7805',
    nodeTranslation: [0, 0, 0],
    meshName: 'tripo_mesh_de6c7805',
    materialName: 'tripo_mat_de6c7805',
    textureName: 'crossed_swords_3d_model_basecolor',
    triangles: 468,
    vertices: 482,
    positionMin: [-0.4990234971046448, 0, -0.0947265475988388],
    positionMax: [0.4990234971046448, 0.626953125, 0.0947265475988388],
    sceneMin: [-0.4990234971046448, 0, -0.0947265475988388],
    sceneMax: [0.4990234971046448, 0.626953125, 0.0947265475988388],
  },
  {
    id: 'defense',
    url: '/models/battleground/rune_defense.glb',
    bytes: 55_684,
    sha256: 'b9dddf0ebfdfaeb75f00b6d38eaf48bd9df36d6c3d95bb5e8e25db6a7b8b011a',
    jsonChunkBytes: 1464,
    binChunkBytes: 54_192,
    nodeName: 'shield',
    nodeTranslation: [0, 0, 0],
    meshName: 'tripo_mesh_6a72d06f',
    materialName: 'tripo_mat_6a72d06f',
    textureName: 'shield_ward_glb_basecolor',
    triangles: 102,
    vertices: 85,
    positionMin: [-0.0668334886431694, 0, -0.3366699516773224],
    positionMax: [0.0668334886431694, 1, 0.3366699516773224],
    sceneMin: [-0.0668334886431694, 0, -0.3366699516773224],
    sceneMax: [0.0668334886431694, 1, 0.3366699516773224],
  },
  {
    id: 'sprint',
    url: '/models/battleground/rune_sprint.glb',
    bytes: 80_292,
    sha256: '05d9eb844529730c1c8c05d667d2137d53530a23ab56dacd470f8d37098c6aba',
    jsonChunkBytes: 1536,
    binChunkBytes: 78_728,
    nodeName: 'powerup speed',
    // The one non-identity node transform in the set, and it is load-bearing: see
    // the off-center coupling case at the bottom of this file.
    nodeTranslation: [0.17184953391551971, 0, 0],
    meshName: 'tripo_mesh_3a136827',
    materialName: 'tripo_mat_3a136827',
    textureName: 'winged_boot_3d_model_basecolor',
    triangles: 490,
    vertices: 655,
    positionMin: [-0.3505859971046448, 0, -0.4990234971046448],
    positionMax: [0.3505859971046448, 0.986328125, 0.4990234971046448],
    sceneMin: [-0.17873646318912506, 0, -0.4990234971046448],
    sceneMax: [0.5224355310201645, 0.986328125, 0.4990234971046448],
  },
];

interface GlbChunk {
  readonly type: number;
  readonly length: number;
}

interface RuneGlbJson {
  asset?: { version?: string; generator?: string; extras?: unknown };
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<{ name?: string; mesh?: number; translation?: number[] }>;
  meshes?: Array<{
    name?: string;
    primitives?: Array<{
      mode?: number;
      indices?: number;
      material?: number;
      attributes?: Record<string, number>;
    }>;
  }>;
  materials?: Array<{ name?: string }>;
  textures?: Array<{ sampler?: number; extensions?: Record<string, unknown> }>;
  images?: Array<{ name?: string; mimeType?: string; bufferView?: number }>;
  samplers?: unknown[];
  accessors?: unknown[];
  bufferViews?: unknown[];
  buffers?: unknown[];
  animations?: unknown[];
  skins?: unknown[];
  cameras?: unknown[];
}

/**
 * Walk the GLB container by hand: the 12-byte header, then the chunk table.
 * `glbJsonChunk` (the shared helper this suite also uses) takes the fast path
 * that ASSUMES the JSON chunk is first, so walking the table here is what proves
 * that assumption for these files rather than inheriting it.
 */
function glbContainer(binary: Buffer): {
  version: number;
  declaredLength: number;
  chunks: GlbChunk[];
} {
  expect(binary.length).toBeGreaterThan(12);
  expect(binary.readUInt32LE(0)).toBe(GLB_MAGIC);
  const version = binary.readUInt32LE(4);
  const declaredLength = binary.readUInt32LE(8);
  const chunks: GlbChunk[] = [];
  let offset = 12;
  while (offset + 8 <= binary.length) {
    const length = binary.readUInt32LE(offset);
    const type = binary.readUInt32LE(offset + 4);
    chunks.push({ type, length });
    // Chunks are 4-byte aligned; the padding is inside the declared length for
    // conformant writers, so step over it explicitly rather than trusting that.
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  return { version, declaredLength, chunks };
}

function assetPathFor(url: string): string {
  return path.join(PUBLIC_DIR, url.replace(/^\//, ''));
}

function readRuneJson(contract: RuneAssetContract): RuneGlbJson {
  return glbJsonChunk(readFileSync(assetPathFor(contract.url))) as unknown as RuneGlbJson;
}

async function readRuneDocument(contract: RuneAssetContract) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  return (await io.read(assetPathFor(contract.url))).getRoot();
}

describe('Thornhollow Fields rune pad GLB contract (documented exporter exemption)', () => {
  it('covers exactly the rune bodies the runtime def table ships', () => {
    // Vacuity floor: a renamed or deleted pad must fail here, not quietly shrink
    // the table this whole suite iterates.
    expect(RUNE_CONTRACTS).toHaveLength(3);
    expect(RUNE_CONTRACTS.map((contract) => contract.id).sort()).toEqual([
      'damage',
      'defense',
      'sprint',
    ]);
    // Every rune type has a registered custom body (the all-null procedural
    // fallback era is over), and every registered url is pinned here.
    for (const [kind, def] of Object.entries(RUNE_MODEL_DEFS) as [
      BgRuneType,
      (typeof RUNE_MODEL_DEFS)[BgRuneType],
    ][]) {
      const contract = RUNE_CONTRACTS.find((entry) => entry.id === kind);
      expect(def, `${kind} should register a custom body`).not.toBeNull();
      expect(contract, `${kind} should be pinned by this suite`).toBeDefined();
      expect(def?.url).toBe(contract?.url);
    }
    expect(battlegroundRuneModelPreloadInternalsForTest.urls().sort()).toEqual(
      RUNE_CONTRACTS.map((contract) => contract.url).sort(),
    );
  });

  it.each(RUNE_CONTRACTS)(
    '$id pad ships the pinned bytes, sha256, and media-manifest hash',
    (contract) => {
      const assetPath = assetPathFor(contract.url);
      expect(existsSync(assetPath), `${contract.url} should exist under public/`).toBe(true);

      const bytes = readFileSync(assetPath);
      expect(bytes.length).toBe(contract.bytes);
      expect(bytes.length).toBeGreaterThanOrEqual(RUNE_BYTE_FLOOR);
      expect(bytes.length).toBeLessThanOrEqual(RUNE_BYTE_CEILING);

      const sha256 = createHash('sha256').update(bytes).digest('hex');
      expect(sha256).toBe(contract.sha256);
      // Prove the pin discriminates rather than restating a constant: one flipped
      // bit anywhere in the payload has to move it.
      const mutated = Buffer.from(bytes);
      mutated[Math.floor(mutated.length / 2)] ^= 1;
      expect(createHash('sha256').update(mutated).digest('hex')).not.toBe(contract.sha256);

      // The content-hashed manifest url is derived from these exact bytes, so a
      // re-export that skipped `build_media_manifest.mjs` fails here.
      const rel = contract.url.replace(/^\//, '');
      const parsed = path.posix.parse(rel);
      expect(MEDIA_ASSETS[rel]).toBe(
        path.posix.join(
          '/media',
          parsed.dir,
          `${parsed.name}.${sha256.slice(0, MANIFEST_HASH_LENGTH)}${parsed.ext}`,
        ),
      );
    },
  );

  it.each(RUNE_CONTRACTS)('$id pad parses as the pinned GLB container', (contract) => {
    const binary = readFileSync(assetPathFor(contract.url));
    const container = glbContainer(binary);
    expect(container.version).toBe(2);
    expect(container.declaredLength).toBe(contract.bytes);
    expect(container.declaredLength).toBe(binary.length);
    // Exactly two chunks, JSON first then BIN: no trailing vendor chunk, and no
    // external buffer split that would break the single-file preload path.
    expect(container.chunks.map((chunk) => chunk.type)).toEqual([CHUNK_JSON, CHUNK_BIN]);
    expect(container.chunks[0].length).toBe(contract.jsonChunkBytes);
    expect(container.chunks[1].length).toBe(contract.binChunkBytes);

    // The shared helper takes the JSON-chunk-is-first fast path; the walk above
    // is what earns that, so assert the two agree on the same file.
    expect(
      JSON.parse(
        binary
          .toString('utf8', 20, 20 + contract.jsonChunkBytes)
          .replace(/\0+$/, '')
          .trimEnd(),
      ),
    ).toEqual(glbJsonChunk(binary));
  });

  it.each(RUNE_CONTRACTS)(
    '$id pad keeps the KTX2 texture encoding the shipping base mandates',
    (contract) => {
      const json = readRuneJson(contract);
      // KHR_texture_basisu must stay REQUIRED, not merely used: GLTFLoader only
      // fails loudly on a missing KTX2Loader when the extension is required, and
      // silently renders black otherwise (tests/glb_texture_compression.test.ts).
      expect(json.extensionsUsed).toEqual(['KHR_texture_basisu']);
      expect(json.extensionsRequired).toEqual(['KHR_texture_basisu']);
      expect(json.images).toHaveLength(1);
      expect(json.images?.[0].mimeType).toBe('image/ktx2');
      expect(json.images?.[0].name).toBe(contract.textureName);
      expect(json.images?.[0].bufferView).toBe(0);
      expect(json.textures).toHaveLength(1);
      expect(Object.keys(json.textures?.[0].extensions ?? {})).toEqual(['KHR_texture_basisu']);
      expect(json.textures?.[0].extensions?.KHR_texture_basisu).toEqual({ source: 0 });
      expect(json.samplers).toHaveLength(1);

      // The rest of the raw table: one buffer, one interleaved vertex view, one
      // index view, one KTX2 view, and the four accessors those feed.
      expect(json.buffers).toHaveLength(1);
      expect(json.bufferViews).toHaveLength(3);
      expect(json.accessors).toHaveLength(4);
      expect(json.animations ?? []).toHaveLength(0);
      expect(json.skins ?? []).toHaveLength(0);
      expect(json.cameras ?? []).toHaveLength(0);
      expect(json.asset?.version).toBe('2.0');
      expect(json.asset?.generator).toBe('glTF-Transform v4.4.1');
      // These are drop-in bodies, not exporter output: no source fingerprint is
      // stamped, which is exactly what this suite stands in for.
      expect(json.asset?.extras).toBeUndefined();
    },
  );

  it.each(RUNE_CONTRACTS)('$id pad keeps its pinned parsed shape', async (contract) => {
    const root = await readRuneDocument(contract);

    expect(root.listScenes()).toHaveLength(1);
    expect(root.listNodes()).toHaveLength(1);
    expect(root.listMeshes()).toHaveLength(1);
    expect(root.listMaterials()).toHaveLength(1);
    expect(root.listTextures()).toHaveLength(1);
    expect(root.listAccessors()).toHaveLength(4);
    expect(root.listAnimations()).toHaveLength(0);
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listCameras()).toHaveLength(0);

    const scene = root.listScenes()[0];
    expect(scene.listChildren().map((node) => node.getName())).toEqual([contract.nodeName]);
    const node = scene.listChildren()[0];
    expect(node.getTranslation()).toEqual(contract.nodeTranslation);
    expect(node.getRotation()).toEqual([0, 0, 0, 1]);
    expect(node.getScale()).toEqual([1, 1, 1]);

    const mesh = node.getMesh();
    if (!mesh) throw new Error(`${contract.url} node carries no mesh`);
    expect(mesh.getName()).toBe(contract.meshName);
    expect(mesh.listPrimitives()).toHaveLength(1);

    const primitive = mesh.listPrimitives()[0];
    expect(primitive.getMode()).toBe(Primitive.Mode.TRIANGLES);
    expect(primitive.listSemantics().sort()).toEqual(['NORMAL', 'POSITION', 'TEXCOORD_0']);
    const position = primitive.getAttribute('POSITION');
    const normal = primitive.getAttribute('NORMAL');
    const uv = primitive.getAttribute('TEXCOORD_0');
    if (!position || !normal || !uv) throw new Error(`${contract.url} lost a vertex attribute`);
    expect(position.getType()).toBe('VEC3');
    expect(normal.getType()).toBe('VEC3');
    expect(uv.getType()).toBe('VEC2');
    expect(position.getCount()).toBe(contract.vertices);
    expect(normal.getCount()).toBe(contract.vertices);
    expect(uv.getCount()).toBe(contract.vertices);
    const indices = primitive.getIndices();
    expect(indices, `${contract.url} should stay indexed`).not.toBeNull();
    expect((indices?.getCount() ?? 0) / 3).toBe(contract.triangles);
    expect(contract.triangles).toBeLessThanOrEqual(RUNE_TRIANGLE_CEILING);
    // A UV outside 0..1 means the atlas got re-packed or the wrap mode changed.
    expect(Math.min(...uv.getMin([]))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...uv.getMax([]))).toBeLessThanOrEqual(1);
    expect(position.getMin([])).toEqual([...contract.positionMin]);
    expect(position.getMax([])).toEqual([...contract.positionMax]);

    for (const [index, accessor] of root.listAccessors().entries()) {
      const array = accessor.getArray();
      expect(array, `accessor ${index} should have storage`).not.toBeNull();
      expect(accessor.getCount(), `accessor ${index} should not be empty`).toBeGreaterThan(0);
      expect(array?.length).toBe(accessor.getCount() * accessor.getElementSize());
      for (const value of array ?? []) {
        expect(Number.isFinite(value), `accessor ${index} holds ${value}`).toBe(true);
      }
    }

    const material = primitive.getMaterial();
    if (!material) throw new Error(`${contract.url} primitive has no material`);
    expect(material.getName()).toBe(contract.materialName);
    expect(material.getDoubleSided()).toBe(true);
    expect(material.getMetallicFactor()).toBe(0);
    expect(material.getRoughnessFactor()).toBeCloseTo(0.9, 6);
    expect(material.getBaseColorFactor()).toEqual([1, 1, 1, 1]);
    expect(material.getNormalTexture()).toBeNull();
    expect(material.getMetallicRoughnessTexture()).toBeNull();
    // The pad's color comes from the runtime emissive push in
    // `prepareRuneModel`, never from a baked emissive in the export.
    expect(material.getEmissiveFactor()).toEqual([0, 0, 0]);

    const baseColor = material.getBaseColorTexture();
    expect(baseColor, `${contract.url} should keep its baseColor texture`).not.toBeNull();
    expect(baseColor?.getName()).toBe(contract.textureName);
    expect(baseColor?.getMimeType()).toBe('image/ktx2');
    expect(baseColor?.getSize()).toEqual([512, 512]);

    const bounds = getBounds(scene);
    expect(bounds.min).toEqual([...contract.sceneMin]);
    expect(bounds.max).toEqual([...contract.sceneMax]);
    // Every pad body is floor-seated in its own export; `prepareRuneModel`
    // re-anchors from the measured bounds, so this is a shape fact, not a
    // placement one.
    expect(bounds.min[1]).toBe(0);
  });

  it('keeps the Sprint pad off-center on x, which the runtime re-centers', async () => {
    // `src/render/battleground_rune_model.ts` centers each body on the spin axis
    // and cites THIS export as the reason ("the Slipstream model's x bounds run
    // -0.18..0.52"). If a re-export ever centered it, that comment would go stale
    // and the centering step would look like dead defensive code; pin the premise.
    const sprint = RUNE_CONTRACTS.find((contract) => contract.id === 'sprint');
    if (!sprint) throw new Error('sprint contract missing');
    const root = await readRuneDocument(sprint);
    const bounds = getBounds(root.listScenes()[0]);
    expect(bounds.min[0]).toBeCloseTo(-0.18, 2);
    expect(bounds.max[0]).toBeCloseTo(0.52, 2);
    expect(Math.abs((bounds.min[0] + bounds.max[0]) / 2)).toBeGreaterThan(0.15);

    // The other two pads are centered on x, so the runtime step is load-bearing
    // for exactly one of the three.
    for (const other of RUNE_CONTRACTS.filter((contract) => contract.id !== 'sprint')) {
      const otherRoot = await readRuneDocument(other);
      const otherBounds = getBounds(otherRoot.listScenes()[0]);
      expect(Math.abs((otherBounds.min[0] + otherBounds.max[0]) / 2)).toBeLessThan(1e-6);
    }
  });
});
