import * as THREE from 'three';
import { waterBodies, waterLevel } from '../sim/world';
import { loadTexture } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX, SUN_DIR, sharedUniforms } from './gfx';
import { waterNormalish, waterNormalMaps } from './textures';
import {
  shoreDepthAt,
  waterBodyVisible,
  waterCellIntersectsDisc,
  waterGridPlan,
} from './water_core';
import { WaterSimulation, type WaterWaveUniforms } from './water_simulation';

const MIN_SEGMENTS = 8;
const WATER_CULL_MARGIN = 12;

interface WaterTierPlan {
  vertexSpacing: number;
  maxSegments: number;
}

function shaderTierPlan(): WaterTierPlan {
  if (GFX.tier === 'ultra') return { vertexSpacing: 2.3, maxSegments: 80 };
  if (GFX.tier === 'high') return { vertexSpacing: 2.6, maxSegments: 64 };
  return { vertexSpacing: 3.25, maxSegments: 48 };
}

// The persistent height field supplies broad and medium-scale detail, so one
// 512px micro normal is enough for the fine surface. The previous three-map
// path decoded about 6 MiB of normals before the wave simulation existed.
const WATER_TEX: Record<string, THREE.Texture> = {};
if (GFX.standardMaterials) {
  registerPreload(
    loadTexture('/textures/water/water_2_normal.jpg', { repeat: true }).then((tex) => {
      tex.anisotropy = 4;
      WATER_TEX.micro = tex;
      return tex;
    }),
  );
}

export function hasWaterShaderAssets(): boolean {
  return Boolean(WATER_TEX.micro);
}

const DEEP_COLOR = new THREE.Color(0x0d3a52);
const SHALLOW_COLOR = new THREE.Color(0x2d8077);
const SKY_TINT = new THREE.Color(0x7fb2e0);
const SUN_COLOR = new THREE.Color(0xfff0d4);

export interface WaterView {
  meshes: THREE.Mesh[];
  /** Advances wave simulation and fog-culls whole water bodies. */
  update(time: number, cameraX: number, cameraZ: number, visibleRange: number): number;
  /** Adds a local entry, landing, fish, or bobber disturbance. */
  addSplash(x: number, z: number, radius: number, strength?: number): void;
  /** Presses a facing-aligned body footprint into the surface. */
  enterContact(
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength?: number,
  ): void;
  /** Moves submerged volume from the previous footprint to the current one. */
  moveContact(
    oldX: number,
    oldZ: number,
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength?: number,
  ): void;
  /** Refills the final submerged footprint when a contact exits. */
  releaseContact(
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength?: number,
  ): void;
  /** Re-seats editor water and rebakes per-vertex shore depth in place. */
  setLevel(): void;
  /** Releases view-owned geometry, materials, and simulation targets. */
  dispose(): void;
}

