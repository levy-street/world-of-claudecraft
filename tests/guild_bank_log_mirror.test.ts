// The guild bank transaction history's CLIENT mirror
// (src/net/guild_bank_log_mirror.ts): the state machine behind
// IWorld.guildBankLog() / guildBankLogOlder() on the online world, driven here
// with an injected clock and no socket.
//
// What this pins, and why each rule is load-bearing on a trust surface:
//   - the newest window is re-requested once per TTL and never per read;
//   - an older page is asked for once, only when there is something to ask;
//   - answers are matched to the question (kind + cursor) and stale ones are
//     DROPPED, so rows gathered under one filter never show under another;
//   - a newest-window refresh keeps loaded older pages only when it is
//     contiguous with them, and starts over when there is a gap (a history
//     with a silent hole is exactly what must never render);
//   - a refusal wipes everything; a reset re-arms both gates.
import { describe, expect, it } from 'vitest';

import { GuildBankLogMirror } from '../src/net/guild_bank_log_mirror';
import { GUILD_BANK_LOG_TTL_MS } from '../src/net/guild_bank_log_wire';

const AT = 1_770_000_000_000;

const row = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  at: AT,
  actor: 'Kara',
  op: 'deposit',
  itemId: 'iron_ore',
  count: 1,
  copper: null,
  ...over,
});

const ok = (
  entries: ReturnType<typeof row>[],
  over: { kind?: string; before?: number | null; more?: boolean } = {},
) => ({
  t: 'gbanklog',
  ok: true,
  kind: 'all',
  before: null,
  more: false,
  entries,
  ...over,
});

const ids = (m: GuildBankLogMirror, now = 0) => m.read('all', now).view.entries.map((e) => e.id);

describe('GuildBankLogMirror: the newest-window request gate', () => {
  it('the first read requests the newest window and reports loading', () => {
    const m = new GuildBankLogMirror();
    const { view, request } = m.read('all', 1_000);
    expect(request).toEqual({ cmd: 'guild_bank_log', kind: 'all' });
    expect(view).toEqual({
      state: 'loading',
      kind: 'all',
      entries: [],
      more: false,
      olderPending: false,
    });
  });

  it('a read inside the TTL sends nothing; one past it sends exactly one more', () => {
    const m = new GuildBankLogMirror();
    m.read('all', 1_000);
    expect(m.read('all', 1_001).request).toBeNull();
    expect(m.read('all', 1_000 + GUILD_BANK_LOG_TTL_MS - 1).request).toBeNull();
    expect(m.read('all', 1_000 + GUILD_BANK_LOG_TTL_MS).request).not.toBeNull();
    expect(m.read('all', 1_000 + GUILD_BANK_LOG_TTL_MS + 1).request).toBeNull();
  });

  it('a refresh keeps serving the installed rows (no blink back to loading)', () => {
    const m = new GuildBankLogMirror();
    m.read('all', 0);
    m.receive(ok([row(9)]));
    const { view, request } = m.read('all', GUILD_BANK_LOG_TTL_MS);
    expect(request).not.toBeNull();
    expect(view.state).toBe('ready');
    expect(view.entries.map((e) => e.id)).toEqual([9]);
  });

  it('reading a DIFFERENT kind drops the pages and requests that kind at once', () => {
    const m = new GuildBankLogMirror();
    m.read('all', 0);
    m.receive(ok([row(9)]));
    const { view, request } = m.read('money', 1);
    expect(request).toEqual({ cmd: 'guild_bank_log', kind: 'money' });
    expect(view.state).toBe('loading');
    expect(view.entries).toEqual([]);
    expect(view.kind).toBe('money');
  });

  it('ignores a non-gbanklog message', () => {
    const m = new GuildBankLogMirror();
    expect(m.receive({ t: 'snap' })).toBe(false);
    expect(m.receive(null)).toBe(false);
  });
});

