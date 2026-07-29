// Keeps the SceneDirector's presentation-side input lock and the browser input
// latches in the same phase. In particular, handleEvents() synchronizes the
// lock before its caller can resolve another offline catch-up tick or flush an
// online input frame.

import type { SimEvent } from '../sim/types';
import {
  type KeyboardTurnState,
  newKeyboardTurnState,
  resetKeyboardTurnState,
} from './keyboard_turn_facing';
import type { MouselookReleaseState } from './mouselook_release';

export interface SceneFacingInputState {
  /** Falling-edge memory for classic mouselook and Mouse Camera movement. */
  cameraDrivenFacing: MouselookReleaseState;
  /** Release yaw held until an offline tick or online frame consumes it. */
  pendingReleaseFacing: number | null;
  /** Locally integrated online keyboard heading and wire-flag gate. */
  keyboardTurn: KeyboardTurnState;
}

export function newSceneFacingInputState(): SceneFacingInputState {
  return {
    cameraDrivenFacing: { active: false },
    pendingReleaseFacing: null,
    keyboardTurn: newKeyboardTurnState(),
  };
}

export function resetSceneFacingInputState(state: SceneFacingInputState): void {
  state.cameraDrivenFacing.active = false;
  state.pendingReleaseFacing = null;
  resetKeyboardTurnState(state.keyboardTurn);
}

export interface SceneInputLockSource {
  handleEvents(events: SimEvent[]): void;
  inputLocked(): boolean;
}

export interface SceneInputLockTarget {
  setSceneInputLocked(on: boolean): void;
}

export interface MirroredSceneInputSource {
  onSceneInputLockChanged: ((locked: boolean) => void) | null;
  sceneInputLockPending(): boolean;
  drainEvents(): SimEvent[];
}

export class SceneInputLockCoordinator {
  private wasLocked = false;

  constructor(
    private readonly source: SceneInputLockSource,
    private readonly target: SceneInputLockTarget,
    private readonly onLockEdge: () => void,
  ) {}

  sync(): boolean {
    return this.applyPending(this.source.inputLocked());
  }

  applyPending(locked: boolean): boolean {
    if (locked && !this.wasLocked) this.onLockEdge();
    this.target.setSceneInputLocked(locked);
    this.wasLocked = locked;
    return locked;
  }

  handleEvents(events: SimEvent[]): boolean {
    let handled = false;
    let locked = this.source.inputLocked();
    for (const event of events) {
      if (event.type !== 'scene' && event.type !== 'sceneSync') continue;
      handled = true;
      this.source.handleEvents([event]);
      locked = this.sync();
    }
    return handled ? locked : this.sync();
  }

  handleMirroredEvents(events: SimEvent[]): boolean {
    for (const event of events) {
      if (event.type !== 'scene' && event.type !== 'sceneSync') continue;
      this.source.handleEvents([event]);
    }
    return this.sync();
  }
}

export function bindMirroredSceneInputLock(
  source: MirroredSceneInputSource,
  coordinator: SceneInputLockCoordinator,
): boolean {
  source.onSceneInputLockChanged = (locked) => coordinator.applyPending(locked);
  return coordinator.applyPending(source.sceneInputLockPending());
}

export function drainMirroredSceneInput(
  source: MirroredSceneInputSource,
  coordinator: SceneInputLockCoordinator,
): { events: SimEvent[]; locked: boolean } {
  coordinator.applyPending(source.sceneInputLockPending());
  const events = source.drainEvents();
  return {
    events,
    locked: coordinator.handleMirroredEvents(events),
  };
}

export function runOfflineSceneInputTick(
  coordinator: SceneInputLockCoordinator,
  locked: boolean,
  tick: (lockedAtTickStart: boolean) => SimEvent[],
): { events: SimEvent[]; locked: boolean } {
  const events = tick(locked);
  return {
    events,
    locked: coordinator.handleEvents(events),
  };
}
