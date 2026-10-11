// Chunky, low-draw open-air scenery for Epic and Legendary Buried Hoards.
// Simulation owns the shell and all collision. This module covers that shell
// with natural scenery and protects its first scene attachment with the shared
// shader compile gate.

import * as THREE from 'three';
import { resolveUiEffectsProfile, type UiEffectsProfile } from '../game/ui_effects_profile';
import type { RiftFloorPlan } from '../sim/rift/types';
import { type DayNightGrade, duskWarmAmount, nightSkyDesat } from './day_night_core';
import { attachSceneGroupGated } from './gated_scene_attach';
import type { GfxTier } from './gfx';
import { hoardCavernSceneryVisible } from './hoard_cavern_core';
import { buildHoardCavernCutaway } from './hoard_cavern_cutaway';
import { buildHoardCavernFoliage, updateHoardCavernFoliageTint } from './hoard_cavern_foliage';
import { buildHoardCavernGround } from './hoard_cavern_ground';
import { buildHoardCavernShell, hoardCavernRockGeometry } from './hoard_cavern_shell';
import { buildHoardCliffMassView, type HoardCliffMassView } from './hoard_cliff_mass';
import { buildHoardRoomKit, type HoardRoomKitView, updateHoardRoomKitTint } from './hoard_room_kit';
import { buildBossRoomPlan, type RoomKitTier, themedRoomProfile } from './hoard_room_kit_core';
import { bossRoomThemeFor } from './hoard_room_themes_core';
import {
  buildHoardValleyPlan,
  type HoardValleyDressingKind,
  type HoardValleyDressingPlacement,
  type HoardValleyPlan,
  hoardValleyProfile,
  hoardValleySurfaceTint,
  isHoardValleyZoneId,
} from './hoard_valley_core';
import { hoardValleyRockVariants } from './hoard_valley_rocks';
import { setRenderCategory } from './renderer_diagnostics';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';
import type { SkyView } from './sky';

export type HoardValleyEffectsProfile = Pick<UiEffectsProfile, 'tier' | 'heavyShadows'>;

export function resolveHoardValleyEffectsProfile(effectsTier: GfxTier): HoardValleyEffectsProfile {
  return resolveUiEffectsProfile({
    presetLabel: effectsTier,
    effectsQuality: effectsTier === 'low' ? 0 : 1,
    reduceMotion: false,
  });
}

export interface HoardValleyBuildOptions {
  scene: THREE.Object3D;
  compileGate?: (target: THREE.Object3D) => Promise<unknown>;
  plan: RiftFloorPlan;
  offset: { x: number; y: number; z: number };
  effectsProfile: HoardValleyEffectsProfile;
  prepareEnvironment?: () => Promise<unknown>;
}

export interface HoardValleyView {
  readonly group: THREE.Group;
  readonly readyForEntry: Promise<void>;
  dispose(): void;
}

let cliffGeometry: THREE.BufferGeometry | null = null;
let trunkGeometry: THREE.CylinderGeometry | null = null;
let crownGeometry: THREE.DodecahedronGeometry | null = null;
let spireGeometry: THREE.ConeGeometry | null = null;
let branchGeometry: THREE.BoxGeometry | null = null;
let bloomGeometry: THREE.OctahedronGeometry | null = null;
let valleyMaterial: THREE.MeshBasicMaterial | null = null;

function paintFacets<T extends THREE.BufferGeometry>(geometry: T): T {
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i++) {
    const shade = Math.max(
      0.5,
      Math.min(1, 0.68 + Math.max(0, normals.getY(i)) * 0.25 + normals.getX(i) * 0.07),
    );
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function sharedGeometries() {
  cliffGeometry ??= hoardCavernRockGeometry();
  trunkGeometry ??= markSharedGeometry(paintFacets(new THREE.CylinderGeometry(0.38, 0.62, 4.8, 6)));
  crownGeometry ??= markSharedGeometry(paintFacets(new THREE.DodecahedronGeometry(1, 0)));
  spireGeometry ??= markSharedGeometry(paintFacets(new THREE.ConeGeometry(1, 4.5, 6)));
  branchGeometry ??= markSharedGeometry(paintFacets(new THREE.BoxGeometry(0.32, 3.6, 0.32)));
  bloomGeometry ??= markSharedGeometry(paintFacets(new THREE.OctahedronGeometry(0.7, 0)));
  return {
    cliff: cliffGeometry,
    trunk: trunkGeometry,
    crown: crownGeometry,
    spire: spireGeometry,
    branch: branchGeometry,
    bloom: bloomGeometry,
  };
}

function coloredMaterial(name: string): THREE.MeshBasicMaterial {
  valleyMaterial ??= markSharedMaterial(
    new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, fog: true }),
  );
  if (!valleyMaterial.name) valleyMaterial.name = name;
  return valleyMaterial;
}

