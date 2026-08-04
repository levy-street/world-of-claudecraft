// The guild bank activity log's WIRE half: the `gbanklog` frame decoder
// (src/net/guild_bank_log_wire.ts) and its round trip through the real
// ClientWorld mirror (src/net/online.ts), plus the on-demand fetch contract
// that keeps this cold payload off the 20 Hz stream.
//
// The contract this pins, end to end: reading guildBankLog() is what REQUESTS
// the log; a repaint inside the TTL sends nothing; a response installs rows; a
// refusal keeps saying "refused" instead of degrading into an empty history;
// and losing the guild bank gate drops the rows outright rather than letting
// one guild's history paint into the next pane that opens.
import { describe, expect, it } from 'vitest';

import {
  decodeGuildBankLogFrame,
  GUILD_BANK_LOG_MAX_ROWS,
  GUILD_BANK_LOG_TTL_MS,
} from '../src/net/guild_bank_log_wire';
import { ClientWorld } from '../src/net/online';

const AT = 1_770_000_000_000;

const wireRow = (over: Record<string, unknown> = {}) => ({
  id: 5,
  at: AT,
  actor: 'Kara',
  op: 'withdraw',
  itemId: 'iron_ore',
  count: 3,
  copper: null,
  ...over,
});

// --- harness: a real ClientWorld, DOM/network-free (target_echo_client idiom) ---

class StubWebSocket {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = StubWebSocket.OPEN;
  constructor(public readonly url: string) {}
  send(): void {
    /* sends are captured by patching cmd() below */
  }
  close(): void {
    /* no real socket */
  }
}

function withDomStubs<T>(fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const prevWebSocket = g.WebSocket;
  const prevWindow = g.window;
  g.WebSocket = StubWebSocket as unknown;
  g.window = { setInterval: () => 0, clearInterval: () => undefined };
  try {
    return fn();
  } finally {
    g.WebSocket = prevWebSocket;
    g.window = prevWindow;
  }
}

interface ClientInternals {
  onMessage(raw: string): void;
  applySnapshot(snap: unknown): void;
  cmd(payload: { cmd: string } & Record<string, unknown>): void;
}

function makeWorld(): { world: ClientWorld; wire: ClientInternals; sends: string[] } {
  const world = withDomStubs(() => {
    const w = new ClientWorld('gbank-log-token', 1, 'warrior', 'http://localhost');
    w.close();
    return w;
  });
  const wire = world as unknown as ClientInternals;
  const sends: string[] = [];
  // Record the wire tokens without a socket: cmd() is the one send funnel.
  wire.cmd = (payload) => {
    sends.push(payload.cmd);
  };
  return { world, wire, sends };
}

const frame = (body: Record<string, unknown>) => JSON.stringify({ t: 'gbanklog', ...body });

// One snapshot as the server broadcasts it: the self record is a full wireEntity
// (target_echo_client's fixture shape) carrying the delta-omitted `guildBank`
// key, which is the mirror's gate signal.
function selfSnap(guildBank: unknown): unknown {
  return {
    t: 'snap',
    ents: [],
    self: {
      id: 1,
      k: 'player',
      tid: 'warrior',
      nm: 'Me',
      lv: 12,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
      guildBank,
    },
  };
}

