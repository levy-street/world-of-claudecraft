import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// Maintainer report (Twin Gavels): both stuns spent, then the second charge
// waited a WHOLE extra cooldown behind the first. Charge-limited abilities now
// run one recharge timer PER SPENT CHARGE in parallel: each charge comes back
// its own cooldown after the moment IT was spent, not queued behind its twin.
// Also pinned here: player stuns are exempt from PvP diminishing returns
// (fear/polymorph/root keep theirs).

function setup(): { sim: Sim; p: Entity; mob: Entity } {
  const sim = new Sim({ seed: 7, playerClass: 'paladin', autoEquip: true });
  sim.setPlayerLevel(10);
  expect(sim.applyTalents({ spec: null, rows: { 8: 'pal_r8_fist_of_justice' } })).toBe(true);
  const p = sim.player;
  const mob = createMob(20_000, MOBS.forest_wolf, 8, {
    x: p.pos.x + 3,
    y: p.pos.y,
    z: p.pos.z,
  });
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.maxHp = 500_000;
  mob.hp = mob.maxHp;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  p.resource = p.maxResource;
  return { sim, p, mob };
}

function tickSeconds(sim: Sim, p: Entity, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 20); i++) {
    sim.tick();
    p.resource = p.maxResource;
  }
}

describe('parallel per-charge recharge (Twin Gavels)', () => {
  it('each spent charge returns its own cooldown after ITS spend', () => {
    const { sim, p } = setup();
    sim.castAbility('hammer_of_justice');
    sim.tick();
    expect(p.abilityCharges?.hammer_of_justice?.charges).toBe(1);

    tickSeconds(sim, p, 5); // stagger the second spend 5s behind the first
    p.gcdRemaining = 0;
    sim.castAbility('hammer_of_justice');
    sim.tick();
    expect(p.abilityCharges?.hammer_of_justice?.charges).toBe(0);

    // t ~ 60.5s after the first spend: the first charge is back.
    tickSeconds(sim, p, 56);
    expect(p.abilityCharges?.hammer_of_justice?.charges).toBe(1);

    // t ~ 65.5s: the SECOND charge is back too (5s after the first, its own
    // 60s cooldown from its own spend), NOT queued to t ~ 120s.
    tickSeconds(sim, p, 5);
    expect(p.abilityCharges?.hammer_of_justice?.charges).toBe(2);
  });

  it('player stuns are exempt from PvP diminishing returns', () => {
    const sim = new Sim({ seed: 7, playerClass: 'paladin', autoEquip: true });
    const anySim = sim as unknown as {
      diminishedCrowdControlDuration(
        source: Entity,
        target: Entity,
        category: string,
        duration: number,
      ): number | null;
      isHostileTo(a: Entity, b: Entity): boolean;
    };
    const source = sim.player;
    const target = { ...sim.player, id: 999, kind: 'player', ccDr: new Map() } as Entity;
    const hostile = anySim.isHostileTo.bind(sim);
    (sim as unknown as { isHostileTo(a: Entity, b: Entity): boolean }).isHostileTo = (a, b) =>
      (a.id === source.id && b.id === 999) || hostile(a, b);
    // Repeated stuns keep FULL duration (no 1/2, 1/4, immune ladder).
    for (let i = 0; i < 4; i++) {
      expect(anySim.diminishedCrowdControlDuration(source, target, 'controlledStun', 3)).toBe(3);
    }
    // Fear keeps its ladder: the second application is shorter than the first.
    const first = anySim.diminishedCrowdControlDuration(source, target, 'fear', 8);
    const second = anySim.diminishedCrowdControlDuration(source, target, 'fear', 8);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect((second as number) < (first as number)).toBe(true);
  });
});
