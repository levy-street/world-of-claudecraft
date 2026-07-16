import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const HEROIC_ADD_IDS = [
  'nythraxis_heroic_warrior_add',
  'nythraxis_heroic_priest_add',
  'nythraxis_heroic_rogue_add',
];

function heroicBoss(sim: Sim, pid: number): { boss: Entity; st: NonNullable<Entity['nythraxis']> } {
  sim.chat('/dev raid heroic', pid);
  sim.chat('/dev god', pid); // survive the Deathless Rage nuke so the encounter runs on
  const boss = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === 'nythraxis_scourge_of_thornpeak',
  ) as Entity;
  boss.inCombat = true;
  boss.aggroTargetId = pid;
  boss.threat.set(pid, 1000);
  sim.tick(); // spin up encounter state
  return { boss, st: boss.nythraxis! };
}

// Drop the boss into phase 2 with an imminent, uncontested Deathless Rage, then
// tick until it lands and the summon channel resolves.
function forcePillarCast(sim: Sim, st: NonNullable<Entity['nythraxis']>): void {
  st.phase = 2;
  st.deathlessTimer = 0;
  st.soulRendTimer = 100;
  st.soulRendMarks = [];
  st.soulRendLockout = 0;
  for (let i = 0; i < 20 * 16; i++) sim.tick();
}

describe('heroic Nythraxis raises his court on the phase-2 pillar cast', () => {
  const countHeroicAdds = (sim: Sim) =>
    [...sim.entities.values()].filter(
      (e) => e.kind === 'mob' && !e.dead && HEROIC_ADD_IDS.includes(e.templateId),
    ).length;

  it('summons exactly one court after an uninterrupted Deathless Rage, not on engage', () => {
    const sim = new Sim({ seed: 4, playerClass: 'warrior', autoEquip: true, devCommands: true });
    sim.setPlayerLevel(20);
    const { st } = heroicBoss(sim, sim.playerId);
    expect(countHeroicAdds(sim)).toBe(0); // phase 1: no court
    forcePillarCast(sim, st);
    expect(countHeroicAdds(sim)).toBe(3); // Aldren + Malric + Voss, exactly once
  });

  it('does NOT stack a second court while the first is still alive', () => {
    const sim = new Sim({ seed: 4, playerClass: 'warrior', autoEquip: true, devCommands: true });
    sim.setPlayerLevel(20);
    const { st } = heroicBoss(sim, sim.playerId);
    forcePillarCast(sim, st);
    expect(countHeroicAdds(sim)).toBe(3);
    // A second Deathless Rage with the court still up must not summon a fresh set.
    forcePillarCast(sim, st);
    expect(countHeroicAdds(sim)).toBe(3);
  });

  it('re-summons the court on the next pillar once the previous court has fallen', () => {
    const sim = new Sim({ seed: 4, playerClass: 'warrior', autoEquip: true, devCommands: true });
    sim.setPlayerLevel(20);
    const { st } = heroicBoss(sim, sim.playerId);
    forcePillarCast(sim, st);
    expect(countHeroicAdds(sim)).toBe(3);
    // Kill the court, then the next pillar raises a fresh one.
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && HEROIC_ADD_IDS.includes(e.templateId)) e.dead = true;
    }
    forcePillarCast(sim, st);
    expect(countHeroicAdds(sim)).toBe(3);
  });
});
