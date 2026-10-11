# Twin Pulsars

Archon Nyxaris's signature in the arcane Buried Hoard. He always wears blue orbs
above his shoulders (a third over his head in a legendary hoard). Now and then he
unbinds them: he cannot be harmed, the orbs become attackable, each hunts a
player with a chasing beam, and the ward falls when the last orb dies.

The name is ours. A pulsar is a spinning star that sweeps a beam, which is what
these do; the look (a small star caged in broken armour, with two polar jets) is
original. See `docs/design/naming-audit.md` for the name checks.

## Where everything lives

| What | Where |
|---|---|
| Tunables, anchors, stations, targeting, the chase, the hit test (pure, shared) | `src/sim/rift/hoard_pulsars_core.ts` |
| The authoritative half | `src/sim/rift/hoard_pulsars.ts` |
| The orb as a mob | `hoard_bound_pulsar` in `src/sim/content/rift/mobs.ts` |
| The mob's body (the nucleus alone) | `mob_bound_pulsar` in `src/render/characters/manifest.ts` |
| The look as pure functions | `src/render/hoard_pulsars_core.ts` |
| The pooled painter | `src/render/hoard_pulsars.ts` |
| Blender source, review renders | `docs/design/pulsars/` |
| Shipping build | `scripts/assets/pulsars/build.mjs` |
| Shipped assets | `public/vfx/pulsars/{orb,core}.glb` |
| Tests | `tests/hoard_pulsars.test.ts`, `tests/hoard_pulsars_render.test.ts` |

## Rebuild

```
blender --background --python docs/design/pulsars/build_pulsars.py
blender --background --python docs/design/pulsars/preview.py
node scripts/assets/pulsars/build.mjs
```

## States

| State | What it is | How a client knows |
|---|---|---|
| Dormant | scenery riding the boss; cannot be hit | boss aura `Bound Pulsars`, stacks = how many |
| Activating | `activationCastSec`: they light, leave him, take station | an `arcane-pulsar` cue younger than the cast |
| Active | real mobs with health; he is immune | the cue, the `hoard_bound_pulsar` mobs, boss aura `Pulsar Ward` |
| Destroyed | the orb's cues are withdrawn the tick it dies | the cue is gone: the painter plays the death where it stood |
| Recovering | `orbRespawnDelaySec` with no orbs | no aura, no cue |
| Reforming | the aura returns; the painter closes the plates round new light | the aura reappears |

Dormant orbs are an AURA, never entities, so they can never take a stray hit.
`ensureHoardPulsars` runs before the boss engine's engaged check, so he wears
them in and out of combat.

## Attachment

`pulsarAnchor(index, scale)` gives each orb's place in the BOSS'S OWN FRAME
(right, up, forward) in units of his scale, because a hoard boss is a giant and
hoards resize him. The painter turns that into the world with
`bossLocalToWorld` every frame from the boss entity's position and facing
(glided between sim steps), and adds only the hover on top. Nothing is a world
position copied from somewhere.

Activated, an orb leaves for `pulsarStation`: to his left and right, a little
forward of square so it never backs into the wall he stands against, and the
third out in front of him. Dormant and station together form the legendary
triangle.

## Immunity

`boss.damageImmune`, the same flag the Varkhul encounter uses: damage resolves as
nothing (`src/sim/combat/damage.ts`), never as a huge health pool. It is set when
the activation completes and cleared the tick the last orb dies, at the deadline,
and on every reset path (`clearHoardPulsars`). He is pinned where he cast and
holds his swings for the phase; his Voidfall and Event Horizon are held back by
the boss engine's busy gate (the phase's carrier cue is a sweep), and a phase only
starts into a room with no live cue of his.

Known cost of the shared flag: an immune target returns before threat is built,
so nobody gains threat on him for the phase (he holds his swings, so it only
matters at the instant the ward drops). Worth a look in a group playtest.

His cast bar, `Pulsar Overload`, is the DEADLINE: `maxPhaseSec`. If the orbs are
still alive when it completes they burst over everyone (survivable) and the ward
falls anyway, so the fight can never deadlock.

## The beam

1. **Targeting.** `assignPulsarTargets`: different players while there are
   enough; with fewer players than orbs the rest double up. Who is first rotates
   from cast to cast. A dead or departed target is replaced on the next tick.
2. **One live beam per player.** Orbs that hunt the SAME player take turns of
   `beamShareSec`; the rest hold their harmless line on them. A lone player still
   faces every orb, one beam at a time.
3. **Warning.** `targetWarningSec` of thin line locked on the target (the client
   draws it to the target entity itself). Nobody is ever hit by an unexplained
   beam.
4. **Fire.** The beam lands `beamStartLag` yards SHORT of the target, toward the
   orb, so the first instant of fire is never a hit.
5. **Chase.** `stepBeamAim`: the aim point runs at `beamTrackSpeed` (under a
   player's run; rarity quickens it, capped at `beamTrackSpeedCap`) along its
   heading, and the heading swings toward the target by at most `beamTurnSpeed` a
   second. It can be outrun and out-turned, never out-waited: it lands ON a target
   who stands still.
6. **Hitbox.** `pointInPulsarBeam`: within `beamWidth` of the segment from the
   orb's station to the aim point. The drawn core is that segment at that width.
   It ENDS at the aim point. Crossing another orb's beam is a hit: the beams are
   arms swinging from the orbs, and the way to live is to keep them behind you.
7. **Damage.** `beamDamageFraction` of the victim's health, at most once per
   `beamDamageTickSec` per beam per player, pressed by the hoard's rarity like
   every other mechanic. Clipped once is survivable; standing in it is not.

The beam's cue is a HEARTBEAT: re-sent every `beamHeartbeatTicks` with a life of
`beamHeartbeatLifeSec`, because the online mirror restarts a cue's life on every
event. A client follows the aim point from those, gliding between them, and a
beam whose orb died simply stops arriving (it is also withdrawn explicitly the
same tick). A beam or lock cue's id is always its orb's cue id plus one, so the
painter pairs them with no new wire field.

## Blender or runtime

Blender: the orb, every moving part its own node: `Core` (`CoreEnergy`,
`CoreJets`), `Shell` (`Fragment_01..04`), `Details` (`EnergyRing_A/B`,
`RuneFragments`), `VFXGeometry` (`ArcSegments`, `BeamEmitter`). A second, tiny
export is the nucleus alone: the body the attackable mob wears, so targeting, the
nameplate and the health bar are the game's ordinary ones.

Runtime: the hover and the turn of every part, the activation (the brief's own
beats: spin, brighten, arcs, link, leave, pulse), the links that flow INTO the
boss, the ward ring at his feet and its collapse, the targeting line, the beam
(three layers, running pulse bands, a floor mark, sparks, a fading trail), the
four health looks (`orbStrain`: steady, restless, cracked, critical), the death
(collapse inward, burst, a nova ring, plates thrown) and the reforming. No dynamic
light is used.

What a player acts on draws on every graphics tier: the orbs, the targeting
line, the beam and its floor mark, the links and the ward. The low tier sheds the
trail, the sparks, the arcs, the runes and the beam's pulse bands.

## Tuning after playtests

- Orbs die too slowly or too fast: `orbHealthFraction`.
- The beam is unfair: lower `beamTrackSpeed`, then `beamTurnSpeed`; raise
  `beamStartLag` or `targetWarningSec`.
- The beam is ignorable: raise `beamDamageFraction` before its speed.
- Solo is too hard or too easy: `beamShareSec` (longer turns are harder) and
  `maxPhaseSec`.
- Too frequent: `PULSARS_EVERY_SEC` in `hoard_pulsars.ts`.
