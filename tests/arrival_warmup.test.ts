// The blocking arrival chain lifted out of main.ts
// (src/game/arrival_warmup.ts). Every dependency is faked, so these cases pin
// the ORDER the steps run in, the curtain flag's lifetime (including on a
// failure), the bounded wait for the held reveals, and the frame-loop state
// main.ts gets back.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ARRIVAL_REVEAL_SETTLE_MAX_MS,
  arrivalRevealSettleMaxMs,
  type BlockingArrivalWarmupDeps,
  ESTABLISHING_SHOT_REVEAL_SETTLE_MAX_MS,
  runBlockingArrivalWarmup,
  settleWorldEntryCover,
} from '../src/game/arrival_warmup';
import { WORLD_ENTRY_GPU_SETTLE_COVER_MS } from '../src/game/ui_effects_profile';
import {
  arrivalCoverActive,
  arrivalEstablishingShotActive,
  resetArrivalCoverForTest,
  setArrivalCover,
} from '../src/render/arrival_cover';
import { REVEAL_GATE_WATCHDOG_MS } from '../src/render/reveal_gate';

interface Rig {
  calls: string[];
  waited: number[];
  deps: BlockingArrivalWarmupDeps;
  revealed: number;
  settled: number;
}

function rig(overrides: Partial<BlockingArrivalWarmupDeps> = {}): Rig {
  const calls: string[] = [];
  const waited: number[] = [];
  const state = { revealed: 0, settled: 0 };
  const deps: BlockingArrivalWarmupDeps = {
    renderer: {
      prepareZoneAt: async (x, z, onProgress) => {
        calls.push(`prepareZoneAt:${x},${z}`);
        onProgress?.(1, 2);
      },
      prepareZonesAround: async (x, z, radiusYd, onProgress) => {
        calls.push(`prepareZonesAround:${x},${z},${radiusYd}`);
        onProgress?.(2, 2);
      },
      prewarmZoneAt: async (x, z) => {
        calls.push(`prewarmZoneAt:${x},${z}`);
      },
      markGpuHitchReveal: () => calls.push('markGpuHitchReveal'),
    },
    ui: {
      showLoadingScreen: (text) => calls.push(`showLoadingScreen:${text}`),
      setLoadingProgressRange: (done, total, from, to) =>
        calls.push(`progress:${done}/${total}:${from}-${to}`),
      setLoadingPercent: (percent) => calls.push(`percent:${percent}`),
      hideLoadingScreen: () => calls.push('hideLoadingScreen'),
      nextPaint: async () => {
        calls.push('nextPaint');
      },
      fatalOverlay: (message) => calls.push(`fatalOverlay:${message}`),
    },
    t: (key, values) => (values ? `${key}(${JSON.stringify(values)})` : key),
    technicalErrorMessage: (error) => String(error),
    zoneX: 120,
    zoneZ: -40,
    online: false,
    neighborRadiusYd: 240,
    onRevealed: () => {
      state.revealed++;
      calls.push('onRevealed');
    },
    onSettled: () => {
      state.settled++;
      calls.push('onSettled');
    },
    setCover: (active) => calls.push(`cover:${active}`),
    holdWorldDraw: (held) => calls.push(`worldDraw:${held ? 'held' : 'free'}`),
    awaitReveals: async (maxMs) => {
      waited.push(maxMs);
      calls.push('awaitReveals');
    },
    ...overrides,
  };
  return {
    calls,
    waited,
    deps,
    get revealed() {
      return state.revealed;
    },
    get settled() {
      return state.settled;
    },
  };
}

afterEach(() => {
  resetArrivalCoverForTest();
  vi.restoreAllMocks();
});

