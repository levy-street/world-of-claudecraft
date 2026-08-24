import * as THREE from 'three';
import { type GroundAimGeometryState, sameGroundAimGeometry } from './ground_aim_reticle_core';

const SEGMENTS = 96;
const RANGE_LIFT = 0.095;
const TICK_LIFT = 0.1;

export interface AbilityRangeVisualState {
  x: number;
  z: number;
  radius: number;
  color: number;
}

/** Thin player-centered guide whose edge is the prepared skill's maximum range. */
export class AbilityRangeReticleVisual {
  readonly group = new THREE.Group();

  private readonly circleGeometry = new THREE.BufferGeometry();
  private readonly tickGeometry = new THREE.BufferGeometry();
  private readonly circleMaterial = material(0.58);
  private readonly tickMaterial = material(0.82);
  private readonly circle: THREE.LineLoop;
  private readonly ticks: THREE.LineSegments;
  private readonly geometryState: GroundAimGeometryState = {
    x: Number.NaN,
    z: Number.NaN,
    radius: Number.NaN,
  };
  private elapsed = 0;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly heightAt: (x: number, z: number) => number,
    private readonly colorBoost = 1,
  ) {
    this.group.name = 'ability-range-reticle';
    this.group.visible = false;
    this.circleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(SEGMENTS * 3), 3),
    );
    this.tickGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(4 * 2 * 3), 3),
    );
    this.circle = new THREE.LineLoop(this.circleGeometry, this.circleMaterial);
    this.circle.name = 'ability-range-edge';
    this.ticks = new THREE.LineSegments(this.tickGeometry, this.tickMaterial);
    this.ticks.name = 'ability-range-ticks';
    for (const object of [this.circle, this.ticks]) {
      object.frustumCulled = false;
      object.renderOrder = 3;
      this.group.add(object);
    }
    this.scene.add(this.group);
  }

  setRange(range: AbilityRangeVisualState | null): void {
    if (this.disposed) return;
    if (!range || range.radius <= 0) {
      this.group.visible = false;
      this.geometryState.x = Number.NaN;
      this.geometryState.z = Number.NaN;
      this.geometryState.radius = Number.NaN;
      return;
    }
    if (!sameGroundAimGeometry(this.geometryState, range.x, range.z, range.radius)) {
      this.rebuild(range.x, range.z, range.radius);
      this.geometryState.x = range.x;
      this.geometryState.z = range.z;
      this.geometryState.radius = range.radius;
    }
    for (const rangeMaterial of [this.circleMaterial, this.tickMaterial]) {
      rangeMaterial.color.setHex(range.color);
      rangeMaterial.color.multiplyScalar(this.colorBoost);
    }
    this.group.visible = true;
    this.applyOpacity();
  }

  update(dt: number): void {
    if (!this.group.visible || this.disposed) return;
    this.elapsed += Math.max(0, dt);
    this.applyOpacity();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.group);
    this.circleGeometry.dispose();
    this.tickGeometry.dispose();
    this.circleMaterial.dispose();
    this.tickMaterial.dispose();
  }

  private rebuild(cx: number, cz: number, radius: number): void {
    const circlePositions = this.circleGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      const x = cx + Math.cos(angle) * radius;
      const z = cz + Math.sin(angle) * radius;
      circlePositions.setXYZ(i, x, this.heightAt(x, z) + RANGE_LIFT, z);
    }
    circlePositions.needsUpdate = true;

    const tickPositions = this.tickGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      for (let end = 0; end < 2; end++) {
        const tickRadius = radius * (end === 0 ? 0.96 : 1.04);
        const x = cx + cos * tickRadius;
        const z = cz + sin * tickRadius;
        tickPositions.setXYZ(i * 2 + end, x, this.heightAt(x, z) + TICK_LIFT, z);
      }
    }
    tickPositions.needsUpdate = true;
  }

  private applyOpacity(): void {
    const pulse = 0.88 + 0.12 * Math.sin(this.elapsed * Math.PI * 2 * 1.5);
    this.circleMaterial.opacity = 0.58 * pulse;
    this.tickMaterial.opacity = 0.82 * pulse;
  }
}

function material(opacity: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
}
