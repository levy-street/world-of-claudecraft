import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const makeSim = () => new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true, noPlayer: true });
const ent = (sim: Sim, pid: number) => (sim as any).entities.get(pid) as Entity;

// Cast `ability` from `caster`, optionally at `targetId` (set as the caster's
// target first, since castAbility resolves the caster's current target), then tick
// once to resolve the instant cast.
function cast(sim: Sim, ability: string, caster: number, targetId?: number) {
  if (targetId !== undefined) sim.targetEntity(targetId, caster);
  sim.castAbility(ability, caster);
  sim.tick();
}

// Two players in a party, both level 20, co-located (within buff range).
function party(sim: Sim, casterCls: string, allyCls: string) {
  const caster = sim.addPlayer(casterCls as never, 'Caster');
  const ally = sim.addPlayer(allyCls as never, 'Ally');
  sim.setPlayerLevel(20, caster);
  sim.setPlayerLevel(20, ally);
  sim.partyInvite(ally, caster);
  sim.partyAccept(ally);
  const c = ent(sim, caster);
  ent(sim, caster).resource = c.maxResource;
  ent(sim, ally).pos = { ...c.pos }; // co-locate so both are within the buff's range
  return { caster, ally };
}

describe('caster buff balance: percent raid buffs are party-wide within range', () => {
  it('Mark of the Wild grants +5% to all attributes of the whole party', () => {
    const sim = makeSim();
    const { caster, ally } = party(sim, 'druid', 'warrior');
    const before = { ...ent(sim, ally).stats };
    cast(sim, 'mark_of_the_wild', caster, ally);
    const a = ent(sim, ally);
    expect(a.auras.some((x) => x.kind === 'buff_allstats_pct')).toBe(true);
    expect(a.stats.str).toBe(Math.round(before.str * 1.05));
    expect(a.stats.sta).toBe(Math.round(before.sta * 1.05));
    expect(ent(sim, caster).auras.some((x) => x.kind === 'buff_allstats_pct')).toBe(true);
  });

  it('Arcane Intellect grants the party +5% Intellect', () => {
    const sim = makeSim();
    const { caster, ally } = party(sim, 'mage', 'priest');
    const before = ent(sim, ally).stats.int;
    cast(sim, 'arcane_intellect', caster);
    expect(ent(sim, ally).stats.int).toBe(Math.round(before * 1.05));
  });

  it('Power Word: Fortitude grants the party +5% Stamina', () => {
    const sim = makeSim();
    const { caster, ally } = party(sim, 'priest', 'warrior');
    const before = ent(sim, ally).stats.sta;
    cast(sim, 'power_word_fortitude', caster, ally);
    expect(ent(sim, ally).stats.sta).toBe(Math.round(before * 1.05));
  });

  it('Blessing of Might grants the party +10% attack power', () => {
    const sim = makeSim();
    const { caster, ally } = party(sim, 'paladin', 'warrior');
    const before = ent(sim, ally).attackPower;
    cast(sim, 'blessing_of_might', caster, ally);
    expect(ent(sim, ally).attackPower).toBe(Math.round(before * 1.1));
  });

  it('Devotion Aura grants the party +10% armor', () => {
    const sim = makeSim();
    const { caster, ally } = party(sim, 'paladin', 'warrior');
    const before = ent(sim, ally).stats.armor;
    cast(sim, 'devotion_aura', caster);
    expect(ent(sim, ally).stats.armor).toBe(Math.round(before * 1.1));
  });

  it('Battle Shout grants the party +10% attack power', () => {
    const sim = makeSim();
    const { caster, ally } = party(sim, 'warrior', 'rogue');
    const before = ent(sim, ally).attackPower;
    cast(sim, 'battle_shout', caster);
    expect(ent(sim, ally).attackPower).toBe(Math.round(before * 1.1));
  });

  it('a party member out of range does not get the buff', () => {
    const sim = makeSim();
    const { caster, ally } = party(sim, 'druid', 'warrior');
    ent(sim, ally).pos = { x: ent(sim, caster).pos.x + 500, y: 0, z: ent(sim, caster).pos.z };
    cast(sim, 'mark_of_the_wild', caster, caster);
    expect(ent(sim, ally).auras.some((x) => x.kind === 'buff_allstats_pct')).toBe(false);
    expect(ent(sim, caster).auras.some((x) => x.kind === 'buff_allstats_pct')).toBe(true);
  });
});

