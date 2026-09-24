# Hammer of the Forge

Emberforge's arena mechanic in the ember Buried Hoard. A gigantic red-hot hammer
falls on marked ground, several times in a row, and every blow throws an
EXPANDING RING of fire with two doors in it. Players step through a door as the
ring reaches them.

## Where everything lives

| What | Where |
|---|---|
| Tunables, one strike's clock, the ring, its doors, the hit test (pure, shared) | `src/sim/rift/hoard_forge_hammer_core.ts` |
| The authoritative half | `src/sim/rift/hoard_forge_hammer.ts` |
| The look as pure functions | `src/render/hoard_forge_hammer_core.ts` |
| The pooled painter | `src/render/hoard_forge_hammer.ts` |
| Blender source, review renders | `docs/design/forge-hammer/` |
| Shipping build | `scripts/assets/forge_hammer/build.mjs` |
| Shipped asset | `public/vfx/forge-hammer/hammer.glb` |
| Tests | `tests/hoard_forge_hammer.test.ts`, `tests/hoard_forge_hammer_render.test.ts` |

## Rebuild

```
blender --background --python docs/design/forge-hammer/build_forge_hammer.py
blender --background --python docs/design/forge-hammer/preview.py
node scripts/assets/forge_hammer/build.mjs
```

## Timing

A cast is a carrier cue (`ember-hammer`, the beat clock; a sweep, so his frontal
and his fire are held back by the boss engine's busy gate) plus one
`ember-hammer-strike` cue per hammer blow. A strike's cue is made when its
marker appears, under a player's feet AS THEY STAND THEN, and its life is always
`warningSec` + the ring's life, so every beat is recovered from the cue alone:

```
0 ............ warningSec ........................ + ringMaxRadius / ringSpeed
marker, fall   the blow (crush + knock)            the ring spreads and goes out
```

A cast only starts into a room with no live cue of his.

## The ring

`forgeRingRadius(sinceImpact)` spreads at `ringSpeed` from the blow out to
`ringMaxRadius`. It is a RING, never a filled area: `forgeRingBurns` hits a point
only inside the band (`ringThickness` wide), swept from where the band was a tick
ago to where it is now so a thin band can never step over a player, never inside
`ringSafeRadius` (RING_START_RADIUS: the ground under the hammer, which the blow
already judged), and never in a door. Each ring burns a player at most once, and
whoever the blow itself crushed is spared its own ring.

## The doors

`gaps` doors per ring (two), each `gapHalfAngle` to either side of
`forgeGapAngle(cueId, index)`: seeded from the strike's cue id, spread round the
ring so they are never side by side, and different for every blow. The painter
builds its ring with `writeRingMask`, which is the sim's own `forgeBearingInGap`
sampled per column, so the fire is lit exactly where it burns and open exactly
where it is safe (`tests/hoard_forge_hammer_render.test.ts` pins both ways). Each
door is also marked by a short, warm gate (`doorReach` long) that TRAVELS WITH
THE RING and fades out ahead of it, from the first of the MARKER, before any fire
exists: the way through is marked where it matters and the rest of the floor
stays clean. (An earlier version painted pale blue lanes the whole length of the
room; in the forge they read as a hazard of their own.)

Fairness is pinned, not hoped for: `ringSpeed` is under a player's run, and
`tests/hoard_forge_hammer.test.ts` walks every radius and bearing of the ring's
path and asserts a door is reachable on foot before the fire arrives. Doors are
wide; a whole party uses the same one.

## Scaling

- Strikes: `forgeStrikeCount(rarityExtra, living)`: `strikes`, plus the hoard's
  hazard bonus, plus one for every `playersPerExtraStrike` players past the
  first. The dance gets longer with the party, never deadlier.
- Damage goes through `hoardMechanicDamage`, so the hoard's rarity presses it like
  every other boss's mechanics, and the cadence of the cast is pressed by rarity.
- DOUBLE HAMMER: at `HOARD_DOUBLE_MECHANIC_INTENSITY` (legendary with four or
  more, epic with five) a second hammer joins and the two ALTERNATE: a marker
  appears every half beat, never two blows in the same instant. Each strike cue
  carries which hammer it is (`innerRadius`), and the second burns whiter.

## Safe space

- A strike never lands within `minStrikeSpacing` of the one before it, so two
  rings never start from one spot and a hammer never falls into the door a player
  just used.
- Rings from different blows have different, seeded doors and different centres,
  and every ring is slower than a run, so overlapping rings never close every
  route: there is always time to reach the next door.
- The blow is capped non-lethal and so is the ring.

## Blender or runtime

Blender: the hammer, head down the way it falls, its striking face on the origin:
`Hammer_Head`, `Hammer_Face` (molten), `Hammer_Runes` (molten forge marks),
`Hammer_Collar`, `Hammer_Haft`, `Hammer_Pommel`. The head's footprint is inside
the impact radius (pinned against the export).

Runtime: the molten marker and its embers, the accelerating fall, the blow (flash,
ember burst, jolt, camera shake), the hammer drawn back up, the scorch, the ring
(a floor band at the sim's width plus a standing wall of fire, both cut open at
the doors, written every frame so the width never scales with the radius), the
door lanes and the embers the ring throws. No dynamic light is used.

What a player acts on draws on every graphics tier: the marker, the hammer, the
ring, the wall and the doors. The low tier sheds the embers, the wall's flicker
and the scorch.

## Tuning after playtests

- Too hard to thread: widen `gapHalfAngle`, then slow `ringSpeed`.
- Too easy: `gaps` down to one is NOT safe (the reachability test will say so);
  raise `strikes` or shorten `beatSec` instead.
- The blow hits too hard: `impactDamageFraction` and `impactKnockback`.
- Too frequent: `FORGE_HAMMER_EVERY_SEC` in `hoard_forge_hammer.ts`.
