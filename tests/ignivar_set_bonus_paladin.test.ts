// Paladin Crucible set bonuses (docs/prd/ignivar-set-bonus-final.md): each
// bonus proven at the seam it rides. Every paladin bonus is a BESPOKE bend
// (the set doc marks all six), so the proofs pair a unit-level check of the
// flag-gated module bend (minimal fake ctx, the warrior exemplar shape) with
// a live-cast Sim control pair where the bend crosses the dispatch. No paladin
// bend touches the rng draw count or order for anyone: the Oathpyre 2pc moves
// only the threshold of the ONE existing draw.
import { describe, expect, it } from 'vitest';
import { pushbackCast } from '../src/sim/combat/casting_lifecycle';
import {
  BEACON_HEAL_FRACTION,
  beaconTransferFraction,
  placeBeaconOfLight,
} from '../src/sim/combat/paladin_beacon';
import {
  DAWN_RHYTHM_COOLDOWN_REDUCTION,
  dawnRhythmCutSec,
  triggerPaladinDawnRhythm,
} from '../src/sim/combat/paladin_dawn_rhythm';
import {
  applyDawnsWrathOverride,
  DAWNS_WRATH_DAMAGE_MULT,
  DAWNS_WRATH_KIND,
  grantDawnsWrath,
} from '../src/sim/combat/paladin_dawns_wrath';
import {
  RADIANT_RESONANCE_DAWN_CAST_TIME,
  RADIANT_RESONANCE_KIND,
  radiantResonanceCastTime,
} from '../src/sim/combat/paladin_radiant_resonance';
import {
  applySolarReprisalOverride,
  OATHPYRE_4PC_BULWARK_AURA_ID,
  SOLAR_REPRISAL_BLOCK_CHANCE,
  SOLAR_REPRISAL_KIND,
  SOLAR_REPRISAL_VOWKEEPER_CHANCE,
  tryGrantSolarReprisal,
} from '../src/sim/combat/paladin_solar_reprisal';
import { ABILITIES } from '../src/sim/content/classes';
import {
  DAWNFORGED_2PC_BEACON_HEAL_FRACTION,
  OATHPYRE_2PC_BLOCK_CHANCE,
  OATHPYRE_2PC_VOWKEEPER_CHANCE,
  OATHPYRE_4PC_SHIELD_DURATION_SEC,
  OATHPYRE_4PC_SHIELD_PCT_MAX,
  setBonusFlag,
  ZEALFIRE_2PC_DAWN_RHYTHM_CUT_SEC,
  ZEALFIRE_4PC_DAWNS_WRATH_DAMAGE_MULT,
} from '../src/sim/content/ignivar_set_bonuses';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { computeCharacterModifiers } from '../src/sim/set_bonus_mods';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura, Entity } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const SET_SLOTS = ['helmet', 'shoulder', 'chest', 'gloves', 'legs'] as const;

function worn(setId: string, pieces: number): Partial<Record<string, string>> {
  const equipment: Partial<Record<string, string>> = {};
  for (const slot of SET_SLOTS.slice(0, pieces)) equipment[slot] = `${setId}_${slot}`;
  return equipment;
}

function paladinMods(spec: string, equipment: Partial<Record<string, string>>) {
  return computeCharacterModifiers('paladin', { spec, rows: {} }, 25, equipment);
}

function equipSet(sim: Sim, setId: string, pieces: number, pid?: number): void {
  for (const slot of SET_SLOTS.slice(0, pieces)) {
    sim.addItem(`${setId}_${slot}`, 1, pid);
    sim.equipItem(`${setId}_${slot}`, pid);
  }
}

function radiantResonanceAura(sourceId: number): Aura {
  return {
    id: 'radiant_resonance',
    name: 'Radiant Resonance',
    kind: RADIANT_RESONANCE_KIND,
    value: 0.5,
    remaining: 10,
    duration: 10,
    sourceId,
    school: 'holy',
  } satisfies Aura;
}

