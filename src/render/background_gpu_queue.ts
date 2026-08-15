// Shared priority arbiter for work that reaches WebGL. A browser idle callback
// only says when a unit may start; it does not prevent independent zone,
// texture, PMREM, archetype, and live compile lanes from starting together.
//
// Tail policy (the seam decision this file owns): by DEFAULT a unit occupies
// the queue from start until its promise settles, awaited tail included. A
// caller whose tail is dominated by a non-cancellable off-thread wait (a
// compile gate awaiting a KHR_parallel_shader_compile link, which three polls
// with a 10 ms timer and costs the main thread nothing) opts in with
// releaseTail: the queue then holds only for the synchronous prologue and the
// tail keeps settling alongside other units, bounded by the released-tail cap.
// Unconditional occupancy made one slow driver link hold every other lane for
// seconds (measured locally: a 7.5 s hold on a 2.5 ms prologue, with
// higher-priority actionable gates waiting behind it). The cap is what keeps
// the original guarantee (#2753): driver link work stays bounded, never one
// per streamed view during an online snapshot burst. Priority applies when a
// unit STARTS: a higher-priority arrival can still wait on a full cap, but
// that wait is bounded by the shortest in-flight tail instead of the whole
// serial hold, so it is never longer than the pre-release policy's.
//
// The OTHER half of the policy (hitch-hunt P1): boot-debt resume batches keep
// their tail HELD on purpose. Released tails let every debt batch's links
// pile into the driver concurrently; with a whole dropped manifest that queue
// depth made every live first draw block for seconds. One settled batch at a
// time keeps the driver link queue shallow, at the cost of a live gate
// waiting up to one debt batch's settle before it starts; the canvas
// nameplate carries the actionable channel through that wait.

// Frame cost (the metric a pacing decision is actually made on): syncMs stops
// at the work function's FIRST await, so everything a unit blocks afterwards
// books in no unit at all. That blind spot shipped: armory prewarm units
// reported 9 to 12 ms of syncMs while costing live frames 200 to 550 ms, and
// the lane read as gentle in every report while the frame said otherwise. So
// the host feeds noteFrame() once per rendered frame and each unit carries the
// longest FRAMELESS span it was in flight for, clipped to its own window. Read
// it as a coincidence measure, not a proof of cause: an ambient stall while a
// unit is HELD is charged to that unit. For a lane whose contract is "never
// cost a live frame" that is the right default, and the sync/wall pair stays
// beside it to separate a unit that blocked from one that merely spanned a bad
// moment.
//
// RELEASED TAILS are charged too, and sharedFrameGap is what keeps that honest.
// Two wrong designs were tried live before this one. Charging tails with no
// ambiguity marker put 1832 ms of frame on a live-gate unit with 1.4 ms of sync:
// released tails are the LONGEST units (seconds of driver link), so they absorb
// every unrelated block landing in their window. Excluding them instead went
// blind on the case that motivated the whole metric: the preview prewarm lane
// releases its tail while doing its REAL main-thread work there (renderer.ts
// queueSecondaryPreviewPrewarm), which is itself a misdeclaration of the
// releaseTail contract above. So every in-flight unit is charged, and each stat
// carries how many units shared the span. Read the trio (frameGapMs, syncMs,
// sharedFrameGap), never the gap alone.
//
// What this CANNOT tell you, stated plainly so nobody reads more into a number
// than it holds. The host feeds the boundary at frame START (renderer.ts sync),
// so a charged span is a whole frame PERIOD: the renderer's own work is inside
// it, the floor is one frame rather than zero, and sharedFrameGap counts only
// QUEUE units, so it can never mark a renderer-caused or GC-caused stall as
// ambiguous. `sharedFrameGap === 1` therefore means "no other queue unit was in
// flight", NOT "this unit did it". Proving cause needs an exclusive run, which
// is what a probe driving one unit at a time is for.
import { createGpuQueueWindow, type GpuQueueWindowStats } from './gpu_queue_window_core';

export const GPU_WORK_PRIORITY = {
  BOOT_RESUME: 0,
  BACKGROUND: 10,
  // Dropped-prewarm LINK/UPLOAD DEBT (prewarmResumeIsDebt in
  // prewarm_policy.ts): unpaid, it surfaces as first-draw stalls in live
  // frames, so it outranks the cosmetic BACKGROUND warmers (production
  // measured the preview lane starving it for minutes) but stays under the
  // streamed-zone prepare and every live gate.
  BOOT_DEBT: 15,
  VISIBLE_PREWARM: 20,
  LIVE_VIEW: 30,
  ACTIONABLE_VIEW: 40,
} as const;

