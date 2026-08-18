# The Last Bell of Gullhaven: Narrative Playthrough

Status: superseded as of 2026-07-21 by `docs/design/last-bell-campaign.html`,
the campaign's working source of truth; this document is a historical record
and is no longer maintained. It was written as the campaign as the player
experiences it, for the team:
the story, the quests, the dialogue, and the choices, in play order. Read it
top to bottom to feel the arc. All quest text and dialogue is indicative,
not final strings; final copy lands as i18n catalog keys per the spec.

How to read it: the run below is a solo playthrough. Party differences are
noted in square brackets where they matter. Every quest opens with the quest
card the player would see in game, so the actual tasks (kill N, collect N,
light N) are always visible. Dialogue choices color the story and never
branch it; where a choice exists, all options are shown. Combat and
traversal carry the campaign; dialogue plays during lulls, and the whole
campaign holds under roughly eight minutes of input-locked cutscene.

---

## The island at a glance

The Farshore is a real zone, already shipped on `feature/procedural-dungeons`
(`src/sim/content/farshore.ts`, authored by Demi, levels 3 to 7). The island
sits east of Eastbrook Vale and is reached on foot across the Ferrywalk, a
thin sandbar causeway from the vale's east point to the Landing; the deep
strait on either side keeps its swim fatigue. All six campaign NPCs already
stand at posts in the zone, and its quest table is empty, waiting for this
campaign. The layout below follows the shipped coordinates; campaign
additions (the great breach, the Tidemill, the tidal vault, the Wreckfields)
are marked. The campaign's movement is simple: you arrive across the
Ferrywalk from the southwest, and every act pulls you east and upward,
toward the wound.

```
                        N
         ~~~~~~~~~ the north downs ~~~~~~~~
       ~~                                   ~~
      ~   GULLHAVEN                            ~
     ~    [harbor, redoubt,        RIFTFIELDS   ~
     ~     statue, war camp]     [great breach]  ~
  THE LANDING                                    ~
  [Ferrywalk arrives,     WATCH MEADOW          ~
   Tam's watchbell,       [signal fire vigil,  ~
   guide fires]            Tidemill]          ~
      ~                                      ~
 to    ~   WRECKFIELDS        SUNDERED      ~
 EASTBROOK  (shoal flats,      CLIFFS      ~
 VALE        campaign)      [great break, ~
       ~~~~~~~~~~~~~~~~~~~~  tidal vault]
                        S
```

- **The Landing** is the west shore, where the Ferrywalk arrives. Tam keeps
  the watchbell brazier at the causeway's island end, so the bell greets
  you before the town does. The guide fires and the fleet's landing beach
  are here, facing the strait.
- **Gullhaven** is northeast of the Landing, on the island's northwest
  coast: the fishing harbor (too small for warships), Warden Hale's statue
  above the harbor steps, and the redoubt: a war camp and barricade ring
  crowding what used to be the market. Coalfast, Edda, Saul, and Nell post
  here.
- **Watch Meadow** is the farmland at the island's center, southeast of
  town, where Ollun keeps the signal fire vigil. One toll means here. The
  Tidemill (campaign) stands at its western edge, and the Hilltop Spring
  lies below it.
- **The Riftfields** are the scarred eastern reach, where the break-spawned
  camps thicken. The great breach (campaign) opens here.
- **The Sundered Cliffs** are the southeast coast: the cliffs' great break,
  where the Sundered Horror roams. The drowned first redoubt, and the
  Bellheart, lie in the tidal vault (campaign) beneath them.
- **The Wreckfields** (campaign) are the shoal flats in the strait off the
  Landing, flanking the Ferrywalk: twelve centuries of wrecks, walkable at
  low tide. The relief fleet dies within sight of the causeway that brought
  you in.

---

## Act I: Learn their rhythm

### Q0. Ashore

Where you walk: off the ferry at the harbor, up the harbor steps past the
statue, then inland along the Watch Meadow road to the Tidemill at the
meadow's western edge.

Purpose: show that the player outclasses the island's ordinary defenses,
and earn the squad's attention. The squad recruits a proven hand, not a
stray.

> **Quest accepted: Ashore**
>
> *Begins automatically, stepping off the ferry*
>
> "One toll. The fields. Any hand that can hold a spear is wanted at the
> Watch Meadow."
>
> - Follow the militia to the Watch Meadow
> - Slay Riftspawn (0/12)
>
> *Rewards: experience, 60 copper*

You step off the boat into a working harbor: nets drying, star-glass
salvage crates stenciled for mainland buyers. Above the harbor steps
stands a bronze statue of a man in warden's kit, green with age, facing
inland toward the fields. The plinth carries a short column of names. The
newest is a century old: WARDEN HALE. There is room below it for more.

Then a bell tolls, once. Everyone in the street stops walking. They count.
Nothing follows the first toll, and the whole street exhales at once and
resumes mid-sentence. Nobody explains it to you. You have just learned the
bell matters before anyone said a word.

In the meadow you fight beside farmers and militia. Your twelve Riftspawn
die fast; theirs do not. The gap is the tutorial, and Sergeant Marsh
clocks it from two fields away. Between waves he plants his spear and
looks you over, once.