describe('caster buff balance: Thorns scales with Spell Power', () => {
  it('reflect value exceeds the flat rank value by a Spell Power term', () => {
    const sim = makeSim();
    const druid = sim.addPlayer('druid', 'Dru');
    sim.setPlayerLevel(20, druid);
    ent(sim, druid).resource = ent(sim, druid).maxResource;
    expect(ent(sim, druid).spellPower).toBeGreaterThan(0);
    cast(sim, 'thorns', druid, druid);
    const thorns = ent(sim, druid).auras.find((x) => x.kind === 'thorns');
    expect(thorns).toBeDefined();
    // rank-3 flat value at level 20 is 9; Spell Power adds on top.
    expect(thorns!.value).toBeGreaterThan(9);
  });
});

describe('caster buff balance: armor debuffs are percentages that do not stack', () => {
  it('Faerie Fire uses the percent effect, and Sunder/Faerie max-combine (no stack)', () => {
    const sim = makeSim();
    // Faerie Fire is wired to the dedicated percent-armor effect, NOT flat 'sunder'.
    const ff = ABILITIES.faerie_fire;
    expect(ff.effects.some((e) => e.type === 'faerieFire')).toBe(true);
    expect(ff.effects.some((e) => e.type === 'sunder')).toBe(false);

    const id = (sim as any).nextId++;
    const target = createMob(id, MOBS.forest_wolf, 10, { x: 0, y: 0, z: 0 });
    const ea = (sim as any).effectiveArmor.bind(sim) as (e: Entity) => number;
    const base = ea({ ...target, auras: [] } as Entity);
    const oneSunder = ea({ ...target, auras: [{ kind: 'sunder', value: 25, stacks: 1 }] } as never);
    const fullSunder = ea({
      ...target,
      auras: [{ kind: 'sunder', value: 25, stacks: 5 }],
    } as never);
    const faerie = ea({ ...target, auras: [{ kind: 'faerie_fire', value: 0 }] } as never);
    const both = ea({
      ...target,
      auras: [
        { kind: 'faerie_fire', value: 0 },
        { kind: 'sunder', value: 25, stacks: 5 },
      ],
    } as never);
    expect(oneSunder).toBeCloseTo(base * 0.98, 5); // 2% per stack
    expect(fullSunder).toBeCloseTo(base * 0.9, 5); // 10% at 5 stacks
    expect(faerie).toBeCloseTo(base * 0.9, 5); // flat 10%
    expect(both).toBeCloseTo(base * 0.9, 5); // non-stacking: max(10%, 10%), not 19%
  });

  it('Expose Armor is a finisher that lands the full 10% (5-stack) cap in one cast', () => {
    const expose = ABILITIES.expose_armor;
    const eff = expose.effects.find((e) => e.type === 'sunder');
    expect(eff).toBeDefined();
    if (eff?.type !== 'sunder') throw new Error('expected sunder effect');
    expect(eff.full).toBe(true);
    expect(eff.maxStacks).toBe(5);
  });

  it('mob corrosion is a SEPARATE flat shred, untouched by the percent Sunder model', () => {
    const sim = makeSim();
    const id = (sim as any).nextId++;
    const target = createMob(id, MOBS.forest_wolf, 10, { x: 0, y: 0, z: 0 });
    const ea = (sim as any).effectiveArmor.bind(sim) as (e: Entity) => number;
    const base = ea({ ...target, auras: [] } as Entity);
    // 'corrode' subtracts value*stacks flat, independent of the Sunder percent.
    const corroded = ea({ ...target, auras: [{ kind: 'corrode', value: 6, stacks: 3 }] } as never);
    expect(corroded).toBeCloseTo(base - 18, 5);
  });
});

describe('caster buff balance: heals scale with Spell Power; shadow priest density', () => {
  it('Renew per-tick value includes a Spell Power term', () => {
    const sim = makeSim();
    const priest = sim.addPlayer('priest', 'Pr');
    sim.setPlayerLevel(20, priest);
    expect(ent(sim, priest).spellPower).toBeGreaterThan(0);
    cast(sim, 'renew', priest, priest);
    const renew = ent(sim, priest).auras.find((x) => x.kind === 'hot');
    expect(renew).toBeDefined();
    const def = ABILITIES.renew;
    const hotEff = def.effects.find((e) => e.type === 'hot') as {
      total: number;
      duration: number;
      interval: number;
    };
    const base = Math.max(1, Math.round(hotEff.total / (hotEff.duration / hotEff.interval)));
    expect(renew!.value).toBeGreaterThan(base);
  });

  it('Mind Blast has a 6s cooldown (denser shadow rotation)', () => {
    expect(ABILITIES.mind_blast.cooldown).toBe(6);
  });
});
