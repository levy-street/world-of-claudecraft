import * as THREE from 'three';
import {
  createNeedleFlightPlan,
  createNeedleImpactPlan,
  createNeedleReleasePlan,
  createNeedleWindupPlan,
  NEEDLE_OF_FATE_IMPACT_SECONDS,
  NEEDLE_OF_FATE_MAX_FLIGHT,
  NEEDLE_OF_FATE_REACH,
  NEEDLE_OF_FATE_RELEASE_SECONDS,
  type NeedleFlightPlan,
  type NeedleImpactPlan,
  type NeedleReleasePlan,
  type NeedleWindupPlan,
  writeNeedleFlightPlan,
  writeNeedleImpactPlan,
  writeNeedleReleasePlan,
  writeNeedleWindupPlan,
} from './needle_of_fate_vfx_core';

const POOL_SIZE = 8;
const TRAIL_POINTS = 18;
const IMPACT_SPARKS = 20;
const UP = new THREE.Vector3(0, 1, 0);

export type NeedleAnchorWriter = (
  entityId: number,
  heightFraction: number,
  out: THREE.Vector3,
) => boolean;

interface WindupSlot {
  active: boolean;
  sourceId: number;
  age: number;
  duration: number;
  group: THREE.Group;
  billboard: THREE.Group;
  eye: THREE.Group;
  runes: THREE.Group | null;
  outerMaterial: THREE.MeshBasicMaterial;
  irisMaterial: THREE.MeshBasicMaterial;
  glowMaterial: THREE.MeshBasicMaterial;
  runeMaterials: THREE.MeshBasicMaterial[];
  anchor: THREE.Vector3;
  plan: NeedleWindupPlan;
}

interface ReleaseSlot {
  active: boolean;
  sourceId: number;
  age: number;
  group: THREE.Group;
  billboard: THREE.Group;
  innerRing: THREE.Mesh;
  outerMaterial: THREE.MeshBasicMaterial;
  innerMaterial: THREE.MeshBasicMaterial;
  flashMaterial: THREE.MeshBasicMaterial;
  anchor: THREE.Vector3;
  plan: NeedleReleasePlan;
}

interface NeedleSlot {
  active: boolean;
  sourceId: number;
  targetId: number;
  age: number;
  ttl: number;
  group: THREE.Group;
  coils: THREE.Group;
  coreMaterial: THREE.MeshBasicMaterial;
  veilMaterial: THREE.MeshBasicMaterial;
  coilMaterial: THREE.MeshBasicMaterial;
  trail: THREE.Mesh;
  trailMaterial: THREE.MeshBasicMaterial;
  trailPositions: Float32Array;
  ribbonGlow: THREE.Mesh | null;
  ribbonGlowMaterial: THREE.MeshBasicMaterial | null;
  ribbonGlowPositions: Float32Array | null;
  history: Float32Array;
  target: THREE.Vector3;
  direction: THREE.Vector3;
  plan: NeedleFlightPlan;
}

interface ImpactSlot {
  active: boolean;
  targetId: number;
  age: number;
  group: THREE.Group;
  billboard: THREE.Group;
  eye: THREE.Group;
  iris: THREE.Mesh;
  shockwave: THREE.Group;
  shockwaveInner: THREE.Mesh;
  pillar: THREE.Mesh | null;
  sparks: THREE.Points | null;
  sparkPositions: Float32Array | null;
  sparkDirections: Float32Array | null;
  outerMaterial: THREE.MeshBasicMaterial;
  irisMaterial: THREE.MeshBasicMaterial;
  lashMaterial: THREE.LineBasicMaterial;
  flashMaterial: THREE.MeshBasicMaterial;
  shockwaveMaterial: THREE.MeshBasicMaterial;
  shockwaveInnerMaterial: THREE.MeshBasicMaterial;
  pillarMaterial: THREE.MeshBasicMaterial | null;
  sparkMaterial: THREE.PointsMaterial | null;
  target: THREE.Vector3;
  plan: NeedleImpactPlan;
}

interface RibbonGeometry {
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
}

function color(hex: number, intensity: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(intensity);
}

function softDiscTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const alpha = Math.max(0, 1 - Math.hypot(dx, dy) * 2);
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(alpha * alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function eyeLashGeometry(count = 20): THREE.BufferGeometry {
  const vertices: number[] = [];
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * Math.PI * 2;
    const innerX = Math.cos(angle) * 0.66;
    const innerY = Math.sin(angle) * 0.36;
    const length = index % 2 === 0 ? 0.32 : 0.2;
    vertices.push(
      innerX,
      innerY,
      0,
      innerX + Math.cos(angle) * length,
      innerY + Math.sin(angle) * length,
      0,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

function ribbonGeometry(points: number): RibbonGeometry {
  const positions = new Float32Array(points * 2 * 3);
  const indices: number[] = [];
  for (let index = 0; index < points - 1; index++) {
    const a = index * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3);
  position.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setIndex(indices);
  return { geometry, positions };
}

/**
 * PBE-style spectacle for Affliction's repeatable Needle of Fate cast.
 * All primitive families are prebuilt and pooled; gameplay remains authoritative in the sim.
 */
export class NeedleOfFateVfx {
  readonly group = new THREE.Group();
  private readonly windups: WindupSlot[] = [];
  private readonly releases: ReleaseSlot[] = [];
  private readonly needles: NeedleSlot[] = [];
  private readonly impacts: ImpactSlot[] = [];
  private windupCursor = 0;
  private releaseCursor = 0;
  private needleCursor = 0;
  private impactCursor = 0;
  private readonly spawnPoint = new THREE.Vector3();
  private readonly sourceProbe = new THREE.Vector3();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly anchor: NeedleAnchorWriter,
    private readonly lowDetail = false,
    private readonly onImpact?: (targetId: number) => void,
  ) {
    this.group.name = 'needle-of-fate-vfx';
    this.group.userData.renderCategory = 'vfx';
    scene.add(this.group);

    const glowTexture = softDiscTexture();
    const eyeOuter = new THREE.RingGeometry(0.5, 0.59, 48);
    const eyeIris = new THREE.RingGeometry(0.15, 0.25, 36);
    const eyeFlash = new THREE.CircleGeometry(0.42, 32);
    const lashes = eyeLashGeometry();
    const rune = new THREE.TorusGeometry(0.14, 0.022, 6, 4).rotateZ(Math.PI / 4);
    const core = new THREE.ConeGeometry(0.15, 2.15, 8, 1);
    const veil = new THREE.ConeGeometry(0.34, 2.65, 12, 1, true);
    const coil = new THREE.TorusGeometry(0.31, 0.028, 7, 24).rotateX(Math.PI / 2);
    const releaseOuter = new THREE.RingGeometry(0.48, 0.58, 48);
    const releaseInner = new THREE.RingGeometry(0.22, 0.29, 36);
    const shockwave = new THREE.TorusGeometry(0.66, 0.055, 8, 48).rotateX(Math.PI / 2);
    const shockwaveInner = new THREE.TorusGeometry(0.35, 0.035, 7, 36).rotateX(Math.PI / 2);
    const pillar = new THREE.CylinderGeometry(0.16, 0.78, 4.2, 16, 1, true);

    for (let index = 0; index < POOL_SIZE; index++) {
      this.windups.push(this.buildWindup(index, eyeOuter, eyeIris, eyeFlash, rune));
      this.releases.push(this.buildRelease(index, releaseOuter, releaseInner, eyeFlash));
      this.needles.push(this.buildNeedle(index, core, veil, coil));
      this.impacts.push(
        this.buildImpact(
          index,
          eyeOuter,
          eyeIris,
          eyeFlash,
          lashes,
          shockwave,
          shockwaveInner,
          pillar,
          glowTexture,
        ),
      );
    }
  }

  private buildWindup(
    index: number,
    outerGeometry: THREE.BufferGeometry,
    irisGeometry: THREE.BufferGeometry,
    flashGeometry: THREE.BufferGeometry,
    runeGeometry: THREE.BufferGeometry,
  ): WindupSlot {
    const group = new THREE.Group();
    group.name = `needle-of-fate-windup-${index}`;
    group.visible = false;
    const billboard = new THREE.Group();
    const eye = new THREE.Group();
    eye.name = `needle-of-fate-windup-eye-${index}`;
    const outerMaterial = new THREE.MeshBasicMaterial({
      color: color(0xc35cff, 2.8),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const irisMaterial = new THREE.MeshBasicMaterial({
      color: color(0x59ff9c, 3.1),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: color(0x7220bd, 2),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const outer = new THREE.Mesh(outerGeometry, outerMaterial);
    outer.name = `needle-of-fate-windup-outer-${index}`;
    const iris = new THREE.Mesh(irisGeometry, irisMaterial);
    iris.name = `needle-of-fate-windup-iris-${index}`;
    iris.position.z = 0.02;
    const glow = new THREE.Mesh(flashGeometry, glowMaterial);
    glow.name = `needle-of-fate-windup-glow-${index}`;
    glow.scale.set(1.8, 1.05, 1);
    glow.position.z = -0.01;
    eye.add(glow, outer, iris);
    billboard.add(eye);

    let runes: THREE.Group | null = null;
    const runeMaterials: THREE.MeshBasicMaterial[] = [];
    if (!this.lowDetail) {
      runes = new THREE.Group();
      runes.name = `needle-of-fate-windup-runes-${index}`;
      for (let runeIndex = 0; runeIndex < 4; runeIndex++) {
        const material = new THREE.MeshBasicMaterial({
          color: color(runeIndex % 2 === 0 ? 0x68ffa3 : 0xd986ff, 2.3),
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(runeGeometry, material);
        const angle = (runeIndex / 4) * Math.PI * 2;
        mesh.position.set(Math.cos(angle) * 0.95, Math.sin(angle) * 0.56, 0.03);
        mesh.rotation.z = angle;
        runes.add(mesh);
        runeMaterials.push(material);
      }
      billboard.add(runes);
    }
    group.add(billboard);
    this.group.add(group);
    return {
      active: false,
      sourceId: -1,
      age: 0,
      duration: 1.5,
      group,
      billboard,
      eye,
      runes,
      outerMaterial,
      irisMaterial,
      glowMaterial,
      runeMaterials,
      anchor: new THREE.Vector3(),
      plan: createNeedleWindupPlan(),
    };
  }

  private buildRelease(
    index: number,
    outerGeometry: THREE.BufferGeometry,
    innerGeometry: THREE.BufferGeometry,
    flashGeometry: THREE.BufferGeometry,
  ): ReleaseSlot {
    const group = new THREE.Group();
    group.name = `needle-of-fate-release-${index}`;
    group.visible = false;
    const billboard = new THREE.Group();
    const outerMaterial = new THREE.MeshBasicMaterial({
      color: color(0xa844ff, 3),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const innerMaterial = new THREE.MeshBasicMaterial({
      color: color(0x69ff9e, 3.2),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: color(0xe8c7ff, 2.5),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const outer = new THREE.Mesh(outerGeometry, outerMaterial);
    outer.name = `needle-of-fate-release-outer-${index}`;
    const innerRing = new THREE.Mesh(innerGeometry, innerMaterial);
    innerRing.name = `needle-of-fate-release-inner-${index}`;
    innerRing.position.z = 0.02;
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.name = `needle-of-fate-release-flash-${index}`;
    flash.position.z = -0.01;
    billboard.add(flash, outer, innerRing);
    group.add(billboard);
    this.group.add(group);
    return {
      active: false,
      sourceId: -1,
      age: 0,
      group,
      billboard,
      innerRing,
      outerMaterial,
      innerMaterial,
      flashMaterial,
      anchor: new THREE.Vector3(),
      plan: createNeedleReleasePlan(),
    };
  }

  private buildNeedle(
    index: number,
    coreGeometry: THREE.BufferGeometry,
    veilGeometry: THREE.BufferGeometry,
    coilGeometry: THREE.BufferGeometry,
  ): NeedleSlot {
    const group = new THREE.Group();
    group.name = `needle-of-fate-projectile-${index}`;
    group.visible = false;
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: color(0xf3ddff, this.lowDetail ? 1.5 : 3.4),
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const veilMaterial = new THREE.MeshBasicMaterial({
      color: color(0x8e2be2, this.lowDetail ? 1.2 : 2.4),
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const coilMaterial = new THREE.MeshBasicMaterial({
      color: color(0x5dff9e, this.lowDetail ? 1.5 : 2.8),
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.name = `needle-of-fate-core-${index}`;
    group.add(core);
    if (!this.lowDetail) {
      const veil = new THREE.Mesh(veilGeometry, veilMaterial);
      veil.name = `needle-of-fate-veil-${index}`;
      group.add(veil);
    }
    const coils = new THREE.Group();
    coils.name = `needle-of-fate-coils-${index}`;
    const coilCount = this.lowDetail ? 1 : 3;
    for (let coilIndex = 0; coilIndex < coilCount; coilIndex++) {
      const ring = new THREE.Mesh(coilGeometry, coilMaterial);
      ring.position.y = 0.62 - coilIndex * 0.62;
      ring.scale.setScalar(1 - coilIndex * 0.16);
      ring.rotation.y = coilIndex * 0.8;
      coils.add(ring);
    }
    group.add(coils);

    const coreRibbon = ribbonGeometry(TRAIL_POINTS);
    const trailMaterial = new THREE.MeshBasicMaterial({
      color: color(0xe5b8ff, this.lowDetail ? 1.5 : 2.8),
      transparent: true,
      opacity: 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const trail = new THREE.Mesh(coreRibbon.geometry, trailMaterial);
    trail.name = `needle-of-fate-trail-${index}`;
    trail.visible = false;
    trail.frustumCulled = false;
    this.group.add(group, trail);

    let ribbonGlow: THREE.Mesh | null = null;
    let ribbonGlowMaterial: THREE.MeshBasicMaterial | null = null;
    let ribbonGlowPositions: Float32Array | null = null;
    if (!this.lowDetail) {
      const glowRibbon = ribbonGeometry(TRAIL_POINTS);
      ribbonGlowPositions = glowRibbon.positions;
      ribbonGlowMaterial = new THREE.MeshBasicMaterial({
        color: color(0x751dc4, 2.5),
        transparent: true,
        opacity: 0.46,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      ribbonGlow = new THREE.Mesh(glowRibbon.geometry, ribbonGlowMaterial);
      ribbonGlow.name = `needle-of-fate-ribbon-glow-${index}`;
      ribbonGlow.visible = false;
      ribbonGlow.frustumCulled = false;
      this.group.add(ribbonGlow);
    }
    return {
      active: false,
      sourceId: -1,
      targetId: -1,
      age: 0,
      ttl: 0,
      group,
      coils,
      coreMaterial,
      veilMaterial,
      coilMaterial,
      trail,
      trailMaterial,
      trailPositions: coreRibbon.positions,
      ribbonGlow,
      ribbonGlowMaterial,
      ribbonGlowPositions,
      history: new Float32Array(TRAIL_POINTS * 3),
      target: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      plan: createNeedleFlightPlan(),
    };
  }

  private buildImpact(
    index: number,
    outerGeometry: THREE.BufferGeometry,
    irisGeometry: THREE.BufferGeometry,
    flashGeometry: THREE.BufferGeometry,
    lashesGeometry: THREE.BufferGeometry,
    shockwaveGeometry: THREE.BufferGeometry,
    shockwaveInnerGeometry: THREE.BufferGeometry,
    pillarGeometry: THREE.BufferGeometry,
    glowTexture: THREE.Texture,
  ): ImpactSlot {
    const group = new THREE.Group();
    group.name = `needle-of-fate-impact-${index}`;
    group.visible = false;
    const billboard = new THREE.Group();
    const eye = new THREE.Group();
    eye.name = `needle-of-fate-impact-eye-${index}`;
    const outerMaterial = new THREE.MeshBasicMaterial({
      color: color(0xc05aff, 3.1),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const irisMaterial = new THREE.MeshBasicMaterial({
      color: color(0x67ff9f, 3.4),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const lashMaterial = new THREE.LineBasicMaterial({
      color: color(0xf0d2ff, 2.8),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: color(0xc989ff, 2.1),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const outer = new THREE.Mesh(outerGeometry, outerMaterial);
    outer.name = `needle-of-fate-impact-outer-${index}`;
    const iris = new THREE.Mesh(irisGeometry, irisMaterial);
    iris.name = `needle-of-fate-impact-iris-${index}`;
    iris.position.z = 0.025;
    const lashes = new THREE.LineSegments(lashesGeometry, lashMaterial);
    lashes.name = `needle-of-fate-lashes-${index}`;
    lashes.position.z = 0.04;
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.name = `needle-of-fate-flash-${index}`;
    flash.scale.set(2.1, 1.25, 1);
    flash.position.z = -0.02;
    eye.add(outer, iris);
    if (!this.lowDetail) eye.add(flash, lashes);
    billboard.add(eye);
    group.add(billboard);

    const shockwaveMaterial = new THREE.MeshBasicMaterial({
      color: color(0x9c3cff, this.lowDetail ? 1.3 : 2.6),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shockwaveInnerMaterial = new THREE.MeshBasicMaterial({
      color: color(0x59ff9a, this.lowDetail ? 1.4 : 2.8),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shockwave = new THREE.Group();
    shockwave.name = `needle-of-fate-shockwave-${index}`;
    const shockwaveOuter = new THREE.Mesh(shockwaveGeometry, shockwaveMaterial);
    shockwaveOuter.name = `needle-of-fate-shockwave-outer-${index}`;
    const shockwaveInner = new THREE.Mesh(shockwaveInnerGeometry, shockwaveInnerMaterial);
    shockwaveInner.name = `needle-of-fate-shockwave-inner-${index}`;
    shockwave.add(shockwaveOuter, shockwaveInner);
    group.add(shockwave);

    let pillar: THREE.Mesh | null = null;
    let pillarMaterial: THREE.MeshBasicMaterial | null = null;
    let sparks: THREE.Points | null = null;
    let sparkMaterial: THREE.PointsMaterial | null = null;
    let sparkPositions: Float32Array | null = null;
    let sparkDirections: Float32Array | null = null;
    if (!this.lowDetail) {
      pillarMaterial = new THREE.MeshBasicMaterial({
        color: color(0x7421a8, 1.8),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
      pillar.name = `needle-of-fate-pillar-${index}`;
      pillar.position.y = 1.1;
      group.add(pillar);

      sparkPositions = new Float32Array(IMPACT_SPARKS * 3);
      sparkDirections = new Float32Array(IMPACT_SPARKS * 3);
      for (let sparkIndex = 0; sparkIndex < IMPACT_SPARKS; sparkIndex++) {
        const angle = (sparkIndex / IMPACT_SPARKS) * Math.PI * 2;
        const offset = sparkIndex * 3;
        sparkDirections[offset] = Math.cos(angle);
        sparkDirections[offset + 1] = 0.15 + ((sparkIndex * 7) % 11) / 8;
        sparkDirections[offset + 2] = Math.sin(angle);
      }
      const sparkGeometry = new THREE.BufferGeometry();
      const position = new THREE.BufferAttribute(sparkPositions, 3);
      position.setUsage(THREE.DynamicDrawUsage);
      sparkGeometry.setAttribute('position', position);
      sparkMaterial = new THREE.PointsMaterial({
        color: color(0xdca2ff, 3.8),
        map: glowTexture,
        size: 0.34,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      sparks = new THREE.Points(sparkGeometry, sparkMaterial);
      sparks.name = `needle-of-fate-impact-sparks-${index}`;
      sparks.frustumCulled = false;
      group.add(sparks);
    }
    this.group.add(group);
    return {
      active: false,
      targetId: -1,
      age: 0,
      group,
      billboard,
      eye,
      iris,
      shockwave,
      shockwaveInner,
      pillar,
      sparks,
      sparkPositions,
      sparkDirections,
      outerMaterial,
      irisMaterial,
      lashMaterial,
      flashMaterial,
      shockwaveMaterial,
      shockwaveInnerMaterial,
      pillarMaterial,
      sparkMaterial,
      target: new THREE.Vector3(),
      plan: createNeedleImpactPlan(),
    };
  }

  beginCast(sourceId: number, duration: number): void {
    this.endCast(sourceId);
    const slot =
      this.windups.find((candidate) => !candidate.active) ?? this.windups[this.windupCursor];
    this.windupCursor = (this.windupCursor + 1) % this.windups.length;
    slot.active = true;
    slot.sourceId = sourceId;
    slot.age = 0;
    slot.duration = Math.max(0.05, duration);
    slot.group.visible = true;
  }

  endCast(sourceId: number): void {
    for (const slot of this.windups) {
      if (slot.active && slot.sourceId === sourceId) {
        slot.active = false;
        slot.group.visible = false;
      }
    }
  }

  spawn(sourceId: number, targetId: number): void {
    if (!this.anchor(sourceId, 0.64, this.spawnPoint)) return;
    this.endCast(sourceId);
    this.openRelease(sourceId, this.spawnPoint);
    const slot = this.needles[this.needleCursor];
    this.needleCursor = (this.needleCursor + 1) % this.needles.length;
    slot.active = true;
    slot.sourceId = sourceId;
    slot.targetId = targetId;
    slot.age = 0;
    slot.ttl = NEEDLE_OF_FATE_MAX_FLIGHT;
    slot.group.position.copy(this.spawnPoint);
    slot.group.visible = true;
    slot.trail.visible = true;
    if (slot.ribbonGlow) slot.ribbonGlow.visible = true;
    slot.coils.rotation.set(0, 0, 0);
    for (let index = 0; index < TRAIL_POINTS; index++) {
      const offset = index * 3;
      slot.history[offset] = this.spawnPoint.x;
      slot.history[offset + 1] = this.spawnPoint.y;
      slot.history[offset + 2] = this.spawnPoint.z;
    }
    this.writeRibbon(slot);
  }

  private openRelease(sourceId: number, position: THREE.Vector3): void {
    const slot = this.releases[this.releaseCursor];
    this.releaseCursor = (this.releaseCursor + 1) % this.releases.length;
    slot.active = true;
    slot.sourceId = sourceId;
    slot.age = 0;
    slot.anchor.copy(position);
    slot.group.position.copy(position);
    slot.group.visible = true;
    slot.outerMaterial.opacity = 0;
    slot.innerMaterial.opacity = 0;
    slot.flashMaterial.opacity = 0;
  }

  update(dt: number, reducedMotion = false): void {
    for (const windup of this.windups) this.updateWindup(windup, dt, reducedMotion);
    for (const release of this.releases) this.updateRelease(release, dt, reducedMotion);
    for (const needle of this.needles) this.updateNeedle(needle, dt, reducedMotion);
    for (const impact of this.impacts) this.updateImpact(impact, dt, reducedMotion);
  }

  private updateWindup(slot: WindupSlot, dt: number, reducedMotion: boolean): void {
    if (!slot.active) return;
    slot.age += dt;
    writeNeedleWindupPlan(slot.plan, slot.age, slot.duration, reducedMotion);
    if (!slot.plan.visible || !this.anchor(slot.sourceId, 0.72, slot.anchor)) {
      slot.active = false;
      slot.group.visible = false;
      return;
    }
    slot.group.position.copy(slot.anchor);
    slot.billboard.quaternion.copy(this.camera.quaternion);
    slot.eye.scale.set(slot.plan.eyeScale * 1.45, slot.plan.eyeScale * 0.82, 1);
    slot.outerMaterial.opacity = slot.plan.opacity * 0.9;
    slot.irisMaterial.opacity = slot.plan.opacity;
    slot.glowMaterial.opacity = slot.plan.opacity * 0.42;
    if (slot.runes) {
      slot.runes.rotation.z = slot.plan.orbit;
      slot.runes.position.y = slot.plan.runeLift * 0.22;
      slot.runes.scale.setScalar(slot.plan.pulse);
      for (const material of slot.runeMaterials) material.opacity = slot.plan.opacity * 0.78;
    }
  }

  private updateRelease(slot: ReleaseSlot, dt: number, reducedMotion: boolean): void {
    if (!slot.active) return;
    slot.age += dt;
    writeNeedleReleasePlan(slot.plan, slot.age, reducedMotion);
    if (
      !slot.plan.visible ||
      slot.age >= NEEDLE_OF_FATE_RELEASE_SECONDS ||
      !this.anchor(slot.sourceId, 0.64, slot.anchor)
    ) {
      slot.active = false;
      slot.group.visible = false;
      return;
    }
    slot.group.position.copy(slot.anchor);
    slot.billboard.quaternion.copy(this.camera.quaternion);
    slot.billboard.rotation.z = slot.plan.rotation;
    slot.billboard.scale.setScalar(slot.plan.ringScale);
    slot.innerRing.rotation.z = -slot.plan.rotation * 1.4;
    slot.outerMaterial.opacity = slot.plan.opacity * 0.82;
    slot.innerMaterial.opacity = slot.plan.opacity;
    slot.flashMaterial.opacity = slot.plan.opacity * 0.34;
  }

  private updateNeedle(slot: NeedleSlot, dt: number, reducedMotion: boolean): void {
    if (!slot.active) return;
    slot.age += dt;
    slot.ttl -= dt;
    if (
      !this.anchor(slot.sourceId, 0.64, this.sourceProbe) ||
      !this.anchor(slot.targetId, 0.55, slot.target)
    ) {
      this.hideNeedle(slot);
      return;
    }
    if (slot.ttl <= 0) {
      this.openImpact(slot.targetId, slot.target);
      this.hideNeedle(slot);
      return;
    }
    slot.direction.copy(slot.target).sub(slot.group.position);
    const distance = slot.direction.length();
    writeNeedleFlightPlan(slot.plan, distance, dt, slot.age, reducedMotion);
    if (distance <= Math.max(NEEDLE_OF_FATE_REACH, slot.plan.step)) {
      this.openImpact(slot.targetId, slot.target);
      this.hideNeedle(slot);
      return;
    }
    slot.direction.multiplyScalar(1 / Math.max(0.0001, distance));
    slot.group.position.addScaledVector(slot.direction, slot.plan.step);
    slot.group.quaternion.setFromUnitVectors(UP, slot.direction);
    slot.coils.rotation.y = slot.plan.spin;
    slot.coils.rotation.z = slot.plan.coil;
    slot.coreMaterial.opacity = 0.9 + slot.plan.glow * 0.08;
    slot.veilMaterial.opacity = 0.24 + slot.plan.glow * 0.1;
    slot.coilMaterial.opacity = 0.68 + slot.plan.glow * 0.12;
    slot.trailMaterial.opacity = 0.72 + slot.plan.glow * 0.12;
    if (slot.ribbonGlowMaterial) {
      slot.ribbonGlowMaterial.opacity = 0.32 + slot.plan.glow * 0.14;
    }
    for (let index = TRAIL_POINTS - 1; index > 0; index--) {
      const offset = index * 3;
      const previous = offset - 3;
      slot.history[offset] = slot.history[previous];
      slot.history[offset + 1] = slot.history[previous + 1];
      slot.history[offset + 2] = slot.history[previous + 2];
    }
    slot.history[0] = slot.group.position.x;
    slot.history[1] = slot.group.position.y;
    slot.history[2] = slot.group.position.z;
    this.writeRibbon(slot);
  }

  private writeRibbon(slot: NeedleSlot): void {
    for (let index = 0; index < TRAIL_POINTS; index++) {
      const historyOffset = index * 3;
      const previous = Math.max(0, index - 1) * 3;
      const next = Math.min(TRAIL_POINTS - 1, index + 1) * 3;
      this.tmpA.set(
        slot.history[next] - slot.history[previous],
        slot.history[next + 1] - slot.history[previous + 1],
        slot.history[next + 2] - slot.history[previous + 2],
      );
      this.tmpB.set(
        this.camera.position.x - slot.history[historyOffset],
        this.camera.position.y - slot.history[historyOffset + 1],
        this.camera.position.z - slot.history[historyOffset + 2],
      );
      this.tmpC.crossVectors(this.tmpA, this.tmpB);
      if (this.tmpC.lengthSq() < 0.00001) this.tmpC.set(1, 0, 0);
      else this.tmpC.normalize();
      const taper = 1 - index / (TRAIL_POINTS - 1);
      const distortion =
        slot.plan.distortion * Math.sin(index * 2.15 + slot.age * 42) * (0.25 + taper * 0.75);
      const centerX = slot.history[historyOffset] + this.tmpC.x * distortion;
      const centerY = slot.history[historyOffset + 1] + this.tmpC.y * distortion;
      const centerZ = slot.history[historyOffset + 2] + this.tmpC.z * distortion;
      this.writeRibbonPair(
        slot.trailPositions,
        index,
        centerX,
        centerY,
        centerZ,
        this.tmpC,
        0.14,
        taper,
      );
      if (slot.ribbonGlowPositions) {
        this.writeRibbonPair(
          slot.ribbonGlowPositions,
          index,
          centerX,
          centerY,
          centerZ,
          this.tmpC,
          0.42,
          taper,
        );
      }
    }
    (slot.trail.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    if (slot.ribbonGlow) {
      (slot.ribbonGlow.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate =
        true;
    }
  }

  private writeRibbonPair(
    positions: Float32Array,
    index: number,
    x: number,
    y: number,
    z: number,
    side: THREE.Vector3,
    width: number,
    taper: number,
  ): void {
    const half = width * (0.16 + taper * 0.84);
    const offset = index * 6;
    positions[offset] = x + side.x * half;
    positions[offset + 1] = y + side.y * half;
    positions[offset + 2] = z + side.z * half;
    positions[offset + 3] = x - side.x * half;
    positions[offset + 4] = y - side.y * half;
    positions[offset + 5] = z - side.z * half;
  }

  private openImpact(targetId: number, position: THREE.Vector3): void {
    const slot = this.impacts[this.impactCursor];
    this.impactCursor = (this.impactCursor + 1) % this.impacts.length;
    slot.active = true;
    slot.targetId = targetId;
    slot.age = 0;
    slot.target.copy(position);
    slot.group.position.copy(position);
    slot.group.visible = true;
    slot.billboard.rotation.z = 0;
    slot.eye.scale.setScalar(1);
    slot.iris.scale.setScalar(1);
    slot.shockwave.scale.setScalar(1);
    slot.outerMaterial.opacity = 0;
    slot.irisMaterial.opacity = 0;
    slot.lashMaterial.opacity = 0;
    slot.flashMaterial.opacity = 0;
    slot.shockwaveMaterial.opacity = 0;
    slot.shockwaveInnerMaterial.opacity = 0;
    if (slot.pillarMaterial) slot.pillarMaterial.opacity = 0;
    if (slot.sparkMaterial) slot.sparkMaterial.opacity = 0;
    this.onImpact?.(targetId);
  }

  private updateImpact(slot: ImpactSlot, dt: number, reducedMotion: boolean): void {
    if (!slot.active) return;
    slot.age += dt;
    writeNeedleImpactPlan(slot.plan, slot.age, reducedMotion);
    if (!slot.plan.visible || slot.age >= NEEDLE_OF_FATE_IMPACT_SECONDS) {
      slot.active = false;
      slot.group.visible = false;
      return;
    }
    if (this.anchor(slot.targetId, 0.56, slot.target)) slot.group.position.copy(slot.target);
    slot.billboard.quaternion.copy(this.camera.quaternion);
    slot.billboard.rotation.z = slot.plan.rotation;
    slot.eye.scale.set(slot.plan.scale * 2.45, slot.plan.scale * 1.28, slot.plan.scale);
    slot.iris.scale.setScalar(slot.plan.irisScale);
    slot.outerMaterial.opacity = slot.plan.opacity * 0.9;
    slot.irisMaterial.opacity = slot.plan.opacity;
    slot.lashMaterial.opacity = slot.plan.opacity;
    slot.flashMaterial.opacity = slot.plan.opacity * 0.46;
    slot.shockwave.scale.setScalar(slot.plan.shockwaveScale);
    slot.shockwave.rotation.y = -slot.plan.rotation;
    slot.shockwaveInner.rotation.y = slot.plan.rotation * 1.7;
    slot.shockwaveMaterial.opacity = slot.plan.shockwaveOpacity * 0.92;
    slot.shockwaveInnerMaterial.opacity = slot.plan.shockwaveOpacity;
    if (slot.pillarMaterial) slot.pillarMaterial.opacity = slot.plan.pillarOpacity * 0.62;
    if (slot.sparks && slot.sparkPositions && slot.sparkDirections && slot.sparkMaterial) {
      for (let index = 0; index < IMPACT_SPARKS; index++) {
        const offset = index * 3;
        const distance = slot.plan.sparkDistance * (0.62 + (index % 5) * 0.09);
        slot.sparkPositions[offset] = slot.sparkDirections[offset] * distance;
        slot.sparkPositions[offset + 1] =
          slot.sparkDirections[offset + 1] * distance - slot.plan.sparkDistance * 0.28;
        slot.sparkPositions[offset + 2] = slot.sparkDirections[offset + 2] * distance;
      }
      (slot.sparks.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      slot.sparkMaterial.opacity = slot.plan.opacity;
      slot.sparkMaterial.size = 0.28 + slot.plan.opacity * 0.34;
    }
  }

  private hideNeedle(slot: NeedleSlot): void {
    slot.active = false;
    slot.group.visible = false;
    slot.trail.visible = false;
    if (slot.ribbonGlow) slot.ribbonGlow.visible = false;
  }

  clear(): void {
    for (const slot of this.windups) {
      slot.active = false;
      slot.group.visible = false;
    }
    for (const slot of this.releases) {
      slot.active = false;
      slot.group.visible = false;
    }
    for (const slot of this.needles) this.hideNeedle(slot);
    for (const slot of this.impacts) {
      slot.active = false;
      slot.group.visible = false;
    }
  }
}
