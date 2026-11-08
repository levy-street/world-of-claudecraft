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
      ' slots. Each purchased expansion adds ' +
      BANK_EXPANSION_SLOTS +
      ' slots. The default prices in purchase order are ' +
      BANK_EXPANSION_PRICES.join(', ') +
      ' copper. A bag socket accepts a bag to extend storage. Socket prices in order are ' +
      BANK_SOCKET_PRICES.join(', ') +
      ' copper.',
  );
  w.describe(
    'Materials Vault',
    'Unlock the Materials Vault at a banker to store up to ' +
      VAULT_BASE_CAP +
      ' units of each material separately. Each upgrade adds ' +
      VAULT_UPGRADE_STEP +
      ' more units per material. In eligible areas a craft can draw from this vault after it exhausts eligible materials in your bags.',
    heading(
      'Default banker prices',
      list(
        VAULT_UPGRADE_PRICES.map(
          (p, i) =>
            VAULT_BASE_CAP +
            i * VAULT_UPGRADE_STEP +
            ' units per material: ' +
            p / 10000 +
            ' gold for this step.',
        ),
      ),
    ),
  );
  w.describe(
    'Weekly Vault',
    'Complete activities during the week. At reset, each threshold reached unlocks another candidate. Visit the Vault Keeper to open your choices. You can keep one reward across all rows for the earned week. Opening fixes each roll and reconnecting preserves the choices.',
    list([
      'Raid final-boss clears: ' +
        WEEKLY_THRESHOLDS.raid.join(', ') +
        '. Repeat clears count. Difficulty is based on your best clears.',
      'Dungeon clears: ' +
        WEEKLY_THRESHOLDS.dungeon.join(', ') +
        '. Sorted best to worst, the clear at each threshold sets the difficulty of that choice.',
      'World quest completions: ' +
        WEEKLY_THRESHOLDS.world.join(', ') +
        '. This row uses normal gear from the previous raid tier.',
      'PvP wins: ' +
        WEEKLY_THRESHOLDS.pvp.join(', ') +
        '. Ranked arena and rated battleground wins count. [[King of the Hill]] also credits eligible winners.',
    ]),
  );
  w.describe(
    'Bank courier',
    'The courier moves whole stacks between your bags and personal storage. An active membership is required to dispatch a new delivery. Select up to ' +
      COURIER_CAPACITY +
      ' cargo slots. Each leg of the route takes at most ' +
      COURIER_MAX_LEG_SECONDS +
      ' seconds of active travel. Logging out freezes the delivery. Death or entering a private instance pauses return travel. Once the courier returns, items that do not fit go to overflow.',
  );
  w.describe(
    'Membership',
    'One ' +
      item('membership_token') +
      ' grants ' +
      MEMBERSHIP_DURATION_SECONDS / 86400 +
      ' days. With an active membership, wear all ' +
      MEMBERSHIP_ARMOUR_SLOTS.length +
      ' membership armor pieces to multiply an XP award by ' +
      MEMBERSHIP_XP_MULTIPLIER +
      ', rounding down. The weapon is separate from the armor set. A qualifying referral set uses the same bonus; the two bonuses do not stack.',
  );
  addReferralGuide(w);
  w.describe(
    'Gourdlight Eve',
    'Talk to a participating townsperson within ' +
      TRICK_OR_TREAT.range +
      ' yards. Each can be visited once per reset day during the event. A treat (' +
      percent(TRICK_OR_TREAT.treatChance) +
      ') pays ' +
      TRICK_OR_TREAT.treatSweets +
      ' sweets; a trick pays ' +
      TRICK_OR_TREAT.trickSweets +
      ' and applies a temporary cosmetic effect.',
    'Trade ' +
      GOURDLIGHT_BROOM_SHEAVES +
      ' x ' +
      item(GOURDLIGHT_SHEAF_ID) +
      ' for ' +
      item(GOURDLIGHT_BROOM_ID) +
      '. Thatchgrin also has a ' +
      percent(GOURDLIGHT_BROOM_DROP_CHANCE) +
      ' eligible contributor roll for a broom you do not own.',
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
    'Natural rifts require level ' +
      RIFT_MIN_LEVEL +
      '. An open portal lasts up to ' +
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
      'Enemies on the first three floors, where present, are level ' +
        [0, 1, 2].map((f) => riftFloorLevel(base, f)).join(', ') +
        ', respectively. A boss with a ranked kit can use the first ' +
        RIFT_RANK_MECHANIC_BUDGET[rank] +
        ' mechanics from that kit.',
      heading(
        'Enemy scaling',
        list([
          'Ordinary enemies: ' +
            t.healthMultiplier +
            ' times base health and ' +
            t.damageMultiplier +
            ' times base damage.',
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
        ' band begins at item level ' +
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
        'Flagging opens at level ' +
          WORLD_PVP_MIN_LEVEL +
          '. Disarming takes ' +
          WORLD_PVP_DISARM_SECONDS +
          ' seconds. While fully flagged, gain ' +
          percent(WORLD_PVP_XP_BONUS) +
          ' extra XP, rounded down.',
        'A qualifying kill stakes ' +
          percent(WORLD_PVP_STAKE_FRACTION) +
          " of the victim's purse rounded down, up to " +
          WORLD_PVP_STAKE_CAP_COPPER / 10000 +
          ' gold. Base Honor is ' +
          WORLD_PVP_KILL_HONOR +
          '. Credit considers assists from the last ' +
          WORLD_PVP_ASSIST_WINDOW +
          ' seconds. A victim more than ' +
          WORLD_PVP_GREY_LEVEL_GAP +
          ' levels below you pays nothing.',
        'For repeated kills of the same opponent inside ' +
          WORLD_PVP_DR_WINDOW_SECONDS / 3600 +
          ' hour, ordinary payout multipliers are ' +
          [0, 1, 2, 3].map((k) => percent(worldPvpPairMultiplier(k))).join(', ') +
          ' in kill order.',
        'A streak of ' +
          WORLD_PVP_BOUNTY_STREAK +
          ' earns a bounty. Defeating its holder pays ' +
          WORLD_PVP_BOUNTY_KILL_HONOR_MULT +
          ' times kill Honor.',
      ]),
    ),
  );
  w.describe(
    'Honor and Warfare gear',
    'Every ' +
      PVP_RATING_PER_PCT +
      ' eligible offense or defense rating gives 1 percentage point on its PvP scale, capped at ' +
      percent(PVP_OFFENSE_CAP) +
      ' offense and ' +
      percent(PVP_DEFENSE_CAP) +
      ' defense. Defense rating also grants a PvP vitality bonus of 1% per ' +
      PVP_VITALITY_RATING_PER_PCT +
      ' rating up to ' +
      percent(PVP_VITALITY_CAP) +
      '.',
  );
  w.describe(
    'Fiesta arena',
    'Two teams of two fight for takedowns. First to ' +
      FIESTA_SCORE_LIMIT +
      ' wins. At ' +
      FIESTA_MAX_DURATION +
      ' seconds the higher score wins, with equal scores a draw. The first augment wave opens at ' +
      FIESTA_FIRST_WAVE_AT +
      ' seconds. Further waves are ' +
      FIESTA_WAVE_INTERVAL +
      ' seconds apart.',
    'Respawn wait starts at ' +
      FIESTA_RESPAWN_BASE +
      ' seconds. Add ' +
      FIESTA_RESPAWN_PER_DEATH +
      ' seconds for each previous death and ' +
      FIESTA_RESPAWN_PER_MINUTE +
      ' seconds for each full minute of the fight, capped at ' +
      FIESTA_RESPAWN_MAX +
      ' seconds. Standing outside the shrinking ring costs ' +
      percent(FIESTA_RING_DPS_PCT) +
      ' of maximum health per second.',
    'Power-ups announce their location ' +
      FIESTA_POWERUP_TELEGRAPH +
      ' seconds before pickup. Move within ' +
      FIESTA_POWERUP_RADIUS +
      ' yards within ' +
      FIESTA_POWERUP_TTL +
      ' seconds once ready. See [[Fiesta augments]] and [[Fiesta power-ups]].',
  );

  w.describe(
    'The Card Master',
    `Each player starts with ${STARTING_HAND_SIZE} cards from a personal deck of ${DECK_SIZE}. There are two copies of each number from 1 to ${DECK_SIZE / 2}. Both players choose a card facedown. The higher number wins the round. Tied cards score nothing. Each player draws one replacement, reshuffling the discard pile if needed. First to ${CARD_DUEL_ROUNDS_TO_WIN} round wins takes the match. After ${CARD_DUEL_ROUND_DEADLINE_S} seconds the side that has not played forfeits the match. If both stay idle, neither earns a win.`,
  );
  w.describe(
    'Protect Yumi',
    heading(
      'Former match rules',
      `Teams of three or five tried to destroy the enemy team's ${YUMI_HP}-health cat while defending their own. Both cats relocate every ${YUMI_TELEPORT_EVERY} seconds. A defeated player returns after ${YUMI_RESPAWN_SECONDS} seconds.`,
    ),
    `After ${YUMI_SUDDEN_AT / 60} minutes, teleporting stops. Sudden death starts at step 1 and advances every ${YUMI_SUDDEN_STEP} seconds. Each step adds ${percent(YUMI_SUDDEN_RAMP)} of normal damage taken. Every ${YUMI_SUDDEN_BLEED_EVERY} seconds both cats also lose ${percent(YUMI_SUDDEN_BLEED_PCT)} of their maximum health per step, rounded up. A simultaneous lethal pulse compares health immediately before the pulse, then total enemy-cat damage, then breaks a remaining tie at random.`,
  );
  w.describe(
    'Vale Cup',
    'Eastbrook’s boarball matches tracked goals, keeper saves, wins and guild victories. Previously earned deeds remain in the [[Book of Deeds]]. They award zero Renown and are excluded from completion totals.',
  );
  w.describe(
    'Mount racing',
    heading(
      'Stable course rules',
      `The course attached to ${w.entity('quest', 'q_riding_lessons', 'Riding Lessons')} at the Galecrest stables used the glowing square at (x ${Math.round(MOUNT_RACE_START_PLATFORM.x)}, z ${Math.round(MOUNT_RACE_START_PLATFORM.z)}). The Start Race button began a countdown. Riders had to jump all ${MOUNT_RACE_COURSE.jumps.length} bars in any order, then cross the finish arch at (x ${MOUNT_RACE_COURSE.arch.x}, z ${MOUNT_RACE_COURSE.arch.z}) within ${MOUNT_RACE_COURSE.timeLimitSeconds} seconds. Crossing a bar counted in either direction while airborne. Riders could retry a missed bar. Dying, dismounting or leaving the paddock ended the attempt.`,
    ),
  );
  w.describe(
    'Guild contracts',
    'Each week the board offers one named-boss contract, one Heroic contract and one encounter-task contract. Every realm uses the same weekly rotation. Rewards go to eligible contributors who have yet to complete that contract for the week.',
  );
  for (const c of Object.values(DELVE_COMPANIONS)) {
    w.article(
      'Delve companions',
      c.name,
      'Delve companion',
      `A ${c.role} who follows you in a delve. Every ${DELVE_COMPANION_HEAL_INTERVAL} seconds the companion checks the owner's health percentage and looks for a lower-health party member within 22 yards. If the selected player is hurt and within 22 yards, the heal restores 6%, 8% or 10% of their maximum health at rank 1, 2 or 3, rounded to the nearest whole health and capped at the amount missing.`,
      `Rank 2 costs ${COMPANION_UPGRADE_COSTS[2].marks} Delve Marks. Rank 3 costs ${COMPANION_UPGRADE_COSTS[3].marks} more and revives one fallen ally per run at half health.`,
    );
  }
}
