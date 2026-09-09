// The copy anchor over the LIVE wire: the frames ClientWorld emits for the
// discard-class commands, fed verbatim into the real GameServer dispatch (the
// feast_online.test.ts idiom), so a field-name skew between the sender and the
// reader can only red here.
//
// The behavior under test is MIRROR DIVERGENCE, which is the only reason the
// anchor exists. A client's bags can lag the authority by a snapshot; when they
// do, the index the player clicked can still name a live cell of the right item
// id on the server while naming a DIFFERENT COPY. The index check accepts that
// and the wrong copy is destroyed, sold or locked, silently. The anchor is what
// turns it into a refusal.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  loadGuildBankRow: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import type { ClientSession, GameServer as GameServerType } from '../server/game';
import { GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import type { InvSlot } from '../src/sim/types';
import { fakeWs, joinServer } from './helpers/bare_client';

class StubWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = StubWebSocket.OPEN;
  sent: string[] = [];
  static last: StubWebSocket | null = null;
  constructor(public readonly url: string) {
    StubWebSocket.last = this;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = StubWebSocket.CLOSED;
  }
}

function withClient(fn: (world: ClientWorld, sock: StubWebSocket) => void): void {
  const g = globalThis as Record<string, unknown>;
  const prevWebSocket = g.WebSocket;
  const prevWindow = g.window;
  g.WebSocket = StubWebSocket as unknown;
  g.window = {
    setInterval: () => 0,
    clearInterval: () => undefined,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  };
  try {
    const world = new ClientWorld('anchor-token', 1, 'warrior', 'http://x');
    const sock = StubWebSocket.last;
    if (!sock) throw new Error('ClientWorld opened no socket');
    (world as unknown as { onMessage(raw: string): void }).onMessage(
      JSON.stringify({ t: 'hello', pid: 1, seed: 20061 }),
    );
    sock.sent.length = 0;
    try {
      fn(world, sock);
    } finally {
      world.close();
    }
  } finally {
    g.WebSocket = prevWebSocket;
    g.window = prevWindow;
  }
}

/** The one raw frame a fresh real ClientWorld emits for `send`. */
function captureFrame(send: (world: ClientWorld) => void): string {
  let raw = '';
  withClient((world, sock) => {
    send(world);
    if (sock.sent.length !== 1) throw new Error(`expected one frame, got ${sock.sent.length}`);
    raw = sock.sent[0];
  });
  return raw;
}

function frameOf(send: (world: ClientWorld) => void): Record<string, unknown> {
  return JSON.parse(captureFrame(send)) as Record<string, unknown>;
}

const ENCHANTED = { enchant: { id: 'ench_str', stat: 'str', value: 4 } } as never;
const ITEM = 'wolf_fang';

function bagsOf(server: GameServerType, pid: number): InvSlot[] {
  const meta = server.sim.players.get(pid);
  if (!meta) throw new Error('no meta');
  return meta.inventory as InvSlot[];
}

/** A joined session holding an ENCHANTED copy at a lower index and a plain copy
 *  above it: distinct payloads never merge, so they occupy separate slots. */
function worldWithTwoCopies(): {
  server: GameServerType;
  session: ClientSession;
  pid: number;
} {
  const server = new GameServer();
  const fc = fakeWs();
  const session: ClientSession = joinServer(server, fc, 1, 'Owner');
  const pid = session.pid as number;
  server.sim.addItemInstance(ITEM, ENCHANTED, pid, 1, { silent: true });
  server.sim.addItem(ITEM, 1, pid);
  return { server, session, pid };
}

function indexOfCopy(server: GameServerType, pid: number, enchanted: boolean): number {
  return bagsOf(server, pid).findIndex(
    (s) => s.itemId === ITEM && (s.instance?.enchant !== undefined) === enchanted,
  );
}

beforeEach(() => {
  expect(process.env.ALLOW_DEV_COMMANDS).toBeUndefined();
});

