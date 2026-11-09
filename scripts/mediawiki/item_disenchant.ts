import { ENCHANT_FAMILY_CAST_DURATION_SEC } from '../../src/sim/content/professions';
import { ITEMS } from '../../src/sim/data';
import { disenchantYieldPreview } from '../../src/ui/hud/professions/disenchant_yield_view';
import { type ArticleTools, ref } from './entity_format';
import { addAcquisition, type ItemAcquisition } from './item_acquisition_types';

const MATERIAL_INPUTS: Record<string, string> = {
  arcane_dust: 'common or uncommon weapons, armor or held offhands',
  arcane_essence: 'rare weapons, armor or held offhands',
  arcane_shard: 'epic or legendary weapons, armor or held offhands',
  resonant_thread: 'rare, epic or legendary cloth armor',
  resonant_hide: 'rare, epic or legendary leather armor',
  resonant_links: 'rare, epic or legendary mail armor',
  resonant_steel: 'rare, epic or legendary weapons other than staves, wands, bows and crossbows',
  resonant_timber: 'rare, epic or legendary staves, wands, bows or crossbows',
};

/** Reuse the live confirmation preview so examples use the same eligibility and yields. */
export function addDisenchantAcquisitions(
  w: ArticleTools,
  index: Map<string, ItemAcquisition[]>,
): void {
  const candidates = Object.values(ITEMS)
    .map((item) => ({ item, yield: disenchantYieldPreview(item) }))
    .filter((entry) => entry.yield);
  for (const [id, inputs] of Object.entries(MATERIAL_INPUTS)) {
    const eligible = candidates.filter(
      (entry) => entry.yield!.primary.itemId === id || entry.yield!.secondary?.itemId === id,
    );
    // A concrete mapped purchase is an optional starting route, not a claim that
    // disenchanting requires a trainer, station, or particular piece of equipment.
    const example = eligible
      .filter((entry) =>
        index
          .get(entry.item.id)
          ?.some((source) => source.title.startsWith('Buy ') && source.points?.length),
      )
      .sort((a, b) => (a.item.buyValue ?? Infinity) - (b.item.buyValue ?? Infinity))[0];
    const source =
      example &&
      index
        .get(example.item.id)!
        .find((method) => method.title.startsWith('Buy ') && method.points?.length);
    const line =
      example &&
      (example.yield!.primary.itemId === id ? example.yield!.primary : example.yield!.secondary!);
    const exampleText =
      example && line
        ? 'One item you can get is ' +
          ref(w, 'item', example.item.id) +
          '. See that item’s page for how to buy it and its price. Its seller is shown on this map. Disenchanting one gives you ' +
          (line.min === line.max
            ? line.min
            : line.min + ' or ' + line.max + ' (50% chance of each)') +
          ' × ' +
          ref(w, 'item', id) +
          '.'
        : 'See each equipment item’s page for how to get it. You can disenchant anywhere, so there is no set place on the map.';
    addAcquisition(index, id, {
      title: 'Disenchant equipment',
      steps: [
        'Get one of these: ' +
          inputs +
          '. Borrowed gear and pieces that cannot be salvaged do not work. ' +
          exampleText,
        'Put the piece in your bags. If it is locked, unlock it. Open its item menu and choose Disenchant. Check which materials it will give, then confirm Disenchant. This destroys the piece, along with any enchantment on it.',
        'Finish the ' +
          ENCHANT_FAMILY_CAST_DURATION_SEC +
          '-second cast. The materials go straight into your bags, wherever you are standing. Leave enough bag space for the most it could give you. Do not move the item while you cast.',
      ],
      details: [
        'Any character can disenchant, regardless of Enchanting skill or which main professions you picked. You do not need a trainer, recipe, station, hand-in or coins.',
        id === 'arcane_dust'
          ? 'To work out the dust, take the level needed to equip the piece, divide by 10 and drop any remainder. A common piece gives 2 plus that number. An uncommon piece gives 3 plus that number. Either way, there is a 50% chance of 1 extra. For example, a common piece that needs level 25 gives 4 or 5 dust. The confirm box shows the two amounts your piece can give.'
          : id === 'arcane_essence' || id === 'arcane_shard'
            ? 'Each piece that works always gives exactly 1 of this material. Rare or better cloth, leather, mail and weapons also give their matching Resonant material. Jewelry with no armor type and held offhands do not give a Resonant material.'
            : 'A rare piece always gives exactly 1 of this material. An epic or legendary piece gives 1 or 2, with a 50% chance of each. You also get 1 ' +
              ref(w, 'item', 'arcane_essence') +
              ' from rare gear or 1 ' +
              ref(w, 'item', 'arcane_shard') +
              ' from epic or legendary gear. The Resonant material becomes bound to you when traded. The main arcane material does not.',
        'You can disenchant crafted gear for these materials, but it does not raise your Enchanting skill.',
      ],
      points: source?.points
        ?.filter((point) => point.step !== 'Reward')
        .map((point) => ({
          ...point,
          label: point.label + ' · one place to buy gear you can disenchant (optional)',
        })),
    });
  }
}
