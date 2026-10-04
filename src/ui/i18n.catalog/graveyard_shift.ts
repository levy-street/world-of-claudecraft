// i18n source catalog - the Graveyard Shift (src/sim/graveyard_shift/): the
// player covers Morthen's shift against adventurer bots. Kit ability names and
// descriptions, the Dread resource and its errors, the chat-log tips, the
// grave and its whisper, Tibbs the union rep's offer, report and lines, and
// the adventurers' say lines (the sim emits `graveyardShift.say.*` and
// `graveyardShift.tibbs.say.*` keys with English fallbacks).
// English values only; the locale translations live in
// src/ui/i18n.locales/<lang>.ts (the runtime-authoritative overlays), the five
// non-Latin ones filled in the same change (M16), the Latin ones at release.
//
// Assembled into `en` by ./index.ts under the `graveyardShift` namespace. Like
// clues.ts this module carries NO per-locale blocks (no `as const`), so an
// English-only add compiles.

export const graveyardShiftStrings = {
  identityAura: 'Morthen the Gravecaller',
  defeatedAura: 'Defeated',
  staffExit: 'Staff Exit',
  adventurerAura: 'Adventurer',
  resource: 'Dread',
  errors: {
    notEnoughDread: 'Not enough Dread!',
    noCorpse: 'There is no corpse to raise.',
  },
  abilities: {
    shadowPulse: {
      name: 'Shadow Pulse',
      description:
        'Release a pulse of shadow that deals {min} to {max} Shadow damage to each enemy within {radius} yards in your line of sight. Each enemy hit is knocked back {distance} yards and slowed by {slow} for {slowSeconds} sec.',
    },
    sextonsChain: {
      name: "Sexton's Chain",
      description:
        'Drag your target to within {stop} yards of you and slow it by {slow} for {slowSeconds} sec. A spell it is casting is interrupted and that school is locked for {lockout} sec, and the target is silenced for {silence} sec.',
    },
    raiseFallen: {
      name: 'Raise the Fallen',
      description:
        'Raise the nearest corpse within {radius} yards as a skeleton that fights for you for {seconds} sec. Each corpse rises only once.',
    },
  },
  // One line per kit ability, shown once per shift when it becomes useful
  // (src/ui/hud/vehicle/morthen_hint_view.ts), as chat log tips.
  hints: {
    chain: "Sexton's Chain: pick one of them and drag them to you. The healer is a fine start.",
    pulse:
      'Shadow Pulse is ready: a heavy blast around you, best with them up close. They can interrupt it. They will try.',
    raise: 'Raise the Fallen: a body lies near. Every corpse is a colleague. Even theirs.',
    exit: 'Shift over. The Staff Exit behind the throne takes you home.',
  },
  // The way in (src/sim/graveyard_shift/grave_entry.ts, grave_staging.ts):
  // the grave, its whisper, and Tibbs the union rep.
  graveName: 'Glowing Grave',
  tibbs: {
    whisper: 'Psst. Down here.',
    offer: {
      intro1:
        "Ah, you heard me. Name's Tibbs. I speak for the monsters of this crypt, the ones you keep meeting at the wrong end of an axe.",
      intro2:
        'Our boss, Morthen, has been killed four thousand eight hundred times this week. Always for the same pair of trousers. Union rules say he has earned a day off, and nobody will cover his shift.',
      intro3:
        'Nobody except you, I hope. It is a simple job: you play the boss. A party of adventurers is already inside. Stop them. They will never notice the difference. Well. They will.',
      accept: 'Take the shift',
      decline: 'Not today',
      thanks: 'Thanks, Tibbs',
    },
    say: {
      accept: 'Wonderful. Mind the bones on the way down. Some of them are colleagues.',
      decline: 'Fair. Nobody reads the job description either.',
      busy: 'Come back when you are not so busy. Union rules.',
      report:
        'Shift report! Adventurers sent home: {sent}. Colleagues saved: {saved}. Trousers not handed out: 1.',
      payout: "Good job and thank you for your help, adventurer. Here's your payout.",
      covered: 'Your shift is covered. Morthen is back at work, and he says thank you.',
      consolation: 'Do not worry. They kill us every day. Welcome to the job.',
      anotherShift: 'Another shift? They certainly will.',
    },
  },
  // The adventurers' say lines (src/sim/graveyard_shift/bot_lines.ts).
  say: {
    clearing: {
      lastPull: 'ok last pack, then boss, then bed',
      stayAway: 'stay away from the boss guys',
      speedUp: 'gtg in 10 min, can we speed up',
      howsMana: "healer how's mana",
    },
    notice: {
      pulledEarly: 'boss pulled early??',
      whoPulled: 'WHO PULLED',
      boredWaiting: 'did the boss just get bored of waiting',
    },
    death: {
      rip: 'rip',
      healerHealer: 'healer?? HEALER??',
      lag: 'lag. that was lag. we all saw it',
    },
    healerOom: {
      oom: 'oom',
      emotionalSupport: "I'm healing with pure emotional support at this point",
    },
    wipeThreat: {
      popEverything: 'pop everything. POP EVERYTHING',
      wedding: "who's been saving a cooldown for their wedding",
      goingBadly: 'this is going badly',
    },
    corpseRun: {
      runningBack: "they're running back, hold on",
      kiteHim: 'just kite him in circles',
      holdHim: "hold him till they're back",
    },
    returned: {
      roundTwo: 'ok round 2, for real this time',
      imBack: "I'm back, did I miss anything",
      knowHisMoves: 'ok I know his moves now',
      revengeTime: 'revenge time',
    },
    giveUp: {
      gn: "ok I'm out, gn",
      ggBoss: 'gg boss, honestly that was sick',
      betterRotation: 'the boss had a better rotation than me',
      sameTime: 'same time tomorrow?',
    },
    loot: {
      whoNeeds: 'ok who needs the trousers',
      need: 'NEED',
    },
    partyWins: {
      easy: 'EZ',
      gg: 'gg',
      toldYouEasy: 'told you he was easy',
    },
  },
};
