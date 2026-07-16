// Render-only atmosphere for the Infernal Abyss. Everything is attached to the
// supplied interior group, so the dungeon owner controls its lifetime. Animation
// reads the renderer's shared clock and needs no update hook or per-frame allocation.
import * as THREE from 'three';
import type { DungeonLayout } from '../sim/dungeon_layout';
import { hash2 } from '../sim/rng';
import { sharedUniforms } from './gfx';

interface LavafallSpec {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  yaw: number;
  essential: boolean;
}

interface CaveAnchor {
  x: number;
  z: number;
  noise: number;
}

interface EmberZone {
  x: number;
  z: number;
  rx: number;
  rz: number;
  y: number;
  height: number;
  count: number;
}

export interface InfernalAbyssAtmosphereStats {
  drawCalls: number;
  lavafalls: number;
  stalactites: number;
  chasmCrags: number;
  emberMotes: number;
}

// The waterfalls frame the same landmarks as the concept art: the monumental
// forge, both walls of the Maw, the Pyre Golem crucible, and Azazel's throne.
// Essential falls survive low gfx so navigation silhouettes never change by tier.
const LAVAFALLS: readonly LavafallSpec[] = [
  { x: -26, y: 7.3, z: 135.1, width: 5.5, height: 14.6, yaw: 0, essential: false },
  { x: 20, y: 7.1, z: 135.1, width: 7.2, height: 14.2, yaw: 0, essential: true },
  {
    x: -18.4,
    y: 3.2,
    z: 160,
    width: 5.2,
    height: 21,
    yaw: Math.PI / 2,
    essential: true,
  },
  {
    x: 18.4,
    y: 3.2,
    z: 164,
    width: 5.2,
    height: 21,
    yaw: -Math.PI / 2,
    essential: true,
  },
  { x: -24, y: 7.4, z: 231.1, width: 8.5, height: 16.2, yaw: 0, essential: true },
  { x: 24, y: 7.4, z: 231.1, width: 8.5, height: 16.2, yaw: 0, essential: true },
  { x: 0, y: 10, z: 231.25, width: 4.2, height: 11, yaw: 0, essential: false },
  { x: -77, y: 6.2, z: 93.05, width: 5.4, height: 12.4, yaw: 0, essential: false },
] as const;

const EMBER_ZONES: readonly EmberZone[] = [
  { x: -25, z: 69, rx: 29, rz: 23, y: 0.2, height: 8.5, count: 44 },
  { x: 0, z: 114, rx: 29, rz: 21, y: 0.3, height: 10, count: 68 },
  { x: 0, z: 162, rx: 18, rz: 20, y: -4, height: 15, count: 46 },
  { x: 0, z: 217, rx: 39, rz: 17, y: 0.3, height: 13, count: 92 },
] as const;

const ICONIC_STALACTITES: ReadonlyArray<readonly [number, number]> = [
  [-29, 133],
  [-5, 135],
  [26, 133],
  [-8, 151],
  [8, 155],
  [-9, 169],
  [9, 173],
  [-36, 226],
  [-25, 231],
  [-12, 229],
  [12, 229],
  [25, 231],
  [36, 226],
] as const;

function flowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vPulse;
      void main() {
        vUv = uv;
        vPulse = 0.86 + 0.14 * sin(uTime * 1.8 + uv.y * 13.0 + uv.x * 4.0);
        vec4 localPosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          localPosition = instanceMatrix * localPosition;
        #endif
        vec4 mvPosition = modelViewMatrix * localPosition;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vPulse;
      void main() {
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(0.0, 0.12, 1.0 - vUv.x);
        float ribbon = sin(vUv.y * 42.0 - uTime * 5.2 + sin(vUv.x * 14.0) * 2.2);
        float crossFlow = sin(vUv.x * 24.0 + vUv.y * 9.0 + uTime * 1.4);
        float crust = smoothstep(0.42, 0.94, abs(ribbon * 0.72 + crossFlow * 0.28));
        float core = 1.0 - smoothstep(0.0, 0.46, abs(vUv.x - 0.5));
        vec3 ember = vec3(0.52, 0.025, 0.003);
        vec3 molten = vec3(2.4, 0.31, 0.008) * vPulse;
        vec3 whiteHot = vec3(3.2, 0.95, 0.08);
        vec3 color = mix(molten, ember, crust * 0.72);
        color = mix(color, whiteHot, core * (1.0 - crust) * 0.22);
        float bottomSpray = 0.82 + 0.18 * sin(vUv.x * 31.0 + uTime * 2.7);
        float alpha = edge * mix(bottomSpray, 0.96, smoothstep(0.0, 0.25, vUv.y));
        if (alpha < 0.025) discard;
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}

function basaltMaterial(lowGfx: boolean): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color: lowGfx ? 0x32100c : 0x42130d,
    emissive: 0x130302,
    emissiveIntensity: lowGfx ? 0.32 : 0.48,
    flatShading: true,
  });
}

function layoutBounds(layout: DungeonLayout): {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
} {
  if (!layout.rooms?.length) {
    const halfX = layout.floorHalfX ?? layout.wallX ?? 24;
    return { x0: -halfX, x1: halfX, z0: layout.zMin, z1: layout.zMax };
  }
  return {
    x0: Math.min(...layout.rooms.map((room) => room.x0)),
    x1: Math.max(...layout.rooms.map((room) => room.x1)),
    z0: Math.min(...layout.rooms.map((room) => room.z0)),
    z1: Math.max(...layout.rooms.map((room) => room.z1)),
  };
}

