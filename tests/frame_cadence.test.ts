import { describe, expect, it, vi } from 'vitest';
import {
  createRefreshEstimator,
  noteRefreshDelta,
  type RefreshEstimatorState,
  resetRefreshEstimatorWindow,
} from '../src/game/display_refresh_estimator_core';
import type { FrameCadenceAutoRecord } from '../src/game/frame_cadence_auto_core';
import {
  ceilingDivisor,
  configureFrameCadence,
  createFrameCadence,
  frameCadenceShouldRender,
  MIN_CEILING_FPS,
} from '../src/game/frame_cadence_core';
import {
  armFrameAndSkip,
  type FrameCadenceGateView,
  type FrameCadenceSnapshot,
  FrameCadenceWiring,
  frameCadenceBeaconFieldsFrom,
  parseFrameCeilingIntent,
  resolveFrameRateChoice,
  sharedFrameCadence,
} from '../src/game/frame_cadence_wiring';

const INPUT_TICK_MS = 50;

function feed(state: RefreshEstimatorState, deltas: number[], repeat: number): void {
  for (let r = 0; r < repeat; r++) for (const d of deltas) noteRefreshDelta(state, d, false);
}

describe('display refresh estimator', () => {
  it.each([60, 75, 120, 144])('reads a held %i Hz display', (hz) => {
    const s = createRefreshEstimator();
    feed(s, [1000 / hz], 200);
    expect(s.verdict).toBe('paced');
    expect(1000 / s.refreshMs).toBeCloseTo(hz, 0);
  });

  it('reads 60 Hz from a machine that only ever lands on two and three slots', () => {
    const s = createRefreshEstimator();
    feed(s, [33.3, 33.3, 50, 33.3, 50], 60);
    expect(s.verdict).toBe('paced');
    expect(1000 / s.refreshMs).toBeCloseTo(60, 0);
  });

  it('reads 60 Hz through 1 ms timestamp coarsening', () => {
    const s = createRefreshEstimator();
    feed(s, [16, 17, 17], 100);
    expect(s.verdict).toBe('paced');
    expect(1000 / s.refreshMs).toBeCloseTo(60, 0);
  });

  it('follows a window dragged from a 60 Hz to a 144 Hz display', () => {
    const s = createRefreshEstimator();
    feed(s, [16.67], 200);
    feed(s, [6.94], 200);
    expect(1000 / s.refreshMs).toBeCloseTo(144, 0);
  });

  it('drops its window on a stall instead of learning from it', () => {
    const s = createRefreshEstimator();
    feed(s, [16.67], 200);
    noteRefreshDelta(s, 4000, false);
    expect(s.count).toBe(0);
    expect(s.verdict).toBe('paced');
    expect(1000 / s.refreshMs).toBeCloseTo(60, 0);
  });

  it('stays unknown on jittery deltas that sit on no lattice', () => {
    const s = createRefreshEstimator();
    const jitter = [2.6, 3.9, 3.1, 4.4, 2.9, 3.6, 5.2, 3.3];
    feed(s, jitter, 60);
    expect(s.verdict).toBe('unknown');
  });

  it('keeps a paced reading through one recompute with no lattice, and withdraws it after a run', () => {
    const s = createRefreshEstimator();
    feed(s, [16.67], 200);
    expect(s.verdict).toBe('paced');
    const jitter = [2.6, 3.9, 3.1, 4.4, 2.9, 3.6, 5.2, 3.3];
    const feedJitter = (count: number) => {
      for (let i = 0; i < count; i++) noteRefreshDelta(s, jitter[i % jitter.length], false);
    };
    // A fresh window (a resume) holds only the jitter: the first recompute comes
    // once it has enough samples, then one per recompute period.
    resetRefreshEstimatorWindow(s);
    feedJitter(45);
    expect(s.latticeMisses).toBe(1);
    expect(s.verdict).toBe('paced');
    expect(1000 / s.refreshMs).toBeCloseTo(60, 0);
    feedJitter(60);
    expect(s.latticeMisses).toBe(3);
    expect(s.verdict).toBe('paced');
    feedJitter(30);
    expect(s.verdict).toBe('unknown');
    expect(s.refreshMs).toBe(0);
  });

  it('reads a single cluster as a display only when it is as tight as a display clock', () => {
    const tight = createRefreshEstimator();
    feed(tight, [16.6, 16.7], 100);
    expect(tight.verdict).toBe('paced');
    expect(1000 / tight.refreshMs).toBeCloseTo(60, 0);
    // A steady frame cost on an uncapped loop clusters too, loosely.
    const loose = createRefreshEstimator();
    feed(loose, [19.6, 20.4, 21.3, 22.1, 20.0, 21.7, 19.9, 20.9], 25);
    expect(loose.verdict).toBe('unknown');
    expect(loose.refreshMs).toBe(0);
  });

  it('calls rAF uncapped only from idle callbacks answered faster than any display', () => {
    const s = createRefreshEstimator();
    feed(s, [5], 200);
    // A steady 5 ms cost looks like a 200 Hz display until a skip is answered at once.
    expect(s.verdict).toBe('paced');
    for (let i = 0; i < 6; i++) noteRefreshDelta(s, 0.4, true);
    expect(s.verdict).toBe('unpaced');
    // Busy deltas never take the verdict back; slow idle answers do.
    feed(s, [16.67], 50);
    expect(s.verdict).toBe('unpaced');
    noteRefreshDelta(s, 16.67, true);
    noteRefreshDelta(s, 16.67, true);
    expect(s.verdict).toBe('paced');
  });
});

describe('ceiling divisor', () => {
  it('pins the intent 30 table', () => {
    const rate = (hz: number) => hz / ceilingDivisor(hz, 30);
    expect(rate(60)).toBe(30);
    expect(rate(75)).toBe(37.5);
    expect(rate(90)).toBe(30);
    expect(rate(100)).toBeCloseTo(33.33, 1);
    expect(rate(120)).toBe(30);
    expect(rate(144)).toBe(36);
    expect(rate(165)).toBe(33);
    expect(rate(240)).toBeCloseTo(34.29, 1);
    expect(rate(360)).toBe(36);
    expect(rate(50)).toBe(25);
    expect(ceilingDivisor(30, 30)).toBe(1);
  });

  it('pins the intent 60 table', () => {
    const rate = (hz: number) => hz / ceilingDivisor(hz, 60);
    expect(ceilingDivisor(60, 60)).toBe(1);
    expect(ceilingDivisor(75, 60)).toBe(1);
    expect(ceilingDivisor(50, 60)).toBe(1);
    expect(rate(90)).toBe(45);
    expect(rate(100)).toBe(50);
    expect(rate(120)).toBe(60);
    expect(rate(144)).toBe(72);
    expect(rate(165)).toBe(55);
    expect(rate(240)).toBe(60);
    expect(rate(360)).toBe(72);
  });

  it('pins the floor rate: the chosen interval must stay under the 50 ms input tick', () => {
    expect(MIN_CEILING_FPS).toBe(24);
  });

  it('never paces a frame past one input tick', () => {
    for (let hz = 24; hz <= 500; hz++) {
      for (const intent of [30, 60]) {
        const divisor = ceilingDivisor(hz, intent);
        if (divisor === 1) continue;
        expect(hz / divisor).toBeGreaterThanOrEqual(24);
        expect((1000 / hz) * divisor).toBeLessThan(INPUT_TICK_MS);
      }
    }
  });
});

