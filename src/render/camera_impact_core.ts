interface Point {
  x: number;
  y: number;
  z: number;
}
interface CameraPose {
  position: Point;
  quaternion: { x: number; y: number; z: number; w: number };
}

/** Draw-only impact, bounded and position-aware. No camera preference or world state writes. */
export class CameraImpact {
  private trauma = 0;
  private elapsed = 0;
  private dx = 0;
  private dz = 0;
  private kick = 0;
  private ox = 0;
  private oy = 0;
  private oz = 0;
  clear(): void {
    this.trauma = 0;
    this.kick = 0;
    this.elapsed = 0;
  }
  add(amount: number, camera: Point, x?: number, y?: number, z?: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.trauma = Math.min(0.65, this.trauma + amount);
    if (x !== undefined && y !== undefined && z !== undefined && [x, y, z].every(Number.isFinite)) {
      const dx = camera.x - x,
        dz = camera.z - z,
        len = Math.hypot(dx, dz);
      if (len > 0.001) {
        this.dx = dx / len;
        this.dz = dz / len;
        this.kick = Math.min(0.18, this.kick + amount * 0.24);
      }
    }
  }
  beginDraw(camera: CameraPose, dt: number, reducedMotion: boolean): boolean {
    this.ox = 0;
    this.oy = 0;
    this.oz = 0;
    if (reducedMotion) {
      this.trauma = 0;
      this.kick = 0;
      return false;
    }
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.elapsed += step;
    const q = camera.quaternion,
      power = this.trauma * this.trauma;
    const horizontal = Math.sin(this.elapsed * 43) * power * 0.18;
    const vertical = Math.sin(this.elapsed * 57 + 1.1) * power * 0.12;
    // The quaternion's local X and Y columns keep vibration in camera space.
    this.ox =
      (1 - 2 * (q.y * q.y + q.z * q.z)) * horizontal +
      2 * (q.x * q.y - q.z * q.w) * vertical +
      this.dx * this.kick;
    this.oy =
      2 * (q.x * q.y + q.z * q.w) * horizontal + (1 - 2 * (q.x * q.x + q.z * q.z)) * vertical;
    this.oz =
      2 * (q.x * q.z - q.y * q.w) * horizontal +
      2 * (q.y * q.z + q.x * q.w) * vertical +
      this.dz * this.kick;
    camera.position.x += this.ox;
    camera.position.y += this.oy;
    camera.position.z += this.oz;
    this.trauma = Math.max(0, this.trauma - step * 1.8);
    this.kick *= Math.exp(-step * 18);
    if (this.kick < 0.0001) this.kick = 0;
    return this.ox !== 0 || this.oy !== 0 || this.oz !== 0;
  }
  endDraw(camera: CameraPose): void {
    camera.position.x -= this.ox;
    camera.position.y -= this.oy;
    camera.position.z -= this.oz;
    this.ox = 0;
    this.oy = 0;
    this.oz = 0;
  }
}
