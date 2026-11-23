// Seed the authored fall from the rig's own relaxed pose, never its skin bind
// pose. Bind arms on these rigs are spread out and remain a T after toppling.
export function wildheartDeathBase(root) {
  const idle = root.listAnimations().find((clip) => clip.getName() === 'Idle');
  if (!idle) throw new Error('Wildheart death authoring requires Idle');
  const pose = new Map();
  for (const skin of root.listSkins()) {
    for (const joint of skin.listJoints()) {
      pose.set(joint, { rotation: joint.getRotation() });
    }
  }
  for (const channel of idle.listChannels()) {
    const node = channel.getTargetNode();
    const output = channel.getSampler().getOutput();
    const entry = pose.get(node) ?? {};
    entry[channel.getTargetPath()] = Array.from(
      output.getArray().slice(0, output.getElementSize()),
    );
    pose.set(node, entry);
  }
  return pose;
}
