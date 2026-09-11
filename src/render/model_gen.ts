// Custom built-model mesh builder for the editor's Build tool (placement path
// 'procedural://model'). A built model is a set of hand-modeled volumes
// (src/editor/cm_mesh.ts CmMesh, stored inline on the placement as `meshes`);
// this module fuses them into ONE flat-shaded solid with a tiled object
// material from the texture library (render/model_materials.ts), so caves,
// interiors, stairs and world additions carry real stone / metal / wood looks.
//
// The material is TRIPLANAR IN THE SHADER: every fragment samples the colour,
// normal, roughness and AO maps through three world-axis projections and
// blends them by the face normal, at a physical yards-per-repeat tile. A
// texture therefore reads correctly on any face at any angle, a stair flight,
// a cylinder, a wedge, with no seams where a face's dominant axis flips and
// no unwrapping by the maker. World-space projection also means two butted
// models continue one another's pattern. (The geometry still carries a
// per-face planar UV for anything that wants a plain map, e.g. picking
// overlays.)
//
// Per-object ADJUSTMENTS ride the same shader: hue rotation, saturation and
// light (darken / lighten) are applied to the sampled albedo, so one library
// material yields any coloured object (a green-bronze rail, a black-iron gate,
// a pale sandstone wall) without another texture download.

import * as THREE from 'three';
import { DEFAULT_MODEL_TEX_TILE } from '../sim/map_doc';
import { acquireTexture } from './assets/loader';
import { modelMaterialShading } from './model_materials';
import { terrainTexturePath, terrainTextureSet } from './terrain_texture_sets';

export interface ModelMeshInput {
  verts: number[];
  tris: number[];
  ramp?: boolean;
}

export interface ModelParams {
  meshes: readonly ModelMeshInput[];
  /** Built-in texture set key (render/terrain_texture_sets.ts). */
  modelTexId?: string;
  /** Yards per texture repeat (default DEFAULT_MODEL_TEX_TILE). */
  modelTexTile?: number;
  /** Hue rotation, degrees (-180..180). */
  modelHue?: number;
  /** Saturation multiplier (0..2; 1 = as shot). */
  modelSat?: number;
  /** Light: -1 darkest .. 1 lightest (0 = as shot). */
  modelLight?: number;
}

// Neutral warm-stone default so an untextured, untinted model still reads as a
// solid surface (a placement `tint` multiplies this).
const DEFAULT_COLOR = 0xb8b2a6;

/** The shader's adjustment uniforms, held on the material so the compiled
 *  program can be shared between materials that differ only by value. */
interface TintUniforms {
  uTile: THREE.IUniform<number>;
  uHue: THREE.IUniform<number>;
  uSat: THREE.IUniform<number>;
  uLight: THREE.IUniform<number>;
}

const TRIPLANAR_PARS_VERT = /* glsl */ `
varying vec3 vTriPos;
varying vec3 vTriNrm;
`;

// Appended to worldpos_vertex (always included by the standard vertex shader,
// even when its own body is compiled out): world position + world normal for
// the projections. `transformed` / `objectNormal` are the chunk-pipeline names.
const TRIPLANAR_VERT = /* glsl */ `
#include <worldpos_vertex>
vTriPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vTriNrm = normalize( mat3( modelMatrix ) * objectNormal );
`;

const TRIPLANAR_PARS_FRAG = /* glsl */ `
varying vec3 vTriPos;
varying vec3 vTriNrm;
uniform float uTile;
uniform float uHue;
uniform float uSat;
uniform float uLight;
// Blend weights: the face normal, sharpened so a face that mostly looks along
// one axis takes almost all of that projection (soft only across true edges).
vec3 wocTriWeights() {
  vec3 w = abs( vTriNrm );
  w = pow( w, vec3( 6.0 ) );
  return w / max( w.x + w.y + w.z, 1e-5 );
}
vec4 wocTriSample( sampler2D tex, vec3 w ) {
  vec2 uvX = vTriPos.zy / uTile;
  vec2 uvY = vTriPos.xz / uTile;
  vec2 uvZ = vTriPos.xy / uTile;
  return texture2D( tex, uvX ) * w.x + texture2D( tex, uvY ) * w.y + texture2D( tex, uvZ ) * w.z;
}
// Hue rotates about the grey axis (Rodrigues in linear RGB), saturation
// scales chroma about luminance, light lifts toward white or scales down.
vec3 wocAdjust( vec3 c ) {
  float cA = cos( uHue );
  float sA = sin( uHue );
  vec3 k = vec3( 0.57735027 );
  c = c * cA + cross( k, c ) * sA + k * dot( k, c ) * ( 1.0 - cA );
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = mix( vec3( l ), c, uSat );
  c = uLight >= 0.0 ? mix( c, vec3( 1.0 ), uLight * 0.85 ) : c * ( 1.0 + uLight * 0.9 );
  return max( c, vec3( 0.0 ) );
}
`;