function solarReprisalAura(sourceId: number): Aura {
  return {
    id: 'solar_reprisal',
    name: 'Solar Reprisal',
    kind: SOLAR_REPRISAL_KIND,
    value: 0.2,
    remaining: 8,
    duration: 8,
    sourceId,
    school: 'holy',
  } satisfies Aura;
}

describe('paladin Crucible sets: the resolver registration', () => {
  it('registers both tiers per worn set and nothing one piece short', () => {
    for (const [setId, spec] of [
      ['dawnforged', 'holy'],
      ['oathpyre', 'protection'],
      ['zealfire', 'retribution'],
    ] as const) {
      const four = paladinMods(spec, worn(setId, 4));
      expect(four.selected[setBonusFlag(setId, 2)], setId).toBe(true);
      expect(four.selected[setBonusFlag(setId, 4)], setId).toBe(true);
      const oneShort = paladinMods(spec, worn(setId, 1));
      expect(oneShort.selected[setBonusFlag(setId, 2)], setId).toBeUndefined();
    }
  });

  it('Dawnforged 2pc carries the pushback rider on the talent seam', () => {
    expect(paladinMods('holy', worn('dawnforged', 2)).global.castPushbackReduction).toBe(1);
    expect(paladinMods('holy', {}).global.castPushbackReduction).toBe(0);
  });
});

