// The hard tether (MobTemplate.hardLeashRadius): a mob carrying it evades home
// the moment it is dragged further than the tether from its SPAWN, whatever its
// refreshing leashAnchor says. The ordinary soft leash measures from an anchor
// that every hostile action re-seeds, which is exactly what lets a patient
// player walk a mob across the map one leash-length at a time; the tether makes
// the marked mob unkiteable. Grix the Tunnelking carries it so his add waves
// can never be dragged to town in the first place.

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, MOBS, setActiveWorldContent } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { WorldContent } from '../src/sim/types';

const SEED = 42;
const HOME = { x: -95, z: -78 };

function makeWorld(): Sim {
  const world: WorldContent = {
    ...BUILTIN_WORLD,
    camps: [],
    npcs: {},
    groundObjects: [],
  };
  setActiveWorldContent(world);
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world });
  const pid = sim.addPlayer('warrior', 'Kiter');
  const p = sim.entities.get(pid);
  if (!p) throw new Error('player missing');
  sim.setPlayerLevel(10, pid);
  sim.drainEvents();
  return sim;
}

function placePlayer(sim: Sim, x: number, z: number) {
  const p = sim.player;
  p.pos = sim.groundPos(x, z);
  p.prevPos = { ...p.pos };
  sim.grid.update(p);
  sim.playerGrid.update(p);
}

function engagedMob(sim: Sim, templateId: string, id: number) {
  const mob = createMob(
    id,
    MOBS[templateId],
    MOBS[templateId].maxLevel,
    sim.groundPos(HOME.x, HOME.z),
  );
  sim.entities.set(mob.id, mob);
  sim.grid.update(mob);
  placePlayer(sim, HOME.x + 2, HOME.z);
  sim.ctx.dealDamage(sim.player, mob, 1, false, 'physical', null, 'hit');
  sim.tick();
  expect(mob.aggroTargetId).toBe(sim.player.id);
  return mob;
}

// The kite proxy: the mob stands `dist` from its spawn with a FRESH leash
// anchor at its feet (every hit re-seeds the anchor, so a real kite always
// looks like this) and its victim in reach, so the soft anchor leash alone
// would keep it fighting.
function dragTo(sim: Sim, mob: ReturnType<typeof engagedMob>, dist: number) {
  mob.pos = sim.groundPos(HOME.x + dist, HOME.z);
  mob.prevPos = { ...mob.pos };
  sim.grid.update(mob);
  mob.leashAnchor = { ...mob.pos };
  placePlayer(sim, HOME.x + dist + 2, HOME.z);
}

describe('mob hard leash tether', () => {
  it('Grix carries the tether in content', () => {
    expect(MOBS.grix_the_tunnelking.hardLeashRadius).toBe(50);
  });

  it('a tethered rare dragged past his tether evades home to full hp, adds swept', () => {
    const sim = makeWorld();
    const grix = engagedMob(sim, 'grix_the_tunnelking', 940001);

    // Fight him down across the add threshold first, so the evade also proves
    // the wave is swept with the reset.
    sim.ctx.dealDamage(
      sim.player,
      grix,
      Math.ceil(grix.maxHp * 0.5) - 1,
      false,
      'physical',
      null,
      'hit',
    );
    sim.tick();
    expect(grix.summonedIds.length).toBeGreaterThan(0);
    const addIds = [...grix.summonedIds];

    dragTo(sim, grix, 55);
    sim.tick();
    expect(grix.aiState).toBe('evade');
    expect(grix.aggroTargetId).toBeNull();

    // Walk all the way home: full reset, classic evade rules.
    for (let i = 0; i < 20 * 60 && grix.aiState === 'evade'; i++) sim.tick();
    expect(Math.hypot(grix.pos.x - HOME.x, grix.pos.z - HOME.z)).toBeLessThan(6);
    expect(grix.hp).toBe(grix.maxHp);
    for (const id of addIds) expect(sim.entities.has(id)).toBe(false);
  });

  it('inside the tether he keeps fighting', () => {
    const sim = makeWorld();
    const grix = engagedMob(sim, 'grix_the_tunnelking', 940002);
    dragTo(sim, grix, 40);
    sim.tick();
    expect(grix.aiState).not.toBe('evade');
    expect(grix.aggroTargetId).toBe(sim.player.id);
  });

  it('an untethered mob with a fresh anchor is still kiteable past the same distance', () => {
    const sim = makeWorld();
    const wolf = engagedMob(sim, 'forest_wolf', 940003);
    dragTo(sim, wolf, 55);
    sim.tick();
    expect(wolf.aiState).not.toBe('evade');
    expect(wolf.aggroTargetId).toBe(sim.player.id);
  });
});
