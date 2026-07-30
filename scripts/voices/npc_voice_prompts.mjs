// Machine-readable companion to docs/design/npc_voices.md — the source of truth
// for ElevenLabs voice design. One entry per DISTINCT voice. Brother Aldric,
// Scout Maren and Brother Halven each get a single voice even though they recur
// across zones under suffixed NPC ids (brother_aldric_fen, scout_maren_highwatch,
// brother_halven_marsh, …); gen_npc_lines.mjs maps those recurring ids back to
// the base voice via VOICE_ALIAS.
//
// Each `voiceDescription` is the voice-direction paragraph from npc_voices.md;
// `sampleText` is that NPC's "Voice test" sentence. npcId uses the canonical
// content key from the owning src/sim/content/ zone file. The last group holds
// escortee voices: escort quest barks ride the 'yell' channel, so they are keyed
// through EXTRA_LINES (extra_lines.mjs) rather than an NpcDef.
//
// Grounding rule for a new entry: the NPC has no bespoke portrait art, so the
// voice is derived from what actually defines the character in game, its render
// visual (NPC_KEYS in src/render/characters/manifest.ts, most new-zone NPCs fall
// through to the tinted villager body), its signature tint, its title and role,
// the zone it stands in, and above all its own written dialogue, which carries
// the cadence and attitude.

/** @typedef {{ npcId: string, name: string, voiceDescription: string, sampleText: string }} VoicePrompt */

