import { describe, expect, it } from 'vitest';
import { anchorProbeInOpenField } from '../scripts/probe_anchor';
import { lineOfSightClear } from '../src/sim/colliders';
import { dealDamage } from '../src/sim/combat/damage';
import type { ResolvedAbilityMod } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';

type TestSim = Sim & {
  addEntity(entity: Entity): void;
  nextId: number;
};

function hunter(
  spec: string,
  rows: Partial<Record<5 | 8 | 11 | 14 | 17 | 20, string>>,
  seed: number,
): TestSim {
  const sim = new Sim({ seed, playerClass: 'hunter', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows })).toBe(true);
  return sim;
}

function addMob(sim: TestSim, distance: number): Entity {
  let pos = { x: sim.player.pos.x, z: sim.player.pos.z + distance };
  for (let step = 0; step < 16; step++) {
    const angle = (step * Math.PI) / 8;
    const candidate = {
      x: sim.player.pos.x + Math.sin(angle) * distance,
      z: sim.player.pos.z + Math.cos(angle) * distance,
    };
    if (lineOfSightClear(sim.cfg.seed, sim.player.pos, candidate)) {
      pos = candidate;
      break;
    }
  }
  const mob = createMob(sim.nextId++, MOBS.training_dummy, 20, {
    x: pos.x,
    y: sim.player.pos.y,
    z: pos.z,
  });
  mob.hostile = true;
  mob.moveSpeed = 0;
  mob.aiState = 'idle';
  mob.maxHp = 1_000_000;
  mob.hp = mob.maxHp;
  sim.addEntity(mob);
  return mob;
}

function addPet(sim: TestSim, hp = 1_000): Entity {
  const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x + 1,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 2,
  });
  pet.hostile = false;
  pet.ownerId = sim.playerId;
  pet.maxHp = 1_000;
  pet.hp = hp;
  sim.addEntity(pet);
  return pet;
}

function aura(id: string, kind: Aura['kind']): Aura {
  return {
    id,
    name: id,
    kind,
    remaining: 10,
    duration: 10,
    value: kind === 'slow' ? 0.5 : 0,
    sourceId: 99,
    school: 'physical',
  };
}

function advance(sim: Sim, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < seconds * 20; tick++) events.push(...sim.tick());
  return events;
}

function ready(sim: Sim, abilityId: string): void {
  sim.player.gcdRemaining = 0;
  sim.player.cooldowns.delete(abilityId);
}

