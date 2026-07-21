import * as THREE from 'three';
import { waterBodies, waterLevel } from '../sim/world';
import { loadTexture } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX, SUN_DIR, sharedUniforms } from './gfx';
import { waterNormalish, waterNormalMaps } from './textures';
import { shoreDepthAt } from './water_core';

// Water only where a declared lake actually is: one plane per lake footprint
// (`waterBodies()`, `src/sim/world.ts`), not one plane spanning an entire
// zone's width. A zone with no lakes gets no water mesh at all, so any
// terrain that happens to dip below waterLevel() elsewhere (a crater, a
// sunken tunnel) never reads as flooded.
//
// High tier: one ShaderMaterial plane per lake (so off-screen lakes frustum
// cull away) with a CPU-precomputed per-vertex shore depth. Dual scrolling
// real normal maps (three.js r165 water set, MIT) + a broad ocean-swell map
// at range, fresnel sky tint, HDR sun glints (>1 so bloom catches them), a
// shoreline foam band and a subtle wave displacement.
//
// Low tier keeps the legacy scrolling Phong plane, one per lake, upgraded with
// the real swell normal map for textured speculars.

const VERTEX_SPACING = 2; // yards/segment, matches the old whole-zone density
const MIN_SEGMENTS = 8;

// Real water normal maps, fetched at module import and gated by the boot
// preload only for the shader tier. Low/mobile uses generated canvas water
// so it does not pay network/decode/upload cost for water detail.
const WATER_TEX: Record<string, THREE.Texture> = {};
function kickWaterTex(key: string, file: string): void {
  registerPreload(
    loadTexture(`/textures/water/${file}`, { repeat: true }).then((tex) => {
      tex.anisotropy = 4;
      WATER_TEX[key] = tex;
      return tex;
    }),
  );
}
if (GFX.standardMaterials) {
  kickWaterTex('n1', 'water_1_normal.jpg');
  kickWaterTex('n2', 'water_2_normal.jpg');
  kickWaterTex('broad', 'waternormals.jpg');
}

export function hasWaterShaderAssets(): boolean {
  return Boolean(WATER_TEX.n1 && WATER_TEX.n2 && WATER_TEX.broad);
}

const DEEP_COLOR = new THREE.Color(0x0d3a52);
const SHALLOW_COLOR = new THREE.Color(0x2d8077);
const SKY_TINT = new THREE.Color(0x7fb2e0); // matches the sky horizon band
const SUN_COLOR = new THREE.Color(0xfff0d4);

export interface WaterView {
  meshes: THREE.Mesh[];
  /** advances the legacy texture scroll (low tier); high tier uses uTime */
  update(time: number): void;
  /**
   * Editor-only: re-seat the surface at the ACTIVE waterLevel() and recompute
   * the per-vertex shore depth from the CURRENT terrainHeight (after a
   * water-level change or a sculpt near the shoreline). Updates the existing
   * geometry in place (no geometry is replaced, so nothing leaks); the low
   * Phong tier has no shore attribute and only repositions its one plane.
   */
  setLevel(): void;
}

