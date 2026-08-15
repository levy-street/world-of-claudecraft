// Professions window view core (Professions 2.0): model construction
// from both world shapes, ring layout math, tier pips and perks, next-unlock
// resolution, switch cost, progressive disclosure, the refresh signature, and
// the binding amendment that every identity-view semantic (role, ceiling,
// nudges, tutorial) survives into the composed window model unchanged.

import { describe, expect, it } from 'vitest';
import { CRAFT_RING, craftMaxSkillFor, PERK_THRESHOLDS } from '../src/sim/content/professions';
import { TIER_SKILL_STEP } from '../src/sim/professions/wheel';
import {
  buildProfessionsView,
  buildRingLayout,
  buildSkillBar,
  craftNextUnlock,
  type ProfessionsViewInput,
  professionsRefreshSig,
  RING_STEP_ANGLE,
  ringNodePositions,
} from '../src/ui/professions_view';
import type { CraftingIdentityView } from '../src/world_api/professions';

// The locked ring order (docs/prd Professions 2.0): a content reorder must be a
// deliberate decision, so the full sequence is pinned literally once.
const RING_ORDER = [
  'engineering',
  'alchemy',
  'cooking',
  'leatherworking',
  'tailoring',
  'inscription',
  'enchanting',
  'jewelcrafting',
  'weaponcrafting',
  'armorcrafting',
];

const ZERO_SKILLS: Record<string, number> = Object.fromEntries(RING_ORDER.map((id) => [id, 0]));

function identity(over: Partial<CraftingIdentityView> = {}): CraftingIdentityView {
  return {
    version: 1,
    synced: true,
    craftSkills: { ...ZERO_SKILLS },
    activeArchetype: null,
    pairedMajor: null,
    hobbyCraft: null,
    attunedPairs: [],
    switchCount: 0,
    amendsProgress: 0,
    amendsRequired: 0,
    knownRecipes: [],
    ...over,
  };
}

// The Sim-shaped input: synced, a full craftSkills record (the shape the
// offline world always produces).
const attunedIdentity = identity({
  craftSkills: {
    ...ZERO_SKILLS,
    armorcrafting: 49,
    weaponcrafting: 25,
    jewelcrafting: 60,
    cooking: 30,
  },
  activeArchetype: 'armorcrafting',
  pairedMajor: 'weaponcrafting',
  hobbyCraft: 'leatherworking',
  attunedPairs: ['weaponcrafting+armorcrafting'],
  switchCount: 2,
  amendsProgress: 1,
  amendsRequired: 11,
});

function view(id: CraftingIdentityView, gathering: ProfessionsViewInput['gathering'] = []) {
  return buildProfessionsView({
    viewerName: 'Testchar',
    identity: id,
    gathering,
    toolEffects: [],
    inventory: [],
  });
}

function craftRow(model: ReturnType<typeof buildProfessionsView>, craftId: string) {
  const row = model.crafts.find((c) => c.identity.craftId === craftId);
  if (!row) throw new Error(`missing craft row ${craftId}`);
  return row;
}

