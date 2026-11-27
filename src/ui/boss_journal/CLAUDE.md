# src/ui/boss_journal: the encounter journal (raid + five-player dungeons)

These are the boss pages; the window that browses them is the Adventure Journal
(`src/ui/hud/journal/`, `#adventure-journal-window`), which lists every instance and
paints any journal SOURCE: the shipped raid guide (`raid_boss_guide_view.ts`, unchanged,
wrapped by `RAID_JOURNAL_SOURCE` and split per instance by the journal's catalog), a
dungeon page from `dungeons/`, or the Smith's Heart page in `raids/` (the same data
format, `members` for a council). The journal opens from the side rail, Shift+J, the
book beside the target frame and the Dungeon Finder's boss list.

| Module | Role |
|---|---|
| `journal_view.ts` | Pure core (`UI_PURE_CORES`): the journal types, `buildJournalPhases` (heroic-only mechanics drop on Normal; every mechanic carries its tier mark on Heroic), `dungeonJournalBossView`, `RAID_JOURNAL_SOURCE`, and the room context (`journalContextFor`: next standing boss from `IWorld.dungeonRun`, the run's difficulty). |
| `journal_tuning.ts` | Per-difficulty numbers through the sim's own difficulty stamp (`applyDungeonMobTuning` on a scratch mob): `tierDamage`, `tierScaled`, `heroicMechanicScale`. Never retype a multiplier. |
| `journal_sections.ts` | Markup helper (strings only, never DOM): the dungeon-only sections (role tips, key choices, the Heroic callout, rank chips, tier marks, the two-tier damage line). A DOM touch here would need a `UI_DOM_MODULES` row. |
| `journal_model_spec.ts` | The boss's real in-game model (`mobVisualKey` + `VISUALS`) reduced to the guide viewer's spec, mirroring `scripts/wiki/build_content.mjs`. A body the standalone viewer cannot build (split WOC body, bodyless) returns null and the page keeps its portrait with no WebGL context. The model controller releases, on close, the GLB files the journal was the first to load. |
| `registry.ts` | `DUNGEON_JOURNALS`: one row per dungeon page. |
| `raids/smith_heart.ts` | The Smith's Heart page, data-as-code in the dungeon format, registered in `hud/journal/journal_catalog.ts`; its numbers resolve per tier through `heart_tier_damage.ts` (pinned by `tests/smith_heart_journal.test.ts`). |
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
- Optional banner content on a boss: `taglineKey` (the one-line summary; without it the
  banner shows the overview), `chips` (stat chips, values print bold, `availability:
  'heroic'` for a Heroic-only chip), `nameKey` (a council's short title). A phase may set
  `health` (its pill: `'whole'`, `{ from, to }` with `to: 0` for the end, or `{ at }`)
  and `rangeOnly` when its summary only restates the band. Write them from the live
  mechanics, numbers from the tuning (`tests/adventure_journal_banner.test.ts`).
- Each mechanic `iconId` needs an explicit recipe in `src/ui/icons.ts` (`dgn_<dungeon>_*`).
- A mechanic that deals damage lists `hits`: every label the sim deals it under (the
  `ability` of its `damage` events: a dealDamage label, a DoT aura's name, a template
  kit's name), read from the encounter's name tables where it has them. A boss whose
  adds or other heads deal its mechanics names them in `hitSources`. The death recap
  shows such a hit with the mechanic's icon (`hud/journal/journal_hit_icons.ts`);
  `tests/journal_hit_icons.test.ts` pins every label to the sim, every dealer to a real
  template, no label to two icons, and the encounters' own damage calls to a row.
- `tests/boss_journal_view.test.ts` runs over EVERY registered journal (finder bosses present
  and in order, every key resolves with no placeholder left, cast names, kicks, heroic marks,
  the in-game model); add a per-dungeon facts block for the numbers players misread.
- The journal polls `syncRun` from the party-frames tick: an unchanged room and run
  (`IWorld.dungeonRun` / `IWorld.raidRun` are reference-stable) must stay a no-op
  (`tests/adventure_journal_window.test.ts`).
