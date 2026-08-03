// Phase 16 item 4: the character-blob growth bound
// (docs/design/professions-tuning-packet-review.md). Builds the WORST-CASE
// professions blob (every field at its plausible ceiling: all live nodes on
// cooldown, every recipe known, every craft and gathering skill capped, all
// three slottable tool-effect slots filled with maximum-length crafter names,
// every archetype pair attuned and hobby-quested, full town focus, every
// cadence window live), settles it to a fixed point through the REAL
// serialize-load-serialize path, and asserts a byte ceiling plus the per-field
// entry caps that make the growth model linear-in-content rather than
// unbounded-per-player.
//
// The bound protects the save path: at 1,000 online the server writes every
// blob whole every 30 s (no dirty tracking), so professions bytes multiply
// straight into autosave write volume. The two content-scaled fields grow at
// roughly 26 bytes per authored node (nodeHarvestCooldowns) and 29 bytes per
// recipe (knownRecipes): a complete new zone (18 nodes) costs about 470 bytes
// of worst case, a starter zone (6) about 155. When authored content pushes
// the settled ceiling past the bound, re-mint it HERE with the measured value
// and record the move (the tests/professions_node_persist.test.ts 2048->4096
// precedent), rather than loosening it ahead of need.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import {
  CRAFT_RING,
  GATHERING_PROFESSIONS,
  HARVEST_COMPONENT_ITEMS,
} from '../src/sim/content/professions';
import { ALL_RECIPES, ITEMS, QUESTS } from '../src/sim/data';
import {
  ARCHETYPE_PAIR_TARGETS,
  craftsForPairTarget,
  hobbyCandidatesForPair,
} from '../src/sim/professions/archetype';
import { NODE_HARVEST_TABLE } from '../src/sim/professions/gathering';
import { MAX_CRAFTED_BY_LENGTH } from '../src/sim/professions/tools';
import { MAX_KNOWN_RECIPE_ID_LENGTH, MAX_KNOWN_RECIPE_IDS } from '../src/sim/professions/training';
import { type CharacterState, type PlayerMeta, Sim } from '../src/sim/sim';
import { ALL_EQUIP_SLOTS, type InvSlot } from '../src/sim/types';

const makeSim = (seed = 31) => new Sim({ seed, playerClass: 'warrior', autoEquip: false });

// The professions-owned key list, mirrored from the roundtrip sweep. The
// scrape test below pins the two lists together so neither can silently
// learn a field the other misses.
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

// Every CharacterState key this serializer writes that is NOT professions
// state. Pinned as a literal so the complement test below can assert that
// the two lists TOGETHER cover the whole blob: a new field must be
// classified into one of them, or it stays invisible to this bound. Ordered
// as serializeCharacter writes them (src/sim/sim.ts), conditional keys
// included, since a key absent from the fixture is harmless here while a
// missing one is not.
const NON_PROFESSIONS_BLOB_FIELDS = [
  // Written by the SERVER, not by serializeCharacter: server/game.ts stamps
  // state.jail onto the serialized blob before persisting, so no sim fixture
  // can arm it and the source scrape below cannot see it either. Classified
  // here explicitly so the complement pin stays honest about the one key
  // that enters the blob outside the serializer.
  'jail',
  'contentRevision',
  'level',
  'xp',
  'lifetimeXp',
  'honor',
  'lifetimeHonor',
  'honorArenaDaily',
  'prestigeRank',
  'unlockedMilestones',
  'restedXp',
  'totalPlayedSeconds',
  'copper',
  'hp',
  'resource',
  'pos',
  'facing',
  'dead',
  'ghost',
  'corpsePos',
  'resSickness',
  'unstuckSickness',
  'equipment',
  'inventory',
  'bags',
  'bank',
  'vendorBuyback',
  'questLog',
  'questsDone',
  'arenaRating',
  'arenaWins',
  'arenaLosses',
  'arena1v1Rating',
  'arena1v1Wins',
  'arena1v1Losses',
  'arena2v2Rating',
  'arena2v2Wins',
  'arena2v2Losses',
  'weaponStowed',
  'vcupWins',
  'vcupLosses',
  'vcupDraws',
  'vcupGuildWins',
  'vcupGuildLosses',
  'vcupBetWins',
  'vcupBetLosses',
  'vcupBetNet',
  'talents',
  'loadouts',
  'activeLoadout',
  'raidLockouts',
  'pet',
  'cooldowns',
  'skin',
  'skinCatalog',
  'pendingSkinRank',
  'pendingSkinCatalog',
  'pendingSkinItemId',
  'mountTrainingFeePaid',
  'ridingTrained',
  'pbeBoostKit',
  'delveMarks',
  'delveClears',
  'companionUpgrades',
  'delveLoreUnlocked',
  'delveDaily',
  'heroicDaily',
  'mailWelcomed',
  'deeds',
  'deedStats',
  'activeTitle',
  'renown',
] as const;

