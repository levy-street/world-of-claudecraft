import { describe, expect, it } from 'vitest';
import {
  DEVICE_MEMORY_GB_KEY,
  deviceMemoryGbFromBytes,
  ENTRY_TIGHT_MODE_KEY,
  ENTRY_TIGHT_MODE_WINDOW_MS,
  parseDeviceMemoryGb,
  parseTightModeAt,
  TIGHT_MEMORY_MAX_GB,
  tightMemoryFromSignals,
} from '../src/device_memory_hint';

const NOW = 1_700_000_000_000;

describe('device memory hint parsing', () => {
  it('parses stored/override GB values and rejects junk per dimension', () => {
    expect(parseDeviceMemoryGb('4')).toBe(4);
    expect(parseDeviceMemoryGb('3.75')).toBe(3.75);
    expect(parseDeviceMemoryGb(null)).toBeUndefined();
    expect(parseDeviceMemoryGb(undefined)).toBeUndefined();
    expect(parseDeviceMemoryGb('')).toBeUndefined();
    expect(parseDeviceMemoryGb('lots')).toBeUndefined();
    expect(parseDeviceMemoryGb('NaN')).toBeUndefined();
    expect(parseDeviceMemoryGb('0')).toBeUndefined();
    expect(parseDeviceMemoryGb('-4')).toBeUndefined();
    expect(parseDeviceMemoryGb('2000')).toBeUndefined();
  });

  it('converts physical-memory bytes to a two-decimal GB value', () => {
    // A real iPhone 13 reports slightly under the marketing 4 GB.
    expect(deviceMemoryGbFromBytes(3.9 * 1024 ** 3)).toBe(3.9);
    expect(deviceMemoryGbFromBytes(4 * 1024 ** 3)).toBe(4);
    expect(deviceMemoryGbFromBytes(6 * 1024 ** 3)).toBe(6);
    expect(deviceMemoryGbFromBytes(0)).toBeUndefined();
    expect(deviceMemoryGbFromBytes(-1)).toBeUndefined();
    expect(deviceMemoryGbFromBytes(Number.NaN)).toBeUndefined();
    expect(deviceMemoryGbFromBytes(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('parses the tight-mode marker fail-soft', () => {
    expect(parseTightModeAt(JSON.stringify({ at: NOW }))).toBe(NOW);
    expect(parseTightModeAt(null)).toBeUndefined();
    expect(parseTightModeAt('')).toBeUndefined();
    expect(parseTightModeAt('{')).toBeUndefined();
    expect(parseTightModeAt('{}')).toBeUndefined();
    expect(parseTightModeAt(JSON.stringify({ at: 'yesterday' }))).toBeUndefined();
    expect(parseTightModeAt(JSON.stringify({ at: Number.NaN }))).toBeUndefined();
  });
});

describe('tight memory decision', () => {
  it('triggers on 4 GB-class measurements and not above', () => {
    expect(tightMemoryFromSignals(3.9, undefined, NOW)).toBe(true);
    expect(tightMemoryFromSignals(TIGHT_MEMORY_MAX_GB, undefined, NOW)).toBe(true);
    // The iPhone 12 Pro class (6 GB) keeps the standard native profile.
    expect(tightMemoryFromSignals(6, undefined, NOW)).toBe(false);
    expect(tightMemoryFromSignals(undefined, undefined, NOW)).toBe(false);
  });

  it('triggers on a fresh entry-crash marker and expires it at the window edge', () => {
    expect(tightMemoryFromSignals(undefined, NOW, NOW)).toBe(true);
    expect(tightMemoryFromSignals(undefined, NOW - ENTRY_TIGHT_MODE_WINDOW_MS, NOW)).toBe(true);
    expect(tightMemoryFromSignals(undefined, NOW - ENTRY_TIGHT_MODE_WINDOW_MS - 1, NOW)).toBe(
      false,
    );
    // A marker stamped in the future (clock rollback) reads inactive.
    expect(tightMemoryFromSignals(undefined, NOW + 1, NOW)).toBe(false);
  });

  it('lets an entry-crash marker override a roomy measurement (a kill is direct evidence)', () => {
    expect(tightMemoryFromSignals(8, NOW, NOW)).toBe(true);
  });

  it('pins the constants the recovery story is written against', () => {
    expect(TIGHT_MEMORY_MAX_GB).toBe(4);
    expect(ENTRY_TIGHT_MODE_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(DEVICE_MEMORY_GB_KEY).toBe('woc_device_mem_gb');
    expect(ENTRY_TIGHT_MODE_KEY).toBe('woc_entry_tight_mode');
  });
});
