// Intentional Gathering: an arena (or Fiesta) match seat during an in-flight
// corpse-harvest cast must release the harvest cleanly rather than silently
// swallowing it. `readyArenaFighter` (social/arena.ts), reached via
// `startArenaMatch` -> `resetForArena` for every fighter a match seats,
// explicitly releases a live corpse-harvest reservation
// (`releaseCorpseHarvest`, professions/corpse_harvest_session.ts) before
// blanking `Entity.castingAbility`, clearing BOTH
// `PlayerMeta.corpseHarvestSession` and `mob.corpseHarvestState.reservedBy`.
// Without that release a player admitted into a match mid-harvest would be
// left with a dangling frozen session on their own meta AND a permanently
// reserved corpse nobody else could ever harvest, even though nothing is
// visibly "casting" anymore. `arenaQueueJoin` has no cast/busy gate (unlike
// corpse-harvest's own admission), so a casting player queuing and getting
// matched is ordinary, reachable play, not a contrived setup.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, MOBS, setActiveWorldContent } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { HARVEST_CAST_SECONDS } from '../src/sim/professions/harvest_admission';
import { Sim } from '../src/sim/sim';
import { ARENA_MIN_LEVEL } from '../src/sim/social/arena';
import {
  CORPSE_HARVEST_CAST_ID,
  DT,
  type Entity,
  type PlayerClass,
  type WorldContent,
} from '../src/sim/types';
import { expectDefined } from './helpers/defined';

// No ambient camps/npcs/groundObjects/roads: a plain sim.tick() draws no rng
// beyond the harvest and arena paths this file actually exercises (same
// rationale as tests/corpse_harvest_command.test.ts's CORPSE_TEST_WORLD).
const ARENA_CORPSE_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
  roads: [],
};

const TICKS_PER_CAST = Math.round(HARVEST_CAST_SECONDS / DT);

