import { describe, expect, it, vi } from 'vitest';

// The Masterless Strength's part 2 rides existing entity fields only
// (src/sim/encounters/smith_heart/final_phase_ids.ts): the stage, the awake
// mask and the clock on its phase aura, Gathered Strength and the poured
// elements as auras, the Splinters as real mobs with real cast bars (Rime
// Toll), the Quenching Rings as objects, the marks as player auras. This
// drives the REAL server snapshot path into the real online mirror
// (ClientWorld) and checks each arrives, and that the raid HUD reads the same
// off the mirror as off the server. Db is mocked (mirrors
// smith_heart_final_wire.test.ts).
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
import { FINAL_BOSS } from '../src/sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS as A,
  ALL_QUARTERS_MASK,
  FINAL_PHASE_CASTS as C,
  FINAL_PHASE_OBJECTS,
  FINAL_STAGE_CODES,
  finalAddVein,
  pouredAuraId,
} from '../src/sim/encounters/smith_heart/final_phase_ids';
import { buildOverloadView, makeOverloadView } from '../src/ui/hud/dungeon/heart_overload_view';
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

describe('the Masterless Strength part 2 over the wire', () => {
  it('reaches the online mirror: the call, its Splinters, their bars, the pour, the final phase', () => {
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
    const serverA = sim.entities.get(a.pid);
    const serverB = sim.entities.get(b.pid);
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
    const aura = (e: Any, id: string) => e?.auras.find((x: Any) => x.id === id);
    run(1);
    const boss = () => onClient((e) => e.kind === 'mob' && e.templateId === FINAL_BOSS)[0];
    const serverBoss = sim.entities.get(boss().id);
    // Bet stands by the centre, so every Splinter is in its view.
    const keepNear = () => {
      for (const p of [serverA, serverB]) {
        p.pos = { ...serverBoss.pos, x: serverBoss.pos.x + 4 };
        p.prevPos = { ...p.pos };
        sim.ctx.rebucket(p);
      }
    };
    sim.chat('/dev heart final inter70', a.pid);
    run(0.3);
    expect(aura(boss(), A.phase)?.value).toBe(FINAL_STAGE_CODES.leap);
    expect(aura(boss(), A.shield)).toBeDefined();
    run(3.2);
    keepNear();
    run(0.5);
    // The call: its bar, its stage, its mask, the four Splinters (Mythic).
    expect(aura(boss(), A.phase)?.value).toBe(FINAL_STAGE_CODES.call);
    expect(boss().castingAbility).toBe(C.call);
    const splinters = () =>
      onClient((e) => e.kind === 'mob' && !e.dead && finalAddVein(e.templateId) !== null);
    expect(splinters().length).toBe(4);
    expect(aura(boss(), A.phase)?.value2).toBe(ALL_QUARTERS_MASK);
    expect(aura(boss(), A.phase)?.stacks).toBe(4);
    // The HUD reads the same off the mirror as off the server.
    const fromServer = buildOverloadView(serverBoss, makeOverloadView());
    const fromClient = buildOverloadView(boss(), makeOverloadView());
    expect(fromClient.frozen).toBe(true);
    expect(fromClient.phase).toBe(fromServer.phase);
    expect(fromClient.splinters).toBe(fromServer.splinters);
    expect(fromClient.rows.map((r) => r.awake)).toEqual(fromServer.rows.map((r) => r.awake));
    // The Quench Splinter's kickable bar and its ring.
    run(2.5);
    keepNear();
    sim.chat('/dev heart final toll', a.pid);
    sim.chat('/dev heart final ring', a.pid);
    run(0.3);
    const quench = splinters().find((e) => finalAddVein(e.templateId) === 'quench');
    expect(quench?.castingAbility).toBe(C.toll);
    expect(
      onClient(
        (e) => e.kind === 'object' && e.templateId.startsWith(FINAL_PHASE_OBJECTS.ringPrefix),
      ).length,
    ).toBeGreaterThan(0);
    // The call ends with them alive: every element pours in.
    expect(
      splinters()
        .map((e) => finalAddVein(e.templateId))
        .sort(),
    ).toEqual(['breath', 'hammer', 'heat', 'quench']);
    sim.chat('/dev heart final endcall', a.pid);
    run(0.5);
    for (const v of ['heat', 'quench', 'breath', 'hammer'] as const)
      expect(aura(boss(), pouredAuraId(v))?.value, v).toBe(1);
    expect(aura(boss(), A.shield)).toBeUndefined();
    expect(buildOverloadView(boss(), makeOverloadView()).poured).not.toBe('');
    // The final phase: the stage, every quarter awake, the enrage's clock.
    sim.chat('/dev heart final last', a.pid);
    run(3.6);
    expect(aura(boss(), A.phase)?.value).toBe(FINAL_STAGE_CODES.final);
    expect(aura(boss(), A.phase)?.value2).toBe(ALL_QUARTERS_MASK);
    expect(aura(boss(), A.phase)?.value3).toBeGreaterThan(100);
    expect(buildOverloadView(boss(), makeOverloadView()).barsOff).toBe(true);
    sim.chat('/dev heart final enrage', a.pid);
    run(0.3);
    expect(aura(boss(), A.fury)?.value ?? 0).toBeGreaterThanOrEqual(1);
    expect(buildOverloadView(boss(), makeOverloadView()).phaseUrgent).toBe(true);
  });
});
