import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

const root = path.join(__dirname, '..');
const asset = 'public/models/creatures/courier_donkey.glb';

describe('shipping courier donkey GLB', () => {
  it('retains articulated wings, bounded geometry and texture-free vertex colour', async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
    });
    const document = await io.read(path.join(root, asset));
    const scene = document.getRoot();
    const nodes = scene.listNodes();
    expect(nodes.map((node) => node.getName())).toEqual(
      expect.arrayContaining([
        'CourierDonkey',
        'DonkeyBody',
        'WingLeft',
        'WingRight',
        'WingLeftFeathers',
        'WingRightFeathers',
      ]),
    );
    expect(scene.listMeshes()).toHaveLength(3);
    expect(scene.listMaterials()).toHaveLength(1);
    expect(scene.listTextures()).toHaveLength(0);
    let triangles = 0;
    for (const mesh of scene.listMeshes()) {
      expect(mesh.listPrimitives()).toHaveLength(1);
      for (const primitive of mesh.listPrimitives()) {
        expect(primitive.getAttribute('COLOR_0')).not.toBeNull();
        triangles +=
          (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')!.getCount()) /
          3;
      }
    }
    expect(triangles).toBe(10092);
    const left = nodes.find((node) => node.getName() === 'WingLeft')!;
    const right = nodes.find((node) => node.getName() === 'WingRight')!;
    expect(left.getTranslation()[0]).toBeLessThan(0);
    expect(right.getTranslation()[0]).toBeGreaterThan(0);
    expect(left.listChildren()).toHaveLength(1);
    expect(right.listChildren()).toHaveLength(1);
    const hash = createHash('sha256');
    for (const file of [
      'scripts/assets/courier_donkey/model.js',
      'scripts/assets/courier_donkey/export_entry.js',
      'scripts/assets/courier_donkey/export_courier_donkey.mjs',
      'scripts/assets/specs/courier_donkey.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ])
      hash.update(readFileSync(path.join(root, file)));
    const sourceFingerprint = hash.digest('hex');
    expect(sourceFingerprint).toBe(
      '0bfe2ec0b845b64238cd56e497c0229b91c2360008084a4cbb2a62a6c8c08917',
    );
    expect(
      nodes.find((node) => node.getName() === 'CourierDonkey')?.getExtras().sourceFingerprint,
    ).toBe(sourceFingerprint);
    expect(MEDIA_ASSETS['models/creatures/courier_donkey.glb']).toBeDefined();
    const bytes = readFileSync(path.join(root, asset));
    expect(bytes.byteLength).toBeLessThan(250_000);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'ff62f1bc92a8d715dd0ea1031b53039d66c5487f93c68c69317f6183ebbfd52a',
    );
  });
});