> **Marsh:** "Trained?"

However you answer, he nods at whatever he already saw.

> **Marsh:** "Then here is how tonight works. My line holds the road. If
> the rift coughs up something we cannot put down, I point at you."

> **Quest updated: Ashore**
>
> - Put down whatever is in the Tidemill

A larger spawn erupts and digs into the Tidemill, and the militia line
folds back around it. The wardens are committed at the cliffs; there is
nobody else to point at. Marsh points.

> **Marsh:** "There it is. The mill is yours. We hold the road at your
> back: nothing follows you in, nothing gets past us to town. Go."

*[Solo instance, always, even in a party: each character clears their own
copy. The recruitment must be earned personally.]*

The fight: the Tidemill Stalker burrows and resurfaces around the mill
floor, calls two waves of lesser spawn (6 each), and webs the exits. It is
a real fight, tuned to demonstrate the gap between you and the militia,
not to be a wall.

When it dies, two people are standing in the doorway who were not there
before: an older soldier with a bell-tuner's hammer on his belt, and a
broad grey man whose kit has been repaired so many times it has become a
different kit.

> **Tam:** "The last one of those cost the whole watch a morning and two
> stretchers."

The grey man says nothing. He looks at the dead stalker, then at you,
slightly longer. Then he walks back toward the cliffs.

> **Quest complete: Ashore.**

### Q1. One Toll for the Fields

Where you walk: up to the redoubt gate on the headland, then with the
patrol along the meadow road to the meadow gate at dusk.

Purpose: first fight beside the squad; learn the bell code; pass
Coalfast's test.

> **Quest accepted: One Toll for the Fields**
>
> *Warden Coalfast, at the redoubt gate*
>
> "I am short a scout and long on fields. Walk the meadow with us
> tonight."
>
> - Meet the patrol at the meadow gate at dusk
> - Survive the night's waves (0/5)
> - Slay Riftspawn (0/25)
> - Hold the east hedge
> - Ring the all-clear with Tam
>
> *Rewards: experience, 85 copper*

Coalfast names the mill kill when he recruits you and, without ceremony,
the fact that the squad is down a scout. On the walk up you pass the
practice yard, where a set of scout's gear hangs on a rack, clean, oiled,
and unused.

*[Instance at the meadow gate. Coalfast and Tam fight beside you as
encounter actors; they take no party slots.]*

Five waves across the night. Between waves, Tam teaches you the bell while
he watches the treeline:

> **Tam:** "One toll, the fields. That is tonight, and most nights. Two,
> the cliffs. Three means it is inside the walls." He goes back to
> watching the treeline. "Twelve hundred years, this bell. It has rung
> three twice."

At the fourth wave, the pressure shifts to the gate, and Coalfast gives
you an order that is also a test:

> **Coalfast:** "Hold the east hedge. I will take the gate."

The gate is visibly the worse position. **Choice:**

- *"Understood."* / **Coalfast:** "Good."
- *"The gate is worse."* / **Coalfast:** "Yes. That is why it is mine."
- *"Let me take the gate."* / **Coalfast:** "No. Hold the hedge. If you
  are still alive at the end, you may argue with me."

The tactic never changes. You hold the hedge; he holds the gate; the gate
would have killed you, and it does not come close to killing him. Whatever
these people are, it is not militia.

After the last wave, you ring the all-clear with Tam, one long soft
stroke, and the farmers come back out with lanterns. As you leave,
Coalfast says to Tam, not quietly enough:

> **Coalfast:** "Keep this one."

> **Quest complete: One Toll for the Fields.**

### Q2. Steel, Salt and Names

Where you walk: three posts around Gullhaven: Edda's forge in the redoubt
yard, Saul's infirmary by the harbor, Tam's bell tower above town.

Purpose: an hour of ordinary affection. This is the hour that makes the
finale cost something. It is also where you meet Bren's absence and Nell.

> **Quest accepted: Steel, Salt and Names**
>
> *Quartermaster Edda, at the forge*
>
> "The redoubt has a list. The list has your name on it now."
>
> - Work Edda's forge shift: proof the charge casings (0/3)
> - Work Saul's infirmary shift: treat the Gull's Wage crew, by name (0/4)
> - Work Tam's tower shift: ring the changes (0/3)
>
> *Rewards: experience, 1 silver 20 copper*

At the forge, every battered piece of equipment has a name and a
temperament:

> **Edda:** "Hand me the third spanner. Not that one. Grandmother bites
> people who bring her the wrong spanner."

Grandmother is the redoubt's ballista. Your shift is the seal charges:
three empty casings, clamped, seated, struck to test the tone. Edda
listens to each one the way Saul listens to a chest.

> **Edda:** "Empty, they are ironmongery. Full, they are the last
> argument this island gets to make. Proof them like it."

*[The casings come back in Q10: the hands that proof them here shield
them there.]*

At the end of her bench, a weapons rack, fully maintained, no initials
on the tags. If you reach for it:

> **Edda:** "That rack is Bren's." Then, without looking up: "Was. Is.
> Pick whichever keeps you from touching it."

