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
// transient systems. Geometries are shared; materials are per instance (they
// animate) and disposed on expiry. Math.random is fine here (render-only).

import * as THREE from 'three';
import { SCHOOL_COLORS } from './vfx';

const METEOR_DROP_HEIGHT = 45; // yards above the impact point it appears
const METEOR_RADIUS = 1.12;
const METEOR_TELEGRAPH_SEGMENTS = 72;
const METEOR_FLAME_COUNT = 18;
const METEOR_EMBER_COUNT = 28;
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
}

export interface RuneCircleSpawn {
  x: number;
  z: number;
  radius: number;
  duration: number;
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
  root: THREE.Group;
  body: THREE.Group;
  trail: THREE.Group;
  rockMat: THREE.MeshStandardMaterial;
  magmaMat: THREE.MeshBasicMaterial;
  coronaMat: THREE.MeshBasicMaterial;
  trailOuterMat: THREE.MeshBasicMaterial;
  trailInnerMat: THREE.MeshBasicMaterial;
  emberMat: THREE.PointsMaterial;
  boundaryMat: THREE.LineBasicMaterial;
  innerRingMat: THREE.LineBasicMaterial;
  veinMat: THREE.LineBasicMaterial;
  flameMat: THREE.MeshBasicMaterial;
  flames: THREE.InstancedMesh;
  flameBases: ReadonlyArray<{ x: number; y: number; z: number; phase: number }>;
  flameDummy: THREE.Object3D;
  ownedGeometries: THREE.BufferGeometry[];
  x: number;
  z: number;
  groundY: number;
  duration: number;
  elapsed: number;
  landed: boolean;
}

interface RuneFx {
  group: THREE.Group;
  orbit: THREE.Group;
  mats: THREE.Material[];
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
  private readonly onMeteorLand: (x: number, z: number) => void;
  private readonly meteors: MeteorFx[] = [];
  private readonly runes: RuneFx[] = [];
  private readonly snows: SnowFx[] = [];
  private meteorGeo: THREE.IcosahedronGeometry | null = null;
  private meteorCoronaGeo: THREE.SphereGeometry | null = null;
  private meteorCrackGeos: THREE.TubeGeometry[] | null = null;
  private meteorTrailGeo: THREE.ConeGeometry | null = null;
  private meteorFlameGeo: THREE.BufferGeometry | null = null;
  private runeRingGeo: THREE.RingGeometry | null = null;

  constructor(
    scene: THREE.Scene,
    groundY: (x: number, z: number) => number,
    onMeteorLand: (x: number, z: number) => void,
  ) {
    this.scene = scene;
    this.groundY = groundY;
    this.onMeteorLand = onMeteorLand;
  }

