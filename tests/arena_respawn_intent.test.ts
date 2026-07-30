// Regression for issue 1651 (arena arm): a fighter's last-held movement key
// survived on PlayerMeta.moveInput through the arena respawn. readyArenaFighter
// (the one place a benched Fiesta/ranked fighter is placed back into the bout)
// reset hp/resource/target/auto-attack but never cleared moveInput, so the
// revived fighter drifted in the last-held direction with no key pressed. The
// graveyard/delve respawn paths are covered elsewhere (spirit.ts / entity_roster
// / runs.ts); this pins the arena path readyArenaFighter owns.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Seat a 2v2 Fiesta with four solo-queued players and run the countdown out so
// the bout is live. Fiesta respawns route through readyArenaFighter, so it is
// the clean vehicle for exercising the arena revive path.
function startFiesta(classes: PlayerClass[] = ['warrior', 'mage', 'rogue', 'priest']) {
  const sim = makeWorld();
  const pids = classes.map((c, i) => sim.addPlayer(c, `P${i}`));
  pids.forEach((p, i) => {
    teleport(sim, p, i * 4, -40);
  });
  pids.forEach((p) => {
    sim.arenaQueueJoin(p, 'fiesta');
  });
  sim.tick(); // matchmake
  for (let i = 0; i < 20 * 8; i++) {
    sim.tick();
    const m = sim.arenaMatchFor(pids[0]);
    if (m && m.state === 'active') break;
  }
  const match = sim.arenaMatchFor(pids[0])!;
  return { sim, match };
}

describe('arena respawn clears stale movement intent (issue 1651)', () => {
  it('a benched fiesta fighter does not auto-walk from a held intent after revive', () => {
    const { sim, match } = startFiesta();
    const killerPid = match.teamA[0];
    const victimPid = match.teamB[0];
    const victim = sim.entities.get(victimPid)!;
    const killer = sim.entities.get(killerPid)!;
    const victimMeta = (sim as any).players.get(victimPid);
    // Down the victim while it holds a forward intent, and keep the flag set while it
    // is benched so readyArenaFighter is the only thing that could clear it on revive.
    victimMeta.moveInput.forward = true;
    (sim as any).dealDamage(killer, victim, victim.maxHp + 50, false, 'physical', null);
    expect(victim.dead).toBe(true);
    victimMeta.moveInput.forward = true;
    const downedFor = match.fiesta!.respawn.get(victimPid)!;
    for (let i = 0; i < Math.ceil(downedFor * 20) + 5; i++) sim.tick();
    expect(sim.entities.get(victimPid)!.dead).toBe(false);
    // The revived fighter must not auto-walk from the stale intent.
    expect(victimMeta.moveInput.forward).toBe(false);
  });
});
