// Contract for the Weirdo Cream truck mount GLB.
//
// Two jobs. First the usual shipped-asset pins (bytes, hash, geometry budget,
// texture compression, clips, source fingerprint), so a silent re-export or a
// skipped compression step turns red. Second, and specific to this asset, THE
// OPEN-CAB CLEARANCES: the driver is a standing humanoid lifted onto the seat by
// MOUNT_VISUAL_SPECS, so the cab has to stay open around them. Those numbers are
// asserted against the model's own authored contract and against the visual spec
// that consumes it, because "the driver clips through the roof" is exactly the
// regression a byte pin would not catch.

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  TRUCK_CAB,
  TRUCK_CLIP_NAMES,
  TRUCK_MATERIAL_CONTRACT,
  TRUCK_NATIVE_BOUNDS,
  TRUCK_RIDER_SEAT,
  TRUCK_SOCKET_DEFINITIONS,
} from '../scripts/assets/weirdo_cream_truck/model.js';
import {
  TRUCK_SOURCE_FILES,
  truckSourceFingerprint,
} from '../scripts/assets/weirdo_cream_truck/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { VISUALS } from '../src/render/characters/manifest';
import { MOUNT_VISUAL_SPECS } from '../src/render/mount_visuals';

const REPO_ROOT = path.join(__dirname, '..');
const ASSET_REL = 'models/mounts/weirdo_cream_truck.glb';
const ASSET_PATH = path.join(REPO_ROOT, 'public', ASSET_REL);
const ASSET_BYTES = 1_115_100;
const ASSET_SHA256 = '35963ec665a09e832b95c773b41682d64a2d306c99b3242aa6888423e97d5836';
const SOURCE_FINGERPRINT = '211e6338fdc93a42e9f5a54ba77fc384a70a0652d969d6978028bae794cb9394';

/** The visible humanoid's height at scale 1, from the character manifest. A
 *  rider is lifted onto the seat in a standing pose, so this is how far above
 *  the seat the body actually reaches. */
const RIDER_HEIGHT = VISUALS.player_warrior.height;

async function readAsset() {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.read(ASSET_PATH);
}

