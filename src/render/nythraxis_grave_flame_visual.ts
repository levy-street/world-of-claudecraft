// Nythraxis Grave Flame and Soulfire: green eruption residue and blood-red Soul
// Rend residue. The encounter snapshot (`activeNythraxisGraveFlames`) owns
// position, radius and remaining time; this painter only turns those rows into
// persistent danger patches, one per row, disposed the frame a row vanishes.
// It has no graphics-tier input on purpose: standing in a patch is gameplay,
// so Low and Ultra render identical actionable geometry (the same rule the
// Forgestorm and cinder-fire painters follow). Pose and opacity math lives in
// nythraxis_grave_core.ts.
//
// Prewarm: these palettes are reachable only inside the Nythraxis crypt, so
// its programs warm at that interior's attach (interior_encounter_prewarm.ts,
// `nythraxisGraveVisuals`) through buildNythraxisGravePrewarmVisual below,
// never in the boot manifest. No module-scope material cache here either: each
// patch owns its materials and disposes them with the patch.

import * as THREE from 'three';
import { NYTHRAXIS_SIGIL_CAST_ID } from '../sim/nythraxis_binding_sigil';
import {
  type ActiveNythraxisGraveFlame,
  NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
  NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
} from '../sim/nythraxis_grave_eruption';
import { MageGroundFx, METEOR_FLAME_GEOMETRY_HALF_HEIGHT } from './mage_ground_fx';
import {
  NYTHRAXIS_FLAME_TONGUE_GEOMETRY,
  NYTHRAXIS_FLAME_TONGUE_MAX_HEIGHT,
} from './nythraxis_flame_tongue';
import {
  NYTHRAXIS_GRAVE_FLAME_RIM_INNER_FRACTION,
  NYTHRAXIS_GRAVE_FLAME_TONGUE_UPDATE_SECONDS,
  NYTHRAXIS_GRAVE_FLAME_TONGUES,
  type NythraxisGraveFlamePlan,
  type NythraxisGraveFlamePulse,
  type NythraxisGraveFlameTonguePose,
  nythraxisFlamePalette,
  nythraxisGraveFlamePlanInto,
  nythraxisGraveFlamePulseInto,
  nythraxisGraveFlameTonguePoseInto,
} from './nythraxis_grave_core';
import { buildNythraxisGravefirePrewarmVisual } from './nythraxis_gravefire_visual';
import { buildNythraxisBindingSigilPrewarmVisual } from './nythraxis_sigil_visual';

export const NYTHRAXIS_GRAVE_FLAME_VISUAL_NAME = 'nythraxis-grave-flame';
export const NYTHRAXIS_GRAVE_FLAME_FILL_NAME = 'nythraxis-grave-flame-fill';
export const NYTHRAXIS_GRAVE_FLAME_RIM_NAME = 'nythraxis-grave-flame-rim';
export const NYTHRAXIS_GRAVE_FLAME_EMBERS_NAME = 'nythraxis-grave-flame-embers';
export const NYTHRAXIS_GRAVE_FLAME_TONGUES_NAME = 'nythraxis-grave-flame-tongues';
export const NYTHRAXIS_GRAVE_PREWARM_NAME = 'nythraxis-grave-prewarm';

const SEGMENTS = 64;
const EMBER_SEGMENTS = 48;
const EMBER_SPIN = 0.35; // rad/s, the violet inner ring's lazy drift
const MAX_TONGUE_HEIGHT = NYTHRAXIS_FLAME_TONGUE_MAX_HEIGHT;

const TONGUE_GEOMETRY = NYTHRAXIS_FLAME_TONGUE_GEOMETRY;

function setTongueBoundingSphere(tongues: THREE.InstancedMesh, radius: number): void {
  const boundRadius = radius + MAX_TONGUE_HEIGHT;
  if (tongues.boundingSphere) {
    tongues.boundingSphere.center.set(0, 0, 0);
    tongues.boundingSphere.radius = boundRadius;
    return;
  }
  tongues.boundingSphere = new THREE.Sphere(new THREE.Vector3(), boundRadius);
}

function graveMaterial(
  color: number,
  opacity: number,
  blending: THREE.Blending = THREE.AdditiveBlending,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending,
    side: THREE.DoubleSide,
  });
}

interface GraveFlameVisual {
  group: THREE.Group;
  fillMaterial: THREE.MeshBasicMaterial;
  rimMaterial: THREE.MeshBasicMaterial;
  emberMaterial: THREE.MeshBasicMaterial;
  tongueMaterial: THREE.MeshBasicMaterial;
  embers: THREE.Mesh;
  tongues: THREE.InstancedMesh;
  radius: number;
  phase: number;
  tongueElapsed: number;
}

/** One patch at the authored circle, positioned on the sampled ground. Every
 *  child is named so tests and the prewarm twin can find it. */
