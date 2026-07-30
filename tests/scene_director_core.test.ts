// Last Bell scene director core (src/game/scene_director_core.ts): the
// timeline/easing/release contract. Time is injected seconds, so every moment
// of a shot is driven directly; the live pose and the entity resolver stand in
// for the frame loop and IWorld.

import { describe, expect, it } from 'vitest';
import {
  applySceneOp,
  applySceneSync,
  createSceneDirectorState,
  SCENE_RELEASE_SEC,
  SCENE_RIG_ENTRY_SEC,
  type SceneDirectorState,
  type SceneLivePose,
  sceneCameraActive,
  sceneMusicAction,
  scenePose,
} from '../src/game/scene_director_core';
import { evaluateSceneRigPose, sceneRigCameraPosition } from '../src/game/scene_rig_core';
import type { SceneAttachFrame, SceneCameraShot, SceneWireOp } from '../src/sim/types';

const LIVE: SceneLivePose = {
  yaw: 1,
  pitch: 0.3,
  dist: 12,
  playerX: 0,
  playerY: 0,
  playerZ: 0,
};

const FOCUS_SHOT: SceneWireOp = {
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
};

const noEntities = (): null => null;

function stateWithShot(at: number): SceneDirectorState {
  const s = createSceneDirectorState();
  applySceneOp(s, { kind: 'start', duration: 10 }, at);
  applySceneOp(s, FOCUS_SHOT, at);
  return s;
}

describe('scene lifecycle + input lock', () => {
  it('hard-converges stale camera and input state from reconnect authority', () => {
    const s = stateWithShot(0);
    applySceneOp(s, { kind: 'inputLock', on: true }, 0);
    scenePose(s, 0, LIVE, noEntities);
    expect(sceneCameraActive(s)).toBe(true);
    applySceneSync(s, {
      sceneId: 'active',
      remainingSeconds: 4,
      inputLocked: false,
      letterbox: true,
      musicSilenced: false,
    });
    expect(s.sceneActive).toBe(true);
    expect(s.inputLocked).toBe(false);
    expect(sceneCameraActive(s)).toBe(false);
    applySceneSync(s, null);
    expect(s.sceneActive).toBe(false);
    expect(s.inputLocked).toBe(false);
  });

  it('start arms the scene and inputLock ops toggle the lock', () => {
    const s = createSceneDirectorState();
    expect(s.sceneActive).toBe(false);
    applySceneOp(s, { kind: 'start', duration: 10 }, 0);
    expect(s.sceneActive).toBe(true);
    applySceneOp(s, { kind: 'inputLock', on: true }, 0.5);
    expect(s.inputLocked).toBe(true);
    applySceneOp(s, { kind: 'inputLock', on: false }, 5);
    expect(s.inputLocked).toBe(false);
  });

  it('end ALWAYS releases the input lock, even when inputLock(off) never arrived', () => {
    const s = createSceneDirectorState();
    applySceneOp(s, { kind: 'start', duration: 10 }, 0);
    applySceneOp(s, { kind: 'inputLock', on: true }, 0.5);
    // Skip path: the end op arrives with the unlock op dropped.
    applySceneOp(s, { kind: 'end' }, 1);
    expect(s.inputLocked).toBe(false);
    expect(s.sceneActive).toBe(false);
  });

  it('an inputLock arriving before start still locks and end still clears it', () => {
    const s = createSceneDirectorState();
    applySceneOp(s, { kind: 'inputLock', on: true }, 0);
    expect(s.inputLocked).toBe(true);
    applySceneOp(s, { kind: 'end' }, 1);
    expect(s.inputLocked).toBe(false);
  });
});