On her desk, an unfinished letter to a mainland supplier lies on a
drawer full of others like it. She sees you see it, and closes the
drawer.

At the infirmary, Saul is treating the crew of a swamped fishing boat
while a wave event grinds at the door; other blades answer it. Your
shift is his method: four patients, each treated by name or not at all.
Petter. Corla. Ames. Old Sef. The interaction asks for the name before
it gives you the bandage.

> **Saul:** "Use the name. Wounds close faster in people who are still
> people."

A girl arrives at a dead run with a message from the cliffs and is gone
before the door swings shut.

> **Saul:** "Nell. Bren's daughter. She runs the bell messages now.
> Slower runners last longer. She will not hear it from me."

At the tower, Tam has filed the season's inventory wrong on purpose, so
the mainland auditor has something to find and no reason to keep
looking. The rite-book on the shelf falls open to pages worn soft.

> **Tam:** "The rites are nonsense. Wind and rope and old men humming."
> He re-ties a perfect knot. "You will want the third verse by heart.
> For the nonsense."

Then he puts the striker in your hand, and your shift is the changes:
the field code, the cliff code, the all-clear, timed strokes on the
practice bell until he stops wincing.

> **Tam:** "Again. The bell does not forgive early, and it does not
> forgive late."

*[The changes are the same timed-strike interaction as the campaign's
final objective (Q11). The finale never has to teach its last verb.]*

> **Quest complete: Steel, Salt and Names.**

*Optional from here: the island histories, one short quest per zone. The
statue-keeper tells Warden Hale's story if you ask why the plinth has room
for more names (Gullhaven). A surveyor wants help charting the collapsed
first bell tower (Sundered Cliffs; breadcrumbs into Q3). The harbormaster
walks you through the founders' inscription and the star-glass trade (the
Landing). The salvagers keep a ledger of everything the tide has taken
(Wreckfields). Each is a normal quest with countable objectives and a
small deed. None are required; a player who does them enters the finale
knowing exactly what the squad is walking into.*

### Q3. The Bell Below

Where you walk: east along the cliff road, then a rope descent from the
Sundered Cliffs into the tidal vault, down through the fallen first
redoubt to the founding bell chamber, and a fighting climb back out.

Purpose: recover the Bellheart, the only thing that can power a proper
seal, and see Ollun's fear up close.

> **Quest accepted: The Bell Below**
>
> *Riftwatch Ollun, at the cliff head*
>
> "The original Bellheart is still down there. If it can be recovered, it
> can power a true seal. The tide gives us four hours."
>
> - Descend into the tidal vault
> - Slay Void Stalkers (0/15)
> - Recover the Bellheart
> - Climb out ahead of the rising tide
>
> *Rewards: experience, 2 silver*

The descent passes a tide-line of dead barnacles higher than your head.
The old redoubt lies where it fell, whole rooms on their sides. Void
Stalkers nest in it, and Ollun reads the walls as you clear them. In what
used to be a chapel, he says the thing he has not said at council:

> **Ollun:** "I rounded down at council." He does not stop reading the
> wall. "The records go back twelve hundred years. There is no breach in
> them the size of what is coming."

**Choice:**

- *Press him for numbers.* / **Ollun:** "I wanted a number too. Here is
  the only one that matters: bigger than the rite has ever closed."
- *Reassure him.* / **Ollun:** "I have done the sum with hope in it. The
  answer does not change."
- *Say nothing.* / He keeps walking. So do you.

In the founding chamber, the great bell lies split, and inside the split
sits the Bellheart: a fist of star-glass, heavier to look at than to
lift. It vibrates before the chamber's guardians wake, so you are ready
when they do. Around its base, the founding inscription:

> *Set from the Old Beacon's light, for the daughter-house at Gullhaven,
> that the Vigil may hear the night coming.*

The climb out is a running fight, not a stand: the tide is coming in
below you, and you kill what stands between you and daylight while it
rises. Ankle-deep at the bell chamber, knee-deep on the drowned stair,
chest-deep in the gallery; the last thing you kill, you kill wading. At
the top, in daylight, Tam strikes the Bellheart once to
test it, and every open Rift on the island answers: one low note from
everywhere at once, felt in the teeth. Every player on the Farshore hears
it. Tam does not make a joke. It is the first time you have seen that.

> **Quest complete: The Bell Below.**

### Q4. A Question of Reinforcements

Where you walk: the redoubt council room, then the Watch Meadow mast, then
back to the redoubt mess.

Purpose: the decision that owns everything after. The player votes.

> **Quest accepted: A Question of Reinforcements**
>
> *Warden Coalfast, at the redoubt*
>
> "The breach opens within the month. The council decides tonight whether
> to signal the mainland. You have held our fields and been under our
> stone. You vote."
>
> - Attend the council
> - Cast your vote
> - Raise the signal at the Watch Meadow mast
> - Sit for the evening meal (leave when you choose)

