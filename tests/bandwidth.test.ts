import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer, wireEntity } from '../server/game';

const LEGACY_INTEREST_RADIUS = 120;
const SNAPSHOTS_PER_SECOND = 20;
const PLAYERS = 30;
const WARMUP_TICKS = 5;
const MEASURE_TICKS = 200;

// deterministic LCG so the walk pattern is reproducible
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe('crowd bandwidth', () => {
  it('cuts entity-stream bytes by more than half for a walking town crowd', () => {
    const server = new GameServer();
    const rng = makeRng(42);
    const sessions: { pid: number; bytes: number }[] = [];

    for (let i = 0; i < PLAYERS; i++) {
      const holder = { pid: 0, bytes: 0 };
      const ws = {
        readyState: 1,
        send: (payload: string) => {
          const snap = JSON.parse(payload);
          if (snap.t !== 'snap') return;
          // measure only the entity stream; self is identical in both protocols
          holder.bytes += JSON.stringify(snap.ents).length
            + (snap.keep ? JSON.stringify(snap.keep).length : 0);
        },
      };
      const session = server.join(ws as any, i + 1, i + 1, `Walker${i}`, 'warrior', null);
      if ('error' in session) throw new Error(session.error);
      holder.pid = session.pid;
      sessions.push(holder);
      // every player walks in their own direction across the starter town
      const meta = server.sim.meta(session.pid)!;
      meta.moveInput.forward = true;
      const e = server.sim.entities.get(session.pid)!;
      e.facing = rng() * Math.PI * 2;
    }

    const broadcast = () => (server as any).broadcastSnapshots();
    for (let i = 0; i < WARMUP_TICKS; i++) {
      server.sim.tick();
      broadcast();
    }
    for (const s of sessions) s.bytes = 0;

    let legacyBytes = 0;
    for (let i = 0; i < MEASURE_TICKS; i++) {
      server.sim.tick();
      // legacy protocol: every entity within 120yd, full record, every tick
      for (const s of sessions) {
        const p = server.sim.entities.get(s.pid)!;
        const ents: string[] = [];
        server.sim.grid.forEachInRadius(p.pos.x, p.pos.z, LEGACY_INTEREST_RADIUS, (e) => {
          if (e.id === s.pid) return;
          ents.push(JSON.stringify(wireEntity(e)));
        });
        legacyBytes += `[${ents.join(',')}]`.length;
      }
      broadcast();
    }

    const newBytes = sessions.reduce((sum, s) => sum + s.bytes, 0);
    const seconds = MEASURE_TICKS / SNAPSHOTS_PER_SECOND;
    const perClient = (b: number) => b / PLAYERS / seconds / 1024;
    console.log(
      `entity-stream bandwidth, ${PLAYERS} players walking in town: `
      + `legacy ${perClient(legacyBytes).toFixed(1)} KB/s/client -> `
      + `new ${perClient(newBytes).toFixed(1)} KB/s/client `
      + `(${(100 - (newBytes / legacyBytes) * 100).toFixed(0)}% reduction)`,
    );

    expect(newBytes).toBeLessThan(legacyBytes * 0.5);
  }, 30000);
});