describe('the discard-class frames carry the anchor, and only when given one', () => {
  it('an UNANCHORED command is byte-identical to what it always sent', () => {
    // The compatibility half: an older client, and any caller that names no
    // anchor, must produce exactly the frame they produced before.
    expect(frameOf((w) => w.discardItem(ITEM, 1, { slotIndex: 2 }))).toEqual({
      t: 'cmd',
      cmd: 'discard',
      item: ITEM,
      count: 1,
      slot: 2,
    });
    expect(frameOf((w) => w.sellItem(ITEM, 1, { slotIndex: 2 }))).toEqual({
      t: 'cmd',
      cmd: 'sell',
      item: ITEM,
      count: 1,
      slot: 2,
    });
    expect(frameOf((w) => w.setItemLocked(ITEM, true, { slotIndex: 2 }))).toEqual({
      t: 'cmd',
      cmd: 'lock_item',
      item: ITEM,
      locked: true,
      slot: 2,
    });
  });

  it('an ANCHORED command adds exactly ord and n', () => {
    const anchor = { ordinal: 1, count: 3 };
    expect(frameOf((w) => w.discardItem(ITEM, 1, { slotIndex: 2, anchor }))).toEqual({
      t: 'cmd',
      cmd: 'discard',
      item: ITEM,
      count: 1,
      slot: 2,
      ord: 1,
      n: 3,
    });
    expect(frameOf((w) => w.sellItem(ITEM, 1, { slotIndex: 2, anchor }))).toEqual({
      t: 'cmd',
      cmd: 'sell',
      item: ITEM,
      count: 1,
      slot: 2,
      ord: 1,
      n: 3,
    });
    expect(frameOf((w) => w.setItemLocked(ITEM, false, { slotIndex: 2, anchor }))).toEqual({
      t: 'cmd',
      cmd: 'lock_item',
      item: ITEM,
      locked: false,
      slot: 2,
      ord: 0 + 1,
      n: 3,
    });
  });

  it('ordinal 0 rides the wire (a falsy ordinal is a real sibling)', () => {
    // The omit-when-default trap: the FIRST sibling is ordinal 0, and a
    // truthiness gate would silently drop the anchor for it.
    const frame = frameOf((w) =>
      w.discardItem(ITEM, 1, { slotIndex: 0, anchor: { ordinal: 0, count: 2 } }),
    );
    expect(frame.ord).toBe(0);
    expect(frame.n).toBe(2);
  });
});

describe('the server refuses a DIVERGED selection and honors a live one', () => {
  it('discard: a stale anchor destroys nothing, a live one destroys the named copy', () => {
    const { server, session, pid } = worldWithTwoCopies();
    const plainIndex = indexOfCopy(server, pid, false);
    expect(plainIndex).toBeGreaterThanOrEqual(0);

    // The mirror the client was looking at had THREE copies; the server has
    // two. The index still names a live `wolf_fang`, so the id check passes and
    // the pre-anchor command would have destroyed it.
    server.handleMessage(
      session,
      captureFrame((w) =>
        w.discardItem(ITEM, 1, { slotIndex: plainIndex, anchor: { ordinal: 2, count: 3 } }),
      ),
    );
    expect(server.sim.countItem(ITEM, pid)).toBe(2);

    // The SAME command with the anchor the server's own bags produce lands.
    const live = bagsOf(server, pid);
    const ordinal = live.slice(0, plainIndex).filter((s) => s.itemId === ITEM).length;
    const count = live.filter((s) => s.itemId === ITEM).length;
    server.handleMessage(
      session,
      captureFrame((w) =>
        w.discardItem(ITEM, 1, { slotIndex: plainIndex, anchor: { ordinal, count } }),
      ),
    );
    expect(server.sim.countItem(ITEM, pid)).toBe(1);
    // And it took the PLAIN copy, leaving the enchanted one standing.
    expect(bagsOf(server, pid).find((s) => s.itemId === ITEM)?.instance?.enchant).toBeDefined();
  });

  it('lock_item: a stale anchor flips nothing, a live one flips the named copy', () => {
    const { server, session, pid } = worldWithTwoCopies();
    const enchantedIndex = indexOfCopy(server, pid, true);

    server.handleMessage(
      session,
      captureFrame((w) =>
        w.setItemLocked(ITEM, true, {
          slotIndex: enchantedIndex,
          anchor: { ordinal: 1, count: 5 },
        }),
      ),
    );
    expect(bagsOf(server, pid)[enchantedIndex].instance?.locked).toBeUndefined();

    const live = bagsOf(server, pid);
    const ordinal = live.slice(0, enchantedIndex).filter((s) => s.itemId === ITEM).length;
    const count = live.filter((s) => s.itemId === ITEM).length;
    server.handleMessage(
      session,
      captureFrame((w) =>
        w.setItemLocked(ITEM, true, { slotIndex: enchantedIndex, anchor: { ordinal, count } }),
      ),
    );
    expect(bagsOf(server, pid)[enchantedIndex].instance?.locked).toBe(true);
  });

  it('an UNANCHORED command still lands, so the anchor never became mandatory', () => {
    // The compatibility half again, this time end to end: an older client's
    // frame must keep working exactly as it did.
    const { server, session, pid } = worldWithTwoCopies();
    const plainIndex = indexOfCopy(server, pid, false);
    server.handleMessage(
      session,
      captureFrame((w) => w.discardItem(ITEM, 1, { slotIndex: plainIndex })),
    );
    expect(server.sim.countItem(ITEM, pid)).toBe(1);
  });

  it('a MALFORMED anchor degrades to the unanchored path, never to a wrong copy', () => {
    // The dispatch boundary drops a pair that cannot describe any bag, so the
    // command behaves as if none was sent rather than refusing forever.
    const { server, session, pid } = worldWithTwoCopies();
    const plainIndex = indexOfCopy(server, pid, false);
    const frame = JSON.parse(
      captureFrame((w) =>
        w.discardItem(ITEM, 1, { slotIndex: plainIndex, anchor: { ordinal: 0, count: 2 } }),
      ),
    ) as Record<string, unknown>;
    frame.ord = 'nope';
    server.handleMessage(session, JSON.stringify(frame));
    expect(server.sim.countItem(ITEM, pid)).toBe(1);
  });
});
