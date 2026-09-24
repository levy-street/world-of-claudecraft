# Ice Age

Hoarfrost's survival mechanic in the frost Buried Hoard. Giant icicles fall and
stay as pillars; he casts Ice Age; the storm kills everyone who is not behind a
pillar; the pillars shatter.

## Where everything lives

| What | Where |
|---|---|
| Tunables, the clock, pillar placement, the cover test (pure, shared) | `src/sim/rift/hoard_ice_age_core.ts` |
| The authoritative half: casting, damage, the blast, cleanup | `src/sim/rift/hoard_ice_age.ts` |
| Room measurement shared with the bone boss | `src/sim/rift/hoard_room.ts` |
| The look as pure functions of the clock | `src/render/hoard_ice_age_core.ts` |
| The pooled painter | `src/render/hoard_ice_age.ts` |
| Blender source, review renders | `docs/design/ice-age/` |
| Shipping build (prune, dedup, meshopt) | `scripts/assets/ice_age/build.mjs` |
| Shipped asset | `public/vfx/ice-age/pillars.glb` |
| Tests | `tests/hoard_ice_age.test.ts`, `tests/hoard_ice_age_render.test.ts` |

## Rebuild

```
blender --background --python docs/design/ice-age/build_ice_age.py
blender --background --python docs/design/ice-age/preview.py
node scripts/assets/ice_age/build.mjs
```

## One clock

A cast is a carrier cue (`frost-iceage`, at the boss) plus one cue per pillar
(`frost-pillar`), all created in the same tick with the SAME life. Every beat is
a fixed offset into that life (`iceAgeTimeline`): shadows, impact, the cast, the
blast, the break-up, the end. The hoard's rarity shortens only the cast, and that
rides in the cue's life, so the wire carries nothing new and a client that joins
mid-cast recovers every beat from the cue alone. The renderer samples the same
functions, so what is drawn is what is judged.

The carrier is a `sweep`, which holds the boss engine's busy gate: while Ice Age
runs, Hoarfrost's gusts, ice and blizzard do not start. A cast also begins only
into a room with no live cue. Reaching cover is the whole challenge, so nothing
else may sit on it.

## Placement and scaling

`measureHoardRoom` walks the floor's own shell forward from where the boss
stands. `icePillarOffsets` fans the pillars across that width (each guards a
different bearing), staggers them in depth between `pillarMinBossDistance` and
`pillarMaxBossDistance`, keeps them `wallMargin` off the walls, and relaxes any
pair closer than `pillarMinSeparation`. It draws no rng: the cue id seeds it.

`icePillarCount(living, rarityExtra)` is sub-linear on purpose: `pillarCount`,
plus one for each further `playersPerPillar` players, clamped to
`minPillars`..`maxPillars`. A bigger group SHARES cover. The hoard's rarity bonus
cuts the other way here: a rarer hoard offers one pillar fewer (a lone player in a
legendary hoard gets exactly one) and casts faster.

## Cover

`icePillarCovers(origin, pillar, point)` is the only rule. The storm blows
outward from where the boss cast. A pillar shelters a point only when it stands
BETWEEN them: the point is past the pillar along the origin's bearing to it, no
further behind than `coverDistance`, and inside the pillar's shadow across that
bearing (`iceCoverHalfWidth`: the radius times `coverWidthMultiplier`, widening
away from the storm like a real shadow, capped at `coverMaxSpread`). Standing
near a pillar but beside it, or in front of it, is not cover. Several players fit
in one lee.

The lee painted on the floor is `writeLeeStrip`, the same function drawn, and
`tests/hoard_ice_age_render.test.ts` pins that every point just inside its edge
is covered and every point just outside is not. The model stays inside the lee's
own width (pinned against the Blender export), so what reads as cover is cover.

Pillars do not block movement or line of sight for anything else: they are cues,
not colliders.

## The blast, in order

1. The cast completes (`blastAt`).
2. Every living player in the hoard is tested against the pillars still standing.
3. The exposed take `lethalHealthMultiplier` times their maximum health, through
   the ordinary damage path (so an immunity still saves its owner).
4. The storm plays; the pillars take it.
5. `pillarBreakDelaySec` later the pillars break (`breakAt`), and the cues end.

The pillars are cues whose life ends after the blast, so cover cannot vanish
before it is judged. `tests/hoard_ice_age.test.ts` pins the order.

## Blender or runtime

Blender: three pillar variants (`IcePillar_A/B/C`), each a jagged fallen icicle
with fused spires, smaller icicles and a snow mound at its foot, and each
PRE-FRACTURED: the body is a set of closed chunks (`_Chunk_nn`, outer ice plus
deep inner faces) that sit together as the intact pillar, with glowing seams
(`_Cracks`) along every chunk boundary.

Runtime: everything that depends on the moment. The shadow and the accelerating
fall, the landing (jolt, ring, shards, frost), the lee and its outline, the
gathering cast, the floor chill spreading from the boss, the gusts and snow that
run out from him and break off in a standing lee, the pressure wave, the strain
in the seams, and the scripted break-up (`chunkFlight`: a closed-form arc that
lands and fades; no physics). No dynamic light is used.

The arena is snow, so whatever must read on the FLOOR is a saturated blue laid
over it with ordinary blending, never white light added to white.

What a player acts on draws on every graphics tier: the shadow, the icicle and
pillar, the lee and its outline, the wave, the snow, and a reduced set of gusts.
The low tier sheds the dust, the landing and break-up bursts, the mist, the floor
chill and most of the gusts.

## Edge cases

The boss dying, dropping combat or the run ending goes through the boss engine's
`clearState`: every cue is dropped, every client is told to clear, the cast bar is
cleared and the state deleted, so no invisible cover or storm survives. A live
cast is never doubled (the clean-room rule). Dead players are skipped. A player
who leaves the hoard is no longer in its player list.

## Tuning after playtests

- Too hard to reach cover: raise `castSec` (and `minCastSec` for rare hoards)
  before touching the pillars.
- Cover feels unfair at the edges: `coverWidthMultiplier`, then `coverMaxSpread`.
- Groups crowd one pillar: lower `playersPerPillar`, or raise `maxPillars`.
- The icicle lands too hard: `impactDamageFraction` and `impactKnockback`.
- Too frequent: `ICE_AGE_EVERY_SEC` in `hoard_ice_age.ts`.
