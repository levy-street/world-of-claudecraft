// The blob-wide professions round-trip sweep: every professions field on
// CharacterState survives serialize-load-serialize either byte-faithfully or
// through its DOCUMENTED load normalizer, and the whole blob is a fixed point.
//
// This widens the per-field fixed-point contract
// tests/professions_tool_effect_slot.test.ts pins for toolEffectSlots (and
// tests/professions_quest_cadence.test.ts for questCadence) to the full
// professions surface: those suites keep the per-field policy arms (refused
// rows, elapsed windows); here each field is one column of the sweep. The
// per-field heal/clamp behaviors keep their own targeted suites too
// (node_persist, tier_mail); this file pins the two cap clamps directly
// because they are the mechanism behind the "rollback erases newer fields"
// caveat in docs/design/professions-tuning-packet.md.
//
// ADDING A PROFESSIONS FIELD TO CharacterState? Add it to
// PROFESSIONS_BLOB_FIELDS below with a fixture value, or the presence pin
// fails. The whole-blob fixed point (layer 2) will catch a non-idempotent
// load/save even for a field this list has not learned about yet.
import { describe, expect, it } from 'vitest';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import { PRE_TRAINING_RECIPE_IDS } from '../src/sim/professions/training';
import { type CharacterState, type PlayerMeta, Sim } from '../src/sim/sim';

const makeSim = (seed = 21) => new Sim({ seed, playerClass: 'warrior', autoEquip: false });

// Every professions-owned key on CharacterState, pinned as a literal list so a
// rename fails the presence pin instead of silently leaving the sweep.
const PROFESSIONS_BLOB_FIELDS = [
  'professions',
  'gatheringProficiency',
  'toolEffectSlots',
  'nodeHarvestCooldowns',
  'craftSkills',
  'knownRecipes',
  'equipmentInstance',
  'recipesGrandfathered',
  'masteryResetApplied',
  'proficiencyDisplayHealApplied',
  'townFocus',
  'archetype',
  'questCadence',
  'tierMailSent',
  'questedHobbies',
  'profTierTutorialSent',
  'guildLetterSent',
] as const;

const NODE = GATHER_NODES.find((n) => n.type === 'herb' && n.zoneId === 'eastbrook_vale');
if (!NODE) throw new Error('no eastbrook herb node in content');

/** A player exercising every professions field with a non-default value
 *  (one exception: recipesGrandfathered rides at its born-true default, so
 *  its column checks presence and stability only; the grandfather union
 *  transform itself belongs to the training suite). Direct meta writes, the
 *  established fixture idiom of the per-field suites; the producer paths
 *  have their own tests. (A const arrow rather than a hoisted declaration so
 *  the NODE narrowing above applies.) */
