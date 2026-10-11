import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { mobVisualKey, VISUALS } from '../src/render/characters/manifest';

const file = 'public/models/buddies/sapling.glb';

describe('Sapling buddy asset', () => {
  it('uses its own authored atlas and run clip through the normal buddy visual', () => {
    expect(mobVisualKey('buddy_sapling')).toBe('buddy_sapling');
    expect(VISUALS.buddy_sapling).toMatchObject({
      url: 'models/buddies/sapling.glb',
      height: 0.75,
      authoredAtlas: true,
      tint: 'cosmetic',
      clips: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: [], death: 'Idle' },
    });
  });

  it('ships the rig, compressed textures and seamless distinct waddle cycles', async () => {
    const bytes = readFileSync(file);
    const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    expect(json.extensionsRequired).toContain('EXT_meshopt_compression');
    expect(json.extensionsRequired).toContain('KHR_texture_basisu');
    expect(
      json.images.every((image: { mimeType: string }) => image.mimeType === 'image/ktx2'),
    ).toBe(true);

    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
    });
    const doc = await io.read(file);
    const root = doc.getRoot();
    expect(root.listSkins()).toHaveLength(1);
    expect(root.listSkins()[0].listJoints()).toHaveLength(41);
    expect(root.listTextures()).toHaveLength(3);
    expect(root.listMaterials()[0].getBaseColorTexture()).not.toBeNull();
    expect(
      root
        .listAnimations()
        .map((clip) => clip.getName())
        .sort(),
    ).toEqual(['Idle', 'Run', 'Walk']);
    expect(root.listTextures().every((texture) => texture.getSize()?.every((n) => n <= 512))).toBe(
      true,
    );
    const triangles = root
      .listMeshes()
      .flatMap((mesh) => mesh.listPrimitives())
      .reduce((sum, primitive) => sum + primitive.getIndices()!.getCount() / 3, 0);
    expect(triangles).toBe(3020);
    const run = root.listAnimations().find((clip) => clip.getName() === 'Run')!;
    expect(
      run.listChannels().some((channel) => channel.getTargetNode()?.getName() === 'Root'),
    ).toBe(true);
    expect(
      run.listChannels().some((channel) => channel.getTargetNode()?.getName() === 'L_Thigh'),
    ).toBe(true);
    expect(
      run.listChannels().some((channel) => channel.getTargetNode()?.getName() === 'R_Thigh'),
    ).toBe(true);
    for (const clip of root.listAnimations()) {
      for (const sampler of clip.listSamplers()) {
        const output = sampler.getOutput()!;
        const first = output.getElement(0, []);
        const last = output.getElement(output.getCount() - 1, []);
        first.forEach((value, i) => {
          expect(last[i], `${clip.getName()} loop seam`).toBeCloseTo(value, 5);
        });
      }
    }
    expect(run.listSamplers()[0].getInput()!.getMax([])[0]).toBeCloseTo(1.04, 3);
    const walk = root.listAnimations().find((clip) => clip.getName() === 'Walk')!;
    expect(walk.listSamplers()[0].getInput()!.getMax([])[0]).toBeCloseTo(1.65, 3);
    for (const [bone, minimumTurn] of [
      ['Root', 0.08],
      ['L_Thigh', 0.3],
      ['R_Thigh', 0.3],
    ] as const) {
      const channel = run
        .listChannels()
        .find(
          (candidate) =>
            candidate.getTargetNode()?.getName() === bone &&
            candidate.getTargetPath() === 'rotation',
        );
      const output = channel!.getSampler()!.getOutput()!;
      const first = output.getElement(0, []);
      let largestTurn = 0;
      for (let index = 1; index < output.getCount(); index++) {
        const value = output.getElement(index, []);
        const dot = Math.min(
          1,
          Math.abs(first.reduce((sum, component, i) => sum + component * value[i], 0)),
        );
        largestTurn = Math.max(largestTurn, 2 * Math.acos(dot));
      }
      expect(largestTurn, `${bone} must move, not hold a static pose`).toBeGreaterThan(minimumTurn);
    }
  });
});
