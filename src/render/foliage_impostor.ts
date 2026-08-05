// Far-foliage sprite impostors: the Three side.
//
// At world build time this module bakes every foliage archetype (each tree
// species variant, each rock colorway variant, the bush kinds) into one
// texture atlas by rendering the REAL extracted GLB parts from a ring of yaw
// angles under a neutral hemisphere rig. The far field then draws one
// InstancedMesh of camera-facing quads per (bucket, category): each instance
// picks the two atlas views bracketing its camera bearing (offset by its own
// placement yaw, so a forest never shows one repeated silhouette) and blends
// them, so orbiting the camera never snaps. Lighting is the live Lambert
// pipeline over a shading normal that leans off vertical toward the camera
// and fans across the card (IMPOSTOR_NORMAL_GLSL in foliage_impostor_core.ts),
// so a sprite keeps the terrain's response to day-night grades, biome light
// and fog while still lighting one side and shading the other the way the
// real tree it replaces does.
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
import { FAR_MESH_DROP, FAR_WORLD_MARGIN, farVertexHeight, farVistaPlan } from './far_terrain_core';
import { collapseWindowUniforms } from './foliage_collapse';
import {
  CANOPY_EMISSIVE_FLOOR,
  IMPOSTOR_ATLAS_MAX,
  IMPOSTOR_JITTER_GLSL,
  IMPOSTOR_NORMAL_GLSL,
  type ImpostorArchetypeSpec,
  type ImpostorCellRect,
  packImpostorAtlas,
} from './foliage_impostor_core';
import { GFX, sharedUniforms } from './gfx';

export type ImpostorCategory = 'tree' | 'rock' | 'dress' | 'building';

const CATEGORY_VIEWS: Record<ImpostorCategory, number> = {
  tree: 12,
  rock: 6,
  dress: 8,
  building: 6,
};

function categoryCellPx(category: ImpostorCategory): number {
  const scale = GFX.constrainedMemory ? 0.5 : 1;
  const base = category === 'tree' ? 128 : category === 'building' ? 96 : 64;
  return Math.max(32, Math.round(base * scale));
}

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
  registerArchetype(category: ImpostorCategory, key: string, parts: BakePart[]): number;
  bucket(category: ImpostorCategory, x: number, z: number, radius: number): ImpostorBucketHandle;
  finalize(webgl: THREE.WebGLRenderer, parent: THREE.Group, seed: number): ImpostorRegistration[];
}

/** Sprites ship on the same arm the cone impostors did. */
export function impostorsActive(): boolean {
  return GFX.standardMaterials && !GFX.leanFoliage;
}

// ---------------------------------------------------------------------------
// Bake
// ---------------------------------------------------------------------------

