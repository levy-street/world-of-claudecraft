# The Last Bell of Gullhaven: Campaign Spec and Story-Scenario Layer

Status: superseded for story content as of 2026-07-21. The working source of
truth for the campaign (story background, quests, map, cast, scenes, timeline)
is `docs/design/last-bell-campaign.html`; where this document disagrees with
that page, the page wins. The technical sections here (content topology,
multiplayer model, the story-scenario layer, build order) remain the
engineering reference until they move. This document supersedes
`farshore-last-bell-quest-arc.md` (the original concept note).

Target length: roughly 3 to 4 hours for the campaign (a pacing guide, not a
hard budget), plus an optional 20 to 30 minute Willowfen epilogue and a
separate repeatable five-player aftermath dungeon.

Target players: solo or a party of up to five.

---

## 1. Vision

The Last Bell is the game's first story-heavy campaign: closer to a Final
Fantasy XIV main-scenario arc or a Guild Wars personal-story chapter than to a
kill-and-collect quest hub. The pillars, in priority order:

1. **The story is the reward.** Cutscenes, interactive dialogue, playable
   quiet moments, and an authored emotional arc. Gear comes from the aftermath
   dungeon, never from the grief.
2. **The player should genuinely cry.** Not through melodrama: through an hour
   of ordinary affection, competence under pressure, and a sacrifice that is
   earned, chosen, and permanent.
3. **The squad fights beside you.** Most of the campaign's combat is fought
   together with the five named defenders, not alone.
4. **Everything new is reusable.** Every system built for this arc (story
   instances, the squad roster, the scenario sequencer, the scene system,
   dialogue choices) is a general layer future arcs will use. This is the
   first campaign, not the only one.

## 2. The promise

Gullhaven can be saved for another century, but the people who seal its great
breach will not come home.

The player is not told this at the beginning. More importantly, the defenders
do not begin the story knowing that all five of them must die. They believe
the breach can be sealed from outside, and they believe it with reason:
sealing is the Vigil's oldest recurring duty, and the outer rite has held for
most of twelve centuries (section 4). The darker precedent is public
knowledge too, carved above the harbor steps: when the outer rite fails, one
warden carries the seal inside and does not come out. Every warden on this
island grew up beneath Warden Hale's statue. Coalfast has privately settled
only one thing: if it comes to that, the one who goes in will be him.

What nobody knows, because it has never happened in twelve centuries, is
that this time the price is five.

When the outer seal fails, the squad carries the rite inside expecting one
death, Coalfast's. At the heart the wound divides under their hands, one
anchor at a time, and at each division one of his squad steps in, one by
one and without hesitation, until five living minds hold five anchors and
nobody is walking back out.

The player is forced to escape because the seal requires one final hand on the
outside. Their survival is not a reward. It is the last and hardest part of the
mission.

## 3. Content topology and the balance rule

The Farshore is a permanent shared overworld realm. The arc uses three spaces:

1. **The Farshore overworld:** the shared island (Gullhaven, the Landing,
   Watch Meadow, Sundered Cliffs, Riftfields, Wreckfields). Multiple players
   and parties quest there simultaneously.
2. **Story instances:** private copies of a bounded area (interior or
   outdoor), created per solo player or per party from the existing dungeon
   instance pool. All decisive narrative beats happen here.
3. **The Drowned Relief:** a separate repeatable five-player dungeon unlocked
   after the campaign.

### The island at a glance

The Farshore is a real zone, already shipped on `feature/procedural-dungeons`
(`src/sim/content/farshore.ts`, levels 3 to 7): a besieged island east of
Eastbrook Vale, reached on foot across the Ferrywalk sandbar causeway (no
portals, no boat). All six campaign NPCs already stand at posts there, and
the zone's quest table is empty, waiting for this campaign. The campaign's
movement is legible: the player arrives across the Ferrywalk from the
southwest, and every act pulls them east and upward, toward the wound.

- **The Landing** is the west shore where the Ferrywalk arrives; Tam keeps
  the watchbell brazier at the causeway's island end, and the fleet's
  landing beach faces the strait here.
- **Gullhaven** is on the northwest coast: the fishing harbor (too small
  for ships of size), Warden Hale's statue above the harbor steps, and the
  redoubt (a war camp and barricade ring in the old market). Coalfast,
  Edda, Saul, and Nell post here.
- **Watch Meadow** is the farmland at the island's center, where Ollun
  keeps the signal fire vigil. One toll means here. The Tidemill (campaign
  addition) stands at its western edge.
- **The Riftfields** are the scarred eastern reach, where the great breach
  (campaign addition) opens.
- **The Sundered Cliffs** are the southeast coast; two tolls means here.
  The drowned first redoubt lies in the tidal vault (campaign addition)
  beneath them.
- **The Wreckfields** (campaign addition) are the shoal flats in the strait
  off the Landing, flanking the Ferrywalk, walkable at low tide.

The playthrough document (`farshore-last-bell-playthrough.md`) carries the
drawn map, and every quest there names its route and purpose.

### The balance rule

> The shared world is where the island lives. Instances are where the story
> happens.

A beat goes into a private story instance whenever any of these is true:

- Named NPCs fight beside the player.
- A cutscene or dialogue choice plays.
- The world state visibly changes.
- The emotional pacing matters (music, silence, timing).

Everything ambient, repeatable, or social stays in the shared world. Privacy
is a prerequisite for the tone: an unrelated player cannot be allowed to
disrupt a memorial scene.

### The two forms of every squad NPC

Each named defender exists in two forms, and the campaign is built on the
distinction:

- **Home form:** a persistent shared NPC at a fixed post in Gullhaven or the
  redoubt. Every player on the island sees the same five people in the same
  places. Interaction dialogue reflects the interacting character's own quest
  stage (quest state is already per character).
- **Encounter actor:** a private copy of the NPC spawned inside a party's
  story instance, scripted and combat-capable, despawned when the instance
  ends. This generalizes the pattern the Nythraxis encounter already uses for
  Brother Aldric.

The home NPCs never physically leave town for anyone. Two unrelated players at
different campaign stages never wait on each other and never see each other's
story actors; the only shared contention is instance-slot availability, same
as dungeons today.

### The bell code as a live shared-world system

The bell code is taught by the shared world, not only by the campaign:

- **One toll: danger in the fields.** A recurring public Rift event in the
  Riftfields and Watch Meadow that any player on the island can answer.
- **Two tolls: danger at the cliffs.** The same, at the Sundered Cliffs.
- **Three tolls: the enemy is within the walls.** Reserved. It never fires as
  a public event. Players hear it exactly once, inside the campaign.

Everyone on the Farshore learns the language through play; the campaign gives
it meaning; the finale spends it. Public bell events are ordinary repeatable
content (waves, a rare elite, small rewards) and require none of the story
systems.

### Space assignment per beat

| Beat | Space |
|---|---|
| Arrival, Gullhaven hub life, side content | Shared world |
| Island histories side quests | Shared world |
| Q0 Ashore (arrival, public bell event) | Shared world |
| Q0 Ashore (the mill climax) | Story instance (solo, per character) |
| Q1 One Toll for the Fields (patrol climax) | Story instance |
| Q2 Steel, Salt and Names | Shared world |
| Q3 The Bell Below | Story instance |
| Q4 A Question of Reinforcements (council, vote, meal) | Story instance |
| Q5 Lights on the Water | Shared world |
| Q6 The Sundered Arrival | Story instance |
| Q7 On Our Own | Shared world |
| Q8 The Outer Seal (duplicated breach surroundings) | Story instance |
| Q9 to Q11 The finale | Story instance |
| The last watch (the quiet redoubt) | Story instance |
| Old Beacon delivery | Shared world (Galecrest) |
| Willowfen epilogue | Story instance |
| The Drowned Relief | Dungeon |
| Public bell events | Shared world |