// The settled ceiling measured 8,469 bytes when this bound was re-minted
// (2026-07-30, after the review round grew the fixture honest: every equip
// slot instanced and signed, every cadence window live; that content: 120
// nodes, 79 recipes, 10 ring crafts, 4 gathering professions, 7 cadence
// quests). That measurement iterated the launch-era eleven-slot list; the
// v0.33.0 offhand fix retired it, the fixture now instances all twelve
// live slots (ALL_EQUIP_SLOTS), and the settled ceiling re-measured 8,587
// bytes. The phase 20 density pass took the node count 120 to 156 and the
// settled ceiling to a measured 9,451 bytes: the pin HOLDS, but the
// headroom is now about 277 bytes, under one starter zone of node growth,
// so the NEXT authored node-count growth of any size re-mints this bound
// with its measured value (the tests/professions_node_persist.test.ts
// 2048 -> 4096 -> 8192 precedent) rather than squeezing under it.
const PROFESSIONS_BYTE_CEILING = 9728;

function ceilingSim(): Sim {
  const sim = makeSim();
  const meta = sim.players.get(sim.playerId) as PlayerMeta;
  // Every gathering skill at its own cap (fishing's is higher by design).
  meta.gatheringProficiency = Object.fromEntries(
    Object.values(GATHERING_PROFESSIONS).map((p) => [p.id, p.maxSkill]),
  ) as PlayerMeta['gatheringProficiency'];
  for (const craft of CRAFT_RING) meta.craftSkills[craft.id] = craft.maxSkill;
  for (const recipe of ALL_RECIPES) meta.knownRecipes.add(recipe.id);
  for (const node of GATHER_NODES) {
    meta.nodeHarvestReadyAt[node.id] = sim.time + NODE_HARVEST_TABLE[node.type].respawnSeconds;
  }
  // The three slottable slots (fishing is policy-refused), each carrying the
  // longest crafter name a legal mint can stamp and the wordier confirm mode.
  const longName = 'A'.repeat(MAX_CRAFTED_BY_LENGTH);
  meta.toolEffectSlots = {
    mining: {
      effectId: 'gatherers_cache',
      durability: 30,
      maxDurability: 30,
      craftedBy: longName,
      confirmMode: 'prompt',
    },
    logging: {
      effectId: 'artisans_eye',
      durability: 30,
      maxDurability: 30,
      craftedBy: longName,
      confirmMode: 'prompt',
    },
    herbalism: {
      effectId: 'gatherers_cache',
      durability: 30,
      maxDurability: 30,
      craftedBy: longName,
      confirmMode: 'prompt',
    },
  };
  // EVERY equip slot carries a crafted, signed, enchanted, stat-rolled
  // instance: the professions-endgame worst case the phase 16 review found
  // missing from the first mint (one light slot understated the ceiling by
  // over 2 KB). Slot-appropriateness is irrelevant to the serializer; the
  // LOAD arm only requires the slot to be equipped for the instance to
  // survive the settle. The id itself never enters the byte measurement
  // (only slot-keyed payloads are measured), so the declaration-order pick
  // is cosmetic; it exists to keep the equipment map non-empty.
  const instanceItemId = Object.keys(ITEMS)[0];
  // The fixture and the settle assertion both read ALL_EQUIP_SLOTS, so the
  // list length itself needs a literal pin: a slot silently dropped from the
  // live list would shrink the fixture and the measured ceiling in lockstep.
  if (ALL_EQUIP_SLOTS.length !== 12)
    throw new Error('live equip slot list changed; re-mint the ceiling');
  for (const slot of ALL_EQUIP_SLOTS) {
    meta.equipment[slot] = instanceItemId;
    meta.equipmentInstance[slot] = {
      enchant: 'enchant_weapon_might',
      rolled: { stats: { str: 2, agi: 2, sta: 2 } },
      signer: longName,
    };
  }
  // Every repeatable cadence window live (the first mint never set the field,
  // and the `field in state` measurement filter silently forgave it).
  const cadenceQuests = Object.values(QUESTS).filter((q) => q.repeatCadenceTicks);
  // Seven repeatable cadence quests today (six work orders plus the hobby
  // switch); a shrink below that means the fixture no longer arms every
  // window and must be re-checked.
  if (cadenceQuests.length < 7) throw new Error('cadence quest set shrank; re-check the fixture');
  for (const q of cadenceQuests) meta.questCadence.set(q.id, 600);
  // Full focus budget spread across every component family.
  const components = Object.keys(HARVEST_COMPONENT_ITEMS);
  meta.townFocus = Object.fromEntries(
    components.map((c, i) => [c, i < 4 ? 2 : 1]),
  ) as PlayerMeta['townFocus'];
  const firstPair = craftsForPairTarget(ARCHETYPE_PAIR_TARGETS[0]);
  if (!firstPair) throw new Error('no first archetype pair');
  meta.archetype = {
    activeArchetype: firstPair[0],
    pairedMajor: firstPair[1],
    hobbyCraft: hobbyCandidatesForPair(firstPair[0], firstPair[1])[0],
    attunedPairs: [...ARCHETYPE_PAIR_TARGETS],
    switchCount: 9,
    amendsProgress: 3,
  };
  for (const target of ARCHETYPE_PAIR_TARGETS) {
    const pair = craftsForPairTarget(target);
    if (!pair) throw new Error(`unresolvable pair target ${target}`);
    const hobby = hobbyCandidatesForPair(pair[0], pair[1])[0];
    if (!hobby) throw new Error(`no hobby candidate for ${target}`);
    meta.questedHobbies.set(target, hobby);
  }
  meta.tierMailSent.set(firstPair[0], 2);
  meta.tierMailSent.set(firstPair[1], 2);
  meta.profTierTutorialSent = true;
  meta.guildLetterSent = true;
  return sim;
}