describe('Dawnforged 2pc: the beacon fraction, both readers', () => {
  function beaconHarness(equipment: Partial<Record<string, string>>) {
    const mods = paladinMods('holy', equipment);
    const applied: Aura[] = [];
    const ctx = {
      entities: new Map<number, Entity>(),
      players: new Map([[1, { cls: 'paladin' }]]),
      playerMods: () => mods,
      applyAura: (_target: Entity, aura: Aura) => {
        applied.push(aura);
      },
      emit: () => {},
    } as unknown as SimContext;
    const paladin = { id: 1, kind: 'player' } as unknown as Entity;
    const target = { id: 2, kind: 'player', auras: [] } as unknown as Entity;
    return { ctx, paladin, target, applied };
  }

  it('bakes 55 percent into the placed aura value for wearers, 50 for everyone else', () => {
    const wearer = beaconHarness(worn('dawnforged', 2));
    placeBeaconOfLight(wearer.ctx, wearer.paladin, wearer.target);
    expect(expectDefined(wearer.applied[0]).value).toBeCloseTo(
      DAWNFORGED_2PC_BEACON_HEAL_FRACTION,
      10,
    );

    const control = beaconHarness({});
    placeBeaconOfLight(control.ctx, control.paladin, control.target);
    expect(expectDefined(control.applied[0]).value).toBeCloseTo(BEACON_HEAL_FRACTION, 10);
  });

  it('the heal arithmetic reads the SAME placed value back (and falls back to base)', () => {
    const holder = {
      auras: [
        {
          id: 'beacon_of_light',
          name: 'Beacon of Light',
          kind: 'beacon_of_light',
          value: DAWNFORGED_2PC_BEACON_HEAL_FRACTION,
          remaining: 100,
          duration: 100,
          sourceId: 1,
          school: 'holy',
        },
      ],
    } as unknown as Entity;
    expect(beaconTransferFraction(holder, 1)).toBeCloseTo(DAWNFORGED_2PC_BEACON_HEAL_FRACTION, 10);
    // Another paladin's beacon on the same holder does not answer for source 1.
    expect(beaconTransferFraction(holder, 9)).toBeCloseTo(BEACON_HEAL_FRACTION, 10);
    expect(beaconTransferFraction({ auras: [] } as unknown as Entity, 1)).toBeCloseTo(
      BEACON_HEAL_FRACTION,
      10,
    );
  });

  it('live transfer: a wearer beacon copies 55 percent of effective healing (control 50)', () => {
    function transferredHeal(wearer: boolean): number {
      const sim = new Sim({ seed: 211, playerClass: 'paladin', noPlayer: true });
      const paladinId = sim.addPlayer('paladin', 'Aurelia');
      const allyId = sim.addPlayer('warrior', 'Borin');
      const beaconId = sim.addPlayer('priest', 'Celia');
      for (const id of [paladinId, allyId, beaconId]) sim.setPlayerLevel(20, id);
      expect(sim.setSpec('holy', paladinId)).toBe(true);
      sim.partyInvite(allyId, paladinId);
      sim.partyAccept(allyId);
      sim.partyInvite(beaconId, paladinId);
      sim.partyAccept(beaconId);
      if (wearer) equipSet(sim, 'dawnforged', 2, paladinId);
      const paladin = expectDefined(sim.entities.get(paladinId));
      const ally = expectDefined(sim.entities.get(allyId));
      const beacon = expectDefined(sim.entities.get(beaconId));
      paladin.resource = paladin.maxResource;
      paladin.gcdRemaining = 0;
      sim.targetEntity(beacon.id, paladinId);
      sim.castAbility('beacon_of_light', paladinId);
      // 40 effective points on the ally (the overheal clamp makes gear moot).
      ally.maxHp = 1_000;
      ally.hp = 960;
      beacon.maxHp = 1_000;
      beacon.hp = 1;
      sim.ctx.applyHeal(paladin, ally, 500, 'Test Heal', 'test_heal', false, false, true);
      return beacon.hp - 1;
    }
    expect(transferredHeal(true)).toBe(Math.round(40 * DAWNFORGED_2PC_BEACON_HEAL_FRACTION));
    expect(transferredHeal(false)).toBe(Math.round(40 * BEACON_HEAL_FRACTION));
  });

  it('the rider reaches the recalc and pushback does nothing to a wearer cast', () => {
    const sim = new Sim({ seed: 31, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('holy')).toBe(true);
    expect(sim.player.castPushbackReduction).toBe(0);
    equipSet(sim, 'dawnforged', 2);
    expect(sim.player.castPushbackReduction).toBe(1);

    const casting = (reduction: number) =>
      ({
        auras: [],
        channeling: false,
        castRemaining: 2,
        castTotal: 2,
        castPushbackReduction: reduction,
      }) as unknown as Entity;
    const immune = casting(1);
    pushbackCast(immune);
    expect(immune.castRemaining).toBe(2);
    const vulnerable = casting(0);
    pushbackCast(vulnerable);
    expect(vulnerable.castRemaining).toBeGreaterThan(2);
  });
});

describe("Dawnforged 4pc: Radiant Resonance's empowered Dawn's Embrace is instant", () => {
  it('the cast-time knob: wearers 0, everyone else the 1.5 cap, other casts untouched', () => {
    const wearerMods = paladinMods('holy', worn('dawnforged', 4));
    const baseMods = paladinMods('holy', {});
    const resonant = { auras: [radiantResonanceAura(1)] } as unknown as Entity;
    const quiet = { auras: [] } as unknown as Entity;
    expect(radiantResonanceCastTime(resonant, 'dawns_embrace', 2.5, wearerMods)).toBe(0);
    expect(radiantResonanceCastTime(resonant, 'dawns_embrace', 2.5, baseMods)).toBe(
      RADIANT_RESONANCE_DAWN_CAST_TIME,
    );
    // Without the proc the wearer flag changes nothing.
    expect(radiantResonanceCastTime(quiet, 'dawns_embrace', 2.5, wearerMods)).toBe(2.5);
    // The bend is keyed to Dawn's Embrace alone.
    expect(radiantResonanceCastTime(resonant, 'holy_light', 2.5, wearerMods)).toBe(2.5);
  });

  function makeHoly(pieces: number, seed = 4211): Sim {
    const sim = new Sim({ seed, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('holy')).toBe(true);
    if (pieces > 0) equipSet(sim, 'dawnforged', pieces);
    sim.player.resource = sim.player.maxResource;
    return sim;
  }

  it('resolves through the REAL resolve path (sim.resolvedAbility)', () => {
    const wearer = makeHoly(4);
    wearer.player.auras.push(radiantResonanceAura(wearer.player.id));
    expect(expectDefined(wearer.resolvedAbility('dawns_embrace')).castTime).toBe(0);

    const control = makeHoly(0);
    control.player.auras.push(radiantResonanceAura(control.player.id));
    expect(expectDefined(control.resolvedAbility('dawns_embrace')).castTime).toBe(
      RADIANT_RESONANCE_DAWN_CAST_TIME,
    );
  });

  it('live cast: the wearer heal lands instantly, consumes the proc, and bills half mana', () => {
    const wearer = makeHoly(4);
    wearer.player.auras.push(radiantResonanceAura(wearer.player.id));
    wearer.player.hp = Math.floor(wearer.player.maxHp / 2);
    const hpBefore = wearer.player.hp;
    const manaBefore = wearer.player.resource;
    wearer.targetEntity(wearer.player.id);
    wearer.castAbility('dawns_embrace');
    expect(wearer.player.castingAbility).toBeNull();
    expect(wearer.player.hp).toBeGreaterThan(hpBefore);
    expect(wearer.player.auras.some((aura) => aura.kind === RADIANT_RESONANCE_KIND)).toBe(false);
    expect(manaBefore - wearer.player.resource).toBe(
      Math.ceil(expectDefined(ABILITIES.dawns_embrace).cost * 0.5),
    );

    const control = makeHoly(0);
    control.player.auras.push(radiantResonanceAura(control.player.id));
    control.targetEntity(control.player.id);
    control.castAbility('dawns_embrace');
    expect(control.player.castingAbility).toBe('dawns_embrace');
  });
});

describe('Oathpyre 2pc: the Solar Reprisal arm chances', () => {
  function armChance(equipment: Partial<Record<string, string>>, source: 'block' | 'vowkeeper') {
    const mods = paladinMods('protection', equipment);
    const chances: number[] = [];
    const ctx = {
      players: new Map([[1, { cls: 'paladin' }]]),
      playerMods: () => mods,
      rng: {
        chance: (chance: number) => {
          chances.push(chance);
          return false;
        },
      },
    } as unknown as SimContext;
    const p = { id: 1, kind: 'player' } as unknown as Entity;
    tryGrantSolarReprisal(ctx, p, source);
    return chances;
  }

  it('wearers roll 30 percent on Vowkeeper and 40 on block; base stays 20/25', () => {
    expect(armChance(worn('oathpyre', 2), 'vowkeeper')).toEqual([OATHPYRE_2PC_VOWKEEPER_CHANCE]);
    expect(armChance(worn('oathpyre', 2), 'block')).toEqual([OATHPYRE_2PC_BLOCK_CHANCE]);
    expect(armChance({}, 'vowkeeper')).toEqual([SOLAR_REPRISAL_VOWKEEPER_CHANCE]);
    expect(armChance({}, 'block')).toEqual([SOLAR_REPRISAL_BLOCK_CHANCE]);
  });

  it('pins the wearer literals against the authored copy (30 and 40 percent)', () => {
    expect(OATHPYRE_2PC_VOWKEEPER_CHANCE).toBe(0.3);
    expect(OATHPYRE_2PC_BLOCK_CHANCE).toBe(0.4);
  });
});

describe('Oathpyre 4pc: consuming Solar Reprisal shields the wearer', () => {
  function consumeHarness(equipment: Partial<Record<string, string>>, armed = true) {
    const mods = paladinMods('protection', equipment);
    const applied: Aura[] = [];
    const ctx = {
      players: new Map([[1, { cls: 'paladin' }]]),
      playerMods: () => mods,
      applyAura: (_target: Entity, aura: Aura) => {
        applied.push(aura);
      },
      emit: () => {},
    } as unknown as SimContext;
    const p = {
      id: 1,
      kind: 'player',
      maxHp: 400,
      auras: armed ? [solarReprisalAura(1)] : [],
    } as unknown as Entity;
    return { ctx, p, applied };
  }

  function fakeResolved(abilityId: string): ResolvedAbility {
    return {
      def: expectDefined(ABILITIES[abilityId]),
      cost: 25,
      cooldown: 10,
      castTime: 0,
      effects: [],
    } as unknown as ResolvedAbility;
  }

  it('every one of the three consumers refreshes the ONE fixed-id absorb', () => {
    for (const consumer of ['sunward_disc', 'hammer_of_grace', 'holy_light']) {
      const { ctx, p, applied } = consumeHarness(worn('oathpyre', 4));
      applySolarReprisalOverride(ctx, p, fakeResolved(consumer));
      const shield = expectDefined(applied[0], consumer);
      expect(shield.id, consumer).toBe(OATHPYRE_4PC_BULWARK_AURA_ID);
      expect(shield.kind, consumer).toBe('absorb');
      expect(shield.value, consumer).toBe(Math.round(400 * OATHPYRE_4PC_SHIELD_PCT_MAX));
      expect(shield.duration, consumer).toBe(OATHPYRE_4PC_SHIELD_DURATION_SEC);
      // The Reprisal itself is consumed; a second cast without a fresh proc
      // must not shield again.
      applySolarReprisalOverride(ctx, p, fakeResolved(consumer));
      expect(applied.length, consumer).toBe(1);
    }
  });

  it('two pieces consume the Reprisal exactly as before, with no shield', () => {
    const { ctx, p, applied } = consumeHarness(worn('oathpyre', 2));
    const overridden = applySolarReprisalOverride(ctx, p, fakeResolved('sunward_disc'));
    expect(overridden.cost).toBe(0); // the existing override still applies
    expect(applied.length).toBe(0);
  });

  it('an unarmed cast neither shields nor rewrites', () => {
    const { ctx, p, applied } = consumeHarness(worn('oathpyre', 4), false);
    const res = fakeResolved('sunward_disc');
    expect(applySolarReprisalOverride(ctx, p, res)).toBe(res);
    expect(applied.length).toBe(0);
  });
});

describe('Zealfire 2pc: Final Edict and Dawnfall cut each other by 3 sec', () => {
  it('the cut selector: wearers 3, everyone else the base 2', () => {
    expect(dawnRhythmCutSec(paladinMods('retribution', worn('zealfire', 2)))).toBe(
      ZEALFIRE_2PC_DAWN_RHYTHM_CUT_SEC,
    );
    expect(dawnRhythmCutSec(paladinMods('retribution', {}))).toBe(DAWN_RHYTHM_COOLDOWN_REDUCTION);
    expect(ZEALFIRE_2PC_DAWN_RHYTHM_CUT_SEC).toBe(3);
  });

  it('the deeper cut never banks: a 2 sec remainder clears without going negative', () => {
    const player = { cooldowns: new Map([['dawnfall', 2]]) } as unknown as Entity;
    expect(triggerPaladinDawnRhythm(player, 'final_edict', ZEALFIRE_2PC_DAWN_RHYTHM_CUT_SEC)).toBe(
      2,
    );
    expect(player.cooldowns.has('dawnfall')).toBe(false);
  });

  it('live cast: a wearer Final Edict cuts a running Dawnfall by 3 (control 2)', () => {
    function dawnfallAfterEdict(wearer: boolean): number {
      const sim = new Sim({ seed: 9931, playerClass: 'paladin', autoEquip: true }) as Sim & {
        nextId: number;
        addEntity(entity: Entity): void;
      };
      sim.setPlayerLevel(20);
      expect(sim.setSpec('retribution')).toBe(true);
      if (wearer) equipSet(sim, 'zealfire', 2);
      sim.player.resource = sim.player.maxResource;
      const target = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
        x: sim.player.pos.x,
        y: sim.player.pos.y,
        z: sim.player.pos.z + 2,
      });
      target.maxHp = 50_000;
      target.hp = target.maxHp;
      target.hostile = true;
      target.aiState = 'idle';
      target.swingTimer = 999;
      sim.addEntity(target);
      sim.targetEntity(target.id);
      sim.rng.next = () => 0.5;
      sim.rng.chance = (chance) => chance > 0.5; // hit lands, procs and crits fail
      sim.player.cooldowns.set('dawnfall', 10);
      sim.castAbility('final_edict');
      return sim.player.cooldowns.get('dawnfall') ?? 0;
    }
    expect(dawnfallAfterEdict(true)).toBe(10 - ZEALFIRE_2PC_DAWN_RHYTHM_CUT_SEC);
    expect(dawnfallAfterEdict(false)).toBe(10 - DAWN_RHYTHM_COOLDOWN_REDUCTION);
  });
});

