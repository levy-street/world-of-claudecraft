# Rolling Boulder

Warlord Grask's arena mechanic in the brute Buried Hoard. He marks a player, who
cannot move, and rolls a boulder at them. If enough allies STAND WITH the marked
player when it arrives, it is thrown back and staggers him. If not, it crushes
them. A lone player has nobody to stand with, so alone it is a lane to get out of.

## Where everything lives

| What | Where |
|---|---|
| Tunables, who must stand, how many boulders, the roll, the hit tests (pure, shared) | `src/sim/rift/hoard_boulder_core.ts` |
| The authoritative half | `src/sim/rift/hoard_boulder.ts` |
| The look as pure functions | `src/render/hoard_boulder_core.ts` |
| The pooled painter | `src/render/hoard_boulder.ts` |
| Blender source, review renders | `docs/design/boulder/` |
| Shipping build | `scripts/assets/boulder/build.mjs` |
| Shipped asset | `public/vfx/boulder/boulder.glb` |
| Tests | `tests/hoard_boulder.test.ts`, `tests/hoard_boulder_render.test.ts` |

## Rebuild

```
blender --background --python docs/design/boulder/build_boulder.py
blender --background --python docs/design/boulder/preview.py
node scripts/assets/boulder/build.mjs
node scripts/build_media_manifest.mjs generate
```

## Who must stand with the mark

`supportersNeeded(living)`: nobody of one, one of two, two of three to five,
three of a bigger party. Never more than everyone else (pinned).

The marked player is held by `Rooted in Dread`, a real root no player counter
sheds, from the mark until the boulder is answered one way or the other (and
cleared if the fight resets). Standing counts inside `supportRadius` of them
(`standsWith`), judged on the tick the boulder arrives; the mark never counts
for themselves, the dead never count.

## One cast

```
brute-boulder-throw   the carrier, at Grask: where every boulder starts. A
                      SWEEP, so the boss engine's busy gate holds his combo
brute-boulder         one per boulder (ids carrier + 1, carrier + 2), at the
                      mark: warningSec hefted over his head (a cast bar on his
                      frame, his feet planted), then the roll
brute-boulder-return  the SAME id, thrown back: from the party to him. On
                      arrival he is Staggered (bossStunSec) and loses
                      reflectDamageFraction of his health; his combo waits
brute-boulder-crush   the SAME id, broken (innerRadius 1 if it hit someone)
```

The roll is `boulderProgress`: it gathers pace, and it is never in flight for
less than `minTravelSec`, so a mark at his feet still gives the party time.
`boulderAnswerRange` is the fairness number: an ally clear across a hoard room
reaches the ring before the boulder does (pinned, at legendary speed too).

Too few: the mark takes `crushDamageFraction` and is `Crushed` (stunned) for
`crushStunSec`. A ROOTED mark could do nothing about it, so the boulder alone
never kills them: it stops at a sliver. Nobody else is hurt.

Thrown back, the damage is credited to whoever was marked and is worth no
threat, so answering the mechanic never turns him on a healer; his combo waits
exactly as long as his `Staggered` stun lasts.

ALONE (`needed` 0): nobody is rooted. The boulder runs a lane from him through
where the player stood and `soloOvershoot` beyond, so backing away along it is no
escape; `boulderRunsOver` is swept, so a fast boulder never steps over anyone.

## Scaling and the double boulder

Damage goes through `hoardMechanicDamage`; rarity's speed presses the roll (never
below `minTravelSec`), its cadence the time between casts.

At `HOARD_DOUBLE_MECHANIC_INTENSITY` with four or more living, `boulderPlan`
throws TWO, the second `doubleStaggerSec` after the first, at two different
players. The marked cannot help each other, so the free players are split: each
boulder asks for no more than its share, and never fewer than one. Both are
always answerable at once (pinned for every party size). Who is marked rotates
from cast to cast.

## Blender or runtime

Blender: the rock (`Boulder_Rock`, never wider than the hitbox, pinned against
the export), two crude iron bands sunk into it (`Boulder_Bands`), glowing
fissures set radially so they always lie on the surface (`Boulder_Cracks`), and
nine `Boulder_Shard_NN` pieces it breaks into.

Runtime: the heft, the throw down, the roll (it turns exactly as far as it has
travelled) and its skips, the shadow, the dust, the throw back, the break (each
piece thrown from where it sat), the GREEN ring and its pips (one per ally it
asks for, lit as they arrive, counted from the world the same way the sim
counts), and the lone player's lane. The ring is a place to stand, never a place
to leave, so it is never red. No dynamic light is used.

What a player acts on draws on every graphics tier: the boulder, the ring, its
pips and the lane. The low tier sheds the dust, and nothing else (the shadow says where an airborne boulder is).

## Tuning after playtests

- Parties do not make it in time: `warningSec` up, then `rollSpeed` down.
- Too easy to answer: `supportRadius` down (the painter follows).
- The fail hurts too much or too little: `crushDamageFraction`, `crushStunSec`.
- The reward is too big or too small: `bossStunSec`, `reflectDamageFraction`.
- Too frequent: `BOULDER_EVERY_SEC` in `hoard_boulder.ts`.