## 4. Lore foundation

The Farshore sits beneath a wound left by the Night of Glass. Shards of the
Loom passed low over the island, and its sky never healed. Rifts are
unfinished rooms from the Dreamer's Sleeping World pressing into the waking
world.

Gullhaven is a forgotten daughter-house of the Vigil. Its founders came from
the Old Beacon in the Galecrest and carried a piece of shaped star-glass with
them. They called it the Bellheart.

For twelve centuries the Bellheart has resonated before a Rift opens. That is
why Gullhaven's bell can warn of a breach before anyone sees it. The people no
longer remember where the Bellheart came from, but they still know the warning
code.

The Bellheart is not merely a bell clapper. It is a Court-made star-glass
resonator, shaped around a splinter of the broken Loom. A bell is simply the
safest way mortals found to make it speak.

### The recurring seal and the statue

Sealing is not a desperate improvisation; it is the Vigil's oldest recurring
duty. Small rifts open constantly (the daily bell-code work), and the great
breach beneath the Riftfields opens roughly once a century. Each generation
of wardens raised the outer rite and closed it from outside, and the
histories say it held. A handful of times in twelve centuries the outer rite
did not take, and one warden carried the seal inside alone and did not come
out. The most recent was Warden Hale, one hundred years ago. His statue
stands above the harbor steps in Gullhaven; the plinth carries one name for
every warden who went inside, and it has room for more. That is how the town
knows this history without anyone lecturing: the statue is simply there, and
children can count the names.

This grounds both of Coalfast's positions. His confidence in the outer seal
is precedent (it almost always works), and his private contingency is also
precedent (sometimes one warden goes in). He has studied Hale's account. The
player can learn Hale's story before the campaign ever mentions it (see the
island histories layer in section 6).

### Why this breach is worse

The squad knows this one is the worst in living memory, and the campaign
shows the evidence rather than asserting it. For the past year the rifts have
opened more often, the spawn have come bigger and stranger, and the bell has
rung more in one season than the oldest sailors can remember. The squad is
overworked, down a member (Outrider Bren, section 5), and staring at counts
Ollun cannot reconcile with any recorded breach. Overworked, undermanned, and
up against a harder foe: that is the state of the squad when the player
arrives.

The breach also behaves in pulses: pressure crests and ebbs over hours
rather than flowing steadily. Q6 is built on a pulse cresting early, and the
wrong-feeling quiet after the disaster is the trough.

The cause is named exactly once. In Q9, when the rupture has divided into
five harmonics, Ollun observes that wounds do not divide themselves:
something inside has learned the rite that closed this breach for twelve
centuries and has split the wound to defeat it. The campaign says this
plainly one time and never elaborates. The intelligence behind the division
is a deliberately open thread for a future arc.

### Why Gullhaven exists

The island is dangerous and irreplaceable for the same reason. The wounded
sky still sheds star-glass: after storms, shards of the Night of Glass wash
up on the Farshore tidelines and nowhere else in the known world, and
star-glass is what the mainland's wards, beacons, and the Vigil's own
instruments are made from. The wound stirs the sea, so the shoals off the
Farshore are the richest in the region. The founders came from the Old Beacon
to keep watch over fisherfolk who would not leave; the town grew around the
catch and the salvage trade (which also grounds Edda's mainland supplier
letters and the star-glass salvage in Q7).

Gullhaven is not ignorant of its danger. The danger is priced in, the living
is good, and for twelve centuries the bell has kept the price of staying
payable. Until now, the price has always been paid by the wardens.

### The Bellheart as an acquired object

The Bellheart is acquired during the campaign rather than sitting conveniently
in Tam's current watchbell. The original Gullhaven bell tower collapsed into a
tidal vault beneath the Sundered Cliffs generations ago. The modern warning
bell has an ordinary iron clapper and repeats only a faint echo conducted
through the redoubt's old stonework. Ollun believes the original Bellheart can
power a proper seal if it is recovered.

The object should feel dangerous and sacred:

- It vibrates before enemies appear.
- Reflections inside it show rooms that do not exist yet.
- When Tam strikes it, every open Rift on the island answers.
- Its founding inscription names the Old Beacon as Gullhaven's mother-house.

## 5. Principal cast

The group has the closeness, friction and black humour of a veteran war crew.
Their affection is expressed through competence, arguments and insults, not
speeches about friendship.

They are also elite, and the campaign keeps that legible at all times. The
squad is the most decorated unit the island has produced in a generation;
ambient town dialogue defers to them, and the militia treats their arrival as
the problem being solved. In encounters they visibly outperform the island's
ordinary defenders: Coalfast holds a line alone that would kill a militia
squad, and Tam's wards shrug off waves civilians run from. Their mortality
reads as the scale of the enemy, never their frailty: when these people are
worried, the player should be. The squad keeps six chairs, and one is empty.

### Warden Coalfast: the commander

Warm when he has time to be and frighteningly decisive when he does not. He
remembers every defender he has lost. He opposed calling for mainland
reinforcements because the crossing would expose them to whatever was moving
inside the breach. He has studied Warden Hale's account of the last interior
sealing. The precedent is public knowledge on this island; what is private
is Coalfast's settled decision that if the rite must be carried inside, the
carrier will be him.

- Combat role: shield-bearing front line and battlefield commands.
- Voice: short sentences, orders phrased as facts, praise that sounds like
  logistics ("You held the east line. Good. Hold it again.").
- Arc: the man who planned to die alone learns, in the last hour, that his
  squad never intended to let him.

### Riftwatch Ollun: the scholar

Ollun can hear changes in a breach before they become visible. He discovers
the great rupture and designs the outer seal around the recovered Bellheart.
He genuinely hopes the outer seal will work. His calculations cannot prove
that it will. Throughout the campaign he gives possessions away, measures
evacuation routes, avoids future tense and looks ill whenever someone
celebrates a successful test.

- Combat role: interrupts Rift effects and reads the changing anchor pattern.
- Voice: precise, hedged, allergic to false comfort.
- Arc: the one who suspected first, and said nothing, because hope was also a
  calculation.
- Replay detail: across the whole campaign, Ollun is the only squad member who
  never describes his own future.

### Quartermaster Edda: the engineer

Edda repairs the same battered equipment so often that she treats it like part
of the family. She is abrasive, practical and very funny when afraid. She
builds the star-glass charges that will collapse the breach after it is
anchored. Edda voted to request reinforcements, and in Q6 it is her hand
that puts the flare up and brings the ships into the Riftjaw's water.
Their deaths weigh heavily on her.

- Combat role: heavy ranged damage, demolitions and charge placement.
- Voice: insults as endearments; the more scared she is, the funnier she gets.
- Arc: guilt over the relief force, answered not by absolution but by work.
  Atonement colors her choice to stay at the charge station (she called them;
  she answers when called), but the stated reason is always that only she can
  arm the charge. She stays to finish a job, not to be punished.

### Mender Saul: the conscience

Gentle, exhausted and harder to frighten than the others. He made peace with
the precedent before anyone else, and he is the one who makes sure the
newcomer understands the histories before the histories happen to them: it
is Saul who sends the player to read the statue's plinth (Q7). He also
accepts that the mission cannot succeed if the player abandons it early to
search for a solution that does not exist.

