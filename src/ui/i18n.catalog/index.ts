// i18n source catalog barrel. Assembles the authoritative English `en` object from
// the per-domain modules and exports the catalog public surface + the key-shape types
// (Leaves, EnTranslations, TranslationKey, ...). This file was src/ui/i18n.en.ts before
// the i18n.catalog domain split; importers resolve './i18n.catalog' to this index.

import { ITEM_SETS } from '../../sim/data';
import { worldEntityText as worldNames } from '../world_entity_i18n';
import { abilityStrings, classAbilityNames } from './abilities';
import { gameStrings } from './game';
import { guideStrings } from './guide';
import { hudStrings } from './hud';
import { hudChromeStrings } from './hud_chrome';
import { itemNames, itemStrings } from './items';
import { mergeEntities, mergeExtra, mergeStrings } from './merge';
import { questStrings } from './quests';
import { shellStrings } from './shell';

export { abilityStrings, classAbilityNames } from './abilities';
export {
  gameStrings,
  gameStringsDeDE,
  gameStringsEnCA,
  gameStringsEs,
  gameStringsEsES,
  gameStringsFrCA,
  gameStringsFrFR,
  gameStringsItIT,
  gameStringsJaJP,
  gameStringsKoKR,
  gameStringsPtBR,
  gameStringsRuRU,
  gameStringsZhCN,
  gameStringsZhTW,
} from './game';
export { guideStrings } from './guide';
export { hudStrings } from './hud';
export { hudChromeStrings } from './hud_chrome';
export { itemNames, itemStrings } from './items';
export { mergeEntities, mergeExtra, mergeStrings } from './merge';
export { questStrings } from './quests';
// Re-export the catalog public surface (every name the old i18n.en.ts exported).
export { shellStrings } from './shell';

type ItemSetEntityText = Record<string, { name: string; bonus2: string; bonus3: string }>;

const itemSetEntityText: ItemSetEntityText = Object.fromEntries(
  Object.values(ITEM_SETS)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((set) => [
      set.id,
      {
        name: set.name,
        bonus2: set.bonuses.find((bonus) => bonus.pieces === 2)?.text ?? set.id,
        bonus3: set.bonuses.find((bonus) => bonus.pieces === 3)?.text ?? set.id,
      },
    ]),
);

