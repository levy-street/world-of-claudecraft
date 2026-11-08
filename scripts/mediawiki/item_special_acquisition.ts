import { MEMBERSHIP_ANNUAL_REINS } from '../../src/membership_annual_contract';
import {
  GOURDLIGHT_POUCH_SWEETS,
  GOURDLIGHT_SWEET_ID,
  GOURDLIGHT_TREAT_POUCH_ID,
  TRICK_OR_TREAT,
  TRICK_OR_TREAT_NPCS,
} from '../../src/sim/content/gourdlight_eve';
import {
  CURSED_CANDLE_ID,
  CURSED_CANDLES_WANTED,
  GOURDLIGHT_DAILY_PATCH_QUEST_ID,
  GOURDLIGHT_DAILY_WICKS_QUEST_ID,
  PATCH_PUMPKIN_ID,
  PATCH_PUMPKINS_WANTED,
} from '../../src/sim/content/gourdlight_eve_dailies';
import {
  GUILD_CONTRACT_SEALS,
  LANTERN_HALL_DESTRIER_REINS_ID,
  LANTERN_HALL_DESTRIER_SEALS,
  LANTERN_SEAL_ITEM_ID,
} from '../../src/sim/content/guild_contracts';
import { RETIRED_HEROIC_ITEMS } from '../../src/sim/content/heroic_loot';
import {
  CONTRACT_CLERK_NPC_ID,
  GUILD_QUARTERMASTER_NPC_ID,
} from '../../src/sim/content/highwatch_guild';
import { MEMBERSHIP_TOKEN_ID, MEMBERSHIP_WEAPON_ID } from '../../src/sim/content/membership';
import { MUSTER_RACK } from '../../src/sim/content/mirefen_muster';
import { DEVELOPER_MOUNTS } from '../../src/sim/content/mounts';
import {
  REFERRAL_BAG,
  REFERRAL_FOG_TRINKET,
  REFERRAL_HOLLOW_TRINKET,
  REFERRAL_RAPTOR_REINS,
  REFERRAL_SLIME_REINS,
} from '../../src/sim/content/referral_rewards';
import { EVENT_SKIN_TOKEN_ID, MECH_CHROMAS } from '../../src/sim/content/skins';
import { DUNGEONS, ITEMS } from '../../src/sim/data';
import { MUSTER_PIKE_MAX_LEVEL, MUSTER_SHARDPIKE_ID } from '../../src/sim/lance_balance_core';
import { isMembershipArmour, isReferralArmour } from '../../src/sim/membership_armour';
import {
  MAKERS_EMBER_ITEM_ID,
  SUNDERED_ESSENCE_ITEM_ID,
  WYRMFALL_CORE_ITEM_ID,
} from '../../src/sim/professions/masterwrought_materials';
import { SUNDERED_ESSENCE_YIELD } from '../../src/sim/professions/sundering';
import { WORLD_PVP_SKULL_ITEM_ID } from '../../src/sim/pvp/world_pvp_trophy';
import { RETIRED_ZONE1_ITEM_IDS } from '../../src/sim/removed_zone1_content';
import { gourdlightDailySites } from '../../src/sim/seasonal_daily_sites';
import { resolvedKeeperPosts } from '../../src/sim/seasonal_keeper_posts';
import { WORLD_SEED } from '../../src/sim/world_seed';
import { type ArticleTools, pct, ref, words } from './entity_format';
import { addAcquisition, type ItemAcquisition } from './item_acquisition_types';
import type { RoutePoint } from './quest_map';
import { npcPin, worldPin } from './system_route_points';
import { systemRoutes } from './system_routes';

