# Crucible of the Last Spring raid

## Status

Living design for a level-cap, ten-player raid with two boss encounters across
four linked maps. The complete Normal route remains hidden behind development
access while its tuning, generated character models, and group-play validation
are unfinished. Public Finder, loot, deeds, Reliquary pages, and a shared
raid lockout remain out of scope until that launch pass.

The route is ordered and shares one instance family:

1. Forge Approach: five packs and two promoted Warden minibosses guard three
   records and the sealed arena gate.
2. Crucible of the Last Spring: Ignivar, Herald of the Last Flame.
3. Molten Assembly: three more packs and two promoted Wardens guard the final gate.
4. Inner Crucible: Varkhul, Forgefather of the Last Flame.

Normal Ignivar's fire, tank swap, frontal, conduit, movement cones, priority add,
and final burn loops are playable. Varkhul adds a second tank swap, deterministic
forge patterns, Shared Pyre, an add intermission, and a timed final burn.
Heroic expansion beyond the existing Ignivar behavior remains deferred until
Normal has been group-playtested.

## Story

Varkhul tried to preserve the dying Last Spring by binding its memory into
living metal. The Ember Sentinels and Crucible Wardens in the approach and
assembly are failed temperings from that work. Ignivar was the first design
to endure, forged as Varkhul's herald, seal, and key to the Inner Crucible.

Archivist Maelin Emberward tells this story through the development-only quest
chain Echoes in Iron, The Herald's Heart, and The Forgefather. Three records in
the approach establish the failed experiments. Ignivar's core can be inspected
only after his death and reveals the path to his maker.

## Forge Approach

The approach is a separate forge-themed map entered before Ignivar's arena. Its
existing five hand-placed formations contain ten Derelict Mechs, three Ember
Sentinels, and five Crucible Wardens. Two Wardens are promoted in place to
control-immune minibosses; no Cinder Artificer healer is placed in this room.
Pulling one member engages its complete authored pack without chaining into the
next formation. The promoted Wardens use an instant Crucible Stomp every twelve
seconds when a player is within nine yards. It deals 18% maximum-health Fire
damage and replaces the ordinary Warden's interruptible Crucible Quake. The room's
geometry, lighting, decoration, and pack coordinates remain unchanged. Its north
gate opens only after the last required guardian dies. The gate state is derived
from living instance mobs and survives normal player movement between the linked
rooms without creating a separate raid save.

After Ignivar dies, Molten Assembly opens as the third linked map. It reuses the
current forge-approach interior presentation and contains three authored packs:
seven Ember Sentinels and two promoted Warden minibosses, with no healer automata.
Clearing them opens the Inner Crucible.

The four-room family shares party ownership, difficulty, occupancy, timeout,
and atomic release. A player remaining in any linked room keeps the complete
family alive. Development entry begins in the approach instead of placing the
player directly beside Ignivar.

## Group and encounter goals

- Group size: 10 players.
- Intended composition: 2 tanks, 2 healers, 6 damage dealers.
- Primary loop: carry fire safely, aim the boss frontal into a conduit, then use
  the released water to remove the fire.
- Priority phase: an immobile add casts Apocalypse while Ignivar remains active.
- The room must keep every actionable cue readable at every graphics tier.

## Arena

The Crucible of the Last Spring is a flat octagonal room, 66 units across its
widest axes. An eight-unit central seal marks the future Apocalypse add spawn. Four
water conduits stand at the diagonal local coordinates `(+-22, +-22)`. The entrance
is on the south edge.

The fighting floor has no pillars, cover, or line-of-sight blockers. The octagonal
shell, floor, and collision all derive from `IGNIVAR_LAYOUT`. Conduit identities,
positions, and frontal geometry derive from `src/sim/ignivar_arena.ts`.

## Normal mechanic outline

1. Ignivar applies the fire mark to three players.
2. Each mark starts at one stack, deals 5% maximum health every two seconds, and
   gains a stack after each tick. Damage rises to 10% and then caps at 15% at
   three stacks. The red personal radius intensifies with its stacks.
3. Overlapping another player deals contact damage, but does not spread the mark
   on Normal.
4. Ignivar casts a frontal toward the active tank.
5. The tank aims the frontal into a ready conduit.
6. A struck conduit becomes active and produces a water-cleanse zone.
7. Marked players cross the water separately to remove their mark.
8. Water removes the complete mark regardless of its current stack count. The
   conduit is then spent for the rest of the pull, so the cycle must use another
   station.