type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}${'' extends P ? '' : '.'}${P}`
    : never
  : never;

export type Leaves<T, D extends number = 5> = [D] extends [never]
  ? never
  : T extends object
    ? { [K in keyof T]-?: Join<K, Leaves<T[K], Prev[D]>> }[keyof T]
    : '';

export const en = {
  meta: { builtOn: 'Built {date}' },
  realmTypes: { normal: 'Normal', pvp: 'PvP', rp: 'RP', rpPvp: 'RP-PvP' },
  game: gameStrings,
  hudChrome: hudChromeStrings,
  guide: guideStrings,
  // Cosmetic skin-select event overlay. Rarity names reuse itemUi.quality.*.
  skinEvent: {
    title: 'Cosmetic Cache',
    subtitle: 'You unlocked a {rank} reward — choose any skin at or below it.',
    optionAria: '{rank} skin {index}',
    locked: 'Locked',
    lockedHint: 'Requires a {rank} roll',
    unavailable: 'Coming soon',
    rolled: 'You rolled {rank}',
    previewHint: 'Drag to rotate',
    lockIn: 'Lock In',
    close: 'Close',
    unlocked: 'Cosmetic unlocked!',
    unequip: 'Unequip',
    previewOnly: 'Preview only — full unlock coming soon',
    // Combat Mech chroma names (skin-select preview).
    mech: {
      amber_crimson: 'Amber Crimson',
      crimson_amber: 'Crimson Amber',
      cyan_magenta: 'Cyan Magenta',
      magenta_cyan: 'Magenta Cyan',
      orange_steel: 'Orange Steel',
      steel_orange: 'Steel Orange',
      forest_pink: 'Forest Pink',
      pink_forest: 'Pink Forest',
      amethyst_silver: 'Amethyst Silver',
      ivory_copper: 'Ivory Copper',
      onyx_gold: 'Onyx Gold',
      imperial_crimson: 'Imperial Crimson',
      imperial_gold: 'Imperial Gold',
      vanguard_azure: 'Vanguard Azure',
      vanguard_chrome: 'Vanguard Chrome',
    },
  },
  nav: {
    home: 'Home',
    play: 'Play',
    stats: 'Statistics',
    about: 'About',
    highscores: 'High Scores',
    wiki: 'Wiki',
    news: 'News',
    download: 'Download',
    loginRegister: 'Login/Register',
    account: 'Account',
    logout: 'Logout',
    donate: 'Donate',
  },
  stats: {
    title: 'Realm Status',
    accountsCreated: 'Players',
    playersOnline: 'Players Online',
    realmName: 'Realm Name',
  },
  footer: {
    copyright: '2026 World of ClaudeCraft',
    githubLink: 'https://github.com/levy-street/world-of-claudecraft',
    githubLabel: 'Open Source Project',
    whitepaper: 'Whitepaper',
    terms: 'Terms of Service',
    privacy: 'Privacy Policy',
    discordLabel: 'Join the Discord',
  },
  settings: {
    languageLoading: 'Loading language...',
    languageLoadFailed: 'Could not load that language. Keeping your current language.',
    languageLoadUnavailable: 'That language is not available.',
  },
  highscores: {
    title: 'High Scores Leaderboard',
    desc: "Track the realm's greatest champions and compare your progress.",
  },
  wiki: {
    title: 'Game Wiki & Guide',
    desc: 'Discover the secrets of the realm, class guides, and strategies.',
    cta: 'Browse the Wiki',
  },
  news: {
    title: 'News & Updates',
    desc: 'Read the latest patch notes, events, and community updates.',
    loading: 'Loading the latest updates…',
    error: "Couldn't load updates. Please try again later.",
    empty: 'No updates yet — check back soon.',
    prerelease: 'Pre-release',
    viewOnGithub: 'View on GitHub',
  },
  download: {
    title: 'Download Desktop Launcher',
    desc: 'Get the standalone launcher for optimized performance and full-screen play.',
  },
  comingSoon: {
    placeholder: 'Coming Soon...',
    featureComingSoon: 'This feature is coming soon to the realm.',
  },
  mode: {
    onlineTitle: 'Play Online',
    onlineDesc:
      "Log in to the realm. Your characters live on the server and you share the world with everyone else who's on.",
    onlineAria: 'Play Online: log in to the persistent shared realm',
    offlineTitle: 'Play Offline',
    offlineDesc:
      'Instant single-player world in your browser. Nothing is saved: perfect for a quick brawl or testing.',
    offlineAria: 'Play Offline: start an instant local single-player session',
    tipTitle: 'TIP:',
    tipText:
      'For the smoothest experience, turn off ad blocker extensions on this site. Community reports found some blockers can cause lag.',
    serverOnline: 'Online',
    serverOffline: 'Offline',
    play: 'Play',
    playAria: 'Play World of ClaudeCraft',
    serverLabel: 'Choose your realm',
    serverAria: 'Select realm: Online or Offline',
    serverOfflineSub: 'Instant local world',
    caLabel: '$WOC Contract Address',
    caCopyAria: 'Copy contract address',
    caNote:
      'WOC is our community token. It is not needed to play. Join Discord to discuss the WOC utility and flywheel.',
  },
  auth: {
    enterRealm: 'Enter the Realm',
    username: 'Username',
    usernameError: 'Please enter your username.',
    usernamePlaceholder: 'Enter username',
    password: 'Password',
    passwordError: 'Please enter your password.',
    passwordPlaceholder: 'Enter password',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    logIn: 'Log In',
    createAccount: 'Create Account',
    back: 'Back',
    realmList: 'Realm List',
    loadingRealms: 'Loading realms...',
    changeRealm: 'Change Realm',
    realm: 'Realm',
    newCharacter: 'New Character',
    appearance: 'Appearance',
    class: 'Class',
    name: 'Name',
    chromaOption: 'Chroma {n}',
    noAccountPrompt: 'New to the realm?',
    haveAccountPrompt: 'Already have an account?',
    characters: 'Characters:',
    createCharacter: 'Create Character',
    characterName: 'Character Name',
    characterNamePlaceholder: 'Character name',
    enterWorld: 'Enter World',
    offlineCharacter: 'Offline Character',
    create: 'Create',
    twoFactorLabel: 'Authentication code',
    twoFactorPlaceholder: '6-digit or recovery code',
    twoFactorHint: 'Enter the code from your authenticator app, or one of your recovery codes.',
  },
  wallet: {
    label: '$WOC Wallet',
    connect: 'Verify Wallet',
    connectTitle: 'Verify your Solana wallet',
    connectAria: 'Verify your Solana wallet',
    verify: 'Verify Wallet',
    verifyNew: 'Verify New Wallet',
    verifyTitle: 'Choose a wallet and sign once to verify ownership.',
    verifyAria: 'Choose a wallet and sign once to verify ownership',
    verifyAddressAria: 'Sign to verify wallet {address} for your account',
    appConnected: 'App Connected',
    connectApp: 'Connect App',
    connectAppTitle: 'Connect the wallet app on this browser',
    connectAppAria: 'Connect the wallet app on this browser',
    verifying: 'Verifying...',
    verifyingTitle: 'Wallet verification is in progress.',
    switch: 'Switch',
    switchTitle: 'Verify a different wallet',
    switchAria: 'Verify a different wallet',
    unlink: 'Unlink',
    unlinkTitle: 'Remove wallet verification from this account',
    unlinkAria: 'Remove wallet verification from this account',
    signOut: 'Disconnect',
    signOutTitle: 'Disconnect the wallet app on this browser',
    signOutAria: 'Disconnect the wallet app on this browser',
    hide: 'Hide',
    hideTitle: 'Hide wallet row on this screen',
    hideAria: 'Hide wallet row on this screen',
    hiddenNotice: 'Wallet row hidden. Re-enable it in-game from Options > Interface.',
    linkedTitle: 'Wallet verified for your account. Click to manage the wallet app.',
    linkedDisconnectedTitle:
      'Wallet remains verified for your account. Reconnect to manage the wallet app.',
    linkedDisconnectedAria:
      'Wallet remains verified for your account. Reconnect to manage the wallet app.',
    linkTitle: 'Click to sign and link this wallet to your account.',
    connectedTitle: 'Connected. Log in to link this wallet to your account.',
    balanceTitle: 'Verified Solana wallet $WOC balance',
    balanceAria: 'Verified Solana wallet balance: {balance}',
    balancePreviewTitle: 'Connected wallet $WOC balance preview',
    balancePreviewAria:
      'Connected wallet balance preview: {balance}. Link the wallet to verify holder flair.',
    balanceAmount: '{amount} $WOC',
    connected: 'Connected: {address}',
    connectedWithBalance: 'Connected: {balance} - {address}',
    connectedLinked: 'Verified: {address}',
    connectedLinkedWithBalance: 'Verified: {balance} - {address}',
    helpDisconnected:
      'Verify a Solana wallet to enable holder flair and player-card badges. No transaction or SOL required.',
    helpLoginToLink: 'Connected {address}. Log in to link it to your account.',
    helpLoginToLinkWithBalance:
      'Connected {address} with {balance}. Log in to link it to your account.',
    helpReadyToLink:
      'Wallet selected: {address}. Sign once to verify holder flair and player cards.',
    helpReadyToLinkWithBalance:
      'Wallet selected: {address} with {balance}. Sign once to verify holder flair and player cards.',
    helpLinked: 'Holder perks are active. Wallet app connected on this browser.',
    helpLinkedWithBalance: 'Holder perks are active. Wallet app connected on this browser.',
    helpLinkedDisconnected:
      'Holder perks are active. Connect the app when you need to sign or spend.',
    helpLinkedDisconnectedWithBalance:
      'Holder perks are active. Connect the app when you need to sign or spend.',
    flowConnect: 'Choose a wallet. Verification continues automatically.',
    flowSign: 'Sign the verification message in your wallet app. No transaction or SOL required.',
    flowVerify: 'Verifying wallet ownership...',
    linkFailed: 'Wallet verification failed.',
    verifyFailed: 'Wallet verification failed.',
    unlinkFailed: 'Could not unlink wallet.',
    holder: '$WOC holder',
    holderTierTitle: '{tier} $WOC holder',
    holderTiers: {
      ember: { name: 'Ember', flavor: 'The spark is lit.' },
      coinbearer: { name: 'Coinbearer', flavor: 'First coin in the war chest.' },
      coppercrest: { name: 'Coppercrest', flavor: 'Coppers stacked, your name spoken.' },
      silverbound: { name: 'Silverbound', flavor: 'Bound in silver, building the bag.' },
      gilded: { name: 'Gilded', flavor: 'Gilded and grinning.' },
      vaultwarden: { name: 'Vaultwarden', flavor: 'Guarding a real vault now: 0.01% of all $WOC.' },
      whale: { name: 'Whale', flavor: 'The deep parts when you swim: 0.1% of supply.' },
      leviathan: { name: 'Leviathan', flavor: 'Markets feel you move: 1% of supply.' },
      tidelord: { name: 'Tidelord', flavor: 'The tide answers your call: 2% of supply.' },
      stormcaller: { name: 'Stormcaller', flavor: 'Storms gather at your name: 3% of supply.' },
      krakencrown: { name: 'Krakencrown', flavor: 'Crowned by the deep: 4% of supply.' },
      titanforged: { name: 'Titanforged', flavor: 'Forged among titans: 5% of supply.' },
      starhoard: { name: 'Starhoard', flavor: 'A hoard that bends starlight: 6% of supply.' },
      voidwarden: { name: 'Voidwarden', flavor: "Keeper at the void's edge: 7% of supply." },
      realmshaper: { name: 'Realmshaper', flavor: 'You reshape the realm: 8% of supply.' },
      worldforger: { name: 'Worldforger', flavor: 'Forging a world of your own: 9% of supply.' },
      worldbearer: {
        name: 'Worldbearer',
        flavor: 'You carry a piece of the world: 10% of supply.',
      },
      sovereign: { name: 'Sovereign', flavor: 'The realm bends the knee: the entire supply.' },
    },
  },
  playerCard: {
    shareButton: 'Share Player Card',
    title: 'Player Card',
    close: 'Close player card',
    loading: 'Forging your card...',
    poseGroup: 'Pose',
    poseHero: 'Hero',
    poseBattle: 'Battle',
    poseVictory: 'Victory',
    referralLinkLabel: 'Your referral link. Anyone who joins through it is credited to you:',
    referralLinkAria: 'Your referral link',
    renderFailed: 'Could not render your card. Try a different pose.',
    renderFailedStatus: 'Card render failed.',
    levelClass: 'Level {level} - {className}',
    topPercent: 'TOP {percent}%',
    realmSubtitle: '{realm} Realm',
    defaultRealm: 'World of ClaudeCraft',
    brandWordmark: 'WORLD OF CLAUDECRAFT',
    recruited: '{count} recruited',
    footerHandle: '@{handle}',
    footerHandleWithRecruits: '@{handle} - {recruited}',
    footerCta: 'Forge your legend: {siteUrl}',
    arenaStat: 'Arena',
    shareTierBit: ', {tier}-rank $WOC holder',
    shareText:
      "I'm forging my legend in World of ClaudeCraft: Level {level} {className}{tierBit}. Join my realm:",
    nativeShareTitle: 'World of ClaudeCraft',
    fileNameFallback: 'player',
    actionShareX: 'Share to X',
    actionCopyReferral: 'Copy Referral Link',
    actionDownload: 'Download',
    actionShareNative: 'Share...',
    statusGenericError: 'Something went wrong.',
    statusStillRendering: 'Card is still rendering.',
    statusPublishing: 'Publishing card...',
    statusPublished: 'Card published. Share your referral link below.',
    statusOpenedXWithImage: 'Opened X. Paste the card image into the post.',
    statusOpenedXWithLink:
      'Opened X with your link. The card image appears after posting from a public domain.',
    statusReferralCopied: 'Referral link copied. Share it anywhere.',
    statusDownloaded: 'Card downloaded.',
    statusShareUnsupported: 'Sharing is not supported on this device.',
  },
  classes: {
    warrior: 'Warrior',
    paladin: 'Paladin',
    hunter: 'Hunter',
    rogue: 'Rogue',
    priest: 'Priest',
    shaman: 'Shaman',
    mage: 'Mage',
    warlock: 'Warlock',
    druid: 'Druid',
    warriorAria: 'Warrior class',
    paladinAria: 'Paladin class',
    hunterAria: 'Hunter class',
    rogueAria: 'Rogue class',
    priestAria: 'Priest class',
    shamanAria: 'Shaman class',
    mageAria: 'Mage class',
    warlockAria: 'Warlock class',
    druidAria: 'Druid class',
  },
  controls: {
    title: 'Controls Guide',
    movement: 'Movement',
    moveTurn: 'Move / Turn',
    strafe: 'Strafe Left/Right',
    jump: 'Jump',
    autorun: 'Toggle Autorun',
    combat: 'Combat & Interaction',
    target: 'Target Enemy',
    spells: 'Cast Spells',
    interact: 'Interact / Loot',
    nameplates: 'Toggle Nameplates',
    camera: 'Camera & Mouse',
    rightDrag: 'Right-Drag',
    leftDrag: 'Left-Drag',
    mouseWheel: 'Mouse Wheel',
    mouselook: 'Mouselook',
    orbit: 'Orbit Camera',
    zoom: 'Zoom',
    interfaces: 'Interfaces',
    charPane: 'Character Pane',
    spellbook: 'Spellbook',
    questLog: 'Quest Log',
    worldMap: 'World Map',
    bags: 'Bags Inventory',
    emoteWheel: 'Hold Emote Wheel',
    friends: 'Friends & Guild',
    chat: 'Open Chat',
  },
  // Delve / lockpicking sim-emitted player text. The deterministic core emits these
  // in English; sim_i18n.ts re-localizes them through t() against these keys.
  // Locale overlays are English-filled + marked pending by the i18n build until a
  // translation pass. ENGLISH ONLY here; never add per-locale blocks to this section.
  sim: {
    delve: {
      cannotEnterNow: 'You cannot enter a delve right now.',
      leaveDungeonFirst: 'Leave the dungeon first.',
      leaveArenaFirst: 'Leave the arena first.',
      alreadyInDelve: 'You are already in a delve.',
      whileTrading: 'You cannot enter a delve while trading.',
      duringDuel: 'You cannot enter a delve during a duel.',
      duringArena: 'You cannot enter a delve during an arena match.',
      unknownTier: 'Unknown delve tier.',
      levelRequired: 'You must be level {level} to enter {name}.',
      levelRequiredTier: 'You must be level {level} to enter {name} on {tier}.',
      instancesBusy: 'All instances of {name} are busy. Try again soon.',
      runFailed: '{name} run failed.',
      complete: '{name} complete.',
      mechanismOpen:
        'A mechanism clicks open nearby. A passage opens to the north. Find the exit portal ahead.',
      raiseDead: '{name} begins Raise Dead.',
      graveFalters: 'The grave rite falters.',
      doorAlreadyOpen: 'The door is already open.',
      companionRankUp: '{name} reaches rank {rank}.',
      bossChest:
        'The boss falls. A warded reliquary chest rises on the dais. Pick its lock to claim your spoils.',
      surfaceStairs: 'A stairway to the surface opens. Press F at the stairs to leave.',
      moduleEnter: '{name}: {objective}',
      objectiveClearRoom: 'Clear the room.',
      objectiveDefeatBoss: 'Defeat the boss.',
      tombstoneHint: 'A tombstone passage opens to the north when the room is cleared.',
      tombstoneOpen:
        'A sealed tombstone passage grinds open to the north. Walk into it to continue.',
      tombstoneInto: 'You pass through the tombstone into {name}.',
      chestEmpty: 'The chest is empty.',
      notInDelve: 'You are not in a delve.',
      cannotInteract: 'You cannot interact with that.',
      tooFar: 'You are too far away.',
      graveSilent: 'The grave is silent for now.',
      doorLocked: 'The door is locked.',
      strikeWall: 'Strike the wall to break through.',
      nothingHappens: 'Nothing happens.',
      unknownCompanion: 'Unknown companion.',
      companionMaxRank: 'This companion is already fully upgraded.',
      companionMarksRequired: 'You need {marks} Delve Marks to upgrade {name}.',
      cannotAffordCompanionUpgrade: 'You cannot afford this upgrade.',
      shopItemLocked: 'You have not unlocked that item yet.',
      shopMarksRequired: 'You need {marks} Delve Marks to buy {name}.',
      shopSealPremiumOnly:
        "This seal yields only to a master's hand. Only the Premium ante can open it.",
      passageSealed: 'The passage is sealed.',
      moveCloserPassage: 'Move closer to the passage.',
      moveCloserChest: 'Move closer to the chest.',
      nothingToTake: 'There is nothing left to take.',
      wayOutNotOpen: 'The way out is not yet open.',
      moveCloserStairs: 'Move closer to the stairs.',
    },
    lockpick: {
      lockYields: 'The lock yields! {tier} spoils.',
      tierPremium: 'Premium',
      tierMedium: 'Medium',
      tierLow: 'Modest',
      alreadyInProgress: 'Someone is already working the lock.',
      cannotPickThat: 'You cannot pick that.',
      chooseAnte: 'Choose 1, 2, or 3 picks.',
      noAttempt: 'No lock attempt in progress.',
      notYours: 'That is not your lock.',
      toolSlips: 'That tool slips off this lock.',
      lockJammed: 'The lock is jammed beyond picking. Clear the delve again for another attempt.',
      lastPickSnaps:
        'The last pick snaps. The lock jams. The chest is lost unless you clear the delve again.',
    },
  },
  // Lockpicking minigame ("Tumbler's Path") panel chrome. Rendered through t()
  // from hud.ts; the pure lockpick_panel.ts view returns stable discriminators
  // (tier / action / step result) that hud maps to these keys.
  lockpickUi: {
    pickTitle: 'Pick the Lock',
    cofferTitle: 'Bountiful Coffer',
    cache: '{tier} Cache',
    pickBlurb:
      'A richer cache is sealed behind more locks. Easier locks give you more tries and more time; a failed try resets the lock until your tries run out.',
    cofferBlurb:
      "This seal yields only to a master's hand: the Hard, Premium path alone can open it. Solve all three locks for the signature prize.",
    pagesAria: '{count} locks',
    tries: '{count} tries',
    triesOne: '1 try',
    perMove: '{seconds}s / move',
    seconds: '{seconds}s',
    boardTitle: "Tumbler's Path: {tier} cache",
    closeAria: 'Close',
    withdrawAria: 'Withdraw',
    timerAria: 'Time remaining',
    lockOf: 'Lock {page}/{total}',
    lockOfAria: 'Lock {page} of {total}',
    triesOf: 'Tries {tries}/{total}',
    triesOfAria: '{tries} of {total} tries left',
    ward: 'Ward {col} / {total}',
    depthKeys: 'Hotkeys set pick depth (Q/W/E/A/Z), not the ward number.',
    withdraw: 'Withdraw (Esc)',
    action: {
      hardSet: 'Hard Set',
      set: 'Set',
      steady: 'Steady',
      ease: 'Ease',
      drop: 'Drop',
    },
    feedback: {
      advanced: 'The pin gives...',
      slip: 'A ward bites, the pick slips!',
      bind: 'The tumbler binds: wrong depth!',
      trap: 'A false ward snaps shut, the lock jams!',
      retry: 'The lock resets. Line up a fresh attempt.',
      pageCleared: 'A tumbler bank falls. The next lock turns up.',
      success: 'The bolt throws, the cache is yours!',
      fail: "The lock seizes. It won't budge again.",
    },
    summary: {
      success: 'Lock sprung, {tier} cache claimed.',
      successGeneric: 'Lock sprung, the cache is claimed.',
      fail: 'The lock is ruined. Clear the delve again for another attempt.',
      abandoned: 'You ease the picks back out. The lock waits.',
    },
  },
  // Delve UI chrome + companion/boss/lore flavor (board, run tracker, completion
  // summary, affixes, module/objective labels). Rendered through t() from hud.ts.
  // {playerName} / {className} interpolate at render time.
  delveUi: {
    board: {
      title: 'Delve Board',
      enter: 'Enter Delve',
      enterAria: 'Enter {delve} on {tier} difficulty',
      openDelve: 'Collapsed Reliquary',
      openDelveAria: 'Open Delve Board from {name}',
      marks: 'Delve Marks: {count}',
      minLevel: 'Requires Level {level}',
      tier: {
        normal: 'Normal',
        heroic: 'Heroic',
      },
      companion: {
        pick: 'Choose a companion',
        tessa: 'Acolyte Tessa',
        rank: 'Rank {rank}',
        boon: 'Heals the party between fights. Rank 3 revives a fallen ally once per run.',
        upgrade: 'Upgrade to Rank {rank} ({marks} Marks)',
        upgradeAria: 'Upgrade {name} to rank {rank} for {marks} Delve Marks',
        maxRank: 'Fully upgraded',
      },
      tabDelve: 'Delve',
      tabShop: 'Shop',
    },
    shop: {
      price: '{marks} Marks',
      buy: 'Buy',
      buyAria: 'Buy {item} for {marks} Delve Marks',
      reqHeroic: 'Requires a Heroic clear',
      reqClears: 'Requires {count} clears',
      empty: 'Nothing in stock.',
    },
    tracker: {
      title: 'Delve',
      objective: 'Objective',
      module: 'Module {current} of {total}',
      affix: 'Affixes',
      complete: 'Complete',
      marks: 'Delve Marks: {count}',
      exitHintOpen: 'Walk into the tombstone passage (north)',
      exitHintLocked: 'Clear trash mobs to open the passage north',
    },
    objective: {
      kill_boss: 'Slay {boss}',
      recover_artifact: 'Recover the burial ledger',
      clear_room: 'Clear the room',
    },
    summary: {
      title: 'Delve Complete',
      marks: '{count} Delve Marks earned',
      loreUnlock: 'Lore unlocked: {title}',
    },
    death: {
      warning: 'One more death will end this delve run.',
    },
    run: {
      failed: 'The delve run has failed. You are returned to Brother Halven.',
    },
    npc: {
      halven: {
        greeting:
          'The reliquary below has shifted again. We hear chanting through the floor after midnight, and Acolyte Tessa swears the burial ledgers are changing their own ink. If you have courage enough, {playerName}, take a candle and go below. Do not trust every voice you hear down there. Some of them knew your name before you were born.',
      },
    },
    intro: {
      normal:
        'The stairwell is cold and dark. Broken saint-stones litter the descent, and a soft bell note hangs in the damp air. Acolyte Tessa whispers, "The reliquary should not be open this far. Stay close, {playerName}."',
      heroic:
        'The doors groan shut behind you. Names scrape across the stone like fingernails. Tessa\'s candle burns blue. "They are not calling the dead now, {playerName}. They are answering something."',
    },
    module: {
      reliquary_sunken_ossuary:
        'Water seeps through burial shelves, carrying old ash in silver-black streams.',
      reliquary_bell_niche: 'Dozens of handbells hang in silence, each tied with funeral cloth.',
      reliquary_saintless_hall: 'Statues with faces chiseled away with careful hatred.',
      reliquary_finale: 'The buried bell tolls once beneath your boots.',
    },
    moduleName: {
      reliquary_sunken_ossuary: 'The Sunken Ossuary',
      reliquary_bell_niche: 'The Bell Niche',
      reliquary_saintless_hall: 'The Saintless Hall',
      reliquary_finale: 'The Bell-Buried Chamber',
    },
    companion: {
      barkLine: '{name}: {line}',
      tessa: {
        combat_start: 'Keep your footing, {playerName}. The dead are restless here.',
        low_hp: 'Breathe. I still have prayers left for you.',
        trap_spotted: 'Hold. Something in the floor remembers footsteps.',
        boss_pull: 'That bell knows your weight, {playerName}. Do not kneel.',
        completion: 'The ledger can rest another night. Well done.',
        rank: {
          1: 'Chapel Novice',
          2: 'Candle-Bearer',
          3: 'Reliquary Acolyte',
          4: 'Gravecall Witness',
          5: 'Chapel Warden',
        },
      },
    },
    boss: {
      varric: {
        bell: {
          emote: 'Deacon Varric grips the buried bell with both hands!',
          log: 'Deacon Varric begins to toll the burial bell.',
          warning: 'Move away from Deacon Varric!',
          impact: "The bell's toll cracks the chamber floor!",
          lesson: 'Bell Toll: a ground slam every twelve seconds. Move out before it lands.',
        },
        raise: {
          emote: 'Deacon Varric calls names from the broken graves!',
          log: 'Deacon Varric begins Raise Dead.',
          warning: 'Stop the grave rite!',
          object: 'The cracked grave shudders with stolen breath.',
          interrupt_ok: 'The grave rite falters.',
          interrupt_fail: "The dead answer Deacon Varric's call!",
          lesson: 'Interrupt the cracked grave within five seconds or the dead rise to his call.',
        },
        pull: 'You step on hallowed dust with unclean purpose. Kneel, and be counted.',
        intro: 'No soul is lost. Only misplaced.',
        mid60: 'Deacon Varric reads names from the ledger with shaking triumph.',
        mid30: 'The burial bell answers every name he speaks.',
        defeat: 'No... I had the names... I had them all...',
      },
    },
    lore: {
      eastbrook_ledger:
        "A water-stained page from Eastbrook's burial ledger. Names crossed out and rewritten in a hand that is not human.",
      first_collapse:
        'Chapel records note the first sinkage: saint-stones cracked, shelves tilted, and a bell-note heard from below ground.',
      gravecaller_mark:
        "A sigil scraped into coffin wood, not Morthen's seal, but an older gravecaller mark predating the Hollow Crypt.",
      bell_below:
        'Tessa\'s margin note: "There is a second bell under the reliquary. It tolls for the misplaced, not the dead."',
      tessa_note:
        'Folded scrap in Tessa\'s script: "If the ledgers change while we are below, trust the candle, not the voices."',
    },
    affix: {
      restless_graves: 'Restless Graves',
      bad_air: 'Bad Air',
      candleblind: 'Candleblind',
      old_mechanisms: 'Old Mechanisms',
      flooded_paths: 'Flooded Paths',
      grave_tax: 'Grave Tax',
      unstable_roof: 'Unstable Roof',
      cult_remnants: 'Cult Remnants',
    },
    blessing: {
      chapel_candle: 'Chapel Candle: safer run, one fewer Mark on completion.',
    },
    chest: {
      flavor: 'The dead have surrendered what they can spare.',
    },
  },
  fiesta: {
    bracket: 'Fiesta',
    enterQueue: 'Join the Fiesta!',
    practice: '🎉 Practice vs Bots',
    practiceNote:
      'Offline practice: spawns 3 AI bots and queues you for a 2v2 Fiesta. Click again to stop.',
    banner: {
      wave: 'WAVE {wave}/{total} — CHOOSE AN AUGMENT!',
      augmentGained: 'Augment gained: {name}!',
      powerup: '{name}!',
    },
    log: {
      augmentGained: 'You gain the {name} augment!',
      allyAugment: '{player} chose the {name} augment.',
      welcome: 'Welcome to the 2v2 FIESTA! Score takedowns, grab augments, survive the ring!',
      go: 'FIESTA — GO!',
      over: 'FIESTA OVER! What a party. Returning to the world…',
      powerup: '{player} grabbed {name}!',
    },
    category: {
      offense: 'Offense',
      defense: 'Defense',
      sustain: 'Sustain',
      mobility: 'Mobility',
      utility: 'Utility',
    },
    pending: {
      label: 'Augment ready — pick it on your next death!',
    },
    powerup: {
      pow_speed_demon: { name: 'Speed Demon' },
      pow_colossus: { name: 'Colossus' },
      pow_moon_boots: { name: 'Moon Boots' },
      pow_berserker: { name: 'Berserker' },
    },
    queue: {
      join: 'You join the 2v2 Fiesta queue. Get ready to PARTY…',
      leave: 'You leave the 2v2 Fiesta queue.',
      teamLeave: 'Your team leaves the 2v2 Fiesta queue.',
    },
    error: {
      leaderOnly: 'Only the party leader may queue your team for {label}.',
      premadeTwo: 'A {label} premade requires a party of exactly two.',
      noAugment: 'You have no augment to choose right now.',
      notOnOffer: 'That augment is not on offer.',
    },
    score: {
      title: 'FIESTA',
      toWin: 'First to {n}',
      aria: 'Fiesta score: your team {mine}, enemy team {theirs}, first to {limit} wins.',
    },
    respawn: {
      title: 'DOWNED!',
      sub: 'Back in the fight in…',
    },
    end: {
      win: 'FIESTA WON! 🎉 What a party!',
      loss: 'FIESTA LOST! Run it back!',
      draw: 'FIESTA DRAW! Too close to call!',
    },
    augment: {
      choose: 'Choose an Augment',
      aug_brutality: { name: 'Brutality', desc: 'Your physical strikes hit 15% harder.' },
      aug_spellfire: { name: 'Spellfire', desc: 'Your spells deal 15% more damage.' },
      aug_toughness: { name: 'Toughness', desc: 'Gain 12% maximum health.' },
      aug_keen_eye: { name: 'Keen Eye', desc: 'Gain 8% critical strike chance.' },
      aug_fleetfoot: { name: 'Fleetfoot', desc: 'Move 15% faster. Run them down — or run away.' },
      aug_ironhide: { name: 'Ironhide', desc: 'Gain 250 armor and 5% dodge.' },
      aug_mending: { name: 'Mending', desc: 'Your healing is 20% more potent.' },
      aug_warlords_might: {
        name: "Warlord's Might",
        desc: '+25% physical damage and +10% crit. Become the threat.',
      },
      aug_arcane_surge: {
        name: 'Arcane Surge',
        desc: '+25% spell damage and +10% crit. Light them up.',
      },
      aug_vampirism: {
        name: 'Vampirism',
        desc: 'Heal for 15% of all damage you deal. Sustain through chaos.',
      },
      aug_juggernaut: {
        name: 'Juggernaut',
        desc: '+20% maximum health and +400 armor. Immovable.',
      },
      aug_bloodhunter: {
        name: 'Bloodhunter',
        desc: '+18% damage of all kinds and +12% move speed.',
      },
      aug_lightwell: {
        name: 'Lightwell',
        desc: '+30% healing and +15% maximum health. Anchor your team.',
      },
      aug_bounty_hunter: {
        name: 'Bounty Hunter',
        desc: 'Your kills are worth +1 bonus team point. Close the gap fast.',
      },
      aug_apex_predator: {
        name: 'Apex Predator',
        desc: '+40% physical damage, +15% crit, heal for 12% of damage dealt.',
      },
      aug_archmage: {
        name: 'Archmage',
        desc: '+45% spell damage, +15% crit, +15% maximum health.',
      },
      aug_unkillable: {
        name: 'Unkillable',
        desc: '+40% maximum health, +600 armor, heal for 10% of damage dealt.',
      },
      aug_overdrive: {
        name: 'Overdrive',
        desc: '+30% all damage, +20% crit, +20% move speed. FIESTA!',
      },
      aug_avatar: {
        name: 'Avatar of War',
        desc: '+25% all damage, +25% maximum health, +300 armor. Walk it down.',
      },
      aug_ascendant: {
        name: 'Ascendant',
        desc: '+45% healing, +25% spell damage, +20% maximum health.',
      },
    },
    tier: {
      silver: 'Silver',
      gold: 'Gold',
      prismatic: 'Prismatic',
    },
    word: {
      kill: 'TAKEDOWN!',
      firstblood: 'FIRST BLOOD!',
      doublekill: 'DOUBLE KILL!',
      shutdown: 'SHUTDOWN!',
      spree: '{n}× SPREE!',
      revived: 'BACK IN!',
      ringclose: 'RING CLOSING!',
      wave: 'AUGMENTS!',
      dodge: 'DODGE!',
    },
  },
  ...shellStrings.en,
  ...hudStrings.en,
  ...abilityStrings.en,
  ...questStrings.en,
  ...itemStrings.en,
  ...classAbilityNames.en,
  ...itemNames.en,
  ...worldNames.en,
  ...mergeStrings.en,
  entities: {
    ...itemNames.en.entities,
    ...worldNames.en.entities,
    abilities: { ...itemNames.en.entities.abilities, ...mergeExtra.en.abilities },
    items: {
      ...itemNames.en.entities.items,
      ...mergeEntities.en.items,
      ...mergeExtra.en.items,
      // Delve items, Collapsed Reliquary loot and Marks vendor stock.
      reliquary_plate_chest: { name: 'Reliquary Guard Hauberk' },
      reliquary_leather_chest: { name: 'Dustwarden Jerkin' },
      reliquary_cloth_chest: { name: 'Shroud of the Reliquary' },
      reliquary_legs: { name: 'Vaultbound Legwraps' },
      reliquary_helm: { name: 'Ossuary Watch Helm' },
      reliquary_shoulder: { name: 'Crumbled Spaulders' },
      reliquary_gloves_rog: { name: 'Bonewarden Grips' },
      deacon_reliquary_helm: { name: "Deacon's Reliquary Helm" },
      varric_shadow_cowl: { name: "Varric's Shadow Cowl" },
      the_codfather: { name: 'The Codfather' },
      runed_bone_shard: { name: 'Runed Bone Shard' },
      grave_sir_aldren: { name: 'Grave of Captain Aldren' },
      grave_high_priest_malric: { name: 'Grave of High Priest Malric' },
      grave_captain_voss: { name: 'Grave of Royal Assassin Voss' },
      ancient_crypt_door: { name: 'Ancient Crypt Door' },
      captains_crest: { name: 'Crypt Keystone Upper' },
      priests_sigil: { name: 'Crypt Keystone Lower' },
      royal_seal: { name: 'Ancient Diary' },
      crypt_keystone: { name: 'Crypt Keystone' },
      crypt_ritual_circle: { name: 'Ritual Circle' },
      kings_signet: { name: "King's Signet" },
      event_skin_token: { name: 'Mysterious Cosmetic Cache' },
      deathless_heartwood: { name: 'Heartwood of the Deathless Crown' },
      kingsbane_last_oath: { name: 'Kingsbane, Last Oath of Thornpeak' },
      crownforged_dreadhelm: { name: 'Crownforged Dreadhelm' },
      crownforged_warspaulders: { name: 'Crownforged Warspaulders' },
      nighttalon_crown: { name: 'Nighttalon Crown' },
      nighttalon_shoulderguards: { name: 'Nighttalon Shoulderguards' },
      soulflame_cowl: { name: 'Soulflame Cowl' },
      soulflame_mantle: { name: 'Soulflame Mantle' },
      stormcallers_crown: { name: "Stormcaller's Crown" },
      stormcallers_spaulders: { name: "Stormcaller's Spaulders" },
      unknown_alien_weaponry: { name: 'Unknown Alien Weaponry' },
      alien_armor_plate: { name: 'Alien Armor Plate' },
      amber_crimson_armor_plate: { name: 'Amber Crimson' },
      crimson_amber_armor_plate: { name: 'Crimson Amber' },
      cyan_magenta_armor_plate: { name: 'Cyan Magenta' },
      magenta_cyan_armor_plate: { name: 'Magenta Cyan' },
      orange_steel_armor_plate: { name: 'Orange Steel' },
      steel_orange_armor_plate: { name: 'Steel Orange' },
      forest_pink_armor_plate: { name: 'Forest Pink' },
      pink_forest_armor_plate: { name: 'Pink Forest' },
      amethyst_silver_armor_plate: { name: 'Amethyst Silver' },
      ivory_copper_armor_plate: { name: 'Ivory Copper' },
      onyx_gold_armor_plate: { name: 'Onyx Gold' },
      imperial_crimson_armor_plate: { name: 'Imperial Crimson' },
      imperial_gold_armor_plate: { name: 'Imperial Gold' },
      vanguard_azure_armor_plate: { name: 'Vanguard Azure' },
      vanguard_chrome_armor_plate: { name: 'Vanguard Chrome' },
    },
    itemSets: itemSetEntityText,
    mobs: { ...worldNames.en.entities.mobs, ...mergeEntities.en.mobs, ...mergeExtra.en.mobs },
    npcs: { ...worldNames.en.entities.npcs, ...mergeExtra.en.npcs },
    quests: {
      ...worldNames.en.entities.quests,
      ...mergeEntities.en.quests,
      ...mergeExtra.en.quests,
    },
    dungeons: { ...worldNames.en.entities.dungeons, ...mergeExtra.en.dungeons },
    delves: { ...worldNames.en.entities.delves },
  },
};

// The authoritative en shape. The generated dense table
// (the per-locale slices under src/ui/i18n.resolved.generated/) types every locale
// ": EnTranslations" so tsc still red-fails any missing or renamed key.
export type EnTranslations = typeof en;

// Depth 6 so the deepest real leaves (entities.quests.<id>.objectives.<n>.label,
// entities.zones.<id>.pois.<n>.label) are members. The sparse overlays are typed
// `Partial<Record<TranslationKey, string>>`, so TranslationKey must reach
// every overlay key; depth 5 stopped one segment short. (Measured: no tsc cost.)
export type TranslationKey = Leaves<typeof en, 6>;
export type InterpolationValue = string | number;
export type InterpolationValues = Record<string, InterpolationValue>;

// Deep-partial of the authoritative en shape. Non-English locales are dense
// ": typeof en" objects today; they are later relaxed to DeepPartial overlays.
export type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T;
