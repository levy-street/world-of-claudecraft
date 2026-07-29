// Compass truth for quest prose: every direction word a quest sentence spends
// has to agree with where the content actually puts the thing it points at.
//
// The phase 13 onboarding pass fixed eight-plus MIRRORED claims by hand (a
// sentence sending the player west to a target sitting east), and hand fixes
// leave nothing behind that fails when the next camp moves or the next
// sentence is reworded. This is that guard: one row per audited claim, each
// citing where its two coordinates were read from, resolved against the LIVE
// content tables so moving a camp or re-pointing a POI reds a test.
//
// The world convention, in one line (see src/ui/compass.ts and the projection
// in src/ui/continent_map_view.ts, both pinned by their own arm at the bottom
// of this file): player-facing EAST is -X, WEST is +X, NORTH is +Z, SOUTH is
// -Z. Every sign check below reads that way round, and the convention arm is
// what stops this whole table from passing under a flipped one.
//
// Content-only suite: no DOM, no Sim, no rng.

import { describe, expect, it } from 'vitest';
import { CAMPS, DUNGEONS, QUESTS, ZONES } from '../src/sim/data';
import { EASTBROOK_STATIONS_BY_ID, facingToward, pointAtYaw } from '../src/sim/eastbrook_layout';
import { bearingDegrees, headingLabel } from '../src/ui/compass';
import { buildContinentMapModel } from '../src/ui/continent_map_view';
import { guideStrings } from '../src/ui/i18n.catalog/guide';
import type { IWorld } from '../src/world_api';

interface Point {
  x: number;
  z: number;
}

/** The four world-space components a direction word can claim. */
type Component = 'north' | 'south' | 'east' | 'west';

/**
 * What each direction word claims about the bearing from a row's reference
 * point to its target. A CARDINAL also has to dominate: a "west" that is
 * mostly south is not west, it is southwest, and a sentence that says west
 * would still be pointing a new player at the wrong horizon. An
 * INTERCARDINAL claims both signs and needs no dominance, because naming both
 * axes is exactly what it does.
 */
const WORD_CLAIM: Readonly<Record<string, { claims: readonly Component[]; dominant: boolean }>> = {
  west: { claims: ['west'], dominant: true },
  western: { claims: ['west'], dominant: true },
  eastern: { claims: ['east'], dominant: true },
  southeast: { claims: ['south', 'east'], dominant: false },
  southwest: { claims: ['south', 'west'], dominant: false },
};

interface CompassRow {
  /** Quest id in QUESTS. */
  id: string;
  /** The direction word the quest text must contain, as a whole word. */
  word: keyof typeof WORD_CLAIM;
  /** The point the SENTENCE anchors its claim to, named per row. */
  from: Point;
  /** The real placement, read from live content; `target` says which. */
  to: Point;
  /** Where `to` came from, so a moved camp is traceable from the failure. */
  target: string;
  /**
   * A second component the sentence itself names. Present only where the
   * prose spells out both axes with a cardinal word, which retires the
   * dominance half of that word (one row, q_old_cragmaw, documented there).
   */
  alsoClaims?: Component;
}

/** A zone's hub center: "town" in Vale prose, "Highwatch" in Thornpeak's. */
function hub(zoneId: string): Point {
  const zone = ZONES.find((z) => z.id === zoneId);
  if (!zone) throw new Error(`no zone ${zoneId}`);
  return { x: zone.hub.x, z: zone.hub.z };
}

function poi(zoneId: string, poiId: string): Point {
  const zone = ZONES.find((z) => z.id === zoneId);
  const found = zone?.pois.find((p) => p.id === poiId);
  if (!found) throw new Error(`no poi ${poiId} in ${zoneId}`);
  return { x: found.x, z: found.z };
}

/** The nth camp of a mob in source order (`index` 0 is "the first camp"). */
function camp(mobId: string, index = 0): Point {
  const centers = CAMPS.filter((c) => c.mobId === mobId).map((c) => c.center);
  if (centers.length <= index) {
    throw new Error(`no camp ${index} for ${mobId} (found ${centers.length})`);
  }
  return centers[index];
}

function dungeonDoor(dungeonId: string): Point {
  const def = DUNGEONS[dungeonId];
  if (!def) throw new Error(`no dungeon ${dungeonId}`);
  return def.doorPos;
}

