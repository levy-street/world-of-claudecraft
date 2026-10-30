// The painted Tidehold walls' tiling stone relief: the pure half (no Three, no DOM, no
// clocks, so a plain Vitest pins it; RENDER_PURE_CORES), applied by painted_wall_detail.ts.
//
// Why it exists. The painted pipeline bakes one normal atlas per building at a sixth of the
// colour atlas's size (placed_building_surface_core.ts), so each small painted stone got one
// to three normal texels and the mips averaged them flat at gameplay distance: the walls lit
// as flat cards. The six buildings Eastbrook stands were re-baked
// (scripts/assets/painted_buildings/rebake_walls.mjs) with smaller hand-painted stones laid
// out along a SECOND UV set, and their relief moved into ONE shared tiling detail normal. The
// handshake is scripts/assets/painted_buildings/detail_normal_contract.json
// (tests/painted_wall_detail_core.test.ts reads it against the constants below):
//   - every walls primitive of the six models carries TEXCOORD_1 (three's `uv1`) in TILE
//     units, the painted tile repeating once per 1.0, u along the wall's horizontal tangent
//     cross(worldUp, faceNormal) and v world up;
//   - the walls colour atlas's ALPHA is the stone mask (1 re-tiled painted stone, 0 the
//     original atlas, feathered), and the atlas normal is FLAT inside it, so the detail
//     normal alone carries the stones there;
//   - the detail normal is tangent space in the OpenGL convention (+R along +u, +G along +v),
//     linear, UASTC with mips, flipped at encode so increasing v samples UP the tile.
// The town looks (fenrire/, highwatch/, ...) were baked before and carry neither the UV set
// nor the mask, which is what makes the gate below a geometry test and not a town list.
//
// Two layers, one program each:
//   - MASK (every walls program of a re-baked file, Lambert included): the atlas alpha is a
//     mask, never coverage, so the material's own opacity is restored right after
//     map_fragment. An opaque program forces alpha to 1 anyway; the camera fade's
//     TRANSPARENT twin and live flip do not, and without this the plaster, timber and panes
//     (mask 0) would vanish whenever a wall ghosts.
//   - DETAIL (the Standard tiers, once the texture is resident): the mask, plus the detail
//     normal sampled at the walls' own uv1, on a tangent frame built from uv1 and the
//     view-space position derivatives (Schueler's "normal mapping without precomputed
//     tangents", three's getTangentFrame, the old perturbNormal2Arb), blended over the
//     atlas-mapped normal by mask x strength x distance fade. The Lambert tiers (Low, iOS)
//     carry no normal maps at all; the bake paints the light into the colour for them.
//
// The sign. GLTFLoader writes a glTF normal map on a mesh without tangents as normalScale
// (s, -s): glTF's v runs DOWN the image, so the derivative frame's bitangent points down the
// atlas while the map's +G points up it. That flip belongs to the ATLAS uv (TEXCOORD_0) and
// rides normalScale. The detail's frame is built from uv1 itself, whose v is world up, and
// its +G was encoded along +v, so its scale is (+k, +k) and it never reads normalScale:
// borrowing normalScale's y would light every stone's top edge from below
// (PAINTED_WALL_DETAIL_SIGN, pinned by the test).

/** Where the shared detail normal ships (the contract's textureUrl). */
export const PAINTED_WALL_DETAIL_URL = '/textures/structures/painted_stone_wall_normal.ktx2';

/** The geometry attribute the walls carry the tile coordinates in (glTF TEXCOORD_1). */
export const PAINTED_WALL_DETAIL_UV_ATTRIBUTE = 'uv1';

/** The models whose walls were re-baked: their `painted_walls@<model>` materials are the
 *  only ones the layer considers (and only on a primitive carrying uv1). */
export const PAINTED_WALL_DETAIL_MODELS: readonly string[] = Object.freeze([
  'bank',
  'smithy',
  'tavern',
  'hall',
  'shop_a',
  'house_b',
]);

/** World yards across the median painted stone at the town's stand scale (contract
 *  stoneWidthYards.median, the bake's own target). Feeds the distance fade only: the tile's
 *  repeat and texel density may change with a re-bake, the stones the art asks for do not. */