describe('runBlockingArrivalWarmup', () => {
  it('runs the arrival under the curtain, in order, and lifts it with the reveals settled', async () => {
    const r = rig();
    await runBlockingArrivalWarmup(r.deps);

    expect(r.calls).toEqual([
      'showLoadingScreen:loading.world',
      'cover:true',
      'worldDraw:held',
      'nextPaint',
      'prepareZoneAt:120,-40',
      'progress:1/2:0-55',
      'prepareZonesAround:120,-40,240',
      'progress:2/2:55-94',
      // The empty-neighbourhood fill: a dungeon or rift interior reports no
      // progress above, so the band is closed explicitly.
      'progress:1/1:55-94',
      'percent:96',
      'prewarmZoneAt:120,-40',
      'awaitReveals',
      'markGpuHitchReveal',
      // Released before the last paint, so the frame under the lifting screen
      // already shows the destination; released again when the chain ends.
      'worldDraw:free',
      'percent:100',
      'nextPaint',
      'hideLoadingScreen',
      'onRevealed',
      'worldDraw:free',
      'cover:false',
      'onSettled',
    ]);
    expect(r.waited).toEqual([ARRIVAL_REVEAL_SETTLE_MAX_MS]);
    expect(r.revealed).toBe(1);
    expect(r.settled).toBe(1);
  });

  it('marks the reveal exactly once, after the wait and before the last paint', () => {
    const r = rig();
    return runBlockingArrivalWarmup(r.deps).then(() => {
      expect(r.calls.filter((call) => call === 'markGpuHitchReveal')).toHaveLength(1);
      expect(r.calls.indexOf('markGpuHitchReveal')).toBeGreaterThan(
        r.calls.indexOf('awaitReveals'),
      );
      expect(r.calls.indexOf('markGpuHitchReveal')).toBeLessThan(r.calls.lastIndexOf('nextPaint'));
    });
  });

  it('holds the real cover flag up for the whole chain and drops it at the end', async () => {
    const seen: boolean[] = [];
    const r = rig({
      setCover: undefined,
      awaitReveals: async () => {
        seen.push(arrivalCoverActive());
      },
    });
    expect(arrivalCoverActive()).toBe(false);
    const chain = runBlockingArrivalWarmup(r.deps);
    expect(arrivalCoverActive()).toBe(true);
    await chain;

    expect(seen).toEqual([true]);
    expect(arrivalCoverActive()).toBe(false);
  });

  it('drops the real cover flag when the chain fails', async () => {
    // A stuck flag would suspend every reveal gate's escape bound for the rest
    // of the session, so the failure path matters more than the happy one.
    const r = rig({
      setCover: undefined,
      renderer: {
        prepareZoneAt: async () => {
          throw new Error('prepare exploded');
        },
        prepareZonesAround: async () => undefined,
        prewarmZoneAt: async () => undefined,
        markGpuHitchReveal: () => undefined,
      },
    });
    await runBlockingArrivalWarmup(r.deps);

    expect(arrivalCoverActive()).toBe(false);
    expect(r.calls).toContain(
      'fatalOverlay:loading.rendererFailed({"error":"Error: prepare exploded"})',
    );
    // The screen stays up on a fatal, and the frame loop is not resumed.
    expect(r.calls).not.toContain('hideLoadingScreen');
    expect(r.revealed).toBe(0);
    expect(r.settled).toBe(1);
    // The world draw was held at the top and is released by the end, so a
    // failed arrival never leaves the world undrawn behind the fatal overlay.
    expect(r.calls.indexOf('worldDraw:held')).toBeGreaterThan(-1);
    expect(r.calls.lastIndexOf('worldDraw:free')).toBeGreaterThan(
      r.calls.indexOf('worldDraw:held'),
    );
  });

  it('survives a failed prewarm and still reveals', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = rig();
    r.deps.renderer.prewarmZoneAt = async () => {
      throw new Error('prewarm exploded');
    };
    await runBlockingArrivalWarmup(r.deps);

    expect(warn).toHaveBeenCalled();
    expect(r.calls).toContain('awaitReveals');
    expect(r.calls).toContain('hideLoadingScreen');
    expect(r.revealed).toBe(1);
  });

  it('streams the radius it is given, so a rift exit keeps its wider ring', async () => {
    const r = rig({ neighborRadiusYd: 999 });
    await runBlockingArrivalWarmup(r.deps);

    expect(r.calls).toContain('prepareZonesAround:120,-40,999');
  });

  it('releases the hold and drops the cover when the RAISE itself throws', () => {
    // The raise runs before the promise chain exists, so a synchronous throw
    // there has no `finally` behind it: it must undo itself on the spot or the
    // world draw stays held and the curtain stays up for the rest of the
    // session.
    const held: boolean[] = [];
    const r = rig({
      setCover: undefined,
      holdWorldDraw: (value) => {
        held.push(value);
        if (value) throw new Error('hold exploded');
      },
    });
    expect(() => runBlockingArrivalWarmup(r.deps)).toThrow('hold exploded');
    expect(held).toEqual([true, false]);
    expect(arrivalCoverActive()).toBe(false);
  });

  it("leaves another owner's cover alone when the raise throws before its own", () => {
    // Only what this chain actually raised is undone: a blind drop would
    // decrement the world-entry owner's depth and strip ITS cover.
    setArrivalCover(true);
    const r = rig({
      setCover: undefined,
      ui: {
        ...rig().deps.ui,
        showLoadingScreen: () => {
          throw new Error('screen exploded');
        },
      },
    });
    expect(() => runBlockingArrivalWarmup(r.deps)).toThrow('screen exploded');
    expect(arrivalCoverActive()).toBe(true);
  });

  it('keeps the real cover up until BOTH overlapping owners have dropped it', async () => {
    // A teleport-sized reposition landing inside the world-entry settle window
    // puts the two owners on the same curtain. Whichever finishes first must
    // not un-refuse the boot-debt and background admission lanes mid-arrival.
    const entryCalls: string[] = [];
    let flushEntry = (): void => {};
    settleWorldEntryCover({
      adaptiveBudget: false,
      constrainedMemory: false,
      online: true,
      revealWorld: () => entryCalls.push('revealWorld'),
      afterActiveAnimationMs: (_ms, callback) => {
        flushEntry = callback;
      },
      awaitReveals: async () => undefined,
    });
    expect(arrivalCoverActive()).toBe(true);

    let releaseArrival = (): void => {};
    const arrivalWait = new Promise<void>((resolve) => {
      releaseArrival = resolve;
    });
    const r = rig({ setCover: undefined, awaitReveals: () => arrivalWait });
    const chain = runBlockingArrivalWarmup(r.deps);

    flushEntry();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(entryCalls).toEqual(['revealWorld']);
    expect(arrivalCoverActive()).toBe(true);

    releaseArrival();
    await chain;
    expect(arrivalCoverActive()).toBe(false);
  });

  it('pins the settle budget to three seconds', () => {
    // Long enough for a town kit's links on an integrated GPU, short enough
    // that a stuck driver cannot hold a loading screen open.
    expect(ARRIVAL_REVEAL_SETTLE_MAX_MS).toBe(3_000);
  });

  it('never adds a cosmetic wait for an online character, who is live on the server', async () => {
    expect(arrivalRevealSettleMaxMs(true)).toBe(0);
    expect(arrivalRevealSettleMaxMs(false)).toBe(ARRIVAL_REVEAL_SETTLE_MAX_MS);
    const r = rig({ online: true });
    await runBlockingArrivalWarmup(r.deps);
    expect(r.waited).toEqual([0]);
    // The cover still ran for the structural prepare: raised first, dropped last.
    expect(r.calls.indexOf('cover:true')).toBeLessThan(r.calls.indexOf('prepareZoneAt:120,-40'));
    expect(r.calls.at(-1)).toBe('onSettled');
    expect(r.calls.at(-2)).toBe('cover:false');
  });
});

