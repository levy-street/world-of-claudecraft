# Implementation Handoff: Seasonal Events and Retention (Amberfall Harvest Fair + Weekly Calendar)

| | |
|---|---|
| **Status** | BLOCKED pending the Levy portfolio and schedule decision. PR A (S1, S2) has no zone dependency but is not authorized merely because it is technically independent. Fair slices (S3 to S8) are additionally blocked on PR #2321 (feature/procedural-dungeons, the Amberfall zone) and go through a PBE round before any release. |
| **Portfolio lane** | Proposed fourth approval candidate, the support layer after a new tentpole. This is not Levy approval. |
| **Dispatch gate** | Levy approves the civil-time policy, fixture schedule, and this portfolio slot. Scheduler/calendar go first; recipes and extra games are cut before the fair meter, derby, lantern launch, or anti-FOMO contract. |
| **Source PRD** | `docs/prd/seasonal-events-and-retention.md` (implementation notes + File plan inside are verified and binding) |
| **Scope** | The season/fixture window scheduler, the weekly calendar surface, the fair (stalls, turn-in meter, derby, lantern launch, games, deeds, skins, recipes). NO calendar HUD window (separate UI PRD), NO vanity-pet system (deferred), NO Vale Cup exhibition (cut; the Cup gets a fixture day). |
| **Verified against** | 2026-07-25: origin/release/v0.30.0 (c1a7f42f1) and, for Amberfall anchors only, origin/feature/procedural-dungeons (0084f3dad). Revalidate every anchor against the active release branch before implementation; trust symbols, not line numbers. |
| **Executor routing** | Claude uses `extract-and-test` and `qa-checklist`; Codex uses `$woc-extract-and-test` and `$woc-qa`. Persistence work requires database-performance and persistence review; render/UI and sim reviews follow the changed surface. No slice depends on a named model. |

---

## 0. Ground rules for every implementation prompt

1. `src/sim/` never imports from `render/`, `ui/`, `game/`, `net/`, or any DOM/Three
   API. Guarded by `tests/architecture.test.ts`.
2. All sim randomness goes through `Rng` (`ctx.rng`). Never `Math.random`, `Date.now`,
   `performance.now` in sim logic. Windows are host-supplied civil-time inputs
   online; offline fair content is controlled by a host-provided flag set at
   world creation and defaulting OFF. The sim NEVER reads a clock.
3. Every player-visible string is i18n: sim/server emit stable keys or English
   literals with matcher entries (`src/ui/sim_i18n.ts`, S3 guard
   `tests/localization_fixes.test.ts`); UI strings are `t()` keys in
   `src/ui/i18n.catalog/`. M16: new wordy English values need their five non-Latin
   fills (zh_CN, zh_TW, ja_JP, ko_KR, ru_RU) in the same change. Every NEW item id
   needs an English row; maintainers fill remaining overlays before release.
4. **Anti-FOMO hard rules (from the PRD, non-negotiable):** rewards are cosmetic,
   social, or convenience only, never player power (docs/design/deeds.md rule 1).
   No streaks, no daily checklists, no expiring currencies; everything returns every
   fair, forever. Tallies and meters accumulate or reset without ever deleting player
   progress; missing a window costs fun, never an item.
5. **Agents are first-class players:** every activity is a channel, a turn-in, or a
   published-schedule appointment. No reflex gates anywhere (the gourd roll is one
   seeded draw by design).
6. TypeScript strict, ESM, 2-space indent. No em dashes, en dashes, or emojis
   anywhere. Conventional Commits with scope, e.g. `feat(events): ...`.
7. Anchor completion on the slice's acceptance commands, not on "looks done".
8. Seasonal state is realm-owned: one live object on `Sim`, one
   `world_state` row `seasonal:<realm>`, never `PlayerMeta`, character blobs,
   or one database call per activity.

## 1. Shared design constants (defined once in S1; everyone else imports)

