// The Last Bell scene director, client side: the thin impure wrapper around
// scene_director_core.ts that main.ts drives. It consumes personal 'scene'
// SimEvents (camera shots, input lock, music directives; the HUD overlay owns
// letterbox/subtitles/fades), exposes the input-lock flag the frame loop folds
// into its gates, and produces the per-frame camera override pose that is
// applied over the input camera exactly like the first-spawn introCameraTick.

import type { SimEvent } from '../sim/types';
import type { IWorld } from '../world_api';
import {
  applySceneOp,
  createSceneDirectorState,
  type SceneLivePose,
  type ScenePose,
  sceneCameraActive,
  sceneMusicAction,
  scenePose,
} from './scene_director_core';

export interface SceneDirectorDeps {
  world: () => IWorld;
  /** Monotonic seconds (the frame loop's clock). */
  nowSec: () => number;
  /** Hard-silence / restore the music engine (MusicDirector.setSceneSilence). */
  musicSilence: (on: boolean) => void;
}

export class SceneDirector {
  private readonly state = createSceneDirectorState();

  constructor(private readonly deps: SceneDirectorDeps) {}

  /** Feed a tick's drained events; non-scene events are ignored. */
  handleEvents(events: SimEvent[]): void {
    const world = this.deps.world();
    for (const ev of events) {
      if (ev.type !== 'scene') continue;
      // Offline hands the WHOLE tick batch over, so another local player's
      // personal events must be dropped here (same gate as hud.handleEvents).
      if (ev.pid !== undefined && ev.pid !== world.playerId) continue;
      const directive = applySceneOp(this.state, ev.op, this.deps.nowSec());
      if (directive !== null) {
        const action = sceneMusicAction(directive);
        if (action === 'silence') this.deps.musicSilence(true);
        else if (action === 'resume') this.deps.musicSilence(false);
      }
      // A skipped scene drops its remaining presentation ops (a scheduled
      // 'resume' included), so the end op always restores the music.
      if (ev.op.kind === 'end') this.deps.musicSilence(false);
    }
  }

  /** True while a scene plays (Esc routes to sceneSkip instead of the menu). */
  sceneActive(): boolean {
    return this.state.sceneActive;
  }

  /** True while gameplay input is presentation-locked by the scene. */
  inputLocked(): boolean {
    return this.state.inputLocked;
  }

  /** True while the scene camera owns the pose (shots or the release ease). */
  cameraActive(): boolean {
    return sceneCameraActive(this.state);
  }

  /** The per-frame camera override, or null when the follow camera owns the
   *  frame. Focus targets with an entityId track the entity's live mirrored
   *  position through IWorld each frame. */
  cameraPose(live: SceneLivePose): ScenePose | null {
    return scenePose(this.state, this.deps.nowSec(), live, (id) => {
      const e = this.deps.world().entities.get(id);
      return e ? e.pos : null;
    });
  }

  /** Route a skip gesture (Esc / the HUD skip button) to the authority. */
  requestSkip(): void {
    this.deps.world().sceneSkip();
  }
}
