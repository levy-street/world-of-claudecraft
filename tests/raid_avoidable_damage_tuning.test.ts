import { describe, expect, it } from 'vitest';
import {
  ignivarFrontalDamageMaxHp,
  ignivarRotatingRaysDamageMaxHp,
  ignivarSkyfireDamageMaxHp,
} from '../src/sim/encounters/ignivar';
import { varkhulForgestormDamageMaxHp } from '../src/sim/encounters/varkhul';
import { IGNIVAR_LAVA_MOAT_DAMAGE_FRACTION } from '../src/sim/ignivar_arena';
import { ignivarJudgmentBurnDamageMaxHp } from '../src/sim/ignivar_forge_judgment';
import { ignivarForgeWaveDamageMaxHp } from '../src/sim/ignivar_forge_wave';
import { ignivarMeteorDamageMaxHp } from '../src/sim/ignivar_meteors';
import {
  varkhulCinderFireDamageMaxHp,
  varkhulCinderOrbDamageMaxHp,
} from '../src/sim/varkhul_cinder_orbs';

describe('raid avoidable damage tuning', () => {
  it('makes Ignivar avoidable mechanics punishing on Normal and severe on Heroic', () => {
    expect([
      ignivarFrontalDamageMaxHp('normal'),
      ignivarSkyfireDamageMaxHp('normal'),
      ignivarMeteorDamageMaxHp('normal'),
      ignivarForgeWaveDamageMaxHp('normal'),
      ignivarRotatingRaysDamageMaxHp('normal'),
      ignivarJudgmentBurnDamageMaxHp('normal'),
      IGNIVAR_LAVA_MOAT_DAMAGE_FRACTION.normal,
    ]).toEqual([0.5, 0.6, 0.5, 0.5, 0.3, 0.2, 0.25]);
    expect([
      ignivarFrontalDamageMaxHp('heroic'),
      ignivarSkyfireDamageMaxHp('heroic'),
      ignivarMeteorDamageMaxHp('heroic'),
      ignivarForgeWaveDamageMaxHp('heroic'),
      ignivarRotatingRaysDamageMaxHp('heroic'),
      ignivarJudgmentBurnDamageMaxHp('heroic'),
      IGNIVAR_LAVA_MOAT_DAMAGE_FRACTION.heroic,
    ]).toEqual([0.85, 0.9, 0.8, 0.8, 0.5, 0.35, 0.45]);
  });

  it('makes Varkhul ground hazards and projectiles dangerous at both difficulties', () => {
    expect([
      varkhulCinderFireDamageMaxHp('normal'),
      varkhulCinderOrbDamageMaxHp('normal'),
      varkhulForgestormDamageMaxHp('normal'),
    ]).toEqual([0.12, 0.35, 0.5]);
    expect([
      varkhulCinderFireDamageMaxHp('heroic'),
      varkhulCinderOrbDamageMaxHp('heroic'),
      varkhulForgestormDamageMaxHp('heroic'),
    ]).toEqual([0.25, 0.55, 0.8]);
  });
});