export function buildNythraxisGraveFlamePatch(
  row: ActiveNythraxisGraveFlame,
  groundY: number,
): THREE.Group {
  const plan: NythraxisGraveFlamePlan = { id: '', sourceId: 0, x: 0, y: 0, z: 0, radius: 0 };
  nythraxisGraveFlamePlanInto(plan, row, groundY);
  const palette = nythraxisFlamePalette(row.kind);
  const group = new THREE.Group();
  group.name = NYTHRAXIS_GRAVE_FLAME_VISUAL_NAME;
  group.position.set(plan.x, plan.y, plan.z);
  group.userData.renderCategory = 'ui3d';
  group.userData.actionable = true;
  group.userData.flameId = plan.id;
  group.userData.sourceId = plan.sourceId;
  group.userData.radius = plan.radius;
  group.userData.kind = row.kind;

  const fillMaterial = graveMaterial(palette.fill, 0.34, THREE.NormalBlending);
  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(
      plan.radius * NYTHRAXIS_GRAVE_FLAME_RIM_INNER_FRACTION,
      SEGMENTS,
    ).rotateX(-Math.PI / 2),
    fillMaterial,
  );
  fill.name = NYTHRAXIS_GRAVE_FLAME_FILL_NAME;
  fill.renderOrder = 10;
  group.add(fill);

  const rimMaterial = graveMaterial(palette.rim, 0.9);
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(
      plan.radius * NYTHRAXIS_GRAVE_FLAME_RIM_INNER_FRACTION,
      plan.radius,
      SEGMENTS,
    ).rotateX(-Math.PI / 2),
    rimMaterial,
  );
  rim.name = NYTHRAXIS_GRAVE_FLAME_RIM_NAME;
  rim.position.y = 0.01;
  rim.renderOrder = 11;
  group.add(rim);

  const emberMaterial = graveMaterial(palette.ember, 0.32);
  const embers = new THREE.Mesh(
    new THREE.RingGeometry(plan.radius * 0.42, plan.radius * 0.5, EMBER_SEGMENTS).rotateX(
      -Math.PI / 2,
    ),
    emberMaterial,
  );
  embers.name = NYTHRAXIS_GRAVE_FLAME_EMBERS_NAME;
  embers.position.y = 0.02;
  embers.renderOrder = 12;
  group.add(embers);

  const tongueMaterial = graveMaterial(palette.tongue, 0.6);
  const tongues = new THREE.InstancedMesh(
    TONGUE_GEOMETRY,
    tongueMaterial,
    NYTHRAXIS_GRAVE_FLAME_TONGUES,
  );
  tongues.name = NYTHRAXIS_GRAVE_FLAME_TONGUES_NAME;
  setTongueBoundingSphere(tongues, plan.radius);
  tongues.renderOrder = 13;
  group.add(tongues);

  group.userData.fillMaterial = fillMaterial;
  group.userData.rimMaterial = rimMaterial;
  group.userData.emberMaterial = emberMaterial;
  group.userData.tongueMaterial = tongueMaterial;
  group.userData.embers = embers;
  group.userData.tongues = tongues;
  return group;
}

function poseTongues(
  visual: GraveFlameVisual,
  dummy: THREE.Object3D,
  scratch: NythraxisGraveFlameTonguePose,
  reducedMotion: boolean,
): void {
  const count = visual.tongues.count;
  for (let index = 0; index < count; index++) {
    const pose = nythraxisGraveFlameTonguePoseInto(
      scratch,
      index,
      count,
      visual.radius,
      visual.phase,
      reducedMotion,
      METEOR_FLAME_GEOMETRY_HALF_HEIGHT,
    );
    dummy.position.set(pose.dx, pose.y, pose.dz);
    dummy.rotation.set(0, pose.yaw, 0);
    dummy.scale.set(pose.width, pose.height, pose.width);
    dummy.updateMatrix();
    visual.tongues.setMatrixAt(index, dummy.matrix);
  }
  visual.tongues.instanceMatrix.needsUpdate = true;
  setTongueBoundingSphere(visual.tongues, visual.radius);
}

function disposeVisual(visual: GraveFlameVisual): void {
  // The tongue geometry is the module-shared quad: never disposed per patch.
  for (const child of visual.group.children) {
    if (child === visual.tongues) continue;
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  }
  visual.tongues.dispose();
  visual.fillMaterial.dispose();
  visual.rimMaterial.dispose();
  visual.emberMaterial.dispose();
  visual.tongueMaterial.dispose();
  visual.group.removeFromParent();
}

