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
        'Go to the door marked on the map and enter ' +
          ref(w, 'dungeon', dungeonId) +
          '. This is a place to explore, so you cannot queue for it with Dungeon Finder.',
        'Inside the entrance hall, walk to room x ' +
          object.x +
          ', z ' +
          object.z +
          '. Use ' +
          object.name +
          ' on the floor.',
        'Make sure you have room in your bags, then pick up the item. You do not need to defeat a boss or bring crafting materials.',
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
        'The item always sits in the same spot. It is not a random drop from an enemy. The coordinates inside are measured from this room, not from the outside world map.',
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
        'While [[Gourdlight Eve]] is on, visit Hester at any seasonal counter on the map. Accept ' +
          ref(w, 'quest', questId) +
          ' on a day when it is the daily quest she offers.',
        'Go to the collection spots on the map and use ' +
          (id === PATCH_PUMPKIN_ID
            ? "the pumpkins around Old Thatchgrin's patch"
            : 'the cursed candle stubs at town lamp posts') +
          '. Collect ' +
          count +
          ' in total. You can only see them while you have the quest and still need them.',
        'Go back to a Hester counter on the map and hand in the quest. The items you collected are for the quest. Your reward is ' +
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
        'Each reset day, Hester offers one daily errand from a rotating set of six. The map spots come from this version of the game world. You do not need to buy anything or wait for a random drop.',
      ],
    });
  const membershipPoints = [
    npcPin('Start', 'bursar_fernando', 'Example banker: Account bank'),
    npcPin('Reward', 'bursar_fernando', 'Claim membership gear'),
  ];
  add(MEMBERSHIP_TOKEN_ID, {
    title: 'Membership purchase delivery',
    steps: [
      'In the online game, open WOC Store and select Membership. Choose Buy membership token and finish paying.',
      'Come back on the same character you bought it with and select Collect purchased token. Take the token from its parcel or your mailbox.',
      'Use the token from your bags to add 30 days of membership to your account. Or keep the token unused so you can trade it.',
    ],
    details: [
      'You can buy and collect it from the store wherever you are standing. The checkout shows the current real-money price. When a friend you invited buys membership for the first time, you get a token too. See [[Referral cards]].',
    ],
  });
  add(MEMBERSHIP_ANNUAL_REINS, {
    title: 'Annual membership bundle',
    steps: [
      'Open WOC Store, then Membership, and buy the yearly (annual) bundle.',
      'Go back to the store and choose Collect bundle mount. Collect the parcel it sends you, then use the reins from your bags.',
    ],
    details: [
      'The mount comes only with the paid annual bundle. Using ordinary 30-day tokens does not give you the mount. You collect it from the store, so you do not need to visit any NPC.',
    ],
  });
  for (const def of Object.values(ITEMS)) {
    if (isMembershipArmour(def.id) || def.id === MEMBERSHIP_WEAPON_ID)
      add(def.id, {
        title: 'Claim membership equipment',
        points: membershipPoints,
        steps: [
          'Turn on [[Membership]] for your account. A token sitting in your bags does nothing until you use it.',
          'Visit a banker, open the Account bank and choose Claim membership gear.',
          'Take the gear. It grows stronger as you level up. Wear all seven armor pieces to get the membership XP bonus. The weapon is not part of the set.',
        ],
        details: [
          'You get this for having membership. It is not a random drop, and you do not buy it with gold. The banker on the map is one place we checked where you can claim it.',
        ],
      });
    if (isReferralArmour(def.id))
      add(def.id, {
        title: 'Referral armor entitlement',
        steps: [
          'Make your account using the referral link from the player who invited you, as [[Referral cards]] explains. The online account service must then confirm that your account has earned the referral armor.',
          'Enter the game on that account. Once it is confirmed, the game gives the referral armor to your character by itself. Check your equipment and bags.',
          'To get its XP bonus, wear the whole referral armor set and join a party with the player who invited you. That player must have active [[Membership]].',
        ],
        details: [
          'Referral armor is not one of the five stamp-card rewards. No NPC sells it, and just grouping with another player does not give it to you.',
        ],
      });
    if (def.kind === 'mount' && DEVELOPER_MOUNTS.includes(def.mount))
      add(def.id, {
        title: 'Developer-only item',
        steps: [
          'Only a game developer can give out this mount. You cannot get it from a drop, a shop, a crafting recipe or a place on the map.',
        ],
      });
  }
  const referralStart = [
    'First, the player doing the inviting opens Social → Refer a Friend and shares their invite link. The friend then makes their account using that link.',
    'Both players use a character on the same realm. Each character must be level 1 to 4 and must not have handed in Set Sail yet. Join a party with /invite. You both accept the stamp-card prompt. If it does not show, open Social → Refer a Friend again, select Start, and both accept.',
  ];
  const stamps = [
    {
      id: REFERRAL_BAG,
      stamp: 1,
      objective:
        'While in a party, both of those characters hand in [[Set Sail]] to ' +
        ref(w, 'npc', 'ferryman_odo') +
        '.',
    },
    {
      id: REFERRAL_HOLLOW_TRINKET,
      stamp: 2,
      objective:
        'Once both of those characters are level 5 or higher, defeat ' +
        ref(w, 'mob', 'morthen') +
        ' together in ' +
        ref(w, 'dungeon', 'hollow_crypt') +
        '. You must both be inside and both get credit for the kill. Handing in the matching quest while in a party also works.',
    },
    {
      id: REFERRAL_FOG_TRINKET,
      stamp: 3,
      objective:
        'Once both of those characters are level 12 or higher, defeat ' +
        ref(w, 'mob', 'vael_the_mistcaller') +
        ' together in the Fogbinder. You must both be inside and both get credit for the kill. Handing in the matching quest while in a party also works.',
    },
    {
      id: REFERRAL_SLIME_REINS,
      stamp: 5,
      objective:
        'First finish stamp 4: defeat ' +
        ref(w, 'mob', 'korzul_the_gravewyrm') +
        ' together at level 18 or higher, or hand in its matching quest. Then, on those same characters, defeat a raid boss together. You must be high enough level to enter its raid. The map shows ' +
        ref(w, 'mob', 'nythraxis_scourge_of_thornpeak') +
        ' as one level 20 boss that counts.',
    },
  ];
  for (const row of stamps)
    add(row.id, {
      title: 'Referral card stamp ' + row.stamp,
      steps: [
        ...referralStart,
        row.objective,
        'Each player opens their own card in Social → Refer a Friend. Redeem all earlier stamps in order, then select Redeem for this stamp. You get the item wherever you are standing.',
      ],
      points: systemRoutes['Referral cards'].points
        .filter((p) => typeof p.step === 'number' && p.step <= row.stamp)
        .map((p) => ({ ...p, step: 3, label: 'Referral ' + p.label })),
      details: [
        'The map labels still show the stamp numbers, but they are all part of step 3. In v0.45.7, a dungeon boss kill counts even if you do not have the dungeon quest. See [[Referral cards]] for every earlier stamp and exactly what it needs.' +
          (row.id === REFERRAL_FOG_TRINKET
            ? ' Redeeming this stamp replaces the Hollow charm. It also locks this card to this character for good.'
            : ''),
      ],
    });
  add(REFERRAL_RAPTOR_REINS, {
    title: 'Invite one friend who completes their card',
    steps: [
      ...referralStart,
      'Help the friend you invited finish the five stamps in [[Referral cards]]. Your friend must redeem all five stamps themselves. Earning the stamps without redeeming them does not count.',
      'Open Social → Refer a Friend and look at your inviter rewards. You get these reins one time, for the first invited friend who finishes their card. Collect the reward and use the reins from your bags.',
    ],
    details: [
      'The reward counts the friends who finished their card on the account that invited them. The full [[Referral cards]] guide maps all five stamps.',
    ],
  });

  add(SUNDERED_ESSENCE_ITEM_ID, {
    title: 'Sunder raid equipment',
    steps: [
      'Put an epic raid weapon, armor piece or held offhand in your bags. Gear from Normal and Heroic raids counts. Epics that only come from dungeons, crafted gear, recipes and materials do not count.',
      'Open the menu for that item in your bags and select Sunder. Pick the copy you want to use up, then wait for the cast to finish.',
      'The gear you picked is destroyed and you get ' +
        SUNDERED_ESSENCE_YIELD +
        ' ' +
        item(SUNDERED_ESSENCE_ITEM_ID) +
        '.',
    ],
    details: [
      'You always get this amount. You do not need a profession or a crafting station, and you can do it wherever you are. The costly part is the epic you give up.',
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
        'One example on the map is the Hollow Crypt on Heroic. Before you go in, open your portrait menu and choose Set Dungeon Difficulty → Heroic. You must meet its entry rules, and its daily lockout must allow you in. Other raids and Heroic dungeons that count work too.',
        'Go in, fight your way through and defeat its final boss. You must get credit for the kill. A natural rank A or S rift that counts also works, but portals opened by developers do not. For Cores, your group must be the first to clear it. You can still earn an Ember if another group finished first.',
        'After you finish, look in your bags for your own materials. If they do not fit, the usual item-delivery rules apply.',
      ],
      details:
        id === MAKERS_EMBER_ITEM_ID
          ? [
              'Each character can get one Ember each week. If you miss weeks, the Embers you missed are saved up, counted from the week the game last recorded for you. One completion can pay up to 20 saved Embers. Any more stay saved for a later completion. Raid bosses that count, Heroic final bosses and rank A or S rifts that count can all give Embers.',
            ]
          : [
              'A final boss that counts gives 1 to 3 Cores. The game rolls the amount once, and every player with kill credit gets that same amount. Each character can get Cores from each source once per reset day. Raid Normal and Raid Heroic count as different sources. The first clear of a rift that counts gives 1 Core at rank A or 2 at rank S. You can only get rift materials once per reset day.',
            ],
    });

  add(LANTERN_SEAL_ITEM_ID, {
    title: 'Weekly Lantern Hall contracts',
    points: [npcPin('Start', CONTRACT_CLERK_NPC_ID, 'Read Contracts')],
    steps: [
      'Visit ' +
        ref(w, 'npc', CONTRACT_CLERK_NPC_ID) +
        ' in Lantern Hall, Highwatch, and open Contracts. You do not need to sign up, pay a fee or be in a player guild.',
      "Read this week's three notices. Do each one exactly as it says: defeat the named boss on either difficulty, do the Heroic clear it names, or do the encounter task. The dungeon's own page shows its entrance and boss map.",
      'The first time you finish each contract in a week, Lantern Seals go straight into your bags. You do not need to go back and hand anything in.',
    ],
    details: [
      'Seals for each contract: ' +
        Object.entries(GUILD_CONTRACT_SEALS)
          .map(([kind, n]) => words(kind) + ' ' + n)
          .join(', ') +
        '. The notices change at the weekly reset.',
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
        ' in Lantern Hall and open Quartermaster. You need riding training and a free bag space.',
      'Select the reins and press Buy. The price is ' +
        LANTERN_HALL_DESTRIER_SEALS +
        ' Lantern Seals. Use the reins in your bags to learn the mount.',
    ],
  });

  add(GOURDLIGHT_SWEET_ID, {
    title: 'Seasonal trick-or-treat visits',
    points: Object.values(TRICK_OR_TREAT_NPCS)
      .flat()
      .map((id) => npcPin('Reward', id, 'Trick-or-treat: sweets')),
    steps: [
      'Wait until [[Gourdlight Eve]] is on. Visit one of the townspeople shown on the map in Eastbrook, Fenbridge or Highwatch.',
      'Stand within ' +
        TRICK_OR_TREAT.range +
        ' yards, talk to them and choose trick-or-treat. Each townsperson can give you a reward once per reset day.',
      'A treat (' +
        pct(TRICK_OR_TREAT.treatChance) +
        ' chance) gives you ' +
        TRICK_OR_TREAT.treatSweets +
        ' sweets. A trick gives you ' +
        TRICK_OR_TREAT.trickSweets +
        ' sweet and a harmless effect that is just for show.',
    ],
    details: [
      "You can only do these visits during the event. Sweets you already have can still be spent on the event's items while the keeper is there.",
    ],
  });
  add(GOURDLIGHT_SWEET_ID, {
    title: 'Open a Gourdlight Treat Pouch',
    steps: [
      'Complete a [[Gourdlight Eve]] daily quest that shows ' +
        item(GOURDLIGHT_TREAT_POUCH_ID) +
        ' as its reward. The quest page has a map of what to do and where to hand it in.',
      'Use the pouch from your bags to get ' + GOURDLIGHT_POUCH_SWEETS + ' sweets.',
    ],
    details: ['Every pouch always has ' + GOURDLIGHT_POUCH_SWEETS + ' sweets inside.'],
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
        ' or lower. You do not need a quest.',
      'Use the rack to borrow its pike and equip it. Keep room in your bags for the gear it replaces.',
    ],
    details: [
      'You only borrow this weapon for the drill. It is not a dungeon drop you keep. It is taken back when the drill ends, when the muster pull ends, when you die, or when you leave the muster area.',
    ],
  });
  add(WORLD_PVP_SKULL_ITEM_ID, {
    title: 'World PvP trophy',
    steps: [
      'Turn on your world PvP flag. Fight another player who also has their flag on, out in the open world.',
      "Land the killing blow in a way that counts. Then loot the other player's body where they fell to take the trophy.",
    ],
    details: [
      'Where you get it depends on where the fight happens. It does not come from a creature in a set place. See [[World PvP]] for the flag and trophy rules.',
    ],
  });
  add('soul_stone', {
    title: 'Take stones from a Soulwell',
    steps: [
      'Ask a Warlock in your party to cast ' + ref(w, 'ability', 'soulwell') + '.',
      "Make space in your bags. Then use the Soulwell. You must be allowed to use that party's well.",
      'The well tops up the Soul Stones you carry until you have three.',
    ],
    details: [
      'The well appears where the Warlock is standing and lasts three minutes, so it has no fixed spot on the map.',
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
            '. Have enough mana and bag space for it.',
          'Cast that rank from your spellbook or action bar to make two. A Mage can also make them and trade them to another player.',
        ],
        details: [
          'They are made wherever the Mage is standing. See the linked ability for its ranks, how to learn it and how much mana it costs.',
        ],
      });

  const unavailable = (id: string, text: string) =>
    add(id, {
      title: 'Availability',
      steps: [text],
      details: [
        'We know of no place to farm it, no shop price and no crafting recipe for it right now.',
      ],
    });
  unavailable(
    'clue_scroll',
    'Scrolls you already have can still start [[Clue hunts]]. The world quests on offer right now give treasure maps instead. On realms where developer commands are turned on, a developer can give you a scroll. There is no ordinary way to get a new scroll in this version.',
  );
  unavailable(
    EVENT_SKIN_TOKEN_ID,
    'Only a developer can give out this skin-choice token, on realms where developer commands are turned on. There is no ordinary way to get it in this version.',
  );
  for (const chroma of MECH_CHROMAS)
    unavailable(
      chroma.id + '_armor_plate',
      'No loot, shop or recipe gives this armor-plate item right now. Instead, you can pick the look from ' +
        item('alien_armor_plate') +
        ' if the rank you roll is high enough. Picking a look unlocks it for your whole account. It does not give you this separate plate item.',
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
      'We know of no way to get this item in this version of the game. No quest reward, creature drop, shop or crafting recipe gives it right now.',
    );
  unavailable(
    'ancient_crypt_door',
    'This door is an object in the world, not a reward you can collect. We have not confirmed where it is or how to use it in this version of the game.',
  );
  for (const id of [
    ...RETIRED_ZONE1_ITEM_IDS,
    ...Object.keys(RETIRED_HEROIC_ITEMS),
    'chunk_of_ore',
  ])
    unavailable(
      id,
      'This is an old item that is no longer in the game. You cannot earn new copies. Copies people already have still work. Do not try to farm the place it used to come from.',
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
      'Legacy souvenir: an old keepsake that players who already have it can keep. The mount skin is a separate unlock on your account. These reins do not unlock that skin.',
    );
}
