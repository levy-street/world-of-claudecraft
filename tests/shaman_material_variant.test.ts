import { describe, expect, it } from 'vitest';
import { SHAMAN_VFX_FULL_SPECS, shamanVisualVariant } from '../src/render/shaman_vfx_specs';

const aura = (id: string, remaining = 1) => ({ id, remaining });
describe('Shaman material authority', () => {
  it('keeps Ancestral Strike electrical under every enchant without changing Unleash precedence', () => {
    const auras = [aura('galeheart_weapon'), aura('rockbiter_weapon')];
    expect(shamanVisualVariant('stormstrike', auras)).toBe('stormstrike');
    expect(shamanVisualVariant('unleash_weapon', auras)).toBe('unleash_weapon_wind');
    expect(shamanVisualVariant('stormstrike', [aura('rockbiter_weapon', 0)])).toBe('stormstrike');
  });
  it('uses explicit local specialization for the three Exaltation functions', () => {
    expect(shamanVisualVariant('primal_exaltation', [], 'elemental')).toBe(
      'primal_exaltation_storm',
    );
    expect(shamanVisualVariant('primal_exaltation', [], 'restoration')).toBe(
      'primal_exaltation_water',
    );
    expect(shamanVisualVariant('primal_exaltation', [], 'enhancement')).toBe(
      'primal_exaltation_wind',
    );
  });
  it('does not invent remote specialization and retains known enchant material', () => {
    expect(shamanVisualVariant('primal_exaltation', [])).toBe('primal_exaltation');
    expect(shamanVisualVariant('primal_exaltation', [aura('lifespring_weapon')])).toBe(
      'primal_exaltation_water',
    );
    expect(shamanVisualVariant('primal_exaltation', [aura('lifespring_weapon', 0)])).toBe(
      'primal_exaltation',
    );
    const id = shamanVisualVariant('primal_exaltation', [aura('rockbiter_weapon')]);
    expect(SHAMAN_VFX_FULL_SPECS[id].shaman?.action).toBe('exalt');
    expect(SHAMAN_VFX_FULL_SPECS[id].shaman?.element).toBe('earth');
  });
});
