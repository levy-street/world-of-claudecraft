import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

const vec = (a) => new Vector3(...a);
const quat = (a) => new Quaternion(...a).normalize();
const rotation = (a) => new Quaternion().setFromEuler(new Euler(...a, 'XYZ'));
function frameRotation(axis, roll) {
  const y = axis.clone().normalize();
  const x = y.clone().cross(roll).normalize();
  const z = x.clone().cross(y).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

export function rigFromDocument(doc) {
  const nodes = doc
    .getRoot()
    .listNodes()
    .filter((n) => !n.getMesh());
  return nodes.map((n) => ({
    name: n.getName(),
    parent: nodes.indexOf(n.getParentNode()),
    t: n.getTranslation(),
    q: n.getRotation(),
    s: n.getScale(),
  }));
}

/** Forward kinematics includes socket scale, although no motion changes any scale. */
export function worldPose(rig, local) {
  const cache = new Map();
  function visit(i) {
    const b = rig[i];
    if (cache.has(b.name)) return cache.get(b.name);
    const p = vec(local[b.name]?.t ?? b.t);
    const q = quat(local[b.name]?.q ?? b.q);
    const s = vec(b.s);
    if (b.parent >= 0) {
      const parent = visit(b.parent);
      p.multiply(parent.s).applyQuaternion(parent.q).add(parent.p);
      q.premultiply(parent.q);
      s.multiply(parent.s);
    }
    const result = { p, q, s };
    cache.set(b.name, result);
    return result;
  }
  rig.forEach((_, i) => {
    visit(i);
  });
  return cache;
}

/** Analytic two-bone IK: only joint rotations change; lengths remain the rig's own. */
export function jointPoint(origin, target, pole, lengthA, lengthB) {
  const delta = target.clone().sub(origin);
  const distance = Math.min(
    lengthA + lengthB - 1e-6,
    Math.max(Math.abs(lengthA - lengthB) + 1e-6, delta.length()),
  );
  const aim = delta.normalize();
  const bend = pole.clone().sub(origin);
  bend.addScaledVector(aim, -bend.dot(aim));
  if (bend.lengthSq() < 1e-10) bend.set(0, 0, 1).addScaledVector(aim, -aim.z);
  bend.normalize();
  const along = (lengthA * lengthA - lengthB * lengthB + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, lengthA * lengthA - along * along));
  return origin.clone().addScaledVector(aim, along).addScaledVector(bend, height);
}

