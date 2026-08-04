import { describe, expect, it } from 'vitest';
import { ZONE1_QUESTS } from '../src/sim/content/zone1';
import { GATHER_NODES, QUESTS } from '../src/sim/data';
import { normalizeArchetypeState } from '../src/sim/professions/archetype';
import { isIdentityTransitionQuest } from '../src/sim/quests/profession_quest_effects';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';
import { COMMAND_NAMES } from '../src/world_api';

// The per-master attunement model retired the single shared acceptance /
// make-amends quests in favor of one attune + one make-amends quest per anchor
// master, each pinning its own canonical pair. These re-pins exercise the same
// behaviors against the per-pair quest ids (behavior-equivalent; further
// coverage lives in the professions_tier_mail / professions_nudges /
// professions_quest_cadence suites).
const HOBBY_QUEST = 'q_prof_hobby_switch';
// Canonical pair ids follow CRAFT_RING order (see archetypePairId); the smith and
// outfitter pairs are two of the four wave-one anchor masters.
const WEAPON_ARMOR = 'weaponcrafting+armorcrafting'; // Smith (Forgemistress Darva)
const LEATHER_TAILOR = 'leatherworking+tailoring'; // Outfitter (Weaver Ottilie)
const SMITH_MASTER = 'forgemistress_darva';
const OUTFITTER_MASTER = 'weaver_ottilie';
// The hobby-switch quest is given by Smith Haldren, not an anchor master.
const HOBBY_MASTER = 'smith_haldren';

function makeSim(seed = 9042): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function moveToNpc(sim: Sim, templateId: string, pid = sim.playerId): void {
  const npc = [...sim.entities.values()].find((e) => e.templateId === templateId);
  if (!npc) throw new Error(`${templateId} missing`);
  const player = sim.entities.get(pid);
  if (!player) throw new Error('player missing');
  player.pos.x = npc.pos.x + 1;
  player.pos.z = npc.pos.z;
}

function unlockProfessionQuests(sim: Sim, pid = sim.playerId): void {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error('player meta missing');
  meta.questsDone.add('q_prof_intro');
}

function acceptAt(sim: Sim, npcTemplate: string, questId: string, selection?: string): void {
  moveToNpc(sim, npcTemplate);
  sim.acceptQuest(questId, selection);
}

function completeAndTurnInAt(sim: Sim, npcTemplate: string, questId: string): void {
  const qp = sim.questLog.get(questId);
  if (!qp) throw new Error(`${questId} was not accepted`);
  qp.counts = [...(qp.resolvedCounts ?? [])];
  qp.state = 'ready';
  moveToNpc(sim, npcTemplate);
  sim.turnInQuest(questId);
}

function attune(sim: Sim, npcTemplate: string, questId: string, pairId: string): void {
  acceptAt(sim, npcTemplate, questId, pairId);
  completeAndTurnInAt(sim, npcTemplate, questId);
}

