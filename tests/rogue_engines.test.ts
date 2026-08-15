import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { MOBS } from '../src/sim/data';
import { equipBestInSlotForDev } from '../src/sim/dev/bis_gear';
import { resetCombatForDev } from '../src/sim/dev_commands';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';

// The rogue spec engines (docs/design/rogue-v029-spec-engines.md): Venom
// Ritual stages arming Venomrend, the Redline echo window, the Gloam bank
// arming Veilstrike, spec gating, and the respec cleanup contract.

function rig(spec: string | null) {
  const sim = new Sim({ seed: 23, playerClass: 'rogue', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function addTargetMob(sim: Sim, hp = 1_000_000, dist = 2, id = 9400): Entity {
  const p = sim.player;
  const mob = createMob(id, MOBS.forest_wolf, 20, {
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

function fullFinisher(sim: Sim, ability = 'eviscerate'): void {
  sim.player.comboPoints = 5;
  sim.player.resource = sim.player.maxResource;
  sim.castAbility(ability);
  sim.player.autoAttack = false;
  for (let i = 0; i < 40; i++) sim.tick(); // clear the global cooldown
}

function stacksOf(p: Entity, id: string): number {
  const aura = p.auras.find((a) => a.id === id);
  return aura ? (aura.stacks ?? 1) : 0;
}

function completeCast(sim: Sim, ability: string, target: Entity | null = null): void {
  onCastCompleted(
    (sim as unknown as { ctx: Parameters<typeof onCastCompleted>[0] }).ctx,
    sim.player,
    ability,
    target,
  );
}

describe('Knifework: Venom Ritual', () => {
  it('six builder strikes arm the ritual, and Venomrend consumes it all', () => {
    const { sim, p } = rig('assassination');
    const mob = addTargetMob(sim);
    completeCast(sim, 'backstab', mob);
    expect(stacksOf(p, 'venom_ritual')).toBe(1);
    completeCast(sim, 'sinister_strike', mob); // the no-angle fallback builds too
    completeCast(sim, 'backstab', mob);
    // Three stages is only halfway: the button must still be Dirt Nap, or the
    // ritual arms before the FIRST full finisher and the two-beat rhythm dies.
    expect(stacksOf(p, 'venom_ritual')).toBe(3);
    expect(sim.resolvedAbility('eviscerate')?.def.id).toBe('eviscerate');
    for (let i = 0; i < 3; i++) completeCast(sim, 'backstab', mob);
    expect(stacksOf(p, 'venom_ritual')).toBe(6);
    expect(sim.resolvedAbility('eviscerate')?.def.id).toBe('venomrend');

    // Arm a bleed, then detonate: the ritual, the bleed, and the combo all go.
    p.comboPoints = 5;
    p.resource = p.maxResource;
    sim.castAbility('rupture');
    for (let i = 0; i < 40; i++) sim.tick(); // land the bleed and clear the gcd
    expect(mob.auras.some((a) => a.kind === 'dot' && a.id === 'rupture')).toBe(true);

    const beforeHp = mob.hp;
    const beforeEnergy = 40;
    p.resource = beforeEnergy;
    fullFinisher(sim); // resolves as Venomrend through the transform
    expect(stacksOf(p, 'venom_ritual')).toBe(0);
    expect(mob.auras.some((a) => a.kind === 'dot' && a.id === 'rupture')).toBe(false);
    expect(mob.hp).toBeLessThan(beforeHp);
    expect(sim.resolvedAbility('eviscerate')?.def.id).toBe('eviscerate');
  });

  it('still carries the assassination baseline damage mod through the Venomrend transform', () => {
    // Assassination's spec baseline (spec_baselines.ts) bakes a real, shipped
    // global.meleeDmgPct: 0.22 into every physical-school ability. Venomrend
    // (school: physical) is a wholesale def swap via resolveActionReplacement,
    // never a member of the rogue's known-ability list, so it only ever gets
    // this multiplier if resolvedAbility re-applies talent mods to the
    // swapped-in def. This pins that the ordering refactor in resolvedAbility
    // did not regress the one real per-ability-swap mod path that already
    // shipped: dropping it would leave Venomrend at its raw 100/55 base/perCombo.
    const { sim, p } = rig('assassination');
    const mob = addTargetMob(sim);
    for (let i = 0; i < 6; i++) completeCast(sim, 'backstab', mob);
    expect(stacksOf(p, 'venom_ritual')).toBe(6);

    const resolved = sim.resolvedAbility('eviscerate');
    expect(resolved?.def.id).toBe('venomrend');
    const finisher = resolved?.effects.find((effect) => effect.type === 'finisherDamage');
    if (!finisher || finisher.type !== 'finisherDamage') {
      throw new Error('expected a finisherDamage effect on the resolved Venomrend');
    }
    // Raw Venomrend is base 100 / perCombo 55 (talent_abilities_v2_a.ts); at
    // 1.22x that is 122 / 67.
    expect(finisher.base).toBe(122);
    expect(finisher.perCombo).toBe(67);
  });

  it('the two-beat rhythm: a five-thrust cycle ends in Dirt Nap, the next in Venomrend', () => {
    const { sim, p } = rig('assassination');
    const mob = addTargetMob(sim, 1_000_000, 2, 9403);
    // Cycle one: five thrusts bank five stages, one short of armed, so the
    // full finisher resolves as plain Dirt Nap and leaves the bank standing.
    for (let i = 0; i < 5; i++) completeCast(sim, 'backstab', mob);
    expect(stacksOf(p, 'venom_ritual')).toBe(5);
    expect(sim.resolvedAbility('eviscerate')?.def.id).toBe('eviscerate');
    fullFinisher(sim);
    expect(stacksOf(p, 'venom_ritual')).toBe(5);

    // Cycle two: the first thrust arms the ritual, and the finisher detonates.
    completeCast(sim, 'backstab', mob);
    expect(stacksOf(p, 'venom_ritual')).toBe(6);
    expect(sim.resolvedAbility('eviscerate')?.def.id).toBe('venomrend');
    fullFinisher(sim);
    expect(stacksOf(p, 'venom_ritual')).toBe(0);
    expect(sim.resolvedAbility('eviscerate')?.def.id).toBe('eviscerate');
    // The wound Venomrend reopens is what the NEXT rend detonates.
    const wound = mob.auras.find((a) => a.kind === 'dot' && a.id === 'venomrend');
    expect(wound).toBeDefined();
    if (!wound) return;

    // Venom Dart tends the wound: +6 sec per dart, never past the 20 sec cap.
    for (let i = 0; i < 60; i++) sim.tick(); // 3 sec of decay
    const beforeExtend = wound.remaining;
    completeCast(sim, 'venom_dart', mob);
    expect(wound.remaining).toBeCloseTo(Math.min(20, beforeExtend + 6), 1);
    completeCast(sim, 'venom_dart', mob);
    completeCast(sim, 'venom_dart', mob);
    expect(wound.remaining).toBeLessThanOrEqual(20); // the cap holds
  });

  it('finishers do not build the ritual and other specs never build it', () => {
    const { sim, p } = rig('assassination');
    addTargetMob(sim, 1_000_000, 2, 9401);
    fullFinisher(sim);
    expect(stacksOf(p, 'venom_ritual')).toBe(0);

    const thug = rig('combat');
    const thugMob = addTargetMob(thug.sim, 1_000_000, 2, 9402);
    completeCast(thug.sim, 'backstab', thugMob);
    expect(stacksOf(thug.p, 'venom_ritual')).toBe(0);
  });
});

describe('Thuggery: the Redline combo chain', () => {
  it('Dirt Nap opens the window, both buttons transform, and Haymakers deepen the pips', () => {
    const { sim, p } = rig('combat');
    const mob = addTargetMob(sim, 1_000_000, 2, 9410);
    // Cutthroat Tempo never opens the window: only the real Dirt Nap does.
    p.comboPoints = 5;
    p.resource = p.maxResource;
    sim.castAbility('slice_and_dice');
    for (let i = 0; i < 40; i++) sim.tick();
    expect(p.auras.some((a) => a.id === 'redline')).toBe(false);
    expect(sim.resolvedAbility('sinister_strike')?.def.id).toBe('sinister_strike');
    expect(sim.resolvedAbility('eviscerate')?.def.id).toBe('eviscerate');

    fullFinisher(sim); // the opening Dirt Nap
    const run = p.auras.find((a) => a.id === 'redline');
    expect(run?.kind).toBe('redline');
    expect(run?.stacks).toBe(1);
    expect(run?.remaining).toBeLessThanOrEqual(8);
    expect(sim.resolvedAbility('sinister_strike')?.def.id).toBe('body_blow');
    expect(sim.resolvedAbility('eviscerate')?.def.id).toBe('knockout_blow');

    // Each Haymaker deepens the run by a pip, to the cap of 4.
    for (let i = 0; i < 3; i++) completeCast(sim, 'body_blow', mob);
    expect(stacksOf(p, 'redline')).toBe(4);
    completeCast(sim, 'body_blow', mob);
    expect(stacksOf(p, 'redline')).toBe(4);
  });

  it('the Knockout cashes out per pip and ends the run; an expired window forfeits it', () => {
    const { sim, p } = rig('combat');
    const mob = addTargetMob(sim, 1_000_000, 2, 9411);
    p.critChance = 0; // deterministic hit amounts for the pip comparison
    const knockoutAmount = (): number => {
      sim.events.length = 0;
      p.comboPoints = 5;
      p.resource = p.maxResource;
      sim.castAbility('eviscerate'); // resolves as Lights Out
      const hit = sim.events.find(
        (e) => e.type === 'damage' && (e as { ability?: string | null }).ability === 'Lights Out',
      ) as (SimEvent & { amount: number }) | undefined;
      for (let i = 0; i < 40; i++) sim.tick(); // clear the global cooldown
      return hit?.amount ?? 0;
    };

    fullFinisher(sim); // open the window
    for (let i = 0; i < 3; i++) completeCast(sim, 'body_blow', mob);
    expect(stacksOf(p, 'redline')).toBe(4);
    const deep = knockoutAmount();
    expect(deep).toBeGreaterThan(0);
    expect(p.auras.some((a) => a.id === 'redline')).toBe(false); // the run ended
    expect(sim.resolvedAbility('eviscerate')?.def.id).toBe('eviscerate');

    fullFinisher(sim); // reopen, then cash out immediately at 1 pip
    const shallow = knockoutAmount();
    expect(shallow).toBeGreaterThan(0);
    // 4 pips = 1 + 0.25 * 3 = 1.75x; the margin absorbs variance rolls.
    expect(deep).toBeGreaterThan(shallow * 1.3);

    // A window left to expire forfeits the Knockout: both buttons revert.
    fullFinisher(sim); // reopen
    const dying = p.auras.find((a) => a.id === 'redline');
    expect(dying).toBeDefined();
    if (dying) dying.remaining = 0.01;
    for (let i = 0; i < 3; i++) sim.tick();
    expect(p.auras.some((a) => a.id === 'redline')).toBe(false);
    expect(sim.resolvedAbility('eviscerate')?.def.id).toBe('eviscerate');
    expect(sim.resolvedAbility('sinister_strike')?.def.id).toBe('sinister_strike');
  });

  it('other specs never open the window', () => {
    const knife = rig('assassination');
    addTargetMob(knife.sim, 1_000_000, 2, 9412);
    fullFinisher(knife.sim);
    expect(knife.p.auras.some((a) => a.id === 'redline')).toBe(false);
    expect(knife.sim.resolvedAbility('sinister_strike')?.def.id).toBe('sinister_strike');
  });
});

describe('Skulduggery: the Gloam bank and its detonation', () => {
  it('openers and the Red Ribbon rhythm bank stages; a full bank unlocks the openers, and the next one detonates it', () => {
    const { sim, p } = rig('subtlety');
    const mob = addTargetMob(sim, 1_000_000, 30, 9420);
    sim.castAbility('stealth');
    for (let i = 0; i < 25; i++) sim.tick();
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(true);
    p.pos.x = mob.pos.x;
    p.pos.z = mob.pos.z - 2;
    p.facing = 0;
    p.resource = p.maxResource;
    sim.castAbility('cheap_shot');
    for (let i = 0; i < 40; i++) sim.tick(); // land the opener and clear the gcd
    expect(stacksOf(p, 'gloam')).toBe(1);

    // Every second Red Ribbon banks one more stage: four casts = two stages.
    for (let cast = 0; cast < 4; cast++) {
      p.resource = p.maxResource;
      sim.castAbility('hemorrhage');
      for (let i = 0; i < 40; i++) sim.tick(); // clear the global cooldown
    }
    expect(stacksOf(p, 'gloam')).toBe(3);
    // No transformed button anymore: Duskveil stays Duskveil, always.
    expect(sim.resolvedAbility('stealth')?.def.id).toBe('stealth');

    // The armed bank unlocks the opener in the open, and casting it IS the
    // detonation: the bank empties, the shadow veil rises around it, and the
    // detonator is FREE: 5 energy cannot pay Gut Punch's 60, so this cast
    // going through is the free-detonator pin.
    p.comboPoints = 0;
    p.resource = 5;
    sim.castAbility('cheap_shot'); // unstealthed, allowed by the armed bank
    for (let i = 0; i < 5; i++) sim.tick();
    expect(p.comboPoints).toBe(2);
    expect(stacksOf(p, 'gloam')).toBe(0);
    const veil = p.auras.find((a) => a.id === 'veilstrike');
    expect(veil?.kind).toBe('buff_dmg_done');
    expect(veil?.value).toBeCloseTo(0.1);
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(false);

    // Inside the veil further openers work in the open and bank NOTHING
    // (the anti-snowball guard holds).
    for (let i = 0; i < 40; i++) sim.tick();
    p.resource = p.maxResource;
    sim.castAbility('cheap_shot');
    for (let i = 0; i < 5; i++) sim.tick();
    expect(stacksOf(p, 'gloam')).toBe(0);
  });

  it('a true-stealth opener with a full bank banks nothing but never detonates', () => {
    const { sim, p } = rig('subtlety');
    const mob = addTargetMob(sim, 1_000_000, 30, 9423);
    // Fill the bank by hand, then open from REAL stealth: the veil must not
    // rise, the bank must stand (stealth already covers the opener).
    (sim as unknown as { ctx: Parameters<typeof onCastCompleted>[0] }).ctx.applyAura(p, {
      id: 'gloam',
      name: 'Gloam',
      kind: 'gloam',
      remaining: 60,
      duration: 60,
      value: 0,
      sourceId: p.id,
      school: 'physical',
      stacks: 3,
    });
    sim.castAbility('stealth');
    for (let i = 0; i < 25; i++) sim.tick();
    p.pos.x = mob.pos.x;
    p.pos.z = mob.pos.z - 2;
    p.facing = 0;
    p.resource = p.maxResource;
    sim.castAbility('cheap_shot');
    for (let i = 0; i < 5; i++) sim.tick();
    expect(stacksOf(p, 'gloam')).toBe(3);
    expect(p.auras.some((a) => a.id === 'veilstrike')).toBe(false);
  });

  it("the detonating Lurker's Strike is the doubled one, face to face", () => {
    const { sim, p } = rig('subtlety');
    // A training dummy so the banking phase geometry is stable; it is turned
    // to FACE the player before the detonation, the real solo situation.
    const mob = createMob(9422, MOBS.training_dummy, 20, {
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z + 2,
    });
    mob.maxHp = mob.hp = 1_000_000;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
    sim.targetEntity(mob.id);
    p.facing = 0;
    equipBestInSlotForDev(
      (sim as unknown as { ctx: Parameters<typeof equipBestInSlotForDev>[0] }).ctx,
      p.id,
    ); // Lurker's Strike requires a dagger
    p.critChance = 0; // crits keep kind 'hit' (crit flag), so pin them off
    const isHit = (e: SimEvent): e is SimEvent & { amount: number; ability: string | null } =>
      e.type === 'damage' &&
      (e as { kind?: string }).kind === 'hit' &&
      !(e as { crit?: boolean }).crit;

    // Bank the full Gloam: true-stealth opener plus four Red Ribbons.
    sim.castAbility('stealth');
    for (let i = 0; i < 25; i++) sim.tick();
    p.resource = p.maxResource;
    sim.castAbility('cheap_shot');
    for (let i = 0; i < 40; i++) sim.tick();
    for (let cast = 0; cast < 4; cast++) {
      p.resource = p.maxResource;
      sim.castAbility('hemorrhage');
      for (let i = 0; i < 40; i++) sim.tick();
    }
    expect(stacksOf(p, 'gloam')).toBe(3);

    // Turn the dummy to FACE the player: solo, a fighting mob always does,
    // and the armed bank must waive the behind requirement or the detonator
    // could never land outside a group (owner playtest bug).
    mob.facing = Math.PI;

    // The detonation: one press, in the open, face to face. The veil rises
    // BEFORE the strike resolves, so this very hit is the doubled one.
    sim.events.length = 0;
    p.resource = p.maxResource;
    sim.castAbility('ambush');
    const edgedEvents: SimEvent[] = [...sim.events];
    for (let i = 0; i < 30; i++) {
      sim.tick();
      edgedEvents.push(...sim.events);
    }
    expect(stacksOf(p, 'gloam')).toBe(0);
    expect(p.auras.some((a) => a.id === 'veilstrike')).toBe(true);
    expect(p.auras.some((a) => a.id === 'veiled_edge')).toBe(false); // consumed by this cast
    const edged = edgedEvents.filter(isHit).find((e) => e.ability === "Lurker's Strike");
    expect(edged).toBeDefined();

    // A second Lurker's Strike inside the veil pays full price: no edge left.
    // A single swing can miss on the hit table, so retry within the veil.
    let plain: (SimEvent & { amount: number; ability: string | null }) | undefined;
    for (let attempt = 0; attempt < 3 && !plain; attempt++) {
      sim.events.length = 0;
      p.resource = p.maxResource;
      sim.castAbility('ambush');
      const plainEvents: SimEvent[] = [...sim.events];
      for (let i = 0; i < 25; i++) {
        sim.tick();
        plainEvents.push(...sim.events);
      }
      plain = plainEvents.filter(isHit).find((e) => e.ability === "Lurker's Strike");
    }
    expect(plain).toBeDefined();
    expect(edged?.amount ?? 0).toBeGreaterThan((plain?.amount ?? 0) * 1.3);
  });

  it('without an armed bank an unstealthed opener is still rejected', () => {
    const { sim, p } = rig('subtlety');
    addTargetMob(sim, 1_000_000, 2, 9421);
    p.comboPoints = 0;
    p.resource = p.maxResource;
    sim.castAbility('cheap_shot');
    for (let i = 0; i < 5; i++) sim.tick();
    expect(p.comboPoints).toBe(0);
  });
});

describe('engine aura tooltips teach the interaction', () => {
  it('every engine state resolves to a specific auraEffect key with its numbers', () => {
    expect(
      auraEffectDescriptor({ id: 'venom_ritual', kind: 'venom_ritual', value: 0, stacks: 4 }),
    ).toEqual({ key: 'hudChrome.auraEffect.venomRitual', nums: { stacks: 4, max: 6 } });
    expect(auraEffectDescriptor({ id: 'gloam', kind: 'gloam', value: 0, stacks: 2 })).toEqual({
      key: 'hudChrome.auraEffect.gloam',
      nums: { stacks: 2, max: 3 },
    });
    expect(
      auraEffectDescriptor({ id: 'redline', kind: 'redline', value: 0.25, stacks: 3 }),
    ).toEqual({ key: 'hudChrome.auraEffect.redline', nums: { stacks: 3, max: 4, pct: 25 } });
    expect(auraEffectDescriptor({ id: 'veilstrike', kind: 'buff_dmg_done', value: 0.1 })).toEqual({
      key: 'hudChrome.auraEffect.veilstrikeWindow',
      nums: { pct: 10 },
    });
    expect(auraEffectDescriptor({ id: 'veiled_edge', kind: 'veiled_edge', value: 1 })).toEqual({
      key: 'hudChrome.auraEffect.veiledEdge',
      nums: {},
    });
    expect(auraEffectDescriptor({ id: 'dusk_economy', kind: 'dusk_economy', value: 0.5 })).toEqual({
      key: 'hudChrome.auraEffect.duskEconomy',
      nums: { pct: 50 },
    });
    // A veilstrike-shaped value on a DIFFERENT buff stays on the generic path.
    expect(auraEffectDescriptor({ id: 'some_buff', kind: 'buff_dmg_done', value: 0.1 })?.key).toBe(
      'hudChrome.auraEffect.dmgDone',
    );
  });
});

describe('engine cleanup contract', () => {
  it('spec change strips every engine state and counter', () => {
    const { sim, p } = rig('combat');
    addTargetMob(sim, 1_000_000, 2, 9430);
    fullFinisher(sim);
    expect(p.auras.some((a) => a.id === 'redline')).toBe(true);
    // Respec is combat-locked, so leave the fight the dev way first.
    resetCombatForDev(
      (sim as unknown as { ctx: Parameters<typeof resetCombatForDev>[0] }).ctx,
      p.id,
    );
    expect(sim.setSpec('assassination')).toBe(true);
    expect(p.auras.some((a) => a.id === 'redline')).toBe(false);
    expect(p.procState?.counters.rog_gloam_rhythm).toBeUndefined();
  });

  it('with no spec selected nothing builds', () => {
    const { sim, p } = rig(null);
    addTargetMob(sim, 1_000_000, 2, 9431);
    fullFinisher(sim);
    expect(p.auras.some((a) => a.id === 'redline')).toBe(false);
    expect(p.auras.some((a) => a.id === 'venom_ritual')).toBe(false);
  });
});
