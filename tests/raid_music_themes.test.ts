import { describe, expect, it } from 'vitest';
import {
  buildIgnivarRaidThemes,
  IGNIVAR_FORGE_LEITMOTIF_INTERVALS,
  IGNIVAR_RAID_THEME_KEYS,
} from '../src/game/raid_music_themes';

describe('Ignivar raid music themes', () => {
  it('authors one non-empty, in-bounds composition for every raid room', () => {
    const themes = buildIgnivarRaidThemes();
    expect(Object.keys(themes)).toEqual(IGNIVAR_RAID_THEME_KEYS);

    for (const [key, theme] of Object.entries(themes)) {
      expect(theme.events.length, key).toBeGreaterThan(100);
      expect(
        theme.events.every((event) => event.beat >= 0 && event.beat < theme.bars * 4),
        key,
      ).toBe(true);
      expect(
        theme.events.some((event) => event.inst === 'woodBlock'),
        key,
      ).toBe(true);
      expect(
        theme.events.some((event) => event.inst === 'bass'),
        key,
      ).toBe(true);
    }
  });

  it('keeps a shared forge motif while giving every room a distinct arrangement', () => {
    expect(IGNIVAR_FORGE_LEITMOTIF_INTERVALS).toEqual([0, 3, 1, 7]);

    const themes = buildIgnivarRaidThemes();
    expect(new Set(Object.values(themes).map((theme) => theme.bpm)).size).toBe(3);
    expect(themes.ignivar_forge_approach.events.some((event) => event.inst === 'reed')).toBe(true);
    expect(themes.ignivar_raid_arena.events.some((event) => event.inst === 'stacc')).toBe(true);
    expect(themes.ignivar_inner_crucible.events.some((event) => event.inst === 'brassStab')).toBe(
      true,
    );
  });
});
