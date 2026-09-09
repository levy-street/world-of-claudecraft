import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// RED-by-construction: src/sim/professions/corpse_harvest_grant.ts does not
// exist yet. This suite pins the proposed leaf's contract (PR3 prep, timed
// harvest seam) so the extraction from src/sim/interaction.ts harvestCorpse
// is move-not-rewrite: same reserved capacity math, same draw order, same
// grant order, same claim-timing change (claim spends only AFTER the
// ordinary grants land, never before). The `soloRig`/`duoRig` fixtures below
// (construction order, corpse placement, seeds 3/6/15/30) are copied from
// tests/corpse_harvest_sim.test.ts's own `setup()`/`soloRig()` so this suite
// draws from the SAME rng stream position that file's pinned literals were
// measured against; the specific numeric/event pins on the seed 6, 15 and 30
// cases below are lifted verbatim from that file. Everywhere else this
// suite feeds `grantCorpseHarvest`/`corpseHarvestOrdinaryYields` SYNTHETIC
// `componentTags` directly (never read off a real `MOBS` template), which is
// deliberate: this is an internal completion helper, and the wired caller
// (interaction.ts) owns validating that real corpse/template data before it
// ever reaches here.
import { bagCapacity } from '../src/sim/bags';
import { MONSTER_MATERIAL_TIERS } from '../src/sim/content/professions';
import { BUILTIN_WORLD, ITEMS, MOBS, setActiveWorldContent } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  type CorpseHarvestGrantInputs,
  corpseHarvestOrdinaryYields,
  grantCorpseHarvest,
  snapshotCorpseHarvestGrantInputs,
} from '../src/sim/professions/corpse_harvest_grant';
import type { FocusAllocation } from '../src/sim/professions/focus';
import { TIER3_TOOL_WIELD_PROFICIENCY } from '../src/sim/professions/wield_gate';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, WorldContent } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

type SimInternals = {
  entities: Map<number, Entity>;
  players: Map<number, PlayerMeta>;
};

// Same world-content pin as tests/corpse_harvest_sim.test.ts: harvest tests
// preserve the built-in spawn tables (seed draws include world-gen), roads
// stripped because they are unrelated and expensive to rebuild per probe.
const CORPSE_TEST_WORLD: WorldContent = { ...BUILTIN_WORLD, roads: [] };

function mustPlayer(internals: SimInternals, pid: number): PlayerMeta {
  const meta = internals.players.get(pid);
  if (!meta) throw new Error(`missing player ${pid}`);
  return meta;
}

/** One-player rig, matching tests/corpse_harvest_sim.test.ts's soloRig(): the
 *  pinned seeds below (15, 30) were hunted against exactly this construction
 *  order (one addPlayer, one corpse), and a second player would shift every
 *  draw after it. Also exposes `ctx` (SimContext), which the proposed leaf
 *  takes directly instead of going through sim.harvestCorpse. */
function soloRig(seed: number, templateId = 'forest_wolf', corpseId = 9999) {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: CORPSE_TEST_WORLD });
  const internals = sim as unknown as SimInternals;
  const a = sim.addPlayer('warrior', 'Alpha');
  sim.tick();
  const e = expectDefined(internals.entities.get(a));
  e.pos = { x: 0, y: 0, z: 0 };
  e.prevPos = { x: 0, y: 0, z: 0 };
  const template = MOBS[templateId];
  const mob = createMob(corpseId, template, template.maxLevel, { x: 0, y: 0, z: 0 });
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  internals.entities.set(mob.id, mob);
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  return { sim, internals, a, mob, ctx };
}

