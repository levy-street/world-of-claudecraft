import * as THREE from 'three';

const MAX_ZONES = 8;
const SEGMENTS = 56;
const GROUND_LIFT = 0.07;
const FADE_SECONDS = 0.75;
const WISP_COUNT = 20;
const MAX_DEATH_ECHOES = 24;
const ECHO_WISP_COUNT = 9;

function buildSoftWispTexture(): THREE.DataTexture {
  const size = 24;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const distance = Math.sqrt(dx * dx + dy * dy) * 2;
      const alpha = Math.round(255 * Math.max(0, 1 - distance) ** 2);
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'necromancy-soft-wisp';
  texture.needsUpdate = true;
  return texture;
}

export interface DesecrationSpawn {
  x: number;
  z: number;
  radius: number;
  duration: number;
}

interface DesecrationFx {
  group: THREE.Group;
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  runes: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  wisps: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  wispPositions: Float32Array;
  wispOrigins: Float32Array;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  baseOpacity: number[];
  duration: number;
  elapsed: number;
}

interface DeathEchoFx {
  group: THREE.Group;
  seal: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  runes: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  soul: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  wisps: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  wispPositions: Float32Array;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  baseOpacity: number[];
  seenFrame: number;
  elapsed: number;
}

export class NecromancyGroundFx {
  private readonly zones: DesecrationFx[] = [];
  private readonly deathEchoes = new Map<string, DeathEchoFx>();
  private echoFrame = 0;
  private readonly wispTexture = buildSoftWispTexture();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  syncDeathEcho(ownerId: number, auraId: string, x: number, z: number): void {
    const key = `${ownerId}:${auraId}`;
    let echo = this.deathEchoes.get(key);
    if (!echo) {
      while (this.deathEchoes.size >= MAX_DEATH_ECHOES) {
        const oldest = this.deathEchoes.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.removeDeathEcho(oldest);
      }
      echo = this.buildDeathEcho();
      this.deathEchoes.set(key, echo);
      this.scene.add(echo.group);
    }
    echo.group.position.set(x, this.groundY(x, z) + GROUND_LIFT, z);
    echo.seenFrame = this.echoFrame;
  }

