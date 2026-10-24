// Palette lab, the pure half: what a zone LOOK is, how the shipped look of a
// zone is read off the live tables, how a curated look patches it, and the
// numbers each look hands the GPU. No Three, no DOM: Vitest drives it directly.
//
// A look is everything that sets a zone's colour in one record: the ground
// palette (BIOME_PALETTE's five tones), the outdoor fog and light rows
// (BIOME_FOG / BIOME_LIGHT / BIOME_GOD_RAYS), a sky gradient over the HDRI,
// the water tones, the bloom, and a display grade. Every field but the grade
// and the sky maps one to one onto a shipped table, so a look chosen in the
// lab ships by pasting `lookToShippingSnippet` into those tables.
//
// Two colours are authored as what the player SEES, not as scene values: the
// sky gradient and the fog (which is also the horizon band of the dome and
// the colour of fully fogged land). `displayFromRadiance` is the display
// pipeline in numbers (exposure, ACES, sRGB, the grade's base gain and curve,
// the cel saturation) and `radianceForDisplay` solves it backwards, so a look
// can ask for "this cyan at the zenith" and get exactly that on screen
// (before its own split-tone and contrast) instead of guessing radiances.

import type { BiomeId } from '../../sim/types';
import { BIOME_FOG, BIOME_GOD_RAYS, BIOME_LIGHT } from '../outdoor_biome_presets';
import { BIOME_PALETTE } from '../terrain_palette';

export interface LookGround {
  grass: number;
  grassDark: number;
  grassYellow: number;
  dirt: number;
  sand: number;
}

export interface LookFog {
  /** DISPLAY colour of the haze (what fully fogged land and the horizon show). */
  color: number;
  near: number;
  far: number;
  /** The scene hex as shipped (stock looks only): written verbatim, so the stock
   *  look restores the table exactly instead of round-tripping the solver. */
  sceneColor?: number;
}

export interface LookLight {
  hemiSky: number;
  hemiGround: number;
  sun: number;
  sunScale: number;
  hemiScale: number;
  envScale: number;
}

export interface LookSky {
  /** DISPLAY colours (sRGB hex as seen) of the gradient's top and bottom. */
  zenith: number;
  horizon: number;
  /** 0 keeps the HDRI sky exactly; 1 replaces its blue with the gradient. */
  amount: number;
  /** 0..1: how much of the HDRI's clouds survive the recolour. */
  cloudKeep: number;
  /** Brightness trim on the solved gradient (1 = exactly the authored colours). */
  intensity: number;
}

export interface LookWater {
  deep: number;
  shallow: number;
  sky: number;
  scatter: number;
}

export interface LookGrade {
  /** Multiplier on the renderer's tone-mapping exposure. */
  exposure: number;
  /** -1 cool .. +1 warm white balance. */
  temperature: number;
  /** -1 green .. +1 magenta white balance. */
  tint: number;
  contrast: number;
  saturation: number;
  /** Extra saturation for muted colours only (0 = none). */
  vibrance: number;
  shadowTint: number;
  shadowAmt: number;
  highlightTint: number;
  highlightAmt: number;
  /** Painterly black lift toward the shadow tint (0 = none). */
  lift: number;
  /** Foliage-band hue shift in degrees (negative = toward yellow). */
  greenHue: number;
  greenSat: number;
  greenVal: number;
}

export interface LookBloom {
  strength: number;
  threshold: number;
}

/**
 * Beyond colour: the lab's render arms. Stock values change nothing, so the
 * stock look keeps the shipped frame exactly.
 */
export interface LookRender {
  /** Rim light strength on rounded shapes (0 is off; lab_lighting.ts). */
  rim: number;
  /** Rim falloff power (higher is a thinner edge). */
  rimPower: number;
  /** Rim colour (scene hex); null takes the look's sky fill, lifted to white. */
  rimColor: number | null;
  /** Ambient-occlusion tint (sRGB hex); black is the shipped AO. */
  aoTint: number;
  /** Multiplier on the shipped AO intensity. */
  aoScale: number;
  /** Sun shadow strength, 0 (none) to 1 (shipped). */
  shadowStrength: number;
  /** Meadow fullness: grass coverage 0 (shipped patches) to 1 (full carpet). */
  meadowCoverage: number;
  /** Grass blade height multiplier (1 is shipped). */
  meadowHeight: number;
  /** Grass cluster width multiplier (1 is shipped). */
  meadowWidth: number;
  /** Tree and bush canopy brightness multiplier (1 is shipped). */
  canopyLift: number;
}