/** Per-unit scheduling options; see the tail policy in the header. */
export interface GpuWorkRunOptions {
  /** The caller declares that everything after work()'s synchronous return is
   *  DOMINATED by an off-thread wait, so the queue may start other units while
   *  the tail settles (bounded by the released-tail cap). Only for tails the
   *  main thread is NOT doing the bulk of, e.g. a parallel shader link. A
   *  short main-thread continuation inside the tail (the compile gate chains a
   *  second compile prologue after the first link) is tolerated: it interleaves
   *  with other units like any microtask work, but it books in no unit's
   *  syncMs, so keep it small. */
  releaseTail?: boolean;
}

interface PendingGpuWork<T> {
  order: number;
  priority: number;
  label: string;
  releaseTail: boolean;
  /** Enqueue time, so a started unit can report how long it waited for its
   *  grant. `order` is a FIFO tiebreak counter, not a clock. */
  enqueuedAt: number;
  /** The tail-cap park counter as it stood at enqueue. If it has advanced by
   *  the time this unit starts, a park BEGAN while this unit waited. */
  tailCapParksAtEnqueue: number;
  /** Whether the loop was ALREADY parked on the cap at enqueue. Without this a
   *  unit that arrives mid-park and is released by that same park sees no
   *  counter advance and reports no cap wait, despite having waited on exactly
   *  that. The counter alone can confirm a cap wait but never rule one out. */
  parkedOnTailCapAtEnqueue: boolean;
  work: () => T | Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

/** One completed unit's timing. syncMs is the MAIN-THREAD block (the call up
 *  to its return, i.e. a compileAsync prologue or a whole synchronous upload);
 *  wallMs adds the awaited tail, which for an async link waits off-thread. */
export interface GpuWorkUnitStat {
  label: string;
  priority: number;
  syncMs: number;
  wallMs: number;
  atMs: number;
  /** Enqueue to start: how long this unit waited for its grant. The only place
   *  the queue's core promise (a cosmetic lane never delays an actionable one)
   *  can be observed breaking, so it is measured per unit and aggregated per
   *  priority in `recent.lanes`. Includes time parked on the released-tail cap,
   *  which is a real wait a higher-priority arrival can still take. */
  waitMs: number;
  /** Longest span this unit was in flight with NO live frame, i.e. what it
   *  actually cost the frame the lane exists to protect. Zero when the host
   *  never fed `noteFrame`. See the frame-gap note in the header for why this,
   *  and not syncMs, is the number a pacing decision is made on. */
  frameGapMs: number;
  /** Units, this one included, that were in flight at any point since the frame
   *  boundary the worst gap was measured from. Read it as "how alone was this
   *  charge", never as proof: 1 means no OTHER QUEUE UNIT was in flight, which
   *  still leaves the renderer's own frame work, GC, and any non-queue task on
   *  the main thread unaccounted for. It also inflates on a serial burst, since
   *  it counts units that started and settled before this one began (deliberate:
   *  that is how a culprit which starts AND settles inside one frameless span
   *  gets counted at all). Read the trio (frameGapMs, syncMs, sharedFrameGap)
   *  together, never frameGapMs alone. */
  sharedFrameGap: number;
}

/** The unit the drain loop is awaiting right now. Every pending unit waits
 *  either on this one or, when it is null with pending units and the released
 *  tails at the cap, on a tail slot freeing (see waitingTails). */
export interface GpuWorkActiveUnit {
  label: string;
  priority: number;
  /** Wall time since the unit started, i.e. how long it has been running. */
  ageMs: number;
  atMs: number;
}

/** A unit observed past the stall threshold. `settled: false` is the case a
 *  completed-unit ring can never show: it had still not finished when the
 *  stats were read. */
export interface GpuWorkStallStat {
  label: string;
  priority: number;
  /** Longest unsettled age observed, or the final wall time once it settled. */
  ageMs: number;
  atMs: number;
  settled: boolean;
}

/** A long grant wait, with what the waiting unit was behind. The wait alone says
 *  a lane was delayed; only these fields say BY WHAT, which is the difference
 *  between a symptom and a diagnosis. Captured at the moment the wait ends,
 *  because by then the queue still knows who it just released. */
export interface GpuWorkWaitStat {
  label: string;
  priority: number;
  waitMs: number;
  /** The unit that held the serial queue immediately before this one was
   *  granted. Null when nothing was running, which points at the tail cap
   *  below rather than at a holder. */
  blockedBy: string | null;
  blockedByPriority: number | null;
  /** True when the drain loop parked on the released-tail cap while this unit
   *  was pending. This is the mechanism a released tail can delay a live gate
   *  with while claiming to have freed the queue: releasing the tail frees the
   *  serial slot but still occupies a cap slot, and the loop refuses to START
   *  anything while the cap is full.
   *
   *  Both arms are covered, which is what makes a FALSE here meaningful: a park
   *  that BEGAN during the wait (the counter advanced) and a park already under
   *  way when the unit arrived (the flag at enqueue). The counter alone would
   *  miss the second and could then only confirm a cap wait, never rule one
   *  out, which is useless for the experiment this signal exists to settle. */
  waitedOnTailCap: boolean;
  /** The tails that HELD the cap, captured when the loop parked on it, not when
   *  the wait ended: by then the blocker has left by definition, so reading the
   *  set at grant time returns the tails that did not block anything. Empty
   *  unless `waitedOnTailCap`. Bounded by the tail limit.
   *
   *  It is the MOST RECENT park's occupants, one global snapshot, so a wait that
   *  spanned two different parks is attributed the second one's tails only. */
  tails: string[];
}

export interface BackgroundGpuQueueStats {
  units: number;
  totalSyncMs: number;
  worstSyncMs: number;
  /** Frame-gap milliseconds charged across every settled unit. CUMULATIVE on
   *  purpose: the two scalars below are running maxima, and a max only moves on
   *  a record, so a diff-based readout (the hitch forensics vector) goes silent
   *  on the second and every later occurrence of the same cost. That silence is
   *  the exact "empty diff" the metric exists to remove, so a diff consumer
   *  watches this one. */
  totalFrameGapMs: number;
  /** Worst frame gap any settled unit was in flight for, shared or not. */
  worstFrameGapMs: number;
  /** The same, restricted to gaps NO other unit shared. This is the arm an
   *  attribution readout should watch: the shared one rises whenever anything
   *  at all stalls a frame while any unit happens to be in flight, so a diff
   *  built on it prints a queue dimension moving for hitches the queue did not
   *  cause, inside the very tool used to find the cause.
   *
   *  Its BLIND SPOT, stated because the rest of these docs are careful about
   *  what a number cannot tell you: `overlappingUnits` only resets in
   *  noteFrame, so in a BURST with no frame between units (world entry, which
   *  is where the prewarm hitches live) only the FIRST unit is charged
   *  unshared; every later one counts its predecessors and is marked shared.
   *  So this field reports the first unit of a burst, which is rarely the worst
   *  one. It is not inert there, but it is not a ranking either: read
   *  `blockiest` with its trio. Pinned by the boot-burst case in the suite. */
  worstUnsharedFrameGapMs: number;
  /** Slowest units by sync slice, worst first, bounded. */
  slowest: GpuWorkUnitStat[];
  /** Units in flight across a frame boundary, worst frame gap first, bounded.
   *  A SEPARATE ranking from `slowest` on purpose: the units that motivated
   *  this metric reported 9 to 12 ms of syncMs while costing 200 to 550 ms of
   *  frame, so they could never surface in a sync-ordered list. Note the
   *  membership rule is "cost a frame boundary", not "cost a frame": the host
   *  feeds `noteFrame` at frame START, so the measured span includes the frame
   *  PERIOD and the floor is one frame (about 16.7 ms at 60 Hz), not zero. */
  blockiest: GpuWorkUnitStat[];
  /** Units not started yet, waiting on the running unit or on the
   *  released-tail cap: the backlog a wedge accumulates. */
  pending: number;
  /** The unit holding the drain loop, or null when nothing does. A released
   *  tail is NOT active: it appears in waitingTails until it settles. */
  active: GpuWorkActiveUnit | null;
  /** Released tails still settling. When pending grows with active null and
   *  this list full, the released-tail cap is what the queue is waiting on. */
  waitingTails: GpuWorkActiveUnit[];
  /** Every unit seen past the stall threshold, including evicted records. A
   *  non-zero count is not by itself a wedged queue: a long hold that ended
   *  counts too. A wedge is an unsettled stall plus a live unit naming it:
   *  either `active`, or a `waitingTails` entry for a released tail. */
  stallCount: number;
  /** Most recent stalls, bounded. */
  stalls: GpuWorkStallStat[];
  /** Worst grant latency any unit waited, session-wide. The windowed arm below
   *  rolls, so this keeps a long session's record from vanishing with it. */
  worstWaitMs: number;
  /** Longest grant waits, worst first, bounded, each naming what it was behind.
   *  A SEPARATE ranking from the two cost lists: a unit can wait a long time
   *  while costing nothing itself, and that is precisely the priority-inversion
   *  shape, so it can never surface in a cost-ordered list. */
  longestWaits: GpuWorkWaitStat[];
  /** The RECENT interval, per priority lane. Every other field on this object is
   *  cumulative or a lifetime maximum; this one is the only arm two runs of a
   *  pacing experiment can be compared on. See gpu_queue_window_core.ts. */
  recent: GpuQueueWindowStats;
}

export interface BackgroundGpuQueue {
  run<T>(
    work: () => T | Promise<T>,
    priority?: number,
    label?: string,
    options?: GpuWorkRunOptions,
  ): Promise<T>;
  /** Feed the LIVE FRAME clock, once per rendered frame. Without it the queue
   *  can only measure itself; with it, every unit carries what it cost the
   *  frame. Cheap by design (one subtraction plus the in-flight set), and
   *  entirely optional: a headless host that never calls it just reports zero. */
  noteFrame(atMs: number): void;
  /** Per-unit timing plus the running unit: names which lane's units block the
   *  main thread, and which one is currently blocking the whole queue. */
  stats(): BackgroundGpuQueueStats;
  /** Reject queued work, stop accepting more, and await the active unit plus
   *  any released tails still settling. */
  shutdown(reason?: Error): Promise<void>;
}

const DEFAULT_SLOWEST_LIMIT = 20;
// Low on purpose, because a hold this long is worth seeing whether or not it
// ends. A live compile gate waiting out a non-cancellable driver link really
// does occupy the serial queue for seconds (a local run measured 7.5 s on a
// unit that cost 2.5 ms of main-thread time), and every other lane waits behind
// it. Those records settle; a wedge is the record that never does.
const DEFAULT_STALL_MS = 4000;
const DEFAULT_STALL_LIMIT = 8;
// Concurrent released tails, i.e. driver links settling while the queue keeps
// draining. 2 keeps a second gate flowing past one slow link while holding the
// snapshot-burst bound: with the running unit's own prologue, at most 3 units'
// driver work can be in flight at any instant, never one per streamed view.
const DEFAULT_TAIL_LIMIT = 2;
// A frame-to-frame span longer than this is a DISCONTINUITY, not a cost: a
// hidden tab (rAF stops entirely), a paused debugger, a machine suspend. Set
// above the stall threshold on purpose, so nothing real is lost by ignoring it:
// a unit that genuinely holds the main thread this long is already reported by
// the stall machinery, which has no such cap.
const DEFAULT_FRAME_GAP_IGNORE_MS = 5000;

interface RunningGpuWork {
  entry: PendingGpuWork<unknown>;
  startedAt: number;
  /** Grant latency, resolved once at start: startedAt minus entry.enqueuedAt. */
  waitMs: number;
  stall: GpuWorkStallStat | null;
  /** Worst frameless span observed while this unit was in flight. */
  worstFrameGapMs: number;
  /** Units in flight when that worst span was charged, this one included. */
  worstFrameGapShared: number;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

const reportUnit = (stat: GpuWorkUnitStat): GpuWorkUnitStat => ({
  ...stat,
  syncMs: round1(stat.syncMs),
  wallMs: round1(stat.wallMs),
  atMs: Math.round(stat.atMs),
  waitMs: round1(stat.waitMs),
  frameGapMs: round1(stat.frameGapMs),
  sharedFrameGap: stat.sharedFrameGap,
});

export function createBackgroundGpuQueue(opts?: {
  now?: () => number;
  slowestLimit?: number;
  stallMs?: number;
  stallLimit?: number;
  tailLimit?: number;
  frameGapIgnoreMs?: number;
  recentWindowMs?: number;
  recentSampleLimit?: number;
}): BackgroundGpuQueue {
  const now = opts?.now ?? ((): number => performance.now());
  const slowestLimit = Math.max(1, opts?.slowestLimit ?? DEFAULT_SLOWEST_LIMIT);
  const stallMs = Math.max(1, opts?.stallMs ?? DEFAULT_STALL_MS);
  const stallLimit = Math.max(1, opts?.stallLimit ?? DEFAULT_STALL_LIMIT);
  const tailLimit = Math.max(1, opts?.tailLimit ?? DEFAULT_TAIL_LIMIT);
  const frameGapIgnoreMs = Math.max(1, opts?.frameGapIgnoreMs ?? DEFAULT_FRAME_GAP_IGNORE_MS);
  const pending: PendingGpuWork<unknown>[] = [];
  const slowest: GpuWorkUnitStat[] = [];
  const blockiest: GpuWorkUnitStat[] = [];
  const stalls: GpuWorkStallStat[] = [];
  const longestWaits: GpuWorkWaitStat[] = [];
  const waitingTails = new Set<RunningGpuWork>();
  const recent = createGpuQueueWindow({
    windowMs: opts?.recentWindowMs,
    sampleLimit: opts?.recentSampleLimit,
  });
  let units = 0;
  let totalSyncMs = 0;
  let worstSyncMs = 0;
  let worstWaitMs = 0;
  let tailCapParks = 0;
  // True while the drain loop is parked waiting for a cap slot. Read at enqueue
  // so a unit arriving mid-park is attributed the wait it really had.
  let parkedOnTailCap = false;
  // Snapshot of the cap's occupants the last time the loop parked on it. See the
  // `tails` field note for why the park, and not the grant, is the capture point.
  let lastCapOccupants: string[] = [];
  // The unit that most recently held the serial queue. A unit granted after a
  // wait was, by construction, waiting on this one.
  let lastHolderLabel: string | null = null;
  let lastHolderPriority: number | null = null;
  let worstFrameGapMs = 0;
  let worstUnsharedFrameGapMs = 0;
  let totalFrameGapMs = 0;
  let lastFrameAt: number | null = null;
  // Distinct units in flight at ANY point since the last frame, which is what
  // sharedFrameGap must report: counting at the instant of the charge instead
  // misses a unit that started AND settled inside the span, and that unit is
  // exactly the one likeliest to have caused it.
  let overlappingUnits = 0;
  let stallCount = 0;
  let running: RunningGpuWork | null = null;
  let active = false;
  let accepting = true;
  let nextOrder = 0;
  let tailNotify: (() => void) | null = null;
  let shutdownReason: Error | null = null;
  let shutdownPromise: Promise<void> | null = null;
  let resolveShutdown: (() => void) | null = null;

  // A unit that never settles has no completion callback to record it, so the
  // threshold is evaluated wherever the queue is observed instead: at every
  // stats() read while the unit is still running, and once more if it settles.
  const noteStall = (unit: RunningGpuWork, ageMs: number): void => {
    if (ageMs < stallMs) return;
    if (unit.stall) {
      if (ageMs > unit.stall.ageMs) unit.stall.ageMs = ageMs;
      return;
    }
    stallCount++;
    unit.stall = {
      label: unit.entry.label,
      priority: unit.entry.priority,
      ageMs,
      atMs: unit.startedAt,
      settled: false,
    };
    stalls.push(unit.stall);
    if (stalls.length > stallLimit) stalls.shift();
  };

  /** Widen a unit's worst frameless span to cover [from, to], clipped to the
   *  part it was actually in flight for, so a stall that began before it
   *  started is not charged to it. */
  const widenFrameGap = (unit: RunningGpuWork, from: number, to: number, shared: number): void => {
    const raw = to - Math.max(from, unit.startedAt);
    if (raw <= 0) return;
    // CLAMPED past the cap, never dropped. Dropping made the metric non-monotone
    // in badness: a genuine 6 s block reported 0, stayed out of `blockiest`
    // entirely, and left a smaller 400 ms span holding the record. Clamping stops
    // a discontinuity inventing minutes of frame cost without ever turning the
    // worst offender into the best-looking one.
    const overlap = Math.min(raw, frameGapIgnoreMs);
    if (overlap <= unit.worstFrameGapMs) return;
    unit.worstFrameGapMs = overlap;
    unit.worstFrameGapShared = shared;
  };

  /** Called once per unit, at the moment its wait ends. Bounded top-N by wait,
   *  membership gated on a wait that actually happened: a unit granted instantly
   *  is not "the least delayed one", it is simply not a member. */
  const recordWait = (unit: RunningGpuWork): void => {
    if (round1(unit.waitMs) <= 0) return;
    const waitedOnTailCap =
      unit.entry.parkedOnTailCapAtEnqueue || tailCapParks > unit.entry.tailCapParksAtEnqueue;
    const stat: GpuWorkWaitStat = {
      label: unit.entry.label,
      priority: unit.entry.priority,
      waitMs: unit.waitMs,
      blockedBy: lastHolderLabel,
      blockedByPriority: lastHolderPriority,
      waitedOnTailCap,
      tails: waitedOnTailCap ? [...lastCapOccupants] : [],
    };
    let index = longestWaits.length;
    while (index > 0 && longestWaits[index - 1].waitMs < stat.waitMs) index--;
    longestWaits.splice(index, 0, stat);
    if (longestWaits.length > slowestLimit) longestWaits.length = slowestLimit;
  };

  const recordUnit = (unit: RunningGpuWork, syncMs: number): void => {
    units++;
    totalSyncMs += syncMs;
    if (syncMs > worstSyncMs) worstSyncMs = syncMs;
    const settledAt = now();
    const wallMs = settledAt - unit.startedAt;
    // The settle-time term, and the one that catches the common shape: a unit
    // blocks the main thread and finishes BEFORE the next frame runs, so no
    // noteFrame call ever lands inside its window and the mid-flight term above
    // sees nothing at all. `overlappingUnits` already counts this
    // unit: it was incremented at start and is only reset per frame. (Not "the
    // unit is off both lists": on the detachTail path with a synchronously
    // settling thenable, `running` still points at it here.)
    if (lastFrameAt !== null) widenFrameGap(unit, lastFrameAt, settledAt, overlappingUnits);
    noteStall(unit, wallMs);
    if (unit.stall) unit.stall.settled = true;
    const stat: GpuWorkUnitStat = {
      label: unit.entry.label,
      priority: unit.entry.priority,
      syncMs,
      wallMs,
      atMs: unit.startedAt,
      waitMs: unit.waitMs,
      frameGapMs: unit.worstFrameGapMs,
      sharedFrameGap: unit.worstFrameGapShared,
    };
    if (stat.waitMs > worstWaitMs) worstWaitMs = stat.waitMs;
    // Keyed on SETTLE time, not stat.atMs (the start): released tails settle out
    // of start order, so a start-keyed window would be unsorted and its prune
    // would strand old samples. See the field's own note in the core.
    recent.record({
      priority: stat.priority,
      waitMs: stat.waitMs,
      syncMs: stat.syncMs,
      frameGapMs: stat.frameGapMs,
      settledAtMs: settledAt,
    });
    totalFrameGapMs += stat.frameGapMs;
    if (stat.frameGapMs > worstFrameGapMs) worstFrameGapMs = stat.frameGapMs;
    if (stat.sharedFrameGap <= 1 && stat.frameGapMs > worstUnsharedFrameGapMs) {
      worstUnsharedFrameGapMs = stat.frameGapMs;
    }
    let index = slowest.length;
    while (index > 0 && slowest[index - 1].syncMs < stat.syncMs) index--;
    slowest.splice(index, 0, stat);
    if (slowest.length > slowestLimit) slowest.length = slowestLimit;
    // A unit that cost no frame is not "the least blocking one", it is simply
    // not a member: keeping it out is what makes a short list readable.
    if (round1(stat.frameGapMs) > 0) {
      let blockIndex = blockiest.length;
      while (blockIndex > 0 && blockiest[blockIndex - 1].frameGapMs < stat.frameGapMs) blockIndex--;
      blockiest.splice(blockIndex, 0, stat);
      if (blockiest.length > slowestLimit) blockiest.length = slowestLimit;
    }
  };

  const settleShutdownIfIdle = (): void => {
    if (accepting || active || pending.length > 0 || waitingTails.size > 0) return;
    resolveShutdown?.();
    resolveShutdown = null;
  };

  // Moves a released unit's settling tail out of the drain loop's way. The
  // unit's promise still resolves only when ITS tail settles (a gated view is
  // revealed no earlier than before); only the queue occupancy changes.
  const detachTail = (unit: RunningGpuWork, syncMs: number, tail: PromiseLike<unknown>): void => {
    waitingTails.add(unit);
    let settled = false;
    const settle = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      waitingTails.delete(unit);
      // Clear the park flag HERE, synchronously with the slot freeing, not in
      // the drain loop's continuation. complete() below resolves the unit's
      // public promise, and a reaction to that promise runs as a microtask
      // BEFORE the parked loop resumes: a unit enqueued from such a reaction
      // would otherwise capture parkedOnTailCapAtEnqueue true and be reported
      // as having waited on a cap that had already released it, with the stale
      // occupants to match.
      if (waitingTails.size < tailLimit) parkedOnTailCap = false;
      recordUnit(unit, syncMs);
      complete();
      const notify = tailNotify;
      tailNotify = null;
      notify?.();
      // The drain loop may have exited while this tail was still settling.
      settleShutdownIfIdle();
    };
    // A real Promise's then never throws, but the queue accepts any thenable:
    // a synchronously-throwing then must not leak the unit's cap slot.
    try {
      void tail.then(
        (value) => settle(() => unit.entry.resolve(value)),
        (error) => settle(() => unit.entry.reject(error)),
      );
    } catch (error) {
      settle(() => unit.entry.reject(error));
    }
  };

