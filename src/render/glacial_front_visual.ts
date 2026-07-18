import * as THREE from 'three';
import {
  empoweredCastProgress,
  empoweredStageForProgress,
  GLACIAL_FRONT_ANGLE_DEG,
  glacialFrontPresentationRange,
} from '../sim/combat/glacial_front';
import type { Entity } from '../sim/types';

const BURST_LIFETIME = 0.68;
const BURST_POOL_SIZE = 5;
const SEGMENTS = 28;
const PREVIEW_RADIAL_SEGMENTS = 10;
const BURST_RADIAL_SEGMENTS = 4;
const PREVIEW_CLEARANCE = 0.12;
const BURST_CLEARANCE = 0.08;
const DRAGONS_BREATH_RANGES = [6, 8, 10, 12] as const;
const DRAGONS_BREATH_ANGLES = [55, 65, 78, 90] as const;

function rewriteSectorGeometry(
  geometry: THREE.BufferGeometry,
  inner: number,
  outer: number,
  angleDeg: number,
  radialSegments = 1,
): void {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const half = (angleDeg * Math.PI) / 360;
  let cursor = 0;
  for (let radial = 0; radial < radialSegments; radial++) {
    const radialInner = inner + ((outer - inner) * radial) / radialSegments;
    const radialOuter = inner + ((outer - inner) * (radial + 1)) / radialSegments;
    for (let i = 0; i < SEGMENTS; i++) {
      const a0 = -half + (i / SEGMENTS) * half * 2;
      const a1 = -half + ((i + 1) / SEGMENTS) * half * 2;
      positions.setX(cursor, Math.sin(a0) * radialInner);
      positions.setZ(cursor++, Math.cos(a0) * radialInner);
      positions.setX(cursor, Math.sin(a0) * radialOuter);
      positions.setZ(cursor++, Math.cos(a0) * radialOuter);
      positions.setX(cursor, Math.sin(a1) * radialOuter);
      positions.setZ(cursor++, Math.cos(a1) * radialOuter);
      positions.setX(cursor, Math.sin(a0) * radialInner);
      positions.setZ(cursor++, Math.cos(a0) * radialInner);
      positions.setX(cursor, Math.sin(a1) * radialOuter);
      positions.setZ(cursor++, Math.cos(a1) * radialOuter);
      positions.setX(cursor, Math.sin(a1) * radialInner);
      positions.setZ(cursor++, Math.cos(a1) * radialInner);
    }
  }
  positions.needsUpdate = true;
}

