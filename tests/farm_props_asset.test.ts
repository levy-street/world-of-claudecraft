// The shipping contract for the fifteen farming prop GLBs: the deterministic
// source inventory and fingerprint, the optimizer specification, and, per asset,
// the exact bytes plus the parsed structure the renderer relies on (floor seated
// bounds, the Socket_Soil mount point, the CropAccent tint channel, and a
// texture-free vertex-colored mesh).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  FARM_ACCENT_MATERIAL,
  FARM_ACCENT_MESH_NODE,
  FARM_BODY_MATERIAL,
  FARM_BODY_MESH_NODE,
  FARM_PROP_CONTRACTS,
  FARM_PROP_IDS,
  FARM_SOIL_SOCKET_NODE,
} from '../scripts/assets/farm_props/model.js';
import {
  FARM_PROPS_SOURCE_FILES,
  farmPropsSourceFingerprint,
} from '../scripts/assets/farm_props/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  FARM_ACCENT_MATERIAL_NAME,
  FARM_ACCENT_MESH_NAME,
  FARM_SOIL_SOCKET_NAME,
} from '../src/render/farm_patches_core';

const REPO_ROOT = path.join(__dirname, '..');
// Re-minted at the fifteenth absorb: pnpm-lock.yaml is a fingerprint input
// (the (as) lockfile-seal family) and the release's three.js patch bump
// moved it; no farm source file changed (verified against the absorb range),
// so the shipping GLBs and every other pin stand.
// Re-minted again at the sixteenth absorb (release/v0.39.0, the Three.js
// 0.185.1 bump): the lockfile moved again, the shipping GLB extras were
// restamped in place (byte counts held), and the sha pins follow the
// restamped bytes. No farm source file changed.
// Re-minted again at the seventeenth absorb (release/v0.39.0 tip f48c7a3a9b,
// the castle and icon-art batch): the lockfile moved again (ten lines), the
// same in-place restamp of both stamp sites per GLB, byte counts held, sha
// pins re-recorded from the restamped bytes. No farm source file changed.
const SOURCE_FINGERPRINT = 'a6855bc0aa412198ea367e40990f0ff28cb043d7dc3ca53974502ee3e726be9a';
const SET_BYTES = 174_844;
const PER_ASSET_BYTE_CEILING = 35 * 1024;
const TRIANGLE_CEILING = 1_200;

// The whole set, written out here so the module's own ordering cannot define its
// own expectation.
const EXPECTED_IDS = [
  'farm_bed',
  'farm_sprout',
  'farm_grain_stage2',
  'farm_rootleaf_stage2',
  'farm_gourd_stage2',
  'farm_grain_stage3',
  'farm_rootleaf_stage3',
  'farm_gourd_stage3',
  'farm_grain_stage4',
  'farm_rootleaf_stage4',
  'farm_gourd_stage4',
  'farm_grain_withered',
  'farm_rootleaf_withered',
  'farm_gourd_withered',
  'farm_compost_bin',
] as const;

// The six stages that carry crop identity. Every other asset must NOT have one.
const ACCENT_IDS = [
  'farm_grain_stage3',
  'farm_rootleaf_stage3',
  'farm_gourd_stage3',
  'farm_grain_stage4',
  'farm_rootleaf_stage4',
  'farm_gourd_stage4',
] as const;

interface AssetPin {
  readonly bytes: number;
  readonly sha256: string;
  readonly triangles: number;
  readonly footprintYd: readonly [number, number];
  readonly heightYd: number;
}

