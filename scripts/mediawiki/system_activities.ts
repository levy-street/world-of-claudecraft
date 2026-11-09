import {
  BANK_BASE_SLOTS,
  BANK_EXPANSION_PRICES,
  BANK_EXPANSION_SLOTS,
  BANK_SOCKET_PRICES,
} from '../../src/sim/bank';
import { COMPANION_UPGRADE_COSTS, DELVE_COMPANIONS } from '../../src/sim/content/delves/companions';
import {
  GOURDLIGHT_BROOM_DROP_CHANCE,
  GOURDLIGHT_BROOM_ID,
  GOURDLIGHT_BROOM_SHEAVES,
  GOURDLIGHT_KEEPER_POSTS,
  GOURDLIGHT_SHEAF_ID,
  GOURDLIGHT_SHOP_PRICES,
  TRICK_OR_TREAT,
} from '../../src/sim/content/gourdlight_eve';
import {
  MEMBERSHIP_ARMOUR_SLOTS,
  MEMBERSHIP_DURATION_SECONDS,
  MEMBERSHIP_XP_MULTIPLIER,
} from '../../src/sim/content/membership';
import { MOUNT_RACE_COURSE, MOUNT_RACE_START_PLATFORM } from '../../src/sim/content/mounts';
import { COURIER_MAX_LEG_SECONDS } from '../../src/sim/courier/motion';
import { COURIER_CAPACITY } from '../../src/sim/courier/types';
import { ITEMS } from '../../src/sim/data';
import {
  VAULT_BASE_CAP,
  VAULT_UPGRADE_PRICES,
  VAULT_UPGRADE_STEP,
} from '../../src/sim/materials_vault';
import { DECK_SIZE, STARTING_HAND_SIZE } from '../../src/sim/minigames/card_hand';
import {
  PVP_DEFENSE_CAP,
  PVP_OFFENSE_CAP,
  PVP_RATING_PER_PCT,
  PVP_VITALITY_CAP,
  PVP_VITALITY_RATING_PER_PCT,
} from '../../src/sim/pvp/power';
import {
  WORLD_PVP_BOUNTY_KILL_HONOR_MULT,
  WORLD_PVP_BOUNTY_STREAK,
} from '../../src/sim/pvp/world_pvp_bounty_rules';
import { WORLD_PVP_XP_BONUS } from '../../src/sim/pvp/world_pvp_rewards_rules';
import {
  WORLD_PVP_ASSIST_WINDOW,
  WORLD_PVP_DISARM_SECONDS,
  WORLD_PVP_DR_WINDOW_SECONDS,
  WORLD_PVP_GREY_LEVEL_GAP,
  WORLD_PVP_KILL_HONOR,
  WORLD_PVP_MIN_LEVEL,
  WORLD_PVP_STAKE_CAP_COPPER,
  WORLD_PVP_STAKE_FRACTION,
  worldPvpPairMultiplier,
} from '../../src/sim/pvp/world_pvp_rules';
import {
  RIFT_BAND_GEM_SLOTS,
  RIFT_BAND_MAX_UPGRADE,
  RIFT_BAND_TIER_BASE_ILVL,
  RIFT_GEM_RATING,
  riftBandItemLevel,
} from '../../src/sim/rift/band_ladder';
import { RIFT_MIN_LEVEL, RIFT_PORTAL_LIFETIME } from '../../src/sim/rift/portals';
import {
  RIFT_RANK_BASE_LEVEL,
  RIFT_RANK_MECHANIC_BUDGET,
  riftFloorLevel,
  riftRankTuningFor,
} from '../../src/sim/rift/ranks';
import {
  CARD_DUEL_ROUND_DEADLINE_S,
  CARD_DUEL_ROUNDS_TO_WIN,
} from '../../src/sim/social/card_duel';
import {
  FIESTA_FIRST_WAVE_AT,
  FIESTA_MAX_DURATION,
  FIESTA_POWERUP_RADIUS,
  FIESTA_POWERUP_TELEGRAPH,
  FIESTA_POWERUP_TTL,
  FIESTA_RESPAWN_BASE,
  FIESTA_RESPAWN_MAX,
  FIESTA_RESPAWN_PER_DEATH,
  FIESTA_RESPAWN_PER_MINUTE,
  FIESTA_RING_DPS_PCT,
  FIESTA_SCORE_LIMIT,
  FIESTA_WAVE_INTERVAL,
} from '../../src/sim/social/fiesta';
import {
  YUMI_HP,
  YUMI_RESPAWN_SECONDS,
  YUMI_SUDDEN_AT,
  YUMI_SUDDEN_BLEED_EVERY,
  YUMI_SUDDEN_BLEED_PCT,
  YUMI_SUDDEN_RAMP,
  YUMI_SUDDEN_STEP,
  YUMI_TELEPORT_EVERY,
} from '../../src/sim/social/yumi';
import { DELVE_COMPANION_HEAL_INTERVAL } from '../../src/sim/types';
import { WEEKLY_THRESHOLDS } from '../../src/sim/weekly_rewards';
import { addReferralGuide } from './referral_guide';
import { heading, list, percent, type SystemWriter } from './system_writer';

