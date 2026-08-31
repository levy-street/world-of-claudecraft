// POWERFUL VFX prompt:
// A forge arena is consumed from the perimeter inward by one continuous field
// of living fire. It reuses the Cinder Orb puddle's molten-crack floor and
// flipbook flame atlas. One ground-level ring marks the shrinking safe circle
// and a central countdown states when the whole crucible will burn. There is
// deliberately no smoke.

import * as THREE from 'three';
import { VARKHUL_MASTERPIECE_UNBOUND_AURA_ID } from '../sim/encounters/varkhul';
import {
  type ActiveVarkhulAssembly,
  VARKHUL_ASSEMBLY_FORGE_LOCAL_POS,
} from '../sim/varkhul_assembly';
import {
  VARKHUL_WORLDFIRE_ARENA_RADIUS,
  VARKHUL_WORLDFIRE_STAGES,
  varkhulWorldfireMarkerRemaining,
  varkhulWorldfireSafeRadius,
  varkhulWorldfireStage,
} from '../sim/varkhul_worldfire';
import { formatDuration, getI18nRevision } from '../ui/i18n';
import { createGroundFireAoe, type GroundFireAoeHandle } from './ignivar_fire_vfx';

const WORLDFIRE_FLAMES = 168;
const FLOOR_LIFT = 0.08;
const FIRE_FIELD_LIFT = 0.12;
const COUNTDOWN_FONT_MAX_PX = 62;
const COUNTDOWN_FONT_MIN_PX = 24;
const COUNTDOWN_LABEL_MAX_WIDTH_PX = 252;

export function varkhulWorldfireCountdownFontSize(measuredAtMaxPx: number): number {
  if (!Number.isFinite(measuredAtMaxPx) || measuredAtMaxPx <= 0) return COUNTDOWN_FONT_MAX_PX;
  return Math.max(
    COUNTDOWN_FONT_MIN_PX,
    Math.min(
      COUNTDOWN_FONT_MAX_PX,
      Math.floor((COUNTDOWN_FONT_MAX_PX * COUNTDOWN_LABEL_MAX_WIDTH_PX) / measuredAtMaxPx),
    ),
  );
}

interface WorldfireEntity {
  auras: readonly { id: string; remaining: number; duration: number; permanent?: boolean }[];
}

interface WorldfireVisual {
  root: THREE.Group;
  fireField: GroundFireAoeHandle;
  boundaryRing: THREE.Mesh;
  countdown: THREE.Sprite;
  countdownCanvas: HTMLCanvasElement;
  countdownTexture: THREE.CanvasTexture;
  stage: number;
  untilFullSecond: number;
  i18nRevision: number;
  time: number;
}

function material(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function buildCountdown(): {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
} {
  const canvas =
    typeof document === 'undefined'
      ? ({ width: 320, height: 112, getContext: () => null } as unknown as HTMLCanvasElement)
      : document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 112;
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
  sprite.name = 'varkhul-worldfire-countdown';
  sprite.scale.set(7.2, 2.52, 1);
  sprite.renderOrder = 21;
  sprite.userData.actionable = true;
  return { sprite, canvas, texture };
}

function paintCountdown(visual: WorldfireVisual, seconds: number): void {
  const label = formatDuration(seconds);
  visual.countdown.userData.seconds = seconds;
  visual.countdown.userData.label = label;
  const ctx = visual.countdownCanvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, visual.countdownCanvas.width, visual.countdownCanvas.height);
  ctx.fillStyle = 'rgba(24, 4, 1, 0.9)';
  ctx.beginPath();
  ctx.roundRect(22, 14, 276, 84, 24);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = seconds <= 10 ? '#fff1b0' : '#ff6a18';
  ctx.stroke();
  ctx.font = `bold ${COUNTDOWN_FONT_MAX_PX}px system-ui, sans-serif`;
  const fontSize = varkhulWorldfireCountdownFontSize(ctx.measureText(label).width);
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, 160, 57, COUNTDOWN_LABEL_MAX_WIDTH_PX);
  visual.countdown.userData.fontSize = fontSize;
  visual.countdown.userData.maxLabelWidth = COUNTDOWN_LABEL_MAX_WIDTH_PX;
  visual.countdownTexture.needsUpdate = true;
}

