// Far-foliage sprite impostors: the Three side.
//
// At world build time this module bakes every foliage archetype (each tree
// species variant, each rock colorway variant, the bush kinds) into one
// texture atlas by rendering the REAL extracted GLB parts from a ring of yaw
// angles under a neutral hemisphere rig. The far field then draws one
// InstancedMesh of camera-facing quads per (bucket, category): each instance
// picks the two atlas views bracketing its camera bearing (offset by its own
// placement yaw, so a forest never shows one repeated silhouette) and blends
// them, so orbiting the camera never snaps. Lighting is the live standard
// pipeline over the quad's up normal, the exact response the ground plane
// has, so day-night grades, biome light and fog all land on the sprite the
// way they land on the terrain under it.
//
// The handoff against the real meshes is per instance and jittered: the real
// side collapses each tree at swap - fade * jitter (foliage_collapse.ts) and
// the sprite side starts it at the same distance, computed from the same
// GLSL (foliage_impostor_core.ts), so every tree is drawn by exactly one of
// the two representations at every distance.
//
// COST MODEL: a sprite is 2 triangles and every category in a bucket is one
// draw call, against the old per-species cone meshes (28 to 80 triangles per
// instance, up to 8 draws per bucket) and, above all, against the real
// geometry the budget no longer draws between the swap and the fog wall.
// The atlas is baked once per world build (a few hundred tiny offscreen
// renders during the loading screen) and lives as one mip-mapped texture.

import * as THREE from 'three';
import { WORLD_MIN_X, WORLD_MIN_Z } from '../sim/data';
import { terrainHeight } from '../sim/world';
import {
  createFarShortfallSampler,
  FAR_WORLD_MARGIN,
  type FarFieldPolicy,
  farFieldPolicy,
} from './far_terrain_core';
import { collapseWindowUniforms } from './foliage_collapse';
import {
  IMPOSTOR_ATLAS_BUDGET,
  IMPOSTOR_CATEGORY_VIEWS,
  IMPOSTOR_CATEGORY_WIND,
  IMPOSTOR_CELL_PX,
  IMPOSTOR_JITTER_GLSL,
  IMPOSTOR_ROW_BUDGET,
  type ImpostorArchetypeSpec,
  type ImpostorCellRect,
  packImpostorAtlas,
} from './foliage_impostor_core';
import { GFX, sharedUniforms } from './gfx';

export type ImpostorCategory = 'tree' | 'rock' | 'dress' | 'building';

const CATEGORY_VIEWS = IMPOSTOR_CATEGORY_VIEWS;
// The per-category sway policy lives in the core (IMPOSTOR_CATEGORY_WIND,
// pinned by its test): rigid categories at hard zero, sway parity elsewhere.
const CATEGORY_WIND = IMPOSTOR_CATEGORY_WIND;

interface BakePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  isLeaf: boolean;
}

interface Archetype {
  spec: ImpostorArchetypeSpec;
  parts: BakePart[];
  /** model-space framing captured for the quad reconstruction */
  minY: number;
  height: number;
  width: number;
  /** per-archetype sway multiplier over the category amplitude (dead trees 0) */
  windMul: number;
}

interface SpriteInstance {
  archetype: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** world quad width and height (already include the placement scale) */
  width: number;
  height: number;
  tint: number; // packed rgb 0..1 floats via Color
  tintG: number;
  tintB: number;
  /** the real instance's uniform scale, for wind amplitude parity */
  windScale: number;
}

interface BucketAcc {
  category: ImpostorCategory;
  x: number;
  z: number;
  radius: number;
  items: SpriteInstance[];
}

export interface ImpostorBucketHandle {
  add(
    archetype: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    scale: number,
    heightJitter: number,
    tint: THREE.Color,
  ): void;
}

export interface ImpostorRegistration {
  mesh: THREE.InstancedMesh;
  x: number;
  z: number;
  radius: number;
  category: ImpostorCategory;
}

export interface ImpostorSession {
  registerArchetype(
    category: ImpostorCategory,
    key: string,
    parts: BakePart[],
    windMul?: number,
  ): number;
  bucket(category: ImpostorCategory, x: number, z: number, radius: number): ImpostorBucketHandle;
  finalize(webgl: THREE.WebGLRenderer, parent: THREE.Group, seed: number): ImpostorRegistration[];
}