  private buildDeathEcho(): DeathEchoFx {
    const group = new THREE.Group();
    group.name = 'necromancy-death-echo';

    const sealGeometry = new THREE.RingGeometry(0.38, 1.3, 40);
    const sealMaterial = new THREE.MeshBasicMaterial({
      color: 0x7436ae,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const seal = new THREE.Mesh(sealGeometry, sealMaterial);
    seal.name = 'necromancy-death-echo-seal';
    seal.rotation.x = -Math.PI / 2;
    seal.renderOrder = 7;

    const runeVertices: number[] = [];
    for (let segment = 0; segment < 18; segment++) {
      if (segment % 3 === 2) continue;
      const a = (segment / 18) * Math.PI * 2;
      const b = ((segment + 0.72) / 18) * Math.PI * 2;
      for (const radius of [0.72, 1.08]) {
        runeVertices.push(
          Math.cos(a) * radius,
          0.025,
          Math.sin(a) * radius,
          Math.cos(b) * radius,
          0.025,
          Math.sin(b) * radius,
        );
      }
    }
    for (let shard = 0; shard < 6; shard++) {
      const angle = (shard / 6) * Math.PI * 2;
      const x = Math.cos(angle) * 0.88;
      const z = Math.sin(angle) * 0.88;
      runeVertices.push(
        x - Math.sin(angle) * 0.17,
        0.03,
        z + Math.cos(angle) * 0.17,
        x,
        0.03,
        z,
        x,
        0.03,
        z,
        x + Math.cos(angle) * 0.3,
        0.03,
        z + Math.sin(angle) * 0.3,
      );
    }
    const runeGeometry = new THREE.BufferGeometry();
    runeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(runeVertices, 3));
    const runeMaterial = new THREE.LineBasicMaterial({
      color: 0xd9c4ff,
      transparent: true,
      opacity: 0.74,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const runes = new THREE.LineSegments(runeGeometry, runeMaterial);
    runes.name = 'necromancy-death-echo-runes';
    runes.renderOrder = 8;

    const soulGeometry = new THREE.ConeGeometry(0.3, 1.9, 7, 1, true);
    soulGeometry.translate(0, 1, 0);
    const soulMaterial = new THREE.MeshBasicMaterial({
      color: 0x75ded8,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const soul = new THREE.Mesh(soulGeometry, soulMaterial);
    soul.name = 'necromancy-death-echo-soul';
    soul.renderOrder = 8;

    const wispPositions = new Float32Array(ECHO_WISP_COUNT * 3);
    for (let i = 0; i < ECHO_WISP_COUNT; i++) {
      const angle = (i / ECHO_WISP_COUNT) * Math.PI * 2;
      const radius = 0.42 + (i % 3) * 0.18;
      wispPositions.set(
        [Math.cos(angle) * radius, 0.24 + (i % 4) * 0.25, Math.sin(angle) * radius],
        i * 3,
      );
    }
    const wispGeometry = new THREE.BufferGeometry();
    wispGeometry.setAttribute('position', new THREE.BufferAttribute(wispPositions, 3));
    const wispMaterial = new THREE.PointsMaterial({
      color: 0xb985ef,
      size: 0.22,
      map: this.wispTexture,
      transparent: true,
      opacity: 0.68,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const wisps = new THREE.Points(wispGeometry, wispMaterial);
    wisps.name = 'necromancy-death-echo-wisps';
    wisps.frustumCulled = false;
    wisps.renderOrder = 8;

    group.add(seal, runes, soul, wisps);
    const materials = [sealMaterial, runeMaterial, soulMaterial, wispMaterial];
    return {
      group,
      seal,
      runes,
      soul,
      wisps,
      wispPositions,
      materials,
      geometries: [sealGeometry, runeGeometry, soulGeometry, wispGeometry],
      baseOpacity: materials.map((material) => material.opacity),
      seenFrame: this.echoFrame,
      elapsed: 0,
    };
  }

  spawnDesecration(opts: DesecrationSpawn): void {
    while (this.zones.length >= MAX_ZONES) this.removeZone(0);

    const group = new THREE.Group();
    group.name = 'necromancy-desecration';
    const ring = this.buildRing(opts);
    const glow = this.buildGlow(opts);
    const runes = this.buildRunes(opts);
    const wisps = this.buildWisps(opts);
    group.add(glow, ring, runes, wisps.points);
    this.scene.add(group);

    const materials = [glow.material, ring.material, runes.material, wisps.points.material];
    this.zones.push({
      group,
      ring,
      glow,
      runes,
      wisps: wisps.points,
      wispPositions: wisps.positions,
      wispOrigins: wisps.origins,
      materials,
      geometries: [glow.geometry, ring.geometry, runes.geometry, wisps.points.geometry],
      baseOpacity: materials.map(
        (material) => (material as THREE.Material & { opacity: number }).opacity,
      ),
      duration: Math.max(0.2, opts.duration),
      elapsed: 0,
    });
  }

  private buildRing(
    opts: DesecrationSpawn,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
    const vertices: number[] = [];
    const indices: number[] = [];
    for (let segment = 0; segment <= SEGMENTS; segment++) {
      const angle = (segment / SEGMENTS) * Math.PI * 2;
      for (const radius of [opts.radius * 0.76, opts.radius]) {
        const x = opts.x + Math.cos(angle) * radius;
        const z = opts.z + Math.sin(angle) * radius;
        vertices.push(x, this.groundY(x, z) + GROUND_LIFT, z);
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
      color: 0xa83dff,
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.name = 'necromancy-desecration-ring';
    ring.renderOrder = 7;
    return ring;
  }

  private buildGlow(
    opts: DesecrationSpawn,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
    const vertices = [opts.x, this.groundY(opts.x, opts.z) + GROUND_LIFT * 0.8, opts.z];
    const indices: number[] = [];
    for (let segment = 0; segment <= SEGMENTS; segment++) {
      const angle = (segment / SEGMENTS) * Math.PI * 2;
      const x = opts.x + Math.cos(angle) * opts.radius * 0.9;
      const z = opts.z + Math.sin(angle) * opts.radius * 0.9;
      vertices.push(x, this.groundY(x, z) + GROUND_LIFT * 0.8, z);
      if (segment < SEGMENTS) indices.push(0, segment + 1, segment + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({
      color: 0x3a0754,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const glow = new THREE.Mesh(geometry, material);
    glow.name = 'necromancy-desecration-glow';
    glow.renderOrder = 6;
    return glow;
  }

  private buildRunes(
    opts: DesecrationSpawn,
  ): THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> {
    const vertices: number[] = [];
    const runeRadius = opts.radius * 0.54;
    for (let rune = 0; rune < 8; rune++) {
      const angle = (rune / 8) * Math.PI * 2;
      const tangentX = -Math.sin(angle);
      const tangentZ = Math.cos(angle);
      const radialX = Math.cos(angle);
      const radialZ = Math.sin(angle);
      const centerX = opts.x + radialX * runeRadius;
      const centerZ = opts.z + radialZ * runeRadius;
      for (const [ax, az, bx, bz] of [
        [-0.34, -0.18, 0, 0.28],
        [0, 0.28, 0.34, -0.18],
        [-0.22, -0.04, 0.22, -0.04],
      ] as const) {
        for (const [along, across] of [
          [ax, az],
          [bx, bz],
        ] as const) {
          const x = centerX + tangentX * along + radialX * across;
          const z = centerZ + tangentZ * along + radialZ * across;
          vertices.push(x - opts.x, this.groundY(x, z) + GROUND_LIFT * 1.15, z - opts.z);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xe3a8ff,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const runes = new THREE.LineSegments(geometry, material);
    runes.name = 'necromancy-desecration-runes';
    runes.position.set(opts.x, 0, opts.z);
    runes.renderOrder = 8;
    return runes;
  }

  private buildWisps(opts: DesecrationSpawn): {
    points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    positions: Float32Array;
    origins: Float32Array;
  } {
    const positions = new Float32Array(WISP_COUNT * 3);
    const origins = new Float32Array(WISP_COUNT * 3);
    for (let i = 0; i < WISP_COUNT; i++) {
      const angle = (i / WISP_COUNT) * Math.PI * 2 + (i % 3) * 0.31;
      const radius = opts.radius * (0.18 + ((i * 7) % WISP_COUNT) / WISP_COUNT) * 0.72;
      const x = opts.x + Math.cos(angle) * radius;
      const z = opts.z + Math.sin(angle) * radius;
      const baseY = this.groundY(x, z);
      const y = baseY + ((i * 0.37) % 1.8);
      positions.set([x, y, z], i * 3);
      origins.set([x, baseY, z], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xc667ff,
      size: 0.28,
      map: this.wispTexture,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.name = 'necromancy-desecration-wisps';
    points.frustumCulled = false;
    points.renderOrder = 8;
    return { points, positions, origins };
  }

  update(dt: number, reducedMotion = false): void {
    for (const [key, echo] of this.deathEchoes) {
      if (echo.seenFrame !== this.echoFrame) {
        this.removeDeathEcho(key);
        continue;
      }
      echo.elapsed += dt;
      const pulse = reducedMotion ? 1 : 0.86 + Math.sin(echo.elapsed * 3.2) * 0.14;
      echo.materials.forEach((material, index) => {
        material.opacity = echo.baseOpacity[index] * pulse;
      });
      if (reducedMotion) continue;
      echo.runes.rotation.y += dt * 0.22;
      echo.soul.rotation.y -= dt * 0.38;
      for (let i = 0; i < ECHO_WISP_COUNT; i++) {
        const offset = i * 3;
        const angle = (i / ECHO_WISP_COUNT) * Math.PI * 2 + echo.elapsed * 0.42;
        const radius = 0.42 + (i % 3) * 0.18;
        echo.wispPositions[offset] = Math.cos(angle) * radius;
        echo.wispPositions[offset + 1] =
          0.2 + ((echo.elapsed * (0.22 + (i % 3) * 0.04) + i * 0.19) % 1.25);
        echo.wispPositions[offset + 2] = Math.sin(angle) * radius;
      }
      echo.wisps.geometry.attributes.position.needsUpdate = true;
    }
    this.echoFrame++;

    for (let i = this.zones.length - 1; i >= 0; i--) {
      const zone = this.zones[i];
      zone.elapsed += dt;
      if (zone.elapsed >= zone.duration) {
        this.removeZone(i);
        continue;
      }
      const fade = Math.min(1, (zone.duration - zone.elapsed) / FADE_SECONDS);
      const pulse = reducedMotion ? 1 : 0.84 + Math.sin(zone.elapsed * 3.6) * 0.16;
      zone.materials.forEach((material, index) => {
        (material as THREE.Material & { opacity: number }).opacity =
          zone.baseOpacity[index] * fade * pulse;
      });
      if (reducedMotion) continue;
      zone.runes.rotation.y += dt * 0.12;
      for (let wisp = 0; wisp < WISP_COUNT; wisp++) {
        const offset = wisp * 3;
        const rise = (zone.elapsed * (0.42 + (wisp % 4) * 0.08) + wisp * 0.17) % 2.4;
        zone.wispPositions[offset] =
          zone.wispOrigins[offset] + Math.sin(zone.elapsed * 1.7 + wisp) * 0.08;
        zone.wispPositions[offset + 1] = zone.wispOrigins[offset + 1] + 0.16 + rise;
        zone.wispPositions[offset + 2] =
          zone.wispOrigins[offset + 2] + Math.cos(zone.elapsed * 1.5 + wisp) * 0.08;
      }
      zone.wisps.geometry.attributes.position.needsUpdate = true;
    }
  }

  dispose(): void {
    while (this.zones.length > 0) this.removeZone(this.zones.length - 1);
    for (const key of [...this.deathEchoes.keys()]) this.removeDeathEcho(key);
    this.wispTexture.dispose();
  }

  private removeDeathEcho(key: string): void {
    const echo = this.deathEchoes.get(key);
    if (!echo) return;
    this.scene.remove(echo.group);
    for (const material of echo.materials) material.dispose();
    for (const geometry of echo.geometries) geometry.dispose();
    this.deathEchoes.delete(key);
  }

  private removeZone(index: number): void {
    const zone = this.zones[index];
    if (!zone) return;
    this.scene.remove(zone.group);
    for (const material of zone.materials) material.dispose();
    for (const geometry of zone.geometries) geometry.dispose();
    this.zones.splice(index, 1);
  }
}
