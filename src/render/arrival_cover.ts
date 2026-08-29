// The ARRIVAL CURTAIN: the one signal saying a blocking loading screen currently
// covers the world while a teleport arrival (hearth, dungeon exit, rift exit,
// any jump into a zone that is not ready) prepares and prewarms its
// destination. Boot has always compiled the scene it lands in under such a
// cover; a mid-session arrival did not, so the streamed decor the camera lands
// among linked its programs in live frames instead.
//
// Two consumers read it, and both change only PACING, never what the
// player can see or act on:
// - the arrival chain itself, which WAITS on this registry before it lifts the
//   screen (awaitArrivalReveals): while the curtain is up a hold costs the
//   player nothing, so the decor the camera landed among is given the chance
//   to link behind the screen instead of after it,
// - the GPU-prep admission, which under the cover decides on the cover rule
//   rather than on frame headroom (gpu_prep_budget_core gpuPrepCoverAdmits):
//   the frame under a loading screen is not a frame to protect, but it is not
//   a frame to spend on boot debt either.
//
// The cover NEVER reveals anything and never shortens a hold: there is no
// wall-clock bound in the reveal machinery at all.
//
// The registry holds gates WEAKLY. A graphics rebuild mints a fresh renderer
// with fresh gates and drops the old ones, and a stale gate stuck mid-hold
// would otherwise keep reporting held keys for the rest of the session and
// make every arrival wait its whole budget out.

import { createArrivalDetector } from './arrival_event_core';
import { gpuPrepNow, recordGpuPrepEvent } from './gpu_prep_events';

/** The slice of a reveal gate the cover reads (reveal_gate_core). */
export interface ArrivalRevealGate {
  /** Keys an imminent consult marked that have not warmed yet. */
  heldImminentKeys(): number;
}

/** How often the arrival wait re-reads the gates. Fine enough that a settle
 *  costs at most one poll of curtain time, coarse enough to be free. */
export const ARRIVAL_REVEAL_POLL_MS = 50;

/** The `arrival` event keys the wait's outcome rides under (gpu_prep_events):
 *  `ageMs` is the time actually waited, `units` the bound it was given,
 *  `totalRoots` the imminent keys still held when the curtain lifted. A
 *  zero-budget wait records nothing. The perf beacon summarizes them beside
 *  the reveal counters (src/game/perf_entry_reveal_core.ts), so the fleet can
 *  read how long the establishing-shot curtain really holds. */
export const ENTRY_WAIT_EVENT_KEY = 'entry-wait';
export const ENTRY_WAIT_ESTABLISHING_EVENT_KEY = 'entry-wait:establishing-shot';

export interface ArrivalRevealWaitOptions {
  /** Clock, defaulting to the shared GPU-prep clock the gates measure on. */
  now?: () => number;
  /** Timer, defaulting to `setTimeout`. Injected by tests so a wait resolves
   *  without real time passing. */
  schedule?: (poll: () => void, ms: number) => void;
  pollMs?: number;
}

// The curtain is a DEPTH, not a flag: two independent owners raise it (the
// blocking arrival chain and the world-entry settle), and a teleport-sized
// displacement landing inside the entry settle window makes them overlap. A
// bare boolean let whichever dropped first clear the other's cover and
// un-refuse the boot-debt and background admission lanes mid-arrival.
let coverDepth = 0;
// The ESTABLISHING SHOT: the world-entry cover is about to lift on the
// first-spawn cinematic (spawn_cinematic.ts), whose opening pose is a wide,
// high view of the whole spawn village rather than the chase camera among the
// buildings. Under it every reveal consult counts as IMMINENT (reveal_gate.ts):
// what that shot sees is what the player sees first, and the entry wait
// (arrival_warmup.ts settleWorldEntryCover) is what gives it time to link.
// Set only by the entry-cover owner, read only while the cover is up.
let establishingShot = false;
const gates = new Set<WeakRef<ArrivalRevealGate>>();
// Module-level like the flag: a graphics rebuild mints a fresh renderer, and
// the player's last position is not something a rebuild should forget.
let arrivalDetector = createArrivalDetector();

/** Live gates only; dead WeakRefs are pruned as they are encountered. */
function* liveGates(): Generator<ArrivalRevealGate> {
  for (const ref of gates) {
    const gate = ref.deref();
    if (gate === undefined) {
      gates.delete(ref);
      continue;
    }
    yield gate;
  }
}

