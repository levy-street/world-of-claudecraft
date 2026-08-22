// Machine-readable record of the GPU-preparation escapes that used to leave
// only a console line: the reveal-gate watchdog, the gated scene-attach
// watchdog, and the compile gate's diagnostic timeout. Each of those is a
// bounded fail-soft path that hides a slow or stuck driver link, so the only
// evidence a capture could carry was a warning nobody parses. The newest kind
// is not an escape at all: `live-program` names a shader program the driver
// minted INSIDE a live frame after the reveal (live_program_watch.ts), which is
// the one thing the prep machinery could not otherwise see.
// The reveal gate also reports its SOFT deadline here, which escapes nothing
// and exists only to leave that evidence, plus lifetime counters of where the
// roots of a held key became visible. `arrival` is a lifecycle mark, not an
// escape either: one per teleport-class landing (arrival_event_core), so a
// capture can line the escapes and the build ledger up against the moment
// the camera was dropped somewhere new. `touch-unproven` is evidence too: a
// world gate's touch tail found programs under its target that no settle had
// proved (linked_program_touch_lane runWorldGateTouchLane), the
// ones a walk mark used to bless and block on; `units` carries the count.
//
// Write-only telemetry: nothing here feeds a reveal, an admission, or any
// other decision, so recording an event can never change what the renderer
// draws. The ring is bounded and the recorder allocates nothing (slots are
// pooled objects rewritten in place), because a stuck lane can fire these
// steadily for as long as it stays stuck.
//
// Host-agnostic on purpose: no Three, no DOM, and the clock is injectable so a
// test can pin an exact ageMs instead of racing a real timer.

export type GpuPrepEventKind =
  | 'reveal-watchdog'
  | 'reveal-soft-deadline'
  | 'attach-watchdog'
  | 'gate-timeout'
  | 'submit-stop'
  | 'live-program'
  | 'arrival'
  | 'touch-unproven';

export const GPU_PREP_EVENT_KINDS: readonly GpuPrepEventKind[] = [
  'reveal-watchdog',
  'reveal-soft-deadline',
  'attach-watchdog',
  'gate-timeout',
  'submit-stop',
  'live-program',
  'arrival',
  'touch-unproven',
];

/**
 * Newest events are kept; older ones fall out of the ring and only survive in
 * the lifetime counts.
 *
 * Sized from a measured capture rather than a guess. At 64 an arrival session
 * recorded 127 to 137 events, of which 89 were `reveal-soft-deadline`, and
 * they filled the ring before any other kind could reach it: the rarer kinds
 * were all dropped, so the ones that say what an arrival actually did were
 * unreadable. The fix is the ring, not a per-kind reservation: a reserved slot
 * would keep exactly one of a population of dozens, whereas the whole point is
 * the DISTRIBUTION of ages and ready/total counts across them. 160 covers that
 * session with headroom and still bounds a stuck lane's memory.
 */
export const GPU_PREP_EVENT_RING_SIZE = 160;

export interface GpuPrepEvent {
  kind: GpuPrepEventKind;
  /** What the event is about: a reveal key, a group name, a gate label. For
   *  an `arrival`: `cover` when the arrival curtain was up on the landing
   *  frame, `no-cover` when the player landed in live frames. */
  key: string;
  /** How long the target had been waiting when the escape fired. 0 for an
   *  `arrival`, which marks an instant. */
  ageMs: number;
  /** Clock reading at the fire, from the module clock. */
  atMs: number;
  /** For a multi-root reveal key: how many of its roots had linked when the
   *  escape fired, out of how many. A whole town revealed at its watchdog
   *  with 9 of 41 linked is a very different first draw from 40 of 41, and
   *  the console line could never say which. For an `arrival`, totalRoots is
   *  the imminent reveal keys still held across the registry on the landing
   *  frame (arrival_cover arrivalHeldImminentKeys) and readyRoots stays 0.
   *  0/0 for the other kinds. */
  readyRoots: number;
  totalRoots: number;
  /** Units the reporting lane had handled when the event fired. For a
   *  submit-stop that is how many compile units the boot lane submitted
   *  before the stop truncated it, which is what makes a truncated manifest
   *  attributable from the capture alone. For an `arrival`, the entity views
   *  still missing at the landing frame (the candidate scan's length). 0 for
   *  the other kinds. */
  units: number;
}

export interface GpuPrepEventInput {
  kind: GpuPrepEventKind;
  key: string;
  ageMs: number;
  readyRoots?: number;
  totalRoots?: number;
  units?: number;
}