  const drain = async (): Promise<void> => {
    while (pending.length > 0) {
      // The released-tail cap gates STARTING units, so the bound covers the
      // running unit's own driver work too: at most tailLimit + 1 units'
      // driver work can be in flight at any instant.
      while (waitingTails.size >= tailLimit) {
        // Counted, not just awaited: this park is the one way a RELEASED tail
        // still delays a higher-priority arrival, and without the count a long
        // wait cannot be told apart from waiting behind an ordinary holder.
        tailCapParks++;
        lastCapOccupants = [...waitingTails].map((tail) => tail.entry.label);
        parkedOnTailCap = true;
        try {
          await new Promise<void>((resolve) => {
            tailNotify = resolve;
          });
        } finally {
          // Backstop only: the settle path above clears this the moment a slot
          // frees. This covers the paths that leave the park without one
          // (shutdown), and re-clearing is idempotent.
          parkedOnTailCap = false;
        }
      }
      // shutdown() splices pending while the loop is parked on the cap wait
      // above: re-check emptiness before selecting, or the resumed iteration
      // dereferences a unit that no longer exists.
      if (pending.length === 0) break;
      let selectedIndex = 0;
      for (let index = 1; index < pending.length; index++) {
        const candidate = pending[index];
        const selected = pending[selectedIndex];
        if (
          candidate.priority > selected.priority ||
          (candidate.priority === selected.priority && candidate.order < selected.order)
        ) {
          selectedIndex = index;
        }
      }
      const [next] = pending.splice(selectedIndex, 1);
      const startedAt = now();
      const unit: RunningGpuWork = {
        entry: next,
        startedAt,
        waitMs: Math.max(0, startedAt - next.enqueuedAt),
        stall: null,
        worstFrameGapMs: 0,
        worstFrameGapShared: 0,
      };
      overlappingUnits++;
      running = unit;
      // Before overwriting the holder: this unit waited on whoever held it last.
      recordWait(unit);
      lastHolderLabel = next.label;
      lastHolderPriority = next.priority;
      let syncMs = 0;
      let released = false;
      try {
        const returned = next.work();
        syncMs = now() - unit.startedAt;
        if (
          next.releaseTail &&
          returned !== null &&
          typeof returned === 'object' &&
          typeof (returned as PromiseLike<unknown>).then === 'function'
        ) {
          released = true;
          detachTail(unit, syncMs, returned as PromiseLike<unknown>);
        } else {
          next.resolve(await returned);
        }
      } catch (error) {
        if (syncMs === 0) syncMs = now() - unit.startedAt;
        next.reject(error);
      } finally {
        running = null;
        if (!released) recordUnit(unit, syncMs);
      }
    }
    active = false;
    // Nothing holds the queue any more, so the next unit to wait waited on the
    // TAIL CAP or on a scheduling hop, not on a holder. Without this reset the
    // null branch of blockedBy is unreachable after the first unit of the
    // session and the readout names a unit that settled arbitrarily long ago:
    // a diagnostic accusing an innocent unit, inside the tool built to stop
    // exactly that.
    lastHolderLabel = null;
    lastHolderPriority = null;
    // A run() call can land after the loop observes an empty queue but before
    // this async continuation clears active. Start another drain in that case.
    if (pending.length > 0) scheduleDrain();
    else settleShutdownIfIdle();
  };

