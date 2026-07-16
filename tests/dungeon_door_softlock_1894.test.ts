// Regression coverage for issue #1894 ("Dungeon progression softlocks: doors
// not opening after room clear"). Two of the three reported softlocks are
// delve room-clear/door mechanics: The Drowned Litany's first-room exit and
// The Collapsed Reliquary's exit, both reportedly failing to open even though
// the room was actually cleared, with player reports blaming a dead
// groupmate's corpse sitting in/near the door trigger.
//
// These tests drive the REAL room-clear and door-open path (tryOpenDelveExitPortal
// / tickDelveModuleExit / advanceDelveModule in src/sim/delves/runs.ts) with a
// live party where one member is dead (a corpse) and parked exactly on the door
// trigger, to pin that a cleared room's door opens and a live party member can
// still walk through regardless of a dead groupmate's position.
import { describe, expect, it } from 'vitest';
import { DELVES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';

function makeParty(delveId: 'collapsed_reliquary' | 'drowned_litany', tier: 'normal' = 'normal') {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, noPlayer: true });
  const a = sim.addPlayer('warrior', 'DoorA');
  const b = sim.addPlayer('warrior', 'DoorB');
  sim.partyInvite(b, a);
  sim.partyAccept(b);
  const def = DELVES[delveId];
  const level = def.minLevel;
  for (const pid of [a, b]) {
    sim.setPlayerLevel(level, pid);
    const p = sim.entities.get(pid)!;
    p.pos.x = def.doorPos.x;
    p.pos.z = def.doorPos.z;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
  }
  sim.enterDelve(delveId, tier, a);
  return { sim, a, b };
}

function killAllMobs(sim: Sim, run: ReturnType<Sim['delveRunForPlayer']>) {
  for (const id of [...run!.mobIds]) {
    const mob = sim.entities.get(id);
    if (mob && !mob.dead) {
      (sim as any).dealDamage(sim.player, mob, mob.maxHp + 1, false, 'physical', null, 'hit', true);
    }
  }
}

describe('dungeon/delve door opens on room clear regardless of a dead groupmate (issue #1894)', () => {
  it('The Collapsed Reliquary: exit portal opens and a live player can advance with a dead groupmate parked on the door', () => {
    const { sim, a, b } = makeParty('collapsed_reliquary');
    const run = sim.delveRunForPlayer(a)!;
    run.modules = ['reliquary_bell_niche', 'reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    killAllMobs(sim, run);
    sim.tick();
    expect(run.exitPortalOpen).toBe(true);

    const exitId = run.objectIds.find((id) => run.objectState[id]?.kind === 'module_exit')!;
    const portal = sim.entities.get(exitId)!;

    // Kill player B (a groupmate's body) and park the corpse exactly on the
    // door trigger before player A tries to walk through.
    const pb = sim.entities.get(b)!;
    (sim as any).dealDamage(sim.player, pb, pb.maxHp + 10, false, 'physical', null, 'hit', true);
    pb.pos = { ...portal.pos };
    pb.prevPos = { ...portal.pos };

    const pa = sim.entities.get(a)!;
    pa.pos = { ...portal.pos };
    pa.prevPos = { ...portal.pos };
    sim.tick();

    expect(run.moduleIndex).toBe(1);
    expect(run.modules[run.moduleIndex]).toBe('reliquary_finale');
  });

  it('The Drowned Litany: first room (litany_sluice) door opens onto the second room (litany_ledger) with a dead groupmate on the door', () => {
    const { sim, a, b } = makeParty('drowned_litany');
    const run = sim.delveRunForPlayer(a)!;
    run.modules = ['litany_sluice', 'litany_ledger', 'litany_apse'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    killAllMobs(sim, run);

    const valveIds = run.objectIds.filter((id) => run.objectState[id]?.kind === 'sluice_valve');
    expect(valveIds.length).toBeGreaterThan(0);
    const pa = sim.entities.get(a)!;
    for (const valveId of valveIds) {
      const valve = sim.entities.get(valveId)!;
      pa.pos = { ...valve.pos };
      pa.prevPos = { ...valve.pos };
      sim.tick();
    }
    expect(run.exitPortalOpen).toBe(true);

    const exitId = run.objectIds.find((id) => run.objectState[id]?.kind === 'module_exit')!;
    const portal = sim.entities.get(exitId)!;

    const pb = sim.entities.get(b)!;
    (sim as any).dealDamage(sim.player, pb, pb.maxHp + 10, false, 'physical', null, 'hit', true);
    pb.pos = { ...portal.pos };
    pb.prevPos = { ...portal.pos };

    pa.pos = { ...portal.pos };
    pa.prevPos = { ...portal.pos };
    sim.tick();

    expect(run.moduleIndex).toBe(1);
    expect(run.modules[run.moduleIndex]).toBe('litany_ledger');
  });
});
