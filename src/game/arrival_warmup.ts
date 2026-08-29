// The BLOCKING arrival: a teleport-sized jump (hearth, dungeon exit, rift exit,
// a dev teleport) into a zone the renderer has not built yet keeps the classic
// loading screen up while the destination and its neighbourhood stream in,
// rather than dropping the player into a void (src/game/zone_transition.ts
// classifies which entries land here).
//
// The screen is a CURTAIN, so this module treats it as one, exactly like boot:
// it raises the arrival cover for the whole chain, which puts the GPU-prep
// queue on the cover admission rule (everything the camera is arriving at, no
// boot debt and no background warmers), waits a bounded moment for the streamed
// decor the camera landed among to finish linking, and only then marks the
// reveal and lifts the screen. Without that wait the decor stayed hidden into
// the live frames after the lift and linked its programs there, which is the
// stall the curtain was there to hide in the first place.
//
// main.ts is a firewall: it owns the frame loop state (the input flag and the
// tick accumulator, restored through `onRevealed`) and nothing else here.

import {
  awaitArrivalReveals as awaitRevealsDefault,
  setArrivalEstablishingShot,
  setArrivalCover as setCoverDefault,
} from '../render/arrival_cover';
import { afterActiveAnimationMs as afterActiveAnimationMsDefault } from './active_animation_timer';
import { worldEntryGpuSettleCoverMs } from './ui_effects_profile';

/**
 * How long the curtain waits for the arrival's held reveals, OFFLINE. Long
 * enough for a town kit's links on an integrated GPU, short enough that a
 * stuck driver cannot hold a loading screen open on a player who is already
 * home: past it the screen lifts and whatever is still held stays hidden until
 * its own compile lands (there is no wall-clock reveal bound). ONLINE the wait
 * is zero (`arrivalRevealSettleMaxMs`): the character is live on the
 * authoritative server while the screen is up, so no cosmetic GPU-settle wait
 * may hold movement past the structural prepare (ui_effects_profile.ts
 * worldEntryGpuSettleCoverMs states the same rule for the entry cover); the
 * cover still puts the admission on its arrival rule for the prepare's own
 * duration, and whatever is unlinked at the lift keeps linking behind the
 * reach floors.
 *
 * The ONE online exception is the entry that opens on the first-spawn
 * cinematic's ESTABLISHING SHOT (arrival_cover.ts): a level-1 character's
 * first seconds are that wide view of the village, nothing is actionable
 * while the cinematic runs, and the curtain lifting on a village still
 * revealing piecewise is the only thing that shot can show. That entry waits
 * longer, online and offline alike: the town-kit bound below was sized for
 * the decor a chase camera lands among, while the opening view marks the
 * whole village imminent, and the offline probe still showed the village
 * linking after a 3 s wait. Six seconds is the maintainer's call on the
 * trade (a longer first loading screen on a slow machine, once per new
 * character, against a cinematic that pops), between the town-kit bound and
 * the reveal watchdog past which nothing can still be held. Both are bounds
 * on the WAIT: what is held past them lifts with the curtain and reveals as
 * its own compile lands.
 */
export const ARRIVAL_REVEAL_SETTLE_MAX_MS = 3_000;
export const ESTABLISHING_SHOT_REVEAL_SETTLE_MAX_MS = 6_000;

export function arrivalRevealSettleMaxMs(online: boolean, establishingShot = false): number {
  if (establishingShot) return ESTABLISHING_SHOT_REVEAL_SETTLE_MAX_MS;
  return online ? 0 : ARRIVAL_REVEAL_SETTLE_MAX_MS;
}

/** The loading-screen strings this chain renders. */
export type ArrivalWarmupTextKey =
  | 'loading.world'
  | 'loading.enteringWorld'
  | 'loading.rendererFailed';

