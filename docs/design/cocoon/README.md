# Cocoon

Broodmother Vysska's arena mechanic in the brood Buried Hoard. She wraps a player
in silk: they are helpless, she feeds on them, and only their ALLIES can cut them
out, because the cocoon is a real mob to kill. A lone player has nobody to cut
them out, so alone she spins a BROOD cocoon instead: kill it before it hatches.

## Where everything lives

| What | Where |
|---|---|
| Tunables, how many she may wrap, cocoon health, the rescue clock (pure, shared) | `src/sim/rift/hoard_cocoon_core.ts` |
| The authoritative half | `src/sim/rift/hoard_cocoon.ts` |
| The mobs | `hoard_silk_cocoon`, `hoard_brood_cocoon` in `src/sim/content/rift/mobs.ts` |
| The look as pure functions | `src/render/hoard_cocoon_core.ts` |
| The pooled painter | `src/render/hoard_cocoon.ts` |
| The cocoons' bodies | `mob_silk_cocoon`, `mob_brood_cocoon` in `src/render/characters/manifest.ts` |
| Blender source, review renders | `docs/design/cocoon/` |
| Shipping build | `scripts/assets/cocoon/build.mjs` |
| Shipped assets | `public/models/creatures/hoard_{silk,brood}_cocoon.glb` |
| Tests | `tests/hoard_cocoon.test.ts`, `tests/hoard_cocoon_render.test.ts` |

## Rebuild

```
blender --background --python docs/design/cocoon/build_cocoon.py
blender --background --python docs/design/cocoon/preview.py
node scripts/assets/cocoon/build.mjs
node scripts/build_media_manifest.mjs generate
```

## Never the whole party

`cocoonCount(living, double)`: none alone (the brood cocoon instead); otherwise
ONE, held to `maxShare` of the party (MAX_COCOON_PERCENT_OF_GROUP) and always
leaving `minFreePlayers` (MIN_FREE_PLAYERS). At
`HOARD_DOUBLE_MECHANIC_INTENSITY` it may be TWO, on the double's own terms
(`doubleMaxShare`, `doubleMinFreePlayers`): a double always leaves at least as
many free as it wraps, and a party too small for it gets one. Pinned for every
party size.

She never wraps her own target while anyone else will do (the fight keeps its
tank), and whom she wraps rotates from cast to cast.

## One cocoon's life

```
brood-cocoon       0 ... warningSec ............... + drainSec (or hatchSec)
                   the web mark rides the   the silk closes WHERE THEY ARE: the mob
                   player                   exists, they are Cocooned (a stun no
                                            player counter sheds), she feeds
brood-cocoon-end   the SAME cue id, endSec long: innerRadius 0 cut open in time,
                   1 she fed (or it hatched)
```

The cue is a WARNING mark for its whole life, so the boss engine's busy gate
holds her venom back while anyone is wrapped. She only spins into a clean room.

While they are wrapped she drinks every `drainEverySec` for
`drainDamageFraction`, and heals `drainHealShare` of what she takes. Her feeding
never kills by itself: it stops at a sliver. Not cut out by the end of
`drainSec`, she drinks deep (`devourDamageFraction`, the same floor), heals at
least `devourHealFraction` of her own health, and drops them. The cost of a slow
rescue is her healing and a player one stray hit from dead, never a death the
wrapped player could do nothing about.

Killing the cocoon frees them on that tick. If the fight resets, nobody stays
wrapped and no cocoon stays in the world.

`cocoonHealth(bossMaxHp, freePlayers)`: `healthFraction` of the boss's own
health (already scaled by party size and rarity) per free player, within bounds:
more hands, a tougher cocoon, about the same time to cut.

## Alone

The brood cocoon is spun `broodDistance` from the player, toward her. Nobody is
wrapped. Left for `hatchSec` it hatches `broodHatchlings(rarityBonus)` of her
hatchlings; destroyed in time, nothing hatches.

## Blender or runtime

Blender: the two cocoons, each the whole body of its mob. The silk cocoon is
tall (it is drawn round a standing player and clears them, pinned) with wound
bands and anchor threads; the brood cocoon is squat, with glowing eggs pressing
through the sac.

Runtime: the web mark closing on the player through the warning, the strand the
cocoon hangs by, the RESCUE RING (an arc that empties on exactly the sim's clock,
`cocoonUrgency`, and turns from calm green to red), her feeding line running from
the cocoon to her, and the end (clean silk when cut open, red when she fed). No
dynamic light is used.

What a player acts on draws on every graphics tier: the web mark, the strand and
the rescue ring (and the cocoon itself is an ordinary mob). The low tier sheds
her feeding line and the silk shreds.

## Tuning after playtests

- Rescues are too tight: `drainSec` up, or `healthFraction` down.
- A slow rescue costs too little: `drainHealShare`, `devourHealFraction`.
- It hurts too much: `drainDamageFraction`, `devourDamageFraction`.
- Alone is too easy or too hard: `broodHealthFraction`, `hatchSec`, `hatchlings`.
- Too frequent: `COCOON_EVERY_SEC` in `hoard_cocoon.ts`.