/**
 * The live far-field capability read: the one policy the sprite session,
 * the renderer's vista arm, the water apron and the shortfall sampler all
 * share (farFieldPolicy in far_terrain_core.ts holds the laws and the
 * profile tests).
 */
export function activeFarFieldPolicy(): FarFieldPolicy {
  return farFieldPolicy(GFX.tier, GFX);
}

/** Sprites ship per the shared far-field policy (never on lean or
 *  constrained-memory profiles; the vista additionally requires them). */
export function impostorsActive(): boolean {
  return activeFarFieldPolicy().sprites;
}

// ---------------------------------------------------------------------------
// Bake
// ---------------------------------------------------------------------------

// Neutral, yaw-agnostic studio rig: a hemisphere gives the bake its top-down
// volume (canopy crowns brighter than skirts) without stamping a sun
// direction into a sprite that must read correctly from every bearing at
// every hour. Absolute level is close to 1 so the live standard-material lighting
// supplies the actual brightness.
const BAKE_SKY = 1.15;
const BAKE_GROUND = 0.62;

const bakeMaterialCache = new Map<THREE.Material, THREE.Material>();

function bakeMaterialFor(src: THREE.Material, isLeaf: boolean): THREE.Material {
  const cached = bakeMaterialCache.get(src);
  if (cached) return cached;
  const s = src as THREE.MeshStandardMaterial;
  const mat = new THREE.MeshLambertMaterial({
    map: s.map ?? null,
    color: s.color ? s.color.clone() : new THREE.Color(1, 1, 1),
    vertexColors: s.vertexColors === true,
    alphaTest: isLeaf ? 0.4 : 0,
    side: isLeaf ? THREE.DoubleSide : THREE.FrontSide,
    toneMapped: false,
    fog: false,
  });
  bakeMaterialCache.set(src, mat);
  return mat;
}

function archetypeBounds(parts: BakePart[]): { minY: number; height: number; radius: number } {
  let minY = Infinity;
  let maxY = -Infinity;
  let radius = 0;
  const box = new THREE.Box3();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    const bb = part.geometry.boundingBox;
    if (!bb) continue;
    box.copy(bb);
    minY = Math.min(minY, box.min.y);
    maxY = Math.max(maxY, box.max.y);
    // the bake spins the model, so frame the worst-case horizontal reach
    radius = Math.max(
      radius,
      Math.hypot(box.min.x, box.min.z),
      Math.hypot(box.min.x, box.max.z),
      Math.hypot(box.max.x, box.min.z),
      Math.hypot(box.max.x, box.max.z),
    );
  }
  if (!Number.isFinite(minY)) {
    minY = 0;
    maxY = 1;
    radius = 0.5;
  }
  return { minY, height: Math.max(0.1, maxY - minY), radius: Math.max(0.1, radius) };
}