export const PAINTED_WALL_DETAIL_STONE_YARDS = 0.95;

/** The strength knob: 1 draws the relief exactly as baked; the shipped 1.8 is the contract's
 *  suggestedStrength, raised after the in-game check so the stones visibly stand out at
 *  gameplay distance. It scales the detail's tangent-space slope; a uniform, so a change
 *  relinks nothing. */
export const PAINTED_WALL_DETAIL_STRENGTH = 1.8;

/** Ceiling of the `?walldetail=<k>` override: past it the slopes fold over. */
export const PAINTED_WALL_DETAIL_STRENGTH_MAX = 4;

/** Sign of the detail's tangent-space x and y on its uv1 frame: both positive (see the
 *  header). Never normalScale's, whose y carries the atlas's glTF flip. */
export const PAINTED_WALL_DETAIL_SIGN: Readonly<{ x: 1; y: 1 }> = Object.freeze({ x: 1, y: 1 });

/**
 * Distance fade, by the screen size of a stone. Once a stone is a few pixels across its
 * bevels are sub-pixel and its dome a smudge: the relief only costs a tap per wall fragment
 * and shimmers (a mipped normal shortens toward a smeared slope at grazing angles), so the
 * blend eases to the atlas normal and the tap is skipped. Measured on the reference
 * viewport the worn-stone fades use (900 px tall at the 60 degree base FOV, 779 px a yard
 * at one yard): the median block of the stylised course tile is 8 px across at 93 yd, where
 * the fade starts, and 4 px at 185 yd, where it ends. Full relief at every chase-camera
 * distance and across the town.
 */
export const PAINTED_WALL_DETAIL_FADE_START_PX = 8;
export const PAINTED_WALL_DETAIL_FADE_END_PX = 4;

const REF_PX_PER_YD = 900 / (2 * Math.tan(Math.PI / 6));

export interface PaintedWallDetailFadeBand {
  readonly start: number;
  readonly end: number;
}

/** The fade band in camera yards: where a `stoneYards` stone spans `startPx`, then `endPx`
 *  screen pixels head-on. */
export function paintedWallDetailFadeBand(
  stoneYards: number = PAINTED_WALL_DETAIL_STONE_YARDS,
  startPx: number = PAINTED_WALL_DETAIL_FADE_START_PX,
  endPx: number = PAINTED_WALL_DETAIL_FADE_END_PX,
): PaintedWallDetailFadeBand {
  const at = (px: number): number => (stoneYards * REF_PX_PER_YD) / px;
  return Object.freeze({ start: at(startPx), end: at(endPx) });
}

export const PAINTED_WALL_DETAIL_FADE: PaintedWallDetailFadeBand = paintedWallDetailFadeBand();

/** Which layer a walls material takes: the mask guard alone, or the mask plus the relief. */
export type PaintedWallDetailVariant = 'mask' | 'detail';

const WALLS_NAME = /^painted_walls@([a-z0-9_]+)$/;

/** Whether a material is one of the re-baked walls, by the painted pipeline's name. */
export function isPaintedWallDetailMaterialName(name: string): boolean {
  const match = WALLS_NAME.exec(name);
  return match !== null && PAINTED_WALL_DETAIL_MODELS.includes(match[1]);
}

export interface PaintedWallDetailInputs {
  readonly materialName: string;
  /** The mesh wearing it carries uv1: a re-baked file (the looks and old files do not). */
  readonly hasUv1: boolean;
  /** A Standard-tier material (the Lambert tiers carry no normal maps). */
  readonly standard: boolean;
  /** The shared detail normal is resident. */
  readonly detailReady: boolean;
  /** The session's strength knob (0 turns the relief off, never the mask guard). */
  readonly strength: number;
}

/**
 * The layer a walls material takes, decided once when the material is built (the program
 * never changes under it), or null for every material it must not touch: another role, a
 * look's walls, an old file. The mask guard rides every re-baked walls primitive whatever
 * the tier, because the atlas alpha is there whatever the tier.
 */
