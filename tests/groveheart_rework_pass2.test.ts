// Groveheart rework pass 2: Nature's Boon at 4 procs per minute in every form
// (and every Wildfang proc readies Oakhide), Bruin Form's doubled cadence at
// half damage with double white-swing rage, the Groveheart Nature's Boon from
// heal-over-time ticks (instant, free, 25% stronger Wildmend behind a 10 sec
// internal cooldown), and Second Bloom's 15 sec HoT with its closing heal.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GROVEHEART_BOON_ICD,
  GROVEHEART_BOON_ICD_KEY,
  GROVEHEART_BOON_TICK_CHANCE,
  NATURES_BOON_CHANCE,
  NATURES_BOON_ID,
  NATURES_BOON_POWER,
  naturesBoonChanceAt,
  naturesBoonOnAutoAttack,
  naturesBoonOnHotTick,
  OAKHIDE_ID,
} from '../src/sim/combat/druid_natures_boon';
import {
  BEAR_FORM_AUTO_RAGE_MULT,
  BEAR_FORM_SWING_MULT,
  baseSwingSpeed,
} from '../src/sim/combat/form_swing';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { type Aura, type Entity, rageFromDealing } from '../src/sim/types';

type Spec = 'balance' | 'feral' | 'restoration';

function rig(spec: Spec, seed = 77) {
  const sim = new Sim({ seed, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return { sim, player: sim.player };
}

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

function formAura(player: Entity, kind: Aura['kind']): Aura {
  return {
    id: kind,
    name: kind,
    kind,
    remaining: 3600,
    duration: 3600,
    value: 0,
    sourceId: player.id,
    school: 'nature',
  };
}

function ownHot(player: Entity, id = 'rejuvenation'): Aura {
  return {
    id,
    name: id,
    kind: 'hot',
    remaining: 12,
    duration: 12,
    value: 10,
    tickInterval: 3,
    tickTimer: 3,
    sourceId: player.id,
    school: 'nature',
  };
}

function boonAura(player: Entity): Aura | undefined {
  return player.auras.find((aura) => aura.id === NATURES_BOON_ID);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Nature's Boon (Wildfang): 4 procs per minute in every form", () => {
  it('scales the per-swing chance with the base swing interval', () => {
    expect(naturesBoonChanceAt(1)).toBeCloseTo(4 / 60, 12);
    expect(NATURES_BOON_CHANCE).toBeCloseTo(1 / 15, 12);
    // Procs per minute = (60 / swing) * chance = 4, whatever the swing.
    for (const swing of [1, 1.45, 2.9, 3.6]) {
      expect((60 / swing) * naturesBoonChanceAt(swing)).toBeCloseTo(4, 10);
    }
  });

  it('rolls the chance at the live form cadence (Cat, Bruin, caster form)', () => {
    const { sim, player } = rig('feral');
    const ctx = ctxOf(sim);
    const weaponSpeed = player.weapon.speed;
    const chance = vi.spyOn(ctx.rng, 'chance').mockReturnValue(false);
    naturesBoonOnAutoAttack(ctx, player);
    player.auras.push(formAura(player, 'form_cat'));
    naturesBoonOnAutoAttack(ctx, player);
    player.auras = player.auras.filter((aura) => aura.kind !== 'form_cat');
    player.auras.push(formAura(player, 'form_bear'));
    naturesBoonOnAutoAttack(ctx, player);
    expect(chance.mock.calls.map((call) => call[0])).toEqual([
      naturesBoonChanceAt(weaponSpeed),
      naturesBoonChanceAt(1),
      naturesBoonChanceAt(weaponSpeed * BEAR_FORM_SWING_MULT),
    ]);
  });

  it('lands about 4 procs per minute of Bruin swings through the real roll', () => {
    const { sim, player } = rig('feral', 91);
    const ctx = ctxOf(sim);
    player.auras.push(formAura(player, 'form_bear'));
    const swing = baseSwingSpeed(player);
    const minutes = 60;
    const swings = Math.round((minutes * 60) / swing);
    let procs = 0;
    for (let index = 0; index < swings; index++) {
      naturesBoonOnAutoAttack(ctx, player);
      const at = player.auras.findIndex((aura) => aura.id === NATURES_BOON_ID);
      if (at < 0) continue;
      procs++;
      player.auras.splice(at, 1);
    }
    // 240 expected over 60 minutes; the band is about 3 standard deviations.
    expect(procs / minutes).toBeGreaterThan(3.3);
    expect(procs / minutes).toBeLessThan(4.7);
  });

  it('clears the Oakhide cooldown on every proc, and only on a proc', () => {
    const { sim, player } = rig('feral');
    const ctx = ctxOf(sim);
    player.cooldowns.set(OAKHIDE_ID, 37);
    vi.spyOn(ctx.rng, 'chance').mockReturnValue(false);
    naturesBoonOnAutoAttack(ctx, player);
    expect(player.cooldowns.get(OAKHIDE_ID)).toBe(37);
    vi.spyOn(ctx.rng, 'chance').mockReturnValue(true);
    naturesBoonOnAutoAttack(ctx, player);
    expect(player.cooldowns.has(OAKHIDE_ID)).toBe(false);
    expect(boonAura(player)?.empowerAbilities).toEqual(['rejuvenation', 'barkskin']);
  });

  it('lets the freed Oakhide go off from Bruin Form right after a proc', () => {
    const { sim, player } = rig('feral');
    const ctx = ctxOf(sim);
    sim.castAbility('bear_form');
    expect(player.auras.some((aura) => aura.kind === 'form_bear')).toBe(true);
    player.gcdRemaining = 0;
    player.resource = player.maxResource;
    sim.castAbility(OAKHIDE_ID);
    expect(player.cooldowns.has(OAKHIDE_ID)).toBe(true);
    vi.spyOn(ctx.rng, 'chance').mockReturnValue(true);
    naturesBoonOnAutoAttack(ctx, player);
    vi.restoreAllMocks();
    expect(player.cooldowns.has(OAKHIDE_ID)).toBe(false);
    player.gcdRemaining = 0;
    player.resource = 0;
    sim.castAbility(OAKHIDE_ID);
    expect(player.cooldowns.has(OAKHIDE_ID)).toBe(true);
    expect(boonAura(player)).toBeUndefined();
  });
});

describe('Bruin Form: twice the swings, half the damage, double rage', () => {
  it('mints double rage from a white swing in Bruin Form', () => {
    const { sim, player } = rig('feral');
    const ctx = ctxOf(sim);
    sim.castAbility('bear_form');
    expect(player.resourceType).toBe('rage');
    const mob = createMob(9901, MOBS.forest_wolf, 20, {
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z + 2,
    });
    mob.maxHp = mob.hp = 1_000_000;
    mob.hostile = true;
    (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
    player.resource = 0;
    sim.drainEvents();
    ctx.dealDamage(player, mob, 100, false, 'physical', null, 'hit');
    const dealt = sim
      .drainEvents()
      .find((event) => event.type === 'damage' && event.sourceId === player.id);
    const amount = dealt && 'amount' in dealt ? dealt.amount : 0;
    expect(amount).toBeGreaterThan(0);
    expect(BEAR_FORM_AUTO_RAGE_MULT).toBe(2);
    expect(player.resource).toBeCloseTo(
      Math.min(player.maxResource, rageFromDealing(amount, player.level) * 2),
      6,
    );
  });

  it('arms the swing timer at half the weapon speed in Bruin Form', () => {
    const { sim, player } = rig('feral');
    sim.castAbility('bear_form');
    expect(baseSwingSpeed(player)).toBeCloseTo(player.weapon.speed * BEAR_FORM_SWING_MULT, 12);
  });
});

describe("Nature's Boon (Groveheart): HoT ticks arm an instant, free Wildmend", () => {
  it('rolls on an owned HoT tick, arms Wildmend, and starts a 10 sec cooldown', () => {
    const { sim, player } = rig('restoration');
    const ctx = ctxOf(sim);
    const chance = vi.spyOn(ctx.rng, 'chance').mockReturnValue(true);
    naturesBoonOnHotTick(ctx, player, ownHot(player));
    expect(chance).toHaveBeenCalledExactlyOnceWith(GROVEHEART_BOON_TICK_CHANCE);
    expect(boonAura(player)?.empowerAbilities).toEqual(['healing_touch']);
    expect(player.procState?.icds[GROVEHEART_BOON_ICD_KEY]).toBe(GROVEHEART_BOON_ICD);
    // Inside the cooldown a tick draws nothing at all.
    naturesBoonOnHotTick(ctx, player, ownHot(player));
    expect(chance).toHaveBeenCalledTimes(1);
  });

  it('pins the shipped numbers: 10% per tick, 10 sec internal cooldown', () => {
    expect(GROVEHEART_BOON_TICK_CHANCE).toBe(0.1);
    expect(GROVEHEART_BOON_ICD).toBe(10);
  });

  it('re-opens after the cooldown runs out on the sim clock', () => {
    const { sim, player } = rig('restoration');
    const ctx = ctxOf(sim);
    vi.spyOn(ctx.rng, 'chance').mockReturnValue(true);
    naturesBoonOnHotTick(ctx, player, ownHot(player));
    vi.restoreAllMocks();
    for (let tick = 0; tick < 20 * 9; tick++) sim.tick();
    expect(player.procState?.icds[GROVEHEART_BOON_ICD_KEY]).toBeDefined();
    for (let tick = 0; tick < 20 * 2; tick++) sim.tick();
    expect(player.procState?.icds[GROVEHEART_BOON_ICD_KEY]).toBeUndefined();
  });

  it('draws no rng for another spec, a foreign HoT, or a non-HoT aura', () => {
    for (const spec of ['balance', 'feral'] as const) {
      const { sim, player } = rig(spec);
      const chance = vi.spyOn(ctxOf(sim).rng, 'chance');
      naturesBoonOnHotTick(ctxOf(sim), player, ownHot(player));
      expect(chance).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
    const { sim, player } = rig('restoration');
    const chance = vi.spyOn(ctxOf(sim).rng, 'chance');
    naturesBoonOnHotTick(ctxOf(sim), player, { ...ownHot(player), sourceId: player.id + 999 });
    naturesBoonOnHotTick(ctxOf(sim), player, { ...ownHot(player), kind: 'dot' });
    expect(chance).not.toHaveBeenCalled();
  });

  it('fires from a real HoT ticking through the aura loop', () => {
    const { sim, player } = rig('restoration');
    player.hp = Math.round(player.maxHp * 0.5);
    player.auras.push(ownHot(player));
    const chance = vi.spyOn(ctxOf(sim).rng, 'chance');
    for (let tick = 0; tick < 20 * 3 + 1; tick++) sim.tick();
    expect(chance.mock.calls.some((call) => call[0] === GROVEHEART_BOON_TICK_CHANCE)).toBe(true);
  });

  it('makes Wildmend instant, free, 25% stronger, and castable in Cat Form', () => {
    // The INTENDED heal (the amount handed to applyHeal, before the missing-
    // health clamp), at the fixture's own gear heal power: spending the window
    // refreshes derived stats, so a hand-set heal power would not survive it.
    const healFor = (armed: boolean) => {
      const { sim, player } = rig('restoration', 123);
      const ctx = ctxOf(sim);
      player.hp = 1;
      if (armed) {
        vi.spyOn(ctx.rng, 'chance').mockReturnValueOnce(true);
        naturesBoonOnHotTick(ctx, player, ownHot(player));
        vi.restoreAllMocks();
      }
      const resolved = sim.resolvedAbility('healing_touch');
      const intended: number[] = [];
      const applyHeal = ctx.applyHeal.bind(ctx);
      ctx.applyHeal = ((source, target, amount, ...rest) => {
        if (rest[0] === 'Wildmend') intended.push(amount);
        return applyHeal(source, target, amount, ...rest);
      }) as typeof ctx.applyHeal;
      vi.spyOn(ctx.rng, 'next').mockReturnValue(0.5);
      vi.spyOn(ctx.rng, 'chance').mockReturnValue(false);
      const before = player.resource;
      sim.castAbility('healing_touch');
      for (let tick = 0; tick < 200 && player.castingAbility; tick++) sim.tick();
      vi.restoreAllMocks();
      return {
        castTime: resolved?.castTime ?? -1,
        cost: before - player.resource,
        intended,
        armedAfter: boonAura(player) !== undefined,
      };
    };
    const plain = healFor(false);
    const boon = healFor(true);
    expect(plain.castTime).toBeGreaterThan(0);
    expect(boon.castTime).toBe(0);
    expect(plain.cost).toBeGreaterThan(0);
    expect(boon.cost).toBe(0);
    expect(plain.intended).toHaveLength(1);
    expect(boon.intended).toHaveLength(1);
    // 25% stronger, whole heal (roll plus Spell Power rider), within rounding.
    expect(Math.abs(boon.intended[0] - plain.intended[0] * NATURES_BOON_POWER)).toBeLessThanOrEqual(
      1,
    );
    expect(boon.armedAfter).toBe(false);

    // In Cat Form the armed Wildmend goes off without leaving the form.
    const { sim, player } = rig('restoration', 124);
    sim.castAbility('cat_form');
    expect(player.auras.some((aura) => aura.kind === 'form_cat')).toBe(true);
    vi.spyOn(ctxOf(sim).rng, 'chance').mockReturnValueOnce(true);
    naturesBoonOnHotTick(ctxOf(sim), player, ownHot(player));
    vi.restoreAllMocks();
    player.gcdRemaining = 0;
    player.hp = Math.round(player.maxHp * 0.5);
    const hpBefore = player.hp;
    sim.castAbility('healing_touch');
    expect(player.hp).toBeGreaterThan(hpBefore);
    expect(player.auras.some((aura) => aura.kind === 'form_cat')).toBe(true);
    expect(boonAura(player)).toBeUndefined();
  });

  it('keeps the heal on the pre-boon cast time coefficient', () => {
    const { sim, player } = rig('restoration');
    const before = sim.resolvedAbility('healing_touch');
    vi.spyOn(ctxOf(sim).rng, 'chance').mockReturnValueOnce(true);
    naturesBoonOnHotTick(ctxOf(sim), player, ownHot(player));
    vi.restoreAllMocks();
    const armed = sim.resolvedAbility('healing_touch');
    expect(armed?.castTime).toBe(0);
    expect(armed?.scalingCastTime).toBe(before?.castTime);
  });
});

describe('Second Bloom: 15 sec HoT and a closing heal', () => {
  function castSecondBloom(seed = 55) {
    const { sim, player } = rig('restoration', seed);
    player.hp = 1;
    vi.spyOn(ctxOf(sim).rng, 'chance').mockReturnValue(false);
    sim.drainEvents();
    sim.castAbility('regrowth');
    const events = sim.drainEvents();
    for (let tick = 0; tick < 200 && player.castingAbility; tick++) events.push(...sim.tick());
    const direct = events.find(
      (event) =>
        event.type === 'heal2' &&
        event.ability === 'Second Bloom' &&
        !('hot' in event && event.hot),
    );
    return {
      sim,
      player,
      directAmount: direct && 'amount' in direct ? direct.amount : -1,
    };
  }

  it('authors the same HoT totals over 15 sec on both ranks', () => {
    const effects = [
      ABILITIES.regrowth.effects,
      ...(ABILITIES.regrowth.ranks ?? []).map((r) => r.effects),
    ];
    const totals = effects.map((list) => {
      const hot = list.find((effect) => effect.type === 'hot');
      return hot && hot.type === 'hot' ? [hot.total, hot.duration, hot.closingHealFromDirect] : [];
    });
    expect(totals).toEqual([
      [49, 15, true],
      [71, 15, true],
    ]);
  });

  it('heals again for the initial amount when the HoT runs its full duration', () => {
    const { sim, player, directAmount } = castSecondBloom();
    expect(directAmount).toBeGreaterThan(0);
    const hot = player.auras.find((aura) => aura.id === 'regrowth');
    expect(hot?.duration).toBe(15);
    expect(hot?.closingHeal).toBe(directAmount);
    player.hp = 1;
    const closing: number[] = [];
    for (let tick = 0; tick < 20 * 16; tick++) {
      for (const event of sim.tick()) {
        if (
          event.type === 'heal2' &&
          event.ability === 'Second Bloom' &&
          !('hot' in event && event.hot)
        ) {
          closing.push(event.amount);
        }
      }
    }
    expect(player.auras.some((aura) => aura.id === 'regrowth')).toBe(false);
    expect(closing).toEqual([directAmount]);
  });

  it('pays no closing heal when Fleetmend consumes the HoT early', () => {
    const { sim, player } = castSecondBloom(56);
    expect(player.auras.some((aura) => aura.id === 'regrowth')).toBe(true);
    player.gcdRemaining = 0;
    player.resource = player.maxResource;
    sim.castAbility('swiftmend');
    expect(player.auras.some((aura) => aura.id === 'regrowth')).toBe(false);
    player.hp = 1;
    const closing: number[] = [];
    for (let tick = 0; tick < 20 * 16; tick++) {
      for (const event of sim.tick()) {
        if (event.type === 'heal2' && event.ability === 'Second Bloom') closing.push(event.amount);
      }
    }
    expect(closing).toEqual([]);
  });

  it('pays no closing heal when Overbloom harvests the HoT', () => {
    const { sim, player } = castSecondBloom(57);
    player.auras.push({
      id: 'verdance',
      name: 'Verdance',
      kind: 'verdance',
      remaining: 3600,
      duration: 3600,
      value: 0,
      sourceId: player.id,
      school: 'nature',
      stacks: 3,
    });
    expect(sim.resolvedAbility('swiftmend')?.def.id).toBe('overbloom');
    player.gcdRemaining = 0;
    player.resource = player.maxResource;
    sim.castAbility('swiftmend');
    expect(player.auras.some((aura) => aura.id === 'regrowth')).toBe(false);
    player.hp = 1;
    const closing: number[] = [];
    for (let tick = 0; tick < 20 * 16; tick++) {
      for (const event of sim.tick()) {
        if (event.type === 'heal2' && event.ability === 'Second Bloom') closing.push(event.amount);
      }
    }
    expect(closing).toEqual([]);
  });
});

describe('Bonecrush queued before Old Blood fills', () => {
  it('still lands Bonecrush when the button turns into Marrowbreak before the swing', () => {
    const { sim, player } = rig('feral', 31);
    player.resource = player.maxResource;
    sim.castAbility('bear_form');
    const mob = createMob(9800, MOBS.forest_wolf, 20, {
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z + 2,
    });
    mob.maxHp = mob.hp = 1_000_000;
    mob.hostile = true;
    mob.swingTimer = 999;
    mob.moveSpeed = 0;
    (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
    sim.targetEntity(mob.id);
    player.facing = 0;
    player.auras.push({
      id: 'old_blood',
      name: 'Old Blood',
      kind: 'old_blood',
      remaining: 3600,
      duration: 3600,
      value: 0,
      sourceId: player.id,
      school: 'physical',
      stacks: 2,
    });
    player.resource = 100;
    player.gcdRemaining = 0;
    player.swingTimer = 3;
    sim.castAbility('maul');
    expect(player.queuedOnSwing).toBe('maul');
    // Sweeping Claws lands first and fills Old Blood: the button now reads
    // Marrowbreak, but the swing already parked is a Bonecrush.
    player.gcdRemaining = 0;
    sim.castAbility('swipe');
    expect(sim.resolvedAbility('maul')?.def.id).toBe('marrowbreak');
    const strikes: Array<string | null | undefined> = [];
    for (let tick = 0; tick < 20 * 4; tick++) {
      for (const event of sim.tick()) {
        if (event.type === 'damage' && event.sourceId === player.id && event.kind === 'hit') {
          strikes.push(event.ability);
        }
      }
    }
    expect(strikes).toContain('Bonecrush');
    expect(player.queuedOnSwing).toBeNull();
  });
});

describe("Nature's Boon windows end on a specialization change", () => {
  it('a Groveheart Wildmend window does not survive a respec out of Groveheart', () => {
    const { sim, player } = rig('restoration');
    vi.spyOn(ctxOf(sim).rng, 'chance').mockReturnValueOnce(true);
    naturesBoonOnHotTick(ctxOf(sim), player, ownHot(player));
    vi.restoreAllMocks();
    expect(sim.resolvedAbility('healing_touch')?.castTime).toBe(0);
    expect(sim.applyTalents({ spec: 'feral', rows: {} })).toBe(true);
    expect(boonAura(player)).toBeUndefined();
    expect(sim.resolvedAbility('healing_touch')?.castTime).toBeGreaterThan(0);
    expect(player.procState?.icds[GROVEHEART_BOON_ICD_KEY]).toBeUndefined();
  });

  it('a Wildfang window does not survive a respec into Groveheart', () => {
    const { sim, player } = rig('feral');
    vi.spyOn(ctxOf(sim).rng, 'chance').mockReturnValueOnce(true);
    naturesBoonOnAutoAttack(ctxOf(sim), player);
    vi.restoreAllMocks();
    expect(boonAura(player)?.empowerAbilities).toEqual(['rejuvenation', 'barkskin']);
    expect(sim.applyTalents({ spec: 'restoration', rows: {} })).toBe(true);
    expect(boonAura(player)).toBeUndefined();
  });
});
