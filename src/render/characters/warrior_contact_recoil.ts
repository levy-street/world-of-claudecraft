import * as THREE from 'three';

interface ContactPose {
  lean: number;
  bank: number;
  compression: number;
  catch: number;
  recovery: number;
}

// Explicit receiving actions only: buffs, periodic wounds and Red Harvest
// cannot opt in through their school, damage amount or a shared animation.
const CONTACTS: Readonly<Record<string, ContactPose | undefined>> = {
  heroic_strike: { lean: 0.072, bank: -0.32, compression: 0.018, catch: 0.018, recovery: 0.16 },
  slam: { lean: 0.12, bank: -0.1, compression: 0.045, catch: 0.032, recovery: 0.2 },
  mortal_strike: { lean: 0.132, bank: -0.38, compression: 0.028, catch: 0.034, recovery: 0.21 },
  execute: { lean: 0.158, bank: -0.28, compression: 0.055, catch: 0.04, recovery: 0.23 },
  breachmaker: { lean: 0.104, bank: 0.08, compression: 0.027, catch: 0.026, recovery: 0.18 },
  overpower: { lean: 0.106, bank: 0.48, compression: 0.014, catch: 0.025, recovery: 0.18 },
  victory_rush: { lean: 0.112, bank: 0.28, compression: 0.025, catch: 0.026, recovery: 0.19 },
  raging_gale: { lean: 0.108, bank: -0.52, compression: 0.028, catch: 0.023, recovery: 0.16 },
  bloodthirst: { lean: 0.118, bank: -0.4, compression: 0.034, catch: 0.03, recovery: 0.19 },
  cleave: { lean: 0.09, bank: 0.42, compression: 0.022, catch: 0.022, recovery: 0.17 },
  revenge: { lean: 0.108, bank: -0.36, compression: 0.03, catch: 0.026, recovery: 0.18 },
  thunder_clap: { lean: 0.102, bank: 0.06, compression: 0.041, catch: 0.028, recovery: 0.19 },
  heroic_leap: { lean: 0.124, bank: 0.08, compression: 0.05, catch: 0.034, recovery: 0.21 },
  faultline: { lean: 0.138, bank: -0.08, compression: 0.05, catch: 0.035, recovery: 0.21 },
  hamstring: { lean: 0.052, bank: 0.42, compression: 0.024, catch: 0.014, recovery: 0.14 },
  pummel: { lean: 0.086, bank: -0.18, compression: 0.018, catch: 0.022, recovery: 0.15 },
  sunder_armor: { lean: 0.088, bank: -0.26, compression: 0.026, catch: 0.023, recovery: 0.17 },
  whirlwind: { lean: 0.066, bank: 0.48, compression: 0.014, catch: 0.015, recovery: 0.14 },
  bladestorm: { lean: 0.076, bank: -0.48, compression: 0.018, catch: 0.018, recovery: 0.15 },
  shield_slam: { lean: 0.154, bank: 0.12, compression: 0.052, catch: 0.04, recovery: 0.22 },
  storm_bolt: { lean: 0.148, bank: -0.14, compression: 0.046, catch: 0.038, recovery: 0.21 },
};

export function hasWarriorContactRecoil(id: string): boolean {
  return Object.hasOwn(CONTACTS, id);
}

/** One bounded receiving-body impulse. The displayed pose is composed afresh
 * each frame; the world root, rig clips and simulation remain untouched. */
export class WarriorContactRecoil {
  private age = 1;
  private pitch = 0;
  private bank = 0;
  private compression = 0;
  private catch = 0;
  private recovery = 0;
  private readonly point = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();

  trigger(
    id: string,
    beat: number,
    height: number,
    root?: THREE.Object3D,
    source?: { x: number; z: number },
  ): boolean {
    if (!hasWarriorContactRecoil(id) || !Number.isFinite(height) || height <= 0) return false;
    const profile = CONTACTS[id]!;
    // Coincident recipients/rapid repeats may share the same receiving rig.
    // Never extend the catch or sum their force into an ever-growing offset.
    if (this.age < this.catch + 0.045) return false;
    let away = Math.PI;
    if (root) {
      root.getWorldScale(this.point);
      height *= Math.abs(this.point.y);
      if (!Number.isFinite(height) || height <= 0) return false;
      if (source && Number.isFinite(source.x) && Number.isFinite(source.z)) {
        root.getWorldPosition(this.point);
        this.point.set(this.point.x - source.x, 0, this.point.z - source.z);
        root.getWorldQuaternion(this.rotation).invert();
        this.point.applyQuaternion(this.rotation);
        if (
          Number.isFinite(this.point.x) &&
          Number.isFinite(this.point.z) &&
          this.point.lengthSq() > 1e-8
        )
          away = Math.atan2(this.point.x, this.point.z);
      }
    }
    const reverse = id === 'raging_gale' && beat === 1;
    const lateral = reverse ? -profile.bank : profile.bank;
    const attenuation = 1 / Math.max(1, height / 3);
    const force = Math.min(0.16, profile.lean * (reverse ? 1.18 : 1)) * attenuation;
    const normalization = 1 / Math.hypot(1, lateral);
    this.pitch = (Math.cos(away) + Math.sin(away) * lateral) * normalization * force;
    this.bank = (-Math.sin(away) + Math.cos(away) * lateral) * normalization * force;
    this.compression = profile.compression * attenuation * (reverse ? 1.12 : 1);
    this.catch = profile.catch;
    this.recovery = profile.recovery;
    this.age = 0;
    return true;
  }

  apply(pose: THREE.Object3D, dt: number, suppressed: boolean): void {
    if (suppressed) {
      this.clear();
      return;
    }
    this.age += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (this.age >= this.catch + this.recovery) return;
    const release = Math.max(0, this.age - this.catch) / this.recovery;
    const onset = Math.min(1, this.age / 0.008);
    // Fast compression, brief catch, then one damped return through neutral.
    // Its envelope never exceeds one, including at coarse frame intervals.
    const impulse = onset * Math.cos(release * Math.PI * 1.5) * (1 - release) ** 2;
    pose.rotation.x += this.pitch * impulse;
    pose.rotation.z += this.bank * impulse;
    pose.position.y -= this.compression * onset * (1 - release) ** 3;
  }

  clear(): void {
    this.age = 1;
  }
}
