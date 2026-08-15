import * as THREE from 'three';

const MAX_RIFTS = 4;
const SEGMENTS = 64;
const SPIRAL_ARMS = 4;
const SPIRAL_STEPS = 12;
const WISP_COUNT = 40;
const FIELD_LIFT = 0.055;

export interface AbyssalRiftSpawn {
  x: number;
  z: number;
  radius: number;
  duration?: number;
}

interface RiftVisual {
  group: THREE.Group;
  field: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  rim: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  spiral: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  column: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  core: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  halo: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  wisps: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  wispPositions: Float32Array;
  wispAngles: Float32Array;
  wispPhases: Float32Array;
  spiralPositions: Float32Array;
  spiralAngles: Float32Array;
  spiralRadii: Float32Array;
  materials: Array<THREE.Material & { opacity: number }>;
  geometries: THREE.BufferGeometry[];
  baseOpacity: number[];
  x: number;
  z: number;
  radius: number;
  duration: number;
  elapsed: number;
}

function softParticleTexture(): THREE.DataTexture {
  const size = 24;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const distance = Math.hypot(dx, dy) * 2;
      const alpha = Math.round(255 * Math.max(0, 1 - distance) ** 2.4);
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'abyssal-rift-wisp';
  texture.needsUpdate = true;
  return texture;
}

export class AbyssalRiftFx {
  private readonly rifts: RiftVisual[] = [];
  private readonly wispTexture = softParticleTexture();
  private quality = 1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  setQuality(quality: number): void {
    this.quality = Math.min(1, Math.max(0, Number.isFinite(quality) ? quality : 1));
    for (const rift of this.rifts) this.applyQuality(rift);
  }