const VALE = 'eastbrook_vale';
const PEAKS = 'thornpeak_heights';

const ROWS: readonly CompassRow[] = [
  // "There are ore veins in the rocks around the Copper Dig, southeast of
  // town": anchored on town, as the sentence says, and pointed at the POI it
  // names (src/sim/content/zone1.ts, ZONE1_ZONE.pois copper_dig).
  {
    id: 'q_prof_intro',
    word: 'southeast',
    from: hub(VALE),
    to: poi(VALE, 'copper_dig'),
    target: 'the copper_dig POI',
  },
  // "The crates are stacked around their camp in the southwest hills": the
  // camp is the bandits' own (zone1.ts ZONE1_CAMPS vale_bandit, first entry);
  // the crate objects themselves sit in the same quadrant.
  {
    id: 'q_supplies',
    word: 'southwest',
    from: hub(VALE),
    to: camp('vale_bandit'),
    target: 'the first vale_bandit camp',
  },
  // "Take two strong companions into the western meadow": Mogger's one camp
  // (zone1.ts ZONE1_CAMPS mogger, count 1).
  {
    id: 'q_mogger',
    word: 'western',
    from: hub(VALE),
    to: camp('mogger'),
    target: "Mogger's camp",
  },
  // "Cull the webwood spiders crowding the eastern woods": the spiders have
  // exactly one camp (zone1.ts ZONE1_CAMPS webwood_spider).
  {
    id: 'q_prof_amends_outfitter',
    word: 'eastern',
    from: hub(VALE),
    to: camp('webwood_spider'),
    target: 'the webwood_spider camp',
  },
  // "Go thin the wild boars in the west meadow": the boars' first camp
  // (zone1.ts ZONE1_CAMPS wild_boar), the one the meadow POI sits in.
  {
    id: 'q_prof_amends_apothecary',
    word: 'west',
    from: hub(VALE),
    to: camp('wild_boar'),
    target: 'the first wild_boar camp',
  },
  // "Its den sits on the eastern ridge above the road south": the den is
  // old_cragmaw's one camp (zone3.ts ZONE3_CAMPS). This is the row that needs
  // the alsoClaims escape and it earns it in the prose: from Highwatch the den
  // is 82 yd east and 85 yd south, so the bearing is southeast by a hair, and
  // the sentence NAMES that southward leg ("above the road south") instead of
  // claiming a pure eastern heading. Both stated components are checked; what
  // is dropped is only the dominance the prose never claimed.
  {
    id: 'q_old_cragmaw',
    word: 'eastern',
    from: hub(PEAKS),
    to: camp('old_cragmaw'),
    target: "old_cragmaw's camp",
    alsoClaims: 'south',
  },
  // "The visions point to the abandoned crypt in the eastern cliff": the
  // overworld door of the crypt instance (content/dungeons.ts
  // nythraxis_crypt.doorPos), which is the mine entrance zone3 dresses at the
  // same point. The keystone droppers spawn INSIDE the instance and have no
  // overworld camp, so the door is the only world coordinate this claim has.
  {
    id: 'q_nythraxis_sealed_crypt',
    word: 'eastern',
    from: hub(PEAKS),
    to: dungeonDoor('nythraxis_crypt'),
    target: "the Abandoned Crypt's overworld door",
  },
  // CONTROL ROWS: already-correct claims the phase did not have to touch.
  // They are here so a convention flip, a sign slip in the checks below, or a
  // camp migration cannot quietly turn this file into a table of one-sided
  // passes.
  {
    id: 'q_spiders',
    word: 'eastern',
    from: hub(VALE),
    to: camp('webwood_spider'),
    target: 'the webwood_spider camp',
  },
  {
    id: 'q_bandits',
    word: 'southwest',
    from: hub(VALE),
    to: camp('vale_bandit'),
    target: 'the first vale_bandit camp',
  },
  {
    id: 'q_boars',
    word: 'west',
    from: hub(VALE),
    to: camp('wild_boar'),
    target: 'the first wild_boar camp',
  },
  // DELIBERATELY NOT A ROW: q_nythraxis_graves. Its one sentence carries THREE
  // claims against three different graves ("the western rise", "further south
  // along the western edge", "the eastern cliff"), so a single word plus a
  // single target cannot represent it; a row shape that could would have to
  // parse the sentence. All three graves were verified by hand against
  // ZONE3_OBJECTS during the phase (west, west-and-further-south, east) and
  // are left to that record rather than half-checked here.
];