/** @type {VoicePrompt[]} */
export const VOICE_PROMPTS = [
  // -- Eastbrook Vale ------------------------------------------------------
  {
    npcId: 'the_merchant',
    name: 'The Merchant',
    voiceDescription:
      'Warm, silver-tongued auctioneer — mid-range, lightly gravelled, perpetually amused. ' +
      "Rolling crier's cadence that could sell you your own boots; honeyed, persuasive, each " +
      'line lifting on a lilt of opportunity. Age 50s, unhurried. Male.',
    sampleText:
      'Step right up, friend — buy from every adventurer in the realm, or lay out your wares and let the coin come find you.',
  },
  {
    npcId: 'marshal_redbrook',
    name: 'Marshal Redbrook',
    voiceDescription:
      'Weathered military baritone, clipped and grave, gravel under every word. Low, steady, ' +
      'weary authority — short, hard sentences, no wasted breath. Age 50s, granite-firm. Male.',
    sampleText:
      "Keep your blade close and your eyes open. The Vale is not what it was — and I've buried good men who forgot it.",
  },
  {
    npcId: 'trader_wilkes',
    name: 'Trader Wilkes',
    voiceDescription:
      "Bright, chatty everyman tenor — friendly, quick, faintly nasal. Cheerful grocer's patter, " +
      'open vowels, easy laugh in the throat. Age 40s. Male.',
    sampleText: 'Fresh bread, clean water, fair prices — now what can I get for you today, eh?',
  },
  {
    npcId: 'apothecary_lin',
    name: 'Apothecary Lin',
    voiceDescription:
      'Soft, careful alto — precise, slightly hushed, measuring both herbs and words. Cool, ' +
      'smooth, faint cautionary edge. Age 30s–40s. Female.',
    sampleText:
      'Tread carefully in the eastern woods... not everything that blooms there means you well.',
  },
  {
    npcId: 'brother_aldric',
    name: 'Brother Aldric',
    voiceDescription:
      'Resonant, sorrowful clergyman — warm baritone, worn and reverent, carrying old grief. ' +
      'Measured, compassionate, a tightening hush of dread beneath the devotion. Age 60s, ' +
      'devout, haunted. Male.',
    sampleText:
      'The Light keep you, child. Even the dead find no rest here of late — and I fear the mountain is listening.',
  },
  {
    npcId: 'smith_haldren',
    name: 'Smith Haldren',
    voiceDescription:
      'Big, booming, smoke-roughened bass — chest-deep, half-shouted over a forge. Blunt warmth, ' +
      'consonants hammered like hot steel. Age 40s–50s. Male.',
    sampleText:
      "Mind the sparks! Good steel's the difference between a scar and a grave — so don't skimp, eh?",
  },
  {
    npcId: 'fisherman_brandt',
    name: 'Fisherman Brandt',
    voiceDescription:
      'Creaky, salt-cured old sailor — raspy, sing-song, wandering. Quavering with age and ' +
      'sea-wind, muttering odd gurgling asides. Slow, briny. Age 70s. Male.',
    sampleText:
      "Grlmurlgrl— ahh, sorry, lad, been listenin' to them fish-men too long down by the water.",
  },
  {
    npcId: 'foreman_odell',
    name: 'Foreman Odell',
    voiceDescription:
      "Gruff, dust-choked working-man's growl — loud, exasperated, blunt. Flattened vowels, " +
      'short temper. Age 50s. Male.',
    sampleText:
      "The whole dig's crawlin' with those candle-headed vermin — and I want 'em GONE, you hear?",
  },

  // -- Mirefen Marsh -------------------------------------------------------
  {
    npcId: 'warden_fenwick',
    name: 'Warden Fenwick',
    voiceDescription:
      "Low, watchful baritone — slow, deliberate, damp-cool and grim. Dry survivor's humor " +
      'underneath. Age 40s–50s. Male.',
    sampleText:
      "Hold at the gate. Past those reeds, the fen does the killing for us — and it's never short of work.",
  },
  {
    npcId: 'provisioner_hale',
    name: 'Provisioner Hale',
    voiceDescription:
      "Wry, rough-and-ready quartermaster's tenor — practical, dry-witted, worn at the edges. " +
      'Brisk, sardonic. Age 40s. Male.',
    sampleText:
      'Dry boots, dry bread, dry powder — and at Fenbridge, you get two of the three on a good day.',
  },
  {
    npcId: 'herbalist_yara',
    name: 'Herbalist Yara',
    voiceDescription:
      'Low, earthy contralto — slow, knowing, a marsh-witch reading the thicket. Husky, grounded, ' +
      'faintly ominous. Age 40s–50s. Female.',
    sampleText:
      'Mind the thicket west of the road... the webs hang thick as sailcloth this season.',
  },
  {
    npcId: 'scout_maren',
    name: 'Scout Maren',
    voiceDescription:
      'Quick, low, hushed — a ranger just above a whisper, clipped and urgent, half-listening to ' +
      'the treeline. Taut, breathless. Age 20s–30s. Female.',
    sampleText:
      "Quiet feet, short blade — that's what keeps you breathing out here. Speak quick, I'm due back in the reeds.",
  },

  // -- Thornpeak Heights ---------------------------------------------------
  {
    npcId: 'captain_thessaly',
    name: 'Captain Thessaly',
    voiceDescription:
      'Commanding, wind-scoured contralto — proud, resolute, two centuries of duty in the tone. ' +
      'Cold air, steel resolve, a faint tremor beneath. Age 40s. Female.',
    sampleText:
      'Two hundred years this wall has held — and it will not break on my watch, though I feel it groan.',
  },
  {
    npcId: 'quartermaster_bree',
    name: 'Quartermaster Bree',
    voiceDescription:
      'Brisk, no-nonsense mezzo — overworked, dryly funny, rattling off inventory like a sergeant. ' +
      'Tired smirk behind the words. Age 30s–40s. Female.',
    sampleText:
      "Wool, hardtack, steel-shod boots — Highwatch runs on all three, and I'm short of every blessed one.",
  },
  {
    npcId: 'armorer_hode',
    name: 'Armorer Hode',
    voiceDescription:
      'Deep, curt, forge-hardened bass — fewer words, harder edges. Cold-mountain gruffness over ' +
      'banked heat. Age 50s. Male.',
    sampleText: "Forge is hot, grindstone's turning. If it cuts — I sell it. Simple as that.",
  },
  {
    npcId: 'loremaster_caddis',
    name: 'Loremaster Caddis',
    voiceDescription:
      "Dry, curious scholar's tenor — precise, slightly distracted, alight with intellectual " +
      'hunger and a thread of unease. Age 50s–60s. Male.',
    sampleText:
      'Mind the loose shale. The mountain has been... restless of late — and I intend to learn precisely why.',
  },

  // -- Glimmermere Temple --------------------------------------------------
  {
    npcId: 'tidewatcher_ondrel',
    name: 'Ondrel Vane',
    voiceDescription:
      'Hushed, haunted, faintly hypnotic — quiet awe drifting like tide-water, an eerie sleepless ' +
      'edge. Slow, lulling, otherworldly. Age 30s–40s. Male.',
    sampleText:
      "The mere drinks the moonlight... and gives back the drowned. Thirty nights I've watched that gate — and tonight, it is open.",
  },

  // -- Abandoned Crypt raid (PR #665) --------------------------------------
  {
    npcId: 'nythraxis',
    name: 'Nythraxis, Scourge of Thornpeak',
    voiceDescription:
      'A monstrous undead tyrant-king risen from the crypt — a vast, cavernous bass, slow and ' +
      'imperious, grinding like a tomb door over stone. Two centuries of grief twisted into mad, ' +
      'regal cruelty; the cold echo of a dead throne room behind every word. Commanding, contemptuous, ' +
      'unhurried, with a guttural rasp of decay. Age ancient. Male.',
    sampleText:
      'I built a kingdom that should have outlived the stars. Kneel before your king. Another kingdom comes to challenge me — and you too will join the rest.',
  },

  // -- Eldergleam, the Veiled Hollow (src/sim/content/realm.ts) -------------
  {
    npcId: 'keeper_saelwyn',
    name: 'Keeper Saelwyn',
    voiceDescription:
      'Ageless keeper of a sealed elven hollow: a cool, luminous contralto, unhurried to the ' +
      'point of strangeness, every word placed like a stone in still water. Courteous, remote, ' +
      'faintly sorrowful, the calm of someone who has outlived several human centuries and ' +
      'expects to outlive several more. Never raises her voice. Female, age unreadable.',
    sampleText:
      'Few of your kind have stood beneath these boughs. Walk gently, and be welcome. The Hollow ' +
      'has perhaps a season before the tear becomes a rift, so we have work to do, you and I.',
  },
  {
    npcId: 'loremother_bryn',
    name: 'Loremother Bryn',
    voiceDescription:
      'Elder shrine-keeper in parchment robes: a warm, softly worn alto, hushed the way a voice ' +
      'goes hushed inside a chapel. Patient, kindly, listening even while she speaks. Reverent ' +
      'about small things (a cleansed heart, a mote of starlight) and gently insistent that grim ' +
      'work is still mending work. Age 60s to 70s. Female.',
    sampleText:
      'Every light in this valley remembers something. Help me listen. It is grim work, but it ' +
      'is mending work, and the rings in the north are singing again tonight. Quietly, but singing.',
  },
  {
    npcId: 'provisioner_fenna',
    name: 'Provisioner Fenna',
    voiceDescription:
      'Village provisioner in soft green: a bright, generous mezzo with an open smile in it, ' +
      'brisk market cadence, always half a beat ahead of the customer. Uncomplicated warmth, ' +
      'quick to laugh at her own sales patter. Age 30s to 40s. Female.',
    sampleText:
      'Bread still warm, water still sweet. The Hollow provides, and so do I. The night market ' +
      'can open again, and you have a customer for life, or at least a discount.',
  },
  {
    npcId: 'huntsman_deral',
    name: 'Huntsman Deral',
    voiceDescription:
      'Herd-warden in moss and leather, built like the scout he is: a low, breath-controlled ' +
      'murmur pitched to carry three paces and no further, consonants soft so nothing spooks. ' +
      'Steady, weathered, reluctant to say a hard thing aloud, and heavier when he does. ' +
      'Age 40s to 50s. Male.',
    sampleText:
      'Quiet now. The herd knows every sound this valley makes, and so do I. The second name is ' +
      'harder to say. End him with mercy, and bring a friend to share the weight of it.',
  },
  {
    npcId: 'archivist_tullo',
    name: 'Archivist Tullo',
    voiceDescription:
      'Ancient robed archivist, pale violet, knees long since gone: a thin, papery, high-set ' +
      'old tenor that cracks upward with delight the instant a fact clicks into place. Fussy, ' +
      'digressive, gleefully pedantic; two centuries of dust in the throat and a scholar boy ' +
      'still bouncing underneath it. Age 80s. Male.',
    sampleText:
      'The monuments out there have not spoken to anyone in an age. Perhaps they were waiting ' +
      'for fresh ears. Look at the striations! Autumn. The Hollow was sealed in autumn.',
  },
  {
    npcId: 'wardsmith_orun',
    name: 'Wardsmith Orun',
    voiceDescription:
      'Smith of forges that went cold centuries ago, in dusty violet: a deep, quiet, close-mic ' +
      'bass, all chest and no volume, the reverence of a man working in a room he considers a ' +
      'tomb. Slow, spare, every sentence sounding like it was decided on years in advance. ' +
      'Age 50s to 60s. Male.',
    sampleText:
      'These forges cooled centuries ago, but their work still holds an edge. Bring me good ' +
      'metal and I will show you what the old hands knew, and what they took with them.',
  },

  // -- Eastbrook Vale, later arrivals (src/sim/content/zone1.ts) ------------
  {
    npcId: 'bursar_fernando',
    name: 'Bursar Fernando',
    voiceDescription:
      'Vault bursar of a gilded bank house, dressed in gold: a silken, discreet baritone with a ' +
      'faint continental polish, every vowel buffed. Impeccably courteous, quietly pleased with ' +
      'the strength of his own locks, never hurried and never quite warm. Age 40s to 50s. Male.',
    sampleText:
      'Welcome to the Gilded Strongbox. Your goods rest safe behind our locks. Every crate, ' +
      'coffer, and trinket is counted twice, and the ledger closes clean each evening.',
  },
  {
    npcId: 'card_master',
    name: 'Card Master',
    voiceDescription:
      'Robed dealer of a card game, deep purple, a carnival showman at heart: a sly, theatrical ' +
      'mid-tenor that lifts on every offer, shuffling its own consonants. Playful, insinuating, ' +
      'delighted either way by how the hand falls. Age 30s to 40s. Male.',
    sampleText:
      'Care for a Card Duel? Best of three, winner takes the bragging rights. No coin needed, ' +
      'friend, only nerve, and you look to me like someone with a little to spare.',
  },
  {
    npcId: 'chronicler_saul',
    name: 'Saul the Chronicler',
    voiceDescription:
      'Amber-robed keeper of the deeds ledger: a warm, rounded, avuncular baritone, fireside ' +
      'storyteller cadence, savouring the shape of a good sentence. Fond of the adventurer in ' +
      'front of him and openly proud to write them down. Age 50s. Male.',
    sampleText:
      'Every deed worth doing is worth writing down twice: once for the ledger and once for the ' +
      'fireside. Come, tell it slowly, and I will spell your name the way you want it spelled.',
  },
  {
    npcId: 'cook_marlow',
    name: 'Cook Marlow',
    voiceDescription:
      'Master of a busy keep kitchen, ochre and flour-dusted: a hearty, food-warm bass-baritone, ' +
      'half-shouted over pans and then dropping to confide. Bluff generosity, brisk, feeds you ' +
      'before he answers you. Age 40s to 50s. Male.',
    sampleText:
      'Nothing leaves my kitchens half-cooked. Sit, eat, then get back out there. Now that is a ' +
      'full pantry. Here is your pay, and come back when your bags are heavy again.',
  },
  {
    npcId: 'forgemistress_darva',
    name: 'Forgemistress Darva',
    voiceDescription:
      'Mistress of the town forge, ember orange: a strong, iron-hard contralto pitched over a ' +
      'working fire, deliberate as a hammer stroke, no ornament anywhere in it. Demands an oath ' +
      'before she teaches, and means every clause of it. Age 40s. Female.',
    sampleText:
      'The forge answers to me. Bring good ore and it will answer to you too. Steel does not ' +
      'forgive a wandering hand, so I will tell you plain before you swear anything.',
  },
  {
    npcId: 'groundskeeper_bram',
    name: 'Groundskeeper Bram',
    voiceDescription:
      'Keeper of the village sporting field, deep field green: a broad, weather-cured country ' +
      'baritone, gruff and grinning, the tone of a man who referees a rough game and enjoys it. ' +
      'Rolling rural vowels, easy laugh, firm on the rules. Age 40s to 50s. Male.',
    sampleText:
      'The truce holds at the Sowfield: boots and shoulders only. Care to play for the Copper ' +
      'Pail? Mind the rules and mind your elbows, and we will get along famously.',
  },
  {
    npcId: 'tinker_gizzel',
    name: 'Tinker Gizzel',
    voiceDescription:
      'Manic toolworks tinker in brass, apron full of things that tick: a fast, high, crackling ' +
      'voice that trips over itself, doubling words, spiking into sudden shouted capitals and ' +
      'dropping to a conspiratorial hiss. Giggling, gleeful, faintly unsafe. Age indeterminate, ' +
      'reads as small and wiry. Male.',
    sampleText:
      'Springs, sprockets, and sharp edges: the toolworks has whatever your hands lack. Oh, oh, ' +
      'you want the good stuff, the loud stuff, yes? Listen, listen, before you touch anything ' +
      'that ticks!',
  },
  {
    npcId: 'weaver_ottilie',
    name: 'Weaver Ottilie',
    voiceDescription:
      'Master of the loom in deep violet robes: a precise, cool mezzo, unhurried, each phrase ' +
      'measured out to length before it is spoken. Quietly exacting, faintly maternal to anyone ' +
      'who works carefully, unimpressed by strength. Age 40s to 50s. Female.',
    sampleText:
      'Mind the threads. A steady hand at the loom beats a strong one. Measure the cost before ' +
      'you cut, that is the first rule here, and measure twice before you wander.',
  },

  // -- Mirefen Marsh, later arrivals (src/sim/content/zone2.ts) -------------
  {
    npcId: 'bursar_petra_vell',
    name: 'Bursar Petra Vell',
    voiceDescription:
      'Marsh-town vault bursar in bank gold: a crisp, prim mezzo, consonants filed clean, the ' +
      'clipped efficiency of someone who audits for pleasure. Polite, bloodless, faintly proud ' +
      'of how little she says. Age 30s to 40s. Female.',
    sampleText:
      'The Gilded Strongbox keeps clean ledgers and cleaner vaults. What shall we stow for you? ' +
      'Name the items, and I will name the fee, and neither of us need repeat ourselves.',
  },
  {
    npcId: 'chronicler_osric_fenn',
    name: 'Chronicler Osric Fenn',
    voiceDescription:
      'Chronicler posted to a swamp garrison, damp green: a dry, bookish tenor with a resigned ' +
      'wit, sighing slightly on the long vowels. Fastidious about paper, wry about the fen, ' +
      'never quite dry himself. Age 40s. Male.',
    sampleText:
      'Mind the damp on the pages. The fen eats more books than readers ever will. Speak your ' +
      'deeds slowly and I will get them down before the ink runs, which it will.',
  },
  {
    npcId: 'tanner_hesk',
    name: 'Tanner Hesk',
    voiceDescription:
      'Tannery master in dark leather brown: a flat, gravelled, extremely terse working voice, ' +
      'sentences of four words, no music in them at all. Not unfriendly, simply finished ' +
      'talking. Faint rasp of lye and hide-smoke. Age 40s to 50s. Male.',
    sampleText:
      'A hide is only as good as its tanning. The vats are ready when you are. Vats are empty. ' +
      'Bring eight rough hides. Coin when you do. Good hides. Fair pay.',
  },

  // -- Thornpeak Heights, later arrivals (src/sim/content/zone3.ts) ---------
  {
    npcId: 'alchemist_verane',
    name: 'Alchemist Verane',
    voiceDescription:
      'Apothecary master in cold teal robes: a clipped, cool, fastidious alto, immaculate ' +
      'diction, faintly condescending in the way of someone who is usually right about purity. ' +
      'Withholding praise as a matter of policy. Age 30s to 40s. Female.',
    sampleText:
      'Measure twice and pour once. The apothecary has no patience for spilled reagents. ' +
      'Acceptable. Potent, and properly handled. Do not let it go to your head, that is a ' +
      'different reagent.',
  },
  {
    npcId: 'auctioneer_voss',
    name: 'Auctioneer Voss',
    voiceDescription:
      'Mountain-branch auctioneer in market violet: a quick, bright, city-slick tenor running ' +
      'auction patter, lighter and younger and more mercenary than the old crier of the Vale. ' +
      'Practised charm, always mid-pitch. Age 30s. Male.',
    sampleText:
      'The World Market is open here too. Buy from every adventurer in the realm, or set out ' +
      'your own wares, and let the coin come and find you where you stand.',
  },
  {
    npcId: 'bursar_aldous_crane',
    name: 'Bursar Aldous Crane',
    voiceDescription:
      'Elderly vault bursar in bank gold: a thin, dry, fussily precise old tenor, the vowels ' +
      'narrow, the pace of a man reading a receipt aloud. Scrupulously polite, mildly pained by ' +
      'imprecision. Age 70s. Male.',
    sampleText:
      'Every crate, coffer, and trinket is safe with the Gilded Strongbox. Counted in, counted ' +
      'out, and signed for in the proper column, which is more than most houses manage.',
  },
  {
    npcId: 'chronicler_edda_hartwell',
    name: 'Chronicler Zenzie',
    voiceDescription:
      'Young chronicler of the peaks in cold blue: a brisk, bright, forward-leaning mezzo, ' +
      'quick-tongued and openly eager for a good story, pen already moving. Sharp memory worn ' +
      'lightly. Age 20s to 30s. Female.',
    sampleText:
      'The mountain forgets nothing, and neither do I. Let us see what you have done. Slowly, ' +
      'now, and in order, because I intend to get all of it down exactly as it happened.',
  },
  {
    npcId: 'heroic_quartermaster',
    name: 'Quartermaster Vex',
    voiceDescription:
      'Quartermaster of the heroic depths, deep purple: a low, flat, unimpressed male baritone, ' +
      'entirely without warmth, the boredom of someone who has watched better adventurers fail ' +
      'the same trial. Short sentences, no encouragement offered. Age 40s. Male.',
    sampleText:
      'Proof of the heroic depths buys the finest rings and pendants in Highwatch. Show me your ' +
      'marks. Marks, not stories. The depths do not care what you meant to do down there.',
  },
  {
    npcId: 'stablemaster_marla',
    name: 'Marla Hitchen',
    voiceDescription:
      'Stablemaster in saddle brown, teaching a riding trial: a brisk, weathered horsewoman with ' +
      'a drill instructor bark and real fondness under it, barking corrections and grinning at ' +
      'the same time. Open-air volume, dust in the throat. Age 40s. Female.',
    sampleText:
      'Every rider walks in on two legs. I will not hand you the reins until you can sit the ' +
      'Valorsteed without kissing the dirt, and the Galecrest wind shows no mercy to a bad seat.',
  },

  // -- Frostveil Reach, Icemantle (src/sim/content/frostveil.ts) ------------
  {
    npcId: 'warden_kaldra',
    name: 'Warden Kaldra',
    voiceDescription:
      'Warden of a snowbound mountain village, pale steel blue: a hard, low contralto scoured ' +
      'flat by wind, stoic to the edge of grim, warming perhaps a quarter-inch when the news is ' +
      'good. Short breaths, cold-tightened consonants, a grandmother-deep sense of duty to the ' +
      'post. Age 40s to 50s. Female.',
    sampleText:
      'Mind the benches, stranger. The snow keeps what it takes. But howlers do not leave the ' +
      'peaks for nothing. Something up there moved them, and I fear it has a name.',
  },
  {
    npcId: 'hearthkeeper_maeve',
    name: 'Hearthkeeper Maeve',
    voiceDescription:
      'Keeper of a lodge fire in the far north, warm amber: a round, generous, motherly alto with ' +
      'the crackle of woodsmoke in it, pulling you in out of the cold before she asks your name. ' +
      'Practical kindness, fond exasperation, never sentimental. Age 50s. Female.',
    sampleText:
      'Come in off the cold. The lodge fire never goes out, so long as I draw breath. Fur like ' +
      'this is the only argument winter listens to, and you have bought us a whole winter of mercy.',
  },
  {
    npcId: 'scout_einna',
    name: 'Scout Einna',
    voiceDescription:
      'Young snowline scout at a waycamp, frost blue: a clipped, cold-bitten young female voice, ' +
      'brisk and slightly breathless from the altitude, clamping down on the vowels to keep the ' +
      'wind out. Blunt, efficient, quietly impressed. Age 20s. Female.',
    sampleText:
      'You walked the pass alive. Good. Icemantle should hear of it. Every soul who climbs out of ' +
      'the Drakelands passes my fire, and fewer climb every week.',
  },
  {
    npcId: 'aurorist_veyla',
    name: 'Aurorist Veyla',
    voiceDescription:
      'Solitary reader of the aurora, pale violet: a hushed, breathy, half-entranced female voice, ' +
      'slow and lifted, listening to the sky between phrases. Otherworldly calm over real fear, ' +
      'shushing you mid-sentence. Age 30s to 40s. Female.',
    sampleText:
      'Hush. The lights are speaking tonight, and they do not repeat themselves. Look at them: ' +
      'they pulse in time with each other. The lights are not weather. They are a signal.',
  },
  {
    npcId: 'trapper_brosk',
    name: 'Trapper Brosk',
    voiceDescription:
      'Old fen trapper in drab olive, twenty years on the same lines: a craggy, cold-roughened ' +
      'old male voice, laconic, with a short dry laugh that arrives instead of a sentence. ' +
      'Stubborn, unsentimental, secretly rattled. Age 60s. Male.',
    sampleText:
      'Fen took three of my lines this week. Fen never took a line in twenty years. Ha. Eleven ' +
      'years and the woman still thinks the fen will eat me. Well, this year she might be right.',
  },

  // -- The Drakelands, Wyrmwatch (src/sim/content/drakelands.ts) ------------
  {
    npcId: 'gatecaptain_brannoc',
    name: 'Gatecaptain Brannoc',
    voiceDescription:
      'Commander of a forty-year desert gate fort, brick red: a hard-baked military baritone with ' +
      'ash in the throat, parade-ground projection held down to a growl, absolutely immovable. ' +
      'Repeats himself for emphasis, never for doubt. Age 50s. Male.',
    sampleText:
      'Wyrmwatch holds the gate. Has held it forty years. It will hold it tonight. Ten fewer ' +
      'blades in the dunes, and the muster fires burned lower. My sentries slept. Well cut.',
  },
  {
    npcId: 'quartermaster_sela',
    name: 'Quartermaster Sela',
    voiceDescription:
      'Garrison stores keeper in dun gold: a practical, slightly tired mezzo running an inventory ' +
      'cadence, warm underneath the brusqueness, protective of her drivers. Dust-dry humour ' +
      'about very grim things. Age 30s to 40s. Female.',
    sampleText:
      'Every crate in this yard crossed forty miles of ash to get here. Treat them kindly. Eight, ' +
      'and my drivers have stopped writing farewell letters before every run.',
  },
  {
    npcId: 'scout_yerrin',
    name: 'Scout Yerrin',
    voiceDescription:
      'Scout a month alone on a ridge above an enemy gate, dune tan: a low, dry, hyper-alert ' +
      'female murmur, sun-cracked lips, breaking off to listen. Speaks in intelligence, not ' +
      'opinion, and keeps the fear underneath the report. Age 30s. Female.',
    sampleText:
      'Keep low. Sound carries strangely off the glass, and the gate below has ears. Count the ' +
      'war-banners in front of it, and you will understand why I stopped writing things down.',
  },

  // -- The Wraithwood, Gallowmere (src/sim/content/wraithwood.ts) -----------
  {
    npcId: 'sexton_marrow',
    name: 'Sexton Marrow',
    voiceDescription:
      'Sexton of a graveyard village that rings its dead down, slate grey: a deep, measured, ' +
      'sepulchral bass, patient as a tolling bell, kindly in a way that never stops sounding ' +
      'like a funeral. Takes duty to the buried and the living as one job. Age 50s to 60s. Male.',
    sampleText:
      'We bury them deep here, and we ring the bells so they remember to stay down. Gallowmere ' +
      'keeps its people, that is the whole of our law. Mind the bells.',
  },
  {
    npcId: 'lampman_cobb',
    name: 'Lampman Cobb',
    voiceDescription:
      'Old lamplighter at a haunted wood gate, lantern gold: a soft, kindly, careful old male ' +
      'voice, quiet on purpose, the tone of someone who has kept a light burning for thirty years ' +
      'and does not want to attract attention. Gentle warning under every phrase. Age 60s. Male.',
    sampleText:
      'Stay in the lamplight, friend. The wood counts everyone who passes the gate. Go and be ' +
      'counted, before the wood counts you itself.',
  },
  {
    npcId: 'vicar_creel',
    name: 'Vicar Creel',
    voiceDescription:
      'The last vicar of a collapsed chapel, grey-green: a weary, hollowed-out clergyman tenor, ' +
      'the liturgy worn out of it, arid gallows calm where the comfort used to be. Honest, ' +
      'unillusioned, done pretending prayer will finish the job. Age 50s. Male.',
    sampleText:
      'The chapel fell years ago. The dead beneath it did not notice, and so I stayed. I will not ' +
      'call it a mercy in daylight, but between us, it was one.',
  },
  {
    npcId: 'widow_tansy',
    name: 'Widow Tansy',
    voiceDescription:
      'Grave-candle maker in pale mourning mauve: a brittle, tremulous old female voice that ' +
      'thins upward when she insists, with unbending iron directly underneath the shake. ' +
      'Ferocious about the candles, tender about the dead. Age 70s. Female.',
    sampleText:
      'A candle for every grave, and not one may go out. Not one, do you hear me? All four ' +
      'burning? Then breathe. The bells rang easier the moment the last wick caught.',
  },

  // -- The Evergarden, Hedgewick (src/sim/content/evergarden.ts) ------------
  {
    npcId: 'gatewarden_pell',
    name: 'Gatewarden Pell',
    voiceDescription:
      'Warden of a garden gate in moss green: a mild, dutiful, slightly nervy male voice, polite ' +
      'to a fault, glancing over his shoulder at the hedges mid-sentence. Reports the same ' +
      'unsettling thing every week without ever getting used to it. Age 30s to 40s. Male.',
    sampleText:
      'Mind how you go on the lawns. The garden keeps them trimmed, and it likes them tidy. Tell ' +
      'her another traveler has come through, and tell her the hedges by the gate moved last night.',
  },
  {
    npcId: 'head_gardener_amaranth',
    name: 'Head Gardener Amaranth',
    voiceDescription:
      'Head gardener who has not slept properly in ten years, dusty rose: a frayed, soft, ' +
      'over-precise female voice worn thin at the edges, drifting and then catching itself. ' +
      'Exhausted competence, dread kept behind bookkeeping. Age 40s. Female.',
    sampleText:
      'Do not mind the shadows under my eyes. Someone has to stay awake while the garden dreams. ' +
      'It should feel like gardening. Why does it feel like war?',
  },
  {
    npcId: 'wickmother_sorrel',
    name: 'Wickmother Sorrel',
    voiceDescription:
      'Innkeeper of a hamlet inn, warm terracotta: a bustling, hospitable older female voice, ' +
      'round and busy, seating you and pouring for you while she talks. Cheerful indignation at ' +
      'thieving garden gnomes; unbothered by anything larger. Age 50s. Female.',
    sampleText:
      'Come in, sit, there is cordial on the fire. Just keep a hand on anything iron: the gnomes ' +
      'are light-fingered of late. Warm hands make steady shears.',
  },
  {
    npcId: 'gardener_yew',
    name: 'Gardener Yew',
    voiceDescription:
      'The last gardener, a hundred years on the same lawns, deep green: a very old, earthy, ' +
      'unhurried male voice, mossy and low, so calm it becomes uncanny. Speaks of the garden as ' +
      'a colleague and of his own masterwork as something that must now be unmade. Age 90s, or ' +
      'older than that. Male.',
    sampleText:
      'Hand me that barrow, would you? These lawns do not walk themselves, whatever the hamlet ' +
      'thinks. The garden is afraid. In a hundred years I have never once known it afraid.',
  },

  // -- The Nightbloom, Moonrest (src/sim/content/nightbloom.ts) -------------
  {
    npcId: 'lamplighter_sorrel',
    name: 'Lamplighter Sorrel',
    voiceDescription:
      'Keeper of the lamps on a road into a sunless realm, lamp gold: an easy, wry, low male ' +
      'voice with a night-shift calm to it, unhurried, quietly amused by newcomers squinting at ' +
      'a sky that never brightens. Age 40s. Male.',
    sampleText:
      'Mind the lamps, friend. Past this gate the sun gives up and the flowers take over. Up here ' +
      'the sun never follows, only the lamps I keep lit along the climb.',
  },
  {
    npcId: 'lira_dewsong',
    name: 'Lira Dewsong',
    voiceDescription:
      'Night-gardener of a village lit by flowers, pale silver-green: a gentle, lilting female ' +
      'voice with a silvered evening softness, welcoming and a little dreamlike, phrases falling ' +
      'like a lullaby without ever losing their sense. Age 30s. Female.',
    sampleText:
      'Welcome to Moonrest, where the flowers do our dawning for us. Cut them gently: a bed ' +
      'remembers a rough hand for a season.',
  },
  {
    npcId: 'weaver_amelle',
    name: 'Weaver Amelle',
    voiceDescription:
      'Weaver of moonfleece, near-white silver: a soft, breathy young female voice that goes ' +
      'delighted and hushed at the feel of good wool, sensory and close-in, almost confiding. ' +
      'Age 20s to 30s. Female.',
    sampleText:
      'Feel that? Moonfleece on the loom. Warmer than any fire you have sat beside. Silver as ' +
      'starlight and twice as soft.',
  },
  {
    npcId: 'astronomer_cassian',
    name: 'Astronomer Cassian',
    voiceDescription:
      'Sleepless astronomer at a ring of star-carved stones, lavender: a whispering, precise male ' +
      'tenor, wonderstruck and increasingly alarmed, shushing you and then rushing on. Scholarly ' +
      'exactness stretched over a month without proper sleep. Age 40s. Male.',
    sampleText:
      'Hush now. The sky never dawns here, so it never stops talking either. Every bearing has ' +
      'crept toward the Sleepless Barrow, as if the sky itself leans over that mound to watch.',
  },

  // -- The Amberfall, Lanternmere (src/sim/content/amberfall.ts) ------------
  {
    npcId: 'waywatcher_sorrel',
    name: 'Waywatcher Sorrel',
    voiceDescription:
      'Shrine-keeper watching a mountain pass down into a golden weald, tan and buckskin: a hardy, ' +
      'laconic female voice, wind-worn and level, greeting travellers in short measured lines. ' +
      'Warm but sparing, used to her own company. Age 30s to 40s. Female.',
    sampleText:
      'Snow behind you, gold ahead. Few walk the Goldmelt twice, so make the crossing count. Take ' +
      'the gold road down to the town, and tell her the pass is quiet.',
  },
  {
    npcId: 'reeve_ottoline',
    name: 'Reeve Ottoline',
    voiceDescription:
      'Reeve of a harvest town in lantern amber: a brisk, capable, dryly amused older female ' +
      'voice, civic and unflappable, handing out work like a woman with a list already in hand. ' +
      'Fond of the town, blunt about its troubles. Age 50s. Female.',
    sampleText:
      'Welcome to Lanternmere, where the harvest never ends and neither does the work. Be welcome, ' +
      'and the lanterns burn for you. The lamplighters send their thanks.',
  },
  {
    npcId: 'orchardist_pomeline',
    name: 'Orchardist Pomeline',
    voiceDescription:
      'Orchardist of ancient sap-gold rows, olive green: a tart, proprietary older female voice, ' +
      'clipped and territorial, prickly toward town officials and grudgingly warm to anyone who ' +
      'does the work. Superstitious respect for her own trees. Age 50s to 60s. Female.',
    sampleText:
      'Mind where you step. Every root in these rows is older than the town, and they remember. ' +
      'You have a heavier hand with sprites than I do, and today I am glad of it.',
  },
  {
    npcId: 'ferrymaster_caddow',
    name: 'Ferrymaster Caddow',
    voiceDescription:
      'Ferrymaster on a fogbound lake, slate blue: a low, damp, careful male voice, slow and ' +
      'weighted, dropping quieter for the things the old ferrymen only say ashore. Practical ' +
      'superstition, real worry underneath the calm. Age 50s. Male.',
    sampleText:
      'Fog is on the Mere again. When the lanterns go out on the water, wise folk stay ashore. ' +
      'Ferry lanterns do not go out in water. That is the point of them.',
  },

  // -- The Willowfen, Bridgemere (src/sim/content/willowfen.ts) -------------
  {
    npcId: 'waykeeper_pell',
    name: 'Waykeeper Pell',
    voiceDescription:
      'Waycamp keeper at the steps down into soft fen country, pale willow green: a warm, easy, ' +
      'unhurried female voice, hospitable without fuss, keeping a fire lit through any fog. ' +
      'Gentle caution, no drama. Age 40s. Female.',
    sampleText:
      'Down the Steps and into the soft country. Mind where you plant your boots. A gentle ' +
      'country, the Willowfen, but gentle is not the same as safe.',
  },
  {
    npcId: 'bridgewright_alden',
    name: 'Bridgewright Alden',
    voiceDescription:
      'Bridgewright of a stilt town, timber brown: a solid, practical, grumbling-fond baritone ' +
      'with a carpenter rhythm, proprietary about every plank in town. Complains as a form of ' +
      'affection. Age 40s to 50s. Male.',
    sampleText:
      'Every plank in this town is mine to keep, and the fen chews on all of them. Watch your ' +
      'step on my planks and we will get along fine.',
  },
  {
    npcId: 'netter_maris',
    name: 'Netter Maris',
    voiceDescription:
      'Eel-netter and smokehouse owner, teal and river grey: a quick, chatty female voice with ' +
      'smoke and salt in it, openly proud of what her trade has bought, counting coin out loud. ' +
      'Cheerful mercantile bustle. Age 30s to 40s. Female.',
    sampleText:
      'Smell that? Smoked eel. Half this town stands on stilts I bought with it. The smokehouse ' +
      'will smell like money by morning.',
  },
  {
    npcId: 'mother_sedge',
    name: 'Mother Sedge',
    voiceDescription:
      'Fen-witch camped alone in a willow bend, drab olive: a slow, papery, sing-song old female ' +
      'voice, rustling like dry reeds, drifting off and returning with the answer. Uncanny ' +
      'certainty, kindly, entirely unbothered by her own strangeness. Distinct from the marsh ' +
      'herbalist of Mirefen: older, thinner, more lilting. Age 70s. Female.',
    sampleText:
      'The willows told me you were coming before your boots left the bridge. That sound has a ' +
      'name, and a throat, and I have been waiting for someone fool enough to help me quiet it.',
  },

  // -- The Palmreach, Drifthaven (src/sim/content/palmreach.ts) -------------
  {
    npcId: 'strandwatcher_pell',
    name: 'Strandwatcher Pell',
    voiceDescription:
      'Watcher at the sunny end of a black jungle pass, pale sand: a relieved, sunny, easy male ' +
      'voice, open-throated after the dark trees, welcoming travellers out into the light. ' +
      'Uncomplicated cheer, faint tropical drawl. Age 30s. Male.',
    sampleText:
      'Out of the black trees at last. Breathe, stranger, the sun holds this side of the pass. ' +
      'Follow the shore road north and you will strike Drifthaven before the tide turns.',
  },
  {
    npcId: 'salvage_boss_ryna',
    name: 'Salvage-Boss Ryna',
    voiceDescription:
      'Boss of a wreck-salvage crew, rust orange: a loud, brassy, commanding female voice pitched ' +
      'across a beach, laughing at her own hard jokes, dockside profanity implied but never said. ' +
      'Genuine care for her crews under the volume. Age 30s to 40s. Female.',
    sampleText:
      'A worker with working arms, good. The wreck line pays well, if the crabs leave you enough ' +
      'fingers to count it. Grab a rope, we are short-handed.',
  },
  {
    npcId: 'pearlmother_isha',
    name: 'Pearl-Mother Isha',
    voiceDescription:
      'Elder of a pearl-diving people, seafoam green: a calm, deep, matriarchal older female ' +
      'voice, measured and salt-worn, speaking in proverbs that are also warnings. Unhurried ' +
      'authority; will not be argued with. Age 60s. Female.',
    sampleText:
      'The sea gives, the sand keeps, and the jungle takes. Stay on the strand, stranger. The ' +
      'boars did not choose to come onto the sand. Remember that: something moved them.',
  },
  {
    npcId: 'hermit_okku',
    name: 'Okku',
    voiceDescription:
      'Hermit camped alone under jungle banyans within earshot of drums, deep green: a hushed, ' +
      'cracked male voice, whisper-taut and hyper-attentive, breaking off to count a sound. The ' +
      'only man who walked toward the drums and came back, and it is audible. Age 50s to 60s. Male.',
    sampleText:
      'Quiet now. The drums count everything that walks under the trees, and they have already ' +
      'counted you. The drums are not the danger. They are the warning.',
  },

  // -- The Galecrest, Wickharbor (src/sim/content/galecrest.ts) -------------
  {
    npcId: 'watcher_maren',
    name: 'Watcher Maren',
    voiceDescription:
      'Watcher of a windswept mountain pass, grey-blue: a hardy female voice pitched to be heard ' +
      'over a gale, clipped and wry, half the words snatched away. Weather-hardened good humour, ' +
      'no patience for questions. A different woman from the Marshal scout of the marshes; older, ' +
      'louder, blunter. Age 30s to 40s. Female.',
    sampleText:
      'Mind your footing past the gate. The wind up here takes hats first and questions never. You ' +
      'made the climb, so the wind has decided to keep you.',
  },
  {
    npcId: 'harbormaster_odile',
    name: 'Harbormaster Odile',
    voiceDescription:
      'Harbormaster of a cliff-cove fishing town, deep sea blue: a brisk, salt-worn contralto, ' +
      'commanding and tide-hurried, cutting a greeting short because the water will not wait. ' +
      'Dry coastal praise, given rarely. Age 40s. Female.',
    sampleText:
      'Every boat in this cove owes the Old Beacon its keel. Speak quick, the tide will not wait. ' +
      'The potmen are calling you a good omen. In Wickharbor that is as warm as praise gets.',
  },
  {
    npcId: 'keeper_bram',
    name: 'Keeper Bram',
    voiceDescription:
      'Lighthouse keeper, thirty-nine years on the same lamp, lamp gold: a proud old male voice ' +
      'with a gale-roughened rasp and a quaver he refuses to acknowledge, warm to a visitor who ' +
      'made the climb. Duty spoken as fact, never as complaint. Age 70s. Male.',
    sampleText:
      'Nine and thirty years this lamp has burned on my watch. It will not go dark on yours. Tell ' +
      'her the lamp burns and so do I. You have the makings of a keeper.',
  },
  {
    npcId: 'salvager_edda',
    name: 'Salvager Edda',
    voiceDescription:
      'Lone wreck-beach salvager, driftwood olive: a dry, hard, sardonic female voice, flat and ' +
      'unhurried, quoting salvage law as though she wrote it, which in practice she did. ' +
      'Unimpressed by the walking dead on her own beach. Age 40s. Female.',
    sampleText:
      "Wreckwood, rope, and dead men's cargo. The sea pays my wage, when the Warden lets it. Half " +
      'of this is yours by law, and by law I mean I say so.',
  },

  // -- The Farshore, Gullhaven (src/sim/content/farshore.ts) ----------------
  {
    npcId: 'bellkeeper_tam',
    name: 'Bellkeeper Tam',
    voiceDescription:
      'Keeper of an island watchbell, sea green: a steady, kindly older male voice, bell-clear and ' +
      'carefully paced when he explains the tolls, with a thread of dark humour about the third ' +
      'one. Calm because someone has to be. Age 50s to 60s. Male.',
    sampleText:
      'The bell is the only warning the breaks give us. One toll for the fields, two for the ' +
      'cliffs, three when it is close enough that running will not help. Keep an ear on it.',
  },
  {
    npcId: 'warden_coalfast',
    name: 'Warden Coalfast',
    voiceDescription:
      'Commander of a besieged island redoubt, burnt sienna: a grim, exhausted, resolute baritone, ' +
      'siege-worn and gravelled, spending words like rationed stores. Fierce protectiveness of a ' +
      'small town held under real threat. Age 40s to 50s. Male.',
    sampleText:
      'The breaks do not care that Gullhaven is small. We hold this shore, or there is no shore ' +
      'left to hold. Stand with us and I will not forget it.',
  },
  {
    npcId: 'quartermaster_edda',
    name: 'Quartermaster Edda',
    voiceDescription:
      'Redoubt armorer handing out salvaged steel, olive drab: a blunt, weary, soldierly female ' +
      'voice, heavy and flat, no ceremony at all. Distinct from the wreck-beach salvager of the ' +
      'same name: lower, slower, and more tired. Age 40s to 50s. Female.',
    sampleText:
      'Steel and salt, it is all I have left to hand out. Take it and make the breaks regret ' +
      'opening where I could reach them. Steel for steel: it is the only trade the Farshore runs.',
  },
  {
    npcId: 'mender_saul',
    name: 'Mender Saul',
    voiceDescription:
      'Field surgeon in blood red, setting more bones this month than in ten years: a tired, ' +
      'gentle, precise male voice, clinical wording carried on real compassion, dropping to a ' +
      'quiet request at the end of a sentence. Age 40s. Male.',
    sampleText:
      'I have set more bones this one month than in ten years of mending fishing falls. Come back ' +
      'to me whole, if you can manage it. Do me the kindness of not becoming my next patient.',
  },
  {
    npcId: 'fisher_nell',
    name: 'Frightened Nell',
    voiceDescription:
      'Fisher whose life split open on her own shoreline, pale washed blue: a small, trembling ' +
      'female voice, halting, breaking mid-phrase and starting again, repeating herself the way ' +
      'frightened people do. Turns fierce and tearful with relief at the end. Age 30s. Female.',
    sampleText:
      'It opened right where the nets dry. Right there, where I stood every morning of my life. I ' +
      'do not go down to the shore anymore. I do not go much of anywhere anymore.',
  },
  {
    npcId: 'riftwatch_ollun',
    name: 'Riftwatch Ollun',
    voiceDescription:
      'Scholar who can hear rifts before they open, deep blue: an intense, murmuring male voice, ' +
      'rapid then suddenly still, breaking off to listen and asking you to be quiet too. Precise ' +
      'vocabulary at the edge of raving; entirely sane and entirely alarming. Age 40s. Male.',
    sampleText:
      'Every break sings before it opens, if you have the ear for it. I can hear three of them ' +
      'stirring on the island right now, and one of them is close. The cliffs are singing.',
  },

  // -- Realm services, present in every hub or at every graveyard -----------
  {
    npcId: 'brother_halven',
    name: 'Brother Halven',
    voiceDescription:
      'Reliquary keeper who holds the rope while others go below, near-black habit: a low, hushed, ' +
      'monkish male voice with a subterranean calm, unhurried, close-mic quiet as though the ' +
      'ceiling were low. Steady reassurance, no warmth wasted. Age 40s to 50s. Male.',
    sampleText:
      'The reliquary below has shifted again. Another reliquary, another rite. Choose your tier, ' +
      "and I'll hold the rope until you return.",
  },
  {
    npcId: 'fury',
    name: 'FURY',
    voiceDescription:
      'Honor quartermaster of the arena sands, blood red: a harsh, metallic, half-shouted voice ' +
      'like a herald over a crowd, brutal and clipped, consonants struck rather than spoken. ' +
      'Every line sounds like the announcement of a match. Age 30s to 40s. Male.',
    sampleText:
      'The sands remember every victory. Spend your honor well. Bring me the marks and I will ' +
      'arm you for the next one, because there is always a next one.',
  },
  {
    npcId: 'spirit_healer',
    name: 'The Pale Keeper',
    voiceDescription:
      'Robed warden of the dead at a graveyard, rendered translucent in pale gold: a weightless, ' +
      'breathy, faintly doubled female whisper that seems to arrive from a little further away ' +
      'than she stands. Infinitely gentle, sorrowful, entirely without urgency. Age unreadable. ' +
      'Female.',
    sampleText:
      'Rest now, spirit. I can return you to your body, but the crossing back leaves you weak. Go ' +
      'gently, and do not be in such a hurry to come back to me.',
  },

  // -- Escortees (escort quest barks; keyed through EXTRA_LINES, not an NpcDef)
  {
    npcId: 'fisher_bram',
    name: 'Fisher Bram',
    voiceDescription:
      'Shipwrecked island fisher walked home to his wife: a hoarse, shaken working-man tenor, ' +
      'thin from days on a cold shore, cracking upward with disbelieving joy and then with grief. ' +
      'Plain speech, deep feeling, no composure left. Age 30s to 40s. Male.',
    sampleText:
      'Nell sent you? Then she is alive, oh, thank the tide. Stay close, friend: the little ones ' +
      'comb this stretch of shore, and they are never alone.',
  },
  {
    npcId: 'apprentice_wren',
    name: 'Apprentice Wren',
    // Cast as a young ADULT apprentice on purpose: the text-to-voice design endpoint
    // refuses a prompt that asks for a child or early-teen voice (403
    // status: blocked_generation), and the content only ever calls her "the girl",
    // which a frightened young woman reads as. Keep any rewrite adult.
    voiceDescription:
      'Young trapping apprentice stranded under road markers in the snow: a light, thin, ' +
      'frightened young adult female voice, breath short with cold and fear, going bright and ' +
      'tumbling with relief the moment she is safe. Age early 20s. Female.',
    sampleText:
      "You'll walk with me? Stay close, please. The wolves have been circling since dusk. The " +
      'lights! We made it, we truly made it.',
  },
  {
    npcId: 'castaway_navigator',
    name: 'Navigator Suli',
    voiceDescription:
      'Ship navigator who swam a reef and is nearly spent, salt-hoarse: a low, rasping female ' +
      'voice, exhausted but proud and still giving directions, refusing to be carried. Wry ' +
      'sailor stubbornness at the end of her strength. Age 30s. Female.',
    sampleText:
      'You came down the wreck line for me? Then let us go before the tide turns. Stay between me ' +
      'and the water, the crabs come from the surf.',
  },
  {
    npcId: 'gravedigger_mosley',
    name: 'Gravedigger Mosley',
    voiceDescription:
      'Village gravedigger who dug himself out of his own collapsed plot: a rattled, prattling ' +
      'older male voice, nervous chatter to keep the wood at bay, dropping to a whisper at the ' +
      'word horn. Comic in daylight, genuinely terrified now. Age 50s to 60s. Male.',
    sampleText:
      "You'll walk with me? Bless you. Keep between me and the trees, and if you hear a horn, we " +
      'run. I am never digging past my knees again, friend.',
  },
];

// Recurring NPC records → the base voice that speaks for them. gen_npc_lines.mjs
// consults this so every Aldric/Maren/Halven zone variant reuses one designed voice.
export const VOICE_ALIAS = {
  brother_aldric_fen: 'brother_aldric',
  brother_aldric_highwatch: 'brother_aldric',
  brother_aldric_raid: 'brother_aldric',
  scout_maren_highwatch: 'scout_maren',
  brother_halven_marsh: 'brother_halven',
};

/** Resolve any NPC content id to the id of the voice that should speak for it. */
export function voiceIdFor(npcId) {
  return VOICE_ALIAS[npcId] ?? npcId;
}
