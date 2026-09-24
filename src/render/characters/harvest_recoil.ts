import * as THREE from 'three';

/** A receiving-body impulse, never root motion or an interruption of its action. */
export class HarvestRecoil {
  private age = 1;
  private strength = 0;
  private direction = 1;
  private away = Math.PI;
  private hold = 0.02;
  private readonly point = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();

  trigger(
    beat: number,
    height: number,
    root?: THREE.Object3D,
    source?: { x: number; z: number },
  ): void {
    this.age = 0;
    if (root) {
      root.getWorldScale(this.point);
      height *= Math.abs(this.point.y);
    }
    // Tall creatures retain a readable bite without a humanoid-sized topple.
    this.strength = (beat === 2 ? 0.115 : 0.075) / Math.max(1, height / 3);
    this.hold = beat === 2 ? 0.048 : 0.02;
    this.direction = beat === 1 ? -1 : 1;
    this.away = Math.PI;
    if (root && source) {
      root.getWorldPosition(this.point);
      const x = this.point.x - source.x,
        z = this.point.z - source.z;
      root.getWorldQuaternion(this.rotation).invert();
      this.point.set(x, 0, z).applyQuaternion(this.rotation);
      this.away = Math.atan2(this.point.x, this.point.z);
    }
  }

  apply(pose: THREE.Object3D, dt: number, suppressed: boolean): void {
    if (suppressed) this.age = 1;
    else this.age += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const t = Math.max(0, this.age - this.hold) / 0.19;
    if (t >= 1) return;
    const bite = Math.min(1, this.age / 0.008) * (1 - t) ** 2;
    const recover = -Math.sin(t * Math.PI * 2) * (1 - t) * 0.22;
    pose.rotation.x += Math.cos(this.away) * this.strength * (bite + recover);
    pose.rotation.z += (-Math.sin(this.away) + this.direction * 0.25) * this.strength * bite;
    pose.position.y -= this.strength * bite * 0.4;
  }

  clear(): void {
    this.age = 1;
  }
}
