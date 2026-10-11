import { Matrix4, Quaternion, Vector3 } from 'three';

// Leave room for the exported quaternion interpolation between baked samples.
const FLOOR_MARGIN = 0.045;
const UP = new Vector3(0, 1, 0);
const UNTOUCHED = new Set([
  'Warrior_Bladestorm_Loop',
  'Warrior_Bladed_Gyre',
  // Coupled two-handed grips already pass their independent gear proof.
  'Warrior_Breachmaker',
  'Warrior_Sword_Guard',
]);

function mount(position, quaternion, scale) {
  return new Matrix4().compose(
    new Vector3(...position),
    new Quaternion(...quaternion),
    new Vector3().setScalar(scale),
  );
}

/** Read actual decoded mesh vertices, matching the native-contact proof. */
async function vertices(io, name) {
  const doc = await io.read(`public/models/weapons/${name}.glb`);
  const meshes = doc.getRoot().listMeshes();
  if (meshes.length !== 1 || meshes[0].listPrimitives().length !== 1)
    throw new Error(`Clearance fixture changed: ${name}`);
  const positions = meshes[0].listPrimitives()[0].getAttribute('POSITION');
  if (!positions) throw new Error(`Clearance mesh lacks positions: ${name}`);
  return Array.from({ length: positions.getCount() }, (_, i) =>
    new Vector3().fromArray(positions.getElement(i, [])),
  );
}

/** Offline collision correction. No runtime IK, root movement, foot changes or
 * bone scaling. Clear poses remain byte-identical; only a wrist whose actual
 * attached gear crosses the floor margin is lifted by the smallest local turn.
 * An upper-arm correction is a bounded fallback for an obstructed low wrist. */
export async function createWarriorWeaponClearance(io, rig, bones, applyPose, setWorldRotation) {
  const blade = await vertices(io, 'adv_sword_2handed_color');
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const vertex of blade) {
    min.min(vertex);
    max.max(vertex);
  }
  const bladeBounds = [];
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y])
      for (const z of [min.z, max.z]) bladeBounds.push(new Vector3(x, y, z));
  const sword = await vertices(io, 'sword_1handed');
  const shield = await vertices(io, 'shield_round');
  const bladeScale = Math.min(1, 2 / (max.y - min.y));
  const hands = ['l', 'r'].map((side) => {
    const q = side === 'r' ? [0, 1, 0, 0] : [0, 0, 0, 1];
    const fixtures = [
      [bladeBounds, mount([0, 0.04, 0], q, bladeScale)],
      [sword, mount([0, 0.555174, 0], q, 0.8876)],
    ];
    if (side === 'l') fixtures.push([shield, mount([0, 0.017, 0.1771], q, 0.4413)]);
    return {
      side,
      wrist: bones.get(`wrist.${side}`),
      arm: bones.get(`upperarm.${side}`),
      slot: bones.get(`handslot.${side}`),
      points: fixtures.flatMap(([points, transform]) =>
        points.map((point) => point.clone().applyMatrix4(transform)),
      ),
    };
  });
  if (hands.some((hand) => !hand.wrist || !hand.arm || !hand.slot))
    throw new Error('Clearance rig lacks native wrist/arm/socket');
  const scratch = new Vector3(),
    worst = new Vector3(),
    pivot = new Vector3();
  const axis = new Vector3(),
    radial = new Vector3();
  const report = {
    floorMargin: FLOOR_MARGIN,
    correctedSamples: 0,
    maxCorrectionRadians: 0,
    maxCorrection: null,
    upperArmFallbacks: 0,
  };
  function minimum(hand) {
    let low = Infinity;
    for (const point of hand.points) {
      scratch.copy(point).applyMatrix4(hand.slot.matrixWorld);
      if (scratch.y < low) {
        low = scratch.y;
        worst.copy(scratch);
      }
    }
    return low;
  }
  return {
    report,
    correct(pose, name, time, duration) {
      if (UNTOUCHED.has(name) || time <= 0 || time >= duration - 1e-10) return pose;
      applyPose(pose);
      let corrected = false;
      for (const hand of hands) {
        // The spirit hammer borrows the right hand; actual offhand equipment
        // remains visible and is still checked against its production mounts.
        if (name === 'Warrior_Storm_Bolt' && hand.side === 'r') continue;
        const original = hand.wrist.getWorldQuaternion(new Quaternion()).normalize();
        let low = minimum(hand),
          iteration = 0;
        while (low < FLOOR_MARGIN && iteration < 96) {
          // A sufficiently low wrist may not admit every shield/blade corner
          // simultaneously. Raise the whole arm chain after the wrist-only
          // solve has had a bounded opportunity to find its nearest solution.
          const joint =
            name === 'Warrior_Faultline' && hand.side === 'l'
              ? hand.arm
              : iteration < 48
                ? hand.wrist
                : hand.arm;
          joint.getWorldPosition(pivot);
          radial.copy(worst).sub(pivot);
          const radius = radial.length();
          if (!(radius > 1e-8)) throw new Error(`Degenerate clearance lever ${name}/${hand.side}`);
          const from = Math.asin(Math.max(-1, Math.min(1, radial.y / radius)));
          const to = Math.asin(
            Math.max(-1, Math.min(1, (FLOOR_MARGIN + 0.002 - pivot.y) / radius)),
          );
          const angle = Math.max(0.001, Math.min(0.14, to - from + 0.001));
          axis.crossVectors(radial, UP);
          if (axis.lengthSq() < 1e-10) axis.set(1, 0, 0);
          else axis.normalize();
          const rotation = new Quaternion()
            .setFromAxisAngle(axis, angle)
            .multiply(joint.getWorldQuaternion(new Quaternion()).normalize())
            .normalize();
          setWorldRotation(joint, rotation);
          pose.set(`${joint.name}|rotation`, joint.quaternion.toArray());
          if (joint === hand.arm) report.upperArmFallbacks++;
          corrected = true;
          iteration++;
          rig.updateMatrixWorld(true);
          low = minimum(hand);
        }
        if (low < FLOOR_MARGIN - 1e-6)
          throw new Error(
            `Unresolved native weapon clearance ${name}/${hand.side} at ${time}: ${low}`,
          );
        const angle = hand.wrist.getWorldQuaternion(new Quaternion()).normalize().angleTo(original);
        if (angle > report.maxCorrectionRadians) {
          report.maxCorrectionRadians = angle;
          report.maxCorrection = { name, side: hand.side, time, angle };
        }
      }
      if (corrected) report.correctedSamples++;
      return pose;
    },
  };
}
