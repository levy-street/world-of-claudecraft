import { describe, expect, it } from 'vitest';
import { buildGaleFeatures } from '../src/render/gale_features';
import {
  GLIDER_LAUNCH_SITE,
  GLIDER_NPC_DEF,
  GLIDER_NPC_ID,
  GLIDER_QUEST_ID,
} from '../src/sim/content/world_quest_glider';
import { BUILTIN_WORLD } from '../src/sim/data';
import { GALE_DECK_LIFT } from '../src/sim/gale_harbor';
import { GLIDER_TRAIL_DECK_Y as GLIDER_WHARF_DECK_Y } from '../src/sim/glider_approach_path';
import {
  GLIDER_WHARF,
  GLIDER_WHARF_DECKS,
  gliderWharfSurface,
} from '../src/sim/glider_wharf_layout';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { overworldWalkSurface } from '../src/sim/walk_lifts';
import { groundHeight, terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { ensureGliderInstructor, updateGliderLaunchUpdraft } from '../src/sim/world_quest_glider';
import { WORLD_SEED } from '../src/sim/world_seed';

const terrain = (x: number, z: number): number => terrainHeight(x, z, WORLD_SEED);

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
  sim.resetDay = '2026-09-28';
  return sim;
}

describe('the launch wharf', () => {
  it('lays its planks at the old deck height on the crest; the perch hangs past the end', () => {
    expect(GLIDER_WHARF_DECKS).toHaveLength(1);
    const pier = GLIDER_WHARF_DECKS[0];
    expect(terrain(pier.ax, pier.az)).toBeCloseTo(GLIDER_WHARF_DECK_Y - GALE_DECK_LIFT, 6);
    // Zephyr's spot is on the planks above the existing mountainside.
    expect(
      gliderWharfSurface(GLIDER_NPC_DEF.pos.x, GLIDER_NPC_DEF.pos.z, terrain, WATER_LEVEL),
    ).toBeCloseTo(GLIDER_WHARF_DECK_Y, 6);
    expect(
      gliderWharfSurface(GLIDER_NPC_DEF.pos.x + 1, GLIDER_NPC_DEF.pos.z, terrain, WATER_LEVEL),
    ).toBeCloseTo(GLIDER_WHARF_DECK_Y, 6);
    // The launch perch is a stride PAST the planks' end, at the plank plane,
    // with the mountainside already well below: open air under the glider from its
    // first flying tick (the flight tower's perch hung off its deck the same way).
    const perch = GLIDER_LAUNCH_SITE.playerLaunch;
    expect(perch.y).toBe(GLIDER_WHARF_DECK_Y);
    expect(gliderWharfSurface(perch.x, perch.z, terrain, WATER_LEVEL)).toBe(-Infinity);
    expect(groundHeight(perch.x, perch.z, WORLD_SEED)).toBeLessThan(GLIDER_WHARF_DECK_Y - 5);
    // Beside the planks there is only the mountainside; at the updraft, only ground.
    expect(gliderWharfSurface(pier.x, pier.z + 6, terrain, WATER_LEVEL)).toBe(-Infinity);
    expect(
      gliderWharfSurface(GLIDER_WHARF.updraft.x, GLIDER_WHARF.updraft.z, terrain, WATER_LEVEL),
    ).toBe(-Infinity);
  });

  it('folds into groundHeight on the planks and not beside them; the old tower lift is gone', () => {
    expect(groundHeight(GLIDER_NPC_DEF.pos.x, GLIDER_NPC_DEF.pos.z, WORLD_SEED)).toBeCloseTo(
      GLIDER_WHARF_DECK_Y,
      6,
    );
    const pier = GLIDER_WHARF_DECKS[0];
    expect(groundHeight(pier.x, pier.z + 6, WORLD_SEED)).toBeCloseTo(
      terrain(pier.x, pier.z + 6),
      6,
    );
    expect(groundHeight(GLIDER_WHARF.updraft.x, GLIDER_WHARF.updraft.z, WORLD_SEED)).toBeCloseTo(
      terrain(GLIDER_WHARF.updraft.x, GLIDER_WHARF.updraft.z),
      6,
    );
    // The walk-lift sum no longer knows a tower: it adds nothing at the launch.
    expect(overworldWalkSurface(GLIDER_NPC_DEF.pos.x, GLIDER_NPC_DEF.pos.z, 10)).toBe(10);
  });

  it('spawns Flightmaster Zephyr at the wharf deck height', () => {
    const sim = setupSim();
    ensureGliderInstructor((sim as unknown as { ctx: SimContext }).ctx);
    const zephyr = sim.entities.get(GLIDER_NPC_ID);
    expect(zephyr).toBeDefined();
    expect(zephyr?.pos.x).toBe(GLIDER_NPC_DEF.pos.x);
    expect(zephyr?.pos.z).toBe(GLIDER_NPC_DEF.pos.z);
    expect(zephyr?.pos.y).toBeCloseTo(GLIDER_WHARF_DECK_Y, 6);
  });

  it('starts glider flight from the pier tip with open air below', () => {
    const sim = setupSim();
    sim.chat('/dev glider');
    expect(sim.player.pos.y).toBeCloseTo(GLIDER_WHARF_DECK_Y, 6);
    sim.talkToNpc(GLIDER_NPC_ID);
    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID);
    expect(progress?.glider?.phase).toBe('countdown');
    expect(sim.player.pos.x).toBe(GLIDER_LAUNCH_SITE.playerLaunch.x);
    expect(sim.player.pos.y).toBe(GLIDER_WHARF_DECK_Y);
    expect(sim.player.pos.z).toBe(GLIDER_LAUNCH_SITE.playerLaunch.z);
    // Through the countdown and into the air: no terrain contact off the perch.
    for (let i = 0; i < 61; i++) sim.tick();
    expect(sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider?.phase).toBe('flying');
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider?.phase).toBe('flying');
  });

  it('whisks a player standing in the roadside updraft at the foot back up to Zephyr', () => {
    const sim = setupSim();
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    const meta = sim.meta(sim.playerId)!;
    sim.player.pos = {
      x: GLIDER_WHARF.updraft.x,
      y: groundHeight(GLIDER_WHARF.updraft.x, GLIDER_WHARF.updraft.z, WORLD_SEED),
      z: GLIDER_WHARF.updraft.z,
    };
    sim.player.prevPos = { ...sim.player.pos };
    expect(sim.player.pos.y).toBeLessThan(40);
    const triggered = updateGliderLaunchUpdraft(ctx, meta, sim.player);
    expect(triggered).toBe(true);
    expect(sim.player.pos.x).toBe(GLIDER_NPC_DEF.pos.x + 1);
    expect(sim.player.pos.y).toBeCloseTo(GLIDER_WHARF_DECK_Y, 6);
    expect(sim.player.pos.z).toBe(GLIDER_NPC_DEF.pos.z);
    expect(sim.player.onGround).toBe(true);
    // Standing on the planks does not re-trigger it.
    expect(updateGliderLaunchUpdraft(ctx, meta, sim.player)).toBe(false);
  });

  it('whisks a low-level player up via sim.tick even with no world quest active', () => {
    const sim = setupSim();
    sim.player.level = 1;
    sim.player.pos = {
      x: GLIDER_WHARF.updraft.x,
      y: groundHeight(GLIDER_WHARF.updraft.x, GLIDER_WHARF.updraft.z, WORLD_SEED),
      z: GLIDER_WHARF.updraft.z,
    };
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    expect(sim.player.pos.x).toBe(GLIDER_NPC_DEF.pos.x + 1);
    expect(sim.player.pos.y).toBeCloseTo(GLIDER_WHARF_DECK_Y, 6);
    expect(sim.player.pos.z).toBe(GLIDER_NPC_DEF.pos.z);
  });

  it('renders the planks and the updraft funnel, and no tower', () => {
    const view = buildGaleFeatures(WORLD_SEED);
    expect(view.group.children.length).toBeGreaterThan(0);
    // The update arm still turns the funnel.
    expect(() => view.update(1)).not.toThrow();
  });
});
