import { describe, expect, it } from 'vitest';
import { isCancelableAura } from '../src/sim/combat/aura_cancel';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { devourBeneficialAura } from '../src/sim/mob/mob_swing';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { createAurasView } from '../src/ui/auras_view';

const TICKS_PER_SECOND = 20;
const CLASSIC_TICK = 2 * TICKS_PER_SECOND;

type SimInternals = {
  addEntity(e: Entity): void;
  applyAura(target: Entity, aura: Aura): void;
  dealDamage(
    source: Entity | null,
    target: Entity,
    amount: number,
    crit: boolean,
    school: Aura['school'],
    ability: string | null,
    kind: 'hit',
  ): void;
  mobSwing(mob: Entity, target: Entity): void;
};

function druidWithLifesap(): Sim {
  const sim = new Sim({ seed: 11, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: null, rows: { 11: 'dru_r11_innervate' } })).toBe(true);
  return sim;
}

function addTargetMob(sim: Sim, hp = 100000): Entity {
  const p = sim.player;
  const mob = createMob(91000, MOBS.forest_wolf, 20, {
    x: p.pos.x + 3,
    y: p.pos.y,
    z: p.pos.z,
  });
  mob.maxHp = hp;
  mob.hp = hp;
  (sim as unknown as SimInternals).addEntity(mob);
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  return mob;
}

function resourceSapAura(owner: Entity, value = 30): Aura {
  return {
    id: 'innervate',
    name: 'Lifesap',
    kind: 'resource_sap',
    remaining: 10,
    duration: 10,
    value,
    sourceId: owner.id,
    school: 'nature',
  };
}

function controlAura(owner: Entity, kind: 'stasis' | 'polymorph' | 'incapacitate'): Aura {
  return {
    id: `test_${kind}`,
    name: kind,
    kind,
    remaining: 10,
    duration: 10,
    value: 0,
    sourceId: owner.id,
    school: 'arcane',
  };
}

function stepTicks(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick();
}

function stepTicksWithoutManaRegen(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    sim.player.fiveSecondRule = 0;
    sim.player.inCombat = true;
    sim.tick();
  }
}

function measureLifesapPotential(form: 'bear_form' | 'cat_form'): number {
  const sim = druidWithLifesap();
  const p = sim.player;
  p.resource = p.maxResource;
  p.inCombat = true;
  sim.castAbility('innervate');
  p.gcdRemaining = 0;
  sim.castAbility(form);
  p.resource = 0;

  let gained = 0;
  for (let i = 0; i < 10 * TICKS_PER_SECOND; i++) {
    p.inCombat = true;
    const before = p.resource;
    sim.tick();
    if (p.resource > before) {
      gained += p.resource - before;
      p.resource = 0;
    }
  }
  return gained;
}

