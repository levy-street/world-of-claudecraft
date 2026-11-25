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
        `Carry a tier ${minimumTier} or better ${title.toLowerCase()} tool${tools.length ? ` such as ${item(tools[0].id)}` : ''}. To use a tier ${minimumTier} tool, you need ${wieldRequirementFor(profession, minimumTier)} ${title.toLowerCase()} proficiency (your ${title.toLowerCase()} skill). The tool's item page shows where to get it.`,
        `Go to the example node in ${zone(zoneId)} at ${coords(first.pos)}. Click the node and stand still until the gathering cast finishes.`,
        `The material goes straight into your bags. Make room before you gather. You can gather the same node again after ${NODE_HARVEST_TABLE[first.type].respawnSeconds / 60} minutes.`,
      ],
      details: [
        fine
          ? `You always get this fine grade when both of these are true: the best tool you can use is higher than tier ${gatherMaterialTier(base)} (the material's tier), and the node is tier ${gatherMaterialTier(base)} or higher. You then get it instead of ${item(base)}. It is not a random drop.`
          : `Each harvest gives this material, unless it is upgraded to ${fineMaterialFor(base) ? item(fineMaterialFor(base)!) : 'a fine grade'}. A higher-tier tool you can use, or a quality effect on your tool, can cause that upgrade. To keep the normal grade, use a tool of tier ${gatherMaterialTier(base)} or lower on a node that tool can work. Or gather a lower-tier node that cannot give the fine grade.`,
        'Each harvest also rolls how many you get. Without tool effects, a common roll gives 1, uncommon gives 2, rare gives 2, epic gives 3 and legendary gives 4. Let P be your proficiency (if it is over 100, use 100). The chances are: common (100 − P)%, uncommon (0.60 × P)%, rare (0.30 × P)%, epic (0.08 × P)% and legendary (0.02 × P)%. This roll only changes how many you get, not the normal or fine grade.',
        `Each harvest also has a separate ${pct(GATHER_RARE_EVENT_CHANCE)} chance of a rare event. A rare event multiplies how many you get by ${GATHER_RARE_EVENT_YIELD_MULT}. Charged tool effects can change the amount or grade even more. See ${w.link(title)} and ${w.link('Professions')}.`,
        `All ${sites.length} nodes in this zone that can give it are at ${sites.map((n) => `${coords(n.pos)} (node tier ${n.tier})`).join(' / ')}. The map marks the example node, where you also collect the item.`,
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
          `Catch band ${band + 1}: you need at least ${skill} fishing proficiency and a tier ${minimumTier} rod you can use. In this band, this item has ${weight} of the ${total} catch-table weight. That is ${pct(weight / total)} for each normal catch you reel in.`,
        ]);
      }
    });
    for (const [id, rates] of catches)
      addAcquisition(out, id, {
        title: `Fishing in ${ZONES.find((z) => z.id === zoneId)?.name ?? zoneId}`,
        steps: [
          `Get a fishing rod and match one of the skill and rod pairs below. The ${w.link('Fishing')} guide lists the rods and how to get them. Keep the rod you can use in your bags.`,
          `Go to the example shore in ${zone(zoneId)} at ${coords(shore)}. Face the water at ${coords(shore.target)}. Use your rod from your bags or action bar.`,
          'Wait for a bite. Then use the rod again before the reel timer runs out. If you reel in on time, you get 1 caught item in your bags. Keep casting until you get this item.',
        ],
        details: [
          ...rates,
          `Your catch band is the lower of two numbers: the band your fishing proficiency reaches, and the tier of your rod. Bands 1 to ${FISHING_CATCH_BAND_THRESHOLDS.length} need at least ${FISHING_CATCH_BAND_THRESHOLDS.slice(0, -1).join(', ')} and ${FISHING_CATCH_BAND_THRESHOLDS[FISHING_CATCH_BAND_THRESHOLDS.length - 1]} proficiency. With the same rod, more skill can move you to a different table. These percentages count empty hooks and junk too. They assume you reel in on time. They are not the chance for each cast you try.`,
          `This example spot has been checked, and casting works from it. Any other water you can fish in ${zone(zoneId)} uses the same tables. See ${w.link('Fishing')} for the tables of every zone. Some quests give a set catch that replaces these normal tables.`,
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
        `At level 6 or higher, talk to ${ref(w, 'npc', hale.id)} in ${zone('mirefen_marsh')} at ${coords(hale.pos)} and accept ${ref(w, 'quest', 'q_the_codfather')}. Buy an ${item('ironreel_fishing_rod')} from him, or bring a stronger fishing rod. You need a tier 2 rod or better to fish in the marsh. You do not need any fishing proficiency for this quest catch.`,
        `Go to the marked Deepfen Shallows shore at ${coords(codfatherShore)}. Face the marked water at ${coords(codfatherShore.target)}. Use your fishing rod from your bags or action bar.`,
        `Wait for a bite. Then use the rod again before the reel timer runs out. If you have the quest and are not carrying ${item('the_codfather')}, this catch puts 1 quest fish straight into your bags. Keep one bag slot free.`,
        `Go back to ${ref(w, 'npc', hale.id)} at ${coords(hale.pos)} and turn in ${ref(w, 'quest', 'q_the_codfather')}. You hand over the fish when you turn it in. See the quest page for its rewards.`,
      ],
      details: [
        'You always get it (100%) when you reel in on time and all of these are true: you have the quest, you are not carrying the quest fish, and you stand within 45 yards of the middle of the Deepfen Shallows lake (x -110, z 310). You get it instead of a normal catch. A missed bite or reeling in too early does not count as a catch.',
        'You can only get this fish from the quest. This special catch does not give you another one after the quest, when you fish somewhere else, or when you already carry the fish.',
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
        'You cannot get this item in the game right now. It is still in the game data, but nothing gives it: no creature drop, corpse harvest, gathering node, vendor, quest reward or recipe.',
      ],
      details: [
        `This is an old junk item from the Brightwood wildlife pack that was kept in the game data. It is not one of the materials you get from ${w.link('Harvesting and gathering')}. It has no drop chance, no shop price and no map, because nothing gives it now.`,
        `The ${w.money(ITEMS[id].sellValue)} shown is what a vendor pays you if you already have one. That does not mean any vendor sells it. The game data does not show whether players could get it in an older version.`,
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
      `Get 1 ${item(crop.seedItemId)}. Carry a tier ${crop.tier} or better hoe and reach ${skill} farming proficiency. The seed's item page shows who sells it and the price.`,
      `Go to the example Eastbrook bed (${coords(bed)}) next to ${ref(w, 'npc', farmer.id)}. Click an empty bed, pick ${item(crop.seedItemId)} in Plant a Crop, and click Plant. This uses 1 seed. You can grow this crop at any farming patch if you meet its needs.`,
      `Wait ${crop.durationMs / 60000} minutes. The crop keeps growing while you are offline. Check the Harvest Journal (Shift+K by default) to see if it is ready. Then go back to the same bed and click it to harvest. The produce goes into your bags. Leave room for both the normal and the fine grade.`,
    ];
    const details = [
      `At the lowest skill you need, the chance that your crop survives is ${pct(farmSurvivalChance(skill, crop.tier, false, false))}. This rises evenly to 100% at farming skill ${skill + 25}. Using 1 ${item('compost')} adds 10 to that percent, and paying ${w.money(watchFeeAmount(crop.tier))} for a watch adds another 10. The total cannot go over 100%. Choose these in Plant a Crop before you plant. A crop that fails gives 2 ${item('withered_husks')} instead of produce. The crop does not spoil if you collect it late.`,
      `A crop that survives starts with 3 lives and can give up to 12 normal picks. Each pick gives 1 produce. Each pick also has a (15 + 0.35 × your farming skill)% chance to keep its life. If not, the crop loses a life. All the picks are worked out at once when you harvest the bed.`,
      `Each normal pick has a (2 + 0.08 × your farming skill)% chance to be ${item(crop.fineProduceItemId)} instead of ${item(crop.produceItemId)}. That is 2% at skill 0 and 10% at skill 100. This chance is for each pick of a crop that survived, not for each seed you plant. A charged quality effect adds 10 to that percent for each bonus point it has.`,
      `Using ${item('growth_tonic')} when you plant gives a 50% chance of 2 extra normal-grade produce. Quantity effects on your tool can add at most 1 extra normal-grade pick. When you harvest a crop that survived, there is a ${pct(GATHER_RARE_EVENT_CHANCE)} chance of a golden harvest. A golden harvest multiplies both grades by ${GATHER_RARE_EVENT_YIELD_MULT}, then also gives one bonus seed or pattern.`,
      `You can also plant at ${patches.map((p) => `${zone(p.zoneId)} (${coords(p.beds[0])}, first bed)`).join(' / ')}. The map shows an example route. See ${w.link('Farming')} and ${w.link('Farm crops')} for the controls and the list of crops.`,
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
          `Each time you harvest this crop, you get seeds back. The chance of 2 seeds is ${pct(FARM_SEED_BACK_TWO_CHANCE[crop.tier])}, of 1 seed is ${pct(FARM_SEED_BACK_ONE_CHANCE[crop.tier] - FARM_SEED_BACK_TWO_CHANCE[crop.tier])}, and of none is ${pct(1 - FARM_SEED_BACK_ONE_CHANCE[crop.tier])}. You get this roll even if the crop withered. You need a seed to start, so buy your first one from a vendor.`,
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
          `Plant ${crops.map((c) => item(c.seedItemId)).join(' or ')} at the bed on the map or at any farming patch. The produce page lists the tool, skill and growing time you need.`,
          'Come back when it is ready and harvest it. A crop that survives can turn into a golden harvest. A golden harvest gives one random bonus item straight to your bags.',
        ],
        details: [
          `When you get a golden harvest, the chance that its bonus is this item is ${pct(rate)}. A golden harvest happens ${pct(GATHER_RARE_EVENT_CHANCE)} of the time when you harvest a crop that survived. So for each harvest of a surviving crop, the chance of this item is ${pct(rate * GATHER_RARE_EVENT_CHANCE)}. A withered crop can never give this bonus.`,
          `Crops that can give it: ${crops.map((c) => item(c.produceItemId)).join(', ')}. See ${w.link('Farming')}.`,
        ],
        points: farmPoints,
      });
  }
  addAcquisition(out, 'withered_husks', {
    title: 'Clear a failed crop',
    steps: [
      `Plant a crop at the bed on the map. See ${w.link('Farming')} for how.`,
      'When it has finished growing, go back to the bed. If the journal says Withered, click the bed. This clears it and gives you 2 Withered Husks.',
    ],
    details: [
      'The chance to wither is 100% minus the chance to survive. At the lowest skill for the crop, with no compost or watch, it is 15%. It goes down as your skill and survival bonuses go up, and it can reach 0%.',
    ],
    points: farmPoints,
  });

  addAcquisition(out, 'compost', {
    title: 'Trade Withered Husks to a farmer',
    steps: [
      `Get at least 2 unlocked ${item('withered_husks')}. You get them from a failed crop or by trading with another player.`,
      `Talk to ${ref(w, 'npc', farmer.id)} at ${coords(farmer.pos)}, or another farmer, and click Trade husks for compost.`,
      'Every 2 unlocked husks in your bags turn into 1 Compost right away. If you have an odd number, the last husk stays in your bags.',
    ],
    details: ['This trade always works and is free. Locked stacks of husks are not traded.'],
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
        `Buy ${item('field_kit')} from ${ref(w, 'npc', vendor.id)} at ${coords(vendor.pos)} for ${w.money(20)} and carry it. You can use it again and again. ${specimen ? `For this premium specimen, also carry a gathering tool of tier ${Math.min(...tags.map(monsterMaterialTierFor))} or higher, from any gathering profession. You must have enough proficiency to use that tool.` : 'Normal components do not need a higher-tier gathering tool.'}`,
        `For the example route, defeat ${ref(w, 'mob', example.mobId)} in ${zone(example.zoneId)}${camp ? ` around ${coords(camp.center)} (spawn area radius ${camp.radius})` : ''}.${example.questGated ? ' You need a quest before this creature counts. The creature page says which quest.' : ''}`,
        `Open the corpse's loot window. Under harvest preference, choose Change, pick ${item(base)}, then Apply. Choose Harvest and wait for its 1.5-second cast to finish. Take Loot is a separate button for the normal drops.`,
        `The material goes straight into your bags. You can harvest each corpse only once. ${specimen ? 'Keep one extra bag slot free for the specimen, which is a separate bonus item. If it does not show up, try again on another matching creature.' : 'Make room in your bags before you harvest.'}`,
      ],
      details: [
        specimen
          ? `For each matching component you take from the corpse, there is a 16% chance of this specimen. You need the tool tier above, and the specimen must fit in your bags. It comes when the material roll is rare, epic or legendary, on top of the normal material. It is not a 16% drop on every kill. The matching families are ${tags.join(', ')}.`
          : 'Each matching component you take from the corpse gives this material. Without concentration or town-focus bonuses, you get 1 (40%), 2 (30%), 3 (15%), 4 (10%), 5 (4%) or 6 (1%). If you pick fewer component families, the amount goes up one step for each family you leave out. It cannot go over 6 before town-focus bonuses are added.',
        `Every creature in the outside world that gives it: ${source.examples.map((e) => `${ref(w, 'mob', e.mobId)} in ${zone(e.zoneId)}${e.questGated ? ' (needs a quest)' : e.rare ? ' (rare)' : e.elite ? ' (elite)' : ''}`).join(' / ')}. Click a creature to see where it lives. The map shows the example route above. See ${w.link('Harvesting and gathering')} for harvest preferences and focus.`,
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