describe('Weirdo Cream truck asset pipeline', () => {
  it('pins the deterministic source inventory', () => {
    expect(TRUCK_SOURCE_FILES).toEqual([
      'docs/design/weirdo-cream-truck/reference/luffy-face.jpg',
      'docs/design/weirdo-cream-truck/reference/reference-metadata.json',
      'scripts/assets/weirdo_cream_truck/model.js',
      'scripts/assets/weirdo_cream_truck/decal_atlas.mjs',
      'scripts/assets/weirdo_cream_truck/export_entry.js',
      'scripts/assets/weirdo_cream_truck/export_weirdo_cream_truck.mjs',
      'scripts/assets/weirdo_cream_truck/source_fingerprint.mjs',
      'scripts/assets/terrorspark_groundshaker/surface_shading.mjs',
      'scripts/assets/terrorspark_groundshaker/surface_maps.mjs',
      'scripts/assets/specs/weirdo_cream_truck.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ]);
  });

  it('ships the exact bytes the exporter produced', () => {
    const bytes = readFileSync(ASSET_PATH);
    expect(statSync(ASSET_PATH).size).toBe(ASSET_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(ASSET_SHA256);
  });

  it('carries a live source fingerprint', async () => {
    // Recomputed from the files on disk, so editing any input without
    // re-exporting fails here rather than shipping a stale model.
    expect(truckSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    const root = (await readAsset()).getRoot();
    const documentExtras = root.getExtras() as { sourceFingerprint?: string };
    const assetExtras = root.getAsset().extras as { sourceFingerprint?: string } | undefined;
    expect(documentExtras.sourceFingerprint).toBe(SOURCE_FINGERPRINT);
    expect(assetExtras?.sourceFingerprint).toBe(SOURCE_FINGERPRINT);
  });

  it('is registered in the media manifest and the character visuals', () => {
    expect(MEDIA_ASSETS[ASSET_REL]).toBeDefined();
    expect(VISUALS.mount_weirdo_cream_truck.url).toBe(ASSET_REL);
    expect(VISUALS.mount_weirdo_cream_truck.lazyPreload).toBe(true);
  });

  it('holds its geometry and material budget', async () => {
    const root = (await readAsset()).getRoot();
    let triangles = 0;
    let primitives = 0;
    for (const mesh of root.listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        primitives++;
        const position = primitive.getAttribute('POSITION');
        triangles += (primitive.getIndices()?.getCount() ?? position!.getCount()) / 3;
        // The baked macro shading is what gives the panels their cavity and
        // grime bands; without COLOR_0 the model renders flat.
        expect(primitive.getAttribute('COLOR_0')).not.toBeNull();
      }
    }
    expect(triangles).toBe(13_962);
    expect(primitives).toBe(18);
    expect(
      root
        .listMaterials()
        .map((m) => m.getName())
        .sort(),
    ).toEqual(TRUCK_MATERIAL_CONTRACT.map((m) => m.name).sort());
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listCameras()).toHaveLength(0);
  });

  it('keeps every texture KTX2, so it stays GPU-compressed in memory', async () => {
    const root = (await readAsset()).getRoot();
    const textures = root.listTextures();
    expect(textures).toHaveLength(7);
    for (const texture of textures) {
      expect(texture.getMimeType()).toBe('image/ktx2');
      expect(texture.getImage()?.byteLength ?? 0).toBeGreaterThan(0);
    }
    expect(
      root
        .listExtensionsUsed()
        .map((e) => e.extensionName)
        .sort(),
    ).toEqual([
      'EXT_meshopt_compression',
      'KHR_mesh_quantization',
      'KHR_texture_basisu',
      'KHR_texture_transform',
    ]);
  });

  it('ships the four locomotion clips, in order, each with live channels', async () => {
    const root = (await readAsset()).getRoot();
    const animations = root.listAnimations();
    expect(animations.map((a) => a.getName())).toEqual([...TRUCK_CLIP_NAMES]);
    for (const animation of animations) {
      expect(animation.listChannels().length).toBeGreaterThan(0);
    }
  });

  it('sits on the floor, centred on X and Z, at its declared native size', async () => {
    const document = await readAsset();
    const bounds = getBounds(document.getRoot().listScenes()[0]!);
    expect(Math.abs(bounds.min[1])).toBeLessThan(0.01);
    expect(Math.abs(bounds.min[0] + bounds.max[0])).toBeLessThan(0.01);
    expect(Math.abs(bounds.min[2] + bounds.max[2])).toBeLessThan(0.01);
    expect(bounds.max[1]).toBeCloseTo(TRUCK_NATIVE_BOUNDS.height, 1);
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(TRUCK_NATIVE_BOUNDS.width, 1);
    expect(bounds.max[2] - bounds.min[2]).toBeCloseTo(TRUCK_NATIVE_BOUNDS.depth, 1);
  });

  it('carries its three sockets as extras-bearing empties', async () => {
    const nodes = (await readAsset()).getRoot().listNodes();
    for (const definition of TRUCK_SOCKET_DEFINITIONS) {
      const node = nodes.find((candidate) => candidate.getName() === definition.nodeName);
      expect(node, definition.nodeName).toBeDefined();
      expect(node!.getMesh()).toBeNull();
      expect(node!.getExtras()?.purpose).toBe(definition.purpose);
    }
  });
});

describe('Weirdo Cream truck open-cab clearances', () => {
  it('renders at scale 1, so the seat is quoted in the model own yards', () => {
    // If the manifest height ever drifts from the model's own height the GLB is
    // rescaled, and every seat yard below silently means something else.
    expect(VISUALS.mount_weirdo_cream_truck.height).toBeCloseTo(TRUCK_NATIVE_BOUNDS.height, 2);
  });

  it('seats the driver where the model says the seat is', () => {
    const spec = MOUNT_VISUAL_SPECS.weirdo_cream_truck;
    expect(spec.visualKey).toBe('mount_weirdo_cream_truck');
    expect(spec.seat).toBeCloseTo(TRUCK_RIDER_SEAT.y, 3);
    expect(spec.seatFwd).toBeCloseTo(TRUCK_RIDER_SEAT.z, 3);
    // The seat is in the CAB, forward of centre. A negative or near-zero shift
    // would put the driver inside the freezer box.
    expect(spec.seatFwd).toBeGreaterThan(1);
  });

  it('leaves the driver body clear of the freezer box and the windscreen', () => {
    // Front-to-back: the cab has to be deeper than the body it holds, at both
    // ends, or the standing rider intersects the shell.
    expect(TRUCK_CAB.screenZ - TRUCK_CAB.riderZ).toBeGreaterThan(TRUCK_CAB.riderClearRadius);
    expect(TRUCK_CAB.riderZ - TRUCK_CAB.backZ).toBeGreaterThan(TRUCK_CAB.riderClearRadius);
    // Side to side: the door panels stand off the body, not against it.
    expect(TRUCK_CAB.innerHalfWidth).toBeGreaterThan(TRUCK_CAB.riderClearRadius);
  });

  it('has NO roof over the cab: the rider stands far above the shell', async () => {
    // This is the load-bearing one. The rider stands on the cab floor in a
    // normal standing pose, so their crown reaches seat + rider height, which is
    // well above the truck itself. Any roofed cab would have to intersect them,
    // which is why the cab is authored as an open tub.
    const spec = MOUNT_VISUAL_SPECS.weirdo_cream_truck;
    const crown = spec.seat + RIDER_HEIGHT;
    // The driver's head clears the tallest thing the CAB puts near them (the
    // windscreen header) by more than a yard. Deliberately not compared against
    // the model's overall height: that is the roof cone, which stands behind
    // the driver over the freezer box and is meant to tower over them.
    expect(crown).toBeGreaterThan(TRUCK_CAB.screenTopY + 1);
    // Everything the cab puts around the driver stops below their shoulders.
    const shoulder = spec.seat + RIDER_HEIGHT * 0.72;
    expect(TRUCK_CAB.doorTopY).toBeLessThan(shoulder);
    expect(TRUCK_CAB.screenTopY).toBeLessThan(shoulder);

    // And nothing is actually modelled above the cab within the rider's
    // footprint: sweep the shipped geometry for any vertex over the seat.
    const document = await readAsset();
    let ceiling = Number.NEGATIVE_INFINITY;
    for (const mesh of document.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        if (!position) continue;
        const vertex = [0, 0, 0];
        for (let index = 0; index < position.getCount(); index++) {
          position.getElement(index, vertex);
          const withinFootprint =
            Math.abs(vertex[0]) <= TRUCK_CAB.riderClearRadius &&
            Math.abs(vertex[2] - TRUCK_RIDER_SEAT.z) <= TRUCK_CAB.riderClearRadius;
          if (withinFootprint && vertex[1] > ceiling) ceiling = vertex[1];
        }
      }
    }
    // The tallest thing standing in the driver's own column is the windscreen
    // header, and it is below the shoulder line computed above.
    expect(ceiling).toBeLessThan(shoulder);
  });
});
