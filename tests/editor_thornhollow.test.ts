// Thornhollow (src/editor/shipped_thornhollow.ts): the authored capture-the-flag
// map. These lock the things a maker cannot eyeball, that both halves are the
// same fight, that every slope inside the play area can actually be run, that
// the wooded walls cannot be climbed out of, and that every asset it places
// exists in the catalogue.

import { describe, expect, it } from 'vitest';
import { ASSET_CATALOG } from '../src/editor/asset_catalog.generated';
import { customMapToWorldContent } from '../src/editor/custom_map';
import { createShippedMap, SHIPPED_MAPS } from '../src/editor/shipped_maps';
import {
  TH_FLAG_Z,
  TH_HALF_X,
  TH_HALF_Z,
  TH_PLAY_HALF_X,
  TH_PLAY_HALF_Z,
  TH_POWER_RUNES,
  TH_SPEED_RUNES,
  thornhollowHeight,
  thornhollowMap,
  thornhollowPlacements,
} from '../src/editor/shipped_thornhollow';
import { isColliderAssetId } from '../src/sim/collider_volumes';
import { setActiveWorldContent } from '../src/sim/data';
import { MAX_LIGHTS, MAX_PLACEMENTS, MAX_TERRAIN_EDITS, sanitizeMapDoc } from '../src/sim/map_doc';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { terrainHeight } from '../src/sim/world';

const SEED = 20061;
const map = thornhollowMap('Thornhollow', 'test_thornhollow', 1);

/** Steepest rise/run at (x, z), sampled the way the movement kernel does. */
function slopeAt(x: number, z: number, h: (x: number, z: number) => number): number {
  const e = 0.5;
  return Math.hypot(h(x + e, z) - h(x - e, z), h(x, z + e) - h(x, z - e)) / (2 * e);
}

describe('thornhollow: the shipped map entry', () => {
  it('is listed as a battleground and opens through createShippedMap', async () => {
    const entry = SHIPPED_MAPS.find((m) => m.id === 'thornhollow');
    expect(entry).toEqual({
      id: 'thornhollow',
      name: 'Thornhollow',
      group: 'Battleground',
    });
    const opened = await createShippedMap('thornhollow', 'opened', 7);
    expect(opened.meta.name).toBe('Thornhollow');
    expect(opened.placements.length).toBe(map.placements.length);
  });

  it('stays inside every document cap', () => {
    expect(map.placements.length).toBeLessThanOrEqual(MAX_PLACEMENTS);
    expect(map.terrainEdits.length).toBeLessThanOrEqual(MAX_TERRAIN_EDITS);
    expect(map.lights?.length ?? 0).toBeLessThanOrEqual(MAX_LIGHTS);
    expect(map.placements.length).toBeGreaterThan(600);
  });

  it('places only catalogue assets and collider volumes', () => {
    const known = new Set(ASSET_CATALOG.map((a) => a.id));
    const unknown = [
      ...new Set(
        map.placements
          .map((p) => p.assetId)
          .filter((id) => !known.has(id) && !isColliderAssetId(id)),
      ),
    ];
    expect(unknown).toEqual([]);
  });

  it('survives the shared document sanitizer with everything intact', () => {
    const parsed = sanitizeMapDoc(JSON.parse(JSON.stringify(map)));
    expect(parsed).not.toBeNull();
    expect(parsed?.placements.length).toBe(map.placements.length);
    expect(parsed?.terrainEdits.length).toBe(map.terrainEdits.length);
    expect(parsed?.lights?.length).toBe(map.lights?.length);
    expect(parsed?.locations?.length).toBe(map.locations?.length);
    expect(parsed?.biomePaint?.custom?.length).toBe(6);
    // 255 is "unpainted": every cell must carry one of the map's own swatches.
    expect(parsed?.biomePaint?.ids.includes(255)).toBe(false);
    expect(parsed?.skybox).toBe(map.skybox);
    expect(parsed?.lighting).toEqual(map.lighting);
    // 'auto' is the sanitizer's default and drops out; the cloud deck is the
    // part that has to survive.
    expect(parsed?.weather?.clouds).toEqual(map.weather?.clouds);
  });

  it('keeps every placement inside the map rect', () => {
    const out = map.placements.filter(
      (p) => Math.abs(p.x) > TH_HALF_X || Math.abs(p.z) > TH_HALF_Z,
    );
    expect(out).toEqual([]);
  });
});

