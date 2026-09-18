# A Borrowed Face

An investigation world quest at the Fenbridge guard post in Mirefen Marsh.
The player speaks with Sergeant Alric, interviews four guards, and examines
Standing Orders and the Watch Ledger. One account contradicts the written evidence.
The authored cases vary with the world quest rotation.

After hearing every guard and reading both clues, the player can explicitly accuse
a suspect in the normal NPC dialogue. An incorrect accusation rules that guard out
without removing evidence. A correct accusation reveals The Borrowed Face as a
normal combat enemy. Ordinary abilities remain available, and allies can help kill it.
Completion uses the existing world quest XP reward and grants the exploration deed.

## Ownership and lifecycle

`src/sim/content/world_quest_investigation.ts` owns the site, dialogue facts, suspects,
clues, and cases. `src/sim/world_quest_investigation.ts` validates interactions and
owns encounter transitions through `SimContext`. Evidence and the revealed enemy ID
are personal transient progress, strictly decoded by the investigation wire module.
The shared guard entity remains intact for other players. The visibility module hides
the owner's revealed disguise consistently in rendering, picking, nearby interaction,
and gamepad NPC selection.

Death, departure, evade, despawn, and rotation changes clean up the encounter. The kill
must match the recorded summoned enemy and its owner before completion is awarded.
Existing rotation claims prevent duplicate rewards. No database schema is added.

## Local verification

Use `/dev infiltrator` in a development offline game to activate an eligible rotation,
raise the character to the minimum level if needed, and travel to Sergeant Alric.
This command preserves an already claimed completion.

Behavior is covered by `tests/world_quest_investigation.test.ts`; wire and presentation
contracts have companion investigation tests. NPC cycle, gamepad target selection,
and nearby interaction regressions cover the revealed disguise. Run the canonical
`npm run gate` before integration. Visual evidence belongs under
`docs/screenshots/world-quest-investigation/`.

## Verification record, 2026-09-08

Finishing changes were checked on `fix/infiltrator-finish`, based on `c5f0329076`,
then applied without commits to `feature/world-quests`, preserving concurrent glider work.

Passed in the isolated worktree:

```sh
node node_modules/vitest/vitest.mjs run tests/world_quest_investigation.test.ts tests/world_quest_investigation_wire.test.ts tests/world_quest_investigation_view.test.ts tests/investigation_presentation.test.ts tests/npc_cycle.test.ts tests/pad_target_pick.test.ts tests/nearby_interaction.test.ts tests/npc_looks.test.ts tests/npc_voice_coverage.test.ts tests/gathering.test.ts tests/mob_aura_icon_art.test.ts tests/player_movement_modes.test.ts tests/monolith_budget.test.ts --maxWorkers=2
npx tsc --noEmit
npm run test:browser
npm run build:bundle
git diff --check
```

The scoped suite passed 174 tests across 13 files. The same suite on the shared
worktree passed 172 tests, with two catalog failures confined to concurrent
`glider_instructor` and `glider_apprentice` additions. TypeScript passed in both trees.
Scoped Biome passed after formatting. The gate's `ci:changed`, artifact freshness,
SFX conformance, and security scan steps passed. Its remaining browser and
typecheck/env/server/bot/client build steps were also executed successfully using
the canonical step definitions in `scripts/lib/gate_steps.mjs`.

`npm run gate` did not complete: its full suite reported failures, including Windows
shell/path/symlink assumptions and unrelated capture/renderer contracts. A focused
`node node_modules/vitest/vitest.mjs run tests/sfx_export_core.test.ts --maxWorkers=1`
confirmed `spawnSync sh ENOENT`. The full run was stopped after those failures;
there is no full-suite pass claim. WQ-specific content omissions it found were fixed
and rechecked: authored NPC looks, role voice aliases, corpse inventory, the
infiltrator's plague icon, and the movement test's world quest state fixture.

The real Edge client completed the investigation using normal NPC/object commands,
clicked accusation buttons, retained evidence after a wrong accusation, and defeated
the revealed enemy with autoattack and Heroic Strike. XP, deed, completion state,
and disguise restoration were observed. Screenshots cover desktop and touch landscape;
portrait correctly shows the existing landscape requirement. These captures validate
presentation and offline flow; they are not a live multiplayer browser test.

Verdict: ready for local WQ playtesting; repository-wide release QA remains unproven.