function bakeAtlas(
  webgl: THREE.WebGLRenderer,
  archetypes: Archetype[],
): { target: THREE.WebGLRenderTarget; rects: ImpostorCellRect[]; size: number } {
  const placement = packImpostorAtlas(
    archetypes.map((a) => a.spec),
    IMPOSTOR_ATLAS_BUDGET,
  );
  const size = placement.size;

  // Transient GPU memory is the budget here, not passes: a full-atlas MSAA
  // bake target held a size^2 4x color + depth pair (over half a GiB at
  // 4096) alongside the final chain. Instead every view renders into ONE
  // small reusable cell-sized MSAA scratch (under a MiB) and blits into its
  // final rect, so peak use is the final chain plus that scratch.
  const maxCellPx = archetypes.reduce((m, a) => Math.max(m, a.spec.cellPx), 32);
  const scratch = new THREE.WebGLRenderTarget(maxCellPx, maxCellPx, {
    depthBuffer: true,
    samples: 4,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, BAKE_SKY);
  (hemi.groundColor as THREE.Color).setScalar(BAKE_GROUND / BAKE_SKY);
  scene.add(hemi);
  const holder = new THREE.Group();
  scene.add(holder);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);

  const prevTarget = webgl.getRenderTarget();
  const prevClearColor = new THREE.Color();
  webgl.getClearColor(prevClearColor);
  const prevClearAlpha = webgl.getClearAlpha();
  const prevAutoClear = webgl.autoClear;

  // The mip-mapped atlas the sprites sample; created up front so the
  // finally arm can dispose it on a mid-bake throw. generateMipmaps stays
  // OFF until every cell has landed: three regenerates a target's whole
  // mip chain at the end of every render() into it, so leaving it on would
  // rebuild the 2048 chain a few hundred times during the bake.
  const finalTarget = new THREE.WebGLRenderTarget(size, size, {
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  finalTarget.texture.generateMipmaps = false;
  finalTarget.texture.anisotropy = Math.min(4, webgl.capabilities.getMaxAnisotropy());

  let done = false;
  // transparent + NoBlending: a straight RGBA copy. A default opaque
  // material compiles with the OPAQUE define and force-writes alpha 1 over
  // the whole atlas, which turns every sprite into a full rectangle
  // downstream (the alpha test has nothing left to cut).
  const blitMat = new THREE.MeshBasicMaterial({
    map: scratch.texture,
    toneMapped: false,
    transparent: true,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const blitQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat);
  const blitScene = new THREE.Scene();
  blitScene.add(blitQuad);
  const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  try {
    // Cell addressing goes through the TARGET's viewport/scissor: with a
    // render target bound, three ignores the renderer-level setViewport
    // (that state belongs to the canvas) and reads renderTarget.viewport
    // each render call. The clear alpha is 0 (the alpha test carves sprites
    // from it) but the clear RGB is a mid-canopy green: the MSAA resolve
    // and the mip chain average edge texels toward the clear color, so
    // distant sprites (deep mips are mostly such averages) tint toward
    // foliage instead of collapsing to near-black silhouettes.
    // The scratch clears FULL-SIZE every view (no scissor): a smaller cell
    // reusing it after a larger one must not leave the larger bake's texels
    // standing where the blit's edge taps can reach them.
    finalTarget.scissorTest = true;
    webgl.setClearColor(0x86a868, 0);
    webgl.autoClear = false;

    // Seed the whole atlas with the clear color once, so gutter texels
    // between packed cells average the same way the in-cell background does.
    finalTarget.viewport.set(0, 0, size, size);
    finalTarget.scissor.set(0, 0, size, size);
    webgl.setRenderTarget(finalTarget);
    webgl.clear(true, false, false);

    archetypes.forEach((arch, ai) => {
      while (holder.children.length > 0) holder.remove(holder.children[0]);
      for (const part of arch.parts) {
        holder.add(new THREE.Mesh(part.geometry, bakeMaterialFor(part.material, part.isLeaf)));
      }
      const minY = arch.minY;
      const height = arch.height;
      const radius = arch.width / 2;
      camera.left = -radius;
      camera.right = radius;
      camera.top = minY + height;
      camera.bottom = minY;
      camera.near = 0.1;
      camera.far = radius * 4 + 1;
      camera.position.set(0, 0, radius * 2 + 0.5);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();

      const rect = placement.origin[ai];
      const cellPx = Math.round((rect.u1 - rect.u0) * size);
      const y0 = Math.round(rect.v0 * size);
      // the blit quad samples exactly the cell's corner of the scratch
      const uvScale = cellPx / maxCellPx;
      const uv = blitQuad.geometry.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (i % 2) * uvScale, i < 2 ? uvScale : 0);
      }
      uv.needsUpdate = true;
      for (let view = 0; view < arch.spec.views; view++) {
        // Bake convention: view k shows the model spun by +k/views turns,
        // i.e. the picture of the model seen from bearing -k. The draw
        // shader's rel angle inverts the same way (impRel below); a sign
        // slip here mirrors every sprite's view ring, verified against live
        // captures.
        holder.rotation.y = (view / arch.spec.views) * Math.PI * 2;
        holder.updateMatrixWorld(true);
        scratch.viewport.set(0, 0, cellPx, cellPx);
        webgl.setRenderTarget(scratch);
        webgl.clear(true, true, false);
        webgl.render(scene, camera);
        const x0 = Math.round(rect.u0 * size) + view * cellPx;
        finalTarget.viewport.set(x0, y0, cellPx, cellPx);
        finalTarget.scissor.set(x0, y0, cellPx, cellPx);
        webgl.setRenderTarget(finalTarget);
        webgl.render(blitScene, blitCam);
      }
    });

    // Every cell is in place: build the mip chain exactly once. Three
    // regenerates mips for a bound target at the end of render(), gated on
    // texture.generateMipmaps, so flip it on and run one empty pass.
    finalTarget.texture.generateMipmaps = true;
    finalTarget.viewport.set(0, 0, size, size);
    finalTarget.scissor.set(0, 0, size, size);
    finalTarget.scissorTest = false;
    webgl.setRenderTarget(finalTarget);
    webgl.render(new THREE.Scene(), blitCam);
    done = true;
  } finally {
    // Restore the live renderer whatever happened: a mid-bake throw must not
    // leave the frame loop with a foreign clear color or autoClear off.
    webgl.setRenderTarget(prevTarget);
    webgl.setClearColor(prevClearColor, prevClearAlpha);
    webgl.autoClear = prevAutoClear;
    blitQuad.geometry.dispose();
    blitMat.dispose();
    scratch.dispose();
    for (const mat of bakeMaterialCache.values()) mat.dispose();
    bakeMaterialCache.clear();
    if (!done) finalTarget.dispose();
  }

  return { target: finalTarget, rects: placement.origin, size };
}

// ---------------------------------------------------------------------------
// Draw material
// ---------------------------------------------------------------------------

// One unit quad shared by every impostor mesh: x centered, base at y 0, up
// normals so the live standard-material lighting gives the sprite the ground plane's
// response (see the module header).
let quadGeo: THREE.BufferGeometry | null = null;
function impostorQuadGeo(): THREE.BufferGeometry {
  if (quadGeo) return quadGeo;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0]);
  const nrm = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uv = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  quadGeo = geo;
  return geo;
}

