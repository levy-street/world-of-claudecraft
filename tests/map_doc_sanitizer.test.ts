import { describe, expect, it } from 'vitest';
import {
  MAP_DOC_VERSION,
  MAX_BLOCKER_LENGTH,
  MAX_BLOCKERS,
  MAX_CAMP_COUNT,
  MAX_CAMP_RADIUS,
  MAX_COLLIDE_RADIUS,
  MAX_OBJECT_POSITIONS,
  MAX_STR_ARRAY,
  MAX_WORLD_COORD,
  MAX_ZONE_LAKES,
  MAX_ZONE_POIS,
  MIN_COLLIDE_RADIUS,
  sanitizeMapDoc,
} from '../src/sim/map_doc';

// The gameplay-array hardening for sanitizeMapDoc (src/sim/map_doc.ts): a
// published document is untrusted input that any viewer's playtest Sim will
// spawn from, so camps/npcs/objects are rebuilt field by field, every accepted
// number must be finite (JSON.parse turns 1e999 into Infinity, which
// JSON.stringify would then store as null, an unloadable byte), and the
// version is always the sanitizer's own (2).

const ZONE = {
  id: 'z',
  name: 'Z',
  zMin: -10,
  zMax: 100,
  hub: { x: 0, z: 0, radius: 5, name: 'H' },
};

function rawDoc(content: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    meta: { id: 'm1', name: 'Map', seed: 7 },
    content: { zones: [ZONE], camps: [], npcs: {}, objects: [], roads: [], ...content },
    terrainEdits: [],
    placements: [],
  };
}

describe('camps', () => {
  it('clamps camp.count so a hostile map cannot freeze a playtesting viewer', () => {
    const doc = sanitizeMapDoc(
      rawDoc({ camps: [{ mobId: 'forest_wolf', center: { x: 0, z: 0 }, radius: 10, count: 1e9 }] }),
    );
    expect(doc?.content.camps).toEqual([
      { mobId: 'forest_wolf', center: { x: 0, z: 0 }, radius: 10, count: MAX_CAMP_COUNT },
    ]);
  });

  it('clamps radius and coordinates and floors a fractional count', () => {
    const doc = sanitizeMapDoc(
      rawDoc({
        camps: [
          { mobId: 'boar', center: { x: 1e8, z: -1e8 }, radius: 5000, count: 3.9 },
          { mobId: 'boar', center: { x: 0, z: 0 }, radius: -4, count: 0 },
        ],
      }),
    );
    expect(doc?.content.camps).toEqual([
      {
        mobId: 'boar',
        center: { x: MAX_WORLD_COORD, z: -MAX_WORLD_COORD },
        radius: MAX_CAMP_RADIUS,
        count: 3,
      },
      { mobId: 'boar', center: { x: 0, z: 0 }, radius: 0.5, count: 1 },
    ]);
  });

  it('drops malformed camps instead of throwing', () => {
    const doc = sanitizeMapDoc(
      rawDoc({
        camps: [
          null,
          'nope',
          { center: { x: 0, z: 0 }, radius: 5, count: 1 }, // no mobId
          { mobId: 42, center: { x: 0, z: 0 }, radius: 5, count: 1 }, // non-string mobId
          { mobId: '', center: { x: 0, z: 0 }, radius: 5, count: 1 }, // empty mobId
          { mobId: 'x'.repeat(65), center: { x: 0, z: 0 }, radius: 5, count: 1 }, // oversized id
          { mobId: 'ok', radius: 5, count: 1 }, // no center
          { mobId: 'ok', center: { x: Number.NaN, z: 0 }, radius: 5, count: 1 },
          { mobId: 'ok', center: { x: 0, z: Number.POSITIVE_INFINITY }, radius: 5, count: 1 },
          { mobId: 'kept', center: { x: 1, z: 2 }, radius: 8, count: 4 },
        ],
      }),
    );
    expect(doc?.content.camps).toEqual([
      { mobId: 'kept', center: { x: 1, z: 2 }, radius: 8, count: 4 },
    ]);
  });

  it('def-fills a missing or non-finite radius/count (1e999 over the wire)', () => {
    // The real attack shape: sanitizeMapDoc accepts the raw JSON string, and
    // JSON.parse turns 1e999 into Infinity.
    const raw = rawDoc();
    const json = JSON.stringify(raw).replace(
      '"camps":[]',
      '"camps":[{"mobId":"ok","center":{"x":0,"z":0},"radius":1e999,"count":1e999}]',
    );
    const doc = sanitizeMapDoc(json);
    expect(doc?.content.camps[0].radius).toBe(5);
    expect(doc?.content.camps[0].count).toBe(1);
    expect(Number.isFinite(doc?.content.camps[0].count)).toBe(true);
  });
});

