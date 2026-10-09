// i18n source catalog - the dungeon lore guides' speech and dialog
// (src/sim/dungeon_guide). The sim emits a guide id plus a line id; the client
// resolves `dungeonGuide.<guide>.<key>` here (the guide record's i18nPrefix
// plus the line's key). English values only, identical to each record's own
// `text` (pinned by tests/drowned_temple_cantor.test.ts); the locale
// translations live in src/ui/i18n.locales/<lang>.ts, the five non-Latin ones
// filled in the same change (M16), the Latin ones at release.
//
// Assembled into `en` by ./index.ts under the `dungeonGuide` namespace. Like
// clues.ts this module carries NO per-locale blocks, so a new guide's lines
// are an English-only add that compiles.

export const dungeonGuideStrings = {
  // Laverock, the Last Cantor of the Pale Choir (the Drowned Temple;
  // src/sim/content/drowned_temple_cantor.ts). {name} is his localized name.
  drownedTemple: {
    greet: {
      1: 'I was the youngest voice of the Pale Choir. On the night of the rite I did not drink, and I ran. Every full moon since, I hear them singing under the water. I must see her before I die. Let me walk behind you. I will not fight, and I will not slow you.',
      2: 'Every full moon I come to this gate, and every full moon my nerve fails me. Not tonight. The Choir is singing, and I am the one who ran. Take me down to her, and I will keep out of your way.',
    },
    row: {
      join: 'Come with us.',
      decline: 'We go alone.',
    },
    joined: 'Lead on. I am right behind you.',
    singing: 'Let me sing. Go, and go gently.',
    accept: {
      1: 'Thank you. I will walk behind you, and keep out of your way.',
      2: 'Then I go down at last. Walk on. I will keep up.',
    },
    decline: 'I understand. I will listen from up here, as I always have.',
    heroicWater:
      'The water stands high tonight, higher than I have ever seen it. She is close to waking.',
    memory: {
      votaries:
        'The drowned ones on the shore walked in after the gate closed. The moon never took them, only the water.',
      rubbing:
        "The Tidewatcher read my words on the shore-rock. 'It only sleeps.' I carved them the morning after.",
    },
    area: {
      steps:
        'The Pilgrim Steps. I ran up these that night, three at a time, and never looked back.',
      causeway: {
        1: 'On rite nights the moon lay on this causeway like a second road.',
        2: 'Look at the water. It still remembers how to hold the moon.',
      },
      colonnade: 'The Colonnade of Tides. We walked it two by two, singing the rising verse.',
      veil: 'Past that veil is the Choir Court. I have not stood there since I was a boy.',
      terraces:
        'The tidepools. The novices kept them clean and fed the small bright things living in them.',
      falls: 'Behind the falls the water drowns every voice. I hid here when I skipped practice.',
      pool: 'The moon pool. They knelt round it and drank from their shells. I could not lift mine.',
      prismStair: 'The Prism Stair. We climbed it at moonrise to wake the great glass.',
      moonbridge: {
        1: 'A bridge of moonlight. The elders said only the faithful could cross it.',
        2: 'I was never faithful. Well. We shall see if it holds me.',
      },
      altarLanding: 'This is where I stood. Right here. This is where I turned and ran.',
    },
    sight: {
      pilgrim:
        'The pilgrims of the shore villages. They carried their shrine on their backs every spring. Now they carry it forever.',
      acolyte:
        'The novices. I learned my letters beside them. They sing in their sleep now, and never wake.',
      templeguard:
        'The stair guard. They swore to hold the temple until the moon set. It never set.',
      snapper: 'We drank the moon-water from shells like those. Mine I dropped on the stair.',
      siren: 'That voice. She sang beside me in the choir. She still comes in half a beat early.',
      lurker:
        'The children netted those in the shallows. They were small as a thumb, and they glowed.',
      tidewisp:
        'That is the moon-water itself, the draught we were meant to drink. Do not let it touch you.',
      sentinel:
        'The moon rays of the gate pools. As novices we fed them pearls at moonrise. Now they keep the doors, and wear our pearls as hearts.',
      eel: 'The lagoon eels. The novices fed them bread at dusk. They grew fat on our hymns.',
      reflection: 'It shows you what the water would make of you. Break it!',
      moonspawn: 'Those were never my people. They are hers, made of nothing but moonlight.',
    },
    selthe: {
      pre: {
        1: 'Mother Selthe. She taught me to breathe from the belly. She taught us all to drown without dying.',
        2: 'Choirmother Selthe. Every note I know, she put in me. Forgive me, Mother.',
      },
      post: {
        1: 'She is quiet. In all my years in the Choir, she was never once quiet.',
        2: 'Rest now, Mother. You were right about me. I never could hold the long notes.',
      },
    },
    hydra: {
      pre: 'The pool serpent. When I was a boy it had one head, and it ate from our hands.',
      post: 'Listen. Under the falls they are still singing. Closer now.',
    },
    colossus: {
      pre: 'The great prism. We sang into it to catch the moon. I never knew it could stand.',
      post: 'The glass is broken. Nothing is left to catch the moon now, but her.',
    },
    ysolei: {
      pre: 'There she is. All my life I have asked if she was a goddess or a monster. Show me.',
      preHeroic: 'On a night like this the whole Choir sings with her. Hold fast, all of you.',
    },
    farewell: {
      answer: 'She was neither. She was the moon in the water, and we were the ones who knelt.',
      verse: 'The rite had a last verse, the one that lets the singers sleep. I never sang it.',
      stay: 'They have waited long enough. I will stay, and sing it for them now.',
      goodbye: {
        1: 'Go up into the night. If you hear singing at the full moon, it is only me.',
        2: 'Thank you for bringing an old coward to the end of his song. Go now.',
      },
      emote: '{name} lifts his voice over the altar, and the lagoon falls still.',
    },
    wipe: 'Get up. Please. Do not leave me down here alone again.',
    catchUp: 'My legs are old, but I know every one of these stairs. I am here.',
  },
};