describe('reduced-motion static composition', () => {
  it('holds a focus shot at its midpoint pose while keeping camera ownership', () => {
    const s = stateWithShot(0);
    const midpoint = scenePose(s, 0, LIVE, noEntities, undefined, true);
    expect(midpoint?.yaw).toBeCloseTo(1.5, 10);
    expect(midpoint?.pitch).toBeCloseTo(0.4, 10);
    expect(midpoint?.dist).toBeCloseTo(10, 10);
    expect(midpoint?.focusX).toBeCloseTo(5, 10);
    expect(midpoint?.focusY).toBeCloseTo(1, 10);
    expect(midpoint?.focusZ).toBeCloseTo(10, 10);
    const held = { ...midpoint };
    expect(
      scenePose(
        s,
        5,
        {
          ...LIVE,
          yaw: -1,
          playerX: 50,
        },
        noEntities,
        undefined,
        true,
      ),
    ).toEqual(held);
    expect(sceneCameraActive(s)).toBe(true);
    expect(s.sceneActive).toBe(true);
  });

  it('holds dolly and attach shots at one representative authored pose', () => {
    const dolly = createSceneDirectorState();
    applySceneOp(
      dolly,
      {
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: 2, y: 6, z: 4 },
            { x: 10, y: 8, z: 12 },
          ],
          lookAt: { kind: 'point', point: { x: 6, y: 3, z: 8 } },
          dur: 2,
        },
      },
      0,
    );
    const dollyPose = scenePose(dolly, 0, LIVE, noEntities, undefined, true);
    expect(dollyPose).not.toBeNull();
    if (!dollyPose) return;
    const dollyCamera = sceneRigCameraPosition(dollyPose);
    expect(dollyCamera.x).toBeCloseTo(6, 10);
    expect(dollyCamera.y).toBeCloseTo(7, 10);
    expect(dollyCamera.z).toBeCloseTo(8, 10);
    const heldDolly = { ...dollyPose };
    expect(scenePose(dolly, 9, LIVE, noEntities, undefined, true)).toEqual(heldDolly);

    const attach = createSceneDirectorState();
    applySceneOp(
      attach,
      {
        kind: 'camera',
        shot: {
          kind: 'attach',
          target: 'ship',
          dur: 4,
          fallbackFrame: { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
          offset: { x: 2, y: 3, z: 0 },
          lookAt: { x: 0, y: 1, z: 4 },
        },
      },
      0,
    );
    const frame: SceneAttachFrame = { position: { x: 0, y: 5, z: 20 }, yaw: Math.PI / 2 };
    const resolve = (
      _target: string,
      _out?: SceneAttachFrame,
      presentationTimeSec = 0,
    ): SceneAttachFrame => {
      frame.position.x = presentationTimeSec * 5;
      return frame;
    };
    const attachPose = scenePose(attach, 0, LIVE, noEntities, resolve, true);
    expect(attachPose).not.toBeNull();
    if (!attachPose) return;
    const attachCamera = sceneRigCameraPosition(attachPose);
    expect(attachCamera.x).toBeCloseTo(10, 10);
    const heldAttach = { ...attachPose };
    frame.position.x = 80;
    frame.yaw = 0;
    expect(scenePose(attach, 5, LIVE, noEntities, resolve, true)).toEqual(heldAttach);
  });
});

