// Persistent, authoritative visuals for the two forge interception lanes.
// Actionable geometry is identical at every quality tier; reduced motion only
// freezes motes and pulses, never the beams, impacts, columns, or heat meter.

import * as THREE from 'three';
import type { ActiveVarkhulAssembly } from '../sim/varkhul_assembly';
import { formatNumber, getI18nRevision, t } from '../ui/i18n';

const UP = new THREE.Vector3(0, 1, 0);
const BEAM_HEIGHT = 4.8;
const BLOCKED_IMPACT_HEIGHT = 1.55;
const FORGE_IMPACT_HEIGHT = 2.15;
const MOTE_COUNT = 12;
const HEAT_SEGMENTS = 10;

interface BeamLaneVisual {
  column: THREE.Group;
  columnGlowMaterials: THREE.MeshBasicMaterial[];
  core: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  sheath: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  impact: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  start: THREE.Vector3;
  end: THREE.Vector3;
  blocked: boolean;
  active: boolean;
  warning: boolean;
}

interface ForgeBeamVisual {
  root: THREE.Group;
  lanes: [BeamLaneVisual, BeamLaneVisual];
  motes: THREE.InstancedMesh;
  heatMeter: THREE.Group;
  heatSegments: THREE.InstancedMesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  heatLabel: THREE.Sprite;
  heatLabelCanvas: HTMLCanvasElement;
  heatLabelTexture: THREE.CanvasTexture;
  waveLabel: THREE.Sprite;
  waveLabelCanvas: HTMLCanvasElement;
  waveLabelTexture: THREE.CanvasTexture;
  meltdownPlume: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  time: number;
  beamsActive: boolean;
  warmupFraction: number;
  renderedHeatSegments: number;
  renderedMeltdown: boolean;
  renderedHeatPercent: number;
  renderedHeatI18nRevision: number;
  renderedWaveI18nRevision: number;
  renderedAddWave: number;
  renderedAddWaves: number;
  renderedAddsRemaining: number;
}

function basicMaterial(color: number, opacity: number, additive = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1 || additive,
    opacity,
    depthWrite: !additive && opacity >= 1,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

function buildColumn(index: number): {
  group: THREE.Group;
  glowMaterials: THREE.MeshBasicMaterial[];
} {
  const group = new THREE.Group();
  group.name = `varkhul-forge-column-${index}`;
  group.userData.actionable = true;
  group.userData.beamIndex = index;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(1.18, 1.7, 4.4, 12),
    basicMaterial(0x24100d, 1),
  );
  body.name = `varkhul-forge-column-body-${index}`;
  body.position.y = 2.2;
  group.add(body);

  const foot = new THREE.Mesh(
    new THREE.CylinderGeometry(2.15, 2.35, 0.55, 12),
    basicMaterial(0x160a08, 1),
  );
  foot.position.y = 0.28;
  group.add(foot);

  const glowMaterials: THREE.MeshBasicMaterial[] = [];
  const ringMaterial = basicMaterial(0xff6b16, 0.76, true);
  glowMaterials.push(ringMaterial);
  const rings = new THREE.InstancedMesh(
    new THREE.TorusGeometry(1.36, 0.12, 5, 16).rotateX(Math.PI / 2),
    ringMaterial,
    3,
  );
  rings.name = `varkhul-forge-column-rings-${index}`;
  const ringMatrix = new THREE.Matrix4();
  for (let ringIndex = 0; ringIndex < 3; ringIndex++) {
    ringMatrix.makeTranslation(0, 1.05 + ringIndex * 1.18, 0);
    rings.setMatrixAt(ringIndex, ringMatrix);
  }
  rings.instanceMatrix.needsUpdate = true;
  group.add(rings);

  const crownMaterial = basicMaterial(0xffb52e, 0.9, true);
  glowMaterials.push(crownMaterial);
  const crown = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.5, 10), crownMaterial);
  crown.position.y = 4.85;
  group.add(crown);
  return { group, glowMaterials };
}

function buildLane(index: number): BeamLaneVisual {
  const { group: column, glowMaterials: columnGlowMaterials } = buildColumn(index);
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 1, 8),
    basicMaterial(0xfff1a6, 0.96, true),
  );
  core.name = `varkhul-forge-beam-core-${index}`;
  core.renderOrder = 14;
  const sheath = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.62, 1, 10, 1, true),
    basicMaterial(0xff4b0b, 0.36, true),
  );
  sheath.name = `varkhul-forge-beam-sheath-${index}`;
  sheath.renderOrder = 13;
  const impact = new THREE.Mesh(
    new THREE.SphereGeometry(0.82, 10, 6),
    basicMaterial(0xff7a19, 0.78, true),
  );
  impact.name = `varkhul-forge-impact-${index}`;
  impact.renderOrder = 15;
  return {
    column,
    columnGlowMaterials,
    core,
    sheath,
    impact,
    start: new THREE.Vector3(),
    end: new THREE.Vector3(),
    blocked: false,
    active: false,
    warning: false,
  };
}