describe('live profession attunement quests', () => {
  it('exposes each master quest per the unattuned / matching / wrong-with-history matrix', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);

    // Unattuned: the smith's attune is available, its make-amends is not, and the
    // hobby switch is not (there is no pair to give a hobby yet).
    expect(sim.questState('q_prof_attune_smith')).toBe('available');
    expect(sim.questState('q_prof_amends_smith')).toBe('unavailable');
    expect(sim.questState(HOBBY_QUEST)).toBe('unavailable');

    attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    // Attuned to the matching pair: the one-time smith attune is now done (never
    // repeatable), its amends is unavailable (it is the current pair), and the
    // hobby switch is now available.
    expect(sim.questState('q_prof_attune_smith')).toBe('done');
    expect(sim.questState('q_prof_amends_smith')).toBe('unavailable');
    expect(sim.questState(HOBBY_QUEST)).toBe('available');

    attune(sim, OUTFITTER_MASTER, 'q_prof_attune_outfitter', LEATHER_TAILOR);
    // Attuned to a wrong pair with the smith pair in history: the smith's amends
    // is available (return), its one-time attune stays done (the way back is
    // make-amends, never the lore quest again).
    expect(sim.questState('q_prof_amends_smith')).toBe('available');
    expect(sim.questState('q_prof_attune_smith')).toBe('done');
  });

  it('attunes a pair only when the persisted per-pair attune selection completes', () => {
    const sim = makeSim();

    acceptAt(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    expect(sim.activeArchetype).toBeNull();
    expect(sim.questLog.get('q_prof_attune_smith')?.selection).toBe(WEAPON_ARMOR);

    completeAndTurnInAt(sim, SMITH_MASTER, 'q_prof_attune_smith');
    expect(sim.craftingIdentity).toMatchObject({
      activeArchetype: 'weaponcrafting',
      pairedMajor: 'armorcrafting',
      attunedPairs: [WEAPON_ARMOR],
    });
    expect(sim.archetypeSwitchCount).toBe(0);
  });

  it('rejects a selection other than the quest pinned pair, and a re-attune once seen', () => {
    const sim = makeSim();
    moveToNpc(sim, SMITH_MASTER);

    sim.acceptQuest('q_prof_attune_smith', 'not-a-pair');
    sim.acceptQuest('q_prof_attune_smith', LEATHER_TAILOR); // a real pair, but not the smith's
    expect(sim.questLog.has('q_prof_attune_smith')).toBe(false);

    attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    moveToNpc(sim, SMITH_MASTER);
    sim.acceptQuest('q_prof_attune_smith', WEAPON_ARMOR); // already attuned to it (mode 'new' seen)
    expect(sim.questLog.has('q_prof_attune_smith')).toBe(false);
  });

  it('uses attune for a new pair and escalating make-amends for a previously held pair', () => {
    const sim = makeSim();
    attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    attune(sim, OUTFITTER_MASTER, 'q_prof_attune_outfitter', LEATHER_TAILOR);
    expect(sim.archetypeSwitchCount).toBe(0);

    acceptAt(sim, SMITH_MASTER, 'q_prof_amends_smith', WEAPON_ARMOR);
    expect(sim.questLog.get('q_prof_amends_smith')?.resolvedCounts).toEqual([5]);
    completeAndTurnInAt(sim, SMITH_MASTER, 'q_prof_amends_smith');
    expect(sim.craftingIdentity.activeArchetype).toBe('weaponcrafting');
    expect(sim.archetypeSwitchCount).toBe(1);

    acceptAt(sim, OUTFITTER_MASTER, 'q_prof_amends_outfitter', LEATHER_TAILOR);
    expect(sim.questLog.get('q_prof_amends_outfitter')?.resolvedCounts).toEqual([8]);
  });

  it('resolves amends availability without crashing when a non-wave-one pair is in history', () => {
    // A player attuned under the retired un-narrowed acceptance
    // quest can hold any of the ten ring pairs. The four make-amends quests pin
    // only the wave-one pairs, so a non-wave-one pair has no return path (an
    // accepted consequence, flagged in the PR body); the masters must still
    // resolve availability without crashing on the unrecognized history entry.
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId);
    if (!meta) throw new Error('player meta missing');
    meta.archetype.activeArchetype = 'tailoring';
    meta.archetype.pairedMajor = 'inscription';
    meta.archetype.attunedPairs = ['tailoring+inscription'];

    // None of the wave-one amends quests offers the non-wave-one pair.
    expect(sim.questState('q_prof_amends_smith')).toBe('unavailable');
    expect(sim.questState('q_prof_amends_outfitter')).toBe('unavailable');
    expect(sim.questState('q_prof_amends_apothecary')).toBe('unavailable');
    expect(sim.questState('q_prof_amends_bombardier')).toBe('unavailable');
    // A wave-one attune is still reachable (that pair is new to this character).
    expect(sim.questState('q_prof_attune_smith')).toBe('available');
  });

  it('switches the explicit hobby only to the other opposite candidate', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);
    attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    expect(sim.hobbyCraft).toBe('leatherworking');

    acceptAt(sim, HOBBY_MASTER, HOBBY_QUEST, 'tailoring');
    completeAndTurnInAt(sim, HOBBY_MASTER, HOBBY_QUEST);
    expect(sim.hobbyCraft).toBe('tailoring');

    acceptAt(sim, HOBBY_MASTER, HOBBY_QUEST, 'alchemy'); // not an opposite candidate
    expect(sim.questLog.has(HOBBY_QUEST)).toBe(false);
  });

  it('a make-amends return restores the hobby this character quested for that pair', () => {
    // End to end through the real quests: the explicit choice is destroyed at
    // the transition AWAY (every transition re-derives the pair default), so
    // without the per-pair memory the return below lands on 'leatherworking',
    // the skill default this character deliberately quested away from.
    const sim = makeSim();
    unlockProfessionQuests(sim);
    attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    expect(sim.hobbyCraft).toBe('leatherworking'); // the pair default

    acceptAt(sim, HOBBY_MASTER, HOBBY_QUEST, 'tailoring');
    completeAndTurnInAt(sim, HOBBY_MASTER, HOBBY_QUEST);
    expect(sim.hobbyCraft).toBe('tailoring');

    // Away to the outfitter pair: its own default hobby applies, and the smith
    // pair's quested choice is no longer anywhere in live archetype state.
    attune(sim, OUTFITTER_MASTER, 'q_prof_attune_outfitter', LEATHER_TAILOR);
    expect(sim.hobbyCraft).toBe('weaponcrafting');

    // The make-amends return: the quested hobby comes back, not the default.
    acceptAt(sim, SMITH_MASTER, 'q_prof_amends_smith', WEAPON_ARMOR);
    completeAndTurnInAt(sim, SMITH_MASTER, 'q_prof_amends_smith');
    expect(sim.craftingIdentity.activeArchetype).toBe('weaponcrafting');
    expect(sim.hobbyCraft).toBe('tailoring');
  });

  it('round-trips active pair, explicit hobby, history, and an accepted quest selection', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);
    attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    acceptAt(sim, HOBBY_MASTER, HOBBY_QUEST, 'tailoring');

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
      isJackOfAllTrades: false,
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
      isJackOfAllTrades: false,
    });
  });

  it('does not add a direct profession-transition command to the client protocol', () => {
    expect(COMMAND_NAMES).not.toContain('attune_profession');
    expect(COMMAND_NAMES).not.toContain('switch_hobby');
    expect(COMMAND_NAMES).not.toContain('advance_amends');
  });

  // The attunement flow changed sim LOGIC, not just content data: the quest-effect
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
        sim.harvestNode(node.id, undefined, pid); // rarity roll: draws rng
        sim.tick();
      }

      attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
      sim.addItem('linen_scrap', 1, pid);
      sim.addItem('spider_leg', 1, pid);
      sim.addItem('silverleaf_herb', 2, pid); // the reworked recipe's herb reagent
      sim.craftItem('recipe_minor_healing_potion', false, pid); // masterwork proc: draws rng
      acceptAt(sim, HOBBY_MASTER, HOBBY_QUEST, 'tailoring');
      completeAndTurnInAt(sim, HOBBY_MASTER, HOBBY_QUEST);
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

