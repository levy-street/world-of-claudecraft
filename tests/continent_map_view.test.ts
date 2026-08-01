// Tests for the continent-overview pure core (continent_map_view.ts):
//  - the contain-fit image rect for the art plate's aspect,
//  - the per-zone region projection (fills the rect, right zone at each extreme),
//  - the point hit-test (continentZoneAt) over regions and ocean gaps,
//  - the current-zone flag + "you are here" marker off the player position,
//  - Sim-vs-ClientWorld parity + determinism.
//
// DOM/Three/2D-context-free, so this Node suite drives the core directly. The
// painter's canvas draws (continent_map_painter.ts) need a real 2D context and
// getComputedStyle and are exercised in the game, not here.

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z, ZONES, zoneAt } from '../src/sim/data';
import {
  buildContinentMapModel,
  CONTINENT_FALLBACK_ASPECT,
  type ContinentMapInput,
  continentZoneAt,
} from '../src/ui/continent_map_view';
import type { IWorld } from '../src/world_api';

const CANVAS = 560;

// Build two structurally-distinct IWorld stubs from the same player position (a
// "Sim-shaped" one carrying extra sim-only fields the core must ignore, and a
// lean "ClientWorld-mirror-shaped" one) so we can assert identical output.
function worldAt(shape: 'sim' | 'client', x: number, z: number): IWorld {
  const junk = shape === 'sim' ? { hp: 100, maxHp: 100, castingAbility: null } : {};
  return {
    player: { id: 1, kind: 'player', name: 'Me', pos: { x, z }, facing: 0.5, ...junk },
    entities: new Map(),
    socialInfo: null,
    delveRun: null,
    cfg: { seed: 42, playerClass: 'warrior' },
    playerId: 1,
    questState: () => 'unavailable',
    questLog: new Map(),
  } as unknown as IWorld;
}

function input(
  world: IWorld,
  contentAspect: number,
  hoveredZoneId: string | null = null,
): ContinentMapInput {
  return { world, canvasSize: CANVAS, contentAspect, hoveredZoneId };
}

// Independent re-derivation of the core's projection, to check region rects
// against a value NOT read back from the model under test.
function projectPoint(
  x: number,
  z: number,
  image: { mx: number; my: number; w: number; h: number },
) {
  return {
    mx: image.mx + ((WORLD_MAX_X - x) / (WORLD_MAX_X - WORLD_MIN_X)) * image.w,
    my: image.my + ((WORLD_MAX_Z - z) / (WORLD_MAX_Z - WORLD_MIN_Z)) * image.h,
  };
}

describe('buildContinentMapModel: image contain-fit rect', () => {
  it('a portrait aspect fits the height and centres horizontally', () => {
    const m = buildContinentMapModel(input(worldAt('client', 0, 0), 0.5));
    expect(m.image.h).toBe(CANVAS);
    expect(m.image.w).toBeCloseTo(CANVAS * 0.5, 6); // 280
    expect(m.image.mx).toBeCloseTo((CANVAS - CANVAS * 0.5) / 2, 6); // 140
    expect(m.image.my).toBe(0);
  });

  it('a landscape aspect fits the width and centres vertically', () => {
    const m = buildContinentMapModel(input(worldAt('client', 0, 0), 2));
    expect(m.image.w).toBe(CANVAS);
    expect(m.image.h).toBeCloseTo(CANVAS / 2, 6); // 280
    expect(m.image.mx).toBe(0);
    expect(m.image.my).toBeCloseTo((CANVAS - CANVAS / 2) / 2, 6); // 140
  });

  // The guard has two independent arms (`> 0` and `Number.isFinite`); exercise a
  // value that trips each one (0 / negative for `> 0`, Infinity for finiteness,
  // NaN for both) so dropping either arm reds the suite.
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -2])(
    'guards a degenerate aspect %p (falls back to a square, still on-canvas)',
    (aspect) => {
      const m = buildContinentMapModel(input(worldAt('client', 0, 0), aspect));
      expect(m.image.w).toBe(CANVAS);
      expect(m.image.h).toBe(CANVAS);
      expect(m.image.mx).toBe(0);
      expect(m.image.my).toBe(0);
    },
  );
});