```ts
// src/sim/events/season_schedule.ts (new module, behind SimContext)
export const FAIR_WINDOW_DAYS = 14;          // two-week fair (tuning)
export const FAIR_CADENCE_WEEKS = 8;         // recurrence (tuning; open question 1)
export const FAIR_SCHEDULE_VERSION = 1;
export const FAIR_FIRST_OPEN_LOCAL = '2026-09-18T20:00:00'; // realm-local proposal, tuning
export const LANTERN_LAUNCH_HOUR = 20;       // realm-local civil 20:00 (tuning)
export const LANTERN_CHANNEL_SEC = 3;        // freely interruptible
export const FAIR_METER_THRESHOLDS = [300, 800, 1500] as const; // turn-ins (tuning)
export const SEASONAL_SAVE_VERSION = 1;
export const FAIR_METER_CAP = FAIR_METER_THRESHOLDS[2];

export interface SeasonalRealmSave {
  version: typeof SEASONAL_SAVE_VERSION;
  fairId: string; // derived from opening instant + schedule version + realm TZ
  meter: number;  // finite integer, clamped to 0..FAIR_METER_CAP
}
```

Advance recurrence by `FAIR_CADENCE_WEEKS` as calendar weeks in the configured
realm time zone, not as elapsed milliseconds. Convert each civil opening through
the same DST policy as `server/raid_reset.ts`, then construct `fairId` as
`v<FAIR_SCHEDULE_VERSION>:<realmTimeZone>:<openingEpochMs>`. Any
anchor or cadence change increments `FAIR_SCHEDULE_VERSION`.

Deed tuning (S4/S5/S7/S8): Renown quantized 5/10/25/50; luck deeds and the launch
deed at zero Renown; capstone title "Lanternlight" (tuning). Turn-ins pay standard
work-order copper, unchanged (the payout fraction is an economy constant).

## 2. Verified hook-point map (re-find every anchor before editing)

All rows verified on origin/release/v0.30.0 except the Amberfall rows (branch only).