Current tuning is three marks per cycle, one tick every two seconds, one cycle
every 28 seconds, a three-second frontal cast, and a ten-second water window.
All four conduits reset only when the encounter resets. These are playtest
values, not final balance pins.
During the frontal cast, a fire vortex and body glow build around Ignivar. Its
release sends a fiery fissure from the boss to the end of the aimed cone, where
the heavy impact stack adds flame pillars, smoke, embers, light, and screen
feedback. Circular ground rings and persistent scorch decals stay disabled, so
the floor cone remains the only danger shape.

## Rain of Cinders

After a 16-second opening delay, Rain of Cinders begins a 20-second recharge.
When that recharge ends it queues behind any cast already in progress, then
Ignivar locks his facing and casts for three seconds. Three narrow floor cones
extend from him at equal angles and remain clean warning shapes throughout the
cast, with no persistent beam or fire wall. When the cast completes, Ignivar
releases three simultaneous fire eruptions in those directions. Each release uses
a white-hot ignition, molten fissure, rolling flame, fire pillars, smoke, embers,
light, and screen feedback. Players still inside any cone when the cast ends take
45% maximum health as fire damage. The spaces between the cones are safe from
Rain of Cinders damage.

## Falling Cinders

Falling Cinders runs independently of Ignivar's cast queue. Its first pattern
starts after 13 seconds and subsequent patterns begin every 17 seconds, including
while another mechanic is being cast. Normal selects up to five distinct player
positions; Heroic selects up to seven. Both avoid the current tank when the raid
has enough alternatives. The selected positions are frozen when the warning begins,
so the circles never follow their targets. Stacked selections fan outward
deterministically to keep the pattern readable: Normal uses at least six yards of
separation within 25 yards of the arena center, while Heroic uses eight yards
within 27 yards. Any remaining points in a short-handed group fill the same
deterministic spread.

The impact points appear as clean red circles for 2.5 seconds. For the first
0.75 seconds only the circles are visible, then molten meteors descend from the
sky and land exactly when the warning expires. A player inside an impact circle
takes 35% maximum health as fire damage.

## Revolving Inferno

After a 32-second opening delay, Revolving Inferno begins a 40-second recharge.
Ignivar projects three narrow rays at equal angles for a two-second stationary
warning, then rotates them for eight seconds at 18 degrees per second, completing
144 degrees during the active window. The direction alternates between clockwise
and counterclockwise on successive casts. Each ray retains its exact floor lane
and adds a white-hot core, turbulent orange fire, an incandescent blade head,
and an ember trail. Players move
through the three safe gaps as the pattern turns. A ray crossing pulses every
half second for 20% maximum health as fire damage, making a brief mistake
recoverable while repeated contact remains lethal.

## Forge Wave

After a 50-second opening delay, Forge Wave begins a 60-second recharge. Ignivar
locks to one of eight deterministic arena facings and casts for 2.5 seconds. Two
opposite 30-degree safe lanes remain fixed for the complete cast. On release, a
thin circular fire wall expands across the complete room over three seconds,
including when Ignivar is tanked against a wall. Crossing the wall outside either
gap deals 35% maximum health as fire damage and knocks the player directly away
from Ignivar until arena collision seats them at the wall. Each player can be hit
only once per wave.

The windup draws both safe lanes at every graphics tier. The release combines a
white-hot inner flame, a tall orange-red wall, airborne embers, ground glow,
smoke, flame pillars, impact light, and restrained screen feedback. The wall
geometry omits both gaps instead of covering them with decorative fire. No
closed shock ring, lingering circular decal, or graphics setting may obscure or
remove the safe lanes.

## Tank swap

Ignivar uses Forge Strike every 14 seconds while its target is in melee range.
The strike deals 35% maximum health as fire damage, then applies one stack of
Molten Armor for 26 seconds. Each stack increases all damage received by 35%,
including the next Forge Strike and Ignivar's melee swings. The intended Normal
response is to swap tanks at two stacks. With a 14-second strike cadence, the
first tank's mark expires before the complete two-strike rotation returns to
them. Conduit water only removes Brand of the Pyre and never removes Molten
Armor.

## Apocalypse add

The first Normal implementation uses one stationary Ignivar Ashcaller. A forge
portal bursts open at its central spawn. It does not attack or move and immediately
begins an uninterruptible Apocalypse cast. Ignivar remains active, targetable, and
dangerous throughout the add window. Completing the cast wipes the raid. Killing the
Ashcaller cancels it.

## Last Inferno

