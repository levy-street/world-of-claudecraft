# Tentacles of the Abyss

The Abyssal Maw's arena mechanic in the tide Buried Hoard. Tentacles break the
floor, each a real mob the party can kill, and they STAND UNTIL THEY ARE KILLED:
there is no waiting one out. Each cycles three attacks from where it rose: a LINE
WHIP along a lane, a CIRCULAR SWEEP round itself, and a GRASP that takes hold of
a player. His Crashing Tide keeps coming while they stand.

## Where everything lives

| What | Where |
|---|---|
| Tunables, counts, health, placement, both hitboxes, the escape check (pure, shared) | `src/sim/rift/hoard_tentacles_core.ts` |
| The authoritative half | `src/sim/rift/hoard_tentacles.ts` |
| The grasp, from the reach to the let go | `src/sim/rift/hoard_tentacle_grasp.ts` |
| The mob | `hoard_abyssal_tentacle` in `src/sim/content/rift/mobs.ts` |
| The pose and the floor telegraphs as pure functions | `src/render/hoard_tentacles_core.ts` |
| The pooled, instanced painter | `src/render/hoard_tentacles.ts` |
| The mob's body (the root collar) | `mob_abyssal_tentacle` in `src/render/characters/manifest.ts` |
| Blender source, review renders | `docs/design/tentacles/` |
| Shipping build | `scripts/assets/tentacles/build.mjs` |
| Shipped assets | `public/vfx/tentacles/tentacle.glb` and `public/models/creatures/hoard_tentacle_trunk.glb` |
| Tests | `tests/hoard_tentacles.test.ts`, `tests/hoard_tentacles_render.test.ts` |

## Rebuild

```
blender --background --python docs/design/tentacles/build_tentacles.py
blender --background --python docs/design/tentacles/preview.py
node scripts/assets/tentacles/build.mjs
node scripts/build_media_manifest.mjs generate
```

## How many, how tough

`tentacleCount(living, rarityBonus)`: `ceil(living / playersPerTentacle)` plus
the hoard's rarity bonus (the shared hazard bonus in `hoard_scaling.ts`: common
one fewer, epic and legendary one more), between `minTentacles` and
`maxTentacles`. About one for every two players.

`tentacleHealth(bossMaxHp, count)`: `healthFraction` of the boss's own health,
which is already scaled by party size and rarity, thinned by
`healthPerExtraTentacle` for every further tentacle in the set. The whole set is
always more work than a smaller one (pinned), but never a chore.

Where they rise is `tentacleOffsets`: fanned across the room measured by
`measureHoardRoom`, at mixed depths, off the boss, off the walls, and at least
`minSeparation` apart so two trunks never share melee ground.

## One tentacle's life

Every cue is an ordinary hoard cue. Because a tentacle stands until it is
killed, its cues are the one exception to the boss engine's busy gate
(`hoard_boss.ts`): his waves and his totem carry on while they stand, and the
party chooses what to deal with. A set only RISES into a clean room, never into
the middle of a volley of his waves, and a new set only after the last of the
old one is dead.

```
tide-tentacle        0 ... spawnWarningSec ...... + riseSec
                     warning on the floor   it erupts (hurts and throws whoever
                                            stood there), the mob exists
tide-tentacle-up     the SAME cue id, standing. A HEARTBEAT: a short life
                     (upLifeSec) re-sent every upHeartbeatTicks for as long as it
                     lives, because the online mirror restarts a cue's life on
                     every event and a late joiner must still see it. The painter
                     never replays the rise from it
tide-tentacle-fall   the SAME cue id, retractSec long: killed (halfAngle 1, it
                     thrashes, drops and rots away) or let go by the fight (0)
tide-whip            whipTelegraphSec, then the blow, then the residue
tide-sweep           sweepTelegraphSec, then one full turn, then the settle
tide-grab            a mark that RIDES the player it wants (targetId), for
                     grabTelegraphSec; innerRadius says which tentacle reaches
tide-grab-hold       the SAME cue id once it has them, up to grabHoldSec
```

Killing a tentacle withdraws an attack it had not finished, on every client, at
once. The timer for the next set starts when the last one is gone.

His Healing Tide totem keeps its turn: it is answered before a new set in the
same tick, and no set rises within `HOARD_TOTEM_TENTACLE_MARGIN` above the
totem's threshold while it is still unanswered, so a set that stands for its
whole life can never carry him past it.