describe('frame cadence', () => {
  it('renders one 60 Hz slot out of two, with no drift and no misses', () => {
    const c = createFrameCadence();
    configureFrameCadence(c, 30, 'paced', 1000 / 60);
    let rendered = 0;
    for (let i = 1; i <= 600; i++) if (frameCadenceShouldRender(c, (i * 1000) / 60)) rendered++;
    expect(rendered).toBe(300);
    expect(c.missShare).toBe(0);
  });

  it('counts a missed slot and restarts the rhythm from the late frame', () => {
    const c = createFrameCadence();
    const slot = 1000 / 60;
    configureFrameCadence(c, 30, 'paced', slot);
    expect(frameCadenceShouldRender(c, 2 * slot)).toBe(true);
    expect(frameCadenceShouldRender(c, 4 * slot)).toBe(true);
    // The next frame lands three slots later (50 ms), then two slots after that.
    expect(frameCadenceShouldRender(c, 7 * slot)).toBe(true);
    expect(c.missShare).toBeGreaterThan(0);
    expect(frameCadenceShouldRender(c, 8 * slot)).toBe(false);
    expect(frameCadenceShouldRender(c, 9 * slot)).toBe(true);
  });

  it('is inert on a display already at the intent, and with no ceiling', () => {
    const c = createFrameCadence();
    configureFrameCadence(c, 30, 'paced', 1000 / 30);
    expect(c.targetIntervalMs).toBe(0);
    // An unread display is not inert: the ceiling falls back to a time limiter.
    configureFrameCadence(c, 30, 'unknown', 0);
    expect(c.targetIntervalMs).toBeCloseTo(33.33, 1);
    expect(c.paced).toBe(false);
    configureFrameCadence(c, 0, 'paced', 1000 / 144);
    expect(c.targetIntervalMs).toBe(0);
  });

  it('is a plain time limiter without vsync', () => {
    const c = createFrameCadence();
    configureFrameCadence(c, 30, 'unpaced', 0);
    expect(c.targetIntervalMs).toBeCloseTo(33.33, 1);
    let rendered = 0;
    for (let t = 1; t <= 10000; t += 0.5) if (frameCadenceShouldRender(c, t)) rendered++;
    expect(rendered).toBeGreaterThanOrEqual(299);
    expect(rendered).toBeLessThanOrEqual(301);
  });
});

// A tiny host: either a vsync display (callbacks on slots, a busy frame pushes
// the next callback to the first slot after its cost) or an uncapped rAF.
function runHost(opts: {
  refreshMs: number | null;
  costMs: number | ((nowMs: number) => number);
  /** Uncapped rAF only: how long an idle callback takes to come back. */
  idleMs?: number | (() => number);
  /** How late the host's timers fire (a coarse timer resolution). */
  timerLateMs?: number | ((nowMs: number) => number);
  seconds: number;
  intent: 0 | 30 | 60 | 'auto';
  governorShedding?: () => boolean;
  governorAtBaseline?: () => boolean;
  inCombat?: (nowMs: number) => boolean;
  surfacePixels?: (nowMs: number) => number;
  settingsSignature?: (nowMs: number) => string;
  remembered?: 0 | 30 | 60 | FrameCadenceAutoRecord | null;
  /** Runs once after `intent` is applied: a later choice made on the same wiring. */
  configure?: (wiring: FrameCadenceWiring) => void;
  onFrame?: (nowMs: number, wiring: FrameCadenceWiring) => void;
  gate?: Partial<FrameCadenceGateView>;
  cover?: (nowMs: number) => boolean;
}) {
  let now = 0;
  const host: { pending: { at: number; timer: boolean } | null; timerCb: (() => void) | null } = {
    pending: null,
    timerCb: null,
  };
  let arms = 0;
  let timerArms = 0;
  let maxArmsPerCallback = 0;
  const renderedAt: number[] = [];
  const published = { target: -1, share: -1, hold: false };
  const saved: FrameCadenceAutoRecord[] = [];
  let clears = 0;
  let remembered: FrameCadenceAutoRecord | null =
    typeof opts.remembered === 'number'
      ? { ceiling: opts.remembered, confirmed: true, failStreak: 0 }
      : (opts.remembered ?? null);
  const intentLog: Array<{ at: number; intent: number }> = [];
  let callbacks = 0;
  let loads = 0;
  const nextFrameAt = (from: number) =>
    opts.refreshMs === null
      ? from + (typeof opts.idleMs === 'function' ? opts.idleMs() : (opts.idleMs ?? 0.3))
      : (Math.floor(from / opts.refreshMs + 1e-9) + 1) * opts.refreshMs;
  const wiring = new FrameCadenceWiring({
    requestFrame: () => {
      arms++;
      host.pending = { at: nextFrameAt(now), timer: false };
    },
    setTimer: (cb, ms) => {
      arms++;
      timerArms++;
      const late =
        typeof opts.timerLateMs === 'function' ? opts.timerLateMs(now) : opts.timerLateMs;
      host.pending = { at: now + ms + (late ?? 0), timer: true };
      host.timerCb = cb;
    },
    now: () => now,
    coverActive: () => opts.cover?.(now) ?? false,
    publish: (target, share, hold) => {
      published.target = target;
      published.share = share;
      published.hold = hold;
    },
    governorShedding: opts.governorShedding ?? (() => false),
    governorAtBaseline: opts.governorAtBaseline ?? (() => false),
    inCombat: () => opts.inCombat?.(now) ?? false,
    surfacePixels: () => opts.surfacePixels?.(now) ?? 1920 * 1080,
    autoMemory: {
      load: () => {
        loads++;
        return remembered;
      },
      save: (_hz, record) => saved.push({ ...record }),
      clear: () => {
        clears++;
        remembered = null;
      },
      settingsSignature: () => opts.settingsSignature?.(now) ?? 'same',
    },
  });
  if (opts.intent === 'auto') wiring.setAuto();
  else wiring.setIntent(opts.intent);
  opts.configure?.(wiring);
  const gate: FrameCadenceGateView = {
    hidden: false,
    desktopApp: false,
    graphicsRebuildPaused: false,
    worldDrawHeld: false,
    ...opts.gate,
  };
  const frame = (t: number): void => {
    callbacks++;
    const before = arms;
    const skip = wiring.armAndSkip(frame, t, gate);
    maxArmsPerCallback = Math.max(maxArmsPerCallback, arms - before);
    if (skip) return;
    renderedAt.push(t);
    opts.onFrame?.(t, wiring);
    const intentNow = wiring.snapshot().intent;
    if (intentLog.length === 0 || intentLog[intentLog.length - 1].intent !== intentNow) {
      intentLog.push({ at: t, intent: intentNow });
    }
    now = t + (typeof opts.costMs === 'function' ? opts.costMs(t) : opts.costMs);
    if (host.pending && !host.pending.timer) host.pending = { at: nextFrameAt(now), timer: false };
  };
  host.pending = { at: nextFrameAt(0), timer: false };
  while (now < opts.seconds * 1000) {
    const due = host.pending;
    if (!due) throw new Error('the frame chain died: a callback armed nothing');
    now = Math.max(now, due.at);
    host.pending = null;
    if (due.timer) host.timerCb?.();
    else frame(now);
  }
  const tail = renderedAt.filter((t) => t > (opts.seconds - 5) * 1000);
  const intervals = tail.slice(1).map((t, i) => t - tail[i]);
  return {
    wiring,
    callbacks,
    intervals,
    renderedAt,
    timerArms,
    maxArmsPerCallback,
    published,
    saved,
    clears,
    intentLog,
    loads,
  };
}

