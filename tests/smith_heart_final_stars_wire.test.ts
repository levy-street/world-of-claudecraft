import { describe, expect, it, vi } from 'vitest';

// The Masterless Strength's woken stars over the wire (the rework of
// 2026-11-18): everything rides existing entity fields (final_ids.ts): the
// pillars as wall objects (plain or Storm-Charged in the template), the rises,
// the Sky Strikes and their Arcing Stone rings as timed objects, a Crossing
// Blade and its line as objects (the line's state and length in the
// template, its heading in `facing`), the marks as player auras, the awake
// quarters on the phase aura's mask. This drives the REAL server snapshot
// path into the real online mirror (ClientWorld) and checks each arrives.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => null),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import {
  FINAL_AURAS,
  FINAL_BOSS,
  FINAL_OBJECTS,
  finalLaneOf,
  finalPillarOf,
  FINAL_TUNING as T,
} from '../src/sim/encounters/smith_heart/final_ids';
import { FINAL_PHASE_AURAS, quarterBit } from '../src/sim/encounters/smith_heart/final_phase_ids';
import { STABLE_TIMER_WIRE_VERSION } from '../src/world_api';
import { bareClient } from './helpers/bare_client';

// biome-ignore lint/suspicious/noExplicitAny: the in-process server idiom (afk_wire.test.ts)
type Any = any;

function joinAt(server: Any, id: number, name: string) {
  const frames: Any[] = [];
  const ws = {
    readyState: 1,
    send: (payload: string) => {
      const m = JSON.parse(payload);
      if (m.t === 'snap') frames.push(m);
    },
  };
  const session = server.join(ws, id, id, name, 'warrior', null, false, {
    timerWireVersion: STABLE_TIMER_WIRE_VERSION,
  });
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return { session, pid: session.pid as number, frames };
}

describe("the Masterless Strength's stars over the wire", () => {
  it('pillars, charged pillars, strikes, Arcing Stone, blades, lines and marks reach the mirror', () => {
    const saved = process.env.ALLOW_DEV_COMMANDS;
    process.env.ALLOW_DEV_COMMANDS = '1';
    let server: Any;
    try {
      server = new GameServer();
    } finally {
      if (saved === undefined) delete process.env.ALLOW_DEV_COMMANDS;
      else process.env.ALLOW_DEV_COMMANDS = saved;
    }
    const sim = server.sim;
    const a = joinAt(server, 1, 'Aleph');
    const b = joinAt(server, 2, 'Bet');
    sim.partyInvite(b.pid, a.pid);
    sim.partyAccept(b.pid);
    for (const p of [a, b]) {
      sim.setPlayerLevel(20, p.pid);
      sim.chat('/dev heart enter', p.pid);
      sim.chat('/dev heart tp final', p.pid);
      sim.chat('/dev god', p.pid);
    }
    sim.chat('/dev heart final quarter hammer', a.pid);
    sim.chat('/dev heart final pull', a.pid);
    const client: Any = bareClient(b.pid);
    const run = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        server.routeEvents(sim.tick());
        server.broadcastSnapshots();
        for (const f of b.frames.splice(0)) client.applySnapshot(f);
      }
    };
    const onClient = (pred: (e: Any) => boolean) =>
      [...client.entities.values()].filter((e: Any) => pred(e)) as Any[];
    const objects = (prefix: string) =>
      onClient((e) => e.kind === 'object' && e.templateId.startsWith(prefix));
    const aura = (e: Any, id: string) => e?.auras.find((x: Any) => x.id === id);
    run(1);
    const boss = () => onClient((e) => e.kind === 'mob' && e.templateId === FINAL_BOSS)[0];
    expect(boss()).toBeDefined();
    const serverBoss = sim.entities.get(boss().id);
    // The Hammer's star is awake: the mask says so.
    expect(
      (aura(boss(), FINAL_PHASE_AURAS.phase)?.value2 ?? 0) & quarterBit('hammer'),
    ).toBeGreaterThan(0);
    // A pillar where Bet stands, off the boss.
    const serverB = sim.entities.get(b.pid);
    serverB.pos = { ...serverBoss.pos, x: serverBoss.pos.x + 12 };
    serverB.prevPos = { ...serverB.pos };
    sim.ctx.rebucket(serverB);
    sim.chat('/dev heart final pillars here', b.pid);
    run(0.3);
    expect(objects(FINAL_OBJECTS.risePrefix).length).toBeGreaterThanOrEqual(1);
    run(T.pillarWarn + 0.3);
    const ps = objects(FINAL_OBJECTS.pillarPrefix);
    expect(ps.length).toBeGreaterThanOrEqual(1);
    expect(finalPillarOf(ps[0].templateId)).toBe('plain');
    // A Sky Strike by it: its spot, its Arcing Stone ring, then the charge.
    serverB.pos = { ...serverB.pos, x: serverB.pos.x + 3 };
    serverB.prevPos = { ...serverB.pos };
    sim.ctx.rebucket(serverB);
    sim.chat('/dev heart final sky here', b.pid);
    run(0.3);
    expect(objects(FINAL_OBJECTS.strikePrefix).length).toBeGreaterThanOrEqual(1);
    expect(objects(FINAL_OBJECTS.arcPrefix).length).toBeGreaterThanOrEqual(1);
    run(T.skyWarn + 0.3);
    expect(
      objects(FINAL_OBJECTS.pillarPrefix).some((e) => finalPillarOf(e.templateId) === 'charged'),
    ).toBe(true);
    // Sky marks on players arrive as auras.
    sim.chat('/dev heart final sky', a.pid);
    run(0.3);
    const marked = onClient((e) => e.kind === 'player' && aura(e, FINAL_AURAS.skyMark));
    expect(marked.length).toBeGreaterThan(0);
    run(T.skyWarn + 0.3);
    // A Crossing Blade through Bet: the blade, its line, Bet's mark.
    sim.chat('/dev heart final blades me', b.pid);
    run(0.3);
    expect(objects(FINAL_OBJECTS.bladePrefix).length).toBe(1);
    const lane = objects(FINAL_OBJECTS.lanePrefix)[0];
    expect(finalLaneOf(lane.templateId)?.state).toBe('warn');
    expect(finalLaneOf(lane.templateId)?.length).toBeGreaterThan(10);
    expect(aura(client.entities.get(b.pid), FINAL_AURAS.bladeMark)).toBeDefined();
  });
});
