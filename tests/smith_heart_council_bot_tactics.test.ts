// The Hammer Council raid bots' positioning (scripts/lib/heart_council_tactics.mjs,
// driven by scripts/heart_council_raid.mjs) mirrors the council's own geometry:
// where a bot hides from Mountain's Wrath, where it shares a Falling Rock and
// where it carries a Wake the Stone mark must hold under the SERVER's rules
// (src/sim/encounters/smith_heart/council_pillars.ts), or the bots measure a
// fight nobody can play. Every case here checks the script's answer with the
// sim's own function.

import { describe, expect, it } from 'vitest';
import {
  COUNCIL_REACH,
  coverSpots,
  faceDistance,
  parsePillar,
  pillarBetween,
  rockSpot,
  steer,
  wakeSpot,
} from '../scripts/lib/heart_council_tactics.mjs';
import { HAMMER_PIT, QUARRY_PILLAR_SPOTS } from '../src/sim/content/smith_heart_layout';
import {
  COUNCIL_ROLES,
  COUNCIL_SOUL_TEMPLATES,
  COUNCIL_TUNING,
  councilPillarOf,
  councilPillarRadius,
  councilPillarTemplate,
  councilSoulOf,
} from '../src/sim/encounters/smith_heart/council_ids';
import {
  riseSpotClear,
  pillarBetween as simPillarBetween,
} from '../src/sim/encounters/smith_heart/council_pillars';

