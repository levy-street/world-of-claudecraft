// The Quartered Isle against the systems that key on zone records and zone
// ground: its biome survives a saved-map round trip, the Drakelands' ember
// scatter stays off the shore the isle claims, and a death on the isle
// releases at the isle's own graveyard.
import { describe, expect, it } from 'vitest';
import { liveWorldBaseline } from '../src/editor/live_world_core';
import { emberDressingSpots } from '../src/render/ember_features';
import { ALL_BIOME_IDS } from '../src/sim/biome_ids';
import { RIVALMOOT_GRAVEYARD_ID } from '../src/sim/content/graveyards';
import { OVERWORLD_GRAVEYARDS, ZONES, zoneAt } from '../src/sim/data';
import { emberLilySpots, emberScatterClear } from '../src/sim/ember_lilies';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import { CHALLENGERS_RING } from '../src/sim/quartered_isle_terrain';
import { QUARTERED_FROZEN_LAKES } from '../src/sim/quartered_landmarks';
import { nearestOverworldGraveyard } from '../src/sim/spirit';
import { groundHeight, WATER_LEVEL, ALL_BIOME_IDS as WORLD_BIOME_IDS } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import { WORLD_TOUCHUP_SOURCE } from '../src/sim/world_touchup.generated';

const isle = ZONES.find((zone) => zone.id === 'quartered_isle');
if (!isle) throw new Error('quartered_isle missing');
const onIsle = (p: { x: number; z: number }) => zoneAt(p.x, p.z) === isle;

describe('the runtime biome id list', () => {
  it('lists every zone biome the world ships, the quartered one included', () => {
    expect(ALL_BIOME_IDS).toContain('quartered');
    for (const zone of ZONES) expect(ALL_BIOME_IDS, zone.id).toContain(zone.biome);
    expect(new Set(ALL_BIOME_IDS).size).toBe(ALL_BIOME_IDS.length);
    // world.ts re-exports the same list (its callers import it from there)
    expect(WORLD_BIOME_IDS).toBe(ALL_BIOME_IDS);
  });

  it("keeps the isle's biome through the live-world document and its committed source", () => {
    const baseline = liveWorldBaseline();
    const live = baseline.content.zones.find((zone) => zone.id === 'quartered_isle');
    expect(live?.biome).toBe('quartered');
    expect(live?.claimsOverlap).toBe(true);
    const source = WORLD_TOUCHUP_SOURCE?.content.zones.find((zone) => zone.id === 'quartered_isle');
    expect(source?.biome).toBe('quartered');
    // ...and through one more save and load of that document
    const again = sanitizeMapDoc(JSON.parse(JSON.stringify(baseline)));
    expect(again?.content.zones.find((zone) => zone.id === 'quartered_isle')?.biome).toBe(
      'quartered',
    );
  });

  it('normalizes the optional column, arena and claim fields of an untrusted zone', () => {
    const doc = JSON.parse(JSON.stringify(liveWorldBaseline()));
    const zone = doc.content.zones.find((z: { id: string }) => z.id === 'quartered_isle');
    zone.biome = 'not-a-biome';
    zone.xMin = 'left';
    zone.xMax = 1e12;
    zone.hillArena = {};
    zone.claimsOverlap = 'yes';
    zone.waterSouthBorder = 1;
    const clean = sanitizeMapDoc(doc)?.content.zones.find((z) => z.id === 'quartered_isle');
    expect(clean?.biome).toBe('vale');
    expect(clean && 'xMin' in clean).toBe(false);
    expect(Number.isFinite(clean?.xMax)).toBe(true);
    expect(clean?.xMax).toBeLessThan(1e12);
    expect(clean?.hillArena).toBeUndefined();
    expect(clean?.claimsOverlap).toBeUndefined();
    expect(clean?.waterSouthBorder).toBeUndefined();
    // well-formed values pass through untouched
    const kept = sanitizeMapDoc(
      JSON.parse(JSON.stringify(liveWorldBaseline())),
    )?.content.zones.find((z) => z.id === 'quartered_isle');
    expect(kept?.xMin).toBe(isle.xMin);
    expect(kept?.xMax).toBe(isle.xMax);
    expect(kept?.hillArena).toEqual(isle.hillArena);
    expect(kept?.claimsOverlap).toBe(true);
  });
});

