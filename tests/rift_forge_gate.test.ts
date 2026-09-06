// The Rift forge wire gate (server/rift_forge_gate.ts).
//
// The forge pair (rift_upgrade_item / rift_socket_gem; the original third arm,
// rift_enchant_item, retired with the band item-level ladder and is a
// dispatch-only no-op tombstone now) shipped sim+wire first and its client UI
// (the Rift Forge window) later. The
// gate was a strict opt-in while no stock UI existed; now that the forge
// ships it is an ops kill switch: RIFT_FORGE_ENABLED=0 closes the wire,
// anything else (including unset) keeps it open.
//
// Pins, both arms of the flag:
//  - closed (RIFT_FORGE_ENABLED=0): each forge command refuses BEFORE the sim (no essence
//    or gem spend, no payload mutation, zero riftForgeResult events), answers
//    ok:false on the commandOutcome ack channel for rid frames AND stays
//    refused for the rid-less frame shape an attacker actually sends, books
//    one riftForgeRefused metric per attempt, and never sets the heavy-self
//    dirty flag;
//  - open (default): the same wire frames drive the sim forge exactly as
//    tests/rift_progression.test.ts pins it offline (which is also the proof
//    that the OFFLINE Sim never reads the env), acking ok:true from the sim
//    verdict (so the closed arm's ok:false provably comes from the gate), and
//    a sim-side refusal acks ok:false with no refusal metric;
//  - the flag is read per verdict on a LIVE server, not captured at
//    construction;
//  - completeness: every `case 'rift_*'` dispatch arm is either in
//    RIFT_FORGE_WIRE_COMMANDS or carries a written exemption, so the next
//    forge command cannot ship ungated, and the env key stays pinned in its
//    ops surfaces (.env.example, DEPLOY.md, turbo.json).
//
// Db is mocked so no Postgres runs (the afk_wire / bags_money_refresh idiom).

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  // The canonical GameServer db-mock shape (tests/character_lease_game.test.ts):
  // thinner mocks fail only on the merged tree when game.ts grows a './db'
  // import, so mirror the template rather than the minimum this file reaches.
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => null),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { GameServer } from '../server/game';
import { noopGameMetricsCounters, setGameMetricsCounters } from '../server/http/game_signals';
import {
  RIFT_FORGE_WIRE_COMMANDS,
  refusedRiftForgeCommand,
  riftForgeWireEnabled,
} from '../server/rift_forge_gate';
import { RIFT_ESSENCE_ITEM_ID, RIFT_GEM_IDS } from '../src/sim/content/rift/items';
import { createRiftGearInstance } from '../src/sim/rift/progression';
import { fakeWs, joinServer } from './helpers/bare_client';
import { moveFarFromRiftForge, moveToRiftForge } from './helpers/rift_forge';

/** A joined session holding one S-rank band, 20 essence, and one gem. */
function forgeReadySession() {
  const server = new GameServer();
  const fc = fakeWs();
  const session = joinServer(server, fc, 7101, 'Forgeproof');
  const pid = session.pid;
  const gear = createRiftGearInstance('forge-gate-test', 'S', 'warrior', pid);
  server.sim.addItemInstance(gear.itemId, gear.instance, pid);
  server.sim.addItem(RIFT_ESSENCE_ITEM_ID, 20, pid);
  server.sim.addItem(RIFT_GEM_IDS[0], 1, pid);
  moveToRiftForge(server.sim, pid);
  return { server, fc, session, pid, itemId: gear.itemId };
}

function riftPayload(server: GameServer, pid: number, itemId: string) {
  const slot = server.sim.meta(pid)?.inventory.find((s) => s.itemId === itemId);
  return slot?.instance?.rift;
}

/** Count riftForgeResult events pending in the sim (the server drains on tick). */
function forgeResults(server: GameServer): Array<{ ok?: boolean }> {
  // biome-ignore lint/suspicious/noExplicitAny: SimEvent union narrowed by type tag
  return (server.sim.drainEvents() as any[]).filter((ev) => ev.type === 'riftForgeResult');
}

