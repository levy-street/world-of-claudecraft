# Crucible of the Last Spring raid

## Status

Living design for a level-cap, ten-player raid with two boss encounters across
three linked maps. The complete Normal route remains hidden behind development
access while its tuning, generated character models, and group-play validation
are unfinished. Public Guide, Finder, loot, deeds, Reliquary pages, and a shared
raid lockout remain out of scope until that launch pass.

The route is ordered and shares one instance family:

1. Forge Approach: six automata guard three records and the sealed arena gate.
2. Crucible of the Last Spring: Ignivar, Herald of the Last Flame.
3. Inner Crucible: Varkhul, Forgefather of the Last Flame.

Normal Ignivar's fire, tank swap, frontal, conduit, movement cones, group soak,
priority add, and final burn loops are playable. Varkhul adds a second tank
swap, deterministic forge patterns, an add intermission, and a timed final burn.
Heroic expansion beyond the existing Ignivar behavior remains deferred until
Normal has been group-playtested.

## Story

Varkhul tried to preserve the dying Last Spring by binding its memory into
living metal. The Ember Sentinels, Crucible Wardens, and Cinder Artificers in
the approach are failed temperings from that work. Ignivar was the first design
to endure, forged as Varkhul's herald, seal, and key to the Inner Crucible.

Archivist Maelin Emberward tells this story through the development-only quest
chain Echoes in Iron, The Herald's Heart, and The Forgefather. Three records in
the approach establish the failed experiments. Ignivar's core can be inspected
only after his death and reveals the path to his maker.

## Forge Approach

The approach is a separate forge-themed map entered before Ignivar's arena. It
contains three packs, with two automata in each pack and all three automaton
roles represented. Its north gate opens only after the last required guardian
dies. The gate state is derived from living instance mobs and survives normal
player movement between the linked rooms without creating a separate raid save.

The three-room family shares party ownership, difficulty, occupancy, timeout,
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
while another mechanic is being cast. Five deterministic random impact points
appear as clean red circles for 2.5 seconds. For the first 0.75 seconds only the
circles are visible, then molten meteors descend from the sky and land exactly
when the warning expires. A player inside an impact circle takes 35% maximum
health as fire damage. The points stay inside the arena and are separated enough
that their damage areas cannot overlap.

## Revolving Inferno

After a 32-second opening delay, Revolving Inferno begins a 40-second recharge.
Ignivar projects three narrow rays at equal angles for a two-second stationary
warning, then rotates them for eight seconds at 18 degrees per second, completing
144 degrees during the active window. The direction alternates between clockwise
and counterclockwise on successive casts. Each ray retains its exact floor lane
and adds a white-hot core, turbulent orange fire, and ember trail. Players move
through the three safe gaps as the pattern turns. A ray crossing pulses every
half second for 20% maximum health as fire damage, making a brief mistake
recoverable while repeated contact remains lethal.

## Forge Wave

After a 44-second opening delay, Forge Wave begins a 46-second recharge. Ignivar
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

## Shared Pyre

After a 24-second opening delay and every 34 seconds thereafter, Ignivar marks a
non-tank player with Shared Pyre for six seconds. The target gains a visible
5.5-unit orange gathering circle. The intended group solution uses at least four
living players. On resolution, the circle always splits 120% maximum health across
only the living players inside it; players outside never take Shared Pyre damage.
Fewer participants each receive a larger share, while an immune target can absorb a
solo resolution without harming the raid. If the marked player dies first, the
circle still resolves at their final position. Normal avoids selecting a Brand of
the Pyre carrier when an unbranded non-tank is available.

## Tank swap

Ignivar uses Forge Strike every 14 seconds while its target is in melee range.
The strike deals 35% maximum health as fire damage, then applies one stack of
Molten Armor for 30 seconds. Each stack increases all damage received by 35%,
including the next Forge Strike and Ignivar's melee swings. The intended Normal
response is to swap tanks at two stacks. Conduit water only removes Brand of the
Pyre and never removes Molten Armor.

## Apocalypse add

The first Normal implementation uses one stationary add. It does not attack or
move and immediately begins an uninterruptible Apocalypse cast. Ignivar remains
active, targetable, and dangerous throughout the add window. Completing the cast
wipes the raid. Killing the add cancels it.

## Last Inferno

