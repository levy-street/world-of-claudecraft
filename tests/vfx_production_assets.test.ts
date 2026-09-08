import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { productionPreloadInternalsForTest } from '../src/render/ability_vfx/production_assets';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

describe('production VFX asset contract', () => {
  it('ships every declared preload URL with its content hash in the generated media catalogue', () => {
    for (const url of productionPreloadInternalsForTest.urls) {
      const bytes = readFileSync(new URL(`../public${url}`, import.meta.url));
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
      expect(MEDIA_ASSETS[url.slice(1)]).toContain(`.${hash}.`);
    }
  });

  it('contains the three centered, normalized, faceted solid meshes with embedded resources', async () => {
    const file = new URL('../public/models/vfx/production_fragments.glb', import.meta.url);
    const document = await new NodeIO().readBinary(readFileSync(file));
    const root = document.getRoot();
    expect(root.listTextures()).toHaveLength(0);
    expect(root.listMeshes()).toHaveLength(3);
    for (const name of ['ice_shard', 'stone_chip', 'metal_splinter']) {
      const node = root.listNodes().find((n) => n.getName() === name);
      expect(node).toBeDefined();
      if (!node) throw new Error(`Missing ${name}`);
      expect(node.getTranslation()).toEqual([0, 0, 0]);
      expect(node.getScale()).toEqual([1, 1, 1]);
      const primitive = node.getMesh()?.listPrimitives()[0];
      const position = primitive?.getAttribute('POSITION');
      const normal = primitive?.getAttribute('NORMAL');
      if (!position || !normal) throw new Error(`Missing surface data for ${name}`);
      expect(normal.getCount()).toBe(position.getCount());
      const triangles = (primitive?.getIndices()?.getCount() ?? position.getCount()) / 3;
      expect(triangles).toBeGreaterThan(8);
      expect(triangles).toBeLessThanOrEqual(300);
      const point = [0, 0, 0];
      let radius = 0;
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, point);
        expect(point.every(Number.isFinite)).toBe(true);
        radius = Math.max(radius, Math.hypot(...point));
      }
      expect(radius).toBeCloseTo(1, 4);
    }
  });
});