describe('npcs', () => {
  it('rebuilds a valid npc and drops junk fields and malformed entries', () => {
    const doc = sanitizeMapDoc(
      rawDoc({
        npcs: {
          good: {
            id: 'good',
            name: 'Innkeeper',
            title: 'Barkeep',
            pos: { x: 3, z: 4 },
            facing: 1.5,
            color: 0xabcdef,
            questIds: ['q1', 42, 'q2'],
            vendorItems: ['bread', null],
            market: true,
            greeting: 'Hello',
            __proto__pollution: 'junk',
          },
          noId: { pos: { x: 0, z: 0 } },
          badPos: { id: 'badPos', pos: { x: Number.NaN, z: 0 } },
          infPos: { id: 'infPos', pos: { x: 0, z: Number.POSITIVE_INFINITY } },
          notAnObject: 7,
        },
      }),
    );
    expect(Object.keys(doc?.content.npcs ?? {})).toEqual(['good']);
    expect(doc?.content.npcs.good).toEqual({
      id: 'good',
      name: 'Innkeeper',
      title: 'Barkeep',
      pos: { x: 3, z: 4 },
      facing: 1.5,
      color: 0xabcdef,
      questIds: ['q1', 'q2'],
      vendorItems: ['bread'],
      market: true,
      greeting: 'Hello',
    });
  });

  it('def-fills optional fields and clamps coordinates', () => {
    const doc = sanitizeMapDoc(
      rawDoc({ npcs: { n: { id: 'n', pos: { x: -1e7, z: 1e7 }, facing: Number.NaN } } }),
    );
    const npc = doc?.content.npcs.n;
    expect(npc?.pos).toEqual({ x: -MAX_WORLD_COORD, z: MAX_WORLD_COORD });
    expect(npc?.facing).toBe(0);
    expect(npc?.name).toBe('Villager');
    expect(npc?.questIds).toEqual([]);
    expect(npc?.market).toBeUndefined();
    expect(npc?.dynamic).toBeUndefined();
  });
});

describe('objects', () => {
  it('requires a string itemId and finite positions, and caps the position list', () => {
    const doc = sanitizeMapDoc(
      rawDoc({
        objects: [
          {
            itemId: 'herb',
            name: 'Herb',
            positions: [
              { x: 1, z: 2 },
              { x: Number.NaN, z: 0 },
            ],
          },
          { name: 'No Item', positions: [{ x: 0, z: 0 }] },
          { itemId: 7, positions: [] },
          {
            itemId: 'ore',
            name: 'Ore',
            positions: Array.from({ length: 500 }, (_, i) => ({ x: i, z: i })),
          },
        ],
      }),
    );
    expect(doc?.content.objects).toHaveLength(2);
    expect(doc?.content.objects[0]).toEqual({
      itemId: 'herb',
      name: 'Herb',
      positions: [{ x: 1, z: 2 }],
    });
    expect(doc?.content.objects[1].positions).toHaveLength(MAX_OBJECT_POSITIONS);
  });
});

