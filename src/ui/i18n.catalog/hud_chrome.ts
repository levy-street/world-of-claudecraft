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
  // On-screen / mobile control labels and their accessible names. char/bags/music
  // reuse existing keys (hud.keybinds.actions.*, hud.options.music) at the call site.
  mobile: {
    autorun: 'Autorun',
    jump: 'Jump',
    leaderboard: 'Ranks',
    nameplates: 'Names',
    haptics: 'Haptics',
    hapticsOff: 'Haptics Off',
    toggleHaptics: 'Toggle haptics',
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
  },
  // Click-to-move mouse-button toggle labels (Key Bindings panel). The button id
  // 0/2 maps to these at the HUD render boundary.
  options: {
    clickMoveLeft: 'Left Click',
    clickMoveRight: 'Right Click',
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
    // Interface panel: global HUD zoom slider, and the mirror of the landing
    // page's high-contrast backdrop toggle.
    uiScale: 'UI Scale',
    highContrastBackground: 'High-Contrast Background',
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
      snapshot: 'Snapshot Rate',
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
    // Value units — the digits are spliced in via formatNumber at the call site.
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
    desc: {
      str: 'Increases your attack power, so your weapon strikes land harder.',
      agi: 'Sharpens your reflexes and aim, improving several of your combat stats.',
      sta: 'Toughens your body, raising your maximum health and how quickly you recover health while resting.',
      int: "Expands a spellcaster's mana pool and improves their chance to land a spell critical strike.",
      spi: "Quickens how fast a spellcaster's mana returns while resting, out of combat.",
      armor:
        'Softens incoming physical blows. The reduction is greater against lower-level attackers and is capped at 75%.',
      attackPower: 'Powers your weapon attacks. Every 14 attack power adds 1 damage per second.',
      dps: "Your estimated weapon damage per second, combining your weapon's damage and speed with your attack power.",
      critChance: 'Your chance for an attack to strike critically, dealing double damage.',
      dodge: 'Your chance to completely avoid an incoming melee attack, taking no damage.',
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
  },
  // Default name pre-filled into the Save-Build-As dialog, e.g. "Build 3".
  talents: {
    defaultBuildName: 'Build {n}',
  },
  // One-off chat-log tips shown at HUD bootstrap. The /join command tokens stay
  // literal (they are commands); the surrounding prose localizes.
  tips: {
    joinChannels: 'Tip: type /join world or /join lfg to chat with players across the realm.',
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
  },
  // "Report a Bug" options sub-view (online only). Captures realm/character/
  // position/screenshot plus a free-text description and posts to the server.
  bugReport: {
    menuButton: 'Report a Bug',
    realm: 'Realm',
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
  // Modular bag filtering controls: the category chips, sort dropdown, and live
  // search above the bag grid, plus the "no items match" empty state.
  bags: {
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
};
