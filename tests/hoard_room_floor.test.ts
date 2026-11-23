// A Buried Hoard cave room's floor, as the sim walks it and as the room draws
// it, and as the online client predicts the local player across it.
//
// Live report (production, a party of two in a raised Voracious Chest cave):
// walking up the stairs toward the reward chest, the player sank under the
// raised rear deck; only the nameplate showed, the camera dropped under the
// deck with them and the view went dark, until they walked back down to the
// nave. The sim and the drawn room agree (the first block pins that for every
// cave boss at every cave rarity); the online reconciling predictor did not:
// it stepped the kernel against the flat floor under the deck without the
// raised-tier lift the server strips and reapplies around the same kernel,
// read the deck as a ledge and dropped the displayed player through it.
import { describe, expect, it } from 'vitest';
import type { InputTickFrame } from '../src/game/input_tick_sampler';
import { riftPlatformSlabs } from '../src/render/rift_platform_core';
import { MovementPredictionPipeline, type SelfPredictionWire } from '../src/render/self_prediction';
import type { MotionState } from '../src/render/self_prediction_core';
import { riftInstanceOrigin } from '../src/sim/data';
import { devHoardDestination, enterDevHoard } from '../src/sim/dev/hoard_travel';
import { polygonXAtZ } from '../src/sim/geometry2d';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import { generateRiftFloor, riftLiftAt } from '../src/sim/rift/rift_gen';
import type { RiftFloorPlan, RiftInstance } from '../src/sim/rift/types';
import { Sim } from '../src/sim/sim';
import { emptyMoveInput, type MoveInput, type Vec3 } from '../src/sim/types';
import type { RiftFloorView } from '../src/world_api/dungeons';

const CAVE_BOSSES = ['mushroom', 'deeprake', 'bat', 'chest'] as const;
const CAVE_RARITIES = ['common', 'rare'] as const;

/** The top of the drawn floor at an instance-local point: the tallest sanctum
 *  slab (stair or deck) whose footprint holds the point, else the flat floor. */
function drawnFloorAt(floor: RiftFloorPlan, lx: number, lz: number): number {
  if (!floor.platform) return 0;
  let top = 0;
  for (const slab of riftPlatformSlabs(floor.layout, floor.platform)) {
    if (Math.abs(lx) > slab.halfW) continue;
    if (Math.abs(lz - slab.z) > slab.depth / 2) continue;
    top = Math.max(top, slab.top);
  }
  return top;
}

/** Half-width a body can stand in at instance-local z: the room's own shell
 *  outline where it has one, else its rectangular wall, a body radius in. */
function walkableHalfWidth(floor: RiftFloorPlan, lz: number): number {
  const { shellPolygon, wallX } = floor.layout;
  const shell = shellPolygon ? polygonXAtZ(shellPolygon, lz, 1) : null;
  return (shell ?? wallX ?? 18) - 1;
}

/** A cave room of this boss and rarity, raised (a sanctum deck) or flush. */
function caveSeed(
  boss: (typeof CAVE_BOSSES)[number],
  rarity: 'common' | 'rare',
  raised: boolean,
): { seed: number; baseLevel: number } {
  const baseLevel = RIFT_RANK_BASE_LEVEL[rarity === 'common' ? 'C' : 'B'];
  const found = devHoardDestination(
    boss,
    rarity,
    (seed) => (generateRiftFloor(seed, baseLevel, 0).platform !== null) === raised,
  );
  if (!found) throw new Error(`no ${raised ? 'raised' : 'flush'} ${rarity} ${boss} room`);
  return { seed: found.seed, baseLevel };
}

