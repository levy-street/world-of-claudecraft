# The Last Bell of Gullhaven

Status: original concept note, superseded by `farshore-last-bell-spec.md`,
which is the live spec and the single document implementation works to. This
file is kept as a record; where the two differ (the spec adds the Q0 solo
prologue, the recurring-seal lore and Warden Hale's statue, Outrider Bren
and Nell's rebinding as his daughter the bell-runner, the re-timed relief
disaster on Edda's battlefield signal, the Drowned Relief's soul
release, and the pacing revisions: Q2 as post shifts instead of fetch
objectives, Q6's mop-up cut to a short mercy-kill beat, Q8's four ward
sites varied instead of repeated, Q10 as five authored rotations with the
all-five slip, the Q2 timed-strike drill that Q11 spends, the east-hedge
callback in Coalfast's final order, the all-clear rung in The Last Watch,
the merged attunement chain, the relief framing of the reinforcements
council, the breakwater-stair false last stand, the signal flare, the live
division reveal in Q9, and the round-4 dialogue rewrite), the spec wins.

Target length: 3 to 4 hours for the campaign, plus an optional 20 to 30 minute
Willowfen epilogue and a separate five-player aftermath dungeon

Target players: solo or a party of up to five

## Content topology

The Farshore is a permanent shared overworld realm, not a dungeon. Players can
arrive there, explore Gullhaven, meet its cast, complete most of the campaign
and encounter other players normally.

The arc uses three different spaces:

1. **The Farshore overworld:** the shared island, containing Gullhaven, the
   Landing, Watch Meadow, Sundered Cliffs and Riftfields. Multiple players and
   parties can quest there simultaneously.
2. **The Last Bell scenario:** a private copy of the breach finale created for
   one solo player or one party. Different parties receive different copies, so
   each sees an undisturbed version of the squad's last stand.
3. **The Drowned Relief:** a separate repeatable five-player dungeon unlocked
   after the story.

The current dungeon engine pre-allocates 24 private copies of each dungeon. A
story-scenario implementation can use the same capacity model: party A claims
one copy, party B claims another, and so on. It is not limited to one team at a
time. Only if every copy is occupied would another party wait for one to become
free.

Because players can be at different points in the story, the Gullhaven cast and
memorials need per-character phasing after the finale. A player who has not
started the last mission sees the living squad in the redoubt. A player who has
completed it sees their empty posts and memorial state. Grouping for the finale
temporarily synchronizes the party inside its private scenario; it does not
change another player's permanent campaign progress.

## The promise

Gullhaven can be saved for another century, but the people who seal its great
breach will not come home.

The player is not told this at the beginning. More importantly, the defenders
do not begin the story knowing that all five of them must die. They believe the
breach can be sealed from outside. Warden Coalfast alone has accepted a darker
contingency: if the outer seal fails, he will enter the breach and destroy its
heart himself.

When the outer seal fails, the breach reveals five living anchor positions.
Coalfast cannot hold them alone. His squad chooses, one by one and without
hesitation, to remain with him.

The player is forced to escape because the seal requires one final hand on the
outside. Their survival is not a reward. It is the last and hardest part of the
mission.

## Lore foundation

The Farshore sits beneath a wound left by the Night of Glass. Shards of the
Loom passed low over the island, and its sky never healed. Rifts are unfinished
rooms from the Dreamer's Sleeping World pressing into the waking world.

Gullhaven is a forgotten daughter-house of the Vigil. Its founders came from
the Old Beacon in the Galecrest and carried a piece of shaped star-glass with
them. They called it the Bellheart.

For twelve centuries the Bellheart has resonated before a Rift opens. That is
why Gullhaven's bell can warn of a breach before anyone sees it. The people no
longer remember where the Bellheart came from, but they still know the warning
code:

- One toll: danger in the fields.
- Two tolls: danger at the cliffs.
- Three tolls: the enemy is within the walls and running will no longer help.

The Bellheart is not merely a bell clapper. It is a Court-made star-glass
resonator, shaped around a splinter of the broken Loom. A bell is simply the
safest way mortals found to make it speak.

## The Bellheart

The Bellheart is acquired during the campaign rather than sitting conveniently
in Tam's current watchbell.

The original Gullhaven bell tower collapsed into a tidal vault beneath the
Sundered Cliffs generations ago. The modern warning bell has an ordinary iron
clapper and repeats only a faint echo conducted through the redoubt's old
stonework. Ollun believes the original Bellheart can power a proper seal if it
is recovered.

In the quest **The Bell Below**, the player descends into the drowned first
redoubt with Tam and Ollun. They fight Void Stalkers and unstable dream-things,
then recover the Bellheart from the remains of the founding bell.

