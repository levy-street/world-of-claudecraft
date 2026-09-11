import { describe, expect, it, vi } from 'vitest';
import { updateAuras } from '../src/sim/combat/auras';
import { meleeSwing, rangedSwing } from '../src/sim/combat/auto_attack';
import { runWeaponProcs } from '../src/sim/combat/equip_procs';
import { baseSwingSpeed } from '../src/sim/combat/form_swing';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob, createPlayer, recalcPlayerStats } from '../src/sim/entity';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { type Aura, DT } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const ENCHANT = 'enchant_weapon_lastflame_zeal';

function harness() {
  const wielder = createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Crafter');
  const target = createPlayer(2, 'warrior', { x: 2, y: 0, z: 0 }, 'Target');
  wielder.level = 20;
  wielder.auras = [];
  wielder.mainhandItemId = 'duskforged_warblade';
  wielder.offhandItemId = 'duskforged_warblade';
  const equipmentInstance = {
    mainhand: { enchant: ENCHANT },
    offhand: { enchant: ENCHANT },
  };
  const raw = {
    rng: { chance: vi.fn(() => true) },
    players: new Map([[wielder.id, { equipmentInstance }]]),
    applyAura: (_target: unknown, aura: Aura) => {
      wielder.auras = wielder.auras.filter((active) => active.id !== aura.id);
      wielder.auras.push(aura);
    },
    applyHeal: vi.fn(),
    emit: vi.fn(),
  };
  return { wielder, target, raw, ctx: raw as unknown as SimContext };
}

function meleeHarness(itemId: string, seed = 44) {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: false,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(20);
  const source = sim.player;
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  const meta = sim.players.get(source.id);
  if (!meta) throw new Error('fixture player missing');
  meta.equipment.mainhand = itemId;
  meta.equipmentInstance.mainhand = { enchant: ENCHANT };
  recalcPlayerStats(source, 'warrior', meta.equipment, meta.talentMods, meta.equipmentInstance);
  return { sim, source, ctx };
}

function trainingTarget(sim: Sim, hp: number, id = 9500) {
  const target = createMob(id, MOBS.training_dummy, 20, {
    ...sim.player.pos,
    z: sim.player.pos.z + 2,
  });
  target.maxHp = target.hp = hp;
  target.hostile = true;
  sim.entities.set(target.id, target);
  return target;
}

function differentSpeedHands() {
  const fixture = meleeHarness('duskforged_warblade');
  const { sim, source } = fixture;
  expect(sim.setSpec('fury')).toBe(true);
  const meta = sim.players.get(source.id);
  if (!meta) throw new Error('fixture player missing');
  meta.equipment.offhand = 'rusty_dagger';
  meta.equipmentInstance.offhand = { enchant: ENCHANT };
  recalcPlayerStats(source, 'warrior', meta.equipment, meta.talentMods, meta.equipmentInstance);
  expect(source.dualWielding).toBe(true);
  expect(source.weapon.speed).toBe(2.5);
  expect(source.offhandWeapon?.speed).toBe(1.8);
  expect(source.auras.some((aura) => aura.kind === 'buff_stats_pct')).toBe(false);
  return { ...fixture, target: trainingTarget(sim, 100_000) };
}