describe("Zealfire 4pc: Dawn's Wrath bakes the wearer mult into the aura", () => {
  function makeRetribution(pieces: number): Sim {
    const sim = new Sim({ seed: 9931, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('retribution')).toBe(true);
    if (pieces > 0) equipSet(sim, 'zealfire', pieces);
    sim.player.resource = sim.player.maxResource;
    return sim;
  }

  it('grant bakes 0.4 for wearers and 0.2 for everyone else', () => {
    const wearer = makeRetribution(4);
    grantDawnsWrath(wearer.ctx, wearer.player);
    const baked = expectDefined(wearer.player.auras.find((a) => a.kind === DAWNS_WRATH_KIND));
    expect(baked.value).toBeCloseTo(ZEALFIRE_4PC_DAWNS_WRATH_DAMAGE_MULT - 1, 10);

    const control = makeRetribution(0);
    grantDawnsWrath(control.ctx, control.player);
    const base = expectDefined(control.player.auras.find((a) => a.kind === DAWNS_WRATH_KIND));
    expect(base.value).toBeCloseTo(DAWNS_WRATH_DAMAGE_MULT - 1, 10);
  });

  it('the consume reads the AURA back, so the empowered Hammer carries 1.4 (control 1.2)', () => {
    const wearer = makeRetribution(4);
    grantDawnsWrath(wearer.ctx, wearer.player);
    const empowered = applyDawnsWrathOverride(
      wearer.ctx,
      wearer.player,
      expectDefined(wearer.resolvedAbility('hammer_of_wrath')),
    );
    const strike = expectDefined(empowered.effects.find((e) => e.type === 'directDamage'));
    expect((strike as { damageMult?: number }).damageMult).toBeCloseTo(
      ZEALFIRE_4PC_DAWNS_WRATH_DAMAGE_MULT,
      10,
    );
  });

  it('live damage: the wearer Hammer strikes 40 percent harder than its own base', () => {
    function castDamage(wearer: boolean, empowered: boolean): number {
      const sim = makeRetribution(wearer ? 4 : 0) as Sim & {
        nextId: number;
        addEntity(entity: Entity): void;
      };
      const target = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
        x: sim.player.pos.x,
        y: sim.player.pos.y,
        z: sim.player.pos.z + 15,
      });
      target.maxHp = 50_000;
      // Below the 20 percent execute window so the un-empowered control cast fires.
      target.hp = Math.round(target.maxHp * 0.19);
      target.hostile = true;
      target.aiState = 'idle';
      target.swingTimer = 999;
      sim.addEntity(target);
      sim.targetEntity(target.id);
      if (empowered) grantDawnsWrath(sim.ctx, sim.player);
      sim.player.spellPower = 70;
      sim.rng.next = () => 0.5;
      sim.rng.chance = (chance) => chance > 0.5;
      const hpBefore = target.hp;
      sim.castAbility('hammer_of_wrath');
      for (let tick = 0; tick < 200 && target.hp === hpBefore; tick++) sim.tick();
      return hpBefore - target.hp;
    }
    const wearerBase = castDamage(true, false);
    expect(wearerBase).toBeGreaterThan(0);
    expect(castDamage(true, true)).toBe(
      Math.round(wearerBase * ZEALFIRE_4PC_DAWNS_WRATH_DAMAGE_MULT),
    );
    const controlBase = castDamage(false, false);
    expect(castDamage(false, true)).toBe(Math.round(controlBase * DAWNS_WRATH_DAMAGE_MULT));
  });
});
