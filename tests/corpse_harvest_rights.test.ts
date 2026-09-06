// Intentional Gathering (PR3): who is ALLOWED to start a corpse-harvest cast,
// as a function of kill-credit participation at death, never current party
// membership or display names. Complements tests/corpse_harvest_cast.test.ts
// (which owns the cast lifecycle itself) and tests/harvest_admission.test.ts
// (which owns the pure admission decision, including the priority-window
// arithmetic). This file is the real-Sim wiring: recordCorpseHarvestDeath
// snapshotting the eligible group at the moment of death, then
// startCorpseHarvest honoring that snapshot for HARVEST_PRIORITY_SECONDS.
// The FIRST describe block below drives the snapshot through a real kill
// (ctx.dealDamage -> handleDeath -> recordCorpseHarvestDeath), proving the
// production hook is actually wired; every other block calls
// recordCorpseHarvestDeath directly as a decisive unit-level lever over the
// admission rule itself.
//
// Stable priority identity: professions/harvest_admission.ts
// `harvestPriorityKeyFor` keys on a trusted `PlayerMeta.gathererIdentity`
// (`character:<id>` / `offline:<id>` / `headless:<id>`) when present, else
// `entity:<id>`. The rejoin case below exercises the `character:<id>` arm
// via an explicit `characterId` on addPlayer, the same authoritative id the
// server supplies from the character row.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOBS, setActiveWorldContent } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  corpseHarvestDenialText,
  recordCorpseHarvestDeath,
  startCorpseHarvest,
} from '../src/sim/professions/corpse_harvest_session';
import { HARVEST_PRIORITY_SECONDS } from '../src/sim/professions/harvest_admission';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { expectDefined } from './helpers/defined';
import { EMPTY_TEST_WORLD } from './sim_shared';

const CORPSE_TEST_WORLD: WorldContent = { ...EMPTY_TEST_WORLD, roads: [] };

beforeAll(() => setActiveWorldContent(CORPSE_TEST_WORLD));
afterAll(() => setActiveWorldContent(null));

function mustEntity(sim: Sim, pid: number): Entity {
  return expectDefined(sim.entities.get(pid));
}

function mustMeta(sim: Sim, pid: number): PlayerMeta {
  return expectDefined(sim.players.get(pid));
}

function placeCoherently(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos = sim.groundPos(x, z);
  e.prevPos = { ...e.pos };
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
  e.onGround = true;
}

function spawnWolfCorpse(sim: Sim, id: number): Entity {
  const template = MOBS.forest_wolf;
  const mob = createMob(id, template, template.maxLevel, sim.groundPos(0, 0));
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  sim.entities.set(mob.id, mob);
  return mob;
}

function addFieldKitPlayer(sim: Sim, name: string): number {
  const pid = sim.addPlayer('warrior', name);
  placeCoherently(sim, mustEntity(sim, pid), 0, 0);
  sim.addItem('field_kit', 1, pid);
  return pid;
}

function setup() {
  const sim = new Sim({
    seed: 21,
    playerClass: 'warrior',
    noPlayer: true,
    world: CORPSE_TEST_WORLD,
  });
  const a = addFieldKitPlayer(sim, 'Alpha');
  const b = addFieldKitPlayer(sim, 'Bravo');
  sim.tick();
  const mob = spawnWolfCorpse(sim, 9999);
  return { sim, a, b, mob };
}