describe('buildProfessionsView: model construction', () => {
  it('builds the full model from a Sim-shaped identity', () => {
    const model = view(attunedIdentity, [{ professionId: 'mining', skill: 30, maxSkill: 100 }]);
    expect(model.mode).toBe('full');
    expect(model.simplified).toBeNull();
    expect(model.identity.state).toBe('attuned');
    expect(model.identity.summary.pairId).toBe('weaponcrafting+armorcrafting');
    expect(model.crafts.map((c) => c.identity.craftId)).toEqual(RING_ORDER);
    // Bars derive from the same skill the identity row carries.
    for (const row of model.crafts) expect(row.bar.skill).toBe(row.identity.skill);
    // `effect: null` for an input with no toolEffects, and no slottable
    // charms for empty bags: the pre-craft default every fresh character
    // reads.
    expect(model.gathering).toEqual([
      { professionId: 'mining', bar: buildSkillBar(30, 100), effect: null, slottable: [] },
    ]);
  });

  describe('the slotted tool effect joins onto its gathering row', () => {
    const gathering = [
      { professionId: 'mining', skill: 30, maxSkill: 100 },
      { professionId: 'logging', skill: 10, maxSkill: 100 },
    ];
    const slot = (over: Partial<Record<string, unknown>> = {}) => ({
      professionId: 'mining',
      effectId: 'gatherers_cache',
      charges: 12,
      maxCharges: 30,
      confirmMode: 'always' as const,
      selfCrafted: false,
      ...over,
    });

    it('attaches to the matching profession and leaves the others null', () => {
      const model = buildProfessionsView({
        viewerName: 'Testchar',
        identity: attunedIdentity,
        gathering,
        toolEffects: [slot()],
        inventory: [],
      });
      const byId = new Map(model.gathering.map((r) => [r.professionId, r]));
      expect(byId.get('mining')?.effect).toEqual({
        effectId: 'gatherers_cache',
        charges: 12,
        maxCharges: 30,
        spent: false,
        // Empty bags: no tool, so the recharge resolver refuses and the
        // affordance stays off (the resolver-derived arms below cover the
        // positive cases).
        rechargeable: false,
        // The R40 mode projection: the live slot's own confirm mode, so the
        // "Asks each use" chip renders from the row.
        confirmMode: 'always',
      });
      // The OTHER row must stay null, so the join is a join and not a broadcast.
      expect(byId.get('logging')?.effect).toBeNull();
    });

    it('marks a zero-charge slot spent, and only a zero-charge one', () => {
      const spent = buildProfessionsView({
        viewerName: 'Testchar',
        identity: attunedIdentity,
        gathering,
        toolEffects: [slot({ charges: 0 })],
        inventory: [],
      });
      expect(spent.gathering[0].effect?.spent).toBe(true);
      const oneLeft = buildProfessionsView({
        viewerName: 'Testchar',
        identity: attunedIdentity,
        gathering,
        toolEffects: [slot({ charges: 1 })],
        inventory: [],
      });
      expect(oneLeft.gathering[0].effect?.spent).toBe(false);
    });

    it('DROPS an effect naming a profession with no row, rather than painting an orphan', () => {
      const model = buildProfessionsView({
        viewerName: 'Testchar',
        identity: attunedIdentity,
        gathering,
        toolEffects: [slot({ professionId: 'fishing' })],
        inventory: [],
      });
      for (const row of model.gathering) expect(row.effect).toBeNull();
    });

    it('offers the slot affordance exactly where the sim resolver would accept', () => {
      // One charm, one mining pick: only the mining row offers the slot (the
      // logging row has no tool, fishing is policy-refused and has no row
      // here anyway). The affordance is DERIVED through resolveSlotToolEffect
      // itself, so this arm is really pinning that the view asks the one
      // authority instead of re-deriving the gates.
      const model = buildProfessionsView({
        viewerName: 'Testchar',
        identity: attunedIdentity,
        gathering,
        toolEffects: [],
        inventory: [
          { itemId: 'copper_mining_pick', count: 1 },
          { itemId: 'gatherers_cache', count: 1 },
        ],
      });
      const byId = new Map(model.gathering.map((r) => [r.professionId, r]));
      expect(byId.get('mining')?.slottable).toEqual(['gatherers_cache']);
      expect(byId.get('logging')?.slottable).toEqual([]);
    });

    it('offers the recharge affordance only below the re-derived maximum, tool in bags', () => {
      // Common pick: the R30 re-derived max is 20. A 12-charge slot offers
      // the recharge; a full one does not; and with the pick gone neither
      // does (the resolver refuses no_tool).
      const withPick = (charges: number, inventory: { itemId: string; count: number }[]) =>
        buildProfessionsView({
          viewerName: 'Testchar',
          identity: attunedIdentity,
          gathering,
          toolEffects: [slot({ charges, maxCharges: 20 })],
          inventory,
        }).gathering.find((row) => row.professionId === 'mining')?.effect?.rechargeable;
      const pick = [{ itemId: 'copper_mining_pick', count: 1 }];
      expect(withPick(12, pick)).toBe(true);
      expect(withPick(20, pick)).toBe(false);
      expect(withPick(12, [])).toBe(false);
    });

    it('affordance parity with SIGNED copies: the view reproduces no_gain exactly (R48)', () => {
      // The adversarial round's phantom button: before R48 the view could
      // never compute no_gain (it had neither the slot's provenance nor the
      // slotter's name), so the primary crafter flow rendered a button the
      // server refused on every click. With selfCrafted and viewerName
      // threaded, the view runs the resolver on the SAME inputs.
      const fullSelfSlot = {
        professionId: 'mining',
        effectId: 'gatherers_cache',
        charges: 20,
        maxCharges: 20,
        confirmMode: 'always' as const,
        selfCrafted: true,
      };
      // Full self-crafted slot + a spare SELF-signed copy: the server answers
      // no_gain, so the view must render NO button.
      const phantom = buildProfessionsView({
        viewerName: 'Testchar',
        identity: attunedIdentity,
        gathering,
        toolEffects: [fullSelfSlot],
        inventory: [
          { itemId: 'copper_mining_pick', count: 1 },
          { itemId: 'gatherers_cache', count: 1, instance: { signer: 'Testchar' } },
        ],
      });
      expect(phantom.gathering[0].slottable).toEqual([]);
      // Full self-crafted slot + only a FOREIGN copy: the R48 downgrade
      // refusal, so still no button.
      const downgrade = buildProfessionsView({
        viewerName: 'Testchar',
        identity: attunedIdentity,
        gathering,
        toolEffects: [fullSelfSlot],
        inventory: [
          { itemId: 'copper_mining_pick', count: 1 },
          { itemId: 'gatherers_cache', count: 1, instance: { signer: 'Elsewhere' } },
        ],
      });
      expect(downgrade.gathering[0].slottable).toEqual([]);
      // Full FOREIGN-crafted slot + the viewer's own signed copy: the
      // provenance upgrade the server accepts, so the button must render.
      const upgrade = buildProfessionsView({
        viewerName: 'Testchar',
        identity: attunedIdentity,
        gathering,
        toolEffects: [{ ...fullSelfSlot, selfCrafted: false }],
        inventory: [
          { itemId: 'copper_mining_pick', count: 1 },
          { itemId: 'gatherers_cache', count: 1, instance: { signer: 'Testchar' } },
        ],
      });
      expect(upgrade.gathering[0].slottable).toEqual(['gatherers_cache']);
    });

    it('slottable lists held charms in CATALOG order, not bag order', () => {
      // Catalog order keeps the buttons from reshuffling when the player
      // moves items around; a regression to bag order flips this pair.
      const model = buildProfessionsView({
        viewerName: 'Testchar',
        identity: attunedIdentity,
        gathering,
        toolEffects: [],
        inventory: [
          { itemId: 'copper_mining_pick', count: 1 },
          { itemId: 'artisans_eye', count: 1 },
          { itemId: 'gatherers_cache', count: 1 },
        ],
      });
      expect(model.gathering[0].slottable).toEqual(['gatherers_cache', 'artisans_eye']);
    });

    it('the refresh signature moves on a signer swap, a provenance flip, and a rename', () => {
      // The consume-copy preference and the R48 arm read all three, so a
      // same-id same-count change in any of them must repaint the buttons.
      const base = {
        viewerName: 'Testchar' as const,
        identity: attunedIdentity,
        gathering,
        toolEffects: [slot({ selfCrafted: true })],
      };
      const own = professionsRefreshSig({
        ...base,
        inventory: [{ itemId: 'gatherers_cache', count: 1, instance: { signer: 'Testchar' } }],
      });
      const swapped = professionsRefreshSig({
        ...base,
        inventory: [{ itemId: 'gatherers_cache', count: 1, instance: { signer: 'Elsewhere' } }],
      });
      expect(swapped).not.toBe(own);
      const provenanceFlip = professionsRefreshSig({
        ...base,
        toolEffects: [slot({ selfCrafted: false })],
        inventory: [{ itemId: 'gatherers_cache', count: 1, instance: { signer: 'Testchar' } }],
      });
      expect(provenanceFlip).not.toBe(own);
      const renamed = professionsRefreshSig({
        ...base,
        viewerName: 'Freshname',
        inventory: [{ itemId: 'gatherers_cache', count: 1, instance: { signer: 'Testchar' } }],
      });
      expect(renamed).not.toBe(own);
    });

    it('the refresh signature moves when a charm or tool enters the bags', () => {
      const base = {
        viewerName: 'Testchar' as const,
        identity: attunedIdentity,
        gathering,
        toolEffects: [slot()],
      };
      const empty = professionsRefreshSig({ ...base, inventory: [] });
      const charm = professionsRefreshSig({
        ...base,
        inventory: [{ itemId: 'gatherers_cache', count: 1 }],
      });
      const pick = professionsRefreshSig({
        ...base,
        inventory: [{ itemId: 'copper_mining_pick', count: 1 }],
      });
      expect(charm).not.toBe(empty);
      expect(pick).not.toBe(empty);
      // Unrelated loot does NOT move it: the filter keeps ordinary bag churn
      // from thrashing the cold rebuild.
      expect(
        professionsRefreshSig({ ...base, inventory: [{ itemId: 'bone_fragments', count: 5 }] }),
      ).toBe(empty);
    });

    it('the refresh signature moves when a charge is spent', () => {
      // Without the slot rows in the signature the count would freeze at
      // whatever it read when some OTHER field last moved it.
      const before = professionsRefreshSig({
        viewerName: 'Testchar',
        identity: attunedIdentity,
        gathering,
        toolEffects: [slot()],
        inventory: [],
      });
      const after = professionsRefreshSig({
        viewerName: 'Testchar',
        identity: attunedIdentity,
        gathering,
        toolEffects: [slot({ charges: 11 })],
        inventory: [],
      });
      expect(after).not.toBe(before);
      // And it does NOT move for an identical read, so the window is not
      // repainting every frame.
      expect(
        professionsRefreshSig({
          viewerName: 'Testchar',
          identity: attunedIdentity,
          gathering,
          toolEffects: [slot()],
          inventory: [],
        }),
      ).toBe(before);
    });
  });

  it('builds a coherent syncing model from the pre-cprof ClientWorld shape', () => {
    // Online before the first cprof delta: synced false and craftSkills may be
    // an empty record; the window must render a graceful pre-sync state.
    const model = view(identity({ synced: false, craftSkills: {} }));
    expect(model.identity.state).toBe('syncing');
    expect(model.mode).toBe('simplified');
    expect(model.crafts).toHaveLength(10);
    for (const row of model.crafts) expect(row.bar.skill).toBe(0);
    expect(model.simplified).toEqual({
      trendingCraftId: 'engineering',
      nextUnlock: { kind: 'tier', targetTier: 1, pointsRemaining: 25 },
      cta: { kind: 'start' },
      tutorial: { targetSkill: 25 },
    });
    expect(model.ring.pairArc).toBeNull();
    expect(model.ring.hobbyChord).toBeNull();
  });

  it('passes injected gathering rows through in order with their own caps', () => {
    // No hardcoded id set: a fishing row flows through unchanged, and
    // each row derives pips from its own maxSkill. The fixtures carry the
    // RESOLVED content caps (100 gathering, 200 fishing).
    const model = view(attunedIdentity, [
      { professionId: 'herbalism', skill: 55, maxSkill: 100 },
      { professionId: 'fishing', skill: 30, maxSkill: 200 },
    ]);
    expect(model.gathering.map((g) => g.professionId)).toEqual(['herbalism', 'fishing']);
    expect(model.gathering[0].bar).toMatchObject({ pipSlots: 4, tierIndex: 2 });
    expect(model.gathering[1].bar).toMatchObject({ pipSlots: 8, tierIndex: 1 });
  });
});

