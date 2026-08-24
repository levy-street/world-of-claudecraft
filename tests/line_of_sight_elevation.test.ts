import { describe, expect, it } from 'vitest';
import { colliderInternalsForTest, lineOfSightClear, supportHeightAt } from '../src/sim/colliders';
import { RESURRECTION_RANGE, resurrectionReachError } from '../src/sim/combat/resurrection_reach';
import { MOBS } from '../src/sim/data';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import { createMob } from '../src/sim/entity';
import { entityLineOfSightClear } from '../src/sim/line_of_sight_elevation';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

function player(sim: Sim, id: number): Entity {
  const entity = sim.entities.get(id);
  if (!entity) throw new Error(`missing player ${id}`);
  return entity;
}

function place(
  sim: Sim,
  entity: Entity,
  pos: { x: number; y: number; z: number },
  grounded: boolean,
): void {
  entity.pos = { ...pos };
  entity.prevPos = { ...pos };
  entity.vx = 0;
  entity.vy = 0;
  entity.vz = 0;
  entity.onGround = grounded;
  entity.jumping = !grounded;
  entity.fallStartY = pos.y;
  sim.rebucket(entity);
}

function tickUntilIdle(sim: Sim, caster: Entity, maxTicks = 80): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < maxTicks && caster.castingAbility !== null; tick++) {
    events.push(...sim.tick());
  }
  return events;
}

function makeSim(playerClass: 'hunter' | 'mage' | 'priest', seed = WORLD_SEED): Sim {
  return new Sim({ seed, playerClass, autoEquip: true, noPlayer: true });
}

function canopyHeight(): number {
  const stall = EASTBROOK_LAYOUT.market.stalls[0];
  return supportHeightAt(
    WORLD_SEED,
    stall.position.x,
    stall.position.z,
    PLAYER_BODY_RADIUS,
    groundHeight(stall.position.x, stall.position.z, WORLD_SEED) + stall.height,
  );
}

function placeOnCanopy(sim: Sim, entity: Entity): void {
  const stall = EASTBROOK_LAYOUT.market.stalls[0];
  place(sim, entity, { x: stall.position.x, y: canopyHeight(), z: stall.position.z }, true);
}

function addWolf(sim: Sim, id: number, x: number, z: number): Entity {
  const wolf = createMob(id, MOBS.forest_wolf, 1, {
    x,
    y: groundHeight(x, z, sim.cfg.seed),
    z,
  });
  sim.entities.set(wolf.id, wolf);
  sim.rebucket(wolf);
  return wolf;
}