describe('the real death hook: recordCorpseHarvestDeath is actually wired into handleDeath', () => {
  it('a live kill snapshots the killer and holds a bystander out for the window', () => {
    const sim = new Sim({
      seed: 31,
      playerClass: 'warrior',
      noPlayer: true,
      world: CORPSE_TEST_WORLD,
    });
    const killerPid = addFieldKitPlayer(sim, 'Killer');
    const bystanderPid = addFieldKitPlayer(sim, 'Bystander');
    sim.tick();

    const template = MOBS.forest_wolf;
    const mob = createMob(7001, template, template.maxLevel, sim.groundPos(0, 0));
    mob.dead = false;
    mob.hp = mob.maxHp;
    mob.tappedById = killerPid;
    sim.entities.set(mob.id, mob);

    const killer = mustEntity(sim, killerPid);
    // A single lethal, fully-mitigated hit through the real damage/death hub:
    // dealDamage's post-mitigation path calls handleDeath, which calls
    // recordCorpseHarvestDeath with the real eligible-credit list, not a
    // hand-built one.
    sim.ctx.dealDamage(killer, mob, mob.maxHp + 999, false, 'physical', null, 'hit');

    expect(mob.dead).toBe(true);
    expect(mob.corpseHarvestState).toBeDefined();
    expect(mob.corpseHarvestState?.priorityMemberKeys.length).toBeGreaterThan(0);

    // Landing the killing blow puts the killer IN COMBAT (the real
    // in-combat gate is correct and must not be weakened to make this
    // fixture pass): let real sim ticks clear it via the ordinary
    // combatTimer/COMBAT_LINGER decay, well inside the still-open
    // HARVEST_PRIORITY_SECONDS window, before testing priority admission.
    for (let i = 0; i < 110 && killer.inCombat; i++) sim.tick();
    expect(killer.inCombat).toBe(false);
    expect(killer.dead).toBe(false);
    const remaining = (mob.corpseHarvestState?.priorityEndsAt ?? 0) - sim.time;
    expect(remaining).toBeGreaterThan(0);
    sim.drainEvents();

    // The bystander's refusal must be the PRIORITY gate specifically, not an
    // unrelated dead/combat/range denial that would pass for the wrong
    // reason.
    expect(startCorpseHarvest(sim.ctx, mob.id, bystanderPid)).toBe(false);
    const bystanderErrors = sim
      .drainEvents()
      .filter((e): e is Extract<typeof e, { type: 'error' }> => e.type === 'error');
    expect(bystanderErrors).toEqual([
      { type: 'error', pid: bystanderPid, text: corpseHarvestDenialText('priority_protected') },
    ]);

    expect(startCorpseHarvest(sim.ctx, mob.id, killerPid)).toBe(true);
  });

  it('an untapped, uncredited kill still records an (empty) snapshot: the corpse is public at once', () => {
    // No tapper and no killer entity at all (e.g. environmental damage):
    // heroicRewardRecipients is [] and the corpse must still be openly
    // harvestable, never stuck unrecorded.
    const sim = new Sim({
      seed: 32,
      playerClass: 'warrior',
      noPlayer: true,
      world: CORPSE_TEST_WORLD,
    });
    const bystanderPid = addFieldKitPlayer(sim, 'Bystander');
    sim.tick();
    const template = MOBS.forest_wolf;
    const mob = createMob(7002, template, template.maxLevel, sim.groundPos(0, 0));
    mob.dead = false;
    mob.hp = mob.maxHp;
    sim.entities.set(mob.id, mob);

    sim.ctx.handleDeath(mob, null);

    expect(mob.dead).toBe(true);
    expect(mob.corpseHarvestState?.priorityMemberKeys).toEqual([]);
    expect(startCorpseHarvest(sim.ctx, mob.id, bystanderPid)).toBe(true);
  });
});

describe('kill-credit priority: only the death-snapshot group, and only for the window', () => {
  it('holds a non-member out while the window is open and admits the recorded killer', () => {
    const { sim, a, b, mob } = setup();
    recordCorpseHarvestDeath(sim.ctx, mob, [mustMeta(sim, a)]);

    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(false);
    expect(mustEntity(sim, b).castingAbility).toBeNull();

    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
  });

  it('opens to everyone once HARVEST_PRIORITY_SECONDS has elapsed', () => {
    const { sim, a, b, mob } = setup();
    recordCorpseHarvestDeath(sim.ctx, mob, [mustMeta(sim, a)]);
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(false);

    sim.time += HARVEST_PRIORITY_SECONDS;
    sim.tick();

    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(true);
  });

  it('is public immediately when the death snapshot named nobody', () => {
    const { sim, b, mob } = setup();
    recordCorpseHarvestDeath(sim.ctx, mob, []);
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(true);
  });
});