describe('ring layout', () => {
  it('places ten nodes in CRAFT_RING order at (i/10)*2*PI on the unit circle', () => {
    const nodes = ringNodePositions();
    expect(nodes.map((n) => n.craftId)).toEqual(RING_ORDER);
    expect(RING_STEP_ANGLE).toBeCloseTo((2 * Math.PI) / 10, 12);
    nodes.forEach((node, i) => {
      expect(node.index).toBe(i);
      expect(node.angle).toBeCloseTo((i / 10) * 2 * Math.PI, 12);
      expect(node.x).toBeCloseTo(Math.cos(node.angle), 12);
      expect(node.y).toBeCloseTo(Math.sin(node.angle), 12);
    });
    // Literal spot check so the formula assertions cannot go tautological:
    // inscription (index 5) sits at PI, the far side of the circle.
    expect(nodes[5].angle).toBeCloseTo(Math.PI, 12);
    expect(nodes[5].x).toBeCloseTo(-1, 12);
    expect(nodes[5].y).toBeCloseTo(0, 12);
  });

  it('spans the pair arc over ring-adjacent majors in either given order', () => {
    const arc = buildRingLayout(['armorcrafting', 'weaponcrafting'], null).pairArc;
    expect(arc).toMatchObject({ aIndex: 8, bIndex: 9 });
    expect(arc?.startAngle).toBeCloseTo(8 * RING_STEP_ANGLE, 12);
    expect(arc?.endAngle).toBeCloseTo(9 * RING_STEP_ANGLE, 12);
    // Order-agnostic: the ring-earlier major anchors the arc either way.
    expect(buildRingLayout(['weaponcrafting', 'armorcrafting'], null).pairArc).toEqual(arc);
  });

  it('wraps the armorcrafting+engineering arc to endAngle 2*PI, never 0', () => {
    const arc = buildRingLayout(['armorcrafting', 'engineering'], null).pairArc;
    expect(arc).toMatchObject({ aIndex: 9, bIndex: 0 });
    expect(arc?.startAngle).toBeCloseTo(9 * RING_STEP_ANGLE, 12);
    expect(arc?.endAngle).toBeCloseTo(2 * Math.PI, 12);
    expect(arc && arc.endAngle > arc.startAngle).toBe(true);
  });

  it('arc endpoints land exactly on their nodes (chord-parameterization symmetry)', () => {
    // The chord carries node x/y while the arc carries angles; this proves
    // the two parameterizations describe the same ring points, including the
    // wrap arc whose endAngle 2*PI must land back on node 0, so a painter
    // drawing arc caps and node dots can never misalign them.
    const nodes = ringNodePositions();
    const arc = buildRingLayout(['armorcrafting', 'weaponcrafting'], null).pairArc;
    expect(Math.cos(arc!.startAngle)).toBeCloseTo(nodes[arc!.aIndex].x, 12);
    expect(Math.sin(arc!.startAngle)).toBeCloseTo(nodes[arc!.aIndex].y, 12);
    expect(Math.cos(arc!.endAngle)).toBeCloseTo(nodes[arc!.bIndex].x, 12);
    expect(Math.sin(arc!.endAngle)).toBeCloseTo(nodes[arc!.bIndex].y, 12);
    const wrap = buildRingLayout(['armorcrafting', 'engineering'], null).pairArc;
    expect(Math.cos(wrap!.endAngle)).toBeCloseTo(nodes[wrap!.bIndex].x, 12);
    expect(Math.sin(wrap!.endAngle)).toBeCloseTo(nodes[wrap!.bIndex].y, 12);
  });

  it('yields no arc for non-adjacent majors and no chord without a hobby', () => {
    expect(buildRingLayout(['engineering', 'cooking'], null).pairArc).toBeNull();
    expect(buildRingLayout(null, null).pairArc).toBeNull();
    expect(buildRingLayout(null, null).hobbyChord).toBeNull();
    expect(buildRingLayout(null, 'fishing').hobbyChord).toBeNull();
  });

  it('yields no arc when either major id is unknown to the ring', () => {
    expect(buildRingLayout(['fishing', 'engineering'], null).pairArc).toBeNull();
    expect(buildRingLayout(['engineering', 'fishing'], null).pairArc).toBeNull();
  });

  it('draws the hobby chord from the hobby node to its ring opposite', () => {
    const chord = buildRingLayout(null, 'leatherworking').hobbyChord;
    // leatherworking index 3, opposite (+5 mod 10) weaponcrafting index 8.
    expect(chord).toMatchObject({ hobbyIndex: 3, oppositeIndex: 8 });
    expect(chord?.x1).toBeCloseTo(-0.309017, 5);
    expect(chord?.y1).toBeCloseTo(0.951057, 5);
    expect(chord?.x2).toBeCloseTo(0.309017, 5);
    expect(chord?.y2).toBeCloseTo(-0.951057, 5);
  });

  it('feeds the attuned pair and hobby into the composed model ring', () => {
    const ring = view(attunedIdentity).ring;
    expect(ring.pairArc).toMatchObject({ aIndex: 8, bIndex: 9 });
    expect(ring.hobbyChord).toMatchObject({ hobbyIndex: 3, oppositeIndex: 8 });
  });
});

