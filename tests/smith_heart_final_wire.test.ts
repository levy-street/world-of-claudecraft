import { describe, expect, it, vi } from 'vitest';

// The Masterless Strength's fight rides existing entity fields only
// (src/sim/encounters/smith_heart/final_ids.ts): the zone, base form and
// switch mark on its state aura, the four Overload bars as auras, Heart
// Unbound as an aura, the kits' footprints as objects (Basalt Fist's
// spot and lanes the Heat guardian's own), the marks as player auras, the
// gale as the wind kernel's aura, the bars as cast bars. This drives the REAL
// server snapshot path into the real online mirror (ClientWorld, on the
// browser's stable timer wire) and checks each arrives, and that the raid
// HUD's view reads the same off the mirror as off the server. Db is mocked so
// no Postgres runs (mirrors smith_heart_heat_wire.test.ts).
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
  newOverloadRingState,
  overloadRingState,
} from '../src/render/smith_heart_fx/final_overload_ring_core';
import {
  FINAL_AURAS,
  FINAL_BOSS,
  FINAL_CASTS,
  FINAL_OBJECTS,
  FINAL_ZONE_CODES,
  overloadAuraId,
} from '../src/sim/encounters/smith_heart/final_ids';
import { HEAT_OBJECTS } from '../src/sim/encounters/smith_heart/heat_ids';
import { STABLE_TIMER_WIRE_VERSION } from '../src/world_api';
import { bareClient } from './helpers/bare_client';

// biome-ignore lint/suspicious/noExplicitAny: the in-process server idiom (afk_wire.test.ts)
type Any = any;

function joinAt(server: Any, id: number, name: string, stable: boolean) {
  const frames: Any[] = [];
  const ws = {
    readyState: 1,
    send: (payload: string) => {
      const m = JSON.parse(payload);
      if (m.t === 'snap') frames.push(m);
    },
  };
  const session = server.join(ws, id, id, name, 'warrior', null, false, {
    ...(stable ? { timerWireVersion: STABLE_TIMER_WIRE_VERSION } : {}),
  });
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return { session, pid: session.pid as number, frames };
}

describe('the Masterless Strength over the wire', () => {
  it('reaches the online mirror: the bars, the zone, the root, the kits and the marks', () => {
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
    const a = joinAt(server, 1, 'Aleph', false);
    const b = joinAt(server, 2, 'Bet', true);
    sim.partyInvite(b.pid, a.pid);
    sim.partyAccept(b.pid);
    for (const p of [a, b]) {
      sim.setPlayerLevel(20, p.pid);
      sim.chat('/dev heart enter', p.pid);
      sim.chat('/dev heart tp final', p.pid);
      sim.chat('/dev god', p.pid);
    }
    sim.chat('/dev heart final mythic', a.pid);
    sim.chat('/dev heart final quarter heat', a.pid);
    sim.chat('/dev heart final pull', a.pid);
    // Bet stands by the tank, a few yards off.
    const serverB = sim.entities.get(b.pid);
    const serverA = sim.entities.get(a.pid);
    serverB.pos = { ...serverA.pos, x: serverA.pos.x + 3 };
    serverB.prevPos = { ...serverB.pos };
    sim.ctx.rebucket(serverB);
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
    // The state: the Heat, its base form; no root (2026-11-19); the four bars.
    expect(aura(boss(), FINAL_AURAS.state)?.value).toBe(FINAL_ZONE_CODES.heat);
    expect(aura(boss(), FINAL_AURAS.state)?.value2).toBe(FINAL_ZONE_CODES.heat);
    expect(boss().auras.some((a: { kind: string }) => a.kind === 'root')).toBe(false);
    for (const v of ['heat', 'quench', 'breath', 'hammer'] as const)
      expect(aura(boss(), overloadAuraId(v)), v).toBeDefined();
    run(4);
    expect(aura(boss(), overloadAuraId('heat'))?.value).toBeGreaterThan(5);
    // The room's Overload ring reads the same bar off the mirror as off the
    // server (the HUD's bars moved into it, no wire field of its own).
    const fromServer = overloadRingState(serverBoss ?? null, true, newOverloadRingState());
    const fromClient = overloadRingState(boss(), true, newOverloadRingState());
    expect(fromClient.mode).toBe('fill');
    expect(fromClient.vein).toBe('heat');
    expect(fromClient).toEqual(fromServer);
    // Basalt Fist's spot and lanes (the Heat guardian's objects) and its bar.
    sim.chat('/dev heart final fist', a.pid);
    run(0.3);
    // (The kit's own fist may be down too: at least the forced one.)
    expect(objects(HEAT_OBJECTS.fistPrefix).length).toBeGreaterThanOrEqual(1);
    expect(objects(HEAT_OBJECTS.lanePrefix).length).toBeGreaterThanOrEqual(3);
    expect(boss().castingAbility).toBe(FINAL_CASTS.fist);
    run(3.5);
    // The whirls, the ember pools, the cracks, the orbs, the tremors, the anvil.
    sim.chat('/dev heart final whirl', a.pid);
    sim.chat('/dev heart final ice', a.pid);
    sim.chat('/dev heart final orbs', a.pid);
    sim.chat('/dev heart final tremor', a.pid);
    sim.chat('/dev heart final anvil', a.pid);
    run(0.3);
    for (const prefix of [
      FINAL_OBJECTS.whirlPrefix,
      FINAL_OBJECTS.crackPrefix,
      FINAL_OBJECTS.orbPrefix,
      FINAL_OBJECTS.tremorPrefix,
      FINAL_OBJECTS.anvilPrefix,
    ])
      expect(objects(prefix).length, prefix).toBeGreaterThan(0);
    expect(boss().castingAbility).toBe(FINAL_CASTS.anvil);
    sim.chat('/dev heart final quarter quench', a.pid);
    run(1);
    expect(aura(boss(), FINAL_AURAS.state)?.value).toBe(FINAL_ZONE_CODES.quench);
    // Mythic: the switch's mark rides the state aura.
    expect(aura(boss(), FINAL_AURAS.state)?.value3).toBeGreaterThan(0);
    expect(aura(client.entities.get(b.pid), FINAL_AURAS.shaken)).toBeDefined();
    // The ring: Heart Unbound's stacks.
    sim.chat('/dev heart final quarter ring', a.pid);
    for (const p of [serverA, serverB]) {
      p.pos = { ...serverBoss.pos, x: serverBoss.pos.x + 2 };
      p.prevPos = { ...p.pos };
      sim.ctx.rebucket(p);
    }
    run(4.2); // past unboundDelay (3 s)
    expect(aura(boss(), FINAL_AURAS.unbound)?.stacks ?? 0).toBeGreaterThanOrEqual(1);
  });
});
