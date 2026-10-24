import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { pauldronLocal } from '../scripts/assets/woc_keyed_anims/keyed/pauldron.mjs';
import { type WocFit, wocAnimsUrl } from '../src/render/characters/woc_armor_core';
import { prepareWocSitClips, wocPauldronLocal } from '../src/render/characters/woc_sit_pose';

const FITS: readonly WocFit[] = ['male', 'female'];
const SIDES = ['l', 'r'] as const;
type Side = (typeof SIDES)[number];
const DEG = 180 / Math.PI;

interface LoadedLibrary {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  bindWorldQ: Map<string, THREE.Quaternion>;
  bindLocalQ: Map<string, THREE.Quaternion>;
}

async function loadAnimsLibrary(fit: WocFit): Promise<LoadedLibrary> {
  await MeshoptDecoder.ready;
  const bytes = readFileSync(path.resolve(__dirname, '..', 'public', wocAnimsUrl(fit)));
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(new Uint8Array(bytes).buffer, '');
  gltf.scene.updateMatrixWorld(true);
  const bindWorldQ = new Map<string, THREE.Quaternion>();
  const bindLocalQ = new Map<string, THREE.Quaternion>();
  gltf.scene.traverse((o) => {
    if (o.name) {
      bindWorldQ.set(o.name, o.getWorldQuaternion(new THREE.Quaternion()));
      bindLocalQ.set(o.name, o.quaternion.clone());
    }
  });
  const clips = new Map<string, THREE.AnimationClip>();
  for (const clip of gltf.animations) clips.set(clip.name, clip);
  return { scene: gltf.scene, clips, bindWorldQ, bindLocalQ };
}

function restoreBindPose(lib: LoadedLibrary): void {
  lib.scene.traverse((o) => {
    const q = lib.bindLocalQ.get(o.name);
    if (q) o.quaternion.copy(q);
  });
  lib.scene.updateMatrixWorld(true);
}

function boneWorldPos(scene: THREE.Object3D, name: string): THREE.Vector3 {
  const node = scene.getObjectByName(name);
  if (!node) throw new Error(`missing bone ${name}`);
  return node.getWorldPosition(new THREE.Vector3());
}

function boneWorldQuat(scene: THREE.Object3D, name: string): THREE.Quaternion {
  const node = scene.getObjectByName(name);
  if (!node) throw new Error(`missing bone ${name}`);
  return node.getWorldQuaternion(new THREE.Quaternion());
}

function getClip(lib: LoadedLibrary, name: string): THREE.AnimationClip {
  const clip = lib.clips.get(name);
  if (!clip) throw new Error(`missing clip ${name}`);
  return clip;
}

function getBindLocalQ(lib: LoadedLibrary, name: string): THREE.Quaternion {
  const q = lib.bindLocalQ.get(name);
  if (!q) throw new Error(`missing bind local quat for ${name}`);
  return q;
}

function getBindWorldQ(lib: LoadedLibrary, name: string): THREE.Quaternion {
  const q = lib.bindWorldQ.get(name);
  if (!q) throw new Error(`missing bind world quat for ${name}`);
  return q;
}

function getQuatTrack(clip: THREE.AnimationClip, boneName: string): THREE.KeyframeTrack {
  const trackName = `${boneName}.quaternion`;
  const track = clip.tracks.find((tr) => tr.name === trackName);
  if (!track) throw new Error(`missing track ${trackName} in ${clip.name}`);
  return track;
}

/** World-space bone axes (`along` down the limb, `palm` normal, `thumb` direction)
 *  transformed from the T-pose bind orientation (`±X` along, `-Y` palm, `+Z` thumb). */
function limbAxes(lib: LoadedLibrary, boneName: string, side: Side) {
  const sign = side === 'l' ? 1 : -1;
  const currentW = boneWorldQuat(lib.scene, boneName);
  const bindW = getBindWorldQ(lib, boneName);
  const delta = currentW.clone().multiply(bindW.clone().invert());
  return {
    along: new THREE.Vector3(sign, 0, 0).applyQuaternion(delta).normalize(),
    palm: new THREE.Vector3(0, -1, 0).applyQuaternion(delta).normalize(),
    thumb: new THREE.Vector3(0, 0, 1).applyQuaternion(delta).normalize(),
  };
}

