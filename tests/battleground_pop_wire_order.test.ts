// The online arrival order the queue-pop popups must survive, pinned with the
// real server and the real client mirror. In the production loop a tick's
// events frame (carrying bgProposed) is routed BEFORE broadcastSnapshots sends
// the `bg` self readout that carries the offer, so a client that drains its
// event queue on a frame boundary between the two messages sees the event
// while `bgInfo.proposal` is still null. The popups bridge that gap with the
// armed pending state (tests/battleground_proposal_popup.test.ts); this suite
// exists so a change to either half of the ordering is a conscious one.

import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; wire ordering is under test
// (the tests/battleground_wire.test.ts mock, unchanged).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  // bank_ledger.ts (imported via game.ts recordBankOp) reads this at call time.
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { type ClientSession, GameServer } from '../server/game';
import type { SimEvent } from '../src/sim/types';
import { buildBgProposalPopupView } from '../src/ui/hud/battleground/battleground_proposal_view';
import { bareClient, type FakeClient, fakeWs, joinServer } from './helpers/bare_client';

interface WireFrame {
  t?: string;
  list?: SimEvent[];
  self?: { bg?: { proposal?: unknown } | null };
}

function joinBg(server: GameServer, fc: FakeClient, id: number, name: string): ClientSession {
  const session = joinServer(server, fc, id, name);
  const e = server.sim.entities.get(session.pid);
  if (e) e.level = 20;
  return session;
}

function cmd(server: GameServer, session: ClientSession, payload: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...payload }));
}

/** One loop pass in the production ORDER (tick, then events, then snapshots).
 *  Production batches catch-up ticks before one broadcastSnapshots; the pinned
 *  property, events routed before the snapshot broadcast, holds either way. */
function fullTick(server: GameServer): void {
  // biome-ignore lint/suspicious/noExplicitAny: reaches the loop's private steps
  const s = server as any;
  const events = server.sim.tick();
  s.routeEvents(events);
  s.broadcastSnapshots();
}

describe('battleground queue pop wire ordering', () => {
  it('sends the bgProposed events frame before the snapshot carrying the offer', () => {
    const server = new GameServer();
    const clients: { fc: FakeClient; session: ClientSession }[] = [];
    for (let i = 0; i < 10; i++) {
      const fc = fakeWs();
      clients.push({ fc, session: joinBg(server, fc, 100 + i, `Fighter${i}`) });
    }
    for (const { session } of clients) cmd(server, session, { cmd: 'bg_queue' });

    let popped = false;
    for (let t = 0; t < 400 && !popped; t++) {
      fullTick(server);
      popped = clients[0].fc.sent.some(
        (m: WireFrame) => m.t === 'events' && (m.list ?? []).some((ev) => ev.type === 'bgProposed'),
      );
    }
    expect(popped, 'a queue pop opened for the ten queued fighters').toBe(true);

    const sent = clients[0].fc.sent as WireFrame[];
    const evIdx = sent.findIndex(
      (m) => m.t === 'events' && (m.list ?? []).some((ev) => ev.type === 'bgProposed'),
    );
    const snapIdx = sent.findIndex((m) => m.t === 'snap' && m.self?.bg?.proposal);
    expect(evIdx).toBeGreaterThanOrEqual(0);
    expect(snapIdx).toBeGreaterThanOrEqual(0);
    // The ordering the popup's pending state exists for.
    expect(evIdx, 'events frame precedes the offer snapshot').toBeLessThan(snapIdx);

    // Replay into a real ClientWorld the way the browser sees it: every frame
    // up to and including the events frame has arrived, then a frame boundary
    // drains the event queue BEFORE the next message is parsed.
    const client = bareClient(clients[0].session.pid);
    // biome-ignore lint/suspicious/noExplicitAny: drives the private onMessage
    const apply = (frame: WireFrame) => (client as any).onMessage(JSON.stringify(frame));
    for (let i = 0; i <= evIdx; i++) apply(sent[i]);
    const drained = client.drainEvents();
    expect(drained.some((ev) => ev.type === 'bgProposed')).toBe(true);
    // At drain time the offer state has NOT arrived: the popup must arm and
    // wait rather than read this as a resolved offer.
    expect(buildBgProposalPopupView(client.bgInfo)).toBeNull();
    for (let i = evIdx + 1; i <= snapIdx; i++) apply(sent[i]);
    expect(buildBgProposalPopupView(client.bgInfo)).not.toBeNull();
  });
});
