import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { LOOT_FFA_DELAY } from '../src/sim/loot/loot_ffa';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// End-to-end: a stranger cannot loot a tapped corpse until LOOT_FFA_DELAY seconds
// after it became lootable; once the owner-lock lapses, the loot goes free-for-all.

type SimInternals = {
  entities: Map<number, Entity>;
  players: Map<number, PlayerMeta>;
};

function setup() {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
  const internals = sim as unknown as SimInternals;
  const tapper = sim.addPlayer('warrior', 'Tapper');
  const stranger = sim.addPlayer('warrior', 'Stranger');
  sim.tick();

  // Both standing on the corpse so the interact-range gate is satisfied.
  for (const pid of [tapper, stranger]) {
    const e = internals.entities.get(pid)!;
    e.pos = { x: 0, y: 0, z: 0 };
    e.prevPos = { x: 0, y: 0, z: 0 };
  }

  // A dead, lootable wolf tapped (and not partied) by Tapper, holding shared loot.
  const template = MOBS.forest_wolf;
  const mob = createMob(9999, template, template.maxLevel, { x: 0, y: 0, z: 0 });
  mob.dead = true;
  mob.aiState = 'dead';
  mob.tappedById = tapper;
  mob.loot = { copper: 50, items: [{ itemId: 'minor_health_potion', count: 1 }] };
  mob.lootable = true;
  mob.lootFfaTimer = LOOT_FFA_DELAY;
  // keep the corpse present well past the FFA window so lootFfaTimer is the only gate
  // (despawn needs corpseTimer<=0 AND respawnTimer<=0).
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  internals.entities.set(mob.id, mob);

  return { sim, internals, tapper, stranger, mob };
}

const copperOf = (meta: PlayerMeta | undefined) => meta?.copper ?? 0;

describe('loot goes FFA one minute after a corpse becomes lootable', () => {
  it('blocks a stranger while the corpse is still owner-locked', () => {
    const { sim, internals, stranger, mob } = setup();
    expect(mob.lootFfaTimer).toBeGreaterThan(0);
    const before = copperOf(internals.players.get(stranger));
    sim.lootCorpse(mob.id, stranger);
    expect(copperOf(internals.players.get(stranger))).toBe(before); // nothing taken
    expect(mob.loot?.copper).toBe(50); // loot untouched
  });

  it('still lets the tapper loot during the lock', () => {
    const { sim, internals, tapper, mob } = setup();
    const before = copperOf(internals.players.get(tapper));
    sim.lootCorpse(mob.id, tapper);
    expect(copperOf(internals.players.get(tapper))).toBeGreaterThan(before);
  });

  it('lets a stranger loot once the owner-lock has lapsed', () => {
    const { sim, internals, stranger, mob } = setup();
    // Drive the dead-mob tick until the owner-lock lapses (just over one minute).
    for (let i = 0; i < 20 * (LOOT_FFA_DELAY + 1) && mob.lootFfaTimer > 0; i++) sim.tick();
    expect(mob.lootFfaTimer).toBeLessThanOrEqual(0);
    expect(mob.lootable).toBe(true); // corpse still present to be looted

    const before = copperOf(internals.players.get(stranger));
    sim.lootCorpse(mob.id, stranger);
    expect(copperOf(internals.players.get(stranger))).toBeGreaterThan(before);
  });

  it('is deterministic: same seed yields the same FFA timeline', () => {
    const run = () => {
      const { sim, mob } = setup();
      for (let i = 0; i < 20 * (LOOT_FFA_DELAY + 1) && mob.lootFfaTimer > 0; i++) sim.tick();
      return Math.max(0, Math.round(mob.lootFfaTimer * 1000));
    };
    expect(run()).toEqual(run());
  });
});
