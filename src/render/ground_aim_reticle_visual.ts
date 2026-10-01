import * as THREE from 'three';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { type GroundAimGeometryState, sameGroundAimGeometry } from './ground_aim_reticle_core';

const SEGMENTS = 96;
// Refusal red, deliberately outside the school palette.
const BLOCKED_RETICLE_COLOR = 0xd94040;
const INNER_GUIDE_RATIO = 0.62;
const BAND_INNER_RATIO = 0.82;
const OUTER_LIFT = 0.08;
const INNER_LIFT = 0.075;
const BAND_LIFT = 0.055;
const TICK_LIFT = 0.09;
const PULSE_HZ = 2;
/** Enough for any star a reticle carries (the fragmentation shell's six). */
const MARK_CAPACITY = 8;
const MARK_SEGMENTS = 12;
const MARK_RADIUS = 0.75;
const MARK_CROSS_RATIO = 0.55;
/** Ring then cross: one pair of vertices per segment. */
const MARK_LINE_VERTICES = (MARK_SEGMENTS + 2) * 2;
const MARK_DISC_VERTICES = MARK_SEGMENTS + 1;
const MARK_DISC_INDICES = MARK_SEGMENTS * 3;
const BLAST_SEGMENTS = 24;
const BLAST_LINE_VERTICES = BLAST_SEGMENTS * 2;

export interface GroundAimMarkPoint {
  x: number;
  z: number;
  /** The blast this mark's bomblet makes: a pale ring of that radius around the mark. */
  blast?: number;
}

export interface GroundAimVisualState {
  x: number;
  z: number;
  radius: number;
  color: number;
  dimmed: boolean;
  blocked?: boolean;
  /** Small ground marks where an armed fragmentation shell's bomblets land. */
  landing?: readonly GroundAimMarkPoint[] | null;
}

/** What the HUD hands the renderer: the reticle with its school still a name. */
export interface GroundAimReticleInput {
  x: number;
  z: number;
  radius: number;
  school: string;
  dimmed: boolean;
  blocked?: boolean;
  landing?: readonly GroundAimMarkPoint[] | null;
}

/** Terrain-draped ground targeting guide. Its outer edge is the gameplay radius. */
export class GroundAimReticleVisual {
  readonly group = new THREE.Group();

  private readonly outerGeometry = circleGeometry();
  private readonly innerGeometry = circleGeometry();
  private readonly bandGeometry = bandGeometry();
  private readonly tickGeometry = tickGeometry();
  private readonly markLineGeometry = markLineGeometry();
  private readonly markDiscGeometry = markDiscGeometry();
  private readonly markBlastGeometry = markBlastGeometry();
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
  // Built with the reticle on its own materials, so arming the shell compiles nothing.
  private readonly markLines: THREE.LineSegments;
  private readonly markDiscs: THREE.Mesh;
  private readonly markBlasts: THREE.LineSegments;
  private readonly markState = new Float64Array(MARK_CAPACITY * 3);
  private markCount = 0;
  private elapsed = 0;
  private dimmed = false;
  private disposed = false;
  private readonly geometryState: GroundAimGeometryState = {
    x: Number.NaN,
    z: Number.NaN,
    radius: Number.NaN,
  };

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
    this.markDiscs = new THREE.Mesh(this.markDiscGeometry, this.bandMaterial);
    this.markDiscs.name = 'ground-aim-landing-discs';
    this.markLines = new THREE.LineSegments(this.markLineGeometry, this.tickMaterial);
    this.markLines.name = 'ground-aim-landing-marks';
    this.markBlasts = new THREE.LineSegments(this.markBlastGeometry, this.innerMaterial);
    this.markBlasts.name = 'ground-aim-landing-blasts';
    this.markDiscs.visible = false;
    this.markLines.visible = false;
    this.markBlasts.visible = false;

