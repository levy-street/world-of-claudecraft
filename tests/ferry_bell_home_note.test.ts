// The town-bell homecoming policy the Hud's ferryBellHome arm delegates to.

import { describe, expect, it, vi } from 'vitest';
import { Settings } from '../src/game/settings';
import {
  ferryBellHomeNoteToOpen,
  writeEastbrookGuidanceChoice,
} from '../src/ui/ferry_bell_home_note';

function memoryStorage(seed: Record<string, string> = {}) {
  const rows = new Map(Object.entries(seed));
  return {
    rows,
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => void rows.set(key, value),
  };
}

describe('ferryBellHomeNoteToOpen', () => {
  it.each(['unavailable', 'available', 'active', 'ready'] as const)(
    'offers the guidance choice on every crossing while the wolves are %s, touching no storage',
    (state) => {
      const storage = memoryStorage();
      const world = { questState: () => state };
      for (let crossing = 0; crossing < 3; crossing++) {
        const note = ferryBellHomeNoteToOpen(world, storage);
        expect(note?.guidanceChoice).toBe(true);
        expect(note?.bodyKey).toBe('hudChrome.tutorialGreeting.eastbrookGuidanceNote');
      }
      expect(storage.rows.size).toBe(0);
    },
  );

  it('shows the plain return-bell hint once per device after the wolves are done', () => {
    const storage = memoryStorage();
    const world = { questState: () => 'done' };
    const first = ferryBellHomeNoteToOpen(world, storage);
    expect(first?.guidanceChoice).toBeUndefined();
    expect(first?.bodyKey).toBe('hudChrome.tutorialGreeting.bellHomeNote');
    expect(storage.rows.get('woc.ferrybellhint.v1')).toBe('seen');
    expect(ferryBellHomeNoteToOpen(world, storage)).toBeNull();
  });

  it('honors a hint the device saw before the guidance existed', () => {
    const storage = memoryStorage({ 'woc.ferrybellhint.v1': 'seen' });
    expect(ferryBellHomeNoteToOpen({ questState: () => 'done' }, storage)).toBeNull();
  });

  it('skips the hint rather than throwing where storage is unavailable or refuses', () => {
    const world = { questState: () => 'done' };
    expect(ferryBellHomeNoteToOpen(world, null)).toBeNull();
    const refusing = {
      getItem: () => {
        throw new Error('private mode');
      },
      setItem: () => {
        throw new Error('private mode');
      },
    };
    expect(ferryBellHomeNoteToOpen(world, refusing)).toBeNull();
    // The choice never depends on storage, so it survives the same device.
    expect(ferryBellHomeNoteToOpen({ questState: () => 'active' }, refusing)?.guidanceChoice).toBe(
      true,
    );
  });
});

describe('writeEastbrookGuidanceChoice', () => {
  it('persists the choice through the live settings', () => {
    const settings = new Settings();
    expect(settings.get('eastbrookGuidance')).toBe(true);
    writeEastbrookGuidanceChoice({ settings }, false);
    expect(settings.get('eastbrookGuidance')).toBe(false);
    writeEastbrookGuidanceChoice({ settings }, true);
    expect(settings.get('eastbrookGuidance')).toBe(true);
  });

  it('reports a missing writer instead of dropping the click silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => writeEastbrookGuidanceChoice(null, false)).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
