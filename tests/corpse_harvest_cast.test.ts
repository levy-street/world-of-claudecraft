// Intentional Gathering (PR3): the corpse-harvest CAST lifecycle, through the
// real Sim + the real 20 Hz tick loop (sim.tick() drives updateCasting; a
// harvest command starts a CORPSE_HARVEST_CAST_ID activity cast exactly like
// the existing gather/craft/enchant sessions, see combat/casting_lifecycle.ts
// and professions/session_teardown.ts).
//
// SCOPE: this file owns the CAST (duration, admission rechecks, frozen inputs,
// every cancellation cause, and grant-on-completion), exercised through
// professions/corpse_harvest_session.ts:
//   startCorpseHarvest(ctx, corpseId, pid?): boolean
//   validateCorpseHarvestCast(ctx, player, meta): boolean
//   completeCorpseHarvestCast(ctx, player, meta): boolean
//   releaseCorpseHarvest(ctx, playerId): void
// The pure admission decision (tests/harvest_admission.test.ts) and the pure
// preference leaf (tests/harvest_preference.test.ts) are NOT re-covered here;
// this file only exercises them through the live cast. Kill-credit priority,
// party-join timing, name-collision isolation, and rejoin identity live in the
// sibling tests/corpse_harvest_rights.test.ts, including the real handleDeath
// snapshot integration. The pre-existing instant-harvest command
// (sim.harvestCorpse) is a SEPARATE regression suite
// (tests/corpse_harvest_sim.test.ts) and is not duplicated here.
//
// World: EMPTY_TEST_WORLD plus roads:[] (no camps/npcs/ground objects/roads),
// so a plain sim.tick() has NO ambient rng-drawing systems (no mob AI, no
// idle rng) other than the corpse-harvest path itself; this is what makes a
// zero-draws assertion around a bare tick() meaningful without stubbing rng
// globally. Two exceptions get NO zero-draws claim, called out at their site:
// respawnMob (which always reseeds its own wanderTimer via idleRng,
// independent of any harvest) and dealDamage (which can carry its own
// mitigation/proc draws unrelated to the harvest cancel it also triggers).
//
// Every actor/corpse position is `sim.groundPos(x, z)` with a matching
// `prevPos`, zero velocity and `onGround: true`, so nothing here is ever one
// gravity-settle tick away from reading as "moved".

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { ITEMS, MOBS, setActiveWorldContent } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { snapshotCorpseHarvestGrantInputs } from '../src/sim/professions/corpse_harvest_grant';
import {
  completeCorpseHarvestCast,
  releaseCorpseHarvest,
  startCorpseHarvest,
  validateCorpseHarvestCast,
} from '../src/sim/professions/corpse_harvest_session';
import { HARVEST_CAST_SECONDS } from '../src/sim/professions/harvest_admission';
import { TIER3_TOOL_WIELD_PROFICIENCY } from '../src/sim/professions/wield_gate';
import type { CharacterState, PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import {
  CORPSE_HARVEST_CAST_ID,
  DT,
  type Entity,
  isNonSpellCast,
  type WorldContent,
} from '../src/sim/types';
import { expectDefined } from './helpers/defined';
import { placeInDungeon } from './helpers/instanced_contexts';
import { EMPTY_TEST_WORLD } from './sim_shared';

const CORPSE_TEST_WORLD: WorldContent = { ...EMPTY_TEST_WORLD, roads: [] };

beforeAll(() => setActiveWorldContent(CORPSE_TEST_WORLD));
afterAll(() => setActiveWorldContent(null));

const TICKS_PER_CAST = Math.round(HARVEST_CAST_SECONDS / DT);

function mustEntity(sim: Sim, pid: number): Entity {
  return expectDefined(sim.entities.get(pid));
}

function mustMeta(sim: Sim, pid: number): PlayerMeta {
  return expectDefined(sim.players.get(pid));
}

/** Places `e` at `(x, z)` with a coherent rest state: matching `prevPos`,
 *  zero velocity, grounded. Nothing here should ever read as "moved" by a
 *  gravity settle or a stale prevPos. */
function placeCoherently(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos = sim.groundPos(x, z);
  e.prevPos = { ...e.pos };
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
  e.onGround = true;
}

/** A dead, tagged (hide + fang) forest_wolf corpse. */
function spawnWolfCorpse(sim: Sim, id: number, x = 0, z = 0): Entity {
  const template = MOBS.forest_wolf;
  const pos = sim.groundPos(x, z);
  const mob = createMob(id, template, template.maxLevel, pos);
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  sim.entities.set(mob.id, mob);
  return mob;
}

/** Two players, each carrying exactly one Field Kit, standing on a fresh
 *  corpse at the origin, in interact range. */
function setup(seed = 11) {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: CORPSE_TEST_WORLD });
  const a = sim.addPlayer('warrior', 'Alpha');
  const b = sim.addPlayer('warrior', 'Bravo');
  sim.tick();
  for (const pid of [a, b]) {
    placeCoherently(sim, mustEntity(sim, pid), 0, 0);
    sim.addItem('field_kit', 1, pid);
  }
  const mob = spawnWolfCorpse(sim, 9999);
  return { sim, a, b, mob };
}

