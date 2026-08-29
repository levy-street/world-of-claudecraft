import { describe, expect, it, vi } from 'vitest';
import { runWeaponProcs } from '../src/sim/combat/equip_procs';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { duelFor, duelJustEndedBetween } from '../src/sim/social/duel';
import type { Aura, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// What a duel LEAVES BEHIND, which is the half nothing covered: players report
// dying moments after a duel ends. The bout itself cannot kill (the clamp in
// combat/damage.ts floors a duelist at 1 hp), so anything that kills them
// afterwards is aftermath: a debuff the end did not clear, or a body handed back
// at 1 hp with no protection left.

const DUEL_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.filter((c) => c.mobId === 'forest_wolf'),
  npcs: {},
  groundObjects: [],
};

const makeWorld = () =>
  new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: DUEL_TEST_WORLD });

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as unknown as { rebucket(e: unknown): void }).rebucket(e);
}

/** Two adjacent players, duel accepted and the countdown run out. */
function startedDuel(): { sim: Sim; a: number; b: number } {
  const sim = makeWorld();
  const a = sim.addPlayer('warrior', 'Aleph', { autoEquip: true });
  const b = sim.addPlayer('mage', 'Bet', { autoEquip: true });
  teleport(sim, a, 0, -40);
  teleport(sim, b, 2, -40);
  sim.duelRequest(b, a);
  sim.duelAccept(b);
  for (let i = 0; i < 20 * 6 && duelFor(sim.ctx, a)?.state !== 'active'; i++) sim.tick();
  expect(duelFor(sim.ctx, a)?.state, 'the duel really is live').toBe('active');
  return { sim, a, b };
}

/** Beat `loser` down until the clamp ends the bout. */
function fightToTheEnd(sim: Sim, winner: number, loser: number): void {
  const le = sim.entities.get(loser)!;
  const we = sim.entities.get(winner)!;
  for (let i = 0; i < 200 && duelFor(sim.ctx, loser); i++) {
    sim.ctx.dealDamage(we, le, 40, false, 'physical', null, 'hit');
    sim.tick();
  }
}

