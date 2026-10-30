// VisualDef.envSheen, the pure half (env_sheen.ts is the three.js layer): how much of the sky
// environment's reflection an actor's surfaces keep. Three-free and DOM-free, so a plain Vitest
// pins it (RENDER_PURE_CORES).
//
// The image-based specular three gathers from the prefiltered sky does not scale with albedo (a
// dielectric reflects about four percent of the sky whatever its colour), so on the dark painted
// atlases it lays one cool grey film over cloth, leather, skin and plate at once, strongest on
// the faces turned up to the sky. The art bible (docs/design/art-direction.md, sections 3 and 8)
// has the painted albedo carry the light and asks for deep darks, never a look that leans on
// specular.
//
// Two shares, picked by the texel's metal: a non-metal texel keeps WOC_ENV_SHEEN of the
// reflection and a full-metal one WOC_ENV_SHEEN_METAL, so painted steel still catches a little
// sky. "Full metal" is the armour paint's metal cap (WOC_ARMOR_METALNESS): the painted armour
// never draws a metalness above it, and a texel under it takes its share in proportion. Measured
// in game (2026-10-29, Eastbrook's painted look at noon, Ultra, the warrior's best-in-slot set):
// at the previous shares (a quarter on non-metal, 0.55 on armour metal) the reflection still
// added 2 to 3 code values of grey to the dark plates and the cloth.
//
// The metal share is also where the armour's sky cap lives. The paint used to cap the sky through
// material.envMapIntensity, which three (r163 on) never reads for a material lit by
// scene.environment (it uploads scene.environmentIntensity instead), so that cap drew nothing:
// zeroing envMapIntensity on every character material moved the dark plates by under a tenth of
// a code value in the same capture.
//
// Fairness (docs/design/graphics-settings-fairness.md): one text for every Standard tier, read
// off no tier input. The Lambert rebuild of Low and iOS gathers no sky reflection to scale.
import { WOC_ARMOR_METALNESS } from './woc_armor_paint_core';

/** The share of the sky reflection a WOC body's non-metal surfaces keep (cloth, leather, skin,
 *  the painted plate between its metal): VisualDef.envSheen on every WOC def. */
export const WOC_ENV_SHEEN = 0.1;

/** The share a full-metal texel keeps: enough sky that steel still reads as steel. */
export const WOC_ENV_SHEEN_METAL = 0.4;

/** The metalness that counts as full metal (the armour paint's cap). */
export const ENV_SHEEN_FULL_METAL = WOC_ARMOR_METALNESS;

const LIGHTS_MAPS = '#include <lights_fragment_maps>';

function glsl(value: number): string {
  return value.toFixed(3);
}

/** The line that scales the gathered sky reflection, for a non-metal share. */
export function envSheenGlsl(nonMetal: number): string {
  return `radiance *= mix( ${glsl(nonMetal)}, ${glsl(WOC_ENV_SHEEN_METAL)}, saturate( metalnessFactor * ${glsl(1 / ENV_SHEEN_FULL_METAL)} ) );`;
}

/** The fragment source with the sky reflection scaled right after the image-based light gather,
 *  before any of it is shaded (a no-op on a program without that chunk). */
export function envSheenFragment(source: string, nonMetal: number): string {
  return source.replace(
    LIGHTS_MAPS,
    `${LIGHTS_MAPS}\n#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )\n\t${envSheenGlsl(nonMetal)}\n#endif`,
  );
}

/** The program-key token for a non-metal share: every number the inserted line bakes in. */
export function envSheenProgramKey(nonMetal: number): string {
  return `env-sheen:${glsl(nonMetal)}:${glsl(WOC_ENV_SHEEN_METAL)}:${glsl(ENV_SHEEN_FULL_METAL)}`;
}