describe('GuildBankLogMirror: matching answers to questions', () => {
  it('drops an answer for a kind that is no longer being read', () => {
    // The pane switched from All to Money while the All answer was in flight:
    // installing it under the Money label would show gold history that is
    // not gold history.
    const m = new GuildBankLogMirror();
    m.read('all', 0);
    m.read('money', 1);
    m.receive(ok([row(9)], { kind: 'all' }));
    expect(m.read('money', 2).view.state).toBe('loading');
    m.receive(
      ok([row(5, { op: 'deposit_gold', itemId: null, count: null, copper: 100 })], {
        kind: 'money',
      }),
    );
    expect(m.read('money', 3).view.entries.map((e) => e.id)).toEqual([5]);
  });

  it('a frame from a pre-paging server (no kind, no before, no more) is the whole history', () => {
    const m = new GuildBankLogMirror();
    m.read('all', 0);
    m.receive({ t: 'gbanklog', ok: true, entries: [row(2), row(1)] });
    const view = m.read('all', 1).view;
    expect(view.entries.map((e) => e.id)).toEqual([2, 1]);
    expect(view.more).toBe(false);
  });

  it('accepts a pre-paging frame under ANY chip rather than sitting on loading forever', () => {
    // A server that predates paging states no kind. Under Items or Money a
    // strict kind match would drop it, re-request once per TTL and drop it
    // again, with the pane on loading and no refusal to explain it.
    const m = new GuildBankLogMirror();
    m.read('money', 0);
    m.receive({ t: 'gbanklog', ok: true, entries: [row(2), row(1)] });
    const view = m.read('money', 1).view;
    expect(view.state).toBe('ready');
    expect(view.entries.map((e) => e.id)).toEqual([2, 1]);
  });

  it('a refusal wipes every page and keeps reporting refused', () => {
    const m = new GuildBankLogMirror();
    m.read('all', 0);
    m.receive(ok([row(9), row(8)], { more: true }));
    m.requestOlder(1);
    m.receive({ t: 'gbanklog', ok: false });
    const view = m.read('all', 2).view;
    expect(view).toEqual({
      state: 'refused',
      kind: 'all',
      entries: [],
      more: false,
      olderPending: false,
    });
    expect(m.read('all', 3).view.state).toBe('refused');
  });

  it('reset drops the pages, re-arms the request gate, and keeps the filter choice', () => {
    const m = new GuildBankLogMirror();
    m.read('items', 0);
    m.receive(ok([row(9)], { kind: 'items' }));
    m.reset();
    const { view, request } = m.read('items', 1);
    expect(view.state).toBe('loading');
    expect(view.entries).toEqual([]);
    expect(view.kind).toBe('items');
    expect(request).toEqual({ cmd: 'guild_bank_log', kind: 'items' });
  });
});

describe('GuildBankLogMirror: older pages', () => {
  function loaded(more = true): GuildBankLogMirror {
    const m = new GuildBankLogMirror();
    m.read('all', 0);
    m.receive(ok([row(9), row(8)], { more }));
    return m;
  }

  it('asks for the rows before the OLDEST loaded id, once, and reports the page pending', () => {
    const m = loaded();
    expect(m.requestOlder(1)).toEqual({ cmd: 'guild_bank_log', kind: 'all', before: 8 });
    expect(m.read('all', 2).view.olderPending).toBe(true);
    // A second click while the first is in flight sends nothing.
    expect(m.requestOlder(3)).toBeNull();
  });

  it('has nothing to ask for when the server said the loaded rows reach the start', () => {
    expect(loaded(false).requestOlder(1)).toBeNull();
  });

  it('has nothing to ask for before any answer, or after a refusal', () => {
    const m = new GuildBankLogMirror();
    m.read('all', 0);
    expect(m.requestOlder(1)).toBeNull();
    m.receive({ t: 'gbanklog', ok: false });
    expect(m.requestOlder(2)).toBeNull();
  });

  it('appends the older page below the loaded rows and takes its `more` as the new word', () => {
    const m = loaded();
    m.requestOlder(1);
    m.receive(ok([row(6), row(5)], { before: 8, more: false }));
    const view = m.read('all', 2).view;
    expect(view.entries.map((e) => e.id)).toEqual([9, 8, 6, 5]);
    expect(view.more).toBe(false);
    expect(view.olderPending).toBe(false);
    expect(m.requestOlder(3)).toBeNull();
  });

  it('pages on from the new oldest id', () => {
    const m = loaded();
    m.requestOlder(1);
    m.receive(ok([row(6), row(5)], { before: 8, more: true }));
    expect(m.requestOlder(2)).toEqual({ cmd: 'guild_bank_log', kind: 'all', before: 5 });
  });

  it('drops an older page nobody is waiting on (a stale or duplicate cursor)', () => {
    const m = loaded();
    m.receive(ok([row(6)], { before: 8 })); // never asked
    expect(ids(m, 1)).toEqual([9, 8]);
    m.requestOlder(2);
    m.receive(ok([row(6)], { before: 7 })); // a different cursor
    expect(ids(m, 3)).toEqual([9, 8]);
    expect(m.read('all', 4).view.olderPending).toBe(true);
  });

  it('never installs a row at or above the cursor from an older-page answer', () => {
    const m = loaded();
    m.requestOlder(1);
    m.receive(ok([row(9), row(8), row(6)], { before: 8 }));
    expect(ids(m, 2)).toEqual([9, 8, 6]);
  });

  it('an older-page request that never answered ages into a retry', () => {
    const m = loaded();
    m.requestOlder(1);
    expect(m.requestOlder(2)).toBeNull();
    m.read('all', 1 + GUILD_BANK_LOG_TTL_MS);
    expect(m.read('all', 1 + GUILD_BANK_LOG_TTL_MS).view.olderPending).toBe(false);
    expect(m.requestOlder(1 + GUILD_BANK_LOG_TTL_MS)).not.toBeNull();
  });
});

