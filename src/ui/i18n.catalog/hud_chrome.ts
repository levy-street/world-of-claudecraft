// i18n source catalog - in-game HUD chrome strings that were previously hard-coded
// at their call sites (emote wheel/editor, swing timer, rest indicator, mobile
// controls, minimap/compass/clock widgets, DPS/HPS meters formatting). English
// values only; the 13 locale translations live in src/ui/i18n.locales/<lang>.ts
// (the runtime-authoritative overlays), filled by the maintainer at release.
//
// Assembled into `en` by ./index.ts under the `hudChrome` namespace. Kept as its
// own module (no per-locale blocks) so new chrome keys are an English-only add.

export const hudChromeStrings = {
  spectate: {
    banner: 'Spectating {name}',
  },
  // WoW-style death loop overlay (release -> ghost run -> resurrect). The release
  // button and "You have died." title reuse the hud.core.* keys; these are the
  // ghost-state additions shown once the spirit has been released.
  death: {
    resurrectAtCorpse: 'Resurrect at Corpse',
    resurrectAtHealer: "The Pale Keeper (Keeper's Toll)",
    spiritHealerAlive: 'The Pale Keeper watches over the dead. You are still among the living.',
  },
  // Overhead emote display names (wheel tooltips/labels, editor items, overhead
  // bubble text). Source ids/order mirror OVERHEAD_EMOTES in world_api.ts.
  emotes: {
    wave: 'Wave',
    laugh: 'LOL',
    question: 'Bro?',
    cheer: 'Cheer',
    dance: 'Dance',
    point: 'Point',
    flex: 'Flex',
    salute: 'Salute',
    cry: 'Cry',
    bow: 'Bow',
    clap: 'Clap',
    roar: 'Roar',
    kneel: 'Kneel',
  },
  emoteWheel: {
    edit: 'Edit',
    label: 'Emotes',
  },
  emoteEditor: {
    title: 'Emotes',
    done: 'Done',
  },
  dailyRewards: {
    title: 'Daily Rewards',
    close: 'Close daily rewards',
    loading: 'Loading daily rewards...',
    error: 'Could not load daily rewards.',
    intro:
      'Hold enough WOC in your verified wallet to unlock daily rewards. Earn points with one daily spin and rotating tasks, then climb the daily leaderboard for a share of the prize pool.',
    disclaimer:
      'WOC price can move quickly. We recommend holding more than the $20 USD minimum so normal price swings do not lock you out. This is not financial advice.',
    prize: 'Prize Pool',
    reset: 'Reset',
    endsIn: 'Ends in {time}',
    remainingLessThanMinute: '<1m',
    remainingMinutes: '{minutes}m',
    remainingHoursMinutes: '{hours}h {minutes}m',
    score: 'Score',
    walletValue: 'Wallet Value (WOC)',
    usd: '{amount} USD',
    sol: '{amount} SOL',
    unknown: 'Unknown',
    spinTitle: 'Daily Spin',
    spinDialogTitle: 'Daily Reward Spin',
    spinClose: 'Close daily spin',
    spinReady: 'One spin is ready.',
    spinClaimed: 'Claimed: +{points} points.',
    spinResult: '+{points} points',
    spinButton: 'Spin',
    tasks: 'Tasks',
    taskMultiplier: 'x{multiplier} multiplier',
    pointsGained: '{points} daily rewards points gained.',
    showChestButton: 'Show Chest',
    hideChestButton: 'Hide Chest',
    hideChestConfirmTitle: 'Hide Daily Rewards Chest?',
    hideChestConfirmBody:
      'This removes the chest shortcut from your HUD. Rewards, eligibility, and this panel stay available; you can bring the shortcut back from Options.',
    hideChestConfirmOk: 'Hide Chest',
    hideChestConfirmCancel: 'Cancel',
    leaderboard: 'Daily Leaderboard',
    totalPlayer: '{count} player today',
    totalPlayers: '{count} players today',
    history: 'Past Winners',
    noLeaders: 'No points yet.',
    noHistory: 'No payouts yet.',
    walletConnectTitle: 'Verify Wallet',
    walletConnectBody: 'Verify a Solana wallet with WOC to unlock daily rewards.',
    walletConnectButton: 'Verify Wallet',
    walletHoldTitle: 'Hold WOC',
    walletHoldBody: 'Hold at least {amount} USD in WOC to unlock daily rewards.',
    walletPriceBody: 'WOC pricing is unavailable right now. Check back shortly.',
    reason: {
      eligible: 'Rewards unlocked.',
      no_wallet: 'Connect a wallet with at least $20 USD in WOC.',
      under_minimum: 'Wallet is below the $20 USD WOC minimum.',
      price_unavailable: 'WOC price is unavailable, rewards are temporarily locked.',
    },
  },
  theme: {
    preset: 'UI Theme',
    customColors: 'Custom Colors',
    reset: 'Reset',
    presets: {
      classic: 'Classic Gold',
      midnight: 'Midnight',
      parchment: 'Parchment',
      highContrast: 'High Contrast',
    },
    knob: {
      accent: 'Accent',
      border: 'Border',
      panel: 'Frame',
      text: 'Text',
      textMuted: 'Muted Text',
      hp: 'Health',
      mana: 'Mana',
      rage: 'Rage',
      energy: 'Energy',
    },
  },
  // On-screen quest tracker. The "(N)" count shown beside the header while the
  // tracker is collapsed (the number is spliced in via formatNumber), plus the
  // header button's state-aware hover/title hint (Collapse while expanded,
  // Expand while collapsed).
  questTracker: {
    count: '({count})',
    collapseHint: 'Collapse quest tracker',
    expandHint: 'Expand quest tracker',
  },
  chatTimestamps: {
    show: 'Show Chat Timestamps',
    format: 'Timestamp Format',
    clock12h: '12-hour',
    clock24h: '24-hour',
    note: 'Prefixes each new chat line with the time it arrived, e.g. [14:32]. Only affects messages received while the option is on.',
  },
  chatWindow: {
    move: 'Drag to move the chat window',
    resize: 'Drag to resize the chat window',
    reset: 'Reset Chat Window',
    resetAction: 'Reset',
    note: 'Drag the chat tab strip to move the window, or the corner grip to resize it. Reset returns it to the default position and size.',
  },
  swing: {
    ready: 'Swing',
    seconds: '{seconds}s',
  },
  rest: {
    resting: 'Resting',
  },
  // The Spell Power / Attack Power contribution appended to an ability tooltip's
  // base damage, e.g. "66 to 74 (+29)". Punctuation + a formatted number only (no
  // words), so it is locale-neutral and an English-only add.
  abilityScaling: {
    bonus: '(+{value})',
  },
  // Accessible group names for the unit frames (#player-frame and #target-frame are
  // role="group" wrappers over a portrait, name, level, and health/resource bars).
  // Kept short, non-prose labels so they read cleanly as screen-reader group names
  // (and stay non-wordy so an English-filled non-Latin locale does not trip the
  // untranslated-leak guard); the maintainer translates them per locale at release.
  // targetLabel reads as the unit you have marked as your current target (faction
  // neutral: it labels friendly and hostile targets alike).
  unitFrame: {
    playerLabel: 'Your Hero',
    targetLabel: 'Your Mark',
    // targetAnnounce is the polite #target-live announcement spoken once when the player's
    // target CHANGES; {name} is the new target's display name. Kept NON-WORDY
    // (no run of four-plus lowercase after stripping {name}) so an English-filled non-Latin
    // locale does not trip the M16 untranslated-leak guard: "Target" would FAIL it ("arget"
    // is a five-letter run), so this reuses the frame's own term for the target ("Mark", from
    // targetLabel above), which a screen-reader user already hears as the target frame's name.
    targetAnnounce: 'Mark {name}',
    // partyLabel names the #party-frames region (a group of tappable / focusable
    // party member buttons, each named by its visible member name). Kept short and
    // non-wordy (no run of four+ lowercase) so an English-filled non-Latin locale
    // does not trip the untranslated-leak guard; "Band" reads as your group of
    // companions, parallel to playerLabel / targetLabel.
    partyLabel: 'Your Band',
    // partyGroup is the visually-hidden raid-group cue appended to a raid party row's
    // accessible name (e.g. "Group 1"), so a screen reader conveys which raid group a
    // member sits in. {n} is the group number (formatNumber). UNLIKE the labels above
    // this one is WORDY by the M16 rule (a four-plus consecutive-lowercase run survives
    // stripping {n}: "Group" to "roup"), so an English-filled non-Latin locale WOULD trip
    // the untranslated-leak guard: the five non-Latin overlays (zh_CN/zh_TW/ja_JP/ko_KR/
    // ru_RU) carry real fills, the Latin overlays stay pending. Title Case does not help
    // (M16 is per-word consecutive-lowercase, not word count).
    partyGroup: 'Group {n}',
    // The unit suffixes appended to an aura's compact remaining-duration label on the
    // buff/debuff strips (e.g. "20s", "5m", "1h", "2d"). The auras core (auras_view.ts)
    // renders them via the injected durationUnits() dep so an in-game language switch
    // lands next tick. Single chars (non-wordy: no four-plus consecutive-lowercase run),
    // so an English-filled non-Latin overlay does not trip the M16 untranslated-leak
    // guard; the maintainer localizes at release.
    durationUnitSeconds: 's',
    durationUnitMinutes: 'm',
    durationUnitHours: 'h',
    durationUnitDays: 'd',
  },
  // Character sheet (#char-window) accessible names. modelPreview names the role=img 3D
  // turntable HOST distinctly from the title's level/class subtitle (the canvas pixels
  // stay OUT of a11y scope). Like partyGroup this label is WORDY by M16
  // ("Character"/"Model"/"Preview" each carry a four-plus consecutive-lowercase run), so
  // the same five non-Latin overlays carry real fills and the Latin overlays stay
  // pending; Title Case does not make it non-wordy.
  character: {
    modelPreview: 'Character Model Preview',
  },
  // Skip links: the first focusable elements on both game entries, a keyboard /
  // screen-reader shortcut to the main HUD and the chat log (mirrors the src/guide
  // .guide-skip precedent). English-only control labels (the hud_chrome exception);
  // Title Case keeps them non-wordy (no run of four+ lowercase) so an English-filled
  // non-Latin locale does not trip the untranslated-leak guard, like the labels above.
  skipLinks: {
    mainHud: 'Skip to Main HUD',
    chat: 'Skip to Chat',
  },
  // On-screen / mobile control labels and their accessible names. char/bags/music
  // reuse existing keys (hud.keybinds.actions.*, hud.options.music) at the call site.
  mobile: {
    autorun: 'Autorun',
    jump: 'Jump',
    leaderboard: 'Ranks',
    dailyRewards: 'Rewards',
    nameplates: 'Names',
    haptics: 'Haptics',
    hapticsOff: 'Haptics Off',
    toggleHaptics: 'Toggle haptics',
    // The v0.22.0 base's touch-hotbar paging button ("Skills", #mobile-hotbar-page):
    // superseded by the paged action ring below, whose page toggle owns ability
    // paging on touch. The keys stay (already filled in all 20 locales) per the
    // hud.core.mobileTarget precedent for retired-but-translated chrome keys.
    hotbarPage: 'Skills',
    hotbarPageAria: 'Show next set of skills',
    // Paged mobile action ring (Phase 1 of the mobile combat HUD rework): the
    // ring container's accessible name, the page-cycle toggle's accessible name,
    // and the page indicator text painted on the toggle. The per-button
    // aria labels reuse abilityUi.actionBar.slotAria/emptySlotAria/attackName via
    // the shared action_bar_view core, so no per-slot key lives here.
    actionRing: 'Combat actions',
    actionPageToggle: 'Switch action page',
    // The bare page number ("1"/"2", painted big and gold over the swap-arrows
    // glyph) rather than "Page 1 of 2": the toggle button already carries the
    // full "Switch action page" accessible name via actionPageToggle above, so
    // the indicator span only needs to be legible at a glance, not restate the
    // count in words. "{page}" is token-only, so it is exempt from the M16
    // non-Latin-fill requirement.
    actionPageIndicator: '{page}',
    // Target swap (#mobile-target-cycle, replacing the old Target Closest
    // button): a crosshair-icon secondary button that cycles the hostile
    // target via the Tab-target path (acquire-nearest now lives on the ring's
    // attack toggle itself), kept visually distinct from the ring's primary
    // attack toggle. targetCycle is the accessible name/title;
    // targetCycleShort is the tiny on-button caption (space is tight at the
    // button's 44-60px width, so it stays one word).
    targetCycle: 'Swap target',
    targetCycleShort: 'Target',
    // Phase 4: a small touch-only label on each bar-assigned spellbook row,
    // naming which mobile action-ring page (Phase 1) the ability's bar slot
    // falls on. "Page {page}" is not wordy (one word plus a token), so it is
    // exempt from the M16 non-Latin-fill requirement.
    spellbookPageLabel: 'Page {page}',
  },
  // New-adventurer tutorial copy for the touch interface. The default tutorial
  // bodies (hud.tutorial.*Body) reference keyboard/mouse ("W/A/S/D", "press F"),
  // which is wrong on a phone whose only controls are the on-screen sticks and
  // the Use / More action buttons. These touch variants are swapped in when the
  // mobile-touch interface is active (see tutorial_copy.ts). English-only add, so
  // they live here in the hud_chrome domain rather than the constrained `hud` one.
  tutorial: {
    // "movement stick", not "left stick": left-handed mode swaps the two thumb
    // sticks (and the stick can float to wherever you touch), so a fixed side is
    // wrong for that layout.
    moveBodyTouch:
      'Use the movement stick to move and drag the screen to look around. Take a few steps to begin.',
    talkBodyTouch:
      'Stand close to Marshal Redbrook and tap the Use button to speak, then accept his task.',
    returnBodyTouch:
      'Your task is done. Return to Marshal Redbrook and tap the Use button to turn it in.',
    doneBodyTouch:
      'You have the basics, {name}. The Vale is yours to explore. Tap More, then Quests, to review your quest log anytime. Good hunting.',
  },
  // Minimap / compass / clock / coordinate widget tooltips and accessible names.
  widgets: {
    clockTitle: 'Local time - click to toggle 12/24-hour',
    worldCoordinates: 'World coordinates',
    coordinates: 'Coordinates',
    heading: 'Heading',
    minimapZoom: 'Minimap zoom',
  },
  nativeUpdate: {
    title: 'Update Available',
    body: 'A new version of World of ClaudeCraft is available. Update now for the latest fixes and improvements.',
    bodyWithVersion:
      'Version {version} of World of ClaudeCraft is available. Update now for the latest fixes and improvements.',
    notNow: 'Not now',
    update: 'Update',
  },
  // Cast-bar progressbar accessible names (the visible spell name + seconds-left
  // text are the live status; these name which bar is which). One for the player's
  // own cast (#castbar) and one for the target/boss cast (#tf-castbar).
  castBar: {
    playerAria: 'Your Cast Bar',
    targetAria: 'Unit Cast Bar',
  },
  // Leaderboard window chrome: the close-control accessible label only. The board's
  // title / subtitle / column / loading / empty / retry strings live in the game.ts
  // catalog (game.leaderboard.*); this is the one control label the inline window
  // lacked an accessible name for.
  leaderboard: {
    close: 'Close',
    // High-score board tabs: the per-character board and the per-guild board.
    tabsLabel: 'High-score boards',
    tabPlayers: 'Players',
    tabGuilds: 'Guilds',
    tabDevs: 'Developers',
    // Guild-board column headers + the guild-tab empty state.
    guildName: 'Guild',
    members: 'Members',
    topLevel: 'Top',
    guildXp: 'Total XP',
    guildEmpty: 'No ranked guilds yet.',
    // Developer-board column headers + the dev-tab empty state. Contributors are
    // ranked by how many pull requests they have had merged into the open-source
    // repo (not raw commits: see hudChrome.devBadge.flavors.* for why).
    devName: 'Contributor',
    devTierCol: 'Badge',
    mergedPrs: 'Merged PRs',
    devEmpty: 'No ranked contributors yet.',
  },
  // Raid-lockout badge on the minimap rim + its hover/tap panel: the title, the
  // accessible label, the "all ready" line, and the unlock-countdown templates
  // (digits run through formatNumber; the units reorder per locale).
  raidLockout: {
    title: 'Raid Lockouts',
    allReady: 'All raids ready',
    daysHours: '{d}d {h}h',
    hoursMinutes: '{h}h {m}m',
    minutes: '{m}m',
    lessThanMinute: '<1m',
    // Entry-denied toast, enriched client-side with the live unlock countdown
    // ({raid} = the localized raid name, {time} = the formatted countdown).
    lockedToast: 'You are locked to {raid}. Unlocks in {time}.',
    // Display name for a heroic-difficulty lockout row ({name} = dungeon name).
    heroicName: 'Heroic {name}',
    // Entry-denied toast for a heroic daily lockout when no live countdown is
    // mirrored yet ({name} = dungeon name).
    heroicLocked: 'You are locked to Heroic {name}.',
  },
  // Eight-point compass abbreviations as drawn on the heading strip. Each locale
  // overrides with its own established compass abbreviations (e.g. West = "O" in
  // Spanish, "O" in French/Italian/Portuguese, "З" in Russian).
  compass: {
    N: 'N',
    NE: 'NE',
    E: 'E',
    SE: 'SE',
    S: 'S',
    SW: 'SW',
    W: 'W',
    NW: 'NW',
  },
  // DPS/HPS/threat meter number + unit formatting (the digits themselves go
  // through formatNumber; these carry the localizable unit/parenthesization).
  meters: {
    perSecond: '{value}/s',
    perSecondRow: '{total} ({rate})',
    minutesSeconds: '{m}m {s}s',
    seconds: '{s}s',
  },
  // Key Bindings panel action labels that the in-file BIND_ACTION_LABEL_KEYS map
  // (hud.ts) routes through t(). Kept here (not the constrained `hud` catalog
  // domain) so they are an English-only add.
  keybinds: {
    emoteWheel: 'Emote Wheel',
    targetFriendly: 'Target Nearest Friendly',
    targetFriendlyNext: 'Cycle Friendly Target',
    // Discord is a brand name; it stays identical across locales.
    discord: 'Discord',
    valecup: 'Vale Cup',
  },
  // The Vale Cup boarball minigame (docs/prd/vale-cup.md): the queue window,
  // the persistent indicator button, the in-match score strip, and the event
  // banners / log lines. Nation names are SHORT proper names; sport ability
  // names/descriptions localize through the entity catalog
  // (i18n.catalog/abilities.ts), not here.
  vcup: {
    title: 'The Vale Cup',
    // Label on the hold-to-charge shoot power meter (short, uppercased in CSS).
    shootPower: 'POWER',
    close: 'Close the Vale Cup window',
    offlineNote: 'The fixture book is closed. The Vale Cup is not available right now.',
    recordLine: 'Your record: {wins} wins, {losses} losses, {draws} draws.',
    bracketsAria: 'Match bracket',
    // "3v3" style tab label; {n} is the team size.
    bracketLabel: '{n}v{n}',
    waitingCount: '{count} waiting',
    nationsHeading: 'Banner nation',
    nation: {
      vale: 'Eastbrook Vale',
      mirefen: 'The Mirefen',
      thornpeak: 'Thornpeak',
      coliseum: 'The Ashen Coliseum',
      choir: 'The Pale Choir',
      ogre: 'The Ogre Clans',
      moon: 'The Pale Moon',
      copperdig: 'The Copper Dig',
    },
    awayNote: 'If both sides fly the same banner, the away side plays the inverted palette.',
    rolesHeading: 'Sport role',
    role: {
      allrounder: {
        name: 'All-Rounder',
        desc: 'A bit of everything: kick, boot, and a fair shoulder.',
      },
      striker: {
        name: 'Striker',
        desc: 'Lives for the long boot and the quick sidestep.',
      },
      sweeper: {
        name: 'Sweeper',
        desc: 'Bumps runners off the ball and hoofs it clear.',
      },
      keeper: {
        name: 'Keeper',
        desc: 'Guards the goal box with grip, dive, and punt.',
      },
    },
    queue: 'Join the Queue',
    leaveQueue: 'Leave the Queue',
    queueNote: 'Queue from anywhere; the whistle calls you to the Sowfield.',
    queuedStatus: 'Queued for {bracket}: position {position} of {count}.',
    blockNation: 'Pick a banner nation first.',
    blockPartySize: 'That bracket needs a smaller party.',
    blockNotLeader: 'Only the party leader can queue the team.',
    inMatchNote: 'Your team is on the pitch. Play on!',
    deserterNote: 'The Groundskeeper remembers. You may queue again in {seconds} sec.',
    liveHeading: 'Now at the Sowfield',
    liveAria: 'Vale Cup: {nationA} {scoreA}, {nationB} {scoreB}',
    walkUp: 'Walk up to the Sowfield to watch from the stands.',
    noLive: 'The pitch is quiet. No match is being played.',
    boardHeading: 'Winners board',
    boardEmpty: 'No winners recorded yet. The Copper Pail waits.',
    boardWins: '{count} wins',
    // Guild banner entry + guild leaderboard.
    enterAsGuild: 'Enter under the banner of {guild}',
    guildRecordLine: 'Your guild record: {wins} wins, {losses} losses.',
    guildBoardHeading: 'Guild banners',
    guildBoardEmpty: 'No guild has taken the field yet. Fly your banner!',
    guildBoardWl: '{wins} W, {losses} L',
    practice: 'Practice vs. Bots',
    practiceNote: 'Starts a private bot match on your own practice pitch right away.',
    // Region indicator: players currently off in a private practice instance.
    practicingNow: 'Practicing now ({count}):',
    // mm:ss; {seconds} is pre-padded to two digits.
    clock: '{minutes}:{seconds}',
    // Persistent indicator button states.
    indicatorQueued: 'Vale Cup queue: {bracket}, position {position} of {count}',
    indicatorLive: 'Vale Cup',
    indicatorOpen: 'Open the Vale Cup window',
    // In-match strip phase line.
    phaseCountdown: 'Kickoff in {seconds}',
    phaseGoal: 'GOAL!',
    phaseGolden: 'GOLDEN GOAL',
    phaseOver: 'FULL TIME',
    // Event banners (match theatre; also seen by walk-up spectators).
    bannerFound: 'The Vale Cup calls: {nationA} vs {nationB}!',
    bannerCountdown: 'Kickoff in {seconds}...',
    bannerKickoff: 'KICKOFF!',
    bannerGoal: 'GOAL! {nation} scores!',
    bannerSave: '{name} SAVES!',
    bannerGolden: 'GOLDEN GOAL: next score wins!',
    bannerEnd: 'Full time: {nationA} {scoreA}, {nationB} {scoreB}',
    bannerWin: 'Victory at the Sowfield!',
    bannerDraw: 'A draw at the Sowfield.',
    bannerLoss: 'Defeat at the Sowfield.',
    // Chat-log lines.
    logQueued: 'You join the Vale Cup queue for {bracket} (position {position}).',
    logUnqueued: 'You leave the Vale Cup queue.',
    logFound: 'Your Vale Cup match is ready: {nationA} vs {nationB}.',
    logRoster: 'Your side: {allies}. Their side: {enemies}.',
    logGoal: '{name} scores for {nation}! {nationA} {scoreA}, {nationB} {scoreB}.',
    logSave: '{name} makes the save!',
    logWin: 'You win the bout at the Sowfield.',
    logDraw: 'The bout at the Sowfield ends in a draw.',
    logLoss: 'You lose the bout at the Sowfield.',
    // Groundskeeper Bram's gossip-menu entry.
    gossipOpen: 'The book of fixtures',
    gossipOpenAria: 'Open the Vale Cup window',
    mobileLabel: 'Cup',
    // Pre-match briefing overlay (the full-screen rules-and-kit card before kickoff).
    briefing: {
      subtitle: 'Pre-match briefing',
      // The small "vs" glyph between the two banners in the header.
      vs: 'vs',
      rulesHeading: 'How to play',
      rule1: 'Kick or pass the ball into the enemy goal to score.',
      rule2: 'First to 5 goals wins, or the most goals when full time blows.',
      rule3: 'A level match at full time goes to golden goal: the next score wins.',
      rule4: 'Tackles only tumble you over. Nobody gets hurt under the harvest truce.',
      rule5: 'Anyone can walk up and cheer you on from the stands.',
      kitHeading: 'Your kit',
      kitNote: 'These moves replace your class abilities for the match.',
      rosterHeading: 'The team sheet',
      // Row tags on the team sheet.
      you: 'You',
      bot: 'Bot',
      // Ready button: its label, its readied-state label, and its accessible name.
      ready: "I'm ready",
      readyDone: 'Ready',
      readyAria: 'Ready up for kickoff',
      // Shown once you have readied and the match waits on the other fighters.
      waiting: 'Waiting for the other side to ready up...',
      // Live auto-ready countdown ({seconds} whole seconds) and the ready tally.
      whistle: 'The whistle blows in {seconds}s.',
      readyCount: '{ready} of {total} ready',
    },
    // Spectator parimutuel betting (the walk-up banner + card at the Sowfield).
    bet: {
      title: 'Match Bets',
      aria: 'Vale Cup match betting',
      // Live wager countdown / closed state.
      closesIn: 'Bets close in {seconds}s',
      closed: 'Betting closed',
      // The prize pool (total copper wagered) shown between the two shares.
      prize: 'Pool {amount}',
      splitAria: 'Share of the betting pool on each team',
      // The expand / collapse toggle for the full card.
      expand: 'View bets and wager',
      collapse: 'Hide bets',
      oddsLabel: 'Pays',
      // Stake button group heading; {team} is a nation name.
      back: 'Back {team}',
      // A fighter's lifetime form on the card.
      form: '{wins}W-{losses}L',
      // My current wager ({amount} money, {team} nation name), or none yet.
      mine: 'Your bet: {amount} on {team}',
      none: 'You have no bet on this match yet.',
      // My lifetime betting record; {sign} is + or -, {net} the absolute money.
      record: 'Betting record: {wins}W-{losses}L, {sign}{net}',
      // Settlement toasts ({amount} money credited back).
      wonBanner: 'Your bet won!',
      wonLog: 'Your Vale Cup bet won: {amount} returned.',
      lostLog: 'Your Vale Cup bet lost: {amount}.',
      refundLog: 'Bets voided, your {amount} stake was returned.',
    },
  },
  // Click-to-move mouse-button toggle labels (Key Bindings panel). The button id
  // 0/2 maps to these at the HUD render boundary.
  options: {
    clickMoveLeft: 'Left Click',
    clickMoveRight: 'Right Click',
    // Running client version + build id, shown as small secondary text at the foot
    // of the settings menu so players can confirm their build without closing it.
    version: 'v{version} ({build})',
    // Adaptive browser-effects tier control (Graphics panel). Auto detects the
    // browser engine/version + device; the rest pin the CSS-effects tier.
    browserEffects: 'Browser Effects',
    browserEffectsAuto: 'Auto',
    browserEffectsFull: 'Full',
    browserEffectsReduced: 'Reduced',
    browserEffectsMinimal: 'Minimal',
    browserEffectsNote:
      'Auto tones down heavy CSS effects (blur, glow, background motion) based on your browser and device. Lower it manually if the interface feels sluggish.',
    // Interface Mode control (Graphics panel): desktop keyboard/mouse vs the
    // on-screen touch controls. Auto detects the device; the rest force one.
    interfaceMode: 'Interface Mode',
    interfaceModeAuto: 'Auto',
    interfaceModeDesktop: 'Desktop',
    interfaceModeTouch: 'Touch',
    interfaceModeNote:
      'Auto picks desktop or touch controls from your device. Choose Desktop to force keyboard and mouse (useful on a tablet with a keyboard), or Touch for the on-screen controls.',
    // Audio panel toggle for the per-footfall step clips (off by default).
    footstepSounds: 'Footstep Sounds',
    // Toggle for the OSRS-style click-feedback marker: entity targets and
    // click-to-move destinations (on by default).
    clickFeedback: 'Click Marker',
    // Keybind panel toggle: pointer-lock the canvas during a camera drag so the
    // cursor cannot leave the window (hit the screen edge or slip to a second
    // monitor) while rotating. On by default.
    lockCursorOnRotate: 'Lock Cursor While Rotating',
    keybindHelpLockCursorOnRotate:
      'Keeps the mouse cursor inside the window while you drag to rotate the camera, so it cannot reach the screen edge or move to another monitor. Turn off if you prefer a free cursor.',
    showWalletOnCharacterScreen: 'Show Wallet on Character Screen',
    showWalletOnPlayerCard: 'Show Wallet on Player Card',
    // Interface panel toggle: nameplate glyph/outline, inspect block, player
    // card, and the Developers leaderboard tab (on by default).
    showDevBadges: 'Show Developer Badges',
    // Interface panel toggle: render your own overhead nameplate the way other
    // players see it (on by default).
    showOwnNameplate: 'Show My Nameplate',
    // Interface panel: global HUD zoom slider, and the mirror of the landing
    // page's high-contrast backdrop toggle.
    uiScale: 'UI Scale',
    // Interface panel sliders: scale just the player / target unit frame
    // (wordy, M16: the five non-Latin fills land in the same change as each).
    playerFrameScale: 'Player Frame Scale',
    targetFrameScale: 'Target Frame Scale',
    // Interface panel toggle: anchor the player's own buff row to the movable
    // player frame (the debuff row then slides up beside the minimap) instead
    // of the classic two-row top-right corner (wordy, M16: the five non-Latin
    // fills land in this same change).
    aurasOnPlayerFrame: 'Buffs on the Player Frame',
    highContrastBackground: 'High-Contrast Background',
    // Interface panel toggle: also engage auto-attack when using an offensive
    // ability, so white swings start without a separate Attack press (on by default).
    startAttackOnAbility: 'Auto-Attack on Ability Use',
    // Interface panel toggle: loot corpses by walking past them (off by default).
    walkByAutoloot: 'Walk-by Autoloot',
    groundReticle: 'Ground-Targeting Reticle',
    // Interface panel toggle + the item-tooltip lines it reveals (off by default).
    showItemLevel: 'Show Item Level',
    itemLevelLine: 'Item Level {level}',
    itemScoreLine: 'Score {score}',
    // Interface panel toggle that reveals the optional second action bar row (off
    // by default). The abilities bound to its slots stay castable via their keybinds.
    showSecondaryActionBar: 'Show Secondary Action Bar',
    showDailyRewardsChest: 'Show Daily Rewards Chest',
    // Touch-only Graphics panel toggles (mobile combat HUD rework, phase 2).
    // Camera joystick: hidden and off by default, swipe-look on open gameplay
    // space is the primary camera path; this opts into the dedicated stick.
    mobileCameraJoystick: 'Camera joystick',
    // Mirrors the touch layout (movement joystick right, camera joystick left)
    // for left-thumb-dominant players; the same setting as the Key Bindings
    // panel's leftHandedTouch row, surfaced again here alongside the joystick.
    mobileLeftHanded: 'Left-handed layout',
  },
  // Controller / gamepad options panel (Options > Controller). Player-facing
  // chrome, so every label is a key here; the live numbers run through
  // formatNumber. The button names themselves (A / LB / D-pad, etc.) stay as
  // hardware glyphs in gamepad_map and need no translation.
  controller: {
    title: 'Controller',
    enable: 'Enable Controller',
    invertY: 'Invert Camera (Y)',
    deadzone: 'Stick Deadzone',
    cameraSpeed: 'Camera Speed',
    vibration: 'Vibration',
    buttons: 'Button Layout',
    resetButtons: 'Reset Button Layout',
    menuAction: 'Game Menu',
    help: 'Left stick moves, right stick looks. Open a window to use the on-screen pointer.',
  },
  // Performance overlay (the customizable in-game stats panel + its Options
  // sub-view). Player-facing, so every label is a key here; the live numbers in
  // the overlay run through formatNumber and these unit strings. Distinct from
  // the dev `?perf` diagnostic, which stays English like console.*.
  perf: {
    title: 'Performance Overlay',
    enable: 'Show Performance Overlay',
    description: 'Choose which stats to show, where the overlay sits, and how it looks.',
    sectionPosition: 'Position',
    sectionAppearance: 'Appearance',
    sectionStats: 'Stats',
    positionX: 'Horizontal',
    positionY: 'Vertical',
    resetPosition: 'Reset Position',
    dragHint: 'Drag the overlay to move it, or use the sliders below.',
    opacity: 'Background Opacity',
    solidBg: 'Solid Background',
    fontScale: 'Text Size',
    textColor: 'Text Color',
    bgColor: 'Background Color',
    colorTheme: 'Color Theme',
    graph: 'Frame-Time Graph',
    thresholds: 'Color-Coded Warnings',
    presetsLabel: 'Quick Presets',
    presetMinimal: 'Minimal',
    presetStandard: 'Standard',
    presetEverything: 'Everything',
    // Category subheads the Stats toggles are grouped under (mirrors the metric
    // registry's groups: frame/timing, network, renderer, system).
    groups: {
      frame: 'Frame & Timing',
      network: 'Network',
      renderer: 'Renderer',
      system: 'System',
      input: 'Input',
    },
    // Short metric labels shown in the overlay's left column and the Stats toggles.
    labels: {
      fps: 'FPS',
      frameTime: 'Frame Time',
      fps1Low: '1% Low',
      fps01Low: '0.1% Low',
      ping: 'Ping',
      jitter: 'Jitter',
      predLead: 'Prediction Lead',
      snapshot: 'Snapshot Rate',
      serverTick: 'Server Tick Rate',
      connection: 'Connection',
      drawCalls: 'Draw Calls',
      triangles: 'Triangles',
      geometries: 'Geometries',
      textures: 'Textures',
      programs: 'Shaders',
      renderScale: 'Render Scale',
      gpu: 'GPU',
      memory: 'Memory',
      hitches: 'Hitches',
      entities: 'Entities',
      apm: 'APM',
    },
    // Color-theme preset names (also the swatches' accessible names).
    themes: {
      gold: 'Gold',
      frost: 'Frost',
      ember: 'Ember',
      jade: 'Jade',
      crimson: 'Crimson',
      mono: 'Mono',
    },
    // Value units, the digits are spliced in via formatNumber at the call site.
    units: {
      ms: '{value} ms',
      mb: '{value} MB',
      memPair: '{used} / {limit} MB',
      hz: '{value} Hz',
    },
    // Inline status badges shown when the relevant condition is active.
    badges: {
      backgrounded: 'Backgrounded',
      offline: 'Offline',
    },
  },
  playerCard: {
    showWalletBadge: 'Show wallet badge',
  },
  // Landing-page (start screen) accessibility controls.
  landing: {
    // Footer toggle: swap the moving trailer for a static high-contrast backdrop.
    highContrast: 'High Contrast',
    highContrastAria:
      'Toggle high-contrast background: disables the moving trailer so start-screen text stays legible',
  },
  // Character-screen stat tooltips (hover a stat on the C panel). The stat NAMES
  // reuse itemUi.stats.*; only these descriptions / effect lines / notes are new.
  // The breakdown numbers are recomputed live from the player's current stats
  // (src/ui/stat_tooltip.ts) and spliced in via formatNumber at the call site, so
  // the {value}/{level} placeholders carry no baked formatting.
  statInfo: {
    // Header above a primary stat's live breakdown, e.g. "From your 22 Agility:".
    fromYour: 'From your {value} {stat}:',
    // Stat NAMES otherwise reuse itemUi.stats.*; Spell Power is a character-sheet
    // only stat (no item carries a labeled Spell Power line), so its label lives
    // here in the English-only HUD-chrome domain rather than the fully-translated
    // item-stats catalog.
    names: {
      spellPower: 'Spell Power',
      critRating: 'Crit Rating',
      hasteRating: 'Haste Rating',
    },
    desc: {
      str: 'Increases your attack power, so your weapon strikes land harder.',
      agi: 'Sharpens your reflexes and aim, improving several of your combat stats.',
      sta: 'Toughens your body, raising your maximum health and how quickly you recover health while resting.',
      int: "Expands a spellcaster's mana pool and improves their chance to land a spell critical strike.",
      spi: "Quickens how fast a spellcaster's mana returns while resting, out of combat.",
      armor:
        'Softens incoming physical blows. The reduction is greater against lower-level attackers and is capped at 75%.',
      attackPower: 'Powers your weapon attacks. Every 14 attack power adds 1 damage per second.',
      spellPower:
        'Increases the damage of your spells and the strength of your heals. Each point of Intellect grants a little Spell Power, on top of any from gear or buffs.',
      dps: "Your estimated weapon damage per second, combining your weapon's damage and speed with your attack power.",
      critChance: 'Your chance for an attack to strike critically, dealing double damage.',
      dodge: 'Your chance to completely avoid an incoming melee attack, taking no damage.',
      critRating:
        'Crit rating from your gear and set bonuses, raising your critical strike chance. About 10 rating grants 1% crit.',
      hasteRating:
        'Haste rating from your gear and set bonuses, speeding up your attacks and spellcasting. About 10 rating grants 1% haste.',
    },
    // One line per derived effect a stat contributes. {value} is a live number.
    effects: {
      attackPower: '+{value} Attack Power',
      rangedAttackPower: '+{value} Ranged Attack Power',
      critPct: '+{value}% Critical Strike',
      dodgePct: '+{value}% Dodge',
      armor: '+{value} Armor',
      maxHealth: '+{value} Maximum Health',
      maxMana: '+{value} Maximum Mana',
      spellCritPct: '+{value}% Spell Critical Strike',
      healthRegen: 'About {value} health every 5 sec while resting',
      manaRegen: 'About {value} mana every 5 sec while resting',
      damageReduction: 'Damage reduction against a level {level} attacker: {value}%',
      dpsFromAp: 'Adds {value} damage per second to your attacks',
    },
    notes: {
      minorForClass: 'Of little benefit to your class.',
      baseChance: 'Includes a 5% base chance shared by all adventurers.',
      dpsApprox: 'An estimate, it excludes critical strikes and ability damage.',
    },
    // The upstream "where this stat comes from" breakdown: a header plus one line
    // per origin. Every {value} is a live number; buff lines splice in the active
    // aura's localized name. The talents line gathers everything not itemized
    // above (talent bonuses, item-set bonuses, druid form bonuses) so the lines
    // always add up to the stat shown on the sheet.
    sources: {
      header: 'Made up of:',
      base: 'Base: {value}',
      attributes: 'From your attributes: {value}',
      fromAttribute: 'From {stat}: {value}',
      gear: 'Equipped gear: {value}',
      buff: '{name}: {value}',
      talents: 'Talents and effects: {value}',
    },
  },
  // Default name pre-filled into the Save-Build-As dialog, e.g. "Build 3".
  talents: {
    defaultBuildName: 'Build {n}',
  },
  // One-off chat-log tips shown at HUD bootstrap. The /join command tokens stay
  // literal (they are commands); the surrounding prose localizes.
  tips: {
    joinChannels: 'Tip: type /join world or /join lfg to chat with players across the world.',
  },
  // Item-set (tier set) tooltip block. The set name and per-tier bonus text come
  // from content/item_sets.ts via entity_i18n; these two are the surrounding
  // chrome, with `name`/`bonus` spliced in already-localized.
  itemSet: {
    header: '{name} ({have}/{total})',
    bonusLine: '({pieces}) {bonus}',
  },
  // Legendary weapon "chance on action" procs, rendered in the item tooltip from
  // the ItemDef.weaponProcs data (see src/ui/weapon_proc_view.ts). One trigger
  // line wraps the joined effect fragments below it.
  itemProc: {
    onMeleeHit: 'Chance on hit ({chance}%): {effect}',
    onSpellDamage: 'Chance on your damaging spells ({chance}%): {effect}',
    onHeal: 'Chance on your heals ({chance}%): {effect}',
    chainArc:
      'blasts the target with a {school} {name} ({damage}) that leaps to {jumps} nearby foes for decaying damage',
    attackSlow: 'and slows the target attack speed by {pct}% for {duration} sec',
    dot: 'festers {name}, a {school} damage-over-time dealing {total} over {duration} sec',
    hot: 'blooms {name}, a heal-over-time restoring {total} over {duration} sec',
  },
  // Quest-link sharing: the chat-link affordance and its sim-emitted notices
  // (re-localized through the hud-local localizeErrorText/localizeSystemText arms).
  questShare: {
    notShareable: "This quest can't be shared.",
    notInSharerParty: "You must be in {name}'s party to accept that quest.",
    accepted: '{name} accepted your shared quest.',
    dialogTitle: 'Shared Quest',
    viewOnlyHint: "Join the sharer's party to accept this quest.",
    alreadyOn: "You're already on this quest.",
    alreadyDone: "You've already completed this quest.",
    ineligible: "You don't meet the requirements for this quest.",
    noQuestSelected: 'Select a quest in your log to share.',
    linkTitle: 'Shift-click to link this quest in chat.',
  },
  itemShare: {
    linkHint: 'Shift-click to link this item in chat.',
  },
  // CLDR-categorized count strings resolved through tPlural(base, count) in
  // src/ui/i18n.ts: it selects the active locale's cardinal category (one / few /
  // many / other) via Intl.PluralRules and looks up the matching leaf, so e.g.
  // Russian renders the correct 1 / 2-4 / 5+ form instead of a binary one/other.
  // English only ever selects `one`/`other`; `few`/`many` mirror `other` here and
  // carry the real distinct forms only in the locales that need them (ru_RU). The
  // count is auto-supplied as {count}. Keep all four categories present per base.
  plurals: {
    guildMembers: {
      one: 'you are {rank}, {count} member',
      few: 'you are {rank}, {count} members',
      many: 'you are {rank}, {count} members',
      other: 'you are {rank}, {count} members',
    },
    characterCount: {
      one: '{count} character',
      few: '{count} characters',
      many: '{count} characters',
      other: '{count} characters',
    },
    secondsRemaining: {
      one: '{count} second remaining',
      few: '{count} seconds remaining',
      many: '{count} seconds remaining',
      other: '{count} seconds remaining',
    },
    playersOnline: {
      one: 'Who: {count} player online on {realm}.',
      few: 'Who: {count} players online on {realm}.',
      many: 'Who: {count} players online on {realm}.',
      other: 'Who: {count} players online on {realm}.',
    },
    playersMatching: {
      one: 'Who: {count} player matching "{query}" on {realm}.',
      few: 'Who: {count} players matching "{query}" on {realm}.',
      many: 'Who: {count} players matching "{query}" on {realm}.',
      other: 'Who: {count} players matching "{query}" on {realm}.',
    },
  },
  // "Report a Bug" options sub-view (online only). Captures realm/character/
  // position/screenshot plus a free-text description and posts to the server.
  bugReport: {
    menuButton: 'Report a Bug',
    realm: 'World',
    character: 'Character',
    position: 'Position',
    unknown: 'Unknown',
    description: 'What went wrong?',
    descriptionPlaceholder: 'Describe the bug: what you did, what you expected, and what happened.',
    includeScreenshot: 'Include Screenshot',
    screenshotAlt: 'Screenshot of the current view attached to this bug report',
    submit: 'Send Report',
    submitted: 'Bug report sent. Thank you!',
    submittedNoShot: 'Bug report sent, but the screenshot was too large to include.',
    describeFirst: 'Please describe the bug before sending.',
    tooLarge: 'That report is too large to send. Try again without the screenshot.',
    rateLimited: "You've sent several reports recently. Please wait a bit before sending another.",
    failed: 'Could not send the bug report. Please try again.',
  },
  // Character window (paperdoll) controls.
  paperdoll: {
    unequipAria: 'Unequip {item}',
    unequipHint: 'Click ×, right-click, or drag to bags to unequip',
  },
  // Home-page account portal (the logged-in "Account" nav tab). Lives here in the
  // English-only hud_chrome domain so an English-only PR compiles; translations
  // live in the overlays like any other hudChrome.* key.
  account: {
    title: 'Account',
    loggedOutPrompt: 'Log in to manage your account.',
    memberSince: 'Member since {date}',
    sectionSettings: 'Account Settings',
    sectionWallet: '$WOC Wallet',
    sectionCharacters: 'Characters',
    sectionDanger: 'Danger Zone',
    // Change password
    changePassword: 'Change Password',
    currentPassword: 'Current password',
    newPassword: 'New password',
    confirmNewPassword: 'Confirm new password',
    savePassword: 'Update Password',
    passwordChanged: 'Password updated. Other devices have been signed out.',
    errCurrentRequired: 'Enter your current password.',
    errPasswordShort: 'New password must be at least 6 characters.',
    errPasswordLong: 'New password must be at most 128 characters.',
    errPasswordUnchanged: 'New password must be different from the current one.',
    errPasswordConfirm: 'New passwords do not match.',
    // Email
    emailLabel: 'Email (optional)',
    emailHint: 'Used only for account recovery. Use Change Email below to update it.',
    saveEmail: 'Save Email',
    emailSaved: 'Email saved.',
    errEmailInvalid: 'Enter a valid email address.',
    // Server-side (REST) failures, re-localized via main.ts userFacingApiError.
    errCurrentPassword: 'Your current password is incorrect.',
    errUsernameMatch: 'That username does not match your account.',
    errPasswordIncorrect: 'Your password is incorrect.',
    errCharactersOnline: 'Log out all of your characters before deactivating.',
    deactivatedLocked: 'This account has been deactivated. Contact an admin to restore it.',
    // Characters
    charactersSummary: 'Manage your characters and enter the world.',
    charactersCount: 'Characters: {count}',
    goToCharacters: 'View Characters',
    // Wallet
    walletSummary: 'Verify a Solana wallet to show holder flair on your player card.',
    manageWallet: 'Manage Wallet',
    // Deactivate
    deactivate: 'Deactivate Account',
    deactivateWarning:
      'Deactivation locks your account and signs you out everywhere. Contact an admin to restore it. Confirm by re-entering your username and password.',
    confirmUsername: 'Type your username to confirm',
    confirmPassword: 'Password',
    deactivateConfirm: 'Deactivate My Account',
    deactivated: 'Your account has been deactivated.',
    // Log out
    logOut: 'Log Out',
    logOutSummary: 'Sign out of this device.',
    // Security section (two-factor, verified email change, data export).
    sectionSecurity: 'Security',
    // Change email (verified, two-step)
    changeEmailTitle: 'Change Email',
    changeEmailHint:
      'We email a confirmation link to the new address and a notice to the old one. Your email only changes once you open the link.',
    changeEmailNew: 'New email',
    changeEmailSubmit: 'Send Confirmation Link',
    changeEmailSent: 'Check your inbox: open the link we sent to confirm your new email.',
    errEmailUnchanged: 'That is already your email address.',
    // Two-factor (TOTP)
    twoFactorTitle: 'Two-Factor Authentication',
    twoFactorStatusOn: 'Two-factor authentication is ON for your account.',
    twoFactorStatusOff: 'Add an authenticator app for stronger account security.',
    twoFactorSetupBtn: 'Set Up Two-Factor',
    twoFactorBeginHint: 'Enter your password to begin setup.',
    twoFactorBegin: 'Begin Setup',
    twoFactorScanHint:
      'Add this key to your authenticator app (Google Authenticator, Authy, 1Password, and similar), then enter the 6-digit code it shows.',
    twoFactorSecretLabel: 'Setup key',
    twoFactorOpenApp: 'Open in authenticator app',
    twoFactorCodeLabel: '6-digit code',
    twoFactorVerifyBtn: 'Verify and Enable',
    twoFactorEnabledMsg: 'Two-factor authentication is now on.',
    twoFactorRecoveryTitle: 'Save your recovery codes',
    twoFactorRecoveryHint:
      'Each code works once. Store them somewhere safe: they are the only way back in if you lose your authenticator app.',
    twoFactorDownloadCodes: 'Download Codes',
    twoFactorDone: 'Done',
    twoFactorDisableHint:
      'Enter your password to turn two-factor off. Your recovery codes will be discarded.',
    twoFactorDisableBtn: 'Turn Off Two-Factor',
    twoFactorDisabledMsg: 'Two-factor authentication is off.',
    errTwoFactorCode: 'That code is not valid, try again.',
    errTwoFactorState: 'Two-factor setup is not in the expected state. Reload and try again.',
    // Data export (GDPR)
    exportTitle: 'Export My Data',
    exportHint:
      'Download a copy of your account and characters as a JSON file. We also email you a confirmation.',
    exportBtn: 'Download My Data',
    exportDone: 'Your data was downloaded. We emailed you a confirmation.',
    exportFailed: 'Could not export your data. Try again in a moment.',
  },
  // Master loot: the leader-only loot-method control in the party panel, the
  // assignment prompt shown to the master looter, and the sim-emitted log lines
  // re-localized through the hud matchers (localizeLootText/System/Error).
  masterLoot: {
    title: 'Master Loot',
    enableLabel: 'Master loot',
    enableAria: 'Enable master loot',
    looterLabel: 'Master looter',
    leaderOption: 'Party leader',
    thresholdLabel: 'Threshold',
    thresholdUncommon: 'Uncommon and up',
    thresholdRare: 'Rare and up',
    thresholdEpic: 'Epic and up',
    assignPrompt: 'Assign {item}',
    assignAria: 'Assign {item} to {name}',
    rollButton: 'Roll',
    selectAll: 'Select all',
    methodMaster: 'Loot method set to Master Loot. Master Looter: {name}.',
    methodGroup: 'Loot method set to Group Loot.',
    assigned: '{looter} assigned {item} to {target}.',
    unassigned: '{item} was not assigned and is free for all.',
    leaderOnly: 'Only the party leader can change the loot method.',
    rollingFor: 'Rolling for {item}.',
    looterChanged: 'Master Looter is now {name}.',
    thresholdSet: 'Loot threshold set to {threshold}.',
    summaryMaster: 'Loot Settings: Master Loot, Master Looter {name}, threshold {threshold}.',
    summaryGroup: 'Loot Settings: Group Loot.',
  },
  // Per-corpse focus picker (#1142): the checkbox list of tagged components on a
  // harvestable corpse, shown alongside loot. Concentrating on fewer checked
  // components yields a higher tier per component than spreading across all of
  // them (professions/gathering.ts resolveCorpseFocusHarvest).
  corpseHarvest: {
    title: 'Harvest',
    harvestButton: 'Harvest',
    concentrateHint: 'Fewer chosen components yield a higher tier each.',
    alreadyHarvested: 'This corpse has already been harvested.',
    componentAria: 'Harvest {component}',
    components: {
      hide: 'Hide',
      fang: 'Fang',
      silk: 'Silk',
      venomSac: 'Venom Sac',
      gills: 'Gills',
      claw: 'Claw',
      horn: 'Horn',
      tusk: 'Tusk',
    },
  },
  // #1143: persistent town focus allocation panel. Reuses the corpseHarvest
  // component-name map above for consistency; only town-focus-specific copy
  // lives here.
  townFocus: {
    title: 'Town Focus',
    hint: "Focus points add a bonus on top of every component's baseline yield. Unfocused components stay at baseline.",
    budgetLabel: 'Points remaining: {remaining} / {budget}',
    saveButton: 'Save Focus',
    notInTownHint: 'You must be in town to set your focus.',
    increaseAria: 'Increase focus on {component}',
    decreaseAria: 'Decrease focus on {component}',
  },
  // Party leadership: the right-click "Promote to Leader" handoff action shown on a
  // party member's context menu to the current leader. Lives in the English-only
  // hud_chrome domain so an English-only PR compiles; the new-leader announcement
  // itself is a sim emit re-localized through localizeSystemText (hud.logs.partyLeader).
  party: {
    promoteLeader: 'Promote to Leader',
    // The global "/invite <name>" usage hint shown when the command is typed
    // without a name (the invite itself has no proximity gate).
    inviteUsage: 'Invite whom? Usage: /invite <name>.',
  },
  lootSettings: {
    title: 'Loot Settings',
    close: 'Close loot settings',
    menuItem: 'Loot Settings',
    method: 'Loot Method',
    rollThreshold: 'Roll Threshold',
    groupLoot: 'Group Loot',
    valueMaster: 'Master Loot',
    leaderOption: 'Master Looter: Leader (You)',
    masterOption: 'Master Looter: {name}',
  },
  // Self-portrait context menu: the dungeon-difficulty toggle (classic
  // portrait-menu placement). The labels are ACTION labels (what clicking
  // does); shown only to solo players and party leaders, since the sim
  // rejects the change from anyone else.
  dungeonDifficulty: {
    setHeroic: 'Set Dungeon Difficulty: Heroic',
    setNormal: 'Set Dungeon Difficulty: Normal',
  },
  // Modular bag filtering controls: the category chips, sort dropdown, and live
  // search above the bag grid, plus the "no items match" empty state.
  bags: {
    // Right-click destroy affordance: rejected when the item is flagged noDiscard
    // (soulbound quest keys, etc.), which the sim's discardItem also refuses.
    cannotDestroy: 'This item cannot be destroyed.',
    // Tooltip sub-line advertising the right-click destroy affordance, shown only
    // for a destroyable item so junk is removable without hunting for a menu.
    rightClickDestroy: 'Right-click to destroy',
    filterGroupAria: 'Filter bags by category',
    filterAll: 'All',
    filterWeapon: 'Weapons',
    filterArmor: 'Armor',
    filterConsumable: 'Consumables',
    filterMaterial: 'Materials',
    filterQuest: 'Quest',
    sortAria: 'Sort bag items',
    sortRecent: 'Recent',
    sortQuality: 'Quality',
    sortName: 'Name',
    searchPlaceholder: 'Search items',
    searchAria: 'Search bag items by name',
    noMatch: 'No items match your filters.',
    // The bag bar (backpack + 4 equip sockets) and the used/capacity counter.
    capacity: '{used}/{total}',
    capacityAria: 'Bag slots used: {used} of {total}',
    backpack: 'Backpack',
    // Accessible name for a bag-bar socket: '{name}: {slots}' where {slots} is
    // the already-localized 'N Slot Bag' phrase, so no code-side concatenation.
    bagSocketAria: '{name}: {slots}',
    socketEmpty: 'Empty bag slot',
    unequipHint: 'Click to remove this bag',
  },
  // Raid -> party demotion (Social panel raid tab). The sim emits these in English;
  // src/ui/sim_i18n.ts re-localizes them through these keys. Mirrors the existing
  // convert-to-raid messages (which live in sim_i18n's RAID_EXTRA table). Lives here
  // in the English-only hud_chrome domain so an English-only PR compiles.
  raidConvert: {
    toPartyDone: 'Your raid has converted back to a party.',
    notRaid: 'Your group is not a raid.',
    leaderOnly: 'Only the raid leader may convert to a party.',
    tooLarge: 'A raid with more than five members cannot convert back to a party.',
  },
  // Armor subtype shown on an armor item's slot line (classic shows the slot on the
  // left, the armor class on the right). Resolved from src/ui/item_armor_type.ts via
  // the sim's armorTypeForItem; tells the player which classes the gear is meant for.
  itemArmorType: {
    cloth: 'Cloth',
    leather: 'Leather',
    mail: 'Mail',
  },
  // Buff/debuff hover tooltip effect line: a one-line summary of what the active
  // aura does, shown under its name and remaining time. Numbers are spliced in via
  // formatNumber as {value}/{pct}/{interval}/{stacks}/{min}/{max}; {school} is the
  // localized damage-school name (see schools below). Keys are produced by the pure
  // aura_effect.ts descriptor; render via t('hudChrome.auraEffect.<key>', values).
  auraEffect: {
    dot: 'Deals {value} {school} damage every {interval} sec',
    hot: 'Restores {value} health every {interval} sec',
    absorb: 'Absorbs {value} damage',
    healAbsorb: 'Absorbs {value} incoming healing',
    thorns: 'Deals {value} {school} damage to attackers',
    slow: 'Reduces movement speed by {pct}%',
    speed: 'Increases movement speed by {pct}%',
    attackSpeedSlow: 'Slows attack speed by {pct}%',
    attackSpeedFast: 'Increases attack speed by {pct}%',
    haste: 'Increases attack and casting speed by {pct}%',
    tongues: 'Increases casting time by {pct}%',
    increase: {
      ap: 'Increases attack power by {value}',
      armor: 'Increases armor by {value}',
      int: 'Increases Intellect by {value}',
      agi: 'Increases Agility by {value}',
      sta: 'Increases Stamina by {value}',
      spi: 'Increases Spirit by {value}',
      allStats: 'Increases all attributes by {value}',
    },
    reduce: {
      ap: 'Reduces attack power by {value}',
      armor: 'Reduces armor by {value}',
      int: 'Reduces Intellect by {value}',
      agi: 'Reduces Agility by {value}',
      sta: 'Reduces Stamina by {value}',
      spi: 'Reduces Spirit by {value}',
      allStats: 'Reduces all attributes by {value}',
    },
    allStatsPctReduce: 'Reduces all attributes by {pct}%',
    // Percent raid buffs (Arcane Intellect, Mark of the Wild, Fortitude, Battle Shout,
    // Blessing of Might, Devotion Aura).
    increasePct: {
      ap: 'Increases attack power by {pct}%',
      armor: 'Increases armor by {pct}%',
      int: 'Increases Intellect by {pct}%',
      sta: 'Increases Stamina by {pct}%',
      allStats: 'Increases all attributes by {pct}%',
    },
    dodge: 'Increases dodge chance by {pct}%',
    dodgeReduce: 'Reduces dodge chance by {pct}%',
    armorFlat: 'Reduces armor by {value}',
    armorFlatStacks: 'Reduces armor by {value} ({stacks} stacks)',
    // Sunder Armor / Faerie Fire: percent armor reductions (Sunder stacks).
    armorPct: 'Reduces armor by {pct}%',
    armorPctStacks: 'Reduces armor by {pct}% ({stacks} stacks)',
    mortalWound: 'Reduces healing received by {pct}%',
    vulnerability: 'Increases damage taken by {pct}%',
    physVuln: 'Increases physical damage taken by {pct}%',
    spellVuln: 'Increases magic damage taken by {pct}%',
    critVuln: 'Increases chance to be critically hit by {pct}%',
    costTax: 'Increases ability costs by {pct}%',
    stun: 'Stunned: unable to act',
    root: 'Rooted: unable to move',
    incapacitate: 'Incapacitated: unable to act',
    polymorph: 'Polymorphed: unable to act',
    hex: 'Reduces damage and healing dealt by {pct}%',
    blind: 'Blinded: unable to act',
    silence: 'Silenced: unable to cast spells',
    disarm: 'Disarmed: cannot use weapon attacks',
    lockout: 'Spell school locked out',
    imbue: 'Weapon imbued with bonus effects',
    imbueRange: 'Weapon imbued: {min} to {max} bonus damage on Verdict',
    stealth: 'Concealed; movement speed reduced by {pct}%',
    formBear: 'Bruin Form: increased health and armor',
    formCat: 'Cat Form: melee damage and energy',
    formTravel: 'Fleet Form: movement speed increased by {pct}%',
    defensiveStance: 'Guarded Stance: reduced damage taken, more threat',
    righteousFury: 'Burning Oath: greatly increased threat from Holy damage',
    scale: 'Size increased by {pct}%',
    jump: 'Jump height increased by {pct}%',
    // Localized damage-school names spliced into {school} above.
    school: {
      physical: 'Physical',
      fire: 'Fire',
      frost: 'Frost',
      arcane: 'Arcane',
      shadow: 'Shadow',
      holy: 'Holy',
      nature: 'Nature',
    },
  },
  // World-boss spawn announcement. The sim emits this server-wide in English when a
  // world boss rises; src/ui/sim_i18n.ts re-localizes it through this key, splicing
  // the localized boss name. English-only domain so an English-only PR compiles.
  worldBoss: {
    spawn: '{name} rises over Thornpeak Heights!',
  },
  // Loot window title shown only when the chest entity is missing (the normal path
  // uses the chest's localized entity name); replaces a former hard-coded 'Chest'.
  loot: {
    chestTitle: 'Chest',
  },
  // Spellbook action-bar toggle accessible names. The visible glyph is +/-; the
  // accessible name states the action so a screen reader is not left with a bare
  // symbol. {name} is the (already localized) ability name.
  spellbook: {
    addToBarAria: 'Add {name} to action bar',
    removeFromBarAria: 'Remove {name} from action bar',
  },
  // Live overworld mob nameplate label: a bracketed level then the localized mob
  // name (mirrors the corpse branch's worldContent.corpseName template). {level}
  // runs through formatNumber; {name} is already localized. Format-only (brackets /
  // order may reorder per locale), kept here so an English-only add compiles.
  nameplate: {
    mob: '[{level}] {name}',
    mobElite: '[{level}+] {name}',
  },
  // World mouseover tooltip shown when hovering a mob (mob_tooltip_view.ts):
  // name (colored by the nameplate con-color), then "Level N <type>" ({family}
  // reuses the existing guide.family.<id>.name bestiary labels), then a
  // Friendly/Hostile reaction line (green/red, from Entity.hostile). All three
  // values below are wordy (M16): filled in the five non-Latin locales in this
  // same change.
  mobTooltip: {
    levelFamily: 'Level {level} {family}',
    // The one MobFamily with no guide.family.* bestiary entry (demons are
    // warlock-pet / zone encounter mobs, out of scope for the public wiki
    // bestiary generator), so it needs its own word here.
    familyDemon: 'Demon',
    hostile: 'Hostile',
    friendly: 'Friendly',
  },
  // Movable target frame: the small corner toggle that unlocks the frame for
  // dragging and locks it back in place (target_frame_pos.ts + hud.ts wiring).
  // The one button swaps its accessible name with its pressed state; both values
  // are wordy (M16), filled in the five non-Latin locales in this same change.
  targetFrame: {
    // aria-label / title while LOCKED (aria-pressed=false): press to move it.
    unlock: 'Move target frame',
    // aria-label / title while UNLOCKED (aria-pressed=true): press to fix it.
    lock: 'Lock target frame',
  },
  // Movable player frame: the same MovableFrame corner toggle on #player-frame
  // (movable_frame.ts). Same shape as targetFrame above; both values are wordy
  // (M16), filled in the five non-Latin locales in this same change.
  playerFrame: {
    unlock: 'Move player frame',
    lock: 'Lock player frame',
  },
  // Interface panel row: snap both movable unit frames back to their stock
  // spots (the button reuses chatWindow.resetAction). Wordy (M16): the five
  // non-Latin fills land in this same change.
  frameReset: {
    label: 'Reset Frame Positions',
  },
  // Item tooltip: the minimum character level needed to equip a piece (classic
  // "Requires Level N"). Shown red when the viewer is below it. {level} runs
  // through formatNumber.
  itemTooltip: {
    requiresLevel: 'Requires Level {level}',
  },
  discord: {
    title: 'Discord',
    panelTitle: 'World of ClaudeCraft',
    open: 'Discord',
    close: 'Close',
    keybind: 'Discord Panel',
    disabled: 'Discord integration is not available right now.',
    // Status-rung display names (the ladder lives in src/sim/discord_tier.ts).
    tiers: {
      none: 'Unranked',
      initiate: 'Initiate',
      squire: 'Squire',
      footman: 'Footman',
      knight: 'Knight',
      champion: 'Champion',
      warlord: 'Warlord',
      legend: 'Legend',
      mythic: 'Mythic',
    },
    loginCta: 'Continue with Discord',
    orEmail: 'or use email',
    cta: {
      title: 'Link your Discord to earn points and rank up',
      stats: '{online} online · {total} members in the server',
      statsLoading: 'Join the community and earn rewards',
      button: 'Link in one click',
      dismiss: 'Dismiss',
    },
    link: {
      cta: 'Link Discord',
      relink: 'Relink Discord',
      connecting: 'Opening Discord...',
      benefits:
        'Link your Discord to earn points from play and community activity, and climb the status tiers.',
      error: 'Could not link Discord. Please try again.',
      success: 'Discord linked.',
    },
    // First-time Discord login chooser (create a new account vs link an existing one).
    choice: {
      title: 'Continue with Discord',
      intro: 'Create a new account, or link your Discord to one you already have.',
      greeting: 'Welcome, {name}!',
      createCta: 'Create a new account',
      haveAccount: 'Already have an account?',
      linkCta: 'Link an existing account',
      linkSubmit: 'Link account',
      error: 'Could not continue. Please try again.',
      expired: 'That Discord sign-in expired. Please sign in with Discord again.',
    },
    // Unlinking a Discord-provisioned account: set a password first so it stays
    // reachable (the username is fixed and shown read-only).
    keep: {
      title: 'Set a password',
      body: 'Your account signs in with Discord. Set a password so you can still log in with your username after unlinking.',
      usernameLabel: 'Your username',
      confirmLabel: 'Confirm password',
      submit: 'Set password and unlink',
      cancel: 'Cancel',
      mismatch: 'Passwords do not match.',
      tooShort: 'Password must be at least 6 characters.',
    },
    linkedAs: 'Linked as {name}',
    linkedTitle: 'Discord: {name}',
    viewCharacter: 'View {name}',
    viewProfile: "Open this character's public profile",
    unlink: 'Unlink',
    visit: 'Visit Discord',
    unlinkConfirm: 'Unlink your Discord account from this game account?',
    statusLabel: 'Status',
    rank: 'Rank',
    points: 'Points',
    lifetime: 'Lifetime',
    toNext: '{points} to next rank',
    maxRank: 'Top rank reached',
    tiersTitle: 'Status Tiers',
    tierLocked: 'Locked',
    tierCurrent: 'Current',
    earnTitle: 'How to earn points',
    earnBody:
      'Earn points from time played in game and from staying active in the Discord. Points raise your status tier.',
    memberSince: 'Member since',
    memberSinceDays: '{days}d in the Discord',
    roleTag: {
      levyst: 'Levy St',
      admin: 'Admin',
      coredevs: 'Core Dev',
      devs: 'Dev',
      mods: 'Mod',
      artists: 'Artist',
    },
    guildMember: 'Verified member',
    notMember: 'Not in the server yet',
    joinCta: 'Join the Discord',
    online: '{count} online',
    community: 'Community',
    rewards: 'Rewards',
    voice: {
      title: 'Voice',
      channel: 'In {channel}',
      empty: 'No one is in voice right now.',
      speaking: 'Speaking',
      muted: 'Muted',
      join: 'Join voice',
      connect: 'Connect to voice channel',
    },
    swag: {
      title: 'Swag',
      claim: 'Claim',
      claimed: 'Claimed',
      locked: 'Locked',
      free: 'Free',
      cost: '{points} pts',
      needTier: 'Reach a higher rank to claim this.',
      needPoints: 'Not enough points.',
      claimError: 'Could not claim that reward. Please try again.',
      claimedToast: 'Claimed: {name}',
      // Swag item display names (catalog ids in src/sim/discord_tier.ts).
      titleDiscordian: 'Title: Discordian',
      titleSquire: 'Title: Squire of the Realm',
      chromaBlurple: 'Blurple Mech Chroma',
      titleChampion: 'Title: Champion of Claudemoon',
      swagStickers: 'Sticker Pack (shipped)',
      swagTee: 'T-Shirt (shipped)',
    },
    // "!" community commands: an interactive chat dropdown that broadcasts in-game
    // and cross-posts to Discord (looking-for-group, trade, recruiting, events).
    relay: {
      tooFast: 'You are posting too fast. Wait a moment and try again.',
      lfg: { label: 'Looking for Group', hint: 'Find players for a dungeon or quest' },
      wts: { label: 'Want to Sell', hint: 'Advertise an item or service for sale' },
      wtb: { label: 'Want to Buy', hint: 'Request an item you want to buy' },
      recruit: { label: 'Guild Recruiting', hint: 'Recruit players for your guild' },
      event: { label: 'Event / Raid', hint: 'Announce a raid, meetup or event' },
      help: { label: 'Need Help', hint: 'Ask the community for help' },
    },
  },
  // Developer badge: a cosmetic honor for contributors by landed-commit count
  // (the ladder lives in src/sim/dev_tier.ts; the data is sourced from a verified
  // GitHub-OAuth link plus the repo's contributor stats). Shown on the player
  // card, the overhead nameplate, and the inspect screen.
  devBadge: {
    title: 'Developer',
    // Tier display names (the ladder lives in src/sim/dev_tier.ts).
    tiers: {
      tinkerer: 'Tinkerer',
      artificer: 'Artificer',
      runesmith: 'Runesmith',
      architect: 'Architect',
      worldwright: 'Worldwright',
    },
    // Flavor lines per rung (shown on the inspect screen and the player card).
    // Rungs count MERGED pull requests, not raw commits: it is the unit that
    // resists commit-spamming a single reviewed contribution.
    flavors: {
      tinkerer: 'Your first pull request landed in the realm.',
      artificer: 'Five pull requests in, and the world bends to your code.',
      runesmith: 'Fifteen pull requests forged into the running game.',
      architect: 'An architect of the realm: 30 pull requests merged.',
      worldwright: 'A wright of worlds: 70 pull requests shape the game.',
    },
    // Nameplate badge tooltip + inspect/card readouts.
    badgeTitle: 'Developer: {tier}',
    prsLanded: '{count} pull requests merged',
    contributor: 'Open-source contributor',
    // GitHub link control (mirrors the wallet link beside it on character select).
    link: {
      cta: 'Link GitHub',
      relink: 'Relink GitHub',
      benefits:
        'Link your GitHub to earn a developer badge for the pull requests you have had merged into the open-source repo.',
      error: 'Could not link GitHub. Please try again.',
    },
    linkedAs: 'Linked as {login}',
    unlink: 'Unlink GitHub',
  },
  // The Ravenpost mailbox window + envelope indicator. Authored letter
  // sender/subject/body localize via entities.letters.* (world_entity_i18n),
  // not here; these are the window chrome and the structured mailResult lines.
  mailbox: {
    title: 'Mailbox',
    subtitle: 'The Ravenpost',
    close: 'Close mailbox',
    tabInbox: 'Inbox',
    tabInboxWithCount: 'Inbox ({count})',
    tabSend: 'Send',
    empty: 'Your mailbox is empty.',
    truncated: 'Showing the newest {shown} of {total} letters.',
    attachmentsBadge: 'Parcel attached',
    unreadBadge: 'Unread',
    back: 'Back',
    take: 'Take attachments',
    delete: 'Delete letter',
    deleteAria: 'Delete the letter {subject}',
    openAria: 'Read the letter {subject} from {name}',
    noSubject: '(no subject)',
    toLabel: 'To',
    toPlaceholder: 'Character name',
    subjectLabel: 'Subject',
    bodyLabel: 'Message',
    coinLabel: 'Attach coin',
    parcelsLabel: 'Parcels',
    parcelsHint: 'Click an item in your bags to attach it.',
    removeParcelAria: 'Remove {item} from the letter',
    sendButton: 'Send letter',
    postageNote: 'Postage: {amount}. The raven flies for about {seconds}s.',
    arrivedBanner: 'The raven has landed: mail from {name}.',
    arrivedLog: 'You have new mail from {name}.',
    indicatorAria: 'Unread mail: {count}',
    indicatorTip: 'You have {count} unread letters. Visit a mailbox to read them.',
    clickAttach: 'Click to attach to your letter.',
    cannotMail: 'This cannot be mailed.',
    result: {
      sent: 'A raven takes wing with your letter to {name} ({postage} postage).',
      collected: 'You collect {amount} from the letter.',
      tooFar: 'You must be at a mailbox to tend your post.',
      needRecipient: 'Name a recipient for your letter.',
      noRecipient: 'No one by that name holds a mailbox here.',
      tooManyParcels: 'A letter carries at most {count} parcels.',
      noMailQuestItems: 'You cannot mail quest items.',
      notEnoughItems: 'You do not have that many to send.',
      cantAffordPostage: 'You cannot afford the postage.',
      recipientBoxFull: 'Their mailbox is full.',
      letterGone: 'That letter is no longer in your box.',
      takeParcelsFirst: 'Take the parcels out before discarding the letter.',
    },
  },
  // The bank window (the Gilded Strongbox): a pooled deposit box shown while standing
  // at a banker NPC. Plain click withdraws a stack; shift-click withdraws a partial
  // amount; the footer buys 6-slot expansion blocks. The withdraw-quantity and
  // buy-confirm prompts reuse the generic vendor cancel key (itemUi.vendor.sellQuantityCancel).
  bank: {
    title: 'Bank',
    subtitle: 'The Gilded Strongbox',
    close: 'Close bank',
    capacity: '{used}/{total}',
    capacityAria: 'Bank slots used: {used} of {total}',
    empty: 'Your bank is empty.',
    tooFar: 'You must be at a banker to view your bank.',
    buySlots: 'Buy {count} slots',
    buySlotsMaxed: 'Fully expanded',
    buyConfirm: 'Purchase {count} additional bank slots for {price}?',
    buyConfirmAccept: 'Purchase',
    withdrawHint: 'Click to withdraw',
    withdrawPartialHint: 'Shift-click to withdraw a partial amount',
    depositHint: 'Click to deposit',
    depositPartialHint: 'Shift-click to deposit a partial amount',
    cannotDeposit: 'Cannot be banked',
    depositQuantityTitle: 'Deposit {item}',
    depositQuantityInput: 'Quantity to deposit',
    depositQuantityConfirm: 'Deposit',
    withdrawQuantityTitle: 'Withdraw {item}',
    withdrawQuantityInput: 'Quantity to withdraw',
    withdrawQuantityConfirm: 'Withdraw',
    // Search / category / sort toolbar. The category chip and sort option
    // labels reuse the generic hudChrome.bags.* strings; only these bank-named aria
    // labels are distinct from the bags wording.
    filterGroupAria: 'Filter bank by category',
    sortAria: 'Sort bank items',
    searchAria: 'Search bank items by name',
    // Deposit-all-materials button + its transient summary line. {count} is
    // the number of material stacks moved.
    depositAll: 'Deposit all materials',
    depositAllDone: 'Materials deposited: {count}.',
    depositAllFull: 'Materials deposited: {count}. Bank now full.',
    depositAllNone: 'Bank full: nothing deposited.',
    // Bonus-slot breakdown footer (online only): a header total plus one row
    // per account source, advertising what linking earns. {count} is a slot count.
    bonusTitle: 'Bonus slots',
    bonusEarned: '+{count}',
    bonusStatusEarned: '+{count}',
    bonusSourceEmail: 'Verified email',
    bonusSourceDiscord: 'Discord linked',
    bonusSourceWallet: 'Wallet linked',
    bonusSourceReferral: 'Referred friends',
    bonusAdvertEmail: 'Verify your email to earn 2 slots.',
    bonusAdvertDiscord: 'Link your Discord to earn 2 slots.',
    bonusAdvertWallet: 'Link a wallet to earn 2 slots.',
    bonusReferralProgress: '{count}/{cap}',
    bonusReferralExplainer:
      'Invite a friend: when they reach level 10 you each earn 2 slots, up to 5 friends.',
    bonusSectionAria: 'Bonus bank slots and how to earn more',
  },
  // The event calendar window: recurring system events plus the guild lane
  // (booked by officers and the Guild Master, mirrored via socialInfo).
  calendar: {
    title: 'Event Calendar',
    close: 'Close calendar',
    keybindLabel: 'Event Calendar',
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    dayAria: '{date}: {count} events',
    noEvents: 'Nothing planned for this day.',
    allDay: 'All day',
    bookedBy: 'Booked by {name}',
    deleteAria: 'Remove the event {title}',
    bookTitle: 'Book a guild event',
    titlePlaceholder: 'Event title',
    notePlaceholder: 'Note (optional)',
    hourLabel: 'Hour (UTC)',
    hourAllDay: 'All day',
    addButton: 'Book event',
    guildOnlyNote: 'Join a guild to plan events together.',
    result: {
      created: 'The event is on the guild calendar.',
      removed: 'The event was taken off the calendar.',
      notInGuild: 'You are not in a guild.',
      notOfficer: 'Only officers and the Guild Master may manage guild events.',
      badInput: 'Give the event a title and a valid day.',
      calendarFull: 'The guild calendar is full.',
      eventGone: 'That event is no longer on the calendar.',
    },
    events: {
      raidCall: {
        title: 'Raid Call',
        note: 'Wardens sound the horn: gather a party for the crypts and the raid.',
      },
      marketDay: {
        title: 'Market Day',
        note: 'The Merchant expects fresh stock. A fine day to browse the World Market.',
      },
      fiestaNight: {
        title: 'Fiesta Night',
        note: 'The 2v2 Fiesta ring draws its loudest crowds tonight.',
      },
      arenaClash: {
        title: 'Arena Clash',
        note: 'Duelists flock to the Ashen Coliseum. Queue up and climb the ladder.',
      },
      fishingDerby: {
        title: 'Fishing Derby',
        note: 'Anglers line the lakes. Bring a pole and swap fishing tales.',
      },
      delveDay: {
        title: 'Delve Day',
        note: 'Brother Halven marks his charts: a fine day to brave the Collapsed Reliquary.',
      },
      moongateCommunion: {
        title: 'Moongate Communion',
        note: 'Pilgrims gather at the temple moongate under the mid-month moon.',
      },
    },
  },
  // Guild roster: a member's last world-entry time, shown on offline rows. {when}
  // is a locale-formatted date/time, or the "never" leaf when the character has no
  // recorded login.
  social: {
    lastSeen: 'Last seen: {when}',
    lastSeenNever: 'never',
  },
  // Gathering proficiency section on the character sheet (#1124). Profession
  // display names mirror src/sim/content/professions.ts (GatheringProfessionId).
  gathering: {
    title: 'Gathering',
    mining: 'Mining',
    logging: 'Logging',
    herbalism: 'Herbalism',
  },
  // Archetype title (#1130): the named title granted by a character's currently
  // active craft archetype (see src/sim/professions/archetype.ts). `none` is shown
  // before the zone-1 acceptance quest has ever been completed (no "Jack of All
  // Trades" fallback, just untitled). The ten per-craft names are keyed by the
  // same craft id as CRAFT_RING (src/sim/content/professions.ts); keep both in sync.
  archetypeTitle: {
    label: 'Title',
    none: 'None',
    armorcrafting: 'Armorer',
    weaponcrafting: 'Weaponsmith',
    jewelcrafting: 'Jeweler',
    alchemy: 'Alchemist',
    engineering: 'Tinkerer',
    cooking: 'Chef',
    inscription: 'Scribe',
    enchanting: 'Enchanter',
    tailoring: 'Tailor',
    leatherworking: 'Leathercrafter',
  },
  // Crafting window (#1127): the minimal common-tier crafting action, one row
  // per known recipe, a Craft button enabled only when every reagent is held.
  crafting: {
    title: 'Crafting',
    close: 'Close crafting',
    craft: 'Craft',
    reagentsNeeded: 'Requires:',
    reagentLine: '{name} x{have}/{required}',
    empty: 'No recipes known yet.',
    resultAria: 'Craft {name}',
    craftedToast: 'Crafted: {name}',
    insufficientMaterials: 'You do not have the materials for that.',
    unknownRecipe: 'That recipe does not exist.',
    comboRequirementUnmet:
      'You do not have both required crafts at the required tier for that recipe.',
  },
};
