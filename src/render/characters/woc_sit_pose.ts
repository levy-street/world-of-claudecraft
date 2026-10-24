// Repairs the seated arm, elbow and wrist tracks on the WOC animation libraries'
// `Sit_Idle` and `Sit_Down` clips (`public/models/chars/players/woc/anims_<fit>.glb`).
//
// Every WOC character (all 18 player class/fit defs and every WOC NPC) uses `Sit_Down`
// and `Sit_Idle` for ground `/sit`, chair/bench seating (`seated_pose.ts`) and mount
// riding (`mount_visuals.ts`). The September 2026 artist export shipped those clips with
// inverted arm IK poles and twisted wrist targets: the elbows tucked into the ribs
// (and flipped mid-breath on the female rig), the forearms supinated palm-up, and the
// left wrist bent sharply down or 90 degrees inward.
//
// At `prepareVisual` time, this module replaces only the upper-limb rotation tracks
// (`clavicle`, `upperarm`, `armor_shoulder`, `lowerarm`, `wrist`, `hand`) of `Sit_Idle`
// and `Sit_Down` while keeping the lower-body, pelvis, spine, chest, neck and head
// tracks untouched. The rewritten clips are memoized per source clip so all classes of
// a fit share one pair of `AnimationClip` instances.
import * as THREE from 'three';
import type { WocFit } from './woc_armor_core';

export interface WocSitArmSpec {
  readonly clav: readonly [elevateDeg: number, protractDeg: number];
  readonly raise: number;
  readonly plane: number;
  readonly twist: number;
  readonly elbow: number;
  readonly pronate: number;
  readonly wristFlex: number;
  readonly wristDev: number;
  readonly breathFollow: number;
}

export const WOC_SIT_ARM_POSE: Readonly<Record<WocFit, WocSitArmSpec>> = {
  male: {
    clav: [1, 5],
    raise: 36,
    plane: 24,
    twist: 12,
    elbow: 98,
    pronate: 58,
    wristFlex: -2,
    wristDev: -3,
    breathFollow: 0.25,
  },
  female: {
    clav: [1, 5],
    raise: 36,
    plane: 18,
    twist: 12,
    elbow: 100,
    pronate: 58,
    wristFlex: -2,
    wristDev: -3,
    breathFollow: 0.25,
  },
};

/** Fractions of the upper arm's swing out of the T-pose bind that the shoulder pad takes
 *  (matching `scripts/assets/woc_keyed_anims/keyed/pauldron.mjs`). */
const PAULDRON_FOLLOW = { swing: 0.5, drop: 0.45, lift: 0.3 } as const;

const DEG = Math.PI / 180;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const DOWN_AXIS = new THREE.Vector3(0, -1, 0);

const SIDES = ['l', 'r'] as const;
type Side = (typeof SIDES)[number];

const ARM_PARTS = ['clavicle', 'upperarm', 'armor_shoulder', 'lowerarm', 'wrist', 'hand'] as const;
type ArmPart = (typeof ARM_PARTS)[number];
type ArmBoneName = `${ArmPart}${Side}`;

function axisAngle(axis: THREE.Vector3, deg: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(axis, deg * DEG);
}

function mirrorX(q: THREE.Quaternion): THREE.Quaternion {
  return new THREE.Quaternion(q.x, -q.y, -q.z, q.w);
}

function sideRot(side: Side, q: THREE.Quaternion): THREE.Quaternion {
  return side === 'l' ? q : mirrorX(q);
}

