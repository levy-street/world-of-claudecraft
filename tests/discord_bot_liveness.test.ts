// The bot's liveness signal (D15): the file whose mtime tells the container
// healthcheck that the run loop is still turning, and the pure freshness rule the
// healthcheck applies to it.
//
// Three things need saying and each needs a different rig: the freshness decision
// is pure, so it is driven by value; the writer is an IO shell, so it is driven
// through its injected seam AND once through its production default against a real
// temp file; and the CADENCE is a property of the scheduler registration, so it is
// driven on the virtual clock from tests/helpers/synthetic_clock.ts rather than on
// vitest fake timers (a clock captured at construction does not move under those,
// so the whole file could pass for an implementation that read the wall clock).
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_INTERVAL_MS } from '../bot/cadence';
import {
  DEFAULT_HEARTBEAT_FILE,
  type HeartbeatIo,
  isHeartbeatFresh,
  writeHeartbeatFile,
} from '../bot/liveness';
import { LoopScheduler, type SchedulerTimerHandle, type SchedulerTimers } from '../bot/scheduler';
import { type SyntheticClock, syntheticClock } from './helpers/synthetic_clock';

/**
 * SchedulerTimers backed entirely by virtual time, the same shape the scheduler's
 * own suite uses. Its sleep ADVANCES now(), which the synthetic clock guarantees:
 * a hand-rolled rig whose sleep leaves now() alone starves the macrotask queue, so
 * a chained loop HANGS rather than failing and no test timeout ever fires.
 */
function clockTimers(clock: SyntheticClock): SchedulerTimers {
  let nextId = 1;
  const cancelled = new Set<number>();
  return {
    setTimeout(cb: () => void, ms: number): SchedulerTimerHandle {
      const id = nextId++;
      void clock.sleep(ms).then(() => {
        if (!cancelled.has(id)) cb();
      });
      return id;
    },
    clearTimeout(handle: SchedulerTimerHandle): void {
      cancelled.add(handle as number);
    },
  };
}