- Combat role: healing, cleansing dream-corruption and keeping the anchor
  holders alive until detonation.
- Voice: quiet, unhurried, asks questions instead of arguing.
- Arc: the one who knew the cost first and made peace with it first.

### Bellkeeper Tam: the old soldier

Coalfast's oldest friend. He uses humour to keep fear from becoming the most
important person in the room. He claims not to believe in the old Vigil rites,
yet knows every word. Tam is the only person who can reliably read and answer
the Bellheart's changing tone.

- Combat role: protective wards, crowd control and maintaining the Bellheart's
  counter-note.
- Voice: jokes with perfect timing, sincerity only when it counts.
- Arc: the unbeliever who performs the rite perfectly at the end.

### Outrider Bren: the empty chair

Bren never appears alive. He was the squad's scout and vanguard, killed on a
routine rift-sealing run in the Riftfields a few weeks before the player
arrives. His gear is still on Edda's bench, maintained as if he might collect
it; his bunk is unclaimed; the squad mentions him the way working crews do,
mid-task and without ceremony. His death is why the squad is undermanned for
the worst breach in a century, part of why the reinforcements council happens
at all, and why a proven newcomer gets recruited (Q0 to Q1). Bren has a grave
in Gullhaven. The five who go inside will not.

### Nell: the bell-runner

Nell is Bren's daughter and the squad's bell-runner: she carries messages
between the posts and the tower. She is not part of the final expedition. Her
father's death is weeks old, she is terrified of the work, and she does it
anyway; her courage is not the absence of fear, it is returning to the shore
despite it. She helps evacuate Gullhaven and survives. Nell gives the losses
a human aftermath: after the finale she takes over the bell post, and she is
the person who later asks the player to take five empty name-stones to
Willowfen. Her father has a grave; the five do not.

## 6. Storyboard

Conventions used below:

- **Space** is Shared world or Story instance (per the table in section 3).
- **Scenes** are authored sequences played by the scene system: cutscenes
  (camera control, input locked, skippable) or staged dialogue (in-world,
  player retains control).
- **Choices** are dialogue options. Choices color the story (variant lines,
  acknowledgements later) and never branch it. In a party, the leader answers
  and the choice is broadcast; it creates no personal story state for one
  member.
- Every scene is skippable on replay and viewable again from a story journal.
- Combat and traversal carry the campaign. Dialogue plays during gameplay
  lulls wherever possible, and total input-locked cutscene time across the
  campaign stays under roughly eight minutes.
- Playable-first: a beat defaults to staged dialogue or a walkable scene
  (the player approaches each character to trigger their piece); an
  input-locked cutscene is reserved for beats where the camera itself is
  the point (the Riftjaw taking the fleet, the geometry change at the
  outer seal).
- Every quest objective is concrete and countable (kill N, collect N, light
  N, hold for N waves); the playthrough document shows the quest cards.

### Act I: Learn their rhythm

The opening hour establishes the cast before asking the player to grieve for
them. Every squad member gets a personal beat unrelated to dying.

#### Q0. Ashore

- Space: shared world, with a solo story-instance climax. The climax instance
  is per character even in a party (the recruitment must be earned
  personally); everything else is normal shared-world play.
- Squad present: none until the final scene (Coalfast and Tam arrive at the
  end).
- Beats:
  1. Arrival in Gullhaven. Scene: the bell tolls once as the player steps off
     the boat; everyone in the street stops walking, counts, exhales,
     resumes. The player has been taught that the bell matters before anyone
     says a word about it. Warden Hale's statue stands above the harbor steps
     on the walk in.
  2. The player answers the one-toll public bell event in the Watch Meadow
     beside the town militia: ordinary Riftspawn, ordinary work (the standard
     public event doing double duty as the tutorial). Sergeant Marsh marks
     the player's work mid-event and makes an arrangement: his line holds
     the road, and if the rift coughs up something the militia cannot put
     down, he points at the player.
  3. A larger spawn erupts and digs into the mill at the meadow's edge,
     and the militia line folds back around it. The wardens are committed
     at the cliffs; there is nobody else to point at. Marsh points: the
     mill is the player's, and the militia holds the road at their back.
  4. Solo instance at the mill: put down the rift-stalker. Tuned to
     demonstrate the gap between the player and the island's ordinary
     defenders, not to be a wall.
  5. Scene (short): Coalfast and Tam arrive as it dies. Tam, looking at the
     stalker: "The last one of those cost the whole watch a morning and two
     stretchers." Coalfast says nothing yet; the recruitment lands in Q1.
- Emotional purpose: the player is demonstrably above the island's ordinary
  defenses and earns the introduction. The squad recruits a proven hand, not
  a stray.
- Systems: public bell event (section 3), one small solo story instance,
  sequencer.

#### Q1. One Toll for the Fields

- Space: shared-world intro, story-instance climax.
- Squad present: Coalfast, Tam.
- Beats:
  1. Coalfast recruits the player for a Watch Meadow patrol, naming the mill
     kill and, without ceremony, the fact that the squad is down a scout
     (shared world: walk to the meadow edge, where Coalfast and Tam hold a
     fixed post).
  2. Instance transition at the meadow gate. Inside, the patrol proper: the
     player fights Riftspawn waves beside Coalfast and Tam. Tam teaches the
     bell code between waves (staged dialogue during combat lulls).
  3. Coalfast tests whether the newcomer can follow an order while
     frightened: he orders the player to hold a position while he takes the
     harder one. Choice: obey silently, question the order, or ask to swap.
     Coalfast's response differs; the tactic does not.
  4. Scene (short): after the last wave, Tam rings the all-clear. Coalfast to
     Tam, about the player: "Keep this one."
- Emotional purpose: competence and trust. The player is useful, not chosen.
- Systems: story instance (outdoor), squad roster (2 actors), sequencer,
  staged dialogue, one choice.

#### Q2. Steel, Salt and Names

- Space: shared world.
- Squad present: Edda, Saul (home forms, fixed posts).
- Beats: the player works a shift at each post. Every objective is that
  post's real work, never a fetch counter, and each shift is a quiet
  rehearsal of a finale mechanic:
  1. Edda's forge: proof the charge casings with her (clamp, seat, strike
     the test tone, listen). The hands that proof the casings shield them
     at the charge station in Q10. Edda names every battered piece of
     equipment like a relative.
  2. Saul's infirmary: treat the wounded fishermen with him, and the
     interaction asks for each patient's name before it hands over the
     bandage; his philosophy is the mechanic. A small public wave event
     runs at the infirmary door behind it (answerable by anyone).
  3. Tam's tower: Tam puts the striker in the player's hand and drills the
     changes (timed strokes: the field code, the cliff code, the
     all-clear). This is the same timed-strike interaction Q11 spends at
     the climax; the campaign's last verb is taught in its second quest,
     so the finale never needs tutorial text.
  4. Each squad member gets a personal beat unrelated to dying: Edda's
     unsendable letter to a mainland supplier and Bren's maintained rack,
     Saul's habit of learning every patient's name, Nell at a dead run,
     Tam claiming not to believe in the rites while maintaining the bell
     perfectly.
- Choices: small conversational options at each post; they change replies,
  not outcomes.
- Emotional purpose: ordinary affection. This is the hour that makes the
  finale cost something.
- Systems: the timed-strike interaction (shared with Q11: taught here,
  spent there) and a name-prompt interaction; otherwise standard quests
  plus one public event.

#### Q3. The Bell Below