function buildCeilingGeometry(layout: DungeonLayout, lowGfx: boolean): THREE.BufferGeometry {
  const bounds = layoutBounds(layout);
  const margin = 8;
  const width = bounds.x1 - bounds.x0 + margin * 2;
  const depth = bounds.z1 - bounds.z0 + margin * 2;
  const geo = new THREE.PlaneGeometry(width, depth, lowGfx ? 10 : 18, lowGfx ? 18 : 30);
  const position = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const dark = new THREE.Color(0x170606);
  const warm = new THREE.Color(0x4a170e);
  const color = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getY(i);
    const wave = 0.5 + Math.sin(x * 0.075 + z * 0.019) * 0.24 + Math.cos(z * 0.052) * 0.2;
    const grain = hash2(Math.round(x * 5), Math.round(z * 5), 0x1ab155);
    const drop = 1.15 + wave * 2.25 + grain * 1.3;
    position.setZ(i, drop);
    color.copy(dark).lerp(warm, 0.18 + grain * 0.44);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // PlaneGeometry faces +z. Rotating this way makes its lit front face point
  // down into the dungeon while staying invisible if the camera rises above it.
  geo.rotateX(Math.PI / 2);
  geo.translate((bounds.x0 + bounds.x1) / 2, lowGfx ? 18.2 : 19.2, (bounds.z0 + bounds.z1) / 2);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function placeCeiling(group: THREE.Group, layout: DungeonLayout, lowGfx: boolean): void {
  const material = new THREE.MeshLambertMaterial({
    color: 0x4a1a12,
    emissive: 0x160403,
    emissiveIntensity: lowGfx ? 0.28 : 0.42,
    flatShading: true,
    side: THREE.FrontSide,
    vertexColors: true,
  });
  const ceiling = new THREE.Mesh(buildCeilingGeometry(layout, lowGfx), material);
  ceiling.name = 'infernal-abyss-cavern-vault';
  ceiling.castShadow = false;
  ceiling.receiveShadow = false;
  group.add(ceiling);
}

function caveAnchors(layout: DungeonLayout, lowGfx: boolean): CaveAnchor[] {
  const bounds = layoutBounds(layout);
  const rooms = layout.rooms?.length
    ? layout.rooms
    : [{ id: 'fallback', x0: bounds.x0, x1: bounds.x1, z0: bounds.z0, z1: bounds.z1 }];
  const spacing = lowGfx ? 28 : 17;
  const anchors: CaveAnchor[] = [];
  const occupied = new Set<string>();

  const add = (x: number, z: number, salt: number, force = false): void => {
    const key = `${Math.round(x * 2)}:${Math.round(z * 2)}`;
    if (occupied.has(key)) return;
    const noise = hash2(Math.round(x * 7), Math.round(z * 7), 0xc411 + salt);
    if (!force && noise < (lowGfx ? 0.42 : 0.2)) return;
    occupied.add(key);
    anchors.push({ x, z, noise });
  };

  for (let roomIndex = 0; roomIndex < rooms.length; roomIndex++) {
    const room = rooms[roomIndex];
    const xCount = Math.max(1, Math.ceil((room.x1 - room.x0) / spacing));
    const zCount = Math.max(1, Math.ceil((room.z1 - room.z0) / spacing));
    for (let i = 0; i < xCount; i++) {
      const x = room.x0 + ((i + 0.5) / xCount) * (room.x1 - room.x0);
      add(x, room.z0, roomIndex * 17 + i);
      add(x, room.z1, roomIndex * 17 + i + 503);
    }
    for (let i = 0; i < zCount; i++) {
      const z = room.z0 + ((i + 0.5) / zCount) * (room.z1 - room.z0);
      add(room.x0, z, roomIndex * 29 + i + 101);
      add(room.x1, z, roomIndex * 29 + i + 907);
    }
  }
  for (let i = 0; i < ICONIC_STALACTITES.length; i++) {
    const [x, z] = ICONIC_STALACTITES[i];
    add(x, z, 2000 + i, true);
  }
  return anchors;
}

function placeCaveSilhouette(
  group: THREE.Group,
  layout: DungeonLayout,
  lowGfx: boolean,
  coneGeometry: THREE.ConeGeometry,
  material: THREE.Material,
): number {
  const anchors = caveAnchors(layout, lowGfx);
  const dummy = new THREE.Object3D();

  const crownGeometry = new THREE.IcosahedronGeometry(1, 0);
  const crown = new THREE.InstancedMesh(crownGeometry, material, anchors.length);
  crown.name = 'infernal-abyss-cavern-crown';
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const width = 2.2 + hash2(i, 1, 0xc011) * 3.4;
    dummy.position.set(anchor.x, 9.4 + anchor.noise * 1.5, anchor.z);
    dummy.rotation.set(
      hash2(i, 2, 0xc012) * 0.35,
      hash2(i, 3, 0xc013) * Math.PI,
      hash2(i, 4, 0xc014) * 0.28,
    );
    dummy.scale.set(width, 1.8 + anchor.noise * 1.8, width * (0.65 + anchor.noise * 0.3));
    dummy.updateMatrix();
    crown.setMatrixAt(i, dummy.matrix);
  }
  crown.instanceMatrix.needsUpdate = true;
  crown.castShadow = false;
  crown.receiveShadow = true;
  group.add(crown);

  const stalactites = new THREE.InstancedMesh(coneGeometry, material, anchors.length);
  stalactites.name = 'infernal-abyss-stalactites';
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const ceilingY = 16.2 + hash2(i, 8, 0x57a1) * 1.8;
    const length = 3.2 + anchor.noise * (lowGfx ? 3.6 : 5.4);
    const radius = 0.75 + hash2(i, 9, 0x57a2) * 1.15;
    dummy.position.set(anchor.x, ceilingY - length / 2, anchor.z);
    dummy.rotation.set(0, hash2(i, 10, 0x57a3) * Math.PI, Math.PI);
    dummy.scale.set(radius, length, radius);
    dummy.updateMatrix();
    stalactites.setMatrixAt(i, dummy.matrix);
  }
  stalactites.instanceMatrix.needsUpdate = true;
  stalactites.castShadow = false;
  stalactites.receiveShadow = true;
  group.add(stalactites);
  return anchors.length;
}

