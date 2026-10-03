// The spirit veil: how every translucent character look is drawn, a released
// spirit (a dead player, `e.ghost`) first, then each user in its palette
// (spirit_veil_palette_core.ts).
//
// Every rig material of the ghost is replaced by ONE unlit spectral material
// (a MeshBasicMaterial carrying only the source map, with a constant program
// key), drawn in a single blended pass for both faces, over a depth-only
// pre-pass of the same rig so only the nearest ghost surface blends: no face
// floating inside the head shell, no arm through the chest. Every ghost of
// every class, look and tier lands on the small program family that
// spirit_veil_family_core.ts pins and spirit_veil_prewarm.ts links at boot,
// instead of a lit transparent twin per rig material and face side, so no
// death links a program live.
//
// Per mesh SHAPE, never shared across shapes: three stores a material's
// program parameters per material and re-derives them whenever the object it
// draws differs in shape (skinning, morph count), and a re-derivation after
// the light counts drifted mints a new program. The colour material is one per
// (source material, shape), cached by the visual; the depth material one per
// shape, here.
//
// The face decals (stubble, scalp hair, makeup) are transparent and write no
// depth: they wear an alpha-preserving variant of the colour material that
// keeps their mask, drawn after the veiled head, and get no depth sibling.
//
// Every veil user wears a palette (spirit_veil_palette_core.ts): uniform
// values on these same programs. The colour pass also carries its source's
// colour and outfit dye (armor_dye.ts, count 0 when undyed) for the palettes
// that keep some of the rig's own colours.

import * as THREE from 'three';
import { sharedUniforms } from '../gfx';
import {
  ARMOR_DYE_GLSL_PARS,
  type ArmorDyeSpec,
  armorDyeRemapGlsl,
  armorDyeUniformValues,
} from './armor_dye';
import {
  createSpiritVeilSortUnit,
  createSpiritVeilTransparentSort,
  SPIRIT_VEIL_FAMILY_KEYS,
  SPIRIT_VEIL_PASS_KEY,
  SPIRIT_VEIL_UNIT_KEY,
  type SpiritVeilPass,
  type SpiritVeilShape,
  type SpiritVeilSortUnit,
  spiritVeilKeysLinked,
  spiritVeilShapeOf,
  spiritVeilTupleKey,
} from './spirit_veil_family_core';
import { SPIRIT_VEIL_PALETTES, type SpiritVeilPalette } from './spirit_veil_palette_core';

/** A released spirit's look. */
export const SPIRIT_VEIL_LOOK = SPIRIT_VEIL_PALETTES.spirit;

let motionAllowed: () => boolean = () => true;

// The one world clock, frozen under reduced motion (the shimmer and the
// rising bands are the only motion the veil adds).
const veilTime = {
  get value(): number {
    return motionAllowed() ? sharedUniforms.uTime.value : 0;
  },
};

interface PaletteUniforms {
  uVeilTint: { value: THREE.Color };
  uVeilDeep: { value: THREE.Color };
  uVeilRim: { value: THREE.Color };
  uVeilRimStrength: { value: number };
  uVeilOpacity: { value: number };
  uVeilRise: { value: number };
  uVeilShimmer: { value: number };
  uVeilKeepColor: { value: number };
  uVeilBand: { value: number };
}

const paletteUniformSets = new Map<SpiritVeilPalette, PaletteUniforms>();

/** One uniform set per palette, shared by every material of that palette. */
function paletteUniforms(palette: SpiritVeilPalette): PaletteUniforms {
  let set = paletteUniformSets.get(palette);
  if (!set) {
    const p = SPIRIT_VEIL_PALETTES[palette];
    set = {
      uVeilTint: { value: new THREE.Color(p.tint) },
      uVeilDeep: { value: new THREE.Color(p.deep) },
      uVeilRim: { value: new THREE.Color(p.rim) },
      uVeilRimStrength: { value: p.rimStrength },
      uVeilOpacity: { value: p.opacity },
      uVeilRise: { value: p.rise },
      uVeilShimmer: { value: p.shimmer },
      uVeilKeepColor: { value: p.keepColor },
      uVeilBand: { value: p.band },
    };
    paletteUniformSets.set(palette, set);
  }
  return set;
}

