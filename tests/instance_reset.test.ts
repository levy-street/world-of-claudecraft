// Manual instance reset: wipe every dungeon instance bound to your party/solo key
// without reforming the group, but only once everyone has stepped out (#569).
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}
function claimedInstance(sim: Sim) {
  return (sim as unknown as { instances: { partyKey: unknown }[] }).instances.find(
    (i) => i.partyKey !== null,
  );
}

describe('manual instance reset', () => {
  it('frees your claimed instances once you have left them', () => {
    const sim = makeSim();
    sim.enterDungeon('hollow_crypt');
    expect(claimedInstance(sim)).toBeTruthy();

    sim.leaveDungeon(); // teleports you back outside the instance bounds
    expect(claimedInstance(sim)).toBeTruthy(); // still claimed until reset/timeout

    sim.resetInstances();
    expect(claimedInstance(sim)).toBeFalsy();
  });

  it('refuses to reset while a player is still inside', () => {
    const sim = makeSim();
    sim.enterDungeon('hollow_crypt'); // player is inside the instance
    sim.resetInstances();
    expect(claimedInstance(sim)).toBeTruthy();
  });
});