  const scheduleDrain = (): void => {
    if (active) return;
    active = true;
    void Promise.resolve().then(drain);
  };

  return {
    run<T>(
      work: () => T | Promise<T>,
      priority = GPU_WORK_PRIORITY.BACKGROUND,
      label = 'unlabeled',
      options?: GpuWorkRunOptions,
    ): Promise<T> {
      if (!accepting) {
        return Promise.reject(shutdownReason ?? new Error('Background GPU queue is shut down'));
      }
      const result = new Promise<T>((resolve, reject) => {
        pending.push({
          order: nextOrder++,
          priority,
          label,
          releaseTail: options?.releaseTail === true,
          enqueuedAt: now(),
          tailCapParksAtEnqueue: tailCapParks,
          parkedOnTailCapAtEnqueue: parkedOnTailCap,
          work,
          resolve,
          reject,
        } as PendingGpuWork<unknown>);
      });
      scheduleDrain();
      return result;
    },
    noteFrame(atMs: number): void {
      const previous = lastFrameAt;
      lastFrameAt = atMs;
      const inFlight = (running ? 1 : 0) + waitingTails.size;
      if (previous === null) {
        // The FIRST frame still resets the counter. World entry pushes dozens of
        // units through the queue before requestAnimationFrame is ever armed
        // (src/main.ts arms it at the end of startGame), so returning early here
        // left every one of them folded into `overlappingUnits` for the rest of
        // the session and made every later charge read as shared. Boot is the
        // window the prewarm hitches actually live in.
        overlappingUnits = inFlight;
        return;
      }
      if (inFlight === 0) {
        overlappingUnits = 0;
        return;
      }
      // Charged to EVERY unit in flight, released tails included, and the
      // sharedFrameGap count is what keeps that honest. Excluding tails was
      // tried and is wrong: the preview prewarm lane releases its tail while
      // doing its real work there (renderer.ts queueSecondaryPreviewPrewarm),
      // so tail-blind attribution goes silent on the exact misuse this metric
      // exists to expose.
      const shared = overlappingUnits;
      if (running) widenFrameGap(running, previous, atMs, shared);
      for (const tail of waitingTails) widenFrameGap(tail, previous, atMs, shared);
      // Whatever is still in flight carries into the next interval.
      overlappingUnits = inFlight;
    },
    stats(): BackgroundGpuQueueStats {
      let activeUnit: GpuWorkActiveUnit | null = null;
      if (running) {
        const ageMs = now() - running.startedAt;
        noteStall(running, ageMs);
        activeUnit = {
          label: running.entry.label,
          priority: running.entry.priority,
          ageMs: round1(ageMs),
          atMs: Math.round(running.startedAt),
        };
      }
      const tailUnits: GpuWorkActiveUnit[] = [];
      for (const tail of waitingTails) {
        const ageMs = now() - tail.startedAt;
        noteStall(tail, ageMs);
        tailUnits.push({
          label: tail.entry.label,
          priority: tail.entry.priority,
          ageMs: round1(ageMs),
          atMs: Math.round(tail.startedAt),
        });
      }
      return {
        units,
        totalSyncMs: round1(totalSyncMs),
        worstSyncMs: round1(worstSyncMs),
        totalFrameGapMs: round1(totalFrameGapMs),
        worstFrameGapMs: round1(worstFrameGapMs),
        worstUnsharedFrameGapMs: round1(worstUnsharedFrameGapMs),
        slowest: slowest.map(reportUnit),
        blockiest: blockiest.map(reportUnit),
        pending: pending.length,
        active: activeUnit,
        waitingTails: tailUnits,
        stallCount,
        stalls: stalls.map((stall) => ({
          ...stall,
          ageMs: round1(stall.ageMs),
          atMs: Math.round(stall.atMs),
        })),
        worstWaitMs: round1(worstWaitMs),
        longestWaits: longestWaits.map((wait) => ({
          ...wait,
          waitMs: round1(wait.waitMs),
          tails: [...wait.tails],
        })),
        recent: recent.stats(now()),
      };
    },
    shutdown(reason = new Error('Background GPU queue is shut down')): Promise<void> {
      if (shutdownPromise) return shutdownPromise;
      accepting = false;
      shutdownReason = reason;
      for (const entry of pending.splice(0)) entry.reject(reason);
      shutdownPromise = new Promise<void>((resolve) => {
        resolveShutdown = resolve;
      });
      settleShutdownIfIdle();
      return shutdownPromise;
    },
  };
}
