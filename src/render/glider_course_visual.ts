// Visuals for the Galecrest Windrider Slalom course.
// Procedural glowing wind rings and landing target rendered in Three.js.

import * as THREE from 'three';
import { GLIDER_COURSE, GLIDER_QUEST_ID } from '../sim/content/world_quest_glider';
import { GLIDER_COURSES } from '../sim/content/world_quest_glider_levels';
import { gliderCourseForCycle } from '../sim/world_quest_glider_generation';
import type { IWorld } from '../world_api';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
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

// The airborne glider itself: a Tripo-built GLB (world quests round 2 replaced
// the procedural wing-and-spars mesh). Loaded once through the deferred preload
// arm like every other GLB feature, then cloned per visual and fitted to the
// span the flight pose was tuned for: nose along +z (the flight facing), the
// wing above the pilot's chest, the control bar below.
const GLIDER_APPARATUS_URL = '/models/props/windrider_glider_flight.glb';
/** Tip-to-tip span in yards; the procedural apparatus this replaces spanned 4.8. */
const GLIDER_APPARATUS_WINGSPAN = 4.8;
/** How far the wing's top sits above the pilot's chest (the apparatus origin). */
const GLIDER_APPARATUS_TOP_Y = 0.42;
/** The built prop's keel runs along its own x axis, nose at +x, wing tips at
 *  +/-z (the pipeline's front render shows it side-on); the flight nose is +z
 *  and the span is x, so the clone turns a quarter turn about y. */
const GLIDER_APPARATUS_YAW = -Math.PI / 2;

let apparatusScene: THREE.Group | null = null;
let apparatusSettled = false;
const apparatusWaiters: Array<() => void> = [];
const settleApparatus = (): void => {
  apparatusSettled = true;
  for (const waiter of apparatusWaiters.splice(0)) waiter();
};
if (typeof window !== 'undefined') {
  // Deferred, never eager (the affliction_familiar precedent): a module-import
  // registerPreload joins the launch fetch burst the deferred gate exists to
  // spread out. A failed load settles too, so the fallback wing below is fitted
  // instead of leaving the pilot on an invisible glider.
  registerDeferredPreload(() =>
    loadGltf(GLIDER_APPARATUS_URL)
      .then((gltf) => {
        apparatusScene = gltf.scene;
      })
      .catch(() => {})
      .then(settleApparatus),
  );
}

/** A plain wing and keel, fitted only when the prop fails to load: the pilot
 *  still reads the pitch feedback (gliderApparatusPitch) off something. */
function buildFallbackApparatus(): { object: THREE.Object3D; dispose: () => void } {
  const wingGeo = new THREE.PlaneGeometry(GLIDER_APPARATUS_WINGSPAN, 1.6);
  const wingMat = new THREE.MeshLambertMaterial({ color: 0xd8c8a0, side: THREE.DoubleSide });
  const wing = new THREE.Mesh(wingGeo, wingMat);
  wing.rotation.x = -Math.PI / 2;
  wing.position.y = GLIDER_APPARATUS_TOP_Y;
  const keelGeo = new THREE.BoxGeometry(0.08, 0.08, 1.6);
  const keelMat = new THREE.MeshLambertMaterial({ color: 0x5a4632 });
  const keel = new THREE.Mesh(keelGeo, keelMat);
  keel.position.y = GLIDER_APPARATUS_TOP_Y - 0.06;
  const object = new THREE.Group();
  object.name = 'glider-apparatus-fallback';
  object.add(wing, keel);
  return {
    object,
    dispose: () => {
      wingGeo.dispose();
      wingMat.dispose();
      keelGeo.dispose();
      keelMat.dispose();
    },
  };
}

export const gliderCourseVisualPreloadInternalsForTest = {
  apparatusAssetUrl: GLIDER_APPARATUS_URL,
  apparatusWingspan: GLIDER_APPARATUS_WINGSPAN,
};

/** A clone of the loaded prop, scaled to the wingspan, centred, nose to +z. */
export function fitGliderApparatus(source: THREE.Object3D): THREE.Object3D {
  const clone = source.clone(true);
  clone.rotation.y = GLIDER_APPARATUS_YAW;
  clone.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(clone);
  const span = box.max.x - box.min.x || 1;
  const scale = GLIDER_APPARATUS_WINGSPAN / span;
  const holder = new THREE.Group();
  holder.name = 'glider-apparatus-model';
  holder.add(clone);
  holder.scale.setScalar(scale);
  holder.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(holder);
  const center = fitted.getCenter(new THREE.Vector3());
  holder.position.set(-center.x, GLIDER_APPARATUS_TOP_Y - fitted.max.y, -center.z);
  return holder;
}

function createGliderApparatusMesh(): {
  group: THREE.Group;
  dispose: () => void;
} {
  const group = new THREE.Group();
  group.name = 'glider-apparatus';
  group.visible = false;
  let disposed = false;
  let fallback: { object: THREE.Object3D; dispose: () => void } | null = null;
  const attach = (): void => {
    if (disposed || group.children.length > 0) return;
    if (apparatusScene) {
      group.add(fitGliderApparatus(apparatusScene));
      return;
    }
    fallback = buildFallbackApparatus();
    group.add(fallback.object);
  };
  if (apparatusSettled) attach();
  else apparatusWaiters.push(attach);
  return {
    group,
    dispose: () => {
      disposed = true;
      // The clone shares its geometry and materials with the cached prop scene,
      // which other visuals still clone: detach only. The fallback is this
      // visual's own and goes with it.
      group.clear();
      fallback?.dispose();
      fallback = null;
    },
  };
}
