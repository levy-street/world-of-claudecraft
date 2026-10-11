import { bakeClip, blendValue } from './pose_blend.mjs';

/** A planted shoulder stop, not another weapon attack. The parent builder's
 * offline leg solver locks both feet throughout compression and recovery. */
export function bakeWarriorRushArrival(doc, { keys, idle, braced, plant, donorFor }) {
  const ready = braced(0.025, 8);
  const compression = braced(0.075, 19);
  const recovery = braced(0.03, 6);
  const beats = [
    [0, ready],
    [0.065, compression],
    [0.125, compression],
    [0.22, recovery],
    [0.3, idle],
  ];
  const timeline = [];
  for (let i = 0; i < beats.length - 1; i++) {
    const [start, from] = beats[i],
      [end, to] = beats[i + 1];
    const samples = Math.max(2, Math.ceil((end - start) * 120));
    for (let frame = 0; frame < samples; frame++) {
      const u = frame / samples;
      const pose = plant(
        new Map(
          keys.map((key) => [
            key,
            blendValue(key, from.get(key), to.get(key), u * u * (3 - 2 * u)),
          ]),
        ),
      );
      timeline.push([start + (end - start) * u, (key) => pose.get(key)]);
    }
  }
  timeline.push([0.3, (key) => idle.get(key)]);
  return bakeClip(doc, {
    clipName: 'Warrior_Onrush_Arrival',
    channelKeys: keys,
    timeline,
    donorFor,
  }).animation;
}