/** A metrics sink that counts riftForgeRefused and drops everything else. */
function recordingRefusalSink(): { count: () => number } {
  let refused = 0;
  setGameMetricsCounters({
    ...noopGameMetricsCounters,
    riftForgeRefused() {
      refused++;
    },
  });
  return { count: () => refused };
}

describe('rift forge wire gate: the pure verdict', () => {
  it('is open unless RIFT_FORGE_ENABLED spells off (the kill switch)', () => {
    expect(riftForgeWireEnabled({})).toBe(true);
    expect(riftForgeWireEnabled({ RIFT_FORGE_ENABLED: undefined })).toBe(true);
    expect(riftForgeWireEnabled({ RIFT_FORGE_ENABLED: '1' })).toBe(true);
    // Every obvious off spelling closes it, trimmed and case-insensitive: an
    // operator pausing the forge in an incident must not be left open by a
    // spelling (the reason a kill switch is looser than the old strict opt-in).
    for (const off of ['0', 'false', 'off', 'no', 'FALSE', 'Off', ' 0', '0 ']) {
      expect(riftForgeWireEnabled({ RIFT_FORGE_ENABLED: off }), off).toBe(false);
    }
    // Empty and unrecognized values keep it open (nothing was asked for).
    expect(riftForgeWireEnabled({ RIFT_FORGE_ENABLED: '' })).toBe(true);
    expect(riftForgeWireEnabled({ RIFT_FORGE_ENABLED: 'closed' })).toBe(true);
  });

  it('refuses exactly the two forge tokens while closed, and nothing else ever', () => {
    expect(RIFT_FORGE_WIRE_COMMANDS).toEqual(['rift_upgrade_item', 'rift_socket_gem']);
    const closed = { RIFT_FORGE_ENABLED: '0' };
    for (const cmd of RIFT_FORGE_WIRE_COMMANDS) {
      expect(refusedRiftForgeCommand(cmd, closed), `${cmd} must refuse while closed`).toBe(true);
      expect(refusedRiftForgeCommand(cmd, {}), `${cmd} must pass by default`).toBe(false);
    }
    // Non-forge traffic never draws a verdict from this gate, open or closed.
    expect(refusedRiftForgeCommand('salvage_item', closed)).toBe(false);
    expect(refusedRiftForgeCommand('castSlot', closed)).toBe(false);
    expect(refusedRiftForgeCommand(undefined, closed)).toBe(false);
    expect(refusedRiftForgeCommand(42, closed)).toBe(false);
  });
});

describe('rift forge wire gate: completeness and the ops contract', () => {
  /**
   * A rift dispatch arm that must NOT be forge-gated earns an entry here with
   * a written reason (the item_copy_addressing_guard shape).
   */
  const EXEMPT: ReadonlyArray<{ cmd: string; why: string }> = [
    {
      cmd: 'rift_enchant_item',
      why: 'retired tombstone: the forge enchant went away with the band item-level ladder (rift/band_ladder.ts); the append-only vocabulary keeps the token and the arm is a no-op that spends and mutates nothing, so there is nothing for the gate to close',
    },
  ];

  it("every case 'rift_*' dispatch arm is gated or exempted with a reason", () => {
    // Source scan, like tests/item_copy_addressing_guard.test.ts: behavior
    // tests cover what the gate DOES; only a sweep can say the NEXT forge
    // command did not ship around it.
    const source = readFileSync(new URL('../server/game.ts', import.meta.url), 'utf8');
    const labels = new Set<string>();
    for (const m of source.matchAll(/case '(rift_[a-z_]+)':/g)) labels.add(m[1]);
    expect(labels.size, 'expected the scan to find the forge arms').toBeGreaterThanOrEqual(2);
    const classified = new Set<string>([
      ...RIFT_FORGE_WIRE_COMMANDS,
      ...EXEMPT.map((row) => row.cmd),
    ]);
    for (const row of EXEMPT) {
      expect(row.why.length, `${row.cmd} needs a real reason`).toBeGreaterThan(30);
    }
    const unclassified = [...labels].filter((cmd) => !classified.has(cmd)).sort();
    expect(
      unclassified,
      'a new rift_* wire command must join RIFT_FORGE_WIRE_COMMANDS or be exempted with a reason',
    ).toEqual([]);
    // And the gate list itself must not name a token the dispatch no longer has.
    const stale = RIFT_FORGE_WIRE_COMMANDS.filter((cmd) => !labels.has(cmd));
    expect(stale, 'gated token with no dispatch arm').toEqual([]);
  });

  it('the env key is pinned in its ops surfaces', () => {
    // The flag is a five-place contract (module, .env.example, DEPLOY.md,
    // turbo.json, this suite); a rename must not leave the ops half stale.
    for (const file of ['../.env.example', '../DEPLOY.md', '../turbo.json']) {
      const text = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(text, `${file} must document RIFT_FORGE_ENABLED`).toContain('RIFT_FORGE_ENABLED');
    }
  });
});