describe('GuildBankLogMirror: merging a newest-window refresh over loaded pages', () => {
  function withPages(): GuildBankLogMirror {
    const m = new GuildBankLogMirror();
    m.read('all', 0);
    m.receive(ok([row(9), row(8)], { more: true }));
    m.requestOlder(1);
    m.receive(ok([row(6), row(5)], { before: 8, more: true }));
    return m;
  }

  it('an overlapping refresh keeps the older pages and prepends the new rows', () => {
    const m = withPages();
    m.receive(ok([row(11), row(9), row(8)], { more: true }));
    const view = m.read('all', 2).view;
    expect(view.entries.map((e) => e.id)).toEqual([11, 9, 8, 6, 5]);
    // `more` stays the OLDEST page's word, not the window's.
    expect(view.more).toBe(true);
  });

  it('an identical refresh changes nothing', () => {
    const m = withPages();
    m.receive(ok([row(9), row(8)], { more: true }));
    expect(ids(m, 2)).toEqual([9, 8, 6, 5]);
  });

  it('a refresh with NO overlap and more rows behind it starts over (never a silent hole)', () => {
    // More than a window's worth of ops landed since the pages were read:
    // nothing below the window is known to be contiguous with it.
    const m = withPages();
    m.receive(ok([row(30), row(29)], { more: true }));
    const view = m.read('all', 2).view;
    expect(view.entries.map((e) => e.id)).toEqual([30, 29]);
    expect(view.more).toBe(true);
  });

  it('a refresh that IS the whole history replaces the pages', () => {
    const m = withPages();
    m.receive(ok([row(9), row(8), row(6), row(5)], { more: false }));
    const view = m.read('all', 2).view;
    expect(view.entries.map((e) => e.id)).toEqual([9, 8, 6, 5]);
    expect(view.more).toBe(false);
  });

  it('an older page landing under a refresh that replaced the rows is DROPPED, never seated as a hole', () => {
    // The review's probe: head 200..151 (more), Show older sends cursor 151,
    // the TTL refresh answers 260..211 with no overlap (sixty ops landed) and
    // replaces the rows, then the page for 151 arrives. Appending 150..101
    // under 260..211 would seat a hole (210..151 missing) that every later
    // overlapping refresh preserves. The page is dropped, the footer offers
    // older rows again from the NEW oldest id, and `more` stays the head's.
    const m = new GuildBankLogMirror();
    m.read('all', 0);
    const head = Array.from({ length: 50 }, (_, i) => row(200 - i));
    m.receive(ok(head, { more: true }));
    expect(m.requestOlder(1)).toEqual({ cmd: 'guild_bank_log', kind: 'all', before: 151 });
    const refreshed = Array.from({ length: 50 }, (_, i) => row(260 - i));
    m.receive(ok(refreshed, { more: true }));
    // The in-flight older request is forgotten with the rows it belonged to.
    expect(m.read('all', 2).view.olderPending).toBe(false);
    const stale = Array.from({ length: 50 }, (_, i) => row(150 - i));
    m.receive(ok(stale, { before: 151, more: false }));
    const view = m.read('all', 3).view;
    expect(view.entries.map((e) => e.id)).toEqual(refreshed.map((r) => r.id));
    expect(view.more).toBe(true);
    expect(m.requestOlder(4)).toEqual({ cmd: 'guild_bank_log', kind: 'all', before: 211 });
  });

  it('an older page whose cursor is no longer the oldest loaded id is dropped even if still pending', () => {
    // Belt and braces for the same race: even if the pending cursor were kept,
    // a page is appended only under the row it was asked below.
    const m = new GuildBankLogMirror();
    m.read('all', 0);
    m.receive(ok([row(9), row(8)], { more: true }));
    m.requestOlder(1);
    // A contiguous refresh that adds a NEWER row keeps the pages and the pending
    // cursor: the oldest loaded id is still 8, so the page still fits.
    m.receive(ok([row(10), row(9), row(8)], { more: true }));
    expect(m.read('all', 2).view.olderPending).toBe(true);
    m.receive(ok([row(6)], { before: 8, more: false }));
    expect(ids(m, 3)).toEqual([10, 9, 8, 6]);
  });

  it('an empty refresh over loaded rows yields an empty ready history', () => {
    const m = withPages();
    m.receive(ok([], { more: false }));
    const view = m.read('all', 2).view;
    expect(view.state).toBe('ready');
    expect(view.entries).toEqual([]);
  });
});