function placeLavafalls(
  group: THREE.Group,
  lowGfx: boolean,
  geometry: THREE.PlaneGeometry,
  material: THREE.ShaderMaterial,
): number {
  const specs = lowGfx ? LAVAFALLS.filter((spec) => spec.essential) : LAVAFALLS;
  const falls = new THREE.InstancedMesh(geometry, material, specs.length);
  falls.name = 'infernal-abyss-lavafalls';
  const dummy = new THREE.Object3D();
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    dummy.position.set(spec.x, spec.y, spec.z);
    dummy.rotation.set(0, spec.yaw, 0);
    dummy.scale.set(spec.width, spec.height, 1);
    dummy.updateMatrix();
    falls.setMatrixAt(i, dummy.matrix);
  }
  falls.instanceMatrix.needsUpdate = true;
  falls.renderOrder = 2;
  group.add(falls);
  return specs.length;
}

function placeMawDepth(
  group: THREE.Group,
  lowGfx: boolean,
  coneGeometry: THREE.ConeGeometry,
  basalt: THREE.Material,
  molten: THREE.ShaderMaterial,
): number {
  const riverGeometry = new THREE.PlaneGeometry(1, 1, 1, lowGfx ? 4 : 10).rotateX(-Math.PI / 2);
  const river = new THREE.Mesh(riverGeometry, molten);
  river.name = 'infernal-abyss-maw-river';
  river.position.set(0, -12.4, 162);
  river.scale.set(34, 1, 49);
  river.renderOrder = 1;
  group.add(river);

  const sideCount = lowGfx ? 8 : 14;
  const cliffGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cliffs = new THREE.InstancedMesh(cliffGeometry, basalt, sideCount * 2);
  cliffs.name = 'infernal-abyss-maw-cliff-faces';
  const dummy = new THREE.Object3D();
  const span = 32 / sideCount;
  let index = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < sideCount; i++, index++) {
      const n = hash2(i, side, 0xdee9);
      const height = 8.8 + n * 4.2;
      dummy.position.set(side * (6.3 + n * 0.35), -height / 2 + 0.05, 146 + (i + 0.5) * span);
      dummy.rotation.set(0, (n - 0.5) * 0.18, (n - 0.5) * 0.08);
      dummy.scale.set(2.1 + n * 0.9, height, span * 1.2);
      dummy.updateMatrix();
      cliffs.setMatrixAt(index, dummy.matrix);
    }
  }
  cliffs.instanceMatrix.needsUpdate = true;
  cliffs.castShadow = false;
  cliffs.receiveShadow = true;
  group.add(cliffs);

  const cragCount = lowGfx ? 8 : 18;
  const crags = new THREE.InstancedMesh(coneGeometry, basalt, cragCount);
  crags.name = 'infernal-abyss-maw-depth-crags';
  for (let i = 0; i < cragCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const width = 1.2 + hash2(i, 1, 0xc4a9) * 2;
    const height = 5 + hash2(i, 2, 0xc4aa) * 8;
    dummy.position.set(
      side * (9 + hash2(i, 3, 0xc4ab) * 9),
      -12.1 + height / 2,
      145 + hash2(i, 4, 0xc4ac) * 35,
    );
    dummy.rotation.set(0, hash2(i, 5, 0xc4ad) * Math.PI, 0);
    dummy.scale.set(width, height, width);
    dummy.updateMatrix();
    crags.setMatrixAt(i, dummy.matrix);
  }
  crags.instanceMatrix.needsUpdate = true;
  crags.castShadow = false;
  crags.receiveShadow = true;
  group.add(crags);
  return cragCount;
}