describe('non-finite numbers are rejected everywhere', () => {
  it('zones: a non-finite z-band or hub drops the zone', () => {
    expect(
      sanitizeMapDoc(rawDoc({ zones: [{ ...ZONE, zMax: Number.POSITIVE_INFINITY }] })),
    ).toBeNull();
    expect(sanitizeMapDoc(rawDoc({ zones: [{ ...ZONE, zMin: Number.NaN }] }))).toBeNull();
    expect(
      sanitizeMapDoc(rawDoc({ zones: [{ ...ZONE, hub: { x: Number.NaN, z: 0 } }] })),
    ).toBeNull();
  });

  it('zones: non-finite lakes, pois, levelRange, and graveyard are dropped or def-filled', () => {
    const doc = sanitizeMapDoc(
      rawDoc({
        zones: [
          {
            ...ZONE,
            lakes: [
              { x: 0, z: 0, radius: 10 },
              { x: Number.POSITIVE_INFINITY, z: 0, radius: 10 },
              { x: 0, z: 0, radius: Number.NaN },
            ],
            pois: [
              { x: 1, z: 1, label: 'ok' },
              { x: Number.NaN, z: 1, label: 'bad' },
            ],
            levelRange: [1, Number.POSITIVE_INFINITY],
            graveyard: { x: Number.NaN, z: 0 },
          },
        ],
      }),
    );
    const zone = doc?.content.zones[0];
    expect(zone?.lakes).toEqual([{ x: 0, z: 0, radius: 10 }]);
    expect(zone?.pois).toEqual([{ x: 1, z: 1, label: 'ok' }]);
    expect(zone?.levelRange).toEqual([1, 10]);
    expect(zone?.graveyard).toEqual({ x: 0, z: 0 }); // def-filled from the hub
  });

  it('zones: z-band, hub, graveyard, and lake/poi values are clamped (viewer DoS regression)', () => {
    // REGRESSION: zMin/zMax drive the decoration generator's loop bounds and
    // lakes multiply per-vertex terrain cost; a stored map with a huge z-band
    // or thousands of lakes froze any viewer's tab.
    const doc = sanitizeMapDoc(
      rawDoc({
        zones: [
          {
            ...ZONE,
            zMin: -1e9,
            zMax: 1e9,
            hub: { x: 1e9, z: -1e9, radius: 1e9, name: 'H' },
            graveyard: { x: -1e9, z: 1e9 },
            lakes: Array.from({ length: 500 }, (_, i) => ({ x: i, z: 1e9, radius: 1e9 })),
            pois: Array.from({ length: 500 }, (_, i) => ({ x: i, z: -1e9 })),
            levelRange: [0.5, 999],
          },
        ],
      }),
    );
    const zone = doc?.content.zones[0];
    expect(zone?.zMin).toBe(-MAX_WORLD_COORD);
    expect(zone?.zMax).toBe(MAX_WORLD_COORD);
    expect(zone?.hub).toEqual({ x: MAX_WORLD_COORD, z: -MAX_WORLD_COORD, radius: 200, name: 'H' });
    expect(zone?.graveyard).toEqual({ x: -MAX_WORLD_COORD, z: MAX_WORLD_COORD });
    expect(zone?.lakes.length).toBe(MAX_ZONE_LAKES);
    expect(zone?.lakes[0]).toEqual({ x: 0, z: MAX_WORLD_COORD, radius: 200 });
    expect(zone?.pois.length).toBe(MAX_ZONE_POIS);
    expect(zone?.pois[0]).toEqual({ x: 0, z: -MAX_WORLD_COORD });
    expect(zone?.levelRange).toEqual([1, 60]);
  });

  it('npcs: questIds and vendorItems are capped in count and per-string length', () => {
    const doc = sanitizeMapDoc(
      rawDoc({
        npcs: {
          n1: {
            id: 'n1',
            name: 'N',
            pos: { x: 0, z: 0 },
            questIds: Array.from({ length: 500 }, (_, i) => `q${i}`.padEnd(200, 'x')),
            vendorItems: Array.from({ length: 500 }, (_, i) => `v${i}`),
          },
        },
      }),
    );
    const npc = doc?.content.npcs.n1;
    expect(npc?.questIds.length).toBe(MAX_STR_ARRAY);
    expect(npc?.questIds[0].length).toBeLessThanOrEqual(64);
    expect(npc?.vendorItems?.length).toBe(MAX_STR_ARRAY);
  });

  it('roads: a point with a non-finite coordinate is dropped', () => {
    const doc = sanitizeMapDoc(
      rawDoc({
        roads: [
          [
            { x: 0, z: 0 },
            { x: Number.NaN, z: 5 },
            { x: 5, z: 5 },
          ],
          [
            { x: 0, z: 0 },
            { x: Number.POSITIVE_INFINITY, z: 1 },
          ], // 1 valid point left: road dropped
        ],
      }),
    );
    expect(doc?.content.roads).toEqual([
      [
        { x: 0, z: 0 },
        { x: 5, z: 5 },
      ],
    ]);
  });

  it('playerStart and waterLevel: non-finite values are omitted', () => {
    const base = rawDoc();
    const doc = sanitizeMapDoc({
      ...base,
      waterLevel: Number.NaN,
      playerStart: { x: Number.POSITIVE_INFINITY, z: 0 },
    });
    expect(doc?.waterLevel).toBeUndefined();
    expect(doc?.playerStart).toBeUndefined();
  });

  it('terrainEdits and placements: non-finite entries are dropped (regression pin)', () => {
    const doc = sanitizeMapDoc({
      ...rawDoc(),
      terrainEdits: [
        { x: 0, z: 0, radius: 10, delta: 3, falloff: 'smooth' },
        { x: Number.POSITIVE_INFINITY, z: 0, radius: 10, delta: 3, falloff: 'smooth' },
        { x: 0, z: 0, radius: Number.NaN, delta: 3, falloff: 'smooth' },
      ],
      placements: [
        { assetId: 'props/well', x: 1, z: 2, rotY: 0, scale: 1, collide: false },
        { assetId: 'props/well', x: Number.NaN, z: 2, rotY: 0, scale: 1, collide: false },
      ],
    });
    expect(doc?.terrainEdits).toHaveLength(1);
    expect(doc?.placements).toHaveLength(1);
  });
});

