// A source guard over bot/main.ts, which no behavior test can reach.
//
// `main.ts` calls `main()` at module scope, so importing it would boot the whole
// bot: real env, real Discord REST, a real WebSocket. Ledger item L8 records that,
// and Phase 3 acted on it by extracting everything testable into `logic.ts`,
// `member_writes.ts` and `scheduler.ts`. What is LEFT in main.ts is wiring, and
// wiring is exactly what a unit test cannot see: which cache, which config field
// and which task name each call site actually passes.
//
// So this file guards the two claims that are otherwise enforced by nothing but a
// sentence in bot/CLAUDE.md:
//   1. there is no bare `setInterval` in main.ts, which is the whole point of the
//      phase (a repeating timer fires whether or not the previous run finished, so
//      sweeps stack into a storm);
//   2. every loop is registered on the scheduler and reads its cadence from the
//      D13 config field, not from a hard-coded constant. Wiring that passed
//      ROLE_SYNC_INTERVAL_MS instead of cfg.roleSyncIntervalMs would leave the
//      operator's incident lever silently inert, and every other test green.
//
// It is a SOURCE pin, which this repo is otherwise wary of, and the wariness is
// about pinning VALUES that a real assertion could reach instead (see R6, and L8's
// "do not add a source-text pin" about the cadence constants, which are pinned
// through bot/cadence.ts as real values elsewhere). This pins STRUCTURE that has no
// other reader. Comments are stripped first, so a mention of setInterval in prose
// cannot red it, and every count carries a vacuity floor so a file that stopped
// matching for an unrelated reason fails rather than passing over nothing.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HEARTBEAT_INTERVAL_MS,
  OUTBOX_IDLE_MS,
  OUTBOX_POLL_MS,
  PRESENCE_DEBOUNCE_MS,
  ROLE_SYNC_INTERVAL_MS,
  SWEEP_SLICE_MS,
} from '../bot/cadence';

