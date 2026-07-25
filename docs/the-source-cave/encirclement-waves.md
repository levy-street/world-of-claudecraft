# Encirclement encounter and centre seal

The encounter contract: what the fight does and why it is shaped this way. It supersedes
the manual-pull model, whose room and object design survives in
[friendly-reboot.md](friendly-reboot.md).

Wave sizes, delays, and tier stats are owned by `src/sim/source_cave/encounter.ts` and
`tier_profiles.ts`. The tables below describe the shape of the encounter at the current
roster; re-derive the numbers from those two files, and re-measure the balance matrix with
the probe, rather than trusting this page after a retune.

## Player experience

The contributors still begin friendly and occupy deterministic rings around the raid. The
centre of the room is now a distinct ten-unit stone seal. Before reboot, its blue engraved
circuits brighten in direct proportion to the living players standing on it. Zero players
leaves the seal neutral, half the raid produces half charge, and the full raid produces the
complete blue pattern. This is the primary, diegetic indication that the group should gather.

If everyone is on the seal, the reboot button starts the encounter immediately. If at least
one living player in the cave is outside, the first press shows only this roleplay warning:

`Are you sure you want to proceed? Ensure you gather your resources before you push.`

The same player may press again within ten seconds to proceed. This is not a safety lock. A
forced start with an outlier produces the intended catastrophic consequence.

At reboot, every contributor becomes visibly hostile and the exit is sealed. Overflow
contributors hold the same encircling line but do not add damage to the paced waves unless a
player deliberately targets one. That guardian then enters the arena, joins the current pull,
survives its scheduled retirement, and becomes an extra clear requirement. The seal turns a very dark red while every
living player remains inside. A player crossing its boundary
irreversibly turns it vivid red and wakes every remaining contributor. The remaining overflow
then joins the breach clear requirement. The HUD shows integer completion percentage rather
than a raw defeated/total fraction, so the fixed combat budget never appears to contradict the
larger visible roster. There is no explicit
failure message. The enemies and floor communicate the state. The seal becomes neutral again
when all required opponents are gone or when a wiped instance resets.

## Deterministic waves

The current 37-person roster is divided weak to strong:

| Wave | Cohort | Size | Delay |
|------|--------|------|-------|
| 1 | Tinkerers, ranks 28 to 37 | 10 | 3 seconds after reboot |
| 2 | Tinkerers, ranks 22 to 27 | 6 | 2 seconds after wave 1 dies |
| 3 | Artificers, ranks 14 to 21 | 8 | 2 seconds after wave 2 dies |
| 4 | Runesmiths, ranks 8 to 13 | 6 | 2 seconds after wave 3 dies |
| 5 | Architects, ranks 5 to 7 | 3 | 2 seconds after wave 4 dies |
| 6 | Architects ranks 3 to 4 plus rank 2 Worldwright | 3 | 2 seconds after wave 5 dies |
| 7 | Rank 1 Worldwright boss | 1 | 5 seconds after wave 6 dies |

At 37 or more visible contributors, the builder assigns exactly 36 non-boss combat roles plus
the rank 1 boss: 16 Tinkerers, 8 Artificers, 6 Runesmiths, 5 Architects, and 1 non-boss
Worldwright. A seeded selection rotates overflow identities, then rank orders the selected
identities into those fixed roles. The displayed login, rank, merged-PR count, body, color,
and held weapon stay derived from real prestige; scale, cadence, HP, damage, affixes, and wave membership
come from the fixed combat role. Therefore promotions
through 30 or 70 PR cannot increase or decrease total attrition. The same seed and roster are
order independent. Below 37 contributors, everyone fights with their natural contribution tier
so a small roster is not artificially promoted. The separate 60-person visible-roster cap is
unchanged. Every unselected contributor is assigned deterministically to one of the seven waves.
When that wave dies, its assigned overflow guardians disappear as if they had fought in it, so
the encircling roster thins throughout the encounter and nobody remains after the boss.