describe('Drakelands ember scatter on ground the isle claims', () => {
  it('refuses every point of the claimed east shore, and still accepts the Drakelands', () => {
    // dry isle ground inside the Drakelands' own column (x 180..250)
    let claimedDry = 0;
    for (let x = 200; x <= 248; x += 6) {
      for (let z = 1980; z <= 2400; z += 12) {
        if (!onIsle({ x, z }) || groundHeight(x, z, WORLD_SEED) < 1) continue;
        claimedDry++;
        expect(emberScatterClear(x, z), `${x},${z}`).toBe(false);
      }
    }
    expect(claimedDry).toBeGreaterThan(20);
    expect(emberLilySpots(WORLD_SEED).length).toBeGreaterThan(10);
  });

  it('grows no lily, crystal, egg or hoard on the isle', () => {
    expect(emberLilySpots(WORLD_SEED).filter(onIsle)).toEqual([]);
    const dressing = emberDressingSpots(WORLD_SEED) as unknown as Record<string, unknown>;
    let lists = 0;
    for (const [key, value] of Object.entries(dressing)) {
      if (!Array.isArray(value)) continue;
      lists++;
      expect((value as { x: number; z: number }[]).filter(onIsle), `${key} on the isle`).toEqual(
        [],
      );
    }
    expect(lists).toBeGreaterThanOrEqual(2);
  });
});

describe('deaths on the isle', () => {
  const rivalmoot = OVERWORLD_GRAVEYARDS.find((g) => g.id === RIVALMOOT_GRAVEYARD_ID);
  if (!rivalmoot) throw new Error('Rivalmoot graveyard missing');

  it('release at Rivalmoot from every dry cell, even where a mainland yard is closer', () => {
    let dry = 0;
    let mainlandCloser = 0;
    for (let x = -246; x <= 246; x += 6) {
      for (let z = 1966; z <= 2416; z += 6) {
        if (!onIsle({ x, z }) || groundHeight(x, z, WORLD_SEED) <= WATER_LEVEL) continue;
        dry++;
        const got = nearestOverworldGraveyard(x, z);
        expect(got, `${x},${z}`).toEqual({ x: rivalmoot.x, z: rivalmoot.z });
        const plain = OVERWORLD_GRAVEYARDS.reduce((a, b) =>
          Math.hypot(b.x - x, b.z - z) < Math.hypot(a.x - x, a.z - z) ? b : a,
        );
        if (plain !== rivalmoot) mainlandCloser++;
      }
    }
    expect(dry).toBeGreaterThan(1000);
    // the rule is load-bearing: a real share of the isle is nearer a mainland yard
    expect(mainlandCloser).toBeGreaterThan(dry * 0.1);
  });

  it('covers the outer frozen lakes and the arena by name', () => {
    for (const spot of [...QUARTERED_FROZEN_LAKES, CHALLENGERS_RING]) {
      expect(nearestOverworldGraveyard(spot.x, spot.z)).toEqual({ x: rivalmoot.x, z: rivalmoot.z });
    }
  });

  it('leaves every other zone on the plain nearest graveyard', () => {
    let checked = 0;
    for (const zone of ZONES) {
      if (zone === isle) continue;
      const x = zone.hub.x;
      const z = zone.hub.z;
      if (zoneAt(x, z) !== zone) continue;
      const plain = OVERWORLD_GRAVEYARDS.reduce((a, b) =>
        Math.hypot(b.x - x, b.z - z) < Math.hypot(a.x - x, a.z - z) ? b : a,
      );
      expect(nearestOverworldGraveyard(x, z), zone.id).toEqual({ x: plain.x, z: plain.z });
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
    // and a caller's own list with no yard on the isle falls back to the nearest
    const mainland = OVERWORLD_GRAVEYARDS.filter((g) => g !== rivalmoot);
    const got = nearestOverworldGraveyard(-170, 2036, mainland);
    expect(mainland.some((g) => g.x === got.x && g.z === got.z)).toBe(true);
  });
});
