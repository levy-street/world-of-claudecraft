// Priest Crucible set bonuses (docs/prd/ignivar-set-bonus-final.md): each
// bonus proven at the seam it rides. Emberscreed 2pc and Vesperash 4pc's mana
// half are flag-gated module bends (unit fake-ctx pairs plus live Sim control
// pairs); Emberscreed 4pc rides the generic shieldConsumed proc with the new
// trigger-level internal cooldown; Benison 2pc and Vesperash 2pc are RESOLVED
// ability rewrites; Benison 4pc is the bespoke mend at the vigil-trigger
// point in damage.ts. No priest bend touches the rng draw count or order for
// anyone: no bonus here rolls a chance, and every bend gates on the wearer
// flag before doing anything.
import { describe, expect, it } from 'vitest';
import { benisonMendOnVigilTriggered } from '../src/sim/combat/priest/benison';
import { DOCTRINE_AURA_ID, placeDoctrineLink } from '../src/sim/combat/priest/doctrine';
import { TITHEFIEND_MANA_RETURN_RATE, vespersEchoDamage } from '../src/sim/combat/priest/vespers';
import { onCastCompleted, onShieldConsumed, tickProcState } from '../src/sim/combat/talent_procs';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  BENISON_2PC_VIGIL_RESCUE_HEAL,
  BENISON_4PC_MEND_DURATION_SEC,
  BENISON_4PC_MEND_PCT_MAX,
  BENISON_4PC_MEND_TICK_INTERVAL_SEC,
  EMBERSCREED_2PC_DOCTRINE_CONVERSION_BONUS,
  EMBERSCREED_4PC_HYMN_ICD_SEC,
  EMBERSCREED_4PC_HYMN_WINDOW_SEC,
  setBonusFlag,
  VESPERASH_2PC_TITHEFIEND_COOLDOWN_CUT_SEC,
  VESPERASH_4PC_MANA_RETURN_MULT,
} from '../src/sim/content/ignivar_set_bonuses';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { computeCharacterModifiers } from '../src/sim/set_bonus_mods';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura, Entity } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const SET_SLOTS = ['helmet', 'shoulder', 'chest', 'gloves', 'legs'] as const;

function worn(setId: string, pieces: number): Partial<Record<string, string>> {
  const equipment: Partial<Record<string, string>> = {};
  for (const slot of SET_SLOTS.slice(0, pieces)) equipment[slot] = `${setId}_${slot}`;
  return equipment;
}

function priestMods(spec: string, equipment: Partial<Record<string, string>>) {
  return computeCharacterModifiers('priest', { spec, rows: {} }, 25, equipment);
}

function equipSet(sim: Sim, setId: string, pieces: number, pid?: number): void {
  for (const slot of SET_SLOTS.slice(0, pieces)) {
    sim.addItem(`${setId}_${slot}`, 1, pid);
    sim.equipItem(`${setId}_${slot}`, pid);
  }
}