export const STOCK_RENDER: LookRender = {
  rim: 0,
  rimPower: 3,
  rimColor: null,
  aoTint: 0x000000,
  aoScale: 1,
  shadowStrength: 1,
  meadowCoverage: 0,
  meadowHeight: 1,
  meadowWidth: 1,
  canopyLift: 1,
};

export interface ZoneLook {
  id: string;
  name: string;
  /** One line of art direction (and which reference it chases). */
  note: string;
  ground: LookGround;
  fog: LookFog;
  light: LookLight;
  godRays: number;
  sky: LookSky;
  water: LookWater;
  grade: LookGrade;
  bloom: LookBloom;
  render: LookRender;
}

type Patch<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

/** A curated look: an id, a name and only the fields it changes from stock. */
export type LookPatch = Pick<ZoneLook, 'id' | 'name' | 'note'> &
  Patch<Omit<ZoneLook, 'id' | 'name' | 'note'>>;

export const STOCK_LOOK_ID = 'stock';

/** The identity grade: every arm off, the shipped image untouched. */
export const NEUTRAL_GRADE: LookGrade = {
  exposure: 1,
  temperature: 0,
  tint: 0,
  contrast: 1,
  saturation: 1,
  vibrance: 0,
  shadowTint: 0x808080,
  shadowAmt: 0,
  highlightTint: 0x808080,
  highlightAmt: 0,
  lift: 0,
  greenHue: 0,
  greenSat: 1,
  greenVal: 1,
};

/** The stock sky: the gradient arm at zero (the HDRI as shipped). */
export const STOCK_SKY: LookSky = {
  zenith: 0x6fb1dd,
  horizon: 0xbfc8c9,
  amount: 0,
  cloudKeep: 1,
  intensity: 1,
};

interface StockTables {
  ground: Record<BiomeId, LookGround>;
  fog: Record<BiomeId, LookFog>;
  light: Record<BiomeId, LookLight>;
  godRays: Partial<Record<BiomeId, number>>;
}

function snapshotTables(): StockTables {
  const ground = {} as Record<BiomeId, LookGround>;
  const fog = {} as Record<BiomeId, LookFog>;
  const light = {} as Record<BiomeId, LookLight>;
  for (const biome of Object.keys(BIOME_PALETTE) as BiomeId[]) {
    ground[biome] = { ...BIOME_PALETTE[biome] };
    fog[biome] = { ...BIOME_FOG[biome] };
    const l = BIOME_LIGHT[biome];
    light[biome] = {
      hemiSky: l.hemiSky,
      hemiGround: l.hemiGround,
      sun: l.sun,
      sunScale: l.sunScale ?? 1,
      hemiScale: l.hemiScale ?? 1,
      envScale: l.envScale ?? 1,
    };
  }
  return { ground, fog, light, godRays: { ...BIOME_GOD_RAYS } };
}

// Taken at import, before the lab writes a single row: the lab mutates the
// live fog/light rows in place, so "stock" must be a copy made first.
const STOCK = snapshotTables();

/** The shipped fog row of a biome (never the live, possibly lab-written one). */
export function stockFog(biome: BiomeId): LookFog {
  return { ...STOCK.fog[biome] };
}

/** The shipped light row of a biome, every optional scale resolved to 1. */
export function stockLight(biome: BiomeId): LookLight {
  return { ...STOCK.light[biome] };
}

/** The shipped god-ray strength of a biome (the renderer's default is 1). */
export function stockGodRays(biome: BiomeId): number {
  return STOCK.godRays[biome] ?? 1;
}

