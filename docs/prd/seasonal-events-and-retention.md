# PRD: Seasonal events and retention, the Amberfall Harvest Fair and the weekly calendar

Status: DRAFT pass 1 (2026-07-25), for discussion with Levy. Numbers
marked (tuning) are proposals. The retention program the maintainer asked
for: cosmetic, social, and convenience rewards only; no daily-chore
psychology; agent-completable; a village fair, not a battle pass.

## One-line pitch

A recurring two-week harvest fair in Lanternmere on the Great Mere, plus
a published weekly fixture calendar: every week has a shape, every fair a
moment worth coming back for, and missing either costs only the fun.

## Portfolio alignment

- Proposed lane: fourth approval candidate, the support layer after a new tentpole, not
  yet Levy-approved.
- Protected identity: a published weekly rhythm, one shared fair meter, the fishing derby,
  and the lantern launch, all without FOMO.
- Scope rail: scheduler and calendar ship before fair content. Fair core ships before extra
  games, skins, or recipes. No streak, expiring currency, missable reward, or power gain may
  enter through a later slice.
- First schedule cut: recipes and additional fairground games go before the meter, derby,
  lantern launch, or anti-FOMO rules.
- Next-stage gate: Levy approves the schedule and civil-time policy. Fair slices also wait
  for PR #2321 and require PBE. The proposed portfolio position is not approval.

## Why retention content, and the anti-FOMO stance

Retention here means "there is a reason to log in this week that is warmer
than a lockout timer," never "a punishment for logging out." Hard rules:

- Rewards are cosmetic (skins, titles, deed borders), social (a shared
  spectacle, a realm meter), or convenience (a recipe at parity with
  existing ones). Never player power (docs/design/deeds.md rule 1).
- No streaks, no daily checklists, no expiring currencies. Everything
  returns every fair, forever: missing one costs fun, never an item.
- Agents are first-class players: every activity is a channel, a turn-in,
  or a published-schedule appointment. No reflex gates anywhere.
- Classic feel: stalls, lanterns, a derby, a town feast. Lanternmere runs
  on harvest labor, lamp tallow, and ferry lanterns; the fair is that
  town on its best week.

## The Amberfall Harvest Fair

