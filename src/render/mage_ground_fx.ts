// Mage ground-anchored spell visuals (owner playtest 2026-07-11):
//  - the Meteor FALL: a cracked basalt rock with a flame trail that drops onto
//    a terrain-draped warning circle over the ability's real fall delay;
//  - the Rune of Power CIRCLE: a glowing arcane ring inscribed on the terrain
//    for the rune's full duration, so the zone the sim pulses is visible;
//  - the Blizzard SNOWFALL: a recycled pool of snowflakes drifting down over
//    the storm's area for its life ('snowZone' cue).
// Both are cosmetic riders on one 'meteorFall' / 'runeCircle' spellfxAt cue;
// the sim's pulses remain the authoritative gameplay telegraph.
//
// Renderer contract: construct once with the scene + a terrain-height
// resolver, spawn from the events, update(dt) once per frame beside the other
// transient systems. Geometries are shared or per instance (spawn position
// bakes into their vertices, so those still dispose on expiry); materials
// only vary in animated uniforms (opacity), so every material config is
// pooled by kind and returned to its free list on expiry instead of
// disposed, so a burst of casts (a raid boss Meteor Shower) reuses the same
// Material instances instead of allocating and disposing a fresh batch per
// cast. Math.random is fine here (render-only).

import * as THREE from 'three';
import type { SimEvent } from '../sim/types';
import { createGroundFireAoe, type GroundFireAoeHandle } from './ignivar_fire_vfx';
import { SCHOOL_COLORS } from './vfx';

/** HSL lightness ceiling applied before a rune ring's additive brightening
 *  multipliers (below). A near-white school tint (physical 0xffd28a, holy
 *  0xffe9a0) already sits close to (1,1,1); multiplying it further clips
 *  every channel toward white and the ring stops reading as a distinct
 *  danger color at all. Verified against a real case: Warlord Grask
 *  (rift_boss_brute)'s stomp authors no school and falls back to physical,
 *  so its windup ring hit exactly this. Capping lightness first keeps every
 *  school's hue distinguishable at every multiplier used below. */
const RING_TINT_MAX_LIGHTNESS = 0.5;

/** Caps `color`'s HSL lightness at RING_TINT_MAX_LIGHTNESS, preserving hue
 *  and saturation. Returns a clone; never mutates the input. */
export function capRingLightness(color: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  if (hsl.l <= RING_TINT_MAX_LIGHTNESS) return color.clone();
  return new THREE.Color().setHSL(hsl.h, hsl.s, RING_TINT_MAX_LIGHTNESS);
}

const METEOR_DROP_HEIGHT = 45; // yards above the impact point it appears
const METEOR_RADIUS = 1.12;
const METEOR_TELEGRAPH_SEGMENTS = 72;
const METEOR_FOOTPRINT_RADIAL_SEGMENTS = 5;
const METEOR_BEACON_EMBER_COUNT = 14;
const METEOR_FLAME_COUNT = 18;
const METEOR_EMBER_COUNT = 28;
export const METEOR_COUNTDOWN_GEOMETRY_UPDATE_SECONDS = 1 / 20;
const METEOR_SCORCH_LINGER = 2.2; // central fire left behind after impact
const RUNE_FADE = 0.8; // seconds of fade at the rune's end of life
const RUNE_SPIN = 0.5; // rad/s, lazy mote rotation
const RUNE_GROUND_LIFT = 0.08; // avoids z-fighting after terrain sampling
const RUNE_SEGMENTS = 48;

export interface MeteorFallSpawn {
  x: number;
  z: number;
  radius: number;
  duration: number; // seconds of fall
  /** Optional authored landing identity. Generic mage meteors omit this and
   *  retain their legacy fire burst. */
  sourceId?: number;
  ability?: string;
  showTelegraph?: boolean;
  warningLead?: number; // seconds where only the ground warning is visible
  persistentId?: string;
  initialElapsed?: number;
}

export interface MeteorWarningState extends MeteorFallSpawn {
  id: string;
  remaining: number;
  warningLead: number;
}

export interface RuneCircleSpawn {
  x: number;
  z: number;
  radius: number;
  duration: number;
  /** Damage/mechanic school driving the ring's tint. Defaults to arcane, the
   *  mage's own Rune of Power. A rift boss windup telegraph (stomp/pulse)
   *  rides this same visual and passes the mechanic's real school, so a fire
   *  boss doesn't wind up behind a violet ring that doesn't read as danger. */
  school?: string;
}

export interface SnowZoneSpawn {
  x: number;
  z: number;
  radius: number;
  duration: number;
}

const SNOW_COUNT = 90;
const SNOW_TOP = 9; // yards above ground the flakes spawn
const SNOW_FALL = 3.2; // yards per second

interface MeteorFx {
  persistentId?: string;
  snapshotManaged: boolean;
  root: THREE.Group;
  body: THREE.Group;
  trail: THREE.Group;
  rockMat: THREE.MeshStandardMaterial;
  magmaMat: THREE.MeshBasicMaterial;
  coronaMat: THREE.MeshBasicMaterial;
  trailOuterMat: THREE.MeshBasicMaterial;
  trailInnerMat: THREE.MeshBasicMaterial;
  emberMat: THREE.PointsMaterial;
  footprintMat: THREE.MeshBasicMaterial;
  boundaryMat: THREE.LineBasicMaterial;
  countdownMat: THREE.MeshBasicMaterial;
  veinMat: THREE.LineBasicMaterial;
  flameMat: THREE.MeshBasicMaterial;
  beaconEmberMat: THREE.PointsMaterial;
  beaconEmbers: THREE.Points;
  countdownRing: THREE.Mesh;
  countdownPositions: Float32Array;
  countdownGeometryUpdateElapsed: number;
  flames: THREE.InstancedMesh;
  flameBases: ReadonlyArray<{ x: number; y: number; z: number; phase: number }>;
  flameDummy: THREE.Object3D;
  ownedGeometries: THREE.BufferGeometry[];
  x: number;
  z: number;
  radius: number;
  groundY: number;
  duration: number;
  warningLead: number;
  elapsed: number;
  landed: boolean;
  spawn: MeteorFallSpawn;
  contributorOwnsGroundDetail: boolean;
  ignivarFireAoe: GroundFireAoeHandle | null;
}

function advanceGroundFireAoe(aoe: GroundFireAoeHandle, seconds: number): void {
  let remaining = Math.max(0, seconds);
  while (remaining > 0) {
    const step = Math.min(remaining, 0.05);
    aoe.update(step);
    remaining -= step;
  }
}

interface RuneFx {
  group: THREE.Group;
  orbit: THREE.Group;
  mats: THREE.Material[];
  matKinds: string[];
  ownedGeometries: THREE.BufferGeometry[];
  duration: number;
  elapsed: number;
  baseOpacities: number[];
}

interface SnowFx {
  points: THREE.Points;
  mat: THREE.PointsMaterial;
  pos: Float32Array;
  // The zone-edge PERIMETER ring (owner request: show how far the storm
  // reaches), an icy circle inscribed on the ground for the zone's life.
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  x: number;
  z: number;
  groundY: number;
  radius: number;
  duration: number;
  elapsed: number;
}

