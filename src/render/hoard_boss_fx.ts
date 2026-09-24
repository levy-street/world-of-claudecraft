import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import { isBoneReaperVariant } from '../sim/rift/hoard_bone_reaper_core';
import { HOARD_SWEEP_HALF_ANGLE, HOARD_SWEEP_RANGE } from '../sim/rift/hoard_boss';
import { HOARD_BRUTE_COMBO } from '../sim/rift/hoard_boss_kits';
import { isBoulderVariant } from '../sim/rift/hoard_boulder_core';
import { isCocoonVariant } from '../sim/rift/hoard_cocoon_core';
import { isForgeHammerVariant } from '../sim/rift/hoard_forge_hammer_core';
import { isIceAgeVariant } from '../sim/rift/hoard_ice_age_core';
import { isPulsarVariant } from '../sim/rift/hoard_pulsars_core';
import { isTentacleVariant } from '../sim/rift/hoard_tentacles_core';
import { vaultSeedZone } from '../sim/rift/vault_seed';
import type { HoardBossCueView } from '../world_api/dungeons';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX } from './gfx';
import { type HoardCuePalette, hoardCueAppearance, hoardCueVisualPlan } from './hoard_boss_fx_core';
import { createHoardTideWaveResources, type HoardTideWaveView } from './hoard_tide_wave_fx';
import { hoardTideThemeTint } from './hoard_tide_wave_fx_core';
import {
  buildIgnivarFrontalTelegraph,
  syncIgnivarFrontalTelegraph,
} from './ignivar_frontal_telegraph';

const SLOT_COUNT = 8;
const SEGMENTS = 40;
/** Concentric rings a floor disc or sector is draped over. A plain fan only
 *  samples the ground at its centre and rim, so any bump in between poked
 *  through the telegraph; a grid follows the ground all the way across. */
const RINGS = 4;
const LIFT = 0.16;

interface CueSlot {
  group: THREE.Group;
  sweep: THREE.Group;
  bruteSweeps: THREE.Group[];
  genericSweep: THREE.Group;
  wave: THREE.Group;
  waveView: HoardTideWaveView;
  waveTail: boolean;
  observedAt: number;
  tether: THREE.Group;
  tetherBeam: THREE.Mesh;
  tetherRing: THREE.Mesh;
  rider: THREE.Points;
  markWarning: THREE.Group;
  markHazard: THREE.Group;
  countdown: THREE.Mesh;
  markDisc: THREE.BufferGeometry;
  markRing: THREE.BufferGeometry;
  slashA: THREE.BufferGeometry;
  slashB: THREE.BufferGeometry;
  sectorDisc: THREE.BufferGeometry;
  sectorRing: THREE.BufferGeometry;
  cue: HoardBossCueView | null;
  key: string;
  terrainSignature: string;
  serial: number;
}

function material(color: number, opacity: number, additive = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    // Pull the telegraph toward the camera in depth, so it never z-fights the
    // floor it is lying on.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
}

function geometry(vertexCount: number, indices: number[]): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  // Rewritten whenever a cue moves or turns, so never a static buffer.
  result.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  result.setIndex(indices);
  return result;
}

/** Vertex index of ring `ring` (1-based), rim point `index`, in a radial grid. */
function gridVertex(ring: number, index: number): number {
  return 1 + (ring - 1) * (SEGMENTS + 1) + index;
}

/** A centre vertex plus RINGS rings of SEGMENTS + 1 points: a fan to the first
 *  ring, then quads ring to ring. */
function fanGeometry(): THREE.BufferGeometry {
  const indices: number[] = [];
  for (let index = 0; index < SEGMENTS; index++) {
    indices.push(0, gridVertex(1, index), gridVertex(1, index + 1));
    for (let ring = 1; ring < RINGS; ring++) {
      const a = gridVertex(ring, index);
      const b = gridVertex(ring, index + 1);
      const c = gridVertex(ring + 1, index);
      const d = gridVertex(ring + 1, index + 1);
      indices.push(a, c, b, b, c, d);
    }
  }
  return geometry(1 + RINGS * (SEGMENTS + 1), indices);
}