At 20% health Ignivar enters Last Inferno. His attack speed increases by 20% and
his melee damage increases by 35%. Falling Cinders repeats every nine seconds,
Revolving Inferno repeats every 24 seconds and rotates at 160% of its normal
speed, and a dedicated eight-second sequence alternates Searing Torrent with Rain
of Cinders. Brand, Forge Strike, and Forge Wave stop queuing so the
finale remains demanding but readable. The raid has 45 seconds to kill him. Expiry
is a hard encounter wipe and does not occupy the boss cast bar.

## Judgment of the Forge

After Apocalypse has resolved, reaching 45% health queues a single 12-second
intermission behind any warning or cast already in progress. Ignivar returns to
the arena center and chooses a random rotation and one safe result through the
encounter RNG. Three marked meteors fall for four seconds at three well-separated,
randomized positions. One warning is unmistakably different from the two decoys
and identifies the refuge the entire raid must share.

The impacts deal no damage because players are expected to enter the marked safe
refuge during the warning. For the remaining eight seconds, fire covers the whole
arena and pulses for 12% maximum health every 0.5 seconds everywhere except the
single 5.5-yard safe footprint. The two decoy shelters offer no protection.
On Normal, entering the intermission extinguishes every existing Brand of the
Pyre. On Heroic, every Brand persists for the full intermission and continues its
ordinary six-percent proximity pulse every second within 4.5 yards. A branded
player who enters the shared refuge beside other players therefore damages only
those nearby players; Judgment does not add a separate raid-wide Brand hit. The
water conduits remain frozen in their current state on both difficulties. No
rotating rays or other boss mechanics run during the intermission. Red-hot wall
fissures intensify around the arena perimeter as non-actionable ambience while
the established floor and shelter geometry remain unchanged. All three shelters
shatter with heavy fire releases when it ends, then regular mechanics resume
after a short recovery window.

## Heroic Chains of the Forge

At 18 seconds and every 32 seconds thereafter, Ignivar links the raid into as
many as five proximity pairs for eight seconds. The links have a 2.5-second
attachment grace period. After that grace, a chain begins flashing and gains
endpoint warning flares at eight yards. Reaching ten yards strains the chain;
remaining at that distance for 0.75 seconds severs it and executes both linked
players. Returning inside ten yards clears the accumulated strain.

An unrelated player who moves through a live chain is executed and that pair's
chain immediately breaks; the linked players survive that crossing. The chain
warning, dangerous distance, and crossing rule are identical at every graphics
tier.

Two simultaneous adds are a Heroic candidate, not a Normal requirement. The party
split and DPS check must be tested with the intended 2-2-6 composition before that
variant is accepted.

## Varkhul, Forgefather of the Last Flame

Varkhul waits in the Inner Crucible beside his grand forge and fights with a
separate one-handed warhammer. The encounter uses existing cast, aura, facing,
and ground-warning contracts wherever possible. Every actionable warning must
retain the same geometry on Low and Ultra graphics and across offline and online
worlds.

Both bosses use 120,000 health on Normal. Heroic raises Ignivar to 210,000 and
Varkhul to 200,000; the second encounter also applies explicit Heroic tuning to
its boss and summoned Assembly automata.

### Maker's Brand

Every 14 seconds Varkhul strikes his current melee target for 30% maximum health
and applies Maker's Brand for 30 seconds. The mark stacks to three and increases
damage received from Varkhul by 35% per stack. Tanks swap at two stacks. A taunt
changes the target of the next Brand without transferring or clearing the old
tank's stacks.

### Forgefather's Sweep

Every 26 seconds Varkhul locks his facing toward a non-tank and winds up for 2.5
seconds. He then sweeps a 140-degree, 42-yard frontal that deals 65% maximum
health on Normal and 90% on Heroic. The facing does not follow the target after
the cast begins. Its full actionable footprint remains visible on every graphics
tier.

### Tempering Ray

Varkhul first casts Tempering Ray after seventeen seconds and repeats it every
thirty-two seconds while no other major sequence or forge-beam window is active.
He fixates a non-tank for 5 seconds. The complete 2.7-yard corridor follows the
marked player's current position for the whole cast instead of locking its facing
at the start.

The first other living player between Varkhul and the marked target intercepts the
ray. A successful interceptor takes 70% maximum health on Normal or 85% on Heroic;
without an interceptor, the marked player takes 90% or 120% respectively. Damage
immunity can absorb the hit. The player chosen by the final line check, including
an immune interceptor, receives Tempered Wound for thirty seconds and takes 50%
more damage from Varkhul. This forces tank or immunity rotations instead of letting
one player cover every cast.