/** The renderer slice a blocking arrival drives. */
export interface ArrivalWarmupRenderer {
  prepareZoneAt(
    x: number,
    z: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<unknown>;
  prepareZonesAround(
    x: number,
    z: number,
    radiusYd: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<unknown>;
  prewarmZoneAt(x: number, z: number): Promise<unknown>;
  markGpuHitchReveal(): void;
}

/** The loading-screen slice, all owned by main.ts. */
export interface ArrivalWarmupUi {
  showLoadingScreen(statusText: string): void;
  setLoadingProgressRange(done: number, total: number, from: number, to: number): void;
  setLoadingPercent(percent: number, statusText: string): void;
  hideLoadingScreen(): void;
  nextPaint(): Promise<void>;
  fatalOverlay(message: string): void;
}

export interface BlockingArrivalWarmupDeps {
  renderer: ArrivalWarmupRenderer;
  ui: ArrivalWarmupUi;
  /** The i18n lookup, narrowed to the keys this chain renders, so the module
   *  stays language-agnostic without widening main.ts's typed `t`. */
  t: (key: ArrivalWarmupTextKey, values?: Record<string, string | number>) => string;
  technicalErrorMessage: (error: unknown) => string;
  zoneX: number;
  zoneZ: number;
  /** An online character is live on the server while the screen is up: no
   *  cosmetic settle wait (see arrivalRevealSettleMaxMs). */
  online: boolean;
  /** How far around the arrival point to stream behind the same screen. A
   *  rift exit passes a wider radius: the instance band sits outside the
   *  overworld, so the whole ring around the exit may have been evicted. */
  neighborRadiusYd: number;
  /** The screen has lifted: restore input and reset the frame clock. */
  onRevealed: () => void;
  /** The chain is over, however it ended. Required: it carries main.ts's
   *  reentrancy guard (it clears the in-flight warmup), and a chain that
   *  forgot it would wedge every later arrival. */
  onSettled: () => void;
  /** Hold (true) or release (false) the world draw while the screen is up:
   *  held from the landing frame, released once the reveals have settled so
   *  the paint before the lift already shows the destination (see
   *  presentation_gate.ts, worldDrawHeld). Released again when the chain ends,
   *  however it ended, so a failed arrival never leaves the world undrawn.
   *  Required: it is the only release of the hold. */
  holdWorldDraw: (held: boolean) => void;
  /** Injected by tests; defaults to the real arrival cover. */
  setCover?: (active: boolean) => void;
  awaitReveals?: (maxMs: number) => Promise<void>;
}

/**
 * Run one blocking arrival. Returns the promise main.ts holds as its in-flight
 * warmup, so a second arrival cannot start on top of this one.
 */
export function runBlockingArrivalWarmup(deps: BlockingArrivalWarmupDeps): Promise<void> {
  const { renderer, ui, t, zoneX, zoneZ } = deps;
  const setCover = deps.setCover ?? setCoverDefault;
  const awaitReveals = deps.awaitReveals ?? awaitRevealsDefault;
  // The raise sits in its own try: a synchronous throw out of it (a broken
  // loading screen, a broken cover) happens before the promise chain exists,
  // so nothing downstream would ever release the hold or drop the curtain.
  // Undo exactly what went up, then let the caller see the failure.
  let raised = false;
  let held = false;
  try {
    ui.showLoadingScreen(t('loading.world'));
    setCover(true);
    raised = true;
    // Marked BEFORE the call: a hold that threw halfway is still a hold that
    // may be up, and only what was raised is undone (a blind drop would
    // decrement the world-entry owner's cover depth instead of this chain's).
    held = true;
    deps.holdWorldDraw(true);
  } catch (err) {
    if (held) {
      try {
        deps.holdWorldDraw(false);
      } catch (releaseErr) {
        console.warn('Arrival world-draw release failed', releaseErr);
      }
    }
    if (raised) setCover(false);
    throw err;
  }
  return (
    ui
      .nextPaint()
      .then(() =>
        renderer.prepareZoneAt(zoneX, zoneZ, (done, total) =>
          ui.setLoadingProgressRange(done, total, 0, 55),
        ),
      )
      .then(() =>
        renderer.prepareZonesAround(zoneX, zoneZ, deps.neighborRadiusYd, (done, total) =>
          ui.setLoadingProgressRange(done, total, 55, 94),
        ),
      )
      // An arrival with no overworld neighbourhood at all (a dungeon or rift
      // interior, 99k yards off the strip) reports no progress above, so fill
      // the band explicitly rather than letting the bar sit at 55.
      .then(() => ui.setLoadingProgressRange(1, 1, 55, 94))
      .then(async () => {
        ui.setLoadingPercent(96, t('loading.enteringWorld'));
        try {
          await renderer.prewarmZoneAt(zoneX, zoneZ);
        } catch (err) {
          console.warn('Zone shader prewarm failed', err);
        }
        await awaitReveals(arrivalRevealSettleMaxMs(deps.online));
        renderer.markGpuHitchReveal();
        deps.holdWorldDraw(false);
      })
      .then(() => ui.setLoadingPercent(100, t('loading.enteringWorld')))
      .then(() => ui.nextPaint())
      .then(() => {
        ui.hideLoadingScreen();
        deps.onRevealed();
      })
      .catch((err) => {
        ui.fatalOverlay(t('loading.rendererFailed', { error: deps.technicalErrorMessage(err) }));
      })
      .finally(() => {
        // Never leave the cover raised: it holds the GPU-prep admission on the
        // arrival rule, and a stuck flag would keep the boot-debt and
        // background lanes refused for the rest of the session.
        deps.holdWorldDraw(false);
        setCover(false);
        deps.onSettled();
      })
  );
}

/**
 * The WORLD-ENTRY cover, the boot's twin of the blocking arrival: the band
 * reveal gate arms at the end of the initial prewarm, still under the entry
 * curtain, and the bands and town the camera stands among consult as IMMINENT
 * on the first frames, so their compiles go to the front of the reveal lane.
 * Raising the arrival cover here puts the admission on its arrival rule for as
 * long as the curtain is up, so those compiles and their tail pieces are what
 * the covered frames run. `settleMs` is the existing GPU-settle cover (zero
 * online, per the same live-character rule); the offline reveal also waits,
 * bounded, for the imminent held keys, and so does an entry that opens on the
 * cinematic's establishing shot (`establishingShot`), online included: for as
 * long as this cover is up, every reveal consult is imminent (arrival_cover.ts
 * arrivalEstablishingShotActive), so the wait covers what that shot sees.
 */
export function settleWorldEntryCover(deps: {
  adaptiveBudget: boolean;
  constrainedMemory: boolean;
  online: boolean;
  /** The curtain lifts on the first-spawn cinematic's wide opening view. */
  establishingShot?: boolean;
  revealWorld: () => void;
  afterActiveAnimationMs?: (ms: number, callback: () => void) => void;
  setCover?: (active: boolean) => void;
  awaitReveals?: (maxMs: number) => Promise<void>;
}): void {
  const setCover = deps.setCover ?? setCoverDefault;
  const awaitReveals = deps.awaitReveals ?? awaitRevealsDefault;
  const afterActiveAnimationMs = deps.afterActiveAnimationMs ?? afterActiveAnimationMsDefault;
  const settleMs = worldEntryGpuSettleCoverMs({
    adaptiveBudget: deps.adaptiveBudget,
    constrainedMemory: deps.constrainedMemory,
    online: deps.online,
  });
  const establishingShot = deps.establishingShot === true;
  setCover(true);
  if (establishingShot) setArrivalEstablishingShot(true);
  const reveal = (): void => {
    try {
      deps.revealWorld();
    } finally {
      setCover(false);
      if (establishingShot) setArrivalEstablishingShot(false);
    }
  };
  afterActiveAnimationMs(settleMs, () => {
    // The wait never rejects on its own; a throw out of revealWorld is a real
    // bug the console must show, but the cover has already been dropped above.
    awaitReveals(arrivalRevealSettleMaxMs(deps.online, establishingShot))
      .then(reveal, reveal)
      .catch((err) => console.error('World reveal failed', err));
  });
}
