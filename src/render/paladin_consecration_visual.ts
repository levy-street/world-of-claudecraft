// Persistent Consecration presentation. The authoritative zone comes from IWorld,
// so late-joining and reconnecting clients see the same holy ground as the caster.

import * as THREE from 'three';
import type { ActiveConsecration } from '../world_api';

const SEGMENTS = 72;
const GROUND_LIFT = 0.055;
const FADE_SECONDS = 0.65;
const REVEAL_SECONDS = 0.24;
const PULSE_SECONDS = 1.1;
const MOTE_COUNT = 12;
const EDGE_WISP_COUNT = 8;

interface AmbientOffset {
  x: number;
  y: number;
  z: number;
  phase: number;
  scale: number;
}

interface ConsecrationVisual {
  root: THREE.Group;
  motes: THREE.InstancedMesh;
  edgeWisps: THREE.InstancedMesh;
  pulseRing: THREE.Mesh;
  pulseMaterial: THREE.MeshBasicMaterial;
  shimmer: THREE.Mesh;
  moteOffsets: readonly AmbientOffset[];
  edgeOffsets: readonly AmbientOffset[];
  scratch: THREE.Matrix4;
  scratchPosition: THREE.Vector3;
  scratchScale: THREE.Vector3;
  scratchRotation: THREE.Quaternion;
  materials: THREE.MeshBasicMaterial[];
  baseOpacities: number[];
  geometries: THREE.BufferGeometry[];
  qualityObjects: { object: THREE.Object3D; minQuality: number }[];
  radius: number;
  duration: number;
  elapsed: number;
  lastRemaining: number;
}