/** Every material item forest_wolf's tags (hide, fang) can grant. */
const WOLF_MATERIAL_ITEMS = ['rough_hide', 'wolf_fang'];

function totalWolfMaterials(sim: Sim, pid: number): number {
  return WOLF_MATERIAL_ITEMS.reduce((sum, itemId) => sum + sim.countItem(itemId, pid), 0);
}

function drawCounter(sim: Sim): { stop(): number } {
  let draws = 0;
  sim.rng.setObserver(() => {
    draws++;
  });
  return {
    stop() {
      sim.rng.setObserver(null);
      return draws;
    },
  };
}

// Fill every free slot with distinct 1-per-slot gear so the next add has
// nowhere to go (tests/bags.test.ts / tests/corpse_harvest_sim.test.ts idiom).
function fillBags(sim: Sim, pid: number): void {
  const m = mustMeta(sim, pid);
  const cap = bagCapacity(m.bags);
  const gearIds = Object.values(ITEMS)
    .filter((d) => d.kind === 'weapon' || d.kind === 'armor')
    .map((d) => d.id);
  let i = 0;
  while (m.inventory.length < cap) {
    sim.addItem(gearIds[i % gearIds.length], 1, pid);
    i++;
  }
}

function tickWhileCasting(sim: Sim, pid: number, maxTicks = TICKS_PER_CAST + 5): void {
  const p = mustEntity(sim, pid);
  for (let i = 0; i < maxTicks && p.castingAbility; i++) sim.tick();
}

describe('CORPSE_HARVEST_CAST_ID is a registered non-spell activity cast', () => {
  it('rides the shared movement/damage/displacement cancel plumbing for free', () => {
    // This single fact is what buys every generic cancellation cause below
    // (movement, damage, teleport/instance-boundary displacement) without any
    // bespoke corpse-harvest-specific wiring in player_motion.ts,
    // combat/damage.ts, or professions/session_teardown.ts.
    expect(isNonSpellCast(CORPSE_HARVEST_CAST_ID)).toBe(true);
  });
});