describe('a Buried Hoard cave room floor', () => {
  for (const boss of CAVE_BOSSES) {
    for (const rarity of CAVE_RARITIES) {
      for (const raised of [true, false]) {
        it(`is walked where it is drawn: ${boss}, ${rarity}, ${raised ? 'raised' : 'flush'}`, () => {
          const { seed, baseLevel } = caveSeed(boss, rarity, raised);
          const floor = generateRiftFloor(seed, baseLevel, 0);
          const { layout, platform } = floor;
          // The stairs are drawn as treads over the sim's linear ramp: a tread
          // sits at most one riser above it, never below.
          const riser = platform
            ? platform.height /
              Math.max(5, Math.min(20, Math.round((platform.rampZ1 - platform.rampZ0) / 2.2)))
            : 0;
          let samples = 0;
          for (let lz = layout.zMin + 1; lz <= layout.zMax - 1; lz += 0.5) {
            // Only where a body can stand: inside the room's own shell, a body
            // radius clear of the wall face.
            const half = walkableHalfWidth(floor, lz);
            for (let lx = -half; lx <= half; lx += 0.5) {
              const walked = riftLiftAt(floor, lx, lz);
              const drawn = drawnFloorAt(floor, lx, lz);
              // (Treads overlap by a hair, so the band's own edges count as stairs.)
              const onStairs =
                platform !== null && lz >= platform.rampZ0 - 0.05 && lz <= platform.rampZ1 + 0.05;
              if (onStairs) {
                expect(drawn - walked).toBeGreaterThanOrEqual(-1e-9);
                expect(drawn - walked).toBeLessThanOrEqual(riser + 1e-9);
              } else {
                expect(Math.abs(drawn - walked)).toBeLessThan(1e-9);
              }
              samples++;
            }
          }
          expect(samples).toBeGreaterThan(1000);
          // The reward chest stands where the floor is drawn too.
          const chestZ = layout.dais.z - 7.5;
          expect(riftLiftAt(floor, layout.dais.x, chestZ)).toBeCloseTo(
            drawnFloorAt(floor, layout.dais.x, chestZ),
            9,
          );
          if (raised) expect(riftLiftAt(floor, layout.dais.x, chestZ)).toBeGreaterThan(2);
        });
      }
    }
  }
});

// ---- The online client's reconciling prediction ------------------------------

class HoardWire implements SelfPredictionWire {
  movementWireVersion: 1 | 2 = 2;
  onMovementWireNegotiated: ((version: 1 | 2, now: number) => void) | null = null;
  onMovementWireNeutral: ((now: number) => boolean) | null = null;
  reconAuthoritativeX: number | null = null;
  reconAuthoritativeY: number | null = null;
  reconAuthoritativeZ: number | null = null;
  reconAuthoritativeFacing: number | null = null;
  reconAckClientTick = -1;
  reconOverrideEpoch = 0;
  reconOverrideActive = false;
  reconMoveSpeedMult = 1;
  riftFloor: RiftFloorView | null = null;

  netPipeline() {
    return { noteReconcileOutcome: () => {} };
  }
  movementWireIsOpen(): boolean {
    return true;
  }
  sendMovementFrame(): boolean {
    return true;
  }
  acknowledge(ct: number, pose: Vec3, facing: number): void {
    this.reconAckClientTick = ct;
    this.reconAuthoritativeX = pose.x;
    this.reconAuthoritativeY = pose.y;
    this.reconAuthoritativeZ = pose.z;
    this.reconAuthoritativeFacing = facing;
  }
}

interface PipelineInternals {
  predictFrame(frame: InputTickFrame): void;
  predicted: MotionState | null;
}

/** Clear a raised cave (its boss and trash dead, the chest spawned) and stand
 *  the player on the nave, facing the stairs. */
