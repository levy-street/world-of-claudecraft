// The paperdoll helmet-visibility eye (src/sim/helm_visibility.ts + the
// set_helm wire command): idempotent setter, JSONB persistence back-compat,
// and the entity-wire `hh` bit end to end (server encode -> ClientWorld
// decode). The stow test's harness, minus the dead-gate and combat rules the
// preference deliberately does not have.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; wire/dispatch logic is under test.
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
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { type ClientSession, GameServer, wireEntity } from '../server/game';
import { setHelmHidden } from '../src/sim/helm_visibility';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}

describe('helm_visibility module', () => {
  it('sets the flag idempotently, dead or alive', () => {
    const sim = makeSim();
    const p = sim.player;
    expect(p.helmHidden).toBe(false);
    setHelmHidden(p, true);
    setHelmHidden(p, true);
    expect(p.helmHidden).toBe(true);
    // A ghost's wardrobe still obeys (no dead-gate, unlike the sheathe).
    p.dead = true;
    setHelmHidden(p, false);
    expect(p.helmHidden).toBe(false);
  });

  it('Sim.setHelmHidden holds through ticks and combat (a preference, not a pose)', () => {
    const sim = makeSim();
    sim.setHelmHidden(true);
    expect(sim.player.helmHidden).toBe(true);
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    sim.startAutoAttack();
    expect(sim.player.helmHidden).toBe(true);
  });
});

describe('JSONB persistence', () => {
  it('round-trips through the save only while hidden (absent-means-shown)', () => {
    const sim = makeSim();
    const shown = sim.serializeCharacter(sim.playerId);
    expect(shown && 'helmHidden' in shown).toBe(false); // pre-feature byte-equality
    sim.setHelmHidden(true);
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('no state');
    expect(state.helmHidden).toBe(true);
    const resume = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = resume.addPlayer('warrior', 'Hider', { state });
    expect(resume.entities.get(pid)?.helmHidden).toBe(true);
  });
});

// --- entity wire: the `hh` bit -------------------------------------------------

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i].t === 'snap') return sent[i];
  }
  return null;
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

describe('helmHidden over the wire', () => {
  it('wireEntity carries hh:1 only while hidden (absent-means-shown)', () => {
    const sim = makeSim();
    expect('hh' in wireEntity(sim.player)).toBe(false);
    sim.setHelmHidden(true);
    expect(wireEntity(sim.player).hh).toBe(1);
  });

  it('set_helm dispatch -> snapshot -> ClientWorld round-trips end to end', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Hider');
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'set_helm', hidden: true }));
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fc.sent);
    expect(snap.self.hh).toBe(1);

    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect(client.player.helmHidden).toBe(true);

    // Re-assert (idempotent), then show: the next snapshot omits the bit.
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'set_helm', hidden: true }));
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'set_helm', hidden: false }));
    (server as any).broadcastSnapshots();
    const snap2 = lastSnap(fc.sent);
    expect('hh' in snap2.self).toBe(false);
    (client as any).applySnapshot(snap2);
    expect(client.player.helmHidden).toBe(false);
  });

  it('a non-boolean payload reads as shown (untrusted client input)', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Fuzzer');
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'set_helm', hidden: 'yes' }));
    (server as any).broadcastSnapshots();
    expect('hh' in lastSnap(fc.sent).self).toBe(false);
  });
});

describe('ClientWorld setHelmHidden', () => {
  it('nudges optimistically (even dead) and sends the explicit boolean', () => {
    (globalThis as any).WebSocket = { OPEN: 1 };
    const client = bareClient(7);
    const sent: any[] = [];
    (client as any).ws = { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) };
    const internals = client as unknown as { applySnapshot(snapshot: unknown): void };
    internals.applySnapshot({
      self: {
        id: 7,
        k: 'player',
        tid: 'warrior',
        nm: 'Nudge',
        lv: 1,
        x: 0,
        y: 0,
        z: 0,
        f: 0,
        hp: 10,
        mhp: 10,
        dead: 1,
      },
      ents: [],
      keep: [],
    });
    client.setHelmHidden(true);
    expect(client.player.helmHidden).toBe(true); // wardrobe preference: no dead-gate
    expect(
      sent.filter((m) => m.t === 'cmd' && m.cmd === 'set_helm' && m.hidden === true),
    ).toHaveLength(1);
  });
});
