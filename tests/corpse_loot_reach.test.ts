// A big body's corpse is looted from its EDGE, not only from its pivot
// (src/sim/loot/corpse_loot_reach.ts). The Guardian of the Heat dies in the
// middle of its 10.5 yd wellspring: with the classic 5 yd reach measured to
// the corpse's centre nobody could stand close enough to loot it. The reach
// a template's authored bodyRadius adds is the same on the authoritative sim
// (lootCorpse, the walk-by pass, the targeted interact press) and on every
// client mirror (the click, the approach, the nearby interact press, the
// loot popup's drift), so the client never offers a loot the server refuses
// nor refuses one the server would grant. A mob with no bodyRadius keeps the
// classic 5 yd reach exactly.

import { describe, expect, it } from 'vitest';
import { pickedEntityApproachPoint, shouldApproachPickedEntity } from '../src/game/interactions';
import { resolveNearbyInteractionCandidate } from '../src/game/nearby_interaction_core';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import { HEAT_GUARDIAN, HEAT_WELL_R } from '../src/sim/encounters/smith_heart/heat_ids';
import { smithHeartLootSpot } from '../src/sim/encounters/smith_heart/loot_spots';
import { corpseLootReach, maxCorpseLootReach } from '../src/sim/loot/corpse_loot_reach';
import { ACTIONS, encodeObs } from '../src/sim/obs';
import { type InstanceSlot, Sim } from '../src/sim/sim';
import { type Entity, INTERACT_RANGE, type QuestProgress } from '../src/sim/types';