describe('CONTINENT_FALLBACK_ASPECT tracks the shipped plate', () => {
  // The constant exists so the region layout does not JUMP when the plate
  // finishes decoding: it has to be the real file's width / height. Re-cropping
  // world_overview.webp without updating it would ship that jump, so pin the
  // constant to the asset's actual pixels (read from the file, never from the
  // constant itself).
  it('equals the real pixel aspect of public/map_art/world_overview.webp', async () => {
    const meta = await sharp(
      new URL('../public/map_art/world_overview.webp', import.meta.url).pathname,
    ).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBeGreaterThan(0);
    expect(meta.height).toBeGreaterThan(0);
    expect(CONTINENT_FALLBACK_ASPECT).toBeCloseTo(
      (meta.width as number) / (meta.height as number),
      6,
    );
    // The plate is a portrait crop of the (very tall) world bounds: assert the
    // orientation too, so a landscape replacement cannot silently pass by
    // matching a hand-edited constant.
    expect(CONTINENT_FALLBACK_ASPECT).toBeLessThan(1);
  });
});

describe('buildContinentMapModel: zone regions', () => {
  const m = buildContinentMapModel(input(worldAt('client', 0, 0), CONTINENT_FALLBACK_ASPECT));

  it('emits exactly one region per zone, keyed by zone id', () => {
    expect(m.regions).toHaveLength(ZONES.length);
    const ids = m.regions.map((r) => r.zoneId).sort();
    expect(ids).toEqual(ZONES.map((z) => z.id).sort());
  });

  it('regions fill the image rect out to every world-bound extreme', () => {
    const left = Math.min(...m.regions.map((r) => r.rect.mx));
    const right = Math.max(...m.regions.map((r) => r.rect.mx + r.rect.w));
    const top = Math.min(...m.regions.map((r) => r.rect.my));
    const bottom = Math.max(...m.regions.map((r) => r.rect.my + r.rect.h));
    // Content really has a zone at each extreme (x=+540 east col, x=-540 west
    // col, z=2420 north, z=-180 south), so the union spans the whole plate rect.
    expect(left).toBeCloseTo(m.image.mx, 4);
    expect(right).toBeCloseTo(m.image.mx + m.image.w, 4);
    expect(top).toBeCloseTo(m.image.my, 4);
    expect(bottom).toBeCloseTo(m.image.my + m.image.h, 4);
  });

  it('projects a known zone rect to its independently derived corners', () => {
    const eastbrook = m.regions.find((r) => r.zoneId === 'eastbrook_vale');
    if (!eastbrook) throw new Error('expected the eastbrook_vale zone');
    const zone = ZONES.find((z) => z.id === 'eastbrook_vale');
    if (!zone) throw new Error('expected eastbrook_vale content');
    // +X maps left, +Z maps up: top-left corner at (xMax, zMax), bottom-right at
    // (xMin, zMin). xMin/xMax default to the strip [-180, 180].
    const tl = projectPoint(180, zone.zMax, m.image);
    const br = projectPoint(-180, zone.zMin, m.image);
    expect(eastbrook.rect.mx).toBeCloseTo(tl.mx, 4);
    expect(eastbrook.rect.my).toBeCloseTo(tl.my, 4);
    expect(eastbrook.rect.w).toBeCloseTo(br.mx - tl.mx, 4);
    expect(eastbrook.rect.h).toBeCloseTo(br.my - tl.my, 4);
    // The southern starter zone reaches z=WORLD_MIN_Z, so its rect touches the
    // bottom edge of the plate.
    expect(eastbrook.rect.my + eastbrook.rect.h).toBeCloseTo(m.image.my + m.image.h, 4);
    // The label anchor is the rect centre (the painter draws the name there).
    expect(eastbrook.labelX).toBeCloseTo(eastbrook.rect.mx + eastbrook.rect.w / 2, 6);
    expect(eastbrook.labelY).toBeCloseTo(eastbrook.rect.my + eastbrook.rect.h / 2, 6);
  });

  it('projects an EXPLICIT-column zone rect to its independently derived corners', () => {
    // drakelands carries explicit xMin/xMax (the east column), not the strip
    // default, so this pins that the projection reads the real x-range fields.
    const drakelands = m.regions.find((r) => r.zoneId === 'drakelands');
    const zone = ZONES.find((z) => z.id === 'drakelands');
    if (!drakelands || !zone) throw new Error('expected drakelands');
    if (zone.xMin === undefined || zone.xMax === undefined) {
      throw new Error('expected drakelands to declare an explicit x-range');
    }
    const tl = projectPoint(zone.xMax, zone.zMax, m.image);
    const br = projectPoint(zone.xMin, zone.zMin, m.image);
    expect(drakelands.rect.mx).toBeCloseTo(tl.mx, 4);
    expect(drakelands.rect.my).toBeCloseTo(tl.my, 4);
    expect(drakelands.rect.w).toBeCloseTo(br.mx - tl.mx, 4);
    expect(drakelands.rect.h).toBeCloseTo(br.my - tl.my, 4);
  });

  it('carries each zone level band for the hover tooltip', () => {
    const drakelands = m.regions.find((r) => r.zoneId === 'drakelands');
    const zone = ZONES.find((z) => z.id === 'drakelands');
    if (!drakelands || !zone) throw new Error('expected drakelands');
    expect([drakelands.levelMin, drakelands.levelMax]).toEqual(zone.levelRange);
  });
});

