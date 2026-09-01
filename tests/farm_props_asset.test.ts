// The shipping contract for the seventeen farming prop GLBs: the deterministic
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
import { NO_ITEM_PICK_FOOTPRINT, NO_ITEM_PICK_HEIGHT } from '../src/render/quest_objects';

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
// Re-minted at the Phase 12 shared feast: model.js gained the farm_feast
// builder and contract (a REAL source change, not an absorb), so the
// fingerprint moved and every GLB restamped in place. The fifteen existing
// byte counts and triangle counts held exactly; farm_feast is the one new
// asset and the only new bytes in the set.
// Re-minted at the Masterwrought farming absorb (Phase 11d): the merged
// pnpm-lock.yaml (a fingerprint input) differs from the farming tip's, so the
// fingerprint moved; the sixteen shipping GLB extras were restamped in place
// (both stamp sites per GLB, byte counts held) and the sha pins follow the
// restamped bytes. No farm source file changed.
// Re-exported at Masterwrought Phase 18 for the APEX feast table: model.js
// gained the farm_feast_apex builder and contract and the spec gained its row
// (a REAL source change, not an absorb), so the fingerprint moved and every
// GLB was re-exported. The sixteen existing byte counts, triangle counts and
// bounds held exactly; farm_feast_apex is the one new asset and the only new
// bytes. That re-export also discharged the v0.42.0 lockfile drift this family
// still owed (the release re-minted its own asset families and could not touch
// this branch-owned one).
const SOURCE_FINGERPRINT = 'd3be15761b4891dcf9e30779da9337f5eaf11033f9f36a62f4f84c22f5b2812f';
const SET_BYTES = 208_200;
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
  'farm_feast',
  'farm_feast_apex',
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
    sha256: 'daeaa5ace092d41bdbc425ae435c78df32cc1a44dc57fed801d1e91d3f2ea429',
    triangles: 228,
    footprintYd: [3, 2],
    heightYd: 0.34,
  },
  farm_sprout: {
    bytes: 5_168,
    sha256: 'e3dabe23ee7ee654b772aba83e1febcf30b2bb9d73b7ce2fe47b94f0360d6ff0',
    triangles: 108,
    footprintYd: [1.67, 0.97],
    heightYd: 0.25,
  },
  farm_grain_stage2: {
    bytes: 5_248,
    sha256: '75f747cabf837350e513a3847e4edd361bb4636bcb7cd2197c6fd0a968e1838f',
    triangles: 108,
    footprintYd: [1.81, 1.04],
    heightYd: 0.42,
  },
  farm_rootleaf_stage2: {
    bytes: 8_792,
    sha256: '06b582fd54d3a46841ab9d298bc2723658bba9d2eeb9bbcd21dbb00ed1f91249',
    triangles: 240,
    footprintYd: [1.61, 1.31],
    heightYd: 0.22,
  },
  farm_gourd_stage2: {
    bytes: 9_580,
    sha256: '27926d4856d1f148757e7359a8ed4a47cbaa0c8d2c471f934b6686b4862c04ad',
    triangles: 360,
    footprintYd: [1.8, 1.16],
    heightYd: 0.09,
  },
  farm_grain_stage3: {
    bytes: 10_988,
    sha256: 'f3dec95cdc4e8b7ee2ca40c1cb149e050d30d414f7114f641e4c14998108e3a2',
    triangles: 288,
    footprintYd: [1.91, 1.31],
    heightYd: 0.82,
  },
  farm_rootleaf_stage3: {
    bytes: 17_776,
    sha256: '11fdac397e34b7b9eb2029f6c2e0634eb76566a8e9160b5c63f074697b184775',
    triangles: 540,
    footprintYd: [2.16, 1.49],
    heightYd: 0.37,
  },
  farm_gourd_stage3: {
    bytes: 16_460,
    sha256: 'a8b9aa53a81d1ae4ecbe0d74159276d5223b7c50901fcb34686d3e75a7f1f15c',
    triangles: 612,
    footprintYd: [2.46, 1.5],
    heightYd: 0.18,
  },
  farm_grain_stage4: {
    bytes: 12_212,
    sha256: '3f9fa3f0be95bafd6cbcad90c9685692cff6e2e66415259eb62bfa9eff6fcb33',
    triangles: 336,
    footprintYd: [2.54, 1.38],
    heightYd: 1.07,
  },
  farm_rootleaf_stage4: {
    bytes: 22_308,
    sha256: '4d23f6706cd3823cb56e6e1f4bba17720be4a1de3589bcb5a32d407dbd7a69f0',
    triangles: 720,
    footprintYd: [2.72, 1.71],
    heightYd: 0.58,
  },
  farm_gourd_stage4: {
    bytes: 16_740,
    sha256: 'eebdb72321eafa3891481ca3a9917515c40311a41682a7014570634b80582c5f',
    triangles: 620,
    footprintYd: [2.63, 1.61],
    heightYd: 0.4,
  },
  farm_grain_withered: {
    bytes: 9_656,
    sha256: '6879bcaa1a13f08ab6192f67a36506c59c6cb4111426a49dc5c839bb32707ad8',
    triangles: 288,
    footprintYd: [2.17, 1.36],
    heightYd: 0.66,
  },
  farm_rootleaf_withered: {
    bytes: 11_724,
    sha256: '7a297afb6a058fea5d7c4d68360666d9392be5ea184f93523740c4289af50deb',
    triangles: 360,
    footprintYd: [2.12, 1.47],
    heightYd: 0.24,
  },
  farm_gourd_withered: {
    bytes: 13_872,
    sha256: 'eaa139609c554391fcda9fbe2bd5fc3d28104ed17d7539fc037cf8ea78ba3063',
    triangles: 576,
    footprintYd: [2.43, 1.42],
    heightYd: 0.14,
  },
  farm_compost_bin: {
    bytes: 7_440,
    sha256: 'ae7726735da104c7ed91fd160e32d6b9f038b5e8d9e20f94e167b777e790f29a',
    triangles: 264,
    footprintYd: [1, 1],
    heightYd: 0.8,
  },
  farm_feast: {
    bytes: 15_644,
    sha256: '1fad730a050f77a527019aa3903c9b9cb82569b81294b02a0048c8a58d19add0',
    triangles: 656,
    footprintYd: [1.6, 1.6],
    heightYd: 0.9,
  },
  // The apex feast table. Its footprint and height MUST equal farm_feast's:
  // both wear the one pick proxy in src/render/quest_objects.ts, and the pin
  // at the bottom of this file checks that proxy against farm_feast alone, so
  // the equality is asserted here as well.
  farm_feast_apex: {
    bytes: 17_712,
    sha256: '1d8a48c6c3fa2f93a44f3279275025c9dd828a68d987157273ba869d231dea1c',
    triangles: 780,
    footprintYd: [1.6, 1.6],
    heightYd: 0.9,
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

  it('covers exactly the seventeen shipped assets with a deep-frozen contract', () => {
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
      // Only the bed owns a mount point; every crop stage mounts onto it. The
      // two utility props and BOTH placed feasts stand on their own ground.
      expect(Object.keys(contract.sockets)).toEqual(id === 'farm_bed' ? ['Socket_Soil'] : []);
      const standsAlone = ['farm_bed', 'farm_compost_bin', 'farm_feast', 'farm_feast_apex'];
      expect(contract.mountsOn).toBe(standsAlone.includes(id) ? null : 'Socket_Soil');
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

describe('feast pick proxy stays in step with the GLB contract', () => {
  // The invisible click box in src/render/quest_objects.ts is hand-sized to
  // the authored prop contract; an authored resize that forgets the proxy
  // would silently desync the click target from the visible table. ONE proxy
  // serves BOTH tables, so both contracts are checked against it.
  it('the proxy pair equals both feast contracts bounds', () => {
    for (const id of ['farm_feast', 'farm_feast_apex'] as const) {
      const contract = FARM_PROP_CONTRACTS[id];
      expect([NO_ITEM_PICK_FOOTPRINT, NO_ITEM_PICK_FOOTPRINT], id).toEqual(contract.footprintYd);
      expect(NO_ITEM_PICK_HEIGHT, id).toBe(contract.heightYd);
    }
  });

  // The equality between the two tables, stated on its own: the apex prop may
  // never be authored to a different envelope while one proxy covers both.
  it('both feast tables share one authored envelope', () => {
    expect([...FARM_PROP_CONTRACTS.farm_feast_apex.footprintYd]).toEqual([
      ...FARM_PROP_CONTRACTS.farm_feast.footprintYd,
    ]);
    expect(FARM_PROP_CONTRACTS.farm_feast_apex.heightYd).toBe(
      FARM_PROP_CONTRACTS.farm_feast.heightYd,
    );
  });
});
