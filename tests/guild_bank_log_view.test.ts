// The guild bank activity log's pure view-core (src/ui/guild_bank_log_view.ts):
// the pane state machine, the op-to-sentence mapping, the anonymity rule for
// operator rows, the magnitude/shape guards that keep a half-formed sentence
// off a trust surface, and the repaint signature.
//
// The load-bearing property under test is that LOADING, REFUSED and EMPTY are
// three DISTINCT renderings. A drained guild bank must never be able to look
// like an untouched one because a frame went missing or a demotion landed.
import { describe, expect, it } from 'vitest';

import { Sim } from '../src/sim/sim';
import {
  buildGuildBankLogView,
  filterGuildBankLogRows,
  guildBankLogFilters,
  guildBankLogRow,
  guildBankLogSignature,
} from '../src/ui/guild_bank_log_view';
import type { GuildBankLogEntry, GuildBankLogOp, GuildBankLogView } from '../src/world_api';

const AT = 1_770_000_000_000;

function entry(over: Partial<GuildBankLogEntry> = {}): GuildBankLogEntry {
  return {
    id: 10,
    at: AT,
    actor: 'Kara',
    op: 'deposit',
    itemId: 'iron_ore',
    count: 5,
    copper: null,
    ...over,
  };
}

const view = (over: Partial<GuildBankLogView>): GuildBankLogView => ({
  state: 'ready',
  kind: 'all',
  entries: [],
  more: false,
  olderPending: false,
  ...over,
});
const ready = (entries: GuildBankLogEntry[]): GuildBankLogView => view({ entries });
// The chip strip every pane state carries (All pressed).
const chips = guildBankLogFilters('all');

describe('buildGuildBankLogView: the three non-row states are distinct', () => {
  it('no answer yet renders LOADING, never an empty history', () => {
    expect(buildGuildBankLogView(view({ state: 'loading', entries: [] }))).toEqual({
      filters: chips,
      kind: 'loading',
    });
  });

  it('a refusal renders REFUSED, never an empty history', () => {
    // The decisive half: "you may not read this" and "nobody has done anything"
    // are opposite facts, so the refusal must not collapse into 'empty'.
    const model = buildGuildBankLogView(view({ state: 'refused', entries: [] }));
    expect(model).toEqual({ filters: chips, kind: 'refused' });
    expect(model.kind).not.toBe('empty');
  });

  it('a refusal that somehow carried rows STILL renders refused (rows are not shown)', () => {
    expect(buildGuildBankLogView(view({ state: 'refused', entries: [entry()] }))).toEqual({
      filters: chips,
      kind: 'refused',
    });
  });

  it('an answer with nothing in it renders EMPTY, not loading', () => {
    expect(buildGuildBankLogView(ready([]))).toEqual({
      filters: chips,
      kind: 'empty',
      filtered: false,
    });
  });

  it('a background refresh keeps showing the installed rows (no blink back to loading)', () => {
    const model = buildGuildBankLogView(view({ state: 'loading', entries: [entry()] }));
    expect(model.kind).toBe('rows');
  });
});