// The same travelling gust the canopies ride (addWind in foliage.ts, its
// second use): amplitude parity keeps a tree's sway continuous across the
// handoff instead of freezing at the swap line.
const IMPOSTOR_WIND_GLSL = `
  float windPhase = collapseOrigin.x * 0.15 + collapseOrigin.y * 0.17;
  float windGust = 0.6 + 0.4 * sin(uTime * 0.6 + collapseOrigin.x * 0.05 + collapseOrigin.y * 0.04);
  float windAmt = (sin(uTime * 1.7 + windPhase) + 0.5 * sin(uTime * 3.1 + windPhase * 1.3))
    * windGust * uImpWind * aImpostorWind * smoothstep(0.0, 0.15, position.y);`;

const materialCache = new Map<ImpostorCategory, THREE.MeshStandardMaterial>();

// The one live atlas target. A same-session world rebuild bakes a fresh one;
// the previous target must be released (texture AND framebuffer, which only
// WebGLRenderTarget.dispose frees) or each rebuild leaks GPU pages.
let liveAtlas: THREE.WebGLRenderTarget | null = null;

function adoptAtlas(target: THREE.WebGLRenderTarget): void {
  if (liveAtlas && liveAtlas !== target) liveAtlas.dispose();
  liveAtlas = target;
}