- Space: story instance (the drowned first redoubt, interior; delve-like).
- Squad present: Tam, Ollun.
- Beats:
  1. Descent into the tidal vault beneath the Sundered Cliffs. Void Stalkers
     and unstable dream-things; Ollun reads the walls, Tam covers the rear.
  2. Mid-dungeon staged dialogue: Ollun admits the coming breach is larger
     than he has said publicly. Choice: press him for numbers, reassure him,
     or say nothing. He deflects all three differently.
  3. The founding bell chamber. Scene: recovering the Bellheart. It vibrates
     before the chamber's guardians wake. Reflections inside it show rooms
     that do not exist yet. Its inscription names the Old Beacon.
  4. Fighting exit, moving, never held: the tide rises below while the
     party climbs, and the chokepoints are killed through in motion, not
     defended as waves. At the top, when Tam strikes the Bellheart once to
     test it, every open Rift on the island answers (audible even in the
     shared world as a one-time ambient event for the player's party).
- Emotional purpose: the object gets history before it becomes the mechanism.
  Ollun's fear becomes visible.
- Systems: story instance (interior), squad roster (2), sequencer, scenes,
  choices.

#### Q4. A Question of Reinforcements

- Space: story instance (the redoubt council room, then the mess table).
- Squad present: all five.
- Beats:
  1. Scene: the council. Coalfast argues against sending the signal: the
     relief route is exposed across open water and the old causeway; a major
     signal may attract the intelligence within the Rift; an untrained relief
     force may add bodies without adding time. Ollun, Edda, Saul and Tam
     argue to send it, and the case is relief, not rescue: five are doing
     the work of six against the worst breach in the records (the sixth
     chair is empty, and everyone at the table knows it); the town must be
     evacuated while the rite is raised; every night the squad spends
     holding walls is a night nobody spends on the seal.
  2. **The vote, including the player.** The player is given a real vote: for
     the signal or against it. The tally is authored so the player is always
     narrowly on the losing or winning side of a decision that carries
     anyway: player votes for, it passes 5 to 1; player votes against, it
     passes 4 to 2. Either way the signal is sent, the player is part of the
     decision, and the player owns a share of what follows. The vote is
     recorded and acknowledged in later variant lines (see Q6 aftermath).
  3. Coalfast honours the vote. He helps carry out the decision without
     sulking or undermining it. The player climbs the Watch Meadow mast with
     Tam and physically raises the signal (interactive, not a cutscene).
  4. **The quiet meal.** Playable, not a cutscene. The squad eats together;
     the player can sit, eat, and talk to each member in any order. Each
     describes an ordinary plan for after the mission. Ollun, if asked about
     his, changes the subject (the replay detail). The scene ends when the
     player chooses to leave the table.
- Emotional purpose: agency in the tragedy, and the calm before it.
- Systems: full scene system (council cutscene), dialogue choice UI (the
  vote), staged free-roam scene (the meal), sequencer.

### Act II: Hope and responsibility

#### Q5. Lights on the Water

- Space: shared world.
- Squad present: home forms, repositioned to the Landing for players at this
  stage's interactions.
- Beats:
  1. The relief force appears as lights on the water. The harbor cannot
     take ships of size, so the fleet will land on the Landing beach at
     first light; overnight it anchors beyond the shoals, because nobody
     runs shoal water in the dark. The player clears the beach and lights
     the guide fires that mark the safe channel and the cleared landing
     zone (kill and interact objectives along the shore).
  2. Staged dialogue at the last fire: for the first time, the squad allows
     itself to believe that everyone might live. Tam starts a bad joke about
     mainland soldiers. He does not get to finish it.
- Emotional purpose: hope, priced for demolition.

#### Q6. The Sundered Arrival

- Space: story instance (the Landing and the water approach, outdoor).
- Squad present: all five.
- Beats:
  1. The plan is a dawn landing: the fleet anchors beyond the shoals
     overnight, because nobody runs shoal water in the dark, and comes in
     at first light to the beach the player cleared. The squad and player
     hold the landing zone through the night.
  2. The breach surges hours early (a pulse cresting): two tolls sound from
     Gullhaven, danger at the cliffs, and the code the player learned in
     the fields does its real job. Waves of Riftspawn and larger
     dream-things, far past Ollun's counts; by the middle waves the line is
     visibly failing.
  3. The false final stand, then the call. At the fourth wave the
     breakwater stair goes quiet in the wrong way and Coalfast walks in
     alone, leaving death-flag orders behind him (if he is not out by the
     next wave: Tam commands, and they ring three). He barely walks back
     out ("Not tonight. Positions."). The bait is deliberate: the campaign
     shows a last stand, lets the player believe it, and gives him back,
     so the real one lands harder. Then the call (staged dialogue,
     mid-fight):

     > **Edda:** "The line will not hold to first light. They are anchored
     > behind the shoals waiting for dawn. The flare is rigged and they
     > know what it means. I can bring them in now."
     >
     > **Coalfast:** "Night water, on this coast."
     >
     > **Edda:** "Night water, or they anchor off a beach we no longer
     > hold."
     >
     > **Coalfast:** "Send it up."

     Edda pulls the lanyard herself, in front of the player, and the flare
     blooms red over the shoals. A defensible call, made under pressure,
     by the people who will have to live with it.
  4. The Riftjaw is waiting in the shoal channel, and the fleet dies while
     waves five and six are still on the beach: the player fights with
     their back to the water and sees it in pieces between strokes. Only
     when the sixth wave breaks does a short scene take the camera (the
     quest's one cutscene): the last ships going down in full view, the
     sailors' souls drawn out of the water and swallowed, points of light
     pulled under in rows.
  5. The failed rescue, on ground the player can actually fight on: the
     beach and the knee-deep tidal flats, among wreck debris, as survivors
     and wreckage wash in. The objective text is honest: "Rescue
     survivors"; the counter asks for twenty, and the sea gives seven.
  6. The pulse ebbs, and the trough leaves a small scatter of strandlings
     on the flats: broken, half-rewritten, not a threat but work. Putting
     them down is a short scripted count, ugly and brief, the squad
     walking the tideline beside the player, nobody talking; never a
     farm. The quiet that follows is the
     trough, and it is written to feel wrong rather than restful. Ollun,
     watching where the wounded Riftjaw went down with its stolen light:
     "It took the light down with it. A wound fed like that does not
     close." (Seeding the aftermath dungeon and its attunement.)
  7. First light, playable, weight instead of wit: the player walks the
     tideline past the rows of sailcloth and goes to each of them in any
     order. Saul with the seven survivors ("Seven."); Tam on the
     breakwater stair saying nothing at all, which is how the player knows
     how bad it is; Edda at the waterline, where Coalfast's only job is to
     turn her away from the water:

     > **Coalfast:** "Edda. Look at me, not at the water."
     >
     > **Edda:** "You needed a quartermaster an hour ago."
     >
     > **Coalfast:** "I need one now. The seal still needs its charges, and
     > the charges need their maker."

- Emotional purpose: the disaster as the consequence of a defensible call
  made under pressure, with no villain in the room. Nobody was wrong;
  everybody pays.
- Systems: story instance (outdoor, water edge), squad roster (5, first full
  deployment), sequencer, scenes.

#### Q7. On Our Own

- Space: shared world.
- Squad present: home forms.
- A short aftermath quest rather than another action sequence. The player
  collects the relief banner from the surf, carries names to Saul, and helps
  Edda salvage enough star-glass for the outer seal.
- The responsibility scenes play as staged dialogue at the posts, with the
  vote acknowledged. Nobody says "we killed them." Coalfast does not use the
  disaster to prove he was right:

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

  Edda's guilt is specific: she voted for the signal, and her hand pulled
  the lanyard. Nobody lets her carry it alone, and nobody pretends it
  away:

  > **Edda:** "I sent the flare up."
  >
  > **Tam:** "From a mortar I rigged, off a beach I promised we would
  > hold. Keep going; there is plenty."

  Variant lines by the player's vote: if the player voted for the signal,
  Edda tells them, unprompted, "You voted with me. Remember that I asked you
  to." If the player voted against, Tam says, "You and the Warden were right.
  I would vote the same way again anyway." Same scene, different wound.

  As the quest closes, Saul, without explanation: "Have you read the names
  above the harbor steps? Read them tonight." A player who skipped the
  island histories gets the statue's meaning planted here, ahead of Q8.
- The squad decides to continue. Not framed as revenge: the civilians are
  still alive, and the breach is still opening.
- Emotional purpose: guilt distributed honestly, including to the player.

### Act III: The plan fails

#### Q8. The Outer Seal

- Space: story instance. **This is the duplicated breach surroundings:** a
  private outdoor copy of the Riftfields approach, per party, so the
  operation is undisturbed and its world-state changes (wards, the
  contracting breach) are owned by the party.
- Squad present: all five.
- Beats:
  1. The player and squad place Bellheart wards around the Riftfields
     (Edda places, Tam tunes, the player and Coalfast hold the line, Saul
     keeps everyone standing, Ollun calls the pattern). The four ward
     sites escalate by variation, never by repetition:
     - Site 1 raises by the book: the standard defense, establishing the
       loop (three waves while Tam tunes).
     - Site 2 misfires mid-tune, and the player holds Tam's counter-note
       themselves with the striker while he restarts the verse (the same
       stage-object work Q10 asks for at the Bellheart station).
     - Site 3 sends no wave: one fast hunter goes straight for Edda
       mid-placement, a moving protect fight, not a line fight.
     - Site 4 is silent. Nothing attacks; the ward goes up without a drop
       of blood; the silence is the escalation, and it feeds directly
       into Ollun's false dawn.
  2. The operation initially works. The breach contracts, the creatures
     weaken, and Ollun allows himself to say, "We have it."
  3. Scene: the inner geometry changes. The wards pull apart because they are
     trying to anchor a wound whose centre is not fully inside the waking
     world. Ollun delivers the truth plainly:

     > **Ollun:** "The seal will not take. Its heart is inside."

  4. Recognition, not shock. The squad has read the same histories and grown
     up beneath the same statue; the player is the only one present who did
     not:

     > **Tam:** "Hale's year."
     >
     > **Coalfast:** "Ollun. From the heart. Can it be closed?"
     >
     > **Ollun:** "Carried in, with the Bellheart. Yes."
     >
     > **Coalfast:** "Then it closes."

     Nobody asks who carries it in; on this island that question was
     answered a hundred years ago, in bronze. (Staged in-world; the
     quest's one camera moment is the geometry change itself.)

     > **Player:** "How do you get back out?"
     >
     > **Coalfast:** "I do not."

     Choice: the player's follow-up is selectable (accusatory, pleading, or
     silent), and Coalfast's answer holds the same ground in all three:

     > **Coalfast:** "I knew it might come to this. I hoped it would not."

     Around them, calm preparation: Tam checking his weapon, Edda dividing
     the charges, Saul packing his kit. Nobody argues about whether to go
     in. The argument about who stays has not happened yet, because everyone
     present believes the answer is one, and that it is Coalfast.
  5. The squad and the player enter the breach together, composed, expecting
     to escort one man to his death.
- Emotional purpose: the plan has a precedent, and the precedent has a price
  everyone thinks they already know: one. The real reveal is still ahead.
- Systems: outdoor story instance at scale, squad roster (5) with scripted
  work loops, sequencer with a mid-quest reversal, scenes, choices.

### Act IV: Five to hold, one to close

#### Q9. The Inside Plan

- Space: story instance (the breach interior; continuous with Q10 and Q11 as
  one scenario with ordered stages).
- Beats:
  1. The breach interior is one readable space, not a maze: a vast hollow
     of dream-stone with the heart at its centre and open ground all the
     way to it. The wrongness lives in the light and the sky, never in the
     navigation. The squad escorts Coalfast and the charge toward the
     heart, fighting through its defenders, expecting one death.
  2. At the heart there is a single anchor: a standing collar of
     dream-stone where the rite must be held while Edda's charges do
     their work. Coalfast takes it and orders the rest out. One carrier,
     one death: the precedent everyone walked in expecting.
  3. The wound answers by dividing, live, under their hands. One anchor
     becomes two, and Tam takes the second over Coalfast's objection
     (only he can hear the counter-note). It divides again, and Ollun
     goes to the drifting north anchor (only he can read it), naming the
     cause exactly once as he goes: wounds do not divide themselves; it
     has learned the rite; it is answering them (section 4, never
     elaborated). It divides again, and Saul takes the life anchor
     (somebody has to hold the holders). It divides once more, to five,
     and stops. Edda: "It counted us." She sets the last charge and takes
     the fifth anchor with the detonator in her fist.

     Machines cannot substitute at an anchor (unfinished dream-matter
     rewrites their shape and instructions; a living mind can recognise
     that the world has gone wrong and force it back): this stays design
     rationale, and at most one line of Ollun's if a player asks.
  4. There is no survey scene, no speech, and no call for volunteers. The
     reveal is dramatized as escalation: the wound asks one at a time,
     and one at a time, without hesitating, they answer.
  5. Coalfast looks at each of them at their stones, the argument lost
     before it could be had, and gives the only useful order left. The
     player has heard the word all campaign: at the meadow gate, the
     guide fires, the breakwater stair:

     > **Coalfast:** "Positions."

- Emotional purpose: their affection is communicated by how quickly they
  understand one another, not by a farewell speech.

#### Q10. The Last Bell

- The finale combat: a staged scenario, not a kill quest. The five stations
  form a pentagon around the charge. Each squad member performs an
  indispensable task at their station; the player (and any party members)
  move between stations, relieving pressure and killing priority targets.
- Station gameplay: five authored rotations, capped, each with a distinct
  beat, rising in pressure. Saul calls the squad's status between them and
  Edda reports arming progress as the scenario clock:
  1. A single harmonic slips; the player rotates, clears the adds, and
     steadies the ward (the loop as taught; the only by-the-book
     rotation).
  2. Interference bends the counter-note; the player holds it with the
     striker while Tam corrects (taught at Q8's second ward, spent here).
  3. The dream-matter answers Saul with a copy of himself: a
     priority-target kill at the life anchor while the real Saul keeps
     cleansing.
  4. All five harmonics slip at once. The player can answer exactly one
     and must listen to the squad absorb the other four. The finale
     breaks its own loop exactly once, to teach the player they cannot
     hold everything, minutes before Coalfast orders them out.
  5. Everything converges on the charge for the final arming; the player
     shields the casings they proofed at Edda's bench in Q2.
- When the charge is armed, Coalfast orders the player out with the
  Bellheart. The player offers to take an anchor:

  > **Player:** "I can take a station."
  >
  > **Ollun:** "No. The outside lock must be turned after the charge fires."
  >
  > **Player:** "Send one of you."
  >
  > **Coalfast:** "Every person in here has a job only they can do. So do
  > you."
  >
  > **Player:** "You expect me to leave you?"
  >
  > **Coalfast:** "I expect you to close the breach. This is our post. Yours
  > is outside. You held the east hedge when I asked. Hold this one. Go."

  The final order is the Q1 test, asked again at maximum stakes: can this
  person follow an order while frightened. The campaign opens and closes
  on the same question.

- The retreat is played, not shown: the player runs the exit path while the
  squad's communication goes clipped and professional behind them. Nobody
  performs a final monologue. Edda reports the charge, Ollun calls changes in
  the harmonics, Tam corrects the Bellheart, Saul counts who is still
  standing. Coalfast waits until the player crosses the threshold before
  ordering the detonation.

#### Q11. Close the Door

- The player emerges alone. The Bellheart must be placed into the exterior
  watchstone and struck at the exact moment the interior charge detonates
  (a timed interaction cued by the Bellheart's vibration, readable without
  UI text; generous but real timing). It is the same timed-strike
  interaction Tam drills in Q2, so the climax teaches nothing new: the
  player's hands already know the job.
- This is an active final objective. The player does not merely survive a
  cutscene. If they miss the moment, the sequence holds at the brink and the
  cue repeats; the sacrifice cannot land until the player closes the door.
- The Bellheart rings. The breach collapses. Gullhaven is safe for roughly
  one hundred years.
- The music stops.

### The island histories (optional lore layer)

How the backstory reaches the player without a lecture. Town NPCs offer
short interaction snippets that point at landmarks ("ask the statue-keeper
why the plinth has room for more names"), and the landmarks carry a small
set of optional side quests, one per zone, each unfolding one piece of
history at the place it happened:

- Gullhaven: Warden Hale's statue. The statue-keeper tells the story of the
  last interior sacrifice and the names on the plinth.
- Sundered Cliffs: the collapsed first bell tower, a survey quest that
  breadcrumbs into Q3 (The Bell Below).
- The Landing: the founders' inscription, the Old Beacon connection, and the
  star-glass salvage trade that keeps the town paid.
- Wreckfields: what the tides have taken over twelve centuries, and why the
  salvagers still go out.

All of it is optional and skippable; a player who does it enters the finale
knowing exactly what the squad is walking into. Each quest carries a small
deed. Snippets and quest text follow the standard i18n rules; no new systems
are required (standard quests plus interactable lore objects).

## 7. Endings and epilogues

### The last watch (solitary ending)

The final campaign quest is completed alone, always, even for a full party
(each member walks their own copy). It has a verb, not just a mood: the
player is the only person left who served with the squad, so the player
walks the warden's night rounds through the quiet redoubt and performs each
member's end-of-watch duty, each one learned or seen during Act I:

- Bank Edda's forge (it is found cold; Grandmother sleeps under canvas).
- Close Saul's book of names (open to the relief force's pages, every name
  written in full).
- Weight Ollun's papers (the calculations end in the middle of a sentence).
- Secure Tam's tower ropes, hang his ordinary iron clapper (waiting on
  the bench, tagged in his hand, since the Bellheart displaced it after
  Q3), and ring the all-clear once, one long soft stroke, the way he
  taught. The bell gets an ordinary heart back; the island still works.
- Turn Coalfast's chair to face the door, the way he left it every night
  (it is found facing the sea).

Each duty is a silent interaction that plays one memory line. No objective
markers beyond the duties; no music. The rounds end with the player writing
five names into the redoubt's watch log in their own hand.

The player then carries the Bellheart and Ollun's breach record to the Old
Beacon in Galecrest (shared world travel; the delivery scene is instanced).
Its keepers recognise the founding mark and learn that their forgotten
daughter-house maintained the Vigil for twelve centuries without relief or
recognition. When the Bellheart is placed beside the Old Beacon, it rings
once without a bell around it. The combined record gives the surviving Vigil
a way to detect the next great breach before it opens.

The squad bought a century for Gullhaven and a warning for everyone else.

### Willowfen epilogue: Names Without Graves

Nell asks the player to carry five empty name-stones to Willowweep. The
Willowfen is the only realm where the dead still find the Dreamer's sleep
without assistance.

The player plants one stone for each member of the final expedition: Warden
Coalfast, Riftwatch Ollun, Quartermaster Edda, Mender Saul, Bellkeeper Tam.
After each name is spoken, a distant bell note sounds. After Coalfast's name,
the insects and frogs become silent. Five lights settle beneath the willow
and fade.

Nell says:

> "The bell only ever asks one question: who will come? For twelve hundred
> years the answer was them. Now it is me."

There is no boss, reward fanfare or immediate joke after this scene. The
player is allowed to leave in silence.

### Post-campaign Gullhaven

After the finale, the player's view of the squad changes permanently:

- The five home NPCs no longer appear for that character. Their posts stand
  empty, with small memorial objects (v1 mechanism: the interiors are
  micro-instances keyed to campaign state; the shared exterior town gains a
  permanent memorial that reads correctly at any campaign stage).
- Nell takes over the bell. One toll and two tolls keep sounding for public
  events: the island still works, because they made it work.

Stated plainly, because it is a common question: nobody is replaced, and
there is no successor squad in v1. Every squad post is indoors (forge,
infirmary, bell chamber, council room), and each interior is a micro-instance
keyed to the visiting character's campaign state. A mid-campaign character
walks into the forge and Edda is there; a finished character walks through
the same door and the forge is cold. The shared exterior street is identical
for everyone at every stage. A character who has finished the campaign can
never see the living squad again and cannot re-accept the quests; when they
group with a friend who has not finished, the friend picks up and drives the
quests, and the finished player joins the friend's story instances in replay
mode (full participation, no second reward, no overwrite of their own
post-campaign state; see section 9).

## 8. The Drowned Relief (aftermath dungeon)

The Riftjaw that destroyed the reinforcement force is expelled into the
waking world when the great breach closes. It retreats into a fused maze of
ships and Rift architecture beneath the Wreckfields. It still holds the
souls it took.

### Attunement: the way down

The dungeon is per-character attuned, classic style: finishing the campaign
is necessary but not sufficient. A short shared-world chain does the
attuning, so the unlock is diegetic:

1. **The lights.** The Wreckfield salvagers stop going out: at low tide
   there are lights under the flats, and the lights move. Nell passes the
   word through the bell posts. The player walks the flats at low tide,
   sees the lights for themselves, and recovers the fleet's sailing logs
   from the flagship wreckage, where the lights crowd thickest. The logs
   show course corrections beginning days before landfall: something
   shadowed the relief force from the moment the signal went up, which is
   exactly what Coalfast warned the council about. The squad never
   learned this; the player does. (One quest: the rumor and the proof are
   the same walk.)
2. **The key.** The Riftjaw's pocket sits half inside dream-matter, and
   only star-glass opens the way. Edda's outer-seal work left finished
   spare resonance shards in the redoubt stores, tagged in her handwriting.
   Setting one at the mouth of the wreck-maze is the attunement; each party
   member runs the chain once and carries their own shard.

A repeatable five-player dungeon unlocked after the campaign, about justice
and release, not reversing the sacrifice:

- Enter the fused relief flagship.
- Fight dream-echoes wearing the sailors' memories: the taken souls, given
  shape by the Riftjaw.
- Recover the relief banner and final dispatches.
- Kill the Riftjaw. Its death releases the souls it holds: lights rise out
  of the wreck-maze and disperse, free to find the Dreamer's sleep (the same
  imagery the Willowfen epilogue uses).
- Return the recovered names to the mainland.

Releasing the taken souls lays the sailors to rest; it resurrects no one.
The dungeon must not resurrect the squad, reveal that they escaped, or turn
their deaths into a fake-out. A five-player dungeon is the cleanest first
version (normal party structure); a ten-player raid variant is possible later
but out of scope.

## 9. Multiplayer model

The campaign supports one to five human players while keeping all five named
squad members present.

- **Solo:** the NPC squad supplies the visual and combat presence of a full
  unit. Encounter tuning makes their support sufficient without letting them
  complete objectives unattended.
- **Party:** human players add combat power but never replace named
  characters at the five anchors. The anchors belong to the story cast
  because their decision to stay is the emotional climax. All human players
  form the outside team: the five specialists are required inside, while the
  outside team must carry the Bellheart, defend the watchstone, and close the
  seal after detonation. The reason for survival holds at any party size.

The Q0 climax instance is the one exception to the party model: it is solo
and per character even in a party, because the recruitment must be earned
personally. Every other story instance follows the rules below.

Scenario rules:

- Grouped players enter the same private scenario and see the same squad,
  dialogue, stages and sacrifice. Ungrouped players entering at the same time
  receive separate instances and cannot disrupt one another's story actors.
- The named NPCs are encounter actors and consume no party slots.
- Enemy health and wave pressure scale with human player count; the squad
  stays competent but its damage share falls proportionally so extra players
  do not trivialise encounters.
- One party member operates a stage object; every eligible member present
  receives the stage credit.
- Every living player must reach the outside seal before it can activate; any
  one of them performs the final Bellheart interaction.
- Dialogue is broadcast to the party. Where a response is required, the party
  leader answers; the response creates no personal story branch.
- Campaign completion and rewards are recorded per member, not per leader.
- Before launch, the scenario runs a ready check showing each member's
  eligibility. V1 requires every unfinished player to be on the same finale
  step. A member who has completed the campaign may enter in replay mode to
  help a friend: no second campaign reward, no overwrite of their
  post-campaign state.
- No mid-scene joins. A late player joins before the scenario begins or waits
  for the next run. A disconnected player may resume the party's still-live
  instance, following the existing dungeon-instance model.

## 10. Rewards and deeds

Rewards memorialize; they do not pay out grief.

- Campaign completion: a title (from the Book of Deeds), the squad's banner
  (cosmetic), Renown, and Tam's bell-striker as a keepsake item (the one he
  taught the changes with; his iron clapper goes back into the bell during
  The Last Watch).
