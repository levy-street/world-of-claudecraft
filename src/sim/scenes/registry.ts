// Scene definition registry leaf. Content modules register authored scenes at
// module evaluation time, so this file must stay free of Sim/runtime imports.
// Keeping registration here breaks the cycle where scenes.ts reaches squad
// entities, entity.ts reaches data.ts, and data.ts imports campaign content.

import type { SceneRigPoint } from '../types';

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

export interface SceneDollyShotDef {
  kind: 'dolly';
  points: readonly SceneRigPointDef[];
  lookAt: SceneDollyLookAtDef;
  dur: number;
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
          }
        | SceneDollyShotDef
        | SceneAttachShotDef
        | { kind: 'release' };
    }
  | { kind: 'letterbox'; on: boolean }
  | { kind: 'inputLock'; on: boolean }
  | { kind: 'fade'; to: 'black' | 'clear'; dur: number }
  | { kind: 'music'; directive: string }
  | { kind: 'playerWalk'; to: { x: number; z: number }; speed?: number }
  | { kind: 'actorMove'; actorId: string; x: number; z: number }
  | { kind: 'actorFace'; actorId: string; facing: number }
  | { kind: 'anim'; actorId: string; anim: string }
  | { kind: 'prop'; target: string; cue: string }
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
