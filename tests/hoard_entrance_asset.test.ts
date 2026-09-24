import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { hoardEntranceSourceFingerprint } from '../scripts/assets/hoard_entrance/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

const ROOT = path.join(__dirname, '..');
const URL = 'models/props/hoard_entrance.glb';
const SHA = 'e780380f4a5cfbf1854383f98e379c97631fca965e801ca1b009ad2b30bc33d0';
const BYTES = 93520;
// Re-exported at the release/v0.44.0 merge into feature/buried-hoards: the
// release moved pnpm-lock.yaml (a fingerprinted build input), so the GLB was
// rebuilt with export_hoard_entrance.mjs; only the embedded source
// fingerprint moved (same geometry, same byte length).
const FINGERPRINT = '4aa0a90b94cea121f4277153ad7ee5facbde5d8f0aa34d30c7846d1ec61aabd7';

describe('Buried Hoard entrance shipping asset', () => {
  it('pins exact bytes, live authoring fingerprint and manifest version', async () => {
    const bytes = readFileSync(path.join(ROOT, 'public', URL));
    expect(bytes.length).toBe(BYTES);
    expect(bytes.length).toBeLessThanOrEqual(96 * 1024);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(SHA);
    expect(hoardEntranceSourceFingerprint(ROOT)).toBe(FINGERPRINT);
    expect(MEDIA_ASSETS[URL]).toBe(`/media/models/props/hoard_entrance.${SHA.slice(0, 12)}.glb`);
    const spec = JSON.parse(
      readFileSync(path.join(ROOT, 'scripts/assets/specs/hoard_entrance.json'), 'utf8'),
    );
    expect(spec.items).toEqual([
      {
        src: 'tmp/asset_src/hoard_entrance/hoard_entrance-final.glb',
        out: URL,
        type: 'static',
        keepExtras: true,
      },
    ]);
    await MeshoptDecoder.ready;
    const document = await new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
      .readBinary(bytes);
    const root = document.getRoot();
    expect(root.getExtras().sourceFingerprint).toBe(FINGERPRINT);
    expect((root.getAsset().extras as { sourceFingerprint?: string })?.sourceFingerprint).toBe(
      FINGERPRINT,
    );
    expect(root.listTextures()).toHaveLength(0);
    expect(root.listAnimations()).toHaveLength(0);
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listCameras()).toHaveLength(0);
    expect(
      root
        .listExtensionsRequired()
        .map((extension) => extension.extensionName)
        .sort(),
    ).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
    expect(root.listMeshes()).toHaveLength(5);
    expect(
      root
        .listMaterials()
        .map((material) => material.getName())
        .sort(),
    ).toEqual(['HoardEarthStone', 'HoardIron', 'HoardRarityMetalwork', 'HoardWood']);
    let triangles = 0;
    for (const mesh of root.listMeshes()) {
      expect(mesh.listPrimitives()).toHaveLength(1);
      const primitive = mesh.listPrimitives()[0];
      expect(primitive.getMode()).toBe(4);
      expect(primitive.listSemantics().sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION']);
      triangles +=
        (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')!.getCount()) / 3;
    }
    expect(triangles).toBe(4496);
    expect(triangles).toBeLessThanOrEqual(4500);
    const scene = root.listScenes()[0];
    expect(scene.listChildren().map((node) => node.getName())).toEqual(['HoardEntrance']);
    const bounds = getBounds(scene);
    expect(bounds.min[1]).toBeCloseTo(0, 3);
    expect(bounds.min[0]).toBeCloseTo(-bounds.max[0], 3);
    expect(bounds.min[2]).toBeCloseTo(-bounds.max[2], 3);
    expect(bounds.max[1]).toBeLessThan(3.3);
    const nodes = root.listNodes();
    expect(nodes).toHaveLength(11);
    const hatch = nodes.find((node) => node.getName() === 'HatchAssembly')!;
    expect(hatch.getExtras().hoardHatchPivot).toEqual({ closedRotationX: 0, openRotationX: -1.42 });
    expect(hatch.listChildren().map((node) => node.getName())).toEqual([
      'HoardHatchWood',
      'HoardHatchRarityMetalwork',
    ]);
    expect(hatch.getRotation()[0]).toBeCloseTo(Math.sin(-1.42 / 2), 6);
    for (const name of ['Interaction', 'Opening', 'Light', 'Motes']) {
      const socket = nodes.find((node) => node.getName() === `Socket_${name}`)!;
      expect(socket).toBeDefined();
      expect(socket.getMesh()).toBeNull();
      expect(socket.listChildren()).toHaveLength(0);
    }
  });
});
