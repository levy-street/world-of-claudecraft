// i18n source catalog - Clue Scroll prose (world quests, Stage 3): the hunt
// titles and the one riddle per step the quest tracker shows while a hunt is
// active. The sim only ever emits the hunt id and the step index (see
// src/sim/content/clue_hunts.ts and docs/design/clue-scrolls.md); the client
// resolves `clues.<huntId>.title` and `clues.<huntId>.<stepIndex>` here.
// English values only; the locale translations live in
// src/ui/i18n.locales/<lang>.ts (the runtime-authoritative overlays), the five
// non-Latin ones filled in the same change (M16), the Latin ones at release.
//
// Assembled into `en` by ./index.ts under the `clues` namespace. Like
// hud_chrome.ts this module carries NO per-locale blocks (no `as const`), so a
// new hunt's prose is an English-only add that compiles.
//
// Authoring rule: every clue is riddle-like but SOLVABLE on its own. It names
// the landmark's real map label obliquely, the NPC by role and name, the item
// and count plainly, and the emote by its command name; directions read +z as
// north and +x as east, the way the world map is drawn. No coordinates.

export const clueStrings = {
  // The two clue items' tooltip-worthy descriptions.
  items: {
    clue_scroll: {
      desc: 'A sealed riddle earned by finishing every zone slot of the day. Use it to begin a treasure hunt, and use it again on the hidden spot when the last clue says to dig.',
    },
    treasure_casket: {
      desc: 'A locked casket dug up at the end of a treasure hunt. Use it to open it and claim what the hunt buried.',
    },
  },
  hunt_drakelands_gate_ashes: {
    title: 'Ashes at the Gate',
    0: 'The road out of Wyrmwatch runs west into a stand of old trees that guards the gate. Stand beneath the Gatewood and the trail begins.',
    1: 'A far-dune watcher keeps to the eastern sands, north of the garrison. Find Scout Yerrin and ask what the wind carried in.',
    2: 'The keeper of the garrison stores has not eaten since the last patrol. Bring Quartermaster Sela 2 x Cottage Loaf.',
    3: 'East and a little south of where the cinders drift into dunes, a scorched patch of ground hides what the ash buried. Use the scroll there and dig.',
    // What the NPC says once this talk or delivery step is solved.
    reply: {
      1: 'The wind came off the eastern dunes carrying ash, and ash does not blow in from empty sand. Sela at the garrison stores logs every patrol. She will talk, once someone feeds her.',
      2: 'Bread at last, bless you. The patrol swore it saw smoke rising from bare sand, east and a little south of the dunes, where nothing is left to burn.',
    },
  },
  hunt_frostveil_aurora_vigil: {
    title: 'Lights over the Steps',
    0: 'Where the terraces climb toward the lights that dance at night, kneel on the Aurora Steps and let the sky notice you.',
    1: 'The one who reads the lights waits close by the steps. Speak with Aurorist Veyla about what the sky spelled out.',
    2: 'East of the howling terraces, a little to the south, the snow lies flatter than it should. Use the scroll there and dig.',
    // What the NPC says once this talk or delivery step is solved.
    reply: {
      1: 'You knelt, and the lights answered. Last night they bent east past the terraces and pointed straight down at the snow.',
    },
  },
  hunt_amberfall_lantern_ferry: {
    title: 'Lanterns on the Mere',
    0: "At the water's edge north of Lanternmere, the keeper of the lantern ferries knows which light went out. Speak with Ferrymaster Caddow.",
    1: 'A single stone leans against the sky northeast of the great mere, older than the town. Stand at the Leaning Monolith.',
    2: 'The keeper of the gilded rows waters her orchard by hand and thirsts for it. Bring Orchardist Pomeline 3 x Cold Well Water.',
    3: 'Northeast of the rise where the cindermaples burn red, the leaves lie in a circle that no wind made. Use the scroll there and dig.',
    // What the NPC says once this talk or delivery step is solved.
    reply: {
      0: 'One lantern went dark last night, the one that faces the old stone across the water. My ferrymen will not go near it. Perhaps you will.',
      2: 'Cold well water, just what the trees wanted. Up past the red maples the leaves have been falling in a ring, and no tree of mine drops its leaves that neatly.',
    },
  },
  hunt_willowfen_fenwitch_salt: {
    title: "The Fen-Witch's Salt",
    0: 'The fen-witch of Willowweep will not talk to anyone who comes empty-handed. Bring Mother Sedge 1 x Cooking Salt.',
    1: 'Where the fen goes flat and the air makes everyone drowsy, stand on the Drowsy Flats and sigh, as the witch told you.',
    2: 'Southeast of the pools that shine in the bog, a hummock of dry ground stays dry all year. Use the scroll there and dig.',
    // What the NPC says once this talk or delivery step is solved.
    reply: {
      0: 'Salt. Good, you listen. The flats beyond the reeds make everyone drowsy. Go and sigh there like you mean it, and the fen will show you the rest.',
    },
  },
  hunt_nightbloom_sleepless_vigil: {
    title: 'Vigil of the Sleepless',
    0: 'Northeast of Moonrest, where the stones keep a watch that never ends, stand at the Standing Vigil.',
    1: 'The watcher at the vigil counts stars the way others count coins. Speak with Astronomer Cassian about the one that fell.',
    2: 'North of the town lies a barrow whose sleeper never rests. Salute the Sleepless Barrow so the sleeper knows a friend has come.',
    3: 'Southeast of the field where the gloam gathers, the moonlight pools on one bare patch of soil. Use the scroll there and dig.',
    // What the NPC says once this talk or delivery step is solved.
    reply: {
      1: 'A star fell three nights ago, and it fell toward the old barrow north of town. The dead there never sleep. Greet them as a soldier would.',
    },
  },
  hunt_wraithwood_mournstone_candles: {
    title: 'Candles for the Mournstone',
    0: 'The candlewright of Gibbetmere sells light to people who fear the dark. Speak with Widow Tansy about a candle that was never paid for.',
    1: 'The last vicar of the Mournstone has been fasting on prayers alone. Bring Vicar Creel 2 x Salted Jerky.',
    2: 'Northeast of the town, past the crows, a glade hangs its own strange fruit. Stand in the Hanging Glade.',
    3: 'Southeast of the clearing where the huntsman set his snares, the leaf litter has been turned over recently. Use the scroll there and dig.',
    // What the NPC says once this talk or delivery step is solved.
    reply: {
      0: 'The vicar ordered that candle and never paid for it. He has been fasting ever since, praying and nothing else. Take him something to chew and ask him why.',
      1: 'Thank you, friend. I never lit that candle. Something walks the glade past the crows at night, and I could not face it. Go and stand there, if you can.',
    },
  },
  hunt_palmreach_sunken_idol: {
    title: "The Idol's Secret",
    0: 'Deep in the tangle, northwest of the lagoon, the vines pour down like a waterfall. Stand at the Vinefall.',
    1: 'A hermit who went into the tangle and came back out lives close to the falling vines. Speak with Okrim about what he saw down there.',
    2: 'To the east, an idol sits half-drowned and still watching. Cower before the Sunken Idol, the way the hermit said the divers do.',
    3: 'Northeast of where the tangle opens its mouth to the sea, the sand has been heaped higher than the tide reaches. Use the scroll there and dig.',
    // What the NPC says once this talk or delivery step is solved.
    reply: {
      1: 'Below the vines the divers found an idol, and the idol did not like them. Anyone who stood tall before it did not come back. Be small before it.',
    },
  },
  hunt_evergarden_beacon_road: {
    title: 'Beacon and Bloom',
    0: 'The parterre gardener along the walk north of Hedgewick swears her beds are starving. Bring Farmer Verbena 2 x Compost.',
    1: 'In the far southeast corner of the garden, an old mill still turns for no miller. Stand at the Old Mill.',
    2: 'Follow the road south over the border into the Galecrest and out to the coast. The keeper of the old beacon, Keeper Bram, has the last word.',
    3: 'Northwest of the old beacon, just off the path down from the light, the turf has been cut and laid back. Use the scroll there and dig.',
    // What the NPC says once this talk or delivery step is solved.
    reply: {
      0: 'Proper compost, the beds will live. The old miller buried something before he left. His mill still turns in the far corner of the gardens. Go and stand by it.',
      2: 'So the mill sent you down the coast road. The beacon keeps one last secret: northwest of it, just off the path, the turf was cut and laid back. Dig there.',
    },
  },
};