// Two-player rig, matching tests/corpse_harvest_sim.test.ts's setup(): the
// seeds 3, 6 and 30 below were pinned against THIS construction order (two
// addPlayer calls before the corpse harvest), so the two rigs are not
// interchangeable per seed.
function duoRig(seed: number, templateId = 'forest_wolf', corpseId = 9999) {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: CORPSE_TEST_WORLD });
  const internals = sim as unknown as SimInternals;
  const a = sim.addPlayer('warrior', 'Alpha');
  const b = sim.addPlayer('warrior', 'Bravo');
  sim.tick();
  for (const pid of [a, b]) {
    const e = expectDefined(internals.entities.get(pid));
    e.pos = { x: 0, y: 0, z: 0 };
    e.prevPos = { x: 0, y: 0, z: 0 };
  }
  const template = MOBS[templateId];
  const mob = createMob(corpseId, template, template.maxLevel, { x: 0, y: 0, z: 0 });
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  internals.entities.set(mob.id, mob);
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  return { sim, internals, a, b, mob, ctx };
}

// Fill every free slot with distinct 1-per-slot gear (tests/bags.test.ts /
// corpse_harvest_sim.test.ts fillBags idiom).
function fillBags(sim: Sim, internals: SimInternals, pid: number): void {
  const m = expectDefined(internals.players.get(pid));
  const cap = bagCapacity(m.bags);
  const gearIds = Object.values(ITEMS)
    .filter((d) => d.kind === 'weapon' || d.kind === 'armor')
    .map((d) => d.id);
  let i = 0;
  while (m.inventory.length < cap) {
    sim.addItem(gearIds[i % gearIds.length], 1, pid);
    i++;
  }
}

// The narrow, restored-in-finally content mutation seam tests/corpse_harvest_sim.test.ts
// uses to drive the premium-arm tool-gating deny path on real content (every
// shipped family ships at MONSTER_MATERIAL_TIERS 1, the wave-one prime
// directive), reproduced here for the frozen-tool-tier suite below.
function withTier(component: string, tier: number, body: () => void): void {
  const tiers = MONSTER_MATERIAL_TIERS as Record<string, number>;
  const prior = tiers[component];
  tiers[component] = tier;
  try {
    body();
  } finally {
    if (prior === undefined) delete tiers[component];
    else tiers[component] = prior;
  }
}

beforeAll(() => setActiveWorldContent(CORPSE_TEST_WORLD));
afterAll(() => setActiveWorldContent(null));

