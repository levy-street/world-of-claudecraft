// Anatomical pose -> local bone transforms on the WOC bind rig.
//
// Body axes follow the bind model: X is the character's left, Y up, Z forward.
// Every rotation is authored in degrees as an anatomical control, applied as a
// delta in world-aligned axes carried by the parent's own motion, so a value
// means the same thing on both fits and both sides. The right side mirrors the
// left-side definition across the body midline.
//
// Spine-like controls [pitch, yaw, roll]: +pitch bends forward, +yaw turns to
// the character's left, +roll leans toward the character's left.
// Arms are forward kinematics:
//   clav [elevate, protract]
//   arm { raise, plane, twist }: raise from hanging (0) to overhead (180) in a
//     plane measured from the side (0) toward the front (90) or the back (<0);
//     twist is internal (+) / external (-) rotation of the upper arm.
//   elbow: flexion from the bind arm; forearm: supination (+ turns the palm up
//   from a palm-down T-pose); wrist [flex (+ toward palm), deviate (+ thumb side)].
// Legs are IK: foot { pos: [x, lift, z] ground anchor under the ankle, pitch
// (+ toes up about the heel, - heel up about the ball), yaw (+ toes out), toe
// (extra toe bend, + up) }, knee: degrees of knee-out swing of the leg plane.
import { Matrix4, Quaternion, Vector3 } from 'three';

const D = Math.PI / 180;
const X = new Vector3(1, 0, 0),
  Y = new Vector3(0, 1, 0),
  Z = new Vector3(0, 0, 1);
const axisAngle = (axis, deg) => new Quaternion().setFromAxisAngle(axis, deg * D);
const mirror = (q) => new Quaternion(q.x, -q.y, -q.z, q.w);
/** [pitch, yaw, roll] in body terms -> quaternion (yaw, then pitch, then roll). */
export function bodyRotation([pitch = 0, yaw = 0, roll = 0] = []) {
  return axisAngle(Y, yaw).multiply(axisAngle(X, pitch)).multiply(axisAngle(Z, -roll));
}
/**
 * Left-arm direction in body axes. `raise`/`plane` suits reaches and overhead
 * work; `flex`/`abd` (forward swing, then sideways lift) suits arms that swing
 * through the hanging position, such as a run, without sweeping out sideways.
 */
export function armDirection(arm) {
  if (arm.flex !== undefined || arm.abd !== undefined) {
    const f = (arm.flex ?? 0) * D,
      a = (arm.abd ?? 0) * D;
    return new Vector3(Math.cos(f) * Math.sin(a), -Math.cos(f) * Math.cos(a), Math.sin(f));
  }
  const r = (arm.raise ?? 0) * D,
    p = (arm.plane ?? 0) * D;
  return new Vector3(Math.sin(r) * Math.cos(p), -Math.cos(r), Math.sin(r) * Math.sin(p));
}