/** Canonical WOC shoulder-pad local rotation for an upper-arm local rotation under the clavicle. */
export function wocPauldronLocal(
  armBind: THREE.Quaternion,
  armLocal: THREE.Quaternion,
  padBind: THREE.Quaternion,
  downInArmBind: THREE.Vector3,
): THREE.Quaternion {
  const delta = armBind.clone().invert().multiply(armLocal);
  const swing = new THREE.Quaternion().setFromUnitVectors(
    Y_AXIS,
    Y_AXIS.clone().applyQuaternion(delta),
  );
  const w = Math.min(1, Math.max(-1, swing.w));
  const half = Math.sqrt(1 - w * w);
  if (half < 1e-9) return padBind.clone();
  const turn = new THREE.Vector3(swing.x, swing.y, swing.z).multiplyScalar(
    (2 * Math.acos(w)) / half,
  );
  const vertical = downInArmBind.clone().normalize();
  const dropAxis = Y_AXIS.clone().cross(vertical).normalize();
  const dropped = turn.dot(dropAxis);
  const follow = dropAxis
    .multiplyScalar(dropped * (dropped > 0 ? PAULDRON_FOLLOW.drop : PAULDRON_FOLLOW.lift))
    .addScaledVector(vertical, turn.dot(vertical) * PAULDRON_FOLLOW.swing);
  const angle = follow.length();
  if (angle < 1e-12) return padBind.clone();
  return padBind
    .clone()
    .multiply(new THREE.Quaternion().setFromAxisAngle(follow.divideScalar(angle), angle))
    .normalize();
}

function findBone(root: THREE.Object3D, sanitized: string, dotted: string): THREE.Object3D | null {
  return root.getObjectByName(sanitized) ?? root.getObjectByName(dotted) ?? null;
}

/** Bind-pose world quaternion of `node` relative to `root`, computed purely from the node
 *  chain's rest local quaternions without mutating `root`'s world matrices. */
function chainRestWorldQ(node: THREE.Object3D, root: THREE.Object3D): THREE.Quaternion {
  const chain: THREE.Object3D[] = [];
  let cur: THREE.Object3D | null = node;
  while (cur && cur !== root) {
    chain.push(cur);
    cur = cur.parent;
  }
  const out = new THREE.Quaternion();
  for (let i = chain.length - 1; i >= 0; i--) {
    out.multiply(chain[i].quaternion);
  }
  return out.normalize();
}

interface RigBindPose {
  readonly torsoLocal: {
    readonly hips: THREE.Quaternion;
    readonly spine: THREE.Quaternion;
    readonly chest: THREE.Quaternion;
  };
  readonly chestWorld: THREE.Quaternion;
  readonly armLocal: Readonly<Record<ArmBoneName, THREE.Quaternion>>;
  readonly armWorld: Readonly<Record<ArmBoneName, THREE.Quaternion>>;
  readonly downInArmBind: Readonly<Record<Side, THREE.Vector3>>;
}

function readRigBindPose(root: THREE.Object3D): RigBindPose | null {
  const hips = findBone(root, 'hips', 'hips');
  const spine = findBone(root, 'spine', 'spine');
  const chest = findBone(root, 'chest', 'chest');
  if (!hips || !spine || !chest) return null;

  const armLocal = {} as Record<ArmBoneName, THREE.Quaternion>;
  const armWorld = {} as Record<ArmBoneName, THREE.Quaternion>;
  for (const side of SIDES) {
    for (const part of ARM_PARTS) {
      const sanitized = `${part}${side}` as ArmBoneName;
      const node = findBone(root, sanitized, `${part}.${side}`);
      if (!node) return null;
      armLocal[sanitized] = node.quaternion.clone().normalize();
      armWorld[sanitized] = chainRestWorldQ(node, root);
    }
  }
  return {
    torsoLocal: {
      hips: hips.quaternion.clone().normalize(),
      spine: spine.quaternion.clone().normalize(),
      chest: chest.quaternion.clone().normalize(),
    },
    chestWorld: chainRestWorldQ(chest, root),
    armLocal,
    armWorld,
    downInArmBind: {
      l: DOWN_AXIS.clone().applyQuaternion(armWorld.upperarml.clone().invert()),
      r: DOWN_AXIS.clone().applyQuaternion(armWorld.upperarmr.clone().invert()),
    },
  };
}