// Neutral, yaw-agnostic studio rig: a hemisphere gives the bake its top-down
// volume (canopy crowns brighter than skirts) without stamping a sun
// direction into a sprite that must read correctly from every bearing at
// every hour. The PI factor cancels Lambert's 1/PI: the bake material writes
// albedo x irradiance / PI, and the atlas is then bound as a MAP and lit
// again by the live shading, so without the cancellation the sprite pays the
// 1/PI twice and lands about 3x darker than the real tree it replaces.
const BAKE_SKY = 1.15 * Math.PI;
const BAKE_GROUND = 0.62 * Math.PI;

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
    GFX.constrainedMemory ? 2048 : IMPOSTOR_ATLAS_MAX,
  );
  const size = placement.size;

  const bakeTarget = new THREE.WebGLRenderTarget(size, size, {
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

  // The mip-mapped resolve the sprites sample; created up front so the
  // finally arm can dispose it on a mid-bake throw.
  const finalTarget = new THREE.WebGLRenderTarget(size, size, {
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  finalTarget.texture.anisotropy = Math.min(4, webgl.capabilities.getMaxAnisotropy());

  let done = false;
  try {
    // Cell addressing goes through the TARGET's viewport/scissor: with a
    // render target bound, three ignores the renderer-level setViewport (that
    // state belongs to the canvas) and reads renderTarget.viewport each
    // render call. The clear alpha is 0 (the alpha test carves sprites from
    // it) but the clear RGB is a mid-canopy green: the MSAA resolve and the
    // mip chain average edge texels toward the clear color, so distant
    // sprites (deep mips are mostly such averages) tint toward foliage
    // instead of collapsing to near-black silhouettes.
    bakeTarget.scissorTest = true;
    webgl.setClearColor(0x86a868, 0);
    webgl.autoClear = false;

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
      for (let view = 0; view < arch.spec.views; view++) {
        // Bake convention: view k shows the model spun by +k/views turns,
        // i.e. the picture of the model seen from bearing -k. The draw
        // shader's rel angle inverts the same way (impRel below); a sign
        // slip here mirrors every sprite's view ring, verified against live
        // captures.
        holder.rotation.y = (view / arch.spec.views) * Math.PI * 2;
        holder.updateMatrixWorld(true);
        const x0 = Math.round(rect.u0 * size) + view * cellPx;
        bakeTarget.viewport.set(x0, y0, cellPx, cellPx);
        bakeTarget.scissor.set(x0, y0, cellPx, cellPx);
        webgl.setRenderTarget(bakeTarget);
        webgl.clear(true, true, false);
        webgl.render(scene, camera);
      }
    });

    // Resolve the multisampled bake into the plain mip-mapped texture and
    // drop the bake target (its depth buffer alone is size^2 * 4 bytes).
    const blitScene = new THREE.Scene();
    // transparent + NoBlending: a straight RGBA copy. A default opaque
    // material compiles with the OPAQUE define and force-writes alpha 1 over
    // the whole atlas, which turns every sprite into a full rectangle
    // downstream (the alpha test has nothing left to cut).
    const blitMat = new THREE.MeshBasicMaterial({
      map: bakeTarget.texture,
      toneMapped: false,
      transparent: true,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    const blitQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat);
    blitScene.add(blitQuad);
    const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    webgl.setRenderTarget(finalTarget);
    webgl.clear(true, false, false);
    webgl.render(blitScene, blitCam);
    blitQuad.geometry.dispose();
    blitMat.dispose();
    done = true;
  } finally {
    // Restore the live renderer whatever happened: a mid-bake throw must not
    // leave the frame loop with a foreign clear color or autoClear off.
    webgl.setRenderTarget(prevTarget);
    webgl.setClearColor(prevClearColor, prevClearAlpha);
    webgl.autoClear = prevAutoClear;
    bakeTarget.dispose();
    for (const mat of bakeMaterialCache.values()) mat.dispose();
    bakeMaterialCache.clear();
    if (!done) finalTarget.dispose();
  }

  return { target: finalTarget, rects: placement.origin, size };
}

// ---------------------------------------------------------------------------
// Draw material
// ---------------------------------------------------------------------------

// One unit quad shared by every impostor mesh: x centered, base at y 0. The
// stored normals are placeholders the vertex stage overwrites per instance
// (IMPOSTOR_NORMAL_GLSL), since the shading normal depends on where the
// camera stands, not on the quad.
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
  //
  // vertexColors STAYS OFF, and the per-instance tint still applies. three
  // derives USE_INSTANCING_COLOR from the mesh owning an instanceColor (see
  // instancingColor in WebGLPrograms), never from this flag, and its fragment
  // side defines USE_COLOR from that same instancing path, so setColorAt
  // reaches diffuseColor either way. Turning the flag ON is what broke: it
  // defines USE_COLOR in the VERTEX prefix too, and there `color_vertex` runs
  // `vColor *= color` against a `color` attribute the impostor quad does not
  // have. An unbound attribute reads (0, 0, 0), which zeroed vColor and with
  // it every sprite's whole diffuse term. What was left to draw was the
  // canopy emissive floor plus a specular lobe, neither of which is
  // multiplied by diffuseColor: a flat cutout, one colour, unable to react to
  // the sun at any hour, warm and washed out under a low sun because the
  // specular alone carried the light's colour. Pinned by
  // tests/foliage_impostor_core.test.ts.
  const mat = new THREE.MeshStandardMaterial({
    map: atlas,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    fog: true,
    roughness: 0.95,
    metalness: 0,
  });
  mat.name = `foliage:impostor-${category}`;
  // The canopy ambient floor the real trees carry (foliage.ts), shaped by
  // the same atlas texel in the fragment patch below. Without it a sprite is
  // the only tree in the scene with no floor and crushes to a pure black
  // silhouette at night. Foliage categories only: rocks and buildings do not
  // carry the floor in their real form either.
  if (category === 'tree' || category === 'dress') {
    mat.emissive.setRGB(...CANOPY_EMISSIVE_FLOOR);
  }
  // Amplitude parity with addWind in foliage.ts: TREE_WIND_STRENGTH 0.08
  // times the kit's windMul (1.0 leaves, 1.2 bushes). The sway direction is
  // world-fixed here where the real mesh sways in its rotated model frame:
  // an accepted approximation, sub-pixel at every sprite distance. Rocks do
  // not wave in the real kit and take none.
  const windStrength =
    category === 'rock' || !GFX.windSway ? 0 : category === 'tree' ? 0.08 : 0.096;
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
        // The billboard basis is built HERE, a chunk earlier than the offsets
        // that consume it: three resolves the shading normal before
        // <begin_vertex> runs, so a normal written down there would never
        // reach the fragment stage. Culled instances now pay the basis before
        // <begin_vertex> drops them, a few ALU on a 2-triangle quad against
        // the fragment work the cull is actually there to save.
        '#include <beginnormal_vertex>',
        `vec3 impOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        vec2 collapseOrigin = impOrigin.xz;
        float impDist = distance(collapseOrigin, cameraPosition.xz);
        float impSx = length(instanceMatrix[0].xyz);
        float impSy = length(instanceMatrix[1].xyz);
        float impSz = max(length(instanceMatrix[2].xyz), 1e-6);
        float impYaw = atan(-instanceMatrix[0].z, instanceMatrix[0].x);
        // The yaw's cosine and sine come straight off the normalized first
        // column, which a Y rotation stores as (cos, 0, -sin) times the x
        // scale. Exact, one divide cheaper than a cos and a sin, and immune
        // to the half turn SwiftShader returns from atan(-0.0, positive):
        // that lands an axis-aligned instance's normal facing backwards.
        float impC = instanceMatrix[0].x / impSx;
        float impS = -instanceMatrix[0].z / impSx;
        vec2 impToCam = cameraPosition.xz - collapseOrigin;
        vec3 impFwd = vec3(impToCam.x, 0.0, impToCam.y) / max(impDist, 1e-4);
        vec3 impRight = normalize(cross(vec3(0.0, 1.0, 0.0), impFwd));
        ${IMPOSTOR_NORMAL_GLSL}
        // The offsets below un-rotate and DIVIDE by the instance scale so the
        // stock instancing chunk lands them where the billboard math put
        // them. A normal takes the mirror of that: the stock chunk divides
        // each component by its column length squared before applying
        // mat3(instanceMatrix), which nets out to dividing a normal by the
        // scale where a position is multiplied by it. So un-rotate the same
        // way and MULTIPLY, and impNormal survives into world space intact.
        vec3 objectNormal = vec3(impC * impNormal.x - impS * impNormal.z, impNormal.y,
          impS * impNormal.x + impC * impNormal.z) * vec3(impSx, impSy, impSz);`,
      )
      .replace(
        '#include <begin_vertex>',
        `float impJitter = ${IMPOSTOR_JITTER_GLSL};
        float impBegin = uImpSwap - uImpFade * impJitter;
        float impKeep = step(impBegin, impDist) * (1.0 - step(uImpSpriteFar, impDist));
        if (impKeep == 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
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
        vec3 transformed = vec3(impC * impOff.x - impS * impOff.z, impOff.y, impS * impOff.x + impC * impOff.z)
          / vec3(impSx, impSy, impSz);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vImpUvA;
        varying vec2 vImpUvB;
        varying float vImpBlend;
        vec4 impTexel;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        #ifdef DOUBLE_SIDED
          // The vertex stage authors this normal in camera terms, so it is
          // already correct for whichever face the rasterizer keeps; the
          // double-sided chunk's flip would aim it away from the camera and
          // invert the lit and shaded sides. faceDirection squared undoes it.
          normal *= faceDirection;
        #endif`,
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec4 impA = texture2D( map, vImpUvA );
          vec4 impB = texture2D( map, vImpUvB );
          impTexel = mix( impA, impB, vImpBlend );
          diffuseColor *= impTexel;
        }`,
      )
      .replace(
        // Drop the specular lobe. It is the one term here that never
        // multiplies the atlas texel, so on a flat card carrying a single
        // smooth synthetic normal it lands as a uniform sheet of the light's
        // own colour and no sprite texture survives it. A real canopy spreads
        // the same energy over thousands of leaf orientations, so it never
        // forms a card-sized highlight. Measured against a real twin: under a
        // high sun with the camera facing it the lobe was 38 percent of the
        // sprite's pixel and left the sprite 2.2x brighter than the tree it
        // replaces; dropping it brings that to 1.6x. At a low sun it is under
        // 5 percent, so dawn and dusk barely move, and the sprite layer (the
        // most pixels in the far field) saves a PMREM sample per fragment.
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        reflectedLight.directSpecular = vec3( 0.0 );
        reflectedLight.indirectSpecular = vec3( 0.0 );`,
      )
      .replace(
        // Shape the canopy ambient floor by the blended atlas texel, the
        // impostor equivalent of the real canopy's emissiveMap = leaf map
        // (the stock chunk would sample flat uv, not the per-view cells).
        // Categories with no floor have emissive = black, so this is free.
        '#include <emissivemap_fragment>',
        'totalEmissiveRadiance *= impTexel.rgb;',
      );
  };
  mat.customProgramCacheKey = () => `foliage-impostor-${CATEGORY_VIEWS[category]}`;
  materialCache.set(category, mat);
  return mat;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