The warning is authoritative snapshot state. Its orange corridor and target reticle
move with the marked player; a valid first-body intercept adds a cyan segment and
shield reticle without removing the original target line. Low graphics and reduced
motion retain the full corridor, both endpoints, interception state, width, and timer.

### Cinder Orbs

Varkhul marks three non-tanks for four seconds. The marked players must spread
away from the raid and from one another. They also receive
Red-hot Metal, which deals 4% maximum health every two seconds and absorbs healing
equal to 30% maximum health. Both effects are encounter-owned and cannot be
dispelled. Healers remove the absorb by healing through it.

After the four-second mark, each living target permanently scars their current
position with a 3.5-yard fire field that deals 4% maximum health every second. At
the same instant, six oversized Cinder Orbs burst radially from each target and
travel across the room at nine yards per second for 5.5 seconds. Every orb deals
20% maximum health on contact and can hit each player only once. The marked player
is immune to their own initial fan so the release itself is not an unavoidable
hit. Players carry the marks to the room edges to keep the permanent fire out of
the center and spread apart to separate the eighteen projectile origins. Fire
positions, projectile positions, directions, and remaining travel times are
authoritative snapshot state.

### Forgestorm

Forgestorm releases three waves of five deterministic falling meteors without
occupying the boss cast bar. Every impact warns for 2.5 seconds, then deals 30%
maximum health inside its four-yard circle. The meteor rocks, trails, warnings,
and stable impact identities are snapshot state rather than event-only decoration,
so reconnects and online clients receive the same remaining time and geometry.

### Shared Pyre

Shared Pyre remains in Varkhul's ordinary major-ability rotation alongside
Forgestorm. After a 20-second opening delay and every 38 seconds thereafter, it
marks a non-tank for six seconds with a player-following 5.5-yard gathering circle.
The target selector never chooses a player who still carries Red-hot Metal or its
healing absorb. If no clean non-tank is available, the cast waits and retries.
Normal splits 140% maximum health across the living players in the circle and
visually asks for four players; Heroic splits 200% and asks for five. Fewer players
each take a larger share. The mechanic serializes with Varkhul's other major
sequences and forge-beam windows.

### Anvil's Decree

Varkhul walks to his work position without teleporting, turns toward the grand
forge, and resolves three strikes two seconds
apart. On Normal the strikes deal 10%, 10%, and 20% maximum health raidwide. On
Heroic they deal 14%, 14%, and 25%. The impacts have no directional ground lane:
the raid responds with healing and defensives instead of positional movement. The
cast serializes with other major mechanics so its healing check does not overlap
another major sequence. On Heroic only, each hammer impact also marks three
deterministic meteor locations for 1.8 seconds. Each meteor has a 3.5-yard impact
radius and deals 35% maximum health. These falling-meteor warnings are
authoritative snapshot state. Neither the raidwide hammer impact nor its meteors
apply camera shake.

### The Master's Assembly

Two crucible pillars stand permanently on opposite sides of the room. They are dark
outside their assigned windows, so the raid can learn their positions before they
activate. An active pillar charges for three seconds and then projects a continuous
fire beam into the forge. A living player blocks a lane by standing within 1.35 yards
of its centerline, but only between 12% and 80% of the lane; the shared mouth beside
the forge cannot let one player cover both beams. The first body struck owns that lane,
and one player can never block both pillars.

Each beam window first announces which pillar is charging. The beam remains harmless
through the full three-second warning, then a second callout announces the actual
ignition as the lane becomes blockable.

Blocking is an escalating healer check rather than a static soak. Damage ticks once
per second: 6% maximum health on the first Normal tick and 8% on Heroic, increasing by
2 or 3 percentage points respectively for every consecutive tick. Leaving the beam
does not immediately remove the exposure. Its stack limit resets after ten seconds on
Normal and after sixty seconds on Heroic, so repeated Heroic assignments require real
rotation planning.

The pillars first teach this interaction at 80% boss health: the left lane burns for
eight seconds, both lanes rest for two seconds, then the right lane burns for eight
seconds. Major boss sequences pause during this lesson. At 50%, Varkhul becomes immune,
moves to his fixed forging position immediately in front of the anvil, faces the forge
with his back to the raid, and activates both pillars for the full intermission. At 20%,
the final burn loops left for eight seconds, rests four, burns right for eight, and
rests four until Varkhul dies. No rune interface, symbol assignment, forced raid
teleport, or Molten Core delivery exists in this version.

