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
centre of the room is now a distinct ten-unit stone seal. Before reboot, its terminal-green
engraved circuits brighten in direct proportion to the living players standing on it. Zero
players leaves the seal neutral, half the raid produces half charge, and the full raid
produces the complete pattern. This is the primary, diegetic indication that the group should
gather. The green is the room's own server-rack colour rather than generic arcane blue: the
disc reads as a console the raid is powering up by standing on it.

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

The 42 combat roles are divided weak to strong:

| Wave | Cohort | Size | Delay |
|------|--------|------|-------|
| 1 | Tinkerers, ranks 33 to 42 | 10 | 3 seconds after reboot |
| 2 | Tinkerers, ranks 25 to 32 | 8 | 2 seconds after wave 1 dies |
| 3 | Artificers, ranks 17 to 24 | 8 | 2 seconds after wave 2 dies |
| 4 | Runesmiths, ranks 11 to 16 | 6 | 2 seconds after wave 3 dies |
| 5 | Architects, ranks 8 to 10 | 3 | 2 seconds after wave 4 dies |
| 6 | Architects, ranks 5 to 7 | 3 | 2 seconds after wave 5 dies |
| 7 | Architects ranks 3 to 4 plus rank 2 Worldwright | 3 | 2 seconds after wave 6 dies |
| 8 | Rank 1 Worldwright boss | 1 | 5 seconds after wave 7 dies |

At 42 or more visible contributors, the builder assigns exactly 41 non-boss combat roles plus
the rank 1 boss: 18 Tinkerers, 8 Artificers, 6 Runesmiths, 8 Architects, and 1 non-boss
Worldwright. Every cap is a whole number of waves at that tier's wave size, so the budget
grows by adding a wave of an already-calibrated kind, never by widening one: three architects
is the measured ceiling for simultaneous cleavers, so a bigger encounter gets a third
architect WAVE. Contribution rank alone fills the roles, strongest role first, so the wave table above
reads directly as leaderboard position and only ranks 43 and below overflow into guardian duty.
Nothing in the selection draws rng: the same contributor holds the same standing on every host,
seed, and reboot. The displayed login, rank, merged-PR count, body, color,
and held weapon stay derived from real prestige; scale, cadence, HP, damage, affixes, and wave membership
come from the fixed combat role. Therefore promotions
through 30 or 70 PR cannot increase or decrease total attrition. Below 42 contributors, everyone
fights with their natural contribution tier
so a small roster is not artificially promoted. The separate 60-person visible-roster cap is
unchanged. Every unselected contributor is assigned deterministically to one of the eight waves,
weakest first, so the earliest waves retire the smallest contributions.
When that wave dies, its assigned overflow guardians disappear as if they had fought in it, so
the encircling roster thins throughout the encounter and nobody remains after the boss.

Rank ordering is load bearing, not a simplification. An earlier build bucketed candidates by
their own merged-PR rung and shuffled any rung that overflowed its cap, so with five 70+
contributors against one non-boss Worldwright role, three of the project's heaviest
contributors were cut to guardian duty and deleted from the room wave by wave while one-PR
newcomers fought. Whoever the encounter erases must always be the tail of the leaderboard.

One consequence of the split is deliberate and visible: past the budget, a contributor's body
and held weapon can disagree with what it does in combat. The five 70+ contributors all wear
the golden Worldwright rig, but ranks 3 to 10 fight as Architects, so they cleave without a
visible Commit Blade, and rank 8 carries the Architect blade while swinging at Runesmith
cadence. Prestige wins the model; the combat role wins the numbers. Push this far enough (say
42 contributors all past 70 PR) and the encounter stays exactly as balanced, while the room
stops reading: forty-two identical golden bodies, sixteen of them level-19 trash.

## The nameplate reads the phase, not the model

The room resolves that tension on the nameplates instead of on the models, by separating the
two facts in TIME rather than crowding them into the same plate
(`src/render/source_cave_nameplate_core.ts`).

| Contributor state | Name | Rung title | Level badge | Diamond | Bar frame |
|---|---|---|---|---|---|
| Friendly, before the reboot | yes | yes | no | no | no |
| Hostile combatant | yes | no | yes | tinted by combat role | gold / red |
| Hostile overflow guardian | yes | no | yes | no | no |

Before the press the contributors cannot be engaged, so the plate honours the PERSON: the
display name over the contribution rung their own merged PRs earned, with no combat furniture
at all. The press turns the entire visible roster hostile in one tick, dormant cohorts and
overflow guardians included, and every plate switches to threat assessment together. The room
changes character on the button, which is the beat the encounter is built around.

In the hostile phase the elite diamond is tinted by COMBAT ROLE (bronze Runesmith, silver
Architect, gold Worldwright), because three identical gold diamonds is exactly what a raid
cannot act on. Overflow guardians stay plain, with no diamond and no frame: they are not part
of the clear, and splashing one is otherwise punished with no warning at all, so "this one is
not in the fight" is information the raid is allowed to have.

