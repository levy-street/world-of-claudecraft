// A virtual wall clock plus a timestamp-ordered scheduler, for suites that must
// drive a module which reads the clock and registers browser timers itself
// (ClientWorld's constructor calls window.setInterval(..., 50) and listens for
// visibilitychange, so a latency harness needs both seams under test control).
//
// Deliberately NOT vitest fake timers, for the reasons tests/helpers/
// synthetic_clock.ts records: a clock captured at construction never moves under
// fake timers, and a fractional delay may fire early. This module is the richer
// sibling of that one: synthetic_clock serves an INJECTED time seam through
// promises, this one serves callback timers plus the Date/performance/window/
// document globals a browser-shaped module reaches for on its own.
//
// Time only advances when the test advances it, and `advance*` runs every due
// callback in timestamp order (ties in registration order), stepping `nowMs` to
// each callback's own due time before invoking it, so a callback reading now()
// sees the instant it was scheduled for rather than the end of the jump.

import { type MockInstance, vi } from 'vitest';

export type TimerId = number;
/** What `schedule` hands back; feed it to `cancel` (or clearTimeout/Interval). */
export type CancelHandle = TimerId;

interface ScheduledEntry {
  id: TimerId;
  at: number;
  seq: number;
  fn: () => void;
  /** Non-null for a repeating timer: the period it re-arms with. */
  everyMs: number | null;
}

type Listener = (event?: unknown) => void;

/** The shape both the window and document stubs share. */
export interface EventTargetStub {
  addEventListener(type: string, fn: Listener): void;
  removeEventListener(type: string, fn: Listener): void;
  /** Test-side trigger: invokes every listener registered for `type`. */
  dispatch(type: string, event?: unknown): void;
  listenerCount(type: string): number;
}

export interface WindowStub extends EventTargetStub {
  setTimeout(fn: () => void, ms?: number): TimerId;
  clearTimeout(handle: TimerId | null | undefined): void;
  setInterval(fn: () => void, ms?: number): TimerId;
  clearInterval(handle: TimerId | null | undefined): void;
}

export interface DocumentStub extends EventTargetStub {
  hidden: boolean;
  visibilityState: 'visible' | 'hidden';
}

function eventTargetStub(): EventTargetStub {
  const listeners = new Map<string, Listener[]>();
  return {
    addEventListener(type, fn) {
      const list = listeners.get(type);
      if (list) list.push(fn);
      else listeners.set(type, [fn]);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type);
      if (!list) return;
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    },
    dispatch(type, event) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    },
    listenerCount: (type) => (listeners.get(type) ?? []).length,
  };
}

/** Guards a zero-progress interval from spinning forever inside one advance. */
const MAX_CALLBACKS_PER_ADVANCE = 100000;

export class VirtualClock {
  private nowMs: number;
  private entries: ScheduledEntry[] = [];
  private nextId: TimerId = 1;
  private nextSeq = 0;
  private dateSpy: MockInstance<() => number> | null = null;
  private saved: { key: string; descriptor: PropertyDescriptor | undefined }[] = [];
  private installedWindow: WindowStub | null = null;
  private installedDocument: DocumentStub | null = null;

  constructor(startMs = 0) {
    this.nowMs = startMs;
  }

  now(): number {
    return this.nowMs;
  }

  /** Run a callback once, when virtual time reaches `atMs` (or immediately at
   *  the next advance if that instant is already past). */
  schedule(atMs: number, fn: () => void): CancelHandle {
    return this.push(atMs, fn, null);
  }

  setTimeout(fn: () => void, ms = 0): TimerId {
    return this.push(this.nowMs + Math.max(0, ms), fn, null);
  }

  setInterval(fn: () => void, everyMs: number): TimerId {
    if (!(everyMs > 0)) throw new Error('VirtualClock.setInterval needs a positive period');
    return this.push(this.nowMs + everyMs, fn, everyMs);
  }

