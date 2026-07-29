// Pure gathering HUD core (issue 1124): node ready/cooldown classification (per-viewer,
// see IWorldProfessions#nodeHarvestableByMe) and the gathering-proficiency display
// rows (IWorldProfessions#professionsState). DOM/Three-free, same-input ->
// same-output, driven with hand-built IWorld-shaped stubs (no real Sim needed:
// the acceptance criterion under test is that two independent per-viewer
// cooldown states against the SAME node list classify independently, which is a
// property of this pure core, not of Sim's respawn timer itself).

import { describe, expect, it } from 'vitest';
import { GATHERING_PROFESSIONS, type GatheringProfessionId } from '../src/sim/content/professions';
import { GATHER_NODES } from '../src/sim/data';
import { TIER2_TOOL_WIELD_PROFICIENCY } from '../src/sim/professions/wield_gate';
import type { InvSlot } from '../src/sim/types';
import {
  buildGatheringProficiencyRows,
  buildGatherNodeTooltip,
  buildNearbyGatherNodes,
  classifyGatherNode,
  gatherDeniedLineKey,
  gatherDowngradeLineKey,
  gatherEffectPrompt,
  gatherRareTierFor,
  gatherToolNoNodeKey,
  isNodeToolLockedFor,
  viewerUsableToolTier,
} from '../src/ui/gathering_view';
import type { IWorld } from '../src/world_api';

const NODE = GATHER_NODES[0];

function makeWorld(opts: {
  pos?: { x: number; z: number };
  harvestable?: (nodeId: string) => boolean;
  proficiency?: Record<string, number>;
  inventory?: InvSlot[];
  /** The R40 deny-mirror states (gatherEffectPrompt); default all clear. */
  dead?: boolean;
  inCombat?: boolean;
  castingAbility?: string | null;
  auras?: { kind: string }[];
  /** The countdown read (IWorldProfessions nodeRespawnSeconds); defaults to
   *  the null answer both worlds give for a ready node. */
  respawnSeconds?: (nodeId: string) => number | null;
  /** The viewer's slotted tool effect rows (IWorld toolEffectSlots), the
   *  grade preview's slot input; defaults to the never-slotted empty list. */
  toolEffectSlots?: {
    professionId: string;
    effectId: string;
    charges: number;
    maxCharges: number;
    confirmMode: 'always' | 'prompt';
    selfCrafted?: boolean;
  }[];
}): IWorld {
  const proficiency = opts.proficiency ?? {};
  return {
    // The full deny-relevant Entity surface the R40 prompt mirror reads
    // (dead, combat, busy, consuming, shapeshift): a partial stub here
    // would read as "consuming" through isConsuming's null contract and
    // silently suppress every ask.
    player: {
      pos: opts.pos ?? { x: NODE.pos.x, z: NODE.pos.z },
      dead: opts.dead ?? false,
      inCombat: opts.inCombat ?? false,
      castingAbility: opts.castingAbility ?? null,
      eating: null,
      drinking: null,
      auras: opts.auras ?? [],
    },
    bags: [null, null, null, null],
    // buildNearbyGatherNodes resolves the locked dimension from the
    // viewer's bags; an empty bag reads as no tool owned at all (#2343:
    // bare hands never gather, so every node locks without its tool).
    inventory: opts.inventory ?? [],
    // The plain counter map the wield-filtered scan reads (R22), beside the
    // professionsState rows the display surfaces read: both derive from the
    // same opts so the fixture cannot disagree with itself.
    gatheringProficiency: proficiency,
    nodeHarvestableByMe: opts.harvestable ?? (() => true),
    nodeRespawnSeconds: opts.respawnSeconds ?? (() => null),
    toolEffectSlots: opts.toolEffectSlots ?? [],
    professionsState: {
      // The rows carry the RESOLVED per-profession content caps
      // (100 gathering, 200 fishing), matching what both worlds now emit.
      skills: Object.entries(proficiency).map(([professionId, skill]) => ({
        professionId,
        skill,
        maxSkill: GATHERING_PROFESSIONS[professionId as GatheringProfessionId]?.maxSkill ?? 100,
      })),
    },
  } as unknown as IWorld;
}