// An uncapped rAF hidden behind a busy GPU, under a ceiling of 30: jittered
// frame costs, and idle callbacks answered slowly and unevenly.
function busyGpuHost(): Parameters<typeof runHost>[0] {
  let n = 0;
  let idle = 1;
  const costs = [18.6, 23.9, 21.1, 26.4, 19.9, 22.6, 27.2, 20.3];
  return {
    refreshMs: null,
    idleMs: () => {
      idle = (idle * 7 + 3) % 11;
      return 3 + (idle / 11) * 4;
    },
    costMs: () => costs[n++ % costs.length],
    seconds: 60,
    intent: 30,
  };
}

describe('frame cadence wiring', () => {
  it('parses the dev URL intent', () => {
    expect(parseFrameCeilingIntent('')).toBeNull();
    expect(parseFrameCeilingIntent('?fpscap=30')).toBe(30);
    expect(parseFrameCeilingIntent('?fpscap=60')).toBe(60);
    expect(parseFrameCeilingIntent('?fpscap=display')).toBe(0);
    // Junk is no override: the stored choice and its settings listener stay.
    expect(parseFrameCeilingIntent('?fpscap=')).toBeNull();
    expect(parseFrameCeilingIntent('?fpscap=45')).toBeNull();
    expect(parseFrameCeilingIntent('?fpscap=auto')).toBeNull();
  });

  it('resolves the stored choice, and lets the URL override win over any of them', () => {
    const stored = (value: number) => resolveFrameRateChoice(value, '');
    expect(stored(0)).toEqual({ auto: true, intent: 0, fromUrl: false });
    expect(stored(1)).toEqual({ auto: false, intent: 0, fromUrl: false });
    expect(stored(2)).toEqual({ auto: false, intent: 60, fromUrl: false });
    expect(stored(3)).toEqual({ auto: false, intent: 30, fromUrl: false });
    for (const value of [0, 1, 2, 3]) {
      expect(resolveFrameRateChoice(value, '?fpscap=30')).toEqual({
        auto: false,
        intent: 30,
        fromUrl: true,
      });
      expect(resolveFrameRateChoice(value, '?fpscap=60')).toEqual({
        auto: false,
        intent: 60,
        fromUrl: true,
      });
      expect(resolveFrameRateChoice(value, '?fpscap=display')).toEqual({
        auto: false,
        intent: 0,
        fromUrl: true,
      });
    }
  });

  it('holds a steady two-slot rhythm on a 60 Hz display', () => {
    const r = runHost({ refreshMs: 1000 / 60, costMs: 12, seconds: 20, intent: 30 });
    expect(r.wiring.snapshot().divisor).toBe(2);
    expect(r.published.target).toBeCloseTo(33.33, 1);
    expect(r.published.share).toBe(0);
    for (const i of r.intervals) expect(i).toBeCloseTo(33.33, 1);
    expect(r.maxArmsPerCallback).toBe(1);
  });

  it('steadies a machine that misses the 60 Hz slot into two slots', () => {
    const r = runHost({ refreshMs: 1000 / 60, costMs: 24, seconds: 20, intent: 30 });
    for (const i of r.intervals) expect(i).toBeCloseTo(33.33, 1);
  });

  it('leaves every callback alone with no ceiling', () => {
    const r = runHost({ refreshMs: 1000 / 60, costMs: 5, seconds: 10, intent: 0 });
    expect(r.wiring.snapshot().skipped).toBe(0);
    expect(r.published.target).toBe(0);
  });

  it('never skips under a loading cover, a held draw, or a hidden desktop shell', () => {
    const base = { refreshMs: 1000 / 60, costMs: 5, seconds: 10, intent: 30 as const };
    expect(runHost({ ...base, cover: () => true }).wiring.snapshot().skipped).toBe(0);
    expect(runHost({ ...base, gate: { worldDrawHeld: true } }).wiring.snapshot().skipped).toBe(0);
    expect(
      runHost({ ...base, gate: { graphicsRebuildPaused: true } }).wiring.snapshot().skipped,
    ).toBe(0);
    expect(
      runHost({ ...base, gate: { hidden: true, desktopApp: true } }).wiring.snapshot().skipped,
    ).toBe(0);
  });

  it('limits an uncapped rAF by sleeping, not by spinning', () => {
    const r = runHost({ refreshMs: null, costMs: 5, seconds: 30, intent: 30 });
    expect(r.wiring.snapshot().verdict).toBe('unpaced');
    const mean = r.intervals.reduce((a, b) => a + b, 0) / r.intervals.length;
    expect(mean).toBeCloseTo(33.33, 0);
    // A spin would answer every 0.3 ms: about 3000 callbacks per second.
    const perSecond = r.callbacks / 30;
    expect(perSecond).toBeLessThan(45);
    expect(r.maxArmsPerCallback).toBe(1);
  });

  it('limits an uncapped rAF hidden behind a busy GPU, where no lattice can be read', () => {
    // Measured on a Windows HD 530 with vsync off: idle callbacks are not
    // answered at once there, they wait for the GPU like any other.
    const r = runHost(busyGpuHost());
    const mean = r.intervals.reduce((a, b) => a + b, 0) / r.intervals.length;
    expect(mean).toBeGreaterThan(32);
    expect(mean).toBeLessThan(36);
    expect(r.wiring.snapshot().targetIntervalMs).toBeCloseTo(33.33, 1);
    expect(r.callbacks / 60).toBeLessThan(80);
  });

  it('never feeds a delta that crossed a timer sleep to the estimator', () => {
    // The same host, read for what the estimator made of it: the limiter's own
    // steady timer rhythm would read as a tight one-cluster "30 Hz display".
    // Read on every frame, not at the end: a false reading makes the ceiling
    // inert, the open loop's jitter then withdraws it, and the run ends unknown.
    const verdicts = new Set<string>();
    const rates = new Set<number>();
    const r = runHost({
      ...busyGpuHost(),
      onFrame: (_t, wiring) => {
        const snap = wiring.snapshot();
        verdicts.add(snap.verdict);
        rates.add(snap.refreshHz);
      },
    });
    expect([...verdicts]).toEqual(['unknown']);
    expect([...rates]).toEqual([0]);
    const snap = r.wiring.snapshot();
    expect(snap.verdict).toBe('unknown');
    expect(snap.refreshHz).toBe(0);
    expect(snap.rendered).toBeGreaterThan(1500);
  });

  it('starts pacing again the moment a loading cover lifts, without counting the cover as misses', () => {
    const LIFT_MS = 5_000;
    let last = 0;
    let skippedUnderCover = -1;
    const sharesAfterLift: number[] = [];
    const r = runHost({
      refreshMs: 1000 / 60,
      // Slow frames under the cover: counted, each would be a missed slot.
      costMs: (t) => (t < LIFT_MS ? 40 : 5),
      seconds: 20,
      intent: 30,
      cover: () => last < LIFT_MS,
      onFrame: (t, wiring) => {
        last = t;
        const snap = wiring.snapshot();
        if (t < LIFT_MS) skippedUnderCover = snap.skipped;
        else if (t < LIFT_MS + 2_000) sharesAfterLift.push(snap.missShare);
      },
    });
    expect(skippedUnderCover).toBe(0);
    expect(r.wiring.snapshot().skipped).toBeGreaterThan(400);
    expect(sharesAfterLift.length).toBeGreaterThan(30);
    for (const share of sharesAfterLift) expect(share).toBe(0);
    expect(r.published.share).toBe(0);
    for (const i of r.intervals) expect(i).toBeCloseTo(33.33, 1);
  });

  it('takes a coarse timer into account instead of landing every frame late', () => {
    const r = runHost({ refreshMs: null, costMs: 5, seconds: 60, intent: 30, timerLateMs: 14 });
    const mean = r.intervals.reduce((a, b) => a + b, 0) / r.intervals.length;
    expect(mean).toBeCloseTo(33.33, 0);
    expect(r.wiring.snapshot().missShare).toBeLessThan(0.02);
  });

  it('never reads a steady frame cost on an uncapped loop as a display', () => {
    let n = 0;
    const costs = [17.2, 18.4, 16.9, 19.1, 17.7, 18.8, 16.6, 18.1];
    const r = runHost({
      refreshMs: null,
      idleMs: 3,
      costMs: () => costs[n++ % costs.length],
      seconds: 60,
      intent: 0,
    });
    expect(r.wiring.snapshot().verdict).not.toBe('paced');
  });

  it('does not read its own timer cadence back as a display', () => {
    const r = runHost({ refreshMs: null, costMs: 5, seconds: 60, intent: 30 });
    const snap = r.wiring.snapshot();
    expect(snap.verdict).toBe('unpaced');
    expect(snap.targetIntervalMs).toBeCloseTo(33.33, 1);
  });
});

