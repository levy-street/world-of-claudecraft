// Main-thread orchestrator of the snapshot-fanout workers.
//
// Owns the worker lifecycle (spawn, watchdog, respawn, permanent disable
// after repeated failures), the SharedArrayBuffer mirror buffers, fragment
// delta shipping, and session-to-worker sharding. It knows nothing about the
// sim or sessions beyond the SessionJob shape: the GameServer fills the
// mirror slots (it owns the Entity semantics), pairs frames with the self
// JSON it computed at dispatch time, and sends.
//
// Fragment consistency: each worker has its own shipped-version ledger, and
// its delta is computed against the caller's authoritative fragment store at
// the moment it is actually dispatched. A worker that misses ticks (busy,
// respawned) therefore always catches up to exact current fragments before
// building anything, and a fresh worker's empty ledger makes its first delta
// the full fragment set.
//
// Skipping is safe by construction: a session that misses a dispatch (busy
// worker, dead worker, over-capacity tick) simply gets no snapshot that tick
// or an in-thread one, and the interest ladder self-heals because both paths
// only ever emit CURRENT state and only skip when the client's known
// versions match it (see interest_rules.ts).
import { Worker } from 'node:worker_threads';
import {
  createMirrorBuffers,
  type FragmentDelta,
  type FramesMessage,
  MIRROR_BUFFER_COUNT,
  MIRROR_CAPACITY,
  type MirrorBuffers,
  type SessionJob,
  type TickMessage,
} from './protocol';

export interface FanoutHost {
  deliverFrame(sid: number, tick: number, ents: string, keep: string): void;
  // Append every fragment whose (idVer, dynVer) differs from the worker's
  // ledger to `out`, updating the ledger; called per dispatched worker so a
  // catch-up or fresh worker receives everything it is missing.
  collectFragmentDeltas(ledger: Map<number, ShippedVers>, out: FragmentDelta[]): void;
  // one line per incident; the pool never throws into the tick loop
  log(line: string): void;
}

export interface ShippedVers {
  idVer: number;
  dynVer: number;
}

interface WorkerSlot {
  worker: Worker | null;
  pendingTick: number | null;
  // mirror buffer the in-flight job reads; pins that buffer against rewrite
  pendingBuffer: number | null;
  busySinceMs: number;
  respawnAtMs: number;
  failures: number;
  shipped: Map<number, ShippedVers>;
  pendingRemovals: number[];
}

// A worker that has not replied for this long is considered wedged and is
// replaced; its sessions fall back in-thread meanwhile.
const WORKER_STALL_MS = 2000;
const RESPAWN_DELAY_MS = 1000;
// After this many lifetime failures across the pool the fanout disables
// itself for the rest of the process (the in-thread path is always correct,
// just single-core).
const MAX_FAILURES = 8;

export interface DispatchResult {
  // jobs whose shard worker is DEAD (or the pool is disabled); the caller
  // builds these in-thread so nobody freezes while a worker respawns
  fallback: SessionJob[];
  // jobs whose shard worker is still building the previous tick: SKIPPED.
  // Falling back in-thread here would re-serialize the whole overloaded
  // shard on the main thread, the exact cost the pool exists to remove; a
  // session skipping a tick just coasts on interpolation until its worker
  // catches up (effective per-session cadence degrades to the worker's
  // throughput instead of stalling the sim for everyone).
  skipped: SessionJob[];
  dispatched: number;
}

export interface MirrorViews {
  index: number;
  headerI32: Int32Array;
  f64: Float64Array;
  i32: Int32Array;
}

export class SnapshotFanoutPool {
  private readonly mirrors: MirrorBuffers[] = [];
  private readonly views: MirrorViews[] = [];

  private readonly slots: WorkerSlot[] = [];
  private disabled = false;
  // lifetime counters, exposed for observability + the equivalence test's
  // non-vacuity check (frames must actually have crossed a worker)
  totalDispatched = 0;
  totalDelivered = 0;

  constructor(
    private readonly workerCount: number,
    private readonly workerPath: string,
    private readonly host: FanoutHost,
  ) {
    for (let b = 0; b < MIRROR_BUFFER_COUNT; b++) {
      const m = createMirrorBuffers();
      this.mirrors.push(m);
      this.views.push({
        index: b,
        headerI32: new Int32Array(m.header),
        f64: new Float64Array(m.f64),
        i32: new Int32Array(m.i32),
      });
    }
    for (let i = 0; i < workerCount; i++) {
      this.slots.push({
        worker: null,
        pendingTick: null,
        pendingBuffer: null,
        busySinceMs: 0,
        respawnAtMs: 0,
        failures: 0,
        shipped: new Map(),
        pendingRemovals: [],
      });
      this.spawn(i);
    }
  }

  get capacity(): number {
    return MIRROR_CAPACITY;
  }

  // A mirror buffer with no in-flight reader, for the caller to write this
  // tick's entity facts into, or null when every buffer is pinned by a slow
  // worker (the caller then skips the fanout for this tick entirely; tearing
  // a busy reader's buffer is never an option).
  acquireMirror(): MirrorViews | null {
    for (const view of this.views) {
      let pinned = false;
      for (const slot of this.slots) {
        if (slot.pendingBuffer === view.index) {
          pinned = true;
          break;
        }
      }
      if (!pinned) return view;
    }
    return null;
  }

  isEnabled(): boolean {
    return !this.disabled && this.workerCount > 0;
  }

