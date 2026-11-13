// A zone's own sun (src/render/zone_sun_core.ts, zone_sun.ts): the arc turned about the
// vertical and stood higher or lower at noon, eased across zone borders, and the shared
// arc exactly as it was for a zone that asks for nothing.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CELESTIAL_NOON_ELEVATION_DEG,
  moonDirection,
  sunDirection,
} from '../src/render/day_night_core';
import { BIOME_LIGHT } from '../src/render/outdoor_biome_presets';
import { ZONE_SUN } from '../src/render/palette_lab/zone_look_core';
import {
  easeZoneSun,
  resetZoneSun,
  ZONE_SUN_RESPONSE,
  zoneCelestial,
} from '../src/render/zone_sun';
import {
  easeAngleDeg,
  easeToward,
  foldDegrees,
  turnAboutVertical,
} from '../src/render/zone_sun_core';
import { ZONES } from '../src/sim/data';

const elevationOf = (dir: readonly number[]) => (Math.asin(dir[1]) * 180) / Math.PI;
const azimuthOf = (dir: readonly number[]) => (Math.atan2(dir[0], dir[2]) * 180) / Math.PI;

describe('zone sun arithmetic', () => {
  it('folds angles into (-180, 180] and eases the short way round', () => {
    expect(foldDegrees(190)).toBe(-170);
    expect(foldDegrees(-190)).toBe(170);
    expect(foldDegrees(540)).toBe(180);
    expect(foldDegrees(-180)).toBe(180);
    // 315 to 45 is 90 degrees through north, not 270 the long way
    expect(easeAngleDeg(315, 45, 0.5)).toBeCloseTo(360, 9);
    expect(easeAngleDeg(10, 350, 0.5)).toBeCloseTo(0, 9);
    expect(easeAngleDeg(0, 90, 0)).toBe(0);
    expect(easeAngleDeg(0, 90, 2)).toBe(90);
    expect(easeToward(41, 52, 0.25)).toBeCloseTo(43.75, 9);
  });

  it('turns a direction about the vertical from +z toward +x and keeps its height', () => {
    const turned = turnAboutVertical([0, 0.6, 0.8], 90);
    expect(turned[0]).toBeCloseTo(0.8, 12);
    expect(turned[1]).toBe(0.6);
    expect(turned[2]).toBeCloseTo(0, 12);
    expect(turnAboutVertical([0.1, 0.2, 0.3], 0)).toEqual([0.1, 0.2, 0.3]);
    const back = turnAboutVertical(turnAboutVertical([0.3, 0.5, -0.2], 137), -137);
    expect(back[0]).toBeCloseTo(0.3, 12);
    expect(back[2]).toBeCloseTo(-0.2, 12);
  });
});

describe('sunDirection with a zone turn and noon height', () => {
  it('is the shared arc, bit for bit, when a zone asks for nothing', () => {
    expect(CELESTIAL_NOON_ELEVATION_DEG).toBeCloseTo(41.1859, 3);
    for (const phase of [0, 0.1, 0.25, 0.4, 0.5, 0.74, 0.9]) {
      const stock = sunDirection(phase);
      // a hair off the stock height takes the general branch and must land on the same arc
      const general = sunDirection(phase, 0, CELESTIAL_NOON_ELEVATION_DEG + 1e-9);
      for (let i = 0; i < 3; i++) expect(general[i]).toBeCloseTo(stock[i], 9);
      // the shared arc itself: tilted toward +z, 0.28 high
      const a = (phase - 0.25) * 2 * Math.PI;
      const len = Math.hypot(Math.cos(a), Math.sin(a) * 0.28, 0.32);
      expect(stock[0]).toBeCloseTo(Math.cos(a) / len, 12);
      expect(stock[1]).toBeCloseTo((Math.sin(a) * 0.28) / len, 12);
      expect(stock[2]).toBeCloseTo(0.32 / len, 12);
    }
  });

  it('stands the noon sun at the asked elevation and azimuth, still a unit vector', () => {
    for (const [turn, elev] of [
      [0, 52],
      [90, 52],
      [180, 52],
      [225, 60],
      [315, 30],
    ]) {
      const noon = sunDirection(0.5, turn, elev);
      expect(Math.hypot(...noon)).toBeCloseTo(1, 12);
      expect(elevationOf(noon)).toBeCloseTo(elev, 6);
      expect(foldDegrees(azimuthOf(noon) - turn)).toBeCloseTo(0, 6);
    }
  });

  it('keeps dawn and dusk on the horizon and the moon opposite the sun under any turn', () => {
    for (const turn of [0, 90, 180, 270]) {
      expect(sunDirection(0.25, turn, 52)[1]).toBeCloseTo(0, 9);
      expect(sunDirection(0.75, turn, 52)[1]).toBeCloseTo(0, 9);
      expect(sunDirection(0, turn, 52)[1]).toBeLessThan(-0.5);
      expect(moonDirection(0, turn, 52)).toEqual(sunDirection(0.5, turn, 52));
    }
  });

  it('clamps a silly noon height instead of throwing the sun under the ground', () => {
    expect(elevationOf(sunDirection(0.5, 0, 200))).toBeCloseTo(80, 6);
    expect(elevationOf(sunDirection(0.5, 0, -5))).toBeCloseTo(10, 6);
  });
});