export function paintedWallDetailVariant(
  input: PaintedWallDetailInputs,
): PaintedWallDetailVariant | null {
  if (!input.hasUv1 || !isPaintedWallDetailMaterialName(input.materialName)) return null;
  return input.standard && input.detailReady && input.strength > 0 ? 'detail' : 'mask';
}

/** The layer's own token in the program cache key: one program per variant per base. */
export function paintedWallDetailProgramKey(variant: PaintedWallDetailVariant): string {
  return `painted-wall-detail-v1:${variant}`;
}

/**
 * The session's strength from a URL search string: `?walldetail=off` (or 0) keeps the mask
 * guard and draws no relief, the before arm of an in-game A/B; `?walldetail=<k>` draws at k,
 * clamped to [0, PAINTED_WALL_DETAIL_STRENGTH_MAX]. Anything else is the default.
 */
export function paintedWallDetailStrengthFromQuery(search: string): number {
  const raw = new URLSearchParams(search).get('walldetail');
  if (raw === null || raw.trim() === '') return PAINTED_WALL_DETAIL_STRENGTH;
  if (raw === 'off') return 0;
  const k = Number(raw);
  if (!Number.isFinite(k)) return PAINTED_WALL_DETAIL_STRENGTH;
  return Math.min(PAINTED_WALL_DETAIL_STRENGTH_MAX, Math.max(0, k));
}

/** The marker every patched source carries (idempotence, tests, the dry compile). */
export const PAINTED_WALL_DETAIL_MARKER = '// PAINTED_WALL_DETAIL';

/** The uniforms the detail program reads, by name (one shared set, painted_wall_detail.ts). */
export const PAINTED_WALL_DETAIL_UNIFORM_NAMES = Object.freeze({
  map: 'uPaintedWallDetailMap',
  strength: 'uPaintedWallDetailStrength',
  fade: 'uPaintedWallDetailFade',
});

const U = PAINTED_WALL_DETAIL_UNIFORM_NAMES;

const COMMON = '#include <common>';
const UV_VERTEX = '#include <uv_vertex>';
const MAP_FRAGMENT = '#include <map_fragment>';
const NORMAL_MAPS = '#include <normal_fragment_maps>';

/** Vertex declarations: three declares `uv1` only when a material TEXTURE samples channel
 *  1 (USE_UV1), and none of the walls' does, so the layer declares it otherwise. */
const VERTEX_PARS = `${PAINTED_WALL_DETAIL_MARKER} pars
#ifndef USE_UV1
	attribute vec2 uv1;
#endif
varying vec2 vUv1;`;

const VERTEX_UV = `${PAINTED_WALL_DETAIL_MARKER} uv
vUv1 = uv1;`;

/** Fragment declarations of the detail variant: the varying, the shared uniforms, and the
 *  derivative tangent frame (three's getTangentFrame, taking its derivatives as arguments
 *  so they are computed in uniform control flow, ahead of the mask's branch). */
const FRAGMENT_PARS = `${PAINTED_WALL_DETAIL_MARKER} pars
varying vec2 vUv1;
uniform sampler2D ${U.map};
uniform float ${U.strength};
uniform vec2 ${U.fade};
mat3 paintedWallDetailFrame( vec3 q0, vec3 q1, vec2 st0, vec2 st1, vec3 n ) {
	vec3 q1perp = cross( q1, n );
	vec3 q0perp = cross( n, q0 );
	vec3 t = q1perp * st0.x + q0perp * st1.x;
	vec3 b = q1perp * st0.y + q0perp * st1.y;
	float det = max( dot( t, t ), dot( b, b ) );
	float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
	return mat3( t * scale, b * scale, n );
}`;

/** After map_fragment, both variants: the opacity restore. */
const MASK_GUARD = `${PAINTED_WALL_DETAIL_MARKER} mask
// The walls atlas alpha is the painted-stone mask, never coverage: the material keeps its
// own opacity (an opaque program forces 1 anyway; a transparent camera-fade draw would
// otherwise drop the plaster, timber and panes the mask leaves at 0).
diffuseColor.a = opacity;`;