A two-week window in Lanternmere and on the Great Mere, recurring every 8
real weeks (tuning). Hard dependency: the Amberfall zone ships only on the
new-realms branch (PR #2321, feature/procedural-dungeons); the fair stacks
on it and must not contradict the authored zone (Lanternmere, the Great
Mere, the Gilded Orchard, Harvest Hollow, and the resident cast: Reeve
Ottoline, Ferrymaster Caddow, Orchardist Pomeline, Waywatcher Sorrel).

### Fairground stalls

Six to eight fair stalls dress the market square and spill down to the
ferry jetty, reusing the ZonePropsDef stall records the town already has
two of. Each interactive stall is a ground-object interact with a short
readable channel (wardstone-style precedent, src/sim/interaction.ts): the
cider press, the sap-taffy kettle, the lantern dip, the produce table.
Channels grant purely cosmetic flavor buffs (a cider-warmth glow), zero
stats.

### The Great Mere fishing derby

Fishing is a full gathering profession (src/sim/professions/fishing.ts:
bite minigame, one-draw rng contract, proficiency catch bands, per-zone
tables), so the derby builds directly on it. During the fair, Mere
catches also count toward a personal derby tally and derby deeds;
Ferrymaster Caddow keeps the derby book at the jetty. One fair-only table
row per band adds the Amberjack Gleamer, a no-sell trophy fish used only
by the turn-in meter and derby deeds. Prizes are titles and a skin
unlock, never gear; the tally accumulates for life across fairs, so the
derby changes what a catch counts for, never what fishing yields, and no
single window is make-or-break.

### The lantern launch

The fair's signature social beat. On three published evenings per window
(opening night, middle weekend, closing night, realm-local 20:00, tuning),
Caddow's ferry crews stage a lantern launch: every player on the north
shore channels a fair lantern (3 s, freely interruptible) and releases it
onto the Mere, one shared render moment on the festival-gold VFX palette
the Vale Cup and deed bursts already use, deliberately the screenshot
every fair produces: the town relighting the water the Meredark chain
darkened. Attendance grants a deed; absence costs nothing.

### The harvest turn-in meter

The whole-realm progress bar. Reeve Ottoline posts a fair provisioning
order: players turn in harvest goods (existing fish, meat, and produce
item ids where possible) on the repeatable work-order pattern
(repeatCadenceTicks, WORK_ORDER_CADENCE_TICKS precedent in zone1's
q_prof_workorder_* records) at standard work-order copper. Every turn-in
also feeds one realm-shared fair meter with three thresholds; as it fills,
Lanternmere visibly dresses up (bunting, jetty lantern strings, a feast
table by the well), cosmetic props only. The meter resets each fair and
gates nothing; it exists so the realm decorates its own town.

### Fairground games

Two games, both reusing shipped systems (a Vale Cup exhibition was cut:
the Cup belongs to the Sowfield pitch; it gets a fixture day instead):

- The card tent: the Card Master (src/sim/content/card_master.ts) travels
  to the fair. A fair-side Card Duel desk reuses the matchmaking queue and
  duel logic (src/sim/social/card_duel.ts, card_duel_queue.ts) unchanged;
  only the desk placement is new. Fair wins tick a deed meter.
- The gourd roll: a stall lane game, one ground-object channel plus one
  seeded Rng draw (rollSkinRank precedent, src/sim/content/skins.ts), a
  pure luck flavor game with emote-line outcomes and a zero-Renown luck
  deed. Deliberately not skill-based, so trivially agent-completable.

## The weekly calendar

Scheduling plus a minimal surface, no new gameplay: a published weekly
rhythm so a returning player knows what is on today (days all tuning):

- Tuesday: reset day (existing 3 AM raid-lockout reset, unchanged).
- Wednesday: Vale Cup match day (the fixture book Groundskeeper Bram
  already keeps in fiction becomes a published day).
- Friday: market day: work-order cadence windows clear at open so every
  order is freshly available, plus a cosmetics-only visiting peddler
  stall. No payout changes (the payout fraction is an economy constant).
- Saturday: the low-tide Ferrywalk assault (the weekly event specced in
  docs/prd/farshore-odyssey-raid.md), once that PRD lands.
- Sunday: a featured Hunt window for the Pale Huntsman
  (docs/prd/pale-huntsman-worldboss.md). His Hunt rides its own short
  cadence all week; Sunday is the calendar-featured ride, not the only one.

Nothing here is exclusive or expiring; a fixture day is when a thing
reliably happens, not the only time it can. The v1 surface is the
noticeboard interaction plus a Ravenpost letter at fair open; a calendar
HUD window is a flagged dependency for a separate UI PRD.

## Rewards and deeds

- Titles and deeds, authored in the same change as their content per the
  deeds contract (append-only DEED_ORDER): derby deeds, the launch deed, a
  fair set with a capstone title ("Lanternlight", tuning) and a border
  slug. Renown quantized 5/10/25/50; luck deeds at zero Renown.
- Festival cosmetics via the shipped skin-select machinery: fair clothes
  as event skins from a fair token, replacing the dev-placeholder tiers
  skins.ts says await real event skins. A lantern charm ships v1 as a
  skin variant; a follower "shoulder pet" needs a vanity-pet system that
  does not exist, flagged NEW, deferred.
- One or two fair recipes producing convenience consumables at exact
  parity with existing outputs (recipes.ts precedent of reusing existing
  item ids). Learned at the fair, craftable year-round after. FLAG for
  Levy: cut these if even parity consumables read as power.

## Implementation notes: verified existing machinery, reused

All verified on origin/release/v0.30.0 by reading each module:

- Amberfall zone: src/sim/content/amberfall.ts (the #2321 branch only),
  hub, lakes, props, NPCs, and quest chains as cited throughout.
- Repeatable-quest cadence: src/sim/professions/cadence.ts (CadenceMap,
  WORK_ORDER_CADENCE_TICKS, persisted and clamped on load) driving zone1's
  work orders via repeatCadenceTicks. There is NO per-day daily-quest
  system in sim; this cadence primitive is the reuse target.
- Daily reset: server/raid_reset.ts computes realm-local civil boundaries.
  Seasonal code reuses that host-input boundary discipline, but NOT
  per-character `meta.raidLockouts`; the fair is realm-owned state.
- Noticeboards: src/sim/content/noticeboards.ts (one Eastbrook board under
  WorldContent authority). Town Focus is an interaction precedent only, not
  the persistence or shared-wire shape for the seasonal realm state.
- Realm persistence: server/db.ts owns the `world_state` JSONB store and
  realm-scoped `market:<realm>` / `mail:<realm>` wrappers. Seasonal state uses
  one `seasonal:<realm>` row and its own validated load/save wrappers.
- Shared wire: server/game.ts `realmReadoutJson` plus `maybeRaw` builds and
  stringifies viewer-identical state once per broadcast pass. Seasonal state
  uses that path, not a per-session `maybe()` stringify.
- Deeds: src/sim/content/deeds.ts + evaluator src/sim/deeds.ts (meters,
  flags, retro grants, onFishCaughtForDeeds); contract docs/design/deeds.md.
- Fishing: full profession as cited above (rare precedent the_codfather).
- Vale Cup: src/sim/content/vale_cup.ts + social/vale_cup.ts (fixtures,
  bots, festival-gold VFX). Fiesta, checked as requested, is a 2v2 arena
  format (social/fiesta.ts), not a seasonal event; nothing here uses it.
- Mail: src/sim/content/letters.ts + the PostOffice, letterId client
  localization; the fair-open letter reuses it.
- Skins: src/sim/content/skins.ts event token + rank roll.

## Genuinely NEW pieces, flagged

1. The seasonal/fixture window scheduler: one small SimContext module
   (src/sim/events/season_schedule.ts) deriving open windows from host-supplied
   civil-time inputs; offline gets a deterministic sim-tick fallback cadence.
2. The seasonal realm save: one versioned `SeasonalRealmSave` in
   `world_state` under `seasonal:<realm>`, with boot load, coalesced save,
   shutdown drain, validation, and boundary reconciliation. The live object
   exists once on `Sim`, never in `PlayerMeta` or character blobs.
3. The realm-shared fair meter: one field in that save plus a small shared
   wire field and its ClientWorld mirror (IWorld extension first).
4. The lantern-launch choreography and meter-tiered town props (render
   side, VFX reuse).
5. Fair catch-table row, stall ground objects, quests, deeds, skins: all
   pure content in existing tables.

## Realm persistence and lifecycle contract

`SeasonalRealmSave` is a versioned, realm-owned document. Persist the minimum
mutable state: `{ version, fairId, meter }` plus future explicitly versioned
seasonal counters. `meter` is a finite non-negative integer saturated at the
final threshold, 1500 in the proposed tuning. `fairId` is derived from the fair
opening instant, schedule version, and realm time zone. Do not persist derived
open/close/fixture timestamps; recompute them from host inputs at boot.

The v1 schedule proposal is version 1, first opening 2026-09-18 20:00 in
each realm's configured civil time, then every 8 calendar weeks. Calendar-week
arithmetic uses the realm time zone and the same DST conversion policy as raid
reset, never an elapsed-millisecond interval. The stable id is
`v<version>:<realmTimeZone>:<openingEpochMs>`; any anchor or cadence change
increments the schedule version.

Load once before the server accepts traffic. Sanitize unknown versions,
non-finite values, negative values, and values above the cap. Reconcile the
loaded `fairId` against the host-derived current fair: retain the meter for the
same fair, reset it for the next fair, and choose the correct current window
after downtime. Corrupt or impossible documents fall back to an empty current
fair and log a bounded diagnostic.

Save through one serial/coalescing writer in `GameServer`: at most one seasonal
write in flight and one trailing write for newer dirty state. The 30-second
autosave may flush dirty state, but turn-ins never call the database directly.
Also flush on fair boundaries and meter thresholds, then drain the writer on
shutdown before the pool closes. Failed writes leave state dirty for retry.
Expose aggregate save age, dirty revision, and last-failure status through the
existing internal performance/health surface without realm payload contents.

Fair-open letters and Friday work-order refreshes are per-character effects,
not realm scans. Store `lastFairLetterId` and `lastMarketRefreshId` on each
character, reconcile lazily when that character loads, and update online
characters at the boundary. Never scan the character table at a seasonal
boundary.

## i18n scope, priced honestly

Prose-heavy. Fair quest and letter prose needs the five non-Latin locales
(zh_CN, zh_TW, ja_JP, ko_KR, ru_RU) in the same change per the M16 gate.
Every NEW item id (trophy fish, fair token, recipes, skin items) needs an
English catalog row in its contributor PR and a maintainer-owned overlay fill
before release, which is why the design reuses existing item ids where it can. Deed text
re-localizes client-side; sim-emitted event text ships as stable keys via
the sim_i18n matcher in the same change (S3 guard). Budget the locale
fill as its own task per content PR.

## Staged PR plan and rollout

Per the contribution process: conversation with Levy on this PRD first,
then the staged order below, then a PBE round for the fair before any
release. Calendar PR A is technically independent and may land ahead of
the fair only after Levy selects this portfolio slot; independence is not
authorization.

1. PR A (no Amberfall dependency, first within this program): the scheduler module,
   versioned seasonal realm save and full server lifecycle, calendar data,
   lazy per-character market/letter reconciliation, noticeboard surface,
   shared wire seam, and tests.
2. PR B (needs #2321): fair core: stalls, turn-in meter, fair quests and
   NPC placements, fair deeds, English catalog rows, and M16 fills.
3. PR C: derby plus lantern launch, their deeds, VFX, screenshot evidence.
4. PR D: games, skins, recipes (if approved), remaining deeds and titles.

## Acceptance criteria

- Determinism: no wall clock or Math.random in sim; windows host-supplied
  or tick-derived; architecture and parity tests green.
- Three hosts: identical behavior offline, online, headless; IWorld
  extended before any render/ui consumption; meter mirrored in ClientWorld.
- Persistence: same-fair restarts preserve the meter; next-fair and downtime
  reconciliation reset exactly once; two realms never share state; malformed
  saves sanitize; failed writes retry; the writer queue stays bounded.
- Database cadence: zero queries per turn-in, one realm-row read at boot, and
  coalesced writes only at autosave, boundary, threshold, or shutdown flushes.
- Operations: seasonal save age and failure state are observable without
  exposing saved payloads or player data.
- Shared wire: one stringify per changed realm readout, fresh joins receive the
  current value, and unchanged state emits no repeated payload.
- Agent-completable end to end: every reward reachable via channels,
  turn-ins, and scheduled attendance; no reflex gates (bot run as proof).
- Zero power: no stat, gold-positive, or combat-time reward anywhere;
  graphics-fairness rule holds for all fair dressing.
- i18n gates green at PR tier; maintainers complete remaining overlays before
  the release-tier gate.

## File plan (build reference)

Files ADDED:
- `src/sim/events/season_schedule.ts` behind SimContext (the window
  scheduler) + `tests/season_schedule.test.ts`.
- `tests/server/seasonal_persistence.test.ts`: realm isolation, boot/load,
  coalescing, retry, shutdown drain, query count, and boundary reconciliation.
- `src/sim/content/harvest_fair.ts`: fair quests, stall ground objects,
  the provisioning order records, derby table row, fair token/skin item
  records, and the fair-open letter (merged by `data.ts`).
- `src/render/fair_dressing.ts` (meter-tiered town props, lantern-launch
  choreography on the festival-gold VFX palette).
- The calendar data table (inside `season_schedule.ts` or a sibling
  `src/sim/content/event_calendar.ts`).

Files MODIFIED:
- `src/sim/sim.ts` (scheduler tick, one live `SeasonalRealmState`) and
  `server/game.ts` (SIM_LAP_PHASES decision, host civil-time input, seasonal
  dirty/coalesced writer, load/save lifecycle, `realmReadoutJson` + `maybeRaw`).
- `server/db.ts` (typed `seasonalStateKey`, `loadSeasonalState`, and
  `saveSeasonalState` wrappers over `world_state`) and `server/main.ts` (load
  before listen, shutdown drain before pool close).
- Character state serialization for `lastFairLetterId` and
  `lastMarketRefreshId`, reconciled lazily on character load and for online
  characters at boundaries, with no database-wide character scan.
- `src/world_api/` facet for the meter + open-window state, both worlds
  (`src/net/online.ts` mirror), `tests/world_api_parity.test.ts` pins.
- `tests/snapshots.test.ts` pins for fresh-join delivery and unchanged shared
  payload elision.
- `src/sim/professions/fishing.ts` zone table (the Amberjack Gleamer
  row), `src/sim/content/skins.ts` (event skins replacing the
  placeholder tiers), `src/sim/content/card_master.ts` (fair desk
  placement), `src/sim/content/letters.ts`, `src/sim/content/deeds.ts`
  (append) + `tests/deeds_content` pins.
- `src/sim/content/amberfall.ts` (branch #2321 file): stall props and
  fair NPC placements only, additive.
- `src/ui/sim_i18n.ts` (event text keys), `src/ui/i18n.catalog/` +
  English item rows plus five non-Latin overlays for M16 prose, regenerated
  resolved files; noticeboard content record; `CREDITS.md` for any new
  art; guide regen.

## Open questions for Levy

1. Fair schedule: approve the v1 proposal (first open 2026-09-18 20:00
   realm-local, then every 8 calendar weeks), or choose an annual autumn
   anchor (more classic, much less retention surface)?
2. Fair recipes at convenience parity: acceptable, or cut crafting to zero?
3. Lantern follower cosmetic: fund a small vanity-pet system later, or is
   the skin-variant version the permanent answer?
4. Offline worlds: fair always-on, or the tick-cadence fallback windows?
5. The Sunday Hunt slot: confirm featuring the Pale Huntsman's ride on the
   calendar (his PRD gives the Hunt its own 3-hour cadence (tuning); the
   calendar entry is presentation, not a schedule change).