// Full-matrix coverage: the tests above exercise the smith and outfitter as
// exemplars, but every wave-one anchor master must attune ITS pinned pair end to
// end and expose the same availability matrix. These table-driven suites run all
// four so a new master, a mis-pinned pairId, or a dropped celebration emit reds a
// row (the smith/outfitter exemplars above stay as the detailed, non-parametric
// walkthrough). `other` is the next master in the ring, used as the wrong-pair
// history for the amends-availability check.
const MASTERS = [
  {
    master: SMITH_MASTER,
    attuneQuest: 'q_prof_attune_smith',
    amendsQuest: 'q_prof_amends_smith',
    pair: WEAPON_ARMOR,
  },
  {
    master: OUTFITTER_MASTER,
    attuneQuest: 'q_prof_attune_outfitter',
    amendsQuest: 'q_prof_amends_outfitter',
    pair: LEATHER_TAILOR,
  },
  {
    master: 'cook_marlow',
    attuneQuest: 'q_prof_attune_apothecary',
    amendsQuest: 'q_prof_amends_apothecary',
    pair: 'alchemy+cooking',
  },
  {
    master: 'tinker_gizzel',
    attuneQuest: 'q_prof_attune_bombardier',
    amendsQuest: 'q_prof_amends_bombardier',
    pair: 'engineering+alchemy',
  },
] as const;

const MASTERS_WITH_OTHER = MASTERS.map((m, i) => ({
  ...m,
  other: MASTERS[(i + 1) % MASTERS.length],
}));

describe.each(MASTERS)(
  '$attuneQuest attunes its pinned pair end to end',
  ({ master, attuneQuest, pair }) => {
    it('accepts, turns in, sets the pair active, and emits both celebration events', () => {
      const sim = makeSim();
      unlockProfessionQuests(sim);
      sim.drainEvents(); // clear join / welcome noise before the attune

      attune(sim, master, attuneQuest, pair);

      // Archetype state: the pinned pair is now attuned and active. The two
      // majors are the pair's two crafts (order-agnostic, so canonical-order
      // changes cannot silently pass a wrong assignment).
      const identity = sim.craftingIdentity;
      expect(identity.attunedPairs).toContain(pair);
      expect(new Set([identity.activeArchetype, identity.pairedMajor])).toEqual(
        new Set(pair.split('+')),
      );

      // Celebration events emitted for THIS pair (personal + zone), the whole
      // point of routing them through the validated turn-in effect.
      const events = sim.drainEvents();
      expect(events.some((e) => e.type === 'attuned' && e.pairId === pair)).toBe(true);
      expect(events.some((e) => e.type === 'attunedZone' && e.pairId === pair)).toBe(true);
    });
  },
);

