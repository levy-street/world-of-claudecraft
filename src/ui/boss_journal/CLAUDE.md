# src/ui/boss_journal: the encounter journal (raid + five-player dungeons)

One window, `src/ui/raid_boss_guide_window.ts` (`#raid-boss-guide-window`), paints
any journal SOURCE: the raid guide (`raid_boss_guide_view.ts`, unchanged, wrapped by
`RAID_JOURNAL_SOURCE`) or a dungeon page from this directory. It opens from the party
frames' guide button inside the instance and from the Dungeon Finder's boss list
(`openJournal`), so the page can be read before the run.

| Module | Role |
|---|---|
| `journal_view.ts` | Pure core (`UI_PURE_CORES`): the journal types, `buildJournalPhases` (heroic-only mechanics drop on Normal; every mechanic carries its tier mark on Heroic), `dungeonJournalBossView`, `RAID_JOURNAL_SOURCE`, and the room context (`journalContextFor`: next standing boss from `IWorld.dungeonRun`, the run's difficulty). |
| `journal_tuning.ts` | Per-difficulty numbers through the sim's own difficulty stamp (`applyDungeonMobTuning` on a scratch mob): `tierDamage`, `tierScaled`, `heroicMechanicScale`. Never retype a multiplier. |
| `journal_sections.ts` | Markup helper (strings only, never DOM): the dungeon-only sections (role tips, key choices, the Heroic callout, rank chips, tier marks, the two-tier damage line). A DOM touch here would need a `UI_DOM_MODULES` row. |
| `journal_model_spec.ts` | The boss's real in-game model (`mobVisualKey` + `VISUALS`) reduced to the guide viewer's spec, mirroring `scripts/wiki/build_content.mjs`. A body the standalone viewer cannot build (split WOC body, bodyless) returns null and the page keeps its portrait with no WebGL context. The model controller releases, on close, the GLB files the journal was the first to load. |
| `registry.ts` | `DUNGEON_JOURNALS`: one row per dungeon page. |
| `dungeons/<dungeon>.ts` | Data-as-code, one file per dungeon: bosses in route order (minibosses included), phases, mechanics, tips, choices, heroic notes. |

## Adding or changing a dungeon page
- Truth comes from the encounter code (`src/sim/encounters/<dungeon>/`): read the module
  header AND the code. Import every number from the encounter's exported tuning; heroic
  damage goes through `tierDamage` (the claim's `mechanicDamage` scale).
- A mechanic with a cast bar sets `castId` and reads its name from `abilityUi.cast.<castId>`
  (the guide and the bar never disagree). `interruptible` is set exactly when the cast id is
  in `SCRIPTED_INTERRUPTIBLE_CHANNELS` (`tests/boss_journal_view.test.ts` enforces both).
- English only, in `src/ui/i18n.catalog/boss_journal.ts` (`bossJournal.<dungeon>.<boss>.*`),
  written per `docs/design/tooltip-writing.md`: action first, resolved numbers, every limit.
  A new wordy value also needs its five non-Latin fills (M16) in the same change.
- Each mechanic `iconId` needs an explicit recipe in `src/ui/icons.ts` (`dgn_<dungeon>_*`).
- `tests/boss_journal_view.test.ts` runs over EVERY registered journal (finder bosses present
  and in order, every key resolves with no placeholder left, cast names, kicks, heroic marks,
  the in-game model); add a per-dungeon facts block for the numbers players misread.
- The window polls `syncAvailability` from the party frames: an unchanged room and run
  (`IWorld.dungeonRun` is reference-stable) must stay a no-op (`tests/boss_journal_window.test.ts`).