/** Grade the hand-painted facet fill with a readable version of the live night tint. */
export function updateHoardValleyDayNight(
  grade: {
    fog: readonly [number, number, number];
    nightAmt: number;
  },
  camera?: THREE.Vector3,
  target?: THREE.Vector3,
): void {
  const tint = hoardValleySurfaceTint(grade);
  valleyMaterial?.color.setRGB(tint[0], tint[1], tint[2]);
  updateHoardCavernFoliageTint(tint);
  updateHoardRoomKitTint(tint);
  if (camera && target) for (const view of activeValleys) view.updateCamera(camera, target);
}

/** Low keeps the cheap sky but still follows the valley's live day/night clock. */
export function updateHoardValleySkyDayNight(
  sky: Pick<SkyView, 'dome' | 'setDayNight' | 'setCycle'>,
  grade: DayNightGrade,
  sunDir: THREE.Vector3,
): void {
  sky.setDayNight(grade.sky);
  sky.setCycle(sunDir, duskWarmAmount(sunDir.y), nightSkyDesat(grade.nightAmt));
  const material = sky.dome.material;
  if (!Array.isArray(material) && material.type === 'MeshBasicMaterial') {
    (material as THREE.MeshBasicMaterial).color.setRGB(
      Math.max(0.18, grade.sky[0]),
      Math.max(0.22, grade.sky[1]),
      Math.max(0.38, grade.sky[2]),
    );
  }
}

function writeInstance(
  mesh: THREE.InstancedMesh,
  index: number,
  position: THREE.Vector3,
  rotation: THREE.Euler,
  scale: THREE.Vector3,
  color: number,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
): void {
  quaternion.setFromEuler(rotation);
  matrix.compose(position, quaternion, scale);
  mesh.setMatrixAt(index, matrix);
  mesh.setColorAt(index, new THREE.Color(color));
}

function finishInstances(
  mesh: THREE.InstancedMesh,
  castShadow: boolean,
  receiveShadow = false,
): THREE.InstancedMesh {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}

/** The boundary wall: every placement in the plan, drawn with real boulder shapes
 *  when they are loaded (one InstancedMesh per variant, dealt round-robin so
 *  neighbours differ) and with the single bent cylinder otherwise. Every batch
 *  keeps the 'HoardValleyBoundaryCliffs' name the camera cutaway matches on. */
function buildCliffs(plan: HoardValleyPlan, shadows: boolean, boulders: boolean): THREE.Object3D {
  const shapes = (boulders ? hoardValleyRockVariants() : null) ?? [sharedGeometries().cliff];
  const set = new THREE.Group();
  set.name = 'HoardValleyCliffSet';
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Euler();
  for (let variant = 0; variant < shapes.length; variant++) {
    const count = Math.ceil((plan.cliffs.length - variant) / shapes.length);
    if (count <= 0) continue;
    const mesh = new THREE.InstancedMesh(
      shapes[variant],
      coloredMaterial('HoardValleyCliffs'),
      count,
    );
    mesh.name = 'HoardValleyBoundaryCliffs';
    for (let slot = 0; slot < count; slot++) {
      const i = variant + slot * shapes.length;
      const rock = plan.cliffs[i];
      writeInstance(
        mesh,
        slot,
        position.set(rock.x, rock.centerY ?? rock.scaleY * 0.74 - 0.7, rock.z),
        rotation.set(0, rock.yaw, (i % 2 ? -1 : 1) * 0.08),
        scale.set(rock.scaleX, rock.scaleY, rock.scaleZ),
        rock.color,
        matrix,
        quaternion,
      );
    }
    set.add(finishInstances(mesh, shadows));
  }
  return set;
}

