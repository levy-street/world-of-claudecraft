import { FARM_CROPS, farmCropSkillThreshold } from '../../src/sim/content/farm_crops';
import { FISHING_TABLES_BY_BAND } from '../../src/sim/content/items';
import {
  HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS,
  monsterMaterialTierFor,
} from '../../src/sim/content/professions';
import { DEEPFEN_SHALLOWS_LAKE } from '../../src/sim/content/zone2';
import {
  BUILTIN_WORLD,
  farmPatchesInActiveWorld,
  gatherNodesInActiveWorld,
  getActiveWorldContent,
  ITEMS,
  MOBS,
  ZONES,
  zoneContaining,
} from '../../src/sim/data';
import { PLAYER_SWIM_DEPTH } from '../../src/sim/pathfind';
import {
  FARM_GOLDEN_BONUS_PATTERN_CHANCE,
  FARM_GOLDEN_BONUS_PATTERN_IDS,
  farmGoldenBonusSeedTier,
  farmSeedIdsOfTier,
} from '../../src/sim/professions/farm_golden_bonus';
import { farmSurvivalChance } from '../../src/sim/professions/farm_projection';
import { watchFeeAmount } from '../../src/sim/professions/farm_watch_fee';
import {
  FARM_SEED_BACK_MIN_TIER,
  FARM_SEED_BACK_ONE_CHANCE,
  FARM_SEED_BACK_TWO_CHANCE,
} from '../../src/sim/professions/farming';
import { firstFishableSampleAhead } from '../../src/sim/professions/fishing';
import { FISHING_CATCH_BAND_THRESHOLDS } from '../../src/sim/professions/fishing_bands';
import {
  FISHING_ZONE_ROD_TIERS,
  rodTierRequiredForZone,
} from '../../src/sim/professions/fishing_zones';
import {
  GATHER_RARE_EVENT_CHANCE,
  GATHER_RARE_EVENT_YIELD_MULT,
} from '../../src/sim/professions/gather_events';
import { NODE_HARVEST_TABLE } from '../../src/sim/professions/gathering';
import { nodeMaterialFor } from '../../src/sim/professions/gathering_materials';
import { materialSourceInfo } from '../../src/sim/professions/gathering_source_locations';
import {
  fineGradeReachable,
  fineMaterialFor,
  gatherMaterialTier,
} from '../../src/sim/professions/material_grades';
import { wieldRequirementFor } from '../../src/sim/professions/wield_gate';
import { groundHeight, waterLevel } from '../../src/sim/world';
import { WORLD_SEED } from '../../src/sim/world_seed';
import { type ArticleTools, pct, ref } from './entity_format';
import { addAcquisition, type ItemAcquisition } from './item_acquisition_types';
import type { RoutePoint } from './quest_map';

const coords = (p: { x: number; z: number }) =>
  `x ${Number(p.x.toFixed(1))}, z ${Number(p.z.toFixed(1))}`;
const pin = (step: RoutePoint['step'], p: { x: number; z: number }, label: string): RoutePoint => ({
  step,
  frame: 'Overworld',
  x: p.x,
  z: p.z,
  label,
});