  spawnMeteor(opts: MeteorFallSpawn): void {
    const geometry = this.ensureMeteorGeometry();
    const fire = new THREE.Color(SCHOOL_COLORS.fire);
    const magma = new THREE.Color(0xff5a0a);
    const root = new THREE.Group();
    root.name = 'mage-meteor-fx';

    const body = new THREE.Group();
    body.name = 'mage-meteor-body';
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x111013,
      emissive: 0x210600,
      emissiveIntensity: 0.42,
      roughness: 0.9,
      metalness: 0.04,
    });
    const rock = new THREE.Mesh(geometry.rock, rockMat);
    rock.name = 'mage-meteor-rock';
    rock.castShadow = true;
    body.add(rock);

    const magmaMat = new THREE.MeshBasicMaterial({
      color: magma.clone().multiplyScalar(1.75),
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cracks = new THREE.Group();
    cracks.name = 'mage-meteor-cracks';
    for (const crackGeometry of geometry.cracks) {
      const crack = new THREE.Mesh(crackGeometry, magmaMat);
      crack.renderOrder = 6;
      cracks.add(crack);
    }
    body.add(cracks);

    const coronaMat = new THREE.MeshBasicMaterial({
      color: fire.clone().multiplyScalar(1.5),
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    const corona = new THREE.Mesh(geometry.corona, coronaMat);
    corona.name = 'mage-meteor-corona';
    corona.scale.set(1.18, 1.18, 1.18);
    body.add(corona);
    root.add(body);

    const trail = new THREE.Group();
    trail.name = 'mage-meteor-trail';
    const trailOuterMat = new THREE.MeshBasicMaterial({
      color: 0xd63708,
      transparent: true,
      opacity: 0.48,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const trailInnerMat = new THREE.MeshBasicMaterial({
      color: 0xff7a12,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
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
    const emberMat = new THREE.PointsMaterial({
      color: 0xffb33c,
      size: 0.18,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const embers = new THREE.Points(emberGeo, emberMat);
    embers.name = 'mage-meteor-trail-embers';
    trail.add(embers);
    root.add(trail);

    const gy = this.groundY(opts.x, opts.z);
    const startY = gy + METEOR_DROP_HEIGHT + METEOR_RADIUS;
    body.position.set(opts.x, startY, opts.z);
    trail.position.copy(body.position);

    const warning = this.buildMeteorTelegraph(opts, geometry.flame);
    root.add(warning.group);
    this.scene.add(root);
    this.meteors.push({
      root,
      body,
      trail,
      rockMat,
      magmaMat,
      coronaMat,
      trailOuterMat,
      trailInnerMat,
      emberMat,
      boundaryMat: warning.boundaryMat,
      innerRingMat: warning.innerRingMat,
      veinMat: warning.veinMat,
      flameMat: warning.flameMat,
      flames: warning.flames,
      flameBases: warning.flameBases,
      flameDummy: new THREE.Object3D(),
      ownedGeometries: [emberGeo, ...warning.ownedGeometries],
      x: opts.x,
      z: opts.z,
      groundY: gy,
      duration: Math.max(0.3, opts.duration),
      elapsed: 0,
      landed: false,
    });
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

  private buildMeteorTelegraph(
    opts: MeteorFallSpawn,
    flameGeometry: THREE.BufferGeometry,
  ): {
    group: THREE.Group;
    boundaryMat: THREE.LineBasicMaterial;
    innerRingMat: THREE.LineBasicMaterial;
    veinMat: THREE.LineBasicMaterial;
    flameMat: THREE.MeshBasicMaterial;
    flames: THREE.InstancedMesh;
    flameBases: ReadonlyArray<{ x: number; y: number; z: number; phase: number }>;
    ownedGeometries: THREE.BufferGeometry[];
  } {
    const group = new THREE.Group();
    group.name = 'mage-meteor-telegraph';
    const boundaryPositions = new Float32Array(METEOR_TELEGRAPH_SEGMENTS * 3);
    const innerPositions = new Float32Array(METEOR_TELEGRAPH_SEGMENTS * 3);
    for (let i = 0; i < METEOR_TELEGRAPH_SEGMENTS; i++) {
      const angle = (i / METEOR_TELEGRAPH_SEGMENTS) * Math.PI * 2;
      for (const [positions, radius, lift] of [
        [boundaryPositions, opts.radius, 0.08],
        [innerPositions, opts.radius * 0.62, 0.075],
      ] as const) {
        const x = opts.x + Math.cos(angle) * radius;
        const z = opts.z + Math.sin(angle) * radius;
        positions[i * 3] = x;
        positions[i * 3 + 1] = this.groundY(x, z) + lift;
        positions[i * 3 + 2] = z;
      }
    }
    const boundaryGeo = new THREE.BufferGeometry();
    boundaryGeo.setAttribute('position', new THREE.BufferAttribute(boundaryPositions, 3));
    const boundaryMat = new THREE.LineBasicMaterial({
      color: 0xff6a12,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const boundary = new THREE.LineLoop(boundaryGeo, boundaryMat);
    boundary.name = 'mage-meteor-telegraph-boundary';
    boundary.renderOrder = 8;
    group.add(boundary);

    const innerGeo = new THREE.BufferGeometry();
    innerGeo.setAttribute('position', new THREE.BufferAttribute(innerPositions, 3));
    const innerRingMat = new THREE.LineBasicMaterial({
      color: 0xffb02e,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const innerRing = new THREE.LineLoop(innerGeo, innerRingMat);
    innerRing.name = 'mage-meteor-telegraph-inner-ring';
    innerRing.renderOrder = 8;
    group.add(innerRing);

    const veinVertices: number[] = [];
    for (let branch = 0; branch < 10; branch++) {
      const angle = (branch / 10) * Math.PI * 2 + (branch % 2) * 0.11;
      const innerRadius = opts.radius * (0.18 + (branch % 3) * 0.035);
      const outerRadius = opts.radius * (0.72 + (branch % 2) * 0.08);
      const bendAngle = angle + (branch % 2 === 0 ? 0.13 : -0.12);
      const segments = 5;
      for (let segment = 0; segment < segments; segment++) {
        for (const progress of [segment / segments, (segment + 1) / segments]) {
          const radius = innerRadius + (outerRadius - innerRadius) * progress;
          const sampleAngle = angle + (bendAngle - angle) * progress;
          const x = opts.x + Math.cos(sampleAngle) * radius;
          const z = opts.z + Math.sin(sampleAngle) * radius;
          veinVertices.push(x, this.groundY(x, z) + 0.07, z);
        }
      }
    }
    const veinGeo = new THREE.BufferGeometry();
    veinGeo.setAttribute('position', new THREE.Float32BufferAttribute(veinVertices, 3));
    const veinMat = new THREE.LineBasicMaterial({
      color: 0xff3d06,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const veins = new THREE.LineSegments(veinGeo, veinMat);
    veins.name = 'mage-meteor-telegraph-veins';
    veins.renderOrder = 7;
    group.add(veins);

    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xff5f0b,
      transparent: true,
      opacity: 0.44,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
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
      dummy.scale.set(0.85, 0.75 + (i % 3) * 0.15, 0.85);
      dummy.updateMatrix();
      flames.setMatrixAt(i, dummy.matrix);
    }
    flames.instanceMatrix.needsUpdate = true;
    group.add(flames);

    return {
      group,
      boundaryMat,
      innerRingMat,
      veinMat,
      flameMat,
      flames,
      flameBases,
      ownedGeometries: [boundaryGeo, innerGeo, veinGeo],
    };
  }

  spawnRune(opts: RuneCircleSpawn): void {
    const arcane = new THREE.Color(SCHOOL_COLORS.arcane);
    const group = new THREE.Group();
    group.name = 'mage-rune-power';
    const mats: THREE.Material[] = [];
    const ownedGeometries: THREE.BufferGeometry[] = [];
    const baseOpacities: number[] = [];
    // Outer ring at the zone edge, inner ring at half, both additive.
    for (const [name, radius, opacity] of [
      ['mage-rune-power-outer-ring', opts.radius, 0.75],
      ['mage-rune-power-inner-ring', opts.radius * 0.55, 0.45],
    ] as const) {
      const mat = new THREE.MeshBasicMaterial({
        color: arcane.clone().multiplyScalar(1.6),
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ringGeo = this.createTerrainRing(opts.x, opts.z, radius * 0.82, radius);
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.name = name;
      ring.renderOrder = 7;
      group.add(ring);
      mats.push(mat);
      ownedGeometries.push(ringGeo);
      baseOpacities.push(opacity);
    }
    // Four spokes so the circle reads as an inscribed rune, not a plain ring.
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: arcane.clone().multiplyScalar(1.3),
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
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
      ownedGeometries.push(spokeGeo);
      baseOpacities.push(0.4);
    }
    // A soft filled glow at the center plus a ring of orbiting motes: the
    // inscription reads as living magic, not a chalk outline (owner playtest).
    const glowGeo = this.createTerrainDisc(opts.x, opts.z, opts.radius * 0.5, 32);
    const glowMat = new THREE.MeshBasicMaterial({
      color: arcane.clone().multiplyScalar(0.9),
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.name = 'mage-rune-power-glow';
    glow.renderOrder = 6;
    group.add(glow);
    mats.push(glowMat);
    ownedGeometries.push(glowGeo);
    baseOpacities.push(0.18);

    const orbit = new THREE.Group();
    orbit.name = 'mage-rune-power-motes';
    orbit.position.set(opts.x, this.groundY(opts.x, opts.z), opts.z);
    const moteGeo = new THREE.SphereGeometry(0.12, 8, 6);
    ownedGeometries.push(moteGeo);
    for (let i = 0; i < 6; i++) {
      const moteMat = new THREE.MeshBasicMaterial({
        color: arcane.clone().multiplyScalar(1.9),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mote = new THREE.Mesh(moteGeo, moteMat);
      const a = (i / 6) * Math.PI * 2;
      mote.position.set(Math.cos(a) * opts.radius * 0.8, 0.5, Math.sin(a) * opts.radius * 0.8);
      orbit.add(mote);
      mats.push(moteMat);
      baseOpacities.push(0.85);
    }
    group.add(orbit);
    this.scene.add(group);
    this.runes.push({
      group,
      orbit,
      mats,
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
    const mat = new THREE.PointsMaterial({
      color: frost.clone().lerp(new THREE.Color(0xffffff), 0.6),
      size: 0.18,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.name = 'mage-blizzard-snow';
    points.frustumCulled = false;
    this.scene.add(points);
    // The perimeter: a crisp frost ring at the zone edge so the player reads
    // the storm's exact reach at a glance (reuses the rune ring geometry).
    this.runeRingGeo ??= new THREE.RingGeometry(0.82, 1, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: frost.clone().lerp(new THREE.Color(0xffffff), 0.45).multiplyScalar(1.4),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
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

  update(dt: number): void {
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.elapsed += dt;
      const t = Math.min(1, m.elapsed / m.duration);
      if (!m.landed && t >= 1) {
        m.landed = true;
        m.body.visible = false;
        m.trail.visible = false;
        m.boundaryMat.opacity = 0;
        m.flameMat.opacity = 0;
        m.flames.visible = false;
        this.onMeteorLand(m.x, m.z);
      }
      if (m.landed) {
        const scorchElapsed = m.elapsed - m.duration;
        if (scorchElapsed < METEOR_SCORCH_LINGER) {
          const fade = 1 - scorchElapsed / METEOR_SCORCH_LINGER;
          const firePulse = 0.84 + Math.sin(scorchElapsed * 11) * 0.16;
          m.innerRingMat.opacity = 0.58 * fade * firePulse;
          m.veinMat.opacity = 0.5 * fade * (0.88 + Math.sin(scorchElapsed * 8 + 0.7) * 0.12);
          continue;
        }
        this.scene.remove(m.root);
        m.rockMat.dispose();
        m.magmaMat.dispose();
        m.coronaMat.dispose();
        m.trailOuterMat.dispose();
        m.trailInnerMat.dispose();
        m.emberMat.dispose();
        m.boundaryMat.dispose();
        m.innerRingMat.dispose();
        m.veinMat.dispose();
        m.flameMat.dispose();
        m.flames.dispose();
        for (const geometry of m.ownedGeometries) geometry.dispose();
        this.meteors.splice(i, 1);
        continue;
      }
      // Ease-in fall: slow release, violent finish, like a real drop.
      const eased = t * t;
      const meteorY = m.groundY + METEOR_DROP_HEIGHT * (1 - eased) + METEOR_RADIUS;
      m.body.position.y = meteorY;
      m.trail.position.y = meteorY;
      m.body.rotation.y += 2.6 * dt;
      m.body.rotation.x += 1.7 * dt;
      const heatPulse = 0.88 + Math.sin(m.elapsed * 10) * 0.12;
      m.magmaMat.opacity = 0.82 + heatPulse * 0.16;
      m.coronaMat.opacity = (0.12 + t * 0.12) * heatPulse;
      m.trailOuterMat.opacity = (0.4 + t * 0.12) * heatPulse;
      m.trailInnerMat.opacity = (0.24 + t * 0.12) * heatPulse;
      m.emberMat.opacity = 0.72 + t * 0.24;
      m.trail.rotation.y -= dt * 0.45;

      const warningPulse = 0.88 + Math.sin(m.elapsed * (5 + t * 7)) * 0.12;
      m.boundaryMat.opacity = (0.42 + t * 0.42) * warningPulse;
      m.innerRingMat.opacity = (0.22 + t * 0.34) * warningPulse;
      m.veinMat.opacity = (0.18 + t * 0.42) * warningPulse;
      m.flameMat.opacity = (0.38 + t * 0.3) * warningPulse;
      for (let flameIndex = 0; flameIndex < m.flameBases.length; flameIndex++) {
        const base = m.flameBases[flameIndex];
        const flicker = 0.74 + Math.sin(m.elapsed * 9 + base.phase) * 0.18 + t * 0.3;
        m.flameDummy.position.set(base.x, base.y + Math.max(0, flicker - 0.72) * 0.18, base.z);
        m.flameDummy.rotation.set(0, -base.phase * 0.22 + m.elapsed * 0.35, 0);
        m.flameDummy.scale.set(0.78 + t * 0.22, flicker, 0.78 + t * 0.22);
        m.flameDummy.updateMatrix();
        m.flames.setMatrixAt(flameIndex, m.flameDummy.matrix);
      }
      m.flames.instanceMatrix.needsUpdate = true;
    }
    for (let i = this.runes.length - 1; i >= 0; i--) {
      const r = this.runes[i];
      r.elapsed += dt;
      if (r.elapsed >= r.duration) {
        this.scene.remove(r.group);
        for (const mat of r.mats) mat.dispose();
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
        sfx.mat.dispose();
        sfx.points.geometry.dispose();
        this.scene.remove(sfx.ring);
        sfx.ringMat.dispose();
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