interface DressingPose {
  baseGeometry: THREE.BufferGeometry;
  accentGeometry: THREE.BufferGeometry;
  basePosition: THREE.Vector3;
  accentPosition: THREE.Vector3;
  baseRotation: THREE.Euler;
  accentRotation: THREE.Euler;
  baseScale: THREE.Vector3;
  accentScale: THREE.Vector3;
}

function dressingPose(placement: HoardValleyDressingPlacement, index: number): DressingPose {
  const geometry = sharedGeometries();
  const scale = placement.scale;
  const basePosition = new THREE.Vector3(placement.x, placement.y, placement.z);
  const accentPosition = new THREE.Vector3(placement.x, placement.y, placement.z);
  const baseRotation = new THREE.Euler(0, placement.yaw, 0);
  const accentRotation = new THREE.Euler(0, placement.yaw + index * 0.37, 0);
  const baseScale = new THREE.Vector3(scale, scale, scale);
  const accentScale = new THREE.Vector3(scale, scale, scale);
  let baseGeometry: THREE.BufferGeometry = geometry.trunk;
  let accentGeometry: THREE.BufferGeometry = geometry.crown;

  switch (placement.kind) {
    case 'autumn_tree':
      basePosition.y = 2.35 * scale;
      accentPosition.y = 5.3 * scale;
      baseScale.set(scale, scale, scale);
      accentScale.set(2.2 * scale, 1.55 * scale, 2 * scale);
      break;
    case 'palm':
      basePosition.y = 2.55 * scale;
      baseRotation.z = (index % 2 ? -1 : 1) * 0.09;
      accentPosition.set(placement.x, 5.5 * scale, placement.z);
      accentScale.set(2.75 * scale, 0.42 * scale, 2.2 * scale);
      break;
    case 'dead_tree':
      accentGeometry = geometry.branch;
      basePosition.y = 2.25 * scale;
      accentPosition.set(placement.x + 0.7 * scale, 4.4 * scale, placement.z);
      accentRotation.set(0.35, placement.yaw, -0.72);
      accentScale.set(scale, scale, scale);
      break;
    case 'basalt_spire':
      baseGeometry = geometry.spire;
      accentGeometry = geometry.spire;
      basePosition.y = 2.1 * scale;
      accentPosition.set(placement.x + 1.15 * scale, 1.35 * scale, placement.z + 0.5 * scale);
      baseScale.set(0.9 * scale, 1.2 * scale, 0.9 * scale);
      accentScale.set(0.55 * scale, 0.72 * scale, 0.55 * scale);
      break;
    case 'ice_spire':
      baseGeometry = geometry.spire;
      accentGeometry = geometry.spire;
      basePosition.y = 2.15 * scale;
      accentPosition.set(placement.x - 1.05 * scale, 1.45 * scale, placement.z + 0.7 * scale);
      baseRotation.z = 0.08;
      accentRotation.z = -0.18;
      baseScale.set(0.78 * scale, 1.25 * scale, 0.78 * scale);
      accentScale.set(0.52 * scale, 0.78 * scale, 0.52 * scale);
      break;
    case 'windswept_grass':
      baseGeometry = geometry.branch;
      accentGeometry = geometry.branch;
      basePosition.y = 0.8 * scale;
      accentPosition.set(placement.x + 0.55 * scale, 0.65 * scale, placement.z + 0.3 * scale);
      baseRotation.z = -0.55;
      accentRotation.z = -0.72;
      baseScale.set(0.45 * scale, 0.52 * scale, 0.45 * scale);
      accentScale.set(0.35 * scale, 0.4 * scale, 0.35 * scale);
      break;
    case 'reeds':
      baseGeometry = geometry.branch;
      accentGeometry = geometry.branch;
      basePosition.y = 0.95 * scale;
      accentPosition.set(placement.x + 0.52 * scale, 0.78 * scale, placement.z - 0.3 * scale);
      baseScale.set(0.3 * scale, 0.58 * scale, 0.3 * scale);
      accentScale.set(0.25 * scale, 0.46 * scale, 0.25 * scale);
      break;
    case 'moon_bloom':
      baseGeometry = geometry.branch;
      accentGeometry = geometry.bloom;
      basePosition.y = 0.9 * scale;
      accentPosition.y = 1.85 * scale;
      baseScale.set(0.3 * scale, 0.56 * scale, 0.3 * scale);
      accentScale.set(0.85 * scale, 0.7 * scale, 0.85 * scale);
      break;
  }
  return {
    baseGeometry,
    accentGeometry,
    basePosition,
    accentPosition,
    baseRotation,
    accentRotation,
    baseScale,
    accentScale,
  };
}