describe.each(MASTERS_WITH_OTHER)(
  '$attuneQuest availability matrix',
  ({ master, attuneQuest, amendsQuest, pair, other }) => {
    it('is available unattuned, done with amends gated when current, amends-only-with-history when wrong', () => {
      const sim = makeSim();
      unlockProfessionQuests(sim);

      // Unattuned: the attune is offered, the make-amends is not (no history).
      expect(sim.questState(attuneQuest)).toBe('available');
      expect(sim.questState(amendsQuest)).toBe('unavailable');

      // Attuned to this master's pair: the one-time attune is done (never
      // repeatable), and its amends stays unavailable (it is the current pair).
      attune(sim, master, attuneQuest, pair);
      expect(sim.questState(attuneQuest)).toBe('done');
      expect(sim.questState(amendsQuest)).toBe('unavailable');

      // Attuned to a different master's pair, this pair now in history: the
      // make-amends return opens, the one-time attune stays done.
      attune(sim, other.master, other.attuneQuest, other.pair);
      expect(sim.questState(amendsQuest)).toBe('available');
      expect(sim.questState(attuneQuest)).toBe('done');

      // Mid-quest: the accepted amends reports 'active' (the fifth matrix
      // identity state), not a silent disappearance.
      acceptAt(sim, master, amendsQuest, pair);
      expect(sim.questState(amendsQuest)).toBe('active');
    });
  },
);

// The hobby-switch quest pays no XP. It is a
// repeatable identity toggle; any XP on it becomes a farmable trickle
// (gather 3 herbs, toggle, repeat), so the reward re-pins to 0 while the
// quest itself stays repeatable.
describe('q_prof_hobby_switch reward shape', () => {
  it('grants 0 XP and stays repeatable', () => {
    const quest = ZONE1_QUESTS[HOBBY_QUEST];
    expect(quest.xpReward).toBe(0);
    expect(quest.repeatable).toBe(true);
  });
});

