import { describe, expect, it, vi } from 'vitest';

// Grieving Fury (src/sim/encounters/smith_heart/council_fury.ts) rides existing
// entity fields only: its two auras on the survivor (the fury's haste and the
// fallen one's colour in value2, Memory of Stone's damage), the inherited bars
// on the survivor's own cast bar, the cues as spellfx. This drives the REAL
// server snapshot path into the real online mirror (ClientWorld) and checks
// they arrive. Db is mocked so no Postgres runs (mirrors afk_wire.test.ts).
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
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_DIFFICULTY,
  COUNCIL_TEMPLATES,
  COUNCIL_TUNING,
  furyFallenOf,
} from '../src/sim/encounters/smith_heart/council_ids';
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

describe('Grieving Fury over the wire', () => {
  it('reaches the online mirror: the fury and Memory of Stone on the survivor, its bars hastened', () => {
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
      sim.chat('/dev heart tp pit', p.pid);
      sim.chat('/dev god', p.pid);
    }
    sim.chat('/dev heart council heroic on', a.pid);
    sim.chat('/dev heart council pull', a.pid);
    const client: Any = bareClient(b.pid);
    const run = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        sim.tick();
        server.broadcastSnapshots();
        for (const f of b.frames.splice(0)) client.applySnapshot(f);
      }
    };
    const memberOnClient = (tid: string) =>
      [...client.entities.values()].find((e: Any) => e.templateId === tid) as Any;
    run(1);
    sim.chat('/dev heart kill singer', a.pid);
    run(COUNCIL_TUNING.furyArrive + 1);
    const g = memberOnClient(COUNCIL_TEMPLATES.guardian);
    expect(g).toBeDefined();
    const fury = g.auras.find((x: Any) => x.id === COUNCIL_AURAS.fury);
    expect(fury).toBeDefined();
    expect(fury.value).toBeCloseTo(1 + COUNCIL_DIFFICULTY.heroic.furyHaste);
    expect(furyFallenOf(fury.value2)).toBe('singer');
    expect(g.auras.some((x: Any) => x.id === COUNCIL_AURAS.memory)).toBe(true);
    // Her Wake, cast by him, its bar hastened, arrives on his cast bar.
    sim.chat('/dev heart council wake', a.pid);
    run(0.2);
    expect(g.castingAbility).toBe(COUNCIL_CASTS.wake);
    expect(g.castTotal).toBeCloseTo(
      COUNCIL_TUNING.wakeCast / (1 + COUNCIL_DIFFICULTY.heroic.furyHaste),
      2,
    );
  });
});