describe('tier pips and perks', () => {
  // The enforced per-profession content cap the craft rows now derive from
  // (content/professions.ts craftMaxSkillFor). Deliberate literal
  // pin below: silent content drift in the cap must fail here, not re-derive.
  const CRAFT_CAP = craftMaxSkillFor('engineering');

  it('steps tiers at every 25-skill boundary', () => {
    expect(buildSkillBar(24, CRAFT_CAP)).toMatchObject({
      tierIndex: 0,
      filledPips: 0,
      pointsToNextTier: 1,
    });
    expect(buildSkillBar(24, CRAFT_CAP).tierFraction).toBeCloseTo(24 / 25, 12);
    expect(buildSkillBar(25, CRAFT_CAP)).toMatchObject({
      tierIndex: 1,
      filledPips: 1,
      pointsToNextTier: 25,
      tierFraction: 0,
    });
    expect(buildSkillBar(49, CRAFT_CAP)).toMatchObject({ tierIndex: 1, pointsToNextTier: 1 });
    expect(buildSkillBar(50, CRAFT_CAP)).toMatchObject({
      tierIndex: 2,
      pointsToNextTier: 25,
    });
    expect(buildSkillBar(74, CRAFT_CAP)).toMatchObject({ tierIndex: 2, pointsToNextTier: 1 });
    expect(buildSkillBar(75, CRAFT_CAP)).toMatchObject({
      tierIndex: 3,
      pointsToNextTier: 25,
    });
  });

  it('display-floors fractional skill and ceils points-to-go (never a fake crossing)', () => {
    // Fractional mastery gains (0.5 / 0.25 arms) must never round a readout
    // over an uncrossed threshold: 74.75 reads 74 with 1 to go, not 75 with 0.
    expect(buildSkillBar(74.75, CRAFT_CAP)).toMatchObject({
      skill: 74,
      tierIndex: 2,
      pointsToNextTier: 1,
    });
    // The exact fraction still drives the bar geometry.
    expect(buildSkillBar(74.75, CRAFT_CAP).tierFraction).toBeCloseTo(24.75 / 25, 12);
    expect(craftNextUnlock('weaponcrafting', 74.75)).toMatchObject({
      kind: 'specialized',
      pointsRemaining: 1,
    });
    expect(craftNextUnlock('weaponcrafting', 30.5)).toMatchObject({
      kind: 'tier',
      pointsRemaining: 20,
    });
  });

  it('gives 5 pip slots at the 125 craft cap and zero fraction at cap', () => {
    expect(CRAFT_CAP).toBe(125);
    expect(buildSkillBar(0, CRAFT_CAP).pipSlots).toBe(5);
    expect(buildSkillBar(125, CRAFT_CAP)).toMatchObject({
      pipSlots: 5,
      filledPips: 5,
      tierFraction: 0,
    });
  });

  it('derives the overall bar fill in the core from the per-profession cap', () => {
    expect(buildSkillBar(0, CRAFT_CAP).fillFraction).toBe(0);
    // In-range fixture: 60 / 125 = 0.48.
    expect(buildSkillBar(60, CRAFT_CAP).fillFraction).toBeCloseTo(0.48, 12);
    expect(buildSkillBar(125, CRAFT_CAP).fillFraction).toBe(1);
    // Gathering rows use their own resolved maxSkill (fishing caps at 200):
    // 45 / 200 = 0.225.
    expect(buildSkillBar(45, 200).fillFraction).toBeCloseTo(0.225, 12);
  });

  it('saturates pips, fill, and fraction at exactly the cap', () => {
    // The cap is ENFORCED sim-side (wheel.ts gainCraftSkill,
    // normalizeCraftSkills), so the view only ever receives already-clamped
    // values; the bar must read fully saturated at exactly the cap.
    expect(buildSkillBar(CRAFT_CAP, CRAFT_CAP)).toMatchObject({
      pipSlots: 5,
      filledPips: 5,
      tierFraction: 0,
      fillFraction: 1,
    });
  });

  it('flips specialized exactly at the content threshold', () => {
    // Deliberate literal pin: silent content drift in the specialization
    // constants must fail here, not just re-derive.
    expect(PERK_THRESHOLDS.engineering.specializedSkillThreshold).toBe(75);
    expect(PERK_THRESHOLDS.engineering.materialDiscountPct).toBe(0.2);
    const threshold = PERK_THRESHOLDS.engineering.specializedSkillThreshold;
    const below = craftRow(
      view(identity({ craftSkills: { ...ZERO_SKILLS, engineering: threshold - 1 } })),
      'engineering',
    ).perks;
    expect(below.specialized).toBe(false);
    expect(below.materialCostMultiplier).toBe(1);
    const at = craftRow(
      view(identity({ craftSkills: { ...ZERO_SKILLS, engineering: threshold } })),
      'engineering',
    ).perks;
    expect(at.specialized).toBe(true);
    expect(at.materialCostMultiplier).toBeCloseTo(0.8, 12);
    expect(at.specializedSkillThreshold).toBe(threshold);
    expect(at.materialDiscountPct).toBe(PERK_THRESHOLDS.engineering.materialDiscountPct);
  });

  it('pins the perk thresholds uniform across the ring (the single-explainer premise)', () => {
    // The painter's unspecialized explainer renders the FIRST craft row's
    // threshold for all ten crafts; a per-craft divergence must
    // fail here first and force a per-craft explainer.
    const first = PERK_THRESHOLDS[CRAFT_RING[0].id];
    for (const craft of CRAFT_RING) {
      expect(PERK_THRESHOLDS[craft.id]).toEqual(first);
    }
  });
});