The tint is combat information, so it is never gated behind a graphics preset or a cosmetic
toggle (`docs/design/graphics-settings-fairness.md`). The phase signal is the mob's own
`hostile` flag, which already crosses the wire, so a wipe reset restores the tribute plates
with no extra bookkeeping. The mouseover tooltip is deliberately unchanged.

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
rejects any early wake as a harness failure. Measured over the current roster:

| Profile | Valid clears | Invalid pacing runs | Median clear | P90 deaths | P10 minimum healer mana |
|---------|--------------|---------------------|--------------|------------|-------------------------|
| AoE mixed | 19/19 | 1/20 | 209.4 seconds | 1 | 0% |
| Single-target mixed | 20/20 | 0/20 | 231.5 seconds | 1 | 0% |
| Single-target melee | 20/20 | 0/20 | 240.2 seconds | 0 | 0% |
| Single-target hunters, controlled pets | 20/20 | 0/20 | 225.8 seconds | 1 | 0% |

Invalid runs remain separately reported and excluded from clear-rate statistics. Median clear
time is computed from clears only; wipe and timeout durations cannot distort that value.

### How this matrix was reached

Four measured steps, each on the full 80-run matrix, because the encounter had silently
drifted off its design point and the cause had to be attributed before anything was retuned.

1. **Rank-ordered selection is balance neutral**, and the matrix confirmed it: measured against
   the previous seeded-rotation build on the same roster, every median moved by about one
   percent (138.0 / 156.6 / 154.6 / 162.8 against 137.9 / 157.1 / 154.0 / 164.4). Selection can
   only decide WHICH contributor fills a role, never how many roles exist or what they cost.
2. **The drift was gear, not roster.** Those numbers sit far under the 172.75 / 243.0 / 243.7
   seconds this page carried at ship time, and the gap reproduces exactly on a build with the
   old roster AND the old selection. It dates from the raid loot that landed after the original
   matrix was recorded, which quietly halved the fight.
3. **The budget went to 42 roles, then the hp multipliers absorbed the rest.** Widening the
   budget recovered 155.5 / 177.7 / 177.5 / 190.4 on its own. Scaling every rung's hpMult by
   the same 1.41 (`tier_profiles.ts`) closed the remainder, restoring total combat HP from
   48131 to 78344.

4. **Lethality came last, from the elite rungs only.** Scaling hp restored fight LENGTH (the
   single-target melee median landed within two seconds of its original) but left p90 deaths at
   0 to 1 against an original 4 / 3 / 1 / 0. Raising dmgMult by 1.2 on runesmith, architect and
   worldwright (and the boss through its rung) moved p90 deaths to 1 / 1 / 0 / 1 while every
   profile held 20 out of 20 clears and the medians barely moved. The swarm rungs were left
   alone deliberately: ten tinkerers already sum to about 216 raw dps against a triage band of
   roughly 230, whereas three architects sum to about 148, so the headroom was on the elite side.

The retune stops there on purpose. p90 deaths remain under the original 4 / 3 / 1, and closing
that last gap numerically would take a much larger damage pass. The probe is a SCRIPTED raid
playing near-perfectly, so it understates what a real group loses; the original 3-to-4-death
figure was also measured against weaker gear, which makes a perfect-play raid losing one player
at p90 the harder encounter of the two in practice. If the fight ever needs more bite, the next
lever is mechanics (the affix pass), not bigger swings. The hard constraint on any future pass
is 20 out of 20 clears on every profile.

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

- idle charge: terminal green, gradually filled, slow inward flow;
- active containment: dark red, slow inward flow;
- breached containment: vivid red, fast outward flow and heartbeat;
- reset: unlit neutral stone and engravings;
- clear: the ember-orange wreck (see friendly-reboot.md's lighting section).

## Code and coverage

The sim state machine lives in `src/sim/source_cave/encounter.ts`; shared spatial rules live in
`occupancy.ts`; the IWorld projection is extended in `wire.ts`; and the render split is
`source_cave_seal_state.ts` plus `source_cave_seal.ts`. The offline/headless placeholder roster
matches the GitHub leaderboard snapshot in `placeholder_roster.ts` exactly, including the
entries past the combat budget that ride the cave as overflow guardians.

Focused coverage includes deterministic wave construction, muster confirmation, forced breach,
direct cohort pulls, exit sealing, wipe reset, gradual IWorld occupancy, client wire parity, and
pure seal visual-state mapping.

`scripts/source_cave_reboot_e2e.mjs` drives the real offline client through all three seal
modes, the three-layer seal material, the opening wave, a cohort wake, a full breach wake,
the lighting change, the reboot, the chest, and its loot. One known false alarm: its
no-console-error check reports pre-existing Three.js `BufferGeometryUtils` warnings about
inconsistent UV attribute array types raised while the dungeon asset pack is merged. That
merge path is not used by the seal, which renders correctly.