interface DyeUniforms {
  uDyeA: { value: number[] };
  uDyeB: { value: number[] };
  uDyeC: { value: number[] };
  uDyeD: { value: number[] };
  uDyeCount: { value: number };
}

function dyeUniforms(spec: ArmorDyeSpec | null): DyeUniforms {
  const u = armorDyeUniformValues(spec);
  return {
    uDyeA: { value: u.a },
    uDyeB: { value: u.b },
    uDyeC: { value: u.c },
    uDyeD: { value: u.d },
    uDyeCount: { value: u.n },
  };
}

const UNDYED = dyeUniforms(null);

/** The source's outfit dye, where the source's own shader runs it: only the
 *  standard arm carries the spec (armor_dye.ts reapplyArmorDyeToClone). The
 *  low tier's Lambert rebuild has none, its flat stand-in rides `color`. */
function sourceDye(source: THREE.Material): DyeUniforms {
  if (!(source as THREE.MeshStandardMaterial).isMeshStandardMaterial) return UNDYED;
  const spec = (source.userData as { armorDye?: ArmorDyeSpec }).armorDye;
  return spec ? dyeUniforms(spec) : UNDYED;
}

// Both passes replay the same shimmer so the colour pass lands on the depth
// the pre-pass wrote.
const VERT_SHIMMER = `
  #if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
    vec3 veilObjN = objectNormal;
  #else
    vec3 veilObjN = vec3( normal );
  #endif
  {
    vec4 veilW0 = modelMatrix * vec4( transformed, 1.0 );
    float veilS = max( length( modelMatrix[ 0 ].xyz ), 1e-4 );
    transformed += veilObjN * ( uVeilShimmer / veilS ) * sin( uVeilTime * 3.0 + veilW0.y * 7.0 );
  }
  #include <project_vertex>
`;

const COLOR_VERT_PARS = `
  uniform float uVeilTime;
  uniform float uVeilShimmer;
  varying vec3 vVeilN;
  varying vec3 vVeilV;
  varying float vVeilWY;
  varying float vVeilH;
`;

const COLOR_VERT_TAIL = `
  #include <fog_vertex>
  #if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
    vVeilN = normalize( transformedNormal );
  #else
    vVeilN = normalize( normalMatrix * vec3( normal ) );
  #endif
  vVeilV = -mvPosition.xyz;
  vVeilWY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;
  vVeilH = vVeilWY - modelMatrix[ 3 ].y;
`;

const COLOR_FRAG_PARS = `
  uniform float uVeilTime;
  uniform vec3 uVeilTint;
  uniform vec3 uVeilDeep;
  uniform vec3 uVeilRim;
  uniform float uVeilRimStrength;
  uniform float uVeilOpacity;
  uniform float uVeilRise;
  uniform float uVeilKeepColor;
  uniform float uVeilBand;
  uniform vec3 uVeilSrcColor;
  varying vec3 vVeilN;
  varying vec3 vVeilV;
  varying float vVeilWY;
  varying float vVeilH;
${ARMOR_DYE_GLSL_PARS}
`;