function measureCatEnergyPotential(withLifesap: boolean): number {
  const sim = withLifesap
    ? druidWithLifesap()
    : new Sim({ seed: 11, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  const p = sim.player;
  p.resource = p.maxResource;
  p.inCombat = true;
  if (withLifesap) {
    sim.castAbility('innervate');
    p.gcdRemaining = 0;
  }
  sim.castAbility('cat_form');
  p.resource = 0;

  let gained = 0;
  for (let i = 0; i < 10 * TICKS_PER_SECOND; i++) {
    const before = p.resource;
    sim.tick();
    if (p.resource > before) {
      gained += p.resource - before;
      p.resource = 0;
    }
  }
  return gained;
}

function runClawRotation(withLifesap: boolean): number {
  const sim = withLifesap
    ? druidWithLifesap()
    : new Sim({ seed: 11, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  const p = sim.player;
  p.resource = p.maxResource;
  p.inCombat = true;
  if (withLifesap) {
    sim.castAbility('innervate');
    p.gcdRemaining = 0;
  }
  sim.castAbility('cat_form');
  addTargetMob(sim);
  p.resource = 0;
  p.gcdRemaining = 0;

  let casts = 0;
  for (let i = 0; i < 10 * TICKS_PER_SECOND; i++) {
    if (p.gcdRemaining <= 0 && p.resource >= 45) {
      sim.castAbility('claw');
      casts++;
    }
    sim.tick();
  }
  return casts;
}

describe('Lifesap adversarial balance checks', () => {
  it('generates 100 rage of spendable potential across the 10 second bear window', () => {
    const rage = measureLifesapPotential('bear_form');
    expect(rage).toBe(100);
  });

  it('provides at least 12x the redesigned Warrior rage from five same-level mob swings', () => {
    // The old 20x margin was calibrated against the pre-overhaul rage model
    // (rage-from-taking = damage / (1.5 * attackerLevel)). The redesigned
    // warrior mints damage / attackerLevel instead, so five swings (154 total
    // damage at level 20) yield 7.7 rage and the comparison lands at ~13x.
    const warrior = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: true });
    warrior.setPlayerLevel(20);
    const p = warrior.player;
    p.hp = p.maxHp = 100000;
    p.resource = 0;
    const wolf = createMob(92000, MOBS.forest_wolf, 20, { ...p.pos });
    wolf.facing = Math.atan2(p.pos.x - wolf.pos.x, p.pos.z - wolf.pos.z);
    for (let i = 0; i < 5; i++) (warrior as unknown as SimInternals).mobSwing(wolf, p);

    expect(p.resource).toBeCloseTo(7.7);
    expect(measureLifesapPotential('bear_form')).toBeGreaterThanOrEqual(p.resource * 12);
  });

  it('makes cat energy generation 2x baseline (tuned down from the 2.5x exploit finding)', () => {
    expect(measureCatEnergyPotential(false)).toBe(100);
    expect(measureCatEnergyPotential(true)).toBe(200);
    expect(runClawRotation(false)).toBe(1);
    expect(runClawRotation(true)).toBe(3); // one fewer burst Claw than the 2.5x exploit build
  });

  it('refreshes instead of stacking when cast twice by the same druid', () => {
    const sim = druidWithLifesap();
    const p = sim.player;
    p.resource = 0;
    p.inCombat = true;
    sim.castAbility('innervate');
    p.cooldowns.delete('innervate');
    p.gcdRemaining = 0;
    sim.castAbility('innervate');

    expect(p.auras.filter((a) => a.kind === 'resource_sap')).toHaveLength(1);
    stepTicksWithoutManaRegen(sim, CLASSIC_TICK);
    expect(p.resource).toBe(20);
  });

  it('normal death strips Lifesap and prevents dead-player resource ticks', () => {
    const sim = druidWithLifesap();
    const p = sim.player;
    p.resource = 0;
    sim.castAbility('innervate');
    expect(p.auras.some((a) => a.kind === 'resource_sap')).toBe(true);
    (sim as unknown as SimInternals).dealDamage(
      null,
      p,
      p.hp + 1000,
      false,
      'physical',
      null,
      'hit',
    );

    expect(p.dead).toBe(true);
    expect(p.auras.some((a) => a.kind === 'resource_sap')).toBe(false);
    stepTicks(sim, CLASSIC_TICK);
    expect(p.resource).toBe(0);
  });

  it.each([
    ['stasis', 'stasis'],
    ['polymorph', 'polymorph'],
    ['fear-style incapacitate', 'incapacitate'],
  ] as const)('is stilled while under %s control (the PvP banking fix)', (_label, kind) => {
    const sim = druidWithLifesap();
    const p = sim.player;
    p.resource = 0;
    p.inCombat = true;
    (sim as unknown as SimInternals).applyAura(p, resourceSapAura(p));
    (sim as unknown as SimInternals).applyAura(p, controlAura(p, kind));

    stepTicksWithoutManaRegen(sim, CLASSIC_TICK);
    expect(p.resource).toBe(0); // hard control stills the sap
  });

  it('caps harmlessly at full resource and rounds fractional sap values per tick', () => {
    const sim = druidWithLifesap();
    const p = sim.player;
    p.resource = p.maxResource;
    p.inCombat = true;
    (sim as unknown as SimInternals).applyAura(p, resourceSapAura(p));
    stepTicksWithoutManaRegen(sim, CLASSIC_TICK);
    expect(p.resource).toBe(p.maxResource);

    p.auras = [];
    p.resource = 0;
    (sim as unknown as SimInternals).applyAura(p, resourceSapAura(p, 2.5));
    stepTicksWithoutManaRegen(sim, CLASSIC_TICK);
    expect(p.resource).toBe(3);
  });

  it('is mob-purgeable (the counterplay fix) and player-cancelable as a helpful aura', () => {
    const sim = druidWithLifesap();
    const p = sim.player;
    const aura = resourceSapAura(p);
    (sim as unknown as SimInternals).applyAura(p, aura);

    expect(devourBeneficialAura(sim.ctx, p, 'Spellgnaw')).toBe(true);
    expect(p.auras.some((a) => a.kind === 'resource_sap')).toBe(false);
    (sim as unknown as SimInternals).applyAura(p, resourceSapAura(p));
    expect(isCancelableAura(aura)).toBe(true);
    sim.cancelAura('innervate');
    expect(p.auras.some((a) => a.kind === 'resource_sap')).toBe(false);
  });

  it('derives a normal buff-bar slot for the Lifesap aura', () => {
    const p = new Sim({ seed: 11, playerClass: 'druid', autoEquip: true }).player;
    const view = createAurasView('buffs', {
      iconId: (a) => (ABILITIES[a.id] ? a.id : `aura_${a.kind}`),
      auraName: (a) => ABILITIES[a.id]?.name ?? a.name,
      formatStacks: String,
      auraEffectHtml: () => '',
      durationUnits: () => ({ s: 's', m: 'm', h: 'h', d: 'd' }),
      isOwn: () => false,
    });

    const state = view.tick({ auras: [resourceSapAura(p)] });
    expect(state.count).toBe(1);
    expect(state.slots[0].iconKey).toBe('innervate');
    expect(state.slots[0].name).toBe('Lifesap');
    expect(state.slots[0].isDebuff).toBe(false);
    expect(state.slots[0].durationText).toBe('10s');
  });
});