describe('settleWorldEntryCover', () => {
  afterEach(() => resetArrivalCoverForTest());

  function entryRig(
    online: boolean,
    tier: { adaptiveBudget?: boolean; constrainedMemory?: boolean } = {},
  ) {
    const calls: string[] = [];
    const waited: number[] = [];
    let settleMs = -1;
    let flush: (() => void) | null = null;
    settleWorldEntryCover({
      adaptiveBudget: tier.adaptiveBudget ?? true,
      constrainedMemory: tier.constrainedMemory ?? false,
      online,
      revealWorld: () => calls.push('revealWorld'),
      afterActiveAnimationMs: (ms, callback) => {
        settleMs = ms;
        flush = callback;
      },
      setCover: (active) => calls.push(active ? 'cover:on' : 'cover:off'),
      awaitReveals: async (maxMs) => {
        waited.push(maxMs);
        calls.push('awaitReveals');
      },
    });
    return { calls, waited, settleMs: () => settleMs, flush: () => flush?.() };
  }

  it('raises the cover at once, then reveals after the settle and the bounded wait (offline)', async () => {
    const r = entryRig(false);
    expect(r.calls).toEqual(['cover:on']);
    expect(r.settleMs()).toBeGreaterThan(0);
    r.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(r.calls).toEqual(['cover:on', 'awaitReveals', 'revealWorld', 'cover:off']);
    expect(r.waited).toEqual([ARRIVAL_REVEAL_SETTLE_MAX_MS]);
  });

  it('online: no settle time and no cosmetic wait, the cover only spans the curtain', async () => {
    const r = entryRig(true);
    expect(r.settleMs()).toBe(0);
    r.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(r.calls).toEqual(['cover:on', 'awaitReveals', 'revealWorld', 'cover:off']);
    expect(r.waited).toEqual([0]);
  });

  it('passes the settle the graphics tier asks for, not a constant', async () => {
    // The cover exists to hide the GPU settling behind a still frame, and only
    // a host that adapts its budget and is not memory-constrained gets one.
    // Without a case per input, the offline case above passes on any positive
    // number and this whole dimension is untested.
    expect(entryRig(false, { adaptiveBudget: true, constrainedMemory: false }).settleMs()).toBe(
      WORLD_ENTRY_GPU_SETTLE_COVER_MS,
    );
    expect(WORLD_ENTRY_GPU_SETTLE_COVER_MS).toBeGreaterThan(0);
    // A fixed budget has nothing to settle into, and a constrained device pays
    // the wait without the benefit: both go straight through.
    expect(entryRig(false, { adaptiveBudget: false, constrainedMemory: false }).settleMs()).toBe(0);
    expect(entryRig(false, { adaptiveBudget: true, constrainedMemory: true }).settleMs()).toBe(0);
    expect(entryRig(false, { adaptiveBudget: false, constrainedMemory: true }).settleMs()).toBe(0);
    // Online outranks the tier on every arm: a live character never waits.
    for (const adaptiveBudget of [true, false]) {
      for (const constrainedMemory of [true, false]) {
        expect(entryRig(true, { adaptiveBudget, constrainedMemory }).settleMs()).toBe(0);
      }
    }
  });

  it('drops the cover even when revealWorld throws, and reports the throw', async () => {
    const calls: string[] = [];
    let flush = (): void => {};
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    settleWorldEntryCover({
      adaptiveBudget: false,
      constrainedMemory: false,
      online: true,
      revealWorld: () => {
        throw new Error('reveal failed');
      },
      afterActiveAnimationMs: (_ms, callback) => {
        flush = callback;
      },
      setCover: (active) => calls.push(active ? 'cover:on' : 'cover:off'),
      awaitReveals: async () => undefined,
    });
    flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(['cover:on', 'cover:off']);
    expect(report).toHaveBeenCalledWith('World reveal failed', expect.any(Error));
    report.mockRestore();
  });
});

