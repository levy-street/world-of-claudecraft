import * as THREE from 'three';

const SEGMENTS = 96;
const INNER_GUIDE_RATIO = 0.62;
const BAND_INNER_RATIO = 0.82;
const OUTER_LIFT = 0.08;
const INNER_LIFT = 0.075;
const BAND_LIFT = 0.055;
const TICK_LIFT = 0.09;
const PULSE_HZ = 2;

export interface GroundAimVisualState {
  x: number;
  z: number;
  radius: number;
  color: number;
  dimmed: boolean;
}

/** Terrain-draped ground targeting guide. Its outer edge is the gameplay radius. */
export class GroundAimReticleVisual {
  readonly group = new THREE.Group();

  private readonly outerGeometry = circleGeometry();
  private readonly innerGeometry = circleGeometry();
  private readonly bandGeometry = bandGeometry();
  private readonly tickGeometry = tickGeometry();
  private readonly outerMaterial = lineMaterial();
  private readonly innerMaterial = lineMaterial();
  private readonly bandMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  private readonly tickMaterial = lineMaterial();
  private readonly outer: THREE.LineLoop;
  private readonly inner: THREE.LineLoop;
  private readonly band: THREE.Mesh;
  private readonly ticks: THREE.LineSegments;
  private elapsed = 0;
  private dimmed = false;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly heightAt: (x: number, z: number) => number,
    private readonly colorBoost = 1,
  ) {
    this.group.name = 'ground-aim-reticle';
    this.group.visible = false;

    this.band = new THREE.Mesh(this.bandGeometry, this.bandMaterial);
    this.band.name = 'ground-aim-band';
    this.outer = new THREE.LineLoop(this.outerGeometry, this.outerMaterial);
    this.outer.name = 'ground-aim-outer-edge';
    this.inner = new THREE.LineLoop(this.innerGeometry, this.innerMaterial);
    this.inner.name = 'ground-aim-inner-guide';
    this.ticks = new THREE.LineSegments(this.tickGeometry, this.tickMaterial);
    this.ticks.name = 'ground-aim-ticks';

    for (const object of [this.band, this.outer, this.inner, this.ticks]) {
      object.frustumCulled = false;
      object.renderOrder = 3;
      this.group.add(object);
    }
    this.scene.add(this.group);
  }

  setAim(aim: GroundAimVisualState | null): void {
    if (this.disposed) return;
    if (!aim) {
      this.group.visible = false;
      return;
    }

    this.rebuild(aim.x, aim.z, Math.max(0, aim.radius));
    this.dimmed = aim.dimmed;
    for (const material of [
      this.outerMaterial,
      this.innerMaterial,
      this.bandMaterial,
      this.tickMaterial,
    ]) {
      material.color.setHex(aim.color);
      material.color.multiplyScalar(this.colorBoost);
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
    this.outerGeometry.dispose();
    this.innerGeometry.dispose();
    this.bandGeometry.dispose();
    this.tickGeometry.dispose();
    this.outerMaterial.dispose();
    this.innerMaterial.dispose();
    this.bandMaterial.dispose();
    this.tickMaterial.dispose();
  }

  private rebuild(x: number, z: number, radius: number): void {
    writeCircle(this.outerGeometry, x, z, radius, OUTER_LIFT, this.heightAt);
    writeCircle(this.innerGeometry, x, z, radius * INNER_GUIDE_RATIO, INNER_LIFT, this.heightAt);
    writeBand(this.bandGeometry, x, z, radius, this.heightAt);
    writeTicks(this.tickGeometry, x, z, radius, this.heightAt);
  }

  private applyOpacity(): void {
    const pulse = 0.65 + 0.15 * Math.sin(this.elapsed * Math.PI * 2 * PULSE_HZ);
    const dim = this.dimmed ? 0.45 : 1;
    this.outerMaterial.opacity = pulse * dim;
    this.innerMaterial.opacity = pulse * 0.52 * dim;
    this.bandMaterial.opacity = pulse * 0.15 * dim;
    this.tickMaterial.opacity = pulse * 0.82 * dim;
  }
}

function lineMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
}

function circleGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEGMENTS * 3), 3));
  return geometry;
}

function bandGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(SEGMENTS * 2 * 3), 3),
  );
  const indices = new Uint16Array(SEGMENTS * 6);
  for (let i = 0; i < SEGMENTS; i++) {
    const next = (i + 1) % SEGMENTS;
    const offset = i * 6;
    const inner = i * 2;
    const outer = inner + 1;
    const nextInner = next * 2;
    const nextOuter = nextInner + 1;
    indices.set([inner, outer, nextOuter, inner, nextOuter, nextInner], offset);
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function tickGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 2 * 3), 3));
  return geometry;
}

function writeCircle(
  geometry: THREE.BufferGeometry,
  cx: number,
  cz: number,
  radius: number,
  lift: number,
  heightAt: (x: number, z: number) => number,
): void {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < SEGMENTS; i++) {
    const angle = (i / SEGMENTS) * Math.PI * 2;
    const x = cx + Math.cos(angle) * radius;
    const z = cz + Math.sin(angle) * radius;
    positions.setXYZ(i, x, heightAt(x, z) + lift, z);
  }
  positions.needsUpdate = true;
}

function writeBand(
  geometry: THREE.BufferGeometry,
  cx: number,
  cz: number,
  radius: number,
  heightAt: (x: number, z: number) => number,
): void {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < SEGMENTS; i++) {
    const angle = (i / SEGMENTS) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let edge = 0; edge < 2; edge++) {
      const edgeRadius = radius * (edge === 0 ? BAND_INNER_RATIO : 1);
      const x = cx + cos * edgeRadius;
      const z = cz + sin * edgeRadius;
      positions.setXYZ(i * 2 + edge, x, heightAt(x, z) + BAND_LIFT, z);
    }
  }
  positions.needsUpdate = true;
}

function writeTicks(
  geometry: THREE.BufferGeometry,
  cx: number,
  cz: number,
  radius: number,
  heightAt: (x: number, z: number) => number,
): void {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let end = 0; end < 2; end++) {
      const tickRadius = radius * (end === 0 ? BAND_INNER_RATIO : 1.04);
      const x = cx + cos * tickRadius;
      const z = cz + sin * tickRadius;
      positions.setXYZ(i * 2 + end, x, heightAt(x, z) + TICK_LIFT, z);
    }
  }
  positions.needsUpdate = true;
}