const TRIPLANAR_MAP_FRAG = /* glsl */ `
vec3 wocW = wocTriWeights();
#ifdef USE_MAP
diffuseColor *= wocTriSample( map, wocW );
#endif
diffuseColor.rgb = wocAdjust( diffuseColor.rgb );
`;

const TRIPLANAR_ROUGH_FRAG = /* glsl */ `
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
roughnessFactor *= wocTriSample( roughnessMap, wocW ).g;
#endif
`;

// Three's own aomap_fragment, sampling through the projections.
const TRIPLANAR_AO_FRAG = /* glsl */ `
#ifdef USE_AOMAP
float ambientOcclusion = ( wocTriSample( aoMap, wocW ).r - 1.0 ) * aoMapIntensity + 1.0;
reflectedLight.indirectDiffuse *= ambientOcclusion;
#if defined( USE_CLEARCOAT )
clearcoatSpecularIndirect *= ambientOcclusion;
#endif
#if defined( USE_SHEEN )
sheenSpecularIndirect *= ambientOcclusion;
#endif
#if defined( USE_ENVMAP ) && defined( STANDARD )
float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
#endif
#endif
`;

// Tangent-space normal maps blended per projection (UDN style: each
// projection's xy perturbs the two world axes it spans), then taken back to
// view space, which is where the lighting chunks expect `normal`.
const TRIPLANAR_NORMAL_FRAG = /* glsl */ `
#ifdef USE_NORMALMAP
{
  vec3 w = wocW;
  vec2 uvX = vTriPos.zy / uTile;
  vec2 uvY = vTriPos.xz / uTile;
  vec2 uvZ = vTriPos.xy / uTile;
  vec3 tnX = texture2D( normalMap, uvX ).xyz * 2.0 - 1.0;
  vec3 tnY = texture2D( normalMap, uvY ).xyz * 2.0 - 1.0;
  vec3 tnZ = texture2D( normalMap, uvZ ).xyz * 2.0 - 1.0;
  vec3 wn = vTriNrm;
  vec3 sgn = sign( wn + vec3( 1e-6 ) );
  vec3 pX = vec3( 0.0, tnX.y, tnX.x * sgn.x );
  vec3 pY = vec3( tnY.x, 0.0, tnY.y * sgn.y );
  vec3 pZ = vec3( tnZ.x * sgn.z, tnZ.y, 0.0 );
  vec3 perturbed = normalize( wn + ( pX * w.x + pY * w.y + pZ * w.z ) * normalScale.x );
  normal = normalize( ( viewMatrix * vec4( perturbed, 0.0 ) ).xyz );
}
#endif
`;

function installTriplanar(mat: THREE.MeshStandardMaterial, uniforms: TintUniforms): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTile = uniforms.uTile;
    shader.uniforms.uHue = uniforms.uHue;
    shader.uniforms.uSat = uniforms.uSat;
    shader.uniforms.uLight = uniforms.uLight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TRIPLANAR_PARS_VERT}`)
      .replace('#include <worldpos_vertex>', TRIPLANAR_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TRIPLANAR_PARS_FRAG}`)
      .replace('#include <map_fragment>', TRIPLANAR_MAP_FRAG)
      .replace('#include <roughnessmap_fragment>', TRIPLANAR_ROUGH_FRAG)
      .replace('#include <normal_fragment_maps>', TRIPLANAR_NORMAL_FRAG)
      .replace('#include <aomap_fragment>', TRIPLANAR_AO_FRAG);
  };
  // One program per define-set: the adjustments are uniforms, never defines.
  mat.customProgramCacheKey = () => 'woc-model-triplanar';
}

// Shared materials per (texture set, tile, hue, sat, light). Bounded in
// practice by the handful of looks a map uses (5,600 stair blocks are ONE
// material); a placement `tint`/opacity still clones per entry in the
// placed-assets pipeline.
const modelMats = new Map<string, THREE.MeshStandardMaterial>();

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** The look a model's params resolve to (undefined fields = as shot). */
export function modelLook(params: {
  modelTexId?: string;
  modelTexTile?: number;
  modelHue?: number;
  modelSat?: number;
  modelLight?: number;
}): { texId: string | undefined; tile: number; hue: number; sat: number; light: number } {
  const set = params.modelTexId ? terrainTextureSet(params.modelTexId) : null;
  return {
    texId: set ? set.key : undefined,
    tile: Math.max(0.5, params.modelTexTile ?? DEFAULT_MODEL_TEX_TILE),
    hue: round2(Math.max(-180, Math.min(180, params.modelHue ?? 0))),
    sat: round2(Math.max(0, Math.min(2, params.modelSat ?? 1))),
    light: round2(Math.max(-1, Math.min(1, params.modelLight ?? 0))),
  };
}