function placeEmbers(group: THREE.Group): number {
  const count = EMBER_ZONES.reduce((sum, zone) => sum + zone.count, 0);
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  const heights = new Float32Array(count);
  const sizes = new Float32Array(count);
  const heats = new Float32Array(count);
  let index = 0;
  for (let zoneIndex = 0; zoneIndex < EMBER_ZONES.length; zoneIndex++) {
    const zone = EMBER_ZONES[zoneIndex];
    for (let i = 0; i < zone.count; i++, index++) {
      const seed = zoneIndex * 1000 + i;
      positions[index * 3] = zone.x + (hash2(seed, 1, 0xe6b1) * 2 - 1) * zone.rx;
      positions[index * 3 + 1] = zone.y + hash2(seed, 2, 0xe6b2) * zone.height * 0.18;
      positions[index * 3 + 2] = zone.z + (hash2(seed, 3, 0xe6b3) * 2 - 1) * zone.rz;
      phases[index] = hash2(seed, 4, 0xe6b4);
      speeds[index] = 0.045 + hash2(seed, 5, 0xe6b5) * 0.08;
      heights[index] = zone.height;
      sizes[index] = 2.4 + hash2(seed, 6, 0xe6b6) * 4.6;
      heats[index] = hash2(seed, 7, 0xe6b7);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geometry.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aHeat', new THREE.BufferAttribute(heats, 1));
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 16;

  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aHeight;
      attribute float aSize;
      attribute float aHeat;
      varying float vLife;
      varying float vHeat;
      void main() {
        float life = fract(aPhase + uTime * aSpeed);
        vec3 p = position;
        p.y += life * aHeight;
        p.x += sin(aPhase * 31.0 + uTime * 1.7) * 0.32;
        p.z += cos(aPhase * 23.0 + uTime * 1.3) * 0.26;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(aSize * (85.0 / max(10.0, -mvPosition.z)), 1.0, 8.0);
        vLife = sin(life * 3.14159265);
        vHeat = aHeat;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vLife;
      varying float vHeat;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float alpha = smoothstep(0.5, 0.08, d) * vLife;
        vec3 color = mix(vec3(1.4, 0.08, 0.005), vec3(3.0, 0.75, 0.06), vHeat);
        gl_FragColor = vec4(color, alpha * 0.86);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'infernal-abyss-ember-motes';
  points.renderOrder = 4;
  group.add(points);
  return count;
}

/**
 * Adds the cavern vault, landmark lavafalls, Maw depth, and high-tier embers.
 * The return value is diagnostic only and lets callers account for the fixed
 * render budget without reaching into the group hierarchy.
 */
export function placeInfernalAbyssAtmosphere(
  group: THREE.Group,
  layout: DungeonLayout,
  lowGfx: boolean,
): InfernalAbyssAtmosphereStats {
  const atmosphere = new THREE.Group();
  atmosphere.name = 'infernal-abyss-atmosphere';
  group.add(atmosphere);

  const basalt = basaltMaterial(lowGfx);
  const coneGeometry = new THREE.ConeGeometry(1, 1, 5, 1);
  const molten = flowMaterial();
  const fallGeometry = new THREE.PlaneGeometry(1, 1, lowGfx ? 2 : 6, lowGfx ? 8 : 18);

  placeCeiling(atmosphere, layout, lowGfx);
  const stalactites = placeCaveSilhouette(atmosphere, layout, lowGfx, coneGeometry, basalt);
  const lavafalls = placeLavafalls(atmosphere, lowGfx, fallGeometry, molten);
  const chasmCrags = placeMawDepth(atmosphere, lowGfx, coneGeometry, basalt, molten);
  const emberMotes = lowGfx ? 0 : placeEmbers(atmosphere);

  return {
    // Vault, crown, stalactites, falls, river, cliff faces, depth crags, and
    // optionally the single ember cloud. Every repeated family is instanced.
    drawCalls: lowGfx ? 7 : 8,
    lavafalls,
    stalactites,
    chasmCrags,
    emberMotes,
  };
}
