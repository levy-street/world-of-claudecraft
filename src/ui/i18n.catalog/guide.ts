// i18n source catalog - the public Guide (docs/wiki) surface served at /wiki. A curated,
// branded front-of-house that explains the game, teaches the basics, and showcases
// classes, the bestiary, quests, and group content (the standalone MediaWiki redirect
// it replaced is retired). English values only; the locale translations live in
// src/ui/i18n.locales/<lang>.ts (the runtime-authoritative overlays), filled by the
// maintainer at release.
//
// Assembled into `en` by ./index.ts under the `guide` namespace. Like hud_chrome.ts
// this module carries NO per-locale blocks (no `as const`), so a new Guide string is
// an English-only add that compiles; the translations live solely in the overlays.

export const guideStrings = {
  // Brand + shared chrome.
  brand: 'World of ClaudeCraft',
  brandShort: 'ClaudeCraft',
  tagline: 'A classic-style MMO you play free in your browser.',
  skipToContent: 'Skip to main content',
  loading: 'Loading...',
  // Browser tab title: "{page} - {brand}". Hyphen separator (not an en dash).
  docTitle: '{page} - {brand}',
  // Label for the cross-link block at the foot of a page.
  related: 'Related',

  // Top navigation + sidebar controls.
  nav: {
    overview: 'Overview',
    howToPlay: 'How to Play',
    classes: 'Classes',
    bestiary: 'Bestiary',
    models: '3D Models',
    gear: 'Gear & Items',
    professions: 'Professions',
    economy: 'Economy & Trade',
    social: 'Social & Groups',
    stats: 'Character & Stats',
    progression: 'Leveling & Progression',
    world: 'World',
    quests: 'Quests',
    dungeons: 'Dungeons & Raids',
    delves: 'Delves',
    rifts: 'Rifts',
    mounts: 'Mounts & Riding',
    reference: 'Reference',
    controls: 'Controls',
    commands: 'Slash Commands',
    interface: 'Interface & HUD',
    editor: 'World Editor',
    settings: 'Settings & Performance',
    combat: 'Combat',
    talents: 'Talents',
    arena: 'Arena & PvP',
    valeCup: 'Vale Cup',
    thornhollow: 'Thornhollow Fields',
    deeds: 'Book of Deeds',
    glossary: 'Glossary',
    wishIKnew: 'Things I Wish I Knew',
    faq: 'FAQ',
    playNow: 'Play Now',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    primary: 'Guide sections',
    topics: 'Topics',
    // Deprecated: the sidebar now uses sidebarLabel and the TOC renders guide.toc.heading,
    // so this is referenced nowhere. Kept only so existing locale overlays stay valid;
    // removing it plus its overlay rows is a maintainer chore.
    onThisPage: 'On this page',
    // Distinct landmark names: the topics sidebar must not share a label with the TOC
    // (guide.toc.heading, "On this page") or the header nav ("Guide sections").
    sidebarLabel: 'Guide topics',
    backToGame: 'Back to the game',
  },

  // Sidebar section groupings.
  groups: {
    start: 'Get Started',
    // 'compendium' is retired as a sidebar group (it grew to seventeen entries and was
    // split into world / character / endgame / compete). The key stays so the locale
    // overlays that already carry it keep resolving.
    compendium: 'Compendium',
    world: 'The World',
    character: 'Your Character',
    endgame: 'Group Content',
    compete: 'Player versus Player',
    reference: 'Reference',
  },

  // Breadcrumb trail, previous/next page sequence, and the on-this-page contents.
  breadcrumb: {
    label: 'Breadcrumb',
    home: 'Guide',
  },
  seq: {
    label: 'Page navigation',
    prev: 'Previous',
    next: 'Next',
  },
  toc: {
    heading: 'On this page',
  },

  // Footer.
  footer: {
    blurb:
      'An open-source, classic-style micro-MMO. Quest, group up, and explore a hand-built world, right in your browser.',
    playNow: 'Play Now',
    github: 'Source on GitHub',
    discord: 'Join the Discord',
    communityWiki: 'Community Wiki',
    rights: 'World of ClaudeCraft',
    linksLabel: 'Play and community links',
  },

  // Language picker.
  language: {
    label: 'Language',
    select: 'Choose a language',
  },

  // Site search (header combobox).
  search: {
    label: 'Search',
    placeholder: 'Search the guide',
    noResults: 'No matches',
    typePage: 'Page',
    typeClass: 'Class',
    typeZone: 'Zone',
    typeCreature: 'Creatures',
    typeDungeon: 'Dungeon',
    typeDelve: 'Delve',
    typeTerm: 'Term',
    typeAbility: 'Ability',
    typeDeed: 'Deed',
  },

  // Home / overview landing.
  home: {
    eyebrow: 'Classic-style browser MMO',
    title: 'World of ClaudeCraft',
    subtitle: 'Quest, group up, and explore a hand-built world, free in your browser.',
    ctaPlay: 'Play Now',
    ctaLearn: 'How to Play',

    // "What is it" benefit trio.
    what: {
      heading: 'A classic MMO, made to be picked up',
      pillarPlayTitle: 'Open the site and play',
      pillarPlayBody:
        'No download, no launcher. Make a character and you are in the world in seconds, on desktop or phone. Native apps are there if you want one.',
      pillarClassesTitle: 'Nine classes, three roles',
      pillarClassesBody:
        'Tank, heal, or deal the damage. Every class plays the way its archetype should, with talents to make it yours.',
      pillarOpenTitle: 'Free and open source',
      pillarOpenBody:
        'Free to play to the level cap, with the whole game open source. No pay to win, ever.',
    },

    // Class chooser teaser.
    classes: {
      heading: 'Choose your class',
      sub: 'Nine classic archetypes, each with its own feel and party role.',
      cta: 'Explore the classes',
    },

    // World teaser.
    world: {
      heading: 'Explore the world',
      // Superseded by subCount below (which carries a {zones} token the shipped
      // translations of this key do not have). Kept so those translations resolve.
      sub: 'One continuous land, three zones, from quiet valleys to frozen peaks.',
      subCount:
        'One continuous land of {zones} zones, from quiet valleys and drowned fens to cinder wastes, frozen heights, and hedge-maze gardens.',
      levels: 'Levels {min} to {max}',
      cta: 'See the world',
      valeName: 'Eastbrook Vale',
      valeBlurb: 'Green hills and old woods where every adventure begins.',
      marshName: 'Mirefen Marsh',
      marshBlurb: 'Sunken fens and tide-worn ruins, home to mudfins and worse.',
      peaksName: 'Thornpeak Heights',
      peaksBlurb: "Wind-scoured ridges climbing toward the realm's coldest dangers.",
      duskName: 'The Veiled Hollow',
      duskBlurb: 'A realm sealed beneath the mountains, if the whispers of a way in are true.',
      emberName: 'The Drakelands',
      emberBlurb:
        'Across the Pale Causeway the green gives way to cinder, and something old rules the wastes.',
      frostName: 'The Frostveil Reach',
      frostBlurb: 'A snowbound height beyond every map, glimpsed only in the dancing lights.',
      amberName: 'The Amberfall',
      amberBlurb:
        'Behind the western cliffs an autumn that never ends, and lanterns on a golden mere.',
      fenName: 'The Willowfen',
      fenBlurb:
        'Past the autumn crown, a bright fen of willows and still water, and a town behind a moat.',
      // The six zones the hand-written teaser list never had. Names are the sim's own
      // proper nouns; blurbs mirror the world page, cut to one line for the landing grid.
      // The Farshore shares the Vale's biome, so it carries its own slug and copy.
      farshoreName: 'The Farshore',
      farshoreBlurb:
        'An island across the sandbar, where the sky tears open over the Riftfields and Gullhaven rings its bell for every breach.',
      nightName: 'The Nightbloom',
      nightBlurb:
        'A country of starry midnight where the flowers light the paths and Moonrest keeps its vigil.',
      hauntName: 'The Wraithwood',
      hauntBlurb:
        'A haunted forest under giant canopies, where the lanterns of Gallowmere are the only honest light on the road.',
      jungleName: 'The Palmreach',
      jungleBlurb:
        'Palms, white sand, and loud birds, with the beach-town of Drifthaven keeping a fire lit on the strand.',
      gardenName: 'The Evergarden',
      gardenBlurb:
        'A hedge-maze realm still trimmed by no gardener anyone has seen, entered past Hedgewick and its fountain courts.',
      galeName: 'The Galecrest',
      galeBlurb:
        'Sea-cliffs and howling downs where the wind never rests and Wickharbor shuts its doors tight.',
      // A cap-level zone has min === max, so the two-number band would read
      // "Levels 20 to 20" on the landing grid. Five of the fourteen zones are
      // single-level, so they take this phrasing instead.
      levelsCap: 'Level {level}',
    },

    // Group content teaser.
    group: {
      heading: 'Group up for the hard parts',
      sub: 'The world is soloable, but the best loot waits behind a good party.',
      dungeonsTitle: 'Dungeons',
      dungeonsBody: 'Instanced dives for a party of five, scaling with the zones around them.',
      raidTitle: 'The raid',
      raidBody: 'A ten-player capstone for those who reach the top of the world.',
      arenaTitle: 'The arena',
      arenaBody: 'Step into the Ashen Coliseum and prove yourself against other players.',
      cta: 'Dungeons and Raids',
    },

    // Short FAQ.
    faq: {
      heading: 'Good to know',
      q1: 'Is it free to play?',
      a1: 'Yes. The whole game is free to the level cap, and it is open source on GitHub.',
      q2: 'Do I need a crypto wallet?',
      a2: 'No. The game is fully playable without one. The optional community token only adds cosmetic flair and a share of the daily rewards prize pool, and it never affects power.',
      q3: 'Can I play offline?',
      a3: 'Yes. There is an instant single-player mode in your browser, plus the shared online world.',
      q4: 'How long to reach max level?',
      // Superseded by a4Count below, for the same placeholder-parity reason as world.sub.
      a4: 'The cap is level {cap}, reached across three zones of quests, dungeons, and exploration.',
      a4Count:
        'The cap is level {cap}, reached across zones of quests, dungeons, and exploration. There are {zones} zones in all, and the farthest of them are built for characters already at the cap.',
    },

    // Community call to action.
    community: {
      heading: 'Join the world',
      body: 'Jump in now, or come say hello. The world is better with company.',
      play: 'Play Now',
      discord: 'Join the Discord',
      github: 'Star on GitHub',
    },
  },

  // How to Play / Basics (the newcomer tutorial page).
  howToPlay: {
    intro:
      'New to this kind of game? You will be questing in minutes. Here is the short version, one step at a time.',
    firstHeading: 'Your first 15 minutes',
    step1Title: 'Make a character',
    step1Body:
      'Pick a class and a look, give your hero a name, and enter the world. You can make more characters later.',
    step2Title: 'Find your first quest',
    step2Body:
      'Marshal Redbrook is waiting in the starting town with Wolves at the Door, and Foreman Odell nearby has work too. Talk to either to take your first quest.',
    step3Title: 'Move and look around',
    step3Body:
      'Move with W, A, S, D. Hold the right mouse button and drag to look around. That is most of it.',
    step4Title: 'Fight something',
    step4Body:
      'Press Tab to target the nearest enemy, then press your abilities on the bar (keys 1 through 0) to attack.',
    step5Title: 'Turn it in',
    step5Body:
      'Finish the objective, return to the quest giver (look for the marker on your map), and collect your reward.',
    step6Title: 'Keep going',
    step6Body:
      'You just hit level 2. Follow the quest trail out of town and the world opens up from there.',
    basicsHeading: 'The basics',
    resourcesTitle: 'Resources',
    resourcesBody:
      'Spells and abilities cost a resource. Warriors build Rage by fighting, rogues spend Energy that refills on its own, and everyone else casts from a pool of Mana.',
    targetingTitle: 'Targeting and your bar',
    targetingBody:
      'Tab cycles enemies, F interacts and loots, and your action bar holds the abilities you have learned. Drag spells onto it from your spellbook.',
    questsTitle: 'Quests',
    questsBody:
      'Accept quests from people with a marker over their head, complete the objective, and turn them in for experience, coin, and gear. The tracker on screen keeps your goals in view.',
    deathTitle: 'Death is not the end',
    deathBody:
      'If you fall, your body stays where it dropped and you rise as a ghost at the nearest graveyard. Run your spirit back to your body to revive on the spot, penalty free, or accept the Pale Keeper at the graveyard for an instant raise at the cost of a passing weakness. Brand-new heroes are spared the weakness entirely, and nothing you own or have earned is ever lost. The game also tells you what did it: a line in your chat names whatever landed the killing blow, which is usually the quickest way to work out what went wrong.',
    groupingTitle: 'Playing together',
    groupingBody:
      'Invite others to a party to share quest credit and take on dungeons. Most of the world is soloable, so grouping is a choice, not a chore.',
    onlineTitle: 'Online or offline',
    onlineBody:
      'Play the shared online world with everyone else, or start an instant offline world in your browser to learn the ropes.',
    reassure:
      'Talents start at level 5, and there are six rows in all, one each at levels 5, 8, 11, 14, 17, and 20. Every row is a single pick of three, and you can reset whenever you are out of combat and not in an arena or battleground match, so your early choices are never permanent. Experiment freely.',
    controlsLink: 'See the full controls reference',
    // Step 0 leads the list; the existing step1 to step6 keys keep their numbers so the
    // locale fills that already exist stay valid.
    step0Title: 'Get in',
    step0Body:
      'Offline play asks for nothing: choose Offline on the start screen and press Play. To play with everyone else, make a free account (a username, a password, and an email address for recovery) or sign in to the one you have, then pick a world from the World List.',
    worldsTitle: 'Choosing a world',
    worldsBody:
      'Online play happens on worlds, and each one is a full copy of the game with its own players, its own World Market, and its own standings. The World List shows how busy each world is, from Low to Full, so pick a quiet one for elbow room or a busy one for company. Your characters live on the world you made them on, and you can keep characters on more than one.',
    charactersTitle: 'Your characters',
    charactersBody:
      'One account can keep up to ten characters on each world, so there is room to try several classes without giving anything up. Deleting one is deliberate: the character has to be out of the world, and the game asks you to type its name before it will go. A deleted character is gone for good, and its World Market listings and Ravenpost mail go with it.\n\nOnce you have picked a class you get to decide what your hero looks like. A tabbed panel holds Body, Face, Hair, and Style: pick male or female, work the face over with a set of sliders and a choice of eyes, then choose a hair style and color and a skin tone, either from the named presets or from the color wheel behind them. A randomize button rolls a whole look if you would rather be surprised, and a reset puts your character back to the standard face for the body you chose. None of it touches how your character plays.',
    namesTitle: 'Naming your hero',
    namesBody:
      'A name is 2 to 16 letters long, starts with a letter, and can hold spaces, hyphens, and apostrophes. No two characters on the same world can share one, and capitalization does not make a name free: if Ashwind is taken, ashwind is taken too. Your own spelling is kept exactly as you typed it. Pick a name you will be happy with, because it stays with the character.',
    connectionTitle: 'If your connection drops',
    connectionBody:
      'A lost signal, a closed lid, or a page reload does not log you out. Your character is held in the world for about five minutes while the game reconnects on its own, and you come back to the same spot in the same session. That also means dropping out is not a way to leave a fight: your character is still standing there. Logging out from the game menu leaves at once instead of waiting, and so does signing in on another character on the same account.',
  },

  // Controls reference (most action labels reuse the shared controls.* catalog).
  controls: {
    intro:
      'Default keys for desktop. Every binding here can be changed from the Key Bindings panel in the game menu, except Esc, which always opens that menu. Each action holds up to two keys, a main one and an alternate, and a binding can be a modifier combo like Shift+Z. It can also be a mouse button: the middle button is M3 and the thumb buttons are M4 and M5, with any further buttons counting up from there. Left and right click stay reserved for the camera, click to move, and clicking things in the world.',
    keyHeader: 'Key',
    actionHeader: 'Action',
    groupMovement: 'Movement',
    groupCombat: 'Targeting and combat',
    groupInterface: 'Interface',
    groupCamera: 'Camera',
    talents: 'Talents',
    professions: 'Professions',
    arena: 'PvP window (the arenas and Thornhollow Fields)',
    leaderboard: 'Leaderboard',
    deeds: 'Book of Deeds',
    sheathe: 'Sheathe/Unsheathe Weapon',
    crafting: 'Crafting',
    valeCup: 'Vale Cup',
    mount: 'Mount / Dismount',
    calendar: 'Event Calendar',
    dungeonFinder: 'Dungeon Finder',
    discord: 'Discord',
    abilities: 'Use action bar abilities (the number row; a second bar sits on the numpad)',
    targetFriendly: 'Target nearest friendly',
    cycleFriendly: 'Cycle friendly target',
    targetAuras: 'Target buffs and debuffs',
    gameMenu: 'Open game menu and options',
    bothMouse: 'Both Mouse Buttons',
    runForward: 'Run forward',
    arrowKeys: 'Arrow Keys',
    groupPet: 'Pet commands',
    petBar:
      'Pet bar: Attack, Stop, Taunt, Defensive, Aggressive (with a hunter or warlock pet out)',
    attackMoveNote:
      'Attack Move stays off until you switch it on: open the Key Bindings panel, turn it on, and the A row above starts working. With the cursor over the game world, it walks you toward the cursor and opens up on the enemy under it, or on the first hostile you meet along the way. While the option is on, A issues that attack move instead of turning left, so turn with the left arrow key, which Turn Left also carries by default, or give Turn Left a key of your own.',
    mobileHeading: 'On mobile',
    mobileBody:
      'Touch controls appear automatically on phones and tablets: a movement stick on the left, drag anywhere else to look, pinch with two fingers to zoom the camera, and on-screen buttons for your abilities and menus. A small arrow in the top left corner shows or hides the menu buttons, and the More button there holds the rest of your windows.',
    controllerHeading: 'On a controller',
    controllerBody:
      'Gamepads work too, and controller support is on by default. The left stick moves, the right stick aims the camera, and the face and shoulder buttons cover your abilities, jumping, and interacting. Open a window like your bags to bring up an on-screen pointer, and the game menu navigates directly with the D-pad and face buttons. You can remap the buttons and adjust stick deadzone, camera speed, vibration, and inverted look from the controller settings in the options, where a button can also be bound to zoom the camera in or out (unbound by default).',
    // Second default of the four movement actions (ArrowUp/Down/Left/Right in
    // src/game/keybinds.ts); the key glyph reuses the existing controls.arrowKeys.
    moveAlt: 'Move and turn (the same four actions, on their second key)',
    jumpSwim: 'Jump, and swim up while you are in the water',
    swimDown: 'Swim down while you are in the water (hold)',
    swimNote:
      'Swimming uses two keys: hold Space to rise and LCtrl to sink. Aiming the camera down while you swim forward dives as well, so you can steer your depth with the view. LCtrl is the one default that is a modifier key on its own, and a lone modifier press is ignored while you are binding, so pick a key that is not a modifier if you rebind Swim Down.',
    bgFlag: 'Take the enemy flag in Thornhollow Fields',
    attackMove: 'Attack Move (only once you switch the option on)',
    meters: 'Damage meters (damage, healing, and threat)',
    petMark: 'Pet: Mark, select your own pet (the same as clicking its frame)',
    onBarBinding:
      'You can also bind straight from the bar: choose Edit action bar keys in the Key Bindings panel, then click a slot on the live bar and press the key you want. Click Done when you are finished. This one is desktop only, since it needs a physical keyboard.',
    clickMoveNote:
      'Click to Move is off until you switch it on: open the Key Bindings panel in the game menu, turn on Click to Move, then use the Click Move Button row under it to choose which mouse button does the walking (Left Click by default, or Right Click). Once it is on, clicking a spot on the ground sends you walking there, with a marker on the ground showing where you are headed. Clicking a creature or another player walks you over to them and stops in range, while that click still does its usual job of targeting or interacting; if you are already close enough to reach what you clicked, you simply interact and stay where you are. Any of the movement keys takes control straight back and ends the trip, and so does holding the mouse button to look around. Jumping does not, so you keep travelling through the hop, and opening the game menu only pauses the trip, which carries on when you close the menu.',
  },

  // Settings & Performance reference. Option and value NAMES reuse the game's own
  // hud.options.* / hudChrome.* keys (already localized); only the surrounding prose
  // lives here. Plain-language behavior and costs, no engine jargon or internals.
  settingsPage: {
    heading: 'Settings & Performance',
    intro:
      'Make the game look its best or run its fastest. Three ready-made loadouts, plus what every graphics option really does.',
    wherePath:
      'Everything on this page lives in the game: press Esc to open the game menu. It lists the panels as buttons: Key Bindings, Controller, Graphics, Interface, Auras, Audio, and Performance Overlay, with Wiki, Unstuck, Log Out, and Return to Game below them, and Report a Bug joining the list while you are playing online. Graphics and Interface hold almost everything described here.',
    fairnessTitle: 'Fair by design',
    fairnessBody:
      'No option here trades beauty for power. Lower settings shed cosmetic polish only, never information you fight with: your debuffs, cast bars, party health, and damage numbers are identical from Low to Insane. Playing on a modest machine is never a handicap.',
    loadoutsHeading: 'Three ready-made loadouts',
    loadoutsIntro:
      'Start from the loadout that sounds like your machine, then adjust one option at a time until it feels right.',
    recommended: 'Recommended',
    whyLabel: 'Why it works:',
    tagReload: 'press Apply',
    fpsTitle: 'Best FPS',
    fpsTagline: 'For older laptops, integrated graphics, and battery play.',
    fpsWhy:
      'Graphics Quality is the master switch, and Render Quality is the strongest slider: at 70% the world draws roughly half the pixels while the interface stays perfectly sharp.',
    balancedTitle: 'Balanced',
    balancedTagline: 'The sweet spot for most machines, and our default advice.',
    balancedWhy:
      'Medium brings real shadows and full materials, and High adds ambient occlusion and bloom on top. The built-in safety net stays armed on every tier, so Balanced rides out a busy fight without you babysitting it.',
    visualsTitle: 'Best Visuals',
    visualsTagline: 'Screenshot mode for powerful desktop machines.',
    visualsWhy:
      'Ultra renders at the highest resolution your display offers with the richest lighting. Above it sits Insane, the everything-on showcase: you have to choose that one by hand, because the game never picks it for you no matter how strong your machine is.',
    value50to70: '50 to 70%',
    value90to100: '90 to 100%',
    value100: '100%',
    valueHighOrMedium: 'High on a gaming PC, Medium on a laptop',
    valueOnOptional: 'On (optional)',
    howHeading: 'How the options behave',
    factDetectTitle: 'The game tunes itself first',
    factDetectBody:
      'On your first launch the game reads your device and stores a sensible tier for you. Every phone and tablet starts on Low so you can get straight into the world, and so does an old or software graphics card. A strong desktop starts on Ultra, or High when the machine looks short on memory. Anything the game cannot place stays on Medium. Any choice you make yourself always wins, and it sticks.',
    factReloadTitle: 'Two kinds of options',
    factReloadBody:
      'The Graphics panel edits a draft. Change Graphics Quality or any of the detail dials, then press Apply and the game rebuilds the world where you stand, no reload. The line beside the button tells you when it has landed. Every other option, in that panel and everywhere else, applies the moment you change it, and only a rebuild that fails outright offers you a Reload button instead.',
    factGovernorTitle: 'A built-in safety net',
    factGovernorBody:
      'Every tier keeps a safety net armed: when a big fight spikes, the game quietly thins grass, effects, and lighting for a moment, then restores them. Ultra and Insane simply wait much longer before they do it, so a premium preset is never disturbed by a single slow frame.',
    factSearchTitle: 'Where a setting lives',
    factSearchBody:
      'There is no search box, so it helps to know the shape of the menu. Graphics is laid out as cards: Quality, World Detail, Lighting & Effects, Camera, Display, and System, plus Touch Controls on a touchscreen. Interface is split into four tabs: General, Frames, Chat, and Combat. If a setting changes how the world is drawn it is in Graphics, and if it changes what the interface shows you it is in Interface.',
    advancedHeading: 'The detail dials and the Advanced mix',
    advancedBody:
      'You do not have to pick Advanced to see the detail dials. The Graphics panel always shows them, in two cards: World Detail holds Terrain Detail, Foliage Density, Surface Detail, View Distance, Water Quality, and Character Detail, and Lighting & Effects holds Effects & Lighting, Shadow Quality, Ambient Occlusion, Bloom, Anti-Aliasing, Dynamic Lights, and Particle Effects. Under a fixed preset each dial shows roughly where that preset sits.',
    advancedMixes:
      'Two favorite mixes: keep Shadow Quality high and set Effects & Lighting to Low for a crisp, glow-free look that runs light, or do the reverse to keep the bloom and soften the shadows. One thing to know before you mix: Ambient Occlusion, Bloom, and Anti-Aliasing ride the same chain as Effects & Lighting, so with that dial on Low they have nothing to run on.',
    tableHeading: 'Every graphics option, explained',
    colSetting: 'Setting',
    colDoes: 'What it does',
    colImpact: 'FPS impact',
    impactNone: 'None',
    impactLight: 'Light',
    impactModerate: 'Moderate',
    impactHeavy: 'Heavy',
    rowGraphicsQuality:
      'The master switch. Each step changes resolution, shadows, materials, foliage, and lighting effects together. The biggest single difference you can make.',
    rowRenderQuality:
      'Draws the 3D world at a lower internal resolution and scales it up; the interface stays sharp. The strongest instant slider on weaker machines and high-resolution screens.',
    rowFieldOfView:
      'How much of the world fits on screen, from a zoomed 55 to a sweeping 100 degrees. A comfort choice; wider views draw slightly more.',
    rowBrightness: 'Scene exposure, darker or brighter. Pure preference.',
    rowWeather:
      'Ambient rain and snow. Atmosphere only, and switching it off saves a little during storms.',
    rowBrowserEffects:
      'How fancy the interface itself is allowed to be: glass blur, glow, animated menus. Auto matches your browser; the 3D world is untouched either way.',
    rowTerrainDetail: 'Rich, blended ground textures versus a simpler, faster terrain look.',
    rowFoliageDensity: 'How far and how thick the grass grows around your character.',
    rowEffectsQuality:
      'Bloom, ambient occlusion, and how many torches and spells cast real light. The single biggest saving among the detail dials, and the switch the other lighting dials depend on.',
    rowShadowQuality: 'Shadow crispness. Low keeps shadows but softens their edges.',
    rowFrostedPanels:
      'A frosted-glass blur behind windows. Pretty, and exactly the kind of effect a weaker browser feels; leave it off for the classic crisp look.',
    rowReduceMotion:
      'Removes interface animations so windows appear instantly. An accessibility option first, with a small performance bonus.',
    rowPerfOverlay:
      'An on-screen readout of FPS, frame time, and more. Turn it on while you tune this page, then hide it again.',
    tableFoot:
      'Looking for an FPS cap? There is nothing to hunt for: frame pacing follows your display. Draw distance is a dial of its own, View Distance, in the World Detail card, and each preset sets it for you until you move it.',
    mobileTitle: 'On phones and tablets',
    mobileBody:
      'On a phone or tablet the game starts you on Low. Every touch device lands there on its first launch, on purpose, so you can get into the world and play; raise it yourself from the Graphics panel any time. On an Android browser the whole ladder is open to you and your choice sticks. On iPhone and iPad you can still pick the top presets and they take hold as soon as you press Apply, but the game sets you back to High the next time you launch, because iOS can end the tab while a scene that large is being built. The downloaded app is shorter still: its preset list stops at High and the per-system dials are hidden, because the app manages those itself.',
    touchBody:
      'On a touchscreen the Graphics panel grows a Touch Controls card of its own: joystick size and deadzone, on-screen button size, control opacity, an optional camera stick, a left-handed mirrored layout, and inverted touch look, so the screen fits your hands rather than the other way around.',
    // Non-graphics options: the Audio tab and the live language picker.
    audioTitle: 'Sound and language',
    audioBody:
      "The options window is not all pixels. Audio holds three volume sliders, for sound effects, music, and voice, plus a music on and off switch and four switches for the sounds that most often wear thin: NPC voices, footsteps, interface sounds, and click feedback. The Interface panel's General tab carries a language picker that relocalizes the whole interface on the spot, no reload needed, and a theme picker for the window dressing.",
    autolootBody:
      "Prefer not to click every corpse? Walk-by Autoloot, on the Interface panel's Combat tab and off by default, scoops the loot from your own kills as you walk past them.",
    // The two panels the tables do not cover (Auras, Performance Overlay), named
    // right under the menu list so nobody assumes the page is the whole menu.
    panelsMoreBody:
      'The two panels this page does not table are worth a look anyway. Auras is where you shape the big on-screen alerts that fire when one of your class procs comes up: which ones show, their size, color, opacity, and where they sit on screen. Performance Overlay is the readout you turn on while you tune this page, then hide again.',
    // The Best Visuals loadout's quality row now names the top of the ladder.
    valueUltraOrInsane: 'Ultra, or Insane if you want everything',
    // Second paragraph of the detail-dials section: what editing a dial does.
    advancedLadder:
      'Move any one of them and the quality preset switches to Advanced, seeded from exactly the levels you were looking at, so your custom mix starts from what you already saw rather than from scratch. Press Apply when you like it. Advanced sits at the end of the preset list for that reason: it is the expert profile where your own mix lives.',
    // Graphics rows the table did not carry: the rest of the World Detail and
    // Lighting & Effects dials, the Camera card, and the Display/System rows.
    rowSurfaceDetail:
      'The worn detail layer on stone and paving, from off to a full parallax finish. It is the town-street dial: the more of it you keep, the busier a paved street is to draw.',
    rowViewDistance:
      'How far into the distance the world is drawn before it fades out. Each preset sets it for you until you move it yourself.',
    rowWaterQuality:
      'How lakes, rivers, and the open sea are shaded, from flat and cheap to fully reflective.',
    rowCharacterDetail:
      'How far away other characters keep their full animated rig before they drop to a simpler one. Higher is kinder to the eye in a crowded hub, and heavier.',
    rowAmbientOcclusion:
      'The soft contact shadow where surfaces meet. Off, half resolution, or full.',
    rowBloom: 'The gentle glow around bright light, fire, and spell effects.',
    rowAntiAliasing:
      'Smooths the jagged edges of distant geometry. Cheap, and worth keeping on most machines.',
    rowDynamicLights:
      'How many torches, campfires, and spells cast real light into the scene around them.',
    rowParticleEffects:
      'How thick the spell, weather, and ambient particle work is allowed to get.',
    rowCameraSpeed: 'How quickly the camera swings when you look around with the mouse.',
    rowTouchLookSpeed:
      'The same thing for swipe-look, and it only appears when you are on a touchscreen.',
    rowFullscreen: 'Fills the whole screen with the game.',
    rowWaterRipples:
      'Wakes and ripples that spread out behind you as you swim. Off by default, and the one water effect that costs real frames; splashes and bubbles are unaffected either way.',
    rowOverflowXp:
      'At maximum level, whether your bar keeps filling with overflow experience or shows the classic static max-level text instead.',
    rowInterfaceMode:
      'Whether you get the desktop interface or the on-screen touch controls. Auto reads your device, and you can force either one: a tablet with a keyboard can take the desktop layout, and a touchscreen laptop can take the touch controls.',
    // The Interface panel section: an intro, one block per tab, and a foot note
    // that says plainly the tables are a selection, not the full list.
    interfaceHeading: 'The Interface panel',
    interfaceIntro:
      'Interface is the biggest panel in the game, and it is split into four tabs. Nothing in here changes what the world can do to you: it changes what you are shown and how large it is. These are the rows most worth knowing about.',
    interfaceFoot:
      'That is not all of them. Every tab carries more sliders and switches than are worth tabling here, so open it once and read down the list. It is five minutes well spent.',
    ifGeneralIntro:
      'Scale, contrast, and what the interface shows about you. The language and theme pickers sit at the top of this tab too.',
    ifFramesIntro:
      'Your own frame, your target frame, and the whole party layout. The party cluster also carries scale, width, height, spacing, and column sliders so a raid grid fits your screen, and a Reset button at the foot of the tab puts every frame back where it started.',
    ifChatIntro:
      'How the chat window reads. A reset for the chat windows themselves lives here as well.',
    ifCombatIntro: 'How your bars behave and what combat puts on screen.',
    ifUiScale:
      'Scales the whole interface at once. It lands when you let go of the slider, so the window under your cursor does not move while you drag it.',
    ifHudOpacity: 'How solid the HUD panels are over the world behind them.',
    ifTooltipScale: 'Tooltip text size, handy on a small screen or a very large one.',
    ifHighContrastText:
      'Heavier, higher-contrast interface text. An accessibility option first, and a good one on a bright screen.',
    ifHighContrastBackground:
      'A plainer, higher-contrast background behind the start and character screens.',
    ifInvertLookY: 'Flips the up and down direction of mouse look.',
    ifShowItemLevel:
      'Adds an item level line to every item tooltip. Off by default, which keeps the classic stat-only tooltip.',
    ifShowPlaytime:
      'Shows your lifetime time played on the character sheet. On by default, and the sheet has an eye button that flips it per device, which is handy if you stream or take screenshots. The total keeps counting either way.',
    ifShowOwnNameplate:
      'Draws your own overhead nameplate exactly as other players see it, flair and all. Turn it off for the classic view.',
    ifShowPlayerNameplates:
      'Draws other players nameplates. Off declutters a crowded hub, and your current target stays readable either way.',
    ifWallet:
      'Whether your wallet is shown on the character screen. There is a matching switch for the player card.',
    ifDailyChest: 'Whether the daily rewards chest sits on your HUD.',
    ifPlayerFrameScale: 'The size of your own unit frame.',
    ifTargetFrameScale: 'The size of your target frame.',
    ifPartyStyle:
      'The party layout: Automatic follows your group size, Classic is the traditional stack, and Raid packs everyone into the compact grid.',
    ifPartyHealthText:
      'What the party bars print: nothing, a percentage, current health, or current and maximum.',
    ifPartySort: 'The order party members are listed in: group order, role, or name.',
    ifPartyShowAuras:
      'Whether buffs and debuffs show on the party frames. Matching switches cover resource bars, absorbs, pets, and whether you appear in your own party list.',
    ifAurasOnPlayerFrame:
      'Puts your buffs and debuffs on your own unit frame as well as the aura bar.',
    ifTargetOfTarget:
      'Shows who your target is targeting, the classic way to tell whether the tank still has it.',
    ifPetFrame: 'Shows a frame for your pet.',
    ifChatFontScale: 'Chat text size.',
    ifChatOpacity: 'How solid the chat background is.',
    ifCompactChat: 'Tightens the chat lines so more of them fit.',
    ifChatTimestamps: 'Adds a time to each chat line, in 12-hour or 24-hour form.',
    ifStartAttack:
      'Whether using an ability also starts your auto-attack. On by default, and the classic behavior most players expect.',
    ifStopAutoAttack:
      'Whether switching targets stops your swing. Off by default, so your attack carries over to the new target.',
    ifShowAttackButton: 'Puts an explicit Attack button on your action bar.',
    ifWalkByAutoloot: 'Scoops the loot from your own kills as you walk past them. Off by default.',
    ifGroundReticle: 'Shows the ground circle while you are aiming a placed spell.',
    ifMouseoverCast:
      'Lets a heal or a friendly spell land on the party frame you are hovering, without changing your target.',
    ifStickyTarget:
      'Keeps your current target when you click on empty ground, instead of clearing it.',
    ifFctScale: 'The size of the damage and healing numbers that float off your target.',
    ifExtraBars:
      'Reveals a second action bar row, and a third once the second is on. The slots stay reachable by their keybinds even while the rows are hidden.',
    ifHideUnused: 'Hides empty action slots so only the buttons you actually use are drawn.',
    ifLockBars: 'Locks your bars so you cannot drag an ability out of a slot by accident.',
    // The Key Bindings panel: what lives there besides the key list.
    keybindsHeading: 'The Key Bindings panel',
    keybindsBody:
      'The key list is only half of that panel. Above it sit the switches that decide how your mouse drives the game: mouse camera, whether the cursor locks while you rotate, click to move and which mouse button triggers it, attack move, the left-handed touch layout, and the profanity filter for chat.',
    keybindsMouseBody:
      'Two things there are easy to miss. Mouse buttons bind like keys, so the wheel click and the thumb buttons can carry abilities, while left and right click stay reserved for the camera and for clicking on the world. And you can bind straight from the action bar: turn on the on-bar binding mode here, then click a slot and press the key you want.',
  },

  // Combat overview. Deliberately high level: concepts, not formulas or numbers, so
  // there is nothing here to min-max or exploit.
  combat: {
    intro:
      'Combat follows familiar classic-MMO rules. You never need to study any of it to play well, this is just the shape of how fights work.',
    hitTitle: 'Not every blow lands',
    hitBody:
      "Attacks can miss, and they can be dodged, and the enemy's can too. Two more answers belong to players alone: a warrior can turn a blow aside with a parry, and a warrior or paladin holding a shield can blunt one into a block, both only against what comes at them from the front. The creatures of the world do neither, so a swing at a monster either lands, misses, or is dodged. Spells play by their own rule and never miss at all: they are resisted instead. Fighting close to your own level is what keeps your hits connecting; the wider the level gap, the more you swing at air.",
    mitigationTitle: 'Armor and health keep you standing',
    mitigationBody:
      'Armor softens physical hits, so better armor is your main source of staying power in melee. Magic is another matter: you weather spells with a deeper health pool and the chance to resist one outright, not with armor. Heavier armor classes shrug off more, but nothing makes you untouchable.',
    resourcesTitle: 'Every class has its own rhythm',
    resourcesBody:
      'Warriors build Rage in the thick of a fight, rogues spend Energy that steadily returns, and casters manage a pool of Mana. Learning your resource is half of playing your class well.',
    growTitle: 'You grow stronger every level',
    growBody:
      'Each level makes you tougher and unlocks new abilities, all the way to the cap of level {cap}. Questing is the fastest way up; hunting, dungeon runs, delves, and the professions you work as you travel round it out.',
    // Status effects: buffs, debuffs, damage over time, crowd control with diminishing returns.
    effectsTitle: 'Buffs, debuffs, and crowd control',
    effectsBody:
      'Many abilities apply an effect that lingers. Helpful ones (buffs) raise your stats, shield you, or heal you a little at a time; harmful ones (debuffs) drain your health with damage over time or weaken you. Watch the small icons in the top corner of the screen, beside the minimap, to see what is on you and how long it lasts.',
    ccBody:
      'Crowd control is a special kind of debuff that limits what a target can do: stuns, roots and slows, silences that stop spellcasting, disarms, fears, and transformations that turn a foe harmless for a moment. Against other players most control wears thin with repetition: fears, polymorphs, roots, and spell-school lockouts reapplied too quickly grow shorter and then fail outright, so nobody can be held helpless forever. Stuns are the deliberate exception, since they are already short and sit behind real cooldowns, so repetition never shortens them, though gear that cuts control durations still trims them. The creatures of the world hold no such grudge: control never weakens with repetition against them, though many of the mightiest foes, named elites and the strongest bosses among them, cannot be controlled at all.',
    metersBody:
      'Curious how a fight went? Press Shift+H to open the party meters, which tally damage, healing, and threat for your group, encounter by encounter.',
    // The one-slot ability queue: a press mid-cast is held and fired at cast end.
    queueTitle: 'Your next move is already loaded',
    queueBody:
      'You do not have to time your presses to the frame. Press your next ability in the closing moments of the current cast and it is queued, firing the instant the cast completes, so practiced play flows without gaps. A press too early is simply refused, so nothing is wasted. Some melee strikes work the same way, riding out on your next weapon swing.',
    // Death and recovery: light penalty, no lost progress.
    deathTitle: 'When you fall',
    deathBody:
      "If your health reaches zero you are downed where you stand, and your body stays there. Release your spirit and you rise as a ghost at the nearest graveyard: faster on its feet than the living, beyond the reach of your enemies, but unable to fight, loot, or speak with anyone except the Pale Keeper hovering over the stones. From there you choose. Run your ghost back to your body and you revive on the spot with part of your health and mana restored and no penalty at all. Or take the Pale Keeper up on an instant raise where you stand, at the price of the Keeper's Toll: a temporary weakening of all you are that lasts longer the more seasoned you are, and spares brand-new characters entirely. Fall inside a dungeon and your spirit waits at the graveyard outside; walk your ghost back through the door and you revive at the entrance. Delves are the exception: fall there and you are simply set back on your feet at the delve's entry, though a second fall ends the run. Either road, you lose no experience, gear, or coin. Between fights, sit to eat and drink so you start the next one at full strength.",
    // Threat: how an enemy picks who to hit (src/sim/threat.ts, and the healing
    // split in src/sim/combat/heal.ts, which keys on the HEALED target's hate
    // tables, not on party membership).
    threatTitle: 'Who the enemy hits',
    threatBody:
      "Every enemy keeps a private tally of who has annoyed it most. Damage adds to it, and so does healing: a heal puts threat on the enemies already fighting the person you healed, shared out between them, so the safest heal is one on someone the tank has already taken hold of. Tanks turn on a guarded stance or a protective form that multiplies everything they generate, while the druid's Wolf Form sheds threat instead, and a taunt lifts the caster straight to the top of the tally and pins the enemy on them for a few seconds. Enemies do not switch the instant somebody passes the tank: it takes a clear lead to pull one off, and a bigger lead at range than in melee, so a little patience at the start of a pull keeps the fight where it belongs.",
    // Environmental hazards. Both are number-free by design: breath drain and the
    // drown pulse live in src/sim/breath.ts, the open-sea clock in src/sim/fatigue.ts.
    hazardsTitle: 'The water can kill you',
    breathBody:
      'Deep water is swimmable, and you can dive under it. While your head is under, a blue breath bar appears near the top of the screen and drains; break the surface and it refills far faster than it emptied. Let it empty while you are still under and you begin to drown, losing a chunk of your health every second until you reach air, so keep an eye on the bar on a long dive. Death clears it, so a corpse run always starts with a full lungful.',
    fatigueBody:
      'The sea has no wall. The crossings the world means you to swim, the straits and meres between one stretch of land and the next, and the inland lakes, are safe to cross however long they take. Strike out past the shore into genuinely open water instead and it starts to sap your strength: a warning appears, you get a real window to turn around, and after that the sea deals steadily heavier damage that nothing can prevent until you head back toward land. Drown or wear yourself out that far from shore and you release like any other death, so treat the horizon as scenery rather than a destination.',
    // Player-cast resurrection: an accept-or-decline offer, excluded in the battleground.
    allyRezTitle: 'When an ally can raise you',
    allyRezBody:
      "You do not always have to walk back. An ally with a resurrection spell can raise you instead, and it comes to you as a prompt you accept or decline; leave it sitting and it expires, so answer it while it is there. Accept and you rise beside the friend who cast it with part of your health and mana back. Some healers can offer the whole downed party at once, though each of you still answers your own prompt. Thornhollow Fields is the exception: no resurrection spell reaches you there, and you wait for your team's next wave.",
    // The /unstuck recovery command and Unstuck Sickness.
    unstuckTitle: 'When you are truly stuck',
    unstuckBody:
      "If the world traps you somewhere you cannot get out of, type /unstuck. You need to be out of combat and standing still, not held by a stun or a root, and not in a duel or an arena match: a short countdown runs, and moving or taking damage cancels it. When it finishes you are set down at the nearest graveyard. It never kills you and it leaves no corpse, and if you were already down it raises you there instead. The price is Unstuck Sickness, a temporary weakening of all you are that has worn off by the time you could use the command again, and like the Keeper's Toll it spares brand-new characters entirely.",
    // The ledge climb (src/sim/climb.ts): the scripted pull-up that ends a jump on a
    // lip above the head. A movement MODE, so it owns motion while it runs, a stun
    // drops it, and a stunned or rooted body cannot start one.
    climbTitle: 'Pulling yourself up a ledge',
    climbBody:
      'Ledges are not walls. Jump at something too tall to step onto and your character catches the lip near the top of the jump and hauls up onto it, with no key of its own to press. Anything low enough to clear on your own goes by without ceremony; the full pull-up is saved for lips above your head. It is brief, and it takes the reins while it runs, so you cannot steer out of it partway. A stun catches you mid-pull and you let go and fall, measured from where the jump left the ground, and a stun or a root stops a climb starting at all, which is worth remembering when you are trying to get out of a bad spot in a fight.',
  },

  // Glossary.
  // Interface & HUD reference: what each part of the screen is and which window each
  // key opens. The Controls page stays the key table; this is the map of the screen.
  interfacePage: {
    // Interface & HUD reference: a map of the screen. Not a second key table (the
    // Controls page owns that) and not an options tour (the Settings page owns
    // that). Multi-paragraph bodies separate paragraphs with '\n\n' and render
    // through the shared paras() helper. Facts mirror index.html's #ui markup,
    // src/styles/hud.css anchors, src/game/keybinds.ts defaults, and the owning
    // modules under src/ui/ and src/ui/hud/.
    intro:
      'A map of the screen: what every frame, bar, and button on your interface does, and which window each key opens.',
    scopeTitle: 'Keys, and where to change them',
    scopeBody:
      'Every key named on this page is the default, and every one of them can be rebound. The full key table lives on the Controls page, and the options that change how the interface looks and behaves live on the Settings page. Esc closes whatever window is on top, and opens the game menu when nothing is open.',

    glanceTitle: 'The screen at a glance',
    glanceBody:
      'The interface lives around the edges of the screen and leaves the middle clear for the world. Your own frame, your action bars, and your experience bar sit along the bottom. Your target and your party sit in the top left. The minimap and the zone name sit in the top right, with your trackers running down the right side below them. The chat box sits in the bottom left corner, and a rail of small square buttons sits in the bottom right.\n\nEverything else is a window you open and close. Most windows have a key of their own, most also have a button in that rail in the bottom right, and every one of them closes with its own key again or with Esc.',

    framesTitle: 'Unit frames',
    framesBody:
      "A unit frame is a portrait with bars beside it: a health bar always, a resource bar when the unit has one, and a name and a level chip. A damage shield paints as a lighter segment laid over the top of the health bar, so you can watch the shield spend itself before the health starts to move. It shows on your own frame, on your target, and on your party rows; the two small frames, your pet and your target's target, carry no shield overlay.",
    frameSelfTitle: 'Your own frame',
    frameSelfBody:
      'Bottom center, next to your action bars. Portrait, level, health, and your resource, with a mark while you are in combat, a resting mark while you are resting, and a row of combo points for the classes that build them. Clicking the frame targets yourself.',
    frameTargetTitle: 'Your target',
    frameTargetBody:
      'Top left, appearing the moment you select something and gone again when you drop it. The same portrait and bars, plus an Elite tag on the tougher enemies, a cast bar showing what your target is casting, and a strip of the effects that are on it.',
    frameTotTitle: "Your target's target",
    frameTotBody:
      'A small frame beside your target frame showing who your target is currently on. It is the quickest way to tell whether a monster is fighting your tank or coming for you. It stays hidden until you switch it on in the options.',
    framePartyTitle: 'Your party',
    framePartyBody:
      'Party members stack under your target frame on the left, one row each. A row dims when that member walks out of range, shows the effects worth reacting to, and can show their pet beside them. How much health text a row carries is up to you: none, a percentage, the numbers, or both.',
    framePetTitle: 'Your pet',
    framePetBody:
      'Hunters, warlocks, and anyone else with a pet out get a small frame for it beside their own, with its name, level, and health. Clicking that frame selects your pet, and Ctrl+6 does the same from the keyboard.',
    framesMoveBody:
      'Your frame, your target frame, and your party frames can all be moved. Each carries a small move button in its corner: unlock it, drag the frame where you want it, and lock it again so a stray click cannot shift it. If they end up somewhere you regret, Reset Frame Positions in the options snaps them all back to where they started.',

    barsTitle: 'Bars, timers, and combat text',
    barsBody:
      "Your cast bar appears in the middle of the screen, just above your action bars, whenever you cast or channel, and carries the spell's name and the time left. Your target gets a cast bar of its own on its frame, so you can see what is coming and answer it.\n\nA thin swing bar sits under your cast bar and fills between your weapon swings, so a melee or ranged attacker can see when the next automatic hit lands.\n\nYour experience bar runs the full width under your action bars, ticked into segments, with a lighter stretch showing the rested experience you have banked.\n\nSwim under water and a blue breath bar appears at the top of the screen. It drains while your head is under, flashes red once it runs out and you begin to drown, and refills quickly the moment you surface. Space swims you up, and the Swim Down key, Ctrl by default, takes you deeper.\n\nDamage and healing float up over whatever they landed on as small numbers, so you can read a fight without reading text. The Combat tab in your chat box keeps the full written record.",

    aurasTitle: 'Buffs and debuffs',
    aurasBody:
      "Your own buffs show as a row of small icons in the top right corner beside the minimap, each counting down the time it has left, with your debuffs in a row below them. Right-clicking one of your own buffs drops it, as long as it is one you are allowed to drop; debuffs never are, and your target's strip is read-only.\n\nBuffs on the Player Frame, an option that is off to begin with, moves your buff row onto your own unit frame and leaves the whole corner to your debuffs. It is a desktop setting: the phone and tablet layout places your auras for you.\n\nYour target's buffs and debuffs sit together in a strip under its frame. When you want more room for them, Shift+J opens a separate Target Buffs and Debuffs window that you can move, filter down to just buffs or just debuffs, and leave open.",

    actionBarsTitle: 'Your action bars',
    actionBarsBody:
      'Three rows of eleven ability slots sit above your experience bar, with a dedicated attack button at the head of the first row. Only the first row is there to begin with: the second and third are switched on in the options when you want the room, and the third needs the second. The number row across the top of your keyboard fires the first bar, and the extra bars default to the numpad.\n\nAbilities come from your spellbook (P): drag one out of the book onto a slot, or use the toggle on its row to put it on the first free one. Items work the same way, so a stack of potions or a bandage can live on a slot and be used with a key.\n\nOnce a bar is arranged the way you like it, you can lock it. Locking refuses drags, drops, and clears while leaving the abilities themselves as usable as ever, so a fumbled click in a fight cannot rearrange your buttons.\n\nTwo smaller bars join the row when they apply: the pet bar, with Attack, Stop, Taunt, Defensive, and Aggressive on Ctrl plus 1 through 5, and a stance bar for the classes that change stance or form.',

    minimapTitle: 'The minimap',
    minimapBody:
      'Top right: a round minimap with the zone name above it and your coordinates below, ringed by a dial that paints the time of day.\n\nThe disc carries more than terrain. Your own arrow sits at the center, pointing the way you face, with your party around you as class-colored dots and an edge arrow for anyone who has wandered off it. Quest givers wear the same marks there as they do in the world, and you will also pick out gathering nodes and crafting stations, travel portals, lootable bodies and containers, any hostile that has taken an interest in you, friends and guildmates who are nearby, and your own body while you are running back as a ghost.\n\nSmall indicators appear on it when they have something to say: an envelope while unread letters are waiting for you, a coin while sale proceeds or returned goods are waiting at the Merchant, and a button listing your raid lockouts.',

    mapTitle: 'The world map and your trackers',
    mapBody:
      'M opens the world map: the continent drawn out, with your own arrow on it, the zones and their names, the points of interest around you, the travel portals, and the gathering nodes you have found. Your party shows on it too. Inside a delve the map switches to a schematic of the rooms you have explored so far.\n\nDown the right side, under the minimap, a stack of trackers keeps your current business in view without opening anything: your tracked quests and their objectives, your deed progress, the delve you are in, and any rift you are taking part in. The quest tracker collapses when you want the screen back.',

    chatTitle: 'The chat box',
    chatBody:
      'Bottom left. Press Enter to start typing and Enter again to send.\n\nTwo tabs are always there: Chat, the combined log of everything said around you, and Combat, the written record of your fight. The plus button adds more, one per channel: Say, Yell, Party, General, World, LFG, Guild, and Officer, plus a Whisper tab that gathers every whisper you send and receive in one place. Typing in a channel tab sends to that channel without you retyping the command.\n\nThe whole box can be dragged to another spot and resized, and it remembers where you left it.',

    keyWindowsTitle: 'Windows you open with a key',
    keyWindowsBody:
      'Each of these has a default key and a button in the rail in the bottom right corner. Press the key again, or Esc, to close it.',
    winCharTitle: 'Character sheet (C)',
    winCharBody:
      'Your equipped gear on one side, your attributes and the stats they feed on the other, with a tooltip on every value that says what it does for your class. It also carries your lifetime Time Played, with a small eye beside it that hides the number when you would rather not show it, and the button that composes your player card.',
    winBagsTitle: 'Bags (B)',
    winBagsBody:
      'Everything you are carrying, in one pack with four bag sockets. Category chips across the top narrow it to weapons, armor, consumables, materials, tools, quest items, or mounts, and a search box filters by name. A sort dropdown reorders what you are looking at by most recent, quality, or name, and that choice is remembered between sessions. A separate Sort button tidies the real cells of the pack in one press, clearing the chips and the search so you see the whole tidied bag.',
    winSpellbookTitle: 'Spellbook (P)',
    winSpellbookBody:
      'Every ability your class has, learned and still to come, in order. This is where you drag abilities onto your action bars.',
    winTalentsTitle: 'Talents (N)',
    winTalentsBody:
      'Where you choose your specialization, and your six talent rows with the three options each one offers and what every option does. Rows you have not reached yet are shown beside the ones you can pick now.',
    winProfessionsTitle: 'Professions (Shift+P)',
    winProfessionsBody:
      'What you have learned, how skilled you are at each, and how far each one can still go.',
    winCraftingTitle: 'Crafting (T)',
    winCraftingBody:
      'Your recipes, what each one needs, and what you can make right now with what you are carrying.',
    winQuestLogTitle: 'Quest log (L)',
    winQuestLogBody:
      'Every quest you have taken, its story, its objectives, and your progress, with a way to show any of it on the map and to pick which quests your tracker follows.',
    winDeedsTitle: 'Book of Deeds (Shift+Z)',
    winDeedsBody:
      'The record of what you have done, the titles and Renown it has paid you, and what is still open.',
    winSocialTitle: 'Friends and Guild (O)',
    winSocialBody:
      'Tabs for your friends, your guild and its roster, your raid, and the players you have ignored or blocked.',
    winFinderTitle: 'Dungeon Finder (Shift+I)',
    winFinderBody:
      'The catalogue of group content you can queue for. Tick the activities you want, join a queue on your own or post a listing for your own group, and accept when a group comes together.',
    winMetersTitle: 'Damage meters (Shift+H)',
    winMetersBody:
      'Damage, healing, and threat for you and everyone with you, kept in segments so you can look back at the fight before last. The healing and threat panels can be pulled out to stand on their own.',
    winMoreTitle: 'And a few more',
    winMoreBody:
      'The world map (M), the PvP window (G), the Vale Cup (Y), the leaderboard (K), the event calendar (I), and the emote wheel (X) all work the same way. The leaderboard is worth a moment on your first visit: it keeps a tab for players, one for guilds, one that ranks whole accounts by Renown from the Book of Deeds, and one for the daily standings.\n\nRight-click another player, on their nameplate or on their name in chat, and Player Info opens a card on them: the gear they are wearing, with tooltips, and the public details of their character. It is a look, nothing more, and it needs them to be close enough to see.',

    worldWindowsTitle: 'Windows the world opens for you',
    worldWindowsBody:
      "Some windows you never press a key for: they open when you talk to the right person or click the right thing.\n\nA merchant opens the vendor window, with their stock to buy from and a buyback tab holding what you last sold, in case you sold it by mistake. A row of quantity buttons sits with the stock, so a stack of reagents is one press at five or ten at a time rather than ten presses, and a custom amount is there when neither suits. A class trainer opens the list of what you can learn now and what is still ahead of you.\n\nA banker opens your vault, the strongbox of extra slots you can buy more of. If your guild has opened a bank, a second tab there shows it: every member can look inside even without permission to take anything out, so nobody has to ask what the guild is holding, ranks decide who may deposit, withdraw, and move the guild's coin, and a log records every movement.\n\nA Ravenpost mailbox opens your letters, with what has arrived on one tab and a form for sending on another, attachments and all. The World Market at the Merchant has its own window: browse and buy on one tab, list your own goods on another, and collect what has sold on a third. Trading face to face with another player opens a trade window with a side each.",

    lootTitle: 'Loot and rolls',
    lootBody:
      "Interact with a body you have earned and the loot window opens, listing what dropped. Click a line to take it.\n\nIn a group, a good drop under the group's loot rules puts a roll prompt on your screen instead: Need if you want it for yourself, Greed if you would take it to sell, or Pass to leave it to someone else. A small panel then shows who has rolled and what they chose while the timer runs down.\n\nThe loot rules themselves live in a small window of their own. The group leader can change them there, and everyone else sees the same window read-only, so the rules are never a secret.\n\nSome bodies can also be harvested for their parts. When they can, a Harvest section appears at the foot of the loot window with a box to tick for each component you want.",

    playerCardTitle: 'Your player card',
    playerCardBody:
      'A button on your character sheet composes a player card: a picture with a close-up of your character, the gear you are wearing, and your stats, ready to save or share. It is a snapshot for showing off a new set, and it changes nothing in the game.',

    wikiTitle: 'The Wiki button',
    wikiBody:
      'This wiki is one click away in game. A button for it sits with the others in the rail in the bottom right corner, there is a row for it in the Esc game menu, and on a phone it lives in the More tray. Because opening it hands you over to your browser, the button always asks you to confirm first, so an accidental tap in a fight can never pull you out of one. The game keeps running behind it.',

    mobileTitle: 'On a phone or a tablet',
    mobileBody:
      'Touch controls appear on their own, and the layout sizes itself to your screen: a compact arrangement on a small phone, a standard one on a larger phone, and a roomier one on a tablet.\n\nYour abilities sit in a ring rather than a number row: the attack button with five action buttons beside it, and a page toggle that swaps the ring through the rest of your slots, up to seven pages once you have all three action bars switched on. Around them sit the buttons a touch player reaches for most, swapping target, using what is in front of you, and jumping, plus a pull-out row of your consumables that fills itself from what you are carrying.\n\nAlong the bottom edge are Chat, Social, Quests, Settings, and More. More opens a tray holding the rest of your windows, including your character, the Dungeon Finder, PvP, the Vale Cup, emotes, and the wiki. Windows fill the screen here rather than floating over it.\n\nMoving your unit frames is a desktop thing: on touch the layout places them for you.',
    railTitle: 'The button rail',
    railBody:
      'Down in the bottom right corner of the screen, a long way from the minimap, sits a rail of small square buttons, one per window, arranged in two short columns side by side. Most of them are printed with their default key.\n\nThe first column covers your character, spellbook, talents, quest log, Book of Deeds, professions, world map, bags, and crafting. The second opens with the WOC Store and runs on through PvP, the Dungeon Finder, the Vale Cup, Card Duel, the leaderboard, emotes, music, friends and guild, this wiki, and the game menu. A few more join them only when they apply.',
  },

  // Slash Commands reference: the chat command surface, grouped by purpose.
  commandsPage: {
    // Slash-command reference. Command tokens themselves are literal typed text and live
    // in the page module (like the key glyphs on the Controls page); only the "what it
    // does" column is catalog copy. Sourced from the sim chat router
    // (src/sim/social/chat.ts) plus the server-side chat commands; the dev-only /dev
    // surface is deliberately absent.
    intro: 'Every command you can type into chat, grouped by what it is for, with its short forms.',
    slashBody:
      'Anything you type in the chat box that starts with a slash is a command rather than something you say out loud. Press Enter and it either acts (you follow someone, you invite them, you roll) or it prints a private line only you can see.',
    aliasBody:
      'Most commands have short forms, and every form listed in a row does exactly the same thing: /w, /t and /tell are one command. Words in angle brackets are required, words in square brackets are optional, and the capitalization of the command itself never matters.',
    helpTipTitle: 'The game knows the list too',
    helpTipBody:
      'Type /help in game, or /commands, or just /?, and the whole command list prints into your chat. Mistype a command and the game tells you it did not recognize it, and points you back at /help.',
    cmdHeader: 'Command',
    doesHeader: 'What it does',

    // Talking
    groupTalking: 'Talking',
    say: 'Speak to the players standing near you. A plain line with no slash goes to whichever chat tab you have selected, and Say is the one you start on.',
    yell: 'Shout, so players much further away than say range hear you.',
    whisper:
      'Send a private message to one player who is online. Their name matches whatever capitalization you type, as long as only one player could be meant.',
    reply: 'Answer whoever whispered you last, without typing their name again.',
    me: 'Freeform action text in the third person, so "/me ponders the fountain" reads as your name followed by the action. Everyone near you sees it.',
    partyChat: 'Talk to everyone in your party or raid.',

    // Channels
    groupChannels: 'Channels',
    channelsIntro:
      'General reaches the whole realm and you are in it from the moment you log in. World and LFG are opt in: join one first, then you can read and talk in it.',
    general: 'The realm-wide General channel.',
    gAlias:
      'A short form with two meanings, so it is worth knowing: offline it sends to General, but online it is your guild channel. Type /general or /1 when you definitely mean General.',
    guild: 'Talk to your guild. Online play only, and you need to be in a guild.',
    officer:
      'The officer channel of your guild, open to officers and the Guild Master. Online play only.',
    join: 'Join or leave an optional channel. The two you can join are world and lfg, and typing /join on its own lists them. Opening a chat tab for one of them joins it for you.',
    world: 'Talk in the World channel, once you have joined it.',
    lfg: 'Talk in the LFG channel, where people look for groups. Join it first.',

    // Party and group
    groupParty: 'Party and group',
    invite: 'Invite an online player to your party by name, however far away they are standing.',
    partyRoster:
      'With no message after it, this prints your party roster instead: every member with their level, class and health, and the leader marked.',
    ready:
      'The party or raid leader starts a ready check, and everyone else gets a prompt to answer yes or no.',
    assist:
      'Target whatever the named player is targeting. With no name it assists the player you have targeted. It reaches your party and raid anywhere in the world, and anyone else close enough for you to see.',
    follow:
      'Trail another player automatically. With no name it follows your current target. Moving, casting, fighting, picking a new target, or the other player pulling away all end it, and you cannot start it in combat.',
    unfollow: 'Stop following.',
    roll: 'Roll a random number, from 1 to 100 unless you name a limit or a range. Your party sees the result, or everyone nearby when you are not in one. The roll is made by the server, so nobody can fake one.',

    // Other players
    groupPeople: 'Other players',
    who: 'List the players online. Add text to narrow it to names or zones containing that text.',
    inspect: "Look up an online player's level, class and health.",
    ignore:
      "Hide a player's public chat and their overhead chat bubbles from you. Their whispers, rolls, invites and mail still arrive. The list form prints who you are ignoring.",
    block:
      'The stronger version: it also stops their whispers, invites and mail, and hides the two of you from each other in /who. The list form prints who you have blocked.',
    peopleNote:
      'The /who roster and your ignore and block lists are kept by the server, so those work in online play only.',

    // Your character
    groupSelf: 'Your character',
    selfIntro:
      'These print a private line into your chat that nobody else sees. Nothing is broadcast, so they are safe to use in the middle of a fight.',
    played: 'How long this character has been in the world during this session.',
    playtime: 'How long this character has been played in total, across every session.',
    xp: 'Your level and how far through it you are.',
    gold: 'What is in your purse.',
    stats:
      'A one-line character summary: level, class, health, your resource, attack power, crit chance and armor.',
    gear: 'Everything you have equipped, slot by slot, so the empty slots stand out.',
    bags: 'What you are carrying, best quality first, with your money at the end.',
    abilities: 'The abilities you have learned.',
    talents: 'Your specialization, and how many of your six talent rows you have chosen so far.',
    quests: 'Your active quest log, with the progress on each objective.',
    completed: 'The quests you have already turned in, in the order you finished them.',
    session: 'What you have done since you logged in: kills, deaths, damage and experience.',
    arena:
      'Your Ashen Coliseum standing in both brackets: rating, wins, losses and win rate for 1v1 and for 2v2.',
    listings:
      'Your own listings on the World Market, with the asking price, the time each has left, and how much room you have for more.',
    buyback: 'What you sold to a vendor recently and could still buy back.',

    // How you are right now
    groupState: 'How you are right now',
    buffs: 'The buffs and debuffs on you, with the time left on each.',
    cooldowns: 'Which of your abilities are cooling down, soonest ready first.',
    pet: "Your pet's name, level, family and health.",
    petTaunt: "Your pet's taunt cooldown, and whether it is set to cast it on its own.",
    speed:
      'How fast you are moving compared to a normal run, and whether something has you rooted.',
    form: 'The shapeshift form or combat stance you are in.',
    manaRegen:
      'For mana users: whether your out-of-combat mana regeneration has started ticking again.',
    savedMana:
      'For a mana user who is shapeshifted: the mana parked while you are shifted, which comes back when you shift out.',
    combo: 'How many combo points you are holding.',
    consumable: 'The food and drink working on you right now, and how long each has left.',
    potion: 'The shared combat potion cooldown, which is separate from your ability cooldowns.',
    falling:
      'Whether you are airborne, how far above the ground you are, and whether the landing is going to hurt.',

    // In a fight
    groupCombat: 'In a fight',
    target: 'Your current target: name, level, what it is, and health.',
    targetBuffs: 'The auras on your target, each tagged as a buff or a debuff.',
    range: 'How far away your target is, and whether that is inside melee range.',
    attack: 'Whether auto attack is running, on what, and how long your swing takes.',
    casting: 'What you are casting or channeling, and how long is left.',
    combat: 'Whether you are in combat, and when you are due to drop out of it.',
    threat: 'Who the enemies fighting you are currently focused on.',
    consider: "How dangerous your target's level makes it, compared to yours.",
    queued: 'The ability armed to go off on your next melee swing.',
    overpower:
      'For warriors: whether the Overpower window that an enemy dodge opens is still available.',

    // World and travel
    groupWorld: 'World and travel',
    where: 'The zone you are standing in, its level range, and your coordinates.',
    zones: 'Every zone in travel order with its level range, and the one you are in marked.',
    nearby: 'The living things closest to you, nearest first.',
    pois: 'The landmarks of your current zone, nearest first, with the distance to each.',
    graveyard: 'Where your spirit would return to if you fell here.',
    dungeons:
      'Every dungeon with the zone its door sits in and the party size it is built for, plus the difficulty you are currently set to.',
    dungeonMode: 'Switch your dungeons between the normal and heroic difficulty.',
    dungeonReset:
      'Abandon your own empty instances, which is what you do after changing difficulty.',

    // Recovery and presence
    groupRecovery: 'Recovery and presence',
    unstuck:
      'The way out when the world has trapped you. Stand still through a short countdown and you are moved to the nearest graveyard, and raised there if you had already fallen. It leaves you weakened by Unstuck Sickness for a while afterwards, so it is a last resort rather than a shortcut.',
    afk: 'Mark yourself Away From Keyboard, with an optional message that anyone who whispers you gets as an automatic reply. Repeat it with no message to clear it; any other chat clears it too.',
    dnd: 'Do Not Disturb: like away, except whispers sent to you are held back instead of delivered.',
    sit: 'Sit down where you are, and stand back up. You stand automatically the moment you move, cast, or take a hit.',
    help: 'Print the command list into your chat.',

    // Emotes (the full list lives on the Social page)
    emotesHeading: 'Emotes',
    emotesBody:
      'The social emotes are commands too: /wave, /bow, /cheer, /dance, /laugh and the rest, each shown to everyone in say range. Add a name to aim one at somebody, as in "/wave Aleph", and /me covers anything the list does not.',
    emotesMore: 'More about emotes and playing together',

    // The "!" community commands (server-relayed, online only)
    bangHeading: 'Community commands',
    bangBody:
      'A few commands start with an exclamation mark instead of a slash. They announce something to the realm and post it to the community Discord at the same time, so people who are not logged in see it too. They are part of online play.',
    bangList:
      'The set is !lfg for looking for a group, !wts and !wtb for selling and buying, !recruit for guild recruitment, !event for a raid or a meetup, and !help when you are stuck. Type the command, then your message.',

    // What happens when a command does not land
    unknownHeading: 'If a command does not work',
    unknownBody:
      'A command the game does not recognize comes back as an unknown-command notice, and nothing is said out loud, so a typo never lands in the channel you were talking in. Commands sent too quickly in a row are throttled: slow down for a moment and they go through again. Some need something to act on, so /follow with nobody targeted, or /reply when nobody has whispered you, will tell you so.',
    stickyBody:
      'Which chat tab you have selected decides where a plain line with no slash goes. Select the World tab and your next untagged line goes to World, so glance at the tab before you type. A slash command always wins over the tab, so /w Bob hi whispers Bob whichever tab is up, and on the whisper tab a plain line answers whoever whispered you last.',
  },

  glossary: {
    intro: 'A quick reference for the terms used across this guide and in chat.',
    aggroTerm: 'Aggro',
    aggroDef:
      "An enemy's attention. The player generating the most threat holds aggro and gets attacked.",
    threatTerm: 'Threat',
    threatDef:
      "How much an enemy wants to attack you. The tank's job is to hold more threat than everyone else.",
    gcdTerm: 'Global cooldown',
    gcdDef:
      'The short, shared pause after using most abilities, so you cannot fire everything at once.',
    dpsTerm: 'DPS',
    dpsDef:
      'Damage per second, a rough measure of how fast something deals damage. Also used for the damage-dealing role itself, as in a tank, a healer, and three DPS.',
    buffTerm: 'Buff',
    buffDef: 'A helpful effect on you or an ally, like a blessing that raises a stat for a while.',
    debuffTerm: 'Debuff',
    debuffDef: 'A harmful effect on a target, like a slow, a bleed, or weakened armor.',
    dotTerm: 'DoT and HoT',
    dotDef:
      'Damage over time and healing over time: effects that tick in steady pulses instead of all at once.',
    ccTerm: 'Crowd control',
    ccDef: 'Abilities that stun, root, or otherwise take an enemy out of the fight for a moment.',
    procTerm: 'Proc',
    procDef:
      'A chance-based effect that fires off something else, like a bonus that sometimes triggers when you attack.',
    eliteTerm: 'Elite',
    eliteDef:
      'A tougher-than-normal enemy, usually meant for a group. Dungeon and rare enemies are often elite.',
    rareTerm: 'Rare',
    rareDef: 'An uncommon named enemy that wanders a zone and drops better loot.',
    mobTerm: 'Mob',
    mobDef: 'Any computer-controlled creature in the world, friendly or hostile. Short for mobile.',
    tankTerm: 'Tank',
    tankDef:
      'The party member who holds enemy aggro and absorbs the damage so others can fight safely.',
    healerTerm: 'Healer',
    healerDef: 'The party member who keeps everyone alive with healing spells.',
    specTerm: 'Spec',
    specDef:
      'A specialization: the path you choose for your class at level 5, like healing or damage. It sets your role, grants a signature ability and a lasting mastery, and stays with you even when you reset your talents.',
    pullTerm: 'Pull',
    pullDef:
      'To draw an enemy or group into a fight, usually deliberately and one batch at a time.',
    instanceTerm: 'Instance',
    instanceDef: 'A private copy of a dungeon or raid made just for your party.',
    raidTerm: 'Raid',
    raidDef:
      'A larger group, up to ten players here, formed for the toughest endgame encounter; a party converts into one once it is full.',
    delveTerm: 'Delve',
    delveDef:
      "A short, replayable instanced descent for one or two players, run from a keeper's board with a companion at your side.",
    augmentTerm: 'Augment',
    augmentDef:
      'A temporary boost you draft during a two-on-two Fiesta arena match that reshapes your kit for that match only.',
    deedTerm: 'Deed',
    deedDef:
      'An achievement recorded in the Book of Deeds. Earning one grants Renown, and some grant a cosmetic title or nameplate border.',
    renownTerm: 'Renown',
    renownDef:
      'The lifetime score your deeds add up to. It only ever climbs, and the realm keeps standings of it on the Leaderboard.',
    heroicTerm: 'Heroic',
    heroicDef:
      'The harder version of a dungeon or the raid, tuned for geared endgame parties. Heroic bosses drop upgraded loot, and the final boss pays Heroic Marks.',
    lockoutTerm: 'Lockout',
    lockoutDef:
      'A daily cap on the biggest repeatable rewards. Each heroic dungeon pays out one clear per day, the raid tracks normal and heroic separately, and looting a world boss starts yours. A cleared five-player run stays open to its own party; the locked raid door does not reopen until reset.',
    restedTerm: 'Rested',
    restedDef:
      'Bonus experience your character banks while resting at an inn, out of combat. Your next kills earn extra experience until the pool runs dry.',
    petBarTerm: 'Pet bar',
    petBarDef:
      'The command row a hunter or warlock pet adds: Attack, Stop, Taunt, Defensive, and Aggressive, bound to Ctrl plus 1 through 5 by default.',
    metersTerm: 'Damage meters',
    metersDef:
      'The party scoreboard window for the current fight: damage dealt, healing done, and who holds the most threat, kept per encounter. Open it with its keybind (Shift+H by default).',
    targetMarkerTerm: 'Target marker',
    targetMarkerDef:
      'A symbol any party or raid member can pin over a target so everyone focuses, or avoids, the same one. Eight symbols, one target per symbol.',
    loadoutTerm: 'Loadout',
    loadoutDef:
      'A saved talent layout, up to ten of them. Each one remembers its row picks and its action bar, so swapping builds is one click instead of redoing every row.',
    readyCheckTerm: 'Ready check',
    readyCheckDef:
      'A group leader typing /ready to poll the party or raid: everyone confirms Ready or Not Ready, and the group sees the counts.',
    soulboundTerm: 'Soulbound',
    soulboundDef:
      'An item bound to your character from the moment you acquire it. It cannot be traded, mailed, vendor-sold, or listed on the market.',
    spiritHealerTerm: 'The Pale Keeper',
    spiritHealerDef:
      "The realm's spirit healer, hovering over every graveyard: it can raise your ghost on the spot at the price of a passing weakness.",
    worldBossTerm: 'World boss',
    worldBossDef:
      'A raid-strength boss that rises in the open world on a steady rhythm, fought by whoever gathers to answer rather than a fixed party.',
    // Mana regen only resumes five seconds after the last mana spend
    // (src/sim/combat/auras.ts `fiveSecondRule >= 5`).
    fiveSecondTerm: 'The five-second rule',
    fiveSecondDef:
      'Your mana only starts refilling on its own once five seconds have passed since you last spent any. It is why casters pace themselves instead of casting flat out.',
    // Talents are six choice rows at levels 5, 8, 11, 14, 17 and 20, one of
    // three options each (src/sim/content/talent_rows.ts ROW_LEVELS,
    // OPTIONS_PER_ROW). There is no point pool to spend.
    talentRowTerm: 'Talent row',
    talentRowDef:
      'Talents arrive as six rows, one at each of levels 5, 8, 11, 14, 17 and 20. Every row offers three options and you take one of them, so there are no points to save up or spend.',
    // Rift ranks C/B/A/S (src/sim/rift/ranks.ts), floors and the entrance
    // clock (hudChrome rift tracker), first-clear race (src/sim/rift/race.ts).
    riftTerm: 'Rift',
    riftDef:
      "A tear that opens on its own out in the zones, leading down through floors of an instance built fresh from that rift's own seed. Rifts are ranked C, B, A or S. The entrance closes to new parties after a while, and only the first party in the realm to reach the bottom seals it.",
    // The rank letter gets its own entry because the realm announcement and the gear
    // that drops both say "A-rank" without ever explaining the ladder.
    riftRankTerm: 'Rank (rifts)',
    riftRankDef:
      'The letter on a rift, C, B, A or S, and the only thing that sets how hard it is. A rift never scales to the size of your group, so the rank is the whole difficulty ladder: C is the gentlest and S the fiercest, and every rank is meant for a group.',
    finderTerm: 'Dungeon Finder',
    finderDef:
      'The window that catalogues the dungeons and raids, queues you for a quick match, and lists the premade groups looking for people. Shift+I opens it by default.',
    premadeTerm: 'Premade',
    premadeDef:
      'A group a player put together by hand and listed on the Dungeon Finder board, rather than one the quick match queue assembled for you.',
    chronicleTerm: 'Chronicle',
    chronicleDef:
      "A zone's own collection of deeds, gathered into chapters by a local Chronicler. You can work through the chapters in whatever order suits you.",
    // Delve Marks are a per-character counter spent in the delve shop and on
    // companion upgrades; Heroic Marks are the heroic dungeon item currency.
    marksTerm: 'Delve Marks and Heroic Marks',
    marksDef:
      'The two rewards the repeatable endgame pays besides loot. Delves pay Delve Marks, which buy gear from the delve shop and upgrade your companion; heroic dungeons pay Heroic Marks, which buy gear from the heroic quartermaster.',
    honorTerm: 'Honor',
    honorDef:
      'What fighting other players pays out: arena victories, Thornhollow Fields wins, and honorable kills all add to it. You spend it on the Warfare sets.',
    warfareTerm: 'Warfare',
    warfareDef:
      'The gear side of player-versus-player. A quartermaster sells sets of Warfare armor for Honor, and the Warfare rating they carry counts only in fights against other players.',
    // Swim fatigue out on the open sea (src/sim/fatigue.ts): warning, grace,
    // then rising unavoidable damage until you head back toward land.
    fatigueTerm: 'Fatigue',
    fatigueDef:
      'Swim far enough out into open sea and the water begins to sap you: a warning comes first, then rising damage until you turn back toward land.',
    // Unstuck (game menu) countdown, graveyard move, and Unstuck Sickness
    // (src/sim/unstuck.ts).
    unstuckTerm: 'Unstuck Sickness',
    unstuckDef:
      'The price of using Unstuck from the game menu. Stand still through the countdown and it sets you down at the nearest graveyard, and you carry a temporary weakness for a while afterwards.',
    itemLevelTerm: 'Item level',
    itemLevelDef:
      'One number summing up how strong a piece of gear is, handy when you want to compare two pieces quickly. Turn on Show Item Level in the options to see it on tooltips. Only gear with a known source carries one, so plain vendor basics and starter gear show nothing, and a missing figure is normal rather than a fault.',
    requiredLevelTerm: 'Required level',
    requiredLevelDef:
      'The level you have to reach before you can wear or wield a piece of gear. The tooltip shows it in red while you are still under it.',
    offHandTerm: 'Off hand',
    offHandDef:
      'The second hand slot. It holds a shield or a held item such as a lantern or a quiver, and a second weapon only if your class and specialization can dual wield.',
    setBonusTerm: 'Set bonus',
    setBonusDef:
      'An extra reward for wearing several pieces of the same armor family at once. The tooltip counts how many pieces of the set you have on, and more pieces unlock more of the bonus.',
    // Commissions and the Maker's Bond (Professions 2.0). The professions
    // pages carry the full rules and the exact unbind fees.
    commissionTerm: "Commission and the Maker's Bond",
    commissionDef:
      'A craft made for someone else. The crafter flags the piece as a commission, and it binds to whoever receives it in a trade; a station master will unbind it again later for a fee.',
    masterworkTerm: 'Masterwork',
    masterworkDef:
      "The finest version of a craft, which a skilled crafter turns out now and then in place of a plain copy. A masterwork always carries its maker's name.",
    toolCharmTerm: 'Tool charm',
    toolCharmDef:
      'A crafted charm you slot onto a mining, logging, or herbalism tool from the Professions window to improve what it brings back. Slotting consumes the charm, and the effect lasts for a set number of charges. When those run out you recharge the slot with materials rather than crafting a new charm.',
    mountTerm: 'Mount',
    mountDef:
      'A creature you ride to cross the land faster. Almost anything else you do takes you off it: swimming, entering combat, gathering, and crafting all put you back on your feet.',
    ridingTerm: 'Riding',
    ridingDef:
      'The skill that lets you ride at all. You buy it once from a stablemaster at level 20, and after that it stays with your character for good.',
    reinsTerm: 'Reins',
    reinsDef:
      'The item that is a mount. Keep a pair in your bags or your bank and that mount is yours; use them to ride. Reins can be traded, mailed, and sold to other players.',
    claudiumTerm: 'Claudium',
    claudiumDef:
      'The currency of the WOC Store, spent on cosmetics and nothing else. It never buys power or progression.',
    worldTerm: 'World',
    worldDef:
      'One shared copy of the online game, with its own players, market, and standings. This guide also calls it a realm, and your character lives on the world you made it on.',
  },

  // FAQ page (fuller than the home teaser).
  faqPage: {
    intro: 'The questions new players ask most often.',
    q1: 'Is it really free?',
    a1: 'Yes. The whole game is free to play to the level cap, and the source code is open on GitHub.',
    q2: 'Do I need a crypto wallet or any tokens?',
    a2: 'No. The game is fully playable without one. The optional community token only adds cosmetic flair and a share of the daily rewards prize pool, and it never affects power or progression.',
    q3: 'Can I play on my phone?',
    a3: 'Yes. The game runs in any modern mobile browser with touch controls, and there are apps too: iOS and Android builds, and a desktop app for Windows, macOS, and Linux that keeps itself up to date.',
    q4: 'Can I play offline or solo?',
    a4: 'Yes. There is an instant single-player offline mode, and the online world is fully soloable apart from dungeons, the raid, and the world boss.',
    q5: 'How many classes are there?',
    a5: 'Nine, covering the classic tank, healer, and damage roles, each with a resource system (rage, mana, or energy) and its own signature abilities.',
    q6: 'What is the level cap?',
    // Superseded by a6Count below, for the same placeholder-parity reason as home.world.sub.
    a6: 'Level {cap}, reached across three connected zones of quests, dungeons, and exploration.',
    a6Count:
      'Level {cap}, reached across zones of quests, dungeons, and exploration. There are {zones} zones in all, from the starting valley to regions built for characters already at the cap.',
    q7: 'Will my character be saved?',
    a7: 'Online characters are saved on the server automatically. Offline characters live in your browser for quick sessions and testing.',
    q8: 'Can I host my own copy?',
    a8: 'Yes. The project is open source, so you can run your own server. See the GitHub repository.',
    q9: 'Is there PvP?',
    a9: 'Yes. Duel anyone for fun, or step into the Ashen Coliseum to fight other players. PvP is opt in, so you are never forced into it.',
    q10: 'What is there to do at max level?',
    a10: 'The cap is level {cap}. From there you run the five-player dungeons and the ten-player raid, take them on again in heroic mode for upgraded loot, descend into rifts floor by floor, face the world boss when he rises, test yourself in the arena or on the Thornhollow Fields battleground, play a season of the Vale Cup, drop into delves with a companion at your side, take a profession all the way to masterwork crafting, collect mounts, and chase deeds in the Book of Deeds to climb the standings.',
    q11: 'How do I find a group?',
    a11: 'Invite anyone you meet to a party, ask in chat, or team up at a dungeon. Most of the world is soloable, so grouping is a choice, not a requirement.',
    // Rows added after q11. The page orders them by subject (see the QA array in
    // src/guide/pages/faq.ts), so the numbering here is only the order they were written.
    q12: 'Is there a cash shop?',
    a12: 'There is an optional cosmetic store. It sells looks: the Season 1 Armory weapon skins, bought with Claudium, the store currency. Nothing in it adds stats, power, or progression, and a skin never changes how your weapon hits, so every piece of gear that matters still comes from playing.',
    q13: 'Where can I get the app?',
    a13: 'The browser version needs nothing at all: open the site and play. If you would rather have an app, the desktop download for Windows, macOS, and Linux is on the Download page of the game site. Native iOS and Android apps are in the works, and until they land a phone or tablet plays the browser version with full touch controls. Every version signs in to the same account and the same worlds, so your characters follow you.',
    q14: 'What do I need to run it?',
    a14: 'A recent browser on a laptop, desktop, phone, or tablet. On your first launch the game reads your device and picks a graphics tier to match, from Low to Ultra, and any choice you make yourself always wins. Mouse and keyboard, touch, and a game controller all work. The settings and controls pages have the detail.',
    q15: 'Do I need an account?',
    a15: 'Only to play online. The offline world asks for nothing: choose Offline on the start screen and press Play. An online account is free, takes a username, a password, and an email address for account recovery, and keeps your characters saved on the server. Once you have one you can turn on two-factor authentication from the options.',
    q16: 'What is a world?',
    a16: 'Online play happens on worlds, and each one is a full copy of the game with its own players, its own World Market, and its own standings. When you sign in, the World List shows how busy each world is, from Low to Full, so you can pick a quiet one for elbow room or a busy one for company. Your characters live on the world you made them on, and you can keep characters on more than one.',
    q17: 'How many characters can I have, and can I delete one?',
    a17: "Up to ten characters per world on one account, and you can have characters on more than one world. To remove one, delete it from the character list: the character must not be in the world, and you have to type its name to confirm, which is why a slip of the finger cannot cost you a hero. Deleting is permanent. That character's belongings go with it, its World Market listings are pulled from the market, and its Ravenpost mailbox is cleared.",
    q18: "Can I change my character's name?",
    a18: 'Not by yourself, so choose one you like. Names are 2 to 16 letters, start with a letter, and allow spaces, hyphens, and apostrophes, and each one is unique on its world no matter how it is capitalized. Names that break the rules of conduct are refused. The one time you are asked to rename is when a moderator requires it. Closing your account can release its names for other players, and merely not playing for a while never does: an inactive account keeps its names.',
    q19: 'What happens if I get disconnected?',
    a19: 'Your character stays in the world for about five minutes and the game tries to reconnect on its own, so a dropped signal, a shut laptop, or a reload usually puts you right back where you were, in the same session. Because your character really is still standing there, disconnecting is not a way to escape a fight. Choosing Logout from the game menu leaves immediately rather than waiting out that window.',
    q20: 'I found a bug. How do I report it?',
    a20: 'From inside the online game, open the menu with Esc and choose Report a Bug. Describe what happened and send it: your world, your character, and where you were standing ride along automatically, together with your version and device details, and you can tick Include Screenshot to attach a picture of what you were looking at. If you send several in a row you may be asked to wait a moment before the next one.',
  },

  // Classes index + per-class pages.
  classList: {
    heading: 'The nine classes',
    sub: 'Tank, heal, or deal the damage. Pick the fantasy that calls to you, then make it your own with talents.',
  },
  role: {
    tank: 'Tank',
    healer: 'Healer',
    damage: 'Damage',
  },
  resourceName: {
    rage: 'Rage',
    mana: 'Mana',
    energy: 'Energy',
  },
  classPage: {
    back: 'All classes',
    // Deprecated: the class page reuses the char-select labels (classDetails.labels.*) and
    // shows role and resource as hero badges. Kept only so existing locale overlays stay
    // valid; not rendered.
    roleLabel: 'Plays as',
    resourceLabel: 'Resource',
    specsHeading: 'Specializations',
    abilitiesHeading: 'Signature abilities',
    abilitiesNote:
      'A taste of the kit. You learn more as you level, and talents reshape how it all plays.',
    masteryLabel: 'Mastery',
    fullKitHeading: 'The full kit',
    fullKitNote:
      'The kit this class learns as it levels, in the order it comes online. Talents grant a few more abilities and decide which ones carry your build.',
    petsHeading: 'Demons',
    petsNote: 'Warlocks summon demons to fight beside them, each suited to a different job.',
    // Guide-owned class lead. The shared character-creation copy (classDetails.lore.mage)
    // still sells three damage schools, but the mage's third specialization, Chronomancy,
    // is a healer (src/sim/content/talents_classic.ts). Rendered by CLASS_LEAD_OVERRIDE on
    // both the class card and the class page, so the two surfaces agree.
    mageLore:
      'Mages bend Fire and Frost to destroy enemies, summon a Water Elemental, freeze threats in place, or bend time itself to shield and mend their allies.',
    // The mage's summoned pet (src/sim/content/mage_pets.ts, summon_water_elemental).
    mageEleHeading: 'Water Elemental',
    mageEleNote:
      'A Frost mage learns to summon a Water Elemental, a ranged companion that throws Waterbolts at your target on its own. It answers the pet bar like a hunter beast or a warlock demon, though it is not built to hold a target for you.',
    mageEleJet:
      'Water Jet sits on the pet bar as a button of its own: click it to lock a chilling beam onto one enemy, or right-click it (touch and hold on mobile) to let the elemental fire it on its own whenever it is ready.',
    // Druid shapeshifting (src/sim/content/classes.ts form abilities, form gating in
    // src/sim/combat/casting_lifecycle.ts and the wand rule in form_swing.ts).
    formsHeading: 'Shapeshifting',
    formsNote:
      'A druid fights by changing shape. Most druid abilities belong to one shape, so the form you are in decides what you can cast, and shifting costs a little mana. You can shift in or out of combat, as often as you like.',
    formsMoonwing:
      'A Moongrove druid gains one more shape, Moonwing Form, the caster shape a Balance druid fights in. It is the one animal shape that keeps your spells, and your wand only works in it or in your normal caster form.',
    formLine: {
      form_bear:
        'The tanking shape: a heavy hide, rage instead of mana, and extra threat so enemies keep swinging at you.',
      form_cat:
        'The melee damage shape: energy and combo points, like a rogue, and much less threat.',
      form_travel:
        'The travelling shape: far quicker across the ground, but no other abilities until you shift out.',
    },
    // The summon spell's own kit line. Water Jet is the PET's pet-bar command, not this
    // spell, so it renders as a paragraph under the row instead of as this line.
    mageEleSummon:
      'A Frost spell that calls the elemental to your side and sets it on your target.',
    // Form names owned by this page (the sim's own names: src/sim/content/classes.ts
    // bear_form, cat_form, travel_form). Kept here rather than read from the model
    // gallery's labels so a reword over there cannot silently rename the forms.
    formName: {
      form_bear: 'Bruin Form',
      form_cat: 'Wolf Form',
      form_travel: 'Fleet Form',
    },
  },
  // Deprecated: short fantasy hooks. The class index and class page now use the canonical
  // character-creation description (classDetails.lore.*) so there is a single source of
  // truth for each class. Kept only so existing locale overlays stay valid; not rendered.
  classHook: {
    warrior: 'A relentless front-line fighter who turns every blow taken into fuel for the next.',
    paladin: 'A holy warrior who can shield allies, mend their wounds, or bring the hammer down.',
    hunter: 'A ranged marksman with a loyal beast at their side and a trick for every foe.',
    rogue: 'A master of stealth and poisons who strikes from the shadows and never fights fair.',
    priest:
      'A devoted healer whose light keeps the party standing, or whose shadow unmakes the enemy.',
    shaman:
      'A spirit-caller who bends storm, fire, and water, and mends allies between the lightning.',
    mage: 'A spellweaver of fire, frost, and arcane who controls the battlefield from afar.',
    warlock: 'A dark conjurer who commands demons and curses, trading life for devastating power.',
    druid:
      'A shapeshifter who tanks as a bear, savages foes as a cat, or heals in the thick of it.',
  },

  // Qualitative "feel" tags for the class chooser and class headers. Relative labels, never
  // numbers (see src/guide/class_meta.ts for the per-class values).
  tag: {
    melee: 'Melee',
    ranged: 'Ranged',
    both: 'Melee or ranged',
    solo: 'Solo friendly',
    group: 'Group oriented',
    flexible: 'Flexible',
    simple: 'Simple',
    moderate: 'Moderate',
    complex: 'Complex',
    goodFirst: 'Great first class',
  },

  // The class chooser on the Classes index: filter the nine by how you want to play.
  chooser: {
    heading: 'Find your class',
    intro:
      'Filter by how you like to play. Every class is viable, so this only narrows the field, it does not rank them.',
    role: 'Role',
    style: 'Style',
    resource: 'Resource',
    complexity: 'Complexity',
    goodFirst: 'Good for beginners',
    clear: 'Clear',
    results: 'Showing {count} of {total}',
    none: 'No class matches every filter. Clear one to see more.',
  },

  // One spoiler-safe, number-free line per signature ability (what it is for, when you
  // press it). Keyed by the sim ability id.
  abilityHook: {
    heroic_strike: 'Queues a heavier swing that spends rage on your next hit.',
    revenge: 'Sweeps enemies in front of you, with a chance to become free after a dodge or parry.',
    hamstring: "Cripples an enemy's movement to keep it from escaping.",
    battle_shout: 'A rallying cry that raises attack power for the party.',
    charge: 'Rushes a distant enemy to open the fight with a brief stun.',
    thunder_clap: 'Hits everything around you and slows their attacks.',
    seal_of_righteousness: 'Imbues your swings with Holy damage, then spend it with Verdict.',
    holy_light: 'A steady, sizable heal for topping off an ally or yourself.',
    devotion_aura: 'A lasting self-buff that raises armor so hits land softer.',
    judgement: 'Spends your active Seal to strike an enemy from short range.',
    blessing_of_might: "Raises a friendly target's attack power, good to cast before a pull.",
    divine_protection: 'A quick protective ward to soak damage when things get rough.',
    raptor_strike: 'A hard melee swing for when something closes the gap on you.',
    aspect_of_the_hawk: 'A stance you keep up to sharpen your ranged attack power.',
    serpent_sting: 'Lands a venom that bleeds nature damage over time.',
    arcane_shot: 'An instant shot from range for quick extra damage.',
    concussive_shot: 'Dazes the target and slows it so it cannot reach you.',
    mongoose_bite: 'A counterstrike that opens up right after the enemy dodges.',
    sinister_strike: 'Your reliable strike that builds combo points to spend later.',
    eviscerate: 'Spends your combo points to finish a target with a burst.',
    garrote: 'Open from stealth with a wire that bleeds the target over time.',
    backstab: 'Slip behind a target with a dagger for a hard-hitting builder.',
    gouge: 'Incapacitates the target briefly so you can reposition or peel.',
    cheap_shot: 'Open from stealth with a stun and a head start on combo points.',
    smite: 'A holy bolt for chipping down a target from range.',
    lesser_heal: 'A steady cast to top up an ally when there is time to stand still.',
    power_word_fortitude:
      "Raises an ally's health pool, so cast it before the pull and keep it up.",
    shadow_word_pain: 'Sticks a shadow rot on a foe, then you move on while it ticks.',
    power_word_shield: 'Wraps an ally in a shield that soaks hits before they land.',
    renew: 'A heal that ticks over time, good to cast and keep moving.',
    lightning_bolt: 'A ranged cast of Nature damage, your go-to from afar.',
    rockbiter_weapon: 'Imbues your weapon so each swing lands harder in melee.',
    healing_wave: 'Your main heal, a direct mend for yourself or an ally.',
    earth_shock: 'An instant shock for quick Nature damage when you need it now.',
    lightning_shield: 'Charges you so attackers take Nature damage when they hit you.',
    flame_shock: 'An instant burn that hits up front and keeps searing over time.',
    fireball: 'Your main fire nuke, lands a hit and leaves the target burning.',
    fireball_form: 'Become a living ember to cross open ground at high speed.',
    frost_armor: 'A lasting self-buff that hardens your armor before a fight.',
    arcane_intellect: "Raises Intellect to deepen an ally's mana pool, cast it before the pull.",
    frostbolt: 'Strikes from range and slows the target so it cannot close on you.',
    ice_lance: 'An instant shard for spending frost procs, it hits far harder on a frozen target.',
    flurry:
      'Three quick bolts that chill the target so your next frost hits land as if it were frozen.',
    fingers_of_frost:
      'Your frost bolts sometimes empower an Ice Lance to strike as if the target were frozen.',
    brain_freeze: 'Your frost bolts sometimes make the next Flurry instant and skip its cooldown.',
    shatter: 'Your spells crit far more often against frozen targets.',
    frozen_orb: 'Rolls a slow orb through the pack that chills enemies and banks Icicles.',
    blizzard: 'Blankets an area in ice to wear down and slow a whole pack.',
    blink: 'Teleports you a short distance forward, breaking roots on the way out.',
    conjure_water: 'Conjures drinks that restore mana, so you can refill between pulls.',
    conjure_food: 'Conjures food that restores health when you sit down to eat.',
    shadow_bolt: 'A bolt of shadow you cast at a target, your go-to nuke.',
    summon_imp: 'Calls up an Emberkin that flings firebolts at enemies from range.',
    demon_skin: 'A lasting self-buff that toughens your skin and adds armor.',
    immolate: 'Sets a target alight for an opening hit and a burn that lingers.',
    corruption: 'Rots a target with shadow that ticks while you do other things.',
    life_tap: 'Trades some of your own health back into mana when you run dry.',
    wrath: 'A nature bolt thrown at a target from range, your go-to nuke.',
    healing_touch: 'A big single-target heal with a long cast, for topping someone off.',
    mark_of_the_wild: 'A lasting blessing you put on yourself or an ally before a fight.',
    moonfire: 'Hits instantly and leaves the target burning, good while moving.',
    rejuvenation: 'Casts instantly and heals an ally over time, so you can keep acting.',
    thorns: 'Wards an ally so melee attackers hurt themselves for striking.',
  },

  // Warlock demon roster flavor, keyed by pet id.
  petHook: {
    emberkin: 'A ranged firebolt demon that chips at enemies from a safe distance.',
    gloomshade: 'A sturdy demon that taunts and soaks hits so you can cast in peace.',
    duskborn: 'A fast melee demon that hits hard but folds under pressure.',
    spellhound: 'A shadow skirmisher that hounds enemy casters.',
    warfiend: 'A durable melee bruiser, the all-rounder once you can summon it.',
    pyre_colossus: 'A hulking juggernaut with crushing melee, summoned for raw power.',
    wraithborn: 'An elite caster that rains heavy shadow from afar.',
  },

  // Bestiary.
  bestiary: {
    heading: 'Bestiary',
    intro:
      'The creatures of the world, grouped by family. These are the everyday foes you meet out in the open. Elite enemies and their warlords keep themselves off these pages, and the deadliest things of all wait behind dungeon doors.',
    rare: 'Rare',
    levels: 'Levels {min} to {max}',
    levelsSame: 'Level {min}',
    // Heading for the line of flavor under a creature that carries one.
    notedLabel: 'Of note',
    // One-line, mechanics-free flavor for a handful of notable and rare creatures, keyed
    // by the sim template id. Most creatures carry no line; only the standouts do.
    flavor: {
      old_greyjaw:
        "A scarred old wolf no trap has held, blamed for three hounds and a stable boy's arm. He hunts the deep woods alone, and turns savage the longer a fight wears on.",
      grubjaw:
        "A fen troll so greedy the other trolls will not dig beside him, said to have eaten a trader's last two pack-mules, harness and all.",
      shardlord_kazzix:
        'A storm elemental given shoulders, walking the far crags above Stormcrag with a heartshard worth braving the lightning for.',
      sethrael_palecoil:
        'A bone-pale serpent that glides the deep shelf of the Glimmermere, silent warden of the water it has claimed. Swimmers who share the mere with it rarely surface.',
      // Kept though Mirejaw Frenzy is no longer in the bestiary (it is a summon-only encounter
      // add now filtered out): the line is still translated in every locale overlay, and the
      // bestiary renders flavor only for creatures it lists, so an unused entry is harmless.
      mirejaw_frenzy:
        'A marsh mudfin that whips itself into a thrashing frenzy mid-fight, the loudest thing in a loud, territorial pack.',
      gravecaller_cultist:
        'Robed servants of the death-cult whose work fouls the graves from the Vale to the peaks. Where they gather, the dead do not rest.',
    },
  },
  family: {
    beast: {
      name: 'Beasts',
      desc: 'Wild animals of forest and field, from wolves and boars to the things that prey on them. Hunters can tame many of them.',
    },
    spider: {
      name: 'Spiders',
      desc: 'Web-spinners and venomous lurkers that nest in dark, tangled places. Hunters can tame them, the same as beasts.',
    },
    mudfin: {
      name: 'Mudfins',
      desc: 'Amphibious marsh-dwellers that swarm the shallows in noisy, territorial packs.',
    },
    burrower: {
      name: 'Burrowers',
      desc: 'Dirt-caked diggers that infest mines and burrows, fiercely guarding their ore.',
    },
    humanoid: {
      name: 'Humanoids',
      desc: 'Bandits, cultists, and others who took up the wrong trade. They fight with tactics, not just teeth.',
    },
    troll: {
      name: 'Trolls',
      desc: 'Hulking brutes that lair in the marshes of the fen.',
    },
    ogre: {
      name: 'Ogres',
      desc: 'Enormous, slow-witted, and dangerous. They camp the high passes and hit like a landslide.',
    },
    undead: {
      name: 'Undead',
      desc: 'The restless dead, raised by darker hands. They do not tire and they do not flee.',
    },
    elemental: {
      name: 'Elementals',
      desc: 'Living storm and stone, bound to the wild places where the elements run strong.',
    },
    dragonkin: {
      name: 'Dragonkin',
      desc: 'Scaled, serpentine things of the old depths. Rare, proud, and far stronger than they look.',
    },
    reptile: {
      name: 'Reptiles',
      desc: 'Cold-blooded hunters with a hiss and a snap all their own, distinct from the warm-blooded beasts.',
    },
    demon: {
      name: 'Demons',
      desc: 'Invaders from beyond the rifts, all fire and spite. Where one stands, a breach is never far.',
    },
  },

  // World / zones.
  // Mounts & Riding: the riding lesson, summoning a mount, the speed tiers, and the
  // show-jumping race at the stables.
  mountsPage: {
    // Mounts and riding. Curated prose, no generated roster: the content generator emits no
    // mount data, and a hand-typed list would drift and would have to name the two catalog
    // mounts with no player-facing acquisition path (src/sim/content/mounts.ts). Spoiler-safe:
    // no move-speed percentages, no drop rates, no per-boss mount table, no race time budget.
    // The plain gates a player is told in game (level 20, 80 gold, 10 gold) are published.
    heading: 'Mounts and riding',
    intro:
      'A mount is a faster way across the world, and that is all it is. You learn to ride at the stables, buy your first set of reins, and every road after that is shorter.',
    whatHeading: 'What a mount is',
    whatBody:
      'A mount is a beast you ride, and what it gives you is speed. No armor, no damage, no stats: it carries you over the ground faster, and springs a little higher when you jump, and that is the whole of the bargain. Every mount in the game is a ground mount, so there is no flying, and none of them swim.',
    learnHeading: 'Learning to ride',
    // Two paragraphs (paras()): the 80g skill purchase first, then the quest, which is only
    // pickable after it (zone3.ts q_riding_lessons requiresRidingTrained). {level} is
    // formatNumber(MOUNT_TRAIN_MIN_LEVEL) from the page module.
    learnBody:
      'Riding is a skill you buy once, and it opens at level {level}. Marla Hitchen, the stablemaster, keeps the Galecrest Stables out on the downs, and she sells Riding Training for 80 gold. That one purchase is what lets you sit a mount at all, and it stays with you for good.\n\nOnce you have it, Marla has a quest for you: Riding Lessons. Take it, follow the marker to the glowing square behind the start arch, and press Start Race. She lends you a training Valorsteed for the lesson, so the lesson itself costs you nothing. Ride the course, finish it, and go back to her for your coin and experience. The lent steed goes back in the barn afterward, so the lesson teaches you the seat rather than handing you a horse.',
    whereHeading: 'Where to find her',
    whereBody:
      'The Galecrest Stables are marked on the map of The Galecrest, out on the downs between the Shear and the Wreckfields. Marla stands beside the barn, facing the race yard.',
    firstHeading: 'Your first mount',
    firstBody:
      'The Valorsteed is the only mount sold anywhere in the world. Once you have learned Riding, Marla will sell you the Reins of the Valorsteed for 10 gold, and those reins are yours to keep. Every other mount is earned out in the world, so the horse is where nearly every rider starts.',
    rideHeading: 'Getting on and getting off',
    // Two paragraphs. The keybind sentence is scoped to desktop on purpose: the shared toggle
    // only ever dismounts (or calls the lesson steed), while the mobile More-tray button also
    // summons through the reins item.
    rideBody:
      'There is no mount window and no favorite to set, because the reins are the mount. Use a set of reins from your bags or from an action bar slot and you ride that mount. Summoning takes a moment, a short call rather than an instant one, so it will not save you from a bad pull. Getting off is instant and never blocked.\n\nUse the reins you are already riding and you put that mount away. Use a different set while mounted and you swap straight to it, with nothing to summon in between. The Mount and Dismount key, the backquote key by default, only ever gets you off: it is the way down, not the way up. The one exception is the riding lesson, where that same key calls the steed Marla lends you, since a borrowed horse has no reins to click. On a phone or tablet, the Mount button in the More tray works both ways, though it calls the first set of reins sitting in your bags rather than one you pick, so tap the reins themselves when you want a particular mount.',
    breaksHeading: 'What puts you back on your feet',
    breaksBody:
      'Water always wins. Ride into anything deep enough to swim in and you are down at once, because no ground mount swims, and dying drops you where you fall. You cannot call one while you are in combat, while you are dead or making your way back as a spirit, or at any point during a Thornhollow Fields match, which is fought on foot from the form-up to the final hold: if you were riding while you waited, being seated into the match puts you down with it. Walking into combat or into water partway through a summon cancels it as well.\n\nMost of what you do puts you down too. Swinging at something, starting a cast, harvesting a node, fishing, crafting, enchanting, salvaging, and recharging a profession tool all dismount you the moment you start, so expect to hop off at every vein. Calling a mount also drops any shapeshift form you are holding: you are never both shifted and mounted.',
    speedHeading: 'Speed and tiers',
    speedBody:
      'Speed is the only thing that separates one mount from another. The Valorsteed you buy from Marla sets the base pace, and the mounts you collect out in the world ride above it: the rarer the reins, the quicker the ride, in a few clear steps rather than a smooth slide. There is no second rank of riding to train and no upgrade to buy afterward. You pay for Riding once, and from then on the reins you used decide how fast you travel.',
    collectHeading: 'Where the rarer mounts come from',
    collectBody:
      "Beyond Marla's counter, reins are found rather than bought. They come off the last bosses of the five-player dungeons and the raid on heroic, and out of rift clears, where the harder the rift you finish the rarer the reins it can leave behind. They are rare finds by design and no run promises one, so the kind way to hunt a mount is to bring the hunt along on the runs you were making anyway. This page will not tell you which mount hangs on which boss: that part is yours to find out.",
    raceHeading: 'The stables race',
    raceBody:
      "The show-jumping course in Marla's paddock is open to anyone, any time, not only during the lesson. Sit a mount, stand on the glowing square behind the arch, and press Start Race. A countdown holds you still, then the clock runs: clear all seven jumps and ride back out through the arch before it runs down.\n\nA jump only counts if you are genuinely in the air over the bar, so an easy ride-through clears nothing. You may take them in any order and from either side, and a missed one is not the end of the world: circle back and take it again. Dying, getting off, or leaving the paddock ends the attempt, and so does letting the clock run out, which sets you down out of the saddle where you stand; cancelling it yourself just stops the clock. Nothing stops you starting another. There is no fee, no cooldown, and no prize beyond the time itself, and any number of riders can run the course at once without getting in each other's way.",
    goodsHeading: 'Reins are ordinary goods',
    goodsBody:
      'A mount is an item, which makes it something the economy can move. You own a mount for as long as its reins sit in your bags or your bank, though banked reins keep the mount yours without letting you ride it: to call the beast you have to be carrying the reins. Player reins carry no soulbind, so they trade, travel by mail, and list on the World Market like any other find, unless the item itself says otherwise. Two things are worth knowing before you part with one: no merchant will ever buy a set of reins back, so a mount is a purchase you keep or pass on rather than cash out, and if the reins leave your bags and your bank both while you are riding, traded away, mailed off, or sold on the market, the mount goes with them and you are set down where you stand.',
  },

  worldPage: {
    heading: 'The world',
    intro:
      "World of ClaudeCraft is one continuous land you cross on foot. The old road runs south to north through the starting valley, the marsh, and the peaks, and it keeps climbing past them into the hollow beyond and the snow country at the top of the map. A column of higher realms opens off that road to the west and another to the east, and an island sits off the Vale's east coast. There is no fast travel, no flight paths, and no taxis: every journey is walked or ridden, so getting there is part of the adventure.\n\nThe land also keeps time. A day and night cycle runs on a real clock shared by everyone on your world, so the sky grades from dawn through noon to dusk and dark for all of you at once, the moon comes and goes through its phases, and the light on the ground changes with it. The dial around your minimap is where you read the hour.",
    hub: 'Home base',
    mapHeading: 'The road and the realms beyond',
    mapSub:
      "The quest trail runs south to north up the middle of the map: valley, marsh, peaks, and on past them into the hollow and the snow beyond. The other realms open off that road rather than after it, through gates east and west of the marsh road, with the island of the Farshore reached from the Vale's east coast. What keeps you out of the far realms is their level bands, not the walk: five of them share the top band, so once you are ready you can take them in any order. The Farshore is the exception, low-level country you can visit early.",
    places: 'Notable places',
    residents: 'Who you will meet',
    valeBlurb:
      'The green starting valley, where new heroes cut their teeth on wolves and bandits around the town of Eastbrook.',
    marshBlurb:
      'A drowned country of fog and ruins. Mudfins swarm the shallows and something older stirs beneath the water, watched from the bridge-town of Fenbridge.',
    peaksBlurb:
      'Wind-scoured ridges and old mine-works climbing to the hardest dangers on the starting road, held by the outpost of Highwatch.',
    duskBlurb:
      'A valley of permanent dusk beneath the great tree of Eldergleam, where crystal ruins glow and the air hums with old magic.',
    emberBlurb:
      'Storm-lit wastes of ash and bloodglass where drakes wheel over the caldera and troll fires burn among the dunes, watched from the gate-town of Wyrmwatch.',
    frostBlurb:
      'A hush of snow and dark pines under the aurora, where the cold itself feels awake and Icemantle keeps its fires burning.',
    amberBlurb:
      'An eternal autumn of gold and red leaves that never fall, gathered around the lantern-lit town of Lanternmere.',
    fenBlurb:
      'A bright, humming wetland of lilies and slow water, crossed on old boardwalks from the bridge-town of Bridgemere.',
    nightBlurb:
      'A realm of starry midnight where flowers light the paths and Moonrest keeps a quiet vigil under a dreaming sky.',
    hauntBlurb:
      'A haunted forest under giant canopies, where the lanterns of Gallowmere are the only honest light on the road.',
    galeBlurb:
      'Sea-cliffs and howling downs where the wind never rests, the Old Beacon never goes out, and Wickharbor shuts its doors tight.',
    jungleBlurb:
      'A tropical tangle of palms, white sand, and loud birds, with the beach-town of Drifthaven keeping a fire lit on the strand.',
    gardenBlurb:
      'A hedge-maze garden realm still trimmed by no gardener anyone has seen, entered past Hedgewick and its fountain courts.',

    // One quotable hub greeting per zone, keyed by biome. Speaker names are proper nouns
    // (passed as raw text in world.ts), so only the spoken line is a key here.
    valeGreeting: 'Keep your blade close. The Vale is not what it was.',
    valeGreeter: 'Marshal Redbrook, Eastbrook',
    marshGreeting: 'Hold at the gate. Past those reeds, the fen does the killing for us.',
    marshGreeter: 'Warden Fenwick, Fenbridge',
    peaksGreeting:
      'Two hundred years this wall has held. It will not break on my watch, but it groans.',
    peaksGreeter: 'Captain Thessaly, Highwatch',
    duskGreeting: 'Few of your kind have stood beneath these boughs. Walk gently, and be welcome.',
    duskGreeter: 'Keeper Saelwyn, Eldergleam',
    emberGreeting:
      'Hot wind off the wastes, dragons over the Drakemaw, and troll fires in the dunes. Drink before you walk out there.',
    emberGreeter: 'The gatewarden, Wyrmwatch',
    frostGreeting:
      'Snow swallows every sound out past the wall. If the lights start dancing, keep your voice down and your fire lit.',
    frostGreeter: 'The hearthkeeper, Icemantle',
    amberGreeting:
      'Every leaf here burns gold and red, yet none ever fall. The lanterns are lit for you; mind the Goldmelt on your way up.',
    amberGreeter: 'The lanternwright, Lanternmere',
    fenGreeting:
      'The fen hums with dragonflies and bees. Cross the bridge, rest your feet awhile, and stay on the boards past the pools.',
    fenGreeter: 'The bridgekeeper, Bridgemere',
    nightGreeting:
      'Past the Nightgate the air itself dreams. Follow the flower-light, and mind the sleeping world that hangs in the sky.',
    nightGreeter: 'The vigil-warden, Moonrest',
    hauntGreeting:
      'Keep to the lanterns, traveler. And if the wood calls your name from off the road, do not answer it.',
    hauntGreeter: 'The lamplighter, Gallowmere',
    galeGreeting:
      'The wind has never once stopped here, and the Old Beacon has never once gone out. Close the inn door behind you.',
    galeGreeter: 'The beacon-keeper, Wickharbor',
    jungleGreeting:
      'Warm sand, loud birds, and a jungle that eats the horizon. We keep a fire lit on the beach; try to come back to it.',
    jungleGreeter: 'The harbormistress, Drifthaven',
    gardenGreeting:
      'Someone is still trimming the hedges, though no gardener has been seen for a hundred years. Mind the maze: it minds you back.',
    gardenGreeter: 'The gatekeeper, Hedgewick',

    // Short, spoiler-safe one-liners for each zone's notable places (keyed by biome). One
    // sentence per place, in the same order as the POI list.
    valePlaceNotes:
      "Eastbrook is your first home base. Wolf Run and Boar Meadow are gentle hunting ground; Mirror Lake is fine fishing water, though mudfins swarm its shallows; the Sableweb and the Copper Dig hide spiders and ore-greedy diggers; a Bandit Camp and the Fallen Chapel hold rougher work; Reliquary Hill drops into the Collapsed Reliquary, the realm's first delve; Brightwood Glade is a quiet, sunlit grove to the north; and the Sowfield is Eastbrook's walled boarball ground, where the Vale Cup plays under a harvest truce.",
    marshPlaceNotes:
      "Fenbridge guards the only dry road. The Prowler Reeds and Deepfen Shallows teem with marsh beasts and mudfins; the Widow Thicket is spun thick with web; the Drowned Chapel and the Troll Mounds keep older dangers, with The Drowned Litany, the marsh's own delve, opening just north of the mounds; the Gravecaller Encampment is the cult dug in, and the Sunken Bastion is the marsh's instanced heart.",
    peaksPlaceNotes:
      "Highwatch holds the wall. Stalker Ridge and the Deeprock Burrows belong to ridge cats and burrowers; the Ogre Foothills and Drogmar's War-Camp to brutes for hire; Stormcrag crackles with elementals, and below it glows the Glimmermere, the tarn whose shore keeps the gate of pale light down to the Drowned Temple; the Wyrmcult Tents and Revenant Fields ring the cult's high ground, with Gravewyrm Sanctum at its peak.",
    duskPlaceNotes:
      'Eldergleam gathers beneath the great tree. The Duskfall Cave and its overlook are the way in and the first sight of the valley; Elder Grove and Starfall Basin keep the quiet south; the Sunken Court holds overgrown ruins in the east; and the Gleaming Deep and Crystalline Shallows glow across the north.',
    emberPlaceNotes:
      'Wyrmwatch holds the gate. The Gatewood is the last green before the waste; the Cinder Dunes drift with ash and worse; the Trollmoot is where the dune trolls gather their fires; the Bloodglass Fields glitter with razor shards; and the Drakemaw Caldera is the smoking crown the drakes circle.',
    frostPlaceNotes:
      'Icemantle keeps the last warm hearth. The Snowline marks where the drifts take over; Glacier Tarn is black, still water under the ice; the Aurora Steps climb beneath the dancing lights; the Shiverfen is a frozen mire that never quite sleeps; and the Howling Terraces earn their name every night.',
    amberPlaceNotes:
      'Lanternmere glows at the heart of the harvest. The Goldmelt is the amber-slick pass in; the Gilded Orchard and Harvest Hollow keep the sweetest pickings and the boldest thieves; the Great Mere mirrors the burning leaves; Cindermaple Rise stands tallest and reddest; and the Leaning Monolith remembers something older than autumn.',
    fenPlaceNotes:
      'Bridgemere sits astride the slow water. The Amberfen Steps come down from the harvest country; the Lilymoors and Bogshine Pools glitter with wisps and dragonflies; Willowweep trails its branches into the mere; and the Drowsy Flats are as gentle as this land gets.',
    nightPlaceNotes:
      'Moonrest keeps the vigil. The Nightgate is the way into the midnight country; the Moonwell holds starlight you can stand beside; Gloamfield blooms in the dark; the Standing Vigil watches without ever moving; and the Sleepless Barrow is the one place here that never dreams.',
    hauntPlaceNotes:
      "Gallowmere huddles inside its lanterns. The Crowgate is the wood's grim front door; Widow's Thicket is spun thick with web; the Hanging Glade and the Mournstone Chapel keep the forest's oldest griefs; and the Huntsman's Clearing belongs to whatever still hunts there.",
    galePlaceNotes:
      'Wickharbor leans into the wind. The Windway is the cliff road in; the Howling Downs roll treeless under the gale; the Old Beacon has burned for as long as anyone can say; the Shear drops sheer to the water; the Wreckfields keep the coast honest; and the Mirror Tarn is the one still thing in the whole realm.',
    junglePlaceNotes:
      'Drifthaven keeps its fire on the beach. The Tanglemouth is where the river meets the green wall; the Palmstrand runs white and warm along the surf; the Emerald Tangle and the Vinefall swallow the interior; the Sapphire Lagoon glows clear and deep; and the Sunken Idol watches from beneath the water.',
    gardenPlaceNotes:
      'Hedgewick waits at the Garden Gate. The Parterre Walk blooms in clipped color; Dawnhold Castle drills its knights behind new walls; the Petal Pond drifts pink the year round; the Old Mill turns over its own ring beds; the Great Maze rearranges its manners for every guest, its arches watched by leafy foxes; the North Watch keeps the exit road; the Lily Basin rests beyond it all; and the Fountain Court still runs clear at the garden heart.',

    // Brightwood Glade vignette, distilled spoiler-safe.
    gladeTitle: 'A quiet corner: Brightwood Glade',
    gladeBody:
      'Not every story in the Vale is about the dead. In the north, a sunlit grove called Brightwood Glade keeps its own gentler rhythm, all quiet paths and dappled light beneath the boughs. It is a soft counterpoint to the trail you are following, and worth seeing when the road gives you room to wander.',

    // The open-world raid boss. Spoiler-safe: his name is broadcast to the whole realm when
    // he rises, so it is public knowledge, unlike the withheld raid boss. No timers, health
    // scaling internals, or loot tables.
    worldBossTitle: 'When the peak wakes: the world boss',
    worldBossBody:
      'High on Thornpeak, the storm over Stormcrag sometimes gathers a shape. Thunzharr, the Waking Peak rises there on a steady rhythm, a raid-strength elemental fought in the open world by whoever answers the call, and he grows mightier the more challengers stand against him. Everyone who joins the fight earns their own roll of his spoils, honored on raid-lockout terms, and his fall lingers long enough for the fallen to run back and claim their due. Gather more swords than you think you need.',
    // The Farshore (farshore_isle). It renders in the vale biome, so before the
    // per-zone key stem in pages/world.ts it inherited Eastbrook Vale's copy.
    farshoreBlurb:
      "An island of gull-cry and salt wind off the Vale's east coast, where rifts tear open without warning and the fishing town of Gullhaven holds its shore.",
    farshoreGreeting:
      'You came over the Ferrywalk? Then you are the first in a week, and the Warden will want to look you over.',
    farshoreGreeter: 'Bellkeeper Tam, the Landing',
    farshorePlaceNotes:
      "Gullhaven is the island's only town and its redoubt. The Landing is where the Ferrywalk comes ashore, with a watchbell standing over the point; the Watch Meadow keeps the high ground southeast of town, where a riftwatcher listens for the next break; the Sundered Cliffs crack open at the island's southern end; and the Riftfields are the wracked grain rows east of Gullhaven, still crawling with what came through the break there.",
    // Getting around: the on-foot rule, the passes and causeways, the one overworld
    // doorway, the graveyards, and the sea at the map's edge. Paragraphs are split on
    // blank lines by paras().
    travelTitle: 'Getting around',
    travelBody:
      "Every road in the realm is walked or ridden. There are no flight paths, no taxis, and no teleport network: the map is one connected landmass, and every connection is something you can stand on. Ridges divide one realm from the next, and where two realms share a ridge the road climbs through a pass. Not every border works that way, though. In the north a long causeway carries the road out over the water from the Veiled Hollow into the snow country beyond, and back south a thin natural sandbar called the Ferrywalk runs east from the Vale's coast to the Landing on the island of the Farshore, which has no land border at all. And there is exactly one true doorway in the whole overworld: a veil of dusk high on Thornpeak that opens into the Veiled Hollow. The Hollow's southern ridge is sealed with no pass through it, so that veil is how you first get in, and it closes behind you on the way back.\n\nWherever you fall, the walk back is a short one. Every zone keeps at least one graveyard with a Pale Keeper hovering over the stones, and a released spirit rises at the nearest of them.\n\nThe map does not end in an invisible wall. The land runs out into beaches and headlands, and then into open water. The crossings the world means you to swim, the straits and meres between one realm and the next, are calm and safe to cross. Strike out for the open sea instead and the distance itself turns you back: you are warned, and warned again, and if you keep swimming the sea wears you down until it kills you. Diving has its own limit, since your breath runs out under the surface, so come up for air and turn around when the water tells you to.",
    // Mounts: the short version on the world page. The full treatment is /wiki/mounts.
    mountsTitle: 'Mounts',
    mountsBody:
      'Riding is the one thing that makes the world smaller, and it is a lesson before it is a horse. At level 20 the stablemaster, Marla, will take you on: you buy the riding skill from her, and the riding lesson itself is free, a jumping course you ride around her paddock on a lent steed. Pass it, turn the lesson in, and your first Valorsteed is yours, and from then on you cross the realm noticeably faster on horseback. Speed is the only thing a mount gives you: the rarer ones, which come from the hardest content, are faster still, but none of them change your power in a fight. Mount and dismount with the key bound in your controls. You cannot climb on while you are in combat, and swinging a weapon, casting a spell, wading into water, or falling in battle all put you back on your feet.',
    mountsMore: 'Everything about mounts',
    // Rift portals as a player sees them out in the world. No rank tuning here.
    riftTitle: 'Rift portals',
    riftBody:
      'Something keeps tearing holes in the realm. Rift portals open by themselves out in the world, never on the three zones of the starting road but across every realm beyond them and out on the Farshore, and the whole realm hears the news when one tears open. Each portal carries a rank, and a higher rank means a harder, richer descent. A portal is a shared event: any group can step through and gets its own run inside, but only one group ever takes the first clear, so a fresh rift is worth hurrying to. You need to be level 20 to enter one, and if nobody answers in time the rift collapses on its own.',
    riftMore: 'Everything about rifts',
  },

  // Quests.
  questsPage: {
    heading: 'Quests',
    intro: 'Quests are the heart of the world and the fastest way to level. Here is how they work.',
    acceptTitle: 'Finding and accepting',
    acceptBody:
      'People with a marker over their head have work for you, and the mark tells you which kind. A gold exclamation mark means a quest you can take right now, and a gold question mark means a quest you have finished and can hand in. On a nameplate you will also see a gray question mark, which means you are on that quest but are not done yet. Repeatable work uses the same marks in blue: a bright blue exclamation mark is a job you have done before and can take again, and the same mark dimmed is one still inside its wait. Every mark but the gray one shows on nameplates, on the minimap, and on the world map, so you can spot work from across town. In Eastbrook, Marshal Redbrook is waiting with Wolves at the Door, one of the first quests you can take.',
    objectivesTitle: 'Objectives',
    objectivesBody:
      'Slay certain enemies, gather items, or interact with something in the world. The on-screen tracker counts your progress as you go. If you change your mind, you can drop a quest from your quest log and pick it up again from its giver later.',
    turninTitle: 'Turning in',
    turninBody:
      'Take a finished quest to its turn-in marker, the map shows you where, for experience, coin, and often a piece of gear chosen to suit your class. That is usually the one who gave it to you, though some quests send you on to someone else.',
    partyTitle: 'Questing in a group',
    partyBody:
      'Party members nearby share kill and objective credit, so questing together is faster, never slower. You can also share a quest with your group: post it to chat as a clickable link with the /share command, and any member who qualifies can pick up the same quest in one click.',
    storyTitle: 'A thread runs through it all',
    storyBody:
      'From your first errands in Eastbrook, something is wrong with the dead. A cult is at work, and the trail leads north through every zone. Follow it to learn who stands behind it.',
    soloNote:
      "The main story is soloable right up to each chapter's finale, which is a five-player dungeon.",

    // Quest types section: the shapes an objective can take.
    typesTitle: 'The kinds of quest you will see',
    typesBody:
      'Most quests are one of a few familiar shapes. The on-screen tracker spells out exactly what each one wants, so you are never left guessing.',
    typeSlayTitle: 'Slay',
    typeSlayBody:
      "Thin out a pack of beasts or break a cult's hold by defeating a set number of a marked enemy. One of your first quests, clearing wolves off the Eastbrook road, is one of these. Now and then a quest wakes up its own targets: something that read as scenery on your last pass gains a nameplate and becomes something you can strike once you are carrying the quest that concerns it, so go back and look again.",
    typeGatherTitle: 'Gather',
    typeGatherBody:
      "Collect items from the world or from what enemies drop: herbs, ore, a cult's grim reagents. Some pieces only fall from a particular foe, so the hunt and the haul go together. Things on the ground that belong to a quest only give themselves up while you are actually on it, and they will tell you as much if you are not, or if you already have enough. Some quests also hand you a tool when you accept them: keep an eye on your bags and use it the way the quest text describes. If a quest needs a tool an earlier step gave you, taking the quest hands it back when you no longer have it, so a lost tool cannot dead-end the chain.",
    typeInteractTitle: 'Interact',
    typeInteractBody:
      'Use, cleanse, or read something fixed in the world: a defiled grave, a warning carved on a shore-rock, a sealed crypt door. Walk up to the marker and act on it. When a quest asks for several, it means several different ones: each object credits you once, so find the next one rather than using the same one twice. The object is not used up when you act on it, so everyone in your party can take their own credit from it.',
    typeMusterTitle: 'Muster the defense',
    typeMusterBody:
      'Some quests have you rally a town before a push north: thin the threat at the gates and gather what the defenders need. These are slay and gather objectives in service of the people whose story you are in, and they keep you moving with them.',
    typeGroupTitle: 'Group finales',
    typeGroupBody:
      "Each chapter of the main story ends at a dungeon door. The lead-in is soloable, but the final blow against a chapter's villain is meant for a party of five.",

    // The villain-ladder saga, teased as a trail north. No endings, no boss names.
    sagaTitle: 'Follow the trail north',
    sagaBody:
      "The main story is one long chase. A death-cult is at work on the realm's graves, and every chapter you close points one zone further up the road. You never fight the whole conspiracy at once; you pull one thread, and it leads to the next hand holding it.",
    sagaValeTitle: 'The Vale: a name on a sigil',
    sagaValeBody:
      'In Eastbrook the dead will not rest, and the mark behind it belongs to a sect long thought gone. Trace it to a Gravecaller working the chapel crypt, and his own papers point you toward the fen in the north.',
    sagaMarshTitle: 'The marsh: a tithe of souls',
    sagaMarshBody:
      'In Mirefen the drownings are no accident. Someone is filling the fen like a tithing box, raising obedient dead from every traveler the water takes. Chase the orders up the chain to a Fogbinder in the drowned bastion, whose last words name something older still, stirring beneath the peaks.',
    sagaPeaksTitle: 'The peaks: what the tithe was for',
    sagaPeaksBody:
      "On Thornpeak the whole scheme comes clear. Every soul stolen since the Vale was a tithe poured toward the cult's grim work in the mountain's heart. The trail that began in a chapel yard ends here, in a five-player descent to face the hand behind it all. We will let you find out who waits at the bottom.",

    // Side-chains, called out as optional threads alongside the main story.
    sideTitle: 'Threads off the main road',
    sideWardenTitle: 'Earning your name',
    sideWardenBody:
      "Alongside the story, the marshals and wardens of the Vale and the fen hand out a standing bounty ladder. Work your way up it, foe by foe, the way every bounty hunter before you earned their place. It is honest leveling and a tour of each zone's worst troublemakers.",
    sideCryptTitle: 'The forgotten king',
    sideCryptBody:
      "High on the peaks runs a quieter mystery: old graves marked with a crown no record remembers. Read the dead, gather what they guarded, and unseal a tomb that was meant to stay shut. It is a detective's trail that opens the way to the realm's ten-player endgame raid.",
    sideTempleTitle: 'The drowned temple',
    sideTempleBody:
      'A gate of pale light on a high tarn in the peaks opens onto a sunken shrine where a drowned cult still sings. Its short chain stands apart from the main story, a self-contained mystery for anyone who climbs to the shore, reads the warnings carved on the rocks, and goes down to see what they were for.',
    // Why an NPC has nothing to offer yet: prerequisite chains (QuestDef.requiresQuest),
    // minLevel, the riding gate (requiresRidingTrained), suggestedPlayers, and the
    // repeatable cadence. Rendered as the second STEPS card, right after accepting.
    availableTitle: 'Why an NPC has nothing for you',
    availableBody:
      'Quests come in chains. Most are offered only once you have turned in the one before them, and many also ask for a minimum level, so an NPC with nothing for you today may have plenty after your next few levels or once you close the quest you are already carrying. A few have a condition of their own, such as the riding lessons, which open only after you have bought the riding skill. Group quests say so up front by listing how many players they suggest you bring. Some jobs are repeatable: you can take them again after a wait, and the marker over the giver tells you when one has come back around.',
    // Escort runs (the `escort` quest objective, src/sim/escort.ts): interact to start,
    // scripted ambush waves pause the walk, credit at the final waypoint. No numbers.
    typeEscortTitle: 'Escort',
    typeEscortBody:
      'Someone needs walking somewhere dangerous. Take the quest, find the person waiting at the start of the road, and speak to them to set off. They walk their own path while you keep pace, and the trouble that lives along it comes for them, not always for you. Stay close: enemies ambush the walk in waves, and the walk only resumes once a wave is down. You cannot attack the person you are escorting, but you can heal them, and if they fall the run simply resets so you can try again. Reach the far end with them alive and you beside them, and the quest credits.',
    // The Card Master (src/sim/content/card_master.ts) and the Card Duel minigame
    // (src/sim/social/card_duel.ts + card_duel_queue.ts). Its rules are the plain kind a
    // player is told in game: best of three, higher card takes the round, the round clock.
    cardMasterTitle: 'Not every NPC has a quest: the Card Master',
    cardMasterBody:
      'One NPC in Eastbrook deals cards instead of errands. Talk to the Card Master, pick the Card Duel line out of his menu, and you join a queue that pairs you with the next player waiting. Any class can sit down, and nothing about your level or your gear comes into it. You each play from your own deck of twenty cards, values one to ten, holding four of them at a time and drawing a fresh one each round: the higher card takes the round, and two matching cards are a push that scores for neither of you. First to two rounds takes the match, so a duel is best of three. Rounds run on a clock, so leave your card unplayed for ninety seconds and the match goes to the other side, unless no round has been scored yet, in which case it is simply thrown out with no winner. The same is true if you walk away from a duel yourself. You have to be standing with the Card Master to join the queue, but once you are matched the board opens itself and you can play from anywhere. It takes two, so the offline world never offers it.',
  },

  // Recurring characters and in-world voices, shared across the World and Quests pages.
  lore: {
    figuresTitle: 'Faces you will come to know',
    figuresBody:
      'A handful of people walk the whole road with you. Watch for these names from the valley to the peaks.',
    aldricRole: 'Priest of the Vale',
    aldricBody:
      'A humble village priest who first names the cult over a defiled grave in Eastbrook, then follows its trail in person through the marsh and up to the wall at Highwatch. He is the steady heart of the whole campaign.',
    marenRole: "The Marshal's Scout",
    marenBody:
      'A low-talking tracker you meet in the reeds of Mirefen, all quiet feet and a short blade. She follows the trail north too, and it is her ear that catches the words that send you to the peaks.',
  },

  // Dungeons and Raids.
  dungeonsPage: {
    heading: 'Dungeons and Raids',
    intro:
      'When the open world is not enough, gather a party and step into an instance: a private copy of a dungeon made just for your group.',
    party:
      'Dungeons are built for a party of five. The endgame raid is for ten. If you do not have four friends on hand, the Dungeon Finder will build a group for the runs it queues. The level band on each card below is the level the run is written for, not a lock on the door: nothing stops you walking in early or coming back later, though the Dungeon Finder will only seat you in a run your level suits.',
    soloLead:
      'Ask around the towns nearby before you go: their quest givers hand out chains that end inside these halls, and carrying one in with you means the run pays twice.',
    levelExact: 'Level {n}',
    levelBand: 'Levels {min} to {max}',
    partySize: '{n} players',
    // Deprecated: the page renders dungeon names and the raid line from the generated
    // roster, so the six keys below are referenced nowhere. Kept only so existing locale
    // overlays stay valid; removing them plus their overlay rows is a maintainer chore.
    levelAround: 'Around level {n}',
    raidSize: 'Ten players, level {n}',
    hollowName: 'The Hollow Crypt',
    bastionName: 'The Sunken Bastion',
    templeName: 'The Drowned Temple',
    sanctumName: 'Gravewyrm Sanctum',
    hollowBody:
      'A grave-robbed chapel crypt where the newly dead refuse to rest. The first real test of a new party.',
    bastionBody:
      'A flooded fortress lost to the marsh, held by drowned defenders and the rising tide itself.',
    templeBody:
      'A moonlit shrine sunk beneath a glowing tarn high in the peaks, reached through a gate of cold light. A drowned cult still sings down there in its rotted vestments, and the warnings carved on the shore say something below only sleeps. A self-contained mystery, set apart from the main story, for the curious and the well-prepared.',
    sanctumBody:
      "The dark heart of Thornpeak, where the cult's long work reaches its terrible peak.",
    wildheartBody:
      'A rain-soaked jungle caldera where two raised hunting trails circle a jade cenote. Cross beast dens and ancestor ruins, then climb the ritual pyramid to see who waits at the top.',
    raidName: 'The endgame raid',
    raidBody:
      'Beyond a sealed royal door waits a ten-player trial: a multi-stage fight and a deathless power the whole raid must shut down together. Earn your way in, then bring nine friends.',

    // Heroic difficulty. Spoiler-safe: what it is, how to set it, the Marks economy and
    // daily rhythm. No multipliers, mark counts, prices, or encounter changes.
    heroicTitle: 'Heroic mode',
    heroicBody:
      'Every five-player dungeon, and the raid itself, has a heroic version waiting past the level cap. The same halls, remade for a geared endgame party: everything hits harder, nothing can be outrun on foot, and the bosses shrug off stuns and snares entirely. Outgrow the normal versions first; heroic assumes you have.',
    heroicHowBody:
      'Choose the difficulty before your group claims the instance: type /dungeon heroic, or pick Set Dungeon Difficulty on your own portrait menu. On your own you set it yourself; in a group only the leader can, and the choice covers everyone and locks in at the door, so a run stays what it was claimed as.',
    heroicRewardsTitle: 'Heroic Marks and upgraded spoils',
    heroicRewardsBody:
      'Heroic bosses drop the loot you know, upgraded and tagged Heroic on the tooltip, and the final boss of each run adds epics found nowhere else. That last kill also leaves Heroic Marks for every participant: a currency spent with Quartermaster Vex in Highwatch, whose counter is a shelf of rings and pendants that nothing but proof of the heroic depths will buy.',
    heroicLockoutBody:
      "Normal dungeons can be run all day. Heroic asks patience: the final boss kill locks everyone in the run to one heroic clear of that dungeon per day, and the raid keeps a daily lockout for each difficulty. On a live realm every daily lockout clears together at the realm's own nightly reset hour, so a clear taken just before that hour and one taken just after fall on two different days; play offline in your browser instead and a lockout simply runs out a day after your own kill. A cleared five-player run stays open to its own party for corpse runs and loot, so nobody is locked away from what they earned there. The raid is stricter: once its kill locks you the door stays shut until the reset, and the only way back through it is a corpse run by someone who fell in the very run that locked them, so a living raider who walks out has walked out for the day. Collect your spoils before you leave the arena. Every one of these lockouts belongs to the character that earned it, so a clear on your main leaves your other characters free.",

    // Reset All Instances: the difficulty-transition escape hatch. Spoiler-safe: no exact
    // cooldown or timer lengths in the prose.
    resetTitle: 'Resetting your instances',
    resetBody:
      'Switch difficulty while your group still holds claimed runs and the old claims linger for a while before clearing on their own. The party leader can let them go at once instead: choose Reset All Instances on their own portrait menu, or type /dungeon reset. A reset works only after the difficulty has actually been changed, only while nobody, living or fallen, remains inside, only once every corpse in there has been looted clean, and a short cooldown separates one reset from the next. Arrive at the door on the wrong difficulty and the game says so before the run starts. The raid is never reset this way; its own lockout rules stand.',

    // Standalone, spoiler-safe lore for the Drowned Temple card (the goddess twist and any
    // boss names are withheld).
    templeLoreTitle: 'The Drowned Temple, a little deeper',
    templeLoreBody:
      'The temple has its own legend, older than the cult you chase elsewhere. On the shore of the Glimmermere, a tarn that drinks the moonlight and gives back the drowned, a lone watcher keeps a gate of pale light. Beneath the surface, a stair of cold stone runs down to it. The folk who sank there did not drown by misadventure: they were the Pale Choir, who went under in worship and never stopped singing. The old wardens scratched a single warning into the rocks before the water took them, a prayer to something they called the Drowned Moon, with a steadier hand adding two words beneath it: it only sleeps.',

    // Teased lead-in from the forgotten-king crypt side-arc to a second raid trial.
    cryptLeadTitle: 'A door the dead were meant to keep shut',
    cryptLeadBody:
      'High on the peaks, away from the main fight, lies a colder mystery. Old graves bear a crown no record remembers, and the dead who guard them once served a forgotten king. Read their stones, gather the keystones they kept, and you can unseal a tomb that three loyal souls died to hold closed, the optional trial that opens the realm to its ten-player raid for those who follow the clues to the end.',
    // The other two instanced formats, so the page is not read as the whole of
    // instanced play. Rifts: world-spawned portals, a private copy per group,
    // floors built fresh each entry (src/sim/rift/portals.ts).
    formatsNote:
      'Dungeons and the raid are one of three instanced formats. Delves are the short descents for one or two, and rifts are the tears that open out in the world and drop a group into a dungeon built fresh every time.',

    // The Dungeon Finder (src/sim/social/dungeon_finder.ts, catalogue in
    // src/sim/content/dungeon_finder.ts). Deliberately unpromising: the catalogue
    // does not cover every live five-man, so the copy says "the runs it queues
    // for", never "every dungeon". No proposal window length, decline cooldown,
    // or listing cap in the prose.
    finderTitle: 'Finding a group',
    finderBody:
      'You do not have to shout in chat to fill a party. Open the Dungeon Finder to see the runs it queues for, pick the ones you would go to, choose the role you will play, and join the queue. The finder builds a full group with the right mix of tank, healer, and damage, then offers it to everyone at once, and you are grouped the moment the party accepts. The list is not only five-player runs: the ten-player raid queues here too, at both difficulties, though the finder never checks whether you have earned your way in, so the door itself can still turn you back. Not every run in the realm is on its list, so glance at it before you count on it for a particular dungeon. One thing it does not do is move you: the finder forms the group and points you at the entrance, and everybody still travels to the door on their own feet.',
    finderRolesBody:
      'Your role choices come from your class before you specialize, and from your active specialization once you have one, so a healer queues as a healer. Past the level talents open at, the finder wants you to have chosen a specialization before it will give you a role at all. Each run on the list also carries its own level band, tighter than the door itself, and every member of a queued party has to sit inside it: the finder will not seat a character the group would have to carry.',
    finderOfferBody:
      'A formed group is offered for a short window, so answer promptly. Let the offer lapse or turn it down and the finder holds you out of the queue for a moment before you can rejoin, which keeps a half-answered group from stalling everyone else.',
    finderBoardBody:
      'Prefer to pick your own company? A party leader can post the group on the premade board instead, tagged with what the run is for: a first run, a quest run, a full clear, a learning run, or a fast one. Other players apply and the leader decides who comes along. There is no free-form advertisement text, only the tags, and one entry on the list is board-only, offered for a posting rather than an automatic queue.',
  },

  // Delves: the short, replayable instanced descents. The roster (name, level floor, party
  // size, keeper, companion, difficulty tiers, run-modifier names) is generated from the sim;
  // these are the explainer strings. Spoiler-safe: no numbers, lock layouts, Marks prices, or
  // loot. Card field labels and the per-section copy.
  // Rifts: portals that open out in the zones, the C/B/A/S ranks, the first-clear
  // race, and what a run leaves you with.
  riftsPage: {
    // Rifts: the procedural instanced descents that open on their own out in the zones.
    // Spoiler-safe: the rank letters, the level gate, the shape of a run, and the race
    // rule are all broadcast to the whole realm in chat, so they are public. NO rank
    // multipliers, mob levels, drop rates, coin amounts, or boss scripts. The "Rift
    // Forge" is deliberately unnamed: the upgrade/enchant/socket seam has no client
    // caller, so no player can reach it.
    heading: 'Rifts',
    intro:
      'A rift is a tear in the world itself, not a door you walk to. Step through one and you get a descent nobody has run before: the floors, the monsters, and the thing waiting at the bottom are all built fresh for that rift alone, so the same rank never plays out the same way twice.',
    whatHeading: 'What a rift is',
    whatBody:
      'Dungeons are places. They sit where they have always sat, and you learn them until you know every corner. A delve is a short private descent you start from a board, cut for one or two. A rift is neither: it opens on its own, out in the world, with no warning, and everything inside it is generated the moment it does. Nobody has a route to hand you, because nobody has been down this one. It is instanced like the other two, so what you find inside belongs to you and your group alone, but it is the only instanced content in the game that comes looking for you rather than waiting to be found.',
    openHeading: 'Where rifts open, and how often',
    openBody:
      'Rifts tear open out in the wider zones of the realm rather than in the early valley, and the whole realm hears about it: a line in your chat names the rank and the zone the moment one appears. Each eligible zone comes up for a rift about once an hour, and a zone that already has one standing waits its turn rather than opening a second. A rift nobody closes collapses on its own after a couple of hours, and the realm hears that too. A zone whose rift was sealed stays quiet until its next turn comes around, so an announcement is worth walking toward while it is fresh.',
    ranksHeading: 'The four ranks',
    ranksBody:
      'Every rift is ranked C, B, A, or S, and the rank rides in the announcement, so you know what you are walking toward before you leave town. C is the gentlest, B and A climb from there, and S is the hardest thing a rift can be. Rank is the dial that decides how mean the floors are, and the harder ranks pay accordingly, so take the one your group can actually hold.',
    // {rank} is the rank letter (C, B, A, S), spliced verbatim: the letters are the
    // proper nouns the realm announcement prints, so they are never translated.
    rankFmt: 'Rank {rank}',
    groupHeading: 'Who goes in',
    groupBody:
      'Bring a group. A rift does not soften because fewer of you walked through it: nothing inside counts how many are standing there, so the rank on the portal is the rank you fight, whether that is five of you or one. The doorway will let you in alone, and people do try it, but a rift is group content at every rank and it is honest about that from the first room. Your party gets its own copy of the rift, so no other group can spill into your run. If you fall, you can walk back in as a ghost and collect yourself once the fighting inside has stopped.',
    // {n} is the level cap, formatted through formatNumber.
    levelNote:
      'Rifts are endgame content. You have to be at the level cap, level {n}, to step through one, at any rank.',
    floorsHeading: 'Down through the floors',
    floorsBody:
      'A rift runs a handful of floors, each one built fresh, and the way down does not open until the floor is finished with you: clear what is living on it, solve whatever it has locked across your path, and the descent tears open. The last floor ends on a boss. Every floor takes a character of its own, so a single run can carry you out of the frost and into the embers, and your chat names each floor as you arrive on it. The tracker on your screen is where you learn how many floors this one has. A few rifts open onto a hand-built set piece instead of a generated descent, which runs to its own fixed length.',
    boundHeading: 'Once you draw blood',
    boundBody:
      "The first kill your group takes inside a rift settles the run, and so does the first off-path cache you crack open. From that moment you are bound to that copy of it: step out for any reason and coming back puts you in the run you left, never in another group's and never in a fresh one, for as long as the entrance out in the world is still standing. Before that first kill, and before that first cache, nothing is settled, so a group that is still gathering can regroup and walk in together without stranding half-started copies behind them.",
    raceHeading: 'The race for the first clear',
    raceBody:
      'Every group in the realm can attack the same rift at once, each in its own copy, and only the first to bring down the thing at the bottom seals it. When a group wins, the realm hears their names and their time, and the way in closes behind them. Losing the race does not end your run: your copy stays open, the thing at the bottom still falls to you, and you still walk out under your own power. What it costs you is everything that clearing it would have paid. The boss leaves nothing behind for the group that came second, so what you carry home is what dropped off the mobs on the way down, and nothing more. The Book of Deeds still counts the clear, because you did put the thing down. It is the only race in the game you can lose without ever laying eyes on the people who beat you.',
    rewardsHeading: 'What you carry out',
    rewardsBody:
      "Sealing a rift, not merely surviving one, is what pays. Bring the rift down first and it pays like the instanced content its rank stands beside, so the harder ranks are worth the harder run. Sealing also puts a Riftbound band in the hands of everyone who was there, cut to your class's role and personal to you, and leaves Rift Essence in your bags besides, with rift gems on top of it at the harder ranks. Beside the way home, the thing at the bottom leaves a sealed cache your group can pick open for extra spoils, using the same Tumbler's Path lockpicking you know from delve chests, so a clean, patient job pays better than a rushed one. None of that reaches a group that came second: a lost race leaves you only what dropped off the mobs on the way down. The Book of Deeds is the exception, and it counts your clear either way, with a deed for closing your first rift and another for taking down an S-rank one.",
    trackerHeading: 'The tracker on your screen',
    trackerBody:
      'While you are inside, a small strip on your screen keeps you oriented: which floor you are on out of how many, and a live countdown. Read that countdown carefully, because it is not your run running out. It is the entrance back in the world closing. Once you are through, your group plays the rift out at its own pace, however long that takes, but when that clock reaches zero the way in is gone for everybody, so think twice about stepping outside near the end of it.',
  },

  delvesPage: {
    heading: 'Delves',
    intro:
      'Delves are short, replayable descents for one or two, with a loyal companion at your side whenever you go down alone. Find the board, choose a run, and climb back out with the spoils.',
    fromLevel: 'From level {n}',
    partyLabel: 'For one or two',
    keeperLabel: 'Keeper',
    // Format strings: the separator and punctuation joining a roster name to its title or role
    // stay translator-controlled, never a hardcoded ", " in delves.ts.
    keeperFmt: '{name}, {title}',
    companionLabel: 'Companion',
    companionFmt: '{name}, {role}',
    tiersLabel: 'Difficulties',
    // Deprecated: the run-modifier section renders affixesHeading/affixesBody plus an
    // unlabeled tag row, so this label is referenced nowhere. Kept only so existing locale
    // overlays stay valid; removing it plus its overlay rows is a maintainer chore.
    affixesLabel: 'Possible modifiers',
    whatHeading: 'What a delve is',
    whatBody:
      'A delve is a small instanced dungeon made just for you and up to one ally, a private copy you cannot be disturbed in. You start it from a board kept by a delve keeper out in the world, drop in, fight down through a handful of rooms, and finish on a single guardian. What waits past that guardian differs by delve: one seals its spoils behind a lock, another asks a rite of you. Runs are quick and meant to be repeated, so a delve is a reliable bit of progress whenever the open world runs dry.',
    howHeading: 'How a run works',
    howBody:
      'Talk to the keeper to open the board, pick a difficulty, and descend. Each run strings together a few short chambers and ends at its guardian; clear it to claim your reward and return to the surface. Bring a friend if you have one, or lean on your companion if you do not.',
    companionHeading: 'Your companion',
    companionBody:
      'A delve sends a companion down with you, so a solo run is never hopeless. She fights at your side, and as you invest in her between runs she grows steadily stronger, until she can pull an ally back from the brink once a descent. She is yours for the delve and waits at the board between runs.',
    lockpickHeading: 'Locks and what they hide',
    lockpickBody:
      'Some doors and caches are sealed, and opening one is a small test of nerve rather than a stat check: solve the lock cleanly and steadily and you earn a better prize than a rushed, fumbled one. It is optional, but the careful delver is the richer one.',
    tiersHeading: 'Difficulty',
    tiersBody:
      'A delve offers more than one difficulty. The higher one makes the enemies stronger and rolls in a run modifier, and pays out more in return. It also asks that you have a few levels under your belt before it will let you in.',
    affixesHeading: 'Run modifiers',
    affixesBody:
      'Harder runs roll a modifier that changes how the descent plays, from restless dead to foul air to failing roof-work. They raise the danger and the reward together. Each delve draws from the modifiers that suit its theme; across the realm, the pool looks like this:',
    marksHeading: 'Delve Marks',
    marksBody:
      'Clearing delves earns Delve Marks, a currency kept apart from your coin. Spend them at the keeper to strengthen your companion and pick up gear you will not find anywhere else.\n\nMarks reward the first runs of your day most. The first three clears each day pay in full, and after that a delve still pays, just less reliably, with the harder tier holding its footing better than the easier one. The count rolls over daily, so there is no need to grind a delve into the ground: come back tomorrow and the good rate is waiting.',
    whereHeading: 'Where to find one',
    whereBody:
      'The first delve, the Collapsed Reliquary, opens at Reliquary Hill in the starting valley of Eastbrook Vale. Brother Halven keeps the board there, and he will send you down once you are ready. His rounds do not end there: past the Troll Mounds at the northern edge of Mirefen Marsh, the same keeper opens The Drowned Litany for delvers who have found their feet.',
    // The ante is chosen before the lock is touched and it sets the prize tier
    // (src/sim/lockpick.ts: 1, 2 or 3 picks; fewer picks pay more and think
    // faster). No step clocks, grid sizes, or Marks amounts in the copy.
    lockpickAnteBody:
      'You settle the terms before you touch the lock. Take three picks and you have room to fumble, but the chest pays its plainest prize; take two for the middle bargain; take one and a clean solve pays the richest of all. The fewer picks you hold, the less time you have to think between moves, and if the last one snaps the lock jams for good: that chest is lost until you clear the delve again.',
    // The Drowned Litany replaces the lock with a shrine rite
    // (src/sim/delves/drowned_litany_rite.ts). Named without the sequence, the
    // shrine kinds, the guardian, or the reward table.
    riteHeading: 'When a delve ends in a rite',
    riteBody:
      'Not every delve ends at a lock. The Drowned Litany closes on a rite instead: once its guardian falls, the shrines around the reliquary light in an order and ask you to answer it back. You choose how hard to make it before it begins, the same bargain the picks ask for. The gentle setting replays the sequence for you more than once and gives you more than one attempt, but it caps what the reliquary will pay; the sternest shows the order a single time, gives you a single attempt, and is the only way to the richest prize.',
  },

  // Talents and Specializations reference.
  talentsPage: {
    heading: 'Talents and specializations',
    intro:
      'Talents are how you make a class your own. They are optional, forgiving, and easy to change, so you can experiment without fear.',
    whatHeading: 'What talents do',
    whatBody:
      'Your talents are a short ladder of choices rather than a pile of points. Each row that opens offers three options, and you take exactly one of them. They shape how a class feels, leaning it toward more damage, sturdier defense, or stronger healing.',
    howHeading: 'How they work',
    howBody:
      "Talents open up at level 5, the same level you choose your specialization. Five more rows follow as you level, one each at 8, 11, 14, 17 and 20, so the last one lands at the level cap. You make your picks in your class's talent panel, on the Choices tab beside the Specialization tab.",
    shareNote:
      'A finished build can be copied to a short shareable code and handed to a friend, who pastes it straight into their own talent panel to load it.',
    choiceNote:
      'Every row is a crossroads: it offers three options and you commit to one of them. Your next reset reopens every one of those choices.',
    resetTitle: 'Nothing is permanent',
    resetNote:
      'You can reset your talents any time you are out of combat and not in an arena match or a battleground, so an early pick is never a trap. A reset clears your row picks and costs nothing, and your specialization stays as it is, so resetting never takes your role away mid-run. Try things, see what you like, and change your mind freely.',
    specsHeading: 'Specializations by class',
    specsBody:
      'Every class has a handful of specializations, each with its own role and a signature focus. You pick one in the talent panel at level 5. It grants a signature ability and a lasting mastery, most of them add passive bonuses that suit the role, and it is also the role you queue as in the Dungeon Finder. Here is the shape of all of them. Open a class for its full kit.',
    // Saved builds: SavedLoadout { name, alloc, bar } with MAX_LOADOUTS = 10
    // (src/sim/content/talents.ts); the client reapplies the saved action bar on switch.
    loadoutNote:
      'You do not have to settle on one build. Save a named layout in the panel and it remembers both its picks and your action bar, so switching to another one is a single click, under the same rule as a reset: out of combat, and not in an arena match or a battleground.',
  },

  // Arena and PvP.
  arenaPage: {
    heading: 'Arena and PvP',
    intro:
      'Want to test yourself against other players? Player versus player is built in, and it is always something you choose, never something forced on you.',
    duelsHeading: 'Duels',
    duelsBody:
      'Challenge any player you meet to a friendly duel. Nothing is on the line but pride, so it is the easiest way to learn a matchup or settle a friendly argument.',
    coliseumHeading: 'The Ashen Coliseum',
    coliseumBody:
      "The Coliseum is the realm's arena, where you face other players in ranked matches, one on one or two on two. Each bracket keeps its own standing, so a win lifts you up that ladder for the whole realm to see. Ranked play opens at level 15, and that applies to your partner too: if either of you is below it, the queue stays closed until you both qualify. All of player versus player lives behind one button, marked PvP: open it and pick a tab, Thornhollow Fields, one on one, or two on two, then sign up alone or with your partner. While you are queued or in a match, the other tabs stay locked, so you can never sit in two queues at once.",

    ladderHeading: 'Climbing the ladder',
    ladderBody:
      'Ranked play tracks your standing over time. Check the leaderboard to see where you sit and who holds the top of the realm.',
    // What ranked play pays. Shapes only, never amounts: a win pays Honor, a
    // same-day rematch against the same opponent or team pays nothing further,
    // a long winning day tapers, and a forfeit moves rating but pays no Honor
    // (src/sim/pvp/honor.ts, src/sim/social/arena.ts endArenaMatch).
    rewardsHeading: 'What ranked play pays',
    rewardsBody:
      "A ranked win pays Honor, the player versus player currency, and a loss costs you nothing but rating. Honor is meant to reward real matches: beating the same opponent or the same team again on the same day pays nothing further, a long winning day pays a little less per win as it goes on, and a match your opponent forfeits still moves your rating but pays no Honor at all. That day is Honor's own, and it rolls over on its own clock rather than with the realm's instance reset.",

    // Honor and the Warfare tier (src/sim/content/pvp_honor.ts, the two
    // warfareVendor NPCs, src/sim/pvp/power.ts). Spoiler-safe: no prices, no
    // rating curve or caps, no set breakpoints, no item budgets.
    honorHeading: 'Honor',
    honorBody:
      'Honor is the currency of fighting other players. You earn it in the Coliseum and out on Thornhollow Fields, it is kept apart from your coin and never mixes with it, and your character sheet shows how much you are holding. There is exactly one thing to spend it on: Warfare gear.',
    quartermastersBody:
      'Two quartermasters keep the same shelves, so trade with whichever is nearer. FURY, the Honor Quartermaster, stands in Eastbrook Vale, and Warmarshal Draven Kole, Master of the Warfare Stores, keeps the counter in Highwatch. Their stock is the Warfare tier: five armor families, plus necks, rings, and weapons shared across all of them.',
    honorFinalNote:
      "Honor purchases are final. A coin purchase can be undone from a vendor's buyback list, but an Honor purchase never lands there, and Warfare gear is soulbound the moment you buy it, so it can never be traded, mailed, or sold back for anything. The shop asks you to confirm for that reason: read the piece before you press it.",
    warfareHeading: 'Warfare gear',
    warfareBody:
      'Every Warfare piece carries Warfare Offense and Warfare Defense Rating, and those two ratings do nothing at all against monsters. They apply only when you fight another player, in a duel, in the arena, or on the battleground, where Offense adds to the damage you deal and Defense cuts the damage you take, each up to its own ceiling. Each armor family is also a set, and its set bonuses are likewise Warfare rating or effects that only work against players, so a full honor kit is worth nothing on a dungeon boss.',
    warfareTradeBody:
      'That is the deliberate trade. Warfare gear is built for fighting players, not as a shortcut past the dungeon tiers: a Warfare piece never carries the combat ratings a dungeon epic in the same slot does, and everything it does bring is spent on other players. If you want to hold your own in the arena, buy it. If you want to clear heroics faster, earn your gear in the dungeons.',
  },

  // The Thornhollow Fields 5v5 capture-the-flag battleground page
  // (docs/design/thornhollow-fields-lore.md). Spoiler-safe: the mode, the field,
  // flags, wave respawns, runes, the ladder; no honor amounts, rating math, or
  // tuning constants.
  thornhollowPage: {
    heading: 'Thornhollow Fields',
    intro:
      'A ranked 5v5 capture-the-flag battleground fought in a walled hollow in the old growth below Thornpeak, where two ruined keeps face each other down the length of a ravine and an older courtyard sits between them that neither has ever held. Two teams of five, two keeps, one goal: steal the enemy banner and run it home before they run yours.',
    queueHeading: 'Queueing up',
    queueBody:
      'Thornhollow Fields opens at level 20, and every member of a party has to meet it before the party can queue. Open the PvP button and pick the Thornhollow Fields tab, which is the one it opens on, then enter the queue solo, or bring a party of up to five and queue together: parties are always kept on one team, and the remaining seats fill with solo champions. When ten stand ready, the match seats both teams at their keeps for a short form-up before the flags go live. If a group of four or five would otherwise face nothing but solo queuers, the matchmaker holds the match briefly to see whether a second group turns up, so a party that size sometimes waits a few moments longer before the gates open. That wait is short and always gives way in the end, so nobody is left sitting in the queue for it.',
    fieldHeading: 'The field',
    fieldBody:
      "A walled, open-air field carved into three chambers: each team has its own field before its keep, and the walled Ruin Courtyard sits between them. Two curtain walls span the full width, and every move between chambers passes a contested crossing: the wide main gate, or the gatehouse, a small room straddling the wall whose offset doors force a jog past an ambush corner. Each keep is sealed except its mouth, so every flag run starts and ends through the same opening, and a low barricade breaks the straight charge into it. The courtyard holds the hollow heart ruin and the two flank Sprint Runes; the other two wait on the flag approaches. A Battle or Ward Rune (more damage dealt, or less damage taken, for a few seconds) waits at each main gate's courtyard mouth: both pads open the match on the same face and flip with every claim.",
    flagsHeading: 'Flags',
    flagsBody:
      'Each keep holds its team flag. Take the enemy flag and carry it to your own stand to score; the first team to three captures wins, and a timed-out battle resolves on score. A slain carrier drops the flag where they fell: an enemy can take it up again, while its own team returns it home instantly just by reaching it. The flag also refuses to hide: picking it up breaks stealth, and a carrier who turns invisible by any means drops it on the spot.',
    pickupNote:
      'Picking a flag up is always a deliberate press of the battleground action key: nobody ever becomes the carrier by strafing through the wrong spot.',
    respawnHeading: 'Falling in battle',
    respawnBody:
      "Death keeps the classic rite: your corpse lies where it fell until YOU release, and the spirit rises in the fenced graveyard beside your keep, warded there until your team's next respawn wave. The wave raises every waiting spirit together, and the two team waves are deliberately staggered, so the fight never fully resets at once. There is no corpse run and no Spirit Healer bargain: release, wait out the wave, fight.",
    carrierHeading: 'Carrying the flag',
    carrierBody:
      'A carrier who holds the enemy flag too long grows more and more vulnerable, taking ever-increasing damage until the flag is captured, dropped, or returned. Hiding with the flag is a losing plan; running it home is the winning one.',
    ladderHeading: 'The ladder',
    ladderBody:
      'Every match moves a persistent per-character battleground rating, win or lose, and the all-time board ranks the realm champions.',
    // What a match pays. Shapes only: result honor, the per-kill and per-assist
    // drip, the day's first-win bonus (surfaced on the queue panel), the
    // repeat-opponent taper, and the forfeit rule (src/sim/pvp/honor.ts,
    // src/sim/social/battleground.ts). No amounts, per the page's own policy.
    rewardsHeading: 'What a match pays',
    rewardsBody:
      "Every finished match pays Honor: more for a win, a consolation for a loss or a draw, plus a small amount for every killing blow you land and every one you help with, so fighting away from the flags is still worth doing. Your first win of each day pays a bonus on top, and the panel tells you while that bonus is still waiting for you. That day is Honor's own, and it rolls over on its own clock rather than with the realm's instance reset. Meeting the same team over and over pays less for the match itself after the first, quickly settling at a floor instead of falling away to nothing, and a forfeited match pays nothing at all. Spend what you earn at either Warfare quartermaster.",
  },
  // The Vale Cup boarball minigame page (docs/prd/vale-cup.md). Spoiler-safe:
  // lore, how to play, nations, roles; no kick powers, timers, or matchmaker
  // internals. Nation/role NAMES render from the shared hudChrome.vcup.* keys.
  valeCupPage: {
    heading: 'The Vale Cup',
    intro:
      'Boarball at the Sowfield: pick a banner, pick a role, and kick a stuffed boar hide past a keeper for the Copper Pail. No blood, no loot, just the roar of the stands.',
    loreHeading: 'Boarball and the harvest truce',
    loreOldSow:
      "Long before the dead woke, Eastbrook's farmhands played boarball on the stubble fields after harvest: two mobs, one boar's hide stuffed with straw, and two wagon gates dragged to either end of the green. The first ball, the Old Sow, hangs bronzed above the tavern hearth.",
    loreTruce:
      'When the Ashen Coliseum began sanctioning war games, Marshal Redbrook answered with something gentler: a standing harvest truce on the old green. The wagon gates became goalposts, the green got walls, stands, and a name, the Sowfield, and the prize was always the same dented milk pail the winners drank from: the Copper Pail.',
    howHeading: 'How to play',
    howQueue:
      'Queue from anywhere through the Vale Cup window, or talk to Groundskeeper Bram at the Sowfield gate. Pick a bracket from one-a-side up to five-a-side, a banner nation, and a sport role; queue solo or bring your party.',
    howMatch:
      'On kickoff your class kit is swapped for a sport kit and restored exactly afterward. Kicks aim at the ground reticle, the ball banks off the boards, and dribbling is just running with the ball. Score more goals than the other side before full time; a draw goes to golden goal.',
    howTruce:
      'Nobody bleeds at the Sowfield: tackles tumble, nothing hurts, and pets sit the match out.',
    spectateBody:
      'One match plays at a time at the stadium, and anyone can walk up and watch from the stands.',
    // Spectator wagering and the bot-backed modes. Spoiler-safe: no stake amounts, caps,
    // wait timers, or matchmaker internals.
    bettingHeading: 'A flutter at the rail',
    bettingBody:
      "Spectators at the Sowfield can back a side while a match is forming: stakes pool together, and at the final whistle the winners split the losers' pool in proportion to what they staked. A drawn match, or an upset nobody backed, refunds every coin. Players seated in the match cannot bet on it, and the rail keeps your lifetime record of wins, losses, and net coin.",
    practiceHeading: 'Practice bouts and the idle pitch',
    practiceBody:
      'The Vale Cup window also offers practice: a private copy of the pitch where bots fill both sides and nothing counts toward your record. Short a player or two for the real thing? After a short wait, bots round out the teams, and any match with bots on the pitch is a friendly, never rated. And when the Sowfield sits idle, the bots put on an exhibition you can watch, and bet on, from the stands; the moment real players ready up, the exhibition yields the pitch and every stake is returned.',
    nationsHeading: 'The eight banner nations',
    nationsBody:
      'Every team plays under a banner. The captain picks the nation, and if both sides fly the same one, the away side plays the inverted palette.',
    nationVale: 'Green and gold, flying the wheat sheaf: the home side, farmhands to the bone.',
    nationMirefen: 'Teal and grey under the heron: patient, long-legged, never hurried.',
    nationThornpeak: 'Ice blue and white under the mountain peak: sure-footed and stubborn.',
    nationColiseum: 'Red and black with crossed swords: they play like it is still a war game.',
    nationChoir: 'Pale blue and silver under the bell: eerie, precise, and very quiet.',
    nationOgre: 'Orange and umber behind the fist: shoulder-first and proud of it.',
    nationMoon: 'Violet and silver under the crescent: night players, light on their feet.',
    nationCopperdig: 'Copper and brown with the pickaxe: diggers who never stop running.',
    rolesHeading: 'Sport roles',
    rolesBody:
      'Your role decides the kit you carry onto the pitch. Everyone kicks; the rest is temperament. In the one-a-side and two-a-side brackets everyone plays the all-rounder kit, so role picks come into their own from three-a-side up.',
    rewardsHeading: 'Truce rules',
    rewardsBody:
      "Truce rules mean no experience and no loot: a decided match counts toward your record and the winners board, and a win also counts toward the day's reward tasks. Deserting a match benches your slot, and the Groundskeeper remembers.",
  },

  // The Book of Deeds (achievements) page. Spoiler-safe: it teaches the system and lists the
  // public catalog by category (names, Renown, rewards). Deed criteria, boss names, and
  // encounter mechanics stay in the in-game Book, never here. Deed names and reward titles are
  // English proper nouns baked from the sim and rendered as raw text, not from these keys.
  deedsPage: {
    intro:
      'The Book of Deeds is where the world keeps score of all you have done, from your first steps out of the starting valley to the hardest fights the realm can offer. Earn deeds as you play, wear the titles they grant, and watch your Renown climb.',
    howHeading: 'How deeds work',
    howBody:
      'Deeds are earned and kept one character at a time, so every hero you play builds a Book of their own; only the realm leaderboard gathers your Renown across every character you play, counting each deed just once. Each deed spells out plainly what it asks of you, right there in the Book of Deeds in game, so you always know what to chase, and you can set a watch on the ones you are after to keep them in sight while you play. A small few stay secret and reveal themselves only once you have earned them. The Book also keeps itself honest: whatever your past record can prove, it credits on the spot, so a veteran never opens it to an empty page; only the counting deeds begin their tally fresh.',
    renownHeading: 'Renown',
    renownBody:
      'Renown is the score behind the Book. Every deed you earn is worth a set amount, and your total only ever climbs, so a quiet week never costs you ground. A handful turn on luck rather than skill, other collection deeds are their own reward, and Feats are an honor apart, so none of those are worth any Renown. Deeds without Renown still count toward completion in your Book; they simply never score. Feats are the one exception, kept outside the count entirely.',
    rewardsHeading: 'Titles and borders',
    rewardsBody:
      'The rewards are all for show, and that is the point. Some deeds grant a title you can wear or a border to frame your name, and never anything that makes your hero stronger. Choose the title you want from the Book of Deeds and it rides along on your nameplate, in chat, and on the boards for everyone to see.',
    chroniclesHeading: 'Chronicles',
    chroniclesBody:
      'Each zone keeps its own Chronicle, a set of deeds gathered by a local Chronicler who has taken it upon themselves to record every traveler who passes through. Saul of Eastbrook Vale is the first of them, Osric Fenn keeps the Marsh Chronicle at Fenbridge out in the Mirefen, and Zenzie records the Peaks Chronicle up at Highwatch. A Chronicle is split into chapters, and you are free to work through them in whatever order suits you.',
    featsHeading: 'Feats',
    featsBody:
      'Feats are a shelf apart: records of legacy and world firsts, the deeds tied to a bygone era or a moment that will only ever happen once. They carry no Renown and sit outside the completion count, kept forever as a memory of what was done.',
    catalogHeading: 'The full roll of deeds',
    catalogBody:
      'Here is every deed the Book can hold, gathered by category. The secret ones are left out on purpose, waiting for you to find them. Open the Book of Deeds in game to see exactly what each one asks.',
    standingsNote:
      'The realms keep a running tally of Renown across every account: the board ranks whole accounts by lifetime Renown, counting each deed once across all your characters, and it shows Renown alone, so deeds that carry none never move the standings even though they count in your Book. To see who stands where, open the Leaderboard in game and turn to its Renown tab; the standings live there, not on the wiki.',
    // Catalog table: the per-category heading format, the column headers, and the two cell
    // labels (a Feat tag in place of a Renown number, and the word Border for a border reward).
    catHeading: '{label} ({count})',
    colName: 'Deed',
    colRenown: 'Renown',
    colReward: 'Reward',
    featTag: 'Feat',
    rewardBorder: 'Border',
    // Category labels, in the page's display order. Hidden deeds are never listed.
    cat: {
      progression: 'Progression',
      combat: 'Combat',
      dungeon: 'Dungeons',
      delve: 'Delves',
      chronicle: 'Chronicles',
      collection: 'Collection',
      pvp: 'PvP and Sport',
      social: 'Social',
      exploration: 'Exploration',
      feat: 'Feats',
    },
    // What the Book itself puts in front of you: the category rail and filters, the Recent
    // strip, the Nearly there list, the online-only rarity line, and the Titles shelf.
    // Interface facts only, never deed criteria (src/ui/deeds_window.ts, deeds_view.ts).
    bookHeading: 'Inside the Book',
    bookBody:
      'The Book sorts every deed into categories you can flip between, with a search box and filters for everything, for what you have earned, for what you have not, and for the ones you are nearly done with. A Recent strip near the top holds your latest unlocks, and clicking one jumps straight to its card, as does clicking a deed name someone posts in chat. Beside it, Nearly there points you at the handful you are closest to finishing. Out in a realm each deed also carries its rarity, the share of adventurers who have earned it, so you can see at a glance which ones are common and which are a real climb; the offline world has no population to count, so it shows none. At the end of the rail sits the Titles shelf, where you choose the one you wear.',
    platformHeading: 'Steam and Epic achievements',
    platformBody:
      'If you link a Steam or Epic Games account from the desktop app, the deeds you earn are mirrored outward as achievements on that account. The game world stays the authority: you earn the deed here, it is recorded on your character, and the achievement follows after. Not every deed has a matching achievement, and if one does not arrive right away it catches up the next time you log in. Linking is only ever a link, never a way to sign in.',
  },

  // "Things I Wish I Knew" beginner page.
  wishPage: {
    heading: 'Things I wish I knew',
    intro:
      'A few honest truths that save new players a lot of second-guessing. None of it is required reading, but all of it helps.',
    i1Title: 'You cannot pick a wrong class',
    i1Body:
      'Every class can hold its own and reach the cap. Choose the fantasy you like, not the one someone else calls best.',
    i2Title: 'Dying barely costs you',
    i2Body:
      "When you fall you rise as a ghost at the nearest graveyard. Run back to your body to revive free, or take the Pale Keeper's instant raise and carry a short-lived weakness for the convenience. No experience, gear, or coin is ever lost, so it is safe to take risks and learn.",
    i3Title: 'Talents are not a trap',
    i3Body:
      'Your first talent comes at level 5, and each of the six rows is a single pick of three, so a build is a handful of choices you can see at a glance. You can reset whenever you are out of combat and not in an arena or battleground match, so nothing you choose early locks you in.',
    i4Title: 'Follow the quest trail',
    i4Body:
      'Quests are the fastest way to level and they lead you across the world. When you are unsure where to go, find the next marker.',
    i5Title: 'Keep your gear current',
    i5Body:
      'A fresh upgrade does more for you than perfect play in old gear. Take the quest rewards that suit your class.',
    i6Title: 'Grouping is a choice, not a chore',
    i6Body:
      'Most of the world is soloable. Team up for dungeons and the raid, or just when you want some company.',
    i7Title: 'Learn your resource',
    i7Body:
      'Rage, mana, or energy, managing it well is half of playing your class. Watch that bar, not only your cooldowns.',
    i8Title: 'Rest between fights',
    i8Body:
      'Eat and drink to recover quickly, especially as a caster. A few seconds now saves a death later.',
  },

  // Interactive 3D model viewer (embedded on class, bestiary, and warlock pages, and
  // the full gallery). The model loads only when the reader asks for it.
  viewer: {
    view3d: 'View {name} in 3D',
    view3dShort: 'View in 3D',
    loading: 'Loading model...',
    error: 'The 3D model could not be loaded. The art above still shows this {name}.',
    dragHint: 'Drag to turn the model. Use the left and right arrow keys when it is focused.',
    canvasLabel: 'Rotatable 3D model of {name}',
    posterAlt: '{name}',
  },

  // 3D model gallery page (/guide/models): browse every class, creature, and demon.
  // World Editor: the separate /editor tool, what it builds, and where maps live.
  editorPage: {
    intro:
      'A map editor of your own, in the browser. Shape the land, plant props and camps, then drop into the result and walk around it.',
    whereTitle: 'Where to find it',
    whereBody:
      'The editor is a page of its own at /editor, apart from the game. It opens on a fresh, untitled map built from the world you already know, so you always start with real ground under your feet. A short guided tour runs the first time you visit, and Help in the top bar can run it again.',

    buildTitle: 'What you can build',
    buildBody:
      'Tools live on the rail down the left, each with a single-letter shortcut shown on its button. Pick one and work straight on the map in front of you. Ctrl+Z undoes and Ctrl+Y redoes, so nothing you try is permanent.',
    toolLandTitle: 'Shape the land',
    toolLandBody:
      'Raise, lower, smooth, and flatten the ground under a brush whose size you set as you go, with a strength dial on the raising, lowering, and smoothing passes.',
    toolSurfaceTitle: 'Paint and flood',
    toolSurfaceBody:
      'Paint biome ground cover over a zone default, and set the one water level that every lake the map declares rises or falls to.',
    toolPlaceTitle: 'Place props',
    toolPlaceBody:
      'Drop pieces from the built-in asset catalog onto the ground. The select tool, the first button on the rail, picks a placed piece back up so you can move, rotate, scale, or duplicate it, and the erase tool lifts one off the map when you change your mind. A placement can be given collision so a player walks around it instead of through it. For the broad strokes, a procedural panel sits under the same tool: scatter a whole category of assets across an area in one go, or raise a run of hills, both worked from the map seed, so the same settings always give you the same result.',
    toolCampTitle: 'Camps and a spawn point',
    toolCampBody:
      'Lay out mob camps that come alive in playtest, and set the spot where a playtest drops the player in.',
    toolBlockerTitle: 'Invisible walls',
    toolBlockerBody:
      'Drag blocker walls that stop movement without showing anything, for an edge you want quietly closed off.',
    toolRegionTitle: 'Copy a whole area',
    toolRegionBody:
      'Box-select terrain and placed assets with the region tool, then paste that selection somewhere else on the map.',

    viewsTitle: 'Two views of the same map',
    viewsBody:
      'The 3D viewport draws your map with the real game renderer, so what you see is what you get: drag to orbit, scroll to zoom. The 2D overhead map is the plan view, better for moving zone markers such as hubs, graveyards, and points of interest, and for framing a large area before you sculpt it. The toggle sits in the top bar.',

    playtestTitle: 'Play your map',
    playtestBody:
      'Playtest hands the map to the game and drops you into it as a warrior. Everything you made is underfoot: camps spawn, blocker walls hold, and placements with collision push you around them. When you have seen enough, come back to the editor and keep working.',
    sandboxTitle: 'A sandbox, not the live world',
    sandboxBody:
      'Custom maps never change the game everyone else is playing. A playtest runs offline in your own browser and never talks to the server, so nothing that happens in it reaches your characters or the shared world.',

    saveTitle: 'Saving your work',
    saveBody:
      'Ctrl+S saves, and while there are unsaved edits a dot sits beside the map name and the Save button calls for your attention. Without an account the editor still works: maps are kept in your own browser, an autosave can be switched on, and Export writes a map out as a plain JSON file that Import reads straight back.\n\nSigned in with your game account, a save also goes to the server, so your maps follow you to another machine. The Open window has one tab for the drafts in this browser and another for the maps saved to your account. If the editor shows an offline badge, sign in to the game in another tab, then reload the editor.',

    shareTitle: 'Publishing and forking',
    shareBody:
      'Maps saved to your account start private. From the Open window you can publish one, which lists it for anyone to browse, and unpublish it again at any time. The Public tab in that same window browses everything other players have published: Open loads one so you can look around how it was made, and Fork drops a private copy into your own list to change however you like. A copy is a new map: editing it never touches the original.\n\nThere is a limit on how many maps one account may keep, so tidy up the experiments you are done with.',

    uploadTitle: 'Bringing your own models',
    uploadBody:
      'Signed in, the Upload button takes a GLB model of your own and adds it to the asset browser beside the built-in catalog, ready to place like any other prop. Uploads are stored on your account, count against a size and storage limit, and can be deleted from the asset browser when you no longer want them.',

    helpTitle: 'Learning the tools',
    helpBody:
      'Help in the top bar opens a reference covering every tool, the keyboard shortcuts, and the mouse moves, and it can restart the guided tour at any time. The rest is poking at things: undo is always a keystroke away, and Export gives you a copy of a map you can always come back to.',
  },

  models: {
    title: '3D Model Viewer',
    lead: 'Inspect the heroes, monsters, and demons of the world up close. Choose a model, then drag to turn it.',
    intro:
      'Every figure here is the same model you meet in the game, rendered live in your browser. Pick one to load it.',
    groupClasses: 'Classes',
    // The in-game shapeshift names (bear_form/cat_form/travel_form in classes.ts).
    groupForms: 'Druid Forms',
    formBear: 'Bruin Form',
    formCat: 'Wolf Form',
    formTravel: 'Fleet Form',
    groupCreatures: 'Creatures',
    groupPets: 'Warlock Demons',
    pickerLabel: 'Choose a model to view',
    // Deprecated: referenced nowhere. Kept only so existing locale overlays stay valid;
    // removing it plus its overlay rows is a maintainer chore.
    count: '{count} models',
    noWebgl:
      'This browser cannot display 3D models. Everything is still listed on the class and bestiary pages.',
  },

  // Gear & Items. Spoiler-safe: systems and direction only, no balance numbers, item
  // names, drop rates, or boss/encounter detail. The quality tiers render their swatch
  // color from the live QUALITY_COLOR table; the label here is always shown alongside it.
  gear: {
    intro:
      'Gear is the equipment your character wears and the items you carry. Better gear is the steadiest way to grow stronger, and you pick most of it up just by playing.',

    // The eleven equip slots (the paperdoll).
    slotsTitle: 'What you can equip',
    slotsBody:
      'You have a main-hand weapon slot, an off-hand slot, seven armor slots, and three jewelry slots: a neck and two fingers. Each class can use only certain weapons and wears armor up to its own weight, cloth, leather, or mail, so the upgrades that fit you are the ones made for your class. Jewelry carries no weight at all: any class wears whatever it earns. Within that, fill every slot with the best piece you find.',
    slotMainhand: 'Weapon',
    slotHelmet: 'Head',
    slotNeck: 'Neck',
    slotShoulder: 'Shoulders',
    slotChest: 'Chest',
    slotWaist: 'Waist',
    slotLegs: 'Legs',
    slotGloves: 'Hands',
    slotFeet: 'Feet',
    slotFinger: 'Finger',

    // Bags and carrying capacity: the four bag sockets in the bags window.
    bagsTitle: 'Bags and carrying room',
    bagsBody:
      'Everything you pick up rides in one shared pack, and you grow it by equipping bags. Your bags window keeps four bag sockets: click a bag in your pack to sling it into a free socket, and every bag you wear adds its own room. Simple bags are cheap vendor goods, roomier ones drop from beasts, and the finest come from dungeon bosses, so your carrying room grows right alongside your gear. Anything that stacks says on its tooltip how many of it one slot will hold, which is how you know in advance that a big potion run is going to cost you two.',

    // Quality / rarity tiers. Color signals quality, but the name is always shown too.
    qualityTitle: 'Quality, at a glance',
    qualityBody:
      'Every item has a quality, and its name is colored to match so you can read its worth at a glance. From most common to most prized:',
    qualityPoor: 'Poor',
    qualityCommon: 'Common',
    qualityUncommon: 'Uncommon',
    qualityRare: 'Rare',
    qualityEpic: 'Epic',
    qualityLegendary: 'Legendary',
    qualityNote:
      'Higher quality usually means better stats, but quality is a hint, not a rule. A well-matched piece for your class and level can beat a flashier one.',

    // Keeping gear current beats perfect play in old gear.
    upgradeTitle: 'Keep your gear current',
    upgradeBody:
      'Replacing an old piece with a fresh upgrade does more for you than playing perfectly in gear you have outgrown. When something better drops or a quest offers it, take it. Do not save your good items for later.',
    itemLevelBody:
      'If you want a quick way to compare two pieces, turn on Show Item Level in the options. Gear with a known source, from enemies, quests, and the crafting trades, then shows an item level, a single figure for roughly how powerful it is based on where it came from, so you can tell at a glance which upgrade pulls more weight, even across different slots. Pieces with no such source, like plain vendor basics and starter gear, show no item level, so a missing figure is normal, not a fault.',

    // Where gear comes from.
    sourcesTitle: 'Where gear comes from',
    sourcesBody:
      'Most of your early upgrades are quest rewards, so it pays to finish quests rather than grind. Enemies drop gear when you defeat them, vendors in town sell solid basics, crafters turn gathered materials into wearable pieces, and the player market lets you buy from other adventurers. At the top of the hill, three earned currencies buy gear found nowhere else: Delve Marks at the delve keeper, Heroic Marks at the heroic quartermaster, and Honor at the honor quartermasters.',

    // Soulbound items. Flag-level only: bound from acquisition, no BoP/BoE tiers exist.
    soulboundTitle: 'Soulbound: yours and yours alone',
    soulboundBody:
      'A few special rewards are soulbound, bound to your character from the moment you earn them. A soulbound item cannot be traded, mailed, sold to a vendor, or listed on the market; it is yours and yours alone. Today that protection guards prize tokens such as Heroic Marks, while the gear you win is yours to trade, sell, or share freely.',

    // Unique-equipped legendaries. Rule-level only: no item names or drop sources.
    uniqueTitle: 'Unique-Equipped: one legendary of a kind',
    uniqueBody:
      'Legendary items are unique-equipped: your character can wear only one copy of a given legendary at a time, and its heroic version counts as the same item. A second copy can ride in your bags, in the bank, or on the market, but trying to wear both at once is refused, and the tooltip carries a gold Unique-Equipped tag so you can see the rule before you plan a build around two of them.',

    // Tier sets and set bonuses. Concept only: no set names, bonus numbers, or the raid boss.
    setsTitle: 'Sets and set bonuses',
    setsBody:
      "Some armor comes in matched families, several pieces cut to look and fight as one. Wear enough of a family at once and the set wakes up, granting bonuses on top of each piece's own stats, and the more pieces you wear the stronger it gets. A few such families turn up as prized drops while you level, and the greatest of them come from the toughest group content near the level cap, so chasing a full set is a classic endgame goal. Fighting other players has matched families of its own, bought a piece at a time with Honor; they wake at different piece counts than the drop families do, and their bonuses only ever answer when the enemy is another player.",

    // Consumables: potions, food, drink, elixirs. No numbers.
    consumablesTitle: 'Consumables',
    consumablesIntro:
      'Some items are used once for a quick benefit. They are cheap insurance, so keep a few on hand.',
    consumablesPotions:
      'Potions restore health or mana the moment you use them, even mid-fight, which makes them a clutch save when a pull goes wrong. Every potion shares one cooldown, a couple of minutes long, so you get one good moment per fight rather than a chain of them. They also restore less than sitting down to eat or drink, which is the price of not sitting. Potions come in tiers cut for each stretch of the world, so carry the tier made for your level: an old low-tier potion is a sliver on a grown character.',
    consumablesFood:
      'Food and drink restore you while you sit and rest between fights. Eating recovers health, drinking recovers mana, and resting this way is free. Sit down for a few seconds after a tough fight instead of running into the next one half-healed.',
    consumablesElixirs:
      'Elixirs grant a temporary buff while you adventure, a small edge that helps when you want to push a little further. They do not share the potion cooldown, so you can drink one and still keep a healing potion in reserve. Two elixirs of the same stat do not stack, and the last one you drink is the one you keep.',

    // Fishing: relaxing side activity. Broad terms only.
    fishingTitle: 'Fishing',
    fishingBody:
      'Fishing is a calm change of pace. Carry a fishing pole, use it beside open water, and reel in what bites. You mostly catch raw fish for the cooking pot, the odd bit of junk to sell for a few coins, and now and then a prized rare catch. What you find depends on the water you fish in.',
    fishingFood:
      'The fish you reel in are cooking ingredients, not trail snacks: cook them at a kitchen (or a specialized field kitchen) into sit-down meals that restore health over rest. Deeper zones stock higher-tier catches for better dishes, so a line in the lake is a quiet way to keep the cook and the party fed between fights.',
    fishingRare:
      'Now and then your line catches something far better than supper: a shimmering prized fish that any angler might luck into in any water. Hook one and your log lights up with the catch. It is the kind of lucky pull that makes an idle afternoon at the lake worth telling people about.',

    // Looks and cosmetics (skins). Appearance only.
    cosmeticsTitle: 'Looks and cosmetics',
    cosmeticsBody:
      'Some rewards change only how your character looks, never how strong you are. These cosmetic skins let you stand out without affecting the game, so wear whichever you like.',
    cosmeticsRanks:
      'Cosmetics come in rarity tiers of their own, and the rarer ones are a fun thing to chase. Earning a higher tier also unlocks the looks below it.',
    cosmeticsSkins:
      "Your character's own appearance comes in two lines. Most classes have several alternate appearances, a fresh take on the class look that is yours to wear. Alongside them sit chromas: named two-tone color schemes that repaint a look entirely, from sober metals to bright imperial colors.",
    cosmeticsCache:
      'A few of these come from a mysterious cosmetic cache, a sealed prize that rolls one of three quality grades when you open it and grants the appearance to match. It is purely for looks: nothing inside it makes you stronger, only finer to look at.',
    cosmeticsApply:
      'Set your active look from the appearance row on your character screen, and switch freely among everything you have unlocked.',
    // The off hand (src/sim/types.ts ALL_EQUIP_SLOTS, the live twelve-slot
    // surface). What may go there is equipment_rules.ts: shields, held caster
    // off-hands (orbs, tomes), the hunter quiver, and a second weapon for the
    // classes that dual wield. No item names, no stats.
    slotOffhand: 'Off Hand',
    offhandBody:
      'What the off hand takes depends on your class. A shield goes there, and so does a held focus such as an orb or a tome, or a quiver for a hunter. Classes that can dual wield put a second weapon in it instead, at a price worth knowing: fighting with a weapon in each hand makes your ordinary swings miss noticeably more often, though it leaves your abilities alone. A two-handed weapon normally needs both hands, so equipping one benches whatever the off hand was holding, unless your specialization is one of the rare ones that can carry two of them at once.',
    // The one-shot bag clean-up (src/sim/inventory_sort.ts, the Sort button in
    // the bags window). Category order matches the module's own list.
    bagsSort:
      'When the pack gets messy, the Sort button in the bags window tidies it in one press. Partial stacks of the same thing are merged together, and everything is laid back out in a readable order: weapons and armor first, then bags, consumables, tools, and mounts, then crafting materials with each fine grade sitting beside its plain version, then quest items, with grey junk last so you can see at a glance what to sell. Nothing is ever created or lost, only rearranged, so it is always safe to press.',
    // Required level (src/sim/item_level_req.ts): derived from where the piece
    // came from, shown on the tooltip. Rule only, no bands or numbers.
    requiredLevelBody:
      'Some pieces also carry a required level, shown on the tooltip. You can loot, buy, or be handed such a piece at any level, but you cannot wear it until you get there. The requirement follows where the piece came from rather than its color alone, so a rare you win at your own level is usually wearable straight away, while a hand-me-down from far above you waits in your bags until you catch up.',
    // The two gear sources the page never named: Honor (the Warfare stores) and
    // rift clears. Vendor names and towns only, no prices or stat budgets.
    sourcesHonor:
      'Honor is what fighting other players pays, and the honor quartermasters, FURY in Eastbrook and Warmarshal Draven Kole in Highwatch, keep the Warfare stores that Honor alone buys: whole armor families, jewelry, and weapons no coin merchant carries. The arena page covers how the Honor itself is earned.',
    sourcesRifts:
      'Rifts add one more source once you are at the level cap, and a rift is a race: the group that clears one first wins its rewards. That first clear pays gear on top of everything else the run leaves behind, including a Riftbound band cut to your class role, a ring you will not find anywhere else in the world. A group that finishes second still finishes its own run and keeps the credit for the clear; what it forfeits are the first-clear rewards. The rifts page covers the race itself.',
    // Bind on trade: the per-copy lock in src/sim/item_instance_transfer.ts. An
    // armed copy may still pass face to face (trade.ts isTradeLocked is boundTo
    // only), which is exactly what stamps it; the anonymous pipes refuse both.
    bindOnTradeBody:
      'A softer version of the same idea also exists: some things bind on trade, meaning they can change hands exactly once and then belong to whoever received them. A crafted piece made on commission binds when the crafter hands it over. A copy under that rule never rides the market or the post, which are anonymous; it passes face to face or not at all, and once it has passed, it is bound. The tooltip says which rule a piece follows, so check before you plan to resell it.',
    // Weapon skins (src/sim/content/weapon_skins.ts): account-wide, cosmetic
    // only, one per weapon type, set from the Armory. No prices, no currency.
    cosmeticsWeapons:
      "Weapon skins are a third line, and they change what you carry rather than who carries it. A skin repaints a weapon type, so the look follows whichever sword, staff, or bow you have equipped, and it never touches the weapon's stats, reach, or speed. Skins unlock for your whole account rather than one character, and they come in collections with rarity tiers like everything else. They are offered in the Armory's seasonal collections rather than found out in the world, and the Armory is also where you set them, one per weapon type, rather than from the appearance row. Everyone standing near you sees the skin you are wearing.",
    // #review reword, as a NEW key (the harvestBodyChoice precedent above the
    // professions block): the retired soulboundBody promised "the gear you win
    // is yours to trade, sell, or share freely", which the Warfare tier in
    // src/sim/content/pvp_honor.ts contradicts (every priced piece there is
    // soulbound: true). An in-place edit would have left every locale's
    // reviewed fill answering the old promise. soulboundBody stays in the
    // catalog at its original English until the release-tier fill retires it.
    soulboundBodyBound:
      'A few special rewards are soulbound, bound to your character from the moment you earn them. A soulbound item cannot be traded, mailed, sold to a vendor, or listed on the market; it is yours and yours alone. That guards prize tokens such as Heroic Marks, and it covers every piece of Warfare gear bought with Honor, so a player-versus-player kit is worn only by the character who earned it. Most of the gear you win from the world is still yours to trade, sell, or share freely.',
  },

  professions: {
    intro:
      'Beyond combat and quests, the world rewards you for working the land and the forge: gathering raw materials, turning them into gear and goods across ten crafting trades, and settling into an identity as one of the ten archetypes those trades represent.',

    // Corpse component harvesting: open to every character, no profession gate.
    // (Rendered on the gathering detail pages.)
    harvestTitle: 'Harvesting the hunt itself',
    // #2514 reword, as a NEW key: the retired harvestBody promised "The choice
    // is yours each time" and set "strip everything the corpse offers" against
    // "concentrate on fewer components". After #2514 a component with nothing
    // behind it yet is simply not taken, so on a beast carrying only one
    // workable component there is no choice to make, and on the rest the two
    // options are counted over what a harvest TAKES rather than what is ticked.
    // An in-place edit would have left every locale's reviewed fill answering
    // the old promise (the hudChrome.corpseHarvest.harvestTooltip precedent).
    harvestBodyChoice:
      'Gathering does not stop at nodes. Many slain beasts can be harvested once each, first come first served, for hides, fangs, silk, and meat, straight from the corpse alongside its ordinary loot; one press opens both. Where a beast carries more than one workable component, the choice is yours: take everything it can give, or concentrate on fewer components and take a measurably finer grade of what you do take.\n\nA rare or better harvest roll on a specimen-bearing family also grants a signed perfect specimen (a Pristine Hide, Pristine Silk, Pristine Venom Gland, or Prime Cut) on top of the ordinary yield, and records A Perfect Specimen in your Book of Deeds. Any character can harvest, no training required, and any gathering tool you own counts toward the premium arm, whichever trade it belongs to.',
    focusTitle: 'Town Focus',
    focusBody:
      'Every hub town keeps a Town Focus panel for visiting harvesters: stand in town, open it from beside the minimap, and spread a budget of 10 focus points across the component types you care about. Every 5 points on a component raises its harvest grade one step (two steps at most), and each point adds 10 percent to its yield; unfocused components are never made worse. Your allocation follows your character everywhere and can be reworked, free, on any later visit to town.',

    craftHowTitle: 'The crafting window',

    // Repurposed from the old "Skill and mastery" section
    // into the overview's honest-pacing section (same mastery topic).
    craftMasteryTitle: 'How long mastery takes',
    craftMasteryBody:
      "Honest expectations: the climb to a craft's 125 cap is at least 125 successful crafts, since each full-gain craft moves you exactly one point, and in practice somewhat more as recipes fade between trainer rungs. The crafting itself is quick; feeding it is the real journey, so budget a few dedicated evenings of gathering and crafting per trade.\n\nThe gathering trades reach their 100 cap over a normal leveling journey if you harvest as you travel, though the last stretch wants the high-tier nodes of the far north. Fishing is the long road by design: by its own gain schedule, 200 proficiency is more than three thousand catches. Master Angler is a title earned over a season of quiet evenings, not a weekend.",

    // This pair of keys backs the overview's "Guild
    // letter and changing your mind" section (same choose/switch topic).
    archetypeChooseTitle: 'The Guild letter, and changing your mind',
    archetypeChooseBody:
      'You do not need to seek any of this out. Work your trades, and once your craft skills first show a clear leaning toward one pair, the Crafting Guild notices and sends a Ravenpost letter naming the master to see and the quest to take. It arrives once per character, and only if you have not already sworn to a pair.',

    archetypeSwitchBody:
      'A declaration is not a life sentence, either. A pair you have never held is simply a fresh attunement quest, while returning to a pair you walked away from asks you to make amends first: five tasks the first time, and three more added for every return you have already made (taking up a brand-new pair never raises the count). The choice stays meaningful without ever locking a door for good.',

    // Professions hub (Professions 2.0 wiki arm, final prose): the
    // overview page renders the generated ring/gathering/archetype data and
    // links every detail page. The transparency policy
    // lets these sections carry exact numbers. Multi-paragraph bodies use
    // '\n\n' and render through the shared paras() helper.
    whatHeading: 'A trade beside the sword',
    whatBody:
      "Professions are the working life of the world: four gathering trades that pull raw material straight out of the land, and a ring of ten crafts that turn it into gear, meals, potions, and tools. Everything feeds something else here. The ore you mine becomes a blade, the blade takes an enchant, and the enchant needs dust broken out of old gear, so a gatherer, a crafter, and a tinkerer are all links in one chain.\n\nThere is no profession limit to agonize over. Every character can raise seven of the eight crafts that have content today and all four gathering professions side by side (Engineering is the one holdout: its recipes all start above the free ceiling, so its ladder waits for the Bombardier's oath); the only exclusive choice is your archetype, the identity you eventually swear to, though once you attune the crafts that fall dormant behind it climb only on their common recipes, and past skill 75 not at all. Skill never goes down, and nothing you learn is ever taken away.",
    ringHeading: 'The craft ring',
    ringBody:
      "Every craft with content today caps at 125 skill: Weaponcrafting, Armorcrafting, Tailoring, Leatherworking, Cooking, Alchemy, Engineering, and Enchanting. At a cap the trade keeps working, harvests still yield, crafts still resolve, and masterworks can still happen; only the number stops climbing. Pick a card below for a craft's full recipe tables and numbers.",
    ringWaveNote:
      'Two crafts on the wheel, Jewelcrafting and Inscription, hold their seats but ship no recipes yet. That is deliberate rather than an oversight: their content arrives with future zones, and the caps above rise the same way, so a capped craft today is a head start on that expansion, not a finish line.',
    capFmt: 'Cap {cap}',
    comingSoon: 'No recipes yet',
    gatherHubHeading: 'Gathering',
    gatherHubBody:
      'Four gathering trades feed the ring from the field: Mining, Logging, and Herbalism pull ore, timber, and herbs out of the land and cap at 100 proficiency, while Fishing runs on its own bite-and-reel rhythm all the way to 200. Each page below carries the exact node maps, tool ladders, and odds.',
    archetypesHeading: 'The wheel and its archetypes',
    archetypesBody:
      "The ten crafts sit on a fixed wheel, and geography on that wheel matters. Every two neighbors form a named pair: Smith for Weaponcrafting and Armorcrafting, Outfitter for Leatherworking and Tailoring, Apothecary for Alchemy and Cooking, Bombardier for Engineering and Alchemy, and six more around the ring.\n\nAttuning to a pair is a quest, not a menu click. Four pairs can be joined today (Smith, Outfitter, Apothecary, and Bombardier), each anchored by a resident master in Eastbrook whose acceptance quest states the whole bargain up front before you take it. Until you declare, every craft advances freely on recipes up through the rare tier (any recipe asking skill 74 or less), so you can try nearly everything before you choose (Engineering alone has no recipe that low, so its number waits).\n\nOnce you attune, your two pair crafts become your majors, with no ceiling short of the cap. The rest of the wheel does not go dark: one craft opposite your majors stays on as a hobby that keeps climbing through the rare tier (a repeatable quest at Smith Haldren's forge lets you swap which one), and every other craft goes dormant. A dormant craft keeps its skill and its common recipes, which keep teaching it on the normal curve until they gray at 75; everything above common stops paying at once, and a dormant craft never turns out a masterwork while it rests.",
    pairFmt: '{a} and {b}',
    curveHeading: 'The Mastery Curve',
    curveBody:
      'Skill gain follows one rule everywhere, the four-state Mastery Curve. Every {step} points of skill is a tier, and each recipe is scored by where it sits against yours: at or above your tier it grants full gain, one tier below grants half, two below a quarter, and three or more below nothing at all.\n\nThe crafting window paints this straight onto the recipe list in the classic colors: orange for full gain, yellow for reduced, green for a trickle, gray for none. Gains are deterministic, never a skill-up roll, so the same craft at the same tier always moves your skill by exactly the same amount, and a recipe turning yellow is your cue to train the next rung.\n\nGathering runs on the same curve with the same tier step, scored against the node instead of a recipe: easy nodes gray out as you pass them, and the richer nodes of the later zones are what finish a climb. Fishing keeps its own schedule: a full point per catch below 50 proficiency, half to 100, a tenth to 150, and a slow tail all the way to 200, with junk catches teaching nothing from 100 on.',
    provenanceHeading: 'Provenance',
    provenanceBody:
      "Fine work in this world remembers its maker: rare or better harvests and crafts arrive signed (Gathered by, Crafted by), a masterwork finishes one quality tier higher with the maker's name always on it, and a commissioned piece binds to its recipient through the Maker's Bond. The Crafting Economy page carries the full rules, from signatures and stacking to unbind fees.",
    stationsHeading: 'Stations and the three hubs',
    stationsBody:
      "Six typed stations serve the seven station-bound crafts, spread across the three town hubs. Eastbrook holds the forge (Weaponcrafting and Armorcrafting share it), the kitchens, the loom, and the toolworks; Fenbridge keeps the tannery, and Highwatch the apothecary. Each station has a resident master beside it who trains recipes, posts work orders, and offers the unbind service.\n\nThe working radius is 20 yards, roughly the station's own yard, so you craft standing at the anvil rather than from across town. Jewelcrafting, Inscription, and Enchanting have no station: the first two await their recipes, and Enchanting works anywhere by design.",
    deedsHeading: 'Deeds that remember the journey',
    deedsBody:
      'The Book of Deeds walks beside every step of this. Your first attunement earns Craftsworn and your first masterwork earns Masterwright, both wearable as titles. Each of the eight earnable crafts marks a milestone deed at 50 skill and crowns its cap with a Grandmaster title, while Fishing gets Old Salt at 100 proficiency and the Master Angler title at 200.\n\nThere are quieter pages too: deeds for your first harvest and first craft, for the rare finds luck turns up in the field, and for taking up salvage. All of it is cosmetic, titles and Renown only. A deed never grants power; it only proves you were there.',
    startHeading: 'Where to start',
    startBody:
      "Fresh off the road in Eastbrook? Find Foreman Odell and take A Trade for Every Hand: he will point you at the ore veins around the Copper Dig southeast of town and hand you your first calluses. Mind the dig itself: the Deeprock Diggers camped on it stand a few levels above a fresh arrival, so work the outlying veins first and save the camp's heart for when you have leveled a little. From then on, harvest every vein, timber stand, and herb patch you pass while questing; proficiency comes naturally to travelers.\n\nBack in town, press T to open the crafting window and work the common recipes every character knows from the start. Visit the masters at the forge, kitchens, loom, and toolworks to see what they teach, and take their work orders for steady coin. By the time the Guild's letter finds you, you will already know which pair feels like home.",
    colStation: 'Station',
    colHub: 'Hub',
    colMaster: 'Master',
    masterCellFmt: '{name}, {title}',
    // #2905/#3015 reword, as a NEW key (the harvestBodyChoice precedent above):
    // HARVEST_COMPONENT_ITEMS now carries eight families (claw and tusk joined
    // hide, fang, silk, venom, cloth, meat) and HARVEST_COMPONENT_SPECIMENS
    // five (pristine_claw joined the list). The retired harvestBodyChoice value
    // keeps its reviewed translations rather than being reworded in place.
    harvestBodyFamilies:
      'Gathering does not stop at nodes. Many slain beasts can be harvested once each, first come first served, for hides, fangs, claws, tusks, silk, venom, cloth, and meat, straight from the corpse alongside its ordinary loot; one press opens both. Where a beast carries more than one workable component, the choice is yours: take everything it can give, or concentrate on fewer components and take a measurably finer grade of what you do take.\n\nA rare or better harvest roll on a specimen-bearing family also grants a signed perfect specimen (a Pristine Hide, Pristine Silk, Pristine Venom Gland, Pristine Claw, or Prime Cut) on top of the ordinary yield, and records A Perfect Specimen in your Book of Deeds. Any character can harvest, no training required, and any gathering tool you own counts toward the premium arm, whichever trade it belongs to.',
    // Re-spec payment tiers (RESPEC_TIER_CONFIG, sim/professions/focus.ts), as
    // a NEW key: the retired focusBody promised a free rework, which is now
    // true of only one of the three tiers. Numbers are literals the way
    // biteBody and toolsNote already carry theirs (this page family publishes
    // exact numbers on purpose).
    focusBodyTiers:
      'Every hub town keeps a Town Focus panel for visiting harvesters: stand in town, open it from beside the minimap, and spread a budget of 10 focus points across the component types you care about. Every 5 points on a component raises its harvest grade one step (two steps at most), and each point adds 10 percent to its yield; unfocused components are never made worse.\n\nYour allocation follows your character everywhere and can be re-aimed on any later visit to town, at a pace you choose. Taking your time is free: the re-aim runs for 1 minute per point you move. Paying a little speeds it up, 15 seconds per point plus 5 copper and 1 Chime Dust per point, and paying in full makes it instant for 25 copper and 5 Chime Dust per point. Only the points you actually move are counted, so nudging a single point is cheap, and a panel you open and close unchanged costs nothing at any tier.',
    // Slotted tool effects (TOOL_EFFECTS in sim/content/professions.ts, the
    // charge and refill rules in sim/professions/tools.ts). Rendered on the
    // three land gathering pages; the fishing page skips it because the
    // harvest path is what reads a slot.
    toolEffectsHeading: 'Tool effects',
    toolEffectsBody:
      "A gathering tool has a slot in it, and an enchanter's charm is what goes in. A Gatherer's Cache adds a unit to what a harvest yields; an Artisan's Eye raises the grade of what it pulls up. Tinker Gizzel, Master of the Toolworks in Eastbrook, teaches both to enchanters who have reached 25 skill in the craft, and both are made at his toolworks.\\n\\nA freshly slotted charm carries 20 charges on a common tool and 10 more for every rarity rung above common, so the same charm slotted on an epic pick starts at 50. A charge is spent only when the charm actually changed the outcome, never on a harvest it did not improve, and a slot can be set to ask each use, so the charm waits until you say Use a Charge. Slotting a fresh charm re-mints the slot around the tool you are carrying at that moment, so it fills to what that tool can hold rather than back to some earlier high mark, and a re-slot that would change nothing at all is turned away instead of eating the charm.\\n\\nRunning out of charges does not destroy the charm: the tool's owner refills the slot, 10 charges for each arcane material spent, and which material it asks for follows the better of the tool you are carrying and the best tool that slot has ever been filled by, Chime Dust for a common or uncommon tool, Chime Essence for a rare one, and a Chime Shard for an epic. Leaving the good tool in the bank does not buy a cheaper refill, only a smaller one at the same price; the honest way down to a cheaper rung is to slot a fresh charm while carrying the lesser tool, which re-mints the slot there. If the slot's ceiling sits above what your current tool can fill, the refill stops where that tool stops and tells you to carry the better one. The refill costs half the materials when you are the enchanter who signed the charm, and less again if you are specialized in Enchanting; anyone else pays the full rate. A refill is a short cast, like the rest of the craft family.",
  },

  // Professions detail pages (/wiki/professions/<id>): the craft pages, the
  // gathering pages, the crafting economy page, and the professions FAQ.
  // English stubs at PR tier (one accurate sentence per slot); the prose
  // stage replaces the bodies. Numbers always arrive as interpolated params
  // from the generated data, never hardcoded in prose.
  profPages: {
    back: 'Back to Professions',
    capLabel: 'Skill cap',
    stationLabel: 'Station',
    stationNone: 'No station needed',
    stationAnywhere: 'Anywhere',
    mastersLabel: 'Masters',
    masterFmt: '{name} ({hub})',
    specializationLabel: 'Specialization',
    specializationFact: 'Skill {at}: {pct}% material discount',
    matFmt: '{name} x{count}',
    outputFmt: '{name} x{count}',
    comboReq: 'Needs {a} and {b}',
    sourceTrainerFee: 'Trainer, {fee}',
    sourceTrainerFree: 'Trainer, free',
    sourceKnown: 'Known from the start',
    gainFmt: '{reduced} / {minimal} / {zero}',
    colRecipe: 'Recipe',
    colSkill: 'Skill',
    colSource: 'Source',
    colStation: 'Station',
    colMaterials: 'Materials',
    colQuality: 'Quality',
    colGain: 'Gain fades at',
    colMaterial: 'Material',
    colTool: 'Tool',
    colTier: 'Tier',
    colPrice: 'Price',
    colZone: 'Zone',
    colNodes: 'Nodes',
    colNodeTier: 'Node tier',
    colToolNeeded: 'Tool needed',
    craftIntro: {
      weaponcrafting:
        "Weaponcrafting is the arms bench of the Eastbrook forge: axes, maces, blades, spears, and even a caster's staff, from copper starters to rare osmium and glyphsteel work. A weapon is the single most felt upgrade a level can buy, so a weapon crafter is the friend everyone remembers to make.",
      armorcrafting:
        'Armorcrafting hammers mail, the heaviest armor a crafter can make, from riveted copper basics to the rare osmiumscale set, with a pair of caster-statted pieces on the side. Its customers are the people standing where the hits land.',
      tailoring:
        'Tailoring weaves the Intellect and Spirit cloth casters live in, from homespun basics through the gildenweave set to rare sunweave work, and sews the Silkspun Satchel, a ten-slot bag no one ever refuses.',
      leatherworking:
        'Leatherworking tans Agility and Stamina gear for the classes that dodge instead of block, from Fenbridge hide basics to the rare mirewarden set, and it is the one deep craft trained out in the marsh.',
      cooking:
        "Cooking turns the day's catch into sit-down meals that heal over 18 seconds of rest, the cheapest healing in the game, from Salted Jerky all the way to Marlow's Grand Roast. Everyone eats, so no craft is more universally welcome in a group.",
      alchemy:
        'Alchemy turns herbs, glands, and glass into bottles that win fights: healing and mana draughts for the moment things go wrong, and stamina elixirs that sit on your buff bar through a whole dungeon.',
      engineering:
        'Engineering builds the tools every serious gatherer ends up wanting: the tier 4 and tier 5 picks, axes, sickles, and fishing rods that no counter will ever sell for coin, each one consuming the tool below it.',
      enchanting:
        'Enchanting takes gear apart and puts the power back in: break unwanted pieces into arcane materials, then spend them on a permanent stat bonus for a piece you mean to keep. Breaking and enchanting need no station and no trainer, and anyone can start on day one; only the two charm recipes ask more, taught at the toolworks.',
    },
    // Per-craft prose sections: craft-specific identity,
    // materials, ladder, and route text the shared sections cannot carry.
    // Item, NPC, and deed names are baked English proper nouns (the
    // GUIDE_DEEDS precedent); numbers follow the transparency policy.
    craftProse: {
      weaponcrafting: {
        identityHeading: 'The edge every fighter shops for',
        identityBody:
          "Someone in every group wants this craft's work, because the rare rung alone covers all three appetites: the Osmium Warblade for Strength melee, the Glyphsteel War Axe for Agility fighters, and the Highpine Battle Staff, an Intellect and Spirit stave for the robe crowd.\n\nOn the craft ring it stands between Armorcrafting and Jewelcrafting. Its living identity is the Smith, the Weaponcrafting and Armorcrafting pair, sworn before Forgemistress Darva at the forge by working three ore veins with your own hands; the Bladewright pair with Jewelcrafting is named on the ring too, but it cannot be sworn yet, since Jewelcrafting ships no recipes until a later zone expansion.",
        materialsHeading: 'What the forge drinks',
        materialsBody:
          "Mining is the backbone. Copper ore comes off the tier 1 veins of Eastbrook Vale, iron ore from Mirefen Marsh, and osmium ore from Thornpeak Heights, and each rung of the ladder steps up the same way. Logging matters more than you might expect: ironbark hafts the boar spear, ashwood shoulders the maul, and a single highpine log forms the battle staff.\n\nThe rest comes from the hunt and the counter. Rough hide for grips is harvested straight off wolf and boar corpses, bone fragments come off the restless dead or out of salvaged common gear, and the forge ladder burns Smithing Flux, 20 copper a jar from Darva herself. If your own mining lags behind, no counter will save you on the ore itself: osmium comes off the Thornpeak veins, off the starter veins of every younger zone but the Farshore (whose veins dig iron), or out of another player's stack, by trade or the World Market. Only the Glyphsteel Bar is bought for coin, from Tinker Gizzel at the toolworks or Quartermaster Bree in Highwatch.",
        ladderHeading: 'The ladder, rung by rung',
        ladderBody:
          'One field recipe, the Eastbrook Arming Sword, is known to everyone from the start and crafts anywhere from hunt drops (a couple of wolf fangs and bone fragments) plus six Smithing Flux off the forge counter. The real ladder is nine trainer recipes in three rungs, all forge-bound: the copper rung (bearded axe, flanged mace, boar spear) is free to learn at skill 0, the iron rung (longsword, maul, dirk) opens at skill 25 for 25 silver a recipe, and the osmium rung (warblade, war axe, battle staff) opens at skill 50 for 1 gold each. Darva teaches a recipe the moment your tier in the craft reaches its own, so each rung unlocks exactly when its skill band begins.\n\nOne more recipe rides the pair: the Gravewyrm Gauntlets, a trainer-taught combination piece that only an attuned Smith with both Weaponcrafting and Armorcrafting at skill 25 can work, and it needs no station at all.',
        routeHeading: 'Masterworks, and a working route to 125',
        routeBody:
          "Any piece with a real stat line, which on this ladder means the iron rung and up, can come off the anvil as a masterwork so long as the finer quality fits inside your tier ceiling; the statless copper commons never proc, because there is nothing in them to improve. Iron and osmium count as tier 1 materials for the masterwork bonus, highpine and glyphsteel as tier 2, and skill sitting above a recipe's own tier adds its own point per tier, so among the osmium three it is the war axe and the battle staff that carry the material edge, and a rung keeps proccing better after you have outgrown it.\n\nRide the copper rung to 25, train the iron rung the day it opens and ride it to 50, then the osmium rung to 75. Past 75 nothing higher ships yet, so the osmium recipes fade to half and then quarter gain: budget roughly 150 more crafts to reach the 125 cap, and each craft takes real cast time, so a long batch is paced by duration rather than a quota.\n\nFund the climb as you go: Darva's forge work order takes eight copper ore off your hands every 30 minutes for a little coin and XP, and the iron and osmium rungs sell honestly to leveling melee. The Book of Deeds marks Edge and Temper at skill 50 and crowns Grandmaster Weaponcrafting at 125.",
      },
      armorcrafting: {
        identityHeading: 'Mail for the front line',
        identityBody:
          "Armorcrafting's ladder reads like a soldier's career: the plain riveted copper girdle, sabatons, and gauntlets to start, the ironlink hauberk, legguards, and spaulders with their first real stat lines, and the rare osmiumscale greathelm, cuirass, and leggings, Strength and Stamina pieces with armor numbers at the very top of a crafter's art.\n\nIt has a quieter side too: the Eastbrook Warded Leggings, a caster-statted field common, and the Kilnscale Mantle, a rare Intellect and Spirit mail shoulder at skill 75, keep the spell-minded mail wearers on the customer list. On the ring it sits between Weaponcrafting and Engineering; the Smith pair with Weaponcrafting is sworn before Forgemistress Darva, while the Gearwright pair with Engineering is named but has no oath quest yet.",
        materialsHeading: 'Ore by the sackful',
        materialsBody:
          'No craft eats ore faster. The ironlink hauberk alone takes five iron ore, and every osmiumscale piece wants three or four osmium plus a glyphsteel bar, so a serious armorcrafter mines Mirefen Marsh and Thornpeak Heights or pays someone who does. Copper feeds the first rung, straight from the veins by the Copper Dig.\n\nAround the metal go the soft parts: rough hide harvested off wolf and boar corpses, bone fragments off the restless dead (or salvaged out of common gear), and Smithing Flux jars (20 copper each at the forge) in nearly every recipe. No counter sells osmium: the impatient buy it off other players or mine it themselves, on Thornpeak or the starter veins of ten of the eleven younger zones (the Farshore alone digs iron).',
        ladderHeading: "Learning at Darva's forge",
        ladderBody:
          "Two field commons, the Eastbrook Chainmail Vest and the Warded Leggings, are known from the start and craft anywhere. The trainer ladder is nine recipes in three rungs at the Eastbrook forge: the copper rung is free at skill 0, the ironlink rung costs 25 silver a recipe at skill 25, and the osmiumscale rung costs 1 gold each at skill 50, with each rung teachable the moment your tier reaches it.\n\nBeyond the ladder sit two specials. The Boundstone Helm is one of the two Smith combination recipes (the Gravewyrm Gauntlets are its sibling on the weaponcrafting side), trainer-taught, station-free, and workable only by an attuned Smith with both crafts at skill 25. The Kilnscale Mantle needs no teacher at all: everyone knows it from the start, and nothing but the forge and the materials gates working it. Its listed skill of 75 is about gain, not permission: with Armorcrafting as a major it pays full skill gain from the very first hammer stroke to 99, so a Smith with osmium to spare can lean on it early. Below a major's ceiling the tier 3 recipe teaches nothing, so an undeclared or hobby armorcrafter works it for the piece, not the points.",
        routeHeading: 'Masterworks, and a working route to 125',
        routeBody:
          "From the ironlink rung up, every craft rolls the masterwork chance; the armor-only copper commons cannot proc, since a masterwork improves stats and they carry none. Iron counts as a tier 1 material for the proc and glyphsteel as tier 2.\n\nThe climb is the standard three-rung ride: copper to 25, ironlink to 50, osmiumscale to 75, training each rung the day it opens. Where Armorcrafting gets lucky is the stretch after 75: the Kilnscale Mantle is a tier 3 recipe, so it pays full gain to 99 and half after, which means the last fifty points take about 75 crafts instead of the 150 a craft without a capstone needs. Each mantle costs seven osmium ore and five Smithing Flux, so stock up in Thornpeak and at the forge counter before you start the run.\n\nDarva's work order buys eight copper ore every 30 minutes for coin and XP, a nice sink for the low-tier ore you outgrow. The Book of Deeds marks Hammer and Plate at skill 50, and Grandmaster Armorcrafting waits at the 125 cap.",
      },
      tailoring: {
        identityHeading: 'Cloth for the casters, bags for everyone',
        identityBody:
          "The ladder climbs from homespun basics through the gildenweave set to the rare rung: the Silkbinder's Raiment and the sunweave pieces. Its second trade is universal: the Silkspun Satchel is a ten-slot bag, and there is no class, spec, or level that does not want more bag space.\n\nOn the ring Tailoring sits between Leatherworking and Inscription. Its living pair is the Outfitter, Leatherworking and Tailoring together, sworn before Weaver Ottilie at the Eastbrook loom after culling four webwood spiders for their silk; the Inkweaver pair with Inscription is named on the ring but waits for Inscription's first recipes before it can be sworn.",
        materialsHeading: 'Thread, silk, and, yes, herbs',
        materialsBody:
          "The loom runs on what the hunt drops and what the fields grow. Linen scraps and homespun cloth come off humanoid kills, spider silk is harvested from spider corpses, and the rare rung's centerpiece, the Silkbinder's Raiment, wants a Pristine Silk, the signed specimen a lucky corpse harvest turns up.\n\nHerbalism feeds tailoring more than any other gear craft: sheenleaf trims the slippers, goldleaf colors the gildenweave set, and sunpetal threads the whole rare rung, so a tailor who picks their own herbs saves steadily. A Spool of Thread costs 12 copper from Ottilie, and the loom asks for no metal at all: even the Wardweave Cowl capstone is woven from premium herbs, Pristine Silk, spider silk, and thread.",
        ladderHeading: "Learning at Ottilie's loom",
        ladderBody:
          "Two field commons, the Eastbrook Wool Trousers and Ritual Vestments, are known from the start and craft anywhere. The trainer ladder runs at the loom south of the Eastbrook well: the homespun rung (hood, mitts, slippers) is free at skill 0, the gildenweave rung (robe, leggings, and the Silkspun Satchel) costs 25 silver a recipe at skill 25, and the rare rung (raiment, mantle, treads) costs 1 gold each at skill 50.\n\nThe Wardweave Cowl needs no trainer: everyone knows it, but it sits at skill 75, loom-bound, as the craft's tier 3 capstone. As everywhere, Ottilie teaches a recipe as soon as your tier in Tailoring reaches the recipe's own tier.",
        routeHeading: 'Masterworks, and a working route to 125',
        routeBody:
          "A Pristine Silk in the raiment covers the masterwork signed-reagent bonus by itself, and goldleaf and sunpetal count as tier 1 and tier 2 materials for the proc, so the rare rung is where the odds peak. Plain, statless work like the satchel never procs: a masterwork improves stats, and a bag has none.\n\nSew the homespun rung to 25, train gildenweave the day it opens and ride it to 50, then the rare rung to 75. From 75 the Wardweave Cowl takes over: a tier 3 recipe, full gain to 99 and half beyond, roughly 75 crafts for the last fifty points, each one costing two Pristine Silk, four spider silk, a pair each of sunpetal and goldleaf herbs, and two thread.\n\nMake the climb pay for itself: satchels sell to literally everyone, and Ottilie's loom work order buys six spider silk every 30 minutes. The Book of Deeds marks A Fine Seam at skill 50, with Grandmaster Tailoring waiting at the 125 cap.",
      },
      leatherworking: {
        identityHeading: 'Leather for the swift',
        identityBody:
          "The ladder climbs from the plain Fenbridge hide leggings, boots, and belt through the uncommon marshstalker jerkin, hood, and spaulders to the rare mirewarden set, the best leather a crafter can cut. Two caster pieces round it out: the Eastbrook Druid's Hide field common and the Duskhide Wraps at skill 75.\n\nOn the ring it sits between Cooking and Tailoring. Its living pair is the Outfitter, Leatherworking and Tailoring, sworn before Weaver Ottilie in Eastbrook; the Trapper pair with Cooking is named on the ring but has no oath quest yet.",
        materialsHeading: 'The hunt is the harvest',
        materialsBody:
          "Leatherworking is the craft where your leveling route and your supply line are the same thing: rough hide is harvested straight off hide-bearing corpses, wolves and boars above all, and each corpse serves one harvester only, first come first served. A rare or better harvest roll also grants a Pristine Hide, a signed specimen the Mirewarden Jerkin calls for, so bank every one you find.\n\nThe supporting cast is small: spider legs and silk, homespun cloth off humanoids, a single osmium ore in each mirewarden rare piece (six in the Duskhide Wraps capstone), and a Tanning Agent at 16 copper from the tannery counter. Osmium itself is never counter-bought: mine it yourself, on Thornpeak or nearly any younger zone's starter veins (the Farshore alone digs iron), or buy it off another player.",
        ladderHeading: 'Trained in Fenbridge',
        ladderBody:
          "Here is the wrinkle: the tannery stands in Fenbridge, on the Mirefen Marsh road, making Leatherworking the one deep craft trained out in the marsh. Tanner Hesk teaches the ladder at his vats: the Fenbridge hide rung free at skill 0, the marshstalker rung at 25 silver a recipe from skill 25, and the mirewarden rung at 1 gold each from skill 50, each rung opening as your tier reaches it.\n\nThree recipes skip the trainer: the field commons (the Tanned Leather Jerkin and Eastbrook Druid's Hide) craft anywhere from the start, and the Duskhide Wraps are known to everyone but sit at skill 75, tannery-bound. Note that the Outfitter oath itself is sworn back in Eastbrook with Ottilie; only the teaching happens in the marsh.",
        routeHeading: 'Masterworks, and a working route to 125',
        routeBody:
          "Any piece with real stats rolls the masterwork chance so long as the finer quality fits inside your tier ceiling, the statted Eastbrook Druid's Hide included, and a signed Pristine Hide in a Mirewarden Jerkin provides the signed-reagent bonus automatically; osmium counts as a tier 1 material for the proc. The statless hide commons cannot proc.\n\nLevel it the natural way: harvest every wolf and boar you kill from level one, let the two field commons carry you to 25 wherever you stand, then train the hide rung at the vats when the quests pull you into the marsh anyway. Marshstalker carries you to 50 and mirewarden to 75; past that the Duskhide Wraps, a tier 3 recipe at six osmium ore, three Pristine Hide, two rough hide, and a Tanning Agent, pays an attuned Outfitter full gain to 99 and half after, about 75 crafts for the final fifty points to the 125 cap; below a major's ceiling the tier 3 recipe teaches nothing.\n\nThe mobile tannery matters more for this craft than any other: specialize at 75 and a saddlebag of hides becomes finished gear at the campfire instead of a walk back to Fenbridge. Hesk's tannery work order buys eight rough hides every 30 minutes, a tidy return on skins you were collecting regardless, and the Book of Deeds marks Tanner's Trade at skill 50 with Grandmaster Leatherworking at the cap.",
      },
      cooking: {
        identityHeading: 'The pot that feeds the party',
        identityBody:
          "Eat a cooked meal and it heals you over 18 seconds of rest, which between pulls is the cheapest healing in the game. The ladder runs from a 90-health Pan-Seared River Perch all the way to Marlow's Grand Roast at 980, a sit-heal nothing in the game beats.\n\nOn the ring Cooking sits between Alchemy and Leatherworking. Its living pair is the Apothecary, Alchemy and Cooking, sworn before Cook Marlow at the Eastbrook kitchens after hunting four wild boars for the pot; the Trapper pair with Leatherworking is named on the ring but has no oath quest yet.",
        materialsHeading: 'A pantry fed by rod and knife',
        materialsBody:
          "Fishing stocks the signature ingredients, zone by zone: raw mirror trout and river perch from the waters of Eastbrook Vale, marsh pike and bog eel from Mirefen Marsh, frostgill trout and slatefin carp from Thornpeak Heights. Raw catches never restore health on their own: they are kitchen reagents, and the cooked meals are what you eat. The rungs mix the zones freely (the free rung already wants marsh pike, the mid rung Thornpeak's frostgill, and the rare supper folds the Vale's mirror trout back in), so a cook who fishes wherever the road goes never runs dry.\n\nThe butcher's side comes off harvested corpses: game meat from boars and their kin, and, on a rare or better harvest roll, a signed Prime Cut, the centerpiece of the grand roast. Herbs season the better dishes, one ashwood log smokes the eel, and Cooking Salt runs 8 copper a pouch from Marlow's own stall.",
        ladderHeading: 'From jerky to the grand roast',
        ladderBody:
          "Salted Jerky is the field recipe: known from the start, one spider leg, craftable anywhere, the trail food of every fresh adventurer. The trainer ladder cooks at the Eastbrook kitchens on the east side of the square: the free rung at skill 0 (the perch, Hunter's Game Skewer, Herbed Marsh Pike), the mid rung at skill 25 for 25 silver a recipe (Ashwood Smoked Eel, Goldleaf Game Stew, Frostgill Chowder), and the rare rung at skill 50 for 1 gold each (Silvered Carp Supper, Angler's Feast Platter, Marlow's Grand Roast).\n\nBatch dishes stretch your ingredients: the smoked eel and the game stew serve two per craft, and the feast platter serves three. Marlow teaches each rung the moment your tier in Cooking reaches it.",
        routeHeading: 'Specialization, not masterworks, and the route to 125',
        routeBody:
          "Cooking is the honest exception to the masterwork story: a meal has no stat line to improve, so dishes never proc one, and no cook should chase it. The craft's mastery is specialization at 75: a fifth less of every ingredient, which compounds fast on batch dishes, and a mobile field kitchen so the feast gets cooked at the dungeon door.\n\nCook what you catch: pair the climb with a fishing session and the two skills feed each other all the way up. Jerky and the free rung carry you to 25 at a point per craft, the mid rung to 50, and the rare rung to 75; past 75 no higher dish ships yet, so the rare dishes fade to half and then quarter gain, roughly 150 more crafts to the cap. Treat it as stocking, not grinding: a guild eats every serving.\n\nMarlow's kitchens work order buys eight game meat every 30 minutes for coin and XP, and the Book of Deeds marks Seasoned Chef at skill 50 on the way to the Grandmaster Cooking title at 125.",
      },
      alchemy: {
        identityHeading: 'Bottles that win fights',
        identityBody:
          'The craft is worked at the apothecary in Highwatch, home of Alchemist Verane, Master of the Apothecary, who teaches the recipe ladder, sells Glass Vials at 12 copper, and pays coin for herbs through her work order.\n\nOn the craft ring, Alchemy sits with the trial-and-error trades, next to Engineering on one side and Cooking on the other. That gives it two pair identities: the Bombardier (Engineering and Alchemy, taken up before Tinker Gizzel in Eastbrook) and the Apothecary (Alchemy and Cooking, sworn before Cook Marlow). Attune to either pair to make Alchemy a major and let your own signed work teach you back; the Bombardier pair also opens its combination brew, the Elixir of the Bear, while the Apothecary pair ships no combination recipe yet. The ladder itself never waits, though, because every Alchemy recipe sits inside the rare tier that undeclared crafts work under, so the whole climb to the cap is open before any oath.',
        materialsHeading: 'Herbs, glands, and glass',
        materialsBody:
          "Every draught wants a Glass Vial plus herbs matched to its rung: sheenleaf grows in Eastbrook Vale, goldleaf in Mirefen Marsh, and sunpetal in Thornpeak Heights, one herb per zone, so your bottles climb the world alongside you. Herbalism is the natural partner skill, though buying from gatherers or the market works just as well; deeper zones hold higher-tier patches that ask for a better sickle, so keep your tool current if you pick your own.\n\nThe elixir line adds a hunter's ingredient: Venom Glands harvested from venomous corpses, and the top elixir asks for a Pristine Venom Gland, the signed rare specimen a lucky corpse harvest turns up. If you do not harvest yourself, those are exactly the goods worth asking a hunter friend to bring back.",
        ladderHeading: 'The recipe ladder',
        ladderBody:
          'Everyone knows the Minor Healing Potion from the start and can mix it anywhere, no station needed. The real ladder is nine recipes taught by Verane at the apothecary, three at each rung: the skill 0 recipes are free, the skill 25 rung costs 25 silver per recipe, and the skill 50 rung costs 1 gold per recipe. Each rung is a healing draught, a mana draught, and a stamina elixir, stepping from common sheenleaf bottles (120 health, 160 mana) through uncommon goldleaf (200 health, 260 mana) to rare sunpetal (280 health, 360 mana).\n\nThe elixirs climb the same way: the Elixir of the Boar grants 6 Stamina for 10 minutes, the Vipersear Elixir 9 for 15 minutes, and the Elixir of the Serpent 12 for 15 minutes, the Serpent alone brewing two bottles per craft. One more recipe sits off to the side: the Elixir of the Bear, a combination brew Verane teaches for 25 silver once your Alchemy reaches 25, mixable anywhere, but only by an attuned Bombardier with both Alchemy and Engineering at 25.',
        routeHeading: "A brewer's route to 125",
        routeBody:
          "Draughts and elixirs never roll masterworks; that proc belongs to stat-bearing gear. Your name still travels, though: the rare sunpetal draughts arrive signed with a maker's mark, and so does every bottle of the double-batch Elixir of the Serpent, so nothing rare in this craft leaves the bench unsigned. At skill 75 you specialize, and every Alchemy recipe costs 20 percent fewer materials from then on.\n\nTake Herbalism early and pick as you level: sheenleaf is everywhere in the Vale, and once you reach Verane's bench the free rung will carry you cleanly to skill 25 on herbs you would have picked anyway. Learn the 25 rung the moment it turns on, move your picking to the marsh for goldleaf, and let Verane's work order (six Goldleaf Herbs for 45 copper, repeatable every 30 minutes) hand a little coin back as you go.\n\nFrom 50 on, brew sunpetal draughts and Serpent batches out of Thornpeak sunpetal, with a little Vale and marsh greenery still in the mix. The last stretch from 100 to 125 is a deliberate trickle, so brew what actually sells rather than burning herbs for the number, and remember that consumables are the one crafted good everyone re-buys forever. The Book of Deeds marks Strange Brews at skill 50 and Grandmaster Alchemy at the cap.",
      },
      engineering: {
        identityHeading: "The toolmaker's monopoly",
        identityBody:
          "The craft is worked at the toolworks in the southwest corner of Eastbrook Square, home of Tinker Gizzel, Master of the Toolworks. Tiers 1 through 3 of every tool line are ordinary vendor stock; tiers 4 and 5 come off an engineer's bench, or out of the Drowned Litany's delve counter for Delve Marks behind its clears gates, and never out of any till for coin.\n\nOn the ring it sits with the trial-and-error trades, next to Alchemy and Armorcrafting, giving it two pair identities: the Bombardier (Engineering and Alchemy, taken up before Gizzel himself) and the Gearwright (Armorcrafting and Engineering, named but not yet swearable). One warning matters more here than anywhere else: every one of Engineering's recipe rungs sits above the rare-tier ceiling that hobbies and undeclared crafters work under, so the skill number only moves for a crafter whose majors include Engineering, which today means the Bombardier. Anyone can still build the land tools; an unattuned crafter just learns nothing from doing it, and the two rod recipes ask for Gizzel's teaching besides.",
        materialsHeading: 'Reagents and prior tools',
        materialsBody:
          "Every land tool recipe consumes the tool one tier below it plus a FINE material, and that pairing is the whole land ladder: four Fine Iron Ore and a Skysilver Mining Pick become the Osmium Mining Pick, then two Glyphsteel Bars, two Fine Osmium Ore and that osmium pick become the Glyphsteel Mining Pick. The axe and sickle lines mirror the fine-plus-prior-tool shape with Fine Ashwood and Fine Highpine Logs, Fine Goldleaf and Fine Sunpetal Herbs, though their tier 5 rungs ask no Glyphsteel Bars: the pick is the one line that gets dearer at the top. The two rod recipes break the pattern on purpose: the Stormreel takes four Sunglint Koi and a Silverstream rod, the Tidewrought two Koi, eight Raw Slatefin Carp and that Stormreel, so the top of the angler's ladder is paid for on the water rather than at a vein.\n\nA fine material is not sold anywhere and does not drop from an ordinary harvest: you get it by working one of a zone's full-grade veins with a tool ranked above the material itself, which in practice means the tool one rung below the one you are trying to build (the easier veins a zone keeps for travellers yield the plain material whatever you swing). That is deliberate. On the craft route, a tier 5 tool comes from actually swinging the tier 4 one, not from a shopping trip; the Delve Marks counter is the one way around it. The single exception is the Glyphsteel Bar, refined and vendor-only, 1 silver 60 copper a bar from Quartermaster Bree in Highwatch or from Gizzel's own counter, so the Glyphsteel Mining Pick alone carries a fixed coin floor built into its cost.",
        ladderHeading: 'The tool ladder',
        ladderBody:
          "The ladder is eight recipes, all bound to the toolworks station. The six land-tool recipes are known automatically, no trainer fee ever: the tier 4 pick, axe, and sickle at skill 75, and the tier 5 versions at skill 150. That second number is not a typo, and it sits above the current 125 cap on purpose: skill requirements never gate a craft here, they only shape skill gain, so you can build a tier 5 tool the day you hold its reagents and its tier 4 predecessor. The two crafted rods are the taught exception: Gizzel teaches the Stormreel at skill 75 for 4 gold and the Tidewrought at skill 125 for 16 gold, each the moment your tier in the craft reaches its own.\n\nEvery finished tool is rare or epic quality and comes out signed, so your name rides the zones on other players' toolbelts. Engineering also holds up half of one combination recipe: the Elixir of the Bear, brewed by an attuned Bombardier with both Engineering and Alchemy at 25.",
        routeHeading: "An engineer's route to 125",
        routeBody:
          "Tools carry no combat stats, so they never roll masterworks; that proc belongs to stat-bearing gear. Specialization still lands at skill 75: 20 percent fewer materials per craft, and a temporary field toolworks that turns any gathering trip into a workshop. The gain math barely fades here: the skill 75 recipes pay full gain until 100 and half after, and the skill 150 recipes pay full gain all the way to the 125 cap, so the real constraint is reagents and coin, never gray recipes.\n\nPick your pair first, because nothing moves without it: take the Bombardier attunement from Tinker Gizzel. Then feed the ladder: level Mining, Logging, or Herbalism yourself or befriend gatherers, buy the tier 3 tools from vendors, and treat Gizzel's work order (eight Ironbark Logs for 16 copper, repeatable every 30 minutes) as walking-around money.\n\nEngineering is a low-volume prestige trade, roughly one skill point per finished tool, so treat every craft as stock for sale. The pitch to your customers writes itself: each tool tier above a node's own trims 0.4 seconds off the 2.5 second harvest cast (down to a 1.5 second floor), so a tier 5 tool is a speed upgrade on every node in the world, and only you can make one. The Book of Deeds marks Cogs and Sprockets at skill 50 and Grandmaster Engineering at 125.",
      },
      enchanting: {
        identityHeading: 'Gear apart, power back in',
        identityBody:
          "Every enchant is known from the start, anyone can disenchant from day one, and neither ever needs a station; the skill caps at 125 like every craft. The one taught corner of the trade is its pair of charm recipes: Tinker Gizzel teaches the Gatherer's Cache and the Artisan's Eye at the toolworks in the southwest corner of Eastbrook Square, for the ordinary tier fee once your Enchanting reaches 25, and the charms themselves are worked at his station.\n\nOn the ring it sits between Inscription and Jewelcrafting, so its two pair identities are the Arcanist (Inscription and Enchanting) and the Gembinder (Enchanting and Jewelcrafting). Neither can be sworn yet, since both neighbors await their first recipes, so today Enchanting climbs as everyone's craft: free to the rare tier before any oath, and a natural hobby pick for a Bombardier or an Apothecary. Enchanters also keep the gathering world running: the two slottable tool effects are Enchanter work, and an original crafter recharges their own effects at a discount, deeper still once specialized.",
        levelingHeading: 'How enchanting levels',
        levelingBody:
          'Three actions move the skill: disenchanting a piece, applying an enchant, and crafting the two charms, which climb the ordinary crafting curve. Each success is worth up to one point, scaled by how serious the work is: the rarity of the piece you break, or the reagent tier of the enchant you apply. Common disenchants and dust-only enchants score as common work; uncommon disenchants and essence enchants as uncommon; rare disenchants and every Runed or Greater enchant as rare; epic and legendary disenchants rank higher still on the table, though no enchanting identity today reaches past the rare rung, so they pay the same as rare work in practice. One honesty rules the breaking bench: a piece that came off a player bench (crafted, signed, or masterworked) still mills into materials but teaches nothing, so a craft-and-break loop levels no one, and the lessons are in world-found gear.\n\nThe familiar mastery fade applies on 25-point tiers, so common-grade work goes gray at skill 75, uncommon work at 100, and rare-tier work exactly at the 125 cap. Enchanting also has one kindness of its own: input above your archetype ceiling is rounded down to that ceiling instead of zeroed, so before you attune, an epic disenchant simply scores as rare rather than teaching nothing. If Enchanting ends up dormant behind another identity, breaking and applying score as common work and the climb stalls at 75, while the two charms, riding the crafting curve above the common ceiling, teach a dormant enchanter nothing at all; keep it as your hobby and rare-tier work still pays, just slower past 75.',
        marketHeading: 'Enchanted copies, provenance, and the market',
        marketBody:
          "Applying an enchant spends the reagents and marks one specific copy of the item. Point it at a bagged copy and you get back a distinct enchanted copy; point it at a piece you are already wearing and it is enchanted in place, right where it sits, with no unequip and re-equip dance. Either way the bonus follows that piece forever, through unequips, bank trips, and trades. One enchant per piece: applying a different enchant to an enchanted copy asks for confirmation, then replaces the old enchant outright, destroying it with no refund of its materials. Selling, discarding, and disenchanting all prefer plain copies first, so your finished piece does not get eaten by accident.\n\nMasterwork gear and enchanting are friends: a masterwork piece stays fully enchantable, and the enchant adds on top of the masterwork bonus without disturbing it or the maker's signature. Stacking every source, a signed masterwork carrying a Greater enchant is the best a crafted piece gets, and it still sits below raid loot by design.\n\nOn the market, an enchanted or signed piece lists like anything else: it goes up as its own single-copy listing, the tooltip shows the enchant and the maker's mark, and the Ravenpost carries it just as faithfully. The materials remain the steady half of the craft: Dust, Essence, and Shards list freely, listing costs nothing, and the Merchant takes 5 percent of a completed sale only. That makes the two classic enchanter incomes selling materials, and selling finished work: over the market, by raven, or face to face in a trade window.",
      },
    },
    howHeading: 'How crafting works',
    howBody:
      "Open the crafting window (default key T) and every recipe you know is listed with what it needs and what you have on hand. Station-bound recipes ask you to stand within 20 yards of the right station in town, field recipes craft anywhere, and Enchanting's breaking and enchanting need no station at all (only its two charm recipes are station work, at the toolworks). There is no failure roll: a craft with the materials in hand always succeeds.\n\nTwo small frictions keep the economy honest. Every successful craft pays a fee of 2 copper per point of the item's stat budget, and every craft-family action takes real cast time (field crafts near two seconds, harder ladder crafts longer, and disenchant, enchant, salvage, and tool recharge each about a second and a half). Materials, the gold fee, stations, and skill ceilings do the rest; nothing scolds you for working too quickly.",
    recipesHeading: 'Recipes',
    recipesNote:
      'Every recipe of the craft: its exact skill requirement and materials, where it is learned and for what fee, and the three skill values where its gain fades to half, a quarter, and nothing.',
    masteryHeading: 'Skill gain',
    masteryBody:
      'Every recipe in the window wears its gain state in the classic colors: orange means full gain, yellow half, green a quarter, gray nothing. The boundaries are exact, every {step} skill is a tier, and a recipe fades one color for each tier it falls below yours.\n\nBecause gains are deterministic (a full-gain craft always moves you exactly one point), you can plan a whole climb from the list: work a rung while it is orange, train the next rung as it turns yellow, and never spend materials on a gray craft expecting progress. At the cap of {cap} the number stops, but the recipes, the masterwork chance, and the profits keep working.',
    masterworkHeading: 'Masterworks',
    masterworkBody:
      'Every successful craft is exactly what the recipe promises, and sometimes a little more: a masterwork finishes the same piece one quality tier finer, with the bonus stats baked in at craft time. It is add-only, never a downgrade, and it stays below the raid floor, so crafted gear can be excellent without replacing a raid drop.\n\nThe chance is published, not mystical: {base}% base, plus {perTier}% per tier your skill sits above the recipe, plus {signed}% when any signed reagent goes in, plus {spec}% once you are specialized, with higher-tier materials adding 1 to 2% more, all capped at {cap}%. Only a piece with real stats can improve, so statless commons, tools, and consumables never proc; a dormant craft never produces one, and a hobby craft cannot masterwork past its rare ceiling.\n\nFine work carries its maker. Rare and better outputs are signed, every copy (Crafted by; gathered materials carry Gathered by), a masterwork is always signed whatever its quality. A signature is provenance, not a lock: signed goods trade, mail, and list on the World Market freely.',
    trainingHeading: 'Training',
    trainingBody:
      "Trainer recipes come from the resident masters, taught at their stations. The rule is one line: a master teaches a recipe once your tier in the craft has reached the recipe's own tier, and nothing else gates it, not your level, not your archetype. The gear and consumable ladders run their rungs at skill 0, 25, and 50; Engineering's two rod lessons continue the ladder at 75 and 125, and Enchanting's two charm recipes sit on the 25 rung, so a fresh rung opens as your tiers climb.\n\nFees are one-time and flat by rung: the starting rung is free, the skill 25 rung costs {tier1} a recipe, the skill 50 rung {tier2}, and the rod lessons above them carry their own fees, listed beside each recipe in the table. You must stand at the master's actual station to train, and a mobile station never counts. The common field recipes and the six crafted land-tool recipes need no training at all; every character knows them from the start.",
    specializationHeading: 'Specialization',
    specializationBody:
      'At skill {at} this craft specializes you, no quest needed: recipes cost {pct}% fewer materials from then on, and specialization adds its own bump to the masterwork chance.\n\nSpecialists also learn to take the workshop with them: a specialized crafter can set up a mobile station in the field for ten minutes at a time, so station-bound recipes can be worked at the mine mouth instead of back in town. Its limits are deliberate: it never counts for training with a master or for unbinding a commissioned piece, and it expires on its timer whether or not you used it.',
    ench: {
      disenchantHeading: 'Disenchanting',
      disenchantNote:
        'Disenchanting takes any weapon or armor piece of common quality or better and consumes one copy, taking a plain copy before an enchanted one; when only enchanted copies remain, one of those is destroyed, enchant and all. Common and uncommon pieces mill down into a rolled handful of Chime Dust, a little richer for rarer and higher-level pieces; from rare up the yield changes shape, exactly one Chime Essence from a rare piece or one Chime Shard from an epic or legendary one, plus a typed secondary keyed to what the piece was made of.',
      typedHeading: 'Typed secondaries',
      typedNote:
        'The typed secondaries follow the material: cloth armor yields Resonant Thread, leather Resonant Hide, mail Resonant Links, melee weapons Resonant Steel, and staves, wands, bows, and crossbows Resonant Timber. A rare piece gives exactly {rare}; an epic or legendary piece gives {epicMin} or {epicMax}. Rings and necklaces have no armor class, so they yield only the primary material.\n\nMind the fine print: the Resonant secondaries bind on trade, so each can change hands exactly once, straight from the breaker to the enchanter who will burn it. Dust, Essence, and Shards carry no such string and move like any other trade good.',
      colSource: 'Broken from',
      meleeWeapons: 'Melee weapons',
      timberWeapons: 'Staves, wands, bows, and crossbows',
      enchantsHeading: 'Enchants',
      enchantsNote:
        'Enchants come in three tiers. The base tier runs on Chime Dust (with a little Essence at the high end) and covers the weapon slot plus every armor slot except the off hand, with enough stat-axis options that every build finds something for each slot. The Greater tier costs one Chime Shard plus Essence: stronger bonuses on the highest-impact slots. Shards feed two more sinks besides, the two charm recipes at five apiece and the top rung of tool-effect recharges, so bank a few before you spend.\n\nBetween them sit the five Runed enchants, one consumer per typed secondary, so nothing you mill is ever a dead end: Runed Edge (weapon, Strength, consumes Resonant Steel), Runed Sigil (weapon, Intellect, Resonant Timber), Runed Weave (chest, Spirit, Resonant Thread), Runed Hide (legs, Agility, Resonant Hide), and Runed Links (helmet, Stamina, Resonant Links). Each also takes two Chime Essence; where a slot and stat have both a base and a Greater enchant, the Runed bonus lands between them, while Runed Weave is the strongest chest Spirit enchant outright and Runed Hide is the only legs Agility enchant at all. The exact bonuses are all in the table below.',
      colEnchant: 'Enchant',
      colSlot: 'Slot',
      colTier: 'Tier',
      colBonus: 'Bonus',
      tier: {
        base: 'Base',
        runed: 'Runed',
        greater: 'Greater',
      },
      salvageHeading: 'Salvage',
      salvageNote:
        'Salvage is the everyman cousin of disenchanting: the same weapons and armor, no skill required and none gained, returning plain crafting scrap by quality instead of anything arcane. Anyone can do it, enchanter or not. When you hold a piece worth breaking, the choice is simple: from rare up, disenchanting is strictly the better deal, while at common the two yields vendor for about the same, so break toward whichever material you actually need.',
      bonusFmt: '+{value} {stat}',
      // #2825 correction, as a NEW key: enchant_offhand_stamina ships, so the
      // retired enchantsNote's "every armor slot except the off hand" now
      // contradicts the generated table right below it.
      enchantsNoteOffhand:
        'Enchants come in three tiers. The base tier runs on Chime Dust (with a little Essence at the high end) and covers the weapon slot, the off hand, and every armor slot, with enough stat-axis options that every build finds something for each slot: shields and held caster off hands take a Stamina enchant of their own, so no equipped slot is enchant dead. The Greater tier costs one Chime Shard plus Essence: stronger bonuses on the highest-impact slots. Shards feed two more sinks besides, the two charm recipes at five apiece and the top rung of tool-effect recharges, so bank a few before you spend.\n\nBetween them sit the five Runed enchants, one consumer per typed secondary, so nothing you mill is ever a dead end: Runed Edge (weapon, Strength, consumes Resonant Steel), Runed Sigil (weapon, Intellect, Resonant Timber), Runed Weave (chest, Spirit, Resonant Thread), Runed Hide (legs, Agility, Resonant Hide), and Runed Links (helmet, Stamina, Resonant Links). Each also takes two Chime Essence; where a slot and stat have both a base and a Greater enchant, the Runed bonus lands between them, while Runed Weave is the strongest chest Spirit enchant outright and Runed Hide is the only legs Agility enchant at all. The exact bonuses are all in the table below.',
      // The enchanter's side of the tool-effect system: what the two charm
      // recipes are for, and why the refill is the repeat business.
      charmsHeading: "Charms for a gatherer's tools",
      charmsBody:
        "Enchanting is also where a gatherer's charms come from. Tinker Gizzel teaches both at the Eastbrook toolworks once your Enchanting reaches 25: the Gatherer's Cache, which adds a unit to a harvest, and the Artisan's Eye, which raises the grade of what comes up. Each is crafted once, then slotted into a pick, axe, or sickle, where it spends a charge only on the harvests it actually improves.\n\nThe refill is where the trade keeps earning. Charges are restored by whoever owns the tool, not by a visiting enchanter, and the refill costs half the materials when that owner is the enchanter who signed the charm, less again with an Enchanting specialization. So a charm sold across the counter is a single sale, while the charms riding your own tools are the cheap ones to keep running. The full charge and material ladder is on any gathering profession page, under Tool effects.",
    },
    gatherIntro: {
      mining:
        "Mining pulls ore straight out of the world's rock: copper in Eastbrook Vale, iron in Mirefen Marsh, and osmium up in Thornpeak Heights, with starter veins scattered through every younger zone beyond them, feeding the forge crafts. Open to everyone from level 1: a 20 copper mining pick from an Eastbrook, Fenbridge, or Highwatch counter opens every starter vein, and the higher rungs of the pick ladder wake as your own counter earns them. Tracked on its own counter to a cap of 100.",
      logging:
        "Logging fells timber from stands of trees across the whole world: ironbark in Eastbrook Vale, ashwood in Mirefen Marsh, highpine in Thornpeak Heights, and starter stands in every younger zone, the raw stock for hafts, staves, and the engineer's bench. Open to everyone from level 1 with a logging axe in your bags (20 copper at the Eastbrook, Fenbridge, and Highwatch counters), tracked on its own counter to a cap of 100.",
      herbalism:
        'Herbalism gathers what grows wild: sheenleaf in Eastbrook Vale, goldleaf in Mirefen Marsh, sunpetal in Thornpeak Heights, and starter patches in every younger zone, the leaf and stem that keep the apothecary trades brewing. Open to everyone from level 1 with a herbalism sickle in your bags (20 copper at the Eastbrook, Fenbridge, and Highwatch counters), tracked on its own counter to a cap of 100.',
      fishing:
        "Fishing is the odd one out among the gathering trades, and the deepest: a real bite-and-reel minigame, its own catch tables in each of the three heartland zones (the young waters beyond them all serve the Vale's table for now), and a proficiency cap of 200, twice the others. Buy a pole, face open water, and cast.",
    },
    rhythmHeading: 'The gathering rhythm',
    rhythmBody:
      "A harvest is a short visible cast, not an instant grab: {base} seconds base, never below a {floor} second floor. Carrying a tool above the node's tier, one your proficiency lets you wield, speeds you up by {tool} seconds per tier above it, and each proficiency band you cross trims another {band} seconds; merely matching the node's tier gets you in the door, it is the tiers above it that make you fast.\n\nA full bag politely refuses the cast before it starts, so nothing is wasted mid-swing, and every harvest pays a small slice of character XP, scaled by the node's level against your own the way kill XP scales: a trivial gray node teaches a capped character nothing.",
    gainBody:
      'Gain is deterministic, never a skill-up roll: a node at or above your gain tier teaches a full point per harvest, and every {step} proficiency is one tier scored against the node. Tier 1 nodes pay in full below 25, half to 49, a quarter to 74, and nothing from 75 on; tier 2 nodes pay in full to 49; the two tier 3 nodes of each trade pay in full to 74 and half right up to the cap of {cap}.\n\nThe intended route is plain: learn on the starter nodes of the Vale, move to the marsh, and finish the climb on the high ground of Thornpeak Heights. At the cap the learning stops but the yields do not: a capped gatherer keeps rolling the best odds the trade offers forever.',
    nodesHeading: 'Nodes by zone',
    nodesNote:
      'Where the nodes are, their tier, the tool they need, and what they yield. Every node respawns for you {respawn} seconds after your own harvest, and that timer is yours alone: another gatherer working the same node never delays yours, so there is no node racing and no camping. Each zone up the ladder brings a better material out of tougher ground.',
    toolsHeading: 'Tools',
    toolsNote:
      "Every node needs its trade's tool in your bags, tier 1 included: no pick, no ore, and no pole, no fish. The vendor ladder covers tiers 1 to 3 across the three heartland hubs: the tier-1 tool is sold at all three, the rungs above it where the ground that uses them begins (Fenbridge adds tier 2, Highwatch tier 3), and the younger settlements beyond them stock no tools at all, so kit up before you travel. Every counter sells every rung it stocks freely, and any tool passes by direct trade; every rung also lists on the Market and travels by mail except the three 20-copper land starters: those are bought at a counter or passed hand to hand, and never sold back, mailed, or listed. What is gated is the wielding. A land tool above tier 1 works only once your proficiency in its own trade has earned it, {tier2Prof} for tier 2, {tier3Prof} for tier 3, and 85 and 100 for the two crafted rungs, and the vendor row, the tooltip, and the table below all name the requirement up front. Until then a tool bought ahead simply waits in your bags, opening no ground, buying no speed, and minting no fine grades, then wields the moment your counter touches its number. Fishing rods are the one exception: no rod carries a wield requirement, and Trader Wilkes in Eastbrook deliberately stocks the tier 2 and tier 3 rods for anglers buying ahead. A tool never occupies an equip slot and never wears out, so each is a one-time purchase, and only the tier matters to the gate: a rarer tool of the same tier opens nothing extra. Rarity is not only colour, though. It makes a slotted tool effect last longer, and on a rod it widens the reel window.\n\nA better tool buys three things, not two. It opens higher-tier ground, it shortens the cast, and it improves what comes out: work a vein with a tool ranked ABOVE the zone's own material and the harvest yields the fine grade of it instead of the plain one. The vein has to be one of the zone's full-grade ones, so the easier veins a zone keeps for travellers still yield the ordinary material. Fine materials are what the crafted tool recipes consume, and a fine grade counts as its ordinary version anywhere a recipe or a work order asks for one, so upgrading never strands you: it just means your copper ore arrives as Fine Copper Ore.\n\nAbove the vendor ladder each trade has two crafted tools, tier 4 and tier 5, made at the toolworks (every character knows the land recipes; the skill that climbs for the work is Engineering's), or bought with Delve Marks at the Drowned Litany counter once its clears gates are met: the table below carries the Marks price and the clears each rung asks. No merchant ever sells them for coin. Fishing has its own pair, and they are learned from the toolmaker rather than known from the start. No node and no water today needs more than tier 3, so the top two rungs buy speed, grade and a kinder reel window rather than access, and they will be the entry ticket when higher-tier ground arrives.",
    toolCrafted: 'Crafted ({craft})',
    // Both routes, for the eight top tools that have both; the Marks route
    // names its Drowned Litany clears gate (shop.ts DelveShopGate). The
    // "three" is the clears:3 rung, pinned against DELVE_SHOPS in
    // tests/guide.test.ts so a retuned gate fails there instead of rotting
    // here (kept a literal so the long-translated key keeps its token set).
    toolCraftedOrMarks:
      'Crafted ({craft}) or {marks} Delve Marks after three Drowned Litany clears',
    toolCraftedOrMarksHeroic:
      'Crafted ({craft}) or {marks} Delve Marks after a Heroic Drowned Litany clear',
    toolVendor: '{name} ({hub})',
    toolUnavailable: 'Not sold',
    priceNone: 'Not sold for coin',
    toolTierReq: 'Tier {tier} tool',
    colWield: 'Use at',
    // 'Any' rather than 'None': under a Use at header, 'None' reads as
    // unusable, and the true fact is no proficiency requirement at all.
    wieldNone: 'Any',
    yieldsHeading: 'What a harvest yields',
    yieldsBody:
      'Every harvest rolls a quality for what it grants, and your proficiency is the whole story of that roll. A brand new gatherer always pulls common material; every point of skill moves weight steadily out of common into the higher grades and never backward, until at the 100 cap the common grade disappears entirely: 60 percent uncommon, 30 percent rare, 8 percent epic, and 2 percent legendary, every time.\n\nQuality also means quantity: a common roll yields 1 unit, uncommon and rare yield 2, epic 3, and legendary 4. Any rare, epic, or legendary pull arrives as a signed instance stamped Gathered by you: at cap that is four harvests in ten carrying your name, and the provenance rules on the Crafting Economy page explain why crafters pay extra for exactly those stacks.',
    bandsHeading: 'Proficiency bands',
    bandsBody:
      "Proficiency bands are the shared 0/100/200 ladder over a trade's counter. For the land trades the band crossed at 100 shaves the gather cast, and their cap makes band 1 the ceiling. Fishing's bands shave nothing: they select the catch tables (with a rod to match), only fishing reaches band 2, and the climb itself is what pulls an angler to deeper water, where the better tables and the further lessons both live.",
    bandFmt: 'Band {band}: from {at} proficiency',
    rareHeading: 'Rare finds',
    rareBody:
      "Every harvest, whatever your skill, carries a 1 in {oneIn} chance of a rare find: a pristine vein in ore, ancient heartwood in timber, a moonlit bloom among the herbs. The find multiplies that harvest's yield {mult} times over, every unit arrives signed with your name regardless of the quality rolled, and the whole zone hears about it by name. Each flavor also inscribes its own zero-Renown deed in your Book of Deeds, a collector's mark that exists purely to prove it happened to you.",
    specimenBody:
      'Keep a little bag room spare when you farm: a signed windfall needs room of its own or a matching signed stack to land in, and if nothing fits the yield still arrives but the signature is lost. Corpse harvesting has its own jackpot arm too: about {pct}% of each harvested component comes up rare or better. A family with a perfect specimen to give (hide, silk, venom, meat) keeps its ordinary yield plain and mints the signed specimen beside it; every other family signs the yield itself.',
    gatherDeedsHeading: 'Deeds along the way',
    gatherDeeds: {
      mining:
        "Your first node of any trade earns Fruits of the Field, and the 100 cap in Mining inscribes Ore in the Blood. Reaching 100 in any three of Mining, Logging, Herbalism, and Fishing adds Master Gatherer at 25 Renown, and cracking a pristine vein records its own collector's mark. Twelve zones keep a gatherer's chronicle page apiece too, filled by harvesting an ore vein, a wood stand, and an herb patch within the zone's bounds. None of these grant power: deeds are titles and Renown, a record of the roads you have walked.",
      logging:
        "Your first node of any trade earns Fruits of the Field, and the 100 cap in Logging inscribes Heartwood Hewer. Reaching 100 in any three of Mining, Logging, Herbalism, and Fishing adds Master Gatherer at 25 Renown, and a strike of ancient heartwood records its own collector's mark. Twelve zones keep a gatherer's chronicle page apiece too, filled by harvesting an ore vein, a wood stand, and an herb patch within the zone's bounds. Deeds are titles and Renown only, never power.",
      herbalism:
        "Your first node of any trade earns Fruits of the Field, and the 100 cap in Herbalism inscribes Master of the Meadow. Reaching 100 in any three of Mining, Logging, Herbalism, and Fishing adds Master Gatherer at 25 Renown, and a moonlit bloom records its own collector's mark. Twelve zones keep a gatherer's chronicle page apiece too, filled by harvesting an ore vein, a wood stand, and an herb patch within the zone's bounds. Deeds are titles and Renown only, never power.",
      fishing:
        "The 100 milestone inscribes Old Salt and 200 inscribes Master Angler with its title, the very top of the angler's art; Fishing also counts toward Master Gatherer, earned at 100 in any three gathering trades. A first fish from each of twelve zones' waters fills its own page, the three heartland zones and the Willowfen, the Galecrest, the Farshore, the Frostveil, the Amberfall, the Nightbloom, the Wraithwood, the Palmreach, and the Evergarden beyond them, and the Sunglint Koi records Glimmer of Hope, so travelers with a pole in their pack fill their book faster than they expect.",
    },
    fish: {
      startHeading: 'Getting started',
      startBody:
        "A Simple Fishing Pole costs 20 copper from Fisherman Brandt in Eastbrook (look for the Old Salt at the town's east edge, by the road to Mirror Lake); Tinker Gizzel, Provisioner Hale in Fenbridge, and Quartermaster Bree in Highwatch stock poles too. Use the pole while facing water deep enough to hold fish, up to about 24 yards ahead of you, and your bobber sails out.\n\nYou cannot cast while in combat, while swimming, or while dead: casting from shore is the intended posture. Water gets harder as the land does, though: the marsh wants at least the tier 2 Ironreel and the peaks the tier 3 Silverstream, and a line cast without the rod that water takes never leaves your hand. Two rods sit above those, the Stormreel and the Tidewrought: engineers craft them at the toolworks out of what a line pulls up, and the Drowned Litany's delve counter sells them for Delve Marks behind its clears gates, though never for coin. No water asks for them, so they buy a shorter wait and a wider reel window instead of access, which at the top rung means a bite in a flat three seconds.",
      biteHeading: 'Bite and reel',
      biteBody:
        'After the cast, a bite comes at a hidden moment between {min} and {max} seconds; the delay is decided when the line lands, so no two casts feel quite alike. When the bobber bites you have a {reel} second window to press the pole again and reel in: reel inside it and the catch lands, hesitate past it and the fish gets away with nothing to show. A whole session caps at {cap} seconds, so even a quiet cast resolves quickly.\n\nBetter rods sharpen both ends of the minigame: each rod tier above the first trims {rod} seconds off the longest possible wait, never below the three-second floor the top rod already grazes, and adds {reelRod} seconds to the reel window, so the Ironreel pulls the worst wait down to 6.5 seconds with a 3.25 second window, and the Silverstream to 5 with a window past 4, its rarity widening the reel a little beyond what the tier alone pays. The quickest bites never change whatever you hold, and a rod only needs to be in your bags to count.',
      // The early reel (the spam-click fix): its own key rather than a
      // biteBody reword, so the shipped translations of the paragraphs
      // above stay live while locales catch up on this one.
      earlyReelNote:
        'One caution for eager thumbs: press the pole again before anything bites and you reel in an empty line, ending the cast. The first second after the line lands is forgiven, so an accidental double-press costs you nothing; past that, an early press is a wasted cast. Patience is the whole game: wait for the bite, then strike.',
      scheduleHeading: 'Proficiency gain',
      scheduleNote:
        "Fishing gain follows a fixed schedule with no dice: a full point per catch below 50 proficiency, half a point below 100, a tenth below 150, and a slow 0.02 trickle from 150 to 200. That last stretch is a thousands-of-catches journey on purpose: 200 is a statement, not a stop on the way to something else.\n\nJunk stops teaching entirely at {cutoff}: from there on, weeds and boots are just weeds and boots. The water itself caps the lesson too: the Vale's tier 1 waters (and every young shore beyond the heartland) teach nothing past 100, the marsh's stop at 150, and only Thornpeak's school an angler the whole way to 200. Every landed catch otherwise gains at the scheduled rate, so when the counter stalls, the schedule is telling you to seek deeper water.",
      colProficiency: 'Proficiency',
      colGain: 'Gain per catch',
      belowFmt: 'Below {below}',
      tablesHeading: 'Catch tables',
      tablesNote:
        "Your proficiency selects one of three catch bands: band 0 from the start, band 1 at 100, band 2 at 200, each shifting weight out of junk and empty hooks into real fish, zone by zone. Each band above the first also demands a rod: band 1 wants the tier 2 Ironreel, band 2 the tier 3 Silverstream. Your effective band is the lower of what your skill has earned and what your rod supports, and the cap is silent: with a lesser rod you still catch, just off the lower band's table, so if your catches feel stuck while your skill climbs, check your rod first.\n\nEach zone's waters hold their own pair of cooking catches, higher-tier fish the deeper the zone, all of them kitchen reagents that must be cooked before they restore anything. The rest of the table is the angler's tax: weed, the occasional boot, and the empty hook, which never fully disappears. How much you pay depends on the water your bobber lands in, not where you stand: a cast reaches up to 24 yards, and the rod the water demands, the table it draws from, the deed it credits, and how far it teaches all answer to the zone that water belongs to, decided the moment the line lands. Each zone's water is written for a band of its own, the Vale for band 0, the marsh for band 1, the peaks for band 2, and fishing one band under that turns roughly a third of your casts into empty hooks, two bands under it more than half. The rod gets you to the water; the skill is what makes it pay, and the climb is what pulls an angler deeper, because better bands are not just better pay: past the Vale they are the only waters that keep teaching. The {rare} is the one row that answers to your catch band and nothing else: the same odds in every zone, and six times likelier at band 2 than at band 0, so the rarest thing on the dock is the one a Master Angler really is better at.",
      bandHeading: 'Band {band}: proficiency {at} and up, rod tier {rod}',
      colCatch: 'Catch',
      colOdds: 'Odds',
      pctFmt: '{pct}%',
      emptyHook: 'Nothing biting',
      koiHeading: 'The Sunglint Koi',
      koiBody:
        "Every body of water in the game hides the same prize: the Sunglint Koi, an uncommon gleam on the line worth 75 copper to a vendor and rather more to your pride. Its odds answer to your catch band and to nothing else, the same in every zone: a 1 percent row of the catch table at band 0, 3 at band 1, and 6 at band 2, drawn on every reeled-in cast, so the koi comes to the angler who earned the deep tables. Landing one records Glimmer of Hope in your Book of Deeds, a zero-Renown collector's mark. When it happens, the log makes sure you know.",
    },
    econ: {
      title: 'Crafting Economy',
      intro:
        "How coin moves through the trades: the exact fees and sinks, what actually sells, the World Market's rules, work orders, commissions, and why crafted power stops below the raid floor.",
      feesHeading: 'Fees and sinks',
      feesNote:
        "A healthy player economy needs coin leaving the world, and professions carry several of the drains. Learning a trainer recipe costs a one-time fee by its rung, every successful craft pays a small fee scaled to the piece's stat budget, and on top of those sit the unbind fees and the Market's cut.\n\nNone of this coin goes to another player: it leaves the game entirely, which is what keeps the coin the rest of you earn worth something.",
      feeCraft: 'Craft fee',
      feeCraftValue: '{fee} per point of item budget',
      feeMarket: 'Market cut',
      feeMarketValue: '{pct}% of a completed sale',
      feeDeposit: 'Listing deposit',
      feeDepositValue: 'None',
      feeUnbind: 'Unbind fee',
      feeUnbindValue: '{uncommon} uncommon, {rare} rare, {epic} epic',
      trainingHeading: 'Training fees',
      trainingNote:
        "One flat fee per recipe rung, charged once when a master teaches it; every rung of the table below is in live use today, from the free starter recipes to the toolmaker's rod lessons at the top.",
      trainingTierFmt: 'Tier {tier}: {fee}',
      free: 'Free',
      sellsHeading: 'What sells, and why',
      sellsBody:
        'The steadiest business is consumables, because they are used up and bought again. Potions, cooked food, and enchants all vanish with use: a fighter who buys a sword once will buy healing potions forever, and every fresh piece of gear is a fresh chance to sell an enchant.\n\nMasterwork pieces are the premium end. They cannot be made to order, so one of a wanted piece commands a real markup, and your signature on it is walking advertising. Reagents are the third pillar: arcane materials from disenchanting, typed Resonant secondaries flowing straight from breaker to enchanter, and signed gathered materials, which crafters chasing masterwork procs pay over the odds for.',
      marketHeading: 'The World Market and its cut',
      marketBody:
        "The World Market is the realm-wide exchange, kept by the Merchant in Eastbrook and Auctioneer Voss in Highwatch. Listing is free: there is no deposit, and an unsold listing simply comes back to you. The house takes its cut only when something actually sells: 5 percent of the sale price, and the rest waits for you to collect.\n\nSpecial pieces are welcome too: a signed, masterwork, or enchanted copy goes up as its own single-copy listing that carries its identity onto the tooltip, signature and all, and it never mixes with a plain stack. The one refusal is a bound copy: a piece locked by the Maker's Bond, or still armed to bind, stays out of the Market and the mail alike, so a bond can never be laundered away. Price special work yourself; the plain listings only tell you what the plain version fetches.",
      workOrdersHeading: 'Work orders',
      workOrdersNote:
        "Each station master posts a standing work order: bring a stack of their craft's staple material and get paid on the spot, plus a little quest experience. The pay is deliberately {pct}% of what a vendor would give you for the same stack, rounded down, so a work order is never the profitable way to sell materials, just a reason to swing by the station.\n\nEvery order runs on its own {minutes} minute clock per character: turn one in and that master has nothing more for you until the timer laps. The marks over a master's head and on your maps keep the score for you: a bright blue ! is repeatable work you have handled before, and the same mark dimmed is repeatable work still inside its clock, offered again once the window laps. Treat them as a small bonus on materials you were gathering anyway, not a business.",
      colOrder: 'Work order',
      colMaster: 'Master',
      colAsks: 'Asks for',
      colPays: 'Pays',
      commissionsHeading: "Commissions and the Maker's Bond",
      commissionsBody:
        "A commission is a craft made for someone. When crafting a weapon, armor piece, or held off-hand (a potion cannot carry a bond), the crafter can flag the craft as a commission: the finished piece behaves normally in the maker's own hands, but the moment it changes hands in a trade it binds to the person who received it. That is the Maker's Bond: the buyer gets their piece, and the piece cannot be passed on or resold.\n\nBonds are not forever, just expensive. Any station master will unbind a bound piece while you stand at their station (a mobile station never offers the service), for a fee set by the item's quality: 25 silver uncommon, 1 gold rare, 4 gold epic, with a legendary paying the epic rate and a commissioned common piece the uncommon one.\n\nThe fee buys a clean slate, not a cure: the piece is still a commission, so it binds again to whoever receives it in the next trade, and everything else about it, signature, masterwork, and enchants, survives untouched.",
      provenanceHeading: 'Signed work',
      provenanceBody:
        "Some items carry a name. Hover one and the tooltip says Gathered by so-and-so on a raw material, or Crafted by so-and-so on a finished piece: the same mark, worded for how the item came to be. A signature is part of the item itself, travels with it through trades, the bank, the mail, the World Market, and even a vendor buyback, and never fades.\n\nGathering signs its best work automatically: any harvest that rolls rare or better arrives signed, and rare finds sign their entire five-fold windfall. A corpse harvest's lucky roll signs its yield where the family has no specimen to give, and where it does, keeps the yield plain and mints the signed pristine specimen beside it. Crafting signs along the same line: every copy of a rare or better output mints signed, and a masterwork always signs whatever its quality, so the finest version of any piece always names its maker. The one thing that can cost you a signature is a full bag: a signed unit needs room of its own, or a matching signed stack, to land in.\n\nA stack of items shares one identity, so two copies merge only when every mark matches exactly: same item, same signer, same masterwork stats, same enchant, same bond. A signed log never joins a plain pile in either direction (merging would erase somebody's name), but identical payloads merge happily, so twenty ore signed by the same gatherer sit in one stack and a windfall does not shred your bags.\n\nSignatures pay crafters back: holding any signed copy of a needed reagent at the bench, whoever signed it, adds 2 percentage points of masterwork chance, and holding a reagent signed by your own hand cuts that reagent's required quantity by one (never below one). Your own signed rare-or-better work even keeps teaching you, today through the flask alone: drink a potion you signed and a small trickle of skill flows back to the craft that brewed it, as long as that craft is one of your active majors.",
      collectorsHeading: 'Collectors, trophies, and the price of a story',
      collectorsBody:
        "Vendors are blind to provenance: a signed item sells to an NPC for exactly its plain price. The premium on a signature exists only between players, which is precisely what makes it interesting: a stack of windfall ore signed by a famous gatherer, a Prime Cut from a lucky harvest, a masterwork blade naming a crafter who has since retired, all cost whatever someone's memory says they are worth.\n\nThe Book of Deeds leans into the same instinct: Pristine Vein, Ancient Heartwood, Moonlit Bloom, A Perfect Specimen, and Glimmer of Hope are zero-Renown collector's marks that exist purely to prove a moment happened to you. Keep the item that earned the deed and you hold the receipt. None of this is power; provenance buys no stats and wins no fights, it is the game's paper trail of good days.",
      // Renamed off throttleHeading/Body so filled locale overlays that still
      // carry the old {actions}/{seconds} quota copy do not fail token parity
      // against the cast-time prose (Craft Cast System Phase 5/6).
      castPaceHeading: 'Cast time and the gold sink',
      castPaceBody:
        'Profession actions take real cast time: recipes scale from just under two seconds for simple field work up to a few seconds at the top of the ladder, and disenchant, enchant, salvage, and tool-effect recharge each take a fixed short cast. Cancel mid-cast and you lose nothing. Every successful craft also pays a copper fee proportional to the item budget. Together with materials, stations, and skill ceilings, that pace keeps the Market honest without a separate action quota. The exact durations by skill band are listed below.',
      // The exact cast-pace bands ({seconds}/{count} localized numbers from
      // content constants; the transparency policy's number-bearing lines).
      castPaceField: 'Field recipes (no skill requirement): {seconds}s cast',
      castPaceSkill25: 'Recipes up to skill 25: {seconds}s cast',
      castPaceSkill50: 'Recipes up to skill 50: {seconds}s cast',
      castPaceSkill75: 'Recipes up to skill 75: {seconds}s cast',
      castPaceCombo: 'Top-of-ladder and combo recipes: {seconds}s cast',
      castPaceEnchantFamily: 'Disenchant, enchant, and salvage: {seconds}s cast',
      castPaceRecharge: 'Tool-effect recharge: {seconds}s cast',
      castPaceBatch: 'Batch crafting: up to {count} in one order, one cast each',
      doctrineHeading: 'Players trade with players',
      doctrineBody:
        'The crafting economy is built on one idea: players supply players. Gatherers feed crafters, crafters feed questers and raiders, and breakers feed enchanters, with vendors and station masters standing at the edges to absorb junk and coin rather than to compete with you. If you want to make money from a profession, your customer is a person: learn what other players burn through, price against the World Market, and treat the NPC systems as a floor under your prices, not as the market itself.\n\nCrafted gear is tuned to sit below the raid floor: even a masterwork is only ever one quality tier above its recipe, never past legendary, and its stat budget stays under the raid loot band. The forge gets you ready for the hardest content; it does not replace it. That keeps crafters, raiders, and the market in a stable triangle: raid drops stay aspirational, and crafted pieces stay the best gear money can actually buy.',
      // The commission order board (sim/professions/commission_order.ts):
      // posted orders, one crafter at a time, no escrow, in-person delivery.
      // Sits directly above the Maker's Bond section it feeds.
      orderBoardHeading: 'The commission board',
      orderBoardBody:
        "You do not have to find a crafter in chat. Open your crafting window and the commission board is one click away in its header. Anyone can post an order there: name the recipe you want made, then either leave it open for any crafter to take, or aim it at one named crafter, who is then the only person who can pick it up. A crafter browsing the board accepts an order, and accepting commits them, so a job is only ever worked by one person at a time.\n\nNothing is held back when you post: an order reserves no coin and no materials, so the price and who supplies the reagents stay between the two of you, agreed the way any commission is agreed. You can cancel your own order while it is still open, and an order nobody accepts expires by itself after a day. Once a crafter has accepted, delivery is what closes it.\n\nDelivery happens face to face. The crafter makes the piece as a commission, comes to you, and hands it over, so keep a bag slot free to receive it. What arrives follows the ordinary commission rules below, binding to you through the Maker's Bond.",
      // One-sentence bridge at the head of the commissions section, as its own
      // key so the long reviewed commissionsBody value stays untouched.
      commissionsBoardNote:
        'There are two ways into a commission: an order you post on the board above, which brings the work to a crafter, and a crafter simply choosing to make a piece for you. Both end in the same bond.',
    },
    faq: {
      title: 'Professions FAQ',
      intro: 'Quick answers to the questions crafters ask most.',
      q1: 'Why do my signed items not stack?',
      a1: 'A signed item is an instanced item: it carries its own little record (the signer, any rolled quality, masterwork stats, an enchant, a bond) instead of being an anonymous copy. Two copies merge into one stack only when those records match exactly.\n\nIn practice: rare ore you gathered yourself stacks with more rare ore you gathered yourself, because both say Gathered by you and nothing else differs. The same material signed by a friend sits in its own slot, and a plain unsigned copy never merges into a signed stack. Bags, bank, trade, mail, and the World Market all follow this one rule.',
      q2: 'Do common recipes raise my skill forever?',
      a2: 'No. Every recipe is scored by how far it sits below your current bracket in that craft, the classic orange, yellow, green, gray reading: full gain at or above your bracket, half one tier below, a quarter two tiers below, and nothing three or more below. Brackets are every 25 skill, so the free skill 0 recipes stop teaching you anything at 75 skill.\n\nThe caps are also lower than the classic 300 you might expect: each of the eight earnable crafts caps at 125, Mining, Logging, and Herbalism cap at 100, and Fishing runs long at 200. Climbing means moving up to recipes at your own bracket, not grinding the cheapest one.',
      q3: 'What is the difference between looting and harvesting a corpse?',
      a3: 'One press covers both. Everything a corpse holds, coin and drops plus any harvestable components, opens in the same window: loot follows the normal loot rules, and harvesting is the professions side, stripping materials off the carcass itself.\n\nHarvesting is first come, single use: each corpse can be harvested exactly once, by whoever claims it first, online included. Your Town Focus shapes what you get: while standing in a town hub you can spread 10 focus points across the component types you care about, and each focused component rolls a better tier (every 5 points bumps it a step, at most two steps) and yields more (10 percent per point). Unfocused components are never made worse.',
      q4: 'Why is my Ironbark Log signed?',
      a4: 'You hit a windfall. Roughly 1 harvest in 90 triggers a rare gather event (ancient heartwood on a tree, a pristine vein on ore, a moonlit bloom on herbs): it multiplies the yield five times, signs every unit with your name, and announces the find to the whole zone. A rare or better rarity roll on an ordinary harvest signs the yield too.\n\nSigned materials are worth keeping or selling dear: holding any signed copy of a needed reagent at the bench adds 2 percentage points to the masterwork chance. Just remember they only stack with identically signed copies, so they keep their own bag slot.',
      q5: 'How do I unbind a commissioned piece, and what does it cost?',
      a5: "Walk to any crafting station with the piece in your bags and pay the master. The fee follows the item's quality: 25 silver for an uncommon piece, 1 gold for a rare, 4 gold for an epic; a legendary pays the epic rate, and a commissioned common piece pays the uncommon rate. It must be a real station: a mobile station never offers the service.\n\nThe fee buys a clean slate, not a cure: the piece remains a commission, so it binds again to whoever receives it in the next trade. If several bound copies share a stack, one copy is peeled off and unbound per payment.",
      q6: 'Where do I learn recipes, and what do they cost?',
      a6: "The nine common field recipes and the six crafted land-tool recipes are known to everyone from the start, and so are three station-bound capstones (the Kilnscale Mantle, the Wardweave Cowl, and the Duskhide Wraps), which need no trainer, only their station. Everything else is taught by the resident masters at their stations across the three hub towns: most stand in Eastbrook, the tanner keeps the tannery in Fenbridge, and the alchemist keeps the apothecary in Highwatch.\n\nTrainer recipes run in rungs: skill 0, 25, and 50 for the gear and consumable crafts, priced free, 25 silver, and 1 gold as one-time fees; Enchanting's two charm recipes sit on the 25 rung, and the toolmaker teaches the two crafted fishing rods at 75 and 125 for 4 and 16 gold. A master teaches a recipe once your bracket in that craft has reached the recipe's own bracket, and you must be standing at their station to learn: a mobile station does not count.",
      q7: 'Why did my gathering suddenly slow down?',
      a7: "The gather cast starts at 2.5 seconds and is shaved down two ways: 0.4 seconds for every tool tier you carry and can wield above the node's own tier, and 0.15 seconds once your trade's counter crosses its 100 band, with a floor of 1.5 seconds. Move from tier 1 nodes up to tier 3 nodes and your surplus vanishes, so the same pick swings slower again. Holding exactly the required tier buys no speed; it only opens the node.\n\nSkill gain fades the same way crafting does: a node grays out as your proficiency climbs past its tier (tier 1 nodes teach nothing from proficiency 75 on), so the answer to slow gains is higher tier nodes. Those need a tool of at least their tier in your bags (no node is ever worked bare-handed, tier 1 included), and a land tool above tier 1 also wants its wield mark first, 40/70/85/100 in its own trade for tiers 2 through 5. Fishing follows its own taper: full gain below 50 proficiency, half below 100, a trickle of 0.1 below 150 and 0.02 below 200, junk catches teach nothing at all from 100 on, and the water itself caps the lesson (tier 1 waters stop teaching at 100, the marsh at 150), so a stalled counter can also mean you have outgrown the water.",
      q8: 'Can I craft away from town?',
      a8: "Partly. The nine common field recipes (the starter weapon, armor, food, and potion staples) craft anywhere, any time, and so do the three combination recipes of the sworn pairs. Everything else above them is bound to a station type: forge, kitchens, apothecary, tannery, loom, or toolworks, and you must be within 20 yards of the station for the craft to go through.\n\nAt 75 skill in a craft you specialize, and along with a 20 percent material discount you gain a mobile station: place it in the field and it stands for 10 minutes, serving that craft's recipes as if you were at the real thing. The mobile station is for crafting only: learning recipes and unbinding commissions always require the true station in town.",
      q9: 'How do I get something crafted for me?',
      a9: "Post it on the commission board. Open the crafting window, open the board from its header, and name the recipe you want made: leave the order open for any crafter to accept, or aim it at one crafter you already know. Accepting commits that crafter to the job, and an order is only ever held by one person at a time.\n\nNo coin and no materials are held when you post, so agree the price and who brings the reagents between yourselves, the way commissions have always been arranged. You can cancel your own order while it is still open, and an order nobody accepts expires after a day. Delivery is in person: stand near your crafter with a free bag slot when the piece is ready. It arrives bound to you through the Maker's Bond, which any station master will undo for the usual fee.",
      q10: 'What is a charm, and what happens when it runs out?',
      a10: "A charm is a slotted tool effect: an enchanter's work that sits in a gathering tool and improves what it brings up. A Gatherer's Cache adds a unit to a harvest, an Artisan's Eye raises its grade, and Tinker Gizzel teaches both at the Eastbrook toolworks at 25 Enchanting. A charge is spent only when the charm actually changed the outcome, so a harvest it could not improve costs you nothing, and a slot can be set to ask each use if you would rather decide charge by charge.\\n\\nA fresh charm carries 20 charges on a common tool and 10 more for each rarity rung above it, so an epic tool starts at 50. Running out does not destroy the charm: the tool's owner refills the slot, 10 charges per arcane material, with the material following the better of the tool they are carrying and the best tool that slot has ever been filled by (Chime Dust for a common or uncommon tool, Chime Essence for a rare one, a Chime Shard for an epic). Banking the good tool before a refill never makes it cheaper, only smaller at the same price, and slotting a fresh charm while carrying the lesser tool is the way back down to a cheaper rung. The enchanter who signed the charm pays half to refill their own, and less again with an Enchanting specialization.",
    },
    // Gather nodes on the zone map and minimap (map_window_view.ts
    // MapGatherNodeMarker, minimap_painter.ts's struck lock) and the desktop
    // hover tooltip with its live respawn countdown
    // (gather_node_tooltip_controller.ts). Rendered under nodesNote.
    findingNodesNote:
      'You do not have to find these by eye. Every node in the zone is drawn on the zone map wherever the map is showing that ground, and on the minimap as you pass it, so a farming loop can be planned from the map screen before you set out. A node your tools cannot work yet is marked rather than hidden: it keeps its place with a struck, dimmed mark, so you can see the ground you are training toward. On desktop, hovering a vein, stand, or patch in the world names it, tells you the tool it wants, and, once you have worked it, counts your own respawn down to the second. On touch there is nothing to hover, so the minimap marks tell the same story.',
    // Specimen families, as a NEW key beside specimenBody: claw joined
    // HARVEST_COMPONENT_SPECIMENS, leaving fang, cloth, and tusk as the
    // specimen-less trio.
    specimenBodyFamilies:
      'Keep a little bag room spare when you farm: a signed windfall needs room of its own or a matching signed stack to land in, and if nothing fits the yield still arrives but the signature is lost. Corpse harvesting has its own jackpot arm too: about {pct}% of each harvested component comes up rare or better. A family with a perfect specimen to give (hide, silk, venom, claw, meat) keeps its ordinary yield plain and mints the signed specimen beside it; the other three, fang, cloth, and tusk, sign the yield itself.',
  },

  economy: {
    intro:
      'Coin oils the whole world: it buys your gear, supplies, and travel kit, and changes hands between players. You pick all of this up just by playing, so think of this page as a map of where your money comes from and goes.',

    // Money and its coin denominations.
    coinTitle: 'Gold, silver, and copper',
    coinBody:
      'Money comes in three coins. A hundred copper make a silver, and a hundred silver make a gold, so your purse fills up from the smallest coin first. You earn it from quest rewards, from looting fallen enemies, and from selling what you no longer need.',

    // Vendors and the kinds you meet.
    vendorsTitle: 'Vendors and what they keep',
    vendorsBody:
      'Towns and outposts are dotted with merchants, each with their own trade. Provisioners stock food and drink, weaponsmiths and armorers carry gear, and a quartermaster keeps practical travel kit. Walk up to one to see what they sell.',

    // The mark currencies: Delve Marks (delve keeper) and Heroic Marks (heroic quartermaster).
    marksTitle: 'Marks and Honor: the currencies beyond coin',
    marksBody:
      'Coin is not the only thing you bank. Delves pay out Delve Marks, spent only at the delve keeper on companion upgrades and gear you will not find elsewhere. Heroic dungeon runs leave Heroic Marks on the final boss, spent with the heroic quartermaster in Highwatch on jewelry no other corner of the realm sells. Neither ever mixes with your coin.',

    // The personal bank: The Gilded Strongbox branches, deposits, and growing the vault.
    bankTitle: 'The bank',
    bankBody:
      'Every hub town keeps a branch of The Gilded Strongbox, the banking house of the realm. Speak to the bursar there to open your vault, a private store of room beyond your bags that your character keeps for life. Whatever you leave with them waits safely, whichever branch you visit next.',
    bankHow:
      'With the vault open, click an item in your bags to deposit it and click it in the vault to take it back. The vault holds goods only, never coin, and quest items stay with you. When your bags fill up mid-journey, one button sweeps all your crafting materials in at once.',
    bankSlots:
      'A fresh vault starts small and grows with you. The bursar sells further slots for coin at ever-steeper prices, and playing online earns bonus room on top, for things like a verified email, linked accounts, and friends you bring into the game.',

    // Buying and selling at a vendor.
    buyingTitle: 'Buying and selling',
    buyingBody:
      'Speak to a merchant and choose to browse their goods, and their shop opens as a single panel: everything they stock in one list, yours with a click if you can afford it. A quantity strip above the goods sets how many each click buys, one, five, or ten at a time, or a custom count, though a few special wares, mounts among them, only ever sell one at a time. Stackable coin-priced wares also carry a second offer beside the row that takes as many as your coin covers, up to a full stack, in one purchase. Selling is just as direct: while the shop is open, click an item in your bags to sell it on the spot, and what a merchant will not take, quest goods and soulbound pieces among them, simply stays put. If you part with something you regret, the shop keeps a Buyback list of your recent sales so you can buy them back for the coin you were paid.',

    // Offloading junk.
    junkTitle: 'Clearing out junk',
    junkBody:
      "Drops you have no use for still sell to any merchant with a shop of their own, so empty your bags whenever you pass through town rather than letting them fill up. The merchant's window even keeps a one-click Sell Junk button that sells every Poor-quality oddment at once. Truly worthless odds and ends can also be discarded outright to make room.",

    // Direct player-to-player trading.
    tradeTitle: 'Trading with other players',
    tradeBody:
      'You can trade face to face with anyone standing near you. Both of you put items and coin into a shared window and the swap only happens once you both confirm it, so neither side can be caught out. It is the simple way to hand a friend a drop or settle a deal.',

    // The Ravenpost player mail. No postage amounts, delays, caps, or expiry durations.
    mailTitle: 'The Ravenpost',
    mailBody:
      'Every hub town keeps a carved raven pillar: a mailbox of the Ravenpost, the letter service of the realm. Stand at one to write to any character by name, a friend online or long offline, and attach coin or goods to the letter for a small postage. The raven takes a short while to fly; when it lands, an envelope indicator tells the recipient something is waiting.',
    mailHow:
      'Collecting works the same in reverse: stand at any pillar to read your letters and take what they carry into your purse and bags. A plain letter fades away after a while, but one still carrying coin or goods waits for you, however long you take. Some things the post refuses outright: soulbound items, quest goods, bound or bind-on-trade pieces, and one-of-a-kind cosmetic tokens travel with you or not at all. And keep an eye on the pillar after a good turn-in; some questgivers write.',

    // Daily rewards: the treasure-chest window. Tasks, wheel, standings; no amounts,
    // point splits, or eligibility thresholds.
    dailyTitle: 'Daily rewards',
    dailyBody:
      "A treasure chest button on your screen opens the daily rewards window. Each day sets out a handful of tasks, complete quests, fight in the Ashen Coliseum, win a Vale Cup match, and offers a free spin of the prize wheel, all worth points toward that day's standings, and the day's top earners share a prize pool for holders of the optional community token. None of it grants power in the game. The window itself spells out the day's rules and who is eligible, shows the leaderboard, and keeps your history.",

    // The World Market (player auction house): browse, post, collect, pricing.
    marketTitle: 'The World Market',
    marketBody:
      'The Merchant runs the World Market, a player-driven exchange where you can buy and sell with people you may never meet. Speak to the Merchant in Eastbrook, or to Auctioneer Voss up in Highwatch, to open it: both keepers serve the one shared market. The Merchant also keeps a standing stock of their own goods listed there, so there is always something to buy even when no other players have posted.',
    marketBrowse:
      'Browsing: scroll the listings or search by name to find what is for sale. Each listing shows the goods, the seller, and the asking price for the whole stack.',
    marketPost:
      'Posting: choose a stack from your bags, set your price, and list it. The goods are held by the Merchant until someone buys them. Unsold listings come back to you after a while, and you can reclaim one early if you change your mind. Listing itself is free, so an optimistic price costs you nothing but time.',
    marketCollect:
      'Collecting: when your goods sell, your proceeds wait for you at the Merchant. Return to collect the coin, along with anything that came back unsold. The Merchant takes a small cut of every completed sale. The Collect tab itemizes what is waiting, one line per completed sale with the goods, the buyer, and what you made, so you can see exactly what sold before you take the coin.',
    marketPricing:
      'Pricing is up to you. Listing a little under what others are asking tends to sell faster, while a steep price may sit untouched. Browse first to see what the going rate looks like before you post.',
    // Honor, the third currency beside the two marks (src/sim/content/pvp_honor.ts).
    // Both honor quartermasters share one stock; every Warfare piece is soulbound
    // and records no buyback. What and where only: the arena page owns the detail.
    honorBody:
      'Fighting other players pays a third currency, Honor. Winning a ranked arena bout pays it, and a played-out match on Thornhollow Fields pays it whether you win or lose, so a hard-fought loss on the Fields is never a wasted match. Honor collects on your character sheet without ever mixing with your coin. You spend it with the honor quartermasters, FURY in Eastbrook and Warmarshal Draven Kole in Highwatch, who share one stock between them: the Warfare armor families, jewelry, and weapons that Honor alone buys. Those purchases are final, and the gear binds to you the moment you buy it, so read a piece before you confirm it. The arena page covers how Honor is earned.',
    // Pointer only: the guild vault (src/sim/guild_bank.ts) rides a tab on the
    // same bank window. The social page owns the detail (fees, slots, ranks).
    guildBankNote:
      'Your guild keeps a vault of its own alongside your personal one, opened at the same bursar and reached from a tab in the same window: a shared treasury of coin and a pooled store of goods. Every member can look at it, and officers are the ones who may move things in and out. The social page has the details.',
  },

  // Social and Groups: chat channels, parties, party loot, friends, ignore, guilds.
  social: {
    intro:
      'Most of the world is soloable, but the game is built to be played with other people. Here is how to talk, team up, and find your crowd.',

    // Chat channels.
    chatHeading: 'Chat channels',
    chatBody:
      'The chat window starts with two views that are always there, one combined log of everything said and one combat log. Beyond those you add the tabs you want with the plus button, one per channel, and on a desktop you can drag them into whatever order you like (Alt with the left or right arrow moves the focused tab from the keyboard); right-click a tab to close it again, and your arrangement is remembered between sessions. Typing in a channel tab sends on that channel, and a slash command sends one line somewhere else without changing tabs. There is also a whisper tab that gathers every whisper you send and receive in one place, where typing simply answers whoever wrote to you last. These are the channels you can talk on:',
    chanSay: 'Say.',
    chanSayBody:
      'Your default voice. It reaches players close to you and is the one to use while questing side by side.',
    chanYell: 'Yell.',
    chanYellBody:
      'A louder version of Say that carries a bit farther, enough to reach across a camp.',
    chanWhisper: 'Whisper.',
    chanWhisperBody:
      'A private message to one player by name, wherever they are. Use it for a quiet word.',
    chanParty: 'Party.',
    chanPartyBody: 'Talk to everyone in your group, no matter how spread out you are.',
    chanGeneral: 'General.',
    chanGeneralBody:
      'An always-on realm-wide channel that reaches everyone online, good for asking a question or general chatter. Unlike World and Looking for Group, you never have to opt in.',
    chanWorld: 'World.',
    chanWorldBody:
      'A realm-wide channel you opt into. Open its tab to join, and you will see and reach everyone online.',
    chanLfg: 'Looking for Group.',
    chanLfgBody:
      'An opt-in realm-wide channel for finding people to run a dungeon. Open its tab to join.',
    chanGuild: 'Guild and Officer.',
    chanGuildBody:
      'Channels for your guild. Guild chat reaches every member; the officer channel is for officers and the guild leader.',

    // Parties.
    partyHeading: 'Forming a party',
    partyBody:
      'Invite another player by right-clicking their name and choosing to invite. A party holds up to five players, and one of you is the leader.',
    partyCredit:
      'Group members near each other share kill and quest credit, so questing together is faster, never slower. A party is also how you step into a dungeon as a team.',
    raidBody:
      'Once you have a full party of five, the leader can convert it into a raid of up to ten, for the endgame raid.',

    // Party loot.
    lootHeading: 'Party loot',
    lootBody:
      'When you group up, the party leader sets how loot is shared. The rules cover coin and items separately:',
    lootCoinTitle: 'Coin.',
    lootCoinBody:
      'Money from a kill can go to whoever loots it, or be split evenly across the party.',
    lootCommonTitle: 'Items.',
    lootCommonBody:
      'Ordinary drops can take turns around the party or go to whoever loots, while better drops are put up for a roll so everyone gets a fair shot.',
    lootRollTitle: 'Need, Greed, or Pass.',
    lootRollBody:
      'When an item goes to a roll, each eligible member chooses Need if they want it, Greed if they would only take it spare, or Pass to bow out. The highest roll wins.',
    lootMasterTitle: 'Master looter.',
    lootMasterBody:
      'The leader can instead take charge of the better drops, handing each one out to the member who should get it. It keeps prized gear from going to a stray roll, the way an organized group runs a dungeon.',

    // Friends and ignore.
    friendsHeading: 'Friends, ignore, and block',
    friendsBody:
      'Add players to your friends list to see when they are online and where they are, so you can group up the moment they log in.',
    ignoreBody:
      'If someone is chattering more than you want, add them to your ignore list and their public chat stops reaching you. Ignoring is a chat setting only, and it never removes anyone from your friends list.',

    // Guilds.
    guildHeading: 'Guilds',
    guildBody:
      'A guild is a lasting group of players you belong to between sessions. Founding one costs the founder a one-time fee of 1 gold, or you can simply accept an invite to join, and you can be in one guild at a time. Members hold a rank: a leader, officers, and members.',
    guildChatBody:
      "Belonging to a guild gives you a private guild chat channel and a shared roster of your guildmates. Newer members wear a Recruit chip and long-standing ones a Veteran chip in place of the plain member label, while officers and the guild leader always show their rank, and you can hide the offline names when you only want to see who is on right now. Officers and the guild leader can also pin a short billboard message to the top of the Guild tab, and it is read out in your chat log the next time you log in, which is how most guilds post the week's plans.",

    // Community broadcast calls, everyday slash commands, and emotes.
    communityHeading: 'Calling the whole community',
    communityBody:
      'Start a chat line with an exclamation mark to make a community call: !lfg to look for a group, !wts and !wtb to trade, !recruit for your guild, !event to announce a raid or meetup, and !help to ask for a hand. A menu of the calls pops up the moment you type the mark. Each call is broadcast in the world and echoed to the community Discord, so it reaches players who are not even logged in. Community calls are part of online play.',
    slashHeading: 'Handy slash commands',
    slashBody:
      'A few everyday commands are worth memorizing: /w Name sends a whisper and /r answers the last one you received, /invite asks someone into your party, /follow falls in step behind a friend, /roll casts dice for the group to see, /who shows who is online, and /afk marks you away. Type /help in the game for the full list.',
    emotesBody:
      'Your character can also speak without words: type an emote like /wave, /dance, /cheer, or /bow, target a friend first to aim it at them, or hold X to open the emote wheel for a quick overhead expression.',

    // The Event Calendar window: realm event days plus the guild schedule.
    calendarHeading: 'The event calendar',
    calendarBody:
      'Press I to open the event calendar. It marks the realm days worth planning around, the weekly Raid Call, Market Day, Arena Clash, and Fishing Derby, plus the monthly Delve Day and Moongate Communion, and it is where guilds keep their schedule: the guild leader and officers can book events on it, and every member sees them on the same page. The realm days are a prompt to gather, not a bonus; nothing about your character changes because a day is marked.',

    // Ready checks: /ready polls the group; counts-only summary, answers stay private.
    readyHeading: 'Ready checks',
    readyBody:
      'Before a big pull, the group leader can type /ready to poll the room: everyone else gets a Ready or Not Ready prompt, and once all have answered, or 30 seconds run out, the whole group sees a single summary of the counts. Nobody is singled out; the point is the count, not the culprit.',

    // Party target markers: any member, eight symbols, one target per symbol.
    markersHeading: 'Target markers',
    markersBody:
      'In a party, target a hostile creature and right-click its portrait on the target frame (long press on touch) to crown it with one of eight raid symbols. Any member can mark, each symbol lives on one target at a time, and reapplying a symbol to its own target clears it. Kill order, crowd-control assignments, or a plain "this one first" all travel faster as a symbol than a sentence.',

    // Grouping etiquette.
    etiquetteHeading: 'Grouping etiquette',
    etiquetteBody:
      'Grouping is a choice, not a chore. Say hello when you join, roll Need only on gear you will actually use, and let the group know before you head off. A little courtesy goes a long way, and most players are glad of the company.',
    // Worlds (the realm picker): what a world is, the population bands, and what
    // is scoped to the one you pick. "World" is the player-facing word the picker
    // itself uses (auth.realmList "World List", realm.selectedRealm "World: {name}").
    realmsHeading: 'Worlds',
    realmsBody:
      'Online play runs on worlds, and each world is a separate place with its own players. You pick one from the World List before you play, and every row shows how busy that world is right now, from Low through Medium and High up to Full, or Offline for a world that is not currently up. Low means plenty of room, High means plenty of company, and a world that has reached its limit shows Full and turns new logins away until someone logs out, so pick where your friends are or where there is space.',
    realmsScopeBody:
      'What you do stays on the world you chose: your characters, your friends list, your guild, and the Market all live there, and the guild and player boards you open in game rank that world alone, while the board on the website gathers every world together. Each world also keeps its own daily raid reset, on its own local time.',

    // The Dungeon Finder as a social tool: the automatic role queue, the proposal
    // popup, the decline cooldown, and the premade board. No queue tuning numbers.
    finderHeading: 'Finding a group',
    finderBody:
      'You do not have to shout in Looking for Group to fill a run. Open the Dungeon Finder, choose the run you want and the roles you are willing to fill, and join the queue on your own or with the party you already have. The finder waits until it has a full set of roles, then offers the group to everyone at once: a popup asks each of you to accept, and the party forms the moment the last person says yes. Turning an offer down, or letting it run out, puts you on a short cooldown before the queue offers you another, so the line keeps moving.',
    finderBoardBody:
      'The finder also keeps a board of premade groups. A leader posts a listing with tags saying what the run is for, from a first visit to a straight full clear, and you apply to it for the leader to approve. The automatic queue fills the dungeons and the endgame raid, each at normal and heroic, while the board can also carry the solo attunement run, which the queue never fills for you; delves and open-world outings are yours to arrange. Either way the finder only builds the group: walking to the door, setting the difficulty, and agreeing the loot rules are still yours.',
    finderMore: 'See what is inside each dungeon',

    // Block, alongside ignore. Ignore is chat only; block is the heavy tool.
    blockBody:
      'Block is the heavier tool, for a player who will not leave you alone. A block cuts their invites, their whispers, and their mail as well as their chat, makes the two of you invisible to each other in /who, and drops them from your friends list if they were on it. Block from the right-click menu on their name or with /block, /unblock lifts it again, and /blocklist shows who is on it.',

    // Guild extras: the Guilds leaderboard tab.
    guildBoardBody:
      'Guilds are ranked too. The Leaderboard window keeps a Guilds board beside the player boards, ranking guilds on what their members have earned together, so a busy guild can see where it stands.',

    // The guild bank: a Guild tab inside the bank window at a banker. Every member
    // may look; only the guild leader and officers may act. No slot or price tables.
    guildBankHeading: 'The guild bank',
    guildBankBody:
      'A guild also keeps a vault of its own. Step up to a banker in one of the hub towns, open your bank, and switch to the Guild tab: there you will find a treasury of coin and a pooled store of items the guild owns together. Every member can open it and look at what is inside, and the pane says plainly who can do more. Only the guild leader and officers can act, putting coin and goods in and handing them back out, and every deposit and withdrawal is written into a log the guild can read, so nothing moves without a record.',
    guildBankRulesBody:
      'The item store starts closed. An officer opens it out of their own pocket, and the guild can pay from the treasury to widen it later. Quest items, anything soulbound, and gear the Market will not take stay out of it, the same as the mail and the Market, so the bank is for goods that can still change hands.',

    // Linking your Discord account: nameplate colors, staff chat tags, status ladder.
    discordLinkBody:
      'The Discord panel in game goes the other way too. Link your Discord account to it and the community roles you hold there follow you into the world: a colored name over your head, and a tag on the chat lines of the staff roles, so you can always tell a real moderator from someone borrowing the name. Linking also tracks a status that climbs as you take part. None of it grants any power in the game.',

    // Reporting a player, and what moderation actually does.
    moderationHeading: 'Reporting a player',
    moderationBody:
      'If a player is out of line, right-click their name and choose Report Player. Pick a reason, from harassment to spam to cheating, add a line about what happened, and send it: the report goes to the moderators to read. A report is a note to them, not a punishment in itself. Sending one does not silence, kick, or jail anyone, and no reply comes back telling you what was decided. Blocking them stops the bother while you wait.',
    jailBody:
      'Moderators keep the peace, and a player who will not let others enjoy the game can be moved to a jail cell. A sentence always has a set length, though a moderator can end it early, and it runs on the clock whether or not you stay logged in.',

    // Cross-link out of the chat section to the interface reference.
    chatMore: 'More on the chat window and the rest of the interface',
    // The jail gets its own heading so it never reads as the automatic
    // consequence of a report (a report is a note to the moderators only).
    jailHeading: 'Moderators and the jail',
  },

  stats: {
    // Character & Stats page: primary attributes, secondary stats, the character
    // sheet, and how stats grow. Directional only, no balance numbers.
    intro:
      'Your character is described by a handful of attributes. You never have to memorize them to play well, but knowing roughly what each one does helps you read your character sheet and pick the right upgrades.',

    // The five primary attributes.
    primaryHeading: 'Primary attributes',
    primaryBody:
      'Five attributes shape your character: Strength, Agility, Stamina, Intellect, and Spirit. Each class leans on a different mix, so the ones that matter most depend on what you play.',
    strTitle: 'Strength',
    strBody:
      'Strength raises your melee attack power, so your weapon swings hit harder. It does the most for the heavy melee classes that fight up close.',
    agiTitle: 'Agility',
    agiBody:
      "Agility sharpens you in several ways: it raises your chance to land a critical hit and your chance to dodge, and it adds a little armor. For rogues and hunters it also feeds attack power, and it drives a hunter's ranged shots.",
    staTitle: 'Stamina',
    staBody:
      'Stamina is your staying power. More Stamina means a larger health pool, and it speeds the health you recover while resting out of combat. Every class wants some.',
    intTitle: 'Intellect',
    intBody:
      "Intellect grows a spellcaster's mana pool, raises their spell power so their spells hit harder, and improves the chance their spells crit. It matters to the classes that cast from mana; for a Rage or Energy class it does little.",
    spiTitle: 'Spirit',
    spiBody:
      "Spirit governs how quickly a caster's mana returns, but only once they have gone a few seconds without spending any, so a caster who never stops casting never regenerates. Pausing for a breath is a real mana decision, in a fight as much as between them. Like Intellect, Spirit serves the mana classes and means little to the others.",

    // Secondary / derived stats.
    armorTitle: 'Armor',
    armorBody:
      'Armor reduces the physical damage you take. It comes mostly from what you wear, and the heavier armor classes carry far more of it. More armor against a foe near your level means each of its hits lands softer.',
    apTitle: 'Attack power',
    apBody:
      'Attack power measures how hard your weapon strikes. Your primary attributes feed it, and gear that carries those attributes raises it further, while a stronger weapon raises your damage directly, which is why an upgrade can be a real jump in damage.',
    spTitle: 'Spell power',
    spBody:
      "Spell power is a caster's counterpart to attack power: it raises the damage your spells deal. Intellect feeds it, and caster gear and buffs add more on top, so a spellcaster watches spell power the way a melee fighter watches attack power.",
    critTitle: 'Critical strike',
    critBody:
      'Your critical strike chance is how often an attack lands for extra damage. Everyone starts with a small base chance, and Agility (plus some talents and gear) builds on it. Your sheet shows both the chance itself and the critical strike rating your gear contributes toward it.',
    dodgeTitle: 'Dodge',
    dodgeBody:
      'Dodge is your chance to avoid an incoming melee attack entirely. You begin with a small base chance, and Agility raises it, so nimble classes slip more blows.',
    hasteTitle: 'Haste',
    hasteBody:
      'Haste is one stat that quickens everything you do: melee swings, ranged shots, and spellcasting all speed up together. It comes from gear, most notably armor-set bonuses, while a few abilities grant a short burst of quicker swings. Your sheet shows it as Haste Rating.',
    dpsTitle: 'Damage per second',
    dpsBody:
      'Your sheet also shows a damage-per-second estimate: roughly what your weapon, its swing speed, and your attack power add up to over time. It is a quick way to compare two weapons at a glance.',

    // The character sheet.
    sheetHeading: 'Reading your character sheet',
    sheetBody:
      'Open the character window in game to see all of this in one place: your five attributes on one side and the stats they feed on the other. Hover any value and a tooltip breaks down what it does for your class, so you can see at a glance which numbers an upgrade actually moved.',

    // How stats grow.
    growHeading: 'How your stats grow',
    growBody:
      'Two things raise your stats. Every level adds a fixed amount of each attribute to suit your class, and the gear you equip adds more on top. Keeping your gear current is the steadiest way to grow stronger, all the way to the level cap.',
    // Hit rating: real sim math (miss chance and spell resist), not a display stat.
    hitTitle: 'Hit rating',
    hitBody:
      'Hit rating comes from your gear and its set bonuses. It makes your attacks miss less often and your spells resisted less often, and it earns its keep against enemies above your own level, where misses pile up fastest. Your sheet shows it as Hit Rating.',
    // Parry is the warrior's alone (warrior_hit_table.ts); every other class reads zero.
    parryTitle: 'Parry',
    parryBody:
      "Parry is the warrior's own defense: a chance to turn a melee blow aside entirely and take no damage, and it grows with Strength. Only an attack coming at your front can be parried, which is one more reason to keep facing whatever is hitting you. Other classes see the row on their sheet sitting at zero.",
    // Warfare: one player-facing PvP rating, inert against anything that is not a
    // hostile player. No curve or cap numbers here by design.
    warfareTitle: 'Warfare',
    warfareBody:
      'Warfare is the one stat that counts only against other players: it raises the damage you deal to them and lowers the damage you take from them, and your sheet shows both halves on one line. Against creatures it does nothing at all. It comes from the Warfare gear you buy with honor, so it is a reward for playing PvP rather than something to chase while leveling.',
  },

  // Leveling and Progression. How experience is earned, the journey across the three
  // zones, rested XP, and what waits at the cap. Number-free and spoiler-safe.
  progression: {
    intro:
      'Every fight, quest, and step north makes your hero stronger. Here is how leveling works and what keeps you growing once you reach the top.',
    // How experience is earned, and the cap. {cap} = level cap.
    xpTitle: 'How you gain experience',
    xpBody:
      'You earn experience by completing quests, by defeating enemies, by clearing delves, and by working a profession: harvesting and crafting pay character experience on top of the trade skill they teach, for as long as the work is still teaching you something. Quests give the most by far, so following the quest trail is the fastest way to climb, while kills, delve runs, and the gathering you do along the way fill in the rest.',
    capBody:
      'Each level makes you tougher and brings new abilities, all the way to the cap of level {cap}.',
    // The leveling journey. journeyBody is RETIRED: it described a three-zone strip, and
    // the list of zones under it is derived from the world, so it read as a contradiction
    // once the world had fourteen. The reworded copy is a NEW key because it carries a
    // {zones} token, and adding a token to a shipped key breaks interpolation parity in
    // every locale that already translated it (the subCount / a4Count precedent). The old
    // value stays so the locale overlays that carry it keep resolving; it simply stops
    // rendering.
    journeyTitle: 'The journey north',
    journeyBody:
      'The world is one continuous land, three zones laid south to north, each a step higher in level. You start in the green valley, press on through the marsh, and finish in the cold high peaks. Follow the quest trail and the land carries you from one to the next.',
    journeyBodyCount:
      'The world is one continuous land of {zones} zones. Three of them are the road you level on, laid south to north: you start in the green valley, press on through the marsh, and finish in the cold high peaks. Follow the quest trail and the land carries you from one to the next. An island sits off the valley coast for the early levels, and the rest of the realms open off that same road, built for characters who have already made the climb.',
    bandLabel: 'Levels {min} to {max}',
    // Rested XP, described without numbers.
    restedTitle: 'Rested experience',
    restedBody:
      'Step inside an inn and stay out of combat, and your character builds up rested experience while you wait. Every town has one. The next time you go out and fight, that pool gives your kills an extra boost until it runs dry. A pause at the inn is never wasted time; it speeds your next stretch of leveling. The pool has a ceiling, so an overnight stay banks about as much as a very long one, and once you reach the level cap there is no level bar left to fill, so rested experience stops building.',
    // What happens at the cap: cosmetic, optional, long-term. {cap} = level cap.
    capTitle: 'Reaching level {cap}',
    capJourneyBody:
      'Level {cap} is the cap, the end of leveling but not of growing. From there you run dungeons and the raid on normal and heroic, face the world boss when he rises, chase better gear, and test yourself in the arena.',
    // Named separately rather than folded into capJourneyBody, which is already shipped
    // and translated: the cap-only content that older paragraph predates. Rifts are the
    // one thing gated on the cap itself (RIFT_MIN_LEVEL); delves open far earlier, so
    // they are named here as something that keeps going rather than something that opens.
    capEndgameBody:
      'Rifts are the one thing that waits for the cap itself. They tear open out in the realms on their own schedule, ranked from C to S, and every group in the world races to be the one that closes each of them. The delve boards keep going too, and their harder tier is worth another look once your gear has caught up.',
    prestigeBody:
      'Experience keeps counting even after the cap. It feeds a cosmetic virtual level, so your experience bar keeps climbing, and a long-term prestige rank you can claim from your character sheet once you are there. Passing big lifetime-experience milestones also earns deeds in your Book of Deeds, with cosmetic titles and nameplate borders that show on your character sheet. All of it is purely optional and never grants power, just a mark of the road you have walked.',
    // Gentle reassurance.
    noRush:
      'There is no rush. The world is there to enjoy at your own pace, so wander, take the quests that catch your eye, and let your hero grow along the way.',
    // Riding: the skill is bought and the lesson run at the level gate the trainer
    // states in game. {level} = the riding requirement.
    ridingTitle: 'Learning to ride',
    ridingBody:
      'Riding is one of the things waiting at the end of the climb. At level {level} a stablemaster will teach you the skill for a serious sum of gold, and a lesson out on the training course earns you your first set of reins. A mount grants no power at all; it simply makes the world smaller, which after a long walk north is its own kind of reward.',
  },

  // Generic placeholder for sections still being written (build scaffolding).
  placeholder: {
    note: 'This part of the guide is on its way.',
  },

  // 404 / unknown route.
  notFound: {
    title: 'We could not find that page',
    body: 'The page you were looking for does not exist or may have moved.',
    home: 'Back to the overview',
  },
};