const WATER_VERT = /* glsl */ `
  attribute float aShoreDepth;
  uniform float uTime;
  uniform sampler2D uWaveState;
  uniform float uWaveEnabled;
  uniform vec2 uCenter;
  uniform float uRadius;
  varying vec3 vWPos;
  varying float vShoreDepth;
  #include <fog_pars_vertex>

  void main() {
    vec3 pos = position;
    float swell =
      sin(uTime * 0.82 + pos.x * 0.17 + pos.z * 0.09) * 0.035 +
      sin(uTime * 0.57 + pos.z * 0.14 - pos.x * 0.06) * 0.025;
    float interactionHeight = 0.0;
    if (uWaveEnabled > 0.001) {
      vec2 waveUv = clamp((pos.xz - uCenter) / (uRadius * 2.0) + 0.5, 0.0, 1.0);
      interactionHeight = texture2D(uWaveState, waveUv).r * uWaveEnabled;
    }
    pos.y += swell + interactionHeight;
    vShoreDepth = aShoreDepth;
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWPos = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform sampler2D uMicroNormal;
  uniform sampler2D uWaveState;
  uniform float uWaveEnabled;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform float uTime;
  uniform vec2 uCenter;
  uniform float uRadius;
  varying vec3 vWPos;
  varying float vShoreDepth;
  #include <common>
  #include <fog_pars_fragment>

  void main() {
    vec2 edgeDelta = vWPos.xz - uCenter;
    if (dot(edgeDelta, edgeDelta) > uRadius * uRadius) discard;

    vec3 toCamera = cameraPosition - vWPos;
    float camDistSq = dot(toCamera, toCamera);
    vec3 detail = texture2D(
      uMicroNormal,
      vWPos.xz * 0.092 + uTime * vec2(0.016, 0.011)
    ).xyz * 2.0 - 1.0;
    vec2 waveSlope = vec2(0.0);
    float waveEnergy = 0.0;
    if (uWaveEnabled > 0.001) {
      vec2 waveUv = clamp(edgeDelta / (uRadius * 2.0) + 0.5, 0.0, 1.0);
      vec4 wave = texture2D(uWaveState, waveUv);
      waveSlope = wave.ba * uWaveEnabled;
      waveEnergy = (abs(wave.g) * 0.9 + length(wave.ba) * 0.4) * uWaveEnabled;
    }
    float detailFade = 1.0 / (1.0 + camDistSq * 0.0007);
    vec2 normalXY = detail.xy * mix(0.68, 1.15, detailFade) + waveSlope * 9.5;
    vec3 N = normalize(vec3(normalXY.x, 3.1, normalXY.y));
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(toCamera);
    float facing = 1.0 - max(dot(N, V), 0.0);
    float facing2 = facing * facing;
    float fresnel = 0.05 + 0.95 * facing2 * facing2;
    float depth = clamp(vShoreDepth / 6.0, 0.0, 1.0);
    vec3 col = mix(uShallow, uDeep, depth);

    float shimmerFade = 1.0 / (1.0 + camDistSq * 0.0011);
    float shimmer = max(detail.x * 0.75 + detail.y * 0.35, 0.0) * shimmerFade;
    col *= 0.92 + 0.3 * shimmer;
    vec3 skyRef = mix(uSkyColor, fogColor, 0.5);
    col = mix(col, skyRef, min(fresnel * 0.65, 0.42));

    float sunAlign = max(dot(reflect(-uSunDir, N), V), 0.0);
    float spec2 = sunAlign * sunAlign;
    float spec4 = spec2 * spec2;
    float spec8 = spec4 * spec4;
    float spec16 = spec8 * spec8;
    float spec32 = spec16 * spec16;
    float spec64 = spec32 * spec32;
    float spec128 = spec64 * spec64;
    col += uSunColor * (spec128 * 2.6 + spec32 * 0.3 + spec8 * 0.05);

    float foamBand = 1.0 - smoothstep(0.1, 3.2, vShoreDepth + detail.x * 0.7);
    foamBand *= foamBand;
    float foamWave = 0.62 + 0.38 * sin(
      uTime * 1.7 + vWPos.x * 1.2 + vWPos.z * 0.95 + detail.y * 6.0
    );
    float shoreFoam = foamBand * foamWave;
    float contactSheen = smoothstep(0.025, 0.13, waveEnergy) * shimmerFade;
    vec3 contactTint = mix(uShallow, uSkyColor, 0.52);
    col = mix(col, contactTint, contactSheen * 0.24);
    float shoreMix = clamp(shoreFoam, 0.0, 0.9);
    col = mix(col, vec3(1.05), shoreMix);
    float surfaceAccent = clamp(shoreFoam + contactSheen * 0.12, 0.0, 0.92);
    float alpha = max(mix(0.84, 0.96, depth), surfaceAccent * 0.95);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function pruneDiscGrid(geometry: THREE.PlaneGeometry, radius: number, segments: number): void {
  const source = geometry.getIndex();
  if (!source) return;
  const next: number[] = [];
  const step = (radius * 2) / segments;
  for (let row = 0; row < segments; row++) {
    const z0 = -radius + row * step;
    const z1 = z0 + step;
    for (let col = 0; col < segments; col++) {
      const x0 = -radius + col * step;
      const x1 = x0 + step;
      if (!waterCellIntersectsDisc(x0, z0, x1, z1, radius)) continue;
      const offset = (row * segments + col) * 6;
      for (let i = 0; i < 6; i++) next.push(source.getX(offset + i));
    }
  }
  geometry.setIndex(next);
}

function disposeOwned(meshes: THREE.Mesh[]): void {
  const materials = new Set<THREE.Material>();
  for (const mesh of meshes) {
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const entry of material) materials.add(entry);
    else materials.add(material);
  }
  for (const material of materials) material.dispose();
}

function zeroWaveUniforms(): WaterWaveUniforms {
  const texture = WATER_TEX.micro;
  return {
    uWaveState: { value: texture },
    uWaveEnabled: { value: 0 },
  };
}

function buildShaderWater(seed: number, renderer?: THREE.WebGLRenderer): WaterView {
  // Preserve the procedural texture LCG call order for later world textures.
  waterNormalMaps();
  const plan = shaderTierPlan();
  const bodies = waterBodies();
  const simulation = renderer ? new WaterSimulation(renderer, bodies) : null;
  const waveUniforms = bodies.map((_, index) =>
    simulation ? simulation.uniforms(index) : zeroWaveUniforms(),
  );

  const makeMaterial = (
    center: THREE.Vector2,
    radius: number,
    wave: WaterWaveUniforms,
  ): THREE.ShaderMaterial => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uMicroNormal: { value: WATER_TEX.micro },
        uWaveState: wave.uWaveState,
        uWaveEnabled: wave.uWaveEnabled,
        uSunDir: { value: SUN_DIR.clone() },
        uSunColor: { value: SUN_COLOR },
        uSkyColor: { value: SKY_TINT },
        uDeep: { value: DEEP_COLOR },
        uShallow: { value: SHALLOW_COLOR },
        uTime: sharedUniforms.uTime,
        uCenter: { value: center },
        uRadius: { value: radius },
      },
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    material.forceSinglePass = true;
    return material;
  };

  const fillShoreDepth = (geometry: THREE.BufferGeometry): void => {
    const position = geometry.attributes.position as THREE.BufferAttribute;
    let attribute = geometry.attributes.aShoreDepth as THREE.BufferAttribute | undefined;
    if (!attribute) {
      attribute = new THREE.BufferAttribute(new Float32Array(position.count), 1);
      geometry.setAttribute('aShoreDepth', attribute);
    }
    const depths = attribute.array as Float32Array;
    for (let i = 0; i < position.count; i++) {
      depths[i] = shoreDepthAt(position.getX(i), position.getZ(i), seed);
    }
    attribute.needsUpdate = true;
  };

  const meshes: THREE.Mesh[] = [];
  for (let bodyIndex = 0; bodyIndex < bodies.length; bodyIndex++) {
    const lake = bodies[bodyIndex];
    const grid = waterGridPlan(lake.radius, plan.vertexSpacing, MIN_SEGMENTS, plan.maxSegments);
    const geometry = new THREE.PlaneGeometry(grid.size, grid.size, grid.segments, grid.segments);
    pruneDiscGrid(geometry, lake.radius, grid.segments);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(lake.x, 0, lake.z);
    fillShoreDepth(geometry);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(
      geometry,
      makeMaterial(new THREE.Vector2(lake.x, lake.z), lake.radius, waveUniforms[bodyIndex]),
    );
    mesh.position.y = waterLevel();
    meshes.push(mesh);
  }

  const visibleBodies = bodies.map(() => true);
  return {
    meshes,
    update(time: number, cameraX: number, cameraZ: number, visibleRange: number): number {
      for (let i = 0; i < meshes.length; i++) {
        const lake = bodies[i];
        const visible = waterBodyVisible(
          cameraX,
          cameraZ,
          lake.x,
          lake.z,
          lake.radius,
          visibleRange + WATER_CULL_MARGIN,
        );
        visibleBodies[i] = visible;
        meshes[i].visible = visible;
      }
      return simulation?.update(time, visibleBodies) ?? 0;
    },
    addSplash(x: number, z: number, radius: number, strength = 1): void {
      simulation?.addSplash(x, z, radius, strength);
    },
    enterContact(
      x: number,
      z: number,
      radius: number,
      halfLength: number,
      axisX: number,
      axisZ: number,
      strength = 1,
    ): void {
      simulation?.enterContact(x, z, radius, halfLength, axisX, axisZ, strength);
    },
    moveContact(
      oldX: number,
      oldZ: number,
      x: number,
      z: number,
      radius: number,
      halfLength: number,
      axisX: number,
      axisZ: number,
      strength = 1,
    ): void {
      simulation?.moveContact(oldX, oldZ, x, z, radius, halfLength, axisX, axisZ, strength);
    },
    releaseContact(
      x: number,
      z: number,
      radius: number,
      halfLength: number,
      axisX: number,
      axisZ: number,
      strength = 1,
    ): void {
      simulation?.releaseContact(x, z, radius, halfLength, axisX, axisZ, strength);
    },
    setLevel(): void {
      const y = waterLevel();
      simulation?.reset();
      for (const mesh of meshes) {
        mesh.position.y = y;
        fillShoreDepth(mesh.geometry);
      }
    },
    dispose(): void {
      simulation?.dispose();
      disposeOwned(meshes);
    },
  };
}

function buildPhongWater(): WaterView {
  const texture = waterNormalish();
  texture.repeat.set(30, 30);
  const [normal] = waterNormalMaps();
  normal.repeat.set(26, 78);
  const material = new THREE.MeshPhongMaterial({
    color: 0x2a6a96,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
    shininess: 140,
    specular: 0xd8ecff,
    map: texture,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.8, 0.8),
  });
  material.forceSinglePass = true;
  const bodies = waterBodies();
  const meshes = bodies.map((lake) => {
    const segments = Math.min(80, Math.max(24, Math.ceil((Math.PI * lake.radius * 2) / 4)));
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(lake.radius, segments).rotateX(-Math.PI / 2),
      material,
    );
    mesh.position.set(lake.x, waterLevel(), lake.z);
    return mesh;
  });
  return {
    meshes,
    update(time: number, cameraX: number, cameraZ: number, visibleRange: number): number {
      texture.offset.x = time * 0.008;
      texture.offset.y = time * 0.011;
      normal.offset.x = time * 0.006;
      normal.offset.y = time * 0.009;
      for (let i = 0; i < meshes.length; i++) {
        const lake = bodies[i];
        meshes[i].visible = waterBodyVisible(
          cameraX,
          cameraZ,
          lake.x,
          lake.z,
          lake.radius,
          visibleRange + WATER_CULL_MARGIN,
        );
      }
      return 0;
    },
    addSplash: () => {},
    enterContact: () => {},
    moveContact: () => {},
    releaseContact: () => {},
    setLevel(): void {
      const y = waterLevel();
      for (const mesh of meshes) mesh.position.y = y;
    },
    dispose(): void {
      disposeOwned(meshes);
    },
  };
}

export function buildWater(seed: number, renderer?: THREE.WebGLRenderer): WaterView {
  return GFX.standardMaterials && hasWaterShaderAssets()
    ? buildShaderWater(seed, renderer)
    : buildPhongWater();
}