/**
 * Lifetime totals of the reveal-gate holds, so a capture can say where the
 * roots of a held key actually became visible. The four populations partition
 * `rootsHeld`: piecewise (revealed as their own compile landed), at the reach
 * floor (shown unlinked because their colliders were at arm's length), at the
 * watchdog (still compiling when the hard escape fired), and the remainder,
 * which revealed when their key warmed.
 */
export interface GpuPrepRevealCounters {
  /** Keys that entered a hold (their compile request fired). */
  keysHeld: number;
  /** Roots behind those keys. */
  rootsHeld: number;
  /** Roots a consumer revealed before its key warmed, on their own compile. */
  rootsPiecewise: number;
  /** Roots a consumer revealed before its key warmed because they sat inside
   *  its reach floor: the only reveals that may still draw unlinked. */
  rootsReach: number;
  /** Roots still compiling when a hard watchdog revealed their key. */
  rootsAtWatchdog: number;
  /** Keys an IMMINENT consult marked (an arrival standing among streamed
   *  decor), whose compiles were therefore submitted at the imminent
   *  priority. They hold like any other key: this is not an escape count. */
  imminentHolds: number;
}

/**
 * Lifetime totals for the gates that REFUSE rather than hold: a gate whose
 * subject is a one-shot spawn cannot defer it, so the entity is simply not
 * drawn this time and its stand-in carries the moment alone. That is a fair
 * trade only while it stays rare, and nothing else in a capture could say how
 * often it fired.
 */
export interface GpuPrepGateCounters {
  /** Spirit apparitions the puppet compile gate refused to put on stage
   *  because the puppet's programs were still linking (ability_vfx/spirits).
   *  The cast's ring, burst and light pulse still play. */
  spiritSpawnsRefused: number;
}

/**
 * Which arm each portrait capture took (portrait_snapshot.ts), and how often
 * the fast one was lost.
 *
 * The capture has three arms and picks the cheapest one its host supports, so
 * a host that quietly loses the top arm just gets slower: the worker chunk
 * fails to load behind a stale hashed URL or a CSP, the latch trips, and every
 * later portrait pays the readback arm's main-thread transfer (measured at
 * 116 ms of blocking per capture on an integrated GPU, against 0). Nothing
 * else in a capture could say that happened, which is the whole reason these
 * counts exist.
 */
export interface GpuPrepPortraitCounters {
  /** Captures encoded from a transferred ImageBitmap, on the worker. */
  transferCaptures: number;
  /** Captures that fell to the fence-backed render-target readback. */
  readbackCaptures: number;
  /** Captures that fell all the way to the synchronous canvas encode. */
  canvasCaptures: number;
  /** Times the transfer arm latched off for the rest of a rig's life. */
  transferLatches: number;
  /** Times the readback arm latched off for the rest of a rig's life. */
  readbackLatches: number;
}

export interface GpuPrepEventsSnapshot {
  /** Events recorded since the last reset, across every kind. */
  total: number;
  /** Events that have already fallen out of the ring. */
  dropped: number;
  counts: Readonly<Record<GpuPrepEventKind, number>>;
  /** Oldest to newest, at most GPU_PREP_EVENT_RING_SIZE entries. */
  events: readonly Readonly<GpuPrepEvent>[];
  reveal: Readonly<GpuPrepRevealCounters>;
  gates: Readonly<GpuPrepGateCounters>;
  portraits: Readonly<GpuPrepPortraitCounters>;
}

const defaultNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

let clock: () => number = defaultNow;

/** The one clock the GPU-preparation escapes timestamp against, so a test that
 *  drives the watchdogs through a fake scheduler still gets exact ages. */
export function gpuPrepNow(): number {
  return clock();
}

export function setGpuPrepClockForTest(now: (() => number) | null): void {
  clock = now ?? defaultNow;
}

const ring: GpuPrepEvent[] = [];
let writeIndex = 0;
let total = 0;
const counts: Record<GpuPrepEventKind, number> = {
  'reveal-watchdog': 0,
  'reveal-soft-deadline': 0,
  'attach-watchdog': 0,
  'gate-timeout': 0,
  'submit-stop': 0,
  'live-program': 0,
  arrival: 0,
  'touch-unproven': 0,
};

const reveal: GpuPrepRevealCounters = {
  keysHeld: 0,
  rootsHeld: 0,
  rootsPiecewise: 0,
  rootsReach: 0,
  rootsAtWatchdog: 0,
  imminentHolds: 0,
};

const gates: GpuPrepGateCounters = {
  spiritSpawnsRefused: 0,
};

const portraits: GpuPrepPortraitCounters = {
  transferCaptures: 0,
  readbackCaptures: 0,
  canvasCaptures: 0,
  transferLatches: 0,
  readbackLatches: 0,
};

