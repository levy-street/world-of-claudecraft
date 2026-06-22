// i18n source catalog - the public Guide (docs/wiki) surface at /guide. A curated,
// branded front-of-house that explains the game, teaches the basics, and showcases
// classes, the bestiary, quests, and group content, separate from the community
// MediaWiki at /wiki. English values only; the 13 locale translations live in
// src/ui/i18n.locales/<lang>.ts (the runtime-authoritative overlays), filled by the
// maintainer at release.
//
// Assembled into `en` by ./index.ts under the `guide` namespace. Like hud_chrome.ts
// this module carries NO per-locale blocks (no `as const`), so a new Guide string is
// an English-only add that compiles; the translations live solely in the overlays.

export const guideStrings = {
  // Brand + shared chrome.
  brand: "World of ClaudeCraft",
  brandShort: "ClaudeCraft",
  tagline: "A classic-style MMO you play free in your browser.",
  skipToContent: "Skip to main content",
  loading: "Loading...",
  // Browser tab title: "{page} - {brand}". Hyphen separator (not an en dash).
  docTitle: "{page} - {brand}",
  // Label for the cross-link block at the foot of a page.
  related: "Related",

  // Top navigation + sidebar controls.
  nav: {
    overview: "Overview",
    howToPlay: "How to Play",
    classes: "Classes",
    bestiary: "Bestiary",
    models: "3D Models",
    gear: "Gear & Items",
    economy: "Economy & Trade",
    social: "Social & Groups",
    stats: "Character & Stats",
    progression: "Leveling & Progression",
    world: "World",
    quests: "Quests",
    dungeons: "Dungeons & Raids",
    reference: "Reference",
    controls: "Controls",
    combat: "Combat",
    talents: "Talents",
    arena: "Arena & PvP",
    glossary: "Glossary",
    wishIKnew: "Things I Wish I Knew",
    faq: "FAQ",
    playNow: "Play Now",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    primary: "Guide sections",
    topics: "Topics",
    onThisPage: "On this page",
    backToGame: "Back to the game",
  },

  // Sidebar section groupings.
  groups: {
    start: "Get Started",
    compendium: "Compendium",
    reference: "Reference",
  },

  // Breadcrumb trail, previous/next page sequence, and the on-this-page contents.
  breadcrumb: {
    label: "Breadcrumb",
    home: "Guide",
  },
  seq: {
    label: "Page navigation",
    prev: "Previous",
    next: "Next",
  },
  toc: {
    heading: "On this page",
  },

  // Footer.
  footer: {
    blurb: "An open-source, classic-style micro-MMO. Quest, group up, and explore a hand-built world, right in your browser.",
    playNow: "Play Now",
    github: "Source on GitHub",
    discord: "Join the Discord",
    communityWiki: "Community Wiki",
    rights: "World of ClaudeCraft",
  },

  // Language picker.
  language: {
    label: "Language",
    select: "Choose a language",
  },

  // Site search (header combobox).
  search: {
    label: "Search",
    placeholder: "Search the guide",
    noResults: "No matches",
    typePage: "Page",
    typeClass: "Class",
    typeZone: "Zone",
    typeCreature: "Creatures",
    typeDungeon: "Dungeon",
    typeTerm: "Term",
  },

  // Home / overview landing.
  home: {
    eyebrow: "Classic-style browser MMO",
    title: "World of ClaudeCraft",
    subtitle: "Quest, group up, and explore a hand-built world, free in your browser.",
    ctaPlay: "Play Now",
    ctaLearn: "How to Play",

    // "What is it" benefit trio.
    what: {
      heading: "A classic MMO, made to be picked up",
      pillarPlayTitle: "Play in your browser",
      pillarPlayBody: "No download, no launcher. Make a character and you are in the world in seconds, on desktop or phone.",
      pillarClassesTitle: "Nine classes, three roles",
      pillarClassesBody: "Tank, heal, or deal the damage. Every class plays the way its archetype should, with talents to make it yours.",
      pillarOpenTitle: "Free and open source",
      pillarOpenBody: "Free to play to the level cap, with the whole game open source. No pay to win, ever.",
    },

    // Class chooser teaser.
    classes: {
      heading: "Choose your class",
      sub: "Nine classic archetypes, each with its own feel and party role.",
      cta: "Explore the classes",
    },

    // World teaser.
    world: {
      heading: "Explore the world",
      sub: "One continuous land, three zones, from quiet valleys to frozen peaks.",
      levels: "Levels {min} to {max}",
      cta: "See the world",
      valeName: "Eastbrook Vale",
      valeBlurb: "Green hills and old woods where every adventure begins.",
      marshName: "Mirefen Marsh",
      marshBlurb: "Sunken fens and tide-worn ruins, home to murlocs and worse.",
      peaksName: "Thornpeak Heights",
      peaksBlurb: "Wind-scoured ridges climbing toward the realm's coldest dangers.",
    },

    // Group content teaser.
    group: {
      heading: "Group up for the hard parts",
      sub: "The world is soloable, but the best loot waits behind a good party.",
      dungeonsTitle: "Dungeons",
      dungeonsBody: "Instanced dives for a party of five, scaling with the zones around them.",
      raidTitle: "The raid",
      raidBody: "A ten-player capstone for those who reach the top of the world.",
      arenaTitle: "The arena",
      arenaBody: "Step into the Ashen Coliseum and prove yourself against other players.",
      cta: "Dungeons and Raids",
    },

    // Short FAQ.
    faq: {
      heading: "Good to know",
      q1: "Is it free to play?",
      a1: "Yes. The whole game is free to the level cap, and it is open source on GitHub.",
      q2: "Do I need a crypto wallet?",
      a2: "No. The game is fully playable without one. The optional community token only unlocks cosmetic flair and never affects power.",
      q3: "Can I play offline?",
      a3: "Yes. There is an instant single-player mode in your browser, plus the shared online realm.",
      q4: "How long to reach max level?",
      a4: "The cap is level {cap}, reached across three zones of quests, dungeons, and exploration.",
    },

    // Community call to action.
    community: {
      heading: "Join the realm",
      body: "Jump in now, or come say hello. The world is better with company.",
      play: "Play Now",
      discord: "Join the Discord",
      github: "Star on GitHub",
    },
  },

  // How to Play / Basics (the newcomer tutorial page).
  howToPlay: {
    intro: "New to this kind of game? You will be questing in minutes. Here is the short version, one step at a time.",
    firstHeading: "Your first 15 minutes",
    step1Title: "Make a character",
    step1Body: "Pick a class and a look, give your hero a name, and enter the world. You can make more characters later.",
    step2Title: "Find your first quest",
    step2Body: "Marshal Redbrook is waiting in the starting town. Talk to him and accept Wolves at the Door.",
    step3Title: "Move and look around",
    step3Body: "Move with W, A, S, D. Hold the right mouse button and drag to look around. That is most of it.",
    step4Title: "Fight something",
    step4Body: "Press Tab to target the nearest enemy, then press your abilities on the bar (keys 1 through 0) to attack.",
    step5Title: "Turn it in",
    step5Body: "Finish the objective, return to the quest giver (look for the marker on your map), and collect your reward.",
    step6Title: "Keep going",
    step6Body: "You just hit level 2. Follow the quest trail out of town and the world opens up from there.",
    basicsHeading: "The basics",
    resourcesTitle: "Resources",
    resourcesBody: "Spells and abilities cost a resource. Warriors build Rage by fighting, rogues spend Energy that refills on its own, and everyone else casts from a pool of Mana.",
    targetingTitle: "Targeting and your bar",
    targetingBody: "Tab cycles enemies, F interacts and loots, and your action bar holds the abilities you have learned. Drag spells onto it from your spellbook.",
    questsTitle: "Quests",
    questsBody: "Accept quests from people with a marker over their head, complete the objective, and turn them in for experience, coin, and gear. The tracker on screen keeps your goals in view.",
    deathTitle: "Death is not the end",
    deathBody: "If you fall, you release your spirit at the nearest graveyard and run back to your body. No experience is lost.",
    groupingTitle: "Playing together",
    groupingBody: "Invite others to a party to share quest credit and take on dungeons. Most of the world is soloable, so grouping is a choice, not a chore.",
    onlineTitle: "Online or offline",
    onlineBody: "Play the shared online realm with everyone else, or start an instant offline world in your browser to learn the ropes.",
    reassure: "Talents unlock at level 10 and can be reset at any time, so your early choices are never permanent. Experiment freely.",
    controlsLink: "See the full controls reference",
  },

  // Controls reference (most action labels reuse the shared controls.* catalog).
  controls: {
    intro: "Default keys for desktop. Every binding can be changed in the game's options.",
    keyHeader: "Key",
    actionHeader: "Action",
    groupMovement: "Movement",
    groupCombat: "Targeting and combat",
    groupInterface: "Windows",
    groupCamera: "Camera",
    talents: "Talents",
    arena: "Arena",
    leaderboard: "Leaderboard",
    abilities: "Use abilities",
    mobileHeading: "On mobile",
    mobileBody: "Touch controls appear automatically on phones and tablets: a movement stick on the left, drag anywhere on the right to look, and on-screen buttons for your abilities and menus.",
  },

  // Combat overview. Deliberately high level: concepts, not formulas or numbers, so
  // there is nothing here to min-max or exploit.
  combat: {
    intro: "Combat follows familiar classic-MMO rules. You never need to study any of it to play well, this is just the shape of how fights work.",
    hitTitle: "Not every blow lands",
    hitBody: "Attacks can miss or be dodged, parried, and blocked, and so can the enemy's. Fighting near your own level and keeping your gear current is what makes your hits connect.",
    mitigationTitle: "Armor and gear keep you standing",
    mitigationBody: "Armor softens physical hits and the right gear blunts magic, so upgrades are your main source of staying power. Heavier armor classes shrug off more, but nothing makes you untouchable.",
    resourcesTitle: "Every class has its own rhythm",
    resourcesBody: "Warriors build Rage in the thick of a fight, rogues spend Energy that steadily returns, and casters manage a pool of Mana. Learning your resource is half of playing your class well.",
    growTitle: "You grow stronger every level",
    growBody: "Each level makes you tougher and unlocks new abilities, all the way to the cap of level {cap}. Questing is the fastest way up; dungeons and exploration round it out.",
    // Status effects: buffs, debuffs, damage over time, crowd control with diminishing returns.
    effectsTitle: "Buffs, debuffs, and crowd control",
    effectsBody: "Many abilities apply an effect that lingers. Helpful ones (buffs) raise your stats, shield you, or heal you a little at a time; harmful ones (debuffs) drain your health with damage over time or weaken you. Watch the small icons near your action bar to see what is on you and how long it lasts.",
    ccBody: "Crowd control is a special kind of debuff that limits what a target can do: stuns, roots and slows, silences that stop spellcasting, disarms, fears, and polymorph that turns a foe harmless for a moment. Some of these, like roots, fears, and polymorph, lose their hold when they are reapplied too quickly, so they cannot be chained forever.",
    // Death and recovery: light penalty, no lost progress.
    deathTitle: "When you fall",
    deathBody: "If your health reaches zero you are downed. You revive after a short wait and carry on from where you left off, so a death costs you a little time, not your progress. Between fights, sit to eat and drink so you start the next one at full strength.",
  },

  // Glossary.
  glossary: {
    intro: "A quick reference for the terms used across this guide and in chat.",
    aggroTerm: "Aggro",
    aggroDef: "An enemy's attention. The player generating the most threat holds aggro and gets attacked.",
    threatTerm: "Threat",
    threatDef: "How much an enemy wants to attack you. The tank's job is to hold more threat than everyone else.",
    gcdTerm: "Global cooldown",
    gcdDef: "The short, shared pause after using most abilities, so you cannot fire everything at once.",
    dpsTerm: "DPS",
    dpsDef: "Damage per second, a rough measure of how fast something deals damage.",
    buffTerm: "Buff",
    buffDef: "A helpful effect on you or an ally, like a blessing that raises a stat for a while.",
    debuffTerm: "Debuff",
    debuffDef: "A harmful effect on a target, like a slow, a bleed, or weakened armor.",
    dotTerm: "DoT and HoT",
    dotDef: "Damage over time and healing over time: effects that tick in steady pulses instead of all at once.",
    ccTerm: "Crowd control",
    ccDef: "Abilities that stun, root, or otherwise take an enemy out of the fight for a moment.",
    procTerm: "Proc",
    procDef: "A chance-based effect that fires off something else, like a bonus that sometimes triggers when you attack.",
    eliteTerm: "Elite",
    eliteDef: "A tougher-than-normal enemy, usually meant for a group. Dungeon and rare enemies are often elite.",
    rareTerm: "Rare",
    rareDef: "An uncommon named enemy that wanders a zone and drops better loot.",
    mobTerm: "Mob",
    mobDef: "Any computer-controlled creature in the world, friendly or hostile. Short for mobile.",
    tankTerm: "Tank",
    tankDef: "The party member who holds enemy aggro and absorbs the damage so others can fight safely.",
    healerTerm: "Healer",
    healerDef: "The party member who keeps everyone alive with healing spells.",
    specTerm: "Spec",
    specDef: "A specialization: the path you lean your class toward, like healing or damage, as you spend talents.",
    pullTerm: "Pull",
    pullDef: "To draw an enemy or group into a fight, usually deliberately and one batch at a time.",
    instanceTerm: "Instance",
    instanceDef: "A private copy of a dungeon or raid made just for your party.",
  },

  // FAQ page (fuller than the home teaser).
  faqPage: {
    intro: "The questions new players ask most often.",
    q1: "Is it really free?",
    a1: "Yes. The whole game is free to play to the level cap, and the source code is open on GitHub.",
    q2: "Do I need a crypto wallet or any tokens?",
    a2: "No. The game is fully playable without one. The optional community token only unlocks cosmetic flair and never affects power or progression.",
    q3: "Can I play on my phone?",
    a3: "Yes. The game runs in a mobile browser with touch controls, and there is a desktop launcher as well.",
    q4: "Can I play offline or solo?",
    a4: "Yes. There is an instant single-player offline mode, and the online world is fully soloable apart from dungeons and the raid.",
    q5: "How many classes are there?",
    a5: "Nine, covering the classic tank, healer, and damage roles, each with its own resource and signature abilities.",
    q6: "What is the level cap?",
    a6: "Level {cap}, reached across three connected zones of quests, dungeons, and exploration.",
    q7: "Will my character be saved?",
    a7: "Online characters are saved on the server automatically. Offline characters live in your browser for quick sessions and testing.",
    q8: "Can I host my own copy?",
    a8: "Yes. The project is open source, so you can run your own server. See the GitHub repository.",
    q9: "Is there PvP?",
    a9: "Yes. Duel anyone for fun, or step into the Ashen Coliseum to fight other players. PvP is opt in, so you are never forced into it.",
    q10: "What is there to do at max level?",
    a10: "The cap is level {cap}. From there you run the five-player dungeons and the ten-player raid, chase better gear, and test yourself in the arena.",
    q11: "How do I find a group?",
    a11: "Invite anyone you meet to a party, ask in chat, or team up at a dungeon. Most of the world is soloable, so grouping is a choice, not a requirement.",
  },

  // Classes index + per-class pages.
  classList: {
    heading: "The nine classes",
    sub: "Tank, heal, or deal the damage. Pick the fantasy that calls to you, then make it your own with talents.",
  },
  role: {
    tank: "Tank",
    healer: "Healer",
    damage: "Damage",
  },
  resourceName: {
    rage: "Rage",
    mana: "Mana",
    energy: "Energy",
  },
  classPage: {
    back: "All classes",
    roleLabel: "Plays as",
    resourceLabel: "Resource",
    specsHeading: "Specializations",
    abilitiesHeading: "Signature abilities",
    abilitiesNote: "A taste of the kit. You learn more as you level, and talents reshape how it all plays.",
    masteryLabel: "Mastery",
    fullKitHeading: "The full kit",
    fullKitNote: "Every ability this class can learn, in the order it comes online. Talents decide which ones carry your build.",
    petsHeading: "Demons",
    petsNote: "Warlocks summon demons to fight beside them, each suited to a different job.",
  },
  // Deprecated: short fantasy hooks. The class index and class page now use the canonical
  // character-creation description (classDetails.lore.*) so there is a single source of
  // truth for each class. Kept only so existing locale overlays stay valid; not rendered.
  classHook: {
    warrior: "A relentless front-line fighter who turns every blow taken into fuel for the next.",
    paladin: "A holy warrior who can shield allies, mend their wounds, or bring the hammer down.",
    hunter: "A ranged marksman with a loyal beast at their side and a trick for every foe.",
    rogue: "A master of stealth and poisons who strikes from the shadows and never fights fair.",
    priest: "A devoted healer whose light keeps the party standing, or whose shadow unmakes the enemy.",
    shaman: "A spirit-caller who bends storm, fire, and water, and mends allies between the lightning.",
    mage: "A spellweaver of fire, frost, and arcane who controls the battlefield from afar.",
    warlock: "A dark conjurer who commands demons and curses, trading life for devastating power.",
    druid: "A shapeshifter who tanks as a bear, savages foes as a cat, or heals in the thick of it.",
  },

  // Qualitative "feel" tags for the class chooser and class headers. Relative labels, never
  // numbers (see src/guide/class_meta.ts for the per-class values).
  tag: {
    melee: "Melee",
    ranged: "Ranged",
    both: "Melee or ranged",
    solo: "Solo friendly",
    group: "Group oriented",
    flexible: "Flexible",
    simple: "Simple",
    moderate: "Moderate",
    complex: "Complex",
    goodFirst: "Great first class",
  },

  // The class chooser on the Classes index: filter the nine by how you want to play.
  chooser: {
    heading: "Find your class",
    intro: "Filter by how you like to play. Every class is viable, so this only narrows the field, it does not rank them.",
    role: "Role",
    style: "Style",
    resource: "Resource",
    complexity: "Complexity",
    goodFirst: "Good for beginners",
    clear: "Clear",
    results: "Showing {count} of {total}",
    none: "No class matches every filter. Clear one to see more.",
  },

  // One spoiler-safe, number-free line per signature ability (what it is for, when you
  // press it). Keyed by the sim ability id.
  abilityHook: {
    heroic_strike: "Queues a heavier swing that spends rage on your next hit.",
    battle_shout: "A rallying cry that raises attack power for the party.",
    commanding_shout: "Bolsters stamina so everyone has more staying power in a fight.",
    charge: "Rushes a distant enemy to open the fight with a brief stun.",
    rend: "Opens a bleed that wears the target down over time.",
    thunder_clap: "Hits everything around you and slows their attacks.",
    seal_of_righteousness: "Imbues your swings with Holy damage, then spend it with Judgement.",
    holy_light: "A steady, sizable heal for topping off an ally or yourself.",
    devotion_aura: "A lasting self-buff that raises armor so hits land softer.",
    judgement: "Spends your active Seal to strike an enemy from short range.",
    blessing_of_might: "Raises a friendly target's attack power, good to cast before a pull.",
    divine_protection: "A quick holy shield to soak damage when things get rough.",
    raptor_strike: "A hard melee swing for when something closes the gap on you.",
    aspect_of_the_hawk: "A stance you keep up to sharpen your ranged attack power.",
    serpent_sting: "Lands a venom that bleeds nature damage over time.",
    arcane_shot: "An instant shot from range for quick extra damage.",
    concussive_shot: "Dazes the target and slows it so it cannot reach you.",
    mongoose_bite: "A counterstrike that opens up right after the enemy dodges.",
    sinister_strike: "Your reliable strike that builds combo points to spend later.",
    eviscerate: "Spends your combo points to finish a target with a burst.",
    garrote: "Open from stealth with a wire that bleeds the target over time.",
    backstab: "Slip behind a target with a dagger for a hard-hitting builder.",
    gouge: "Incapacitates the target briefly so you can reposition or peel.",
    cheap_shot: "Open from stealth with a stun and a head start on combo points.",
    smite: "A holy bolt for chipping down a target from range.",
    lesser_heal: "A steady cast to top up an ally when there is time to stand still.",
    power_word_fortitude: "Raises an ally's health pool, so cast it before the pull and keep it up.",
    shadow_word_pain: "Sticks a shadow rot on a foe, then you move on while it ticks.",
    power_word_shield: "Wraps an ally in a shield that soaks hits before they land.",
    renew: "A heal that ticks over time, good to cast and keep moving.",
    lightning_bolt: "A ranged cast of Nature damage, your go-to from afar.",
    rockbiter_weapon: "Imbues your weapon so each swing lands harder in melee.",
    healing_wave: "Your main heal, a direct mend for yourself or an ally.",
    earth_shock: "An instant shock for quick Nature damage when you need it now.",
    lightning_shield: "Charges you so attackers take Nature damage when they hit you.",
    flame_shock: "An instant burn that hits up front and keeps searing over time.",
    fireball: "Your main fire nuke, lands a hit and leaves the target burning.",
    frost_armor: "A lasting self-buff that hardens your armor before a fight.",
    arcane_intellect: "Raises Intellect to deepen an ally's mana pool, cast it before the pull.",
    frostbolt: "Strikes from range and slows the target so it cannot close on you.",
    conjure_water: "Conjures drinks that restore mana, so you can refill between pulls.",
    conjure_food: "Conjures food that restores health when you sit down to eat.",
    shadow_bolt: "A bolt of shadow you cast at a target, your go-to nuke.",
    summon_imp: "Calls up an imp that flings firebolts at enemies from range.",
    demon_skin: "A lasting self-buff that toughens your skin and adds armor.",
    immolate: "Sets a target alight for an opening hit and a burn that lingers.",
    corruption: "Rots a target with shadow that ticks while you do other things.",
    life_tap: "Trades some of your own health back into mana when you run dry.",
    wrath: "A nature bolt thrown at a target from range, your go-to nuke.",
    healing_touch: "A big single-target heal with a long cast, for topping someone off.",
    mark_of_the_wild: "A lasting blessing you put on yourself or an ally before a fight.",
    moonfire: "Hits instantly and leaves the target burning, good while moving.",
    rejuvenation: "Casts instantly and heals an ally over time, so you can keep acting.",
    thorns: "Wards an ally so melee attackers hurt themselves for striking.",
  },

  // Warlock demon roster flavor, keyed by pet id.
  petHook: {
    imp: "A ranged firebolt demon that chips at enemies from a safe distance.",
    voidwalker: "A sturdy demon that taunts and soaks hits so you can cast in peace.",
    succubus: "A fast melee demon that hits hard but folds under pressure.",
    felhunter: "A shadow skirmisher that hounds enemy casters.",
    felguard: "A durable melee bruiser, the all-rounder once you can summon it.",
    infernal: "A hulking juggernaut with crushing melee, summoned for raw power.",
    doomguard: "An elite caster that rains heavy shadow from afar.",
  },

  // Bestiary.
  bestiary: {
    heading: "Bestiary",
    intro: "The creatures of the world, grouped by family. These are the foes you meet out in the open. The deadliest things wait, unlisted, behind dungeon doors.",
    rare: "Rare",
    levels: "Levels {min} to {max}",
    levelsSame: "Level {min}",
    // Heading for the line of flavor under a creature that carries one.
    notedLabel: "Of note",
    // One-line, mechanics-free flavor for a handful of notable and rare creatures, keyed
    // by the sim template id. Most creatures carry no line; only the standouts do.
    flavor: {
      old_greyjaw: "A scarred old wolf no trap has held, blamed for three hounds and a stable boy's arm. He hunts the deep woods alone, and turns savage the longer a fight wears on.",
      brightwood_stag: "A proud grove deer that lowers its crown of antlers and bulls forward, growing harder to face the longer it is pressed.",
      grubjaw: "A fen troll so greedy the other trolls will not dig beside him, said to have eaten a trader's last two pack-mules, harness and all.",
      shardlord_kazzix: "A storm elemental given shoulders, walking the far crags above Stormcrag with a heartshard worth braving the lightning for.",
      mirejaw_frenzy: "A marsh murloc that whips itself into a thrashing frenzy mid-fight, the loudest thing in a loud, territorial pack.",
      gravecaller_cultist: "Robed servants of the death-cult whose work fouls the graves from the Vale to the peaks. Where they gather, the dead do not rest.",
    },
  },
  family: {
    beast: { name: "Beasts", desc: "Wild animals of forest and field, from wolves and boars to the things that prey on them. Hunters can tame many of them." },
    spider: { name: "Spiders", desc: "Web-spinners and venomous lurkers that nest in dark, tangled places." },
    murloc: { name: "Murlocs", desc: "Amphibious marsh-dwellers that swarm the shallows in noisy, territorial packs." },
    kobold: { name: "Kobolds", desc: "Candle-headed diggers that infest mines and burrows, fiercely guarding their ore." },
    humanoid: { name: "Humanoids", desc: "Bandits, cultists, and others who took up the wrong trade. They fight with tactics, not just teeth." },
    troll: { name: "Trolls", desc: "Hulking, fast-healing brutes that lair in the marsh and the high country." },
    ogre: { name: "Ogres", desc: "Enormous, slow-witted, and dangerous. They camp the high passes and hit like a landslide." },
    undead: { name: "Undead", desc: "The restless dead, raised by darker hands. They do not tire and they do not flee." },
    elemental: { name: "Elementals", desc: "Living storm and stone, bound to the wild places where the elements run strong." },
  },

  // World / zones.
  worldPage: {
    heading: "The world",
    intro: "World of ClaudeCraft is one continuous land you cross on foot, three zones laid south to north. There is no fast travel, so the journey is part of the adventure.",
    hub: "Home base",
    mapHeading: "The road north",
    mapSub: "Three zones, south to north, each a step higher in level. Follow the quest trail and the land carries you from the valley to the peaks.",
    places: "Notable places",
    residents: "Who you will meet",
    valeBlurb: "The green starting valley, where new heroes cut their teeth on wolves and bandits around the town of Eastbrook.",
    marshBlurb: "A drowned country of fog and ruins. Murlocs swarm the shallows and something older stirs beneath the water, watched from the bridge-town of Fenbridge.",
    peaksBlurb: "Wind-scoured ridges and old mine-works climbing to the realm's coldest, highest dangers, held by the outpost of Highwatch.",

    // One quotable hub greeting per zone, keyed by biome. Speaker names are proper nouns
    // (passed as raw text in world.ts), so only the spoken line is a key here.
    valeGreeting: "Keep your blade close. The Vale is not what it was.",
    valeGreeter: "Marshal Redbrook, Eastbrook",
    marshGreeting: "Hold at the gate. Past those reeds, the fen does the killing for us.",
    marshGreeter: "Warden Fenwick, Fenbridge",
    peaksGreeting: "Two hundred years this wall has held. It will not break on my watch, but it groans.",
    peaksGreeter: "Captain Thessaly, Highwatch",

    // Short, spoiler-safe one-liners for each zone's notable places (keyed by biome). One
    // sentence per place, in the same order as the POI list.
    valePlaceNotes: "Eastbrook is your first home base. Wolf Run and Boar Meadow are gentle hunting ground; Mirror Lake is quiet water to fish; the Webwood and the Copper Dig hide spiders and ore-greedy diggers; a Bandit Camp and the Fallen Chapel hold rougher work; Brightwood Glade is a calm wildlife grove in the north.",
    marshPlaceNotes: "Fenbridge guards the only dry road. The Prowler Reeds and Deepfen Shallows teem with marsh beasts and murlocs; the Widow Thicket is spun thick with web; the Drowned Chapel and the Troll Mounds keep older dangers; the Gravecaller Encampment is the cult dug in, and the Sunken Bastion is the marsh's instanced heart.",
    peaksPlaceNotes: "Highwatch holds the wall. Stalker Ridge and the Deeprock Burrows belong to ridge cats and kobolds; the Ogre Foothills and Drogmar's War-Camp to brutes for hire; Stormcrag crackles with elementals and the Glimmermere glows below it; the Wyrmcult Tents and Revenant Fields ring the cult's high ground, with Gravewyrm Sanctum at its peak.",

    // Brightwood Glade vignette (Ranger Elwyn + the great stag), distilled spoiler-safe.
    gladeTitle: "A quiet corner: Brightwood Glade",
    gladeBody: "Not every story in the Vale is about the dead. In the north, a sunlit grove called Brightwood Glade keeps its own gentler rhythm, watched over by a lone ranger who would rather steward it than fight. Her work is balance: thinning what overbreeds, and, when its hollow grows too dangerous to leave be, giving the grove's old crowned stag a respectful end. It is a soft counterpoint to the trail you are following, and worth the detour.",
  },

  // Quests.
  questsPage: {
    heading: "Quests",
    intro: "Quests are the heart of the world and the fastest way to level. Here is how they work.",
    acceptTitle: "Finding and accepting",
    acceptBody: "People with a marker over their head have work for you. Talk to them to accept a quest. Your very first is Wolves at the Door, from Marshal Redbrook in Eastbrook.",
    objectivesTitle: "Objectives",
    objectivesBody: "Slay certain enemies, gather items, or interact with something in the world. The on-screen tracker counts your progress as you go.",
    turninTitle: "Turning in",
    turninBody: "Return to the quest giver, the map shows you where, for experience, coin, and often a piece of gear chosen to suit your class.",
    partyTitle: "Questing in a group",
    partyBody: "Party members nearby share kill and objective credit, so questing together is faster, never slower.",
    storyTitle: "A thread runs through it all",
    storyBody: "From your first errands in Eastbrook, something is wrong with the dead. A cult is at work, and the trail leads north through every zone. Follow it to learn who stands behind it.",
    soloNote: "The main story is fully soloable; only its final chapters call for a group.",

    // Quest types section: the shapes an objective can take.
    typesTitle: "The kinds of quest you will see",
    typesBody: "Most quests are one of a few familiar shapes. The on-screen tracker spells out exactly what each one wants, so you are never left guessing.",
    typeSlayTitle: "Slay",
    typeSlayBody: "Thin out a pack of beasts or break a cult's hold by defeating a set number of a marked enemy. The first quest in the game, clearing wolves off the Eastbrook road, is one of these.",
    typeGatherTitle: "Gather",
    typeGatherBody: "Collect items from the world or from what enemies drop: herbs, ore, lost letters, a cult's grim reagents. Some pieces only fall from a particular foe, so the hunt and the haul go together.",
    typeInteractTitle: "Interact",
    typeInteractBody: "Use, cleanse, or read something fixed in the world: a defiled grave, a warning carved on a shore-rock, a sealed crypt door. Walk up to the marker and act on it.",
    typeMusterTitle: "Escort and muster",
    typeMusterBody: "See a friendly face safely from one place to another, or rally a town's defenders before a push north. These keep you moving with the people whose story you are in.",
    typeGroupTitle: "Group finales",
    typeGroupBody: "Each chapter of the main story ends at a dungeon door. The lead-in is soloable, but the final blow against a chapter's villain is meant for a party of five (and the very last, for ten).",

    // The villain-ladder saga, teased as a trail north. No endings, no boss names.
    sagaTitle: "Follow the trail north",
    sagaBody: "The main story is one long chase. A death-cult is at work on the realm's graves, and every chapter you close points one zone further up the road. You never fight the whole conspiracy at once; you pull one thread, and it leads to the next hand holding it.",
    sagaValeTitle: "The Vale: a name on a sigil",
    sagaValeBody: "In Eastbrook the dead will not rest, and the mark behind it belongs to a sect long thought gone. Trace it to a Gravecaller working the chapel crypt, and his own papers point you toward the fen in the north.",
    sagaMarshTitle: "The marsh: a tithe of souls",
    sagaMarshBody: "In Mirefen the drownings are no accident. Someone is filling the fen like a tithing box, raising obedient dead from every traveler the water takes. Chase the orders up the chain to a Mistcaller in the drowned bastion, whose last words name something older still, stirring beneath the peaks.",
    sagaPeaksTitle: "The peaks: what the tithe was for",
    sagaPeaksBody: "On Thornpeak the whole scheme comes clear. Every soul stolen since the Vale was a tithe poured toward waking an ancient thing sealed beneath the mountain. The trail that began in a chapel yard ends here, at a door it takes ten to open. We will let you find out who waits behind it.",

    // Side-chains, called out as optional threads alongside the main story.
    sideTitle: "Threads off the main road",
    sideWardenTitle: "Earning your name",
    sideWardenBody: "Alongside the story, the wardens of the Vale and the fen hand out a standing bounty ladder. Work your way up it, foe by foe, the way every warden before you earned their place. It is honest leveling and a tour of each zone's worst troublemakers.",
    sideCryptTitle: "The forgotten king",
    sideCryptBody: "High on the peaks runs a quieter mystery: old graves marked with a crown no record remembers. Read the dead, gather what they guarded, and unseal a tomb that was meant to stay shut. It is a detective's trail that opens the way to a second endgame trial for a full raid.",
  },

  // Recurring characters and in-world voices, shared across the World and Quests pages.
  lore: {
    figuresTitle: "Faces you will come to know",
    figuresBody: "A handful of people walk the whole road with you. Watch for these names from the valley to the peaks.",
    aldricRole: "Priest of the Vale",
    aldricBody: "A humble village priest who first names the cult over a defiled grave in Eastbrook, then follows its trail in person through the marsh and up to the wall at Highwatch. He is the steady heart of the whole campaign.",
    marenRole: "The Marshal's Scout",
    marenBody: "A low-talking tracker you meet in the reeds of Mirefen, all quiet feet and a short blade. She follows the trail north too, and it is her ear that catches the words that send you to the peaks.",
    elwynRole: "Glade Warden of Brightwood",
    elwynBody: "The lone keeper of a sunlit grove in the north of the Vale. Her work is stewardship, not slaughter: thinning what overbreeds and granting the grove's oldest beast a kinder end than the wolves would.",
  },

  // Dungeons and Raids.
  dungeonsPage: {
    heading: "Dungeons and Raids",
    intro: "When the open world is not enough, gather a party and step into an instance: a private copy of a dungeon made just for your group.",
    party: "Dungeons are built for a party of five. The endgame raid is for ten.",
    soloLead: "Every dungeon opens with a soloable lead-in quest, so you always know why you are going in.",
    levelAround: "Around level {n}",
    levelExact: "Level {n}",
    levelBand: "Levels {min} to {max}",
    partySize: "{n} players",
    raidSize: "Ten players, level {n}",
    hollowName: "The Hollow Crypt",
    hollowBody: "A grave-robbed chapel crypt where the newly dead refuse to rest. The first real test of a new party.",
    bastionName: "The Sunken Bastion",
    bastionBody: "A flooded fortress lost to the marsh, held by drowned defenders and the rising tide itself.",
    templeName: "The Drowned Temple",
    templeBody: "A moonlit shrine sunk beneath a glowing tarn high in the peaks, reached through a gate of cold light. A drowned cult still sings down there in its rotted vestments, and the warnings carved on the shore say something below only sleeps. A self-contained mystery, set apart from the main story, for the curious and the well-prepared.",
    sanctumName: "Gravewyrm Sanctum",
    sanctumBody: "The dark heart of Thornpeak, where the cult's long work reaches its terrible peak.",
    raidName: "The endgame raid",
    raidBody: "Beyond a sealed royal door waits a ten-player trial: a multi-phase fight and a deathless power the whole raid must shut down together. Earn your way in, then bring nine friends.",

    // Standalone, spoiler-safe lore for the Drowned Temple card (the goddess twist and any
    // boss names are withheld).
    templeLoreTitle: "The Drowned Temple, a little deeper",
    templeLoreBody: "The temple has its own legend, older than the cult you chase elsewhere. On the shore of the Glimmermere, a tarn that drinks the moonlight and gives back the drowned, a lone watcher keeps a gate of pale light. Beneath the surface, a stair of cold stone runs down to it. The folk who sank there did not drown by misadventure: they were the Pale Choir, who went under in worship and never stopped singing. The old wardens scratched a single warning into the rocks before the water took them, a prayer to something they called the Drowned Moon, with a steadier hand adding two words beneath it: it only sleeps.",

    // Teased lead-in from the forgotten-king crypt side-arc to a second raid trial.
    cryptLeadTitle: "A door the dead were meant to keep shut",
    cryptLeadBody: "High on the peaks, away from the main fight, lies a colder mystery. Old graves bear a crown no record remembers, and the dead who guard them once served a forgotten king. Read their stones, gather the keystones they kept, and you can unseal a tomb that three loyal souls died to hold closed, opening a second ten-player trial for those who follow the clues to the end.",
  },

  // Talents and Specializations reference.
  talentsPage: {
    heading: "Talents and specializations",
    intro: "Talents are how you make a class your own. They are optional, forgiving, and easy to change, so you can experiment without fear.",
    whatHeading: "What talents do",
    whatBody: "As you level, you earn talent points to spend on small, permanent upgrades to your abilities and stats. They shape how a class feels, leaning it toward more damage, sturdier defense, or stronger healing.",
    howHeading: "How they work",
    howBody: "Talents open up at level 10, and you keep earning points as you climb to the cap. You spend them in your class's talent panel, and you can save more than one layout to swap between builds.",
    resetTitle: "Nothing is permanent",
    resetNote: "You can reset your talents at any time, so an early pick is never a trap. Try things, see what you like, and change your mind freely.",
    specsHeading: "Specializations by class",
    specsBody: "Every class has a handful of specializations, each with its own role and a signature focus. Here is the shape of all of them. Open a class for its full kit.",
  },

  // Arena and PvP.
  arenaPage: {
    heading: "Arena and PvP",
    intro: "Want to test yourself against other players? Player versus player is built in, and it is always something you choose, never something forced on you.",
    duelsHeading: "Duels",
    duelsBody: "Challenge any player you meet to a friendly duel. Nothing is on the line but pride, so it is the easiest way to learn a matchup or settle a friendly argument.",
    coliseumHeading: "The Ashen Coliseum",
    coliseumBody: "The Coliseum is the realm's arena, where you face other players in ranked matches. Win and your standing climbs, and the strongest fighters rise up the leaderboard for everyone to see.",
    fiestaHeading: "Two versus two Fiesta",
    fiestaBody: "Fiesta is a fast, two-on-two mode played in short rounds. Between rounds you draft augments, quick boosts that reshape your kit on the fly, so no two matches play quite the same.",
    augmentsNote: "Augments and power-ups last only for the match. They are about playful, on-the-spot builds, not lasting power, so nobody buys their way to a win.",

    // The three escalating augment waves, named as flavor. No numbers, no exact effects.
    wavesTitle: "Augments arrive in waves",
    wavesBody: "Each round of a Fiesta hands you a fresh pick, and the picks grow bolder as the match goes on. You build from one wave to the next, choosing one of a few options each time and keeping it for the rest of the bout.",
    waveSilverTitle: "Silver",
    waveSilverBody: "The opening wave: clean, single-stat boosts that sharpen the basics of your class.",
    waveGoldTitle: "Gold",
    waveGoldBody: "The middle wave: two-edged combos where your build starts to take shape and sing.",
    wavePrismaticTitle: "Prismatic",
    wavePrismaticBody: "The final wave: build-defining, screen-melting spikes meant to feel ridiculous in the best way.",

    // The grab-in-the-ring power-ups, named as playful flavor.
    powerupsTitle: "Power-ups in the ring",
    powerupsBody: "Glowing orbs also drop into the arena mid-fight, free for whoever reaches them first. They are deliberately over the top and last only a short while: Speed Demon for a blink of blinding pace, Colossus to swell up into a lumbering giant, Moon Boots for a bouncing, low-gravity leap, and Berserker for a sudden surge of fury.",
    ladderHeading: "Climbing the ladder",
    ladderBody: "Ranked play tracks your standing over time. Check the leaderboard to see where you sit and who holds the top of the realm.",
  },

  // "Things I Wish I Knew" beginner page.
  wishPage: {
    heading: "Things I wish I knew",
    intro: "A few honest truths that save new players a lot of second-guessing. None of it is required reading, but all of it helps.",
    i1Title: "You cannot pick a wrong class",
    i1Body: "Every class can hold its own and reach the cap. Choose the fantasy you like, not the one someone else calls best.",
    i2Title: "Dying barely costs you",
    i2Body: "When you fall, you release at a graveyard and run back to your body. No experience is lost, so it is safe to take risks and learn.",
    i3Title: "Talents are not a trap",
    i3Body: "They unlock at level 10 and reset whenever you want, so your early choices are never permanent.",
    i4Title: "Follow the quest trail",
    i4Body: "Quests are the fastest way to level and they lead you across the world. When you are unsure where to go, find the next marker.",
    i5Title: "Keep your gear current",
    i5Body: "A fresh upgrade does more for you than perfect play in old gear. Take the quest rewards that suit your class.",
    i6Title: "Grouping is a choice, not a chore",
    i6Body: "Most of the world is soloable. Team up for dungeons and the raid, or just when you want some company.",
    i7Title: "Learn your resource",
    i7Body: "Rage, mana, or energy, managing it well is half of playing your class. Watch that bar, not only your cooldowns.",
    i8Title: "Rest between fights",
    i8Body: "Eat and drink to recover quickly, especially as a caster. A few seconds now saves a death later.",
  },

  // Interactive 3D model viewer (embedded on class, bestiary, and warlock pages, and
  // the full gallery). The model loads only when the reader asks for it.
  viewer: {
    view3d: "View {name} in 3D",
    view3dShort: "View in 3D",
    loading: "Loading model...",
    error: "The 3D model could not be loaded. The art above still shows this {name}.",
    dragHint: "Drag to turn the model. Use the left and right arrow keys when it is focused.",
    canvasLabel: "Rotatable 3D model of {name}",
  },

  // 3D model gallery page (/guide/models): browse every class, creature, and demon.
  models: {
    title: "3D Model Viewer",
    lead: "Inspect the heroes, monsters, and demons of the world up close. Choose a model, then drag to turn it.",
    intro: "Every figure here is the same model you meet in the game, rendered live in your browser. Pick one to load it.",
    groupClasses: "Classes",
    groupCreatures: "Creatures",
    groupPets: "Warlock Demons",
    pickerLabel: "Choose a model to view",
    count: "{count} models",
    noWebgl: "This browser cannot display 3D models. Everything is still listed on the class and bestiary pages.",
  },

  // Gear & Items. Spoiler-safe: systems and direction only, no balance numbers, item
  // names, drop rates, or boss/encounter detail. The quality tiers render their swatch
  // color from the live QUALITY_COLOR table; the label here is always shown alongside it.
  gear: {
    intro: "Gear is the equipment your character wears and the items you carry. Better gear is the steadiest way to grow stronger, and you pick most of it up just by playing.",

    // The eight equip slots (the paperdoll).
    slotsTitle: "What you can equip",
    slotsBody: "You have a weapon slot and seven armor slots. Each piece you equip adds to your character, and you can mix and match freely as you find upgrades.",
    slotMainhand: "Weapon",
    slotHelmet: "Head",
    slotShoulder: "Shoulders",
    slotChest: "Chest",
    slotWaist: "Waist",
    slotLegs: "Legs",
    slotGloves: "Hands",
    slotFeet: "Feet",

    // Quality / rarity tiers. Color signals quality, but the name is always shown too.
    qualityTitle: "Quality, at a glance",
    qualityBody: "Every item has a quality, and its name is colored to match so you can read its worth at a glance. From most common to most prized:",
    qualityPoor: "Poor",
    qualityCommon: "Common",
    qualityUncommon: "Uncommon",
    qualityRare: "Rare",
    qualityEpic: "Epic",
    qualityLegendary: "Legendary",
    qualityNote: "Higher quality usually means better stats, but quality is a hint, not a rule. A well-matched piece for your class and level can beat a flashier one.",

    // Keeping gear current beats perfect play in old gear.
    upgradeTitle: "Keep your gear current",
    upgradeBody: "Replacing an old piece with a fresh upgrade does more for you than playing perfectly in gear you have outgrown. When something better drops or a quest offers it, take it. Do not save your good items for later.",

    // Where gear comes from.
    sourcesTitle: "Where gear comes from",
    sourcesBody: "Most of your early upgrades are quest rewards, so it pays to finish quests rather than grind. Enemies drop gear when you defeat them, vendors in town sell solid basics, and the player market lets you buy from other adventurers.",

    // Consumables: potions, food, drink, elixirs. No numbers.
    consumablesTitle: "Consumables",
    consumablesIntro: "Some items are used once for a quick benefit. They are cheap insurance, so keep a few on hand.",
    consumablesPotions: "Potions restore health or mana the moment you use them, even mid-fight, which makes them a clutch save when a pull goes wrong. They share a short cooldown, so plan one good moment to use them.",
    consumablesFood: "Food and drink restore you while you sit and rest between fights. Eating recovers health, drinking recovers mana, and resting this way is free. Sit down for a few seconds after a tough fight instead of running into the next one half-healed.",
    consumablesElixirs: "Elixirs grant a temporary buff while you adventure, a small edge that helps when you want to push a little further.",

    // Fishing: relaxing side activity. Broad terms only.
    fishingTitle: "Fishing",
    fishingBody: "Fishing is a calm change of pace. Equip a fishing pole, cast into open water, and reel in what bites. You mostly catch fish you can cook into food, the odd bit of junk to sell for a few coins, and now and then a prized rare catch. What you find depends on the water you fish in.",
    fishingFood: "The fish you reel in are raw, and raw fish are food. Cook your catch and it heals more when you sit to eat, with the better fish coming from the colder, deeper waters in the north. A line in the lake is a quiet way to keep your pack stocked between fights.",
    fishingRare: "Now and then your line catches something far better than supper: a shimmering prized fish that any angler might luck into in any water. Hook one and your log lights up with the catch. It is the kind of lucky pull that makes an idle afternoon at the lake worth telling people about.",

    // Looks and cosmetics (skins). Appearance only.
    cosmeticsTitle: "Looks and cosmetics",
    cosmeticsBody: "Some rewards change only how your character looks, never how strong you are. These cosmetic skins let you stand out without affecting the game, so wear whichever you like.",
    cosmeticsRanks: "Cosmetics come in rarity tiers of their own, and the rarer ones are a fun thing to chase. Earning a higher tier also unlocks the looks below it.",
    cosmeticsSkins: "There are two cosmetic lines to collect. Every class has a handful of alternate appearances, a fresh take on its look that is yours alone to wear. Alongside them sit chromas: named two-tone color schemes that repaint a look entirely, from sober metals to bright imperial colors.",
    cosmeticsCache: "A few of these come from a mysterious cosmetic cache, a sealed prize that rolls one of three quality grades when you open it and grants the appearance to match. It is purely for looks: nothing inside it makes you stronger, only finer to look at.",
  },

  economy: {
    intro: "Coin oils the whole world: it buys gear and supplies, pays your repairs and quest costs, and changes hands between players. You pick all of this up just by playing, so think of this page as a map of where your money comes from and goes.",

    // Money and its coin denominations.
    coinTitle: "Gold, silver, and copper",
    coinBody: "Money comes in three coins. A hundred copper make a silver, and a hundred silver make a gold, so your purse fills up from the smallest coin first. You earn it from quest rewards, from looting fallen enemies, and from selling what you no longer need.",

    // Vendors and the kinds you meet.
    vendorsTitle: "Vendors and what they keep",
    vendorsBody: "Towns and outposts are dotted with merchants, each with their own trade. Provisioners stock food and drink, weaponsmiths and armorers carry gear, herbalists deal in reagents, and a quartermaster keeps practical travel kit. Walk up to one to see what they sell.",

    // Buying and selling at a vendor.
    buyingTitle: "Buying and selling",
    buyingBody: "Stand near a merchant to open their window. You can buy anything they stock if you can afford it, and sell most of what is in your bags for coin. If you sell something by mistake, a vendor will hold your recent sales so you can buy them back.",

    // Offloading junk.
    junkTitle: "Clearing out junk",
    junkBody: "Drops you have no use for still sell to any vendor, so empty your bags whenever you pass through town rather than letting them fill up. Truly worthless odds and ends can also be discarded outright to make room.",

    // Direct player-to-player trading.
    tradeTitle: "Trading with other players",
    tradeBody: "You can trade face to face with anyone standing near you. Both of you put items and coin into a shared window and the swap only happens once you both confirm it, so neither side can be caught out. It is the simple way to hand a friend a drop or settle a deal.",

    // The World Market (player auction house): browse, post, collect, pricing.
    marketTitle: "The World Market",
    marketBody: "The Merchant runs the World Market, a player-driven exchange where you can buy and sell with people you may never meet. Speak to the Merchant to open it.",
    marketBrowse: "Browsing: scroll the listings or search by name to find what is for sale. Each listing shows the goods, the seller, and the asking price for the whole stack.",
    marketPost: "Posting: choose a stack from your bags, set your price, and list it. The goods are held by the Merchant until someone buys them. Unsold listings come back to you after a while, and you can reclaim one early if you change your mind.",
    marketCollect: "Collecting: when your goods sell, your proceeds wait for you at the Merchant. Return to collect the coin, along with anything that came back unsold. The Merchant takes a small cut of every completed sale.",
    marketPricing: "Pricing is up to you. Listing a little under what others are asking tends to sell faster, while a steep price may sit untouched. Browse first to see what the going rate looks like before you post.",
  },

  // Social and Groups: chat channels, parties, party loot, friends, ignore, guilds.
  social: {
    intro: "Most of the world is soloable, but the game is built to be played with other people. Here is how to talk, team up, and find your crowd.",

    // Chat channels.
    chatHeading: "Chat channels",
    chatBody: "Chat is split into channels, each shown on its own tab. Type a message to send it on the active channel, or use a slash command to direct one line elsewhere. These are the channels you can talk on:",
    chanSay: "Say.",
    chanSayBody: "Your default voice. It reaches players close to you and is the one to use while questing side by side.",
    chanYell: "Yell.",
    chanYellBody: "A louder version of Say that carries a bit farther, enough to reach across a camp.",
    chanWhisper: "Whisper.",
    chanWhisperBody: "A private message to one player by name, wherever they are. Use it for a quiet word.",
    chanParty: "Party.",
    chanPartyBody: "Talk to everyone in your group, no matter how spread out you are.",
    chanGeneral: "General.",
    chanGeneralBody: "An always-on local channel for the people around you, good for asking a question or chatting.",
    chanWorld: "World.",
    chanWorldBody: "A realm-wide channel you opt into. Open its tab to join, and you will see and reach everyone online.",
    chanLfg: "Looking for Group.",
    chanLfgBody: "An opt-in realm-wide channel for finding people to run a dungeon. Open its tab to join.",
    chanGuild: "Guild and Officer.",
    chanGuildBody: "Channels for your guild. Guild chat reaches every member; the officer channel is just for officers.",

    // Parties.
    partyHeading: "Forming a party",
    partyBody: "Invite another player by right-clicking their name and choosing to invite, or with a chat command. A party holds up to five players, and one of you is the leader.",
    partyCredit: "Group members near each other share kill and quest credit, so questing together is faster, never slower. A party is also how you step into a dungeon as a team.",
    raidBody: "Once you have a full party of five, the leader can convert it into a raid of up to ten, for the endgame raid.",

    // Party loot.
    lootHeading: "Party loot",
    lootBody: "When you group up, the party leader sets how loot is shared. The rules cover coin and items separately:",
    lootCoinTitle: "Coin.",
    lootCoinBody: "Money from a kill can go to whoever loots it, or be split evenly across the party.",
    lootCommonTitle: "Items.",
    lootCommonBody: "Ordinary drops can go to the looter, while better drops are put up for a roll so everyone gets a fair shot.",
    lootRollTitle: "Need, Greed, or Pass.",
    lootRollBody: "When an item goes to a roll, each eligible member chooses Need if they want it, Greed if they would only take it spare, or Pass to bow out. The highest roll wins.",

    // Friends and ignore.
    friendsHeading: "Friends and ignore",
    friendsBody: "Add players to your friends list to see when they are online and where they are, so you can group up the moment they log in.",
    ignoreBody: "If someone is bothering you, add them to your ignore list and you will stop seeing their chat.",

    // Guilds.
    guildHeading: "Guilds",
    guildBody: "A guild is a lasting group of players you belong to between sessions. Create one or accept an invite to join, and you can be in one guild at a time. Members hold a rank: a leader, officers, and members.",
    guildChatBody: "Belonging to a guild gives you a private guild chat channel and shows your guildmates on a shared roster, so there are always familiar faces online.",

    // Grouping etiquette.
    etiquetteHeading: "Grouping etiquette",
    etiquetteBody: "Grouping is a choice, not a chore. Say hello when you join, roll Need only on gear you will actually use, and let the group know before you head off. A little courtesy goes a long way, and most players are glad of the company.",
  },

  stats: {
      // Character & Stats page: primary attributes, secondary stats, the character
      // sheet, and how stats grow. Directional only, no balance numbers.
      intro: "Your character is described by a handful of attributes. You never have to memorize them to play well, but knowing roughly what each one does helps you read your character sheet and pick the right upgrades.",

      // The five primary attributes.
      primaryHeading: "Primary attributes",
      primaryBody: "Five attributes shape your character: Strength, Agility, Stamina, Intellect, and Spirit. Each class leans on a different mix, so the ones that matter most depend on what you play.",
      strTitle: "Strength",
      strBody: "Strength raises your melee attack power, so your weapon swings hit harder. It does the most for the heavy melee classes that fight up close.",
      agiTitle: "Agility",
      agiBody: "Agility sharpens you in several ways: it raises your chance to land a critical hit and your chance to dodge, and it adds a little armor. For rogues and hunters it also feeds attack power, and it drives a hunter's ranged shots.",
      staTitle: "Stamina",
      staBody: "Stamina is your staying power. More Stamina means a larger health pool, and it speeds the health you recover while resting out of combat. Every class wants some.",
      intTitle: "Intellect",
      intBody: "Intellect grows a spellcaster's mana pool and improves the chance their spells crit. It matters to the classes that cast from mana; for a Rage or Energy class it does little.",
      spiTitle: "Spirit",
      spiBody: "Spirit governs how quickly a caster's mana returns while out of combat. Like Intellect, it serves the mana classes and means little to the others.",

      // Secondary / derived stats.
      armorTitle: "Armor",
      armorBody: "Armor reduces the physical damage you take. It comes mostly from what you wear, and the heavier armor classes carry far more of it. More armor against a foe near your level means each of its hits lands softer.",
      apTitle: "Attack power",
      apBody: "Attack power measures how hard your weapon strikes. Your primary attributes feed it, and stronger weapons and gear raise it further, which is why an upgrade can be a real jump in damage.",
      critTitle: "Critical strike",
      critBody: "Your critical strike chance is how often an attack lands for extra damage. Everyone starts with a small base chance, and Agility (plus some talents and gear) builds on it.",
      dodgeTitle: "Dodge",
      dodgeBody: "Dodge is your chance to avoid an incoming melee attack entirely. You begin with a small base chance, and Agility raises it, so nimble classes slip more blows.",

      // The character sheet.
      sheetHeading: "Reading your character sheet",
      sheetBody: "Open the character window in game to see all of this in one place: your five attributes on one side and the stats they feed on the other. Hover any value and a tooltip breaks down what it does for your class, so you can see at a glance which numbers an upgrade actually moved.",

      // How stats grow.
      growHeading: "How your stats grow",
      growBody: "Two things raise your stats. Every level adds a fixed amount of each attribute to suit your class, and the gear you equip adds more on top. Keeping your gear current is the steadiest way to grow stronger, all the way to the level cap.",
    },

  // Leveling and Progression. How experience is earned, the journey across the three
  // zones, rested XP, and what waits at the cap. Number-free and spoiler-safe.
  progression: {
    intro: "Every fight, quest, and step north makes your hero stronger. Here is how leveling works and what keeps you growing once you reach the top.",
    // How experience is earned, and the cap. {cap} = level cap.
    xpTitle: "How you gain experience",
    xpBody: "You earn experience by completing quests and by defeating enemies. Quests give the most by far, so following the quest trail is the fastest way to climb. Killing things along the way fills in the rest.",
    capBody: "Each level makes you tougher and brings new abilities, all the way to the cap of level {cap}.",
    // The leveling journey across the three zones, south to north.
    journeyTitle: "The journey north",
    journeyBody: "The world is one continuous land, three zones laid south to north, each a step higher in level. You start in the green valley, press on through the marsh, and finish in the cold high peaks. Follow the quest trail and the land carries you from one to the next.",
    bandLabel: "Levels {min} to {max}",
    // Rested XP, described without numbers.
    restedTitle: "Rested experience",
    restedBody: "When you log out, or rest in a safe place like an inn, your character builds up rested experience while you are away. The next time you go out and fight, that pool gives your kills an extra boost until it runs dry. It builds up over time and speeds your early levels, so logging off in town is never wasted time.",
    // What happens at the cap: cosmetic, optional, long-term. {cap} = level cap.
    capTitle: "Reaching level {cap}",
    capJourneyBody: "Level {cap} is the cap, the end of leveling but not of growing. From there you run dungeons and the raid, chase better gear, and test yourself in the arena.",
    prestigeBody: "Experience keeps counting even after the cap. It feeds a cosmetic virtual level, so your experience bar keeps climbing, and a long-term prestige rank you can earn for the recognition. It is purely optional and never grants power, just a mark of the road you have walked.",
    // Gentle reassurance.
    noRush: "There is no rush. The world is there to enjoy at your own pace, so wander, take the quests that catch your eye, and let your hero grow along the way.",
  },

  // Generic placeholder for sections still being written (build scaffolding).
  placeholder: {
    note: "This part of the guide is on its way.",
  },

  // 404 / unknown route.
  notFound: {
    title: "We could not find that page",
    body: "The page you were looking for does not exist or may have moved.",
    home: "Back to the overview",
  },
};
