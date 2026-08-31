import { afterEach, describe, expect, it } from 'vitest';
import { VirtualClock } from './helpers/virtual_clock';

// The scheduler half of the simulated-latency movement harness: everything the
// harness measures (delivery times, input cadence, snapshot arrival) is read off
// this clock, so ordering, tie-breaking and the browser-timer stubs have to hold
// exactly or a latency scenario measures its own scheduler instead of the game.

let installed: VirtualClock | null = null;

afterEach(() => {
  installed?.uninstall();
  installed = null;
});

describe('VirtualClock scheduling', () => {
  it('runs due callbacks in timestamp order, ties in registration order', () => {
    const clock = new VirtualClock();
    const log: string[] = [];
    clock.schedule(30, () => log.push('c30'));
    clock.schedule(10, () => log.push('a10'));
    clock.schedule(20, () => log.push('b20-first'));
    clock.schedule(20, () => log.push('b20-second'));
    clock.schedule(90, () => log.push('never'));

    clock.advanceTo(50);

    expect(log).toEqual(['a10', 'b20-first', 'b20-second', 'c30']);
    expect(clock.now()).toBe(50);
    expect(clock.pending()).toBe(1);
  });

  it('advances now() to each callback due time before invoking it', () => {
    const clock = new VirtualClock();
    const seen: number[] = [];
    clock.schedule(10, () => seen.push(clock.now()));
    clock.schedule(35, () => seen.push(clock.now()));

    clock.advanceBy(100);

    expect(seen).toEqual([10, 35]);
    expect(clock.now()).toBe(100);
  });

  it('runs a callback scheduled by a callback within the same advance', () => {
    const clock = new VirtualClock();
    const seen: number[] = [];
    clock.schedule(10, () => {
      seen.push(clock.now());
      clock.schedule(clock.now() + 5, () => seen.push(clock.now()));
    });

    clock.advanceTo(40);

    expect(seen).toEqual([10, 15]);
  });

  it('reschedules an interval on a fixed period and stops when cleared', () => {
    const clock = new VirtualClock();
    const fires: number[] = [];
    const handle = clock.setInterval(() => fires.push(clock.now()), 50);

    clock.advanceBy(175);
    expect(fires).toEqual([50, 100, 150]);

    clock.clearInterval(handle);
    clock.advanceBy(500);
    expect(fires).toEqual([50, 100, 150]);
    expect(clock.pending()).toBe(0);
  });

  it('lets an interval callback cancel itself without an extra fire', () => {
    const clock = new VirtualClock();
    const fires: number[] = [];
    let handle = 0;
    handle = clock.setInterval(() => {
      fires.push(clock.now());
      if (fires.length === 2) clock.clearInterval(handle);
    }, 20);

    clock.advanceBy(200);

    expect(fires).toEqual([20, 40]);
    expect(clock.pending()).toBe(0);
  });

  it('refuses to run backwards and refuses a non-positive interval', () => {
    const clock = new VirtualClock(100);
    expect(() => clock.advanceTo(50)).toThrow(/backwards/);
    expect(() => clock.setInterval(() => {}, 0)).toThrow(/positive/);
  });
});

describe('VirtualClock install/uninstall', () => {
  it('points Date.now and performance.now at virtual time, then restores them', () => {
    const realBefore = Date.now();
    const clock = new VirtualClock(1000);
    installed = clock;
    clock.install();

    expect(Date.now()).toBe(1000);
    expect(performance.now()).toBe(1000);
    clock.advanceBy(250);
    expect(Date.now()).toBe(1250);
    expect(performance.now()).toBe(1250);

    clock.uninstall();
    installed = null;

    expect(Date.now()).toBeGreaterThanOrEqual(realBefore);
    expect(Date.now()).not.toBe(1250);
    expect(typeof performance.now()).toBe('number');
    expect(performance.now()).not.toBe(1250);
  });

  it('removes the window and document stubs on uninstall', () => {
    const hadWindow = 'window' in globalThis;
    const clock = new VirtualClock();
    installed = clock;
    clock.install();

    expect(typeof (globalThis as { window?: unknown }).window).toBe('object');
    expect(typeof (globalThis as { document?: unknown }).document).toBe('object');

    clock.uninstall();
    installed = null;

    expect('window' in globalThis).toBe(hadWindow);
    expect(clock.window()).toBeNull();
    expect(clock.document()).toBeNull();
  });

  it('fires a window.setInterval on virtual time (the ClientWorld input timer)', () => {
    const clock = new VirtualClock();
    installed = clock;
    clock.install();

    // Exactly what ClientWorld's constructor does with its input send timer.
    const sends: number[] = [];
    const timer = window.setInterval(() => sends.push(Date.now()), 50);

    clock.advanceBy(160);
    expect(sends).toEqual([50, 100, 150]);

    window.clearInterval(timer);
    clock.advanceBy(500);
    expect(sends).toEqual([50, 100, 150]);
  });

  it('fires a window.setTimeout once and honours clearTimeout', () => {
    const clock = new VirtualClock();
    installed = clock;
    clock.install();

    const fired: string[] = [];
    window.setTimeout(() => fired.push('kept'), 30);
    const cancelled = window.setTimeout(() => fired.push('cancelled'), 40);
    window.clearTimeout(cancelled);

    clock.advanceBy(100);

    expect(fired).toEqual(['kept']);
    expect(clock.pending()).toBe(0);
  });

  it('records document listeners so a visibilitychange can be driven', () => {
    const clock = new VirtualClock();
    installed = clock;
    clock.install();

    const seen: string[] = [];
    const onVisibility = (): void => {
      seen.push('visibilitychange');
    };
    document.addEventListener('visibilitychange', onVisibility);
    const doc = clock.document();
    if (!doc) throw new Error('document stub missing');

    expect(doc.listenerCount('visibilitychange')).toBe(1);
    doc.hidden = true;
    doc.dispatch('visibilitychange');
    expect(seen).toEqual(['visibilitychange']);

    document.removeEventListener('visibilitychange', onVisibility);
    doc.dispatch('visibilitychange');
    expect(seen).toEqual(['visibilitychange']);
    expect(doc.listenerCount('visibilitychange')).toBe(0);
  });
});