describe('grounded line-of-sight elevation', () => {
  it('lets Whispered Prayer heal from the supported Eastbrook market canopy', () => {
    const sim = makeSim('priest');
    const healerId = sim.addPlayer('priest', 'Healer');
    const allyId = sim.addPlayer('warrior', 'Ally');
    const healer = player(sim, healerId);
    const ally = player(sim, allyId);
    const stall = EASTBROOK_LAYOUT.market.stalls[0];
    const terrainY = groundHeight(stall.position.x, stall.position.z, WORLD_SEED);
    const canopyY = supportHeightAt(
      WORLD_SEED,
      stall.position.x,
      stall.position.z,
      PLAYER_BODY_RADIUS,
      terrainY + stall.height,
    );

    expect(stall.id).toBe('eastbrook_market_stall_world_market');
    expect(stall.height).toBe(2.7);
    expect(terrainY).toBeCloseTo(1.5);
    expect(canopyY).toBeCloseTo(terrainY + stall.height);
    const stallCollider = colliderInternalsForTest
      .staticWorldColliders(WORLD_SEED)
      .find(
        (collider) =>
          collider.type === 'obb' &&
          collider.x === stall.position.x &&
          collider.z === stall.position.z,
      );
    expect(stallCollider).toMatchObject({
      cameraTopY: canopyY,
      moveTopY: canopyY,
      standable: true,
    });

    place(sim, healer, { x: stall.position.x, y: canopyY, z: stall.position.z }, true);
    const allyPos = {
      x: stall.position.x,
      y: groundHeight(stall.position.x, stall.position.z + 8, WORLD_SEED),
      z: stall.position.z + 8,
    };
    place(sim, ally, allyPos, true);
    ally.hp = 1;
    healer.resource = healer.maxResource;
    healer.gcdRemaining = 0;
    sim.drainEvents();

    expect(lineOfSightClear(WORLD_SEED, healer.pos, ally.pos)).toBe(false);
    sim.castAbilityOn('lesser_heal', allyId, healerId);
    const startEvents = sim.drainEvents();

    expect(startEvents).toContainEqual(
      expect.objectContaining({ type: 'castStart', entityId: healerId, ability: 'lesser_heal' }),
    );
    expect(startEvents).not.toContainEqual(
      expect.objectContaining({ type: 'error', text: 'Line of sight.' }),
    );

    const completionEvents = tickUntilIdle(sim, healer);
    const heal = completionEvents.find(
      (event) => event.type === 'heal2' && event.sourceId === healerId && event.targetId === allyId,
    );
    expect(heal).toMatchObject({ ability: 'Whispered Prayer' });
    expect(heal?.type === 'heal2' ? heal.amount : 0).toBeGreaterThan(0);
    expect(ally.hp).toBeGreaterThan(1);
  });

  it('uses supported elevation for an elevated friendly target too', () => {
    const sim = makeSim('priest');
    const healerId = sim.addPlayer('priest', 'Healer');
    const allyId = sim.addPlayer('warrior', 'Ally');
    const healer = player(sim, healerId);
    const ally = player(sim, allyId);
    const stall = EASTBROOK_LAYOUT.market.stalls[0];

    place(
      sim,
      healer,
      {
        x: stall.position.x,
        y: groundHeight(stall.position.x, stall.position.z + 8, WORLD_SEED),
        z: stall.position.z + 8,
      },
      true,
    );
    placeOnCanopy(sim, ally);
    ally.hp = 1;

    sim.castAbilityOn('lesser_heal', allyId, healerId);
    const events = sim.drainEvents();

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'castStart', entityId: healerId, ability: 'lesser_heal' }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: 'error', text: 'Line of sight.' }),
    );
  });

  it('keeps a player visible throughout a jump from the supported canopy', () => {
    const sim = makeSim('priest');
    const watcherId = sim.addPlayer('priest', 'Watcher');
    const hopperId = sim.addPlayer('priest', 'Hopper');
    const watcher = player(sim, watcherId);
    const hopper = player(sim, hopperId);
    const hopperMeta = sim.players.get(hopperId);
    if (!hopperMeta) throw new Error('missing hopper metadata');
    const stall = EASTBROOK_LAYOUT.market.stalls[0];
    const supportedY = canopyHeight();

    place(
      sim,
      watcher,
      {
        x: stall.position.x,
        y: groundHeight(stall.position.x, stall.position.z + 8, WORLD_SEED),
        z: stall.position.z + 8,
      },
      true,
    );
    placeOnCanopy(sim, hopper);
    const hasLineOfSight = (source: Entity, target: Entity): boolean =>
      (
        sim as unknown as {
          hasLineOfSight(source: Entity, target: Entity): boolean;
        }
      ).hasLineOfSight(source, target);

    expect(hasLineOfSight(watcher, hopper)).toBe(true);
    hopperMeta.moveInput.jump = true;
    let airborneTicks = 0;
    let apexY = supportedY;
    for (let tick = 0; tick <= 14; tick++) {
      sim.tick();
      hopperMeta.moveInput.jump = false;
      if (!hopper.onGround) airborneTicks++;
      apexY = Math.max(apexY, hopper.pos.y);
      expect(hasLineOfSight(watcher, hopper), `watcher lost hopper at jump tick ${tick}`).toBe(
        true,
      );
      expect(hasLineOfSight(hopper, watcher), `hopper lost watcher at jump tick ${tick}`).toBe(
        true,
      );
    }

    expect(airborneTicks).toBeGreaterThan(0);
    expect(apexY).toBeGreaterThan(supportedY);
    expect(hopper.pos.y).toBe(supportedY);
    expect(hopper.onGround).toBe(true);
  });

  it('lets a hostile ranged spell complete from the same supported canopy', () => {
    const sim = makeSim('mage');
    const casterId = sim.addPlayer('mage', 'Caster');
    const caster = player(sim, casterId);
    const stall = EASTBROOK_LAYOUT.market.stalls[0];
    const wolf = addWolf(sim, 990_352_301, stall.position.x, stall.position.z + 8);

    placeOnCanopy(sim, caster);
    caster.facing = Math.atan2(wolf.pos.x - caster.pos.x, wolf.pos.z - caster.pos.z);
    sim.targetEntity(wolf.id, casterId);
    sim.castAbility('fireball', casterId);
    const startEvents = sim.drainEvents();

    expect(startEvents).toContainEqual(
      expect.objectContaining({ type: 'castStart', entityId: casterId, ability: 'fireball' }),
    );
    expect(startEvents).not.toContainEqual(
      expect.objectContaining({ type: 'error', text: 'Line of sight.' }),
    );

    const completionEvents = tickUntilIdle(sim, caster);
    expect(completionEvents).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        sourceId: casterId,
        targetId: wolf.id,
        school: 'fire',
        fx: 'projectile',
        ability: 'fireball',
      }),
    );
    expect(completionEvents).not.toContainEqual(
      expect.objectContaining({ type: 'error', text: 'Line of sight.' }),
    );
  });

  it('uses the same supported source elevation for resurrection reach', () => {
    const sim = makeSim('priest');
    const casterId = sim.addPlayer('priest', 'Caster');
    const fallenId = sim.addPlayer('warrior', 'Fallen');
    const caster = player(sim, casterId);
    const fallen = player(sim, fallenId);
    const stall = EASTBROOK_LAYOUT.market.stalls[0];

    placeOnCanopy(sim, caster);
    place(
      sim,
      fallen,
      {
        x: stall.position.x,
        y: groundHeight(stall.position.x, stall.position.z + 8, WORLD_SEED),
        z: stall.position.z + 8,
      },
      true,
    );
    fallen.dead = true;
    fallen.hp = 0;
    fallen.corpsePos = { ...fallen.pos };

    expect(resurrectionReachError(sim.ctx, caster, fallen, RESURRECTION_RANGE)).toBeNull();
  });

  it('uses the same supported elevation for an elevated resurrection body', () => {
    const sim = makeSim('priest');
    const casterId = sim.addPlayer('priest', 'Caster');
    const fallenId = sim.addPlayer('warrior', 'Fallen');
    const caster = player(sim, casterId);
    const fallen = player(sim, fallenId);
    const stall = EASTBROOK_LAYOUT.market.stalls[0];

    place(
      sim,
      caster,
      {
        x: stall.position.x,
        y: groundHeight(stall.position.x, stall.position.z + 8, WORLD_SEED),
        z: stall.position.z + 8,
      },
      true,
    );
    placeOnCanopy(sim, fallen);
    fallen.dead = true;
    fallen.hp = 0;
    fallen.corpsePos = { ...fallen.pos };

    expect(resurrectionReachError(sim.ctx, caster, fallen, RESURRECTION_RANGE)).toBeNull();
  });

  it('lets ranged auto-attack fire from the same supported canopy', () => {
    const sim = makeSim('hunter');
    const hunterId = sim.addPlayer('hunter', 'Hunter');
    const hunter = player(sim, hunterId);
    const stall = EASTBROOK_LAYOUT.market.stalls[0];
    const wolf = addWolf(sim, 990_352_302, stall.position.x, stall.position.z + 8);

    placeOnCanopy(sim, hunter);
    hunter.facing = Math.atan2(wolf.pos.x - hunter.pos.x, wolf.pos.z - hunter.pos.z);
    sim.targetEntity(wolf.id, hunterId);
    sim.startAutoAttack(hunterId);
    hunter.swingTimer = 0;

    const events = sim.tick();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        sourceId: hunterId,
        targetId: wolf.id,
        fx: 'projectile',
      }),
    );
    expect(hunter.swingTimer).toBeGreaterThan(0);
  });

  it('does not grant canopy support to non-player line-of-sight endpoints', () => {
    const sim = makeSim('priest');
    const watcherId = sim.addPlayer('priest', 'Watcher');
    const watcher = player(sim, watcherId);
    const stall = EASTBROOK_LAYOUT.market.stalls[0];
    const wolf = addWolf(sim, 990_352_303, stall.position.x, stall.position.z);

    place(
      sim,
      watcher,
      {
        x: stall.position.x,
        y: groundHeight(stall.position.x, stall.position.z + 8, WORLD_SEED),
        z: stall.position.z + 8,
      },
      true,
    );
    placeOnCanopy(sim, wolf);

    expect(wolf.kind).toBe('mob');
    expect(entityLineOfSightClear(WORLD_SEED, watcher, wolf)).toBe(false);
    expect(entityLineOfSightClear(WORLD_SEED, wolf, watcher)).toBe(false);
  });

  it('keeps a jumping healer behind ordinary open-world cover blocked', () => {
    const seed = 42;
    const sim = makeSim('priest', seed);
    const healerId = sim.addPlayer('priest', 'Jumper');
    const allyId = sim.addPlayer('warrior', 'Ally');
    const healer = player(sim, healerId);
    const ally = player(sim, allyId);
    const from = { x: -186, z: 168 };
    const to = { x: -168, z: 168 };

    place(sim, healer, { x: from.x, y: groundHeight(from.x, from.z, seed) + 3, z: from.z }, false);
    place(sim, ally, { x: to.x, y: groundHeight(to.x, to.z, seed), z: to.z }, true);
    ally.hp = 1;
    healer.resource = healer.maxResource;
    healer.gcdRemaining = 0;
    const resourceBefore = healer.resource;

    expect(lineOfSightClear(seed, healer.pos, ally.pos)).toBe(false);
    expect(
      lineOfSightClear(seed, healer.pos, ally.pos, 0.05, undefined, 0, {
        from: healer.pos.y,
      }),
      'the lifted eye would clear this cover if airborne y were trusted',
    ).toBe(true);

    sim.drainEvents();
    sim.castAbilityOn('lesser_heal', allyId, healerId);
    const events = sim.drainEvents();

    expect(healer.castingAbility).toBeNull();
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'castStart' }));
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'Line of sight.' }),
    );
    expect(healer.resource).toBe(resourceBefore);
    expect(healer.gcdRemaining).toBe(0);
    expect(ally.hp).toBe(1);
  });
});