The object should feel dangerous and sacred:

- It vibrates before enemies appear.
- Reflections inside it show rooms that do not exist yet.
- When Tam strikes it, every open Rift on the island answers.
- Its founding inscription names the Old Beacon as Gullhaven's mother-house.

This gives the object history before it becomes the mechanism that saves the
island.

## Principal cast

The group should have the closeness, friction and black humour of a veteran war
crew. Their affection is expressed through competence, arguments and insults,
not speeches about friendship.

### Warden Coalfast: the commander

Coalfast is warm when he has time to be and frighteningly decisive when he does
not. He remembers every defender he has lost. He opposed calling for mainland
reinforcements because the crossing would expose them to whatever was moving
inside the breach.

Coalfast knows the seal has an interior contingency. He intends to perform it
alone if necessary and does not tell the player.

Combat role: shield-bearing front line and battlefield commands.

### Riftwatch Ollun: the scholar

Ollun can hear changes in a breach before they become visible. He discovers the
great rupture and designs the outer seal around the recovered Bellheart.

He genuinely hopes the outer seal will work. His calculations cannot prove
that it will. Throughout the campaign he gives possessions away, measures
evacuation routes, avoids future tense and looks ill whenever someone celebrates
a successful test.

Combat role: interrupts Rift effects and reads the changing anchor pattern.

### Quartermaster Edda: the engineer

Edda repairs the same battered equipment so often that she treats it like part
of the family. She is abrasive, practical and very funny when afraid. She builds
the star-glass charges that will collapse the breach after it is anchored.

Edda voted to request reinforcements. Their deaths weigh heavily on her.

Combat role: heavy ranged damage, demolitions and charge placement.

### Mender Saul: the conscience

Saul is gentle, exhausted and harder to frighten than the others. He objects to
Coalfast hiding the contingency from the player, but ultimately accepts that
the mission cannot succeed if the player abandons it early to search for a
solution that does not exist.

Combat role: healing, cleansing dream-corruption and keeping the anchor holders
alive until detonation.

### Bellkeeper Tam: the old soldier

Tam is Coalfast's oldest friend. He uses humour to keep fear from becoming the
most important person in the room. He claims not to believe in the old Vigil
rites, yet knows every word.

Tam is the only person who can reliably read and answer the Bellheart's changing
tone.

Combat role: protective wards, crowd control and maintaining the Bellheart's
counter-note.

### Frightened Nell: the witness at home

Nell is not part of the final expedition. She helps evacuate Gullhaven and
survives. Her courage is not the absence of fear; it is returning to the shore
despite being terrified of it.

Nell gives the losses a human aftermath. She is also the person who later asks
the player to take five empty name-stones to Willowfen.

## Calling for help

The decision to request mainland aid belongs to the squad. It is not an
obviously foolish choice, and the player is not given a fake choice that leads
to the same outcome.

At the redoubt council, Coalfast argues against sending the signal:

- The relief route is exposed across open water and the old causeway.
- A major signal may attract the intelligence within the Rift.
- An untrained relief force may add bodies without adding time.

Ollun, Edda, Saul and Tam vote to send it anyway. Their reasons are defensible:

- The outer seal requires more defenders than Gullhaven has.
- Civilians still need to be evacuated.
- Refusing aid guarantees that Coalfast's people face the breach alone.

Coalfast honours the vote. The player helps Tam raise the signal at the Watch
Meadow, making the player part of the decision without falsely making it their
decision alone.

The relief force later appears as lights on the water. For the first time, the
squad allows itself to believe that everyone might live.

Then the Riftjaw attacks.

It tears through the relief ships and destroys the landing force before it can
reach Gullhaven. The player and the squad fight toward the wrecks and rescue who
they can, but the force is wiped out. The wounded Riftjaw retreats into a
fractured pocket beneath the Wreckfields.

Nobody explicitly says, "We killed them." Coalfast does not use the disaster to
prove that he was right. He takes responsibility for the decision once it has
been made:

> **Edda:** "You told us not to call them."
>
> **Coalfast:** "I told you what I thought. Then we made the call together."
>
> **Edda:** "They came because we asked."
>
> **Coalfast:** "I know. This is not yours to carry alone."

Later, Ollun tries to take the entire decision onto himself:

> **Ollun:** "I gave them the approach."
>
> **Coalfast:** "I approved it."
>
> **Ollun:** "You voted against it."
>
> **Coalfast:** "Then I lost the vote. After that, it was my order."

