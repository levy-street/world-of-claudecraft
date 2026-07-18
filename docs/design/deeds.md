# The Book of Deeds: achievements, Renown, and the authoring contract

The achievements system. One deterministic evaluator in the sim, cosmetic-only
rewards, a server that observes but never decides. This page is the system in
brief plus the contract every new deed (and every new piece of conquerable
content) must follow.

## Vocabulary (player-facing, all rendered through t())

| Term | Meaning |
|---|---|
| Deed | One achievement. The everyday word in chat and broadcasts. |
| Book of Deeds | The achievements window (default `Shift+Z`). |
| Renown | Achievement points, quantized 5, 10, 25, 50. Zero for luck-based deeds and for all Feats. |
| Chronicle | A per-zone task set, split into Chapters, fronted by a Chronicler NPC. |
| Chronicler | The in-world NPC face of a zone's Chronicle (Saul, Osric Fenn, Zenzie). |
| Feat | A deed flagged `feat: true`: legacy, world-first, or unobtainable-by-design records. Every Feat is zero-Renown, but zero Renown does not make a deed a Feat (see Zero-Renown deed). Feats sit outside the completion count entirely. |
| Zero-Renown deed | A deed authored at Renown 0 under rule 2: luck-based drops (`col_first_rare`), the `col_set_*` armor-set collections, dynamic metas, and hidden luck moments (`hid_roll_hundred`). It counts toward Book completion like any other deed; it never scores on the Renown board. The exact non-feat set is pinned by `tests/deeds_completion.test.ts`, so growing it is a conscious, reviewed act. |
| Title | A cosmetic name suffix a player can select and display (nameplate, chat, target frame, character panel, boards). |
| Border | A cosmetic badge border flourish on capstone deeds. |

## Architecture

The catalog is data-as-code: `src/sim/content/deeds.ts` exports `DEEDS`
(id to `DeedDef`) and the append-only `DEED_ORDER`, and the same table runs
identically in the offline browser world, on the authoritative server, and in
the headless RL env. The evaluator (`src/sim/deeds.ts`, a system module behind
the `SimContext` seam) runs at the very end of the tick tail (grant
evaluation over dirty players only, plus a 1 Hz proximity sweep that sets
visit marks), draws zero rng, grants into `PlayerMeta.deedsEarned`, maintains
the `renown` sum and the persisted `deedStats` lifetime counters, and emits
the id-based `deedUnlocked` event (never English text); on world join it
re-evaluates every predicate against loaded state and grants with
`retro: true`, so veterans get credit for anything their character verifiably
already did. The same join pass carries the fallback heals
(`retroFallbackGrants` in `src/sim/deeds.ts`), idempotent and re-run every
login: PROOF inferences grant a deed whose evidence predates its counter (a
positive craft skill proves the first craft; a completed single-source
ground-pickup quest proves the first sparkle, pinned by
`GROUND_PICKUP_PROVING_QUESTS`), and STRANDED heals grant a deed once it has
become permanently impossible for that character (the five-up killing blow
once no creditable mob can sit five levels above, ceiling pinned by
`MAX_CREDITABLE_MOB_LEVEL`; rested XP at the cap where the pool is frozen),
keeping rule 5 honest and `feat_book_complete` reachable. Both proof sets are
re-derived from the live content tables by `tests/deeds_content.test.ts`. The server is an observer, never the authority: it upserts
unlocks into the `character_deeds` table fire-and-forget
(`server/deeds_records.ts`), fans out marquee broadcasts, and serves rarity
percentages and the account-level Renown leaderboard (scored by
`server/deeds_board.ts`) from TTL caches in `server/main.ts`. Render and UI reach all of it only through the
`IWorldDeeds` facet of `IWorld`; the window is `src/ui/deeds_view.ts` (pure
core) plus `src/ui/deeds_window.ts` (painter), and deed names re-localize
client-side through `src/ui/deed_i18n.ts`. Steam is a dark, env-gated mirror
(`STEAM_ENABLED`, off by default): linked accounts (link, never login) get
their earned-and-mapped deeds pushed to Steam via `server/steam/`, with the
server store always canonical.

## Rules that bind every deed

1. **Cosmetic only.** Rewards are titles and borders. No deed, reward, or
   Steam surface may confer power, convenience, or actionable information.