function professionsBytes(state: CharacterState): number {
  const subset = Object.fromEntries(
    PROFESSIONS_BLOB_FIELDS.filter((field) => field in state).map((field) => [field, state[field]]),
  );
  return JSON.stringify(subset).length;
}

describe('the professions blob growth bound (phase 16)', () => {
  it('the field list mirrors the roundtrip sweep exactly, scraped from its source', () => {
    // Two files carry the professions field list (the roundtrip sweep and
    // this bound); this scrape makes drift impossible in either direction.
    // Anchored at the declaration and closed at the first `] as const`, so
    // surrounding prose cannot leak into the capture.
    const source = readFileSync(
      new URL('./professions_blob_roundtrip.test.ts', import.meta.url),
      'utf8',
    );
    const anchor = source.indexOf('const PROFESSIONS_BLOB_FIELDS = [');
    expect(anchor).toBeGreaterThan(-1);
    const block = source.slice(anchor, source.indexOf('] as const', anchor));
    const scraped = [...block.matchAll(/'([a-zA-Z][a-zA-Z0-9_]*)'/g)].map((m) => m[1]).sort();
    expect(scraped).toEqual([...PROFESSIONS_BLOB_FIELDS].sort());
  });

  it('the settled ceiling honors the byte bound and every entry cap', () => {
    const sim = ceilingSim();
    const s1 = sim.serializeCharacter(sim.playerId) as CharacterState;
    // Settle through one real load (normalizers, one-shot transforms), then
    // prove the result is a fixed point so the measurement is of a REAL
    // steady state, not a pre-normalization inflation.
    const second = makeSim(32);
    const pid2 = second.addPlayer('warrior', 'Ceiling', { state: s1 });
    const s2 = second.serializeCharacter(pid2) as CharacterState;
    const third = makeSim(33);
    const pid3 = third.addPlayer('warrior', 'CeilingB', { state: s2 });
    const s3 = third.serializeCharacter(pid3) as CharacterState;
    expect(s3).toEqual(s2);
    expect(Object.keys(s3).sort()).toEqual(Object.keys(s2).sort());

    // The fixture really reached every field: an unpopulated field would be
    // silently skipped by the measurement's `field in state` filter (the
    // phase 16 review found questCadence lost exactly this way), and an
    // object- or array-valued field must be NON-EMPTY too, because an empty
    // container satisfies toBeDefined while carrying none of its ceiling.
    for (const field of PROFESSIONS_BLOB_FIELDS) {
      const value = s2[field];
      expect(value, `${field} missing from the settled ceiling`).toBeDefined();
      if (Array.isArray(value)) {
        expect(value.length, `${field} empty at the ceiling`).toBeGreaterThan(0);
      } else if (typeof value === 'object' && value !== null) {
        expect(Object.keys(value).length, `${field} empty at the ceiling`).toBeGreaterThan(0);
      }
    }

    // Entry caps: the two content-scaled fields sit exactly at content size,
    // the per-player fields at their structural caps. These are what keep
    // the blob linear in CONTENT rather than unbounded per player.
    expect(Object.keys(s2.nodeHarvestCooldowns ?? {})).toHaveLength(GATHER_NODES.length);
    expect(s2.knownRecipes ?? []).toHaveLength(new Set(ALL_RECIPES.map((r) => r.id)).size);
    expect(Object.keys(s2.toolEffectSlots ?? {})).toHaveLength(3);
    expect(Object.keys(s2.questedHobbies ?? {})).toHaveLength(ARCHETYPE_PAIR_TARGETS.length);
    // EXACT, not an upper bound: the fixture attunes every authored pair, so
    // a cap pin that tolerated fewer would pass on a normalizer that
    // silently dropped history (the load really does filter this list
    // against the current ring, professions/archetype.ts).
    expect(s2.archetype?.attunedPairs ?? []).toHaveLength(ARCHETYPE_PAIR_TARGETS.length);
    // The tier-mail record is pruned to the ACTIVE pair's two majors on
    // load, which is what keeps it a 2-entry field rather than one that
    // grows a row per craft the character ever touched.
    expect(Object.keys(s2.tierMailSent ?? {})).toHaveLength(2);
    expect(Object.keys(s2.townFocus ?? {})).toHaveLength(
      Object.keys(HARVEST_COMPONENT_ITEMS).length,
    );
    expect(Object.keys(s2.craftSkills ?? {})).toHaveLength(CRAFT_RING.length);
    expect(Object.keys(s2.gatheringProficiency ?? {})).toHaveLength(
      Object.keys(GATHERING_PROFESSIONS).length,
    );
    expect(Object.keys(s2.questCadence ?? {})).toHaveLength(
      Object.values(QUESTS).filter((q) => q.repeatCadenceTicks).length,
    );
    expect(Object.keys(s2.equipmentInstance ?? {})).toHaveLength(ALL_EQUIP_SLOTS.length);

    // The byte bound itself, on the settled state. The lower bound tracks
    // the measured settled value (9,451 at the phase 20 re-measure) minus a
    // small band, so the headroom note above cannot rot silently in either
    // direction: a measurement drifting more than a couple hundred bytes
    // reds here and forces the note to be re-read.
    const bytes = professionsBytes(s2);
    expect(bytes).toBeGreaterThan(9216);
    expect(bytes).toBeLessThanOrEqual(PROFESSIONS_BYTE_CEILING);
  });

  it('the two field lists together cover the whole blob, so a new field must be classified', () => {
    // THE COMPLEMENT PIN. The scrape above only cross-checks the two
    // professions lists against EACH OTHER, so a professions field added to
    // neither is invisible to both: the sweep would not exercise it and this
    // bound would not measure it. Subtracting the pinned non-professions
    // allowlist from the real settled key set closes that hole in the one
    // direction it can be closed: a new key must be added to one list or the
    // other, and choosing which is the classification decision.
    const sim = ceilingSim();
    const s1 = sim.serializeCharacter(sim.playerId) as CharacterState;
    const settled = makeSim(37);
    const pid = settled.addPlayer('warrior', 'Complement', { state: s1 });
    const state = settled.serializeCharacter(pid) as CharacterState;
    const nonProfessions = new Set<string>(NON_PROFESSIONS_BLOB_FIELDS);
    const professionsKeys = Object.keys(state).filter((key) => !nonProfessions.has(key));
    expect(professionsKeys.sort()).toEqual([...PROFESSIONS_BLOB_FIELDS].sort());
    // FIXTURE-INDEPENDENCE ARM (the fix-round audit): the settled fixture
    // cannot arm every CONDITIONAL key, so also scrape the keys the
    // serializer actually WRITES out of its source (conditional spreads
    // included) and require each to be classified in one of the two lists.
    // The one key written OUTSIDE serializeCharacter is the server's jail
    // stamp (server/game.ts assigns state.jail after serialization), which
    // the allowlist carries explicitly for that reason.
    const simSrc = readFileSync(new URL('../src/sim/sim.ts', import.meta.url), 'utf8');
    const serializeStart = simSrc.indexOf('serializeCharacter(');
    expect(serializeStart).toBeGreaterThan(-1);
    const body = simSrc.slice(serializeStart, simSrc.indexOf('\n  }', serializeStart));
    const written = new Set<string>();
    for (const m of body.matchAll(
      /^\s{6}(?:\.\.\.\((?:[^)]*&&\s*)?\{\s*)?([A-Za-z][A-Za-z0-9]*):/gm,
    )) {
      written.add(m[1]);
    }
    expect(written.size).toBeGreaterThan(20); // the scrape genuinely parsed the literal
    for (const key of written) {
      expect(
        nonProfessions.has(key) || (PROFESSIONS_BLOB_FIELDS as readonly string[]).includes(key),
        `serialized key "${key}" is classified in neither field list`,
      ).toBe(true);
    }
  });

  it('oversized junk drops on load, alone, in every container that carries an instance', () => {
    // The write side is deliberately load-bounded (the node_persist doctrine:
    // both anti-tamper arms live on the LOAD side), so the junk serializes
    // once and the next load is where the bound bites.
    //
    // DOCTRINE NOTE on what these clamps do NOT reach: an instance parked in
    // market or mail escrow lives in world_state, not in characters.state,
    // and re-enters a character only at runtime through grantCopies. So the
    // character blob is bounded with a one-save lag (the copy is bounded the
    // next time that character loads) while world_state itself stays
    // unbounded by this rule. Recorded, not fixed here: escrow rows are
    // server-minted from live payloads rather than parsed from a stored
    // blob.
    const sim = ceilingSim();
    const meta = sim.players.get(sim.playerId) as PlayerMeta;
    const overLengthId = 'x'.repeat(MAX_KNOWN_RECIPE_ID_LENGTH + 1);
    const atLengthId = 'y'.repeat(MAX_KNOWN_RECIPE_ID_LENGTH);
    meta.knownRecipes.add(overLengthId);
    meta.knownRecipes.add(atLengthId);
    // A NON-STRING id: no legal writer produces one, and the filter's
    // typeof arm was untested until the review round asked for it.
    meta.knownRecipes.add(42 as unknown as string);
    const s1 = sim.serializeCharacter(sim.playerId) as CharacterState;
    expect(s1.knownRecipes?.some((id) => id.length > MAX_KNOWN_RECIPE_ID_LENGTH)).toBe(true);
    const overSigner = 'S'.repeat(MAX_CRAFTED_BY_LENGTH + 1);
    const legalSigner = 'A'.repeat(MAX_CRAFTED_BY_LENGTH);
    const corruptSlot = ALL_EQUIP_SLOTS[0];
    const keptSlot = ALL_EQUIP_SLOTS[1];
    const numericSlot = ALL_EQUIP_SLOTS[2];
    const corrupt = s1.equipmentInstance?.[corruptSlot];
    if (!corrupt) throw new Error('ceiling fixture lost its first equip instance');
    corrupt.signer = overSigner;
    const numeric = s1.equipmentInstance?.[numericSlot];
    if (!numeric) throw new Error('ceiling fixture lost its third equip instance');
    numeric.signer = 42 as unknown as string;
    // BAG stacks carry most signed instances in real play (the mint sites
    // put crafted copies into inventory, not equipment), so the clamp must
    // bite there too; the review round found an equipment-only first cut.
    if (!s1.inventory?.[0]) throw new Error('ceiling fixture has no inventory row');
    s1.inventory[0].instance = { enchant: 'enchant_weapon_might', signer: overSigner };
    // The SURVIVOR half of the bag arm: a legal maximum-length signer on
    // another bag row must come back byte-faithfully, or a clamp that simply
    // deleted every bag signer would pass the drop pins above.
    s1.inventory.push({
      itemId: 'roasted_boar',
      count: 1,
      instance: { enchant: 'enchant_weapon_might', signer: legalSigner },
    });
    const bagSurvivorIndex = s1.inventory.length - 1;
    // The two containers the first cut never reached at all.
    s1.bank = {
      inventory: [
        {
          itemId: 'roasted_boar',
          count: 1,
          instance: { enchant: 'enchant_weapon_might', signer: overSigner },
        },
        {
          itemId: 'roasted_boar',
          count: 1,
          instance: { enchant: 'enchant_weapon_might', signer: legalSigner },
        },
      ],
      purchasedSlots: 0,
      bonusSlots: 0,
    };
    s1.vendorBuyback = [
      {
        itemId: 'roasted_boar',
        count: 1,
        instance: { enchant: 'enchant_weapon_might', signer: overSigner },
      },
    ];
    const second = makeSim(34);
    const pid2 = second.addPlayer('warrior', 'Junk', { state: s1 });
    const s2 = second.serializeCharacter(pid2) as CharacterState;
    // Both bogus ids dropped; every legal id (retired shapes included)
    // survived, INCLUDING one exactly at the length ceiling.
    expect(s2.knownRecipes?.every((id) => id.length <= MAX_KNOWN_RECIPE_ID_LENGTH)).toBe(true);
    expect(s2.knownRecipes?.every((id) => typeof id === 'string')).toBe(true);
    expect(s2.knownRecipes).toContain(atLengthId);
    expect(s2.knownRecipes).not.toContain(overLengthId);
    expect(s2.knownRecipes).toHaveLength((s1.knownRecipes?.length ?? 0) - 2);
    // The boundary pair, pinned against the constant and then the constant
    // against its literal: a 500-character junk id left the whole 65..499
    // band unpinned, which the review round called out.
    expect(atLengthId).toHaveLength(64);
    expect(MAX_KNOWN_RECIPE_ID_LENGTH).toBe(64);
    // Every corrupt signer dropped ALONE, with the KEY genuinely removed (an
    // explicit-undefined key would survive 'in' checks): each slot's
    // instance survives, and a legal maximum-length signer is untouched
    // wherever it sits.
    expect('signer' in (s2.equipmentInstance?.[corruptSlot] ?? {})).toBe(false);
    expect(s2.equipmentInstance?.[corruptSlot]?.enchant).toBe('enchant_weapon_might');
    expect('signer' in (s2.equipmentInstance?.[numericSlot] ?? {})).toBe(false);
    expect(s2.equipmentInstance?.[numericSlot]?.enchant).toBe('enchant_weapon_might');
    expect(s2.equipmentInstance?.[keptSlot]?.signer).toBe(legalSigner);
    expect('signer' in (s2.inventory?.[0]?.instance ?? {})).toBe(false);
    expect(s2.inventory?.[0]?.instance?.enchant).toBe('enchant_weapon_might');
    expect(s2.inventory?.[bagSurvivorIndex]?.instance?.signer).toBe(legalSigner);
    expect('signer' in (s2.bank?.inventory?.[0]?.instance ?? {})).toBe(false);
    expect(s2.bank?.inventory?.[0]?.instance?.enchant).toBe('enchant_weapon_might');
    expect(s2.bank?.inventory?.[1]?.instance?.signer).toBe(legalSigner);
    expect('signer' in (s2.vendorBuyback?.[0]?.instance ?? {})).toBe(false);
    expect(s2.vendorBuyback?.[0]?.instance?.enchant).toBe('enchant_weapon_might');
  });

  it('a bagged over-keyed payload with a VALID rift survives as the rebuilt payload', () => {
    // THE ORDER PIN (fix-round review): the bags arm used to run the payload
    // bound BEFORE the rift rebuild, so an over-keyed row that still carried
    // a valid rift was destroyed by the key-count arm while the SAME row on
    // an equipped slot survived (the rebuild reduces it to its bounded keys
    // first). Both arms now rebuild first; this red-goes-green only under
    // that order.
    const sim = ceilingSim();
    const s1 = sim.serializeCharacter(sim.playerId) as CharacterState;
    const junkKeys = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`junk${i}`, i] as const),
    );
    s1.inventory = [
      ...(s1.inventory ?? []),
      {
        itemId: 'riftbound_band_of_might',
        count: 1,
        instance: {
          ...junkKeys,
          rift: { tier: 'C', upgradeLevel: 1, sourceEventId: 'evt_order_pin', gems: [] },
        } as unknown as InvSlot['instance'],
      },
    ];
    const second = makeSim(41);
    const pid2 = second.addPlayer('warrior', 'RiftOrder', { state: s1 });
    const s2 = second.serializeCharacter(pid2) as CharacterState;
    const row = s2.inventory?.find((slot) => slot.itemId === 'riftbound_band_of_might');
    expect(row?.instance?.rift).toBeTruthy();
    const rebuiltRift = row?.instance?.rift as { sourceEventId?: string } | undefined;
    expect(rebuiltRift?.sourceEventId).toBe('evt_order_pin');
    // The rebuild, not the junk, is what survived.
    expect('junk0' in (row?.instance ?? {})).toBe(false);
  });

  it('the buyback and bank arms rebuild a valid rift row too (the whole-branch completion)', () => {
    // The rebuild ran only on equipment and bags; the whole-branch review
    // found the bound's deliberate rift skip left the bank and buyback rows
    // as the two containers where an over-keyed valid-rift row was still
    // destroyed whole by the key-count arm. Same order pin as the bags arm
    // above, on both remaining containers.
    const sim = ceilingSim();
    const s1 = sim.serializeCharacter(sim.playerId) as CharacterState;
    const junkKeys = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`junk${i}`, i] as const),
    );
    const riftRow = {
      itemId: 'riftbound_band_of_might',
      count: 1,
      instance: {
        ...junkKeys,
        rift: { tier: 'C', upgradeLevel: 1, sourceEventId: 'evt_order_pin', gems: [] },
      } as unknown as InvSlot['instance'],
    };
    s1.vendorBuyback = [JSON.parse(JSON.stringify(riftRow))];
    s1.bank = {
      inventory: [JSON.parse(JSON.stringify(riftRow))],
      purchasedSlots: 8,
      bonusSlots: 0,
    };
    const second = makeSim(43);
    const pid2 = second.addPlayer('warrior', 'RiftBooks', { state: s1 });
    const s2 = second.serializeCharacter(pid2) as CharacterState;
    for (const [container, row] of [
      ['buyback', s2.vendorBuyback?.[0]],
      ['bank', s2.bank?.inventory?.find((slot) => slot.itemId === 'riftbound_band_of_might')],
    ] as const) {
      const rebuilt = row?.instance?.rift as { sourceEventId?: string } | undefined;
      expect(rebuilt?.sourceEventId, `${container} rift survives rebuilt`).toBe('evt_order_pin');
      expect('junk0' in (row?.instance ?? {}), `${container} junk gone`).toBe(false);
    }
  });

  it('the marker bound reaches a bag row whose rift the rebuild REFUSES (the F1 bypass)', () => {
    // The fix-wave review loaded a 100,000-char marker through the real
    // path and watched the rift-refusal continue skip the bound on exactly
    // this shape while the diagnostic named every drop but this one. The
    // bound now runs BEFORE the rift block; this arm drives the real loader
    // so a control-flow reorder cannot re-open the skip silently.
    const sim = ceilingSim();
    const s1 = sim.serializeCharacter(sim.playerId) as CharacterState;
    s1.inventory = [
      ...(s1.inventory ?? []),
      {
        itemId: 'wolf_fang', // wrong item for any rift shell: the rebuild refuses
        count: 1,
        craftedRecipeId: 'r'.repeat(100_000),
        instance: {
          rift: { tier: 'C', upgradeLevel: 1, sourceEventId: 'evt_refused', gems: [] },
        } as unknown as InvSlot['instance'],
      },
    ];
    // The bank wiring too (one loader drive covers both arms): its RAW
    // marker routes through the same doctrine helper.
    s1.bank = {
      inventory: [{ itemId: 'wolf_fang', count: 1, craftedRecipeId: 'b'.repeat(100_000) }],
      purchasedSlots: 8,
      bonusSlots: 0,
    };
    const second = makeSim(47);
    const pid2 = second.addPlayer('warrior', 'MarkerBound', { state: s1 });
    const s2 = second.serializeCharacter(pid2) as CharacterState;
    const row = s2.inventory?.find((slot) => slot.itemId === 'wolf_fang');
    expect(row, 'the row itself survives (only its junk drops)').toBeTruthy();
    expect(row?.craftedRecipeId, 'the oversized marker dropped').toBeUndefined();
    expect(row?.instance, 'the refused rift dropped too').toBeUndefined();
    const bankRow = s2.bank?.inventory?.find((slot) => slot.itemId === 'wolf_fang');
    expect(bankRow, 'the bank row survives').toBeTruthy();
    expect(bankRow?.craftedRecipeId, 'the bank marker dropped too').toBeUndefined();
  });

  it('a knownRecipes value stored as a STRING loads the character instead of throwing', () => {
    // THE CRASH REGRESSION. sanitizeKnownRecipeIds used to take an array and
    // call .filter on it, so a stored string threw `filter is not a
    // function` inside Sim.addPlayer: that character could never log in
    // again, on any host, and no amount of retrying fixed it. The filter is
    // total now, so the corrupt VALUE drops and the login proceeds.
    const sim = ceilingSim();
    const s1 = sim.serializeCharacter(sim.playerId) as CharacterState;
    s1.knownRecipes = 'recipe_tough_jerky' as unknown as string[];
    const second = makeSim(35);
    const pid2 = second.addPlayer('warrior', 'StringRecipes', { state: s1 });
    const meta2 = second.players.get(pid2) as PlayerMeta;
    expect(meta2.knownRecipes.size).toBe(0);
    // The rest of the character really loaded: the value dropped, not the
    // login (a fixture that only asserted "did not throw" would pass on a
    // load that silently bailed out early).
    expect(meta2.copper).toBe(s1.copper);
    expect(Object.keys(meta2.craftSkills)).toHaveLength(CRAFT_RING.length);
    expect(second.serializeCharacter(pid2)?.knownRecipes).toEqual([]);
  });

  it('caps a corrupt knownRecipes row at its entry ceiling, keeping the first ids in order', () => {
    // The COUNT half of the shape bound: 10,000 well-shaped ids are each
    // individually legal, so only an entry cap keeps them off every autosave.
    const sim = ceilingSim();
    const s1 = sim.serializeCharacter(sim.playerId) as CharacterState;
    const bulkIds: string[] = [];
    for (let i = 0; i <= MAX_KNOWN_RECIPE_IDS; i++) bulkIds.push(`recipe_bulk_${i}`);
    s1.knownRecipes = bulkIds;
    const second = makeSim(36);
    const pid2 = second.addPlayer('warrior', 'BulkRecipes', { state: s1 });
    const s2 = second.serializeCharacter(pid2) as CharacterState;
    expect(s2.knownRecipes).toHaveLength(MAX_KNOWN_RECIPE_IDS);
    // Order preserved, cut from the TAIL: the ids a real catalog would have
    // written first are the ones that survive.
    expect(s2.knownRecipes?.[0]).toBe('recipe_bulk_0');
    expect(s2.knownRecipes?.[511]).toBe('recipe_bulk_511');
    expect(s2.knownRecipes).not.toContain('recipe_bulk_512');
    expect(MAX_KNOWN_RECIPE_IDS).toBe(512);
  });
});
