// Finding 3: a recipient who has blocked (== ignored) the sender must never
// receive their player mail, and the refusal has to land BEFORE any escrow so no
// copper, postage or items are taken. The enforcement lives server-side in the
// mail_send handler (server/game.ts); the sim PostOffice stays block-agnostic.
// Harness mirrors who_filter.test.ts: mock the db layer, drive real GameServer
// sessions, and read the events pushed to the sender's socket.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { type ClientSession, GameServer } from '../server/game';
import type { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

interface Joined {
  session: ClientSession;
  sent: unknown[];
}

// biome-ignore lint/suspicious/noExplicitAny: the private sim/socialDb seams are reached via a cast in tests.
type AnyServer = any;

function join(server: AnyServer, id: number, name: string, cls: PlayerClass): Joined {
  const sent: unknown[] = [];
  const ws = { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) };
  const session = server.join(ws, id, id, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return { session, sent };
}

function moveToMailbox(sim: Sim, pid: number): void {
  const box = sim.entities.get(sim.postOffice.mailboxIds[0]);
  const p = sim.entities.get(pid);
  if (!box || !p) throw new Error('missing mailbox or player');
  p.pos = { ...box.pos };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

function mailResultCodes(sent: unknown[]): string[] {
  return sent
    .flatMap((m) =>
      (m as { t?: string; list?: unknown[] }).t === 'events' ? (m as { list: unknown[] }).list : [],
    )
    .filter(
      (e): e is { type: string; code: string } => (e as { type?: string }).type === 'mailResult',
    )
    .map((e) => e.code);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function mailSend(server: AnyServer, session: ClientSession, to: string): void {
  server.handleMessage(
    session,
    JSON.stringify({
      t: 'cmd',
      cmd: 'mail_send',
      to,
      subject: 'Hi',
      body: 'there',
      copper: 0,
      items: [],
    }),
  );
}

describe('mail_send block enforcement (finding 3)', () => {
  it('refuses to mail an online recipient who has blocked the sender, taking nothing', () => {
    const server = new GameServer();
    const alice = join(server, 1, 'Alice', 'warrior');
    const bob = join(server, 2, 'Bob', 'mage');
    // Bob has ignored Alice (block == ignore); character ids are the join ids.
    bob.session.blockedIds = new Set([1]);

    const sim = server.sim as Sim;
    const aliceMeta = sim.meta(alice.session.pid);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    moveToMailbox(sim, alice.session.pid);
    alice.sent.length = 0;

    // Blocked: refused before escrow. Least-revealing outcome (no such recipient).
    mailSend(server, alice.session, 'Bob');
    expect(mailResultCodes(alice.sent)).toContain('noRecipient');
    expect(aliceMeta.copper).toBe(10_000); // no postage taken

    // Control: lift the block and the very same send now goes through, escrowing
    // postage (proof the setup was otherwise valid and only the block refused it).
    // The 'sent' mailResult itself rides the sim event stream, delivered on a tick
    // the unit harness does not run, so we assert the synchronous escrow instead.
    bob.session.blockedIds = new Set();
    alice.sent.length = 0;
    mailSend(server, alice.session, 'Bob');
    expect(aliceMeta.copper).toBe(10_000 - 30); // MAIL_POSTAGE taken
  });

  it('refuses to mail an offline recipient who has blocked the sender, taking nothing', async () => {
    const server: AnyServer = new GameServer();
    const alice = join(server, 1, 'Alice', 'warrior');

    const sim = server.sim as Sim;
    const aliceMeta = sim.meta(alice.session.pid);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    moveToMailbox(sim, alice.session.pid);

    // Carol (id 99) is offline; resolve her against a stubbed character db.
    server.socialDb.findCharacterByName = async (name: string) =>
      name.trim().toLowerCase() === 'carol' ? { id: 99, name: 'Carol' } : null;
    let carolBlocks = [1]; // Carol has ignored Alice (character id 1)
    server.socialDb.blockedIds = async (charId: number) => (charId === 99 ? carolBlocks : []);

    alice.sent.length = 0;
    mailSend(server, alice.session, 'Carol');
    await flush();
    expect(mailResultCodes(alice.sent)).toContain('noRecipient');
    expect(aliceMeta.copper).toBe(10_000); // no postage taken

    // Control: Carol lifts the block and the identical offline send now escrows
    // postage (the 'sent' event rides a tick the unit harness does not run).
    carolBlocks = [];
    alice.sent.length = 0;
    mailSend(server, alice.session, 'Carol');
    await flush();
    expect(aliceMeta.copper).toBe(10_000 - 30);
  });
});