/** A small deterministic generator for the sampled layouts. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const asSim = (p: { x: number; z: number; r: number }) => ({
  e: { pos: { x: p.x, z: p.z } },
  r: p.r,
});
const FLOOR = { x: HAMMER_PIT.x, z: HAMMER_PIT.z, rx: 46, rz: 40 };
const COLUMNS = QUARRY_PILLAR_SPOTS.map((s, i) => ({
  id: i + 1,
  x: s.x,
  z: s.z,
  r: COUNCIL_TUNING.columnR,
}));

describe('heart council tactics: the template ids', () => {
  it('reads every pillar and soul template the way council_ids does', () => {
    for (const risen of [false, true]) {
      for (let n = 1; n <= COUNCIL_TUNING.integrity; n++) {
        const tid = councilPillarTemplate(n, risen);
        const sim = councilPillarOf(tid);
        expect(parsePillar(tid)).toEqual({
          integrity: sim?.integrity,
          risen: sim?.risen,
          soul: null,
          r: councilPillarRadius(risen),
        });
      }
    }
    for (const tid of COUNCIL_SOUL_TEMPLATES) {
      const sim = councilSoulOf(tid);
      expect(COUNCIL_ROLES).toContain(sim?.role);
      expect(parsePillar(tid)).toEqual({
        integrity: sim?.pips,
        risen: sim?.risen,
        soul: sim?.role,
        r: councilPillarRadius(sim?.risen === true),
      });
    }
    expect(parsePillar('sh_council_rubble')).toBeNull();
    expect(parsePillar('sh_council_rise_spot')).toBeNull();
    expect(parsePillar('sh_council_soul_nobody_c_3')).toBeNull();
  });

  it('plans with the council tuning reaches', () => {
    expect(COUNCIL_REACH.columnR).toBe(COUNCIL_TUNING.columnR);
    expect(COUNCIL_REACH.risenR).toBe(COUNCIL_TUNING.risenR);
    expect(COUNCIL_REACH.rock).toBe(COUNCIL_TUNING.rockRadius);
    expect(COUNCIL_REACH.soulRock).toBe(COUNCIL_TUNING.soulRockReach);
    expect(COUNCIL_REACH.resonance).toBe(COUNCIL_TUNING.resonanceReach);
    expect(COUNCIL_REACH.pulse).toBe(COUNCIL_TUNING.pulseReach);
    expect(COUNCIL_REACH.riseGap).toBe(COUNCIL_TUNING.riseGap);
    expect(COUNCIL_REACH.riseClearOfBodies).toBe(COUNCIL_TUNING.riseClearOfBodies);
    expect(COUNCIL_REACH.riseKnock).toBe(COUNCIL_TUNING.riseKnockRadius);
    expect(COUNCIL_REACH.slabCrush).toBe(COUNCIL_TUNING.slabCrushReach);
    expect(COUNCIL_REACH.slabGrind).toBe(COUNCIL_TUNING.slabGrindReach);
    expect(COUNCIL_REACH.wrath).toBe(COUNCIL_TUNING.wrathRadius);
  });
});

describe('heart council tactics: cover from the Wrath and the Echo', () => {
  it('blocks the same sight lines as the server at its own pad', () => {
    const rand = lcg(7);
    for (let i = 0; i < 400; i++) {
      const pillars = Array.from({ length: 4 }, (_, k) => ({
        id: k,
        x: rand() * 60 - 30,
        z: rand() * 60 - 30,
        r: rand() < 0.5 ? COUNCIL_TUNING.columnR : COUNCIL_TUNING.risenR,
      }));
      const from = { x: rand() * 80 - 40, z: rand() * 80 - 40 };
      const to = { x: rand() * 80 - 40, z: rand() * 80 - 40 };
      const simPillars = pillars.map(asSim);
      const ours = pillarBetween(pillars, from, to);
      const sim = simPillarBetween(simPillars, from, to);
      expect(ours ? pillars.indexOf(ours) : -1).toBe(sim ? simPillars.indexOf(sim) : -1);
    }
  });

  it('hides every cover spot from every source under the server rule, outside the stone', () => {
    const rand = lcg(11);
    let spots = 0;
    for (let i = 0; i < 60; i++) {
      const sources = [{ x: HAMMER_PIT.x + rand() * 16 - 8, z: HAMMER_PIT.z + rand() * 16 - 8 }];
      // Mythic: an Echo from a soul pillar at the same time, sometimes.
      if (i % 3 === 0) sources.push({ x: COLUMNS[0].x, z: COLUMNS[0].z });
      const cover = i % 3 === 0 ? COLUMNS.slice(1) : COLUMNS;
      for (const p of cover) {
        for (const spot of coverSpots(p, cover, sources, 1.2)) {
          spots++;
          expect(faceDistance(p, spot)).toBeGreaterThan(1);
          for (const s of sources)
            expect(simPillarBetween(cover.map(asSim), s, spot)).not.toBeNull();
        }
      }
    }
    expect(spots).toBeGreaterThan(100);
  });

  it('keeps a Resonance carrier off the face it hides behind', () => {
    const source = { x: HAMMER_PIT.x, z: HAMMER_PIT.z };
    const spots = coverSpots(COLUMNS[2], COLUMNS, [source], COUNCIL_TUNING.resonanceReach + 1);
    expect(spots.length).toBeGreaterThan(0);
    for (const spot of spots) {
      expect(faceDistance(COLUMNS[2], spot)).toBeGreaterThan(COUNCIL_TUNING.resonanceReach);
      expect(simPillarBetween(COLUMNS.map(asSim), source, spot)).not.toBeNull();
    }
  });

  it('walks round a pillar in the way instead of into it', () => {
    const p = COLUMNS[0];
    const from = { x: p.x - 8, z: p.z };
    const goal = { x: p.x + 8, z: p.z };
    const wp = steer(from, goal, [p]);
    expect(wp).not.toEqual(goal);
    expect(simPillarBetween([asSim({ ...p, r: p.r + 0.5 })], from, wp)).toBeNull();
    expect(steer(from, { x: p.x - 8, z: p.z + 6 }, [p])).toEqual({ x: p.x - 8, z: p.z + 6 });
  });
});

describe('heart council tactics: the Falling Rock and Wake the Stone', () => {
  it('shares a rock where no cover pillar loses a piece', () => {
    const rand = lcg(5);
    for (let i = 0; i < 40; i++) {
      const from = { x: HAMMER_PIT.x + rand() * 30 - 15, z: HAMMER_PIT.z + rand() * 30 - 15 };
      const spot = rockSpot({ from, cover: COLUMNS, floor: FLOOR, home: from });
      expect(spot).not.toBeNull();
      if (!spot) continue;
      for (const p of COLUMNS)
        expect(faceDistance(p, spot)).toBeGreaterThan(COUNCIL_TUNING.rockRadius);
    }
  });

  it('on mythic, shares it inside a soul pillar pip reach and away from the rest', () => {
    const soul = { ...COLUMNS[1], soul: 'guardian' as const };
    const cover = COLUMNS.filter((p) => p.id !== soul.id);
    const spot = rockSpot({
      from: { x: HAMMER_PIT.x, z: HAMMER_PIT.z },
      cover,
      soul,
      floor: FLOOR,
    });
    expect(spot).not.toBeNull();
    if (!spot) return;
    expect(faceDistance(soul, spot)).toBeLessThanOrEqual(COUNCIL_TUNING.soulRockReach);
    for (const p of cover) expect(faceDistance(p, spot)).toBeGreaterThan(COUNCIL_TUNING.rockRadius);
    // The Walking Slab: outside its grind as well.
    const slab = { ...soul, soul: 'slabwright' as const };
    const s2 = rockSpot({
      from: { x: HAMMER_PIT.x, z: HAMMER_PIT.z },
      cover,
      soul: slab,
      floor: FLOOR,
    });
    expect(s2).not.toBeNull();
    if (s2) expect(faceDistance(slab, s2)).toBeGreaterThan(COUNCIL_TUNING.slabGrindReach);
  });

  it('carries a Wake mark between the holder and the raid, to a spot the server lets rise', () => {
    const holder = { x: HAMMER_PIT.x + 3, z: HAMMER_PIT.z };
    const raid = { x: HAMMER_PIT.x - 20, z: HAMMER_PIT.z };
    const bodies = [
      holder,
      { x: HAMMER_PIT.x + 3, z: HAMMER_PIT.z - 9 },
      { x: HAMMER_PIT.x + 3, z: HAMMER_PIT.z + 9 },
    ];
    for (const lane of [0, 7]) {
      const spot = wakeSpot({ holder, raid, pillars: COLUMNS, bodies, floor: FLOOR, lane });
      expect(spot).not.toBeNull();
      if (!spot) continue;
      expect(riseSpotClear(COLUMNS, bodies, spot.x, spot.z)).toBe(true);
      // Nearer the raid than the holder is: cover the raid can step behind.
      expect(Math.hypot(spot.x - raid.x, spot.z - raid.z)).toBeLessThan(
        Math.hypot(holder.x - raid.x, holder.z - raid.z),
      );
    }
  });
});