  spawn(opts: AbyssalRiftSpawn): void {
    while (this.rifts.length >= MAX_RIFTS) this.remove(0);
    const radius = Math.max(1, opts.radius);
    const duration = Math.max(0.35, opts.duration ?? 2.2);
    const group = new THREE.Group();
    group.name = 'abyssal-rift';

    const field = this.buildDisc(opts.x, opts.z, radius);
    const rim = this.buildRim(opts.x, opts.z, radius);
    const spiral = this.buildSpiral(opts.x, opts.z, radius);
    const centerY = this.groundY(opts.x, opts.z);

    const columnGeometry = new THREE.ConeGeometry(radius * 0.24, 5.8, 32, 1, true);
    const columnMaterial = new THREE.MeshBasicMaterial({
      color: 0x6d25c7,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const column = new THREE.Mesh(columnGeometry, columnMaterial);
    column.name = 'abyssal-rift-column';
    column.position.set(opts.x, centerY + 2.9, opts.z);
    column.renderOrder = 9;

    const coreGeometry = new THREE.SphereGeometry(radius * 0.14, 24, 14);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0x050008,
      transparent: true,
      opacity: 0.9,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.name = 'abyssal-rift-core';
    core.position.set(opts.x, centerY + 0.72, opts.z);
    core.renderOrder = 10;

    const haloGeometry = new THREE.TorusGeometry(radius * 0.28, 0.1, 8, 48);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: 0xe2adff,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.name = 'abyssal-rift-halo';
    halo.position.set(opts.x, centerY + 0.32, opts.z);
    halo.rotation.x = Math.PI / 2;
    halo.renderOrder = 10;

    const wisps = this.buildWisps(opts.x, opts.z, radius);
    group.add(field, rim, spiral.lines, column, core, halo, wisps.points);
    this.scene.add(group);

    const materials = [
      field.material,
      rim.material,
      spiral.lines.material,
      columnMaterial,
      coreMaterial,
      haloMaterial,
      wisps.points.material,
    ];
    const rift = {
      group,
      field,
      rim,
      spiral: spiral.lines,
      column,
      core,
      halo,
      wisps: wisps.points,
      wispPositions: wisps.positions,
      wispAngles: wisps.angles,
      wispPhases: wisps.phases,
      spiralPositions: spiral.positions,
      spiralAngles: spiral.angles,
      spiralRadii: spiral.radii,
      materials,
      geometries: [
        field.geometry,
        rim.geometry,
        spiral.lines.geometry,
        columnGeometry,
        coreGeometry,
        haloGeometry,
        wisps.points.geometry,
      ],
      baseOpacity: materials.map((material) => material.opacity),
      x: opts.x,
      z: opts.z,
      radius,
      duration,
      elapsed: 0,
    };
    this.rifts.push(rift);
    this.applyQuality(rift);
  }

  private buildDisc(
    x: number,
    z: number,
    radius: number,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
    const vertices = [x, this.groundY(x, z) + FIELD_LIFT, z];
    const indices: number[] = [];
    for (let segment = 0; segment <= SEGMENTS; segment++) {
      const angle = (segment / SEGMENTS) * Math.PI * 2;
      const sx = x + Math.cos(angle) * radius;
      const sz = z + Math.sin(angle) * radius;
      vertices.push(sx, this.groundY(sx, sz) + FIELD_LIFT, sz);
      if (segment < SEGMENTS) indices.push(0, segment + 1, segment + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({
      color: 0x09020f,
      transparent: true,
      opacity: 0.64,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const field = new THREE.Mesh(geometry, material);
    field.name = 'abyssal-rift-field';
    field.renderOrder = 6;
    return field;
  }

  private buildRim(
    x: number,
    z: number,
    radius: number,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
    const vertices: number[] = [];
    const indices: number[] = [];
    for (let segment = 0; segment <= SEGMENTS; segment++) {
      const angle = (segment / SEGMENTS) * Math.PI * 2;
      for (const ringRadius of [radius * 0.84, radius]) {
        const sx = x + Math.cos(angle) * ringRadius;
        const sz = z + Math.sin(angle) * ringRadius;
        vertices.push(sx, this.groundY(sx, sz) + FIELD_LIFT * 1.35, sz);
      }
      if (segment < SEGMENTS) {
        const inner = segment * 2;
        indices.push(inner, inner + 1, inner + 2, inner + 1, inner + 3, inner + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({
      color: 0x7d32d1,
      transparent: true,
      opacity: 0.74,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const rim = new THREE.Mesh(geometry, material);
    rim.name = 'abyssal-rift-rim';
    rim.renderOrder = 8;
    return rim;
  }

  private buildSpiral(
    x: number,
    z: number,
    radius: number,
  ): {
    lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
    positions: Float32Array;
    angles: Float32Array;
    radii: Float32Array;
  } {
    const vertexCount = SPIRAL_ARMS * SPIRAL_STEPS * 2;
    const positions = new Float32Array(vertexCount * 3);
    const angles = new Float32Array(vertexCount);
    const radii = new Float32Array(vertexCount);
    let vertex = 0;
    for (let arm = 0; arm < SPIRAL_ARMS; arm++) {
      for (let step = 0; step < SPIRAL_STEPS; step++) {
        for (const u of [step / SPIRAL_STEPS, (step + 1) / SPIRAL_STEPS]) {
          angles[vertex] = (arm / SPIRAL_ARMS) * Math.PI * 2 + u * 4.8;
          radii[vertex] = 0.12 + u * 0.76;
          const sx = x + Math.cos(angles[vertex]) * radius * radii[vertex];
          const sz = z + Math.sin(angles[vertex]) * radius * radii[vertex];
          positions.set([sx, this.groundY(sx, sz) + FIELD_LIFT * 1.8, sz], vertex * 3);
          vertex++;
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xd29aff,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.name = 'abyssal-rift-spiral';
    lines.renderOrder = 9;
    return { lines, positions, angles, radii };
  }

  private buildWisps(
    x: number,
    z: number,
    radius: number,
  ): {
    points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    positions: Float32Array;
    angles: Float32Array;
    phases: Float32Array;
  } {
    const positions = new Float32Array(WISP_COUNT * 3);
    const angles = new Float32Array(WISP_COUNT);
    const phases = new Float32Array(WISP_COUNT);
    for (let index = 0; index < WISP_COUNT; index++) {
      angles[index] = (index / WISP_COUNT) * Math.PI * 2 + (index % 5) * 0.19;
      phases[index] = index / WISP_COUNT;
      const distance = radius * (0.15 + 0.85 * (1 - phases[index]));
      const sx = x + Math.cos(angles[index]) * distance;
      const sz = z + Math.sin(angles[index]) * distance;
      positions.set([sx, this.groundY(sx, sz) + 0.18 + (index % 4) * 0.12, sz], index * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xc786ff,
      size: 0.38,
      map: this.wispTexture,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.name = 'abyssal-rift-inward-wisps';
    points.frustumCulled = false;
    points.renderOrder = 10;
    return { points, positions, angles, phases };
  }

  update(dt: number, reducedMotion = false): void {
    for (let index = this.rifts.length - 1; index >= 0; index--) {
      const rift = this.rifts[index];
      rift.elapsed += dt;
      if (rift.elapsed >= rift.duration) {
        this.remove(index);
        continue;
      }
      const fadeIn = Math.min(1, rift.elapsed / 0.12);
      const fadeOut = Math.min(1, (rift.duration - rift.elapsed) / 0.45);
      const alpha = Math.min(fadeIn, fadeOut);
      rift.materials.forEach((material, materialIndex) => {
        material.opacity = rift.baseOpacity[materialIndex] * alpha;
      });
      if (reducedMotion) continue;

      const pulse = 0.9 + Math.sin(rift.elapsed * 8) * 0.1;
      if (rift.column.visible) {
        rift.column.scale.set(pulse, 1 + Math.sin(rift.elapsed * 5) * 0.08, pulse);
        rift.column.rotation.y += dt * 1.5;
      }
      rift.core.scale.setScalar(0.9 + Math.sin(rift.elapsed * 10) * 0.08);
      if (rift.halo.visible) {
        rift.halo.rotation.z -= dt * 2.4;
        rift.halo.scale.setScalar(0.92 + Math.sin(rift.elapsed * 7) * 0.08);
      }

      const visibleWisps = rift.wisps.geometry.drawRange.count;
      for (let wisp = 0; wisp < visibleWisps; wisp++) {
        const cycle = (rift.wispPhases[wisp] + rift.elapsed * (0.42 + (wisp % 4) * 0.035)) % 1;
        const distance = rift.radius * (0.15 + 0.85 * (1 - cycle));
        const angle = rift.wispAngles[wisp] + rift.elapsed * 0.7 + cycle * 0.9;
        const x = rift.x + Math.cos(angle) * distance;
        const z = rift.z + Math.sin(angle) * distance;
        const offset = wisp * 3;
        rift.wispPositions[offset] = x;
        rift.wispPositions[offset + 1] =
          this.groundY(x, z) + 0.18 + Math.sin(rift.elapsed * 7 + wisp) * 0.18;
        rift.wispPositions[offset + 2] = z;
      }
      if (visibleWisps > 0) rift.wisps.geometry.attributes.position.needsUpdate = true;

      const visibleSpiralVertices = rift.spiral.geometry.drawRange.count;
      for (let vertex = 0; vertex < visibleSpiralVertices; vertex++) {
        const angle =
          rift.spiralAngles[vertex] + rift.elapsed * 0.9 + (1 - rift.spiralRadii[vertex]) * 0.8;
        const distance = rift.radius * rift.spiralRadii[vertex];
        const x = rift.x + Math.cos(angle) * distance;
        const z = rift.z + Math.sin(angle) * distance;
        const offset = vertex * 3;
        rift.spiralPositions[offset] = x;
        rift.spiralPositions[offset + 1] = this.groundY(x, z) + FIELD_LIFT * 1.8;
        rift.spiralPositions[offset + 2] = z;
      }
      if (visibleSpiralVertices > 0) rift.spiral.geometry.attributes.position.needsUpdate = true;
    }
  }

  dispose(): void {
    while (this.rifts.length > 0) this.remove(this.rifts.length - 1);
    this.wispTexture.dispose();
  }

  private applyQuality(rift: RiftVisual): void {
    const visibleWisps =
      this.quality < 0.2 ? 0 : Math.max(8, Math.round(WISP_COUNT * (0.25 + this.quality * 0.75)));
    const visibleSpiralArms = this.quality < 0.15 ? 0 : this.quality < 0.55 ? 2 : SPIRAL_ARMS;
    rift.wisps.geometry.setDrawRange(0, visibleWisps);
    rift.wisps.visible = visibleWisps > 0;
    rift.spiral.geometry.setDrawRange(0, visibleSpiralArms * SPIRAL_STEPS * 2);
    rift.spiral.visible = visibleSpiralArms > 0;
    rift.column.visible = this.quality >= 0.25;
    rift.halo.visible = this.quality >= 0.1;
  }

  private remove(index: number): void {
    const [rift] = this.rifts.splice(index, 1);
    if (!rift) return;
    this.scene.remove(rift.group);
    for (const material of rift.materials) material.dispose();
    for (const geometry of rift.geometries) geometry.dispose();
  }
}
