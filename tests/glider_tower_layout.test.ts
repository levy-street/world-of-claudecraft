import { describe, expect, it } from 'vitest';
import { buildGaleFeatures } from '../src/render/gale_features';
import {
  GLIDER_LAUNCH_SITE,
  GLIDER_NPC_DEF,
  GLIDER_NPC_ID,
  GLIDER_QUEST_ID,
} from '../src/sim/content/world_quest_glider';
import { BUILTIN_WORLD } from '../src/sim/data';
import { GLIDER_TOWER, gliderTowerSurface } from '../src/sim/glider_tower_layout';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { groundHeight, terrainHeight } from '../src/sim/world';
import { ensureGliderInstructor, updateGliderLaunchUpdraft } from '../src/sim/world_quest_glider';
import { WORLD_SEED } from '../src/sim/world_seed';

function setupSim() {
  const sim = new Sim({
    seed: WORLD_SEED,
    playerClass: 'warrior',
    devCommands: true,
    world: {
      ...BUILTIN_WORLD,
      camps: [],
      npcs: {
        [GLIDER_NPC_DEF.id]: GLIDER_NPC_DEF,
      },
      groundObjects: [],
    },
  });
  sim.resetDay = '2026-09-06';
  return sim;
}

describe('glider tower layout and walk surface', () => {
  it('returns deck height 74 on the platform and -Infinity outside', () => {
    expect(gliderTowerSurface(GLIDER_NPC_DEF.pos.x, GLIDER_NPC_DEF.pos.z)).toBe(74);
    expect(gliderTowerSurface(GLIDER_NPC_DEF.pos.x + 1, GLIDER_NPC_DEF.pos.z)).toBe(74);
    expect(gliderTowerSurface(GLIDER_NPC_DEF.pos.x, GLIDER_NPC_DEF.pos.z + 2)).toBe(74);
    expect(
      gliderTowerSurface(GLIDER_LAUNCH_SITE.playerLaunch.x, GLIDER_LAUNCH_SITE.playerLaunch.z),
    ).toBe(Number.NEGATIVE_INFINITY);
    expect(gliderTowerSurface(GLIDER_TOWER.updraft.x, GLIDER_TOWER.updraft.z)).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });

  it('elevates groundHeight to 74 on the tower deck while leaving the updraft and open air clear', () => {
    expect(groundHeight(GLIDER_NPC_DEF.pos.x, GLIDER_NPC_DEF.pos.z, WORLD_SEED)).toBe(74);
    expect(groundHeight(GLIDER_NPC_DEF.pos.x + 1, GLIDER_NPC_DEF.pos.z, WORLD_SEED)).toBe(74);
    expect(groundHeight(GLIDER_TOWER.updraft.x, GLIDER_TOWER.updraft.z, WORLD_SEED)).toBeCloseTo(
      terrainHeight(GLIDER_TOWER.updraft.x, GLIDER_TOWER.updraft.z, WORLD_SEED),
      3,
    );
  });

  it('spawns Flightmaster Zephyr at Y = 74 on the flight tower deck', () => {
    const sim = setupSim();
    ensureGliderInstructor((sim as unknown as { ctx: SimContext }).ctx);
    const zephyr = sim.entities.get(GLIDER_NPC_ID);
    expect(zephyr).toBeDefined();
    expect(zephyr?.pos.x).toBe(GLIDER_NPC_DEF.pos.x);
    expect(zephyr?.pos.z).toBe(GLIDER_NPC_DEF.pos.z);
    expect(zephyr?.pos.y).toBe(74);
  });

  it('starts glider flight horizontally from the launch perch without rising from the ground', () => {
    const sim = setupSim();
    sim.chat('/dev glider');
    expect(sim.player.pos.y).toBe(74);
    sim.talkToNpc(GLIDER_NPC_ID);
    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID);
    expect(progress?.glider?.phase).toBe('countdown');
    expect(sim.player.pos.x).toBe(GLIDER_LAUNCH_SITE.playerLaunch.x);
    expect(sim.player.pos.y).toBe(74);
    expect(sim.player.pos.z).toBe(GLIDER_LAUNCH_SITE.playerLaunch.z);
  });

  it('whisks a ground-level player up to the tower deck via the roadside updraft', () => {
    const sim = setupSim();
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    const meta = sim.meta(sim.playerId)!;
    sim.player.pos = {
      x: GLIDER_TOWER.updraft.x,
      y: groundHeight(GLIDER_TOWER.updraft.x, GLIDER_TOWER.updraft.z, WORLD_SEED),
      z: GLIDER_TOWER.updraft.z,
    };
    sim.player.prevPos = { ...sim.player.pos };
    expect(sim.player.pos.y).toBeLessThan(30);

    const triggered = updateGliderLaunchUpdraft(ctx, meta, sim.player);
    expect(triggered).toBe(true);
    expect(sim.player.pos.x).toBe(GLIDER_NPC_DEF.pos.x + 1);
    expect(sim.player.pos.y).toBe(74);
    expect(sim.player.pos.z).toBe(GLIDER_NPC_DEF.pos.z);
    expect(sim.player.onGround).toBe(true);

    // Standing on top of the deck does not re-trigger the updraft
    const retriggered = updateGliderLaunchUpdraft(ctx, meta, sim.player);
    expect(retriggered).toBe(false);
  });

  it('whisks a ground-level player up via sim.tick even when the world quest is not activated or player is low level', () => {
    const sim = setupSim();
    sim.player.level = 1;
    sim.player.pos = {
      x: GLIDER_TOWER.updraft.x,
      y: groundHeight(GLIDER_TOWER.updraft.x, GLIDER_TOWER.updraft.z, WORLD_SEED),
      z: GLIDER_TOWER.updraft.z,
    };
    sim.player.prevPos = { ...sim.player.pos };
    expect(sim.player.pos.y).toBeLessThan(30);

    sim.tick();
    expect(sim.player.pos.x).toBe(GLIDER_NPC_DEF.pos.x + 1);
    expect(sim.player.pos.y).toBe(74);
    expect(sim.player.pos.z).toBe(GLIDER_NPC_DEF.pos.z);
    expect(sim.player.onGround).toBe(true);

    // Can talk to Zephyr to start a practice flight even when inactive
    sim.talkToNpc(GLIDER_NPC_ID);
    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID);
    expect(progress?.glider?.phase).toBe('countdown');
    expect(progress?.glider?.practiceOnly).toBe(true);
  });

  it('renders the flight tower structure and updraft visual in Gale features', () => {
    const features = buildGaleFeatures(WORLD_SEED);
    expect(features.group.children.length).toBeGreaterThan(0);
    features.update(1.0);
  });
});