The squad carries responsibility without pretending the relief sailors had no
agency. Coalfast's job in the aftermath is to keep guilt from isolating any one
member of his team.

## Campaign structure

### Act I: Learn their rhythm

The opening hour establishes the cast before asking the player to grieve for
them.

#### 1. One Toll for the Fields

The player patrols with Coalfast and Tam, defending the Watch Meadow from
Riftspawn. Tam teaches the bell code. Coalfast tests whether the newcomer can
follow an order while frightened.

#### 2. Steel, Salt and Names

The player helps Edda repair the redoubt and protects Saul while he treats
wounded fishermen. Each squad member receives a small personal beat unrelated
to dying.

#### 3. The Bell Below

The player, Tam and Ollun recover the Bellheart from the drowned first redoubt
beneath the Sundered Cliffs. Its reaction confirms that the coming breach is
larger than Ollun has admitted.

#### 4. A Question of Reinforcements

The council argues and votes. Coalfast loses four to one, then helps carry out
the decision without sulking or undermining it. The player raises Gullhaven's
signal.

A quiet meal follows. The squad argues, jokes and discusses ordinary plans for
after the mission. On a second playthrough, Ollun is the only one who never
describes his own future.

### Act II: Hope and responsibility

#### 5. Lights on the Water

The relief force arrives. The player secures the Landing and lights guide fires
while the squad prepares to receive them.

#### 6. The Sundered Arrival

The Riftjaw erupts beneath the approach and annihilates the relief force. The
player fights beside the full squad during a failed rescue. The boss is wounded
and escapes, opening the later group dungeon.

After the battle:

> **Edda:** "That was every sword the mainland sent."
>
> **Tam:** "I do not see any boats."
>
> **Coalfast:** "Stop looking. Check ammunition."

#### 7. On Our Own

This is a short aftermath quest rather than another action sequence. The player
collects the relief banner, carries names to Saul and helps Edda salvage enough
star-glass for the outer seal.

The squad decides to continue. Their choice is not framed as revenge. The
civilians are still alive, and the breach is still opening.

### Act III: The plan fails

#### 8. The Outer Seal

The player and squad place Bellheart wards around the Riftfields. The operation
initially works. The breach contracts, the creatures weaken and Ollun allows
himself to say, "We have it."

Then the inner geometry changes. The wards begin pulling apart because they are
trying to anchor a wound whose centre is not fully inside the waking world.

Ollun delivers the truth plainly:

> **Ollun:** "The seal will not take. Its heart is inside."
>
> **Coalfast:** "Then I go in."

The player has never heard of this contingency.

> **Player:** "You never said that was part of the plan."
>
> **Coalfast:** "It was not the plan. It was what was left if the plan failed."
>
> **Player:** "How do you get back out?"
>
> **Coalfast:** "I do not."

Tam is already checking his weapon. Edda is already dividing the charges. Saul
does not look surprised. Their reactions make it obvious that all of them knew
this might happen.

When the player accuses Coalfast of knowing:

> **Coalfast:** "I knew it might come to this. I hoped it would not."

He did not know the outer seal would fail. He did know what he would do if it
did.

### Act IV: Five to hold, one to close

#### 9. The Inside Plan

Inside the breach, Ollun discovers that the rupture has divided into five
harmonics. Each is rewriting the others. A single charge at the centre will not
seal it.

Five living people must remain at five anchor stations and continually correct
their alignment until Edda's charge detonates. Machines cannot do it because
unfinished dream-matter changes their shape and instructions. A living mind can
recognise that the world has become wrong and force it back toward the remembered
shape.

Coalfast tries to move between the stations himself. The pattern immediately
slips.

> **Ollun:** "It needs five people. All five, at the same time."

There is no grand speech. The well-oiled team begins solving the problem:

- Ollun takes the shifting northern harmonic because only he can read it.
- Edda takes the charge station because only she can arm and correct it.
- Tam takes the Bellheart station and maintains the counter-note.
- Saul takes the life anchor and keeps the others from being rewritten.
- Coalfast takes the open approach and holds the central line.

Coalfast orders them back:

> **Coalfast:** "I stay. The rest of you take the player out."
>
> **Edda:** "Who arms the charge?"
>
> **Ollun:** "Who holds the north harmonic?"
>
> **Tam:** "And you cannot hear the Bellheart."
>
> **Saul:** "You do not have enough hands, Warden."

Coalfast looks at each of them, understands that the decision has already been
made, and gives the only useful order left:

> **Coalfast:** "Positions."

Their affection is communicated by how quickly they understand one another, not
by a farewell speech.

#### 10. The Last Bell

