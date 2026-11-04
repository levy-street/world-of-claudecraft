import {
  GUIDE_PROF_CRAFTS,
  GUIDE_PROF_ECONOMY,
  GUIDE_PROF_GATHERING,
  GUIDE_PROF_MASTERWORK,
  GUIDE_PROF_STATIONS,
} from '../../src/guide/content.generated';
import { ENCHANTS } from '../../src/sim/content/enchants';
import { FARM_CROPS, farmCropSkillThreshold } from '../../src/sim/content/farm_crops';
import {
  CRAFT_GOLD_SINK_COPPER_PER_BUDGET,
  STATION_RADIUS,
} from '../../src/sim/content/professions';
import { ALL_RECIPES, ITEMS } from '../../src/sim/data';
import { craftCastDurationSec } from '../../src/sim/professions/craft_cast_duration';
import {
  FARM_SURVIVAL_BAND_SPAN,
  farmSurvivalChance,
} from '../../src/sim/professions/farm_projection';
import { trainingFeeFor } from '../../src/sim/professions/training';
import { heading, list, percent, type SystemWriter, words } from './system_writer';

export function addTradeSkills(w: SystemWriter) {
  const item = (id: string) => w.entity('item', id, ITEMS[id]?.name);
  const reagents = (bill: readonly { itemId: string; count: number }[]) =>
    list(bill.map((r) => `${r.count} x ${item(r.itemId)}`));
  const recipeNames = new Map(
    GUIDE_PROF_CRAFTS.flatMap((c) => c.recipes.map((r) => [r.id, r] as const)),
  );
  for (const r of ALL_RECIPES) {
    const guide = recipeNames.get(r.id);
    const combo = r.comboRequirement;
    const articleTitle = w.article(
      {
        owner: 'Crafting recipes',
        section: r.professionId.charAt(0).toUpperCase() + r.professionId.slice(1),
      },
      guide?.name ?? ITEMS[r.resultItemId].name,
      'Recipe',
      'Makes ' +
        r.resultCount +
        ' x ' +
        item(r.resultItemId) +
        '. Each craft takes ' +
        craftCastDurationSec(r) +
        ' seconds before speed modifiers.',
      heading(
        'Requirements',
        list([
          `Requires ${words(r.professionId)} skill ${r.skillReq}.`,
          ...(combo
            ? [
                'Both ' +
                  words(combo.craftA) +
                  ' and ' +
                  words(combo.craftB) +
                  ' must be at least tier ' +
                  combo.minTier +
                  '.',
              ]
            : []),
          r.stationType
            ? 'Work within ' +
              STATION_RADIUS +
              ' yards of a ' +
              words(r.stationType) +
              ' station or a matching mobile station.'
            : 'Can be crafted in the field.',
          r.acquisition?.length
            ? 'Learn from ' +
              r.acquisition
                .map(
                  (a) =>
                    ({
                      trainer: `a profession trainer (${trainingFeeFor(r)} copper)`,
                      drop: 'a pattern',
                      quest: 'a quest',
                    })[a],
                )
                .join(' or ') +
              '.'
            : 'Known automatically.',
          ...(r.oncePerDay ? ['Limited to one successful craft per character per reset day.'] : []),
          ...(r.consumeOnCraft
            ? ['A successful craft consumes your knowledge of this recipe.']
            : []),
        ]),
      ),
      heading('Base material cost', reagents(r.reagents)),
      'The craft also deducts up to ' +
        Math.ceil(r.itemLevelBudget * CRAFT_GOLD_SINK_COPPER_PER_BUDGET) +
        ' copper. If you have less, the craft uses your remaining copper.',
    );
    w.registerArt('recipe', r.id, articleTitle);
  }
  for (const c of GUIDE_PROF_CRAFTS) {
    w.describe(
      c.name,
      'The maximum skill is ' +
        c.maxSkill +
        '. ' +
        (c.station ? `Station recipes use the ${words(c.station)}.` : ''),
      heading('Trainers', list(c.masters.map((m) => `${m.name}, ${m.title} in ${m.hub}`))),
      'Specialization begins at skill ' +
        c.specialization.at +
        ' and gives a ' +
        c.specialization.materialDiscountPct +
        '% material discount on eligible inputs.',
      'See [[Crafting recipes]] for materials, station requirements and results.',
    );
  }
  const mw = GUIDE_PROF_MASTERWORK;
  w.describe(
    'Masterwork crafting',
    'Eligible equipment has a ' +
      mw.basePct +
      '% base chance to become a masterwork. Add ' +
      mw.perTierAbovePct +
      ' percentage points per skill tier above the recipe, ' +
      mw.signedReagentPct +
      ' for a signed reagent and ' +
      mw.specializedPct +
      ' for specialization. Higher-tier materials add a further 1 to 2 points. The final chance caps at ' +
      mw.capPct +
      '%.',
    'A masterwork improves ordinary gear by one quality tier. An apex Masterwrought craft gains its first Perfecting rank instead. Tools, consumables and other statless outputs cannot become masterworks.',
  );
  w.describe(
    'Crafting stations',
    `Stand within ${GUIDE_PROF_STATIONS.radius} yards to use a station.`,
    list(GUIDE_PROF_STATIONS.stations.map((s) => `${words(s.type)} in ${s.hub}, ${s.zone}`)),
  );
  for (const p of GUIDE_PROF_GATHERING) {
    w.describe(
      p.name,
      `The maximum proficiency is ${p.maxSkill}.`,
      ...(p.respawnSeconds ? [`Nodes respawn after ${p.respawnSeconds} seconds.`] : []),
      heading(
        'Tools',
        list(
          p.tools.map(
            (t) =>
              t.name +
              ', tier ' +
              t.tier +
              (t.wieldProficiency ? `, requires proficiency ${t.wieldProficiency}` : '') +
              (t.priceCopper ? `, costs ${t.priceCopper} copper` : '') +
              (t.craftedBy ? `, crafted by ${t.craftedBy}` : '') +
              (t.priceMarks ? `, costs ${t.priceMarks} Delve Marks` : ''),
          ),
        ),
      ),
      ...(p.nodes?.length
        ? [
            heading(
              'Gathering locations',
              list(
                p.nodes.map(
                  (n) =>
                    n.zone +
                    ', ' +
                    n.count +
                    ' tier ' +
                    n.tier +
                    ' nodes yielding ' +
                    n.material +
                    ' (tool tier ' +
                    n.toolTier +
                    ').',
                ),
              ),
            ),
          ]
        : []),
    );
    if (p.fishing) {
      const f = p.fishing;
      w.describe(
        p.name,
        'A bite takes ' +
          f.biteMinSec +
          ' to ' +
          f.biteMaxSec +
          ' seconds with a basic rod. Reel in within ' +
          f.reelWindowSec +
          ' seconds of the bite. Each rod tier above the first cuts the maximum wait by ' +
          f.rodBiteReductionSec +
          ' seconds and increases the reel window by ' +
          f.reelRodBonusSec +
          ' seconds before rarity bonuses. A session ends after ' +
          f.sessionCapSec +
          ' seconds.',
      );
      for (const band of f.bandTables) {
        w.describe(
          p.name,
          heading(
            `Band ${band.band}`,
            'Requires proficiency ' +
              band.minProficiency +
              ' and rod tier ' +
              band.rodTierRequired +
              '.\n' +
              list(
                band.zones.map(
                  (z) =>
                    z.zone +
                    ': ' +
                    z.rows.map((r) => `${r.name ?? 'Empty hook'} ${r.pct}%`).join(', '),
                ),
              ),
          ),
        );
      }
    }
  }
  for (const crop of Object.values(FARM_CROPS)) {
    const skill = farmCropSkillThreshold(crop.tier);
    w.article(
      'Farm crops',
      ITEMS[crop.produceItemId].name,
      'Crop',
      'Plant ' +
        item(crop.seedItemId) +
        ' at farming skill ' +
        skill +
        ' or higher. The crop grows for ' +
        crop.durationMs / 60000 +
        ' minutes, including time spent offline. A successful harvest gives ' +
        item(crop.produceItemId) +
        ' or the fine grade, ' +
        item(crop.fineProduceItemId) +
        '.',
      'Without compost or a watch, survival rises linearly from ' +
        percent(farmSurvivalChance(skill, crop.tier, false, false)) +
        ' at skill ' +
        skill +
        ' to 100% at skill ' +
        (skill + FARM_SURVIVAL_BAND_SPAN) +
        '. At the gate compost alone gives ' +
        percent(farmSurvivalChance(skill, crop.tier, true, false)) +
        ' and a watch alone gives ' +
        percent(farmSurvivalChance(skill, crop.tier, false, true)) +
        '. They stack up to 100%.',
    );
  }
  const statNames: Record<string, string> = {
    str: 'Strength',
    agi: 'Agility',
    int: 'Intellect',
    spi: 'Spirit',
    sta: 'Stamina',
  };
  for (const e of Object.values(ENCHANTS)) {
    w.article(
      'Equipment enchants',
      e.name,
      'Enchant',
      'Apply to ' +
        words(e.itemSlot) +
        (e.weaponHand ? ' (two-handed weapons only)' : '') +
        '. ' +
        (e.skillReq
          ? `The enchanter needs skill ${e.skillReq}. `
          : 'Any skill level can apply it. ') +
        (e.requiresPerfected ? 'The target item must be Perfected. ' : '') +
        (e.acquisition ? 'Learn the formula first.' : 'Known automatically.'),
      e.description ?? '',
      list(
        Object.entries(e.statBonus).map(([stat, v]) => `+${v} ${statNames[stat] ?? words(stat)}`),
      ),
      ...(e.weaponProc
        ? [
            'On eligible melee hits, triggers at ' +
              e.weaponProc.ppm +
              ' procs per minute on average. The buff lasts ' +
              e.weaponProc.duration +
              ' seconds.',
          ]
        : []),
      heading('Reagents', reagents(e.reagents)),
    );
  }
  const orders = GUIDE_PROF_ECONOMY.workOrders;
  w.describe('Profession work orders', `Orders rotate every ${orders.cadenceMinutes} minutes.`);
  for (const o of orders.orders)
    w.article(
      'Profession work orders',
      o.name,
      'Work order',
      'Deliver ' +
        o.count +
        ' x ' +
        o.material +
        ' to ' +
        o.master +
        ' at ' +
        o.hub +
        '. The order pays ' +
        o.coinCopper +
        ' copper.',
    );
}
