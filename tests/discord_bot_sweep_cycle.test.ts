// The whole linked-member sweep, composed and driven at production scale.
//
// The unit suites beside this one pin each piece: the set and the pass in
// tests/discord_bot_linked_sweep.test.ts, the diff-before-write paths in
// tests/discord_bot_member_writes.test.ts, the chained-timeout loop in
// tests/discord_bot_scheduler.test.ts. What none of them can say is what the
// pieces do TOGETHER over time, which is the only level the incident this packet
// exists for is visible at: the old sweep read every online member in one tick
// and queued every Discord write it produced at once, and no assertion about any
// single piece of it was wrong.
//
// So this rig wires the REAL sweep cycle (bot/sweep_cycle.ts, the unit
// bot/main.ts registers), over the REAL LinkedSweep, the REAL LoopScheduler and
// the REAL write paths, against fake IO, at the D18 envelope (5000 guild
// members, 1000 online, 300 linked), and asserts the four properties that
// decide whether the bot is healthy in production:
//   D6  the sweep asks about LINKED members, never the online set or the roster;
//   the SPREAD, that one tick's writes are bounded by one slice and the slices
//       sit a slice interval apart on the clock;
//   D5  a steady state with nothing changed costs zero writes of either kind;
//   and that a real change still reaches Discord on the very next pass.
//
// Time is the synthetic clock, never vitest fake timers: a captured clock does
// not move under fake timers, so a rig built on them passes for an
// implementation that quietly reads the real one (tests/helpers/synthetic_clock.ts).
import { describe, expect, it } from 'vitest';
import { DEFAULT_SWEEP_SLICE_SIZE, LinkedSweep, unappliedIdsFrom } from '../bot/linked_sweep';
import { buildLevelNick, type MemberMetaRecord } from '../bot/logic';
import {
  type NicknameCaches,
  pushChangedMemberMeta,
  pushOneMemberMeta,
} from '../bot/member_writes';
import { GovernorBlockedError, MAX_QUEUE_DEPTH } from '../bot/rate_governor';
import { LoopScheduler, type ScheduledTask, type SchedulerTimers } from '../bot/scheduler';
import { createSweepCycle } from '../bot/sweep_cycle';
import { type SyntheticClock, syntheticClock } from './helpers/synthetic_clock';

// The D18 envelope. Named rather than inline because several assertions are
// about the RELATIONSHIP between them (a pass is ROSTER/SLICE_SIZE slices during
// discovery and LINKED/SLICE_SIZE after it).
const ROSTER_SIZE = 5_000;
const ONLINE_SIZE = 1_000;
const LINKED_SIZE = 300;
const SLICE_SIZE = 100;
const SLICE_MS = 3_000;
const PASS_MS = 300_000;

const CLASSES = ['warrior', 'paladin', 'hunter', 'rogue', 'priest', 'mage'];

function memberId(index: number): string {
  return `1122334455${String(index).padStart(9, '0')}`;
}

type WriteKind = 'nick' | 'role-add' | 'role-remove';

interface DiscordWrite {
  atMs: number;
  kind: WriteKind;
  userId: string;
  value: string;
}

interface Account {
  level: number;
  className: string;
  statusTier: number;
  username: string;
}

/**
 * The scheduler's timer seam over virtual time. The scheduler owns exactly one
 * timer per task and arms the next only after a run settles, so a sleep on the
 * synthetic clock is a faithful stand-in: nothing fires until the test moves
 * time, and the schedule that comes out is exactly reproducible.
 */
function clockTimers(clock: SyntheticClock): SchedulerTimers {
  let nextHandle = 1;
  const cancelled = new Set<number>();
  return {
    setTimeout(cb: () => void, ms: number) {
      const handle = nextHandle++;
      void clock.sleep(ms).then(() => {
        if (!cancelled.has(handle)) cb();
      });
      return handle;
    },
    clearTimeout(handle) {
      cancelled.add(handle as number);
    },
  };
}