The council plays as a short cutscene. Coalfast argues against the signal,
and he is not being stubborn: the relief route is exposed across open
water; a signal that loud may attract whatever intelligence is moving
inside the Rift; an untrained relief force may add bodies without adding
time. The other four are not asking for an army; they are asking for
relief. Five people are doing the work of six against the worst breach in
the records. The town must be evacuated while the rite is raised. Every
night the squad spends holding walls is a night nobody spends on the
seal. And the sixth chair at this table is empty, and everyone keeps not
looking at it.

**The vote (a real choice, really counted):**

- *For the signal.* It passes five to one. Coalfast is alone.
- *Against the signal.* It passes four to two. You and Coalfast lose
  together.

Either way the signal is sent, and either way you own a share of what
follows. Your vote is recorded, and it comes back in Q7.

Coalfast honours the vote and assigns the signal watches himself. You
climb the mast with Tam and raise the great storm-signal arm over arm, an
interaction, not a cutscene.

**The quiet meal.** Playable and unhurried: sit, eat, talk to each of them
in any order, leave when you choose. Everyone has a plan for after:

> **Edda:** "When this is done I am sailing to the mainland to shout at a
> supplier in person. Twelve years of letters. He believes I am an
> invention of the postal service."
>
> **Saul:** "A season in which nobody new learns my name. That is the
> entire plan. It is a good plan."
>
> **Tam:** "I am going to teach Nell the changes properly, and then be old
> somewhere with a view of the tower instead of the inside of it."
>
> **Coalfast:** "There is a boat at the Landing with my name against a
> debt. I intend to repaint her and owe nothing to anyone."

If you ask Ollun about his plan:

> **Ollun:** "The northern harmonic drifted a quarter-tone this morning.
> Someone should write that down."

He changes the subject. He is the only one who does. *[Replay detail:
across the whole campaign, Ollun never once describes his own future.]*

> **Quest complete: A Question of Reinforcements.**

## Act II: Hope and responsibility

### Q5. Lights on the Water

Where you walk: west across the island to the Landing, then north to
south along the beach, fire to fire.

Purpose: the harbor cannot take warships, so the fleet must land on the
Landing beach at first light. Tonight it anchors beyond the shoals, since
nobody runs shoal water in the dark. Your fires mark the safe channel and
prove the beach is cleared.

> **Quest accepted: Lights on the Water**
>
> *Warden Coalfast, at the Landing*
>
> "They land at first light. They need a clear beach and a marked
> channel. Give them both."
>
> - Clear the Landing beach of Riftspawn (0/20)
> - Light the guide fires (0/5)
> - Report to Coalfast at the last fire
>
> *Rewards: experience, 2 silver 50 copper*

The relief force appears at dusk as lights on the water, a long line of
them holding station beyond the shoals. You clear the beach and light the
fires one by one, and at each one there is a small human moment: militia
straightening their kit, a fisherman explaining to his son which light is
which.

At the last fire the squad has gathered, and for the first time in the
campaign they let themselves believe that everyone might live. Tam starts
a joke:

> **Tam:** "A mainland soldier walks into a tavern with a gull on his
> shoulder, and the barman says..."
>
> **Coalfast:** "Save the end for when they land. Positions for morning."

He does not get to finish it. Remember that.

> **Quest complete: Lights on the Water.**

### Q6. The Sundered Arrival

Where you walk: the Landing beach and, when it goes wrong, out onto the
knee-deep tidal flats among the wrecks.

Purpose: hold the landing zone until dawn. The breach has other plans.

> **Quest accepted: The Sundered Arrival**
>
> *Begins at the Landing, before dawn*
>
> - Hold the landing zone until first light (0/6 waves)
> - *(updated)* Rescue survivors (0/20)
> - *(updated)* Put down what the tide left (0/4)

The breach surges hours early. Two tolls sound from Gullhaven behind you,
danger at the cliffs, and the code you learned in the fields does its real
job. The waves come bigger than anything Ollun predicted: Riftspawn in
numbers, and behind them larger dream-things the waves part around. For
the first time you watch this elite unit get pushed backward, step by
step, not because they are failing but because arithmetic is arithmetic.

By the fourth wave the line is visibly going. Then the breakwater stair,
the one strongpoint on the whole beach, goes quiet in the wrong way, and
Coalfast shoulders his shield.

> **Coalfast:** "Nobody follows me onto the stair. If I am not out by the
> next wave: Tam commands, and you ring three."

Ring three. The toll you were told the island has heard twice in twelve
hundred years. So this is it, you think; this is what the night has been
building toward. The wave comes, and breaks, and he is not out. Then he
is: slower, bleeding above one eye, dragging his shield instead of
carrying it.

> **Tam:** "One day that stair is going to win."
>
> **Coalfast:** "Not tonight. Positions."

*[The bait is deliberate. The campaign shows you a last stand, lets you
believe it, and gives him back. When the real one comes, you will
remember that this one ended.]*

The line steadies, and still it will not last the night. Mid-fight,
staged dialogue:

> **Edda:** "The line will not hold to first light. They are anchored
> behind the shoals waiting for dawn. The flare is rigged and they know
> what it means. I can bring them in now."
>
> **Coalfast:** "Night water, on this coast."
>
> **Edda:** "Night water, or they anchor off a beach we no longer hold."
>
> **Coalfast:** "Send it up."