The finale is a staged combat scenario rather than a normal kill quest. The
player moves between the five stations, relieving pressure and killing priority
targets while each squad member performs an indispensable task.

When the charge is armed, Coalfast orders the player through the exit with the
Bellheart. The player offers to take an anchor.

> **Player:** "I can take a station."
>
> **Ollun:** "No. The outside lock must be turned after the charge fires."
>
> **Player:** "Send one of you."
>
> **Coalfast:** "Every person in here has a job only they can do. So do you."
>
> **Player:** "You expect me to leave you?"
>
> **Coalfast:** "I expect you to close the breach. This is our post. Yours is
> outside. Go."

As the player retreats, the squad's communication becomes clipped and
professional. Nobody performs a final monologue. Edda reports the charge, Ollun
calls changes in the harmonics, Tam corrects the Bellheart and Saul counts who
is still standing. Coalfast waits until the player crosses the threshold before
ordering the detonation.

#### 11. Close the Door

The player emerges alone. The Bellheart must be placed into the exterior
watchstone and struck at the exact moment the interior charge detonates.

This is an active final objective. The player does not merely survive a
cutscene. If they do not complete the outside seal, the sacrifice cannot work.

The Bellheart rings. The breach collapses. Gullhaven is safe for roughly one
hundred years.

The music stops.

## Solitary ending

The final campaign quest is completed alone. The player walks through the quiet
redoubt after the civilians return:

- Edda's forge is cold.
- Saul's medical instruments have been cleaned and arranged.
- Ollun's calculations end in the middle of a sentence.
- Tam's bell hangs without a heart.
- Coalfast's chair faces the sea.

The player carries the Bellheart and Ollun's breach record to the Old Beacon in
Galecrest. Its keepers recognise the founding mark and learn that their forgotten
daughter-house maintained the Vigil for twelve centuries without relief or
recognition.

When the Bellheart is placed beside the Old Beacon, it rings once without a bell
around it. The combined record gives the surviving Vigil a way to detect the
next great breach before it opens.

The squad bought a century for Gullhaven and a warning for everyone else.

## Willowfen epilogue: Names Without Graves

Nell later asks the player to carry five empty name-stones to Willowweep. The
Willowfen is the only realm where the dead still find the Dreamer's sleep
without assistance.

The player plants one stone for each member of the final expedition:

- Warden Coalfast
- Riftwatch Ollun
- Quartermaster Edda
- Mender Saul
- Bellkeeper Tam

After each name is spoken, a distant bell note sounds. After Coalfast's name,
the insects and frogs become silent. Five lights settle beneath the willow and
fade.

Nell says:

> "They spent their lives listening for the bell. I hope wherever they are
> now, they cannot hear it."

There is no boss, reward fanfare or immediate joke after this scene. The player
is allowed to leave in silence.

## Aftermath dungeon: The Drowned Relief

The Riftjaw that destroyed the reinforcement force is expelled into the waking
world when the great breach closes. It retreats into a fused maze of ships and
Rift architecture beneath the Wreckfields.

This becomes a separate five-player dungeon unlocked after the campaign. The
dungeon is about justice and recovery, not reversing the sacrifice:

- Enter the fused relief flagship.
- Fight dream-echoes wearing the sailors' memories.
- Recover the relief banner and final dispatches.
- Kill the Riftjaw.
- Return the recovered names to the mainland.

The dungeon should not resurrect the squad, reveal that they escaped or turn
their deaths into a fake-out.

The current game has fixed group structures: normal dungeons use a party of up
to five, while raids use up to ten. A five-player dungeon is the cleanest first
version. A separate ten-player raid variant could be designed later, but a
single flex-scaled five-to-ten encounter would require additional scaling work.

## Multiplayer campaign recommendation

The campaign should support one to five human players while keeping all five
named squad members present.

### Solo

The NPC squad supplies the visual and combat presence of a full unit. Their
story roles do not change. Encounter tuning makes their support sufficient for
a solo player without allowing them to complete objectives unattended.

### Two to five players

Human players add combat power, but do not replace named characters at the five
anchors. The anchors belong to the story cast because their decision to stay is
the emotional climax.

All human players form the outside team. Coalfast orders all of them out because
the five specialists are required at the five interior anchors, while the
outside team must carry the Bellheart, defend the watchstone and close the seal
after detonation. This keeps the reason for survival intact whether there is one
player or five.

The finale is owned by the player party:

- Two grouped players enter the same private scenario and see the same squad,
  dialogue, stages and sacrifice.
- Two ungrouped players entering at the same time receive separate scenario
  instances. They cannot disrupt or duplicate one another's story actors.