describe('craftNextUnlock', () => {
  it('targets the next tier pip while below the specialization window', () => {
    expect(craftNextUnlock('engineering', 10)).toEqual({
      kind: 'tier',
      targetTier: 1,
      pointsRemaining: 15,
    });
    expect(craftNextUnlock('engineering', 49)).toEqual({
      kind: 'tier',
      targetTier: 2,
      pointsRemaining: 1,
    });
  });

  it('targets specialization when the threshold is the next boundary crossed', () => {
    expect(craftNextUnlock('engineering', 50)).toEqual({
      kind: 'specialized',
      pointsRemaining: 25,
      materialDiscountPct: 0.2,
    });
    expect(craftNextUnlock('engineering', 74)).toEqual({
      kind: 'specialized',
      pointsRemaining: 1,
      materialDiscountPct: 0.2,
    });
    // Past the threshold it goes back to plain tier steps.
    expect(craftNextUnlock('engineering', 75)).toEqual({
      kind: 'tier',
      targetTier: 4,
      pointsRemaining: 25,
    });
  });

  it('reports mastered at the content cap and throws on an unknown craft', () => {
    // One below the 125 cap still points at the cap boundary tier (5 pips).
    expect(craftNextUnlock('engineering', 124)).toEqual({
      kind: 'tier',
      targetTier: 5,
      pointsRemaining: 1,
    });
    expect(craftNextUnlock('engineering', craftMaxSkillFor('engineering'))).toEqual({
      kind: 'mastered',
    });
    expect(() => craftNextUnlock('fishing', 0)).toThrow();
  });

  it('stays mastered above the cap, not only exactly at it', () => {
    expect(craftNextUnlock('engineering', craftMaxSkillFor('engineering') + 150)).toEqual({
      kind: 'mastered',
    });
  });

  it('never advertises a milestone above the cap, for any craft and skill', () => {
    // The whole point of the mastered state: below the cap every arm's
    // implied target boundary sits at or under the cap, and at or past the
    // cap the arm is always mastered, never an unreachable carrot.
    for (const craft of CRAFT_RING) {
      const cap = craftMaxSkillFor(craft.id);
      for (let skill = 0; skill < cap; skill++) {
        const unlock = craftNextUnlock(craft.id, skill);
        expect(unlock.kind, `${craft.id} at ${skill}`).not.toBe('mastered');
        if (unlock.kind === 'tier') {
          expect(
            unlock.targetTier * TIER_SKILL_STEP,
            `${craft.id} at ${skill}`,
          ).toBeLessThanOrEqual(cap);
        } else if (unlock.kind === 'specialized') {
          expect(skill + unlock.pointsRemaining, `${craft.id} at ${skill}`).toBeLessThanOrEqual(
            cap,
          );
        }
      }
      expect(craftNextUnlock(craft.id, cap)).toEqual({ kind: 'mastered' });
    }
  });
});