describe('classifyGatherNode', () => {
  it('classifies ready when nodeHarvestableByMe is true', () => {
    const world = makeWorld({ harvestable: () => true });
    expect(classifyGatherNode(world, NODE.id)).toBe('ready');
  });

  it('classifies cooldown when nodeHarvestableByMe is false', () => {
    const world = makeWorld({ harvestable: () => false });
    expect(classifyGatherNode(world, NODE.id)).toBe('cooldown');
  });
});

describe('buildNearbyGatherNodes', () => {
  it('includes nodes within radius and excludes nodes outside it', () => {
    const near = GATHER_NODES[0];
    const far = { x: near.pos.x + 100000, z: near.pos.z };
    const world = makeWorld({ pos: near.pos });
    const nodes = buildNearbyGatherNodes(world, 50);
    expect(nodes.some((n) => n.id === near.id)).toBe(true);
    // sanity: the far node id is never in range from this position.
    expect(nodes.every((n) => n.x !== far.x)).toBe(true);
  });

  it('classifies each nearby node ready/cooldown via nodeHarvestableByMe', () => {
    const world = makeWorld({
      pos: NODE.pos,
      harvestable: (id) => id !== NODE.id,
    });
    const nodes = buildNearbyGatherNodes(world, 5);
    const mine = nodes.find((n) => n.id === NODE.id);
    expect(mine?.state).toBe('cooldown');
  });

  // CRITICAL acceptance criterion: two independent viewers asking about the
  // SAME node list get independently correct answers for the SAME node id.
  it('two independent per-viewer cooldown states produce independent results for the same node', () => {
    const worldA = makeWorld({ pos: NODE.pos, harvestable: (id) => id === NODE.id });
    const worldB = makeWorld({ pos: NODE.pos, harvestable: () => false });

    const nodesA = buildNearbyGatherNodes(worldA, 5);
    const nodesB = buildNearbyGatherNodes(worldB, 5);

    const aState = nodesA.find((n) => n.id === NODE.id)?.state;
    const bState = nodesB.find((n) => n.id === NODE.id)?.state;

    expect(aState).toBe('ready');
    expect(bState).toBe('cooldown');
    // The two results genuinely differ: viewer A's cooldown never leaks into B's.
    expect(aState).not.toBe(bState);
  });
});

