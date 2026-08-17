import * as THREE from 'three';
import { type AbilityVfxTextures, abilityVfxTextures } from './ability_vfx/fx_textures';
import { AbilityVfxRibbons } from './ability_vfx/ribbons';
import {
  createSentenceBurstPlan,
  createSentenceInvocationPlan,
  SENTENCE_BUILDUP_SECONDS,
  SENTENCE_MARK_SECONDS,
  SENTENCE_TRANSFER_SPEED,
  type SentenceBurstPlan,
  type SentenceInvocationPlan,
  sentenceTransferSeconds,
  writeSentenceBurstPlan,
  writeSentenceInvocationPlan,
} from './sentence_vfx_core';

const POOL_SIZE = 8;
const BASE_SPARK_COUNT = 42;
const MAXIMUM_SPARK_COUNT = 72;
const SOUL_FRAGMENT_COUNT = 24;
const CASTER_WISP_COUNT = 18;
const CURSE_COLOR = 0x551462;

export type SentenceAnchorWriter = (
  entityId: number,
  heightFraction: number,
  out: THREE.Vector3,
) => boolean;

export type SentenceImpactCallback = (
  sourceId: number,
  targetId: number,
  condemnation: number,
) => void;

interface SentenceSlot {
  active: boolean;
  generation: number;
  phase: 'invocation' | 'impact' | 'fizzle';
  sourceId: number;
  targetId: number;
  condemnation: number;
  threadCount: number;
  age: number;
  phaseAge: number;
  travelSeconds: number;
  feedbackFired: boolean;
  sourceGroup: THREE.Group;
  sourceBillboard: THREE.Group;
  sourceCore: THREE.Sprite;
  sourceSeal: THREE.Group;
  sourceWisps: THREE.Points | null;
  sourceWispPositions: Float32Array | null;
  sourceCoreMaterial: THREE.SpriteMaterial;
  sourceSealMaterials: THREE.MeshBasicMaterial[];
  sourceWispMaterial: THREE.PointsMaterial | null;
  group: THREE.Group;
  billboard: THREE.Group;
  vortex: THREE.Mesh;
  eye: THREE.Group;
  iris: THREE.Mesh;
  sigils: THREE.Group | null;
  crown: THREE.Group | null;
  wave: THREE.Mesh;
  secondaryWave: THREE.Mesh | null;
  pillar: THREE.Mesh;
  cataclysmCore: THREE.Mesh;
  detonationFlash: THREE.Sprite;
  cataclysmShell: THREE.Mesh | null;
  starburst: THREE.Mesh | null;
  rupture: THREE.Mesh;
  verticalHalos: THREE.Group | null;
  residue: THREE.Mesh;
  soulFragments: THREE.Points | null;
  sparks: THREE.Points | null;
  sparkPositions: Float32Array | null;
  sparkDirections: Float32Array | null;
  vortexMaterial: THREE.MeshBasicMaterial;
  eyeMaterial: THREE.MeshBasicMaterial;
  irisMaterial: THREE.MeshBasicMaterial;
  pupilMaterial: THREE.MeshBasicMaterial;
  flashMaterial: THREE.MeshBasicMaterial;
  lashMaterial: THREE.LineBasicMaterial;
  sigilMaterials: THREE.MeshBasicMaterial[];
  crownMaterial: THREE.MeshBasicMaterial | null;
  waveMaterial: THREE.MeshBasicMaterial;
  secondaryWaveMaterial: THREE.MeshBasicMaterial | null;
  pillarMaterial: THREE.MeshBasicMaterial;
  cataclysmCoreMaterial: THREE.MeshBasicMaterial;
  detonationFlashMaterial: THREE.SpriteMaterial;
  cataclysmShellMaterial: THREE.MeshBasicMaterial | null;
  starburstMaterial: THREE.MeshBasicMaterial | null;
  ruptureMaterial: THREE.MeshBasicMaterial;
  verticalHaloMaterial: THREE.MeshBasicMaterial | null;
  residueMaterial: THREE.MeshBasicMaterial;
  soulMaterial: THREE.PointsMaterial | null;
  soulPositions: Float32Array | null;
  soulDirections: Float32Array | null;
  sparkMaterial: THREE.PointsMaterial | null;
  sourceAnchor: THREE.Vector3;
  anchor: THREE.Vector3;
  invocationPlan: SentenceInvocationPlan;
  plan: SentenceBurstPlan;
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

function lashGeometry(count = 28): THREE.BufferGeometry {
  const vertices: number[] = [];
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * Math.PI * 2;
    const innerX = Math.cos(angle) * 0.92;
    const innerY = Math.sin(angle) * 0.5;
    const length = index % 2 === 0 ? 0.58 : 0.34;
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

function starburstGeometry(rayCount = 30): THREE.BufferGeometry {
  const vertices: number[] = [];
  const colors: number[] = [];
  const purple = color(0x51205e, 0.75);
  const deepPurple = color(0x32103e, 0.65);
  const up = new THREE.Vector3(0, 1, 0);
  const alternate = new THREE.Vector3(1, 0, 0);
  const direction = new THREE.Vector3();
  const side = new THREE.Vector3();
  const base = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();

  for (let index = 0; index < rayCount; index++) {
    const y = 1 - (index / Math.max(1, rayCount - 1)) * 2;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * 2.399963229728653;
    direction.set(Math.cos(angle) * radial, y, Math.sin(angle) * radial);
    side.crossVectors(direction, Math.abs(direction.y) > 0.9 ? alternate : up).normalize();
    const width = 0.012 + (index % 4) * 0.004;
    const length = 0.8 + (index % 7) * 0.08;
    base.copy(direction).multiplyScalar(0.16);
    tip.copy(direction).multiplyScalar(length);
    left.copy(base).addScaledVector(side, width);
    right.copy(base).addScaledVector(side, -width);
    vertices.push(left.x, left.y, left.z, right.x, right.y, right.z, tip.x, tip.y, tip.z);
    const rayColor = index % 3 === 1 ? deepPurple : purple;
    for (let vertex = 0; vertex < 3; vertex++) {
      colors.push(rayColor.r, rayColor.g, rayColor.b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Affliction's final verdict: one pooled, target-anchored spectacle driven by
 * the authoritative Sentence impact event.
 */
export class SentenceVfx {
  readonly group = new THREE.Group();
  private readonly slots: SentenceSlot[] = [];
  private readonly ribbons: AbilityVfxRibbons;
  private cursor = 0;
  private generation = 0;
  private readonly anchorProbe = new THREE.Vector3();
  private readonly sourceProbe = new THREE.Vector3();
  private readonly ribbonProbes = [new THREE.Vector3(), new THREE.Vector3()];
  private ribbonProbeCursor = 0;

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly anchor: SentenceAnchorWriter,
    private readonly lowDetail = false,
    private readonly onBurst: SentenceImpactCallback,
    injectedTextures?: AbilityVfxTextures,
  ) {
    this.group.name = 'sentence-vfx';
    this.group.userData.renderCategory = 'vfx';
    scene.add(this.group);

    const eyeOuter = new THREE.RingGeometry(0.72, 0.9, 64);
    const eyeIris = new THREE.RingGeometry(0.21, 0.38, 48);
    const pupil = new THREE.CircleGeometry(0.2, 36);
    const flash = new THREE.CircleGeometry(0.82, 48);
    const vortex = new THREE.SphereGeometry(0.82, 24, 14);
    const lashes = lashGeometry();
    const sigil = new THREE.TorusGeometry(1.03, 0.035, 7, 64);
    const crownSpike = new THREE.ConeGeometry(0.12, 1.65, 4, 1);
    const wave = new THREE.TorusGeometry(0.92, 0.085, 9, 64).rotateX(Math.PI / 2);
    const secondaryWave = new THREE.TorusGeometry(0.68, 0.045, 7, 56).rotateX(Math.PI / 2);
    const pillar = new THREE.CylinderGeometry(0.2, 1.15, 6.2, 20, 1, true);
    const cataclysmCore = new THREE.SphereGeometry(1, 28, 16);
    const cataclysmShell = new THREE.IcosahedronGeometry(1, 1);
    const starburst = starburstGeometry();
    const rupture = new THREE.RingGeometry(0.52, 1, 72).rotateX(-Math.PI / 2);
    const verticalHalo = new THREE.TorusGeometry(1, 0.032, 7, 72);
    const sourceSeal = new THREE.TorusGeometry(0.72, 0.025, 6, 48);
    const residue = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const glowTexture = softDiscTexture();
    const textures = injectedTextures ?? abilityVfxTextures();
    this.ribbons = new AbilityVfxRibbons(
      scene,
      (id, heightFraction) => this.ribbonAnchor(id, heightFraction),
      textures,
    );

    for (let index = 0; index < POOL_SIZE; index++) {
      this.slots.push(
        this.buildSlot(
          index,
          eyeOuter,
          eyeIris,
          pupil,
          flash,
          vortex,
          lashes,
          sigil,
          crownSpike,
          wave,
          secondaryWave,
          pillar,
          cataclysmCore,
          cataclysmShell,
          starburst,
          rupture,
          verticalHalo,
          sourceSeal,
          residue,
          glowTexture,
          textures.rune,
        ),
      );
    }
  }

  private ribbonAnchor(entityId: number, heightFraction: number): THREE.Vector3 | null {
    const out = this.ribbonProbes[this.ribbonProbeCursor];
    this.ribbonProbeCursor = (this.ribbonProbeCursor + 1) % this.ribbonProbes.length;
    return this.anchor(entityId, heightFraction, out) ? out : null;
  }

  private buildSlot(
    index: number,
    eyeOuterGeometry: THREE.BufferGeometry,
    eyeIrisGeometry: THREE.BufferGeometry,
    pupilGeometry: THREE.BufferGeometry,
    flashGeometry: THREE.BufferGeometry,
    vortexGeometry: THREE.BufferGeometry,
    lashGeometryValue: THREE.BufferGeometry,
    sigilGeometry: THREE.BufferGeometry,
    crownGeometry: THREE.BufferGeometry,
    waveGeometry: THREE.BufferGeometry,
    secondaryWaveGeometry: THREE.BufferGeometry,
    pillarGeometry: THREE.BufferGeometry,
    cataclysmCoreGeometry: THREE.BufferGeometry,
    cataclysmShellGeometry: THREE.BufferGeometry,
    starburstGeometryValue: THREE.BufferGeometry,
    ruptureGeometry: THREE.BufferGeometry,
    verticalHaloGeometry: THREE.BufferGeometry,
    sourceSealGeometry: THREE.BufferGeometry,
    residueGeometry: THREE.BufferGeometry,
    glowTexture: THREE.Texture,
    runeTexture: THREE.Texture,
  ): SentenceSlot {
    const sourceGroup = new THREE.Group();
    sourceGroup.name = `sentence-vfx-invocation-${index}`;
    sourceGroup.visible = false;
    const sourceBillboard = new THREE.Group();
    sourceBillboard.name = `sentence-vfx-invocation-billboard-${index}`;
    sourceGroup.add(sourceBillboard);

    const sourceCoreMaterial = new THREE.SpriteMaterial({
      color: color(0x6b1b78, this.lowDetail ? 0.55 : 0.72),
      map: glowTexture,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sourceCore = new THREE.Sprite(sourceCoreMaterial);
    sourceCore.name = `sentence-vfx-invocation-core-${index}`;
    sourceBillboard.add(sourceCore);

    const sourceSeal = new THREE.Group();
    sourceSeal.name = `sentence-vfx-invocation-seal-${index}`;
    const sourceSealMaterials: THREE.MeshBasicMaterial[] = [];
    const sourceSealCount = this.lowDetail ? 1 : 3;
    for (let sealIndex = 0; sealIndex < sourceSealCount; sealIndex++) {
      const material = new THREE.MeshBasicMaterial({
        color: color(sealIndex === 1 ? 0x8a245f : 0x51205e, 0.62 + sealIndex * 0.05),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(sourceSealGeometry, material);
      ring.scale.set(1 + sealIndex * 0.25, 0.58 + sealIndex * 0.11, 1);
      ring.rotation.z = sealIndex * 0.82;
      sourceSeal.add(ring);
      sourceSealMaterials.push(material);
    }
    sourceBillboard.add(sourceSeal);

    let sourceWisps: THREE.Points | null = null;
    let sourceWispPositions: Float32Array | null = null;
    let sourceWispMaterial: THREE.PointsMaterial | null = null;
    if (!this.lowDetail) {
      sourceWispPositions = new Float32Array(CASTER_WISP_COUNT * 3);
      const sourceWispGeometry = new THREE.BufferGeometry();
      sourceWispGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(sourceWispPositions, 3).setUsage(THREE.DynamicDrawUsage),
      );
      sourceWispMaterial = new THREE.PointsMaterial({
        color: color(0x6d2a79, 0.72),
        map: glowTexture,
        size: 0.24,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      sourceWisps = new THREE.Points(sourceWispGeometry, sourceWispMaterial);
      sourceWisps.name = `sentence-vfx-invocation-wisps-${index}`;
      sourceWisps.frustumCulled = false;
      sourceGroup.add(sourceWisps);
    }

    const group = new THREE.Group();
    group.name = `sentence-vfx-burst-${index}`;
    group.visible = false;

    const vortexMaterial = new THREE.MeshBasicMaterial({
      color: color(0x0c0710, 1),
      transparent: true,
      opacity: 0,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const vortex = new THREE.Mesh(vortexGeometry, vortexMaterial);
    vortex.name = `sentence-vfx-vortex-${index}`;
    vortex.position.y = 1.35;
    group.add(vortex);

    const billboard = new THREE.Group();
    billboard.position.y = 1.42;
    const eye = new THREE.Group();
    eye.name = `sentence-vfx-eye-${index}`;
    const eyeMaterial = new THREE.MeshBasicMaterial({
      color: color(0x592069, this.lowDetail ? 0.65 : 0.75),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const irisMaterial = new THREE.MeshBasicMaterial({
      color: color(0x8fa94d, this.lowDetail ? 0.68 : 0.8),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const pupilMaterial = new THREE.MeshBasicMaterial({
      color: color(0x020104, 1),
      transparent: true,
      opacity: 0,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: color(0x32103e, this.lowDetail ? 0.5 : 0.65),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const eyeOuter = new THREE.Mesh(eyeOuterGeometry, eyeMaterial);
    eyeOuter.name = `sentence-vfx-eye-outer-${index}`;
    const iris = new THREE.Mesh(eyeIrisGeometry, irisMaterial);
    iris.name = `sentence-vfx-iris-${index}`;
    iris.position.z = 0.04;
    const pupilMesh = new THREE.Mesh(pupilGeometry, pupilMaterial);
    pupilMesh.name = `sentence-vfx-pupil-${index}`;
    pupilMesh.position.z = 0.06;
    const flashMesh = new THREE.Mesh(flashGeometry, flashMaterial);
    flashMesh.name = `sentence-vfx-flash-${index}`;
    flashMesh.scale.set(1.8, 1.03, 1);
    flashMesh.position.z = -0.03;
    eye.add(flashMesh, eyeOuter, iris, pupilMesh);

    const lashMaterial = new THREE.LineBasicMaterial({
      color: color(0x74317f, 0.75),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    if (!this.lowDetail) {
      const lash = new THREE.LineSegments(lashGeometryValue, lashMaterial);
      lash.name = `sentence-vfx-lashes-${index}`;
      lash.position.z = 0.08;
      eye.add(lash);
    }
    billboard.add(eye);

    let sigils: THREE.Group | null = null;
    const sigilMaterials: THREE.MeshBasicMaterial[] = [];
    if (!this.lowDetail) {
      sigils = new THREE.Group();
      sigils.name = `sentence-vfx-sigils-${index}`;
      for (let sigilIndex = 0; sigilIndex < 3; sigilIndex++) {
        const material = new THREE.MeshBasicMaterial({
          color: color(sigilIndex === 1 ? 0x32103e : 0x54185f, sigilIndex === 1 ? 0.65 : 0.75),
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(sigilGeometry, material);
        ring.scale.set(1 + sigilIndex * 0.3, 0.54 + sigilIndex * 0.08, 1);
        ring.rotation.z = sigilIndex * 0.72;
        sigils.add(ring);
        sigilMaterials.push(material);
      }
      billboard.add(sigils);
    }

    let crown: THREE.Group | null = null;
    let crownMaterial: THREE.MeshBasicMaterial | null = null;
    if (!this.lowDetail) {
      crown = new THREE.Group();
      crown.name = `sentence-vfx-crown-${index}`;
      crownMaterial = new THREE.MeshBasicMaterial({
        color: color(0x713082, 0.8),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      for (let spikeIndex = 0; spikeIndex < 14; spikeIndex++) {
        const angle = (spikeIndex / 14) * Math.PI * 2;
        const spike = new THREE.Mesh(crownGeometry, crownMaterial);
        spike.position.set(Math.cos(angle) * 1.18, Math.sin(angle) * 0.64, -0.04);
        spike.rotation.z = angle - Math.PI / 2;
        spike.scale.y = spikeIndex % 2 === 0 ? 1 : 0.7;
        crown.add(spike);
      }
      billboard.add(crown);
    }
    group.add(billboard);

    const waveMaterial = new THREE.MeshBasicMaterial({
      color: color(0x491554, this.lowDetail ? 0.72 : 0.8),
      transparent: true,
      opacity: 0,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const wave = new THREE.Mesh(waveGeometry, waveMaterial);
    wave.name = `sentence-vfx-wave-${index}`;
    wave.position.y = 0.08;
    group.add(wave);

    let secondaryWave: THREE.Mesh | null = null;
    let secondaryWaveMaterial: THREE.MeshBasicMaterial | null = null;
    if (!this.lowDetail) {
      secondaryWaveMaterial = new THREE.MeshBasicMaterial({
        color: color(0x32103e, 0.65),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      secondaryWave = new THREE.Mesh(secondaryWaveGeometry, secondaryWaveMaterial);
      secondaryWave.name = `sentence-vfx-wave-secondary-${index}`;
      secondaryWave.position.y = 0.12;
      group.add(secondaryWave);
    }

    const pillarMaterial = new THREE.MeshBasicMaterial({
      color: color(0x1c0824, this.lowDetail ? 0.65 : 0.8),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.name = `sentence-vfx-pillar-${index}`;
    pillar.position.y = 2.2;
    group.add(pillar);

    const cataclysmCoreMaterial = new THREE.MeshBasicMaterial({
      color: color(0x050308, 1),
      transparent: true,
      opacity: 0,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const cataclysmCore = new THREE.Mesh(cataclysmCoreGeometry, cataclysmCoreMaterial);
    cataclysmCore.name = `sentence-vfx-cataclysm-core-${index}`;
    cataclysmCore.position.y = 1.35;
    cataclysmCore.visible = false;
    group.add(cataclysmCore);

    const detonationFlashMaterial = new THREE.SpriteMaterial({
      color: color(0x5d1d70, this.lowDetail ? 0.65 : 0.8),
      map: glowTexture,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const detonationFlash = new THREE.Sprite(detonationFlashMaterial);
    detonationFlash.name = `sentence-vfx-detonation-flash-${index}`;
    detonationFlash.position.y = 1.35;
    detonationFlash.visible = false;
    group.add(detonationFlash);

    let cataclysmShell: THREE.Mesh | null = null;
    let cataclysmShellMaterial: THREE.MeshBasicMaterial | null = null;
    let starburst: THREE.Mesh | null = null;
    let starburstMaterial: THREE.MeshBasicMaterial | null = null;
    let verticalHalos: THREE.Group | null = null;
    let verticalHaloMaterial: THREE.MeshBasicMaterial | null = null;
    if (!this.lowDetail) {
      cataclysmShellMaterial = new THREE.MeshBasicMaterial({
        color: color(0x4f185c, 0.68),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        wireframe: true,
      });
      cataclysmShell = new THREE.Mesh(cataclysmShellGeometry, cataclysmShellMaterial);
      cataclysmShell.name = `sentence-vfx-cataclysm-shell-${index}`;
      cataclysmShell.position.y = 1.35;
      cataclysmShell.visible = false;
      group.add(cataclysmShell);

      starburstMaterial = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      starburst = new THREE.Mesh(starburstGeometryValue, starburstMaterial);
      starburst.name = `sentence-vfx-starburst-${index}`;
      starburst.position.y = 1.35;
      starburst.visible = false;
      group.add(starburst);

      verticalHaloMaterial = new THREE.MeshBasicMaterial({
        color: color(0x43164d, 0.65),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      verticalHalos = new THREE.Group();
      verticalHalos.name = `sentence-vfx-vertical-halos-${index}`;
      verticalHalos.position.y = 1.35;
      verticalHalos.visible = false;
      for (let haloIndex = 0; haloIndex < 3; haloIndex++) {
        const halo = new THREE.Mesh(verticalHaloGeometry, verticalHaloMaterial);
        if (haloIndex === 0) {
          halo.rotation.y = Math.PI / 2;
        } else if (haloIndex === 1) {
          halo.rotation.x = Math.PI / 2;
        } else {
          halo.rotation.set(0.72, 0.48, 0.35);
        }
        verticalHalos.add(halo);
      }
      group.add(verticalHalos);
    }

    const ruptureMaterial = new THREE.MeshBasicMaterial({
      color: color(0x4e145e, this.lowDetail ? 0.65 : 0.8),
      transparent: true,
      opacity: 0,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const rupture = new THREE.Mesh(ruptureGeometry, ruptureMaterial);
    rupture.name = `sentence-vfx-rupture-${index}`;
    rupture.position.y = 0.045;
    rupture.visible = false;
    group.add(rupture);

    const residueMaterial = new THREE.MeshBasicMaterial({
      color: color(0x481150, this.lowDetail ? 0.5 : 0.68),
      map: runeTexture,
      transparent: true,
      opacity: 0,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const residue = new THREE.Mesh(residueGeometry, residueMaterial);
    residue.name = `sentence-vfx-residue-${index}`;
    residue.position.y = 0.055;
    residue.visible = false;
    group.add(residue);

    let soulFragments: THREE.Points | null = null;
    let soulMaterial: THREE.PointsMaterial | null = null;
    let soulPositions: Float32Array | null = null;
    let soulDirections: Float32Array | null = null;
    if (!this.lowDetail) {
      soulPositions = new Float32Array(SOUL_FRAGMENT_COUNT * 3);
      soulDirections = new Float32Array(SOUL_FRAGMENT_COUNT * 3);
      for (let soulIndex = 0; soulIndex < SOUL_FRAGMENT_COUNT; soulIndex++) {
        const angle = (soulIndex / SOUL_FRAGMENT_COUNT) * Math.PI * 2 + (soulIndex % 3) * 0.31;
        const offset = soulIndex * 3;
        soulDirections[offset] = Math.cos(angle) * (0.42 + (soulIndex % 5) * 0.08);
        soulDirections[offset + 1] = 0.55 + ((soulIndex * 7) % 11) / 8;
        soulDirections[offset + 2] = Math.sin(angle) * (0.42 + (soulIndex % 5) * 0.08);
      }
      const soulGeometry = new THREE.BufferGeometry();
      soulGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(soulPositions, 3).setUsage(THREE.DynamicDrawUsage),
      );
      soulMaterial = new THREE.PointsMaterial({
        color: color(0x7a2f83, 0.7),
        map: glowTexture,
        size: 0.34,
        transparent: true,
        opacity: 0,
        blending: THREE.NormalBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      soulFragments = new THREE.Points(soulGeometry, soulMaterial);
      soulFragments.name = `sentence-vfx-soul-fragments-${index}`;
      soulFragments.position.y = 0.22;
      soulFragments.frustumCulled = false;
      group.add(soulFragments);
    }

    let sparks: THREE.Points | null = null;
    let sparkMaterial: THREE.PointsMaterial | null = null;
    let sparkPositions: Float32Array | null = null;
    let sparkDirections: Float32Array | null = null;
    if (!this.lowDetail) {
      sparkPositions = new Float32Array(MAXIMUM_SPARK_COUNT * 3);
      sparkDirections = new Float32Array(MAXIMUM_SPARK_COUNT * 3);
      for (let sparkIndex = 0; sparkIndex < MAXIMUM_SPARK_COUNT; sparkIndex++) {
        const angle =
          sparkIndex < BASE_SPARK_COUNT
            ? (sparkIndex / BASE_SPARK_COUNT) * Math.PI * 2
            : ((sparkIndex - BASE_SPARK_COUNT + 0.5) / (MAXIMUM_SPARK_COUNT - BASE_SPARK_COUNT)) *
              Math.PI *
              2;
        const offset = sparkIndex * 3;
        sparkDirections[offset] = Math.cos(angle);
        sparkDirections[offset + 1] = 0.12 + ((sparkIndex * 11) % 17) / 9;
        sparkDirections[offset + 2] = Math.sin(angle);
      }
      const sparkGeometry = new THREE.BufferGeometry();
      const position = new THREE.BufferAttribute(sparkPositions, 3);
      position.setUsage(THREE.DynamicDrawUsage);
      sparkGeometry.setAttribute('position', position);
      sparkMaterial = new THREE.PointsMaterial({
        color: color(0x6d3a79, 0.85),
        map: glowTexture,
        size: 0.42,
        transparent: true,
        opacity: 0,
        blending: THREE.NormalBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      sparks = new THREE.Points(sparkGeometry, sparkMaterial);
      sparks.name = `sentence-vfx-sparks-${index}`;
      sparks.frustumCulled = false;
      group.add(sparks);
    }

    this.group.add(sourceGroup, group);
    return {
      active: false,
      generation: 0,
      phase: 'invocation',
      sourceId: -1,
      targetId: -1,
      condemnation: 20,
      threadCount: 0,
      age: 0,
      phaseAge: 0,
      travelSeconds: 0,
      feedbackFired: false,
      sourceGroup,
      sourceBillboard,
      sourceCore,
      sourceSeal,
      sourceWisps,
      sourceWispPositions,
      sourceCoreMaterial,
      sourceSealMaterials,
      sourceWispMaterial,
      group,
      billboard,
      vortex,
      eye,
      iris,
      sigils,
      crown,
      wave,
      secondaryWave,
      pillar,
      cataclysmCore,
      detonationFlash,
      cataclysmShell,
      starburst,
      rupture,
      verticalHalos,
      residue,
      soulFragments,
      sparks,
      sparkPositions,
      sparkDirections,
      vortexMaterial,
      eyeMaterial,
      irisMaterial,
      pupilMaterial,
      flashMaterial,
      lashMaterial,
      sigilMaterials,
      crownMaterial,
      waveMaterial,
      secondaryWaveMaterial,
      pillarMaterial,
      cataclysmCoreMaterial,
      detonationFlashMaterial,
      cataclysmShellMaterial,
      starburstMaterial,
      ruptureMaterial,
      verticalHaloMaterial,
      residueMaterial,
      soulMaterial,
      soulPositions,
      soulDirections,
      sparkMaterial,
      sourceAnchor: new THREE.Vector3(),
      anchor: new THREE.Vector3(),
      invocationPlan: createSentenceInvocationPlan(),
      plan: createSentenceBurstPlan(),
    };
  }

  trigger(sourceId: number, targetId: number, condemnation: number, threadCount = 0): boolean {
    if (!this.anchor(targetId, 0, this.anchorProbe)) return false;
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;
    const generation = ++this.generation;
    slot.active = true;
    slot.generation = generation;
    slot.phase = 'invocation';
    slot.sourceId = sourceId;
    slot.targetId = targetId;
    slot.condemnation = Math.max(20, Math.min(100, condemnation));
    slot.threadCount = Math.max(0, Math.min(3, Math.floor(threadCount)));
    slot.age = 0;
    slot.phaseAge = 0;
    slot.feedbackFired = false;
    slot.anchor.copy(this.anchorProbe);
    slot.group.position.copy(this.anchorProbe);
    slot.group.visible = false;
    slot.sourceGroup.visible = false;
    this.resetSlot(slot);

    const hasSource = this.anchor(sourceId, 0.62, this.sourceProbe);
    if (!hasSource) {
      this.beginImpact(
        slot,
        generation,
        this.anchorProbe.x,
        this.anchorProbe.y + 1,
        this.anchorProbe.z,
      );
      return true;
    }

    slot.sourceAnchor.copy(this.sourceProbe);
    slot.sourceGroup.position.copy(this.sourceProbe);
    slot.sourceGroup.visible = true;
    if (this.anchor(targetId, 0.5, this.anchorProbe)) {
      slot.travelSeconds = sentenceTransferSeconds(this.sourceProbe.distanceTo(this.anchorProbe));
    } else {
      slot.travelSeconds = sentenceTransferSeconds(0);
    }
    this.ribbons.spawnTrailStyled(
      sourceId,
      targetId,
      CURSE_COLOR,
      this.lowDetail ? 0.075 : 0.115,
      {
        speed: SENTENCE_TRANSFER_SPEED,
        style: 'wisp',
        headSize: 0,
        coils: false,
        jagTrail: false,
        forkEvery: 0,
        tracer: !this.lowDetail,
        delay: SENTENCE_BUILDUP_SECONDS,
        aimX: 0,
        aimY: 0.08,
        aimZ: 0,
        groundY: null,
      },
      (x, y, z) => this.beginImpact(slot, generation, x, y, z),
      (x, y, z) => this.beginFizzle(slot, generation, x, y, z),
    );
    return true;
  }

  private resetSlot(slot: SentenceSlot): void {
    slot.sourceBillboard.rotation.set(0, 0, 0);
    slot.sourceCoreMaterial.opacity = 0;
    for (const material of slot.sourceSealMaterials) material.opacity = 0;
    if (slot.sourceWispMaterial) slot.sourceWispMaterial.opacity = 0;
    slot.billboard.rotation.set(0, 0, 0);
    slot.vortexMaterial.opacity = 0;
    slot.eyeMaterial.opacity = 0;
    slot.irisMaterial.opacity = 0;
    slot.pupilMaterial.opacity = 0;
    slot.flashMaterial.opacity = 0;
    slot.lashMaterial.opacity = 0;
    for (const material of slot.sigilMaterials) material.opacity = 0;
    if (slot.crownMaterial) slot.crownMaterial.opacity = 0;
    slot.waveMaterial.opacity = 0;
    if (slot.secondaryWaveMaterial) slot.secondaryWaveMaterial.opacity = 0;
    slot.pillarMaterial.opacity = 0;
    slot.cataclysmCore.visible = false;
    slot.cataclysmCoreMaterial.opacity = 0;
    slot.detonationFlash.visible = false;
    slot.detonationFlashMaterial.opacity = 0;
    if (slot.cataclysmShell) slot.cataclysmShell.visible = false;
    if (slot.cataclysmShellMaterial) slot.cataclysmShellMaterial.opacity = 0;
    if (slot.starburst) slot.starburst.visible = false;
    if (slot.starburstMaterial) slot.starburstMaterial.opacity = 0;
    slot.rupture.visible = false;
    slot.ruptureMaterial.opacity = 0;
    if (slot.verticalHalos) slot.verticalHalos.visible = false;
    if (slot.verticalHaloMaterial) slot.verticalHaloMaterial.opacity = 0;
    slot.residue.visible = false;
    slot.residueMaterial.opacity = 0;
    if (slot.soulFragments) slot.soulFragments.visible = false;
    if (slot.soulMaterial) slot.soulMaterial.opacity = 0;
    if (slot.sparkMaterial) slot.sparkMaterial.opacity = 0;
    if (slot.sparkPositions && slot.sparks) {
      slot.sparkPositions.fill(0);
      (slot.sparks.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    if (slot.soulPositions && slot.soulFragments) {
      slot.soulPositions.fill(0);
      (slot.soulFragments.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate =
        true;
    }
  }

  private beginImpact(
    slot: SentenceSlot,
    generation: number,
    x: number,
    y: number,
    z: number,
  ): void {
    if (!slot.active || slot.generation !== generation || slot.phase !== 'invocation') return;
    slot.phase = 'impact';
    slot.phaseAge = 0;
    slot.sourceGroup.visible = false;
    if (this.anchor(slot.targetId, 0, this.anchorProbe)) {
      slot.anchor.copy(this.anchorProbe);
    } else {
      slot.anchor.set(x, y - 1, z);
    }
    slot.group.position.copy(slot.anchor);
    slot.group.visible = true;
  }

  private beginFizzle(
    slot: SentenceSlot,
    generation: number,
    x: number,
    y: number,
    z: number,
  ): void {
    if (!slot.active || slot.generation !== generation || slot.phase !== 'invocation') return;
    slot.phase = 'fizzle';
    slot.phaseAge = 0;
    slot.sourceGroup.visible = false;
    slot.anchor.set(x, y - 0.7, z);
    slot.group.position.copy(slot.anchor);
    slot.group.visible = true;
    slot.vortex.visible = true;
    slot.vortex.scale.setScalar(0.32);
    slot.vortexMaterial.opacity = 0.18;
  }

  update(dt: number, reducedMotion = false): void {
    this.ribbons.update(dt, this.camera.position);
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      slot.phaseAge += dt;
      if (slot.phase === 'invocation') {
        this.updateInvocation(slot, reducedMotion);
        continue;
      }
      if (slot.phase === 'fizzle') {
        this.updateFizzle(slot, reducedMotion);
        continue;
      }
      if (!slot.feedbackFired && slot.phaseAge >= SENTENCE_MARK_SECONDS) {
        slot.feedbackFired = true;
        this.onBurst?.(slot.sourceId, slot.targetId, slot.condemnation);
      }
      writeSentenceBurstPlan(slot.plan, slot.phaseAge, slot.condemnation, reducedMotion);
      if (!slot.plan.visible) {
        slot.active = false;
        slot.group.visible = false;
        continue;
      }
      if (this.anchor(slot.targetId, 0, this.anchorProbe)) slot.anchor.copy(this.anchorProbe);
      slot.group.position.copy(slot.anchor);
      slot.billboard.quaternion.copy(this.camera.quaternion);
      slot.billboard.rotation.z = slot.plan.rotation * 0.12;
      slot.vortex.scale.setScalar(slot.plan.vortexScale);
      slot.vortex.rotation.y = slot.plan.rotation * 0.55;
      slot.vortexMaterial.opacity = slot.plan.opacity * 0.52;
      const threadScale = 1 + slot.threadCount * 0.08;
      slot.eye.scale.set(
        slot.plan.eyeScale * 2.35 * threadScale,
        slot.plan.eyeScale * 1.25 * threadScale,
        1,
      );
      slot.iris.scale.setScalar(slot.plan.irisScale * threadScale);
      slot.eyeMaterial.opacity = slot.plan.opacity * 0.8;
      slot.irisMaterial.opacity = slot.plan.opacity * 0.82;
      slot.pupilMaterial.opacity = slot.plan.opacity * 0.92;
      slot.flashMaterial.opacity = slot.plan.flashOpacity * 0.24;
      slot.lashMaterial.opacity = slot.plan.crownOpacity * (0.75 + slot.threadCount * 0.08);
      if (slot.sigils) {
        slot.sigils.rotation.z = -slot.plan.rotation * 0.8;
        slot.sigils.scale.setScalar(slot.plan.crownScale * 0.84 * threadScale);
        for (const material of slot.sigilMaterials) {
          material.opacity = slot.plan.crownOpacity * 0.62;
        }
      }
      if (slot.crown && slot.crownMaterial) {
        slot.crown.rotation.z = slot.plan.rotation;
        slot.crown.scale.setScalar(slot.plan.crownScale);
        slot.crownMaterial.opacity = slot.plan.crownOpacity * 0.75;
      }
      slot.wave.scale.setScalar(slot.plan.waveScale * threadScale);
      slot.wave.rotation.y = slot.plan.rotation * 0.45;
      slot.waveMaterial.opacity = slot.plan.waveOpacity * 0.7;
      if (slot.secondaryWave && slot.secondaryWaveMaterial) {
        slot.secondaryWave.scale.setScalar(slot.plan.secondaryWaveScale);
        slot.secondaryWave.rotation.y = -slot.plan.rotation * 0.7;
        slot.secondaryWaveMaterial.opacity = slot.plan.waveOpacity * 0.46;
      }
      slot.pillar.scale.set(slot.plan.pillarScale, slot.plan.pillarScale, slot.plan.pillarScale);
      slot.pillarMaterial.opacity = slot.plan.pillarOpacity * 0.34;
      const cataclysmVisible = slot.plan.maximum && slot.plan.cataclysmCoreOpacity > 0;
      slot.cataclysmCore.visible = cataclysmVisible;
      slot.cataclysmCore.scale.setScalar(slot.plan.cataclysmCoreScale);
      slot.cataclysmCoreMaterial.opacity = slot.plan.cataclysmCoreOpacity * 0.52;
      slot.detonationFlash.visible = slot.plan.maximum && slot.plan.detonationFlashOpacity > 0;
      slot.detonationFlash.scale.setScalar(slot.plan.detonationFlashScale);
      slot.detonationFlashMaterial.opacity = slot.plan.detonationFlashOpacity * 0.36;
      if (slot.cataclysmShell && slot.cataclysmShellMaterial) {
        slot.cataclysmShell.visible = slot.plan.maximum && slot.plan.cataclysmOpacity > 0;
        slot.cataclysmShell.scale.setScalar(slot.plan.cataclysmScale);
        slot.cataclysmShell.rotation.set(
          slot.plan.rotation * 0.22,
          -slot.plan.rotation * 0.34,
          slot.plan.rotation * 0.17,
        );
        slot.cataclysmShellMaterial.opacity = slot.plan.cataclysmOpacity * 0.08;
      }
      if (slot.starburst && slot.starburstMaterial) {
        slot.starburst.visible = slot.plan.maximum && slot.plan.starburstOpacity > 0;
        slot.starburst.scale.setScalar(slot.plan.starburstScale);
        slot.starburst.rotation.set(
          -slot.plan.rotation * 0.31,
          slot.plan.rotation * 0.47,
          slot.plan.rotation * 0.19,
        );
        slot.starburstMaterial.opacity = slot.plan.starburstOpacity * 0.32;
      }
      slot.rupture.visible = slot.plan.maximum && slot.plan.ruptureOpacity > 0;
      slot.rupture.scale.setScalar(slot.plan.ruptureScale);
      slot.rupture.rotation.z = slot.plan.rotation * 0.08;
      slot.ruptureMaterial.opacity = slot.plan.ruptureOpacity * 0.46;
      if (slot.verticalHalos && slot.verticalHaloMaterial) {
        slot.verticalHalos.visible = slot.plan.maximum && slot.plan.verticalHaloOpacity > 0;
        slot.verticalHalos.scale.setScalar(slot.plan.verticalHaloScale);
        slot.verticalHalos.rotation.set(
          slot.plan.rotation * 0.12,
          slot.plan.rotation * 0.24,
          -slot.plan.rotation * 0.16,
        );
        slot.verticalHaloMaterial.opacity = slot.plan.verticalHaloOpacity * 0.14;
      }
      slot.residue.visible = slot.plan.residueOpacity > 0;
      slot.residue.scale.setScalar(slot.plan.residueScale);
      slot.residue.rotation.z = -slot.plan.rotation * 0.11;
      slot.residueMaterial.opacity = slot.plan.residueOpacity * 0.58;
      this.updateSouls(slot);
      this.updateSparks(slot);
    }
  }

  private updateInvocation(slot: SentenceSlot, reducedMotion: boolean): void {
    writeSentenceInvocationPlan(
      slot.invocationPlan,
      slot.phaseAge,
      slot.travelSeconds,
      reducedMotion,
    );
    const plan = slot.invocationPlan;
    if (this.anchor(slot.sourceId, 0.62, this.sourceProbe)) {
      slot.sourceAnchor.copy(this.sourceProbe);
    }
    slot.sourceGroup.position.copy(slot.sourceAnchor);
    slot.sourceGroup.visible = plan.visible;
    if (!plan.visible) return;
    slot.sourceBillboard.quaternion.copy(this.camera.quaternion);
    slot.sourceBillboard.rotation.z = plan.rotation * 0.14;
    slot.sourceCore.scale.setScalar(plan.coreScale);
    slot.sourceCoreMaterial.opacity = plan.coreOpacity * 0.72;
    slot.sourceSeal.scale.setScalar(plan.sealScale);
    slot.sourceSeal.rotation.z = -plan.rotation;
    for (const material of slot.sourceSealMaterials) material.opacity = plan.sealOpacity * 0.62;
    if (slot.sourceWisps && slot.sourceWispPositions && slot.sourceWispMaterial) {
      for (let index = 0; index < CASTER_WISP_COUNT; index++) {
        const offset = index * 3;
        const angle = (index / CASTER_WISP_COUNT) * Math.PI * 2 + plan.rotation;
        const radius = plan.wispRadius * (0.72 + (index % 4) * 0.09);
        slot.sourceWispPositions[offset] = Math.cos(angle) * radius;
        slot.sourceWispPositions[offset + 1] =
          Math.sin(angle * 1.7 + index) * radius * 0.42 + (index % 3) * 0.08;
        slot.sourceWispPositions[offset + 2] = Math.sin(angle) * radius;
      }
      (slot.sourceWisps.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate =
        true;
      slot.sourceWispMaterial.opacity = plan.wispOpacity * 0.68;
      slot.sourceWispMaterial.size = 0.18 + plan.buildup * 0.13;
    }
  }

  private updateFizzle(slot: SentenceSlot, reducedMotion: boolean): void {
    const fade = Math.max(0, 1 - slot.phaseAge / 0.32);
    if (fade <= 0) {
      slot.active = false;
      slot.group.visible = false;
      return;
    }
    slot.vortex.scale.setScalar(reducedMotion ? 0.32 : 0.32 + slot.phaseAge * 1.1);
    slot.vortex.rotation.y = reducedMotion ? 0 : slot.phaseAge * 2.4;
    slot.vortexMaterial.opacity = fade * 0.18;
  }

  private updateSouls(slot: SentenceSlot): void {
    if (!slot.soulFragments || !slot.soulPositions || !slot.soulDirections || !slot.soulMaterial) {
      return;
    }
    slot.soulFragments.visible = slot.plan.soulOpacity > 0;
    for (let index = 0; index < SOUL_FRAGMENT_COUNT; index++) {
      const offset = index * 3;
      const spiral = slot.plan.rotation * (index % 2 === 0 ? 0.32 : -0.26);
      const cos = Math.cos(spiral);
      const sin = Math.sin(spiral);
      const x = slot.soulDirections[offset];
      const z = slot.soulDirections[offset + 2];
      slot.soulPositions[offset] = (x * cos - z * sin) * slot.plan.soulRise * 0.44;
      slot.soulPositions[offset + 1] = slot.soulDirections[offset + 1] * slot.plan.soulRise * 0.78;
      slot.soulPositions[offset + 2] = (x * sin + z * cos) * slot.plan.soulRise * 0.44;
    }
    (slot.soulFragments.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate =
      true;
    slot.soulMaterial.opacity = slot.plan.soulOpacity * 0.66;
    slot.soulMaterial.size = 0.24 + slot.plan.powerScale * 0.18;
  }

  private updateSparks(slot: SentenceSlot): void {
    if (!slot.sparks || !slot.sparkPositions || !slot.sparkDirections || !slot.sparkMaterial) {
      return;
    }
    const sparkCount = slot.plan.maximum
      ? MAXIMUM_SPARK_COUNT
      : Math.min(MAXIMUM_SPARK_COUNT, BASE_SPARK_COUNT + slot.threadCount * 6);
    slot.sparks.geometry.setDrawRange(0, sparkCount);
    for (let index = 0; index < sparkCount; index++) {
      const offset = index * 3;
      const distance = slot.plan.sparkDistance * (0.66 + (index % 7) * 0.055);
      slot.sparkPositions[offset] = slot.sparkDirections[offset] * distance;
      slot.sparkPositions[offset + 1] =
        slot.sparkDirections[offset + 1] * distance - slot.plan.sparkDistance * 0.34;
      slot.sparkPositions[offset + 2] = slot.sparkDirections[offset + 2] * distance;
    }
    (slot.sparks.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    slot.sparkMaterial.opacity = slot.plan.sparkOpacity * 0.9;
    slot.sparkMaterial.size = 0.28 + slot.plan.opacity * 0.34;
  }

  clear(): void {
    this.ribbons.clear();
    for (const slot of this.slots) {
      slot.active = false;
      slot.sourceGroup.visible = false;
      slot.group.visible = false;
    }
  }
}
