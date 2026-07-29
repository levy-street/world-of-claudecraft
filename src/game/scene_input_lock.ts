// Keeps the SceneDirector's presentation-side input lock and the browser input
// latches in the same phase. In particular, handleEvents() synchronizes the
// lock before its caller can resolve another offline catch-up tick or flush an
// online input frame.

import type { SimEvent } from '../sim/types';

export interface SceneInputLockSource {
  handleEvents(events: SimEvent[]): void;
  inputLocked(): boolean;
}

export interface SceneInputLockTarget {
  setSceneInputLocked(on: boolean): void;
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
