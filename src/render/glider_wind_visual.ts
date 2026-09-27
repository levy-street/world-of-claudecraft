import * as THREE from 'three';
import type { GliderWindTunnelDef } from '../sim/minigames/glider_flight';

/** Sparse, open wind corridors. The course owns visibility and its compile gate. */
export class GliderWindVisual {
  readonly group = new THREE.Group();
  private readonly corridors: {
    id: string;
    geometry: THREE.BufferGeometry;
    material: THREE.LineBasicMaterial;
  }[] = [];
  private disposed = false;

  constructor(tunnels: readonly GliderWindTunnelDef[]) {
    this.group.name = 'glider-wind-tunnels';
    for (const tunnel of tunnels) {
      const vertices: number[] = [];
      const point = (angle: number, z: number) => {
        vertices.push(Math.cos(angle) * tunnel.radius, Math.sin(angle) * tunnel.radius, z);
      };
      // Three open helices leave the flight lane unobstructed, unlike filled cylinders.
      for (let strand = 0; strand < 3; strand++) {
        const offset = (strand * Math.PI * 2) / 3;
        for (let step = 0; step < 48; step++) {
          for (const endpoint of [step, step + 1]) {
            const fraction = endpoint / 48;
            point(offset + fraction * Math.PI * 3, (fraction - 0.5) * tunnel.length);
          }
        }
      }
      // Arrowheads on the walls indicate the accepted +Z crossing direction.
      for (let side = 0; side < 4; side++) {
        const angle = (side * Math.PI) / 2;
        for (const fraction of [-0.25, 0.15]) {
          const z = fraction * tunnel.length;
          point(angle - 0.18, z - 1.2);
          point(angle, z);
          point(angle, z);
          point(angle + 0.18, z - 1.2);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.computeBoundingSphere();
      const material = new THREE.LineBasicMaterial({
        color: 0xc6fff2,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      });
      const lines = new THREE.LineSegments(geometry, material);
      lines.name = `glider-wind-${tunnel.id}`;
      lines.position.set(tunnel.x, tunnel.y, tunnel.z);
      lines.rotation.y = tunnel.yaw;
      this.group.add(lines);
      this.corridors.push({ id: tunnel.id, geometry, material });
    }
  }

  update(used: readonly string[] | undefined): void {
    if (this.disposed) return;
    for (const corridor of this.corridors) {
      // Retain the whole route for orientation after its one-use boost is spent.
      corridor.material.opacity = used?.includes(corridor.id) ? 0.35 : 0.85;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const corridor of this.corridors) {
      corridor.geometry.dispose();
      corridor.material.dispose();
    }
  }
}