2. **Renown scale**: 5 routine, 10 standard, 25 notable, 50 prestige. ZERO
   Renown for anything luck-dependent (rare drops), for dynamic metas whose
   requirements grow with content, and for all Feats. The account score must
   never be able to decrease on any content patch. The luck-free guarantee
   covers the Renown board's SCORE, its completion-time tie-break, and its
   entry floor (the scoring set, `server/deeds_board.ts`); a zero-Renown deed
   still counts toward Book completion through the shared predicate
   (`src/sim/deeds_completion.ts`), it simply never scores. Do not "fix" the
   board by counting zero-Renown deeds into it, and do not "fix" the Book by
   hiding them from completion: the split is the design.
3. **Closed trigger vocabulary.** Every trigger is one of the `DeedTrigger`
   kinds in `src/sim/types.ts`: a predicate over persisted state (`level`,
   `lifetimeXp`, `quest`/`quests`, `arenaRating`, `craftSkill`, `gathering`,
   `meter`, `flag`), a lifetime counter threshold (`stat` over `deedStats`,
   `dungeonClears`, `delveClears`), a collection (`collectItems`), an
   interaction mark (`visit`/`visits`), a meta over other deeds (`meta`), or
   an explicit bespoke grant (`manual`, for encounter mechanical, perfection,
   restriction, and speed tasks). Do not invent a new kind when an existing
   one fits.
4. **Skill tasks fail only through player error, never RNG.**
5. **No permanently missable deeds.** Anything tied to seasonal or retired
   content becomes a Feat, preserved visibly, never deleted. A deed that can
   silently become permanently impossible for an individual character (an
   earning window their level has passed, a pool frozen at the cap, a counter
   whose only feed sits behind consumed one-shot quests) is healed at world
   join instead: `retroFallbackGrants` grants it from proof where persisted
   state demonstrates the action, or outright once no earn path can ever
   exist again for that character (see Architecture).
6. **Count outcomes, not attempts.** No deed may reward griefing, AFK
   attendance, or pure login. PvP uses rating thresholds and milestones that
   cannot be win-traded profitably; multiplayer deeds must be satisfiable
   only by being a better teammate. Encounter skill tasks deliberately credit
   the instance/room presence roster, so a healer or taunt tank who leaves no
   damage trace is still credited, and because instance slots are group-private
   a passenger riding the kill is the group's own choice, not open-world AFK.
7. **Thresholds sit where natural play lands.** Most of the catalog is
   reachable in the first two-thirds of a character's journey; sub-1%
   unlocks are deliberate prestige only.
8. **Hidden deeds are a small delight/spoiler set**, fully invisible until
   earned, and stripped from every public surface (the wiki generator, the
   rarity endpoint, third-party character sheets). Everything else shows its
   criteria and progress.
9. **Never retro-edit an existing trigger.** Widening a trigger list changes
   mid-progress fractions and re-scopes what an earned deed meant; new
   coverage lands as NEW deeds. Earned records are append-only.
10. **Era feats** resolve via the `DEEDS_ERA` constant in
    `src/sim/content/deeds.ts`, bumped only by the maintainer at era
    boundaries.

## Counting rules and surfaces (one predicate, one scoring set)

Two player-facing quantities exist, and every readout names which one it
shows. **Completion** is the shared predicate `countsTowardCompletion` in
`src/sim/deeds_completion.ts`: non-feat live-catalog deeds, hidden ones
joining only once earned, zero-Renown deeds included. **The scoring set** is
the distinct renown-bearing deed ids (`server/deeds_board.ts`, mirrored by the
SQL twin `deedsBoardRanked` in `server/db.ts`), deduped once per ACCOUNT; it
drives the Renown board's score, entry floor, and completion-time tie-break,
and it surfaces as Renown, never as a count.