  cancel(handle: TimerId | null | undefined): void {
    if (handle == null) return;
    const at = this.entries.findIndex((e) => e.id === handle);
    if (at >= 0) this.entries.splice(at, 1);
  }

  clearTimeout(handle: TimerId | null | undefined): void {
    this.cancel(handle);
  }

  clearInterval(handle: TimerId | null | undefined): void {
    this.cancel(handle);
  }

  /** How many timers are still armed. */
  pending(): number {
    return this.entries.length;
  }

  advanceTo(ms: number): void {
    if (ms < this.nowMs) throw new Error('VirtualClock cannot run backwards');
    for (let steps = 0; ; steps++) {
      if (steps > MAX_CALLBACKS_PER_ADVANCE) {
        throw new Error('VirtualClock.advanceTo did not settle: a timer is not making progress');
      }
      const due = this.earliestDue(ms);
      if (!due) break;
      // Step to the callback's OWN due time first: a callback that reads now()
      // (or schedules a follow-up from it) must see the instant it was armed
      // for, not the end of the jump.
      this.nowMs = Math.max(this.nowMs, due.at);
      // Re-arm (or drop) BEFORE invoking, so a callback that cancels its own
      // interval wins over the re-arm.
      if (due.everyMs === null) this.cancel(due.id);
      else {
        due.at += due.everyMs;
        due.seq = this.nextSeq++;
      }
      due.fn();
    }
    this.nowMs = ms;
  }

  advanceBy(ms: number): void {
    this.advanceTo(this.nowMs + ms);
  }

  /**
   * Point the ambient clock and browser timer seams at this clock: Date.now,
   * globalThis.performance.now, a window whose set/clearTimeout/Interval
   * register here, and a document that records listeners (ClientWorld attaches
   * visibilitychange in its constructor).
   */
  install(): void {
    if (this.dateSpy) throw new Error('VirtualClock is already installed');
    this.dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => this.nowMs);

    const win: WindowStub = {
      ...eventTargetStub(),
      setTimeout: (fn, ms = 0) => this.setTimeout(fn, ms),
      clearTimeout: (handle) => this.cancel(handle),
      setInterval: (fn, ms = 0) => this.setInterval(fn, ms),
      clearInterval: (handle) => this.cancel(handle),
    };
    const doc: DocumentStub = { ...eventTargetStub(), hidden: false, visibilityState: 'visible' };
    this.installedWindow = win;
    this.installedDocument = doc;

    // Saved-descriptor restore rather than vi.unstubAllGlobals(): uninstall must
    // put back exactly these three and leave any other stub a suite installed
    // alone.
    this.stub('performance', { now: () => this.nowMs });
    this.stub('window', win);
    this.stub('document', doc);
  }

  uninstall(): void {
    this.dateSpy?.mockRestore();
    this.dateSpy = null;
    for (const { key, descriptor } of this.saved.reverse()) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    this.saved = [];
    this.installedWindow = null;
    this.installedDocument = null;
  }

  /** The installed window stub (null until install()). */
  window(): WindowStub | null {
    return this.installedWindow;
  }

  /** The installed document stub (null until install()). */
  document(): DocumentStub | null {
    return this.installedDocument;
  }

  private stub(key: string, value: unknown): void {
    this.saved.push({ key, descriptor: Object.getOwnPropertyDescriptor(globalThis, key) });
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  }

  private push(atMs: number, fn: () => void, everyMs: number | null): TimerId {
    const id = this.nextId++;
    this.entries.push({ id, at: atMs, seq: this.nextSeq++, fn, everyMs });
    return id;
  }

  private earliestDue(limit: number): ScheduledEntry | null {
    let best: ScheduledEntry | null = null;
    for (const e of this.entries) {
      if (e.at > limit) continue;
      if (!best || e.at < best.at || (e.at === best.at && e.seq < best.seq)) best = e;
    }
    return best;
  }
}