describe('thornhollow: the playable elements', () => {
  const roleOf = (role: string) => map.placements.filter((p) => p.regionRole === role);

  it('gives each team a flag, a spawn banner, five spawn spots and a graveyard', () => {
    for (const team of [0, 1]) {
      expect(roleOf(`flag${team}`)).toHaveLength(1);
      expect(roleOf(`banner${team}`)).toHaveLength(1);
      expect(roleOf(`spawn${team}`)).toHaveLength(5);
      expect(roleOf(`graveyard${team}`)).toHaveLength(1);
    }
  });

  it('carries the rune pads', () => {
    expect(roleOf('speedRune')).toHaveLength(TH_SPEED_RUNES.length);
    expect(roleOf('powerRune')).toHaveLength(TH_POWER_RUNES.length);
    expect(TH_SPEED_RUNES.length + TH_POWER_RUNES.length).toBe(10);
  });

  it('mirrors the two flags through the origin', () => {
    const [c] = roleOf('flag0');
    const [a] = roleOf('flag1');
    expect(c.x).toBeCloseTo(-a.x, 6);
    expect(c.z).toBeCloseTo(-a.z, 6);
    expect(Math.abs(c.z)).toBe(TH_FLAG_Z);
  });

  it('spawns the playtest player inside its own keep, behind the flag line', () => {
    const start = map.playerStart;
    expect(start).toBeTruthy();
    if (!start) return;
    expect(start.x).toBe(0);
    expect(start.z).toBeGreaterThan(-TH_FLAG_Z);
    expect(start.z).toBeLessThan(-100);
  });

  it('is point symmetric: every anchor has a twin at (-x, -z)', () => {
    const anchors = map.placements.filter((p) => p.regionRole !== undefined);
    const key = (x: number, z: number) => `${x.toFixed(3)},${z.toFixed(3)}`;
    const seen = new Set(anchors.map((p) => key(p.x, p.z)));
    const unpaired = anchors.filter((p) => !seen.has(key(-p.x, -p.z)));
    expect(unpaired.map((p) => p.name)).toEqual([]);
  });

  it('is point symmetric in its built geometry too', () => {
    // Scenery is authored through bothHalves()/mirrored(), so every non-anchor
    // placement that is not part of the (independently scattered) wood must
    // have a partner. The wood is deliberately asymmetric, it is scenery on
    // the slopes, never cover in the fight.
    const built = map.placements.filter(
      (p) =>
        p.regionRole === undefined &&
        !p.assetId.startsWith('foliage/') &&
        !['Rune pad', 'Rune glyph'].includes(p.name ?? ''),
    );
    const key = (x: number, z: number) => `${x.toFixed(2)},${z.toFixed(2)}`;
    const seen = new Set(built.map((p) => key(p.x, p.z)));
    const unpaired = built.filter((p) => !seen.has(key(-p.x, -p.z)));
    expect(unpaired.map((p) => `${p.name} @ ${p.x},${p.z}`)).toEqual([]);
  });

  it('leaves the keeps, the pit floor and the lanes clear of trees', () => {
    const trees = thornhollowPlacements().filter((p) => p.name === 'Tree');
    const blocking = trees.filter(
      (p) => Math.hypot(p.x, p.z) < 30 || (Math.abs(p.x) < 14 && Math.abs(p.z) < 120),
    );
    expect(blocking).toEqual([]);
  });
});

