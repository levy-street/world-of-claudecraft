import { afterEach, describe, expect, it } from 'vitest';
import { battlegroundColliders } from '../src/sim/battleground_layout';
import { campCrateShape, supportHeightAt } from '../src/sim/colliders';
import {
  battlegroundOrigin,
  DUNGEON_FLOOR_Y,
  DUNGEONS,
  ITEMS,
  instanceOrigin,
  riftInstanceOrigin,
  setActiveWorldContent,
} from '../src/sim/data';
import { CRYPT_LAYOUT, DAIS_HEIGHT } from '../src/sim/dungeon_layout';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';
import { liftRiftEntities, riftInstanceAtPos } from '../src/sim/rift/runs';
import { Sim } from '../src/sim/sim';
import { startBgMatch } from '../src/sim/social/battleground';
import type { WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { OPEN_FIELD, placePlayerInOpenField } from './helpers/open_field';
import { EMPTY_TEST_WORLD } from './sim_shared';

const FEAST_ITEMS = Object.values(ITEMS).filter((item) => 'feast' in item && item.feast);

afterEach(() => setActiveWorldContent(null));

function world(content: WorldContent = EMPTY_TEST_WORLD): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', world: content });
}

function place(sim: Sim, expectedY: number, itemId = 'harvest_feast') {
  const player = sim.player;
  const before = { ...player.pos };
  sim.addItem(itemId, 1);
  let draws = 0;
  sim.rng.setObserver(() => draws++);
  const from = sim.events.length;
  sim.useItem(itemId);
  const events = sim.events.slice(from).filter((event) => event.type === 'farmFeastPlaced');
  expect(events).toHaveLength(1);
  const feast = sim.entities.get(events[0].feastId);
  expect(feast).toBeDefined();
  if (!feast) throw new Error('Feast placement failed');
  // Assert immediately, before any movement or rift lift tick can repair it.
  expect(feast.pos).toEqual({ x: before.x, y: expectedY, z: before.z });
  expect(player.pos).toEqual(before);
  expect(draws).toBe(0);
  sim.rng.setObserver(null);
  expect(sim.countItem(itemId)).toBe(0);
  return feast;
}

function stand(sim: Sim, x: number, z: number, y: number, airborne = false): void {
  sim.player.pos = { x, y, z };
  sim.player.prevPos = { ...sim.player.pos };
  sim.player.onGround = !airborne;
  sim.player.jumping = airborne;
}

describe('feasts settle on the surface below their placer', () => {
  it.each(FEAST_ITEMS)('$id lands on open ground when placed during a jump', ({ id }) => {
    const sim = world();
    placePlayerInOpenField(sim);
    const floor = sim.player.pos.y;
    sim.player.pos.y += 2;
    sim.player.onGround = false;
    sim.player.jumping = true;
    place(sim, floor, id);
  });

  it('preserves an ordinary grounded placement', () => {
    const sim = world();
    placePlayerInOpenField(sim);
    place(sim, sim.player.pos.y);
  });

  it.each([0, 2])('rests on a standable crate with the player %s yards above it', (jump) => {
    const { x, z } = OPEN_FIELD;
    const content = {
      ...EMPTY_TEST_WORLD,
      props: { ...EMPTY_TEST_WORLD.props, crates: [[x, z]] },
    } satisfies WorldContent;
    const sim = world(content);
    setActiveWorldContent(content);
    const top = groundHeight(x, z, sim.cfg.seed) + campCrateShape(x, z, 0).top;
    expect(supportHeightAt(sim.cfg.seed, x, z, PLAYER_BODY_RADIUS, top)).toBe(top);
    stand(sim, x, z, top + jump, jump > 0);
    place(sim, top);
  });

  it('keeps an airborne feast on the raised dungeon dais', () => {
    const sim = world();
    enterDungeon(sim.ctx, 'hollow_crypt', sim.player.id);
    const origin = instanceOrigin(DUNGEONS.hollow_crypt.index, 0);
    const { x, z } = CRYPT_LAYOUT.dais;
    const floor = DUNGEON_FLOOR_Y + DAIS_HEIGHT;
    stand(sim, origin.x + x, origin.z + z, floor + 2, true);
    place(sim, floor);
  });

  it('preserves the raised Dawnhold gallery rug used by the visual regression fixture', () => {
    const sim = world();
    enterDungeon(sim.ctx, 'dawnhold_castle', sim.player.id);
    const origin = instanceOrigin(DUNGEONS.dawnhold_castle.index, 0);
    stand(sim, origin.x + 2, origin.z + 38, 3);
    place(sim, 3);
  });

  it.each(['above', 'below'] as const)(
    'places %s a battleground rampart at the player support',
    (side) => {
      const sim = world();
      const pids = [sim.player.id];
      for (let i = 1; i < 10; i++) pids.push(sim.addPlayer('warrior', `Guest ${i}`));
      startBgMatch(sim.ctx, pids.slice(0, 5), pids.slice(5), { rated: false });
      const origin = battlegroundOrigin(0);
      const deck = battlegroundColliders().find(
        (collider) =>
          collider.standable &&
          collider.moveTopY !== undefined &&
          collider.moveTopY >
            groundHeight(origin.x + collider.x, origin.z + collider.z, sim.cfg.seed) + 4,
      );
      if (!deck) throw new Error('Raised battleground deck missing');
      const x = origin.x + deck.x;
      const z = origin.z + deck.z;
      const ground = groundHeight(x, z, sim.cfg.seed);
      const top = supportHeightAt(sim.cfg.seed, x, z, PLAYER_BODY_RADIUS, Infinity);
      expect(top).toBeGreaterThan(ground + 4);
      if (side === 'above') {
        stand(sim, x, z, top + 2, true);
        place(sim, top);
      } else {
        stand(sim, x, z, ground + 0.5, true);
        place(sim, ground);
      }
    },
  );
});

describe('rift feast placement uses the current raised floor immediately', () => {
  it.each(['flat', 'ramp', 'platform'] as const)(
    'settles an airborne feast on the %s',
    (surface) => {
      // Choose a real procedural floor with elevation, without editing its cached plan.
      let seed = 1;
      while (seed < 100 && !generateRiftFloor(seed, 20, 0).platform) seed++;
      const floor = generateRiftFloor(seed, 20, 0);
      const platform = floor.platform;
      expect(platform).not.toBeNull();
      if (!platform) throw new Error('Raised rift fixture missing');
      const sim = world();
      sim.setPlayerLevel(20);
      sim.enterRift(seed, 20);
      const run = riftInstanceAtPos(sim.ctx, sim.player.pos);
      if (!run) throw new Error('Rift entry failed');
      const origin = riftInstanceOrigin(run.slot, run.floorIndex);
      const localZ =
        surface === 'flat'
          ? platform.rampZ0 - 2
          : surface === 'ramp'
            ? (platform.rampZ0 + platform.rampZ1) / 2
            : platform.rampZ1 + 2;
      const lift =
        surface === 'flat' ? 0 : surface === 'ramp' ? platform.height / 2 : platform.height;
      const floorY = DUNGEON_FLOOR_Y + lift;
      stand(sim, origin.x, origin.z + localZ, floorY + 2, true);
      const feast = place(sim, floorY);
      expect(run.objectIds).toContain(feast.id);
      liftRiftEntities(sim.ctx);
      expect(feast.pos.y).toBe(floorY);
    },
  );
});