function makeQuatSampler(
  clip: THREE.AnimationClip,
  boneName: string,
  fallback: THREE.Quaternion,
): (t: number) => THREE.Quaternion {
  const track = clip.tracks.find((tr) => tr.name === `${boneName}.quaternion`);
  if (!track) return () => fallback.clone();
  const interp = track.createInterpolant();
  const first = track.times[0] ?? 0;
  const last = track.times[track.times.length - 1] ?? 0;
  return (t: number) => {
    const clamped = Math.min(Math.max(t, first), last);
    const arr = interp.evaluate(clamped);
    return new THREE.Quaternion(arr[0], arr[1], arr[2], arr[3]).normalize();
  };
}

function enforceSignContinuity(quats: THREE.Quaternion[]): Float32Array {
  const out = new Float32Array(quats.length * 4);
  for (let i = 0; i < quats.length; i++) {
    const q = quats[i];
    if (i > 0) {
      const prev = quats[i - 1];
      if (prev.x * q.x + prev.y * q.y + prev.z * q.z + prev.w * q.w < 0) {
        q.set(-q.x, -q.y, -q.z, -q.w);
      }
    }
    q.toArray(out, i * 4);
  }
  return out;
}

function replaceTracks(
  clip: THREE.AnimationClip,
  replacements: ReadonlyMap<string, THREE.QuaternionKeyframeTrack>,
): THREE.AnimationClip {
  const tracks = clip.tracks.map((tr) => replacements.get(tr.name) ?? tr);
  for (const [name, track] of replacements) {
    if (!tracks.some((tr) => tr.name === name)) tracks.push(track);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}

/** Computes the local arm-chain quaternions for a single seated frame given `chestWorldQt`
 *  (the current chest world quaternion) and `dampedChestQ` (the breath-damped chest world
 *  quaternion used to keep the palms resting steadily on the knees). */
function solveSeatedArmLocals(
  spec: WocSitArmSpec,
  bind: RigBindPose,
  chestWorldQt: THREE.Quaternion,
  dampedChestQ: THREE.Quaternion,
): Record<ArmBoneName, THREE.Quaternion> {
  const chestBindInv = bind.chestWorld.clone().invert();
  const fullCarried = chestWorldQt.clone().multiply(chestBindInv);
  const dampedCarried = dampedChestQ.clone().multiply(chestBindInv);

  const clavF = axisAngle(Z_AXIS, spec.clav[0]).multiply(axisAngle(Y_AXIS, -spec.clav[1]));
  const r = spec.raise * DEG;
  const pl = spec.plane * DEG;
  const dir = new THREE.Vector3(
    Math.sin(r) * Math.cos(pl),
    -Math.cos(r),
    Math.sin(r) * Math.sin(pl),
  );
  const swing = new THREE.Quaternion().setFromUnitVectors(DOWN_AXIS, dir);
  const uaF = clavF
    .clone()
    .multiply(swing)
    .multiply(axisAngle(DOWN_AXIS, spec.twist))
    .multiply(axisAngle(Z_AXIS, -90));
  const laF = uaF
    .clone()
    .multiply(axisAngle(Y_AXIS, -spec.elbow))
    .multiply(axisAngle(X_AXIS, spec.pronate));
  const wrF = laF
    .clone()
    .multiply(axisAngle(Z_AXIS, -spec.wristFlex))
    .multiply(axisAngle(Y_AXIS, -spec.wristDev));

  const out = {} as Record<ArmBoneName, THREE.Quaternion>;
  for (const side of SIDES) {
    const clavName = `clavicle${side}` as const;
    const uaName = `upperarm${side}` as const;
    const padName = `armor_shoulder${side}` as const;
    const laName = `lowerarm${side}` as const;
    const wrName = `wrist${side}` as const;
    const hdName = `hand${side}` as const;

    const clavWorld = fullCarried
      .clone()
      .multiply(sideRot(side, clavF))
      .multiply(bind.armWorld[clavName])
      .normalize();
    const clavLocal = chestWorldQt.clone().invert().multiply(clavWorld).normalize();

    const uaWorld = dampedCarried
      .clone()
      .multiply(sideRot(side, uaF))
      .multiply(bind.armWorld[uaName])
      .normalize();
    const uaLocal = clavWorld.clone().invert().multiply(uaWorld).normalize();

    const padLocal = wocPauldronLocal(
      bind.armLocal[uaName],
      uaLocal,
      bind.armLocal[padName],
      bind.downInArmBind[side],
    );

    const laWorld = dampedCarried
      .clone()
      .multiply(sideRot(side, laF))
      .multiply(bind.armWorld[laName])
      .normalize();
    const laLocal = uaWorld.clone().invert().multiply(laWorld).normalize();

    const wrWorld = dampedCarried
      .clone()
      .multiply(sideRot(side, wrF))
      .multiply(bind.armWorld[wrName])
      .normalize();
    const wrLocal = laWorld.clone().invert().multiply(wrWorld).normalize();

    out[clavName] = clavLocal;
    out[uaName] = uaLocal;
    out[padName] = padLocal;
    out[laName] = laLocal;
    out[wrName] = wrLocal;
    out[hdName] = bind.armLocal[hdName].clone();
  }
  return out;
}

function buildSitIdleClip(
  sitIdle: THREE.AnimationClip,
  spec: WocSitArmSpec,
  bind: RigBindPose,
): { clip: THREE.AnimationClip; frame0Locals: Record<ArmBoneName, THREE.Quaternion> } {
  const refTrack =
    sitIdle.tracks.find((tr) => tr.name === 'chest.quaternion') ??
    sitIdle.tracks.find((tr) => tr.name === 'upperarml.quaternion');
  const times = refTrack
    ? Float32Array.from(refTrack.times)
    : Float32Array.from([0, sitIdle.duration]);

  const sampleHips = makeQuatSampler(sitIdle, 'hips', bind.torsoLocal.hips);
  const sampleSpine = makeQuatSampler(sitIdle, 'spine', bind.torsoLocal.spine);
  const sampleChest = makeQuatSampler(sitIdle, 'chest', bind.torsoLocal.chest);
  const chestWorldAt = (t: number): THREE.Quaternion =>
    sampleHips(t).multiply(sampleSpine(t)).multiply(sampleChest(t)).normalize();

  const chestWorld0 = chestWorldAt(0);
  const perBone = new Map<ArmBoneName, THREE.Quaternion[]>();
  for (const side of SIDES) {
    for (const part of ARM_PARTS) perBone.set(`${part}${side}`, []);
  }

  let frame0Locals: Record<ArmBoneName, THREE.Quaternion> | null = null;
  for (let i = 0; i < times.length; i++) {
    const chestQt = i === times.length - 1 ? chestWorld0.clone() : chestWorldAt(times[i]);
    const dampedChestQ = chestWorld0.clone().slerp(chestQt, spec.breathFollow);
    const locals = solveSeatedArmLocals(spec, bind, chestQt, dampedChestQ);
    if (i === 0) frame0Locals = locals;
    for (const [bone, list] of perBone) {
      list.push(i === times.length - 1 && frame0Locals ? frame0Locals[bone].clone() : locals[bone]);
    }
  }

  const replacements = new Map<string, THREE.QuaternionKeyframeTrack>();
  for (const [bone, quats] of perBone) {
    const trackName = `${bone}.quaternion`;
    replacements.set(
      trackName,
      new THREE.QuaternionKeyframeTrack(trackName, times, enforceSignContinuity(quats)),
    );
  }
  return {
    clip: replaceTracks(sitIdle, replacements),
    frame0Locals: frame0Locals ?? solveSeatedArmLocals(spec, bind, chestWorld0, chestWorld0),
  };
}

function buildSitDownClip(
  sitDown: THREE.AnimationClip,
  bind: RigBindPose,
  targetLocals: Record<ArmBoneName, THREE.Quaternion>,
): THREE.AnimationClip {
  const refTrack =
    sitDown.tracks.find((tr) => tr.name === 'upperarml.quaternion') ??
    sitDown.tracks.find((tr) => tr.name === 'chest.quaternion');
  const times = refTrack
    ? Float32Array.from(refTrack.times)
    : Float32Array.from([0, sitDown.duration]);
  const duration = Math.max(1e-6, times[times.length - 1] ?? sitDown.duration);

  const startLocals = {} as Record<ArmBoneName, THREE.Quaternion>;
  for (const side of SIDES) {
    for (const part of ARM_PARTS) {
      const bone = `${part}${side}` as ArmBoneName;
      startLocals[bone] = makeQuatSampler(sitDown, bone, bind.armLocal[bone])(0);
    }
  }

  const perBone = new Map<ArmBoneName, THREE.Quaternion[]>();
  for (const side of SIDES) {
    for (const part of ARM_PARTS) perBone.set(`${part}${side}`, []);
  }

  for (let i = 0; i < times.length; i++) {
    const u = Math.min(1, Math.max(0, times[i] / duration));
    const alpha = u * u * (3 - 2 * u);
    for (const side of SIDES) {
      for (const part of ['clavicle', 'upperarm', 'lowerarm', 'wrist', 'hand'] as const) {
        const bone = `${part}${side}` as ArmBoneName;
        const q = startLocals[bone].clone().slerp(targetLocals[bone], alpha).normalize();
        perBone.get(bone)?.push(q);
      }
      const uaName = `upperarm${side}` as const;
      const padName = `armor_shoulder${side}` as const;
      const uaLocal = perBone.get(uaName)?.[i] ?? targetLocals[uaName];
      const padLocal = wocPauldronLocal(
        bind.armLocal[uaName],
        uaLocal,
        bind.armLocal[padName],
        bind.downInArmBind[side],
      );
      perBone.get(padName)?.push(padLocal);
    }
  }

  const replacements = new Map<string, THREE.QuaternionKeyframeTrack>();
  for (const [bone, quats] of perBone) {
    const trackName = `${bone}.quaternion`;
    replacements.set(
      trackName,
      new THREE.QuaternionKeyframeTrack(trackName, times, enforceSignContinuity(quats)),
    );
  }
  return replaceTracks(sitDown, replacements);
}

const preparedSitCache = new WeakMap<
  THREE.AnimationClip,
  { sitIdle: THREE.AnimationClip; sitDown?: THREE.AnimationClip }
>();

/** Replaces `Sit_Idle` and `Sit_Down` in `clips` with copies whose arms, elbows and wrists
 *  rest palms-down with elbows angled outward. Safe no-op on non-WOC or minimal mock rigs. */
export function prepareWocSitClips(
  fit: WocFit,
  clips: Map<string, THREE.AnimationClip>,
  rig: THREE.Object3D,
): void {
  const sitIdle = clips.get('Sit_Idle');
  if (!sitIdle) return;
  const cached = preparedSitCache.get(sitIdle);
  if (cached) {
    clips.set('Sit_Idle', cached.sitIdle);
    if (cached.sitDown && clips.has('Sit_Down')) clips.set('Sit_Down', cached.sitDown);
    return;
  }

  const bind = readRigBindPose(rig);
  if (!bind) return;

  const spec = WOC_SIT_ARM_POSE[fit];
  const { clip: nextSitIdle, frame0Locals } = buildSitIdleClip(sitIdle, spec, bind);
  const sitDown = clips.get('Sit_Down');
  const nextSitDown = sitDown ? buildSitDownClip(sitDown, bind, frame0Locals) : undefined;

  preparedSitCache.set(sitIdle, { sitIdle: nextSitIdle, sitDown: nextSitDown });
  clips.set('Sit_Idle', nextSitIdle);
  if (nextSitDown) clips.set('Sit_Down', nextSitDown);
}
