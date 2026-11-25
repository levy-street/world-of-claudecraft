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
import { CAVE_HOARD, hoardBosses, riftBosses, VALLEY_HOARD } from './boss_groups';
import { heading, list, percent, type SystemWriter, words } from './system_writer';

function hoardKitGuide(boss: string) {
  switch (hoardBossKit(boss)) {
    case 'frost':
      return 'Step out of Treacherous Ice and Blizzard. For the Ring of Frost, move into the safe middle (the eye) or past its outer edge.';
    case 'ember':
      return 'Get out of the attack in front of the boss. Leave Emberfall marks before they hit. Each hit leaves a patch of fire that keeps hurting you while you stand in it.';
    case 'brood':
      return `Cut a trapped ally out of the silk. You get ${COCOON.warningSec} seconds of warning. Then you have ${COCOON.drainSec} seconds before the boss eats (devours) them. While they are trapped, the boss drains them every ${COCOON.drainEverySec} second and heals for ${percent(COCOON.drainHealShare)} of what it drains. If it devours them, it heals another ${percent(COCOON.devourHealFraction)} of its maximum health. If you are alone, you are not trapped, because nobody could cut you free. A cocoon that can hatch appears instead.`;
    case 'bone-legion':
      return `The scythe spins for ${BONE_SCYTHE.activeSec} seconds. To stay safe, stand within ${BONE_SCYTHE.bladeInner} yards of the point it spins around (which moves), or more than ${BONE_SCYTHE.reach} yards away. Souls float toward the boss. Walk within ${SOUL_HARVEST.interactionRadius} yards of a soul to set it free before it gets within ${SOUL_HARVEST.absorbRadius} yards of the boss. Each soul the boss takes in makes it deal ${percent(SOUL_HARVEST.damagePerStack)} more damage for ${SOUL_HARVEST.stackDurationSec} seconds. This stacks up to ${SOUL_HARVEST.maxStacks} times. Each soul you save makes you take more damage for ${SOUL_HARVEST.burdenDurationSec} seconds: ${percent(SOUL_HARVEST.burdenPerStack)} more in a party, or ${percent(SOUL_HARVEST.soloBurdenPerStack)} more alone. This stacks up to ${SOUL_HARVEST.burdenMaxStacks} times.`;
    case 'brute':
      return list(
        HOARD_BRUTE_COMBO.map(
          (s) =>
            `${s.ability}: you have ${s.windup} seconds to get out of the ${Math.round((2 * s.halfAngle * 180) / Math.PI)}-degree arc. The arc reaches ${s.radius} yards. Base damage: ${percent(s.damageFraction)} of the hoard reference health.`,
        ),
      );
    case 'arcane':
      return 'Move into the safe middle (the eye) of Event Horizon. Then get back out before Singularity Collapse hits the eye.';
    case 'storm':
      return `Pull the boss out of Charged Ground. While the boss stands in it, it gets ${percent(HOARD_STORM_SURGE_DAMAGE_PER_STACK)} more damage every ${HOARD_STORM_SURGE_EVERY_SEC} seconds. This stacks up to ${HOARD_STORM_SURGE_MAX_STACKS} times. When it is out of the ground, it loses one stack every ${HOARD_STORM_SURGE_DECAY_SEC} seconds.`;
    case 'tide':
      return `Crashing Tide sends waves (crests) along lanes. Stand in the gaps between the moving crests. Each lane is ${HOARD_TIDE_LANE_HALF_SPAN * 2} yards wide. Lanes that run side by side always leave a gap ${HOARD_TIDE_LANE_CORRIDOR} yards wide between them. Each attack aims its lanes at a living player and sends crests down them one after another.`;
    case 'mushroom':
      return `Stay out of spore clouds and kill the sporelings. Rare maps add a Bloated Cap. Kill it before its ${MUSHROOM.bloatFuseSec}-second fuse runs out (${MUSHROOM.bloatDoubleFuseSec} seconds under double pressure). If you cannot, get out of its ${MUSHROOM.bloatRadius}-yard blast. When it blows up, it leaves a cloud that reaches ${MUSHROOM.bloatCloudRadius} yards from where it burst.`;
    case 'mole':
      return `Step aside from the ${MOLE.swipeRadius}-yard Claw Rake. The boss digs underground for ${MOLE.burrowSec} seconds. Then leave the ${MOLE.eruptRadius}-yard circle where it bursts out. If it hits you, you are pushed ${MOLE.eruptKnockback} yards. Rare maps also drop rocks. Each rock hits anyone within ${MOLE.rockRadius} yards of where it lands.`;
    case 'bat':
      return `The boss aims a dive for ${BAT.diveAimSec} seconds. Get out of its path, or you are pushed ${BAT.diveKnockback} yards. Get out of the ${BAT.screechRadius}-yard screech before its ${BAT.screechCastSec}-second cast ends (${BAT.screechDoubleCastSec} seconds under double pressure). Screech slows you to ${percent(BAT.screechSlow)} speed for ${BAT.screechSlowSec} seconds. Rare maps also call in more bats.`;
    case 'mimic':
      return `Step aside from the ${MIMIC.biteRadius}-yard bite in front of it. When it leaps, the mimic crouches for ${MIMIC.leapCrouchSec} seconds, then flies through the air for ${MIMIC.leapFlightSec} seconds. Then it hits anyone in its ${MIMIC.leapRadius}-yard landing circle. Rare maps add burning coins.`;
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

/** The character sheet's names for the three rating stats a rift gem can add. */
const RATING_NAMES: Record<string, string> = {
  critRating: 'Crit Rating',
  hasteRating: 'Haste Rating',
  hitRating: 'Hit Rating',
};

export function addRiftAndHoardRules(w: SystemWriter) {
  const item = (id: string) => w.entity('item', id, ITEMS[id]?.name);
  const mob = (id: string) => w.entity('mob', id, MOBS[id]?.name);
  const ranks = ['C', 'B', 'A', 'S'] as const;
  w.describe(
    'Rifts',
    'A randomly built rift has 3 to 6 floors. A C-rank rift has a 15% chance to be the two-floor Infernal Citadel instead. On each floor, defeat the enemies that are not bosses and solve the puzzle. This opens the way down (the descent). Using it takes everyone on that floor down to the next floor together.',
    heading(
      'Puzzles on a random floor without a boss',
      list([
        '18% rune pylons: turn on all 3 or 4 pylons.',
        '18% ice slide: slide to the goal tile at the far end.',
        '18% strength boulders: push them onto the marked pads.',
        '18% rune sequence: step on 3 to 5 runes in order. If you step on a rune too early, you have to start over.',
        '28% no puzzle. The final boss floor never has a puzzle.',
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
    `On the first floor, defeat ${mob('rift_boss_ritualist')}. This powers up the Blood Orb. Take the orb to open the Temple Gate. Go down to the pit and defeat ${mob('rift_boss_pitlord')} to open the exit.`,
  );
  for (const t of RIFT_THEMES) {
    const boss = MOBS[t.boss],
      kit = boss.rankMechanics ?? [];
    w.article(
      'Rift floors',
      t.name,
      'Rift floor',
      `A randomly built rift floor can use this theme. Its normal enemies are ${t.trash.map(mob).join(' and ')}. Its boss on the final floor is ${mob(t.boss)}.`,
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
    `Carry a Riftbound band in your bags and stand within ${RIFT_FORGE_RANGE} yards of the Riftwright. There are ${RIFT_BAND_MAX_UPGRADE} upgrades. In order, they cost ${Array.from({ length: RIFT_BAND_MAX_UPGRADE }, (_, i) => riftUpgradeCost(i)).join(', ')} Rift Essence. Each upgrade raises the item level by one, up to the band's limit. A gem in a socket adds ${RIFT_GEM_RATING} rating. If every socket is full, adding a new gem destroys the oldest gem in the band. The new gem takes its place.`,
    list(
      Object.entries(RIFT_GEM_RATING_STAT).map(
        ([id, stat]) => `${item(id)} adds ${RATING_NAMES[stat] ?? words(stat)}.`,
      ),
    ),
  );
  w.describe(
    'Rift first-clear rewards',
    "The first group to finish a natural rift wins its completion rewards. Other groups in the same rift can still finish their own run. They keep drops from normal enemies and chests along the way. But they get none of the completion gear, mounts, bands, Essence or gems listed here. The winning group loots the final boss's body. It holds shared gear, plus a class band and Rift Essence saved for each winner. With normal loot settings, each winner gets 1 Essence for rank C, 2 for B, 3 for A and 4 for S. Some rifts use a custom loot multiplier. Then the Essence is worked out like this:\n* The multiplier is kept between 0.5 and 2.\n* The amount above is multiplied by it and rounded to the nearest whole number.\n* The result is kept between 1 and 8.\nRanks A and S also leave a gem on the body for each winner. Other ranks can too, when the rift's crafting-material bias is at least 0.5.",
    heading(
      'Gear and bonus copper',
      list([
        `C: one piece of gear from the normal dungeon loot and ${RIFT_COIN_BONUS_C} bonus copper.`,
        `B: one Heroic epic and ${RIFT_COIN_BONUS_B} bonus copper.`,
        `A: one Heroic epic and ${RIFT_COIN_BONUS_A} bonus copper.`,
        `S: one Heroic epic, a 35% chance of a second one, and ${RIFT_COIN_BONUS_S} bonus copper. ${RIFT_LEGENDARY_ITEM_IDS.map(item).join(' and ')} each have their own ${percent(RIFT_LEGENDARY_CHANCE_S)} chance to drop.`,
      ]),
    ),
    heading(
      'Other shared drops',
      list([
        `B: ${percent(RIFT_GREEN_MOUNT_CHANCE)} chance for one of ${RIFT_GREEN_MOUNT_REINS.map(item).join(', ')}.`,
        `A: ${percent(RIFT_BLUE_MOUNT_CHANCE)} chance for one of ${RIFT_BLUE_MOUNT_REINS.map(item).join(', ')}.`,
        `S: ${percent(RIFT_EPIC_MOUNT_CHANCE)} chance for one of ${RIFT_EPIC_MOUNT_REINS.map(item).join(', ')}.`,
        `B, A and S also have two more separate chances:\n** A ${percent(RIFT_PATTERN_CHANCE)} chance for a pattern. Each of ${RIFT_PATTERN_ITEM_IDS.map(item).join(', ')} is equally likely.\n** A ${percent(FARM_RIFT_DROP_CHANCE)} chance for a farming drop. Each of ${FARM_RIFT_DROP_ITEM_IDS.map(item).join(', ')} is equally likely.`,
      ]),
    ),
  );
  w.describe(
    'Clue hunts',
    `Each treasure casket gives ${CASKET_COPPER_BASE} copper, plus ${CASKET_COPPER_PER_LEVEL} copper for each character level. It also gives ${CASKET_MATERIAL_COUNT} of one of these: ${CASKET_MATERIAL_POOL.map(item).join(', ')}. It also has these separate chances:\n* ${percent(CASKET_GEAR_CHANCE)} for gear for your class, from the low delve-chest tier.\n* ${percent(CASKET_HEROIC_MARK_CHANCE)} for ${CASKET_HEROIC_MARKS} Heroic Marks.\n* ${percent(CASKET_MOUNT_CHANCE)} for ${item(CASKET_MOUNT_REINS_ITEM_ID)}, if you do not own it yet.`,
  );
  w.describe(
    'Buried hoards',
    `The map owner gets ${percent(VAULT_OWNER_COPPER_BONUS)} more copper than a guest. If you win gear, there is a ${percent(HOARD_LOOT_CLASS_BIAS)} chance it is picked from items you can use, if the boss has any. Otherwise, every item on that boss's list has the same chance. Each map opens a private hoard. Common and rare maps lead into a cave. Epic and legendary maps lead into an open valley. The map's rarity sets how hard the fight is. This stays the same even if the number of living players changes.`,
  );
  // The guardians, grouped by the kind of hoard, so a boss can be found from this page.
  const guardianList = (place: string) =>
    list(
      hoardBosses()
        .filter((b) => b.place === place)
        .map(
          (b) =>
            `${mob(b.mobId)} · [[${MOBS[b.mobId].name} (Hoard encounter)|how the fight works]]`,
        ),
    );
  w.describe(
    'Buried hoards',
    heading(
      'Hoard bosses',
      'Every hoard is guarded by one boss. Each map picks its own. Open a boss for its stats and loot, or the fight guide for what it does.\n\n' +
        `'''${CAVE_HOARD}'''\n\n` +
        guardianList(CAVE_HOARD) +
        `\n\n'''${VALLEY_HOARD}'''\n\n` +
        guardianList(VALLEY_HOARD),
    ),
  );
  w.describe(
    'Rifts',
    heading(
      'Rift bosses',
      'The boss waits on the last floor. Which boss you meet depends on the floor theme. The Infernal Citadel has two.\n\n' +
        list(riftBosses().map((b) => `${mob(b.mobId)} · [[${b.place} (Rift floor)|${b.place}]]`)),
    ),
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
      `Found in ${theme.name} on ${tierList.join(' and ')} maps. See ${mob(boss.id)} for its creature page.`,
      hoardKitGuide(boss.id),
      rows.length
        ? heading(
            'Marked attacks',
            list(
              rows.map((v) => {
                const a = hoardMarkSpec(v);
                return `${a.ability}: ${a.windup}-second warning, hits within ${a.radius} yards${a.innerRadius ? ` (safe within ${a.innerRadius} yards of the middle)` : ''}.${a.impactFraction ? ` First hit of ${a.school} damage, before anything on you lowers it: ${amounts(a.impactFraction)}.` : ''}${a.hazardDuration ? ` It leaves an effect on the ground for ${a.hazardDuration} seconds.` : ''}${a.pulseFraction ? ` It deals ${amounts(a.pulseFraction)} every ${a.pulseEvery} seconds.` : ''}`;
              }),
            ),
          )
        : '',
      heading(
        'Gear by map rarity',
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