describe('the shared instance', () => {
  // A fresh module per case: the instance is a module singleton.
  const bootWith = async (storedValue: number | null, search: string) => {
    vi.resetModules();
    vi.stubGlobal('location', { search });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'woc_settings' && storedValue !== null
          ? JSON.stringify({ frameRateCap: storedValue })
          : null,
      setItem: () => {},
      removeItem: () => {},
    });
    try {
      const fresh = await import('../src/game/frame_cadence_wiring');
      const snap = fresh.sharedFrameCadence().snapshot();
      return { auto: snap.auto, intent: snap.intent };
    } finally {
      delete (globalThis as { __wocFrameCadence?: unknown }).__wocFrameCadence;
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  };

  it('boots on the stored choice, Auto for a player who never chose', async () => {
    expect(await bootWith(null, '')).toEqual({ auto: true, intent: 0 });
    expect(await bootWith(0, '')).toEqual({ auto: true, intent: 0 });
    expect(await bootWith(1, '')).toEqual({ auto: false, intent: 0 });
    expect(await bootWith(2, '')).toEqual({ auto: false, intent: 60 });
    expect(await bootWith(3, '')).toEqual({ auto: false, intent: 30 });
  });

  it('boots on the URL override over any stored choice', async () => {
    expect(await bootWith(0, '?fpscap=30')).toEqual({ auto: false, intent: 30 });
    expect(await bootWith(3, '?fpscap=display')).toEqual({ auto: false, intent: 0 });
    expect(await bootWith(0, '?fpscap=60')).toEqual({ auto: false, intent: 60 });
  });
});