interface Rig {
  clock: SyntheticClock;
  sweep: LinkedSweep;
  task: ScheduledTask;
  /** Every Discord write that reached the wire, in order, stamped with the clock. */
  writes: DiscordWrite[];
  /** Every members-meta record the bot pushed to the game server. */
  metaPushes: MemberMetaRecord[];
  /** One entry per flex-batch request: when it went out and what it asked about. */
  flexCalls: { atMs: number; ids: string[] }[];
  /** How many writes reached the governed entry point, refused ones included. */
  gated: () => number;
  refusals: () => number;
  /** True while a sweep run is between its first await and its last. */
  inFlight: () => boolean;
  roster: string[];
  online: Set<string>;
  linked: string[];
  accounts: Map<string, Account>;
  caches: NicknameCaches;
  lastPushedMeta: Map<string, MemberMetaRecord>;
  memberRoles: Map<string, string[]>;
  /** Ids whose Discord writes the fake governor refuses, standing in for a breaker. */
  blocked: Set<string>;
  /**
   * Fault injection for the fake server's flex-batch: `fail` answers null (the
   * ServerClient failure shape), `injectUnasked` appends a member the slice
   * never asked about (a buggy or compromised answer).
   */
  flexAnswer: { fail: boolean; injectUnasked: string };
  /**
   * Push every roster member's meta, the shape the hourly full resync takes.
   * `unapplied` is the ids the server reports it could not apply, or 'omit' for
   * a server that does not report the field at all.
   */
  pushRosterMeta: (unapplied: string[] | 'omit') => Promise<void>;
}

/**
 * The bot's sweep wiring over fake IO, around the PRODUCTION cycle.
 *
 * The loop bodies come from bot/sweep_cycle.ts, the unit bot/main.ts registers
 * (main.ts itself calls main() at module scope, so importing IT would boot the
 * whole bot: real env, real Discord REST, a real WebSocket). This rig only
 * rebuilds what main.ts BINDS: the fake shells, the guild-state maps, and the
 * scheduler registration; tests/discord_bot_main_wiring.test.ts pins that
 * main.ts still binds the same seams.
 */