describe('buildGuildBankLogView: row mapping', () => {
  it('maps every visible op to its own sentence kind', () => {
    const cases: Array<[GuildBankLogOp, string, Partial<GuildBankLogEntry>]> = [
      ['deposit', 'depositItem', {}],
      ['withdraw', 'withdrawItem', {}],
      ['deposit_gold', 'depositMoney', { itemId: null, count: null, copper: 2_500 }],
      ['withdraw_gold', 'withdrawMoney', { itemId: null, count: null, copper: 2_500 }],
      ['buy_slots', 'buySlots', { itemId: null, count: null, copper: 25_000 }],
      ['open_bank', 'openBank', { itemId: null, count: null, copper: 90_000 }],
      ['create_fee', 'charterFee', { itemId: null, count: null, copper: 10_000 }],
      ['admin_purge', 'adminPurge', {}],
    ];
    for (const [op, kind, over] of cases) {
      const row = guildBankLogRow(entry({ op, ...over }));
      expect(row?.kind, `op ${op}`).toBe(kind);
    }
  });

  it('NEVER names an actor on an operator purge, even when the frame supplied one', () => {
    // The underlying ledger row's character is the escrow CARRIER, a bystander
    // who neither ordered nor benefited from the removal. Naming them would
    // accuse the wrong guildmate of destroying guild property.
    const row = guildBankLogRow(entry({ op: 'admin_purge', actor: 'Innocent' }));
    expect(row?.kind).toBe('adminPurge');
    expect(row?.actor).toBeNull();
  });

  it('keeps the actor on every op a guildmate really performed', () => {
    for (const op of ['deposit', 'withdraw'] as const) {
      expect(guildBankLogRow(entry({ op }))?.actor).toBe('Kara');
    }
    expect(
      guildBankLogRow(entry({ op: 'deposit_gold', itemId: null, count: null, copper: 5 }))?.actor,
    ).toBe('Kara');
  });

  it('carries a missing actor through as null (the painter supplies the stand-in)', () => {
    expect(guildBankLogRow(entry({ actor: null }))?.actor).toBeNull();
  });

  it('drops an item row with no item and an item row with no count', () => {
    // A sentence with a hole in it is worse than a missing line on a surface
    // whose whole job is to be trusted.
    expect(guildBankLogRow(entry({ itemId: null }))).toBeNull();
    expect(guildBankLogRow(entry({ count: null }))).toBeNull();
    expect(guildBankLogRow(entry({ count: 0 }))).toBeNull();
  });

  it('drops a money row that moved nothing', () => {
    const money = { op: 'deposit_gold' as const, itemId: null, count: null };
    expect(guildBankLogRow(entry({ ...money, copper: null }))).toBeNull();
    expect(guildBankLogRow(entry({ ...money, copper: 0 }))).toBeNull();
    expect(guildBankLogRow(entry({ ...money, copper: 1 }))?.copper).toBe(1);
  });

  it('drops a row with a non-finite timestamp rather than formatting garbage', () => {
    expect(guildBankLogRow(entry({ at: Number.NaN }))).toBeNull();
  });

  it('zeroes the axis a row does not use (no stray copper on an item row)', () => {
    const row = guildBankLogRow(entry({ copper: 999 }));
    expect(row?.copper).toBe(0);
    const money = guildBankLogRow(
      entry({ op: 'withdraw_gold', itemId: 'iron_ore', count: 4, copper: 700 }),
    );
    expect(money?.count).toBe(0);
    expect(money?.itemId).toBeNull();
  });

  it('normalizes magnitudes: a negative or fractional count/copper never renders raw', () => {
    expect(guildBankLogRow(entry({ count: -3 }))).toBeNull();
    expect(guildBankLogRow(entry({ count: 3.9 }))?.count).toBe(3);
  });
});

describe('buildGuildBankLogView: ordering and dropping', () => {
  it('sorts newest first by ledger id, whatever order the frame arrived in', () => {
    const model = buildGuildBankLogView(
      ready([entry({ id: 4 }), entry({ id: 9 }), entry({ id: 7 })]),
    );
    expect(model.kind).toBe('rows');
    if (model.kind !== 'rows') return;
    expect(model.rows.map((r) => r.id)).toEqual([9, 7, 4]);
  });

  it('a page whose every row is malformed renders EMPTY, not a list of holes', () => {
    expect(buildGuildBankLogView(ready([entry({ itemId: null }), entry({ count: 0 })]))).toEqual({
      filters: chips,
      kind: 'empty',
      filtered: false,
    });
  });

  it('drops only the malformed rows and keeps the rest', () => {
    const model = buildGuildBankLogView(ready([entry({ id: 3 }), entry({ id: 4, itemId: null })]));
    if (model.kind !== 'rows') throw new Error('expected rows');
    expect(model.rows.map((r) => r.id)).toEqual([3]);
  });
});

describe('guildBankLogSignature: the repaint gate', () => {
  it('changes when the state flips, when rows arrive, and when a NEW row lands', () => {
    const loading = guildBankLogSignature(view({ state: 'loading', entries: [] }));
    const empty = guildBankLogSignature(ready([]));
    const one = guildBankLogSignature(ready([entry({ id: 5 })]));
    const newer = guildBankLogSignature(ready([entry({ id: 6 }), entry({ id: 5 })]));
    expect(new Set([loading, empty, one, newer]).size).toBe(4);
  });

  it('is stable across an identical re-read (a repaint gate that never settles is a loop)', () => {
    const view = ready([entry({ id: 5 }), entry({ id: 4 })]);
    expect(guildBankLogSignature(view)).toBe(guildBankLogSignature(ready([...view.entries])));
  });

  it('carries no player-authored text (it is compared, never rendered)', () => {
    expect(guildBankLogSignature(ready([entry({ actor: 'Kara' })]))).not.toContain('Kara');
  });
});

describe('the OFFLINE world arm feeds the core safely', () => {
  it('the frozen offline read renders EMPTY and signs without mutating it', () => {
    // The offline Sim answers one shared frozen view forever. The core sorts
    // and the signature scans, so if either ever reached for the input array in
    // place, offline play would throw on the first paint of the pane. Cheap to
    // pin, silent to regress.
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    const offline = sim.guildBankLog();
    expect(offline).toEqual(view({ state: 'ready', entries: [] }));
    expect(Object.isFrozen(offline)).toBe(true);
    expect(buildGuildBankLogView(offline)).toEqual({
      filters: chips,
      kind: 'empty',
      filtered: false,
    });
    expect(guildBankLogSignature(offline)).toBe('ready:all:0:0:0:e');
    // The same instance comes back untouched for the next caller.
    expect(sim.guildBankLog()).toBe(offline);
  });
});

