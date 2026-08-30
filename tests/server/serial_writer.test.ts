// The keyed FIFO writer: per-key ordering, cross-key independence, the error
// contract (a rejecting write surfaces to its own caller exactly once and
// never blocks or poisons the writes queued behind it), and entry cleanup.
// GameServer's per-character save queue and the marketplace escrow persist
// share one instance per server, so these pins are what "commit order equals
// enqueue order" rests on.
//
// Plus its depth-warned sibling, which GameServer's shared market writer rides:
// the depth accounting is the whole behavior, and a depth that leaks on a
// settled or rejected write would either warn forever or (once the throttle
// swallows it) go silent on a real pile-up.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDepthWarnedSerialWriter,
  createKeyedSerialWriter,
  KeyedSerialWriteAborted,
} from '../../server/serial_writer';

function gate(): { open: () => void; held: Promise<void> } {
  let open!: () => void;
  const held = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, held };
}

describe('createKeyedSerialWriter', () => {
  it('runs a synchronous burst of same-key writes strictly in enqueue order', async () => {
    const writer = createKeyedSerialWriter<number>();
    const order: string[] = [];
    const first = gate();
    const a = writer.enqueue(1, async () => {
      await first.held;
      order.push('a');
      return 'a';
    });
    const b = writer.enqueue(1, async () => {
      order.push('b');
      return 'b';
    });
    const c = writer.enqueue(1, async () => {
      order.push('c');
      return 'c';
    });
    // Nothing behind the head may start while it is parked.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual([]);
    first.open();
    expect(await Promise.all([a, b, c])).toEqual(['a', 'b', 'c']);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('different keys do not serialize against each other', async () => {
    const writer = createKeyedSerialWriter<number>();
    const order: string[] = [];
    const parked = gate();
    const a = writer.enqueue(1, async () => {
      await parked.held;
      order.push('key1');
    });
    const b = writer.enqueue(2, async () => {
      order.push('key2');
    });
    await b;
    expect(order).toEqual(['key2']);
    parked.open();
    await a;
    expect(order).toEqual(['key2', 'key1']);
  });

  it('a rejecting write reaches its own caller exactly once and never blocks the queue', async () => {
    const writer = createKeyedSerialWriter<string>();
    const rejections = vi.fn();
    const boom = writer.enqueue('c', async () => {
      throw new Error('boom');
    });
    const after = writer.enqueue('c', async () => 'survived');
    await boom.catch(rejections);
    expect(rejections).toHaveBeenCalledTimes(1);
    expect(rejections.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    // The follower runs to completion: the chain is neither blocked by the
    // rejection nor poisoned for every later write on this key.
    expect(await after).toBe('survived');
    expect(await writer.enqueue('c', async () => 'later')).toBe('later');
  });

  it('drops a drained key entry and never leaks settled tails', async () => {
    const writer = createKeyedSerialWriter<number>();
    await Promise.all(Array.from({ length: 1000 }, (_, i) => writer.enqueue(i, async () => i)));
    expect(writer.pendingKeys()).toBe(0);
  });

  it('a completing write does not delete a newer tail queued for the same key', async () => {
    const writer = createKeyedSerialWriter<number>();
    const parked = gate();
    const a = writer.enqueue(7, async () => {
      await parked.held;
    });
    const b = writer.enqueue(7, async () => 'tail');
    parked.open();
    await a;
    // a settled while b still owns the key's entry: the identity check must
    // keep it, so b still runs and the entry clears only after b settles.
    expect(writer.pendingKeys()).toBe(1);
    expect(await b).toBe('tail');
    expect(writer.pendingKeys()).toBe(0);
  });

  it('settles and unlinks an aborted queued write while the running head stays blocked', async () => {
    const writer = createKeyedSerialWriter<number>();
    const parked = gate();
    const order: string[] = [];
    const head = writer.enqueue(7, async () => {
      order.push('head-start');
      await parked.held;
      order.push('head-end');
    });
    const controller = new AbortController();
    const cancelledWrite = vi.fn(async () => {
      order.push('cancelled');
    });
    const cancelled = writer.enqueueCancellable(7, controller.signal, cancelledWrite);
    const survivor = writer.enqueue(7, async () => {
      order.push('survivor');
      return 'survived';
    });

    await Promise.resolve();
    expect(order).toEqual(['head-start']);
    controller.abort(new Error('caller-owned shutdown reason'));

    const cancellation = await cancelled.catch((error: unknown) => error);
    expect(cancellation).toBeInstanceOf(KeyedSerialWriteAborted);
    expect(cancellation).toMatchObject({
      code: 'KEYED_SERIAL_WRITE_ABORTED',
      message: 'keyed serial write aborted before starting',
      name: 'KeyedSerialWriteAborted',
    });
    expect(cancelledWrite).not.toHaveBeenCalled();
    expect(order).toEqual(['head-start']);
    expect(writer.pendingKeys()).toBe(1);

    parked.open();
    await head;
    expect(await survivor).toBe('survived');
    expect(order).toEqual(['head-start', 'head-end', 'survivor']);
    expect(writer.pendingKeys()).toBe(0);
  });

  it('preserves FIFO order among survivors when queued cancellations unlink from the middle', async () => {
    const writer = createKeyedSerialWriter<string>();
    const parked = gate();
    const order: string[] = [];
    const head = writer.enqueue('character', async () => {
      await parked.held;
      order.push('head');
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstCancelled = writer.enqueueCancellable(
      'character',
      firstController.signal,
      async () => {
        order.push('cancelled-1');
      },
    );
    const survivorA = writer.enqueue('character', async () => {
      order.push('survivor-a');
    });
    const secondCancelled = writer.enqueueCancellable(
      'character',
      secondController.signal,
      async () => {
        order.push('cancelled-2');
      },
    );
    const survivorB = writer.enqueue('character', async () => {
      order.push('survivor-b');
    });

    secondController.abort();
    firstController.abort();
    await expect(firstCancelled).rejects.toBeInstanceOf(KeyedSerialWriteAborted);
    await expect(secondCancelled).rejects.toBeInstanceOf(KeyedSerialWriteAborted);
    parked.open();
    await Promise.all([head, survivorA, survivorB]);

    expect(order).toEqual(['head', 'survivor-a', 'survivor-b']);
    expect(writer.pendingKeys()).toBe(0);
  });

  it('makes the abort-start boundary explicit and never cancels work after it starts', async () => {
    const writer = createKeyedSerialWriter<number>();
    const beforeStart = new AbortController();
    const neverStarted = vi.fn(async () => 'too late');
    const queued = writer.enqueueCancellable(1, beforeStart.signal, neverStarted);

    // Starting is deferred to a microtask, so a same-turn abort owns the race.
    beforeStart.abort();
    await expect(queued).rejects.toBeInstanceOf(KeyedSerialWriteAborted);
    expect(neverStarted).not.toHaveBeenCalled();

    const duringStart = new AbortController();
    const running = writer.enqueueCancellable(2, duringStart.signal, async () => {
      // The entry is already running before user code is invoked. An abort
      // from inside the thunk therefore cannot retroactively cancel it.
      duringStart.abort();
      return 'completed';
    });
    await expect(running).resolves.toBe('completed');
    expect(writer.pendingKeys()).toBe(0);
  });

  it('does not interrupt a running cancellable write', async () => {
    const writer = createKeyedSerialWriter<number>();
    const controller = new AbortController();
    const started = gate();
    const finish = gate();
    const running = writer.enqueueCancellable(3, controller.signal, async () => {
      started.open();
      await finish.held;
      return 42;
    });

    await started.held;
    controller.abort();
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(writer.pendingKeys()).toBe(1);

    finish.open();
    await expect(running).resolves.toBe(42);
    expect(writer.pendingKeys()).toBe(0);
  });

  it('does not retain a key for an already-aborted entry', async () => {
    const writer = createKeyedSerialWriter<number>();
    const controller = new AbortController();
    controller.abort();

    await expect(
      writer.enqueueCancellable(9, controller.signal, async () => 'never'),
    ).rejects.toBeInstanceOf(KeyedSerialWriteAborted);
    expect(writer.pendingKeys()).toBe(0);
  });
});

describe('createDepthWarnedSerialWriter', () => {
  // The wrapper's own literal (server/serial_writer.ts): one warn per minute.
  const WARN_THROTTLE_MS = 60_000;
  // Any base past the throttle window, so the very first over-depth write is
  // eligible to warn (lastWarnMs starts at 0, and the wrapper compares against
  // the wall clock, not against a start time it captured).
  const BASE_MS = 1_700_000_000_000;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_MS);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('stays silent while the queue sits at or below warnDepth', async () => {
    const message = vi.fn((depth: number) => `market writer depth ${depth}`);
    const write = createDepthWarnedSerialWriter(3, message);
    const parked = gate();
    // Three concurrent writes: depth reaches exactly warnDepth, and the
    // comparison is strict, so the boundary itself must not warn.
    const running = Promise.all([
      write(async () => {
        await parked.held;
        return 'a';
      }),
      write(async () => 'b'),
      write(async () => 'c'),
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
    parked.open();
    expect(await running).toEqual(['a', 'b', 'c']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns once past warnDepth, with the caller-supplied message and the real depth', async () => {
    const message = vi.fn((depth: number) => `market writer depth ${depth}`);
    const write = createDepthWarnedSerialWriter(2, message);
    const parked = gate();
    const running = Promise.all([
      write(async () => {
        await parked.held;
        return 'a';
      }),
      write(async () => 'b'),
      write(async () => 'c'),
    ]);
    // The third write is the one that crosses: depth 3 against warnDepth 2, and
    // the message is the wrapper's ONE behavior, so it must carry that 3 rather
    // than the threshold it crossed.
    expect(message).toHaveBeenCalledTimes(1);
    expect(message).toHaveBeenCalledWith(3);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('market writer depth 3');
    parked.open();
    await running;
  });

  it('throttles the warn to one per minute, then warns again past the window', async () => {
    const message = vi.fn((depth: number) => `market writer depth ${depth}`);
    const write = createDepthWarnedSerialWriter(1, message);
    const parked = gate();
    const held = write(async () => {
      await parked.held;
      return 'held';
    });
    const queued = [write(async () => 'second')];
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Still inside the window: a deeper queue must NOT re-log, or one pile-up
    // becomes a line per waiter.
    vi.setSystemTime(BASE_MS + WARN_THROTTLE_MS - 1_000);
    queued.push(write(async () => 'third'));
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Past it: the next over-depth write logs again, carrying the depth it saw.
    vi.setSystemTime(BASE_MS + WARN_THROTTLE_MS + 1);
    queued.push(write(async () => 'fourth'));
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(message).toHaveBeenLastCalledWith(4);

    parked.open();
    expect(await held).toBe('held');
    await Promise.all(queued);
  });

  it('releases depth as writes settle, so a later burst is measured from zero', async () => {
    const message = vi.fn((depth: number) => `market writer depth ${depth}`);
    const write = createDepthWarnedSerialWriter(2, message);
    const parked = gate();
    const first = write(async () => {
      await parked.held;
      return 'a';
    });
    const second = write(async () => 'b');
    expect(warnSpy).not.toHaveBeenCalled();
    parked.open();
    expect(await Promise.all([first, second])).toEqual(['a', 'b']);

    // Nothing has warned yet, so the throttle cannot mask a leak here: if the
    // two settled writes had left their depth behind, this third one would sit
    // at 3 and log.
    expect(await write(async () => 'c')).toBe('c');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
  });

  it('releases depth on a REJECTED write too, never leaking a permanent floor', async () => {
    const message = vi.fn((depth: number) => `market writer depth ${depth}`);
    const write = createDepthWarnedSerialWriter(2, message);
    const boom = [
      write(async () => {
        throw new Error('one');
      }),
      write(async () => {
        throw new Error('two');
      }),
      write(async () => {
        throw new Error('three');
      }),
    ];
    // Crossing at depth 3 warns once; each failure still reaches its own caller.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    await expect(boom[0]).rejects.toThrow('one');
    await expect(boom[1]).rejects.toThrow('two');
    await expect(boom[2]).rejects.toThrow('three');

    // Step past the throttle window FIRST: otherwise a leaked depth would be
    // hidden by the throttle rather than by the accounting, and this pin would
    // pass for the wrong reason.
    vi.setSystemTime(BASE_MS + WARN_THROTTLE_MS + 1);
    expect(await write(async () => 'after')).toBe('after');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(message).toHaveBeenCalledTimes(1);
  });

  it('unlinks an aborted queued write while preserving the shared FIFO', async () => {
    const write = createDepthWarnedSerialWriter(3, (depth) => `market writer depth ${depth}`);
    const parked = gate();
    const order: string[] = [];
    const first = write(async () => {
      order.push('first:start');
      await parked.held;
      order.push('first:end');
      return 'first';
    });
    const controller = new AbortController();
    const cancelled = write.enqueueCancellable(controller.signal, async () => {
      order.push('cancelled');
      return 'cancelled';
    });
    const last = write(async () => {
      order.push('last');
      return 'last';
    });

    await Promise.resolve();
    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(KeyedSerialWriteAborted);
    parked.open();
    await expect(first).resolves.toBe('first');
    await expect(last).resolves.toBe('last');
    expect(order).toEqual(['first:start', 'first:end', 'last']);
  });
});
