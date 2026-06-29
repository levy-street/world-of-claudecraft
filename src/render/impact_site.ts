import * as THREE from 'three';
import { DUNGEON_X_THRESHOLD } from '../sim/data';
import { hash2 } from '../sim/rng';
import { MIREFEN_IMPACT_CRATER, terrainHeight } from '../sim/world';
import { GFX } from './gfx';

// Render-only story dressing for Brother Aldric's fallen-star hook. The sim
// heightfield remains authoritative; every decal and prop here samples
// terrainHeight() and floats just above it to avoid introducing a second floor.

export const MIREFEN_IMPACT_SITE = {
  x: MIREFEN_IMPACT_CRATER.x,
  z: MIREFEN_IMPACT_CRATER.z,
  scorchRadius: 15.5,
  rimRadius: 16.5,
  meteor: { x: MIREFEN_IMPACT_CRATER.x + 2.2, z: MIREFEN_IMPACT_CRATER.z - 0.8 },
  cullRadius: 280,
} as const;

const VISUAL_LIFT = 0.055;
const SCORCH_SEGMENTS = 88;
const SCORCH_RINGS = [0.24, 0.48, 0.74, 1.0] as const;
const RIM_SEGMENTS = 96;
export const IMPACT_SITE_CRACK_COUNT = 10;
export const IMPACT_SITE_RIM_PROFILE = [
  { band: 0.68, lift: 0.24, color: 0x2a1d14 },
  { band: 0.88, lift: 0.16, color: 0x3a3026 },
  { band: 1.08, lift: 0.075, color: 0x2a2119 },
  { band: 1.3, lift: 0.018, color: 0x17100b },
] as const;
const SMOKE_COUNT_HIGH = 5;
const SMOKE_COUNT_LOW = 3;

export interface ImpactSiteView {
  group: THREE.Group;
  /** Owned by the renderer's point-light budget, not the cull-toggled group. */
  light: THREE.PointLight;
  update(px: number, pz: number, dt: number): void;
}

export function impactSiteVisualY(x: number, z: number, seed: number): number {
  return terrainHeight(x, z, seed) + VISUAL_LIFT;
}

export function impactSiteNavigationProbePoints(): { x: number; z: number }[] {
  const points: { x: number; z: number }[] = [
    { x: MIREFEN_IMPACT_SITE.x, z: MIREFEN_IMPACT_SITE.z },
  ];
  for (const radius of [4, 8, 12]) {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      points.push({
        x: MIREFEN_IMPACT_SITE.x + Math.cos(angle) * radius,
        z: MIREFEN_IMPACT_SITE.z + Math.sin(angle) * radius,
      });
    }
  }
  return points;
}

function radialJitter(angle: number, seed: number, salt: number): number {
  return (
    0.9 +
    hash2(Math.round(Math.cos(angle) * 1000), Math.round(Math.sin(angle) * 1000), seed + salt) *
      0.18
  );
}

function colorAttr(hex: number): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

function craterDecalMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    fog: false,
    vertexShader: `
      attribute vec3 color;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = color;
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(vColor, vAlpha);
      }
    `,
  });
}

function buildScorchGeometry(seed: number): THREE.BufferGeometry {
  const positions: number[] = [
    MIREFEN_IMPACT_SITE.x,
    impactSiteVisualY(MIREFEN_IMPACT_SITE.x, MIREFEN_IMPACT_SITE.z, seed),
    MIREFEN_IMPACT_SITE.z,
  ];
  const centerColor = colorAttr(0x030201);
  const colors: number[] = [...centerColor];
  const alphas: number[] = [0.58];
  const indices: number[] = [];
  const ringStart: number[] = [];

  for (let r = 0; r < SCORCH_RINGS.length; r++) {
    ringStart.push(positions.length / 3);
    const ringT = SCORCH_RINGS[r];
    for (let i = 0; i < SCORCH_SEGMENTS; i++) {
      const angle = (i / SCORCH_SEGMENTS) * Math.PI * 2;
      const edge = MIREFEN_IMPACT_SITE.scorchRadius * radialJitter(angle, seed, 101);
      const radius = edge * ringT;
      const x = MIREFEN_IMPACT_SITE.x + Math.cos(angle) * radius;
      const z = MIREFEN_IMPACT_SITE.z + Math.sin(angle) * radius;
      positions.push(x, impactSiteVisualY(x, z, seed), z);

      const char =
        ringT < 0.5
          ? colorAttr(0x100805)
          : ringT < 0.82
            ? colorAttr(0x322014)
            : colorAttr(0x17100a);
      colors.push(...char);
      alphas.push(ringT < 0.5 ? 0.5 : ringT < 0.82 ? 0.32 : 0.04);
    }
  }

  for (let i = 0; i < SCORCH_SEGMENTS; i++) {
    const a = ringStart[0] + i;
    const b = ringStart[0] + ((i + 1) % SCORCH_SEGMENTS);
    indices.push(0, a, b);
  }
  for (let r = 1; r < SCORCH_RINGS.length; r++) {
    const inner = ringStart[r - 1];
    const outer = ringStart[r];
    for (let i = 0; i < SCORCH_SEGMENTS; i++) {
      const a = inner + i;
      const b = inner + ((i + 1) % SCORCH_SEGMENTS);
      const c = outer + i;
      const d = outer + ((i + 1) % SCORCH_SEGMENTS);
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alphas, 1));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

function rimMaterial(): THREE.Material {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.96,
        metalness: 0,
        flatShading: true,
      })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
}