describe('the entry cover on the establishing shot', () => {
  afterEach(() => resetArrivalCoverForTest());

  it('is the one online entry that waits, bounded, for the held reveals', () => {
    expect(arrivalRevealSettleMaxMs(true, true)).toBe(ESTABLISHING_SHOT_REVEAL_SETTLE_MAX_MS);
    expect(arrivalRevealSettleMaxMs(true, false)).toBe(0);
    expect(arrivalRevealSettleMaxMs(true)).toBe(0);
    expect(arrivalRevealSettleMaxMs(false, true)).toBe(ESTABLISHING_SHOT_REVEAL_SETTLE_MAX_MS);
    expect(arrivalRevealSettleMaxMs(false, false)).toBe(ARRIVAL_REVEAL_SETTLE_MAX_MS);
  });

  it('pins the establishing-shot bound between the town-kit bound and the reveal watchdog', () => {
    expect(ESTABLISHING_SHOT_REVEAL_SETTLE_MAX_MS).toBe(6_000);
    expect(ESTABLISHING_SHOT_REVEAL_SETTLE_MAX_MS).toBeGreaterThan(ARRIVAL_REVEAL_SETTLE_MAX_MS);
    expect(ESTABLISHING_SHOT_REVEAL_SETTLE_MAX_MS).toBeLessThan(REVEAL_GATE_WATCHDOG_MS);
  });

  function shotRig(online: boolean, establishingShot: boolean | undefined) {
    const calls: string[] = [];
    const waited: number[] = [];
    let flush = (): void => {};
    settleWorldEntryCover({
      adaptiveBudget: true,
      constrainedMemory: false,
      online,
      establishingShot,
      revealWorld: () => calls.push(`revealWorld:shot=${arrivalEstablishingShotActive()}`),
      afterActiveAnimationMs: (_ms, callback) => {
        flush = callback;
      },
      awaitReveals: async (maxMs) => {
        waited.push(maxMs);
        calls.push(`awaitReveals:shot=${arrivalEstablishingShotActive()}`);
      },
    });
    return { calls, waited, flush: () => flush() };
  }

  it('online: the shot arms the flag for the whole cover and gets the bounded wait', async () => {
    const r = shotRig(true, true);
    expect(arrivalCoverActive()).toBe(true);
    expect(arrivalEstablishingShotActive()).toBe(true);
    r.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(r.waited).toEqual([ESTABLISHING_SHOT_REVEAL_SETTLE_MAX_MS]);
    // The flag stands through the wait and the reveal, and drops with the cover.
    expect(r.calls).toEqual(['awaitReveals:shot=true', 'revealWorld:shot=true']);
    expect(arrivalCoverActive()).toBe(false);
    expect(arrivalEstablishingShotActive()).toBe(false);
  });

  it('online without the shot: no flag, no wait (the live-character rule stands)', async () => {
    const r = shotRig(true, undefined);
    expect(arrivalEstablishingShotActive()).toBe(false);
    r.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(r.waited).toEqual([0]);
    expect(r.calls).toEqual(['awaitReveals:shot=false', 'revealWorld:shot=false']);
  });

  it('never leaves the flag armed for a later plain cover', async () => {
    const r = shotRig(true, true);
    r.flush();
    await Promise.resolve();
    await Promise.resolve();
    setArrivalCover(true);
    expect(arrivalEstablishingShotActive()).toBe(false);
    setArrivalCover(false);
  });

  it('drops the flag with the cover when revealWorld throws', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    let flush = (): void => {};
    settleWorldEntryCover({
      adaptiveBudget: true,
      constrainedMemory: false,
      online: true,
      establishingShot: true,
      revealWorld: () => {
        throw new Error('reveal failed');
      },
      afterActiveAnimationMs: (_ms, callback) => {
        flush = callback;
      },
      awaitReveals: async () => undefined,
    });
    expect(arrivalEstablishingShotActive()).toBe(true);
    flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(report).toHaveBeenCalled();
    expect(arrivalCoverActive()).toBe(false);
    setArrivalCover(true);
    expect(arrivalEstablishingShotActive()).toBe(false);
    setArrivalCover(false);
  });

  it('drops the flag with the cover when the wait itself rejects', async () => {
    const calls: string[] = [];
    let flush = (): void => {};
    settleWorldEntryCover({
      adaptiveBudget: true,
      constrainedMemory: false,
      online: true,
      establishingShot: true,
      revealWorld: () => calls.push('revealWorld'),
      afterActiveAnimationMs: (_ms, callback) => {
        flush = callback;
      },
      awaitReveals: async () => {
        throw new Error('wait failed');
      },
    });
    flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(['revealWorld']);
    expect(arrivalCoverActive()).toBe(false);
    setArrivalCover(true);
    expect(arrivalEstablishingShotActive()).toBe(false);
    setArrivalCover(false);
  });

  it('main.ts arms the shot exactly when the intro cinematic is about to play', () => {
    // Comments stripped, so a commented-out line cannot satisfy the pin.
    const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    const start = src.indexOf('settleWorldEntryCover({');
    expect(start).toBeGreaterThan(-1);
    const call = src.slice(start, src.indexOf('});', start));
    expect(call).toContain('establishingShot: intro !== null');
    expect(call).toContain('online: online !== null');
    // The intro is decided (and `intro` assigned) before the cover call.
    expect(src.indexOf('intro = {')).toBeGreaterThan(-1);
    expect(src.indexOf('intro = {')).toBeLessThan(start);
    // Both halves of the seen marker read the same per-character scope.
    expect(src).toContain('readSpawnIntroSeen(keybindScope)');
    expect(src).toContain('markSpawnIntroSeen(keybindScope)');
  });
});