describe('corpseHarvestOrdinaryYields: pure reserved-capacity ledger (no rng)', () => {
  it('reserves the legendary-tier max per yielding component, in tag order, unfocused', () => {
    // forest_wolf: hide -> rough_hide, fang -> wolf_fang (tests/corpse_harvest_sim.test.ts
    // "grants the mapped component item only to the winner"). harvestTierQuantity('legendary') = 6,
    // and an empty townFocus leaves applyFocusBonus unchanged.
    const inputs: CorpseHarvestGrantInputs = {
      componentTags: ['hide', 'fang'],
      chosenComponents: [],
      townFocus: {},
      bestAnyToolTier: 1,
    };
    expect(corpseHarvestOrdinaryYields(inputs)).toEqual([
      { itemId: 'rough_hide', count: 6 },
      { itemId: 'wolf_fang', count: 6 },
    ]);
  });

  it('coalesces a duplicate tag mapping to the same item into one reserved slot', () => {
    const inputs: CorpseHarvestGrantInputs = {
      componentTags: ['hide', 'hide'],
      chosenComponents: [],
      townFocus: {},
      bestAnyToolTier: 1,
    };
    // Two 'hide' extractions, each reserving 6: one slot, summed count.
    expect(corpseHarvestOrdinaryYields(inputs)).toEqual([{ itemId: 'rough_hide', count: 12 }]);
  });

  it('a tag with no item behind it costs no reserved slot at all', () => {
    const inputs: CorpseHarvestGrantInputs = {
      componentTags: ['hide', 'not_a_real_family'],
      chosenComponents: [],
      townFocus: {},
      bestAnyToolTier: 1,
    };
    expect(corpseHarvestOrdinaryYields(inputs)).toEqual([{ itemId: 'rough_hide', count: 6 }]);
  });

  it('a concentrated pick still reserves the SAME legendary-tier max (the roll ceiling never moves)', () => {
    // Concentration (#1142/#2514) shifts the ROLLED tier upward; the pre-gate
    // always reserves the top of the ladder regardless of concentration, so a
    // concentrated pick and the spread pick reserve identically here.
    const spread: CorpseHarvestGrantInputs = {
      componentTags: ['hide', 'fang'],
      chosenComponents: [],
      townFocus: {},
      bestAnyToolTier: 1,
    };
    const concentrated: CorpseHarvestGrantInputs = {
      componentTags: ['hide', 'fang'],
      chosenComponents: ['hide'],
      townFocus: {},
      bestAnyToolTier: 1,
    };
    expect(corpseHarvestOrdinaryYields(concentrated)).toEqual([{ itemId: 'rough_hide', count: 6 }]);
    expect(corpseHarvestOrdinaryYields(spread)).toContainEqual({ itemId: 'rough_hide', count: 6 });
  });

  it('town focus raises the reserved max (applyFocusBonus), never lowers it below the unfocused floor', () => {
    // FOCUS_YIELD_BONUS_PER_POINT = 0.1: 10 points on hide is +100% of the
    // legendary-tier base (6), so the reserved max is 12, not 6.
    const focused: FocusAllocation = { hide: 10 };
    const inputs: CorpseHarvestGrantInputs = {
      componentTags: ['hide'],
      chosenComponents: [],
      townFocus: focused,
      bestAnyToolTier: 1,
    };
    expect(corpseHarvestOrdinaryYields(inputs)).toEqual([{ itemId: 'rough_hide', count: 12 }]);
  });

  it('bestAnyToolTier plays no part in the reserved capacity (the tool gate only ever downgrades a jackpot)', () => {
    const lowTool: CorpseHarvestGrantInputs = {
      componentTags: ['hide'],
      chosenComponents: [],
      townFocus: {},
      bestAnyToolTier: 1,
    };
    const highTool: CorpseHarvestGrantInputs = { ...lowTool, bestAnyToolTier: 5 };
    expect(corpseHarvestOrdinaryYields(lowTool)).toEqual(corpseHarvestOrdinaryYields(highTool));
  });
});

