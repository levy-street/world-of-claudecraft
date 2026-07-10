// Broadcast wire golden: pins the exact outbound frames of the server's
// per-tick pipeline (routeEvents + broadcastSnapshots) for a deterministic
// multi-class combat scenario, so hot-path rewrites of the snapshot/event
// fan-out can prove they did not change what any client receives.
//
// Sibling of tests/parity (which pins SIM behavior + rng draw order). This file
// pins the SERVER ENCODING layered on top of the sim:
//
// - rawSnapsSha: SHA-256 over every snap frame, byte-exact, in send order.
//   Breaks on ANY wire change, including harmless record reordering.
// - canonSnapsSha: same frames with ents/keep sorted by id before hashing.
//   The client applies ents into a per-id map (order-independent), so a
//   refactor that only reorders records inside one snapshot is allowed to
//   change rawSnapsSha but MUST keep canonSnapsSha identical.
// - rawEventsSha: SHA-256 over every events frame, byte-exact. Event ORDER is
//   contract (client applies in order); there is no canonical variant.
//
// Regenerate deliberately (separate, reviewed commit) with:
//   UPDATE_BROADCAST_GOLDEN=1 npx vitest run tests/server/broadcast_golden.test.ts
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; the wire pipeline is under test.
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

const FIXTURE = resolve(__dirname, 'fixtures/broadcast_golden.json');
const TICKS = 400;

interface Fixture {
  ticks: number;
  players: string[];
  rawSnapsSha: string;
  canonSnapsSha: string;
  rawEventsSha: string;
  snapFrames: number;
  eventFrames: number;
  snapBytes: number;
  sawDamage: boolean;
  sawAura: boolean;
}

interface Bot {
  cls: PlayerClass;
  sent: string[];
  session: import('../../server/game').ClientSession;
}

function sha(parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex');
}

// ents/keep sorted by id; everything else byte-preserved via re-stringify of
// the parsed frame (JSON.stringify keeps original key insertion order).
function canonSnap(raw: string): string {
  const snap = JSON.parse(raw);
  if (Array.isArray(snap.ents))
    snap.ents.sort((a: { id: number }, b: { id: number }) => a.id - b.id);
  if (Array.isArray(snap.keep)) snap.keep.sort((a: number, b: number) => a - b);
  return JSON.stringify(snap);
}

function runScenario(): {
  fixture: Fixture;
} {
  const server = new GameServer();
  const classes: PlayerClass[] = ['warrior', 'mage', 'priest', 'hunter'];
  const bots: Bot[] = classes.map((cls, i) => {
    const sent: string[] = [];
    const ws = { readyState: 1, send: (payload: string) => sent.push(payload) };
    const session = server.join(ws as never, 1000 + i, 1000 + i, `Golden${cls}`, cls, null);
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
    sim: { tick(): unknown[]; utcDay: string };
  };
  g.sim.utcDay = '2026-01-01';

  const msg = (bot: Bot, obj: Record<string, unknown>): void =>
    g.handleMessage(bot.session, JSON.stringify(obj));

  // Arm the fleet: level 12 at the Wolf Run camp, a few yards apart.
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
      // The msg-rate bucket refills on wall-clock seconds; a tight test loop
      // sends 400 ticks of frames in under a second, so without a top-up the
      // number of dropped frames depends on how fast this process runs (JIT
      // warmth), which leaks nondeterminism into the ack echo. The limiter is
      // not under test here.
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
    // The exact per-tick order of GameServer.start()'s interval body.
    g.clearStaleInputs();
    const events = g.sim.tick();
    g.routeEvents(events);
    g.detectActivity(events);
    g.runAntibotTick();
    g.broadcastSnapshots();
  }

  const rawSnaps: string[] = [];
  const canonSnaps: string[] = [];
  const rawEvents: string[] = [];
  let snapBytes = 0;
  let sawDamage = false;
  let sawAura = false;
  bots.forEach((bot, i) => {
    for (const raw of bot.sent) {
      if (raw.startsWith('{"t":"snap"')) {
        rawSnaps.push(`#${i}:`, raw);
        canonSnaps.push(`#${i}:`, canonSnap(raw));
        snapBytes += raw.length;
        if (!sawAura && raw.includes('"auras":[{')) sawAura = true;
      } else if (raw.startsWith('{"t":"events"')) {
        rawEvents.push(`#${i}:`, raw);
        if (!sawDamage && raw.includes('"type":"damage"')) sawDamage = true;
      }
    }
  });

  return {
    fixture: {
      ticks: TICKS,
      players: classes,
      rawSnapsSha: sha(rawSnaps),
      canonSnapsSha: sha(canonSnaps),
      rawEventsSha: sha(rawEvents),
      snapFrames: rawSnaps.length / 2,
      eventFrames: rawEvents.length / 2,
      snapBytes,
      sawDamage,
      sawAura,
    },
  };
}

describe('broadcast wire golden', () => {
  beforeAll(() => {
    process.env.ALLOW_DEV_COMMANDS = '1';
  });

  it('reproduces the pinned outbound frame digests', () => {
    process.env.ALLOW_DEV_COMMANDS = '1';
    const { fixture } = runScenario();

    // The golden must actually exercise combat wire content, or it has no teeth.
    expect(fixture.sawDamage).toBe(true);
    expect(fixture.sawAura).toBe(true);
    expect(fixture.snapFrames).toBeGreaterThan(TICKS * 3);

    if (process.env.UPDATE_BROADCAST_GOLDEN === '1') {
      writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
      return;
    }
    const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
    expect(fixture.canonSnapsSha).toBe(golden.canonSnapsSha);
    expect(fixture.rawEventsSha).toBe(golden.rawEventsSha);
    expect(fixture.rawSnapsSha).toBe(golden.rawSnapsSha);
    expect(fixture.snapFrames).toBe(golden.snapFrames);
    expect(fixture.eventFrames).toBe(golden.eventFrames);
    expect(fixture.snapBytes).toBe(golden.snapBytes);
  });

  it('is stable across two runs in one process (no wall-clock leakage)', () => {
    process.env.ALLOW_DEV_COMMANDS = '1';
    const a = runScenario().fixture;
    const b = runScenario().fixture;
    expect(a.rawSnapsSha).toBe(b.rawSnapsSha);
    expect(a.rawEventsSha).toBe(b.rawEventsSha);
  });
});
