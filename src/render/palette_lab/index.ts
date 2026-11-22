// The palette lab's public surface for the rest of the renderer: the session
// flag and the compile-time shader arms (the grade, the sky gradient) plus the
// bloom registration. The runtime and its panel are NOT here: they load by
// dynamic import from palette_lab_flag.ts, only in a lab session.

export { setPaletteAoPass } from './lab_lighting';
export { setPaletteBloomPass } from './palette_bloom';
export { PALETTE_GRADE_GLSL, paletteGradeUniforms } from './palette_grade';
export { paletteLabEnabled, paletteLabPanelEnabled } from './palette_lab_flag';
export {
  PALETTE_CLOUDS_GLSL,
  PALETTE_SKY_DECLARATIONS,
  PALETTE_SKY_GLSL,
  paletteSkyUniforms,
} from './palette_sky';
