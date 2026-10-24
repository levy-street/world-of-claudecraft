// A crop already growing in a garden bed follows that bed when a Studio map
// moves it (WorldContent.objectMoves, sim/moved_objects.ts). Plots are keyed
// by bed id and carry no position of their own, so a save planted on the
// built-in world, loaded into a world that moved (and turned) the bed, must
// keep its growth state, draw at the bed's NEW seat, and harvest from the new
// spot only. End to end over the real Sim, its save/load path and the real
// farm renderer.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { buildFarmPatchProps, FarmPatchVisuals } from '../src/render/farm_patches';
import { farmBedById } from '../src/sim/content/farm_patches';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { freezeObjectMoves, objectMoveKey } from '../src/sim/moved_objects';
import { harvestCrop, plantCrop } from '../src/sim/professions/farming';
import { type CharacterState, type PlayerMeta, Sim } from '../src/sim/sim';
import type { SimEvent, WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const BED = 'bed_eastbrook_1';
const CROP_ID = 'vale_wheat';
const SEED_ID = 'vale_wheat_seed';
const HOE_ID = 'garden_hoe';
const START_MS = 1_700_000_000_000;
// The combined Eastbrook map's move of this bed, plus a turn.
const TARGET = { x: -84.26866845195528, z: -74.87998848430169, rotY: 0.6 };

function standAt(sim: Sim, x: number, z: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

function movedWorld(): WorldContent {
  return {
    ...BUILTIN_WORLD,
    objectMoves: freezeObjectMoves({ [objectMoveKey('farmBed', BED)]: TARGET }),
  };
}

function farmDenials(events: readonly SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'farmDenied' }> => e.type === 'farmDenied')
    .map((e) => e.reason);
}

afterEach(() => setActiveWorldContent(null));

describe('a growing crop follows its moved bed', () => {
  it('keeps its growth state, draws at the new seat and harvests only there', () => {
    // Planted on the built-in world, then saved part way through its growth.
    let nowMs = START_MS;
    const shippedSim = new Sim({
      seed: 41,
      playerClass: 'warrior',
      autoEquip: false,
      lockoutNowMs: () => nowMs,
    });
    const shippedBed = farmBedById(BED);
    if (!shippedBed) throw new Error(`no such bed: ${BED}`);
    const pid = shippedSim.playerId;
    shippedSim.addItem(HOE_ID, 1, pid);
    shippedSim.addItem(SEED_ID, 1, pid);
    standAt(shippedSim, shippedBed.x, shippedBed.z);
    plantCrop(
      shippedSim.ctx,
      shippedSim.player,
      shippedSim.players.get(pid) as PlayerMeta,
      BED,
      CROP_ID,
    );
    const planted = shippedSim.myFarmPlots.find((plot) => plot.bedId === BED);
    expect(planted, 'the crop must be planted on the shipped bed').toBeDefined();
    if (!planted) return;
    nowMs += Math.floor((planted.readyAtMs - planted.plantedAtMs) / 2);
    const saved = shippedSim.serializeCharacter(pid) as CharacterState;
    const growing = shippedSim.myFarmPlots.find((plot) => plot.bedId === BED);

    // Loaded into a world whose map moved and turned that bed.
    const world = movedWorld();
    setActiveWorldContent(world);
    const sim = new Sim({
      seed: 41,
      playerClass: 'warrior',
      noPlayer: true,
      lockoutNowMs: () => nowMs,
      world,
    });
    sim.addPlayer('warrior', 'Farmer', { state: saved });
    const meta = [...sim.players.values()][0] as PlayerMeta;

    // The same plot, the same growth state.
    expect(sim.myFarmPlots.find((plot) => plot.bedId === BED)).toEqual(growing);
    const bed = sim.farmPatches.flatMap((patch) => patch.beds).find((b) => b.id === BED);
    expect(bed).toMatchObject(TARGET);

    // The renderer seats the crop on the moved bed: its position, its ground
    // height there, and the bed's turn.
    const { seats } = buildFarmPatchProps(sim.cfg.seed, sim.farmPatches);
    const seat = seats.get(BED);
    expect(seat).toMatchObject({ x: TARGET.x, z: TARGET.z });
    expect(seat?.y).toBe(terrainHeight(TARGET.x, TARGET.z, sim.cfg.seed));
    const scene = new THREE.Scene();
    const visuals = new FarmPatchVisuals(scene, seats, { burst: () => {}, groundPuff: () => {} });
    visuals.sync(sim, 0.5);
    const crop = scene.getObjectByName(`farmPlot:${BED}`);
    expect(crop, 'the growing crop must be drawn').toBeDefined();
    expect(crop?.position.x).toBe(TARGET.x);
    expect(crop?.position.z).toBe(TARGET.z);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(
      crop?.quaternion ?? new THREE.Quaternion(),
    );
    // Turned with the bed: the shipped bed has no turn, so its crop faces +z.
    expect(Math.atan2(facing.x, facing.z)).toBeCloseTo(TARGET.rotY, 1);
    visuals.dispose();

    // Ripe: the old spot is out of reach, the moved bed harvests.
    nowMs = (growing?.readyAtMs ?? nowMs) + 1;
    standAt(sim, shippedBed.x, shippedBed.z);
    harvestCrop(sim.ctx, sim.player, meta, BED);
    expect(farmDenials(sim.tick())).toContain('range');
    expect(sim.myFarmPlots.some((plot) => plot.bedId === BED)).toBe(true);
    sim.player.castingAbility = null;
    sim.player.castRemaining = 0;
    standAt(sim, TARGET.x, TARGET.z);
    harvestCrop(sim.ctx, sim.player, meta, BED);
    expect(farmDenials(sim.tick())).toEqual([]);
    expect(sim.myFarmPlots.some((plot) => plot.bedId === BED)).toBe(false);
  });
});
