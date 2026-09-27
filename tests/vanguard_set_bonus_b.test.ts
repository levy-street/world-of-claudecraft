// Warfare Season 2 ("Vanguard") set bonuses, shaman / mage / warlock / druid
// (content/vanguard_set_bonuses_b.ts; design docs/design/warfare-season-2.md).
// Every one of the 24 tiers is proven with the REAL set items equipped: the
// effect is present when the tier is met and absent one piece below it. The
// last block pins every number in the tooltip copy (content/
// vanguard_item_sets.ts) to the implementation constants.
import { describe, expect, it } from 'vitest';
import { HOURBINDER_HASTE_ID } from '../src/sim/combat/chronomancy';
import { gainRuin, ruinAmount } from '../src/sim/combat/destruction';
import { refundFlitstep } from '../src/sim/combat/frost_mage';
import { BRINEWARD_SHIELD_ID, brinewardMendingCastTime } from '../src/sim/combat/shaman_spiritmend';
import { spellHasteMult } from '../src/sim/combat/spell_combat';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { setBonusFlag } from '../src/sim/content/ignivar_set_bonuses';
import { SEASON2_SETS } from '../src/sim/content/pvp_honor_season2';
import type { TalentModifiers } from '../src/sim/content/talents';
import * as B from '../src/sim/content/vanguard_set_bonuses_b';
import { ITEM_SETS, ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { moveSpeedMult } from '../src/sim/player_motion';
import { computeCharacterModifiers } from '../src/sim/set_bonus_mods';
import { Sim } from '../src/sim/sim';
import { type Entity, MIN_GCD, type PlayerClass, type SimEvent } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const SET_SLOTS = ['helmet', 'shoulder', 'chest', 'legs', 'gloves'] as const;

const SETS_B = [
  ['vanguard_shaman_elemental', 'shaman', 'elemental'],
  ['vanguard_shaman_enhancement', 'shaman', 'enhancement'],
  ['vanguard_shaman_restoration', 'shaman', 'restoration'],
  ['vanguard_mage_arcane', 'mage', 'arcane'],
  ['vanguard_mage_fire', 'mage', 'fire'],
  ['vanguard_mage_frost', 'mage', 'frost'],
  ['vanguard_warlock_affliction', 'warlock', 'affliction'],
  ['vanguard_warlock_demonology', 'warlock', 'demonology'],
  ['vanguard_warlock_destruction', 'warlock', 'destruction'],
  ['vanguard_druid_balance', 'druid', 'balance'],
  ['vanguard_druid_feral', 'druid', 'feral'],
  ['vanguard_druid_restoration', 'druid', 'restoration'],
] as const;

function equipSet(sim: Sim, setId: string, pieces: number): void {
  for (const slot of SET_SLOTS.slice(0, pieces)) {
    const itemId = `${setId}_${slot}`;
    sim.addItem(itemId, 1);
    sim.equipItem(itemId);
  }
}

function live(cls: PlayerClass, spec: string, setId: string, pieces: number, seed = 911): Sim {
  const sim = new Sim({ seed, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  equipSet(sim, setId, pieces);
  sim.player.resource = sim.player.maxResource;
  sim.player.hitBonus = 1;
  return sim;
}

function modsOf(sim: Sim): TalentModifiers {
  const meta = expectDefined(sim.ctx.players.get(sim.player.id));
  return sim.ctx.playerMods(meta);
}

function addHostile(sim: Sim, distance = 3): Entity {
  const host = sim as Sim & { nextId: number; addEntity(entity: Entity): void };
  const mob = createMob(host.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  mob.maxHp = 999_999;
  mob.hp = mob.maxHp;
  mob.weapon.min = 0;
  mob.weapon.max = 0;
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.swingTimer = 999;
  mob.moveSpeed = 0;
  host.addEntity(mob);
  sim.player.facing = 0;
  return mob;
}

function addAlly(sim: Sim, name: string): Entity {
  const id = sim.addPlayer('warrior', name);
  sim.setPlayerLevel(20, id);
  const ally = expectDefined(sim.entities.get(id));
  ally.pos.x = sim.player.pos.x;
  ally.pos.z = sim.player.pos.z + 4;
  sim.partyInvite(id, sim.player.id);
  sim.partyAccept(id);
  return ally;
}

function ready(sim: Sim, abilityId: string): void {
  sim.player.cooldowns.delete(abilityId);
  sim.player.gcdRemaining = 0;
  sim.player.resource = sim.player.maxResource;
}

/** Casts and rides out any cast bar and pending projectile. */
function cast(sim: Sim, abilityId: string, target?: Entity): SimEvent[] {
  if (target) sim.targetEntity(target.id);
  ready(sim, abilityId);
  sim.castAbility(abilityId);
  const events: SimEvent[] = [];
  for (let i = 0; i < 20 * 5 && sim.player.castingAbility; i++) events.push(...sim.tick());
  const host = sim as unknown as { ctx: { pendingProjectiles: unknown[] } };
  for (let i = 0; i < 200 && host.ctx.pendingProjectiles.length > 0; i++) {
    events.push(...sim.tick());
  }
  return events;
}

/** Presses a hard cast (or channel) with forward held, then rides 5 ticks of
 *  movement: true only when the cast started AND survived the moving ticks. */
function castWhileMoving(sim: Sim, abilityId: string, target: Entity): boolean {
  sim.targetEntity(target.id);
  ready(sim, abilityId);
  sim.moveInput.forward = true;
  try {
    sim.castAbility(abilityId);
    if (sim.player.castingAbility !== abilityId) return false;
    const start = { ...sim.player.pos };
    for (let i = 0; i < 5; i++) sim.tick();
    expect(Math.hypot(sim.player.pos.x - start.x, sim.player.pos.z - start.z)).toBeGreaterThan(0);
    return sim.player.castingAbility === abilityId;
  } finally {
    sim.moveInput.forward = false;
  }
}

function resolved(sim: Sim, abilityId: string) {
  return expectDefined(sim.resolvedAbility(abilityId), abilityId);
}

function auraOn(entity: Entity, id: string) {
  return entity.auras.find((aura) => aura.id === id);
}

describe('Vanguard B sets: registration', () => {
  it('every set row, item and engine tier exists and registers per worn tier', () => {
    expect(Object.keys(B.VANGUARD_BONUSES_B).sort()).toEqual(SETS_B.map(([id]) => id).sort());
    for (const [setId, cls, spec] of SETS_B) {
      const set = expectDefined(ITEM_SETS[setId], setId);
      expect(set.bonuses.map((tier) => tier.pieces)).toEqual([2, 4]);
      expect(B.VANGUARD_BONUSES_B[setId]?.map((tier) => tier.pieces)).toEqual([2, 4]);
      const def = expectDefined(SEASON2_SETS.find((row) => row.setId === setId));
      expect(def.cls).toBe(cls);
      expect(def.spec).toBe(spec);
      for (const slot of SET_SLOTS) expect(ITEMS[`${setId}_${slot}`]?.set, slot).toBe(setId);
      const equipment: Partial<Record<string, string>> = {};
      for (const slot of SET_SLOTS.slice(0, 4)) equipment[slot] = `${setId}_${slot}`;
      const four = computeCharacterModifiers(cls, { spec, rows: {} }, 20, equipment);
      expect(four.selected[setBonusFlag(setId, 2)]).toBe(true);
      expect(four.selected[setBonusFlag(setId, 4)]).toBe(true);
      // No Season 2 set carries the raid tier's spell pushback rider.
      expect(four.global.castPushbackReduction).toBe(0);
    }
  });

  it('proc ids are unique and follow the set_vanguard_<class>_<spec>_<n>pc form', () => {
    const ids: string[] = [];
    for (const [setId, tiers] of Object.entries(B.VANGUARD_BONUSES_B)) {
      for (const tier of tiers) {
        const proc = tier.effect.proc;
        if (!proc) continue;
        expect(proc.id).toBe(`set_${setId}_${tier.pieces}pc`);
        ids.push(proc.id);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Tempestwrit Battlemail (elemental)', () => {
  const SET = 'vanguard_shaman_elemental';

  it('2pc: Unleash Weapon cooldown 15 -> 12 sec, not at 1 piece', () => {
    expect(resolved(live('shaman', 'elemental', SET, 2), 'unleash_weapon').cooldown).toBe(12);
    expect(resolved(live('shaman', 'elemental', SET, 1), 'unleash_weapon').cooldown).toBe(15);
  });

  const SET_AURAS = [
    B.VANGUARD_ELEMENTAL_4PC_MOBILE_AURA_ID,
    B.VANGUARD_ELEMENTAL_4PC_SPEED_AURA_ID,
  ];

  function unleashed(pieces: number) {
    const sim = live('shaman', 'elemental', SET, pieces);
    const mob = addHostile(sim, 10);
    cast(sim, 'flametongue_weapon');
    cast(sim, 'unleash_weapon', mob);
    expect(sim.player.cooldowns.has('unleash_weapon')).toBe(true); // the cast resolved
    return { sim, mob };
  }

  it('4pc: Unleash Weapon grants cast-while-moving and +20 percent speed for 4 sec', () => {
    const { sim, mob } = unleashed(4);
    const speed = expectDefined(auraOn(sim.player, B.VANGUARD_ELEMENTAL_4PC_SPEED_AURA_ID));
    expect(speed.kind).toBe('buff_speed');
    expect(speed.value).toBe(B.VANGUARD_ELEMENTAL_4PC_SPEED_MULT);
    expect(speed.duration).toBe(B.VANGUARD_ELEMENTAL_4PC_DURATION_SEC);
    const mobile = expectDefined(auraOn(sim.player, B.VANGUARD_ELEMENTAL_4PC_MOBILE_AURA_ID));
    expect(mobile.kind).toBe('processional_grace');
    expect(mobile.duration).toBe(B.VANGUARD_ELEMENTAL_4PC_DURATION_SEC);
    expect(moveSpeedMult(sim.player)).toBeCloseTo(B.VANGUARD_ELEMENTAL_4PC_SPEED_MULT, 6);
    // Neither set aura replaced one of Unleash Weapon's own: the non-set auras
    // match the 3-piece control exactly.
    const control = unleashed(3).sim.player;
    const own = (p: Entity) =>
      p.auras
        .map((aura) => aura.id)
        .filter((id) => !SET_AURAS.includes(id))
        .sort();
    expect(own(sim.player)).toEqual(own(control));
    expect(control.auras.some((aura) => SET_AURAS.includes(aura.id))).toBe(false);
    expect(moveSpeedMult(control)).toBe(1);
    // A hard cast started while moving holds (the press and the move-cancel).
    expect(castWhileMoving(sim, 'lightning_bolt', mob)).toBe(true);
    const bare = unleashed(3);
    expect(castWhileMoving(bare.sim, 'lightning_bolt', bare.mob)).toBe(false);
  });

  it('4pc: at most once every 20 sec (the icd arms on the proc)', () => {
    const { sim, mob } = unleashed(4);
    const p = sim.player;
    expect(p.procState?.icds.set_vanguard_shaman_elemental_4pc).toBe(
      B.VANGUARD_ELEMENTAL_4PC_ICD_SEC,
    );
    const clearSetAuras = () => {
      p.auras = p.auras.filter((aura) => !SET_AURAS.includes(aura.id));
    };
    clearSetAuras();
    // A second Unleash 1 sec later: no auras, the icd keeps running.
    for (let i = 0; i < 20; i++) sim.tick();
    cast(sim, 'unleash_weapon', mob);
    expect(p.auras.some((aura) => SET_AURAS.includes(aura.id))).toBe(false);
    // Past the icd the next Unleash procs again.
    for (let i = 0; i < 20 * B.VANGUARD_ELEMENTAL_4PC_ICD_SEC; i++) sim.tick();
    expect(p.procState?.icds.set_vanguard_shaman_elemental_4pc).toBeUndefined();
    cast(sim, 'unleash_weapon', mob);
    expect(auraOn(p, B.VANGUARD_ELEMENTAL_4PC_SPEED_AURA_ID)).toBeDefined();
    expect(auraOn(p, B.VANGUARD_ELEMENTAL_4PC_MOBILE_AURA_ID)).toBeDefined();
  });
});

describe('Galeborn Warmail (enhancement)', () => {
  const SET = 'vanguard_shaman_enhancement';

  function strikeSlow(pieces: number) {
    const sim = live('shaman', 'enhancement', SET, pieces);
    const mob = addHostile(sim, 2);
    cast(sim, 'stormstrike', mob);
    expect(sim.player.cooldowns.has('stormstrike')).toBe(true);
    return auraOn(mob, 'stormstrike_slow');
  }

  it('2pc: Ancestral Strike slows the target 30 percent for 4 sec, not at 1 piece', () => {
    const slow = expectDefined(strikeSlow(2));
    expect(slow.kind).toBe('slow');
    expect(slow.value).toBe(B.VANGUARD_ENHANCEMENT_2PC_SLOW_MULT);
    expect(slow.duration).toBe(B.VANGUARD_ENHANCEMENT_2PC_SLOW_DURATION_SEC);
    expect(strikeSlow(1)).toBeUndefined();
  });

  function tranceAfterStrike(pieces: number): number | undefined {
    const sim = live('shaman', 'enhancement', SET, pieces);
    const mob = addHostile(sim, 2);
    sim.targetEntity(mob.id);
    ready(sim, 'stormstrike');
    sim.player.cooldowns.set('elemental_trance', 100);
    sim.castAbility('stormstrike');
    return sim.player.cooldowns.get('elemental_trance');
  }

  it('4pc: Ancestral Strike shaves 4 sec off Elemental Trance, not at 3 pieces', () => {
    expect(tranceAfterStrike(4)).toBe(100 - B.VANGUARD_ENHANCEMENT_4PC_TRANCE_REFUND_SEC);
    expect(tranceAfterStrike(3)).toBe(100);
  });
});

describe('Brineward Chainmail (restoration shaman)', () => {
  const SET = 'vanguard_shaman_restoration';

  /** The UNSTRETCHED cast time of a Mending Waters press (castTotal times
   *  spell haste; Curse of Tongues is absent). `allyHpFrac` null self-casts. */
  function mendingCast(pieces: number, allyHpFrac: number | null, selfHpFrac = 1): number {
    const sim = live('shaman', 'restoration', SET, pieces);
    sim.player.hp = Math.round(sim.player.maxHp * selfHpFrac);
    if (allyHpFrac !== null) {
      const ally = addAlly(sim, 'Tidebound');
      ally.hp = Math.round(ally.maxHp * allyHpFrac);
      sim.targetEntity(ally.id);
    } else {
      sim.targetEntity(sim.player.id);
    }
    ready(sim, 'healing_wave');
    sim.castAbility('healing_wave');
    expect(sim.player.castingAbility).toBe('healing_wave');
    return sim.player.castTotal * spellHasteMult(sim.player);
  }

  it('2pc: Mending Waters casts 0.5 sec faster on a target below 50 percent health', () => {
    const cut = B.VANGUARD_RESTO_SHAMAN_2PC_CAST_CUT_SEC;
    const full = mendingCast(2, 0.9);
    expect(full).toBeCloseTo(2.25, 6); // rank 5 2.5 sec with the Spiritcall -0.1
    expect(full - mendingCast(2, 0.3)).toBeCloseTo(cut, 6);
    // Exactly 50 percent is not below it.
    expect(mendingCast(2, B.VANGUARD_RESTO_SHAMAN_2PC_HEALTH_BELOW)).toBeCloseTo(full, 6);
    // The TARGET's health decides, not the caster's.
    expect(mendingCast(2, 0.9, 0.3)).toBeCloseTo(full, 6);
    // A self-cast reads the caster.
    expect(mendingCast(2, null, 1)).toBeCloseTo(full, 6);
    expect(full - mendingCast(2, null, 0.3)).toBeCloseTo(cut, 6);
    // One piece below the tier: no cut at any health.
    expect(mendingCast(1, 0.3)).toBeCloseTo(mendingCast(1, 0.9), 6);
    expect(mendingCast(1, 0.9)).toBeCloseTo(full, 6);
  });

  it('2pc: the cut never takes a cast below the GCD floor, and skips instants and others', () => {
    const sim = live('shaman', 'restoration', SET, 2);
    const p = sim.player;
    p.hp = Math.round(p.maxHp * 0.2);
    expect(brinewardMendingCastTime(sim.ctx, p, 'healing_wave', p, 1)).toBe(MIN_GCD);
    expect(brinewardMendingCastTime(sim.ctx, p, 'healing_wave', p, 0)).toBe(0);
    expect(brinewardMendingCastTime(sim.ctx, p, 'chain_heal', p, 2)).toBe(2);
    const bare = live('shaman', 'restoration', SET, 1);
    bare.player.hp = Math.round(bare.player.maxHp * 0.2);
    expect(brinewardMendingCastTime(bare.ctx, bare.player, 'healing_wave', null, 2)).toBe(2);
  });

  function tidecallShield(pieces: number) {
    const sim = live('shaman', 'restoration', SET, pieces);
    const ally = addAlly(sim, 'Tidebound');
    ally.hp = Math.round(ally.maxHp * 0.3);
    cast(sim, 'tidecall', ally);
    expect(sim.player.cooldowns.has('tidecall') || !!sim.player.abilityCharges?.tidecall).toBe(
      true,
    );
    return { shield: auraOn(ally, BRINEWARD_SHIELD_ID), shaman: sim.player, ally };
  }

  it("4pc: Tidecall shields its target for 5 percent of the shaman's max health, not at 3", () => {
    const { shield, shaman, ally } = tidecallShield(4);
    const aura = expectDefined(shield);
    expect(aura.kind).toBe('absorb');
    expect(aura.value).toBe(Math.round(shaman.maxHp * B.VANGUARD_RESTO_SHAMAN_4PC_SHIELD_PCT_MAX));
    expect(ally.maxHp).not.toBe(shaman.maxHp); // decisive: sized off the caster
    expect(aura.duration).toBe(B.VANGUARD_RESTO_SHAMAN_4PC_SHIELD_DURATION_SEC);
    expect(tidecallShield(3).shield).toBeUndefined();
  });
});

describe("Hourbinder's Vestments (arcane)", () => {
  const SET = 'vanguard_mage_arcane';

  it('2pc: Temporal Barrier cooldown 12 -> 10 sec, not at 1 piece', () => {
    expect(resolved(live('mage', 'arcane', SET, 2), 'temporal_barrier').cooldown).toBe(10);
    expect(resolved(live('mage', 'arcane', SET, 1), 'temporal_barrier').cooldown).toBe(12);
  });

  function barrierOnAlly(pieces: number) {
    const sim = live('mage', 'arcane', SET, pieces);
    const ally = addAlly(sim, 'Shielded');
    cast(sim, 'temporal_barrier', ally);
    return ally;
  }

  it('4pc: the shielded ally gains +20 percent movement speed and KEEPS the barrier', () => {
    const ally = barrierOnAlly(4);
    const haste = expectDefined(auraOn(ally, HOURBINDER_HASTE_ID));
    expect(haste.kind).toBe('buff_speed');
    expect(haste.duration).toBe(B.VANGUARD_ARCANE_4PC_SPEED_DURATION_SEC);
    expect(moveSpeedMult(ally)).toBeCloseTo(B.VANGUARD_ARCANE_4PC_SPEED_MULT, 6);
    // The absorb aura itself survives beside the speed aura.
    expect(auraOn(ally, 'temporal_barrier')?.kind).toBe('absorb');
    const control = barrierOnAlly(3);
    expect(auraOn(control, HOURBINDER_HASTE_ID)).toBeUndefined();
    expect(auraOn(control, 'temporal_barrier')?.kind).toBe('absorb');
    expect(moveSpeedMult(control)).toBe(1);
  });
});

describe('Emberlash Regalia (fire)', () => {
  const SET = 'vanguard_mage_fire';

  function cinderfallRecharge(pieces: number) {
    const sim = live('mage', 'fire', SET, pieces);
    const mob = addHostile(sim, 10);
    cast(sim, 'fire_blast', mob);
    return expectDefined(sim.player.abilityCharges?.fire_blast);
  }

  it('2pc: each Cinderfall charge recharges in 27 sec (the charge model reads it)', () => {
    const worn = cinderfallRecharge(2);
    expect(worn.rechargeLength).toBe(27);
    expect(worn.recharges?.[0]).toBe(27);
    const bare = cinderfallRecharge(1);
    expect(bare.rechargeLength).toBe(30);
    expect(bare.recharges?.[0]).toBe(30);
  });

  function barrierAfterCinderfall(pieces: number): number | undefined {
    const sim = live('mage', 'fire', SET, pieces);
    const mob = addHostile(sim, 10);
    sim.targetEntity(mob.id);
    ready(sim, 'fire_blast');
    sim.player.cooldowns.set('blazing_barrier', 20);
    sim.castAbility('fire_blast');
    return sim.player.cooldowns.get('blazing_barrier');
  }

  it('4pc: Cinderfall shaves 2 sec off Blazing Barrier, not at 3 pieces', () => {
    expect(barrierAfterCinderfall(4)).toBe(20 - B.VANGUARD_FIRE_4PC_BARRIER_REFUND_SEC);
    expect(barrierAfterCinderfall(3)).toBe(20);
  });
});

describe('Rimewarden Garb (frost)', () => {
  const SET = 'vanguard_mage_frost';

  it('2pc: Icebind cooldown 22 -> 20 sec, not at 1 piece', () => {
    expect(resolved(live('mage', 'frost', SET, 2), 'frost_nova').cooldown).toBe(20);
    expect(resolved(live('mage', 'frost', SET, 1), 'frost_nova').cooldown).toBe(22);
  });

  function flitstepAfterIcebind(pieces: number): number | undefined {
    const sim = live('mage', 'frost', SET, pieces);
    addHostile(sim, 3);
    ready(sim, 'frost_nova');
    sim.player.cooldowns.set('blink', 10);
    sim.castAbility('frost_nova');
    expect(sim.player.cooldowns.has('frost_nova')).toBe(true);
    return sim.player.cooldowns.get('blink');
  }

  it('4pc: Icebind shaves 5 sec off Flitstep, not at 3 pieces', () => {
    expect(flitstepAfterIcebind(4)).toBe(10 - B.VANGUARD_FROST_4PC_FLITSTEP_REFUND_SEC);
    expect(flitstepAfterIcebind(3)).toBe(10);
  });

  it('4pc refund reaches a Double Blink charge bank (the soonest running timer)', () => {
    const sim = live('mage', 'frost', SET, 4);
    const p = sim.player;
    // Empty bank, two timers running: the cooldown mirror shows the soonest.
    p.abilityCharges = {
      blink: { charges: 0, maxCharges: 2, recharge: 8, rechargeLength: 19.5, recharges: [8, 15] },
    };
    p.cooldowns.set('blink', 8);
    refundFlitstep(p, B.VANGUARD_FROST_4PC_FLITSTEP_REFUND_SEC);
    expect(p.abilityCharges.blink.recharges).toEqual([3, 15]);
    expect(p.cooldowns.get('blink')).toBe(3);
    // A refund that finishes the soonest timer returns that charge.
    refundFlitstep(p, B.VANGUARD_FROST_4PC_FLITSTEP_REFUND_SEC);
    expect(p.abilityCharges.blink.charges).toBe(1);
    expect(p.abilityCharges.blink.recharges).toEqual([15]);
    expect(p.cooldowns.has('blink')).toBe(false);
    // A full bank is left alone.
    p.abilityCharges.blink = { charges: 2, maxCharges: 2, recharge: 0, rechargeLength: 19.5 };
    refundFlitstep(p, B.VANGUARD_FROST_4PC_FLITSTEP_REFUND_SEC);
    expect(p.abilityCharges.blink.charges).toBe(2);
  });
});

describe('Dreadquill Vestments (affliction)', () => {
  const SET = 'vanguard_warlock_affliction';

  it('2pc: Harrow casts in 1.2 sec (from 1.5), not at 1 piece', () => {
    expect(resolved(live('warlock', 'affliction', SET, 2), 'fear').castTime).toBeCloseTo(1.2, 6);
    expect(resolved(live('warlock', 'affliction', SET, 1), 'fear').castTime).toBeCloseTo(1.5, 6);
  });

  /** Channels Consume standing still at low health; pairs each pulse's damage
   *  with its self-heal. */
  function consumePulses(pieces: number) {
    const sim = live('warlock', 'affliction', SET, pieces);
    const mob = addHostile(sim, 10);
    sim.player.hp = Math.round(sim.player.maxHp * 0.1);
    const events = cast(sim, 'drain_life', mob);
    for (let i = 0; i < 20 * 4; i++) events.push(...sim.tick());
    const hits = events.filter(
      (event): event is Extract<SimEvent, { type: 'damage' }> =>
        event.type === 'damage' && event.ability === 'Consume' && event.targetId === mob.id,
    );
    const heals = events.filter(
      (event): event is Extract<SimEvent, { type: 'heal2' }> =>
        event.type === 'heal2' && event.ability === 'Consume' && event.targetId === sim.player.id,
    );
    return { hits, heals };
  }

  it('4pc: Consume heals for 30 percent more, not at 3 pieces', () => {
    const worn = consumePulses(4);
    expect(worn.hits.length).toBeGreaterThan(0);
    expect(worn.heals).toHaveLength(worn.hits.length);
    worn.hits.forEach((hit, i) => {
      expect(worn.heals[i]?.amount).toBe(
        Math.round(hit.amount * B.VANGUARD_AFFLICTION_4PC_CONSUME_HEAL_MULT),
      );
    });
    // Affliction transfers all of the damage (healFrac 1) below the tier.
    const bare = consumePulses(3);
    expect(bare.hits.length).toBeGreaterThan(0);
    bare.hits.forEach((hit, i) => {
      expect(bare.heals[i]?.amount).toBe(hit.amount);
    });
  });

  it('4pc: Consume can be channeled while moving, not at 3 pieces', () => {
    const sim = live('warlock', 'affliction', SET, 4);
    expect(resolved(sim, 'drain_life').castWhileMoving).toBe(true);
    expect(castWhileMoving(sim, 'drain_life', addHostile(sim, 10))).toBe(true);
    const bare = live('warlock', 'affliction', SET, 3);
    expect(resolved(bare, 'drain_life').castWhileMoving).toBeFalsy();
    expect(castWhileMoving(bare, 'drain_life', addHostile(bare, 10))).toBe(false);
    // Only Consume: another hard cast still refuses the moving press.
    expect(castWhileMoving(sim, 'fear', addHostile(sim, 10))).toBe(false);
  });

  it('4pc: the old Passing Sentence self-heal is gone', () => {
    const sim = live('warlock', 'affliction', SET, 4);
    expect(modsOf(sim).procs.some((proc) => proc.id.startsWith('set_vanguard_warlock'))).toBe(
      false,
    );
  });
});

describe('Marrowbound Regalia (demonology)', () => {
  const SET = 'vanguard_warlock_demonology';

  it('2pc: Bone Armor cooldown 45 -> 35 sec, not at 1 piece', () => {
    expect(resolved(live('warlock', 'demonology', SET, 2), 'bone_armor').cooldown).toBe(35);
    expect(resolved(live('warlock', 'demonology', SET, 1), 'bone_armor').cooldown).toBe(45);
  });

  function boneArmorAfterCommand(pieces: number): number | undefined {
    const sim = live('warlock', 'demonology', SET, pieces);
    const mob = addHostile(sim, 10);
    sim.player.cooldowns.set('bone_armor', 30);
    // The castNth trigger's real seam: every completed cast funnels here.
    onCastCompleted(sim.ctx, sim.player, 'reaping_command', mob);
    return sim.player.cooldowns.get('bone_armor');
  }

  it('4pc: Reaping Command shaves 2 sec off Bone Armor, not at 3 pieces', () => {
    expect(boneArmorAfterCommand(4)).toBe(30 - B.VANGUARD_DEMONOLOGY_4PC_BONE_ARMOR_REFUND_SEC);
    expect(boneArmorAfterCommand(3)).toBe(30);
  });
});

describe('Slagcrown Vestments (destruction)', () => {
  const SET = 'vanguard_warlock_destruction';

  it('2pc: Cinderhide cooldown 120 -> 90 sec, not at 1 piece', () => {
    expect(resolved(live('warlock', 'destruction', SET, 2), 'cinderhide').cooldown).toBe(90);
    expect(resolved(live('warlock', 'destruction', SET, 1), 'cinderhide').cooldown).toBe(120);
  });

  function seedPact(sim: Sim, target: Entity): void {
    if (target.auras.some((aura) => aura.id === 'immolate')) return;
    target.auras.push({
      id: 'immolate',
      name: 'Burning Pact',
      kind: 'dot',
      value: 12,
      remaining: 15,
      duration: 15,
      tickInterval: 3,
      tickTimer: 3,
      sourceId: sim.player.id,
      school: 'fire',
    });
  }

  function instantRuinbolt(sim: Sim) {
    return sim.player.auras.find(
      (aura) => aura.kind === 'next_cast_instant' && aura.empowerAbilities?.includes('chaos_bolt'),
    );
  }

  function afterConflagrates(pieces: number, casts: number): Sim {
    const sim = live('warlock', 'destruction', SET, pieces);
    const mob = addHostile(sim, 10);
    sim.targetEntity(mob.id);
    for (let i = 0; i < casts; i++) {
      seedPact(sim, mob);
      sim.player.gcdRemaining = 0;
      sim.player.resource = sim.player.maxResource;
      sim.player.abilityCharges = undefined;
      sim.player.cooldowns.delete('conflagrate');
      sim.castAbility('conflagrate');
      for (let tick = 0; tick < 5; tick++) sim.tick();
    }
    return sim;
  }

  it('4pc: every second Conflagrate arms an instant Ruinbolt for 8 sec, not at 3 pieces', () => {
    expect(instantRuinbolt(afterConflagrates(4, 1))).toBeUndefined();
    const armed = expectDefined(instantRuinbolt(afterConflagrates(4, 2)));
    expect(armed.duration).toBe(B.VANGUARD_DESTRUCTION_4PC_WINDOW_SEC);
    expect(instantRuinbolt(afterConflagrates(3, 2))).toBeUndefined();
  });

  it('4pc: the instant Ruinbolt consumes cleanly beside Desolation', () => {
    const sim = afterConflagrates(4, 2);
    const desolationBefore = sim.player.auras.find((aura) => aura.id === 'desolation');
    const stacksBefore = desolationBefore?.stacks ?? 0;
    expect(stacksBefore).toBeGreaterThan(0); // Conflagrate grants Desolation
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    // Enough Wrack for the 3-point Ruinbolt.
    gainRuin(sim.ctx, sim.player, 3);
    const ruinBefore = ruinAmount(sim.player);
    sim.castAbility('chaos_bolt');
    expect(ruinAmount(sim.player)).toBe(ruinBefore - 3); // the Ruinbolt was committed
    // Instant: no cast bar, the empower is gone, one Desolation stack spent.
    expect(sim.player.castingAbility).toBeFalsy();
    expect(instantRuinbolt(sim)).toBeUndefined();
    const stacksAfter = sim.player.auras.find((aura) => aura.id === 'desolation')?.stacks ?? 0;
    expect(stacksAfter).toBe(stacksBefore - 1);
  });
});

describe('Starwarden Raiment (balance)', () => {
  const SET = 'vanguard_druid_balance';

  it('2pc: Gripping Roots casts 0.5 sec faster, not at 1 piece', () => {
    const worn = resolved(live('druid', 'balance', SET, 2), 'entangling_roots').castTime;
    const bare = resolved(live('druid', 'balance', SET, 1), 'entangling_roots').castTime;
    expect(bare - worn).toBeCloseTo(B.VANGUARD_BALANCE_2PC_ROOTS_CAST_CUT_SEC, 6);
  });

  const SET_AURAS = [B.VANGUARD_BALANCE_4PC_MOBILE_AURA_ID, B.VANGUARD_BALANCE_4PC_SPEED_AURA_ID];

  function rooted(pieces: number) {
    const sim = live('druid', 'balance', SET, pieces);
    const mob = addHostile(sim, 10);
    cast(sim, 'entangling_roots', mob);
    expect(mob.auras.some((aura) => aura.kind === 'root')).toBe(true);
    return { sim, mob, p: sim.player };
  }

  it('4pc: Gripping Roots grants cast-while-moving and +20 percent speed for 4 sec', () => {
    const { sim, mob, p } = rooted(4);
    const speed = expectDefined(auraOn(p, B.VANGUARD_BALANCE_4PC_SPEED_AURA_ID));
    expect(speed.kind).toBe('buff_speed');
    expect(speed.value).toBe(B.VANGUARD_BALANCE_4PC_SPEED_MULT);
    expect(speed.duration).toBe(B.VANGUARD_BALANCE_4PC_DURATION_SEC);
    const mobile = expectDefined(auraOn(p, B.VANGUARD_BALANCE_4PC_MOBILE_AURA_ID));
    expect(mobile.kind).toBe('processional_grace');
    expect(mobile.duration).toBe(B.VANGUARD_BALANCE_4PC_DURATION_SEC);
    expect(moveSpeedMult(p)).toBeCloseTo(B.VANGUARD_BALANCE_4PC_SPEED_MULT, 6);
    expect(castWhileMoving(sim, 'wrath', mob)).toBe(true);
    const bare = rooted(3);
    expect(bare.p.auras.some((aura) => SET_AURAS.includes(aura.id))).toBe(false);
    expect(moveSpeedMult(bare.p)).toBe(1);
    expect(castWhileMoving(bare.sim, 'wrath', bare.mob)).toBe(false);
  });

  it('4pc: at most once every 20 sec (the icd arms on the proc)', () => {
    const { sim, mob, p } = rooted(4);
    // Armed at the proc (the cast helper rides out the Roots projectile after).
    const icd = expectDefined(p.procState?.icds.set_vanguard_druid_balance_4pc);
    expect(icd).toBeLessThanOrEqual(B.VANGUARD_BALANCE_4PC_ICD_SEC);
    expect(icd).toBeGreaterThan(B.VANGUARD_BALANCE_4PC_ICD_SEC - 1);
    p.auras = p.auras.filter((aura) => !SET_AURAS.includes(aura.id));
    cast(sim, 'entangling_roots', mob);
    expect(p.auras.some((aura) => SET_AURAS.includes(aura.id))).toBe(false);
    for (let i = 0; i < 20 * B.VANGUARD_BALANCE_4PC_ICD_SEC; i++) sim.tick();
    expect(p.procState?.icds.set_vanguard_druid_balance_4pc).toBeUndefined();
    cast(sim, 'entangling_roots', mob);
    expect(auraOn(p, B.VANGUARD_BALANCE_4PC_SPEED_AURA_ID)).toBeDefined();
    expect(auraOn(p, B.VANGUARD_BALANCE_4PC_MOBILE_AURA_ID)).toBeDefined();
  });
});

describe('Bloodmane Hide (feral)', () => {
  const SET = 'vanguard_druid_feral';

  it('2pc: Bruin Rush cooldown 15 -> 12 sec, not at 1 piece', () => {
    expect(resolved(live('druid', 'feral', SET, 2), 'bear_charge').cooldown).toBe(12);
    expect(resolved(live('druid', 'feral', SET, 1), 'bear_charge').cooldown).toBe(15);
  });

  function rushShield(pieces: number) {
    const sim = live('druid', 'feral', SET, pieces);
    const mob = addHostile(sim, 15);
    cast(sim, 'bear_charge', mob);
    expect(sim.player.cooldowns.has('bear_charge')).toBe(true);
    return { aura: auraOn(sim.player, 'set_vanguard_druid_feral_4pc'), p: sim.player };
  }

  it('4pc: Bruin Rush shields the druid for 6 percent of max health, not at 3', () => {
    const { aura, p } = rushShield(4);
    const shield = expectDefined(aura);
    expect(shield.kind).toBe('absorb');
    expect(shield.value).toBe(Math.round(p.maxHp * B.VANGUARD_FERAL_4PC_SHIELD_PCT_MAX));
    expect(shield.duration).toBe(B.VANGUARD_FERAL_4PC_SHIELD_DURATION_SEC);
    expect(rushShield(3).aura).toBeUndefined();
  });
});

describe('Thistlebloom Vestment (restoration druid)', () => {
  const SET = 'vanguard_druid_restoration';

  it('2pc: Fleetmend cooldown 8 -> 7 sec, not at 1 piece', () => {
    expect(resolved(live('druid', 'restoration', SET, 2), 'swiftmend').cooldown).toBe(7);
    expect(resolved(live('druid', 'restoration', SET, 1), 'swiftmend').cooldown).toBe(8);
  });

  function fleetmendSpeed(pieces: number) {
    const sim = live('druid', 'restoration', SET, pieces);
    const ally = addAlly(sim, 'Bloomed');
    ally.hp = Math.round(ally.maxHp * 0.3);
    cast(sim, 'rejuvenation', ally);
    cast(sim, 'swiftmend', ally);
    expect(sim.player.cooldowns.has('swiftmend')).toBe(true);
    return { aura: auraOn(sim.player, 'set_vanguard_druid_restoration_4pc'), p: sim.player };
  }

  it('4pc: Fleetmend grants the druid +30 percent movement speed for 3 sec, not at 3', () => {
    const { aura, p } = fleetmendSpeed(4);
    expect(expectDefined(aura).duration).toBe(B.VANGUARD_RESTO_DRUID_4PC_SPEED_DURATION_SEC);
    expect(moveSpeedMult(p)).toBeCloseTo(B.VANGUARD_RESTO_DRUID_4PC_SPEED_MULT, 6);
    expect(fleetmendSpeed(3).aura).toBeUndefined();
  });
});

describe('Vanguard B sets: tooltip numbers match the constants', () => {
  const pct = (mult: number) => Math.round(Math.abs(1 - mult) * 100);
  const EXPECTED: Record<string, [number[], number[]]> = {
    vanguard_shaman_elemental: [
      [B.VANGUARD_ELEMENTAL_2PC_UNLEASH_COOLDOWN_CUT_SEC],
      [
        pct(B.VANGUARD_ELEMENTAL_4PC_SPEED_MULT),
        B.VANGUARD_ELEMENTAL_4PC_DURATION_SEC,
        B.VANGUARD_ELEMENTAL_4PC_ICD_SEC,
      ],
    ],
    vanguard_shaman_enhancement: [
      [pct(B.VANGUARD_ENHANCEMENT_2PC_SLOW_MULT), B.VANGUARD_ENHANCEMENT_2PC_SLOW_DURATION_SEC],
      [B.VANGUARD_ENHANCEMENT_4PC_TRANCE_REFUND_SEC],
    ],
    vanguard_shaman_restoration: [
      [B.VANGUARD_RESTO_SHAMAN_2PC_CAST_CUT_SEC, B.VANGUARD_RESTO_SHAMAN_2PC_HEALTH_BELOW * 100],
      [
        B.VANGUARD_RESTO_SHAMAN_4PC_SHIELD_PCT_MAX * 100,
        B.VANGUARD_RESTO_SHAMAN_4PC_SHIELD_DURATION_SEC,
      ],
    ],
    vanguard_mage_arcane: [
      [B.VANGUARD_ARCANE_2PC_BARRIER_COOLDOWN_CUT_SEC],
      [pct(B.VANGUARD_ARCANE_4PC_SPEED_MULT), B.VANGUARD_ARCANE_4PC_SPEED_DURATION_SEC],
    ],
    vanguard_mage_fire: [
      [B.VANGUARD_FIRE_2PC_CINDERFALL_RECHARGE_CUT_SEC],
      [B.VANGUARD_FIRE_4PC_BARRIER_REFUND_SEC],
    ],
    vanguard_mage_frost: [
      [B.VANGUARD_FROST_2PC_ICEBIND_COOLDOWN_CUT_SEC],
      [B.VANGUARD_FROST_4PC_FLITSTEP_REFUND_SEC],
    ],
    vanguard_warlock_affliction: [
      [B.VANGUARD_AFFLICTION_2PC_HARROW_CAST_CUT_SEC],
      [pct(B.VANGUARD_AFFLICTION_4PC_CONSUME_HEAL_MULT)],
    ],
    vanguard_warlock_demonology: [
      [B.VANGUARD_DEMONOLOGY_2PC_BONE_ARMOR_COOLDOWN_CUT_SEC],
      [B.VANGUARD_DEMONOLOGY_4PC_BONE_ARMOR_REFUND_SEC],
    ],
    vanguard_warlock_destruction: [
      [B.VANGUARD_DESTRUCTION_2PC_CINDERHIDE_COOLDOWN_CUT_SEC],
      [B.VANGUARD_DESTRUCTION_4PC_WINDOW_SEC],
    ],
    vanguard_druid_balance: [
      [B.VANGUARD_BALANCE_2PC_ROOTS_CAST_CUT_SEC],
      [
        pct(B.VANGUARD_BALANCE_4PC_SPEED_MULT),
        B.VANGUARD_BALANCE_4PC_DURATION_SEC,
        B.VANGUARD_BALANCE_4PC_ICD_SEC,
      ],
    ],
    vanguard_druid_feral: [
      [B.VANGUARD_FERAL_2PC_RUSH_COOLDOWN_CUT_SEC],
      [B.VANGUARD_FERAL_4PC_SHIELD_PCT_MAX * 100, B.VANGUARD_FERAL_4PC_SHIELD_DURATION_SEC],
    ],
    vanguard_druid_restoration: [
      [B.VANGUARD_RESTO_DRUID_2PC_FLEETMEND_COOLDOWN_CUT_SEC],
      [pct(B.VANGUARD_RESTO_DRUID_4PC_SPEED_MULT), B.VANGUARD_RESTO_DRUID_4PC_SPEED_DURATION_SEC],
    ],
  };

  const numbersIn = (text: string) =>
    [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));

  it('every tier prints exactly its constants, in order', () => {
    for (const [setId] of SETS_B) {
      const [two, four] = expectDefined(EXPECTED[setId], setId);
      const set = expectDefined(ITEM_SETS[setId]);
      const texts = set.bonuses.map((tier) => expectDefined(tier.text, `${setId} text`));
      expect(numbersIn(expectDefined(texts[0])), `${setId} 2pc`).toEqual(
        two.map((n) => Number(n.toFixed(4))),
      );
      expect(numbersIn(expectDefined(texts[1])), `${setId} 4pc`).toEqual(
        four.map((n) => Number(n.toFixed(4))),
      );
      // Copy rules: no em or en dashes.
      const dashCodes = [0x2013, 0x2014];
      for (const text of texts) {
        expect([...text].filter((ch) => dashCodes.includes(ch.charCodeAt(0)))).toEqual([]);
      }
    }
  });

  it('the destruction copy names every second Conflagrate (n = 2)', () => {
    expect(B.VANGUARD_DESTRUCTION_4PC_CONFLAGRATES_PER_PROC).toBe(2);
    expect(ITEM_SETS.vanguard_warlock_destruction?.bonuses[1]?.text).toMatch(
      /Every second Conflagrate/,
    );
  });
});

describe('Vanguard B sets: no bonus without the set', () => {
  it('a bare character of each spec resolves none of the rows', () => {
    for (const [, cls, spec] of SETS_B) {
      const bare = computeCharacterModifiers(cls, { spec, rows: {} }, 20, {});
      expect(bare.procs.some((proc) => proc.id.startsWith('set_vanguard_'))).toBe(false);
    }
    // modsOf is the live read the combat modules use.
    const sim = live('mage', 'fire', 'vanguard_mage_fire', 4);
    expect(modsOf(sim).procs.some((proc) => proc.id === 'set_vanguard_mage_fire_4pc')).toBe(true);
  });
});