    for (const object of [
      this.band,
      this.outer,
      this.inner,
      this.ticks,
      this.markDiscs,
      this.markLines,
      this.markBlasts,
    ]) {
      object.frustumCulled = false;
      object.renderOrder = floorVfxRenderOrder('reticle', 0);
      this.group.add(object);
    }
    this.scene.add(this.group);
  }

  setAim(aim: GroundAimVisualState | null): void {
    if (this.disposed) return;
    if (!aim) {
      this.group.visible = false;
      this.geometryState.x = Number.NaN;
      this.geometryState.z = Number.NaN;
      this.geometryState.radius = Number.NaN;
      this.setMarks(null);
      return;
    }

    const radius = Math.max(0, aim.radius);
    if (!sameGroundAimGeometry(this.geometryState, aim.x, aim.z, radius)) {
      this.rebuild(aim.x, aim.z, radius);
      this.geometryState.x = aim.x;
      this.geometryState.z = aim.z;
      this.geometryState.radius = radius;
    }
    this.setMarks(aim.landing ?? null);
    this.dimmed = aim.dimmed || aim.blocked === true;
    // A blocked aim (inside the ability's minimum range) will be REFUSED at
    // commit, so it drops the school identity for a refusal red; a merely
    // dimmed aim still casts and keeps its school color.
    const color = aim.blocked ? BLOCKED_RETICLE_COLOR : aim.color;
    for (const material of [
      this.outerMaterial,
      this.innerMaterial,
      this.bandMaterial,
      this.tickMaterial,
    ]) {
      material.color.setHex(color);
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
    this.markLineGeometry.dispose();
    this.markDiscGeometry.dispose();
    this.markBlastGeometry.dispose();
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

  /** Rewrites the marks only when a point moved; hides them with no star. */
  private setMarks(points: readonly GroundAimMarkPoint[] | null): void {
    const count = points ? Math.min(points.length, MARK_CAPACITY) : 0;
    this.markLines.visible = count > 0;
    this.markDiscs.visible = count > 0;
    if (!points || count === 0) {
      this.markBlasts.visible = false;
      this.markCount = 0;
      return;
    }
    let same = count === this.markCount;
    for (let i = 0; i < count && same; i++) {
      same =
        this.markState[i * 3] === points[i].x &&
        this.markState[i * 3 + 1] === points[i].z &&
        this.markState[i * 3 + 2] === (points[i].blast ?? 0);
    }
    if (same) return;
    for (let i = 0; i < count; i++) {
      this.markState[i * 3] = points[i].x;
      this.markState[i * 3 + 1] = points[i].z;
      this.markState[i * 3 + 2] = points[i].blast ?? 0;
    }
    this.markCount = count;
    writeMarks(this.markLineGeometry, this.markDiscGeometry, points, count, this.heightAt);
    this.markBlasts.visible =
      writeMarkBlasts(this.markBlastGeometry, points, count, this.heightAt) > 0;
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

function markLineGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(MARK_CAPACITY * MARK_LINE_VERTICES * 3), 3),
  );
  geometry.setDrawRange(0, 0);
  return geometry;
}

function markBlastGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(MARK_CAPACITY * BLAST_LINE_VERTICES * 3), 3),
  );
  geometry.setDrawRange(0, 0);
  return geometry;
}

function markDiscGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(MARK_CAPACITY * MARK_DISC_VERTICES * 3), 3),
  );
  const indices = new Uint16Array(MARK_CAPACITY * MARK_DISC_INDICES);
  for (let m = 0; m < MARK_CAPACITY; m++) {
    const base = m * MARK_DISC_VERTICES;
    for (let i = 0; i < MARK_SEGMENTS; i++) {
      const offset = m * MARK_DISC_INDICES + i * 3;
      indices[offset] = base;
      indices[offset + 1] = base + 1 + i;
      indices[offset + 2] = base + 1 + ((i + 1) % MARK_SEGMENTS);
    }
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);
  return geometry;
}

/** One mark's ring as x, ground y, z triples, so each ground point is sampled once. */
const markRing = new Float64Array(MARK_SEGMENTS * 3);