describe('continentZoneAt: point hit-test', () => {
  const m = buildContinentMapModel(input(worldAt('client', 0, 0), CONTINENT_FALLBACK_ASPECT));
  const centerOf = (zoneId: string) => {
    const r = m.regions.find((x) => x.zoneId === zoneId);
    if (!r) throw new Error(`no region ${zoneId}`);
    return { mx: r.rect.mx + r.rect.w / 2, my: r.rect.my + r.rect.h / 2 };
  };

  it('returns the zone whose rect contains the point', () => {
    const p = centerOf('drakelands');
    expect(continentZoneAt(m.regions, p.mx, p.my)).toBe('drakelands');
    const q = centerOf('eastbrook_vale');
    expect(continentZoneAt(m.regions, q.mx, q.my)).toBe('eastbrook_vale');
  });

  it('returns null off the plate entirely', () => {
    expect(continentZoneAt(m.regions, -5, -5)).toBeNull();
    expect(continentZoneAt(m.regions, CANVAS + 5, CANVAS + 5)).toBeNull();
  });

  it('returns null over an ocean gap between columns', () => {
    // The eastbrook band (z in [-180,180]) has no zone in the WEST column
    // (x in [-540,-180]); +X maps left, so west is to the RIGHT of eastbrook.
    const eb = m.regions.find((r) => r.zoneId === 'eastbrook_vale');
    if (!eb) throw new Error('expected eastbrook_vale');
    const gapMx = eb.rect.mx + eb.rect.w + 20; // just west (right) of eastbrook
    const bandMy = eb.rect.my + eb.rect.h / 2;
    expect(gapMx).toBeLessThan(m.image.mx + m.image.w); // still inside the plate
    expect(continentZoneAt(m.regions, gapMx, bandMy)).toBeNull();
  });
});

