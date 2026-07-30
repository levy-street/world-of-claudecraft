// Show-jumping racing line: a glowing chevron ribbon laid on the paddock ground
// along the ideal course path (arch -> jumps in riding order -> arch), so a
// racer can see exactly where to ride. Strictly SELF-scoped and cosmetic: it is
// driven from IWorld.mountRaceView() (the player's OWN race, null otherwise), so
// it shows only during your own run and never for bystanders or other racers,
// and it conveys nothing the HUD strip and the physical fixtures do not. It
// reads no governor/tier state.
//
// The geometry is a closed Catmull-Rom loop through the shared MOUNT_RACE_COURSE
// gates (the same content the sim detects against), sampled onto the terrain via
// the renderer's ground sampler and built ONCE on the first race, then only
// toggled/scrolled. The chevrons scroll toward the riding direction (the curve
// runs in gate order, so scrolling the texture backward moves them forward).

import * as THREE from 'three';
import { MOUNT_RACE_COURSE } from '../sim/content/mounts';
import type { MountRaceView } from '../world_api';
import { jumpArcLiftAt, raceGateMarkerState } from './race_line_core';

const RIBBON_WIDTH = 0.9;
const RIBBON_LIFT = 0.14; // above the terrain, under the rider
const SAMPLES = 220; // ribbon cross-sections around the whole loop
const CHEVRON_LENGTH = 2.4; // world units per chevron repeat
const SCROLL_SPEED = 1.6; // repeats per second, toward the riding direction
const GOLD = new THREE.Color(0xffc860).multiplyScalar(1.8);
const GREEN = new THREE.Color(0x63ff78).multiplyScalar(2.1);
const MARKER_HEIGHT = 4.2;

/** A small repeating chevron strip texture ("ride this way" arrows), drawn once
 *  on a canvas (procedural, no image asset; textures.ts convention). */
