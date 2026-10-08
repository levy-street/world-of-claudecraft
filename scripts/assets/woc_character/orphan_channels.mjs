// Repair for a handoff whose re-authored animation tracks were bound to a
// SCENELESS duplicate of the rig instead of the visible one.
//
// The 2026-09-18 attack update appended its re-authored tracks (15 per attack
// clip) as EXTRA channels targeting the detached copy of the skeleton that the
// female bodies and every assembled reference carry (same bone names, reached
// by no scene), and left the visible rig's channels for those tracks untouched.
// Loaded as delivered, those bodies keep playing the previous attacks. The male
// warrior base has no detached copy and carries the same tracks on its real rig
// byte for byte, so the intent is unambiguous: each such channel belongs on its
// in-scene twin, in place of the stale channel for the same path.
//
// Pure over a glTF-Transform Document (no IO), so tests/woc_orphan_channels.test.ts
// drives it on an in-memory rig.

/** Every node some scene reaches. */
export function reachableNodes(root) {
  const reachable = new Set();
  const walk = (node) => {
    reachable.add(node);
    for (const child of node.listChildren()) walk(child);
  };
  for (const scene of root.listScenes()) for (const child of scene.listChildren()) walk(child);
  return reachable;
}

/**
 * Move every animation channel that targets a sceneless node onto the in-scene
 * node of the same name, disposing the stale channel it replaces. Returns the
 * moved tracks as `clip:node.path` labels. Throws when an orphan channel has no
 * in-scene twin, when the twin is ambiguous, or when two orphan channels claim
 * the same track: none of those has one right answer.
 */
export function retargetOrphanChannels(doc) {
  const root = doc.getRoot();
  const reachable = reachableNodes(root);
  const twinsByName = new Map();
  for (const node of root.listNodes()) {
    if (!reachable.has(node)) continue;
    const twins = twinsByName.get(node.getName());
    if (twins) twins.push(node);
    else twinsByName.set(node.getName(), [node]);
  }
  const moved = [];
  for (const anim of root.listAnimations()) {
    const claimed = new Set();
    for (const channel of anim.listChannels()) {
      const node = channel.getTargetNode();
      if (!node || reachable.has(node)) continue;
      const track = `${node.getName()}.${channel.getTargetPath()}`;
      const twins = twinsByName.get(node.getName()) ?? [];
      if (twins.length !== 1) {
        throw new Error(
          `${anim.getName()}: orphan channel ${track} has ${twins.length} in-scene twins`,
        );
      }
      if (claimed.has(track)) {
        throw new Error(`${anim.getName()}: two orphan channels claim ${track}`);
      }
      claimed.add(track);
      const twin = twins[0];
      for (const stale of anim.listChannels()) {
        if (stale === channel || stale.getTargetNode() !== twin) continue;
        if (stale.getTargetPath() !== channel.getTargetPath()) continue;
        const sampler = stale.getSampler();
        stale.dispose();
        const stillUsed = sampler
          ?.listParents()
          .some((parent) => parent.propertyType === 'AnimationChannel');
        if (sampler && !stillUsed) sampler.dispose();
      }
      channel.setTargetNode(twin);
      moved.push(`${anim.getName()}:${track}`);
    }
  }
  return moved;
}
