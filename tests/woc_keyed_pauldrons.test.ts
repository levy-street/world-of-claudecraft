// The shoulder pads on the hand-keyed WOC clips (scripts/assets/woc_keyed_anims).
//
// A pad is a rigid part on its own armor_shoulder bone beside the upper arm, and the
// rig's own library (anims_<fit>.glb) keys it to take only part of the arm's swing, so
// the plate stays on top of the shoulder. The keyed clips once copied most of the arm's
// swing onto it instead, and every WOC body (every player class and every NPC) wore its
// pads tipped about 80 degrees down the outside of a hanging arm. Three pins: the rule
// (keyed/pauldron.mjs) is the rig's own, every frame of the shipped keyed clips follows
// the rule, and at the keyed idle, walk and run the pads sit where the rig's own clips
// put them.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PAULDRON_FOLLOW,
  pauldronLocal,
} from '../scripts/assets/woc_keyed_anims/keyed/pauldron.mjs';
import { type WocFit, wocAnimsUrl } from '../src/render/characters/woc_armor_core';
import { wocKeyedAnimsUrl } from '../src/render/characters/woc_keyed_animations';

const FITS: readonly WocFit[] = ['male', 'female'];
const SIDES = ['l', 'r'] as const;
type Side = (typeof SIDES)[number];
const DEG = 180 / Math.PI;
const Y = new THREE.Vector3(0, 1, 0);

