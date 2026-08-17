// The farming intro quest (the farming go-live, D20): q_farm_intro at Farmer
// Jessica, the profession's front door on the q_prof_intro template. This file
// covers the CONTENT SHAPE and the accept path: the row, its two farm ACTION
// objectives, its place in the zone chain, that a fresh level-1 character can
// take it at the farmer and walks away with exactly one hoe and one seed, and
// the two teaching sentences the completion text must carry verbatim. The
// crediting arm (plant and harvest advancing the counts) lives with the
// quest_credit module and its own suite, not here.

import { describe, expect, it } from 'vitest';
import { ZONE1_QUEST_ORDER } from '../src/sim/content/zone1';
import { NPCS, QUEST_ORDER, QUESTS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { INTERACT_RANGE } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const QUEST_ID = 'q_farm_intro';
const GIVER = 'farmer_jessica';
const HOE = 'garden_hoe';
const SEED = 'vale_wheat_seed';

const MAGIC_SENTENCE = 'It keeps growing while you are away, and it never spoils.';
const JOURNAL_POINTER =
  'Your Harvest Journal (Shift+K, or the Farming row of your Professions window) lists every planted bed and its timer.';

function freshCharacter(): { sim: Sim; pid: number } {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Sower');
  return { sim, pid };
}

function standAtGiver(sim: Sim, pid: number): void {
  const giver = [...sim.entities.values()].find((e) => e.kind === 'npc' && e.templateId === GIVER);
  if (!giver) throw new Error('farmer_jessica did not spawn');
  const p = sim.entities.get(pid);
  if (!p) throw new Error('missing player');
  p.pos.x = giver.pos.x + 1;
  p.pos.z = giver.pos.z;
  p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

describe('q_farm_intro content wiring', () => {
  it('is a real, level-1-available quest given and turned in by farmer_jessica', () => {
    const quest = QUESTS[QUEST_ID];
    expect(quest).toBeDefined();
    expect(quest.giverNpcId).toBe(GIVER);
    expect(quest.turnInNpcId).toBe(GIVER);
    expect(quest.minLevel).toBeUndefined();
    expect(quest.requiresQuest).toBeUndefined();
    expect(quest.retired).toBeUndefined();
    expect(quest.repeatable).toBeUndefined();
    // A NEW quest carries no rev: nothing in flight can be under an older
    // objective list (types.ts rev rule).
    expect(quest.rev).toBeUndefined();
    expect(quest.name).toBe('First Furrow');
  });

  it('is offered by farmer_jessica and ordered into the zone chain right after q_prof_intro', () => {
    expect(NPCS[GIVER].questIds).toContain(QUEST_ID);
    expect(NPCS[GIVER].farmer).toBe(true);
    expect(QUEST_ORDER).toContain(QUEST_ID);
    const introAt = ZONE1_QUEST_ORDER.indexOf('q_prof_intro');
    expect(introAt).toBeGreaterThanOrEqual(0);
    expect(ZONE1_QUEST_ORDER[introAt + 1]).toBe(QUEST_ID);
    // Once, and only once (tests/progression.test.ts pins the global cover;
    // this is the local twin so a duplicate zone-order row reds nearer home).
    expect(ZONE1_QUEST_ORDER.filter((id) => id === QUEST_ID)).toHaveLength(1);
  });

  it('uses EXACTLY the two farm ACTION objectives: plant, then harvest, Vale Wheat at Eastbrook', () => {
    // Literal, order included: an inventory-shaped `collect` objective could
    // be satisfied by market produce, which is the design this row exists to
    // avoid (D20: credit the action, never the bag).
    expect(QUESTS[QUEST_ID].objectives).toEqual([
      {
        type: 'farm',
        action: 'plant',
        cropId: 'vale_wheat',
        patchId: 'patch_eastbrook',
        count: 1,
        label: 'Vale Wheat planted',
      },
      {
        type: 'farm',
        action: 'harvest',
        cropId: 'vale_wheat',
        patchId: 'patch_eastbrook',
        count: 1,
        label: 'Vale Wheat harvested',
      },
    ]);
  });

  it('grants xp and copper on completion, no item reward, and re-grants the hoe and one seed', () => {
    const quest = QUESTS[QUEST_ID];
    expect(quest.xpReward).toBe(150);
    expect(quest.copperReward).toBe(50);
    expect(Object.keys(quest.itemRewards)).toHaveLength(0);
    // The fallback-grant list, literal: the rung-one hoe (the step-12 hoe
    // gate) and the one seed the objective needs. Order matters to nothing,
    // but the SET does: a third entry would widen a bounded faucet.
    expect(quest.requiredItems).toEqual([HOE, SEED]);
  });

  it('teaches the two go-live sentences VERBATIM in the completion text', () => {
    const quest = QUESTS[QUEST_ID];
    expect(quest.completionText).toContain(MAGIC_SENTENCE);
    expect(quest.completionText).toContain(JOURNAL_POINTER);
    // The offer text is the instruction, not the lesson: it names the hoe,
    // the seed and the beds, and does not repeat the lesson (which would
    // read as one speech given twice at the same NPC).
    expect(quest.text).toContain('hoe');
    expect(quest.text).toContain('seed');
    expect(quest.text).toContain('bed');
    expect(quest.text).not.toContain(MAGIC_SENTENCE);
    // Both texts speak to the player by name token, the greeting's register.
    expect(quest.text).toContain('$N');
    expect(quest.completionText).toContain('$N');
    // And Jessica's greeting carries the same two sentences, so the lesson
    // is heard whether or not the quest is taken.
    expect(NPCS[GIVER].greeting).toContain(MAGIC_SENTENCE);
    expect(NPCS[GIVER].greeting).toContain(JOURNAL_POINTER);
  });
});

describe('q_farm_intro: the accept path at the farmer', () => {
  it('a fresh level-1 character in reach accepts it and receives exactly one hoe and one seed', () => {
    const { sim, pid } = freshCharacter();
    expect(sim.entities.get(pid)?.level).toBe(1);
    expect(sim.countItem(HOE, pid)).toBe(0);
    expect(sim.countItem(SEED, pid)).toBe(0);
    standAtGiver(sim, pid);
    expect(sim.questState(QUEST_ID, pid)).toBe('available');
    sim.acceptQuest(QUEST_ID, pid);
    expect(sim.questState(QUEST_ID, pid)).toBe('active');
    expect(sim.countItem(HOE, pid)).toBe(1);
    expect(sim.countItem(SEED, pid)).toBe(1);
    // Fresh counts: nothing credited by the accept itself.
    expect(sim.meta(pid)?.questLog.get(QUEST_ID)?.counts).toEqual([0, 0]);
  });

  it('a second accept and a second talk do NOT double-grant while both items are held', () => {
    const { sim, pid } = freshCharacter();
    standAtGiver(sim, pid);
    sim.acceptQuest(QUEST_ID, pid);
    expect(sim.questState(QUEST_ID, pid)).toBe('active');
    // Re-accepting an active quest is refused and grants nothing.
    sim.acceptQuest(QUEST_ID, pid);
    expect(sim.countItem(HOE, pid)).toBe(1);
    expect(sim.countItem(SEED, pid)).toBe(1);
    // Talking to the giver again re-grants only what is MISSING (the
    // in-progress twin of the accept grant): with both held, nothing moves.
    const giver = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === GIVER,
    );
    if (!giver) throw new Error('farmer_jessica did not spawn');
    sim.talkToNpc(giver.id, pid);
    expect(sim.countItem(HOE, pid)).toBe(1);
    expect(sim.countItem(SEED, pid)).toBe(1);
    expect(sim.questState(QUEST_ID, pid)).toBe('active');
  });

  it('re-grants ONLY the lost item on a later talk: the bounded fallback, not a mint', () => {
    // The seed is consumed by planting, so this is the path a day-one
    // character takes after sowing: back at the farmer, missing the seed and
    // holding the hoe, one seed comes back and no second hoe does.
    const { sim, pid } = freshCharacter();
    standAtGiver(sim, pid);
    sim.acceptQuest(QUEST_ID, pid);
    expect(sim.questState(QUEST_ID, pid)).toBe('active');
    sim.removeItem(SEED, 1, pid);
    expect(sim.countItem(SEED, pid)).toBe(0);
    const giver = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === GIVER,
    );
    if (!giver) throw new Error('farmer_jessica did not spawn');
    sim.talkToNpc(giver.id, pid);
    expect(sim.countItem(SEED, pid)).toBe(1);
    expect(sim.countItem(HOE, pid)).toBe(1);
  });

  it('refuses the accept out of reach of the farmer and grants nothing', () => {
    const { sim, pid } = freshCharacter();
    standAtGiver(sim, pid);
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing player');
    p.pos.x += INTERACT_RANGE + 20;
    p.prevPos = { ...p.pos };
    sim.acceptQuest(QUEST_ID, pid);
    expect(sim.questState(QUEST_ID, pid)).toBe('available');
    expect(sim.countItem(HOE, pid)).toBe(0);
    expect(sim.countItem(SEED, pid)).toBe(0);
  });
});
