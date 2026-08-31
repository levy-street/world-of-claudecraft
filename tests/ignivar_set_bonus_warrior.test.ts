// Warrior Crucible set bonuses (Phase B exemplar,
// docs/prd/ignivar-set-bonus-final.md): each bonus proven at the seam it
// rides. The 2-piece bends are RESOLVED-ability rewrites (applyTalentMods'
// rewrite lists), so the same numbers the engine consumes are asserted off
// abilitiesKnownAt; the 4-piece refunds are mods.procs driven through the
// real proc engine; Emberfury 4pc's bespoke dispatch bends are proven
// through live casts on a real Sim with a control pair.
import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { setBonusFlag } from '../src/sim/content/ignivar_set_bonuses';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { computeCharacterModifiers } from '../src/sim/set_bonus_mods';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';
import { expectDefined } from './helpers/defined';
import { EMPTY_TEST_WORLD } from './sim_shared';

const SET_SLOTS = ['helmet', 'shoulder', 'chest', 'gloves', 'legs'] as const;

function worn(setId: string, pieces: number): Partial<Record<string, string>> {
  const equipment: Partial<Record<string, string>> = {};
  for (const slot of SET_SLOTS.slice(0, pieces)) equipment[slot] = `${setId}_${slot}`;
  return equipment;
}

function knownWith(spec: string, equipment: Partial<Record<string, string>>) {
  const mods = computeCharacterModifiers('warrior', { spec, rows: {} }, 25, equipment);
  return { mods, known: abilitiesKnownAt('warrior', 25, mods) };
}

function effectOf(known: ReturnType<typeof knownWith>['known'], abilityId: string, type: string) {
  const entry = expectDefined(
    known.find((k) => k.def.id === abilityId),
    abilityId,
  );
  return expectDefined(
    entry.effects.find((e) => e.type === type),
    `${abilityId} ${type}`,
  );
}

describe('warrior Crucible sets: the resolved 2-piece rewrites', () => {
  it('Slagbreaker 2pc: Redhand empowers Maiming Strike 30 percent per stack, up from 20', () => {
    const base = knownWith('arms', {});
    const setw = knownWith('arms', worn('slagbreaker', 2));
    const baseBuff = effectOf(base.known, 'overpower', 'selfBuff') as { value: number };
    const wornBuff = effectOf(setw.known, 'overpower', 'selfBuff') as { value: number };
    expect(baseBuff.value).toBeCloseTo(0.2, 10);
    expect(wornBuff.value).toBeCloseTo(0.3, 10);
  });

  it('Emberfury 2pc: both Enrage sources last 6 sec, up from 4', () => {
    const base = knownWith('fury', {});
    const setw = knownWith('fury', worn('emberfury', 2));
    for (const abilityId of ['bloodthirst', 'red_harvest']) {
      const baseEff = effectOf(base.known, abilityId, 'enrageChance') as { duration: number };
      const wornEff = effectOf(setw.known, abilityId, 'enrageChance') as { duration: number };
      expect(baseEff.duration, abilityId).toBe(4);
      expect(wornEff.duration, abilityId).toBe(6);
    }
  });

  it('Forgewall 2pc: Iron Resolve converts rage at 5 absorb per point, up from 4', () => {
    const base = knownWith('prot', {});
    const setw = knownWith('prot', worn('forgewall', 2));
    const baseEff = effectOf(base.known, 'iron_resolve', 'absorbSpentResource') as {
      mult: number;
    };
    const wornEff = effectOf(setw.known, 'iron_resolve', 'absorbSpentResource') as {
      mult: number;
    };
    expect(baseEff.mult).toBe(4);
    expect(wornEff.mult).toBe(5);
  });

  it('one piece below the threshold changes nothing', () => {
    const oneShort = knownWith('fury', worn('emberfury', 1));
    const eff = effectOf(oneShort.known, 'bloodthirst', 'enrageChance') as { duration: number };
    expect(eff.duration).toBe(4);
    expect(oneShort.mods.selected[setBonusFlag('emberfury', 2)]).toBeUndefined();
  });
});