function deadHeatGuardianWithLoot(): { sim: Sim; boss: Entity } {
  const sim = new Sim({ seed: 31, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, sim.player.id);
  sim.setPlayerLevel(20);
  expect(dev('/dev heart tp heat')).toBe(true);
  sim.tick();
  const dungeon = DUNGEONS[SMITH_HEART_DUNGEON];
  const inst: InstanceSlot | undefined = sim.ctx.instances.find((i) => {
    if (i.dungeonId !== SMITH_HEART_DUNGEON || i.partyKey === null || i.exitId === null)
      return false;
    const o = instanceOrigin(dungeon.index, i.slot);
    return Math.abs(sim.player.pos.x - o.x) < 300 && Math.abs(sim.player.pos.z - o.z) < 250;
  });
  if (!inst) throw new Error('no claim');
  const boss = inst.mobIds
    .map((id) => sim.ctx.entities.get(id))
    .find((e) => e?.templateId === HEAT_GUARDIAN);
  if (!boss) throw new Error('no guardian');
  expect(dev('/dev heart kill heat')).toBe(true);
  sim.tick();
  expect(dev('/dev heart loot heat')).toBe(true);
  expect(boss.dead && boss.lootable).toBe(true);
  return { sim, boss };
}

function stub(overrides: Partial<Entity> & Pick<Entity, 'id' | 'kind'>): Entity {
  return {
    templateId: 'test',
    name: 'Test',
    pos: { x: 0, y: 0, z: 0 },
    dead: false,
    ghost: false,
    lootable: false,
    loot: null,
    tappedById: null,
    harvestClaimedBy: null,
    dungeonId: null,
    ...overrides,
  } as Entity;
}

describe('corpse loot reach', () => {
  it('is the classic 5 yd for a mob with no authored body, and the body edge plus 5 for a big one', () => {
    expect(MOBS.wolf?.bodyRadius).toBeUndefined();
    expect(corpseLootReach({ kind: 'mob', templateId: 'wolf' })).toBe(INTERACT_RANGE);
    expect(corpseLootReach({ kind: 'player', templateId: 'player' })).toBe(INTERACT_RANGE);
    expect(MOBS[HEAT_GUARDIAN]?.bodyRadius).toBe(HEAT_WELL_R);
    expect(corpseLootReach({ kind: 'mob', templateId: HEAT_GUARDIAN })).toBe(
      HEAT_WELL_R + INTERACT_RANGE,
    );
  });

  it('lets a looter on the wellspring lip loot the Guardian of the Heat (the real sim path)', () => {
    const { sim, boss } = deadHeatGuardianWithLoot();
    // Standing on the shore one yard past the burning lip.
    sim.player.pos = { ...boss.pos, x: boss.pos.x + HEAT_WELL_R + 1 };
    const before = sim.ctx.players.get(sim.player.id)?.copper ?? 0;
    expect(sim.lootCorpse(boss.id)).toBe(true);
    expect((sim.ctx.players.get(sim.player.id)?.copper ?? 0) - before).toBeGreaterThan(0);
    expect(boss.lootable).toBe(false);
  });

  it('answers the interact press from the lip, targeted or not, and the RL obs agrees', () => {
    const targeted = deadHeatGuardianWithLoot();
    targeted.sim.player.pos = { ...targeted.boss.pos, x: targeted.boss.pos.x + HEAT_WELL_R + 1 };
    targeted.sim.player.targetId = targeted.boss.id;
    targeted.sim.interact();
    expect(targeted.boss.lootable).toBe(false);

    const { sim, boss } = deadHeatGuardianWithLoot();
    sim.player.pos = { ...boss.pos, x: boss.pos.x + HEAT_WELL_R + 1 };
    sim.player.targetId = null;
    sim.rebucket(sim.player);
    // The RL observation's proximity slot advertises the corpse the press will take.
    const slot = 16 + (ACTIONS.length - 13) * 2 + 9 + 5 * 6;
    const obs = encodeObs(sim);
    expect(obs[slot]).toBe(1);
    expect(obs[slot + 4]).toBeCloseTo(0.33, 5);
    sim.interact();
    expect(boss.lootable).toBe(false);
    expect(maxCorpseLootReach()).toBeGreaterThanOrEqual(HEAT_WELL_R + INTERACT_RANGE);
  });

  it('walk-by autoloot reaches a big open-world body from its edge, and not past it', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false });
    const mob = [...sim.ctx.entities.values()].find(
      (e) => e.kind === 'mob' && e.hostile && !(MOBS[e.templateId]?.bodyRadius ?? 0),
    );
    if (!mob) throw new Error('no mob');
    // A dungeon boss body (Ysolei, bodyRadius 10) lying in the open world.
    const r = MOBS.ysolei?.bodyRadius ?? 0;
    expect(r).toBeGreaterThan(5);
    mob.templateId = 'ysolei';
    mob.dead = true;
    mob.hp = 0;
    mob.corpseTimer = 60;
    mob.lootable = true;
    mob.tappedById = sim.player.id;
    mob.loot = { copper: 9, items: [] };
    sim.player.pos = { ...mob.pos, x: mob.pos.x + r + INTERACT_RANGE + 0.5 };
    sim.autoLoot(mob.id);
    expect(mob.loot?.copper).toBe(9);
    sim.player.pos = { ...mob.pos, x: mob.pos.x + r + INTERACT_RANGE - 1 };
    sim.autoLoot(mob.id);
    expect(mob.lootable).toBe(false);
  });

  it("takes a guardian's loot at its coffer's authored spot, far from the body (the real sim path)", () => {
    const { sim, boss } = deadHeatGuardianWithLoot();
    const spot = smithHeartLootSpot(HEAT_GUARDIAN, boss.pos.z);
    if (!spot) throw new Error('no spot');
    // The coffer stands well past the body-edge reach on open floor.
    expect(Math.hypot(spot.x - boss.pos.x, spot.z - boss.pos.z)).toBeGreaterThan(
      HEAT_WELL_R + INTERACT_RANGE,
    );
    // Neither at the body's edge nor at the coffer: refused.
    sim.player.pos = { ...boss.pos, x: spot.x + INTERACT_RANGE + 1, z: spot.z };
    expect(sim.lootCorpse(boss.id)).toBe(false);
    // In front of the coffer: the loot is taken.
    sim.player.pos = {
      ...boss.pos,
      x: spot.x + Math.sin(spot.yaw) * 1.8,
      z: spot.z + Math.cos(spot.yaw) * 1.8,
    };
    expect(sim.lootCorpse(boss.id)).toBe(true);
    expect(boss.lootable).toBe(false);
  });

  it('offers the press and the click at the coffer on the client, and walks the click there', () => {
    const { boss } = deadHeatGuardianWithLoot();
    const spot = smithHeartLootSpot(HEAT_GUARDIAN, boss.pos.z);
    if (!spot) throw new Error('no spot');
    const body = { ...boss, tappedById: 1 } as Entity;
    const atCoffer = stub({ id: 1, kind: 'player', pos: { x: spot.x + 1.5, y: 0, z: spot.z } });
    expect(shouldApproachPickedEntity(atCoffer, body, false)).toBe(false);
    const world = {
      playerId: 1,
      player: atCoffer,
      entities: new Map<number, Entity>([
        [1, atCoffer],
        [body.id, body],
      ]),
      questLog: new Map<string, QuestProgress>(),
      farmPatches: [],
    };
    expect(resolveNearbyInteractionCandidate(world)?.id).toBe(body.id);
    // From across the hall the click walks the looter to the coffer, not into the well.
    const far = stub({ id: 1, kind: 'player', pos: { x: spot.x + 30, y: 0, z: spot.z } });
    expect(shouldApproachPickedEntity(far, body, false)).toBe(true);
    expect(pickedEntityApproachPoint(body)).toEqual({ x: spot.x, z: spot.z });
  });

  it('still refuses past the body edge reach', () => {
    const { sim, boss } = deadHeatGuardianWithLoot();
    sim.player.pos = { ...boss.pos, x: boss.pos.x + HEAT_WELL_R + INTERACT_RANGE + 0.5 };
    expect(sim.lootCorpse(boss.id)).toBe(false);
    expect(boss.lootable).toBe(true);
  });

  it('keeps the classic 5 yd reach for an ordinary corpse on the sim', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false });
    const mob = [...sim.ctx.entities.values()].find(
      (e) => e.kind === 'mob' && e.hostile && !(MOBS[e.templateId]?.bodyRadius ?? 0),
    );
    if (!mob) throw new Error('no mob');
    mob.dead = true;
    mob.hp = 0;
    mob.corpseTimer = 60;
    mob.lootable = true;
    mob.tappedById = sim.player.id;
    mob.loot = { copper: 7, items: [] };
    sim.player.pos = { ...mob.pos, x: mob.pos.x + INTERACT_RANGE + 0.5 };
    expect(sim.lootCorpse(mob.id)).toBe(false);
    sim.player.pos = { ...mob.pos, x: mob.pos.x + INTERACT_RANGE - 0.5 };
    expect(sim.lootCorpse(mob.id)).toBe(true);
  });

  it('mirrors the same reach on the client: no approach from the lip, and the press offers it', () => {
    const player = stub({ id: 1, kind: 'player', pos: { x: HEAT_WELL_R + 1, y: 0, z: 0 } });
    const body = stub({
      id: 2,
      kind: 'mob',
      templateId: HEAT_GUARDIAN,
      dead: true,
      lootable: true,
      tappedById: 1,
      loot: { copper: 5, items: [] },
    });
    // From the lip the click opens the loot in place; nothing to walk into.
    expect(shouldApproachPickedEntity(player, body, false)).toBe(false);
    const world = {
      playerId: 1,
      player,
      entities: new Map<number, Entity>([
        [1, player],
        [2, body],
      ]),
      questLog: new Map<string, QuestProgress>(),
      farmPatches: [],
    };
    expect(resolveNearbyInteractionCandidate(world)?.id).toBe(2);
    // An ordinary body that far away is out of reach of the press.
    const plain = { ...body, templateId: 'wolf' };
    world.entities.set(2, plain);
    expect(resolveNearbyInteractionCandidate(world)).toBeNull();
    expect(shouldApproachPickedEntity(player, plain, false)).toBe(true);
  });
});
