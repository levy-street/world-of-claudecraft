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
import { nythraxisUnboundHitMaxHp } from '../src/sim/nythraxis_binding_sigil';
import { nythraxisImpaledTickMaxHp } from '../src/sim/nythraxis_bone_spike';
import {
  NYTHRAXIS_BONE_STORM_WHIRL_TICK_MAX_HP,
  nythraxisBoneSlamDamageMaxHp,
} from '../src/sim/nythraxis_bone_storm';
import { nythraxisDreadCursePerStack } from '../src/sim/nythraxis_dread_curse';
import {
  nythraxisGraveEruptionDamageMaxHp,
  nythraxisGraveFlameTickMaxHp,
} from '../src/sim/nythraxis_grave_eruption';
import { nythraxisGravefireTickMaxHp } from '../src/sim/nythraxis_gravefire';
import { nythraxisSoulfireTickMaxHp } from '../src/sim/nythraxis_soulfire';
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

  it('makes Nythraxis avoidable and answerable mechanics punishing on Normal and severe on Heroic', () => {
    // Grave Eruption burst, Grave Flame per second, the impale drain per second
    // (answered by shattering the spike), and the Dread Curse per-stack step
    // (answered by the tank swap). Every mechanic runs on both difficulties.
    expect([
      nythraxisGraveEruptionDamageMaxHp('normal'),
      nythraxisGraveFlameTickMaxHp('normal'),
      nythraxisImpaledTickMaxHp('normal'),
      nythraxisDreadCursePerStack('normal'),
      nythraxisSoulfireTickMaxHp('normal'),
      nythraxisGravefireTickMaxHp('normal'),
      nythraxisUnboundHitMaxHp('normal'),
      nythraxisBoneSlamDamageMaxHp('normal'),
      NYTHRAXIS_BONE_STORM_WHIRL_TICK_MAX_HP,
    ]).toEqual([0.45, 0.06, 0.08, 0.35, 0.08, 0.1, 0.4, 0.35, 0.1]);
    expect([
      nythraxisGraveEruptionDamageMaxHp('heroic'),
      nythraxisGraveFlameTickMaxHp('heroic'),
      nythraxisImpaledTickMaxHp('heroic'),
      nythraxisDreadCursePerStack('heroic'),
      nythraxisSoulfireTickMaxHp('heroic'),
      nythraxisGravefireTickMaxHp('heroic'),
      nythraxisUnboundHitMaxHp('heroic'),
      nythraxisBoneSlamDamageMaxHp('heroic'),
      NYTHRAXIS_BONE_STORM_WHIRL_TICK_MAX_HP,
    ]).toEqual([0.75, 0.09, 0.1, 0.45, 0.12, 0.15, 0.6, 0.55, 0.1]);
  });
});
