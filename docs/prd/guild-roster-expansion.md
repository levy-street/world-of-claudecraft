# Guild Roster Expansion

Status: implemented for release/v0.42.0. Owner ask captured 2026-09-04: Guild
Masters can buy a larger guild for gold, 20 gold for the first 20 seats, scaling
from there, with 500 seats costing a ridiculous amount. Amended 2026-09-05: the
ladder keeps going past 500 seats at ever more gold, hard-capped at 1,000 seats
to be safe; then re-priced to a 40 gold first page, 1,000 gold for the first
hundred extra seats, and rapid growth after that.

## Why

Every guild seats 100 members from its founding, and nothing a guild does can
change that. A guild that outgrows the base roster has to turn people away or
split, which is the opposite of what a guild is for. Expansion turns the cap
into a goal: a gold sink that only the guilds with the most players ever pay,
scaled so that the last seats are a realm-notable achievement.

## The angle: charter pages

The roster grows in 20-seat PAGES, bought one at a time by the Guild Master.
The first five pages (100 to 200 seats) are a flat ramp: 40 gold, then 80 gold
more per page (120, 200, 280, 360), so the first hundred extra seats cost a
round 1,000 gold. Every page after that costs 30% more than the one before it,
rounded to whole gold, which is what runs the price away past 200 seats.

| Page | Seats after | Page price  | Cumulative  |
| ---- | ----------- | ----------- | ----------- |
| 1    | 120         | 40g         | 40g         |
| 2    | 140         | 120g        | 160g        |
| 3    | 160         | 200g        | 360g        |
| 5    | 200         | 360g        | 1,000g      |
| 10   | 300         | 1,335g      | 5,228g      |
| 15   | 400         | 4,958g      | 20,927g     |
| 20   | 500         | 18,409g     | 79,214g     |
| 25   | 600         | 68,354g     | 295,638g    |
| 30   | 700         | 253,793g    | 1,099,207g  |
| 45   | 1,000       | 12,990,618g | 56,292,114g |

Selected pages only: the cumulative column sums every page up to that row,
including the ones the table skips (pages 16 to 19 alone total 39,878 gold,
which is why 20,927 jumps to 79,214 rather than to 39,336).

Why a flat ramp and then compounding, rather than the square this shipped with
first or the doubling the bank ladders use: the owner's bars were a 40 gold
first page, about 1,000 gold for the first hundred extra seats, rapid scaling
after that, and nothing meaningfully past 500 seats reachable with the realm's
whole gold supply. A square from 40 gold puts 200 seats at 2,200 gold; a pure
doubling either makes 300 seats almost free or 400 seats impossible. The ramp
hits 1,000 gold on the nose, and 30% per page after it puts 500 seats at 79,214
gold (over half the gold in circulation, and the largest single gold sink in the
game: the priciest existing bank rung is 120 gold) and 600 seats at 295,638,
twice the realm's supply, so 540 seats was the most any guild could reach with
the gold in circulation when this shipped.
The whole table is one data-as-code constant (`GUILD_ROSTER_PAGE_PRICES` in
`src/sim/guild_roster.ts`) built from four numbers with integer arithmetic, so
every host computes the identical table and the curve is a four-number
change; `tests/guild_roster.test.ts` pins the rule and the totals.

## The hard cap: 1,000 seats

The ladder does not stop at 500. It runs to 45 pages (1,000 seats), and the
compounding is what makes everything meaningfully past 500 unreachable rather
than a rule: 600 seats is 295,638 gold in total and 700 seats is 1,099,207, far
more than the whole gold supply in circulation on the realm when this shipped
(on the order of 150,000 gold). The cap itself (`GUILD_ROSTER_MAX_MEMBERS`) is an engineering
bound, chosen at the realm's concurrent-player target so a single guild can
never outgrow what the server is sized for: the rename fan-out, the admin
backoffice reads, the page compare-and-set, and the world map's label budget
are all bounded by it. If the economy ever grows past the curve, the cap is
still one constant.

## Who pays, and from where

The Guild Master pays from their OWN purse, the guild creation fee precedent.
Not the treasury, deliberately: the roster lives in the server social DB, and a
treasury-paid page would have to run through the guild bank's escrow ledger
(op log, replay, audit) for a mutation the bank never sees. A guild that wants
to pool gold withdraws it from the treasury to the Guild Master first, which the
bank already supports.

The purchase and the payment are ONE durable write, the paid guild creation's
shape (`server/guild_create_db.ts`), because the first cut was not: it charged
the live purse, wrote the page with the pool, and persisted the purse through
a later character save, so a crash, a lease takeover, or a fenced-out save
between the two writes left a page bought and never paid for, and a lost
database answer after COMMIT was refunded as if the page had not landed.