function sectorGeometry(
  inner: number,
  outer: number,
  angleDeg: number,
  radialSegments = 1,
): THREE.BufferGeometry {
  const half = (angleDeg * Math.PI) / 360;
  const positions: number[] = [];
  for (let radial = 0; radial < radialSegments; radial++) {
    const radialInner = inner + ((outer - inner) * radial) / radialSegments;
    const radialOuter = inner + ((outer - inner) * (radial + 1)) / radialSegments;
    for (let i = 0; i < SEGMENTS; i++) {
      const a0 = -half + (i / SEGMENTS) * half * 2;
      const a1 = -half + ((i + 1) / SEGMENTS) * half * 2;
      const x0i = Math.sin(a0) * radialInner;
      const z0i = Math.cos(a0) * radialInner;
      const x1i = Math.sin(a1) * radialInner;
      const z1i = Math.cos(a1) * radialInner;
      const x0o = Math.sin(a0) * radialOuter;
      const z0o = Math.cos(a0) * radialOuter;
      const x1o = Math.sin(a1) * radialOuter;
      const z1o = Math.cos(a1) * radialOuter;
      positions.push(x0i, 0, z0i, x0o, 0, z0o, x1o, 0, z1o);
      positions.push(x0i, 0, z0i, x1o, 0, z1o, x1i, 0, z1i);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function rayGeometry(): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= PREVIEW_RADIAL_SEGMENTS; i++) {
    points.push(new THREE.Vector3(0, 0, i / PREVIEW_RADIAL_SEGMENTS));
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

interface BurstSlot {
  group: THREE.Group;
  sheets: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  elapsed: number;
  range: number;
  level: number;
}

/** Local charge telegraph plus pooled world-visible release wave. */
export class GlacialFrontVisual {
  readonly preview = new THREE.Group();
  private readonly previewFill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly previewRays: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>[];
  private readonly stageArcs: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>[] = [];
  private readonly bursts: BurstSlot[] = [];
  private nextBurst = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundHeight: (x: number, z: number) => number = () => 0,
  ) {
    this.preview.name = 'glacial-front-charge-preview';
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x63cfff,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.previewFill = new THREE.Mesh(
      sectorGeometry(0, 1, GLACIAL_FRONT_ANGLE_DEG, PREVIEW_RADIAL_SEGMENTS),
      fillMat,
    );
    this.previewFill.renderOrder = 12;
    this.preview.add(this.previewFill);

    const rayMat = new THREE.LineBasicMaterial({
      color: 0xb8edff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const half = (GLACIAL_FRONT_ANGLE_DEG * Math.PI) / 360;
    this.previewRays = [-half, half].map((angle) => {
      const line = new THREE.Line(rayGeometry(), rayMat);
      line.rotation.y = angle;
      line.renderOrder = 13;
      this.preview.add(line);
      return line;
    });

    for (const radius of [7, 10, 13, 16]) {
      const material = rayMat.clone();
      material.opacity = 0.58;
      const arc = new THREE.Line(
        new THREE.EdgesGeometry(sectorGeometry(radius - 0.035, radius, GLACIAL_FRONT_ANGLE_DEG)),
        material,
      );
      arc.renderOrder = 13;
      this.stageArcs.push(arc);
      this.preview.add(arc);
    }
    this.preview.visible = false;
    this.scene.add(this.preview);

    const waveGeometry = sectorGeometry(0.72, 1, GLACIAL_FRONT_ANGLE_DEG, BURST_RADIAL_SEGMENTS);
    for (let i = 0; i < BURST_POOL_SIZE; i++) {
      const group = new THREE.Group();
      group.name = 'glacial-front-release';
      const sheets: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
      for (let layer = 0; layer < 3; layer++) {
        const material = new THREE.MeshBasicMaterial({
          color: layer === 0 ? 0xd8f6ff : layer === 1 ? 0x69d7ff : 0x307fc7,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });
        const sheet = new THREE.Mesh(waveGeometry.clone(), material);
        sheet.position.y = 0.05 + layer * 0.11;
        sheet.renderOrder = 14 + layer;
        group.add(sheet);
        sheets.push(sheet);
      }
      group.visible = false;
      this.scene.add(group);
      this.bursts.push({ group, sheets, elapsed: BURST_LIFETIME, range: 1, level: 1 });
    }
  }

  private drape(
    geometry: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
    facing: number,
    scaleX: number,
    scaleZ: number,
    clearance: number,
  ): void {
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const sin = Math.sin(facing);
    const cos = Math.cos(facing);
    for (let i = 0; i < positions.count; i++) {
      const lx = positions.getX(i) * scaleX;
      const lz = positions.getZ(i) * scaleZ;
      const wx = x + lx * cos + lz * sin;
      const wz = z - lx * sin + lz * cos;
      positions.setY(i, this.groundHeight(wx, wz) - y + clearance);
    }
    positions.needsUpdate = true;
  }

  updateCharge(caster: Entity, dt: number, groundY: number): void {
    const fire = caster.castingAbility === 'dragons_breath';
    const active = (caster.castingAbility === 'glacial_front' || fire) && caster.castTotal > 0;
    this.preview.visible = active;
    if (!active) return;
    const progress = empoweredCastProgress(caster.castTotal, caster.castRemaining);
    const stage = empoweredStageForProgress(progress, 4);
    const range = fire ? DRAGONS_BREATH_RANGES[stage - 1] : glacialFrontPresentationRange(progress);
    const angle = fire ? DRAGONS_BREATH_ANGLES[stage - 1] : GLACIAL_FRONT_ANGLE_DEG;
    rewriteSectorGeometry(this.previewFill.geometry, 0, 1, angle, PREVIEW_RADIAL_SEGMENTS);
    this.preview.position.set(caster.pos.x, groundY, caster.pos.z);
    this.preview.rotation.y = caster.facing;
    this.previewFill.scale.set(range, 1, range);
    this.drape(
      this.previewFill.geometry,
      caster.pos.x,
      groundY,
      caster.pos.z,
      caster.facing,
      range,
      range,
      PREVIEW_CLEARANCE,
    );
    for (const ray of this.previewRays) {
      ray.scale.z = range;
      ray.rotation.y =
        ray === this.previewRays[0] ? -angle * (Math.PI / 360) : angle * (Math.PI / 360);
      this.drape(
        ray.geometry,
        caster.pos.x,
        groundY,
        caster.pos.z,
        caster.facing + ray.rotation.y,
        1,
        range,
        PREVIEW_CLEARANCE,
      );
    }
    for (let i = 0; i < this.stageArcs.length; i++) {
      this.stageArcs[i].visible = !fire && i < stage;
      this.drape(
        this.stageArcs[i].geometry,
        caster.pos.x,
        groundY,
        caster.pos.z,
        caster.facing,
        1,
        1,
        PREVIEW_CLEARANCE,
      );
      (this.stageArcs[i].material as THREE.LineBasicMaterial).color.setHex(
        fire ? 0xff8a2a : i === stage - 1 ? 0xe9fbff : 0x69cfff,
      );
    }
    this.previewFill.material.color.setHex(fire ? 0xff682e : 0x63cfff);
    for (const ray of this.previewRays)
      (ray.material as THREE.LineBasicMaterial).color.setHex(fire ? 0xffd0a8 : 0xb8edff);
    this.previewFill.material.opacity = 0.17 + stage * 0.035 + Math.sin(progress * 28) * 0.025;
    this.preview.position.y += Math.sin(progress * 18) * Math.min(0.012, Math.max(0, dt));
  }

  spawn(
    x: number,
    y: number,
    z: number,
    facing: number,
    range: number,
    level: number,
    angle = GLACIAL_FRONT_ANGLE_DEG,
    fx: 'frostCone' | 'fireCone' = 'frostCone',
  ): void {
    const slot = this.bursts[this.nextBurst];
    this.nextBurst = (this.nextBurst + 1) % this.bursts.length;
    slot.elapsed = 0;
    slot.range = range;
    slot.level = level;
    slot.group.position.set(x, y, z);
    slot.group.rotation.y = facing;
    slot.group.visible = true;
    const colors =
      fx === 'fireCone' ? [0xfff0cf, 0xff8a2a, 0xd62f16] : [0xd8f6ff, 0x69d7ff, 0x307fc7];
    for (let i = 0; i < slot.sheets.length; i++) {
      rewriteSectorGeometry(slot.sheets[i].geometry, 0.72, 1, angle, BURST_RADIAL_SEGMENTS);
      slot.sheets[i].material.color.setHex(colors[i]);
    }
  }

  update(dt: number): void {
    for (const slot of this.bursts) {
      if (slot.elapsed >= BURST_LIFETIME) continue;
      slot.elapsed = Math.min(BURST_LIFETIME, slot.elapsed + Math.max(0, dt));
      const t = slot.elapsed / BURST_LIFETIME;
      const travel = 1 - (1 - t) * (1 - t) * (1 - t);
      const size = Math.max(0.04, slot.range * travel);
      slot.group.scale.set(size, 1, size);
      for (let i = 0; i < slot.sheets.length; i++) {
        const sheet = slot.sheets[i];
        const stagger = Math.max(0, Math.min(1, t * 1.35 - i * 0.1));
        sheet.material.opacity = (1 - stagger) * (0.72 - i * 0.13) * (0.7 + slot.level * 0.075);
        this.drape(
          sheet.geometry,
          slot.group.position.x,
          slot.group.position.y,
          slot.group.position.z,
          slot.group.rotation.y,
          size,
          size,
          BURST_CLEARANCE,
        );
      }
      if (slot.elapsed >= BURST_LIFETIME) slot.group.visible = false;
    }
  }
}