function ringGeometry(): THREE.BufferGeometry {
  const indices: number[] = [];
  for (let index = 0; index < SEGMENTS; index++) {
    const inner = index * 2;
    indices.push(inner, inner + 1, inner + 2, inner + 1, inner + 3, inner + 2);
  }
  return geometry((SEGMENTS + 1) * 2, indices);
}

function quadGeometry(): THREE.BufferGeometry {
  return geometry(4, [0, 1, 2, 1, 3, 2]);
}

function riderGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(30 * 3);
  for (let index = 0; index < 30; index++) {
    const angle = index * 2.399963229728653;
    const radius = 0.16 + ((index * 37) % 71) / 100;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = 0.12 + ((index * 53) % 83) / 100;
    positions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return result;
}

function positionAttribute(target: THREE.BufferGeometry): THREE.BufferAttribute {
  return target.getAttribute('position') as THREE.BufferAttribute;
}

function setLocalVertex(
  attribute: THREE.BufferAttribute,
  index: number,
  dx: number,
  dz: number,
  centerY: number,
  x: number,
  z: number,
  groundY: (x: number, z: number) => number,
): void {
  attribute.setXYZ(index, dx, groundY(x + dx, z + dz) - centerY + LIFT, dz);
}

function writeDisc(
  target: THREE.BufferGeometry,
  cue: HoardBossCueView,
  centerY: number,
  groundY: (x: number, z: number) => number,
): void {
  const position = positionAttribute(target);
  setLocalVertex(position, 0, 0, 0, centerY, cue.x, cue.z, groundY);
  for (let ring = 1; ring <= RINGS; ring++) {
    const radius = cue.radius * 0.82 * (ring / RINGS);
    for (let index = 0; index <= SEGMENTS; index++) {
      const angle = (index / SEGMENTS) * Math.PI * 2;
      setLocalVertex(
        position,
        gridVertex(ring, index),
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        centerY,
        cue.x,
        cue.z,
        groundY,
      );
    }
  }
  position.needsUpdate = true;
  target.computeBoundingSphere();
}

function writeRing(
  target: THREE.BufferGeometry,
  cue: HoardBossCueView,
  centerY: number,
  groundY: (x: number, z: number) => number,
): void {
  const position = positionAttribute(target);
  for (let index = 0; index <= SEGMENTS; index++) {
    const angle = (index / SEGMENTS) * Math.PI * 2;
    for (let edge = 0; edge < 2; edge++) {
      const radius = edge === 0 ? (cue.innerRadius ?? cue.radius * 0.84) : cue.radius;
      setLocalVertex(
        position,
        index * 2 + edge,
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        centerY,
        cue.x,
        cue.z,
        groundY,
      );
    }
  }
  position.needsUpdate = true;
  target.computeBoundingSphere();
}

function writeSector(
  disc: THREE.BufferGeometry,
  ring: THREE.BufferGeometry,
  cue: HoardBossCueView,
  centerY: number,
  groundY: (x: number, z: number) => number,
): void {
  const halfAngle = cue.halfAngle ?? Math.PI * 0.25;
  const facing = cue.facing ?? 0;
  const discPosition = positionAttribute(disc);
  setLocalVertex(discPosition, 0, 0, 0, centerY, cue.x, cue.z, groundY);
  const ringPosition = positionAttribute(ring);
  for (let index = 0; index <= SEGMENTS; index++) {
    const angle = -halfAngle + (index / SEGMENTS) * halfAngle * 2;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    for (let ring = 1; ring <= RINGS; ring++) {
      const ringRadius = cue.radius * (ring / RINGS);
      const worldX = Math.sin(facing + angle) * ringRadius;
      const worldZ = Math.cos(facing + angle) * ringRadius;
      setLocalVertex(
        discPosition,
        gridVertex(ring, index),
        sin * ringRadius,
        cos * ringRadius,
        centerY,
        cue.x + worldX - sin * ringRadius,
        cue.z + worldZ - cos * ringRadius,
        groundY,
      );
    }
    for (let edge = 0; edge < 2; edge++) {
      const radius = cue.radius * (edge === 0 ? 0.94 : 1);
      const dx = sin * radius;
      const dz = cos * radius;
      const rotatedX = Math.sin(facing + angle) * radius;
      const rotatedZ = Math.cos(facing + angle) * radius;
      setLocalVertex(
        ringPosition,
        index * 2 + edge,
        dx,
        dz,
        centerY,
        cue.x + rotatedX - dx,
        cue.z + rotatedZ - dz,
        groundY,
      );
    }
  }
  discPosition.needsUpdate = true;
  ringPosition.needsUpdate = true;
  disc.computeBoundingSphere();
  ring.computeBoundingSphere();
}