describe('switch cost', () => {
  it('computes 5 + 3 per prior switch, display-only, from switchCount', () => {
    expect(view(identity({ switchCount: 0 })).switchCost.nextSwitchCost).toBe(5);
    expect(view(identity({ switchCount: 1 })).switchCost.nextSwitchCost).toBe(8);
    expect(view(identity({ switchCount: 7 })).switchCost.nextSwitchCost).toBe(26);
  });

  it('surfaces switchCount as returnCount and passes raw amends through', () => {
    const cost = view(attunedIdentity).switchCost;
    expect(cost).toEqual({
      returnCount: 2,
      amendsProgress: 1,
      amendsRequired: 11,
      nextSwitchCost: 11,
      show: true,
    });
  });

  it('hides the switch-cost line until the player has ever attuned', () => {
    // A never-attuned player has
    // no archetype to switch FROM, so the line is noise; any held pair (even
    // after returning to unattuned) keeps it visible.
    expect(view(attunedIdentity).switchCost.show).toBe(true);
    expect(view(identity({ attunedPairs: [] })).switchCost.show).toBe(false);
  });
});

describe('progressive disclosure', () => {
  it('simplifies while unattuned with every craft below tier 1', () => {
    const model = view(identity({ craftSkills: { ...ZERO_SKILLS, cooking: 10 } }));
    expect(model.mode).toBe('simplified');
    expect(model.simplified).not.toBeNull();
  });

  it('goes full when any craft reaches tier 1 while still unattuned', () => {
    const model = view(identity({ craftSkills: { ...ZERO_SKILLS, cooking: 25 } }));
    expect(model.identity.state).toBe('unattuned');
    expect(model.mode).toBe('full');
    expect(model.simplified).toBeNull();
  });

  it('goes full when attuned even with zero skill everywhere', () => {
    const model = view(
      identity({
        activeArchetype: 'armorcrafting',
        pairedMajor: 'weaponcrafting',
        hobbyCraft: 'leatherworking',
        attunedPairs: ['weaponcrafting+armorcrafting'],
      }),
    );
    expect(model.identity.state).toBe('attuned');
    expect(model.mode).toBe('full');
    expect(model.simplified).toBeNull();
  });

  it('simplifies while syncing no matter how high the mirrored skills are', () => {
    const model = view({ ...attunedIdentity, synced: false });
    expect(model.identity.state).toBe('syncing');
    expect(model.mode).toBe('simplified');
    expect(model.simplified).not.toBeNull();
  });

  it('picks the trending craft by highest skill with ring-order ties', () => {
    const tied = view(
      identity({ craftSkills: { ...ZERO_SKILLS, alchemy: 4, cooking: 10, tailoring: 10 } }),
    ).simplified;
    expect(tied?.trendingCraftId).toBe('cooking');
    expect(tied?.nextUnlock).toEqual({ kind: 'tier', targetTier: 1, pointsRemaining: 15 });
    expect(tied?.tutorial).toEqual({ targetSkill: 25 });
  });

  it('derives the cta in the core: start at zero skill, raise once any skill exists', () => {
    // The raise-vs-start choice is model logic, so it is pinned here against
    // both simplified triggers, not decided in the painter.
    expect(view(identity()).simplified?.cta).toEqual({ kind: 'start' });
    expect(
      view(identity({ craftSkills: { ...ZERO_SKILLS, cooking: 10 } })).simplified?.cta,
    ).toEqual({ kind: 'raise', craftId: 'cooking', points: 15 });
    expect(view({ ...attunedIdentity, synced: false }).simplified?.cta.kind).toBe('raise');
  });
});