function buildHeatLabel(): {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
} {
  const canvas =
    typeof document === 'undefined'
      ? ({ width: 256, height: 96, getContext: () => null } as unknown as HTMLCanvasElement)
      : document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = 'varkhul-forge-heat-percent';
  sprite.scale.set(5.4, 2.05, 1);
  sprite.position.y = 1.3;
  sprite.renderOrder = 18;
  sprite.userData.actionable = true;
  return { sprite, canvas, texture };
}

function buildWaveLabel(): {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
} {
  const canvas =
    typeof document === 'undefined'
      ? ({ width: 512, height: 96, getContext: () => null } as unknown as HTMLCanvasElement)
      : document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }),
  );
  sprite.name = 'varkhul-forge-wave-status';
  sprite.scale.set(8.4, 1.58, 1);
  sprite.position.y = -0.55;
  sprite.renderOrder = 18;
  sprite.userData.actionable = true;
  return { sprite, canvas, texture };
}

export function varkhulForgeHeatPercentLabel(percent: number): string {
  return formatNumber(THREE.MathUtils.clamp(percent, 0, 100) / 100, {
    style: 'percent',
    maximumFractionDigits: 0,
  });
}

export function varkhulForgeWaveStatusLabel(
  wave: number,
  waves: number,
  remaining: number,
): string {
  return t('hudChrome.varkhulWaveStatus', {
    wave: formatNumber(Math.max(0, Math.floor(wave))),
    waves: formatNumber(Math.max(0, Math.floor(waves))),
    remaining: formatNumber(Math.max(0, Math.floor(remaining))),
  });
}

function paintHeatLabel(visual: ForgeBeamVisual, percent: number, meltdown: boolean): void {
  const label = varkhulForgeHeatPercentLabel(percent);
  visual.heatLabel.userData.percent = percent;
  visual.heatLabel.userData.meltdown = meltdown;
  visual.heatLabel.userData.label = label;
  const ctx = visual.heatLabelCanvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, visual.heatLabelCanvas.width, visual.heatLabelCanvas.height);
  ctx.fillStyle = 'rgba(18, 5, 3, 0.86)';
  ctx.beginPath();
  ctx.roundRect(18, 12, 220, 70, 20);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = meltdown ? '#ff3218' : percent >= 90 ? '#ff4b20' : '#ffc247';
  ctx.stroke();
  ctx.font = 'bold 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = meltdown ? '#fff0e8' : '#ffffff';
  ctx.fillText(label, 128, 49);
  visual.heatLabelTexture.needsUpdate = true;
}

function paintWaveLabel(
  visual: ForgeBeamVisual,
  wave: number,
  waves: number,
  remaining: number,
): void {
  const label = varkhulForgeWaveStatusLabel(wave, waves, remaining);
  visual.waveLabel.userData.label = label;
  visual.waveLabel.userData.wave = wave;
  visual.waveLabel.userData.waves = waves;
  visual.waveLabel.userData.remaining = remaining;
  const ctx = visual.waveLabelCanvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, visual.waveLabelCanvas.width, visual.waveLabelCanvas.height);
  ctx.fillStyle = 'rgba(18, 5, 3, 0.9)';
  ctx.beginPath();
  ctx.roundRect(12, 12, 488, 70, 18);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#ff9b2f';
  ctx.stroke();
  ctx.font = 'bold 42px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff5dd';
  ctx.fillText(label, 256, 49, 452);
  visual.waveLabelTexture.needsUpdate = true;
}

function setBeamBetween(
  mesh: THREE.Mesh,
  start: THREE.Vector3,
  end: THREE.Vector3,
  scratch: THREE.Vector3,
): number {
  scratch.subVectors(end, start);
  const length = scratch.length();
  mesh.position.copy(start).addScaledVector(scratch, 0.5);
  if (length > 0.0001) mesh.quaternion.setFromUnitVectors(UP, scratch.multiplyScalar(1 / length));
  mesh.scale.set(1, Math.max(0.001, length), 1);
  mesh.userData.length = length;
  return length;
}