// One pending identity transition at a time, where "identity transition" is
// BOTH completionEffect types (attunePair and switchHobby), not attunePair
// alone. Two stale-bank failures share the one gate:
//   - resolvedCounts is stamped at ACCEPT (finalizeQuestAccept) and turn-in
//     never re-resolves it, so holding two attunePair quests at once lets the
//     second complete at a stale amends cost: new-pair attunes are free and
//     leave switchCount at 0, so a player with three pairs in history can bank
//     both open amends quests at counts [5] and turn the second in after the
//     first return bumped switchCount to 1, dodging the honest 5 + 3 = 8.
//   - the hobby quest banks its chosen craft at accept, but a pair transition
//     rewrites the candidate set and the hobby, so a bank that straddles a
//     transition either applies a choice made under the old pair or sticks
//     unturnable-in on the turn-in revalidation ("no longer available", with
//     the gathered herbs spent and abandon the only way out).
// The shared computeQuestState therefore hides every OTHER identity-transition
// quest while one is active, on both hosts (the online mirror shares the
// function; the server accept gate rides questState). Plain quests (no
// completionEffect) stay outside the gate.
describe('identity-transition quests block each other', () => {
  const APOTHECARY_PAIR = 'alchemy+cooking';

  it('hides other attune quests while one is active, and reopens them on abandon', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);

    acceptAt(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    expect(sim.questState('q_prof_attune_smith')).toBe('active');
    expect(sim.questState('q_prof_attune_outfitter')).toBe('unavailable');
    // The gate is identity-scoped: a plain quest (the smith's work order, no
    // completionEffect) is untouched while the transition is pending.
    expect(sim.questState('q_prof_workorder_forge')).toBe('available');

    sim.abandonQuest('q_prof_attune_smith');
    expect(sim.questState('q_prof_attune_outfitter')).toBe('available');
  });

  it('hides the hobby switch while a pair transition is pending, and reopens it on abandon', () => {
    // Direction one of the widened scope. The hobby selection is banked on
    // QuestProgress at accept and validated against the pair that was current
    // THEN, so a hobby quest accepted while an amends is in flight can be
    // turned in against a different pair entirely.
    const sim = makeSim();
    unlockProfessionQuests(sim);
    attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    attune(sim, OUTFITTER_MASTER, 'q_prof_attune_outfitter', LEATHER_TAILOR);
    expect(sim.questState(HOBBY_QUEST)).toBe('available'); // not vacuous

    acceptAt(sim, SMITH_MASTER, 'q_prof_amends_smith', WEAPON_ARMOR);
    // The gated control: a fresh attunePair quest hides while amends is active.
    expect(sim.questState('q_prof_attune_apothecary')).toBe('unavailable');
    // The widened scope: the switchHobby quest hides too.
    expect(sim.questState(HOBBY_QUEST)).toBe('unavailable');
    // Still identity-scoped: a plain quest (the smith's work order, no
    // completionEffect) is untouched.
    expect(sim.questState('q_prof_workorder_forge')).toBe('available');

    sim.abandonQuest('q_prof_amends_smith');
    expect(sim.questState(HOBBY_QUEST)).toBe('available');
  });

  it('hides pair transitions while a hobby selection is banked, and refuses the accept', () => {
    // Direction two: the banked hobby craft goes stale the moment the pair
    // changes (the candidate set and the default hobby are both pair-derived),
    // so the transition quests close while a hobby switch is in flight. The
    // accept path refuses outright, which is what replaces the old stuck
    // turn-in ("That profession choice is no longer available", herbs spent).
    const sim = makeSim();
    unlockProfessionQuests(sim);
    attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    expect(sim.questState('q_prof_attune_outfitter')).toBe('available'); // not vacuous

    acceptAt(sim, HOBBY_MASTER, HOBBY_QUEST, 'tailoring');
    expect(sim.questLog.get(HOBBY_QUEST)?.selection).toBe('tailoring');
    expect(sim.questState('q_prof_attune_outfitter')).toBe('unavailable');
    expect(sim.questState('q_prof_workorder_forge')).toBe('available'); // plain quest control
    acceptAt(sim, OUTFITTER_MASTER, 'q_prof_attune_outfitter', LEATHER_TAILOR);
    expect(sim.questLog.has('q_prof_attune_outfitter')).toBe(false);

    sim.abandonQuest(HOBBY_QUEST);
    expect(sim.questState('q_prof_attune_outfitter')).toBe('available');
  });

  it('pins the shipped completionEffect vocabulary the gate treats as identity', () => {
    // The gate reads "carries a completionEffect", which is exactly "is an
    // identity transition" only while the shipped vocabulary stays these two
    // types. A third type has to come back to isIdentityTransitionQuest and
    // decide; this pin is what forces that.
    const shipped = new Set(
      Object.values(QUESTS)
        .map((quest) => quest.completionEffect?.type)
        .filter((type) => type !== undefined),
    );
    expect([...shipped].sort()).toEqual(['attunePair', 'switchHobby']);
    expect(isIdentityTransitionQuest(QUESTS.q_prof_attune_smith)).toBe(true);
    expect(isIdentityTransitionQuest(QUESTS[HOBBY_QUEST])).toBe(true);
    expect(isIdentityTransitionQuest(QUESTS.q_prof_workorder_forge)).toBe(false);
    expect(isIdentityTransitionQuest(undefined)).toBe(false);
  });

  it('refuses a banked second amends so escalation can never be dodged', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);

    // Three pairs in history at switchCount 0: new-pair attunes are free.
    attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    attune(sim, OUTFITTER_MASTER, 'q_prof_attune_outfitter', LEATHER_TAILOR);
    attune(sim, 'cook_marlow', 'q_prof_attune_apothecary', APOTHECARY_PAIR);
    expect(sim.archetypeSwitchCount).toBe(0);

    // Both non-active pairs' amends are open at the cheap first-switch cost.
    expect(sim.questState('q_prof_amends_smith')).toBe('available');
    expect(sim.questState('q_prof_amends_outfitter')).toBe('available');

    // Accepting one closes the other while the transition is pending, and the
    // accept path refuses the bank outright.
    acceptAt(sim, SMITH_MASTER, 'q_prof_amends_smith', WEAPON_ARMOR);
    expect(sim.questLog.get('q_prof_amends_smith')?.resolvedCounts).toEqual([5]);
    expect(sim.questState('q_prof_amends_outfitter')).toBe('unavailable');
    acceptAt(sim, OUTFITTER_MASTER, 'q_prof_amends_outfitter', LEATHER_TAILOR);
    expect(sim.questLog.has('q_prof_amends_outfitter')).toBe(false);

    // Return to smith: switchCount 1; the outfitter amends reopens and a fresh
    // accept resolves the ESCALATED count (5 + 3 * 1 = 8), the honest cost.
    completeAndTurnInAt(sim, SMITH_MASTER, 'q_prof_amends_smith');
    expect(sim.archetypeSwitchCount).toBe(1);
    expect(sim.questState('q_prof_amends_outfitter')).toBe('available');
    acceptAt(sim, OUTFITTER_MASTER, 'q_prof_amends_outfitter', LEATHER_TAILOR);
    expect(sim.questLog.get('q_prof_amends_outfitter')?.resolvedCounts).toEqual([8]);
  });
});
