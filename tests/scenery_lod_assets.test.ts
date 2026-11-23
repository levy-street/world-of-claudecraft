import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addSceneryLod,
  isSceneryLodCopyCatalogId,
  SCENERY_LOD_ASSETS,
} from '../scripts/assets/scenery_lod_build.mjs';
import { verifyLodIndices } from '../scripts/assets/woc_character/lod_indices.mjs';
import { WocLodExtension } from '../scripts/assets/woc_character/woc_lod_extension.mjs';
import { assetById } from '../src/editor/asset_catalog.generated';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { gfxInternalsForTest } from '../src/render/gfx';
import { ASSET_COLLISION } from '../src/sim/asset_collision.generated';

const io = new NodeIO()
  .registerExtensions([...ALL_EXTENSIONS, WocLodExtension])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
beforeAll(async () => {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
});

describe('scenery LOD assets', () => {
  it('keeps landmark consumers and prewarm on one parsed source asset', () => {
    for (const file of [
      'garden_features',
      'jungle_features',
      'haunt_features',
      'realm_flora',
      'great_tree_prewarm',
    ]) {
      const text = readFileSync(`src/render/${file}.ts`, 'utf8');
      expect(text.match(/const GREAT_TREE_URL = '([^']+)';/)?.[1]).toBe(
        '/models/foliage/twisted_1_lod.glb',
      );
    }
  });

  for (const asset of SCENERY_LOD_ASSETS) {
    it(`${asset.output} preserves the near mesh and textures and rebuilds deterministically`, async () => {
      const original = readFileSync(`public/${asset.source}`);
      const output = readFileSync(`public/${asset.output}`);
      const sourceJson = JSON.parse(
        original.subarray(20, 20 + original.readUInt32LE(12)).toString(),
      );
      const outputJson = JSON.parse(output.subarray(20, 20 + output.readUInt32LE(12)).toString());
      // Every preset loads the derived asset. Preserve the complete appearance
      // and scene placement, including texture bindings and sampler settings.
      for (const key of ['materials', 'nodes', 'scenes', 'scene', 'textures', 'samplers']) {
        expect(outputJson[key], key).toEqual(sourceJson[key]);
      }
      expect(createHash('sha256').update(original).digest('hex')).toBe(asset.sha256);
      const source = await io.readBinary(original);
      const built = await io.readBinary(output);
      const sourceMeshes = source.getRoot().listMeshes();
      const builtMeshes = built.getRoot().listMeshes();
      expect(builtMeshes.length).toBe(sourceMeshes.length);
      for (const [meshIndex, mesh] of sourceMeshes.entries()) {
        const primitives = mesh.listPrimitives();
        const derived = builtMeshes[meshIndex].listPrimitives();
        expect(derived.length).toBe(primitives.length);
        for (const [index, full] of primitives.entries()) {
          const near = derived[index];
          expect(outputJson.meshes[meshIndex].primitives[index].material).toBe(
            sourceJson.meshes[meshIndex].primitives[index].material,
          );
          expect(near.getIndices()?.getArray()).toEqual(full.getIndices()?.getArray());
          expect(near.listSemantics()).toEqual(full.listSemantics());
          for (const semantic of full.listSemantics()) {
            expect(near.getAttribute(semantic)?.getArray()).toEqual(
              full.getAttribute(semantic)?.getArray(),
            );
          }
          if (asset.materials && !asset.materials.includes(full.getMaterial()?.getName() ?? '')) {
            expect(near.getExtension('WOC_lod')).toBeNull();
          }
        }
      }
      expect(
        built
          .getRoot()
          .listTextures()
          .map((texture) => texture.getImage()),
      ).toEqual(
        source
          .getRoot()
          .listTextures()
          .map((texture) => texture.getImage()),
      );
      const verification = verifyLodIndices(built, { tolerance: 0.0002 });
      expect(verification.failures).toEqual([]);
      const report = await addSceneryLod(source, asset);
      expect(report[0].levels[1].triangles).toBeLessThan(report[0].triangles * 0.4);
      expect(Buffer.from(await io.writeBinary(source))).toEqual(output);
      const hash = createHash('sha256').update(output).digest('hex').slice(0, 12);
      expect(MEDIA_ASSETS[asset.output as keyof typeof MEDIA_ASSETS]).toContain(`.${hash}.glb`);
    });
  }

  it('keeps the derived copies out of the editor catalog and the collision bake', () => {
    const catalogId = (path: string) => path.replace(/^models\//, '').replace(/\.glb$/, '');
    for (const { source, output } of SCENERY_LOD_ASSETS) {
      const copy = catalogId(output);
      const original = catalogId(source);
      expect(isSceneryLodCopyCatalogId(copy), copy).toBe(true);
      expect(assetById(copy), copy).toBeUndefined();
      expect(ASSET_COLLISION[copy], copy).toBeUndefined();
      // An authored map places the source, which stays placeable and baked.
      expect(isSceneryLodCopyCatalogId(original), original).toBe(false);
      expect(assetById(original)?.path, original).toBe(`/${source}`);
      expect(ASSET_COLLISION[original], original).toBeDefined();
    }
    // Exact outputs only, never a suffix rule.
    expect(isSceneryLodCopyCatalogId('props/fenbridge_scout_lodge')).toBe(false);
    expect(isSceneryLodCopyCatalogId('foliage/twisted_2_lod')).toBe(false);
    // The generators apply the rule (a catalog regen is not a gate step).
    expect(readFileSync('scripts/gen_asset_catalog.mjs', 'utf8')).toContain(
      '.filter((e) => !isSceneryLodCopyCatalogId(e.id))',
    );
    expect(readFileSync('scripts/assets/bake_collision.mjs', 'utf8')).toContain(
      '|| isSceneryLodCopyCatalogId(id)) continue;',
    );
  });

  it('enables the same distance policy for desktop and Android Low only', () => {
    for (const platform of ['other', 'android'] as const) {
      expect(gfxInternalsForTest.settingsFor('low', { platform }).sceneryGeometryLodDistance).toBe(
        180,
      );
      expect(gfxInternalsForTest.settingsFor('low', { platform }).lowReadabilityLighting).toBe(
        true,
      );
      for (const tier of ['medium', 'high', 'ultra', 'insane'] as const) {
        expect(gfxInternalsForTest.settingsFor(tier, { platform }).sceneryGeometryLodDistance).toBe(
          0,
        );
        expect(gfxInternalsForTest.settingsFor(tier, { platform }).lowReadabilityLighting).toBe(
          false,
        );
      }
    }
  });
});