## The three attacks

LINE WHIP: `pointInWhip`, a rectangle `whipLength` by twice `whipHalfWidth` out
from the trunk along the aim fixed when the telegraph went down. It rears AWAY
from its target, then lands. A sidestep dodges it.

CIRCULAR SWEEP: `sweepPasses`, an arm turning one full eased turn
(`sweepProgress`) either way round. It is swept (from where the arm was a tick
ago to where it is), so a fast arm never steps over a player, and each player is
caught at most once per sweep. The ground inside `sweepInnerRadius` is never
swept: melee on the trunk has a place to stand, and the mob's collar fits inside
it (pinned against the export). Everyone else leaves the ring.

GRASP (`hoard_tentacle_grasp.ts`): it reaches for the nearest player, a mark
riding them so they know it is THEM. If they are still within `grabRange` when
it closes (`grabReaches`), it holds them `grabHoldDistance` from its trunk, inside
the ground its own sweep never touches, and squeezes every `grabEverySec`. Running
out of its reach makes it close on nothing. Its grip breaks when the tentacle
loses `grabBreakFraction` of its health while holding, or dies; left alone it
tires after `grabHoldSec`, squeezes once more and throws them clear. The hold is a
ROOT, never a stun, so the held player can strike it too and a lone player is
never stuck; `maxGrabbed` never lets them hold the whole party. A held player is
LIFTED: his waves pass beneath them and no other tentacle's lash or sweep touches
them, so being held is never a second, unavoidable hit. Its squeeze alone never
kills: it stops at a sliver.

Which one a tentacle makes cycles (`tentacleAttackKind`), neighbours out of step;
it takes the first of its cycle that has someone to hit and is not already being
made by another.

## Pressure and safe space

Below `HOARD_DOUBLE_MECHANIC_INTENSITY` only ONE telegraph is ever down at a
time, whatever the number of tentacles (a grasp under way counts as one). At it
(legendary with four or more, epic with five), two may be down together: never
two of the same kind, the second at least `doubleStaggerSec` after the first.

Every new telegraph must pass `hasEscape` for every living player, with every
live telegraph counted at its WHOLE danger area: there is open ground within
`escapeReach`. If not, it waits `retrySec` and tries again. Overlaps get more
complex, never unavoidable.

Damage goes through `hoardMechanicDamage` and is never a one-shot from full
health (`capRiftNonLethalMechanicDamage`); rarity's
speed presses the time between a tentacle's attacks, its cadence the time
between sets.

## Blender or runtime

Blender: ONE segment (`Tentacle_Seg`, unit radius and length, belly and glowing
suckers on one side, a ridge on the back), the hooked tip (`Tentacle_Tip`), the
heaved flagstones (`Tentacle_Rubble`), the black pool (`Tentacle_Pool`), and the
mob's root collar (`Trunk_Collar`).

Runtime: everything that moves. A tentacle is that one segment instanced along a
chain whose every link has a pitch and a heading (`writeTentacleChain`); each
pose is a pitch profile and poses blend, so the rise, the sway, the rear, the
lash, the low turning sweep (its end trailing the arm), the death throes and the
withdrawal are all code. The whole set shares the same few instanced draws. The
suckers turn from teal to red as it winds up. The floor telegraphs are the sim's
own shapes: the lane is `pointInWhip`'s rectangle, the ring and the arm are
`sweepPasses`'s (pinned both ways). No dynamic light is used.

What a player acts on draws on every graphics tier: the warning, the tentacle,
the lane, the ring and the arm. The low tier sheds the spray, the pool and the
sweep's wake. Reduced motion holds the sway, the tremble and the thrash still.

## Tuning after playtests

- Too much to kill: `healthFraction`, then `healthPerExtraTentacle`.
- Too many: `playersPerTentacle` up, or `maxTentacles` down.
- The lash is too hard to dodge: `whipTelegraphSec` up or `whipHalfWidth` down.
- The sweep is too hard to leave: `sweepTelegraphSec` up or `sweepRadius` down
  (the painter follows; the reach pin in the render test will ask for the low
  pose's stretch to follow too).
- The grasp is too easy or too hard to escape: `grabTelegraphSec`, `grabRange`.
- Too long held: `grabBreakFraction` down, or `grabHoldSec` down.
- Too relentless: `attackIntervalSec`; too frequent: `TENTACLES_EVERY_SEC`.
