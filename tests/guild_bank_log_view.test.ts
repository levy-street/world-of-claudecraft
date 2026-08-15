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

const ready = (entries: GuildBankLogEntry[]): GuildBankLogView => ({ state: 'ready', entries });

describe('buildGuildBankLogView: the three non-row states are distinct', () => {
  it('no answer yet renders LOADING, never an empty history', () => {
    expect(buildGuildBankLogView({ state: 'loading', entries: [] })).toEqual({ kind: 'loading' });
  });

  it('a refusal renders REFUSED, never an empty history', () => {
    // The decisive half: "you may not read this" and "nobody has done anything"
    // are opposite facts, so the refusal must not collapse into 'empty'.
    const model = buildGuildBankLogView({ state: 'refused', entries: [] });
    expect(model).toEqual({ kind: 'refused' });
    expect(model.kind).not.toBe('empty');
  });

  it('a refusal that somehow carried rows STILL renders refused (rows are not shown)', () => {
    expect(buildGuildBankLogView({ state: 'refused', entries: [entry()] })).toEqual({
      kind: 'refused',
    });
  });

  it('an answer with nothing in it renders EMPTY, not loading', () => {
    expect(buildGuildBankLogView(ready([]))).toEqual({ kind: 'empty' });
  });

  it('a background refresh keeps showing the installed rows (no blink back to loading)', () => {
    const model = buildGuildBankLogView({ state: 'loading', entries: [entry()] });
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
      kind: 'empty',
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
    const loading = guildBankLogSignature({ state: 'loading', entries: [] });
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
    expect(offline).toEqual({ state: 'ready', entries: [] });
    expect(Object.isFrozen(offline)).toBe(true);
    expect(buildGuildBankLogView(offline)).toEqual({ kind: 'empty' });
    expect(guildBankLogSignature(offline)).toBe('ready:0:0');
    // The same instance comes back untouched for the next caller.
    expect(sim.guildBankLog()).toBe(offline);
  });
});
