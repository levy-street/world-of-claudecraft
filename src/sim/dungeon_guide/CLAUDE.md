<!-- src/sim/dungeon_guide only. Determinism, the SimContext seam and the
     sim-text rules live in src/sim/CLAUDE.md; do not repeat them here. -->

# src/sim/dungeon_guide: optional dungeon lore guides

A guide is a friendly NPC who waits at a dungeon's entrance every run, offers
to walk with the group, and if any member accepts follows behind them, speaks
short lines at authored moments, and plays a finale when the last boss falls.
The Drowned Temple's Laverock (`content/drowned_temple_cantor.ts`) is the first
record; a later dungeon adds a guide with DATA only.

| File | Role |
|---|---|
| `types.ts` | Type leaf: the `DungeonGuideDef` record shape (lines, trigger table, dialog keys, follow tuning, finale) and the per-run `DungeonGuideRun` state kept on the guide's entity (`Entity.guideRun`). |
| `guide.ts` | The behavior behind `SimContext`: `tickDungeonGuides` (one pass per live claim, called from `instances/dungeons.ts` `updateInstances` after every encounter), the trigger scans, the follow, the finale and deed grant, and `answerDungeonGuide` (the validated offer answer; `Sim.answerDungeonGuide` delegates, `IWorldDungeons` surface). |
| `follow.ts` | Pure geometry: the breadcrumb trail of the rearmost member, the trail walk, the catch-up point (never across a jump), the authored finale walk. |
| `speech.ts` | The speech queue: eligibility (variant, heroic, once per run), priority pick, stale and too-late drops, the id-only `dungeonGuideLine` emit and the body gesture. |

Adding a guide: author a dynamic `NpcDef` and a `DungeonGuideDef`, place the NPC
in the dungeon's `DungeonDef.npcs`, append the record to
`content/dungeon_guides.ts`, add the English for every key under the record's
`i18nPrefix` to `src/ui/i18n.catalog/dungeon_guides.ts`, a deed if the finale
grants one, and a test like `tests/drowned_temple_cantor.test.ts`.

Rules:
- Zero gameplay effect. The guide lives in the claim's `npcIds` (packs, gates,
  the boss chain pull and wipe checks never see him), never deals or takes
  damage, holds no threat, has no collision, and counts for nothing.
- Deterministic and off the shared stream: the one random choice (which line of
  each variant group this run speaks) comes from a PRIVATE `Rng` seeded by the
  claim (`guideSeed`), so `ctx.rng` is never drawn; every timer is sim time.
- Ids only on the wire: the sim emits `dungeonGuideLine` / `dungeonGuideFinale`
  per player in the claim; the client renders `t(<prefix>.<key>)`. The offer
  state rides the guide's entity as `guideState` (wired `gds`).
- Positions are written directly from the players' own trail (heights
  included), so a guide never paths across a void between walkways.