- The five named NPCs are encounter actors and do not consume any of the five
  human party slots.
- Enemy health and wave pressure scale with the number of human players. The
  squad remains competent, but its damage contribution falls proportionally so
  additional players do not trivialise the encounter.
- One party member can operate a stage object such as a ward or the final
  watchstone, and every eligible member present receives that stage credit.
- Every living player must reach the outside seal before it can be activated.
  Any one of them can perform the final Bellheart interaction.
- Dialogue is broadcast to the entire party. If a response is required, the
  party leader supplies it, but the response does not create a personal story
  branch for only that character.
- Campaign completion and rewards are recorded separately for every member, not
  only the leader.

Before launch, the scenario performs a ready check and shows each member's
eligibility. The clean first version requires every unfinished player to be on
the same finale step. A member who has already completed the campaign may enter
in replay mode to help a friend, but receives no second campaign reward and does
not overwrite their post-campaign state.

The final instance does not allow mid-scene joins. A late player joins before
the scenario begins or waits for the next run. A disconnected player may resume
the party's still-live instance, following the existing dungeon-instance model.

This replay and synchronization behaviour is not supplied by ordinary quest
sharing alone. It is part of the proposed story-scenario system.

### Current World of ClaudeCraft support

The existing game already provides several useful foundations:

- Parties support up to five players and raids up to ten.
- Nearby party members share kill and quest credit.
- Quests can be shared with eligible party members.
- Dungeon instances are keyed to the party.
- Delves already contain a combat-capable NPC companion.
- The Nythraxis encounter already demonstrates dynamic friendly NPCs, scheduled
  dialogue and encounter-specific state.

The complete Farshore finale still requires a reusable story-scenario layer:

- Multiple simultaneous named combat allies.
- Ordered stages with party-wide progress.
- Party eligibility, quest-state synchronization and an explicit replay mode.
- Encounter dialogue and movement scripting.
- Per-character post-campaign phasing or replacement NPCs.
- A deterministic failure and sacrifice sequence that cannot be disrupted by
  unrelated overworld players.

For those reasons, the final breach should be a party instance even though most
of the preceding campaign occurs in the open Farshore.

## How comparable World of Warcraft content is structured

World of Warcraft generally separates this kind of story into three layers:

1. An outdoor quest chain introduces the cast, conflict and locations.
2. An instanced scenario or Story Mode encounter controls the decisive narrative
   sequence with ordered objectives and NPC allies.
3. A repeatable dungeon or raid reuses the location and consequences for group
   progression without forcing the one-time story to carry repeatable gameplay.

Blizzard describes scenarios as short, instanced, story-driven adventures whose
ordered objectives move the story forward rather than following only the usual
trash-and-boss structure. Follower Dungeons fill missing roles with NPC allies
for solo players or partial parties. Modern Story Mode encounters similarly use
NPC allies so players can see major narrative conclusions without assembling a
full raid. Party Sync aligns quest and phase state when friends are at different
points in a campaign.

That pattern maps cleanly onto this arc:

- Farshore quest campaign: open world, one to five players.
- The Last Bell: private story scenario, one to five players plus the named NPC
  squad.
- The Drowned Relief: repeatable five-player dungeon.
- Willowfen: quiet one-time epilogue.

Official references:

- [World of Warcraft scenarios](https://worldofwarcraft.blizzard.com/en-us/news/24221824/scenarios-challenge-modes-in-mists-of-pandaria-classic)
- [Follower Dungeons](https://worldofwarcraft.blizzard.com/en-us/news/24054790)
- [Story Mode and NPC companions](https://worldofwarcraft.blizzard.com/en-us/news/24137818/going-solo-in-world-of-warcraft-a-heros-journey)
- [Party Sync](https://worldofwarcraft.blizzard.com/en-us/news/23451087/explore-azeroth-with-friends-using-party-sync)

## Emotional guardrails

- The squad does not know with certainty that all five will die until the outer
  seal fails.
- Coalfast knows only that he may have to sacrifice himself.
- The other four recognise the contingency and choose to join him when one
  person proves insufficient.
- The reinforcements die because of a defensible collective decision. Coalfast
  warned against it, but he never uses their deaths to win the argument afterward.
- The player contributes to the victory. They kill enemies, carry the Bellheart
  out and physically close the breach.
- The squad dies to achieve something concrete: a century of safety.
- Nobody is secretly alive afterward.
- The player is not called the chosen one. They survive because the mechanism
  requires an outside closer and because the squad refuses to assign their oath
  to a newcomer.
- The story spends at least an hour establishing ordinary affection before the
  fatal reveal.
- The ending is allowed to remain quiet.