describe('placement collideRadius override', () => {
  function withPlacement(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      ...rawDoc(),
      placements: [
        { assetId: 'props/well', x: 1, z: 2, rotY: 0, scale: 1, collide: true, ...extra },
      ],
    };
  }

  it('clamps the override into [MIN, MAX]', () => {
    expect(
      sanitizeMapDoc(withPlacement({ collideRadius: 0.01 }))?.placements[0].collideRadius,
    ).toBe(MIN_COLLIDE_RADIUS);
    expect(sanitizeMapDoc(withPlacement({ collideRadius: 500 }))?.placements[0].collideRadius).toBe(
      MAX_COLLIDE_RADIUS,
    );
    expect(sanitizeMapDoc(withPlacement({ collideRadius: 4.5 }))?.placements[0].collideRadius).toBe(
      4.5,
    );
  });

  it('drops a non-finite or non-numeric override, keeping the placement', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 'wide', null]) {
      const doc = sanitizeMapDoc(withPlacement({ collideRadius: bad }));
      expect(doc?.placements).toHaveLength(1);
      expect(doc?.placements[0].collideRadius).toBeUndefined();
    }
  });

  it('is kept even while collide is false (survives a re-toggle)', () => {
    const doc = sanitizeMapDoc(withPlacement({ collide: false, collideRadius: 3 }));
    expect(doc?.placements[0].collide).toBe(false);
    expect(doc?.placements[0].collideRadius).toBe(3);
  });

  it('absence round-trips as absence', () => {
    const first = sanitizeMapDoc(withPlacement({}));
    expect(first?.placements[0].collideRadius).toBeUndefined();
    const second = sanitizeMapDoc(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
  });
});

