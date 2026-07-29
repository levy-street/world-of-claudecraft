// Guards the GLB replacement of the procedural fish/gather-node/
// mailbox/delve-prop/landmark models: every preload URL declared by the render modules
// must point at a real file under public/models, and every referenced GLB
// must have been picked up by the media manifest.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getBounds, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS, type EmissiveStrength } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  EASTBROOK_GRAND_ARMOURY_SOURCE_FILES,
  eastbrookGrandArmourySourceFingerprint,
} from '../scripts/assets/eastbrook_grand_armoury/source_fingerprint.mjs';
import { artisanRowPreloadInternalsForTest } from '../src/render/artisan_row_props';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { bankerChestPreloadInternalsForTest } from '../src/render/banker_chest';
import { marshDressingPreloadInternalsForTest } from '../src/render/delve_marsh_dressing';
import { delvePropsPreloadInternalsForTest } from '../src/render/delve_props';
import { doorPortalPreloadInternalsForTest } from '../src/render/door_portal';
import { eastbrookGrandArmouryInternalsForTest } from '../src/render/eastbrook_grand_armoury';
import { fishPreloadInternalsForTest } from '../src/render/fish';
import { galeFeaturesPreloadInternalsForTest } from '../src/render/gale_features';
import { gardenFeaturesPreloadInternalsForTest } from '../src/render/garden_features';
import { gatherNodePreloadInternalsForTest } from '../src/render/gather_nodes';
import { mailboxPreloadInternalsForTest } from '../src/render/mailbox';
import { propPreloadInternalsForTest } from '../src/render/props';
import { questObjectPreloadInternalsForTest } from '../src/render/quest_objects';
import { stationsPreloadInternalsForTest } from '../src/render/stations';
import { wildheartPropsPreloadInternalsForTest } from '../src/render/wildheart_props';
import { yumiMazePreloadInternalsForTest } from '../src/render/yumi_maze';
import { EASTBROOK_GRAND_ARMOURY } from '../src/sim/building_layout';
import type { BuildingDef } from '../src/sim/types';