function buildRimGeometry(seed: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const start: number[] = [];

  for (let b = 0; b < IMPACT_SITE_RIM_PROFILE.length; b++) {
    start.push(positions.length / 3);
    const profile = IMPACT_SITE_RIM_PROFILE[b];
    for (let i = 0; i < RIM_SEGMENTS; i++) {
      const angle = (i / RIM_SEGMENTS) * Math.PI * 2;
      const jitter = radialJitter(angle, seed, 202);
      const radius = MIREFEN_IMPACT_SITE.rimRadius * profile.band * jitter;
      const x = MIREFEN_IMPACT_SITE.x + Math.cos(angle) * radius;
      const z = MIREFEN_IMPACT_SITE.z + Math.sin(angle) * radius;
      const crestNoise = hash2(i, b, seed + 203) * (b === 0 ? 0.08 : 0.04);
      const crest = profile.lift + crestNoise;
      positions.push(x, impactSiteVisualY(x, z, seed) + crest, z);
      colors.push(...colorAttr(profile.color));
    }
  }

  for (let b = 1; b < IMPACT_SITE_RIM_PROFILE.length; b++) {
    const inner = start[b - 1];
    const outer = start[b];
    for (let i = 0; i < RIM_SEGMENTS; i++) {
      const a = inner + i;
      const b0 = inner + ((i + 1) % RIM_SEGMENTS);
      const c = outer + i;
      const d = outer + ((i + 1) % RIM_SEGMENTS);
      indices.push(a, c, b0, b0, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function meteorMaterial(): THREE.Material {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        color: 0x171716,
        roughness: 0.98,
        metalness: 0.02,
        emissive: 0x060302,
        emissiveIntensity: 0.04,
        flatShading: false,
      })
    : new THREE.MeshLambertMaterial({ color: 0x181716, emissive: 0x050201 });
}

function buildMeteorGeometry(seed: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 28, 12);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const theta = Math.atan2(z, x);
    const rimWarp =
      0.96 + Math.sin(theta * 3.0 + seed * 0.01) * 0.045 + Math.cos(theta * 5.0) * 0.025;
    const topFlatten = y > 0 ? 0.68 : 0.5;
    const undersideTuck = y < -0.2 ? 0.86 : 1;
    pos.setXYZ(
      i,
      x * rimWarp * undersideTuck * 2.22,
      y * topFlatten * 0.62 - 0.06,
      z * rimWarp * undersideTuck * 1.32,
    );
  }
  geo.rotateZ(-0.08);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function glowMaterial(opacity = 0.85): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xff6a1a,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function buildCrack(seed: number, crackIndex: number, angle: number, length: number): THREE.Mesh {
  const pts: THREE.Vector3[] = [];
  const start = 1.6 + hash2(crackIndex, 0, seed + 407) * 0.9;
  const pointCount = 5 + Math.floor(hash2(crackIndex, 1, seed + 408) * 3);
  for (let i = 0; i < pointCount; i++) {
    const t = i / (pointCount - 1);
    const r = start + length * t;
    const wiggle = (hash2(crackIndex * 19, i, seed + 402) - 0.5) * 1.6 * t;
    const a = angle + wiggle * 0.18;
    const x = MIREFEN_IMPACT_SITE.meteor.x + Math.cos(a) * r;
    const z = MIREFEN_IMPACT_SITE.meteor.z + Math.sin(a) * r;
    pts.push(new THREE.Vector3(x, impactSiteVisualY(x, z, seed) + 0.03, z));
  }
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.024, 6, false);
  const mesh = new THREE.Mesh(geo, glowMaterial(0.42));
  mesh.renderOrder = 3;
  return mesh;
}

