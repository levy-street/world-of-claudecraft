// Cascada temporal REAL-THREAT check, kept SEPARATE from the functional validation
// (tests/chronomancy_cascade.test.ts). A tank bot holds an established threat lead on
// a real mob; the Chronomancer then heals a hurt ally that is on the mob's hate table.
// Healing generates threat on the HEALER (healingThreat), so this pins that the tank's
// lead still dominates: the mob never flips onto the healer, and the healer accrues
// only minor threat. docs/prd/mage-chronomancy.md.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function chronoMage() {
  const sim = new Sim({ seed: 41, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('arcane')).toBe(true);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function free(p: Entity): boolean {
  const q = p as unknown as { castingAbility: string | null; gcdRemaining: number };
  return q.castingAbility == null && q.gcdRemaining <= 1e-6;
}

describe('Cascada real threat: a tank lead holds through the Chronomancer heals', () => {
  it('the mob stays on the tank; healing only accrues minor threat on the healer', () => {
    const { sim, p } = chronoMage();
    const tankId = sim.addPlayer('warrior', 'Tank');
    const allyId = sim.addPlayer('warrior', 'Ally');
    const tank = sim.entities.get(tankId)!;
    const ally = sim.entities.get(allyId)!;
    tank.pos = { x: p.pos.x + 2, y: p.pos.y, z: p.pos.z };
    tank.maxHp = tank.hp = 1_000_000; // survives the mob's swings during the test
    ally.pos = { x: p.pos.x + 3, y: p.pos.y, z: p.pos.z };
    ally.maxHp = 100_000;
    ally.hp = 1_000; // hurt, so every heal lands and generates threat

    // A real hostile mob IN COMBAT with an established tank threat lead. The ally is
    // also on its hate table (it took a hit); the healer is not yet.
    const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
      x: p.pos.x + 6,
      y: p.pos.y,
      z: p.pos.z,
    });
    mob.hostile = true;
    mob.inCombat = true;
    const TANK_LEAD = 5_000;
    mob.threat.set(tankId, TANK_LEAD);
    mob.threat.set(allyId, 100);
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);

    // The Chronomancer heals the hurt ally repeatedly through the real cast path,
    // which routes each landed heal through healingThreat.
    for (let i = 0; i < 160; i++) {
      ally.hp = 1_000; // keep it hurt so each heal is fully effective
      if (free(p)) {
        sim.targetEntity(allyId);
        sim.castAbility('temporal_mend');
      }
      sim.tick();
    }

    const tankThreat = mob.threat.get(tankId) ?? 0;
    const healerThreat = mob.threat.get(p.id) ?? 0;
    // Healing DID put the healer on the hate table (the threat path fired)...
    expect(healerThreat).toBeGreaterThan(0);
    // ...but the tank's established lead still dominates.
    expect(tankThreat).toBeGreaterThan(healerThreat);
    // The mob's TOP-threat entity is still the tank (the healer never pulled it).
    let top = -1;
    let topThreat = Number.NEGATIVE_INFINITY;
    for (const [id, t] of mob.threat) {
      if (t > topThreat) {
        topThreat = t;
        top = id;
      }
    }
    expect(top).toBe(tankId);
  });
});
