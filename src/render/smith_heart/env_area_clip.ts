// The painted kits' area clips: a cut-away painted rock that some area of the slot shows
// or hides by where the camera stands (env_kit_look.ts `clip`), on the rock's own camera
// dither as the camera's area blend eases in.
//   - `heatBand`: rock opened round the Heat's hall, seen from inside the Heat (the dressed
//     arena concept of 2026-11-10; heat_env_plan_core.ts `HEAT_ENV_OPEN`): every vein's
//     painted rock, the Heat's own bands among them.
//   - `heatRing`: the Heat's tiers of basalt and its concept pieces, drawn only from the
//     Heat (no other vein's skyline ever carries them).
//   - `heart`: a vein's painted rock dressing the Heart's crown behind its element's
//     landmark (heart_env_dress.ts), drawn only from the Heart (the main map never sees
//     into the Heart, and never sees these either).
// From anywhere else nothing changes.

import type { EnvLook } from './env_kit_look';
import { heartRockCoreUniform, heartRockHeatOpenUniform } from './heart_rock_cutaway';
import { heatEnvOpenGlsl } from './heat_env_plan_core';

/** Which area a cut-away painted rock answers to (see the header). */
export type EnvAreaClip = 'heatBand' | 'heatRing' | 'heart';

/** The clip a cut-away painted rock look takes for its area (env_kit_look.ts `clip`). */
export function envAreaClip(area: EnvAreaClip): NonNullable<EnvLook['clip']> {
  if (area === 'heart')
    return {
      head: 'uniform float uHeartCore;',
      body: 'if ( uHeartCore <= envDither ) discard;',
      key: 'heartOnly',
      uniforms: { uHeartCore: heartRockCoreUniform() },
    };
  return {
    head: `uniform float uHeatOpen;\n${area === 'heatBand' ? heatEnvOpenGlsl() : ''}`,
    body:
      area === 'heatBand'
        ? 'if ( uHeatOpen > 0.0 && heatEnvOpen( vEnvLocal ) * uHeatOpen > envDither ) discard;'
        : 'if ( uHeatOpen <= envDither ) discard;',
    key: area === 'heatBand' ? 'heatOpen' : 'heatRing',
    uniforms: { uHeatOpen: heartRockHeatOpenUniform() },
  };
}