export class NythraxisGraveFlameVisuals {
  private readonly visuals = new Map<string, GraveFlameVisual>();
  private readonly activeIds = new Set<string>();
  // Per-frame scratch: the sync and update paths allocate nothing.
  private readonly dummy = new THREE.Object3D();
  private readonly pulse: NythraxisGraveFlamePulse = { rim: 0, fill: 0, ember: 0, tongue: 0 };
  private readonly tonguePose: NythraxisGraveFlameTonguePose = {
    dx: 0,
    dz: 0,
    y: 0,
    width: 1,
    height: 1,
    yaw: 0,
  };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  /** Reconciles the authoritative rows by stable id: a new id builds a patch,
   *  a known id is left in place, and a missing id disposes its patch. */
  sync(rows: readonly ActiveNythraxisGraveFlame[]): void {
    if (rows.length === 0 && this.visuals.size === 0) return;
    this.activeIds.clear();
    for (const row of rows) {
      this.activeIds.add(row.id);
      if (this.visuals.has(row.id)) continue;
      const group = buildNythraxisGraveFlamePatch(row, this.groundY(row.x, row.z));
      const visual: GraveFlameVisual = {
        group,
        fillMaterial: group.userData.fillMaterial as THREE.MeshBasicMaterial,
        rimMaterial: group.userData.rimMaterial as THREE.MeshBasicMaterial,
        emberMaterial: group.userData.emberMaterial as THREE.MeshBasicMaterial,
        tongueMaterial: group.userData.tongueMaterial as THREE.MeshBasicMaterial,
        embers: group.userData.embers as THREE.Mesh,
        tongues: group.userData.tongues as THREE.InstancedMesh,
        radius: row.radius,
        phase: 0,
        tongueElapsed: NYTHRAXIS_GRAVE_FLAME_TONGUE_UPDATE_SECONDS,
      };
      poseTongues(visual, this.dummy, this.tonguePose, true);
      this.scene.add(group);
      this.visuals.set(row.id, visual);
    }
    for (const [id, visual] of this.visuals) {
      if (this.activeIds.has(id)) continue;
      disposeVisual(visual);
      this.visuals.delete(id);
    }
  }

  syncWorld(world: { activeNythraxisGraveFlames: readonly ActiveNythraxisGraveFlame[] }): void {
    this.sync(world.activeNythraxisGraveFlames);
  }

  update(dt: number, reducedMotion = false): void {
    const step = Math.max(0, dt);
    for (const visual of this.visuals.values()) {
      if (!reducedMotion) {
        visual.phase = (visual.phase + step * 2.6) % (Math.PI * 2);
        visual.embers.rotation.y += step * EMBER_SPIN;
      }
      const pulse = nythraxisGraveFlamePulseInto(this.pulse, visual.phase, reducedMotion);
      visual.rimMaterial.opacity = pulse.rim;
      visual.fillMaterial.opacity = pulse.fill;
      visual.emberMaterial.opacity = pulse.ember;
      visual.tongueMaterial.opacity = pulse.tongue;
      // Tongues re-pose at 20 Hz (one instanced-matrix upload per patch per
      // tick, not per frame); reduced motion holds the pose it has.
      if (reducedMotion) continue;
      visual.tongueElapsed += step;
      if (visual.tongueElapsed >= NYTHRAXIS_GRAVE_FLAME_TONGUE_UPDATE_SECONDS) {
        visual.tongueElapsed %= NYTHRAXIS_GRAVE_FLAME_TONGUE_UPDATE_SECONDS;
        poseTongues(visual, this.dummy, this.tonguePose, false);
      }
    }
  }

  dispose(): void {
    for (const visual of this.visuals.values()) disposeVisual(visual);
    this.visuals.clear();
    this.activeIds.clear();
  }
}

/**
 * Stages every grave-palette program before the crypt is playable: one flame
 * patch, plus a real Grave Eruption telegraph spawned through MageGroundFx and
 * landed, so the recoloured warning materials AND the instanced bone-shard
 * burst both link here rather than under the first cast. The falling-body
 * materials are fire-only and never drawn by the grave flavour, so they stay
 * hidden. The group is kept alive by the caller for the session (three drops a
 * program with its last material); the staging MageGroundFx is retained on the
 * root so its pooled materials survive with it.
 */
export function buildNythraxisGravePrewarmVisual(): THREE.Group {
  const root = new THREE.Group();
  root.name = NYTHRAXIS_GRAVE_PREWARM_NAME;
  const patch = buildNythraxisGraveFlamePatch(
    {
      id: 'prewarm-grave-flame',
      sourceId: 0,
      kind: 'grave',
      x: 0,
      z: 0,
      radius: NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
      duration: 1,
      remaining: 1,
    },
    0,
  );
  root.add(patch);
  const gravefire = buildNythraxisGravefirePrewarmVisual();
  gravefire.position.set(0, 0, 8);
  root.add(gravefire);
  const sigil = buildNythraxisBindingSigilPrewarmVisual();
  sigil.position.x = -8;
  root.add(sigil);

  const staging = new THREE.Scene();
  const fx = new MageGroundFx(
    staging,
    () => 0,
    () => {},
  );
  const persistentId = 'prewarm-grave-eruption';
  fx.spawnMeteor({
    x: 8,
    z: 0,
    radius: NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
    duration: 2.5,
    warningLead: 0.75,
    ability: NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
    school: 'shadow',
    persistentId,
  });
  fx.impactMeteor(persistentId, 8, 0);
  fx.spawnRune({
    x: -8,
    z: 0,
    radius: 4,
    duration: 15,
    school: 'arcane',
    ability: NYTHRAXIS_SIGIL_CAST_ID,
  });
  for (const child of [...staging.children]) root.add(child);
  root.traverse((child) => {
    child.visible = true;
  });
  for (const name of ['mage-meteor-body', 'mage-meteor-trail']) {
    const fireOnly = root.getObjectByName(name);
    if (fireOnly) fireOnly.visible = false;
  }
  root.userData.mageGroundFx = fx;
  return root;
}
