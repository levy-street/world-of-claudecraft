import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applySceneOp,
  createSceneDirectorState,
  type SceneLivePose,
  sceneCameraActive,
  scenePose,
} from '../src/game/scene_director_core.js';
import { authoritativeDeckRigVisible } from '../src/render/harbor_deck_stand_in_core.js';
import {
  createSceneOverlayState,
  overlayApplyOp,
  sceneOverlayView,
} from '../src/ui/hud/scene/scene_overlay_view.js';

const LIVE: SceneLivePose = {
  yaw: 1,
  pitch: 0.3,
  dist: 12,
  playerX: 0,
  playerY: 0,
  playerZ: 0,
};
const MAIN_SOURCE = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('reduced-motion scene composition', () => {
  it('cannot recreate the hidden HUD, locked input, inactive camera, invisible rig state', () => {
    const director = createSceneDirectorState();
    const overlay = createSceneOverlayState();
    const ops = [
      { kind: 'start', duration: 8 },
      { kind: 'inputLock', on: true },
      { kind: 'letterbox', on: true },
      {
        kind: 'line',
        speaker: 'npc.ferryman.name',
        speakerEntityId: null,
        key: 'scene.line',
        dur: 4,
      },
      {
        kind: 'camera',
        shot: {
          kind: 'focus',
          entityId: null,
          x: 10,
          y: 2,
          z: 20,
          dist: 8,
          pitch: 0.5,
          yaw: 2,
          dur: 2,
        },
      },
    ] as const;
    for (const op of ops) {
      applySceneOp(director, op, 0);
      overlayApplyOp(overlay, op, 0);
    }

    const staticPose = scenePose(director, 0, LIVE, () => null, undefined, true);
    expect(staticPose).not.toBeNull();
    if (!staticPose) return;
    const inputCamera = {
      yaw: staticPose.yaw,
      pitch: staticPose.pitch,
      dist: staticPose.dist,
    };
    const activeModel = sceneOverlayView(overlay, 0);
    expect(activeModel).toMatchObject({
      cinematic: true,
      letterbox: true,
      lineKey: 'scene.line',
    });
    expect(sceneCameraActive(director)).toBe(true);

    const release = { kind: 'camera', shot: { kind: 'release' } } as const;
    applySceneOp(director, release, 1);
    overlayApplyOp(overlay, release, 1);
    const handoff = scenePose(
      director,
      1,
      { ...LIVE, ...inputCamera },
      () => null,
      undefined,
      true,
    );
    expect(handoff).toMatchObject({
      yaw: LIVE.yaw,
      pitch: LIVE.pitch,
      dist: LIVE.dist,
    });
    inputCamera.yaw = handoff?.yaw ?? inputCamera.yaw;
    inputCamera.pitch = handoff?.pitch ?? inputCamera.pitch;
    inputCamera.dist = handoff?.dist ?? inputCamera.dist;
    expect(inputCamera).toEqual({ yaw: LIVE.yaw, pitch: LIVE.pitch, dist: LIVE.dist });
    expect(
      scenePose(director, 1.1, { ...LIVE, ...inputCamera }, () => null, undefined, true),
    ).toBeNull();

    const releasedModel = sceneOverlayView(overlay, 1);
    const rigVisible = authoritativeDeckRigVisible(true, sceneCameraActive(director));
    const oldDeadState =
      releasedModel.cinematic &&
      director.inputLocked &&
      !sceneCameraActive(director) &&
      !rigVisible;
    expect(oldDeadState).toBe(false);
    expect(rigVisible).toBe(true);
    expect(releasedModel.letterbox).toBe(true);
    expect(releasedModel.lineKey).toBe('scene.line');
    expect(MAIN_SOURCE).toContain(
      'renderer.sceneCameraFocus = sceneDirector.cameraActive() ? sceneFocus : null;',
    );
  });
});
