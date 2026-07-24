import { describe, expect, it, vi } from 'vitest';

// Online-host liveness pin for the profession intro hint row's veteran
// refinement. The pure core (tests/prof_intro_hint.test.ts) and the
// generic cprof mirror pins (tests/snapshots.test.ts) each cover one hop; this
// suite closes the wire-to-decision splice end to end: the real server cprof
// wire (game.ts maybe('cprof', craftingIdentityFor)) lands in a real
// ClientWorld.applySnapshot, and the EXACT third-arg expression the quest
// dialog controller uses (world.craftingIdentity.attunedPairs.length > 0,
// quest_dialog_controller.ts renderGossip) drives professionIntroHintVisible.
// cprof rides the join-time self block, so the first snapshot always carries
// it and a gossip dialog can never open against an unsynced mirror.

// Mock the db layer so no Postgres is needed (shape from tests/snapshots.test.ts).
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
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import type { PlayerClass } from '../src/sim/types';
import { professionIntroHintVisible } from '../src/ui/hud/quest/prof_intro_hint_core';

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
  meta: Parameters<GameServer['join']>[7] = {},
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null, false, meta);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

// A ClientWorld without the WebSocket plumbing (shape from tests/snapshots.test.ts).
function bareClient(pid: number, playerClass: PlayerClass = 'warrior'): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass };
  c.entities = new Map();
  c.playerId = pid;
  c.ownPlayerId = pid;
  c.ownPlayerClass = playerClass;
  c.spectating = null;
  c.cupInfo = null;
  c.lastVcupRemainder = null;
  c.lastVcupShared = null;
  c.sportRole = null;
  c.moveInput = {};
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0;
  c.honor = 0;
  c.lifetimeHonor = 0;
  c.xp = 0;
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.selectedDungeonDifficulty = 'normal';
  c.tradeInfo = null;
  c.duelInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.serverTickHz = null;
  c.missingSince = new Map();
  c.pendingFacingDelta = 0;
  c.connected = true;
  c.eventQueue = [];
  c.mouselookFacing = null;
  c.lastInputSentAt = 0;
  c.lastInputSig = '';
  c.inputSeq = 0;
  c.pendingInputSeqSentAt = new Map();
  c.ackedInputSeq = 0;
  c.inputEchoSamples = [];
  c.spectateFacingPending = false;
  c.pendingSpectateFacing = null;
  c.nodeCooldowns = new Map();
  return c;
}

describe('prof intro hint veteran refinement, online host', () => {
  it('suppresses the hint for a wire-attuned veteran on the real cprof mirror', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 91, 'Requavet');
    const meta = server.sim.meta(session.pid)!;
    meta.archetype = {
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'leatherworking',
      attunedPairs: ['weaponcrafting+armorcrafting'],
      switchCount: 0,
      amendsProgress: 0,
    };

    broadcast(server);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(lastSnap(fc.sent));

    // (a) the mirror reflects the wire payload
    expect(client.craftingIdentity.synced).toBe(true);
    expect(client.craftingIdentity.attunedPairs).toEqual(['weaponcrafting+armorcrafting']);

    // (b) veteran path: the controller's exact third-arg expression retires the row
    expect(
      professionIntroHintVisible(
        'smith_haldren',
        'available',
        client.craftingIdentity.attunedPairs.length > 0,
      ),
    ).toBe(false);
  });

  it('shows the hint for a fresh unattuned player after the first real snapshot', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 92, 'Requafresh');

    broadcast(server);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(lastSnap(fc.sent));

    expect(client.craftingIdentity.synced).toBe(true);
    expect(client.craftingIdentity.attunedPairs).toEqual([]);
    expect(
      professionIntroHintVisible(
        'smith_haldren',
        'available',
        client.craftingIdentity.attunedPairs.length > 0,
      ),
    ).toBe(true);
  });
});