const PINS: Readonly<Record<string, AssetPin>> = {
  farm_bed: {
    bytes: 6_880,
    sha256: '11a2d2af758dfaa0f903654e3dc2af539dc9e9a39bcf6871f75453579bbdecc9',
    triangles: 228,
    footprintYd: [3, 2],
    heightYd: 0.34,
  },
  farm_sprout: {
    bytes: 5_168,
    sha256: 'db70b2e7755f3cdf1ec3b93b59976c7c94fa59fe124e121705ff041affee3520',
    triangles: 108,
    footprintYd: [1.67, 0.97],
    heightYd: 0.25,
  },
  farm_grain_stage2: {
    bytes: 5_248,
    sha256: '8a65d192dbbafac6c22af42db493dfda834ab52ca7e7cbda7412d864940554ba',
    triangles: 108,
    footprintYd: [1.81, 1.04],
    heightYd: 0.42,
  },
  farm_rootleaf_stage2: {
    bytes: 8_792,
    sha256: 'e16a033062bf24b4b68e53e81fb4e6eeaa38461957f0a911bec2c08f4cfa470e',
    triangles: 240,
    footprintYd: [1.61, 1.31],
    heightYd: 0.22,
  },
  farm_gourd_stage2: {
    bytes: 9_580,
    sha256: '7da1eda7683ead6e701f9bc5c4c676c7c5c656dc24ff9e320b3079c44c0d096c',
    triangles: 360,
    footprintYd: [1.8, 1.16],
    heightYd: 0.09,
  },
  farm_grain_stage3: {
    bytes: 10_988,
    sha256: 'f7586c2a53c6a092a67488d4ebe57bc73233c3c88df27f9e0f0313853f2bbf89',
    triangles: 288,
    footprintYd: [1.91, 1.31],
    heightYd: 0.82,
  },
  farm_rootleaf_stage3: {
    bytes: 17_776,
    sha256: '0bc014dbca511ae8ed7a3eb8eba93168a65d53ed5bf702db7fa3c3867dda30e9',
    triangles: 540,
    footprintYd: [2.16, 1.49],
    heightYd: 0.37,
  },
  farm_gourd_stage3: {
    bytes: 16_460,
    sha256: '5124f2bcebed5c2b28b4def319bb41e52738b936bb9883ce5d6a1db18e37b941',
    triangles: 612,
    footprintYd: [2.46, 1.5],
    heightYd: 0.18,
  },
  farm_grain_stage4: {
    bytes: 12_212,
    sha256: '8d4870ef3f498de6fae231c4c61bfd00dd22f06f2bc16c282e2d4c1f0a727a20',
    triangles: 336,
    footprintYd: [2.54, 1.38],
    heightYd: 1.07,
  },
  farm_rootleaf_stage4: {
    bytes: 22_308,
    sha256: '59a286872236b3f35c9efdc0ce8deb801ef2633c07ed471340a92c7f1f6c6003',
    triangles: 720,
    footprintYd: [2.72, 1.71],
    heightYd: 0.58,
  },
  farm_gourd_stage4: {
    bytes: 16_740,
    sha256: '149508b02b9d752c32a84ced562c9e8b367881c8b9937a83e5a6b4e79cc84ddb',
    triangles: 620,
    footprintYd: [2.63, 1.61],
    heightYd: 0.4,
  },
  farm_grain_withered: {
    bytes: 9_656,
    sha256: '7a95f4f25065704070065ad49613fc506d21fc2bafaf2484a0afd26acc1d6a09',
    triangles: 288,
    footprintYd: [2.17, 1.36],
    heightYd: 0.66,
  },
  farm_rootleaf_withered: {
    bytes: 11_724,
    sha256: 'aadbcf6e5f57c75c92c9b7e376d8573d5c30c7caaefaf040fc884cd7daa7afa9',
    triangles: 360,
    footprintYd: [2.12, 1.47],
    heightYd: 0.24,
  },
  farm_gourd_withered: {
    bytes: 13_872,
    sha256: '032e3676be85f4f85c44b918a370a9727fb9b67cd31660fb294745cbbf99a8eb',
    triangles: 576,
    footprintYd: [2.43, 1.42],
    heightYd: 0.14,
  },
  farm_compost_bin: {
    bytes: 7_440,
    sha256: '87da61275406dd3772825f8f30aa658525dfc9b2a64a6a959ddf45961902164d',
    triangles: 264,
    footprintYd: [1, 1],
    heightYd: 0.8,
  },
};

// crop_accent ships a light neutral so a per-crop multiply reads as identity;
// the shared foliage must stay clearly darker than that band, or the tint would
// have nothing to bite on.
const ACCENT_BYTE_FLOOR = 178;
const ACCENT_BYTE_CEILING = 218;
const BODY_BYTE_CEILING = 160;

async function readAsset(id: string) {
  await MeshoptDecoder.ready;
  const bytes = readFileSync(path.join(REPO_ROOT, 'public', `models/props/${id}.glb`));
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return { bytes, document: await io.readBinary(bytes) };
}

function colorBand(values: ArrayLike<number>): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index++) {
    min = Math.min(min, values[index]);
    max = Math.max(max, values[index]);
  }
  return { min, max };
}