/** A recording heartbeat seam: every write, in order, with the time it claimed. */
function recordingIo(clock: SyntheticClock): {
  io: HeartbeatIo;
  writes: { path: string; contents: string }[];
} {
  const writes: { path: string; contents: string }[] = [];
  return {
    writes,
    io: {
      writeFile: async (path, contents) => {
        writes.push({ path, contents });
      },
      now: () => clock.now(),
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isHeartbeatFresh', () => {
  it('is fresh strictly UNDER the stale window and stale at it', () => {
    // Both sides of the boundary, which is what pins the comparison itself: an
    // off-by-a-window bug satisfies either side alone. The rule is `<`, so the
    // window instant is already stale; a healthcheck running on its own interval
    // must not have its verdict decided by which side of a millisecond it landed.
    expect(isHeartbeatFresh(0, 89_999, 90_000)).toBe(true);
    expect(isHeartbeatFresh(0, 90_000, 90_000)).toBe(false);
    expect(isHeartbeatFresh(0, 90_001, 90_000)).toBe(false);
  });

  it('reads a heartbeat written this instant as fresh', () => {
    // The zero-age case, which the boundary pair above cannot reach: an
    // implementation using `<=` on the age against zero would still pass there.
    expect(isHeartbeatFresh(5_000, 5_000, 90_000)).toBe(true);
  });

  it('treats a FUTURE mtime as fresh, never as stale', () => {
    // The safe direction for a clock that jumped (a container time sync, an NTP
    // step). An absolute-difference rule would read this as ancient and kill a bot
    // that is writing perfectly well; the subtraction goes negative instead.
    expect(isHeartbeatFresh(600_000, 1_000, 90_000)).toBe(true);
  });

  it('is stale for a heartbeat far older than the window', () => {
    // The case the healthcheck exists to catch: a bot whose scheduler stopped
    // turning hours ago still has the file, and only its age says so.
    expect(isHeartbeatFresh(0, 4 * 3_600_000, 90_000)).toBe(false);
  });
});

describe('writeHeartbeatFile', () => {
  it('writes the timestamp to the path it was given, and reports success', () => {
    const clock = syntheticClock(1_700_000_000_000);
    const { io, writes } = recordingIo(clock);

    return writeHeartbeatFile('/var/run/woc-bot', io).then((ok) => {
      expect(ok).toBe(true);
      // The exact path, not merely "a write happened": the healthcheck reads one
      // path, and a writer that stamped a different one would look healthy here
      // and report a permanently dead bot in production.
      expect(writes).toEqual([{ path: '/var/run/woc-bot', contents: '1700000000000\n' }]);
    });
  });

  it('takes its timestamp from the injected clock at CALL time', async () => {
    // The seam is forwarding rather than capturing, so a second call inside the
    // same process has to see time that moved. A captured `Date.now()` reads once.
    const clock = syntheticClock(1_000);
    const { io, writes } = recordingIo(clock);

    await writeHeartbeatFile(DEFAULT_HEARTBEAT_FILE, io);
    await clock.advanceBy(45_000);
    await writeHeartbeatFile(DEFAULT_HEARTBEAT_FILE, io);

    expect(writes.map((w) => w.contents)).toEqual(['1000\n', '46000\n']);
  });

  it('logs an unwritable path ONCE and resolves false rather than throwing', async () => {
    // The always-settle rule (bot/CLAUDE.md): this runs as a scheduler task, and
    // the next delay is armed only after the run settles. A writer that rejected
    // would still be caught by the task, but one that propagated a throw out of a
    // path with no catch would take the process down over a read-only mount.
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const io: HeartbeatIo = {
      writeFile: async () => {
        throw new Error('EACCES: permission denied');
      },
      now: () => 7,
    };

    const ok = await writeHeartbeatFile('/proc/nope/heartbeat', io);

    expect(ok).toBe(false);
    expect(errors.length).toBe(1);
    // The path is IN the message: an operator debugging an unhealthy container
    // needs to know which path failed, and the default is overridable.
    expect(errors[0][0]).toBe('[bot] heartbeat write to /proc/nope/heartbeat failed');
  });

  it('settles false on a SYNCHRONOUSLY throwing writer, not only a rejecting one', async () => {
    // The arm that distinguishes the landed `try { await io.writeFile } catch`
    // from an `io.writeFile(...).then(...).catch(...)` refactor: a promise-chain
    // catch never sees a sync throw, which would escape into the scheduler task
    // and become the unsettled-run hole the never-rejects contract exists to
    // close. The seam's type says Promise, but nothing stops an implementation
    // from throwing before it returns one.
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const io: HeartbeatIo = {
      writeFile: (() => {
        throw new Error('sync boom');
      }) as unknown as HeartbeatIo['writeFile'],
      now: () => 7,
    };

    const ok = await writeHeartbeatFile('/x/heartbeat', io);

    expect(ok).toBe(false);
    expect(errors.length).toBe(1);
    expect(errors[0][0]).toBe('[bot] heartbeat write to /x/heartbeat failed');
  });

  it('defaults to a real node:fs write, and produces a file the freshness rule accepts', async () => {
    // The DEFAULT-path arm the bot's injection convention requires of every shell.
    // Driven end to end on a real temp file, because the two halves of this module
    // only mean something together: the writer's job is to produce an mtime that
    // isHeartbeatFresh will accept, and nothing but a real filesystem has one.
    const dir = await mkdtemp(join(tmpdir(), 'woc-bot-heartbeat-'));
    const path = join(dir, 'heartbeat');
    const before = Date.now();
    try {
      expect(await writeHeartbeatFile(path)).toBe(true);

      const stats = await stat(path);
      expect(isHeartbeatFresh(stats.mtimeMs, Date.now(), 90_000)).toBe(true);
      // And the default clock is the real one: the stamped timestamp sits in the
      // window this test ran in, so a default of 0 (or a frozen constant) fails.
      const stamped = Number(await readFile(path, 'utf8'));
      expect(Number.isFinite(stamped)).toBe(true);
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(Date.now());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('points its default at a path the non-root runtime user can actually write', () => {
    // Pinned against the literal: the runtime image runs as USER node and chowns
    // only /app/dist/media, so anything outside /tmp needs a Dockerfile change and
    // would fail every write in production while every test here stayed green.
    expect(DEFAULT_HEARTBEAT_FILE).toBe('/tmp/discord-bot-heartbeat');
  });
});

describe('the heartbeat as a scheduler task', () => {
  it('re-stamps the file once per interval, at the interval', () => {
    // ABSOLUTE virtual times, not an ordering or a count: `>= 3` also passes for a
    // loop that fired everything in one tick, and the cadence is the entire claim.
    // The first run lands one interval in, because a repeating task ARMS on start
    // rather than running immediately.
    const clock = syntheticClock();
    const { io, writes } = recordingIo(clock);
    // random 0.5 is the CENTRE of the jitter band, so the delay is exactly the
    // interval and the assertion below can be an equality.
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
    scheduler.add({
      name: 'heartbeat-file',
      cadence: { activeMs: HEARTBEAT_INTERVAL_MS },
      run: () => writeHeartbeatFile('/tmp/heartbeat-under-test', io),
    });

    scheduler.startAll();
    return clock.advanceBy(3 * HEARTBEAT_INTERVAL_MS).then(() => {
      expect(writes.map((w) => Number(w.contents))).toEqual([30_000, 60_000, 90_000]);
      scheduler.stopAll();
    });
  });

  it('keeps the loop turning when every write fails', async () => {
    // The failure mode that would matter most: an unwritable path must degrade the
    // healthcheck, never the bot. A run that threw out of the task would still be
    // caught, but one that never settled would leave the task claimed with nothing
    // armed and this loop would stop for the life of the process.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const clock = syntheticClock();
    let attempts = 0;
    const io: HeartbeatIo = {
      writeFile: async () => {
        attempts++;
        throw new Error('EROFS: read-only file system');
      },
      now: () => clock.now(),
    };
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
    scheduler.add({
      name: 'heartbeat-file',
      cadence: { activeMs: HEARTBEAT_INTERVAL_MS },
      run: () => writeHeartbeatFile('/proc/nope/heartbeat', io),
    });

    scheduler.startAll();
    await clock.advanceBy(3 * HEARTBEAT_INTERVAL_MS);

    expect(attempts).toBe(3);
    scheduler.stopAll();
  });
});
