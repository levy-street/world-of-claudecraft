// Mage Crucible set bonuses (docs/prd/ignivar-set-bonus-final.md): each bonus
// proven at the seam it rides. Chronoweave (Aetherweave Vestments) 2pc bakes
// the 50 percent single-target rate into the mark at placeTemporalEcho (the
// one write combat and the aura tooltip both read back) and 4pc is a RESOLVED
// cooldownFlat rewrite on Temporal Cascade (17 to 12); Pyroclast 2pc moves the
// Scald execute threshold at fireGuaranteedCrit's sole functional reader (the
// crit roll is still drawn, only the outcome overrides, so no stream shifts)
// and 4pc widens the builder-crit Phoenix Trance shave at the one
// fireMageOnSpellHit site; Frostquench 2pc banks the crit Icicle through the
// noteSpellHit seam (the base bank site cannot see the crit) and 4pc selects
// the Winter's Chill charge count at both applyWintersChill branches.
// Non-wearer rng stays byte-identical everywhere; no mage bend draws rng.
import { describe, expect, it } from 'vitest';
import {
  chronomancyConvertArcaneDamage,
  ECHO_CONVERT_AOE,
  ECHO_CONVERT_SINGLE,
  ECHO_GROUP_CONVERT_SINGLE,
  placeGroupEcho,
  placeTemporalEcho,
} from '../src/sim/combat/chronomancy';
import {
  COMBUSTION_CDR_PER_CRIT,
  fireGuaranteedCrit,
  fireMageOnSpellHit,
  SCORCH_EXECUTE_HP,
} from '../src/sim/combat/fire_mage';
import {
  applyWintersChill,
  frostIcicleCharges,
  frostMageAfterCast,
  frostMageOnSpellHit,
  gainIcicle,
  ICICLE_MAX,
  WINTERS_CHILL_CHARGES,
} from '../src/sim/combat/frost_mage';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  CHRONOWEAVE_2PC_ECHO_CONVERT_SINGLE,
  CHRONOWEAVE_4PC_CASCADE_COOLDOWN_CUT_SEC,
  FROSTQUENCH_2PC_CRIT_BONUS_ICICLES,
  FROSTQUENCH_4PC_WINTERS_CHILL_CHARGES,
  PYROCLAST_2PC_SCALD_EXECUTE_HP,
  PYROCLAST_4PC_COMBUSTION_CDR_PER_CRIT,
  setBonusFlag,
} from '../src/sim/content/ignivar_set_bonuses';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { computeCharacterModifiers } from '../src/sim/set_bonus_mods';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const SET_SLOTS = ['helmet', 'shoulder', 'chest', 'gloves', 'legs'] as const;

function worn(setId: string, pieces: number): Partial<Record<string, string>> {
  const equipment: Partial<Record<string, string>> = {};
  for (const slot of SET_SLOTS.slice(0, pieces)) equipment[slot] = `${setId}_${slot}`;
  return equipment;
}

function mageMods(spec: string, equipment: Partial<Record<string, string>>) {
  return computeCharacterModifiers('mage', { spec, rows: {} }, 25, equipment);
}

function equipSet(sim: Sim, setId: string, pieces: number): void {
  for (const slot of SET_SLOTS.slice(0, pieces)) {
    sim.addItem(`${setId}_${slot}`, 1);
    sim.equipItem(`${setId}_${slot}`);
  }
}