const populatedSim = (): Sim => {
  const sim = makeSim();
  const meta = sim.players.get(sim.playerId) as PlayerMeta;
  // Fractional proficiency on purpose: gather gains move in 0.25 steps, so a
  // serializer that rounded would pass an integer fixture.
  meta.gatheringProficiency = { mining: 42.25, logging: 0, herbalism: 7, fishing: 150 };
  meta.toolEffectSlots = {
    logging: {
      effectId: 'gatherers_cache',
      durability: 7,
      maxDurability: 30,
      // The crafter identity must ride the blob byte-faithfully: the
      // original-crafter recharge discount resolves against it after a relog.
      craftedBy: 'Loggerholm',
      confirmMode: 'always',
    },
  };
  meta.nodeHarvestReadyAt[NODE.id] = sim.time + 30;
  meta.craftSkills.weaponcrafting = 55.5;
  meta.craftSkills.cooking = 10;
  // One real pre-training id plus one retired/synthetic id: knownRecipes is
  // SHAPE-bounded but never catalog-filtered on load (the grandfathered
  // model, with the phase 16 id-length bound in
  // professions/training.ts sanitizeKnownRecipeIds), so both must survive
  // byte-faithfully; if catalog filtering is ever added, this arm is the one
  // that should go red and force the contract update.
  meta.knownRecipes.add(PRE_TRAINING_RECIPE_IDS[0]);
  meta.knownRecipes.add('retired_recipe_id');
  // An enchanted-copy payload: the craft-side persisted state
  // professions/CLAUDE.md classifies with craftSkills/knownRecipes/archetype.
  // The populated POLICY round trip (stat recalc, absent-field default) lives
  // in tests/professions_enchanting.test.ts; here it is one column of the
  // sweep so the field list's completeness claim stays true.
  //
  // Deliberately LEGAL on every arm of the load-side payload bound
  // (src/sim/item_instance_load.ts): a signer inside the name shape, string
  // values inside the string ceiling at the top level (enchant,
  // craftedRecipeId) AND one level down (rolled.quality), plus the two
  // non-string shapes it must never touch (rolled.stats, charges). That is
  // what makes this column a byte-faithfulness pin for the bound rather than
  // only for the serializer: the arms' own drop behavior is unit-tested in
  // tests/item_instance_load.test.ts, and this is the identity half.
  meta.equipmentInstance.mainhand = {
    signer: 'Loggerholm',
    charges: { gatherers_cache: 3 },
    rolled: { quality: 'rare', stats: { str: 2 } },
    enchant: 'enchant_weapon_might',
    craftedRecipeId: 'recipe_eastbrook_arming_sword',
  };
  meta.townFocus = { hide: 3, fang: 2 };
  meta.archetype = {
    activeArchetype: 'weaponcrafting',
    pairedMajor: 'armorcrafting',
    hobbyCraft: 'leatherworking',
    attunedPairs: ['weaponcrafting+armorcrafting'],
    switchCount: 1,
    amendsProgress: 2,
  };
  meta.questCadence.set('q_prof_work_order_smith', 600); // live: far under the 36000-tick window
  // Majors only: the tier-mail prune (load and transition) keeps exactly the
  // active pair's crafts, so a non-major entry here would not round-trip BY
  // DESIGN (pinned in tests/professions_tier_mail.test.ts, not re-pinned here).
  meta.tierMailSent.set('weaponcrafting', 2);
  meta.tierMailSent.set('armorcrafting', 1);
  // A quested hobby for the ACTIVE pair plus one for a pair this character is
  // not on: unlike tierMailSent, the record is never pruned to the current pair
  // (surviving the dormant period is the whole point), so both round-trip.
  meta.questedHobbies.set('weaponcrafting+armorcrafting', 'tailoring');
  meta.questedHobbies.set('alchemy+cooking', 'enchanting');
  meta.profTierTutorialSent = true;
  meta.guildLetterSent = true;
  return sim;
};

