import { describe, expect, it } from 'vitest';
import { GATHER_NODES } from '../src/sim/data';
import { ARCHETYPE_PAIR_TARGETS, normalizeArchetypeState } from '../src/sim/professions/archetype';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';
import { COMMAND_NAMES } from '../src/world_api';

const LORE_QUEST = 'q_archetype_acceptance';
const AMENDS_QUEST = 'q_prof_make_amends';
const HOBBY_QUEST = 'q_prof_hobby_switch';
// Canonical pair ids follow CRAFT_RING order (see archetypePairId), so the
// armor/weapon pair reads weaponcrafting-first since the Professions 2.0
// ring reorder.
const WEAPON_ARMOR = 'weaponcrafting+armorcrafting';
const JEWEL_WEAPON = 'jewelcrafting+weaponcrafting';

function makeSim(seed = 9042): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function moveToSmith(sim: Sim, pid = sim.playerId): void {
  const smith = [...sim.entities.values()].find((e) => e.templateId === 'smith_haldren');
  if (!smith) throw new Error('smith_haldren missing');
  const player = sim.entities.get(pid);
  if (!player) throw new Error('player missing');
  player.pos.x = smith.pos.x + 1;
  player.pos.z = smith.pos.z;
}

function unlockProfessionQuests(sim: Sim, pid = sim.playerId): void {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error('player meta missing');
  meta.questsDone.add('q_prof_intro');
}

function acceptProfessionQuest(sim: Sim, questId: string, selection: string): void {
  moveToSmith(sim);
  sim.acceptQuest(questId, selection);
}

function completeAndTurnIn(sim: Sim, questId: string): void {
  const qp = sim.questLog.get(questId);
  if (!qp) throw new Error(`${questId} was not accepted`);
  qp.counts = [...(qp.resolvedCounts ?? [])];
  qp.state = 'ready';
  moveToSmith(sim);
  sim.turnInQuest(questId);
}

function attuneNewPair(sim: Sim, selection: string): void {
  acceptProfessionQuest(sim, LORE_QUEST, selection);
  completeAndTurnIn(sim, LORE_QUEST);
}

