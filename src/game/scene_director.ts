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
  applySceneSync,
  createSceneDirectorState,
  type SceneLivePose,
  type ScenePose,
  sceneCameraActive,
  sceneMusicAction,
  scenePose,
} from './scene_director_core';
import type { SceneAttachmentResolver } from './scene_rig_core';

export interface SceneDirectorDeps {
  world: () => IWorld;
  /** Monotonic seconds (the frame loop's clock). */
  nowSec: () => number;
  /** Hard-silence / restore the music engine (MusicDirector.setSceneSilence). */
  musicSilence: (on: boolean) => void;
  /** Sampled interpretation of a music directive (scene_sfx.ts). */
  playDirective?: (directive: string) => void;
  /** Route a prop target and path segment id to the renderer. */
  propCue?: (target: string, cue: string) => void;
  /** Scene teardown: every prop cue back to rest. */
  propReset?: () => void;
  /** Live world frame of a scene attachment target, when its renderer owns one. */
  attachmentFrame?: SceneAttachmentResolver;
  /** Effective OS-or-game reduced-motion preference, sampled live. */
  reducedMotion: () => boolean;
}

export class SceneDirector {
  private readonly state = createSceneDirectorState();
  private readonly resolveEntity: (id: number) => { x: number; y: number; z: number } | null;

  constructor(private readonly deps: SceneDirectorDeps) {
    // Stable resolver: cameraPose is a frame path, so do not allocate a closure
    // for every pose evaluation.
    this.resolveEntity = (id) => {
      const e = this.deps.world().entities.get(id);
      return e ? e.pos : null;
    };
  }

  /** Feed a tick's drained events; non-scene events are ignored. */
  handleEvents(events: SimEvent[]): void {
    const world = this.deps.world();
    for (const ev of events) {
      if (ev.type === 'sceneSync') {
        applySceneSync(this.state, ev.state);
        this.deps.musicSilence(ev.state?.musicSilenced ?? false);
        this.deps.propReset?.();
        continue;
      }
      if (ev.type !== 'scene') continue;
      // Offline hands the WHOLE tick batch over, so another local player's
      // personal events must be dropped here (same gate as hud.handleEvents).
      if (ev.pid !== undefined && ev.pid !== world.playerId) continue;
      const directive = applySceneOp(this.state, ev.op, this.deps.nowSec());
      if (directive !== null) {
        const action = sceneMusicAction(directive);
        if (action === 'silence') this.deps.musicSilence(true);
        else if (action === 'resume') this.deps.musicSilence(false);
        else this.deps.playDirective?.(directive);
      }
      if (ev.op.kind === 'prop') this.deps.propCue?.(ev.op.target, ev.op.cue);
      // A skipped scene drops its remaining presentation ops (a scheduled
      // 'resume' included), so the end op always restores the music and
      // parks every prop cue.
      if (ev.op.kind === 'end') {
        this.deps.musicSilence(false);
        this.deps.propReset?.();
      }
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
   *  frame. Entity focus tracks IWorld, and attach shots use the injected
   *  live attachment frame when one is available. */
  cameraPose(live: SceneLivePose): ScenePose | null {
    return scenePose(
      this.state,
      this.deps.nowSec(),
      live,
      this.resolveEntity,
      this.deps.attachmentFrame,
      this.deps.reducedMotion(),
    );
  }

  /** Route a skip gesture (Esc / the HUD skip button) to the authority. */
  requestSkip(): void {
    this.deps.world().sceneSkip();
  }
}
