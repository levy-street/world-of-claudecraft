import * as THREE from 'three';

const MAX_PORTALS = 4;
const PORTAL_CENTER_Y = 2.7;
const PORTAL_RADIUS = 2.35;
const FLOOR_LIFT = 0.08;
const RING_SEGMENTS = 64;
const RUNE_COUNT = 20;
const STREAM_COUNT = 72;

export interface NecromancyArmyPortalSpawn {
  x: number;
  z: number;
  facing: number;
  duration?: number;
}

interface PortalVisual {
  group: THREE.Group;
  membrane: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  outerRing: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  innerRing: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  chains: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  runes: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  floorSeal: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  streams: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  streamPositions: Float32Array;
  streamPhases: Float32Array;
  streamLanes: Float32Array;
  shadows: THREE.Group;
  materials: Array<THREE.Material & { opacity: number }>;
  geometries: THREE.BufferGeometry[];
  baseOpacity: number[];
  elapsed: number;
  duration: number;
}

function buildSoftParticleTexture(): THREE.DataTexture {
  const size = 24;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const distance = Math.hypot(dx, dy) * 2;
      const alpha = Math.round(255 * Math.max(0, 1 - distance) ** 2.5);
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'necromancy-army-portal-particle';
  texture.needsUpdate = true;
  return texture;
}

export class NecromancyArmyPortalFx {
  private readonly portals: PortalVisual[] = [];
  private readonly particleTexture = buildSoftParticleTexture();
  private quality = 1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  setQuality(quality: number): void {
    this.quality = Math.min(1, Math.max(0, Number.isFinite(quality) ? quality : 1));
    for (const portal of this.portals) this.applyQuality(portal);
  }