describe("Last Flame's Zeal", () => {
  it.each(['rusty_dagger', 'duskforged_warblade', 'ridgebreaker'])(
    'normalizes ordinary weapon %s from its own base speed',
    (itemId) => {
      const { ctx, raw, wielder, target } = harness();
      wielder.mainhandItemId = itemId;
      runWeaponProcs(ctx, wielder, target, 'weaponHit', itemId, 'mainhand');
      const item = ITEMS[itemId];
      if (item.kind !== 'weapon') throw new Error('fixture weapon missing');
      expect(raw.rng.chance).toHaveBeenCalledExactlyOnceWith(item.weapon.speed / 60);
    },
  );

  it.each([
    ['form_cat', 1],
    ['form_bear', 3.4],
  ] as const)(
    'uses the un-hasted natural weapon speed for %s autos and specials',
    (form, speed) => {
      const sim = new Sim({ seed: 44, playerClass: 'druid', autoEquip: false });
      sim.setPlayerLevel(20);
      const source = sim.player;
      const ctx = (sim as unknown as { ctx: SimContext }).ctx;
      const meta = sim.players.get(source.id)!;
      meta.equipment.mainhand = 'ridgebreaker';
      meta.equipmentInstance.mainhand = { enchant: ENCHANT };
      ctx.applyAura(source, {
        id: form,
        name: 'Form',
        kind: form,
        value: 0,
        remaining: 100,
        duration: 100,
        sourceId: source.id,
        school: 'nature',
      });
      ctx.applyAura(source, {
        id: 'test_haste',
        name: 'Haste',
        kind: 'buff_haste',
        value: 1.5,
        remaining: 100,
        duration: 100,
        sourceId: source.id,
        school: 'nature',
      });
      expect(baseSwingSpeed(source)).toBe(speed);
      const target = createMob(9500, MOBS.training_dummy, 20, {
        ...source.pos,
        z: source.pos.z + 2,
      });
      target.maxHp = target.hp = 100_000;
      target.hostile = true;
      sim.entities.set(target.id, target);
      const next = vi.spyOn(ctx.rng, 'next').mockReturnValue(0.5);
      const chance = vi.spyOn(ctx.rng, 'chance').mockReturnValue(true);
      meleeSwing(ctx, source, target, 0, null, {
        autoAttackHand: 'mainhand',
        autoAttack: true,
      });
      expect(chance.mock.calls.at(-1)?.[0]).toBe(speed / 60);
      chance.mockClear();
      meleeSwing(ctx, source, target, 0, 'Claw', {
        abilityId: 'claw',
        normalizedInstant: true,
      });
      expect(chance.mock.calls.at(-1)?.[0]).toBe(speed / 60);
      next.mockRestore();
      chance.mockRestore();
    },
  );

  it('a real ranged Auto Shot cannot trigger the mainhand melee enchant', () => {
    const sim = new Sim({ seed: 44, playerClass: 'hunter', autoEquip: false });
    sim.setPlayerLevel(20);
    const source = sim.player;
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    const meta = sim.players.get(source.id)!;
    meta.equipment.mainhand = 'ridgebreaker';
    meta.equipmentInstance.mainhand = { enchant: ENCHANT };
    recalcPlayerStats(source, 'hunter', meta.equipment, meta.talentMods, meta.equipmentInstance);
    const target = createMob(9500, MOBS.training_dummy, 20, {
      ...source.pos,
      z: source.pos.z + 8,
    });
    target.maxHp = target.hp = 100_000;
    target.hostile = true;
    sim.entities.set(target.id, target);
    const chance = vi.spyOn(ctx.rng, 'chance').mockReturnValue(false);
    rangedSwing(ctx, source, target, { min: 10, max: 10, speed: 3.4 });
    for (let tick = 0; tick < 20; tick++) advancePendingProjectiles(ctx);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(source.auras.some((aura) => aura.kind === 'buff_str')).toBe(false);
    expect(chance.mock.calls.some(([probability]) => probability === 3.4 / 60)).toBe(false);
    chance.mockRestore();
  });
  it('defines the learned skill-100 recipe and exact visible combat values', () => {
    expect(ENCHANTS[ENCHANT]).toMatchObject({
      skillReq: 100,
      acquisition: 'drop',
      statBonus: {},
      weaponProc: { ppm: 1, strength: 50, duration: 15, heal: 200 },
      reagents: [
        { itemId: 'lastflame_core', count: 3 },
        { itemId: 'arcane_shard', count: 2 },
      ],
    });
    expect(ENCHANTS[ENCHANT].description).toContain('50 Strength for 15 sec');
    expect(ENCHANTS[ENCHANT].description).toContain('200');
  });

  it('uses base weapon speed / 60 and grants real Strength plus non-recursive healing', () => {
    const { ctx, raw, wielder, target } = harness();
    runWeaponProcs(ctx, wielder, target, 'weaponHit', wielder.mainhandItemId, 'mainhand');
    const item = ITEMS.duskforged_warblade;
    expect(item.kind).toBe('weapon');
    if (item.kind !== 'weapon') throw new Error('fixture weapon missing');
    expect(raw.rng.chance).toHaveBeenCalledExactlyOnceWith(item.weapon.speed / 60);
    expect(wielder.auras).toHaveLength(1);
    expect(wielder.auras[0]).toMatchObject({
      kind: 'buff_str',
      value: 50,
      duration: 15,
    });
    expect(raw.applyHeal).toHaveBeenCalledWith(
      wielder,
      wielder,
      200,
      "Last Flame's Zeal",
      ENCHANT,
      false,
      false,
    );
  });

  it('both hands share ONE buff: an off-hand trigger refreshes it instead of stacking a second', () => {
    // The live bug: the aura id carried the striking hand, so a dual-wielder
    // with both weapons enchanted stacked two 50 Strength buffs (100 total).
    // The buff is keyed by the enchant alone now, so the harness's same-id
    // replacement (the Sim's refresh rule) collapses both hands onto one aura.
    const { ctx, raw, wielder, target } = harness();
    runWeaponProcs(ctx, wielder, target, 'weaponHit', wielder.mainhandItemId, 'mainhand');
    wielder.auras[0].remaining = 1;
    runWeaponProcs(ctx, wielder, target, 'weaponHit', wielder.offhandItemId, 'offhand');
    expect(wielder.auras).toHaveLength(1);
    expect(wielder.auras[0]).toMatchObject({
      id: ENCHANT,
      kind: 'buff_str',
      value: 50,
      remaining: 15,
      duration: 15,
    });
    expect(wielder.auras.reduce((total, aura) => total + aura.value, 0)).toBe(50);
    expect(raw.rng.chance).toHaveBeenCalledTimes(2);
    // The refreshing trigger still heals: the 200 heal is per trigger, not per
    // fresh application, so both hands' procs healed once each.
    expect(raw.applyHeal).toHaveBeenCalledTimes(2);
    expect(raw.applyHeal).toHaveBeenLastCalledWith(
      wielder,
      wielder,
      200,
      "Last Flame's Zeal",
      ENCHANT,
      false,
      false,
    );
  });

  it.each([
    ['mainhand', 0.041666666666666664, 0.04166666666666666, true],
    ['mainhand', 0.041666666666666664, 0.041666666666666664, false],
    ['mainhand', 0.041666666666666664, 0.04166666666666667, false],
    ['offhand', 0.030000000000000002, 0.03, true],
    ['offhand', 0.030000000000000002, 0.030000000000000002, false],
    ['offhand', 0.030000000000000002, 0.030000000000000006, false],
  ] as const)(
    'a real %s hit uses literal proc chance %f at draw %f (proc: %s)',
    (hand, probability, roll, procs) => {
      const { source, target, ctx } = differentSpeedHands();
      const beforeStr = source.stats.str;
      // White-hit table, weapon roll, crit, then Zeal. Rng.chance keeps its
      // real strict boundary comparison; only the underlying draws are scripted.
      const next = vi
        .spyOn(ctx.rng, 'next')
        .mockReturnValue(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(roll);
      const chance = vi.spyOn(ctx.rng, 'chance');
      try {
        expect(
          meleeSwing(ctx, source, target, 0, null, {
            autoAttackHand: hand,
            autoAttack: true,
            weapon: hand === 'offhand' ? (source.offhandWeapon ?? undefined) : source.weapon,
          }),
        ).toBe(true);
        expect(target.hp).toBeLessThan(target.maxHp);
        expect(chance).toHaveBeenCalledTimes(2);
        expect(chance).toHaveBeenLastCalledWith(probability);
        expect(next).toHaveBeenCalledTimes(4);
        expect(source.stats.str - beforeStr).toBe(procs ? 50 : 0);
        // One buff id for both hands (no per-hand suffix), so the two never stack.
        expect(
          source.auras.filter((aura) => aura.id.startsWith(ENCHANT)).map((aura) => aura.id),
        ).toEqual(procs ? [ENCHANT] : []);
      } finally {
        next.mockRestore();
        chance.mockRestore();
      }
    },
  );

  it('different-speed real hands share one 50 Strength buff that either hand refreshes', () => {
    const { sim, source, target, ctx } = differentSpeedHands();
    const beforeStr = source.stats.str;
    const beforeAp = source.attackPower;
    const zeal = () => source.auras.find((aura) => aura.id === ENCHANT);
    const zealEvents = () =>
      sim.events.flatMap((event) =>
        event.type === 'aura' && event.abilityId === ENCHANT && event.gained
          ? [event.refresh === true]
          : [],
      );
    const next = vi.spyOn(ctx.rng, 'next');
    const chance = vi.spyOn(ctx.rng, 'chance');
    const strike = (hand: 'mainhand' | 'offhand', probability: number) => {
      next
        .mockReset()
        .mockReturnValue(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0);
      chance.mockClear();
      expect(
        meleeSwing(ctx, source, target, 0, null, {
          autoAttackHand: hand,
          autoAttack: true,
          weapon: hand === 'offhand' ? (source.offhandWeapon ?? undefined) : source.weapon,
        }),
      ).toBe(true);
      expect(chance).toHaveBeenLastCalledWith(probability);
      expect(chance).toHaveBeenCalledTimes(2);
      expect(next).toHaveBeenCalledTimes(4);
    };
    try {
      strike('mainhand', 0.041666666666666664);
      expect(source.stats.str - beforeStr).toBe(50);
      expect(zeal()).toMatchObject({ value: 50, duration: 15, remaining: 15 });
      for (let tick = 0; tick < 20; tick++) updateAuras(ctx, source);
      expect(zeal()?.remaining).toBeCloseTo(14);
      // The off-hand trigger REFRESHES the one shared buff: still exactly 50
      // Strength (100 attack power), one buff_str aura, timer back at 15 s.
      strike('offhand', 0.030000000000000002);
      expect(source.stats.str - beforeStr).toBe(50);
      expect(source.attackPower - beforeAp).toBe(100);
      expect(source.auras.filter((aura) => aura.kind === 'buff_str')).toHaveLength(1);
      expect(zeal()).toMatchObject({ id: ENCHANT, value: 50, duration: 15, remaining: 15 });
      // Parse fidelity: the second trigger is reported as a refresh of the
      // same aura, never as a second application.
      expect(zealEvents()).toEqual([false, true]);
      for (let tick = 0; tick < 20; tick++) updateAuras(ctx, source);
      expect(zeal()?.remaining).toBeCloseTo(14);
      strike('mainhand', 0.041666666666666664);
      expect(source.stats.str - beforeStr).toBe(50);
      expect(source.auras.filter((aura) => aura.kind === 'buff_str')).toHaveLength(1);
      expect(zeal()?.remaining).toBe(15);
      expect(zealEvents()).toEqual([false, true, true]);
      for (let tick = 0; tick < 301; tick++) updateAuras(ctx, source);
      expect(zeal()).toBeUndefined();
      expect(source.stats.str).toBe(beforeStr);
      expect(source.attackPower).toBe(beforeAp);
    } finally {
      next.mockRestore();
      chance.mockRestore();
    }
  });

  it('does not proc from ranged Auto Shot, spells, heals, an empty hand, or a dead wielder', () => {
    const { ctx, raw, wielder, target } = harness();
    runWeaponProcs(ctx, wielder, target, 'weaponHit');
    runWeaponProcs(ctx, wielder, target, 'spellDamage');
    runWeaponProcs(ctx, wielder, target, 'heal');
    runWeaponProcs(ctx, wielder, target, 'weaponHit', null, 'offhand');
    wielder.dead = true;
    runWeaponProcs(ctx, wielder, target, 'weaponHit', wielder.mainhandItemId, 'mainhand');
    expect(raw.rng.chance).not.toHaveBeenCalled();
    expect(raw.applyHeal).not.toHaveBeenCalled();
  });

  it('actual melee swings heal 200 and Strength benefits percentage stat buffs, then expires', () => {
    const sim = new Sim({ seed: 44, playerClass: 'warrior', autoEquip: false });
    sim.setPlayerLevel(20);
    const source = sim.player;
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    const meta = sim.players.get(source.id)!;
    meta.equipment.mainhand = 'duskforged_warblade';
    meta.equipmentInstance.mainhand = { enchant: ENCHANT };
    ctx.applyAura(source, {
      id: 'test_stats',
      name: 'Stats',
      kind: 'buff_stats_pct',
      value: 10,
      remaining: 100,
      duration: 100,
      sourceId: source.id,
      school: 'holy',
    });
    recalcPlayerStats(source, 'warrior', meta.equipment, meta.talentMods, meta.equipmentInstance);
    const target = createMob(9500, MOBS.training_dummy, 20, {
      ...source.pos,
      z: source.pos.z + 2,
    });
    target.maxHp = target.hp = 100_000;
    target.hostile = true;
    sim.entities.set(target.id, target);
    const beforeStr = source.stats.str;
    const beforeAp = source.attackPower;
    source.hp -= 250;
    const beforeHp = source.hp;
    const next = vi.spyOn(ctx.rng, 'next').mockReturnValue(0.5);
    const chance = vi.spyOn(ctx.rng, 'chance').mockReturnValue(true);
    expect(
      meleeSwing(ctx, source, target, 0, null, {
        autoAttackHand: 'mainhand',
        autoAttack: true,
      }),
    ).toBe(true);
    expect(source.stats.str - beforeStr).toBe(55);
    expect(source.attackPower - beforeAp).toBe(110);
    expect(source.hp - beforeHp).toBe(200);
    next.mockRestore();
    chance.mockRestore();
    for (let tick = 0; tick < 301; tick++) updateAuras(ctx, source);
    expect(source.stats.str).toBe(beforeStr);
    expect(source.attackPower).toBe(beforeAp);
  });

  it.each([
    ['duskforged_warblade', 1],
    ['duskforged_warblade', 100_000],
    ['kingsbane_last_oath', 1],
  ] as const)('a landed %s hit against %i HP can grant the self-only enchant', (itemId, hp) => {
    const { sim, source, ctx } = meleeHarness(itemId);
    const target = trainingTarget(sim, hp);
    source.hp -= 250;
    const beforeHp = source.hp;
    const beforeStr = source.stats.str;
    const item = ITEMS[itemId];
    if (item.kind !== 'weapon') throw new Error('fixture weapon missing');
    const next = vi.spyOn(ctx.rng, 'next').mockReturnValue(0.5);
    const chance = vi.spyOn(ctx.rng, 'chance').mockReturnValue(true);
    try {
      expect(
        meleeSwing(ctx, source, target, 0, null, {
          autoAttackHand: 'mainhand',
          autoAttack: true,
        }),
      ).toBe(true);
      expect(target.dead).toBe(hp === 1);
      expect(source.hp - beforeHp).toBe(200);
      expect(source.stats.str - beforeStr).toBe(50);
      expect(source.auras.find((aura) => aura.id === ENCHANT)).toMatchObject({
        kind: 'buff_str',
        value: 50,
        remaining: 15,
      });
      // Crit plus Zeal only: a dead primary target still skips the legendary's
      // own proc draw, even when that weapon also carries the melee enchant.
      expect(chance).toHaveBeenCalledTimes(2);
      expect(chance).toHaveBeenLastCalledWith(item.weapon.speed / 60);
      expect(
        sim.events.some((event) => event.type === 'damage' && event.ability === 'Chain Arc'),
      ).toBe(false);
    } finally {
      next.mockRestore();
      chance.mockRestore();
    }
  });

  it('replays the same seeded killing-hit Zeal healing, aura timeline, and RNG tail', () => {
    function replay() {
      const { sim, source, ctx } = meleeHarness('duskforged_warblade', 3872);
      const timeline = [];
      for (let swing = 0; swing < 160; swing++) {
        const target = trainingTarget(sim, 1, 9500 + swing);
        source.hp = source.maxHp - 250;
        const beforeHp = source.hp;
        const landed = meleeSwing(ctx, source, target, 0, null, {
          autoAttackHand: 'mainhand',
          autoAttack: true,
        });
        timeline.push({
          swing,
          time: sim.time,
          landed,
          killed: target.dead,
          healed: source.hp - beforeHp,
          strength: source.stats.str,
          remaining: source.auras.find((aura) => aura.id === ENCHANT)?.remaining ?? 0,
        });
        for (let tick = 0; tick < 60; tick++) {
          sim.time += DT;
          updateAuras(ctx, source);
        }
      }
      for (let tick = 0; tick < 301; tick++) updateAuras(ctx, source);
      return {
        timeline,
        activeAfterExpiry: source.auras.some((aura) => aura.id === ENCHANT),
        rngTail: Array.from({ length: 8 }, () => ctx.rng.next()),
      };
    }
    const first = replay();
    expect(replay()).toEqual(first);
    expect(first.timeline.at(-1)?.time).toBeCloseTo(477);
    expect(first.timeline.some((entry) => entry.killed && entry.healed === 200)).toBe(true);
    expect(first.timeline.some((entry) => entry.remaining > 0 && entry.remaining < 15)).toBe(true);
    expect(first.activeAfterExpiry).toBe(false);
  });

  it('failed rolls and ordinary unenchanted weapons consume no extra proc effects', () => {
    const { ctx, raw, wielder, target } = harness();
    raw.rng.chance.mockReturnValue(false);
    runWeaponProcs(ctx, wielder, target, 'weaponHit', wielder.mainhandItemId, 'mainhand');
    expect(wielder.auras).toHaveLength(0);
    expect(raw.applyHeal).not.toHaveBeenCalled();
    raw.rng.chance.mockClear();
    raw.players.get(wielder.id)!.equipmentInstance.mainhand.enchant = '';
    runWeaponProcs(ctx, wielder, target, 'weaponHit', wielder.mainhandItemId, 'mainhand');
    expect(raw.rng.chance).not.toHaveBeenCalled();
  });
});
