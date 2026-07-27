import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
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
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0;
  c.xp = 0;
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.tradeInfo = null;
  c.duelInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.missingSince = new Map();
  c.mouselookFacing = null;
  c.markers = {};
  return c;
}

// A hand-built frame, the untrusted shape a client actually sends, parsed and
// dispatched exactly as a socket message is. `t: 'cmd'` is the real envelope
// (ClientWorld.rawCmd); without it the dispatcher drops the frame as a protocol
// anomaly and a test would pass on a command that never ran.
function sendCmd(server: GameServer, session: any, frame: Record<string, unknown>): string {
  const raw = JSON.stringify({ t: 'cmd', ...frame });
  (server as any).dispatchMessage(session, JSON.parse(raw), raw, 0);
  return raw;
}

describe('loot roll self-snapshot parity', () => {
  it('rides the self snapshot and the online client mirrors it', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const fb = fakeWs();
    const sa = server.join(fa.ws as any, 1, 1, 'Aaa', 'warrior', null) as any;
    const sb = server.join(fb.ws as any, 2, 2, 'Bbb', 'mage', null) as any;
    sa.blockListLoaded = true;
    sb.blockListLoaded = true;
    const a = sa.pid,
      b = sb.pid;
    const sim = server.sim;
    const pa = sim.entities.get(a)!,
      pb = sim.entities.get(b)!;
    pa.pos = { x: 20, y: 0, z: 20 };
    pa.prevPos = { ...pa.pos };
    pb.pos = { x: 21, y: 0, z: 20 };
    pb.prevPos = { ...pb.pos };
    sim.partyInvite(b, a);
    sim.partyAccept(b);

    const mob = createMob(990800, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
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

  // #2526, the whole chain end to end: setPartyLootMaster -> lootCorpse ->
  // maybe('mloot', activeMasterLootRolls) -> applySnapshot -> the HUD read. The
  // sim suite drives Sim directly and the snapshot suite hand-pokes
  // pendingLootRolls, so this is the only place the real server produces the key.
  it('rides the self snapshot to the master looter only, and survives a refused assignment', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const fb = fakeWs();
    const sa = server.join(fa.ws as any, 21, 21, 'Aaa', 'warrior', null) as any;
    const sb = server.join(fb.ws as any, 22, 22, 'Bbb', 'mage', null) as any;
    sa.blockListLoaded = true;
    sb.blockListLoaded = true;
    const a = sa.pid,
      b = sb.pid;
    const sim = server.sim;
    const pa = sim.entities.get(a)!,
      pb = sim.entities.get(b)!;
    pa.pos = { x: 20, y: 0, z: 20 };
    pa.prevPos = { ...pa.pos };
    pb.pos = { x: 21, y: 0, z: 20 };
    pb.prevPos = { ...pb.pos };
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.setPartyLootMaster(true, 0, 'uncommon', a); // 0 = the leader curates

    const mobId = [...sim.entities.keys()].reduce((max, k) => (k > max ? k : max), 0) + 1;
    const mob = createMob(mobId, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.lootCorpse(mob.id, a);
    const opened = sim.events.find((e) => e.type === 'masterLoot')!;
    const rollId = opened.rollId;
    // The deadline the EVENT announced, so the wire field below is pinned against
    // an independent producer rather than fed its own value back as its expectation.
    const expiresAt = (opened as { expiresAt: number }).expiresAt;
    expect(expiresAt).toBeGreaterThan(0);
    sim.tick();
    (server as any).broadcastSnapshots();

    // The looter's snapshot carries the curate prompt; the candidate's carries an
    // empty one, and NEITHER carries it as a need/greed roll.
    const snapA = lastSnap(fa.sent);
    const snapB = lastSnap(fb.sent);
    expect(snapA.self.mloot).toEqual([
      {
        rollId,
        itemId: 'greyjaw_hide_boots',
        itemName: 'Greyjaw Hide Boots',
        quality: 'uncommon',
        expiresAt,
        candidates: [
          { pid: a, name: 'Aaa' },
          { pid: b, name: 'Bbb' },
        ],
      },
    ]);
    expect(snapB.self.mloot).toEqual([]);
    expect(snapA.self.lroll).toEqual([]);
    expect(snapB.self.lroll).toEqual([]);

    const clientA = bareClient(a);
    const clientB = bareClient(b);
    (clientA as any).applySnapshot(snapA);
    (clientB as any).applySnapshot(snapB);
    expect(clientA.activeMasterLootRolls().map((p) => p.rollId)).toEqual([rollId]);
    expect(clientB.activeMasterLootRolls()).toEqual([]);

    // The refusal arm over the wire: a pid that is not a candidate leaves the
    // roll curating, so the surface is UNCHANGED and the delta encoder therefore
    // omits the key entirely. The mirror must keep its prior value, which is what
    // lets the HUD restore the row after the grace.
    fa.sent.length = 0;
    // Spied through (not stubbed): every assertion below also holds if the frame
    // were rejected by the masterAssign wire validation and the sim never ran, so
    // pin that the refusal really happened at the SIM boundary.
    const assignSpy = vi.spyOn(sim, 'assignMasterLoot');
    sendCmd(server, sa, { cmd: 'masterAssign', rollId, pids: [999999] });
    expect(assignSpy).toHaveBeenCalledWith(rollId, [999999], a);
    assignSpy.mockRestore();
    sim.tick();
    (server as any).broadcastSnapshots();
    const snapA2 = lastSnap(fa.sent);
    expect(snapA2.self).not.toHaveProperty('mloot');
    (clientA as any).applySnapshot(snapA2);
    expect(clientA.activeMasterLootRolls().map((p) => p.rollId)).toEqual([rollId]);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(0);

    // And it really was still assignable: the accepted assignment lands and the
    // surface empties, so the pins above are not just a stuck mirror.
    fa.sent.length = 0;
    sendCmd(server, sa, { cmd: 'masterAssign', rollId, pids: [b] });
    sim.tick();
    (server as any).broadcastSnapshots();
    const snapA3 = lastSnap(fa.sent);
    expect(snapA3.self.mloot).toEqual([]);
    (clientA as any).applySnapshot(snapA3);
    expect(clientA.activeMasterLootRolls()).toEqual([]);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(1);
  });
});

// #2505 over the wire. `pids` is a client-supplied array the authoritative
// server acts on per element, and no shipped client sends a repeat (the loot
// window's checkbox list builds unique pids), so the only way in is a
// hand-crafted frame. This drives exactly that frame through a REAL GameServer
// into the REAL sim, because the wire is where the untrusted value enters and a
// fix that only held for a direct sim call would not close it.
//
// One server per request, and none of them tick: GameServer pins a constant
// WORLD_SEED (asserted below, not assumed), so two runs generate the identical
// world and any difference in the result is the pid list.
describe('a repeated pid in a masterAssign frame, through a real GameServer (#2505)', () => {
  function serverAssign(pids: (ids: { a: number; b: number }) => number[]) {
    const server = new GameServer();
    const sa = server.join(fakeWs().ws as any, 11, 11, 'Aaa', 'warrior', null) as any;
    const sb = server.join(fakeWs().ws as any, 12, 12, 'Bbb', 'mage', null) as any;
    sa.blockListLoaded = true;
    sb.blockListLoaded = true;
    const a = sa.pid as number;
    const b = sb.pid as number;
    const sim = server.sim;
    // The premise behind comparing two separate servers: GameServer pins a
    // constant WORLD_SEED, so both runs generate the identical world and any
    // difference in the result is the pid list. A literal, not the imported
    // constant, so an env-derived or per-instance seed would fail here rather
    // than silently turn every dup-vs-once comparison into a coincidence.
    expect(sim.cfg.seed).toBe(20061);
    for (const [pid, x] of [
      [a, 20],
      [b, 21],
    ] as const) {
      const e = sim.entities.get(pid)!;
      e.pos = { x, y: 0, z: 20 };
      e.prevPos = { ...e.pos };
    }
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.setPartyLootMaster(true, 0, 'uncommon', a);

    // A world-unique corpse id: the server sim is a full generated world, so a
    // hand-picked literal could collide with a real entity.
    const mobId = [...sim.entities.keys()].reduce((max, k) => (k > max ? k : max), 0) + 1;
    const mob = createMob(mobId, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'masterLoot')!.rollId;
    sim.events.length = 0;

    const rng = (sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } }).rng;
    const countDraws = (fn: () => void): number => {
      let draws = 0;
      rng.setObserver(() => {
        draws++;
      });
      try {
        fn();
      } finally {
        rng.setObserver(null);
      }
      return draws;
    };

    let raw = '';
    const draws = countDraws(() => {
      raw = sendCmd(server, sa, { cmd: 'masterAssign', rollId, pids: pids({ a, b }) });
    });
    return {
      a,
      b,
      raw,
      draws,
      // Answer the roll (if one opened) over the wire too, and report what that
      // costs: one ctx.rng.int(1, 100) per non-pass choice.
      answerDraws: (choices: ('need' | 'greed' | 'pass')[]) =>
        countDraws(() => {
          for (const [i, session] of [sa, sb].entries())
            sendCmd(server, session, { cmd: 'lootRoll', rollId, choice: choices[i] });
        }),
      inventory: structuredClone(
        (sim as unknown as { players: Map<number, { inventory: any[] }> }).players.get(b)!
          .inventory,
      ),
      boots: [sim.countItem('greyjaw_hide_boots', a), sim.countItem('greyjaw_hide_boots', b)],
      prompts: sim.events
        .filter((e) => e.type === 'lootRoll' && e.rollId === rollId)
        .map((e) => e.pid as number),
    };
  }

  it('lands the same bags [X] lands, with the same prompts and the same draw count', () => {
    const dup = serverAssign(({ b }) => [b, b]);
    const once = serverAssign(({ b }) => [b]);

    // The frame really carried the repeat, and named the pid the control names:
    // the assertions below are about the sim collapsing it, not about the
    // payload never arriving or the two runs assigning to different players.
    const dupPids = JSON.parse(dup.raw).pids as number[];
    const oncePids = JSON.parse(once.raw).pids as number[];
    expect(oncePids).toHaveLength(1);
    expect(dupPids).toEqual([oncePids[0], oncePids[0]]);
    // Not a vacuous comparison of two empty bags: the control really granted.
    expect(once.boots).toEqual([0, 1]);
    expect(dup.boots).toEqual(once.boots);
    expect(dup.inventory).toEqual(once.inventory);
    // The repeat must not convert the assignment into a need/greed roll, and
    // must not buy the extra tie-break draw a doubled candidate list can.
    expect(dup.prompts).toEqual([]);
    expect(once.prompts).toEqual([]);
    expect(dup.draws).toBe(0);
    expect(once.draws).toBe(0);
  });

  it('rolls a two-target wire assignment among both, in request order', () => {
    // The positive control for this file's two instruments. Every assertion in
    // the test above reads empty or zero, so a prompts extractor pointed at the
    // wrong rollId, an event log drained by something else, or an observer
    // wired to anything other than the rng the sim draws from would report the
    // very same thing and this file would stay green. This run forces both
    // instruments to a non-empty, non-zero reading, and covers the multi-target
    // arm and first-seen order over the wire at the same time (the test above
    // only reaches the single-target arm).
    const both = serverAssign(({ a, b }) => [b, a]);
    expect(both.prompts).toEqual([both.b, both.a]);
    expect(both.b).toBeGreaterThan(both.a); // request order, reversed from the roster
    expect(both.boots).toEqual([0, 0]); // a roll opened, so nothing is granted yet
    // Two needers, one ctx.rng.int(1, 100) each: a literal the zeros above
    // cannot supply, and the anchor that proves the observer intercepts.
    expect(both.answerDraws(['need', 'need'])).toBe(2);
  });

  it('forwards the repeat verbatim: the SIM boundary is what closes it, not the server', () => {
    // Deliberate, and the reason the fix lives in assignMasterLoot: the offline
    // Sim reaches the same command through IWorld (loot_roll_controller.ts ->
    // Sim.assignMasterLoot) without ever passing through server/game.ts, so
    // sanitizing here would have left that host open. If a future change starts
    // deduping on the server too, this test is the one that should be
    // re-argued, not quietly deleted.
    const server = new GameServer();
    const session = server.join(fakeWs().ws as any, 13, 13, 'Ccc', 'warrior', null) as any;
    session.blockListLoaded = true;
    const spy = vi.spyOn(server.sim, 'assignMasterLoot').mockImplementation(() => {});
    sendCmd(server, session, { cmd: 'masterAssign', rollId: 4242, pids: [7, 7] });
    expect(spy).toHaveBeenCalledWith(4242, [7, 7], session.pid);
  });
});