After the add intermission, a single pressure soak begins at 35% health. One pillar,
chosen deterministically for that pull, gives the ordinary three-second warning and
then burns for six seconds. New major sequences pause during this short check. If the
raid pushes Varkhul to 20% while it is active, Masterpiece Unbound takes priority. On
Normal it replaces the pressure soak with the final pillar cycle. On Heroic it shuts
the pillars down permanently and vents forge heat to 0% before Worldfire begins.

Four large forge-fire portals stand near the room corners. Each add wave receives a
two-second portal warning before its enemies emerge. Normal schedules three waves of
one Crucible Warden and three Ember Sentinels for twelve adds total; the next portal
waits until the current ordinary wave is dead, then opens three seconds later. Heroic
schedules four waves of one Warden and four Sentinels for twenty adds total; the next
portal opens as soon as the current wave dies or after fourteen seconds, whichever
comes first. A persistent forge label shows `Wave X/Y | Enemies: N`. The intermission
lasts at most sixty seconds on Normal or seventy on Heroic and ends early only after
every scheduled add has spawned and died. The Warden pursues and melees while casting
interruptible Crucible Quake every twelve seconds. A completed Quake adds 8 percentage
points of forge heat on Normal or 10 on Heroic; an interrupted Quake adds none. Heroic
also raises Sentinel health by 20% and its melee, sweep, and burn by 25%, and raises
Warden health and melee by 25% while increasing Quake from 180-230 to 260-330 damage.
During the intermission Varkhul strikes the anvil every two seconds,
driving a visible forge burst, a hammer swing, and a positional metal impact cue.
Sentinels use ordinary melee pursuit. Both add types enter already targeting the living
tank with the highest threat on Varkhul, then obey normal threat and taunts. When the
last add falls, Varkhul is stunned for fifteen seconds and takes 50% increased damage.

A Cinder Artificer runs on a separate portal clock and never replaces, consumes, or
delays an ordinary Warden/Sentinel wave. The first Artificer portal opens ten seconds
after the intermission begins and another opens every eighteen seconds while the phase
continues, rotating deterministically through the four corners. After its two-second
portal warning, the Artificer runs directly to Varkhul and channels Recalibrate for six
seconds. Recalibrate heals once after each complete second: 2% of Varkhul's maximum
health per tick on Normal and 3% on Heroic, for 12% or 18% if the full channel
completes. Interrupting or controlling the Artificer stops future ticks without undoing
healing already applied. A new portal is only queued when the warning and complete
repair channel both fit in the remaining intermission, so no unfair late healer appears.
The Artificer has 30% more Heroic health than its Normal counterpart and remains fully
stunnable, rootable, slowable, silenceable, and interruptible. Its channel visibly uses
Channel Start, the loopable Channel take, then Channel End only after a successful
repair. Artificers use their own scheduler and do not change ordinary wave timing, but
an Artificer whose portal has already opened must still be killed before the
intermission can end early.

Crucible Quake uses the Warden's authored JumpSlam take; ordinary Warden melee uses its
separate Attack animation. Sentinels likewise use their authored melee Attack and Hit
reactions.

An overhead ten-segment ring and exact percentage label display persistent forge heat
from 0% to 100%. Each active unblocked beam adds 6% per second. On Normal, each active
blocked beam cools 2% per second and a fully inactive forge cools 3% per second. Heroic
heat never cools: successful blocking only prevents new heat. At 75% and 90%, the raid
receives explicit danger callouts. At 100%, Forge Meltdown deals 65% maximum-health raid
damage on Normal or 75% on Heroic, then pulses every second for five seconds for 15% or
20% respectively. The meter remains fully red throughout the pulses.
During an intermission Meltdown, portal countdowns and future wave scheduling pause for
the five-second pulse sequence. Varkhul stays immune and enemies already in the room keep
attacking. When the forge vents back to 0%, both pillars give a fresh three-second charging
warning, pending portals resume from their preserved countdowns, and every future wave is
still required. Only killing all scheduled adds ends the intermission correctly and grants
the fifteen-second vulnerability window.

Quest-style top-center callouts announce the left pillar, right pillar, both pillars,
opening portals, both heat warnings, and the death of the last intermission add. These
messages reinforce the world VFX without replacing them and are delivered individually
to every player in the encounter. Heroic Worldfire adds distinct start, closing, and
full-room callouts.

### Masterpiece Unbound

