export const PERF_ATTRIB_KNOB_CASES = [
  { knob: 'composer', gfxo: 'composer:0' },
  { knob: 'gradePass', gfxo: 'gradePass:0' },
  { knob: 'ao', gfxo: 'ao:0' },
  { knob: 'aoFullRes', gfxo: 'aoFullRes:0' },
  { knob: 'msaaSamples', gfxo: 'msaaSamples:0' },
  { knob: 'bloom', gfxo: 'bloom:0' },
  { knob: 'smaa', gfxo: 'smaa:0' },
  { knob: 'fxaa', gfxo: 'fxaa:0' },
  { knob: 'dynamicShadows', gfxo: 'dynamicShadows:0' },
  { knob: 'terrainCastShadows', gfxo: 'terrainCastShadows:0' },
  { knob: 'shadowMap', gfxo: 'shadowMap:2048' },
  { knob: 'surfaceDetail', gfxo: 'surfaceDetail:0' },
  { knob: 'surfaceDetailTaps', gfxo: 'surfaceDetailTaps:0' },
  { knob: 'surfaceDetailClampK', gfxo: 'surfaceDetailClampK:0' },
  { knob: 'anisotropy', gfxo: 'anisotropy:1' },
  { knob: 'normalAnisotropy', gfxo: 'normalAnisotropy:1' },
  { knob: 'terrainRelief', gfxo: 'terrainRelief:0' },
  { knob: 'bladeCarpetRadius', gfxo: 'bladeCarpetRadius:0' },
  { knob: 'cliffScree', gfxo: 'cliffScree:0' },
  { knob: 'canopyDetail', gfxo: 'canopyDetail:0' },
  // Each row carries its LOW-preset value, so this one is 0: it sheds the
  // canopy taps while leaving the layer's textures resident, which the
  // canopyDetail:0 row above does not (canopy_detail_tier_core.ts).
  { knob: 'canopyDetailTaps', gfxo: 'canopyDetailTaps:0' },
  { knob: 'pixelRatioCap', gfxo: 'pixelRatioCap:1.48' },
  { knob: 'grassRadius', gfxo: 'grassRadius:72' },
  { knob: 'grassStep', gfxo: 'grassStep:2.05' },
  // The low-preset tuft: the two uprights, no diagonal and no cap card.
  { knob: 'grassCardsPerTuft', gfxo: 'grassCardsPerTuft:2' },
  { knob: 'leanFoliage', gfxo: 'leanFoliage:1' },
  { knob: 'standardMaterials', gfxo: 'standardMaterials:0' },
  { knob: 'terrainSplat', gfxo: 'terrainSplat:0' },
  { knob: 'maxPointLights', gfxo: 'maxPointLights:6' },
  { knob: 'farCharacterAnimScale', gfxo: 'farCharacterAnimScale:1' },
];

export const PERF_ATTRIB_COMBINED_CASES = [
  { knob: 'post-off', gfxo: 'composer:0' },
  {
    knob: 'shadows-off',
    gfxo: 'dynamicShadows:0,terrainCastShadows:0',
  },
  { knob: 'dpr-low', gfxo: 'pixelRatioCap:1.48' },
];

export const PERF_ATTRIB_CASES = [
  { knob: 'control', gfxo: '' },
  ...PERF_ATTRIB_KNOB_CASES,
  ...PERF_ATTRIB_COMBINED_CASES,
];