describe('warrior Crucible sets: the 4-piece cooldown-refund procs', () => {
  function procHarness(equipment: Partial<Record<string, string>>, spec: string) {
    const mods = computeCharacterModifiers('warrior', { spec, rows: {} }, 25, equipment);
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
      players: new Map([[1, { cls: 'warrior' }]]),
      playerMods: () => mods,
      applyAura: () => {},
      applyHeal: () => {},
      emit: () => {},
      entities: new Map([[1, p]]),
    } as unknown as SimContext;
    return { mods, p, ctx };
  }

  it('Slagbreaker 4pc: every SECOND Redhand cast refunds 3 sec of Breachmaker', () => {
    const { mods, p, ctx } = procHarness(worn('slagbreaker', 4), 'arms');
    expect(mods.procs.some((proc) => proc.id === 'set_slagbreaker_4pc')).toBe(true);
    p.cooldowns.set('breachmaker', 10);
    onCastCompleted(ctx, p, 'overpower');
    expect(p.cooldowns.get('breachmaker')).toBe(10); // first cast banks, no refund
    onCastCompleted(ctx, p, 'overpower');
    expect(p.cooldowns.get('breachmaker')).toBe(7); // second cast pays the 3 sec
  });

  it('Forgewall 4pc: every Shieldcrack cast refunds 2 sec of Iron Resolve', () => {
    const { mods, p, ctx } = procHarness(worn('forgewall', 4), 'prot');
    expect(mods.procs.some((proc) => proc.id === 'set_forgewall_4pc')).toBe(true);
    p.cooldowns.set('iron_resolve', 9);
    onCastCompleted(ctx, p, 'shield_slam');
    expect(p.cooldowns.get('iron_resolve')).toBe(7);
  });

  it('two pieces carry no 4-piece proc', () => {
    const { mods } = procHarness(worn('slagbreaker', 2), 'arms');
    expect(mods.procs.some((proc) => proc.id === 'set_slagbreaker_4pc')).toBe(false);
  });
});

describe('warrior Crucible sets: Emberfury 4pc live casts', () => {
  function furySim(equip4: boolean, seed = 77): { sim: Sim; target: Entity } {
    const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true, world: EMPTY_TEST_WORLD });
    sim.setPlayerLevel(25);
    expect(sim.setSpec('fury')).toBe(true);
    if (equip4) {
      for (const slot of SET_SLOTS.slice(0, 4)) {
        sim.addItem(`emberfury_${slot}`, 1);
        sim.equipItem(`emberfury_${slot}`);
      }
    }
    const target = createMob(
      (sim as unknown as { nextId: number }).nextId++,
      MOBS.ridge_stalker,
      20,
      { x: sim.player.pos.x, y: sim.player.pos.y, z: sim.player.pos.z + 2 },
    );
    target.maxHp = 100_000;
    target.hp = target.maxHp;
    target.weapon.min = 0;
    target.weapon.max = 0;
    target.weapon.speed = 1000;
    target.swingTimer = 1000;
    target.moveSpeed = 0;
    target.hostile = true;
    sim.addEntity(target);
    return { sim, target };
  }

  function castBloodletting(sim: Sim, target: Entity): SimEvent[] {
    sim.targetEntity(target.id);
    sim.player.resource = sim.player.maxResource;
    sim.player.hitBonus = 1;
    sim.castAbility('bloodthirst');
    const events: SimEvent[] = [];
    for (let i = 0; i < 40; i++) events.push(...sim.tick());
    return events;
  }

  it('always Enrages the wearer (seed-pinned control: the base 30 percent roll fails)', () => {
    // CONTROL_SEED is probed so the non-wearer's single 30 percent roll
    // FAILS: that is what proves the wearer arm below skipped the roll
    // rather than passing it. Re-probe if the draw order upstream shifts
    // (content-adds move the shared stream; see the memory note on hunted
    // seeds).
    const CONTROL_SEED = 1;
    const control = furySim(false, CONTROL_SEED);
    castBloodletting(control.sim, control.target);
    const controlEnrage = control.sim.player.auras.find((a) => a.id === 'fury_enrage');
    expect(controlEnrage, 'the control seed must fail the 30 percent roll').toBeUndefined();

    const wearer = furySim(true, CONTROL_SEED);
    castBloodletting(wearer.sim, wearer.target);
    const enrage = expectDefined(wearer.sim.player.auras.find((a) => a.id === 'fury_enrage'));
    // Worn 4 carries the 2pc too: the guaranteed Enrage lasts the extended 6.
    expect(enrage.duration).toBe(6);
  });

  it('heals 8 percent of maximum health, up from 3', () => {
    const wearer = furySim(true);
    wearer.sim.player.hp = Math.floor(wearer.sim.player.maxHp / 2);
    const before = wearer.sim.player.hp;
    castBloodletting(wearer.sim, wearer.target);
    const healed = wearer.sim.player.hp - before;
    expect(healed).toBe(Math.round(wearer.sim.player.maxHp * 0.08));

    const control = furySim(false);
    control.sim.player.hp = Math.floor(control.sim.player.maxHp / 2);
    const beforeControl = control.sim.player.hp;
    castBloodletting(control.sim, control.target);
    expect(control.sim.player.hp - beforeControl).toBe(Math.round(control.sim.player.maxHp * 0.03));
  });
});
