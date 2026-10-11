import type { AbilityVfxFullSpec } from './ability_vfx_core';
import { ABILITY_VFX_FULL_SPECS } from './ability_vfx_full_specs';

// Reviewed Warrior base records, scoped independently of every other class.
// The record itself IS the generated gallery row (ABILITY_VFX_FULL_SPECS):
// this module used to carry a verbatim second copy of all 51 of them, which
// could only drift away from the table it was copied from. The one authored
// difference the review added is `filler`, the crescendo-scale opt-out
// (src/render/ability_vfx/CLAUDE.md, the spectacle.ts calibration contract),
// so that is the only thing kept here. Every other field, `accent` included
// (warrior_vfx_specs.ts derives its own from the choreography material),
// resolves from the generated table.
const WARRIOR_FILLER: Readonly<Record<string, boolean>> = {
  heroic_strike: true,
  slam: false,
  mortal_strike: false,
  execute: false,
  breachmaker: false,
  overpower: true,
  victory_rush: false,
  raging_gale: false,
  red_harvest: false,
  bloodthirst: false,
  cleave: false,
  revenge: false,
  hamstring: true,
  pummel: true,
  sunder_armor: false,
  whirlwind: false,
  bladestorm: false,
  thunder_clap: false,
  faultline: false,
  charge: false,
  heroic_leap: false,
  shield_slam: false,
  raised_guard: false,
  iron_resolve: false,
  defensive_stance: false,
  die_by_sword: false,
  battle_shout: false,
  rallying_cry: false,
  emboldening_roar: false,
  defiant_bellow: false,
  demoralizing_shout: false,
  intimidating_shout: false,
  taunt: false,
  piercing_howl: false,
  bloodrage: false,
  berserker_rage: false,
  recklessness: false,
  battle_stance: false,
  berserker_stance: false,
  avatar: false,
  furious_mending: false,
  sanguine_aura: false,
  sweeping_strikes: false,
  storm_bolt: false,
  measured_fury: false,
  seasoned_soldier: false,
  sudden_death: false,
  diabolical_twinstrike: false,
  cleaving_blows: false,
  deep_wounds: false,
  enrage_passive: false,
};

function warriorBaseProfiles(): Record<string, AbilityVfxFullSpec> {
  const out: Record<string, AbilityVfxFullSpec> = {};
  for (const [id, filler] of Object.entries(WARRIOR_FILLER)) {
    // An id with no generated row has no base to read; warrior_vfx_specs.ts
    // already falls back for a missing profile, so leave it missing here
    // rather than minting a half-typed record.
    const base = ABILITY_VFX_FULL_SPECS[id];
    if (!base) continue;
    out[id] = { ...base, filler };
  }
  return out;
}

export const WARRIOR_BASE_PROFILES: Readonly<Record<string, AbilityVfxFullSpec>> =
  warriorBaseProfiles();