const WATER_VERT = /* glsl */ `
  attribute float aShoreDepth;
  uniform float uTime;
  varying vec3 vWPos;
  varying float vShoreDepth;
  #include <fog_pars_vertex>
  void main() {
    vec3 pos = position;
    pos.y += (sin(uTime * 1.1 + pos.x * 0.35) + sin(uTime * 0.7 + pos.z * 0.28)) * 0.05;
    vShoreDepth = aShoreDepth;
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWPos = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform sampler2D uNorm1;
  uniform sampler2D uNorm2;
  uniform sampler2D uNorm3;
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
    // the plane is a square footprint around a circular lake: drop the
    // corner fragments outside the declared radius so they never read as
    // flooded ground.
    if (length(vWPos.xz - uCenter) > uRadius) discard;
    float camDist = length(cameraPosition - vWPos);
    // dual-scroll detail ripples (real three.js water normal maps)
    vec3 n1 = texture2D(uNorm1, vWPos.xz * 0.055 + uTime * vec2(0.013, 0.019)).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(uNorm2, vWPos.xz * 0.115 - uTime * vec2(0.021, 0.011)).xyz * 2.0 - 1.0;
    // broad slow ocean swell that survives at range, where the detail maps
    // average out to a mirror — keeps big water surfaces alive from above
    vec3 n3 = texture2D(uNorm3, vWPos.xz * 0.016 + uTime * vec2(0.005, -0.004)).xyz * 2.0 - 1.0;
    float farW = smoothstep(24.0, 140.0, camDist);
    // rippled up close -> glassy at distance: detail fades out, swell stays
    vec2 nm = mix(n1.xy * 0.85 + n2.xy * 0.6, n3.xy * 1.5, farW * 0.78);
    vec3 N = normalize(vec3(nm, 3.1).xzy);
    vec3 V = normalize(cameraPosition - vWPos);
    float fresnel = 0.05 + 0.95 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
    float depth = clamp(vShoreDepth / 6.0, 0.0, 1.0);
    vec3 col = mix(uShallow, uDeep, depth);
    // dappled shimmer — fades with distance so it never reads as speckle
    float shimmer = max(n1.x * 0.7 + n2.y * 0.55, 0.0) * exp(-camDist * 0.022);
    col *= 0.92 + 0.4 * shimmer;
    // reflection tracks the live fog/horizon color so each biome's water
    // belongs to its sky instead of a constant pasted-on tint
    vec3 skyRef = mix(uSkyColor, fogColor, 0.5);
    col = mix(col, skyRef, min(fresnel * 0.65, 0.42));
    float sunAlign = max(dot(reflect(-uSunDir, N), V), 0.0);
    col += uSunColor * pow(sunAlign, 130.0) * 2.6;                   // sparkle glints (>1 -> bloom)
    col += uSunColor * pow(sunAlign, 28.0) * 0.30;                   // wider lobe: survives steep cameras
    col += uSunColor * pow(sunAlign, 6.0) * 0.05;                    // faint warm sheen sunward
    // shoreline foam: wide animated band hugging the waterline (the shore
    // attribute is per-vertex at ~2u, so the band must span several units)
    float foamBand = smoothstep(3.2, 0.1, vShoreDepth + n1.x * 0.7);
    foamBand *= foamBand;
    float foamWave = 0.62 + 0.38 * sin(uTime * 1.7 + vWPos.x * 1.2 + vWPos.z * 0.95 + n2.y * 6.0);
    float foam = foamBand * foamWave;
    col = mix(col, vec3(1.05), clamp(foam, 0.0, 0.9));
    float alpha = max(mix(0.84, 0.96, depth), foam * 0.95);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function buildShaderWater(seed: number): WaterView {
  // legacy procedural maps still get generated (unused) to preserve the
  // shared-LCG call order in textures.ts for everything generated after
  waterNormalMaps();
  // Each lake gets its own material instance (its uCenter/uRadius differ);
  // uTime/uSunDir/textures are shared by reference so a single sync() still
  // drives every lake.
  const makeMaterial = (center: THREE.Vector2, radius: number): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uNorm1: { value: WATER_TEX.n1 },
        uNorm2: { value: WATER_TEX.n2 },
        uNorm3: { value: WATER_TEX.broad },
        uSunDir: { value: SUN_DIR.clone() }, // the one shared sun (gfx.ts)
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
      transparent: true,
      depthWrite: false,
      fog: true,
    });

  // (Re)fill the per-vertex shore depth from the CURRENT terrain + water level,
  // writing into the existing attribute in place (build and setLevel share it).
  const fillShoreDepth = (geo: THREE.BufferGeometry): void => {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    let attr = geo.attributes.aShoreDepth as THREE.BufferAttribute | undefined;
    if (!attr) {
      attr = new THREE.BufferAttribute(new Float32Array(pos.count), 1);
      geo.setAttribute('aShoreDepth', attr);
    }
    const depths = attr.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      depths[i] = shoreDepthAt(pos.getX(i), pos.getZ(i), seed);
    }
    attr.needsUpdate = true;
  };

  const meshes: THREE.Mesh[] = [];
  for (const lake of waterBodies()) {
    const size = lake.radius * 2;
    const segments = Math.max(MIN_SEGMENTS, Math.ceil(size / VERTEX_SPACING));
    const geo = new THREE.PlaneGeometry(size, size, segments, segments).rotateX(-Math.PI / 2);
    geo.translate(lake.x, 0, lake.z);
    fillShoreDepth(geo);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const material = makeMaterial(new THREE.Vector2(lake.x, lake.z), lake.radius);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = waterLevel();
    meshes.push(mesh);
  }
  return {
    meshes,
    update: () => {},
    setLevel(): void {
      const y = waterLevel();
      for (const mesh of meshes) {
        mesh.position.y = y;
        // vertices never move (only the attribute + the mesh transform change),
        // so the baked bounding volumes stay valid.
        fillShoreDepth(mesh.geometry);
      }
    },
  };
}

function buildPhongWater(): WaterView {
  const tex = waterNormalish();
  tex.repeat.set(30, 30);
  const [norm] = waterNormalMaps();
  norm.repeat.set(26, 78);
  const mat = new THREE.MeshPhongMaterial({
    color: 0x2a6a96,
    transparent: true,
    opacity: 0.8,
    shininess: 140,
    specular: 0xd8ecff,
    map: tex,
    normalMap: norm,
    normalScale: new THREE.Vector2(0.8, 0.8),
  });
  const meshes = waterBodies().map((lake) => {
    // a disc, not a square plane: the low tier has no per-fragment shore
    // mask, so the geometry itself must not cover the corners outside the
    // declared lake radius.
    const segments = Math.max(
      MIN_SEGMENTS,
      Math.ceil((Math.PI * lake.radius * 2) / VERTEX_SPACING),
    );
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(lake.radius, segments).rotateX(-Math.PI / 2),
      mat,
    );
    mesh.position.set(lake.x, waterLevel(), lake.z);
    return mesh;
  });
  return {
    meshes,
    update(time: number): void {
      tex.offset.x = time * 0.008;
      tex.offset.y = time * 0.011;
      norm.offset.x = time * 0.006;
      norm.offset.y = time * 0.009;
    },
    setLevel(): void {
      const y = waterLevel();
      for (const mesh of meshes) mesh.position.y = y;
    },
  };
}

export function buildWater(seed: number): WaterView {
  return GFX.standardMaterials && hasWaterShaderAssets()
    ? buildShaderWater(seed)
    : buildPhongWater();
}
