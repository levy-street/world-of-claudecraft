import * as THREE from 'three';
import { UMBRAL_ANCHOR_ID } from '../sim/combat/warlock_utility';
import type { Aura, Entity } from '../sim/types';
import {
  createUmbralAnchorVfxPlan,
  UMBRAL_ANCHOR_PLACE_SECONDS,
  UMBRAL_ANCHOR_RECALL_SECONDS,
  type UmbralAnchorVfxPhase,
  writeUmbralAnchorVfxPlan,
} from './umbral_anchor_vfx_core';

const SHARD_COUNT = 8;
const WISP_COUNT = 24;

interface DrapedGeometry {
  geometry: THREE.BufferGeometry;
  originalY: Float32Array;
}

function anchorAura(owner: Entity | undefined): Aura | null {
  if (!owner || owner.dead) return null;
  for (const aura of owner.auras) {
    if (
      aura.id === UMBRAL_ANCHOR_ID &&
      aura.kind === 'warlock_anchor' &&
      aura.sourceId === owner.id &&
      aura.value2 !== undefined &&
      aura.value3 !== undefined
    ) {
      return aura;
    }
  }
  return null;
}

function buildSoftWispTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const distance = Math.sqrt(dx * dx + dy * dy) * 2;
      const core = Math.max(0, 1 - distance);
      const alpha = Math.round(255 * core * core);
      const offset = (y * size + x) * 4;
      data[offset] = 225;
      data[offset + 1] = 170;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'umbral-anchor-wisp';
  texture.needsUpdate = true;
  return texture;
}

function buildGroundMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'umbral-anchor-ground-material',
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uPulse: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOpacity;
      uniform float uPulse;
      varying vec2 vUv;

      float band(float radius, float center, float width) {
        return 1.0 - smoothstep(width * 0.45, width, abs(radius - center));
      }

      void main() {
        vec2 point = (vUv - 0.5) * 2.0;
        float radius = length(point);
        float angle = atan(point.y, point.x + 0.0001);
        float mask = 1.0 - smoothstep(0.88, 1.0, radius);

        float outer = band(radius, 0.82, 0.035);
        float middle = band(radius, 0.57, 0.018);
        float iris = band(radius, 0.29, 0.04);
        float spokes = smoothstep(0.9, 0.995, cos(angle * 8.0 + uTime * 0.32))
          * smoothstep(0.32, 0.45, radius)
          * (1.0 - smoothstep(0.72, 0.82, radius));
        float glyphs = smoothstep(0.48, 0.9, sin(angle * 12.0 - uTime * 0.42))
          * band(radius, 0.69, 0.075);
        float voidCore = (1.0 - smoothstep(0.0, 0.28, radius))
          * (0.72 + uPulse * 0.18);

        vec3 violet = vec3(0.72, 0.18, 2.15);
        vec3 pale = vec3(1.15, 0.72, 2.45);
        vec3 fel = vec3(0.12, 2.1, 0.72);
        float violetEnergy = outer * 1.45 + middle + spokes * 0.8 + glyphs * 0.72;
        float felEnergy = iris * 1.55 + voidCore * 0.42;
        vec3 color = violet * violetEnergy + pale * glyphs * 0.45 + fel * felEnergy;
        float alpha = clamp((violetEnergy + felEnergy) * mask, 0.0, 1.0) * uOpacity;
        if (alpha < 0.012) discard;
        gl_FragColor = vec4(color * alpha, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function buildRuneGeometry(): THREE.BufferGeometry {
  const vertices: number[] = [];
  for (let rune = 0; rune < 12; rune++) {
    const angle = (rune / 12) * Math.PI * 2;
    const radialX = Math.cos(angle);
    const radialZ = Math.sin(angle);
    const tangentX = -radialZ;
    const tangentZ = radialX;
    const centerX = radialX * 1.02;
    const centerZ = radialZ * 1.02;
    const point = (along: number, across: number): [number, number, number] => [
      centerX + tangentX * along + radialX * across,
      0.065,
      centerZ + tangentZ * along + radialZ * across,
    ];
    for (const [fromAlong, fromAcross, toAlong, toAcross] of [
      [-0.13, -0.08, 0, 0.13],
      [0, 0.13, 0.13, -0.08],
      [-0.09, 0, 0.09, 0],
    ] as const) {
      vertices.push(...point(fromAlong, fromAcross), ...point(toAlong, toAcross));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

/**
 * Persistent Warlock return point plus its bounded placement/recall ceremony.
 * Every mesh, material, texture and particle slot is created once.
 */
export class UmbralAnchorMarker {
  readonly group = new THREE.Group();
  private readonly groundLayer = new THREE.Group();
  private readonly runeLayer = new THREE.Group();
  private readonly verticalLayer = new THREE.Group();
  private readonly shardLayer = new THREE.Group();
  private readonly groundMaterial = buildGroundMaterial();
  private readonly voidMaterial = new THREE.MeshBasicMaterial({
    color: 0x12001d,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly runeMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(0xbd78ff).multiplyScalar(1.8),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly haloMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x9b4fff).multiplyScalar(1.65),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly columnMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x761fff).multiplyScalar(1.5),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly shardMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xd7a2ff).multiplyScalar(1.9),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly wispTexture = buildSoftWispTexture();
  private readonly wispMaterial = new THREE.PointsMaterial({
    color: new THREE.Color(0xa752ff).multiplyScalar(1.8),
    map: this.wispTexture,
    size: 0.32,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    alphaTest: 0.015,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly column: THREE.Mesh;
  private readonly verticalHalos: THREE.Mesh[] = [];
  private readonly shards: THREE.Mesh[] = [];
  private readonly shardBaseY = new Float32Array(SHARD_COUNT);
  private readonly wispPositions = new Float32Array(WISP_COUNT * 3);
  private readonly wispAngles = new Float32Array(WISP_COUNT);
  private readonly wispRadii = new Float32Array(WISP_COUNT);
  private readonly wispOffsets = new Float32Array(WISP_COUNT);
  private readonly wisps: THREE.Points;
  private readonly drapedGeometries: DrapedGeometry[] = [];
  private readonly plan = createUmbralAnchorVfxPlan();
  private phase: UmbralAnchorVfxPhase = 'hidden';
  private phaseStartedAt = 0;
  private hadAnchor = false;

  constructor(private readonly groundY?: (x: number, z: number) => number) {
    this.group.name = 'umbral-anchor-marker';
    this.group.visible = false;
    this.groundLayer.name = 'umbral-anchor-ground-layer';
    this.runeLayer.name = 'umbral-anchor-rune-layer';
    this.verticalLayer.name = 'umbral-anchor-vertical-layer';
    this.shardLayer.name = 'umbral-anchor-shard-layer';

    const voidGeometry = new THREE.CircleGeometry(1.36, 48).rotateX(-Math.PI / 2);
    this.registerDrapedGeometry(voidGeometry);
    const voidDisc = new THREE.Mesh(voidGeometry, this.voidMaterial);
    voidDisc.name = 'umbral-anchor-void-disc';
    voidDisc.position.y = 0.026;
    voidDisc.renderOrder = 5;

    const sigilGeometry = new THREE.PlaneGeometry(3.25, 3.25, 8, 8).rotateX(-Math.PI / 2);
    this.registerDrapedGeometry(sigilGeometry);
    const groundSigil = new THREE.Mesh(sigilGeometry, this.groundMaterial);
    groundSigil.name = 'umbral-anchor-sigil';
    groundSigil.position.y = 0.055;
    groundSigil.renderOrder = 7;
    this.groundLayer.add(voidDisc, groundSigil);

    const runeGeometry = buildRuneGeometry();
    this.registerDrapedGeometry(runeGeometry);
    const runes = new THREE.LineSegments(runeGeometry, this.runeMaterial);
    runes.name = 'umbral-anchor-runes';
    runes.renderOrder = 8;
    this.runeLayer.add(runes);

    for (const [radius, tube, y] of [
      [1.2, 0.018, 0.075],
      [0.48, 0.014, 0.082],
    ] as const) {
      const ringGeometry = new THREE.TorusGeometry(radius, tube, 6, 56).rotateX(Math.PI / 2);
      this.registerDrapedGeometry(ringGeometry);
      const ring = new THREE.Mesh(ringGeometry, this.haloMaterial);
      ring.position.y = y;
      ring.renderOrder = 8;
      this.runeLayer.add(ring);
    }

    this.column = new THREE.Mesh(
      new THREE.ConeGeometry(0.7, 2.7, 32, 1, true),
      this.columnMaterial,
    );
    this.column.name = 'umbral-anchor-column';
    this.column.position.y = 1.35;
    this.column.renderOrder = 6;
    this.verticalLayer.add(this.column);

    for (let index = 0; index < 2; index++) {
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.65, 48), this.haloMaterial);
      halo.name = `umbral-anchor-vertical-halo-${index}`;
      halo.position.y = 1.08;
      halo.rotation.y = index * Math.PI * 0.5;
      halo.scale.set(1, 1.45, 1);
      halo.renderOrder = 9;
      this.verticalLayer.add(halo);
      this.verticalHalos.push(halo);
    }

    const shardGeometry = new THREE.PlaneGeometry(0.17, 0.58);
    for (let index = 0; index < SHARD_COUNT; index++) {
      const angle = (index / SHARD_COUNT) * Math.PI * 2;
      const shard = new THREE.Mesh(shardGeometry, this.shardMaterial);
      shard.name = `umbral-anchor-shard-${index}`;
      shard.position.set(Math.cos(angle) * 0.88, 0, Math.sin(angle) * 0.88);
      shard.rotation.set((index % 2 ? -1 : 1) * 0.22, -angle, ((index % 3) - 1) * 0.18);
      shard.renderOrder = 9;
      this.shardBaseY[index] = 0.18 + (index % 3) * 0.13;
      this.shardLayer.add(shard);
      this.shards.push(shard);
    }

    for (let index = 0; index < WISP_COUNT; index++) {
      this.wispAngles[index] = (index / WISP_COUNT) * Math.PI * 2 + (index % 5) * 0.21;
      this.wispRadii[index] = 0.28 + ((index * 7) % WISP_COUNT) / WISP_COUNT;
      this.wispOffsets[index] = ((index * 11) % WISP_COUNT) / WISP_COUNT;
    }
    const wispGeometry = new THREE.BufferGeometry();
    const wispPositionAttribute = new THREE.BufferAttribute(this.wispPositions, 3);
    wispPositionAttribute.setUsage(THREE.DynamicDrawUsage);
    wispGeometry.setAttribute('position', wispPositionAttribute);
    this.wisps = new THREE.Points(wispGeometry, this.wispMaterial);
    this.wisps.name = 'umbral-anchor-wisps';
    this.wisps.frustumCulled = false;
    this.wisps.renderOrder = 10;

    this.group.add(
      this.groundLayer,
      this.runeLayer,
      this.verticalLayer,
      this.shardLayer,
      this.wisps,
    );
  }

  private registerDrapedGeometry(geometry: THREE.BufferGeometry): void {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const originalY = new Float32Array(position.count);
    for (let index = 0; index < position.count; index++) originalY[index] = position.getY(index);
    this.drapedGeometries.push({ geometry, originalY });
  }

  private drapeGround(centerX: number, centerY: number, centerZ: number): void {
    if (!this.groundY) return;
    for (const entry of this.drapedGeometries) {
      const position = entry.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let index = 0; index < position.count; index++) {
        const ground = this.groundY(centerX + position.getX(index), centerZ + position.getZ(index));
        position.setY(index, ground - centerY + entry.originalY[index]);
      }
      position.needsUpdate = true;
      entry.geometry.computeBoundingSphere();
    }
  }

  update(
    owner: Entity | undefined,
    time: number,
    reducedMotion = false,
    reducedDetail = false,
  ): void {
    const anchor = anchorAura(owner);
    if (anchor) {
      if (!this.hadAnchor) {
        this.phase = 'placing';
        this.phaseStartedAt = time;
        this.drapeGround(anchor.value, anchor.value2 ?? 0, anchor.value3 ?? 0);
      } else if (
        this.phase === 'placing' &&
        time - this.phaseStartedAt >= UMBRAL_ANCHOR_PLACE_SECONDS
      ) {
        this.phase = 'active';
        this.phaseStartedAt = time;
      }
      this.group.position.set(anchor.value, anchor.value2 ?? 0, anchor.value3 ?? 0);
      this.hadAnchor = true;
    } else if (this.hadAnchor) {
      this.phase = 'recalling';
      this.phaseStartedAt = time;
      this.hadAnchor = false;
    } else if (
      this.phase === 'recalling' &&
      time - this.phaseStartedAt >= UMBRAL_ANCHOR_RECALL_SECONDS
    ) {
      this.phase = 'hidden';
    }

    const elapsed = Math.max(0, time - this.phaseStartedAt);
    writeUmbralAnchorVfxPlan(this.plan, this.phase, elapsed, time, reducedMotion);
    this.group.visible = this.plan.visible;
    if (!this.plan.visible) return;

    this.verticalLayer.visible = !reducedDetail;
    this.shardLayer.visible = !reducedDetail;
    this.wisps.visible = !reducedDetail;
    this.group.scale.setScalar(this.plan.scale);
    // Drape coordinates are sampled in world-aligned XZ. Keep those layers
    // aligned after placement; the shader supplies their animated rotation.
    this.groundLayer.rotation.y = this.groundY ? 0 : this.plan.groundRotation;
    this.runeLayer.rotation.y = this.groundY ? 0 : this.plan.runeRotation;
    this.shardLayer.rotation.y = this.plan.runeRotation * 0.72;
    this.verticalLayer.rotation.y = this.plan.groundRotation * 1.4;

    this.groundMaterial.uniforms.uTime.value = reducedMotion ? 0 : time;
    this.groundMaterial.uniforms.uOpacity.value = this.plan.opacity;
    this.groundMaterial.uniforms.uPulse.value = this.plan.pulse;
    this.voidMaterial.opacity = 0.36 * this.plan.opacity;
    this.runeMaterial.opacity = 0.86 * this.plan.opacity;
    this.haloMaterial.opacity = 0.5 * this.plan.opacity;
    this.columnMaterial.opacity = this.plan.columnOpacity * this.plan.opacity;
    this.shardMaterial.opacity = 0.64 * this.plan.opacity;
    this.wispMaterial.opacity = 0.72 * this.plan.opacity;

    this.column.scale.set(1, this.plan.columnScale, 1);
    for (let index = 0; index < this.verticalHalos.length; index++) {
      const halo = this.verticalHalos[index];
      const haloPulse = 1 + this.plan.pulse * (0.1 + index * 0.04);
      halo.scale.set(haloPulse, 1.45 * haloPulse * this.plan.columnScale, haloPulse);
    }

    if (reducedDetail) return;

    for (let index = 0; index < this.shards.length; index++) {
      const shard = this.shards[index];
      shard.position.y =
        this.shardBaseY[index] +
        this.plan.shardLift +
        Math.sin(time * 1.8 + index * 1.7) * (reducedMotion ? 0 : 0.08);
      shard.rotation.y = -((index / SHARD_COUNT) * Math.PI * 2) + this.plan.runeRotation * 0.45;
      shard.scale.y = 0.9 + (index % 3) * 0.12 + this.plan.pulse * 0.08;
    }

    for (let index = 0; index < WISP_COUNT; index++) {
      const offset = index * 3;
      const angle = this.wispAngles[index] + this.plan.wispSpin * (0.72 + (index % 4) * 0.08);
      const radius = this.wispRadii[index] * (0.82 + this.plan.pulse * 0.035);
      const rise = (this.wispOffsets[index] + this.plan.wispRise * (1 + (index % 3) * 0.16)) % 1;
      this.wispPositions[offset] = Math.cos(angle) * radius;
      this.wispPositions[offset + 1] = 0.12 + rise * 1.92;
      this.wispPositions[offset + 2] = Math.sin(angle) * radius;
    }
    (this.wisps.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
