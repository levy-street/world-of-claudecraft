import { describe, expect, it } from 'vitest';
import {
  buildMeterRows,
  type MeterRowsInput,
  type MeterRowTally,
  threatOf,
} from '../src/ui/meters_rows_view';

const tally = (pid: number, name: string, over: Partial<MeterRowTally> = {}): MeterRowTally => ({
  pid,
  name,
  cls: null,
  dmg: 0,
  heal: 0,
  dmgByMob: new Map(),
  ...over,
});

const input = (over: Partial<MeterRowsInput>): MeterRowsInput => ({
  tallies: [],
  tab: 'dmg',
  liveThreat: null,
  petsByOwner: null,
  mainMobId: null,
  aggroPid: null,
  ...over,
});

describe('meter bar rows', () => {
  it('ranks by the tab it is showing, so one tally set drives three panels', () => {
    const tallies = [
      tally(1, 'Hero', { dmg: 500, heal: 10 }),
      tally(2, 'Pal', { dmg: 100, heal: 900 }),
    ];
    expect(buildMeterRows(input({ tallies, tab: 'dmg' })).map((r) => r.tally.name)).toEqual([
      'Hero',
      'Pal',
    ]);
    expect(buildMeterRows(input({ tallies, tab: 'heal' })).map((r) => r.tally.name)).toEqual([
      'Pal',
      'Hero',
    ]);
  });

  it('fills each bar against the leader, never the total', () => {
    const rows = buildMeterRows(
      input({
        tallies: [tally(1, 'Hero', { dmg: 400 }), tally(2, 'Pal', { dmg: 100 })],
      }),
    );
    expect(rows.map((r) => r.fill)).toEqual([1, 0.25]);
  });

  it('drops members with nothing on this meter', () => {
    const rows = buildMeterRows(
      input({
        tallies: [tally(1, 'Hero', { dmg: 400 }), tally(2, 'Pal', { dmg: 0 })],
        tab: 'dmg',
      }),
    );
    expect(rows.map((r) => r.tally.name)).toEqual(['Hero']);
  });

  it('adds a pet hate to its owner column', () => {
    const rows = buildMeterRows(
      input({
        tallies: [tally(1, 'Hero'), tally(2, 'Pal')],
        tab: 'threat',
        liveThreat: new Map([
          [1, 100],
          [3, 50],
          [2, 40],
        ]),
        petsByOwner: new Map([[1, [{ pid: 3, name: 'Emberkin' }]]]),
      }),
    );
    expect(rows.map((r) => [r.tally.name, r.value])).toEqual([
      ['Hero', 150],
      ['Pal', 40],
    ]);
    expect(threatOf(1, new Map([[1, 10]]), undefined)).toBe(10);
  });

  it('marks the owner when the mob is chewing on their pet', () => {
    const rows = buildMeterRows(
      input({
        tallies: [tally(1, 'Hero'), tally(2, 'Pal')],
        tab: 'threat',
        liveThreat: new Map([
          [1, 100],
          [2, 40],
        ]),
        petsByOwner: new Map([[1, [{ pid: 3, name: 'Emberkin' }]]]),
        aggroPid: 3,
      }),
    );
    expect(rows.map((r) => [r.tally.name, r.hasAggro])).toEqual([
      ['Hero', true],
      ['Pal', false],
    ]);
  });

  it('never marks aggro off the threat tab, where the column is not hate', () => {
    const rows = buildMeterRows(
      input({
        tallies: [tally(1, 'Hero', { dmg: 100 })],
        tab: 'dmg',
        aggroPid: 1,
      }),
    );
    expect(rows[0].hasAggro).toBe(false);
  });

  it('falls back to damage on the threat mob once its hate table is gone', () => {
    const rows = buildMeterRows(
      input({
        tallies: [
          tally(1, 'Hero', { dmgByMob: new Map([[51, 700]]) }),
          tally(2, 'Pal', { dmgByMob: new Map([[51, 200]]) }),
        ],
        tab: 'threat',
        liveThreat: null,
        mainMobId: 51,
      }),
    );
    expect(rows.map((r) => [r.tally.name, r.value])).toEqual([
      ['Hero', 700],
      ['Pal', 200],
    ]);
  });

  it('shows an empty threat panel rather than guessing when there is no subject mob', () => {
    const rows = buildMeterRows(
      input({
        tallies: [tally(1, 'Hero', { dmgByMob: new Map([[51, 700]]) })],
        tab: 'threat',
        liveThreat: null,
        mainMobId: null,
      }),
    );
    expect(rows).toEqual([]);
  });
});
