import * as THREE from 'three';
import { renderLayerDisabled } from './render_dev_flags';
import {
  POINT_SIZE_RANGE_FALLBACK,
  SPRITE_QUAD_CORNERS,
  SPRITE_QUAD_INDEX,
} from './sprite_quad_core';

// The Three side of sprite_quad_core.ts: one builder that turns a particle
// cloud's shader parts and per-particle data into EITHER the historical
// THREE.Points draw (gl_PointSize, gl_PointCoord) OR a Mesh over an
// InstancedBufferGeometry of one quad, where every per-particle attribute is
// an instanced attribute and the vertex shader bills the quad in view space
// at the pixel size the point formula gave (the size math, the driver clamp
// and the corner-to-point-coord mapping are the core's; the GLSL below is its
// literal twin). The arm is chosen ONCE per session by the dev flag
// `?spritequads=off` (render_dev_flags.ts), which restores THREE.Points for
// an A/B on a D3D11 machine; the default is the quad.
//
// What stays identical between the arms, by construction: the material
// flags (blending, depth test and write, transparency), the render order and
// the object-level transparent sort (one object either way), the intra-cloud
// draw order (instance order IS buffer order), the atlas and fragment logic
// (the fragment shader is shared verbatim, reading SPRITE_COORD), and the
// per-frame upload (an InstancedInterleavedBuffer honours the same
// addUpdateRange prefix as the InterleavedBuffer it replaces).
//
// One deliberate divergence: GLES culls a point whose CENTRE leaves the clip
// volume, so a sprite half over the screen edge used to pop; the quad is
// clipped geometrically and stays. That is the only pixel the two arms differ
// on, and it is the better one.

/** Name of the per-vertex quad-corner attribute on the quad arm. */
export const SPRITE_QUAD_CORNER_ATTRIBUTE = 'aCorner';
/** Name of the uniform carrying ALIASED_POINT_SIZE_RANGE on the quad arm. */
export const SPRITE_QUAD_RANGE_UNIFORM = 'uPointRange';

/** True unless the session runs with `?spritequads=off`. */
export function spriteQuadsEnabled(): boolean {
  return !renderLayerDisabled('spritequads');
}

/** The live context's ALIASED_POINT_SIZE_RANGE, shared by reference by every
 *  sprite-quad material so a single sync reaches them all (the shape of
 *  gfx.ts's sharedUniforms.uTime). Starts at the D3D11 range. */
export const spriteQuadPointRange: THREE.IUniform<THREE.Vector2> = {
  value: new THREE.Vector2(POINT_SIZE_RANGE_FALLBACK.min, POINT_SIZE_RANGE_FALLBACK.max),
};

/** Read the driver's point size range off a live context into the shared
 *  uniform. Call once per renderer, right after the context exists. */
export function syncSpriteQuadPointRange(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
  const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as ArrayLike<number> | null;
  if (!range || range.length < 2) return;
  const min = range[0];
  const max = range[1];
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) return;
  spriteQuadPointRange.value.set(min, max);
}

export interface SpriteCloudShader {
  /** The host's declarations: attributes, uniforms and varyings. Must declare
   *  `uniform float uScale` (device px per world unit at view depth 1). */
  vertexHeader: string;
  /** The host's per-particle statements. They must leave `vec4 mv` (the
   *  particle's view-space centre) and `float pointSize` (what the point arm
   *  writes to gl_PointSize) in scope. */
  vertexBody: string;
  /** The whole fragment shader, reading SPRITE_COORD where a point shader
   *  read gl_PointCoord. */
  fragmentShader: string;
}

const UNIFORM_SCALE_DECLARATION = /uniform\s+float\s+uScale\s*;/;

/** The point arm writes the formula straight to gl_PointSize. */
function pointVertexShader(shader: SpriteCloudShader): string {
  return `${shader.vertexHeader}
void main() {
${shader.vertexBody}
  gl_PointSize = pointSize;
  gl_Position = projectionMatrix * mv;
}`;
}

/** The quad arm: the same body, then the core's conversion. The clamp is the
 *  driver's ALIASED_POINT_SIZE_RANGE the point arm was subject to; the half
 *  extent re-projects that pixel size to view space at the centre's depth. */
function quadVertexShader(shader: SpriteCloudShader): string {
  return `${shader.vertexHeader}
attribute vec2 ${SPRITE_QUAD_CORNER_ATTRIBUTE};
uniform vec2 ${SPRITE_QUAD_RANGE_UNIFORM};
varying vec2 vSpriteCoord;
void main() {
${shader.vertexBody}
  float spritePx = clamp(pointSize, ${SPRITE_QUAD_RANGE_UNIFORM}.x, ${SPRITE_QUAD_RANGE_UNIFORM}.y);
  float halfExtent = spritePx * (-mv.z) / (2.0 * uScale);
  mv.xy += ${SPRITE_QUAD_CORNER_ATTRIBUTE} * halfExtent;
  vSpriteCoord = vec2(0.5 + 0.5 * ${SPRITE_QUAD_CORNER_ATTRIBUTE}.x, 0.5 - 0.5 * ${SPRITE_QUAD_CORNER_ATTRIBUTE}.y);
  gl_Position = projectionMatrix * mv;
}`;
}

export function spriteCloudVertexShader(shader: SpriteCloudShader, quads: boolean): string {
  if (!UNIFORM_SCALE_DECLARATION.test(shader.vertexHeader)) {
    throw new Error('sprite cloud vertex header must declare `uniform float uScale;`');
  }
  return quads ? quadVertexShader(shader) : pointVertexShader(shader);
}

