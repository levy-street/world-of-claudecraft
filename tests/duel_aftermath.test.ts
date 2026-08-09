import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { duelFor } from '../src/sim/social/duel';
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
});