describe('the professions blob round-trip sweep', () => {
  it('every professions field is exercised, survives one load, and the blob is a fixed point', () => {
    const sim = populatedSim();
    const s1 = sim.serializeCharacter(sim.playerId) as CharacterState;

    // Presence pin: the fixture really exercised every listed field (a field
    // rename or a dropped serializer arm fails here, not vacuously below).
    for (const field of PROFESSIONS_BLOB_FIELDS) {
      expect(s1[field], `${field} missing from the populated save`).toBeDefined();
    }
    // Spot pins on load-bearing values so the sweep is not only structural.
    expect(s1.gatheringProficiency).toEqual({
      mining: 42.25,
      logging: 0,
      herbalism: 7,
      fishing: 150,
    });
    expect(s1.professions).toEqual(s1.gatheringProficiency); // legacy dual-write
    // Separate objects, never one aliased through the other (the serializer
    // spreads on purpose so no caller can mutate one key through the other);
    // toEqual alone is identity-blind, so pin the identity too.
    expect(s1.professions).not.toBe(s1.gatheringProficiency);
    // Fractional craft skill pinned as a literal: a serializer that rounded
    // would survive the relative drift pin below (it mangles s1 and s2
    // identically), so the literal is what carries the no-rounding claim.
    expect(s1.craftSkills).toMatchObject({ weaponcrafting: 55.5, cooking: 10 });
    expect(s1.equipmentInstance?.mainhand?.rolled?.stats?.str).toBe(2);
    // The payload crosses the load bound BYTE-faithfully, key order included:
    // toEqual alone would forgive a re-ordered rebuild, and the save is JSON.
    expect(JSON.stringify(s1.equipmentInstance?.mainhand)).toBe(
      '{"signer":"Loggerholm","charges":{"gatherers_cache":3},' +
        '"rolled":{"quality":"rare","stats":{"str":2}},' +
        '"enchant":"enchant_weapon_might",' +
        '"craftedRecipeId":"recipe_eastbrook_arming_sword"}',
    );
    expect(s1.nodeHarvestCooldowns).toEqual({ [NODE.id]: 30 });
    expect(s1.tierMailSent).toEqual({ weaponcrafting: 2, armorcrafting: 1 });
    expect(s1.questCadence).toEqual({ q_prof_work_order_smith: 600 });
    expect(s1.masteryResetApplied).toBe(true); // literal true by design
    expect(s1.proficiencyDisplayHealApplied).toBe(true); // literal true by design

    // One load: every professions field comes back byte-faithful (all fixture
    // values sit inside their normalizers' accepted ranges, so the documented
    // normalizers are pass-throughs here; the clamp arm below is where they
    // move a value).
    const second = makeSim(22);
    const pid2 = second.addPlayer('warrior', 'Sweep', { state: s1 });
    const s2 = second.serializeCharacter(pid2) as CharacterState;
    for (const field of PROFESSIONS_BLOB_FIELDS) {
      expect(s2[field], `${field} drifted across one save/load cycle`).toEqual(s1[field]);
    }
    // The sweep above is toEqual, which is key-order blind. The instance
    // payload crossed the load-side bound (src/sim/item_instance_load.ts),
    // whose whole contract is that it deletes in place rather than
    // rebuilding, so pin the BYTES for that field: a rebuild that happened to
    // preserve every value would pass the loop and fail here.
    expect(JSON.stringify(s2.equipmentInstance)).toBe(JSON.stringify(s1.equipmentInstance));

    // Layer 2, the whole-blob fixed point: a second load changes NOTHING
    // anywhere in the blob, professions or not. One-time load transforms
    // (grandfather unions, deed retro grants, position migration) are allowed
    // to fire on the FIRST load; s2 is the settled state and must be exact.
    // Scope note: every arm here runs at sim.time 0, so for
    // nodeHarvestCooldowns this pins the fixed point at a FIXED clock; the
    // production behavior at a later clock (the remaining legitimately
    // shrinks, monotonically, flooring at field omission) is what
    // tests/professions_node_persist.test.ts owns.
    const third = makeSim(23);
    const pid3 = third.addPlayer('warrior', 'Sweep2', { state: s2 });
    const s3 = third.serializeCharacter(pid3) as CharacterState;
    expect(s3).toEqual(s2);
    // toEqual ignores a key that is present with an explicit undefined value,
    // so pin the key SETS too: an absent key must stay absent.
    expect(Object.keys(s3).sort()).toEqual(Object.keys(s2).sort());
  });

  it('over-cap values clamp DOWN through the documented load normalizers and persist clamped', () => {
    // The exact mechanism the shared "rollback erases newer fields" caveat
    // records: normalizeGatheringProficiency and normalizeCraftSkills clamp a
    // loaded value to the binary's own cap, and the next save keeps the
    // clamped value. Pinned to the literal shipped caps.
    const sim = populatedSim();
    const s1 = sim.serializeCharacter(sim.playerId) as CharacterState;
    s1.gatheringProficiency = { mining: 250, logging: 0, herbalism: 7, fishing: 999 };
    s1.professions = { ...s1.gatheringProficiency };
    s1.craftSkills = { ...s1.craftSkills, weaponcrafting: 999 };

    const reloaded = makeSim(24);
    const pid = reloaded.addPlayer('warrior', 'Clamped', { state: s1 });
    const meta = reloaded.players.get(pid) as PlayerMeta;
    expect(meta.gatheringProficiency.mining).toBe(100); // gathering cap
    expect(meta.gatheringProficiency.fishing).toBe(200); // fishing cap
    expect(meta.craftSkills.weaponcrafting).toBe(125); // craft ring cap

    const resaved = reloaded.serializeCharacter(pid) as CharacterState;
    expect(resaved.gatheringProficiency).toEqual({
      mining: 100,
      logging: 0,
      herbalism: 7,
      fishing: 200,
    });
    expect(resaved.craftSkills?.weaponcrafting).toBe(125);
  });
});