function impostorMaterial(category: ImpostorCategory, atlas: THREE.Texture): THREE.Material {
  const cached = materialCache.get(category);
  if (cached) {
    cached.map = atlas;
    return cached;
  }
  const u = collapseWindowUniforms();
  const swap =
    category === 'rock'
      ? u.uRockMax
      : category === 'dress'
        ? u.uDressMax
        : category === 'building'
          ? u.uBuildingMax
          : u.uTreeMax;
  // Standard, matching the real foliage materials: the sprites must take
  // the same realm IBL irradiance their 3D twins take, or their shaded
  // sides read darker than the trees they replace.
  const mat = new THREE.MeshStandardMaterial({
    map: atlas,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    fog: true,
    roughness: 0.95,
    metalness: 0,
  });
  mat.name = `foliage:impostor-${category}`;
  // Amplitude policy per category (CATEGORY_WIND): sway parity for the
  // things that sway, hard zero for the rigid kit (rocks, buildings). The
  // sway direction is world-fixed here where the real mesh sways in its
  // rotated model frame: an accepted approximation, sub-pixel at every
  // sprite distance.
  const windStrength = GFX.windSway ? CATEGORY_WIND[category] : 0;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uImpSwap = swap;
    shader.uniforms.uImpFade = u.uFade;
    shader.uniforms.uImpSpriteFar = u.uSpriteFar;
    shader.uniforms.uImpSinkStart = u.uFogCull;
    shader.uniforms.uImpViews = { value: CATEGORY_VIEWS[category] };
    shader.uniforms.uImpWind = { value: windStrength };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uImpSwap;
        uniform float uImpFade;
        uniform float uImpSpriteFar;
        uniform float uImpViews;
        uniform float uImpWind;
        uniform float uImpSinkStart;
        attribute vec4 aImpostorCell;
        attribute float aImpostorWind;
        attribute float aImpostorSink;
        varying vec2 vImpUvA;
        varying vec2 vImpUvB;
        varying float vImpBlend;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 impOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        vec2 collapseOrigin = impOrigin.xz;
        float impDist = distance(collapseOrigin, cameraPosition.xz);
        float impJitter = ${IMPOSTOR_JITTER_GLSL};
        float impBegin = uImpSwap - uImpFade * impJitter;
        float impKeep = step(impBegin, impDist) * (1.0 - step(uImpSpriteFar, impDist));
        if (impKeep == 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        float impSx = length(instanceMatrix[0].xyz);
        float impSy = length(instanceMatrix[1].xyz);
        float impSz = max(length(instanceMatrix[2].xyz), 1e-6);
        float impYaw = atan(-instanceMatrix[0].z, instanceMatrix[0].x);
        vec2 impToCam = cameraPosition.xz - collapseOrigin;
        // bearing of the camera as seen from the instance, same wrap as the bake
        float impViewAng = atan(impToCam.x, impToCam.y);
        float impRel = fract((impYaw - impViewAng) / 6.2831853 + 1.0);
        float impViewPos = impRel * uImpViews;
        float impV0 = floor(impViewPos);
        vImpBlend = impViewPos - impV0;
        float impV1 = impV0 + 1.0;
        if (impV1 >= uImpViews) impV1 = 0.0;
        float impCellW = aImpostorCell.z;
        float impCellH = aImpostorCell.w;
        vImpUvA = vec2(aImpostorCell.x + (impV0 + uv.x) * impCellW, aImpostorCell.y + uv.y * impCellH);
        vImpUvB = vec2(aImpostorCell.x + (impV1 + uv.x) * impCellW, aImpostorCell.y + uv.y * impCellH);
        vec3 impFwd = vec3(impToCam.x, 0.0, impToCam.y) / max(impDist, 1e-4);
        vec3 impRight = normalize(cross(vec3(0.0, 1.0, 0.0), impFwd));
        vec3 impOff = impRight * (position.x * impSx) + vec3(0.0, 1.0, 0.0) * (position.y * impSy);
        // Past the detail envelope the ground under a sprite is the coarse
        // far-tile mesh, which can sit below the true heightfield, so far
        // sprites ease down by their own precomputed shortfall plus a small
        // universal settle (a distant tree buried 2u reads planted; a tree
        // floating 2u reads broken, so the bias runs downhill). Zero
        // anywhere real geometry could stand next to them, so the handoff
        // stays exact.
        impOff.y -= (aImpostorSink + 2.0) * clamp((impDist - uImpSinkStart) / 240.0, 0.0, 1.0);
        ${IMPOSTOR_WIND_GLSL}
        impOff.x += windAmt;
        impOff.z += windAmt * 0.6;
        // undo the instance rotation and scale so the stock instancing chunk
        // (project_vertex applies instanceMatrix) lands the quad exactly on
        // the billboarded world offsets computed above
        float impC = cos(impYaw);
        float impS = sin(impYaw);
        vec3 transformed = vec3(impC * impOff.x - impS * impOff.z, impOff.y, impS * impOff.x + impC * impOff.z)
          / vec3(impSx, impSy, impSz);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vImpUvA;
        varying vec2 vImpUvB;
        varying float vImpBlend;`,
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec4 impA = texture2D( map, vImpUvA );
          vec4 impB = texture2D( map, vImpUvB );
          diffuseColor *= mix( impA, impB, vImpBlend );
        }`,
      );
  };
  mat.customProgramCacheKey = () => `foliage-impostor-${CATEGORY_VIEWS[category]}`;
  materialCache.set(category, mat);
  return mat;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const scratchMatrix = new THREE.Matrix4();
