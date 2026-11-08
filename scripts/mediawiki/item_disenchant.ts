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
        ? 'One obtainable example is ' +
          ref(w, 'item', example.item.id) +
          '. Follow that item’s purchase instructions and price; its seller is shown on this map. Disenchanting one yields ' +
          (line.min === line.max ? line.min : line.min + ' or ' + line.max + ' (50% each)') +
          ' × ' +
          ref(w, 'item', id) +
          '.'
        : 'Follow the equipment item pages for their acquisition routes. There is no fixed disenchanting location.';
    addAcquisition(index, id, {
      title: 'Disenchant equipment',
      steps: [
        'Obtain one of the following: ' +
          inputs +
          '. Borrowed equipment and pieces that cannot be salvaged are excluded. ' +
          exampleText,
        'Put the piece in your bags and unlock it if it is locked. Open its item action menu and choose Disenchant. Check the displayed material yield, then confirm Disenchant. This consumes the selected piece, including any enchantment on it.',
        'Finish the ' +
          ENCHANT_FAMILY_CAST_DURATION_SEC +
          '-second cast. The materials arrive in your bags where you are standing. Leave enough bag space for the maximum possible yield and do not move the selected item during the cast.',
      ],
      details: [
        'Any character can disenchant, regardless of Enchanting skill or chosen major professions. No trainer, recipe, station, hand-in or coin fee is required.',
        id === 'arcane_dust'
          ? 'A common piece gives 2 + floor(required equipment level ÷ 10) dust, with a 50% chance of one extra. An uncommon piece gives 3 + floor(required equipment level ÷ 10), with the same 50% chance of one extra. The confirmation shows the exact two possible quantities for your piece.'
          : id === 'arcane_essence' || id === 'arcane_shard'
            ? 'Each eligible piece always gives exactly 1 of this material. Rare-or-better cloth, leather, mail and weapons also give their matching Resonant material. Jewelry without an armor type and held offhands do not give a Resonant material.'
            : 'A rare piece always gives exactly 1 of this material. An epic or legendary piece gives 1 or 2, with a 50% chance of each. You also receive 1 ' +
              ref(w, 'item', 'arcane_essence') +
              ' from rare gear or 1 ' +
              ref(w, 'item', 'arcane_shard') +
              ' from epic or legendary gear. The Resonant material binds when traded; the primary arcane material does not.',
        'Crafted equipment can be disenchanted for these materials, but does not award Enchanting skill from that disenchant.',
      ],
      points: source?.points
        ?.filter((point) => point.step !== 'Reward')
        .map((point) => ({
          ...point,
          label: point.label + ' · optional example equipment source',
        })),
    });
  }
}