  spawn(opts: NecromancyArmyPortalSpawn): void {
    while (this.portals.length >= MAX_PORTALS) this.remove(0);
    const facing = Number.isFinite(opts.facing) ? opts.facing : 0;
    const centerGround = this.groundY(opts.x, opts.z);
    const group = new THREE.Group();
    group.name = 'necromancy-army-portal';
    group.position.set(opts.x, centerGround + FLOOR_LIFT, opts.z);
    group.rotation.y = facing;

    const membraneGeometry = new THREE.CircleGeometry(PORTAL_RADIUS * 0.88, 56);
    const membraneMaterial = new THREE.MeshBasicMaterial({
      color: 0x09000f,
      transparent: true,
      opacity: 0.86,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const membrane = new THREE.Mesh(membraneGeometry, membraneMaterial);
    membrane.name = 'necromancy-army-portal-membrane';
    membrane.position.y = PORTAL_CENTER_Y;
    membrane.scale.y = 1.24;
    membrane.renderOrder = 9;

    const outerRingGeometry = new THREE.TorusGeometry(PORTAL_RADIUS, 0.18, 12, 72);
    const outerRingMaterial = new THREE.MeshBasicMaterial({
      color: 0x9b50e3,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const outerRing = new THREE.Mesh(outerRingGeometry, outerRingMaterial);
    outerRing.name = 'necromancy-army-portal-outer-ring';
    outerRing.position.y = PORTAL_CENTER_Y;
    outerRing.scale.y = 1.24;
    outerRing.renderOrder = 11;

    const innerRingGeometry = new THREE.TorusGeometry(PORTAL_RADIUS * 0.82, 0.07, 8, 64);
    const innerRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xb8f2ec,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const innerRing = new THREE.Mesh(innerRingGeometry, innerRingMaterial);
    innerRing.name = 'necromancy-army-portal-inner-ring';
    innerRing.position.set(0, PORTAL_CENTER_Y, 0.035);
    innerRing.scale.y = 1.24;
    innerRing.renderOrder = 12;

    const runes = this.buildRunes();
    const chains = this.buildChains();
    const floorSeal = this.buildFloorSeal(opts.x, opts.z, facing, centerGround);
    const streams = this.buildStreams();
    const shadows = this.buildEmergenceShadows();

    group.add(
      membrane,
      outerRing,
      innerRing,
      runes.lines,
      chains.lines,
      floorSeal.mesh,
      streams.points,
      shadows.group,
    );
    this.scene.add(group);

    const materials = [
      membraneMaterial,
      outerRingMaterial,
      innerRingMaterial,
      runes.lines.material,
      chains.lines.material,
      floorSeal.mesh.material,
      streams.points.material,
      ...shadows.materials,
    ];
    const portal: PortalVisual = {
      group,
      membrane,
      outerRing,
      innerRing,
      chains: chains.lines,
      runes: runes.lines,
      floorSeal: floorSeal.mesh,
      streams: streams.points,
      streamPositions: streams.positions,
      streamPhases: streams.phases,
      streamLanes: streams.lanes,
      shadows: shadows.group,
      materials,
      geometries: [
        membraneGeometry,
        outerRingGeometry,
        innerRingGeometry,
        runes.lines.geometry,
        chains.lines.geometry,
        floorSeal.mesh.geometry,
        streams.points.geometry,
        ...shadows.geometries,
      ],
      baseOpacity: materials.map((material) => material.opacity),
      elapsed: 0,
      duration: Math.max(0.5, opts.duration ?? 2.8),
    };
    this.portals.push(portal);
    this.applyQuality(portal);
  }

  private buildRunes(): {
    lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  } {
    const vertices: number[] = [];
    for (let rune = 0; rune < RUNE_COUNT; rune++) {
      const angle = (rune / RUNE_COUNT) * Math.PI * 2;
      const next = angle + 0.055;
      for (const radius of [PORTAL_RADIUS * 0.92, PORTAL_RADIUS * 1.08]) {
        vertices.push(
          Math.cos(angle) * radius,
          PORTAL_CENTER_Y + Math.sin(angle) * radius * 1.24,
          0.08,
          Math.cos(next) * radius,
          PORTAL_CENTER_Y + Math.sin(next) * radius * 1.24,
          0.08,
        );
      }
      const x = Math.cos(angle) * PORTAL_RADIUS * 1.08;
      const y = PORTAL_CENTER_Y + Math.sin(angle) * PORTAL_RADIUS * 1.08 * 1.24;
      vertices.push(x, y, 0.08, x * 0.9, PORTAL_CENTER_Y + (y - PORTAL_CENTER_Y) * 0.9, 0.08);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xe4ceff,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.name = 'necromancy-army-portal-runes';
    lines.renderOrder = 13;
    return { lines };
  }

  private buildChains(): {
    lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  } {
    const vertices: number[] = [];
    for (let chain = 0; chain < 6; chain++) {
      const angle = (chain / 6) * Math.PI * 2 + 0.25;
      const x = Math.cos(angle) * PORTAL_RADIUS * 1.12;
      const y = PORTAL_CENTER_Y + Math.sin(angle) * PORTAL_RADIUS * 1.12 * 1.24;
      const endX = Math.cos(angle + 0.7) * PORTAL_RADIUS * 0.25;
      const endY = PORTAL_CENTER_Y + Math.sin(angle + 0.7) * PORTAL_RADIUS * 0.25 * 1.24;
      const links = 5;
      for (let link = 0; link < links; link++) {
        const from = link / links;
        const to = (link + 0.72) / links;
        vertices.push(
          x + (endX - x) * from,
          y + (endY - y) * from - Math.sin(from * Math.PI) * 0.22,
          0.11,
          x + (endX - x) * to,
          y + (endY - y) * to - Math.sin(to * Math.PI) * 0.22,
          0.11,
        );
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0x8652b5,
      transparent: true,
      opacity: 0.68,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.name = 'necromancy-army-portal-chains';
    lines.renderOrder = 12;
    return { lines };
  }

  private buildFloorSeal(
    centerX: number,
    centerZ: number,
    facing: number,
    centerGround: number,
  ): {
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  } {
    const vertices: number[] = [];
    const indices: number[] = [];
    const cos = Math.cos(facing);
    const sin = Math.sin(facing);
    for (let segment = 0; segment <= RING_SEGMENTS; segment++) {
      const angle = (segment / RING_SEGMENTS) * Math.PI * 2;
      for (const radius of [1.35, 2.65]) {
        const localX = Math.cos(angle) * radius;
        const localZ = Math.sin(angle) * radius * 0.58;
        const worldX = centerX + localX * cos + localZ * sin;
        const worldZ = centerZ - localX * sin + localZ * cos;
        vertices.push(localX, this.groundY(worldX, worldZ) - centerGround + 0.01, localZ);
      }
      if (segment < RING_SEGMENTS) {
        const inner = segment * 2;
        indices.push(inner, inner + 1, inner + 2, inner + 1, inner + 3, inner + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({
      color: 0x7132b5,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'necromancy-army-portal-floor-seal';
    mesh.renderOrder = 8;
    return { mesh };
  }

  private buildStreams(): {
    points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    positions: Float32Array;
    phases: Float32Array;
    lanes: Float32Array;
  } {
    const positions = new Float32Array(STREAM_COUNT * 3);
    const phases = new Float32Array(STREAM_COUNT);
    const lanes = new Float32Array(STREAM_COUNT);
    for (let index = 0; index < STREAM_COUNT; index++) {
      const lane = (index % 3) - 1;
      const phase = index / STREAM_COUNT;
      lanes[index] = lane;
      phases[index] = phase;
      positions.set(
        [
          lane * 0.92 + Math.sin(index * 1.7) * 0.18,
          0.35 + (index % 11) * 0.28,
          -1.8 + phase * 3.6,
        ],
        index * 3,
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xa870ed,
      size: 0.3,
      map: this.particleTexture,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.name = 'necromancy-army-portal-soul-streams';
    points.frustumCulled = false;
    points.renderOrder = 14;
    return { points, positions, phases, lanes };
  }

  private buildEmergenceShadows(): {
    group: THREE.Group;
    materials: Array<THREE.Material & { opacity: number }>;
    geometries: THREE.BufferGeometry[];
  } {
    const group = new THREE.Group();
    group.name = 'necromancy-army-portal-emergence-shadows';
    const materials: Array<THREE.Material & { opacity: number }> = [];
    const geometries: THREE.BufferGeometry[] = [];
    const silhouettes = [
      { name: 'warrior', x: -1.05, radius: 0.46, height: 1.9, color: 0xa679dd },
      { name: 'bone-mage', x: 0, radius: 0.38, height: 2.25, color: 0x75dcd6 },
      { name: 'gravewing', x: 1.05, radius: 0.6, height: 1.75, color: 0x7e49bd },
    ] as const;
    for (const silhouette of silhouettes) {
      const geometry = new THREE.ConeGeometry(silhouette.radius, silhouette.height, 9, 1, true);
      geometry.translate(0, silhouette.height * 0.5, 0);
      const material = new THREE.MeshBasicMaterial({
        color: silhouette.color,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const shadow = new THREE.Mesh(geometry, material);
      shadow.name = `necromancy-army-portal-${silhouette.name}-shadow`;
      shadow.position.set(silhouette.x, 0.05, -1.6);
      shadow.renderOrder = 10;
      group.add(shadow);
      materials.push(material);
      geometries.push(geometry);
    }
    return { group, materials, geometries };
  }

  update(dt: number, reducedMotion = false): void {
    for (let index = this.portals.length - 1; index >= 0; index--) {
      const portal = this.portals[index];
      portal.elapsed += dt;
      if (portal.elapsed >= portal.duration) {
        this.remove(index);
        continue;
      }
      const fadeIn = Math.min(1, portal.elapsed / 0.12);
      const fadeOut = Math.min(1, (portal.duration - portal.elapsed) / 0.5);
      const alpha = Math.min(fadeIn, fadeOut);
      portal.materials.forEach((material, materialIndex) => {
        material.opacity = portal.baseOpacity[materialIndex] * alpha;
      });
      if (reducedMotion) continue;

      portal.outerRing.rotation.z += dt * 0.72;
      portal.innerRing.rotation.z -= dt * 1.05;
      portal.runes.rotation.z += dt * 0.28;
      portal.chains.scale.setScalar(0.96 + Math.sin(portal.elapsed * 8) * 0.04);
      portal.membrane.scale.x = 0.98 + Math.sin(portal.elapsed * 6.5) * 0.025;

      for (let lane = 0; lane < portal.shadows.children.length; lane++) {
        const shadow = portal.shadows.children[lane];
        const progress = Math.min(1, Math.max(0, (portal.elapsed - lane * 0.12) / 1.25));
        shadow.position.z = -1.6 + progress * 3.5;
        shadow.position.y = 0.05 + Math.sin(portal.elapsed * 7 + lane) * 0.05;
      }

      const streamCount = portal.streams.geometry.drawRange.count;
      for (let stream = 0; stream < streamCount; stream++) {
        const progress = (portal.streamPhases[stream] + portal.elapsed * 0.58) % 1;
        const offset = stream * 3;
        portal.streamPositions[offset] =
          portal.streamLanes[stream] * 0.92 + Math.sin(portal.elapsed * 5 + stream * 1.7) * 0.18;
        portal.streamPositions[offset + 1] = 0.28 + ((stream * 0.31 + portal.elapsed * 1.15) % 3.1);
        portal.streamPositions[offset + 2] = -1.8 + progress * 3.6;
      }
      if (streamCount > 0) portal.streams.geometry.attributes.position.needsUpdate = true;
    }
  }

  dispose(): void {
    while (this.portals.length > 0) this.remove(this.portals.length - 1);
    this.particleTexture.dispose();
  }

  private applyQuality(portal: PortalVisual): void {
    // At the minimum tier the opaque centre can hide nearby combatants; the
    // outer ring and terrain seal still preserve the portal's gameplay read.
    portal.membrane.visible = this.quality >= 0.25;
    portal.outerRing.visible = true;
    portal.floorSeal.visible = true;
    portal.innerRing.visible = this.quality >= 0.1;
    portal.runes.visible = this.quality >= 0.15;
    portal.chains.visible = this.quality >= 0.35;
    portal.streams.visible = this.quality >= 0.25;
    portal.shadows.visible = this.quality >= 0.45;
    portal.streams.geometry.setDrawRange(
      0,
      this.quality < 0.25
        ? 0
        : Math.max(18, Math.round(STREAM_COUNT * (0.25 + this.quality * 0.75))),
    );
  }

  private remove(index: number): void {
    const [portal] = this.portals.splice(index, 1);
    if (!portal) return;
    this.scene.remove(portal.group);
    for (const material of portal.materials) material.dispose();
    for (const geometry of portal.geometries) geometry.dispose();
  }
}