Every dormant contributor remains hostile and visible in the encircling ring. The intact seal
suppresses only automatic acquisition against players gathered on it. Striking a dormant
combatant wakes that combatant's whole cohort. Leaving the seal wakes every combat cohort and
every overflow guardian still present; after a breach, all of them must die before the clear.
Overflow guardians never count toward normal kill progress. An activated mob that evades is reassigned to a living player so a wave cannot
quietly stall.

The layout does not require a role-based formation change before pressing the button. All ten
players should fit inside the ten-unit seal. Once a wave reaches the centre, normal tank,
healer, melee, and ranged spacing applies within that boundary. The two-second intermissions
are recovery and reposition windows. The five-second boss pause is the deliberate final
preparation beat.

## Balance matrix

The deterministic raid probe now runs four full 10-player profiles across 20 fixed seeds by
default. The runner refuses unsafe AoE casts that would touch a dormant cohort, and it still
rejects any early wake as a harness failure. At the current tuning:

| Profile | Valid clears | Invalid pacing runs | Median clear | P90 deaths | P10 minimum healer mana |
|---------|--------------|---------------------|--------------|------------|-------------------------|
| AoE mixed | 20/20 | 0/20 | 172.75 seconds | 4 | 0% |
| Single-target mixed | 20/20 | 0/20 | 243.0 seconds | 3 | 0% |
| Single-target melee | 20/20 | 0/20 | 243.7 seconds | 1 | 0% |
| Single-target hunters, controlled pets | 20/20 | 0/20 | 159.2 seconds | 0 | 0% |

All 80 runs preserve the intended pacing. Invalid runs remain separately reported and excluded
from clear-rate statistics. Median clear time is computed from clears only; wipe and timeout
durations cannot distort that value.

## Reset and exit rules

- The exit portal is inert from reboot until the clear.
- When every player in the instance is dead, a five-second wipe timer starts.
- A wipe restores every contributor at full health, friendly and at its home ring.
- Contributor corpses carry no loot and disappear 10 seconds after death.
- The reboot button and exit are rearmed by the reset.
- Party membership changes cannot bypass the exit seal because ownership is resolved from the
  player's physical cave copy.

## Visual implementation

The centre seal is render-only and consumes the authoritative `SourceCaveInfo` projection. It
uses three layers: a procedurally generated radial-cut stone albedo and normal map on the shared
PBR material path, a raised metallic perimeter ring that receives shadows, and an animated
transparent shader for etched circuits, nodes, inward or outward flow, and HDR energy. High
quality tiers gain the existing scene lighting, shadowing, SSAO, tone mapping, and bloom. Low
quality uses the same geometry and core state signal through the Lambert fallback, without
removing the gameplay cue.

The animation has both color and motion language:

- idle charge: blue, gradually filled, slow inward flow;
- active containment: dark red, slow inward flow;
- breached containment: vivid red, fast outward flow and heartbeat;
- clear or reset: unlit neutral stone and engravings.

## Code and coverage

The sim state machine lives in `src/sim/source_cave/encounter.ts`; shared spatial rules live in
`occupancy.ts`; the IWorld projection is extended in `wire.ts`; and the render split is
`source_cave_seal_state.ts` plus `source_cave_seal.ts`. The offline/headless placeholder roster
matches the current 37-entry GitHub leaderboard exactly.

Focused coverage includes deterministic wave construction, muster confirmation, forced breach,
direct cohort pulls, exit sealing, wipe reset, gradual IWorld occupancy, client wire parity, and
pure seal visual-state mapping.

`scripts/source_cave_reboot_e2e.mjs` drives the real offline client through all three seal
modes, the three-layer seal material, the opening wave, a cohort wake, a full breach wake,
the lighting change, the reboot, the chest, and its loot. One known false alarm: its
no-console-error check reports pre-existing Three.js `BufferGeometryUtils` warnings about
inconsistent UV attribute array types raised while the dungeon asset pack is merged. That
merge path is not used by the seal, which renders correctly.