/** A zone's shipped look, read off the snapshotted tables. */
export function stockLookFor(
  biome: BiomeId,
  water: LookWater,
  bloom: LookBloom,
  celSaturation = 1,
): ZoneLook {
  const fog = stockFog(biome);
  const model: DisplayModel = { gain: STOCK_GRADE_GAIN, exposure: 1, celSaturation };
  return {
    id: STOCK_LOOK_ID,
    name: 'Stock',
    note: 'The shipped look of this zone (no lab override).',
    ground: { ...STOCK.ground[biome] },
    fog: { ...fog, color: displayHexFromScene(fog.color, model), sceneColor: fog.color },
    light: stockLight(biome),
    godRays: stockGodRays(biome),
    sky: { ...STOCK_SKY },
    water: { ...water },
    grade: { ...NEUTRAL_GRADE },
    bloom: { ...bloom },
    render: { ...STOCK_RENDER },
  };
}

/** A curated look over a base: every field the patch names wins. */
export function applyLookPatch(base: ZoneLook, patch: LookPatch): ZoneLook {
  return {
    id: patch.id,
    name: patch.name,
    note: patch.note,
    ground: { ...base.ground, ...patch.ground },
    // A look that names its own haze colour drops the stock scene hex with it.
    fog:
      patch.fog?.color === undefined
        ? { ...base.fog, ...patch.fog }
        : { ...base.fog, ...patch.fog, sceneColor: undefined },
    light: { ...base.light, ...patch.light },
    godRays: patch.godRays ?? base.godRays,
    sky: { ...base.sky, ...patch.sky },
    water: { ...base.water, ...patch.water },
    grade: { ...base.grade, ...patch.grade },
    bloom: { ...base.bloom, ...patch.bloom },
    render: { ...base.render, ...patch.render },
  };
}

// Colour helpers --------------------------------------------------------------