interface Library {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

async function load(url: string): Promise<Library> {
  await MeshoptDecoder.ready;
  const bytes = readFileSync(path.resolve(__dirname, '..', 'public', url));
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(new Uint8Array(bytes).buffer, '');
  return { scene: gltf.scene, clips: gltf.animations };
}

/** GLTFLoader drops the dot from a node name (`upperarm.l` loads as `upperarml`). */
const nodeName = (bone: string): string => THREE.PropertyBinding.sanitizeNodeName(bone);

function boneOf(scene: THREE.Object3D, bone: string): THREE.Object3D {
  const found = scene.getObjectByName(nodeName(bone));
  if (!found) throw new Error(`no bone ${bone}`);
  return found;
}

const worldQ = (o: THREE.Object3D): THREE.Quaternion =>
  o.getWorldQuaternion(new THREE.Quaternion());

/** The bind facts the rule reads, off the keyed library's own node tree (the base rig's). */
interface SideBind {
  armBind: THREE.Quaternion;
  padBind: THREE.Quaternion;
  down: THREE.Vector3;
  padWorld: THREE.Quaternion;
}

function bindOf(scene: THREE.Object3D): { sides: Record<Side, SideBind>; chest: THREE.Quaternion } {
  scene.updateMatrixWorld(true);
  const side = (s: Side): SideBind => {
    const arm = boneOf(scene, `upperarm.${s}`);
    const pad = boneOf(scene, `armor_shoulder.${s}`);
    return {
      armBind: arm.quaternion.clone(),
      padBind: pad.quaternion.clone(),
      down: new THREE.Vector3(0, -1, 0).applyQuaternion(worldQ(arm).invert()),
      padWorld: worldQ(pad),
    };
  };
  return { sides: { l: side('l'), r: side('r') }, chest: worldQ(boneOf(scene, 'chest')) };
}

function track(clip: THREE.AnimationClip, bone: string): THREE.KeyframeTrack | undefined {
  return clip.tracks.find((t) => t.name === `${nodeName(bone)}.quaternion`);
}

const keyAt = (t: THREE.KeyframeTrack, i: number): THREE.Quaternion =>
  new THREE.Quaternion().fromArray(t.values, i * 4).normalize();

/** Degrees between the long axes (local +Y) of two local rotations. */
const axisError = (a: THREE.Quaternion, b: THREE.Quaternion): number =>
  Y.clone().applyQuaternion(a).angleTo(Y.clone().applyQuaternion(b)) * DEG;

/** Every keyframe of every clip that moves an upper arm: the rule's pad against the clip's. */
function ruleErrors(lib: Library, bind: Record<Side, SideBind>): number[] {
  const errors: number[] = [];
  for (const side of SIDES) {
    const { armBind, padBind, down } = bind[side];
    for (const clip of lib.clips) {
      const arm = track(clip, `upperarm.${side}`);
      if (!arm) continue;
      const pad = track(clip, `armor_shoulder.${side}`);
      if (pad) expect(Array.from(pad.times), `${clip.name} ${side}`).toEqual(Array.from(arm.times));
      for (let i = 0; i < arm.times.length; i++) {
        const expected = pauldronLocal(armBind, keyAt(arm, i), padBind, down);
        errors.push(axisError(pad ? keyAt(pad, i) : padBind, expected));
      }
    }
  }
  return errors.sort((a, b) => a - b);
}

const quantile = (sorted: number[], q: number): number =>
  sorted[Math.floor(q * (sorted.length - 1))];

/** Mean tilt (degrees) of the pad's bind-pose up away from the chest's over a clip, played
 *  on the keyed library's rig. */
function padTilt(
  rig: Library,
  bind: ReturnType<typeof bindOf>,
  clip: THREE.AnimationClip,
  side: Side,
): number {
  const root = rig.scene;
  const pad = boneOf(root, `armor_shoulder.${side}`);
  const chest = boneOf(root, 'chest');
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const steps = 24;
  let sum = 0;
  for (let k = 0; k < steps; k++) {
    mixer.setTime((clip.duration * k) / steps);
    root.updateMatrixWorld(true);
    const padUp = Y.clone().applyQuaternion(
      worldQ(pad).multiply(bind.sides[side].padWorld.clone().invert()),
    );
    const chestUp = Y.clone().applyQuaternion(worldQ(chest).multiply(bind.chest.clone().invert()));
    sum += padUp.angleTo(chestUp) * DEG;
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  return sum / steps;
}

const clipNamed = (lib: Library, name: string): THREE.AnimationClip => {
  const clip = lib.clips.find((c) => c.name === name);
  if (!clip) throw new Error(`no clip ${name}`);
  return clip;
};

describe.each(FITS)('%s pauldrons', (fit) => {
  let keyed: Library;
  let own: Library;
  let bind: ReturnType<typeof bindOf>;
  beforeAll(async () => {
    keyed = await load(wocKeyedAnimsUrl(fit));
    own = await load(wocAnimsUrl(fit));
    bind = bindOf(keyed.scene);
  });

  it("the rule is the rig's own: it predicts the pad on every frame of anims_<fit>.glb", () => {
    expect(PAULDRON_FOLLOW).toEqual({ swing: 0.5, drop: 0.45, lift: 0.3 });
    const errors = ruleErrors(own, bind.sides);
    expect(errors.length).toBeGreaterThan(5000);
    expect(quantile(errors, 0.5)).toBeLessThan(1.5);
    expect(quantile(errors, 0.9)).toBeLessThan(6);
    expect(quantile(errors, 0.99)).toBeLessThan(12);
  });

  it('every frame of every shipped hand-keyed clip carries the pads by that rule', () => {
    const errors = ruleErrors(keyed, bind.sides);
    expect(errors.length).toBeGreaterThan(2000);
    expect(errors.at(-1)).toBeLessThan(0.5);
  });

  it.each([
    ['Woc_Idle', 'Idle'],
    ['Woc_Walk', 'Walk'],
    ['Woc_Run', 'Run'],
  ])("at %s the pads sit on the shoulders, as the rig's own %s carries them", (k, o) => {
    for (const side of SIDES) {
      const tilt = padTilt(keyed, bind, clipNamed(keyed, k), side);
      const ownTilt = padTilt(keyed, bind, clipNamed(own, o), side);
      // The old keyed clips tipped them 67 to 85 degrees; the rig's own, 29 to 40.
      expect(tilt, `${k} ${side}`).toBeLessThan(45);
      expect(Math.abs(tilt - ownTilt), `${k} against ${o} ${side}`).toBeLessThan(12);
    }
  });
});
