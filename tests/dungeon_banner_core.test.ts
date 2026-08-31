// Pins for the pure kit-banner picker (src/render/dungeon_banner_core.ts):
// the ignivar suppression rule, the per-variant banner palettes, and the
// weighted pick behavior the wall placement loops rely on.
import { describe, expect, it } from 'vitest';
import { dungeonBannerKind, hangsKitBanners, pickKind } from '../src/render/dungeon_banner_core';

const sweep = (count = 40): number[] => Array.from({ length: count }, (_, i) => i / count);

describe('hangsKitBanners', () => {
  it('suppresses the kit cloth for ignivar only', () => {
    expect(hangsKitBanners('ignivar')).toBe(false);
    for (const variant of ['crypt', 'temple', 'bastion', 'sanctum', 'lastkeep'] as const) {
      expect(hangsKitBanners(variant), variant).toBe(true);
    }
  });
});

describe('dungeonBannerKind', () => {
  it('keeps each themed variant inside its own banner palette', () => {
    const palettes = {
      bastion: ['banner_shield_blue', 'banner_blue', 'banner_triple_blue'],
      sanctum: ['banner_green', 'banner_patternC_green', 'banner_triple_green'],
      temple: ['banner_white', 'banner_thin_white', 'banner_blue'],
    } as const;
    for (const [variant, allowed] of Object.entries(palettes)) {
      for (const t of sweep()) {
        const kind = dungeonBannerKind(variant as keyof typeof palettes, t, false);
        expect(allowed, `${variant} t=${t}`).toContain(kind);
      }
    }
  });

  it('aliases the drowned arena to the temple hangings', () => {
    for (const t of sweep()) {
      expect(dungeonBannerKind('arena_drowned', t, false)).toBe(
        dungeonBannerKind('temple', t, false),
      );
    }
  });

  it('hangs only tattered pale cloth in delves and the default halls', () => {
    for (const isDelve of [true, false]) {
      for (const t of sweep()) {
        const kind = dungeonBannerKind('crypt', t, isDelve);
        expect(['banner_thin_white', 'banner_white'], `delve=${isDelve} t=${t}`).toContain(kind);
      }
    }
  });

  it('weights the delve mix thinner than the default mix', () => {
    const thinShare = (isDelve: boolean): number =>
      sweep(200).filter((t) => dungeonBannerKind('crypt', t, isDelve) === 'banner_thin_white')
        .length;
    expect(thinShare(true)).toBeGreaterThan(thinShare(false));
  });
});

describe('pickKind', () => {
  const kinds: [string, number][] = [
    ['a', 1],
    ['b', 3],
  ];

  it('picks by cumulative weight and stays deterministic', () => {
    expect(pickKind(kinds, 0)).toBe('a');
    expect(pickKind(kinds, 0.2)).toBe('a');
    expect(pickKind(kinds, 0.3)).toBe('b');
    expect(pickKind(kinds, 0.99)).toBe('b');
    for (const t of sweep()) {
      expect(pickKind(kinds, t)).toBe(pickKind(kinds, t));
    }
  });

  it('falls back to the last kind at the top boundary', () => {
    expect(pickKind(kinds, 1)).toBe('b');
  });
});
