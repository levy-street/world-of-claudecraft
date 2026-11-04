import {
  CASKET_COPPER_BASE,
  CASKET_COPPER_PER_LEVEL,
  CASKET_GEAR_CHANCE,
  CASKET_HEROIC_MARK_CHANCE,
  CASKET_HEROIC_MARKS,
  CASKET_MATERIAL_COUNT,
  CASKET_MATERIAL_POOL,
  CASKET_MOUNT_CHANCE,
  CASKET_MOUNT_REINS_ITEM_ID,
} from '../../src/sim/clue_casket';
import {
  HOARD_BASE_ITEM_IDS,
  HOARD_BOSS_LOOT_TABLES,
  HOARD_LOOT_CLASS_BIAS,
  hoardLootTierForMap,
  hoardLootVariantId,
} from '../../src/sim/content/hoard_loot';
import { CAVE_THEMES } from '../../src/sim/content/rift/cave_themes';
import { RIFT_LEGENDARY_ITEM_IDS } from '../../src/sim/content/rift/items';
import { RIFT_THEMES } from '../../src/sim/content/rift/themes';
import {
  hoardDamageReduction,
  TREASURE_MAP_RARITIES,
  VAULT_OWNER_COPPER_BONUS,
} from '../../src/sim/content/treasure_maps';
import { ITEMS, MOBS, ZONES } from '../../src/sim/data';
import {
  RIFT_BAND_MAX_UPGRADE,
  RIFT_GEM_RATING,
  RIFT_GEM_RATING_STAT,
} from '../../src/sim/rift/band_ladder';
import { RIFT_FORGE_RANGE } from '../../src/sim/rift/forge_gate';
import { BAT } from '../../src/sim/rift/hoard_bat_core';
import { BONE_SCYTHE, SOUL_HARVEST } from '../../src/sim/rift/hoard_bone_reaper_core';
import {
  HOARD_BRUTE_COMBO,
  HOARD_STORM_SURGE_DAMAGE_PER_STACK,
  HOARD_STORM_SURGE_DECAY_SEC,
  HOARD_STORM_SURGE_EVERY_SEC,
  HOARD_STORM_SURGE_MAX_STACKS,
  hoardBossKit,
  hoardMarkSpec,
} from '../../src/sim/rift/hoard_boss_kits';
import { COCOON } from '../../src/sim/rift/hoard_cocoon_core';
import { MIMIC } from '../../src/sim/rift/hoard_mimic_core';
import { MOLE } from '../../src/sim/rift/hoard_mole_core';
import { MUSHROOM } from '../../src/sim/rift/hoard_mushroom_core';
import { HOARD_RARITY_PRESSURE, HOARD_REFERENCE_HEALTH } from '../../src/sim/rift/hoard_scaling';
import {
  HOARD_TIDE_LANE_CORRIDOR,
  HOARD_TIDE_LANE_HALF_SPAN,
} from '../../src/sim/rift/hoard_tide_pattern';
import {
  FARM_RIFT_DROP_CHANCE,
  FARM_RIFT_DROP_ITEM_IDS,
  RIFT_BLUE_MOUNT_CHANCE,
  RIFT_BLUE_MOUNT_REINS,
  RIFT_COIN_BONUS_A,
  RIFT_COIN_BONUS_B,
  RIFT_COIN_BONUS_C,
  RIFT_COIN_BONUS_S,
  RIFT_EPIC_MOUNT_CHANCE,
  RIFT_EPIC_MOUNT_REINS,
  RIFT_GREEN_MOUNT_CHANCE,
  RIFT_GREEN_MOUNT_REINS,
  RIFT_LEGENDARY_CHANCE_S,
  RIFT_PATTERN_CHANCE,
  RIFT_PATTERN_ITEM_IDS,
  riftUpgradeCost,
} from '../../src/sim/rift/progression';
import type { HoardBossCueVariant } from '../../src/sim/rift/types';
import { heading, list, percent, type SystemWriter, words } from './system_writer';

