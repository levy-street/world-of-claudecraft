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
// Re-minted during PR cleanup after moving non-shipping preview output from a
// retired screenshot directory into ignored tmp/. Geometry and byte counts did
// not change; only the two source-fingerprint stamps and resulting hashes did.
// Re-minted 2026-09-08 via scripts/assets/remint_lockfile_fingerprints.mjs after
// the release/v0.42.0 merge moved pnpm-lock.yaml (a fingerprint input, leaf-only
// hash change) for this seventeen-asset farm family: both extras stamps on
// every GLB were restamped in place with byte counts, triangles, and bounds
// held exactly. No source file changed.
const SOURCE_FINGERPRINT = 'ec04ba6430edf5e383086fafdd47e7bc77eb935ac9403181dbfaa3974fcb586f';
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
    sha256: 'efc9e00fe043beb8281bf7056d3fc565832d9043761349579ccc41b2fa5e91e4',
    triangles: 228,
    footprintYd: [3, 2],
    heightYd: 0.34,
  },
  farm_sprout: {
    bytes: 5_168,
    sha256: '6f59e784b59511229db51e8d7ef4681a41cefa1917505e3ca71d413023e422ab',
    triangles: 108,
    footprintYd: [1.67, 0.97],
    heightYd: 0.25,
  },
  farm_grain_stage2: {
    bytes: 5_248,
    sha256: '041884d21ff45d51231e892497df6341ee1de10913c952456273a603f8db76cd',
    triangles: 108,
    footprintYd: [1.81, 1.04],
    heightYd: 0.42,
  },
  farm_rootleaf_stage2: {
    bytes: 8_792,
    sha256: '18c277c1b2a1e213de08766c0b72660f170b44a70075143434d47c7dae294bd9',
    triangles: 240,
    footprintYd: [1.61, 1.31],
    heightYd: 0.22,
  },
  farm_gourd_stage2: {
    bytes: 9_580,
    sha256: '2d9b19b766ffe5d993cd33cea31316496a2c2e0fe0da43e5e2c1d931c3cc04e5',
    triangles: 360,
    footprintYd: [1.8, 1.16],
    heightYd: 0.09,
  },
  farm_grain_stage3: {
    bytes: 10_988,
    sha256: 'f206554f00fadf41d1c2188274db1f08e304c197b32ee28d80c7939df451400a',
    triangles: 288,
    footprintYd: [1.91, 1.31],
    heightYd: 0.82,
  },
  farm_rootleaf_stage3: {
    bytes: 17_776,
    sha256: 'dd4d1eadc53114b3bb0e149f1b3734a303cd50cb154fb2e16735bebc34e6d49d',
    triangles: 540,
    footprintYd: [2.16, 1.49],
    heightYd: 0.37,
  },
  farm_gourd_stage3: {
    bytes: 16_460,
    sha256: 'e550d9afb57d35c978af2618e24411a484e04aa56507d745a6e96bb65af1faef',
    triangles: 612,
    footprintYd: [2.46, 1.5],
    heightYd: 0.18,
  },
  farm_grain_stage4: {
    bytes: 12_212,
    sha256: '10adb87f3329714b9c9e161c02a12c43e7024949014aaaa62fcb017fbb7aa6bf',
    triangles: 336,
    footprintYd: [2.54, 1.38],
    heightYd: 1.07,
  },
  farm_rootleaf_stage4: {
    bytes: 22_308,
    sha256: '9b198f7c05a32a9758d08bf175af9f518467ea394f8e4e67da83673c7d8e284c',
    triangles: 720,
    footprintYd: [2.72, 1.71],
    heightYd: 0.58,
  },
  farm_gourd_stage4: {
    bytes: 16_740,
    sha256: '1cc61b3ab7623e39421bb02a01e09fd4a07bce302bb5db3b72062d19c8a66fb2',
    triangles: 620,
    footprintYd: [2.63, 1.61],
    heightYd: 0.4,
  },
  farm_grain_withered: {
    bytes: 9_656,
    sha256: '6f4b396573ccbdb17360f9d7d7c101623ec0887785ac447fa7542aec6adcca2f',
    triangles: 288,
    footprintYd: [2.17, 1.36],
    heightYd: 0.66,
  },
  farm_rootleaf_withered: {
    bytes: 11_724,
    sha256: 'a493ce98af28c23ebb56c38bf563f751dd583155d26a78829127c51d304aeed6',
    triangles: 360,
    footprintYd: [2.12, 1.47],
    heightYd: 0.24,
  },
  farm_gourd_withered: {
    bytes: 13_872,
    sha256: '1b69a81be21acd9a63abc135cc1c58958facab0d2f0b6f181d50830a02527ffa',
    triangles: 576,
    footprintYd: [2.43, 1.42],
    heightYd: 0.14,
  },
  farm_compost_bin: {
    bytes: 7_440,
    sha256: '405e657e92ff8134eb47ee3a6d35a0c2c3090db453ba4af970cdae0fc631ebfa',
    triangles: 264,
    footprintYd: [1, 1],
    heightYd: 0.8,
  },
  farm_feast: {
    bytes: 15_644,
    sha256: '57da1f7abb443a01705b71258323b7437e25c296d6da675b7b51d25baf2efdec',
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
    sha256: '7bb0dc9c6a815d07e8e0080e6bd7a72d7cbbe5e07b466e10c1e531fae8001fca',
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
    const exporter = readFileSync(
      path.join(REPO_ROOT, 'scripts/assets/farm_props/export_farm_props.mjs'),
      'utf8',
    );
    expect(exporter).toContain("path.join(ROOT, 'tmp/farm_props_preview')");
    expect(exporter).not.toContain('docs/screenshots/');

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
