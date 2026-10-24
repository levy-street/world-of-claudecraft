// The muster's pikes are for the low levels (owner call): the rack lends a Shardpike to
// level 19 and below and refuses a level 20, with a line that says why. The fight's design
// is a level spread (mob/eye_ward.ts): the low levels open the eye window with the pike and
// the level 20s spend it, so a level 20 at the rack is in the wrong job.
//
// The tutorial follows the rule (Pikes First is a level 19-and-under quest), and the weekly
// no longer sits behind it, so a level 20 who can never take a pike can still join the kill.
import { describe, expect, it } from 'vitest';
import { MUSTER_RACK } from '../src/sim/content/mirefen_muster';
import {
  MUSTER_PIKE_DRILL_QUEST_ID,
  MUSTER_SUMMONS_QUEST_ID,
  MUSTER_TROPHY_QUEST_ID,
} from '../src/sim/content/mirefen_muster_quests';
import { BUILTIN_WORLD, QUESTS } from '../src/sim/data';
import { MUSTER_PIKE_MAX_LEVEL } from '../src/sim/lance_balance_core';
import type { MusterArmyState } from '../src/sim/mirefen_muster';
import { MUSTER_PIKE_LEVEL_REFUSAL, MUSTER_SHARDPIKE_ID } from '../src/sim/muster_pike';
import { computeQuestState } from '../src/sim/quests/quest_commands';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';
import { shardpikePromptState } from '../src/ui/hud/shardpike/shardpike_prompt_view';
import { localizeSimText } from '../src/ui/sim_i18n';

const lair = WORLD_BOSSES.find((b) => b.templateId === 'balgath_cyclops')?.pos ?? {
  x: 0,
  z: 0,
};
const TEST_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

interface Internals {
  musterArmy: MusterArmyState;
  spawnDevBoss(t: string, x: number, z: number): number;
}

function atTheRack(level: number) {
  const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: true, world: TEST_WORLD });
  if (level > 1) sim.setPlayerLevel(level);
  const inner = sim as unknown as Internals;
  inner.spawnDevBoss('balgath_cyclops', lair.x, lair.z);
  for (let i = 0; i < 25 && inner.musterArmy.soldierIds.length === 0; i++) sim.tick();
  const rack = sim.entities.get(inner.musterArmy.rackId ?? -1);
  if (!rack) throw new Error('no rack');
  const p: Entity = sim.player;
  p.pos.x = MUSTER_RACK.x + 2;
  p.pos.z = MUSTER_RACK.z - 2;
  p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  const take = (): string[] => {
    sim.player.targetId = rack.id;
    sim.interact();
    return sim
      .tick()
      .filter((e) => e.type === 'error')
      .map((e) => (e as { text: string }).text);
  };
  const mainhand = () => sim.players.get(sim.playerId)?.equipment.mainhand ?? null;
  return { sim, take, mainhand };
}

describe('the muster pike is for level 19 and below', () => {
  it('caps the loan at 19', () => {
    expect(MUSTER_PIKE_MAX_LEVEL).toBe(19);
  });

  it('lends a level 19 a pike', () => {
    const { sim, take, mainhand } = atTheRack(19);
    expect(sim.player.level).toBe(19);
    expect(take()).not.toContain(MUSTER_PIKE_LEVEL_REFUSAL);
    expect(mainhand()).toBe(MUSTER_SHARDPIKE_ID);
  });

  it('refuses a level 20, says why, and leaves the hands and bags as they were', () => {
    const { sim, take, mainhand } = atTheRack(20);
    const before = mainhand();
    expect(take()).toContain(MUSTER_PIKE_LEVEL_REFUSAL);
    expect(mainhand()).toBe(before);
    expect(sim.countItem(MUSTER_SHARDPIKE_ID)).toBe(0);
  });

  it('localizes the refusal through the client matcher', () => {
    expect(MUSTER_PIKE_LEVEL_REFUSAL).toContain(String(MUSTER_PIKE_MAX_LEVEL));
    expect(localizeSimText(MUSTER_PIKE_LEVEL_REFUSAL)).not.toBeNull();
  });

  it('shows a level 20 at the rack the cap instead of the take prompt', () => {
    const base = {
      mainhandItemId: null,
      trial: null,
      guidance: null,
      restRemaining: 0,
      dead: false,
      rackInReach: true,
      interactKey: 'F',
    };
    const young = shardpikePromptState({ ...base, playerLevel: 19 });
    expect(young.bodyKey).toBe('hudChrome.shardpike.promptTakePike');
    const veteran = shardpikePromptState({ ...base, playerLevel: 20 });
    expect(veteran.visible).toBe(true);
    expect(veteran.bodyKey).toBe('hudChrome.shardpike.promptPikeLevelCap');
    expect(veteran.values).toEqual({ level: String(MUSTER_PIKE_MAX_LEVEL) });
  });
});

describe('the quests follow the rule', () => {
  const done = new Set([MUSTER_SUMMONS_QUEST_ID]);
  const log = new Map();

  it('offers Pikes First up to level 19 only, and says so', () => {
    expect(computeQuestState(MUSTER_PIKE_DRILL_QUEST_ID, log, done, 19)).toBe('available');
    expect(computeQuestState(MUSTER_PIKE_DRILL_QUEST_ID, log, done, 20)).toBe('unavailable');
    expect(QUESTS[MUSTER_PIKE_DRILL_QUEST_ID]?.text).toContain(
      `level ${MUSTER_PIKE_MAX_LEVEL} or lower`,
    );
    expect(QUESTS[MUSTER_SUMMONS_QUEST_ID]?.completionText).toContain(
      `level ${MUSTER_PIKE_MAX_LEVEL} or lower`,
    );
  });

  it('opens the weekly to a level 20 straight from the briefing', () => {
    expect(QUESTS[MUSTER_TROPHY_QUEST_ID]?.requiresQuest).toBe(MUSTER_SUMMONS_QUEST_ID);
    expect(computeQuestState(MUSTER_TROPHY_QUEST_ID, log, done, 20)).toBe('available');
  });
});