function createVisual(bossId: number): ForgeBeamVisual {
  const root = new THREE.Group();
  root.name = `varkhul-forge-beams-${bossId}`;
  root.userData.renderCategory = 'ui3d';
  root.userData.actionable = true;

  const lanes = [buildLane(0), buildLane(1)] as [BeamLaneVisual, BeamLaneVisual];
  for (const lane of lanes) root.add(lane.column, lane.sheath, lane.core, lane.impact);

  const moteMaterial = basicMaterial(0xffd36a, 0.88, true);
  const motes = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.16, 5, 4),
    moteMaterial,
    MOTE_COUNT,
  );
  motes.name = 'varkhul-forge-beam-motes';
  motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  motes.frustumCulled = false;
  root.add(motes);

  const heatMeter = new THREE.Group();
  heatMeter.name = 'varkhul-forge-heat-meter';
  heatMeter.userData.actionable = true;
  const gap = 0.035;
  const arc = (Math.PI * 2) / HEAT_SEGMENTS - gap;
  const heatMaterial = basicMaterial(0xffffff, 0.92);
  heatMaterial.vertexColors = true;
  const heatSegments = new THREE.InstancedMesh(
    new THREE.RingGeometry(3.65, 4.35, 10, 1, gap / 2, arc).rotateX(-Math.PI / 2),
    heatMaterial,
    HEAT_SEGMENTS,
  );
  heatSegments.name = 'varkhul-forge-heat-segments';
  heatSegments.renderOrder = 16;
  const segmentMatrix = new THREE.Matrix4();
  const emptyHeatColor = new THREE.Color(0x3a1712);
  for (let index = 0; index < HEAT_SEGMENTS; index++) {
    segmentMatrix.makeRotationY(index * ((Math.PI * 2) / HEAT_SEGMENTS));
    heatSegments.setMatrixAt(index, segmentMatrix);
    heatSegments.setColorAt(index, emptyHeatColor);
  }
  heatSegments.instanceMatrix.needsUpdate = true;
  if (heatSegments.instanceColor) heatSegments.instanceColor.needsUpdate = true;
  heatSegments.userData.filled = Array.from({ length: HEAT_SEGMENTS }, () => false);
  heatMeter.add(heatSegments);
  const heatLabel = buildHeatLabel();
  heatMeter.add(heatLabel.sprite);
  const waveLabel = buildWaveLabel();
  heatMeter.add(waveLabel.sprite);
  root.add(heatMeter);

  const meltdownPlume = new THREE.Mesh(
    new THREE.ConeGeometry(3.6, 10, 12, 1, true),
    basicMaterial(0xff2e08, 0.48, true),
  );
  meltdownPlume.name = 'varkhul-forge-meltdown-plume';
  meltdownPlume.renderOrder = 12;
  root.add(meltdownPlume);

  return {
    root,
    lanes,
    motes,
    heatMeter,
    heatSegments,
    heatLabel: heatLabel.sprite,
    heatLabelCanvas: heatLabel.canvas,
    heatLabelTexture: heatLabel.texture,
    waveLabel: waveLabel.sprite,
    waveLabelCanvas: waveLabel.canvas,
    waveLabelTexture: waveLabel.texture,
    meltdownPlume,
    time: 0,
    beamsActive: false,
    warmupFraction: 1,
    renderedHeatSegments: -1,
    renderedMeltdown: false,
    renderedHeatPercent: -1,
    renderedHeatI18nRevision: -1,
    renderedWaveI18nRevision: -1,
    renderedAddWave: -1,
    renderedAddWaves: -1,
    renderedAddsRemaining: -1,
  };
}

function disposeVisual(visual: ForgeBeamVisual): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  visual.root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
      (mesh as THREE.InstancedMesh).dispose();
    }
    geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  (visual.heatLabel.material as THREE.SpriteMaterial).dispose();
  visual.heatLabelTexture.dispose();
  (visual.waveLabel.material as THREE.SpriteMaterial).dispose();
  visual.waveLabelTexture.dispose();
  visual.root.removeFromParent();
}

export function buildVarkhulForgeBeamPrewarmVisual(): THREE.Group {
  const visual = createVisual(0);
  visual.root.name = 'varkhul-forge-beam-prewarm';
  return visual.root;
}

