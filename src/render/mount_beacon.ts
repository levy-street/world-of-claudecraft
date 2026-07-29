// Riding-lesson start platform: a pulsing yellow square on the ground behind the
// show-jumping arch. It marks the exact area that surfaces the Start Race button.
// Cosmetic only, and it reads no governor/tier state.
//
// Reuses the yellow-orange summon-glow palette for visual consistency with the mount
// summon; it hides the moment the driving condition goes false.

import * as THREE from 'three';
import { MOUNT_RACE_START_PLATFORM } from '../sim/content/mounts';

// The summon-glow palette (amber / cream), boosted so the composer bloom picks the
// beacon up on the tiers that run it.
const AMBER = new THREE.Color(0xffb000).multiplyScalar(2.2);
const CREAM = new THREE.Color(0xffe680).multiplyScalar(2.2);

export class MountBeacon {
  private readonly group = new THREE.Group();
  private readonly baseMat: THREE.MeshBasicMaterial;
  private readonly innerMat: THREE.MeshBasicMaterial;
  private readonly inner: THREE.Mesh;

  constructor(scene: THREE.Object3D, groundAt: (x: number, z: number) => number) {
    this.baseMat = new THREE.MeshBasicMaterial({
      color: AMBER.clone(),
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.innerMat = new THREE.MeshBasicMaterial({
      color: CREAM.clone(),
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(MOUNT_RACE_START_PLATFORM.size, MOUNT_RACE_START_PLATFORM.size),
      this.baseMat,
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.06;
    this.inner = new THREE.Mesh(
      new THREE.PlaneGeometry(
        MOUNT_RACE_START_PLATFORM.size - 0.8,
        MOUNT_RACE_START_PLATFORM.size - 0.8,
      ),
      this.innerMat,
    );
    this.inner.rotation.x = -Math.PI / 2;
    this.inner.position.y = 0.09;
    this.group.add(base, this.inner);
    // The platform never moves; park it once on the shared course coordinates.
    const { x, z } = MOUNT_RACE_START_PLATFORM;
    this.group.position.set(x, groundAt(x, z), z);
    this.group.visible = false;
    this.group.renderOrder = 3;
    scene.add(this.group);
  }

  /** Per-frame: show the lesson platform while its quest is active and no race is
   *  running, pulsing it; hide it otherwise. */
  update(show: boolean, time: number): void {
    this.group.visible = show;
    if (!show) return;
    const pulse = 0.5 + 0.5 * Math.sin(time * 3.4);
    this.baseMat.opacity = 0.35 + 0.22 * pulse;
    this.innerMat.opacity = 0.18 + 0.22 * pulse;
    const innerScale = 0.96 + 0.04 * pulse;
    this.inner.scale.set(innerScale, innerScale, innerScale);
  }
}
