import { describe, expect, it } from 'vitest';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import {
  type Aura,
  type Entity,
  FAERIE_FIRE_ARMOR_PCT,
  SUNDER_ARMOR_PCT_PER_STACK,
} from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Standardized percent raid buffs (resurrecting PR #1038 on release/v0.21.0): the six
// iconic buffs are percent, integer-point auras that land on the caster and every
// member of the caster's party/raid regardless of range. Plus the armor-debuff rework
// (Sunder/Faerie Fire as non-stacking percents, Expose Armor's full-cap finisher).

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, id: number, x: number, z: number) {
  const e = sim.entities.get(id)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function formParty(sim: Sim, leader: number, members: number[]) {
  for (const m of members) {
    sim.partyInvite(m, leader);
    sim.partyAccept(m);
  }
}

const ready = (sim: Sim, pid: number) => {
  const e = sim.entities.get(pid)!;
  e.resource = e.maxResource;
};

const blessingAura = (sourceId: number, value: number, remaining = 1800): Aura => ({
  id: 'blessing_of_might',
  name: 'Oath of Iron',
  kind: 'buff_ap_pct',
  remaining,
  duration: remaining,
  value,
  sourceId,
  school: 'holy',
});

describe('standardized percent raid buffs', () => {
  it('the six raid-buff abilities carry the percent-point buffTarget shape', () => {
    const cases: Array<[string, string, number]> = [
      ['battle_shout', 'buff_ap_pct', 10],
      ['arcane_intellect', 'buff_int_pct', 5],
      ['power_word_fortitude', 'buff_sta_pct', 5],
      ['mark_of_the_wild', 'buff_stats_pct', 5],
      ['devotion_aura', 'buff_armor_pct', 10],
      ['blessing_of_might', 'buff_ap_pct', 10],
    ];
    for (const [id, kind, value] of cases) {
      const eff = ABILITIES[id].effects[0] as {
        type: string;
        kind: string;
        value: number;
        party?: boolean;
      };
      expect(eff.type, id).toBe('buffTarget');
      expect(eff.kind, id).toBe(kind);
      expect(eff.value, id).toBe(value);
      expect(eff.party, id).toBe(true);
    }
  });

  it('Arcane Intellect buffs the whole party, even a member far out of range', () => {
    const sim = makeWorld();
    const mage = sim.addPlayer('mage', 'Mira');
    const near = sim.addPlayer('warrior', 'Near');
    const far = sim.addPlayer('rogue', 'Far');
    formParty(sim, mage, [near, far]);
    teleport(sim, mage, 0, 0);
    teleport(sim, near, 5, 0);
    teleport(sim, far, 500, 500); // hundreds of yards away: still gets the buff

    const intBefore = {
      mage: sim.entities.get(mage)!.stats.int,
      near: sim.entities.get(near)!.stats.int,
      far: sim.entities.get(far)!.stats.int,
    };
    ready(sim, mage);
    sim.castAbility('arcane_intellect', mage);

    for (const pid of [mage, near, far]) {
      const e = sim.entities.get(pid)!;
      expect(e.auras.some((a) => a.id === 'arcane_intellect' && a.kind === 'buff_int_pct')).toBe(
        true,
      );
    }
    // +5% Intellect folded into the derived stat, everywhere.
    expect(sim.entities.get(mage)!.stats.int).toBe(Math.round(intBefore.mage * 1.05));
    expect(sim.entities.get(near)!.stats.int).toBe(Math.round(intBefore.near * 1.05));
    expect(sim.entities.get(far)!.stats.int).toBe(Math.round(intBefore.far * 1.05));
  });

  it('a solo caster with no party still buffs itself', () => {
    const sim = makeWorld();
    const mage = sim.addPlayer('mage', 'Solo');
    const intBefore = sim.entities.get(mage)!.stats.int;
    ready(sim, mage);
    sim.castAbility('arcane_intellect', mage);
    expect(sim.entities.get(mage)!.auras.some((a) => a.id === 'arcane_intellect')).toBe(true);
    expect(sim.entities.get(mage)!.stats.int).toBe(Math.round(intBefore * 1.05));
  });

  it('Battle Shout raises party attack power by 10%', () => {
    const sim = makeWorld();
    const warr = sim.addPlayer('warrior', 'Bel');
    const ally = sim.addPlayer('paladin', 'Cal');
    formParty(sim, warr, [ally]);
    const apBefore = sim.entities.get(ally)!.attackPower;
    ready(sim, warr);
    sim.castAbility('battle_shout', warr);
    expect(sim.entities.get(ally)!.auras.some((a) => a.kind === 'buff_ap_pct')).toBe(true);
    expect(sim.entities.get(ally)!.attackPower).toBe(Math.round(apBefore * 1.1));
  });

  it('Power Word: Fortitude raises party Stamina (and thus max HP)', () => {
    const sim = makeWorld();
    const priest = sim.addPlayer('priest', 'Pia');
    const ally = sim.addPlayer('warrior', 'War');
    formParty(sim, priest, [ally]);
    const staBefore = sim.entities.get(ally)!.stats.sta;
    const hpBefore = sim.entities.get(ally)!.maxHp;
    ready(sim, priest);
    sim.castAbility('power_word_fortitude', priest);
    expect(sim.entities.get(ally)!.stats.sta).toBe(Math.round(staBefore * 1.05));
    expect(sim.entities.get(ally)!.maxHp).toBeGreaterThan(hpBefore);
  });

  it('Mark of the Wild raises every primary attribute by 5%', () => {
    const sim = makeWorld();
    const druid = sim.addPlayer('druid', 'Dru');
    const ally = sim.addPlayer('mage', 'Mag');
    formParty(sim, druid, [ally]);
    const before = { ...sim.entities.get(ally)!.stats };
    ready(sim, druid);
    sim.castAbility('mark_of_the_wild', druid);
    const after = sim.entities.get(ally)!.stats;
    expect(after.int).toBe(Math.round(before.int * 1.05));
    expect(after.sta).toBe(Math.round(before.sta * 1.05));
    expect(after.str).toBe(Math.round(before.str * 1.05));
  });

  it('Devotion Aura raises party armor by 10%', () => {
    const sim = makeWorld();
    const pal = sim.addPlayer('paladin', 'Pal');
    const ally = sim.addPlayer('warrior', 'War');
    formParty(sim, pal, [ally]);
    const armorBefore = sim.entities.get(ally)!.stats.armor;
    ready(sim, pal);
    sim.castAbility('devotion_aura', pal);
    expect(sim.entities.get(ally)!.auras.some((a) => a.kind === 'buff_armor_pct')).toBe(true);
    expect(sim.entities.get(ally)!.stats.armor).toBe(Math.round(armorBefore * 1.1));
  });

  it('replaces the previous Blessing of Might from another caster', () => {
    const sim = makeWorld();
    const first = sim.addPlayer('paladin', 'Ald');
    const second = sim.addPlayer('paladin', 'Borin');
    const targetId = sim.addPlayer('warrior', 'War');
    const target = sim.entities.get(targetId)!;
    sim.setPlayerLevel(4, first);
    sim.setPlayerLevel(4, second);

    ready(sim, first);
    sim.targetEntity(targetId, first);
    sim.castAbility('blessing_of_might', first);
    const firstAura = target.auras.find((a) => a.id === 'blessing_of_might')!;
    firstAura.remaining = 1200;

    ready(sim, second);
    sim.targetEntity(targetId, second);
    sim.castAbility('blessing_of_might', second);

    const blessings = target.auras.filter((a) => a.id === 'blessing_of_might');
    expect(blessings).toHaveLength(1);
    expect(blessings[0].sourceId).toBe(second);
    expect(blessings[0].value).toBe(10);
    expect(blessings[0].remaining).toBe(1800);
  });

  it('keeps the newest stronger Blessing of Might value', () => {
    const sim = makeWorld();
    const first = sim.addPlayer('paladin', 'Ald');
    const second = sim.addPlayer('paladin', 'Borin');
    const target = sim.entities.get(sim.addPlayer('warrior', 'War'))!;

    (sim as unknown as { applyAura(target: Entity, aura: Aura): void }).applyAura(
      target,
      blessingAura(first, 10, 900),
    );
    (sim as unknown as { applyAura(target: Entity, aura: Aura): void }).applyAura(
      target,
      blessingAura(second, 15, 1800),
    );

    const blessings = target.auras.filter((a) => a.id === 'blessing_of_might');
    expect(blessings).toHaveLength(1);
    expect(blessings[0].sourceId).toBe(second);
    expect(blessings[0].value).toBe(15);
    expect(blessings[0].duration).toBe(1800);
  });
});

describe('percent armor debuffs (Sunder / Faerie Fire / corrode)', () => {
  const spawnMob = (sim: Sim) => {
    const mob = createMob(970001, MOBS.forest_wolf, 10, { x: 0, y: 0, z: 0 });
    mob.stats.armor = 500;
    sim.entities.set(mob.id, mob);
    return mob;
  };

  it('Sunder is a percent reduction that Faerie Fire does not stack with', () => {
    const sim = makeWorld();
    const mob = spawnMob(sim);
    const base = (sim as any).effectiveArmor(mob);
    expect(base).toBe(500);

    // Two Sunder stacks = 4% off.
    mob.auras.push({
      id: 'sunder_armor',
      name: 'Armor Shear',
      kind: 'sunder',
      remaining: 30,
      duration: 30,
      value: 40,
      stacks: 2,
      sourceId: 1,
      school: 'physical',
    });
    expect((sim as any).effectiveArmor(mob)).toBe(500 * (1 - 2 * SUNDER_ARMOR_PCT_PER_STACK));

    // Add Faerie Fire (flat 10%). It does NOT stack with Sunder: the larger percent
    // wins (max-combine), so effective reduction is 10%, not 4% + 10%.
    mob.auras.push({
      id: 'faerie_fire',
      name: 'Witchlight',
      kind: 'faerie_fire',
      remaining: 40,
      duration: 40,
      value: 0,
      sourceId: 1,
      school: 'nature',
    });
    expect((sim as any).effectiveArmor(mob)).toBe(500 * (1 - FAERIE_FIRE_ARMOR_PCT));
  });

  it('mob corrosion stays a separate FLAT shred, applied before the percent debuffs', () => {
    const sim = makeWorld();
    const mob = spawnMob(sim);
    mob.auras.push({
      id: 'corrode_x',
      name: 'Acid Spit',
      kind: 'corrode',
      remaining: 12,
      duration: 12,
      value: 30,
      stacks: 3,
      sourceId: 1,
      school: 'nature',
    });
    // 30 * 3 = 90 flat off, no percent present.
    expect((sim as any).effectiveArmor(mob)).toBe(500 - 90);
  });

  it('percent armor / attack-power buffs fold into a controlled pet via effective*', () => {
    const sim = makeWorld();
    const pet = createMob(970002, MOBS.forest_wolf, 10, { x: 0, y: 0, z: 0 });
    pet.ownerId = 1; // a controlled pet (players fold these in recalc; pets read live)
    pet.stats.armor = 200;
    pet.attackPower = 80;
    sim.entities.set(pet.id, pet);
    expect((sim as any).effectiveArmor(pet)).toBe(200);
    expect((sim as any).effectiveAttackPower(pet)).toBe(80);

    pet.auras.push({
      id: 'devotion_aura',
      name: 'Steadfast Aura',
      kind: 'buff_armor_pct',
      remaining: 1800,
      duration: 1800,
      value: 10,
      sourceId: 1,
      school: 'holy',
    });
    pet.auras.push({
      id: 'battle_shout',
      name: 'Iron Bellow',
      kind: 'buff_ap_pct',
      remaining: 120,
      duration: 120,
      value: 10,
      sourceId: 1,
      school: 'physical',
    });
    expect((sim as any).effectiveArmor(pet)).toBe(200 + (200 * 10) / 100);
    expect((sim as any).effectiveAttackPower(pet)).toBe(80 + (80 * 10) / 100);
  });

  it('a percent Stamina buff scales a pet HP pool and unwinds on removal', () => {
    const sim = makeWorld();
    const pet = createMob(970003, MOBS.forest_wolf, 10, { x: 0, y: 0, z: 0 });
    pet.ownerId = 1;
    sim.entities.set(pet.id, pet);
    const base = pet.maxHp;
    const aura = {
      id: 'power_word_fortitude',
      name: 'Litany of Resolve',
      kind: 'buff_sta_pct' as const,
      remaining: 1800,
      duration: 1800,
      value: 5,
      sourceId: 1,
      school: 'holy' as const,
    };
    (sim as any).applyNonPlayerStatAura(pet, aura, 1);
    expect(pet.maxHp).toBe(base + Math.round(base * 0.05));
    (sim as any).applyNonPlayerStatAura(pet, aura, -1);
    expect(pet.maxHp).toBe(base);
  });

  it('Expose Armor lands the full Sunder cap (5 stacks = 10%) in one cast', () => {
    expect(ABILITIES.expose_armor.effects[0]).toMatchObject({
      type: 'sunder',
      maxStacks: 5,
      full: true,
    });
    const sim = makeWorld();
    const mob = spawnMob(sim);
    mob.auras.push({
      id: 'expose_armor',
      name: 'Armor Breach',
      kind: 'sunder',
      remaining: 30,
      duration: 30,
      value: 170,
      stacks: 5, // full cap applied at once
      sourceId: 1,
      school: 'physical',
    });
    expect((sim as any).effectiveArmor(mob)).toBe(500 * (1 - 5 * SUNDER_ARMOR_PCT_PER_STACK));
  });
});
