// Equivalence proof for the snapshot-fanout worker path: two GameServers run
// the SAME deterministic combat scenario (fixed WORLD_SEED, scripted inputs),
// one broadcasting in-thread, one through real worker_threads, and every
// session must receive the same snapshots.
//
// "Same" is canonical, not byte-order: the worker walks a grid rebuilt from
// mirror slot order while the in-thread grid reflects live insertion/swap-pop
// order, so records inside one snapshot may be ordered differently. The
// client applies ents into a per-id map (order carries no meaning), so frames
// are compared with ents/keep sorted by id; everything else (head, self,
// record contents, frame COUNT, which entities are full/lite/keep) must match
// exactly.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
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

import { GameServer } from '../../server/game';
import type { PlayerClass } from '../../src/sim/types';

const TICKS = 240;
const CLASSES: PlayerClass[] = ['warrior', 'mage', 'priest', 'hunter'];

let workDir = '';
let workerPath = '';

interface Bot {
  cls: PlayerClass;
  sent: string[];
  session: import('../../server/game').ClientSession;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runScenario(
  useWorkers: boolean,
): Promise<{ perBot: string[][]; delivered: number }> {
  process.env.ALLOW_DEV_COMMANDS = '1';
  const server = useWorkers
    ? new GameServer({ snapshotWorkers: 2, snapshotWorkerPath: workerPath })
    : new GameServer();
  const bots: Bot[] = CLASSES.map((cls, i) => {
    const sent: string[] = [];
    const ws = { readyState: 1, send: (payload: string) => sent.push(payload) };
    const session = server.join(ws as never, 1000 + i, 1000 + i, `Fanout${cls}`, cls, null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    return { cls, sent, session };
  });
  const g = server as unknown as {
    clearStaleInputs(): void;
    routeEvents(events: unknown[]): void;
    detectActivity(events: unknown[]): void;
    runAntibotTick(): void;
    broadcastSnapshots(): void;
    handleMessage(session: Bot['session'], raw: string): void;
    pendingFanoutFrames: Map<number, unknown>;
    sim: { tick(): unknown[]; utcDay: string };
    stop(): void;
  };
  g.sim.utcDay = '2026-01-01';
  const msg = (bot: Bot, obj: Record<string, unknown>): void =>
    g.handleMessage(bot.session, JSON.stringify(obj));
  bots.forEach((bot, i) => {
    msg(bot, { cmd: 'dev_level', level: 12, t: 'cmd' });
    msg(bot, {
      cmd: 'dev_teleport',
      t: 'cmd',
      x: -2 + (i % 2) * 6 - 3,
      z: 70 + Math.floor(i / 2) * 6 - 3,
    });
  });
  const NUKE: Record<string, string> = {
    warrior: 'heroic_strike',
    mage: 'fireball',
    priest: 'smite',
    hunter: 'arcane_shot',
  };
  let seq = 0;
  for (let tick = 1; tick <= TICKS; tick++) {
    bots.forEach((bot, i) => {
      (bot.session as unknown as { msgRate: { tokens: number } }).msgRate.tokens = 60;
      seq++;
      const facing = ((i * 0.7 + tick * 0.08) % 6.28318) - 3.14159;
      const mi = {
        f: tick % 20 < 12 ? 1 : 0,
        tl: (tick + i) % 40 < 6 ? 1 : 0,
        j: (tick + i * 3) % 60 === 0 ? 1 : 0,
      };
      msg(bot, { t: 'input', seq, mi, facing });
      if (tick % 16 === i * 4 + 2) msg(bot, { t: 'cmd', cmd: 'targetNearest' });
      if (tick % 16 === i * 4 + 3) msg(bot, { t: 'cmd', cmd: 'attack' });
      if (tick % 24 === i * 6 + 4) msg(bot, { t: 'cmd', cmd: 'cast', ability: NUKE[bot.cls] });
      if (bot.cls === 'priest' && tick % 40 === 30)
        msg(bot, { t: 'cmd', cmd: 'cast', ability: 'lesser_heal' });
    });
    g.clearStaleInputs();
    const events = g.sim.tick();
    g.routeEvents(events);
    g.detectActivity(events);
    g.runAntibotTick();
    g.broadcastSnapshots();
    if (useWorkers) {
      // wait for every dispatched frame of THIS tick to be delivered, so
      // per-session frame streams stay aligned with the in-thread run
      const deadline = Date.now() + 5000;
      while (g.pendingFanoutFrames.size > 0) {
        if (Date.now() > deadline) throw new Error('fanout frames never arrived');
        await sleep(1);
      }
    }
  }
  let delivered = 0;
  if (useWorkers) {
    const pool = (server as unknown as { snapshotFanout: { totalDelivered: number } })
      .snapshotFanout;
    delivered = pool.totalDelivered;
  }
  g.stop();
  return { perBot: bots.map((b) => b.sent), delivered };
}

function canonSnap(raw: string): unknown {
  const snap = JSON.parse(raw);
  if (Array.isArray(snap.ents))
    snap.ents.sort((a: { id: number }, b: { id: number }) => a.id - b.id);
  if (Array.isArray(snap.keep)) snap.keep.sort((a: number, b: number) => a - b);
  return snap;
}

describe('snapshot fanout equivalence', () => {
  beforeAll(async () => {
    const { build } = await import('esbuild');
    workDir = mkdtempSync(join(tmpdir(), 'woc-fanout-'));
    workerPath = join(workDir, 'snapshot_worker.cjs');
    await build({
      entryPoints: [join(__dirname, '../../server/snapshot_fanout/worker_main.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: workerPath,
      logLevel: 'silent',
    });
  }, 30000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('workers produce the same per-session snapshots as the in-thread path', async () => {
    const inThread = await runScenario(false);
    const viaWorkers = await runScenario(true);
    // Non-vacuity: the worker run must have actually built its frames on
    // worker threads, not fallen back in-thread after a spawn failure.
    expect(viaWorkers.delivered).toBeGreaterThan(TICKS * CLASSES.length * 0.9);
    for (let b = 0; b < CLASSES.length; b++) {
      const a = inThread.perBot[b].filter((raw) => raw.startsWith('{"t":"snap"'));
      const w = viaWorkers.perBot[b].filter((raw) => raw.startsWith('{"t":"snap"'));
      expect(a.length).toBeGreaterThan(TICKS * 0.9);
      expect(w.length).toBe(a.length);
      for (let i = 0; i < a.length; i++) {
        expect(canonSnap(w[i])).toEqual(canonSnap(a[i]));
      }
      // events are untouched by the fanout: byte-identical streams
      const ae = inThread.perBot[b].filter((raw) => raw.startsWith('{"t":"events"'));
      const we = viaWorkers.perBot[b].filter((raw) => raw.startsWith('{"t":"events"'));
      expect(we).toEqual(ae);
    }
  }, 120000);
});
