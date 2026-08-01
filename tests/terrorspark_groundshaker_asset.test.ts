import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  TANK_SOURCE_FILES,
  tankSourceFingerprint,
} from '../scripts/assets/terrorspark_groundshaker/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

const REPO_ROOT = path.join(__dirname, '..');
const ASSET_PATH = path.join(REPO_ROOT, 'public/models/mounts/terrorspark_groundshaker.glb');
// Textured surface + KTX2 embeds put this above the lighter WebP-era mounts
// (valorsteed 562 KiB, gobbler 555 KiB, toad 499 KiB). Budget tracks the
// shipped KTX2 GLB so the pin stays honest about size as well as content.
const SHIPPING_BUDGET = 1200 * 1024;
const EXPECTED_SOURCE_FINGERPRINT =
  '52a28d2009046c90ce062ec47371b22aa01feab1484fe7bca2a3c6d02715bc9d';
const EXPECTED_ASSET_SHA256 = 'a9ff2ca566419d2a2f002cab968840db437d2f2d2b6d7fab72fdbebe7808e7f9';
/** Midtone the ORM map's roughness and metalness channels encode; the material
 *  factors divide the authored target by it. */
const ORM_CENTER = 230 / 255;
/** Whole-repeat scale KHR_texture_transform restores after the exporter folds
 *  the world-space UVs into the [0, 1] range `quantize()` will accept. */
const EXPECTED_UV_RANGE = 6;