describe('frame loop survival', () => {
  it('keeps the loop alive when the ceiling is lifted while the limiter sleeps', () => {
    // Timer mode is the one state where a pending setTimeout, not a rAF, holds
    // the loop. Lifting the ceiling there must hand it back to rAF.
    let lifted = false;
    const r = runHost({
      refreshMs: null,
      costMs: 5,
      seconds: 30,
      intent: 30,
      onFrame: (t, wiring) => {
        if (!lifted && t > 15_000) {
          lifted = true;
          wiring.setIntent(0);
        }
      },
    });
    expect(lifted).toBe(true);
    // Back to the open loop: far more than 30 frames per second at the end.
    expect(r.intervals.length / 5).toBeGreaterThan(100);
    expect(r.maxArmsPerCallback).toBe(1);
  });

  it('re-arms plainly and renders when the ceiling itself throws', () => {
    const armed: FrameRequestCallback[] = [];
    const g = globalThis as { requestAnimationFrame?: unknown };
    const original = g.requestAnimationFrame;
    g.requestAnimationFrame = (cb: FrameRequestCallback) => armed.push(cb);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = vi.spyOn(sharedFrameCadence(), 'armAndSkip').mockImplementation(() => {
      throw new Error('boom');
    });
    try {
      const frame: FrameRequestCallback = () => {};
      const gate = {
        hidden: false,
        desktopApp: false,
        graphicsRebuildPaused: false,
        worldDrawHeld: false,
      };
      expect(armFrameAndSkip(frame, 16, gate)).toBe(false);
      expect(armed).toEqual([frame]);
    } finally {
      thrown.mockRestore();
      errors.mockRestore();
      g.requestAnimationFrame = original;
    }
  });

  it('does not arm a second chain when the throw came after the arm', () => {
    const armed: FrameRequestCallback[] = [];
    const g = globalThis as { requestAnimationFrame?: unknown };
    const original = g.requestAnimationFrame;
    g.requestAnimationFrame = (cb: FrameRequestCallback) => armed.push(cb);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const shared = sharedFrameCadence();
    const thrown = vi.spyOn(shared, 'armAndSkip').mockImplementation(() => {
      shared.armedThisCallback = true;
      throw new Error('boom after the arm');
    });
    try {
      const gate = {
        hidden: false,
        desktopApp: false,
        graphicsRebuildPaused: false,
        worldDrawHeld: false,
      };
      expect(armFrameAndSkip(() => {}, 16, gate)).toBe(false);
      expect(armed).toEqual([]);
    } finally {
      shared.armedThisCallback = false;
      thrown.mockRestore();
      errors.mockRestore();
      g.requestAnimationFrame = original;
    }
  });

  it('logs a persistent failure once, not at display rate', () => {
    const g = globalThis as { requestAnimationFrame?: unknown };
    const original = g.requestAnimationFrame;
    g.requestAnimationFrame = () => 0;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = vi.spyOn(sharedFrameCadence(), 'armAndSkip').mockImplementation(() => {
      throw new Error('boom');
    });
    try {
      const gate = {
        hidden: false,
        desktopApp: false,
        graphicsRebuildPaused: false,
        worldDrawHeld: false,
      };
      for (let i = 0; i < 50; i++) armFrameAndSkip(() => {}, i * 16, gate);
      expect(errors.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      thrown.mockRestore();
      errors.mockRestore();
      g.requestAnimationFrame = original;
    }
  });

  it.each(['requestFrame', 'setTimer'] as const)(
    'reads as not armed when %s itself throws, and as armed once it returned',
    (failing) => {
      let boom = true;
      const wiring = new FrameCadenceWiring({
        requestFrame: () => {
          if (boom && failing === 'requestFrame') throw new Error('boom');
        },
        setTimer: () => {
          if (boom && failing === 'setTimer') throw new Error('boom');
        },
        now: () => 0,
        coverActive: () => false,
        publish: () => {},
        governorShedding: () => false,
        governorAtBaseline: () => false,
        inCombat: () => false,
        surfacePixels: () => 0,
        autoMemory: {
          load: () => null,
          save: () => {},
          clear: () => {},
          settingsSignature: () => '',
        },
      });
      wiring.setIntent(30);
      const gate = {
        hidden: false,
        desktopApp: false,
        graphicsRebuildPaused: false,
        worldDrawHeld: false,
      };
      // Uncapped rAF, long enough for the unread display to reach the timer arm.
      let threw = false;
      let t = 0;
      for (let i = 0; i < 2000 && !threw; i++) {
        t += 0.4;
        // The timer arm is only reached once the unread display stops getting bare rAFs.
        boom = failing === 'requestFrame' ? i > 5 : i > 400;
        try {
          wiring.armAndSkip(() => {}, t, gate);
          expect(wiring.armedThisCallback).toBe(true);
        } catch {
          threw = true;
          expect(wiring.armedThisCallback).toBe(false);
        }
      }
      expect(threw).toBe(true);
    },
  );

  it('one throttled timer tick does not leave the limiter waking for nothing', () => {
    const host = (throttleOnce: boolean): Parameters<typeof runHost>[0] => {
      let throttled = !throttleOnce;
      return {
        refreshMs: null,
        costMs: 5,
        seconds: 60,
        intent: 30,
        timerLateMs: (t) => {
          if (throttled || t < 20_000) return 0;
          throttled = true;
          return 1_000;
        },
      };
    };
    const steady = runHost(host(false));
    const r = runHost(host(true));
    for (const i of r.intervals) expect(i).toBeCloseTo(33.33, 0);
    // Remembered for long, or uncapped, that one second of lateness ends every
    // sleep early for hundreds of frames, and the rest of each interval is spent
    // on zero-length timers (measured here: about 2900 extra callbacks).
    expect(r.callbacks - steady.callbacks).toBeLessThan(300);
  });

  it('says when the display has had time to be read, and starts over after a cover', () => {
    const read: Array<{ at: number; displayRead: boolean }> = [];
    runHost({
      refreshMs: 1000 / 60,
      costMs: 5,
      seconds: 30,
      intent: 30,
      cover: (t) => t > 15_000 && t < 16_000,
      onFrame: (t, wiring) => read.push({ at: t, displayRead: wiring.snapshot().displayRead }),
    });
    const at = (ms: number) => read.filter((r) => r.at <= ms).pop()?.displayRead;
    expect(at(1_000)).toBe(false);
    expect(at(10_000)).toBe(true);
    // The cover reset the estimator's window: not read again until it had its say.
    expect(at(16_500)).toBe(false);
    expect(at(25_000)).toBe(true);
  });

  it('a hidden web tab goes back to rAF, which the browser pauses: no timer chain renders it', () => {
    const shown = runHost({ ...busyGpuHost(), seconds: 20 });
    expect(shown.timerArms).toBeGreaterThan(100);
    const hidden = runHost({ ...busyGpuHost(), seconds: 20, gate: { hidden: true } });
    expect(hidden.timerArms).toBe(0);
  });

  it('never loops on a non-finite display rate', () => {
    expect(ceilingDivisor(Number.POSITIVE_INFINITY, 30)).toBe(1);
    expect(ceilingDivisor(Number.NaN, 30)).toBe(1);
  });
});

describe('automatic frame rate limit', () => {
  const SLOT = 1000 / 60;
  // An uneven machine: frames alternate between one and two slots. (A machine
  // that misses EVERY slot is already regular, reads as a slower display, and
  // is rightly left alone.)
  const uneven = (slow: number, fast: number) => {
    let n = 0;
    return () => (n++ % 2 === 0 ? slow : fast);
  };
  const intents = (r: ReturnType<typeof runHost>) => r.intentLog.map((e) => e.intent);
  /** The self-initiated stays above the held ceiling, as [start, end] in ms. */
  const excursions = (r: ReturnType<typeof runHost>, seconds: number): Array<[number, number]> =>
    r.intentLog
      .map((e, i) => ({ ...e, end: r.intentLog[i + 1]?.at ?? seconds * 1000 }))
      .filter((e, i) => i > 0 && e.intent === 0)
      .map((e) => [e.at, e.end]);
  const SETTLED_AT_30: FrameCadenceAutoRecord = { ceiling: 30, confirmed: true, failStreak: 1 };
  const PROVISIONAL_AT_30: FrameCadenceAutoRecord = {
    ceiling: 30,
    confirmed: false,
    failStreak: 0,
  };

  it('a weak machine, first session: 30 within seconds, one sub-second probe, then it holds', () => {
    const seconds = 400;
    const r = runHost({ refreshMs: SLOT, costMs: uneven(22, 12), seconds, intent: 'auto' });
    expect(intents(r)).toEqual([0, 30, 0, 30]);
    // 300 frames clear of the entry cover, then 120 frames of evidence.
    expect(r.intentLog[1].at).toBeLessThan(12_000);
    expect(r.intentLog[1].at).toBeGreaterThan(8_000);
    const [[start, end]] = excursions(r, seconds);
    expect(start - r.intentLog[1].at).toBeGreaterThan(55_000);
    expect(end - start).toBeLessThan(1_000);
    const longAfterSettle = r.renderedAt
      .slice(1)
      .filter((t, i) => t > 10_000 && t - r.renderedAt[i] > 40).length;
    expect(longAfterSettle).toBeLessThanOrEqual(3);
    for (const i of r.intervals) expect(i).toBeCloseTo(33.33, 1);
    expect(r.saved[r.saved.length - 1]).toEqual(SETTLED_AT_30);
    // Settled: the headroom at 30 goes to quality.
    expect(r.published.hold).toBe(false);
  });

  it('holds the quality levels while the verdict is still provisional', () => {
    const r = runHost({ refreshMs: SLOT, costMs: uneven(22, 12), seconds: 30, intent: 'auto' });
    expect(intents(r)).toEqual([0, 30]);
    // A few seconds of evidence never outlive the session.
    expect(r.saved).toEqual([]);
    expect(r.published.hold).toBe(true);
    expect(r.wiring.snapshot().autoHoldsQuality).toBe(true);
  });

  it('a weak machine, second session: the remembered verdict holds for half an hour, untouched', () => {
    const r = runHost({
      refreshMs: SLOT,
      costMs: uneven(22, 12),
      seconds: 1800,
      intent: 'auto',
      remembered: SETTLED_AT_30,
    });
    expect(intents(r)).toEqual([0, 30]);
    expect(r.intentLog[1].at).toBeLessThan(3_000);
    expect(r.saved).toEqual([]);
    expect(r.published.hold).toBe(false);
  });

  it('never probes in combat, nor in the seconds after it', () => {
    const seconds = 300;
    const r = runHost({
      refreshMs: SLOT,
      costMs: uneven(22, 12),
      seconds,
      intent: 'auto',
      remembered: PROVISIONAL_AT_30,
      inCombat: (t) => t < 200_000,
    });
    const [[start]] = excursions(r, seconds);
    expect(start).toBeGreaterThan(209_000);
    expect(start).toBeLessThan(220_000);
  });

  it('cancels a probe the moment a fight starts, and the fight costs it nothing', () => {
    let probeAt = -1;
    const r = runHost({
      refreshMs: SLOT,
      costMs: 5,
      seconds: 100,
      intent: 'auto',
      remembered: PROVISIONAL_AT_30,
      onFrame: (t, wiring) => {
        if (probeAt < 0 && wiring.snapshot().autoPhase === 'probe') probeAt = t;
      },
      inCombat: (t) => probeAt >= 0 && t >= probeAt && t < probeAt + 5_000,
    });
    const snap = r.wiring.snapshot();
    expect(snap.autoProbesInconclusive).toBe(1);
    expect(snap.autoProbesFailed).toBe(0);
    // Asked again once calm, and this machine holds: it ends at full cadence.
    expect(snap.autoProbes).toBe(2);
    expect(snap.intent).toBe(0);
  });

  it('a hidden web tab is no play time: the resume neither probes nor confirms', () => {
    // rAF stops while hidden and the resume callback still holds the previous
    // gate view, so the six hidden minutes arrive as ONE interval.
    let hiddenOnce = false;
    const host: Parameters<typeof runHost>[0] = {
      refreshMs: SLOT,
      costMs: (t) => {
        if (!hiddenOnce && t > 20_000) {
          hiddenOnce = true;
          return 360_000;
        }
        return 5;
      },
      seconds: 420,
      intent: 'auto',
      remembered: PROVISIONAL_AT_30,
    };
    const r = runHost(host);
    const snap = r.wiring.snapshot();
    // 20 s of clean play before, under 40 s after: no clean minute yet.
    expect(snap.autoProbes).toBe(0);
    expect(snap.autoPhase).toBe('held');
    expect(snap.autoConfirmed).toBe(false);
    expect(r.saved).toEqual([]);
  });

  it('a fight never moves the limit: it only postpones or aborts a probe', () => {
    const fights = (t: number) => t % 20_000 < 12_000;
    const settled = runHost({
      refreshMs: SLOT,
      costMs: uneven(22, 12),
      seconds: 200,
      intent: 'auto',
      remembered: SETTLED_AT_30,
      inCombat: fights,
    });
    expect(intents(settled)).toEqual([0, 30]);
    const strong = runHost({
      refreshMs: SLOT,
      costMs: 6,
      seconds: 200,
      intent: 'auto',
      inCombat: fights,
    });
    expect(intents(strong)).toEqual([0]);
    // A weak machine reaches its limit at the same moment with or without fights.
    const calm = runHost({ refreshMs: SLOT, costMs: uneven(22, 12), seconds: 30, intent: 'auto' });
    const fighting = runHost({
      refreshMs: SLOT,
      costMs: uneven(22, 12),
      seconds: 30,
      intent: 'auto',
      inCombat: () => true,
    });
    expect(fighting.intentLog).toEqual(calm.intentLog);
  });

  it('three cancelled probes settle the hold for the governor and store nothing', () => {
    // A capable machine with a 1.1 s hitch inside each confirming probe.
    let inProbe = false;
    let hitched = false;
    const r = runHost({
      refreshMs: SLOT,
      costMs: () => {
        if (!inProbe || hitched) return 5;
        hitched = true;
        return 1_100;
      },
      // Long past a full evidence run at baseline: with no budget left the hold
      // stays for the session, by design (nothing is stored, the governor is free).
      seconds: 1500,
      intent: 'auto',
      governorAtBaseline: () => true,
      remembered: PROVISIONAL_AT_30,
      onFrame: (_t, wiring) => {
        const now = wiring.snapshot().autoPhase === 'probe';
        if (!now) hitched = false;
        inProbe = now;
      },
    });
    const snap = r.wiring.snapshot();
    expect(snap.autoProbesInconclusive).toBe(3);
    expect(snap.autoProbes).toBe(3);
    expect(snap.autoProbesFailed).toBe(0);
    // The fleet must be able to tell this hold from a probed one.
    expect(snap.autoConfirmed).toBe(false);
    // Nothing more is owed, so the dev overlay must not call it settling.
    expect(snap.autoHoldsQuality).toBe(false);
    expect(snap.intent).toBe(30);
    expect(r.published.hold).toBe(false);
    expect(r.saved).toEqual([]);
  });

  it('still reads a weak machine whose play is cut by long stalls', () => {
    // A 1.2 s stall every 8 s: each one drops the readings in flight, but it is
    // not an arrival, so the 300-frame clearance is not restarted by it.
    const slow = uneven(22, 12);
    let nextStall = 8_000;
    const r = runHost({
      refreshMs: SLOT,
      costMs: (t) => {
        if (t < nextStall) return slow();
        nextStall += 8_000;
        return 1_200;
      },
      seconds: 60,
      intent: 'auto',
    });
    expect(intents(r)).toEqual([0, 30]);
    expect(r.intentLog[1].at).toBeLessThan(20_000);
  });

  it('never probes right after a loading cover', () => {
    const seconds = 300;
    const r = runHost({
      refreshMs: SLOT,
      costMs: uneven(22, 12),
      seconds,
      intent: 'auto',
      remembered: PROVISIONAL_AT_30,
      // A short cover every 8 s, the last one ending at 192.5 s: until then the
      // loop is never 300 rendered frames (10 s at the ceiling) clear of one.
      cover: (t) => t < 200_000 && t % 8_000 < 500,
    });
    // Then 300 frames clear of it, then the clean minute those frames never gave.
    const [[start]] = excursions(r, seconds);
    expect(start).toBeGreaterThan(255_000);
    expect(start).toBeLessThan(275_000);
  });

  it('returns to full cadence for good once the load is really gone', () => {
    const r = runHost({
      refreshMs: SLOT,
      costMs: (
        (slow) => (t: number) =>
          t < 40_000 ? slow() : 6
      )(uneven(22, 12)),
      seconds: 320,
      intent: 'auto',
    });
    expect(intents(r)).toEqual([0, 30, 0]);
    // Nothing is stored on the way: a session that ends ten seconds into the
    // probation must not start the next one held at the ceiling the probe left.
    expect(r.saved).toEqual([{ ceiling: 0, confirmed: false, failStreak: 0 }]);
    expect(r.wiring.snapshot().autoPhase).toBe('observe');
    expect(r.published.hold).toBe(false);
  });

  it('a place whose load comes and goes costs at most two excursions in 25 minutes', () => {
    // 50 s uneven, 25 s light, repeating: a probe can land on a light stretch.
    const seconds = 1500;
    const slow = uneven(22, 12);
    const r = runHost({
      refreshMs: SLOT,
      costMs: (t) => (t % 75_000 < 50_000 ? slow() : 6),
      seconds,
      intent: 'auto',
      governorAtBaseline: () => true,
    });
    expect(excursions(r, seconds).length).toBeLessThanOrEqual(2);
    expect(r.wiring.snapshot().intent).toBe(30);
  });

  it('gives the quality governor its turn, a few seconds and no more', () => {
    const shed = runHost({
      refreshMs: SLOT,
      costMs: uneven(22, 12),
      seconds: 60,
      intent: 'auto',
      governorShedding: () => true,
    });
    const free = runHost({ refreshMs: SLOT, costMs: uneven(22, 12), seconds: 60, intent: 'auto' });
    expect(intents(shed)).toEqual([0, 30]);
    const waited = shed.intentLog[1].at - free.intentLog[1].at;
    expect(waited).toBeGreaterThan(2_500);
    expect(waited).toBeLessThan(4_000);
  });

  it('a probe cancelled by a loading cover leaves the stored verdict provisional', () => {
    let probeAt = -1;
    const r = runHost({
      refreshMs: SLOT,
      costMs: 5,
      seconds: 75,
      intent: 'auto',
      remembered: PROVISIONAL_AT_30,
      onFrame: (t, wiring) => {
        if (probeAt < 0 && wiring.snapshot().autoPhase === 'probe') probeAt = t;
      },
      cover: (t) => probeAt >= 0 && t >= probeAt && t < probeAt + 1_000,
    });
    expect(probeAt).toBeGreaterThan(0);
    expect(r.wiring.snapshot().autoProbesInconclusive).toBe(1);
    // Neither the probe's own ceiling nor a confirmation it never earned is stored.
    expect(r.saved).toEqual([]);
  });

  it('another display class re-opens the question and keeps the stored verdict', () => {
    const host: Parameters<typeof runHost>[0] = {
      refreshMs: SLOT,
      costMs: 3,
      seconds: 60,
      intent: 'auto',
      remembered: SETTLED_AT_30,
      onFrame: (t) => {
        if (t > 20_000) host.refreshMs = 1000 / 144;
      },
    };
    const r = runHost(host);
    expect(r.wiring.snapshot().refreshHz).toBeGreaterThan(140);
    expect(r.clears).toBe(0);
    expect(r.loads).toBe(2);
  });

  it('reports the automatic mode through the snapshot and the beacon block', () => {
    const r = runHost({ refreshMs: SLOT, costMs: uneven(22, 12), seconds: 120, intent: 'auto' });
    const snap = r.wiring.snapshot();
    expect(snap.autoDescents).toBe(1);
    expect(snap.autoProbes).toBe(1);
    expect(snap.autoProbesFailed).toBe(1);
    expect(snap.autoFailStreak).toBe(1);
    expect(snap.autoConfirmed).toBe(true);
    expect(snap.autoFirstCeilingS).toBeGreaterThan(1);
    expect(snap.autoFirstCeilingS).toBeLessThan(12);
    expect(snap.autoFirstCeilingS).toBeGreaterThan(8);
  });

  it('goes through about 60 first on a 144 Hz display', () => {
    const r = runHost({
      refreshMs: 1000 / 144,
      costMs: uneven(9, 4),
      seconds: 40,
      intent: 'auto',
    });
    expect(intents(r)).toEqual([0, 60]);
    expect(r.wiring.snapshot().divisor).toBe(2);
  });

  it('leaves a machine that holds its display alone', () => {
    const r = runHost({ refreshMs: SLOT, costMs: 9, seconds: 700, intent: 'auto' });
    expect(intents(r)).toEqual([0]);
    expect(r.published.hold).toBe(false);
    expect(r.saved).toEqual([]);
  });

  it.each([
    [
      'a settings change the verdict was formed on',
      { settingsSignature: (t: number) => (t < 20_000 ? 'a' : 'b') },
    ],
    [
      'a window of another size class',
      { surfacePixels: (t: number) => (t < 20_000 ? 800 * 600 : 2560 * 1440) },
    ],
  ] as const)('%s re-opens the question and forgets the stored verdict', (_label, change) => {
    const r = runHost({
      refreshMs: SLOT,
      costMs: 6,
      seconds: 60,
      intent: 'auto',
      remembered: SETTLED_AT_30,
      onFrame: (_t, wiring) => wiring.noteSettingsChanged(),
      ...change,
    });
    expect(intents(r)).toEqual([0, 30, 0]);
    expect(r.intentLog[2].at).toBeGreaterThan(20_000);
    expect(r.intentLog[2].at).toBeLessThan(23_000);
    expect(r.clears).toBe(1);
    expect(r.wiring.snapshot().autoPhase).toBe('observe');
  });

  it('an ordinary resize changes nothing', () => {
    const r = runHost({
      refreshMs: SLOT,
      costMs: 6,
      seconds: 60,
      intent: 'auto',
      remembered: SETTLED_AT_30,
      surfacePixels: (t) => (t < 20_000 ? 1920 * 1080 : 1600 * 900),
    });
    expect(intents(r)).toEqual([0, 30]);
    expect(r.clears).toBe(0);
  });

  it('choosing Auto again after an explicit choice re-evaluates now', () => {
    let done = false;
    const r = runHost({
      refreshMs: SLOT,
      costMs: 6,
      seconds: 60,
      intent: 'auto',
      remembered: SETTLED_AT_30,
      onFrame: (t, wiring) => {
        if (done || t < 20_000) return;
        done = true;
        wiring.setIntent(60);
        wiring.setAuto();
      },
    });
    expect(r.wiring.snapshot().auto).toBe(true);
    expect(r.wiring.snapshot().intent).toBe(0);
    expect(r.wiring.snapshot().autoPhase).toBe('observe');
    expect(r.clears).toBe(1);
  });

  it('starts at the remembered ceiling', () => {
    const r = runHost({
      refreshMs: SLOT,
      costMs: uneven(22, 12),
      seconds: 10,
      intent: 'auto',
      remembered: 30,
    });
    expect(intents(r)).toEqual([0, 30]);
    expect(r.intentLog[1].at).toBeLessThan(3_000);
  });

  it.each([0, 30] as const)(
    'an explicit choice of %i switches the automatic mode off for good',
    (choice) => {
      const r = runHost({
        refreshMs: SLOT,
        costMs: uneven(22, 12),
        seconds: 60,
        intent: 'auto',
        configure: (wiring) => wiring.setIntent(choice),
      });
      expect(r.wiring.snapshot().auto).toBe(false);
      expect(r.wiring.snapshot().autoPhase).toBe('off');
      expect(r.wiring.snapshot().intent).toBe(choice);
      expect(intents(r)).toEqual([choice]);
      expect(r.saved).toEqual([]);
      expect(r.loads).toBe(0);
      expect(r.published.hold).toBe(false);
    },
  );

  it('asks for nothing where no display can be read, even with a remembered ceiling', () => {
    const targets = new Set<number>();
    const r = runHost({
      refreshMs: null,
      costMs: 25,
      seconds: 60,
      intent: 'auto',
      remembered: 30,
      onFrame: (_t, wiring) => targets.add(wiring.snapshot().targetIntervalMs),
    });
    expect([...targets]).toEqual([0]);
    expect(r.published.target).toBe(0);
    expect(r.wiring.snapshot().skipped).toBe(0);
    expect(r.saved).toEqual([]);
  });

  it('drops its ceiling the moment the display stops showing slots, and keeps what it learned', () => {
    // A 60 Hz display restored to 30, then rAF goes uncapped (the window moved
    // to a vsync-off surface): the ceiling held is no longer asked for.
    const host: Parameters<typeof runHost>[0] = {
      refreshMs: SLOT,
      costMs: 5,
      seconds: 40,
      intent: 'auto',
      remembered: 30,
      onFrame: (t) => {
        if (t > 20_000) host.refreshMs = null;
      },
    };
    const r = runHost(host);
    const snap = r.wiring.snapshot();
    expect(snap.verdict).toBe('unpaced');
    expect(snap.auto).toBe(true);
    expect(snap.intent).toBe(30);
    expect(snap.targetIntervalMs).toBe(0);
    expect(r.published.target).toBe(0);
    expect(r.published.hold).toBe(false);
  });

  it('reads the remembered verdict exactly once per session', () => {
    const r = runHost({
      refreshMs: SLOT,
      costMs: uneven(22, 12),
      seconds: 120,
      intent: 'auto',
      remembered: 30,
    });
    expect(r.loads).toBe(1);
    const held = runHost({ refreshMs: SLOT, costMs: 9, seconds: 120, intent: 'auto' });
    expect(held.loads).toBe(1);
  });

  it('restores a remembered "no ceiling" without writing it back', () => {
    const r = runHost({ refreshMs: SLOT, costMs: 9, seconds: 60, intent: 'auto', remembered: 0 });
    expect(r.loads).toBe(1);
    expect(intents(r)).toEqual([0]);
    expect(r.saved).toEqual([]);
  });

  it('is inert when rAF is uncapped, and an explicit choice switches it off', () => {
    const unpaced = runHost({ refreshMs: null, costMs: 25, seconds: 60, intent: 'auto' });
    expect(intents(unpaced)).toEqual([0]);
    const explicit = runHost({ refreshMs: SLOT, costMs: uneven(22, 12), seconds: 60, intent: 0 });
    expect(intents(explicit)).toEqual([0]);
  });
});

describe('frame cadence beacon fields', () => {
  const base: FrameCadenceSnapshot = {
    auto: false,
    displayRead: true,
    autoHoldsQuality: false,
    autoPhase: 'off',
    autoConfirmed: false,
    autoFailStreak: 0,
    autoLateShare: 0,
    autoDescents: 0,
    autoProbes: 0,
    autoProbesFailed: 0,
    autoProbesInconclusive: 0,
    autoFirstCeilingS: -1,
    intent: 0,
    verdict: 'paced',
    refreshHz: 59.94,
    divisor: 1,
    targetIntervalMs: 0,
    missShare: 0,
    rendered: 0,
    skipped: 0,
  };

  it('reports the renderer budget target while the ceiling is inert', () => {
    expect(frameCadenceBeaconFieldsFrom(base, 60)).toEqual({
      frameCapIntent: 0,
      cadenceDivisor: 1,
      refreshHz: 60,
      targetFps: 60,
    });
  });

  it('reports the effective target of a paced ceiling: 144 Hz over four slots is 36', () => {
    const s = {
      ...base,
      intent: 30 as const,
      refreshHz: 144,
      divisor: 4,
      targetIntervalMs: 4000 / 144,
    };
    expect(frameCadenceBeaconFieldsFrom(s, 60)).toEqual({
      frameCapIntent: 30,
      cadenceDivisor: 4,
      refreshHz: 144,
      targetFps: 36,
    });
  });

  it('reports the unpaced limiter as its own rate with no display reading', () => {
    const s = {
      ...base,
      intent: 30 as const,
      verdict: 'unpaced' as const,
      refreshHz: 0,
      targetIntervalMs: 1000 / 30,
    };
    expect(frameCadenceBeaconFieldsFrom(s, 120)).toEqual({
      frameCapIntent: 30,
      cadenceDivisor: 1,
      refreshHz: 0,
      targetFps: 30,
    });
  });
});