describe('cast duration: no early loot, exactly one grant at completion', () => {
  it('grants nothing before the cast completes and grants once it does', () => {
    const { sim, a, mob } = setup();
    const before = totalWolfMaterials(sim, a);
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    const p = mustEntity(sim, a);
    expect(p.castingAbility).toBe(CORPSE_HARVEST_CAST_ID);

    // One tick short of completion: still casting, nothing granted yet.
    for (let i = 0; i < TICKS_PER_CAST - 1; i++) sim.tick();
    expect(mustEntity(sim, a).castingAbility).toBe(CORPSE_HARVEST_CAST_ID);
    expect(totalWolfMaterials(sim, a)).toBe(before);
    expect(mob.harvestClaimedBy).toBeNull();

    // The final tick completes the cast and lands the grant.
    sim.tick();
    expect(mustEntity(sim, a).castingAbility).toBeNull();
    expect(totalWolfMaterials(sim, a)).toBeGreaterThan(before);
    expect(mob.harvestClaimedBy).toBe(a);
  });

  it('takes exactly HARVEST_CAST_SECONDS worth of ticks, not more, not fewer', () => {
    const { sim, a, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    let ticks = 0;
    const p = mustEntity(sim, a);
    while (p.castingAbility && ticks < TICKS_PER_CAST + 5) {
      sim.tick();
      ticks++;
    }
    expect(ticks).toBe(TICKS_PER_CAST);
  });
});

describe('successful single claim', () => {
  it('a completed cast claims the corpse exactly once', () => {
    const { sim, a, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    tickWhileCasting(sim, a);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(totalWolfMaterials(sim, a)).toBeGreaterThan(0);
  });

  it('a second start against an already-claimed corpse is refused outright, zero draws', () => {
    const { sim, a, b, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    tickWhileCasting(sim, a);
    expect(mob.harvestClaimedBy).toBe(a);

    const counter = drawCounter(sim);
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(false);
    expect(counter.stop()).toBe(0);
    expect(mustEntity(sim, b).castingAbility).toBeNull();
    expect(totalWolfMaterials(sim, b)).toBe(0);
  });
});

describe('no duplicate queue against a reservation the actor already holds', () => {
  it('the same actor re-issuing the command mid-cast is refused, zero draws, original cast unaffected', () => {
    const { sim, a, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    sim.tick();
    const counter = drawCounter(sim);
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
    expect(counter.stop()).toBe(0);
    // The original cast is untouched by the refused re-issue.
    expect(mustEntity(sim, a).castingAbility).toBe(CORPSE_HARVEST_CAST_ID);
    tickWhileCasting(sim, a);
    expect(mob.harvestClaimedBy).toBe(a);
  });
});

describe('body switching', () => {
  it('a second, different corpse is refused while a first cast is still in flight, and stays free', () => {
    const { sim, a, mob } = setup();
    const second = spawnWolfCorpse(sim, 9998, 0, 0);
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    sim.tick();

    const counter = drawCounter(sim);
    expect(startCorpseHarvest(sim.ctx, second.id, a)).toBe(false);
    expect(counter.stop()).toBe(0);
    expect(second.harvestClaimedBy).toBeNull();
    expect(second.corpseHarvestState?.reservedBy ?? null).toBeNull();

    // The original cast completes normally: the refused attempt on the
    // second body never touched it.
    tickWhileCasting(sim, a);
    expect(mob.harvestClaimedBy).toBe(a);
  });

  it('the same player can harvest a second, different corpse after finishing the first', () => {
    const { sim, a, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    tickWhileCasting(sim, a);
    expect(mob.harvestClaimedBy).toBe(a);
    const afterFirst = totalWolfMaterials(sim, a);

    const second = spawnWolfCorpse(sim, 9998, 0, 0);
    expect(startCorpseHarvest(sim.ctx, second.id, a)).toBe(true);
    tickWhileCasting(sim, a);
    expect(second.harvestClaimedBy).toBe(a);
    expect(totalWolfMaterials(sim, a)).toBeGreaterThan(afterFirst);
  });
});

describe('start gates', () => {
  it('refuses with no Field Kit carried, zero draws, nothing started', () => {
    const { sim, a, mob } = setup();
    sim.removeItem('field_kit', 1, a);
    expect(sim.countItem('field_kit', a)).toBe(0);
    const counter = drawCounter(sim);
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
    expect(counter.stop()).toBe(0);
    expect(mustEntity(sim, a).castingAbility).toBeNull();
    expect(mob.harvestClaimedBy).toBeNull();
  });

  it('refuses a dead actor, zero draws', () => {
    const { sim, a, mob } = setup();
    mustEntity(sim, a).dead = true;
    const counter = drawCounter(sim);
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
    expect(counter.stop()).toBe(0);
    expect(mob.harvestClaimedBy).toBeNull();
  });

  it('refuses an actor already in combat, zero draws', () => {
    const { sim, a, mob } = setup();
    mustEntity(sim, a).inCombat = true;
    const counter = drawCounter(sim);
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
    expect(counter.stop()).toBe(0);
    expect(mob.harvestClaimedBy).toBeNull();
  });

  it('refuses an actor already busy with another cast, zero draws', () => {
    const { sim, a, mob } = setup();
    mustEntity(sim, a).castingAbility = 'some_other_cast';
    const counter = drawCounter(sim);
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
    expect(counter.stop()).toBe(0);
    expect(mustEntity(sim, a).castingAbility).toBe('some_other_cast');
    expect(mob.harvestClaimedBy).toBeNull();
  });

  it('refuses out of INTERACT_RANGE, zero draws', () => {
    const { sim, a, mob } = setup();
    placeCoherently(sim, mustEntity(sim, a), 40, 0);
    const counter = drawCounter(sim);
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
    expect(counter.stop()).toBe(0);
    expect(mob.harvestClaimedBy).toBeNull();
  });

  it('refuses across a real instance boundary (actor inside a dungeon, corpse open-world)', () => {
    const { sim, a, mob } = setup();
    placeInDungeon(sim, a);
    const counter = drawCounter(sim);
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
    expect(counter.stop()).toBe(0);
    expect(mob.harvestClaimedBy).toBeNull();
  });
});

describe('strict missing material and malformed preference', () => {
  it('refuses to start when the persisted preference names a material this body does not carry', () => {
    const { sim, a, mob } = setup();
    sim.setHarvestPreference('homespun_cloth', a); // cloth: not one of hide/fang
    const before = totalWolfMaterials(sim, a);
    const counter = drawCounter(sim);
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
    expect(counter.stop()).toBe(0);
    expect(mustEntity(sim, a).castingAbility).toBeNull();
    expect(mob.harvestClaimedBy).toBeNull();
    expect(totalWolfMaterials(sim, a)).toBe(before);
  });

  it('refuses to start when the persisted preference is malformed (no active choice)', () => {
    const { sim, mob } = setup();
    const pid = [...sim.players.keys()][0];
    const baseState = sim.serializeCharacter(pid) as CharacterState;
    const malformedState = { ...baseState, harvestPreference: 42 } as unknown as CharacterState;

    const sim2 = new Sim({
      seed: 12,
      playerClass: 'warrior',
      noPlayer: true,
      world: CORPSE_TEST_WORLD,
    });
    const a2 = sim2.addPlayer('warrior', 'Malformed', { state: malformedState });
    sim2.tick();
    placeCoherently(sim2, mustEntity(sim2, a2), 0, 0);
    sim2.addItem('field_kit', 1, a2);
    const corpse = spawnWolfCorpse(sim2, 8001);
    expect(sim2.harvestPreferenceFor(a2)).toBeNull();

    const counter = drawCounter(sim2);
    expect(startCorpseHarvest(sim2.ctx, corpse.id, a2)).toBe(false);
    expect(counter.stop()).toBe(0);
    expect(corpse.harvestClaimedBy).toBeNull();
  });
});

describe('full bags: refuses to start, and refuses completion if bags fill mid-cast', () => {
  it('refuses to start a cast when the ordinary yield would not fit', () => {
    const { sim, a, mob } = setup();
    fillBags(sim, a);
    const counter = drawCounter(sim);
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
    expect(counter.stop()).toBe(0);
    expect(mustEntity(sim, a).castingAbility).toBeNull();
    expect(mob.harvestClaimedBy).toBeNull();
  });

  it('a bag fill DURING the cast refuses the completion grant and releases the corpse, zero draws', () => {
    const { sim, a, b, mob } = setup();
    const timerBefore = mob.corpseTimer;
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    sim.tick(); // one tick into the cast, well short of completion
    fillBags(sim, a);
    const before = totalWolfMaterials(sim, a);

    const counter = drawCounter(sim);
    tickWhileCasting(sim, a);
    expect(counter.stop()).toBe(0);
    expect(mustEntity(sim, a).castingAbility).toBeNull();
    expect(totalWolfMaterials(sim, a)).toBe(before);
    // Refused, not claimed: the corpse is still winnable by someone else, and
    // its lifetime was never extended by the aborted attempt.
    expect(mob.harvestClaimedBy).toBeNull();
    expect(mob.corpseTimer).toBeLessThanOrEqual(timerBefore);
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(true);
  });
});

describe('kit lost on the very last tick before completion', () => {
  it('still grants nothing and releases, zero draws (caught by the per-tick recheck the same as any earlier tick)', () => {
    const { sim, a, b, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    for (let i = 0; i < TICKS_PER_CAST - 1; i++) sim.tick();
    expect(mustEntity(sim, a).castingAbility).toBe(CORPSE_HARVEST_CAST_ID);
    sim.removeItem('field_kit', 1, a);

    const counter = drawCounter(sim);
    sim.tick(); // the tick that would otherwise complete the cast
    expect(counter.stop()).toBe(0);
    expect(mustEntity(sim, a).castingAbility).toBeNull();
    expect(totalWolfMaterials(sim, a)).toBe(0);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(true);
  });
});

describe('frozen preference and focus', () => {
  it('a preference change mid-cast never retargets an already-admitted harvest', () => {
    const { sim, a, mob } = setup();
    sim.setHarvestPreference('rough_hide', a);
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    sim.tick();
    // Switch to a preference this body does NOT support at all. If the grant
    // re-read the live preference, completion would refuse outright; the
    // frozen-input contract says it must not.
    sim.setHarvestPreference('homespun_cloth', a);
    tickWhileCasting(sim, a);
    expect(mob.harvestClaimedBy).toBe(a);
    // The frozen pick was hide-only: fang must not have been granted.
    expect(sim.countItem('wolf_fang', a)).toBe(0);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThan(0);
  });
});

describe('cancellation causes release the reservation with no lifetime extension', () => {
  function expectCancelledAndReleased(
    sim: Sim,
    a: number,
    b: number,
    mob: Entity,
    timerBefore: number,
  ) {
    expect(mustEntity(sim, a).castingAbility).toBeNull();
    expect(totalWolfMaterials(sim, a)).toBe(0);
    expect(mob.harvestClaimedBy).toBeNull();
    // The corpse's lifetime was never extended by the aborted attempt.
    expect(mob.corpseTimer).toBeLessThanOrEqual(timerBefore);
    // ...and a fresh admitted attempt from someone else still succeeds.
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(true);
  }

  it('moving out (and back) mid-cast cancels and releases, zero draws', () => {
    const { sim, a, b, mob } = setup();
    const timerBefore = mob.corpseTimer;
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    sim.tick();
    const counter = drawCounter(sim);
    const meta = mustMeta(sim, a);
    const p = mustEntity(sim, a);
    meta.moveInput.forward = true;
    sim.tick();
    meta.moveInput.forward = false;
    // Moving back onto the corpse afterward does not resurrect the cancelled cast.
    placeCoherently(sim, p, 0, 0);
    sim.tick();
    expect(counter.stop()).toBe(0);
    expectCancelledAndReleased(sim, a, b, mob, timerBefore);
  });

  it('taking damage mid-cast cancels and releases (dealDamage may carry its own unrelated draws)', () => {
    const { sim, a, b, mob } = setup();
    const timerBefore = mob.corpseTimer;
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    sim.tick();
    const p = mustEntity(sim, a);
    p.hp = Math.max(10, p.hp);
    sim.ctx.dealDamage(mob, p, 1, false, 'physical', null, 'hit');
    expectCancelledAndReleased(sim, a, b, mob, timerBefore);
  });

  it('entering combat mid-cast cancels and releases, zero draws', () => {
    const { sim, a, b, mob } = setup();
    const timerBefore = mob.corpseTimer;
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    sim.tick();
    const counter = drawCounter(sim);
    const p = mustEntity(sim, a);
    p.inCombat = true;
    sim.tick();
    expect(counter.stop()).toBe(0);
    expectCancelledAndReleased(sim, a, b, mob, timerBefore);
  });

  it('the caster dying mid-cast cancels and releases (handleDeath may carry its own unrelated draws)', () => {
    const { sim, a, b, mob } = setup();
    const timerBefore = mob.corpseTimer;
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    sim.tick();
    const p = mustEntity(sim, a);
    sim.ctx.handleDeath(p, mob);
    expect(p.castingAbility).toBeNull();
    expect(totalWolfMaterials(sim, a)).toBe(0);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(mob.corpseTimer).toBeLessThanOrEqual(timerBefore);
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(true);
  });

  it('the caster disconnecting mid-cast releases the corpse for someone else', () => {
    const { sim, a, b, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    sim.tick();
    sim.removePlayer(a);
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(true);
  });

  it('the corpse being fully removed (despawned) mid-cast cancels the caster and grants nothing', () => {
    const { sim, a, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    sim.tick();
    const counter = drawCounter(sim);
    sim.ctx.dropEntity(mob.id);
    tickWhileCasting(sim, a);
    expect(counter.stop()).toBe(0);
    expect(mustEntity(sim, a).castingAbility).toBeNull();
    expect(totalWolfMaterials(sim, a)).toBe(0);
    expect(sim.entities.get(mob.id)).toBeUndefined();
  });

  it('the corpse respawning mid-cast (a DIFFERENT lifecycle path from removal) cancels the caster and grants nothing', () => {
    const { sim, a, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    sim.tick();
    // respawnMob reseeds its own wanderTimer via idleRng regardless of any
    // harvest in progress, so this is not a zero-draws assertion: only the
    // OUTCOME (cancelled, nothing granted, no stale claim) is pinned here.
    sim.ctx.respawnMob(mob);
    tickWhileCasting(sim, a);
    expect(mustEntity(sim, a).castingAbility).toBeNull();
    expect(totalWolfMaterials(sim, a)).toBe(0);
    // The respawned body (same entity, now alive) carries no claim from the
    // aborted attempt: it is a fresh mob, not a harvestable replacement corpse.
    expect(mob.harvestClaimedBy).toBeNull();
    expect(mob.dead).toBe(false);
    expect(mob.corpseHarvestState).toBeUndefined();
  });

  it('losing the field kit mid-cast (drop/sell/use elsewhere) cancels and releases, zero draws', () => {
    const { sim, a, b, mob } = setup();
    const timerBefore = mob.corpseTimer;
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    sim.tick();
    const counter = drawCounter(sim);
    sim.removeItem('field_kit', 1, a);
    tickWhileCasting(sim, a);
    expect(counter.stop()).toBe(0);
    expectCancelledAndReleased(sim, a, b, mob, timerBefore);
  });
});

describe('normal loot stays independent of an in-progress harvest cast', () => {
  it('a normal lootCorpse call succeeds while a corpse-harvest cast is running on the same body', () => {
    const { sim, a, mob } = setup();
    mob.loot = { copper: 5, items: [] };
    mob.lootable = true;
    mob.tappedById = a;
    mob.lootFfaTimer = 0;

    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    sim.tick();
    const copperBefore = sim.copper;
    expect(sim.lootCorpse(mob.id, a)).toBe(true);
    expect(sim.copper).toBeGreaterThan(copperBefore);
    // The independent loot take did not touch the still-running harvest cast.
    expect(mustEntity(sim, a).castingAbility).toBe(CORPSE_HARVEST_CAST_ID);
  });
});

describe('two-player contention over one corpse', () => {
  it('the first admitted actor reserves the corpse; the rival is refused with zero draws until release', () => {
    const { sim, a, b, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);

    const counter = drawCounter(sim);
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(false);
    expect(counter.stop()).toBe(0);
    expect(mustEntity(sim, b).castingAbility).toBeNull();

    tickWhileCasting(sim, a);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(totalWolfMaterials(sim, a)).toBeGreaterThan(0);
    expect(totalWolfMaterials(sim, b)).toBe(0);

    // Now claimed (not merely reserved): the rival is still refused.
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(false);
  });
});

// Established precedent (professions/corpse_harvest_grant.ts
// canHarvestMonsterMaterial): an insufficient/absent gather tool DOWNGRADES a
// premium roll to a plain grant, it never refuses the cast outright. The
// Field Kit is the ONLY tool this session's start/complete gates require;
// pinned here as bare-handed-but-kitted completing successfully.
describe('tool state during the cast: downgrade, never a hard refusal', () => {
  it('a bare-handed cast (no gather tool of any kind, Field Kit still carried) completes and grants the plain yield', () => {
    const { sim, a, mob } = setup();
    for (const slot of [...mustMeta(sim, a).inventory]) {
      const def = ITEMS[slot.itemId];
      if (def?.kind === 'tool' && def.id !== 'field_kit')
        sim.removeItem(slot.itemId, slot.count, a);
    }
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    tickWhileCasting(sim, a);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(totalWolfMaterials(sim, a)).toBeGreaterThan(0);
  });
});

describe('completion re-validates rather than trusting admission-time state', () => {
  it('exposes validateCorpseHarvestCast/completeCorpseHarvestCast as the recheck the cast lifecycle drives', () => {
    // Direct-call smoke test of the exported recheck surface (mirrors the
    // gather/craft precedent of a completeCastNow helper in
    // tests/gather_node_harvest.test.ts): a healthy in-progress cast validates
    // true up to completion, and completing it manually lands the same grant
    // the tick-driven path does.
    const { sim, a, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    const p = mustEntity(sim, a);
    const meta = mustMeta(sim, a);
    expect(validateCorpseHarvestCast(sim.ctx, p, meta)).toBe(true);

    p.castingAbility = null;
    p.castRemaining = 0;
    expect(completeCorpseHarvestCast(sim.ctx, p, meta)).toBe(true);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(totalWolfMaterials(sim, a)).toBeGreaterThan(0);
  });

  it('releaseCorpseHarvest is idempotent and safe to call on a player holding no reservation', () => {
    const { sim, a } = setup();
    expect(() => releaseCorpseHarvest(sim.ctx, a)).not.toThrow();
    expect(() => releaseCorpseHarvest(sim.ctx, a)).not.toThrow();
  });
});

// REGRESSION (parent review, cast-integration round): a real start must emit
// castStart exactly like every other profession session (gathering.ts
// harvestNode is the precedent), and a refused start must emit none. The
// current start sets the cast fields directly and never calls ctx.emit for
// castStart at all.
describe('REGRESSION: start emits castStart; a refusal emits none', () => {
  it('a successful start emits exactly the castStart shape (ability/time), no more no less', () => {
    const { sim, a, mob } = setup();
    sim.drainEvents();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    const events = sim.drainEvents();
    expect(events).toContainEqual({
      type: 'castStart',
      entityId: a,
      ability: CORPSE_HARVEST_CAST_ID,
      time: HARVEST_CAST_SECONDS,
    });
  });

  it('a refused start (already claimed) emits no castStart, zero draws', () => {
    const { sim, a, b, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    tickWhileCasting(sim, a);
    sim.drainEvents();
    const counter = drawCounter(sim);
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(false);
    expect(counter.stop()).toBe(0);
    expect(sim.drainEvents().some((e) => e.type === 'castStart')).toBe(false);
  });
});

// REGRESSION (parent review): the session MUST capture the exact shared
// snapshotCorpseHarvestGrantInputs() output (corpse_harvest_grant.ts),
// including wieldRequirementByComponent, not a locally-redefined clone that
// omits it. The frozen denial annotation on a premium-tier gatherDenied event
// depends on this map ever reaching grantCorpseHarvest at all.
describe('REGRESSION: frozen grant inputs must be the real shared snapshot', () => {
  it('the session-captured inputs deep-equal snapshotCorpseHarvestGrantInputs, wieldRequirementByComponent included', () => {
    const { sim, a, mob } = setup();
    const meta = mustMeta(sim, a);
    const componentTags = MOBS[mob.templateId]?.componentTags ?? [];
    // This body's persistent preference is All (the setup() default), which
    // resolves to the canonical empty (spread) pick.
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    const expected = snapshotCorpseHarvestGrantInputs(meta, componentTags, []);
    expect(meta.corpseHarvestSession?.grant.inputs).toEqual(expected);
    expect(meta.corpseHarvestSession?.grant.inputs.wieldRequirementByComponent).toBeDefined();
  });

  it('with no gather tool at all, minWieldRequirementToWorkAny correctly answers null for every family', () => {
    // No tool owned at all (only the Field Kit, which is not a gather tool)
    // is the "plain no-tool arm" shape: null is the CORRECT answer here
    // (wield_gate.ts minWieldRequirementToWorkAny), never a fabricated
    // non-null expectation.
    const { sim, a, mob } = setup();
    const meta = mustMeta(sim, a);
    const componentTags = MOBS[mob.templateId]?.componentTags ?? [];
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    const frozen = meta.corpseHarvestSession?.grant.inputs.wieldRequirementByComponent;
    for (const tag of componentTags) {
      expect(frozen?.[tag], tag).toBeNull();
    }
  });

  it('an owned-but-unwielded mithril_mining_pick freezes the real TIER3_TOOL_WIELD_PROFICIENCY threshold for hide, and it survives a mid-cast proficiency change or tool loss', () => {
    // Same fixture shape as tests/corpse_harvest_grant.test.ts's own
    // "captures the wield-requirement denial hint" case: the pick is OWNED
    // but not yet WIELDABLE (no gatheringProficiency.mining set), which is
    // exactly what makes minWieldRequirementToWorkAny answer a real,
    // non-null threshold instead of the plain no-tool null.
    const { sim, a, mob } = setup();
    const meta = mustMeta(sim, a);
    sim.addItem('mithril_mining_pick', 1, a);
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    const frozen = meta.corpseHarvestSession?.grant.inputs.wieldRequirementByComponent;
    expect(frozen?.hide).toBe(TIER3_TOOL_WIELD_PROFICIENCY);

    // Mutate live state AFTER the freeze, in the direction a live rescan
    // would answer differently: raise mining proficiency (would clear the
    // wield gate) and then strip the tool entirely (a live rescan would
    // answer null). The frozen hint must survive both, unchanged.
    meta.gatheringProficiency.mining = TIER3_TOOL_WIELD_PROFICIENCY;
    expect(meta.corpseHarvestSession?.grant.inputs.wieldRequirementByComponent?.hide).toBe(
      TIER3_TOOL_WIELD_PROFICIENCY,
    );
    sim.removeItem('mithril_mining_pick', 1, a);
    expect(meta.corpseHarvestSession?.grant.inputs.wieldRequirementByComponent?.hide).toBe(
      TIER3_TOOL_WIELD_PROFICIENCY,
    );
  });
});

// REGRESSION (parent review): validate and complete must share every
// frozen-position/leaving/life/claim/kit recheck INDEPENDENT of
// castingAbility, because the coordinator (combat/casting_lifecycle.ts)
// clears castingAbility to null BEFORE calling the completion arm. A direct
// completeCorpseHarvestCast call (the exact shape the coordinator uses) must
// therefore still refuse on a frozen-position displacement or a leaving
// player, never "another 1.5s admission" (no re-running startCorpseHarvest's
// own gates, no requiring castRemaining again).
describe('REGRESSION: completion shares the frozen-position/leaving checks, independent of castingAbility', () => {
  it('a direct completion call after an IN-RANGE displacement from the frozen start position refuses, zero grant/draws, reservation released', () => {
    const { sim, a, b, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    const p = mustEntity(sim, a);
    const meta = mustMeta(sim, a);
    // Still well within INTERACT_RANGE of the corpse, but NOT the frozen
    // start position: the coordinator has already cleared castingAbility by
    // the time this runs, so only the position check can catch this.
    p.pos = sim.groundPos(2, 0);
    p.prevPos = { ...p.pos };
    p.castingAbility = null;
    p.castRemaining = 0;

    const counter = drawCounter(sim);
    expect(completeCorpseHarvestCast(sim.ctx, p, meta)).toBe(false);
    expect(counter.stop()).toBe(0);
    expect(totalWolfMaterials(sim, a)).toBe(0);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(meta.corpseHarvestSession).toBeNull();
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(true);
  });

  it('a direct completion call after meta.leaving refuses, zero grant/draws, reservation released', () => {
    const { sim, a, b, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    const p = mustEntity(sim, a);
    const meta = mustMeta(sim, a);
    meta.leaving = true;
    p.castingAbility = null;
    p.castRemaining = 0;

    const counter = drawCounter(sim);
    expect(completeCorpseHarvestCast(sim.ctx, p, meta)).toBe(false);
    expect(counter.stop()).toBe(0);
    expect(totalWolfMaterials(sim, a)).toBe(0);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(meta.corpseHarvestSession).toBeNull();
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(true);
  });

  it('validateCorpseHarvestCast does not require another full HARVEST_CAST_SECONDS: it runs on castRemaining as found', () => {
    const { sim, a, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    const p = mustEntity(sim, a);
    const meta = mustMeta(sim, a);
    // One tick short of natural completion: a healthy in-flight cast still
    // validates true without needing to restart admission.
    for (let i = 0; i < TICKS_PER_CAST - 1; i++) sim.tick();
    expect(p.castRemaining).toBeGreaterThan(0);
    expect(p.castRemaining).toBeLessThan(HARVEST_CAST_SECONDS);
    expect(validateCorpseHarvestCast(sim.ctx, p, meta)).toBe(true);
  });

  // REGRESSION: dist2d ignores the vertical axis, so a start-position drift
  // check built on it cannot see a PURE vertical displacement. The module's
  // own header states "any movement at all cancels", so this must be false;
  // currently it is not (dist2d(start) is computed in the x/z plane only).
  it('REGRESSION: a pure vertical (y-only) displacement from the frozen start position must invalidate the cast', () => {
    const { sim, a, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    const p = mustEntity(sim, a);
    const meta = mustMeta(sim, a);
    const session = meta.corpseHarvestSession;
    expect(session).toBeTruthy();
    // Same x/z as the frozen start position, a large y-only displacement.
    p.pos = {
      x: session?.startPos.x ?? 0,
      y: (session?.startPos.y ?? 0) + 50,
      z: session?.startPos.z ?? 0,
    };
    expect(validateCorpseHarvestCast(sim.ctx, p, meta)).toBe(false);
  });

  it('a real-tick vertical-only displacement (falling) still cancels the cast end to end', () => {
    const { sim, a, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
    sim.tick();
    const p = mustEntity(sim, a);
    // Airborne, falling straight down, no horizontal input at all: the
    // generic movement/physics pass (not the corpse-harvest-specific
    // position check) is what this pins as the actual cancel path, since
    // validateCorpseHarvestCast's own dist2d(start) check cannot see it.
    p.onGround = false;
    p.vy = -30;
    p.pos.y += 5;
    sim.tick();
    expect(p.castingAbility).toBeNull();
  });
});
