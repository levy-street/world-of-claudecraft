// i18n source catalog - in-game HUD chrome strings that were previously hard-coded
// at their call sites (emote wheel/editor, swing timer, rest indicator, mobile
// controls, minimap/compass/clock widgets, DPS/HPS meters formatting). English
// values only; the 13 locale translations live in src/ui/i18n.locales/<lang>.ts
// (the runtime-authoritative overlays), filled by the maintainer at release.
//
// Assembled into `en` by ./index.ts under the `hudChrome` namespace. Kept as its
// own module (no per-locale blocks) so new chrome keys are an English-only add.

export const hudChromeStrings = {
  // Overhead emote display names (wheel tooltips/labels, editor items, overhead
  // bubble text). Source ids/order mirror OVERHEAD_EMOTES in world_api.ts.
  emotes: {
    wave: "Wave",
    laugh: "LOL",
    question: "Bro?",
    cheer: "Cheer",
    dance: "Dance",
    point: "Point",
    flex: "Flex",
    salute: "Salute",
    cry: "Cry",
    bow: "Bow",
    clap: "Clap",
    roar: "Roar",
    kneel: "Kneel",
  },
  emoteWheel: {
    edit: "Edit",
    label: "Emotes",
  },
  emoteEditor: {
    title: "Emotes",
    done: "Done",
  },
  chatTimestamps: {
    show: "Show Chat Timestamps",
    format: "Timestamp Format",
    clock12h: "12-hour",
    clock24h: "24-hour",
    note: "Prefixes each new chat line with the time it arrived, e.g. [14:32]. Only affects messages received while the option is on.",
  },
  swing: {
    ready: "Swing",
    seconds: "{seconds}s",
  },
  rest: {
    resting: "Resting",
  },
  // On-screen / mobile control labels and their accessible names. char/bags/music
  // reuse existing keys (hud.keybinds.actions.*, hud.options.music) at the call site.
  mobile: {
    autorun: "Autorun",
    jump: "Jump",
    leaderboard: "Ranks",
    nameplates: "Names",
    haptics: "Haptics",
    hapticsOff: "Haptics Off",
    toggleHaptics: "Toggle haptics",
  },
  // Minimap / compass / clock / coordinate widget tooltips and accessible names.
  widgets: {
    clockTitle: "Local time - click to toggle 12/24-hour",
    worldCoordinates: "World coordinates",
    coordinates: "Coordinates",
    heading: "Heading",
    minimapZoom: "Minimap zoom",
  },
  // Eight-point compass abbreviations as drawn on the heading strip. Each locale
  // overrides with its own established compass abbreviations (e.g. West = "O" in
  // Spanish, "O" in French/Italian/Portuguese, "З" in Russian).
  compass: {
    N: "N",
    NE: "NE",
    E: "E",
    SE: "SE",
    S: "S",
    SW: "SW",
    W: "W",
    NW: "NW",
  },
  // DPS/HPS/threat meter number + unit formatting (the digits themselves go
  // through formatNumber; these carry the localizable unit/parenthesization).
  meters: {
    perSecond: "{value}/s",
    perSecondRow: "{total} ({rate})",
    minutesSeconds: "{m}m {s}s",
    seconds: "{s}s",
  },
  // Key Bindings panel action labels that the in-file BIND_ACTION_LABEL_KEYS map
  // (hud.ts) routes through t(). Kept here (not the constrained `hud` catalog
  // domain) so they are an English-only add.
  keybinds: {
    emoteWheel: "Emote Wheel",
    targetFriendly: "Target Nearest Friendly",
    targetFriendlyNext: "Cycle Friendly Target",
  },
  // Click-to-move mouse-button toggle labels (Key Bindings panel). The button id
  // 0/2 maps to these at the HUD render boundary.
  options: {
    clickMoveLeft: "Left Click",
    clickMoveRight: "Right Click",
    // Audio panel toggle for the per-footfall step clips (off by default).
    footstepSounds: "Footstep Sounds",
    showWalletOnCharacterScreen: "Show Wallet on Character Screen",
    showWalletOnPlayerCard: "Show Wallet on Player Card",
  },
  // Performance overlay (the customizable in-game stats panel + its Options
  // sub-view). Player-facing, so every label is a key here; the live numbers in
  // the overlay run through formatNumber and these unit strings. Distinct from
  // the dev `?perf` diagnostic, which stays English like console.*.
  perf: {
    title: "Performance Overlay",
    enable: "Show Performance Overlay",
    description: "Choose which stats to show, where the overlay sits, and how it looks.",
    sectionPosition: "Position",
    sectionAppearance: "Appearance",
    sectionStats: "Stats",
    positionX: "Horizontal",
    positionY: "Vertical",
    resetPosition: "Reset Position",
    dragHint: "Drag the overlay to move it, or use the sliders below.",
    opacity: "Background Opacity",
    solidBg: "Solid Background",
    fontScale: "Text Size",
    textColor: "Text Color",
    bgColor: "Background Color",
    colorTheme: "Color Theme",
    graph: "Frame-Time Graph",
    thresholds: "Color-Coded Warnings",
    presetsLabel: "Quick Presets",
    presetMinimal: "Minimal",
    presetStandard: "Standard",
    presetEverything: "Everything",
    // Category subheads the Stats toggles are grouped under (mirrors the metric
    // registry's groups: frame/timing, network, renderer, system).
    groups: {
      frame: "Frame & Timing",
      network: "Network",
      renderer: "Renderer",
      system: "System",
    },
    // Short metric labels shown in the overlay's left column and the Stats toggles.
    labels: {
      fps: "FPS",
      frameTime: "Frame Time",
      fps1Low: "1% Low",
      fps01Low: "0.1% Low",
      ping: "Ping",
      jitter: "Jitter",
      snapshot: "Snapshot Rate",
      connection: "Connection",
      drawCalls: "Draw Calls",
      triangles: "Triangles",
      geometries: "Geometries",
      textures: "Textures",
      programs: "Shaders",
      renderScale: "Render Scale",
      gpu: "GPU",
      memory: "Memory",
      hitches: "Hitches",
      entities: "Entities",
    },
    // Color-theme preset names (also the swatches' accessible names).
    themes: {
      gold: "Gold",
      frost: "Frost",
      ember: "Ember",
      jade: "Jade",
      crimson: "Crimson",
      mono: "Mono",
    },
    // Value units — the digits are spliced in via formatNumber at the call site.
    units: {
      ms: "{value} ms",
      mb: "{value} MB",
      memPair: "{used} / {limit} MB",
      hz: "{value} Hz",
    },
    // Inline status badges shown when the relevant condition is active.
    badges: {
      backgrounded: "Backgrounded",
      offline: "Offline",
    },
  },
  playerCard: {
    showWalletBadge: "Show wallet badge",
  },
  // Character-screen stat tooltips (hover a stat on the C panel). The stat NAMES
  // reuse itemUi.stats.*; only these descriptions / effect lines / notes are new.
  // The breakdown numbers are recomputed live from the player's current stats
  // (src/ui/stat_tooltip.ts) and spliced in via formatNumber at the call site, so
  // the {value}/{level} placeholders carry no baked formatting.
  statInfo: {
    // Header above a primary stat's live breakdown, e.g. "From your 22 Agility:".
    fromYour: "From your {value} {stat}:",
    desc: {
      str: "Increases your attack power, so your weapon strikes land harder.",
      agi: "Sharpens your reflexes and aim, improving several of your combat stats.",
      sta: "Toughens your body, raising your maximum health and how quickly you recover health while resting.",
      int: "Expands a spellcaster's mana pool and improves their chance to land a spell critical strike.",
      spi: "Quickens how fast a spellcaster's mana returns while resting, out of combat.",
      armor: "Softens incoming physical blows. The reduction is greater against lower-level attackers and is capped at 75%.",
      attackPower: "Powers your weapon attacks. Every 14 attack power adds 1 damage per second.",
      dps: "Your estimated weapon damage per second, combining your weapon's damage and speed with your attack power.",
      critChance: "Your chance for an attack to strike critically, dealing double damage.",
      dodge: "Your chance to completely avoid an incoming melee attack, taking no damage.",
    },
    // One line per derived effect a stat contributes. {value} is a live number.
    effects: {
      attackPower: "+{value} Attack Power",
      rangedAttackPower: "+{value} Ranged Attack Power",
      critPct: "+{value}% Critical Strike",
      dodgePct: "+{value}% Dodge",
      armor: "+{value} Armor",
      maxHealth: "+{value} Maximum Health",
      maxMana: "+{value} Maximum Mana",
      spellCritPct: "+{value}% Spell Critical Strike",
      healthRegen: "About {value} health every 5 sec while resting",
      manaRegen: "About {value} mana every 5 sec while resting",
      damageReduction: "Damage reduction against a level {level} attacker: {value}%",
      dpsFromAp: "Adds {value} damage per second to your attacks",
    },
    notes: {
      minorForClass: "Of little benefit to your class.",
      baseChance: "Includes a 5% base chance shared by all adventurers.",
      dpsApprox: "An estimate, it excludes critical strikes and ability damage.",
    },
  },
  // Default name pre-filled into the Save-Build-As dialog, e.g. "Build 3".
  talents: {
    defaultBuildName: "Build {n}",
  },
  // One-off chat-log tips shown at HUD bootstrap. The /join command tokens stay
  // literal (they are commands); the surrounding prose localizes.
  tips: {
    joinChannels: "Tip: type /join world or /join lfg to chat with players across the realm.",
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
      one: "you are {rank}, {count} member",
      few: "you are {rank}, {count} members",
      many: "you are {rank}, {count} members",
      other: "you are {rank}, {count} members",
    },
    characterCount: {
      one: "{count} character",
      few: "{count} characters",
      many: "{count} characters",
      other: "{count} characters",
    },
    secondsRemaining: {
      one: "{count} second remaining",
      few: "{count} seconds remaining",
      many: "{count} seconds remaining",
      other: "{count} seconds remaining",
    },
    playersOnline: {
      one: "Who: {count} player online on {realm}.",
      few: "Who: {count} players online on {realm}.",
      many: "Who: {count} players online on {realm}.",
      other: "Who: {count} players online on {realm}.",
    },
  },
  // $WOC reward-season panel: read-only view of the on-chain flow-ledger season
  // and its pool (see src/ui/woc_season_panel.ts + src/ui/woc_season.ts).
  wocSeason: {
    menu: "$WOC Season",
    title: "$WOC Reward Season",
    subtitle: "Treasury-funded payouts to top players",
    close: "Close",
    none: "No reward season is active right now.",
    noneHint: "A season opens once arena rake and buybacks begin funding the pool.",
    statusActive: "Active",
    statusEnded: "Ended",
    endsIn: "Ends in",
    endsInValue: "{days}d {hours}h {minutes}m",
    ended: "This season has ended.",
    openEnded: "Open-ended",
    poolLabel: "Reward pool available",
    wocUnit: "$WOC",
    emittedLabel: "{pct}% of the pool paid out so far",
    sinkLabel: "Funded",
    emissionLabel: "Paid out",
    invariant: "Payouts can never exceed what the season took in: buy > sell, enforced on-chain.",
    standingsTitle: "Projected top earners",
    colRank: "#",
    colPlayer: "Player",
    colRating: "Rating",
    colReward: "Reward ($WOC)",
    projectedNote: "Projected from the current pool + arena ranking; final payouts settle at season close.",
  },

  // Home-page account portal (the logged-in "Account" nav tab). Lives here in the
  // English-only hud_chrome domain so an English-only PR compiles; translations
  // live in the overlays like any other hudChrome.* key.
  account: {
    title: "Account",
    loggedOutPrompt: "Log in to manage your account.",
    memberSince: "Member since {date}",
    sectionSettings: "Account Settings",
    sectionWallet: "$WOC Wallet",
    sectionCharacters: "Characters",
    sectionDanger: "Danger Zone",
    // Change password
    changePassword: "Change Password",
    currentPassword: "Current password",
    newPassword: "New password",
    confirmNewPassword: "Confirm new password",
    savePassword: "Update Password",
    passwordChanged: "Password updated. Other devices have been signed out.",
    errCurrentRequired: "Enter your current password.",
    errPasswordShort: "New password must be at least 6 characters.",
    errPasswordLong: "New password must be at most 128 characters.",
    errPasswordUnchanged: "New password must be different from the current one.",
    errPasswordConfirm: "New passwords do not match.",
    // Email
    emailLabel: "Email (optional)",
    emailHint: "Used only for account recovery. We never send marketing email.",
    saveEmail: "Save Email",
    emailSaved: "Email saved.",
    errEmailInvalid: "Enter a valid email address.",
    // Server-side (REST) failures, re-localized via main.ts userFacingApiError.
    errCurrentPassword: "Your current password is incorrect.",
    errUsernameMatch: "That username does not match your account.",
    errPasswordIncorrect: "Your password is incorrect.",
    errCharactersOnline: "Log out all of your characters before deactivating.",
    deactivatedLocked: "This account has been deactivated. Contact an admin to restore it.",
    // Characters
    charactersSummary: "Manage your characters and enter the world.",
    charactersCount: "Characters: {count}",
    goToCharacters: "View Characters",
    // Wallet
    walletSummary: "Verify a Solana wallet to show holder flair on your player card.",
    manageWallet: "Manage Wallet",
    // Deactivate
    deactivate: "Deactivate Account",
    deactivateWarning: "Deactivation locks your account and signs you out everywhere. Contact an admin to restore it. Confirm by re-entering your username and password.",
    confirmUsername: "Type your username to confirm",
    confirmPassword: "Password",
    deactivateConfirm: "Deactivate My Account",
    deactivated: "Your account has been deactivated.",
    // Log out
    logOut: "Log Out",
    logOutSummary: "Sign out of this device.",
  },
};
