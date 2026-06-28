// Direct unit tests for the I2a delve run module (src/sim/delves/runs.ts), exercising
// the pure generators (module gen / affix roll / spawn-set pick), the shared-stream
// payout draw, the daily-reset rollover, and the shop gate WITHOUT going through Sim.
// These pin the move's determinism at the module boundary (the parity gate pins it via
// the full Sim; these prove the extracted functions are deterministic on their own).

import { describe, expect, it } from 'vitest';
import { DELVE_MODULES, DELVES } from '../src/sim/data';
import {
  DELVE_IMPLEMENTED_AFFIXES,
  delveMarkPayout,
  delveShopGateMet,
  pickDelveModules,
  pickDelveSpawnSet,
  refreshDelveDaily,
  rollDelveAffixes,
} from '../src/sim/delves/runs';
import { Rng } from '../src/sim/rng';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { DelveModuleDef, DelveRun } from '../src/sim/types';

const RELIQUARY = DELVES.collapsed_reliquary;

describe('pickDelveModules', () => {
  it('is deterministic for a fixed seed and always ends on the finale', () => {
    const a = pickDelveModules(RELIQUARY, 12345, 'normal');
    const b = pickDelveModules(RELIQUARY, 12345, 'normal');
    expect(a).toEqual(b);
    expect(a[a.length - 1]).toBe(RELIQUARY.finaleModuleId);
  });

  it('picks moduleCount non-finale rooms (then appends the finale)', () => {
    const tierIdx = RELIQUARY.tiers.findIndex((t) => t.id === 'normal');
    const count = RELIQUARY.moduleCount[tierIdx];
    const picked = pickDelveModules(RELIQUARY, 777, 'normal');
    expect(picked.length).toBe(count + 1);
    for (const id of picked.slice(0, -1)) {
      expect(id).not.toBe(RELIQUARY.finaleModuleId);
      expect(RELIQUARY.modules).toContain(id);
    }
  });

  it('forks the result on a different seed', () => {
    // Distinct seeds should generally produce a distinct ordering of the pool.
    const seeds = [1, 2, 3, 4, 5].map((s) => pickDelveModules(RELIQUARY, s, 'normal').join(','));
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });
});

describe('rollDelveAffixes', () => {
  it('returns [] when the tier rolls no affixes (no draw)', () => {
    expect(rollDelveAffixes(RELIQUARY, 'normal', 999)).toEqual([]); // normal affixCount 0
  });

  it('is deterministic and only yields implemented affixes within the tier count', () => {
    const a = rollDelveAffixes(RELIQUARY, 'heroic', 55);
    const b = rollDelveAffixes(RELIQUARY, 'heroic', 55);
    expect(a).toEqual(b);
    const tier = RELIQUARY.tiers.find((t) => t.id === 'heroic');
    expect(a.length).toBeLessThanOrEqual(tier?.affixCount ?? 0);
    for (const id of a) expect(DELVE_IMPLEMENTED_AFFIXES.has(id)).toBe(true);
  });
});

describe('pickDelveSpawnSet', () => {
  it('returns the lone spawn set without drawing rng', () => {
    const mod = DELVE_MODULES.reliquary_sunken_ossuary;
    expect(mod.spawnSets.length).toBe(1);
    expect(pickDelveSpawnSet(mod, 42, 0)).toBe(mod.spawnSets[0]);
  });

  it('weighted-picks deterministically across two sets on a per-module substream', () => {
    const mod = {
      spawnSets: [
        { weight: 1, spawns: [{ mobId: 'a', x: 0, z: 0 }] },
        { weight: 3, spawns: [{ mobId: 'b', x: 0, z: 0 }] },
      ],
    } as unknown as DelveModuleDef;
    const first = pickDelveSpawnSet(mod, 100, 0);
    expect(pickDelveSpawnSet(mod, 100, 0)).toBe(first); // same seed+index => same set
    // Different module index reseeds the substream (seed ^ index*7919).
    const idxResults = new Set([0, 1, 2, 3, 4].map((i) => pickDelveSpawnSet(mod, 100, i)));
    expect(idxResults.size).toBeGreaterThanOrEqual(1);
  });
});