- The vote, the meal conversations, and each act completion carry deed
  records; the Willowfen epilogue carries its own quiet deed.
- Gear progression comes from the Drowned Relief dungeon.
- Per the repo content rule, all new conquerable content here (the story
  scenarios, the Drowned Relief, any new rares on the Farshore) authors its
  Book of Deeds records in `src/sim/content/deeds.ts` in the same change,
  following `docs/design/deeds.md`. Deeds stay cosmetic-only.

## 11. Audio and music direction

- **The bell leitmotif.** A short motif introduced in Q1, threaded through
  the procedural music whenever the story advances, carried by the Bellheart
  itself in Q3, rung at full voice for the last time in Q11, and answered
  once more, small and ordinary, by the diegetic all-clear stroke in The
  Last Watch.
- **Scene-driven music state.** The scenario system can direct the procedural
  music engine (state, intensity, motif, silence). "The music stops" after
  the breach closes is an authored event, not a fade.
- **Silence is a deliberate register.** The solitary ending and the Willowfen
  epilogue have no music. Ambient sound (surf, wind, insects) carries them;
  the insects stopping after Coalfast's name is an audio event.
- Squad dialogue is text with existing SFX conventions (no voice acting
  assumed by this spec).

## 12. Technical implementation: the story-scenario layer

