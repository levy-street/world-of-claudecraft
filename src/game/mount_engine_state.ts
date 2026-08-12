// Pure per-entity state machine for an engine mount (windup one-shot, a
// sustained loop, winddown one-shot), decoupled from WebAudio so the
// transition logic unit-tests without an AudioContext. Most mounts play a
// per-stride gait one-shot (sfx.ts mountRun); a mount with a dedicated
// windup/loop/winddown take set drives through one of the policies here.
//
// The tank policy lets a quick-tap windup finish before its winddown. The
// interruptible policy used by the rocket sled cuts directly between the
// authored start and stop takes when input reverses.

export type MountEngineState = 'idle' | 'starting' | 'moving' | 'stopping';

export interface MountEngineEntry {
  state: MountEngineState;
  /** Audio-clock time (ctx.currentTime) the current phase began. */
  phaseStartedAt: number;
}

export type MountEngineAction = 'playStart' | 'playStop' | null;

export interface MountEngineDecision {
  next: MountEngineEntry;
  action: MountEngineAction;
}

const IDLE: MountEngineEntry = { state: 'idle', phaseStartedAt: 0 };

// Frame-timing float accumulation (repeated += on an AudioContext clock) can
// land the elapsed-time check a hair under the true boundary even when a
// real frame budget (>=16ms) has long since passed it; a tiny epsilon keeps
// the transition from missing by a float-precision sliver.
const EPSILON_SEC = 1e-6;

/** Advances one entity's engine state. `moving` is this frame's live
 *  moving/grounded/mounted signal; `now` is the audio clock; `startDuration`
 *  is the windup one-shot's known length in seconds (the loop begins, or the
 *  winddown fires, the instant it naturally ends). Call every frame; cheap
 *  when idle. */
export function advanceMountEngine(
  entry: MountEngineEntry | undefined,
  moving: boolean,
  now: number,
  startDuration: number,
): MountEngineDecision {
  const prior = entry ?? IDLE;

  switch (prior.state) {
    case 'idle':
      if (moving) return { next: { state: 'starting', phaseStartedAt: now }, action: 'playStart' };
      return { next: prior, action: null };

    case 'starting':
      if (now - prior.phaseStartedAt >= startDuration - EPSILON_SEC) {
        if (moving) return { next: { state: 'moving', phaseStartedAt: now }, action: null };
        return { next: { state: 'stopping', phaseStartedAt: now }, action: 'playStop' };
      }
      return { next: prior, action: null };

    case 'moving':
      if (!moving) return { next: { state: 'stopping', phaseStartedAt: now }, action: 'playStop' };
      return { next: prior, action: null };

    case 'stopping':
      // A re-tap while winding down restarts immediately; the winddown tail
      // is short and left to finish on its own voice underneath.
      if (moving) return { next: { state: 'starting', phaseStartedAt: now }, action: 'playStart' };
      return { next: prior, action: null };
  }
}

/** Directly interruptible authored take set. Releasing during start cuts to
 *  stop immediately; pressing during stop cuts back to start immediately. */
export function advanceInterruptibleMountEngine(
  entry: MountEngineEntry | undefined,
  moving: boolean,
  now: number,
  startDuration: number,
): MountEngineDecision {
  const prior = entry ?? IDLE;
  switch (prior.state) {
    case 'idle':
      return moving
        ? { next: { state: 'starting', phaseStartedAt: now }, action: 'playStart' }
        : { next: prior, action: null };
    case 'starting':
      if (!moving) return { next: { state: 'stopping', phaseStartedAt: now }, action: 'playStop' };
      if (now - prior.phaseStartedAt >= startDuration - EPSILON_SEC) {
        return { next: { state: 'moving', phaseStartedAt: now }, action: null };
      }
      return { next: prior, action: null };
    case 'moving':
      return moving
        ? { next: prior, action: null }
        : { next: { state: 'stopping', phaseStartedAt: now }, action: 'playStop' };
    case 'stopping':
      return moving
        ? { next: { state: 'starting', phaseStartedAt: now }, action: 'playStart' }
        : { next: prior, action: null };
  }
}

/** Whether the sustain loop should be audible for this state. */
export function mountEngineLoopActive(state: MountEngineState): boolean {
  return state === 'moving';
}