/** One source scan per wiki build. No player state or simulated random rolls. */
export function gatheringAcquisitions(w: ArticleTools): Map<string, ItemAcquisition[]> {
  const out = new Map<string, ItemAcquisition[]>();
  const item = (id: string) => ref(w, 'item', id);
  const zone = (id: string) => ref(w, 'zone', id);
  const nodes = gatherNodesInActiveWorld();
  const nodeGroups = new Map<string, typeof nodes>();
  for (const node of nodes) {
    const base = nodeMaterialFor(node.type, node.zoneId).itemId;
    // A node above the material's grade tier necessarily upgrades with every
    // tool that can work it, so it cannot be advertised as a base-grade source.
    const ids = node.tier <= (gatherMaterialTier(base) ?? Infinity) ? [base] : [];
    const fine = fineMaterialFor(base);
    if (fine && fineGradeReachable(base, node.tier)) ids.push(fine);
    for (const id of ids) {
      const key = `${id}|${node.zoneId}|${node.type}`;
      nodeGroups.set(key, [...(nodeGroups.get(key) ?? []), node]);
    }
  }
  for (const [key, sites] of nodeGroups) {
    const [id, zoneId] = key.split('|');
    const first = [...sites].sort((a, b) => a.tier - b.tier)[0];
    const base = nodeMaterialFor(first.type, zoneId).itemId;
    const fine = id !== base;
    const profession = NODE_HARVEST_TABLE[first.type].professionId;
    const title = profession[0].toUpperCase() + profession.slice(1);
    const minimumTier = Math.max(first.tier, fine ? (gatherMaterialTier(base) ?? 0) + 1 : 1);
    const tools = Object.values(ITEMS).filter(
      (i) =>
        i.use?.type === 'gatherTool' &&
        i.use.professionId === profession &&
        i.use.tier === minimumTier,
    );
    const firstLabel = `${title} node in ${ZONES.find((z) => z.id === zoneId)?.name ?? zoneId}`;
    addAcquisition(out, id, {
      title: `${title} in ${ZONES.find((z) => z.id === zoneId)?.name ?? zoneId}`,
      steps: [
        `Carry a tier ${minimumTier} or better ${title.toLowerCase()} tool${tools.length ? ` such as ${item(tools[0].id)}` : ''}. The minimum tool needs ${wieldRequirementFor(profession, minimumTier)} ${title.toLowerCase()} proficiency to use. Follow the tool's item page to obtain it.`,
        `Go to the sample node in ${zone(zoneId)} at ${coords(first.pos)}. Click the node and stay still until the gathering cast completes.`,
        `The material goes into your bags at the node. Leave room before gathering. The same node becomes available to you again after ${NODE_HARVEST_TABLE[first.type].respawnSeconds / 60} minutes.`,
      ],
      details: [
        fine
          ? `This fine grade is a guaranteed upgrade when your usable tool tier is strictly above material tier ${gatherMaterialTier(base)} and the node is at least that material tier. It replaces ${item(base)} for that harvest. It is not a random fine-material drop.`
          : `A completed harvest gives this material unless a higher usable tool or quality tool effect upgrades it to ${fineMaterialFor(base) ? item(fineMaterialFor(base)!) : 'a fine grade'}. To keep the ordinary grade, use a tool no higher than material tier ${gatherMaterialTier(base)} on a node that tool can work, or use a lower-tier node that cannot produce the fine grade.`,
        'Without tool effects, each harvest gives 1, 2, 2, 3 or 4 units on a common, uncommon, rare, epic or legendary material roll. With proficiency P capped between 0 and 100, their probabilities are (100 − P)%, (0.60 × P)%, (0.30 × P)%, (0.08 × P)% and (0.02 × P)%. These rolls change quantity, separately from the base/fine grade.',
        `A separate rare-event roll has a ${pct(GATHER_RARE_EVENT_CHANCE)} chance per completed harvest and multiplies the yield by ${GATHER_RARE_EVENT_YIELD_MULT}. Charged tool effects can further change quantity or grade. See ${w.link(title)} and ${w.link('Professions')}.`,
        `All ${sites.length} eligible nodes in this zone are at ${sites.map((n) => `${coords(n.pos)} (node tier ${n.tier})`).join(' / ')}. The map marks the sample node and its collection point.`,
      ],
      points: [
        pin('Start', first.pos, firstLabel),
        pin('Reward', first.pos, `Gather and collect ${ITEMS[id].name}`),
      ],
    });
  }

  // Verify a standing point and an accepted cast with the game's terrain and
  // forward-sampling functions, rather than assuming a lake disc is fishable.
  const shores = new Map<string, { x: number; z: number; target: { x: number; z: number } }>();
  for (const z of ZONES) {
    if (!Object.hasOwn(FISHING_ZONE_ROD_TIERS, z.id)) continue;
    outer: for (const lake of z.lakes) {
      for (const radius of [0.7, 0.85, 1, 1.15]) {
        for (let direction = 0; direction < 32; direction++) {
          const angle = (direction * Math.PI) / 16;
          const p = {
            x: Number((lake.x + Math.sin(angle) * lake.radius * radius).toFixed(1)),
            z: Number((lake.z + Math.cos(angle) * lake.radius * radius).toFixed(1)),
          };
          if (
            zoneContaining(p.x, p.z)?.id !== z.id ||
            groundHeight(p.x, p.z, WORLD_SEED) < waterLevel() - PLAYER_SWIM_DEPTH
          )
            continue;
          const facing = Math.atan2(lake.x - p.x, lake.z - p.z);
          const target = firstFishableSampleAhead(p.x, p.z, facing, WORLD_SEED);
          if (target) {
            const aim = { x: Number(target.x.toFixed(1)), z: Number(target.z.toFixed(1)) };
            if (
              !firstFishableSampleAhead(p.x, p.z, Math.atan2(aim.x - p.x, aim.z - p.z), WORLD_SEED)
            )
              continue;
            shores.set(z.id, { ...p, target: aim });
            break outer;
          }
        }
      }
    }
  }
  for (const [zoneId, shore] of shores) {
    const catches = new Map<string, string[]>();
    FISHING_TABLES_BY_BAND.forEach((tables, band) => {
      const table = tables[zoneId] ?? tables.eastbrook_vale;
      const total = table.reduce((sum, entry) => sum + entry.weight, 0);
      const weights = new Map<string, number>();
      for (const entry of table)
        if (entry.itemId)
          weights.set(entry.itemId, (weights.get(entry.itemId) ?? 0) + entry.weight);
      for (const [id, weight] of weights) {
        const minimumTier = Math.max(band + 1, rodTierRequiredForZone(zoneId));
        const skill = Math.max(
          FISHING_CATCH_BAND_THRESHOLDS[band],
          wieldRequirementFor('fishing', minimumTier),
        );
        catches.set(id, [
          ...(catches.get(id) ?? []),
          `Catch band ${band + 1} requires at least ${skill} fishing proficiency and a usable tier ${minimumTier} rod. At this exact band, ${weight} of ${total} catch-table weight gives this item, or ${pct(weight / total)} per successfully reeled ordinary catch.`,
        ]);
      }
    });
    for (const [id, rates] of catches)
      addAcquisition(out, id, {
        title: `Fishing in ${ZONES.find((z) => z.id === zoneId)?.name ?? zoneId}`,
        steps: [
          `Obtain a fishing pole and meet one of the proficiency/rod combinations below. The ${w.link('Fishing')} guide lists the rods and their acquisition routes. Carry the usable rod in your bags.`,
          `Go to the sample shore in ${zone(zoneId)} at ${coords(shore)}. Face the water at ${coords(shore.target)}. Use your pole from your bags or action bar.`,
          'Wait for the bite, then use the pole again within the displayed reel window. A successful roll puts 1 caught item into your bags at this shore. Cast again until this item appears.',
        ],
        details: [
          ...rates,
          `The effective catch band is the lower of your proficiency band and your usable rod tier minus 1. The six skill thresholds are ${FISHING_CATCH_BAND_THRESHOLDS.join(', ')}. Higher skill with the same rod can change the table. These percentages include empty-hook and junk weight, but assume you successfully reel in time. They are not chances per attempted cast.`,
          `This is a verified sample casting position. Other fishable water in ${zone(zoneId)} uses the same tables. See ${w.link('Fishing')} for all zone tables. A quest-specific guaranteed catch can override these ordinary tables.`,
        ],
        points: [
          pin('Start', shore, 'Stand here and face the marked water'),
          pin(1, shore.target, 'Aim the cast at this water'),
          pin('Reward', shore, `Reel in and collect ${ITEMS[id].name}`),
        ],
      });
  }

  const codfatherShore = shores.get('mirefen_marsh');
  const hale = BUILTIN_WORLD.npcs.provisioner_hale;
  if (
    codfatherShore &&
    Math.hypot(
      codfatherShore.x - DEEPFEN_SHALLOWS_LAKE.x,
      codfatherShore.z - DEEPFEN_SHALLOWS_LAKE.z,
    ) <=
      DEEPFEN_SHALLOWS_LAKE.radius + 10
  ) {
    addAcquisition(out, 'the_codfather', {
      title: 'Guaranteed quest catch at Deepfen Shallows',
      steps: [
        `At character level 6 or higher, speak to ${ref(w, 'npc', hale.id)} in ${zone('mirefen_marsh')} at ${coords(hale.pos)} and accept ${ref(w, 'quest', 'q_the_codfather')}. Buy an ${item('ironreel_fishing_rod')} from his counter, or carry a stronger fishing rod. The marsh requires a tier 2 rod or higher. Fishing proficiency is not required for this quest catch.`,
        `Go to the marked Deepfen Shallows shore at ${coords(codfatherShore)}. Face the marked water at ${coords(codfatherShore.target)}. Activate your fishing rod from your bags or action bar.`,
        `Wait for the bite, then activate the rod again before the reel window closes. If the quest is active and you are not carrying ${item('the_codfather')}, this successful catch gives 1 quest fish directly into your bags. Leave one free bag slot.`,
        `Return to ${ref(w, 'npc', hale.id)} at ${coords(hale.pos)} to turn in ${ref(w, 'quest', 'q_the_codfather')}. Turning it in consumes the fish. Follow the quest page for its rewards.`,
      ],
      details: [
        'The chance is 100% per successfully reeled catch while the quest is active, you have no copy of the quest fish, and you stand within 45 yards of the Deepfen Shallows lake centre (x -110, z 310). It replaces the ordinary fishing-table result. A missed bite or an early reel is not a successful catch.',
        'This is a quest-only acquisition. Normal fishing after the quest, fishing elsewhere, or fishing while already carrying the quest fish does not give another copy through this special catch.',
      ],
      points: [
        pin('Start', hale.pos, 'Accept The Codfather and obtain a tier 2 rod'),
        pin(1, codfatherShore, 'Stand here and cast toward the water'),
        pin(2, codfatherShore.target, 'Aim the cast into this water'),
        pin('Reward', codfatherShore, 'Reel in The Codfather'),
        pin('Hand-in', hale.pos, 'Turn in the quest'),
      ],
    });
  }
  // These Brightwood wildlife-pack records remain in ITEMS, but the runtime
  // loot, component, node, vendor and recipe tables never reference their ids.
  // Preserve their articles without inventing a creature or a harvest route.
  for (const id of ['soft_down', 'amber_hide', 'stag_antler']) {
    addAcquisition(out, id, {
      title: 'Unavailable through current gameplay',
      steps: [
        'There is no current gameplay route to obtain this item. Its item record remains in the game data, but no active creature drop, corpse-harvest component, gathering node, vendor, quest reward or recipe awards it.',
      ],
      details: [
        `This is a retained Brightwood wildlife-pack junk item. It is not one of the materials produced by ${w.link('Harvesting and gathering')}. No drop chance, vendor purchase price or acquisition map applies to the current source tables.`,
        `The listed ${w.money(ITEMS[id].sellValue)} is its vendor sale value if a copy already exists. A sale value does not mean a vendor stocks it. The retained definition does not establish whether players could obtain it in an earlier version.`,
      ],
    });
  }
  const patches = farmPatchesInActiveWorld();
  const bed = (patches.find((p) => p.id === 'patch_eastbrook') ?? patches[0]).beds[0];
  const farmer = BUILTIN_WORLD.npcs.farmer_jessica;
  const farmPoints = [
    pin('Start', farmer.pos, farmer.name),
    pin(1, bed, 'Plant one seed in this sample bed'),
    pin('Reward', bed, 'Return to this same bed and collect the harvest'),
  ];
  for (const crop of Object.values(FARM_CROPS)) {
    const skill = farmCropSkillThreshold(crop.tier);
    const steps = [
      `Obtain 1 ${item(crop.seedItemId)}. Carry a tier ${crop.tier} or better hoe and reach ${skill} farming proficiency. Follow the seed's item page for its vendors and price.`,
      `At the sample Eastbrook bed (${coords(bed)}) beside ${ref(w, 'npc', farmer.id)}, click an empty bed, select ${item(crop.seedItemId)} in Plant a Crop, and click Plant. This spends 1 seed. Any farming patch can grow this crop when you meet the crop requirements.`,
      `Wait ${crop.durationMs / 60000} minutes. Growth continues offline. Use the Harvest Journal (Shift+K by default) to check readiness, then return to the same bed and interact to harvest. The completed harvest puts its produce in your bags. Leave room for both grades.`,
    ];
    const details = [
      `At the minimum skill, survival is ${pct(farmSurvivalChance(skill, crop.tier, false, false))}. It rises linearly to 100% at farming skill ${skill + 25}. Spending 1 ${item('compost')} adds 10 percentage points and a watch costing ${w.money(watchFeeAmount(crop.tier))} adds 10 points, capped at 100%. Choose these in Plant a Crop before planting. A failed crop yields 2 ${item('withered_husks')} instead of produce. Late collection does not cause decay.`,
      `A surviving crop starts with 3 harvest lives and produces up to 12 normal picks. Each pick gives 1 produce and has a (15 + 0.35 × current farming skill)% chance to preserve its life. Otherwise it spends a life. The whole yield is resolved when you harvest the bed.`,
      `Each normal pick has a (2 + 0.08 × current farming skill)% chance to become ${item(crop.fineProduceItemId)} instead of ${item(crop.produceItemId)}. That is 2% at skill 0 and 10% at skill 100, per pick of a surviving crop, not per seed planted. A charged quality effect adds 10 percentage points per effect bonus point.`,
      `${item('growth_tonic')} used at planting gives a 50% chance for 2 extra ordinary-grade produce. Quantity tool effects can add at most 1 extra ordinary-grade pick. A golden harvest has a ${pct(GATHER_RARE_EVENT_CHANCE)} chance on a surviving harvest and multiplies both grades by ${GATHER_RARE_EVENT_YIELD_MULT}, then awards one bonus seed or pattern.`,
      `Other planting sites are ${patches.map((p) => `${zone(p.zoneId)} (${coords(p.beds[0])}, first bed)`).join(' / ')}. The map shows a sample route. See ${w.link('Farming')} and ${w.link('Farm crops')} for the controls and crop list.`,
    ];
    for (const id of [crop.produceItemId, crop.fineProduceItemId])
      addAcquisition(out, id, {
        title: `Grow from ${ITEMS[crop.seedItemId].name}`,
        steps,
        details,
        points: farmPoints,
      });
    if (crop.tier >= FARM_SEED_BACK_MIN_TIER)
      addAcquisition(out, crop.seedItemId, {
        title: `Seed returned by harvesting ${ITEMS[crop.produceItemId].name}`,
        steps,
        details: [
          `Per completed harvest of this crop, ${pct(FARM_SEED_BACK_TWO_CHANCE[crop.tier])} gives 2 seeds, ${pct(FARM_SEED_BACK_ONE_CHANCE[crop.tier] - FARM_SEED_BACK_TWO_CHANCE[crop.tier])} gives 1 seed, and ${pct(1 - FARM_SEED_BACK_ONE_CHANCE[crop.tier])} gives none. This seed return also rolls for a withered crop. You must plant a seed first, so use the vendor source to begin.`,
        ],
        points: farmPoints,
      });
  }
  const cropsByTier = [...new Set(Object.values(FARM_CROPS).map((c) => c.tier))];
  for (const tier of cropsByTier) {
    const crops = Object.values(FARM_CROPS).filter((c) => c.tier === tier);
    const seeds = farmSeedIdsOfTier(farmGoldenBonusSeedTier(tier));
    const rates = [
      ...seeds.map((id) => ({ id, rate: (1 - FARM_GOLDEN_BONUS_PATTERN_CHANCE) / seeds.length })),
      ...FARM_GOLDEN_BONUS_PATTERN_IDS.map((id) => ({
        id,
        rate: FARM_GOLDEN_BONUS_PATTERN_CHANCE / FARM_GOLDEN_BONUS_PATTERN_IDS.length,
      })),
    ];
    for (const { id, rate } of rates)
      addAcquisition(out, id, {
        title: `Golden harvest bonus from tier ${tier} crops`,
        steps: [
          `Plant ${crops.map((c) => item(c.seedItemId)).join(' or ')} at the mapped bed or any farming patch. Follow the produce page for tool, skill and growth requirements.`,
          'Return when ready and harvest the crop. A surviving crop can trigger a golden harvest, which gives one random bonus item straight to your bags.',
        ],
        details: [
          `This item has a ${pct(rate)} chance conditional on a golden harvest. Golden harvests occur at ${pct(GATHER_RARE_EVENT_CHANCE)} per surviving crop harvest, so this item has a ${pct(rate * GATHER_RARE_EVENT_CHANCE)} chance per surviving harvest. A withered crop cannot award this bonus.`,
          `Eligible crops are ${crops.map((c) => item(c.produceItemId)).join(', ')}. See ${w.link('Farming')}.`,
        ],
        points: farmPoints,
      });
  }
  addAcquisition(out, 'withered_husks', {
    title: 'Clear a failed crop',
    steps: [
      `Plant a crop following ${w.link('Farming')} at the mapped bed.`,
      'When its growth timer ends, return to the bed. If the journal says Withered, interact with it to clear the bed and collect 2 Withered Husks.',
    ],
    details: [
      'Withering is the complement of the crop survival chance. At the crop minimum skill with no compost or watch, it is 15%. It falls as skill and survival bonuses improve, reaching 0%.',
    ],
    points: farmPoints,
  });

  addAcquisition(out, 'compost', {
    title: 'Trade Withered Husks to a farmer',
    steps: [
      `Obtain at least 2 unlocked ${item('withered_husks')} from a failed crop or by trading with another player.`,
      `Speak to ${ref(w, 'npc', farmer.id)} at ${coords(farmer.pos)}, or another farmer, and click Trade husks for compost.`,
      'The trade converts every complete pair of unlocked husks in your bags. Each 2 husks gives 1 Compost immediately. An unmatched leftover husk stays in your bags.',
    ],
    details: ['This exchange is guaranteed and costs no coins. Locked husk stacks are excluded.'],
    points: [
      pin('Start', bed, 'Collect husks from a failed crop'),
      pin('Reward', farmer.pos, 'Trade husks for compost'),
    ],
  });
  const componentIds = new Set([
    ...Object.values(HARVEST_COMPONENT_ITEMS),
    ...Object.values(HARVEST_COMPONENT_SPECIMENS),
  ]);
  for (const id of componentIds) {
    const source = materialSourceInfo(id);
    if (source.kind !== 'corpse' || !source.examples.length) continue;
    const specimen = !!source.conditionalOnBaseItemId;
    const base = source.conditionalOnBaseItemId ?? id;
    const tags = Object.keys(
      specimen ? HARVEST_COMPONENT_SPECIMENS : HARVEST_COMPONENT_ITEMS,
    ).filter(
      (tag) => (specimen ? HARVEST_COMPONENT_SPECIMENS : HARVEST_COMPONENT_ITEMS)[tag] === id,
    );
    const example = source.examples[0];
    const camp = getActiveWorldContent().camps.find(
      (c) =>
        c.mobId === example.mobId && zoneContaining(c.center.x, c.center.z)?.id === example.zoneId,
    );
    const vendor = BUILTIN_WORLD.npcs.trader_wilkes;
    addAcquisition(out, id, {
      title: 'Harvest a defeated creature',
      steps: [
        `Buy and carry ${item('field_kit')} from ${ref(w, 'npc', vendor.id)} at ${coords(vendor.pos)} for ${w.money(20)}. It is reusable. ${specimen ? `For this premium specimen, also carry a usable gathering tool of tier ${Math.min(...tags.map(monsterMaterialTierFor))} or higher in any gathering profession, and meet that tool's own proficiency requirement.` : 'Ordinary components do not need a higher-tier gathering tool.'}`,
        `For the sample route, defeat ${ref(w, 'mob', example.mobId)} in ${zone(example.zoneId)}${camp ? ` around ${coords(camp.center)} (spawn area radius ${camp.radius})` : ''}.${example.questGated ? ' This example is quest-gated. Follow the creature page for the required quest.' : ''}`,
        `Open the corpse's loot window. Choose Change under harvest preference, select ${item(base)}, then Apply. Choose Harvest and allow its 1.5-second cast to complete. Take Loot handles ordinary drops separately.`,
        `Collect the harvested material directly into your bags at the corpse. Each corpse can be harvested once. ${specimen ? 'Leave an extra bag slot for the specimen, which is a separate bonus item. Repeat with another matching creature if it does not appear.' : 'Leave sufficient bag space before harvesting.'}`,
      ],
      details: [
        specimen
          ? `This specimen has a 16% chance per extracted matching component when the tool-tier requirement is met and the specimen fits in your bags. It is awarded in addition to the ordinary material on a rare, epic or legendary material-rarity roll. It is not a 16% ordinary loot drop on every kill. The matching families are ${tags.join(', ')}.`
          : 'Each matching component extracted from the corpse supplies this material. Without concentration or town-focus bonuses, quantities 1, 2, 3, 4, 5 and 6 have probabilities 40%, 30%, 15%, 10%, 4% and 1%. Selecting fewer component families raises the rolled quantity tier by the number of omitted families, capped at 6 units before town-focus quantity bonuses.',
        `All supported overworld creature sources are ${source.examples.map((e) => `${ref(w, 'mob', e.mobId)} in ${zone(e.zoneId)}${e.questGated ? ' (quest-gated)' : e.rare ? ' (rare)' : e.elite ? ' (elite)' : ''}`).join(' / ')}. Follow each creature link for its locations. The map is the sample route above. See ${w.link('Harvesting and gathering')} for preferences and focus.`,
      ],
      points: [
        pin('Start', vendor.pos, `Buy ${ITEMS.field_kit.name}`),
        ...(camp
          ? [
              pin(1, camp.center, `Defeat ${MOBS[example.mobId].name}`),
              pin('Reward', camp.center, 'Harvest the corpse and collect materials'),
            ]
          : []),
      ],
    });
  }
  return out;
}