function createVisual(bossId: number): WorldfireVisual {
  const root = new THREE.Group();
  root.name = `varkhul-worldfire-${bossId}`;
  root.userData.renderCategory = 'ui3d';
  root.userData.actionable = true;

  const fireField = createGroundFireAoe({
    radius: VARKHUL_WORLDFIRE_ARENA_RADIUS,
    innerRadius: varkhulWorldfireSafeRadius(0),
    count: WORLDFIRE_FLAMES,
    localTime: true,
    dynamicInnerRadius: true,
  });
  fireField.group.name = 'varkhul-worldfire-field';
  // The arena floor is broad and nearly coplanar with this transparent disc.
  // Give Worldfire extra separation and depth bias so camera movement cannot
  // alternate the molten surface with the dungeon floor on different GPUs.
  fireField.group.position.y = FIRE_FIELD_LIFT;
  const fireSurface = fireField.group.getObjectByName('ground_fire_aoe__disc') as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >;
  fireSurface.material.polygonOffsetFactor = -4;
  fireSurface.material.polygonOffsetUnits = -4;
  fireField.erupt(true);
  root.add(fireField.group);

  const boundaryRing = new THREE.Mesh(
    new THREE.RingGeometry(0.965, 1.035, 96).rotateX(-Math.PI / 2),
    material(0xffe06a, 0.94),
  );
  boundaryRing.name = 'varkhul-worldfire-safe-edge';
  boundaryRing.position.y = 0.07;
  boundaryRing.renderOrder = 14;
  root.add(boundaryRing);

  const countdown = buildCountdown();
  countdown.sprite.position.set(0, 8, 0);
  root.add(countdown.sprite);

  return {
    root,
    fireField,
    boundaryRing,
    countdown: countdown.sprite,
    countdownCanvas: countdown.canvas,
    countdownTexture: countdown.texture,
    stage: -1,
    untilFullSecond: -1,
    i18nRevision: -1,
    time: 0,
  };
}

function syncVisual(
  visual: WorldfireVisual,
  stage: number,
  safeRadius: number,
  untilFull: number,
): void {
  visual.root.userData.stage = stage;
  visual.root.userData.safeRadius = safeRadius;
  visual.root.userData.full = stage >= VARKHUL_WORLDFIRE_STAGES;
  if (visual.stage !== stage) visual.stage = stage;
  visual.fireField.setInnerRadius(safeRadius);
  visual.boundaryRing.visible = safeRadius > 0;
  visual.boundaryRing.scale.set(safeRadius, 1, safeRadius);
  const untilFullSecond = Math.ceil(untilFull);
  const revision = getI18nRevision();
  if (untilFullSecond !== visual.untilFullSecond || revision !== visual.i18nRevision) {
    paintCountdown(visual, untilFullSecond);
    visual.untilFullSecond = untilFullSecond;
    visual.i18nRevision = revision;
  }
}

function disposeVisual(visual: WorldfireVisual): void {
  visual.fireField.dispose();
  visual.boundaryRing.geometry.dispose();
  (visual.boundaryRing.material as THREE.Material).dispose();
  (visual.countdown.material as THREE.SpriteMaterial).dispose();
  visual.countdownTexture.dispose();
  visual.root.removeFromParent();
}

export function buildVarkhulWorldfirePrewarmVisual(): THREE.Group {
  const visual = createVisual(0);
  // Exercise the full field and the still-actionable boundary geometry.
  syncVisual(visual, VARKHUL_WORLDFIRE_STAGES, varkhulWorldfireSafeRadius(5), 0);
  visual.root.name = 'varkhul-worldfire-prewarm';
  return visual.root;
}

export class VarkhulWorldfireVisuals {
  private readonly visuals = new Map<number, WorldfireVisual>();
  private readonly activeBossIds = new Set<number>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  sync(
    assemblies: readonly ActiveVarkhulAssembly[],
    entities: ReadonlyMap<number, WorldfireEntity>,
  ): void {
    this.activeBossIds.clear();
    for (const assembly of assemblies) {
      if (assembly.difficulty !== 'heroic') continue;
      const boss = entities.get(assembly.bossId);
      let remaining = -1;
      if (boss) {
        for (const aura of boss.auras) {
          if (aura.id !== VARKHUL_MASTERPIECE_UNBOUND_AURA_ID) continue;
          remaining = varkhulWorldfireMarkerRemaining(aura.remaining, aura.permanent);
          break;
        }
      }
      if (remaining < 0) continue;
      const centerX = assembly.forgeX - VARKHUL_ASSEMBLY_FORGE_LOCAL_POS.x;
      const centerZ = assembly.forgeZ - VARKHUL_ASSEMBLY_FORGE_LOCAL_POS.z;
      const stage = varkhulWorldfireStage(remaining);
      const safeRadius = varkhulWorldfireSafeRadius(stage);
      const untilFull = Math.max(0, remaining - 3);
      this.activeBossIds.add(assembly.bossId);
      let visual = this.visuals.get(assembly.bossId);
      if (!visual) {
        visual = createVisual(assembly.bossId);
        this.visuals.set(assembly.bossId, visual);
        this.scene.add(visual.root);
      }
      visual.root.position.set(
        centerX,
        this.groundY(centerX + VARKHUL_WORLDFIRE_ARENA_RADIUS * 0.5, centerZ) + FLOOR_LIFT,
        centerZ,
      );
      syncVisual(visual, stage, safeRadius, untilFull);
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
      visual.fireField.update(reducedMotion ? 0 : dt);
      const pulse = reducedMotion ? 1 : 0.84 + Math.sin(visual.time * 6.5) * 0.16;
      (visual.boundaryRing.material as THREE.MeshBasicMaterial).opacity = 0.78 + pulse * 0.18;
    }
  }

  dispose(): void {
    for (const visual of this.visuals.values()) disposeVisual(visual);
    this.visuals.clear();
    this.activeBossIds.clear();
  }
}
