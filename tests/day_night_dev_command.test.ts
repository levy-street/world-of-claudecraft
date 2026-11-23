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
  dayNightPhaseOverride,
  setDayNightPhaseOverride,
  setLunarPhaseOverride,
} from '../src/render/day_night_clock';
import { cyclePhase, DAWN_PHASE, DUSK_PHASE, isDaylightPhase } from '../src/sim/day_night';

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