function buildRig(): Rig {
  const clock = syntheticClock(1_000_000);
  const sweep = new LinkedSweep();

  const roster = Array.from({ length: ROSTER_SIZE }, (_, i) => memberId(i));
  // Online is a wide, deliberately WRONG set for the sweep to key on: it holds
  // members with no linked account, and misses linked members who are offline in
  // Discord but still playing the game.
  const online = new Set(roster.slice(0, ONLINE_SIZE));
  // Every 7th member is linked, so the linked set straddles the online boundary:
  // some are online, most are not.
  const linked = roster.filter((_, i) => i % 7 === 0).slice(0, LINKED_SIZE);

  const accounts = new Map<string, Account>();
  linked.forEach((id, i) => {
    accounts.set(id, {
      level: 10 + (i % 20),
      className: CLASSES[i % CLASSES.length],
      statusTier: 1 + (i % 8),
      username: `Player${i}`,
    });
  });

  const memberRoles = new Map<string, string[]>(roster.map((id) => [id, []]));
  const caches: NicknameCaches = {
    memberNicks: new Map(roster.map((id) => [id, null])),
    memberNames: new Map(roster.map((id, i) => [id, `Member${i}`])),
    lastWrittenNick: new Map(),
  };
  const lastPushedMeta = new Map<string, MemberMetaRecord>();
  const tierRoleIds = new Map<number, string>(
    Array.from({ length: 8 }, (_, i) => [i + 1, `role-tier-${i + 1}`]),
  );

  const writes: DiscordWrite[] = [];
  const metaPushes: MemberMetaRecord[] = [];
  const flexCalls: { atMs: number; ids: string[] }[] = [];
  const blocked = new Set<string>();
  let gated = 0;
  let refusals = 0;

  // The ONE entry point every Discord write passes through, standing in for the
  // rate governor: DiscordApi refuses a blocked write by throwing before any
  // HTTP happens, so a refusal here has the same shape a breaker-open one does.
  const governed = async (write: DiscordWrite): Promise<void> => {
    gated++;
    if (blocked.has(write.userId)) {
      refusals++;
      throw new GovernorBlockedError('breaker-open', `[bot] refused ${write.kind}`);
    }
    writes.push(write);
  };
  const discord = {
    setNickname: (userId: string, nick: string) =>
      governed({ atMs: clock.now(), kind: 'nick', userId, value: nick }),
    addMemberRole: (userId: string, roleId: string) =>
      governed({ atMs: clock.now(), kind: 'role-add', userId, value: roleId }),
    removeMemberRole: (userId: string, roleId: string) =>
      governed({ atMs: clock.now(), kind: 'role-remove', userId, value: roleId }),
  };

  const flexAnswer = { fail: false, injectUnasked: '' };
  const flexMember = (id: string) => {
    const account = accounts.get(id) as Account;
    return {
      discord_user_id: id,
      linked: true as const,
      found: true,
      username: account.username,
      statusTier: account.statusTier,
      points: 0,
      character: {
        name: account.username,
        class: account.className,
        level: account.level,
        profileUrl: '',
      },
    };
  };
  const server = {
    flexBatch: async (askIds: string[]) => {
      flexCalls.push({ atMs: clock.now(), ids: [...askIds] });
      if (flexAnswer.fail) return null;
      const distinct = [...new Set(askIds)];
      const members = distinct.filter((id) => accounts.has(id)).map(flexMember);
      // An unasked id rides OUTSIDE the requested echo, exactly as a malicious
      // answer would: the echo still matches, so the answer reads authoritative.
      if (flexAnswer.injectUnasked && accounts.has(flexAnswer.injectUnasked)) {
        members.push(flexMember(flexAnswer.injectUnasked));
      }
      return { requested: distinct.length, members };
    },
    pushMembersMeta: async (records: MemberMetaRecord[]) => {
      metaPushes.push(...records);
      return { updated: records.length, changed: records.length, skipped: 0, unapplied: [] };
    },
  };
  const metaIo = { pushMembersMeta: server.pushMembersMeta };

  const memberMetaRecord = (id: string): MemberMetaRecord => ({
    discord_user_id: id,
    name: caches.memberNames.get(id) ?? null,
    joinedAtMs: 1_700_000_000_000,
    role: null,
  });

  // The PRODUCTION cycle, the same unit bot/main.ts registers, bound to this
  // rig's fake IO the way main.ts binds it to the real shells. The rig used to
  // carry a hand-kept mirror of the two loop bodies; the extraction into
  // bot/sweep_cycle.ts is what lets the composed D5/D6/spread claims below pin
  // the code production actually runs.
  const cycle = createSweepCycle({
    linkedSweep: sweep,
    now: () => clock.now(),
    sliceSize: SLICE_SIZE,
    passIntervalMs: PASS_MS,
    syncNicknames: true,
    tierRoleIds,
    memberRoles,
    nickCaches: caches,
    lastPushedMeta,
    discord,
    flexBatch: (ids) => server.flexBatch([...ids]),
    pushMemberMeta: async (id) => {
      await pushOneMemberMeta(memberMetaRecord(id), lastPushedMeta, metaIo);
    },
    onError: () => {
      /* refusals are counted by the governed gate above */
    },
  });

  // The roster members-meta push, wired the way main.ts wires it: the response
  // reports which of the ids it accepted had no link row, and that answer is
  // handed straight to the sweep. It is a free full reconciliation, because the
  // push was happening anyway.
  const pushRosterMeta = async (unapplied: string[] | 'omit'): Promise<void> => {
    const missing = unapplied === 'omit' ? null : new Set(unapplied);
    await pushChangedMemberMeta(roster.map(memberMetaRecord), lastPushedMeta, {
      pushMembersMeta: async (records: MemberMetaRecord[]) => {
        metaPushes.push(...records);
        const applied = { updated: records.length, changed: records.length, skipped: 0 };
        if (missing === null) return applied;
        return {
          ...applied,
          unapplied: records.map((r) => r.discord_user_id).filter((id) => missing.has(id)),
        };
      },
      onBatchOutcome: (batchIds, result) => {
        sweep.applyMetaPushOutcome(batchIds, unappliedIdsFrom(result));
      },
    });
  };

  const runSweepSlice = cycle.runSweepSlice;

  // Whether a run is between its first await and its last. The test driver needs
  // this rather than the clock's pending-sleeper count: `kick()` clears the
  // task's armed timer, but the synthetic clock has no cancel, so the abandoned
  // sleeper stays queued and a pending-count check would report an armed chain
  // while a run was still in flight.
  let inFlight = false;
  const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
  const task = scheduler.add({
    name: 'role-sync',
    cadence: { activeMs: SLICE_MS, idleMs: PASS_MS },
    run: async () => {
      inFlight = true;
      try {
        return await runSweepSlice();
      } finally {
        inFlight = false;
      }
    },
  });
  scheduler.startAll();

  return {
    clock,
    sweep,
    task,
    writes,
    metaPushes,
    flexCalls,
    gated: () => gated,
    refusals: () => refusals,
    inFlight: () => inFlight,
    roster,
    online,
    linked,
    accounts,
    caches,
    lastPushedMeta,
    memberRoles,
    blocked,
    flexAnswer,
    pushRosterMeta,
  };
}