// The tool-tier access dimension. `locked` is SEPARATE from the
// ready/cooldown respawn state so the minimap can compose both; the lock
// resolves through the sim's own canGatherTier comparator against the
// viewer's wield-filtered bag scan (#2343 plus R22: no floor, 0 means no
// USABLE tool, owned-but-unearned included, so
// even a tier-1 node locks for a toolless viewer).
describe('tool-tier lock dimension', () => {
  // A literal NEW tier-2 vein; GATHER_NODES[0] stays the
  // tier-1 arm.
  const T2 = GATHER_NODES.find((n) => n.id === 'ore_mirefen_t2');
  if (!T2) throw new Error('missing ore_mirefen_t2');
  const PICK: InvSlot[] = [{ itemId: 'iron_mining_pick', count: 1 }];
  const T1_PICK: InvSlot[] = [{ itemId: 'copper_mining_pick', count: 1 }];
  // The tier-2 pick's wield requirement (R22): the client scan filters
  // unwieldable land tools exactly as the sim's harvest gate does, so every
  // "tooled" fixture carries the counter its pick demands.
  const MINING_40 = { mining: TIER2_TOOL_WIELD_PROFICIENCY };

  it('viewerUsableToolTier reads bags AND counters: empty is 0, the pick lifts mining only once wieldable', () => {
    expect(viewerUsableToolTier(makeWorld({}), 'mining')).toBe(0);
    const world = makeWorld({ inventory: PICK, proficiency: MINING_40 });
    expect(viewerUsableToolTier(world, 'mining')).toBe(2);
    expect(viewerUsableToolTier(world, 'logging')).toBe(0);
    // The R22 arm: the same pick with the counter short is unusable, so the
    // scan reports nothing rather than the owned tier.
    expect(viewerUsableToolTier(makeWorld({ inventory: PICK }), 'mining')).toBe(0);
    // The tier-1 entry tool never carries a requirement.
    expect(viewerUsableToolTier(makeWorld({ inventory: T1_PICK }), 'mining')).toBe(1);
  });

  it('the optional third argument: an explicit map wins, an omitted one reads through', () => {
    // The per-build hoist seam (the minimap hands the map it already read):
    // an explicit map must govern even when it disagrees with the world's
    // own, and omitting it must keep the pre-widening behavior byte for
    // byte. The pairing contract (same world, same synchronous pass) lives
    // at the signature; this pins the mechanics either side of it.
    const world = makeWorld({ inventory: PICK, proficiency: {} });
    expect(viewerUsableToolTier(world, 'mining')).toBe(0); // read-through: counter short
    expect(viewerUsableToolTier(world, 'mining', MINING_40)).toBe(2); // explicit map wins
    expect(viewerUsableToolTier(world, 'mining', undefined)).toBe(0); // explicit undefined = default
  });

  it('isNodeToolLockedFor: tier-2 locks toolless AND unwieldable viewers, unlocks with the earned pick', () => {
    expect(isNodeToolLockedFor(makeWorld({}), { type: 'ore', tier: 2 })).toBe(true);
    // Owned but unearned: still locked (R22), the map lock agreeing with the
    // sim's wield denial.
    expect(isNodeToolLockedFor(makeWorld({ inventory: PICK }), { type: 'ore', tier: 2 })).toBe(
      true,
    );
    expect(
      isNodeToolLockedFor(makeWorld({ inventory: PICK, proficiency: MINING_40 }), {
        type: 'ore',
        tier: 2,
      }),
    ).toBe(false);
    // Bare hands never gather: even a tier-1 vein is locked without a pick,
    // and the tier-1 copper pick unlocks it at zero proficiency.
    expect(isNodeToolLockedFor(makeWorld({}), { type: 'ore', tier: 1 })).toBe(true);
    expect(isNodeToolLockedFor(makeWorld({ inventory: T1_PICK }), { type: 'ore', tier: 1 })).toBe(
      false,
    );
  });

  it('a world with NO gatheringProficiency member at all reads 0 and locks (fail-closed)', () => {
    // Both shipped worlds always expose the member (the Sim getter copies the
    // live map, ClientWorld rebuilds it from the gprof wire field), so no
    // other fixture here can drive the ABSENT-MAP arm of the optional read in
    // viewerUsableToolTier: every one of them supplies at least {}. This arm
    // drives it, which is what makes the `?.` load-bearing rather than
    // decorative: dropped to a plain index, a partial mirror would throw
    // inside the minimap's per-frame build instead of locking. The bags hold a
    // COVERING tier-2 pick on purpose, so a fail-OPEN regression (absent read
    // as "no requirement") would unlock the vein and red this arm.
    const partial = {
      player: { pos: { x: T2.pos.x, z: T2.pos.z } },
      inventory: PICK,
      nodeHarvestableByMe: () => true,
      professionsState: { skills: [] },
    };
    expect('gatheringProficiency' in partial).toBe(false);
    const world = partial as unknown as IWorld;
    expect(viewerUsableToolTier(world, 'mining')).toBe(0);
    expect(isNodeToolLockedFor(world, { type: 'ore', tier: 2 })).toBe(true);
    expect(buildNearbyGatherNodes(world, 5).find((n) => n.id === T2.id)).toMatchObject({
      tier: 2,
      locked: true,
    });
    // The denial the hover would name still resolves off the bags, so the
    // absent map degrades to the wield arm rather than to a null model.
    expect(buildGatherNodeTooltip(world, T2.id)).toMatchObject({
      locked: true,
      wieldSkill: TIER2_TOOL_WIELD_PROFICIENCY,
    });
  });

  it('buildNearbyGatherNodes carries tier and both lock arms, independent of respawn state', () => {
    const bare = buildNearbyGatherNodes(makeWorld({ pos: T2.pos }), 5);
    const bareT2 = bare.find((n) => n.id === T2.id);
    expect(bareT2).toMatchObject({ tier: 2, locked: true, state: 'ready' });
    const tooled = buildNearbyGatherNodes(
      makeWorld({ pos: T2.pos, inventory: PICK, proficiency: MINING_40 }),
      5,
    );
    expect(tooled.find((n) => n.id === T2.id)).toMatchObject({ tier: 2, locked: false });
    // The R22 arm: owned-but-unearned reads locked on the map too.
    const unearned = buildNearbyGatherNodes(makeWorld({ pos: T2.pos, inventory: PICK }), 5);
    expect(unearned.find((n) => n.id === T2.id)).toMatchObject({ tier: 2, locked: true });
    // The tier-1 arm (#2343): locked toolless, unlocked with the tier-1 pick.
    const t1 = buildNearbyGatherNodes(makeWorld({}), 5).find((n) => n.id === NODE.id);
    expect(t1).toMatchObject({ tier: 1, locked: true });
    const t1Tooled = buildNearbyGatherNodes(makeWorld({ inventory: T1_PICK }), 5).find(
      (n) => n.id === NODE.id,
    );
    expect(t1Tooled).toMatchObject({ tier: 1, locked: false });
    // Lock and respawn compose: a cooling t2 node reads locked AND cooldown.
    const cooling = buildNearbyGatherNodes(
      makeWorld({ pos: T2.pos, harvestable: (id) => id !== T2.id }),
      5,
    ).find((n) => n.id === T2.id);
    expect(cooling).toMatchObject({ locked: true, state: 'cooldown' });
  });

  it('buildGatherNodeTooltip resolves the full model, and null for an unknown id', () => {
    expect(buildGatherNodeTooltip(makeWorld({ pos: T2.pos }), T2.id)).toEqual({
      type: 'ore',
      professionId: 'mining',
      tier: 2,
      locked: true,
      state: 'ready',
    });
    expect(
      buildGatherNodeTooltip(
        makeWorld({ pos: T2.pos, inventory: PICK, proficiency: MINING_40 }),
        T2.id,
      ),
    ).toMatchObject({ locked: false });
    // Owned-but-unearned stays locked in the tooltip model too (R22), and
    // the model carries the wield shortfall so the hover painter can name
    // the counter instead of a tier the viewer already meets.
    expect(
      buildGatherNodeTooltip(makeWorld({ pos: T2.pos, inventory: PICK }), T2.id),
    ).toMatchObject({ locked: true, wieldSkill: TIER2_TOOL_WIELD_PROFICIENCY });
    // Absent, not zero, when the lock is a plain tool shortfall.
    expect('wieldSkill' in (buildGatherNodeTooltip(makeWorld({ pos: T2.pos }), T2.id) ?? {})).toBe(
      false,
    );
    // A stale pick after a content change resolves to null, never a throw.
    expect(buildGatherNodeTooltip(makeWorld({}), 'no_such_node_id')).toBeNull();
  });

  it('carries respawnSeconds exactly when cooling AND the world puts a number on it', () => {
    const cooling = makeWorld({
      harvestable: () => false,
      respawnSeconds: (id) => (id === NODE.id ? 95.2 : null),
    });
    expect(buildGatherNodeTooltip(cooling, NODE.id)).toMatchObject({
      state: 'cooldown',
      respawnSeconds: 95.2,
    });
    // A null read keeps the untimed shape (the painter falls back to the
    // plain "Respawning" word).
    const nullRead = makeWorld({ harvestable: () => false });
    expect('respawnSeconds' in (buildGatherNodeTooltip(nullRead, NODE.id) ?? {})).toBe(false);
    // Ready never carries one, even against a world that would answer.
    const ready = makeWorld({ respawnSeconds: () => 42 });
    expect('respawnSeconds' in (buildGatherNodeTooltip(ready, NODE.id) ?? {})).toBe(false);
  });

  it('fineUpgrade reads the grant resolution: t1 pick false, outclassing pick true, locked absent', () => {
    // NODE is the tier-1 copper vein: its fine grade needs a tool strictly
    // above the material tier, so the tier-1 pick previews false...
    expect(buildGatherNodeTooltip(makeWorld({ inventory: T1_PICK }), NODE.id)).toMatchObject({
      locked: false,
      fineUpgrade: false,
    });
    // ...and the WIELDABLE tier-2 pick previews true (R22/R49: the same
    // wield-filtered scan the grant runs).
    expect(
      buildGatherNodeTooltip(makeWorld({ inventory: PICK, proficiency: MINING_40 }), NODE.id),
    ).toMatchObject({ locked: false, fineUpgrade: true });
    // Owned-but-unwieldable mints no fine grade, so it previews none either.
    expect(buildGatherNodeTooltip(makeWorld({ inventory: PICK }), NODE.id)).toMatchObject({
      locked: true,
    });
    // Locked: absent, the red requirement line owns that state.
    expect('fineUpgrade' in (buildGatherNodeTooltip(makeWorld({}), NODE.id) ?? {})).toBe(false);
  });

  it('gatherEffectPrompt asks exactly when a prompt-mode effect would fire', () => {
    const slotted = (
      over: Partial<{ effectId: string; charges: number; confirmMode: 'always' | 'prompt' }> = {},
    ) =>
      makeWorld({
        inventory: T1_PICK,
        toolEffectSlots: [
          {
            professionId: 'mining',
            effectId: 'artisans_eye',
            charges: 5,
            maxCharges: 30,
            confirmMode: 'prompt',
            ...over,
          },
        ],
      });
    // The live prompt slot on a fine-reachable node: ask, naming the effect
    // and the marginal fact (the charges left).
    expect(gatherEffectPrompt(slotted(), NODE.id)).toEqual({
      effectId: 'artisans_eye',
      charges: 5,
    });
    // 'always' mode never asks; a spent prompt slot has nothing to spend.
    expect(gatherEffectPrompt(slotted({ confirmMode: 'always' }), NODE.id)).toBeNull();
    expect(gatherEffectPrompt(slotted({ charges: 0 }), NODE.id)).toBeNull();
    // The R9 suppression: a quality charm on a fine-unreachable starter node
    // would not fire, so the dialog must not ask about it...
    expect(gatherEffectPrompt(slotted(), 'ore_veiled_hollow_1')).toBeNull();
    // ...while a quantity effect fires anywhere and still asks there.
    expect(
      gatherEffectPrompt(slotted({ effectId: 'gatherers_cache' }), 'ore_veiled_hollow_1'),
    ).toEqual({ effectId: 'gatherers_cache', charges: 5 });
    // No slot, and an unknown node id: never ask.
    expect(gatherEffectPrompt(makeWorld({ inventory: T1_PICK }), NODE.id)).toBeNull();
    expect(gatherEffectPrompt(slotted(), 'no_such_node')).toBeNull();
  });

  it('gatherEffectPrompt never asks about a use that cannot matter (tool past the rung)', () => {
    // The grant's `mattered` predicate, mirrored (the phase 14 QA finding):
    // a wieldable tier-2 pick already mints NODE's fine grade unassisted,
    // so a prompt-mode quality charm changes nothing, spends nothing, and
    // must not pop a dialog on every single harvest.
    const world = makeWorld({
      inventory: PICK,
      proficiency: MINING_40,
      toolEffectSlots: [
        {
          professionId: 'mining',
          effectId: 'artisans_eye',
          charges: 5,
          maxCharges: 30,
          confirmMode: 'prompt',
        },
      ],
    });
    expect(gatherEffectPrompt(world, NODE.id)).toBeNull();
    // A quantity effect on the same over-tiered tool still matters (more
    // units is more units), so it still asks.
    const qty = makeWorld({
      inventory: PICK,
      proficiency: MINING_40,
      toolEffectSlots: [
        {
          professionId: 'mining',
          effectId: 'gatherers_cache',
          charges: 5,
          maxCharges: 20,
          confirmMode: 'prompt',
        },
      ],
    });
    expect(gatherEffectPrompt(qty, NODE.id)).toEqual({
      effectId: 'gatherers_cache',
      charges: 5,
    });
  });

  it('gatherEffectPrompt mirrors the locally knowable deny arms and the capacity gate', () => {
    const slotted = (
      over: Partial<{
        dead: boolean;
        inCombat: boolean;
        castingAbility: string | null;
        auras: { kind: string }[];
        inventory: InvSlot[];
      }> = {},
    ) =>
      makeWorld({
        inventory: over.inventory ?? T1_PICK,
        dead: over.dead,
        inCombat: over.inCombat,
        castingAbility: over.castingAbility,
        auras: over.auras,
        toolEffectSlots: [
          {
            professionId: 'mining',
            effectId: 'artisans_eye',
            charges: 5,
            maxCharges: 30,
            confirmMode: 'prompt',
          },
        ],
      });
    // The control: all states clear, the ask fires.
    expect(gatherEffectPrompt(slotted(), NODE.id)).not.toBeNull();
    // Each deny state, one at a time: a harvest the sim will refuse (dead,
    // combat, busy, action-locked form) never pops the dialog first.
    expect(gatherEffectPrompt(slotted({ dead: true }), NODE.id)).toBeNull();
    expect(gatherEffectPrompt(slotted({ inCombat: true }), NODE.id)).toBeNull();
    expect(gatherEffectPrompt(slotted({ castingAbility: 'fireball' }), NODE.id)).toBeNull();
    expect(gatherEffectPrompt(slotted({ auras: [{ kind: 'form_bear' }] }), NODE.id)).toBeNull();
    // A NON-locking aura does not suppress (the mirror keys on the sim's
    // own action-locked set, not "any aura").
    expect(
      gatherEffectPrompt(slotted({ auras: [{ kind: 'regrowth_hot' }] }), NODE.id),
    ).not.toBeNull();
    // The ClientWorld shape (the fix-round review): online mirrors never
    // set p.inCombat, so the in-combat arm is offline-only and the ONLINE
    // prompt must still fire mid-fight (the server's combat denial answers
    // a confirm). This fixture IS that shape: inCombat reads false however
    // the fight looks, and the ask stands.
    expect(gatherEffectPrompt(slotted({ inCombat: false }), NODE.id)).not.toBeNull();
    // The capacity mirror: with no room for the CONFIRMED (fine) grade, a
    // confirmed use would be refused at the cast-start pre-gate, so the
    // dialog never asks; the plain harvest command still goes out.
    const full = [
      ...T1_PICK,
      ...Array.from({ length: 15 }, (_, i) => ({ itemId: `filler_${i}`, count: 1 })),
    ];
    expect(full).toHaveLength(16);
    expect(gatherEffectPrompt(slotted({ inventory: full }), NODE.id)).toBeNull();
  });

  it('a usable quality effect lifts the preview, a spent one does not (adapter durability mapping)', () => {
    const slotted = (charges: number, effectId = 'artisans_eye') =>
      makeWorld({
        inventory: T1_PICK,
        toolEffectSlots: [
          { professionId: 'mining', effectId, charges, maxCharges: 30, confirmMode: 'always' },
        ],
      });
    expect(buildGatherNodeTooltip(slotted(3), NODE.id)).toMatchObject({ fineUpgrade: true });
    // A spent slot (0 charges) previews the base grade: the adapter maps
    // charges onto durability, and applyEffectBonus refuses at zero.
    expect(buildGatherNodeTooltip(slotted(0), NODE.id)).toMatchObject({ fineUpgrade: false });
    // An unknown (or prototype-key) effect id from a newer server drops the
    // row instead of throwing mid-hover.
    expect(buildGatherNodeTooltip(slotted(3, 'constructor'), NODE.id)).toMatchObject({
      fineUpgrade: false,
    });
  });

  it('gatherDeniedLineKey maps surface + professionId + requiredTier to the exact key, falling back safely', () => {
    // Tier 2+ keeps the tiered wording; requiredTier 1 means "no tool owned
    // at all" (#2343) so the tierless base-tool line is used instead.
    expect(gatherDeniedLineKey('node', 'mining', 2)).toBe(
      'hudChrome.gathering.toolTierUnmet.mining',
    );
    expect(gatherDeniedLineKey('node', 'mining', 1)).toBe(
      'hudChrome.gathering.toolRequired.mining',
    );
    expect(gatherDeniedLineKey('node', 'logging', 2)).toBe(
      'hudChrome.gathering.toolTierUnmet.logging',
    );
    expect(gatherDeniedLineKey('node', 'logging', 1)).toBe(
      'hudChrome.gathering.toolRequired.logging',
    );
    expect(gatherDeniedLineKey('node', 'herbalism', 2)).toBe(
      'hudChrome.gathering.toolTierUnmet.herbalism',
    );
    expect(gatherDeniedLineKey('node', 'herbalism', 1)).toBe(
      'hudChrome.gathering.toolRequired.herbalism',
    );
    // A missing requiredTier stays on the tiered line (never claims "no tool").
    expect(gatherDeniedLineKey('node', 'mining')).toBe('hudChrome.gathering.toolTierUnmet.mining');
    // The R22 wield arm outranks BOTH tier arms when the event carries a
    // requirement: the player owns a covering tool, so the counter is the
    // actionable fact, at tier 1 and above alike.
    expect(gatherDeniedLineKey('node', 'mining', 1, 40)).toBe(
      'hudChrome.gathering.wieldUnmet.mining',
    );
    expect(gatherDeniedLineKey('node', 'herbalism', 2, 70)).toBe(
      'hudChrome.gathering.wieldUnmet.herbalism',
    );
    expect(gatherDeniedLineKey('node', 'logging', 1, 40)).toBe(
      'hudChrome.gathering.wieldUnmet.logging',
    );
    // A zero or absent wield requirement never takes the wield line.
    expect(gatherDeniedLineKey('node', 'mining', 2, 0)).toBe(
      'hudChrome.gathering.toolTierUnmet.mining',
    );
    // The corpse flavor: profession-neutral, like its tier-based sibling.
    expect(gatherDeniedLineKey('corpse', undefined, 2, 70)).toBe(
      'hudChrome.gathering.wieldUnmetCorpse',
    );
    expect(gatherDeniedLineKey('corpse', undefined, 2)).toBe(
      'hudChrome.gathering.toolTierUnmetCorpse',
    );
    // The startFishing implement gate (#2343): surface 'fishing' at tier 1
    // means no tackle at all, so no tier is named.
    expect(gatherDeniedLineKey('fishing', 'fishing', 1)).toBe(
      'hudChrome.gathering.toolRequired.fishing',
    );
    // The ZONE rod gate (D9) rides the same surface at tier 2 and up, and MUST
    // take the tiered line: on the tierless one a player standing in Thornpeak
    // holding an Ironreel is told to fetch a fishing pole they already carry.
    // Both live requirements are covered, not just the boundary.
    expect(gatherDeniedLineKey('fishing', 'fishing', 2)).toBe(
      'hudChrome.gathering.toolTierUnmet.fishing',
    );
    expect(gatherDeniedLineKey('fishing', 'fishing', 3)).toBe(
      'hudChrome.gathering.toolTierUnmet.fishing',
    );
    // A missing requiredTier on the fishing surface stays on the tierless
    // line: the tiered copy interpolates {tier} and would render a hole.
    expect(gatherDeniedLineKey('fishing', 'fishing')).toBe(
      'hudChrome.gathering.toolRequired.fishing',
    );
    expect(gatherDeniedLineKey('corpse', undefined, 2)).toBe(
      'hudChrome.gathering.toolTierUnmetCorpse',
    );
    // Unexpected shapes never reach t() with an untracked key: a node surface
    // with fishing (no fishing world nodes) or a missing professionId falls
    // back to the profession-neutral corpse line.
    expect(gatherDeniedLineKey('node', 'fishing')).toBe('hudChrome.gathering.toolTierUnmetCorpse');
    expect(gatherDeniedLineKey('node', undefined, 2)).toBe(
      'hudChrome.gathering.toolTierUnmetCorpse',
    );
    expect(gatherDeniedLineKey('node')).toBe('hudChrome.gathering.toolTierUnmetCorpse');
  });

  it('gatherToolNoNodeKey maps each node profession to its exact key, mining the fallback', () => {
    expect(gatherToolNoNodeKey('mining')).toBe('hudChrome.gathering.noNodeNearby.mining');
    expect(gatherToolNoNodeKey('logging')).toBe('hudChrome.gathering.noNodeNearby.logging');
    expect(gatherToolNoNodeKey('herbalism')).toBe('hudChrome.gathering.noNodeNearby.herbalism');
    // Fishing never emits gatherToolNoNode (rods route to startFishing), so
    // anything but the three node professions takes the safe mining fallback.
    expect(gatherToolNoNodeKey('fishing')).toBe('hudChrome.gathering.noNodeNearby.mining');
  });

  it('gatherDowngradeLineKey maps each lost arm to its exact key', () => {
    expect(gatherDowngradeLineKey('mark')).toBe('hudChrome.gathering.downgradeMark');
    expect(gatherDowngradeLineKey('find')).toBe('hudChrome.gathering.downgradeFind');
  });
});

