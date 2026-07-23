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
    reference: 'Reference',
    controls: 'Controls',
    settings: 'Settings & Performance',
    combat: 'Combat',
    talents: 'Talents',
    arena: 'Arena & PvP',
    valeCup: 'Vale Cup',
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
    compendium: 'Compendium',
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
      pillarPlayTitle: 'Play in your browser',
      pillarPlayBody:
        'No download, no launcher. Make a character and you are in the world in seconds, on desktop or phone.',
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
      sub: 'One continuous land, three zones, from quiet valleys to frozen peaks.',
      levels: 'Levels {min} to {max}',
      cta: 'See the world',
      valeName: 'Eastbrook Vale',
      valeBlurb: 'Green hills and old woods where every adventure begins.',
      marshName: 'Mirefen Marsh',
      marshBlurb: 'Sunken fens and tide-worn ruins, home to mudfins and worse.',
      peaksName: 'Thornpeak Heights',
      peaksBlurb: "Wind-scoured ridges climbing toward the realm's coldest dangers.",
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
      a4: 'The cap is level {cap}, reached across three zones of quests, dungeons, and exploration.',
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
      'If you fall, your body stays where it dropped and you rise as a ghost at the nearest graveyard. Run your spirit back to your body to revive on the spot, penalty free, or accept the Pale Keeper at the graveyard for an instant raise at the cost of a passing weakness. Brand-new heroes are spared the weakness entirely, and nothing you own or have earned is ever lost.',
    groupingTitle: 'Playing together',
    groupingBody:
      'Invite others to a party to share quest credit and take on dungeons. Most of the world is soloable, so grouping is a choice, not a chore.',
    onlineTitle: 'Online or offline',
    onlineBody:
      'Play the shared online world with everyone else, or start an instant offline world in your browser to learn the ropes.',
    reassure:
      'Talents unlock at level 10 and can be reset any time you are out of combat, so your early choices are never permanent. Experiment freely.',
    controlsLink: 'See the full controls reference',
  },

  // Controls reference (most action labels reuse the shared controls.* catalog).
  controls: {
    intro:
      "Default keys for desktop. Every binding can be changed in the game's options, except Esc, which always opens the game menu, and a binding can be a modifier combo like Shift+Z.",
    keyHeader: 'Key',
    actionHeader: 'Action',
    groupMovement: 'Movement',
    groupCombat: 'Targeting and combat',
    groupInterface: 'Interface',
    groupCamera: 'Camera',
    talents: 'Talents',
    arena: 'Arena',
    leaderboard: 'Leaderboard',
    deeds: 'Book of Deeds',
    crafting: 'Crafting',
    valeCup: 'Vale Cup',
    calendar: 'Event Calendar',
    discord: 'Discord',
    abilities: 'Use action bar abilities (the number row; a second bar sits on the numpad)',
    targetFriendly: 'Target nearest friendly',
    cycleFriendly: 'Cycle friendly target',
    gameMenu: 'Open game menu and options',
    bothMouse: 'Both Mouse Buttons',
    runForward: 'Run forward',
    arrowKeys: 'Arrow Keys',
    groupPet: 'Pet commands',
    petBar:
      'Pet bar: Attack, Stop, Taunt, Defensive, Aggressive (with a hunter or warlock pet out)',
    attackMoveNote:
      'One more, off by default: enable Attack Move in the options to reserve a key (A, while the option is on) that walks you toward your cursor and opens up on the enemy under it, or the first one met along the way.',
    mobileHeading: 'On mobile',
    mobileBody:
      'Touch controls appear automatically on phones and tablets: a movement stick on the left, drag anywhere else to look, pinch with two fingers to zoom the camera, and on-screen buttons for your abilities and menus. A small arrow in the top left corner shows or hides the menu buttons, and the More button there holds the rest of your windows.',
    controllerHeading: 'On a controller',
    controllerBody:
      'Gamepads work too, and controller support is on by default. The left stick moves, the right stick aims the camera, and the face and shoulder buttons cover your abilities, jumping, and interacting. Open a window like your bags to bring up an on-screen pointer, and the game menu navigates directly with the D-pad and face buttons. You can remap the buttons and adjust stick deadzone, camera speed, vibration, and inverted look from the controller settings in the options.',
  },

  // Settings & Performance reference. Option and value NAMES reuse the game's own
  // hud.options.* / hudChrome.* keys (already localized); only the surrounding prose
  // lives here. Plain-language behavior and costs, no engine jargon or internals.
  settingsPage: {
    heading: 'Settings & Performance',
    intro:
      'Make the game look its best or run its fastest. Three ready-made loadouts, plus what every graphics option really does.',
    wherePath:
      'Everything on this page lives in the game: press Esc to open the options. The menu opens on an Overview of pinned essentials, with the categories on a rail beside it: the settings below live under Graphics, Interface, and Accessibility in the Display group, and the Performance Overlay under System. Faster still, type a name into the search box at the top and jump straight to it.',
    fairnessTitle: 'Fair by design',
    fairnessBody:
      'No option here trades beauty for power. Lower settings shed cosmetic polish only, never information you fight with: your debuffs, cast bars, party health, and damage numbers are identical from Low to Ultra. Playing on a modest machine is never a handicap.',
    loadoutsHeading: 'Three ready-made loadouts',
    loadoutsIntro:
      'Start from the loadout that sounds like your machine, then adjust one option at a time until it feels right.',
    recommended: 'Recommended',
    whyLabel: 'Why it works:',
    tagReload: 'after reload',
    fpsTitle: 'Best FPS',
    fpsTagline: 'For older laptops, integrated graphics, and battery play.',
    fpsWhy:
      'Graphics Quality is the master switch, and Render Quality is the strongest slider: at 70% the world draws roughly half the pixels while the interface stays perfectly sharp.',
    balancedTitle: 'Balanced',
    balancedTagline: 'The sweet spot for most machines, and our default advice.',
    balancedWhy:
      'Medium brings real shadows and full materials; High adds ambient occlusion and bloom. Below Ultra a built-in safety net absorbs sudden dips in busy fights, so Balanced stays smooth without babysitting.',
    visualsTitle: 'Best Visuals',
    visualsTagline: 'Screenshot mode for powerful desktop machines.',
    visualsWhy:
      'Ultra renders at the highest resolution your display offers with the richest lighting. It also switches the safety net off, and it is desktop-only: phones and the app top out at High.',
    value50to70: '50 to 70%',
    value90to100: '90 to 100%',
    value100: '100%',
    valueHighOrMedium: 'High on a gaming PC, Medium on a laptop',
    valueOnOptional: 'On (optional)',
    howHeading: 'How the options behave',
    factDetectTitle: 'The game tunes itself first',
    factDetectBody:
      'On your first launch the game reads your device and picks a sensible tier, from Low on a modest phone to Ultra on a strong desktop. Any choice you make yourself always wins.',
    factReloadTitle: 'Two kinds of options',
    factReloadBody:
      'Graphics Quality and the Advanced pickers take effect after a reload, and the panel offers a Reload Now button when needed. Every other option applies the moment you change it.',
    factGovernorTitle: 'A built-in safety net',
    factGovernorBody:
      'On every tier below Ultra, the game quietly thins grass, effects, and lighting for a moment when a big fight spikes, then restores them. Choosing Ultra tells it you would rather keep every detail.',
    factSearchTitle: 'Search finds it first',
    factSearchBody:
      'Not sure where an option lives? Type in the search box at the top of the menu. It understands common phrasings too, so fps finds the FPS readout, and choosing a result jumps you to the setting and leaves it highlighted.',
    advancedHeading: 'The Advanced preset: mix your own',
    advancedBody:
      'Advanced starts from the High tier and unlocks four extra pickers, so you can spend your frames where you actually notice them: Terrain Detail, Foliage Density, Effects & Lighting, and Shadow Quality. Like Graphics Quality, they apply after a reload.',
    advancedMixes:
      'Two favorite mixes: keep Shadow Quality on High and set Effects & Lighting to Low for a crisp, glow-free look that runs light, or do the reverse to keep the bloom and soften the shadows.',
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
      'Bloom, ambient occlusion, and how many torches and spells cast real light. The single biggest saving among the Advanced pickers.',
    rowShadowQuality: 'Shadow crispness. Low keeps shadows but softens their edges.',
    rowFrostedPanels:
      'A frosted-glass blur behind windows. Pretty, and exactly the kind of effect a weaker browser feels; leave it off for the classic crisp look.',
    rowReduceMotion:
      'Removes interface animations so windows appear instantly. An accessibility option first, with a small performance bonus.',
    rowPerfOverlay:
      'An on-screen readout of FPS, frame time, and more. Turn it on while you tune this page, then hide it again.',
    tableFoot:
      'Looking for a draw-distance slider or an FPS cap? There is nothing to hunt for: view distance is part of each quality tier, and frame pacing follows your display.',
    mobileTitle: 'On phones and tablets',
    mobileBody:
      'Mobile manages more for you: the game picks the tier, holds resolution a touch lower to protect battery and heat, and keeps the highest tiers desktop-only. The loadouts above still apply; phones simply top out at High.',
    touchBody:
      'On a touchscreen the options also grow a comfort cluster of their own: joystick size and sensitivity, on-screen button size and opacity, a left-handed mirrored layout, an optional camera stick, and inverted touch look, so the screen fits your hands rather than the other way around.',
    // Non-graphics options: the Audio tab and the live language picker.
    audioTitle: 'Sound and language',
    audioBody:
      'The options window is not all pixels. An Audio category holds separate volume controls for effects, music, and voice, and the Interface category carries a language picker that relocalizes the whole interface on the spot, no reload needed, plus a theme picker for the window dressing. Language is also pinned first on the Overview, so it is always one step from opening the menu.',
    autolootBody:
      'Prefer not to click every corpse? An interface option, off by default, scoops the loot from your own kills as you walk past them.',
  },

  // Combat overview. Deliberately high level: concepts, not formulas or numbers, so
  // there is nothing here to min-max or exploit.
  combat: {
    intro:
      'Combat follows familiar classic-MMO rules. You never need to study any of it to play well, this is just the shape of how fights work.',
    hitTitle: 'Not every blow lands',
    hitBody:
      "Attacks can miss or be dodged, and so can the enemy's, while spells can be resisted outright. Fighting close to your own level is what keeps your hits connecting; the wider the level gap, the more you swing at air.",
    mitigationTitle: 'Armor and health keep you standing',
    mitigationBody:
      'Armor softens physical hits, so better armor is your main source of staying power in melee. Magic is another matter: you weather spells with a deeper health pool and the chance to resist one outright, not with armor. Heavier armor classes shrug off more, but nothing makes you untouchable.',
    resourcesTitle: 'Every class has its own rhythm',
    resourcesBody:
      'Warriors build Rage in the thick of a fight, rogues spend Energy that steadily returns, and casters manage a pool of Mana. Learning your resource is half of playing your class well.',
    growTitle: 'You grow stronger every level',
    growBody:
      'Each level makes you tougher and unlocks new abilities, all the way to the cap of level {cap}. Questing is the fastest way up; hunting, dungeon runs, and delves round it out.',
    // Status effects: buffs, debuffs, damage over time, crowd control with diminishing returns.
    effectsTitle: 'Buffs, debuffs, and crowd control',
    effectsBody:
      'Many abilities apply an effect that lingers. Helpful ones (buffs) raise your stats, shield you, or heal you a little at a time; harmful ones (debuffs) drain your health with damage over time or weaken you. Watch the small icons in the top corner of the screen, beside the minimap, to see what is on you and how long it lasts.',
    ccBody:
      'Crowd control is a special kind of debuff that limits what a target can do: stuns, roots and slows, silences that stop spellcasting, disarms, fears, and transformations that turn a foe harmless for a moment. Against other players, control wears thin with repetition: the same kind reapplied too quickly weakens and then fails outright, and a stun that opens from stealth is counted apart from the stuns that follow, so nobody can be chained helpless forever. The creatures of the world hold no such grudge: control never weakens with repetition against them, though many of the mightiest foes, named elites and the strongest bosses among them, cannot be controlled at all.',
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
  },

  // Glossary.
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
      'A specialization: the path you lean your class toward, like healing or damage, as you spend talents.',
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
      'A saved talent layout. Keep several and swap between builds without respending your points one by one.',
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
  },

  // FAQ page (fuller than the home teaser).
  faqPage: {
    intro: 'The questions new players ask most often.',
    q1: 'Is it really free?',
    a1: 'Yes. The whole game is free to play to the level cap, and the source code is open on GitHub.',
    q2: 'Do I need a crypto wallet or any tokens?',
    a2: 'No. The game is fully playable without one. The optional community token only adds cosmetic flair and a share of the daily rewards prize pool, and it never affects power or progression.',
    q3: 'Can I play on my phone?',
    a3: 'Yes. The game runs in a mobile browser with touch controls, and there is a desktop launcher as well.',
    q4: 'Can I play offline or solo?',
    a4: 'Yes. There is an instant single-player offline mode, and the online world is fully soloable apart from dungeons, the raid, and the world boss.',
    q5: 'How many classes are there?',
    a5: 'Nine, covering the classic tank, healer, and damage roles, each with a resource system (rage, mana, or energy) and its own signature abilities.',
    q6: 'What is the level cap?',
    a6: 'Level {cap}, reached across three connected zones of quests, dungeons, and exploration.',
    q7: 'Will my character be saved?',
    a7: 'Online characters are saved on the server automatically. Offline characters live in your browser for quick sessions and testing.',
    q8: 'Can I host my own copy?',
    a8: 'Yes. The project is open source, so you can run your own server. See the GitHub repository.',
    q9: 'Is there PvP?',
    a9: 'Yes. Duel anyone for fun, or step into the Ashen Coliseum to fight other players. PvP is opt in, so you are never forced into it.',
    q10: 'What is there to do at max level?',
    a10: 'The cap is level {cap}. From there you run the five-player dungeons and the ten-player raid, take them on again in heroic mode for upgraded loot, face the world boss when he rises, test yourself in the arena, drop into delves with a companion at your side, and chase deeds in the Book of Deeds to climb the realm standings.',
    q11: 'How do I find a group?',
    a11: 'Invite anyone you meet to a party, ask in chat, or team up at a dungeon. Most of the world is soloable, so grouping is a choice, not a requirement.',
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
  },

  // World / zones.
  worldPage: {
    heading: 'The world',
    intro:
      'World of ClaudeCraft is one continuous land you cross on foot, three zones laid south to north. There is no fast travel, so the journey is part of the adventure.',
    hub: 'Home base',
    mapHeading: 'The road north',
    mapSub:
      'Three zones, south to north, each a step higher in level. Follow the quest trail and the land carries you from the valley to the peaks.',
    places: 'Notable places',
    residents: 'Who you will meet',
    valeBlurb:
      'The green starting valley, where new heroes cut their teeth on wolves and bandits around the town of Eastbrook.',
    marshBlurb:
      'A drowned country of fog and ruins. Mudfins swarm the shallows and something older stirs beneath the water, watched from the bridge-town of Fenbridge.',
    peaksBlurb:
      "Wind-scoured ridges and old mine-works climbing to the realm's coldest, highest dangers, held by the outpost of Highwatch.",

    // One quotable hub greeting per zone, keyed by biome. Speaker names are proper nouns
    // (passed as raw text in world.ts), so only the spoken line is a key here.
    valeGreeting: 'Keep your blade close. The Vale is not what it was.',
    valeGreeter: 'Marshal Redbrook, Eastbrook',
    marshGreeting: 'Hold at the gate. Past those reeds, the fen does the killing for us.',
    marshGreeter: 'Warden Fenwick, Fenbridge',
    peaksGreeting:
      'Two hundred years this wall has held. It will not break on my watch, but it groans.',
    peaksGreeter: 'Captain Thessaly, Highwatch',

    // Short, spoiler-safe one-liners for each zone's notable places (keyed by biome). One
    // sentence per place, in the same order as the POI list.
    valePlaceNotes:
      "Eastbrook is your first home base. Wolf Run and Boar Meadow are gentle hunting ground; Mirror Lake is fine fishing water, though mudfins swarm its shallows; the Sableweb and the Copper Dig hide spiders and ore-greedy diggers; a Bandit Camp and the Fallen Chapel hold rougher work; Reliquary Hill drops into the Collapsed Reliquary, the realm's first delve; Brightwood Glade is a quiet, sunlit grove to the north; and the Sowfield is Eastbrook's walled boarball ground, where the Vale Cup plays under a harvest truce.",
    marshPlaceNotes:
      "Fenbridge guards the only dry road. The Prowler Reeds and Deepfen Shallows teem with marsh beasts and mudfins; the Widow Thicket is spun thick with web; the Drowned Chapel and the Troll Mounds keep older dangers, with The Drowned Litany, the marsh's own delve, opening just north of the mounds; the Gravecaller Encampment is the cult dug in, and the Sunken Bastion is the marsh's instanced heart.",
    peaksPlaceNotes:
      "Highwatch holds the wall. Stalker Ridge and the Deeprock Burrows belong to ridge cats and burrowers; the Ogre Foothills and Drogmar's War-Camp to brutes for hire; Stormcrag crackles with elementals, and below it glows the Glimmermere, the tarn whose shore keeps the gate of pale light down to the Drowned Temple; the Wyrmcult Tents and Revenant Fields ring the cult's high ground, with Gravewyrm Sanctum at its peak.",

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
  },

  // Quests.
  questsPage: {
    heading: 'Quests',
    intro: 'Quests are the heart of the world and the fastest way to level. Here is how they work.',
    acceptTitle: 'Finding and accepting',
    acceptBody:
      'People with a marker over their head have work for you. Talk to them to accept a quest. In Eastbrook, Marshal Redbrook is waiting with Wolves at the Door, one of the first quests you can take.',
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
      "Thin out a pack of beasts or break a cult's hold by defeating a set number of a marked enemy. One of your first quests, clearing wolves off the Eastbrook road, is one of these.",
    typeGatherTitle: 'Gather',
    typeGatherBody:
      "Collect items from the world or from what enemies drop: herbs, ore, a cult's grim reagents. Some pieces only fall from a particular foe, so the hunt and the haul go together.",
    typeInteractTitle: 'Interact',
    typeInteractBody:
      'Use, cleanse, or read something fixed in the world: a defiled grave, a warning carved on a shore-rock, a sealed crypt door. Walk up to the marker and act on it.',
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
    party: 'Dungeons are built for a party of five. The endgame raid is for ten.',
    soloLead:
      'Every dungeon opens with a soloable lead-in quest, so you always know why you are going in.',
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
    raidName: 'The endgame raid',
    raidBody:
      'Beyond a sealed royal door waits a ten-player trial: a multi-stage fight and a deathless power the whole raid must shut down together. Earn your way in, then bring nine friends.',

    // Heroic difficulty. Spoiler-safe: what it is, how to set it, the Marks economy and
    // daily rhythm. No multipliers, mark counts, prices, or encounter changes.
    heroicTitle: 'Heroic mode',
    heroicBody:
      'Every five-player dungeon, and the raid itself, has a heroic version waiting past the level cap. The same halls, remade for a geared endgame party: everything hits harder, nothing can be outrun on foot, and the bosses shrug off stuns and snares entirely. Outgrow the normal versions first; heroic assumes you have.',
    heroicHowBody:
      'Choose the difficulty before your group claims the instance: type /dungeon heroic, or flip the Dungeon Difficulty toggle on the party menu. The choice is shared by the whole party and locks in at the door, so a run stays what it was claimed as.',
    heroicRewardsTitle: 'Heroic Marks and upgraded spoils',
    heroicRewardsBody:
      'Heroic bosses drop the loot you know, upgraded and tagged Heroic on the tooltip, and the final boss of each run adds epics found nowhere else. That last kill also leaves Heroic Marks for every participant: a currency spent with Quartermaster Vex in Highwatch, whose stock of rings and necklaces is the only jewelry in the realm.',
    heroicLockoutBody:
      'Normal dungeons can be run all day. Heroic asks patience: the final boss kill locks everyone in the run to one heroic clear of that dungeon per day, and the raid keeps a daily lockout for each difficulty. A cleared five-player run stays open to its own party for corpse runs and loot, so nobody is locked away from what they earned there. The raid is stricter: once its kill locks you, the door stays shut until the daily reset, so collect your spoils before you leave the arena.',

    // Reset All Instances: the difficulty-transition escape hatch. Spoiler-safe: no exact
    // cooldown or timer lengths in the prose.
    resetTitle: 'Resetting your instances',
    resetBody:
      'Switch difficulty while your group still holds claimed runs and the old claims linger for a while before clearing on their own. The party leader can let them go at once instead: choose Reset All Instances on their own portrait menu, or type /dungeon reset. A reset works only after the difficulty has actually been changed, only while nobody, living or fallen, remains inside, and a short cooldown separates one reset from the next. Arrive at the door on the wrong difficulty and the game says so before the run starts. The raid is never reset this way; its own lockout rules stand.',

    // Standalone, spoiler-safe lore for the Drowned Temple card (the goddess twist and any
    // boss names are withheld).
    templeLoreTitle: 'The Drowned Temple, a little deeper',
    templeLoreBody:
      'The temple has its own legend, older than the cult you chase elsewhere. On the shore of the Glimmermere, a tarn that drinks the moonlight and gives back the drowned, a lone watcher keeps a gate of pale light. Beneath the surface, a stair of cold stone runs down to it. The folk who sank there did not drown by misadventure: they were the Pale Choir, who went under in worship and never stopped singing. The old wardens scratched a single warning into the rocks before the water took them, a prayer to something they called the Drowned Moon, with a steadier hand adding two words beneath it: it only sleeps.',

    // Teased lead-in from the forgotten-king crypt side-arc to a second raid trial.
    cryptLeadTitle: 'A door the dead were meant to keep shut',
    cryptLeadBody:
      'High on the peaks, away from the main fight, lies a colder mystery. Old graves bear a crown no record remembers, and the dead who guard them once served a forgotten king. Read their stones, gather the keystones they kept, and you can unseal a tomb that three loyal souls died to hold closed, the optional trial that opens the realm to its ten-player raid for those who follow the clues to the end.',
  },

  // Delves: the short, replayable instanced descents. The roster (name, level floor, party
  // size, keeper, companion, difficulty tiers, run-modifier names) is generated from the sim;
  // these are the explainer strings. Spoiler-safe: no numbers, lock layouts, Marks prices, or
  // loot. Card field labels and the per-section copy.
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
      'A delve is a small instanced dungeon made just for you and up to one ally, a private copy you cannot be disturbed in. You start it from a board kept by a delve keeper out in the world, drop in, fight down through a handful of rooms, and finish on a single guardian. Runs are quick and meant to be repeated, so a delve is a reliable bit of progress whenever the open world runs dry.',
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
      'Clearing delves earns Delve Marks, a currency kept apart from your coin. Spend them at the keeper to strengthen your companion and pick up gear you will not find anywhere else.',
    whereHeading: 'Where to find one',
    whereBody:
      'The first delve, the Collapsed Reliquary, opens at Reliquary Hill in the starting valley of Eastbrook Vale. Brother Halven keeps the board there, and he will send you down once you are ready. His rounds do not end there: past the Troll Mounds at the northern edge of Mirefen Marsh, the same keeper opens The Drowned Litany for delvers who have found their feet.',
  },

  // Talents and Specializations reference.
  talentsPage: {
    heading: 'Talents and specializations',
    intro:
      'Talents are how you make a class your own. They are optional, forgiving, and easy to change, so you can experiment without fear.',
    whatHeading: 'What talents do',
    whatBody:
      'As you level, you earn talent points to spend on small, permanent upgrades to your abilities and stats. They shape how a class feels, leaning it toward more damage, sturdier defense, or stronger healing.',
    howHeading: 'How they work',
    howBody:
      "Talents open up at level 10, and you keep earning points as you climb to the cap. You spend them in your class's talent panel, where deeper rows open as you invest and level, and you can save more than one layout to swap between builds.",
    shareNote:
      'A finished build can be copied to a short shareable code and handed to a friend, who pastes it straight into their own talent panel to load it.',
    choiceNote:
      'A few points on every tree are a crossroads rather than a purchase: the node offers two or three options and you commit to one of them. Your next reset reopens the choice, like everything else on the tree.',
    resetTitle: 'Nothing is permanent',
    resetNote:
      'You can reset your talents any time you are out of combat and not in an arena match, so an early pick is never a trap. Try things, see what you like, and change your mind freely.',
    specsHeading: 'Specializations by class',
    specsBody:
      'Every class has a handful of specializations, each with its own role and a signature focus. Choosing one in the talent panel grants a signature ability and a lasting mastery of its own. Here is the shape of all of them. Open a class for its full kit.',
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
      "The Coliseum is the realm's arena, where you face other players in ranked matches, one on one or two on two. Each bracket keeps its own standing, so a win lifts you up that ladder for the whole realm to see. Open the Arena window to sign up for a bracket, alone or with your partner.",
    fiestaHeading: 'Two versus two Fiesta',
    fiestaBody:
      'Fiesta is a fast, two-on-two brawl fought as one continuous bout, with every fighter brought to an even footing. As the fight runs you draft augments, quick boosts that reshape your kit on the fly, so no two matches play quite the same.',
    augmentsNote:
      'Augments and power-ups last only for the match. They are about playful, on-the-spot builds, not lasting power, so nobody buys their way to a win.',

    // The three escalating augment waves, named as flavor. No numbers, no exact effects.
    wavesTitle: 'Augments arrive in waves',
    wavesBody:
      'A Fiesta bout hands you fresh picks as it goes, and the picks grow bolder the longer the fight runs. You build from one wave to the next, choosing one of a few options each time and keeping it for the rest of the bout.',
    waveSilverTitle: 'Silver',
    waveSilverBody:
      'The opening wave: clean, single-stat boosts that sharpen the basics of your class.',
    waveGoldTitle: 'Gold',
    waveGoldBody:
      'The middle wave: two-edged combos where your build starts to take shape and sing.',
    wavePrismaticTitle: 'Prismatic',
    wavePrismaticBody:
      'The final wave: build-defining, screen-melting spikes meant to feel ridiculous in the best way.',

    // The grab-in-the-ring power-ups, named as playful flavor.
    yumiHeading: 'Protect Yumi',
    yumiBody:
      'Protect Yumi is a team objective mode played in a maze: each side guards its own cat familiar while hunting the other. Every so often both cats blink to new corners of the maze, so the fight swings between defending, hunting, and racing to find them again. Queue as three versus three or five versus five; falling in battle only benches you for a moment.',
    powerupsTitle: 'Power-ups in the ring',
    powerupsBody:
      'Glowing orbs also drop into the arena mid-fight, free for whoever reaches them first. They are deliberately over the top and last only a short while: Speed Demon for a blink of blinding pace, Colossus to swell up into a lumbering giant, Moon Boots for a bouncing, low-gravity leap, and Berserker for a sudden surge of fury.',
    ladderHeading: 'Climbing the ladder',
    ladderBody:
      'Ranked play tracks your standing over time. Check the leaderboard to see where you sit and who holds the top of the realm.',
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
      'Renown is the score behind the Book. Every deed you earn is worth a set amount, and your total only ever climbs, so a quiet week never costs you ground. A handful of deeds turn on luck rather than skill, and Feats are an honor of their own, so both of those are worth no Renown at all. Deeds without Renown still count toward completion in your Book; they simply never score.',
    rewardsHeading: 'Titles and borders',
    rewardsBody:
      'The rewards are all for show, and that is the point. Some deeds grant a title you can wear or a border to frame your name, and never anything that makes your hero stronger. Choose the title you want from the Book of Deeds and it rides along on your nameplate, in chat, and on the boards for everyone to see.',
    chroniclesHeading: 'Chronicles',
    chroniclesBody:
      'Each zone keeps its own Chronicle, a set of deeds gathered by a local Chronicler who has taken it upon themselves to record every traveler who passes through. Saul of Eastbrook Vale is the first of them. A Chronicle is split into chapters, and you are free to work through them in whatever order suits you.',
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
      'They unlock at level 10 and reset whenever you like, out of combat, so your early choices are never permanent.',
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
      'You have a weapon slot, seven armor slots, and three jewelry slots: a neck and two fingers. Each class can use only certain weapons and wears armor up to its own weight, cloth, leather, or mail, so the upgrades that fit you are the ones made for your class. Jewelry carries no weight at all: any class wears whatever it earns. Within that, fill every slot with the best piece you find.',
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
      'Everything you pick up rides in one shared pack, and you grow it by equipping bags. Your bags window keeps four bag sockets: click a bag in your pack to sling it into a free socket, and every bag you wear adds its own room. Simple bags are cheap vendor goods, roomier ones drop from beasts, and the finest come from dungeon bosses, so your carrying room grows right alongside your gear.',

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
      'Most of your early upgrades are quest rewards, so it pays to finish quests rather than grind. Enemies drop gear when you defeat them, vendors in town sell solid basics, crafters turn gathered materials into wearable pieces, and the player market lets you buy from other adventurers. At the top of the hill, two mark currencies buy gear found nowhere else: Delve Marks at the delve keeper, and Heroic Marks at the heroic quartermaster.',

    // Soulbound items. Flag-level only: bound from acquisition, no BoP/BoE tiers exist.
    soulboundTitle: 'Soulbound: yours and yours alone',
    soulboundBody:
      'A few special rewards are soulbound, bound to your character from the moment you earn them. A soulbound item cannot be traded, mailed, sold to a vendor, or listed on the market; it is yours and yours alone. Today that protection guards prize tokens such as Heroic Marks, while the gear you win is yours to trade, sell, or share freely.',

    // Tier sets and set bonuses. Concept only: no set names, bonus numbers, or the raid boss.
    setsTitle: 'Sets and set bonuses',
    setsBody:
      "Some armor comes in matched families, several pieces cut to look and fight as one. Wear enough of a family at once and the set wakes up, granting bonuses on top of each piece's own stats, and the more pieces you wear the stronger it gets. A few such families turn up as prized drops while you level; the greatest of them come from the toughest group content near the level cap, so chasing a full set is a classic endgame goal.",

    // Consumables: potions, food, drink, elixirs. No numbers.
    consumablesTitle: 'Consumables',
    consumablesIntro:
      'Some items are used once for a quick benefit. They are cheap insurance, so keep a few on hand.',
    consumablesPotions:
      'Potions restore health or mana the moment you use them, even mid-fight, which makes them a clutch save when a pull goes wrong. They share a short cooldown, so plan one good moment to use them.',
    consumablesFood:
      'Food and drink restore you while you sit and rest between fights. Eating recovers health, drinking recovers mana, and resting this way is free. Sit down for a few seconds after a tough fight instead of running into the next one half-healed.',
    consumablesElixirs:
      'Elixirs grant a temporary buff while you adventure, a small edge that helps when you want to push a little further.',

    // Fishing: relaxing side activity. Broad terms only.
    fishingTitle: 'Fishing',
    fishingBody:
      'Fishing is a calm change of pace. Carry a fishing pole, use it beside open water, and reel in what bites. You mostly catch fish that are food you can eat, the odd bit of junk to sell for a few coins, and now and then a prized rare catch. What you find depends on the water you fish in.',
    fishingFood:
      'The fish you reel in are food: eat one while you sit to rest and it restores health, with the heartier fish coming from the colder, deeper waters in the north. A line in the lake is a quiet way to keep your pack stocked between fights.',
    fishingRare:
      'Now and then your line catches something far better than supper: a shimmering prized fish that any angler might luck into in any water. Hook one and your log lights up with the catch. It is the kind of lucky pull that makes an idle afternoon at the lake worth telling people about.',

    // Looks and cosmetics (skins). Appearance only.
    cosmeticsTitle: 'Looks and cosmetics',
    cosmeticsBody:
      'Some rewards change only how your character looks, never how strong you are. These cosmetic skins let you stand out without affecting the game, so wear whichever you like.',
    cosmeticsRanks:
      'Cosmetics come in rarity tiers of their own, and the rarer ones are a fun thing to chase. Earning a higher tier also unlocks the looks below it.',
    cosmeticsSkins:
      'There are two cosmetic lines to collect. Most classes have several alternate appearances, a fresh take on the class look that is yours to wear. Alongside them sit chromas: named two-tone color schemes that repaint a look entirely, from sober metals to bright imperial colors.',
    cosmeticsCache:
      'A few of these come from a mysterious cosmetic cache, a sealed prize that rolls one of three quality grades when you open it and grants the appearance to match. It is purely for looks: nothing inside it makes you stronger, only finer to look at.',
    cosmeticsApply:
      'Set your active look from the appearance row on your character screen, and switch freely among everything you have unlocked.',
  },

  professions: {
    intro:
      'Beyond combat and quests, the world rewards you for working the land and the forge: gathering raw materials, turning them into gear and goods across ten crafting trades, and settling into an identity as one of the ten archetypes those trades represent.',

    // Corpse component harvesting: open to every character, no profession gate.
    // (Rendered on the gathering detail pages.)
    harvestTitle: 'Harvesting the hunt itself',
    harvestBody:
      'Gathering does not stop at nodes. Many slain beasts can be harvested once each, first come first served, for hides, fangs, silk, and meat, straight from the corpse alongside its ordinary loot; one press opens both. The choice is yours each time, too: strip everything the corpse offers, or concentrate on fewer components and take a measurably finer grade of what you do take.\n\nA rare or better harvest roll on a specimen-bearing family also grants a signed perfect specimen (a Pristine Hide, Pristine Silk, Pristine Venom Gland, or Prime Cut) on top of the ordinary yield, and records A Perfect Specimen in your Book of Deeds. Any character can harvest, no training required, and any gathering tool you own counts toward the premium arm, whichever trade it belongs to.',
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
      'A declaration is not a life sentence, either. A pair you have never held is simply a fresh attunement quest, while returning to a pair you walked away from asks you to make amends first: five tasks the first time, and three more added for every switch you have already made. The choice stays meaningful without ever locking a door for good.',

    // Professions hub (Professions 2.0 wiki arm, final prose): the
    // overview page renders the generated ring/gathering/archetype data and
    // links every detail page. The transparency policy
    // lets these sections carry exact numbers. Multi-paragraph bodies use
    // '\n\n' and render through the shared paras() helper.
    whatHeading: 'A trade beside the sword',
    whatBody:
      'Professions are the working life of the world: four gathering trades that pull raw material straight out of the land, and a ring of ten crafts that turn it into gear, meals, potions, and tools. Everything feeds something else here. The ore you mine becomes a blade, the blade takes an enchant, and the enchant needs dust broken out of old gear, so a gatherer, a crafter, and a tinkerer are all links in one chain.\n\nThere is no profession limit to agonize over. Every character can raise all eight crafts that have content today and all four gathering professions side by side; the only exclusive choice is your archetype, the identity you eventually swear to, though once you attune the crafts that fall dormant behind it stop climbing. Skill never goes down, and nothing you learn is ever taken away.',
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
      "The ten crafts sit on a fixed wheel, and geography on that wheel matters. Every two neighbors form a named pair: Smith for Weaponcrafting and Armorcrafting, Outfitter for Leatherworking and Tailoring, Apothecary for Alchemy and Cooking, Bombardier for Engineering and Alchemy, and six more around the ring.\n\nAttuning to a pair is a quest, not a menu click. Four pairs can be joined today (Smith, Outfitter, Apothecary, and Bombardier), each anchored by a resident master in Eastbrook whose acceptance quest states the whole bargain up front before you take it. Until you declare, every craft advances freely on recipes up through the rare tier, so you can try everything before you choose.\n\nOnce you attune, your two pair crafts become your majors, with no ceiling short of the cap. The rest of the wheel does not go dark: one craft opposite your majors stays on as a hobby that keeps climbing through the rare tier (a repeatable quest at Smith Haldren's forge lets you swap which one), and every other craft goes dormant. A dormant craft keeps its skill and its common recipes; it simply stops climbing and never turns out a masterwork while it rests.",
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
      "Fresh off the road in Eastbrook? Find Foreman Odell and take A Trade for Every Hand: he will point you at the ore veins around the Copper Dig southwest of town and hand you your first calluses. From then on, harvest every vein, timber stand, and herb patch you pass while questing; proficiency comes naturally to travelers.\n\nBack in town, press T to open the crafting window and work the common recipes every character knows from the start. Visit the masters at the forge, kitchens, loom, and toolworks to see what they teach, and take their work orders for steady coin. By the time the Guild's letter finds you, you will already know which pair feels like home.",
    colStation: 'Station',
    colHub: 'Hub',
    colMaster: 'Master',
    masterCellFmt: '{name}, {title}',
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
        'Engineering builds the tools every serious gatherer ends up wanting: the tier 4 and tier 5 picks, axes, and sickles no vendor will ever stock, each one consuming the tool below it.',
      enchanting:
        'Enchanting takes gear apart and puts the power back in: break unwanted pieces into arcane materials, then spend them on a permanent stat bonus for a piece you mean to keep. No station, no trainer, and anyone can start on day one.',
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
          'Mining is the backbone. Copper ore comes off the tier 1 veins of Eastbrook Vale, iron ore from Mirefen Marsh, and osmium ore from Thornpeak Heights, and each rung of the ladder steps up the same way. Logging matters more than you might expect: ironbark hafts the boar spear, ashwood shoulders the maul, and a single highpine log forms the battle staff.\n\nThe rest comes from the hunt and the counter. Rough hide for grips is harvested straight off wolf and boar corpses, bone fragments drop from everyday kills, and the forge ladder burns Smithing Flux, 20 copper a jar from Darva herself. If your own mining lags behind, Darva sells osmium ore at the forge and Tinker Gizzel stocks glyphsteel bars at the toolworks, at a premium that makes gathering friends look cheap.',
        ladderHeading: 'The ladder, rung by rung',
        ladderBody:
          'One field recipe, the Eastbrook Arming Sword, is known to everyone from the start and crafts anywhere from hunt drops (a couple of wolf fangs and bone fragments) plus six Smithing Flux off the forge counter. The real ladder is nine trainer recipes in three rungs, all forge-bound: the copper rung (bearded axe, flanged mace, boar spear) is free to learn at skill 0, the iron rung (longsword, maul, dirk) opens at skill 25 for 25 silver a recipe, and the osmium rung (warblade, war axe, battle staff) opens at skill 50 for 1 gold each. Darva teaches a recipe the moment your tier in the craft reaches its own, so each rung unlocks exactly when its skill band begins.\n\nOne more recipe rides the pair: the Gravewyrm Gauntlets, a trainer-taught combination piece that only an attuned Smith with both Weaponcrafting and Armorcrafting at skill 25 can work, and it needs no station at all.',
        routeHeading: 'Masterworks, and a working route to 125',
        routeBody:
          "Any piece with a real stat line, which on this ladder means the iron rung and up, can come off the anvil as a masterwork; the statless copper commons never proc, because there is nothing in them to improve. Iron counts as a tier 1 material for the masterwork bonus, highpine and glyphsteel as tier 2, so the top rung procs a little more often.\n\nRide the copper rung to 25, train the iron rung the day it opens and ride it to 50, then the osmium rung to 75. Past 75 nothing higher ships yet, so the osmium recipes fade to half and then quarter gain: budget roughly 150 more crafts to reach the 125 cap, and remember the shared throttle of ten craft actions per minute when you sit down to batch.\n\nFund the climb as you go: Darva's forge work order takes eight copper ore off your hands every 30 minutes for a little coin and XP, and the iron and osmium rungs sell honestly to leveling melee. The Book of Deeds marks Edge and Temper at skill 50 and crowns Grandmaster Weaponcrafting at 125.",
      },
      armorcrafting: {
        identityHeading: 'Mail for the front line',
        identityBody:
          "Armorcrafting's ladder reads like a soldier's career: the plain riveted copper girdle, sabatons, and gauntlets to start, the ironlink hauberk, legguards, and spaulders with their first real stat lines, and the rare osmiumscale greathelm, cuirass, and leggings, Strength and Stamina pieces with the biggest armor numbers a crafter can make.\n\nIt has a quieter side too: the Eastbrook Warded Leggings, a caster-statted field common, and the Kilnscale Mantle, a rare Intellect and Spirit mail shoulder at skill 75, keep the spell-minded mail wearers on the customer list. On the ring it sits between Weaponcrafting and Engineering; the Smith pair with Weaponcrafting is sworn before Forgemistress Darva, while the Gearwright pair with Engineering is named but has no oath quest yet.",
        materialsHeading: 'Ore by the sackful',
        materialsBody:
          'No craft eats ore faster. The ironlink hauberk alone takes five iron ore, and every osmiumscale piece wants three or four osmium plus an glyphsteel bar, so a serious armorcrafter mines Mirefen Marsh and Thornpeak Heights or pays someone who does. Copper feeds the first rung, straight from the veins by the Copper Dig.\n\nAround the metal go the soft parts: rough hide harvested off wolf and boar corpses, bone fragments and linen scraps from ordinary hunting, and a jar of Smithing Flux (20 copper at the forge) in nearly every recipe. Darva sells osmium ore over the counter for the impatient.',
        ladderHeading: "Learning at Darva's forge",
        ladderBody:
          "Two field commons, the Eastbrook Chainmail Vest and the Warded Leggings, are known from the start and craft anywhere. The trainer ladder is nine recipes in three rungs at the Eastbrook forge: the copper rung is free at skill 0, the ironlink rung costs 25 silver a recipe at skill 25, and the osmiumscale rung costs 1 gold each at skill 50, with each rung teachable the moment your tier reaches it.\n\nBeyond the ladder sit two specials. The Boundstone Helm is the Smith combination recipe, trainer-taught, station-free, and workable only by an attuned Smith with both crafts at skill 25. The Kilnscale Mantle needs no teacher at all: everyone knows it, but at skill 75 and forge-bound, it is the craft's tier 3 capstone.",
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
          'Leatherworking is the craft where your leveling route and your supply line are the same thing: rough hide is harvested straight off hide-bearing corpses, wolves and boars above all, and each corpse serves one harvester only, first come first served. A rare or better harvest roll also grants a Pristine Hide, a signed specimen the Mirewarden Jerkin calls for, so bank every one you find.\n\nThe supporting cast is small: spider legs and silk, homespun cloth off humanoids, a single osmium ore in each mirewarden rare piece (six in the Duskhide Wraps capstone), and a Tanning Agent at 16 copper from the tannery counter. Tanner Hesk sells osmium ore too, if you would rather not mine.',
        ladderHeading: 'Trained in Fenbridge',
        ladderBody:
          "Here is the wrinkle: the tannery stands in Fenbridge, on the Mirefen Marsh road, making Leatherworking the one deep craft trained outside Eastbrook. Tanner Hesk teaches the ladder at his vats: the Fenbridge hide rung free at skill 0, the marshstalker rung at 25 silver a recipe from skill 25, and the mirewarden rung at 1 gold each from skill 50, each rung opening as your tier reaches it.\n\nTwo recipes skip the trainer: the field commons (the Tanned Leather Jerkin and Druid's Hide) craft anywhere from the start, and the Duskhide Wraps are known to everyone but sit at skill 75, tannery-bound. Note that the Outfitter oath itself is sworn back in Eastbrook with Ottilie; only the teaching happens in the marsh.",
        routeHeading: 'Masterworks, and a working route to 125',
        routeBody:
          "From the marshstalker rung up, every craft rolls the masterwork chance, and the Pristine Hide in a Mirewarden Jerkin provides the signed-reagent bonus automatically; osmium counts as a tier 1 material for the proc. The statless hide commons cannot proc.\n\nLevel it the natural way: harvest every wolf and boar you kill from level one, craft the hide rung to 25 wherever you stand, then train in Fenbridge as the quests pull you into the marsh anyway. Marshstalker carries you to 50 and mirewarden to 75; past that the Duskhide Wraps, a tier 3 recipe at six osmium ore, three Pristine Hide, two rough hide, and a Tanning Agent, pays full gain to 99 and half after, about 75 crafts for the final fifty points to the 125 cap.\n\nThe mobile tannery matters more for this craft than any other: specialize at 75 and a saddlebag of hides becomes finished gear at the campfire instead of a walk back to Fenbridge. Hesk's tannery work order buys eight rough hides every 30 minutes, a tidy return on skins you were collecting regardless, and the Book of Deeds marks Tanner's Trade at skill 50 with Grandmaster Leatherworking at the cap.",
      },
      cooking: {
        identityHeading: 'The pot that feeds the party',
        identityBody:
          "Eat a cooked meal and it heals you over 18 seconds of rest, which between pulls is the cheapest healing in the game. The ladder runs from a 90-health Pan-Seared River Perch all the way to Marlow's Grand Roast at 980, the largest sit-heal that exists.\n\nOn the ring Cooking sits between Alchemy and Leatherworking. Its living pair is the Apothecary, Alchemy and Cooking, sworn before Cook Marlow at the Eastbrook kitchens after hunting four wild boars for the pot; the Trapper pair with Leatherworking is named on the ring but has no oath quest yet.",
        materialsHeading: 'A pantry fed by rod and knife',
        materialsBody:
          "Fishing stocks the signature ingredients, zone by zone: mirror trout and river perch from the waters of Eastbrook Vale, marsh pike and bog eel from Mirefen Marsh, frostgill trout and slatefin carp from Thornpeak Heights. Every rung of the ladder cooks the fish of its tier, so a cook who fishes never runs dry.\n\nThe butcher's side comes off harvested corpses: game meat from boars and their kin, and, on a rare or better harvest roll, a signed Prime Cut, the centerpiece of the grand roast. Herbs season the better dishes, one ashwood log smokes the eel, and Cooking Salt runs 8 copper a pouch from Marlow's own stall.",
        ladderHeading: 'From jerky to the grand roast',
        ladderBody:
          "Salted Jerky is the field recipe: known from the start, one spider leg, craftable anywhere, the trail food of every fresh adventurer. The trainer ladder cooks at the Eastbrook kitchens on the west side of the square: the free rung at skill 0 (the perch, Hunter's Game Skewer, Herbed Marsh Pike), the mid rung at skill 25 for 25 silver a recipe (Ashwood Smoked Eel, Goldleaf Game Stew, Frostgill Chowder), and the rare rung at skill 50 for 1 gold each (Silvered Carp Supper, Angler's Feast Platter, Marlow's Grand Roast).\n\nBatch dishes stretch your ingredients: the smoked eel and the game stew serve two per craft, and the feast platter serves three. Marlow teaches each rung the moment your tier in Cooking reaches it.",
        routeHeading: 'Specialization, not masterworks, and the route to 125',
        routeBody:
          "Cooking is the honest exception to the masterwork story: a meal has no stat line to improve, so dishes never proc one, and no cook should chase it. The craft's mastery is specialization at 75: a fifth less of every ingredient, which compounds fast on batch dishes, and a mobile field kitchen so the feast gets cooked at the dungeon door.\n\nCook what you catch: pair the climb with a fishing session and the two skills feed each other all the way up. Jerky and the free rung carry you to 25 at a point per craft, the mid rung to 50, and the rare rung to 75; past 75 no higher dish ships yet, so the rare dishes fade to half and then quarter gain, roughly 150 more crafts to the cap. Treat it as stocking, not grinding: a guild eats every serving.\n\nMarlow's kitchens work order buys eight game meat every 30 minutes for coin and XP, and the Book of Deeds marks Seasoned Chef at skill 50 on the way to the Grandmaster Cooking title at 125.",
      },
      alchemy: {
        identityHeading: 'Bottles that win fights',
        identityBody:
          'The craft is worked at the apothecary in Highwatch, home of Alchemist Verane, Master of the Apothecary, who teaches the recipe ladder, sells Glass Vials at 12 copper, and pays coin for herbs through her work order.\n\nOn the craft ring, Alchemy sits with the trial-and-error trades, next to Engineering on one side and Cooking on the other. That gives it two pair identities: the Bombardier (Engineering and Alchemy, taken up before Tinker Gizzel in Eastbrook) and the Apothecary (Alchemy and Cooking, sworn before Cook Marlow). Attune to either pair to make Alchemy a major and open the skill all the way to its cap; until then it works to the rare tier like any undeclared craft.',
        materialsHeading: 'Herbs, glands, and glass',
        materialsBody:
          "Every draught wants a Glass Vial plus herbs matched to its rung: sheenleaf grows in Eastbrook Vale, goldleaf in Mirefen Marsh, and sunpetal in Thornpeak Heights, one herb per zone, so your bottles climb the world alongside you. Herbalism is the natural partner skill, though buying from gatherers or the market works just as well; deeper zones hold higher-tier patches that ask for a better sickle, so keep your tool current if you pick your own.\n\nThe elixir line adds a hunter's ingredient: Venom Glands harvested from venomous corpses, and the top elixir asks for a Pristine Venom Gland, the signed rare specimen a lucky corpse harvest turns up. If you do not harvest yourself, those are exactly the goods worth asking a hunter friend to bring back.",
        ladderHeading: 'The recipe ladder',
        ladderBody:
          'Everyone knows the Minor Healing Potion from the start and can mix it anywhere, no station needed. The real ladder is nine recipes taught by Verane at the apothecary, three at each rung: the skill 0 recipes are free, the skill 25 rung costs 25 silver per recipe, and the skill 50 rung costs 1 gold per recipe. Each rung is a healing draught, a mana draught, and a stamina elixir, stepping from common sheenleaf bottles (120 health, 160 mana) through uncommon goldleaf (200 health, 260 mana) to rare sunpetal (280 health, 360 mana).\n\nThe elixirs climb the same way: the Elixir of the Boar grants 6 Stamina for 10 minutes, the Vipersear Elixir 9 for 15 minutes, and the Elixir of the Serpent 12 for 15 minutes, brewing two bottles per craft. One more recipe sits off to the side: the Elixir of the Bear, a combination brew Verane teaches for 25 silver once your Alchemy reaches 25, mixable anywhere, but only by an attuned Bombardier with both Alchemy and Engineering at 25.',
        routeHeading: "A brewer's route to 125",
        routeBody:
          "Draughts and elixirs never roll masterworks; that proc belongs to stat-bearing gear. Your name still travels, though: the rare sunpetal draughts are brewed one bottle at a time and arrive signed with a maker's mark, while the double-batch Elixir of the Serpent stays plain. At skill 75 you specialize, and every Alchemy recipe costs 20 percent fewer materials from then on.\n\nTake Herbalism early and pick as you level: sheenleaf is everywhere in the Vale, and once you reach Verane's bench the free rung will carry you cleanly to skill 25 on herbs you would have picked anyway. Learn the 25 rung the moment it turns on, move your picking to the marsh for goldleaf, and let Verane's work order (six Goldleaf Herbs for 45 copper, repeatable every 30 minutes) hand a little coin back as you go.\n\nFrom 50 on, brew sunpetal draughts and Serpent batches out of Thornpeak herbs. The last stretch from 100 to 125 is a deliberate trickle, so brew what actually sells rather than burning herbs for the number, and remember that consumables are the one crafted good everyone re-buys forever. The Book of Deeds marks Strange Brews at skill 50 and Grandmaster Alchemy at the cap.",
      },
      engineering: {
        identityHeading: "The toolmaker's monopoly",
        identityBody:
          "The craft is worked at the toolworks in the southeast corner of Eastbrook Square, home of Tinker Gizzel, Master of the Toolworks. Tiers 1 through 3 of every tool line are ordinary vendor stock; tiers 4 and 5 exist only through an engineer.\n\nOn the ring it sits with the trial-and-error trades, next to Alchemy and Armorcrafting, giving it two pair identities: the Bombardier (Engineering and Alchemy, taken up before Gizzel himself) and the Gearwright (Armorcrafting and Engineering, named but not yet swearable). One warning matters more here than anywhere else: both of Engineering's recipe rungs sit above the rare-tier ceiling that hobbies and undeclared crafters work under, so the skill number only moves for a crafter whose majors include Engineering, which today means the Bombardier. Anyone can still build the tools; an unattuned crafter just learns nothing from doing it.",
        materialsHeading: 'Reagents and prior tools',
        materialsBody:
          'Every tool recipe consumes the tool one tier below it plus a premium material: four Osmium Ore and a Skysilver Mining Pick become the Osmium Mining Pick, then two Glyphsteel Bars and that osmium pick become the Glyphsteel Mining Pick, and the axe and sickle lines mirror the same shape with Ashwood and Highpine Logs, Goldleaf and Sunpetal Herbs.\n\nGizzel stocks all six premium reagents at the toolworks if you want speed over margin, but the ore, logs, and herbs are all gatherable in Mirefen Marsh and Thornpeak Heights, and gathered stock is where the profit lives. The one exception is the Glyphsteel Bar, which is vendor-only, so every glyphsteel-tier tool carries a fixed coin floor built into its cost.',
        ladderHeading: 'The tool ladder',
        ladderBody:
          "The whole ladder is six recipes, all bound to the toolworks station and all known automatically, no trainer fee ever: the tier 4 pick, axe, and sickle at skill 75, and the tier 5 versions at skill 150. That second number is not a typo, and it sits above the current 125 cap on purpose: skill requirements never gate a craft here, they only shape skill gain, so you can build a tier 5 tool the day you hold its reagents and its tier 4 predecessor.\n\nEvery finished tool is rare or epic quality and comes out signed, so your name rides the zones on other players' toolbelts. Engineering also holds up half of one combination recipe: the Elixir of the Bear, brewed by an attuned Bombardier with both Engineering and Alchemy at 25.",
        routeHeading: "An engineer's route to 125",
        routeBody:
          "Tools carry no combat stats, so they never roll masterworks; that proc belongs to stat-bearing gear. Specialization still lands at skill 75: 20 percent fewer materials per craft, and a temporary field toolworks that turns any gathering trip into a workshop. The gain math barely fades here: the skill 75 recipes pay full gain until 100 and half after, and the skill 150 recipes pay full gain all the way to the 125 cap, so the real constraint is reagents and coin, never gray recipes.\n\nPick your pair first, because nothing moves without it: take the Bombardier attunement from Tinker Gizzel. Then feed the ladder: level Mining, Logging, or Herbalism yourself or befriend gatherers, buy the tier 3 tools from vendors, and treat Gizzel's work order (eight Ironbark Logs for 16 copper, repeatable every 30 minutes) as walking-around money.\n\nEngineering is a low-volume prestige trade, roughly one skill point per finished tool, so treat every craft as stock for sale. The pitch to your customers writes itself: each tool tier above a node's own trims 0.4 seconds off the 2.5 second harvest cast (down to a 1.5 second floor), so a tier 5 tool is a speed upgrade on every node in the world, and only you can make one. The Book of Deeds marks Cogs and Sprockets at skill 50 and Grandmaster Engineering at 125.",
      },
      enchanting: {
        identityHeading: 'Gear apart, power back in',
        identityBody:
          "There is no station, no trainer, and no recipe list to buy: every enchant is known from the start, anyone can disenchant from day one, and the skill caps at 125 like every craft.\n\nOn the ring it sits between Inscription and Jewelcrafting, so its two pair identities are the Arcanist (Inscription and Enchanting) and the Gembinder (Enchanting and Jewelcrafting). Neither can be sworn yet, since both neighbors await their first recipes, so today Enchanting climbs as everyone's craft: free to the rare tier before any oath, and a natural hobby pick for a Bombardier or an Apothecary. Enchanters also keep the gathering world running: the three slottable tool effects are Enchanter work, and an original crafter recharges their own effects at a discount, deeper still once specialized.",
        levelingHeading: 'How enchanting levels',
        levelingBody:
          'Two actions move the skill: disenchanting a piece, and applying an enchant. Each success is worth up to one point, scaled by how serious the work is: the rarity of the piece you break, or the reagent tier of the enchant you apply. Common disenchants and dust-only enchants score as common work; uncommon disenchants and essence enchants as uncommon; rare disenchants and every Runed or Greater enchant as rare; epic and legendary disenchants higher still.\n\nThe familiar mastery fade applies on 25-point tiers, so common-grade work goes gray at skill 75, uncommon work at 100, and rare-tier work exactly at the 125 cap. Enchanting also has one kindness of its own: input above your archetype ceiling is rounded down to that ceiling instead of zeroed, so before you attune, an epic disenchant simply scores as rare rather than teaching nothing. If Enchanting ends up dormant behind another identity, everything scores as common work and the climb stalls at 75; keep it as your hobby and rare-tier work still pays, just slower past 75.',
        marketHeading: 'Enchanted copies, provenance, and the market',
        marketBody:
          "Applying an enchant consumes a bagged, unequipped copy of the item plus the reagents, and hands back a distinct enchanted copy; equip it and the bonus follows the piece forever, through unequips, bank trips, and trades. One enchant per piece: an enchanted copy can never be enchanted again or disenchanted, and selling, discarding, and disenchanting all prefer plain copies first, so your finished piece does not get eaten by accident. Identically enchanted copies even stack together in your bags.\n\nMasterwork gear and enchanting are friends: a masterwork piece stays fully enchantable, and the enchant adds on top of the masterwork bonus without disturbing it or the maker's signature. Stacking every source, a signed masterwork carrying a Greater enchant is the best a crafted piece gets, and it still sits below raid loot by design.\n\nOn the market, the World Market brokers only plain, unmodified stock, so enchanted and signed pieces change hands face to face through the trade window instead. The materials are the marketable half of the craft: Dust, Essence, and Shards list freely, listing costs nothing, and the Merchant takes 5 percent of a completed sale only. That makes the two classic enchanter incomes selling materials on the market, and taking a customer's piece in trade, enchanting it, and handing it back.",
      },
    },
    howHeading: 'How crafting works',
    howBody:
      "Open the crafting window (default key T) and every recipe you know is listed with what it needs and what you have on hand. Station-bound recipes ask you to stand within 20 yards of the right station in town, field recipes craft anywhere, and Enchanting never needs a station at all. There is no failure roll: a craft with the materials in hand always succeeds.\n\nTwo small frictions keep the economy honest. Every successful craft pays a fee of 2 copper per point of the item's stat budget, and craft-type actions share one pace: at most 10 crafts, disenchants, enchants, or salvages in any 60 seconds. Neither will trouble a normal session; both stop a maxed specialist from flooding the market.",
    recipesHeading: 'Recipes',
    recipesNote:
      'Every recipe of the craft: its exact skill requirement and materials, where it is learned and for what fee, and the three skill values where its gain fades to half, a quarter, and nothing.',
    masteryHeading: 'Skill gain',
    masteryBody:
      'Every recipe in the window wears its gain state in the classic colors: orange means full gain, yellow half, green a quarter, gray nothing. The boundaries are exact, every {step} skill is a tier, and a recipe fades one color for each tier it falls below yours.\n\nBecause gains are deterministic (a full-gain craft always moves you exactly one point), you can plan a whole climb from the list: work a rung while it is orange, train the next rung as it turns yellow, and never spend materials on a gray craft expecting progress. At the cap of {cap} the number stops, but the recipes, the masterwork chance, and the profits keep working.',
    masterworkHeading: 'Masterworks',
    masterworkBody:
      'Every successful craft is exactly what the recipe promises, and sometimes a little more: a masterwork finishes the same piece one quality tier finer, with the bonus stats baked in at craft time. It is add-only, never a downgrade, and it stays below the raid floor, so crafted gear can be excellent without replacing a raid drop.\n\nThe chance is published, not mystical: {base}% base, plus {perTier}% per tier your skill sits above the recipe, plus {signed}% when any signed reagent goes in, plus {spec}% once you are specialized, with higher-tier materials adding 1 to 2% more, all capped at {cap}%. Only a piece with real stats can improve, so statless commons, tools, and consumables never proc; a dormant craft never produces one, and a hobby craft cannot masterwork past its rare ceiling.\n\nFine work carries its maker. Rare and better single-copy outputs are signed (Crafted by; gathered materials carry Gathered by), a masterwork is always signed whatever its quality, and identically signed pieces still stack. A signature is provenance, not a lock: signed goods trade freely.',
    trainingHeading: 'Training',
    trainingBody:
      "Trainer recipes come from the resident masters, taught at their stations. The rule is one line: a master teaches a recipe once your tier in the craft has reached the recipe's own tier, and nothing else gates it, not your level, not your archetype. The trainer ladder rungs sit at skill 0, 25, and 50 today, so a fresh rung opens with every tier you climb.\n\nFees are one-time and flat by rung: the starting rung is free, the skill 25 rung costs {tier1} a recipe, and the skill 50 rung costs {tier2}. You must stand at the master's actual station to train, and a mobile station never counts. The common field recipes and the tool recipes need no training at all; every character knows them from the start.",
    specializationHeading: 'Specialization',
    specializationBody:
      'At skill {at} this craft specializes you, no quest needed: recipes cost {pct}% fewer materials from then on, and specialization adds its own bump to the masterwork chance.\n\nSpecialists also learn to take the workshop with them: a specialized crafter can set up a mobile station in the field for ten minutes at a time, so station-bound recipes can be worked at the mine mouth instead of back in town. Its limits are deliberate: it never counts for training with a master or for unbinding a commissioned piece, and it expires on its timer whether or not you used it.',
    ench: {
      disenchantHeading: 'Disenchanting',
      disenchantNote:
        'Disenchanting takes any weapon or armor piece of common quality or better and consumes one copy, never a copy that is already enchanted. Common and uncommon pieces mill down into a rolled handful of Chime Dust, a little richer for rarer and higher-level pieces; from rare up the yield changes shape, exactly one Chime Essence from a rare piece or one Chime Shard from an epic or legendary one, plus a typed secondary keyed to what the piece was made of.',
      typedHeading: 'Typed secondaries',
      typedNote:
        'The typed secondaries follow the material: cloth armor yields Resonant Thread, leather Resonant Hide, mail Resonant Links, melee weapons Resonant Steel, and staves, wands, bows, and crossbows Resonant Timber. A rare piece gives exactly {rare}; an epic or legendary piece gives {epicMin} or {epicMax}. Rings and necklaces have no armor class, so they yield only the primary material.\n\nMind the fine print: the Resonant secondaries bind on trade, so each can change hands exactly once, straight from the breaker to the enchanter who will burn it. Dust, Essence, and Shards carry no such string and move like any other trade good.',
      colSource: 'Broken from',
      meleeWeapons: 'Melee weapons',
      timberWeapons: 'Staves, wands, bows, and crossbows',
      enchantsHeading: 'Enchants',
      enchantsNote:
        'Enchants come in three tiers. The base tier runs on Chime Dust (with a little Essence at the high end) and covers the weapon slot plus every armor slot except the off hand, with enough stat-axis options that every build finds something for each slot. The Greater tier costs one Chime Shard plus Essence and is the only thing Shards are for: stronger bonuses on the highest-impact slots.\n\nBetween them sit the five Runed enchants, one consumer per typed secondary, so nothing you mill is ever a dead end: Runed Edge (weapon, Strength, consumes Resonant Steel), Runed Sigil (weapon, Intellect, Resonant Timber), Runed Weave (chest, Spirit, Resonant Thread), Runed Hide (legs, Agility, Resonant Hide), and Runed Links (helmet, Stamina, Resonant Links). Each also takes two Chime Essence; where a slot and stat have both a base and a Greater enchant, the Runed bonus lands between them, while Runed Weave is the strongest chest Spirit enchant outright and Runed Hide is the only legs Agility enchant at all. The exact bonuses are all in the table below.',
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
    },
    gatherIntro: {
      mining:
        "Mining pulls ore straight out of the world's rock: copper in Eastbrook Vale, iron in Mirefen Marsh, and osmium up in Thornpeak Heights, feeding the forge crafts. Open to everyone from level 1, no gate of any kind, tracked on its own counter to a cap of 100.",
      logging:
        "Logging fells timber from stands of trees in all three zones: ironbark in Eastbrook Vale, ashwood in Mirefen Marsh, and highpine in Thornpeak Heights, the raw stock for hafts, staves, and the engineer's bench. Open to everyone from level 1, tracked on its own counter to a cap of 100.",
      herbalism:
        'Herbalism gathers what grows wild: sheenleaf in Eastbrook Vale, goldleaf in Mirefen Marsh, and sunpetal in Thornpeak Heights, the leaf and stem that keep the apothecary trades brewing. Open to everyone from level 1, tracked on its own counter to a cap of 100.',
      fishing:
        'Fishing is the odd one out among the gathering trades, and the deepest: a real bite-and-reel minigame, its own catch tables in every zone, and a proficiency cap of 200, twice the others. Buy a pole, face open water, and cast.',
    },
    rhythmHeading: 'The gathering rhythm',
    rhythmBody:
      "A harvest is a short visible cast, not an instant grab: {base} seconds base, never below a {floor} second floor. Owning a tool above the node's tier speeds you up by {tool} seconds per tier above it, and each proficiency band you cross trims another {band} seconds; merely matching the node's tier gets you in the door, it is the tiers above it that make you fast.\n\nA full bag politely refuses the cast before it starts, so nothing is wasted mid-swing, and every harvest pays a small slice of character XP, scaled by the node's level against your own the way kill XP scales: a trivial gray node teaches a capped character nothing.",
    gainBody:
      'Gain is deterministic, never a skill-up roll: a node at or above your gain tier teaches a full point per harvest, and every {step} proficiency is one tier scored against the node. Tier 1 nodes pay in full below 25, half to 49, a quarter to 74, and nothing from 75 on; tier 2 nodes pay in full to 49; the one tier 3 node pays in full to 74 and half right up to the cap of {cap}.\n\nThe intended route is plain: learn on the starter nodes of the Vale, move to the marsh, and finish the climb on the high ground of Thornpeak Heights. At the cap the learning stops but the yields do not: a capped gatherer keeps pulling max-quality material forever.',
    nodesHeading: 'Nodes by zone',
    nodesNote:
      'Where the nodes are, their tier, the tool they need, and what they yield. Every node respawns for you {respawn} seconds after your own harvest, and that timer is yours alone: another gatherer working the same node never delays yours, so there is no node racing and no camping. Each zone up the ladder brings a better material out of tougher ground.',
    toolsHeading: 'Tools',
    toolsNote:
      "Bare hands count as a tier 1 tool, so every tier 1 node in the game needs no tool at all. The vendor ladder covers tiers 1 to 3; a tool just has to be in your bags, there is no equip slot and no durability, so each is a one-time purchase. Only the tier matters to the gate: a tool's rarity color is cosmetic.\n\nAbove the vendor ladder sit two crafted tools, tier 4 and tier 5, made at the toolworks by engineers and never sold by any NPC. No node today needs more than tier 3, so their value right now is speed: a top tool pins the cast at its floor on lower nodes, and it will be the entry ticket when higher-tier ground arrives.",
    toolCrafted: 'Crafted ({craft})',
    toolVendor: '{name} ({hub})',
    toolUnavailable: 'Not sold',
    priceNone: 'Not sold',
    toolTierReq: 'Tier {tier} tool',
    bareHands: 'Bare hands',
    yieldsHeading: 'What a harvest yields',
    yieldsBody:
      'Every harvest rolls a quality for what it grants, and your proficiency is the whole story of that roll. A brand new gatherer always pulls common material; every point of skill moves weight steadily out of common into the higher grades and never backward, until at the 100 cap the common grade disappears entirely: 60 percent uncommon, 30 percent rare, 8 percent epic, and 2 percent legendary, every time.\n\nQuality also means quantity: a common roll yields 1 unit, uncommon and rare yield 2, epic 3, and legendary 4. Any rare, epic, or legendary pull arrives as a signed instance stamped Gathered by you: at cap that is four harvests in ten carrying your name, and the provenance rules on the Crafting Economy page explain why crafters pay extra for exactly those stacks.',
    bandsHeading: 'Proficiency bands',
    bandsBody:
      "Proficiency bands are the shared 0/100/200 ladder over a trade's counter: each band you cross shaves the gather cast, and for fishing the bands also select the catch tables (with a rod to match). The land trades cap at 100, so band 1 is their ceiling; only fishing reaches band 2.",
    bandFmt: 'Band {band}: from {at} proficiency',
    rareHeading: 'Rare finds',
    rareBody:
      "Every harvest, whatever your skill, carries a 1 in {oneIn} chance of a rare find: a pristine vein in ore, ancient heartwood in timber, a moonlit bloom among the herbs. The find multiplies that harvest's yield {mult} times over, every unit arrives signed with your name regardless of the quality rolled, and the whole zone hears about it by name. Each flavor also inscribes its own zero-Renown deed in your Book of Deeds, a collector's mark that exists purely to prove it happened to you.",
    specimenBody:
      'Keep a little bag room spare when you farm: a windfall needs open slots to land signed, and if nothing fits the yield still arrives but the signature is lost. Corpse harvesting has its own jackpot arm too: about {pct}% of corpse harvests roll rare or better, signing the yield and, on specimen families, granting a signed perfect specimen.',
    gatherDeedsHeading: 'Deeds along the way',
    gatherDeeds: {
      mining:
        "Your first node of any trade earns Fruits of the Field, and the 100 cap in Mining inscribes Ore in the Blood. Reaching 100 in any three of Mining, Logging, Herbalism, and Fishing adds Master Gatherer at 25 Renown, and cracking a pristine vein records its own collector's mark. None of these grant power: deeds are titles and Renown, a record of the roads you have walked.",
      logging:
        "Your first node of any trade earns Fruits of the Field, and the 100 cap in Logging inscribes Heartwood Hewer. Reaching 100 in any three of Mining, Logging, Herbalism, and Fishing adds Master Gatherer at 25 Renown, and a strike of ancient heartwood records its own collector's mark. Deeds are titles and Renown only, never power.",
      herbalism:
        "Your first node of any trade earns Fruits of the Field, and the 100 cap in Herbalism inscribes Master of the Meadow. Reaching 100 in any three of Mining, Logging, Herbalism, and Fishing adds Master Gatherer at 25 Renown, and a moonlit bloom records its own collector's mark. Deeds are titles and Renown only, never power.",
      fishing:
        "The 100 milestone inscribes Old Salt and 200 inscribes Master Angler with its title, the very top of the angler's art; Fishing also counts toward Master Gatherer, earned at 100 in any three gathering trades. A first fish from each zone's waters fills its own page, and the Sunglint Koi records Glimmer of Hope, so travelers with a pole in their pack fill their book faster than they expect.",
    },
    fish: {
      startHeading: 'Getting started',
      startBody:
        "A Simple Fishing Pole costs 20 copper from Fisherman Brandt in Eastbrook (look for the Old Salt glaring at Mirror Lake from the town's east edge); Tinker Gizzel, Provisioner Hale in Fenbridge, and Quartermaster Bree in Highwatch stock poles too. Use the pole while facing water deep enough to hold fish, up to about 24 yards ahead of you, and your bobber sails out.\n\nYou cannot cast while in combat, while swimming, or while dead: casting from shore is the intended posture, and any fishable water works, in every zone.",
      biteHeading: 'Bite and reel',
      biteBody:
        'After the cast, a bite comes at a hidden moment between {min} and {max} seconds; the delay is decided when the line lands, so no two casts feel quite alike. When the bobber bites you have a {reel} second window to press the pole again and reel in: reel inside it and the catch lands, hesitate past it and the fish gets away with nothing to show. A whole session caps at {cap} seconds, so even a quiet cast resolves quickly.\n\nBetter rods sharpen both ends of the minigame: each rod tier above the first trims {rod} seconds off the longest possible wait and adds {reelRod} seconds to the reel window, so the Ironreel pulls the worst wait down to 6.5 seconds with a 3.75 second window, and the Silverstream to 5 and 4.5. The quickest bites never change whatever you hold, and a rod only needs to be in your bags to count.',
      scheduleHeading: 'Proficiency gain',
      scheduleNote:
        'Fishing gain follows a fixed schedule with no dice: a full point per catch below 50 proficiency, half a point below 100, a tenth below 150, and a slow 0.02 trickle from 150 to 200. That last stretch is a thousands-of-catches journey on purpose: 200 is a statement, not a stop on the way to something else.\n\nJunk stops teaching entirely at {cutoff}: from there on, weeds and boots are just weeds and boots. Every landed catch otherwise gains at the scheduled rate, so fish where you would anyway and let the counter climb.',
      colProficiency: 'Proficiency',
      colGain: 'Gain per catch',
      belowFmt: 'Below {below}',
      tablesHeading: 'Catch tables',
      tablesNote:
        "Your proficiency selects one of three catch bands: band 0 from the start, band 1 at 100, band 2 at 200, each shifting weight out of junk and empty hooks into real fish, zone by zone. Each band above the first also demands a rod: band 1 wants the tier 2 Ironreel, band 2 the tier 3 Silverstream. Your effective band is the lower of what your skill has earned and what your rod supports, and the cap is silent: with a lesser rod you still catch, just off the lower band's table, so if your catches feel stuck while your skill climbs, check your rod first.\n\nEach zone's waters hold their own pair of food fish, healing more the deeper the zone, all of them cooking inputs and perfectly good sit-and-eat food raw off the line. The rest of the table is the angler's tax: weed, the occasional boot, and the empty hook, which never fully disappears. The {rare} is the same long-shot on every line, at flat odds that never change with skill, so the newest angler on the dock has the same shot as a Master Angler.",
      bandHeading: 'Band {band}: proficiency {at} and up, rod tier {rod}',
      colCatch: 'Catch',
      colOdds: 'Odds',
      pctFmt: '{pct}%',
      emptyHook: 'Nothing biting',
      koiHeading: 'The Sunglint Koi',
      koiBody:
        "Every body of water in the game hides the same prize: the Sunglint Koi, an uncommon gleam on the line worth 75 copper to a vendor and rather more to your pride. Its odds are a flat 3 percent per landed catch (4 percent in Thornpeak's cold water) at every band, and landing one records Glimmer of Hope in your Book of Deeds, a zero-Renown collector's mark. When it happens, the log makes sure you know.",
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
        'One flat fee per recipe rung, charged once when a master teaches it; the higher tiers of the table wait for future content.',
      trainingTierFmt: 'Tier {tier}: {fee}',
      free: 'Free',
      sellsHeading: 'What sells, and why',
      sellsBody:
        'The steadiest business is consumables, because they are used up and bought again. Potions, cooked food, and enchants all vanish with use: a fighter who buys a sword once will buy healing potions forever, and every fresh piece of gear is a fresh chance to sell an enchant.\n\nMasterwork pieces are the premium end. They cannot be made to order, so one of a wanted piece commands a real markup, and your signature on it is walking advertising. Reagents are the third pillar: arcane materials from disenchanting, typed Resonant secondaries flowing straight from breaker to enchanter, and signed gathered materials, which crafters chasing masterwork procs pay over the odds for.',
      marketHeading: 'The World Market and its cut',
      marketBody:
        "The World Market is the realm-wide exchange, kept by the Merchant in Eastbrook and Auctioneer Voss in Highwatch. Listing is free: there is no deposit, and an unsold listing simply comes back to you. The house takes its cut only when something actually sells: 5 percent of the sale price, and the rest waits for you to collect.\n\nOne important limit: the Market brokers plain goods only. A signed, masterwork, enchanted, or bound copy is never swept into a listing, so the special pieces change hands face to face in a trade window, which carries an item's full identity, signature and all. Price those yourself; the Market only tells you what the plain version fetches.",
      workOrdersHeading: 'Work orders',
      workOrdersNote:
        "Each station master posts a standing work order: bring a stack of their craft's staple material and get paid on the spot, plus a little quest experience. The pay is deliberately {pct}% of what a vendor would give you for the same stack, rounded down, so a work order is never the profitable way to sell materials, just a reason to swing by the station.\n\nEvery order runs on its own {minutes} minute clock per character: turn one in and that master has nothing more for you until the timer laps. Treat them as a small bonus on materials you were gathering anyway, not a business.",
      colOrder: 'Work order',
      colMaster: 'Master',
      colAsks: 'Asks for',
      colPays: 'Pays',
      commissionsHeading: "Commissions and the Maker's Bond",
      commissionsBody:
        "A commission is a craft made for someone. When crafting a weapon, armor piece, or held off-hand (a potion cannot carry a bond), the crafter can flag the craft as a commission: the finished piece behaves normally in the maker's own hands, but the moment it changes hands in a trade it binds to the person who received it. That is the Maker's Bond: the buyer gets their piece, and the piece cannot be passed on or resold.\n\nBonds are not forever, just expensive. Any station master will unbind a bound piece while you stand at their station (a mobile station never offers the service), for a fee set by the item's quality: 25 silver uncommon, 1 gold rare, 4 gold epic, with a legendary paying the epic rate and a commissioned common piece the uncommon one.\n\nThe fee buys a clean slate, not a cure: the piece is still a commission, so it binds again to whoever receives it in the next trade, and everything else about it, signature, masterwork, and enchants, survives untouched.",
      provenanceHeading: 'Signed work',
      provenanceBody:
        "Some items carry a name. Hover one and the tooltip says Gathered by so-and-so on a raw material, or Crafted by so-and-so on a finished piece: the same mark, worded for how the item came to be. A signature is part of the item itself, travels with it through trades and the bank, and never fades.\n\nGathering signs its best work automatically: any harvest that rolls rare or better arrives signed, rare finds sign their entire five-fold windfall, and a corpse harvest's lucky roll signs its yield, pristine specimens included. Crafting signs along the same line: a single-copy output of rare or better quality mints signed, and a masterwork always signs whatever its quality, so the finest version of any piece always names its maker. The one thing that can cost you a signature is a full bag: a signed unit needs room of its own, or a matching signed stack, to land in.\n\nA stack of items shares one identity, so two copies merge only when every mark matches exactly: same item, same signer, same masterwork stats, same enchant, same bond. A signed log never joins a plain pile in either direction (merging would erase somebody's name), but identical payloads merge happily, so twenty ore signed by the same gatherer sit in one stack and a windfall does not shred your bags.\n\nSignatures pay crafters back: consuming any signed reagent, whoever signed it, adds 2 percentage points of masterwork chance, and holding a reagent signed by your own hand cuts that reagent's required quantity by one (never below one). Your own signed rare-or-better work even keeps teaching you: when a piece you signed performs in your own hands, a potion drunk at the right moment, a killing blow landed, armor worn at a kill, a small trickle of skill flows back to the craft that made it, as long as that craft is one of your active majors.",
      collectorsHeading: 'Collectors, trophies, and the price of a story',
      collectorsBody:
        "Vendors are blind to provenance: a signed item sells to an NPC for exactly its plain price. The premium on a signature exists only between players, which is precisely what makes it interesting: a stack of windfall ore signed by a famous gatherer, a Prime Cut from a lucky harvest, a masterwork blade naming a crafter who has since retired, all cost whatever someone's memory says they are worth.\n\nThe Book of Deeds leans into the same instinct: Pristine Vein, Ancient Heartwood, Moonlit Bloom, A Perfect Specimen, and Glimmer of Hope are zero-Renown collector's marks that exist purely to prove a moment happened to you. Keep the item that earned the deed and you hold the receipt. None of this is power; provenance buys no stats and wins no fights, it is the game's paper trail of good days.",
      throttleHeading: 'The action throttle',
      throttleBody:
        'Output has a ceiling: crafting, disenchanting, enchanting, and salvaging share one budget of {actions} successful actions per rolling {seconds} seconds. A denied attempt costs nothing and spends no budget. You will never feel it in normal play; it exists so a maxed specialist with a full bank cannot flood the Market, whatever their skill or stockpile.',
      doctrineHeading: 'Players trade with players',
      doctrineBody:
        'The crafting economy is built on one idea: players supply players. Gatherers feed crafters, crafters feed questers and raiders, and breakers feed enchanters, with vendors and station masters standing at the edges to absorb junk and coin rather than to compete with you. If you want to make money from a profession, your customer is a person: learn what other players burn through, price against the World Market, and treat the NPC systems as a floor under your prices, not as the market itself.\n\nCrafted gear is tuned to sit below the raid floor: even a masterwork is only ever one quality tier above its recipe, never past legendary, and its stat budget stays under the raid loot band. The forge gets you ready for the hardest content; it does not replace it. That keeps crafters, raiders, and the market in a stable triangle: raid drops stay aspirational, and crafted pieces stay the best gear money can actually buy.',
    },
    faq: {
      title: 'Professions FAQ',
      intro: 'Quick answers to the questions crafters ask most.',
      q1: 'Why do my signed items not stack?',
      a1: 'A signed item is an instanced item: it carries its own little record (the signer, any rolled quality, masterwork stats, an enchant, a bond) instead of being an anonymous copy. Two copies merge into one stack only when those records match exactly.\n\nIn practice: rare ore you gathered yourself stacks with more rare ore you gathered yourself, because both say Gathered by you and nothing else differs. The same material signed by a friend sits in its own slot, and a plain unsigned copy never merges into a signed stack. Bags, bank, and trade all follow this one rule.',
      q2: 'Do common recipes raise my skill forever?',
      a2: 'No. Every recipe is scored by how far it sits below your current bracket in that craft, the classic orange, yellow, green, gray reading: full gain at or above your bracket, half one tier below, a quarter two tiers below, and nothing three or more below. Brackets are every 25 skill, so the free skill 0 recipes stop teaching you anything at 75 skill.\n\nThe caps are also lower than the classic 300 you might expect: each of the eight earnable crafts caps at 125, Mining, Logging, and Herbalism cap at 100, and Fishing runs long at 200. Climbing means moving up to recipes at your own bracket, not grinding the cheapest one.',
      q3: 'What is the difference between looting and harvesting a corpse?',
      a3: 'One press covers both. Everything a corpse holds, coin and drops plus any harvestable components, opens in the same window: loot follows the normal loot rules, and harvesting is the professions side, stripping materials off the carcass itself.\n\nHarvesting is first come, single use: each corpse can be harvested exactly once, by whoever claims it first, online included. Your Town Focus shapes what you get: while standing in a town hub you can spread 10 focus points across the component types you care about, and each focused component rolls a better tier (every 5 points bumps it a step, at most two steps) and yields more (10 percent per point). Unfocused components are never made worse.',
      q4: 'Why is my Ironbark Log signed?',
      a4: 'You hit a windfall. Roughly 1 harvest in 90 triggers a rare gather event (ancient heartwood on a tree, a pristine vein on ore, a moonlit bloom on herbs): it multiplies the yield five times, signs every unit with your name, and announces the find to the whole zone. A rare or better rarity roll on an ordinary harvest signs the yield too.\n\nSigned materials are worth keeping or selling dear: consuming any signed reagent in a craft adds 2 percent to the masterwork chance. Just remember they only stack with identically signed copies, so they keep their own bag slot.',
      q5: 'How do I unbind a commissioned piece, and what does it cost?',
      a5: "Walk to any crafting station with the piece in your bags and pay the master. The fee follows the item's quality: 25 silver for an uncommon piece, 1 gold for a rare, 4 gold for an epic; a legendary pays the epic rate, and a commissioned common piece pays the uncommon rate. It must be a real station: a mobile station never offers the service.\n\nThe fee buys a clean slate, not a cure: the piece remains a commission, so it binds again to whoever receives it in the next trade. If several bound copies share a stack, one copy is peeled off and unbound per payment.",
      q6: 'Where do I learn recipes, and what do they cost?',
      a6: "The nine common field recipes and the tool recipes are known to everyone from the start, and so are three station-bound capstones (the Kilnscale Mantle, the Wardweave Cowl, and the Duskhide Wraps), which need no trainer, only their station. Everything else is taught by the resident masters at their stations across the three hub towns: most stand in Eastbrook, the tanner keeps the tannery in Fenbridge, and the alchemist keeps the apothecary in Highwatch.\n\nTrainer recipes come in rungs at skill 0, 25, and 50, priced free, 25 silver, and 1 gold as a one-time fee. A master teaches a recipe once your bracket in that craft has reached the recipe's own bracket, and you must be standing at their station to learn: a mobile station does not count.",
      q7: 'Why did my gathering suddenly slow down?',
      a7: "The gather cast starts at 2.5 seconds and is shaved down two ways: 0.4 seconds for every tool tier you own above the node's own tier, and 0.15 seconds for each proficiency band you have crossed (at 100 and 200), with a floor of 1.5 seconds. Move from tier 1 nodes up to tier 3 nodes and your surplus vanishes, so the same pick swings slower again. Owning exactly the required tier buys no speed; it only opens the node.\n\nSkill gain fades the same way crafting does: a node grays out as your proficiency climbs past its tier (tier 1 nodes teach nothing from proficiency 75 on), so the answer to slow gains is higher tier nodes, which need a tool of at least their tier (bare hands count as tier 1). Fishing follows its own taper: full gain below 50 proficiency, half below 100, a trickle of 0.1 below 150 and 0.02 below 200, and junk catches teach nothing at all from 100 on.",
      q8: 'Can I craft away from town?',
      a8: "Partly. The nine common field recipes (the starter weapon, armor, food, and potion staples) craft anywhere, any time. Everything above them is bound to a station type: forge, kitchens, apothecary, tannery, loom, or toolworks, and you must be within 20 yards of the station for the craft to go through.\n\nAt 75 skill in a craft you specialize, and along with a 20 percent material discount you gain a mobile station: place it in the field and it stands for 10 minutes, serving that craft's recipes as if you were at the real thing. The mobile station is for crafting only: learning recipes and unbinding commissions always require the true station in town.",
    },
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
    marksTitle: 'Marks: the currencies beyond coin',
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
      'Speak to a merchant and choose to browse their goods, and their shop opens with three tabs: Browse, Sell, and Buyback. Browse holds everything they stock, yours if you can afford it. Sell lists what in your bags they will pay for, and selling a piece that carries its own rolled quality asks you to confirm first, so a prized copy never slips away by mistake. If you part with something you regret, the Buyback tab holds your recent sales so you can buy them back for the coin you were paid.',

    // Offloading junk.
    junkTitle: 'Clearing out junk',
    junkBody:
      'Drops you have no use for still sell to any vendor, so empty your bags whenever you pass through town rather than letting them fill up. The vendor Sell tab even keeps a one-click button that sells every Poor-quality oddment at once. Truly worthless odds and ends can also be discarded outright to make room.',

    // Direct player-to-player trading.
    tradeTitle: 'Trading with other players',
    tradeBody:
      'You can trade face to face with anyone standing near you. Both of you put items and coin into a shared window and the swap only happens once you both confirm it, so neither side can be caught out. It is the simple way to hand a friend a drop or settle a deal.',

    // The Ravenpost player mail. No postage amounts, delays, caps, or expiry durations.
    mailTitle: 'The Ravenpost',
    mailBody:
      'Every hub town keeps a carved raven pillar: a mailbox of the Ravenpost, the letter service of the realm. Stand at one to write to any character by name, a friend online or long offline, and attach coin or goods to the letter for a small postage. The raven takes a short while to fly; when it lands, an envelope indicator tells the recipient something is waiting.',
    mailHow:
      'Collecting works the same in reverse: stand at any pillar to read your letters and take what they carry into your purse and bags. A plain letter fades away after a while, but one still carrying coin or goods waits for you, however long you take. Some things the post refuses outright: soulbound items, quest goods, and one-of-a-kind cosmetic tokens travel with you or not at all. And keep an eye on the pillar after a good turn-in; some questgivers write.',

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
      'Posting: choose a stack from your bags, set your price, and list it. The goods are held by the Merchant until someone buys them. Unsold listings come back to you after a while, and you can reclaim one early if you change your mind.',
    marketCollect:
      'Collecting: when your goods sell, your proceeds wait for you at the Merchant. Return to collect the coin, along with anything that came back unsold. The Merchant takes a small cut of every completed sale.',
    marketPricing:
      'Pricing is up to you. Listing a little under what others are asking tends to sell faster, while a steep price may sit untouched. Browse first to see what the going rate looks like before you post.',
  },

  // Social and Groups: chat channels, parties, party loot, friends, ignore, guilds.
  social: {
    intro:
      'Most of the world is soloable, but the game is built to be played with other people. Here is how to talk, team up, and find your crowd.',

    // Chat channels.
    chatHeading: 'Chat channels',
    chatBody:
      'Chat is split into channels, each shown on its own tab. Type a message to send it on the active channel, or use a slash command to direct one line elsewhere. These are the channels you can talk on:',
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
    friendsHeading: 'Friends and ignore',
    friendsBody:
      'Add players to your friends list to see when they are online and where they are, so you can group up the moment they log in.',
    ignoreBody:
      'If someone is bothering you, add them to your ignore list and you will stop seeing their chat.',

    // Guilds.
    guildHeading: 'Guilds',
    guildBody:
      'A guild is a lasting group of players you belong to between sessions. Create one or accept an invite to join, and you can be in one guild at a time. Members hold a rank: a leader, officers, and members.',
    guildChatBody:
      'Belonging to a guild gives you a private guild chat channel and shows your guildmates on a shared roster, so there are always familiar faces online.',

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
      'Press I to open the event calendar. It marks the realm days worth planning around, from the weekly raid call to fiesta night, and it is where guilds keep their schedule: the guild leader and officers can book events on it, and every member sees them on the same page.',

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
      'Grouping is a choice, not a chore. Say hello when you join, roll Need only on gear you will actually use, and let the group know before you head off. A little courtesy goes a long way, and most players are glad of the company. Moderators keep the peace, and a player who will not let others enjoy the game can be moved to a jail cell until a moderator lets them out.',
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
      "Spirit governs how quickly a caster's mana returns whenever they pause their casting, which is most of the time between fights. Like Intellect, it serves the mana classes and means little to the others.",

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
  },

  // Leveling and Progression. How experience is earned, the journey across the three
  // zones, rested XP, and what waits at the cap. Number-free and spoiler-safe.
  progression: {
    intro:
      'Every fight, quest, and step north makes your hero stronger. Here is how leveling works and what keeps you growing once you reach the top.',
    // How experience is earned, and the cap. {cap} = level cap.
    xpTitle: 'How you gain experience',
    xpBody:
      'You earn experience by completing quests, by defeating enemies, and by clearing delves. Quests give the most by far, so following the quest trail is the fastest way to climb. Kills and delve runs along the way fill in the rest.',
    capBody:
      'Each level makes you tougher and brings new abilities, all the way to the cap of level {cap}.',
    // The leveling journey across the three zones, south to north.
    journeyTitle: 'The journey north',
    journeyBody:
      'The world is one continuous land, three zones laid south to north, each a step higher in level. You start in the green valley, press on through the marsh, and finish in the cold high peaks. Follow the quest trail and the land carries you from one to the next.',
    bandLabel: 'Levels {min} to {max}',
    // Rested XP, described without numbers.
    restedTitle: 'Rested experience',
    restedBody:
      'Step inside an inn and stay out of combat, and your character builds up rested experience while you wait. Every town has one. The next time you go out and fight, that pool gives your kills an extra boost until it runs dry. A pause at the inn is never wasted time; it speeds your next stretch of leveling.',
    // What happens at the cap: cosmetic, optional, long-term. {cap} = level cap.
    capTitle: 'Reaching level {cap}',
    capJourneyBody:
      'Level {cap} is the cap, the end of leveling but not of growing. From there you run dungeons and the raid on normal and heroic, face the world boss when he rises, chase better gear, and test yourself in the arena.',
    prestigeBody:
      'Experience keeps counting even after the cap. It feeds a cosmetic virtual level, so your experience bar keeps climbing, and a long-term prestige rank you can claim from your character sheet once you are there. Passing big lifetime-experience milestones also earns deeds in your Book of Deeds, with cosmetic titles and nameplate borders that show on your character sheet. All of it is purely optional and never grants power, just a mark of the road you have walked.',
    // Gentle reassurance.
    noRush:
      'There is no rush. The world is there to enjoy at your own pace, so wander, take the quests that catch your eye, and let your hero grow along the way.',
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