function hoardKitGuide(boss: string) {
  switch (hoardBossKit(boss)) {
    case 'frost':
      return 'Step out of Treacherous Ice and Blizzard. For the Ring of Frost, move into the safe eye or beyond its outer edge.';
    case 'ember':
      return 'Move outside the frontal attack and leave Emberfall marks before impact. The impact leaves a second, ticking fire hazard.';
    case 'brood':
      return `Cut a trapped ally out of silk. You have ${COCOON.warningSec} seconds of warning and ${COCOON.drainSec} seconds before devour. The boss drains every ${COCOON.drainEverySec} second and heals for ${percent(COCOON.drainHealShare)} of the drain; devour heals another ${percent(COCOON.devourHealFraction)} of boss maximum health. Solo players get a hatchable cocoon instead of being trapped without a rescuer.`;
    case 'bone-legion':
      return `The scythe spins for ${BONE_SCYTHE.activeSec} seconds. Stand inside ${BONE_SCYTHE.bladeInner} yards of its moving pivot or beyond ${BONE_SCYTHE.reach} yards. Walk within ${SOUL_HARVEST.interactionRadius} yards of a soul to release it before it comes within ${SOUL_HARVEST.absorbRadius} yards of the boss. Each absorbed soul grants ${percent(SOUL_HARVEST.damagePerStack)} more boss damage for ${SOUL_HARVEST.stackDurationSec} seconds, up to ${SOUL_HARVEST.maxStacks} stacks. Each rescue increases your own damage taken by ${percent(SOUL_HARVEST.burdenPerStack)} in a party or ${percent(SOUL_HARVEST.soloBurdenPerStack)} alone for ${SOUL_HARVEST.burdenDurationSec} seconds, up to ${SOUL_HARVEST.burdenMaxStacks} stacks.`;
    case 'brute':
      return list(
        HOARD_BRUTE_COMBO.map(
          (s) =>
            `${s.ability}: move out of the ${Math.round((2 * s.halfAngle * 180) / Math.PI)}-degree arc, ${s.radius} yards long, within ${s.windup} seconds. Base damage coefficient: ${percent(s.damageFraction)} of the hoard reference.`,
        ),
      );
    case 'arcane':
      return 'Move into the safe eye of Event Horizon, then get back out before Singularity Collapse hits the eye.';
    case 'storm':
      return `Pull the boss out of Charged Ground. While inside it gains ${percent(HOARD_STORM_SURGE_DAMAGE_PER_STACK)} damage every ${HOARD_STORM_SURGE_EVERY_SEC} seconds, up to ${HOARD_STORM_SURGE_MAX_STACKS} stacks. Outside the ground one stack falls off every ${HOARD_STORM_SURGE_DECAY_SEC} seconds.`;
    case 'tide':
      return `Follow the gaps between the moving crests of Crashing Tide. Each lane is ${HOARD_TIDE_LANE_HALF_SPAN * 2} yards wide. The positioning rule leaves a ${HOARD_TIDE_LANE_CORRIDOR}-yard corridor between parallel lanes. Each volley aims its lanes at a living player and sends crests across them in sequence.`;
    case 'mushroom':
      return `Keep out of spore clouds and kill the sporelings. Rare maps add a Bloated Cap. Kill it before the ${MUSHROOM.bloatFuseSec}-second fuse (${MUSHROOM.bloatDoubleFuseSec} under double pressure), or leave the ${MUSHROOM.bloatRadius}-yard burst. Its explosion leaves a ${MUSHROOM.bloatCloudRadius}-yard cloud.`;
    case 'mole':
      return `Sidestep the ${MOLE.swipeRadius}-yard Claw Rake. After the ${MOLE.burrowSec}-second burrow cast, leave the ${MOLE.eruptRadius}-yard eruption circle. A hit pushes you ${MOLE.eruptKnockback} yards. Rare maps also drop rocks, each with a ${MOLE.rockRadius}-yard impact radius.`;
    case 'bat':
      return `Leave the dive lane during the ${BAT.diveAimSec}-second aim or be pushed ${BAT.diveKnockback} yards. Leave the ${BAT.screechRadius}-yard screech before the ${BAT.screechCastSec}-second cast (${BAT.screechDoubleCastSec} under double pressure). Screech slows you to ${percent(BAT.screechSlow)} speed for ${BAT.screechSlowSec} seconds. Rare maps also summon bats.`;
    case 'mimic':
      return `Sidestep the ${MIMIC.biteRadius}-yard frontal bite. The mimic crouches for ${MIMIC.leapCrouchSec} seconds and travels for ${MIMIC.leapFlightSec} seconds before striking its ${MIMIC.leapRadius}-yard landing circle. Rare maps add burning coins.`;
  }
}

const marks: Partial<Record<ReturnType<typeof hoardBossKit>, HoardBossCueVariant[]>> = {
  frost: ['frost-ice', 'frost-blizzard', 'frost-ring'],
  ember: ['ember-fire'],
  arcane: ['arcane-voidfall', 'arcane-horizon', 'arcane-collapse'],
  storm: ['storm-charge', 'storm-orbital-impact', 'storm-field'],
  mushroom: ['mushroom-spore'],
  mole: ['mole-rock'],
  mimic: ['mimic-coins'],
};

