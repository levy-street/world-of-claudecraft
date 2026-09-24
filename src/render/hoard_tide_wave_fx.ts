import * as THREE from 'three';
import { HOARD_TIDE_WAVE_HALF_DEPTH, HOARD_TIDE_WAVE_HALF_GAP } from '../sim/rift/hoard_boss_kits';
import { sharedUniforms } from './gfx';
import {
  type HoardTideVisualCue,
  type HoardTideVisualPlan,
  hoardTideSprayLateral,
  hoardTideVisualPlanInto,
} from './hoard_tide_wave_fx_core';

// All assets are constructed beneath HoardBossFx's actionable preparation gate.
// No live-frame producers, materials, particles, lights or scene attachments.
const PROFILE = [
  [-1, 0],
  [-0.88, 0.45],
  [-0.64, 1.2],
  [-0.32, 2.35],
  [0.02, 3.55],
  [0.42, 4.15],
  [0.76, 4.3],
  [0.93, 3.98],
  [0.87, 3.53],
  [0.56, 3.3],
  [0.38, 3.6],
  [0.52, 3.83],
  [0.29, 3.71],
  [0.14, 2.5],
  [0.54, 1.1],
  [1, 0],
] as const;

/** Curled cross-section has volume; its full XZ footprint is the authoritative rectangle. */
function crestGeometry(foam: boolean): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const columns = 2;
  const rows = foam ? 4 : PROFILE.length;
  for (let x = 0; x <= columns; x++) {
    for (let j = 0; j < rows; j++) {
      const [z, y] = PROFILE[foam ? j + 5 : j];
      const ripple = Math.sin((x * Math.PI) / columns) * Math.sin((j + 1) * 0.8) * 0.065;
      positions.push(x / columns, y + (y > 0 ? ripple : 0), z * HOARD_TIDE_WAVE_HALF_DEPTH);
      const high = y / 4.3;
      colors.push(
        foam ? 0.7 + high * 0.3 : 0.035 + high * 0.08,
        foam ? 0.95 : 0.22 + high * 0.52,
        foam ? 1 : 0.4 + high * 0.53,
      );
    }
  }
  for (let x = 0; x < columns; x++)
    for (let j = 0; j < rows - 1; j++) {
      const a = x * rows + j;
      indices.push(a, a + rows, a + 1, a + 1, a + rows, a + rows + 1);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Shared world-space phase keeps adjacent instanced slices and the foam lip joined.
 * Only height moves. Neither the water's footprint nor the grounded base can drift. */
function addCrestUndulation(material: THREE.MeshBasicMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHoardTideTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uHoardTideTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
      vec4 tideWorld = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        tideWorld = instanceMatrix * tideWorld;
      #endif
      tideWorld = modelMatrix * tideWorld;
      float tideRoll = sin(tideWorld.x * 0.93 + tideWorld.z * 0.61 - uHoardTideTime * 3.2) * 0.16;
      tideRoll += sin(tideWorld.x * 2.13 - tideWorld.z * 1.37 + uHoardTideTime * 4.7) * 0.07;
      transformed.y += tideRoll * smoothstep(0.0, 3.8, position.y);`,
      );
  };
}

export class HoardTideWaveResources {
  readonly body = crestGeometry(false);
  readonly lip = crestGeometry(true);
  readonly floor = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  readonly droplet = new THREE.OctahedronGeometry(1, 0);
  readonly splashRing = new THREE.RingGeometry(0.88, 1, 32).rotateX(-Math.PI / 2);
  readonly bodyMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  readonly lipMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.94,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  readonly laneMat = new THREE.MeshBasicMaterial({
    color: 0x087ca8,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  readonly edgeMat = new THREE.MeshBasicMaterial({
    color: 0x9efaff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  readonly gapMat = new THREE.MeshBasicMaterial({
    color: 0x91ffcc,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  readonly foamMat = new THREE.MeshBasicMaterial({
    color: 0xc4faff,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  readonly sprayMat = new THREE.MeshBasicMaterial({
    color: 0xc9fbff,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });

  constructor() {
    // Installed before HoardBossFx submits its pooled root to the compile gate.
    addCrestUndulation(this.bodyMat);
    addCrestUndulation(this.lipMat);
  }

  createView(cosmetics: boolean, groundY?: (x: number, z: number) => number): HoardTideWaveView {
    return new HoardTideWaveView(this, cosmetics, groundY);
  }

  dispose(): void {
    this.body.dispose();
    this.lip.dispose();
    this.floor.dispose();
    this.droplet.dispose();
    this.splashRing.dispose();
    this.bodyMat.dispose();
    this.lipMat.dispose();
    this.laneMat.dispose();
    this.edgeMat.dispose();
    this.gapMat.dispose();
    this.foamMat.dispose();
    this.sprayMat.dispose();
  }
}

export function createHoardTideWaveResources(): HoardTideWaveResources {
  return new HoardTideWaveResources();
}

export class HoardTideWaveView {
  readonly root = new THREE.Group();
  private readonly crests: THREE.Group[] = [];
  private readonly lanes: THREE.InstancedMesh[] = [];
  private readonly trails: THREE.Mesh[] = [];
  private readonly rails: THREE.InstancedMesh[] = [];
  private readonly edges: THREE.InstancedMesh[] = [];
  private readonly crashes: THREE.Mesh[] = [];
  private readonly spray: THREE.InstancedMesh;
  private readonly shimmer: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly plan: HoardTideVisualPlan = {
    center: 0,
    leftStart: 0,
    leftWidth: 0,
    rightStart: 0,
    rightWidth: 0,
    gap: 0,
    solid: false,
    depth: 0,
    height: 0,
    leadProgress: 0,
    travelProgress: 0,
    tail: 1,
    moving: false,
  };
  private readonly last: HoardTideVisualCue = { radius: 1, total: 1, remaining: 1 };
  private groundDirty = true;

  constructor(
    resources: HoardTideWaveResources,
    private readonly cosmetics: boolean,
    private readonly groundY: (x: number, z: number) => number = () => 0,
  ) {
    this.root.name = 'hoard-tide-volumetric-wave';
    for (let side = 0; side < 2; side++) {
      const crest = new THREE.Group();
      crest.name = `hoard-tide-crest-${side}`;
      crest.add(
        new THREE.InstancedMesh(resources.body, resources.bodyMat, 16),
        new THREE.InstancedMesh(resources.lip, resources.lipMat, 16),
      );
      this.crests.push(crest);
      const lane = new THREE.InstancedMesh(resources.floor, resources.laneMat, 64);
      lane.name = `hoard-tide-path-${side}`;
      const trail = new THREE.Mesh(resources.floor, resources.foamMat);
      const edge = new THREE.InstancedMesh(resources.floor, resources.edgeMat, 16);
      edge.name = `hoard-tide-contact-${side}`;
      const rail = new THREE.InstancedMesh(resources.floor, resources.gapMat, 16);
      rail.name = `hoard-tide-safe-gap-${side}`;
      this.lanes.push(lane);
      this.trails.push(trail);
      this.edges.push(edge);
      this.rails.push(rail);
      this.root.add(lane, trail, edge, rail, crest);
      const crash = new THREE.Mesh(resources.splashRing, resources.edgeMat);
      crash.name = `hoard-tide-crash-ring-${side}`;
      this.crashes.push(crash);
      this.root.add(crash);
      for (const mesh of [lane, edge, rail, ...crest.children] as THREE.InstancedMesh[]) {
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
      }
    }
    this.spray = new THREE.InstancedMesh(resources.droplet, resources.sprayMat, cosmetics ? 96 : 1);
    this.spray.name = 'hoard-tide-spray-and-crash';
    this.spray.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.spray.frustumCulled = false;
    this.spray.visible = cosmetics;
    this.root.add(this.spray);
    this.shimmer = new THREE.InstancedMesh(resources.floor, resources.foamMat, cosmetics ? 40 : 1);
    this.shimmer.name = 'hoard-tide-caustic-foam';
    this.shimmer.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shimmer.frustumCulled = false;
    this.shimmer.visible = cosmetics;
    this.root.add(this.shimmer);
    this.root.visible = false;
  }

  update(cue: HoardTideVisualCue, dt: number): void {
    if (
      cue.radius !== this.last.radius ||
      cue.waveGap !== this.last.waveGap ||
      cue.waveSpan !== this.last.waveSpan
    )
      this.groundDirty = true;
    this.last.radius = cue.radius;
    this.last.total = cue.total;
    this.last.remaining = cue.remaining;
    this.last.waveGap = cue.waveGap;
    this.last.waveSpan = cue.waveSpan;
    this.last.waveLead = cue.waveLead;
    // dt is accepted by the pooled owner's common update contract; authoritative
    // cue time drives all motion, including on reconnect and low frame rates.
    void dt;
    hoardTideVisualPlanInto(this.plan, cue);
    const p = this.plan;
    this.root.visible = p.tail > 0;
    const length = cue.radius + p.depth;
    for (let side = 0; side < 2; side++) {
      const start = side === 0 ? p.leftStart : p.rightStart;
      const width = side === 0 ? p.leftWidth : p.rightWidth;
      const crest = this.crests[side];
      crest.position.set(start, 0.05, p.center);
      crest.scale.set(width, p.height, 1);
      crest.visible = p.tail > 0 && width > 0;
      this.lanes[side].position.set(start + width / 2, 0.16, 0);
      this.lanes[side].scale.set(width, 1, length);
      this.lanes[side].visible = cue.remaining >= 0 && width > 0;
      this.edges[side].position.set(start + width / 2, 0.065, p.center);
      this.edges[side].scale.set(width, 1, p.depth);
      this.edges[side].visible = cue.remaining >= 0 && width > 0;
      const gapEdge = p.gap + (side === 0 ? -HOARD_TIDE_WAVE_HALF_GAP : HOARD_TIDE_WAVE_HALF_GAP);
      this.rails[side].position.set(gapEdge + (side === 0 ? -0.08 : 0.08), 0.08, 0);
      this.rails[side].scale.set(0.12, 1, length);
      this.rails[side].visible = cue.remaining >= 0 && !p.solid;
      const body = crest.children[0] as THREE.InstancedMesh;
      const lip = crest.children[1] as THREE.InstancedMesh;
      for (let i = 0; i < 16; i++) {
        const x = start + ((i + 0.5) / 16) * width;
        const height = this.groundY(x, p.center);
        this.matrix.makeScale(1 / 16, 1, 1);
        this.matrix.setPosition(i / 16, height / Math.max(0.001, p.height), 0);
        body.setMatrixAt(i, this.matrix);
        lip.setMatrixAt(i, this.matrix);
        this.matrix.makeScale(1 / 16, 1, 1);
        this.matrix.setPosition((i + 0.5) / 16 - 0.5, height, 0);
        this.edges[side].setMatrixAt(i, this.matrix);
        if (this.groundDirty) {
          const z = ((i + 0.5) / 16 - 0.5) * length;
          this.matrix.makeScale(1, 1, 1 / 16);
          this.matrix.setPosition(0, this.groundY(gapEdge, z), (i + 0.5) / 16 - 0.5);
          this.rails[side].setMatrixAt(i, this.matrix);
          for (let col = 0; col < 4; col++) {
            this.matrix.makeScale(1 / 4, 1, 1 / 16);
            this.matrix.setPosition(
              (col + 0.5) / 4 - 0.5,
              this.groundY(start + ((col + 0.5) / 4) * width, z),
              (i + 0.5) / 16 - 0.5,
            );
            this.lanes[side].setMatrixAt(i * 4 + col, this.matrix);
          }
        }
      }
      body.instanceMatrix.needsUpdate = true;
      lip.instanceMatrix.needsUpdate = true;
      this.edges[side].instanceMatrix.needsUpdate = true;
      if (this.groundDirty) {
        this.rails[side].instanceMatrix.needsUpdate = true;
        this.lanes[side].instanceMatrix.needsUpdate = true;
      }
      const trailLength = Math.max(0.01, Math.min(6, p.travelProgress * cue.radius));
      this.trails[side].position.set(start + width / 2, 0.055, p.center - trailLength / 2);
      this.trails[side].scale.set(width * p.tail, 1, trailLength * p.tail);
      this.trails[side].visible = this.cosmetics && p.travelProgress > 0;
      const crash = this.crashes[side];
      crash.visible = this.cosmetics && cue.remaining < 0 && p.tail > 0;
      const crashRadius = Math.min(width * 0.45, 4) * Math.sqrt(1 - p.tail);
      crash.position.set(
        start + width / 2,
        this.groundY(start + width / 2, p.center) + 0.085,
        p.center,
      );
      crash.scale.set(crashRadius, 1, crashRadius * 0.6);
    }
    this.groundDirty = false;
    if (this.cosmetics) this.updateSpray();
  }

  /** Owner retains a released slot for this bounded cosmetic tail, never a hitbox. */
  finish(dt: number): boolean {
    this.last.remaining = Math.min(0, this.last.remaining) - Math.max(0, dt);
    this.update(this.last, dt);
    return this.root.visible;
  }

  private updateSpray(): void {
    const p = this.plan;
    const elapsed = this.last.total - this.last.remaining;
    for (let i = 0; i < this.spray.count; i++) {
      const phase = (elapsed * 0.9 + i * 0.381966) % 1;
      const mist = i % 3 === 0;
      const crash = this.last.remaining < 0;
      const sideWidth = i % 2 === 0 ? p.leftWidth : p.rightWidth;
      const size = Math.min(mist ? 0.16 : 0.05, sideWidth * 0.025) * p.tail * p.leadProgress;
      const x = hoardTideSprayLateral(i, p);
      const y = Math.max(
        0.06,
        (crash ? 1.4 : 3.9 * p.height) + phase * (crash ? 8 : 3) - phase * phase * 7,
      );
      const z = p.center + (mist ? -phase * 3 : phase * 1.1);
      this.matrix.makeScale(size, size * (mist ? 1 : 2.8), size);
      this.matrix.setPosition(x, y + this.groundY(x, z), z);
      this.spray.setMatrixAt(i, this.matrix);
    }
    this.spray.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.shimmer.count; i++) {
      const phase = (elapsed * 0.43 + i * 0.618034) % 1;
      const sideWidth = i % 2 === 0 ? p.leftWidth : p.rightWidth;
      const x = hoardTideSprayLateral(i, p);
      const width = Math.min(0.45, sideWidth * 0.025);
      this.matrix.makeScale(width * p.tail, 1, (0.3 + phase * 0.7) * p.tail);
      const z = p.center + 2 - phase * 7;
      this.matrix.setPosition(x, this.groundY(x, z) + 0.09, z);
      this.shimmer.setMatrixAt(i, this.matrix);
    }
    this.shimmer.instanceMatrix.needsUpdate = true;
  }

  hide(): void {
    this.root.visible = false;
  }
  invalidateGround(): void {
    this.groundDirty = true;
  }
  dispose(): void {
    for (const mesh of this.lanes) mesh.dispose();
    for (const mesh of this.rails) mesh.dispose();
    for (const mesh of this.edges) mesh.dispose();
    for (const crest of this.crests)
      for (const child of crest.children) (child as THREE.InstancedMesh).dispose();
    this.spray.dispose();
    this.shimmer.dispose();
    this.root.clear();
  }
}