describe('snapshotCorpseHarvestGrantInputs: clones every field, draws no rng', () => {
  it('mutating the original tags/chosen arrays and townFocus after the call leaves the snapshot untouched', () => {
    const { sim, mob, a, ctx } = soloRig(11);
    const meta = mustPlayer(sim as unknown as SimInternals, a);
    meta.townFocus = { hide: 1 };
    const tags = ['hide'];
    const chosen = ['hide'];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    const snapshot = snapshotCorpseHarvestGrantInputs(meta, tags, chosen);
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
    // Mutate every source AFTER the snapshot: the original arrays in place,
    // and meta.townFocus both by reassignment and (the stronger claim) by
    // mutating the SAME object the snapshot was built from.
    tags.push('fang');
    chosen.push('fang');
    meta.townFocus.hide = 99;
    meta.townFocus = { hide: 99, fang: 99 };
    expect(snapshot.componentTags).toEqual(['hide']);
    expect(snapshot.chosenComponents).toEqual(['hide']);
    expect(snapshot.townFocus).toEqual({ hide: 1 });
    // The snapshot is what a grant actually runs against; confirm the mutated
    // sources never reach it by checking the grant uses the frozen 'hide' set,
    // not the mutated ['hide','fang'] one (which would also try to extract fang).
    const granted = grantCorpseHarvest(ctx, mob, meta, snapshot);
    expect(granted).toBe(true);
    expect(sim.countItem('wolf_fang', a)).toBe(0);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThan(0);
  });

  it('captures the wield-requirement denial hint at admission; a later tool change never reaches the emitted event', () => {
    // Seed 15 / hide, raised to material tier 2 (the same pin family as the
    // frozen-bestAnyToolTier suite below): a tool OWNED but not yet WIELDABLE
    // (proficiency unmet) gives minWieldRequirementToWorkAny a real, useful
    // answer (the R22 wield-split hint) while bestWieldableAnyGatherToolTier
    // still floors the wield-filtered scan at 1, so the roll is still denied.
    const { sim, mob, a, ctx } = soloRig(15);
    const meta = mustPlayer(sim as unknown as SimInternals, a);
    // Owned but not wielded: no gatheringProficiency.mining set, so this pick
    // does not clear the wield gate and bestAnyToolTier stays 1.
    sim.addItem('mithril_mining_pick', 1, a);
    const snapshot = snapshotCorpseHarvestGrantInputs(meta, ['hide'], ['hide']);
    expect(snapshot.bestAnyToolTier).toBe(1);
    expect(snapshot.wieldRequirementByComponent?.hide).toBe(TIER3_TOOL_WIELD_PROFICIENCY);
    // Mutate the LIVE state AFTER the snapshot, in the direction a live scan
    // would answer DIFFERENTLY: strip the tool entirely, so a live rescan at
    // grant time would find nothing (null) instead of the frozen 70.
    meta.inventory.length = 0;
    sim.drainEvents();
    let granted = false;
    withTier('hide', 2, () => {
      granted = grantCorpseHarvest(ctx, mob, meta, snapshot);
    });
    const denied = sim
      .drainEvents()
      .filter((e): e is Extract<typeof e, { type: 'gatherDenied' }> => e.type === 'gatherDenied');
    expect(granted).toBe(true);
    // The frozen hint survives the live removal: still 70, never absent.
    expect(denied).toEqual([
      { type: 'gatherDenied', pid: a, surface: 'corpse', requiredTier: 2, wieldProficiency: 70 },
    ]);
  });
});

describe('grantCorpseHarvest: capacity refusal draws no rng and spends no claim', () => {
  it('a full-bags player is refused, draws zero rng, and the corpse stays unclaimed', () => {
    const { sim, internals, mob, a, ctx } = soloRig(11);
    fillBags(sim, internals, a);
    const meta = mustPlayer(internals, a);
    const inputs: CorpseHarvestGrantInputs = {
      componentTags: expectDefined(MOBS.forest_wolf.componentTags),
      chosenComponents: [],
      townFocus: meta.townFocus,
      bestAnyToolTier: 1,
    };
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    const granted = grantCorpseHarvest(ctx, mob, meta, inputs);
    sim.rng.setObserver(null);
    expect(granted).toBe(false);
    expect(draws).toBe(0);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(sim.countItem('rough_hide', a)).toBe(0);
    expect(sim.countItem('wolf_fang', a)).toBe(0);
  });

  it('a corpse whose every tag maps to no item is refused pre-claim, drawing nothing (#2513)', () => {
    // A tagged "corpse" (in these inputs, entirely synthetic) that carries
    // only families with no item behind it is refused before any roll, the
    // same pre-claim gate an all-unmapped shipped template would hit
    // (isHarvestableCorpse; see tests/corpse_harvest_sim.test.ts "#2513").
    const { sim, mob, a, ctx } = soloRig(11);
    const meta = mustPlayer(sim as unknown as SimInternals, a);
    const inputs: CorpseHarvestGrantInputs = {
      componentTags: ['not_a_real_family'],
      chosenComponents: [],
      townFocus: {},
      bestAnyToolTier: 1,
    };
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    const granted = grantCorpseHarvest(ctx, mob, meta, inputs);
    sim.rng.setObserver(null);
    expect(granted).toBe(false);
    expect(draws).toBe(0);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(sim.drainEvents()).toEqual([
      { type: 'error', pid: a, text: 'That corpse has nothing to harvest.' },
    ]);
  });
});