export class VarkhulForgeBeamVisuals {
  private readonly visuals = new Map<number, ForgeBeamVisual>();
  private readonly activeBossIds = new Set<number>();
  private readonly direction = new THREE.Vector3();
  private readonly motePosition = new THREE.Vector3();
  private readonly moteScale = new THREE.Vector3(1, 1, 1);
  private readonly moteQuaternion = new THREE.Quaternion();
  private readonly moteMatrix = new THREE.Matrix4();
  private readonly heatColor = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  sync(assemblies: readonly ActiveVarkhulAssembly[]): void {
    this.activeBossIds.clear();
    for (const state of assemblies) {
      this.activeBossIds.add(state.bossId);
      let visual = this.visuals.get(state.bossId);
      if (!visual) {
        visual = createVisual(state.bossId);
        this.visuals.set(state.bossId, visual);
        this.scene.add(visual.root);
      }
      visual.root.userData.overheat = state.forgeOverheat;
      visual.root.userData.warmupRemaining = state.forgeBeamWarmupRemaining;
      visual.root.userData.meltdownRemaining = state.forgeMeltdownRemaining;
      const beamsIgnited = state.forgeBeamWarmupRemaining <= 0;
      visual.beamsActive = beamsIgnited && state.forgeBeams.some((beam) => beam.active);
      visual.warmupFraction = THREE.MathUtils.clamp(1 - state.forgeBeamWarmupRemaining / 3, 0, 1);
      for (let index = 0; index < visual.lanes.length; index++) {
        const lane = visual.lanes[index];
        const beam = state.forgeBeams.find((candidate) => candidate.index === index);
        lane.column.visible = true;
        lane.active = beam?.active ?? false;
        lane.warning = beam?.warning ?? false;
        lane.column.userData.active = lane.active;
        lane.column.userData.warning = lane.warning;
        const laneIgnited = lane.active && beamsIgnited;
        lane.core.visible = laneIgnited;
        lane.sheath.visible = laneIgnited;
        lane.impact.visible = laneIgnited;
        if (!beam) continue;
        const columnGround = this.groundY(beam.columnX, beam.columnZ);
        const impactGround = this.groundY(beam.impactX, beam.impactZ);
        lane.column.position.set(beam.columnX, columnGround, beam.columnZ);
        lane.start.set(beam.columnX, columnGround + BEAM_HEIGHT, beam.columnZ);
        lane.end.set(
          beam.impactX,
          impactGround + (beam.blocked ? BLOCKED_IMPACT_HEIGHT : FORGE_IMPACT_HEIGHT),
          beam.impactZ,
        );
        setBeamBetween(lane.sheath, lane.start, lane.end, this.direction);
        setBeamBetween(lane.core, lane.start, lane.end, this.direction);
        lane.impact.position.copy(lane.end);
        lane.blocked = beam.blocked;
        lane.impact.userData.blocked = beam.blocked;
        lane.impact.userData.blockerId = beam.blockerId;
        const signalColor = beam.blocked ? 0x8ff8ff : 0xff4b0b;
        lane.impact.material.color.setHex(signalColor);
        lane.sheath.material.color.setHex(signalColor);
        lane.core.material.color.setHex(beam.blocked ? 0xffffff : 0xffe07a);
        for (const material of lane.columnGlowMaterials) {
          material.color.setHex(
            beam.active ? (beam.blocked ? 0x6befff : 0xff6b16) : beam.warning ? 0xffb52e : 0x3a1712,
          );
          material.opacity = beam.active
            ? beamsIgnited
              ? 0.82
              : 0.24 + visual.warmupFraction * 0.48
            : beam.warning
              ? 0.34
              : 0.1;
        }
      }

      visual.heatMeter.position.set(
        state.forgeX,
        this.groundY(state.forgeX, state.forgeZ) + 6.2,
        state.forgeZ,
      );
      visual.heatMeter.visible = true;
      const filledCount = Math.ceil(THREE.MathUtils.clamp(state.forgeOverheat, 0, 1) * 10 - 1e-8);
      const heatPercent = Math.round(THREE.MathUtils.clamp(state.forgeOverheat, 0, 1) * 100);
      const meltdown = state.forgeMeltdownRemaining > 0;
      const i18nRevision = getI18nRevision();
      const waveVisible = state.phase === 'adds' && state.addWaves > 0;
      visual.waveLabel.visible = waveVisible;
      if (
        waveVisible &&
        (state.addWave !== visual.renderedAddWave ||
          state.addWaves !== visual.renderedAddWaves ||
          state.addsRemaining !== visual.renderedAddsRemaining ||
          i18nRevision !== visual.renderedWaveI18nRevision)
      ) {
        paintWaveLabel(visual, state.addWave, state.addWaves, state.addsRemaining);
        visual.renderedAddWave = state.addWave;
        visual.renderedAddWaves = state.addWaves;
        visual.renderedAddsRemaining = state.addsRemaining;
        visual.renderedWaveI18nRevision = i18nRevision;
      }
      const heatLabelNeedsUpdate =
        heatPercent !== visual.renderedHeatPercent ||
        meltdown !== visual.renderedMeltdown ||
        i18nRevision !== visual.renderedHeatI18nRevision;
      if (filledCount !== visual.renderedHeatSegments || meltdown !== visual.renderedMeltdown) {
        const filledStates = visual.heatSegments.userData.filled as boolean[];
        for (let index = 0; index < HEAT_SEGMENTS; index++) {
          const filled = index < filledCount;
          filledStates[index] = filled;
          this.heatColor.setHex(
            filled
              ? meltdown
                ? 0xff1808
                : index >= 8
                  ? 0xff2410
                  : index >= 5
                    ? 0xff6b13
                    : 0xffbd32
              : 0x3a1712,
          );
          visual.heatSegments.setColorAt(index, this.heatColor);
        }
        if (visual.heatSegments.instanceColor) {
          visual.heatSegments.instanceColor.needsUpdate = true;
        }
        visual.renderedHeatSegments = filledCount;
        visual.renderedMeltdown = meltdown;
      }
      if (heatLabelNeedsUpdate) {
        paintHeatLabel(visual, heatPercent, meltdown);
        visual.renderedHeatPercent = heatPercent;
        visual.renderedHeatI18nRevision = i18nRevision;
      }
      visual.meltdownPlume.position.set(
        state.forgeX,
        this.groundY(state.forgeX, state.forgeZ) + 5,
        state.forgeZ,
      );
      visual.meltdownPlume.visible = meltdown;
      visual.motes.visible = visual.beamsActive && state.forgeBeamWarmupRemaining <= 0;
    }
    for (const [bossId, visual] of this.visuals) {
      if (this.activeBossIds.has(bossId)) continue;
      disposeVisual(visual);
      this.visuals.delete(bossId);
    }
  }