/** True when the delta really carries the claimed component. */
function componentHolds(component: Component, dx: number, dz: number): boolean {
  switch (component) {
    case 'east':
      return dx < 0;
    case 'west':
      return dx > 0;
    case 'north':
      return dz > 0;
    case 'south':
      return dz < 0;
  }
}

/** Whether a cardinal's own axis is the dominant one in the delta. */
function componentDominates(component: Component, dx: number, dz: number): boolean {
  return component === 'east' || component === 'west'
    ? Math.abs(dx) >= Math.abs(dz)
    : Math.abs(dz) >= Math.abs(dx);
}

describe('quest direction words match the world (the compass-truth guard)', () => {
  for (const row of ROWS) {
    it(`${row.id} says "${row.word}" and ${row.target} really is`, () => {
      const quest = QUESTS[row.id];
      expect(quest, `${row.id} must exist in QUESTS`).toBeTruthy();
      // (a) the word is still in the prose, as a WHOLE word: a bare substring
      // test would let "southwest" satisfy a "west" claim.
      expect(
        new RegExp(`\\b${row.word}\\b`, 'i').test(quest.text),
        `${row.id} text must still contain the word "${row.word}"`,
      ).toBe(true);
      // (b) the bearing from the sentence's own anchor to the real placement.
      const dx = row.to.x - row.from.x;
      const dz = row.to.z - row.from.z;
      expect(dx !== 0 || dz !== 0, `${row.id}: reference and target coincide`).toBe(true);
      const claim = WORD_CLAIM[row.word];
      const claims: Component[] = [...claim.claims];
      if (row.alsoClaims) claims.push(row.alsoClaims);
      for (const component of claims) {
        expect(
          componentHolds(component, dx, dz),
          `${row.id}: "${row.word}" claims ${component}, but ${row.target} lies at ` +
            `dx ${dx} dz ${dz} from the reference (east is -X, north is +Z)`,
        ).toBe(true);
      }
      // A cardinal must also dominate, unless the prose itself named the other
      // axis (row.alsoClaims), in which case it was never a pure cardinal.
      if (claim.dominant && !row.alsoClaims) {
        const [only] = claim.claims;
        expect(
          componentDominates(only, dx, dz),
          `${row.id}: "${row.word}" reads as a cardinal, but dx ${dx} dz ${dz} makes ` +
            `${row.target} more of an intercardinal from the reference`,
        ).toBe(true);
      }
    });
  }

  it('the table is non-vacuous: every claim word is exercised in both signs', () => {
    // Guards the shape of the table itself. A table that had drifted to
    // all-eastern rows would still pass every row above while proving nothing
    // about the west arm of the convention, which is precisely the axis the
    // mirrored-claim bug lived on.
    const words = new Set(ROWS.map((r) => r.word));
    expect(words.has('west') || words.has('western')).toBe(true);
    expect(words.has('eastern')).toBe(true);
    expect(words.has('southwest')).toBe(true);
    expect(words.has('southeast')).toBe(true);
    const dxs = ROWS.map((r) => r.to.x - r.from.x);
    expect(dxs.some((dx) => dx > 0)).toBe(true);
    expect(dxs.some((dx) => dx < 0)).toBe(true);
    expect(ROWS.length).toBeGreaterThanOrEqual(10);
  });
});

