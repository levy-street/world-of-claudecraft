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
const source = 'scripts/assets/courier_donkey/source/winged_mail_donkey.glb';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('shipping supplied courier donkey GLB', () => {
  it('retains the donor rig, clips and texture resolution through meshopt and KTX2', async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
    });
    const donor = (await io.read(path.join(root, source))).getRoot();
    const shipping = (await io.read(path.join(root, asset))).getRoot();
    expect(shipping.listMeshes()).toHaveLength(1);
    expect(shipping.listSkins()).toHaveLength(1);
    expect(shipping.listSkins()[0].listJoints()).toHaveLength(47);
    expect(
      shipping
        .listSkins()[0]
        .listJoints()
        .map((joint) => joint.getName()),
    ).toEqual(
      donor
        .listSkins()[0]
        .listJoints()
        .map((joint) => joint.getName()),
    );
    expect(shipping.listMaterials()).toHaveLength(1);
    expect(shipping.listTextures()).toHaveLength(1);
    expect(shipping.listTextures()[0].getMimeType()).toBe('image/ktx2');
    expect(shipping.listTextures()[0].getSize()).toEqual([1024, 1024]);
    const primitive = shipping.listMeshes()[0].listPrimitives()[0];
    expect(primitive.getAttribute('JOINTS_0')).not.toBeNull();
    expect(primitive.getAttribute('WEIGHTS_0')).not.toBeNull();
    expect(primitive.getIndices()!.getCount() / 3).toBe(1844);
    expect(shipping.listAnimations().map((clip) => clip.getName())).toEqual(['Idle', 'Run', 'Fly']);
    for (const [index, duration] of [5, 0.533333333, 0.933333333].entries()) {
      const clip = shipping.listAnimations()[index];
      const max = Math.max(
        ...clip.listSamplers().flatMap((sampler) => Array.from(sampler.getInput()!.getArray()!)),
      );
      expect(max).toBeCloseTo(duration, 6);
    }
    const bytes = readFileSync(path.join(root, asset));
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    expect(json.extensionsRequired).toEqual(
      expect.arrayContaining(['KHR_texture_basisu', 'EXT_meshopt_compression']),
    );
    expect(bytes.length).toBe(290048);
    expect(sha(bytes)).toBe('22c864256f304a963e53b522e0387b34bbb61e7debefcaf0a87f790a32c998df');
    expect(MEDIA_ASSETS['models/creatures/courier_donkey.glb']).toBeDefined();
    const original = readFileSync(path.join(root, source));
    expect(original.length).toBe(2135232);
    expect(sha(original)).toBe('28d31e0a4567a7719ef4eccc02175488c90263e177d75364ea4325d2da04e781');
  });
});
