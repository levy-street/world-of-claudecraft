// Scene definition registry leaf. Content modules register authored scenes at
// module evaluation time, so this file must stay free of Sim/runtime imports.
// Keeping registration here breaks the cycle where scenes.ts reaches squad
// entities, entity.ts reaches data.ts, and data.ts imports campaign content.

import type { LastBellPropCueId } from '../content/last_bell_cinematics';
import type { SceneReleasePose, SceneRigPoint } from '../types';

export const SCENE_SAMPLED_MUSIC_DIRECTIVES = [
  'lb_bell_toll_one',
  'lb_harbor_ambience',
  'lb_ship_castoff',
] as const;

// These directives are intentionally authorable before their client
// interpretation lands. Adding one is an explicit authoring decision.
export const SCENE_FUTURE_MUSIC_DIRECTIVES = ['theme:last_bell'] as const;

export type SceneSampledMusicDirective = (typeof SCENE_SAMPLED_MUSIC_DIRECTIVES)[number];
export type SceneFutureMusicDirective = (typeof SCENE_FUTURE_MUSIC_DIRECTIVES)[number];
export type SceneMusicDirective =
  | SceneSampledMusicDirective
  | 'silence'
  | 'resume'
  | SceneFutureMusicDirective;

export interface SceneRigPointDef {
  x: number;
  z: number;
  /** Yards above terrain at the resolved x/z coordinate. */
  height: number;
}

export type SceneDollyLookAtDef =
  | { kind: 'point'; point: SceneRigPointDef }
  | { kind: 'spline'; points: readonly SceneRigPointDef[] }
  | {
      kind: 'subject';
      actorId: string;
      offset: SceneRigPoint;
      fallback: SceneRigPointDef;
    };

/** How a shot takes the camera from the previous pose. 'snap' holds the
 * shot's own frame from its first tick (every covered cut sets this: the
 * fade-in must reveal the new shot already composed, never the travel from
 * the old one). 'ease' (also the default when absent) glides in from the
 * live pose over SCENE_RIG_ENTRY_SEC, for shots that take the camera
 * visibly; a visible ease is linted like any other camera motion. */
export type SceneShotEntry = 'snap' | 'ease';

export interface SceneDollyShotDef {
  kind: 'dolly';
  points: readonly SceneRigPointDef[];
  lookAt: SceneDollyLookAtDef;
  dur: number;
  entry?: SceneShotEntry;
  /** Presentation fixture or entity id expected near the authored look-at. */
  subjectRef?: string;
}

export interface SceneAttachShotDef {
  kind: 'attach';
  target: string;
  /** Rest frame used until the client resolves the live target frame. */
  fallbackFrame: { point: SceneRigPointDef; yaw: number };
  /** Camera position in the target's local frame. */
  offset: SceneRigPoint;
  /** Exact look-at point in the target's local frame. */
  lookAt: SceneRigPoint;
  entry?: SceneShotEntry;
  /** Presentation fixture or entity id expected near the authored look-at. */
  subjectRef?: string;
}

export type SceneOpDef = { at: number } & (
  | { kind: 'line'; speaker: string; speakerActorId?: string; key: string; dur?: number }
  | {
      kind: 'camera';
      shot:
        | {
            kind: 'focus';
            actorId?: string;
            x?: number;
            z?: number;
            dist?: number;
            pitch?: number;
            yaw?: number;
            dur: number;
            entry?: SceneShotEntry;
            /** Presentation fixture or entity id expected near the authored look-at. */
            subjectRef?: string;
          }
        | SceneDollyShotDef
        | SceneAttachShotDef
        // pose: the authored gameplay hand-back (required whenever the scene
        // walked the player somewhere new; see SceneReleasePose in types.ts).
        | { kind: 'release'; pose?: SceneReleasePose };
    }
  | { kind: 'letterbox'; on: boolean }
  | { kind: 'inputLock'; on: boolean }
  | { kind: 'fade'; to: 'black' | 'clear'; dur: number }
  | { kind: 'music'; directive: SceneMusicDirective }
  | { kind: 'playerWalk'; to: { x: number; z: number }; speed?: number }
  | { kind: 'actorMove'; actorId: string; x: number; z: number }
  | { kind: 'actorFace'; actorId: string; facing: number }
  | { kind: 'anim'; actorId: string; anim: string }
  | { kind: 'prop'; target: string; cue: LastBellPropCueId }
);

export interface SceneDef {
  id: string;
  /** Total scene length in seconds; the end op emits when it elapses. */
  duration: number;
  ops: readonly SceneOpDef[];
}

const SCENES: Record<string, SceneDef> = {};

export function registerScene(def: SceneDef): void {
  // Ops evaluate in time order whatever order the author listed them.
  SCENES[def.id] = { ...def, ops: [...def.ops].sort((a, b) => a.at - b.at) };
}

export function sceneById(id: string): SceneDef | undefined {
  return SCENES[id];
}

/** Sorted read-only snapshot of every scene registered in this host. */
export function registeredSceneIds(): readonly string[] {
  return Object.freeze(Object.keys(SCENES).sort());
}