function addDressingKind(
  group: THREE.Group,
  plan: HoardValleyPlan,
  kind: HoardValleyDressingKind,
  placements: HoardValleyDressingPlacement[],
  shadows: boolean,
): void {
  if (placements.length === 0) return;
  const first = dressingPose(placements[0], 0);
  const base = new THREE.InstancedMesh(
    first.baseGeometry,
    coloredMaterial(`HoardValleyDressing:${kind}:base`),
    placements.length,
  );
  const accent = new THREE.InstancedMesh(
    first.accentGeometry,
    coloredMaterial(`HoardValleyDressing:${kind}:accent`),
    placements.length,
  );
  base.name = `HoardValleyDressingBase:${kind}`;
  accent.name = `HoardValleyDressingAccent:${kind}`;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  for (let i = 0; i < placements.length; i++) {
    const pose = dressingPose(placements[i], i);
    writeInstance(
      base,
      i,
      pose.basePosition,
      pose.baseRotation,
      pose.baseScale,
      plan.zone.trunk,
      matrix,
      quaternion,
    );
    writeInstance(
      accent,
      i,
      pose.accentPosition,
      pose.accentRotation,
      pose.accentScale,
      plan.zone.accent,
      matrix,
      quaternion,
    );
  }
  group.add(finishInstances(base, shadows), finishInstances(accent, shadows));
}

function buildDressing(plan: HoardValleyPlan, shadows: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'HoardValleyZoneDressing';
  const byKind = new Map<HoardValleyDressingKind, HoardValleyDressingPlacement[]>();
  for (const placement of plan.dressing) {
    if (['autumn_tree', 'palm', 'dead_tree'].includes(placement.kind)) continue;
    const values = byKind.get(placement.kind) ?? [];
    values.push(placement);
    byKind.set(placement.kind, values);
  }
  for (const [kind, placements] of byKind) addDressingKind(group, plan, kind, placements, shadows);
  return group;
}

const valleyOwners = new WeakMap<THREE.Group, HoardValleyViewImpl>();
const activeValleys = new Set<HoardValleyViewImpl>();

class HoardValleyViewImpl implements HoardValleyView {
  readonly group: THREE.Group;
  readonly readyForEntry: Promise<void>;
  private disposed = false;
  private readonly disposeGround: () => void;
  private readonly cliffMass: HoardCliffMassView;
  private readonly roof: THREE.InstancedMesh | undefined;
  /** The boss room's own dressing (the Emberforge forge kit), when it has one. */
  private readonly roomKit: HoardRoomKitView | undefined;
  private readonly updateSceneryCamera: (camera: THREE.Vector3, target: THREE.Vector3) => void;