Everything in this section is reusable; the campaign is its first consumer.
All of it obeys the repo invariants: the sim stays deterministic and
DOM-free, all randomness through `Rng`, the server stays authoritative,
render/ui consume `IWorld` facets only, and every player-visible string is a
stable key (the sim emits keys plus values, never English prose; see the
i18n rules in the root and `src/ui/` CLAUDE.md files).

### 12.1 What exists today (verified against code)

- **Instance pool:** dungeons pre-allocate `INSTANCE_SLOT_COUNT` (24) private
  copies at reserved world positions (`src/sim/data.ts`,
  `src/sim/instances/dungeons.ts`). Claims are keyed per party or per durable
  character id (`instanceKeyFor`), which is what makes disconnect-resume work.
- **Companion NPC:** delves spawn exactly one combat companion per run
  (`src/sim/delves/companion.ts`, definitions in
  `src/sim/content/delves/companions.ts`): follow, fight, heal, despawn on
  exit. It is a single-ally model today.
- **Scheduled encounter dialogue:** the Nythraxis encounter
  (`src/sim/encounters/nythraxis.ts`) spawns a friendly NPC mid-fight and
  plays multi-line, delay-staggered dialogue through the sim's delayed-event
  queue, with per-encounter state on the entity. This is the seed of the
  scene system.
