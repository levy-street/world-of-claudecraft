// Forward kinematics over a shipped glTF skeleton, so a suite can ask where a bone
// actually ENDS UP in an authored clip.
//
// Clip contracts are otherwise only checkable as names and durations, which misses the
// entire class of defect that matters: an arm that passes through the character's own
// head, a fist that never leaves waist height, a "low sweep" that travels at chest level.
// Those are geometry, and geometry needs the bone chain resolved.
//
// Deliberately reads the SHIPPED GLBs rather than any authoring source, so it also covers
// the export and bake path where a quaternion component order or a dropped channel would
// silently ruin an otherwise correct authoring pass.
import { createGlbIO, indexClip, sampleChannel } from '../../scripts/anim/pose_blend.mjs';

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

interface RestNode {
  parent: string | null;
  t: Vec3;
  r: Quat;
}

export interface PosedSkeleton {
  /** World position of a bone at the sampled time. */
  at(bone: string): Vec3;
  /** Bone names present in the rig. */
  bones: string[];
}

const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

const qrot = (q: Quat, v: Vec3): Vec3 => {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
};

/** Load a rig's rest skeleton once; the returned sampler is cheap to call per time. */
export async function loadRigPoser(rigPath: string, clipPath: string) {
  const io = createGlbIO();
  const rig = await io.read(rigPath);
  const clips = await io.read(clipPath);
  const rest = new Map<string, RestNode>();
  for (const n of rig.getRoot().listNodes()) {
    rest.set(n.getName(), {
      parent: null,
      t: n.getTranslation() as Vec3,
      r: n.getRotation() as Quat,
    });
  }
  for (const n of rig.getRoot().listNodes()) {
    for (const c of n.listChildren()) {
      const e = rest.get(c.getName());
      if (e) e.parent = n.getName();
    }
  }

  return {
    bones: [...rest.keys()],
    /** Duration of a clip in the animation GLB. */
    duration(clipName: string): number {
      let dur = 0;
      for (const ch of indexClip(clips.getRoot(), clipName).values()) {
        dur = Math.max(dur, ch.times[ch.times.length - 1]);
      }
      return dur;
    },
    /** Resolve the whole skeleton at one time of one clip. */
    pose(clipName: string, time: number): PosedSkeleton {
      const idx = indexClip(clips.getRoot(), clipName);
      const sampled = new Map<string, number[]>();
      for (const [key, ch] of idx) sampled.set(key, sampleChannel(ch, time));
      const at = (bone: string): Vec3 => {
        const chain: string[] = [];
        for (let k: string | null = bone; k; k = rest.get(k)?.parent ?? null) chain.unshift(k);
        let p: Vec3 = [0, 0, 0];
        let q: Quat = [0, 0, 0, 1];
        for (const k of chain) {
          const node = rest.get(k);
          if (!node) continue;
          const t = (sampled.get(`${k}|translation`) as Vec3) ?? node.t;
          const r = (sampled.get(`${k}|rotation`) as Quat) ?? node.r;
          const off = qrot(q, t);
          p = [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
          q = qmul(q, r);
        }
        return p;
      };
      return { at, bones: [...rest.keys()] };
    },
  };
}