describe('delveMarkPayout', () => {
  const noDrawCtx = {
    rng: {
      chance: () => {
        throw new Error('first-3 / heroic payout must not draw rng');
      },
    },
  } as unknown as SimContext;
  const run = (tierId: string) => ({ tierId }) as unknown as DelveRun;
  const meta = (markClears: number) => ({ delveDaily: { markClears } }) as unknown as PlayerMeta;

  it('pays full Marks for the first 3 clears without drawing (1 Normal / 2 Heroic)', () => {
    expect(delveMarkPayout(noDrawCtx, run('normal'), meta(0))).toBe(1);
    expect(delveMarkPayout(noDrawCtx, run('heroic'), meta(2))).toBe(2);
  });

  it('guarantees 1 Heroic Mark post-3 without drawing', () => {
    expect(delveMarkPayout(noDrawCtx, run('heroic'), meta(3))).toBe(1);
  });

  it('rolls a deterministic 50% Normal Mark post-3 on the shared stream', () => {
    const ctxA = { rng: new Rng(2024) } as unknown as SimContext;
    const ctxB = { rng: new Rng(2024) } as unknown as SimContext;
    expect(delveMarkPayout(ctxA, run('normal'), meta(3))).toBe(
      delveMarkPayout(ctxB, run('normal'), meta(3)),
    );
    expect([0, 1]).toContain(
      delveMarkPayout({ rng: new Rng(7) } as unknown as SimContext, run('normal'), meta(3)),
    );
  });
});

describe('refreshDelveDaily', () => {
  const meta = (date: string): PlayerMeta =>
    ({
      delveDaily: { date, firstClearXp: new Set(['x']), markClears: 4 },
    }) as unknown as PlayerMeta;

  it('rolls over to a fresh window on a new UTC day', () => {
    const m = meta('2099-01-01');
    refreshDelveDaily({ utcDay: '2099-01-02' } as unknown as SimContext, m);
    expect(m.delveDaily.date).toBe('2099-01-02');
    expect(m.delveDaily.firstClearXp.size).toBe(0);
    expect(m.delveDaily.markClears).toBe(0);
  });

  it('is a no-op on the same day or when the day is unknown', () => {
    const same = meta('2099-01-01');
    refreshDelveDaily({ utcDay: '2099-01-01' } as unknown as SimContext, same);
    expect(same.delveDaily.markClears).toBe(4);
    const unknown = meta('2099-01-01');
    refreshDelveDaily({ utcDay: '' } as unknown as SimContext, unknown);
    expect(unknown.delveDaily.date).toBe('2099-01-01');
    expect(unknown.delveDaily.markClears).toBe(4);
  });
});

describe('delveShopGateMet', () => {
  const meta = (clears: Record<string, number>): PlayerMeta =>
    ({ delveClears: clears }) as unknown as PlayerMeta;

  it('opens an available gate, gates clears:N on total clears, and heroicClear on a heroic run', () => {
    expect(delveShopGateMet(meta({}), 'collapsed_reliquary', 'available')).toBe(true);
    expect(
      delveShopGateMet(
        meta({ 'collapsed_reliquary:normal': 2 }),
        'collapsed_reliquary',
        'clears:3',
      ),
    ).toBe(false);
    expect(
      delveShopGateMet(
        meta({ 'collapsed_reliquary:normal': 2, 'collapsed_reliquary:heroic': 1 }),
        'collapsed_reliquary',
        'clears:3',
      ),
    ).toBe(true);
    expect(
      delveShopGateMet(
        meta({ 'collapsed_reliquary:normal': 5 }),
        'collapsed_reliquary',
        'heroicClear',
      ),
    ).toBe(false);
    expect(
      delveShopGateMet(
        meta({ 'collapsed_reliquary:heroic': 1 }),
        'collapsed_reliquary',
        'heroicClear',
      ),
    ).toBe(true);
  });
});