| Readout | Set | Scope |
|---|---|---|
| Book of Deeds header pair (earned/total) | Completion | Character |
| Book of Deeds category counts | Visible deeds per display bucket (the Feats shelf shows its own bucket) | Character |
| Book of Deeds Renown stat | Scoring set, summed (the evaluator's denormalized sum) | Character |
| Character sheet `deeds.earnedCount` (JSON sheet + companion OAuth) | Completion | Character |
| Renown board score | Scoring set, summed | Account |
| Renown board tie-break | Scoring set, max over each deed's earliest earn | Account |
| Renown board entry floor | Scoring set, summed | Account |
| Wiki deed catalog | Completion universe minus hidden (structural strip) | Content |

**The ranked-surface rule** (learned from the 142-vs-129 count report): any
number shown on a ranked surface must be either recomputable by the player
from an in-game surface or explicitly labeled with its set and scope. The
Renown board therefore displays Renown alone: there is no deed-count column
(the retired wire field is deprecated and tracked for removal in issue
#2044), the account scope is stated in visible text on the tab
(`hudChrome.deeds.lbScopeNote`), and the self line carries the account's
board-scored Renown so a single-character player can verify it against their
Book. If a deed count is ever re-added to a ranked surface, it must be named
by its set (never the Book's bare word "Deeds") and derive from the same set
as the score and tie-break on that row. Cross-surface agreement is pinned by
`tests/deeds_completion.test.ts`.

## Adding a deed (the recipe)

1. Think the block through first: id (lower_snake with its category prefix:
   `prog_`, `cmb_`, `dgn_`, `dlv_`, `chr_`, `col_`, `pvp_`, `soc_`, `exp_`,
   `feat_`, `hid_`), English name and one-sentence criteria desc in the
   game's playful classic voice, Renown on the scale above, a trigger from
   the closed vocabulary, reward (most deeds: none), hidden flag, Steam
   decision.
2. Add the `DeedDef` at the END of the `DEEDS` table in
   `src/sim/content/deeds.ts`. `DEED_ORDER` derives from table order, so the
   table is append-only: never reorder or edit existing entries.
3. If no persisted state covers the trigger, add a `DeedStatKey` counter and
   bump it at the gameplay site through the append-only `SimContext`
   callbacks (`bumpDeedStat`, which also marks the player dirty; a site that
   changes trigger-relevant state without a counter calls `markDeedsDirty`),
   or call the bespoke grant helper for `manual` deeds. Never ship a counter
   no deed reads, and never ship a deed no site can satisfy (a
   visible-but-unearnable deed is worse than none).
4. Tests: `tests/deeds_content.test.ts` pins the catalog (ids, renown
   values, trigger integrity against the real content tables);
   `tests/deeds_sites.test.ts` covers grant sites. New counters and sites
   get decisive assertions in the same change.
5. Regenerate the wiki (`npm run wiki:content`, gated by
   `tests/guide.test.ts`); hidden deeds are filtered structurally and must
   never appear in the generated guide.
6. Icons: real art ships as 512px sources ingested to 128px WebP by
   `scripts/convert_deed_icons_webp.mjs` (regenerates
   `src/ui/deed_image_ids.ts`); an artless deed falls back to its procedural
   category crest, so art can trail the deed. Flag new ids to the maintainer
   for the commissioned set (a line in the PR body listing the new ids is
   enough).
7. Steam: if the deed is marquee, legible, and spoiler-safe, add its
   `ACH_<UPPER_SNAKE>` mapping in `server/steam/achievement_map.ts` (hard
   cap 100 registered names; API names are stable forever).

Every new piece of conquerable content (a dungeon, delve, raid, world boss,
zone, or rare) authors its deeds in the SAME change that adds the content;
the root `CLAUDE.md` content rule points here.

## Deliberately deferred (do not "fix" these by shipping them)

- **Account-level deeds** (`prog_three_paths`, `prog_ninefold`, and the
  seven server-assisted `feat_*` world/realm firsts): the v1 evaluator is
  strictly per-character and `server/deeds_records.ts` is observer-only; an
  account-level grant lane must exist first.
- **`prog_ringwright`**: jewelcrafting and inscription have zero recipes
  today, and enchanting (which ships an enchant table and gains skill from
  disenchant and apply-enchant in the sim) has no player-facing wiring on
  any host yet, so the ten-craft ring cannot complete and the deed would be
  visible yet unearnable.
- **The salvage pair** (`soc_first_salvage`, `soc_salvage_50`): salvage has
  no player-facing wiring on any host yet (no `IWorld` member, no UI caller,
  no wire or server command).
- **`pvp_vcup_bet_flex`**: cut; no betting-adjacent deeds ship, even at 0
  Renown.

The reviewed design blocks for all of these live in the deed catalog's
authoring history; a deferred deed stays out of `DEED_ORDER` and off Steam
until its blocker actually lands.