At 20% health on Normal, non-tank mechanics run 25% faster while the forge begins the
repeating left/rest/right/rest pillar cycle described above. Varkhul must die within
45 seconds. Maker's Brand keeps its 14-second cadence so the tank-swap rhythm does not
change during the final burn.

On Heroic, Worldfire simultaneously ignites the outer four yards of the room. The safe
circle then contracts through six deterministic steps, one every seven seconds: 36,
30, 24, 18, 12, 6, and finally 0 yards of safe radius. Standing in the fire deals 12%
maximum health as fire damage every second. At 42 seconds the entire room burns and
those ticks rise to 30%, leaving three final seconds before the existing 45-second hard
wipe. One continuous field uses the same molten-crack floor and flipbook flames as
Cinder Orb fire; only one clean ground-level ring marks its advancing inner edge, with
a localized countdown above the room. It never uses smoke and does not remove actionable
geometry on Low graphics or reduced motion.

The Heroic final phase deliberately strips the rotation down to Worldfire, Forgefather's
Sweep, Anvil's Decree meteors, and ordinary melee. Entering it cancels any active major
sequence, disables both pillars, freezes forge heat at 0%, and suppresses Maker's Brand,
Cinder Orbs, Forgestorm, Shared Pyre, and Tempering Ray. Reaching the 45-second
deadline fires the hard-wipe hit once, but a surviving immune player remains inside permanent full-room
Worldfire; the flames and their one-second lethal ticks only end when Varkhul dies or
resets.

## Music

The linked route uses authored ambient compositions and versioned MP3 streams:

- Forge Approach uses `ignivar_forge_approach`.
- Ignivar's arena uses `ignivar_raid_arena`.
- Molten Assembly reuses `ignivar_forge_approach`.
- Inner Crucible uses `ignivar_inner_crucible`.

The three cues share a forge leitmotif and restart independently when the player
crosses into the next map. Ordinary combat continues to use the global combat
layer rather than adding unrequested boss-specific tracks.

## Art production

The approved visual wave contains three biped automata, Varkhul, his separate
warhammer, and the grand forge. Character concepts follow Ignivar's charcoal,
dark iron, burned bronze, and furnace-orange palette while preserving distinct
silhouettes. Final shipping models use the Tripo intake, a KayKit-compatible rig
with hand sockets, repository QA, KTX2 compression, literal fingerprints, and
the media manifest. Concept art is not a substitute for the six shipping GLBs.

## Heroic candidates

- Contact with a primary fire mark applies a secondary mark.
- Secondary marks require water but cannot propagate again.
- Fewer conduits begin available or their active water window is shorter.
- Two Apocalypse adds may force a controlled party split.

## Delivery slices

1. Shared arena geometry, hidden development instance, and conduit grayboxes. Done.
2. Location-anchored frontal telegraph and authoritative conduit state changes. Done.
3. Fire marks, periodic damage, overlap damage, and water cleanse. Done.
4. Full encounter reset behavior and 14-second Forge Strike tank swap. Done.
5. Apocalypse add, cast bar, wipe, and phase timing. Done for Normal: one
   stationary 7,000-health add spawns at 65% boss health and channels for 20
   seconds while Ignivar remains fully active.
6. Last Inferno, stack-responsive mark visuals, warning yells, and automated
   2-2-6 encounter-flow validation. Done. Human group tuning, final models,
   authored audio, and final dialogue remain.
7. Rain of Cinders movement cones. Done for Normal. Human group tuning remains.
8. Revolving Inferno and Forge Wave movement patterns. Done for Normal. Manual
   visual validation and human group tuning remain.
9. Judgment of the Forge intermission and the accelerated, alternating Last
   Inferno finale. Done for Normal. Human tuning remains.
10. Forge Approach and Molten Assembly packs, Warden miniboss promotions, ordered
    gates, and four-room instance lifetime. Done for Normal.
11. Maelin's three-quest lore chain, three records, and Ignivar core reveal.
    Done for the hidden development route.
12. Varkhul's Maker's Brand, Cinder Orbs, Red-hot Metal, Forgestorm, Shared Pyre,
    Anvil's Decree, Master's Assembly, and Masterpiece Unbound. Done for Normal; human tuning and
    final visual proof remain.
13. Three authored ambient themes with per-room routing and versioned streams.
    Done.
14. Tripo model wave for the three automata, Varkhul, his warhammer, and grand
    forge. Concepts and a resumable production recipe are ready; final GLBs and
    in-game previews remain.
15. Heroic rules, shared raid lockout, rewards, Finder, and launch tuning.
