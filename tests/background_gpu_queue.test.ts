import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBackgroundGpuQueue, GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { withHiddenPrewarmGroups } from '../src/render/prewarm_pass';

describe('createBackgroundGpuQueue', () => {
  it('serializes independent GPU lanes without overlap', async () => {
    const queue = createBackgroundGpuQueue();
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    let releaseFirst!: () => void;
    const first = queue.run(
      () =>
        new Promise<void>((resolve) => {
          active++;
          maxActive = Math.max(maxActive, active);
          events.push('first:start');
          releaseFirst = () => {
            active--;
            events.push('first:end');
            resolve();
          };
        }),
    );
    const second = queue.run(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      events.push('second:start');
      active--;
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
    expect(maxActive).toBe(1);
  });

  it('continues the queue after a failed lane', async () => {
    const queue = createBackgroundGpuQueue();
    const failed = queue.run(async () => {
      throw new Error('gpu lane failed');
    });
    const later = queue.run(async () => 'later');

    await expect(failed).rejects.toThrow('gpu lane failed');
    await expect(later).resolves.toBe('later');
  });

  it('cancels queued work, rejects new work, and quiesces the active unit', async () => {
    const queue = createBackgroundGpuQueue();
    const events: string[] = [];
    let releaseActive!: () => void;
    const active = queue.run(
      () =>
        new Promise<void>((resolve) => {
          events.push('active:start');
          releaseActive = resolve;
        }),
    );
    const pending = queue.run(async () => {
      events.push('pending');
    });
    await Promise.resolve();

    const shutdownError = new Error('renderer generation ended');
    const pendingRejected = expect(pending).rejects.toBe(shutdownError);
    const shutdown = queue.shutdown(shutdownError).then(() => events.push('shutdown'));
    expect(queue.shutdown()).toBe(queue.shutdown());
    await expect(queue.run(async () => {})).rejects.toBe(shutdownError);
    expect(events).toEqual(['active:start']);

    releaseActive();
    await Promise.all([active, pendingRejected, shutdown]);
    expect(events).toEqual(['active:start', 'shutdown']);
  });

  it('shuts down idempotently while idle', async () => {
    const queue = createBackgroundGpuQueue();
    const first = queue.shutdown();
    expect(queue.shutdown()).toBe(first);
    await expect(first).resolves.toBeUndefined();
  });

  it('runs higher-priority pending work first and preserves FIFO within a priority', async () => {
    const queue = createBackgroundGpuQueue();
    const events: string[] = [];
    let releaseActive!: () => void;
    const active = queue.run(
      () =>
        new Promise<void>((resolve) => {
          events.push('active');
          releaseActive = resolve;
        }),
      GPU_WORK_PRIORITY.BACKGROUND,
    );
    await Promise.resolve();

    const low = queue.run(async () => {
      events.push('low');
    }, GPU_WORK_PRIORITY.BOOT_RESUME);
    const highOne = queue.run(async () => {
      events.push('high-one');
    }, GPU_WORK_PRIORITY.LIVE_VIEW);
    const medium = queue.run(async () => {
      events.push('medium');
    }, GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    const highTwo = queue.run(async () => {
      events.push('high-two');
    }, GPU_WORK_PRIORITY.LIVE_VIEW);

    releaseActive();
    await Promise.all([active, low, highOne, medium, highTwo]);
    expect(events).toEqual(['active', 'high-one', 'high-two', 'medium', 'low']);
    expect(GPU_WORK_PRIORITY.ACTIONABLE_VIEW).toBeGreaterThan(GPU_WORK_PRIORITY.LIVE_VIEW);
    expect(GPU_WORK_PRIORITY.LIVE_VIEW).toBeGreaterThan(GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    expect(GPU_WORK_PRIORITY.VISIBLE_PREWARM).toBeGreaterThan(GPU_WORK_PRIORITY.BACKGROUND);
    expect(GPU_WORK_PRIORITY.BACKGROUND).toBeGreaterThan(GPU_WORK_PRIORITY.BOOT_RESUME);
  });

  it('hides a queued group synchronously before an occupied GPU lane releases', async () => {
    const queue = createBackgroundGpuQueue();
    let releaseActive!: () => void;
    const active = queue.run(
      () =>
        new Promise<void>((resolve) => {
          releaseActive = resolve;
        }),
    );
    await Promise.resolve();
    const group = { visible: true, children: [] };
    const queued = withHiddenPrewarmGroups([group], () => queue.run(async () => {}));

    expect(group.visible).toBe(false);
    releaseActive();
    await Promise.all([active, queued]);
    expect(group.visible).toBe(true);
  });

  it('records label, priority, and the sync slice separately from wall time', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pending = queue.run(
      () => {
        // The synchronous prologue is the main-thread block; the awaited tail
        // is the off-thread link wait and must NOT count as sync cost.
        clock += 12;
        return gate;
      },
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'live-view-gate',
    );
    await Promise.resolve();
    await Promise.resolve();
    clock += 500;
    release();
    await pending;
    const stats = queue.stats();
    expect(stats.units).toBe(1);
    expect(stats.slowest[0].label).toBe('live-view-gate');
    expect(stats.slowest[0].priority).toBe(GPU_WORK_PRIORITY.LIVE_VIEW);
    expect(stats.slowest[0].syncMs).toBe(12);
    expect(stats.slowest[0].wallMs).toBe(512);
  });

  it('keeps the slowest units by sync slice, bounded, defaulting the label', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, slowestLimit: 2 });
    for (const ms of [5, 30, 10, 20]) {
      await queue.run(() => {
        clock += ms;
      });
    }
    const stats = queue.stats();
    expect(stats.units).toBe(4);
    expect(stats.slowest.map((unit) => unit.syncMs)).toEqual([30, 20]);
    expect(stats.slowest[0].label).toBe('unlabeled');
    expect(stats.totalSyncMs).toBe(65);
    expect(stats.worstSyncMs).toBe(30);
  });

  it('exposes the running unit with its age and reports none while idle', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    expect(queue.stats().active).toBeNull();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const running = queue.run(() => gate, GPU_WORK_PRIORITY.LIVE_VIEW, 'live-view-compile');
    const behind = queue.run(async () => {}, GPU_WORK_PRIORITY.BACKGROUND, 'texture-chunk');
    await Promise.resolve();
    clock += 250;

    const busy = queue.stats();
    expect(busy.active).toEqual({
      label: 'live-view-compile',
      priority: GPU_WORK_PRIORITY.LIVE_VIEW,
      ageMs: 250,
      atMs: 0,
    });
    expect(busy.pending).toBe(1);
    expect(busy.units).toBe(0);

    release();
    await Promise.all([running, behind]);
    const idle = queue.stats();
    expect(idle.active).toBeNull();
    expect(idle.pending).toBe(0);
    expect(idle.units).toBe(2);
  });

  it('records a never-settling unit past the threshold without counting it as completed', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, stallMs: 4000 });
    // The shape of the r165 compileAsync deadlock: the unit's promise never
    // settles, so no completion callback ever runs for it.
    void queue.run(
      () => new Promise<void>(() => {}),
      GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
      'wedged-compile',
    );
    void queue.run(async () => {}, GPU_WORK_PRIORITY.BACKGROUND, 'texture-chunk');
    await Promise.resolve();

    clock += 3999;
    expect(queue.stats().stalls).toEqual([]);
    clock += 1;
    const stalled = queue.stats();
    expect(stalled.stallCount).toBe(1);
    expect(stalled.stalls).toEqual([
      {
        label: 'wedged-compile',
        priority: GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
        ageMs: 4000,
        atMs: 0,
        settled: false,
      },
    ]);
    expect(stalled.active?.label).toBe('wedged-compile');
    expect(stalled.pending).toBe(1);
    // It is a stall, not a completed unit: nothing lands in the completed-unit
    // reporting, which is exactly why it used to be invisible.
    expect(stalled.units).toBe(0);
    expect(stalled.totalSyncMs).toBe(0);
    expect(stalled.worstSyncMs).toBe(0);
    expect(stalled.slowest).toEqual([]);

    clock += 10_000;
    const later = queue.stats();
    expect(later.stallCount).toBe(1);
    expect(later.stalls[0].ageMs).toBe(14_000);
    expect(later.stalls[0].settled).toBe(false);
    expect(later.active?.ageMs).toBe(14_000);
  });

  it('settles a stall when the unit finishes and leaves the slowest ring on sync time', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, stallMs: 1000 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = queue.run(
      () => {
        clock += 8;
        return gate;
      },
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      'zone-prewarm',
    );
    await Promise.resolve();
    await Promise.resolve();
    clock += 5000;
    release();
    await slow;

    const stats = queue.stats();
    expect(stats.active).toBeNull();
    expect(stats.stallCount).toBe(1);
    expect(stats.stalls).toEqual([
      {
        label: 'zone-prewarm',
        priority: GPU_WORK_PRIORITY.VISIBLE_PREWARM,
        ageMs: 5008,
        atMs: 0,
        settled: true,
      },
    ]);
    // Completed-unit reporting is unchanged: the sync slice, not the wall time,
    // still drives worstSyncMs and the slowest ring.
    expect(stats.units).toBe(1);
    expect(stats.worstSyncMs).toBe(8);
    expect(stats.slowest[0].syncMs).toBe(8);
    expect(stats.slowest[0].wallMs).toBe(5008);
  });

  it('bounds the retained stalls while counting every one of them', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, stallMs: 100, stallLimit: 2 });
    for (const label of ['first', 'second', 'third']) {
      await queue.run(
        () => {
          clock += 500;
        },
        GPU_WORK_PRIORITY.BACKGROUND,
        label,
      );
    }
    const stats = queue.stats();
    expect(stats.stallCount).toBe(3);
    expect(stats.stalls.map((stall) => stall.label)).toEqual(['second', 'third']);
    expect(stats.stalls.every((stall) => stall.settled)).toBe(true);
    expect(stats.units).toBe(3);
  });

  // The released-tail policy (see the tail policy header in the module): a
  // unit that DECLARES its awaited tail as an off-thread wait releases the
  // queue after its synchronous prologue, bounded by the tail cap.
  const flush = async (rounds = 12): Promise<void> => {
    for (let index = 0; index < rounds; index++) await Promise.resolve();
  };

  it('releases a declared wait-only tail so lower-priority lanes keep draining', async () => {
    const queue = createBackgroundGpuQueue();
    const events: string[] = [];
    let settleLink!: () => void;
    const gated = queue.run(
      () => {
        events.push('gate:prologue');
        return new Promise<string>((resolve) => {
          settleLink = () => resolve('linked');
        });
      },
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'live-gate',
      { releaseTail: true },
    );
    const upload = queue.run(
      async () => {
        events.push('upload');
      },
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      'texture-chunk-upload',
    );

    await flush();
    // The upload no longer waits out the link; the gate itself is still pending.
    expect(events).toEqual(['gate:prologue', 'upload']);
    await upload;
    settleLink();
    await expect(gated).resolves.toBe('linked');
  });

  it('lets a higher-priority unit run to completion while a slow gate link settles', async () => {
    const queue = createBackgroundGpuQueue();
    const events: string[] = [];
    let settleLink!: () => void;
    let gateSettled = false;
    const gated = queue
      .run(
        () =>
          new Promise<void>((resolve) => {
            settleLink = resolve;
          }),
        GPU_WORK_PRIORITY.LIVE_VIEW,
        'slow-live-gate',
        { releaseTail: true },
      )
      .then(() => {
        gateSettled = true;
      });
    await flush();
    const actionable = queue.run(
      async () => {
        events.push('actionable');
      },
      GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
      'actionable-gate',
    );

    await actionable;
    expect(events).toEqual(['actionable']);
    expect(gateSettled).toBe(false);
    settleLink();
    await gated;
    expect(gateSettled).toBe(true);
  });

  it('caps concurrent released tails and resumes, by priority, when one settles', async () => {
    const queue = createBackgroundGpuQueue({ tailLimit: 2 });
    const events: string[] = [];
    const links: Array<() => void> = [];
    const gate = (name: string) =>
      queue.run(
        () => {
          events.push(`${name}:prologue`);
          return new Promise<void>((resolve) => {
            links.push(resolve);
          });
        },
        GPU_WORK_PRIORITY.LIVE_VIEW,
        name,
        { releaseTail: true },
      );
    const first = gate('first');
    const second = gate('second');
    await flush();
    expect(events).toEqual(['first:prologue', 'second:prologue']);

    const third = gate('third');
    const actionable = queue.run(
      async () => {
        events.push('actionable');
      },
      GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
      'actionable-gate',
    );
    await flush();
    // Two tails in flight fill the cap: NOTHING else starts, not even the
    // higher-priority unit (the cap is what bounds concurrent driver work).
    // The documented cap-limited readout is the triple: pending grows,
    // active null, waitingTails full.
    expect(events).toEqual(['first:prologue', 'second:prologue']);
    const capped = queue.stats();
    expect(capped.pending).toBe(2);
    expect(capped.active).toBeNull();
    expect(capped.waitingTails.map((tail) => tail.label)).toEqual(['first', 'second']);

    links[0]();
    await flush();
    // One slot freed: the actionable unit outranks the older third gate.
    expect(events).toEqual(['first:prologue', 'second:prologue', 'actionable', 'third:prologue']);

    links[1]();
    links[2]();
    await Promise.all([first, second, third, actionable]);
    expect(queue.stats().waitingTails).toEqual([]);
  });

  it('caps released tails at 2 by default: the snapshot-burst bound', async () => {
    const queue = createBackgroundGpuQueue();
    const events: string[] = [];
    const links: Array<() => void> = [];
    for (const name of ['first', 'second', 'third']) {
      void queue.run(
        () => {
          events.push(`${name}:prologue`);
          return new Promise<void>((resolve) => {
            links.push(resolve);
          });
        },
        GPU_WORK_PRIORITY.LIVE_VIEW,
        name,
        { releaseTail: true },
      );
    }
    await flush();
    // No tailLimit override: the DEFAULT cap must hold the third gate.
    expect(events).toEqual(['first:prologue', 'second:prologue']);
    links[0]();
    await flush();
    expect(events).toEqual(['first:prologue', 'second:prologue', 'third:prologue']);
    links[1]();
    links[2]();
    await flush();
    expect(queue.stats().waitingTails).toEqual([]);
  });

  it('runs a releaseTail unit returning a non-promise through the normal serial path', async () => {
    const queue = createBackgroundGpuQueue();
    const value = await queue.run(() => 42, GPU_WORK_PRIORITY.LIVE_VIEW, 'sync-gate', {
      releaseTail: true,
    });
    expect(value).toBe(42);
    const stats = queue.stats();
    expect(stats.units).toBe(1);
    expect(stats.waitingTails).toEqual([]);
  });

  it('rejects a hostile thenable whose then throws without leaking a cap slot', async () => {
    const queue = createBackgroundGpuQueue();
    const hostile = {
      // biome-ignore lint/suspicious/noThenProperty: a deliberately broken thenable is the test subject
      then() {
        throw new Error('broken thenable');
      },
    };
    const gated = queue.run(
      () => hostile as unknown as Promise<void>,
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'hostile-gate',
      { releaseTail: true },
    );
    const later = queue.run(async () => 'later');
    await expect(gated).rejects.toThrow('broken thenable');
    await expect(later).resolves.toBe('later');
    const stats = queue.stats();
    expect(stats.waitingTails).toEqual([]);
    expect(stats.units).toBe(2);
  });

  it('records a releaseTail unit that throws synchronously and keeps draining', async () => {
    const queue = createBackgroundGpuQueue();
    const failed = queue.run(
      () => {
        throw new Error('prologue failed');
      },
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'throwing-gate',
      { releaseTail: true },
    );
    const later = queue.run(async () => 'later');
    await expect(failed).rejects.toThrow('prologue failed');
    await expect(later).resolves.toBe('later');
    const stats = queue.stats();
    expect(stats.units).toBe(2);
    expect(stats.waitingTails).toEqual([]);
  });

  it('records a released unit on settle, keeping sync and wall time separate', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    let settleLink!: () => void;
    const gated = queue.run(
      () => {
        clock += 3;
        return new Promise<void>((resolve) => {
          settleLink = resolve;
        });
      },
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'live-gate',
      { releaseTail: true },
    );
    await flush();
    const inFlight = queue.stats();
    expect(inFlight.units).toBe(0);
    expect(inFlight.active).toBeNull();
    expect(inFlight.waitingTails).toEqual([
      { label: 'live-gate', priority: GPU_WORK_PRIORITY.LIVE_VIEW, ageMs: 3, atMs: 0 },
    ]);

    clock += 7000;
    settleLink();
    await gated;
    const stats = queue.stats();
    expect(stats.units).toBe(1);
    expect(stats.waitingTails).toEqual([]);
    expect(stats.slowest[0]).toEqual({
      label: 'live-gate',
      priority: GPU_WORK_PRIORITY.LIVE_VIEW,
      syncMs: 3,
      wallMs: 7003,
      atMs: 0,
    });
    // A multi-second link is still a recorded stall, settled: the release
    // changes who waits behind it, not whether it is worth seeing.
    expect(stats.stallCount).toBe(1);
    expect(stats.stalls[0]).toMatchObject({ label: 'live-gate', settled: true, ageMs: 7003 });
  });

  it('propagates a released tail rejection and keeps draining', async () => {
    const queue = createBackgroundGpuQueue();
    let failLink!: (error: Error) => void;
    const gated = queue.run(
      () =>
        new Promise<void>((_resolve, reject) => {
          failLink = reject;
        }),
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'failing-gate',
      { releaseTail: true },
    );
    const later = queue.run(async () => 'later');
    await flush();
    failLink(new Error('link failed'));
    await expect(gated).rejects.toThrow('link failed');
    await expect(later).resolves.toBe('later');
    // The reject arm still runs the full settle bookkeeping: the failed unit
    // is recorded and its cap slot is released, never leaked.
    const stats = queue.stats();
    expect(stats.waitingTails).toEqual([]);
    expect(stats.units).toBe(2);
  });

  it('records an unsettled released tail as a stall while active stays null: the wedge readout', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, stallMs: 4000 });
    // The r165 compileAsync deadlock shape, now on the RELEASED path (every
    // compile gate declares releaseTail): the tail never settles, the drain
    // loop is free, so active is null and the tail list plus the stall record
    // are the only evidence.
    void queue.run(
      () => new Promise<void>(() => {}),
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'wedged-released',
      { releaseTail: true },
    );
    await flush();
    clock += 10_000;
    const stats = queue.stats();
    expect(stats.active).toBeNull();
    expect(stats.waitingTails).toEqual([
      { label: 'wedged-released', priority: GPU_WORK_PRIORITY.LIVE_VIEW, ageMs: 10_000, atMs: 0 },
    ]);
    expect(stats.stallCount).toBe(1);
    expect(stats.stalls).toEqual([
      {
        label: 'wedged-released',
        priority: GPU_WORK_PRIORITY.LIVE_VIEW,
        ageMs: 10_000,
        atMs: 0,
        settled: false,
      },
    ]);
    expect(stats.units).toBe(0);
  });

  it('survives a shutdown that empties pending while the drain is parked on the tail cap', async () => {
    const queue = createBackgroundGpuQueue({ tailLimit: 2 });
    const links: Array<() => void> = [];
    const gate = (name: string) =>
      queue.run(
        () =>
          new Promise<void>((resolve) => {
            links.push(resolve);
          }),
        GPU_WORK_PRIORITY.LIVE_VIEW,
        name,
        { releaseTail: true },
      );
    const first = gate('first');
    const second = gate('second');
    await flush();
    // Cap saturated; this unit parks the drain loop on the tail-cap wait.
    const parked = queue.run(async () => 'parked', GPU_WORK_PRIORITY.LIVE_VIEW, 'parked');
    await flush();

    const shutdownError = new Error('renderer generation ended');
    const parkedRejected = expect(parked).rejects.toBe(shutdownError);
    let shutdownDone = false;
    const shutdown = queue.shutdown(shutdownError).then(() => {
      shutdownDone = true;
    });
    await flush();
    expect(shutdownDone).toBe(false);

    // The tails settle AFTER shutdown spliced pending: the resumed drain must
    // observe the emptied queue instead of dereferencing a missing unit, and
    // shutdown must still resolve once both tails settle.
    links[0]();
    links[1]();
    await Promise.all([first, second, parkedRejected, shutdown]);
    expect(shutdownDone).toBe(true);
    expect(queue.stats().waitingTails).toEqual([]);
    expect(queue.stats().units).toBe(2);
  });

  it('shutdown resolves only after released tails settle', async () => {
    const queue = createBackgroundGpuQueue();
    let settleLink!: () => void;
    const gated = queue.run(
      () =>
        new Promise<void>((resolve) => {
          settleLink = resolve;
        }),
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'live-gate',
      { releaseTail: true },
    );
    await flush();
    let shutdownDone = false;
    const shutdown = queue.shutdown().then(() => {
      shutdownDone = true;
    });
    await flush();
    expect(shutdownDone).toBe(false);
    settleLink();
    await Promise.all([gated, shutdown]);
    expect(shutdownDone).toBe(true);
  });

  it('wires sky, feature, archetype, and boot-resume units through one renderer queue', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const method = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      const end = source.indexOf(endText, start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return source.slice(start, end);
    };
    const sky = method('private async prepareZoneSky(', '\n  /**\n   * Materialize the terrain');
    const features = method('prepareZoneAt(', '\n  /** Stage wall-times');
    const archetypes = method('async prewarmZoneAt(', '\n  /** Blocking-path neighborhood prepare');
    const texture = method('private prewarmTextureInIdle(', '\n  private prewarmMaterialTextures(');
    const initial = method('async prewarmInitialScene(', '\n  // Visual reactions to sim events');
    expect(source).toContain('private backgroundGpuWork = createBackgroundGpuQueue()');
    expect(sky).toContain('this.backgroundGpuWork.run(');
    expect(features).toContain('this.backgroundGpuWork.run(');
    expect(archetypes).toContain('this.backgroundGpuWork.run(');
    expect(texture).toContain('this.backgroundGpuWork.run(');
    expect(initial).toContain(
      'this.backgroundGpuWork.run(unit.run, GPU_WORK_PRIORITY.BOOT_RESUME, unit.id)',
    );
  });
});