describe('focus shot easing', () => {
  it('eases from the live pose at shot start to the shot pose over dur (easeInOutSine)', () => {
    const s = stateWithShot(100);
    // t=0: the first frame latches the live pose and returns it verbatim.
    const p0 = scenePose(s, 100, LIVE, noEntities);
    expect(p0).not.toBeNull();
    expect(p0?.yaw).toBeCloseTo(1, 6);
    expect(p0?.pitch).toBeCloseTo(0.3, 6);
    expect(p0?.dist).toBeCloseTo(12, 6);
    expect(p0?.focusX).toBeCloseTo(0, 6);
    // t=0.5 (halfway through dur=2): easeInOutSine(0.5) = 0.5 exactly.
    const p1 = scenePose(s, 101, LIVE, noEntities);
    expect(p1?.yaw).toBeCloseTo(1.5, 6);
    expect(p1?.pitch).toBeCloseTo(0.4, 6);
    expect(p1?.dist).toBeCloseTo(10, 6);
    expect(p1?.focusX).toBeCloseTo(5, 6);
    expect(p1?.focusY).toBeCloseTo(1, 6);
    expect(p1?.focusZ).toBeCloseTo(10, 6);
    // t>=1: the shot pose holds until the next op.
    const p2 = scenePose(s, 102, LIVE, noEntities);
    expect(p2?.yaw).toBeCloseTo(2, 6);
    expect(p2?.dist).toBeCloseTo(8, 6);
    const p3 = scenePose(s, 105, LIVE, noEntities);
    expect(p3?.yaw).toBeCloseTo(2, 6);
    expect(p3?.focusX).toBeCloseTo(10, 6);
  });

  it('a focus target with an entityId tracks the live entity position each frame', () => {
    const s = createSceneDirectorState();
    applySceneOp(s, { kind: 'start', duration: 10 }, 0);
    applySceneOp(
      s,
      {
        kind: 'camera',
        shot: {
          kind: 'focus',
          entityId: 7,
          x: 10,
          y: 2,
          z: 20,
          dist: 8,
          pitch: 0.5,
          yaw: 2,
          dur: 1,
        },
      },
      0,
    );
    const entity = { x: 4, y: 1, z: 6 };
    const resolve = (id: number) => (id === 7 ? entity : null);
    scenePose(s, 0, LIVE, resolve);
    const held = scenePose(s, 1.5, LIVE, resolve);
    expect(held?.focusX).toBeCloseTo(4, 6);
    // The actor moves while the shot holds: the focus follows.
    entity.x = 9;
    entity.z = 12;
    const tracked = scenePose(s, 2, LIVE, resolve);
    expect(tracked?.focusX).toBeCloseTo(9, 6);
    expect(tracked?.focusZ).toBeCloseTo(12, 6);
  });

  it('a despawned focus entity falls back to the shot point', () => {
    const s = createSceneDirectorState();
    applySceneOp(s, { kind: 'start', duration: 10 }, 0);
    applySceneOp(
      s,
      {
        kind: 'camera',
        shot: {
          kind: 'focus',
          entityId: 7,
          x: 10,
          y: 2,
          z: 20,
          dist: 8,
          pitch: 0.5,
          yaw: 2,
          dur: 1,
        },
      },
      0,
    );
    const held = scenePose(s, 2, LIVE, noEntities);
    expect(held?.focusX).toBeCloseTo(10, 6);
    expect(held?.focusZ).toBeCloseTo(20, 6);
  });

  it('a second shot eases from the held pose of the first, not from the live pose', () => {
    const s = stateWithShot(0);
    scenePose(s, 0, LIVE, noEntities);
    scenePose(s, 3, LIVE, noEntities); // held at the shot pose (yaw 2, dist 8)
    applySceneOp(
      s,
      {
        kind: 'camera',
        shot: {
          kind: 'focus',
          entityId: null,
          x: 0,
          y: 0,
          z: 0,
          dist: 4,
          pitch: 0.2,
          yaw: 3,
          dur: 2,
        },
      },
      4,
    );
    const mid = scenePose(s, 5, LIVE, noEntities); // halfway: g = 0.5
    expect(mid?.yaw).toBeCloseTo(2.5, 6);
    expect(mid?.dist).toBeCloseTo(6, 6);
  });
});