describe('license record', () => {
  // Every shipped GLB prop set carries a CREDITS.md row (the streetlamp and
  // battleground-rune waves pin theirs the same way), so the next art wave
  // cannot drop the farming set's provenance silently.
  it('CREDITS.md carries the farm prop set row naming every asset', () => {
    const credits = readFileSync(path.join(REPO_ROOT, 'CREDITS.md'), 'utf8');
    expect(credits).toContain('Generated farming prop set (`public/models/props/farm_bed.glb`');
    expect(credits).toContain(
      'produced via `scripts/assets/farm_props` and optimized via `scripts/assets/specs/farm_props.json`',
    );
    for (const id of FARM_PROP_IDS) {
      expect(credits, `${id} named in the CREDITS row`).toContain(`${id}.glb`);
    }
  });
});

describe('exporter and renderer agree on the authored node names', () => {
  // Two INDEPENDENT literal sets describe the same contract: the exporter
  // writes these names into the GLBs, and the render core looks them up at
  // mount and tint time. Nothing else connects them, so a rename on either
  // side would ship beds with no crops on them and no test would notice.
  // This is that test.
  it('pins the soil socket, accent mesh and accent material across both sides', () => {
    expect(FARM_SOIL_SOCKET_NODE).toBe(FARM_SOIL_SOCKET_NAME);
    expect(FARM_ACCENT_MESH_NODE).toBe(FARM_ACCENT_MESH_NAME);
    expect(FARM_ACCENT_MATERIAL).toBe(FARM_ACCENT_MATERIAL_NAME);
  });

  it('pins each name to its literal, so a matched rename on both sides reds', () => {
    // Without this arm the cross-check above is satisfied by ANY pair of equal
    // strings, including two sides renamed together away from what the shipped
    // GLBs actually contain.
    expect(FARM_SOIL_SOCKET_NAME).toBe('Socket_Soil');
    expect(FARM_ACCENT_MESH_NAME).toBe('CropAccent');
    expect(FARM_ACCENT_MATERIAL_NAME).toBe('crop_accent');
  });
});

describe('farm prop authoring pipeline', () => {
  it('pins the deterministic source inventory, fingerprint, and optimizer specification', () => {
    expect(FARM_PROPS_SOURCE_FILES).toEqual([
      'scripts/assets/farm_props/model.js',
      'scripts/assets/farm_props/export_entry.js',
      'scripts/assets/farm_props/export_farm_props.mjs',
      'scripts/assets/farm_props/source_fingerprint.mjs',
      'scripts/assets/farm_props/source_fingerprint.d.mts',
      'scripts/assets/specs/farm_props.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ]);
    expect(farmPropsSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);

    const spec = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'scripts/assets/specs/farm_props.json'), 'utf8'),
    );
    expect(spec).toEqual({
      items: EXPECTED_IDS.map((id) => ({
        src: `tmp/asset_src/farm_props/${id}.glb`,
        out: `models/props/${id}.glb`,
        type: 'static',
        keepExtras: true,
      })),
    });
  });

  it('covers exactly the fifteen shipped assets with a deep-frozen contract', () => {
    expect(FARM_PROP_IDS).toEqual([...EXPECTED_IDS]);
    expect(Object.values(FARM_PROP_CONTRACTS).map((contract) => contract.out)).toEqual(
      EXPECTED_IDS.map((id) => `models/props/${id}.glb`),
    );
    expect(Object.isFrozen(FARM_PROP_CONTRACTS)).toBe(true);
    for (const id of EXPECTED_IDS) {
      const contract = FARM_PROP_CONTRACTS[id];
      expect(Object.isFrozen(contract)).toBe(true);
      expect(Object.isFrozen(contract.footprintYd)).toBe(true);
      expect(Object.isFrozen(contract.meshes)).toBe(true);
      expect(Object.isFrozen(contract.materials)).toBe(true);
      expect(Object.isFrozen(contract.sockets)).toBe(true);
      expect(Object.isFrozen(contract.tintChannels)).toBe(true);
      expect(contract.id).toBe(id);
      expect(contract.pivot).toBe('floor-center');
      // The contract is consumed as JSON by the Phase 13 handoff manifest.
      expect(JSON.parse(JSON.stringify(contract))).toEqual(contract);
    }
  });

  it('documents the tint channels the renderer multiplies through', () => {
    expect(Object.keys(FARM_PROP_CONTRACTS.farm_bed.tintChannels)).toEqual([FARM_BODY_MATERIAL]);
    expect(FARM_PROP_CONTRACTS.farm_bed.sockets).toEqual({
      [FARM_SOIL_SOCKET_NODE]: 'stage mesh mount point at the center of the soil surface',
    });
    expect(FARM_PROP_CONTRACTS.farm_bed.mountsOn).toBeNull();
    for (const id of EXPECTED_IDS) {
      const contract = FARM_PROP_CONTRACTS[id];
      const wantsAccent = (ACCENT_IDS as readonly string[]).includes(id);
      expect(Object.keys(contract.tintChannels)).toEqual([...contract.materials]);
      expect(contract.materials.includes(FARM_ACCENT_MATERIAL)).toBe(wantsAccent);
      expect(contract.meshes.includes(FARM_ACCENT_MESH_NODE)).toBe(wantsAccent);
      expect(contract.meshes.includes(FARM_BODY_MESH_NODE)).toBe(true);
      // Only the bed owns a mount point; every crop stage mounts onto it.
      expect(Object.keys(contract.sockets)).toEqual(id === 'farm_bed' ? ['Socket_Soil'] : []);
      expect(contract.mountsOn).toBe(
        id === 'farm_bed' || id === 'farm_compost_bin' ? null : 'Socket_Soil',
      );
    }
  });

  it('keeps the whole set inside its byte budget', () => {
    const total = EXPECTED_IDS.reduce((sum, id) => sum + PINS[id].bytes, 0);
    expect(total).toBe(SET_BYTES);
    expect(total).toBeLessThanOrEqual(400 * 1024);
  });
});

