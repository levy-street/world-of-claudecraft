// The Rift forge wire gate (server/rift_forge_gate.ts).
//
// The forge trio (rift_upgrade_item / rift_enchant_item / rift_socket_gem)
// shipped sim+wire complete with no client UI, and players proved the obvious:
// a crafted authenticated frame reaches the dispatch arms fine, buying real
// combat stats the stock client has no path to. The gate closes the wire
// unless the realm opts in with RIFT_FORGE_ENABLED=1.
//
// Pins, both arms of the flag:
//  - closed (default): each forge command refuses BEFORE the sim (no essence
//    or gem spend, no payload mutation, zero riftForgeResult events), answers
//    ok:false on the commandOutcome ack channel for rid frames AND stays
//    refused for the rid-less frame shape an attacker actually sends, books
//    one riftForgeRefused metric per attempt, and never sets the heavy-self
//    dirty flag;
//  - open: the same wire frames drive the sim forge exactly as
//    tests/rift_progression.test.ts pins it offline (which is also the proof
//    that the OFFLINE Sim stays ungated: that suite runs with no env set),
//    with NO commandOutcome ack (so the closed arm's ok:false provably comes
//    from the gate) and no refusal metric;
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
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
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
import { noopGameMetricsCounters, setGameMetricsCounters } from '../server/http/game_signals';
import {
  RIFT_FORGE_WIRE_COMMANDS,
  refusedRiftForgeCommand,
  riftForgeWireEnabled,
} from '../server/rift_forge_gate';
import { RIFT_ESSENCE_ITEM_ID, RIFT_GEM_IDS } from '../src/sim/content/rift/items';
import { createRiftGearInstance } from '../src/sim/rift/progression';
import { fakeWs, joinServer } from './helpers/bare_client';

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
  it('is closed unless RIFT_FORGE_ENABLED is exactly 1', () => {
    expect(riftForgeWireEnabled({})).toBe(false);
    expect(riftForgeWireEnabled({ RIFT_FORGE_ENABLED: undefined })).toBe(false);
    expect(riftForgeWireEnabled({ RIFT_FORGE_ENABLED: '0' })).toBe(false);
    // Strict opt-in, not truthiness: "true"/"yes" must not open a realm.
    expect(riftForgeWireEnabled({ RIFT_FORGE_ENABLED: 'true' })).toBe(false);
    expect(riftForgeWireEnabled({ RIFT_FORGE_ENABLED: 'TRUE' })).toBe(false);
    expect(riftForgeWireEnabled({ RIFT_FORGE_ENABLED: 'yes' })).toBe(false);
    // The near-miss shapes a hand-edited .env actually produces stay closed too.
    expect(riftForgeWireEnabled({ RIFT_FORGE_ENABLED: '' })).toBe(false);
    expect(riftForgeWireEnabled({ RIFT_FORGE_ENABLED: ' 1' })).toBe(false);
    expect(riftForgeWireEnabled({ RIFT_FORGE_ENABLED: '1 ' })).toBe(false);
    expect(riftForgeWireEnabled({ RIFT_FORGE_ENABLED: '1' })).toBe(true);
  });

  it('refuses exactly the three forge tokens while closed, and nothing else ever', () => {
    expect(RIFT_FORGE_WIRE_COMMANDS).toEqual([
      'rift_upgrade_item',
      'rift_enchant_item',
      'rift_socket_gem',
    ]);
    for (const cmd of RIFT_FORGE_WIRE_COMMANDS) {
      expect(refusedRiftForgeCommand(cmd, {}), `${cmd} must refuse while closed`).toBe(true);
      expect(
        refusedRiftForgeCommand(cmd, { RIFT_FORGE_ENABLED: '1' }),
        `${cmd} must pass while open`,
      ).toBe(false);
    }
    // Non-forge traffic never draws a verdict from this gate, open or closed.
    expect(refusedRiftForgeCommand('salvage_item', {})).toBe(false);
    expect(refusedRiftForgeCommand('castSlot', {})).toBe(false);
    expect(refusedRiftForgeCommand(undefined, {})).toBe(false);
    expect(refusedRiftForgeCommand(42, {})).toBe(false);
  });
});