describe('thornhollow: the designed height field', () => {
  it('sinks the Fightpit and raises the keeps around the ravine floor', () => {
    expect(thornhollowHeight(0, 0)).toBeCloseTo(-9, 1);
    expect(thornhollowHeight(0, -TH_FLAG_Z)).toBeCloseTo(11, 1);
    expect(thornhollowHeight(0, TH_FLAG_Z)).toBeCloseTo(11, 1);
    // The ravine floor between the pit lip and the approach shelf.
    expect(Math.abs(thornhollowHeight(0, -60))).toBeLessThan(2);
  });

  it('keeps the keep plateaus dead flat, so walls and floor tiles seat true', () => {
    // The whole fortress footprint, not a sample of it: the curtain runs to
    // |x| = 46 and z = 135..181, the rampart decks are frozen to KEEP_TOP_Y,
    // and a plateau that sagged even a few centimetres under one of them would
    // float that wall or bury it. The margin covers the towers on the corners.
    for (let z = -183; z <= -133; z += 2) {
      for (let x = -48; x <= 48; x += 2) {
        expect(thornhollowHeight(x, z), `south keep at ${x},${z}`).toBeCloseTo(11, 3);
        expect(thornhollowHeight(-x, -z), `north keep at ${-x},${-z}`).toBeCloseTo(11, 3);
      }
    }
  });

  it('mirrors through the origin exactly', () => {
    for (const [x, z] of [
      [17, -80],
      [-52, 40],
      [64, 121],
      [0, -143],
      [33, 12],
    ]) {
      expect(thornhollowHeight(x, z)).toBeCloseTo(thornhollowHeight(-x, -z), 9);
    }
  });
});

// The document ships STAMPS, not a function: what the sim collides against and
// the renderer draws is the lerp chain in sim/world.ts applyStamp. These assert
// the ground a player actually stands on.
describe('thornhollow: the terrain a player stands on', () => {
  const withTerrain = (body: (h: (x: number, z: number) => number) => void): void => {
    setActiveWorldContent(customMapToWorldContent(map));
    try {
      body((x, z) => terrainHeight(x, z, SEED));
    } finally {
      setActiveWorldContent(null);
    }
  };

  it('tracks the designed field across the play area', () => {
    withTerrain((h) => {
      let worst = 0;
      for (let z = -TH_PLAY_HALF_Z; z <= TH_PLAY_HALF_Z; z += 3) {
        for (let x = -TH_PLAY_HALF_X; x <= TH_PLAY_HALF_X; x += 3) {
          worst = Math.max(worst, Math.abs(h(x, z) - thornhollowHeight(x, z)));
        }
      }
      expect(worst).toBeLessThan(1.5);
    });
  });

  it('gives each keep a flat floor at the same height', () => {
    withTerrain((h) => {
      const samples: number[] = [];
      for (const sz of [-1, 1]) {
        for (let z = 126; z <= 148; z += 4) {
          for (let x = -22; x <= 22; x += 4) samples.push(h(x, sz * z));
        }
      }
      expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(0.35);
      expect(samples[0]).toBeCloseTo(11, 0);
    });
  });

  it('sinks the Fightpit well below the ravine floor', () => {
    withTerrain((h) => {
      expect(h(0, 0)).toBeLessThan(-7.5);
      expect(h(0, -44)).toBeGreaterThan(h(0, 0) + 6);
    });
  });

  it('is runnable everywhere inside the play area', () => {
    withTerrain((h) => {
      let worst = 0;
      let at = '';
      for (let z = -TH_PLAY_HALF_Z + 2; z <= TH_PLAY_HALF_Z - 2; z += 2) {
        for (let x = -TH_PLAY_HALF_X + 2; x <= TH_PLAY_HALF_X - 2; x += 2) {
          const s = slopeAt(x, z, h);
          if (s > worst) {
            worst = s;
            at = `${x},${z}`;
          }
        }
      }
      expect({ worst: Number(worst.toFixed(2)), at }).toMatchObject({ at });
      expect(worst).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
    });
  });

  it('walls the hollow in: every way out crosses a bank nobody can climb', () => {
    withTerrain((h) => {
      // Walk outward from the play edge to the map edge along each escape line.
      // Somewhere on the way the bank must be too steep to climb, and it must
      // top out far above the field, so there is no route over it either.
      const escapes: { from: [number, number]; step: [number, number] }[] = [];
      for (const z of [-140, -120, -60, 0, 60, 120, 140]) {
        for (const sx of [-1, 1]) {
          escapes.push({ from: [sx * (TH_PLAY_HALF_X - 2), z], step: [sx, 0] });
        }
      }
      for (const x of [-60, -20, 0, 20, 60]) {
        for (const sz of [-1, 1]) {
          escapes.push({ from: [x, sz * (TH_PLAY_HALF_Z - 2)], step: [0, sz] });
        }
      }
      for (const esc of escapes) {
        let steepest = 0;
        let crest = -Infinity;
        for (let d = 0; d < 40; d += 0.5) {
          const x = esc.from[0] + esc.step[0] * d;
          const z = esc.from[1] + esc.step[1] * d;
          if (Math.abs(x) > TH_HALF_X || Math.abs(z) > TH_HALF_Z) break;
          steepest = Math.max(steepest, slopeAt(x, z, h));
          crest = Math.max(crest, h(x, z));
        }
        const where = `(${esc.from[0]},${esc.from[1]}) -> (${esc.step[0]},${esc.step[1]})`;
        expect({
          where,
          steep: steepest > PLAYER_MAX_CLIMB_SLOPE,
          high: crest > 24,
        }).toEqual({
          where,
          steep: true,
          high: true,
        });
      }
    });
  });

  it('stays near enough to a mirror that neither side has the high ground', () => {
    withTerrain((h) => {
      let worst = 0;
      for (let z = 0; z <= TH_PLAY_HALF_Z; z += 4) {
        for (let x = -TH_PLAY_HALF_X; x <= TH_PLAY_HALF_X; x += 4) {
          worst = Math.max(worst, Math.abs(h(x, z) - h(-x, -z)));
        }
      }
      expect(worst).toBeLessThan(0.6);
    });
  });
});

