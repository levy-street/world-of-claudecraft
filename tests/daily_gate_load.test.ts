import { describe, expect, it } from 'vitest';
import {
  type DailyGateSaveFragments,
  sanitizeDailyGateLoad,
} from '../src/sim/professions/daily_gate_load';

// Direct pins for the extracted load-hardening leaf (the clamps formerly
// inlined in Sim.addPlayer; the Sim-level round-trip behavior stays pinned by
// tests/masterwrought_materials.test.ts and tests/quickening_catalyst_gate.ts
// through the real load path). Every dimension gets a negative arm so a
// dropped clamp reddens here even if the Sim fixtures never exercise it.

// A live oncePerDay recipe id (content/recipes.ts); the craftDaily clamp
// filters stamps to the live set, so the pin uses one real id and one fake.
const LIVE_ONCE_PER_DAY = 'recipe_quickening_catalyst';

describe('sanitizeDailyGateLoad', () => {
  it('omits absent fragments and normalizes a missing anchor to empty', () => {
    const out = sanitizeDailyGateLoad({});
    expect(out.wyrmfallDaily).toBeUndefined();
    expect(out.craftDaily).toBeUndefined();
    expect(out.emberWeekAnchor).toBe('');
  });

  it('keeps a real wyrmfall row verbatim and clamps corrupt dates and tokens', () => {
    const ok = sanitizeDailyGateLoad({
      wyrmfallDaily: { date: '2026-08-14', sources: ['crypt:heroic', 'rift'] },
    });
    expect(ok.wyrmfallDaily).toEqual({
      date: '2026-08-14',
      sources: new Set(['crypt:heroic', 'rift']),
    });
    const corrupt = sanitizeDailyGateLoad({
      wyrmfallDaily: {
        date: 'x'.repeat(65),
        sources: ['ok', 'y'.repeat(65), 7 as unknown as string],
      },
    });
    expect(corrupt.wyrmfallDaily).toEqual({ date: '', sources: new Set(['ok']) });
    // The 32-entry cap: oversized junk drops instead of riding the save.
    const flooded = sanitizeDailyGateLoad({
      wyrmfallDaily: { date: '2026-08-14', sources: Array.from({ length: 40 }, (_, i) => `s${i}`) },
    });
    expect(flooded.wyrmfallDaily?.sources.size).toBe(32);
    // wyrmfallDaily deliberately KEEPS its date when sources empty (the
    // divergence from the craftDaily sibling below).
    const empty = sanitizeDailyGateLoad({ wyrmfallDaily: { date: '2026-08-14', sources: [] } });
    expect(empty.wyrmfallDaily).toEqual({ date: '2026-08-14', sources: new Set() });
  });

  it('filters craft stamps to live oncePerDay ids and resets the date with them', () => {
    const ok = sanitizeDailyGateLoad({
      craftDaily: { date: '2026-08-14', crafted: [LIVE_ONCE_PER_DAY] },
    });
    expect(ok.craftDaily).toEqual({
      date: '2026-08-14',
      crafted: new Set([LIVE_ONCE_PER_DAY]),
    });
    // A retired or tampered stamp drops, and a date whose stamps ALL filtered
    // away resets with them (an empty set gates nothing; a kept date would
    // re-serialize {date, crafted: []} forever).
    const stale = sanitizeDailyGateLoad({
      craftDaily: { date: '2026-08-14', crafted: ['recipe_never_daily_gated'] },
    });
    expect(stale.craftDaily).toEqual({ date: '', crafted: new Set() });
  });

  it('normalizes the ember week anchor instead of storing it verbatim', () => {
    expect(sanitizeDailyGateLoad({ emberWeekAnchor: 'garbage' }).emberWeekAnchor).toBe('');
    expect(
      sanitizeDailyGateLoad({ emberWeekAnchor: 12 as unknown as string }).emberWeekAnchor,
    ).toBe('');
    // A parseable off-anchor day normalizes onto the weekly anchor (Tuesday):
    // 2026-08-14 is a Friday, so the anchor steps back to 2026-08-11.
    expect(sanitizeDailyGateLoad({ emberWeekAnchor: '2026-08-14' }).emberWeekAnchor).toBe(
      '2026-08-11',
    );
    // An on-anchor value is a fixed point.
    expect(sanitizeDailyGateLoad({ emberWeekAnchor: '2026-08-11' }).emberWeekAnchor).toBe(
      '2026-08-11',
    );
  });

  it('treats the input as untrusted end to end', () => {
    const hostile = {
      wyrmfallDaily: { date: null, sources: 'not-an-array' },
      craftDaily: { date: 42, crafted: { length: 3 } },
      emberWeekAnchor: ['2026-08-11'],
    } as unknown as DailyGateSaveFragments;
    const out = sanitizeDailyGateLoad(hostile);
    expect(out.wyrmfallDaily).toEqual({ date: '', sources: new Set() });
    expect(out.craftDaily).toEqual({ date: '', crafted: new Set() });
    expect(out.emberWeekAnchor).toBe('');
  });
});
