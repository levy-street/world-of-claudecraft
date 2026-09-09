import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_export_units';
  return { query: vi.fn(), connect: vi.fn() };
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return db;
  },
}));

import { projectAccountExportState } from '../server/account_export_state';
import { exportAccountData, listCharactersAllRealms } from '../server/db';

const publicPlot = {
  cropId: 'vale_wheat',
  plantedAtMs: 1_000,
  readyAtMs: 9_999_999_999_999,
  compost: true,
  watch: false,
  tonic: true,
  notified: false,
};

function serveState(state: unknown): void {
  db.query.mockImplementation(async (sql: string) => {
    if (/FROM characters\b/.test(sql)) {
      return {
        rows: [
          { id: 2, name: 'Farmer', class: 'warrior', level: 20, realm: 'test', state },
          { id: 3, name: 'FarmerTwo', class: 'mage', level: 25, realm: 'other', state },
        ],
      };
    }
    if (/FROM accounts\b/.test(sql)) {
      return { rows: [{ id: 1, username: 'farmer', created_at: '2026-09-04', locale: 'en' }] };
    }
    return { rows: [] };
  });
}

async function exportedStates(): Promise<unknown[]> {
  const bundle = await exportAccountData(1);
  if (!bundle) throw new Error('Expected the fixture account to export');
  return (bundle.characters as { state: unknown }[]).map((character) => character.state);
}

describe('account export farming state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exports public plot data across realms without hidden outcomes or changing the saved state', async () => {
    const plot = Object.freeze({ ...publicPlot, survivalRoll: 0.12345, yieldSeed: 1_234_567 });
    const state = Object.freeze({
      farmPlots: Object.freeze({ bed_eastbrook_1: plot }),
      harvestJournal: { cropCounts: { vale_wheat: 12 } },
      unknownPersonalData: { yieldSeed: 'an unrelated personal field' },
    });
    serveState(state);

    const exported = await exportedStates();
    for (const result of exported) {
      expect(result).toEqual({ ...state, farmPlots: { bed_eastbrook_1: publicPlot } });
    }
    expect(state.farmPlots.bed_eastbrook_1).toBe(plot);
    expect(plot.survivalRoll).toBe(0.12345);
    expect(plot.yieldSeed).toBe(1_234_567);
    expect((await listCharactersAllRealms(1))[0].state).toBe(state);
  });

  it('keeps future private plot fields out without filtering unrelated personal state', async () => {
    serveState({
      farmPlots: {
        bed_eastbrook_1: { ...publicPlot, nextHarvestSecret: { roll: 0.8 }, privateSeed: 99 },
      },
      futurePersonalData: { nextHarvestSecret: 'a user-authored value' },
    });
    expect(await exportedStates()).toEqual([
      {
        farmPlots: { bed_eastbrook_1: publicPlot },
        futurePersonalData: { nextHarvestSecret: 'a user-authored value' },
      },
      {
        farmPlots: { bed_eastbrook_1: publicPlot },
        futurePersonalData: { nextHarvestSecret: 'a user-authored value' },
      },
    ]);
  });

  it.each([
    undefined,
    null,
    {},
    { money: 12 },
    { farmPlots: {} },
    { farmPlots: null },
    { farmPlots: 3 },
    { farmPlots: [] },
  ])('preserves legacy and empty state %j', async (state) => {
    serveState(state);
    expect(await exportedStates()).toEqual([state, state]);
  });

  it('preserves omitted optional flags and does not calculate live status or normalize timestamps', async () => {
    const legacyPlot = { cropId: 'retired_crop', plantedAtMs: -3, readyAtMs: 0 };
    serveState({ farmPlots: { retired_bed: legacyPlot } });
    expect(await exportedStates()).toEqual([
      { farmPlots: { retired_bed: legacyPlot } },
      { farmPlots: { retired_bed: legacyPlot } },
    ]);
  });

  it('tolerates malformed plot rows and redacts hidden fields even inside an array shape', async () => {
    serveState({
      farmPlots: {
        nullBed: null,
        scalarBed: 2,
        arrayBed: [{ ...publicPlot, survivalRoll: 0.1, yieldSeed: 5 }],
        badBed: { cropId: null, readyAtMs: { yieldSeed: 6 }, survivalRoll: 0.4 },
      },
    });
    const expected = {
      farmPlots: { nullBed: null, scalarBed: 2, arrayBed: [publicPlot], badBed: { cropId: null } },
    };
    expect(await exportedStates()).toEqual([expected, expected]);
  });

  it('returns null for an account that no longer exists without reading characters', async () => {
    db.query.mockResolvedValue({ rows: [] });
    expect(await exportAccountData(1)).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('projects malformed array-shaped farm maps without rewriting their saved rows', () => {
    const plot = Object.freeze({ ...publicPlot, survivalRoll: 0.3, yieldSeed: 55 });
    const state = Object.freeze({ farmPlots: Object.freeze([plot]) });
    expect(projectAccountExportState(state)).toEqual({ farmPlots: [publicPlot] });
    expect(state.farmPlots[0]).toBe(plot);
    expect(state.farmPlots[0].yieldSeed).toBe(55);
  });
});