/** Fresh authored effector poses -> local rotations on the existing character bind rig. */
export function makePoseSolver(rig) {
  const byName = new Map(rig.map((b) => [b.name, b]));
  const rest = worldPose(rig, {});
  const scale = rest.get('hips').p.y / 0.595;
  return (pose) => {
    const local = {};
    let worlds;
    const refresh = () => {
      worlds = worldPose(rig, local);
    };
    const body = rotation(pose.bodyEuler);
    const pivot = vec(pose.bodyPivot);
    const point = (p) => vec(p).sub(pivot).applyQuaternion(body).add(pivot).multiplyScalar(scale);
    const setWorld = (name, q) => {
      const b = byName.get(name);
      const parent = b.parent < 0 ? new Quaternion() : worlds.get(rig[b.parent].name).q;
      local[name] = {
        ...local[name],
        q: parent.clone().invert().multiply(q).normalize().toArray(),
      };
      refresh();
    };
    const aim = (name, child, target, roll = null) => {
      const origin = worlds.get(name).p;
      const from = rest.get(child).p.clone().sub(rest.get(name).p).normalize();
      const to = target.clone().sub(origin).normalize();
      const q = roll
        ? frameRotation(to, roll)
            .multiply(
              frameRotation(from, new Vector3(0, 0, 1).applyQuaternion(rest.get(name).q)).invert(),
            )
            .multiply(rest.get(name).q)
        : new Quaternion().setFromUnitVectors(from, to).multiply(rest.get(name).q);
      setWorld(name, q);
    };
    local.hips = {
      t: point(pose.hips).toArray(),
      q: body
        .clone()
        .multiply(rotation(pose.hipsEuler))
        .multiply(quat(byName.get('hips').q))
        .toArray(),
    };
    for (const [name, key] of [
      ['spine', 'spineEuler'],
      ['chest', 'chestEuler'],
      ['head', 'headEuler'],
    ]) {
      local[name] = { q: quat(byName.get(name).q).multiply(rotation(pose[key])).toArray() };
    }
    refresh();
    // Let the pelvis yield before a planted ankle exceeds the leg's reach.
    // Clamping IK alone would lift the foot and introduce a visible skate.
    if (pose.grounded) {
      let drop = 0;
      for (const side of ['l', 'r']) {
        const a = `upperleg.${side}`,
          b = `lowerleg.${side}`,
          end = `foot.${side}`;
        const maxReach =
          rest.get(a).p.distanceTo(rest.get(b).p) +
          rest.get(b).p.distanceTo(rest.get(end).p) -
          0.001 * scale;
        const start = worlds.get(a).p,
          foot = point(pose.feet[side]);
        const horizontalSq = (start.x - foot.x) ** 2 + (start.z - foot.z) ** 2;
        const vertical = Math.sqrt(Math.max(0, maxReach ** 2 - horizontalSq));
        drop = Math.max(drop, start.y - foot.y - vertical);
      }
      if (drop > 0) {
        local.hips.t[1] -= drop;
        refresh();
      }
    }
    function limb(a, b, end, target, pole) {
      const la = rest.get(a).p.distanceTo(rest.get(b).p);
      const lb = rest.get(b).p.distanceTo(rest.get(end).p);
      if (a.startsWith('upperarm')) {
        const origin = worlds.get(a).p;
        const direction = target
          .clone()
          .sub(origin)
          .applyQuaternion(body.clone().invert())
          .normalize();
        if (direction.z < -0.95) throw Error(`Arm target behind transport frame: ${a}`);
        const transport = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), direction);
        // Transport a perpendicular anatomical bend from the forward pose.
        // Unlike a projected world pole, it cannot collapse as an arm crosses
        // the chest. Authored wrist paths stay clear of the backward singularity.
        pole = new Vector3(a.endsWith('.l') ? 0.8 : -0.8, -0.6, 0)
          .applyQuaternion(transport)
          .applyQuaternion(body)
          .multiplyScalar(scale)
          .add(origin);
      }
      if (a.startsWith('upperarm') && !pose.supportGrip) {
        const origin = worlds.get(a).p;
        const delta = target.clone().sub(origin);
        target = origin
          .clone()
          .add(
            delta.setLength(
              Math.max(0.12 * scale, Math.min(la + lb - 0.008 * scale, delta.length())),
            ),
          );
      }
      const joint = jointPoint(worlds.get(a).p, target, pole, la, lb);
      const normal = a.startsWith('upperarm')
        ? joint
            .clone()
            .sub(worlds.get(a).p)
            .cross(target.clone().sub(joint))
            .normalize()
            .multiplyScalar(a.endsWith('.r') ? 1 : -1)
        : null;
      aim(a, b, joint, normal);
      aim(b, end, target, normal);
    }
    const gripRotations = {};
    const handTargets = {};
    for (const side of ['r', 'l']) {
      handTargets[side] = point(pose.hands[side]);
      if (pose.gripDirections?.[side])
        gripRotations[side] = new Quaternion()
          .setFromUnitVectors(new Vector3(0, 1, 0), vec(pose.gripDirections[side]).normalize())
          .premultiply(body);
      if (pose.gripEuler?.[side])
        gripRotations[side] = rotation(pose.gripEuler[side]).premultiply(body);
    }
    if (pose.supportGrip) {
      const mainQ = gripRotations.r;
      gripRotations.l = mainQ.clone().multiply(rotation([0, Math.PI, 0]));
      const offset = (side) =>
        rest
          .get(`handslot.${side}`)
          .p.clone()
          .sub(rest.get(`wrist.${side}`).p)
          .applyQuaternion(rest.get(`handslot.${side}`).q.clone().invert())
          .applyQuaternion(gripRotations[side]);
      handTargets.l = handTargets.r
        .clone()
        .add(offset('r'))
        .add(
          vec(pose.supportOffset ?? [0, -pose.supportGrip, 0])
            .multiplyScalar(scale)
            .applyQuaternion(mainQ),
        )
        .sub(offset('l'));
      // Translate the whole grip into both arms' reachable region, preserving
      // orientation and spacing instead of stretching a limb.
      for (let iteration = 0; iteration < 32; iteration++) {
        for (const side of ['r', 'l']) {
          const shoulder = worlds.get(`upperarm.${side}`).p;
          const maxReach =
            rest.get(`upperarm.${side}`).p.distanceTo(rest.get(`lowerarm.${side}`).p) +
            rest.get(`lowerarm.${side}`).p.distanceTo(rest.get(`wrist.${side}`).p) -
            0.008 * scale;
          const delta = handTargets[side].clone().sub(shoulder);
          if (delta.length() < 0.12 * scale) {
            const forward = new Vector3(0, 0, 1).applyQuaternion(body);
            const along = delta.dot(forward);
            const lateralSq = delta.lengthSq() - along * along;
            const advance = Math.sqrt(Math.max(0, (0.12 * scale) ** 2 - lateralSq)) - along;
            handTargets.r.addScaledVector(forward, advance);
            handTargets.l.addScaledVector(forward, advance);
            continue;
          }
          if (delta.length() <= maxReach) continue;
          const shift = delta.clone().setLength(maxReach).sub(delta);
          handTargets.r.add(shift);
          handTargets.l.add(shift);
        }
      }
    }
    for (const side of ['r', 'l']) {
      const sign = side === 'l' ? 1 : -1;
      const foot = point(pose.feet[side]);
      limb(
        `upperleg.${side}`,
        `lowerleg.${side}`,
        `foot.${side}`,
        foot,
        point([sign * 0.16, 0.3, 0.38]),
      );
      setWorld(
        `foot.${side}`,
        body
          .clone()
          .multiply(rotation(pose.footEuler[side]))
          .multiply(rest.get(`foot.${side}`).q),
      );
      const handTarget = handTargets[side],
        gripRotation = gripRotations[side];
      limb(`upperarm.${side}`, `lowerarm.${side}`, `wrist.${side}`, handTarget, null);
      const wrist = worlds
        .get(`lowerarm.${side}`)
        .q.clone()
        .multiply(rest.get(`lowerarm.${side}`).q.clone().invert())
        .multiply(rest.get(`wrist.${side}`).q);
      setWorld(
        `wrist.${side}`,
        gripRotation
          ? gripRotation
              .clone()
              .multiply(rest.get(`handslot.${side}`).q.clone().invert())
              .multiply(rest.get(`wrist.${side}`).q)
          : rotation(pose.wristEuler[side]).multiply(wrist),
      );
      setWorld(`armor_shoulder.${side}`, worlds.get(`upperarm.${side}`).q.clone());
      const legDelta = worlds
        .get(`upperleg.${side}`)
        .q.clone()
        .multiply(rest.get(`upperleg.${side}`).q.clone().invert());
      for (const part of ['skirt.front', 'skirt.back', 'tassel.side']) {
        const name = `${part}.${side}`;
        if (byName.has(name)) setWorld(name, legDelta.clone().multiply(rest.get(name).q));
      }
    }
    return Object.fromEntries(
      rig.map((b) => [b.name, { t: local[b.name]?.t ?? b.t, q: local[b.name]?.q ?? b.q }]),
    );
  };
}
