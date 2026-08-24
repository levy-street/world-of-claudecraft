import * as THREE from 'three';

/** Reuses raycasting scratch while projecting canvas coordinates onto a horizontal plane. */
export class GroundPointProjector {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();

  constructor(
    private readonly canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'>,
    private readonly camera: THREE.Camera,
  ) {}

  project(clientX: number, clientY: number, planeY: number): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.groundPlane.constant = -planeY;
    return this.raycaster.ray.intersectPlane(this.groundPlane, this.hit)
      ? { x: this.hit.x, z: this.hit.z }
      : null;
  }
}
