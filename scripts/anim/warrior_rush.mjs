import { Euler, Quaternion } from 'three';
import { bakeClip, blendValue, indexClip, samplePose } from './pose_blend.mjs';

/** Native running legs under a braced shield/weapon carriage. Baked offline. */
export function bakeWarriorRush(doc, contactRoot) {
  const run = indexClip(doc.getRoot(), 'Running_A');
  const guard = samplePose(indexClip(contactRoot, 'Warrior_Raised_Guard'), 0.15);
  const sourceDuration = Math.max(...[...run.values()].map((c) => c.times[c.times.length - 1]));
  const keys = [...run.keys()],
    duration = 0.6;
  const timeline = [];
  for (let i = 0; i <= 72; i++) {
    const pose = samplePose(run, (i === 72 ? 0 : i / 72) * sourceDuration);
    for (const key of keys) {
      if (key.endsWith('|rotation')) {
        if (
          /^(chest|neck|head|upperarm\.[lr]|lowerarm\.[lr]|hand\.[lr]|shoulder\.[lr])\|/.test(
            key,
          ) &&
          guard.has(key)
        )
          pose.set(key, blendValue(key, pose.get(key), guard.get(key), 0.86));
        const q = new Quaternion().fromArray(pose.get(key)).normalize();
        if (key === 'chest|rotation')
          q.multiply(new Quaternion().setFromEuler(new Euler(0.14, 0, 0)));
        if (key === 'head|rotation')
          q.multiply(new Quaternion().setFromEuler(new Euler(-0.09, 0, 0)));
        pose.set(key, q.normalize().toArray());
      }
    }
    timeline.push([(duration * i) / 72, (key) => pose.get(key)]);
  }
  return bakeClip(doc, {
    clipName: 'Warrior_Rush_Loop',
    channelKeys: keys,
    timeline,
    donorFor: (key) => run.get(key),
  }).animation;
}