export class PaladinConsecrationVisuals {
  private readonly active = new Map<string, ConsecrationVisual>();
  private quality = 1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  setQuality(level: number): void {
    this.quality = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1));
    for (const visual of this.active.values()) this.applyQuality(visual);
  }

  sync(states: readonly ActiveConsecration[]): void {
    const ids = new Set<string>();
    for (const state of states) {
      ids.add(state.id);
      const current = this.active.get(state.id);
      if (!current) {
        this.create(state);
        continue;
      }
      if (current.lastRemaining !== state.remaining) {
        current.duration = Math.max(0.1, state.duration);
        current.elapsed = Math.max(0, current.duration - state.remaining);
        current.lastRemaining = state.remaining;
        this.animate(current, 0, true);
      }
    }
    for (const [id, visual] of this.active) {
      if (ids.has(id)) continue;
      this.disposeVisual(visual);
      this.active.delete(id);
    }
  }

  update(dt: number, reducedMotion = false): void {
    for (const [id, visual] of this.active) {
      visual.elapsed += Math.max(0, dt);
      if (visual.elapsed >= visual.duration) {
        this.disposeVisual(visual);
        this.active.delete(id);
        continue;
      }
      this.animate(visual, dt, reducedMotion);
    }
  }

  dispose(): void {
    for (const visual of this.active.values()) this.disposeVisual(visual);
    this.active.clear();
  }

  private create(state: ActiveConsecration): void {
    const radius = Math.max(0.5, state.radius);
    const centerY = this.groundY(state.x, state.z);
    const root = new THREE.Group();
    root.name = 'paladin-consecration';
    const materials: THREE.MeshBasicMaterial[] = [];
    const baseOpacities: number[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const qualityObjects: { object: THREE.Object3D; minQuality: number }[] = [];

    const addTerrainMesh = (
      geometry: THREE.BufferGeometry,
      name: string,
      color: number,
      opacity: number,
      renderOrder: number,
    ): THREE.Mesh => {
      const material = this.material(color, opacity);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.renderOrder = renderOrder;
      root.add(mesh);
      geometries.push(geometry);
      materials.push(material);
      baseOpacities.push(opacity);
      return mesh;
    };

    addTerrainMesh(
      this.createTerrainDisc(state.x, state.z, radius, 48),
      'paladin-consecration-base-glow',
      0xffd86a,
      0.1,
      5,
    );
    qualityObjects.push({
      object: addTerrainMesh(
        this.createTerrainDisc(state.x, state.z, radius * 0.62, 40),
        'paladin-consecration-white-hot-center',
        0xffffdc,
        0.09,
        6,
      ),
      minQuality: 0.2,
    });
    qualityObjects.push({
      object: addTerrainMesh(
        this.createTerrainRing(state.x, state.z, radius * 0.17, radius * 0.19),
        'paladin-consecration-inner-ring',
        0xffffcf,
        0.48,
        8,
      ),
      minQuality: 0.25,
    });
    qualityObjects.push({
      object: addTerrainMesh(
        this.createTerrainRing(state.x, state.z, radius * 0.39, radius * 0.405),
        'paladin-consecration-middle-ring',
        0xffe78b,
        0.32,
        8,
      ),
      minQuality: 0.65,
    });
    qualityObjects.push({
      object: addTerrainMesh(
        this.createTerrainRing(state.x, state.z, radius * 0.67, radius * 0.682),
        'paladin-consecration-outer-ring',
        0xffdb68,
        0.25,
        8,
      ),
      minQuality: 0.45,
    });
    addTerrainMesh(
      this.createTerrainRing(state.x, state.z, radius * 0.982, radius),
      'paladin-consecration-perimeter',
      0xffffb5,
      0.42,
      9,
    );
    const runeField = addTerrainMesh(
      this.createTerrainRuneField(state.x, state.z, radius),
      'paladin-consecration-sun-rune-field',
      0xffffd1,
      0.5,
      8,
    );
    runeField.userData.runeSegmentCount = 24;

    const pulseGeometry = new THREE.RingGeometry(0.93, 1, 64);
    const pulseMaterial = this.material(0xffffd8, 0.42);
    const pulseRing = new THREE.Mesh(pulseGeometry, pulseMaterial);
    pulseRing.name = 'paladin-consecration-pulse-ring';
    pulseRing.rotation.x = -Math.PI / 2;
    pulseRing.position.set(state.x, centerY + GROUND_LIFT * 2.2, state.z);
    pulseRing.renderOrder = 10;
    root.add(pulseRing);
    geometries.push(pulseGeometry);
    materials.push(pulseMaterial);
    baseOpacities.push(0.42);

    const shimmerGeometry = new THREE.CylinderGeometry(
      radius * 0.97,
      radius * 0.91,
      0.42,
      32,
      1,
      true,
    );
    const shimmerMaterial = this.material(0xffefae, 0.045);
    const shimmer = new THREE.Mesh(shimmerGeometry, shimmerMaterial);
    shimmer.name = 'paladin-consecration-shimmer';
    shimmer.position.set(state.x, centerY + 0.23, state.z);
    shimmer.renderOrder = 7;
    root.add(shimmer);
    qualityObjects.push({ object: shimmer, minQuality: 0.7 });
    geometries.push(shimmerGeometry);
    materials.push(shimmerMaterial);
    baseOpacities.push(0.045);

    const moteGeometry = new THREE.SphereGeometry(0.055, 5, 4);
    const moteMaterial = this.material(0xffffd7, 0.72);
    const motes = new THREE.InstancedMesh(moteGeometry, moteMaterial, MOTE_COUNT);
    motes.name = 'paladin-consecration-motes';
    motes.position.set(state.x, centerY, state.z);
    motes.renderOrder = 11;
    root.add(motes);
    qualityObjects.push({ object: motes, minQuality: 0.25 });
    geometries.push(moteGeometry);
    materials.push(moteMaterial);
    baseOpacities.push(0.72);

    const edgeGeometry = new THREE.ConeGeometry(0.075, 0.5, 5, 1, true);
    const edgeMaterial = this.material(0xffffbd, 0.52);
    const edgeWisps = new THREE.InstancedMesh(edgeGeometry, edgeMaterial, EDGE_WISP_COUNT);
    edgeWisps.name = 'paladin-consecration-edge-wisps';
    edgeWisps.position.set(state.x, centerY, state.z);
    edgeWisps.renderOrder = 11;
    root.add(edgeWisps);
    qualityObjects.push({ object: edgeWisps, minQuality: 0.55 });
    geometries.push(edgeGeometry);
    materials.push(edgeMaterial);
    baseOpacities.push(0.52);

    const ambientOffset = (
      index: number,
      count: number,
      distance: number,
      phaseStep: number,
    ): AmbientOffset => {
      const angle = (index / count) * Math.PI * 2 + (index % 2) * 0.19;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      return {
        x,
        y: this.groundY(state.x + x, state.z + z) - centerY,
        z,
        phase: index * phaseStep,
        scale: 0.78 + (index % 3) * 0.12,
      };
    };
    const moteOffsets = Array.from({ length: MOTE_COUNT }, (_, index) =>
      ambientOffset(index, MOTE_COUNT, radius * (0.25 + (index % 4) * 0.14), 0.67),
    );
    const edgeOffsets = Array.from({ length: EDGE_WISP_COUNT }, (_, index) =>
      ambientOffset(index, EDGE_WISP_COUNT, radius * 0.86, 0.91),
    );

    const visual: ConsecrationVisual = {
      root,
      motes,
      edgeWisps,
      pulseRing,
      pulseMaterial,
      shimmer,
      moteOffsets,
      edgeOffsets,
      scratch: new THREE.Matrix4(),
      scratchPosition: new THREE.Vector3(),
      scratchScale: new THREE.Vector3(),
      scratchRotation: new THREE.Quaternion(),
      materials,
      baseOpacities,
      geometries,
      qualityObjects,
      radius,
      duration: Math.max(0.1, state.duration),
      elapsed: Math.max(0, state.duration - state.remaining),
      lastRemaining: state.remaining,
    };
    this.applyQuality(visual);
    this.placeAmbient(visual, true);
    this.animate(visual, 0, true);
    this.active.set(state.id, visual);
    this.scene.add(root);
  }

  private applyQuality(visual: ConsecrationVisual): void {
    for (const { object, minQuality } of visual.qualityObjects) {
      object.visible = this.quality >= minQuality;
    }
  }

  private material(color: number, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  private animate(visual: ConsecrationVisual, dt: number, reducedMotion: boolean): void {
    const fade = Math.min(1, Math.max(0, (visual.duration - visual.elapsed) / FADE_SECONDS));
    const reveal = Math.min(1, visual.elapsed / REVEAL_SECONDS);
    const breathe = reducedMotion ? 1 : 0.95 + Math.sin(visual.elapsed * Math.PI * 2) * 0.05;
    visual.materials.forEach((material, index) => {
      material.opacity = visual.baseOpacities[index] * fade * reveal * breathe;
    });

    const phase =
      visual.elapsed < REVEAL_SECONDS
        ? visual.elapsed / REVEAL_SECONDS
        : reducedMotion
          ? 0.58
          : (visual.elapsed % PULSE_SECONDS) / PULSE_SECONDS;
    const pulseScale = visual.radius * (0.2 + phase * 0.8);
    visual.pulseRing.scale.setScalar(pulseScale);
    visual.pulseMaterial.opacity = 0.42 * fade * reveal * (1 - phase) ** 1.6;
    if (reducedMotion) return;
    if (visual.motes.visible) visual.motes.rotation.y += dt * 0.11;
    if (visual.edgeWisps.visible) visual.edgeWisps.rotation.y -= dt * 0.045;
    if (visual.shimmer.visible) visual.shimmer.rotation.y += dt * 0.08;
    this.placeAmbient(visual, false);
  }

  private placeAmbient(visual: ConsecrationVisual, staticPose: boolean): void {
    const place = (
      mesh: THREE.InstancedMesh,
      offsets: readonly AmbientOffset[],
      edge: boolean,
    ): void => {
      if (!mesh.visible) return;
      for (let index = 0; index < offsets.length; index++) {
        const offset = offsets[index];
        const wave = staticPose ? 0 : Math.sin(visual.elapsed * (edge ? 1.45 : 2.1) + offset.phase);
        const lift = edge ? 0.2 + wave * 0.07 : 0.32 + wave * 0.18;
        const scale = offset.scale * (edge ? 0.9 + wave * 0.08 : 0.85 + wave * 0.12);
        visual.scratchPosition.set(offset.x, offset.y + lift, offset.z);
        visual.scratchScale.set(scale, scale, scale);
        visual.scratch.compose(visual.scratchPosition, visual.scratchRotation, visual.scratchScale);
        mesh.setMatrixAt(index, visual.scratch);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    place(visual.motes, visual.moteOffsets, false);
    place(visual.edgeWisps, visual.edgeOffsets, true);
  }

  private disposeVisual(visual: ConsecrationVisual): void {
    this.scene.remove(visual.root);
    for (const material of visual.materials) material.dispose();
    for (const geometry of visual.geometries) geometry.dispose();
    visual.motes.dispose();
    visual.edgeWisps.dispose();
  }

  private createTerrainRing(
    x: number,
    z: number,
    innerRadius: number,
    outerRadius: number,
  ): THREE.BufferGeometry {
    const vertices: number[] = [];
    const indices: number[] = [];
    for (let segment = 0; segment <= SEGMENTS; segment++) {
      const angle = (segment / SEGMENTS) * Math.PI * 2;
      for (const radius of [innerRadius, outerRadius]) {
        const sampleX = x + Math.cos(angle) * radius;
        const sampleZ = z + Math.sin(angle) * radius;
        vertices.push(sampleX, this.groundY(sampleX, sampleZ) + GROUND_LIFT, sampleZ);
      }
      if (segment < SEGMENTS) {
        const inner = segment * 2;
        indices.push(inner, inner + 1, inner + 2, inner + 1, inner + 3, inner + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    return geometry;
  }

  private createTerrainRuneField(x: number, z: number, radius: number): THREE.BufferGeometry {
    const vertices: number[] = [];
    const indices: number[] = [];
    const addRibbon = (
      startX: number,
      startZ: number,
      endX: number,
      endZ: number,
      width: number,
    ): void => {
      const dx = endX - startX;
      const dz = endZ - startZ;
      const length = Math.max(0.001, Math.hypot(dx, dz));
      const sideX = (-dz / length) * width;
      const sideZ = (dx / length) * width;
      const base = vertices.length / 3;
      for (const [sampleX, sampleZ] of [
        [startX + sideX, startZ + sideZ],
        [startX - sideX, startZ - sideZ],
        [endX + sideX, endZ + sideZ],
        [endX - sideX, endZ - sideZ],
      ]) {
        vertices.push(sampleX, this.groundY(sampleX, sampleZ) + GROUND_LIFT * 1.45, sampleZ);
      }
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    };

    for (let index = 0; index < 12; index++) {
      const angle = (index / 12) * Math.PI * 2;
      const alongX = Math.cos(angle);
      const alongZ = Math.sin(angle);
      const sideX = -alongZ;
      const sideZ = alongX;
      addRibbon(
        x + alongX * radius * 0.22,
        z + alongZ * radius * 0.22,
        x + alongX * radius * 0.9,
        z + alongZ * radius * 0.9,
        radius * 0.009,
      );
      const crossCenterX = x + alongX * radius * 0.72;
      const crossCenterZ = z + alongZ * radius * 0.72;
      addRibbon(
        crossCenterX - sideX * radius * 0.075,
        crossCenterZ - sideZ * radius * 0.075,
        crossCenterX + sideX * radius * 0.075,
        crossCenterZ + sideZ * radius * 0.075,
        radius * 0.008,
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    return geometry;
  }

  private createTerrainDisc(
    x: number,
    z: number,
    radius: number,
    segments: number,
  ): THREE.BufferGeometry {
    const vertices = [x, this.groundY(x, z) + GROUND_LIFT, z];
    const indices: number[] = [];
    const radialSegments = 8;
    for (let ring = 1; ring <= radialSegments; ring++) {
      const sampleRadius = (radius * ring) / radialSegments;
      for (let segment = 0; segment <= segments; segment++) {
        const angle = (segment / segments) * Math.PI * 2;
        const sampleX = x + Math.cos(angle) * sampleRadius;
        const sampleZ = z + Math.sin(angle) * sampleRadius;
        vertices.push(sampleX, this.groundY(sampleX, sampleZ) + GROUND_LIFT, sampleZ);
        if (segment >= segments) continue;
        const current = 1 + (ring - 1) * (segments + 1) + segment;
        if (ring === 1) indices.push(0, current, current + 1);
        else {
          const previous = current - (segments + 1);
          indices.push(previous, current, previous + 1, current, current + 1, previous + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    return geometry;
  }
}
