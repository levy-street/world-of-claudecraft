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
      'Curious how a fight went? Press Z to open the party meters, which tally damage, healing, and threat for your group, encounter by encounter.',
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
      'The party scoreboard window for the current fight: damage dealt, healing done, and who holds the most threat, kept per encounter. Open it with its keybind (Z by default).',
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
    battle_shout: 'A rallying cry that raises attack power for the party.',
    commanding_shout: 'Bolsters stamina so everyone has more staying power in a fight.',
    charge: 'Rushes a distant enemy to open the fight with a brief stun.',
    rend: 'Opens a bleed that wears the target down over time.',
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
    frost_armor: 'A lasting self-buff that hardens your armor before a fight.',
    arcane_intellect: "Raises Intellect to deepen an ally's mana pool, cast it before the pull.",
    frostbolt: 'Strikes from range and slows the target so it cannot close on you.',
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
      'Renown is the score behind the Book. Every deed you earn is worth a set amount, and your total only ever climbs, so a quiet week never costs you ground. A handful of deeds turn on luck rather than skill, and Feats are an honor of their own, so both of those are worth no Renown at all.',
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
      'The realms keep a running tally of Renown across every account. To see who stands where, open the Leaderboard in game and turn to its Renown tab; the standings live there, not on the wiki.',
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
      'If you want a quick way to compare two pieces, turn on Show Item Level in the options. Gear won out in the world, from enemies and quests, then shows an item level, a single figure for roughly how powerful it is based on where it came from, so you can tell at a glance which upgrade pulls more weight, even across different slots. Pieces with no such source, like plain vendor basics and starter gear, show no item level, so a missing figure is normal, not a fault.',

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

    // Gathering professions overview.
    gatherTitle: 'Gathering: Mining, Logging, and Herbalism',
    gatherIntro:
      'Three gathering trades let you pull raw materials straight out of the world: Mining strikes ore and stone from veins, Logging fells timber from stands of trees, and Herbalism collects herbs and plants growing wild. Each is tracked separately, so working one never slows your progress in another. New to it all? Foreman Odell in Eastbrook keeps a short errand, A Trade for Every Hand, that walks you through your first harvest.',

    gatherWhatTitle: 'Resource nodes',
    gatherWhatBody:
      'Ore veins, wood stands, and herb patches are placed out in the Vale and the marsh as visible, unowned fixtures. Walk up to one and interact with it to harvest whatever it holds. Once you have harvested a node, it needs time to recover before you personally can harvest it again, though it never blocks anyone else: another player can harvest the very same node in the meantime.',

    gatherProficiencyTitle: 'Proficiency',
    gatherProficiencyBody:
      'Every successful harvest builds your proficiency in that gathering trade, and your character sheet tracks each trade on its own. More practice never hurts your progress, it only ever adds to it.',

    gatherToolsTitle: 'Tools of the trade',
    gatherToolsBody:
      'Vendors sell basic tools for each gathering trade, and better ones can be crafted. No tool is required to work a node today: tools are groundwork for richer nodes to come, where higher-tier picks, axes, and sickles will be the way in.',

    // Corpse component harvesting: open to every character, no profession gate.
    harvestTitle: 'Harvesting the hunt itself',
    harvestBody:
      'Gathering does not stop at nodes. Some slain beasts can be harvested for components, hides, fangs, silk, and stranger things, straight from the corpse alongside its ordinary loot. One hunter per kill: whoever harvests first claims it all. The choice is yours each time, too: strip everything the corpse offers, or concentrate on a single component and take a finer grade of it. Any character can harvest, no trade or training required, and a particularly fine component even carries the name of whoever harvested it.',
    focusTitle: 'Town Focus',
    focusBody:
      'Every hub town keeps a Town Focus panel for visiting harvesters: stand in town, open it from beside the minimap, and aim a small budget of focus points at the component types you care about. The more focus you give a component, the finer and richer it comes off every later corpse; your allocation follows your character wherever they roam, and you can rework it, free, on any later visit to town.',

    // The ten crafts overview.
    craftTitle: 'The ten crafts',
    craftIntro:
      "Ten crafting trades turn gathered materials into finished gear and goods: Armorcrafting, Weaponcrafting, and Jewelcrafting shape raw matter into wearable gear; Alchemy and Engineering are driven by trial and error; Cooking, Inscription, and Enchanting each touch other crafts' output; Tailoring and Leatherworking work from exact patterns. Together they form a wheel, with each craft sitting next to two neighbors and opposite one other.",

    craftRingTitle: 'A wheel of specialties',
    craftRingBody:
      'The ten crafts are arranged in a fixed ring, and where a craft sits on that ring matters: crafts next to each other on the wheel share more in common with each other than crafts on opposite sides do. Committing to one craft is meant to feel like joining a family of related trades, not picking an isolated skill.',

    craftRecipesTitle: 'Recipes and reagents',
    craftRecipesBody:
      'Every recipe calls for specific reagents you gather or buy. The simplest recipes ask for nothing but common materials and are craftable from the very start, so you can begin working a trade the moment you pick it up. The recipe lists are still filling in: a few trades are waiting on their first recipes, and more arrive as the crafts grow.',

    craftHowTitle: 'The crafting window',
    craftHowBody:
      'Open the Crafting window (default key T) to see every recipe you know, what each one needs, and what you have on hand; when the materials are there, one click does the work. Common recipes can be crafted anywhere in the world. A handful of advanced tool recipes instead ask you to stand at the crafting hub in Highwatch.',

    craftMasteryTitle: 'Skill and mastery',
    craftMasteryBody:
      "Crafting successfully builds skill in that trade, and skill never locks a craft's recipes away: if you know a recipe and hold its materials, you can attempt it. What skill buys you instead is quality, a practiced hand turns out finer work. The one exception is combination recipes, which ask you to have proven yourself in both of their crafts before they open up.",

    craftComboTitle: 'Combination recipes',
    craftComboBody:
      "Beyond a single craft's own recipe list, the wheel also supports combination recipes that call on two neighboring crafts at once, rewarding a character who has invested in adjacent trades on the ring rather than one in isolation. The crafter must hold both trades themselves; a partner's skill cannot stand in for either half.",

    // Archetypes overview.
    archetypeTitle: 'The ten archetypes',
    archetypeIntro:
      'Each of the ten crafts also stands for an archetype, a broader identity you can adopt beyond just working that trade. Your active archetype is a single choice at a time, not a checklist: you carry one, and can change which one later if you choose to.',

    archetypeChooseTitle: 'Choosing your archetype',
    archetypeChooseBody:
      'Declaring an archetype will be a story moment: a quest that formally accepts you into that identity. That road is still being built, so for now every character walks the world with the choice ahead of them, and every craft advances to the rare quality tier in the meantime.',

    archetypeSwitchTitle: 'Changing your mind',
    archetypeSwitchBody:
      'Nor will a declaration be a life sentence. The plan is a repeatable act of making amends to your old trade before taking up a new one, with the amends growing steeper each time you switch, so the choice stays meaningful rather than costless. Like the declaration itself, it is still on its way.',

    archetypeIdentityTitle: 'What your archetype means',
    archetypeIdentityBody:
      'Your active archetype is a statement about who your character is in the world, recognized in how others and the world address you. The exact rewards and recognition that come with it are still being finalized; check back as the system fills in.',
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