describe('professionsRefreshSig', () => {
  const gathering = [{ professionId: 'mining', skill: 12, maxSkill: 100 }];
  function input(over: Partial<CraftingIdentityView> = {}): ProfessionsViewInput {
    return {
      viewerName: 'Testchar',
      identity: identity({ craftSkills: { ...ZERO_SKILLS, cooking: 30 }, ...over }),
      gathering,
      toolEffects: [],
      inventory: [],
    };
  }

  it('is stable across rebuilt inputs regardless of record key order', () => {
    const reversedSkills = Object.fromEntries(
      Object.entries({ ...ZERO_SKILLS, cooking: 30 }).reverse(),
    );
    expect(professionsRefreshSig(input())).toBe(
      professionsRefreshSig(input({ craftSkills: reversedSkills })),
    );
    expect(professionsRefreshSig(input(), ['tab:perks'])).toBe(
      professionsRefreshSig(input(), ['tab:perks']),
    );
  });

  it('treats a missing craft key as zero, so a materialized zero never repaints', () => {
    // Pre-sync ClientWorld records may omit zero-skill keys entirely; the
    // CRAFT_RING enumeration with ?? 0 must make {} and explicit zeros equal.
    expect(
      professionsRefreshSig({
        viewerName: 'Testchar',
        identity: identity({ craftSkills: { cooking: 30 } }),
        gathering,
        toolEffects: [],
        inventory: [],
      }),
    ).toBe(professionsRefreshSig(input()));
  });

  it('moves when any single repaint dimension moves', () => {
    const base = professionsRefreshSig(input());
    expect(professionsRefreshSig(input({ craftSkills: { ...ZERO_SKILLS, cooking: 31 } }))).not.toBe(
      base,
    );
    expect(professionsRefreshSig(input({ activeArchetype: 'armorcrafting' }))).not.toBe(base);
    expect(professionsRefreshSig(input({ pairedMajor: 'weaponcrafting' }))).not.toBe(base);
    expect(professionsRefreshSig(input({ hobbyCraft: 'cooking' }))).not.toBe(base);
    expect(
      professionsRefreshSig(input({ attunedPairs: ['weaponcrafting+armorcrafting'] })),
    ).not.toBe(base);
    expect(professionsRefreshSig(input({ switchCount: 1 }))).not.toBe(base);
    expect(professionsRefreshSig(input({ amendsProgress: 3 }))).not.toBe(base);
    expect(professionsRefreshSig(input({ amendsRequired: 9 }))).not.toBe(base);
    expect(professionsRefreshSig(input({ synced: false }))).not.toBe(base);
    expect(
      professionsRefreshSig({
        ...input(),
        gathering: [{ professionId: 'mining', skill: 13, maxSkill: 100 }],
      }),
    ).not.toBe(base);
    expect(
      professionsRefreshSig({
        ...input(),
        gathering: [...gathering, { professionId: 'fishing', skill: 0, maxSkill: 200 }],
      }),
    ).not.toBe(base);
    expect(professionsRefreshSig(input(), ['craft:alchemy'])).not.toBe(base);
    // The gathering cap is its own repaint dimension (gathering rows may cap
    // differently), so a cap move alone must move the signature.
    expect(
      professionsRefreshSig({
        ...input(),
        gathering: [{ professionId: 'mining', skill: 12, maxSkill: 200 }],
      }),
    ).not.toBe(base);
  });
});

