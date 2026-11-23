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
};
