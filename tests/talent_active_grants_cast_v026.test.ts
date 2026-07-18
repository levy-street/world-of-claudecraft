import { describe, expect, it } from 'vitest';
import { ROW_TREES } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, type Aura, type Entity, type SimEvent } from '../src/sim/types';

function addTarget(sim: Sim, distance: number): Entity {
  const player = sim.player;
  const mob = createMob(20_000 + sim.entities.size, MOBS.forest_wolf, 20, {
    x: player.pos.x + distance,
    y: player.pos.y,
    z: player.pos.z,
  });
  mob.hostile = true;
  mob.maxHp = 100_000;
  mob.hp = mob.maxHp;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  player.facing = Math.atan2(mob.pos.x - player.pos.x, mob.pos.z - player.pos.z);
  return mob;
}

describe('every retained active row grant casts through the canonical Sim path', () => {
  for (const cls of ALL_CLASSES) {
    const grants = ROW_TREES[cls].flatMap((row) =>
      row.options.flatMap((option) =>
        option.effect.grant
          ? [{ level: row.level, optionId: option.id, abilityId: option.effect.grant.ability }]
          : [],
      ),
    );

    it(`${cls}: ${grants.length} active grants resolve and engage`, () => {
      for (const grant of grants) {
        const sim = new Sim({ seed: 91, playerClass: cls, autoEquip: true });
        sim.setPlayerLevel(20);
        expect(
          sim.applyTalents({ spec: null, rows: { [grant.level]: grant.optionId } }),
          `${grant.optionId} selection`,
        ).toBe(true);
        const resolved = sim.resolvedAbility(grant.abilityId);
        expect(resolved, `${grant.optionId} did not resolve ${grant.abilityId}`).toBeDefined();

        const distance = cls === 'hunter' ? 15 : 3;
        const target = addTarget(sim, distance);
        const player = sim.player;
        if (cls === 'hunter') {
          const hasLineOfSight = (
            sim as unknown as { hasLineOfSight(source: Entity, target: Entity): boolean }
          ).hasLineOfSight;
          for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, Math.PI / 4]) {
            target.pos.x = player.pos.x + Math.sin(angle) * distance;
            target.pos.z = player.pos.z + Math.cos(angle) * distance;
            if (hasLineOfSight.call(sim, player, target)) break;
          }
          player.facing = Math.atan2(target.pos.x - player.pos.x, target.pos.z - player.pos.z);
        }
        player.resource = player.maxResource;
        player.gcdRemaining = 0;
        player.hp = player.maxHp;
        if (grant.abilityId === 'hammer_of_wrath') target.hp = Math.floor(target.maxHp * 0.1);
        if (grant.abilityId === 'victory_rush') {
          sim.ctx.applyAura(player, {
            id: 'victory_rush_window',
            name: 'Victory Rush',
            kind: 'victory_rush',
            remaining: 20,
            duration: 20,
            value: 1,
            sourceId: player.id,
            school: 'physical',
          } satisfies Aura);
        }
        if (grant.abilityId === 'voidfeast') {
          // The devour is gated on having something to eat now
          // (requiresDispellable): feed the target a beneficial magic aura.
          sim.ctx.applyAura(target, {
            id: 'test_devour_food',
            name: 'Test Blessing',
            kind: 'buff_ap',
            remaining: 30,
            duration: 30,
            value: 20,
            sourceId: target.id,
            school: 'holy',
          } satisfies Aura);
        }
        if (grant.abilityId === 'frenzied_regeneration') {
          sim.castAbility('bear_form');
          for (let index = 0; index < 3; index++) sim.tick();
          player.resource = player.maxResource;
          player.gcdRemaining = 0;
        }

        const beforeCooldown = player.cooldowns.get(grant.abilityId) ?? 0;
        const beforePlayerAuras = player.auras.length;
        const beforeTargetAuras = target.auras.length;
        const events: SimEvent[] = [];
        sim.castAbility(grant.abilityId, undefined, { x: target.pos.x, z: target.pos.z });
        for (let index = 0; index < 6; index++) events.push(...sim.tick());

        const hardErrors = events.filter(
          (event): event is Extract<SimEvent, { type: 'error' }> =>
            event.type === 'error' && !/nothing to (dispel|consume|devour)/i.test(event.text),
        );
        expect(
          hardErrors,
          `${grant.optionId}: ${hardErrors.map((event) => event.text).join('; ')}`,
        ).toEqual([]);
        const engaged =
          (player.cooldowns.get(grant.abilityId) ?? 0) !== beforeCooldown ||
          player.gcdRemaining > 0 ||
          player.castingAbility !== null ||
          player.auras.length !== beforePlayerAuras ||
          target.hp < target.maxHp ||
          target.auras.length !== beforeTargetAuras;
        expect(engaged, `${grant.optionId}: ${grant.abilityId} did not engage`).toBe(true);
      }
    });
  }
});