describe('Hunter v0.29 choice-row mechanics', () => {
  it('Tactical Retreat gives Trailbreak two uses and clears ordinary movement locks', () => {
    const sim = hunter('survival', { 5: 'hun_r5_tactical_retreat' }, 2920);
    expect(sim.resolvedAbility('trailbreak')?.charges).toBe(2);
    sim.player.auras.push(aura('test_root', 'root'), aura('test_slow', 'slow'));

    sim.castAbility('trailbreak');

    expect(sim.player.auras.some((entry) => entry.kind === 'root')).toBe(false);
    expect(sim.player.auras.some((entry) => entry.kind === 'slow')).toBe(false);
  });

  it('Enduring Courser bursts on activation and breaks when damage lands', () => {
    const sim = hunter('survival', { 5: 'hun_r5_enduring_courser' }, 2927);

    sim.castAbility('aspect_of_the_cheetah');

    const burst = sim.player.auras.find((entry) => entry.id === 'hunter_enduring_courser_burst');
    expect(burst).toMatchObject({ kind: 'buff_speed', value: 1.6, remaining: 3 });
    dealDamage(sim.ctx, null, sim.player, 10, false, 'shadow', 'Test Hit', 'hit');
    expect(sim.player.auras.some((entry) => entry.id === 'hunter_enduring_courser_burst')).toBe(
      false,
    );
  });

  it("Predator's Pace follows a successful Focus generator and respects its cooldown", () => {
    const sim = hunter('marksmanship', { 5: 'hun_r5_predators_pace' }, 2928);
    const target = addMob(sim, 20);
    sim.targetEntity(target.id);

    sim.castAbility('measured_shot');
    advance(sim, 3);

    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'hunter_predators_pace', kind: 'buff_speed', value: 1.2 }),
    );
    expect(sim.player.auras.some((entry) => entry.id === 'hunter_predators_pace_icd')).toBe(true);
  });

  it('Receding Shell can end Shellskin early and refund unused cooldown', () => {
    const sim = hunter('survival', { 8: 'hun_r8_receding_shell' }, 2921);
    sim.castAbility('shellskin');
    const shell = sim.player.auras.find((entry) => entry.id === 'shellskin');
    if (!shell) throw new Error('missing Shellskin aura');
    shell.remaining = 6;

    sim.castAbility('shellskin');

    expect(sim.player.auras.some((entry) => entry.id === 'shellskin')).toBe(false);
    expect(sim.player.cooldowns.get('shellskin')).toBeLessThan(180);
  });

  it('Shared Recovery heals the pet and protects both partners', () => {
    const sim = hunter('beast_mastery', { 8: 'hun_r8_shared_recovery' }, 2922);
    const pet = addPet(sim, 400);
    sim.player.hp = Math.round(sim.player.maxHp * 0.5);

    sim.castAbility('wildheart');

    expect(pet.hp).toBe(700);
    expect(sim.player.auras.some((entry) => entry.id.startsWith('hunter_shared_recovery'))).toBe(
      true,
    );
    expect(pet.auras.some((entry) => entry.id.startsWith('hunter_shared_recovery'))).toBe(true);
  });

  it('Beastguard redirects safely to a pet floor and falls back below half health', () => {
    const sim = hunter('beast_mastery', { 8: 'hun_r8_beastguard' }, 2929);
    const pet = addPet(sim, 205);
    const ownerBefore = sim.player.hp;

    dealDamage(sim.ctx, null, sim.player, 100, false, 'shadow', 'Test Hit', 'hit');
    expect(pet.hp).toBe(200);
    expect(sim.player.hp).toBe(ownerBefore - 95);

    pet.dead = true;
    pet.hp = 0;
    sim.player.hp = Math.floor(sim.player.maxHp * 0.4);
    const fallbackBefore = sim.player.hp;
    dealDamage(sim.ctx, null, sim.player, 100, false, 'shadow', 'Test Hit', 'hit');
    expect(sim.player.hp).toBe(fallbackBefore - 92);
  });

  it('Double Hush and Crippling Pursuit preserve their charge and per-target contracts', () => {
    const sim = hunter('marksmanship', { 11: 'hun_r11_double_hush' }, 2923);
    expect(sim.resolvedAbility('counter_shot')?.charges).toBe(2);
    expect(sim.resolvedAbility('counter_shot')?.cooldown).toBe(24);

    expect(
      sim.applyTalents({
        spec: 'marksmanship',
        rows: { 11: 'hun_r11_crippling_pursuit' },
      }),
    ).toBe(true);
    const target = addMob(sim, 20);
    sim.targetEntity(target.id);
    sim.castAbility('concussive_shot');
    advance(sim, 2.5);
    expect(target.auras.some((entry) => entry.kind === 'slow')).toBe(true);

    ready(sim, 'concussive_shot');
    sim.castAbility('concussive_shot');
    advance(sim, 2.5);
    expect(target.auras.some((entry) => entry.id.startsWith('hunter_crippling_root'))).toBe(true);
  });

  it('Apex Instinct grants Focus and expires four seconds after each major window', () => {
    for (const [spec, cooldown, spender, seed] of [
      ['beast_mastery', 'bestial_wrath', 'arcane_shot', 2924],
      ['marksmanship', 'cold_focus', 'aimed_shot', 2925],
      ['survival', 'bloodtrail_assault', 'mongoose_bite', 2926],
    ] as const) {
      const sim = hunter(spec, { 17: 'hun_r17_apex_instinct' }, seed);
      sim.player.resource = 0;
      sim.castAbility(cooldown);

      expect(sim.player.resource, spec).toBe(40);
      expect(sim.resolvedAbility(spender)?.cost, spec).toBeLessThan(
        sim.players.get(sim.playerId)?.known.find((entry) => entry.def.id === spender)?.cost ?? 0,
      );
      expect(
        sim.player.auras.find((entry) => entry.id === 'hunter_apex_instinct'),
        spec,
      ).toMatchObject({ stacks: 3, remaining: 16 });
    }
  });

  it('Efficient Rhythm converts 75 Focus spent into one stronger generator', () => {
    const sim = hunter('marksmanship', { 14: 'hun_r14_efficient_rhythm' }, 2930);
    const target = addMob(sim, 20);
    sim.targetEntity(target.id);

    for (let cast = 0; cast < 3; cast++) {
      sim.player.resource = sim.player.maxResource;
      ready(sim, 'aimed_shot');
      sim.castAbility('aimed_shot');
      advance(sim, 3);
    }

    expect(sim.player.auras.some((entry) => entry.id === 'hunter_efficient_rhythm_ready')).toBe(
      true,
    );
    const generator = sim.resolvedAbility('measured_shot');
    expect(generator?.effects).toContainEqual({ type: 'gainResource', amount: 40 });
    sim.player.resource = 0;
    ready(sim, 'measured_shot');
    sim.castAbility('measured_shot');
    advance(sim, 3);
    expect(sim.player.auras.some((entry) => entry.id === 'hunter_efficient_rhythm_ready')).toBe(
      false,
    );
  });

  it('Guise Mastery applies each guise rider behind one shared cooldown', () => {
    const harrier = hunter('marksmanship', { 14: 'hun_r14_guise_mastery' }, 2931);
    harrier.castAbility('aspect_of_the_hawk');
    expect(harrier.resolvedAbility('measured_shot')?.effects).toContainEqual({
      type: 'gainResource',
      amount: 30,
    });
    expect(harrier.player.auras.some((entry) => entry.id === 'hunter_guise_mastery_icd')).toBe(
      true,
    );

    const marten = hunter('survival', { 14: 'hun_r14_guise_mastery' }, 2932);
    marten.castAbility('aspect_of_the_monkey');
    expect(marten.player.auras).toContainEqual(
      expect.objectContaining({ id: 'hunter_guise_marten', kind: 'shield_wall', value: 0.25 }),
    );

    const courser = hunter(
      'survival',
      { 5: 'hun_r5_enduring_courser', 14: 'hun_r14_guise_mastery' },
      2933,
    );
    courser.castAbility('aspect_of_the_cheetah');
    expect(courser.player.auras).toContainEqual(
      expect.objectContaining({ id: 'hunter_guise_courser', kind: 'buff_speed', value: 1.6 }),
    );
  });

  it('Shell and Fang trades mitigation for attacks during Shellskin', () => {
    const sim = hunter('marksmanship', { 17: 'hun_r17_shell_and_fang' }, 2934);
    const target = addMob(sim, 20);
    sim.targetEntity(target.id);
    expect(sim.resolvedAbility('shellskin')?.effects).toContainEqual({
      type: 'selfBuff',
      kind: 'shield_wall',
      value: 0.4,
      duration: 8,
    });

    sim.castAbility('shellskin');
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('arcane_shot');
    advance(sim, 2);

    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it('Overdraw exposes every third spender before it resolves', () => {
    const sim = hunter('marksmanship', { 20: 'hun_r20_overdraw' }, 2925);
    const target = addMob(sim, 20);
    sim.targetEntity(target.id);

    for (let cast = 1; cast <= 2; cast++) {
      expect(sim.resolvedAbility('aimed_shot')?.hunterOverdraw).not.toBe(true);
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('aimed_shot');
      advance(sim, 3);
      ready(sim, 'aimed_shot');
      expect(
        sim.player.auras.filter((aura) => aura.id === 'hunter_overdraw_counter'),
        `Overdraw tracker after spender ${cast}`,
      ).toHaveLength(1);
    }
    const tracker = sim.player.auras.find((aura) => aura.id === 'hunter_overdraw_counter');
    expect(tracker).toBeDefined();
    if (!tracker) throw new Error('missing Overdraw tracker');
    tracker.remaining = 0.01;
    sim.tick();
    expect(sim.player.auras.filter((aura) => aura.id === 'hunter_overdraw_counter')).toHaveLength(
      1,
    );
    expect(sim.resolvedAbility('aimed_shot')?.hunterOverdraw).toBe(true);
  });

  it('Fang Chorus echoes every spender and turns the third echo into a clap', () => {
    // Seed re-hunted (2935 to 2937) after the v0.34.0 catch-up merge shifted
    // the shared draw order; a missed spender draws no echo and no clap.
    const sim = hunter('marksmanship', { 20: 'hun_r20_fang_chorus' }, 2937);
    anchorProbeInOpenField(sim);
    addPet(sim);
    const primary = addMob(sim, 20);
    const nearby = addMob(sim, 21);
    sim.targetEntity(primary.id);
    const allEvents: SimEvent[] = [];

    for (let cast = 0; cast < 3; cast++) {
      sim.player.resource = sim.player.maxResource;
      ready(sim, 'arcane_shot');
      sim.castAbility('arcane_shot');
      allEvents.push(...advance(sim, 2));
    }

    expect(
      allEvents.filter((event) => event.type === 'damage' && event.ability === 'Fang Chorus'),
    ).toHaveLength(2);
    const clapTargets = allEvents
      .filter(
        (event): event is Extract<SimEvent, { type: 'damage' }> =>
          event.type === 'damage' && event.ability === 'Fang Chorus Clap',
      )
      .map((event) => event.targetId);
    expect(clapTargets).toContain(primary.id);
    expect(clapTargets).toContain(nearby.id);
  });

  it('Pack Rally transforms Courser in combat and returns to Courser on cooldown', () => {
    const sim = hunter('beast_mastery', { 17: 'hun_r17_pack_rally' }, 2926);
    sim.player.inCombat = true;
    expect(sim.resolvedAbility('aspect_of_the_cheetah')?.def.id).toBe('pack_rally');

    sim.castAbility('aspect_of_the_cheetah');

    expect(sim.player.auras.some((entry) => entry.id.startsWith('hunter_pack_rally_haste'))).toBe(
      true,
    );
    expect(sim.resolvedAbility('aspect_of_the_cheetah')?.def.id).toBe('aspect_of_the_cheetah');
  });

  it('keeps a per-ability talent mod on the Pack Rally transform (no real hunter talent keys pack_rally today, so this pins the ordering directly)', () => {
    // No shipped hunter talent currently keys a mod to 'pack_rally' (it is a
    // shadow def, only ever reached through the aspect_of_the_cheetah swap,
    // never a member of the hunter's known-ability list). Injecting a mod
    // straight onto the resolved talentMods exercises the exact same
    // applyTalentMods(found, mods) call resolvedAbility makes for every real
    // per-ability mod, without inventing new talent content.
    const sim = hunter('beast_mastery', { 17: 'hun_r17_pack_rally' }, 2926);
    sim.player.inCombat = true;
    const packRallyMod: ResolvedAbilityMod = {
      dmgPct: 0,
      dmgPctVsDotted: 0,
      flatDmg: 0,
      costPct: -0.5,
      cooldownPct: -0.5,
      cooldownFlat: 0,
      castPct: 0,
      buffPct: 0,
      critPct: 0,
      castWhileMoving: false,
      damagePushbackImmune: false,
      ignoreStealthRequirement: false,
      bonusCharges: 0,
      addEffects: [],
    };
    sim.players.get(sim.playerId)!.talentMods.abilities.pack_rally = packRallyMod;

    const resolved = sim.resolvedAbility('aspect_of_the_cheetah');
    expect(resolved?.def.id).toBe('pack_rally');
    // Raw pack_rally is cost 20 / cooldown 90 (classes.ts); a -50% mod on
    // the swapped-in def must land exactly once.
    expect(resolved?.cost).toBe(10);
    expect(resolved?.cooldown).toBe(45);
  });
});