- **Quest state:** per character (`QuestProgress` in `src/sim/types.ts`).
- **Not present today:** escort quests, overworld phasing of any kind, camera
  control or cutscenes, dialogue choices, multi-NPC squads, ordered scenario
  stages.

### 12.2 System 1: Story instances

Instance content that can be a bounded outdoor area (terrain, sky, water) as
well as an interior, stamped into the existing 24-slot pool exactly like a
dungeon. A story instance differs from a dungeon in what fills it, not how it
is claimed:

- Claim, occupancy, disconnect-resume, and recycling reuse the dungeon
  instance model unchanged.
- A story instance is populated by a scenario definition (12.4), not a
  static mob table.
- Entry is gated by quest state (the giver NPC or a world portal checks the
  party's eligibility; ready check per section 9).
- New module behind the existing instances seam (sibling of
  `src/sim/instances/dungeons.ts`), never new methods on the `sim.ts`
  coordinator; sim system logic goes behind the `SimContext` seam per
  `src/sim/CLAUDE.md`.

### 12.3 System 2: Squad roster

Generalize the delve companion from one ally to N named actors:

- A squad definition: list of actor ids, each with a combat kit (role,
  abilities, target priorities), follow/hold/position directives, and story
  identity (name key, portrait, bark set).
- Actors are entities owned by the instance, not by a player; they scale
  as a group (their damage share falls as human player count rises).
- Scripted positioning: an actor can be ordered to a point, to a station
  object, or to follow a unit; the scenario sequencer issues these orders.
- Survivability during scripted sections: actors in a story-critical stage
  cannot be killed by ambient damage (they can be pressured, downed to a
  scripted floor, and must be relieved by the player, which is the Q10 loop).
- Implementation extends the companion brain pattern
  (`src/sim/delves/companion.ts`) into a `src/sim/squad/` module cluster with
  its own tests; content lives declaratively in `src/sim/content/`.

### 12.4 System 3: Scenario sequencer

The spine: ordered stages with party-wide progress.

- A scenario definition is data-as-code in `src/sim/content/`: a list of
  stages, each with entry conditions, objectives (kill, interact, escort,
  survive, reach), actor directives, scene triggers, music directives, and an
  on-complete transition.
- Stage state is per instance, mirrored to every member (party-wide
  progress); credit rules per section 9.
- Failure handling per stage: retry from stage start (combat stages), hold
  and re-cue (timed interactions like Q11), never a full-campaign reset.
- Deterministic: stage transitions are tick-driven sim logic; all randomness
  through `Rng`; no wall-clock time.
- Lands as a `src/sim/scenarios/` module cluster behind the `SimContext`
  seam, with the scenario definitions in `src/sim/content/scenarios/`.

### 12.5 System 4: Scene system (cutscenes and staged dialogue)

Split across the sim/client seam, which the architecture requires anyway
(the sim can never touch a camera):

- **Sim side:** a scene is a scripted sequence of sim events (dialogue lines
  as stable keys, actor movement/facing orders, music directives, camera
  directives as abstract data) scheduled through the existing delayed-event
  queue, generalizing the Nythraxis dialogue scheduler into a reusable
  `src/sim/scenes/` module. The sim knows a scene is playing (it can gate
  combat and objectives); it does not know what a camera is.
- **Client side:** the renderer and game layer receive scene events via a new
  `IWorld` facet (add the facet member in `src/world_api/`, implement in both
  `Sim` and `ClientWorld`, update `tests/world_api_parity.test.ts` in the
  same change) and interpret them: camera moves and framing, letterboxing,
  input lock, subtitle presentation. All presentation, zero authority.
- **Skippable and replayable:** skip is a client request the server honors
  per player (a skipped player waits at a hold point until the party's scene
  resolves; solo skip advances the scenario). A story journal lists watched
  scenes for replay (client-side playback of the same scene script).
- **Cutscene fairness:** scenes never hide actionable combat information; a
  scene either plays in a safe stage or locks the stage into a safe state
  first (consistent with the graphics-fairness invariant's spirit).

### 12.6 System 5: Dialogue choice UI

- A HUD component following the repo recipe: a pure DOM-free view core
  (choice list, timing, selection state) registered in `UI_PURE_CORES`, plus
  a thin painter on the `PainterHost` seam (`src/ui/CLAUDE.md`).
- Party semantics: the leader answers; the selection broadcasts; a
  configurable response window with a default choice so a scene never
  deadlocks.
- Choices color, never branch: a choice writes a small per-character record
  (for example `lastBellVote: for | against`) that later scenes read to pick
  variant lines. No branching quest graphs.
- Every line and choice is a `t()` key in the matching
  `src/ui/i18n.catalog/` domain; sim-side dialogue emits keys plus values per
  the S3 rule (`tests/localization_fixes.test.ts`).

### 12.7 System 6: Post-campaign state

- V1: interiors that must differ per player (the squad's posts, the solitary
  ending) are micro-instances keyed to campaign state; the shared exterior
  town shows a permanent memorial that reads correctly at any stage; home
  NPCs simply have campaign-stage-aware interaction dialogue (already
  supported by per-character quest state).
- Later, if arcs keep needing it: true per-party overworld visibility
  filtering. The server already interest-scopes snapshots per player, so a
  visibility predicate on entities is the natural extension point; it is
  deliberately out of scope for v1.

### 12.8 Cross-cutting engineering rules for this program

- Sim purity and determinism guards must stay green
  (`tests/architecture.test.ts`); every new sim module is behind
  `SimContext`; every randomness draw through `Rng`.
- Every new `IWorld` member: facet file + both implementations + parity pin
  in the same change (`src/world_api/CLAUDE.md`).
- All squad dialogue, choice text, objective text, and item/deed strings are
  stable keys with English catalog entries; the sim and server stay
  language-agnostic.
- New content feeds the `/wiki` guide (`npm run wiki:content`) with
  spoiler-safety reviewed for this arc specifically: the guide must not
  reveal the sacrifice (guide prose for the campaign stays at the "a story
  campaign on the Farshore" altitude).
- Sim and server changes always land with tests; the scenario sequencer and
  squad roster get dedicated unit suites plus a headless end-to-end scenario
  run (the RL env host makes a scripted full-campaign smoke test cheap).
- Every phase ends green through `npm run gate` and the `/qa` review.

## 13. Build order

Phases 1 to 3 make the campaign playable end to end with placeholder
presentation; phases 4 to 6 layer the cinematic quality on top. The story is
testable long before the tears are.

1. **Story instances.** Outdoor-capable instance content on the existing
   pool. Acceptance: a party enters a private copy of a Riftfields slice,
   disconnect-resume works, 24-slot contention behaves like dungeons.
2. **Squad roster.** N named actors with roles, positioning, and group
   scaling. Acceptance: five actors fight beside a party in a story
   instance; damage share scales with player count; scripted floor works.
3. **Scenario sequencer.** Ordered stages, party-wide progress, failure
   handling. Acceptance: a full placeholder Last Bell scenario (Q9 to Q11)
   runs end to end solo and with five players, including the outside-seal
   gate, in the headless host.
4. **Scene system.** Sim scene scripts + client camera/letterbox/skip +
   story journal. Acceptance: the Q8 reveal plays as an authored cutscene,
   is skippable, replayable, and identical across offline and online hosts.
5. **Dialogue choice UI + music direction.** The vote works with party
   semantics and variant-line payoff; scene-driven music state including
   authored silence.
6. **Campaign content.** The Q0 prologue, all eleven quests, the island
   histories side quests, both epilogues, post-campaign state, public bell
   events, deeds, wiki prose, i18n catalog entries, and the Drowned Relief
   dungeon.

## 14. Emotional guardrails (binding)

- The squad does not know that all five must die until the wound divides
  under their hands inside (Q9).
- The campaign baits one false last stand (the breakwater stair in Q6) and
  gives him back; it never fakes the real sacrifice afterward.
- The interior precedent is public knowledge (Warden Hale). Coalfast's
  private certainty is only that if the rite must be carried in, the carrier
  will be him.
- The other four recognise the contingency and choose to join him when one
  person proves insufficient.
- The reinforcements die because of a defensible collective decision (the
  vote) followed by a defensible battlefield call (Edda's flare), and the
  player's vote is really counted in it. Coalfast warned against it, but he
  never uses their deaths to win the argument afterward.
- The player contributes to the victory: they kill enemies, carry the
  Bellheart out, and physically close the breach.
- The squad dies to achieve something concrete: a century of safety.
- Nobody is secretly alive afterward. The Drowned Relief releases the taken
  souls to rest; it resurrects no one and never walks the deaths back.
- The player is not called the chosen one. They survive because the
  mechanism requires an outside closer and because the squad refuses to
  assign their oath to a newcomer.
- Dialogue choices color the story; they never branch it, and no choice can
  avert the sacrifice.
- The story spends at least an hour establishing ordinary affection before
  the fatal reveal.
- The squad reads as elite at all times. Their fear measures the enemy's
  scale, never their own frailty.
- Edda's atonement colors her choice; the stated reason she stays is always
  that only she can arm the charge.
- The cause of the five-fold division is named once, plainly, in Q9, and
  never elaborated in this campaign.
- The ending is allowed to remain quiet.

## 15. Open questions

- Zone budget for the Farshore itself (terrain, mob population, side content
  beyond the island histories layer) is not specced here.
- Tuning targets for the finale's station loop (wave cadence, rotation
  timing at each party size) need a playtest pass once phase 3 exists.
- Whether the public bell events grant a small currency or feed an existing
  reputation is open; they must stay rewarding without becoming the reason
  the island exists.
- Voice acting is assumed absent; if that changes, scene timing needs a
  second pass.

## References

- Original concept note: `docs/design/farshore-last-bell-quest-arc.md`
  (superseded by this spec).
- Comparable structure in World of Warcraft: outdoor quest chain + instanced
  story scenario + repeatable dungeon; scenarios, Follower Dungeons, Story
  Mode encounters, and Party Sync are the relevant precedents.
- Repo precedents: the Nythraxis encounter (dynamic friendly NPC, scheduled
  dialogue, encounter state), delve companions (ally combat AI), the dungeon
  instance pool (private copies, disconnect-resume).
