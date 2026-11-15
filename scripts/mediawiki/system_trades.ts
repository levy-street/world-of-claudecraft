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
  craftMaxSkillFor,
  STATION_RADIUS,
  STATIONS,
} from '../../src/sim/content/professions';
import { ALL_RECIPES, ITEMS, QUESTS } from '../../src/sim/data';
import { craftCastDurationSec } from '../../src/sim/professions/craft_cast_duration';
import {
  FARM_SURVIVAL_BAND_SPAN,
  farmSurvivalChance,
} from '../../src/sim/professions/farm_projection';
import { trainingFeeFor, trainingStationTypeFor } from '../../src/sim/professions/training';
import {
  MINIMAL_TIER_MULTIPLIER,
  REDUCED_TIER_MULTIPLIER,
  TIER_SKILL_STEP,
  tierForSkill,
} from '../../src/sim/professions/wheel';
import { heading, list, percent, type SystemWriter, words } from './system_writer';

export function addTradeSkills(w: SystemWriter) {
  const item = (id: string) => w.entity('item', id, ITEMS[id]?.name);
  const reagents = (bill: readonly { itemId: string; count: number }[]) =>
    list(bill.map((r) => `${r.count} x ${item(r.itemId)}`));
  const recipeNames = new Map(
    GUIDE_PROF_CRAFTS.flatMap((c) => c.recipes.map((r) => [r.id, r] as const)),
  );
  const recipeTitles = new Map<string, string>();
  const stationLocation = (station: (typeof STATIONS)[number]) => {
    const location = GUIDE_PROF_STATIONS.stations.find((s) => s.id === station.id);
    const round = (n: number) => Math.round(n * 10) / 10;
    return `${location?.hub ?? w.entity('zone', station.zoneId)}, x ${round(station.pos.x)}, z ${round(station.pos.z)}`;
  };
  const patterns = new Map<string, string[]>();
  for (const definition of Object.values(ITEMS)) {
    if (definition.kind !== 'recipe') continue;
    for (const id of definition.teachesRecipeIds ?? [definition.teachesRecipeId]) {
      const entries = patterns.get(id) ?? [];
      entries.push(item(definition.id));
      patterns.set(id, entries);
    }
  }
  for (const r of ALL_RECIPES) {
    const guide = recipeNames.get(r.id);
    const combo = r.comboRequirement;
    const trainer = r.acquisition?.includes('trainer')
      ? STATIONS.find((s) => s.type === trainingStationTypeFor(r))
      : undefined;
    const patternNames = patterns.get(r.id);
    const cap = craftMaxSkillFor(r.professionId);
    const tier = tierForSkill(r.skillReq);
    const gains = [1, REDUCED_TIER_MULTIPLIER, MINIMAL_TIER_MULTIPLIER, 0].flatMap((gain, i) => {
      const start = i === 0 ? 0 : (tier + i) * TIER_SKILL_STEP;
      const end = i === 3 ? cap : Math.min((tier + i + 1) * TIER_SKILL_STEP, cap);
      return start < end ? [`From skill ${start} until ${end}: ${gain} skill per craft.`] : [];
    });
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
        ' seconds, not counting anything that makes crafting faster.',
      heading(
        'Requirements',
        list([
          `This is a tier ${tier} ${words(r.professionId)} recipe. Once you learn it, you can attempt it below its listed skill of ${r.skillReq}, as long as you meet the other rules below.`,
          ...(combo
            ? [
                'Choose ' +
                  words(combo.craftA) +
                  ' and ' +
                  words(combo.craftB) +
                  ' as your two major crafts. Raise both to at least tier ' +
                  combo.minTier +
                  '.',
              ]
            : []),
          r.stationType
            ? 'Stand within ' +
              STATION_RADIUS +
              ' yards of a ' +
              words(r.stationType) +
              ' station, or a mobile station of the same kind.'
            : 'You can craft it anywhere, with no station.',
          r.acquisition?.length
            ? 'Learn it from ' +
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
            : 'You know it automatically.',
          ...(r.oncePerDay
            ? [
                'Each character can make it only once per day. The count starts again at the daily reset.',
              ]
            : []),
          ...(r.consumeOnCraft ? ['When you make it, you forget this recipe.'] : []),
        ]),
      ),
      trainer
        ? `Talk to ${w.entity('npc', trainer.masterNpcId)}, who works at the ${words(trainer.type)} station at ${stationLocation(trainer)}. Once your ${words(r.professionId)} skill is ${tier * TIER_SKILL_STEP} or higher, choose Training and learn the recipe for ${trainingFeeFor(r)} copper.`
        : '',
      patternNames?.length
        ? `Use ${patternNames.join(' or ')} to learn this recipe. Follow the item link to see where to get it.`
        : '',
      heading(
        'Skill gain',
        gains.length
          ? list([
              ...gains,
              `At ${cap}, the highest skill for this profession, your skill stops going up. A recipe above the tier your crafting archetype allows gives no skill at all.`,
            ])
          : `Your skill stops going up at ${cap}.`,
      ),
      heading('Base material cost', reagents(r.reagents)),
      'Each craft also costs up to ' +
        Math.ceil(r.itemLevelBudget * CRAFT_GOLD_SINK_COPPER_PER_BUDGET) +
        ' copper. If you have less than that, it takes all the copper you have left.',
    );
    recipeTitles.set(r.id, articleTitle);
    w.registerArt('recipe', r.id, articleTitle);
  }
  for (const c of GUIDE_PROF_CRAFTS) {
    const craftRecipes = ALL_RECIPES.filter((r) => r.professionId === c.id).sort(
      (a, b) => a.skillReq - b.skillReq || a.id.localeCompare(b.id, 'en'),
    );
    w.describe(
      c.name,
      c.name +
        ' is a crafting profession. The highest skill you can reach is ' +
        c.maxSkill +
        '. ' +
        (c.station ? `Recipes that need a station use the ${words(c.station)}.` : ''),
      c.masters.length
        ? heading('Trainers', list(c.masters.map((m) => `${m.name}, ${m.title} in ${m.hub}`)))
        : '',
      'At skill ' +
        c.specialization.at +
        ' you become specialized. Then you need ' +
        c.specialization.materialDiscountPct +
        '% fewer of the materials the discount covers. The amount is rounded down, but you always need at least 1 of each material. Raid cores always cost the full amount.',
      craftRecipes.length
        ? heading(
            'Recipes by listed skill',
            list(
              craftRecipes.map(
                (r) =>
                  `Skill ${r.skillReq}: [[${recipeTitles.get(r.id)}|${recipeNames.get(r.id)?.name ?? ITEMS[r.resultItemId].name}]]`,
              ),
            ),
          )
        : '',
    );
  }
  const mw = GUIDE_PROF_MASTERWORK;
  w.describe(
    'Masterwork crafting',
    'Equipment that can become a masterwork starts with a ' +
      mw.basePct +
      '% chance. Then add these percentage points:\n' +
      list([
        `+${mw.perTierAbovePct} for each skill tier you are above the recipe.`,
        `+${mw.signedReagentPct} for a signed reagent.`,
        `+${mw.specializedPct} if you are specialized.`,
        '+1 to 2 for higher-tier materials.',
      ]) +
      '\nThe chance can never go above ' +
      mw.capPct +
      '%.',
    'A masterwork makes normal gear one quality tier better. Top-tier (apex) Masterwrought gear gets its first Perfecting rank instead. Tools, consumables and other items without stats can never become masterworks.',
  );
  w.describe(
    'Crafting stations',
    `Stand within ${GUIDE_PROF_STATIONS.radius} yards to use a station.`,
    'To learn a recipe from a master, talk to the master at the station and choose Training. A mobile station lets you craft some station recipes away from town. To learn a recipe from a master, you still have to visit the real station.',
    list(
      STATIONS.map(
        (s) =>
          `${words(s.type)}: station at ${stationLocation(s)}, in ${w.entity('zone', s.zoneId)}. Master: ${w.entity('npc', s.masterNpcId)}.`,
      ),
    ),
  );
  for (const p of GUIDE_PROF_GATHERING) {
    w.describe(
      p.name,
      `${p.name} is a gathering profession. The highest proficiency (skill) you can reach is ${p.maxSkill}.`,
      ...(p.respawnSeconds
        ? [`After you gather a node, it comes back for you after ${p.respawnSeconds} seconds.`]
        : []),
      heading(
        'Tools',
        list(
          p.tools.map(
            (t) =>
              t.name +
              ', tier ' +
              t.tier +
              (t.wieldProficiency ? `, needs proficiency ${t.wieldProficiency}` : '') +
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
                    ': ' +
                    n.count +
                    ' tier ' +
                    n.tier +
                    ' nodes that give ' +
                    n.material +
                    ' (needs a tier ' +
                    n.toolTier +
                    ' tool or better).',
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
        'With a basic rod, a fish bites after ' +
          f.biteMinSec +
          ' to ' +
          f.biteMaxSec +
          ' seconds. After the bite, you have ' +
          f.reelWindowSec +
          ' seconds to reel it in. Each rod tier above the first makes the longest wait ' +
          f.rodBiteReductionSec +
          ' seconds shorter. It also gives you ' +
          f.reelRodBonusSec +
          ' more seconds to reel in. A rod of better rarity can add a little more time on top of that. Each cast ends after ' +
          f.sessionCapSec +
          ' seconds at most.',
      );
      for (const band of f.bandTables) {
        w.describe(
          p.name,
          heading(
            `Band ${band.band}`,
            'You need proficiency ' +
              band.minProficiency +
              ' and a rod of tier ' +
              band.rodTierRequired +
              ' or better.\n' +
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
        ' once your farming skill is ' +
        skill +
        ' or higher. The crop takes ' +
        crop.durationMs / 60000 +
        ' minutes to grow, and it keeps growing while you are logged off. If it survives, you get ' +
        item(crop.produceItemId) +
        ', or the better fine grade, ' +
        item(crop.fineProduceItemId) +
        '.',
      'Without compost or a watch, the chance that the crop survives is ' +
        percent(farmSurvivalChance(skill, crop.tier, false, false)) +
        ' at skill ' +
        skill +
        '. The chance goes up evenly with your skill, until it reaches 100% at skill ' +
        (skill + FARM_SURVIVAL_BAND_SPAN) +
        '. At skill ' +
        skill +
        ', compost alone makes it ' +
        percent(farmSurvivalChance(skill, crop.tier, true, false)) +
        ' and a watch alone makes it ' +
        percent(farmSurvivalChance(skill, crop.tier, false, true)) +
        '. Using both adds their bonuses together, up to 100%.',
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
      'Put this on ' +
        words(e.itemSlot) +
        (e.weaponHand ? ' (two-handed weapons only)' : '') +
        '. ' +
        (e.skillReq
          ? `You need Enchanting skill ${e.skillReq}. `
          : 'You can apply it at any skill level. ') +
        (e.requiresPerfected ? 'The item must be Perfected. ' : '') +
        (e.acquisition ? 'Learn the formula first.' : 'You know it automatically.'),
      e.description ?? '',
      list(
        Object.entries(e.statBonus).map(([stat, v]) => `+${v} ${statNames[stat] ?? words(stat)}`),
      ),
      ...(e.weaponProc
        ? [
            'Each melee hit that lands with the enchanted weapon can trigger it. On average, it triggers ' +
              e.weaponProc.ppm +
              ' times per minute. The buff lasts ' +
              e.weaponProc.duration +
              ' seconds. A new trigger restarts the timer. The buff does not stack, even with two enchanted weapons.',
          ]
        : []),
      heading('Reagents', reagents(e.reagents)),
    );
  }
  const orders = GUIDE_PROF_ECONOMY.workOrders;
  w.describe(
    'Profession work orders',
    `You can do each station master's order again ${orders.cadenceMinutes} minutes after you finish it.`,
  );
  for (const o of orders.orders) {
    const quest = QUESTS[o.id];
    w.article(
      'Profession work orders',
      o.name,
      'Work order',
      'Bring ' +
        o.count +
        ' x ' +
        o.material +
        ' to ' +
        o.master +
        ' at ' +
        o.hub +
        '. The order pays ' +
        o.coinCopper +
        ' copper and ' +
        quest.xpReward +
        ' quest XP.',
      'Talk to ' +
        w.entity('npc', quest.giverNpcId, o.master) +
        ' and accept the work order. Come back when you have all of it. See ' +
        w.entity('quest', quest.id, quest.name) +
        ' for the route and where to hand it in.',
    );
  }
}