describe('live profession attunement quests', () => {
  it('only exposes profession quests that have a legal selection target', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);

    expect(sim.questState(LORE_QUEST)).toBe('available');
    expect(sim.questState(AMENDS_QUEST)).toBe('unavailable');
    expect(sim.questState(HOBBY_QUEST)).toBe('unavailable');

    attuneNewPair(sim, ARCHETYPE_PAIR_TARGETS[0]);
    expect(sim.questState(AMENDS_QUEST)).toBe('unavailable');
    expect(sim.questState(HOBBY_QUEST)).toBe('available');

    attuneNewPair(sim, ARCHETYPE_PAIR_TARGETS[1]);
    expect(sim.questState(AMENDS_QUEST)).toBe('available');

    for (const target of ARCHETYPE_PAIR_TARGETS.slice(2)) attuneNewPair(sim, target);
    expect(sim.questState(LORE_QUEST)).toBe('unavailable');
  });

  it('attunes an adjacent pair only when the persisted lore-quest selection completes', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);

    acceptProfessionQuest(sim, LORE_QUEST, WEAPON_ARMOR);
    expect(sim.activeArchetype).toBeNull();
    expect(sim.questLog.get(LORE_QUEST)?.selection).toBe(WEAPON_ARMOR);

    completeAndTurnIn(sim, LORE_QUEST);
    expect(sim.craftingIdentity).toMatchObject({
      activeArchetype: 'weaponcrafting',
      pairedMajor: 'armorcrafting',
      attunedPairs: [WEAPON_ARMOR],
    });
    expect(sim.archetypeSwitchCount).toBe(0);
  });

  it('rejects malformed, non-adjacent, and already-attuned lore targets at acceptance', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);
    moveToSmith(sim);

    sim.acceptQuest(LORE_QUEST, 'not-a-pair');
    sim.acceptQuest(LORE_QUEST, 'armorcrafting+cooking');
    expect(sim.questLog.has(LORE_QUEST)).toBe(false);

    attuneNewPair(sim, WEAPON_ARMOR);
    sim.acceptQuest(LORE_QUEST, WEAPON_ARMOR);
    expect(sim.questLog.has(LORE_QUEST)).toBe(false);
  });

  it('uses lore for a new pair and escalating make-amends for a previously held pair', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);
    attuneNewPair(sim, WEAPON_ARMOR);
    attuneNewPair(sim, JEWEL_WEAPON);
    expect(sim.archetypeSwitchCount).toBe(0);

    acceptProfessionQuest(sim, AMENDS_QUEST, WEAPON_ARMOR);
    const first = sim.questLog.get(AMENDS_QUEST);
    expect(first?.resolvedCounts).toEqual([5]);
    completeAndTurnIn(sim, AMENDS_QUEST);
    expect(sim.craftingIdentity.activeArchetype).toBe('weaponcrafting');
    expect(sim.archetypeSwitchCount).toBe(1);

    acceptProfessionQuest(sim, AMENDS_QUEST, JEWEL_WEAPON);
    expect(sim.questLog.get(AMENDS_QUEST)?.resolvedCounts).toEqual([8]);
  });

  it('switches the explicit hobby only to the other opposite candidate', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);
    attuneNewPair(sim, WEAPON_ARMOR);
    expect(sim.hobbyCraft).toBe('leatherworking');

    acceptProfessionQuest(sim, HOBBY_QUEST, 'tailoring');
    completeAndTurnIn(sim, HOBBY_QUEST);
    expect(sim.hobbyCraft).toBe('tailoring');

    acceptProfessionQuest(sim, HOBBY_QUEST, 'alchemy');
    expect(sim.questLog.has(HOBBY_QUEST)).toBe(false);
  });

  it('round-trips active pair, explicit hobby, history, and an accepted quest selection', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);
    attuneNewPair(sim, WEAPON_ARMOR);
    acceptProfessionQuest(sim, HOBBY_QUEST, 'tailoring');

    const saved = sim.serializeCharacter(sim.playerId);
    const reloaded = makeSim(9043);
    const pid = reloaded.addPlayer('warrior', 'Reloaded', { state: saved ?? undefined });

    expect(reloaded.craftingIdentityFor(pid)).toMatchObject({
      activeArchetype: 'weaponcrafting',
      pairedMajor: 'armorcrafting',
      hobbyCraft: 'leatherworking',
      attunedPairs: [WEAPON_ARMOR],
    });
    expect(reloaded.players.get(pid)?.questLog.get(HOBBY_QUEST)).toMatchObject({
      selection: 'tailoring',
      resolvedCounts: [3],
    });
  });

  it('normalizes an old pair save with deterministic hobby and deduplicated history', () => {
    expect(
      normalizeArchetypeState({
        activeArchetype: 'armorcrafting',
        pairedMajor: 'weaponcrafting',
        switchCount: 2,
        amendsProgress: 4,
      }),
    ).toEqual({
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'leatherworking',
      attunedPairs: [WEAPON_ARMOR],
      switchCount: 2,
      amendsProgress: 4,
    });
  });

  it('drops a stale or unknown attuned pair id by design and keeps the rest of the save intact', () => {
    // normalizeArchetypeState filters attunedPairs through isAdjacentPairTarget.
    // The stale id below ('armorcrafting+weaponcrafting') is the pre-reorder
    // canonical form of the armor/weapon pair; no deployed build ever persisted
    // attunedPairs before the ring reorder landed, so dropping it silently (no
    // throw, no repair) is the intended semantics for any unrecognized id.
    const state = normalizeArchetypeState({
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'tailoring',
      attunedPairs: ['armorcrafting+weaponcrafting', WEAPON_ARMOR, 'not+a+pair'],
      switchCount: 3,
      amendsProgress: 2,
    });
    expect(state.attunedPairs).toEqual([WEAPON_ARMOR]);
    expect(state).toEqual({
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'tailoring',
      attunedPairs: [WEAPON_ARMOR],
      switchCount: 3,
      amendsProgress: 2,
    });
  });

  it('does not add a direct profession-transition command to the client protocol', () => {
    expect(COMMAND_NAMES).not.toContain('attune_profession');
    expect(COMMAND_NAMES).not.toContain('switch_hobby');
    expect(COMMAND_NAMES).not.toContain('advance_amends');
  });

  // Phase 1 changed sim LOGIC, not just content data: the quest-effect
  // transitions (profession_quest_effects.ts), the gather/craft quest-credit
  // arms (quest_credit.ts), the removed bespoke node quest grant
  // (gathering.ts), and the attunement-gated combo craft path (crafting.ts,
  // combo_eligibility.ts). So the whole flow gets a same-seed determinism pin:
  // two sims with the same seed running the identical command script must end
  // byte-identical, including every rng-drawing step (harvest rarity rolls and
  // the craft path's masterwork proc draw share the one world rng stream).
  it('same-seed runs of the gather, craft, attune, and hobby-switch flow are identical', () => {
    const run = () => {
      const sim = makeSim(4242);
      const pid = sim.playerId;
      unlockProfessionQuests(sim);

      const oreNodes = GATHER_NODES.filter((node) => node.type === 'ore').slice(0, 2);
      expect(oreNodes).toHaveLength(2);
      for (const node of oreNodes) {
        const player = sim.entities.get(pid)!;
        player.pos.x = node.pos.x;
        player.pos.z = node.pos.z;
        player.pos.y = terrainHeight(node.pos.x, node.pos.z, sim.cfg.seed);
        player.prevPos = { ...player.pos };
        sim.harvestNode(node.id, pid); // rarity roll: draws rng
        sim.tick();
      }

      attuneNewPair(sim, WEAPON_ARMOR);
      sim.addItem('linen_scrap', 1, pid);
      sim.addItem('spider_leg', 1, pid);
      sim.craftItem('recipe_minor_healing_potion', pid); // masterwork proc: draws rng
      acceptProfessionQuest(sim, HOBBY_QUEST, 'tailoring');
      completeAndTurnIn(sim, HOBBY_QUEST);
      for (let i = 0; i < 20; i++) sim.tick();

      return {
        save: sim.serializeCharacter(pid),
        identity: sim.craftingIdentity,
        lastCraft: sim.meta(pid)?.lastCraftResult,
      };
    };

    const first = run();
    // Decisive anchors so a doubly-failed script can never pass vacuously.
    expect(first.identity).toMatchObject({
      hobbyCraft: 'tailoring',
      attunedPairs: [WEAPON_ARMOR],
    });
    expect(first.lastCraft?.ok).toBe(true);
    expect(run()).toEqual(first);
  });
});