describe('the world direction convention this table reads by', () => {
  // Build two structurally distinct IWorld stubs the same way
  // tests/continent_map_view.test.ts does: the core reads only the player
  // position off the seam.
  function worldAt(x: number, z: number): IWorld {
    return {
      player: { id: 1, kind: 'player', name: 'Me', pos: { x, z }, facing: 0 },
      entities: new Map(),
      socialInfo: null,
      delveRun: null,
      cfg: { seed: 42, playerClass: 'warrior' },
      playerId: 1,
      questState: () => 'unavailable',
      questLog: new Map(),
    } as unknown as IWorld;
  }

  it('the continent map projects +X to map-left (west) and +Z to map-up (north)', () => {
    // Pinned as ARITHMETIC, not as the module comment that states it: a
    // comment-stripped source pin cannot see a projection flip, and flipping
    // one of these two subtractions is exactly what would make every row in
    // the table above assert the mirror image of what it means to.
    const model = (x: number, z: number) =>
      buildContinentMapModel({
        world: worldAt(x, z),
        canvasSize: 560,
        contentAspect: 0.5,
        hoveredZoneId: null,
      });
    const origin = model(0, 0).player;
    const plusX = model(40, 0).player;
    const plusZ = model(0, 40).player;
    if (!origin || !plusX || !plusZ) throw new Error('marker must be inside the world bounds');
    // Greater X paints further LEFT, which is west on any map read with north
    // at the top; the vertical axis is untouched by an X step.
    expect(plusX.mx).toBeLessThan(origin.mx);
    expect(plusX.my).toBeCloseTo(origin.my, 10);
    // Greater Z paints further UP, so +Z is north.
    expect(plusZ.my).toBeLessThan(origin.my);
    expect(plusZ.mx).toBeCloseTo(origin.mx, 10);
  });

  it('the compass strip calls a -X heading east and a +Z heading north', () => {
    // The other end of the same convention, through the live helpers rather
    // than restated here: facingToward builds the yaw from a delta
    // (src/sim/eastbrook_layout.ts), bearingDegrees and headingLabel turn that
    // yaw into what the HUD strip shows the player (src/ui/compass.ts), and
    // pointAtYaw walks the yaw back out to a world step.
    const origin = { x: 0, z: 0 };
    const rose: [Point, number, string][] = [
      [{ x: -1, z: 0 }, 90, 'E'],
      [{ x: 1, z: 0 }, 270, 'W'],
      [{ x: 0, z: 1 }, 0, 'N'],
      [{ x: 0, z: -1 }, 180, 'S'],
    ];
    for (const [toward, bearing, label] of rose) {
      const yaw = facingToward(origin, toward);
      expect(bearingDegrees(yaw)).toBeCloseTo(bearing, 10);
      expect(headingLabel(bearingDegrees(yaw))).toBe(label);
      // And the yaw the strip labels that way really steps that way in the
      // world: 10 yd along it lands 10 yd down the delta it was built from.
      const step = pointAtYaw(origin, yaw, 10);
      expect(step.x).toBeCloseTo(toward.x * 10, 10);
      expect(step.z).toBeCloseTo(toward.z * 10, 10);
    }
  });
});

describe('the guide twins of audited direction claims (the wiki cannot drift alone)', () => {
  // The compass rows above resolve QUESTS text only; these two guide strings
  // carry the SAME world claims and were hand-fixed in the same phase, so
  // without an arm here the next reword reds the quest row while the wiki
  // silently disagrees again (the guard header's own failure mode).
  it('professions.startBody points at the Copper Dig with the quest row word', () => {
    const row = ROWS.find((r) => r.id === 'q_prof_intro');
    expect(row).toBeDefined();
    const word = (row as CompassRow).word;
    // The same WHOLE word as the quest sentence: shared truth, not a copy.
    expect(new RegExp(`\\b${word}\\b`, 'i').test(guideStrings.professions.startBody)).toBe(true);
    expect(new RegExp(`\\b${word}\\b`, 'i').test(QUESTS.q_prof_intro.text)).toBe(true);
  });

  it('craftProse.cooking.ladderBody puts the kitchens on the side they stand', () => {
    // "the Eastbrook kitchens on the east side of the square": the station
    // record is the placement truth, the hub anchors "the square" exactly as
    // every other Eastbrook row anchors "town". \beast\b cannot match inside
    // "southeast" (the h is a word character), so the whole-word test is
    // honest.
    const body = guideStrings.profPages.craftProse.cooking.ladderBody;
    expect(/\beast side of the square\b/.test(body)).toBe(true);
    const kitchens = EASTBROOK_STATIONS_BY_ID.station_eastbrook_kitchens;
    expect(kitchens).toBeDefined();
    const from = hub(VALE);
    const dx = kitchens.position.x - from.x;
    const dz = kitchens.position.z - from.z;
    expect(componentHolds('east', dx, dz), `kitchens at dx ${dx} dz ${dz} (east is -X)`).toBe(true);
    // NO dominance arm: "the east side of the square" claims a side, not a
    // bearing. The station stands a hair NORTH of the exact northeast
    // diagonal (|dz| exceeds |dx| by 4 mm, deterministically: the position
    // is localToWorld of fixed constants), so a dominance requirement would
    // fail every run while adding no truth to the side claim.
  });
});