export function addSpecialAcquisitions(w: ArticleTools, index: Map<string, ItemAcquisition[]>) {
  const add = (id: string, source: ItemAcquisition) => addAcquisition(index, id, source);
  const item = (id: string) => ref(w, 'item', id);
  for (const [id, dungeonId] of [
    ['last_keep_signet', 'the_last_keep'],
    ['dawnhold_posy', 'dawnhold_castle'],
  ]) {
    const dungeon = DUNGEONS[dungeonId];
    const object = dungeon.objects?.find((o) => o.itemId === id);
    if (!object) throw new Error('Missing mapped keepsake: ' + id);
    add(id, {
      title: 'Collect inside ' + dungeon.name,
      steps: [
        'Travel to the marked door and enter ' +
          ref(w, 'dungeon', dungeonId) +
          '. This sightseeing interior is not queued through Dungeon Finder.',
        'Inside the entrance hall, walk to room x ' +
          object.x +
          ', z ' +
          object.z +
          ' and interact with ' +
          object.name +
          ' on the floor.',
        'Collect the item with room in your bags. No boss kill or crafting materials are required.',
      ],
      points: [
        worldPin('Start', dungeon.doorPos.x, dungeon.doorPos.z, 'Enter ' + dungeon.name),
        {
          step: 'Reward',
          frame: dungeon.name,
          x: object.x,
          z: object.z,
          label: 'Collect ' + object.name,
        },
      ],
      details: [
        "A fixed placed pickup, not a percentage enemy drop. The interior coordinates use this room's frame, not the overworld.",
      ],
    });
  }
  const dailySites = gourdlightDailySites(WORLD_SEED);
  const keepers = resolvedKeeperPosts(WORLD_SEED);
  for (const [id, questId, count, sites] of [
    [PATCH_PUMPKIN_ID, GOURDLIGHT_DAILY_PATCH_QUEST_ID, PATCH_PUMPKINS_WANTED, dailySites.patch],
    [CURSED_CANDLE_ID, GOURDLIGHT_DAILY_WICKS_QUEST_ID, CURSED_CANDLES_WANTED, dailySites.candles],
  ] as const)
    add(id, {
      title: 'Gourdlight seasonal quest collection',
      steps: [
        'While [[Gourdlight Eve]] is active, visit Hester at any marked seasonal counter and accept ' +
          ref(w, 'quest', questId) +
          ' when it is the offered rotating daily.',
        'Travel to the marked collection sites and interact with ' +
          (id === PATCH_PUMPKIN_ID
            ? "the pumpkins around Old Thatchgrin's patch"
            : 'the cursed candle stubs at town lamp posts') +
          '. Collect ' +
          count +
          ' in total. The objects are quest-gated and appear to you only while you need them.',
        'Return to a marked Hester counter and turn in the quest. The collected items are quest materials; the reward is ' +
          item(GOURDLIGHT_TREAT_POUCH_ID) +
          '.',
      ],
      points: [
        ...keepers.map((p) => worldPin('Start', p.pos.x, p.pos.z, 'Hester: accept the daily')),
        ...sites.map((p) => worldPin(2, p.x, p.z, 'Collect ' + item(id))),
        ...keepers.map((p) =>
          worldPin('Reward', p.pos.x, p.pos.z, 'Hester: hand in and collect Treat Pouch'),
        ),
      ],
      details: [
        'One of six rotating errands is offered each reset day. Coordinates are resolved from the shipped world seed; no purchase or random drop roll is required.',
      ],
    });
  const membershipPoints = [
    npcPin('Start', 'bursar_fernando', 'Example banker: Account bank'),
    npcPin('Reward', 'bursar_fernando', 'Claim membership gear'),
  ];
  add(MEMBERSHIP_TOKEN_ID, {
    title: 'Membership purchase delivery',
    steps: [
      'In the online game, open WOC Store and select Membership. Choose Buy membership token and complete the supported purchase.',
      'Return on the purchasing character and select Collect purchased token. Take the token from its purchase parcel or mailbox.',
      'Use the token from Bags to add 30 days of account membership, or keep the unused token to trade.',
    ],
    details: [
      "Purchase and collection use the store interface wherever you stand. The checkout shows the current real-money price. An invited friend's first paid membership purchase also rewards their inviter with a token; see [[Referral cards]].",
    ],
  });
  add(MEMBERSHIP_ANNUAL_REINS, {
    title: 'Annual membership bundle',
    steps: [
      'Open WOC Store, then Membership, and complete the paid annual bundle purchase.',
      'Return to the store and choose Collect bundle mount. Collect its delivered parcel and use the reins from your bags.',
    ],
    details: [
      'The mount belongs to the annual bundle entitlement. Ordinary 30-day token redemption does not substitute for the paid annual bundle. Collection is through the store, without a fixed NPC destination.',
    ],
  });
  for (const def of Object.values(ITEMS)) {
    if (isMembershipArmour(def.id) || def.id === MEMBERSHIP_WEAPON_ID)
      add(def.id, {
        title: 'Claim membership equipment',
        points: membershipPoints,
        steps: [
          'Activate [[Membership]] on your account. A token in your bags must be used before its time and benefits are active.',
          'Visit a banker, open the Account bank and choose Claim membership gear.',
          'Collect the scaling equipment. Equip the complete seven-piece armor set for its membership XP bonus; the weapon is separate.',
        ],
        details: [
          'This is an entitlement claim, not a random drop or a gold purchase. The marked banker is one verified place to claim it.',
        ],
      });
    if (isReferralArmour(def.id))
      add(def.id, {
        title: 'Referral armor entitlement',
        steps: [
          "Create your account using your inviter's referral link, as described in [[Referral cards]]. The online account service must verify the referral armor entitlement.",
          'Enter the game on that account. When the verified entitlement is applied, the game automatically claims the referral armor for the character. Check your equipment and bags.',
          'For its XP bonus, equip the complete referral armor set and party with the inviting account while that inviter has active [[Membership]].',
        ],
        details: [
          'Referral armor is distinct from the five stamp-card rewards. No NPC sells this entitlement, and simply grouping with another player does not create it.',
        ],
      });
    if (def.kind === 'mount' && DEVELOPER_MOUNTS.includes(def.mount))
      add(def.id, {
        title: 'Developer-only item',
        steps: [
          'This mount is granted by a developer. There is no ordinary gameplay drop, vendor, crafting recipe or map route for it.',
        ],
      });
  }
  const referralStart = [
    'Before creating the invited account, the inviter opens Social → Refer a Friend and shares their invitation link. The friend creates their account through that link.',
    'On the same realm, each player uses a level 1-4 character who has not turned in Set Sail. Party together with /invite. Both accept the stamp-card prompt; if needed, reopen Social → Refer a Friend, select Start, and both accept.',
  ];
  const stamps = [
    {
      id: REFERRAL_BAG,
      stamp: 1,
      objective:
        'Both assigned characters turn in [[Set Sail]] to ' +
        ref(w, 'npc', 'ferryman_odo') +
        ' while grouped.',
    },
    {
      id: REFERRAL_HOLLOW_TRINKET,
      stamp: 2,
      objective:
        'With both assigned characters level 5 or higher, defeat ' +
        ref(w, 'mob', 'morthen') +
        ' together in ' +
        ref(w, 'dungeon', 'hollow_crypt') +
        '. Both must be inside and eligible for the kill. The corresponding quest turn-in while grouped is also a route.',
    },
    {
      id: REFERRAL_FOG_TRINKET,
      stamp: 3,
      objective:
        'With both assigned characters level 12 or higher, defeat ' +
        ref(w, 'mob', 'vael_the_mistcaller') +
        ' together in the Fogbinder. Both must be inside and eligible for the kill. The corresponding quest turn-in while grouped is also a route.',
    },
    {
      id: REFERRAL_SLIME_REINS,
      stamp: 5,
      objective:
        'Defeat a raid boss together on your assigned characters, meeting its entry level. The map shows ' +
        ref(w, 'mob', 'nythraxis_scourge_of_thornpeak') +
        ' as one qualifying level-20 route. Complete stamp 4 first by defeating ' +
        ref(w, 'mob', 'korzul_the_gravewyrm') +
        ' together at level 18 or above, or its qualifying quest turn-in.',
    },
  ];
  for (const row of stamps)
    add(row.id, {
      title: 'Referral card stamp ' + row.stamp,
      steps: [
        ...referralStart,
        row.objective,
        'Each player opens their own card in Social → Refer a Friend. Redeem all earlier stamps in order, then select Redeem for this stamp. The item is received wherever you stand.',
      ],
      points: systemRoutes['Referral cards'].points
        .filter((p) => typeof p.step === 'number' && p.step <= row.stamp)
        .map((p) => ({ ...p, step: 3, label: 'Referral ' + p.label })),
      details: [
        'Map labels retain the stamp numbers; all are part of step 3. The current v0.45.7 dungeon kill route does not require the dungeon quest. See [[Referral cards]] for every earlier stamp and its exact requirements.' +
          (row.id === REFERRAL_FOG_TRINKET
            ? ' Redeeming this stamp replaces the Hollow charm and permanently locks this card to this character.'
            : ''),
      ],
    });
  add(REFERRAL_RAPTOR_REINS, {
    title: 'Invite one friend who completes their card',
    steps: [
      ...referralStart,
      'Help your invited friend finish the five stamps in [[Referral cards]]. The friend must personally redeem all five; earning the stamps without redeeming them does not count.',
      'Open Social → Refer a Friend and inspect your inviter rewards. The first completed invited friend earns these reins once. Collect the reward and use the reins from Bags.',
    ],
    details: [
      'The reward counts completed friends on the inviting account. The full [[Referral cards]] guide maps all five milestones.',
    ],
  });

  add(SUNDERED_ESSENCE_ITEM_ID, {
    title: 'Sunder raid equipment',
    steps: [
      'Put an eligible epic raid weapon, armor piece or held offhand in your bags. Normal and Heroic raid gear qualify; dungeon-only epics, crafted gear, recipes and materials do not.',
      "Open that item's bag context menu and select Sunder. Select the copy you intend to consume and let the cast finish.",
      'The selected gear is destroyed and you receive ' +
        SUNDERED_ESSENCE_YIELD +
        ' ' +
        item(SUNDERED_ESSENCE_ITEM_ID) +
        '.',
    ],
    details: [
      'Guaranteed yield, with no profession or crafting-station requirement. This can be done where you are; the expensive input is the consumed epic.',
    ],
  });
  const heroicExample = systemRoutes['Heroic difficulty'].points
    .filter((p) => !p.label.includes('Quartermaster'))
    .map((p) => ({ ...p, step: p.frame === 'Overworld' ? 'Start' : 2 }) as RoutePoint);
  for (const id of [MAKERS_EMBER_ITEM_ID, WYRMFALL_CORE_ITEM_ID])
    add(id, {
      title: 'Eligible endgame completion',
      points: heroicExample,
      steps: [
        'One mapped example is the Hollow Crypt on Heroic. Before entering, open your portrait menu, Set Dungeon Difficulty → Heroic; meet its entry rules and daily lockout. Other eligible raids and Heroic dungeons are alternatives.',
        'Enter, clear the route and defeat its final boss with eligible kill credit. A qualifying natural rank A or S rift is an alternative; developer portals do not qualify. Cores require winning the first-clear race, while an Ember can also be earned by finishing after another group.',
        'Check your bags for the personal material grant after completion. Overflow follows the normal item-delivery rules.',
      ],
      details:
        id === MAKERS_EMBER_ITEM_ID
          ? [
              'One weekly Ember grant per character, with missed grants accruing from the saved weekly anchor. A completion can pay up to 20 accrued Embers; further backlog remains for a later completion. Eligible raid bosses, Heroic final bosses and qualifying A/S rifts can trigger the grant.',
            ]
          : [
              'An eligible final boss awards 1-3 Cores, one shared quantity roll for each credited participant, once per character per source per reset day. Raid Normal and Heroic are separate sources. Qualifying rift first clears give 1 at rank A or 2 at S, limited to one rift material grant per reset day.',
            ],
    });

  add(LANTERN_SEAL_ITEM_ID, {
    title: 'Weekly Lantern Hall contracts',
    points: [npcPin('Start', CONTRACT_CLERK_NPC_ID, 'Read Contracts')],
    steps: [
      'Visit ' +
        ref(w, 'npc', CONTRACT_CLERK_NPC_ID) +
        ' in Lantern Hall, Highwatch, and open Contracts. No sign-up, fee or player-guild membership is required.',
      "Read this week's three notices. Complete the named boss bounty at either difficulty, the specified Heroic clear, or the encounter task exactly as the notice says. Follow the named dungeon article for its entrance and boss map.",
      'An eligible first completion of each contract that week grants Lantern Seals directly to your bags. No return hand-in is needed.',
    ],
    details: [
      'Seals per contract: ' +
        Object.entries(GUILD_CONTRACT_SEALS)
          .map(([kind, n]) => words(kind) + ' ' + n)
          .join(', ') +
        '. The board changes at weekly reset.',
    ],
  });
  add(LANTERN_HALL_DESTRIER_REINS_ID, {
    title: 'Lantern Hall quartermaster',
    points: [
      npcPin('Start', CONTRACT_CLERK_NPC_ID, 'Earn contract Seals'),
      npcPin('Reward', GUILD_QUARTERMASTER_NPC_ID, 'Quartermaster: buy reins'),
    ],
    steps: [
      'Earn ' +
        LANTERN_HALL_DESTRIER_SEALS +
        ' ' +
        item(LANTERN_SEAL_ITEM_ID) +
        ' through [[Guild contracts]].',
      'Visit ' +
        ref(w, 'npc', GUILD_QUARTERMASTER_NPC_ID) +
        ' in Lantern Hall and open Quartermaster. Bring riding training and bag space.',
      'Select the reins and press Buy. The price is ' +
        LANTERN_HALL_DESTRIER_SEALS +
        ' Lantern Seals. Use the reins in Bags to learn the mount.',
    ],
  });

  add(GOURDLIGHT_SWEET_ID, {
    title: 'Seasonal trick-or-treat visits',
    points: Object.values(TRICK_OR_TREAT_NPCS)
      .flat()
      .map((id) => npcPin('Reward', id, 'Trick-or-treat: sweets')),
    steps: [
      'Wait until [[Gourdlight Eve]] is active. Visit a participating townsperson shown on the map in Eastbrook, Fenbridge or Highwatch.',
      'Talk within ' +
        TRICK_OR_TREAT.range +
        ' yards and choose the trick-or-treat interaction. Each townsperson can reward you once per reset day.',
      'Receive ' +
        TRICK_OR_TREAT.treatSweets +
        ' sweets on a treat (' +
        pct(TRICK_OR_TREAT.treatChance) +
        ') or ' +
        TRICK_OR_TREAT.trickSweets +
        ' sweet on a trick. A trick also applies a harmless cosmetic effect.',
    ],
    details: [
      "These visits are seasonal. Existing sweets remain usable for the event's purchases when the keeper is present.",
    ],
  });
  add(GOURDLIGHT_SWEET_ID, {
    title: 'Open a Gourdlight Treat Pouch',
    steps: [
      'Complete a [[Gourdlight Eve]] daily quest that shows ' +
        item(GOURDLIGHT_TREAT_POUCH_ID) +
        ' as its reward. Its quest page maps the objectives and hand-in.',
      'Use the awarded pouch from your bags to receive ' + GOURDLIGHT_POUCH_SWEETS + ' sweets.',
    ],
    details: ['Guaranteed contents: ' + GOURDLIGHT_POUCH_SWEETS + ' sweets per pouch.'],
  });
  add(MUSTER_SHARDPIKE_ID, {
    title: 'Borrow the muster drill weapon',
    points: [
      worldPin('Start', MUSTER_RACK.x, MUSTER_RACK.z, 'Muster Weapon Rack'),
      worldPin('Reward', MUSTER_RACK.x, MUSTER_RACK.z, 'Borrowed weapon'),
    ],
    steps: [
      'Go to the Muster Weapon Rack in Mirefen Marsh at x ' +
        MUSTER_RACK.x +
        ', z ' +
        MUSTER_RACK.z +
        ' at level ' +
        MUSTER_PIKE_MAX_LEVEL +
        ' or lower. No quest is required.',
      'Interact with the rack to borrow and equip its pike. Keep bag room for your own equipment.',
    ],
    details: [
      'This is loaned drill gear, not a permanent dungeon drop. It is reclaimed when the drill ends, the muster pull ends, you die, or you leave the muster area.',
    ],
  });
  add(WORLD_PVP_SKULL_ITEM_ID, {
    title: 'World PvP trophy',
    steps: [
      'Enable your world PvP flag and fight another flagged player in the overworld.',
      "Land the qualifying killing blow. Loot the defeated player's body where they fell to take the trophy.",
    ],
    details: [
      'The location is determined by the player fight, not a fixed creature spawn. See [[World PvP]] for the flag and trophy rules.',
    ],
  });
  add('soul_stone', {
    title: 'Take stones from a Soulwell',
    steps: [
      'Have a party Warlock cast ' + ref(w, 'ability', 'soulwell') + '.',
      "Interact with the resulting Soulwell while eligible for that party's well. Make space in your bags.",
      'The well refills your carried Soul Stones up to three.',
    ],
    details: [
      "The well is conjured at the caster's location and lasts three minutes, so it has no permanent map pin.",
    ],
  });
  for (const [base, ability] of [
    ['conjured_water', 'conjure_water'],
    ['conjured_bread', 'conjure_food'],
  ])
    for (const id of Object.keys(ITEMS).filter(
      (id) => id === base || new RegExp('^' + base + '[0-9]+$').test(id),
    ))
      add(id, {
        title: 'Conjure with a Mage ability',
        steps: [
          'Learn ' +
            ref(w, 'ability', ability) +
            ' at rank ' +
            (Number(id.slice(base.length)) || 1) +
            ' and have its required mana and bag space.',
          'Cast that rank from your spellbook or action bar to create two. A Mage can also conjure them for another player to receive through a trade.',
        ],
        details: [
          "The creation happens at the caster's position. See the linked ability for its rank, learning and mana requirements.",
        ],
      });

  const unavailable = (id: string, text: string) =>
    add(id, {
      title: 'Availability',
      steps: [text],
      details: [
        'There is no verified current farming location, purchase price or crafting route for this item record.',
      ],
    });
  unavailable(
    'clue_scroll',
    'Existing scrolls can still start [[Clue hunts]]. The current rotating world-quest slate awards treasure maps instead. Developer-enabled realms can grant a scroll; an ordinary new-scroll source is not present in this snapshot.',
  );
  unavailable(
    EVENT_SKIN_TOKEN_ID,
    'This skin-selection token is developer-grantable on realms with developer commands enabled. No ordinary gameplay source is defined in this snapshot.',
  );
  for (const chroma of MECH_CHROMAS)
    unavailable(
      chroma.id + '_armor_plate',
      'This individual armor-plate item has no ordinary loot, shop or recipe source in the current content tables. The appearance can instead be selected from ' +
        item('alien_armor_plate') +
        ' when its rolled rank permits it; selecting an appearance unlocks it for the account and does not award this separate plate item.',
    );
  for (const id of [
    'valeborn_spellblade',
    'hollowbound_legguards',
    'gravepath_treads',
    'bristlehide_spaulders',
    'sableweb_cord',
    'crossroads_saber',
    'wanderers_chestguard',
  ])
    unavailable(
      id,
      'This item has no confirmed way to obtain it in this edition of the game. No current quest reward, creature drop, vendor or crafting recipe provides it.',
    );
  unavailable(
    'ancient_crypt_door',
    'This door is a world object, not a collectible reward. It has no confirmed location or interaction in this edition of the game.',
  );
  for (const id of [
    ...RETIRED_ZONE1_ITEM_IDS,
    ...Object.keys(RETIRED_HEROIC_ITEMS),
    'chunk_of_ore',
  ])
    unavailable(
      id,
      'Retired content: no new reward route is active for this legacy item. Existing saved copies remain valid; do not farm its former source.',
    );
  for (const id of [
    'reins_mech_bird',
    'reins_rallycart_rxt',
    'reins_goblin_rocket_sled',
    'reins_chimeglass_tortoise',
    'reins_rickshaw_mount',
  ])
    unavailable(
      id,
      'Legacy souvenir retained for existing inventories. The separate mount skin is an account entitlement; these reins do not unlock that skin.',
    );
}