describe('the eased zone sun', () => {
  beforeEach(() => resetZoneSun());

  it('opens on its zone at once and then swings to the next zone over seconds', () => {
    expect({ ...easeZoneSun({ sunTurn: 315, sunElev: 52 }, 0.016) }).toEqual({
      turn: 315,
      elev: 52,
    });
    // a frame later, a zone asking for 45: a small step, through north
    const step = easeZoneSun({ sunTurn: 45, sunElev: 52 }, 0.1);
    const k = 1 - Math.exp(-ZONE_SUN_RESPONSE * 0.1);
    // (the eased turn is kept folded into (-180, 180], so compare the angles, not the numbers)
    expect(foldDegrees(step.turn - (315 + 90 * k))).toBeCloseTo(0, 9);
    expect(foldDegrees(step.turn - 315)).toBeGreaterThan(0);
    // after twenty seconds it has all but arrived (405 is 45 the short way round)
    let last = step;
    for (let i = 0; i < 200; i++) last = easeZoneSun({ sunTurn: 45, sunElev: 41 }, 0.1);
    expect(foldDegrees(last.turn - 45)).toBeCloseTo(0, 1);
    expect(last.elev).toBeCloseTo(41, 1);
  });

  it('reads a row with no zone sun as the shared arc, and a stalled clock moves nothing', () => {
    expect({ ...easeZoneSun({}, 0.016) }).toEqual({ turn: 0, elev: CELESTIAL_NOON_ELEVATION_DEG });
    const held = { ...easeZoneSun({ sunTurn: 180, sunElev: 60 }, 0) };
    expect(held).toEqual({ turn: 0, elev: CELESTIAL_NOON_ELEVATION_DEG });
    expect({ ...easeZoneSun({ sunTurn: 180, sunElev: 60 }, -5) }).toEqual(held);
  });
});

describe('the renderer call', () => {
  beforeEach(() => resetZoneSun());

  it('hands back the zone sun and moon for the phase, the same arrays the core gives', () => {
    const row = { sunTurn: 225, sunElev: 52 };
    const sky = zoneCelestial(row, 0.016, 0.5);
    expect(sky.sun).toEqual(sunDirection(0.5, 225, 52));
    expect(sky.moon).toEqual(moonDirection(0.5, 225, 52));
    // by night the moon stands where the zone's noon sun stood
    const moonAtMidnight = zoneCelestial(row, 0.016, 0).moon;
    const noonSun = sunDirection(0.5, 225, 52);
    for (let i = 0; i < 3; i++) expect(moonAtMidnight[i]).toBeCloseTo(noonSun[i], 12);
  });

  it('keeps the eased turn folded however many times the zones wind it round', () => {
    easeZoneSun({ sunTurn: 0 }, 0.016);
    let turn = 0;
    for (let lap = 0; lap < 40; lap++) {
      for (const target of [120, 240, 0]) {
        for (let i = 0; i < 80; i++) turn = easeZoneSun({ sunTurn: target }, 0.25).turn;
      }
    }
    expect(Math.abs(turn)).toBeLessThanOrEqual(180);
    expect(foldDegrees(turn)).toBeCloseTo(0, 3);
  });

  it('is reset by a new renderer, in the constructor', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain('resetZoneSun();');
    expect(renderer).toContain(
      'const { sun: sd, moon: md } = zoneCelestial(BIOME_LIGHT[biome], dt, phase);',
    );
  });
});

describe('the zone sun table', () => {
  it('names real zones only, with sane turns and noon heights', () => {
    const ids = new Set(ZONES.map((zone) => zone.id));
    for (const [zone, sun] of Object.entries(ZONE_SUN)) {
      expect(ids.has(zone), zone).toBe(true);
      expect(sun.turn).toBeGreaterThanOrEqual(0);
      expect(sun.turn).toBeLessThan(360);
      expect(sun.elev).toBeGreaterThanOrEqual(30);
      expect(sun.elev).toBeLessThanOrEqual(65);
    }
    // the two zones left on the shared arc stay on it
    expect(ZONE_SUN.wraithwood).toBeUndefined();
    expect(ZONE_SUN.nightbloom).toBeUndefined();
    expect(ZONE_SUN.evergarden).toEqual({ turn: 180, elev: 52 });
  });

  it('ships no zone sun in the stock light table: the palette runtime writes it per zone', () => {
    for (const row of Object.values(BIOME_LIGHT)) {
      expect(row.sunTurn).toBeUndefined();
      expect(row.sunElev).toBeUndefined();
    }
  });
});
