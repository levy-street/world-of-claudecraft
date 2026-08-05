import * as THREE from 'three';
import { groundHeight } from '../sim/world';
import {
  type PlayerAuraOrnamentKind,
  type PlayerAuraRingQualityProfile,
  type PlayerAuraRingQualityTier,
  planPlayerAuraRings,
  playerAuraOrnamentSpec,
  playerAuraRingQualityProfile,
} from './player_aura_rings_core';
import { drapeRingLocalY } from './selection_ring';

export interface PlayerAuraRingInput {
  id: string;
  visible: boolean;
  color: string;
  opacity: number;
  scale: number;
}

interface DrapedMesh {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  localXZ: Float32Array;
  drapeY: Float32Array;
}

interface RingView {
  core: DrapedMesh;
  glow: DrapedMesh;
  ornaments: THREE.InstancedMesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  ornamentCount: number;
  ornamentRadius: number;
  ornamentSize: number;
  ornamentMaterial: THREE.MeshBasicMaterial;
  angularSpeed: number;
  opacity: number;
  phase: number;
  quality: PlayerAuraRingQualityProfile;
  visible: boolean;
  reducedMotionSettled: boolean;
}

const ornamentGeometries = new Map<PlayerAuraOrnamentKind, THREE.ShapeGeometry>();

function ornamentGeometry(kind: PlayerAuraOrnamentKind): THREE.ShapeGeometry {
  const cached = ornamentGeometries.get(kind);
  if (cached) return cached;
  const points: readonly [number, number][] =
    kind === 'shield'
      ? [
          [-0.7, 0.58],
          [0.7, 0.58],
          [0.62, -0.2],
          [0, -0.9],
          [-0.62, -0.2],
        ]
      : kind === 'triangle'
        ? [
            [-0.72, 0.58],
            [0.72, 0.58],
            [0, -0.9],
          ]
        : kind === 'diamond'
          ? [
              [0, 0.85],
              [0.68, 0],
              [0, -0.85],
              [-0.68, 0],
            ]
          : [
              [-0.85, 0.52],
              [-0.24, 0],
              [-0.85, -0.52],
              [-0.42, -0.78],
              [0.3, 0],
              [-0.42, 0.78],
            ];
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  ornamentGeometries.set(kind, geometry);
  return geometry;
}

function ornamentMaterial(color: THREE.Color, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
}

function buildDrapedMesh(
  innerRadius: number,
  outerRadius: number,
  color: THREE.Color,
  opacity: number,
  radialSegments: number,
): DrapedMesh {
  const geometry = new THREE.RingGeometry(innerRadius, outerRadius, radialSegments);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const localXZ = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i++) {
    localXZ[i * 2] = positions.getX(i);
    localXZ[i * 2 + 1] = positions.getZ(i);
  }
  return { mesh, localXZ, drapeY: new Float32Array(positions.count) };
}

function disposeDrapedMesh(view: DrapedMesh): void {
  view.mesh.geometry.dispose();
  view.mesh.material.dispose();
}

/**
 * Player-only 3D proc rings. Configuration and proc matching stay in the HUD;
 * this class only owns reusable Three geometry and terrain presentation.
 */
export class PlayerAuraRings {
  readonly group = new THREE.Group();
  private views: RingView[] = [];
  private signature = '';
  private anchorX = Number.NaN;
  private anchorZ = Number.NaN;
  private baseY = Number.NaN;
  private seed = 0;
  private supportY = Number.NEGATIVE_INFINITY;
  private readonly ornamentTransform = new THREE.Object3D();
  private readonly sampleGround = (x: number, z: number): number =>
    Math.max(groundHeight(x, z, this.seed), this.supportY);

  constructor(
    private readonly tier: PlayerAuraRingQualityTier,
    private readonly bloom: boolean,
  ) {
    this.group.name = 'player_aura_rings';
    this.group.visible = false;
  }