describe('buildGatheringProficiencyRows', () => {
  it('returns one row per gathering profession, in the fixed order', () => {
    const world = makeWorld({ proficiency: { mining: 3, logging: 0, herbalism: 7 } });
    const rows = buildGatheringProficiencyRows(world);
    expect(rows.map((r) => r.professionId)).toEqual(['mining', 'logging', 'herbalism', 'fishing']);
  });

  it('matches the input values exactly', () => {
    const world = makeWorld({ proficiency: { mining: 12, logging: 4, herbalism: 0 } });
    const rows = buildGatheringProficiencyRows(world);
    expect(rows).toEqual([
      { professionId: 'mining', value: 12, displayValue: 12, maxSkill: 100 },
      { professionId: 'logging', value: 4, displayValue: 4, maxSkill: 100 },
      { professionId: 'herbalism', value: 0, displayValue: 0, maxSkill: 100 },
      { professionId: 'fishing', value: 0, displayValue: 0, maxSkill: 200 },
    ]);
  });

  it('carries the per-profession content cap so a readout can render a denominator', () => {
    // A bare integer that moves +1 per harvest is what reads as a character
    // level. Every row carries its own cap, and fishing's 200 is NOT the 100
    // the other three share, so a readout can never print one profession's bar
    // against another's ceiling.
    const rows = buildGatheringProficiencyRows(makeWorld({ proficiency: { mining: 12 } }));
    expect(rows.map((r) => [r.professionId, r.maxSkill])).toEqual([
      ['mining', 100],
      ['logging', 100],
      ['herbalism', 100],
      ['fishing', 200],
    ]);
  });

  it('sources the cap from content, ignoring an absent or malformed wire maxSkill', () => {
    // The cap comes from GATHERING_PROFESSIONS, not the per-row wire value,
    // precisely so a missing or garbage skills row degrades to "0 / 100"
    // rather than a nonsense "0 / 0" or "0 / undefined". mining carries a
    // deliberately wrong wire cap and logging a zero one; herbalism and
    // fishing carry no wire row at all.
    const world = {
      player: { pos: { x: 0, z: 0 } },
      inventory: [],
      nodeHarvestableByMe: () => true,
      professionsState: {
        skills: [
          { professionId: 'mining', skill: 12, maxSkill: 7777 },
          { professionId: 'logging', skill: 3, maxSkill: 0 },
        ],
      },
    } as unknown as IWorld;
    const rows = buildGatheringProficiencyRows(world);
    expect(rows.map((r) => [r.professionId, r.maxSkill])).toEqual([
      ['mining', 100],
      ['logging', 100],
      ['herbalism', 100],
      ['fishing', 200],
    ]);
    // The values themselves still come off the wire, so the cap swap did not
    // quietly detach the readout from the player's real proficiency.
    expect(rows.find((r) => r.professionId === 'mining')?.displayValue).toBe(12);
    expect(rows.find((r) => r.professionId === 'logging')?.displayValue).toBe(3);
  });

  it('display-floors a fractional proficiency, never rounding a threshold forward', () => {
    // The character sheet must never read "100" while the raw value (which
    // the deed evaluator and the band ladder compare with >=) is still 99.5
    // (issue 2339, the Old Salt strand): the readout floors, the buildSkillBar
    // convention, while `value` keeps the exact fraction for the repaint
    // signature.
    const world = makeWorld({ proficiency: { mining: 99.75, fishing: 99.5 } });
    const rows = buildGatheringProficiencyRows(world);
    const fishing = rows.find((r) => r.professionId === 'fishing');
    expect(fishing?.value).toBe(99.5);
    expect(fishing?.displayValue).toBe(99);
    const mining = rows.find((r) => r.professionId === 'mining');
    expect(mining?.value).toBe(99.75);
    expect(mining?.displayValue).toBe(99);
  });

  it('defaults an absent or malformed entry to 0, never throwing', () => {
    const world = makeWorld({
      proficiency: { mining: Number.NaN, logging: -5 } as unknown as Record<string, number>,
    });
    const rows = buildGatheringProficiencyRows(world);
    expect(rows.find((r) => r.professionId === 'mining')?.value).toBe(0);
    expect(rows.find((r) => r.professionId === 'logging')?.value).toBe(0);
    expect(rows.find((r) => r.professionId === 'herbalism')?.value).toBe(0);
  });
});

describe('gatherRareTierFor', () => {
  it('tracks the rolled material rarity 1:1 for rare/epic/legendary', () => {
    expect(gatherRareTierFor('rare', null)).toBe('rare');
    expect(gatherRareTierFor('epic', null)).toBe('epic');
    expect(gatherRareTierFor('legendary', null)).toBe('legendary');
  });

  it('plays no stinger for common or uncommon rolls with no rare event', () => {
    expect(gatherRareTierFor('common', null)).toBeNull();
    expect(gatherRareTierFor('uncommon', null)).toBeNull();
  });

  it('a rare event forces at least the epic stinger, overriding a lower rarity roll', () => {
    expect(gatherRareTierFor('common', 'pristine_vein')).toBe('epic');
    expect(gatherRareTierFor('uncommon', 'ancient_heartwood')).toBe('epic');
    expect(gatherRareTierFor('rare', 'moonlit_bloom')).toBe('epic');
  });

  it('never downgrades a legendary roll just because a rare event also fired', () => {
    expect(gatherRareTierFor('legendary', 'pristine_vein')).toBe('legendary');
  });
});