// At keepColor 0 the uniform branch is skipped and the body is exactly the
// monochrome veil; the true colour is the source's own (texel times its
// colour, then its dye), as its lit shader would compose it.
const COLOR_FRAG_BODY = `
  {
    vec3 veilN = normalize( vVeilN );
    veilN = gl_FrontFacing ? veilN : -veilN;
    float veilFres = pow( 1.0 - clamp( dot( veilN, normalize( vVeilV ) ), 0.0, 1.0 ), 2.0 );
    float veilLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
    float veilBand = 0.5 + 0.5 * sin( vVeilWY * 5.0 - uVeilTime * 2.2 );
    float veilRise = smoothstep( 0.0, uVeilRise, vVeilH );
    vec3 veilBody = mix( uVeilDeep, uVeilTint, clamp( 0.08 + veilLum * 1.9, 0.0, 1.0 ) );
    if ( uVeilKeepColor > 0.0 ) {
      vec3 veilTrue = diffuseColor.rgb * uVeilSrcColor;
      #ifndef SPIRIT_VEIL_DECAL
        ${armorDyeRemapGlsl('veilTrue')}
      #endif
      veilBody = mix( veilBody, veilTrue, uVeilKeepColor );
    }
    veilBody *= ( ( 1.0 - uVeilBand ) + uVeilBand * veilBand ) * ( 0.35 + 0.65 * veilRise );
    outgoingLight = veilBody + uVeilRim * uVeilRimStrength * veilFres;
    float veilAlpha = clamp( uVeilOpacity + ( 1.0 - uVeilOpacity ) * veilFres, 0.0, 1.0 );
    #ifdef SPIRIT_VEIL_DECAL
      diffuseColor.a *= veilAlpha;
    #else
      diffuseColor.a = veilAlpha;
    #endif
  }
`;

// Hooks stay idempotent and keep nothing of the shader object: the dry
// compile of the shader warm-up calls them once more on a throwaway one.
function veilColorHook(
  shader: THREE.WebGLProgramParametersWithUniforms,
  uniforms: Record<string, THREE.IUniform>,
): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = `${COLOR_VERT_PARS}\n${shader.vertexShader}`
    .replace('#include <project_vertex>', VERT_SHIMMER)
    .replace('#include <fog_vertex>', COLOR_VERT_TAIL);
  // The body lands right before the stock opaque write, which stays in place
  // so the final colour keeps its NaN guard (final_color_nan_guard.ts).
  shader.fragmentShader = `${COLOR_FRAG_PARS}\n${shader.fragmentShader}`.replace(
    '#include <envmap_fragment>',
    `#include <envmap_fragment>\n${COLOR_FRAG_BODY}`,
  );
}

