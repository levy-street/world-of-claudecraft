// i18n source catalog: the five-player dungeon boss guides (the encounter
// journal opened from party frames or the Dungeon Finder; data modules under
// src/ui/boss_journal/dungeons/). Every line states what the encounter code
// really does (src/sim/encounters/<dungeon>/), with its numbers passed in as
// placeholders resolved per difficulty, never typed here. Cast names are NOT
// repeated: a mechanic with a cast bar reads its name from
// abilityUi.cast.<castId>, so the guide and the bar always agree.
//
// Assembled into `en` by ./index.ts under the `bossJournal` namespace.
// English here; the five non-Latin fills (M16) ride the locale overlays, the
// rest the maintainer fills at release.

export const bossJournalStrings = {
  common: {
    enrageName: 'Enraged',
    phaseEnrageSummary: 'Below {health} health the boss enrages for the rest of the fight.',
    enrageSummary:
      'Below {health} health its melee attacks deal {damage} more damage and come {haste} faster, for the rest of the fight.',
    enrageResponse:
      'Tank and healer save their defensive and healing cooldowns for this phase. Everyone else pushes damage to end it fast.',
    heroicHarder: 'Every ability on this page hits {scale} times as hard as on Normal.',
  },
  wildheart: {
    saurian: {
      overview:
        'A house-sized war-beast carrying a howdah walks a loop across the river ford. Passing it is not optional: the vine bridges open only once it is dead. Two telegraphed strikes, a healer rider at half health, and an enrage at the end.',
      phaseFordName: 'The River Ford',
      phaseFordSummary:
        'From the pull it alternates a tail sweep behind it and a stomp around it. Only one strike runs at a time.',
      phaseHowdahName: 'The Howdah Breaks',
      phaseHowdahSummary:
        'At {health} health the howdah splinters and a Howdah Hexcaller leaps down to heal the Saurian.',
      phaseEnrageName: 'Enraged',
      phaseEnrageSummary: 'Below {health} health it enrages for the rest of the fight.',
      tailSummary:
        'Every {every} sec, a {cast} sec cast, then its tail sweeps a {arc} degree cone behind it, out to {range} yd from its centre: {min} to {max} damage and a {push} yd knockback.',
      tailResponse: 'Never stand behind it. Attack from its sides.',
      stompSummary:
        'Every {every} sec, a {cast} sec cast, then everyone within {radius} yd of its centre takes {min} to {max} damage and is knocked down for {stun} sec.',
      stompResponse:
        'Everyone who can leaves the ring before the cast ends. The tank takes it; healers top the tank up after.',
      riderName: 'Howdah Rider',
      riderSummary:
        'Once, at {health} health: a Howdah Hexcaller jumps down beside the Saurian and fights alongside it, healing it with Ancestral Sap.',
      riderResponse:
        'The tank picks up the rider. Damage dealers interrupt its heal or kill it first.',
      sapSummary:
        "The rider's heal: a {cast} sec cast every {every} sec that restores {heal} of the Saurian's maximum health.",
      sapResponse: 'Interrupt it every time, or kill the rider.',
      enrageSummary:
        'Below {health} health everything it does deals {damage} more damage: melee, Tail Swipe and Earthshaking Stomp.',
      tipTank:
        'Keep it facing away from the group so nobody ends up behind its tail. Pick up the Howdah Hexcaller the moment it lands.',
      tipHealer:
        'Earthshaking Stomp knocks everyone near it down, so heal the tank after each one. Save a cooldown for the enrage.',
      tipDamage:
        'Stay at its sides, out of the tail cone and the stomp ring. At half health, interrupt Ancestral Sap or kill the rider.',
      choiceName: 'Rider first, or Saurian first?',
      choiceGain:
        'Killing the rider ends its heals for good: each Ancestral Sap restores {heal} of the Saurian every {every} sec.',
      choiceRisk:
        'While you kill the rider the Saurian keeps sweeping and stomping. Leave the rider up and someone must interrupt every heal.',
    },
    beast: {
      overview:
        'The Fanglord Beastmaster and his Great Jaguar share one health bar and die together. Standing close they are far tougher and hit harder, so the tank drags the master away while the jaguar hunts a marked player.',
      phasePitsName: 'The Beast Pits',
      phasePitsSummary:
        'One fight, two bodies. Their timers run the whole fight; there are no health phases.',
      bondName: 'Pack Bond',
      bondSummary:
        'While the Beastmaster and the jaguar stand within {reach} yd of each other, both take {dr} less damage and deal {damage} more.',
      bondHeroicSummary:
        'Frenzied Bond: while the Beastmaster and the jaguar stand within {reach} yd of each other, both take {dr} less damage and deal {damage} more.',
      bondResponse:
        'The tank drags the Beastmaster more than {reach} yd away from the jaguar and keeps him there.',
      sharedName: 'Shared Health',
      sharedSummary:
        'The two bodies share one health pool: damage on either counts the same, and when one dies the other dies too.',
      sharedResponse:
        'Hit whichever body is safest to reach. Nothing is lost by switching targets.',
      stalkName: 'Stalk',
      stalkSummary:
        "The jaguar marks a player who is not the master's tank and hunts them for {seconds} sec, ignoring taunts. In reach it bites every {biteEvery} sec: {min} to {max} damage, then a bleed of {bleed} every {bleedEvery} sec for {bleedSeconds} sec. Then it picks new prey.",
      stalkResponse:
        'Marked: run, and lead the jaguar away from the Beastmaster. Others slow, root or stun it.',
      waryName: 'Wary',
      warySummary:
        'Each kind of control (stun, root, slow) lands on the jaguar once, then that kind fails on it for {lockout} sec. Incapacitates, fears and polymorphs count as stuns.',
      waryResponse:
        'Take turns: one root, then one slow, then one stun, instead of three of the same.',
      quakeSummary:
        'Every {every} sec, a {cast} sec cast, then everyone within {radius} yd of the Beastmaster takes {min} to {max} damage.',
      quakeResponse: 'Everyone but the tank steps away from the Beastmaster.',
      huntName: 'Call of the Hunt',
      huntSummary: 'Every {every} sec both beasts attack {haste} faster for {seconds} sec.',
      huntResponse: 'Tank and healer use a cooldown through it; the jaguar bites faster too.',
      wardName: 'Thickhide Ward',
      wardSummary:
        'Every {every} sec the jaguar gains a shield that absorbs {amount} damage for {seconds} sec.',
      wardResponse: 'Hit the Beastmaster while the shield is up: the health pool is shared.',
      heelSummary:
        'Every {every} sec, a {cast} sec cast on the jaguar, then it leaps back to the Beastmaster and the bond returns.',
      heelResponse:
        'Stun, incapacitate or transform the jaguar during the cast to cancel it. It only works if the jaguar is not already Wary of stuns.',
      tipTank:
        'Pull the Beastmaster more than {normal} yd from the jaguar at once and hold him there, facing away from the group.',
      tipTankHeroic:
        'Pull the Beastmaster more than {heroic} yd from the jaguar at once and hold him there. After each Heel! drag him clear again.',
      tipHealer:
        'Watch the Stalk target: bites and bleeds land fast, faster during Call of the Hunt.',
      tipDamage:
        'Hit whichever body is safest. When stalked, run the jaguar away from the master; otherwise rotate slows, roots and stuns on it.',
      tipDamageHeroic:
        'Hit whichever body is safest. Keep a stun ready for every Heel! cast, and rotate slows and roots on the jaguar.',
      choiceName: 'Control the jaguar now, or save it?',
      choiceGain:
        'Slows, roots and stuns keep the jaguar off its prey and away from the Beastmaster.',
      choiceRisk:
        'Each kind of control works once, then fails for {lockout} sec, so spending all three at once leaves nothing for the next hunt.',
      choiceRiskHeroic:
        'Each kind of control works once, then fails for {lockout} sec. Spend your stun early and nothing can cancel the next Heel!.',
      heroicBond: 'Frenzied Bond: Pack Bond reaches {reach} yd.',
      heroicHeel:
        'Heel!: the jaguar leaps back to the Beastmaster unless a stun lands during its cast. Thickhide Ward absorbs {amount}.',
    },
    bloom: {
      overview:
        'A rooted man-eating flower rains seedpods on the loam beds around it. Players without pollen stamp the pods flat before they sprout; pollinated players must stay off them, or the pods sprout at once.',
      phaseTerraceName: 'The Weeping Falls',
      phaseTerraceSummary:
        'It never moves. Its cast timers pause while another cast runs, so the listed cadences are the shortest gaps.',
      seedSummary:
        'Every {every} sec, a {cast} sec cast, then {count} seedpods land, one on each loam bed. Stepping on a pod while not Pollinated stamps it out. A pod left alone sprouts a Thorn Sprout after {sprout} sec.',
      seedHeroicSummary:
        'Every {every} sec, a {cast} sec cast, then {count} seedpods land, one on each loam bed. Stepping on a pod while not Pollinated stamps it out. Burrowing Seeds: a pod left alone burrows after {burrow} sec and a Thorn Sprout rises next to the nearest player.',
      seedResponse:
        'Players who are not Pollinated walk over every pod quickly. Pollinated players stay off them.',
      pollinateName: 'Pollinate',
      pollinateSummary:
        'Every {every} sec, {count} players are Pollinated for {seconds} sec. A Pollinated player who touches a pod makes it sprout at once.',
      pollinateHeroicSummary:
        'Every {every} sec, {count} players are Pollinated for {seconds} sec. A Pollinated player who touches a pod makes it sprout at once. Pollen Cloud: standing within {cloudRadius} yd of a Pollinated player for {cloudSeconds} sec pollinates you too.',
      pollinateResponse:
        'Pollinated: keep off the pods until it wears off, and on Heroic away from allies.',
      sproutName: 'Thorn Sprout',
      sproutSummary:
        'An elite add that grows from a sprouted pod and attacks the nearest player. Sprouts wither when the Gorgebloom dies.',
      sproutResponse: 'The tank picks it up and damage dealers kill it.',
      lashSummary:
        'Every {every} sec, a {cast} sec cast aims a {length} yd lane, {width} yd wide, at a player (a non-tank when possible): {min} to {max} damage and a {root} sec root.',
      lashResponse: 'Step sideways out of the lane before the cast ends.',
      gorgeSummary:
        'Every {every} sec, a {cast} sec cast on its target, then a bite for {mult} times its melee hit and Digesting: {perSecond} damage per second for {seconds} sec. It cannot be dodged by moving.',
      gorgeResponse: 'Tank: use a defensive cooldown for it. Healers cover the Digesting damage.',
      spitName: 'Bloom Spit',
      spitSummary:
        'If its target stays out of its reach for {delay} sec, it spits every {every} sec for {min} to {max} damage.',
      spitResponse: 'The tank stays in melee range.',
      tipTank:
        'Stay in melee: walking away earns Bloom Spit. Use a cooldown for every Gorge and pick up each Thorn Sprout.',
      tipHealer:
        'Gorge is the big hit on the tank, followed by Digesting. Vine Lash roots and hurts whoever stands in its lane.',
      tipDamage:
        'If you are not Pollinated, stamp out pods between attacks. Step out of Vine Lash and kill any Thorn Sprout fast.',
      choiceName: 'Who stamps the seeds?',
      choiceGain:
        'Every pod stamped out is one less elite Thorn Sprout, and the fight stays on the flower.',
      choiceRisk:
        'Running to the beds costs damage and melee time, and a Pollinated player who touches a pod sprouts it at once.',
      heroicBurrow:
        'Burrowing Seeds: an untouched pod burrows after {burrow} sec and its Sprout rises next to the nearest player.',
      heroicCloud:
        'Pollen Cloud: standing within {cloudRadius} yd of a Pollinated player for {cloudSeconds} sec pollinates you too.',
    },
    zulgar: {
      pulseSummaryRework:
        'Every {every} sec, a {cast} sec cast hits everyone within {radius} yd for {min} to {max} damage. Pinned players take {pinMult} times this damage at any distance.',
      spearSummary:
        'A {cast} sec cast pins a non-tank player, or the tank if nobody else remains. The root lasts up to {seconds} sec and deals {bleed} damage every {tick} sec.',
      spearResponse:
        'Target the spear and interact within {range} yd to pull it out in {pull} sec. Damage does not interrupt the pull. If nobody else stands free on the terrace, the victim can interact to escape in {self} sec.',
      glyphSummaryRework:
        'The {count} glyphs start dark. While he hunts, an unmarked player lights one by standing on it for {kindle} sec. If no unmarked player remains, Prey can light it in {alone} sec. Moving off resets progress. Crossing a lit glyph slows him by {slow} and increases damage taken by {vulnerability} for {seconds} sec. The glyph cannot be relit for {dark} sec; he cannot be struck by another glyph for {wary} sec. During the hunt, stuns last half as long.',
      glyphResponseRework:
        'Unmarked players light glyphs ahead of the Prey. Lead him through them, then attack during Sunstruck. Glyphs go dark when the hunt ends.',
      idolSummary:
        'At {health} health, he stays a jaguar spirit until defeated. The tank can also become Prey.',
      idolHuntSummary:
        'He picks new Prey every {every} sec, then turns toward them for {turn} sec before chasing.',
      idolHuntHeroicSummary:
        'He marks a fresh pair every {pair} sec and switches between them every {switch} sec. Each switch gives the new Prey {turn} sec before he chases.',
      breathSummary:
        'Every {every} sec, one half of the terrace is marked for {warning} sec, then everyone in that half takes {min} to {max} Nature damage. Breaths alternate halves.',
      breathResponse:
        'Cross to the unmarked half before the warning ends. The centre line is safe. On Heroic, the breath also extinguishes lit glyphs in its half; they can be relit immediately.',
      overview:
        'The high priest of the basin. A steady fight with a telegraphed ring, until he turns into a jaguar spirit and hunts one player. The hunted player kites him across lit sun glyphs, which slow him.',
      phaseShrineName: 'The Shrine',
      phaseShrineSummary: 'He fights in melee and pulses a ring around himself.',
      phaseHuntName: 'Spirit of the Hunt',
      phaseHuntSummary:
        'At {first} and {second} health he becomes a jaguar spirit for {seconds} sec and chases a marked player.',
      phaseEnrageName: 'Enraged',
      pulseSummary:
        'Every {every} sec, a {cast} sec cast, then one burst on everyone within {radius} yd of him: {min} to {max} damage.',
      pulseResponse: 'Everyone but the tank leaves the ring before the cast ends.',
      roarName: 'Jaguar Roar',
      roarSummary:
        'Each melee hit has a {chance} chance to knock the player he hits back {distance} yd.',
      roarResponse: 'The tank keeps open ground behind them.',
      huntSummary:
        'At {first} and {second} health: a {cast} sec cast, then for {seconds} sec he hunts one marked player (the Prey, never the tank while others stand). He runs {speed} faster than a player, ignores taunts and does not attack. If he catches the Prey: {maul} damage and a {stun} sec stun, then he picks new prey. A mauled player is safe for {respite} sec.',
      huntHeroicSummary:
        'At {first} and {second} health: a {cast} sec cast, then for {seconds} sec he hunts the Prey. Twin Prey: two players are marked and he switches between them every {switchEvery} sec. He runs {speed} faster than a player, ignores taunts and does not attack. If he catches a Prey: {maul} damage and a {stun} sec stun.',
      huntResponse:
        'Prey: run through lit sun glyphs to slow him. Everyone else slows, roots and stuns him while he hunts.',
      glyphName: 'Sun Glyphs',
      glyphSummary:
        '{count} glyphs ring the shrine. When the jaguar spirit crosses a lit glyph he is slowed by {slow} for {seconds} sec, and that glyph goes dark for {dark} sec. During the hunt slows and roots land on him, and stuns last half as long.',
      glyphResponse: 'Spread the glyphs out: do not burn them all on the first hunt.',
      ambushName: "Hunter's Ambush",
      ambushSummary:
        'After each hunt he vanishes for {seconds} sec. A {radius} yd circle marks the farthest player, giving a {warn} sec warning, then he lands there: {min} to {max} damage to everyone inside.',
      ambushResponse: 'Get out of the circle.',
      tipTank:
        'Keep open ground behind you for Jaguar Roar. When the hunt ends he comes back to you: be ready to take him.',
      tipHealer:
        'Wildheart Pulse hits anyone left in the ring. A Maul is a big single hit: top up the Prey.',
      tipDamage:
        'Leave the pulse ring. During the hunt, slow, root and stun him to protect the Prey, and run through lit glyphs if you are the Prey.',
      tipDamageHeroic:
        'Leave the pulse ring. During the hunt, slow, root and stun him to protect both Prey. After each hunt, get out of the Ambush circle.',
      choiceName: 'Spend a glyph now, or save it?',
      choiceGain: 'Each lit glyph you lead him through slows him hard and buys the Prey time.',
      choiceRisk:
        'A used glyph stays dark for {dark} sec, and each hunt lasts {seconds} sec: burn them all at the start and the end of the hunt has none.',
      heroicTwinPrey: 'Twin Prey: two players are hunted; he switches every {switchEvery} sec.',
      heroicAmbush:
        'Ambush: after each hunt he pounces on a {radius} yd circle at the farthest player.',
    },
  },
  crypt: {
    drake: {
      overview:
        'A skeletal drake flies a loop high over the Processional. Walk under it and it lands to fight: a fire breath in front, a tail lash behind and a wing gust around it.',
      phaseName: 'The Processional',
      phaseSummary: 'It lands where it is pulled and fights on the ground.',
      breathSummary:
        'Every {every} sec, a {cast} sec cast, then fire in a {arc} degree cone, {range} yd in front of it: {min} to {max} damage. Its facing locks for the cast.',
      breathResponse: 'Only the tank stands in front. Everyone else stays at its sides.',
      tailSummary:
        'Every {every} sec when someone stands behind it: a {cast} sec cast, then a {arc} degree sweep {range} yd behind it for {min} to {max} damage.',
      tailResponse: 'Never stand behind it.',
      gustSummary:
        'Every {every} sec when someone is close: a {cast} sec cast, then everyone within {radius} yd takes {min} to {max} damage and is knocked back {push} yd.',
      gustResponse: 'Expect the knockback; keep your back away from edges.',
      embersName: 'Barrow Embers',
      embersSummary:
        'The ground under each breath keeps burning for {seconds} sec: {min} to {max} damage per second to anyone on it.',
      embersResponse: 'Move the drake off the burning ground and step out of it.',
      tipTank:
        'Turn it so the breath points away from the group, and move it off any burning ground on Heroic.',
      tipHealer: 'The breath and the wing gust are the damage spikes. Stand at its side.',
      tipDamage: 'Attack from its sides: never in front, never behind.',
      heroicEmbers: 'Barrow Embers: each breath leaves the ground burning for {seconds} sec.',
    },
    marrow: {
      overview:
        'A raised gravedigger who measures players for graves. Every grave stays open, slowing and burning anyone in it, and each one raises a Restless Bones when he rings his Burial Bell. Dig the graves at the edge of the yard and keep their number down.',
      phaseYardName: 'The Bell Yard',
      phaseYardSummary: 'He digs graves under marked players and swings his shovel at the tank.',
      phaseTollName: 'The Burial Toll',
      phaseTollSummary:
        'At {first} and {second} health he walks to the bell rope and rings the Burial Toll.',
      shovelSummary:
        'Every {every} sec, a {cast} sec cast, then a shovel swing in an {arc} degree cone {range} yd in front of him for {mult} times his melee hit. Everyone hit has Dirt in the Eyes: {slow} slower for {seconds} sec.',
      shovelResponse: 'Only the tank stands in front. The tank can step out during the cast.',
      measureSummary:
        'Every {every} sec, a {cast} sec cast marks a player. {mark} sec later a grave caves in where they stand: {min} to {max} damage to everyone within {radius} yd. The grave stays open for the fight: inside it you are {slow} slower and take {dirt} damage per second. At most {cap} graves; a new one fills in the oldest.',
      measureResponse:
        'Marked: walk to the edge of the yard before the grave opens. Never stand in an open grave.',
      blowSummary:
        'Every {every} sec, a {cast} sec cast at the tank: a melee hit that adds a stack of {vuln} more damage taken, up to {stacks} stacks ({max}) for {seconds} sec.',
      blowResponse: 'Tank: use cooldowns as the stacks rise. Healers watch the tank.',
      vigorName: 'Grave Vigor',
      vigorSummary: 'While he stands inside an open grave he attacks {haste} faster.',
      vigorResponse: 'The tank keeps him out of the graves.',
      unquietName: 'Unquiet Earth',
      unquietSummary:
        'A player who stays {linger} sec inside a grave raises a Restless Bones from it. That grave then rests for {rest} sec.',
      unquietResponse: 'Leave graves at once.',
      tollSummary:
        'He walks to the rope and rings the bell for {ring} sec, immune to damage while he walks and rings. Then every player takes {min} to {max} damage, and every open grave raises a Restless Bones.',
      tollResponse:
        'Healers top everyone up before the last peal. The tank picks up the Restless Bones; damage dealers kill them.',
      tipTank:
        'Keep him facing away from the group. Pick up every Restless Bones after a Burial Toll.',
      tipTankHeroic:
        "Keep him facing away from the group and out of every grave. Gravedigger's Blow stacks: use cooldowns as they rise.",
      tipHealer:
        'Burial Toll hits the whole group. Graves slow and burn anyone in them, so help whoever is stuck in one.',
      tipDamage:
        "When marked, carry the grave to the yard's edge. After each Toll, kill the Restless Bones, then return to Marrow.",
      choiceName: 'Where do the graves go?',
      choiceGain: 'Graves dug at the edge of the yard leave the middle free to fight and dodge in.',
      choiceRisk:
        'Every open grave anywhere raises a Restless Bones at the next Toll, up to {cap} at once.',
      choiceRiskHeroic:
        'Every open grave anywhere raises a Restless Bones at the next Toll, up to {cap} at once. On Heroic a grave near the tank also speeds Marrow up.',
      heroicBlow: "Gravedigger's Blow: a tank hit that stacks {vuln} more damage taken.",
      heroicVigor: 'Grave Vigor: inside a grave he attacks {haste} faster.',
      heroicUnquiet: 'Unquiet Earth: {linger} sec in a grave raises a Restless Bones.',
    },
    lady: {
      overview:
        'A ghost bride whose wail hurts everyone who is not sheltered by a grave lantern. Each lantern shelters only two players and then goes dark, so the group has to take turns. She also lifts a player into the air until the group burns her enough to let go.',
      phaseRavineName: 'The Frost Ravine',
      phaseRavineSummary:
        'Three grave lanterns stand around the ravine. Her path turns to slippery ice.',
      phaseFreezeName: 'Bridal Freeze',
      phaseFreezeSummary:
        'At {health} health the whole ravine floor freezes for the rest of the fight.',
      lamentSummary:
        'Every {every} sec, a {cast} sec cast, then {min} to {max} damage to every player not sheltered by a lantern. Each hit adds a stack of Lingering Lament: {perStack} more Lament damage per stack, for {seconds} sec, up to {stacks} stacks.',
      lamentResponse: "Stand in a lit lantern's light before the cast ends.",
      lanternName: 'Grave Lanterns',
      lanternSummary:
        'A lit lantern shelters up to {cap} players within {radius} yd from the Lament. A lantern that sheltered anyone goes dark for {dark} sec, so it is still dark at the next Lament.',
      lanternHeroicSummary:
        'A lit lantern shelters up to {cap} players within {radius} yd from the Lament. A lantern that sheltered anyone goes dark for {dark} sec. On Heroic a lit lantern also burns out on its own after {lit} sec and stays dark for {gutter} sec.',
      lanternResponse: 'Plan who uses which lantern, and rotate to a lit one for each Lament.',
      embraceSummary:
        'Every {every} sec she seizes a player who is not the tank, lifts them into the air and holds them. Deal {share} of her health within {hold} sec to make her set them down gently. Otherwise she drops them: {min} to {max} damage.',
      embraceHeroicSummary:
        'Every {every} sec she seizes {victims} players who are not the tank, lifts them into the air and holds them. Deal {share} of her health within {hold} sec to make her set them down gently. Otherwise she drops them: {min} to {max} damage.',
      embraceResponse:
        'Everyone bursts her as soon as she grabs someone. Healers top up the held player.',
      rimeName: 'Rime Path',
      rimeSummary:
        'She leaves slippery ice where she drifts; each patch lasts {seconds} sec. On ice you slide and turn slowly.',
      rimeResponse: 'Avoid her trail when you need to move fast.',
      freezeSummary:
        'At {health} health, a {cast} sec cast, then the whole floor becomes slippery ice for the rest of the fight. It cancels a Lament already being cast.',
      freezeResponse: 'Move earlier: on ice it takes longer to reach a lantern.',
      tipTank: 'Keep her near the middle so every lantern stays in reach for the group.',
      tipHealer:
        'Unsheltered players take the Lament and gain stacks. The held player takes damage while she holds them.',
      tipDamage:
        'Burst her the moment she seizes someone. Rotate between lit lanterns for each Lament.',
      choiceName: 'Who takes the Lament?',
      choiceGain:
        'Using all three lanterns shelters up to {cap} players each, so nobody takes this Lament.',
      choiceRisk:
        'Used lanterns are still dark at the next Lament, so someone takes it then, and each stack of Lingering Lament adds {perStack} damage.',
      heroicEmbrace: 'Frozen Embrace seizes {victims} players at once.',
      heroicLanterns:
        'A lit lantern burns out on its own after {lit} sec and stays dark {gutter} sec.',
    },
    ilvane: {
      overview:
        'A choir mistress guarded by two Hollow Choristers who shield her while they live. Her Dirge hurts and silences everyone who can see her, so interrupt it or hide behind a pillar. She also plays the Bone Organ, sending lanes of notes down the loft.',
      phaseLoftName: 'The Choir Loft',
      phaseLoftSummary: 'She sings from the loft with two Hollow Choristers at her side.',
      phaseCrescendoName: 'Crescendo',
      phaseCrescendoSummary:
        'At {health} health she sings faster and the organ plays a third wave.',
      harmonyName: 'Harmony',
      harmonySummary:
        'Each living Chorister cuts the damage she takes by {per}: {both} while both stand.',
      harmonyResponse: 'Kill the Choristers first.',
      dirgeSummary:
        'Every {every} sec, a {cast} sec cast. If it finishes, everyone who can see her takes {min} to {max} damage and is silenced for {silence} sec. After an interrupt she sings no Dirge for {quiet} sec.',
      dirgeResponse: 'Interrupt it, or break line of sight behind a pillar before the cast ends.',
      organSummary:
        'Every {every} sec she walks to the organ and plays {waves} waves of note lanes down the loft. Each lane shows for {gather} sec, then bursts: {min} to {max} damage.',
      organResponse: 'Stand between the first lanes, then step into a lane that has already burst.',
      encoreName: 'Encore',
      encoreSummary:
        'A Chorister that stays dead {seconds} sec while its partner still stands rises again at full health.',
      encoreResponse: 'Kill both Choristers within {seconds} sec of each other.',
      unbrokenSummary: 'Every {nth} Dirge is an Unbroken Verse: it cannot be interrupted.',
      unbrokenResponse: 'Hide behind a pillar for it.',
      crescendoName: 'Crescendo',
      crescendoSummary:
        "Below {health} health the Dirge takes {cast} sec and comes every {every} sec, and the organ plays {waves} waves. The third wave reuses the first wave's lanes.",
      crescendoResponse:
        'Kick every Dirge, and step back out of the first lanes for the third wave.',
      tipTank: 'Hold the Choristers together so they can be killed fast, then take Ilvane.',
      tipHealer: 'A completed Dirge silences you too: hide behind a pillar if no one can kick it.',
      tipDamage: 'Kill the Choristers first, interrupt the Dirge, and dodge the organ lanes.',
      tipDamageHeroic:
        'Kill both Choristers within {seconds} sec of each other, kick the Dirge, and hide from every Unbroken Verse.',
      choiceName: 'Kick it or hide?',
      choiceGain: 'An interrupt stops the Dirge and keeps her quiet for {quiet} sec.',
      choiceRisk:
        'Hiding behind a pillar costs uptime. A missed kick silences and hurts everyone in sight.',
      heroicEncore: 'Encore: a Chorister dead {seconds} sec while its partner lives rises again.',
      heroicUnbroken: 'Unbroken Verse: every {nth} Dirge cannot be interrupted.',
    },
    morthen: {
      overview:
        'A lich bishop running a three-act rite. First he calls souls to empower him; at {rite} health he hides behind a ward until the group relights four candles at a cost in health; at {last} health he sweeps a huge scythe.',
      phaseCallingName: 'The Calling',
      phaseCallingSummary: 'He pulses shadow around himself and calls souls to feed him.',
      phaseRiteName: 'The Rite of the Unquiet',
      phaseRiteSummary:
        'At {health} health he returns to the altar and becomes immune until all four candles burn again.',
      phaseLastName: 'Last Rites',
      phaseLastSummary: 'At {health} health he takes up his scythe for the end of the fight.',
      pulseSummary:
        'Every {every} sec ({everyLast} sec in Last Rites), a {cast} sec cast, then {min} to {max} damage to everyone within {radius} yd.',
      pulseResponse: 'Everyone, the tank included, steps out to {radius} yd before the cast ends.',
      gravecallName: 'Gravecall',
      gravecallSummary:
        'Every {every} sec a Bound Soul drifts from an alcove toward him. If it reaches him he gains {per} more damage per stack (up to {stacks}) and heals {heal} of his health. The first player it touches absorbs it instead: {min} to {max} damage.',
      gravecallResponse: "A spare player steps into each soul's path.",
      graspName: 'Grasp of the Grave',
      graspSummary:
        'Every {every} sec a {radius} yd ring appears under {count} players. {fuse} sec later hands erupt: everyone inside is rooted for {root} sec and takes {min} to {max} damage.',
      graspResponse: 'Step out of the ring at once.',
      riteSummary:
        'He becomes immune and the {candles} candles go dark. {bones} Restless Bones climb out. Grave Chill hits everyone every second: {base} damage, rising by {step} every {chillEvery} sec, with no cap.',
      riteResponse: 'Relight all four candles fast: the chill never stops rising.',
      relightName: 'Relight the Candles',
      relightSummary:
        'Channel {channel} sec at a candle (within {range} yd) to relight it. It costs the lighter {drain} of their maximum health. When the fourth is lit he is stunned for {stun} sec and takes {vuln} more damage.',
      relightResponse:
        'Split the candles between players with health to spare, and burst him in the stun.',
      nameDeadName: 'Name the Dead',
      nameDeadSummary:
        'The candles must be lit in an order shown by a gold beam from the ledger. A wrong candle snuffs the last one lit and burns the lighter for {min} to {max}.',
      nameDeadResponse: 'Light only the candle the beam points at.',
      reapSummary:
        'Every {every} sec, a {cast} sec cast at the tank, then a {arc} degree scythe sweep {range} yd in front of him: {min} to {max} damage.',
      reapResponse: 'Only the tank stands in front. The tank can sidestep during the cast.',
      tipTank:
        'Keep him facing away from the group, and step out of the Shadow Pulse with everyone else.',
      tipHealer:
        'Each candle costs the lighter a big share of their health and Grave Chill keeps rising: heal the lighters first.',
      tipDamage:
        'Body-block the Bound Souls, relight candles in the Rite, then burst him while he is stunned.',
      tipDamageHeroic:
        'Body-block the Bound Souls and dodge Grasp of the Grave. In the Rite, follow the gold beam to the right candle.',
      choiceCandleName: 'How many lighters?',
      choiceCandleGain:
        'Several players relighting at once ends the Rite sooner, before Grave Chill climbs.',
      choiceCandleRisk:
        'Each lighter pays {normal} of their maximum health per candle while the chill keeps rising.',
      choiceSoulName: 'Block the souls?',
      choiceSoulGain: 'A blocked soul never reaches him: no damage stack and no heal.',
      choiceSoulRisk:
        "The blocker takes the soul's damage. Every soul that gets through adds {per} damage and heals him {heal}.",
      heroicNameDead: 'Name the Dead: the candles must be lit in the order the ledger shows.',
      heroicGrasp: 'Grasp of the Grave: rings that root and hurt, in every act.',
      heroicDrain: 'Each candle costs the lighter {drain} of their maximum health.',
    },
    wyrm: {
      overview:
        "Morthen's dying rite lights a pyre, and a bone wyrm lands in it. It fights like the Ossuary Drake, plus burning strafe lanes and a roar that knocks players back but leaves it open to damage.",
      phaseName: 'The Wyrmcall Pyre',
      phaseSummary: 'It glides in out of reach and lands in the ring with a burst of fire.',
      strafeSummary:
        'Every {every} sec it marks a {width} yd lane through a player for {mark} sec, then flies it pouring fire: {min} to {max} damage to everyone in it. The lane keeps burning for {seconds} sec: {burn} damage per second.',
      strafeResponse: 'Step sideways out of the marked lane and stay off the burning ground.',
      bellowSummary:
        'Every {every} sec, a {cast} sec cast, then {min} to {max} damage and a {push} yd knockback within {radius} yd. Afterwards it takes {vuln} more damage for {seconds} sec.',
      bellowResponse:
        'Do not get knocked into a burning lane. Spend cooldowns in the window after.',
      knellSummary:
        'Every {every} sec it flies up out of reach and breathes fire over half the ring {breaths} times. Each half is marked {mark} sec before the fire: {min} to {max} damage to everyone in it.',
      knellResponse: 'Run to the unmarked half of the ring every time.',
      tipTank: 'Keep it facing away from the group, and turn it out of burning lanes.',
      tipHealer:
        'Pyre Strafe and Dread Bellow are the spikes; heal anyone knocked into a burning lane.',
      tipDamage: 'Step out of marked lanes and spend cooldowns after each Dread Bellow.',
      tipDamageHeroic:
        'Step out of marked lanes, and during Burning Knell run to the safe half every time.',
      heroicKnell:
        'Burning Knell: it takes flight and breathes over half the ring {breaths} times.',
    },
  },
  bastion: {
    captain: {
      overview:
        'A hovering ghost captain patrols the Lower Bailey moat, and the drawbridge stays shut until he is dead. He cycles three lane attacks aimed at a player who is not the tank, each drawn on the floor before it fires.',
      phaseName: 'The Moat',
      phaseSummary:
        'His first move comes {first} sec after the pull, then Spectral Broadside, Cursed Anchor and Phantom Boarding in turn, {recovery} sec apart. He stands still during each move.',
      broadsideSummary:
        'After a {warn} sec warning, {lanes} parallel lanes {length} yd long fire at once: {min} to {max} damage to anyone in a lane.',
      broadsideResponse: 'Stand in a gap between the lanes.',
      anchorSummary:
        'After a {warn} sec warning, a cursed anchor is hauled {length} yd back along its lane over {seconds} sec, hitting everyone it passes: {min} to {max} damage.',
      anchorResponse: 'Leave the lane before it fires.',
      boardingSummary:
        'After a {warn} sec warning, everyone in an {length} yd lane takes {min} to {max} damage and he dashes along it.',
      boardingResponse: 'Step aside from the lane.',
      sailorsName: 'Wreckbound Sailors',
      sailorsSummary:
        'At {first} and {second} health, {count} Wreckbound Sailors join the fight. A sailor bursts with soul energy shortly after it dies.',
      sailorsResponse: 'The tank picks them up. Step away from a sailor that just died.',
      tipTank:
        'Keep him in place and pick up the Wreckbound Sailors. His lanes aim at the others, not at you.',
      tipHealer: 'Spectral Broadside hits hardest: heal whoever stood in a lane.',
      tipDamage:
        'Watch the floor: every move is drawn before it fires. Stand in the Broadside gaps.',
    },
    olen: {
      overview:
        'A fallen paladin knight. His brine pools shield him, so the tank drags him out of them; the group stays spread so his rebounding shield and the Sentence column hit only one player. At half health he kneels, immune, until his Drowned Sergeants die.',
      phaseBreachName: 'The Breach Bastion',
      phaseBreachSummary: 'He casts one ability at a time; his timers pause during his casts.',
      phaseOathName: 'Unbroken Oath',
      phaseOathSummary:
        'At {health} health he kneels, immune, while Drowned Sergeants fight for him.',
      brineSummary:
        'Every {every} sec, a {cast} sec cast, then a {radius} yd pool of holy brine under him for {seconds} sec: {perSecond} damage per second to anyone in it. While he stands in any pool he takes {shield} less damage.',
      brineResponse: 'The tank drags him out of the pool. Everyone else steps out of it.',
      bulwarkSummary:
        'Every {every} sec, a {cast} sec cast at a player who is not the tank. The shield hits them for {min} to {max}, then rebounds to the nearest unhit player within {reach} yd, up to {hits} players.',
      bulwarkResponse: 'Stay spread: more than {reach} yd from everyone else.',
      sentenceSummary:
        'Every {every} sec, a {cast} sec cast marks a player who is not the tank. {seconds} sec later a column lands on them wherever they are: {min} to {max} damage to everyone within {radius} yd.',
      sentenceResponse: 'Marked: move away from the group before the column lands.',
      arcName: 'Reaping Arc',
      arcSummary:
        'Each of his melee hits also strikes every other player within {radius} yd of the tank for {share} of the swing.',
      arcResponse: 'Nobody but the tank stands within {radius} yd of the tank.',
      oathSummary:
        'Once, at {health} health: he kneels and channels for up to {max} sec, immune to damage, while {count} Drowned Sergeants rise and attack players who are not the tank. Kill them all and he is stunned for {stun} sec and takes {vuln} more damage for {vulnSeconds} sec.',
      oathResponse:
        'The tank gathers the Sergeants; everyone kills them, then bursts Olen while he is stunned.',
      tipTank:
        'Drag him out of every brine pool. Keep the group out of the {radius} yd around you, where his swings splash.',
      tipHealer:
        'Rebounding Bulwark and Sentence of the Tide hit hardest when players stand together. Sergeants enrage at low health.',
      tipDamage:
        'Stay spread, more than {reach} yd apart, and away from the tank. In the Oath, kill the Sergeants first.',
      choiceName: 'Stack or spread?',
      choiceGain:
        'Spread out and Rebounding Bulwark, Sentence of the Tide and Reaping Arc each hit only one player.',
      choiceRisk:
        'Anyone within {reach} yd of a struck player takes the rebound, and anyone within {radius} yd of the tank takes the splash.',
      heroicChanges:
        'Brine pools are {radius} yd, the shield rebounds to {hits} players, the Sentence column is {sentence} yd, and {count} Sergeants rise.',
    },
    turnkey: {
      overview:
        'The gaol keeper locks players in Iron Cages. The prisoner breaks out by pressing the interact key again and again, and teammates speed it up by hitting the cage.',
      phaseName: 'The Gaol Grate',
      phaseSummary: 'He cages players on a steady timer and frees the prisoners at half health.',
      cageSummary:
        'Every {every} sec, a {cast} sec cast, then a cage drops on a player who is not the tank, stunning them. The cage has {hits} points: each press of the interact key by the prisoner breaks {press}, each hit from an ally breaks {helper}, and it slowly mends. After {max} sec the cage crushes the prisoner for {crush} of their maximum health.',
      cageHeroicSummary:
        'Every {every} sec, a {cast} sec cast, then cages drop on {cages} players who are not the tank. Each cage has {hits} points: each press of the interact key by the prisoner breaks {press}, each hit from an ally breaks {helper}. Inside, rising brine drains health every second. After {max} sec the cage crushes for {crush} of maximum health.',
      cageResponse: 'Caged: press the interact key fast. Everyone else hits the cage to break it.',
      cellsName: 'Open the Cells',
      cellsSummary:
        'At {health} health he lets {count} Shackled Prisoners out. At a quarter health their chains snap and they leave the fight.',
      cellsResponse: 'Bring them to a quarter health; you do not need to kill them.',
      tipTank: 'Hold him and the prisoners; the cages never target you.',
      tipHealer: 'Top up caged players: the crush is a share of their health.',
      tipDamage: 'Switch to every cage at once and hit it until it breaks.',
      heroicCages: 'Iron Cage locks {cages} players at once.',
      heroicFlood: 'Brine Flood: a caged player loses health every second until freed.',
    },
    ossick: {
      overview:
        'The gaoler hooks a player with his anchor and reels them toward the drowning pit. They run to a lit Mooring Post or the group breaks the chain. Meanwhile two other players are chained together and must stay close.',
      phaseName: 'The Drowning Yard',
      phaseSummary:
        'At {first} and {second} health, {count} Shackled Prisoners come out of the cells each time.',
      anchorSummary:
        'Every {every} sec, a {cast} sec cast, then a player who is not the tank is hooked. After {settle} sec the chain reels them toward the pit. Escape: reach within {reach} yd of a lit Mooring Post at least {run} yd from where you were hooked (that post goes dark for {dark} sec), or the group lands {hits} hits on the anchor. Reaching the pit: {pit} of maximum health and a {stun} sec stun.',
      anchorHeroicSummary:
        "Every {every} sec, a {cast} sec cast, then a player who is not the tank is hooked; the anchor's landing hits everyone else within {crashRadius} yd for {min} to {max}. After {settle} sec the chain reels them toward the pit. Escape: a lit Mooring Post at least {run} yd away, or {hits} hits on the anchor. Reaching the pit: {pit} of maximum health and a {stun} sec stun.",
      anchorResponse: 'Hooked: run to a lit post early. Everyone else hits the anchor.',
      shackleSummary:
        'Every {every} sec, a {cast} sec cast chains two players together for {seconds} sec. Every second they stand more than {range} yd apart, both take {min} to {max} damage.',
      shackleResponse: 'Chained: stay within {range} yd of your partner.',
      cudgelSummary:
        'Every {every} sec, a {cast} sec cast at the tank: {mult} times his melee hit, ignoring armor, and {slow} slower movement for {seconds} sec.',
      cudgelResponse: 'Tank: use a cooldown. Healers expect the hit.',
      tipTank:
        "Hold him near the middle and pick up the prisoners. Gaoler's Cudgel ignores your armor.",
      tipHealer: 'Watch hooked and chained players; the pit takes a large share of health.',
      tipDamage:
        'Hit the anchor the moment someone is hooked. When chained, stay close to your partner.',
      choiceName: 'Run to a post, or break the chain?',
      choiceGain: 'A lit post frees the hooked player alone, so the group keeps attacking.',
      choiceRisk:
        'The post must be at least {run} yd away and goes dark for {dark} sec. Once the chain is short, no post is in reach and only breaking it works.',
      heroicCrash:
        'Anchor Crash: the anchor hits everyone within {crashRadius} yd of the hooked player.',
      heroicChanges:
        'The anchor needs {hits} hits and chained players must stay within {range} yd.',
    },
    vael: {
      overview:
        "A hooded reaper. Three times in a row he rises from a shadow pool behind a player and sweeps a scythe through their back. At {first} and {second} health he hides among identical copies while a hymn hurts everyone; the Fogbeacon's beam shows which figure is real.",
      phaseCrownName: 'The Beacon Crown',
      phaseCrownSummary:
        'He rises from the crown when a player steps onto it. At {first} and {second} health, {count} Drowned Thralls join the fight.',
      phaseVeilName: 'Fog Veil',
      phaseVeilSummary: 'At {first} and {second} health he hides among identical copies.',
      surgeSummary:
        'A {cast} sec cast, then {min} to {max} damage to everyone within {radius} yd of him. Every {every} sec of open fight; every {lastEvery} sec below {below} health.',
      surgeResponse: 'Ranged players stay beyond {radius} yd.',
      crossingSummary:
        'Every {every} sec he steps through the shadows up to {chain} times in a row, each behind a different player: a pool opens {behind} yd behind them, he rises, and sweeps a {arc} degree arc {range} yd toward them: {min} to {max} damage.',
      crossingResponse:
        'Marked by Death: move forward out of the sweep or behind the pool. Others never stand in front of the marked player.',
      graveName: 'Grave Shadow',
      graveSummary:
        'Each shadow pool stays for {seconds} sec and burns anyone within {radius} yd for {perSecond} damage per second.',
      graveResponse: 'Stay out of old pools.',
      veilSummary:
        "He hides, then four figures rise around the crown: Vael and three Fog Shades. All four sing the Drowning Hymn for {seconds} sec, hurting everyone more each second. The Fogbeacon's beam sweeps every {beam} sec: the real Vael lights up. Deal {share} of his health to him to break the veil: he is stunned for {stun} sec and takes {vuln} more damage for {vulnSeconds} sec.",
      veilHeroicSummary:
        "He hides, then four figures rise around the crown: Vael and three Fog Shades, drifting one place every {drift} sec. All four sing the Drowning Hymn for {seconds} sec. The Fogbeacon's beam shows the real Vael. Deal {share} of his health to him to break the veil: a {stun} sec stun and {vuln} more damage taken for {vulnSeconds} sec.",
      veilResponse: 'Watch the beam, then everyone hits only the real Vael.',
      fogburstName: 'Fogburst',
      fogburstSummary:
        'Any hit on a Fog Shade bursts it: {min} to {max} damage and a {stun} sec stun to players within {radius} yd of it.',
      fogburstHeroicSummary:
        'Any hit on a Fog Shade bursts it: {min} to {max} damage and a {stun} sec stun to players within {radius} yd, and a Drowned Thrall rises where it stood.',
      fogburstResponse: 'Do not hit a copy: wait for the beam.',
      tipTank: 'Pick up the Drowned Thralls. During the veil, help find the real Vael.',
      tipHealer:
        'The Drowning Hymn ramps on everyone until the veil breaks. Mist Surge hits everyone within {radius} yd of him.',
      tipDamage:
        'When Marked by Death, move forward or behind the pool. In the veil, hit only the figure the beam lights.',
      tipDamageHeroic:
        'When Marked by Death, move forward or behind the pool, and avoid old pools. In the veil, hit only the figure the beam lights.',
      choiceName: 'Wait for the beam, or guess?',
      choiceGain:
        'Waiting for the beam puts every hit on the real Vael and breaks the veil sooner.',
      choiceRisk:
        'Every second of the veil the hymn hurts more. Guessing wrong bursts a copy: damage and a stun around it.',
      choiceRiskHeroic:
        'Every second of the veil the hymn hurts more. Guessing wrong bursts a copy, which stuns players near it and leaves a Drowned Thrall.',
      heroicGrave: 'Grave Shadow: each shadow pool keeps burning for {seconds} sec.',
      heroicVeil:
        'In the veil the figures drift every {drift} sec, and a burst copy leaves a Drowned Thrall.',
    },
  },
  temple: {
    selthe: {
      overviewRework:
        'Selthe never moves or melees. Stack for Chorus, leave the group for Solo, interrupt Drowning Aria and dodge Mere Surge. At two health thresholds, repeat her moon-tile melody with alternating singers.',
      phaseSummaryRework:
        'Her other attacks pause while the group answers the Score. Moonwater Bolts have no cast bar and cannot be interrupted.',
      boltSummaryRework:
        'Between other casts, a bolt lands every {every} sec after a {windup} sec visual warning, dealing {mult} times her weapon damage as Frost. Interrupting Drowning Aria stops bolts and Aria for {quiet} sec.',
      boltResponseRework: 'Keep the tank in her line of sight. Save interrupts for Drowning Aria.',
      tipHealerRework:
        'Watch the Aria target and anyone caught alone by Chorus. During the Score, help sing the next note and heal mistakes.',
      scoreSummary:
        'At {first} and {second} health, she becomes immune and plays {notes}, then {finalNotes} notes. Repeat them within {answer}, then {finalAnswer} sec. A wrong tile deals {falseNote} Frost damage and resets progress, not the timer. Timeout deals {min} to {max} Frost damage to everyone. Success stuns her for {stun} sec and increases damage taken by {vulnerability} for {bonusSeconds} sec.',
      scoreResponse:
        'Watch the melody, then step onto tiles in order. Alternate correct notes with another living player; a sole survivor can finish alone. Blocked steps are harmless. Step off and enter again to sound a tile, including one occupied before the answer begins.',
      scoreHeroic: 'During the answer, the tiles go dark. Remember the melody and take turns.',
      overview:
        'The Choirmother sings from her pool and never moves or melees. She marks players for a shared Chorus and a lonely Solo, beams a rising aria at one player, and sends a wave across the court. Her bolts and her aria can be interrupted.',
      phaseName: 'The Choir Court',
      phaseSummary:
        'One phase on timers. A mechanic that comes due during a cast waits for it to end.',
      chorusName: 'Chorus',
      chorusSummary:
        'Every {every} sec a player who is not the tank is marked for {mark} sec. When it ends, {total} damage is split evenly among everyone within {radius} yd of them.',
      chorusHeroicSummary:
        'Every {every} sec a player who is not the tank is marked for {mark} sec. When it ends, {total} damage is split evenly among everyone within {radius} yd of them. Echo: {echo} sec later the same spot bursts again for {echoDamage} to each player still there, not split.',
      chorusResponse: 'Everyone stacks on the Chorus player, then leaves the spot before the Echo.',
      soloName: 'Solo',
      soloSummary:
        '{offset} sec after each Chorus another player is marked for {mark} sec. When it ends, the marked player and everyone within {radius} yd take {damage} damage each.',
      soloHeroicSummary:
        'Duet: Solo lands together with the Chorus, on a different player. When it ends, the marked player and everyone within {radius} yd take {damage} each, and {echo} sec later the spot bursts again.',
      soloResponse: 'Solo player: move away from everyone, then leave the spot.',
      songSummary:
        'Every {every} sec, a {cast} sec cast, then {min} to {max} frost damage to every player in the court.',
      songResponse: 'It cannot be avoided: healers keep everyone topped up.',
      boltSummary:
        'Her filler: a {cast} sec cast at her target for {mult} times her melee hit, as frost. After any interrupt she casts no bolt or aria for {quiet} sec.',
      boltResponse: 'Interrupt bolts when the aria is not coming.',
      ariaSummary:
        'Every {every} sec she channels a beam at a player who is not the tank for {channel} sec: {pulses} pulses that grow from {min} to {max} on the same body. A player who steps into the beam takes the pulse instead, and the ramp starts over.',
      ariaResponse:
        'Interrupt it, break her line of sight behind a lamp pillar, or step into the beam to share it.',
      surgeSummary:
        'Every {every} sec, a {cast} sec cast aimed at a player who is not the tank, then a {arc} degree wave {range} yd long: {min} to {max} damage and an {push} yd knockback.',
      surgeResponse: 'Step sideways out of the wedge.',
      tipTank:
        'Stand where she can see you so her bolts go to you; nothing else needs a tank here.',
      tipHealer:
        'Sea-Song hits everyone every {every} sec. Watch the aria target and anyone a Chorus caught alone.',
      tipDamage: 'Stack for Chorus, scatter from Solo, kick the aria and step out of Mere Surge.',
      tipDamageHeroic:
        'Stack for Chorus and scatter from Solo at the same time, then leave both spots before the Echo. Kick the aria.',
      choiceName: 'Kick the aria, or soak it?',
      choiceGain:
        'An interrupt or a pillar ends the beam at once. Stepping into the beam restarts its ramp on you.',
      choiceRisk:
        'A kicked aria silences her bolts too for a moment, but if nobody acts the full ramp lands on one player.',
      heroicDuet: 'Duet: Chorus and Solo land at the same time on two players.',
      heroicEcho: 'Echo: each mark bursts again at the same spot {echo} sec later.',
    },
    hydra: {
      overview:
        'Three heads with three elements share one fight: ice, venom and water. A head that dies hands its attack to the next head and grows back {regrow} sec later while another lives. Waves wash over half the pool on a timer, and between waves two heads combine their breaths.',
      phaseName: 'The Hydra Pool',
      phaseSummary: 'The left head breathes ice, the centre spits venom, the right sends water.',
      phaseComboName: 'Combined Breath',
      phaseComboSummary:
        '{after} sec after each wave two heads combine, always in the order Frostlocked Torrent, Venom Current, Toxic Rime.',
      phaseComboHeroicSummary:
        '{early} sec and {after} sec after each wave two heads combine, in the order Frostlocked Torrent, Venom Current, Toxic Rime.',
      headsName: 'Three Heads',
      headsSummary:
        'A dead head passes its element to the next head, and every living head deals {enrage} more damage per dead head. A dead head grows back after {regrow} sec at {share} health while another head lives.',
      headsResponse: 'Bring all three heads down together and finish them within {regrow} sec.',
      breathSummary:
        'Every {every} sec, a {cast} sec cast at a player who is not the tank, then a {arc} degree ice cone {range} yd long: {min} to {max} damage and {slow} slower for {seconds} sec.',
      breathResponse: 'Step out of the cone.',
      spitName: 'Venom Spit',
      spitSummary:
        'Every {every} sec, up to {count} pools of {radius} yd under different players burst after {warn} sec: {min} to {max} damage, then venom burns there for {seconds} sec at {perSecond} per second.',
      spitResponse: 'Spread out, then step out of the pools.',
      torrentSummary:
        'Every {every} sec, a {cast} sec cast aims a {length} yd lane at a player who is not the tank: {min} to {max} damage and an {push} yd shove.',
      torrentResponse: 'Step sideways out of the lane.',
      tsunamiSummary:
        'First at {first} sec, then {every} sec after the previous wave ends: a {cast} sec cast while the heads take {reduction} less damage, then a wave crashes over half the pool: {min} to {max} damage and a {push} yd shove.',
      tsunamiHeroicSummary:
        'First at {first} sec, then {every} sec after the previous wave ends: a {cast} sec cast while the heads take {reduction} less damage, then a wave crashes over half the pool: {min} to {max} damage and a shove. Backwash: {backwash} sec later it rolls over the other half.',
      tsunamiResponse:
        'Move to the other half, behind a rim column, or behind an Ice Wall. Do not burn the heads while they are submerged.',
      frostlockSummary:
        'A lane at a player: {min} to {max} damage and a {stun} sec freeze. It leaves an Ice Wall for {wall} sec: standing up to {lee} yd behind it shelters you from the next wave, which shatters it.',
      frostlockHeroicSummary:
        'A lane at a player: {min} to {max} damage and a {stun} sec freeze. It leaves an Ice Wall: standing behind it shelters you from the next wave. When it shatters, anyone within {reach} yd of the wall takes {shardMin} to {shardMax}.',
      frostlockResponse: 'Dodge the lane, then use the wall as cover from the Tsunami.',
      currentSummary:
        'Venom pools swell to {radius} yd and slide {slide} yd outward from the pool centre, burning {perSecond} per second.',
      currentResponse: 'Step aside from the slide path.',
      rimeSummary:
        'Venom pools freeze into crystals that burst after {seconds} sec: {min} to {max} damage within {radius} yd.',
      rimeResponse: 'Move away from every crystal before it bursts.',
      tipTank: 'Hold the heads you can reach; their attacks aim at the others.',
      tipHealer:
        'Tsunami and the combined breaths are the spikes. Every dead head makes the others hit harder.',
      tipDamage:
        'Spread damage evenly so all three heads fall within {regrow} sec of each other. Stop during each Tsunami.',
      choiceName: 'Which head dies first?',
      choiceGain:
        'Killing all three together ends the fight; any order works if they die close together.',
      choiceRisk:
        'Each dead head makes the others deal {enrage} more damage and grows back after {regrow} sec, and the last head left carries every element.',
      heroicChanges: 'A regrown head returns at {share} health, and each wave sends a backwash.',
    },
    colossus: {
      overview:
        'A walking glass giant. At three health marks every player gets a mirror copy that hunts them; you cannot damage your own copy, and each living copy shields the Colossus. In between, lanes, slams and a floor that shatters slice by slice.',
      phaseName: 'The Prism Terrace',
      phaseSummary: 'It plants its feet for every cast and never leaves the terrace.',
      phaseFlareName: 'Prism Flare',
      phaseFlareSummary:
        'At {first}, {second} and {third} health it summons Tideglass Reflections.',
      lanceSummary:
        'Every {every} sec, a {cast} sec cast aims a {length} yd lane at a player who is not the tank: {min} to {max} damage.',
      lanceResponse: 'Step sideways out of the lane.',
      slamSummary:
        'Every {every} sec, a {cast} sec cast, then {min} to {max} damage and an {push} yd knockback within {radius} yd.',
      slamResponse: 'Melee can step out; healers cover the tank.',
      fractureSummary:
        'First at {first} sec, then every {every} sec: the floor splits into {slices} slices for {rounds} rounds. Each round some slices glow red and explode {warn} sec later: {min} to {max} damage. The centre explodes every round.',
      fractureResponse: 'Move to a clear slice every round, and stay out of the centre.',
      flareSummary:
        'A {cast} sec channel, then every player gets a Tideglass Reflection with {share} of its health that hunts them. You cannot damage your own Reflection.',
      flareResponse: "Kill each other's Reflections: never your own.",
      wardName: 'Prism Ward',
      wardSummary:
        'Each living Reflection cuts the damage the Colossus takes by {per}, up to {cap}.',
      wardResponse: 'Clear the Reflections, then return to the Colossus.',
      shatterName: 'Shattering Glass',
      shatterSummary:
        'When a Reflection breaks, everyone within {radius} yd of it takes {damage} damage.',
      shatterResponse: 'Do not stand next to a Reflection that is about to die.',
      swapName: 'Swapped Images',
      swapSummary:
        'Every {every} sec the Reflections swap owners, so who can hit which copy changes.',
      swapResponse: 'Check again which copy you can hit after each swap.',
      tipTank: 'Pick up the Colossus again after each flare; it walks its target down.',
      tipHealer:
        'Reflections hit their owners. Tideglass Fracture punishes anyone left on a red slice.',
      tipDamage:
        "At each flare kill a teammate's Reflection, then move slice by slice in the Fracture.",
      tipDamageHeroic:
        "At each flare kill a teammate's Reflection; after a swap, check again. Do not stand by a dying copy.",
      choiceName: 'Kill the Reflections, or the Colossus?',
      choiceGain: 'Killing the copies removes up to {cap} damage reduction and stops them hunting.',
      choiceRisk:
        'Time on copies is time off the Colossus, and on Heroic each copy bursts when it breaks.',
      heroicShatter: 'Shattering Glass: a breaking Reflection hurts everyone within {radius} yd.',
      heroicSwap: 'Swapped Images: Reflections swap owners every {every} sec.',
    },
    ysolei: {
      overview:
        'The Avatar of the Drowned Moon pulls everyone in and crashes, floods half her island, calls Moonspawn, and rolls Moonlight Tears at herself. At the end the moon falls unless the group breaks her ward in time.',
      phaseAltarName: 'The Moon Altar',
      phaseAltarSummary: 'She never moves. Her reach is long: melee stands far from her centre.',
      phaseTideName: 'Rising Tide',
      phaseTideSummary:
        'At {health} health half of the island floods, and the flood switches sides.',
      phaseMoonName: 'The Full Moon',
      phaseMoonSummary: 'At {health} health she calls the moon down.',
      lunarSummary:
        'Every {every} sec, a {cast} sec cast, then {min} to {max} damage to everyone within {radius} yd of her centre.',
      lunarResponse: 'Ranged players stay out; melee are always in range, so healers cover them.',
      undertowSummary:
        'Every {every} sec she channels for {seconds} sec, dragging everyone toward her at {pull} yd per second. Then Tidal Crash: {min} to {max} damage within {radius} yd.',
      undertowHeroicSummary:
        'Every {every} sec she channels for {seconds} sec, dragging everyone toward her. Then Tidal Crash: {min} to {max} damage within {radius} yd. Riptide: a pool opens where each player stood, burning {riptide} per second for {pool} sec.',
      undertowResponse:
        'Everyone, melee included, runs out toward dry ground during the channel; flood water slows you.',
      tearsSummary:
        'At {first} and {second} health she calls {count} Moonlight Tears that roll toward her. A tear that touches a player stops: {min} to {max} damage, plus {bonus} more for each Moonsear stack, which lasts {sear} sec. A tear that reaches her gives her {swell} more damage for the fight and heals her {heal}.',
      tearsHeroicSummary:
        'At {first} and {second} health she calls {count} Moonlight Tears that roll toward her. A tear that touches a player stops: {min} to {max} damage plus {bonus} more per Moonsear stack, and leaves Spilled Moonlight burning {glow} per second. A tear that reaches her gives her {swell} more damage and heals her {heal}.',
      tearsResponse: 'Body-block every tear, taking turns so nobody stacks Moonsear.',
      tideName: 'Rising Tide',
      tideSummary:
        'At {health} health half the island floods at once. Every {every} sec the flood switches sides, with a {warn} sec shimmer first. In the water: {perSecond} damage per second and {slow} slower.',
      tideHeroicSummary:
        'At {health} health half the island floods at once. Every {every} sec the flood switches sides. In the water: {perSecond} damage per second and {slow} slower. Drowned Moon: every {moonEvery} sec a Moonspawn climbs out of the flooded half.',
      tideResponse: 'Stay on the dry half and move when the other half shimmers.',
      callSummary: 'At {first} and {second} health she calls {count} Moonspawn.',
      callResponse: 'The tank picks them up and damage dealers kill them.',
      moonSummary:
        'A {cast} sec cast behind a ward worth {ward} of her health. Break the ward in time: she is stunned for {stun} sec and takes {vuln} more damage. If the ward holds: {min} to {max} damage to everyone on the island, and she deals {might} more damage for the rest of the fight.',
      moonResponse: 'Every damage dealer hits her ward; healers prepare for the impact.',
      tipTank: 'Pick up every Moonspawn. Run out of the Undertow with everyone.',
      tipHealer:
        'Lunar Tide hits melee every cast. Tears add Moonsear stacks: heal whoever blocked one.',
      tipDamage:
        'Run from every Undertow, block tears in turns, kill Moonspawn, and burn the ward of the Falling Moon.',
      tipDamageHeroic:
        'Run from every Undertow and its Riptide pools, block tears in turns, kill Moonspawn, and burn the Falling Moon ward fast.',
      choiceName: 'Block the tears, or let them through?',
      choiceGain:
        'A blocked tear never reaches her: no {swell} damage bonus for her and no {heal} heal.',
      choiceRisk:
        'The blocker takes the hit and a Moonsear stack: the next tear on them hits {bonus} harder. Take turns.',
      heroicRiptide: 'Riptide: each Undertow leaves burning pools where players stood.',
      heroicDrownedMoon: 'Drowned Moon: a Moonspawn climbs out of the flood every {moonEvery} sec.',
      heroicTears: '{count} tears per wave, and the Falling Moon cast lasts {cast} sec.',
    },
  },
  sanctum: {
    tusker: {
      overview:
        'A house-sized tusker hauls a sledge of burning soul braziers up and down the Sledge Road. It walks the road in a loop and unhitches the sledge where you pull it. At half health the sledge tips over and spills fire behind it.',
      phaseRoadName: 'On the Road',
      phaseRoadSummary:
        'Two telegraphed attacks from the start: a frontal sweep and a charge down a painted lane.',
      phaseSpillName: 'The Sledge Tips',
      phaseSpillSummary: 'At {health} health the sledge tips over and soulfire spills behind it.',
      phaseEnrageName: 'Enraged',
      phaseEnrageSummary: 'Below {health} health it enrages for the rest of the fight.',
      sweepSummary:
        'Every {every} sec, a {cast} sec cast, then its tusks sweep a {arc} degree cone in front of it, {range} yd past its body: {min} to {max} damage and a {push} yd knockback.',
      sweepResponse:
        'The tank holds it facing away from the group. Everyone else attacks from its sides or rear.',
      trampleSummary:
        'Every {every} sec, a {cast} sec cast paints a {length} yd lane toward the farthest player, then it charges down the lane: {min} to {max} damage and a {stun} sec knockdown to everyone in it.',
      trampleResponse:
        'Step sideways out of the painted lane before the cast ends. The farthest player is the target, so ranged players keep room to side-step.',
      spillName: 'Spilled Braziers',
      spillSummary:
        'Once, at {health} health: the sledge tips and {count} soulfire patches ({radius} yd) burn behind it for {seconds} sec, {min} to {max} damage per second to anyone inside.',
      spillResponse: 'Walk out of the fire at once and fight away from the patches.',
      enrageSummary:
        'Below {health} health it deals {damage} more damage for the rest of the fight.',
      enrageResponse:
        'Save healing and defensive cooldowns for the last stretch and finish it fast.',
      tipTank:
        'Hold it facing away from the group and keep still, so the sweep cone never swings into allies. Expect a knockback with every Tusk Sweep.',
      tipHealer:
        'Tusk Sweep and Trample are the damage spikes. Stand to its side, not at the far edge where Trample aims, and keep a cooldown for its enrage below {health}.',
      tipDamage:
        'Attack from the sides or rear. Watch the floor for the painted lane and step out of it. At half health, leave the fire behind it.',
    },
    korgath: {
      overview:
        "The Smith's foreman, chained to four seal pillars. Each chain still on him cuts the damage he takes by {perChain}, so breaking chains makes him easier to kill. But every chain you break frees one more of his attacks for the rest of the fight.",
      phaseLockName: 'The Lock',
      phaseLockSummary:
        'He starts bound by {chains} chains, one to each pillar. A Seal Shackle at each pillar holds its chain.',
      phaseFreedName: 'Broken Chains',
      phaseFreedSummary:
        'Each broken chain frees one attack for the rest of the pull, even if the chain is later re-riveted.',
      phaseEnrageName: 'Enraged',
      lockboundName: 'Lockbound',
      lockboundSummary:
        'Each intact chain cuts the damage he takes by {perChain}: {all} less damage while all four hold.',
      lockboundResponse:
        'Break chains to speed up the kill. Decide how many first: each one also frees an attack.',
      shacklesName: 'Seal Shackles',
      shacklesSummary:
        "A Seal Shackle stands at each pillar's foot. Shackles can't be attacked until Korgath is pulled. Killing one breaks its chain. While the Anvil chain holds he can't leave {leash} yd of the terrace's middle.",
      shacklesResponse:
        'Damage dealers kill the Shackles of the chains you chose to break. The tank keeps Korgath in the middle meanwhile.',
      strainSummary:
        'While any chain holds: every {every} sec, a {cast} sec cast, then a blast in a {radius} yd ring around each pillar whose chain still holds: {min} to {max} damage and a knockback. It stops once all four chains are broken.',
      strainResponse: 'Step away from every pillar with an intact chain before the cast ends.',
      stompSummary:
        'Every {every} sec, a {cast} sec cast, then a ring {radius} yd past his body: {min} to {max} damage to everyone inside.',
      stompResponse:
        'Ranged players stay outside the ring. Melee step out if they can; healers top up anyone it hits.',
      rerivetSummary:
        '{delay} sec after a chain breaks, a Broodsworn Goadsmith climbs over the rim behind its pillar, walks to the Shackle and channels Re-rivet for {channel} sec. If it finishes, the chain and a fresh Shackle return with their {perChain} damage cut, but the freed attack stays.',
      rerivetResponse: 'Interrupt, stun or kill the Goadsmith before the channel ends.',
      lastLinkName: 'Last Link',
      lastLinkSummary:
        'While exactly one chain is left, Strain comes every {every} sec instead of every {base} sec.',
      lastLinkResponse:
        'Break the last chain quickly, or stay ready to leave its pillar every {every} sec.',
      maulSummary:
        'Hammer chain broken: every {every} sec, a {cast} sec cast, then a {arc} degree cleave in front of him, {range} yd past his body, for {mult} times his melee hit.',
      maulResponse:
        'Only the tank stands in front. Everyone else moves behind him during the cast.',
      flailSummary:
        'Tongs chain broken: every {every} sec, a {cast} sec cast paints a {length} yd lane at the farthest player who is not the tank, then the whip hits everyone in it: {min} to {max} damage.',
      flailResponse: 'Step sideways out of the lane before the cast ends.',
      chargeSummary:
        'Anvil chain broken: he can leave the middle of the terrace. Every {every} sec, a {cast} sec cast paints a {length} yd lane at the farthest player, then he charges down it: {min} to {max} damage and a knockback.',
      chargeResponse:
        'Step out of the lane. While the Anvil chain holds he stays within {leash} yd of the middle and never charges.',
      bellowSummary:
        'Bellows chain broken: every {every} sec, a {cast} sec cast, then {min} to {max} damage to everyone and a {push} yd shove away from him.',
      bellowResponse:
        'It hits the whole group and cannot be avoided: healers top everyone up before it lands.',
      tipTank:
        'Hold him in the middle, facing away from the group. Once the Hammer chain breaks, Maul Arc hits everything in front of him. Until the Anvil chain breaks he cannot leave {leash} yd of the middle.',
      tipHealer:
        'Strain, Shuddering Stomp and every freed attack land hard. Each chain left on makes the fight longer; each chain broken adds an attack to heal through.',
      tipDamage:
        'Kill Shackles to break the chains you chose, then burn Korgath. Step out of painted lanes and away from pillars that still hold a chain.',
      tipDamageHeroic:
        'Kill Shackles to break the chains you chose, then burn Korgath. Stop every Goadsmith before its Re-rivet ends. Step out of painted lanes and away from pillars that still hold a chain.',
      choiceName: 'How many chains do you break?',
      choiceGain:
        'Each broken chain removes {perChain} of his damage cut: from {all} with all four chains, down to none. The fight gets much shorter.',
      choiceRisk:
        "Each broken chain frees one attack for the rest of the pull. Hammer: Maul Arc. Tongs: Chain Flail. Anvil: Threshold Charge, and he can leave the middle. Bellows: Foreman's Bellow.",
      choiceRiskHeroic:
        "Each broken chain frees one attack for the rest of the pull. Hammer: Maul Arc. Tongs: Chain Flail. Anvil: Threshold Charge, and he can leave the middle. Bellows: Foreman's Bellow. A Goadsmith also comes to re-rivet each broken chain.",
      heroicRerivet:
        'Re-rivet: {delay} sec after a chain breaks, a Goadsmith tries to restore it. Interrupt, stun or kill it.',
      heroicLastLink: 'Last Link: with one chain left, Strain comes every {every} sec.',
    },
    velkhar: {
      overview:
        'Velkhar raises the thawed dead from three meltwater pools. Only the cold keeps them down: a Bonewalker killed on dry ice stays dead, but one killed in meltwater rises again and heals him.',
      phaseVaultName: 'The Ritual Vault',
      phaseVaultSummary:
        'Bonewalkers keep climbing out of the pools. At {wave1} and {wave2} health an extra wave rises, one from each pool.',
      thawName: 'Waking Thaw',
      thawSummary:
        "Every {every} sec one pool's pyre roars and {count} Raised Bonewalkers climb out {warn} sec later. The pools take turns. At {wave1} and {wave2} health, one more climbs out of each pool.",
      thawResponse:
        'The tank gathers them and drags them onto dry ice. Damage dealers kill them there.',
      heldName: 'Held and Unquenched',
      heldSummary:
        'A Bonewalker killed on dry ice is Held: it freezes into a statue and stays dead. One killed in meltwater sinks, then rises again {delay} sec later at {share} health and heals Velkhar for {heal} of his health.',
      heldResponse: 'Kill Bonewalkers only on dry ice: never in a pool or on a meltwater strip.',
      graspName: 'Grasp of the Thawed',
      graspSummary: 'A Bonewalker standing in meltwater deals {bonus} more damage.',
      graspResponse: 'The tank keeps Bonewalkers out of the water.',
      trenchSummary:
        "Every {every} sec, a {cast} sec cast paints a {width} yd lane from him toward a player who is not the tank, out to the vault's rim. Then {min} to {max} damage to everyone in it, and the lane stays meltwater for {seconds} sec.",
      trenchResponse:
        'Step out of the lane. Do not kill Bonewalkers on the meltwater strip it leaves.',
      volleySummary:
        'Every {every} sec, a {cast} sec cast, then {min} to {max} shadow damage to everyone.',
      volleyResponse: 'It cannot be avoided: healers keep the whole group topped up.',
      warmHandsName: 'Warm Hands',
      warmHandsSummary:
        'A Bonewalker that stands still for {still} sec melts a {radius} yd meltwater puddle under itself for {seconds} sec.',
      warmHandsResponse:
        'Keep the Bonewalkers moving, and never finish one off on top of a puddle.',
      twiceWokenName: 'Twice-Woken',
      twiceWokenSummary:
        'A Bonewalker that rises again comes back at full health and deals {bonus} more damage.',
      twiceWokenResponse: 'Do not let any rise: kill them all on dry ice.',
      tipTank:
        'Pick up every Bonewalker and drag it onto dry ice, out of the pools and the meltwater strips. In meltwater they hit {bonus} harder.',
      tipTankHeroic:
        'Pick up every Bonewalker and drag it onto dry ice, out of the pools and the meltwater strips. Keep them moving: one that stands still melts a puddle under itself.',
      tipHealer:
        'Shadow Volley hits everyone every {every} sec. Bonewalkers in meltwater hit {bonus} harder, so watch the tank when they reach water.',
      tipDamage:
        'Kill Bonewalkers only on dry ice, then return to Velkhar. Step out of the Soulfire Trench lane.',
      choiceName: 'Where do the dead fall?',
      choiceGain:
        'A Bonewalker killed on dry ice is gone for good: fewer adds and a cleaner fight.',
      choiceRisk:
        'Killed in meltwater, it rises again and heals Velkhar for {heal} of his health each time. Dragging them to dry ice costs time, so plan the kill spot before you burn them.',
      heroicWarmHands:
        'Warm Hands: a Bonewalker that stands still for {still} sec melts a meltwater puddle.',
      heroicTwiceWoken:
        'Twice-Woken: a Bonewalker that rises again returns at full health and deals {bonus} more damage.',
    },
    korzul: {
      overview:
        'A dragon fight on a frozen lake his fire keeps breaking. Every breath spends ice, and the group aims his fire, so the group decides which ice to lose. A wyrm with no ice left breathes without pause.',
      phaseLakeName: 'The Frozen Lake',
      phaseLakeSummary:
        'He bursts out of the ice and lands in the middle of the lake. His fight starts when he touches down.',
      phaseFlightName: 'Flights',
      phaseFlightSummary:
        'At {first} and {second} health he takes off and fights from the air until he crashes back down.',
      phaseLastName: 'The Last Phase',
      phaseLastSummary:
        'After the second flight: Grave Breath every {breath} sec and Wing Gale every {gale} sec on the ground.',
      iceName: 'Breaking Ice',
      iceSummary:
        'The lake is made of ice plates. His fire cracks an uncracked plate and breaks a cracked one. A cracked plate refreezes after {refreeze} sec. A broken plate is open water.',
      iceHeroicSummary:
        'The lake is made of ice plates. His fire cracks an uncracked plate and breaks a cracked one. Deep Quench: on Heroic a cracked plate never refreezes. A broken plate is open water.',
      iceResponse: 'Spend ice on purpose: aim his fire at plates the group can afford to lose.',
      waterName: 'Open Water',
      waterSummary:
        'Standing in open water slows you by {slow} and deals {perSecond} damage per second.',
      waterResponse: 'Stay on the ice. Leave the water at once if a shove puts you in it.',
      breathSummary:
        "Every {every} sec, a {cast} sec cast along the tank's line, then a {arc} degree fire cone {range} yd past his body: {min} to {max} damage to everyone in it except the tank. Up to {plates} plates under the cone burn, nearest first.",
      breathResponse:
        'Only the tank stands in front. The tank turns the breath toward ice the group can spare.',
      tailSummary:
        'Every {every} sec, a {cast} sec cast, then his tail sweeps the {arc} degrees behind him, {range} yd past his body: {min} to {max} damage and a knockback.',
      tailResponse: 'Never stand behind him. Attack from his sides.',
      infernoSummary:
        'Every {every} sec, and once at {health} health, he channels for {duration} sec: {pulses} fire pulses within {radius} yd, each stronger than the last (the last pulse deals {min} to {max}). Pulse {crack} cracks the plate under him and pulse {brk} breaks it: when it breaks he is Doused and the channel ends.',
      infernoResponse:
        'Get {radius} yd away from him. Start him on a cracked plate and the channel ends at pulse {crack}.',
      galeSummary: 'A {cast} sec cast, then everyone is pushed {push} yd away from him.',
      galeResponse: 'Keep open water behind you clear, so the push lands you on ice.',
      plungeSummary:
        "In the air he marks a player who is not the tank with Wyrm's Eye for {eye} sec. When it ends he pours Plunging Fire on that player's whole plate: a {warn} sec warning, then {min} to {max} damage to anyone on it, and the plate burns. {roundsFirst} rounds in the first flight, {roundsSecond} in the second.",
      plungeHeroicSummary:
        "In the air he marks two players who are not the tank with Wyrm's Eye for {eye} sec (Twin Eyes). When it ends he pours Plunging Fire on each marked player's whole plate: a {warn} sec warning, then {min} to {max} damage to anyone on it, and the plate burns. {roundsFirst} rounds in the first flight, {roundsSecond} in the second.",
      plungeResponse:
        'Marked: walk to an uncracked plate away from the group. Everyone else leaves that plate.',
      broodName: 'Brood from Below',
      broodSummary: 'When he takes off, a Scaleguard climbs out of each broken plate, up to {max}.',
      broodResponse: 'The tank picks them up and the group kills them while he is in the air.',
      descentSummary:
        'He ends each flight by landing on the unbroken plate with the most players: a {warn} sec shadow, then {min} to {max} damage within {radius} yd and a knockback, and that plate burns.',
      descentResponse:
        'Gather on a plate you can afford to crack, then run out of the shadow before he lands.',
      flareName: 'Shard Flare',
      flareSummary:
        'After the second flight the shard flares: Grave Breath every {breath} sec and Wing Gale every {gale} sec, on the ground.',
      flareResponse: 'Breaths come faster: plan which plates are left to spend.',
      noIceName: 'No Ice Left',
      noIceSummary:
        'If every plate is broken, he hovers over the open water and breathes without pause.',
      noIceResponse: 'Never run out of ice: it ends the fight in a wipe.',
      tipTank:
        'Turn Grave Breath onto ice the group can spare, never across the group. Move him onto a cracked plate before a Grave Inferno to cut it short.',
      tipHealer:
        'Grave Inferno pulses grow fast: make sure everyone leaves. Plunging Fire, Crashing Descent and every knockback into water hit hard.',
      tipDamage:
        "Never stand in front of him or behind him. With Wyrm's Eye, take it to an uncracked plate away from the group. Kill the Scaleguards during flights.",
      tipDamageHeroic:
        "Never stand in front of him or behind him. Two players get Wyrm's Eye at once: each takes it to a different uncracked plate away from the group. Kill the Scaleguards during flights.",
      choiceIceName: 'Which ice do you spend?',
      choiceIceGain:
        'Aim his breath, his Plunging Fire and his landing at chosen plates and the rest of the lake stays safe to stand on.',
      choiceIceRisk:
        'Every broken plate is open water, and each one lets a Scaleguard climb out at his next flight (up to {max}). With no ice left he breathes without pause.',
      choiceDouseName: 'Douse the Inferno?',
      choiceDouseGain:
        'With him on a cracked plate, pulse {crack} breaks it, he is Doused and Grave Inferno ends early, before the strongest pulses.',
      choiceDouseRisk:
        'That plate is gone for good. Left on uncracked ice, the channel runs to pulse {brk} and still breaks the plate.',
      heroicDeepQuench: 'Deep Quench: a cracked plate never refreezes.',
      heroicTwinEyes: "Twin Eyes: Wyrm's Eye marks two players at once.",
    },
  },
  // The Smith's Heart raid journal (src/ui/boss_journal/raids/smith_heart.ts):
  // the Hammer Council, Aerwyn, Aurora, Ignazhar and Ashgrand on Normal and
  // Heroic, every number a placeholder resolved per tier from the encounters'
  // tuning. Wordy (M16): non-Latin fills in the five overlays.
  smithHeart: {
    common: {
      softEnrageName: 'Soft Enrage',
      skyStrikeName: 'Sky Strike',
      crossingBladeName: 'Crossing Blade',
      groaningIceName: 'Groaning Ice',
      furyPhaseName: 'Forge-Fury',
      furyPhaseSummary: 'Heroic only: the hard enrage, {minutes} min after the pull.',
      furyName: 'Forge-Fury',
      furySummary:
        'Gathering Forge-Fury warns {warn} sec ahead. At {minutes} min after the pull, every {every} sec it burns everyone in the fight for {share} of their maximum health, then {share2}, and burn {kill} kills them whatever shields them. The clock counts every second of the fight, downtime included, and the fury waits while the boss cannot be harmed.',
      furyResponse: 'Defeat the boss before the timer runs out.',
      heroicFury: 'Forge-Fury: {minutes} min after the pull, the fight burns the raid away.',
      chipTankSwap: 'Tank swap fight',
      chipEnrage: 'Hard enrage at {minutes} min',
    },
    council: {
      pageName: 'Hrothmar and Velmira',
      overview:
        "Hrothmar, the Unyielding Hammer, and Velmira, the Seam Singer, fight as one in the Quarry. Hrothmar is the tank boss: his Mountain's Wrath strikes everyone not hidden behind a pillar. Velmira is the caster: she raises the pillars the raid hides behind and sings the stone loose. When one falls, the other heals, grows faster and takes up its abilities, so bring them down together.",
      tagline:
        "Two stone guardians fight as one in the Quarry: hide behind a pillar from Hrothmar's Wrath, interrupt Velmira's songs and bring both down together.",
      chipBosses: '{count} bosses, one fight',
      chipTogether: 'Kill both within {arrive} sec',
      phaseHammerName: 'Hrothmar, the Unyielding Hammer',
      phaseHammerSummary:
        "The tank boss. His energy fills from 0 to {energy} in about {fill} sec; at full energy he casts Mountain's Wrath.",
      wrathSummary:
        "At full energy, a {cast} sec cast, then everyone in the Quarry outside a pillar's shadow takes {min} to {max} damage and every pillar shatters. The first Wrath also destroys the five carved columns for the rest of the fight.",
      wrathHeroicSummary:
        "At full energy, a {cast} sec cast, then everyone in the Quarry outside a pillar's shadow takes {min} to {max} damage: only a tank under a strong defensive lives through it. Every pillar then shatters, and the first Wrath also destroys the five carved columns.",
      wrathResponse:
        'Hide in the shadow behind a pillar, on the far side from the caster. One pillar shields at most {limit} players: with more behind it, each takes {share} of the blast. After the first Wrath, only pillars raised by Wake the Stone give cover.',
      enrageSummary:
        'Once {wraths} Wraths have landed, his energy fills {mult} times as fast: a Wrath about every {cycle} sec.',
      enrageResponse: 'Plan to finish the council before then.',
      weightSummary:
        'Every {every} sec, a {cast} sec cast at his tank: a blow of {mult} times a normal swing, then the tank takes {taken} more physical damage for {seconds} sec.',
      weightResponse:
        'The other tank taunts as soon as it lands. A tank must never take two in a row.',
      hammerfallName: 'Hammerfall',
      hammerfallSummary:
        'Every {every} swings, his blow sweeps a {arc} degree arc in front of him, out to {range} yd, hitting everyone in it for {share} of a swing.',
      hammerfallResponse: 'Only the tank stands in front of Hrothmar.',
      rushSummary:
        'Every {every} sec, a {cast} sec cast marks a player who is not tanking and raises a Cursed Pillar. Then he charges along the line from him through that player to the edge of the Quarry, stopping at the first pillar in his way. Everyone he runs into takes {min} to {max} damage and is thrown {knock} yd.',
      rushResponse:
        'Marked: put the Cursed Pillar between you and Hrothmar, then step off the line. Breaking it stuns him for {stun} sec, and he takes {exposed} more damage for {exposedSeconds} sec. A sheltering pillar in his way is destroyed instead.',
      cursedName: 'Cursed Pillar',
      cursedSummary:
        "While it stands, the Cursed Pillar deals {min} to {max} damage to the whole raid every {every} sec. It shelters nobody from the Wrath, and only Mountain's Rush or a Wrath can break it.",
      cursedResponse: "Break it with Mountain's Rush as soon as you can.",
      phaseSingerName: 'Velmira, the Seam Singer',
      phaseSingerSummary:
        'The caster. Seam Bolt, Song of the Seam and Wake the Stone can all be interrupted.',
      wakeSummary:
        'Every {every} sec, and {after} sec after each Wrath lands, a {cast} sec cast marks {marks} players for {mark} sec. When the mark ends, a pillar bursts out where each one stands, dealing {min} to {max} damage to everyone within {radius} yd and throwing them back. An interrupted cast raises nothing.',
      wakeResponse:
        'Let through the cast the next Wrath needs and interrupt the rest. Marked players stand where the raid wants its cover, clear of each other.',
      thrumName: 'Stone Thrum',
      thrumSummary:
        'Every pillar Wake the Stone raised that still stands deals {min} to {max} damage to the whole raid every {every} sec, each pillar adding its own. The carved columns never ring.',
      thrumResponse: 'Keep only the pillars the next Wrath needs: every extra one costs healing.',
      restlessName: 'Restless Stone',
      restlessSummary:
        'Every {every} sec, every standing pillar deals {min} to {max} damage to anyone within {reach} yd of it.',
      restlessResponse: 'Stand clear of the stone until a Wrath is coming.',
      rockSummary:
        'Every {every} sec, she marks a player for {mark} sec, then a rock falls on them: {total} damage split between everyone within {radius} yd. With fewer than {soakers} under it, each takes {penalty} more and the whole raid takes {tremorMin} to {tremorMax}. Every pillar within {radius} yd loses a piece.',
      rockResponse:
        'Gather at least {soakers} players in the gold circle, away from any pillar you still need.',
      boltSummary:
        'Every {every} sec, a {cast} sec cast at a random player she can see: {min} to {max} Nature damage. It cannot land on a player out of her sight.',
      boltResponse: 'Interrupt it.',
      songSummary:
        'A {cast} sec cast that begins {after} sec after each Wrath lands. Sung out, it puts Resonance on {marks} players; interrupted, on {kicked}.',
      songHeroicSummary:
        'Every {every} sec, a {cast} sec cast on its own clock, so its Resonance can overlap a Wrath. Sung out, it puts Resonance on {marks} players; interrupted, on {kicked}.',
      songResponse: 'Interrupt it every time.',
      resonanceName: 'Resonance',
      resonanceSummary:
        'For {seconds} sec, every {every} sec the marked player rings, dealing {min} to {max} Nature damage to every ally within {radius} yd of them.',
      resonanceResponse: 'Marked: move {radius} yd away from everyone until it ends.',
      resonanceHeroicResponse:
        "Marked: move {radius} yd away from everyone until it ends. If a Wrath is coming, take a pillar's shadow of your own.",
      phaseFallName: 'When One Falls',
      phaseFallSummary: 'The fight ends only when both are dead.',
      furyName: 'Grieving Fury',
      furySummary:
        'When one falls, its soul reaches the other {arrive} sec later. The survivor heals {heal} of its health at once, deals {damage} more damage, and attacks, casts and runs every ability {haste} faster for the rest of the fight.',
      furyResponse:
        'Bring both low together and kill the second within {arrive} sec of the first: the soul then arrives too late.',
      inheritName: 'Inherited Abilities',
      inheritSummary:
        "With the soul, the survivor takes up the fallen one's abilities at full strength. Hrothmar fallen: Velmira fills his energy and casts Mountain's Wrath. Velmira fallen: Hrothmar casts Wake the Stone and Song of the Seam. Mountain's Rush and Falling Rock end with their caster.",
      inheritHeroicSummary:
        "With the soul, the survivor takes up the fallen one's abilities at full strength. Hrothmar fallen: Velmira fills his energy and casts Mountain's Wrath and Hammer's Weight. Velmira fallen: Hrothmar casts Wake the Stone, Song of the Seam and Seam Bolt. Mountain's Rush and Falling Rock end with their caster.",
      inheritResponse:
        'Whoever lives, keep the same plan: pillars for the Wrath, interrupts for the songs, tank swaps for the Weight.',
      tipTank:
        "Swap on every Hammer's Weight. Hold Hrothmar and Velmira close together so the raid can bring them down at the same time. On Heroic, a tank caught outside cover by the Wrath needs a strong defensive.",
      tipHealer:
        "Top everyone up before each Wrath. Stone Thrum and the Cursed Pillar strike the whole raid for as long as their stone stands, and Falling Rock's soakers need healing after it lands.",
      tipDamage:
        'Interrupt every Seam Bolt and Song of the Seam. Let one Wake the Stone through before each Wrath and interrupt the rest. Watch both health bars: the second must fall within {arrive} sec of the first.',
      heroicWrath:
        "Mountain's Wrath kills anyone outside a pillar's shadow. Each pillar shields only {limit} players, and a crowded one lets {share} of the blast through.",
      heroicOverlap:
        "Wake the Stone marks {marks} players, and its marks, Mountain's Rush and Resonance can now come during a Wrath's cast.",
      heroicFury:
        "Grieving Fury heals the survivor {heal} at once, and it also takes up the fallen one's second ability.",
    },
    breath: {
      overview:
        'Aerwyn, the Unbound Gale, fights on the Storm Cornice, a ledge with no wall: every edge is a fall into the void. To half health it fights with the wind; at half it hides in a cocoon and sends the raid out to the floating isles; then the storm breaks and it fights as lightning to the end. Captain Thessaly fights beside you and lays circles of calm.',
      tagline:
        'A ledge with no wall above the void: walk into the wind, clear the floating isles at {at} health, then outlast the storm.',
      chipEdge: 'Falling off the edge kills',
      chipIsles: 'Floating isles at {at}',
      phaseWindName: 'The Wind',
      phaseWindSummary:
        'From the pull to {at} health. Anyone blown, thrown or walked off the edge of the Cornice falls into the void and dies.',
      windName: 'Bellows Wind',
      windSummary:
        'Over and over, the coming wind is drawn on the floor for {gather} sec, then it blows across the Cornice for {blow} sec, carrying anyone who stands still {speed} yd a second. Between blows the air is calm for {calmMin} to {calmMax} sec.',
      windResponse:
        'Before each blow, move to the side it blows from and walk into the wind while it blows. Never stand still near the edge.',
      calmName: 'Circle of Calm',
      calmSummary:
        'Every {every} sec, Captain Thessaly marks a circle on the floor; {land} sec later it lands and holds for {hold} sec. Up to {seats} players inside are anchored for {anchor} sec: no wind, pull or throw moves them.',
      calmHeroicSummary:
        'Every {every} sec, Captain Thessaly marks a circle on the floor; {land} sec later it lands and holds for {hold} sec. Up to {seats} players inside are anchored for {anchor} sec: no wind, pull or throw moves them. A player whose anchor ran out cannot be anchored again for {spent} sec.',
      calmResponse: 'Healers and ranged take the anchors when a blow or Indrawn Breath is due.',
      inhaleSummary:
        'Every {every} sec, a {cast} sec cast that draws everyone toward Aerwyn, {pull} yd a second. A vortex before its mouth deals {min} to {max} damage every {tick} sec to anyone in it.',
      inhaleResponse: 'Keep walking straight away from its mouth, or stand in a Circle of Calm.',
      roarSummary:
        'As the breath ends, a {cast} sec cast: {min} to {max} Nature damage to everyone on the Cornice, and each is thrown {throw} yd straight away from Aerwyn, then blown on for {gust} sec at {gustSpeed} yd a second. On Normal it always stops short of the edge.',
      roarHeroicSummary:
        'As the breath ends, a {cast} sec cast: {min} to {max} Nature damage to everyone on the Cornice, and each is thrown {throw} yd straight away from Aerwyn, then blown on for {gust} sec at {gustSpeed} yd a second. A throw that reaches the edge carries you off the Cornice.',
      roarResponse:
        'Stand close to Aerwyn when it roars, then walk straight back toward it while the gust blows, or stand in a Circle of Calm.',
      lanceSummary:
        'Every {every} sec, a {cast} sec cast at a player: a line {length} yd long and {width} yd wide strikes everyone in it for {min} to {max} Nature damage.',
      lanceResponse: 'Marked: turn the line away from the raid. Everyone else steps out of it.',
      skySummary:
        'In the Wind and the Storm, every {every} sec, lightning marks {marks} players and {spots} more spots. After {warn} sec it strikes for {min} to {max} damage within {radius} yd.',
      skyResponse: 'Step out of your circle, and keep the circles off the raid.',
      blowSummary:
        'Every {every} sec, a {cast} sec cast at the tank: {min} to {max} Nature damage, and it throws the tank straight away from Aerwyn, {first} yd at first and farther with each Wind-Battered stack, up to {last} yd. It never throws the tank off the Cornice. Stacks last {seconds} sec.',
      blowHeroicSummary:
        'Every {every} sec, a {cast} sec cast at the tank: {min} to {max} Nature damage, and it throws the tank straight away from Aerwyn, {first} yd at first and farther with each Wind-Battered stack. The blow at {ruin} stacks throws the tank off the Cornice. Stacks last {seconds} sec.',
      blowResponse: 'Swap tanks at {swap} stacks.',
      galeName: 'Loose Gale',
      galeSummary:
        'After each Indrawn Breath, {count} Loose Gales wander the Cornice for {seconds} sec. One that touches you deals {min} to {max} damage and tosses you {toss} yd.',
      galeResponse:
        'Watch them while you fight the wind, and never let one push you toward the edge.',
      knotName: 'Knotted Gale',
      knotSummary:
        'Every {every} sec in the Wind (up to {runs}) and every {stormEvery} sec in the Storm, a Knotted Gale drops on the Cornice with a {fuse} sec fuse. After {mark} sec, Portals A and B open at the feet of two marked players: walk into one to come out at the other. Its carrier walks at {walk} speed and throws it into the void with Interact at any edge. If it bursts, everyone within {core} yd dies and anyone farther takes less, down to {floor} of their health from {far} yd.',
      knotResponse:
        'One player picks it up and throws it off the nearest edge, using the portals as a shortcut. The marked players cannot carry it. Everyone else stays far away.',
      phaseIslesName: 'Islands of the Wind',
      phaseIslesSummary:
        'At {at} health, Aerwyn becomes untouchable and the raid splits between two chains of floating isles. Once both Stillstones are stilled, everyone is carried home and the storm breaks.',
      novaSummary:
        'Inside its Gale Cocoon, Aerwyn cannot be harmed and channels Skyrend Nova for {nova} sec. If the channel ends, the nova kills everyone, whatever shields them.',
      novaResponse:
        "Ride Captain Thessaly's Updrafts out to the isles, east and west, and still both Stillstones before the channel ends.",
      closingName: 'Closing Storm',
      closingSummary:
        "From the first landing on an isle, its storm closes for {closing} sec. When it runs out, Sky's Reckoning strikes every player on that isle every {every} sec for {share} of their maximum health.",
      closingResponse: 'Clear each isle before its storm closes.',
      isleBoltName: 'Isle Lightning',
      isleBoltSummary:
        "While an isle's foes stand, every {every} sec lightning marks one player and one spot on it. After {warn} sec it strikes for {share} of maximum health.",
      isleBoltResponse: 'Step out of the circles.',
      mendSummary:
        "The first isle's Gale Mender: every {every} sec, a {cast} sec channel that restores {share} of the health of each foe on its isle.",
      mendResponse: 'Interrupt it every time.',
      shoveSummary:
        "The second isle's Gust Herald: every {every} sec, a {cast} sec cast down a line toward a player. Everyone on the line slides {yards} yd toward the rim, stopping short of the edge.",
      shoveHeroicSummary:
        "The second isle's Gust Herald: every {every} sec, a {cast} sec cast down a line toward a player. Everyone on the line slides {yards} yd toward the rim, off the edge if it is near.",
      shoveResponse: 'Step out of the line, and never fight with your back to the rim.',
      squallName: 'Riven Squall',
      squallSummary:
        'On the second isle, the Riven Squall splits into two Squall Fragments as it dies.',
      squallResponse: 'Save some damage for the two Fragments.',
      wardName: 'Squall Ward',
      wardSummary:
        "The third isle's Squall Shieldbearer turns aside {cut} of the damage from attacks within {arc} degrees of its front.",
      wardResponse: 'The tank turns it away, and everyone attacks its back.',
      stoneName: 'Stillstone',
      stoneSummary:
        "Once its isle's foes are down, the Stillstone wakes. Everyone on the isle can channel it at once: alone it takes {solo} sec, and the more who channel, the faster it fills. A hit breaks your channel, never the stone's progress.",
      stoneResponse: 'Everyone on the isle channels it together.',
      phaseStormName: 'The Storm',
      phaseStormSummary: 'From {at} health to the end, Aerwyn fights as a body of lightning.',
      breakSummary:
        'As the raid comes home, a {cast} sec cast, then a barrage of lightning for {seconds} sec: strikes fall on marked spots every {every} sec, each {min} to {max} damage within {radius} yd.',
      breakResponse: 'Keep moving between the circles.',
      forkSummary:
        'Every {every} sec, a {cast} sec cast at a player: {min} to {max} Nature damage, then it leaps to the nearest player within {jump} yd, again and again.',
      forkResponse: 'Spread out, {jump} yd apart.',
      cradleSummary:
        'Every {every} sec, a {cast} sec cast lifts players into the storm ({count} at a time) for {hold} sec while Aerwyn channels and casts nothing else. Then the discharge deals {total} damage, split between everyone within {radius} yd below. With fewer than {soakers} under it, each takes {penalty} more and everyone on the Cornice takes {bMin} to {bMax}.',
      cradleHeroicSummary:
        'Every {every} sec, a {cast} sec cast lifts {count} players into the storm for {hold} sec while Aerwyn channels and casts nothing else. Then each discharge deals {total} damage, split between everyone within {radius} yd below that player. With fewer than {soakers} under one, each there takes {penalty} more and everyone on the Cornice takes {bMin} to {bMax}.',
      cradleResponse: "Gather at least {soakers} players under the lifted player's gold circle.",
      cradleHeroicResponse: 'Split the raid between the circles, at least {soakers} under each.',
      drawnSummary:
        'Every {every} sec, a player is marked for {seconds} sec. Every {strike} sec a strike falls at their feet: after {warn} sec it deals {min} to {max} damage within {radius} yd and leaves charged ground that deals {cMin} to {cMax} a second for {charged} sec.',
      drawnResponse: 'Marked: keep moving and lead the strikes to the edge, away from the raid.',
      thunderSummary:
        'Every {every} sec, a {cast} sec cast at the tank: {min} to {max} Nature damage and a Thunder-Laden stack for {seconds} sec, each making the tank take {per} more Nature and other magic damage. From {draw} stacks, every Leaping Bolt also leaps to that tank.',
      thunderResponse: 'Swap tanks at {swap} stacks.',
      swellName: 'Swelling Storm',
      swellSummary:
        'Every {every} sec, {min} to {max} damage to everyone on the Cornice, {growth} more for every pulse before it, without end.',
      swellResponse: "This is the fight's clock: save cooldowns for the end and finish it.",
      gustName: 'Storm Gusts',
      gustSummary:
        'In the Storm, every {every} sec the wind returns: drawn on the floor for {gather} sec, then it blows for {seconds} sec at {speed} yd a second.',
      gustResponse: 'Walk into it, away from the edge.',
      tipTank:
        'Swap at the Wind-Battered and Thunder-Laden counts. Keep Aerwyn facing away from the raid and its mouth clear of the edge, so its Indrawn Breath pulls the raid inward.',
      tipHealer:
        "Take Thessaly's anchors when you need to stand and cast. Heal through each Summit Roar and Thunder's Cradle, and ramp up as the Swelling Storm grows.",
      tipDamage:
        "Never stand still near the edge. Interrupt Mending Gale on the isles, attack the Shieldbearer's back, and channel each Stillstone together the moment it wakes.",
      heroicEdge:
        'Summit Roar, Shoving Gale and the Bellows Blow at {ruin} stacks can now carry a player off the edge.',
      heroicKnot:
        'The Knotted Gale must be thrown into the void in both halves, and Loose Gales roam after each Indrawn Breath.',
      heroicCradle: "Thunder's Cradle lifts {count} players at once: the raid splits between them.",
    },
    quench: {
      overview:
        "Aurora, the Silent Winter, rises from the Frozen Lake. Every player carries a cold bar that fills when alone and falls in a huddle, but a huddle that stands still breaks the ice beneath it. Stay together, but never for long. At half health all four of the Smith's blades wake and the cold deepens.",
      tagline:
        'Every player carries a cold bar on the Frozen Lake: huddle to stay warm, but keep the huddle moving or the ice breaks beneath it.',
      chipHuddle: 'Huddle in groups of {group} or more',
      chipBlades: 'All four blades wake at {at}',
      phaseColdName: 'The Cold',
      phaseColdSummary: 'All fight, on every player.',
      coldName: 'Quenching Cold',
      coldSummary:
        'Alone, your cold fills from 0 to {max} in about {fill} sec. Within {radius} yd of {others} or more other players it falls {fall} a second instead. Healing you receive lowers it by 1 for every {heal} of your maximum health healed.',
      coldResponse: 'Huddle in groups of three or more, and keep the huddle moving.',
      frozenName: 'Encased in Rime',
      frozenSummary:
        'At full cold you freeze solid for {freeze} sec and take {frozen} more damage. Then the ice shatters: {min} to {max} Frost damage, {brittle} more damage taken for {brittleSeconds} sec, and everyone within {radius} yd gains {cold} cold.',
      frozenResponse:
        'Never let your bar fill. Step away from a frozen player before the ice shatters.',
      iceSummary:
        'A huddle that stays on one spot for {linger} sec cracks the ice; {warn} sec later it opens into a hole of freezing water that lasts the whole fight. Falling in deals {pMin} to {pMax} Frost damage, adds {plunge} cold and holds you for {trap} sec, taking {tMin} to {tMax} a second. The water alone never kills.',
      iceResponse: 'Move the huddle before the ice cracks, and never walk into open water.',
      rimeName: 'Living Rime',
      rimeSummary:
        'Every {every} sec, a crust of ice closes on players who are not tanking ({targets} at a time): it absorbs the next {absorb} healing, slows them by {slow} and makes their cold rise {mult} times as fast. Heal it through within {seconds} sec, or they freeze at once and the cold bursts on everyone within {radius} yd, adding {cold} cold.',
      rimeHeroicSummary:
        'Every {every} sec, a crust of ice closes on {targets} players who are not tanking: it absorbs the next {absorb} healing, slows them by {slow} and makes their cold rise {mult} times as fast. Heal it through within {seconds} sec, or they freeze at once and the cold bursts on everyone within {radius} yd, adding {cold} cold, then leaps to the nearest other player with a fresh crust.',
      rimeResponse: 'Healers break the crust first. Its carrier leaves the huddle until it does.',
      phaseLakeName: 'The Lake',
      phaseLakeSummary: "From the pull to {at} health, two of the Smith's four blades are awake.",
      breathSummary:
        'Every {every} sec, a {cast} sec cast: a {arc} degree cone in front of her, out to {range} yd, deals {min} to {max} Frost damage and adds {cold} cold.',
      breathResponse: 'The tank keeps her facing away; nobody else stands in front of her.',
      temperSummary:
        "Every {every} landed swings, her fists slam a {arc} degree arc in front of her, out to {range} yd. Each Tempering Strike on the tank adds a Rime-Tempered stack for {seconds} sec: the tank's cold cannot fall below {cold} a stack, and it takes {frost} more Frost damage a stack. Stacks stop at {most}.",
      temperHeroicSummary:
        "Every {every} landed swings, her fists slam a {arc} degree arc in front of her, out to {range} yd. Each Tempering Strike on the tank adds a Rime-Tempered stack for {seconds} sec: the tank's cold cannot fall below {cold} a stack, and it takes {frost} more Frost damage a stack. At {most} stacks the tank freezes solid.",
      temperResponse: 'Swap tanks at {swap} stacks.',
      bladeSummary:
        'Every {every} sec, the awake blades mark players in turn ({marks} a round). A blade flies across the lake down a line through each, following them until it locks {lock} sec before it flies: anyone on the line takes {min} to {max} Frost damage and gains {cold} cold. The rounds come faster as she weakens.',
      bladeResponse: 'Marked: lead the line away from the raid, then step off it as it locks.',
      phaseBladesName: 'The Blades Wake',
      phaseBladesSummary: 'From {at} health to the end, all four blades are awake.',
      wakeSummary:
        'At {at} health, a {cast} sec cast: the other two blades tear free. From then on each round of Crossing Blades marks {marks} players, every {every} sec.',
      wakeResponse: 'Spread the marked players out so their lines never cross the huddles.',
      deepenName: 'Deepening Cold',
      deepenSummary:
        "Every {every} sec after the blades wake, everyone's cold rises {step} faster, without end.",
      deepenResponse: "This is the fight's clock: huddle tighter, heal harder, and finish it.",
      tipTank:
        'Keep Quenching Breath turned away from the raid. Swap at the Rime-Tempered count, and huddle with the raid whenever you are free.',
      tipHealer:
        'Your healing warms: it lowers cold as well as restoring health. Break every Living Rime crust before it bursts, and top up the frozen before the ice shatters.',
      tipDamage:
        'Keep your huddle moving so the ice never cracks under it. When a blade marks you, lead its line away from everyone and step off it as it locks.',
      heroicShatter: 'A shatter splashes {radius} yd and adds {cold} cold to everyone in it.',
      heroicRime:
        'Living Rime takes {targets} players, and its burst leaps on to the nearest other player.',
      heroicTemper: 'At {most} Rime-Tempered stacks the tank freezes solid: swap at {swap}.',
      heroicWarmth:
        'Living Warmth is halved: healing lowers cold by 1 for every {heal} of health healed.',
    },
    heat: {
      overview:
        'Ignazhar, the Unquenchable, stands sunk to its waist in the First Wellspring and never moves: the raid fights on the shore all around it. At {one} and {two} health it sinks and the Hearth overflows with rings of lava. Its tanks swap on Cinder Grip and Wellspring Brand.',
      tagline:
        'Sunk to its waist in the First Wellspring, it never moves: the raid fights on the shore all around it.',
      chipSinks: 'Sinks at {one} and {two}',
      chipPhases: '{phases} phases and {overflows} overflows',
      phaseAllName: 'Every Phase',
      phaseAllSummary: 'From the pull to the end, except while Ignazhar is sunk in an overflow.',
      wheelName: 'Wheel of the Hearth',
      wheelSummary:
        "Every {every} sec, the shore is cut into four wedges in front of Ignazhar and four behind it. On each side three glow and erupt after {warn} sec for {min} to {max} Fire damage, then burn {burn} sec more; one stays dark and safe. {rounds} rounds run back to back, each side's safe wedge one or two over from the last.",
      wheelResponse:
        "Stand in your side's dark wedge, and cross to the next safe wedge the moment the fire dies.",
      fistSummary:
        'Every {every} sec, a {cast} sec cast at the spots where marked players stood ({marks} at a time): anyone within {radius} yd when it slams takes {min} to {max} Fire damage. Then three Molten Swells roll {length} yd out from each spot, away from the wellspring and to either side, dealing {wMin} to {wMax} to everyone they roll over.',
      fistHeroicSummary:
        'Every {every} sec, a {cast} sec cast at the spots where {marks} marked players stood: anyone within {radius} yd when it slams takes {min} to {max} Fire damage. Then three Molten Swells roll {length} yd out from each spot, away from the wellspring and to either side, dealing {wMin} to {wMax} to everyone they roll over.',
      fistResponse:
        'Marked: leave the spot. Everyone stands in the gaps between the lanes; the side toward Ignazhar is always clear.',
      gripName: 'Cinder Grip',
      gripSummary:
        "Each of Ignazhar's landed swings adds a stack to its tank: {per} Fire damage a second for each stack, up to {most}, for {seconds} sec. While Ignazhar is sunk, the stacks hold: they neither burn nor run down.",
      gripResponse: 'Swap tanks at {swap} stacks.',
      brandSummary:
        'Every {every} sec, whatever Ignazhar is doing, it hurls a brand at its tank, told {lead} sec ahead: {min} to {max} Fire damage, and the tank takes {taken} more Fire and other magic damage for {seconds} sec. It never comes while Ignazhar is sunk.',
      brandResponse:
        'The other tank taunts after every brand: the mark lasts longer than the gap to the next one.',
      coalSummary:
        'Every {every} sec, {count} players who are not tanking carry a Live Coal: it absorbs the next {absorb} healing and burns them for {bMin} to {bMax} Fire damage a second. Anyone who comes within {leap} yd takes it over and {lMin} to {lMax} damage. Not healed through within {seconds} sec, it bursts for {xMin} to {xMax} on everyone within {radius} yd.',
      coalResponse: 'Healers burn through the absorb. Carriers keep {leap} yd from everyone.',
      phaseOneName: 'Phase One',
      phaseOneSummary: 'From the pull to {one} health.',
      flareName: 'Hearth Flare',
      flareSummary:
        "Every {every} sec, everyone farther than {reach} yd from the wellspring's centre takes {min} to {max} Fire damage and is Flare-Scorched: {pct} more Fire and other magic damage taken for {seconds} sec. In later phases it strikes only its tank, and only from out of reach.",
      flareResponse: 'Everyone fights close to the wellspring.',
      phaseOverflowName: 'The Overflows',
      phaseOverflowSummary:
        'At {one} and {two} health, Ignazhar sinks into the wellspring and cannot be harmed until the last ring of lava has passed.',
      wavesName: 'Wellspring Overflow',
      wavesSummary:
        "Rings of lava roll out of the wellspring one after another: {first} in the first overflow, {second} in the second, faster and narrower. Each ring parts in two gaps, and the next ring's gaps glow on the floor before it comes. A ring deals {min} to {max} Fire damage to anyone outside a gap.",
      wavesResponse: 'Walk to the glowing gaps before each ring arrives.',
      boltName: 'Falling Cinder',
      boltSummary:
        'Every {every} sec during an overflow, {bolts} random players take {min} to {max} Fire damage.',
      boltResponse: 'Keep the raid topped up through the overflow.',
      spawnName: 'Wellspawn',
      spawnSummary:
        'In the first overflow only, {spawn} Wellspawn climb out at the edge of the room and walk slowly to the wellspring, slowing as they lose health and crawling below {slowAt}. One that reaches it heals Ignazhar by {heal} and deals {min} to {max} Fire damage to the whole raid.',
      spawnHeroicSummary:
        'In each overflow, {spawn} Wellspawn climb out at the edge of the room and walk to the wellspring, slowing as they lose health and crawling below {slowAt}. One that reaches it heals Ignazhar by {heal} and deals {min} to {max} Fire damage to the whole raid.',
      spawnResponse: 'Slow, stun and burn them down before they reach the lip.',
      keeperName: 'Wellkeepers',
      keeperSummary:
        'In the second overflow, two Wellkeepers rise by the wellspring and must be tanked. Every {every} sec each puts a Kindling Mark on a player: {mark} sec later that player trails fire for {trail} sec. Each patch deals {min} to {max} Fire damage a second and heals a Wellspawn standing in it by {heal} of its health a second.',
      keeperResponse:
        "Tanks pick up the Wellkeepers. Marked players lead their trail away from the raid and the Wellspawn's path.",
      phaseTwoName: 'Phase Two',
      phaseTwoSummary: 'From {one} to {two} health.',
      seedName: 'Hearthseed',
      seedSummary:
        "Every {every} sec, Ignazhar hurls a seed of flame at every player's spot (up to {cap}). Each bursts {life} sec after the throw for up to {max} Fire damage, less the farther you stand, and nothing beyond {reach} yd.",
      seedHeroicSummary:
        "Every {every} sec, Ignazhar hurls a seed of flame at every player's spot (up to {cap}). Each bursts {life} sec after the throw for up to {max} Fire damage, less the farther you stand, and nothing beyond {reach} yd. Each burst hatches a Seedflame that hunts one player.",
      seedResponse: 'Drop the seeds together, away from the raid, then run.',
      seedHeroicResponse:
        'Drop the seeds together, away from the raid, then run. Burn the Seedflames down together.',
      zoneName: 'Wakefire',
      zoneSummary:
        'In phases two and three, every {every} sec three bands round the wellspring ignite one after another, from Ignazhar outward. Each warns {warn} sec, then deals {min} to {max} Fire damage to everyone in it and burns {burn} sec more. The next band starts its warning {step} sec after the last.',
      zoneResponse: 'Step into the band that has just burned.',
      phaseThreeName: 'Phase Three',
      phaseThreeSummary: 'From {two} health to the end.',
      cinderName: 'Rolling Cinder',
      cinderSummary:
        'Every {every} sec, a great fireball lands on the shore, dealing {lMin} to {lMax} within {land} yd, and hunts one player at {speed} yd a second. If it reaches them they die, and everyone within {splash} yd takes {sMin} to {sMax}. Every strike knocks it {knock} yd back, then not again for {crust} sec. It cannot be killed.',
      cinderResponse: 'The hunted player kites it while assigned players strike it back in turn.',
      lateSummary:
        'Once phase three has run {after} sec, the Rolling Cinders fall every {late} sec instead.',
      lateResponse: 'Push damage to finish Ignazhar before the cinders pile up.',
      tipTank:
        'Swap at the Cinder Grip count and after every Wellspring Brand. The stacks hold while Ignazhar is sunk, so the swap is still owed when it rises.',
      tipHealer:
        "The overflows hurt everyone at once: lava rings, Falling Cinders and any Wellspawn that feeds the well. On Heroic, burn through every Live Coal's absorb before it bursts.",
      tipDamage:
        'Kill the Wellspawn before they reach the wellspring. In phase three, take your turn striking the Rolling Cinder back, then wait out its crust.',
      heroicFist: 'Basalt Fist marks {marks} players at once, each slamming its own spot.',
      heroicAdds:
        'Each overflow raises {spawn} Wellspawn, and the second also raises two Wellkeepers. Hearthseeds hatch Seedflames.',
      heroicCoal: 'Live Coals burn two players at a time through every fighting phase.',
      heroicWheel: 'The Wheel of the Hearth warns only {warn} sec and erupts at full strength.',
    },
    final: {
      overview:
        'Ashgrand, Remnant of the Masterless Strength, fights on the Anvil of the World, cut into four quarters: the Heat, the Quench, the Breath and the Hammer. The quarter it stands in is the strength it drinks, so its tank drags it from quarter to quarter before any bar bursts. At {first} and {second} health it calls its Splinters; at {final} all four quarters wake for the end.',
      tagline:
        'It drinks the strength of the quarter it stands in: its tank drags it from quarter to quarter before any Overload bar bursts.',
      chipQuarters: '{count} elemental quarters',
      chipSplinters: 'Splinters at {first} and {second}',
      chipFinal: 'Final stand at {final}',
      phaseQuartersName: 'The Four Quarters',
      phaseQuartersSummary:
        "A ring lies at the Anvil's centre and four quarters round it. Each quarter's own abilities begin {delay} sec after Ashgrand enters it.",
      overloadName: 'Overload',
      overloadSummary:
        'Each quarter has an Overload bar that fills while Ashgrand stands in it (empty to full in {fill} sec) and drains at a third of that speed elsewhere. The filling bar pulses the raid every {every} sec, from {min} damage when empty to {max} when full. A full bar bursts on the whole raid for {bMin} to {bMax} and empties.',
      overloadResponse:
        'Tanks drag it through three or four quarters in turn, never back and forth between two.',
      unboundName: 'Heart Unbound',
      unboundSummary:
        'While Ashgrand stands in the central ring, after {delay} sec it gains a stack every second, and every second it deals {per} damage a stack to the whole raid.',
      unboundResponse: 'Drag it out of the ring at once.',
      shockName: 'Vein Shock',
      shockSummary:
        'Every quarter change strikes the raid for {min} to {max} and leaves it Vein-Shaken for {seconds} sec: a change while shaken hits {mult} times as hard.',
      shockResponse: 'Change quarters only when the raid is healthy, and never twice in a row.',
      phaseOwnName: 'Its Own Strength',
      phaseOwnSummary: 'All fight, wherever Ashgrand stands.',
      forgeFistName: 'Forge Fist',
      forgeFistSummary:
        'Every {every} swings, its fist sweeps a {arc} degree arc in front of it, out to {range} yd, for {share} of a swing to everyone in it.',
      forgeFistResponse: 'Only the tank stands in front of Ashgrand.',
      strikeSummary:
        "Every {every} sec, its tank takes {min} to {max} at one stack, {growth} more for each stack, and a stack of its quarter's element for {seconds} sec: Searing Burn ({burn} Fire damage a second a stack), Biting Frost ({slow} slower a stack; from {freeze} stacks a ring that freezes anyone still in it), Static Charge (from {arc} stacks it arcs to allies within {reach} yd) or Cracked Armor ({armor} less armor a stack).",
      strikeResponse:
        'Swap tanks at {swap} stacks. Melee keep {reach} yd from a tank with Static Charge.',
      anvilSummary:
        'Every {every} sec, a {cast} sec cast marks a player; a {radius} yd circle follows them and plants {lock} sec before it falls. {total} Physical damage is split between everyone inside, half as much again each with fewer than {fewer}. With nobody under it, the whole raid takes {missMin} to {missMax}.',
      anvilResponse: 'The whole raid gathers on the marked player before the circle plants.',
      opposingName: 'Opposing Elements',
      opposingSummary:
        'Every {every} sec, {marks} players who are not tanking are marked Fire, Ice, Earth or Lightning, in opposite pairs, for {seconds} sec. Two opposites within {meet} yd cancel both marks; any other meeting explodes for {min} to {max} Arcane damage to both. A mark not cancelled in time deals {lMin} to {lMax} to its player.',
      opposingHeroicSummary:
        'Every {every} sec, every player who is not tanking is marked Fire, Ice, Earth or Lightning, in opposite pairs, for {seconds} sec. Two opposites within {meet} yd cancel both marks; any other meeting explodes for {min} to {max} Arcane damage to both. Every pair not cancelled in time deals {lMin} to {lMax} to the whole raid.',
      opposingResponse:
        'Find your opposite (Fire with Ice, Earth with Lightning) and meet, staying clear of every other mark.',
      phaseFusionName: 'Elemental Fusion',
      phaseFusionSummary:
        'Each time Ashgrand enters a new quarter (never its first), it plants for a {cast} sec cast and fuses the element it left with the one it entered, inside the quarter it entered.',
      fusionSummary:
        "A {cast} sec cast on each move into a new quarter. The quarter's own abilities wait while it casts, and the combo lands as it ends.",
      fusionResponse: 'Know which two quarters it joined and get ready for that combo.',
      steamName: 'Scalding Steam',
      steamSummary:
        'The Heat and the Quench: clouds of steam ({clouds} at a time) rise after {warn} sec and drift through the quarter for {life} sec, dealing {min} to {max} damage a second to anyone inside.',
      steamResponse: 'Stay out of the clouds.',
      magmaName: 'Magma Rift',
      magmaSummary:
        'The Heat and the Hammer: players are marked ({marks} at a time); {mark} sec later a fissure erupts under each for {min} to {max} Fire damage within {radius} yd, leaving lava that burns for {life} sec ({pMin} to {pMax} a second).',
      magmaResponse: 'Marked: move away from the raid before it erupts.',
      firestormName: 'Firestorm',
      firestormSummary:
        'The Heat and the Breath: lanes {width} yd wide are laid across the room ({lanes} at a time); {warn} sec later a wall of flame sweeps along each, dealing {min} to {max} Fire damage.',
      firestormResponse: 'Leave the lanes before the flame comes.',
      hailName: 'Hailstorm',
      hailSummary:
        'The Quench and the Breath: for {seconds} sec, hailstones fall on the quarter ({per} every {every} sec, half of them on players). Each marks a {radius} yd circle and lands {warn} sec later for {min} to {max} Frost damage.',
      hailResponse: 'Keep moving out of the circles.',
      avalancheName: 'Avalanche',
      avalancheSummary:
        'The Quench and the Hammer: spikes of ice and stone run from the wall toward the centre in lanes ({lanes} at a time), {warn} sec after they show, dealing {min} to {max} damage to anyone in a lane.',
      avalancheResponse: 'Stand in the gaps between the lanes.',
      spiresName: 'Storm Spires',
      spiresSummary:
        'The Breath and the Hammer: Storm Spires rise ({spires} at a time) and charge for {charge} sec, then lightning leaps along every line between them for {min} to {max} Nature damage.',
      spiresResponse: 'Never stand between two spires.',
      phaseStarsName: 'The Woken Stars',
      phaseStarsSummary:
        "The first time Ashgrand enters a quarter, that quarter's star wakes for the rest of the fight. A star runs at full pace while Ashgrand stands in its quarter, and at {pace} pace elsewhere.",
      pillarsSummary:
        "The Hammer's star: every {every} sec, pillars burst out under players ({count} at a time) after {warn} sec. Anyone within {knock} yd takes {min} to {max} and is thrown back. The pillars stay, at most {cap}; a volley that finds the cap full strikes the raid for {tMin} to {tMax} instead.",
      pillarsResponse:
        'Use the pillars against Sky Strikes and break them with Crossing Blades before they pile up.',
      chargedName: 'Storm-Charged',
      chargedSummary:
        'A Sky Strike that falls within {arcReach} yd of a pillar arcs round it ({aMin} to {aMax} within {arcR} yd) and charges it. Every {every} sec each charged pillar strikes the whole raid for {min} to {max}, and anyone within {zone} yd of one takes {zMin} to {zMax} a second.',
      chargedResponse: 'Shatter charged pillars with Crossing Blades quickly.',
      skySummary:
        "The Breath's star: every {every} sec, lightning marks players ({marks} at a time) and spots beside the pillars ({spots} at a time). After {warn} sec it strikes for {min} to {max} Nature damage within {radius} yd.",
      skyResponse: 'Step out of your circle; a strike next to a pillar charges it.',
      bladeSummary:
        "The Quench's star: every {every} sec, a blade rises on the rim and aims a line through a marked player ({marks} a round), following them until it locks {lock} sec before it flies. Everyone on the line takes {min} to {max} Frost damage, and every pillar on it shatters.",
      bladeResponse: 'Marked: lead the line through the pillars you want broken, then step off it.',
      whirlName: 'Fire Whirl',
      whirlSummary:
        "The Heat's star: every {every} sec, Fire Whirls rise ({count} at a time) after {warn} sec and wander the floor for {life} sec at {speed} yd a second, dealing {min} to {max} Fire damage to anyone they touch.",
      whirlResponse: 'Outrun them sideways.',
      phaseKitsName: 'Quarter Kits',
      phaseKitsSummary:
        "While Ashgrand stands in a quarter, that quarter's own abilities run, beginning {delay} sec after it enters.",
      fistSummary:
        "In the Heat: every {every} sec, a {cast} sec cast at a player's spot: {min} to {max} Fire damage within {radius} yd, then three Molten Swells roll out from it, dealing {wMin} to {wMax} to everyone they roll over.",
      fistResponse: 'Marked: leave the spot, and stand in the gaps between the swells.',
      boltSummary:
        'In the Breath: every {every} sec, a {cast} sec cast at a player: {min} to {max} Nature damage, then it leaps to every player within {jump} yd of anyone struck, {growth} harder with each leap.',
      boltResponse: 'Spread out, {jump} yd apart.',
      devilName: 'Dust Devil',
      devilSummary:
        'In the Breath: every {every} sec, Dust Devils rise by players ({count} at a time) after {warn} sec and wander for {life} sec. One that touches you deals {min} to {max} Nature damage and throws you {throw} yd.',
      devilResponse: 'Watch where they wander and keep clear of them.',
      tremorName: 'Tremor Crack',
      tremorSummary:
        'In the Hammer: every {every} sec, cracks open under players ({count} at a time). After {warn} sec each erupts for {min} to {max} damage within {radius} yd.',
      tremorResponse: 'Step off your crack before it erupts.',
      emberName: 'Ember Mark',
      emberSummary:
        'In the Heat: every {every} sec, {marks} ranged players are marked. {seconds} sec later embers drop at their feet and smoulder for {life} sec in a {radius} yd pool that deals {min} to {max} Fire damage a second.',
      emberResponse: 'Marked: drop the pools together at the edge of the quarter, then move out.',
      iceSummary:
        'In the Quench: every {every} sec, the ice groans under {marks} players. {warn} sec later it breaks within {radius} yd: {min} to {max} Frost damage and a {stun} sec stun.',
      iceResponse: 'Step off the groaning ice before it breaks.',
      drawnSummary:
        'In the Breath: every {every} sec, {marks} players are marked for {seconds} sec. Every second it arcs from each to every other player within {reach} yd for {min} to {max} Nature damage.',
      drawnResponse: 'Marked: keep {reach} yd from everyone.',
      shellName: 'Stone Shell',
      shellSummary:
        'In the Hammer: every {every} sec, {marks} players are wrapped in a shell that absorbs the next {absorb} healing, for up to {seconds} sec.',
      shellResponse: 'Healers break the shells before they heal anything else.',
      phaseCallName: 'Call of the Quarters',
      phaseCallSummary:
        'At {first} and {second} health, Ashgrand strides into the centre, shielded, and calls Splinters out of its fullest quarters.',
      callSummary:
        "Gathered Strength shields Ashgrand while it channels for {seconds} sec, and Splinters rise from its fullest quarters ({adds} each time, {health} health each). Kill them all to break the shield early. Any still alive when the channel ends pours its element into Ashgrand: that quarter's star runs at full pace wherever it stands, for the rest of the fight.",
      callResponse: 'Kill every Splinter before the channel ends.',
      splinteredName: 'Splintered Strength',
      splinteredSummary:
        'Every {every} sec, each living Splinter deals {min} to {max} damage to the whole raid, {rise} more with each pulse.',
      splinteredResponse: 'The longer the Splinters live, the harder they hit: kill them fast.',
      shearSummary:
        'Every Splinter, every {every} sec: a {cast} sec cast, a {arc} degree cone {range} yd long at its target. The target takes {tMin} to {tMax}; anyone else in the cone takes {oMin} to {oMax}.',
      shearResponse: "Each Splinter's tank faces it away, and nobody else stands in front of it.",
      heatSplinterName: 'Splinter of the Heat',
      heatSplinterSummary:
        'Where it is dragged it leaves a Cinder Trail: a {radius} yd patch every {step} yd that burns for {life} sec ({tMin} to {tMax} a second). Every {every} sec a player carries a Bursting Coal for {seconds} sec; it then bursts for {min} to {max} on everyone else within {reach} yd.',
      heatSplinterResponse: "Drag it away from the raid. The coal's carrier leaves the group.",
      tollSummary:
        'The Splinter of the Quench: every {every} sec, a {cast} sec cast that deals {min} to {max} Frost damage to the whole raid if it rings out.',
      tollResponse: 'Interrupt it every time.',
      ringName: 'Quenching Ring',
      ringSummary:
        'Every {every} sec, a ring of frost with {gaps} gaps expands from the Splinter of the Quench. Crossing it outside a gap deals {min} to {max} Frost damage and slows you by {slow} for {slowSeconds} sec.',
      ringResponse: 'Walk through a gap as the ring passes.',
      weightName: 'Mounting Weight',
      weightSummary:
        'The Splinter of the Hammer: each landed swing adds a stack to its target ({per} damage a second a stack, for {seconds} sec), and each stack makes its swings land {step} harder.',
      weightResponse: 'Swap tanks at {swap} stacks.',
      pounceSummary:
        'The Splinter of the Breath: every {every} sec, a {cast} sec cast at a player who is not tanking. It leaps onto them for {min} to {max} and hunts them for {seconds} sec, its Buffeting Gale striking everyone else within {reach} yd for {bMin} to {bMax} a second.',
      pounceResponse: 'Its quarry runs it away from the group.',
      orbName: 'Storm Orb',
      orbSummary:
        'Every {every} sec, Storm Orbs form round the Splinter of the Breath ({count} at a time). Alone on one you take {min} to {max}; two or more on it each take double. An orb nobody takes bursts after {life} sec for {bMin} to {bMax} on the whole raid.',
      orbResponse: 'One player steps on each orb.',
      phaseFinalName: 'All Quarters Awake',
      phaseFinalSummary:
        'At {final} health, Ashgrand strides into the central ring for the end of the fight. The Overload bars stop.',
      awakeName: 'Every Star Awake',
      awakeSummary:
        'All four stars run at once at {pace} pace: pillars, lightning, blades and whirls together. Weight of the Anvil keeps its own clock.',
      awakeResponse: 'Keep your assignments: the floor is busier, but nothing new arrives.',
      furyName: 'Masterless Fury',
      furySummary:
        '{after} sec into the final phase, every {every} sec it deals {min} to {max} damage to the whole raid, {rise} more each pulse, without end.',
      furyResponse: 'Use every remaining cooldown and finish it.',
      tipTank:
        'Drag Ashgrand through the quarters in turn so no Overload bar fills, and out of the central ring at once. Swap at {swap} Elemental Strike stacks. Pick up the Splinters at each call.',
      tipHealer:
        'Every Overload pulse, Weight of the Anvil and Splintered Strength hits the whole raid. Save cooldowns for each call and for the final phase, where Masterless Fury never stops.',
      tipDamage:
        'Find your opposite for Opposing Elements, gather under every Weight of the Anvil, and kill every Splinter before the call ends. Interrupt every Rime Toll.',
      heroicBurst: 'A full Overload bar bursts for {bMin} to {bMax}: heal up and use defensives.',
      heroicKits:
        'Vein Shock strikes on every quarter change, and Ember Marks, Groaning Ice, Drawn Lightning and Stone Shell join the quarter kits.',
      heroicOpposing:
        'Opposing Elements marks every player who is not tanking, and every pair left uncancelled hits the whole raid.',
      heroicCall: '{adds} Splinters rise at each Call of the Quarters.',
    },
  },
};
