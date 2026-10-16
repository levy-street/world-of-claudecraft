// Bone dials (VisualDef.dials): a few named bones a rig turns ON TOP of its
// clips, set by presentation gestures sent through the renderer's
// triggerAttack seam (the same route a boss stance swap takes). They show a
// value the clips cannot know (a pressure gauge's needle climbing, armour
// plates turning one face or the other out). The Stormbrass Foundry's bosses,
// its first users, are parked; the mechanism stays for any rig.
//
// Contract: every dial bone is keyed by every clip of its GLB (the Blender
// builds key every bone on every frame), so the mixer rewrites its pose each
// update and the dial post-multiplies its own turn about `axis` (the bone's
// local frame) on top. A dial eases toward its stop exponentially; a rattle
// gesture shakes it for a while (the plates rattling through a flip bar).
// The math is pure (stepDial, dialRattle) so tests import it directly.

import * as THREE from 'three';

export interface BoneDialDef {
  /** The bone (GLB node name) the dial turns. */
  bone: string;
  /** The turn axis in the bone's local frame. */
  axis: readonly [number, number, number];
  /** Gesture id -> the angle (radians) the dial settles at. */
  stops: Readonly<Record<string, number>>;
  /** Exponential approach rate (1/s): about 63 percent of the way per 1/rate. */
  rate: number;
  /** Optional shake: the gesture that starts it, how long, how far (radians). */
  rattle?: { gesture: string; seconds: number; amplitude: number };
}

/** One dial's live value. */
export interface DialState {
  angle: number;
  target: number;
  rattleLeft: number;
}

/** Ease `angle` toward `target` over `dt` seconds at `rate`. */
export function stepDial(state: DialState, rate: number, dt: number): number {
  const k = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));
  state.angle += (state.target - state.angle) * k;
  if (Math.abs(state.target - state.angle) < 1e-4) state.angle = state.target;
  state.rattleLeft = Math.max(0, state.rattleLeft - dt);
  return state.angle;
}

/** The rattle's offset at clock `t` (a fast, uneven shiver that fades out). */
export function dialRattle(t: number, left: number, seconds: number, amplitude: number): number {
  if (left <= 0 || seconds <= 0) return 0;
  const env = Math.min(1, left / Math.min(0.4, seconds));
  return amplitude * env * (0.6 * Math.sin(t * 47) + 0.4 * Math.sin(t * 83 + 1.3));
}

/** Which dials a gesture sets: [dial index, stop angle | 'rattle']. */
export function dialGesture(
  defs: readonly BoneDialDef[],
  gesture: string,
): [number, number | 'rattle'][] {
  const out: [number, number | 'rattle'][] = [];
  defs.forEach((d, i) => {
    const stop = d.stops[gesture];
    if (stop !== undefined) out.push([i, stop]);
    else if (d.rattle?.gesture === gesture) out.push([i, 'rattle']);
  });
  return out;
}

const AXIS = new THREE.Vector3();
const TURN = new THREE.Quaternion();

function findBone(model: THREE.Object3D, name: string): THREE.Object3D | null {
  return (
    model.getObjectByName(name) ?? model.getObjectByName(name.replace(/[[\].:/]/g, '')) ?? null
  );
}

/** The dials of one live rig. */
export class BoneDials {
  private readonly bones: (THREE.Object3D | null)[];
  private readonly states: DialState[];
  private readonly bases: THREE.Quaternion[];
  private readonly lasts: THREE.Quaternion[];
  private readonly applied: boolean[];
  private clock = 0;

  constructor(
    model: THREE.Object3D,
    private readonly defs: readonly BoneDialDef[],
  ) {
    this.bones = defs.map((d) => findBone(model, d.bone));
    this.bases = defs.map(() => new THREE.Quaternion());
    this.lasts = defs.map(() => new THREE.Quaternion());
    this.applied = defs.map(() => false);
    this.states = defs.map((d) => {
      const first = Object.values(d.stops)[0] ?? 0;
      return { angle: first, target: first, rattleLeft: 0 };
    });
  }

  /** A presentation gesture: true when it named one of these dials. */
  handle(gesture: string): boolean {
    const hits = dialGesture(this.defs, gesture);
    for (const [i, stop] of hits) {
      const st = this.states[i];
      if (stop === 'rattle') st.rattleLeft = this.defs[i].rattle?.seconds ?? 0;
      else st.target = stop;
    }
    return hits.length > 0;
  }

  /** After the mixer has written this frame's pose: turn each dial bone. */
  apply(dt: number): void {
    this.clock += dt;
    for (let i = 0; i < this.defs.length; i++) {
      const bone = this.bones[i];
      if (!bone) continue;
      const def = this.defs[i];
      const st = this.states[i];
      let a = stepDial(st, def.rate, dt);
      if (def.rattle)
        a += dialRattle(
          this.clock + i * 0.37,
          st.rattleLeft,
          def.rattle.seconds,
          def.rattle.amplitude,
        );
      // The mixer rewrites a keyed bone every update; if it did not this time
      // (an unkeyed re-export, no action bound), restore the pose the turn was
      // laid on instead of compounding it.
      const base = this.bases[i];
      const last = this.lasts[i];
      if (this.applied[i] && bone.quaternion.equals(last)) bone.quaternion.copy(base);
      else base.copy(bone.quaternion);
      AXIS.set(def.axis[0], def.axis[1], def.axis[2]).normalize();
      bone.quaternion.multiply(TURN.setFromAxisAngle(AXIS, a));
      last.copy(bone.quaternion);
      this.applied[i] = true;
    }
  }
}
