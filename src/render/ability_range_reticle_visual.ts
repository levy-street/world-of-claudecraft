import * as THREE from 'three';

const CIRCLE_SEGMENTS = 96;
const CONE_SEGMENTS = 48;
const RANGE_LIFT = 0.095;
const TICK_LIFT = 0.1;
const FILL_LIFT = 0.07;

export type AbilityRangeVisualKind = 'circle' | 'area' | 'meleeCone' | 'directionLine';

export interface AbilityRangeVisualState {
  x: number;
  z: number;
  radius: number;
  color: number;
  kind: AbilityRangeVisualKind;
  angle?: number;
  halfAngle?: number;
}

interface AbilityRangeGeometryState {
  x: number;
  z: number;
  radius: number;
  kind: AbilityRangeVisualKind | null;
  angle: number;
  halfAngle: number;
}

/** Prepared-skill guide matching the authoritative directional resolver shape. */
export class AbilityRangeReticleVisual {
  readonly group = new THREE.Group();

  private readonly circleGeometry = new THREE.BufferGeometry();
  private readonly tickGeometry = new THREE.BufferGeometry();
  private readonly guideGeometry = new THREE.BufferGeometry();
  private readonly terminalGeometry = new THREE.BufferGeometry();
  private readonly fillGeometry = new THREE.BufferGeometry();
  private readonly circleMaterial = lineMaterial(0.58);
  private readonly tickMaterial = lineMaterial(0.82);
  private readonly guideMaterial = lineMaterial(0.86);
  private readonly terminalMaterial = lineMaterial(0.96);
  private readonly fillMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.07,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  private readonly circle: THREE.LineLoop;
  private readonly ticks: THREE.LineSegments;
  private readonly guide: THREE.Line;
  private readonly terminal: THREE.LineSegments;
  private readonly fill: THREE.Mesh;
  private readonly geometryState: AbilityRangeGeometryState = {
    x: Number.NaN,
    z: Number.NaN,
    radius: Number.NaN,
    kind: null,
    angle: Number.NaN,
    halfAngle: Number.NaN,
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
      new THREE.BufferAttribute(new Float32Array(CIRCLE_SEGMENTS * 3), 3),
    );
    this.tickGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(4 * 2 * 3), 3),
    );
    this.guideGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array((CONE_SEGMENTS + 3) * 3), 3),
    );
    this.terminalGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(2 * 3), 3),
    );
    this.fillGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(CIRCLE_SEGMENTS * 3 * 3), 3),
    );

    this.circle = new THREE.LineLoop(this.circleGeometry, this.circleMaterial);
    this.circle.name = 'ability-range-edge';
    this.ticks = new THREE.LineSegments(this.tickGeometry, this.tickMaterial);
    this.ticks.name = 'ability-range-ticks';
    this.guide = new THREE.Line(this.guideGeometry, this.guideMaterial);
    this.guide.name = 'ability-direction-guide';
    this.terminal = new THREE.LineSegments(this.terminalGeometry, this.terminalMaterial);
    this.terminal.name = 'ability-direction-terminal';
    this.fill = new THREE.Mesh(this.fillGeometry, this.fillMaterial);
    this.fill.name = 'ability-range-fill';
    for (const object of [this.fill, this.circle, this.ticks, this.guide, this.terminal]) {
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
      this.geometryState.kind = null;
      return;
    }

    const angle = finiteAngle(range.angle);
    const halfAngle = finiteHalfAngle(range.halfAngle);
    if (!sameGeometry(this.geometryState, range, angle, halfAngle)) {
      this.rebuild(range, angle, halfAngle);
      Object.assign(this.geometryState, {
        x: range.x,
        z: range.z,
        radius: range.radius,
        kind: range.kind,
        angle,
        halfAngle,
      });
    }

    for (const rangeMaterial of [
      this.circleMaterial,
      this.tickMaterial,
      this.guideMaterial,
      this.terminalMaterial,
      this.fillMaterial,
    ]) {
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
    this.guideGeometry.dispose();
    this.terminalGeometry.dispose();
    this.fillGeometry.dispose();
    this.circleMaterial.dispose();
    this.tickMaterial.dispose();
    this.guideMaterial.dispose();
    this.terminalMaterial.dispose();
    this.fillMaterial.dispose();
  }

  private rebuild(range: AbilityRangeVisualState, angle: number, halfAngle: number): void {
    const radial = range.kind === 'circle' || range.kind === 'area';
    this.circle.visible = radial;
    this.ticks.visible = radial;
    this.guide.visible = range.kind === 'meleeCone' || range.kind === 'directionLine';
    this.terminal.visible = range.kind === 'directionLine';
    this.fill.visible = range.kind === 'meleeCone' || range.kind === 'area';

    if (radial) {
      writeCircle(this.circleGeometry, range.x, range.z, range.radius, this.heightAt);
      writeTicks(this.tickGeometry, range.x, range.z, range.radius, this.heightAt);
    }
    if (range.kind === 'area') {
      writeAreaFill(this.fillGeometry, range.x, range.z, range.radius, this.heightAt);
    } else if (range.kind === 'meleeCone') {
      writeCone(
        this.guideGeometry,
        this.fillGeometry,
        range.x,
        range.z,
        range.radius,
        angle,
        halfAngle,
        this.heightAt,
      );
    } else if (range.kind === 'directionLine') {
      writeDirectionLine(
        this.guideGeometry,
        this.terminalGeometry,
        range.x,
        range.z,
        range.radius,
        angle,
        this.heightAt,
      );
    }
  }

  private applyOpacity(): void {
    const pulse = 0.88 + 0.12 * Math.sin(this.elapsed * Math.PI * 2 * 1.5);
    this.circleMaterial.opacity = 0.58 * pulse;
    this.tickMaterial.opacity = 0.82 * pulse;
    this.guideMaterial.opacity = 0.86 * pulse;
    this.terminalMaterial.opacity = 0.96 * pulse;
    this.fillMaterial.opacity = 0.07 * pulse;
  }
}

