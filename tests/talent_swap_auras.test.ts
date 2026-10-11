// A talent swap takes the buffs of the talent it drops with it.
//
// Player report (v0.44): a buff cast from a talent outlived the talent. A mage
// channelled Aetherwell (level-20 capstone row), swapped that row to Rune of
// Power before the pull, and fought with both capstones at once. The same
// trick worked for every class: cast the talent's buff, swap the row, keep
// the buff. The sim now strips, at the talent recompute, every aura this
// player applied whose id only a no-longer-known ability (or a dropped talent
// rider on a still-known one) can produce, on every entity it landed on.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  abilityAuraIds,
  orphanedAbilityAuraIds,
  talentSwapOrphanMatcher,
} from '../src/sim/progression/talent_swap_auras';
import { Sim } from '../src/sim/sim';
import type { AbilityDef, AbilityEffect, Aura, Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

type AnySim = Sim & Record<string, any>;

function tickFor(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 20); i++) sim.tick();
}

function mageAtCap(): { sim: Sim; p: Entity } {
  const sim = new Sim({ seed: 41, playerClass: 'mage', world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(20);
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

describe('talent swap strips the dropped talent buffs (the Aetherwell into Rune of Power report)', () => {
  it('drops the Aetherwell spell power buff when the capstone row swaps to Rune of Power', () => {
    const { sim, p } = mageAtCap();
    expect(sim.selectTalentRow(20, 'mag_r20_evocation')).toBe(true);
    const baseSp = p.spellPower ?? 0;

    sim.castAbility('evocation');
    tickFor(sim, 6.5); // the whole 6 sec channel: six stacks of the buff
    const buff = p.auras.find((a) => a.id === 'evocation');
    expect(buff?.kind).toBe('buff_spellpower');
    expect(p.spellPower ?? 0).toBeGreaterThan(baseSp);
    expect(p.inCombat).toBe(false);

    expect(sim.selectTalentRow(20, 'mag_r20_rune_of_power')).toBe(true);

    expect(sim.known.some((k) => k.def.id === 'rune_of_power')).toBe(true);
    expect(p.auras.some((a) => a.id === 'evocation')).toBe(false);
    // The stat pass re-ran: the swap does not bank the old capstone's power.
    expect(p.spellPower).toBe(baseSp);
  });

  it('emits the fade for the stripped buff', () => {
    const { sim, p } = mageAtCap();
    expect(sim.selectTalentRow(20, 'mag_r20_evocation')).toBe(true);
    sim.castAbility('evocation');
    tickFor(sim, 2);
    expect(p.auras.some((a) => a.id === 'evocation')).toBe(true);
    const buffName = p.auras.find((a) => a.id === 'evocation')?.name;

    sim.drainEvents();
    expect(sim.selectTalentRow(20, 'mag_r20_overflowing_power')).toBe(true);

    expect(sim.drainEvents()).toContainEqual({
      type: 'aura',
      targetId: p.id,
      name: buffName,
      gained: false,
    });
    // The channel of the unlearned Aetherwell is cancelled, not left ticking.
    expect(p.castingAbility).toBeNull();
    tickFor(sim, 6);
    expect(p.auras.some((a) => a.id === 'evocation')).toBe(false);
  });

  it('keeps a buff whose ability is still known after the swap', () => {
    const { sim, p } = mageAtCap();
    expect(sim.selectTalentRow(20, 'mag_r20_evocation')).toBe(true);
    sim.castAbility('evocation');
    tickFor(sim, 2);
    expect(p.auras.some((a) => a.id === 'evocation')).toBe(true);

    // A different row changes; the capstone (and so Aetherwell) stays.
    expect(sim.selectTalentRow(17, 'mag_r17_mass_barrier')).toBe(true);

    expect(p.auras.some((a) => a.id === 'evocation')).toBe(true);
  });

  it('drops a talent rider on a baseline ability but keeps the baseline buff (Ghostfoot Ward)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'rogue', world: EMPTY_TEST_WORLD });
    sim.setPlayerLevel(20);
    const p = sim.player;
    expect(sim.selectTalentRow(8, 'rog_r8_ghostfoot_ward')).toBe(true);

    sim.castAbility('evasion');
    sim.tick();
    expect(p.auras.some((a) => a.id === 'evasion' && a.kind === 'buff_dodge')).toBe(true);
    expect(p.auras.some((a) => a.id === 'evasion_shield_wall')).toBe(true);

    expect(sim.selectTalentRow(8, 'rog_r8_borrowed_breath')).toBe(true);

    // Ghostfoot itself is baseline: its dodge buff stays. The 30% damage cut
    // was the dropped talent's rider: it goes.
    expect(p.auras.some((a) => a.id === 'evasion' && a.kind === 'buff_dodge')).toBe(true);
    expect(p.auras.some((a) => a.id === 'evasion_shield_wall')).toBe(false);
  });

  it('drops the talent buff from every ally it landed on, and only the swapper own copies', () => {
    const sim = new Sim({ seed: 43, playerClass: 'mage', noPlayer: true }) as AnySim;
    const a = sim.addPlayer('mage', 'MageA');
    const b = sim.addPlayer('mage', 'MageB');
    for (const pid of [a, b]) {
      sim.setPlayerLevel(20, pid);
      expect(sim.applyTalents({ spec: 'frost', rows: { 17: 'mag_r17_mass_barrier' } }, pid)).toBe(
        true,
      );
      const ent = sim.entities.get(pid) as Entity;
      ent.resource = ent.maxResource;
    }
    const entA = sim.entities.get(a) as Entity;
    const entB = sim.entities.get(b) as Entity;
    entB.pos = { ...entA.pos };
    entB.prevPos = { ...entA.pos };
    sim.partyInvite(b, a);
    sim.partyAccept(b);

    sim.castAbility('mass_barrier', a);
    for (const ent of [entA, entB]) {
      expect(ent.auras.find((x) => x.id === 'mass_barrier')?.sourceId).toBe(a);
    }

    expect(sim.selectTalentRow(17, 'mag_r17_cold_snap', a)).toBe(true);

    for (const ent of [entA, entB]) {
      expect(ent.auras.some((x) => x.id === 'mass_barrier')).toBe(false);
    }

    // MageB still has the talent: B's shield on A is B's to keep, even when A
    // (who no longer knows Mass Barrier) swaps a row again.
    entB.gcdRemaining = 0;
    sim.castAbility('mass_barrier', b);
    expect(entA.auras.find((x) => x.id === 'mass_barrier')?.sourceId).toBe(b);
    expect(sim.selectTalentRow(17, 'mag_r17_mass_barrier', a)).toBe(true);
    expect(sim.selectTalentRow(17, 'mag_r17_cold_snap', a)).toBe(true);
    expect(entA.auras.find((x) => x.id === 'mass_barrier')?.sourceId).toBe(b);
  });

  it('is deterministic: the same seed and presses leave the same auras', () => {
    const run = () => {
      const { sim, p } = mageAtCap();
      sim.selectTalentRow(20, 'mag_r20_evocation');
      sim.castAbility('evocation');
      tickFor(sim, 3);
      sim.selectTalentRow(20, 'mag_r20_rune_of_power');
      tickFor(sim, 1);
      return p.auras.map((a) => [a.id, a.kind, a.remaining]);
    };
    expect(run()).toEqual(run());
  });
});

describe('talent swap closes the other routes to both talents', () => {
  it('retires a Rune of Power inscribed BEFORE the swap to Aetherwell (the reverse order)', () => {
    const { sim, p } = mageAtCap();
    expect(sim.selectTalentRow(20, 'mag_r20_rune_of_power')).toBe(true);
    sim.castAbility('rune_of_power');
    tickFor(sim, 4); // 1.5 sec inscription, then the zone pulses its ally buff
    const ctx = (sim as AnySim).ctx;
    expect(
      ctx.groundAoEs.some(
        (z: { abilityId: string; sourceId: number }) =>
          z.abilityId === 'rune_of_power' && z.sourceId === p.id,
      ),
    ).toBe(true);
    expect(p.auras.some((a) => a.id === 'rune_of_power')).toBe(true);

    expect(sim.selectTalentRow(20, 'mag_r20_evocation')).toBe(true);

    expect(ctx.groundAoEs.some((z: { abilityId: string }) => z.abilityId === 'rune_of_power')).toBe(
      false,
    );
    expect(p.auras.some((a) => a.id === 'rune_of_power')).toBe(false);
    p.resource = p.maxResource;
    p.gcdRemaining = 0;
    sim.castAbility('evocation');
    tickFor(sim, 6.5);
    // Aetherwell's buff, and no rune pulse ever lands again.
    expect(p.auras.some((a) => a.id === 'evocation')).toBe(true);
    expect(p.auras.some((a) => a.id === 'rune_of_power')).toBe(false);
  });

  it('strips a baseline buff a dropped talent had boosted (Enduring Protection on Ward of Faith)', () => {
    const sim = new Sim({ seed: 44, playerClass: 'paladin', world: EMPTY_TEST_WORLD });
    sim.setPlayerLevel(20);
    const p = sim.player;
    expect(sim.selectTalentRow(8, 'pal_r8_enduring_protection')).toBe(true);
    p.resource = p.maxResource;
    sim.castAbility('divine_protection');
    sim.tick();
    const ward = p.auras.find((a) => a.id === 'divine_protection');
    expect(ward?.duration).toBe(15); // 10 sec base, +5 from the talent

    // A row that does not touch Ward of Faith leaves the boosted copy alone.
    expect(sim.selectTalentRow(5, 'pal_r5_radiant_stride')).toBe(true);
    expect(p.auras.some((a) => a.id === 'divine_protection')).toBe(true);

    expect(sim.selectTalentRow(8, 'pal_r8_steady_hands')).toBe(true);
    expect(p.auras.some((a) => a.id === 'divine_protection')).toBe(false);
  });

  it("strips a companion id minted outside aura_ids (Thieves' Chorus spell haste)", () => {
    const sim = new Sim({ seed: 45, playerClass: 'rogue', noPlayer: true }) as AnySim;
    const a = sim.addPlayer('rogue', 'RogueA');
    const b = sim.addPlayer('rogue', 'RogueB');
    for (const pid of [a, b]) sim.setPlayerLevel(20, pid);
    const entA = sim.entities.get(a) as Entity;
    const entB = sim.entities.get(b) as Entity;
    entB.pos = { ...entA.pos };
    entB.prevPos = { ...entA.pos };
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    expect(sim.selectTalentRow(17, 'rog_r17_thieves_chorus', a)).toBe(true);
    entA.resource = entA.maxResource;
    sim.castAbility('thieves_chorus', a);
    const chorus = (e: Entity) => e.auras.filter((x) => x.id.startsWith('thieves_chorus'));
    expect(chorus(entA).map((x) => x.id)).toContain('thieves_chorus_spell');
    expect(chorus(entB).length).toBeGreaterThan(0);

    expect(sim.selectTalentRow(17, 'rog_r17_flurry_of_knives', a)).toBe(true);

    expect(chorus(entA)).toEqual([]);
    expect(chorus(entB)).toEqual([]);
  });

  it('strips from a non-player entity, un-folds its stat, and keeps another caster copy', () => {
    const sim = new Sim({ seed: 46, playerClass: 'mage', noPlayer: true }) as AnySim;
    const a = sim.addPlayer('mage', 'MageA');
    const b = sim.addPlayer('mage', 'MageB');
    for (const pid of [a, b]) {
      sim.setPlayerLevel(20, pid);
      expect(sim.applyTalents({ spec: 'frost', rows: { 20: 'mag_r20_evocation' } }, pid)).toBe(
        true,
      );
    }
    const entA = sim.entities.get(a) as Entity;
    const mob = createMob(9940, MOBS.forest_wolf, 20, { ...entA.pos, z: entA.pos.z + 6 });
    sim.addEntity(mob);
    const hpBase = mob.maxHp;
    const stamina = (sourceId: number): Aura => ({
      id: 'evocation',
      name: 'Aetherwell',
      kind: 'buff_sta',
      remaining: 60,
      duration: 60,
      value: 10,
      sourceId,
      school: 'arcane',
    });
    sim.ctx.applyAura(mob, stamina(a));
    const hpWithOne = mob.maxHp;
    sim.ctx.applyAura(mob, stamina(b));
    expect(mob.auras.filter((x) => x.id === 'evocation')).toHaveLength(2);
    expect(hpWithOne).toBeGreaterThan(hpBase);
    sim.drainEvents();

    expect(sim.selectTalentRow(20, 'mag_r20_rune_of_power', a)).toBe(true);

    expect(mob.auras.filter((x) => x.id === 'evocation').map((x) => x.sourceId)).toEqual([b]);
    expect(mob.maxHp).toBe(hpBase + (hpWithOne - hpBase));
    expect(sim.drainEvents()).toContainEqual({
      type: 'aura',
      targetId: mob.id,
      name: 'Aetherwell',
      gained: false,
    });
  });

  it('drops a stance the new spec cannot wear at the swap, then the reconcile seats the right one', () => {
    const sim = new Sim({ seed: 47, playerClass: 'warrior', world: EMPTY_TEST_WORLD });
    sim.setPlayerLevel(20);
    const p = sim.player;
    expect(sim.setSpec('arms')).toBe(true);
    sim.tick();
    expect(p.auras.some((a) => a.kind === 'battle_stance')).toBe(true);

    expect(sim.setSpec('fury')).toBe(true);
    expect(p.auras.some((a) => a.kind === 'battle_stance')).toBe(false);

    sim.tick();
    expect(p.auras.some((a) => a.kind === 'berserker_stance')).toBe(true);
  });
});

describe('talent_swap_auras pure core', () => {
  const def = (id: string, effects: AbilityEffect[]): AbilityDef =>
    ({ id, effects }) as unknown as AbilityDef;

  it('names the bare id, companion self-buffs, explicit ids, and indexed buffTargets', () => {
    const d = def('arcane_power', [
      { type: 'selfBuff', kind: 'buff_spellpower', value: 1, duration: 10 },
      { type: 'selfBuff', kind: 'buff_spellhaste', value: 1, duration: 10 },
    ] as AbilityEffect[]);
    const ids = abilityAuraIds({
      def: d,
      effects: [
        ...d.effects,
        { type: 'selfBuff', kind: 'shield_wall', value: 0.3, duration: 5, auraId: 'custom_id' },
        { type: 'buffTarget', kind: 'buff_armor', value: 1, duration: 5 },
        { type: 'buffTarget', kind: 'buff_stamina', value: 1, duration: 5 },
      ] as AbilityEffect[],
    });
    expect([...ids].sort()).toEqual(
      [
        'arcane_power',
        'arcane_power_buff_spellhaste',
        'custom_id',
        'arcane_power_buff_stamina_1',
      ].sort(),
    );
  });

  it('orphans only ids the next known set can no longer produce', () => {
    const evocation = def('evocation', [
      { type: 'selfBuff', kind: 'buff_spellpower', value: 8, duration: 15 },
    ] as AbilityEffect[]);
    const evasion = def('evasion', [
      { type: 'selfBuff', kind: 'buff_dodge', value: 0.5, duration: 15 },
    ] as AbilityEffect[]);
    const rider = { type: 'selfBuff', kind: 'shield_wall', value: 0.3, duration: 15 };
    const previous = [
      { def: evocation, effects: evocation.effects },
      { def: evasion, effects: [...evasion.effects, rider] as AbilityEffect[] },
    ];
    const next = [{ def: evasion, effects: evasion.effects }];
    expect([...orphanedAbilityAuraIds(previous, next)].sort()).toEqual(
      ['evasion_shield_wall', 'evocation'].sort(),
    );
    expect(orphanedAbilityAuraIds(next, next).size).toBe(0);
  });

  it('names an absorb beside a stasis self-buff and an explicit auraId on any effect', () => {
    const block = def('ice_block', [
      { type: 'selfBuff', kind: 'stasis', value: 1, duration: 10 },
      { type: 'absorb', amount: 10, duration: 10 },
    ] as AbilityEffect[]);
    expect([...abilityAuraIds({ def: block, effects: block.effects })].sort()).toEqual(
      ['ice_block', 'ice_block_absorb'].sort(),
    );
    const marked = def('marker', [
      { type: 'applyDebuff', kind: 'slow', value: 0.5, duration: 4, auraId: 'marker_slow' },
    ] as unknown as AbilityEffect[]);
    expect(abilityAuraIds({ def: marked, effects: marked.effects }).has('marker_slow')).toBe(true);
  });

  it('flags a reshaped timed buff but spares toggles and permanent auras', () => {
    const ward = def('ward', [
      { type: 'absorb', amount: 0, casterMaxHpPct: 0.25, duration: 10 },
    ] as AbilityEffect[]);
    const form = def('cat_form', [
      { type: 'selfBuff', kind: 'form_cat', value: 1, duration: 3600 },
    ] as AbilityEffect[]);
    const boosted = { type: 'absorb', amount: 0, casterMaxHpPct: 0.25, duration: 15 };
    const boostedForm = { type: 'selfBuff', kind: 'form_cat', value: 2, duration: 3600 };
    const previous = [
      { def: ward, effects: [boosted] as AbilityEffect[] },
      { def: form, effects: [boostedForm] as AbilityEffect[] },
    ];
    const next = [
      { def: ward, effects: ward.effects },
      { def: form, effects: form.effects },
    ];
    const matcher = talentSwapOrphanMatcher(previous, next);
    expect(matcher).not.toBeNull();
    expect(matcher?.({ id: 'ward', kind: 'absorb' })).toBe(true);
    expect(matcher?.({ id: 'cat_form', kind: 'form_cat' })).toBe(false);
    expect(matcher?.({ id: 'ward', kind: 'absorb', permanent: true })).toBe(false);
    expect(talentSwapOrphanMatcher(next, next)).toBeNull();
  });

  it('attributes a free-form companion id to the longest known ability id it extends', () => {
    const rune = def('rune', [] as AbilityEffect[]);
    const runeOfPower = def('rune_of_power', [] as AbilityEffect[]);
    const matcher = talentSwapOrphanMatcher(
      [
        { def: rune, effects: [] },
        { def: runeOfPower, effects: [] },
      ],
      [{ def: runeOfPower, effects: [] }],
    );
    expect(matcher?.({ id: 'rune_spell', kind: 'buff_haste' })).toBe(true);
    expect(matcher?.({ id: 'rune_of_power_spell', kind: 'buff_haste' })).toBe(false);
    expect(matcher?.({ id: 'unrelated_buff', kind: 'buff_haste' })).toBe(false);
  });
});