/** main.ts with block and line comments removed. */
function mainSource(): string {
  return readFileSync(new URL('../bot/main.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The extracted sweep cycle, comment-stripped the same way. */
function sweepCycleSource(): string {
  return readFileSync(new URL('../bot/sweep_cycle.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Every scheduler task main.ts registers, the config field it must read, and the
 * sweep it must actually run.
 *
 * The `run` column is not decoration. Without it the per-task pattern stops at
 * the cadence, so swapping the BODIES of two registrations that share an interval
 * (tier-roles and special-roles-and-meta both read roleSyncIntervalMs) leaves
 * every assertion in this file green while the wrong sweep runs on each tick.
 */
const TASKS: readonly { name: string; field: string; idle?: string; run: string }[] = [
  { name: 'presence-push', field: 'presenceDebounceMs', run: 'pushPresence' },
  // The sweep's ACTIVE cadence is the slice interval, not the pass interval: the
  // pass interval is its idleMs, and a registration reading roleSyncIntervalMs
  // as activeMs would collapse one paced pass back into a burst every 5 minutes.
  //
  // The `idle` column is load bearing (Phase 6 QA): the registration span
  // otherwise accepts anything short of the next scheduler.add, so DELETING an
  // idleMs left every assertion green while the sweep woke every 3 seconds
  // between passes forever, the storm shape this packet exists to remove.
  { name: 'role-sync', field: 'sweepSliceMs', idle: 'roleSyncIntervalMs', run: 'runSweepSlice' },
  { name: 'tier-roles', field: 'roleSyncIntervalMs', run: 'refreshTierRoles' },
  // The three separate 3 s pollers (relay, activity, daily-rewards-winners) are
  // one task now. Its run is the tested consumer, which owns the breaker gate,
  // the per-stream fan-out and the announce-then-mark ordering. Its idle bound
  // is the D1 decay ceiling; without the column, dropping it pins the poll at
  // the active cadence with cfg.outboxIdleMs left as dead config.
  { name: 'outbox', field: 'outboxPollMs', idle: 'outboxIdleMs', run: 'runOutboxPoll' },
  // The paired task calls the tested helper, which is what receives the refresh
  // and the push; the case below pins which two it is handed.
  { name: 'special-roles-and-meta', field: 'roleSyncIntervalMs', run: 'refreshThenPushMeta' },
  // The liveness stamp (D15). It belongs on the scheduler rather than on a timer
  // of its own because that is what makes it evidence: the file's mtime advances
  // only while the process, event loop, and scheduler machinery are alive (a
  // single sibling task wedged on a never-settling run keeps stamping; the IO
  // deadlines are the defense there, see the main.ts comment). Registered here
  // like every other loop, so it is covered by the exact-count assertion too.
  { name: 'heartbeat-file', field: 'heartbeatIntervalMs', run: 'writeHeartbeatFile' },
];

/**
 * Every event-driven kick, and exactly how many times it appears.
 *
 * These are the coalescing rule's ONLY production triggers: the whole reason the
 * scheduler collapses a reconnect burst into one follow-up is that GUILD_CREATE
 * arrives once per re-IDENTIFY. Reverting any of them to the fire-and-forget
 * sweep call it replaced restores the storm and moves no other assertion.
 */
const KICKS = [
  { call: 'presenceTask.kick()', times: 1 },
  // Three: GUILD_CREATE, the completed roster seed, and the outbox link-change
  // feed. The last one is what makes a member whose game-side state just moved
  // sync within one tick instead of at the next pass window.
  { call: 'roleSyncTask.kick()', times: 3 },
  { call: 'memberMetaTask.kick()', times: 2 },
] as const;

describe('bot/main.ts loop wiring', () => {
  it('contains no bare repeating timer', () => {
    const source = mainSource();
    // The vacuity floor: if this file ever stopped resembling main.ts (a rename, a
    // failed read, a comment stripper that ate everything) the assertion below
    // would pass over an empty string and say nothing at all.
    expect(source.length).toBeGreaterThan(5000);
    expect(source).toContain('scheduler.add(');

    expect(source).not.toContain('setInterval');
    // setTimeout too: a hand-rolled chain would re-introduce the debounce and the
    // poll loops beside the scheduler, which is the state this phase removed.
    expect(source).not.toContain('setTimeout');
  });

  it('registers every loop on the scheduler, reading its D13 config field', () => {
    const source = mainSource();
    // Exactly the six, not "at least": a seventh registration is a loop nobody
    // has reviewed, and a missing one is a loop that silently stopped running.
    expect((source.match(/scheduler\.add\(/g) ?? []).length).toBe(TASKS.length);
    expect(TASKS.length).toBe(6);

    for (const task of TASKS) {
      // The name, its cadence AND its sweep must appear in ONE registration, so a
      // task reading another task's interval, or running another task's sweep,
      // cannot pass by having the strings somewhere in the file.
      // The spans REFUSE to cross into another registration: without the negative
      // lookahead, a body swap between two same-cadence tasks is caught by only
      // one of the two patterns, because the other one simply runs on into its
      // neighbour and finds the sweep there.
      const within = '((?!scheduler\\.add\\()[\\s\\S])';
      // A task with an `idle` column must spell BOTH bounds inside the one
      // cadence object; one without must spell activeMs alone (a stray idleMs
      // on a task that never earned one would be an unreviewed cadence change).
      const cadence = task.idle
        ? `cadence: \\{ activeMs: cfg\\.${task.field}, idleMs: cfg\\.${task.idle} \\}`
        : `cadence: \\{ activeMs: cfg\\.${task.field} \\}`;
      const pattern = new RegExp(
        `name: '${task.name}'${within}{0,240}?${cadence}${within}{0,900}?${task.run}\\(`,
      );
      expect(source).toMatch(pattern);
    }
  });

  it('keeps ONE slice-decision site, inside the extracted cycle', () => {
    // The nextSlice call and its three arguments live in bot/sweep_cycle.ts
    // now, where the composed D18 suite drives them (the Phase 6 QA source pin
    // on the inline call retired with the extraction; the knob wiring is pinned
    // on the factory binding above). What remains for a source pin is the slice
    // protocol's one-consumer assumption: main.ts must not keep, or regrow, a
    // second decision site beside the binding.
    const source = mainSource();
    expect(source).not.toContain('.nextSlice(');
    const cycle = sweepCycleSource();
    expect(cycle).toContain(
      'deps.linkedSweep.nextSlice(deps.now(), deps.sliceSize, deps.passIntervalMs)',
    );
    expect((cycle.match(/\.nextSlice\(/g) ?? []).length).toBe(1);
  });

  it('kicks every task the events are supposed to kick, exactly as often', () => {
    // Found by the Phase 3 QA audit: nothing anywhere pinned the kicks. Deleting
    // the two GUILD_CREATE kicks, or the one on the final member-backfill chunk,
    // left the entire suite green while the reconnect path stopped re-syncing
    // altogether. main() runs at module scope, so a source pin is the only thing
    // available, and it is the same idiom the registrations above use.
    const source = mainSource();
    expect(source.length).toBeGreaterThan(5000);
    for (const kick of KICKS) {
      const found = (source.match(new RegExp(kick.call.replace(/[.()]/g, '\\$&'), 'g')) ?? [])
        .length;
      expect({ call: kick.call, found }).toEqual({ call: kick.call, found: kick.times });
    }
    // A kick added for a NEW task passes every per-name count above, so the TOTAL
    // is pinned too, the way the registration count is.
    expect((source.match(/\.kick\(\)/g) ?? []).length).toBe(KICKS.reduce((n, k) => n + k.times, 0));
    // And they sit on the events that matter, not merely somewhere in the file.
    expect(source).toMatch(
      /case 'GUILD_CREATE'[\s\S]{0,4000}?roleSyncTask\.kick\(\)[\s\S]{0,80}?memberMetaTask\.kick\(\)/,
    );
    // The GUILD_CREATE kick is preceded by a requestPass, IMMEDIATELY: a kick
    // alone only wakes the task early, and it would then find the pass window
    // still open and hand back no work at all, which is exactly backwards on the
    // one event that means the bot's view of the guild may be stale.
    expect(source).toMatch(/linkedSweep\.requestPass\(\);\s*roleSyncTask\.kick\(\)/);
    // The backfill kick must sit INSIDE the final-chunk guard, not merely near
    // chunk_index: without the guard it fires once per chunk, which on a large
    // guild is a sweep per chunk during exactly the reconnect this coalesces.
    expect(source).toMatch(
      /idx >= count - 1[\s\S]{0,200}?memberMetaTask\.kick\(\)[\s\S]{0,160}?completeSeed\(/,
    );
  });

  it('wires the outbox poll to the breaker, the deadline and the sweep', () => {
    // The four bindings the consolidated poll cannot work without, none of them
    // reachable from a test: bot/outbox_consumer.ts owns every decision, and
    // what main.ts hands it is exactly what nothing else can say.
    const source = mainSource();

    // The breaker state is read through a THUNK, not captured at wiring time: a
    // captured value would freeze the gate at whatever the breaker was during
    // boot, which is 'closed', and the gate would never fire again.
    expect(source).toMatch(/breakerState: \(\) => governor\.snapshot\(\)\.breakerState/);
    // The poll runs on its OWN much longer deadline. Dropping the argument falls
    // back to the client default, which happens to be the same number today, so
    // the D13 knob would go silently inert with every other assertion green.
    expect(source).toMatch(/drain: \(\) => server\.drainOutbox\(cfg\.outboxTimeoutMs\)/);
    // The link-change fan-out, in order: the roster gate on every addition, then
    // the cached-record eviction for the ids whose link row is new. Losing the
    // eviction suppresses their join date and staff flair until the hourly
    // resync, and losing the roster gate puts a non-member permanently in the
    // pass where no removal path can reach them.
    expect(source).toMatch(
      /linkedSweep\.applyLinkChangeItems\(items, \(id\) => memberRoles\.has\(id\)\)[\s\S]{0,400}?for \(const id of summary\.metaStale\) lastPushedMeta\.delete\(id\)/,
    );
    // And the kick is CONDITIONAL on the feed having moved something. Kicking
    // unconditionally would wake the sweep on every poll, which at the outbox
    // cadence is a slice every 3 seconds forever.
    expect(source).toMatch(
      /summary\.added\.length \|\| summary\.removed\.length \|\| summary\.dirtied\.length[\s\S]{0,60}?roleSyncTask\.kick\(\)/,
    );
    // The three pollers it replaces are GONE, not merely unregistered: a
    // surviving helper is a second consumer of queues that only one client may
    // drain, and the drain is destructive.
    for (const dead of ['pollRelay', 'pollActivity', 'pollDailyRewardWinners']) {
      expect(source).not.toContain(dead);
    }
  });

  it('publishes a successful rename immediately, and re-syncs the diff cache', () => {
    // Two behaviors with no reachable test, both load bearing.
    //
    // The rename push compensates for echo suppression: without it the in-world
    // nameplate keeps the old level for up to a whole role-sync interval, because
    // the GUILD_MEMBER_UPDATE that used to carry it within seconds is now dropped
    // as the bot's own echo.
    //
    // The resync bounds how long the members-meta diff cache may keep believing
    // the server still holds what the bot last pushed. Deleting it re-opens the
    // permanent divergence that dueForFullResync's header enumerates.
    // The rename-then-push ordering lives in the extracted cycle now; the pin
    // moves with it (deps.pushMemberMeta is main's diff-guarded push, per the
    // binding test above).
    expect(sweepCycleSource()).toMatch(/outcome === 'written'[\s\S]{0,80}?deps\.pushMemberMeta\(/);
    // The WHOLE assignment, not just the two tokens near each other. An earlier
    // version pinned `dueForFullResync(...) ... lastPushedMeta.clear()`, which
    // matched with the predicate negated and with the restamp deleted; dropping
    // the restamp turns every later sweep into a full re-push, which is precisely
    // the load D5 removed.
    expect(mainSource()).toMatch(
      /lastFullMetaResyncMs = fullResyncIfDue\(lastFullMetaResyncMs, Date\.now\(\), lastPushedMeta\)/,
    );
  });

  it('delegates the refresh-then-push pair to the tested helper', () => {
    // Deliberately NOT a pin on a try/catch here. A catch that RETHROWS is
    // textually identical to one that swallows, so the source pin that used to
    // stand here passed for the exact regression it was written to catch. The
    // behavior lives in refreshThenPushMeta, where a test drives a throwing
    // refresh and asserts the push still ran; all this has to say is that main.ts
    // routes through it and in the right order.
    const source = mainSource();
    expect(source).toMatch(
      /refreshThenPushMeta\(\{\s*refresh: refreshSpecialRoles,\s*push: pushAllMemberMeta,/,
    );
    // And no hand-rolled copy of the pair survives beside it.
    expect(source).not.toMatch(/try \{\s*await refreshSpecialRoles\(\)/);
  });

  it('routes the two remaining unreachable decisions through their tested helpers', () => {
    // Both are new behavior inside main(), which no test can enter. Each is a call
    // to a helper that IS tested, so the pin only has to say the call site exists
    // and passes the right state.
    const source = mainSource();
    // The departed-member clear reads its result through the one predicate that
    // has the tests, rather than re-spelling `=== null || === undefined` inline.
    expect(source).toMatch(
      /pushMembersMeta\(\[clearedMemberMeta\(userId\)\]\)[\s\S]{0,200}?pushRejected\(result\)/,
    );
    // The daily-engagement dedupe, whose day-rollover clear is what keeps the set
    // from growing for the life of the process.
    expect(source).toMatch(/claimDailyActive\(dailyActive, day, userId\)/);
    // The echo record is consumed, so one PATCH suppresses only its own one echo.
    expect(source).toMatch(
      /decision\.forgetWrittenNick[\s\S]{0,60}?lastWrittenNick\.delete\(userId\)/,
    );
  });

  it('reads every cadence from cfg, never from the bot/cadence.ts constants', () => {
    // The D13 lever, end to end. bot/config.ts is proven to FILL these fields by
    // tests/discord_bot_config.test.ts; this is the other half, that main.ts
    // actually reads them. Importing the constant here and hard-coding it into a
    // task would type-check and would silently ignore the env override.
    const source = mainSource();
    for (const name of [
      'ROLE_SYNC_INTERVAL_MS',
      'PRESENCE_DEBOUNCE_MS',
      'OUTBOX_POLL_MS',
      'OUTBOX_IDLE_MS',
      'SWEEP_SLICE_MS',
      'HEARTBEAT_INTERVAL_MS',
    ]) {
      expect(source).not.toContain(name);
    }
    // Nor as a bare number, which is the other way to bypass the knob and the
    // one an import scan cannot see. Word-bounded on BOTH sides, never a
    // substring scan: `not.toContain('3000')` also fires on 13000 and 300000, so
    // the day main.ts gains an unrelated literal this would go red for a number
    // that is not a copy of anything.
    for (const value of ['300_?000', '4_?000', '3_?000', '15_?000', '30_?000']) {
      expect(source).not.toMatch(new RegExp(`(?<![0-9_])${value}(?![0-9_])`));
    }
    // And the constants still hold the values the config falls back to, so this
    // file's claim about "the same cadences as before" is anchored to numbers.
    expect(ROLE_SYNC_INTERVAL_MS).toBe(300000);
    expect(PRESENCE_DEBOUNCE_MS).toBe(4000);
    expect(OUTBOX_POLL_MS).toBe(3000);
    expect(OUTBOX_IDLE_MS).toBe(15000);
    expect(SWEEP_SLICE_MS).toBe(3000);
    expect(HEARTBEAT_INTERVAL_MS).toBe(30000);
  });

  it('writes the heartbeat file to the CONFIGURED path, not a literal of its own', () => {
    // The other half of the D15 knob. The cadence is covered by the registration
    // pattern above; the PATH is a second field on the same task and nothing else
    // reads it, so an inlined '/tmp/discord-bot-heartbeat' here would type-check,
    // would pass every other assertion in this file, and would leave
    // DISCORD_HEARTBEAT_FILE silently inert for a deployment that moved it.
    const source = mainSource();
    expect(source).toContain('writeHeartbeatFile(cfg.heartbeatFile)');
    expect(source).not.toContain('/tmp/');
    expect(source).not.toContain('DEFAULT_HEARTBEAT_FILE');
  });

  it('binds the sweep cycle to the production seams, config-complete', () => {
    // The loop bodies themselves live in bot/sweep_cycle.ts, where the D18
    // composed suite drives them directly (the Phase 6 QA text pins on the old
    // inline bodies retired with the extraction). What only this file can say
    // is the BINDING: which live maps, which config knobs, and which shell
    // calls main.ts hands the factory. A binding that inlined a literal, swapped
    // a knob, or dropped the guild id from a Discord write would type-check and
    // pass every behavioral suite, because the rig binds its own fakes.
    // Sliced to the factory call, per the clause-anchor rule.
    const source = mainSource();
    const start = source.indexOf('createSweepCycle({');
    const end = source.indexOf('});', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    // The three D13 knobs, each from its own cfg field, plus the opt-out, plus
    // the production clock (forwarding form, so it reads the global per call).
    expect(body).toContain('sliceSize: cfg.sweepSliceSize');
    expect(body).toContain('passIntervalMs: cfg.roleSyncIntervalMs');
    expect(body).toContain('syncNicknames: cfg.syncNicknames');
    expect(body).toContain('now: () => Date.now()');
    // The guild id rides HERE, bound into each Discord write, so the cycle
    // never sees config; a dropped or transposed argument aims writes at the
    // wrong guild path and 404s silently through the drain helpers.
    expect(body).toContain(
      'addMemberRole: (userId, roleId) => discord.addMemberRole(cfg.guildId, userId, roleId)',
    );
    expect(body).toContain(
      'removeMemberRole: (userId, roleId) => discord.removeMemberRole(cfg.guildId, userId, roleId)',
    );
    expect(body).toContain(
      'setNickname: (userId, nick) => discord.setNickname(cfg.guildId, userId, nick)',
    );
    // The live guild-state references and the two server seams, by name.
    for (const seam of [
      'linkedSweep,',
      'tierRoleIds,',
      'memberRoles,',
      'nickCaches,',
      'lastPushedMeta,',
    ]) {
      expect(body).toContain(seam);
    }
    expect(body).toContain('flexBatch: (ids) => server.flexBatch(ids)');
    expect(body).toContain('pushMemberMeta: (userId) => pushMemberMeta(userId)');
    // And the registration runs the factory's slice, on the role-sync task
    // (the task table above pins the cadence fields).
    expect(source).toContain('const { runSweepSlice } = createSweepCycle({');
  });

  it('routes every Discord and game-server call through the shells: no bare fetch', () => {
    // The production half of the governed-entry-point claim: the sweep-cycle
    // rig can only prove its own wiring routes through the gate, so what pins
    // bot/main.ts is that it has no way to reach the network except DiscordApi
    // and ServerClient, both of which the governor and call() own.
    const source = mainSource();
    expect(source).not.toMatch(/[^.\w]fetch\s*\(/);
    // The class above deliberately excludes dotted access, so ban the one
    // dotted spelling that is still a bare network path in Node.
    expect(source).not.toContain('globalThis.fetch');
    expect(source).not.toContain('fetchImpl');
  });

  it('starts the tasks BEFORE the gateway connects', () => {
    // A kick on a task that has not started is dropped by design, and the first
    // GUILD_CREATE arrives through a dispatch handler that kicks two of them.
    const source = mainSource();
    const startAll = source.indexOf('scheduler.startAll()');
    const connect = source.indexOf('gateway.connect(');
    expect(startAll).toBeGreaterThan(-1);
    expect(connect).toBeGreaterThan(-1);
    expect(startAll).toBeLessThan(connect);
  });

  it('forgets a member on BOTH paths that clear their stored flair', () => {
    // Found by mutation, round four: deleting either call site survived the whole
    // suite. forgetMember itself is well covered, and what nothing could say was
    // that main.ts still calls it, because main.ts runs main() at module scope
    // and no test can reach inside.
    //
    // A source-text pin is the fallback the loop wiring above already uses for
    // exactly that reason. It is weaker than a behavioral assertion and it is
    // the strongest thing available here: leaving a departed member's last-pushed
    // record behind means a REJOIN is diffed against their pre-departure state,
    // so the push that would restore their flair is suppressed and the game shows
    // them as cleared until the bot restarts. That is invisible in production.
    const source = mainSource();
    expect(source.length).toBeGreaterThan(5000);

    // GUILD_MEMBER_REMOVE: the member left the guild.
    expect(source).toMatch(
      /case 'GUILD_MEMBER_REMOVE'[\s\S]{0,1200}?forgetMember\(nickCaches, lastPushedMeta, userId\)/,
    );
    // And the sweep stops asking about them NOW (Phase 6 QA): departure does
    // not delete the link row, so without this the pass spends a slice slot
    // plus doomed 404 writes on them until the next complete seed. Sliced to
    // the case body so proximity cannot stand in for containment.
    {
      const start = source.indexOf("case 'GUILD_MEMBER_REMOVE'");
      const end = source.indexOf("case 'GUILD_MEMBERS_CHUNK'", start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      expect(source.slice(start, end)).toContain('linkedSweep.forget(userId);');
      expect((source.match(/linkedSweep\.forget\(/g) ?? []).length).toBe(1);
    }
    // The flaired-ids reconcile: the member left while the bot was offline, so
    // their stored flair is cleared by the roster sweep instead.
    expect(source).toMatch(
      /reconcileDepartedMembers[\s\S]{0,1200}?forgetMember\(nickCaches, lastPushedMeta, record\.discord_user_id\)/,
    );
    // The completed-seed eviction (L16): a member who left while the gateway was
    // down never fired GUILD_MEMBER_REMOVE, so the seed diff is the only thing
    // that ever drops them. Their per-member maps go, and the diff caches have
    // to go with them or a rejoin is compared against a pre-departure record.
    // The diff runs over the UNION of the per-member caches (Phase 6 QA): a
    // presence or voice event can seed onlineUsers or voiceStates with an id
    // that never got a member upsert, and a diff over memberRoles alone would
    // ghost it forever, so the union members are pinned here by name.
    expect(source).toMatch(
      /const cachedIds = new Set<string>\(\[[\s\S]{0,400}?memberRoles\.keys\(\)[\s\S]{0,400}?\.\.\.onlineUsers,[\s\S]{0,400}?voiceStates\.keys\(\)[\s\S]{0,400}?\]\)/,
    );
    expect(source).toMatch(
      /departedFromSeed\(cachedIds, seedSessionIds\)[\s\S]{0,400}?forgetMember\(nickCaches, lastPushedMeta, id\)/,
    );
    // Exactly three, so a fourth clearing path added without forgetting the
    // member (or one of these quietly dropped) fails here, not in production.
    expect((source.match(/forgetMember\(/g) ?? []).length).toBe(3);
  });

  it('keeps the presence push on the debounce mode, not a poll loop', () => {
    // The distinction is behavioral: a repeating task would push presence every
    // 4 seconds forever, where a debounce pushes only after an actual event.
    expect(mainSource()).toMatch(
      /name: 'presence-push',[\s\S]{0,120}?mode: 'debounce'[\s\S]{0,120}?cfg\.presenceDebounceMs/,
    );
  });

  it('rides the governor counters on the presence push, read through a thunk', () => {
    // The Phase 8 telemetry has no loop of its own: it exists only because the
    // presence body is wrapped here. Dropping the wrapper leaves every counters
    // test green (the module is pure and still passes its own suite) while the
    // bot ships nothing at all, which is precisely the class of wiring failure
    // this file exists for.
    const source = mainSource();
    expect(source.length).toBeGreaterThan(5000);
    // A THUNK, like the outbox breaker gate above and for the same reason: a
    // captured discord.counters() would freeze the boot-time snapshot, which is
    // all zeroes, and every push would report an idle governor forever.
    expect(source).toMatch(
      /server\.pushPresence\(\s*withPresenceCounters\(((?!\);)[\s\S]){0,600}?\(\) => discord\.counters\(\)/,
    );
    // One wrap site, so a second presence path cannot grow beside it unwrapped.
    expect((source.match(/withPresenceCounters\(/g) ?? []).length).toBe(1);
  });

  it('wires handleInteraction so a real command failure reaches the player', () => {
    // tests/discord_bot.test.ts only exercises interactionFailureFallback in
    // isolation (a pure function of a boolean). Nothing else pins that
    // handleInteraction actually catches a thrown error from the command
    // dispatch, flips `acknowledged` ONLY after deferInteraction resolves, and
    // routes the caught failure into the two fallback shapes the pure helper
    // describes. A future edit could delete the try/catch entirely, or move
    // `acknowledged = true` above the defer call, and every existing test
    // (including the unit tests on the pure helper) would stay green while
    // /whoami and /link silently hang again in Discord, which is the exact
    // regression this PR fixes.
    const source = mainSource();
    const start = source.indexOf('const handleInteraction =');
    const end = source.indexOf('\n  };', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);

    // The whole dispatch (both /link and the defer-then-/whoami path) sits
    // inside ONE try, so a throw anywhere in command handling is caught here
    // rather than propagating past handleInteraction uncaught (the caller only
    // logs, per the `.catch((e) => console.error(...))` at the call site, with
    // no player-facing fallback of its own).
    expect(body).toMatch(/try \{[\s\S]*\} catch \(e\) \{/);

    // `acknowledged` starts false and flips true ONLY once deferInteraction has
    // actually resolved, never earlier: setting it before the await, or beside
    // respondInteraction, would make the fallback claim an ack that never
    // landed and pick the wrong (edit) branch for a defer that itself threw.
    expect(body).toMatch(
      /let acknowledged = false;[\s\S]{0,400}?await discord\.deferInteraction\(/,
    );
    expect(body).toMatch(/await discord\.deferInteraction\([^)]*\);\s*acknowledged = true;/);
    // respondInteraction (the /link path) never sets it: /link returns right
    // after its one response, so a throw there must fall back to a fresh
    // respond, not an edit against a response that was never deferred.
    const respondIdx = body.indexOf('discord.respondInteraction(interactionId, token, {');
    const returnIdx = body.indexOf('return;', respondIdx);
    expect(respondIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(respondIdx);
    expect(body.slice(respondIdx, returnIdx)).not.toContain('acknowledged = true');

    // The catch block feeds the CURRENT `acknowledged` value into the pure
    // helper (not a literal, not the pre-catch snapshot re-derived some other
    // way), then dispatches on its `via` field to the matching Discord call:
    // 'respond' fires a fresh ephemeral response, 'edit' patches the already
    // deferred one. Swapping the two branches would type-check and pass the
    // pure helper's own tests while every real failure showed Discord's raw
    // error UI instead of the fallback text.
    const catchIdx = body.indexOf('} catch (e) {');
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBody = body.slice(catchIdx);
    expect(catchBody).toMatch(
      /const fallback = interactionFailureFallback\(acknowledged\);[\s\S]{0,200}?fallback\.via === 'respond'[\s\S]{0,200}?await discord\.respondInteraction\(interactionId, token, \{[\s\S]{0,120}?content: fallback\.content,[\s\S]{0,300}?\} else \{[\s\S]{0,200}?await discord\.editOriginalResponse\(cfg\.clientId, token, \{ content: fallback\.content \}\);/,
    );
    // The fallback's own failure is swallowed with a distinct log tag, not
    // rethrown: there is genuinely nothing left to fall back to, but a bare
    // swallow with the SAME message as the outer catch would be indistinguishable
    // in logs from the original failure.
    expect(catchBody).toMatch(
      /catch \(e2\) \{\s*console\.error\('\[bot\] interaction fallback failed', e2\);/,
    );
  });
});
