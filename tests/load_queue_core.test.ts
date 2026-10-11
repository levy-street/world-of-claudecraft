// The loader's start queue (src/render/assets/load_queue_core.ts): two classes share the
// slots. A file somebody needs now (demand) always starts before a speculative bulk load
// (background), first come first served inside each class; a background load still waiting
// when its file is demanded is promoted; background loads never hold every slot of a queue
// that has more than one, so a demand never waits out a download nobody asked for; the
// concurrency limit holds whatever the mix.
// Node-only (RENDER_PURE_CORES): no Three, no DOM, no timers.
import { describe, expect, it } from 'vitest';
import { LoadQueue } from '../src/render/assets/load_queue_core';

/** A queue whose starts are recorded instead of run, so a test decides when each ends.
 *  `release` ends the oldest load still running (or the named one), handing back the class
 *  its start was told, as the loader does. */
function harness(limit: number) {
  const started: string[] = [];
  const running: { name: string; background: boolean }[] = [];
  const queue = new LoadQueue(limit, (start) => start());
  const push = (name: string, priority?: 'demand' | 'background', key = name): void =>
    queue.push(
      (background) => {
        started.push(name);
        running.push({ name, background });
      },
      priority,
      key,
    );
  const release = (name?: string): void => {
    const at = name === undefined ? 0 : running.findIndex((load) => load.name === name);
    const [ended] = at >= 0 ? running.splice(at, 1) : [];
    queue.release(ended?.background ?? false);
  };
  return { queue, started, push, release };
}

