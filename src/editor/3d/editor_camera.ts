// Free/orbit editor camera for the 3D map editor. Terrain-agnostic: it owns yaw/
// pitch/dist around a free-floating `target`; the viewport only soft-floors the
// target above the terrain and writes the derived pose to Renderer.editorCam.
// Hand-rolled (not OrbitControls) so it never fights the Renderer's own camera
// writes.

import * as THREE from 'three';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class EditorCamera {
  // Look-at point on the ground; the camera orbits this.
  target = new THREE.Vector3(0, 0, 0);
  yaw = Math.PI; // azimuth (matches the game's default behind-the-player yaw)
  pitch = 0.62; // elevation, radians
  dist = 70;

  private readonly minPitch = 0.08;
  private readonly maxPitch = 1.45;
  private readonly minDist = 6;
  private readonly maxDist = 220;

  // Reused output for pose(): called once per frame, so no per-frame Vector3
  // allocations. The renderer copies the vectors immediately (sync()).
  private readonly poseOut = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

  // The camera pose to hand to Renderer.editorCam. Orbit math mirrors the game's
  // chase camera so the feel matches play-test.
  pose(): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    this.poseOut.pos.set(
      this.target.x - Math.sin(this.yaw) * cp * this.dist,
      this.target.y + sp * this.dist + 2,
      this.target.z - Math.cos(this.yaw) * cp * this.dist,
    );
    this.poseOut.target.copy(this.target); // look at the ground point
    return this.poseOut;
  }

  orbit(dxPx: number, dyPx: number): void {
    this.yaw -= dxPx * 0.005;
    this.pitch = clamp(this.pitch + dyPx * 0.005, this.minPitch, this.maxPitch);
  }

  zoom(deltaY: number): void {
    this.dist = clamp(this.dist * Math.exp(deltaY * 0.001), this.minDist, this.maxDist);
  }

  // Drag-pan the target across the ground (screen-pixel delta). Forward is the
  // camera's horizontal look direction; right is perpendicular.
  pan(dxPx: number, dyPx: number): void {
    const speed = this.dist * 0.0016;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    this.target.x += (-dxPx * rx + dyPx * fx) * speed;
    this.target.z += (-dxPx * rz + dyPx * fz) * speed;
  }

  // WASD/QE fly: forward/right in the ground plane, up vertical. `dt` seconds.
  // E/Q move the target itself up/down (a true free camera); the wheel keeps
  // owning the orbit distance.
  fly(forward: number, right: number, up: number, dt: number): void {
    const speed = this.dist * dt * 1.4;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    this.target.x += (forward * fx + right * rx) * speed;
    this.target.z += (forward * fz + right * rz) * speed;
    this.target.y += up * speed;
  }
}