describe('buildContinentMapModel: current zone + player marker', () => {
  it('flags exactly the zone the player stands in as current', () => {
    const zone = ZONES.find((z) => z.id === 'drakelands');
    if (!zone) throw new Error('expected drakelands');
    // A point squarely inside drakelands (east column, northern band).
    const m = buildContinentMapModel(
      input(worldAt('client', 404, 1900), CONTINENT_FALLBACK_ASPECT),
    );
    expect(m.currentZoneId).toBe(zoneAt(404, 1900).id);
    expect(m.currentZoneId).toBe('drakelands');
    const current = m.regions.filter((r) => r.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].zoneId).toBe('drakelands');
  });

  it('projects the player marker and drops it off the world bounds', () => {
    const inside = buildContinentMapModel(input(worldAt('client', 0, 0), 1));
    expect(inside.player).not.toBeNull();
    const expected = projectPoint(0, 0, inside.image);
    expect(inside.player?.mx).toBeCloseTo(expected.mx, 4);
    expect(inside.player?.my).toBeCloseTo(expected.my, 4);
  });

  // withinWorld ANDs four bounds; give each a case that violates ONLY it, so
  // dropping any single bound reds the suite. The z<WORLD_MIN_Z case is real:
  // a player inside a dungeon instance sits south of the overworld strip.
  it.each([
    ['x too far east', WORLD_MAX_X + 5000, 0],
    ['x too far west', WORLD_MIN_X - 5000, 0],
    ['z below the world (dungeon instance band)', 0, WORLD_MIN_Z - 5000],
    ['z above the world', 0, WORLD_MAX_Z + 5000],
  ])('drops the player marker when %s', (_label, x, z) => {
    const off = buildContinentMapModel(input(worldAt('client', x as number, z as number), 1));
    expect(off.player).toBeNull();
  });

  it('marks the hovered zone', () => {
    const m = buildContinentMapModel(input(worldAt('client', 0, 0), 1, 'frostveil'));
    const hovered = m.regions.filter((r) => r.isHovered);
    expect(hovered).toHaveLength(1);
    expect(hovered[0].zoneId).toBe('frostveil');
  });
});