function modelMaterial(params: ModelParams): THREE.MeshStandardMaterial {
  const look = modelLook(params);
  const key = `${look.texId ?? 'bare'}|${look.tile}|${look.hue}|${look.sat}|${look.light}`;
  const cached = modelMats.get(key);
  if (cached) return cached;
  const shading = modelMaterialShading(look.texId);
  // DoubleSide: built models are architectural (cave interiors, rooms), the
  // maker stands INSIDE them and must see the inner walls; it also makes the
  // render winding-agnostic (the CM primitives are inward-wound).
  const mat = new THREE.MeshStandardMaterial({
    color: look.texId ? 0xffffff : DEFAULT_COLOR,
    roughness: look.texId ? shading.roughness : 0.92,
    metalness: look.texId ? shading.metalness : 0,
    side: THREE.DoubleSide,
  });
  const uniforms: TintUniforms = {
    uTile: { value: look.tile },
    uHue: { value: (look.hue * Math.PI) / 180 },
    uSat: { value: look.sat },
    uLight: { value: look.light },
  };
  installTriplanar(mat, uniforms);
  if (look.texId) {
    const set = terrainTextureSet(look.texId);
    // Maps stream in and upgrade the material in place (the rock/cave pattern).
    const assign = (
      slot: 'map' | 'normalMap' | 'roughnessMap' | 'aoMap',
      kind: 'color' | 'normal' | 'rough' | 'ao',
      srgb: boolean,
    ): void => {
      const path = set ? terrainTexturePath(set.key, kind) : null;
      if (!path) return;
      const { texture } = acquireTexture(`/${path}`, { srgb, repeat: true });
      void texture
        .then((t) => {
          mat[slot] = t;
          mat.needsUpdate = true;
        })
        .catch(() => {});
    };
    assign('map', 'color', true);
    assign('normalMap', 'normal', false);
    assign('roughnessMap', 'rough', false);
    assign('aoMap', 'ao', false);
  }
  modelMats.set(key, mat);
  return mat;
}

/**
 * Build the solid mesh for a built model's volume set. The geometry is
 * NON-INDEXED (each triangle owns its verts) so faces stay crisp/flat, the
 * right look for architectural boxes, ramps, and blocky cave walls. Ramp
 * volumes render as ordinary solid geometry; their walkability is a collision
 * concern handled at Lock In, not here.
 */
export function buildModelMesh(params: ModelParams): THREE.Mesh {
  const tile = Math.max(0.5, params.modelTexTile ?? DEFAULT_MODEL_TEX_TILE);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const ux = new THREE.Vector3();
  const vx = new THREE.Vector3();
  const nx = new THREE.Vector3();
  for (const m of params.meshes) {
    if (!Array.isArray(m.verts) || !Array.isArray(m.tris)) continue;
    for (let t = 0; t + 2 < m.tris.length; t += 3) {
      const ia = m.tris[t] * 3;
      const ib = m.tris[t + 1] * 3;
      const ic = m.tris[t + 2] * 3;
      const ax = m.verts[ia];
      const ay = m.verts[ia + 1];
      const az = m.verts[ia + 2];
      const bx = m.verts[ib];
      const by = m.verts[ib + 1];
      const bz = m.verts[ib + 2];
      const cx = m.verts[ic];
      const cy = m.verts[ic + 1];
      const cz = m.verts[ic + 2];
      // Flat normal from the triangle's edges.
      ux.set(bx - ax, by - ay, bz - az);
      vx.set(cx - ax, cy - ay, cz - az);
      nx.crossVectors(ux, vx);
      if (nx.lengthSq() < 1e-12) continue; // degenerate triangle
      nx.normalize();
      const anx = Math.abs(nx.x);
      const any = Math.abs(nx.y);
      const anz = Math.abs(nx.z);
      // Per-face planar UV (the shader projects for itself; this serves
      // anything reading the plain uv attribute).
      const uvOf = (x: number, y: number, z: number): [number, number] => {
        if (any >= anx && any >= anz) return [x / tile, z / tile]; // floor/ceiling
        if (anx >= anz) return [z / tile, y / tile]; // wall facing X
        return [x / tile, y / tile]; // wall facing Z
      };
      const push = (x: number, y: number, z: number): void => {
        positions.push(x, y, z);
        normals.push(nx.x, nx.y, nx.z);
        const [u, v] = uvOf(x, y, z);
        uvs.push(u, v);
      };
      push(ax, ay, az);
      push(bx, by, bz);
      push(cx, cy, cz);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, modelMaterial(params));
  mesh.name = 'built-model';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