describe('buildGuildBankLogView: the transaction history (filters and paging)', () => {
  it('presses exactly the chip of the kind the view was read under', () => {
    for (const kind of ['all', 'items', 'money'] as const) {
      const model = buildGuildBankLogView(view({ kind, entries: [entry()] }));
      expect(model.filters.map((f) => f.kind)).toEqual(['all', 'items', 'money']);
      expect(model.filters.filter((f) => f.selected).map((f) => f.kind)).toEqual([kind]);
    }
  });

  it('an empty FILTERED slice is worded as such, never as an untouched bank', () => {
    // "Nothing has been moved" would be false about a bank whose gold moved
    // while the Items chip is pressed; the model carries the distinction.
    expect(buildGuildBankLogView(view({ kind: 'items', entries: [] }))).toEqual({
      filters: guildBankLogFilters('items'),
      kind: 'empty',
      filtered: true,
    });
  });

  it('the footer is the SERVER word on older rows, never inferred from a full page', () => {
    const rows = [entry({ id: 2 }), entry({ id: 1 })];
    const older = buildGuildBankLogView(view({ entries: rows, more: true }));
    const end = buildGuildBankLogView(view({ entries: rows, more: false }));
    const loading = buildGuildBankLogView(view({ entries: rows, more: true, olderPending: true }));
    expect(older.kind === 'rows' && older.footer).toBe('older');
    expect(end.kind === 'rows' && end.footer).toBe('end');
    expect(loading.kind === 'rows' && loading.footer).toBe('loading');
  });

  it('the signature moves with the filter, the oldest row, and the footer', () => {
    const base = view({ entries: [entry({ id: 5 })] });
    const sigs = [
      guildBankLogSignature(base),
      guildBankLogSignature({ ...base, kind: 'money' }),
      guildBankLogSignature({ ...base, more: true }),
      guildBankLogSignature({ ...base, more: true, olderPending: true }),
      // An older page landing: the newest row is unchanged, the oldest moved.
      guildBankLogSignature({ ...base, entries: [entry({ id: 5 }), entry({ id: 2 })] }),
    ];
    expect(new Set(sigs).size).toBe(sigs.length);
  });
});

describe('buildGuildBankLogView: the search over loaded rows', () => {
  const textOf = (row: { actor: string | null; itemId: string | null }) =>
    `${row.actor ?? ''} ${row.itemId ?? ''}`;

  it('draws only the matching rows, keeps the loaded total, and echoes the raw query', () => {
    const v = view({ entries: [entry({ id: 2, actor: 'Bren' }), entry({ id: 1, actor: 'Kara' })] });
    const model = buildGuildBankLogView(v, 'all', { query: '  bReN ', textOf });
    expect(model.kind).toBe('rows');
    if (model.kind !== 'rows') return;
    expect(model.rows.map((r) => r.id)).toEqual([2]);
    expect(model.total).toBe(2);
    expect(model.query).toBe('  bReN ');
  });

  it('an empty or whitespace query draws every row', () => {
    const v = view({ entries: [entry({ id: 2 }), entry({ id: 1 })] });
    for (const query of ['', '   ']) {
      const model = buildGuildBankLogView(v, 'all', { query, textOf });
      expect(model.kind === 'rows' && model.rows.length).toBe(2);
    }
  });

  it('a search with no match is STILL the rows state (the history is loaded), with no rows', () => {
    const v = view({ entries: [entry({ id: 2 })], more: true });
    const model = buildGuildBankLogView(v, 'all', { query: 'nobody', textOf });
    expect(model.kind).toBe('rows');
    if (model.kind !== 'rows') return;
    expect(model.rows).toEqual([]);
    expect(model.total).toBe(1);
    expect(model.footer).toBe('older');
  });

  it('filterGuildBankLogRows preserves order and never mutates its input', () => {
    const v = view({
      entries: [entry({ id: 3, actor: 'Ann' }), entry({ id: 2 }), entry({ id: 1, actor: 'Anna' })],
    });
    const model = buildGuildBankLogView(v);
    if (model.kind !== 'rows') throw new Error('rows expected');
    const frozen = Object.freeze([...model.rows]);
    expect(filterGuildBankLogRows(frozen, { query: 'ann', textOf }).map((r) => r.id)).toEqual([
      3, 1,
    ]);
    expect(filterGuildBankLogRows(frozen, undefined).map((r) => r.id)).toEqual([3, 2, 1]);
  });
});