function veilDepthHook(
  shader: THREE.WebGLProgramParametersWithUniforms,
  shimmer: { value: number },
): void {
  shader.uniforms.uVeilTime = veilTime;
  shader.uniforms.uVeilShimmer = shimmer;
  shader.vertexShader =
    `uniform float uVeilTime;\nuniform float uVeilShimmer;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      VERT_SHIMMER,
    );
}

const COLOR_PROGRAM_KEY = 'spirit-veil-color-v2';
const DECAL_PROGRAM_KEY = 'spirit-veil-decal-v2';
const DEPTH_PROGRAM_KEY = 'spirit-veil-depth-v2';
const colorProgramKey = (): string => COLOR_PROGRAM_KEY;
const decalProgramKey = (): string => DECAL_PROGRAM_KEY;
const depthProgramKey = (): string => DEPTH_PROGRAM_KEY;

type SourceMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  color?: THREE.Color;
};

const PALETTE_KEY = 'spiritVeilPalette';

/** three's WebGLShadowMap side for a caster with no shadowSide (PCF). */
const CASTER_SIDE: Record<THREE.Side, THREE.Side> = {
  [THREE.FrontSide]: THREE.BackSide,
  [THREE.BackSide]: THREE.FrontSide,
  [THREE.DoubleSide]: THREE.DoubleSide,
};

/** The pass a veil material draws, or null for any other material. */
export function spiritVeilPassOf(material: THREE.Material): SpiritVeilPass | null {
  return (material.userData[SPIRIT_VEIL_PASS_KEY] as SpiritVeilPass | undefined) ?? null;
}

/** The palette a veil material wears, or null for any other material. */
export function spiritVeilPaletteOf(material: THREE.Material): SpiritVeilPalette | null {
  return (material.userData[PALETTE_KEY] as SpiritVeilPalette | undefined) ?? null;
}

/**
 * The veil's colour material for one rig material. A transparent source (a
 * face decal: its mask is its shape) takes the alpha-preserving decal variant,
 * front faces only like the decals, keeping its polygon offset and its colour
 * so the hair colour still reads in the stipple; every other source becomes the body veil, white
 * over the source map so the tone comes from the texture, carrying a copy of
 * the source's colour and its dye for the palettes that keep them. Shape-free:
 * the caller caches one per (palette, source, shape).
 */
export function createSpiritVeilMaterial(
  source: THREE.Material,
  palette: SpiritVeilPalette = 'spirit',
): THREE.MeshBasicMaterial {
  const src = source as SourceMaterial;
  const decal = source.transparent === true;
  const mat = new THREE.MeshBasicMaterial({
    map: src.map ?? null,
    color: decal && src.color ? src.color.clone() : new THREE.Color(0xffffff),
    side: decal ? THREE.FrontSide : THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  mat.forceSinglePass = true;
  mat.name = decal ? 'spirit_veil_decal' : 'spirit_veil';
  if (decal) {
    mat.defines = { SPIRIT_VEIL_DECAL: '' };
    mat.polygonOffset = source.polygonOffset;
    mat.polygonOffsetFactor = source.polygonOffsetFactor;
    mat.polygonOffsetUnits = source.polygonOffsetUnits;
  }
  const uniforms: Record<string, THREE.IUniform> = {
    uVeilTime: veilTime,
    ...paletteUniforms(palette),
    // A decal already carries its colour on `color`, and has no dye.
    uVeilSrcColor: { value: !decal && src.color ? src.color.clone() : new THREE.Color(0xffffff) },
    ...(decal ? UNDYED : sourceDye(source)),
  };
  mat.onBeforeCompile = (shader) => veilColorHook(shader, uniforms);
  // A palette that keeps its shadow casts with the side three would give the
  // source's own caster, so the kept shadow culls the faces the living one did,
  // and a re-derivation of the shared depth material (side is one of its key
  // inputs) keys the variant the living rig linked.
  mat.shadowSide = source.shadowSide ?? CASTER_SIDE[source.side];
  mat.customProgramCacheKey = decal ? decalProgramKey : colorProgramKey;
  mat.userData[SPIRIT_VEIL_PASS_KEY] = decal ? 'decal' : 'color';
  mat.userData[PALETTE_KEY] = palette;
  return mat;
}

const depthMaterials = new Map<string, THREE.MeshBasicMaterial>();

/** The shared depth pre-pass material for one depth tuple key and palette
 *  (the pre-pass replays its colour pass's shimmer). Never disposed: every
 *  ghost of that shape and palette draws it, and the boot stand-in holds the
 *  program they all share. A small polygon offset keeps the colour pass's
 *  LessEqual test robust across the two programs. */
export function spiritVeilDepthMaterial(
  depthKey: string,
  palette: SpiritVeilPalette = 'spirit',
): THREE.MeshBasicMaterial {
  const cacheKey = `${palette}|${depthKey}`;
  let mat = depthMaterials.get(cacheKey);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      transparent: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    mat.forceSinglePass = true;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 1;
    mat.polygonOffsetUnits = 4;
    mat.name = `spirit_veil_depth_${depthKey}`;
    const { uVeilShimmer } = paletteUniforms(palette);
    mat.onBeforeCompile = (shader) => veilDepthHook(shader, uVeilShimmer);
    mat.customProgramCacheKey = depthProgramKey;
    mat.userData[SPIRIT_VEIL_PASS_KEY] = 'depth';
    mat.userData[PALETTE_KEY] = palette;
    depthMaterials.set(cacheKey, mat);
  }
  return mat;
}

/** The shape key a visual caches its colour materials under. */
export function spiritVeilShapeKey(mesh: THREE.Object3D): string {
  return spiritVeilTupleKey('depth', spiritVeilShapeOf(mesh as THREE.Mesh), false);
}

/** The tuple keys a draw of `material` on `mesh` needs linked: the colour or
 *  decal tuple, plus the depth tuple of the pre-pass for a body. Null for a
 *  material that is not a veil colour material. */
export function spiritVeilKeysFor(material: THREE.Material, mesh: THREE.Object3D): string[] | null {
  const pass = spiritVeilPassOf(material);
  if (pass !== 'color' && pass !== 'decal') return null;
  const shape: SpiritVeilShape = spiritVeilShapeOf(mesh as THREE.Mesh);
  const map = (material as SourceMaterial).map ?? null;
  const keys = [spiritVeilTupleKey(pass, shape, map !== null, map?.channel ?? 0)];
  if (pass === 'color') keys.push(spiritVeilTupleKey('depth', shape, false));
  return keys;
}

// --- the ledger: which tuples are linked on the current renderer ------------
//
// A tuple stands for one program only while the renderer-global key inputs
// hold still, and they do for a renderer's life: the light census is fixed
// (the point-light pads, and no other light is ever added after boot), the
// shadow state and the scene fog are set at construction, and the tier's
// target arm (canvas or composer) changes only with a renderer rebuild,
// which rebinds the ledger.

const linkedTuples = new Set<string>();
const reportedMisses = new Set<string>();
type LateLink = (keys: readonly string[]) => void;
let lateLink: LateLink | null = null;

export function spiritVeilTuplesLinked(keys: readonly string[]): boolean {
  return spiritVeilKeysLinked(keys, linkedTuples);
}

let ledgerOwner: object | null = null;

/** Recorded by a RESIDENT stand-in's settle only (the boot family or a late
 *  link): the stand-in keeps the program alive, so the entry stays true for
 *  the renderer's life. A settle from a renderer the ledger no longer belongs
 *  to (one retired by a graphics rebuild) records nothing. */
export function noteSpiritVeilTupleLinked(key: string, owner: object | null = ledgerOwner): void {
  if (owner !== ledgerOwner) return;
  linkedTuples.add(key);
}

/** A new renderer (a graphics rebuild, a new context) starts with nothing
 *  linked; the boot entry refills the ledger. */
export function resetSpiritVeilLedger(): void {
  linkedTuples.clear();
  ledgerOwner = null;
  lateLink = null;
}

/** Whether the ledger belongs to this renderer's program cache (null: to
 *  none, after a reset). */
export function spiritVeilLedgerOwnedBy(owner: object | null): boolean {
  return owner === ledgerOwner;
}

/** Tie the ledger to one renderer's program cache (its `properties`): binding
 *  a different one empties it, rebinding the same one keeps it. */
export function bindSpiritVeilLedger(owner: object): void {
  if (owner === ledgerOwner) return;
  resetSpiritVeilLedger();
  ledgerOwner = owner;
}

export function spiritVeilLedgerSize(): number {
  return linkedTuples.size;
}

/** Installed by the boot entry: links a stand-in of each tuple outside the
 *  family in the background, so the next ghost of that shape commits at once. */
export function setSpiritVeilLateLink(link: LateLink | null): void {
  lateLink = link;
}

/** A veil mounted before some of its tuples linked: staged behind the effect
 *  gate, or committed at once for a mark that is never deferred (Soul Rend),
 *  whose draw then links them. Named once per tuple on the dev channel; a
 *  tuple outside the pinned family is a census gap
 *  (tests/spirit_veil_census.test.ts). Either way the tuples are late-linked
 *  so the next veil of that shape commits at once. */
export function noteSpiritVeilMiss(keys: readonly string[], live = false): void {
  const unlinked = keys.filter((key) => !linkedTuples.has(key));
  const fresh = unlinked.filter((key) => !reportedMisses.has(key));
  for (const key of fresh) reportedMisses.add(key);
  if (fresh.length > 0) {
    const outside = fresh.filter((key) => !SPIRIT_VEIL_FAMILY_KEYS.has(key));
    const what = live
      ? 'committed a never-deferred veil unlinked'
      : 'staged a ghost behind the compile gate';
    console.warn(
      `[spirit-veil] ${what}: unlinked ${fresh.join(', ')}` +
        (outside.length > 0 ? `; outside the pinned family: ${outside.join(', ')}` : ''),
    );
  }
  if (unlinked.length > 0) lateLink?.(unlinked);
}

// --- the draw order and the clock --------------------------------------------

/** Wire the veil into the world renderer: the per-rig transparent sort and
 *  the reduced-motion switch the shimmer freezes under. */
export function installSpiritVeil(
  webgl: Pick<THREE.WebGLRenderer, 'info' | 'setTransparentSort'>,
  reducedMotion: () => boolean,
): void {
  motionAllowed = () => !reducedMotion();
  webgl.setTransparentSort(createSpiritVeilTransparentSort(() => webgl.info.render.frame));
}

// --- one rig ------------------------------------------------------------------

const DEPTH_SIBLING_NAME = 'spirit_veil_depth';

/** The pre-pass of a veiled body: its shape, its colour pass's palette. */
function depthMaterialFor(body: THREE.Mesh): THREE.MeshBasicMaterial {
  const mat = Array.isArray(body.material) ? body.material[0] : body.material;
  return spiritVeilDepthMaterial(
    spiritVeilShapeKey(body),
    (mat && spiritVeilPaletteOf(mat)) ?? 'spirit',
  );
}

function buildDepthSibling(body: THREE.Mesh): THREE.Mesh {
  const material = depthMaterialFor(body);
  const skinned = body as THREE.SkinnedMesh;
  let sibling: THREE.Mesh;
  if (skinned.isSkinnedMesh) {
    const s = new THREE.SkinnedMesh(body.geometry, material);
    s.bindMode = skinned.bindMode;
    // The bind matrix is passed, so three never recomputes the inverses of
    // the skeleton the body shares.
    s.bind(skinned.skeleton, skinned.bindMatrix);
    sibling = s;
  } else {
    sibling = new THREE.Mesh(body.geometry, material);
  }
  sibling.name = DEPTH_SIBLING_NAME;
  sibling.castShadow = false;
  sibling.receiveShadow = false;
  sibling.raycast = () => {};
  sibling.userData[SPIRIT_VEIL_PASS_KEY] = 'depth';
  return sibling;
}

/** Keep a sibling on its body's cull and morph state: it is culled exactly
 *  when the body is, and replays the body's live face and blink morphs. */
function followBody(sibling: THREE.Mesh, body: THREE.Mesh): void {
  sibling.frustumCulled = body.frustumCulled;
  sibling.layers.mask = body.layers.mask;
  const skinnedBody = body as THREE.SkinnedMesh;
  if (skinnedBody.isSkinnedMesh) {
    // three skins every vertex to compute a missing SkinnedMesh sphere, even
    // unculled, just to sort it: the geometry's own sphere stands in.
    let sphere: THREE.Sphere | null = skinnedBody.boundingSphere ?? null;
    if (!sphere) {
      if (!body.geometry.boundingSphere) body.geometry.computeBoundingSphere();
      sphere = body.geometry.boundingSphere?.clone() ?? null;
    }
    if (sphere) (sibling as THREE.SkinnedMesh).boundingSphere = sphere;
    else sibling.frustumCulled = false;
  }
  if (body.morphTargetInfluences) {
    sibling.morphTargetInfluences = body.morphTargetInfluences;
    sibling.morphTargetDictionary = body.morphTargetDictionary;
  }
}

function meshPass(mesh: THREE.Mesh): SpiritVeilPass | null {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return mat ? spiritVeilPassOf(mat) : null;
}

function meshPalette(mesh: THREE.Mesh): SpiritVeilPalette | null {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return mat ? spiritVeilPaletteOf(mat) : null;
}

/**
 * One visual's veil state, mirrored from what its meshes actually MOUNT (a
 * veil still linking behind the effect gate is not mounted, and the rig keeps
 * its shadow and its halo until the swap lands). The depth siblings live as
 * children of their bodies only while mounted, and come off (`detach`) around
 * every sweep that walks the rig's graph for materials, so no tint, caster,
 * far-bake or weapon-VFX walk ever meets one.
 */
export class SpiritVeilRig {
  private readonly unit: SpiritVeilSortUnit = createSpiritVeilSortUnit();
  private readonly siblings = new Map<THREE.Mesh, THREE.Mesh>();
  private readonly tagged = new Set<THREE.Object3D>();
  private readonly hidden = new Map<THREE.Object3D, boolean>();
  private isMounted = false;
  private mountedPalette: SpiritVeilPalette | null = null;

  /** A veil is on this rig's meshes. */
  get mounted(): boolean {
    return this.isMounted;
  }

  /** The palette the mounted veil wears, null while none is mounted. */
  get palette(): SpiritVeilPalette | null {
    return this.mountedPalette;
  }

  /**
   * Mirror the mounted veil: a depth sibling under every body wearing the veil
   * colour, the sort unit on every veiled draw, and `hide` hidden (their prior
   * visibility restored once the veil comes off; a function is asked with the
   * mounted palette). Returns whether the veil is mounted.
   */
  sync(
    meshes: Iterable<THREE.Mesh>,
    hide: readonly THREE.Object3D[] | ((palette: SpiritVeilPalette) => readonly THREE.Object3D[]),
  ): boolean {
    const current = new Set(meshes);
    const bodies = new Set<THREE.Mesh>();
    const kept = new Set<THREE.Object3D>();
    let palette: SpiritVeilPalette | null = null;
    for (const mesh of current) {
      const pass = meshPass(mesh);
      if (pass !== 'color' && pass !== 'decal') continue;
      palette ??= meshPalette(mesh);
      this.tag(mesh, pass);
      kept.add(mesh);
      if (pass !== 'color') continue;
      bodies.add(mesh);
      let sibling = this.siblings.get(mesh);
      if (!sibling) {
        sibling = buildDepthSibling(mesh);
        this.siblings.set(mesh, sibling);
      }
      followBody(sibling, mesh);
      const depth = depthMaterialFor(mesh);
      if (sibling.material !== depth) sibling.material = depth;
      if (sibling.parent !== mesh) mesh.add(sibling);
      this.tag(sibling, 'depth');
      kept.add(sibling);
    }
    for (const [mesh, sibling] of this.siblings) {
      if (bodies.has(mesh)) continue;
      sibling.removeFromParent();
      if (!current.has(mesh)) this.siblings.delete(mesh);
    }
    for (const object of [...this.tagged]) if (!kept.has(object)) this.untag(object);
    this.isMounted = kept.size > 0;
    this.mountedPalette = this.isMounted ? (palette ?? 'spirit') : null;
    const hidden =
      this.mountedPalette === null
        ? []
        : typeof hide === 'function'
          ? hide(this.mountedPalette)
          : hide;
    this.syncHidden(hidden);
    return this.isMounted;
  }

  /** Take every depth sibling off its body (they come back at the next
   *  sync), for a sweep that walks the rig graph. */
  detach(): void {
    for (const sibling of this.siblings.values()) sibling.removeFromParent();
  }

  /** Everything back as it was: siblings off, tags off, hidden nodes shown. */
  release(): void {
    this.detach();
    for (const object of [...this.tagged]) this.untag(object);
    this.syncHidden([]);
    this.siblings.clear();
    this.isMounted = false;
    this.mountedPalette = null;
  }

  private tag(object: THREE.Object3D, pass: SpiritVeilPass): void {
    object.userData[SPIRIT_VEIL_UNIT_KEY] = this.unit;
    object.userData[SPIRIT_VEIL_PASS_KEY] = pass;
    this.tagged.add(object);
  }

  private untag(object: THREE.Object3D): void {
    delete object.userData[SPIRIT_VEIL_UNIT_KEY];
    delete object.userData[SPIRIT_VEIL_PASS_KEY];
    this.tagged.delete(object);
  }

  private syncHidden(hide: readonly THREE.Object3D[]): void {
    const wanted = new Set(hide);
    for (const [object, visible] of this.hidden) {
      if (wanted.has(object)) continue;
      object.visible = visible;
      this.hidden.delete(object);
    }
    for (const object of hide) {
      if (this.hidden.has(object)) continue;
      this.hidden.set(object, object.visible);
      object.visible = false;
    }
  }
}
