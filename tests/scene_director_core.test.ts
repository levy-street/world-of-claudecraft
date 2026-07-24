// Last Bell scene director core (src/game/scene_director_core.ts): the
// timeline/easing/release contract. Time is injected seconds, so every moment
// of a shot is driven directly; the live pose and the entity resolver stand in
// for the frame loop and IWorld.

import { describe, expect, it } from 'vitest';
import {
  applySceneOp,
  createSceneDirectorState,
  SCENE_RELEASE_SEC,
  type SceneDirectorState,
  type SceneLivePose,
  sceneCameraActive,
  sceneMusicAction,
  scenePose,
} from '../src/game/scene_director_core';
import type { SceneWireOp } from '../src/sim/types';

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