describe('buildContinentMapModel: parity + determinism', () => {
  it('Sim-shaped and ClientWorld-mirror-shaped stubs render identically', () => {
    const sim = buildContinentMapModel(input(worldAt('sim', 200, 300), 0.86, 'palmreach'));
    const client = buildContinentMapModel(input(worldAt('client', 200, 300), 0.86, 'palmreach'));
    expect(sim).toEqual(client);
  });

  it('is deterministic: identical inputs produce a deep-equal model', () => {
    const a = buildContinentMapModel(input(worldAt('client', 10, 20), 0.86));
    const b = buildContinentMapModel(input(worldAt('client', 10, 20), 0.86));
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Party markers (issue 2652): the continent level answers "which zone is the
// rest of my group in", which the per-zone map cannot (it drops anyone outside
// the committed zone). Dots only: no name, no zone gate.
// ---------------------------------------------------------------------------

/** One party member row, only the fields the core reads. */
interface StubMember {
  pid: number;
  cls: string;
  x: number;
  z: number;
  dead: number;
}

/** worldAt plus a party roster. Self is always pid 1 (matching worldAt's player). */
function partyWorldAt(
  shape: 'sim' | 'client',
  x: number,
  z: number,
  members: StubMember[],
): IWorld {
  const world = worldAt(shape, x, z) as unknown as { partyInfo: unknown };
  world.partyInfo = {
    leader: 1,
    raid: false,
    master: { enabled: false, looter: 0, threshold: 'uncommon' },
    members: members.map((m) => ({ ...m, name: `P${m.pid}`, level: 20 })),
  };
  return world as unknown as IWorld;
}

const SELF: StubMember = { pid: 1, cls: 'warrior', x: 0, z: 0, dead: 0 };

describe('buildContinentMapModel: party markers', () => {
  it('projects each member to its independently derived point and skips self', () => {
    // The mage sits in the same southern band as the player; the druid is far
    // north in the east column, i.e. a completely different zone.
    const mage: StubMember = { pid: 2, cls: 'mage', x: 120, z: 60, dead: 0 };
    const druid: StubMember = { pid: 3, cls: 'druid', x: 404, z: 1900, dead: 0 };
    const m = buildContinentMapModel(
      input(partyWorldAt('client', 0, 0, [SELF, mage, druid]), CONTINENT_FALLBACK_ASPECT),
    );

    expect(m.party).toHaveLength(2);
    for (const [i, member] of [mage, druid].entries()) {
      const expected = projectPoint(member.x, member.z, m.image);
      expect(m.party[i].mx).toBeCloseTo(expected.mx, 4);
      expect(m.party[i].my).toBeCloseTo(expected.my, 4);
      expect(m.party[i].cls).toBe(member.cls);
    }
    // Self carries the "you are here" marker instead, at its own position.
    expect(m.party.some((p) => p.cls === 'warrior')).toBe(false);
    expect(m.player).not.toBeNull();
  });

  it('lands a far-north member inside that zone region, not the player zone', () => {
    // The reason this level exists: the per-zone map drops an out-of-zone
    // member entirely, so the continent dot has to fall inside the OTHER zone's
    // rect. Player in eastbrook_vale (south), member in drakelands (north-east).
    const m = buildContinentMapModel(
      input(
        partyWorldAt('client', 0, 0, [SELF, { pid: 2, cls: 'druid', x: 404, z: 1900, dead: 0 }]),
        CONTINENT_FALLBACK_ASPECT,
      ),
    );
    expect(m.currentZoneId).toBe('eastbrook_vale');
    expect(m.party).toHaveLength(1);
    expect(continentZoneAt(m.regions, m.party[0].mx, m.party[0].my)).toBe('drakelands');
    expect(zoneAt(404, 1900).id).toBe('drakelands');
  });

  it('reports the dead flag as a boolean, per member', () => {
    const m = buildContinentMapModel(
      input(
        partyWorldAt('client', 0, 0, [
          SELF,
          { pid: 2, cls: 'mage', x: 40, z: 40, dead: 0 },
          { pid: 3, cls: 'priest', x: -40, z: -40, dead: 1 },
        ]),
        CONTINENT_FALLBACK_ASPECT,
      ),
    );
    expect(m.party.map((p) => ({ cls: p.cls, dead: p.dead }))).toEqual([
      { cls: 'mage', dead: false },
      { cls: 'priest', dead: true },
    ]);
  });

  // The bounds test ANDs four comparisons; give each a case that violates ONLY
  // it, so dropping any single bound reds the suite. A member inside a dungeon
  // instance sits south of the overworld strip, which is the real-world case.
  it.each([
    ['x too far east', WORLD_MAX_X + 5000, 0],
    ['x too far west', WORLD_MIN_X - 5000, 0],
    ['z below the world (dungeon instance band)', 0, WORLD_MIN_Z - 5000],
    ['z above the world', 0, WORLD_MAX_Z + 5000],
  ])('drops a member whose %s', (_label, x, z) => {
    const m = buildContinentMapModel(
      input(
        partyWorldAt('client', 0, 0, [
          SELF,
          { pid: 2, cls: 'mage', x: x as number, z: z as number, dead: 0 },
        ]),
        CONTINENT_FALLBACK_ASPECT,
      ),
    );
    expect(m.party).toEqual([]);
  });

  it('is empty for a solo player and for a party of one', () => {
    const solo = buildContinentMapModel(input(worldAt('client', 0, 0), CONTINENT_FALLBACK_ASPECT));
    expect(solo.party).toEqual([]);
    const alone = buildContinentMapModel(
      input(partyWorldAt('client', 0, 0, [SELF]), CONTINENT_FALLBACK_ASPECT),
    );
    expect(alone.party).toEqual([]);
  });

  it('Sim-shaped and ClientWorld-mirror-shaped stubs render the same party', () => {
    const roster: StubMember[] = [
      SELF,
      { pid: 2, cls: 'mage', x: 120, z: 60, dead: 0 },
      { pid: 3, cls: 'priest', x: -404, z: 1900, dead: 1 },
    ];
    const sim = buildContinentMapModel(input(partyWorldAt('sim', 0, 0, roster), 0.86));
    const client = buildContinentMapModel(input(partyWorldAt('client', 0, 0, roster), 0.86));
    expect(sim.party).toHaveLength(2);
    expect(sim).toEqual(client);
  });
});