function sameGeometry(
  previous: AbilityRangeGeometryState,
  next: AbilityRangeVisualState,
  angle: number,
  halfAngle: number,
): boolean {
  return (
    previous.x === next.x &&
    previous.z === next.z &&
    previous.radius === next.radius &&
    previous.kind === next.kind &&
    previous.angle === angle &&
    previous.halfAngle === halfAngle
  );
}

function finiteAngle(angle: number | undefined): number {
  return typeof angle === 'number' && Number.isFinite(angle) ? angle : 0;
}

function finiteHalfAngle(halfAngle: number | undefined): number {
  return typeof halfAngle === 'number' && Number.isFinite(halfAngle)
    ? Math.max(0, Math.min(Math.PI, halfAngle))
    : Math.PI / 3;
}

function writeCircle(
  geometry: THREE.BufferGeometry,
  cx: number,
  cz: number,
  radius: number,
  heightAt: (x: number, z: number) => number,
): void {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    const x = cx + Math.cos(angle) * radius;
    const z = cz + Math.sin(angle) * radius;
    positions.setXYZ(i, x, heightAt(x, z) + RANGE_LIFT, z);
  }
  positions.needsUpdate = true;
  geometry.setDrawRange(0, CIRCLE_SEGMENTS);
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
      const tickRadius = radius * (end === 0 ? 0.96 : 1.04);
      const x = cx + cos * tickRadius;
      const z = cz + sin * tickRadius;
      positions.setXYZ(i * 2 + end, x, heightAt(x, z) + TICK_LIFT, z);
    }
  }
  positions.needsUpdate = true;
  geometry.setDrawRange(0, 8);
}

function writeAreaFill(
  geometry: THREE.BufferGeometry,
  cx: number,
  cz: number,
  radius: number,
  heightAt: (x: number, z: number) => number,
): void {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const a0 = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
    writeTriangle(
      positions,
      i * 3,
      { x: cx, z: cz },
      { x: cx + Math.cos(a0) * radius, z: cz + Math.sin(a0) * radius },
      { x: cx + Math.cos(a1) * radius, z: cz + Math.sin(a1) * radius },
      heightAt,
    );
  }
  positions.needsUpdate = true;
  geometry.setDrawRange(0, CIRCLE_SEGMENTS * 3);
}