/** Each mark: a draped ring with a cross (lines) over a faint filled disc. */
function writeMarks(
  lines: THREE.BufferGeometry,
  discs: THREE.BufferGeometry,
  points: readonly GroundAimMarkPoint[],
  count: number,
  heightAt: (x: number, z: number) => number,
): void {
  const line = lines.getAttribute('position') as THREE.BufferAttribute;
  const disc = discs.getAttribute('position') as THREE.BufferAttribute;
  const cross = MARK_RADIUS * MARK_CROSS_RATIO;
  for (let m = 0; m < count; m++) {
    const cx = points[m].x;
    const cz = points[m].z;
    const lineBase = m * MARK_LINE_VERTICES;
    const discBase = m * MARK_DISC_VERTICES;
    disc.setXYZ(discBase, cx, heightAt(cx, cz) + BAND_LIFT, cz);
    for (let i = 0; i < MARK_SEGMENTS; i++) {
      const angle = (i / MARK_SEGMENTS) * Math.PI * 2;
      const x = cx + Math.cos(angle) * MARK_RADIUS;
      const z = cz + Math.sin(angle) * MARK_RADIUS;
      markRing[i * 3] = x;
      markRing[i * 3 + 1] = heightAt(x, z);
      markRing[i * 3 + 2] = z;
    }
    for (let i = 0; i < MARK_SEGMENTS; i++) {
      const a = i * 3;
      const b = ((i + 1) % MARK_SEGMENTS) * 3;
      line.setXYZ(lineBase + i * 2, markRing[a], markRing[a + 1] + TICK_LIFT, markRing[a + 2]);
      line.setXYZ(lineBase + i * 2 + 1, markRing[b], markRing[b + 1] + TICK_LIFT, markRing[b + 2]);
      disc.setXYZ(discBase + 1 + i, markRing[a], markRing[a + 1] + BAND_LIFT, markRing[a + 2]);
    }
    for (let arm = 0; arm < 2; arm++) {
      const dx = arm === 0 ? cross : 0;
      const dz = arm === 0 ? 0 : cross;
      const v = lineBase + (MARK_SEGMENTS + arm) * 2;
      line.setXYZ(v, cx - dx, heightAt(cx - dx, cz - dz) + TICK_LIFT, cz - dz);
      line.setXYZ(v + 1, cx + dx, heightAt(cx + dx, cz + dz) + TICK_LIFT, cz + dz);
    }
  }
  line.needsUpdate = true;
  disc.needsUpdate = true;
  lines.setDrawRange(0, count * MARK_LINE_VERTICES);
  discs.setDrawRange(0, count * MARK_DISC_INDICES);
}

/** One blast ring as x, ground y, z triples, so each ground point is sampled once. */
const blastRing = new Float64Array(BLAST_SEGMENTS * 3);

/** A pale draped ring of each mark's blast radius; the count of rings written. */
function writeMarkBlasts(
  geometry: THREE.BufferGeometry,
  points: readonly GroundAimMarkPoint[],
  count: number,
  heightAt: (x: number, z: number) => number,
): number {
  const line = geometry.getAttribute('position') as THREE.BufferAttribute;
  let rings = 0;
  for (let m = 0; m < count; m++) {
    const radius = points[m].blast ?? 0;
    if (!(radius > MARK_RADIUS)) continue;
    const cx = points[m].x;
    const cz = points[m].z;
    for (let i = 0; i < BLAST_SEGMENTS; i++) {
      const angle = (i / BLAST_SEGMENTS) * Math.PI * 2;
      const x = cx + Math.cos(angle) * radius;
      const z = cz + Math.sin(angle) * radius;
      blastRing[i * 3] = x;
      blastRing[i * 3 + 1] = heightAt(x, z) + INNER_LIFT;
      blastRing[i * 3 + 2] = z;
    }
    const base = rings * BLAST_LINE_VERTICES;
    for (let i = 0; i < BLAST_SEGMENTS; i++) {
      const a = i * 3;
      const b = ((i + 1) % BLAST_SEGMENTS) * 3;
      line.setXYZ(base + i * 2, blastRing[a], blastRing[a + 1], blastRing[a + 2]);
      line.setXYZ(base + i * 2 + 1, blastRing[b], blastRing[b + 1], blastRing[b + 2]);
    }
    rings++;
  }
  line.needsUpdate = true;
  geometry.setDrawRange(0, rings * BLAST_LINE_VERTICES);
  return rings;
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