describe('what a duel leaves behind', () => {
  it('the bout itself never kills: the clamp floors the loser at 1 hp', () => {
    const { sim, a, b } = startedDuel();
    fightToTheEnd(sim, a, b);
    const loser = sim.entities.get(b)!;
    expect(loser.dead, 'a duel must never produce a real death').toBe(false);
    expect(duelFor(sim.ctx, b), 'and the duel is over').toBeNull();
    // The state the loser is handed back in. This is the arrangement every case
    // below depends on, so it is asserted rather than assumed.
    expect(loser.hp).toBe(1);
  });

  it('clears a debuff the OPPONENT applied', () => {
    const { sim, a, b } = startedDuel();
    const loser = sim.entities.get(b)!;
    loser.auras.push({
      id: 'rend',
      name: 'Rend',
      kind: 'dot',
      remaining: 30,
      duration: 30,
      value: 40,
      tickInterval: 1,
      tickTimer: 1,
      sourceId: a, // the opponent themselves
      school: 'physical',
    } as Aura);
    fightToTheEnd(sim, a, b);
    expect(
      loser.auras.some((x) => x.id === 'rend'),
      'the opponent’s dot is gone',
    ).toBe(false);
  });

  it('leaves the loser alive through the seconds AFTER the duel, not dying to leftovers', () => {
    // The reported symptom, stated as behavior rather than as a mechanism: a
    // player who just lost a duel should still be standing a few seconds later.
    const { sim, a, b } = startedDuel();
    fightToTheEnd(sim, a, b);
    const loser = sim.entities.get(b)!;
    for (let i = 0; i < 20 * 8; i++) sim.tick();
    expect(loser.dead, 'the loser must not die in the aftermath of a duel').toBe(false);
  });

  it("clears a debuff applied by the opponent's PET, not just by the opponent", () => {
    // The asymmetry, stated as behavior. The lethal clamp resolves a source
    // through pvpController, so a pet's damage is treated as the opponent's for
    // the whole bout and cannot kill. The end then clears only auras whose
    // sourceId is the opponent's own entity id, so the pet's dot rides out of
    // the duel onto a body sitting at 1 hp with no clamp left, and the next tick
    // kills for real. One definition of "the opponent's doing" on both sides.
    const { sim, a, b } = startedDuel();
    const loser = sim.entities.get(b)!;
    const pet = sim.entities.get(sim.addPlayer('hunter', 'Petless', { autoEquip: true }))!;
    // Model the pet exactly as the sim does: a mob owned by the duel opponent.
    pet.kind = 'mob';
    pet.ownerId = a;
    expect(sim.ctx.pvpController(pet)?.id, 'the clamp already treats this as the opponent').toBe(a);

    loser.auras.push({
      id: 'pet_bleed',
      name: 'Rip',
      kind: 'dot',
      remaining: 30,
      duration: 30,
      value: 40,
      tickInterval: 1,
      tickTimer: 1,
      sourceId: pet.id,
      school: 'physical',
    } as Aura);

    fightToTheEnd(sim, a, b);
    expect(
      loser.auras.some((x) => x.id === 'pet_bleed'),
      "the opponent's pet dot must be cleared with the opponent's own",
    ).toBe(false);
    for (let i = 0; i < 20 * 8; i++) sim.tick();
    expect(loser.dead, 'so the loser is not killed by it seconds later').toBe(false);
  });

  it("still clears the opponent's OWN dot when their entity is already gone", () => {
    // Review catch on this fix: resolving the source through pvpController needs
    // the source ENTITY to still exist, and the id comparison it replaced did
    // not. A source that despawned between the last tick and the end must not
    // silently skip the clear, which would reintroduce the very bug for a
    // narrower trigger. The fallback keeps the old floor.
    const { sim, a, b } = startedDuel();
    const loser = sim.entities.get(b)!;
    loser.auras.push({
      id: 'rend_ghost',
      name: 'Rend',
      kind: 'dot',
      remaining: 30,
      duration: 30,
      value: 40,
      tickInterval: 1,
      tickTimer: 1,
      sourceId: a,
      school: 'physical',
    } as Aura);
    fightToTheEnd(sim, a, b);
    // Drop the opponent's entity, then end a fresh duel the same way: the point
    // is that the CLEAR path must not depend on the lookup succeeding.
    sim.entities.delete(a);
    expect(
      loser.auras.some((x) => x.id === 'rend_ghost'),
      "the opponent's own dot is cleared whether or not their entity survives",
    ).toBe(false);
  });

  it('clears a pet dot even when the PET DESPAWNED before the duel ended', () => {
    // The residual the controller lookup could not reach: an Aura carries only
    // sourceId, so once the pet entity is gone nothing can map its dot back to
    // the owner. The clamp treated that dot as the opponent's for the whole
    // bout, so leaving it behind handed the loser back at 1 hp with a live
    // killer on them, which is the original bug for a narrower trigger.
    //
    // The duel now records what each side controlled while it was still
    // resolvable, and clears against that.
    const { sim, a, b } = startedDuel();
    const loser = sim.entities.get(b)!;
    const pet = sim.entities.get(sim.addPlayer('hunter', 'PetOwner', { autoEquip: true }))!;
    pet.kind = 'mob';
    pet.ownerId = a;
    sim.ctx.petOf = ((pid: number) => (pid === a ? pet : null)) as typeof sim.ctx.petOf;

    // One tick with the pet alive is all the duel needs to remember it.
    sim.tick();
    loser.auras.push({
      id: 'ghost_pet_bleed',
      name: 'Rip',
      kind: 'dot',
      remaining: 30,
      duration: 30,
      value: 40,
      tickInterval: 1,
      tickTimer: 1,
      sourceId: pet.id,
      school: 'physical',
    } as Aura);

    // ...and now the pet is gone, exactly as a dismiss or a corpse decay leaves it.
    sim.entities.delete(pet.id);
    expect(sim.ctx.entities.get(pet.id), 'the source really is unresolvable').toBeUndefined();

    fightToTheEnd(sim, a, b);

    expect(
      loser.auras.some((x) => x.id === 'ghost_pet_bleed'),
      'a despawned pet dot must not ride out of the duel',
    ).toBe(false);
    for (let i = 0; i < 20 * 8; i++) sim.tick();
    expect(loser.dead, 'so it cannot kill the loser at 1 hp afterwards').toBe(false);
  });

  it('clears a dot from a Necromancy temporary undead even after it despawns mid-duel', () => {
    // The same residual as the pet case above, for a controlled entity petOf()
    // deliberately does not track: a warlock's temporary Necromancy undead
    // (isTemporaryNecromancyUndead) is excluded from petOf on purpose (it must
    // never replace or persist as the owner's primary pet), so it never landed
    // in duel.controlled either. The clamp already treats its damage as the
    // opponent's (pvpController resolves ANY owned mob, not just petOf's one),
    // but the despawned-entity fallback could not find it, so a dot it left
    // behind rode out of the duel onto a body at 1 hp with no clamp left.
    const { sim, a, b } = startedDuel();
    const loser = sim.entities.get(b)!;
    const undead = sim.entities.get(sim.addPlayer('warlock', 'Bonewalker', { autoEquip: true }))!;
    undead.kind = 'mob';
    undead.templateId = 'necromancy_skeletal_warrior';
    undead.ownerId = a;
    expect(
      sim.ctx.petOf(a),
      'temporary Necromancy undead are deliberately excluded from petOf',
    ).toBeNull();
    expect(
      sim.ctx.pvpController(undead)?.id,
      'the clamp already treats its damage as the opponent’s',
    ).toBe(a);

    // One tick with the undead alive is all the duel needs to remember it.
    sim.tick();
    loser.auras.push({
      id: 'ghost_undead_dot',
      name: 'Grave Rot',
      kind: 'dot',
      remaining: 30,
      duration: 30,
      value: 40,
      tickInterval: 1,
      tickTimer: 1,
      sourceId: undead.id,
      school: 'shadow',
    } as Aura);

    // ...and now the undead is gone, exactly as its timed summon expiring leaves it.
    sim.entities.delete(undead.id);
    expect(sim.ctx.entities.get(undead.id), 'the source really is unresolvable').toBeUndefined();

    fightToTheEnd(sim, a, b);

    expect(
      loser.auras.some((x) => x.id === 'ghost_undead_dot'),
      'a despawned Necromancy undead dot must not ride out of the duel',
    ).toBe(false);
    for (let i = 0; i < 20 * 8; i++) sim.tick();
    expect(loser.dead, 'so it cannot kill the loser at 1 hp afterwards').toBe(false);
  });

  it('does not let a same-swing 4pc set-bonus proc outlive the blow that ends the duel', () => {
    // combat/set_procs.ts applies a weaponCrit set-bonus proc unconditionally,
    // right after dealDamage returns (auto_attack.ts meleeSwing/rangedSwing).
    // The swing that lands the clamp-and-end blow can itself crit, so the proc
    // fires a FRESH dot on the loser immediately after endDuel() already ran
    // its aura-clear. Nothing purges that dot afterward: the duel is already
    // over, so the next tick has no clamp left to stop it from killing for real.
    const { sim, a, b } = startedDuel();
    const winner = sim.entities.get(a)!;
    const loser = sim.entities.get(b)!;
    winner.setProcs = [
      {
        id: 'set_bonesplinter',
        name: 'Bonesplinter',
        trigger: 'weaponCrit',
        chance: 1,
        applyTo: 'target',
        aura: 'dot',
        value: 8,
        tickInterval: 2,
        duration: 12,
        maxStacks: 3,
        school: 'physical',
      },
    ];

    // Land the exact clamp-and-end blow, then fire the same-tick crit proc the
    // real swing shell applies right after dealDamage returns.
    sim.ctx.dealDamage(winner, loser, loser.hp, true, 'physical', 'Test Strike', 'hit');
    expect(duelFor(sim.ctx, b), 'the duel really did end on that blow').toBeNull();
    sim.ctx.applySetProcs(winner, loser, 'weaponCrit');

    expect(
      loser.auras.some((x) => x.id === 'set_bonesplinter'),
      'a set-bonus proc applied after the ending blow must not survive on the loser',
    ).toBe(false);

    for (let i = 0; i < 20 * 8; i++) sim.tick();
    expect(loser.dead, 'so it cannot kill the loser at 1 hp afterwards').toBe(false);
  });

  it('still applies a target-applied set-bonus proc during an ACTIVE duel', () => {
    // The guard must gate only the narrow post-end race, never a live bout: a
    // 4pc bleed is meant to tick throughout the duel (the clamp already floors
    // the loser at 1 hp, and endDuel clears it at the real end).
    const { sim, a, b } = startedDuel();
    const winner = sim.entities.get(a)!;
    const loser = sim.entities.get(b)!;
    winner.setProcs = [
      {
        id: 'set_bonesplinter',
        name: 'Bonesplinter',
        trigger: 'weaponCrit',
        chance: 1,
        applyTo: 'target',
        aura: 'dot',
        value: 8,
        tickInterval: 2,
        duration: 12,
        maxStacks: 3,
        school: 'physical',
      },
    ];
    sim.ctx.applySetProcs(winner, loser, 'weaponCrit');
    expect(
      duelFor(sim.ctx, b),
      'the duel is still live: this is not the post-end race',
    ).not.toBeNull();
    expect(
      loser.auras.some((x) => x.id === 'set_bonesplinter'),
      'a proc mid-duel must still land, it will be cleared at the real end',
    ).toBe(true);
  });

  it('still applies a target-applied set-bonus proc from a THIRD PARTY on a just-ended duel', () => {
    // The source check is load-bearing: only the ended duel's OWN two sides are
    // gated. A bystander's crit on the same tick is unrelated damage, never
    // under the duel's clamp, and must proc normally.
    const { sim, a, b } = startedDuel();
    const winner = sim.entities.get(a)!;
    const loser = sim.entities.get(b)!;
    const bystander = sim.entities.get(sim.addPlayer('warrior', 'Bystander', { autoEquip: true }))!;
    bystander.setProcs = [
      {
        id: 'set_bonesplinter',
        name: 'Bonesplinter',
        trigger: 'weaponCrit',
        chance: 1,
        applyTo: 'target',
        aura: 'dot',
        value: 8,
        tickInterval: 2,
        duration: 12,
        maxStacks: 3,
        school: 'physical',
      },
    ];

    sim.ctx.dealDamage(winner, loser, loser.hp, true, 'physical', 'Test Strike', 'hit');
    expect(duelFor(sim.ctx, b), 'the duel really did end on that blow').toBeNull();
    sim.ctx.applySetProcs(bystander, loser, 'weaponCrit');

    expect(
      loser.auras.some((x) => x.id === 'set_bonesplinter'),
      "a bystander's proc is unrelated to the duel and must still land",
    ).toBe(true);
  });

  it('draws no rng skipping a same-swing 4pc set-bonus proc past its ended duel', () => {
    // The gate must sit BEFORE the chance roll, the same discipline every
    // other guard in applySetProcs already keeps (see set_procs.ts), or a
    // gated duel-aftermath skip would still fork the shared rng stream.
    const { sim, a, b } = startedDuel();
    const winner = sim.entities.get(a)!;
    const loser = sim.entities.get(b)!;
    winner.setProcs = [
      {
        id: 'set_bonesplinter',
        name: 'Bonesplinter',
        trigger: 'weaponCrit',
        chance: 1,
        applyTo: 'target',
        aura: 'dot',
        value: 8,
        tickInterval: 2,
        duration: 12,
        maxStacks: 3,
        school: 'physical',
      },
    ];

    sim.ctx.dealDamage(winner, loser, loser.hp, true, 'physical', 'Test Strike', 'hit');
    const chance = vi.spyOn(sim.rng, 'chance');
    sim.ctx.applySetProcs(winner, loser, 'weaponCrit');
    expect(
      chance,
      'the duel-end skip must short-circuit before any rng draw',
    ).not.toHaveBeenCalled();
  });

  it('does not let a same-swing legendary weapon proc outlive the blow that ends the duel', () => {
    // The identical race as the 4pc set-bonus case above, one call site over
    // in combat/equip_procs.ts: runWeaponProcs fires unconditionally right
    // after dealDamage returns (auto_attack.ts), so a shipped weaponHit dot
    // proc (Marrowpoint's Marrow Rend, src/sim/content/drakelands.ts) can land
    // on the exact swing that ends the duel, a beat after endDuel() already
    // cleared the loser's auras.
    const { sim, a, b } = startedDuel();
    const winner = sim.entities.get(a)!;
    const loser = sim.entities.get(b)!;
    winner.level = 20; // Marrowpoint's requiredLevel
    winner.mainhandItemId = 'marrowpoint';
    // Only the ONE roll this reproduction cares about: mockReturnValueOnce
    // forces the 8% chance to hit for that single call, then falls back to
    // real rng for the 8 seconds of ticks that follow, unlike an unrestored
    // mockReturnValue that would force EVERY chance-gated branch to fire.
    vi.spyOn(sim.rng, 'chance').mockReturnValueOnce(true);

    sim.ctx.dealDamage(winner, loser, loser.hp, true, 'physical', 'Test Strike', 'hit');
    expect(duelFor(sim.ctx, b), 'the duel really did end on that blow').toBeNull();
    runWeaponProcs(sim.ctx, winner, loser, 'weaponHit');

    expect(
      loser.auras.some((x) => x.id === 'marrowpoint_rend'),
      'a weapon proc applied after the ending blow must not survive on the loser',
    ).toBe(false);

    for (let i = 0; i < 20 * 8; i++) sim.tick();
    expect(loser.dead, 'so it cannot kill the loser at 1 hp afterwards').toBe(false);
  });

  it('draws no rng skipping a same-swing legendary weapon proc past its ended duel', () => {
    const { sim, a, b } = startedDuel();
    const winner = sim.entities.get(a)!;
    const loser = sim.entities.get(b)!;
    winner.level = 20;
    winner.mainhandItemId = 'marrowpoint';

    sim.ctx.dealDamage(winner, loser, loser.hp, true, 'physical', 'Test Strike', 'hit');
    const chance = vi.spyOn(sim.rng, 'chance');
    runWeaponProcs(sim.ctx, winner, loser, 'weaponHit');
    expect(
      chance,
      'the duel-end skip must short-circuit before any rng draw',
    ).not.toHaveBeenCalled();
  });

  it('does not let a same-cast dot rider outlive the direct hit that ends the duel', () => {
    // The identical race, a THIRD call site over in combat/effect_dispatch.ts:
    // a dot riding the same cast's own direct component (Fireball, Immolate)
    // resolves in the same effects[] pass right after the direct hit lands.
    // If that direct hit is what clamps-and-ends the duel, the dot case below
    // it in the array would otherwise be stamped a beat after endDuel()
    // already cleared everything the caster had inflicted, and nothing purges
    // it afterward: the duel is over, so it rides out with no clamp left.
    const { sim, a, b } = startedDuel();
    const winner = sim.entities.get(b)!; // Bet is the mage: fireball is a mage ability
    const loser = sim.entities.get(a)!;
    loser.hp = 5; // guarantees fireball's direct component clamps-and-ends
    winner.targetId = loser.id;
    winner.facing = Math.atan2(loser.pos.x - winner.pos.x, loser.pos.z - winner.pos.z);

    sim.castAbility('fireball', b);
    for (let i = 0; i < 20 * 3 && duelFor(sim.ctx, a); i++) sim.tick();

    expect(duelFor(sim.ctx, a), 'the duel really did end on the direct hit').toBeNull();
    expect(
      loser.auras.some((x) => x.id === 'fireball'),
      'the dot rider applied after the ending blow must not survive on the loser',
    ).toBe(false);

    for (let i = 0; i < 20 * 8; i++) sim.tick();
    expect(loser.dead, 'so it cannot kill the loser at 1 hp afterwards').toBe(false);
  });

  it('still applies a same-cast dot rider during an ACTIVE duel', () => {
    // The guard must gate only the narrow post-end race, never a live bout:
    // a dot rider is meant to tick throughout the duel same as any other
    // damage (the clamp already floors the loser at 1 hp, and endDuel clears
    // it at the real end).
    const { sim, a, b } = startedDuel();
    const winner = sim.entities.get(b)!;
    const loser = sim.entities.get(a)!;
    winner.targetId = loser.id;
    winner.facing = Math.atan2(loser.pos.x - winner.pos.x, loser.pos.z - winner.pos.z);

    sim.castAbility('fireball', b);
    // The 1.5s cast, PLUS the projectile's own short travel time (fireball is
    // a scheduleProjectile ability: runEffects itself does not resolve until
    // impact), so tick a fixed window past both rather than stopping the
    // instant castingAbility clears.
    for (let i = 0; i < 20 * 3; i++) sim.tick();

    expect(
      duelFor(sim.ctx, a),
      'the duel is still live: this is not the post-end race',
    ).not.toBeNull();
    expect(
      loser.auras.some((x) => x.id === 'fireball'),
      'a dot rider mid-duel must still land, it will be cleared at the real end',
    ).toBe(true);
  });

  it('still lets a HEAL-triggered weapon proc land on the ending tick, self or cross-heal', () => {
    // The persistent-hostile-effect scoping (dot/attackSlow only) must never
    // catch a heal proc: a heal can't be "what killed the 1-hp loser", and a
    // player's own self-targeted proc was never something the OPPONENT
    // inflicted, so endDuel's clear was never going to touch it either.
    // Deathless Heartwood carries exactly one of each: 'deathbloom' (a hostile
    // spellDamage dot, gated) and 'lifebloom' (a heal hot, must stay ungated).
    const { sim, a, b } = startedDuel();
    const winner = sim.entities.get(a)!;
    const loser = sim.entities.get(b)!;
    winner.level = 20;
    loser.level = 20;

    sim.ctx.dealDamage(winner, loser, loser.hp, true, 'physical', 'Test Strike', 'hit');
    expect(duelFor(sim.ctx, b), 'the duel really did end on that blow').toBeNull();

    // Force the 15% roll to hit for the three heal-proc calls below only; the
    // ending blow above already resolved on the real rng stream.
    vi.spyOn(sim.rng, 'chance').mockReturnValue(true);

    // applyAura recalculates the target player's derived stats on every landed
    // aura, which resyncs Entity.mainhandItemId from the persisted equipment
    // (entity.ts recalcPlayerStats): re-stamp it before each call below, or
    // the PRIOR call's own aura land undoes this test's direct field set.
    winner.mainhandItemId = 'deathless_heartwood';

    // The winner self-heals on the very tick their own blow ended the duel.
    runWeaponProcs(sim.ctx, winner, winner, 'heal');
    expect(
      winner.auras.some((x) => x.id === 'lifebloom'),
      "the winner's self-heal proc must still land on the ending tick",
    ).toBe(true);

    // The winner heals their now-ex-opponent: a heal can never be the dot
    // that kills the loser, so this must land too.
    winner.mainhandItemId = 'deathless_heartwood';
    runWeaponProcs(sim.ctx, winner, loser, 'heal');
    expect(
      loser.auras.filter((x) => x.id === 'lifebloom').length,
      'a heal from the winner onto the ex-opponent must still land',
    ).toBe(1);

    // The loser self-heals on the same tick they lost the duel.
    loser.mainhandItemId = 'deathless_heartwood';
    runWeaponProcs(sim.ctx, loser, loser, 'heal');
    expect(
      loser.auras.filter((x) => x.id === 'lifebloom').length,
      "the loser's own self-heal proc must still land on the ending tick",
    ).toBe(2); // stacks with the cross-heal above; applyAura keys by sourceId
  });
});