Edda pulls the lanyard herself, in front of you, and the flare climbs and
blooms red over the shoals. A defensible call, made under pressure, by
the people who will have to live with it.

The ships weigh anchor and turn in through the marked channel, and the
Riftjaw is waiting in that channel.

There is no cutscene yet, and that is the cruelty of it: waves five and
six arrive while it happens. You fight with your back to the water and
see it in pieces between strokes: a guide fire eclipsed, a mast folding
sideways, a sound rolling in off the shoals that nobody on the beach has
a name for. The line cannot be left, so you hold it, and you watch.

Only when the sixth wave breaks does the scene take the camera, and it is
short and it is the worst thing in the campaign: the last ships going
down in full view, the sailors' souls drawn out of the water and
swallowed, points of light pulled under in rows, like a net hauled the
wrong way.

Then you are on the flats. The objective is honest: **Rescue survivors
(0/20).** You fight across knee-deep water and sand, among wreck debris,
pulling people out as they wash in. The counter asks for twenty. The sea
gives you seven.

The pulse ebbs. The trough leaves a scatter of strandlings on the flats:
broken, half-rewritten things dragging themselves in the shallows. They
are not a threat. They are work. The squad walks the tideline beside you
and puts them down one at a time, nobody talking, and it is ugly and
brief and nobody calls it a victory. Ollun stands a moment at the
waterline,
watching where the wounded Riftjaw went down with its stolen light:

> **Ollun:** "It took the light down with it. A wound fed like that does
> not close."

Then the quiet comes, and the quiet is the trough of the pulse, and it
feels wrong, like a held breath.

First light is not a cutscene. You walk the tideline yourself, past the
rows of sailcloth, and the quest asks nothing of you except to go to your
people. Saul is with the seven survivors by a fire; approach, and he
says, "Seven," and keeps working. Tam sits on the breakwater stair saying
nothing at all, which is how you know how bad it is. Edda stands at the
waterline, looking at the flat sea, and as you reach her, Coalfast is
already walking down to turn her away from it:

> **Coalfast:** "Edda. Look at me, not at the water."
>
> **Edda:** "You needed a quartermaster an hour ago."
>
> **Coalfast:** "I need one now. The seal still needs its charges, and the
> charges need their maker."

> **Quest complete: The Sundered Arrival.**

### Q7. On Our Own

Where you walk: the Landing surf line at low water, then back through
Gullhaven, post to post.

Purpose: pick up the pieces, and turn the wreck into the seal. The
salvaged star-glass is how the relief force stays part of the plan.

> **Quest accepted: On Our Own**
>
> *Mender Saul, at the Landing*
>
> - Recover the relief banner
> - Bring the recovered name-tags to Saul (0/12)
> - Salvage star-glass from the wrecks with Edda (0/8)
>
> *Rewards: experience, 3 silver*

You pull the banner out of the surf, heavy with water. Saul takes the
name-tags one at a time and writes each name in his book before he sets
the tag down. Every one.

At the posts, the responsibility scenes play. Nobody says "we killed
them." Nobody is allowed to drown in it alone, either:

> **Edda:** "You told us not to call them."
>
> **Coalfast:** "I told you what I thought. Then we made the call
> together."
>
> **Edda:** "They came because we asked."
>
> **Coalfast:** "I know. This is not yours to carry alone."

Later, Ollun tries to take the whole decision onto himself:

> **Ollun:** "I gave them the approach."
>
> **Coalfast:** "I approved it."
>
> **Ollun:** "You voted against it."
>
> **Coalfast:** "Then I lost the vote. After that, it was my order."

And Edda's guilt is specific, because her hand pulled the lanyard:

> **Edda:** "I sent the flare up."
>
> **Tam:** "From a mortar I rigged, off a beach I promised we would
> hold. Keep going; there is plenty."

**Variant lines, by your vote in Q4:**

- If you voted for the signal, Edda finds you, unprompted: *"You voted
  with me. Remember that I asked you to."*
- If you voted against, it is Tam: *"You and the Warden were right. I
  would vote the same way again anyway."*

Same scene. Different wound.

As the quest closes, Saul stops you, without explanation:

> **Saul:** "Have you read the names above the harbor steps? Read them
> tonight."

> **Quest complete: On Our Own.**

## Act III: The plan fails

### Q8. The Outer Seal

Where you walk: up from the meadow into the Riftfields, then a wide arc
around the breach, ward site to ward site, closing inward.

Purpose: raise the rite that has closed this breach for twelve centuries.

> **Quest accepted: The Outer Seal**
>
> *Riftwatch Ollun, at the Riftfields edge*
>
> "Four wards, tuned in sequence, and the wound closes from outside. It
> has worked for twelve hundred years. Walk with us."
>
> - Escort Edda between the ward sites
> - Raise the first ward (defend the tuning, 3 waves)
> - Raise the second ward (hold the counter-note while Tam re-tunes)
> - Raise the third ward (keep Edda alive)
> - Raise the fourth ward
> - Hold the line while the seal takes

