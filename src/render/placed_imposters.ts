// Baked sprite imposters for placed assets past PLACED_IMPOSTER_DIST.
//
// SPACEY (2026-09-18): "keep the same topo for all the models at 100yds and
// 200yds but make the billboards imposters for 300yds+". A batched placement
// keeps its full geometry to 300 yd; past that its instance leaves the
// geometry batches and ONE quad in this view's single instanced mesh draws
// a baked sprite of the same asset instead: every far placement on the map
// costs one draw call between them, whatever the asset mix.
//
// Bake: the first time an asset is needed as a sprite, its batch pieces (the
// same geometry + materials the instances draw) are rendered from
// IMPOSTER_VIEWS yaw angles into one strip of a shared 2048 atlas, under the
// same neutral hemisphere rig foliage_impostor.ts uses (the atlas holds
// albedo x irradiance / PI, bound as a MAP and lit again live by the Lambert
// sprite material, so the sprite follows the sun and the fog like the model
// it stands in for). One bake per frame at most, so approaching a far
// horizon of new assets never spends a whole frame baking.
//
// Draw: the vertex shader stands each quad upright facing the camera, picks
// the two atlas views bracketing the camera's bearing around the instance's
// yaw and blends them (no 45-degree view pops while circling), and carries
// the per-instance screen-door fade the batches use (placed_fade.ts) so the
// swap cross-fades instead of popping.

import * as THREE from 'three';
import { SlotTable } from './placed_batch_core';
import type { BatchSub } from './placed_batches';
import { PLACED_FADE_ATTRIBUTE, PLACED_FADE_DITHER_GLSL } from './placed_fade';
import { spriteQuadRayDistance } from './placed_sprite_pick_core';

export const IMPOSTER_VIEWS = 8;
/** The default cell: foliage. The town's buildings bake at 128 (a wall's
 *  windows and a roof line do not survive 64 px at 300 yd). */
const CELL_PX = 64;
const ATLAS_PX = 2048;
/** How many assets a view's atlas holds: 128 at 8 views x 64 px, 32 at 128. */
export function imposterAtlasCapacity(cellPx = CELL_PX): number {
  return Math.floor(ATLAS_PX / (IMPOSTER_VIEWS * cellPx)) * Math.floor(ATLAS_PX / cellPx);
}
export const IMPOSTER_ATLAS_CAPACITY = imposterAtlasCapacity(CELL_PX);
const BAKES_PER_FRAME = 1;
const INITIAL_CAPACITY = 64;
// Same neutral rig as the foliage sprites: a hemisphere for top-down volume,
// the PI factor cancelling Lambert's 1/PI so the atlas lands near albedo.
const BAKE_SKY = 1.15 * Math.PI;
const BAKE_GROUND = 0.62 * Math.PI;
// A 1 px transparent gutter inside each cell keeps neighbouring views from
// bleeding into each other's edges down the mip chain (1 / cellPx).
// Highest atlas mip an imposter may sample: at level L a 64 px cell is
// 64 / 2^L texels wide; past 4 texels (L=4 at 64, 5 at 128) the hardware's
// averaging reaches into the neighbouring strip, i.e. a different asset.

interface Archetype {
  /** Strip index in the atlas. */
  strip: number;
  /** Atlas uv of the strip's first cell. */
  u0: number;
  v0: number;
  /** Model-space framing, in template units (scale 1). */
  minY: number;
  height: number;
  radius: number;
}

interface ImposterUserData {
  wocFadePatched?: boolean;
}

/**
 * The single instanced quad mesh every far placement draws through.
 */
