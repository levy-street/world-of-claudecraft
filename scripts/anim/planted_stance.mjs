import { Euler, Object3D, Quaternion, Vector3 } from 'three';

/** Authoring-only planted-foot correction. The live rig receives baked tracks.
 * Hip compression and turn are solved against the original idle foot anchors.
 * marks: [[time, depth, yawDeg], ...] in ascending time order. */
export function createPlantedStance(root, idle, marks) {
  const objects = new Map();
  for (const node of root.listNodes()) {
    const object = new Object3D();
    object.name = node.getName();
    object.position.fromArray(node.getTranslation());
    object.quaternion.fromArray(node.getRotation()).normalize();
    object.scale.fromArray(node.getScale());
    objects.set(node.getName(), object);
  }
  for (const node of root.listNodes())
    for (const child of node.listChildren())
      objects.get(node.getName()).add(objects.get(child.getName()));
  const top = [...objects.values()].filter((o) => !o.parent);
  const update = () => {
    for (const object of top) object.updateMatrixWorld(true);
  };
  const apply = (pose) => {
    for (const [key, value] of pose) {
      const [bone, path] = key.split('|'),
        object = objects.get(bone);
      if (path === 'rotation') object.quaternion.fromArray(value).normalize();
      if (path === 'translation') object.position.fromArray(value);
    }
    update();
  };
  apply(idle);
  const feet = ['r', 'l'].map((side) => ({
    side,
    target: objects.get(`foot.${side}`).getWorldPosition(new Vector3()),
    rotation: objects.get(`foot.${side}`).getWorldQuaternion(new Quaternion()),
  }));
  const a = new Vector3(),
    b = new Vector3(),
    origin = new Vector3();
  const delta = new Quaternion(),
    parent = new Quaternion(),
    world = new Quaternion();
  const hipTurn = new Quaternion();
  return (pose, time) => {
    let index = 1;
    while (index < marks.length - 1 && time > marks[index][0]) index++;
    const from = marks[index - 1],
      to = marks[index];
    let w = Math.max(0, Math.min(1, (time - from[0]) / (to[0] - from[0])));
    w = w * w * (3 - 2 * w);
    const depth = from[1] + (to[1] - from[1]) * w,
      yaw = ((from[2] + (to[2] - from[2]) * w) * Math.PI) / 180;
    apply(pose);
    const hips = objects.get('hips');
    hips.position.y -= depth;
    hips.quaternion.multiply(hipTurn.setFromEuler(new Euler(0, yaw, 0))).normalize();
    update();
    for (const foot of feet) {
      const end = objects.get(`foot.${foot.side}`);
      // CCD solves the short leg chains into the unchanged foot positions.
      for (let pass = 0; pass < 16; pass++) {
        for (const name of [`lowerleg.${foot.side}`, `upperleg.${foot.side}`]) {
          const joint = objects.get(name);
          joint.getWorldPosition(origin);
          end.getWorldPosition(a).sub(origin).normalize();
          b.copy(foot.target).sub(origin).normalize();
          delta.setFromUnitVectors(a, b);
          joint.getWorldQuaternion(world).premultiply(delta);
          joint.parent.getWorldQuaternion(parent).invert();
          joint.quaternion.copy(parent.multiply(world)).normalize();
          update();
        }
      }
      end.parent.getWorldQuaternion(parent).invert();
      end.quaternion.copy(parent.multiply(foot.rotation)).normalize();
    }
    const result = new Map(pose);
    result.set('hips|translation', hips.position.toArray());
    for (const name of [
      'hips',
      'upperleg.r',
      'lowerleg.r',
      'foot.r',
      'upperleg.l',
      'lowerleg.l',
      'foot.l',
    ])
      result.set(`${name}|rotation`, objects.get(name).quaternion.toArray());
    return result;
  };
}