describe('rift forge wire gate: completeness and the ops contract', () => {
  /**
   * A future rift dispatch arm that must NOT be forge-gated earns an entry
   * here with a written reason (the item_copy_addressing_guard shape). Empty
   * today: every rift_* wire command is a forge command.
   */
  const EXEMPT: ReadonlyArray<{ cmd: string; why: string }> = [];

  it("every case 'rift_*' dispatch arm is gated or exempted with a reason", () => {
    // Source scan, like tests/item_copy_addressing_guard.test.ts: behavior
    // tests cover what the gate DOES; only a sweep can say the NEXT forge
    // command did not ship around it.
    const source = readFileSync(new URL('../server/game.ts', import.meta.url), 'utf8');
    const labels = new Set<string>();
    for (const m of source.matchAll(/case '(rift_[a-z_]+)':/g)) labels.add(m[1]);
    expect(labels.size, 'expected the scan to find the forge arms').toBeGreaterThanOrEqual(3);
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

  it('closed (default): all three commands spend nothing, mutate nothing, answer ok:false', () => {
    delete process.env.RIFT_FORGE_ENABLED;
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
        cmd: 'rift_enchant_item',
        item: itemId,
        stat: 'critRating',
        rid: 12,
      }),
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
    expect(rift?.enchant).toBeUndefined();
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
      { t: 'commandOutcome', rid: 12, ok: false },
      { t: 'commandOutcome', rid: 13, ok: false },
    ]);
    // Every attempt books the ops counter, the rid-less one included.
    expect(refusals.count()).toBe(4);
    // Refused ABOVE the heavy-self dirty flag: a blocked frame cannot force a re-diff.
    expect(session.selfHeavyDirty).toBe(false);
  });

  it('open (RIFT_FORGE_ENABLED=1): the same wire frames drive the sim forge as before', () => {
    process.env.RIFT_FORGE_ENABLED = '1';
    const refusals = recordingRefusalSink();
    const { server, fc, session, pid, itemId } = forgeReadySession();
    const essenceBefore = server.sim.countItem(RIFT_ESSENCE_ITEM_ID, pid);
    session.selfHeavyDirty = false;
    server.sim.drainEvents();

    // Same rid-carrying shape as the closed arm, so the ack channel is the
    // differential: the allowed arms send NO commandOutcome, proving the
    // closed arm's ok:false frames come from the gate and nowhere else.
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'rift_upgrade_item', item: itemId, rid: 21 }),
    );
    server.handleMessage(
      session,
      JSON.stringify({
        t: 'cmd',
        cmd: 'rift_enchant_item',
        item: itemId,
        stat: 'critRating',
        rid: 22,
      }),
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

    const rift = riftPayload(server, pid, itemId);
    expect(rift?.upgradeLevel).toBe(1);
    // S rank is power 4, so the enchant value is ceil(4 / 2) = 2.
    expect(rift?.enchant).toEqual({ stat: 'critRating', value: 2 });
    expect(rift?.gems).toEqual([RIFT_GEM_IDS[0]]);
    // Upgrade at level 0 costs 2 essence, the enchant a flat 4.
    expect(server.sim.countItem(RIFT_ESSENCE_ITEM_ID, pid)).toBe(essenceBefore - 6);
    expect(server.sim.countItem(RIFT_GEM_IDS[0], pid)).toBe(0);
    // Positive control for the closed arm's zero: the sim really does queue
    // one ok result per forge action when allowed to run.
    const results = forgeResults(server);
    expect(results).toHaveLength(3);
    expect(results.every((ev) => ev.ok === true)).toBe(true);
    expect(fc.sent.filter((m) => m.t === 'commandOutcome')).toEqual([]);
    expect(refusals.count()).toBe(0);
    // An allowed forge command is inventory-mutating, so HEAVY_SELF_CMDS re-arms
    // the heavy self diff exactly as it did before the gate existed.
    expect(session.selfHeavyDirty).toBe(true);
  });

  it('reads the flag per verdict on a live server, not captured at construction', () => {
    delete process.env.RIFT_FORGE_ENABLED;
    const { server, session, pid, itemId } = forgeReadySession();
    const frame = JSON.stringify({ t: 'cmd', cmd: 'rift_upgrade_item', item: itemId });

    server.handleMessage(session, frame);
    expect(riftPayload(server, pid, itemId)?.upgradeLevel).toBe(0);

    // Flip the env on the SAME server instance: the very next frame forges,
    // which a constructor-captured flag could not do.
    process.env.RIFT_FORGE_ENABLED = '1';
    server.handleMessage(session, frame);
    expect(riftPayload(server, pid, itemId)?.upgradeLevel).toBe(1);
  });
});
