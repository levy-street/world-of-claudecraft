import { describe, expect, it } from 'vitest';
import {
  ENTRY_CRASH_WINDOW_MS,
  ENTRY_PRESET_MIN,
  ENTRY_PROBE_KEY,
  parseProbe,
  planEntryCrashRecovery,
  serializeProbe,
  stepDownPreset,
} from '../src/game/entry_crash_guard';

const NOW = 1_700_000_000_000;

describe('entry crash guard: probe serialization', () => {
  it('round-trips a probe', () => {
    const raw = serializeProbe({ preset: 3, at: NOW });
    expect(parseProbe(raw)).toEqual({ preset: 3, at: NOW });
  });

  it('reads malformed and foreign values as no probe', () => {
    expect(parseProbe(null)).toBeNull();
    expect(parseProbe('')).toBeNull();
    expect(parseProbe('not json')).toBeNull();
    expect(parseProbe('42')).toBeNull();
    expect(parseProbe('{}')).toBeNull();
    expect(parseProbe('{"preset":"high","at":1}')).toBeNull();
    expect(parseProbe('{"preset":2}')).toBeNull();
    expect(parseProbe(`{"preset":null,"at":${NOW}}`)).toBeNull();
    expect(parseProbe(`{"preset":${Number.NaN},"at":${NOW}}`)).toBeNull();
  });

  it('pins the storage key other modules and devices rely on', () => {
    expect(ENTRY_PROBE_KEY).toBe('woc_entry_probe');
  });
});

describe('entry crash guard: stepDownPreset', () => {
  it('steps each tier down one', () => {
    expect(stepDownPreset(5)).toBe(4);
    expect(stepDownPreset(4)).toBe(3);
    expect(stepDownPreset(3)).toBe(2);
    expect(stepDownPreset(2)).toBe(1);
  });

  it('never goes below the low floor', () => {
    expect(stepDownPreset(1)).toBe(ENTRY_PRESET_MIN);
    expect(stepDownPreset(0)).toBe(ENTRY_PRESET_MIN);
    expect(stepDownPreset(-7)).toBe(ENTRY_PRESET_MIN);
  });

  it('clamps values above the settings range before stepping', () => {
    expect(stepDownPreset(99)).toBe(4);
  });
});

describe('entry crash guard: planEntryCrashRecovery', () => {
  it('recovers from a fresh crash probe with a one-tier step down', () => {
    const raw = serializeProbe({ preset: 2, at: NOW - 15_000 });
    expect(planEntryCrashRecovery(raw, NOW)).toEqual({ from: 2, to: 1, ageMs: 15_000 });
  });

  it('keeps the floor preset at the floor (still recovers, so the loop still breaks)', () => {
    const raw = serializeProbe({ preset: 1, at: NOW - 1_000 });
    expect(planEntryCrashRecovery(raw, NOW)).toEqual({ from: 1, to: 1, ageMs: 1_000 });
  });

  it('ignores a stale probe: a crash days ago says nothing about this boot', () => {
    const raw = serializeProbe({ preset: 3, at: NOW - ENTRY_CRASH_WINDOW_MS - 1 });
    expect(planEntryCrashRecovery(raw, NOW)).toBeNull();
  });

  it('honors a probe exactly at the window edge', () => {
    const raw = serializeProbe({ preset: 3, at: NOW - ENTRY_CRASH_WINDOW_MS });
    expect(planEntryCrashRecovery(raw, NOW)).toEqual({
      from: 3,
      to: 2,
      ageMs: ENTRY_CRASH_WINDOW_MS,
    });
  });

  it('ignores a probe from the future (clock went backwards)', () => {
    const raw = serializeProbe({ preset: 3, at: NOW + 60_000 });
    expect(planEntryCrashRecovery(raw, NOW)).toBeNull();
  });

  it('ignores missing or malformed probes', () => {
    expect(planEntryCrashRecovery(null, NOW)).toBeNull();
    expect(planEntryCrashRecovery('garbage', NOW)).toBeNull();
  });
});
