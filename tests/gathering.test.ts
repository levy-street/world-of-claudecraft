import { describe, expect, it } from 'vitest';
import { HARVEST_COMPONENT_ITEMS } from '../src/sim/content/professions';
import { MOBS } from '../src/sim/data';
import { isTownFocusComponent, TOWN_FOCUS_COMPONENTS } from '../src/sim/professions/focus';
import {
  effectiveFocusComponents,
  forfeitsEveryMappedYield,
  harvestConcentrationBonus,
  harvestFamilyYieldsItem,
  harvestItemForFamily,
  harvestTierQuantity,
  isHarvestableCorpse,
  resolveCorpseFocusHarvest,
  resolveCorpseHarvest,
  yieldingFocusComponents,
} from '../src/sim/professions/gathering';
import { Rng } from '../src/sim/rng';

/** Every subset of a corpse's tags, in tag order, the empty pick included. */
function subsetsOf(tags: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let mask = 0; mask < 1 << tags.length; mask++) {
    out.push(tags.filter((_, i) => (mask >> i) & 1));
  }
  return out;
}

const TIER_INDEX: Record<string, number> = {
  poor: 0,
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

describe('resolveCorpseHarvest: single-use, first-come corpse claim', () => {
  it('lets the first attempt against an unclaimed corpse succeed', () => {
    const claim = resolveCorpseHarvest(null, 1);
    expect(claim).toEqual({ success: true, claimedBy: 1 });
  });

  it('denies a second attempt once the corpse is claimed', () => {
    const first = resolveCorpseHarvest(null, 1);
    const second = resolveCorpseHarvest(first.claimedBy, 2);
    expect(second).toEqual({ success: false, claimedBy: 1 });
  });

  it('denies a later solo attempt against an already-claimed corpse', () => {
    const claim = resolveCorpseHarvest(7, 42);
    expect(claim).toEqual({ success: false, claimedBy: 7 });
  });

  it('is deterministic regardless of call order for the same starting state', () => {
    // Two independent resolutions against the SAME unclaimed state, in either
    // order, always produce "first caller wins, second caller denied": the
    // function itself has no hidden state to make order matter beyond whichever
    // caller happens to run it first against the still-null corpse.
    const runA = () => {
      const a = resolveCorpseHarvest(null, 10);
      const b = resolveCorpseHarvest(a.claimedBy, 20);
      return [a, b];
    };
    const runB = () => {
      const a = resolveCorpseHarvest(null, 10);
      const b = resolveCorpseHarvest(a.claimedBy, 20);
      return [a, b];
    };
    expect(runA()).toEqual(runB());
  });

  it('the claiming player is always the one recorded, never the denied one', () => {
    const claim = resolveCorpseHarvest(null, 99);
    expect(claim.claimedBy).toBe(99);
    const denied = resolveCorpseHarvest(claim.claimedBy, 100);
    expect(denied.claimedBy).toBe(99);
  });
});

describe('isHarvestableCorpse', () => {
  it('is false with no component tags', () => {
    expect(isHarvestableCorpse(undefined)).toBe(false);
    expect(isHarvestableCorpse([])).toBe(false);
  });

  it('is true with at least one MAPPED component tag', () => {
    expect(isHarvestableCorpse(['hide'])).toBe(true);
    // ...and a mapped family beside unmapped ones still qualifies: a mixed
    // corpse keeps its picker, its claim and its yields untouched (#2509 owns
    // the pick-level refusal there, not this predicate).
    expect(isHarvestableCorpse(['claw', 'hide', 'tusk'])).toBe(true);
  });

  it('is false when every tag is carried but unmapped (#2513)', () => {
    // The tag COUNT answer was a lie on exactly this shape: it advertised a
    // harvest that could never pay, and the command spent the single-use claim
    // and reported nothing at all. Answering on mapped families instead puts
    // such a corpse on the same path as an untagged one.
    expect(isHarvestableCorpse(['claw'])).toBe(false);
    expect(isHarvestableCorpse(['claw', 'tusk'])).toBe(false);
    expect(isHarvestableCorpse(['gills', 'horn'])).toBe(false);
    // Not merely "a short list is false": the same LENGTH with one family
    // swapped for a mapped one flips it, so the predicate is reading the table
    // and not the count.
    expect(isHarvestableCorpse(['claw', 'hide'])).toBe(true);
  });

  it('reads the real yield table, so a family gaining an item retires the case', () => {
    // Both sides literal, the tests/corpse_harvest_sim.test.ts idiom: deriving
    // the unmapped list from HARVEST_COMPONENT_ITEMS alone would pass against
    // any table, including an empty one.
    expect(Object.keys(HARVEST_COMPONENT_ITEMS).sort()).toEqual([
      'cloth',
      'fang',
      'hide',
      'meat',
      'silk',
      'venomSac',
    ]);
    for (const mapped of ['cloth', 'fang', 'hide', 'meat', 'silk', 'venomSac']) {
      expect(harvestFamilyYieldsItem(mapped), mapped).toBe(true);
      expect(isHarvestableCorpse([mapped]), mapped).toBe(true);
    }
    for (const unmapped of ['claw', 'gills', 'horn', 'tusk']) {
      expect(harvestFamilyYieldsItem(unmapped), unmapped).toBe(false);
      expect(isHarvestableCorpse([unmapped]), unmapped).toBe(false);
    }
    // A tag no template carries at all is unmapped too, so a drifted client's
    // vocabulary cannot make a corpse look harvestable.
    expect(harvestFamilyYieldsItem('not_a_family')).toBe(false);
    // ...and neither can an INHERITED key. HARVEST_COMPONENT_ITEMS is a plain
    // object literal, so a bare `table[component]` answers with Object.prototype
    // here and, worse, in the grant loop, which would try to grant an item id
    // that is a function. The shared harvestItemForFamily accessor guards it once
    // for every reader; guarding the predicate alone would just move the
    // disagreement instead of closing it.
    for (const inherited of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(harvestItemForFamily(inherited), inherited).toBeUndefined();
      expect(harvestFamilyYieldsItem(inherited), inherited).toBe(false);
      expect(isHarvestableCorpse([inherited]), inherited).toBe(false);
      expect(forfeitsEveryMappedYield(['hide', inherited], [inherited]), inherited).toBe(true);
    }
    // `__proto__` is its own case: it is an accessor on Object.prototype, so a
    // bare lookup answers with the prototype OBJECT rather than a function.
    expect(harvestItemForFamily('__proto__')).toBeUndefined();
    expect(isHarvestableCorpse(['__proto__'])).toBe(false);
    // The accessor returns the real id for a real family, so the guard above is
    // not simply refusing everything.
    expect(harvestItemForFamily('hide')).toBe('rough_hide');
  });

  it('tests TRUTHINESS, not key presence, everywhere the yield table is read', () => {
    // The one detail of #2513 that must never be refactored. The grant loop and
    // the pre-claim capacity gate both do `if (!itemId) continue` over the same
    // accessor, so an empty-string mapping grants nothing. Written as `in` or
    // `!== undefined`, the predicate would call such a family harvestable, the
    // corpse-level gate would pass, the grant loop would skip it anyway, and the
    // claim would be spent for zero items with no event: the exact bug,
    // reintroduced. Every row below is chosen to FLIP under that rewrite; the
    // table is Readonly by TYPE only, which is what lets this case exist at all,
    // and it is restored in a finally.
    const table = HARVEST_COMPONENT_ITEMS as Record<string, string>;
    expect('claw' in table).toBe(false);
    try {
      table.claw = '';
      expect('claw' in table).toBe(true);
      expect(harvestItemForFamily('claw')).toBe('');
      expect(harvestFamilyYieldsItem('claw')).toBe(false);
      expect(isHarvestableCorpse(['claw', 'tusk'])).toBe(false);
      // The sibling predicate reads the SAME accessor, so the two cannot disagree
      // about what an empty mapping means. Both rows are sensitive: with `claw`
      // treated as yieldable the first flips to false and the second to true.
      expect(forfeitsEveryMappedYield(['claw', 'tusk'], ['tusk'])).toBe(false);
      expect(forfeitsEveryMappedYield(['hide', 'claw'], ['claw'])).toBe(true);
      // A non-empty mapping on the same key flips all of it, so the case is about
      // the VALUE and not about the key being freshly added.
      table.claw = 'rough_hide';
      expect(harvestFamilyYieldsItem('claw')).toBe(true);
      expect(isHarvestableCorpse(['claw', 'tusk'])).toBe(true);
      // ...and now `tusk` alone really does forfeit something, which is the row
      // that was insensitive while claw mapped to nothing.
      expect(forfeitsEveryMappedYield(['claw', 'tusk'], ['tusk'])).toBe(true);
      // #2514's readers belong in THIS rig and nowhere else. The two
      // `if (!itemId) continue` arms in harvestCorpse are unreachable only
      // because yieldingFocusComponents filters on the same TRUTHINESS the
      // grant loop tests, and an empty-string mapping is the one input that
      // separates truthiness from `in` and from `!== undefined`. Rewrite that
      // filter as `c in HARVEST_COMPONENT_ITEMS` and every row below flips
      // while the shipped-content sweeps stay green, because no shipped family
      // maps to ''.
      table.claw = '';
      expect(yieldingFocusComponents(['hide', 'claw'], [])).toEqual(['hide']);
      expect(harvestConcentrationBonus(['hide', 'claw'], [])).toBe(1);
      const emptyMappingRng = new Rng(5);
      let emptyMappingDraws = 0;
      emptyMappingRng.setObserver(() => {
        emptyMappingDraws++;
      });
      const emptyMappingYields = resolveCorpseFocusHarvest(['hide', 'claw'], [], emptyMappingRng);
      emptyMappingRng.setObserver(null);
      // One tier roll, for hide alone: an empty mapping must cost no draw, or
      // the family is back in the roll and back in both dead arms.
      expect(emptyMappingDraws).toBe(1);
      expect(emptyMappingYields.map((y) => y.component)).toEqual(['hide']);
      // The other rewrite the same reader has to survive, matching the
      // Object.prototype sweep two cases above: a BARE lookup is still
      // truthiness, so the empty-string rows above cannot see it, and it would
      // put an inherited key back into the one set that feeds the tier roll.
      expect(yieldingFocusComponents(['hide', 'constructor'], [])).toEqual(['hide']);
      expect(harvestConcentrationBonus(['hide', 'constructor'], [])).toBe(1);
    } finally {
      delete table.claw;
    }
    expect('claw' in table).toBe(false);
    expect(isHarvestableCorpse(['claw', 'tusk'])).toBe(false);
  });

  it('deliberately does NOT govern the Town Focus slider list', () => {
    // Worth stating, because "one rule, one place" invites the assumption that it
    // covers this too, and it does not. #2511 moved TOWN_FOCUS_COMPONENTS into
    // the sim (professions/focus.ts) as a FROZEN Object.keys snapshot behind a
    // Set, because the question it answers is "which keys does setTownFocus
    // accept", and a Set is what closes the Object.prototype hole there. The
    // harvest asks a different question, "which family pays out", and answers it
    // by truthiness through harvestItemForFamily, because the grant loop's
    // `if (!itemId) continue` is the behavior it has to match.
    //
    // The two agree on every shipped family and diverge only on a key mapped to
    // an empty string: the panel would offer a slider the harvest refuses. That
    // is a hypothetical, it is one line to close on either side, and it belongs
    // with whichever of the two rules moves first, so it is documented here
    // rather than fixed twice.
    for (const component of TOWN_FOCUS_COMPONENTS) {
      expect(harvestFamilyYieldsItem(component), component).toBe(true);
    }
    expect([...TOWN_FOCUS_COMPONENTS]).toEqual(Object.keys(HARVEST_COMPONENT_ITEMS));
    expect(TOWN_FOCUS_COMPONENTS).toHaveLength(6);
    // No unmapped family reaches the panel today, which is the property that
    // actually matters for a player: the four unmapped ones are not keys at all.
    for (const unmapped of ['claw', 'gills', 'horn', 'tusk']) {
      expect(TOWN_FOCUS_COMPONENTS).not.toContain(unmapped);
      expect(isTownFocusComponent(unmapped), unmapped).toBe(false);
      expect(harvestFamilyYieldsItem(unmapped), unmapped).toBe(false);
    }
    // ...and the prototype keys #2511's Set closes are refused on both sides, so
    // the two rules cannot disagree about those either.
    for (const inherited of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(isTownFocusComponent(inherited), inherited).toBe(false);
      expect(harvestFamilyYieldsItem(inherited), inherited).toBe(false);
    }
  });

  it('answers for every shipped template, and fen_troll is the one it now excludes', () => {
    // Derived from content: a retag that leaves another template with no mapped
    // family lands in this list instead of going untested.
    const excluded = Object.entries(MOBS)
      .filter(([, m]) => (m.componentTags?.length ?? 0) > 0)
      .filter(([, m]) => !isHarvestableCorpse(m.componentTags))
      .map(([id]) => id);
    expect(excluded).toEqual(['fen_troll']);
    // The complement is asserted too, so an always-false predicate could not
    // pass the row above by making the sweep vacuous.
    const included = Object.entries(MOBS).filter(([, m]) => isHarvestableCorpse(m.componentTags));
    // 36 since the farm-economy pass: beast, spider and reptile trash pays in
    // harvestable components instead of coin, so 15 previously untagged
    // templates gained mapped tags (tests/economy_yield.test.ts enforces it).
    // 40: 36 before either side of this merge, then 39 with the Drakelands
    // dragonkin brood (the broodguard, the whelp and the broodlord are skinnable
    // scaled hide like every other dragonkin corpse; the egg clutch is NOT, a
    // 1 HP shell yields nothing at all), then 40 with this branch's quest-dedupe
    // pass, whose threnos_first_voice ships a mapped cloth tag.
    expect(included).toHaveLength(40);
    // ...and the untagged templates are counted rather than assumed: 189 of them
    // ship, all excluded before this change and all excluded after it, which is
    // the path fen_troll now joins instead of getting one of its own. (184 before
    // this merge, plus the untagged dragonkin egg from the brood and the four
    // untagged camp mobs the quest-dedupe pass added.)
    const untagged = Object.values(MOBS).filter((m) => !m.componentTags?.length);
    expect(untagged).toHaveLength(189);
    for (const m of untagged) expect(isHarvestableCorpse(m.componentTags)).toBe(false);
    // The three literals above are the load-bearing ones; this sum states that
    // they partition MOBS, so a template that fell out of all three would read
    // as wrong here rather than quietly leaving the sweep.
    expect(included.length + excluded.length + untagged.length).toBe(Object.keys(MOBS).length);
  });
});

describe('resolveCorpseFocusHarvest: concentrate vs spread tradeoff (#1142)', () => {
  // Two fixtures, and which one a case uses is load-bearing after #2514.
  // MAPPED is four families that all have an item behind them, so it is the
  // only shape that can still reach bonus 0, the unshifted BASE_TIER_WEIGHTS
  // roll #1141 shipped as the spread. MIXED carries two families the item table
  // does not map, so its widest pick is bonus 2 and bonus 0 is unreachable on
  // it. Before #2514 this describe ran entirely on MIXED and called its full
  // cover "zero bonus", which was already only true because an unmapped family
  // used to count as extracted breadth.
  const MAPPED = ['hide', 'fang', 'silk', 'meat'];
  const MIXED = ['hide', 'fang', 'claw', 'horn'];

  function meanTierIndex(componentTags: string[], chosen: string[], seed: number, trials: number) {
    const rng = new Rng(seed);
    let sum = 0;
    let count = 0;
    for (let i = 0; i < trials; i++) {
      const yields = resolveCorpseFocusHarvest(componentTags, chosen, rng);
      for (const y of yields) {
        sum += TIER_INDEX[y.tier];
        count++;
      }
    }
    return sum / count;
  }

  it('focusing on 1 of 4 tagged components yields a strictly higher average tier than spreading across all 4', () => {
    const trials = 2000;
    const focusedMean = meanTierIndex(MAPPED, ['hide'], 1, trials);
    const spreadMean = meanTierIndex(MAPPED, MAPPED, 2, trials);
    expect(focusedMean).toBeGreaterThan(spreadMean);
    // The same tradeoff on a corpse whose breadth is partly unreachable: the
    // gap narrows (bonus 3 against bonus 2 instead of 3 against 0) but the
    // direction must survive, or "concentrating pays" would be a statement
    // about all-mapped corpses only.
    expect(meanTierIndex(MIXED, ['hide'], 1, trials)).toBeGreaterThan(
      meanTierIndex(MIXED, MIXED, 2, trials),
    );
  });

  it('draws from the passed-in Rng (deterministic for a fixed seed)', () => {
    const runA = resolveCorpseFocusHarvest(MIXED, ['hide'], new Rng(7));
    const runB = resolveCorpseFocusHarvest(MIXED, ['hide'], new Rng(7));
    expect(runA).toEqual(runB);
  });

  it('an empty selection spreads across every tagged component (back-compat default)', () => {
    const empty = resolveCorpseFocusHarvest(MAPPED, [], new Rng(5));
    const all = resolveCorpseFocusHarvest(MAPPED, MAPPED, new Rng(5));
    expect(empty).toEqual(all);
    expect(empty.map((y) => y.component)).toEqual(MAPPED);
    // The equivalence survives #2514 on a mixed corpse too, and it WIDENS: the
    // cover of just the mapped families joins the same class, because all three
    // extract the same set and so earn the same bonus.
    expect(resolveCorpseFocusHarvest(MIXED, [], new Rng(5))).toEqual(
      resolveCorpseFocusHarvest(MIXED, MIXED, new Rng(5)),
    );
    expect(resolveCorpseFocusHarvest(MIXED, [], new Rng(5))).toEqual(
      resolveCorpseFocusHarvest(MIXED, ['hide', 'fang'], new Rng(5)),
    );
  });

  it('selecting every tagged component behaves identically to the pre-#1142 spread (zero bonus)', () => {
    const yields = resolveCorpseFocusHarvest(MAPPED, MAPPED, new Rng(3));
    expect(yields.map((y) => y.component)).toEqual(MAPPED);
    // Not just "returns every tag": the bonus really is 0, so the tiers are the
    // unshifted roll. Asserted through the exported bonus rather than inferred
    // from the component list, since after #2514 a full cover can return every
    // MAPPED tag and still carry a bonus (the MIXED case below).
    expect(harvestConcentrationBonus(MAPPED, MAPPED)).toBe(0);
    expect(harvestConcentrationBonus(MAPPED, [])).toBe(0);
  });

  it('on a MIXED corpse a full cover extracts only the mapped families, and bonus 0 is out of reach (#2514)', () => {
    const yields = resolveCorpseFocusHarvest(MIXED, MIXED, new Rng(3));
    expect(yields.map((y) => y.component)).toEqual(['hide', 'fang']);
    // Two of the four tags are breadth the harvest cannot reach, so the widest
    // pick on this corpse is bonus 2. Every pick shape, so this is a statement
    // about the corpse and not about one selection.
    for (const pick of [[], MIXED, ['hide', 'fang'], ['hide', 'fang', 'claw']]) {
      expect(harvestConcentrationBonus(MIXED, pick), JSON.stringify(pick)).toBe(2);
    }
    // ...and the roll really is shifted by it. Same seed on both fixtures, so
    // hide's unshifted rolled index is identical and the only difference is
    // the bonus: the MIXED tier must land exactly two steps above the MAPPED
    // one, clamped at legendary. An equality per seed, not an inequality, so a
    // bonus that quietly became 1 or 3 reds here.
    for (let seed = 1; seed <= 20; seed++) {
      const mapped = resolveCorpseFocusHarvest(MAPPED, MAPPED, new Rng(seed))[0];
      const mixed = resolveCorpseFocusHarvest(MIXED, MIXED, new Rng(seed))[0];
      expect(TIER_INDEX[mixed.tier], `seed ${seed}`).toBe(Math.min(5, TIER_INDEX[mapped.tier] + 2));
    }
  });

  it('ignores a chosen tag that is not actually on the corpse', () => {
    const yields = resolveCorpseFocusHarvest(MIXED, ['hide', 'not_a_real_tag'], new Rng(9));
    expect(yields.map((y) => y.component)).toEqual(['hide']);
  });

  it('is monotonic: for the SAME underlying rng draw, choosing fewer components never lowers the tier', () => {
    // Both calls draw from a fresh Rng seeded identically, so the first draw
    // (and thus the unshifted rolled index) is identical for 'hide' in both
    // calls; only the concentration bonus differs. The focused (1-of-4) tier
    // can only be >= the spread (4-of-4) tier, never lower. Run on MAPPED so
    // the spread side is a real bonus-0 baseline.
    for (let seed = 1; seed <= 50; seed++) {
      const spread = resolveCorpseFocusHarvest(MAPPED, MAPPED, new Rng(seed));
      const focused = resolveCorpseFocusHarvest(MAPPED, ['hide'], new Rng(seed));
      const spreadHide = spread.find((y) => y.component === 'hide');
      const focusedHide = focused.find((y) => y.component === 'hide');
      expect(spreadHide).toBeDefined();
      expect(focusedHide).toBeDefined();
      expect(TIER_INDEX[focusedHide?.tier ?? '']).toBeGreaterThanOrEqual(
        TIER_INDEX[spreadHide?.tier ?? ''],
      );
    }
  });
});

// #2514: the bonus counts what the harvest could not EXTRACT, so a family with
// no item behind it is always forfeited breadth, whether or not the player
// checked it. Before, an unmapped family sat in the pick like any other and
// diluted the bonus, so ticking Claw beside Hide cost a full tier on hide and
// returned nothing for claw.
describe('yieldingFocusComponents and harvestConcentrationBonus (#2514)', () => {
  const MIXED3 = ['hide', 'fang', 'claw'];
  const MIXED2 = ['gills', 'hide'];

  it('drops the unmapped families from the extracted set, order preserved', () => {
    expect(yieldingFocusComponents(MIXED3, ['hide', 'claw'])).toEqual(['hide']);
    expect(yieldingFocusComponents(MIXED3, [])).toEqual(['hide', 'fang']);
    expect(yieldingFocusComponents(MIXED3, MIXED3)).toEqual(['hide', 'fang']);
    // The filter preserves whatever order effectiveFocusComponents produced,
    // and does not impose one: a strict subset keeps the PICK's order, the
    // spread arm keeps the corpse's tag order. That order is what the yields,
    // the grants and the harvestResult ledger land in (#2457), so it must
    // survive the narrowing untouched.
    expect(yieldingFocusComponents(MIXED3, ['fang', 'hide'])).toEqual(['fang', 'hide']);
    // A cover written back to front is still a cover, so it takes the spread
    // arm and comes back in TAG order, not the order it was written in. Both
    // rows here so the pin cannot be read as "always the pick's order".
    expect(yieldingFocusComponents(MIXED3, ['fang', 'claw', 'hide'])).toEqual(['hide', 'fang']);
    // An all-mapped corpse is untouched, which is why eight shipped templates
    // do not move at all.
    expect(yieldingFocusComponents(['hide', 'fang'], ['hide'])).toEqual(['hide']);
  });

  it('makes an unmapped box free: the pick beside it scores exactly what it scores alone', () => {
    expect(harvestConcentrationBonus(MIXED3, ['hide', 'claw'])).toBe(
      harvestConcentrationBonus(MIXED3, ['hide']),
    );
    expect(harvestConcentrationBonus(MIXED3, ['hide'])).toBe(2);
    // The whole world, not just the number: same set, same bonus, so the same
    // draws in the same order off the same seed.
    expect(resolveCorpseFocusHarvest(MIXED3, ['hide', 'claw'], new Rng(5))).toEqual(
      resolveCorpseFocusHarvest(MIXED3, ['hide'], new Rng(5)),
    );
  });

  it('keeps the DENOMINATOR at the corpse tag count, which is what the two-tag shapes prove', () => {
    // The load-bearing half of the ruling, and the one a "tidy" refactor to a
    // mapped-family denominator would silently reverse. On the murloc shape a
    // mapped denominator gives 1 - 1 = 0 for every pick; the shipped rule gives
    // 2 - 1 = 1. old_greyjaw's 3-tag shape cannot tell the two apart for
    // ['hide'] (both answer 2), which is why this case exists.
    expect(harvestConcentrationBonus(MIXED2, [])).toBe(1);
    expect(harvestConcentrationBonus(MIXED2, ['hide'])).toBe(1);
    expect(harvestConcentrationBonus(MIXED2, ['gills', 'hide'])).toBe(1);
    // ...and one mapped family out of three tags is a two-tier concentrate,
    // which a mapped denominator would flatten to 0.
    expect(harvestConcentrationBonus(['hide', 'claw', 'horn'], [])).toBe(2);
  });

  it('never lowers a bonus and never raises one past the reachable ceiling, over every shipped corpse and pick', () => {
    // The two balance claims, swept rather than asserted on a fixture. `legacy`
    // is the pre-#2514 body kept verbatim: comparing against a second call to
    // the shipped function would compare it with itself.
    const legacyBonus = (tags: readonly string[], chosen: readonly string[]) =>
      Math.max(0, Math.min(5, tags.length - effectiveFocusComponents(tags, chosen).length));
    let raised = 0;
    for (const template of Object.values(MOBS)) {
      const tags = template.componentTags;
      if (!tags || !isHarvestableCorpse(tags)) continue;
      for (const pick of subsetsOf(tags)) {
        // Only picks a caller can actually harvest on: the #2509 refusal takes
        // the rest BEFORE the bonus is ever asked, which is exactly what makes
        // the ceiling hold.
        if (forfeitsEveryMappedYield(tags, pick)) continue;
        const label = `${template.id} ${JSON.stringify(pick)}`;
        const now = harvestConcentrationBonus(tags, pick);
        expect(now, label).toBeGreaterThanOrEqual(legacyBonus(tags, pick));
        expect(now, label).toBeLessThanOrEqual(tags.length - 1);
        if (now > legacyBonus(tags, pick)) raised++;
      }
    }
    // The sweep must actually have exercised the raising arm, or a formula
    // that changed nothing would pass both bounds above. A CORPUS CENSUS like
    // the mixed-template count in tests/mob_component_tags: v0.32.0 authored 30
    // against the release bestiary, and this branch's extra corpses raise two
    // more picks. The three tagged dragonkin brood corpses add NOTHING here:
    // they carry hide+fang, both mapped, so every harvestable pick on them
    // concentrates exactly as the pre-#2514 body did and none of them raises.
    // (They briefly advertised claw and horn, which are unmapped, and did raise
    // eight picks; the same commit that took those tags back out of the mixed
    // census left this pin at 40 by oversight.)
    // The two bounds inside the loop are the real assertions.
    expect(raised).toBe(32);
  });

  it('is self-healing: giving claw an item returns every number to the pre-#2514 world', () => {
    // The live-table mutation rig from the isHarvestableCorpse describe above,
    // and the reason the ruling is safe to make: the change is a correction
    // that only exists while content is missing. Restored in a finally.
    const table = HARVEST_COMPONENT_ITEMS as Record<string, string>;
    expect(harvestConcentrationBonus(MIXED3, [])).toBe(1);
    try {
      table.claw = 'rough_hide';
      expect(yieldingFocusComponents(MIXED3, [])).toEqual(MIXED3);
      expect(harvestConcentrationBonus(MIXED3, [])).toBe(0);
      expect(harvestConcentrationBonus(MIXED3, ['hide', 'claw'])).toBe(1);
      // ...and it stops being equal to ['hide'], which is the exact equality
      // #2514 introduced. The day the content lands, the issue closes itself.
      expect(harvestConcentrationBonus(MIXED3, ['hide'])).toBe(2);
    } finally {
      delete table.claw;
    }
    expect(harvestConcentrationBonus(MIXED3, [])).toBe(1);
  });

  it('answers above the ceiling only for a pick both refusals already took', () => {
    // Stated so the bound in the docblock is not read as unconditional. These
    // are the shapes the #2509 and #2513 gates refuse before the bonus is
    // asked; resolveCorpseFocusHarvest then rolls nothing at all with them, so
    // no rng is drawn either.
    expect(harvestConcentrationBonus(MIXED3, ['claw'])).toBe(3);
    expect(forfeitsEveryMappedYield(MIXED3, ['claw'])).toBe(true);
    expect(harvestConcentrationBonus(['claw', 'tusk'], [])).toBe(2);
    expect(isHarvestableCorpse(['claw', 'tusk'])).toBe(false);
    const rng = new Rng(5);
    let draws = 0;
    rng.setObserver(() => {
      draws++;
    });
    expect(resolveCorpseFocusHarvest(['claw', 'tusk'], [], rng)).toEqual([]);
    rng.setObserver(null);
    expect(draws).toBe(0);
  });
});

describe('harvestTierQuantity', () => {
  it('increases monotonically from poor (1) to legendary (6)', () => {
    expect(harvestTierQuantity('poor')).toBe(1);
    expect(harvestTierQuantity('common')).toBe(2);
    expect(harvestTierQuantity('uncommon')).toBe(3);
    expect(harvestTierQuantity('rare')).toBe(4);
    expect(harvestTierQuantity('epic')).toBe(5);
    expect(harvestTierQuantity('legendary')).toBe(6);
  });
});

// #2474: the focus pick is a SET of component families. `chosen` arrives
// straight off the wire (server/game.ts type-filters the array and forwards it),
// so a repeated tag is a client-supplied value the authoritative sim must not
// act on twice: a corpse is single-use, and a repeat that survived harvested the
// same family once per repeat off one claim.
describe('effectiveFocusComponents collapses a repeated tag (#2474)', () => {
  const TAGS = ['hide', 'fang', 'claw', 'horn'];

  // The pre-#2474 body, verbatim, kept as an independent reference so the
  // "unchanged for a duplicate-free pick" sweep below compares against real
  // prior behavior rather than against the function under test.
  function legacyEffective(
    tagged: readonly string[],
    chosen: readonly string[],
  ): readonly string[] {
    return chosen.length === 0 || chosen.length >= tagged.length
      ? tagged
      : chosen.filter((c) => tagged.includes(c));
  }

  function subsets<T>(items: readonly T[]): T[][] {
    return items.reduce<T[][]>((acc, item) => acc.concat(acc.map((s) => [...s, item])), [[]]);
  }

  it('a repeat on the CONCENTRATE arm harvests the family once, not once per repeat', () => {
    // The plain doubling: 2 raw entries against 4 tags stays under the spread
    // threshold, so the old filter arm handed back ['hide','hide'] and the
    // command rolled, granted and logged the hide family twice.
    expect(legacyEffective(TAGS, ['hide', 'hide'])).toEqual(['hide', 'hide']);
    expect(effectiveFocusComponents(TAGS, ['hide', 'hide'])).toEqual(['hide']);
    expect(effectiveFocusComponents(TAGS, ['hide', 'hide', 'hide', 'hide'])).toEqual(['hide']);
  });

  it('a repeat can no longer pad the pick past the SPREAD threshold', () => {
    // The second, quieter half of the same bug: `chosen.length` was the raw
    // count, so on a two-tag corpse ['hide','hide'] cleared `>= tagged.length`
    // and spread across every tag, harvesting fang the caller never asked for
    // (and at bonus 0 instead of the concentration bonus a real one-tag pick
    // earns). Both halves are decided by the dedupe running BEFORE the tests.
    expect(legacyEffective(['hide', 'fang'], ['hide', 'hide'])).toEqual(['hide', 'fang']);
    expect(effectiveFocusComponents(['hide', 'fang'], ['hide', 'hide'])).toEqual(['hide']);
    expect(effectiveFocusComponents(['hide', 'fang'], ['hide'])).toEqual(['hide']);
  });

  it('a pick of repeated JUNK lands wherever a single junk tag lands', () => {
    // The knock-on the padding fix carries, pinned so it reads as intended
    // rather than as a side effect: repeats of a tag that is not on the corpse
    // also used to clear the threshold and spread the whole corpse, while one
    // junk tag stayed under it and yielded nothing. The pre-#2474 body really
    // did split the same intent by how many junk strings the frame carried:
    expect(legacyEffective(['hide', 'fang'], ['zzz', 'zzz'])).toEqual(['hide', 'fang']);
    expect(legacyEffective(['hide', 'fang'], ['zzz'])).toEqual([]);
    // Making the two agree is #2474's business and still holds. WHICH value
    // they agree on is #2504's: an invalid tag is now dropped before either
    // length test, so an all-junk pick is the empty pick, and the empty pick
    // spreads (the #1141 default). Superseded, not quietly deleted: both lines
    // read `.toEqual([])` until #2504, and the argument for the move lives on
    // effectiveFocusComponents beside the ruling itself.
    expect(effectiveFocusComponents(['hide', 'fang'], ['zzz', 'zzz'])).toEqual(['hide', 'fang']);
    expect(effectiveFocusComponents(['hide', 'fang'], ['zzz'])).toEqual(['hide', 'fang']);
  });

  it('keeps first-occurrence ORDER, the order yields, grants and ledger entries land in', () => {
    // Order is load-bearing (#2457): tag order is yield order is chat-line
    // order. A dedupe that sorted, or that kept the LAST occurrence, would
    // silently reorder the harvest ledger.
    expect(effectiveFocusComponents(TAGS, ['fang', 'hide', 'fang'])).toEqual(['fang', 'hide']);
    expect(effectiveFocusComponents(TAGS, ['claw', 'hide', 'claw', 'fang'])).toEqual([
      'claw',
      'hide',
      'fang',
    ]);
  });

  it('is identical to the pre-#2474 result for EVERY duplicate-free pick naming a real tag', () => {
    // The no-regression half of the acceptance criteria, swept rather than
    // sampled: every subset of a four-tag corpse, in two orders, plus a pick
    // padded with an off-corpse tag and the empty pick. A dedupe that touched a
    // duplicate-free array at all would fail here.
    const picks = subsets(TAGS).flatMap((s) => [s, [...s].reverse()]);
    picks.push(['hide', 'not_a_real_tag'], []);
    for (const pick of picks) {
      expect(effectiveFocusComponents(TAGS, pick), `pick ${JSON.stringify(pick)}`).toEqual(
        legacyEffective(TAGS, pick),
      );
    }
    // The one pick that left this sweep, carved out in the open rather than
    // dropped: #2504 ruled that a pick naming nothing the corpse carries IS the
    // empty pick, so it spreads where the pre-#2474 body yielded nothing.
    // Asserted right here, at the sweep it came out of, so the carve-out cannot
    // pass unread.
    expect(legacyEffective(TAGS, ['not_a_real_tag'])).toEqual([]);
    expect(effectiveFocusComponents(TAGS, ['not_a_real_tag'])).toEqual(TAGS);
    // And this fixture's blind spot, which is why #2504 sweeps narrower corpses
    // in its own describe below: a two-entry pick can only reach the spread
    // threshold on a corpse with two tags or fewer, so on these four tags
    // `['hide','not_a_real_tag']` stays on the filter arm in BOTH bodies and
    // the padding class #2504 closes is invisible from here.
    expect(effectiveFocusComponents(TAGS, ['hide', 'not_a_real_tag'])).toEqual(['hide']);
    expect(legacyEffective(['hide', 'fang'], ['hide', 'not_a_real_tag'])).toEqual(['hide', 'fang']);
  });

  it('makes a repeated pick draw and yield EXACTLY what its deduped twin does', () => {
    // End of the pure path: same seed, same yields, same number of draws. The
    // draw count is the decisive half, since the rolls are what a doubled
    // harvest spent twice.
    const pairs: [string[], string[]][] = [
      [['hide', 'hide'], ['hide']],
      [
        ['hide', 'hide', 'fang'],
        ['hide', 'fang'],
      ],
      [
        ['fang', 'hide', 'fang'],
        ['fang', 'hide'],
      ],
      [
        ['hide', 'fang', 'hide', 'claw', 'horn'],
        ['hide', 'fang', 'claw', 'horn'],
      ],
    ];
    for (const [dup, deduped] of pairs) {
      for (let seed = 1; seed <= 20; seed++) {
        const label = `${JSON.stringify(dup)} @${seed}`;
        expect(resolveCorpseFocusHarvest(TAGS, dup, new Rng(seed)), label).toEqual(
          resolveCorpseFocusHarvest(TAGS, deduped, new Rng(seed)),
        );
        expect(drawCount(TAGS, dup, seed), `${label} draws`).toBe(drawCount(TAGS, deduped, seed));
      }
    }
    // And the count is genuinely the one a single family costs, so the
    // comparison above is not two equal-but-wrong numbers.
    expect(drawCount(TAGS, ['hide', 'hide'], 3)).toBe(1);
    expect(drawCount(TAGS, ['hide', 'fang'], 3)).toBe(2);
  });

  function drawCount(tagged: string[], chosen: string[], seed: number): number {
    const rng = new Rng(seed);
    let draws = 0;
    rng.setObserver(() => {
      draws++;
    });
    resolveCorpseFocusHarvest(tagged, chosen, rng);
    return draws;
  }
});

// #2504: the focus pick is a set of THIS corpse's families. `chosen` arrives
// straight off the wire (server/game.ts type-filters the array and forwards it),
// so an entry naming no tag on the corpse is a client-supplied value the sim
// must not act on. Measured against the raw count it still padded the pick past
// the `>= taggedComponents.length` spread threshold, so a caller who named one
// real family plus one junk string harvested the WHOLE corpse at bonus 0,
// including a family they never named. Same shape as #2474 one step over: an
// unsanitized array deciding which arm runs, through `.length`.
describe('effectiveFocusComponents drops a tag the corpse does not carry (#2504)', () => {
  // The pre-#2504 body, verbatim (the #2474 dedupe, filtering AFTER both length
  // tests), kept as an independent reference so every claim below compares
  // against real prior behavior rather than against the function under test.
  function legacy2503(tagged: readonly string[], chosen: readonly string[]): readonly string[] {
    const picked = [...new Set(chosen)];
    return picked.length === 0 || picked.length >= tagged.length
      ? tagged
      : picked.filter((c) => tagged.includes(c));
  }

  function subsets<T>(items: readonly T[]): T[][] {
    return items.reduce<T[][]>((acc, item) => acc.concat(acc.map((s) => [...s, item])), [[]]);
  }

  // Corpse widths chosen for their ARMS, not for variety: a two-entry pick
  // clears `>= tagged.length` on WOLF and stays under it on BOAR, so the two
  // rows are the padding arm and the filter arm of the same function. WOLF and
  // BOAR mirror real content (forest_wolf, wild_boar); tests/mob_component_tags
  // and the sim-level #2504 cases pin them against MOBS.
  const SOLO = ['hide'];
  const WOLF = ['hide', 'fang'];
  const BOAR = ['hide', 'tusk', 'meat'];
  const WIDE = ['hide', 'fang', 'claw', 'horn'];
  const CORPSES = [SOLO, WOLF, BOAR, WIDE];
  const JUNK = ['junk', 'zzz', 'not_a_real_tag'];

  it('the issue case: one junk entry no longer spreads a one-family pick', () => {
    // forest_wolf's two tags, the corpse the issue reproduces on. The fang line
    // is the decisive one: it is the family the caller never named, and the
    // whole harm is that it used to be granted anyway, at the zero
    // concentration bonus a real two-tag pick earns.
    expect(legacy2503(WOLF, ['hide', 'junk'])).toEqual(['hide', 'fang']);
    expect(effectiveFocusComponents(WOLF, ['hide', 'junk'])).toEqual(['hide']);
    expect(effectiveFocusComponents(WOLF, ['hide'])).toEqual(['hide']);
    // Same frame one tag map over, so the pin is not a property of 'hide'.
    expect(effectiveFocusComponents(WOLF, ['fang', 'junk'])).toEqual(['fang']);
  });

  it('junk is INERT: a pick means exactly what the same pick without junk means', () => {
    // The contract as one property, and the general statement the case above is
    // a single instance of. Swept over every corpse width, every subset of its
    // tags, every subset of three junk strings, and three placements of that
    // junk (before, after, interleaved), so neither pick length nor pick order
    // can leave junk load-bearing anywhere.
    for (const tags of CORPSES) {
      for (const valid of subsets(tags)) {
        const expected = effectiveFocusComponents(tags, valid);
        for (const junk of subsets(JUNK)) {
          const placements = [
            [...valid, ...junk],
            [...junk, ...valid],
            valid
              .flatMap((v, i) => (junk[i] === undefined ? [v] : [junk[i], v]))
              .concat(junk.slice(valid.length)),
          ];
          for (const pick of placements) {
            const label = `tags ${JSON.stringify(tags)} pick ${JSON.stringify(pick)}`;
            expect(effectiveFocusComponents(tags, pick), label).toEqual(expected);
          }
        }
      }
    }
    // Not a sweep of vacuous equalities: the property covers both arms, and
    // these are the two values it is holding fixed on the corpse that has both.
    expect(effectiveFocusComponents(WOLF, ['hide'])).toEqual(['hide']);
    expect(effectiveFocusComponents(WOLF, [])).toEqual(['hide', 'fang']);
  });

  it('an all-junk pick IS the empty pick, at every junk length (the settled ruling)', () => {
    // The ordering consequence the issue asked to settle before fixing:
    // filtering ahead of the length tests sends an all-invalid pick to the
    // `length === 0` arm. Ruled for spreading, and pinned here. "Ignored
    // entirely" is then one rule with no exception at the boundary, a junk
    // string is never the difference between two outcomes, and a client whose
    // tag vocabulary has drifted from the server's content degrades to the
    // #1141 default instead of burning a single-use corpse for nothing.
    //
    // What it supersedes, shown rather than described: the pre-#2504 body split
    // the same intent by junk COUNT, spreading at or above the threshold and
    // yielding nothing below it. There was no coherent prior behavior to keep.
    expect(legacy2503(WOLF, ['junk'])).toEqual([]);
    expect(legacy2503(WOLF, ['junk', 'zzz'])).toEqual(['hide', 'fang']);
    for (const tags of CORPSES) {
      for (const pick of [['junk'], ['junk', 'zzz'], ['junk', 'zzz', 'qqq'], ['junk', 'junk']]) {
        const label = `tags ${JSON.stringify(tags)} pick ${JSON.stringify(pick)}`;
        expect(effectiveFocusComponents(tags, pick), label).toEqual(tags);
        expect(effectiveFocusComponents(tags, pick), `${label} vs empty`).toEqual(
          effectiveFocusComponents(tags, []),
        );
      }
    }
  });

  it('never returns anything the corpse does not carry, on any pick', () => {
    // The invariant that survives every arm: whatever comes back is a subset of
    // the corpse's own tags, so a junk string can never reach the grant loop as
    // an unmapped component.
    for (const tags of CORPSES) {
      for (const junk of subsets(JUNK)) {
        for (const valid of subsets(tags)) {
          const out = effectiveFocusComponents(tags, [...valid, ...junk]);
          expect(
            out.filter((c) => !tags.includes(c)),
            JSON.stringify([tags, valid, junk]),
          ).toEqual([]);
        }
      }
    }
  });

  it('is idempotent: feeding a result back in returns it unchanged', () => {
    // The sanitize is a fixed point, which is what lets the pre-claim capacity
    // gate and the roll call it independently and always agree.
    for (const tags of CORPSES) {
      for (const junk of subsets(JUNK)) {
        for (const valid of subsets(tags)) {
          const once = effectiveFocusComponents(tags, [...valid, ...junk]);
          expect(effectiveFocusComponents(tags, once), JSON.stringify([tags, valid, junk])).toEqual(
            once,
          );
        }
      }
    }
  });

  it('keeps first-occurrence ORDER once the junk is gone', () => {
    // Order is load-bearing (#2457): pick order is yield order is chat-line
    // order. Dropping an entry from the middle must close the gap, not reorder
    // what is left.
    expect(effectiveFocusComponents(WIDE, ['fang', 'junk', 'hide'])).toEqual(['fang', 'hide']);
    expect(effectiveFocusComponents(WIDE, ['junk', 'horn', 'zzz', 'claw'])).toEqual([
      'horn',
      'claw',
    ]);
    // A pick that covers every tag still spreads in CONTENT order, not pick
    // order, exactly as it did before this change.
    expect(effectiveFocusComponents(WOLF, ['fang', 'hide'])).toEqual(['hide', 'fang']);
    expect(effectiveFocusComponents(WOLF, ['fang', 'hide', 'junk'])).toEqual(['hide', 'fang']);
  });

  it('composes with the #2474 dedupe: repeats and junk in the same frame', () => {
    // Both sanitizers run before both length tests, so a frame carrying both
    // shapes collapses to the same one family, and neither shape can pad the
    // other past the threshold.
    expect(legacy2503(WOLF, ['hide', 'hide', 'junk'])).toEqual(['hide', 'fang']);
    expect(effectiveFocusComponents(WOLF, ['hide', 'hide', 'junk'])).toEqual(['hide']);
    expect(effectiveFocusComponents(WOLF, ['junk', 'hide', 'junk', 'hide'])).toEqual(['hide']);
    expect(effectiveFocusComponents(BOAR, ['meat', 'junk', 'meat', 'hide'])).toEqual([
      'meat',
      'hide',
    ]);
  });

  it('leaves every duplicate-free pick of REAL tags exactly where #2474 left it', () => {
    // The no-regression half of the acceptance criteria, swept on the corpse
    // widths that actually have a spread threshold to cross (the #2474 sweep
    // runs on four tags, where a short pick can never reach it). Every subset of
    // every corpse, in both orders: if this fix moved anything other than the
    // junk-bearing picks, it fails here.
    for (const tags of CORPSES) {
      for (const pick of subsets(tags).flatMap((s) => [s, [...s].reverse()])) {
        const label = `tags ${JSON.stringify(tags)} pick ${JSON.stringify(pick)}`;
        expect(effectiveFocusComponents(tags, pick), label).toEqual(legacy2503(tags, pick));
      }
    }
  });

  it('makes a junk-padded pick draw and yield EXACTLY what its stripped twin does', () => {
    // End of the pure path: same seed, same yields, same number of draws. The
    // draw count is the decisive half, since spreading is what a padded pick
    // used to spend its extra rolls on.
    const pairs: [readonly string[], string[], string[]][] = [
      [WOLF, ['hide', 'junk'], ['hide']],
      [WOLF, ['junk', 'hide'], ['hide']],
      [WOLF, ['hide', 'junk', 'zzz'], ['hide']],
      [BOAR, ['meat', 'hide', 'junk'], ['meat', 'hide']],
      [WOLF, ['junk', 'zzz'], []],
    ];
    for (const [tags, padded, stripped] of pairs) {
      for (let seed = 1; seed <= 20; seed++) {
        const label = `${JSON.stringify(tags)} ${JSON.stringify(padded)} @${seed}`;
        expect(resolveCorpseFocusHarvest(tags, padded, new Rng(seed)), label).toEqual(
          resolveCorpseFocusHarvest(tags, stripped, new Rng(seed)),
        );
        expect(drawCount(tags, padded, seed), `${label} draws`).toBe(
          drawCount(tags, stripped, seed),
        );
      }
    }
    // Absolute literals under those equalities, so two equal-but-wrong counts
    // cannot pass: one family costs one tier roll, the wolf spread costs two.
    // The padded pick used to cost two here; the all-junk pick used to cost 0.
    expect(drawCount(WOLF, ['hide', 'junk'], 3)).toBe(1);
    expect(drawCount(WOLF, ['hide'], 3)).toBe(1);
    expect(drawCount(WOLF, ['junk', 'zzz'], 3)).toBe(2);
  });

  function drawCount(tagged: readonly string[], chosen: string[], seed: number): number {
    const rng = new Rng(seed);
    let draws = 0;
    rng.setObserver(() => {
      draws++;
    });
    resolveCorpseFocusHarvest(tagged, chosen, rng);
    return draws;
  }
});

// #2509: the one place the "this pick can never yield anything" rule is
// written. The command boundary refuses on it (src/sim/interaction.ts
// harvestCorpse) and the picker's view-core disables Harvest on it
// (src/ui/hud/loot/corpse_harvest_view.ts), so a bug here is a bug in both.
describe('forfeitsEveryMappedYield (#2509)', () => {
  // Anchored to the real table on both sides, with LITERAL sets so the cases
  // below cannot be measuring the table against itself.
  const MAPPED = ['hide', 'fang', 'silk', 'venomSac', 'meat', 'cloth'];
  const UNMAPPED = ['claw', 'tusk', 'gills', 'horn'];

  it('is stated against the families the content really maps', () => {
    expect(Object.keys(HARVEST_COMPONENT_ITEMS).sort()).toEqual([...MAPPED].sort());
    for (const tag of UNMAPPED) expect(HARVEST_COMPONENT_ITEMS[tag]).toBeUndefined();
  });

  it('is true only for a strict pick of nothing but unmapped families', () => {
    const GREYJAW = ['hide', 'fang', 'claw'];
    expect(forfeitsEveryMappedYield(GREYJAW, ['claw'])).toBe(true);
    // ...and false for each of the three ways out, one per term.
    expect(forfeitsEveryMappedYield(GREYJAW, ['claw', 'hide'])).toBe(false); // a mapped family is in
    expect(forfeitsEveryMappedYield(GREYJAW, [])).toBe(false); // empty spreads
    expect(forfeitsEveryMappedYield(['claw', 'tusk'], ['claw'])).toBe(false); // nothing to forfeit
  });

  it('reads the pick through effectiveFocusComponents, not raw', () => {
    // A full cover spreads, so it always reaches the mapped families...
    expect(forfeitsEveryMappedYield(['hide', 'fang', 'claw'], ['hide', 'fang', 'claw'])).toBe(
      false,
    );
    // ...an uncarried tag sanitizes away, so junk alone is the empty pick (#2504)...
    expect(forfeitsEveryMappedYield(['hide', 'fang', 'claw'], ['junk'])).toBe(false);
    // ...but a carried unmapped tag survives, so junk beside it changes nothing (#2504 + #2509).
    expect(forfeitsEveryMappedYield(['hide', 'fang', 'claw'], ['claw', 'junk'])).toBe(true);
    // ...and a repeat collapses to one (#2474).
    expect(forfeitsEveryMappedYield(['hide', 'fang', 'claw'], ['claw', 'claw'])).toBe(true);
  });

  it('needs a corpse with something to give AND a pick that takes none of it', () => {
    // The two-tag shape, where a single entry is the whole refusal.
    expect(forfeitsEveryMappedYield(['gills', 'hide'], ['gills'])).toBe(true);
    expect(forfeitsEveryMappedYield(['gills', 'hide'], ['hide'])).toBe(false);
    // A corpse of nothing but mapped families can never trip it, whatever the pick.
    for (const pick of [[], ['hide'], ['fang'], ['hide', 'fang']]) {
      expect(forfeitsEveryMappedYield(['hide', 'fang'], pick), JSON.stringify(pick)).toBe(false);
    }
  });
});