  setRings(inputs: readonly PlayerAuraRingInput[]): void {
    const nextSignature = inputs.map((input) => `${input.id}:${input.scale.toFixed(3)}`).join('|');
    if (nextSignature !== this.signature) {
      this.signature = nextSignature;
      for (const view of this.views) {
        disposeDrapedMesh(view.core);
        disposeDrapedMesh(view.glow);
        view.ornamentMaterial.dispose();
      }
      this.group.clear();
      this.views = [];
      const layout = planPlayerAuraRings(inputs);
      for (let i = 0; i < layout.length; i++) {
        const band = layout[i];
        const input = inputs[i];
        const ornamentSpec = playerAuraOrnamentSpec(input.id);
        const quality = playerAuraRingQualityProfile(this.tier, ornamentSpec.count, this.bloom);
        const color = new THREE.Color(input.color);
        const coreColor = color.clone().multiplyScalar(quality.coreColorGain);
        const glowColor = color.clone().multiplyScalar(quality.glowColorGain);
        const core = buildDrapedMesh(
          band.innerRadius,
          band.outerRadius,
          coreColor,
          input.opacity,
          quality.radialSegments,
        );
        const glowWidth = Math.max(0.045, (band.outerRadius - band.innerRadius) * 0.8);
        const glow = buildDrapedMesh(
          Math.max(0.05, band.innerRadius - glowWidth),
          band.outerRadius + glowWidth,
          glowColor,
          input.opacity * 0.2,
          quality.radialSegments,
        );
        const ornamentColor = color.clone().multiplyScalar(quality.ornamentColorGain);
        const decorMaterial = ornamentMaterial(ornamentColor, input.opacity * 0.82);
        const decorGeometry = ornamentGeometry(ornamentSpec.kind);
        const ornamentRadius = (band.innerRadius + band.outerRadius) / 2;
        const ornaments = new THREE.InstancedMesh(
          decorGeometry,
          decorMaterial,
          quality.ornamentCount,
        );
        ornaments.name = `player_aura_ornament_${input.id}_${ornamentSpec.kind}`;
        ornaments.userData.auraProcId = input.id;
        ornaments.frustumCulled = false;
        this.group.add(ornaments, glow.mesh, core.mesh);
        this.views.push({
          core,
          glow,
          ornaments,
          ornamentCount: quality.ornamentCount,
          ornamentRadius,
          ornamentSize: ornamentSpec.size,
          ornamentMaterial: decorMaterial,
          angularSpeed: ornamentSpec.angularSpeed,
          opacity: input.opacity,
          phase: i * 1.7,
          quality,
          visible: input.visible,
          reducedMotionSettled: false,
        });
      }
      this.anchorX = Number.NaN;
    }
    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i];
      const input = inputs[i];
      if ((input.visible && !view.visible) || input.opacity !== view.opacity) {
        view.reducedMotionSettled = false;
      }
      view.visible = input.visible;
      view.opacity = input.opacity;
      view.core.mesh.visible = input.visible;
      view.glow.mesh.visible = input.visible;
      view.ornaments.visible = input.visible;
      view.core.mesh.material.color.set(input.color).multiplyScalar(view.quality.coreColorGain);
      view.glow.mesh.material.color.set(input.color).multiplyScalar(view.quality.glowColorGain);
      view.ornamentMaterial.color.set(input.color).multiplyScalar(view.quality.ornamentColorGain);
    }
    this.group.visible = this.hasVisibleRings();
  }

  hasVisibleRings(): boolean {
    for (const view of this.views) {
      if (view.visible) return true;
    }
    return false;
  }

  update(
    visible: boolean,
    x: number,
    z: number,
    baseY: number,
    seed: number,
    supportY: number,
    time: number,
    reducedMotion = false,
  ): void {
    this.group.visible = visible && this.hasVisibleRings();
    if (!this.group.visible) return;
    this.group.position.set(x, baseY, z);
    const moved =
      x !== this.anchorX ||
      z !== this.anchorZ ||
      baseY !== this.baseY ||
      seed !== this.seed ||
      supportY !== this.supportY;
    if (moved) {
      this.anchorX = x;
      this.anchorZ = z;
      this.baseY = baseY;
      this.seed = seed;
      this.supportY = supportY;
    }
    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i];
      if (!view.visible) continue;
      if (reducedMotion && !moved && view.reducedMotionSettled) continue;
      if (moved) {
        for (const [meshView, lift] of [
          [view.glow, 0.045 + i * 0.003],
          [view.core, 0.055 + i * 0.003],
        ] as const) {
          const drape = drapeRingLocalY(
            meshView.localXZ,
            x,
            z,
            baseY,
            1,
            lift,
            this.sampleGround,
            meshView.drapeY,
          );
          const positions = meshView.mesh.geometry.getAttribute(
            'position',
          ) as THREE.BufferAttribute;
          for (let vertex = 0; vertex < drape.length; vertex++) {
            positions.setY(vertex, drape[vertex]);
          }
          positions.needsUpdate = true;
        }
      }
      const pulse = reducedMotion ? 1 : 0.86 + 0.14 * Math.sin(time * 4.2 + view.phase);
      view.core.mesh.material.opacity = view.opacity * pulse;
      view.glow.mesh.material.opacity =
        view.opacity * (view.quality.glowBaseOpacity + view.quality.glowPulseOpacity * pulse);
      view.ornamentMaterial.opacity =
        view.opacity *
        (view.quality.ornamentBaseOpacity + view.quality.ornamentPulseOpacity * pulse);
      for (let ornamentIndex = 0; ornamentIndex < view.ornamentCount; ornamentIndex++) {
        const baseAngle = (ornamentIndex / view.ornamentCount) * Math.PI * 2;
        const angle = baseAngle + (reducedMotion ? 0 : time * view.angularSpeed);
        const localX = Math.cos(angle) * view.ornamentRadius;
        const localZ = Math.sin(angle) * view.ornamentRadius;
        this.ornamentTransform.position.set(
          localX,
          this.sampleGround(x + localX, z + localZ) + 0.065 + i * 0.003 - baseY,
          localZ,
        );
        this.ornamentTransform.rotation.set(0, -Math.PI / 2 - angle, 0);
        this.ornamentTransform.scale.setScalar(view.ornamentSize);
        this.ornamentTransform.updateMatrix();
        view.ornaments.setMatrixAt(ornamentIndex, this.ornamentTransform.matrix);
      }
      view.ornaments.instanceMatrix.needsUpdate = true;
      view.reducedMotionSettled = reducedMotion;
    }
  }
}