export class PlacedImposters {
  readonly mesh: THREE.Mesh;
  private readonly cellPx: number;
  private readonly stripPx: number;
  private readonly stripsPerRow: number;
  private readonly atlasCapacity: number;
  private readonly gutter: number;
  private readonly maxLod: number;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.MeshLambertMaterial;
  // Keep USE_MAP/UV shape stable before the first lazy atlas bake. Initial
  // resident prewarm sees this hidden mesh even while it has zero instances.
  // Retain the seed until disposal: prewarm material clones may still use it.
  private readonly shaderSeed = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  private readonly slots = new SlotTable();
  private capacity = INITIAL_CAPACITY;
  private seat = new Float32Array(INITIAL_CAPACITY * 4);
  private size = new Float32Array(INITIAL_CAPACITY * 2);
  private cell = new Float32Array(INITIAL_CAPACITY * 2);
  private fade = new Float32Array(INITIAL_CAPACITY);
  private readonly archetypes = new Map<string, Archetype | null>();
  private webgl: THREE.WebGLRenderer | null = null;
  private atlas: THREE.WebGLRenderTarget | null = null;
  private scratch: THREE.WebGLRenderTarget | null = null;
  private bakeScene: THREE.Scene | null = null;
  private bakeHolder: THREE.Group | null = null;
  private bakeCamera: THREE.OrthographicCamera | null = null;
  private blitScene: THREE.Scene | null = null;
  private blitMaterial: THREE.MeshBasicMaterial | null = null;
  private blitCamera: THREE.OrthographicCamera | null = null;
  private readonly bakeMaterials = new Map<THREE.Material, THREE.Material>();
  private stripsUsed = 0;
  private bakesThisFrame = 0;
  private readonly scratchBox = new THREE.Box3();
  private readonly scratchCorner = new THREE.Vector3();

