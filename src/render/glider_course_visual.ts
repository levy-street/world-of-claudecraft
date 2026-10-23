// Visuals for the Galecrest Windrider Slalom course.
// Procedural glowing wind rings and landing target rendered in Three.js.

import * as THREE from 'three';
import { GLIDER_COURSE, GLIDER_QUEST_ID } from '../sim/content/world_quest_glider';
import { GLIDER_COURSES } from '../sim/content/world_quest_glider_levels';
import { gliderCourseForCycle } from '../sim/world_quest_glider_generation';
import type { IWorld } from '../world_api';
import { attachSceneGroupGated } from './gated_scene_attach';
import { createGliderApparatusMesh } from './glider_apparatus';
import { gliderCourseVisible } from './glider_course_core';
import { gliderApparatusPitch } from './glider_flight_pose_core';
import { GliderWindVisual } from './glider_wind_visual';

// Preserve the asset-fit and preload test seams at the original import path.
export { fitGliderApparatus, gliderCourseVisualPreloadInternalsForTest } from './glider_apparatus';

export class GliderCourseVisual {
  readonly group = new THREE.Group();
  readonly readyForEntry: Promise<void>;
  private ready = false;
  private disposed = false;

  private readonly activeRingMat = new THREE.MeshBasicMaterial({
    color: 0x45c8ff,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  private readonly futureRingMat = new THREE.MeshBasicMaterial({
    color: 0xf05252,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  private readonly passedRingMat = new THREE.MeshBasicMaterial({
    color: 0x75f69a,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  private readonly landingPadMat = new THREE.MeshBasicMaterial({
    color: 0xffd45b,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  private readonly ringMeshes: THREE.Mesh[] = [];
  private readonly landingMesh: THREE.Mesh;
  private readonly landingBeacon: THREE.Mesh;
  private readonly apparatus: ReturnType<typeof createGliderApparatusMesh>;
  private readonly winds = new Map<string, GliderWindVisual>();
  private course = GLIDER_COURSE;

  constructor(
    scene: THREE.Object3D,
    groundAt: (x: number, z: number) => number,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ) {
    this.group.name = 'glider-course-visual';
    this.group.visible = false;

    const rings = GLIDER_COURSE.rings;
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      const geo = new THREE.TorusGeometry(ring.radius, 0.45, 12, 28);
      const mesh = new THREE.Mesh(geo, this.activeRingMat);
      mesh.position.set(ring.x, ring.y, ring.z);

      const nextTarget =
        i < rings.length - 1
          ? rings[i + 1]
          : {
              x: GLIDER_COURSE.landingPad.x,
              y: GLIDER_COURSE.landingPad.y,
              z: GLIDER_COURSE.landingPad.z,
            };
      mesh.lookAt(nextTarget.x, nextTarget.y, nextTarget.z);

      this.ringMeshes.push(mesh);
      this.group.add(mesh);
    }

    const pad = GLIDER_COURSE.landingPad;
    const padGeo = new THREE.RingGeometry(pad.radius - 0.25, pad.radius, 128, 2);
    const positions = padGeo.getAttribute('position');
    // Bake the terrain shape once; the landing warning stays above uneven ground.
    for (let i = 0; i < positions.count; i++) {
      const x = pad.x + positions.getX(i);
      const z = pad.z - positions.getY(i);
      positions.setXYZ(i, x, groundAt(x, z) + 0.45, z);
    }
    padGeo.computeVertexNormals();
    padGeo.computeBoundingSphere();
    this.landingMesh = new THREE.Mesh(padGeo, this.landingPadMat);
    this.group.add(this.landingMesh);
    this.landingBeacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), this.landingPadMat);
    this.landingBeacon.name = 'glider-landing-beacon';
    this.landingBeacon.scale.y = 1.7;
    this.landingBeacon.position.set(pad.x, groundAt(pad.x, pad.z) + 1.25, pad.z);
    this.group.add(this.landingBeacon);

    this.apparatus = createGliderApparatusMesh();
    this.group.add(this.apparatus.group);
    // Stage every route under the existing gate; switching levels allocates no GPU resources.
    for (const course of GLIDER_COURSES) {
      const wind = new GliderWindVisual(course.windTunnels ?? []);
      wind.group.visible = course === GLIDER_COURSE;
      this.winds.set(course.id, wind);
      this.group.add(wind.group);
    }

    const attach = () => attachSceneGroupGated(scene, this.group, compileGate, () => this.disposed);
    // A late asset must be attached before the gate enumerates its material carriers.
    this.readyForEntry = (
      this.apparatus.group.children.length > 0
        ? attach()
        : this.apparatus.readyForEntry.then(attach)
    )
      .then(() => {
        this.ready = !this.disposed;
        this.group.visible = false;
      })
      .catch(() => {
        if (!this.disposed) this.ready = true;
      });
  }

  update(world: IWorld, renderedSelf?: Pick<THREE.Object3D, 'position' | 'rotation'>): void {
    if (!this.ready || this.disposed) {
      this.group.visible = false;
      return;
    }
    const progress = world.worldQuestLog.get(GLIDER_QUEST_ID);
    const session = progress?.glider;
    const playerPos = world.player.pos;

    const isGliding = gliderCourseVisible(progress);

    if (!isGliding) {
      this.group.visible = false;
      this.apparatus.group.visible = false;
      return;
    }

    this.group.visible = true;
    // Course identity is stable across days; switching reuses warmed geometry.
    const course = gliderCourseForCycle(world.worldQuestCycle, session?.courseId);
    if (course !== this.course) {
      this.course = course;
      for (let i = 0; i < this.ringMeshes.length; i++) {
        const ring = course.rings[i];
        this.ringMeshes[i].visible = !!ring;
        if (!ring) continue;
        this.ringMeshes[i].scale.setScalar(ring.radius / GLIDER_COURSE.rings[i].radius);
        const next = course.rings[i + 1] ?? course.landingPad;
        this.ringMeshes[i].position.set(ring.x, ring.y, ring.z);
        this.ringMeshes[i].lookAt(next.x, next.y, next.z);
      }
    }
    for (const [id, wind] of this.winds) {
      wind.group.visible = id === course.id;
      if (wind.group.visible) wind.update(session?.windBoosts);
    }

    const nextRing = course.rings.find((ring) => !session?.passedRings.includes(ring.id));
    for (let i = 0; i < this.ringMeshes.length; i++) {
      const ring = course.rings[i];
      const mesh = this.ringMeshes[i];
      if (!ring) continue;
      mesh.material = session?.passedRings.includes(ring.id)
        ? this.passedRingMat
        : ring === nextRing
          ? this.activeRingMat
          : this.futureRingMat;
    }

    if (isGliding && session) {
      this.apparatus.group.visible = true;
      // Equipment follows the same interpolated position and yaw as the avatar.
      const pose = renderedSelf?.position ?? playerPos;
      this.apparatus.group.position.set(pose.x, pose.y + 1.22, pose.z);
      this.apparatus.group.rotation.y = renderedSelf?.rotation.y ?? world.player.facing;

      // YXZ applies pitch in the yawed glider's local frame, including east/west flight.
      this.apparatus.group.rotation.order = 'YXZ';
      const targetPitch = gliderApparatusPitch(session.vy, session.speed);
      this.apparatus.group.rotation.x += (targetPitch - this.apparatus.group.rotation.x) * 0.2;
    } else {
      this.apparatus.group.visible = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.visible = false;
    this.group.removeFromParent();
    for (const mesh of this.ringMeshes) {
      mesh.geometry.dispose();
    }
    this.landingMesh.geometry.dispose();
    this.landingBeacon.geometry.dispose();
    this.apparatus.dispose();
    for (const wind of this.winds.values()) wind.dispose();
    this.activeRingMat.dispose();
    this.passedRingMat.dispose();
    this.futureRingMat.dispose();
    this.landingPadMat.dispose();
  }
}