/**
 * Let a run in flight finish. Virtual time does not move: a run is a chain of
 * awaited microtasks, and `advanceBy(0)` is how the clock drains them.
 *
 * Bounded, so a run that never settles fails the test rather than hanging
 * vitest. That failure mode is the reason the whole rig is on a synthetic clock
 * and not on a frozen one: a wait that never advances starves the macrotask
 * queue, so nothing times out and the suite hangs instead of going red.
 */
async function settle(rig: Rig): Promise<void> {
  for (let i = 0; i < 5_000 && rig.inFlight(); i++) await rig.clock.advanceBy(0);
  if (rig.inFlight()) throw new Error('a sweep run never settled');
}

/** Move virtual time forward, then let whatever run it started finish. */
async function advance(rig: Rig, ms: number): Promise<void> {
  await rig.clock.advanceBy(ms);
  await settle(rig);
}

/** Kick the task the way GUILD_CREATE does, and let the run it starts settle. */
async function kickAndSettle(rig: Rig): Promise<void> {
  rig.task.kick();
  await settle(rig);
}

/** Advance a slice at a time until `done` holds, or fail with what was reached. */
async function advanceUntil(rig: Rig, done: () => boolean, budgetMs = PASS_MS * 2): Promise<void> {
  const deadline = rig.clock.now() + budgetMs;
  while (!done() && rig.clock.now() < deadline) await advance(rig, SLICE_MS);
  if (!done()) throw new Error('the sweep never reached the expected state in its budget');
}

/** The complete seed: the roster is known, so discovery is armed and kicked. */
async function completeSeed(rig: Rig): Promise<void> {
  rig.sweep.armDiscovery(rig.roster);
  rig.sweep.requestPass();
  await kickAndSettle(rig);
  await advanceUntil(rig, () => !rig.sweep.isPassInProgress() && rig.sweep.size() > 0);
}

/** Every id the sweep asked flex-batch about since `from`. */
function askedSince(rig: Rig, from: number): string[] {
  return rig.flexCalls.slice(from).flatMap((call) => call.ids);
}

