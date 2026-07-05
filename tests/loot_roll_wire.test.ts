import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

function fakeWs() {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
}
function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].t === 'snap') return sent[i];
  return null;
}
function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'mage' };
  c.entities = new Map();
  c.playerId = pid;
  c.moveInput = {};
  c.inventory = []; c.vendorBuyback = []; c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0; c.xp = 0; c.known = [];
  c.questLog = new Map(); c.questsDone = new Set(); c.pendingQuestCommands = new Map();
  c.partyInfo = null; c.tradeInfo = null; c.duelInfo = null;
  c.lastSnapAt = 0; c.snapInterval = 50; c.missingSince = new Map();
  c.mouselookFacing = null; c.markers = {};
  return c;
}

describe('loot roll self-snapshot parity', () => {
  it('rides the self snapshot and the online client mirrors it', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const fb = fakeWs();
    const sa = server.join(fa.ws as any, 1, 1, 'Aaa', 'warrior', null) as any;
    const sb = server.join(fb.ws as any, 2, 2, 'Bbb', 'mage', null) as any;
    sa.blockListLoaded = true; sb.blockListLoaded = true;
    const a = sa.pid, b = sb.pid;
    const sim = server.sim;
    const pa = sim.entities.get(a)!, pb = sim.entities.get(b)!;
    pa.pos = { x: 20, y: 0, z: 20 }; pa.prevPos = { ...pa.pos };
    pb.pos = { x: 21, y: 0, z: 20 }; pb.prevPos = { ...pb.pos };
    sim.partyInvite(b, a); sim.partyAccept(b);

    const mob = createMob(990800, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true; mob.lootable = true; mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.lootCorpse(mob.id, a);
    sim.tick();
    (server as any).broadcastSnapshots();

    // The non-looter B's self snapshot carries the open roll.
    const snapB = lastSnap(fb.sent);
    expect(snapB.self.lroll).toBeTruthy();
    expect(snapB.self.lroll.map((p: any) => p.itemId)).toContain('greyjaw_hide_boots');

    // The online client mirrors it through applySnapshot, so the HUD can re-show it.
    const client = bareClient(b);
    (client as any).applySnapshot(snapB);
    expect(client.activeLootRolls().map((p) => p.itemId)).toContain('greyjaw_hide_boots');
  });
});
