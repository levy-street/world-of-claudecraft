import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass, SimEvent } from '../src/sim/types';

// Weapon imbues (shaman Stonebound/Galeheart, rogue instant/deadly
// poison, paladin seal) are a single weapon-enchant slot: classic allows exactly
// one active at a time. The deterministic sim must never carry two `imbue` auras,
// because meleeSwing sums every one of them (H2-1). These tests pin that a fresh
// imbue replaces any other, so the per-swing bonus can never stack.

function makePlayer(cls: PlayerClass, level: number): { sim: Sim; p: Entity } {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer(cls, 'Imbuer');
  sim.setPlayerLevel(level, pid);
  if (cls === 'shaman' && !sim.setSpec('enhancement', pid)) throw new Error('no enhancement spec');
  sim.tick();
  const p = sim.entities.get(pid);
  if (!p) throw new Error('missing imbue test player');
  return { sim, p };
}

// Cast an instant imbue and let it resolve, clearing the GCD/cost gate first so a
// rapid sequence of casts all land (mirrors how a player chains them in practice).
// Returns the events drained by the resolving tick so callers can assert on emits.
function cast(sim: Sim, p: Entity, ability: string): SimEvent[] {
  p.gcdRemaining = 0;
  p.cooldowns.delete(ability);
  p.resource = p.maxResource;
  sim.castAbility(ability, p.id);
  return sim.tick();
}

const imbues = (p: Entity) => p.auras.filter((a) => a.kind === 'imbue');

describe('weapon imbues are a mutually-exclusive single slot (H2-1)', () => {
  it('enhancement shaman cannot stack Stonebound + Galeheart', () => {
    const { sim, p } = makePlayer('shaman', 16);
    cast(sim, p, 'rockbiter_weapon');
    cast(sim, p, 'galeheart_weapon');
    // exactly one imbue survives: the most recently applied
    expect(imbues(p)).toHaveLength(1);
    expect(imbues(p)[0].id).toBe('galeheart_weapon');
  });

  it('rogue cannot stack instant + deadly poison', () => {
    const { sim, p } = makePlayer('rogue', 20);
    cast(sim, p, 'instant_poison');
    cast(sim, p, 'deadly_poison');
    expect(imbues(p)).toHaveLength(1);
    expect(imbues(p)[0].id).toBe('deadly_poison');
    // and the surviving bonus is the single enchant's value, never the +22 sum
    expect(imbues(p)[0].value).toBe(14);
  });

  it('emits an aura-lost event for the displaced imbue so the old buff icon clears', () => {
    const { sim, p } = makePlayer('shaman', 16);
    cast(sim, p, 'rockbiter_weapon');
    const events = cast(sim, p, 'galeheart_weapon');
    // the replaced imbue is announced lost (this is what clears its client buff
    // icon); the fade also carries its attribution since the parse fidelity
    // widening, so match on the load-bearing fields rather than deep equality
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'aura',
        targetId: p.id,
        name: 'Stonebound Weapon',
        gained: false,
        auraKind: 'imbue',
      }),
    );
    // and the new imbue is announced gained
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'aura',
        targetId: p.id,
        name: 'Galeheart Weapon',
        gained: true,
      }),
    );
  });

  it('re-casting the same imbue refreshes in place (still one aura)', () => {
    const { sim, p } = makePlayer('shaman', 16);
    cast(sim, p, 'rockbiter_weapon');
    const dur = imbues(p)[0].remaining;
    // tick a little so the refresh is observable, then re-cast the same one
    for (let i = 0; i < 10; i++) sim.tick();
    expect(imbues(p)[0].remaining).toBeLessThan(dur);
    cast(sim, p, 'rockbiter_weapon');
    expect(imbues(p)).toHaveLength(1);
    expect(imbues(p)[0].id).toBe('rockbiter_weapon');
    expect(imbues(p)[0].remaining).toBe(dur); // refreshed to full
  });

  it('keeps the retired Paladin seal out of the authoritative imbue slot', () => {
    const { sim, p } = makePlayer('paladin', 4);
    expect(sim.resolvedAbility('seal_of_righteousness')).toBeNull();
    cast(sim, p, 'seal_of_righteousness');
    expect(imbues(p)).toHaveLength(0);
  });

  it('is deterministic: same seed yields the same single-imbue result', () => {
    const run = () => {
      const { sim, p } = makePlayer('shaman', 16);
      cast(sim, p, 'rockbiter_weapon');
      cast(sim, p, 'galeheart_weapon');
      return imbues(p).map((a) => ({ id: a.id, value: a.value }));
    };
    expect(run()).toEqual(run());
    expect(run()).toHaveLength(1);
  });
});