describe.each(EXPECTED_IDS)('farm prop GLB %s', (id) => {
  const pin = PINS[id];
  const contract = FARM_PROP_CONTRACTS[id];
  const wantsAccent = (ACCENT_IDS as readonly string[]).includes(id);

  it('pins its exact bytes and the content-hashed media manifest entry', async () => {
    const { bytes } = await readAsset(id);
    expect(bytes.length).toBe(pin.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(pin.sha256);
    expect(bytes.length).toBeLessThanOrEqual(PER_ASSET_BYTE_CEILING);
    expect(MEDIA_ASSETS[`models/props/${id}.glb`]).toBe(
      `/media/models/props/${id}.${pin.sha256.slice(0, 12)}.glb`,
    );
  });

  it('ships one scene of texture-free vertex-colored triangles', async () => {
    const { document } = await readAsset(id);
    const root = document.getRoot();
    expect(
      root
        .listExtensionsUsed()
        .map((extension) => extension.extensionName)
        .sort(),
    ).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
    expect(root.listTextures()).toHaveLength(0);
    expect(root.listAnimations()).toHaveLength(0);
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listCameras()).toHaveLength(0);
    expect(root.listScenes()).toHaveLength(1);
    expect(
      root
        .listMaterials()
        .map((material) => material.getName())
        .sort(),
    ).toEqual([...contract.materials].sort());
    for (const material of root.listMaterials()) {
      expect(material.getBaseColorFactor()).toEqual([1, 1, 1, 1]);
      expect(material.getBaseColorTexture()).toBeNull();
    }

    const meshNodes = root.listNodes().filter((node) => node.getMesh() !== null);
    expect(meshNodes.map((node) => node.getName()).sort()).toEqual([...contract.meshes].sort());
    let triangles = 0;
    for (const node of meshNodes) {
      const mesh = node.getMesh();
      if (!mesh) throw new Error(`${node.getName()} lost its mesh`);
      expect(mesh.listPrimitives()).toHaveLength(1);
      const primitive = mesh.listPrimitives()[0];
      expect(primitive.getMode()).toBe(Primitive.Mode.TRIANGLES);
      expect(primitive.listSemantics().sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION']);
      const position = primitive.getAttribute('POSITION');
      const color = primitive.getAttribute('COLOR_0');
      if (!position || !color) throw new Error(`${node.getName()} lost attributes`);
      triangles += (primitive.getIndices()?.getCount() ?? position.getCount()) / 3;

      // Vertex colors are the only surface signal these assets carry.
      expect(color.getComponentType()).toBe(5121);
      expect(color.getNormalized()).toBe(true);
      const band = colorBand(color.getArray() ?? []);
      if (node.getName() === FARM_ACCENT_MESH_NODE) {
        expect(primitive.getMaterial()?.getName()).toBe(FARM_ACCENT_MATERIAL);
        expect(band.min).toBeGreaterThanOrEqual(ACCENT_BYTE_FLOOR);
        expect(band.max).toBeLessThanOrEqual(ACCENT_BYTE_CEILING);
      } else {
        expect(primitive.getMaterial()?.getName()).toBe(FARM_BODY_MATERIAL);
        expect(band.max).toBeLessThanOrEqual(BODY_BYTE_CEILING);
      }
    }
    expect(triangles).toBe(pin.triangles);
    expect(triangles).toBeLessThanOrEqual(TRIANGLE_CEILING);
  });

  it('carries the crop accent tint channel only where a crop identity exists', async () => {
    const { document } = await readAsset(id);
    const root = document.getRoot();
    const hasAccentNode = root.listNodes().some((node) => node.getName() === FARM_ACCENT_MESH_NODE);
    const hasAccentMaterial = root
      .listMaterials()
      .some((material) => material.getName() === FARM_ACCENT_MATERIAL);
    expect(hasAccentNode).toBe(wantsAccent);
    expect(hasAccentMaterial).toBe(wantsAccent);
  });

  it('is floor seated, centered on X and Z, and fills its contract footprint', async () => {
    const { document } = await readAsset(id);
    const scene = document.getRoot().listScenes()[0];
    const bounds = getBounds(scene);
    const [footprintX, footprintZ] = pin.footprintYd;
    expect(bounds.min[0]).toBeCloseTo(-footprintX / 2, 3);
    expect(bounds.max[0]).toBeCloseTo(footprintX / 2, 3);
    expect(bounds.min[1]).toBeCloseTo(0, 3);
    expect(bounds.max[1]).toBeCloseTo(pin.heightYd, 3);
    expect(bounds.min[2]).toBeCloseTo(-footprintZ / 2, 3);
    expect(bounds.max[2]).toBeCloseTo(footprintZ / 2, 3);
    // The factory contract and the shipped geometry must agree.
    expect([...contract.footprintYd]).toEqual([...pin.footprintYd]);
    expect(contract.heightYd).toBe(pin.heightYd);
  });

  it('stamps the swap-ready contract row and the source fingerprint on the root', async () => {
    const { document } = await readAsset(id);
    const root = document.getRoot();
    expect(root.getExtras()).toEqual({ sourceFingerprint: SOURCE_FINGERPRINT });
    expect(root.getAsset().extras).toEqual({ sourceFingerprint: SOURCE_FINGERPRINT });

    const scene = root.listScenes()[0];
    expect(scene.listChildren().map((node) => node.getName())).toEqual([contract.rootNode]);
    const modelRoot = scene.listChildren()[0];
    expect(modelRoot.getTranslation()).toEqual([0, 0, 0]);
    expect(modelRoot.getRotation()).toEqual([0, 0, 0, 1]);
    expect(modelRoot.getScale()).toEqual([1, 1, 1]);
    expect(modelRoot.getExtras()).toEqual({
      farmPropContract: JSON.parse(JSON.stringify(contract)),
      sculptRuntime: {
        schemaVersion: 1,
        assetId: id,
        source: 'deterministic-procedural-threejs',
        coordinateFrame: { front: '+Z', up: '+Y', right: '+X', units: 'world-yards' },
        swapReady: true,
      },
    });
  });

  it('exposes Socket_Soil on the bed alone, empty and on the soil surface', async () => {
    const { document } = await readAsset(id);
    const sockets = document
      .getRoot()
      .listNodes()
      .filter((node) => node.getName().startsWith('Socket_'));
    if (id !== 'farm_bed') {
      expect(sockets).toHaveLength(0);
      return;
    }
    expect(sockets.map((node) => node.getName())).toEqual([FARM_SOIL_SOCKET_NODE]);
    const socket = sockets[0];
    expect(socket.listChildren()).toHaveLength(0);
    expect(socket.getMesh()).toBeNull();
    expect(socket.getTranslation()[0]).toBeCloseTo(0, 4);
    expect(socket.getTranslation()[1]).toBeCloseTo(0.22, 4);
    expect(socket.getTranslation()[2]).toBeCloseTo(0, 4);
    expect(socket.getExtras()).toEqual({
      farmPropSocket: {
        name: FARM_SOIL_SOCKET_NODE,
        purpose: 'stage mesh mount point at the center of the soil surface',
      },
    });
  });
});
