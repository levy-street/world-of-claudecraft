import { Quaternion, Vector3 } from 'three';
import { worldPose } from './retarget.mjs';

export function bladeContact(target, clip, side) {
  const tips = Array.from({ length: clip.frames }, (_, i) => {
    const h = worldPose(target, clip.tracks, i).get(`handslot.${side}`);
    return new Vector3(0, 0.3, 0).applyQuaternion(h.q).add(h.p);
  });
  let peak = -1,
    at = 0;
  for (let i = 1; i < tips.length; i++) {
    const f = i / (tips.length - 1);
    if (f < 0.15 || f > 0.7) continue;
    const speed = tips[i].distanceTo(tips[i - 1]);
    if (speed > peak) {
      peak = speed;
      at = (i - 0.5) / clip.fps;
    }
  }
  return at;
}

/** A same-frame upgrade cannot change a previously queued hit. Match all
 * dual half/pair contacts, shifting the wind-up and holding the recovery. */
export function alignDualContact(
  target,
  source,
  side,
  contact,
  names = Object.keys(source.tracks),
) {
  let clip = structuredClone(source);
  for (let pass = 0; pass < 8; pass++) {
    const shift = bladeContact(target, clip, side) - contact;
    if (Math.abs(shift) < 0.5 / clip.fps) return clip;
    const previous = clip.tracks;
    clip = { ...clip, tracks: { ...previous } };
    for (const name of names) {
      const track = previous[name],
        next = { t: [], q: [] };
      for (let frame = 0; frame < clip.frames; frame++) {
        const f = Math.max(0, Math.min(clip.frames - 1, frame + shift * clip.fps));
        const a = Math.floor(f),
          b = Math.min(a + 1, clip.frames - 1),
          alpha = f - a;
        next.t.push(new Vector3(...track.t[a]).lerp(new Vector3(...track.t[b]), alpha).toArray());
        next.q.push(
          new Quaternion(...track.q[a]).slerp(new Quaternion(...track.q[b]), alpha).toArray(),
        );
      }
      clip.tracks[name] = next;
    }
  }
  throw Error(`Could not align dual contact for ${side}`);
}