describe('rig shot delegation', () => {
  it('pins the authored rig entry ease window', () => {
    expect(SCENE_RIG_ENTRY_SEC).toBe(0.8);
  });

  it('evaluates a dolly shot through the director path', () => {
    const s = createSceneDirectorState();
    applySceneOp(s, { kind: 'start', duration: 10 }, 0);
    applySceneOp(
      s,
      {
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: 2, y: 6, z: 4 },
            { x: 10, y: 8, z: 12 },
          ],
          lookAt: { kind: 'point', point: { x: 6, y: 3, z: 8 } },
          dur: 2,
        },
      },
      0,
    );
    const start = scenePose(s, 0, LIVE, noEntities);
    expect(start).not.toBeNull();
    if (!start) return;
    expect(start).toMatchObject({
      yaw: LIVE.yaw,
      pitch: LIVE.pitch,
      dist: LIVE.dist,
      focusX: LIVE.playerX,
      focusY: LIVE.playerY,
      focusZ: LIVE.playerZ,
    });
    const middle = scenePose(s, SCENE_RIG_ENTRY_SEC / 2, LIVE, noEntities);
    const authoredMiddle = evaluateSceneRigPose(
      s.shot as Extract<SceneCameraShot, { kind: 'dolly' }>,
      SCENE_RIG_ENTRY_SEC / 2,
      noEntities,
      () => null,
    );
    expect(middle?.dist).toBeCloseTo((LIVE.dist + authoredMiddle.dist) / 2, 10);
    const end = scenePose(s, 2, LIVE, noEntities);
    expect(end).not.toBeNull();
    if (!end) return;
    const endCamera = sceneRigCameraPosition(end);
    expect(endCamera.x).toBeCloseTo(10, 10);
    expect(endCamera.y).toBeCloseTo(8, 10);
    expect(endCamera.z).toBeCloseTo(12, 10);
  });

  it('evaluates an attach shot through the director path', () => {
    const s = createSceneDirectorState();
    applySceneOp(s, { kind: 'start', duration: 10 }, 0);
    applySceneOp(
      s,
      {
        kind: 'camera',
        shot: {
          kind: 'attach',
          target: 'ship',
          fallbackFrame: { position: { x: 1, y: 2, z: 3 }, yaw: 0 },
          offset: { x: 2, y: 3, z: 0 },
          lookAt: { x: 0, y: 1, z: 4 },
        },
      },
      0,
    );
    const frame: SceneAttachFrame = {
      position: { x: 10, y: 5, z: 20 },
      yaw: Math.PI / 2,
    };
    const start = scenePose(s, 0, LIVE, noEntities, (target) => (target === 'ship' ? frame : null));
    expect(start).toMatchObject({
      yaw: LIVE.yaw,
      pitch: LIVE.pitch,
      dist: LIVE.dist,
      focusX: LIVE.playerX,
      focusY: LIVE.playerY,
      focusZ: LIVE.playerZ,
    });
    const pose = scenePose(s, SCENE_RIG_ENTRY_SEC, LIVE, noEntities, (target) =>
      target === 'ship' ? frame : null,
    );
    expect(pose).not.toBeNull();
    if (!pose) return;
    const camera = sceneRigCameraPosition(pose);
    expect(camera.x).toBeCloseTo(10, 10);
    expect(camera.y).toBeCloseTo(8, 10);
    expect(camera.z).toBeCloseTo(18, 10);
  });

  it('reuses the existing release ease after a rig shot', () => {
    const s = createSceneDirectorState();
    applySceneOp(s, { kind: 'start', duration: 10 }, 0);
    applySceneOp(
      s,
      {
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [{ x: 2, y: 6, z: 4 }],
          lookAt: { kind: 'point', point: { x: 6, y: 3, z: 8 } },
          dur: 1,
        },
      },
      0,
    );
    const shotPose = scenePose(s, 0, LIVE, noEntities);
    expect(shotPose).not.toBeNull();
    const shotDist = shotPose?.dist ?? 0;
    applySceneOp(s, { kind: 'camera', shot: { kind: 'release' } }, 1);
    const mid = scenePose(s, 1 + SCENE_RELEASE_SEC / 2, LIVE, noEntities);
    expect(mid).not.toBeNull();
    expect(mid?.dist).toBeCloseTo((shotDist + LIVE.dist) / 2, 6);
    expect(scenePose(s, 1 + SCENE_RELEASE_SEC + 0.001, LIVE, noEntities)).toBeNull();
  });
});

