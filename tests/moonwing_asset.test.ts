import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { characterPreloadUrls, VISUALS } from '../src/render/characters/manifest';

const file = new URL('../public/models/chars/forms/moonwing.glb', import.meta.url);

describe('Moonwing native Druid body', () => {
  it('preloads a dedicated opaque creature with the native casting donors at every tier', () => {
    const def = VISUALS.form_moonkin;
    expect(def.url).toBe('models/chars/forms/moonwing.glb');
    expect(characterPreloadUrls(false)).toContain(def.url);
    expect(characterPreloadUrls(true)).toContain(def.url);
    expect(def.animUrls).toContain(VISUALS.player_druid.url);
    expect(def.clips.idle).toEqual(VISUALS.player_druid.clips.idle);
    expect(def.clips.attackByAbility).toMatchObject({
      moonseed: 'Cast_Starfall',
      moonlash: 'Cast_Starfall',
      sunlance: 'Cast_Nature',
    });
    expect(def.attach).toBeUndefined();
    expect(def.weaponSlots).toBeUndefined();
    expect(readFileSync(file).length).toBeLessThan(1.8 * 1024 * 1024);
  });

  it('retains the actual Druid joint transforms, finite normalized weights and detailed vertex plumage', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const [owl, druid] = await Promise.all([
      io.read(fileURLToPath(file)),
      io.read(fileURLToPath(new URL('../public/models/chars/players/druid.glb', import.meta.url))),
    ]);
    const root = owl.getRoot();
    expect(root.listSkins()).toHaveLength(1);
    expect(root.listMeshes()).toHaveLength(1);
    expect(root.listTextures()).toHaveLength(0);
    const native = new Map(
      druid
        .getRoot()
        .listNodes()
        .map((n) => [n.getName(), n]),
    );
    const joints = root.listSkins()[0].listJoints();
    expect(joints).toHaveLength(23);
    for (const joint of joints) {
      const source = native.get(joint.getName());
      expect(source, joint.getName()).toBeDefined();
      if (!source) throw new Error(`Missing native joint ${joint.getName()}`);
      for (const [i, value] of joint.getMatrix().entries())
        expect(value, joint.getName()).toBeCloseTo(source.getMatrix()[i], 5);
    }
    const primitives = root.listMeshes()[0].listPrimitives();
    expect(primitives).toHaveLength(3);
    expect(
      primitives.reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0),
    ).toBeGreaterThan(40_000);
    for (const primitive of primitives) {
      expect(primitive.getMaterial()?.getAlphaMode()).toBe('OPAQUE');
      expect(primitive.getAttribute('COLOR_0')).not.toBeNull();
      const weights = primitive.getAttribute('WEIGHTS_0');
      expect(weights).not.toBeNull();
      if (!weights) throw new Error('Missing skin weights');
      const values: number[] = [];
      for (let i = 0; i < weights.getCount(); i++) {
        weights.getElement(i, values);
        expect(values.every(Number.isFinite)).toBe(true);
        expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
      }
    }
  });
});