describe('identity semantics survive composition', () => {
  it('keeps every role and ceiling on the composed craft rows', () => {
    const model = view(attunedIdentity);
    expect(craftRow(model, 'armorcrafting').identity).toMatchObject({
      role: 'major',
      ceiling: 'unlimited',
      tier: 1,
      pointsToNextTier: 1,
    });
    expect(craftRow(model, 'weaponcrafting').identity).toMatchObject({
      role: 'major',
      ceiling: 'unlimited',
    });
    expect(craftRow(model, 'leatherworking').identity).toMatchObject({
      role: 'hobby',
      ceiling: 'rare',
    });
    expect(craftRow(model, 'jewelcrafting').identity).toMatchObject({
      role: 'dormant',
      ceiling: 'common',
      dormantKnowledge: true,
    });
  });

  it('marks every craft unattuned with the rare ceiling before attunement', () => {
    const model = view(identity({ craftSkills: { ...ZERO_SKILLS, cooking: 30 } }));
    for (const row of model.crafts) {
      expect(row.identity.role).toBe('unattuned');
      expect(row.identity.ceiling).toBe('rare');
    }
  });

  it('carries the nearTier and dormantKnowledge nudges into the model', () => {
    const nudges = view(attunedIdentity).identity.nudges;
    expect(nudges).toContainEqual({ type: 'nearTier', craftId: 'armorcrafting', points: 1 });
    expect(nudges).toContainEqual({ type: 'dormantKnowledge', craftId: 'jewelcrafting' });
  });

  it('keeps the tutorial line until any craft reaches tier 1, then drops it', () => {
    expect(
      view(identity({ craftSkills: { ...ZERO_SKILLS, cooking: 24 } })).identity.tutorial,
    ).toEqual({ targetSkill: 25 });
    expect(view(attunedIdentity).identity.tutorial).toBeNull();
  });
});