describe('thornhollow: the playtest projection', () => {
  it('projects a standalone blank world at the map rect', () => {
    const world = customMapToWorldContent(map);
    expect(world.presentationMode).toBe('blank');
    expect(world.worldHalfX).toBe(TH_HALF_X);
    expect(Math.min(...world.zones.map((z) => z.zMin))).toBe(-TH_HALF_Z);
    expect(Math.max(...world.zones.map((z) => z.zMax))).toBe(TH_HALF_Z);
    expect(world.playerStart).toEqual(map.playerStart);
    // The anchors are authoring markers, never collision the player runs into:
    // every projected volume is a 'plane', which does not block at all, it
    // raises walkable ground (the keeps' ramparts, stairs and flag podiums).
    // A box or sphere here would mean a spawn ring or a graveyard had become a
    // wall, which is the bug this line was written for.
    const volumes = world.colliderVolumes ?? [];
    expect(volumes.filter((v) => v.kind !== 'plane')).toEqual([]);
    expect(volumes.length).toBeGreaterThan(0);
    expect(world.biomePaint?.custom?.length).toBe(6);
  });
});

describe('thornhollow: names are our own', () => {
  it('carries no other studio’s trademarks', () => {
    const text = JSON.stringify([
      map.meta.name,
      map.meta.description,
      map.content.zones.map((z) => z.name),
      map.locations,
      map.placements.map((p) => p.name),
    ]).toLowerCase();
    for (const term of [
      'warsong',
      'silverwing',
      'gulch',
      'alliance',
      'horde',
      'azeroth',
      'blizzard',
      'warcraft',
      'frostwolf',
      'stormpike',
      'arathi',
      'orgrimmar',
      'stormwind',
    ]) {
      expect(text).not.toContain(term);
    }
  });
});
