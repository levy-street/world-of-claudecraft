import { describe, expect, it } from 'vitest';
import { newCustomMap, toMapDoc } from '../src/editor/custom_map';
import { sanitizeMapDoc, serializeMapDoc } from '../src/sim/map_doc';

// toMapDoc bridges CustomMap's readonly-content editor view to the mutable
// MapDoc shape the shared sim sanitizer/serializer (and the server) expect.
// It is a pure type-level bridge with no runtime transformation, so the
// contract to pin is: same object identity in and out, and the shared
// serializer/sanitizer round-trip the document exactly as before the
// extraction (map_io.ts and persist.ts previously re-derived this cast
// inline at three call sites; this is the ONE place it now lives).
describe('toMapDoc', () => {
  it('returns the same underlying object (no runtime copy)', () => {
    const map = newCustomMap('Bridge', 'id1', 1000);
    const doc = toMapDoc(map);
    expect(doc).toBe(map as unknown as typeof doc);
  });

  it('produces a document the shared serializer/sanitizer round-trip exactly', () => {
    const map = newCustomMap('Round', 'rid', 42);
    map.terrainEdits.push({ x: 1, z: 2, radius: 8, delta: -3, falloff: 'flat' });
    map.placements.push({ assetId: 'props/well', x: 5, z: 6, rotY: 1, scale: 2, collide: true });

    const doc = toMapDoc(map);
    expect(doc.meta).toEqual(map.meta);
    expect(doc.content.zones).toEqual(map.content.zones);
    expect(doc.terrainEdits).toEqual(map.terrainEdits);
    expect(doc.placements).toEqual(map.placements);

    const parsed = sanitizeMapDoc(JSON.parse(serializeMapDoc(doc)));
    expect(parsed).not.toBeNull();
    expect(parsed?.meta.id).toBe(map.meta.id);
    expect(parsed?.terrainEdits).toEqual(map.terrainEdits);
    expect(parsed?.placements).toEqual(map.placements);
    expect(parsed?.content.zones.length).toBe(map.content.zones.length);
  });
});
