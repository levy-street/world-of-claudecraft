// The trinkets' mechanics (src/sim/combat/trinkets.ts, data in
// src/sim/content/trinkets.ts): using the worn trinket through useItem, its
// cooldown, and every use and passive against a real Sim.
import { describe, expect, it } from 'vitest';
import { applyHeal } from '../src/sim/combat/heal';
import { restorableCooldown } from '../src/sim/combat/trinket_seams';
import { runTrinketTrigger, TRINKET_EQUIP_LOCKOUT } from '../src/sim/combat/trinkets';
import {
  GAMBLE,
  TRINKET_AURA,
  TRINKET_ITEMS,
  TRINKET_SPECS,
  trinketCooldownKey,
} from '../src/sim/content/trinkets';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type PlayerClass, type SimEvent } from '../src/sim/types';

function wearing(itemId: string, cls: PlayerClass = 'warrior', seed = 11) {
  const sim = new Sim({ seed, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  sim.addItem(itemId, 1);
  sim.equipItem(itemId);
  // Skip the 30 sec on-equip lockout: these tests exercise the use itself.
  sim.player.cooldowns.delete(`trinket:${itemId}`);
  expect(sim.equipment.trinket).toBe(itemId);
  sim.drainEvents();
  return sim;
}

function foe(sim: Sim, distance = 3, hp = 20000): Entity {
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + distance,
  });
  mob.maxHp = hp;
  mob.hp = hp;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const damageBy = (events: SimEvent[], ability: string) =>
  events.filter((ev) => ev.type === 'damage' && ev.ability === ability);

describe('the trinket catalog', () => {
  it('ships eighteen trinkets, each with one attribute and a use', () => {
    const ids = Object.keys(TRINKET_ITEMS);
    expect(ids).toHaveLength(18);
    for (const id of ids) {
      const item = TRINKET_ITEMS[id];
      expect(item.slot).toBe('trinket');
      expect(Object.keys(item.stats ?? {})).toHaveLength(1);
      expect(TRINKET_SPECS[id]?.cooldown).toBeGreaterThan(0);
      expect(TRINKET_SPECS[id]?.use).toBeDefined();
    }
  });

  it('keeps a trinket cooldown through a relog', () => {
    expect(restorableCooldown(trinketCooldownKey('stormjar'))).toBe(true);
    expect(restorableCooldown('not_an_ability')).toBe(false);
  });
});

describe('using a worn trinket', () => {
  it('uses it where it sits, starts its cooldown, and refuses while cooling down', () => {
    const sim = wearing('wayfarers_lodestone');
    sim.useItem('wayfarers_lodestone');
    expect(aura(sim.player, TRINKET_AURA.sprint)?.kind).toBe('buff_speed');
    const key = trinketCooldownKey('wayfarers_lodestone');
    expect(sim.player.cooldowns.get(key)).toBe(TRINKET_SPECS.wayfarers_lodestone.cooldown);
    // Still worn, never consumed.
    expect(sim.equipment.trinket).toBe('wayfarers_lodestone');
    sim.player.auras = sim.player.auras.filter((a) => a.id !== TRINKET_AURA.sprint);
    sim.useItem('wayfarers_lodestone');
    expect(aura(sim.player, TRINKET_AURA.sprint)).toBeUndefined();
  });

  it('never fires a trinket that sits in the bags', () => {
    // Another trinket is worn; the Lodestone sits in the bags.
    const sim = wearing('gamblers_die');
    sim.addItem('wayfarers_lodestone', 1);
    expect(sim.equipment.trinket).toBe('gamblers_die');
    // Using gear from the bags puts it on, as ever: the swap fires no effect,
    // and the freshly worn trinket starts only its on-equip lockout.
    sim.useItem('wayfarers_lodestone');
    expect(aura(sim.player, TRINKET_AURA.sprint)).toBeUndefined();
    expect(sim.player.cooldowns.get(trinketCooldownKey('wayfarers_lodestone'))).toBe(
      TRINKET_EQUIP_LOCKOUT,
    );
  });
});

describe('the on-equip lockout', () => {
  it('a freshly equipped trinket waits 30 sec before it can be used', () => {
    const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.addItem('wayfarers_lodestone', 1);
    sim.equipItem('wayfarers_lodestone');
    const key = trinketCooldownKey('wayfarers_lodestone');
    expect(sim.player.cooldowns.get(key)).toBe(TRINKET_EQUIP_LOCKOUT);
    sim.useItem('wayfarers_lodestone');
    expect(aura(sim.player, TRINKET_AURA.sprint)).toBeUndefined();
  });

  it("swapping in another trinket inherits the used one's longer wait", () => {
    const sim = wearing('wayfarers_lodestone');
    sim.useItem('wayfarers_lodestone');
    const left = sim.player.cooldowns.get(trinketCooldownKey('wayfarers_lodestone')) ?? 0;
    expect(left).toBe(TRINKET_SPECS.wayfarers_lodestone.cooldown);
    sim.addItem('sundered_prism', 1);
    sim.equipItem('sundered_prism');
    expect(sim.equipment.trinket).toBe('sundered_prism');
    expect(sim.player.cooldowns.get(trinketCooldownKey('sundered_prism'))).toBe(left);
    // Swapping straight back keeps the original wait too: no chained uses.
    sim.equipItem('wayfarers_lodestone');
    expect(sim.player.cooldowns.get(trinketCooldownKey('wayfarers_lodestone'))).toBe(left);
  });
});

describe('the tank trinkets', () => {
  it('Bastion Sigil: a killing hit raises no shield on the corpse and keeps the cooldown', () => {
    const sim = wearing('bastion_sigil');
    const mob = foe(sim);
    const p = sim.player;
    p.hp = Math.round(p.maxHp * 0.1);
    sim.ctx.dealDamage(mob, p, p.maxHp * 2, false, 'physical', 'Bite', 'hit');
    expect(p.dead).toBe(true);
    expect(aura(p, TRINKET_AURA.lastStand)).toBeUndefined();
    expect(aura(p, TRINKET_AURA.lastStandIcd)).toBeUndefined();
  });

  it('Bastion Sigil: a last-stand shield below 35%, once per cooldown; the ward strikes back', () => {
    const sim = wearing('bastion_sigil');
    const mob = foe(sim);
    const p = sim.player;
    p.hp = Math.round(p.maxHp * 0.5);
    sim.ctx.dealDamage(mob, p, Math.round(p.maxHp * 0.2), false, 'physical', 'Bite', 'hit');
    const shield = aura(p, TRINKET_AURA.lastStand);
    expect(shield?.kind).toBe('absorb');
    expect(shield?.value).toBe(Math.round(p.maxHp * 0.15));
    p.auras = p.auras.filter((a) => a.id !== TRINKET_AURA.lastStand);
    sim.ctx.dealDamage(mob, p, 10, false, 'physical', 'Bite', 'hit');
    expect(aura(p, TRINKET_AURA.lastStand)).toBeUndefined();

    p.hp = p.maxHp;
    sim.useItem('bastion_sigil');
    sim.drainEvents();
    const mobHp = mob.hp;
    sim.ctx.dealDamage(mob, p, 100, false, 'physical', 'Bite', 'hit');
    expect(mob.hp).toBe(mobHp - 30);
  });

  it('Mooring Stone: shrugs off control and knockbacks, takes less damage, moves slower', () => {
    const sim = wearing('mooring_stone');
    const mob = foe(sim);
    const p = sim.player;
    const control = (kind: 'stun' | 'root') =>
      sim.ctx.applyAura(p, {
        id: `test_${kind}`,
        name: `Test ${kind}`,
        kind,
        remaining: 5,
        duration: 5,
        value: 0,
        sourceId: mob.id,
        school: 'physical',
      });
    // It cannot be used while already stunned: only the Medallion frees you.
    control('stun');
    sim.useItem('mooring_stone');
    expect(aura(p, TRINKET_AURA.anchor)).toBeUndefined();
    p.auras = p.auras.filter((a) => a.kind !== 'stun');
    // Used, it keeps every new control off, and every shove.
    sim.useItem('mooring_stone');
    expect(aura(p, TRINKET_AURA.anchor)).toBeDefined();
    control('stun');
    control('root');
    expect(p.auras.some((a) => a.kind === 'stun' || a.kind === 'root')).toBe(false);
    expect(sim.ctx.applyKnockback(mob, p, 10)).toBe(0);
    expect(aura(p, TRINKET_AURA.anchorGuard)?.kind).toBe('shield_wall');
  });
});

describe('the healer trinkets', () => {
  it("Mender's Hourglass: overhealing fills it (capped), and a use shields the most wounded", () => {
    const sim = wearing('menders_hourglass', 'priest');
    const p = sim.player;
    p.hp = p.maxHp;
    applyHeal(sim.ctx, p, p, 5000, 'Test Heal');
    const cap = Math.round(p.maxHp * 0.3);
    expect(aura(p, TRINKET_AURA.hourglass)?.value).toBe(cap);
    sim.useItem('menders_hourglass');
    expect(aura(p, TRINKET_AURA.hourglassShield)?.value).toBe(cap);
    expect(aura(p, TRINKET_AURA.hourglass)).toBeUndefined();
  });

  it("Mender's Hourglass: an empty hourglass costs no cooldown", () => {
    const sim = wearing('menders_hourglass', 'priest');
    sim.useItem('menders_hourglass');
    expect(sim.player.cooldowns.get(trinketCooldownKey('menders_hourglass')) ?? 0).toBe(0);
  });

  it('Wellspring Seed: heals over time everyone standing near', () => {
    const sim = wearing('wellspring_seed', 'priest');
    sim.useItem('wellspring_seed');
    const hot = aura(sim.player, TRINKET_AURA.wellspring);
    expect(hot?.kind).toBe('hot');
    const use = TRINKET_SPECS.wellspring_seed.use as { tick: number; coef: number };
    expect(hot?.value).toBe(Math.round(use.tick + use.coef * sim.player.healPower));
  });
});

describe('the physical trinkets', () => {
  it('Paired Talons: while used, every weapon hit opens a stacking bleed', () => {
    const sim = wearing('paired_talons', 'rogue');
    const mob = foe(sim);
    sim.useItem('paired_talons');
    // Weapon hits ride the weapon-proc hook.
    sim.player.autoAttack = true;
    for (let t = 0; t < 8; t += DT) sim.tick();
    const bleed = mob.auras.find((a) => a.id === TRINKET_AURA.bleed);
    expect(bleed?.kind).toBe('dot');
    expect(bleed?.stacks ?? 0).toBeGreaterThan(0);
  });

  it('Paired Talons: a dead wearer opens no bleed', () => {
    const sim = wearing('paired_talons', 'rogue');
    const mob = foe(sim);
    sim.useItem('paired_talons');
    sim.player.dead = true;
    runTrinketTrigger(sim.ctx, sim.player, mob, 'weaponHit');
    expect(aura(mob, TRINKET_AURA.bleed)).toBeUndefined();
    sim.player.dead = false;
    runTrinketTrigger(sim.ctx, sim.player, mob, 'weaponHit');
    expect(aura(mob, TRINKET_AURA.bleed)?.kind).toBe('dot');
  });

  it('Paired Talons: the extra swing needs the target in melee reach', () => {
    const rolls = (distance: number) => {
      const sim = wearing('paired_talons', 'hunter');
      const mob = foe(sim, distance);
      let swings = 0;
      for (let i = 0; i < 400; i++) {
        runTrinketTrigger(sim.ctx, sim.player, mob, 'weaponHit');
        const icd = sim.player.auras.findIndex((a) => a.id === TRINKET_AURA.twinStrikeIcd);
        if (icd >= 0) {
          swings++;
          sim.player.auras.splice(icd, 1);
        }
      }
      return swings;
    };
    expect(rolls(3)).toBeGreaterThan(0);
    // A hunter's auto-shot at 25 yd lands as a weapon hit too: never a melee swing.
    expect(rolls(25)).toBe(0);
  });

  it("Hunter's Tally: crits and kills mark, a use spends every mark on one strike", () => {
    const sim = wearing('hunters_tally');
    const mob = foe(sim);
    for (let i = 0; i < 4; i++) sim.ctx.applySetProcs(sim.player, mob, 'weaponCrit');
    expect(aura(sim.player, TRINKET_AURA.tally)?.stacks).toBe(4);
    sim.drainEvents();
    sim.useItem('hunters_tally');
    const hits = damageBy(sim.drainEvents(), "Hunter's Tally");
    expect(hits).toHaveLength(1);
    expect(aura(sim.player, TRINKET_AURA.tally)).toBeUndefined();
  });
});

describe('the caster trinkets', () => {
  it('Stormjar: spells charge it, a use chains the charge through the pack', () => {
    const sim = wearing('stormjar', 'mage');
    const first = foe(sim, 6);
    const second = foe(sim, 10);
    sim.targetEntity(first.id);
    for (let i = 0; i < 5; i++) sim.ctx.applySetProcs(sim.player, first, 'spellCast');
    expect(aura(sim.player, TRINKET_AURA.storm)?.stacks).toBe(5);
    sim.drainEvents();
    sim.useItem('stormjar');
    const hits = damageBy(sim.drainEvents(), 'Stormjar');
    const struck = new Set(hits.map((ev) => (ev as { targetId: number }).targetId));
    expect(struck.has(first.id)).toBe(true);
    expect(struck.has(second.id)).toBe(true);
  });

  it('Echoing Lens: the next spell hits echo for a share, three times', () => {
    const sim = wearing('echoing_lens', 'mage');
    const mob = foe(sim, 8);
    sim.useItem('echoing_lens');
    sim.drainEvents();
    sim.ctx.dealDamage(sim.player, mob, 100, false, 'fire', 'Fireball', 'hit');
    const echoes = damageBy(sim.drainEvents(), 'Echoing Lens');
    expect(echoes).toHaveLength(1);
    expect(aura(sim.player, TRINKET_AURA.echo)?.stacks).toBe(2);
  });
});

describe('the rest', () => {
  it("Gambler's Die: always one fortune, announced; snake eyes refunds half the wait", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 40 && seen.size < 4; seed++) {
      const sim = wearing('gamblers_die', 'warrior', seed);
      sim.useItem('gamblers_die');
      const roll = sim.drainEvents().find((ev) => ev.type === 'trinketGamble') as
        | { fortune: string }
        | undefined;
      expect(roll).toBeDefined();
      seen.add(roll!.fortune);
      const cd = sim.player.cooldowns.get(trinketCooldownKey('gamblers_die'));
      const full = TRINKET_SPECS.gamblers_die.cooldown;
      expect(cd).toBe(
        roll!.fortune === 'snakeEyes' ? Math.round(full * (1 - GAMBLE.snakeEyesRefund)) : full,
      );
    }
    expect(seen.size).toBe(4);
  }, 60_000);

  it('Sundered Prism: a step forward and a moment of guard', () => {
    const sim = wearing('sundered_prism');
    const before = { ...sim.player.pos };
    sim.useItem('sundered_prism');
    expect(Math.hypot(sim.player.pos.x - before.x, sim.player.pos.z - before.z)).toBeGreaterThan(1);
    expect(aura(sim.player, TRINKET_AURA.riftGuard)?.kind).toBe('shield_wall');
  });

  it('Medallion of Defiance: works while stunned and breaks every control', () => {
    const sim = wearing('medallion_of_defiance');
    const mob = foe(sim);
    for (const kind of ['stun', 'root', 'slow'] as const) {
      sim.ctx.applyAura(sim.player, {
        id: `test_${kind}`,
        name: `Test ${kind}`,
        kind,
        remaining: 5,
        duration: 5,
        value: kind === 'slow' ? 0.5 : 0,
        sourceId: mob.id,
        school: 'physical',
      });
    }
    sim.useItem('medallion_of_defiance');
    expect(sim.player.auras.some((a) => ['stun', 'root', 'slow'].includes(a.kind))).toBe(false);
  });

  it("Duelist's Brand: only an enemy player can be branded", () => {
    const sim = wearing('duelists_brand');
    foe(sim);
    sim.useItem('duelists_brand');
    expect(sim.player.cooldowns.get(trinketCooldownKey('duelists_brand')) ?? 0).toBe(0);
  });
});

describe('determinism', () => {
  it('a character without a trinket plays byte for byte as before', () => {
    const run = (withTrinket: boolean) => {
      const sim = new Sim({ seed: 21, playerClass: 'warrior', autoEquip: true });
      sim.setPlayerLevel(20);
      if (withTrinket) {
        sim.addItem('wayfarers_lodestone', 1);
      }
      const mob = foe(sim);
      sim.player.autoAttack = true;
      for (let t = 0; t < 10; t += DT) sim.tick();
      return mob.hp;
    };
    // A trinket in the bags (not worn) changes nothing.
    expect(run(true)).toBe(run(false));
  });
});
