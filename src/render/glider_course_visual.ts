// Visuals for the Galecrest Windrider Slalom course.
// Procedural glowing wind rings and landing target rendered in Three.js.

import * as THREE from 'three';
import { GLIDER_COURSE, GLIDER_QUEST_ID } from '../sim/content/world_quest_glider';
import { GLIDER_COURSES } from '../sim/content/world_quest_glider_levels';
import { gliderCourseById } from '../sim/world_quest_glider_levels';
import type { IWorld } from '../world_api';
import { attachSceneGroupGated } from './gated_scene_attach';
import { gliderCourseVisible } from './glider_course_core';
import { gliderApparatusPitch } from './glider_flight_pose_core';
import { GliderWindVisual } from './glider_wind_visual';

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
  private readonly apparatus: { group: THREE.Group; dispose: () => void };
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

    this.readyForEntry = attachSceneGroupGated(scene, this.group, compileGate, () => this.disposed)
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
    const course = gliderCourseById(session?.courseId);
    if (course !== this.course) {
      this.course = course;
      for (let i = 0; i < this.ringMeshes.length; i++) {
        const ring = course.rings[i];
        const next = course.rings[i + 1] ?? course.landingPad;
        this.ringMeshes[i].position.set(ring.x, ring.y, ring.z);
        this.ringMeshes[i].lookAt(next.x, next.y, next.z);
      }
    }
    for (const [id, wind] of this.winds) {
      wind.group.visible = id === course.id;
      if (wind.group.visible) wind.update(session?.windBoosts);
    }

    for (let i = 0; i < this.ringMeshes.length; i++) {
      const ring = course.rings[i];
      const mesh = this.ringMeshes[i];
      mesh.material = session?.passedRings.includes(ring.id)
        ? this.passedRingMat
        : this.activeRingMat;
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
    this.landingPadMat.dispose();
  }
}

function createGliderApparatusMesh(): {
  group: THREE.Group;
  dispose: () => void;
} {
  const group = new THREE.Group();
  group.name = 'glider-apparatus';
  group.visible = false;

  const wingGeo = new THREE.BufferGeometry();
  const positions = new Float32Array([
    // Left wing
    0, 0.1, 0.9, -2.4, 0.28, -0.45, -0.4, 0.05, -0.85,

    0, 0.1, 0.9, -0.4, 0.05, -0.85, 0, 0.05, -0.9,

    // Right wing
    0, 0.1, 0.9, 0.4, 0.05, -0.85, 2.4, 0.28, -0.45,

    0, 0.1, 0.9, 0, 0.05, -0.9, 0.4, 0.05, -0.85,
  ]);
  wingGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  wingGeo.computeVertexNormals();

  const wingMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const wingMesh = new THREE.Mesh(wingGeo, wingMat);
  group.add(wingMesh);

  const metalMat = new THREE.MeshBasicMaterial({ color: 0xd97706 });
  const keelGeo = new THREE.BoxGeometry(0.1, 0.08, 1.9);
  const keelMesh = new THREE.Mesh(keelGeo, metalMat);
  keelMesh.position.set(0, 0.05, 0);
  group.add(keelMesh);

  const crossbarGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8);
  const crossbar = new THREE.Mesh(crossbarGeo, metalMat);
  crossbar.rotation.z = Math.PI / 2;
  crossbar.position.set(0, 0.12, -0.15);
  group.add(crossbar);

  const harnessGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8);
  const harnessLeft = new THREE.Mesh(harnessGeo, metalMat);
  harnessLeft.position.set(-0.35, -0.35, 0);
  harnessLeft.rotation.z = -0.35;
  group.add(harnessLeft);

  const harnessRight = new THREE.Mesh(harnessGeo, metalMat);
  harnessRight.position.set(0.35, -0.35, 0);
  harnessRight.rotation.z = 0.35;
  group.add(harnessRight);

  const handleBarGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.8, 8);
  const handleBar = new THREE.Mesh(handleBarGeo, metalMat);
  handleBar.rotation.z = Math.PI / 2;
  handleBar.position.set(0, -0.7, 0);
  group.add(handleBar);

  const finGeo = new THREE.BoxGeometry(0.04, 0.45, 0.45);
  const finMesh = new THREE.Mesh(finGeo, wingMat);
  finMesh.position.set(0, 0.28, -0.7);
  group.add(finMesh);

  const emitterGeo = new THREE.TorusGeometry(0.14, 0.03, 8, 16);
  const emitterMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
  const leftEmitter = new THREE.Mesh(emitterGeo, emitterMat);
  leftEmitter.position.set(-2.38, 0.28, -0.45);
  leftEmitter.rotation.y = Math.PI / 2;
  group.add(leftEmitter);

  const rightEmitter = new THREE.Mesh(emitterGeo, emitterMat);
  rightEmitter.position.set(2.38, 0.28, -0.45);
  rightEmitter.rotation.y = Math.PI / 2;
  group.add(rightEmitter);

  return {
    group,
    dispose: () => {
      wingGeo.dispose();
      wingMat.dispose();
      keelGeo.dispose();
      crossbarGeo.dispose();
      harnessGeo.dispose();
      handleBarGeo.dispose();
      finGeo.dispose();
      emitterGeo.dispose();
      metalMat.dispose();
      emitterMat.dispose();
    },
  };
}