describe('decodeGuildBankLogFrame', () => {
  it('ignores a frame that is not a gbanklog frame', () => {
    expect(decodeGuildBankLogFrame({ t: 'snap' })).toBeNull();
    expect(decodeGuildBankLogFrame(null)).toBeNull();
    expect(decodeGuildBankLogFrame('gbanklog')).toBeNull();
  });

  it('decodes a success frame into entries', () => {
    const decoded = decodeGuildBankLogFrame({ t: 'gbanklog', ok: true, entries: [wireRow()] });
    expect(decoded).toEqual({
      refused: false,
      entries: [
        {
          id: 5,
          at: AT,
          actor: 'Kara',
          op: 'withdraw',
          itemId: 'iron_ore',
          count: 3,
          copper: null,
        },
      ],
    });
  });

  it('a refusal decodes to zero entries even when the payload claimed rows', () => {
    // A refusal must never be able to smuggle history onto the pane.
    expect(decodeGuildBankLogFrame({ t: 'gbanklog', ok: false, entries: [wireRow()] })).toEqual({
      refused: true,
      entries: [],
    });
  });

  it('drops a row whose op is not renderable, the diagnostic ops included', () => {
    // The client re-states the server's allowlist independently, so a server
    // that ever regressed could still not render operator forensics as guild
    // history.
    for (const op of ['escrow_deficit', 'counterparty_orphan', 'made_up']) {
      const decoded = decodeGuildBankLogFrame({
        t: 'gbanklog',
        ok: true,
        entries: [wireRow({ op })],
      });
      expect(decoded?.entries, `op ${op}`).toEqual([]);
    }
  });

  it('drops a structurally malformed row rather than rendering undefined', () => {
    const bad = [
      wireRow({ id: 'five' }),
      wireRow({ id: 0 }),
      wireRow({ at: 'now' }),
      wireRow({ op: 42 }),
      'not an object',
      null,
    ];
    for (const row of bad) {
      expect(decodeGuildBankLogFrame({ t: 'gbanklog', ok: true, entries: [row] })?.entries).toEqual(
        [],
      );
    }
  });

  it('nulls an empty, over-long, or non-string actor rather than rendering a blank name', () => {
    for (const actor of ['', 'x'.repeat(65), 7, null, undefined]) {
      const decoded = decodeGuildBankLogFrame({
        t: 'gbanklog',
        ok: true,
        entries: [wireRow({ actor })],
      });
      expect(decoded?.entries[0]?.actor, JSON.stringify(actor)).toBeNull();
    }
  });

  it('carries a name with markup in it VERBATIM (escaping is the DOM text sink, not a rewrite)', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const decoded = decodeGuildBankLogFrame({
      t: 'gbanklog',
      ok: true,
      entries: [wireRow({ actor: hostile })],
    });
    expect(decoded?.entries[0]?.actor).toBe(hostile);
  });

  it('truncates past the server window rather than pasting an unbounded list', () => {
    const rows = Array.from({ length: GUILD_BANK_LOG_MAX_ROWS + 25 }, (_, i) =>
      wireRow({ id: i + 1 }),
    );
    const decoded = decodeGuildBankLogFrame({ t: 'gbanklog', ok: true, entries: rows });
    expect(decoded?.entries.length).toBe(GUILD_BANK_LOG_MAX_ROWS);
  });

  it('tolerates a missing entries array', () => {
    expect(decodeGuildBankLogFrame({ t: 'gbanklog', ok: true })).toEqual({
      refused: false,
      entries: [],
    });
  });
});

