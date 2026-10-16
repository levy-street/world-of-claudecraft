import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSET_CATALOG } from '../src/editor/asset_catalog.generated';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

const publicDir = path.join(__dirname, '..', 'public');
const assets = ASSET_CATALOG.filter((asset) => asset.category === 'medieval_village_v2');

describe('Medieval Village Vol. 2 editor library', () => {
  it('exposes the complete pack in its own editor category', () => {
    expect(assets).toHaveLength(349);
    expect(new Set(assets.map((asset) => asset.id)).size).toBe(349);

    const subcategoryCounts = new Map<string, number>();
    for (const asset of assets) {
      const subcategory = asset.id.split('/')[1];
      subcategoryCounts.set(subcategory, (subcategoryCounts.get(subcategory) ?? 0) + 1);
    }
    expect(Object.fromEntries(subcategoryCounts)).toEqual({
      buildings: 98,
      environment: 19,
      nature: 33,
      props: 199,
    });
  });

  it('contains valid GLB headers and media-manifest entries for every asset', () => {
    for (const asset of assets) {
      const relativePath = asset.path.replace(/^\//, '');
      const bytes = readFileSync(path.join(publicDir, relativePath));
      expect(bytes.toString('ascii', 0, 4), `${asset.path} should be a GLB`).toBe('glTF');
      expect(bytes.readUInt32LE(4), `${asset.path} should use GLB version 2`).toBe(2);
      expect(bytes.readUInt32LE(8), `${asset.path} should have a complete payload`).toBe(
        bytes.length,
      );
      expect(
        MEDIA_ASSETS[relativePath],
        `${asset.path} should be in the media manifest`,
      ).toBeDefined();
    }
  });
});
