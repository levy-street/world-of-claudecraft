import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { WARLOCK_CHOICE_ROWS } from '../src/sim/content/choice_rows_classic';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';

function rig(
  cls: PlayerClass,
  level: number,
  rows: Record<number, string>,
  spec: string | null = null,
  seed = 1,
) {
  const sim = new Sim({ seed, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(level);
  expect(sim.applyTalents({ spec, rows })).toBe(true);
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function addTargetMob(sim: Sim, hp = 100000, dist = 10): Entity {
  const p = sim.player;
  const mob = createMob(9200, MOBS.forest_wolf, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dist,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = hp;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  p.facing = 0;
  return mob;
}

function castAndSettle(sim: Sim, ability: string, seconds = 4, refill = true): void {
  if (refill) sim.player.resource = sim.player.maxResource;
  sim.castAbility(ability);
  for (let i = 0; i < 20 * seconds; i++) sim.tick();
}

function dealDamage(sim: Sim, target: Entity, amount: number): void {
  (
    sim as unknown as {
      dealDamage(
        s: Entity | null,
        t: Entity,
        n: number,
        c: boolean,
        sc: string,
        a: string | null,
        k: string,
      ): void;
    }
  ).dealDamage(null, target, amount, false, 'physical', null, 'hit');
}

function completeCast(sim: Sim, ability: string, target: Entity | null = null): void {
  onCastCompleted(
    (sim as unknown as { ctx: Parameters<typeof onCastCompleted>[0] }).ctx,
    sim.player,
    ability,
    target,
  );
}

// The mage and Hunter trees were replaced wholesale by owner-approved designs.
// Their coverage lives in tests/mage_choice_rows.test.ts and
// tests/hunter_talents.test.ts.

describe('rogue wave 2 choice rows', () => {
  it('Evasion grants a cheap builder and poison swings restore energy', () => {
    const { sim, p } = rig('rogue', 20, {
      14: 'rog_r14_venom_dividend',
      17: 'rog_r17_ghostfoot_gambit',
    });
    addTargetMob(sim, 100000, 3);
    p.resource = 40;
    castAndSettle(sim, 'evasion', 1, false);
    expect(p.auras.some((a) => a.id === 'rog_improved_evasion')).toBe(true);
    castAndSettle(sim, 'instant_poison', 2);
    p.resource = 20;
    sim.startAutoAttack();
    for (let i = 0; i < 20 * 6 && p.resource <= 20; i++) sim.tick();
    expect(p.resource).toBeGreaterThan(20);
  });

  it('Cheat Death prevents one killing blow', () => {
    const { sim, p } = rig('rogue', 20, { 8: 'rog_r8_borrowed_breath' });
    dealDamage(sim, p, p.hp + 100);
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(1);
  });
});

describe('druid wave 2 choice rows', () => {
  it('Loping Stride triggers once per internal cooldown after a form change', () => {
    const { sim, p } = rig('druid', 20, { 5: 'dru_r5_ferocity' });
    castAndSettle(sim, 'cat_form', 1);
    expect(p.auras.some((a) => a.id === 'loping_stride' && a.kind === 'buff_speed')).toBe(true);
    p.auras = p.auras.filter((a) => a.id !== 'loping_stride');
    p.gcdRemaining = 0;
    sim.castAbility('bear_form');
    expect(p.auras.some((a) => a.id === 'loping_stride')).toBe(false);
  });

  it('Ironhide Reflex absorbs a large hit and respects its internal cooldown', () => {
    const { sim, p } = rig('druid', 20, { 8: 'dru_r8_improved_roots' });
    dealDamage(sim, p, Math.ceil(p.maxHp * 0.25));
    const shield = p.auras.find((a) => a.id === 'dru_ironhide_reflex');
    expect(shield?.kind).toBe('absorb');
    expect(shield?.value).toBe(Math.round(p.maxHp * 0.15));
    p.auras = p.auras.filter((a) => a.id !== 'dru_ironhide_reflex');
    dealDamage(sim, p, Math.ceil(p.maxHp * 0.25));
    expect(p.auras.some((a) => a.id === 'dru_ironhide_reflex')).toBe(false);
  });
});

describe('warlock wave 2 choice rows', () => {
  it('names Grand Malediction targets and describes class talents without internal shared jargon', () => {
    const dreadChorus = WARLOCK_CHOICE_ROWS.rows
      .find((row) => row.level === 8)
      ?.options.find((option) => option.id === 'wlk_r8_howl_of_terror');
    expect(dreadChorus?.description).toBe(
      'Grants Dread Chorus: frighten enemies within 8 yards for up to 3 sec. Damage may break the effect. 40 sec cooldown.',
    );
    const shadowCredit = WARLOCK_CHOICE_ROWS.rows
      .find((row) => row.level === 14)
      ?.options.find((option) => option.id === 'wlk_r14_shadow_mastery');
    expect(shadowCredit?.description).toBe(
      'Each time you spend at least 40% of your specialization resource, you gain 1 free generator. Spending at least 80% at once grants 2. Separate triggers can accumulate up to 2 charges.',
    );

    const grandMalediction = WARLOCK_CHOICE_ROWS.rows
      .find((row) => row.level === 17)
      ?.options.find((option) => option.id === 'wlk_r17_death_coil');
    expect(grandMalediction?.description).toBe(
      "Reduces your specialization's setup cooldown by 25%: Hex of Violence (Affliction; punishes the enemy's damaging actions), Unholy Command (Necromancy; briefly empowers all your undead), or Ruinous Brand (Destruction; echoes your direct spells).",
    );

    const capstones = WARLOCK_CHOICE_ROWS.rows.find((row) => row.level === 20)?.options ?? [];
    const unbrokenRitual = capstones.find((option) => option.id === 'wlk_r20_chaos_bolt');
    const forbiddenReflection = capstones.find(
      (option) => option.id === 'wlk_r20_grimoire_of_haste',
    );
    expect(unbrokenRitual?.description).toBe(
      'Each second spent casting or channeling reduces the remaining cooldown of your Warlock class and specialization abilities by 0.5 sec. Does not affect capstone talents.',
    );
    expect(forbiddenReflection?.description).toBe(
      'The first Warlock class or specialization ability with a cooldown that you use, except Soulwell and Army of the Dead, creates a forbidden reflection. You may use that same ability once more within 10 sec for its normal cost without starting another cooldown. This effect can occur once every 60 sec.',
    );
    expect(`${unbrokenRitual?.description} ${forbiddenReflection?.description}`).not.toMatch(
      /\bshared\b/i,
    );
  });

  it('Grand Malediction reduces an already-known setup cooldown for every specialization', () => {
    for (const [spec, ability, cooldown] of [
      ['affliction', 'hex_of_violence', 11.25],
      ['demonology', 'unholy_command', 33.75],
      ['destruction', 'ruinous_brand', 15],
    ] as const) {
      const { sim } = rig('warlock', 20, { 17: 'wlk_r17_death_coil' }, spec);
      expect(sim.resolvedAbility(ability)?.cooldown, spec).toBe(cooldown);
    }
  });

  it('Ashen Focus keeps generators stationary and the final active is Abyssal Rift', () => {
    for (const [spec, generator] of [
      ['affliction', 'needle_of_fate'],
      ['demonology', 'soul_harvest'],
      ['destruction', 'shadow_bolt'],
    ] as const) {
      const { sim } = rig('warlock', 20, { 17: 'wlk_r17_improved_fear' }, spec);
      expect(sim.resolvedAbility(generator)?.castWhileMoving, spec).not.toBe(true);
    }

    const { sim } = rig('warlock', 20, { 20: 'wlk_r20_curse_mastery' });
    expect(sim.resolvedAbility('abyssal_rift')).toMatchObject({
      cooldown: 90,
      effects: [
        expect.objectContaining({
          type: 'aoeDamage',
          radius: 8,
          pullToCenter: true,
          stunSec: 2,
        }),
      ],
    });
  });

  it('Hexstorm empowers each primary generator behind its internal cooldown', () => {
    for (const [spec, generator] of [
      ['affliction', 'needle_of_fate'],
      ['demonology', 'soul_harvest'],
      ['destruction', 'shadow_bolt'],
    ] as const) {
      const { sim, p } = rig(
        'warlock',
        20,
        {
          17: 'wlk_r17_demonic_resilience',
        },
        spec,
      );
      for (let i = 0; i < 3; i++) completeCast(sim, generator);
      expect(
        p.auras.some((a) => a.id === 'wlk_curse_mastery'),
        spec,
      ).toBe(true);
      // Inside the 10 sec icd three more generators do not re-arm it.
      p.auras.length = 0;
      for (let i = 0; i < 3; i++) completeCast(sim, generator);
      expect(
        p.auras.some((a) => a.id === 'wlk_curse_mastery'),
        spec,
      ).toBe(false);
    }
  });

  it('Forbidden Reflection arms after a shared cooldown instead of creating a ward', () => {
    const { sim, p } = rig('warlock', 20, {
      11: 'wlk_r11_fel_concentration',
      20: 'wlk_r20_grimoire_of_haste',
    });
    castAndSettle(sim, 'dark_pact', 1);
    expect(p.auras.some((a) => a.id === 'wlk_forbidden_reflection')).toBe(true);
    expect(p.auras.some((a) => a.id === 'wlk_grimoire_of_carnage')).toBe(false);
  });

  it('generator economy, Blood Credit, and Sanguine Covenant change live outcomes', () => {
    const economical = rig('warlock', 20, { 14: 'wlk_r14_amplify_curse' }, 'destruction');
    expect(economical.sim.resolvedAbility('shadow_bolt')?.cost).toBe(42);

    const credited = rig('warlock', 20, { 14: 'wlk_r14_ruin' });
    credited.p.resource = 0;
    const hpBeforeTap = credited.p.hp;
    credited.sim.castAbility('life_tap');
    expect(credited.p.resource).toBe(128);
    expect(credited.p.hp).toBe(hpBeforeTap - 85);

    const afflictionCredit = rig('warlock', 20, { 14: 'wlk_r14_ruin' }, 'affliction');
    afflictionCredit.p.resource = 0;
    const hpBeforeCruelPact = afflictionCredit.p.hp;
    afflictionCredit.sim.castAbility('cruel_pact');
    expect(afflictionCredit.p.resource).toBe(
      Math.round(afflictionCredit.p.maxResource * 0.015 * 1.5),
    );
    expect(afflictionCredit.p.hp).toBe(
      hpBeforeCruelPact - Math.round(afflictionCredit.p.maxHp * 0.12),
    );

    const guarded = rig('warlock', 20, { 11: 'wlk_r11_fel_concentration' });
    const beforePact = guarded.p.hp;
    guarded.sim.castAbility('dark_pact');
    expect(guarded.p.hp).toBe(beforePact - Math.round(beforePact * 0.1));
    expect(guarded.p.auras.find((a) => a.id === 'dark_pact')).toMatchObject({
      kind: 'absorb',
      value: Math.round(guarded.p.maxHp * 0.3),
    });
  });
});