/** A non-negative finite count, so a caller's bad arithmetic cannot poison a
 *  lifetime total that a capture reads back as truth. */
const countOf = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** A non-negative finite age. Same guard as the counts, without their floor:
 *  a sub-millisecond age is real, a NaN one is not. */
const ageOf = (value: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/** One key entered a hold, with the roots the host is about to compile. */
export function noteRevealKeyHeld(rootCount: number): void {
  reveal.keysHeld++;
  reveal.rootsHeld += countOf(rootCount);
}

/** One root revealed before its key warmed, on its own compile (the
 *  piecewise policy). */
export function noteRevealRootPiecewise(): void {
  reveal.rootsPiecewise++;
}

/** One root revealed before its key warmed because it sat inside its reach
 *  floor, linked or not. */
export function noteRevealRootReach(): void {
  reveal.rootsReach++;
}

/** A hard watchdog revealed a key with this many roots still compiling. */
export function noteRevealRootsAtWatchdog(count: number): void {
  reveal.rootsAtWatchdog += countOf(count);
}

/** An imminent consult marked a key (reveal_gate_core). */
export function noteRevealImminentHold(): void {
  reveal.imminentHolds++;
}

/** The spirit compile gate refused one spawn (ability_vfx/spirits). */
export function noteSpiritSpawnRefused(): void {
  gates.spiritSpawnsRefused++;
}

/** One portrait capture took `arm` (portrait_snapshot.ts). */
export function notePortraitCaptureArm(arm: 'transfer' | 'readback' | 'canvas'): void {
  if (arm === 'transfer') portraits.transferCaptures++;
  else if (arm === 'readback') portraits.readbackCaptures++;
  else portraits.canvasCaptures++;
}

/** One arm latched off for the rest of a rig's life, so every later capture on
 *  that rig is slower than this host could have been. */
export function notePortraitArmLatched(arm: 'transfer' | 'readback'): void {
  if (arm === 'transfer') portraits.transferLatches++;
  else portraits.readbackLatches++;
}

export function recordGpuPrepEvent(event: GpuPrepEventInput): void {
  const atMs = clock();
  const ageMs = ageOf(event.ageMs);
  const readyRoots = countOf(event.readyRoots);
  const totalRoots = countOf(event.totalRoots);
  const units = countOf(event.units);
  if (ring.length < GPU_PREP_EVENT_RING_SIZE) {
    ring.push({
      kind: event.kind,
      key: event.key,
      ageMs,
      atMs,
      readyRoots,
      totalRoots,
      units,
    });
  } else {
    const slot = ring[writeIndex];
    slot.kind = event.kind;
    slot.key = event.key;
    slot.ageMs = ageMs;
    slot.atMs = atMs;
    slot.readyRoots = readyRoots;
    slot.totalRoots = totalRoots;
    slot.units = units;
  }
  writeIndex = (writeIndex + 1) % GPU_PREP_EVENT_RING_SIZE;
  counts[event.kind] += 1;
  total += 1;
}

const snapshotEvents: GpuPrepEvent[] = [];
const snapshot: GpuPrepEventsSnapshot & { events: GpuPrepEvent[] } = {
  total: 0,
  dropped: 0,
  counts,
  events: snapshotEvents,
  reveal,
  gates,
  portraits,
};

/**
 * Current counts plus the ring, oldest first. The returned object and its
 * array are module-owned and refilled by the next call (the vfx_anchor scratch
 * contract): read or copy what you need before calling again.
 */
export function gpuPrepEventsSnapshot(): GpuPrepEventsSnapshot {
  snapshotEvents.length = 0;
  const filled = ring.length;
  const oldest = filled < GPU_PREP_EVENT_RING_SIZE ? 0 : writeIndex;
  for (let i = 0; i < filled; i++) snapshotEvents.push(ring[(oldest + i) % filled]);
  snapshot.total = total;
  snapshot.dropped = total - filled;
  return snapshot;
}

export function resetGpuPrepEventsForTest(): void {
  ring.length = 0;
  snapshotEvents.length = 0;
  writeIndex = 0;
  total = 0;
  for (const kind of GPU_PREP_EVENT_KINDS) counts[kind] = 0;
  reveal.keysHeld = 0;
  reveal.rootsHeld = 0;
  reveal.rootsPiecewise = 0;
  reveal.rootsReach = 0;
  reveal.rootsAtWatchdog = 0;
  reveal.imminentHolds = 0;
  gates.spiritSpawnsRefused = 0;
  portraits.transferCaptures = 0;
  portraits.readbackCaptures = 0;
  portraits.canvasCaptures = 0;
  portraits.transferLatches = 0;
  portraits.readbackLatches = 0;
}
