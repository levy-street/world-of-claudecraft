import { describe, expect, it } from 'vitest';
import {
  buildMeterRows,
  type MeterRowsInput,
  type MeterRowTally,
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

  // The mob's pull-over rule compares each hate-table ENTRY on its own (110% in
  // melee, 130% at range, src/sim/mob/targeting.ts). A bar that adds an owner
  // and their pet together is measured against a threshold the mob never
  // applies to that sum, so a hunter doing little damage personally rode the top
  // of the meter and never pulled. Each entry gets its own bar instead.
  it('gives a pet its own hate bar instead of folding it into its owner', () => {
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
    expect(rows.map((r) => [r.petName ?? r.tally.name, r.value])).toEqual([
      ['Hero', 100],
      ['Emberkin', 50],
      ['Pal', 40],
    ]);
    // never the folded 150: no entity on the mob's table holds that much
    expect(rows.map((r) => r.value)).not.toContain(150);
    // each bar names the entity whose hate it is, which is what the marker keys on
    expect(rows.map((r) => r.threatPid)).toEqual([1, 3, 2]);
  });

  it('keeps folding pets into the owner on the damage and healing tabs', () => {
    // The damage-meter convention is right there and must not change: only the
    // threat tab splits, because only threat is compared per entity.
    const rows = buildMeterRows(
      input({
        tallies: [tally(1, 'Hero', { dmg: 300 })],
        tab: 'dmg',
        petsByOwner: new Map([[1, [{ pid: 3, name: 'Emberkin' }]]]),
      }),
    );
    expect(rows.map((r) => [r.tally.name, r.value, r.petName])).toEqual([['Hero', 300, null]]);
  });

  it('marks the pet itself, not its owner, when the mob is chewing on the pet', () => {
    const rows = buildMeterRows(
      input({
        tallies: [tally(1, 'Hero'), tally(2, 'Pal')],
        tab: 'threat',
        liveThreat: new Map([
          [1, 100],
          [3, 60],
          [2, 40],
        ]),
        petsByOwner: new Map([[1, [{ pid: 3, name: 'Emberkin' }]]]),
        aggroPid: 3,
      }),
    );
    expect(rows.map((r) => [r.petName ?? r.tally.name, r.hasAggro])).toEqual([
      ['Hero', false],
      ['Emberkin', true],
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