describe('corpse harvest vs arena/Fiesta admission (leak regression)', () => {
  beforeAll(() => setActiveWorldContent(ARENA_CORPSE_TEST_WORLD));
  afterAll(() => setActiveWorldContent(null));

  function placeCoherently(sim: Sim, e: Entity, x: number, z: number): void {
    e.pos = sim.groundPos(x, z);
    e.prevPos = { ...e.pos };
    e.vx = 0;
    e.vy = 0;
    e.vz = 0;
    e.onGround = true;
  }

  function spawnWolfCorpse(sim: Sim, id: number, near: { x: number; z: number }): Entity {
    const pos = sim.groundPos(near.x, near.z);
    const mob = createMob(id, MOBS.forest_wolf, MOBS.forest_wolf.maxLevel, pos);
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    sim.entities.set(mob.id, mob);
    return mob;
  }

  // Starts a real corpse-harvest cast on `harvesterPid` and advances it
  // partway (never to completion): proves the live cast + reservation exist
  // BEFORE the match seat, so what follows is a genuine interruption, not a
  // no-op on an already-idle player.
  function startAndPartAdvanceHarvest(sim: Sim, harvesterPid: number, mob: Entity): void {
    sim.addItem('field_kit', 1, harvesterPid);
    sim.drainEvents();

    expect(sim.harvestCorpse(mob.id, harvesterPid)).toBe(true);

    const actor = expectDefined(sim.entities.get(harvesterPid), 'harvester entity');
    expect(actor.castingAbility).toBe(CORPSE_HARVEST_CAST_ID);
    expect(mob.corpseHarvestState?.reservedBy).toBe(harvesterPid);
    const meta = expectDefined(sim.meta(harvesterPid), 'harvester meta');
    expect(meta.corpseHarvestSession).not.toBeNull();

    // Short of completion: the cast is still genuinely in flight when the
    // match seat happens below.
    for (let i = 0; i < TICKS_PER_CAST - 5; i++) sim.tick();
    expect(actor.castingAbility, 'still casting right before the seat').toBe(
      CORPSE_HARVEST_CAST_ID,
    );
  }

  // Everything the seat must have done correctly: release the reservation
  // AND the frozen session, and never grant materials off the interrupted
  // cast. Then proves the release is REAL (not merely a blanked flag) by
  // having a second, previously-uninvolved player harvest the same corpse to
  // full completion.
  function assertReservationTrulyReleasedAndReharvestable(
    sim: Sim,
    harvesterPid: number,
    mob: Entity,
    outsiderPid: number,
  ): void {
    const actor = expectDefined(sim.entities.get(harvesterPid), 'harvester entity');
    const meta = expectDefined(sim.meta(harvesterPid), 'harvester meta');

    // The session and the corpse-side reservation must both be gone, the
    // exact same cleanup `cancelCast` -> `releaseCorpseHarvest` performs on
    // every other interruption path (disconnect, death, displacement).
    expect(meta.corpseHarvestSession, 'frozen session must be released, not left dangling').toBe(
      null,
    );
    expect(
      mob.corpseHarvestState?.reservedBy ?? null,
      'corpse reservation must be released, not left permanently claimed',
    ).toBe(null);

    // No grant slipped through on the way out: the interrupted cast never
    // silently completed and paid materials to the harvester who got seated.
    expect(sim.countItem('rough_hide', harvesterPid)).toBe(0);
    expect(sim.countItem('wolf_fang', harvesterPid)).toBe(0);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(actor.castingAbility).not.toBe(CORPSE_HARVEST_CAST_ID);

    // A genuinely different, previously-uninvolved player can now start (and
    // complete) a real harvest on the same corpse: the release must be a
    // real state change the admission gate honors, not just an appearance.
    sim.addItem('field_kit', 1, outsiderPid);
    const outsiderEntity = expectDefined(sim.entities.get(outsiderPid), 'outsider entity');
    placeCoherently(sim, outsiderEntity, mob.pos.x, mob.pos.z);
    sim.drainEvents();

    const secondStart = sim.harvestCorpse(mob.id, outsiderPid);
    expect(secondStart, 'a different player must be able to start a fresh harvest').toBe(true);
    expect(mob.corpseHarvestState?.reservedBy).toBe(outsiderPid);

    let harvestResultLanded = false;
    for (let i = 0; i < TICKS_PER_CAST; i++) {
      for (const ev of sim.tick()) if (ev.type === 'harvestResult') harvestResultLanded = true;
    }
    expect(harvestResultLanded).toBe(true);
    expect(
      sim.countItem('rough_hide', outsiderPid) + sim.countItem('wolf_fang', outsiderPid),
    ).toBeGreaterThan(0);
    expect(mob.harvestClaimedBy).toBe(outsiderPid);
  }

  it('a ranked 1v1 arena seat mid-harvest releases the session and the corpse reservation', () => {
    const sim = new Sim({
      seed: 501,
      playerClass: 'warrior',
      noPlayer: true,
      world: ARENA_CORPSE_TEST_WORLD,
    });
    const a = sim.addPlayer('warrior', 'Harvester');
    const b = sim.addPlayer('warrior', 'Opponent');
    const outsider = sim.addPlayer('warrior', 'Outsider');
    sim.setPlayerLevel(ARENA_MIN_LEVEL, a);
    sim.setPlayerLevel(ARENA_MIN_LEVEL, b);
    placeCoherently(sim, expectDefined(sim.entities.get(a)), 0, -40);
    placeCoherently(sim, expectDefined(sim.entities.get(b)), 6, -40);
    placeCoherently(sim, expectDefined(sim.entities.get(outsider)), 12, -40);

    const mob = spawnWolfCorpse(sim, 9301, { x: 0, z: -40 });
    startAndPartAdvanceHarvest(sim, a, mob);

    // Real matchmaking, not a stubbed match: joining the ranked 1v1 queue
    // while mid-cast is admitted (arenaQueueJoin has no cast/busy gate), and
    // one tick both matchmakes and seats the pair via startArenaMatch.
    sim.arenaQueueJoin(a);
    sim.arenaQueueJoin(b);
    sim.tick();

    expect(sim.arenaMatchFor(a)).toBeTruthy();
    expect(sim.arenaMatchFor(a)!.state).toBe('countdown');

    assertReservationTrulyReleasedAndReharvestable(sim, a, mob, outsider);
  });

  it('a Fiesta seat mid-harvest releases the session and the corpse reservation', () => {
    const sim = new Sim({
      seed: 502,
      playerClass: 'warrior',
      noPlayer: true,
      world: ARENA_CORPSE_TEST_WORLD,
    });
    const a = sim.addPlayer('warrior', 'Harvester');
    const fillerClasses: PlayerClass[] = ['mage', 'rogue', 'priest'];
    const fillers = fillerClasses.map((cls, i) => sim.addPlayer(cls, `Filler${i}`));
    const outsider = sim.addPlayer('warrior', 'Outsider');
    placeCoherently(sim, expectDefined(sim.entities.get(a)), 0, -40);
    fillers.forEach((pid, i) => {
      placeCoherently(sim, expectDefined(sim.entities.get(pid)), (i + 1) * 4, -40);
    });
    placeCoherently(sim, expectDefined(sim.entities.get(outsider)), 20, -40);

    const mob = spawnWolfCorpse(sim, 9302, { x: 0, z: -40 });
    startAndPartAdvanceHarvest(sim, a, mob);

    // Fiesta has no level gate, but needs four solo queuers to seat a 2v2
    // match; one tick seats it exactly like the ranked 1v1 case above.
    sim.arenaQueueJoin(a, 'fiesta');
    for (const pid of fillers) sim.arenaQueueJoin(pid, 'fiesta');
    sim.tick();

    expect(sim.arenaMatchFor(a)).toBeTruthy();
    expect(sim.arenaMatchFor(a)!.format).toBe('fiesta');

    assertReservationTrulyReleasedAndReharvestable(sim, a, mob, outsider);
  });
});