describe('grantCorpseHarvest: frozen inputs, never the live meta at grant time', () => {
  it('the frozen town focus decides the grant; a later change to meta.townFocus is inert (seed 3)', () => {
    // Two otherwise-identical runs at the same seed and inputs, differing only
    // in whether meta.townFocus is mutated AFTER the frozen inputs snapshot is
    // taken. If the leaf reads meta.townFocus live (a bug this seam exists to
    // prevent), the mutated run would diverge from the untouched one; reading
    // only the frozen `inputs.townFocus` makes the two runs byte-identical.
    const run = (mutateLiveFocusAfterSnapshot: boolean) => {
      const { sim, mob, a, ctx } = soloRig(3);
      const meta = mustPlayer(sim as unknown as SimInternals, a);
      const inputs: CorpseHarvestGrantInputs = {
        componentTags: ['hide'],
        chosenComponents: ['hide'],
        townFocus: {},
        bestAnyToolTier: 1,
      };
      if (mutateLiveFocusAfterSnapshot) meta.townFocus = { hide: 10 };
      const granted = grantCorpseHarvest(ctx, mob, meta, inputs);
      return {
        granted,
        inventory: structuredClone(meta.inventory),
        rough: sim.countItem('rough_hide', a),
      };
    };
    const withLiveMutation = run(true);
    const withoutLiveMutation = run(false);
    // Non-vacuity floor: both runs must actually succeed and actually grant
    // something, or the equality below would hold trivially on two no-ops.
    expect(withLiveMutation.granted).toBe(true);
    expect(withoutLiveMutation.granted).toBe(true);
    expect(withoutLiveMutation.rough).toBeGreaterThan(0);
    expect(withLiveMutation.rough).toBe(withoutLiveMutation.rough);
    expect(withLiveMutation.inventory).toEqual(withoutLiveMutation.inventory);
  });

  it('the frozen bestAnyToolTier decides the premium arm; a later tool upgrade is inert (seed 15)', () => {
    // Baseline pin (tests/corpse_harvest_sim.test.ts "corpse premium-arm tool
    // gating", soloRig(15)): the hide rarity roll clears the signable floor
    // with a 6-unit tier and hide raised to material tier 2. bestAnyToolTier
    // frozen at 1 (bare hands) must deny the premium arm and downgrade to the
    // plain 6-unit grant, EVEN when the live inventory picks up a wieldable
    // tier-3 tool after the inputs were captured.
    const run = (grantWieldableTierThreeToolAfterSnapshot: boolean) => {
      const { sim, mob, a, ctx } = soloRig(15);
      const meta = mustPlayer(sim as unknown as SimInternals, a);
      const inputs: CorpseHarvestGrantInputs = {
        componentTags: ['hide'],
        chosenComponents: ['hide'],
        townFocus: {},
        bestAnyToolTier: 1, // frozen bare-hands floor, captured before any tool change
      };
      if (grantWieldableTierThreeToolAfterSnapshot) {
        sim.addItem('mithril_mining_pick', 1, a);
        meta.gatheringProficiency.mining = TIER3_TOOL_WIELD_PROFICIENCY;
      }
      sim.drainEvents();
      let granted = false;
      withTier('hide', 2, () => {
        granted = grantCorpseHarvest(ctx, mob, meta, inputs);
      });
      const events = sim.drainEvents();
      return {
        granted,
        pid: a,
        rough: sim.countItem('rough_hide', a),
        pristine: sim.countItem('pristine_hide', a),
        denied: events.filter((e) => e.type === 'gatherDenied'),
      };
    };
    const withoutLiveUpgrade = run(false);
    const withLiveUpgrade = run(true);
    // Both runs are byte-identical: the live tool upgrade never reaches the grant.
    expect(withLiveUpgrade).toEqual(withoutLiveUpgrade);
    expect(withoutLiveUpgrade.granted).toBe(true);
    expect(withoutLiveUpgrade.pristine).toBe(0);
    expect(withoutLiveUpgrade.rough).toBe(6);
    expect(withoutLiveUpgrade.denied).toEqual([
      {
        type: 'gatherDenied',
        pid: withoutLiveUpgrade.pid,
        surface: 'corpse',
        requiredTier: 2,
      },
    ]);
  });

  it('a frozen bestAnyToolTier that already covers the raised material tier grants the premium arm (seed 15)', () => {
    // The mirror image: freeze bestAnyToolTier at 2 (as if the tool were held
    // at cast start) while the LIVE inventory carries no gathering tool at
    // all. The premium arm must still succeed off the frozen value.
    const { sim, mob, a, ctx } = soloRig(15);
    const meta = mustPlayer(sim as unknown as SimInternals, a);
    const inputs: CorpseHarvestGrantInputs = {
      componentTags: ['hide'],
      chosenComponents: ['hide'],
      townFocus: {},
      bestAnyToolTier: 2, // frozen as though covering, though nothing is actually carried
    };
    sim.drainEvents();
    let granted = false;
    withTier('hide', 2, () => {
      granted = grantCorpseHarvest(ctx, mob, meta, inputs);
    });
    const events = sim.drainEvents();
    expect(granted).toBe(true);
    expect(events.some((e) => e.type === 'gatherDenied')).toBe(false);
    expect(sim.countItem('rough_hide', a)).toBe(6);
    const specimen = meta.inventory.find((s) => s.itemId === 'pristine_hide');
    expect(specimen?.materialSources).toEqual([{ source: { signer: 'Alpha' }, count: 1 }]);
  });
});