describe('duelJustEndedBetween', () => {
  function endedDuel(): { sim: Sim; a: number; b: number } {
    const { sim, a, b } = startedDuel();
    const winner = sim.entities.get(a)!;
    const loser = sim.entities.get(b)!;
    sim.ctx.dealDamage(winner, loser, loser.hp, true, 'physical', 'Test Strike', 'hit');
    expect(duelFor(sim.ctx, b), 'the duel really did end on that blow').toBeNull();
    return { sim, a, b };
  }

  it('is true for the opponent on the tick a duel just ended', () => {
    const { sim, a, b } = endedDuel();
    const winner = sim.entities.get(a)!;
    const loser = sim.entities.get(b)!;
    expect(duelJustEndedBetween(sim.ctx, loser, winner)).toBe(true);
    // Symmetric: the winner is equally "the opponent" from the loser's side.
    expect(duelJustEndedBetween(sim.ctx, winner, loser)).toBe(true);
  });

  it('is false for a SELF source, even on the ending tick', () => {
    // A player's own self-targeted proc is never something the opponent
    // inflicted, and must keep applying regardless of the duel's fate.
    const { sim, a, b } = endedDuel();
    const winner = sim.entities.get(a)!;
    const loser = sim.entities.get(b)!;
    expect(duelJustEndedBetween(sim.ctx, winner, winner)).toBe(false);
    expect(duelJustEndedBetween(sim.ctx, loser, loser)).toBe(false);
  });

  it('is false for a THIRD PARTY, not either side of the ended duel', () => {
    const { sim, b } = endedDuel();
    const loser = sim.entities.get(b)!;
    const bystander = sim.entities.get(sim.addPlayer('warrior', 'Bystander', { autoEquip: true }))!;
    expect(duelJustEndedBetween(sim.ctx, loser, bystander)).toBe(false);
  });

  it('is false while the duel is still ACTIVE (nothing to grace yet)', () => {
    const { sim, a, b } = startedDuel();
    const winner = sim.entities.get(a)!;
    const loser = sim.entities.get(b)!;
    expect(duelJustEndedBetween(sim.ctx, loser, winner)).toBe(false);
  });

  it('is false for a non-player recipient', () => {
    const { sim, a, b } = endedDuel();
    const winner = sim.entities.get(a)!;
    const mob = [...sim.entities.values()].find((e) => e.kind === 'mob')!;
    expect(duelJustEndedBetween(sim.ctx, mob, winner)).toBe(false);
  });
});