  constructor(options: HoardValleyBuildOptions) {
    const outdoor = options.plan.outdoor;
    if (!outdoor || !isHoardValleyZoneId(outdoor.zoneId)) {
      throw new Error('Hoard valley requires a floor plan with a known outdoor zone');
    }
    const low = options.effectsProfile.tier === 'low';
    // A boss with a room of his own brings its palette with him: the dig site's
    // biome colours never paint over who lives here.
    const theme = bossRoomThemeFor(options.plan.spawns.find((spawn) => spawn.boss)?.templateId);
    const visualPlan = buildHoardValleyPlan({
      layout: options.plan.layout,
      zoneId: outdoor.zoneId,
      seed: options.plan.seed,
      low,
      profile: themedRoomProfile(hoardValleyProfile(outdoor.zoneId), theme),
    });
    const shadows = !low && options.effectsProfile.heavyShadows;
    this.group = new THREE.Group();
    this.group.name = `hoard-valley:${outdoor.zoneId}`;
    this.group.position.set(options.offset.x, options.offset.y, options.offset.z);
    const ground = buildHoardCavernGround(
      options.plan.layout,
      visualPlan.zone,
      options.plan.seed,
      coloredMaterial('HoardCavernGround'),
      shadows,
    );
    this.disposeGround = ground.dispose;
    this.group.add(ground.group);
    // The wall is ONE continuous body; the rocks are detail embedded in it.
    this.cliffMass = buildHoardCliffMassView(visualPlan, coloredMaterial('HoardValleyCliffMass'));
    this.group.add(this.cliffMass.mesh);
    this.group.add(buildCliffs(visualPlan, shadows, !low));
    this.group.add(
      buildHoardCavernShell(
        options.plan.layout,
        visualPlan,
        coloredMaterial('HoardCavern'),
        shadows,
        low ? null : hoardValleyRockVariants(),
      ),
    );
    // A room with a kit of its own is dressed by it: the zone's generic spires would
    // only litter the floor the kit keeps clear (playtest).
    const kitted = theme !== null;
    if (!kitted) this.group.add(buildDressing(visualPlan, shadows));
    // The zone's hero trees go the same way: bare trees do not belong in a forge.
    if (!kitted) this.group.add(buildHoardCavernFoliage(visualPlan, shadows));
    if (theme) {
      const tier: RoomKitTier =
        options.effectsProfile.tier === 'low'
          ? 'low'
          : options.effectsProfile.tier === 'medium'
            ? 'medium'
            : 'high';
      this.roomKit = buildHoardRoomKit(
        buildBossRoomPlan(theme, options.plan.layout, options.plan.seed, tier),
        tier,
        shadows,
      );
      this.group.add(this.roomKit.group);
    }
    this.roof = this.group.getObjectByName('HoardCavernEntryRoof') as THREE.InstancedMesh;
    this.updateSceneryCamera = buildHoardCavernCutaway(this.group);
    activeValleys.add(this);
    this.group.userData.hoardValleyZoneId = outdoor.zoneId;
    this.group.userData.hoardValleyRevealZ = outdoor.valleyStartZ ?? visualPlan.revealZ;
    setRenderCategory(this.group, 'dungeon');
    valleyOwners.set(this.group, this);
    const environmentReady = options.prepareEnvironment?.().catch(() => undefined);
    // The boss room's kit loads with its room, not at boot: its props must stand in
    // the group BEFORE the compile gate sees it, so the room still compiles whole.
    // (A kit already baked leaves `ready` null, and the gate runs at once as before.)
    const kitReady = this.roomKit?.ready ?? null;
    const gateAll = (target: THREE.Object3D): Promise<void> =>
      Promise.all([environmentReady, options.compileGate?.(target)]).then(() => undefined);
    const compileGate = kitReady
      ? (target: THREE.Object3D) => kitReady.then(() => gateAll(target))
      : environmentReady
        ? gateAll
        : options.compileGate;
    this.readyForEntry = attachSceneGroupGated(
      options.scene,
      this.group,
      compileGate,
      () => this.disposed,
    ).catch(() => {
      // Retirement cancels an in-flight gate. The owner has already detached it.
    });
  }

  updateCamera(camera: THREE.Vector3, target: THREE.Vector3): void {
    this.updateSceneryCamera(camera, target);
    this.roomKit?.update(performance.now() / 1000);
    this.cliffMass.updateCamera(camera, target, this.group.position);
    if (this.roof?.boundingBox)
      this.roof.visible = hoardCavernSceneryVisible(
        camera,
        target,
        this.group.position,
        this.roof.boundingBox,
      );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    activeValleys.delete(this);
    this.group.parent?.remove(this.group);
    this.group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    this.disposeGround();
    this.roomKit?.dispose();
    this.cliffMass.dispose();
    this.group.clear();
    valleyOwners.delete(this.group);
  }
}

export function buildHoardValley(options: HoardValleyBuildOptions): HoardValleyView {
  return new HoardValleyViewImpl(options);
}

/** Retirement adapter for renderer registries that retain only the scene group. */
export function disposeHoardValleyGroup(group: THREE.Group): boolean {
  const owner = valleyOwners.get(group);
  if (!owner) return false;
  owner.dispose();
  return true;
}
