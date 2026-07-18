// DEV-ONLY /dev cascade playtest scenario (ALLOW_DEV_COMMANDS). Verifies the command
// is dev-gated, sets up the controlled scenario (non-offensive dummy + a raid of allies
// at known distances, one beyond 15 yd, at reduced health), starts the metrics session,
// and emits the per-cast readout. src/sim/dev/cascade_playtest.ts.
import { describe, expect, it } from 'vitest';
import { CASCADE_SCENARIO } from '../src/sim/dev/cascade_playtest';
import { Sim } from '../src/sim/sim';
import { dist2d, type SimEvent } from '../src/sim/types';

function devMage(devCommands: boolean) {
  const sim = new Sim({ seed: 41, playerClass: 'mage', autoEquip: true, devCommands });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('arcane')).toBe(true);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

describe('/dev cascade scenario', () => {
  it('is a no-op without dev commands', () => {
    const { sim, p } = devMage(false);
    const before = sim.entities.size;
    sim.chat('/dev cascade', p.id);
    expect(sim.entities.size).toBe(before); // nothing spawned
    expect(p.cascadeDevStats).toBeUndefined(); // no session
  });

  it('spawns a non-offensive dummy plus a raid of allies at known distances', () => {
    const { sim, p } = devMage(true);
    sim.chat('/dev cascade', p.id);

    // A hostile training dummy (aggroRadius 0 / moveSpeed 0 => never chases the healer).
    const dummy = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'training_dummy',
    );
    expect(dummy).toBeTruthy();
    expect(dummy?.hostile).toBe(true);

    // The mage now leads a RAID: itself + a center + one ally per configured distance.
    const party = sim.partyInfo!;
    expect(party.raid).toBe(true);
    expect(party.members.length).toBe(2 + CASCADE_SCENARIO.allyDistances.length);

    // The metrics session is armed.
    expect(p.cascadeDevStats).toBeDefined();
    const centerId = p.cascadeDevStats!.centerId;
    const center = sim.entities.get(centerId)!;

    // Each configured distance from the center is realized, and one ally is BEYOND 15 yd.
    const allyDists = party.members
      .filter((m) => m.pid !== p.id && m.pid !== centerId)
      .map((m) => dist2d(sim.entities.get(m.pid)!.pos, center.pos));
    for (const d of CASCADE_SCENARIO.allyDistances) {
      expect(allyDists.some((ad) => Math.abs(ad - d) < 0.6)).toBe(true);
    }
    expect(allyDists.some((ad) => ad > CASCADE_SCENARIO.radius)).toBe(true);

    // Allies are LEVEL 20 (not level-1 with a tiny pool), at reduced health, and have
    // out-of-combat regen frozen (a zero-value "food"), so only the Echo healing moves
    // their bars.
    for (const m of party.members) {
      if (m.pid === p.id) continue;
      const e = sim.entities.get(m.pid)!;
      expect(e.level).toBe(20);
      expect(e.hp).toBeLessThan(e.maxHp);
      expect(e.eating?.hpPer2s).toBe(0); // regen frozen, heals nothing
    }
  });

  it('logs the per-cast readout and records the initial heal', () => {
    const { sim, p } = devMage(true);
    sim.chat('/dev cascade', p.id);
    const centerId = p.cascadeDevStats!.centerId;

    const logs: string[] = [];
    sim.targetEntity(centerId);
    sim.castAbility('temporal_cascade');
    for (let i = 0; i < 60; i++) {
      for (const ev of sim.tick() as SimEvent[]) {
        const anyEv = ev as unknown as { text?: string };
        if (ev.type === 'log' && typeof anyEv.text === 'string') logs.push(anyEv.text);
      }
    }
    const cascade = logs.filter((l) => l.startsWith('[cascade]'));
    expect(cascade.some((l) => l.includes('cast selected'))).toBe(true);
    expect(cascade.some((l) => l.includes('totals'))).toBe(true);
    // At least one target (the hurt center) took a recorded initial heal.
    expect(p.cascadeDevStats!.initialHeal).toBeGreaterThan(0);
  });
});