/** Every reveal gate joins on creation (reveal_gate.ts). */
export function registerRevealGateForArrival(gate: ArrivalRevealGate): void {
  gates.add(new WeakRef(gate));
}

export function arrivalCoverActive(): boolean {
  return coverDepth > 0;
}

export function setArrivalEstablishingShot(active: boolean): void {
  establishingShot = active;
}

/** True while the entry cover is up on an establishing shot: with the cover
 *  down the flag is inert, whatever its owner last wrote. */
export function arrivalEstablishingShotActive(): boolean {
  return establishingShot && coverDepth > 0;
}

/** Imminent keys still held across every registered gate. */
export function arrivalHeldImminentKeys(): number {
  let held = 0;
  for (const gate of liveGates()) held += gate.heldImminentKeys();
  return held;
}

/**
 * Raise (`true`) or drop (`false`) the curtain, counted: a raise increments
 * the depth and a drop decrements it, floored at zero so a drop that never
 * had a matching raise (a chain whose `finally` runs on a path that never
 * raised) cannot push it negative. The curtain stays up until the LAST owner
 * drops it, so overlapping owners never cut each other's cover short.
 */
export function setArrivalCover(active: boolean): void {
  if (active) coverDepth++;
  else if (coverDepth > 0) coverDepth--;
}

/**
 * Resolves once no registered gate reports an imminent key still held, or
 * after `maxMs`, whichever comes first. The caller holds the curtain up for
 * the duration, so `maxMs` is what keeps a stuck driver link from holding a
 * loading screen open forever: it bounds the WAIT, never the hold, and a key
 * still held when it expires simply stays hidden past the lift.
 *
 * The first check happens after ONE poll interval, never synchronously. A wait
 * is started by the arrival chain the moment the teleport lands, which is
 * before any cull has consulted a gate at the new position: at that instant no
 * key is held yet simply because none has been asked, so a synchronous first
 * check read "nothing held" and lifted the curtain on the frame the reveals
 * were about to be requested in. The floor stays bounded by `maxMs`, so a
 * caller that asks for no wait at all still gets none.
 */
export function awaitArrivalReveals(
  maxMs: number,
  options: ArrivalRevealWaitOptions = {},
): Promise<void> {
  const now = options.now ?? gpuPrepNow;
  const schedule =
    options.schedule ??
    ((poll: () => void, ms: number): void => {
      setTimeout(poll, ms);
    });
  const pollMs = options.pollMs ?? ARRIVAL_REVEAL_POLL_MS;
  const boundMs = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : 0;
  const startedAt = now();
  const deadline = startedAt + boundMs;
  const establishing = arrivalEstablishingShotActive();
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      if (boundMs > 0) {
        recordGpuPrepEvent({
          kind: 'arrival',
          key: establishing ? ENTRY_WAIT_ESTABLISHING_EVENT_KEY : ENTRY_WAIT_EVENT_KEY,
          ageMs: now() - startedAt,
          units: Math.round(boundMs),
          totalRoots: arrivalHeldImminentKeys(),
        });
      }
      resolve();
    };
    const poll = (): void => {
      if (arrivalHeldImminentKeys() === 0 || now() >= deadline) {
        finish();
        return;
      }
      schedule(poll, pollMs);
    };
    const firstDelay = Math.min(pollMs, deadline - now());
    if (firstDelay <= 0) {
      poll();
      return;
    }
    schedule(poll, firstDelay);
  });
}

/**
 * One teleport-class landing (arrival_event_core), recorded as an `arrival`
 * GPU-prep event so a capture can line the escapes and the build ledger up
 * against it. Reads only what this registry owns: whether the curtain was up
 * and how many imminent keys were still held. `missingViews` is the entity
 * views the landing frame still had to build.
 */
export function noteArrivalEvent(missingViews: number): void {
  recordGpuPrepEvent({
    kind: 'arrival',
    key: arrivalCoverActive() ? 'cover' : 'no-cover',
    ageMs: 0,
    units: missingViews,
    totalRoots: arrivalHeldImminentKeys(),
  });
}

/** Per-frame entry: the local player's position this frame; records the
 *  arrival event on the frame the displacement classifies as a teleport. */
export function noteArrivalIfTeleported(x: number, z: number, missingViews: number): void {
  if (arrivalDetector.observe(x, z)) noteArrivalEvent(missingViews);
}

export function resetArrivalCoverForTest(): void {
  coverDepth = 0;
  establishingShot = false;
  gates.clear();
  arrivalDetector = createArrivalDetector();
}