function writeSlash(
  target: THREE.BufferGeometry,
  cue: HoardBossCueView,
  angle: number,
  centerY: number,
  groundY: (x: number, z: number) => number,
): void {
  const position = positionAttribute(target);
  const length = cue.radius * 0.86;
  const width = cue.radius * 0.11;
  const alongX = Math.sin(angle) * length;
  const alongZ = Math.cos(angle) * length;
  const sideX = Math.cos(angle) * width;
  const sideZ = -Math.sin(angle) * width;
  const vertices = [
    [-alongX - sideX, -alongZ - sideZ],
    [-alongX + sideX, -alongZ + sideZ],
    [alongX - sideX, alongZ - sideZ],
    [alongX + sideX, alongZ + sideZ],
  ];
  for (let index = 0; index < vertices.length; index++) {
    const [dx, dz] = vertices[index];
    setLocalVertex(position, index, dx, dz, centerY, cue.x, cue.z, groundY);
  }
  position.needsUpdate = true;
  target.computeBoundingSphere();
}

/** Pooled, terrain-draped presentation for the Hoard boss's actionable cues. */
export class HoardBossFx {
  private readonly tideResources = createHoardTideWaveResources();
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly slots: CueSlot[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[];
  private readonly sweepPalettes: Record<string, readonly [THREE.Material, THREE.Material]>;
  private readonly markPalettes: Record<
    string,
    readonly [THREE.Material, THREE.Material, THREE.Material]
  >;
  private readonly riderMaterials: Record<HoardCuePalette, THREE.PointsMaterial>;
  private disposed = false;
  private serial = 0;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ) {
    this.root.name = 'hoard-boss-actionable-cues';
    this.root.userData.renderCategory = 'ui3d';
    this.root.userData.actionable = true;

    const markFillMaterial = material(0xd56b12, 0.24);
    const markGoldMaterial = material(0xffcf55, 0.96, true);
    const markCountdownMaterial = material(0xffa52f, 0.34, true);
    const hazardFillMaterial = material(0x7f1e0d, 0.38);
    const hazardEdgeMaterial = material(0xff6b20, 0.8, true);
    const frostFill = material(0x5bc6f2, 0.25);
    const frostEdge = material(0xd9f7ff, 0.9, true);
    const bruteFill = material(0x9d241d, 0.3);
    const bruteEdge = material(0xffbd66, 0.92, true);
    const tideFill = material(0x168aaa, 0.3);
    const tideEdge = material(0x8ff7ff, 0.94, true);
    const arcaneFill = material(0x7040bd, 0.26);
    const arcaneEdge = material(0xd5b4ff, 0.95, true);
    const stormFill = material(0x224f8f, 0.3);
    const stormEdge = material(0x8de8ff, 0.96, true);
    const fireFill = material(0xaa250d, 0.3);
    const fireEdge = material(0xff8c2b, 0.94, true);
    const sporeFill = material(0x6e7a18, 0.3);
    const sporeEdge = material(0xd8f06a, 0.94, true);
    const goldFill = material(0x8a6410, 0.32);
    const goldEdge = material(0xffd24a, 0.95, true);
    this.sweepPalettes = {
      frost: [frostFill, frostEdge],
      physical: [bruteFill, bruteEdge],
      tide: [tideFill, tideEdge],
    };
    this.markPalettes = {
      frost: [frostFill, frostEdge, frostEdge],
      arcane: [arcaneFill, arcaneEdge, arcaneEdge],
      storm: [stormFill, stormEdge, stormEdge],
      fire: [fireFill, fireEdge, fireEdge],
      spore: [sporeFill, sporeEdge, sporeEdge],
      gold: [goldFill, goldEdge, goldEdge],
      physical: [markFillMaterial, markGoldMaterial, hazardEdgeMaterial],
    };
    const riderMaterial = (color: number): THREE.PointsMaterial =>
      new THREE.PointsMaterial({
        color,
        size: 0.22,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
    this.riderMaterials = {
      physical: riderMaterial(0xffbd66),
      fire: riderMaterial(0xff8c2b),
      frost: riderMaterial(0xd9f7ff),
      arcane: riderMaterial(0xd5b4ff),
      storm: riderMaterial(0x8de8ff),
      tide: riderMaterial(0x8ff7ff),
      spore: riderMaterial(0xd8f06a),
      gold: riderMaterial(0xffd24a),
    };
    this.materials = [
      markFillMaterial,
      markGoldMaterial,
      markCountdownMaterial,
      hazardFillMaterial,
      hazardEdgeMaterial,
      frostFill,
      frostEdge,
      bruteFill,
      bruteEdge,
      tideFill,
      tideEdge,
      arcaneFill,
      arcaneEdge,
      stormFill,
      stormEdge,
      fireFill,
      fireEdge,
      sporeFill,
      sporeEdge,
      goldFill,
      goldEdge,
      ...Object.values(this.riderMaterials),
    ];

    const tetherBeamGeo = new THREE.BoxGeometry(0.18, 0.12, 1);
    const tetherRingGeo = new THREE.TorusGeometry(1.1, 0.1, 6, 24);
    const tetherColumnGeo = new THREE.CylinderGeometry(0.32, 0.62, 2.8, 8, 1, true);
    const sharedRiderGeo = riderGeometry();
    this.geometries.push(tetherBeamGeo, tetherRingGeo, tetherColumnGeo, sharedRiderGeo);

    const sweepTemplate = buildIgnivarFrontalTelegraph({
      range: HOARD_SWEEP_RANGE,
      halfAngle: HOARD_SWEEP_HALF_ANGLE,
    });
    const bruteTemplates = HOARD_BRUTE_COMBO.map((step) =>
      buildIgnivarFrontalTelegraph({ range: step.radius, halfAngle: step.halfAngle }),
    );
    for (const template of [sweepTemplate, ...bruteTemplates]) {
      template.visible = true;
      template.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.geometry || !mesh.material) return;
        this.geometries.push(mesh.geometry);
        if (Array.isArray(mesh.material)) this.materials.push(...mesh.material);
        else this.materials.push(mesh.material);
      });
    }