function pebbleMaterial(): THREE.Material {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        color: 0x2b2924,
        roughness: 0.95,
        metalness: 0.05,
        flatShading: true,
      })
    : new THREE.MeshLambertMaterial({ color: 0x2b2924 });
}

function addRimPebbles(group: THREE.Group, seed: number): void {
  const pebbleGeo = new THREE.DodecahedronGeometry(0.55, 0);
  const mat = pebbleMaterial();
  const count = GFX.standardMaterials ? 22 : 14;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (hash2(i, 0, seed + 501) - 0.5) * 0.34;
    const radius = MIREFEN_IMPACT_SITE.rimRadius * (0.86 + hash2(i, 1, seed + 502) * 0.42);
    const x = MIREFEN_IMPACT_SITE.x + Math.cos(angle) * radius;
    const z = MIREFEN_IMPACT_SITE.z + Math.sin(angle) * radius;
    const s = 0.42 + hash2(i, 2, seed + 503) * 0.82;
    const pebble = new THREE.Mesh(pebbleGeo, mat);
    pebble.position.set(x, impactSiteVisualY(x, z, seed) + s * 0.22, z);
    pebble.scale.set(s * 1.35, s * 0.68, s);
    pebble.rotation.set(
      hash2(i, 3, seed + 504) * Math.PI,
      angle,
      hash2(i, 4, seed + 505) * Math.PI,
    );
    pebble.castShadow = true;
    pebble.receiveShadow = true;
    group.add(pebble);
  }
}