export function hexToSrgb01(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function hexToLinear(hex: number): [number, number, number] {
  const [r, g, b] = hexToSrgb01(hex);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

export function hexString(hex: number): string {
  return `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// The display pipeline ------------------------------------------------------

/** The stock output grade's warm base gain (post_output_grade.ts GAIN). */
export const STOCK_GRADE_GAIN: readonly [number, number, number] = [1.1, 1.035, 0.9];
const GRADE_LIFT = [0.01, 0.008, 0.01] as const;
const GRADE_GAMMA = 0.975;
// three's ACESFilmicToneMapping matrices, row-major here (GLSL lists columns).
const ACES_IN = [0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777];
const ACES_OUT = [
  1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602,
];
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** What sits between a scene radiance and the screen for one look. */
export interface DisplayModel {
  /** The grade's base gain (the look's white balance, or the stock GAIN). */
  gain: readonly [number, number, number];
  /** Tone-mapping exposure (the look's multiplier over a base of 1). */
  exposure: number;
  /** The cel look's display saturation (1 without `?cel=on`). */
  celSaturation: number;
}

function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055;
}

function acesFit(v: number): number {
  return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
}

function mat3(m: readonly number[], v: readonly number[]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function saturateBy(c: [number, number, number], s: number): [number, number, number] {
  const l = c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
  return [l + (c[0] - l) * s, l + (c[1] - l) * s, l + (c[2] - l) * s];
}

/** The display value (0..1 per channel) a linear scene radiance lands at. */
export function displayFromRadiance(
  lin: readonly [number, number, number],
  model: DisplayModel,
): [number, number, number] {
  const k = model.exposure / 0.6;
  const fitted = mat3(ACES_IN, [lin[0] * k, lin[1] * k, lin[2] * k]).map(acesFit);
  const toned = mat3(ACES_OUT, fitted);
  let c: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const s = linearToSrgb(Math.min(1, Math.max(0, toned[i])));
    const graded = Math.max(0, s * model.gain[i] + GRADE_LIFT[i]) ** GRADE_GAMMA;
    c[i] = graded + (graded * graded * (3 - 2 * graded) - graded) * 0.23;
  }
  c = saturateBy(c, 1.07);
  c = saturateBy(c, model.celSaturation);
  return [Math.max(0, c[0]), Math.max(0, c[1]), Math.max(0, c[2])];
}

/**
 * The linear scene radiance that displays as `hex` under `model`: a damped
 * multiplicative solve (the pipeline is monotone per channel and only mildly
 * cross-coupled, so 48 steps land within a code value). A target brighter than
 * the curve can reach comes back as the nearest reachable radiance.
 */
export function radianceForDisplay(hex: number, model: DisplayModel): [number, number, number] {
  const target = hexToSrgb01(hex).map((v) => Math.min(0.985, Math.max(0.004, v)));
  const x: [number, number, number] = [
    srgbToLinear(target[0]) * 0.5 + 1e-4,
    srgbToLinear(target[1]) * 0.5 + 1e-4,
    srgbToLinear(target[2]) * 0.5 + 1e-4,
  ];
  for (let i = 0; i < 48; i++) {
    const y = displayFromRadiance(x, model);
    for (let ch = 0; ch < 3; ch++) {
      x[ch] = Math.min(64, x[ch] * (target[ch] / Math.max(y[ch], 1e-4)) ** 0.7);
    }
  }
  return x;
}

function linearToHex(lin: readonly [number, number, number]): number {
  const ch = (v: number): number => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255);
  return (ch(lin[0]) << 16) | (ch(lin[1]) << 8) | ch(lin[2]);
}

/** The colour a scene hex (a fog row, say) shows on screen under `model`. */
export function displayHexFromScene(sceneHex: number, model: DisplayModel): number {
  const d = displayFromRadiance(hexToLinear(sceneHex), model);
  const ch = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return (ch(d[0]) << 16) | (ch(d[1]) << 8) | ch(d[2]);
}

/** The scene hex (a table value, so capped at linear 1) that displays as `displayHex`. */
export function sceneHexForDisplay(displayHex: number, model: DisplayModel): number {
  return linearToHex(radianceForDisplay(displayHex, model));
}

/** The display model a look renders under. */
export function lookDisplayModel(look: ZoneLook, celSaturation: number): DisplayModel {
  const g = look.grade;
  return {
    gain: isNeutralGrade(g) ? STOCK_GRADE_GAIN : whiteBalanceGains(g.temperature, g.tint),
    exposure: g.exposure,
    celSaturation,
  };
}

/** The fog row's scene hex for a look (the stock hex verbatim when it has one). */
export function fogSceneHex(look: ZoneLook, celSaturation: number): number {
  return (
    look.fog.sceneColor ?? sceneHexForDisplay(look.fog.color, lookDisplayModel(look, celSaturation))
  );
}

// GPU values ------------------------------------------------------------------

/**
 * White-balance gains for a temperature (-1 cool .. +1 warm) and tint
 * (-1 green .. +1 magenta), normalised so mid-grey keeps its luminance.
 */
export function whiteBalanceGains(temperature: number, tint: number): [number, number, number] {
  const r = 1 + 0.14 * temperature + 0.04 * tint;
  const g = 1 + 0.015 * temperature - 0.09 * tint;
  const b = 1 - 0.16 * temperature + 0.05 * tint;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r / lum, g / lum, b / lum];
}

export type Vec4 = [number, number, number, number];

export interface GradeUniformValues {
  wb: Vec4;
  tone: Vec4;
  shadow: Vec4;
  highlight: Vec4;
  green: Vec4;
}

/** The grade's uniform vectors (see palette_grade.ts for the layout). */
export function gradeUniformValues(g: LookGrade, mix = 1): GradeUniformValues {
  const [wr, wg, wb] = whiteBalanceGains(g.temperature, g.tint);
  const [sr, sg, sb] = hexToSrgb01(g.shadowTint);
  const [hr, hg, hb] = hexToSrgb01(g.highlightTint);
  return {
    wb: [wr, wg, wb, isNeutralGrade(g) ? 0 : mix],
    tone: [g.contrast, g.saturation, g.vibrance, g.lift],
    shadow: [sr, sg, sb, g.shadowAmt],
    highlight: [hr, hg, hb, g.highlightAmt],
    green: [g.greenHue / 360, g.greenSat, g.greenVal, 0],
  };
}

/** True when the grade changes nothing on screen (the shader skips it). */
export function isNeutralGrade(g: LookGrade): boolean {
  return (
    g.temperature === 0 &&
    g.tint === 0 &&
    g.contrast === 1 &&
    g.saturation === 1 &&
    g.vibrance === 0 &&
    g.shadowAmt === 0 &&
    g.highlightAmt === 0 &&
    g.lift === 0 &&
    g.greenHue === 0 &&
    g.greenSat === 1 &&
    g.greenVal === 1
  );
}

/** The sky arm's two uniform vectors (palette_sky.ts layout). */
export function skyUniformValues(
  sky: LookSky,
  model: DisplayModel,
): { zenith: Vec4; horizon: Vec4 } {
  // Solved so the gradient displays as authored under the look's model.
  const z = radianceForDisplay(sky.zenith, model);
  const h = radianceForDisplay(sky.horizon, model);
  const k = sky.intensity;
  return {
    zenith: [z[0] * k, z[1] * k, z[2] * k, sky.amount],
    horizon: [h[0] * k, h[1] * k, h[2] * k, sky.cloudKeep],
  };
}

// Selections ------------------------------------------------------------------

/** Zone id to the chosen look id (a zone missing here runs stock). */
export type LookSelections = Record<string, string>;

/** The chosen default look per zone (day / general). */
export const DEFAULT_ZONE_SELECTIONS: Readonly<LookSelections> = {
  proving_shore: 'skyward-isles',
  eastbrook_vale: 'skyward-isles',
  mirefen_marsh: 'jade-wetland',
  thornpeak_heights: 'alpine-clear',
  farshore_isle: 'tropic-lagoon',
  galecrest: 'skyward-isles',
  evergarden: 'afternoon-reverie',
  willowfen: 'spring-watercolour',
  palmreach: 'lagoon-turquoise',
  veiled_hollow: 'rosewater-twilight',
  nightbloom: 'fae-pink',
  drakelands: 'ashfall',
  frostveil: 'glacier-teal',
  amberfall: 'sky-island-gold',
};

/** Per-zone night look override when a zone's night look differs from day. */
export const DEFAULT_ZONE_NIGHT_SELECTIONS: Readonly<LookSelections> = {
  thornpeak_heights: 'sky-island-gold',
  drakelands: 'obsidian-teal',
  frostveil: 'violet-whiteout',
  amberfall: 'sky-island-gold',
};

/** Resolve the active look id for `zoneId` at the current time of day. */
export function resolveZoneLookId(
  zoneId: string,
  daySelections: Readonly<LookSelections>,
  nightSelections: Readonly<LookSelections>,
  isNight: boolean,
): string {
  if (isNight) {
    const nightId = nightSelections[zoneId];
    if (nightId) return nightId;
  }
  return daySelections[zoneId] ?? STOCK_LOOK_ID;
}

/** Parse persisted selections, dropping anything malformed. */
export function parseSelections(raw: string | null): LookSelections {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: LookSelections = {};
    for (const [zone, look] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof look === 'string' && look !== STOCK_LOOK_ID) out[zone] = look;
    }
    return out;
  } catch {
    return {};
  }
}

/** The look `step` places away from `current` in a zone's list, wrapping. */
export function cycleLookId(ids: readonly string[], current: string, step: number): string {
  if (ids.length === 0) return current;
  const at = Math.max(0, ids.indexOf(current));
  return ids[(((at + step) % ids.length) + ids.length) % ids.length];
}

/** Stable string of a ground palette, to detect which zones need a re-bake. */
export function groundKey(g: LookGround): string {
  return `${g.grass},${g.grassDark},${g.grassYellow},${g.dirt},${g.sand}`;
}

/** The rim's linear colour: its own hex, else the sky fill lifted halfway to white. */
export function rimColorLinear(look: ZoneLook): [number, number, number] {
  const hex = look.render.rimColor ?? lerpHexToWhite(look.light.hemiSky, 0.5);
  return hexToLinear(hex);
}

function lerpHexToWhite(hex: number, t: number): number {
  const c = hexToSrgb01(hex).map((v) => Math.round((v + (1 - v) * t) * 255));
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

// Shipping --------------------------------------------------------------------

const hx = (n: number): string => `0x${(n & 0xffffff).toString(16).padStart(6, '0')}`;
const num = (n: number): string => String(Number(n.toFixed(3)));

/**
 * The look as the table rows it ships as: paste into terrain_palette.ts
 * (BIOME_PALETTE), outdoor_biome_presets.ts (BIOME_FOG / BIOME_LIGHT /
 * BIOME_GOD_RAYS), and the per-zone grade, sky, water and bloom rows a
 * shipped version of the lab's grade would read.
 */
export function lookToShippingSnippet(
  zoneId: string,
  biome: BiomeId,
  look: ZoneLook,
  celSaturation = 1,
): string {
  const fogScene = fogSceneHex(look, celSaturation);
  const g = look.ground;
  const f = look.fog;
  const l = look.light;
  const s = look.sky;
  const w = look.water;
  const gr = look.grade;
  return [
    `// ${zoneId} (${biome}): ${look.name} [${look.id}]`,
    `// BIOME_PALETTE.${biome}`,
    `{ grass: ${hx(g.grass)}, grassDark: ${hx(g.grassDark)}, grassYellow: ${hx(g.grassYellow)}, dirt: ${hx(g.dirt)}, sand: ${hx(g.sand)} },`,
    `// BIOME_FOG.${biome} (scene hex; displays as ${hx(f.color)})`,
    `{ color: ${hx(fogScene)}, near: ${num(f.near)}, far: ${num(f.far)} },`,
    `// BIOME_LIGHT.${biome}`,
    `{ hemiSky: ${hx(l.hemiSky)}, hemiGround: ${hx(l.hemiGround)}, sun: ${hx(l.sun)}, sunScale: ${num(l.sunScale)}, hemiScale: ${num(l.hemiScale)}, envScale: ${num(l.envScale)} },`,
    `// BIOME_GOD_RAYS.${biome}: ${num(look.godRays)}`,
    `// sky (display colours): { zenith: ${hx(s.zenith)}, horizon: ${hx(s.horizon)}, amount: ${num(s.amount)}, cloudKeep: ${num(s.cloudKeep)}, intensity: ${num(s.intensity)} }`,
    `// water: { deep: ${hx(w.deep)}, shallow: ${hx(w.shallow)}, sky: ${hx(w.sky)}, scatter: ${hx(w.scatter)} }`,
    `// bloom: { strength: ${num(look.bloom.strength)}, threshold: ${num(look.bloom.threshold)} }`,
    `// grade: { exposure: ${num(gr.exposure)}, temperature: ${num(gr.temperature)}, tint: ${num(gr.tint)}, contrast: ${num(gr.contrast)}, saturation: ${num(gr.saturation)}, vibrance: ${num(gr.vibrance)}, shadowTint: ${hx(gr.shadowTint)}, shadowAmt: ${num(gr.shadowAmt)}, highlightTint: ${hx(gr.highlightTint)}, highlightAmt: ${num(gr.highlightAmt)}, lift: ${num(gr.lift)}, greenHue: ${num(gr.greenHue)}, greenSat: ${num(gr.greenSat)}, greenVal: ${num(gr.greenVal)} }`,
    `// render: { rim: ${num(look.render.rim)}, rimPower: ${num(look.render.rimPower)}, rimColor: ${look.render.rimColor === null ? 'null' : hx(look.render.rimColor)}, aoTint: ${hx(look.render.aoTint)}, aoScale: ${num(look.render.aoScale)}, shadowStrength: ${num(look.render.shadowStrength)}, meadowCoverage: ${num(look.render.meadowCoverage)}, meadowHeight: ${num(look.render.meadowHeight)}, meadowWidth: ${num(look.render.meadowWidth)}, canopyLift: ${num(look.render.canopyLift)} }`,
  ].join('\n');
}