function writeCone(
  guideGeometry: THREE.BufferGeometry,
  fillGeometry: THREE.BufferGeometry,
  cx: number,
  cz: number,
  radius: number,
  angle: number,
  halfAngle: number,
  heightAt: (x: number, z: number) => number,
): void {
  const guidePositions = guideGeometry.getAttribute('position') as THREE.BufferAttribute;
  writePoint(guidePositions, 0, cx, cz, RANGE_LIFT, heightAt);
  for (let i = 0; i <= CONE_SEGMENTS; i++) {
    const arcAngle = angle - halfAngle + (i / CONE_SEGMENTS) * halfAngle * 2;
    writePoint(
      guidePositions,
      i + 1,
      cx + Math.sin(arcAngle) * radius,
      cz + Math.cos(arcAngle) * radius,
      RANGE_LIFT,
      heightAt,
    );
  }
  writePoint(guidePositions, CONE_SEGMENTS + 2, cx, cz, RANGE_LIFT, heightAt);
  guidePositions.needsUpdate = true;
  guideGeometry.setDrawRange(0, CONE_SEGMENTS + 3);

  const fillPositions = fillGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < CONE_SEGMENTS; i++) {
    const a0 = angle - halfAngle + (i / CONE_SEGMENTS) * halfAngle * 2;
    const a1 = angle - halfAngle + ((i + 1) / CONE_SEGMENTS) * halfAngle * 2;
    writeTriangle(
      fillPositions,
      i * 3,
      { x: cx, z: cz },
      { x: cx + Math.sin(a0) * radius, z: cz + Math.cos(a0) * radius },
      { x: cx + Math.sin(a1) * radius, z: cz + Math.cos(a1) * radius },
      heightAt,
    );
  }
  fillPositions.needsUpdate = true;
  fillGeometry.setDrawRange(0, CONE_SEGMENTS * 3);
}

function writeDirectionLine(
  guideGeometry: THREE.BufferGeometry,
  terminalGeometry: THREE.BufferGeometry,
  cx: number,
  cz: number,
  radius: number,
  angle: number,
  heightAt: (x: number, z: number) => number,
): void {
  const dx = Math.sin(angle);
  const dz = Math.cos(angle);
  const endX = cx + dx * radius;
  const endZ = cz + dz * radius;
  const guidePositions = guideGeometry.getAttribute('position') as THREE.BufferAttribute;
  writePoint(guidePositions, 0, cx, cz, RANGE_LIFT, heightAt);
  writePoint(guidePositions, 1, endX, endZ, RANGE_LIFT, heightAt);
  guidePositions.needsUpdate = true;
  guideGeometry.setDrawRange(0, 2);

  const terminalHalfWidth = Math.min(1.25, Math.max(0.45, radius * 0.045));
  const terminalPositions = terminalGeometry.getAttribute('position') as THREE.BufferAttribute;
  writePoint(
    terminalPositions,
    0,
    endX - dz * terminalHalfWidth,
    endZ + dx * terminalHalfWidth,
    TICK_LIFT,
    heightAt,
  );
  writePoint(
    terminalPositions,
    1,
    endX + dz * terminalHalfWidth,
    endZ - dx * terminalHalfWidth,
    TICK_LIFT,
    heightAt,
  );
  terminalPositions.needsUpdate = true;
  terminalGeometry.setDrawRange(0, 2);
}

function writeTriangle(
  positions: THREE.BufferAttribute,
  offset: number,
  a: { x: number; z: number },
  b: { x: number; z: number },
  c: { x: number; z: number },
  heightAt: (x: number, z: number) => number,
): void {
  writePoint(positions, offset, a.x, a.z, FILL_LIFT, heightAt);
  writePoint(positions, offset + 1, b.x, b.z, FILL_LIFT, heightAt);
  writePoint(positions, offset + 2, c.x, c.z, FILL_LIFT, heightAt);
}

function writePoint(
  positions: THREE.BufferAttribute,
  index: number,
  x: number,
  z: number,
  lift: number,
  heightAt: (x: number, z: number) => number,
): void {
  positions.setXYZ(index, x, heightAt(x, z) + lift, z);
}

function lineMaterial(opacity: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
}