function clearedRaisedCave(
  boss: (typeof CAVE_BOSSES)[number],
  rarity: 'common' | 'rare',
): { sim: Sim; inst: RiftInstance; floor: RiftFloorPlan; origin: { x: number; z: number } } {
  const { seed } = caveSeed(boss, rarity, true);
  const destination = devHoardDestination(boss, rarity, (candidate) => candidate === seed);
  if (!destination) throw new Error('destination vanished');
  const sim = new Sim({ seed: 4242, playerClass: 'warrior', autoEquip: true, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev god', sim.player.id);
  enterDevHoard(sim.ctx, sim.player.id, destination);
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
  if (!inst || inst.bossId === null) throw new Error('missing hoard');
  for (const id of inst.mobIds) {
    const mob = sim.entities.get(id);
    if (mob && id !== inst.bossId) sim.ctx.handleDeath(mob, sim.player);
  }
  const bossEntity = sim.entities.get(inst.bossId);
  if (!bossEntity) throw new Error('missing boss');
  sim.ctx.handleDeath(bossEntity, sim.player);
  for (let t = 0; t < 40; t++) sim.tick();
  if (!inst.vault?.chest) throw new Error('no chest');
  const floor = generateRiftFloor(inst.seed, inst.baseLevel, inst.floorIndex, inst.upgrade);
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const p = sim.player;
  const platform = floor.platform;
  if (!platform) throw new Error('not raised');
  p.pos = sim.ctx.groundPos(origin.x, origin.z + platform.rampZ0 - 6);
  p.prevPos = { ...p.pos };
  p.facing = 0;
  sim.rebucket(p);
  sim.tick();
  return { sim, inst, floor, origin };
}

describe('the online prediction across a raised hoard cave', () => {
  // The acknowledgement trails the prediction by a few ticks, as it does over
  // any real connection: the replayed ticks are the ones that used to fall.
  const LAG = 4;

  for (const boss of CAVE_BOSSES) {
    for (const rarity of CAVE_RARITIES) {
      it(`keeps the player on the drawn deck walking to the chest: ${boss}, ${rarity}`, () => {
        const { sim, inst, floor, origin } = clearedRaisedCave(boss, rarity);
        const p = sim.player;
        const meta = sim.players.get(p.id);
        if (!meta) throw new Error('meta');
        const chest = sim.entities.get(inst.vault?.chest?.entityId ?? -1);
        if (!chest) throw new Error('chest entity');

        const wire = new HoardWire();
        wire.riftFloor = sim.riftFloor;
        expect(wire.riftFloor).not.toBeNull();
        const history = new Map<number, { pos: Vec3; facing: number }>();
        history.set(0, { pos: { ...p.pos }, facing: p.facing });
        wire.acknowledge(0, p.pos, p.facing);
        const pipeline = new MovementPredictionPipeline(sim.cfg.seed, sim.ctx.riftCollisionToken);
        const internals = pipeline as unknown as PipelineInternals;
        pipeline.prepare(wire, p, true);

        const forward: MoveInput = { ...emptyMoveInput(), forward: true };
        let worstY = 0;
        let worstBelowDrawn = 0;
        let reachedDeck = false;
        let ct = 0;
        while (p.pos.z < chest.pos.z - 2 && ct < 600) {
          ct++;
          Object.assign(meta.moveInput, forward);
          sim.tick();
          history.set(ct, { pos: { ...p.pos }, facing: p.facing });
          internals.predictFrame({ ct, mi: forward, facing: null });
          const ackCt = ct - LAG;
          const acked = history.get(ackCt);
          if (acked) wire.acknowledge(ackCt, acked.pos, acked.facing);
          expect(pipeline.display()).not.toBeNull();
          const predicted = internals.predicted;
          if (!predicted) throw new Error('no prediction');
          const lx = predicted.pos.x - origin.x;
          const lz = predicted.pos.z - origin.z;
          const drawn = drawnFloorAt(floor, lx, lz);
          const server = history.get(ct)?.pos ?? p.pos;
          worstY = Math.max(worstY, Math.abs(predicted.pos.y - server.y));
          const platform = floor.platform;
          // Off the stairs (whose treads stand a riser proud of the ramp, see
          // above) the feet must never be under the drawn surface.
          if (!platform || lz < platform.rampZ0 - 0.05 || lz > platform.rampZ1 + 0.05) {
            worstBelowDrawn = Math.max(worstBelowDrawn, drawn - predicted.pos.y);
          }
          if (platform && lz >= platform.rampZ1) reachedDeck = true;
        }
        expect(reachedDeck).toBe(true);
        // The authoritative player stands on the deck at the chest...
        expect(p.pos.y).toBeCloseTo(riftLiftAt(floor, p.pos.x - origin.x, p.pos.z - origin.z), 6);
        expect(p.pos.y).toBeGreaterThan(2);
        // ...and the predicted (displayed) one is the same body, on the drawn
        // floor: never sunk into the stairs or under the deck.
        expect(worstY).toBeLessThan(1e-6);
        expect(worstBelowDrawn).toBeLessThanOrEqual(1e-6);
      });
    }
  }
});
