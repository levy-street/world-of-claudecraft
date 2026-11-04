// The /daynight dev scrub and the offline sim's day/night clock
// (src/game/daynight_dev_command.ts).
//
// The claim worth pinning is the one that spans two systems: the OFFLINE sim's clock must
// follow the same override the sky follows, or `/daynight night` darkens the world while
// the world boss keeps standing in what the sim believes is noon.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DAY_NIGHT_PRESETS,
  MOON_PRESETS,
  offlineDayNightNowMs,
  parsePhaseArg,
  tryDayNightDevCommand,
} from '../src/game/daynight_dev_command';
import {
  currentLunarPhase,
  currentMoonSky,
  dayNightPhaseOverride,
  setDayNightPhaseOverride,
  setLunarPhaseOverride,
  setMoonLatitudeOverride,
} from '../src/render/day_night_clock';
import { lunarPhase } from '../src/render/day_night_core';
import { moonLatitudeDeg } from '../src/render/twin_moons_core';
import {
  cyclePhase,
  DAWN_PHASE,
  DAY_NIGHT_CYCLE_MS,
  DUSK_PHASE,
  isDaylightPhase,
} from '../src/sim/day_night';

function deps() {
  return { log: vi.fn(), refreshDayNightDial: vi.fn() };
}

afterEach(() => {
  setDayNightPhaseOverride(null);
  setLunarPhaseOverride(null);
});

describe('phase words', () => {
  it('name the same instants the sim calls dawn and dusk', () => {
    expect(DAY_NIGHT_PRESETS.dawn).toBe(DAWN_PHASE);
    expect(DAY_NIGHT_PRESETS.dusk).toBe(DUSK_PHASE);
    expect(isDaylightPhase(DAY_NIGHT_PRESETS.day)).toBe(true);
    expect(isDaylightPhase(DAY_NIGHT_PRESETS.night)).toBe(false);
  });

  it('parse a preset, a number (wrapped), and refuse noise', () => {
    expect(parsePhaseArg('noon', DAY_NIGHT_PRESETS)).toBe(0.5);
    expect(parsePhaseArg('0.3', DAY_NIGHT_PRESETS)).toBeCloseTo(0.3, 9);
    expect(parsePhaseArg('1.25', DAY_NIGHT_PRESETS)).toBeCloseTo(0.25, 9);
    expect(parsePhaseArg('-0.25', DAY_NIGHT_PRESETS)).toBeCloseTo(0.75, 9);
    expect(parsePhaseArg('full', MOON_PRESETS)).toBe(0.5);
    expect(parsePhaseArg('teatime', DAY_NIGHT_PRESETS)).toBeNull();
  });
});

describe('the offline sim clock', () => {
  it('is the real clock with no override, and the override when one is set', () => {
    const before = Date.now();
    const real = offlineDayNightNowMs();
    expect(real).toBeGreaterThanOrEqual(before);
    expect(real).toBeLessThanOrEqual(Date.now());
    setDayNightPhaseOverride(0.9);
    expect(cyclePhase(offlineDayNightNowMs())).toBeCloseTo(0.9, 5);
    setDayNightPhaseOverride(null);
    expect(offlineDayNightNowMs()).toBeGreaterThanOrEqual(before);
  });
});

describe('the command', () => {
  it('ignores ordinary chat', () => {
    const d = deps();
    expect(tryDayNightDevCommand('hello there', d)).toBe(false);
    expect(tryDayNightDevCommand('/say night', d)).toBe(false);
    expect(d.log).not.toHaveBeenCalled();
  });

  it('scrubs the shared override, which is what the sim clock then reads', () => {
    const d = deps();
    expect(tryDayNightDevCommand('/daynight night', d)).toBe(true);
    expect(dayNightPhaseOverride()).toBe(0);
    expect(isDaylightPhase(cyclePhase(offlineDayNightNowMs()))).toBe(false);
    expect(d.refreshDayNightDial).toHaveBeenCalledTimes(1);
    expect(tryDayNightDevCommand('/dev time 0.5', d)).toBe(true);
    expect(dayNightPhaseOverride()).toBe(0.5);
    expect(isDaylightPhase(cyclePhase(offlineDayNightNowMs()))).toBe(true);
    expect(tryDayNightDevCommand('/daynight auto', d)).toBe(true);
    expect(dayNightPhaseOverride()).toBeNull();
  });

  it('consumes bad input with a usage line rather than sending it to chat', () => {
    const d = deps();
    expect(tryDayNightDevCommand('/daynight teatime', d)).toBe(true);
    expect(d.log).toHaveBeenCalledTimes(1);
    expect(dayNightPhaseOverride()).toBeNull();
    expect(tryDayNightDevCommand('/daynight', d)).toBe(true);
    expect(d.log).toHaveBeenCalledTimes(3);
  });
});

describe('the moon eclipse scrub', () => {
  afterEach(() => {
    setMoonLatitudeOverride(null);
    vi.useRealTimers();
  });

  // a fixed instant, so "the real orbit" is one number to compare against
  const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
  const realLatitude = () => moonLatitudeDeg(NOW / DAY_NIGHT_CYCLE_MS);
  const realPhase = () => lunarPhase(NOW);

  it('pins a full moon onto the sun path (a total eclipse), and auto releases both pins', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const d = deps();
    expect(tryDayNightDevCommand('/daynight moon eclipse', d)).toBe(true);
    expect(currentLunarPhase()).toBe(MOON_PRESETS.full);
    const sky = currentMoonSky(0);
    expect(sky.latitudeDeg).toBe(0);
    expect(sky.umbra).toBeCloseTo(1, 9);
    expect(sky.mageCover).toBeCloseTo(1, 9);
    expect(tryDayNightDevCommand('/daynight moon auto', d)).toBe(true);
    expect(currentLunarPhase()).toBeCloseTo(realPhase(), 9);
    expect(currentMoonSky(0).latitudeDeg).toBeCloseTo(realLatitude(), 9);
  });

  it('every release word and a bare /daynight moon clear both pins', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const release of ['/daynight moon off', '/daynight moon clear', '/daynight moon']) {
      const d = deps();
      tryDayNightDevCommand('/daynight moon eclipse', d);
      expect(tryDayNightDevCommand(release, d)).toBe(true);
      expect(currentLunarPhase(), release).toBeCloseTo(realPhase(), 9);
      expect(currentMoonSky(0).latitudeDeg, release).toBeCloseTo(realLatitude(), 9);
    }
  });

  it('a plain moon phase after an eclipse puts the moon back on its real orbit', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const d = deps();
    tryDayNightDevCommand('/daynight moon eclipse', d);
    expect(tryDayNightDevCommand('/daynight moon crescent', d)).toBe(true);
    expect(currentLunarPhase()).toBe(MOON_PRESETS.crescent);
    expect(currentMoonSky(0).latitudeDeg).toBeCloseTo(realLatitude(), 9);
  });

  it('an unknown moon word leaves an eclipse pinned', () => {
    const d = deps();
    tryDayNightDevCommand('/daynight moon eclipse', d);
    expect(tryDayNightDevCommand('/daynight moon teatime', d)).toBe(true);
    expect(currentLunarPhase()).toBe(MOON_PRESETS.full);
    expect(currentMoonSky(0).latitudeDeg).toBe(0);
  });
});