  constructor(opts: { cellPx?: number; name?: string } = {}) {
    this.cellPx = opts.cellPx ?? CELL_PX;
    this.stripPx = IMPOSTER_VIEWS * this.cellPx;
    this.stripsPerRow = Math.floor(ATLAS_PX / this.stripPx);
    this.atlasCapacity = imposterAtlasCapacity(this.cellPx);
    this.gutter = 1 / this.cellPx;
    this.maxLod = Math.max(0, Math.log2(this.cellPx) - 2);
    this.geometry = new THREE.InstancedBufferGeometry();
    // an upright quad: x across (-0.5..0.5), y up (0..1)
    this.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3),
    );
    this.geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
    );
    this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.instanceCount = 0;
    this.installInstanceAttributes();
    this.shaderSeed.colorSpace = THREE.NoColorSpace;
    this.shaderSeed.needsUpdate = true;
    this.material = new THREE.MeshLambertMaterial({
      map: this.shaderSeed,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.material.name = opts.name ?? 'placed-imposters';
    this.patchMaterial(this.material);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = opts.name ?? 'placed-imposters';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    this.mesh.visible = false;
  }

  /** The renderer that bakes the atlas; until it is set nothing can be a sprite. */
  setRenderer(webgl: THREE.WebGLRenderer): void {
    this.webgl = webgl;
  }

  get bakingAvailable(): boolean {
    return this.webgl !== null;
  }

  /** Live sprite count, for the draw-call readout and tests. */
  get instanceCount(): number {
    return this.slots.count;
  }

  /** Assets with a baked strip (tests and the perf overlay). */
  get bakedCount(): number {
    return this.stripsUsed;
  }

  /** Call once per frame before the LOD sweep: opens the frame's bake budget. */
  beginFrame(): void {
    this.bakesThisFrame = 0;
  }

  has(id: number): boolean {
    return this.slots.has(id);
  }

  /**
   * Is `path` ready to draw as a sprite? Bakes its strip on demand (at most
   * BAKES_PER_FRAME per frame); false while it is not (no renderer yet, the
   * frame's budget is spent, the atlas is full, or nothing bakeable).
   */
  ensure(path: string, subs: readonly BatchSub[]): boolean {
    const known = this.archetypes.get(path);
    if (known !== undefined) return known !== null;
    if (!this.webgl || this.bakesThisFrame >= BAKES_PER_FRAME) return false;
    if (this.stripsUsed >= this.atlasCapacity) {
      this.archetypes.set(path, null);
      return false;
    }
    this.bakesThisFrame++;
    const arch = this.bake(subs);
    this.archetypes.set(path, arch);
    return arch !== null;
  }

  /**
   * Seat (or re-seat) the sprite for `id`: an upright quad of the asset's
   * baked strip, `scaleXZ` wide and `scaleY` tall in template units, standing
   * on the model origin's base. `yaw` is the placement's Y rotation.
   */
  attach(
    id: number,
    path: string,
    originX: number,
    originY: number,
    originZ: number,
    yaw: number,
    scaleXZ: number,
    scaleY: number,
    fade = 1,
  ): boolean {
    const arch = this.archetypes.get(path);
    if (!arch) return false;
    const slot = this.slots.alloc(id);
    this.grow(slot + 1);
    this.seat[slot * 4] = originX;
    this.seat[slot * 4 + 1] = originY + arch.minY * scaleY;
    this.seat[slot * 4 + 2] = originZ;
    this.seat[slot * 4 + 3] = yaw;
    this.size[slot * 2] = arch.radius * 2 * scaleXZ;
    this.size[slot * 2 + 1] = arch.height * scaleY;
    this.cell[slot * 2] = arch.u0;
    this.cell[slot * 2 + 1] = arch.v0;
    this.fade[slot] = fade;
    this.geometry.instanceCount = this.slots.count;
    this.mesh.visible = this.slots.count > 0;
    this.markDirty();
    return true;
  }

  /** The placement id drawn at a live slot (0..instanceCount-1). */
  idAt(slot: number): number {
    return this.slots.idAt(slot);
  }

  /**
   * Distance along `ray` to the billboard the shader draws at `slot`, turned to
   * face an eye at (`eyeX`, `eyeZ`), or -1 on a miss. three's raycast only sees
   * the base quad, so editor picking asks each sprite here instead (what counts
   * as a hit: placed_sprite_pick_core.ts). Reads the uploaded seat and size, so
   * the test is against exactly what is drawn. Allocation-free.
   */
  rayDistance(slot: number, ray: THREE.Ray, eyeX: number, eyeZ: number): number {
    if (slot < 0 || slot >= this.slots.count) return -1;
    const s = slot * 4;
    return spriteQuadRayDistance(
      this.seat[s],
      this.seat[s + 1],
      this.seat[s + 2],
      this.size[slot * 2],
      this.size[slot * 2 + 1],
      eyeX,
      eyeZ,
      ray.origin.x,
      ray.origin.y,
      ray.origin.z,
      ray.direction.x,
      ray.direction.y,
      ray.direction.z,
    );
  }

  setFade(id: number, fade: number): void {
    const slot = this.slots.slotOf(id);
    if (slot === undefined) return;
    this.fade[slot] = fade;
    (
      this.geometry.getAttribute(PLACED_FADE_ATTRIBUTE) as THREE.InstancedBufferAttribute
    ).needsUpdate = true;
  }

  detach(id: number): void {
    const release = this.slots.free(id);
    if (!release) return;
    if (release.moved !== null) {
      const from = this.slots.count; // old last slot, now past the end
      const to = release.freed;
      this.seat.copyWithin(to * 4, from * 4, from * 4 + 4);
      this.size.copyWithin(to * 2, from * 2, from * 2 + 2);
      this.cell.copyWithin(to * 2, from * 2, from * 2 + 2);
      this.fade[to] = this.fade[from];
    }
    this.geometry.instanceCount = this.slots.count;
    this.mesh.visible = this.slots.count > 0;
    this.markDirty();
  }

  /** Follow a document reindex (see SlotTable.rename). */
  rename(from: number, to: number): void {
    this.slots.rename(from, to);
  }

  /** Drop every sprite (the atlas and its bakes survive: same map, same assets). */
  clear(): void {
    this.slots.clear();
    this.geometry.instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.clear();
    this.archetypes.clear();
    this.stripsUsed = 0;
    this.atlas?.dispose();
    this.atlas = null;
    this.scratch?.dispose();
    this.scratch = null;
    for (const mat of this.bakeMaterials.values()) mat.dispose();
    this.bakeMaterials.clear();
    this.blitMaterial?.dispose();
    this.blitMaterial = null;
    this.material.dispose();
    this.shaderSeed.dispose();
    this.geometry.dispose();
  }

  // ---- instance buffers --------------------------------------------------------

  private installInstanceAttributes(): void {
    const dyn = <T extends THREE.InstancedBufferAttribute>(attr: T): T => {
      attr.setUsage(THREE.DynamicDrawUsage);
      return attr;
    };
    this.geometry.setAttribute('aSeat', dyn(new THREE.InstancedBufferAttribute(this.seat, 4)));
    this.geometry.setAttribute('aSize', dyn(new THREE.InstancedBufferAttribute(this.size, 2)));
    this.geometry.setAttribute('aCell', dyn(new THREE.InstancedBufferAttribute(this.cell, 2)));
    this.geometry.setAttribute(
      PLACED_FADE_ATTRIBUTE,
      dyn(new THREE.InstancedBufferAttribute(this.fade, 1)),
    );
  }

  private markDirty(): void {
    for (const name of ['aSeat', 'aSize', 'aCell', PLACED_FADE_ATTRIBUTE]) {
      (this.geometry.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  }

  private grow(needed: number): void {
    if (needed <= this.capacity) return;
    let capacity = this.capacity;
    while (capacity < needed) capacity *= 2;
    const seat = new Float32Array(capacity * 4);
    seat.set(this.seat);
    const size = new Float32Array(capacity * 2);
    size.set(this.size);
    const cell = new Float32Array(capacity * 2);
    cell.set(this.cell);
    const fade = new Float32Array(capacity).fill(1);
    fade.set(this.fade);
    this.seat = seat;
    this.size = size;
    this.cell = cell;
    this.fade = fade;
    this.capacity = capacity;
    this.installInstanceAttributes();
  }

  // ---- shader ---------------------------------------------------------------------

  private patchMaterial(material: THREE.MeshLambertMaterial): void {
    (material.userData as ImposterUserData).wocFadePatched = true;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uImposterCell = {
        value: new THREE.Vector2(this.cellPx / ATLAS_PX, this.cellPx / ATLAS_PX),
      };
      shader.uniforms.uImposterViews = { value: IMPOSTER_VIEWS };
      shader.uniforms.uImposterAtlasPx = { value: ATLAS_PX };
      shader.uniforms.uImposterMaxLod = { value: this.maxLod };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec4 aSeat;
attribute vec2 aSize;
attribute vec2 aCell;
attribute float ${PLACED_FADE_ATTRIBUTE};
uniform vec2 uImposterCell;
uniform float uImposterViews;
varying vec2 vImposterUvA;
varying vec2 vImposterUvB;
varying float vImposterBlend;
varying float vWocFade;
vec3 wocImposterDir;`,
        )
        // the facing direction feeds both the normal and the quad
        .replace(
          '#include <beginnormal_vertex>',
          `// wocImposterDir was already resolved in <uv_vertex> (chunk 13);
// this chunk is 18, and <begin_vertex> is 24, so all three see it.
// a normal tilted well toward the sky: the sun lights every bearing evenly
vec3 objectNormal = normalize(wocImposterDir * 0.5 + vec3(0.0, 0.85, 0.0));
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif`,
        )
        .replace(
          '#include <uv_vertex>',
          `{
  // RESOLVE THE FACING HERE. three runs <uv_vertex> at chunk 13 and
  // <beginnormal_vertex> at 18, so computing the direction in the latter and
  // reading it here read an UNASSIGNED global, vec3(0) on every driver
  // tested, giving atan(0,0) = 0 and a bearing of just -rotY. The atlas view
  // was therefore a fixed function of the placement's rotation and never
  // responded to the camera at all: most sprites sat frozen at a 50/50
  // cross-dissolve of two baked views for the whole session.
  vec3 wocToCam = cameraPosition - aSeat.xyz;
  wocImposterDir = normalize(vec3(wocToCam.x, 0.0, wocToCam.z + 1e-5));
  // the camera's bearing around this instance, relative to its yaw, picks
  // the two bracketing atlas views
  float bearing = atan(wocImposterDir.x, wocImposterDir.z) - aSeat.w;
  float v = fract(bearing / 6.28318530718) * uImposterViews;
  float v0 = floor(v);
  vImposterBlend = v - v0;
  float v1 = mod(v0 + 1.0, uImposterViews);
  vec2 inner = vec2(${this.gutter.toFixed(6)}) + uv * (1.0 - 2.0 * ${this.gutter.toFixed(6)});
  vImposterUvA = aCell + (vec2(v0, 0.0) + inner) * uImposterCell;
  vImposterUvB = aCell + (vec2(v1, 0.0) + inner) * uImposterCell;
  vWocFade = ${PLACED_FADE_ATTRIBUTE};
}`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 wocRight = vec3(wocImposterDir.z, 0.0, -wocImposterDir.x);
vec3 transformed = aSeat.xyz + wocRight * (position.x * aSize.x) + vec3(0.0, position.y * aSize.y, 0.0);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec2 vImposterUvA;
varying vec2 vImposterUvB;
varying float vImposterBlend;
varying float vWocFade;
uniform float uImposterAtlasPx;
uniform float uImposterMaxLod;
${PLACED_FADE_DITHER_GLSL}`,
        )
        .replace(
          '#include <map_fragment>',
          `{
  // CLAMP THE MIP. The atlas is one 2048 sheet of 64 px cells, so mip level L
  // has each cell at 64 / 2^L texels: by L=6 a cell is a single texel and the
  // hardware has averaged it together with its NEIGHBOURS, which are other
  // assets' strips. That is why a distant tree sometimes wore another
  // asset's sprite (SPACEY, 2026-09-20: "sometimes the imposters are the wrong
  // 1s"), and why the far field shimmered as the level changed under it.
  // L=4 leaves a cell 4 texels wide, which is still wider than the sprite is
  // drawn at this range, so clamping costs nothing visible and the bleed
  // cannot happen. Derivatives are taken on ONE view's uv; the pair are the
  // same size in the atlas, so a shared lod also keeps the blend stable.
  vec2 wocDx = dFdx(vImposterUvA) * uImposterAtlasPx;
  vec2 wocDy = dFdy(vImposterUvA) * uImposterAtlasPx;
  float wocRho = max(length(wocDx), length(wocDy));
  float wocLod = clamp(log2(max(wocRho, 1e-6)), 0.0, uImposterMaxLod);
  vec4 sampledDiffuseColor = mix(
    textureLod(map, vImposterUvA, wocLod),
    textureLod(map, vImposterUvB, wocLod),
    vImposterBlend);
  diffuseColor *= sampledDiffuseColor;
}`,
        )
        .replace(
          '#include <alphatest_fragment>',
          `#include <alphatest_fragment>
// A cross-fade must PARTITION the dither, not test both reps the same way.
// Both patches used to discard where bayer >= fade, and advanceFades gives
// the incoming rep t and the outgoing 1 - t, so both drew the pixels with
// bayer < 0.5 at the midpoint and NOBODY drew the other half: the object
// went half see-through every time it changed tier. A NEGATIVE fade marks
// the outgoing rep, which draws the exact complement of the incoming one.
if (vWocFade < 0.0) {
  if (wocBayer4(gl_FragCoord.xy) < 1.0 + vWocFade) discard;
} else if (vWocFade < 0.999 && wocBayer4(gl_FragCoord.xy) >= vWocFade) discard;`,
        );
    };
    material.customProgramCacheKey = () => `woc-placed-imposter-${this.cellPx}`;
  }

  // ---- bake -----------------------------------------------------------------------

  private ensureBakeRig(webgl: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
    if (this.atlas) return this.atlas;
    const atlas = new THREE.WebGLRenderTarget(ATLAS_PX, ATLAS_PX, {
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    atlas.texture.anisotropy = Math.min(4, webgl.capabilities.getMaxAnisotropy());
    atlas.texture.colorSpace = THREE.NoColorSpace;
    atlas.scissorTest = true;
    this.atlas = atlas;
    this.material.map = atlas.texture;
    this.material.needsUpdate = true;
    // the MSAA scratch one cell renders into before the copy into its rect
    this.scratch = new THREE.WebGLRenderTarget(this.cellPx, this.cellPx, {
      depthBuffer: true,
      samples: 4,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.bakeScene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, BAKE_SKY);
    hemi.groundColor.setScalar(BAKE_GROUND / BAKE_SKY);
    this.bakeScene.add(hemi);
    this.bakeHolder = new THREE.Group();
    this.bakeScene.add(this.bakeHolder);
    this.bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    // transparent + NoBlending: a straight RGBA copy (an opaque material
    // would force alpha 1 over the whole cell and the alpha test would then
    // have nothing to cut)
    this.blitMaterial = new THREE.MeshBasicMaterial({
      map: this.scratch.texture,
      toneMapped: false,
      transparent: true,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.blitScene = new THREE.Scene();
    this.blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMaterial));
    this.blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // seed the atlas transparent once
    const prev = webgl.getRenderTarget();
    atlas.viewport.set(0, 0, ATLAS_PX, ATLAS_PX);
    atlas.scissor.set(0, 0, ATLAS_PX, ATLAS_PX);
    webgl.setRenderTarget(atlas);
    const prevColor = new THREE.Color();
    webgl.getClearColor(prevColor);
    const prevAlpha = webgl.getClearAlpha();
    webgl.setClearColor(0x000000, 0);
    webgl.clear(true, false, false);
    webgl.setClearColor(prevColor, prevAlpha);
    webgl.setRenderTarget(prev);
    return atlas;
  }

  private bakeMaterialFor(src: THREE.Material): THREE.Material {
    const cached = this.bakeMaterials.get(src);
    if (cached) return cached;
    const s = src as THREE.MeshStandardMaterial;
    const cutout = src.transparent === true || (src.alphaTest ?? 0) > 0;
    const mat = new THREE.MeshLambertMaterial({
      map: s.map ?? null,
      color: s.color ? s.color.clone() : new THREE.Color(1, 1, 1),
      vertexColors: s.vertexColors === true,
      emissive: s.emissive ? s.emissive.clone() : new THREE.Color(0, 0, 0),
      emissiveMap: s.emissiveMap ?? null,
      emissiveIntensity: s.emissiveIntensity ?? 1,
      alphaTest: cutout ? 0.4 : 0,
      side: src.side === THREE.DoubleSide || cutout ? THREE.DoubleSide : THREE.FrontSide,
      toneMapped: false,
      fog: false,
    });
    this.bakeMaterials.set(src, mat);
    return mat;
  }

  /** Model-space framing of the pieces: base, height, and the horizontal
   *  reach from the model origin (the bake spins the model about it). */
  private framing(subs: readonly BatchSub[]): { minY: number; height: number; radius: number } {
    let minY = Infinity;
    let maxY = -Infinity;
    let radius = 0;
    for (const sub of subs) {
      if (!sub.geometry.boundingBox) sub.geometry.computeBoundingBox();
      const bb = sub.geometry.boundingBox;
      if (!bb) continue;
      this.scratchBox.copy(bb);
      for (let c = 0; c < 8; c++) {
        this.scratchCorner.set(
          c & 1 ? this.scratchBox.max.x : this.scratchBox.min.x,
          c & 2 ? this.scratchBox.max.y : this.scratchBox.min.y,
          c & 4 ? this.scratchBox.max.z : this.scratchBox.min.z,
        );
        this.scratchCorner.applyMatrix4(sub.local);
        minY = Math.min(minY, this.scratchCorner.y);
        maxY = Math.max(maxY, this.scratchCorner.y);
        radius = Math.max(radius, Math.hypot(this.scratchCorner.x, this.scratchCorner.z));
      }
    }
    if (!Number.isFinite(minY)) return { minY: 0, height: 1, radius: 0.5 };
    return { minY, height: Math.max(0.05, maxY - minY), radius: Math.max(0.05, radius) };
  }

  private bake(subs: readonly BatchSub[]): Archetype | null {
    const webgl = this.webgl;
    if (!webgl || subs.length === 0) return null;
    const atlas = this.ensureBakeRig(webgl);
    const scratch = this.scratch;
    const scene = this.bakeScene;
    const holder = this.bakeHolder;
    const camera = this.bakeCamera;
    const blitScene = this.blitScene;
    const blitCamera = this.blitCamera;
    if (!scratch || !scene || !holder || !camera || !blitScene || !blitCamera) return null;
    const { minY, height, radius } = this.framing(subs);
    const strip = this.stripsUsed++;
    const col = strip % this.stripsPerRow;
    const row = Math.floor(strip / this.stripsPerRow);
    const px0 = col * this.stripPx;
    const py0 = row * this.cellPx;

    while (holder.children.length > 0) holder.remove(holder.children[0]);
    for (const sub of subs) {
      const mesh = new THREE.Mesh(sub.geometry, this.bakeMaterialFor(sub.material));
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(sub.local);
      holder.add(mesh);
    }
    // frame the model: a square cell, so the wider of reach/height fills it
    const half = Math.max(radius, height / 2);
    const centerY = minY + height / 2;
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.near = 0.1;
    camera.far = radius * 4 + height + 2;
    camera.updateProjectionMatrix();

    const prevTarget = webgl.getRenderTarget();
    const prevColor = new THREE.Color();
    webgl.getClearColor(prevColor);
    const prevAlpha = webgl.getClearAlpha();
    const prevAutoClear = webgl.autoClear;
    const prevShadow = webgl.shadowMap.enabled;
    try {
      webgl.shadowMap.enabled = false;
      webgl.autoClear = true;
      const dist = radius * 2 + height + 1;
      for (let view = 0; view < IMPOSTER_VIEWS; view++) {
        const azimuth = (view / IMPOSTER_VIEWS) * Math.PI * 2;
        camera.position.set(Math.sin(azimuth) * dist, centerY, Math.cos(azimuth) * dist);
        camera.up.set(0, 1, 0);
        camera.lookAt(0, centerY, 0);
        camera.updateMatrixWorld(true);
        // the cell itself, MSAA, cleared transparent (a mid grey behind
        // the alpha so the mip averages do not sink edge texels to black)
        webgl.setRenderTarget(scratch);
        webgl.setClearColor(0x6f6a62, 0);
        webgl.clear(true, true, false);
        webgl.render(scene, camera);
        // ...copied straight into its atlas rect
        atlas.viewport.set(px0 + view * this.cellPx, py0, this.cellPx, this.cellPx);
        atlas.scissor.set(px0 + view * this.cellPx, py0, this.cellPx, this.cellPx);
        webgl.setRenderTarget(atlas);
        webgl.autoClear = false;
        webgl.render(blitScene, blitCamera);
        webgl.autoClear = true;
      }
    } finally {
      webgl.setRenderTarget(prevTarget);
      webgl.setClearColor(prevColor, prevAlpha);
      webgl.autoClear = prevAutoClear;
      webgl.shadowMap.enabled = prevShadow;
      while (holder.children.length > 0) holder.remove(holder.children[0]);
    }
    // the model spans [-half, half] horizontally and [centerY - half, centerY + half]
    // vertically in the cell: the quad reproduces exactly that square
    return {
      strip,
      u0: px0 / ATLAS_PX,
      v0: py0 / ATLAS_PX,
      minY: centerY - half,
      height: half * 2,
      radius: half,
    };
  }
}