describe('grantCorpseHarvest: signed components share compatible material-stack room (#2139)', () => {
  it('a slot-full signed-family harvest keeps its source mark in a compatible stack (seed 30)', () => {
    // Pin lifted verbatim from tests/corpse_harvest_sim.test.ts (same describe
    // title): a genuinely full bag with a compatible ('wolf_fang', unsigned)
    // partial stack absorbs the signed roll into the SAME slot rather than
    // needing a free one, and both source buckets survive the merge.
    const { sim, internals, mob, a, ctx } = duoRig(30);
    fillBags(sim, internals, a);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
    expect(m.inventory.length).toBe(cap);
    const inputs: CorpseHarvestGrantInputs = {
      componentTags: expectDefined(MOBS.forest_wolf.componentTags),
      chosenComponents: ['fang'],
      townFocus: {},
      bestAnyToolTier: 1,
    };
    sim.drainEvents();
    const granted = grantCorpseHarvest(ctx, mob, m, inputs);
    expect(granted).toBe(true);
    expect(mob.harvestClaimedBy).toBe(a);
    // Conserved bag count: the signed roll topped up the existing compatible
    // wolf_fang slot rather than opening a new one, so the bag stays exactly
    // at capacity, not merely under it.
    expect(m.inventory.length).toBe(cap);
    // Exactly one wolf_fang row (the merge target), never a second slot the
    // signed units could have landed in beside it.
    const fangRows = m.inventory.filter((s) => s.itemId === 'wolf_fang');
    expect(fangRows).toHaveLength(1);
    const fang = fangRows[0];
    expect(fang.count).toBe(3);
    expect(fang.instance).toBeUndefined();
    expect(fang.materialSources).toEqual([
      { source: {}, count: 1 },
      { source: { signer: 'Alpha' }, count: 2 },
    ]);
    expect(sim.countItem('wolf_fang', a)).toBe(3);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toHaveLength(0);
  });
});