// How far the coarse far-tile surface sits BELOW a sprite's true base: its
// safety drop plus the crest chord error of the tier's sampling grid,
// bilinearly reconstructed the way the far mesh itself samples. Sprites past
// the detail envelope ease down by this much so their bases stay planted on
// the vista instead of floating over shaved ridge crests.
const farCornerCache = new Map<string, number>();
function farCornerHeight(x: number, z: number, spacing: number, seed: number): number {
  const key = `${x}:${z}`;
  const cached = farCornerCache.get(key);
  if (cached !== undefined) return cached;
  const y = farVertexHeight(x, z, spacing, seed);
  farCornerCache.set(key, y);
  return y;
}

function farMeshShortfall(x: number, z: number, baseY: number, seed: number): number {
  const vista = farVistaPlan(GFX.tier, GFX.constrainedMemory);
  if (!vista.enabled) return 0;
  const spacing = vista.spacing;
  const originX = WORLD_MIN_X - FAR_WORLD_MARGIN;
  const originZ = WORLD_MIN_Z - FAR_WORLD_MARGIN;
  const x0 = originX + Math.floor((x - originX) / spacing) * spacing;
  const z0 = originZ + Math.floor((z - originZ) / spacing) * spacing;
  const tx = (x - x0) / spacing;
  const tz = (z - z0) / spacing;
  const h00 = farCornerHeight(x0, z0, spacing, seed);
  const h10 = farCornerHeight(x0 + spacing, z0, spacing, seed);
  const h01 = farCornerHeight(x0, z0 + spacing, spacing, seed);
  const h11 = farCornerHeight(x0 + spacing, z0 + spacing, spacing, seed);
  const farY = (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  return Math.max(0, baseY - (farY - FAR_MESH_DROP));
}

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

  return {
    registerArchetype(category, key, parts) {
      const cacheKey = `${category}:${key}`;
      const existing = archetypeIndex.get(cacheKey);
      if (existing !== undefined) return existing;
      const { minY, height, radius } = archetypeBounds(parts);
      const index = archetypes.length;
      archetypes.push({
        spec: {
          id: cacheKey,
          worldWidth: radius * 2,
          worldHeight: height,
          worldBaseY: minY,
          views: CATEGORY_VIEWS[category],
          cellPx: categoryCellPx(category),
        },
        parts,
        minY,
        height,
        width: radius * 2,
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
          wind[i] = item.windScale;
          sink[i] = farMeshShortfall(item.x, item.z, item.y, seed);
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
