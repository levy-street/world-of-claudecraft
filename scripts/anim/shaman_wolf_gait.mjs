// Offline stance correction for this wolf's asymmetric Tripo skeleton. Solve
// each paw independently in bind space; never assume matching terminal bones.
import { Matrix4, Quaternion, Vector3 } from 'three';

export function createWolfGait(root, channels, bindPose) {
  const nodes = root.listNodes();
  const rest = nodes.map((n) => [n, n.getTranslation(), n.getRotation(), n.getScale()]);
  const restore = () => {
    for (const [n, t, r, s] of rest) n.setTranslation(t).setRotation(r).setScale(s);
  };
  const position = (n) => new Vector3(...n.getWorldTranslation());
  const rotation = (n) =>
    new Quaternion().setFromRotationMatrix(
      new Matrix4().extractRotation(new Matrix4().fromArray(n.getWorldMatrix())),
    );
  const setWorldRotation = (n, q) => {
    const parent = n.getParentNode();
    n.setRotation((parent ? rotation(parent).invert().multiply(q) : q).normalize().toArray());
  };
  // Locate the soles in the actual mesh, including the left hind foot whose
  // last joint is an entire hock above the ground. No guessed shared offset.
  const vertices = [];
  for (const n of nodes) {
    const skin = n.getSkin();
    if (!skin || !n.getMesh()) continue;
    const matrices = skin
      .listJoints()
      .map((j, i) =>
        new Matrix4()
          .fromArray(j.getWorldMatrix())
          .multiply(new Matrix4().fromArray(skin.getInverseBindMatrices().getElement(i, []))),
      );
    for (const p of n.getMesh().listPrimitives()) {
      const pos = p.getAttribute('POSITION'),
        joints = p.getAttribute('JOINTS_0'),
        weights = p.getAttribute('WEIGHTS_0');
      for (let i = 0; i < pos.getCount(); i++) {
        const v = pos.getElement(i, []),
          js = joints.getElement(i, []),
          ws = weights.getElement(i, []),
          out = new Vector3();
        for (let k = 0; k < 4; k++)
          if (ws[k]) out.addScaledVector(new Vector3(...v).applyMatrix4(matrices[js[k]]), ws[k]);
        vertices.push(out);
      }
    }
  }
  const scale =
    2.25 / (Math.max(...vertices.map((v) => v.y)) - Math.min(...vertices.map((v) => v.y)));
  const legs = [];
  for (const front of [true, false])
    for (const left of [true, false]) {
      const candidates = vertices.filter(
        (v) => v.x > 0.05 === front && v.z < -0.025 === left && Math.abs(v.x) < 0.4,
      );
      const floor = Math.min(...candidates.map((v) => v.y));
      const sole = candidates.filter((v) => v.y < floor + 0.012);
      const centre = sole.reduce((s, v) => s.add(v), new Vector3()).multiplyScalar(1 / sole.length);
      const prefix = `tripo::${front ? 0 : 1}_${left ? 'Left' : 'Right'}_Limb_`;
      const chain = nodes
        .filter((n) => n.getName().startsWith(prefix))
        .sort((a, b) => a.getName().localeCompare(b.getName()));
      const end = chain[2];
      legs.push({
        front,
        left,
        chain: chain.slice(0, 3),
        end,
        centre,
        offset: centre.clone().sub(position(end)),
        rotation: rotation(end),
        bend: new Vector3(front ? -1 : 1, 0, 0),
      });
    }
  const rootBone = nodes.find((n) => n.getName() === 'tripo::Root');
  const rootPosition = rootBone.getTranslation();
  const pitch = (name, angle) => {
    const node = nodes.find((n) => n.getName() === name);
    if (node)
      setWorldRotation(
        node,
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle).multiply(rotation(node)),
      );
  };
  return (u, running) => {
    restore();
    const seconds = running ? 0.5 : 0.9,
      duty = running ? 0.22 : 0.56;
    const speed = running ? 9.8 : 2.8;
    const stride = (speed * seconds * duty) / scale;
    const bounce = running
      ? -0.037 * Math.cos(u * Math.PI * 4 - 1.1)
      : 0.004 * Math.cos(u * Math.PI * 4);
    rootBone.setTranslation([
      rootPosition[0],
      rootPosition[1] - (running ? 0.07 : 0.025) + bounce,
      rootPosition[2],
    ]);
    if (running) {
      // One gathered/extended body cycle per stride. The faster double pulse
      // in body height supplies two brief suspension phases; the head counters
      // the shoulder pitch so this reads as a driving gallop, not a stiff trot.
      const cycle = u * Math.PI * 2;
      const drive = Math.sin(cycle - 0.45);
      pitch('tripo::Root', drive * 0.075);
      pitch('tripo::Spine_0', Math.sin(cycle + 0.25) * 0.115);
      pitch('tripo::Spine_1', -Math.sin(cycle + 0.25) * 0.055);
      pitch('tripo::Spine_3', Math.sin(cycle - 0.35) * 0.04);
      pitch('tripo::Head_0', -drive * 0.07 - Math.sin(cycle + 0.25) * 0.055);
      pitch('tripo::Head_1', Math.sin(cycle - 0.65) * 0.025);
      for (let i = 0; i < 5; i++)
        pitch(`tripo::Tail_${i}`, Math.sin(cycle - 0.65 - i * 0.3) * 0.07);
    }
    for (const leg of legs) {
      // Transverse gallop: hind pair propels, front pair receives. Walking
      // uses separate four-beat contacts rather than a slowed gallop.
      const phase = running
        ? leg.front
          ? leg.left
            ? 0
            : 0.045
          : leg.left
            ? 0.54
            : 0.595
        : leg.front
          ? leg.left
            ? 0
            : 0.5
          : leg.left
            ? 0.75
            : 0.25;
      const cycle = (u + phase) % 1;
      let x, lift;
      if (cycle < duty) {
        x = stride * (0.5 - cycle / duty);
        lift = 0;
      } else {
        const t = (cycle - duty) / (1 - duty),
          ease = t * t * (3 - 2 * t);
        x = stride * (-0.5 + ease);
        lift = Math.sin(t * Math.PI) ** 1.5 * (running ? 0.135 : 0.055);
      }
      const target = leg.centre
        .clone()
        .add(new Vector3(x, lift, 0))
        .sub(leg.offset);
      // Solve two joints with a fixed anatomical bend plane, retaining each
      // foot's bind orientation. Bone lengths, weights and root travel stay
      // unchanged; in particular the short left hind chain cannot knee-flip.
      {
        const [hip, knee, ankle] = leg.chain;
        const a = position(hip),
          b = position(knee),
          c = position(ankle);
        const upper = a.distanceTo(b),
          lower = b.distanceTo(c);
        const axis = target.clone().sub(a).normalize();
        const distance = Math.min(
          upper + lower - 0.0001,
          Math.max(Math.abs(upper - lower) + 0.0001, a.distanceTo(target)),
        );
        const along = (upper * upper + distance * distance - lower * lower) / (2 * distance);
        const pole = leg.bend.clone().addScaledVector(axis, -leg.bend.dot(axis)).normalize();
        const solved = a
          .clone()
          .addScaledVector(axis, along)
          .addScaledVector(pole, Math.sqrt(Math.max(0, upper * upper - along * along)));
        setWorldRotation(
          hip,
          new Quaternion()
            .setFromUnitVectors(b.clone().sub(a).normalize(), solved.sub(a).normalize())
            .multiply(rotation(hip)),
        );
        const pivot = position(knee);
        setWorldRotation(
          knee,
          new Quaternion()
            .setFromUnitVectors(
              position(ankle).sub(pivot).normalize(),
              target.clone().sub(pivot).normalize(),
            )
            .multiply(rotation(knee)),
        );
      }
      setWorldRotation(leg.end, leg.rotation.clone());
    }
    const pose = new Map(bindPose);
    for (const [key, c] of channels)
      pose.set(
        key,
        c.path === 'rotation'
          ? c.node.getRotation()
          : c.path === 'translation'
            ? c.node.getTranslation()
            : c.node.getScale(),
      );
    restore();
    return pose;
  };
}