describe('LoadQueue', () => {
  it('starts loads up to its limit and the next one only when a slot frees', () => {
    const { started, push, release } = harness(2);
    push('a');
    push('b');
    push('c');
    push('d');
    expect(started).toEqual(['a', 'b']);
    release();
    expect(started).toEqual(['a', 'b', 'c']);
    release();
    release();
    expect(started).toEqual(['a', 'b', 'c', 'd']);
  });

  it('starts every waiting demand load before any waiting background load', () => {
    const { started, push, release } = harness(1);
    push('running');
    // the bulk stream queued first, then two files somebody needs now
    push('bulk-1', 'background');
    push('bulk-2', 'background');
    push('armor', 'demand');
    push('hair');
    expect(started).toEqual(['running']);
    for (let i = 0; i < 4; i++) release();
    // demand in arrival order, then the bulk in its own arrival order
    expect(started).toEqual(['running', 'armor', 'hair', 'bulk-1', 'bulk-2']);
  });

  it('lets background loads start at once while no demand load is waiting, on every slot but one', () => {
    const { started, push, release } = harness(4);
    for (let i = 1; i <= 6; i++) push(`bulk-${i}`, 'background');
    expect(started).toEqual(['bulk-1', 'bulk-2', 'bulk-3']);
    // the slot they left: a file somebody needs starts now, not when a bulk download ends
    push('armor');
    expect(started).toEqual(['bulk-1', 'bulk-2', 'bulk-3', 'armor']);
    // a second demand waits for a slot like any load, ahead of the bulk still waiting
    push('hair');
    expect(started).toHaveLength(4);
    release('bulk-1');
    expect(started.at(-1)).toBe('hair');
    // the demands end: the bulk gets its share back, never the slot kept for a demand
    release('armor');
    expect(started.at(-1)).toBe('bulk-4');
    release('hair');
    expect(started.at(-1)).toBe('bulk-4');
    release('bulk-2');
    expect(started.at(-1)).toBe('bulk-5');
  });

  it('keeps the kept slot through a failing background load and its retries', () => {
    // a background load that is retrying holds its slot for as long as it takes: with two
    // slots (a phone) the bulk runs one at a time, so the other is always there for a demand
    const { started, push, release } = harness(2);
    push('bulk-stuck', 'background');
    push('bulk-next', 'background');
    expect(started).toEqual(['bulk-stuck']);
    push('mount');
    expect(started).toEqual(['bulk-stuck', 'mount']);
    release('mount');
    // still one background load at a time, however long the first one takes
    expect(started).toEqual(['bulk-stuck', 'mount']);
    release('bulk-stuck');
    expect(started).toEqual(['bulk-stuck', 'mount', 'bulk-next']);
  });

  it('gives a queue of one slot to background work when nothing else waits', () => {
    const { started, push, release } = harness(1);
    push('bulk-1', 'background');
    push('bulk-2', 'background');
    expect(started).toEqual(['bulk-1']);
    release();
    expect(started).toEqual(['bulk-1', 'bulk-2']);
  });

  it('starts a promoted load as a demand: on the kept slot, and off the background share', () => {
    const { queue, started, push, release } = harness(2);
    push('bulk-1', 'background');
    push('bulk-2', 'background');
    expect(started).toEqual(['bulk-1']);
    // somebody needs the second file now: it stops waiting for the first to end
    queue.promote('bulk-2');
    expect(started).toEqual(['bulk-1', 'bulk-2']);
    push('bulk-3', 'background');
    // it ends as the demand it started as: the background share is still bulk-1's
    release('bulk-2');
    expect(started).toEqual(['bulk-1', 'bulk-2']);
    release('bulk-1');
    expect(started).toEqual(['bulk-1', 'bulk-2', 'bulk-3']);
  });

  it('promotes a waiting background load to the tail of the demand line', () => {
    const { queue, started, push, release } = harness(1);
    push('running');
    push('bulk-1', 'background');
    push('bulk-2', 'background');
    push('bulk-3', 'background');
    push('armor');
    queue.promote('bulk-3');
    for (let i = 0; i < 5; i++) release();
    // behind the demand that was already waiting, ahead of the bulk it was queued behind
    expect(started).toEqual(['running', 'armor', 'bulk-3', 'bulk-1', 'bulk-2']);
  });

  it('starts a promoted load exactly once', () => {
    const { queue, started, push, release } = harness(1);
    push('running');
    push('bulk', 'background');
    queue.promote('bulk');
    queue.promote('bulk');
    for (let i = 0; i < 4; i++) release();
    expect(started).toEqual(['running', 'bulk']);
  });

  it('ignores a promotion of a load that already started or was never queued', () => {
    const { queue, started, push, release } = harness(1);
    push('bulk', 'background');
    expect(started).toEqual(['bulk']);
    queue.promote('bulk');
    queue.promote('nobody');
    push('next', 'background');
    release();
    expect(started).toEqual(['bulk', 'next']);
  });

  it('keeps two background loads queued under one key, each in its own place', () => {
    // one file queued twice (its cache entry was released between the two asks): neither
    // start is dropped, and the second does not ride ahead with the first
    const { started, push, release } = harness(1);
    push('running');
    push('first', 'background', 'same');
    push('other', 'background', 'other');
    push('second', 'background', 'same');
    for (let i = 0; i < 4; i++) release();
    expect(started).toEqual(['running', 'first', 'other', 'second']);
    // a promotion moves every load waiting under the key, in the order they were queued
    const again = harness(1);
    again.push('running');
    again.push('first', 'background', 'same');
    again.push('bulk', 'background', 'bulk');
    again.push('second', 'background', 'same');
    again.queue.promote('same');
    for (let i = 0; i < 4; i++) again.release();
    expect(again.started).toEqual(['running', 'first', 'second', 'bulk']);
  });

  it('holds the limit across a mix of classes, promotions and releases', () => {
    let running = 0;
    let peak = 0;
    let backgroundRunning = 0;
    let backgroundPeak = 0;
    const ends: (() => void)[] = [];
    const queue = new LoadQueue(3, (start) => start());
    const load = (priority: 'demand' | 'background', key: string): void =>
      queue.push(
        (background) => {
          running++;
          peak = Math.max(peak, running);
          if (background) backgroundRunning++;
          backgroundPeak = Math.max(backgroundPeak, backgroundRunning);
          ends.push(() => {
            running--;
            if (background) backgroundRunning--;
            queue.release(background);
          });
        },
        priority,
        key,
      );
    for (let i = 0; i < 12; i++) load(i % 3 === 0 ? 'demand' : 'background', `k${i}`);
    queue.promote('k7');
    queue.promote('k10');
    let finished = 0;
    while (ends.length > 0) {
      ends.shift()?.();
      finished++;
    }
    expect(finished).toBe(12);
    expect(peak).toBe(3);
    // never every slot at once to work nobody asked for
    expect(backgroundPeak).toBe(2);
    expect(running).toBe(0);
    expect(backgroundRunning).toBe(0);
  });

  it('hands each start to the launcher it was given', () => {
    const launched: (() => void)[] = [];
    const started: string[] = [];
    const queue = new LoadQueue(2, (start) => void launched.push(start));
    queue.push(() => void started.push('a'));
    queue.push(() => void started.push('b'), 'background', 'b');
    // a slot is taken when the start is handed over, not when the launcher runs it
    queue.push(() => void started.push('c'));
    expect(launched).toHaveLength(2);
    expect(started).toEqual([]);
    for (const start of launched) start();
    expect(started).toEqual(['a', 'b']);
  });
});