export class MageGroundFx {
  private readonly scene: THREE.Scene;
  private readonly groundY: (x: number, z: number) => number;
  private readonly onMeteorLand: (x: number, z: number, spawn?: MeteorFallSpawn) => void;
  private readonly meteors: MeteorFx[] = [];
  private readonly resolvedPersistentMeteorIds = new Set<string>();
  private readonly runes: RuneFx[] = [];
  private readonly snows: SnowFx[] = [];
  private meteorGeo: THREE.IcosahedronGeometry | null = null;
  private meteorCoronaGeo: THREE.SphereGeometry | null = null;
  private meteorCrackGeos: THREE.TubeGeometry[] | null = null;
  private meteorTrailGeo: THREE.ConeGeometry | null = null;
  private meteorFlameGeo: THREE.BufferGeometry | null = null;
  private runeRingGeo: THREE.RingGeometry | null = null;
  /** Free list of retired materials, bucketed by their fixed config kind
   *  (color/blending/transparency never change after construction here,
   *  only opacity animates per instance). The rune family folds the cast's
   *  school into its kind strings (`<name>:<school>`), so its bucket count
   *  is bounded by name-count x the 7-member Aura['school'] union, not
   *  unbounded: a real ceiling, not a cap this pool enforces itself. */
  private readonly materialPool = new Map<string, THREE.Material[]>();
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    groundY: (x: number, z: number) => number,
    onMeteorLand: (x: number, z: number, spawn?: MeteorFallSpawn) => void,
  ) {
    this.scene = scene;
    this.groundY = groundY;
    this.onMeteorLand = onMeteorLand;
  }

  /** Reuse a retired material of this kind if the pool has one (resetting the
   *  one animated field, opacity, back to its config baseline), otherwise
   *  build a fresh one. `kind` identifies the FULL fixed config, including a
   *  discrete config-selecting discriminator such as a cast's school (see
   *  spawnRune): it must never carry CONTINUOUS per-spawn data (radius,
   *  duration, position), which would mint one bucket per spawn and never
   *  reuse anything. */
  private acquireMaterial<TMat extends THREE.Material>(
    kind: string,
    baseOpacity: number,
    build: () => TMat,
  ): TMat {
    const bucket = this.materialPool.get(kind);
    const pooled = bucket?.pop() as TMat | undefined;
    if (pooled) {
      pooled.opacity = baseOpacity;
      return pooled;
    }
    return build();
  }

  private releaseMaterial(kind: string, material: THREE.Material): void {
    let bucket = this.materialPool.get(kind);
    if (!bucket) {
      bucket = [];
      this.materialPool.set(kind, bucket);
    }
    bucket.push(material);
  }

  spawnMeteor(opts: MeteorFallSpawn): void {
    if (this.disposed) return;
    if (
      opts.persistentId !== undefined &&
      this.meteors.some((meteor) => meteor.persistentId === opts.persistentId)
    ) {
      return;
    }
    const geometry = this.ensureMeteorGeometry();
    const fire = new THREE.Color(SCHOOL_COLORS.fire);
    const magma = new THREE.Color(0xff5a0a);
    const root = new THREE.Group();
    root.name = 'mage-meteor-fx';
    root.userData.persistentMeteorId = opts.persistentId;

    const body = new THREE.Group();
    body.name = 'mage-meteor-body';
    const duration = Math.max(0.3, opts.duration);
    const warningLead = Math.min(Math.max(0, opts.warningLead ?? 0), duration - 0.1);
    const initialElapsed = Math.min(duration, Math.max(0, opts.initialElapsed ?? 0));
    body.visible = warningLead === 0;
    const rockMat = this.acquireMaterial(
      'meteor-rock',
      1,
      () =>
        new THREE.MeshStandardMaterial({
          color: 0x111013,
          emissive: 0x210600,
          emissiveIntensity: 0.42,
          roughness: 0.9,
          metalness: 0.04,
        }),
    );
    const rock = new THREE.Mesh(geometry.rock, rockMat);
    rock.name = 'mage-meteor-rock';
    rock.castShadow = true;
    body.add(rock);

    const magmaMat = this.acquireMaterial(
      'meteor-magma',
      0.98,
      () =>
        new THREE.MeshBasicMaterial({
          color: magma.clone().multiplyScalar(1.75),
          transparent: true,
          opacity: 0.98,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
    );
    const cracks = new THREE.Group();
    cracks.name = 'mage-meteor-cracks';
    for (const crackGeometry of geometry.cracks) {
      const crack = new THREE.Mesh(crackGeometry, magmaMat);
      crack.renderOrder = 6;
      cracks.add(crack);
    }
    body.add(cracks);

    const coronaMat = this.acquireMaterial(
      'meteor-corona',
      0.16,
      () =>
        new THREE.MeshBasicMaterial({
          color: fire.clone().multiplyScalar(1.5),
          transparent: true,
          opacity: 0.16,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.BackSide,
        }),
    );
    const corona = new THREE.Mesh(geometry.corona, coronaMat);
    corona.name = 'mage-meteor-corona';
    corona.scale.set(1.18, 1.18, 1.18);
    body.add(corona);
    root.add(body);

    const trail = new THREE.Group();
    trail.name = 'mage-meteor-trail';
    trail.visible = warningLead === 0;
    const trailOuterMat = this.acquireMaterial(
      'meteor-trail-outer',
      0.48,
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xd63708,
          transparent: true,
          opacity: 0.48,
          blending: THREE.NormalBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
    );
    const trailInnerMat = this.acquireMaterial(
      'meteor-trail-inner',
      0.3,
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xff7a12,
          transparent: true,
          opacity: 0.3,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
    );
    const outerTrail = new THREE.Mesh(geometry.trail, trailOuterMat);
    outerTrail.name = 'mage-meteor-trail-outer';
    outerTrail.scale.set(1.08, 0.96, 1.08);
    outerTrail.position.set(-0.12, 3.15, 0.08);
    outerTrail.rotation.z = 0.055;
    const innerTrail = new THREE.Mesh(geometry.trail, trailInnerMat);
    innerTrail.name = 'mage-meteor-trail-inner';
    innerTrail.scale.set(0.56, 0.7, 0.56);
    innerTrail.position.set(0.1, 2.45, -0.06);
    innerTrail.rotation.x = -0.045;
    trail.add(outerTrail, innerTrail);

    const emberPositions = new Float32Array(METEOR_EMBER_COUNT * 3);
    for (let i = 0; i < METEOR_EMBER_COUNT; i++) {
      const phase = i / METEOR_EMBER_COUNT;
      const angle = i * 2.39996;
      const spread = 0.18 + phase * 0.9;
      emberPositions[i * 3] = Math.cos(angle) * spread;
      emberPositions[i * 3 + 1] = 0.7 + phase * 8.5;
      emberPositions[i * 3 + 2] = Math.sin(angle) * spread;
    }
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
    const emberMat = this.acquireMaterial(
      'meteor-ember',
      0.9,
      () =>
        new THREE.PointsMaterial({
          color: 0xffb33c,
          size: 0.18,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          sizeAttenuation: true,
        }),
    );
    const embers = new THREE.Points(emberGeo, emberMat);
    embers.name = 'mage-meteor-trail-embers';
    trail.add(embers);
    root.add(trail);

    const gy = this.groundY(opts.x, opts.z);
    const startY = gy + METEOR_DROP_HEIGHT + METEOR_RADIUS;
    body.position.set(opts.x, startY, opts.z);
    trail.position.copy(body.position);

    const warning = this.buildMeteorTelegraph(opts, geometry.flame, initialElapsed / duration);
    warning.group.visible = opts.showTelegraph !== false;
    const contributorOwnsGroundDetail = opts.persistentId !== undefined;
    if (contributorOwnsGroundDetail) {
      warning.group.getObjectByName('mage-meteor-telegraph-footprint')!.visible = false;
      warning.group.getObjectByName('mage-meteor-telegraph-veins')!.visible = false;
      warning.group.getObjectByName('mage-meteor-telegraph-flames')!.visible = false;
      warning.beaconEmbers.visible = false;
    }
    root.add(warning.group);
    const ignivarFireAoe = opts.persistentId
      ? createGroundFireAoe({
          radius: opts.radius,
          count: 36,
          flameTexUrl: '/textures/vfx/ignivar_flame_6x6.webp',
        })
      : null;
    if (ignivarFireAoe) {
      ignivarFireAoe.group.position.set(opts.x, gy, opts.z);
      ignivarFireAoe.group.visible = opts.showTelegraph !== false;
      ignivarFireAoe.heatup();
      advanceGroundFireAoe(ignivarFireAoe, initialElapsed);
      this.scene.add(ignivarFireAoe.group);
    }
    this.scene.add(root);
    this.meteors.push({
      persistentId: opts.persistentId,
      snapshotManaged: false,
      root,
      body,
      trail,
      rockMat,
      magmaMat,
      coronaMat,
      trailOuterMat,
      trailInnerMat,
      emberMat,
      footprintMat: warning.footprintMat,
      boundaryMat: warning.boundaryMat,
      countdownMat: warning.countdownMat,
      veinMat: warning.veinMat,
      flameMat: warning.flameMat,
      beaconEmberMat: warning.beaconEmberMat,
      beaconEmbers: warning.beaconEmbers,
      countdownRing: warning.countdownRing,
      countdownPositions: warning.countdownPositions,
      countdownGeometryUpdateElapsed: 0,
      flames: warning.flames,
      flameBases: warning.flameBases,
      flameDummy: new THREE.Object3D(),
      ownedGeometries: [emberGeo, ...warning.ownedGeometries],
      x: opts.x,
      z: opts.z,
      radius: opts.radius,
      groundY: gy,
      duration,
      warningLead,
      elapsed: initialElapsed,
      landed: false,
      spawn: { ...opts },
      contributorOwnsGroundDetail,
      ignivarFireAoe,
    });
  }

  /** Reconciles warnings from authoritative snapshots with their live event visual. */
  syncWorldMeteorWarnings(world: {
    activeIgnivarMeteors: readonly MeteorWarningState[];
    activeVarkhulAnvilMeteors: readonly MeteorWarningState[];
    activeVarkhulForgestormWarnings: readonly MeteorWarningState[];
  }): void {
    this.syncMeteorWarnings(
      world.activeIgnivarMeteors,
      world.activeVarkhulAnvilMeteors,
      world.activeVarkhulForgestormWarnings,
    );
  }

  syncMeteorWarnings(
    warnings: readonly MeteorWarningState[],
    secondaryWarnings: readonly MeteorWarningState[] = [],
    tertiaryWarnings: readonly MeteorWarningState[] = [],
  ): void {
    const activeIds = new Set<string>();
    const syncWarning = (warning: MeteorWarningState): void => {
      activeIds.add(warning.id);
      if (this.resolvedPersistentMeteorIds.has(warning.id)) return;
      const existing = this.meteors.find((meteor) => meteor.persistentId === warning.id);
      if (existing) {
        existing.snapshotManaged = true;
        existing.duration = Math.max(0.05, warning.duration);
        existing.warningLead = Math.min(existing.duration - 0.01, Math.max(0, warning.warningLead));
        const authoritativeElapsed = Math.max(
          existing.elapsed,
          existing.duration - Math.min(existing.duration, warning.remaining),
        );
        if (existing.ignivarFireAoe) {
          advanceGroundFireAoe(existing.ignivarFireAoe, authoritativeElapsed - existing.elapsed);
        }
        existing.elapsed = authoritativeElapsed;
        return;
      }
      this.spawnMeteor({
        x: warning.x,
        z: warning.z,
        radius: warning.radius,
        duration: warning.duration,
        warningLead: warning.warningLead,
        persistentId: warning.id,
        initialElapsed: warning.duration - warning.remaining,
      });
      const spawned = this.meteors.find((meteor) => meteor.persistentId === warning.id);
      if (spawned) spawned.snapshotManaged = true;
    };
    for (const warning of warnings) syncWarning(warning);
    for (const warning of secondaryWarnings) syncWarning(warning);
    for (const warning of tertiaryWarnings) syncWarning(warning);
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const meteor = this.meteors[i];
      if (!meteor.snapshotManaged || !meteor.persistentId || activeIds.has(meteor.persistentId)) {
        continue;
      }
      this.disposeMeteor(meteor);
      this.meteors.splice(i, 1);
    }
    for (const id of this.resolvedPersistentMeteorIds) {
      if (!activeIds.has(id)) this.resolvedPersistentMeteorIds.delete(id);
    }
  }

  /** Resolves a server-authored impact and consumes its pending warning exactly once. */
  impactMeteor(persistentId: string, x: number, z: number): void {
    if (this.resolvedPersistentMeteorIds.has(persistentId)) return;
    this.resolvedPersistentMeteorIds.add(persistentId);
    const index = this.meteors.findIndex((meteor) => meteor.persistentId === persistentId);
    if (index < 0) {
      this.onMeteorLand(x, z);
      return;
    }
    const meteor = this.meteors[index];
    const shouldBurst = !meteor.landed;
    if (!shouldBurst) return;
    meteor.landed = true;
    meteor.elapsed = meteor.duration;
    meteor.body.visible = false;
    meteor.trail.visible = false;
    meteor.boundaryMat.opacity = 0;
    meteor.flameMat.opacity = 0;
    meteor.flames.visible = false;
    meteor.beaconEmberMat.opacity = 0;
    meteor.beaconEmbers.visible = false;
    meteor.ignivarFireAoe?.erupt();
    this.onMeteorLand(x, z);
  }

  private disposeMeteor(meteor: MeteorFx): void {
    meteor.ignivarFireAoe?.dispose();
    this.scene.remove(meteor.root);
    this.releaseMaterial('meteor-rock', meteor.rockMat);
    this.releaseMaterial('meteor-magma', meteor.magmaMat);
    this.releaseMaterial('meteor-corona', meteor.coronaMat);
    this.releaseMaterial('meteor-trail-outer', meteor.trailOuterMat);
    this.releaseMaterial('meteor-trail-inner', meteor.trailInnerMat);
    this.releaseMaterial('meteor-ember', meteor.emberMat);
    this.releaseMaterial('meteor-footprint', meteor.footprintMat);
    this.releaseMaterial('meteor-boundary', meteor.boundaryMat);
    this.releaseMaterial('meteor-countdown', meteor.countdownMat);
    this.releaseMaterial('meteor-vein', meteor.veinMat);
    this.releaseMaterial('meteor-flame', meteor.flameMat);
    this.releaseMaterial('meteor-beacon-ember', meteor.beaconEmberMat);
    meteor.flames.dispose();
    for (const geometry of meteor.ownedGeometries) geometry.dispose();
  }

  private ensureMeteorGeometry(): {
    rock: THREE.IcosahedronGeometry;
    corona: THREE.SphereGeometry;
    cracks: THREE.TubeGeometry[];
    trail: THREE.ConeGeometry;
    flame: THREE.BufferGeometry;
  } {
    if (!this.meteorGeo) {
      this.meteorGeo = new THREE.IcosahedronGeometry(METEOR_RADIUS, 2);
      const positions = this.meteorGeo.getAttribute('position') as THREE.BufferAttribute;
      const direction = new THREE.Vector3();
      for (let i = 0; i < positions.count; i++) {
        direction.fromBufferAttribute(positions, i).normalize();
        const noise =
          1 +
          Math.sin(direction.x * 9.1 + direction.y * 4.7) * 0.075 +
          Math.sin(direction.z * 11.3 - direction.x * 3.9) * 0.055 +
          Math.sin((direction.x + direction.y + direction.z) * 15.7) * 0.035;
        positions.setXYZ(
          i,
          direction.x * METEOR_RADIUS * noise,
          direction.y * METEOR_RADIUS * noise,
          direction.z * METEOR_RADIUS * noise,
        );
      }
      positions.needsUpdate = true;
      this.meteorGeo.computeVertexNormals();
      this.meteorGeo.computeBoundingSphere();
    }
    this.meteorCoronaGeo ??= new THREE.SphereGeometry(METEOR_RADIUS, 18, 12);
    this.meteorTrailGeo ??= new THREE.ConeGeometry(0.95, 5, 10, 1, true);
    if (!this.meteorFlameGeo) {
      const vertices: number[] = [];
      const indices: number[] = [];
      for (let plane = 0; plane < 2; plane++) {
        const offset = vertices.length / 3;
        const points = [
          [-0.18, -0.44],
          [0.18, -0.44],
          [0.12, 0.02],
          [0.055, 0.46],
          [-0.11, 0.05],
        ] as const;
        for (const [horizontal, y] of points) {
          if (plane === 0) vertices.push(horizontal, y, 0);
          else vertices.push(0, y, horizontal);
        }
        indices.push(
          offset,
          offset + 1,
          offset + 2,
          offset,
          offset + 2,
          offset + 4,
          offset + 2,
          offset + 3,
          offset + 4,
        );
      }
      this.meteorFlameGeo = new THREE.BufferGeometry();
      this.meteorFlameGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      this.meteorFlameGeo.setIndex(indices);
      this.meteorFlameGeo.computeVertexNormals();
    }
    if (!this.meteorCrackGeos) {
      const configs = [
        { theta: -1.2, phi: 0.8, step: 0.31 },
        { theta: 0.4, phi: 1.45, step: 0.27 },
        { theta: 2.1, phi: 2.05, step: -0.29 },
        { theta: -2.45, phi: 1.12, step: 0.34 },
        { theta: 1.28, phi: 2.38, step: -0.3 },
      ] as const;
      this.meteorCrackGeos = configs.map((config, crackIndex) => {
        const points: THREE.Vector3[] = [];
        for (let i = 0; i < 9; i++) {
          const theta = config.theta + i * config.step;
          const phi = config.phi + Math.sin(i * 1.71 + crackIndex) * 0.17;
          const radius = METEOR_RADIUS * (1.085 + Math.sin(i * 2.17) * 0.012);
          points.push(new THREE.Vector3().setFromSphericalCoords(radius, phi, theta));
        }
        return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, 0.045, 5, false);
      });
    }
    if (
      !this.meteorGeo ||
      !this.meteorCoronaGeo ||
      !this.meteorCrackGeos ||
      !this.meteorTrailGeo ||
      !this.meteorFlameGeo
    ) {
      throw new Error('Meteor geometry initialization failed.');
    }
    return {
      rock: this.meteorGeo,
      corona: this.meteorCoronaGeo,
      cracks: this.meteorCrackGeos,
      trail: this.meteorTrailGeo,
      flame: this.meteorFlameGeo,
    };
  }

  private writeMeteorCountdownRing(
    positions: Float32Array,
    x: number,
    z: number,
    radius: number,
    progress: number,
  ): void {
    const clampedProgress = Math.min(1, Math.max(0, progress));
    const collapse = clampedProgress * clampedProgress * (3 - 2 * clampedProgress);
    const outerRadius = radius * (0.84 - collapse * 0.72);
    const thickness = radius * (0.05 - collapse * 0.02);
    const innerRadius = Math.max(radius * 0.06, outerRadius - thickness);
    for (let i = 0; i < METEOR_TELEGRAPH_SEGMENTS; i++) {
      const angle = (i / METEOR_TELEGRAPH_SEGMENTS) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const outerX = x + cos * outerRadius;
      const outerZ = z + sin * outerRadius;
      const innerX = x + cos * innerRadius;
      const innerZ = z + sin * innerRadius;
      const offset = i * 6;
      positions[offset] = outerX;
      positions[offset + 1] = this.groundY(outerX, outerZ) + 0.085;
      positions[offset + 2] = outerZ;
      positions[offset + 3] = innerX;
      positions[offset + 4] = this.groundY(innerX, innerZ) + 0.085;
      positions[offset + 5] = innerZ;
    }
  }

  private buildMeteorTelegraph(
    opts: MeteorFallSpawn,
    flameGeometry: THREE.BufferGeometry,
    initialProgress: number,
  ): {
    group: THREE.Group;
    footprintMat: THREE.MeshBasicMaterial;
    boundaryMat: THREE.LineBasicMaterial;
    countdownMat: THREE.MeshBasicMaterial;
    veinMat: THREE.LineBasicMaterial;
    flameMat: THREE.MeshBasicMaterial;
    beaconEmberMat: THREE.PointsMaterial;
    beaconEmbers: THREE.Points;
    countdownRing: THREE.Mesh;
    countdownPositions: Float32Array;
    flames: THREE.InstancedMesh;
    flameBases: ReadonlyArray<{ x: number; y: number; z: number; phase: number }>;
    ownedGeometries: THREE.BufferGeometry[];
  } {
    const group = new THREE.Group();
    group.name = 'mage-meteor-telegraph';

    const footprintVertexCount = 1 + METEOR_FOOTPRINT_RADIAL_SEGMENTS * METEOR_TELEGRAPH_SEGMENTS;
    const footprintPositions = new Float32Array(footprintVertexCount * 3);
    footprintPositions[0] = opts.x;
    footprintPositions[1] = this.groundY(opts.x, opts.z) + 0.045;
    footprintPositions[2] = opts.z;
    for (let ring = 1; ring <= METEOR_FOOTPRINT_RADIAL_SEGMENTS; ring++) {
      const radius = (opts.radius * ring) / METEOR_FOOTPRINT_RADIAL_SEGMENTS;
      const ringOffset = 1 + (ring - 1) * METEOR_TELEGRAPH_SEGMENTS;
      for (let i = 0; i < METEOR_TELEGRAPH_SEGMENTS; i++) {
        const angle = (i / METEOR_TELEGRAPH_SEGMENTS) * Math.PI * 2;
        const x = opts.x + Math.cos(angle) * radius;
        const z = opts.z + Math.sin(angle) * radius;
        const offset = (ringOffset + i) * 3;
        footprintPositions[offset] = x;
        footprintPositions[offset + 1] = this.groundY(x, z) + 0.045;
        footprintPositions[offset + 2] = z;
      }
    }
    const footprintIndices: number[] = [];
    for (let i = 0; i < METEOR_TELEGRAPH_SEGMENTS; i++) {
      footprintIndices.push(0, 1 + i, 1 + ((i + 1) % METEOR_TELEGRAPH_SEGMENTS));
    }
    for (let ring = 2; ring <= METEOR_FOOTPRINT_RADIAL_SEGMENTS; ring++) {
      const innerOffset = 1 + (ring - 2) * METEOR_TELEGRAPH_SEGMENTS;
      const outerOffset = innerOffset + METEOR_TELEGRAPH_SEGMENTS;
      for (let i = 0; i < METEOR_TELEGRAPH_SEGMENTS; i++) {
        const next = (i + 1) % METEOR_TELEGRAPH_SEGMENTS;
        footprintIndices.push(
          innerOffset + i,
          outerOffset + i,
          outerOffset + next,
          innerOffset + i,
          outerOffset + next,
          innerOffset + next,
        );
      }
    }
    const footprintGeo = new THREE.BufferGeometry();
    footprintGeo.setAttribute('position', new THREE.BufferAttribute(footprintPositions, 3));
    footprintGeo.setIndex(footprintIndices);
    const footprintMat = this.acquireMaterial(
      'meteor-footprint',
      0.2,
      () =>
        new THREE.MeshBasicMaterial({
          color: 0x260407,
          transparent: true,
          opacity: 0.2,
          blending: THREE.NormalBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
    );
    const footprint = new THREE.Mesh(footprintGeo, footprintMat);
    footprint.name = 'mage-meteor-telegraph-footprint';
    footprint.renderOrder = 5;
    group.add(footprint);

    const boundaryPositions = new Float32Array(METEOR_TELEGRAPH_SEGMENTS * 3);
    for (let i = 0; i < METEOR_TELEGRAPH_SEGMENTS; i++) {
      const angle = (i / METEOR_TELEGRAPH_SEGMENTS) * Math.PI * 2;
      const x = opts.x + Math.cos(angle) * opts.radius;
      const z = opts.z + Math.sin(angle) * opts.radius;
      boundaryPositions[i * 3] = x;
      boundaryPositions[i * 3 + 1] = this.groundY(x, z) + 0.09;
      boundaryPositions[i * 3 + 2] = z;
    }
    const boundaryGeo = new THREE.BufferGeometry();
    boundaryGeo.setAttribute('position', new THREE.BufferAttribute(boundaryPositions, 3));
    const boundaryMat = this.acquireMaterial(
      'meteor-boundary',
      0.58,
      () =>
        new THREE.LineBasicMaterial({
          color: 0xff101c,
          transparent: true,
          opacity: 0.58,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
    );
    const boundary = new THREE.LineLoop(boundaryGeo, boundaryMat);
    boundary.name = 'mage-meteor-telegraph-boundary';
    boundary.renderOrder = 9;
    group.add(boundary);

    const countdownPositions = new Float32Array(METEOR_TELEGRAPH_SEGMENTS * 2 * 3);
    this.writeMeteorCountdownRing(countdownPositions, opts.x, opts.z, opts.radius, initialProgress);
    const countdownIndices: number[] = [];
    for (let i = 0; i < METEOR_TELEGRAPH_SEGMENTS; i++) {
      const next = (i + 1) % METEOR_TELEGRAPH_SEGMENTS;
      const outer = i * 2;
      const inner = outer + 1;
      const nextOuter = next * 2;
      const nextInner = nextOuter + 1;
      countdownIndices.push(outer, nextOuter, nextInner, outer, nextInner, inner);
    }
    const countdownGeo = new THREE.BufferGeometry();
    countdownGeo.setAttribute('position', new THREE.BufferAttribute(countdownPositions, 3));
    countdownGeo.setIndex(countdownIndices);
    const countdownMat = this.acquireMaterial(
      'meteor-countdown',
      0.34,
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xff1830,
          transparent: true,
          opacity: 0.34,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
    );
    const countdownRing = new THREE.Mesh(countdownGeo, countdownMat);
    countdownRing.name = 'mage-meteor-telegraph-countdown-ring';
    countdownRing.frustumCulled = false;
    countdownRing.renderOrder = 8;
    group.add(countdownRing);

    const veinVertices: number[] = [];
    const veinBranchCount = 14;
    const veinSegments = 7;
    for (let branch = 0; branch < veinBranchCount; branch++) {
      const baseAngle = (branch / veinBranchCount) * Math.PI * 2 + (branch % 2) * 0.09;
      const innerRadius = opts.radius * (0.07 + (branch % 3) * 0.018);
      const outerRadius = opts.radius * (0.76 + (branch % 4) * 0.025);
      for (let segment = 0; segment < veinSegments; segment++) {
        for (let endpoint = 0; endpoint < 2; endpoint++) {
          const progress = (segment + endpoint) / veinSegments;
          const zigzag = (segment + endpoint) % 2 === 0 ? 0.035 : -0.035;
          const sampleAngle =
            baseAngle +
            Math.sin(branch * 4.19 + progress * 15.7) * 0.12 * (0.45 + progress) +
            zigzag * progress;
          const radius =
            (innerRadius + (outerRadius - innerRadius) * progress) *
            (1 + Math.sin(branch * 2.31 + progress * 20.3) * 0.025);
          const x = opts.x + Math.cos(sampleAngle) * radius;
          const z = opts.z + Math.sin(sampleAngle) * radius;
          veinVertices.push(x, this.groundY(x, z) + 0.075, z);
        }
      }
      if (branch % 2 === 0) {
        const branchStartRadius = innerRadius + (outerRadius - innerRadius) * 0.52;
        const branchEndRadius = Math.min(opts.radius * 0.88, branchStartRadius + opts.radius * 0.2);
        const branchTurn = branch % 4 === 0 ? 0.3 : -0.3;
        for (let segment = 0; segment < 3; segment++) {
          for (let endpoint = 0; endpoint < 2; endpoint++) {
            const progress = (segment + endpoint) / 3;
            const sampleAngle =
              baseAngle + branchTurn * progress + Math.sin(branch * 3.07 + progress * 11.9) * 0.055;
            const radius = branchStartRadius + (branchEndRadius - branchStartRadius) * progress;
            const x = opts.x + Math.cos(sampleAngle) * radius;
            const z = opts.z + Math.sin(sampleAngle) * radius;
            veinVertices.push(x, this.groundY(x, z) + 0.075, z);
          }
        }
      }
    }
    const veinGeo = new THREE.BufferGeometry();
    veinGeo.setAttribute('position', new THREE.Float32BufferAttribute(veinVertices, 3));
    const veinMat = this.acquireMaterial(
      'meteor-vein',
      0.34,
      () =>
        new THREE.LineBasicMaterial({
          color: 0xff0818,
          transparent: true,
          opacity: 0.34,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
    );
    const veins = new THREE.LineSegments(veinGeo, veinMat);
    veins.name = 'mage-meteor-telegraph-veins';
    veins.renderOrder = 7;
    group.add(veins);

    const flameMat = this.acquireMaterial(
      'meteor-flame',
      0.24,
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xff2a12,
          transparent: true,
          opacity: 0.24,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
    );
    const flames = new THREE.InstancedMesh(flameGeometry, flameMat, METEOR_FLAME_COUNT);
    flames.name = 'mage-meteor-telegraph-flames';
    flames.frustumCulled = false;
    flames.renderOrder = 9;
    const flameBases: Array<{ x: number; y: number; z: number; phase: number }> = [];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < METEOR_FLAME_COUNT; i++) {
      const angle = (i / METEOR_FLAME_COUNT) * Math.PI * 2;
      const radius = opts.radius * (0.965 + Math.sin(i * 2.7) * 0.012);
      const x = opts.x + Math.cos(angle) * radius;
      const z = opts.z + Math.sin(angle) * radius;
      const y = this.groundY(x, z) + 0.46;
      flameBases.push({ x, y, z, phase: i * 1.73 });
      dummy.position.set(x, y, z);
      dummy.rotation.y = -angle;
      dummy.scale.set(0.7, 0.58 + (i % 3) * 0.12, 0.7);
      dummy.updateMatrix();
      flames.setMatrixAt(i, dummy.matrix);
    }
    flames.instanceMatrix.needsUpdate = true;
    group.add(flames);

    const beaconPositions = new Float32Array(METEOR_BEACON_EMBER_COUNT * 3);
    for (let i = 0; i < METEOR_BEACON_EMBER_COUNT; i++) {
      const phase = i / (METEOR_BEACON_EMBER_COUNT - 1);
      const angle = i * 2.39996;
      const radius = 0.07 + (i % 4) * 0.035;
      beaconPositions[i * 3] = Math.cos(angle) * radius;
      beaconPositions[i * 3 + 1] = 0.25 + phase * 4.45;
      beaconPositions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const beaconGeo = new THREE.BufferGeometry();
    beaconGeo.setAttribute('position', new THREE.BufferAttribute(beaconPositions, 3));
    const beaconEmberMat = this.acquireMaterial(
      'meteor-beacon-ember',
      0.18,
      () =>
        new THREE.PointsMaterial({
          color: 0xff3820,
          size: 0.14,
          transparent: true,
          opacity: 0.18,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          sizeAttenuation: true,
        }),
    );
    const beaconEmbers = new THREE.Points(beaconGeo, beaconEmberMat);
    beaconEmbers.name = 'mage-meteor-telegraph-beacon-embers';
    beaconEmbers.position.set(opts.x, this.groundY(opts.x, opts.z) + 0.1, opts.z);
    beaconEmbers.renderOrder = 8;
    group.add(beaconEmbers);

    return {
      group,
      footprintMat,
      boundaryMat,
      countdownMat,
      veinMat,
      flameMat,
      beaconEmberMat,
      beaconEmbers,
      countdownRing,
      countdownPositions,
      flames,
      flameBases,
      ownedGeometries: [footprintGeo, boundaryGeo, countdownGeo, veinGeo, beaconGeo],
    };
  }

  spawnRune(opts: RuneCircleSpawn): void {
    if (this.disposed) return;
    const school = opts.school ?? 'arcane';
    const schoolColor = capRingLightness(
      new THREE.Color(SCHOOL_COLORS[school] ?? SCHOOL_COLORS.arcane),
    );
    const group = new THREE.Group();
    group.name = 'mage-rune-power';
    const mats: THREE.Material[] = [];
    const matKinds: string[] = [];
    const ownedGeometries: THREE.BufferGeometry[] = [];
    const baseOpacities: number[] = [];
    // Outer ring at the zone edge, inner ring at half, both additive. Pool
    // kind carries the school: color is fixed config here (see
    // acquireMaterial's contract), and different schools must never share a
    // pooled instance or a later cast would inherit a stale tint. Each kind
    // string is computed ONCE and reused for both acquire and release, so
    // the two can never drift apart (a drift would either leak the bucket
    // forever or resurrect the stale-tint bug this fixes).
    for (const [name, radius, opacity] of [
      ['mage-rune-power-outer-ring', opts.radius, 0.75],
      ['mage-rune-power-inner-ring', opts.radius * 0.55, 0.45],
    ] as const) {
      const kind = `${name}:${school}`;
      const mat = this.acquireMaterial(
        kind,
        opacity,
        () =>
          new THREE.MeshBasicMaterial({
            color: schoolColor.clone().multiplyScalar(1.6),
            transparent: true,
            opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
      );
      const ringGeo = this.createTerrainRing(opts.x, opts.z, radius * 0.82, radius);
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.name = name;
      ring.renderOrder = 7;
      group.add(ring);
      mats.push(mat);
      matKinds.push(kind);
      ownedGeometries.push(ringGeo);
      baseOpacities.push(opacity);
    }
    // Four spokes so the circle reads as an inscribed rune, not a plain ring.
    const spokeKind = `mage-rune-power-spoke:${school}`;
    for (let i = 0; i < 4; i++) {
      const mat = this.acquireMaterial(
        spokeKind,
        0.4,
        () =>
          new THREE.MeshBasicMaterial({
            color: schoolColor.clone().multiplyScalar(1.3),
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
      );
      const spokeGeo = this.createTerrainSpoke(
        opts.x,
        opts.z,
        0.12,
        opts.radius * 0.9,
        (i / 4) * Math.PI,
      );
      const spoke = new THREE.Mesh(spokeGeo, mat);
      spoke.name = `mage-rune-power-spoke-${i}`;
      spoke.renderOrder = 7;
      group.add(spoke);
      mats.push(mat);
      matKinds.push(spokeKind);
      ownedGeometries.push(spokeGeo);
      baseOpacities.push(0.4);
    }
    // A soft filled glow at the center plus a ring of orbiting motes: the
    // inscription reads as living magic, not a chalk outline (owner playtest).
    const glowGeo = this.createTerrainDisc(opts.x, opts.z, opts.radius * 0.5, 32);
    const glowKind = `mage-rune-power-glow:${school}`;
    const glowMat = this.acquireMaterial(
      glowKind,
      0.18,
      () =>
        new THREE.MeshBasicMaterial({
          color: schoolColor.clone().multiplyScalar(0.9),
          transparent: true,
          opacity: 0.18,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
    );
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.name = 'mage-rune-power-glow';
    glow.renderOrder = 6;
    group.add(glow);
    mats.push(glowMat);
    matKinds.push(glowKind);
    ownedGeometries.push(glowGeo);
    baseOpacities.push(0.18);

    const orbit = new THREE.Group();
    orbit.name = 'mage-rune-power-motes';
    orbit.position.set(opts.x, this.groundY(opts.x, opts.z), opts.z);
    const moteGeo = new THREE.SphereGeometry(0.12, 8, 6);
    ownedGeometries.push(moteGeo);
    const moteKind = `mage-rune-power-mote:${school}`;
    for (let i = 0; i < 6; i++) {
      const moteMat = this.acquireMaterial(
        moteKind,
        0.85,
        () =>
          new THREE.MeshBasicMaterial({
            color: schoolColor.clone().multiplyScalar(1.9),
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
      );
      const mote = new THREE.Mesh(moteGeo, moteMat);
      const a = (i / 6) * Math.PI * 2;
      mote.position.set(Math.cos(a) * opts.radius * 0.8, 0.5, Math.sin(a) * opts.radius * 0.8);
      orbit.add(mote);
      mats.push(moteMat);
      matKinds.push(moteKind);
      baseOpacities.push(0.85);
    }
    group.add(orbit);
    this.scene.add(group);
    this.runes.push({
      group,
      orbit,
      mats,
      matKinds,
      ownedGeometries,
      duration: opts.duration,
      elapsed: 0,
      baseOpacities,
    });
  }

  private createTerrainRing(
    x: number,
    z: number,
    innerRadius: number,
    outerRadius: number,
  ): THREE.BufferGeometry {
    const vertices: number[] = [];
    const indices: number[] = [];
    for (let segment = 0; segment <= RUNE_SEGMENTS; segment++) {
      const angle = (segment / RUNE_SEGMENTS) * Math.PI * 2;
      for (const radius of [innerRadius, outerRadius]) {
        const sampleX = x + Math.cos(angle) * radius;
        const sampleZ = z + Math.sin(angle) * radius;
        vertices.push(sampleX, this.groundY(sampleX, sampleZ) + RUNE_GROUND_LIFT, sampleZ);
      }
      if (segment < RUNE_SEGMENTS) {
        const inner = segment * 2;
        indices.push(inner, inner + 1, inner + 2, inner + 1, inner + 3, inner + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    return geometry;
  }

  private createTerrainSpoke(
    x: number,
    z: number,
    width: number,
    length: number,
    angle: number,
  ): THREE.BufferGeometry {
    const segments = 12;
    const vertices: number[] = [];
    const indices: number[] = [];
    const alongX = Math.cos(angle);
    const alongZ = Math.sin(angle);
    const acrossX = -alongZ;
    const acrossZ = alongX;
    for (let segment = 0; segment <= segments; segment++) {
      const distance = -length / 2 + (length * segment) / segments;
      for (const side of [-1, 1]) {
        const sampleX = x + alongX * distance + acrossX * width * 0.5 * side;
        const sampleZ = z + alongZ * distance + acrossZ * width * 0.5 * side;
        vertices.push(sampleX, this.groundY(sampleX, sampleZ) + RUNE_GROUND_LIFT, sampleZ);
      }
      if (segment < segments) {
        const left = segment * 2;
        indices.push(left, left + 1, left + 2, left + 1, left + 3, left + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    return geometry;
  }

  private createTerrainDisc(
    x: number,
    z: number,
    radius: number,
    segments: number,
  ): THREE.BufferGeometry {
    const vertices = [x, this.groundY(x, z) + RUNE_GROUND_LIFT, z];
    const indices: number[] = [];
    const radialSegments = 8;
    for (let ring = 1; ring <= radialSegments; ring++) {
      const sampleRadius = (radius * ring) / radialSegments;
      for (let segment = 0; segment <= segments; segment++) {
        const angle = (segment / segments) * Math.PI * 2;
        const sampleX = x + Math.cos(angle) * sampleRadius;
        const sampleZ = z + Math.sin(angle) * sampleRadius;
        vertices.push(sampleX, this.groundY(sampleX, sampleZ) + RUNE_GROUND_LIFT, sampleZ);
        if (segment >= segments) continue;
        const current = 1 + (ring - 1) * (segments + 1) + segment;
        if (ring === 1) {
          indices.push(0, current, current + 1);
        } else {
          const previous = current - (segments + 1);
          indices.push(previous, current, previous + 1, current, current + 1, previous + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    return geometry;
  }

  spawnSnow(opts: SnowZoneSpawn): void {
    if (this.disposed) return;
    const frost = new THREE.Color(SCHOOL_COLORS.frost);
    const pos = new Float32Array(SNOW_COUNT * 3);
    const gy = this.groundY(opts.x, opts.z);
    for (let i = 0; i < SNOW_COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * opts.radius;
      pos[i * 3] = opts.x + Math.cos(a) * r;
      pos[i * 3 + 1] = gy + Math.random() * SNOW_TOP;
      pos[i * 3 + 2] = opts.z + Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = this.acquireMaterial(
      'snow-flake',
      0.9,
      () =>
        new THREE.PointsMaterial({
          color: frost.clone().lerp(new THREE.Color(0xffffff), 0.6),
          size: 0.18,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          sizeAttenuation: true,
        }),
    );
    const points = new THREE.Points(geo, mat);
    points.name = 'mage-blizzard-snow';
    points.frustumCulled = false;
    this.scene.add(points);
    // The perimeter: a crisp frost ring at the zone edge so the player reads
    // the storm's exact reach at a glance (reuses the rune ring geometry).
    this.runeRingGeo ??= new THREE.RingGeometry(0.82, 1, 48);
    const ringMat = this.acquireMaterial(
      'snow-ring',
      0.55,
      () =>
        new THREE.MeshBasicMaterial({
          color: frost.clone().lerp(new THREE.Color(0xffffff), 0.45).multiplyScalar(1.4),
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
    );
    const ring = new THREE.Mesh(this.runeRingGeo, ringMat);
    ring.name = 'mage-blizzard-boundary';
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(opts.radius);
    ring.position.set(opts.x, gy + 0.12, opts.z);
    this.scene.add(ring);
    this.snows.push({
      points,
      mat,
      pos,
      ring,
      ringMat,
      x: opts.x,
      z: opts.z,
      groundY: gy,
      radius: opts.radius,
      duration: opts.duration,
      elapsed: 0,
    });
  }

  /**
   * Release this renderer-owned effect at terminal teardown. Expiry returns
   * materials to the short-lived cast pool, but the pool itself must not
   * survive a renderer/context rebuild. The generated geometry for a cast is
   * owned here, while the class-level shape geometry is shared by active
   * casts and is disposed once after those casts are detached.
   */
  dispose(): void {
    // No early return on `disposed`, exactly as WarlockMeteorFx: a partial
    // failure below RETAINS what it could not release (the pool keeps every
    // material whose dispose threw), and a latch here would strand it for the
    // session with no way to re-attempt. A repeat call after a clean pass
    // collects nothing and throws nothing.
    this.disposed = true;

    const errors: unknown[] = [];
    const attempt = (cleanup: () => void): boolean => {
      try {
        cleanup();
        return true;
      } catch (error) {
        errors.push(error);
        return false;
      }
    };
    const materials = new Set<THREE.Material>();
    const geometries = new Set<THREE.BufferGeometry>();
    const instancedMeshes = new Set<THREE.InstancedMesh>();
    const collectRoot = (
      root: THREE.Object3D,
    ): {
      traversed: boolean;
      detached: boolean;
      materials: THREE.Material[];
      geometries: THREE.BufferGeometry[];
      instancedMeshes: THREE.InstancedMesh[];
    } => {
      const rootMaterials: THREE.Material[] = [];
      const rootGeometries: THREE.BufferGeometry[] = [];
      const rootInstancedMeshes: THREE.InstancedMesh[] = [];
      const traversed = attempt(() => {
        root.traverse((object) => {
          const renderable = object as THREE.Mesh | THREE.Line | THREE.Points;
          if (renderable.geometry) {
            geometries.add(renderable.geometry);
            rootGeometries.push(renderable.geometry);
          }
          const material = renderable.material;
          if (material) {
            for (const entry of Array.isArray(material) ? material : [material]) {
              materials.add(entry);
              rootMaterials.push(entry);
            }
          }
          if (object instanceof THREE.InstancedMesh) {
            instancedMeshes.add(object);
            rootInstancedMeshes.push(object);
          }
        });
      });
      const parent = root.parent;
      let detached = attempt(() => root.removeFromParent());
      if (root.parent === parent && parent) {
        detached = attempt(() => parent.remove(root)) && detached;
      }
      return {
        traversed,
        detached: detached && root.parent === null,
        materials: rootMaterials,
        geometries: rootGeometries,
        instancedMeshes: rootInstancedMeshes,
      };
    };

    // Detach status per ENTRY, not discarded: a root whose traverse or detach
    // threw is still in the scene and still drawing, so clearing the arrays
    // below would strand it with nothing left holding a reference. Those
    // entries are retained for the next dispose(), the same rule the pooled
    // materials follow.
    // Judged on the node's ACTUAL state, never on whether an attempt threw:
    // collectRoot's detach has a parent.remove fallback, and its `detached`
    // flag stays false when the first arm threw even though the fallback
    // succeeded and the node really is off the scene. What decides retention is
    // whether the root is still attached (still drawing) or was never
    // traversed (its resources were never collected).
    const stranded = <T>(entries: readonly T[], roots: (entry: T) => THREE.Object3D[]): T[] =>
      entries.filter((entry) => {
        let held = false;
        for (const root of roots(entry)) {
          const outcome = collectRoot(root);
          if (!outcome.traversed || root.parent !== null) held = true;
        }
        return held;
      });
    const strandedMeteors = stranded(this.meteors, (meteor) => [meteor.root]);
    const strandedRunes = stranded(this.runes, (rune) => [rune.group]);
    const strandedSnows = stranded(this.snows, (snow) => [snow.points, snow.ring]);

    for (const meteor of this.meteors) {
      for (const geometry of meteor.ownedGeometries) geometries.add(geometry);
      for (const material of [
        meteor.rockMat,
        meteor.magmaMat,
        meteor.coronaMat,
        meteor.trailOuterMat,
        meteor.trailInnerMat,
        meteor.emberMat,
        meteor.footprintMat,
        meteor.boundaryMat,
        meteor.countdownMat,
        meteor.veinMat,
        meteor.flameMat,
        meteor.beaconEmberMat,
      ]) {
        materials.add(material);
      }
    }
    for (const rune of this.runes) {
      for (const geometry of rune.ownedGeometries) geometries.add(geometry);
      for (const material of rune.mats) materials.add(material);
    }
    for (const snow of this.snows) {
      geometries.add(snow.points.geometry);
      materials.add(snow.mat);
      materials.add(snow.ringMat);
    }

    for (const bucket of this.materialPool.values()) {
      for (const material of bucket) materials.add(material);
    }

    for (const geometry of [
      this.meteorGeo,
      this.meteorCoronaGeo,
      ...(this.meteorCrackGeos ?? []),
      this.meteorTrailGeo,
      this.meteorFlameGeo,
      this.runeRingGeo,
    ]) {
      if (geometry) geometries.add(geometry);
    }
    for (const instancedMesh of instancedMeshes) {
      attempt(() => instancedMesh.dispose());
    }
    const geometryStatus = new Map<THREE.BufferGeometry, boolean>();
    for (const geometry of geometries) {
      geometryStatus.set(
        geometry,
        attempt(() => geometry.dispose()),
      );
    }
    // A class-level geometry is nulled only once it really went. Nulling one
    // whose dispose threw would drop the last reference to live GPU memory.
    const keepGeometry = <T extends THREE.BufferGeometry>(geometry: T | null): T | null =>
      geometry && geometryStatus.get(geometry) !== true ? geometry : null;
    const materialStatus = new Map<THREE.Material, boolean>();
    for (const material of materials) {
      const disposed = attempt(() => material.dispose());
      materialStatus.set(material, disposed);
    }

    for (const [kind, bucket] of this.materialPool) {
      const remaining: THREE.Material[] = [];
      for (const material of bucket) {
        if (materialStatus.get(material) !== true) remaining.push(material);
      }
      if (remaining.length > 0) {
        bucket.length = 0;
        bucket.push(...remaining);
      } else {
        this.materialPool.delete(kind);
      }
    }

    this.meteors.length = 0;
    this.meteors.push(...strandedMeteors);
    this.runes.length = 0;
    this.runes.push(...strandedRunes);
    this.snows.length = 0;
    this.snows.push(...strandedSnows);
    this.meteorGeo = keepGeometry(this.meteorGeo);
    this.meteorCoronaGeo = keepGeometry(this.meteorCoronaGeo);
    this.meteorCrackGeos =
      this.meteorCrackGeos?.filter((geometry) => geometryStatus.get(geometry) !== true) ?? null;
    if (this.meteorCrackGeos?.length === 0) this.meteorCrackGeos = null;
    this.meteorTrailGeo = keepGeometry(this.meteorTrailGeo);
    this.meteorFlameGeo = keepGeometry(this.meteorFlameGeo);
    this.runeRingGeo = keepGeometry(this.runeRingGeo);
    if (errors.length > 0) throw new AggregateError(errors, 'MageGroundFx disposal failed');
  }

  update(dt: number): void {
    if (this.disposed) return;
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.elapsed += dt;
      m.ignivarFireAoe?.update(dt);
      const t = Math.min(1, m.elapsed / m.duration);
      if (!m.landed && t >= 1) {
        m.landed = true;
        m.body.visible = false;
        m.trail.visible = false;
        m.boundaryMat.opacity = 0;
        m.flameMat.opacity = 0;
        m.flames.visible = false;
        m.beaconEmberMat.opacity = 0;
        m.beaconEmbers.visible = false;
        m.ignivarFireAoe?.erupt();
        this.onMeteorLand(m.x, m.z, m.spawn);
      }
      if (m.landed) {
        const scorchElapsed = m.elapsed - m.duration;
        if (scorchElapsed < METEOR_SCORCH_LINGER) {
          const fade = 1 - scorchElapsed / METEOR_SCORCH_LINGER;
          const firePulse = 0.84 + Math.sin(scorchElapsed * 11) * 0.16;
          if (!m.contributorOwnsGroundDetail) m.footprintMat.opacity = 0.14 * fade;
          m.countdownMat.opacity = 0.58 * fade * firePulse;
          if (!m.contributorOwnsGroundDetail) {
            m.veinMat.opacity = 0.56 * fade * (0.88 + Math.sin(scorchElapsed * 8 + 0.7) * 0.12);
          }
          if (scorchElapsed > METEOR_SCORCH_LINGER - 1) m.ignivarFireAoe?.stop();
          continue;
        }
        this.disposeMeteor(m);
        this.meteors.splice(i, 1);
        continue;
      }
      const fallDuration = m.duration - m.warningLead;
      const fallT = Math.min(1, Math.max(0, (m.elapsed - m.warningLead) / fallDuration));
      const falling = m.elapsed >= m.warningLead;
      m.body.visible = falling;
      m.trail.visible = falling;
      // Ease-in fall: slow release, violent finish, like a real drop.
      const eased = fallT * fallT;
      const meteorY = m.groundY + METEOR_DROP_HEIGHT * (1 - eased) + METEOR_RADIUS;
      m.body.position.y = meteorY;
      m.trail.position.y = meteorY;
      m.body.rotation.y += 2.6 * dt;
      m.body.rotation.x += 1.7 * dt;
      const heatPulse = 0.88 + Math.sin(m.elapsed * 10) * 0.12;
      m.magmaMat.opacity = 0.82 + heatPulse * 0.16;
      m.coronaMat.opacity = (0.12 + fallT * 0.12) * heatPulse;
      m.trailOuterMat.opacity = (0.4 + fallT * 0.12) * heatPulse;
      m.trailInnerMat.opacity = (0.24 + fallT * 0.12) * heatPulse;
      m.emberMat.opacity = 0.72 + fallT * 0.24;
      m.trail.rotation.y -= dt * 0.45;

      const warningPulse = 0.88 + Math.sin(m.elapsed * (5 + t * 7)) * 0.12;
      m.boundaryMat.opacity = (0.58 + t * 0.25) * warningPulse;
      m.countdownMat.opacity = (0.34 + t * 0.5) * warningPulse;
      if (!m.contributorOwnsGroundDetail) {
        m.footprintMat.opacity = (0.18 + t * 0.07) * (0.96 + Math.sin(m.elapsed * 4) * 0.04);
        m.veinMat.opacity = (0.34 + t * 0.46) * warningPulse;
        m.flameMat.opacity = (0.22 + t * 0.16) * warningPulse;
        m.beaconEmberMat.opacity = (0.14 + t * 0.14) * warningPulse;
        m.beaconEmbers.rotation.y += dt * (0.2 + t * 0.35);
      }
      // Terrain-draping the two moving rims costs 144 height samples. Five raid
      // warnings used to repeat that work and upload five buffers every render
      // frame; 20 Hz stays visually continuous while bounding the CPU/GPU churn.
      m.countdownGeometryUpdateElapsed += dt;
      if (m.countdownGeometryUpdateElapsed >= METEOR_COUNTDOWN_GEOMETRY_UPDATE_SECONDS) {
        m.countdownGeometryUpdateElapsed %= METEOR_COUNTDOWN_GEOMETRY_UPDATE_SECONDS;
        this.writeMeteorCountdownRing(m.countdownPositions, m.x, m.z, m.radius, t);
        m.countdownRing.geometry.attributes.position.needsUpdate = true;
      }
      if (!m.contributorOwnsGroundDetail) {
        for (let flameIndex = 0; flameIndex < m.flameBases.length; flameIndex++) {
          const base = m.flameBases[flameIndex];
          const flicker = 0.58 + Math.sin(m.elapsed * 9 + base.phase) * 0.13 + t * 0.22;
          m.flameDummy.position.set(base.x, base.y + Math.max(0, flicker - 0.56) * 0.14, base.z);
          m.flameDummy.rotation.set(0, -base.phase * 0.22 + m.elapsed * 0.35, 0);
          m.flameDummy.scale.set(0.66 + t * 0.16, flicker, 0.66 + t * 0.16);
          m.flameDummy.updateMatrix();
          m.flames.setMatrixAt(flameIndex, m.flameDummy.matrix);
        }
        m.flames.instanceMatrix.needsUpdate = true;
      }
    }
    for (let i = this.runes.length - 1; i >= 0; i--) {
      const r = this.runes[i];
      r.elapsed += dt;
      if (r.elapsed >= r.duration) {
        this.scene.remove(r.group);
        r.mats.forEach((mat, idx) => {
          this.releaseMaterial(r.matKinds[idx], mat);
        });
        for (const geometry of r.ownedGeometries) geometry.dispose();
        this.runes.splice(i, 1);
        continue;
      }
      r.orbit.rotation.y += RUNE_SPIN * dt;
      // Steady glow with a soft breath; fade out over the last moments.
      const fade = Math.min(1, (r.duration - r.elapsed) / RUNE_FADE);
      const breath = 0.85 + 0.15 * Math.sin(r.elapsed * 2.4);
      r.mats.forEach((mat, idx) => {
        (mat as THREE.MeshBasicMaterial).opacity = r.baseOpacities[idx] * fade * breath;
      });
    }
    for (let i = this.snows.length - 1; i >= 0; i--) {
      const sfx = this.snows[i];
      sfx.elapsed += dt;
      if (sfx.elapsed >= sfx.duration) {
        this.scene.remove(sfx.points);
        this.releaseMaterial('snow-flake', sfx.mat);
        sfx.points.geometry.dispose();
        this.scene.remove(sfx.ring);
        this.releaseMaterial('snow-ring', sfx.ringMat);
        this.snows.splice(i, 1);
        continue;
      }
      // Every flake sinks; one that reaches the ground respawns at the top of
      // the column at a fresh scatter, so the fall never runs dry.
      for (let f = 0; f < SNOW_COUNT; f++) {
        sfx.pos[f * 3 + 1] -= SNOW_FALL * dt;
        if (sfx.pos[f * 3 + 1] <= sfx.groundY + 0.1) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * sfx.radius;
          sfx.pos[f * 3] = sfx.x + Math.cos(a) * r;
          sfx.pos[f * 3 + 1] = sfx.groundY + SNOW_TOP;
          sfx.pos[f * 3 + 2] = sfx.z + Math.sin(a) * r;
        }
      }
      sfx.points.geometry.attributes.position.needsUpdate = true;
      const snowFade = Math.min(1, (sfx.duration - sfx.elapsed) / 0.6);
      sfx.mat.opacity = 0.9 * snowFade;
      // Keep the playable boundary readable until the authoritative zone
      // expires. Only the falling snow fades; the ring is removed on the
      // exact expiry branch above, so it never disappears early.
      sfx.ringMat.opacity = 0.55 * (0.92 + Math.sin(sfx.elapsed * 2.4) * 0.08);
      sfx.ring.rotation.z += 0.15 * dt; // a lazy drift so the edge reads alive
    }
  }
}

/** The 'spellfxAt' fx union, so a typo in a dispatch arm stays a compile error. */
type SpellfxAtFx = Extract<SimEvent, { type: 'spellfxAt' }>['fx'];

/** The 'spellfxAt' fields the meteor and rune arms read. */
export interface MageGroundSpellfxEvent {
  fx: SpellfxAtFx;
  x: number;
  z: number;
  school: string;
  radius?: number;
  duration?: number;
  sourceId?: number;
  ability?: string;
  warningLead?: number;
  persistentId?: string;
}

/**
 * Claim the stateful ground cues this module owns, moved verbatim from the
 * renderer's event switch: a persistent-warning impact resolves that meteor in
 * place, a fall (telegraphed or ambient) spawns the falling body, and a rune
 * circle spawns the persistent inscription. Returns true when the event was
 * consumed so the caller can break out of its switch arm; a 'meteorImpact'
 * without a persistentId stays unclaimed and falls through to the caller's
 * generic ground-impact burst.
 */
export function handleMageGroundSpellfxEvent(
  fx: MageGroundFx,
  ev: MageGroundSpellfxEvent,
): boolean {
  if (ev.fx === 'meteorImpact' && ev.persistentId) {
    fx.impactMeteor(ev.persistentId, ev.x, ev.z);
    return true;
  }
  if (ev.fx === 'meteorFall' || ev.fx === 'ambientMeteorFall') {
    fx.spawnMeteor({
      x: ev.x,
      z: ev.z,
      radius: ev.radius ?? 8,
      duration: ev.duration ?? 2,
      sourceId: ev.sourceId,
      ability: ev.ability,
      showTelegraph: ev.fx !== 'ambientMeteorFall',
      warningLead: ev.warningLead,
      persistentId: ev.persistentId,
    });
    return true;
  }
  if (ev.fx === 'runeCircle') {
    fx.spawnRune({
      x: ev.x,
      z: ev.z,
      radius: ev.radius ?? 8,
      duration: ev.duration ?? 15,
      school: ev.school,
    });
    return true;
  }
  return false;
}