function smokeTexture(): THREE.CanvasTexture {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(210,198,178,0.34)');
  grd.addColorStop(0.35, 'rgba(132,126,114,0.22)');
  grd.addColorStop(0.68, 'rgba(72,67,61,0.12)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildEmbers(seed: number): { points: THREE.Points; material: THREE.PointsMaterial } {
  const count = GFX.standardMaterials ? 30 : 14;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const hot = new THREE.Color(0xff8a25);
  const dim = new THREE.Color(0x9b2d10);
  for (let i = 0; i < count; i++) {
    const angle = hash2(i, 0, seed + 601) * Math.PI * 2;
    const radius = 1.5 + hash2(i, 1, seed + 602) * (MIREFEN_IMPACT_SITE.scorchRadius - 2);
    const x = MIREFEN_IMPACT_SITE.x + Math.cos(angle) * radius;
    const z = MIREFEN_IMPACT_SITE.z + Math.sin(angle) * radius;
    positions[i * 3] = x;
    positions[i * 3 + 1] = impactSiteVisualY(x, z, seed) + 0.08 + hash2(i, 2, seed + 603) * 0.18;
    positions[i * 3 + 2] = z;
    const c = dim.clone().lerp(hot, hash2(i, 3, seed + 604));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: GFX.standardMaterials ? 0.28 : 0.38,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
  const points = new THREE.Points(geo, material);
  points.renderOrder = 4;
  return { points, material };
}

export function buildImpactSite(seed: number): ImpactSiteView {
  const group = new THREE.Group();
  group.name = 'mirefen-impact-site';

  const scorch = new THREE.Mesh(buildScorchGeometry(seed), craterDecalMaterial());
  scorch.name = 'mirefen-impact-scorch';
  scorch.renderOrder = 2;
  group.add(scorch);

  const rim = new THREE.Mesh(buildRimGeometry(seed), rimMaterial());
  rim.name = 'mirefen-impact-rim';
  rim.castShadow = true;
  rim.receiveShadow = true;
  group.add(rim);
  addRimPebbles(group, seed);

  const meteor = new THREE.Mesh(buildMeteorGeometry(seed), meteorMaterial());
  meteor.name = 'mirefen-impact-meteor';
  const meteorY =
    terrainHeight(MIREFEN_IMPACT_SITE.meteor.x, MIREFEN_IMPACT_SITE.meteor.z, seed) + 0.42;
  meteor.position.set(MIREFEN_IMPACT_SITE.meteor.x, meteorY, MIREFEN_IMPACT_SITE.meteor.z);
  meteor.rotation.set(0.08, -0.55, -0.06);
  meteor.castShadow = true;
  meteor.receiveShadow = true;
  group.add(meteor);

  for (let i = 0; i < IMPACT_SITE_CRACK_COUNT; i++) {
    const angle = hash2(i, 0, seed + 401) * Math.PI * 2;
    const length = 1.9 + hash2(i, 1, seed + 403) * 5.2;
    group.add(buildCrack(seed, i, angle, length));
  }

  const glow = new THREE.Mesh(new THREE.RingGeometry(0.9, 2.0, 40), glowMaterial(0.16));
  glow.name = 'mirefen-impact-glow';
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(
    MIREFEN_IMPACT_SITE.meteor.x,
    impactSiteVisualY(MIREFEN_IMPACT_SITE.meteor.x, MIREFEN_IMPACT_SITE.meteor.z, seed) + 0.04,
    MIREFEN_IMPACT_SITE.meteor.z,
  );
  glow.renderOrder = 5;
  group.add(glow);

  // NOT added to `group`: the group cull-toggles its visibility by distance, which
  // would change the scene's visible point-light count (and recompile every nearby
  // material) as the player nears/leaves. Instead the renderer adds this light to
  // its constant-count point-light budget; baseIntensity lets it flicker with the
  // campfire lights there.
  const light = new THREE.PointLight(0xff6a1a, GFX.standardMaterials ? 2.4 : 1.3, 12, 2);
  light.name = 'mirefen-impact-light';
  light.position.set(MIREFEN_IMPACT_SITE.meteor.x, meteorY + 1.1, MIREFEN_IMPACT_SITE.meteor.z);
  light.userData.baseIntensity = GFX.standardMaterials ? 2.4 : 1.3;

  const { points: embers, material: emberMat } = buildEmbers(seed);
  group.add(embers);

  const smokeTex = smokeTexture();
  const smoke: THREE.Sprite[] = [];
  const smokeCount = GFX.standardMaterials ? SMOKE_COUNT_HIGH : SMOKE_COUNT_LOW;
  for (let i = 0; i < smokeCount; i++) {
    const mat = new THREE.SpriteMaterial({
      map: smokeTex,
      color: 0x8c8579,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.name = 'mirefen-impact-smoke';
    sprite.position.set(
      MIREFEN_IMPACT_SITE.meteor.x,
      meteorY + 1.2 + i * 0.35,
      MIREFEN_IMPACT_SITE.meteor.z,
    );
    sprite.scale.setScalar(4.5 + i * 0.8);
    smoke.push(sprite);
    group.add(sprite);
  }

  let time = 0;
  return {
    group,
    light,
    update(px: number, pz: number, dt: number): void {
      if (px > DUNGEON_X_THRESHOLD) {
        group.visible = false;
        return;
      }
      const dx = px - MIREFEN_IMPACT_SITE.x;
      const dz = pz - MIREFEN_IMPACT_SITE.z;
      group.visible =
        dx * dx + dz * dz < MIREFEN_IMPACT_SITE.cullRadius * MIREFEN_IMPACT_SITE.cullRadius;
      if (!group.visible) return;

      time += dt;
      // light intensity is driven by the renderer's budgeted-light flicker now.
      (glow.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.sin(time * 3.1) * 0.035;
      glow.rotation.z += dt * 0.15;
      emberMat.opacity = 0.34 + Math.sin(time * 5.2) * 0.12;

      for (let i = 0; i < smoke.length; i++) {
        const sprite = smoke[i];
        const phase = (time * 0.08 + i / smoke.length) % 1;
        const drift = Math.sin(time * 0.7 + i * 1.9) * 0.45;
        sprite.position.set(
          MIREFEN_IMPACT_SITE.meteor.x + drift,
          meteorY + 1.1 + phase * 5.2,
          MIREFEN_IMPACT_SITE.meteor.z + Math.cos(time * 0.5 + i) * 0.35,
        );
        sprite.scale.setScalar(4.2 + phase * 3.6 + i * 0.35);
        sprite.rotation.z += dt * (0.08 + i * 0.02);
        (sprite.material as THREE.SpriteMaterial).opacity = (1 - phase) * 0.16;
      }
    },
  };
}
