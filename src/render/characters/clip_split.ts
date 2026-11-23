// Split one AnimationClip into two at a time boundary, with the pose AT the
// boundary sampled into both halves. three's AnimationUtils.subclip only keeps
// the keyframes that fall inside the window, which is wrong for the sparse
// keys a resampled export carries: a bone with keys at 0 and 0.9 s cut at
// 0.38 s would hold its t=0 value through the whole first half instead of
// ramping to where it really is at the cut. Each track is evaluated through
// its own interpolant (slerp for rotations), so the boundary pose is exact.
//
// Used for the two-strike dual-wield clip (ClipMap.dualWieldSplit): the sim
// swings the mainhand and the offhand as separate events, so each swing plays
// its own strike instead of the whole clip replaying the same arm first. And for
// a hold-and-release cast (ClipMap.clipSplits). A rig asks through
// sharedClipSplit, which cuts a clip once and hands every rig the same halves.
import * as THREE from 'three';

function sliced(
  track: THREE.KeyframeTrack,
  from: number,
  to: number,
  shift: number,
): THREE.KeyframeTrack | null {
  const size = track.getValueSize();
  const interpolant = track.createInterpolant();
  const times: number[] = [];
  const values: number[] = [];
  const push = (t: number, v: ArrayLike<number>) => {
    times.push(t - shift);
    for (let k = 0; k < size; k++) values.push(v[k]);
  };
  const first = track.times[0];
  const last = track.times[track.times.length - 1];
  // The boundary poses, interpolated (or clamped outside the keyed span).
  const at = (t: number): ArrayLike<number> => {
    const clamped = Math.min(Math.max(t, first), last);
    return Array.from(interpolant.evaluate(clamped));
  };
  push(from, at(from));
  for (let j = 0; j < track.times.length; j++) {
    const t = track.times[j];
    if (t <= from || t >= to) continue;
    push(t, track.values.subarray(j * size, (j + 1) * size));
  }
  if (to > from) push(to, at(to));
  if (times.length === 0) return null;
  const out = track.clone();
  out.times = Float32Array.from(times);
  out.values = Float32Array.from(values);
  return out;
}

/** The two halves of `clip` cut at `at` seconds: [0, at] and [at, end], each
 *  starting at t=0 and carrying the exact pose at the cut. */
export function splitClipAt(
  clip: THREE.AnimationClip,
  at: number,
  names: [string, string],
): [THREE.AnimationClip, THREE.AnimationClip] {
  const cut = Math.min(Math.max(at, 0), clip.duration);
  const head: THREE.KeyframeTrack[] = [];
  const tail: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const h = sliced(track, 0, cut, 0);
    const t = sliced(track, cut, clip.duration, cut);
    if (h) head.push(h);
    if (t) tail.push(t);
  }
  return [
    new THREE.AnimationClip(names[0], cut, head),
    new THREE.AnimationClip(names[1], clip.duration - cut, tail),
  ];
}

// The halves of each source clip, per cut (the time and both names). Weak on the source:
// a library that is let go takes its halves with it.
const sharedSplits = new WeakMap<
  THREE.AnimationClip,
  Map<string, [THREE.AnimationClip, THREE.AnimationClip]>
>();

/** `splitClipAt`, minted once per source clip and cut and handed to every caller after:
 *  the halves are data like the clip they are cut from, and a mixer binds a clip per root,
 *  so one pair drives every rig built from that clip (as each uncut clip of a library
 *  already does) instead of each rig re-sampling its own copy at build. Never mutate what
 *  this returns. */
export function sharedClipSplit(
  clip: THREE.AnimationClip,
  at: number,
  names: readonly [string, string],
): [THREE.AnimationClip, THREE.AnimationClip] {
  let cuts = sharedSplits.get(clip);
  if (!cuts) {
    cuts = new Map();
    sharedSplits.set(clip, cuts);
  }
  // JSON, not a joined string: a clip name may hold any character a separator could be
  const key = JSON.stringify([at, names[0], names[1]]);
  let halves = cuts.get(key);
  if (!halves) {
    halves = splitClipAt(clip, at, [names[0], names[1]]);
    cuts.set(key, halves);
  }
  return halves;
}

// The half names live in the pure swing core (so the swing picker can name them without three);
// re-exported here for the callers that split the clip.
export { dualWieldHalfNames } from './attack_swing_core';

/** Every clip name a ClipMap's `clipSplits` mints at load, so a clip-map gate
 *  can accept them as resolvable alongside the GLB's own clips. */
export function clipSplitNames(
  clips: { clipSplits?: readonly { names: readonly [string, string] }[] } | undefined,
): string[] {
  return (clips?.clipSplits ?? []).flatMap((cut) => [cut.names[0], cut.names[1]]);
}