describe('blockers', () => {
  it('caps the list at MAX_BLOCKERS', () => {
    const doc = sanitizeMapDoc({
      ...rawDoc(),
      blockers: Array.from({ length: 500 }, (_, i) => ({ x1: i, z1: 0, x2: i, z2: 10 })),
    });
    expect(doc?.blockers).toHaveLength(MAX_BLOCKERS);
  });

  it('drops entries with non-finite or missing coordinates', () => {
    const doc = sanitizeMapDoc({
      ...rawDoc(),
      blockers: [
        null,
        'nope',
        { x1: 0, z1: 0, x2: 10 }, // missing z2
        { x1: Number.NaN, z1: 0, x2: 10, z2: 0 },
        { x1: 0, z1: Number.POSITIVE_INFINITY, x2: 10, z2: 0 },
        { x1: 0, z1: 0, x2: 10, z2: 0 }, // kept
      ],
    });
    expect(doc?.blockers).toEqual([{ x1: 0, z1: 0, x2: 10, z2: 0 }]);
  });

  it('drops segments shorter than half a yard', () => {
    const doc = sanitizeMapDoc({
      ...rawDoc(),
      blockers: [
        { x1: 0, z1: 0, x2: 0.3, z2: 0 },
        { x1: 5, z1: 5, x2: 5, z2: 5 },
      ],
    });
    expect(doc?.blockers).toBeUndefined();
  });

  it('clamps coordinates to the world bound and truncates over-long segments', () => {
    const doc = sanitizeMapDoc({
      ...rawDoc(),
      blockers: [{ x1: -1e8, z1: 3, x2: 1e8, z2: 3 }],
    });
    const b = doc?.blockers?.[0];
    expect(b?.x1).toBe(-MAX_WORLD_COORD);
    expect(Math.hypot((b?.x2 ?? 0) - (b?.x1 ?? 0), (b?.z2 ?? 0) - (b?.z1 ?? 0))).toBeCloseTo(
      MAX_BLOCKER_LENGTH,
      6,
    );
  });

  it('the truncated result is round-trip stable', () => {
    const first = sanitizeMapDoc({
      ...rawDoc(),
      blockers: [{ x1: 0, z1: 0, x2: 300, z2: 400 }],
    });
    const second = sanitizeMapDoc(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
  });

  it('truncation is idempotent for non-Pythagorean segments (hypot ~1 ulp over the cap)', () => {
    // {0,0,300,300} truncates to length 200.00000000000003 without the epsilon
    // tolerance, so a second sanitize pass would re-truncate and re-dirty the
    // stored bytes.
    const first = sanitizeMapDoc({
      ...rawDoc(),
      blockers: [{ x1: 0, z1: 0, x2: 300, z2: 300 }],
    });
    const second = sanitizeMapDoc(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
  });
});

describe('v1 documents (neither collideRadius nor blockers)', () => {
  it('parses unchanged: no blockers field, no radius override', () => {
    const v1 = {
      version: 1,
      meta: { id: 'legacy', name: 'Old Map', seed: 7 },
      content: { zones: [ZONE], camps: [], npcs: {}, objects: [], roads: [] },
      terrainEdits: [{ x: 0, z: 0, radius: 10, delta: 3, falloff: 'smooth' }],
      placements: [{ assetId: 'props/well', x: 1, z: 2, rotY: 0, scale: 1, collide: true }],
    };
    const doc = sanitizeMapDoc(v1);
    expect(doc).not.toBeNull();
    expect(doc?.blockers).toBeUndefined();
    expect(doc?.placements[0]).toEqual({
      assetId: 'props/well',
      x: 1,
      z: 2,
      rotY: 0,
      scale: 1,
      collide: true,
    });
    expect('collideRadius' in (doc?.placements[0] ?? {})).toBe(false);
  });
});

describe('version', () => {
  it('is always the sanitizer version, never round-tripped from the input', () => {
    expect(sanitizeMapDoc(rawDoc())?.version).toBe(MAP_DOC_VERSION);
    expect(sanitizeMapDoc({ ...rawDoc(), version: 999 })?.version).toBe(MAP_DOC_VERSION);
    expect(sanitizeMapDoc({ ...rawDoc(), version: 'v9' })?.version).toBe(MAP_DOC_VERSION);
    expect(sanitizeMapDoc({ ...rawDoc(), version: Number.NaN })?.version).toBe(MAP_DOC_VERSION);
  });
});

describe('round trip (the server never stores an unloadable byte)', () => {
  it('sanitize(JSON.parse(JSON.stringify(sanitize(x)))) succeeds and is stable', () => {
    // A kitchen-sink hostile document: every table populated, plus junk.
    const nasty = rawDoc({
      camps: [
        { mobId: 'forest_wolf', center: { x: 5, z: 6 }, radius: 12, count: 1e9 },
        { mobId: 'bad', center: { x: Number.NaN, z: 0 }, radius: 5, count: 1 },
      ],
      npcs: {
        keeper: { id: 'keeper', name: 'Keeper', pos: { x: 1, z: 2 }, questIds: ['q1'] },
        bad: { id: 'bad', pos: { x: Number.POSITIVE_INFINITY, z: 0 } },
      },
      objects: [{ itemId: 'herb', name: 'Herb', positions: [{ x: 1, z: 1 }] }],
      roads: [
        [
          { x: 0, z: 0 },
          { x: 9, z: 9 },
        ],
      ],
      zones: [
        {
          ...ZONE,
          lakes: [{ x: 0, z: 0, radius: 10 }],
          pois: [{ x: 1, z: 1, label: 'p' }],
        },
      ],
    });
    Object.assign(nasty, {
      terrainEdits: [{ x: 0, z: 0, radius: 10, delta: 3, falloff: 'smooth', mode: 'level' }],
      placements: [
        { assetId: 'props/well', x: 1, z: 2, rotY: 0.5, scale: 2, collide: true },
        { assetId: 'props/rock', x: 4, z: 5, rotY: 0, scale: 1, collide: true, collideRadius: 6 },
      ],
      blockers: [
        { x1: 0, z1: 0, x2: 20, z2: 0 },
        { x1: 0, z1: 0, x2: 0.1, z2: 0 }, // too short: dropped
      ],
      waterLevel: 3,
      playerStart: { x: 3, z: 4 },
      biomePaint: { cell: 20, cols: 2, rows: 2, originX: 0, originZ: 0, ids: [0, 1, 2, 255] },
    });
    const first = sanitizeMapDoc(nasty);
    expect(first).not.toBeNull();
    if (!first) return;
    // Nothing the sanitizer produced becomes null through JSON storage...
    const stored = JSON.stringify(first);
    expect(stored).not.toContain('null');
    // ...and re-sanitizing the stored bytes is lossless.
    const second = sanitizeMapDoc(JSON.parse(stored));
    expect(second).not.toBeNull();
    expect(second).toEqual(first);
  });
});