*[Private outdoor instance: a full copy of the Riftfields approach per
party, so the operation and its world-state changes belong to you.]*

The operation is the squad at its best, and playing it feels like being
inside a machine that has run for a thousand years: Edda places, Tam
tunes, you and Coalfast hold, Saul keeps everyone standing, Ollun calls
the pattern from the center like weather.

But the breach is not a machine, and no two wards go up the same way:

- **The first ward** raises the way the rite-book says it should: Edda
  places, Tam tunes, three waves break against you and Coalfast, and the
  chord takes. This is the rite as twelve centuries rehearsed it.
- **At the second ward, the tuning misfires.** The harmonic slips
  mid-verse and the ward's note starts to fall. Tam has to begin the
  verse again, and someone has to hold the counter-note while he does.
  He puts the striker in your hand without looking up. You hold the note
  steady while the line gets thinner around you. *[The same stage-object
  work the finale asks for at Tam's station. Taught here, spent there.]*
- **At the third ward, no wave comes.** Instead the breach sends one
  thing: fast, deliberate, low through the grass, straight for Edda's
  hands while they are full of star-glass. A moving protect fight, not a
  line fight. Coalfast calls it in two words: "On Edda!" and the machine
  collapses inward around her.
- **At the fourth ward, nothing comes at all.** The squad stands to, and
  the field is silent, and the silence is worse than the waves. Ollun
  keeps calling the pattern, quieter and quieter. Tam does not joke. The
  ward goes up without a drop of blood, and nobody trusts it.

And it works. The breach contracts. The creatures weaken mid-wave,
visibly. The wards sing one clean chord, and Ollun, who hedges everything,
allows himself four words:

> **Ollun:** "We have it."

Then the light inside the breach changes, and the chord goes sour. The
wards pull apart, not because anything is attacking them, but because they
are anchoring a wound whose centre is not inside the waking world at all.

> **Ollun:** "The seal will not take. Its heart is inside."

You expect panic. What you get is recognition. These people grew up
beneath the statue; you are the only one present who did not.

> **Tam:** "Hale's year."
>
> **Coalfast:** "Ollun. From the heart. Can it be closed?"
>
> **Ollun:** "Carried in, with the Bellheart. Yes."
>
> **Coalfast:** "Then it closes."

He is already re-rigging his shield straps for a descent. Nobody asks who
carries it in. On this island, that question was answered a hundred years
ago, in bronze.

> **You:** "How do you get back out?"
>
> **Coalfast:** "I do not."

**Choice (your follow-up; his ground never moves):** accusatory, pleading,
or silence.

> **Coalfast:** "I knew it might come to this. I hoped it would not."

Around you, calm preparation: Tam checking his weapon, Edda dividing the
charges, Saul packing his kit. Nobody argues about whether to go in. The
argument about who stays has not happened yet, because everyone here
believes the answer is one, and that it is Coalfast.

> **Quest updated: The Outer Seal**
>
> - Enter the breach

> **Quest complete: The Outer Seal.**

## Act IV: Five to hold, one to close

### Q9. The Inside Plan

Where you walk: through the breach into one vast hollow of dream-stone,
the heart at its centre, open ground all the way to it. The five anchor
pillars stand around the heart in a wide ring. Nothing about the space is
a maze; the wrongness is in the light and the sky, not the navigation.

Purpose: escort Coalfast and the charge to the heart. One stays. That was
the plan.

> **Quest accepted: The Inside Plan**
>
> - Escort Coalfast and the charge to the heart
> - Slay the heart's defenders (0/20)
> - *(updated)* Take positions

The escort fight crosses the hollow, the squad in formation around
Coalfast and the charge, composed, professional, expecting to walk four of
themselves and you back out.

At the heart there is one anchor: a standing collar of dream-stone where
the rite must be held while the charge does its work. Edda begins setting
her charges around the heart. Coalfast hands Tam his cloak, sets his feet
at the anchor, and takes hold.

> **Coalfast:** "Set them and go. I hold from here."

The wound answers him. Not with defenders. It divides.

Where there was one anchor there are two, straining against each other,
and the seal pattern starts to slide apart between them. Tam is moving
before anyone has spoken.

> **Coalfast:** "Tam."
>
> **Tam:** "You cannot hear the counter-note from there. I can hear it
> from here. Mind your own ward."

It divides again. Three. Ollun stands very still, listening to the way
the northern anchor drifts, and says the quiet part exactly once; nobody
answers it:

> **Ollun:** "Wounds do not divide themselves. It has learned the rite.
> It is answering us." Then, quietly: "The north one moves. Nobody else
> can read it."

He walks to it.

It divides again, and Saul is at the fourth before it has finished
forming, calm the way he is calm about everything.

> **Saul:** "Somebody has to hold the holders."

It divides once more. And stops.

> **Ollun:** "Five."
>
> **Edda:** "Five." She laughs the way she laughs when she is terrified.
> "It counted us."

She sets the last charge, checks the trigger line twice, and takes the
fifth anchor with the detonator in her fist.

That is the reveal, and nobody announces it. There is no survey and no
speech and no one asking for volunteers. The wound asked one at a time,
and one at a time, without hesitating, they answered. Coalfast looks at
each of them at their stones, the argument lost before it could be had.
You have heard his next word all campaign: at the meadow gate, at the
guide fires, at the bottom of a breakwater stair he walked back out of.
It has never cost this much.

> **Coalfast:** "Positions."

> **Quest complete: The Inside Plan.**

### Q10. The Last Bell

Purpose: keep them alive until the charge is armed. Then do the hardest
thing in the campaign: leave.

> **Quest accepted: The Last Bell**
>
> - Answer the harmonic slips (relieve stations as Ollun calls them)
> - Keep every anchor holder standing
> - *(updated)* Take the Bellheart and go

The five stations form a pentagon around the charge. Each squad member
performs a task only they can perform; you are the free hand. Saul calls
the squad's status like a heartbeat: *"Five standing."* Edda reports the
arming as the scenario clock. Five rotations, authored, rising, and no
two ask the same thing of you:

1. **South slips.** Ollun calls it: *"South. Now."* You rotate, clear the
   adds, steady the ward. The loop as taught; the one rotation that goes
   the way it is supposed to. *"Two tenths."*
2. **The counter-note bends.** Tam's station, and the enemy is not adds
   but interference. You hold the counter-note with the striker while Tam
   corrects, the second ward's work again, at full stakes. *"Four
   tenths."*
3. **Something wears Saul's shape.** At the life anchor, the dream-matter
   answers him with a copy of himself: a priority target that must die
   while the real Saul keeps cleansing, and does not stop to help you
   decide which of them to trust. *"Six tenths."*
4. **All five slip at once.** Ollun's voice cracks for the only time in
   the campaign: *"All of them. All five."* You can answer one. You
   choose, you run, you hold one station, and you listen to the other
   four hold themselves: Coalfast gone silent because he is too busy to
   speak, Edda swearing at the charge, and then Saul, after the longest
   three seconds in the campaign: *"...Five standing."* You cannot hold
   everything. That is the lesson, and the campaign teaches it here,
   minutes before it matters. *"Eight tenths."*
5. **Everything converges on the charge.** The last rotation is a single
   order: shield Edda. The casings you proofed at her bench are under
   your hands again while she arms the last of them. *"Nine tenths."*

*[Party: all human players rotate as the outside hands; enemy pressure
scales with player count; the five stations are never yours to take.]*

When the charge is armed, Coalfast orders you out with the Bellheart. You
are allowed to argue. It is scripted, and it matters that you say it:

> **You:** "I can take a station."
>
> **Ollun:** "No. The outside lock must be turned after the charge fires."
>
> **You:** "Send one of you."
>
> **Coalfast:** "Every person in here has a job only they can do. So do
> you."
>
> **You:** "You expect me to leave you?"
>
> **Coalfast:** "I expect you to close the breach. This is our post. Yours
> is outside. You held the east hedge when I asked. Hold this one. Go."

The retreat is played, not shown. You run the exit path with the Bellheart
burning cold in your hands, and behind you the squad's communication goes
clipped and professional, fading with distance. Nobody performs a final
monologue. Nobody says goodbye.

> **Edda:** "Charge at nine tenths."
>
> **Ollun:** "North drifting. Correcting."
>
> **Tam:** "Counter-note holds."
>
> **Saul:** "Five standing."

You cross the threshold into the waking world. Behind you, only then:

> **Coalfast:** "Edda. Now."

> **Quest complete: The Last Bell.**

### Q11. Close the Door

Purpose: the seal needs one hand on the outside. Yours.

> **Quest accepted: Close the Door**
>
> - Place the Bellheart in the watchstone
> - Strike it at the moment of detonation

You come out into ordinary night air, alone, and the silence out here is
obscene. You place the Bellheart into the watchstone the squad prepared.

Then you wait, hand on the striker, and the Bellheart begins to vibrate:
faint, then building, a cue readable through your hands without a line of
UI text. The timing is generous but real, and your hands already know the
job: it is the same timed stroke Tam drilled into you on the practice
bell, back when the worst thing the bell could say was one toll. The bell
does not forgive early and it does not forgive late. There is no tutorial
here. There does not need to be. Miss it, and the sequence holds
at the brink and the cue comes again; the game will wait, because the
sacrifice cannot land until you close the door. You do not survive a
cutscene here. You do the last job.

You strike. The Bellheart rings once, the loudest sound in the campaign,
and the breach collapses like a held breath let out. Gullhaven is safe for
roughly one hundred years.

The music stops. Not a fade. It stops.

> **Quest complete: Close the Door.**

## Endings

### The Last Watch

Where you walk: the warden's night rounds through the empty redoubt, post
to post, then the sea road to the Old Beacon in Galecrest.

Purpose: someone has to close the watch, and you are the only person left
who served with them. This quest has a verb: you perform each member's
end-of-watch duty, each one something you learned or saw in Act I.

> **Quest accepted: The Last Watch**
>
> *Alone, always, even for a full party: each member walks their own copy*
>
> - Perform the end-of-watch duties (0/5)
> - Write the names in the watch log
> - Carry the Bellheart and Ollun's record to the Old Beacon
>
> *Rewards: none. That is deliberate.*

No music. No markers beyond the duties. The civilians have come back, and
the redoubt is clean and empty:

- **Bank Edda's forge.** It is found cold. Grandmother sleeps under
  canvas. The drawer of unsent letters is empty; someone posted them.
- **Close Saul's book of names.** It lies open to the relief force's
  pages, every name written in full.
- **Weight Ollun's papers.** The calculations end in the middle of a
  sentence: *"if the fifth harmonic is answered in kind, then"*
- **Secure Tam's tower ropes, and give the bell back its voice.** The
  bell hangs without a heart: Tam hung the Bellheart in it after the
  vault, and the Bellheart has gone on to the work it was made for. His
  ordinary iron clapper waits on the bench where it has sat since,
  cleaned and tagged in his hand: *for whoever closes the watch.* You
  hang it, and you ring the all-clear, one long soft stroke, the way he
  taught you over the meadow. It is the only note in an ending without
  music, and the bell rings again with an ordinary heart, because the
  island still works. The rite-book is gone from the shelf.
- **Turn Coalfast's chair to face the door,** the way he left it every
  night. It is found facing the sea. At the Landing below, a small boat
  waits with fresh paint stacked beside it, unopened.

Each duty plays one memory line. The rounds end at the watch log, where
you write five names in your own hand.

Then the delivery: across the sea to the Old Beacon. Its keepers read the
founding mark and go very quiet; their forgotten daughter-house kept the
Vigil for twelve centuries without relief or recognition. When the
Bellheart is set beside the Old Beacon, it rings once, with no bell around
it. The combined record gives the surviving Vigil a way to hear the next
great breach coming.

> **Quest complete: The Last Watch.**

### Willowfen epilogue: Names Without Graves

Purpose: Nell's request. Her father has a grave. The five do not.

> **Quest accepted: Names Without Graves**
>
> *Nell, at the bell tower*
>
> - Carry the name-stones to Willowweep
> - Plant the name-stones (0/5)

You plant the stones beneath the willow, one at a time, and speak the
names: Warden Coalfast. Riftwatch Ollun. Quartermaster Edda. Mender Saul.
Bellkeeper Tam.

After each name, a distant bell note sounds. After Coalfast's name, the
insects and the frogs go silent. Five lights settle beneath the willow and
fade.

> **Nell:** "The bell only ever asks one question: who will come? For
> twelve hundred years the answer was them. Now it is me."

There is no boss, no fanfare, no joke to release the pressure. You are
allowed to leave in silence.

> **Quest complete: Names Without Graves.**

## Afterward

### Post-campaign Gullhaven

For your character, permanently: the squad's posts stand empty behind
their doors, each holding its small memorial. The shared town carries a
permanent memorial that reads correctly for every player at every stage.
The statue above the harbor steps has five new names on the plinth, and
below them, room for more.

Nell takes over the bell. One toll and two tolls keep sounding for public
events, and players keep answering them, because the island still works.
They made it work.

### Attunement: the way down

The Drowned Relief is per-character attuned: finishing the campaign is
necessary but not sufficient. A short shared-world chain does the rest.

> **Quest accepted: The Lights Under the Flats**
>
> *Nell, at the bell tower*
>
> "The salvagers have stopped going out. They say there are lights under
> the flats at low tide. Lights that move."
>
> - Speak with the Wreckfield salvagers
> - Recover the fleet's sailing logs from the flagship wreckage (0/4)
> - Bring the logs to the harbormaster

You walk the flats at low water and see them yourself: points of light,
under the sand and the hulls, moving. They crowd thickest around the
flagship wreckage, and her chart room still holds the fleet's logs. The
rumor and the proof are the same walk.

The logs show course corrections beginning days before landfall.
Something shadowed the relief force from the moment the signal went up,
exactly what Coalfast warned the council about. The squad never learned
this. You do.

> **Quest accepted: A Key of Star-glass**
>
> - Collect Edda's spare resonance shard from the redoubt stores
> - Set the shard at the mouth of the wreck-maze

The Riftjaw's pocket sits half inside dream-matter; only star-glass opens
the way. Edda's outer-seal work left finished spares in the redoubt
stores, tagged in her handwriting. You carry her work down to the
Wreckfields and set it at the mouth of the maze, and the way opens.

*[Each party member runs the chain once and carries their own shard.]*

> **Attunement complete: The Drowned Relief is open.**

### The Drowned Relief (repeatable five-player dungeon)

You go in through the fused relief flagship. You fight dream-echoes
wearing the sailors' memories: the taken souls, given shape by the
Riftjaw. You recover the relief banner and the final dispatches, and you
kill the Riftjaw, and when it dies the lights it swallowed rise out of the
wreck-maze and disperse, free to find the Dreamer's sleep, the same
imagery as the willow. You return the recovered names to the mainland.

Nobody comes back. Nothing is walked back. The dungeon is justice and
release, and gear, which is allowed to come from here because it never
comes from the grief.