export function addRiftAndHoardRules(w: SystemWriter) {
  const item = (id: string) => w.entity('item', id, ITEMS[id]?.name);
  const mob = (id: string) => w.entity('mob', id, MOBS[id]?.name);
  const ranks = ['C', 'B', 'A', 'S'] as const;
  w.describe(
    'Rifts',
    'Procedural rifts roll 3 to 6 floors. A C-rank seed has a 15% chance to open the two-floor Infernal Citadel instead. Clear non-boss enemies and solve the floor puzzle to open the descent. Using it takes everyone currently on the floor to the next floor together.',
    heading(
      'Puzzles on a procedural non-boss floor',
      list([
        '18% rune pylons: activate all 3 or 4.',
        '18% ice slide: slide to the goal tile at the far end.',
        '18% strength boulders: push them onto the marked pads.',
        '18% rune sequence: step on 3 to 5 runes in order. Stepping ahead resets progress.',
        '28% no puzzle. The final boss floor has no puzzle roll.',
      ]),
    ),
    heading(
      'Portal rank by zone',
      list(
        ZONES.filter((z) => z.riftPortalEligible).map((z) => {
          const total = ranks.reduce((sum, r) => sum + (z.riftTierWeights?.[r] ?? 0), 0);
          return `${w.entity('zone', z.id)}: ${
            total
              ? ranks
                  .filter((r) => z.riftTierWeights?.[r])
                  .map((r) => `${r} ${percent((z.riftTierWeights?.[r] ?? 0) / total)}`)
                  .join(', ')
              : 'C 100%'
          }.`;
        }),
      ),
    ),
  );
  w.article(
    'Rift floors',
    'Infernal Citadel',
    'Rift floor',
    `On the first floor, defeat ${mob('rift_boss_ritualist')} to arm the Blood Orb. Take the orb to open the Temple Gate. Descend to the pit and defeat ${mob('rift_boss_pitlord')} to open the exit.`,
  );
  for (const t of RIFT_THEMES) {
    const boss = MOBS[t.boss],
      kit = boss.rankMechanics ?? [];
    w.article(
      'Rift floors',
      t.name,
      'Rift floor',
      `This theme can be selected for a procedural floor. Ordinary enemies are ${t.trash.map(mob).join(' and ')}. Its final-floor boss is ${mob(t.boss)}.`,
      heading(
        'Boss mechanics by minimum rank',
        list(
          kit.map((key, i) => {
            const record: unknown = boss[key as keyof typeof boss];
            const name =
              record && typeof record === 'object' && 'name' in record
                ? String(record.name)
                : words(key);
            return `${ranks[i]} or above: ${name}.`;
          }),
        ),
      ),
    );
  }
  w.describe(
    'Rift Forge',
    `Bring a Riftbound band in your bags within ${RIFT_FORGE_RANGE} yards of the Riftwright. There are ${RIFT_BAND_MAX_UPGRADE} upgrades costing ${Array.from({ length: RIFT_BAND_MAX_UPGRADE }, (_, i) => riftUpgradeCost(i)).join(', ')} Rift Essence respectively. Each increases item level by one up to the band cap. A gem socket adds ${RIFT_GEM_RATING} rating. If all sockets are filled, socketing again consumes the new gem and destroys the oldest socketed gem.`,
    list(
      Object.entries(RIFT_GEM_RATING_STAT).map(([id, stat]) => `${item(id)} adds ${words(stat)}.`),
    ),
  );
  w.describe(
    'Rift first-clear rewards',
    'The first group to finish the same natural rift wins the first-clear extras. Other groups can still finish their own run and loot ordinary drops. The clear adds a shared gear roll on the final corpse and a personal class-appropriate band and Rift Essence for each winner. At the standard loot multiplier, ranks C, B, A and S pay 1, 2, 3 and 4 personal Essence respectively. With a custom loot multiplier, clamp it to 0.5 to 2, multiply by that base, round to the nearest integer and clamp the result to 1 to 8. A and S also grant each winner a gem; so can other ranks when the crafting-material bias is at least 0.5.',
    heading(
      'Gear and bonus copper',
      list([
        `C: one piece from the normal-dungeon pool and ${RIFT_COIN_BONUS_C} bonus copper.`,
        `B: one Heroic epic and ${RIFT_COIN_BONUS_B} bonus copper.`,
        `A: one Heroic epic and ${RIFT_COIN_BONUS_A} bonus copper.`,
        `S: one Heroic epic, a 35% chance of a second and ${RIFT_COIN_BONUS_S} bonus copper. Each of ${RIFT_LEGENDARY_ITEM_IDS.map(item).join(' and ')} rolls separately at ${percent(RIFT_LEGENDARY_CHANCE_S)}.`,
      ]),
    ),
    heading(
      'Other shared drops',
      list([
        `B: ${percent(RIFT_GREEN_MOUNT_CHANCE)} chance for one of ${RIFT_GREEN_MOUNT_REINS.map(item).join(', ')}.`,
        `A: ${percent(RIFT_BLUE_MOUNT_CHANCE)} chance for one of ${RIFT_BLUE_MOUNT_REINS.map(item).join(', ')}.`,
        `S: ${percent(RIFT_EPIC_MOUNT_CHANCE)} chance for one of ${RIFT_EPIC_MOUNT_REINS.map(item).join(', ')}.`,
        `B, A and S also roll separately for a pattern (${percent(RIFT_PATTERN_CHANCE)}, equal chances among ${RIFT_PATTERN_ITEM_IDS.map(item).join(', ')}) and a farming drop (${percent(FARM_RIFT_DROP_CHANCE)}, equal chances among ${FARM_RIFT_DROP_ITEM_IDS.map(item).join(', ')}).`,
      ]),
    ),
  );
  w.describe(
    'Clue hunts',
    `Each treasure casket pays ${CASKET_COPPER_BASE} + ${CASKET_COPPER_PER_LEVEL} copper per character level and ${CASKET_MATERIAL_COUNT} of one of ${CASKET_MATERIAL_POOL.map(item).join(', ')}. It rolls ${percent(CASKET_GEAR_CHANCE)} for class gear from the low delve-chest tier, ${percent(CASKET_HEROIC_MARK_CHANCE)} for ${CASKET_HEROIC_MARKS} Heroic Marks and ${percent(CASKET_MOUNT_CHANCE)} for ${item(CASKET_MOUNT_REINS_ITEM_ID)} if unowned.`,
  );
  w.describe(
    'Buried hoards',
    `The map owner's copper payout is ${percent(VAULT_OWNER_COPPER_BONUS)} higher than a guest's. If the gear roll succeeds, a ${percent(HOARD_LOOT_CLASS_BIAS)} roll favors the wearer's usable items when available; otherwise the game chooses uniformly from that boss's table. Each map opens a single room. Its rarity fixes the encounter budget even when the number of living players changes.`,
  );
  for (const theme of [...RIFT_THEMES, ...CAVE_THEMES]) {
    const small = CAVE_THEMES.includes(theme),
      boss = MOBS[theme.boss],
      tierList = TREASURE_MAP_RARITIES.filter((r) =>
        small ? r === 'common' || r === 'rare' : r === 'epic' || r === 'legendary',
      );
    const rows = marks[hoardBossKit(boss.id)] ?? [];
    const amounts = (fraction: number) =>
      tierList
        .map(
          (r) =>
            `${Math.max(1, Math.round(HOARD_REFERENCE_HEALTH * fraction * HOARD_RARITY_PRESSURE[r].damage * hoardDamageReduction(r, 'boss')))} on ${r}`,
        )
        .join(', ');
    w.article(
      'Hoard encounters',
      boss.name,
      'Hoard encounter',
      `Found in ${theme.name} on ${tierList.join(' and ')} maps. See ${mob(boss.id)} for its creature record.`,
      hoardKitGuide(boss.id),
      rows.length
        ? heading(
            'Marked attacks',
            list(
              rows.map((v) => {
                const a = hoardMarkSpec(v);
                return `${a.ability}: ${a.windup}-second warning, ${a.radius}-yard radius${a.innerRadius ? ` (safe inside ${a.innerRadius} yards)` : ''}.${a.impactFraction ? ` Initial ${a.school} damage before target modifiers: ${amounts(a.impactFraction)}.` : ''}${a.hazardDuration ? ` Ground effect lasts ${a.hazardDuration} seconds.` : ''}${a.pulseFraction ? ` It deals ${amounts(a.pulseFraction)} every ${a.pulseEvery} seconds.` : ''}`;
              }),
            ),
          )
        : '',
      heading(
        'Gear table by map',
        list(
          tierList.map(
            (r) =>
              `${r}: ${(HOARD_BOSS_LOOT_TABLES[boss.id] ?? HOARD_BASE_ITEM_IDS).map((id) => item(hoardLootVariantId(id, hoardLootTierForMap(r)))).join(', ')}.`,
          ),
        ),
      ),
    );
  }
}