export function addActivityRules(w: SystemWriter) {
  const item = (id: string) => w.entity('item', id, ITEMS[id]?.name);
  w.describe(
    'Banking',
    'Your personal bank starts with ' +
      BANK_BASE_SLOTS +
      ' slots. Each expansion you buy adds ' +
      BANK_EXPANSION_SLOTS +
      ' slots. The normal prices, in the order you buy them, are ' +
      BANK_EXPANSION_PRICES.join(', ') +
      ' copper. You can put a bag in a bag socket to get more space. Socket prices, in order, are ' +
      BANK_SOCKET_PRICES.join(', ') +
      ' copper.',
  );
  w.describe(
    'Materials Vault',
    'Unlock the Materials Vault at a banker. It holds up to ' +
      VAULT_BASE_CAP +
      ' of each material, and each material has its own space. Each upgrade adds ' +
      VAULT_UPGRADE_STEP +
      ' more space for every material. In places where it works, crafting uses the materials in your bags first. When those run out, it takes the rest from this vault.',
    heading(
      'Normal banker prices',
      list(
        VAULT_UPGRADE_PRICES.map(
          (p, i) =>
            VAULT_BASE_CAP +
            i * VAULT_UPGRADE_STEP +
            ' of each material: ' +
            p / 10000 +
            ' gold for this step.',
        ),
      ),
    ),
  );
  w.describe(
    'Weekly Vault',
    'Do activities during the week. Each goal you reach adds one more item to choose from at the reset. Visit the Vault Keeper to open your choices. You can keep only one reward from all the rows for that week. Once you open a choice, its item is set. It stays the same even if you log out and back in.',
    list([
      'Raid final-boss clears: ' +
        WEEKLY_THRESHOLDS.raid.join(', ') +
        '. Clearing the same raid again counts. The difficulty of the rewards depends on your best clears.',
      'Dungeon clears: ' +
        WEEKLY_THRESHOLDS.dungeon.join(', ') +
        '. Your clears are put in order from best to worst. For each goal, the clear at that place in the order sets the difficulty of that choice. For example, for the goal of ' +
        WEEKLY_THRESHOLDS.dungeon[1] +
        ' clears, clear number ' +
        WEEKLY_THRESHOLDS.dungeon[1] +
        ' in that order is used.',
      'World quest completions: ' +
        WEEKLY_THRESHOLDS.world.join(', ') +
        '. This row gives Normal gear from the raid tier before the current one.',
      'PvP wins: ' +
        WEEKLY_THRESHOLDS.pvp.join(', ') +
        '. Ranked arena wins and rated battleground wins count. Winners of [[King of the Hill]] who meet its rules also get credit.',
    ]),
  );
  w.describe(
    'Bank courier',
    'The courier carries whole stacks between your bags and your own storage. You need an active membership to send a new delivery. Pick up to ' +
      COURIER_CAPACITY +
      ' slots of cargo. Each part of the trip takes at most ' +
      COURIER_MAX_LEG_SECONDS +
      ' seconds of travel time. If you log out, the delivery stops until you come back. If you die or go into a private instance, the trip back waits. When the courier gets back, anything that does not fit goes to overflow.',
  );
  w.describe(
    'Membership',
    'One ' +
      item('membership_token') +
      ' gives you ' +
      MEMBERSHIP_DURATION_SECONDS / 86400 +
      ' days. While your membership is active, wear all ' +
      MEMBERSHIP_ARMOUR_SLOTS.length +
      ' membership armor pieces. Then every time you get XP, it is multiplied by ' +
      MEMBERSHIP_XP_MULTIPLIER +
      ' and rounded down. The weapon is not part of the armor set. A referral set that counts gives the same bonus, but the two bonuses do not add together.',
  );
  addReferralGuide(w);
  w.describe(
    'Gourdlight Eve',
    'Talk to a townsperson who takes part, from within ' +
      TRICK_OR_TREAT.range +
      ' yards. During the event, you can visit each one once per reset day. A treat (' +
      percent(TRICK_OR_TREAT.treatChance) +
      ' chance) gives ' +
      TRICK_OR_TREAT.treatSweets +
      ' sweets. A trick gives ' +
      TRICK_OR_TREAT.trickSweets +
      ' and changes how you look for a short time.',
    'Trade ' +
      GOURDLIGHT_BROOM_SHEAVES +
      ' x ' +
      item(GOURDLIGHT_SHEAF_ID) +
      ' for ' +
      item(GOURDLIGHT_BROOM_ID) +
      '. When Thatchgrin is defeated, each helper who meets the rules also gets a ' +
      percent(GOURDLIGHT_BROOM_DROP_CHANCE) +
      ' chance at the broom, if they do not own it yet.',
    heading(
      'Keeper locations',
      list(
        GOURDLIGHT_KEEPER_POSTS.map(
          (p) => `${w.entity('zone', p.zoneId)} at x ${p.pos.x}, z ${p.pos.z}.`,
        ),
      ),
    ),
    heading(
      'Sweet prices',
      list(
        Object.entries(GOURDLIGHT_SHOP_PRICES).map(
          ([id, price]) => `${item(id)}: ${price} sweets.`,
        ),
      ),
    ),
  );
  w.describe(
    'Rifts',
    'You need level ' +
      RIFT_MIN_LEVEL +
      ' for natural rifts. An open portal stays open for up to ' +
      RIFT_PORTAL_LIFETIME / 3600 +
      ' hours.',
  );
  for (const rank of ['C', 'B', 'A', 'S'] as const) {
    const base = RIFT_RANK_BASE_LEVEL[rank];
    const t = riftRankTuningFor(base);
    w.article(
      'Rifts',
      `Rank ${rank}`,
      'Rift',
      'Enemies on the first three floors (if the rift has that many) are level ' +
        [0, 1, 2].map((f) => riftFloorLevel(base, f)).join(', ') +
        ', in that order. A boss with a ranked set of attacks can use the first ' +
        RIFT_RANK_MECHANIC_BUDGET[rank] +
        ' attacks from that set.',
      heading(
        'Enemy scaling',
        list([
          'Ordinary enemies: ' +
            t.healthMultiplier +
            ' times their base health and ' +
            t.damageMultiplier +
            ' times their base damage.',
          'Bosses: ' +
            t.bossHealthMultiplier +
            ' times health and ' +
            t.bossDamageMultiplier +
            ' times damage.',
          'Summoned adds: ' +
            t.healthMultiplier +
            ' times health and ' +
            t.addDamageMultiplier +
            ' times damage.',
          `Armor multiplier: ${t.armorMultiplier}.`,
        ]),
      ),
      'A rank ' +
        rank +
        ' band starts at item level ' +
        RIFT_BAND_TIER_BASE_ILVL[rank] +
        ' and can reach ' +
        riftBandItemLevel(rank, RIFT_BAND_MAX_UPGRADE) +
        ' at upgrade rank ' +
        RIFT_BAND_MAX_UPGRADE +
        '. It has ' +
        RIFT_BAND_GEM_SLOTS[rank] +
        ' gem slot(s). A gem adds ' +
        RIFT_GEM_RATING +
        ' of its rating.',
    );
  }
  w.describe(
    'World PvP',
    heading(
      'Flag and payouts',
      list([
        'You can turn on your flag at level ' +
          WORLD_PVP_MIN_LEVEL +
          '. Turning it off takes ' +
          WORLD_PVP_DISARM_SECONDS +
          ' seconds. While your flag is fully on, you get ' +
          percent(WORLD_PVP_XP_BONUS) +
          ' more XP, rounded down.',
        'A kill that counts wins a stake of ' +
          percent(WORLD_PVP_STAKE_FRACTION) +
          " of the other player's gold, rounded down, up to " +
          WORLD_PVP_STAKE_CAP_COPPER / 10000 +
          ' gold. Base Honor is ' +
          WORLD_PVP_KILL_HONOR +
          '. Players who helped in the last ' +
          WORLD_PVP_ASSIST_WINDOW +
          ' seconds before the kill also get credit. A player more than ' +
          WORLD_PVP_GREY_LEVEL_GAP +
          ' levels below you gives nothing.',
        'If you kill the same player more than once within ' +
          WORLD_PVP_DR_WINDOW_SECONDS / 3600 +
          ' hour, the normal rewards are scaled to ' +
          [0, 1, 2, 3].map((k) => percent(worldPvpPairMultiplier(k))).join(', ') +
          ' for the first, second, third and fourth kill.',
        'A streak of ' +
          WORLD_PVP_BOUNTY_STREAK +
          ' kills puts a bounty on that player. Defeating the player with the bounty gives ' +
          WORLD_PVP_BOUNTY_KILL_HONOR_MULT +
          ' times the normal kill Honor.',
      ]),
    ),
  );
  w.describe(
    'Honor and Warfare gear',
    'Every ' +
      PVP_RATING_PER_PCT +
      ' offense or defense rating that counts gives 1 percentage point on its PvP scale. The most you can get is ' +
      percent(PVP_OFFENSE_CAP) +
      ' offense and ' +
      percent(PVP_DEFENSE_CAP) +
      ' defense. Defense rating also gives a PvP vitality bonus of 1% for every ' +
      PVP_VITALITY_RATING_PER_PCT +
      ' rating up to ' +
      percent(PVP_VITALITY_CAP) +
      '.',
  );
  w.describe(
    'Fiesta arena',
    'Two teams of two players fight to defeat each other. Each defeat scores a point. The first team to ' +
      FIESTA_SCORE_LIMIT +
      ' points wins. At ' +
      FIESTA_MAX_DURATION +
      ' seconds, the team with the higher score wins. If the scores are equal, it is a draw. The first augment wave opens at ' +
      FIESTA_FIRST_WAVE_AT +
      ' seconds. More waves come every ' +
      FIESTA_WAVE_INTERVAL +
      ' seconds.',
    'The wait to come back to life starts at ' +
      FIESTA_RESPAWN_BASE +
      ' seconds. Add ' +
      FIESTA_RESPAWN_PER_DEATH +
      ' seconds for each previous death and ' +
      FIESTA_RESPAWN_PER_MINUTE +
      ' seconds for each full minute of the fight. The wait is never longer than ' +
      FIESTA_RESPAWN_MAX +
      ' seconds. If you stand outside the shrinking ring, you lose ' +
      percent(FIESTA_RING_DPS_PCT) +
      ' of maximum health per second.',
    'Power-ups show where they will appear ' +
      FIESTA_POWERUP_TELEGRAPH +
      ' seconds before you can pick them up. Once one is ready, get within ' +
      FIESTA_POWERUP_RADIUS +
      ' yards of it within ' +
      FIESTA_POWERUP_TTL +
      ' seconds. See [[Fiesta augments]] and [[Fiesta power-ups]].',
  );

  w.describe(
    'The Card Master',
    `Each player has their own deck of ${DECK_SIZE} cards and starts with ${STARTING_HAND_SIZE} in their hand. The deck has two of each number from 1 to ${DECK_SIZE / 2}. Both players pick a card face down. The higher number wins the round. If the cards are the same, nobody scores. Then each player draws one new card. If the deck is empty, the used cards are shuffled back in. The first player to win ${CARD_DUEL_ROUNDS_TO_WIN} rounds wins the match. If a player has not played a card after ${CARD_DUEL_ROUND_DEADLINE_S} seconds, they lose the match. If neither player plays, nobody wins.`,
  );
  w.describe(
    'Protect Yumi',
    heading(
      'Old match rules',
      `Teams of three or five tried to defeat the other team's cat while keeping their own cat safe. Each cat had ${YUMI_HP} health. Both cats moved to a new spot every ${YUMI_TELEPORT_EVERY} seconds. A defeated player came back after ${YUMI_RESPAWN_SECONDS} seconds.`,
    ),
    `After ${YUMI_SUDDEN_AT / 60} minutes, the cats stopped moving and sudden death began. Sudden death started at step 1 and went up one step every ${YUMI_SUDDEN_STEP} seconds. Each step made the cats take ${percent(YUMI_SUDDEN_RAMP)} more of their normal damage. Every ${YUMI_SUDDEN_BLEED_EVERY} seconds, both cats also lost ${percent(YUMI_SUDDEN_BLEED_PCT)} of their maximum health for each step, rounded up. If that loss defeated both cats at the same moment, the game picked a winner like this:\n* First, the cat with more health just before that moment won.\n* If that was equal, the team that did more damage to the enemy cat won.\n* If that was equal too, the winner was picked at random.`,
  );
  w.describe(
    'Vale Cup',
    'Eastbrook’s boarball matches kept track of goals, keeper saves, wins and guild wins. Deeds you already earned stay in your [[Book of Deeds]]. They give no Renown and do not count toward completion totals.',
  );
  w.describe(
    'Mount racing',
    heading(
      'Stable course rules',
      `The course attached to ${w.entity('quest', 'q_riding_lessons', 'Riding Lessons')} at the Galecrest stables started at the glowing square at (x ${Math.round(MOUNT_RACE_START_PLATFORM.x)}, z ${Math.round(MOUNT_RACE_START_PLATFORM.z)}). The Start Race button began a countdown. Riders had to jump over all ${MOUNT_RACE_COURSE.jumps.length} bars in any order. Then they had to ride through the finish arch at (x ${MOUNT_RACE_COURSE.arch.x}, z ${MOUNT_RACE_COURSE.arch.z}) within ${MOUNT_RACE_COURSE.timeLimitSeconds} seconds. A bar counted if you jumped over it from either side while in the air. Riders could try a missed bar again. Dying, getting off the mount or leaving the paddock ended the try.`,
    ),
  );
  w.describe(
    'Guild contracts',
    'Each week the board has three contracts: one for a named boss, one Heroic contract and one for a task during a boss fight. Every realm gets the same contracts each week. Rewards go to players who helped, met the rules and have not finished that contract yet this week.',
  );
  for (const c of Object.values(DELVE_COMPANIONS)) {
    w.article(
      'Delve companions',
      c.name,
      'Delve companion',
      `A ${c.role} who follows you in a delve. Every ${DELVE_COMPANION_HEAL_INTERVAL} seconds, the companion picks who to heal:\n* First it looks at you, its owner.\n* If a party member within 22 yards has a lower health percentage than you, it picks them instead.\n* If the player it picked is hurt and within 22 yards, it heals them.\nThe heal gives back 6% of their maximum health at rank 1, 8% at rank 2 or 10% at rank 3. It is rounded to the nearest whole number, and never heals more than the health they are missing.`,
      `Rank 2 costs ${COMPANION_UPGRADE_COSTS[2].marks} Delve Marks. Rank 3 costs ${COMPANION_UPGRADE_COSTS[3].marks} more. At rank 3, the companion brings one fallen ally back to life per run, with half their health.`,
    );
  }
}
