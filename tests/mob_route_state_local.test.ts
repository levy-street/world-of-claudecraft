// The mob route state is server-local: Entity.chaseRoute (a mob's route, its
// plan throttle and its last sight answer, mob/chase_route.ts) and
// Entity.routeDenied (the pack's "no route" memo, kept on the TARGET, which is
// a player) never ride a snapshot and are never written into a character save.
//
// Both encoders are whitelists (server/game.ts wireEntity builds a record from
// named fields; Sim.serializeCharacter builds a CharacterState the same way),
// which the first test proves with a field neither has ever heard of. The
// values planted are sentinels, so a field shipped under a short wire key
// would still be caught.

import { describe, expect, it } from 'vitest';
import { wireEntity } from '../server/game';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const SENTINEL = 987654;
const SENTINEL_TEXT = 'zz-route-state-sentinel';

function world(): { sim: Sim; player: Entity; mob: Entity } {
  const sim = new Sim({ seed: 31, playerClass: 'warrior' });
  const player = sim.player;
  const mob = createMob(sim.ctx.nextId++, MOBS.crypt_gravecaller_adept, 8, {
    x: player.pos.x + 6,
    y: player.pos.y,
    z: player.pos.z,
  });
  sim.ctx.addEntity(mob);
  mob.chaseRoute = {
    targetId: player.id,
    path: [
      { x: SENTINEL + 1, y: 0, z: SENTINEL + 2 },
      { x: SENTINEL + 3, y: 0, z: SENTINEL + 4 },
    ],
    planAt: SENTINEL + 5,
    tries: 3,
    triesAt: SENTINEL + 6,
    fails: 2,
    stuckDist: SENTINEL + 7,
    stuckAt: SENTINEL + 8,
    walkedAt: SENTINEL + 9,
    sightClear: false,
  };
  player.routeDenied = {
    tick: SENTINEL + 10,
    x: SENTINEL + 11,
    z: SENTINEL + 12,
    fromX: SENTINEL + 13,
    fromZ: SENTINEL + 14,
    swim: true,
  };
  return { sim, player, mob };
}

function leaks(encoded: unknown): string[] {
  const text = JSON.stringify(encoded);
  const found: string[] = [];
  for (const needle of [String(SENTINEL), 'chaseRoute', 'routeDenied', SENTINEL_TEXT]) {
    if (text.includes(needle)) found.push(needle);
  }
  return found;
}

describe('the snapshot and the save are whitelists', () => {
  it('a field neither encoder knows never leaves the sim', () => {
    const { sim, player, mob } = world();
    (mob as unknown as Record<string, unknown>).zzUnknownField = SENTINEL_TEXT;
    (player as unknown as Record<string, unknown>).zzUnknownField = SENTINEL_TEXT;
    expect(JSON.stringify(wireEntity(mob))).not.toContain(SENTINEL_TEXT);
    expect(JSON.stringify(wireEntity(player))).not.toContain(SENTINEL_TEXT);
    expect(JSON.stringify(sim.serializeCharacter(player.id))).not.toContain(SENTINEL_TEXT);
  });
});

describe('the mob route state never leaves the server', () => {
  it("a mob's route record is not on its snapshot record, with or without auras", () => {
    const { mob } = world();
    expect(leaks(wireEntity(mob))).toEqual([]);
    expect(leaks(wireEntity(mob, false))).toEqual([]);
    // The record really is on the entity the encoder was handed.
    expect(mob.chaseRoute?.planAt).toBe(SENTINEL + 5);
  });

  it("the pack's memo on a player is not on the player's snapshot record", () => {
    const { player } = world();
    expect(leaks(wireEntity(player))).toEqual([]);
    expect(player.routeDenied?.tick).toBe(SENTINEL + 10);
  });

  it("the pack's memo on a player is not in that player's character save", () => {
    const { sim, player } = world();
    const save = sim.serializeCharacter(player.id);
    expect(save).not.toBeNull();
    expect(leaks(save)).toEqual([]);
  });
});