describe.each(FITS)('WOC %s seated arm, elbow and wrist pose', (fit) => {
  let lib: LoadedLibrary;
  let rawSitIdle: THREE.AnimationClip;
  let rawSitDown: THREE.AnimationClip;

  beforeAll(async () => {
    lib = await loadAnimsLibrary(fit);
    rawSitIdle = getClip(lib, 'Sit_Idle');
    rawSitDown = getClip(lib, 'Sit_Down');
    prepareWocSitClips(fit, lib.clips, lib.scene);
  });

  it('places elbows outward of the shoulders and keeps them steady across the Sit_Idle loop', () => {
    restoreBindPose(lib);
    const sitIdle = getClip(lib, 'Sit_Idle');
    expect(sitIdle).not.toBe(rawSitIdle);
    expect(sitIdle.validate()).toBe(true);

    const mixer = new THREE.AnimationMixer(lib.scene);
    const action = mixer.clipAction(sitIdle).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    const elbow0: Record<Side, THREE.Vector3> = {
      l: new THREE.Vector3(),
      r: new THREE.Vector3(),
    };
    const steps = 16;
    for (let k = 0; k <= steps; k++) {
      mixer.setTime((sitIdle.duration * k) / steps);
      lib.scene.updateMatrixWorld(true);
      for (const side of SIDES) {
        const sign = side === 'l' ? 1 : -1;
        const shoulder = boneWorldPos(lib.scene, `upperarm${side}`);
        const elbow = boneWorldPos(lib.scene, `lowerarm${side}`);
        const wrist = boneWorldPos(lib.scene, `wrist${side}`);

        // Elbows sit clearly further out than the shoulders (never tucked into the chest).
        expect(sign * elbow.x, `${side} step ${k} elbow.x`).toBeGreaterThan(
          sign * shoulder.x + 0.06,
        );
        expect(sign * elbow.x, `${side} step ${k} elbow width`).toBeGreaterThan(
          fit === 'male' ? 0.22 : 0.195,
        );

        // Forearms angle forward and inward from the outward elbows toward the knees.
        expect(sign * wrist.x, `${side} step ${k} wrist inward of elbow`).toBeLessThan(
          sign * elbow.x - 0.06,
        );
        expect(wrist.z, `${side} step ${k} wrist forward of elbow`).toBeGreaterThan(elbow.z + 0.09);

        if (k === 0) elbow0[side].copy(elbow);
        // No IK pole flip across the breathing cycle (female raw Sit_Idle flipped by 0.105 m).
        expect(elbow.distanceTo(elbow0[side]), `${side} step ${k} elbow stability`).toBeLessThan(
          0.015,
        );
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(lib.scene);
  });

  it('orientates wrists and forearms palms-down and aligned with each other', () => {
    restoreBindPose(lib);
    const sitIdle = getClip(lib, 'Sit_Idle');
    const mixer = new THREE.AnimationMixer(lib.scene);
    const action = mixer.clipAction(sitIdle).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    const steps = 8;
    for (let k = 0; k <= steps; k++) {
      mixer.setTime((sitIdle.duration * k) / steps);
      lib.scene.updateMatrixWorld(true);
      for (const side of SIDES) {
        const sign = side === 'l' ? 1 : -1;
        const ua = limbAxes(lib, `upperarm${side}`, side);
        const la = limbAxes(lib, `lowerarm${side}`, side);
        const wr = limbAxes(lib, `wrist${side}`, side);
        const hd = limbAxes(lib, `hand${side}`, side);

        // Upper arm angles down and outward to the elbow.
        expect(sign * ua.along.x).toBeGreaterThan(0.25);
        expect(ua.along.y).toBeLessThan(-0.8);

        // Both forearm and wrist/hand are pronated palms-down (-Y).
        expect(la.palm.y, `${side} step ${k} forearm palm.y`).toBeLessThan(-0.92);
        expect(wr.palm.y, `${side} step ${k} wrist palm.y`).toBeLessThan(-0.92);
        expect(hd.palm.y, `${side} step ${k} hand palm.y`).toBeLessThan(-0.92);

        // Forearm and wrist align smoothly with no sharp bend or twist across the wrist joint.
        expect(la.along.angleTo(wr.along) * DEG, `${side} step ${k} wrist bend`).toBeLessThan(12);
        expect(la.palm.angleTo(wr.palm) * DEG, `${side} step ${k} wrist twist`).toBeLessThan(12);

        // Thumbs point inward toward the body midline.
        expect(sign * wr.thumb.x, `${side} step ${k} thumb inward`).toBeLessThan(-0.7);
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(lib.scene);
  });

  it('keeps shoulder pads on the canonical pauldron follow rule and closes Sit_Down into Sit_Idle', () => {
    const sitIdle = getClip(lib, 'Sit_Idle');
    const sitDown = getClip(lib, 'Sit_Down');
    expect(sitDown).not.toBe(rawSitDown);
    expect(sitDown.validate()).toBe(true);

    for (const side of SIDES) {
      const uaBind = getBindLocalQ(lib, `upperarm${side}`);
      const padBind = getBindLocalQ(lib, `armor_shoulder${side}`);
      const downInBind = new THREE.Vector3(0, -1, 0).applyQuaternion(
        getBindWorldQ(lib, `upperarm${side}`).clone().invert(),
      );

      for (const clip of [sitIdle, sitDown]) {
        const uaTrack = getQuatTrack(clip, `upperarm${side}`);
        const padTrack = getQuatTrack(clip, `armor_shoulder${side}`);
        expect(uaTrack.times.length).toBe(padTrack.times.length);
        for (let i = 0; i < uaTrack.times.length; i++) {
          const uaQ = new THREE.Quaternion().fromArray(uaTrack.values, i * 4);
          const padQ = new THREE.Quaternion().fromArray(padTrack.values, i * 4);
          const expected = pauldronLocal(uaBind, uaQ, padBind, downInBind);
          const tsExpected = wocPauldronLocal(uaBind, uaQ, padBind, downInBind);
          expect(padQ.angleTo(expected) * DEG).toBeLessThan(0.05);
          expect(tsExpected.angleTo(expected) * DEG).toBeLessThan(1e-4);
        }
      }

      for (const part of [
        'clavicle',
        'upperarm',
        'armor_shoulder',
        'lowerarm',
        'wrist',
        'hand',
      ] as const) {
        const idleTrack = getQuatTrack(sitIdle, `${part}${side}`);
        const downTrack = getQuatTrack(sitDown, `${part}${side}`);
        const rawDownTrack = getQuatTrack(rawSitDown, `${part}${side}`);

        const idleStart = new THREE.Quaternion().fromArray(idleTrack.values, 0).normalize();
        const idleEnd = new THREE.Quaternion()
          .fromArray(idleTrack.values, (idleTrack.times.length - 1) * 4)
          .normalize();
        const downStart = new THREE.Quaternion().fromArray(downTrack.values, 0).normalize();
        const downEnd = new THREE.Quaternion()
          .fromArray(downTrack.values, (downTrack.times.length - 1) * 4)
          .normalize();
        const rawDownStart = new THREE.Quaternion().fromArray(rawDownTrack.values, 0).normalize();

        // Sit_Idle loop seam is exact in Float32 (< 0.05 deg).
        expect(idleStart.angleTo(idleEnd) * DEG).toBeLessThan(0.05);
        // Sit_Down starts from its standing pose (bar the shoulder pad, which follows the arm)
        // and lands on Sit_Idle frame 0 (< 0.05 deg).
        if (part !== 'armor_shoulder') {
          expect(downStart.angleTo(rawDownStart) * DEG).toBeLessThan(0.5);
        }
        expect(downEnd.angleTo(idleStart) * DEG).toBeLessThan(0.05);
      }
    }
  });

  it('memoizes the prepared clips across visual defs of the same fit and no-ops on mock rigs', () => {
    const secondMap = new Map<string, THREE.AnimationClip>([
      ['Sit_Idle', rawSitIdle],
      ['Sit_Down', rawSitDown],
    ]);
    prepareWocSitClips(fit, secondMap, lib.scene);
    expect(secondMap.get('Sit_Idle')).toBe(lib.clips.get('Sit_Idle'));
    expect(secondMap.get('Sit_Down')).toBe(lib.clips.get('Sit_Down'));

    const mockRoot = new THREE.Group();
    const mockClip = new THREE.AnimationClip('Sit_Idle', 1, []);
    const mockMap = new Map<string, THREE.AnimationClip>([['Sit_Idle', mockClip]]);
    prepareWocSitClips(fit, mockMap, mockRoot);
    expect(mockMap.get('Sit_Idle')).toBe(mockClip);
  });
});
