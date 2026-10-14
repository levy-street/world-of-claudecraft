// Iced: what a body looks like after a Tidewarden's Lance lands on it.
//
// A frozen fighter still has to READ as frozen from across the bell, otherwise
// the three seconds you spent a powerup on look like your opponent choosing to
// hold still. So a hit body wears a faceted ice shell that snaps on hard and
// melts off, sized to the chibi rather than to the model bounds (every class
// shares the same rig, so one size is right for all of them).
//
// A pooled group of shells rather than one per body: the roster is at most ten,
// and only the frozen ones are ever shown.

import * as THREE from 'three';

/** Chest-height offset; the sim puts a body's origin at the soles. */
const ICE_CENTRE_Y = 1;
const ICE_COLOR = 0xa8ecff;
/** Seconds the shell takes to form and to melt. */
const ICE_SNAP = 0.12;
const ICE_MELT = 0.45;

export interface IceSample {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Seconds of freeze left. */
  remaining: number;
}

interface Shell {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  /** How formed the shell is, 0..1. Snaps up, melts down. */
  k: number;
}

export class DeepglassIce {
  readonly group = new THREE.Group();
  private readonly shells = new Map<number, Shell>();
  private readonly geo = new THREE.IcosahedronGeometry(1.25, 1);

  constructor() {
    this.group.name = 'deepglass-ice';
    this.group.frustumCulled = false;
  }

  private shellFor(id: number): Shell {
    const found = this.shells.get(id);
    if (found) return found;
    const mat = new THREE.MeshBasicMaterial({
      color: ICE_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // Faceted and see-through both ways: a shell you cannot see the body
      // inside is a snowball, not a frozen player.
      wireframe: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 14;
    mesh.visible = false;
    this.group.add(mesh);
    const shell: Shell = { mesh, mat, k: 0 };
    this.shells.set(id, shell);
    return shell;
  }

  /** `samples` yields every body in the bout with its remaining freeze (0 for
   *  everyone who is not frozen), so a shell can melt rather than pop. */
  update(dt: number, samples: Iterable<IceSample>): void {
    const live = new Set<number>();
    for (const s of samples) {
      live.add(s.id);
      const shell = this.shellFor(s.id);
      // Snaps on over ICE_SNAP, melts off over the far slower ICE_MELT: the hit
      // should land like a slap and let go like thaw.
      const rate = s.remaining > 0 ? dt / ICE_SNAP : -dt / ICE_MELT;
      shell.k = Math.max(0, Math.min(1, shell.k + rate));
      shell.mesh.visible = shell.k > 0.01;
      if (!shell.mesh.visible) continue;
      shell.mat.opacity = 0.16 + shell.k * 0.34;
      shell.mesh.position.set(s.x, s.y + ICE_CENTRE_Y, s.z);
      // Shrinks slightly as it melts, and never spins: frozen means STILL.
      shell.mesh.scale.setScalar(0.85 + shell.k * 0.35);
    }

    for (const [id, shell] of this.shells) {
      if (live.has(id)) continue;
      shell.mesh.removeFromParent();
      shell.mat.dispose();
      this.shells.delete(id);
    }
  }

  dispose(): void {
    for (const [, shell] of this.shells) {
      shell.mesh.removeFromParent();
      shell.mat.dispose();
    }
    this.shells.clear();
    this.geo.dispose();
  }
}