function addHostileMob(sim: Sim, distance = 8): Entity {
  const host = sim as Sim & { nextId: number; addEntity(entity: Entity): void };
  const mob = createMob(host.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  mob.maxHp = 50_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.swingTimer = 999;
  host.addEntity(mob);
  return mob;
}

function addAlly(sim: Sim, name: string): Entity {
  const id = sim.addPlayer('warrior', name);
  sim.setPlayerLevel(20, id);
  const ally = expectDefined(sim.entities.get(id));
  ally.pos.x = sim.player.pos.x + 4;
  ally.pos.z = sim.player.pos.z;
  sim.partyInvite(id, sim.player.id);
  sim.partyAccept(id);
  return ally;
}

describe('priest Crucible sets: the resolver registration', () => {
  it('registers both tiers per worn set and nothing one piece short', () => {
    for (const [setId, spec] of [
      ['emberscreed', 'discipline'],
      ['benison_dawnweave', 'holy'],
      ['vesperash', 'shadow'],
    ] as const) {
      const four = priestMods(spec, worn(setId, 4));
      expect(four.selected[setBonusFlag(setId, 2)], setId).toBe(true);
      expect(four.selected[setBonusFlag(setId, 4)], setId).toBe(true);
      const oneShort = priestMods(spec, worn(setId, 1));
      expect(oneShort.selected[setBonusFlag(setId, 2)], setId).toBeUndefined();
    }
  });

  it('all three 2pcs carry the pushback rider on the talent seam', () => {
    expect(priestMods('discipline', worn('emberscreed', 2)).global.castPushbackReduction).toBe(1);
    expect(priestMods('holy', worn('benison_dawnweave', 2)).global.castPushbackReduction).toBe(1);
    expect(priestMods('shadow', worn('vesperash', 2)).global.castPushbackReduction).toBe(1);
    expect(priestMods('discipline', {}).global.castPushbackReduction).toBe(0);
  });
});

describe('Emberscreed 2pc: the Doctrine link conversion, both twin branches', () => {
  function linkHarness(
    equipment: Partial<Record<string, string>>,
    rows: Record<number, string> = {},
  ) {
    const mods = computeCharacterModifiers('priest', { spec: 'discipline', rows }, 25, equipment);
    const applied: Aura[] = [];
    const priest = { id: 1, kind: 'player', auras: [] } as unknown as Entity;
    const ally = { id: 2, kind: 'player', auras: [] } as unknown as Entity;
    const ctx = {
      entities: new Map<number, Entity>([
        [1, priest],
        [2, ally],
      ]),
      players: new Map([[1, { cls: 'priest', talents: { spec: 'discipline', rows } }]]),
      playerMods: () => mods,
      applyAura: (_target: Entity, aura: Aura) => {
        applied.push(aura);
      },
      emit: () => {},
    } as unknown as SimContext;
    return { ctx, priest, ally, applied };
  }

  it('bakes 0.4 into the placed link for wearers (0.3 base branch)', () => {
    const wearer = linkHarness(worn('emberscreed', 2));
    placeDoctrineLink(wearer.ctx, wearer.priest, wearer.ally);
    expect(expectDefined(wearer.applied[0]).value).toBeCloseTo(
      0.3 + EMBERSCREED_2PC_DOCTRINE_CONVERSION_BONUS,
      10,
    );

    const control = linkHarness({});
    placeDoctrineLink(control.ctx, control.priest, control.ally);
    expect(expectDefined(control.applied[0]).value).toBeCloseTo(0.3, 10);
  });

  it('the bonus is ADDITIVE on the Twin Covenant branch too (0.7 -> 0.8)', () => {
    const rows = { 20: 'pri_r20_twin_covenant' };
    const wearer = linkHarness(worn('emberscreed', 2), rows);
    placeDoctrineLink(wearer.ctx, wearer.priest, wearer.ally);
    expect(expectDefined(wearer.applied[0]).value).toBeCloseTo(
      0.7 + EMBERSCREED_2PC_DOCTRINE_CONVERSION_BONUS,
      10,
    );

    const control = linkHarness({}, rows);
    placeDoctrineLink(control.ctx, control.priest, control.ally);
    expect(expectDefined(control.applied[0]).value).toBeCloseTo(0.7, 10);
  });

  it('snapshot-at-placement: a link placed before the gear change keeps its rate', () => {
    const sim = new Sim({ seed: 733, playerClass: 'priest', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('discipline')).toBe(true);
    const ally = addAlly(sim, 'Warded');
    sim.player.resource = sim.player.maxResource;
    sim.targetEntity(ally.id);
    sim.castAbility('power_word_shield');
    const placed = expectDefined(
      ally.auras.find((aura) => aura.id === DOCTRINE_AURA_ID && aura.sourceId === sim.player.id),
    );
    expect(placed.value).toBeCloseTo(0.3, 10);

    // Equipping the tier does NOT rewrite the standing link (old links keep
    // their placed rate for up to the 30 sec duration, the set doc's
    // disclosed snapshot); the next placement bakes the raised rate.
    equipSet(sim, 'emberscreed', 2);
    expect(placed.value).toBeCloseTo(0.3, 10);
    sim.player.cooldowns.delete('power_word_shield');
    sim.player.resource = sim.player.maxResource;
    sim.player.gcdRemaining = 0;
    sim.castAbility('power_word_shield');
    const replaced = expectDefined(
      ally.auras.find((aura) => aura.id === DOCTRINE_AURA_ID && aura.sourceId === sim.player.id),
    );
    expect(replaced.value).toBeCloseTo(0.3 + EMBERSCREED_2PC_DOCTRINE_CONVERSION_BONUS, 10);
  });

  it('the 0.15 no-link fallback stays untouched for wearers', () => {
    // The fallback conversion never reads the link aura, so the wearer bend
    // must not reach it (the set doc discloses it as deliberately untouched).
    const sim = new Sim({ seed: 733, playerClass: 'priest', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('discipline')).toBe(true);
    equipSet(sim, 'emberscreed', 2);
    const ally = addAlly(sim, 'Lowbie');
    ally.maxHp = 1_000;
    ally.hp = 500;
    const mob = addHostileMob(sim);
    const hpBefore = ally.hp;
    // A landed Scouring Hymn with NO link placed routes through the fallback.
    sim.ctx.dealDamage(
      sim.player,
      mob,
      100,
      false,
      'holy',
      'Scouring Hymn',
      'hit',
      true,
      undefined,
      true,
      undefined,
      false,
      'smite',
    );
    expect(ally.hp - hpBefore).toBe(Math.round(100 * 0.15));
  });
});

describe('Emberscreed 4pc: consumed Psalm arms an instant Scouring Hymn, once per 15 sec', () => {
  function procHarness(equipment: Partial<Record<string, string>>) {
    const mods = priestMods('discipline', equipment);
    const applied: Aura[] = [];
    const p = {
      id: 1,
      kind: 'player',
      hp: 400,
      maxHp: 400,
      auras: [] as Entity['auras'],
      cooldowns: new Map<string, number>(),
      dead: false,
    } as unknown as Entity;
    const ctx = {
      players: new Map([[1, { cls: 'priest' }]]),
      playerMods: () => mods,
      applyAura: (target: Entity, aura: Aura) => {
        target.auras.push(aura);
        applied.push(aura);
      },
      applyHeal: () => 0,
      emit: () => {},
      entities: new Map([[1, p]]),
    } as unknown as SimContext;
    return { mods, p, ctx, applied };
  }

  it('arms the scoped 10 sec empower, and the NEW trigger icd blocks a re-arm for 15 sec', () => {
    const { mods, p, ctx, applied } = procHarness(worn('emberscreed', 4));
    expect(mods.procs.some((proc) => proc.id === 'set_emberscreed_4pc')).toBe(true);
    onShieldConsumed(ctx, p, 'power_word_shield', p);
    const empower = expectDefined(applied[0]);
    expect(empower.id).toBe('set_emberscreed_4pc');
    expect(empower.kind).toBe('next_cast_instant');
    expect(empower.empowerAbilities).toEqual(['smite']);
    expect(empower.duration).toBe(EMBERSCREED_4PC_HYMN_WINDOW_SEC);

    // A second consume inside the internal cooldown is ignored entirely.
    p.auras.length = 0;
    onShieldConsumed(ctx, p, 'power_word_shield', p);
    expect(applied.length).toBe(1);
    // One second short of the icd still blocks; past it, the proc arms again.
    tickProcState(p, EMBERSCREED_4PC_HYMN_ICD_SEC - 1);
    onShieldConsumed(ctx, p, 'power_word_shield', p);
    expect(applied.length).toBe(1);
    tickProcState(p, 2);
    onShieldConsumed(ctx, p, 'power_word_shield', p);
    expect(applied.length).toBe(2);
  });

  it('a different consumed shield does not arm it; two pieces arm nothing', () => {
    const four = procHarness(worn('emberscreed', 4));
    onShieldConsumed(four.ctx, four.p, 'priest_living_covenant', four.p);
    expect(four.applied.length).toBe(0);

    const two = procHarness(worn('emberscreed', 2));
    onShieldConsumed(two.ctx, two.p, 'power_word_shield', two.p);
    expect(two.applied.length).toBe(0);
  });

  it('live: the real consume path arms the empower and the next Hymn is instant', () => {
    function castAfterConsume(wearer: boolean): {
      casting: string | null;
      armed: boolean;
      consumed: boolean;
    } {
      const sim = new Sim({ seed: 947, playerClass: 'priest', autoEquip: true });
      sim.setPlayerLevel(20);
      expect(sim.setSpec('discipline')).toBe(true);
      if (wearer) equipSet(sim, 'emberscreed', 4);
      const mob = addHostileMob(sim);
      sim.player.resource = sim.player.maxResource;
      sim.targetEntity(sim.player.id);
      sim.castAbility('power_word_shield');
      const shield = expectDefined(
        sim.player.auras.find((aura) => aura.id === 'power_word_shield'),
      );
      // Fully consume the Psalm through the REAL damage.ts absorb walk: the
      // blow just exceeds the resolved absorb so the priest survives it.
      sim.ctx.dealDamage(mob, sim.player, shield.value + 50, false, 'shadow', 'Test Blow', 'hit');
      const armed = sim.player.auras.some((aura) => aura.id === 'set_emberscreed_4pc');
      sim.player.resource = sim.player.maxResource;
      sim.player.gcdRemaining = 0;
      sim.rng.next = () => 0.5;
      sim.rng.chance = (chance) => chance > 0.5;
      sim.targetEntity(mob.id);
      sim.castAbility('smite');
      const consumed = !sim.player.auras.some((aura) => aura.id === 'set_emberscreed_4pc');
      return { casting: sim.player.castingAbility, armed, consumed };
    }
    const wearer = castAfterConsume(true);
    expect(wearer.armed).toBe(true);
    expect(wearer.casting).toBeNull(); // instant: resolved on the cast tick
    expect(wearer.consumed).toBe(true); // the empower is spent by that cast
    const control = castAfterConsume(false);
    expect(control.armed).toBe(false);
    expect(control.casting).toBe('smite'); // the 2.5 sec cast bar
  });
});

describe("Benison 2pc: Seraphic Vigil's rescue heals for 270, exact and flat", () => {
  it('the resolved buffTarget value: 270 for wearers, 180 base (no rounding drift)', () => {
    const base = computeCharacterModifiers('priest', { spec: 'holy', rows: {} }, 25, {});
    const setw = computeCharacterModifiers(
      'priest',
      { spec: 'holy', rows: {} },
      25,
      worn('benison_dawnweave', 2),
    );
    const vigilOf = (mods: typeof base) => {
      const entry = expectDefined(
        abilitiesKnownAt('priest', 25, mods).find((known) => known.def.id === 'seraphic_vigil'),
      );
      const eff = expectDefined(entry.effects.find((e) => e.type === 'buffTarget'));
      return (eff as { value: number }).value;
    };
    expect(vigilOf(base)).toBe(180);
    expect(vigilOf(setw)).toBe(BENISON_2PC_VIGIL_RESCUE_HEAL);
    // heal_echo sits in neither the integral nor the scalable buff-kind sets,
    // so the 1.5 buffPct row lands as exactly the flat printed 270.
    expect(BENISON_2PC_VIGIL_RESCUE_HEAL).toBe(180 * 1.5);
  });

  it('live rescue: the consumed Vigil heals 270 for wearers (control 180)', () => {
    function rescueHeal(wearer: boolean): number {
      const sim = new Sim({ seed: 358, playerClass: 'priest', autoEquip: true });
      sim.setPlayerLevel(20);
      expect(sim.setSpec('holy')).toBe(true);
      if (wearer) equipSet(sim, 'benison_dawnweave', 2);
      const ally = addAlly(sim, 'Watched');
      const mob = addHostileMob(sim);
      sim.player.resource = sim.player.maxResource;
      sim.targetEntity(ally.id);
      sim.castAbility('seraphic_vigil');
      expect(ally.auras.some((aura) => aura.id === 'seraphic_vigil')).toBe(true);
      // Crits stubbed off so the rescue lands at its exact flat value.
      sim.rng.next = () => 0.5;
      sim.rng.chance = () => false;
      sim.drainEvents();
      // Drop the ally below the 35 percent threshold through the real pipeline.
      sim.ctx.dealDamage(
        mob,
        ally,
        Math.ceil(ally.maxHp * 0.75),
        false,
        'physical',
        'Test Blow',
        'hit',
      );
      expect(ally.auras.some((aura) => aura.id === 'seraphic_vigil')).toBe(false);
      const rescue = sim
        .drainEvents()
        .filter(
          (event): event is Extract<typeof event, { type: 'heal2' }> => event.type === 'heal2',
        )
        .find((event) => event.ability === 'Seraphic Vigil');
      return rescue?.amount ?? 0;
    }
    expect(rescueHeal(true)).toBe(BENISON_2PC_VIGIL_RESCUE_HEAL);
    expect(rescueHeal(false)).toBe(180);
  });
});

describe('Benison 4pc: the triggered Vigil also mends its ally', () => {
  function mendHarness(equipment: Partial<Record<string, string>>) {
    const mods = priestMods('holy', equipment);
    const applied: Aura[] = [];
    const priest = { id: 1, kind: 'player' } as unknown as Entity;
    const ally = { id: 2, kind: 'player', maxHp: 1_000, auras: [] } as unknown as Entity;
    const ctx = {
      players: new Map([[1, { cls: 'priest' }]]),
      playerMods: () => mods,
      applyAura: (_target: Entity, aura: Aura) => {
        applied.push(aura);
      },
      emit: () => {},
    } as unknown as SimContext;
    return { ctx, priest, ally, applied };
  }

  it('wearers apply the 15 percent-of-ally-max HoT over 10 sec; others nothing', () => {
    const wearer = mendHarness(worn('benison_dawnweave', 4));
    benisonMendOnVigilTriggered(wearer.ctx, wearer.priest, wearer.ally);
    const mend = expectDefined(wearer.applied[0]);
    expect(mend.id).toBe('benison_dawnweave_mend');
    expect(mend.kind).toBe('hot');
    expect(mend.duration).toBe(BENISON_4PC_MEND_DURATION_SEC);
    expect(mend.tickInterval).toBe(BENISON_4PC_MEND_TICK_INTERVAL_SEC);
    const ticks = BENISON_4PC_MEND_DURATION_SEC / BENISON_4PC_MEND_TICK_INTERVAL_SEC;
    expect(mend.value).toBe(Math.round((1_000 * BENISON_4PC_MEND_PCT_MAX) / ticks));

    const control = mendHarness(worn('benison_dawnweave', 2));
    benisonMendOnVigilTriggered(control.ctx, control.priest, control.ally);
    expect(control.applied.length).toBe(0);
  });

  it('live: the mend rides the REAL vigil trigger and pays 15 percent over 10 sec', () => {
    const sim = new Sim({ seed: 358, playerClass: 'priest', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('holy')).toBe(true);
    equipSet(sim, 'benison_dawnweave', 4);
    const ally = addAlly(sim, 'Mended');
    const mob = addHostileMob(sim);
    sim.player.resource = sim.player.maxResource;
    sim.targetEntity(ally.id);
    sim.castAbility('seraphic_vigil');
    const allyMaxHp = ally.maxHp;
    sim.ctx.dealDamage(
      mob,
      ally,
      Math.ceil(allyMaxHp * 0.75),
      false,
      'physical',
      'Test Blow',
      'hit',
    );
    const mend = expectDefined(ally.auras.find((aura) => aura.id === 'benison_dawnweave_mend'));
    expect(mend.name).toBe('Seraphic Vigil');
    const ticks = BENISON_4PC_MEND_DURATION_SEC / BENISON_4PC_MEND_TICK_INTERVAL_SEC;
    expect(mend.value).toBe(Math.round((allyMaxHp * BENISON_4PC_MEND_PCT_MAX) / ticks));
    // Sum the mend's own tick events (regen-proof; tick() drains the event
    // buffer per tick, so accumulate as we advance), then confirm the total
    // is the promised 15 percent of the ally's max health across 5 ticks.
    sim.drainEvents();
    let mended = 0;
    for (let tick = 0; tick < BENISON_4PC_MEND_DURATION_SEC * 20 + 20; tick++) {
      for (const event of sim.tick()) {
        if (event.type === 'heal2' && event.abilityId === 'benison_dawnweave_mend') {
          mended += event.amount;
        }
      }
    }
    expect(mended).toBe(mend.value * ticks);
    expect(ally.auras.some((aura) => aura.id === 'benison_dawnweave_mend')).toBe(false);
  });

  it('Twin Covenant coexistence: each triggered Vigil mends its own ally', () => {
    const sim = new Sim({ seed: 359, playerClass: 'priest', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: 'holy', rows: { 20: 'pri_r20_twin_covenant' } })).toBe(true);
    sim.tick();
    equipSet(sim, 'benison_dawnweave', 4);
    const first = addAlly(sim, 'FirstWard');
    const second = addAlly(sim, 'SecondWard');
    const mob = addHostileMob(sim);
    sim.player.resource = sim.player.maxResource;
    sim.targetEntity(first.id);
    sim.castAbility('seraphic_vigil');
    sim.player.gcdRemaining = 0;
    sim.targetEntity(second.id);
    sim.castAbility('seraphic_vigil'); // the Twin Covenant second charge
    for (const ally of [first, second]) {
      sim.ctx.dealDamage(
        mob,
        ally,
        Math.ceil(ally.maxHp * 0.75),
        false,
        'physical',
        'Test Blow',
        'hit',
      );
    }
    expect(first.auras.some((aura) => aura.id === 'benison_dawnweave_mend')).toBe(true);
    expect(second.auras.some((aura) => aura.id === 'benison_dawnweave_mend')).toBe(true);
  });
});

describe("Vesperash 2pc: Call Tithefiend's cooldown drops 30 to 24", () => {
  it('the resolved cooldown: 24 for wearers, 30 base', () => {
    const cooldownOf = (equipment: Partial<Record<string, string>>) => {
      const mods = computeCharacterModifiers('priest', { spec: 'shadow', rows: {} }, 25, equipment);
      const entry = expectDefined(
        abilitiesKnownAt('priest', 25, mods).find((known) => known.def.id === 'summon_tithefiend'),
      );
      return entry.cooldown;
    };
    expect(cooldownOf({})).toBe(30);
    expect(cooldownOf(worn('vesperash', 2))).toBe(30 - VESPERASH_2PC_TITHEFIEND_COOLDOWN_CUT_SEC);
  });
});

describe('Vesperash 4pc: calling the fiend resets Mindfracture and doubles its mana return', () => {
  it('the castNth reset: a running Mindfracture cooldown clears for wearers only', () => {
    function mindfractureAfterCall(equipment: Partial<Record<string, string>>): boolean {
      const mods = priestMods('shadow', equipment);
      const p = {
        id: 1,
        kind: 'player',
        auras: [] as Entity['auras'],
        cooldowns: new Map<string, number>([['mind_blast', 6]]),
        dead: false,
      } as unknown as Entity;
      const ctx = {
        players: new Map([[1, { cls: 'priest' }]]),
        playerMods: () => mods,
        applyAura: () => {},
        emit: () => {},
        entities: new Map([[1, p]]),
      } as unknown as SimContext;
      onCastCompleted(ctx, p, 'summon_tithefiend');
      return p.cooldowns.has('mind_blast');
    }
    expect(mindfractureAfterCall(worn('vesperash', 4))).toBe(false);
    expect(mindfractureAfterCall(worn('vesperash', 2))).toBe(true);
    expect(mindfractureAfterCall({})).toBe(true);
  });

  it('live: the fiend strike returns 2 percent of max mana for wearers (control 1)', () => {
    // The two runs wear different gear (the set pieces replace the autoEquip
    // kit), so max mana differs between them: assert each run against its OWN
    // max-mana rate rather than comparing absolutes across runs.
    function manaPerHit(wearer: boolean): { gained: number; expected: number } {
      const sim = new Sim({ seed: 1123, playerClass: 'priest', autoEquip: true });
      sim.setPlayerLevel(20);
      expect(sim.setSpec('shadow')).toBe(true);
      if (wearer) equipSet(sim, 'vesperash', 4);
      const mob = addHostileMob(sim);
      // The strike's mana return keys on the priest's own Dirge on the target.
      mob.auras.push({
        id: 'shadow_word_pain',
        name: 'Dirge of Decay',
        kind: 'dot',
        remaining: 18,
        duration: 18,
        value: 5,
        tickInterval: 3,
        tickTimer: 3,
        sourceId: sim.player.id,
        school: 'shadow',
      } as Aura);
      sim.player.resource = 0;
      // The post-landed hook with the fiend's strike id: the echo owner
      // resolution accepts the priest directly (source.kind === 'player').
      vespersEchoDamage(sim.ctx, sim.player, mob, 100, 'tithefiend_strike');
      const rate = TITHEFIEND_MANA_RETURN_RATE * (wearer ? VESPERASH_4PC_MANA_RETURN_MULT : 1);
      return {
        gained: sim.player.resource,
        expected: Math.max(1, Math.round(sim.player.maxResource * rate)),
      };
    }
    const base = manaPerHit(false);
    expect(base.gained).toBeGreaterThan(0);
    expect(base.gained).toBe(base.expected);
    const doubled = manaPerHit(true);
    expect(doubled.gained).toBe(doubled.expected);
  });

  it('pins the wearer literals against the authored copy', () => {
    expect(VESPERASH_4PC_MANA_RETURN_MULT).toBe(2);
    expect(VESPERASH_2PC_TITHEFIEND_COOLDOWN_CUT_SEC).toBe(6);
    expect(EMBERSCREED_2PC_DOCTRINE_CONVERSION_BONUS).toBeCloseTo(0.1, 10);
    expect(EMBERSCREED_4PC_HYMN_WINDOW_SEC).toBe(10);
    expect(EMBERSCREED_4PC_HYMN_ICD_SEC).toBe(15);
    expect(BENISON_4PC_MEND_PCT_MAX).toBeCloseTo(0.15, 10);
    expect(BENISON_4PC_MEND_DURATION_SEC).toBe(10);
  });
});
