import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/nythraxis_matrix.ts', 'utf8');

describe('Nythraxis matrix DPS rotations', () => {
  it('keeps maintenance DoTs guarded without classifying core nukes as DoTs', () => {
    expect(source).toContain(
      "const DOT_ABILITIES = new Set(['immolate', 'corruption', 'curse_of_agony', 'shadow_word_pain', 'moonfire', 'insect_swarm', 'flame_shock', 'serpent_sting', 'rend', 'rip', 'rupture'])",
    );
    expect(source).not.toContain("'fireball', 'pyroblast'");
  });

  it('moves long caster buffs to prepull instead of recurring combat priority', () => {
    expect(source).toContain("prepull: ['arcane_intellect']");
    expect(source).toContain("prepull: ['demon_skin']");
    expect(source).toContain("prepull: ['lightning_shield']");
    expect(source).toContain("rotation: ['flame_shock', 'earth_shock', 'lightning_bolt']");
    expect(source).toContain("rotation: ['immolate', 'corruption', 'curse_of_agony', 'shadow_bolt']");
  });

  it('prioritizes caster cooldown/maintenance spells before standard filler nukes', () => {
    expect(source).toContain("rotation: ['fire_blast', 'pyroblast', 'fireball', 'scorch']");
    expect(source).toContain("rotation: ['frostbolt']");
    expect(source).toContain("rotation: ['arcane_missiles']");
    expect(source).toContain(
      "rotation: ['shadowburn', 'immolate', 'corruption', 'curse_of_agony', 'shadow_bolt']",
    );
    expect(source).toContain("rotation: ['immolate', 'corruption', 'curse_of_agony', 'drain_life', 'shadow_bolt']");
    expect(source).toContain("rotation: ['moonfire', 'insect_swarm', 'wrath']");
    expect(source).toContain("rotation: ['shadow_word_pain', 'mind_blast', 'mind_flay', 'smite']");
    expect(source).toContain("spec.key === 'fire_mage'");
  });

  it('models enhancement as Flametongue prepull, then auto-attacks, Stormstrike on cooldown, and Flame/Earth shock weave', () => {
    expect(source).toContain("prepull: ['flametongue_weapon']");
    expect(source).toContain("rotation: ['stormstrike', 'flame_shock', 'earth_shock']");
    expect(source).toContain('sim.startAutoAttack(pid)');
  });
});
