// The shared physics-arrival reset every teleport site calls (src/sim/teleport_arrival.ts),
// extracted from the reset portals.ts already had. Unit-tests the helper directly, then
// proves it through two real instance-entry paths: a player airborne at the transfer tick
// must land settled, never taking fall damage from the overworld height it left behind
// (issue: instance/arena/battleground/delve floors sit at y=0, so a stale fallStartY reads
// as a 20-50 yd drop on arrival).

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { createPlayer } from '../src/sim/entity';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { settleTeleportArrival } from '../src/sim/teleport_arrival';
import type { WorldContent } from '../src/sim/types';

const NO_AMBIENT_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label}`);
  return value;
}

describe('settleTeleportArrival', () => {
  it('zeroes vertical velocity, clears jumping, grounds the entity, and pins fallStartY to the new pos', () => {
    const p = createPlayer(1, 'warrior', { x: 10, y: 40, z: 10 }, 'Faller');
    p.vy = -12;
    p.jumping = true;
    p.onGround = false;
    p.fallStartY = 78; // stale overworld height the entity fell from

    settleTeleportArrival(p);

    expect(p.vy).toBe(0);
    expect(p.jumping).toBe(false);
    expect(p.onGround).toBe(true);
    expect(p.fallStartY).toBe(p.pos.y);
    expect(p.fallStartY).toBe(40);
  });
});

describe('instance arrival resets an airborne player (dungeons)', () => {
  function makeSim(seed = 99) {
    return new Sim({
      seed,
      playerClass: 'warrior',
      noPlayer: true,
      world: NO_AMBIENT_WORLD,
    });
  }

  it('enterDungeon lands an airborne player settled, with no fall damage on the next tick', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    const p = required(sim.entities.get(pid), 'player entity');
    p.maxHp = p.hp = 1_000_000;
    // Mid-jump over the overworld at the exact tick the door trigger fires
    // (door triggers run in the same tick as movement): a stale fallStartY
    // this far above the instance floor would be a lethal fall on landing.
    p.pos.y = 45;
    p.vy = 3;
    p.jumping = true;
    p.onGround = false;
    p.fallStartY = 45;

    expect(enterDungeon(sim.ctx, 'hollow_crypt', pid)).toBe(true);

    expect(p.onGround).toBe(true);
    expect(p.jumping).toBe(false);
    expect(p.vy).toBe(0);
    expect(p.fallStartY).toBe(p.pos.y);

    const hpBeforeTick = p.hp;
    sim.tick();
    expect(p.hp).toBe(hpBeforeTick);
    expect(p.hp).toBe(1_000_000);
  });
});

describe('instance arrival resets an airborne player (delves)', () => {
  function makeSim(seed = 7) {
    return new Sim({ seed, playerClass: 'warrior', autoEquip: true, world: NO_AMBIENT_WORLD });
  }

  it('enterDelve lands an airborne player settled, with no fall damage on the next tick', () => {
    const sim = makeSim();
    sim.setPlayerLevel(7); // collapsed_reliquary's minLevel
    const p = sim.player;
    p.maxHp = p.hp = 1_000_000;
    p.pos.y = 50;
    p.vy = 2;
    p.jumping = true;
    p.onGround = false;
    p.fallStartY = 50;

    sim.enterDelve('collapsed_reliquary', 'normal');

    expect(p.onGround).toBe(true);
    expect(p.jumping).toBe(false);
    expect(p.vy).toBe(0);
    expect(p.fallStartY).toBe(p.pos.y);

    const hpBeforeTick = p.hp;
    sim.tick();
    expect(p.hp).toBe(hpBeforeTick);
    expect(p.hp).toBe(1_000_000);
  });
});