describe('ClientWorld.guildBankLog: the on-demand round trip', () => {
  it('the first read REQUESTS the log and reports loading', () => {
    const { world, sends } = makeWorld();
    expect(world.guildBankLog()).toEqual({ state: 'loading', entries: [] });
    expect(sends).toEqual(['guild_bank_log']);
  });

  it('a repaint inside the TTL sends nothing (a per-frame read is not a poll)', () => {
    const { world, sends } = makeWorld();
    world.guildBankLog();
    world.guildBankLog();
    world.guildBankLog();
    expect(sends).toEqual(['guild_bank_log']);
  });

  it('the response installs the rows and flips to ready', () => {
    const { world, wire } = makeWorld();
    world.guildBankLog();
    wire.onMessage(frame({ ok: true, entries: [wireRow({ id: 9 }), wireRow({ id: 8 })] }));
    const view = world.guildBankLog();
    expect(view.state).toBe('ready');
    expect(view.entries.map((e) => e.id)).toEqual([9, 8]);
  });

  it('an empty success is READY-and-empty, never stuck on loading', () => {
    const { world, wire } = makeWorld();
    world.guildBankLog();
    wire.onMessage(frame({ ok: true, entries: [] }));
    expect(world.guildBankLog()).toEqual({ state: 'ready', entries: [] });
  });

  it('a refusal reports refused and KEEPS reporting it (never degrades to empty-ready)', () => {
    const { world, wire } = makeWorld();
    world.guildBankLog();
    wire.onMessage(frame({ ok: false }));
    expect(world.guildBankLog().state).toBe('refused');
    expect(world.guildBankLog().state).toBe('refused');
  });

  it('a background refresh past the TTL re-requests while still serving the installed rows', () => {
    const { world, wire, sends } = makeWorld();
    world.guildBankLog();
    wire.onMessage(frame({ ok: true, entries: [wireRow({ id: 9 })] }));
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + GUILD_BANK_LOG_TTL_MS + 1;
      const view = world.guildBankLog();
      expect(sends).toEqual(['guild_bank_log', 'guild_bank_log']);
      // No blink: the installed answer keeps serving while the refresh is out.
      expect(view.state).toBe('ready');
      expect(view.entries.map((e) => e.id)).toEqual([9]);
    } finally {
      Date.now = realNow;
    }
  });

  it('a response that never arrives ages out into exactly one retry (no wedged loading)', () => {
    const { world, sends } = makeWorld();
    world.guildBankLog();
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + GUILD_BANK_LOG_TTL_MS + 1;
      expect(world.guildBankLog().state).toBe('loading');
      expect(sends.length).toBe(2);
      expect(world.guildBankLog().state).toBe('loading');
      expect(sends.length).toBe(2);
    } finally {
      Date.now = realNow;
    }
  });

  const GATE = {
    treasury: 0,
    slots: [],
    capacity: 24,
    purchasedSlots: 24,
    nextExpansionPrice: 25_000,
  };

  it('losing the guild bank gate DROPS the installed rows and re-arms the request', () => {
    // The rows belong to one guild read under a rank this client may no longer
    // hold (walked away, demoted, left, switched guild), so they must never
    // survive into the next pane that opens.
    const { world, wire, sends } = makeWorld();
    wire.applySnapshot(selfSnap(GATE)); // standing at the banker, officer-plus
    world.guildBankLog();
    wire.onMessage(frame({ ok: true, entries: [wireRow({ id: 9 })] }));
    expect(world.guildBankLog().entries.length).toBe(1);
    wire.applySnapshot(selfSnap(null));
    expect(world.guildBankInfo).toBeNull();
    const after = world.guildBankLog();
    expect(after).toEqual({ state: 'loading', entries: [] });
    expect(sends.length).toBe(2); // the reset re-armed the request gate
  });

  it('a snapshot that still carries the gate leaves the installed rows alone', () => {
    const { world, wire } = makeWorld();
    wire.applySnapshot(selfSnap(GATE));
    world.guildBankLog();
    wire.onMessage(frame({ ok: true, entries: [wireRow({ id: 9 })] }));
    wire.applySnapshot(selfSnap(GATE)); // no transition: nothing is reset
    expect(world.guildBankLog().entries.map((e) => e.id)).toEqual([9]);
  });

  it('REGAINING the gate re-arms too, so a refusal taken without it self-corrects', () => {
    // REGRESSION: the reset fired only on the NULL edge, so an officer who
    // opened the log away from the banker got `refused`, walked up, and the
    // pane went on saying refused for the rest of the TTL. The answer was
    // taken while the gate was shut, so regaining it must invalidate it.
    const { world, wire, sends } = makeWorld();
    world.guildBankLog(); // opened away from the banker
    wire.onMessage(frame({ ok: false }));
    expect(world.guildBankLog().state).toBe('refused');
    expect(sends.length).toBe(1);

    wire.applySnapshot(selfSnap(GATE)); // walked up to the banker
    // One paint later the pane is loading a fresh answer, not still refused.
    expect(world.guildBankLog()).toEqual({ state: 'loading', entries: [] });
    expect(sends.length).toBe(2);
    wire.onMessage(frame({ ok: true, entries: [wireRow({ id: 9 })] }));
    expect(world.guildBankLog().state).toBe('ready');
  });
});
