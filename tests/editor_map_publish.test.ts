// Publish-to-repo pure core: slugs, module/registry emit (byte-stable), and
// the vendored catalogue collision that pins a published map's shapes.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  emitPublishedMapModule,
  emitPublishedMapRegistry,
  mapPublishSlug,
  PUBLISH_MODULE_HEADER,
  publishedMapPaths,
  vendorPublishedAssetCollision,
} from '../src/editor/map_publish_core';
import type { WorldContent } from '../src/sim/types';

describe('mapPublishSlug', () => {
  it('slugifies display names deterministically', () => {
    expect(mapPublishSlug('Goldcrest Harbor')).toBe('goldcrest_harbor');
    expect(mapPublishSlug('  Épée!! Test  ')).toBe('epee_test');
    expect(mapPublishSlug('')).toBe('untitled_map');
    expect(mapPublishSlug('___')).toBe('untitled_map');
  });

  it('keeps slugs repo-safe', () => {
    const slug = mapPublishSlug('../../etc/passwd');
    expect(slug).toMatch(/^[a-z0-9][a-z0-9_]*$/);
  });
});

describe('emitPublishedMapModule', () => {
  const world = { zones: [], camps: {}, npcs: {} };
  const json = JSON.stringify(world);

  it('is byte-stable and carries the metadata', () => {
    const a = emitPublishedMapModule('my_map', 'My "Map"', 4242, json);
    const b = emitPublishedMapModule('my_map', 'My "Map"', 4242, json);
    expect(a).toBe(b);
    expect(a.startsWith(PUBLISH_MODULE_HEADER)).toBe(true);
    expect(a).toContain('export const MAP_SLUG = "my_map";');
    expect(a).toContain('export const MAP_SEED = 4242;');
    expect(a).toContain('export function loadPublishedMap()');
  });

  it('embeds the world JSON so it parses back identically', () => {
    const src = emitPublishedMapModule('m', 'M', 1, json);
    const m = /const __map_json = (".*");/.exec(src);
    expect(m).not.toBeNull();
    expect(JSON.parse(JSON.parse(m![1]) as string)).toEqual(world);
  });
});

describe('emitPublishedMapRegistry', () => {
  it('matches the committed empty registry byte-for-byte', () => {
    const committed = readFileSync(
      path.resolve(__dirname, '../src/sim/maps/index.generated.ts'),
      'utf8',
    );
    // Only enforced while no maps are published; once one lands, the vite
    // endpoint owns the file and this pins the emitters agree at zero.
    if (!committed.includes('load: async')) {
      expect(emitPublishedMapRegistry([])).toBe(committed);
    }
  });

  it('sorts entries by slug and emits dynamic imports', () => {
    const src = emitPublishedMapRegistry([
      { slug: 'zeta', name: 'Z', seed: 2 },
      { slug: 'alpha', name: 'A', seed: 1 },
    ]);
    expect(src.indexOf('"alpha"')).toBeLessThan(src.indexOf('"zeta"'));
    expect(src).toContain("await import('./alpha.generated')");
  });
});

describe('publishedMapPaths', () => {
  it('lands in the two publish directories', () => {
    expect(publishedMapPaths('m')).toEqual({
      mapJson: 'data/maps/m.map.json',
      module: 'src/sim/maps/m.generated.ts',
      registry: 'src/sim/maps/index.generated.ts',
    });
  });
});

describe('vendorPublishedAssetCollision', () => {
  const placement = (p: string) =>
    ({ path: p, x: 0, z: 0, rotY: 0, scale: 1 }) as NonNullable<WorldContent['placements']>[number];
  const world = (placements: string[], assetCollision?: WorldContent['assetCollision']) =>
    ({
      zones: [],
      camps: {},
      npcs: {},
      groundObjects: [],
      roads: [],
      props: {},
      playerStart: { x: 0, z: 0 },
      placements: placements.map(placement),
      assetCollision,
    }) as unknown as WorldContent;

  it('pins the catalogue bake for every placed path', () => {
    const p = '/models/medieval_village_v2/props/Barrel_01.glb';
    const out = vendorPublishedAssetCollision(world([p]));
    expect(out.assetCollision?.[p]).toBeDefined();
    expect(out.assetCollision?.[p]?.length).toBeGreaterThan(0);
  });

  it('never overwrites an existing (imported-model) entry', () => {
    const p = '/models/medieval_village_v2/props/Barrel_01.glb';
    const mine = [{ x: 0, y: 0, z: 0, hx: 9, hy: 9, hz: 9 }];
    const out = vendorPublishedAssetCollision(
      world([p], { [p]: mine } as WorldContent['assetCollision']),
    );
    expect(out.assetCollision?.[p]).toEqual(mine);
  });

  it('leaves unbaked paths alone', () => {
    const out = vendorPublishedAssetCollision(world(['/models/foliage/bush.glb']));
    expect(out.assetCollision?.['/models/foliage/bush.glb']).toBeUndefined();
  });
});