    for (let index = 0; index < SLOT_COUNT; index++) {
      const markDisc = fanGeometry();
      const markRing = ringGeometry();
      const slashA = quadGeometry();
      const slashB = quadGeometry();
      const sectorDisc = fanGeometry();
      const sectorRing = ringGeometry();
      this.geometries.push(markDisc, markRing, slashA, slashB, sectorDisc, sectorRing);

      const group = new THREE.Group();
      group.name = `hoard-boss-cue-${index}`;
      const sweep = sweepTemplate.clone(true);
      sweep.name = 'hoard-boss-sweep';
      const bruteSweeps = bruteTemplates.map((template, step) => {
        const frontal = template.clone(true);
        frontal.name = `hoard-grask-frontal-${step}`;
        return frontal;
      });
      const genericSweep = new THREE.Group();
      genericSweep.name = 'hoard-boss-shaped-sweep';
      const sectorFill = new THREE.Mesh(sectorDisc, frostFill);
      const sectorEdge = new THREE.Mesh(sectorRing, frostEdge);
      sectorFill.renderOrder = 18;
      sectorEdge.renderOrder = 20;
      genericSweep.add(sectorFill, sectorEdge);

      const wave = new THREE.Group();
      wave.name = 'hoard-boss-traveling-tide';
      const profile = resolveUiEffectsProfile({
        presetLabel: GFX.tier,
        effectsQuality: 1,
        reduceMotion: false,
      });
      const waveView = this.tideResources.createView(profile.tier !== 'low', (x, z) => {
        const facing = wave.rotation.y;
        return (
          this.groundY(
            group.position.x + Math.cos(facing) * x + Math.sin(facing) * z,
            group.position.z - Math.sin(facing) * x + Math.cos(facing) * z,
          ) - group.position.y
        );
      });
      waveView.root.visible = true;
      wave.add(waveView.root);

      const tether = new THREE.Group();
      tether.name = 'hoard-healing-tide-link';
      const tetherBeam = new THREE.Mesh(tetherBeamGeo, tideEdge);
      tetherBeam.position.set(0, 0.32, 0.5);
      const tetherRing = new THREE.Mesh(tetherRingGeo, tideEdge);
      tetherRing.rotation.x = Math.PI / 2;
      tetherRing.position.y = 0.18;
      const tetherColumn = new THREE.Mesh(tetherColumnGeo, tideFill);
      tetherColumn.position.y = 1.4;
      const tetherSpray = new THREE.Points(sharedRiderGeo, this.riderMaterials.tide);
      tetherSpray.scale.set(1.8, 3.2, 1.8);
      tether.add(tetherBeam, tetherRing, tetherColumn, tetherSpray);

      const rider = new THREE.Points(sharedRiderGeo, this.riderMaterials.physical);
      rider.name = 'hoard-boss-elemental-rider';

      const markWarning = new THREE.Group();
      markWarning.name = 'hoard-boss-mark-warning';
      const warningFill = new THREE.Mesh(markDisc, markFillMaterial);
      const countdown = new THREE.Mesh(markDisc, markCountdownMaterial);
      const warningRing = new THREE.Mesh(markRing, markGoldMaterial);
      const warningSlashA = new THREE.Mesh(slashA, markGoldMaterial);
      const warningSlashB = new THREE.Mesh(slashB, markGoldMaterial);
      warningFill.renderOrder = 18;
      countdown.renderOrder = 19;
      warningRing.renderOrder = 20;
      warningSlashA.renderOrder = 21;
      warningSlashB.renderOrder = 21;
      markWarning.add(warningFill, countdown, warningRing, warningSlashA, warningSlashB);

      const markHazard = new THREE.Group();
      markHazard.name = 'hoard-boss-mark-hazard';
      const hazardFill = new THREE.Mesh(markDisc, hazardFillMaterial);
      const hazardRing = new THREE.Mesh(markRing, hazardEdgeMaterial);
      const hazardSlashA = new THREE.Mesh(slashA, hazardEdgeMaterial);
      const hazardSlashB = new THREE.Mesh(slashB, hazardEdgeMaterial);
      hazardFill.renderOrder = 18;
      hazardRing.renderOrder = 20;
      hazardSlashA.renderOrder = 21;
      hazardSlashB.renderOrder = 21;
      markHazard.add(hazardFill, hazardRing, hazardSlashA, hazardSlashB);

      group.add(sweep, ...bruteSweeps, genericSweep, wave, tether, markWarning, markHazard, rider);
      this.root.add(group);
      this.slots.push({
        group,
        sweep,
        bruteSweeps,
        genericSweep,
        wave,
        waveView,
        waveTail: false,
        observedAt: 0,
        tether,
        tetherBeam,
        tetherRing,
        rider,
        markWarning,
        markHazard,
        countdown,
        markDisc,
        markRing,
        slashA,
        slashB,
        sectorDisc,
        sectorRing,
        cue: null,
        key: '',
        terrainSignature: '',
        serial: 0,
      });
    }

    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {
        for (const slot of this.slots) this.syncSlot(slot);
      })
      .catch(() => {});
  }

  sync(cues: readonly HoardBossCueView[]): void {
    const seen = new Set<string>();
    const now = performance.now();
    for (const cue of cues) {
      if (cue.variant === 'storm-orbital') continue;
      // Xarreth's scythe and souls draw themselves (hoard_bone_reaper.ts): their
      // cue numbers carry a route, not a floor shape.
      if (
        isBoneReaperVariant(cue.variant) ||
        isIceAgeVariant(cue.variant) ||
        isPulsarVariant(cue.variant) ||
        isForgeHammerVariant(cue.variant) ||
        isTentacleVariant(cue.variant) ||
        isBoulderVariant(cue.variant) ||
        isCocoonVariant(cue.variant) ||
        // Her cap's end is only the burst (its fx): nothing to draw on the floor.
        cue.variant === 'mushroom-burst'
      )
        continue;
      const key = `${cue.instanceId}:${cue.cueId}`;
      seen.add(key);
      let slot = this.slots.find((candidate) => candidate.key === key);
      if (!slot) {
        slot =
          this.slots.find((candidate) => candidate.cue === null) ??
          this.slots.reduce((oldest, candidate) =>
            candidate.serial < oldest.serial ? candidate : oldest,
          );
        slot.key = key;
        slot.serial = ++this.serial;
        slot.terrainSignature = '';
        slot.waveTail = false;
      }
      slot.cue = { ...cue };
      slot.observedAt = now;
      this.syncSlot(slot);
    }
    for (const slot of this.slots) {
      if (!slot.cue || seen.has(slot.key)) continue;
      slot.waveTail =
        slot.cue.variant === 'tide-wave' &&
        slot.cue.remaining - (now - slot.observedAt) / 1000 <= 0.06;
      slot.cue = null;
      slot.key = '';
      slot.terrainSignature = '';
      this.syncSlot(slot);
    }
  }

  setTheme(seed: number | undefined): void {
    this.tideResources.bodyMat.color.setHex(
      hoardTideThemeTint(seed === undefined ? null : vaultSeedZone(seed)),
    );
  }

  update(_dt: number): void {
    for (const slot of this.slots) {
      const cue = slot.cue;
      if (!cue) {
        if (slot.waveTail) {
          slot.waveTail = slot.waveView.finish(_dt);
          slot.group.visible = slot.waveTail;
        }
        continue;
      }
      const elapsed = Math.max(0, cue.total - cue.remaining);
      const plan = hoardCueVisualPlan(cue.remaining, cue.total, elapsed);
      const appearance = hoardCueAppearance(cue);
      if (cue.kind === 'sweep') {
        if (appearance.shape === 'ignivar') {
          const step = HOARD_BRUTE_COMBO.findIndex((spec) => spec.variant === cue.variant);
          syncIgnivarFrontalTelegraph(
            step < 0 ? slot.sweep : slot.bruteSweeps[step],
            true,
            plan.progress,
            1,
            _dt,
          );
        } else if (appearance.shape === 'sector') {
          const pulse = plan.pulseScale * (0.94 + plan.progress * 0.06);
          slot.genericSweep.scale.set(pulse, 1, pulse);
        } else if (appearance.shape === 'wave') {
          slot.waveView.update(cue, _dt);
        } else if (appearance.shape === 'tether') {
          const pulse = 1 + Math.sin(elapsed * Math.PI * 2) * 0.12;
          slot.tetherRing.scale.setScalar(pulse);
          slot.tether.scale.y = pulse;
        }
      } else if (cue.phase === 'warning') {
        slot.markWarning.scale.set(plan.pulseScale, 1, plan.pulseScale);
        slot.countdown.scale.set(plan.countdownScale, 1, plan.countdownScale);
      } else {
        const pulse = 1 + Math.sin(elapsed * 5) * 0.025;
        slot.markHazard.scale.set(pulse, 1, pulse);
      }
      if (
        appearance.elementalRider &&
        appearance.shape !== 'wave' &&
        appearance.shape !== 'tether'
      ) {
        slot.rider.rotation.y += _dt * (appearance.palette === 'storm' ? 2.8 : 1.2);
        slot.rider.position.y = 0.15 + Math.sin(elapsed * 3) * 0.08;
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const slot of this.slots) slot.waveView.dispose();
    this.tideResources.dispose();
    for (const ownedGeometry of this.geometries) ownedGeometry.dispose();
    for (const ownedMaterial of this.materials) ownedMaterial.dispose();
  }

  private syncSlot(slot: CueSlot): void {
    const cue = slot.cue;
    slot.group.visible = cue !== null || slot.waveTail;
    if (!cue) return;
    const centerY = this.groundY(cue.x, cue.z);
    slot.group.position.set(cue.x, centerY, cue.z);
    const appearance = hoardCueAppearance(cue);
    const ignivarSweep = cue.kind === 'sweep' && appearance.shape === 'ignivar';
    const bruteStep = HOARD_BRUTE_COMBO.findIndex((spec) => spec.variant === cue.variant);
    slot.sweep.visible = ignivarSweep && bruteStep < 0;
    slot.bruteSweeps.forEach((frontal, step) => {
      frontal.visible = ignivarSweep && step === bruteStep;
      frontal.rotation.y = cue.facing ?? 0;
    });
    slot.genericSweep.visible = cue.kind === 'sweep' && appearance.shape === 'sector';
    slot.wave.visible = appearance.shape === 'wave';
    slot.tether.visible = appearance.shape === 'tether';
    slot.rider.visible =
      appearance.elementalRider && appearance.shape !== 'wave' && appearance.shape !== 'tether';
    slot.markWarning.visible = cue.kind === 'mark' && cue.phase === 'warning';
    slot.markHazard.visible = cue.kind === 'mark' && cue.phase === 'hazard';
    slot.sweep.scale.set(1, 1, 1);
    slot.genericSweep.scale.set(1, 1, 1);
    slot.markWarning.scale.set(1, 1, 1);
    slot.markHazard.scale.set(1, 1, 1);
    slot.wave.scale.set(1, 1, 1);
    slot.tether.scale.set(1, 1, 1);
    const signature = [
      cue.kind,
      cue.x,
      cue.z,
      cue.radius,
      cue.facing ?? 0,
      cue.halfAngle ?? 0,
      cue.variant ?? '',
      cue.innerRadius ?? 0,
    ].join(':');
    if (signature === slot.terrainSignature) return;
    slot.terrainSignature = signature;
    if (cue.kind === 'sweep') {
      if (ignivarSweep) {
        slot.sweep.rotation.y = cue.facing ?? 0;
        slot.sweep.userData.halfAngle = cue.halfAngle;
      } else if (appearance.shape === 'sector') {
        slot.genericSweep.rotation.y = cue.facing ?? 0;
        writeSector(slot.sectorDisc, slot.sectorRing, cue, centerY, this.groundY);
        const palette = this.sweepPalettes[appearance.palette];
        (slot.genericSweep.children[0] as THREE.Mesh).material = palette[0];
        (slot.genericSweep.children[1] as THREE.Mesh).material = palette[1];
      } else if (appearance.shape === 'wave') {
        slot.wave.rotation.y = cue.facing ?? 0;
        slot.waveView.invalidateGround();
      } else if (appearance.shape === 'tether') {
        slot.tether.rotation.y = cue.facing ?? 0;
        slot.tetherBeam.position.z = cue.radius * 0.5;
        slot.tetherBeam.scale.z = cue.radius;
      }
      slot.rider.material = this.riderMaterials[appearance.palette];
      slot.rider.scale.set(cue.radius, 2.2, cue.radius);
      return;
    }
    writeDisc(slot.markDisc, cue, centerY, this.groundY);
    writeRing(slot.markRing, cue, centerY, this.groundY);
    writeSlash(slot.slashA, cue, Math.PI / 4, centerY, this.groundY);
    writeSlash(slot.slashB, cue, -Math.PI / 4, centerY, this.groundY);
    const palette = this.markPalettes[appearance.palette];
    const warningChildren = slot.markWarning.children as THREE.Mesh[];
    const hazardChildren = slot.markHazard.children as THREE.Mesh[];
    warningChildren[0].material = palette[0];
    warningChildren[1].material = cue.variant === 'storm-orbital-impact' ? palette[0] : palette[2];
    warningChildren[2].material = palette[1];
    hazardChildren[0].material = palette[0];
    hazardChildren[1].material = palette[2];
    const ringOnly = appearance.shape === 'annulus';
    warningChildren[0].visible = !ringOnly;
    warningChildren[1].visible = appearance.countdown !== 'none';
    slot.countdown.geometry = ringOnly ? slot.markRing : slot.markDisc;
    warningChildren[3].visible = !ringOnly && cue.variant === 'buried-mark';
    warningChildren[4].visible = !ringOnly && cue.variant === 'buried-mark';
    hazardChildren[0].visible = !ringOnly;
    hazardChildren[2].visible = cue.variant === 'buried-mark';
    hazardChildren[3].visible = cue.variant === 'buried-mark';
    slot.rider.material = this.riderMaterials[appearance.palette];
    slot.rider.scale.set(cue.radius, 2.2, cue.radius);
  }
}