  update(dt: number, reducedMotion = false): void {
    for (const visual of this.visuals.values()) {
      if (!reducedMotion) visual.time = (visual.time + Math.max(0, dt)) % 1000;
      const pulse = reducedMotion ? 1 : 0.82 + Math.sin(visual.time * 8) * 0.18;
      for (const lane of visual.lanes) {
        if (lane.warning && !lane.active) {
          for (const material of lane.columnGlowMaterials) {
            material.opacity = reducedMotion ? 0.34 : 0.24 + pulse * 0.18;
          }
        }
        if (!lane.active) continue;
        lane.core.material.opacity = (0.42 + visual.warmupFraction * 0.54) * pulse;
        lane.sheath.material.opacity = (0.12 + visual.warmupFraction * 0.28) * pulse;
        lane.impact.material.opacity = lane.blocked ? 0.94 : 0.72;
        lane.impact.scale.setScalar(reducedMotion ? 1 : 0.9 + pulse * 0.18);
      }
      visual.heatMeter.rotation.y = reducedMotion ? 0 : visual.time * 0.22;
      visual.meltdownPlume.scale.set(
        1,
        reducedMotion ? 1 : 0.88 + Math.sin(visual.time * 5) * 0.12,
        1,
      );
      visual.motes.visible = visual.beamsActive && !reducedMotion && visual.warmupFraction >= 1;
      if (!visual.motes.visible) continue;
      for (let index = 0; index < MOTE_COUNT; index++) {
        const lane =
          visual.lanes[0].active && visual.lanes[1].active
            ? visual.lanes[index % 2]
            : visual.lanes[0].active
              ? visual.lanes[0]
              : visual.lanes[1];
        const step = Math.floor(index / 2);
        const progress = (visual.time * 0.72 + step / (MOTE_COUNT / 2)) % 1;
        this.motePosition.lerpVectors(lane.start, lane.end, progress);
        this.motePosition.y += Math.sin(visual.time * 9 + index * 1.7) * 0.16;
        const scale = 0.75 + ((index * 13) % 5) * 0.08;
        this.moteScale.setScalar(scale);
        this.moteMatrix.compose(this.motePosition, this.moteQuaternion, this.moteScale);
        visual.motes.setMatrixAt(index, this.moteMatrix);
      }
      visual.motes.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const visual of this.visuals.values()) disposeVisual(visual);
    this.visuals.clear();
    this.activeBossIds.clear();
  }
}
