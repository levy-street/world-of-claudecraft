# Arena seasons and the Warmaster titles

The Ashen Coliseum runs in **seasons**: six-month competitive windows that close
with a title for the realm's best. One title per season, worn by both champions
of it, the highest-rated 1v1 duelist and both members of the highest-rated 2v2
pair. Season 1 awards the bare **Warmaster**; every season after it takes an
epithet on the same line.

This page is the system in brief plus the decisions a reviewer should not have to
re-derive from the code.

## Vocabulary

| Term | Meaning |
|---|---|
| Season | A six-month competitive window, numbered from 1. Preseason is everything before Season 1 opens. |
| Settlement | The server-side act of closing a season: reading the standings, deciding the champions, writing the awards, and stamping the exactly-once marker. |
| Entrant | A character who fought at least one ranked bout in a season and bracket. Only entrants can win that season. |
| Pair | Two characters who fought a ranked 2v2 bout together in a season. The 2v2 bracket crowns a pair, not two individuals. |

## The title roster

Ten seasons are planned, authored in `src/sim/content/arena_seasons.ts` and
pinned by `tests/arena_season.test.ts`:

| Season | Title | Season | Title |
|---|---|---|---|
| 1 | Warmaster | 6 | Merciless Warmaster |
| 2 | Glorious Warmaster | 7 | Ruinous Warmaster |
| 3 | Malevolent Warmaster | 8 | Sovereign Warmaster |
| 4 | Ashen Warmaster | 9 | Undying Warmaster |
| 5 | Drowned Warmaster | 10 | Immortal Warmaster |

Seasons 4 and 5 name the Coliseum's own two maps (the Ashen Coliseum and the
Drowned Court). The table is append-only for the same reason `DEED_ORDER` is: a
settled season is persisted by NUMBER, so editing an entry retroactively changes
what an awarded title meant. The calendar keeps counting past Season 10; a
closed season with no authored record settles nothing and logs that it was
skipped, which is the maintainer's cue to extend the roster.

## Architecture

- **One shared calendar.** `src/sim/arena_season.ts` is a pure leaf: every entry
  point takes the instant (UTC epoch milliseconds) as an argument and is a pure
  function of it. The server settles against it and the client renders its
  countdown against it, so a boundary cannot disagree between them. Month
  arithmetic is UTC calendar arithmetic, so a season always opens at 00:00 UTC on
  the first of a month. `ARENA_SEASON_EPOCH_MS` is the single maintainer knob;
  moving it after a season has settled would re-point a persisted season number
  at a different window.
- **The titles are Book of Deeds feats.** Each season's title is the reward of a
  `feat_arena_season_*` deed. Feats because a closed season can never be earned
  again (`docs/design/deeds.md` rule 5), which also makes them zero-Renown (rule
  2), so the Renown board never depends on who happened to be playing in a given
  half-year. Their trigger is `manual`: no per-character predicate can decide a
  realm-wide ranking.
- **The server decides, the sim grants.** A champion is a realm-wide ranking over
  every character, online or not, at a real-world instant; the sim sees only the
  players in its own world and has no wall clock. So `server/arena_season_settlement.ts`
  decides, persists the award, and the join handler replays the awarded deed ids
  into `Sim.addPlayer`, where `grantArenaSeasonTitlesForDeeds` grants them through
  the existing `grantDeed` path. The sim remains the only thing that writes a
  deed. This is the same division of labour as the bank-bonus entitlement and the
  daily raid reset: off-sim facts are computed on the server and handed in.
  The grant is gated on the season roster, so a bad host row can never mint an
  arbitrary deed, and it is idempotent, so the server re-passes the same set on
  every login without effect.
  A champion who is ONLINE when their season settles is granted in place through
  the settler's `onAwarded` hook (`GameServer.grantArenaSeasonTitles`), so the
  boundary does not make them relog for the title they just won. That hook is
  optional and best-effort by design: the ledger is the authority, so a host that
  wires nothing there, or a delivery that throws, loses no award.
- **Wearing the title uses the existing system.** A season title is selected in
  the Book of Deeds title picker like any other, and shows on nameplates, in
  chat, on the target frame, the character panel, and the boards. No new display
  path was added.

## Settlement

Four tables, all in `server/arena_season_db.ts` (`ARENA_SEASON_SCHEMA`):

| Table | What it holds | Growth |
|---|---|---|
| `arena_season_entrants` | who fought, per season and bracket | with play; pruned by the nightly retention sweep |
| `arena_season_partners` | which duos fought together, per season | with play; pruned with the entrants |
| `arena_season_titles` | the award ledger | at most three rows per season per realm; never pruned |
| `arena_season_settlements` | the exactly-once marker | one row per settled season per realm; never pruned |

`arena_season_partners` exists because 2v2 Elo is stored per CHARACTER: without
a record of who played with whom there is no such thing as a pair to rank. One
row per duo per bout is written by exactly one of the two teammates (the lower
character id is elected), because both report the same bout with the other as
their ally.

The driver polls the calendar, asks which closed seasons are still unsettled,
and commits each one. Its guarantees:

- **Exactly once, across processes.** The awards and the settlement marker are
  written in one transaction, and the marker's primary key is the arbiter. Two
  realm processes racing the same season means the loser rolls back having
  written nothing.
- **Catch-up.** A realm that was down across several boundaries settles them in
  order on its next boot.
- **Deterministic ties.** Two characters really can share a rating, so the picker
  falls through explicit tie-breaks rather than trusting row order: 1v1 by rating,
  then lifetime wins, then bouts fought this season, then name; a pair by combined
  rating, then bouts fought together, then the pair's names.
- **An uncontested season still settles.** A season nobody entered writes its
  marker with no awards, so it is not re-read forever.

## Two decisions worth naming

**Ratings do not reset between seasons.** The all-time ladder is untouched: a
season is a window with a title at the end of it. What makes a champion the
champion OF that season is the entrants gate (they must have fought a ranked
bout inside the window), not a fresh ladder. A seasonal soft reset is a much
larger change (matchmaking, the rating deeds, the character sheet, the public
ladder, daily rewards all read the stored rating) and is deliberately left as a
separate decision.

**Standings are read at settlement time, not sampled at the closing instant.** A
realm that was down when a season closed settles on its next boot against
ratings that have moved slightly. Sampling the exact instant would require a
per-tick snapshot of every character's rating, which is a far larger and more
fragile machine than the outcome justifies.

## The player-facing surface

The Ashen Coliseum window opens with a season banner: the live season and the
title it will award, a countdown and progress meter, and the settled champions
below it. The countdown needs no server round trip (the calendar is shared code,
so the client derives it from its own clock); only the champions come from
`GET /api/arena/seasons`, which is anonymous, cache-fronted, and degrades to the
countdown alone if the read fails.

## Extending the roster

Before Season 10 closes: append records to `ARENA_SEASONS`, add the matching
`feat_arena_season_*` deeds at the END of the `DEEDS` table
(`docs/design/deeds.md`, "Adding a deed"), and update the catalog pins in
`tests/deeds_content.test.ts` and `tests/arena_season.test.ts`. Nothing else
changes: the calendar, the settlement, and the banner all read the roster.