describe('rift forge wire gate: server dispatch', () => {
  // process.env is safe to flip here because vitest's default forks pool gives
  // each test file its own process and files in one fork run sequentially;
  // under a threads pool this would need vi.stubEnv instead.
  const saved = process.env.RIFT_FORGE_ENABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.RIFT_FORGE_ENABLED;
    else process.env.RIFT_FORGE_ENABLED = saved;
    setGameMetricsCounters(noopGameMetricsCounters);
  });

  it('closed (RIFT_FORGE_ENABLED=0): both commands spend nothing, mutate nothing, answer ok:false', () => {
    process.env.RIFT_FORGE_ENABLED = '0';
    const refusals = recordingRefusalSink();
    const { server, fc, session, pid, itemId } = forgeReadySession();
    const essenceBefore = server.sim.countItem(RIFT_ESSENCE_ITEM_ID, pid);
    const gemBefore = server.sim.countItem(RIFT_GEM_IDS[0], pid);
    expect(essenceBefore).toBe(20);
    session.selfHeavyDirty = false;
    server.sim.drainEvents();

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'rift_upgrade_item', item: itemId, rid: 11 }),
    );
    server.handleMessage(
      session,
      JSON.stringify({
        t: 'cmd',
        cmd: 'rift_socket_gem',
        item: itemId,
        gem: RIFT_GEM_IDS[0],
        rid: 13,
      }),
    );
    // The frame shape an attacker actually sends: no rid at all. It must be
    // refused identically, not slip through because there is no ack to send
    // (the gate must not be conditional on the ack).
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'rift_upgrade_item', item: itemId }),
    );

    const rift = riftPayload(server, pid, itemId);
    expect(rift?.upgradeLevel).toBe(0);
    expect(rift?.gems).toEqual([]);
    expect(server.sim.countItem(RIFT_ESSENCE_ITEM_ID, pid)).toBe(essenceBefore);
    expect(server.sim.countItem(RIFT_GEM_IDS[0], pid)).toBe(gemBefore);
    // Refused before the sim: no riftForgeResult ever forms (drained straight
    // from the sim, where a run WOULD have queued it; see the open arm's 3).
    expect(forgeResults(server)).toEqual([]);
    // The refusal answers on the commandOutcome ack channel, ok:false per rid,
    // and only for the rid frames.
    expect(fc.sent.filter((m) => m.t === 'commandOutcome')).toEqual([
      { t: 'commandOutcome', rid: 11, ok: false },
      { t: 'commandOutcome', rid: 13, ok: false },
    ]);
    // Every attempt books the ops counter, the rid-less one included.
    expect(refusals.count()).toBe(3);
    // Refused ABOVE the heavy-self dirty flag: a blocked frame cannot force a re-diff.
    expect(session.selfHeavyDirty).toBe(false);
  });

  it('open (default): the same wire frames drive the sim forge and ack ok:true', () => {
    delete process.env.RIFT_FORGE_ENABLED;
    const refusals = recordingRefusalSink();
    const { server, fc, session, pid, itemId } = forgeReadySession();
    const essenceBefore = server.sim.countItem(RIFT_ESSENCE_ITEM_ID, pid);
    session.selfHeavyDirty = false;
    server.sim.drainEvents();

    // Same rid-carrying shape as the closed arm, so the ack channel is the
    // differential: the allowed arms ack ok:true from the sim verdict
    // (server/rift_forge_dispatch.ts), proving the closed arm's ok:false
    // frames come from the gate and nowhere else.
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'rift_upgrade_item', item: itemId, rid: 21 }),
    );
    server.handleMessage(
      session,
      JSON.stringify({
        t: 'cmd',
        cmd: 'rift_socket_gem',
        item: itemId,
        gem: RIFT_GEM_IDS[0],
        rid: 23,
      }),
    );
    // The retired token: dispatched (no unknown-command path), but a no-op
    // with the wire open too. It must neither spend nor answer.
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'rift_enchant_item', item: itemId, stat: 'critRating' }),
    );

    const rift = riftPayload(server, pid, itemId);
    expect(rift?.upgradeLevel).toBe(1);
    expect(rift?.gems).toEqual([RIFT_GEM_IDS[0]]);
    // Upgrade at level 0 costs 2 essence; the socket costs the gem only.
    expect(server.sim.countItem(RIFT_ESSENCE_ITEM_ID, pid)).toBe(essenceBefore - 2);
    expect(server.sim.countItem(RIFT_GEM_IDS[0], pid)).toBe(0);
    // Positive control for the closed arm's zero: the sim really does queue
    // one ok result per forge action when allowed to run.
    const results = forgeResults(server);
    expect(results).toHaveLength(2);
    expect(results.every((ev) => ev.ok === true)).toBe(true);
    expect(fc.sent.filter((m) => m.t === 'commandOutcome')).toEqual([
      { t: 'commandOutcome', rid: 21, ok: true },
      { t: 'commandOutcome', rid: 23, ok: true },
    ]);
    expect(refusals.count()).toBe(0);
    // An allowed forge command is inventory-mutating, so HEAVY_SELF_CMDS re-arms
    // the heavy self diff exactly as it did before the gate existed.
    expect(session.selfHeavyDirty).toBe(true);
  });

  it('open: a sim refusal (away from the Riftwright) acks ok:false with no gate metric', () => {
    delete process.env.RIFT_FORGE_ENABLED;
    const refusals = recordingRefusalSink();
    const { server, fc, session, pid, itemId } = forgeReadySession();
    moveFarFromRiftForge(server.sim, pid);
    server.sim.drainEvents();
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'rift_upgrade_item', item: itemId, rid: 31 }),
    );
    // The wire was open (no refusal booked) but the sim's place gate said no:
    // the ack carries that verdict so the forge window can show the refusal,
    // and the essence stays untouched.
    expect(fc.sent.filter((m) => m.t === 'commandOutcome')).toEqual([
      { t: 'commandOutcome', rid: 31, ok: false },
    ]);
    expect(refusals.count()).toBe(0);
    expect(server.sim.countItem(RIFT_ESSENCE_ITEM_ID, pid)).toBe(20);
    expect(riftPayload(server, pid, itemId)?.upgradeLevel).toBe(0);
    // A malformed frame (no item) gets no ack at all, like every other
    // malformed command.
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'rift_upgrade_item', rid: 32 }));
    expect(fc.sent.filter((m) => m.t === 'commandOutcome' && m.rid === 32)).toEqual([]);
  });

  it('reads the flag per verdict on a live server, not captured at construction', () => {
    process.env.RIFT_FORGE_ENABLED = '0';
    const { server, session, pid, itemId } = forgeReadySession();
    const frame = JSON.stringify({ t: 'cmd', cmd: 'rift_upgrade_item', item: itemId });

    server.handleMessage(session, frame);
    expect(riftPayload(server, pid, itemId)?.upgradeLevel).toBe(0);

    // Flip the env on the SAME server instance: the very next frame forges,
    // which a constructor-captured flag could not do.
    delete process.env.RIFT_FORGE_ENABLED;
    server.handleMessage(session, frame);
    expect(riftPayload(server, pid, itemId)?.upgradeLevel).toBe(1);
  });
});