function chevronTexture(): THREE.Texture {
  const w = 64;
  const h = 32;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  // One chevron pointing +u (the riding direction).
  ctx.beginPath();
  ctx.moveTo(10, 4);
  ctx.lineTo(34, 16);
  ctx.lineTo(10, 28);
  ctx.lineTo(22, 16);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export class RaceLine {
  private ribbon: THREE.Mesh | null = null;
  private mat: THREE.MeshBasicMaterial | null = null;
  private tex: THREE.Texture | null = null;
  private markerRoot: THREE.Group | null = null;
  private activeMarker: THREE.Group | null = null;
  private activeOrbMat: THREE.MeshBasicMaterial | null = null;
  private activeHaloMat: THREE.MeshBasicMaterial | null = null;
  private clearedMarkers: THREE.Group[] = [];

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly groundAt: (x: number, z: number) => number,
  ) {}

  /** Build the terrain-following ribbon once, lazily (first race). */
  private build(): void {
    const gates = [MOUNT_RACE_COURSE.arch, ...MOUNT_RACE_COURSE.jumps];
    const pts = gates.map((g) => new THREE.Vector3(g.x, 0, g.z));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const positions = new Float32Array((SAMPLES + 1) * 2 * 3);
    const uvs = new Float32Array((SAMPLES + 1) * 2 * 2);
    const index: number[] = [];
    const p = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    let u = 0;
    let prevX = 0;
    let prevZ = 0;
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      curve.getPoint(t, p);
      curve.getTangent(t, tangent);
      // Accumulate real path length so the chevron spacing is uniform.
      if (i > 0) u += Math.hypot(p.x - prevX, p.z - prevZ) / CHEVRON_LENGTH;
      prevX = p.x;
      prevZ = p.z;
      // Ground-plane normal to the path.
      const len = Math.hypot(tangent.x, tangent.z) || 1;
      const nx = -tangent.z / len;
      const nz = tangent.x / len;
      const half = RIBBON_WIDTH / 2;
      const lx = p.x + nx * half;
      const lz = p.z + nz * half;
      const rx = p.x - nx * half;
      const rz = p.z - nz * half;
      const vi = i * 2;
      const arcLift = jumpArcLiftAt(p.x, p.z);
      positions.set([lx, this.groundAt(lx, lz) + RIBBON_LIFT + arcLift, lz], vi * 3);
      positions.set([rx, this.groundAt(rx, rz) + RIBBON_LIFT + arcLift, rz], (vi + 1) * 3);
      uvs.set([u, 0], vi * 2);
      uvs.set([u, 1], (vi + 1) * 2);
      if (i > 0) {
        const a = vi - 2;
        const b = vi - 1;
        index.push(a, b, vi, b, vi + 1, vi);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(index);
    this.tex = chevronTexture();
    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex,
      color: GOLD.clone(),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ribbon = new THREE.Mesh(geo, this.mat);
    this.ribbon.renderOrder = 3;
    this.ribbon.visible = false;
    this.scene.add(this.ribbon);

    // Gate feedback: one amber floating light marks the next recommended jump;
    // every cleared gate keeps a green light so the rider can verify the pass.
    // MeshBasicMaterial keeps this actionable guidance visible on every tier
    // without adding dynamic PointLights or changing the renderer's light count.
    this.markerRoot = new THREE.Group();
    const orbGeo = new THREE.SphereGeometry(0.38, 12, 8);
    const haloGeo = new THREE.SphereGeometry(0.78, 12, 8);
    this.activeOrbMat = new THREE.MeshBasicMaterial({ color: GOLD.clone() });
    this.activeHaloMat = new THREE.MeshBasicMaterial({
      color: GOLD.clone(),
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.activeMarker = new THREE.Group();
    this.activeMarker.add(
      new THREE.Mesh(orbGeo, this.activeOrbMat),
      new THREE.Mesh(haloGeo, this.activeHaloMat),
    );
    this.markerRoot.add(this.activeMarker);

    const clearedOrbMat = new THREE.MeshBasicMaterial({ color: GREEN.clone() });
    const clearedHaloMat = new THREE.MeshBasicMaterial({
      color: GREEN.clone(),
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (const jump of MOUNT_RACE_COURSE.jumps) {
      const marker = new THREE.Group();
      marker.add(new THREE.Mesh(orbGeo, clearedOrbMat), new THREE.Mesh(haloGeo, clearedHaloMat));
      marker.position.set(jump.x, this.groundAt(jump.x, jump.z) + MARKER_HEIGHT, jump.z);
      marker.visible = false;
      this.clearedMarkers.push(marker);
      this.markerRoot.add(marker);
    }
    this.markerRoot.visible = false;
    this.markerRoot.renderOrder = 4;
    this.scene.add(this.markerRoot);
  }

  /** Per-frame update from the authoritative self view: visible only while the
   *  player's OWN race is live; scrolls the chevrons along the riding direction
   *  and breathes the glow. `time` is the renderer's shared clock (seconds). */
  update(view: MountRaceView | null, time: number, dt: number): void {
    if (!view) {
      if (this.ribbon) this.ribbon.visible = false;
      if (this.markerRoot) this.markerRoot.visible = false;
      return;
    }
    if (!this.ribbon) this.build();
    if (!this.ribbon || !this.mat || !this.tex) return;
    this.ribbon.visible = true;
    if (this.markerRoot) this.markerRoot.visible = true;
    // Negative offset drift moves the +u chevrons forward along the course.
    this.tex.offset.x -= SCROLL_SPEED * dt;
    this.mat.opacity = 0.7 + 0.25 * Math.sin(time * 2.6);

    let activeIndex = -1;
    for (let i = 0; i < this.clearedMarkers.length; i++) {
      const state = raceGateMarkerState(view.clearedMask, i, this.clearedMarkers.length);
      this.clearedMarkers[i].visible = state === 'cleared';
      if (state === 'next') activeIndex = i;
    }
    if (this.activeMarker) {
      this.activeMarker.visible = activeIndex >= 0;
      if (activeIndex >= 0) {
        const jump = MOUNT_RACE_COURSE.jumps[activeIndex];
        const bob = 0.22 * Math.sin(time * 3.2);
        this.activeMarker.position.set(
          jump.x,
          this.groundAt(jump.x, jump.z) + MARKER_HEIGHT + bob,
          jump.z,
        );
        const pulse = 1 + 0.16 * (0.5 + 0.5 * Math.sin(time * 4.4));
        this.activeMarker.scale.setScalar(pulse);
      }
    }
    if (this.activeHaloMat) this.activeHaloMat.opacity = 0.18 + 0.16 * Math.sin(time * 2.8) ** 2;
  }
}
