import { describe, expect, it } from 'vitest';
import {
  type DailyGateSaveFragments,
  sanitizeDailyGateLoad,
} from '../src/sim/professions/daily_gate_load';
import { type CharacterState, Sim } from '../src/sim/sim';

// Direct pins for the extracted load-hardening leaf (the clamps formerly
// inlined in Sim.addPlayer; the Sim-level round-trip behavior stays pinned by
// tests/masterwrought_materials.test.ts and tests/quickening_catalyst_gate.test.ts
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

  it('keeps a real delveDaily row verbatim and clamps every dimension of a corrupt one', () => {
    const ok = sanitizeDailyGateLoad({
      delveDaily: { date: '2026-08-14', firstClearXp: ['delve_a', 'delve_b'], markClears: 3 },
    });
    expect(ok.delveDaily).toEqual({
      date: '2026-08-14',
      firstClearXp: new Set(['delve_a', 'delve_b']),
      markClears: 3,
    });
    // The non-iterable throw exposure this arm exists for: `new Set(5)`
    // throws inside addPlayer, the unloadable-character class. Here it
    // degrades to an empty set instead.
    const nonIterable = sanitizeDailyGateLoad({
      delveDaily: {
        date: '2026-08-14',
        firstClearXp: 5 as unknown as string[],
        markClears: 1,
      },
    });
    expect(nonIterable.delveDaily).toEqual({
      date: '2026-08-14',
      firstClearXp: new Set(),
      markClears: 1,
    });
    // The sibling arms' clamps: 64-char date and tokens, 32-entry cap, and
    // markClears floored to a non-negative integer with junk reading 0.
    const corrupt = sanitizeDailyGateLoad({
      delveDaily: {
        date: 'x'.repeat(65),
        firstClearXp: ['ok', 'y'.repeat(65), 7 as unknown as string],
        markClears: -4,
      },
    });
    expect(corrupt.delveDaily).toEqual({ date: '', firstClearXp: new Set(['ok']), markClears: 0 });
    expect(
      sanitizeDailyGateLoad({
        delveDaily: {
          date: '2026-08-14',
          firstClearXp: Array.from({ length: 40 }, (_, i) => `d${i}`),
          markClears: 2.9,
        },
      }).delveDaily,
    ).toEqual({
      date: '2026-08-14',
      firstClearXp: new Set(Array.from({ length: 32 }, (_, i) => `d${i}`)),
      markClears: 2,
    });
    expect(
      sanitizeDailyGateLoad({
        delveDaily: {
          date: '2026-08-14',
          firstClearXp: [],
          markClears: Number.NaN,
        },
      }).delveDaily?.markClears,
    ).toBe(0);
  });

  it('keeps a real heroicDaily row verbatim and clamps a corrupt one', () => {
    const ok = sanitizeDailyGateLoad({
      heroicDaily: { date: 'reset:20721', marked: ['emberfall_depths'] },
    });
    expect(ok.heroicDaily).toEqual({
      date: 'reset:20721',
      marked: new Set(['emberfall_depths']),
    });
    // Same non-iterable degrade as the delve arm.
    expect(
      sanitizeDailyGateLoad({
        heroicDaily: { date: 'reset:20721', marked: 'junk' as unknown as string[] },
      }).heroicDaily,
    ).toEqual({ date: 'reset:20721', marked: new Set() });
    const corrupt = sanitizeDailyGateLoad({
      heroicDaily: {
        date: 'x'.repeat(65),
        marked: ['ok', 'y'.repeat(65), 7 as unknown as string],
      },
    });
    expect(corrupt.heroicDaily).toEqual({ date: '', marked: new Set(['ok']) });
    expect(
      sanitizeDailyGateLoad({
        heroicDaily: { date: 'reset:20721', marked: Array.from({ length: 40 }, (_, i) => `m${i}`) },
      }).heroicDaily?.marked.size,
    ).toBe(32);
  });

  it('treats the input as untrusted end to end', () => {
    const hostile = {
      wyrmfallDaily: { date: null, sources: 'not-an-array' },
      craftDaily: { date: 42, crafted: { length: 3 } },
      delveDaily: { date: {}, firstClearXp: 9, markClears: 'many' },
      heroicDaily: { date: [], marked: null },
      emberWeekAnchor: ['2026-08-11'],
    } as unknown as DailyGateSaveFragments;
    const out = sanitizeDailyGateLoad(hostile);
    expect(out.wyrmfallDaily).toEqual({ date: '', sources: new Set() });
    expect(out.craftDaily).toEqual({ date: '', crafted: new Set() });
    expect(out.delveDaily).toEqual({ date: '', firstClearXp: new Set(), markClears: 0 });
    expect(out.heroicDaily).toEqual({ date: '', marked: new Set() });
    expect(out.emberWeekAnchor).toBe('');
  });
});

describe('the addPlayer consumer', () => {
  it('loads a character whose delve/heroic daily rows are non-iterable instead of throwing', () => {
    // The exposure this extension closes: the raw `new Set(s.delveDaily
    // .firstClearXp)` / `new Set(s.heroicDaily.marked)` inlined in addPlayer
    // THREW on a tampered non-iterable row, the unloadable-character class.
    const seedSim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const saved = seedSim.serializeCharacter(seedSim.playerId) as CharacterState;
    (saved as unknown as Record<string, unknown>).delveDaily = {
      date: '2026-08-14',
      firstClearXp: 5,
      markClears: 'many',
    };
    (saved as unknown as Record<string, unknown>).heroicDaily = {
      date: 'reset:20721',
      marked: 9,
    };
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Tampered', { state: saved });
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('the tampered character failed to load');
    expect(meta.delveDaily).toEqual({
      date: '2026-08-14',
      firstClearXp: new Set(),
      markClears: 0,
    });
    expect(meta.heroicDaily).toEqual({ date: 'reset:20721', marked: new Set() });
  });
});