describe('the sweep at the D18 envelope', () => {
  it('discovers the linked members by walking the roster once, in bounded slices', async () => {
    const rig = buildRig();
    expect(rig.sweep.size()).toBe(0);
    await completeSeed(rig);

    const asked = askedSince(rig, 0);
    // Every roster member exactly once, and nobody twice: a discovery that
    // restarted (or that walked a stale snapshot) shows up as a different count.
    expect(asked.length).toBe(ROSTER_SIZE);
    expect(new Set(asked).size).toBe(ROSTER_SIZE);
    for (const call of rig.flexCalls) expect(call.ids.length).toBeLessThanOrEqual(SLICE_SIZE);
    // It took the whole roster in full slices, so the cap is REACHED and not
    // merely respected.
    expect(rig.flexCalls[0].ids.length).toBe(SLICE_SIZE);
    expect(rig.flexCalls.length).toBe(ROSTER_SIZE / SLICE_SIZE);
    // And it landed on exactly the linked members.
    expect(rig.sweep.size()).toBe(LINKED_SIZE);
    expect([...rig.sweep.linkedIds()].sort()).toEqual([...rig.linked].sort());
  });

  it('asks about the LINKED set on a steady-state pass, never the online set (D6)', async () => {
    const rig = buildRig();
    await completeSeed(rig);
    const before = rig.flexCalls.length;

    // The next pass opens once the window has elapsed.
    await advanceUntil(rig, () => rig.flexCalls.length > before, PASS_MS * 2);
    await advanceUntil(rig, () => !rig.sweep.isPassInProgress(), PASS_MS);

    const asked = askedSince(rig, before);
    expect([...asked].sort()).toEqual([...rig.linked].sort());
    expect(asked.length).toBe(LINKED_SIZE);
    // Decisive against the two wrong sets by NAME, not just by count: the sweep
    // this replaced iterated `online`, and a rescan would iterate the roster.
    const linkedSet = new Set(rig.linked);
    const onlineNotLinked = [...rig.online].filter((id) => !linkedSet.has(id));
    expect(onlineNotLinked.length).toBeGreaterThan(0);
    for (const id of onlineNotLinked.slice(0, 50)) expect(asked).not.toContain(id);
    expect(asked.length).toBeLessThan(ONLINE_SIZE);
    expect(asked.length).toBeLessThan(ROSTER_SIZE);
  });

  it('spreads the worst-case pass across the clock, one slice of writes per tick', async () => {
    const rig = buildRig();
    await completeSeed(rig);

    // The genuine worst case, and the exact shape the old sweep did in ONE tick:
    // every linked member's level AND status tier moved, so each of the 300
    // needs all three writes (the new tier role, the old one removed, and the
    // level-on-name nickname).
    for (const [id, account] of rig.accounts) {
      rig.accounts.set(id, {
        ...account,
        level: account.level + 1,
        statusTier: (account.statusTier % 8) + 1,
      });
    }
    const from = rig.writes.length;
    const callsBefore = rig.flexCalls.length;
    await advanceUntil(rig, () => rig.flexCalls.length > callsBefore, PASS_MS * 2);
    await advanceUntil(rig, () => !rig.sweep.isPassInProgress(), PASS_MS);
    const fresh = rig.writes.slice(from);
    expect(fresh.length).toBe(LINKED_SIZE * 3);

    // Grouped per tick AND per kind, because that is how the governor queues
    // them: the three write kinds are three route templates, so they are three
    // separate FIFO queues and the depth that can overflow is per queue.
    const byTick = new Map<number, Map<WriteKind, number>>();
    for (const write of fresh) {
      const kinds = byTick.get(write.atMs) ?? new Map<WriteKind, number>();
      kinds.set(write.kind, (kinds.get(write.kind) ?? 0) + 1);
      byTick.set(write.atMs, kinds);
    }
    expect(byTick.size).toBe(LINKED_SIZE / SLICE_SIZE);
    expect(byTick.size).toBeGreaterThanOrEqual(3);
    const perQueue: number[] = [];
    for (const kinds of byTick.values()) {
      const tickTotal = [...kinds.values()].reduce((a, b) => a + b, 0);
      // One tick can never cost more than one slice of members times the three
      // writes one member can need.
      expect(tickTotal).toBe(SLICE_SIZE * 3);
      perQueue.push(...kinds.values());
    }
    // The per-queue peak really is one full slice: reached, not merely
    // respected, so the spread claim above is not vacuous.
    expect(Math.max(...perQueue)).toBe(SLICE_SIZE);
    // The relationship that decides whether work is DROPPED: a burst past the
    // governor's per-queue depth is refused, which reads in production as flair
    // that silently stopped updating. Asserted on the PRODUCTION constants, not
    // on this file's local SLICE_SIZE: 100 < 256 by construction here, so a
    // local comparison could never go red, while a production slice-size raise
    // past the queue depth is exactly the regression this line exists to catch.
    expect(DEFAULT_SWEEP_SLICE_SIZE).toBeLessThan(MAX_QUEUE_DEPTH);
    expect(SLICE_SIZE).toBe(DEFAULT_SWEEP_SLICE_SIZE);

    // And the ticks sit exactly one slice interval apart. Jitter is pinned at
    // the band's midpoint (random 0.5), which jitteredDelayMs returns as the
    // base delay exactly, so these are values rather than approximations.
    const times = [...byTick.keys()].sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    expect([...new Set(gaps)]).toEqual([SLICE_MS]);
  });

  it('costs nothing at all on a second pass with nothing changed (D5)', async () => {
    const rig = buildRig();
    await completeSeed(rig);
    expect(rig.writes.length).toBeGreaterThan(0);
    expect(rig.metaPushes.length).toBeGreaterThan(0);
    const writesAfterDiscovery = rig.writes.length;
    const pushesAfterDiscovery = rig.metaPushes.length;
    const callsAfterDiscovery = rig.flexCalls.length;

    await advanceUntil(rig, () => rig.flexCalls.length > callsAfterDiscovery, PASS_MS * 2);
    await advanceUntil(rig, () => !rig.sweep.isPassInProgress(), PASS_MS);

    // The pass really ran: it asked about all 300 again.
    expect(askedSince(rig, callsAfterDiscovery).length).toBe(LINKED_SIZE);
    // And produced not one Discord write and not one members-meta push. This is
    // the property the incident was the absence of: before the diff, every
    // linked member cost a PATCH, an echoed gateway event and a game-server POST
    // every sweep forever.
    expect(rig.writes.length).toBe(writesAfterDiscovery);
    expect(rig.metaPushes.length).toBe(pushesAfterDiscovery);
  });

  it('writes exactly the member who changed, on the very next pass', async () => {
    const rig = buildRig();
    await completeSeed(rig);
    const writesBefore = rig.writes.length;
    const pushesBefore = rig.metaPushes.length;
    const callsBefore = rig.flexCalls.length;

    // One player levels up in game.
    const mover = rig.linked[137];
    const account = rig.accounts.get(mover) as Account;
    rig.accounts.set(mover, { ...account, level: account.level + 1 });

    await advanceUntil(rig, () => rig.flexCalls.length > callsBefore, PASS_MS * 2);
    await advanceUntil(rig, () => !rig.sweep.isPassInProgress(), PASS_MS);

    const fresh = rig.writes.slice(writesBefore);
    expect(fresh.length).toBe(1);
    expect(fresh[0].userId).toBe(mover);
    expect(fresh[0].kind).toBe('nick');
    expect(fresh[0].value).toBe(
      buildLevelNick(account.username, account.level + 1, account.className),
    );
    // The rename reaches the game immediately rather than waiting a whole
    // interval, because echo suppression means the gateway will not carry it.
    const pushed = rig.metaPushes.slice(pushesBefore);
    expect(pushed.length).toBe(1);
    expect(pushed[0].discord_user_id).toBe(mover);
    expect(pushed[0].name).toBe(fresh[0].value);
  });

  it('routes every Discord write through the one governed entry point', async () => {
    const rig = buildRig();
    await completeSeed(rig);

    // Each linked member's first pass is exactly two writes: the tier role they
    // hold none of yet, and the level-on-name nickname. Pinned as a number so an
    // extra write per member (an unconditional PATCH, a re-added role) fails
    // here rather than showing up as production load.
    expect(rig.writes.length).toBe(LINKED_SIZE * 2);
    expect(rig.writes.filter((w) => w.kind === 'nick').length).toBe(LINKED_SIZE);
    expect(rig.writes.filter((w) => w.kind === 'role-add').length).toBe(LINKED_SIZE);
    expect(rig.writes.filter((w) => w.kind === 'role-remove').length).toBe(0);
    // The gate saw EXACTLY the writes the fixture predicts, stated by value.
    // (An earlier form asserted gated == writes + refusals, which is an
    // invariant of this rig's own plumbing and could never fail; Phase 6 QA
    // replaced it.) The production half of the claim, that bot/main.ts has no
    // write path around the shells at all, is pinned by the no-bare-fetch test
    // in tests/discord_bot_main_wiring.test.ts.
    expect(rig.gated()).toBe(LINKED_SIZE * 2);
    expect(rig.refusals()).toBe(0);
  });

  it('re-serves a slice through the composed loop when the server answers null', async () => {
    // The rig-level version of the unit arm beside it: here the NULL answer
    // travels the same path main.ts runs (nextSlice, flexBatch, restoreSlice),
    // driven by the scheduler, so deleting the restore in the loop is visible
    // somewhere a suite actually executes.
    const rig = buildRig();
    await completeSeed(rig);
    const writesBefore = rig.writes.length;

    rig.flexAnswer.fail = true;
    rig.sweep.requestPass();
    await kickAndSettle(rig);

    const failedAsk = rig.flexCalls.at(-1)?.ids ?? [];
    expect(failedAsk.length).toBe(SLICE_SIZE);
    // Nothing was observed, so no belief moved and nothing was written.
    expect(rig.sweep.linkedIds().length).toBe(LINKED_SIZE);
    expect(rig.writes.length).toBe(writesBefore);

    // The healed server is asked about the SAME ids first: the slice went back
    // to the front rather than being skipped for the rest of the pass.
    rig.flexAnswer.fail = false;
    const callsBefore = rig.flexCalls.length;
    await advanceUntil(rig, () => rig.flexCalls.length > callsBefore);
    expect(rig.flexCalls[callsBefore].ids).toEqual(failedAsk);
  });

  it('never aims a write at an id the slice did not ask about', async () => {
    // A buggy or compromised server answer carrying an extra member must not be
    // able to steer role or nickname writes at an arbitrary guild member, and
    // must not inject them into the linked set either.
    // Seed FIRST: during discovery the roster walk legitimately asks about
    // every member, stranger included (they answer absent, being unlinked).
    // The injection starts afterwards, on a steady-state pass that asks only
    // about the linked set, so every answer then carries them UNASKED.
    const rig = buildRig();
    await completeSeed(rig);
    const stranger = rig.roster[1];
    expect(rig.sweep.has(stranger)).toBe(false);
    rig.accounts.set(stranger, {
      level: 42,
      className: 'mage',
      statusTier: 5,
      username: 'Stranger',
    });
    rig.flexAnswer.injectUnasked = stranger;

    rig.sweep.requestPass();
    await kickAndSettle(rig);
    await advanceUntil(rig, () => !rig.sweep.isPassInProgress());

    expect(rig.writes.filter((w) => w.userId === stranger)).toEqual([]);
    expect(rig.metaPushes.filter((m) => m.discord_user_id === stranger)).toEqual([]);
    expect(rig.sweep.has(stranger)).toBe(false);
  });

  it('keeps a refused member retryable and finishes the slice around them', async () => {
    const rig = buildRig();
    // The governor refuses one member's writes outright (an open breaker, a
    // cached 403, a full queue): DiscordApi throws before any HTTP happens.
    const refused = rig.linked[0];
    rig.blocked.add(refused);
    await completeSeed(rig);

    expect(rig.refusals()).toBeGreaterThan(0);
    // Nothing was written for them...
    expect(rig.writes.filter((w) => w.userId === refused)).toEqual([]);
    // ...and their caches were left exactly as they were, which is what makes
    // the next pass retry rather than believe the write landed.
    expect(rig.caches.memberNicks.get(refused)).toBe(null);
    expect(rig.caches.lastWrittenNick.has(refused)).toBe(false);
    expect(rig.lastPushedMeta.has(refused)).toBe(false);
    expect(rig.memberRoles.get(refused)).toEqual([]);
    // The rest of the slice went through: one refusal costs that member's turn
    // and nobody else's.
    const others = rig.linked.filter((id) => id !== refused);
    expect(rig.writes.filter((w) => w.kind === 'nick').length).toBe(others.length);
    expect(rig.caches.lastWrittenNick.size).toBe(others.length);

    // And the retry really happens: unblock them and the next pass writes them.
    rig.blocked.delete(refused);
    const callsBefore = rig.flexCalls.length;
    await advanceUntil(rig, () => rig.flexCalls.length > callsBefore, PASS_MS * 2);
    await advanceUntil(rig, () => !rig.sweep.isPassInProgress(), PASS_MS);
    expect(rig.writes.filter((w) => w.userId === refused).length).toBe(2);
  });

  it('re-serves a slice the server never answered, without moving any belief', async () => {
    const rig = buildRig();
    await completeSeed(rig);
    const linkedBefore = rig.sweep.linkedIds();

    // The pass in flight is interrupted: server_client answers null for a failed
    // call rather than throwing, so the slice was never asked about at all.
    const slice = rig.sweep.nextSlice(rig.clock.now(), SLICE_SIZE, PASS_MS);
    expect(slice).toBe(null);
    rig.sweep.requestPass();
    const first = rig.sweep.nextSlice(rig.clock.now(), SLICE_SIZE, PASS_MS);
    expect(first?.ids.length).toBe(SLICE_SIZE);
    rig.sweep.restoreSlice(first as NonNullable<typeof first>);

    // Nothing was learned and nothing was forgotten, and the same ids come back
    // first rather than waiting out the rest of the pass.
    expect(rig.sweep.linkedIds()).toEqual(linkedBefore);
    const again = rig.sweep.nextSlice(rig.clock.now(), SLICE_SIZE, PASS_MS);
    expect(again?.ids).toEqual(first?.ids);
  });

  it('holds the pass window rather than sweeping continuously', async () => {
    const rig = buildRig();
    await completeSeed(rig);
    const callsAfterDiscovery = rig.flexCalls.length;
    // The window runs from when a pass STARTED, not from when it drained, so
    // that a long pass does not push the next one out by its own duration.
    const discoveryStartedAt = rig.sweep.lastPassStartedAtMs();

    // Well past several slice intervals, and still nothing: between passes the
    // task decays toward the idle cadence and hands back no work at all, which
    // is what makes an idle bot free.
    await advance(rig, SLICE_MS * 10);
    expect(rig.flexCalls.length).toBe(callsAfterDiscovery);
    expect(rig.clock.now() - discoveryStartedAt).toBeLessThan(PASS_MS);

    // The window opens and the pass runs on its own, with no kick.
    await advanceUntil(rig, () => rig.flexCalls.length > callsAfterDiscovery, PASS_MS * 2);
    expect(rig.flexCalls.length).toBeGreaterThan(callsAfterDiscovery);
    expect(rig.sweep.lastPassStartedAtMs() - discoveryStartedAt).toBeGreaterThanOrEqual(PASS_MS);
  });

  it('lets a members-meta push decide linkage for the whole roster at no extra cost', async () => {
    const rig = buildRig();
    expect(rig.sweep.size()).toBe(0);
    // The hourly full resync's shape: every member is pushed, and the server
    // reports the accepted ids it could not apply because they have no link row.
    const unlinkedRoster = rig.roster.filter((id) => !rig.accounts.has(id));
    expect(unlinkedRoster.length).toBe(ROSTER_SIZE - LINKED_SIZE);
    await rig.pushRosterMeta(unlinkedRoster);

    // The sweep now knows exactly who is linked, without a single flex-batch
    // request of its own.
    expect(rig.flexCalls).toEqual([]);
    expect(rig.sweep.size()).toBe(LINKED_SIZE);
    expect([...rig.sweep.linkedIds()].sort()).toEqual([...rig.linked].sort());
    // L14: an unapplied member stays CACHED as pushed. Leaving them dirty would
    // re-push most of the guild on every sweep, which is the load D5 removed.
    expect(rig.lastPushedMeta.size).toBe(ROSTER_SIZE);
    expect(rig.lastPushedMeta.has(unlinkedRoster[0])).toBe(true);
    // Instead they are remembered as having no row, so the cached record is
    // dropped the moment they are seen linked and their meta re-pushed.
    expect(rig.sweep.hasNoLinkRow(unlinkedRoster[0])).toBe(true);
    expect(rig.sweep.hasNoLinkRow(rig.linked[0])).toBe(false);
  });

  it('infers no linkage at all from a response that omits the unapplied field', async () => {
    const rig = buildRig();
    // A server that predates the field answers { updated } alone. Reading that
    // as "none were unapplied" would add all 5000 guild members to the sweep in
    // one call, and every pass after it would ask flex-batch about the roster.
    await rig.pushRosterMeta('omit');
    expect(rig.metaPushes.length).toBe(ROSTER_SIZE);
    expect(rig.sweep.size()).toBe(0);
    expect(rig.sweep.dirtyIds()).toEqual([]);
  });

  it('serves a freshly linked member ahead of the pass, without waiting a window', async () => {
    const rig = buildRig();
    await completeSeed(rig);
    const callsBefore = rig.flexCalls.length;

    // A member links mid-window. The feed carries the transition; the flex data
    // arrives through the sweep, which is the contract that keeps a repoint from
    // flairing the wrong id.
    const joiner = rig.roster[3]; // not in the linked fixture
    expect(rig.sweep.has(joiner)).toBe(false);
    rig.accounts.set(joiner, {
      level: 42,
      className: 'druid',
      statusTier: 4,
      username: 'Newlylinked',
    });
    rig.sweep.applyLinkChangeItems([{ discordUserId: joiner, kinds: ['link'] }], () => true);
    await kickAndSettle(rig);

    // One request, for exactly that member, well inside the pass window.
    expect(rig.flexCalls.length).toBe(callsBefore + 1);
    expect(rig.flexCalls[callsBefore].ids).toEqual([joiner]);
    expect(rig.writes.filter((w) => w.userId === joiner).length).toBe(2);
    expect(rig.caches.memberNicks.get(joiner)).toBe(buildLevelNick('Newlylinked', 42, 'druid'));
  });
});