describe('tank mount asset pipeline', () => {
  it('pins the deterministic source inventory and optimizer specification', () => {
    expect(TANK_SOURCE_FILES).toEqual([
      'docs/design/terrorspark-groundshaker/reference-metadata.json',
      'docs/design/terrorspark-groundshaker/object-sculpt-spec.json',
      'scripts/assets/terrorspark_groundshaker/model.js',
      'scripts/assets/terrorspark_groundshaker/surface_shading.mjs',
      'scripts/assets/terrorspark_groundshaker/surface_maps.mjs',
      'scripts/assets/terrorspark_groundshaker/export_entry.js',
      'scripts/assets/terrorspark_groundshaker/export_terrorspark_groundshaker.mjs',
      'scripts/assets/terrorspark_groundshaker/source_fingerprint.mjs',
      'scripts/assets/specs/terrorspark_groundshaker.json',
      'scripts/assets/build_assets.mjs',
      'package-lock.json',
    ]);
    expect(tankSourceFingerprint(REPO_ROOT)).toBe(EXPECTED_SOURCE_FINGERPRINT);
    expect(
      JSON.parse(
        readFileSync(
          path.join(REPO_ROOT, 'scripts/assets/specs/terrorspark_groundshaker.json'),
          'utf8',
        ),
      ),
    ).toEqual({
      items: [
        {
          src: 'tmp/asset_src/terrorspark_groundshaker/terrorspark_groundshaker-final.glb',
          out: 'models/mounts/terrorspark_groundshaker.glb',
          type: 'character',
          keepExtras: true,
          keepClips: ['Idle', 'Walk', 'Run', 'Death'],
        },
      ],
    });
  });

  it('ships an optimized animated tank within the mount budget', async () => {
    await MeshoptDecoder.ready;
    const bytes = readFileSync(ASSET_PATH);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(sha256).toBe(EXPECTED_ASSET_SHA256);
    const mutated = Buffer.from(bytes);
    mutated[Math.floor(mutated.length / 2)] ^= 1;
    expect(createHash('sha256').update(mutated).digest('hex')).not.toBe(EXPECTED_ASSET_SHA256);
    expect(bytes.length).toBeGreaterThan(512 * 1024);
    expect(bytes.length).toBeLessThanOrEqual(SHIPPING_BUDGET);
    expect(MEDIA_ASSETS['models/mounts/terrorspark_groundshaker.glb']).toBe(
      `/media/models/mounts/terrorspark_groundshaker.${sha256.slice(0, 12)}.glb`,
    );

    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.readBinary(bytes);
    const root = document.getRoot();
    const sourceFingerprint = tankSourceFingerprint(REPO_ROOT);

    expect(
      root
        .listExtensionsRequired()
        .map((extension) => extension.extensionName)
        .sort(),
    ).toEqual([
      'EXT_meshopt_compression',
      'KHR_mesh_quantization',
      'KHR_texture_basisu',
      'KHR_texture_transform',
    ]);
    expect(root.getExtras()).toEqual({ sourceFingerprint });
    expect(root.getAsset().extras).toEqual({ sourceFingerprint });
    expect(
      root
        .listTextures()
        .map(
          (texture) =>
            `${texture.getName()} ${texture.getSize()?.join('x')} ${texture.getMimeType()}`,
        )
        .sort(),
    ).toEqual([
      'tank_fabric_albedo 512x512 image/ktx2',
      'tank_fabric_normal 256x256 image/ktx2',
      'tank_fabric_orm 256x256 image/ktx2',
      'tank_metal_albedo 1024x1024 image/ktx2',
      'tank_metal_normal 512x512 image/ktx2',
      'tank_metal_orm 512x512 image/ktx2',
    ]);
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listCameras()).toHaveLength(0);
    expect(root.listScenes()).toHaveLength(1);
    expect(
      root
        .listScenes()[0]
        .listChildren()
        .map((node) => node.getName()),
    ).toEqual(['Tank']);

    const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
    expect(primitives).toHaveLength(19);
    let triangles = 0;
    for (const primitive of primitives) {
      expect(primitive.getMode()).toBe(Primitive.Mode.TRIANGLES);
      expect(primitive.listSemantics().sort()).toEqual([
        'COLOR_0',
        'NORMAL',
        'POSITION',
        'TEXCOORD_0',
      ]);
      const uv = primitive.getAttribute('TEXCOORD_0');
      // Folded into the unit range so the optimizer quantizes the accessor
      // instead of leaving it float32; the transform scale below puts the
      // repeats back.
      expect(Math.min(...(uv?.getMinNormalized([]) ?? [-1]))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...(uv?.getMaxNormalized([]) ?? [2]))).toBeLessThanOrEqual(1);
      const positions = primitive.getAttribute('POSITION');
      expect(positions).not.toBeNull();
      triangles += (primitive.getIndices()?.getCount() ?? positions?.getCount() ?? 0) / 3;
    }
    expect(triangles).toBe(12_448);

    const materials = new Map(
      root.listMaterials().map((material) => [material.getName(), material] as const),
    );
    expect([...materials.keys()].sort()).toEqual([
      'TankBronze',
      'TankCreamPaint',
      'TankDarkIron',
      'TankLeather',
      'TankTextile',
      'TankVioletPaint',
    ]);
    // The shipped factor times the ORM map's midtone has to land back on the
    // authored target from TANK_MATERIAL_CONTRACT.
    const authored = {
      TankCreamPaint: { roughness: 0.62, metalness: 0.34 },
      TankVioletPaint: { roughness: 0.58, metalness: 0.38 },
      TankDarkIron: { roughness: 0.66, metalness: 0.68 },
      TankBronze: { roughness: 0.44, metalness: 0.72 },
      TankLeather: { roughness: 0.76, metalness: 0 },
      TankTextile: { roughness: 0.86, metalness: 0 },
    };
    for (const [name, target] of Object.entries(authored)) {
      const material = materials.get(name);
      expect((material?.getRoughnessFactor() ?? 0) * ORM_CENTER, `${name} roughness`).toBeCloseTo(
        target.roughness,
        5,
      );
      expect((material?.getMetallicFactor() ?? -1) * ORM_CENTER, `${name} metalness`).toBeCloseTo(
        target.metalness,
        5,
      );
    }
    expect(materials.get('TankCreamPaint')?.getRoughnessFactor()).toBeCloseTo(0.687391, 5);
    expect(materials.get('TankBronze')?.getMetallicFactor()).toBeCloseTo(0.798261, 5);
    expect(materials.get('TankLeather')?.getMetallicFactor()).toBe(0);
    // Dark iron, leather and textile sit higher than the original blockout
    // palette at the same hue: the baked occlusion, contact and grime bands need
    // headroom below the base colour or the treads and cannon crush to black.
    const expectedPalette = {
      TankVioletPaint: [0.254152, 0.111932, 0.386429],
      TankCreamPaint: [0.871367, 0.730461, 0.445201],
      TankDarkIron: [0.104616, 0.078187, 0.124772],
      TankBronze: [0.637597, 0.323143, 0.076185],
      TankLeather: [0.341914, 0.132868, 0.05448],
      TankTextile: [0.124772, 0.238398, 0.144128],
    };
    for (const [name, expected] of Object.entries(expectedPalette)) {
      const actual = materials.get(name)?.getBaseColorFactor().slice(0, 3);
      expect(actual, `${name} base color`).toBeDefined();
      expected.forEach((component, index) => {
        expect(actual?.[index], `${name} channel ${index}`).toBeCloseTo(component, 5);
      });
    }

    const bounds = getBounds(root.listScenes()[0]);
    expect(bounds.min[0]).toBeCloseTo(-1.445, 3);

    expect(bounds.min[1]).toBeCloseTo(0, 3);
    expect(bounds.min[2]).toBeCloseTo(-1.355, 3);
    expect(bounds.max[0]).toBeCloseTo(1.445, 3);
    expect(bounds.max[1]).toBeCloseTo(2.446, 3);
    expect(bounds.max[2]).toBeCloseTo(2.223, 3);
  });

  it('binds each material to its surface family and keeps the UV transform intact', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.readBinary(readFileSync(ASSET_PATH));
    const families: Record<string, 'metal' | 'fabric'> = {
      TankCreamPaint: 'metal',
      TankVioletPaint: 'metal',
      TankDarkIron: 'metal',
      TankBronze: 'metal',
      TankLeather: 'fabric',
      TankTextile: 'fabric',
    };

    for (const material of document.getRoot().listMaterials()) {
      const name = material.getName();
      const family = families[name];
      expect(family, `${name} has a surface family`).toBeDefined();
      expect(material.getBaseColorTexture()?.getName(), `${name} albedo`).toBe(
        `tank_${family}_albedo`,
      );
      expect(material.getNormalTexture()?.getName(), `${name} normal`).toBe(
        `tank_${family}_normal`,
      );
      expect(material.getNormalScale(), `${name} normal scale`).toBeCloseTo(0.85, 6);
      // One packed map serves both slots: R occlusion, G roughness, B metalness.
      const orm = material.getMetallicRoughnessTexture();
      expect(orm?.getName(), `${name} metallic-roughness`).toBe(`tank_${family}_orm`);
      expect(material.getOcclusionTexture(), `${name} reuses the ORM map for occlusion`).toBe(orm);

      for (const [slot, info] of [
        ['base color', material.getBaseColorTextureInfo()],
        ['normal', material.getNormalTextureInfo()],
        ['metallic-roughness', material.getMetallicRoughnessTextureInfo()],
        ['occlusion', material.getOcclusionTextureInfo()],
      ] as const) {
        // World-space projected detail only tiles if the sampler repeats, and
        // only lands at the authored density if the folded scale is restored.
        expect(info?.getWrapS(), `${name} ${slot} wrapS`).toBe(10497);
        expect(info?.getWrapT(), `${name} ${slot} wrapT`).toBe(10497);
        const transform = info?.getExtension('KHR_texture_transform') as
          | { getScale(): [number, number] }
          | null
          | undefined;
        expect(transform?.getScale(), `${name} ${slot} uv scale`).toEqual([
          EXPECTED_UV_RANGE,
          EXPECTED_UV_RANGE,
        ]);
      }
    }
  });

  it('bakes the macro shading band into COLOR_0 rather than one flat value per part', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.readBinary(readFileSync(ASSET_PATH));

    // The tracks are the largest primitive and span the full height of the
    // model, so they carry the widest slice of the bake.
    const tracks = document
      .getRoot()
      .listMeshes()
      .flatMap((mesh) => mesh.listPrimitives())
      .find(
        (primitive) =>
          (primitive.getIndices()?.getCount() ??
            primitive.getAttribute('POSITION')?.getCount() ??
            0) /
            3 ===
          6256,
      );
    expect(tracks, 'track primitive').toBeDefined();
    const colors = tracks?.getAttribute('COLOR_0');
    expect(colors).toBeDefined();

    const element: number[] = [];
    const values = new Set<number>();
    let min = Infinity;
    let max = -Infinity;
    for (let index = 0; index < (colors?.getCount() ?? 0); index++) {
      colors?.getElement(index, element);
      for (const channel of element.slice(0, 3)) {
        values.add(Math.round(channel * 255));
        min = Math.min(min, channel);
        max = Math.max(max, channel);
      }
    }
    // A flat per-part tint would collapse to a handful of levels; the baked
    // occlusion, contact, grime, dust, wear and mottle bands spread it out.
    expect(values.size).toBeGreaterThan(24);
    expect(max - min).toBeGreaterThan(0.1);
    // Nothing may exceed the zone tint or crush past the bake's floor.
    expect(max).toBeLessThanOrEqual(1);
    expect(min).toBeGreaterThan(0.05);
  });

  it('retains the rider, exhaust, wheel, and animation contracts', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.readBinary(readFileSync(ASSET_PATH));
    const root = document.getRoot();
    const nodes = new Map(root.listNodes().map((node) => [node.getName(), node] as const));

    expect(nodes.get('Socket_Rider')?.getTranslation()).toEqual([0, 2.08, -0.26]);
    expect(nodes.get('Socket_Rider')?.getExtras()).toEqual({
      socketType: 'rider-seat',
      purpose: 'mounted player seat',
    });
    expect(nodes.get('Socket_Exhaust')?.getTranslation()).toEqual([0.82, 1.55, -1.18]);
    expect(nodes.get('Socket_Exhaust')?.getExtras()).toEqual({
      socketType: 'vfx-emitter',
      purpose: 'future exhaust effect anchor',
    });
    expect(nodes.has('HullPivot')).toBe(true);
    for (const side of ['L', 'R']) {
      for (let index = 0; index < 5; index++) {
        expect(nodes.has(`Wheel_${side}_${index}`)).toBe(true);
      }
    }

    const animationContracts = root.listAnimations().map((animation) => {
      const channels = animation.listChannels();
      const duration = Math.max(
        ...animation.listSamplers().flatMap((sampler) => {
          const input = sampler.getInput()?.getArray();
          return input ? Array.from(input) : [0];
        }),
      );
      return {
        name: animation.getName(),
        channels: channels.length,
        duration,
        targets: new Set(
          channels
            .map((channel) => channel.getTargetNode()?.getName())
            .filter((name): name is string => Boolean(name)),
        ),
        channelContracts: channels.map((channel) => {
          const output = channel.getSampler()?.getOutput()?.getArray();
          return {
            target: channel.getTargetNode()?.getName() ?? '',
            path: channel.getTargetPath(),
            values: output ? Array.from(output) : [],
          };
        }),
      };
    });

    expect(animationContracts.map(({ name, channels }) => ({ name, channels }))).toEqual([
      { name: 'Idle', channels: 1 },
      { name: 'Walk', channels: 11 },
      { name: 'Run', channels: 11 },
      { name: 'Death', channels: 12 },
    ]);
    expect(animationContracts.map(({ duration }) => duration)).toEqual([
      expect.closeTo(2.4, 4),
      expect.closeTo(0.8, 4),
      expect.closeTo(0.55, 4),
      expect.closeTo(1.2, 4),
    ]);
    expect(animationContracts[1].targets).toEqual(
      new Set(['HullPivot', ...Array.from({ length: 10 }, (_, index) => nodesForWheel(index))]),
    );
    expect(animationContracts[2].targets).toEqual(animationContracts[1].targets);
    for (const animation of animationContracts) {
      expect([...animation.targets].some((target) => target.startsWith('Socket_'))).toBe(false);
      for (const channel of animation.channelContracts) {
        expect(
          new Set(channel.values).size,
          `${animation.name}:${channel.target} moves`,
        ).toBeGreaterThan(1);
        if (channel.target.startsWith('Wheel_')) {
          expect(channel.path).toBe('rotation');
          for (let index = 0; index < channel.values.length; index += 4) {
            expect(channel.values[index + 1], `${channel.target} quaternion Y`).toBe(0);
            expect(channel.values[index + 2], `${channel.target} quaternion Z`).toBe(0);
          }
        } else {
          expect(channel.target).toBe('HullPivot');
          expect(['rotation', 'translation']).toContain(channel.path);
        }
      }
    }
  });
});

function nodesForWheel(index: number): string {
  const side = index < 5 ? 'L' : 'R';
  return `Wheel_${side}_${index % 5}`;
}
