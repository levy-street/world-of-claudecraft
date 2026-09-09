# Asmon, the Roach King

The canonical rift boss is `rift_boss_asmon`, authored in
`src/sim/content/rift/roach_king.ts`. Every procedural theme and the Infernal
Citadel use this identity. The encounter implementation is
`src/sim/rift/roach_king.ts`; rift rank and spawn scaling continue to use the
existing `src/sim/rift/ranks.ts` formulas.

The character is a fantasy parody of the Asmon persona, guided by the
provided concept: the reclusive streamer becomes a crowned insect sovereign.
Desk slams, an infestation, and offerings of discarded food establish that
fiction through the fight. They are encounter motifs, not factual claims about
the real person's private life.

## Encounter

Before his coronation, the boss alternates a close-range Desk Slam with Tribute
Feast. The slam marks a fixed ring; players leave that ring before it lands.
During the feast, Tribute Beetles appear and the boss channels. Interrupting the
channel prevents its heal; killing the beetles reduces the surviving tribute.
Each surviving summoned tribute beetle heals the boss for a fraction of his
maximum health when the channel completes. Existing interrupt rules decide
whether the interrupt connects.

At half health, the hermit performs the three-second Coronation of Filth.
Completing that cast grants Roach King's Crown, an authoritative cosmetic aura
with no Attack Power bonus.
The renderer uses that state to change his silhouette. The coronation summons
Royal Roachlings. The crowned ring attack becomes Royal Swarm, with a wider
warning and another wave of roachlings when it lands. The encounter caps living
summons, including both add families.

At A and S rank, the crowned sequence also casts Mountain of Filth. Its lethal
zones stay where the players stood when the cast began. A rank marks one chosen
player; S rank marks every living participant. Leave the ground warnings before
their fuses expire. The existing rift movement-impairment allowance and escape
window still apply. The boss holds position and delays ordinary swings during
warnings, so movement remains an available response.

Death, evade, and lost combat clear summons, outstanding zones, and cast state.
A living reset removes the crown so a new pull begins in the first form. A dead
boss retains the crowned silhouette if the group reached that phase.

## Content and presentation contracts

The existing Riftwalker and Rift Sovereign deeds continue to credit this
replacement encounter through `riftClears` and `riftSRankClears`. It adds no new
activity, unique item, or power reward. The Roach King carries the retired boss
rare loot; the Reliquary's `RIFT_RARE_SOURCES` points to his live template while
retaining theme trash sources. The old templates remain compatibility data.

Names enter the English catalog through `src/ui/world_entity_i18n.ts`. Cast
labels resolve through `src/ui/rift_cast_display_name.ts`; warning logs and the
crown name resolve through `src/ui/sim_i18n.ts`. The public rifts guide explains
the recurring sovereign and infestation without publishing this encounter
script. Runtime content must be regenerated through the owning wiki/i18n tools.

The target cast bar, fixed ground boundaries, and timing are actionable
information at every graphics setting. Insect swarms, debris, crown particles,
and micro-animation may add detail around those warnings without obscuring
them. The concept-derived models require the Tripo p2.0 pipeline and Blender
animation, plus registered mob portraits. The public guide excludes bosses
and summon-only adds, so these models have no public guide figures or stills.

Verification belongs to `tests/roach_king.test.ts`,
`tests/roach_king_i18n.test.ts`, the rift generation/rank tests, and the content
obligation suites for deeds, Reliquary, and the guide. Visual acceptance also
requires the running game at representative rift ranks and graphics settings.

## Local playtest

Start the worktree client with `npm run dev -- --host 127.0.0.1 --port 5185`,
open `http://127.0.0.1:5185/`, and choose Play Offline. In game chat, enter:

```text
/dev level 20
/dev bis
/dev immortal
/dev roachking S
```

The existing `/dev bis` command equips epic gear for a faster solo preview.
The direct route uses the real final floor of seed 42, removes supporting
trash, targets its boss, and places living party members outside his initial
aggro range. Walk toward the target to begin. `C`, `B`, and `A` select the other
rank kits; omitting the rank selects C. The shortcut leaves an existing rift run alone;
leave that run before invoking it again. Immortal mode keeps normal outgoing
damage so the boss survives long enough to show his phases. Toggle it off with
`/dev immortal` to test damage and lethality.

The automated local smoke uses `scripts/roach_king_smoke.mjs` and
`scripts/lib/roach_king_scenario.mjs`. Run each viewport/graphics combination:

```sh
node scripts/roach_king_smoke.mjs
node scripts/roach_king_smoke.mjs --low
node scripts/roach_king_smoke.mjs --mobile
node scripts/roach_king_smoke.mjs --mobile --low
```

`GAME_URL` changes the loopback client URL; `SHOT_OUT` changes the artifact
folder (default `tmp/roach-king-smoke`). Each run records the hermit, Desk Slam,
Tribute Feast, coronation, crowned form, Royal Swarm, Mountain of Filth, and
the completed Death pose.
The script exercises real encounter sequencing and temporarily holds sim
ticks while a screenshot captures each warning. Its JSON includes cast and
animation state, add identities, danger-zone data, corpse rig visibility and
skinned bounds, console errors, and GPU preparation telemetry. `--headed --hardware` enables a visible hardware run;
the default headless SwiftShader run proves function and presentation only,
not frame pacing or perceived smoothness.