const repoDir = path.join(__dirname, '..');
const publicDir = path.join(__dirname, '..', 'public');
const armouryRawOptimizationPath = path.join(
  repoDir,
  'tmp/asset_src/eastbrook_grand_armoury/eastbrook_grand_armoury-optimization.glb',
);
const armouryOptimizedCandidatePath = path.join(
  repoDir,
  'tmp/asset_optimized/eastbrook_grand_armoury/optimization-candidate/models/props/eastbrook_grand_armoury.glb',
);
const armouryShippingPath = path.join(
  publicDir,
  eastbrookGrandArmouryInternalsForTest.assetUrl.replace(/^\//, ''),
);
const armouryOptimizerSpecPath = path.join(
  repoDir,
  'scripts/assets/specs/eastbrook_grand_armoury.json',
);
interface ArmouryOptimizerSpec {
  items?: Array<{ src?: string; out?: string; type?: string; keepExtras?: boolean }>;
}
const armouryOptimizerSpec: ArmouryOptimizerSpec | null = existsSync(armouryOptimizerSpecPath)
  ? (JSON.parse(readFileSync(armouryOptimizerSpecPath, 'utf8')) as ArmouryOptimizerSpec)
  : null;
const armouryFinalPipelineEnabled =
  armouryOptimizerSpec?.items?.some((item) =>
    item.src?.endsWith('eastbrook_grand_armoury-final.glb'),
  ) ?? false;
const ARMOURY_SHIPPING_BYTE_CEILING = 160 * 1024;
const ARMOURY_SHIPPING_SHA256 = 'dd7542d8cbc0fbd12004366955b8ff7222218944eb98500f24f156e19fd4436f';
const MANIFEST_HASH_LENGTH = 12;

function expectAssetExistsAndManifested(url: string): void {
  const rel = url.replace(/^\//, '');
  expect(existsSync(path.join(publicDir, rel)), `${url} should exist under public/`).toBe(true);
  expect(
    MEDIA_ASSETS[rel],
    `${url} should be present in the generated media manifest`,
  ).toBeDefined();
}

function expectAssetManifestHashMatchesBytes(url: string): string {
  const rel = url.replace(/^\//, '');
  const bytes = readFileSync(path.join(publicDir, rel));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const parsed = path.posix.parse(rel);
  const expectedManifestUrl = path.posix.join(
    '/media',
    parsed.dir,
    `${parsed.name}.${sha256.slice(0, MANIFEST_HASH_LENGTH)}${parsed.ext}`,
  );
  expect(MEDIA_ASSETS[rel]).toBe(expectedManifestUrl);
  expect(path.posix.basename(expectedManifestUrl)).toContain(
    `.${sha256.slice(0, MANIFEST_HASH_LENGTH)}.`,
  );
  return sha256;
}

interface GlbJson {
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  extensions?: Record<string, unknown>;
  textures?: unknown[];
  images?: unknown[];
  samplers?: unknown[];
  animations?: unknown[];
  skins?: unknown[];
  cameras?: unknown[];
  nodes?: Array<{ extensions?: Record<string, unknown> }>;
  meshes?: Array<{
    primitives?: Array<{ extensions?: Record<string, unknown> }>;
  }>;
}

function readGlbJson(assetPath: string): GlbJson {
  const binary = readFileSync(assetPath);
  expect(binary.toString('utf8', 0, 4)).toBe('glTF');
  expect(binary.readUInt32LE(4)).toBe(2);
  let offset = 12;
  while (offset + 8 <= binary.length) {
    const chunkLength = binary.readUInt32LE(offset);
    const chunkType = binary.readUInt32LE(offset + 4);
    if (chunkType === 0x4e4f534a) {
      return JSON.parse(
        binary
          .toString('utf8', offset + 8, offset + 8 + chunkLength)
          .replace(/\0+$/, '')
          .trimEnd(),
      ) as GlbJson;
    }
    offset += 8 + chunkLength;
  }
  throw new Error(`${assetPath} has no JSON chunk`);
}

async function expectArmouryGlbContract(
  assetPath: string,
  options: { optimized: boolean; expectedStage: 'optimization' | 'final' },
): Promise<void> {
  const json = readGlbJson(assetPath);
  const expectedUsed = options.optimized
    ? ['EXT_meshopt_compression', 'KHR_materials_emissive_strength', 'KHR_mesh_quantization']
    : ['KHR_materials_emissive_strength'];
  const expectedRequired = options.optimized
    ? ['EXT_meshopt_compression', 'KHR_mesh_quantization']
    : [];
  expect([...(json.extensionsUsed ?? [])].sort()).toEqual(expectedUsed);
  expect([...(json.extensionsRequired ?? [])].sort()).toEqual(expectedRequired);
  expect(json.extensions ?? {}).not.toHaveProperty('KHR_lights_punctual');
  expect(json.nodes ?? []).not.toContainEqual(
    expect.objectContaining({
      extensions: expect.objectContaining({ KHR_lights_punctual: expect.anything() }),
    }),
  );
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      expect(primitive.extensions ?? {}).not.toHaveProperty('KHR_draco_mesh_compression');
    }
  }
  expect(json.textures ?? []).toHaveLength(0);
  expect(json.images ?? []).toHaveLength(0);
  expect(json.samplers ?? []).toHaveLength(0);
  expect(json.animations ?? []).toHaveLength(0);
  expect(json.skins ?? []).toHaveLength(0);
  expect(json.cameras ?? []).toHaveLength(0);

  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const document = await io.read(assetPath);
  const root = document.getRoot();
  const scene = root.listScenes()[0];
  if (!scene) throw new Error('Eastbrook Grand Armoury GLB has no scene');
  expect(root.listScenes()).toHaveLength(1);
  expect(scene.listChildren().map((node) => node.getName())).toEqual(['EastbrookGrandArmoury']);
  expect(root.listNodes()).toHaveLength(10);
  expect(
    root
      .listExtensionsUsed()
      .map((extension) => extension.extensionName)
      .sort(),
  ).toEqual(expectedUsed);
  expect(
    root
      .listExtensionsRequired()
      .map((extension) => extension.extensionName)
      .sort(),
  ).toEqual(expectedRequired);
  expect(root.listTextures()).toHaveLength(0);
  expect(root.listAnimations()).toHaveLength(0);
  expect(root.listSkins()).toHaveLength(0);
  expect(root.listCameras()).toHaveLength(0);

  for (const [accessorIndex, accessor] of root.listAccessors().entries()) {
    const array = accessor.getArray();
    expect(array, `accessor ${accessorIndex} should have decoded storage`).not.toBeNull();
    expect(accessor.getCount(), `accessor ${accessorIndex} should not be empty`).toBeGreaterThan(0);
    expect(
      accessor.getElementSize(),
      `accessor ${accessorIndex} should have components`,
    ).toBeGreaterThan(0);
    expect(array?.length).toBe(accessor.getCount() * accessor.getElementSize());
    if (array) {
      for (const value of array) {
        expect(Number.isFinite(value), `accessor ${accessorIndex} contains ${value}`).toBe(true);
      }
    }
  }

  const expectedMeshContracts = [
    ['ArmouryArcaneGlow', 'ArmouryArcaneEmissive', 16],
    ['ArmouryCobaltMasses', 'ArmouryCobalt', 716],
    ['ArmouryMetalMasses', 'ArmouryMetal', 1810],
    ['ArmouryStoneMasses', 'ArmouryStone', 3180],
    ['ArmouryTimberMasses', 'ArmouryTimber', 1912],
    ['ArmouryWarmGlow', 'ArmouryWarmEmissive', 592],
  ] as const;
  expect(root.listMeshes()).toHaveLength(6);
  const meshContracts = root
    .listNodes()
    .filter((node) => node.getMesh() !== null)
    .map((node) => {
      const mesh = node.getMesh();
      if (!mesh) throw new Error(`${node.getName()} lost its mesh`);
      expect(mesh.listPrimitives()).toHaveLength(1);
      const primitive = mesh.listPrimitives()[0];
      expect(primitive.getMode()).toBe(Primitive.Mode.TRIANGLES);
      expect(primitive.listSemantics().sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION']);
      const position = primitive.getAttribute('POSITION');
      const normal = primitive.getAttribute('NORMAL');
      const color = primitive.getAttribute('COLOR_0');
      if (!position) throw new Error(`${mesh.getName()} has no POSITION attribute`);
      if (!normal) throw new Error(`${mesh.getName()} has no NORMAL attribute`);
      if (!color) throw new Error(`${mesh.getName()} has no COLOR_0 attribute`);
      expect(position.getType()).toBe('VEC3');
      expect(normal.getType()).toBe('VEC3');
      expect(color.getType()).toBe('VEC3');
      expect(normal.getCount()).toBe(position.getCount());
      expect(color.getCount()).toBe(position.getCount());
      expect(position.getCount() % 3).toBe(0);
      const positionMin = position.getMinNormalized([]);
      const positionMax = position.getMaxNormalized([]);
      for (let axis = 0; axis < 3; axis++) {
        expect(Number.isFinite(positionMin[axis])).toBe(true);
        expect(Number.isFinite(positionMax[axis])).toBe(true);
        expect(
          positionMax[axis] - positionMin[axis],
          `${mesh.getName()} should have nondegenerate axis ${axis}`,
        ).toBeGreaterThan(0.0001);
      }
      const colorMin = color.getMinNormalized([]);
      const colorMax = color.getMaxNormalized([]);
      for (let channel = 0; channel < 3; channel++) {
        expect(colorMin[channel]).toBeGreaterThanOrEqual(0);
        expect(colorMax[channel]).toBeLessThanOrEqual(1);
      }
      if (options.optimized) {
        expect(position.getNormalized()).toBe(true);
        expect(normal.getNormalized()).toBe(true);
        expect(color.getNormalized()).toBe(true);
        expect(position.getComponentType()).toBe(5122);
        expect(normal.getComponentType()).toBe(5120);
        expect(color.getComponentType()).toBe(5121);
      }
      const triangles = (primitive.getIndices()?.getCount() ?? position.getCount()) / 3;
      return [node.getName(), primitive.getMaterial()?.getName(), triangles] as const;
    })
    .sort(([left], [right]) => left.localeCompare(right));
  expect(meshContracts).toEqual(expectedMeshContracts);
  expect(meshContracts.reduce((sum, contract) => sum + contract[2], 0)).toBe(8226);

  const materialNames = root
    .listMaterials()
    .map((material) => material.getName())
    .sort();
  expect(materialNames).toEqual([
    'ArmouryArcaneEmissive',
    'ArmouryCobalt',
    'ArmouryMetal',
    'ArmouryStone',
    'ArmouryTimber',
    'ArmouryWarmEmissive',
  ]);
  const emissiveMaterials = root
    .listMaterials()
    .filter((material) => material.getEmissiveFactor().some((value) => value > 0))
    .map((material) => material.getName())
    .sort();
  expect(emissiveMaterials).toEqual(['ArmouryArcaneEmissive', 'ArmouryWarmEmissive']);
  expect(
    root.listMaterials().filter((material) => !emissiveMaterials.includes(material.getName())),
  ).toHaveLength(4);

  const materialByName = new Map(
    root.listMaterials().map((material) => [material.getName(), material] as const),
  );
  for (const material of materialByName.values()) {
    // Albedo comes from COLOR_0, not an untracked material tint or texture.
    expect(material.getBaseColorFactor()).toEqual([1, 1, 1, 1]);
    expect(material.getBaseColorTexture()).toBeNull();
    expect(material.getMetallicRoughnessTexture()).toBeNull();
  }
  const requireMaterial = (name: string) => {
    const material = materialByName.get(name);
    if (!material) throw new Error(`missing material ${name}`);
    return material;
  };
  for (const name of ['ArmouryStone', 'ArmouryTimber', 'ArmouryCobalt']) {
    const material = requireMaterial(name);
    expect(material.getMetallicFactor()).toBeLessThanOrEqual(0.02);
    expect(material.getRoughnessFactor()).toBeGreaterThanOrEqual(0.8);
    expect(material.getEmissiveFactor()).toEqual([0, 0, 0]);
    expect(material.getExtension('KHR_materials_emissive_strength')).toBeNull();
  }
  const metal = requireMaterial('ArmouryMetal');
  expect(metal.getMetallicFactor()).toBeGreaterThanOrEqual(0.7);
  expect(metal.getRoughnessFactor()).toBeGreaterThanOrEqual(0.35);
  expect(metal.getRoughnessFactor()).toBeLessThanOrEqual(0.55);
  expect(metal.getEmissiveFactor()).toEqual([0, 0, 0]);

  const warm = requireMaterial('ArmouryWarmEmissive');
  const warmEmission = warm.getEmissiveFactor();
  const warmStrength = warm.getExtension<EmissiveStrength>('KHR_materials_emissive_strength');
  expect(warm.getMetallicFactor()).toBeLessThanOrEqual(0.02);
  expect(warm.getRoughnessFactor()).toBeLessThanOrEqual(0.4);
  expect(warmEmission[0]).toBeGreaterThan(warmEmission[1] * 3);
  expect(warmEmission[1]).toBeGreaterThan(warmEmission[2] * 3);
  expect(warmStrength?.getEmissiveStrength()).toBeGreaterThanOrEqual(1);

  const arcane = requireMaterial('ArmouryArcaneEmissive');
  const arcaneEmission = arcane.getEmissiveFactor();
  const arcaneStrength = arcane.getExtension<EmissiveStrength>('KHR_materials_emissive_strength');
  expect(arcane.getMetallicFactor()).toBeLessThanOrEqual(0.02);
  expect(arcane.getRoughnessFactor()).toBeLessThanOrEqual(0.3);
  expect(arcaneEmission[2]).toBeGreaterThan(arcaneEmission[1]);
  expect(arcaneEmission[1]).toBeGreaterThan(arcaneEmission[0] * 10);
  expect(arcaneStrength?.getEmissiveStrength()).toBeGreaterThanOrEqual(1);

  const bounds = getBounds(scene);
  expect(bounds.min[0]).toBeCloseTo(-6.5, 3);
  expect(bounds.min[1]).toBeCloseTo(0, 3);
  expect(bounds.min[2]).toBeCloseTo(-4.5, 3);
  expect(bounds.max[0]).toBeCloseTo(6.5, 3);
  expect(bounds.max[1]).toBeCloseTo(16.35, 3);
  expect(bounds.max[2]).toBeCloseTo(4.5, 3);

  const modelRoot = scene.listChildren()[0];
  expect(modelRoot.getTranslation()).toEqual([0, 0, 0]);
  expect(modelRoot.getRotation()).toEqual([0, 0, 0, 1]);
  expect(modelRoot.getScale()).toEqual([1, 1, 1]);
  expect(modelRoot.getExtras()).toEqual({
    sculptRuntime: {
      schemaVersion: 1,
      assetId: 'eastbrook-grand-armoury',
      stage: options.expectedStage,
      coordinateFrame: { front: '+Z', up: '+Y', right: '+X', units: 'world-yards' },
      nativeBounds: { width: 13, height: 16.35, depth: 9, foundationDepth: 1.35 },
      rootPivot: {
        nodeName: 'EastbrookGrandArmoury',
        floorCenter: [0, 0, 0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      },
      collider: {
        type: 'obb',
        center: [0, 8.175, 0],
        size: [13, 16.35, 9],
        halfExtents: [6.5, 8.175, 4.5],
        rotationQuaternion: [0, 0, 0, 1],
        shippingCollisionMesh: false,
      },
      interaction: {
        mode: 'static-closed-landmark',
        closedBuilding: true,
        interior: 'not-explorable',
        doors: 'closed-noninteractive',
        noticeboard: 'decorative-noninteractive',
        armouryDisplay: 'decorative-noninteractive',
      },
      sockets: {
        frontEntry: {
          nodeName: 'Socket_FrontEntry',
          position: [0, 2.25, 3.18],
          forward: [0, 0, 1],
          purpose: 'closed-entry-reference',
          interactive: false,
        },
        rearService: {
          nodeName: 'Socket_RearService',
          position: [0, 1.35, -4.5],
          forward: [0, 0, -1],
          purpose: 'closed-service-reference',
          interactive: false,
        },
        crestMount: {
          nodeName: 'Socket_CrestMount',
          position: [0, 6.35, 4.45],
          forward: [0, 0, 1],
          purpose: 'crest-mount-reference',
          interactive: false,
        },
      },
      destruction: { breakable: false, fractureGroup: null, detachableParts: [] },
    },
  });

  const expectedSockets = [
    {
      name: 'Socket_CrestMount',
      translation: [0, 6.35, 4.45],
      extras: {
        sculptSocket: {
          id: 'crestMount',
          purpose: 'crest-mount-reference',
          forward: [0, 0, 1],
          interactive: false,
        },
      },
    },
    {
      name: 'Socket_FrontEntry',
      translation: [0, 2.25, 3.18],
      extras: {
        sculptSocket: {
          id: 'frontEntry',
          purpose: 'closed-entry-reference',
          forward: [0, 0, 1],
          interactive: false,
        },
      },
    },
    {
      name: 'Socket_RearService',
      translation: [0, 1.35, -4.5],
      extras: {
        sculptSocket: {
          id: 'rearService',
          purpose: 'closed-service-reference',
          forward: [0, 0, -1],
          interactive: false,
        },
      },
    },
  ];
  const socketNodes = root
    .listNodes()
    .filter((node) => node.getName().startsWith('Socket_'))
    .map((node) => {
      expect(node.listChildren()).toHaveLength(0);
      expect(node.getMesh()).toBeNull();
      expect(node.getCamera()).toBeNull();
      expect(node.getSkin()).toBeNull();
      expect(node.getRotation()).toEqual([0, 0, 0, 1]);
      expect(node.getScale()).toEqual([1, 1, 1]);
      return {
        name: node.getName(),
        translation: node.getTranslation(),
        extras: node.getExtras(),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  expect(socketNodes).toEqual(expectedSockets);

  const expectedFingerprint = eastbrookGrandArmourySourceFingerprint(repoDir);
  expect(expectedFingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(root.getExtras()).toEqual({ sourceFingerprint: expectedFingerprint });
  expect(root.getAsset().extras).toEqual({ sourceFingerprint: expectedFingerprint });

  expect(EASTBROOK_GRAND_ARMOURY.nativeBounds).toEqual({ width: 13, height: 16.35, depth: 9 });
  const building: BuildingDef = {
    kind: 'inn',
    landmark: EASTBROOK_GRAND_ARMOURY.landmark,
    ...EASTBROOK_GRAND_ARMOURY.lot,
  };
  const placement = eastbrookGrandArmouryInternalsForTest.placementForBuilding(building, () => 0);
  expect(placement.scale).toBe(1 / EASTBROOK_GRAND_ARMOURY.modelUnitsPerWorldYard);
  expect(13 * placement.scale).toBeLessThanOrEqual(EASTBROOK_GRAND_ARMOURY.lot.w);
  expect(9 * placement.scale).toBeLessThanOrEqual(EASTBROOK_GRAND_ARMOURY.lot.d);

  if (options.optimized) {
    expect(statSync(assetPath).size).toBeLessThanOrEqual(ARMOURY_SHIPPING_BYTE_CEILING);
  }
}

describe('GLB-replacement asset preload sets resolve to real, manifested files', () => {
  it('leaping fish asset', () => {
    expectAssetExistsAndManifested(fishPreloadInternalsForTest.fishAssetUrl);
  });

  it('gather node assets', () => {
    for (const url of Object.values(gatherNodePreloadInternalsForTest.nodeAssetUrl)) {
      expectAssetExistsAndManifested(url);
    }
  });

  it('mailbox pillar asset', () => {
    expectAssetExistsAndManifested(mailboxPreloadInternalsForTest.mailboxAssetUrl);
  });

  it('banker chest asset', () => {
    const assetUrl = bankerChestPreloadInternalsForTest.bankerChestAssetUrl;
    expectAssetExistsAndManifested(assetUrl);

    const assetPath = path.join(publicDir, assetUrl.replace(/^\//, ''));
    const binary = readFileSync(assetPath).toString('latin1');
    expect(statSync(assetPath).size).toBeLessThanOrEqual(100 * 1024);
    expect(binary).toContain('EXT_meshopt_compression');
    expect(binary).not.toContain('KHR_draco_mesh_compression');
  });

  it('keeps the banker chest GLB within its authored geometry contract', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.read(
      path.join(
        publicDir,
        bankerChestPreloadInternalsForTest.bankerChestAssetUrl.replace(/^\//, ''),
      ),
    );
    const root = document.getRoot();
    const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
    const scene = root.listScenes()[0];
    if (!scene) throw new Error('banker chest GLB has no scene');
    const bounds = getBounds(scene);

    expect(root.listAnimations()).toHaveLength(0);
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listTextures()).toHaveLength(0);
    expect(root.listMaterials()).toHaveLength(4);
    expect(primitives).toHaveLength(4);

    const nativeHeight = bounds.max[1] - bounds.min[1];
    const runtimeScale = bankerChestPreloadInternalsForTest.targetHeight / nativeHeight;
    const scaledHalfWidth =
      Math.max(Math.abs(bounds.min[0]), Math.abs(bounds.max[0])) * runtimeScale;
    const scaledHalfDepth =
      Math.max(Math.abs(bounds.min[2]), Math.abs(bounds.max[2])) * runtimeScale;
    const scaledCenterX = ((bounds.min[0] + bounds.max[0]) / 2) * runtimeScale;
    const scaledCenterZ = ((bounds.min[2] + bounds.max[2]) / 2) * runtimeScale;

    expect(bounds.min[1]).toBeCloseTo(0, 3);
    expect(scaledCenterX).toBeCloseTo(0, 3);
    expect(scaledCenterZ).toBeCloseTo(0, 3);
    expect(scaledHalfWidth).toBeLessThanOrEqual(bankerChestPreloadInternalsForTest.halfWidth);
    expect(scaledHalfDepth).toBeLessThanOrEqual(bankerChestPreloadInternalsForTest.halfDepth);

    let triangleCount = 0;
    for (const [index, primitive] of primitives.entries()) {
      expect(primitive.getMode(), `primitive ${index} should use TRIANGLES`).toBe(
        Primitive.Mode.TRIANGLES,
      );
      expect(
        primitive.getAttribute('COLOR_0'),
        `primitive ${index} should retain authored vertex colors`,
      ).not.toBeNull();

      const position = primitive.getAttribute('POSITION');
      if (!position) throw new Error(`banker chest primitive ${index} has no POSITION attribute`);
      triangleCount += (primitive.getIndices()?.getCount() ?? position.getCount()) / 3;
    }

    expect(triangleCount).toBe(2048);
  });

  it('pins the Eastbrook Grand Armoury source fingerprint inputs and order', () => {
    expect(EASTBROOK_GRAND_ARMOURY_SOURCE_FILES).toEqual([
      'scripts/assets/eastbrook_grand_armoury/model.js',
      'scripts/assets/eastbrook_grand_armoury/export_entry.js',
      'scripts/assets/eastbrook_grand_armoury/export_eastbrook_grand_armoury.mjs',
      'scripts/assets/specs/eastbrook_grand_armoury.json',
      'scripts/assets/eastbrook_grand_armoury/source_fingerprint.mjs',
      'scripts/assets/build_assets.mjs',
      'package-lock.json',
    ]);
    expect(eastbrookGrandArmourySourceFingerprint(repoDir)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches a known source fingerprint and changes after a one-byte mutation', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'wocc-armoury-fingerprint-'));
    try {
      for (const [index, relativePath] of EASTBROOK_GRAND_ARMOURY_SOURCE_FILES.entries()) {
        const fixturePath = path.join(fixtureRoot, relativePath);
        mkdirSync(path.dirname(fixturePath), { recursive: true });
        writeFileSync(fixturePath, `fixture ${index}: ${relativePath}\n`);
      }

      const knownFingerprint = eastbrookGrandArmourySourceFingerprint(fixtureRoot);
      expect(knownFingerprint).toBe(
        'b4b18c6f18c4961912a8c556ce6823082b45bd247efeda9ceed69eb68339c726',
      );

      const mutatedPath = path.join(fixtureRoot, EASTBROOK_GRAND_ARMOURY_SOURCE_FILES[0]);
      writeFileSync(mutatedPath, `${readFileSync(mutatedPath, 'utf8')}!`);
      expect(eastbrookGrandArmourySourceFingerprint(fixtureRoot)).not.toBe(knownFingerprint);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(!existsSync(armouryRawOptimizationPath) || armouryFinalPipelineEnabled)(
    'keeps the raw optimization-stage Eastbrook Grand Armoury within its GLB contract',
    async () => {
      await expectArmouryGlbContract(armouryRawOptimizationPath, {
        optimized: false,
        expectedStage: 'optimization',
      });
    },
  );

  it.skipIf(!existsSync(armouryOptimizedCandidatePath) || armouryFinalPipelineEnabled)(
    'keeps the temporary optimized Eastbrook Grand Armoury within its GLB contract',
    async () => {
      await expectArmouryGlbContract(armouryOptimizedCandidatePath, {
        optimized: true,
        expectedStage: 'optimization',
      });
    },
  );

  it('requires the final source and shipped Eastbrook Grand Armoury contract', async () => {
    expect(existsSync(armouryOptimizerSpecPath), 'armoury optimizer spec should exist').toBe(true);
    expect(armouryOptimizerSpec?.items).toContainEqual({
      src: 'tmp/asset_src/eastbrook_grand_armoury/eastbrook_grand_armoury-final.glb',
      out: 'models/props/eastbrook_grand_armoury.glb',
      type: 'static',
      keepExtras: true,
    });
    expect(existsSync(armouryShippingPath), 'optimized shipping armoury GLB should exist').toBe(
      true,
    );
    expectAssetExistsAndManifested(eastbrookGrandArmouryInternalsForTest.assetUrl);
    expect(
      expectAssetManifestHashMatchesBytes(eastbrookGrandArmouryInternalsForTest.assetUrl),
    ).toBe(ARMOURY_SHIPPING_SHA256);
    await expectArmouryGlbContract(armouryShippingPath, {
      optimized: true,
      expectedStage: 'final',
    });
  });

  it('standalone delve prop assets', () => {
    for (const url of Object.values(delvePropsPreloadInternalsForTest.standalonePropUrl)) {
      expectAssetExistsAndManifested(url);
    }
  });

  it('marsh dressing anchor assets', () => {
    for (const url of Object.values(marshDressingPreloadInternalsForTest.marshAssetUrl)) {
      expectAssetExistsAndManifested(url);
    }
  });

  it('yumi maze brazier and torch assets', () => {
    for (const url of Object.values(yumiMazePreloadInternalsForTest.yumiMazeAssetUrl)) {
      expectAssetExistsAndManifested(url);
    }
  });

  it('dungeon door arch asset', () => {
    expectAssetExistsAndManifested(doorPortalPreloadInternalsForTest.doorArchAssetUrl);
    expectAssetExistsAndManifested(doorPortalPreloadInternalsForTest.wildheartGateAssetUrl);
  });

  it('quest object assets', () => {
    for (const url of Object.values(questObjectPreloadInternalsForTest.questObjectUrl)) {
      expectAssetExistsAndManifested(url);
    }
  });

  it('artisan row prop assets', () => {
    for (const url of Object.values(artisanRowPreloadInternalsForTest.assetUrl)) {
      expectAssetExistsAndManifested(url);
    }
  });

  it('crafting station prop assets (Professions 2.0)', () => {
    for (const url of Object.values(stationsPreloadInternalsForTest.assetUrl)) {
      expectAssetExistsAndManifested(url);
    }
  });

  it('Wildheart Basin jungle prop assets', () => {
    for (const url of Object.values(wildheartPropsPreloadInternalsForTest.assetUrl)) {
      expectAssetExistsAndManifested(url);
      const file = path.join(publicDir, url.replace(/^\//, ''));
      const size = statSync(file).size;
      expect(size, `${url} should meet the static-prop size floor`).toBeGreaterThanOrEqual(40_000);
      expect(size, `${url} should meet the static-prop size ceiling`).toBeLessThanOrEqual(100_000);
      expect(
        readGlbJson(path.join(publicDir, url.replace(/^\//, ''))).extensionsUsed,
        `${url} should use Meshopt`,
      ).toContain('EXT_meshopt_compression');
    }
  });

  it('Great Maze hedge wall and arch assets', () => {
    for (const url of Object.values(gardenFeaturesPreloadInternalsForTest.mazeAssetUrl)) {
      expectAssetExistsAndManifested(url);
    }
  });

  it('Old Beacon tower drum assets', () => {
    for (const url of galeFeaturesPreloadInternalsForTest.towerAssetUrl) {
      expectAssetExistsAndManifested(url);
    }
  });

  it('every decor prop asset (the full PROP_ASSET_DEFS catalog)', () => {
    for (const url of Object.values(propPreloadInternalsForTest.propAssetUrl)) {
      expectAssetExistsAndManifested(url);
    }
  });
});
