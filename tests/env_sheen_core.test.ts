import { describe, expect, it } from 'vitest';
import {
  ENV_SHEEN_FULL_METAL,
  envSheenFragment,
  envSheenGlsl,
  envSheenProgramKey,
  WOC_ENV_SHEEN,
  WOC_ENV_SHEEN_METAL,
} from '../src/render/characters/env_sheen_core';
import { WOC_ARMOR_METALNESS } from '../src/render/characters/woc_armor_paint_core';

// The actors' share of the sky reflection (env_sheen_core.ts). The image-based specular does
// not scale with albedo, so on the dark painted atlases it read as a cool grey film over cloth,
// leather and plate (measured 2026-10-29 in Eastbrook's painted look at noon). Non-metal keeps a
// tenth, metal four tenths, and "full metal" is the armour paint's metal cap.

const FRAGMENT = [
  'void main() {',
  '#include <lights_fragment_begin>',
  '#include <lights_fragment_maps>',
  '#include <lights_fragment_end>',
  '}',
].join('\n');

describe('the env sheen shares', () => {
  it('keeps a tenth of the sky on non-metal and four tenths on full metal', () => {
    expect(WOC_ENV_SHEEN).toBe(0.1);
    expect(WOC_ENV_SHEEN_METAL).toBe(0.4);
    // metal still catches more sky than cloth, and never the whole of it
    expect(WOC_ENV_SHEEN_METAL).toBeGreaterThan(WOC_ENV_SHEEN);
    expect(WOC_ENV_SHEEN_METAL).toBeLessThan(1);
  });

  it('counts the armour paint metal cap as full metal', () => {
    expect(ENV_SHEEN_FULL_METAL).toBe(0.4);
    expect(ENV_SHEEN_FULL_METAL).toBe(WOC_ARMOR_METALNESS);
  });
});

describe('the env sheen line', () => {
  it('bakes both shares and the full-metal point into one mix by the texel metal', () => {
    expect(envSheenGlsl(0.1)).toBe(
      'radiance *= mix( 0.100, 0.400, saturate( metalnessFactor * 2.500 ) );',
    );
    expect(envSheenGlsl(0.25)).toBe(
      'radiance *= mix( 0.250, 0.400, saturate( metalnessFactor * 2.500 ) );',
    );
  });

  it('scales only the gathered sky reflection, after the IBL chunk and before it is shaded', () => {
    const out = envSheenFragment(FRAGMENT, 0.1);
    const at = out.indexOf('#include <lights_fragment_maps>');
    const line = out.indexOf(
      'radiance *= mix( 0.100, 0.400, saturate( metalnessFactor * 2.500 ) );',
    );
    expect(at).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(at);
    expect(line).toBeLessThan(out.indexOf('#include <lights_fragment_end>'));
    // the guard keeps the line out of a program with no sky reflection to scale
    expect(out).toContain('#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )');
    // the diffuse sky fill is not touched: the film is the reflection alone
    expect(out).not.toContain('iblIrradiance *=');
    expect(out).not.toContain('irradiance *=');
  });

  it('leaves a program without the chunk exactly as it was (the Lambert rebuild)', () => {
    const lambert = 'void main() {\n#include <lights_fragment_begin>\n}';
    expect(envSheenFragment(lambert, 0.1)).toBe(lambert);
  });
});

describe('the env sheen program key', () => {
  it('names every number the line bakes in', () => {
    expect(envSheenProgramKey(0.1)).toBe('env-sheen:0.100:0.400:0.400');
  });

  it('differs per non-metal share, so two shares never share a program', () => {
    expect(envSheenProgramKey(0.25)).not.toBe(envSheenProgramKey(0.1));
    expect(envSheenProgramKey(0.25).startsWith('env-sheen:0.250')).toBe(true);
  });
});