  private failSlot(index: number, what: string, err?: unknown): void {
    const slot = this.slots[index];
    slot.worker = null;
    slot.pendingTick = null;
    slot.pendingBuffer = null;
    slot.failures++;
    slot.respawnAtMs = Date.now() + RESPAWN_DELAY_MS;
    this.host.log(`[fanout] worker ${index} ${what}${err !== undefined ? `: ${err}` : ''}`);
    if (this.slots.reduce((n, s) => n + s.failures, 0) >= MAX_FAILURES) {
      this.disabled = true;
      this.host.log('[fanout] too many worker failures; fanout disabled, in-thread path active');
      this.shutdown();
    }
  }

  private spawn(index: number): void {
    if (this.disabled) return;
    const slot = this.slots[index];
    try {
      const worker = new Worker(this.workerPath);
      worker.unref(); // never hold the process open on its own
      worker.on('message', (msg: FramesMessage) => {
        if (msg.t !== 'frames') return;
        if (slot.worker !== worker) return; // reply from a replaced worker
        slot.pendingTick = null;
        slot.pendingBuffer = null;
        this.totalDelivered += msg.frames.length;
        for (const [sid, ents, keep] of msg.frames) {
          this.host.deliverFrame(sid, msg.tick, ents, keep);
        }
      });
      worker.on('error', (err) => {
        if (slot.worker === worker) this.failSlot(index, 'errored', err);
      });
      worker.on('exit', (code) => {
        if (slot.worker === worker && code !== 0) this.failSlot(index, `exited (${code})`);
      });
      worker.postMessage({ t: 'init', mirrors: this.mirrors });
      slot.worker = worker;
      slot.pendingTick = null;
      slot.pendingBuffer = null;
      // fresh isolate: empty caches; an empty ledger makes the next delta
      // ship the complete current fragment set
      slot.shipped.clear();
      slot.pendingRemovals.length = 0;
    } catch (err) {
      this.failSlot(index, 'failed to spawn', err);
    }
  }

  // Queue fragment-cache evictions for despawned entities; each worker's
  // queue flushes with its next dispatched tick.
  noteRemovedEntities(ids: readonly number[]): void {
    if (this.disabled || ids.length === 0) return;
    for (const slot of this.slots) {
      for (const id of ids) {
        slot.shipped.delete(id);
        slot.pendingRemovals.push(id);
      }
    }
  }

  resetSession(sid: number): void {
    this.broadcastControl({ t: 'session-reset', sid });
  }

  dropSession(sid: number): void {
    this.broadcastControl({ t: 'session-drop', sid });
  }

  private broadcastControl(msg: { t: 'session-reset' | 'session-drop'; sid: number }): void {
    if (this.disabled) return;
    for (const slot of this.slots) slot.worker?.postMessage(msg);
  }

  // Split jobs across alive, idle workers by sid; hand back everything that
  // could not be dispatched. The caller has already written the acquired
  // mirror buffer (headerI32[0] = count, [1] = tick) and passes its index;
  // every dispatched job pins that buffer until the worker replies.
  dispatchTick(tick: number, bufferIndex: number, jobs: SessionJob[]): DispatchResult {
    if (this.disabled || this.workerCount === 0) {
      return { fallback: jobs, skipped: [], dispatched: 0 };
    }
    const nowMs = Date.now();
    // watchdog + respawn pass
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.worker && slot.pendingTick !== null && nowMs - slot.busySinceMs > WORKER_STALL_MS) {
        const wedged = slot.worker;
        this.failSlot(i, `stalled >${WORKER_STALL_MS}ms; replacing`);
        void wedged.terminate();
      } else if (!slot.worker && !this.disabled && nowMs >= slot.respawnAtMs) {
        this.spawn(i);
      }
    }
    if (this.disabled) return { fallback: jobs, skipped: [], dispatched: 0 };

    const perWorker: SessionJob[][] = this.slots.map(() => []);
    const fallback: SessionJob[] = [];
    const skipped: SessionJob[] = [];
    for (const job of jobs) {
      const index = job.sid % this.slots.length;
      const slot = this.slots[index];
      if (slot.worker && slot.pendingTick === null) perWorker[index].push(job);
      else if (slot.worker) skipped.push(job);
      else fallback.push(job);
    }
    let dispatched = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const mine = perWorker[i];
      if (!slot.worker || slot.pendingTick !== null) continue;
      const changed: FragmentDelta[] = [];
      this.host.collectFragmentDeltas(slot.shipped, changed);
      const removed = slot.pendingRemovals;
      // An idle worker with nothing to build and nothing to learn skips the
      // message entirely.
      if (mine.length === 0 && changed.length === 0 && removed.length === 0) continue;
      slot.pendingRemovals = [];
      const msg: TickMessage = {
        t: 'tick',
        tick,
        buffer: bufferIndex,
        changed,
        removed,
        sessions: mine,
      };
      slot.worker.postMessage(msg);
      slot.pendingTick = tick;
      slot.pendingBuffer = bufferIndex;
      slot.busySinceMs = nowMs;
      dispatched += mine.length;
      this.totalDispatched += mine.length;
    }
    return { fallback, skipped, dispatched };
  }

  shutdown(): void {
    for (const slot of this.slots) {
      const w = slot.worker;
      slot.worker = null;
      slot.pendingTick = null;
      slot.pendingBuffer = null;
      if (w) void w.terminate();
    }
  }
}