describe('grantCorpseHarvest: an optional specimen never displaces a reserved ordinary slot', () => {
  it('with exactly the reserved plain-stack slots, the jackpot truncates, never the plain yield (seed 6)', () => {
    // Pin lifted verbatim from tests/corpse_harvest_sim.test.ts "two-specimen-family
    // harvest capacity contract": wild_boar carries three mapped families
    // (hide, tusk, meat), so the pre-gate reserves exactly three plain-stack
    // slots. With precisely three free slots, all three plain yields must
    // land and the optional pristine_hide specimen must truncate instead of
    // stealing the last slot from a later family's plain grant.
    const { sim, internals, a, ctx } = duoRig(6, 'wild_boar', 8888);
    const boar = expectDefined(internals.entities.get(8888));
    expect(MOBS.wild_boar.componentTags).toEqual(['hide', 'tusk', 'meat']);
    fillBags(sim, internals, a);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    m.inventory.length = cap - 3; // exactly the three reserved plain-stack slots
    const inputs: CorpseHarvestGrantInputs = {
      componentTags: expectDefined(MOBS.wild_boar.componentTags),
      chosenComponents: [],
      townFocus: {},
      bestAnyToolTier: 1,
    };
    sim.drainEvents();
    const granted = grantCorpseHarvest(ctx, boar, m, inputs);
    expect(granted).toBe(true);
    expect(boar.harvestClaimedBy).toBe(a);
    expect(m.inventory.length).toBeLessThanOrEqual(cap);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('curved_tusk', a)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('game_meat', a)).toBeGreaterThanOrEqual(1);
    expect(m.inventory.some((s) => s.itemId === 'pristine_hide')).toBe(false);
  });

  it('with one genuinely spare slot beyond the reservation, the jackpot lands beside every plain yield (seed 6)', () => {
    const { sim, internals, a, ctx } = duoRig(6, 'wild_boar', 8888);
    const boar = expectDefined(internals.entities.get(8888));
    fillBags(sim, internals, a);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    m.inventory.length = cap - 4; // four free slots: one genuinely spare beyond the three reserved
    const inputs: CorpseHarvestGrantInputs = {
      componentTags: expectDefined(MOBS.wild_boar.componentTags),
      chosenComponents: [],
      townFocus: {},
      bestAnyToolTier: 1,
    };
    const granted = grantCorpseHarvest(ctx, boar, m, inputs);
    expect(granted).toBe(true);
    expect(m.inventory.length).toBeLessThanOrEqual(cap);
    const specimen = m.inventory.find((s) => s.itemId === 'pristine_hide');
    expect(specimen?.materialSources).toEqual([{ source: { signer: 'Alpha' }, count: 1 }]);
  });
});