| Concern | Anchor |
|---|---|
| Cadence primitive | `src/sim/professions/cadence.ts`: `WORK_ORDER_CADENCE_TICKS = 36000`, `CadenceMap`, `isCadenceBlocked`, `armCadence`, and `serializeCadence`. Consumers use `repeatCadenceTicks` in the zone quest records and `src/sim/quests/quest_commands.ts`. At 20 Hz the cadence is 30 minutes, so it remains a provisioning-order precedent and is never cleared for market day. |
| Host civil time | `server/raid_reset.ts`: `nextRaidResetMs` and `isSupportedTimeZone`. Fair windows reuse host-computed civil inputs, but seasonal state does NOT use per-character `meta.raidLockouts`. |
| Realm JSONB store | `server/db.ts`: `world_state`, `loadWorldState`, `saveWorldState`, and the realm-key wrappers for `market:<realm>` and `mail:<realm>`. Seasonal adds typed wrappers for exactly one `seasonal:<realm>` row. |
| Save cadence | `server/game.ts`: `createSerialWriter` and `flushPeriodicSaves`. Seasonal adds a dirty, coalesced writer with at most one in-flight and one trailing save; no turn-in query. |
| Boot and shutdown | `server/main.ts`: the schema setup, game construction, and shutdown lifecycle. Seasonal load completes before listen, and its writer drains before pool close. |
| Shared realm wire | `server/realm_readout_memo.ts` exports `realmReadoutJson`; `server/game.ts` imports it and combines its memoized readout with `maybeRaw`. Seasonal uses this shared path, not per-session `maybe()`. |
| Fishing | `src/sim/professions/fishing.ts`: `startFishing`, `completeFishing`, `fishingCatchGain`, rare precedent `the_codfather`, and the `onFishCaughtForDeeds` call. `completeFishing` keeps one table draw, with capacity gates after the roll so draw order never depends on bags. |
| Deeds | Content `src/sim/content/deeds.ts`: append-only `DEED_ORDER`. Evaluator `src/sim/deeds.ts`: `onFishCaughtForDeeds`, `onNpcTalkedForDeeds`, and `onCupMatchEndForDeeds` as meter and flag templates. Contract doc: `docs/design/deeds.md`. |
| Skins | `src/sim/content/skins.ts`: `EVENT_SKIN_TOKEN_ID`, `rollSkinRank`, and `EVENT_SKIN_TIERS`. The placeholder mapping comment identifies what S8 replaces. |
| Card duel | `src/sim/social/card_duel.ts` + `card_duel_queue.ts`: `createCardDuelQueue`, `joinCardDuelQueue`, and `tryPairCardDuel`; `src/sim/content/card_master.ts`: `CARD_MASTER_NPC_ID`. Only the fair desk placement is new. |
| Mail | `src/sim/content/letters.ts`: `LetterDef` and `QUEST_LETTERS` as the record template; delivery via `src/sim/mail/post_office.ts` and `PostOffice`, with letterId client localization. |
| Noticeboards | `src/sim/content/noticeboards.ts`: `NOTICEBOARDS` and `noticeboardDefByEntityId`. Town Focus is an interaction precedent only; seasonal persistence and shared wire use the rows above. |
| Content merge | `src/sim/data.ts` imports the zone content modules. New content modules merge here. |
| Amberfall (branch #2321 ONLY) | `src/sim/content/amberfall.ts`: Lanternmere, the Great Mere POI, `reeve_ottoline`, `waywatcher_sorrel`, `ferrymaster_caddow`, `orchardist_pomeline`, and the existing `stalls` prop records. Fair placements are ADDITIVE to this file. |
| SimContext seam | `src/sim/sim_context.ts`; new system modules take `ctx: SimContext`, backing state lives on `Sim` as a live ctx view (`src/sim/CLAUDE.md`). |
| IWorld | `src/world_api.ts` + per-facet files in `src/world_api/` (e.g. `daily_rewards.ts` as a facet template); parity pin `tests/world_api_parity.test.ts`. |
| ClientWorld | `src/net/online.ts`: `applySnapshot` self and global mirrors. |
| Server tick pin | `server/game.ts`: `SIM_LAP_PHASES`, pinned by `tests/server/tick_perf_capture.test.ts`. A new named sim phase must be added to the array or its timing drops. |
| Parity goldens | `tests/parity/scenarios.ts`; `UPDATE_PARITY=1 npx vitest run tests/parity` regenerates; never regenerate to hide a diff. |
| Wardstone channel precedent | `src/sim/interaction.ts`: `nythraxis_ward_channel`, the readable ground-object channel pattern for stalls and lanterns. |

## 3. Slices

Dependency order: S1 -> S2 (PR A, ships first, release-branch base) ; S3 -> S4 -> (S5,
S6, S7 in any order) -> S8. S3 onward stack on #2321 and follow the PRD's PR B/C/D
staging: S3+S4 = PR B, S5+S6 = PR C, S7+S8 = PR D.
S2, S4, S6, and S8 close their PR boundaries. Each closeout carries that
PR's Deeds and pins, English catalog and any M16 work, sim matcher rows, wiki
regeneration, credits/provenance, and
`npx vitest run tests/deeds_content.test.ts tests/localization_fixes.test.ts tests/guide.test.ts && npm run wiki:content`.

### S1. Season/fixture scheduler and realm-save lifecycle
- Goal: one small SimContext module resolving "what is open now" deterministically,
  plus the complete versioned realm-save lifecycle it depends on.
- Files: NEW `src/sim/events/season_schedule.ts` + `tests/season_schedule.test.ts`;
  NEW `tests/server/seasonal_persistence.test.ts`; MODIFIED `src/sim/sim.ts`
  (tick call + one live seasonal realm object), `server/db.ts` (typed
  `seasonalStateKey(realm)`, `loadSeasonalState`, `saveSeasonalState` over
  `world_state`), `server/game.ts` (host civil-time input beside raid reset,
  dirty/coalesced serial writer, periodic and boundary flushes; SIM_LAP_PHASES
  pin if named; aggregate save-age/failure diagnostics), `server/main.ts`
  (load before listen, shutdown drain).
- Derived window shape, never persisted:
```ts
export interface SeasonWindowState {
  fairOpen: boolean;
  fairId: string;
  fairClosesAtMs: number | null;    // host-derived; null offline
  nextFairOpensAtMs: number | null;
  fixtureDayId: FixtureDayId | null; // resolved from host civil-day input
  nextLanternLaunchAtMs: number | null; // null outside a fair window
}
```
  Host mode computes instants and a stable `fairId` from the opening instant,
  schedule version, and realm time zone, then hands those values to the sim.
  Offline mode receives a host-provided `offlineFairEnabled` flag at world
  creation. It defaults OFF. When explicitly enabled, fair content is always
  open with a stable offline `fairId`; no calendar progression or wall-clock
  read occurs.
- Persist only `SeasonalRealmSave { version, fairId, meter }`. Sanitize on load:
  reject unknown shapes, normalize meter to a finite integer in
  `0..FAIR_METER_CAP`, retain it only when the loaded `fairId` matches the
  host-derived current fair, otherwise reset once into the current fair.
- Writer contract: mark dirty on mutations; at most one database write in flight
  and one trailing write for newer state; autosave may flush dirty state; fair
  boundaries and thresholds request a flush; failure leaves dirty state for retry;
  shutdown drains. A turn-in never calls `saveSeasonalState` directly.
- Tests FIRST: same seed + host inputs produce identical windows; offline worlds
  default to fair content OFF and enable it only through the world-creation flag;
  same-fair restart preserves meter; next-fair and downtime reconciliation reset
  once; corrupt/non-finite/out-of-range documents sanitize; realms use distinct
  keys; writer queue stays bounded; failure retries; shutdown drains;
  save-age/failure diagnostics expose no payload; architecture proves no sim clock
  read. Pin exactly one zero-or-one-row boot read and writes only on dirty autosave,
  boundary, threshold, or shutdown triggers. Independent malformed cases cover
  unknown version, missing/invalid `fairId`, missing meter, negative, fractional,
  above-cap, NaN, and Infinity. Fixed vectors cover the anchor, two recurrence
  cycles, a DST transition, exact boundaries, and a schedule-version change.
- Acceptance: `npx vitest run tests/season_schedule.test.ts tests/server/seasonal_persistence.test.ts tests/architecture.test.ts && npx vitest run tests/parity`

### S2. Calendar data table + market day + noticeboard/letter surface (completes PR A)
- Goal: the published weekly rhythm and its minimal v1 surface.
- Files: NEW `src/sim/content/event_calendar.ts` (fixture-day table: Tuesday reset,
  Wednesday Vale Cup, Friday market day, Saturday Ferrywalk placeholder once its
  proposed PRD lands, Sunday featured Hunt placeholder once its proposed PRD lands;
  days tuning; merged by `data.ts`). Friday market day defines one visiting peddler
  as a normal vendor NPC with one stall and an inventory of existing item ids. The
  fixture-day gate spawns both NPC and stall while open and despawns both when
  closed; it never mutates work-order cadence or payout state. MODIFIED
  `src/sim/content/noticeboards.ts` (calendar notice content),
  `src/sim/content/letters.ts` (fair-open letter record), character state
  serialization (`lastFairLetterId`) with lazy reconcile on character load and an
  online-character boundary update, `src/ui/sim_i18n.ts` matcher entries for any
  sim-emitted lines. Never scan the character table.
- Reused: normal NPC definitions, vendor inventory and interaction machinery,
  existing item ids, NOTICEBOARDS, and LetterDef/PostOffice. NEW: the fixture table,
  one peddler NPC definition, and one stall placement only.
- Tests FIRST: the peddler NPC and stall exist only while the Friday gate is open;
  vendor interaction uses the existing machinery; every stock item id already
  exists; work-order `CadenceMap` state is unchanged at both Friday boundaries;
  fixture resolution is pure; fair letter delivers once per `fairId`; a character
  offline at the fair boundary reconciles on next load; no boundary-wide character
  query occurs.
- Acceptance: `npx vitest run tests/season_schedule.test.ts tests/server/seasonal_persistence.test.ts tests/localization_fixes.test.ts && npx vitest run tests/parity`

### S3. Realm-shared fair meter (seam slice: IWorld, wire, mirror, parity)
- Goal: the persisted realm meter plumbed through all three hosts. Buildable against
  the release base, but merges as part of PR B.
- Files: MODIFIED `src/sim/events/season_schedule.ts` (meter mutations + threshold tier
  on the S1 live realm state),
  `src/world_api.ts` + NEW facet `src/world_api/seasonal.ts`
  (`seasonalInfo: { fairOpen: boolean; meter: number; meterTier: 0 | 1 | 2 | 3; fixtureDayId: string | null }`),
  `server/game.ts` (S1 dirty writer integration plus shared snapshot readout),
  `src/net/online.ts` (mirror), `tests/server/seasonal_persistence.test.ts`,
  `tests/world_api_parity.test.ts` + `tests/snapshots.test.ts` pins.
- Meter wire field sketch (global, not self-only; serialize once through the realm
  readout memo because every client renders the same town):
```ts
// server snapshot: fair: { o: 0|1, m: number, t: 0|1|2|3 }
// server/game.ts imports realmReadoutJson from server/realm_readout_memo.ts
// server: maybeRaw('fair', realmReadoutJson(... seasonalInfo ...))
// online.ts applySnapshot: if (s.fair) this.seasonal = decodeFair(s.fair);
```
- Reused: `realmReadoutJson` from `server/realm_readout_memo.ts`, `maybeRaw` in
  `server/game.ts`, world_api facet layout, and the S1 realm save. NEW: meter
  state only (resets each fair, gates nothing).
- Tests FIRST: offline Sim and ClientWorld expose identical `seasonalInfo`; meter
  survives same-fair save/load; values clamp to `0..FAIR_METER_CAP`; threshold
  crossings dirty and flush once; 100 turn-ins issue zero immediate queries and
  coalesce to one eventual save; fresh joins receive current state; unchanged state
  is elided; viewer-identical state stringifies once per broadcast pass; two realms
  remain isolated; parity scenario untouched (no new rng draws).
- Acceptance: `npx vitest run tests/server/seasonal_persistence.test.ts tests/world_api_parity.test.ts tests/snapshots.test.ts && npx vitest run tests/parity`

### S4. Fair core: stalls, provisioning turn-ins, fair quests, NPC placements (with S3 = PR B)
- Goal: the fair exists in Lanternmere.
- Files: NEW `src/sim/content/harvest_fair.ts` (stall ground objects with
  wardstone-style channels and cosmetic zero-stat flavor buffs; Reeve Ottoline's
  provisioning order on the `repeatCadenceTicks` work-order pattern feeding the S3
  meter; fair quests; merged by `data.ts`); MODIFIED `src/sim/content/amberfall.ts`
  (stall props + fair NPC placements, ADDITIVE only), `src/sim/content/deeds.ts`
  (append fair deeds), `src/ui/sim_i18n.ts` + catalog + five non-Latin prose fills.
  NEW `tests/harvest_fair.test.ts` owns fair interaction behavior.
- Reused: interaction channel machinery, work-order cadence, existing fish/meat/
  produce item ids for turn-ins (NO new turn-in items). NEW: content records only.
- Tests FIRST: stall channel grants the flavor aura with zero stat effect; turn-in
  increments the realm meter and pays standard copper; turn-ins refused outside the
  window but nothing is lost; deeds append after every existing DEED_ORDER entry.
- Acceptance: `npx vitest run tests/harvest_fair.test.ts tests/deeds_content.test.ts tests/localization_fixes.test.ts tests/architecture.test.ts && npx vitest run tests/parity`

### S5. Fishing derby: catch-table row, tally, Caddow's book
- Goal: Mere catches count toward a lifetime derby tally during fairs.
- Files: MODIFIED `src/sim/professions/fishing.ts` (one fair-only table row per band:
  the Amberjack Gleamer, no-sell trophy; row weight active only while `fairOpen`),
  `harvest_fair.ts` (Caddow derby-book interaction at the jetty),
  `src/sim/content/deeds.ts` (derby deeds on the tally meter), deeds evaluator hook
  beside `onFishCaughtForDeeds`.
- Reused: the single-table-draw contract, `the_codfather` rare precedent, deed
  meters. NEW: one item id (English row plus maintainer release fill) + persisted lifetime tally.
- Tests FIRST: default offline worlds keep fair content OFF. On every path exercised
  by a parity scenario, fishing has no new draw AND no changed outcome. Separate
  opt-in fair tests pin the existing one-draw contract while exercising the fair
  row; tally accumulates across two simulated fair windows and never resets;
  Gleamer is no-sell; derby deed fires at thresholds.
- Acceptance: `npx vitest run tests/professions_fishing.test.ts tests/deeds_content.test.ts && npx vitest run tests/parity` (expect NO golden churn; see gotcha G3)

### S6. Lantern launch + meter-tiered town dressing (render; with S5 = PR C)
- Goal: the fair's screenshot moment plus the town visibly dressing up.
- Files: NEW `src/render/fair_dressing.ts` (meter-tiered props: bunting, jetty
  lantern strings, feast table; lantern-launch choreography on the festival-gold VFX
  palette the Vale Cup and deed bursts use); MODIFIED `harvest_fair.ts` (the 3 s
  lantern channel + launch attendance deed, published instants from
  `nextLanternLaunchAtMs`), English Gleamer item row from S5, wiki regeneration,
  credits/provenance for PR C assets; renderer composes the new module (never a method bank).
- Reused: VFX palette, channel machinery, S3 meter tier via IWorld. NEW: render
  module + launch deed.
- Tests FIRST (sim side): channel completes in 3 s, freely interruptible with no
  penalty; attendance deed grants once per launch; absence costs nothing. Render
  side: `npm run build` + screenshot evidence per the headless screenshot workflow.
- Acceptance: `npx vitest run tests/harvest_fair.test.ts tests/deeds_content.test.ts tests/architecture.test.ts && npm run wiki:content && npm run build`; committed screenshots under `docs/screenshots/`.

### S7. Fairground games: card tent desk + gourd roll
- Goal: two games, both trivially agent-completable.
- Files: MODIFIED `src/sim/content/card_master.ts` (fair desk placement, queue and
  duel logic UNCHANGED), `harvest_fair.ts` (gourd-roll stall: one channel + one
  seeded `ctx.rng` draw, `rollSkinRank` precedent, emote-line outcomes),
  `src/sim/content/deeds.ts` (fair-wins meter deed + zero-Renown luck deed).
- Reused: card_duel + card_duel_queue modules wholesale, rng draw pattern. NEW:
  placements and two deed records.
- Tests FIRST in `tests/harvest_fair.test.ts`: fair desk pairs players through the existing queue; gourd roll is one
  draw (parity-safe, inside fair-only code path); luck deed at 0 Renown; card-win
  deed ticks only on fair-desk wins.
- Acceptance: `npx vitest run tests/harvest_fair.test.ts tests/deeds_content.test.ts && npx vitest run tests/parity`

### S8. Skins, recipes (decision-gated), remaining deeds, locale fills (with S7 = PR D)
- Goal: the reward tail. Recipes ship ONLY if Levy approves parity consumables
  (open question 2); the lantern charm ships as a skin variant (question 3 decided v1).
- Files: MODIFIED `src/sim/content/skins.ts` (real fair event skins replacing the
  placeholder `EVENT_SKIN_TIERS` mapping, earned via the fair token),
  `src/sim/content/recipes.ts` (IF approved: 1-2 recipes reusing existing output
  item ids at exact parity), `deeds.ts` (capstone title "Lanternlight" + border
  slug), English rows for every new item id and M16 prose fills (five non-Latin),
  `CREDITS.md` for any new art, `npm run wiki:content` regen.
  NEW `tests/fair_rewards.test.ts` and `scripts/harvest_fair_agent.mjs`.
- Reused: EVENT_SKIN_TOKEN_ID, rollSkinRank, skin-select machinery, existing output
  item ids. NEW: fair token + skin item records (the i18n bill; budget the fill as
  its own task per `i18n-locale-fill`).
- Tests FIRST in `tests/fair_rewards.test.ts`: token drops only from fair activities; skins learnable across
  successive fairs (nothing expires); recipe outputs bit-identical to existing
  consumables; deed set complete and append-only.
- Acceptance: `npx vitest run tests/fair_rewards.test.ts tests/harvest_fair.test.ts tests/deeds_content.test.ts tests/i18n_completeness.test.ts tests/localization_fixes.test.ts tests/guide.test.ts && node scripts/harvest_fair_agent.mjs && npm run gate`

## 4. Gotchas (read before every slice)

- **G1, determinism is the whole point.** No wall clock in sim, ever: online windows
  arrive as host-supplied epoch ms. Offline fair content reads only the
  world-creation opt-in flag, default OFF. If a slice needs "is the fair open", it
  reads `SeasonWindowState`, never computes a date.
- **G2, SIM_LAP_PHASES is pinned.** Any new named phase in the server tick must be
  added to `SIM_LAP_PHASES` in `server/game.ts` or
  `tests/server/tick_perf_capture.test.ts` documents the dropped timing. Prefer
  folding the scheduler into an existing phase.
- **G3, parity goldens.** The fair-only fishing invariant is no new draw AND no
  changed outcome on any path a parity scenario exercises. Offline worlds default
  to fair content OFF, so offline goldens never shift. The S5 tests pin both the
  default path and the separate host-opt-in fair path. If a golden reds, fix the
  code, never `UPDATE_PARITY=1` an existing scenario.
- **G4, the item-i18n bill.** Every NEW item id costs an English catalog row plus a
  maintainer-owned release overlay fill. Mitigation is designed in: turn-ins and
  recipe outputs REUSE existing item ids; the only new items are the trophy fish,
  the fair token, and the skin records (S5/S8). Do not add others casually.
- **G5, deeds are append-only.** `DEED_ORDER` derives from table order; new deeds go
  at the end of `src/sim/content/deeds.ts`, never inserted, and land in the same
  change as their content per `docs/design/deeds.md`.
- **G6, graphics fairness for fair dressing.** Meter-tier props, bunting, and the
  lantern launch are cosmetic; every graphics preset may shed their richness but the
  fair must confer zero gameplay information or advantage at any tier
  (`docs/design/graphics-settings-fairness.md`).
- **G7, worktree discipline.** Other sessions carry uncommitted WIP; build each slice
  in a fresh worktree off the active release branch (fair slices off the #2321
  branch until it merges), branch `feature/seasonal-s<N>-<slug>`.
- **G8, realm state is one row and one writer.** Key exactly `seasonal:<realm>`;
  one live object on Sim; at most one write in flight plus one trailing dirty write.
  No per-turn-in query, no PlayerMeta copy, no derived timestamp in the save.
- **G9, boundaries do not scan characters.** Fair letters use per-character
  last-seen ids, lazy reconciliation on load, and an online-only boundary pass.
  The Friday peddler NPC and stall are derived from the fixture gate and have no
  per-character refresh state. Never query every character when a window changes.
- **G10, shared wire is serialized once.** Viewer-identical seasonal state uses
  `realmReadoutJson` from `server/realm_readout_memo.ts` plus `maybeRaw` in
  `server/game.ts`; a `maybe('fair', value)` call inside each session loop
  reintroduces avoidable stringify cost and is not acceptable.

## 5. Agent dispatch template (for later; do not dispatch yet)

Give one implementation owner the slice outcome, acceptance commands, relevant files,
section 0 ground rules (including the anti-FOMO rules verbatim), section 1 constants,
the applicable hook-map rows and gotchas. Require a diff summary, exact command
results, fails-before evidence for any bug-shaped test, and a clean handoff. Run the
`/qa` gate before merging each slice; S8 ends with the combined `npm run gate`.