/** After map_fragment, the detail variant: read the mask before the restore drops it. */
const MASK_READ = `${PAINTED_WALL_DETAIL_MARKER} mask read
#ifdef USE_MAP
	float paintedStoneMask = sampledDiffuseColor.a;
#else
	float paintedStoneMask = 0.0;
#endif`;

const SIGN = `vec2( ${PAINTED_WALL_DETAIL_SIGN.x.toFixed(1)}, ${PAINTED_WALL_DETAIL_SIGN.y.toFixed(1)} )`;

/** After normal_fragment_maps, the detail variant: the relief over the atlas-mapped normal. */
const DETAIL_BLOCK = `${PAINTED_WALL_DETAIL_MARKER} relief
{
	// Derivatives first, in uniform control flow: the mask branches per fragment.
	vec3 pwdQ0 = dFdx( - vViewPosition );
	vec3 pwdQ1 = dFdy( - vViewPosition );
	vec2 pwdSt0 = dFdx( vUv1 );
	vec2 pwdSt1 = dFdy( vUv1 );
	float pwdK = paintedStoneMask * ${U.strength}
		* ( 1.0 - smoothstep( ${U.fade}.x, ${U.fade}.y, length( vViewPosition ) ) );
	if ( pwdK > 0.0 ) {
		// Explicit gradients: an implicit-lod read is undefined inside a branch on the mask.
		vec3 pwdN = textureGrad( ${U.map}, vUv1, pwdSt0, pwdSt1 ).xyz * 2.0 - 1.0;
		// OpenGL tangent space on a frame built from uv1 itself (+x along +u, +y along +v,
		// world up): never normalScale, whose y carries the glTF flip of the atlas uv.
		pwdN.xy *= ${SIGN} * pwdK;
		mat3 pwdTbn = paintedWallDetailFrame( pwdQ0, pwdQ1, pwdSt0, pwdSt1, normal );
		#ifdef DOUBLE_SIDED
			// the two-sided convention three keeps for its own derivative frame
			pwdTbn[0] *= faceDirection;
			pwdTbn[1] *= faceDirection;
		#endif
		normal = normalize( pwdTbn * pwdN );
	}
}`;

/** A vertex/fragment source pair, as onBeforeCompile hands it over. */
export interface PaintedWallDetailShaderSource {
  readonly vertexShader: string;
  readonly fragmentShader: string;
}

function after(source: string, anchor: string, block: string): string {
  return source.replace(anchor, `${anchor}\n${block}`);
}

/**
 * Patch a Standard or Lambert program pair for `variant`. Every anchor is a stock three
 * chunk the lit programs carry (pinned against the installed three by the test); a pair
 * missing one, or already patched, comes back unchanged, so a dry compile or a later layer
 * can never patch it twice or half.
 */
export function patchPaintedWallDetailShader(
  source: PaintedWallDetailShaderSource,
  variant: PaintedWallDetailVariant,
): PaintedWallDetailShaderSource {
  const { vertexShader, fragmentShader } = source;
  if (fragmentShader.includes(PAINTED_WALL_DETAIL_MARKER)) return source;
  if (!fragmentShader.includes(MAP_FRAGMENT)) return source;
  if (variant === 'mask') {
    return { vertexShader, fragmentShader: after(fragmentShader, MAP_FRAGMENT, MASK_GUARD) };
  }
  if (
    !vertexShader.includes(COMMON) ||
    !vertexShader.includes(UV_VERTEX) ||
    !fragmentShader.includes(COMMON) ||
    !fragmentShader.includes(NORMAL_MAPS)
  ) {
    return source;
  }
  return {
    vertexShader: after(after(vertexShader, COMMON, VERTEX_PARS), UV_VERTEX, VERTEX_UV),
    fragmentShader: after(
      after(
        after(fragmentShader, COMMON, FRAGMENT_PARS),
        MAP_FRAGMENT,
        `${MASK_READ}\n${MASK_GUARD}`,
      ),
      NORMAL_MAPS,
      DETAIL_BLOCK,
    ),
  };
}
