import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WHO_TAB_STATE,
  parseWhoCommand,
  toggleWhoSort,
  whoClassOptions,
  whoCountView,
  whoTabRows,
  whoTabSig,
} from '../src/ui/who_tab_view';
import type { WhoRosterInfo } from '../src/world_api';

// The Who tab's pure core: local sort + class chip over the delivered roster,
// the count line's numbers, and the /who chat-command parse.

const INFO: WhoRosterInfo = {
  filter: '',
  limit: 200,
  total: 4,
  rows: [
    { name: 'Mira', cls: 'priest', level: 30, zone: 'Ashwood', status: 'online', guild: '' },
    {
      name: 'Aleron',
      cls: 'warrior',
      level: 12,
      zone: 'Thornpeak',
      status: 'combat',
      guild: 'Moonwardens',
    },
    { name: 'Bryn', cls: 'mage', level: 30, zone: 'Ashwood', status: 'afk', guild: 'Ashen Pact' },
    {
      name: 'Cato',
      cls: 'mage',
      level: 5,
      zone: 'Barrowmoor',
      status: 'dungeon',
      guild: 'Moonwardens',
    },
  ],
};

describe('whoTabRows', () => {
  it('sorts by name ascending by default, stamping the dot kind and the self flag', () => {
    const rows = whoTabRows(INFO, DEFAULT_WHO_TAB_STATE, 'Bryn');
    expect(rows.map((r) => r.name)).toEqual(['Aleron', 'Bryn', 'Cato', 'Mira']);
    expect(rows.map((r) => r.dot)).toEqual(['combat', 'afk', 'dungeon', 'online']);
    expect(rows.map((r) => r.self)).toEqual([false, true, false, false]);
  });
  it('sorts by level with name as the stable tie-break, in either direction', () => {
    const desc = whoTabRows(INFO, { ...DEFAULT_WHO_TAB_STATE, sort: 'level', desc: true }, '');
    expect(desc.map((r) => r.name)).toEqual(['Bryn', 'Mira', 'Aleron', 'Cato']);
    const asc = whoTabRows(INFO, { ...DEFAULT_WHO_TAB_STATE, sort: 'level' }, '');
    expect(asc.map((r) => r.name)).toEqual(['Cato', 'Aleron', 'Bryn', 'Mira']);
  });
  it('sinks unguilded rows to the end of an ascending guild sort', () => {
    const rows = whoTabRows(INFO, { ...DEFAULT_WHO_TAB_STATE, sort: 'guild' }, '');
    expect(rows.map((r) => r.name)).toEqual(['Bryn', 'Aleron', 'Cato', 'Mira']);
  });
  it('compares class and zone by their DISPLAY labels when given', () => {
    const labels = {
      cls: (c: string) => (c === 'warrior' ? 'Aguerrier' : c),
      zone: (z: string) => z,
    };
    const rows = whoTabRows(INFO, { ...DEFAULT_WHO_TAB_STATE, sort: 'cls' }, '', labels);
    expect(rows[0].name).toBe('Aleron');
    // zone: Thornpeak sorts first only under a label that renames it
    const zoneLabels = {
      cls: (c: string) => c,
      zone: (z: string) => (z === 'Thornpeak' ? 'Aa' : z),
    };
    const byZone = whoTabRows(INFO, { ...DEFAULT_WHO_TAB_STATE, sort: 'zone' }, '', zoneLabels);
    expect(byZone.map((r) => r.name)).toEqual(['Aleron', 'Bryn', 'Mira', 'Cato']);
    const byRawZone = whoTabRows(INFO, { ...DEFAULT_WHO_TAB_STATE, sort: 'zone' }, '');
    expect(byRawZone.map((r) => r.name)).toEqual(['Bryn', 'Mira', 'Cato', 'Aleron']);
  });
  it('narrows by the class chip and returns nothing for a null roster', () => {
    const rows = whoTabRows(INFO, { ...DEFAULT_WHO_TAB_STATE, cls: 'mage' }, '');
    expect(rows.map((r) => r.name)).toEqual(['Bryn', 'Cato']);
    expect(whoTabRows(null, DEFAULT_WHO_TAB_STATE, '')).toEqual([]);
  });
});

describe('toggleWhoSort', () => {
  it('flips direction on the same column and starts a new column ascending (level descending)', () => {
    const s0 = { ...DEFAULT_WHO_TAB_STATE };
    expect(toggleWhoSort(s0, 'name')).toMatchObject({ sort: 'name', desc: true });
    expect(toggleWhoSort(s0, 'zone')).toMatchObject({ sort: 'zone', desc: false });
    expect(toggleWhoSort(s0, 'level')).toMatchObject({ sort: 'level', desc: true });
  });
});

describe('whoClassOptions + whoCountView', () => {
  it('lists each present class once, in label order', () => {
    expect(whoClassOptions(INFO)).toEqual(['mage', 'priest', 'warrior']);
    expect(whoClassOptions(null)).toEqual([]);
  });
  it('reports shown / delivered / total and whether the server capped the answer', () => {
    expect(whoCountView(INFO, 2)).toEqual({ shown: 2, delivered: 4, total: 4, capped: false });
    expect(whoCountView({ ...INFO, total: 250 }, 4)).toMatchObject({ capped: true, total: 250 });
    expect(whoCountView(null, 0)).toEqual({ shown: 0, delivered: 0, total: 0, capped: false });
  });
});

describe('parseWhoCommand', () => {
  it('recognizes /who with or without a filter, case-insensitively, and nothing else', () => {
    expect(parseWhoCommand('/who')).toBe('');
    expect(parseWhoCommand('  /WHO  Thornpeak Heights ')).toBe('Thornpeak Heights');
    expect(parseWhoCommand('/whoa')).toBeNull();
    expect(parseWhoCommand('/w Bryn who')).toBeNull();
    expect(parseWhoCommand('who')).toBeNull();
  });
});

describe('whoTabSig', () => {
  it('changes with every field that changes the paint', () => {
    const base = whoTabSig(DEFAULT_WHO_TAB_STATE);
    expect(whoTabSig({ ...DEFAULT_WHO_TAB_STATE, cls: 'mage' })).not.toBe(base);
    expect(whoTabSig({ ...DEFAULT_WHO_TAB_STATE, desc: true })).not.toBe(base);
    expect(whoTabSig({ ...DEFAULT_WHO_TAB_STATE, search: 'x' })).not.toBe(base);
  });
});