function liveMage(seed: number, spec: 'arcane' | 'fire' | 'frost'): Sim {
  const sim = new Sim({ seed, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  return sim;
}

function addHostileMob(sim: Sim, distance = 3): Entity {
  const host = sim as Sim & { nextId: number; addEntity(entity: Entity): void };
  const mob = createMob(host.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  mob.maxHp = 100_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.swingTimer = 999;
  host.addEntity(mob);
  return mob;
}

function addAlly(sim: Sim, name: string, offsetZ: number): Entity {
  const id = sim.addPlayer('warrior', name);
  sim.setPlayerLevel(20, id);
  const ally = expectDefined(sim.entities.get(id));
  ally.pos.x = sim.player.pos.x;
  ally.pos.z = sim.player.pos.z + offsetZ;
  return ally;
}

function echoAuraOn(ally: Entity, sourceId: number) {
  return ally.auras.find((a) => a.kind === 'temporal_echo' && a.sourceId === sourceId);
}

describe('mage Crucible sets: the resolver registration', () => {
  it('registers both tiers per worn set and nothing one piece short', () => {
    for (const [setId, spec] of [
      ['chronoweave', 'arcane'],
      ['pyroclast', 'fire'],
      ['frostquench', 'frost'],
    ] as const) {
      const four = mageMods(spec, worn(setId, 4));
      expect(four.selected[setBonusFlag(setId, 2)], setId).toBe(true);
      expect(four.selected[setBonusFlag(setId, 4)], setId).toBe(true);
      const oneShort = mageMods(spec, worn(setId, 1));
      expect(oneShort.selected[setBonusFlag(setId, 2)], setId).toBeUndefined();
    }
  });

  it('all three caster/healer 2pcs carry the pushback rider', () => {
    expect(mageMods('arcane', worn('chronoweave', 2)).global.castPushbackReduction).toBe(1);
    expect(mageMods('fire', worn('pyroclast', 2)).global.castPushbackReduction).toBe(1);
    expect(mageMods('frost', worn('frostquench', 2)).global.castPushbackReduction).toBe(1);
    expect(mageMods('arcane', {}).global.castPushbackReduction).toBe(0);
  });
});

describe('Chronoweave 2pc: Temporal Echo converts 50 percent of single-target Arcane damage', () => {
  function placedRates(wearer: boolean) {
    const sim = liveMage(451, 'arcane');
    if (wearer) equipSet(sim, 'chronoweave', 2);
    const ally = addAlly(sim, 'Marked', 4);
    sim.player.resource = sim.player.maxResource;
    sim.targetEntity(ally.id);
    sim.castAbility('temporal_echo'); // instant: the mark lands through the real cast
    const aura = expectDefined(echoAuraOn(ally, sim.player.id));
    return { sim, ally, value: aura.value, rate: aura.echoConvertRate };
  }

  it('bakes 0.5 into the mark at placement, value and echoConvertRate together', () => {
    const bent = placedRates(true);
    expect(bent.rate).toBe(CHRONOWEAVE_2PC_ECHO_CONVERT_SINGLE);
    expect(bent.value).toBe(CHRONOWEAVE_2PC_ECHO_CONVERT_SINGLE);
    const control = placedRates(false);
    expect(control.rate).toBe(ECHO_CONVERT_SINGLE);
    expect(control.value).toBe(ECHO_CONVERT_SINGLE);
  });

  it('single-target conversion heals 50 percent for wearers (control 40)', () => {
    for (const wearer of [true, false]) {
      const { sim, ally } = placedRates(wearer);
      ally.hp = Math.max(1, ally.maxHp - 800);
      const before = ally.hp;
      chronomancyConvertArcaneDamage(sim.ctx, sim.player, 1000, 'arcane', false);
      expect(ally.hp - before).toBe(
        Math.round(1000 * (wearer ? CHRONOWEAVE_2PC_ECHO_CONVERT_SINGLE : ECHO_CONVERT_SINGLE)),
      );
    }
  });

  it('the AREA rate and the Cascada group rate stay base for wearers', () => {
    const { sim, ally } = placedRates(true);
    ally.hp = Math.max(1, ally.maxHp - 800);
    const before = ally.hp;
    chronomancyConvertArcaneDamage(sim.ctx, sim.player, 1000, 'arcane', true);
    expect(ally.hp - before).toBe(Math.round(1000 * ECHO_CONVERT_AOE));
    // A group echo placed BY a wearer keeps the 13 percent group coefficient:
    // the copy promises the single-target mark only.
    const second = addAlly(sim, 'Grouped', 6);
    placeGroupEcho(sim.ctx, sim.player, second, 8);
    expect(expectDefined(echoAuraOn(second, sim.player.id)).echoConvertRate).toBe(
      ECHO_GROUP_CONVERT_SINGLE,
    );
  });

  it('snapshot-at-placement: unequipping keeps the placed 50 until re-cast', () => {
    const { sim, ally } = placedRates(true);
    sim.unequipItem('helmet');
    ally.hp = Math.max(1, ally.maxHp - 800);
    const before = ally.hp;
    chronomancyConvertArcaneDamage(sim.ctx, sim.player, 1000, 'arcane', false);
    expect(ally.hp - before).toBe(Math.round(1000 * CHRONOWEAVE_2PC_ECHO_CONVERT_SINGLE));
    // Re-placing without the tier snaps back to base.
    placeTemporalEcho(sim.ctx, sim.player, ally, 15);
    expect(expectDefined(echoAuraOn(ally, sim.player.id)).echoConvertRate).toBe(
      ECHO_CONVERT_SINGLE,
    );
  });
});

describe("Chronoweave 4pc: Temporal Cascade's cooldown drops 17 to 12", () => {
  it('the resolved cooldown: 12 for wearers, 17 base, and no other row overlaps', () => {
    const entryOf = (equipment: Partial<Record<string, string>>) =>
      expectDefined(
        abilitiesKnownAt('mage', 25, mageMods('arcane', equipment)).find(
          (known) => known.def.id === 'temporal_cascade',
        ),
      );
    expect(entryOf({}).cooldown).toBe(17);
    expect(entryOf(worn('chronoweave', 4)).cooldown).toBe(
      17 - CHRONOWEAVE_4PC_CASCADE_COOLDOWN_CUT_SEC,
    );
    // The 2pc alone must NOT move the cooldown (the cut is the 4pc's row).
    expect(entryOf(worn('chronoweave', 2)).cooldown).toBe(17);
  });
});

describe('Pyroclast 2pc: Scald always crits at or below 35 percent health', () => {
  function critBand(wearer: boolean, hpFraction: number): boolean {
    const sim = liveMage(452, 'fire');
    if (wearer) equipSet(sim, 'pyroclast', 2);
    const mob = addHostileMob(sim);
    mob.hp = Math.round(mob.maxHp * hpFraction);
    return fireGuaranteedCrit(sim.ctx, sim.player, 'scorch', 'fire', mob);
  }

  it('the execute band: 35 for wearers, 30 base, boundary inclusive', () => {
    // Retuned 50 to 35 (2026-08-30): at 50 the whole bottom half of a fight
    // played at the execute ceiling, the lay-of-the-land study's dominant
    // outlier.
    expect(critBand(true, 0.33)).toBe(true);
    expect(critBand(false, 0.33)).toBe(false);
    expect(critBand(true, 0.35)).toBe(true); // at exactly 35 percent: "at or below"
    expect(critBand(true, 0.36)).toBe(false);
    expect(critBand(true, 0.4)).toBe(false); // the old 50-band case now misses
    expect(critBand(true, 0.25)).toBe(true);
    expect(critBand(false, 0.25)).toBe(true); // the base band still stands
  });

  it('execute-phase harness case: a real Scald cast crits the 33 percent target', () => {
    // The set doc's same-change obligation: both fire harnesses fight a
    // full-health dummy, so the execute band is proven here through the REAL
    // cast path with the natural crit roll pinned to a miss.
    function scaldCrit(wearer: boolean): boolean {
      const sim = liveMage(453, 'fire');
      if (wearer) equipSet(sim, 'pyroclast', 2);
      const mob = addHostileMob(sim);
      mob.hp = Math.round(mob.maxHp * 0.33);
      // Deny the natural crit WITHOUT denying the cast: spell avoidance now
      // rides the same rng.chance primitive (spell_resist.ts), so a blanket
      // `() => false` resists the Scald outright (amount 0, kind 'resist')
      // and the override never gets a hit to override. Discriminate by
      // probability instead: the hit roll is a high chance, the crit roll a
      // low one.
      sim.rng.chance = (p: number) => p > 0.5;
      sim.player.resource = sim.player.maxResource;
      sim.targetEntity(mob.id);
      sim.drainEvents();
      sim.castAbility('scorch'); // 1.5s cast, no traveling bolt
      const events: SimEvent[] = [];
      for (let tick = 0; tick < 60; tick++) events.push(...sim.tick());
      const hit = expectDefined(
        events.find(
          (event): event is Extract<SimEvent, { type: 'damage' }> =>
            event.type === 'damage' && event.targetId === mob.id,
        ),
      );
      return hit.crit === true;
    }
    expect(scaldCrit(true)).toBe(true);
    expect(scaldCrit(false)).toBe(false);
  });
});

describe('Pyroclast 4pc: builder crits outside Phoenix Trance shave 2 sec, up from 1', () => {
  function shaveAfterCrit(
    wearer: boolean,
    opts: { inTrance?: boolean; abilityId?: string } = {},
  ): number {
    const sim = liveMage(454, 'fire');
    if (wearer) equipSet(sim, 'pyroclast', 4);
    if (opts.inTrance) {
      sim.ctx.applyAura(sim.player, {
        id: 'combustion',
        name: 'Phoenix Trance',
        kind: 'combustion',
        value: 0,
        remaining: 10,
        duration: 10,
        sourceId: sim.player.id,
        school: 'fire',
      });
    }
    sim.player.cooldowns.set('combustion', 120);
    fireMageOnSpellHit(sim.ctx, sim.player, opts.abilityId ?? 'fireball', true);
    return 120 - expectDefined(sim.player.cooldowns.get('combustion'));
  }

  it('2 sec per builder crit for wearers at the one shave site (control 1)', () => {
    expect(shaveAfterCrit(true)).toBe(PYROCLAST_4PC_COMBUSTION_CDR_PER_CRIT);
    expect(shaveAfterCrit(false)).toBe(COMBUSTION_CDR_PER_CRIT);
  });

  it('pays nothing inside Phoenix Trance and nothing for non-builders', () => {
    expect(shaveAfterCrit(true, { inTrance: true })).toBe(0);
    // Meteor is a fire spell but never a Hot Streak builder: its impact does
    // not reach the noteSpellHit seam, the set doc's disclosed scope.
    expect(shaveAfterCrit(true, { abilityId: 'meteor' })).toBe(0);
  });
});

describe('Frostquench 2pc: Rimelance criticals bank a second Icicle', () => {
  it('a critting Rimelance banks 2 through the real cast path (control 1)', () => {
    function icicleCount(wearer: boolean): number {
      const sim = liveMage(455, 'frost');
      if (wearer) equipSet(sim, 'frostquench', 2);
      const mob = addHostileMob(sim);
      sim.rng.chance = () => true; // every roll passes: the impact CRITS
      sim.player.resource = sim.player.maxResource;
      sim.targetEntity(mob.id);
      sim.castAbility('frostbolt');
      for (let tick = 0; tick < 120; tick++) sim.tick(); // cast + travel
      return frostIcicleCharges(sim.player.auras);
    }
    expect(icicleCount(true)).toBe(1 + FROSTQUENCH_2PC_CRIT_BONUS_ICICLES);
    expect(icicleCount(false)).toBe(1);
  });

  it('the 5-Icicle cap stands: at 4 banked, a crit impact tops out at 5', () => {
    const sim = liveMage(456, 'frost');
    equipSet(sim, 'frostquench', 2);
    for (let i = 0; i < ICICLE_MAX - 1; i++) gainIcicle(sim.ctx, sim.player);
    // One crit impact: the bonus icicle (noteSpellHit seam) plus the base
    // bank (frostMageAfterCast) land 4 -> 5, never 6.
    frostMageOnSpellHit(sim.ctx, sim.player, 'frostbolt', true);
    gainIcicle(sim.ctx, sim.player);
    expect(frostIcicleCharges(sim.player.auras)).toBe(ICICLE_MAX);
  });

  it('non-crits, non-wearers, and non-frost wearers bank nothing extra', () => {
    const wearerSim = liveMage(457, 'frost');
    equipSet(wearerSim, 'frostquench', 2);
    frostMageOnSpellHit(wearerSim.ctx, wearerSim.player, 'frostbolt', false);
    expect(frostIcicleCharges(wearerSim.player.auras)).toBe(0);

    const controlSim = liveMage(458, 'frost');
    frostMageOnSpellHit(controlSim.ctx, controlSim.player, 'frostbolt', true);
    expect(frostIcicleCharges(controlSim.player.auras)).toBe(0);

    // A fire mage wearing the frost set: the bank is committed-frost only.
    const fireSim = liveMage(459, 'fire');
    equipSet(fireSim, 'frostquench', 2);
    frostMageOnSpellHit(fireSim.ctx, fireSim.player, 'frostbolt', true);
    expect(frostIcicleCharges(fireSim.player.auras)).toBe(0);
  });
});

describe("Frostquench 4pc: Winterlash plants 3 Winter's Chill charges, up from 2", () => {
  function chillCharges(wearer: boolean): number | undefined {
    const sim = liveMage(460, 'frost');
    if (wearer) equipSet(sim, 'frostquench', 4);
    const mob = addHostileMob(sim);
    const meta = expectDefined(sim.ctx.players.get(sim.player.id));
    // The live rider path: frostMageAfterCast plants the debuff for Winterlash.
    frostMageAfterCast(sim.ctx, sim.player, meta, expectDefined(ABILITIES.flurry), mob);
    return mob.auras.find((a) => a.id === 'winters_chill')?.charges;
  }

  it('plants 3 for wearers at the live rider site (control 2)', () => {
    expect(chillCharges(true)).toBe(FROSTQUENCH_4PC_WINTERS_CHILL_CHARGES);
    expect(chillCharges(false)).toBe(WINTERS_CHILL_CHARGES);
  });

  it('the refresh branch restores a part-spent debuff to 3 for wearers', () => {
    const sim = liveMage(461, 'frost');
    equipSet(sim, 'frostquench', 4);
    const mob = addHostileMob(sim);
    applyWintersChill(sim.ctx, sim.player, mob);
    const chill = expectDefined(mob.auras.find((a) => a.id === 'winters_chill'));
    chill.charges = 1; // partially spent
    applyWintersChill(sim.ctx, sim.player, mob);
    expect(chill.charges).toBe(FROSTQUENCH_4PC_WINTERS_CHILL_CHARGES);
    expect(mob.auras.filter((a) => a.id === 'winters_chill')).toHaveLength(1);
  });
});

describe('the wearer literals against the authored copy', () => {
  it('pins every audited mage constant', () => {
    expect(CHRONOWEAVE_2PC_ECHO_CONVERT_SINGLE).toBeCloseTo(0.5, 10);
    expect(CHRONOWEAVE_4PC_CASCADE_COOLDOWN_CUT_SEC).toBe(5);
    expect(PYROCLAST_2PC_SCALD_EXECUTE_HP).toBeCloseTo(0.35, 10);
    expect(PYROCLAST_4PC_COMBUSTION_CDR_PER_CRIT).toBe(1.5);
    expect(FROSTQUENCH_2PC_CRIT_BONUS_ICICLES).toBe(1);
    expect(FROSTQUENCH_4PC_WINTERS_CHILL_CHARGES).toBe(3);
    // The base literals the copy's "up from" claims lean on.
    expect(ECHO_CONVERT_SINGLE).toBeCloseTo(0.4, 10);
    expect(SCORCH_EXECUTE_HP).toBeCloseTo(0.3, 10);
    expect(COMBUSTION_CDR_PER_CRIT).toBe(1);
    expect(WINTERS_CHILL_CHARGES).toBe(2);
  });
});