function frame(axis, roll) {
  const y = axis.clone().normalize();
  const x = y.clone().cross(roll).normalize();
  const z = x.clone().cross(y).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

/** Bind-pose world frames, foot geometry and limb lengths for one rig. */
export function bindModel(rig) {
  const byName = new Map(rig.map((b, i) => [b.name, { ...b, index: i }]));
  const world = new Map();
  // Document order is not parent-first, so resolve parents on demand.
  const visit = (b) => {
    if (world.has(b.name)) return world.get(b.name);
    const p = new Vector3(...b.t),
      q = new Quaternion(...b.q).normalize(),
      s = new Vector3(...b.s);
    if (b.parent >= 0) {
      const parent = visit(rig[b.parent]);
      p.multiply(parent.s).applyQuaternion(parent.q).add(parent.p);
      q.premultiply(parent.q);
      s.multiply(parent.s);
    }
    world.set(b.name, { p, q, s });
    return world.get(b.name);
  };
  for (const b of rig) visit(b);
  const at = (name) => world.get(name).p;
  const length = (a, b) => at(a).distanceTo(at(b));
  const feet = {};
  for (const side of ['l', 'r']) {
    const ankle = at(`foot.${side}`),
      ball = at(`toes.${side}`);
    // The boot sole rests on y = 0.
    feet[side] = {
      ankle: new Vector3(0, ankle.y, 0),
      // The heel rocks on its ground point; the ball rolls about the toe joint itself.
      ball: new Vector3(ball.x - ankle.x, ball.y, ball.z - ankle.z),
      heel: new Vector3(0, 0, -0.055),
      x: ankle.x,
      z: ankle.z,
    };
  }
  return {
    rig,
    byName,
    world,
    feet,
    thigh: { l: length('upperleg.l', 'lowerleg.l'), r: length('upperleg.r', 'lowerleg.r') },
    shin: { l: length('lowerleg.l', 'foot.l'), r: length('lowerleg.r', 'foot.r') },
  };
}

/**
 * Ankle position of a grounded foot: `anchor` is the ground point under the
 * flat ankle (y lifts it); negative pitch rolls the heel up about the ball,
 * positive pitch lifts the toes about the heel, so the contact point is fixed.
 */
export function groundAnkle(model, side, anchor, pitch = 0, yaw = 0) {
  const geo = model.feet[side];
  const pivot = pitch < 0 ? geo.ball : geo.heel;
  const yawQ = axisAngle(Y, side === 'l' ? yaw : -yaw);
  return geo.ankle
    .clone()
    .sub(pivot)
    .applyQuaternion(axisAngle(X, -pitch))
    .add(pivot)
    .applyQuaternion(yawQ)
    .add(new Vector3(...anchor));
}

/** Builds a solver for anatomical poses on one bind model. */
export function makeAnatomySolver(model) {
  const { rig, byName, world: bind } = model;
  const sideRot = (side, q) => (side === 'l' ? q : mirror(q));
  const warnings = new Map();
  const warn = (key, value) => {
    warnings.set(key, Math.max(warnings.get(key) ?? 0, Math.abs(value)));
  };

  return {
    warnings,
    solve(pose) {
      const cur = new Map();
      const set = (name, q, p = null) => {
        const b = byName.get(name);
        const parent = b.parent >= 0 ? cur.get(rig[b.parent].name) : null;
        const position =
          p ??
          (parent
            ? new Vector3(...b.t).multiply(parent.s).applyQuaternion(parent.q).add(parent.p)
            : new Vector3(...b.t));
        const s = parent ? new Vector3(...b.s).multiply(parent.s) : new Vector3(...b.s);
        cur.set(name, { p: position, q: q.clone().normalize(), s });
      };
      // Carried frame: the parent's rotation away from its own bind orientation.
      const carried = (name) => {
        const b = byName.get(name);
        if (b.parent < 0) return new Quaternion();
        const parent = rig[b.parent].name;
        return cur.get(parent).q.clone().multiply(bind.get(parent).q.clone().invert());
      };
      const deltaSet = (name, delta) =>
        set(name, carried(name).multiply(delta).multiply(bind.get(name).q));
      const keep = (name) => deltaSet(name, new Quaternion());

      keep('WOC_Armored_Rig');
      keep('root');
      const pelvis = pose.pelvis ?? {};
      set(
        'hips',
        bodyRotation(pelvis.rot).multiply(bind.get('hips').q),
        pelvis.pos ? new Vector3(...pelvis.pos) : bind.get('hips').p.clone(),
      );
      for (const name of ['spine', 'chest', 'neck', 'head'])
        deltaSet(name, bodyRotation(pose[name]));

      for (const side of ['l', 'r']) {
        const clav = pose.clav?.[side] ?? [0, 0];
        deltaSet(
          `clavicle.${side}`,
          sideRot(side, axisAngle(Z, clav[0] ?? 0).multiply(axisAngle(Y, -(clav[1] ?? 0)))),
        );
        const arm = pose.arm?.[side] ?? {};
        const dir = armDirection(arm);
        const raise = Math.acos(Math.max(-1, Math.min(1, -dir.y))) / D;
        if (raise > 175) warn(`arm.${side}.raise`, raise);
        const down = new Vector3(0, -1, 0);
        const swing = new Quaternion().setFromUnitVectors(down, dir);
        const upperArm = (swingQ, tw) => {
          const q = swingQ.clone().multiply(axisAngle(down, tw)).multiply(axisAngle(Z, -90));
          return side === 'l' ? q : mirror(q);
        };
        deltaSet(`upperarm.${side}`, upperArm(swing, arm.twist ?? 0));
        // Pauldrons sit on the deltoid: they follow the arm fully up to shoulder
        // height and only partly above it, so an overhead arm cannot drive the
        // plate into the head. They ignore most of the arm's twist.
        const follow = pose.pauldronFollow ?? 0.85;
        const lifted =
          raise <= 90 ? follow * raise : follow * 90 + (pose.pauldronLift ?? 0.45) * (raise - 90);
        deltaSet(
          `armor_shoulder.${side}`,
          upperArm(
            new Quaternion().slerp(swing, raise > 1e-3 ? lifted / raise : 1),
            0.3 * (arm.twist ?? 0),
          ),
        );
        const flex = pose.elbow?.[side] ?? 0;
        if (flex < -2 || flex > 140) warn(`elbow.${side}`, flex);
        const supination = pose.forearm?.[side] ?? 0;
        deltaSet(
          `lowerarm.${side}`,
          sideRot(side, axisAngle(Y, -flex).multiply(axisAngle(X, -0.4 * supination))),
        );
        const [wristFlex = 0, deviate = 0] = pose.wrist?.[side] ?? [];
        if (Math.abs(wristFlex) > 75) warn(`wrist.${side}.flex`, wristFlex);
        if (Math.abs(deviate) > 35) warn(`wrist.${side}.deviate`, deviate);
        deltaSet(
          `wrist.${side}`,
          sideRot(
            side,
            axisAngle(X, -0.6 * supination)
              .multiply(axisAngle(Z, -wristFlex))
              .multiply(axisAngle(Y, -deviate)),
          ),
        );
        keep(`hand.${side}`);
        keep(`handslot.${side}`);
        if (pose.blade?.[side]) throw Error('Blade aims are resolved at keys (keyed/blade.mjs)');
      }

      for (const side of ['l', 'r']) legIK(side);
      function legIK(side) {
        const foot = pose.foot?.[side] ?? {};
        const geo = model.feet[side];
        const yawQ = sideRot(side, axisAngle(Y, foot.yaw ?? 0));
        const pitch = foot.pitch ?? 0;
        const pitchQ = axisAngle(X, -pitch);
        const anchor = new Vector3(...(foot.pos ?? [geo.x, 0, geo.z]));
        // Airborne feet give the ankle itself; grounded feet roll about heel or ball.
        // `plant` (0..1) blends a given ankle back onto the grounded one, so a
        // one-shot can key a foot leaving or reaching the floor without a pop.
        const groundedAnkle = groundAnkle(model, side, anchor.toArray(), pitch, foot.yaw ?? 0);
        const plantWeight = foot.ankle ? Math.max(0, Math.min(1, foot.plant ?? 0)) : 1;
        const ankle = foot.ankle
          ? new Vector3(...foot.ankle).lerp(groundedAnkle, plantWeight)
          : groundedAnkle;
        const hip = cur.get('hips').q.clone(); // pelvis orientation for the knee plane
        const thighName = `upperleg.${side}`,
          shinName = `lowerleg.${side}`;
        // The hip joint sits on the pelvis bone, so place the thigh first.
        deltaSet(thighName, new Quaternion());
        const hipJoint = cur.get(thighName).p.clone();
        const toAnkle = ankle.clone().sub(hipJoint);
        const reach = model.thigh[side] + model.shin[side];
        if (toAnkle.length() > reach - 0.002)
          warn(`leg.${side}.overreach`, toAnkle.length() - reach);
        // Knee plane: the foot's facing, swung outward by `knee` degrees.
        const facing = Z.clone()
          .applyQuaternion(yawQ)
          .lerp(Z.clone().applyQuaternion(hip), 0.35)
          .normalize();
        const axis = toAnkle.clone().normalize();
        const pole = facing
          .clone()
          .addScaledVector(axis, -facing.dot(axis))
          .normalize()
          .applyAxisAngle(axis, (side === 'l' ? -1 : 1) * (foot.knee ?? 0) * D);
        const la = model.thigh[side],
          lb = model.shin[side];
        const distance = Math.min(
          la + lb - 1e-5,
          Math.max(Math.abs(la - lb) + 1e-5, toAnkle.length()),
        );
        const along = (la * la - lb * lb + distance * distance) / (2 * distance);
        const height = Math.sqrt(Math.max(0, la * la - along * along));
        const knee = hipJoint.clone().addScaledVector(axis, along).addScaledVector(pole, height);
        const hinge = axis.clone().cross(pole).normalize().negate();
        const aim = (name, from, to, child) => {
          const bindDir = bind.get(child).p.clone().sub(bind.get(name).p).normalize();
          const q = frame(to.clone().sub(from), hinge)
            .multiply(frame(bindDir, X).invert())
            .multiply(bind.get(name).q);
          set(name, q);
        };
        aim(thighName, hipJoint, knee, shinName);
        aim(shinName, knee, hipJoint.clone().addScaledVector(axis, distance), `foot.${side}`);
        // Foot orientation: world pitch on the ground; in the air, an ankle angle
        // relative to the shin (`flex`, + dorsiflexion), blended by `air`.
        const grounded = yawQ.clone().multiply(pitchQ);
        const air = Math.max(0, Math.min(1, foot.air ?? 0));
        let footDelta = grounded;
        if (air > 0) {
          const shinDelta = carried(`foot.${side}`);
          // The shin already carries the leg's turn; `airYaw` (default `yaw`) adds
          // only the foot's own turn about it, for legs far from the bind facing.
          const airYawQ =
            foot.airYaw === undefined ? yawQ : sideRot(side, axisAngle(Y, foot.airYaw));
          const relative = shinDelta.multiply(airYawQ).multiply(axisAngle(X, -(foot.flex ?? 0)));
          footDelta = grounded.clone().slerp(relative, air);
        }
        set(`foot.${side}`, footDelta.clone().multiply(bind.get(`foot.${side}`).q));
        // Planted toes stay flat while the heel rolls up over the ball.
        const lift = foot.ankle ? 1 - plantWeight + plantWeight * anchor.y : anchor.y;
        // Toes stay flat until the ball is well clear, so a lifting foot never scrapes.
        const plant = Math.max(0, Math.min(1, 1 - lift / 0.03));
        const flatten = pitch < 0 ? -pitch * plant : 0;
        const toe = flatten + (foot.toe ?? 0);
        set(
          `toes.${side}`,
          footDelta
            .clone()
            .multiply(axisAngle(X, -toe))
            .multiply(bind.get(`toes.${side}`).q),
        );
        // Skirt plates hang from the belt and swing with the thigh they cover.
        const thighDelta = carried(`lowerleg.${side}`);
        const pelvisDelta = carried(`upperleg.${side}`);
        const relative = pelvisDelta.clone().invert().multiply(thighDelta);
        for (const [part, follow] of [
          ['skirt.front', pose.skirtFollow?.front ?? 0.85],
          ['skirt.back', pose.skirtFollow?.back ?? 0.85],
          ['tassel.side', pose.skirtFollow?.side ?? 0.4],
        ]) {
          const name = `${part}.${side}`;
          if (!byName.has(name)) continue;
          set(
            name,
            pelvisDelta
              .clone()
              .multiply(new Quaternion().slerp(relative, follow))
              .multiply(bind.get(name).q),
          );
        }
      }
      // Local transforms; only the pelvis translates.
      const local = {};
      for (const b of rig) {
        const c = cur.get(b.name);
        if (!c) throw Error(`Unsolved bone ${b.name}`);
        const parent = b.parent >= 0 ? cur.get(rig[b.parent].name).q : new Quaternion();
        const q = parent.clone().invert().multiply(c.q).normalize();
        local[b.name] = {
          t: b.name === 'hips' ? c.p.toArray() : [...b.t],
          q: /^(handslot|hand\.)/.test(b.name) ? [...b.q] : q.toArray(),
        };
      }
      return { local, world: cur };
    },
  };
}