export function spriteCloudFragmentShader(shader: SpriteCloudShader, quads: boolean): string {
  return quads
    ? `varying vec2 vSpriteCoord;\n#define SPRITE_COORD vSpriteCoord\n${shader.fragmentShader}`
    : `#define SPRITE_COORD gl_PointCoord\n${shader.fragmentShader}`;
}

export interface SpriteCloudMaterialOptions extends SpriteCloudShader {
  uniforms: Record<string, THREE.IUniform>;
  transparent?: boolean;
  depthWrite?: boolean;
  depthTest?: boolean;
  blending?: THREE.Blending;
}

/** The cloud's ShaderMaterial for the chosen arm. The quad arm adds the shared
 *  point-range uniform; every other flag passes through untouched. */
export function buildSpriteCloudMaterial(
  options: SpriteCloudMaterialOptions,
  quads: boolean,
): THREE.ShaderMaterial {
  const uniforms = quads
    ? { ...options.uniforms, [SPRITE_QUAD_RANGE_UNIFORM]: spriteQuadPointRange }
    : options.uniforms;
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: spriteCloudVertexShader(options, quads),
    fragmentShader: spriteCloudFragmentShader(options, quads),
  });
  if (options.transparent !== undefined) material.transparent = options.transparent;
  if (options.depthWrite !== undefined) material.depthWrite = options.depthWrite;
  if (options.depthTest !== undefined) material.depthTest = options.depthTest;
  if (options.blending !== undefined) material.blending = options.blending;
  return material;
}

/** The quad's own per-vertex data: four corners and two triangles. */
function attachQuadCorners(geometry: THREE.InstancedBufferGeometry): void {
  geometry.setAttribute(
    SPRITE_QUAD_CORNER_ATTRIBUTE,
    new THREE.BufferAttribute(Float32Array.from(SPRITE_QUAD_CORNERS), 2),
  );
  geometry.setIndex([...SPRITE_QUAD_INDEX]);
}

/** A cloud whose per-particle data is fixed at construction (the weapon-skin
 *  clouds: the GPU animates them). `itemSizes` names the vector attributes;
 *  every other attribute is one float per particle. Every attribute becomes
 *  an instanced one on the quad arm, `position` included; the quad arm draws
 *  `count` instances where the point arm drew `count` vertices. */
export function buildSpriteCloudGeometry(
  attributes: Readonly<Record<string, Float32Array>>,
  itemSizes: Readonly<Record<string, number>>,
  quads: boolean,
): THREE.BufferGeometry {
  if (!quads) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, array] of Object.entries(attributes)) {
      geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSizes[name] ?? 1));
    }
    return geometry;
  }
  const geometry = new THREE.InstancedBufferGeometry();
  let count = Number.POSITIVE_INFINITY;
  for (const [name, array] of Object.entries(attributes)) {
    const itemSize = itemSizes[name] ?? 1;
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, itemSize));
    count = Math.min(count, Math.floor(array.length / itemSize));
  }
  attachQuadCorners(geometry);
  geometry.instanceCount = Number.isFinite(count) ? count : 0;
  return geometry;
}

export interface SpriteCloudInterleavedLayout {
  name: string;
  itemSize: number;
  offset: number;
}

/** The one packed per-particle buffer of an immediate-mode cloud (the pooled
 *  cloud): the same Float32Array, the same stride, the same prefix upload
 *  idiom (`clearUpdateRanges` + `addUpdateRange`) on both arms. */
export function buildSpriteCloudInterleavedBuffer(
  data: Float32Array,
  stride: number,
  quads: boolean,
): THREE.InterleavedBuffer {
  const buffer = quads
    ? new THREE.InstancedInterleavedBuffer(data, stride, 1)
    : new THREE.InterleavedBuffer(data, stride);
  buffer.setUsage(THREE.DynamicDrawUsage);
  return buffer;
}

/** Geometry over that buffer, starting empty (`setSpriteCloudCount` sets the
 *  drawn prefix). */
export function buildSpriteCloudInterleavedGeometry(
  buffer: THREE.InterleavedBuffer,
  layout: readonly SpriteCloudInterleavedLayout[],
  quads: boolean,
): THREE.BufferGeometry {
  const geometry = quads ? new THREE.InstancedBufferGeometry() : new THREE.BufferGeometry();
  for (const { name, itemSize, offset } of layout) {
    geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, itemSize, offset));
  }
  if (geometry instanceof THREE.InstancedBufferGeometry) attachQuadCorners(geometry);
  setSpriteCloudCount(geometry, 0);
  return geometry;
}

/** The scene object for the arm the geometry was built for. */
export function buildSpriteCloudObject(
  geometry: THREE.BufferGeometry,
  material: THREE.ShaderMaterial,
):
  | THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  | THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const object =
    geometry instanceof THREE.InstancedBufferGeometry
      ? new THREE.Mesh(geometry, material)
      : new THREE.Points(geometry, material);
  object.frustumCulled = false;
  return object;
}

/** How many particles the next draw submits: the point arm's draw range, the
 *  quad arm's instance count. */
export function setSpriteCloudCount(geometry: THREE.BufferGeometry, count: number): void {
  if (geometry instanceof THREE.InstancedBufferGeometry) geometry.instanceCount = count;
  else geometry.setDrawRange(0, count);
}

export function spriteCloudCount(geometry: THREE.BufferGeometry): number {
  return geometry instanceof THREE.InstancedBufferGeometry
    ? geometry.instanceCount
    : geometry.drawRange.count;
}