describe('current party membership is not the rule: only the death snapshot is', () => {
  it("joining the killer's party AFTER the kill grants no priority", () => {
    const { sim, a, b, mob } = setup();
    // The snapshot names ONLY a, taken before b ever joins a's party.
    recordCorpseHarvestDeath(sim.ctx, mob, [mustMeta(sim, a)]);

    // a invites b, b accepts: b is now a's party member, but only AFTER death.
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    expect(sim.partyOf(a)?.members).toContain(b);

    // Still refused: the snapshot, not live membership, governs admission.
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(false);
  });

  it('a player already in the snapshot keeps their admission even after leaving the party', () => {
    const { sim, a, b, mob } = setup();
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    recordCorpseHarvestDeath(sim.ctx, mob, [mustMeta(sim, a), mustMeta(sim, b)]);

    sim.partyLeave(b);
    expect(sim.partyOf(b)).toBeNull();

    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(true);
  });
});

describe('same display name, different characters: identity is by entity, not by name', () => {
  it('a same-named bystander gets no priority a namesake killer earned', () => {
    const sim = new Sim({
      seed: 22,
      playerClass: 'warrior',
      noPlayer: true,
      world: CORPSE_TEST_WORLD,
    });
    const killer = addFieldKitPlayer(sim, 'Alpha');
    const namesake = addFieldKitPlayer(sim, 'Alpha'); // same display name, distinct entity
    sim.tick();
    const mob = spawnWolfCorpse(sim, 9999);

    recordCorpseHarvestDeath(sim.ctx, mob, [mustMeta(sim, killer)]);

    expect(startCorpseHarvest(sim.ctx, mob.id, namesake)).toBe(false);
    expect(startCorpseHarvest(sim.ctx, mob.id, killer)).toBe(true);
  });
});

describe('stable host character identity survives an entity rejoin', () => {
  it('the same character reconnecting under a fresh entity id keeps its death-snapshot admission', () => {
    const sim = new Sim({
      seed: 23,
      playerClass: 'warrior',
      noPlayer: true,
      world: CORPSE_TEST_WORLD,
    });
    const killerPid = sim.addPlayer('warrior', 'Alpha', { characterId: 777 });
    const bystanderPid = addFieldKitPlayer(sim, 'Bravo');
    placeCoherently(sim, mustEntity(sim, killerPid), 0, 0);
    sim.addItem('field_kit', 1, killerPid);
    sim.tick();
    const mob = spawnWolfCorpse(sim, 9999);

    recordCorpseHarvestDeath(sim.ctx, mob, [mustMeta(sim, killerPid)]);

    // Disconnect and reconnect the SAME character (same characterId), which
    // mints a brand-new entity id: a raw entityId-keyed snapshot would now
    // treat the returning player as a stranger.
    const savedState = sim.serializeCharacter(killerPid);
    sim.removePlayer(killerPid);
    const rejoinedPid = sim.addPlayer('warrior', 'Alpha', {
      characterId: 777,
      state: savedState ?? undefined,
    });
    expect(rejoinedPid).not.toBe(killerPid);
    placeCoherently(sim, mustEntity(sim, rejoinedPid), 0, 0);
    sim.addItem('field_kit', 1, rejoinedPid);

    expect(startCorpseHarvest(sim.ctx, mob.id, rejoinedPid)).toBe(true);
    // The bystander, who was never in the snapshot, is still refused.
    expect(startCorpseHarvest(sim.ctx, mob.id, bystanderPid)).toBe(false);
  });
});