1. The service reads the guild row (`guildMembership` carries `rosterPages`)
   and prices the NEXT page from the ladder by pages already bought. The
   client-shown price is never trusted.
2. The coordinator (`server/guild_roster_transport.ts`) runs the rest as a job
   on the buyer's character save FIFO, so nothing else can serialize or save
   that character while it runs: it charges the live purse synchronously
   (`chargeGuildRosterPage`; a short purse is refunded and refused with the
   price), then captures the exact post-charge snapshot.
3. One lease-fenced transaction (`server/guild_roster_page_db.ts`) commits the
   compare-and-set on `guilds.roster_pages`, a receipt row keyed by the
   purchase (`guild_roster_receipts`), and the snapshot itself. The
   compare-and-set also re-checks the buyer still holds the leader rank: a
   double-click, a second client, or a demotion racing the purchase pays for
   one page at most; the loser is refunded and told to retry from the fresh
   price. The stored count is compared floored, the same load path the price
   came from, so a tampered negative column cannot turn into a
   charge-and-refund loop. A save that misses its lease fence rolls the page
   and the receipt back with it.
4. Outcomes: a known refusal (short purse, stale count, guild gone, a write
   that provably rolled back) refunds the live purse and answers. A lease
   lost at COMMIT means another session owns the character, so the live copy
   is abandoned and disconnected. A COMMIT whose answer was lost is checked
   against the receipt: a matching row proves the page landed; no row after
   the bounded looks is AMBIGUOUS, and an ambiguous purchase is never
   refunded (that would pay the buyer twice if the page landed): the live
   session is quarantined and kicked so durable truth stands when they log
   back in, the market escrow's treatment of its own unknown COMMITs.
5. On a known commit the coordinator writes one audit line naming the guild,
   the page, the buyer, the copper, and the receipt key, and acknowledges the
   save's effect prefix. Every online member sees the success line; the
   snapshot re-pushes with the new cap. Any throw once the write may have run
   (the acknowledgement included) is treated exactly like an unknown COMMIT:
   the live copy is abandoned, never left to carry an unproven purse into its
   next autosave. A throw before the write refunds and rethrows so the
   dispatcher logs the cause; the `retry` refusal rethrows the same way.
6. Bounds: one purchase per character is in flight at a time (a repeated
   command answers nothing; the first one answers for itself), the wait for
   the character's save slot is capped (`GUILD_ROSTER_PURCHASE_QUEUE_WAIT_MS`;
   un-started work past it is cancelled with nothing charged and the buyer is
   asked to retry), and the pool checkout rides the realm's one
   major-background gate with the abort-aware checkout the paid guild create
   uses, so purchases compose under the same budget as autosaves.

Operator note: the receipt is reconcile evidence, not the ledger (the audit
line is; the row cascades away with its guild or its character), and
`(guild_id, page)` is deliberately NOT unique, so lowering a guild's
`roster_pages` to compensate a player needs no receipt cleanup. Nothing yet
detects a guild whose `roster_pages` and receipt count have diverged; an
operator readout for that is a follow-up.

Every refusal is a code the client localizes (`guildRosterResult`, the
billboard convention), never server English.

## Where the cap is enforced

The cap is per guild: `guildRosterCap(rosterPages)`. The invite gate reads it
from the membership row; the atomic seat (`addGuildMemberAtomic`) reads
`roster_pages` from the guild row under the same `FOR UPDATE` lock as the seat,
so a page landing between a caller's snapshot and the seat is honoured and no
caller-supplied limit exists any more. The admin backoffice pages the roster at
the absolute ceiling (`GUILD_ROSTER_MAX_MEMBERS`, 1,000) and bounds the rename
fan-out by it.

## What the player sees

The Guild tab shows the roster count against the guild's cap ("37 of 100
seats"). The Guild Master sees an "Expand roster (+20 seats for 20g)" button in
the tab footer that opens the shared confirm prompt (the gold is theirs and is
not refunded); once the ladder is complete the button reads "The roster is at
its largest size" and is disabled. Everyone else sees only the count.

## Follow-ups (not in the first change)

- Admin dashboard: surface the bought cap on the guild detail page.
- A treasury-paid option, if wanted, needs a guild bank ledger op and belongs
  in a guild bank phase.
- The world map's label-sprite budget was raised to cover a 1,000-seat guild
  entirely online (`TEXT_SPRITE_LIMIT`, about 27MB of canvas backing store in
  that pathological case); measure on low-end mobile if such a guild ever
  exists.