describe('grantCorpseHarvest: claim timing, ledger, and no-regrant', () => {
  it('sets harvestClaimedBy only AFTER the ordinary grants land, never while they are landing', () => {
    const { sim, mob, a, ctx } = soloRig(11);
    const meta = mustPlayer(sim as unknown as SimInternals, a);
    const inputs: CorpseHarvestGrantInputs = {
      componentTags: expectDefined(MOBS.forest_wolf.componentTags),
      chosenComponents: [],
      townFocus: {},
      bestAnyToolTier: 1,
    };
    const claimSeenDuringOrdinaryGrants: (number | null)[] = [];
    const realAddItem = ctx.addItem.bind(ctx);
    const spy = vi
      .spyOn(ctx, 'addItem')
      .mockImplementation((...args: Parameters<typeof realAddItem>) => {
        claimSeenDuringOrdinaryGrants.push(mob.harvestClaimedBy);
        return realAddItem(...args);
      });
    const granted = grantCorpseHarvest(ctx, mob, meta, inputs);
    spy.mockRestore();
    expect(granted).toBe(true);
    // At least one ordinary grant call happened (forest_wolf yields hide and
    // fang), and every one of them observed the claim still unset.
    expect(claimSeenDuringOrdinaryGrants.length).toBeGreaterThan(0);
    expect(claimSeenDuringOrdinaryGrants.every((seen) => seen === null)).toBe(true);
    // Only AFTER every ordinary grant call returned is the claim set.
    expect(mob.harvestClaimedBy).toBe(a);
  });

  it('a successful ordinary grant spends the claim even when the optional specimen cannot fit', () => {
    // seed 30 / hide focus is the suite's own signable-plus-truncation rig
    // ("a slot-full specimen harvest truncates the specimen and keeps the
    // plain yield", tests/corpse_harvest_sim.test.ts): the plain component
    // fills the only remaining room, so the specimen guard sees a full bag
    // and truncates while the ordinary grant (and the claim) still lands.
    const { sim, internals, mob, a, ctx } = duoRig(30);
    fillBags(sim, internals, a);
    const m = expectDefined(internals.players.get(a));
    const cap = bagCapacity(m.bags);
    m.inventory[0] = { itemId: 'rough_hide', count: 1 };
    expect(m.inventory.length).toBe(cap);
    const inputs: CorpseHarvestGrantInputs = {
      componentTags: expectDefined(MOBS.forest_wolf.componentTags),
      chosenComponents: ['hide'],
      townFocus: {},
      bestAnyToolTier: 1,
    };
    sim.drainEvents();
    const granted = grantCorpseHarvest(ctx, mob, m, inputs);
    expect(granted).toBe(true);
    expect(mob.harvestClaimedBy).toBe(a);
    // The plain top-up merged into the existing rough_hide row: exactly one
    // row, and the bag stays exactly at capacity (never opens a new slot for
    // the truncated specimen, which the assertion below confirms never landed).
    expect(m.inventory.length).toBe(cap);
    const roughRows = m.inventory.filter((s) => s.itemId === 'rough_hide');
    expect(roughRows).toHaveLength(1);
    expect(roughRows[0].count).toBeGreaterThan(1);
    expect(m.inventory.some((s) => s.itemId === 'pristine_hide')).toBe(false);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThan(1);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toEqual([
      { type: 'gatherDowngrade', pid: a, surface: 'corpse', lost: 'find' },
    ]);
  });

  it('spends the claim exactly once: a repeated call is refused, draws nothing, and grants nothing again', () => {
    const { sim, mob, a, ctx } = soloRig(11);
    const meta = mustPlayer(sim as unknown as SimInternals, a);
    const inputs: CorpseHarvestGrantInputs = {
      componentTags: expectDefined(MOBS.forest_wolf.componentTags),
      chosenComponents: [],
      townFocus: {},
      bestAnyToolTier: 1,
    };
    sim.drainEvents();
    const granted1 = grantCorpseHarvest(ctx, mob, meta, inputs);
    expect(granted1).toBe(true);
    expect(mob.harvestClaimedBy).toBe(a);
    const afterFirst = structuredClone(meta.inventory);
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    const granted2 = grantCorpseHarvest(ctx, mob, meta, inputs);
    sim.rng.setObserver(null);
    expect(granted2).toBe(false);
    expect(draws).toBe(0);
    expect(meta.inventory).toEqual(afterFirst);
    expect(sim.drainEvents()).toEqual([
      { type: 'error', pid: a, text: 'This corpse has already been harvested.' },
    ]);
  });

  it('emits harvestResult exactly once, on the granting call only', () => {
    const { sim, mob, a, ctx } = soloRig(11);
    const meta = mustPlayer(sim as unknown as SimInternals, a);
    const inputs: CorpseHarvestGrantInputs = {
      componentTags: expectDefined(MOBS.forest_wolf.componentTags),
      chosenComponents: [],
      townFocus: {},
      bestAnyToolTier: 1,
    };
    sim.drainEvents();
    grantCorpseHarvest(ctx, mob, meta, inputs);
    const firstEvents = sim.drainEvents();
    expect(firstEvents.filter((e) => e.type === 'harvestResult')).toHaveLength(1);
    grantCorpseHarvest(ctx, mob, meta, inputs);
    const secondEvents = sim.drainEvents();
    expect(secondEvents.filter((e) => e.type === 'harvestResult')).toHaveLength(0);
  });
});