At 20% health Ignivar enters Last Inferno. His attack speed increases by 20% and
his melee damage increases by 35%. Falling Cinders repeats every nine seconds,
Revolving Inferno repeats every 24 seconds and rotates at 160% of its normal
speed, and a dedicated eight-second sequence alternates Searing Torrent with Rain
of Cinders. Brand, Shared Pyre, Forge Strike, and Forge Wave stop queuing so the
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
Pyre. On Heroic, every Brand persists for the full intermission. The water
conduits remain frozen in their current state on both difficulties. No rotating
rays or other boss mechanics run during the intermission. All three shelters
shatter with heavy fire releases when it ends, then regular mechanics resume
after a short recovery window.

Two simultaneous adds are a Heroic candidate, not a Normal requirement. The party
split and DPS check must be tested with the intended 2-2-6 composition before that
variant is accepted.

## Varkhul, Forgefather of the Last Flame

Varkhul waits in the Inner Crucible beside his grand forge and fights with a
separate one-handed warhammer. The encounter uses existing cast, aura, facing,
and ground-warning contracts wherever possible. Every actionable warning must
retain the same geometry on Low and Ultra graphics and across offline and online
worlds.

### Maker's Brand

Every 14 seconds Varkhul strikes his current melee target for 30% maximum health
and applies Maker's Brand for 30 seconds. The mark stacks to three and increases
damage received from Varkhul by 35% per stack. Tanks swap at two stacks. A taunt
changes the target of the next Brand without transferring or clearing the old
tank's stacks.

### Living Blueprint

Varkhul selects three non-tanks for four seconds. Each target projects a fixed X
of forge lanes. Players still inside any projected lane when the pattern resolves
take 40% maximum health. Selection and lane geometry are deterministic.

### Forgestorm

Forgestorm releases three waves of five deterministic impact circles. Every wave
warns for 2.5 seconds, then deals 30% maximum health inside each four-yard circle.
The active warnings are snapshot state, not event-only decoration, so reconnects
and online clients receive the same remaining time and geometry.

### Anvil's Decree

Varkhul turns toward the grand forge and resolves three strikes two seconds
apart. Every strike deals 10% maximum health raidwide and 35% maximum health in
its four cardinal forge lanes. The cast serializes with other major mechanics so
their safe and dangerous spaces never become ambiguous.

### The Master's Assembly

At 50% health Varkhul shields himself and assembles one automaton of each type.
The Crucible Warden protects the Cinder Artificer, while the Artificer channels a
20-second raid wipe. Killing all three constructs removes Varkhul's protection
and resumes the encounter.

### Masterpiece Unbound

At 20% health non-tank mechanics run 25% faster while the living forge pulses for
5% maximum health every three seconds. Varkhul must die within 45 seconds. Maker's
Brand keeps its 14-second cadence so the tank-swap rhythm does not change during
the final burn.

## Music

Each map has its own authored ambient composition and versioned MP3 stream:

- Forge Approach uses `ignivar_forge_approach`.
- Ignivar's arena uses `ignivar_raid_arena`.
- Inner Crucible uses `ignivar_inner_crucible`.

The three cues share a forge leitmotif but restart independently when the player
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
7. Rain of Cinders movement cones and the four-player Shared Pyre soak. Done for
   Normal. Human group tuning remains.
8. Revolving Inferno and Forge Wave movement patterns. Done for Normal. Manual
   visual validation and human group tuning remain.
9. Judgment of the Forge intermission and the accelerated, alternating Last
   Inferno finale. Done for Normal. Human tuning remains.
10. Forge Approach layout, three guardian roles, ordered gate, and linked-room
    instance lifetime. Done for Normal.
11. Maelin's three-quest lore chain, three records, and Ignivar core reveal.
    Done for the hidden development route.
12. Varkhul's Maker's Brand, Living Blueprint, Forgestorm, Anvil's Decree,
    Master's Assembly, and Masterpiece Unbound. Done for Normal; human tuning and
    final visual proof remain.
13. Three authored ambient themes with per-room routing and versioned streams.
    Done.
14. Tripo model wave for the three automata, Varkhul, his warhammer, and grand
    forge. Concepts and a resumable production recipe are ready; final GLBs and
    in-game previews remain.
15. Heroic rules, shared raid lockout, rewards, Finder, Guide, and launch tuning.
