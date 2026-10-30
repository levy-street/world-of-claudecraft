// The hidden phase over the wire: what the online client mirrors is exactly what
// the painter and the HUD read (the phase aura's stage, the hidden aura's fallen
// mask, next and seconds, the boss's health), and a fall kills on the server.

import { describe, expect, it, vi } from 'vitest';

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
  finalStageOf,
  hiddenNextOf,
  FINAL_PHASES as P,
  quarterBit,
} from '../src/sim/encounters/smith_heart/final_phase_ids';
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

describe('the hidden phase over the wire', () => {
  it('the client mirrors the scene, the collapse and the fall', () => {
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
    }
    sim.chat('/dev heart final mythic', a.pid);
    sim.chat('/dev heart final quarter heat', a.pid);
    sim.chat('/dev heart final pull', a.pid);
    const client: Any = bareClient(b.pid);
    const serverA = sim.entities.get(a.pid);
    const serverB = sim.entities.get(b.pid);
    const run = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        serverA.hp = serverA.maxHp;
        serverB.hp = serverB.maxHp;
        server.routeEvents(sim.tick());
        server.broadcastSnapshots();
        for (const f of b.frames.splice(0)) client.applySnapshot(f);
      }
    };
    run(0.5);
    const boss = () =>
      [...client.entities.values()].find(
        (e: Any) => e.kind === 'mob' && e.templateId === FINAL_BOSS,
      ) as Any;
    const auraOf = (id: string) => boss().auras.find((x: Any) => x.id === id);
    const serverBoss = sim.entities.get(boss().id);
    const stand = (x: number, z: number) => {
      for (const p of [serverA, serverB]) {
        p.pos = sim.ctx.groundPos(x, z);
        p.prevPos = { ...p.pos };
        sim.ctx.rebucket(p);
      }
    };
    sim.chat('/dev heart final hidden', a.pid);
    stand(serverBoss.pos.x + 4, serverBoss.pos.z);
    run(1);
    expect(finalStageOf(auraOf(A.phase)?.value)).toBe('kneel');
    expect(boss().hp).toBe(Math.ceil(serverBoss.maxHp * P.hiddenAt));
    stand(serverBoss.pos.x + 4, serverBoss.pos.z);
    run(P.kneelSeconds);
    expect(finalStageOf(auraOf(A.phase)?.value)).toBe('rebirth');
    stand(serverBoss.pos.x + 4, serverBoss.pos.z);
    run(P.rebirthSeconds);
    expect(finalStageOf(auraOf(A.phase)?.value)).toBe('collapse');
    expect(boss().hp).toBe(Math.ceil(serverBoss.maxHp * P.rebirthTo));
    const next = hiddenNextOf(auraOf(A.hidden)?.value2);
    expect(next).not.toBeNull();
    expect(next).not.toBe('ring');
    expect(auraOf(A.hidden)?.value ?? 0).toBe(0);
    expect(auraOf(A.hidden)?.value3).toBeGreaterThan(0);
    sim.chat('/dev heart final fall', a.pid);
    stand(serverBoss.pos.x + 4, serverBoss.pos.z);
    run(0.5);
    expect(auraOf(A.hidden)?.value).toBe(quarterBit(next as Any));
    sim.chat('/dev heart final reset', a.pid);
    run(0.5);
    expect(auraOf(A.hidden)).toBeUndefined();
  });
});