describe('release', () => {
  it('a camera release eases back to the pre-scene pose and player over SCENE_RELEASE_SEC', () => {
    const s = stateWithShot(0);
    scenePose(s, 0, LIVE, noEntities);
    scenePose(s, 2, LIVE, noEntities); // shot pose held: yaw 2, pitch 0.5, dist 8, focus (10,2,20)
    applySceneOp(s, { kind: 'camera', shot: { kind: 'release' } }, 3);
    // Live camera state has drifted while the scene ran; the release target is
    // the pose captured when the scene first took the camera (LIVE), plus the
    // player's CURRENT position.
    const drifted: SceneLivePose = { ...LIVE, yaw: -2, playerX: 6, playerY: 0, playerZ: 8 };
    const mid = scenePose(s, 3 + SCENE_RELEASE_SEC / 2, drifted, noEntities);
    expect(mid?.yaw).toBeCloseTo((2 + 1) / 2, 6); // toward prePose yaw 1, NOT drifted -2
    expect(mid?.dist).toBeCloseTo(10, 6);
    expect(mid?.focusX).toBeCloseTo(8, 6); // (10 + 6) / 2, toward the live player
    // Ease complete: the camera is handed back (null) and stays inactive.
    expect(scenePose(s, 3 + SCENE_RELEASE_SEC + 0.001, drifted, noEntities)).toBeNull();
    expect(sceneCameraActive(s)).toBe(false);
    expect(scenePose(s, 10, drifted, noEntities)).toBeNull();
  });

  it('the end op releases the camera exactly like an explicit release', () => {
    const s = stateWithShot(0);
    scenePose(s, 0, LIVE, noEntities);
    scenePose(s, 2, LIVE, noEntities);
    applySceneOp(s, { kind: 'end' }, 3);
    expect(sceneCameraActive(s)).toBe(true); // easing back
    expect(scenePose(s, 3 + SCENE_RELEASE_SEC / 2, LIVE, noEntities)).not.toBeNull();
    expect(scenePose(s, 3 + SCENE_RELEASE_SEC + 0.01, LIVE, noEntities)).toBeNull();
    expect(sceneCameraActive(s)).toBe(false);
  });

  it('an end before any pose frame hands the camera back immediately (skip on the arming tick)', () => {
    const s = stateWithShot(0);
    applySceneOp(s, { kind: 'end' }, 0.01);
    expect(sceneCameraActive(s)).toBe(false);
    expect(scenePose(s, 0.02, LIVE, noEntities)).toBeNull();
  });

  it('a release with no camera taken is a no-op', () => {
    const s = createSceneDirectorState();
    applySceneOp(s, { kind: 'camera', shot: { kind: 'release' } }, 0);
    expect(sceneCameraActive(s)).toBe(false);
  });
});

describe('music directives', () => {
  it('maps silence and resume, and no-ops unknown directives', () => {
    expect(sceneMusicAction('silence')).toBe('silence');
    expect(sceneMusicAction('resume')).toBe('resume');
    expect(sceneMusicAction('theme:last_bell')).toBeNull();
    expect(sceneMusicAction('')).toBeNull();
  });

  it('applySceneOp surfaces the music directive and nothing else', () => {
    const s = createSceneDirectorState();
    expect(applySceneOp(s, { kind: 'music', directive: 'silence' }, 0)).toBe('silence');
    expect(applySceneOp(s, { kind: 'start', duration: 5 }, 0)).toBeNull();
    expect(applySceneOp(s, { kind: 'letterbox', on: true }, 0)).toBeNull();
  });
});

describe('per-frame allocation', () => {
  it('returns the same reused pose container across frames', () => {
    const s = stateWithShot(0);
    const a = scenePose(s, 0, LIVE, noEntities);
    const b = scenePose(s, 1, LIVE, noEntities);
    expect(a).toBe(b);
  });
});