const scratchQuat = new THREE.Quaternion();
const scratchPos = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchColor = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export function createImpostorSession(): ImpostorSession | null {
  if (!impostorsActive()) return null;
  const archetypes: Archetype[] = [];
  const archetypeIndex = new Map<string, number>();
  const buckets: BucketAcc[] = [];

  const categoryRows: Record<ImpostorCategory, number> = {
    tree: 0,
    rock: 0,
    dress: 0,
    building: 0,
  };

  return {
    registerArchetype(category, key, parts, windMul = 1) {
      const cacheKey = `${category}:${key}`;
      const existing = archetypeIndex.get(cacheKey);
      if (existing !== undefined) return existing;
      // The row budget is what the atlas capacity test packs
      // (shippedImpostorInventory): a kit outgrowing it must fail HERE,
      // loudly at world build, never by silently outgrowing the verified
      // 2048 atlas into a runtime pack throw.
      if (categoryRows[category] >= IMPOSTOR_ROW_BUDGET[category]) {
        throw new Error(
          `impostor ${category} rows exceed IMPOSTOR_ROW_BUDGET (${IMPOSTOR_ROW_BUDGET[category]}); raise the budget and re-verify the atlas fits IMPOSTOR_ATLAS_BUDGET`,
        );
      }
      categoryRows[category]++;
      const { minY, height, radius } = archetypeBounds(parts);
      const index = archetypes.length;
      archetypes.push({
        spec: {
          id: cacheKey,
          worldWidth: radius * 2,
          worldHeight: height,
          worldBaseY: minY,
          views: CATEGORY_VIEWS[category],
          cellPx: IMPOSTOR_CELL_PX[category],
        },
        parts,
        minY,
        height,
        width: radius * 2,
        windMul,
      });
      archetypeIndex.set(cacheKey, index);
      return index;
    },

    bucket(category, x, z, radius) {
      const acc: BucketAcc = { category, x, z, radius, items: [] };
      buckets.push(acc);
      return {
        add(archetype, ax, ay, az, yaw, scale, heightJitter, tint) {
          const arch = archetypes[archetype];
          acc.items.push({
            archetype,
            x: ax,
            y: ay + arch.minY * scale * heightJitter,
            z: az,
            yaw,
            width: arch.width * scale,
            height: arch.height * scale * heightJitter,
            tint: tint.r,
            tintG: tint.g,
            tintB: tint.b,
            windScale: scale,
          });
        },
      };
    },

    finalize(webgl, parent, seed) {
      if (archetypes.length === 0) return [];
      const { target, rects } = bakeAtlas(webgl, archetypes);
      adoptAtlas(target);
      const texture = target.texture;
      const registrations: ImpostorRegistration[] = [];
      // Session-scoped shortfall sampler: seed, spacing and origin fix at
      // finalize, so a world rebuild or tier change can never reuse a stale
      // corner surface (createFarShortfallSampler holds the cache law).
      const vista = activeFarFieldPolicy().vista;
      const shortfall = vista.enabled
        ? createFarShortfallSampler(
            seed,
            vista.spacing,
            WORLD_MIN_X - FAR_WORLD_MARGIN,
            WORLD_MIN_Z - FAR_WORLD_MARGIN,
          )
        : null;
      // One mesh per CATEGORY for the whole world, not per bucket: sprites
      // run to the view horizon now (the outdoor fog is gone), so nearly
      // every bucket row would be live anyway and the merge turns ~90 draws
      // into 3. The per-instance shader windows are the real cull; the
      // merged row's registry entry only sheds the whole layer when the
      // camera leaves the world (an interior).
      const merged = new Map<
        ImpostorCategory,
        { items: SpriteInstance[]; minX: number; maxX: number; minZ: number; maxZ: number }
      >();
      for (const acc of buckets) {
        if (acc.items.length === 0) continue;
        let entry = merged.get(acc.category);
        if (!entry) {
          entry = {
            items: [],
            minX: Infinity,
            maxX: -Infinity,
            minZ: Infinity,
            maxZ: -Infinity,
          };
          merged.set(acc.category, entry);
        }
        entry.items.push(...acc.items);
        entry.minX = Math.min(entry.minX, acc.x - acc.radius);
        entry.maxX = Math.max(entry.maxX, acc.x + acc.radius);
        entry.minZ = Math.min(entry.minZ, acc.z - acc.radius);
        entry.maxZ = Math.max(entry.maxZ, acc.z + acc.radius);
      }
      for (const [category, entry] of merged) {
        const { items } = entry;
        const geo = impostorQuadGeo().clone();
        const mesh = new THREE.InstancedMesh(
          geo,
          impostorMaterial(category, texture),
          items.length,
        );
        mesh.name = `foliage-impostor-${category}`;
        const cell = new Float32Array(items.length * 4);
        const wind = new Float32Array(items.length);
        const sink = new Float32Array(items.length);
        let maxHeight = 0;
        items.forEach((item, i) => {
          scratchQuat.setFromAxisAngle(UP, item.yaw);
          scratchMatrix.compose(
            scratchPos.set(item.x, item.y, item.z),
            scratchQuat,
            scratchScale.set(item.width, item.height, 1),
          );
          mesh.setMatrixAt(i, scratchMatrix);
          mesh.setColorAt(i, scratchColor.setRGB(item.tint, item.tintG, item.tintB));
          const arch = archetypes[item.archetype];
          const rect = rects[item.archetype];
          cell[i * 4] = rect.u0;
          cell[i * 4 + 1] = rect.v0;
          cell[i * 4 + 2] = rect.u1 - rect.u0;
          cell[i * 4 + 3] = rect.v1 - rect.v0;
          wind[i] = item.windScale * arch.windMul;
          sink[i] = shortfall ? shortfall.shortfall(item.x, item.z, item.y) : 0;
          maxHeight = Math.max(maxHeight, item.height, arch.width * 0.5);
        });
        geo.setAttribute('aImpostorCell', new THREE.InstancedBufferAttribute(cell, 4));
        geo.setAttribute('aImpostorWind', new THREE.InstancedBufferAttribute(wind, 1));
        geo.setAttribute('aImpostorSink', new THREE.InstancedBufferAttribute(sink, 1));
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.computeBoundingSphere();
        if (mesh.boundingSphere) mesh.boundingSphere.radius += maxHeight;
        parent.add(mesh);
        registrations.push({
          mesh,
          x: (entry.minX + entry.maxX) / 2,
          z: (entry.minZ + entry.maxZ) / 2,
          radius: Math.hypot(entry.maxX - entry.minX, entry.maxZ - entry.minZ) / 2 + 20,
          category,
        });
      }
      return registrations;
    },
  };
}

/**
 * One 1-instance mesh per impostor material for the shader prewarm pass
 * (buildFoliageMaterialPrewarmGroup in foliage.ts): links the exact programs
 * the live buckets use, attributes included. Empty when the sprite arm is
 * off or the atlas has not been baked yet.
 */
export function impostorPrewarmMeshes(): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const mat of materialCache.values()) {
    const mesh = new THREE.InstancedMesh(impostorQuadGeo().clone(), mat, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.geometry.setAttribute(
      'aImpostorCell',
      new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 0.1, 0.1]), 4),
    );
    mesh.geometry.setAttribute(
      'aImpostorWind',
      new THREE.InstancedBufferAttribute(new Float32Array([1]), 1),
    );
    mesh.geometry.setAttribute(
      'aImpostorSink',
      new THREE.InstancedBufferAttribute(new Float32Array([0]), 1),
    );
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    out.push(mesh);
  }
  return out;
}
