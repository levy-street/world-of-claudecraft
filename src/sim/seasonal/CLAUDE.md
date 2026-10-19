<!-- src/sim/seasonal/: the reusable seasonal-event core. Sim-wide rules
     (determinism, SimContext, the coordinator) live in ../CLAUDE.md. -->

# src/sim/seasonal/ : seasonal events

A small, reusable core for limited-time world events (the autumn Gourdlight Eve
first; winter reuses it). Event DATA lives in `src/sim/content/` (one file per
event, e.g. `gourdlight_eve.ts`); this directory holds the rules. Public surface:
`index.ts`.

## The one rule: the sim never decides the date
- The authoritative server owns the calendar (`server/seasonal_calendar.ts`, UTC
  windows, overridable by `SEASONAL_EVENT_WINDOWS`) and writes the active event id
  into `SeasonalWorldState.hostEventId` every tick through the realm-calendar feed
  (`server/sim_calendar_feed.ts`).
- Offline and headless worlds feed nothing, so every event is OFF there unless
  `/dev season on` sets `devOverride`. No `Date`, no wall clock, anywhere here.
- `activeSeasonalEventOf` is the only read of "what runs now"; the client mirrors
  it as `IWorldSeasonal.activeSeasonalEvent` (offline: the Sim getter; online: the
  `season` self key).

## Modules
| Module | Owns |
|--------|------|
| `seasonal_state.ts` | world state (host id, dev override, open/close edge), per-character ledger (`seasonalDay`, `seasonalKnocked`, `pumpkinHeadWorn`), save fragment + sanitizing restore, the day roll on `ctx.resetDay` |
| `seasonal_tick.ts` | `updateSeasonal`: raises / dismisses each event's keeper NPC (reserved singleton id), strips every seasonal cosmetic on close, re-applies a worn pumpkin head. Zero rng |
| `haunted_pumpkins.ts` | fixed event-only objects, personal once-per-edition discovery and cosmetic completion Feat; no RNG or entity allocator draws |
| `trick_or_treat.ts` | the knock: once per NPC per reset day, treat (sweets) or trick (cosmetic aura + one sweet), credits the rounds quest's `event` objective. Draws world rng only on an accepted knock |
| `seasonal_cosmetics.ts` | the `seasonal_cosmetic` auras (pumpkin head, tricks): no sim effect at all, `undispellable` so only their own item / timer removes them |
| `seasonal_items.ts` | item use arms: pumpkin head toggle, Jar of Mischief, the treat pouch |
| `seasonal_quests.ts` | seasonal quests close with their event through the shared repeat-blocked set |
| `scarecrow.ts` (bedtime) | by day, the idle-mob throttle (mob/idle_tick_skip.ts) skips an awake, aura-less boss nobody is near, so `updateScarecrow` hands his bedtime to `settleUnwatchedSlumber` (mob/slumber.ts): idle, due and unwatched, he is put straight back on his pole, so nobody riding in can catch him awake by day. Cheap gates first, one boss per tick |
| `scarecrow_field_ward.ts` | while Gourdlight Eve runs, idle wild mobs keep out of Old Thatchgrin's field (wander targets pushed onto its rim, crossings skirted). Zero rng, never touches Boar Meadow outside the event |
| `seasonal_cancel.ts` | right-click cancel of a worn cosmetic (costume, trick, guise, pumpkin head) through the authoritative `cancelAura` (combat/aura_cancel_command.ts); clears the worn-head ledger flag |
| `scarecrow_puppet.ts` | Thatchbound, Old Thatchgrin's mind control: victim choice (never his tank, never alone), the cast bar and marks, the puppet's walk (the player-movement hook) and its soft swing as HIS damage, the ways out. Rng only on a cast start and per landed swing |
| `gourdlight_dailies.ts` | the rotating dailies (records: `content/gourdlight_eve_dailies.ts`): the day's errand from `ctx.resetDay` (civil day number mod the pool, never a clock), the off-day errands joining the shared blocked set (`seasonal_quests.ts`), the errands' world pieces (patch pumpkins, cursed candles; reserved negative ids, sites from `src/sim/seasonal_daily_sites.ts`), the per-town knock credit and the costumed BOO (ledger key `boo_<npc>` in the day's knock ledger). Zero rng |
| `knock_or_boo.ts` | the one townsfolk verb (`IWorldSeasonal.trickOrTreat(npcId, boo?)`): a knock, or the Boo! daily's fright |
| `gourdlight_deed_marks.ts` | the whole-event Book of Deeds checklist (round 12): writes the lifetime `gourdlight:*` visited marks (content/gourdlight_eve_deeds.ts) at a knock, a landed Boo! (per town), an errand turn-in and the pumpkin hunt's last find (the Thatchgrin kill marks in deeds.ts's world-boss hook), plus the silent join refill from proof (questsDone, the kill counter, the Pumpkin Hunter feat). Lifetime marks, so progress survives reset days and editions. Zero rng |
| `seasonal_dev.ts` | `/dev season [on [event]|off|auto|knocks|daily [1-6|id|next|auto|reset]]` (ALLOW_DEV_COMMANDS only) |

Indoor pumpkins (purely decorative, never the hunt) are found inside the walk-in houses
by `src/sim/seasonal_interior_pumpkins.ts` (on a furniture top that fits, or snug on the
floor; walled on four sides; off the door line), pinned by
`tests/seasonal_interior_pumpkins.test.ts`; the decor view draws them with the street list.

City decorations are presentation: the anchor rules live in
`src/sim/content/gourdlight_eve_decor.ts`, the placement resolver (anchors to lamps,
NPCs and town hubs, rejects or nudges anything overlapping a collider or standing
on a road) in `src/sim/seasonal_decor_layout.ts`, pinned against the live world by
`tests/seasonal_decor_layout.test.ts`; the renderer draws the resolved list. The solid
pieces (stalls, hay bales, big lit pumpkins, corn shocks) also COLLIDE while the event
runs: `src/sim/seasonal_decor_colliders.ts` builds them off the same resolved list into
one gated set of the static collider grid (`setColliderGateOpen`), re-applied every tick
at construction and the top of every tick by `src/sim/world_gates.ts` (beside the ferry
berths) and on every `season` change by the online mirror (built-in world only); the boss
field ring stays open; pinned (never on a
road, never cutting a town off) by `tests/seasonal_decor_colliders.test.ts`.

Road lanterns (a carved pumpkin hung from a short crook post on the verge, every 30 to
50 yd, alternating sides) light the roads between the event cities and the road to Old
Thatchgrin's field: the routes are data (`GOURDLIGHT_ROAD_LANTERNS` in
`src/sim/content/gourdlight_eve_decor.ts`, city or field ends, never coordinates), the
resolver `src/sim/seasonal_road_lanterns.ts` walks the live road polylines and seats each
post on the verge band clear of colliders, trees, water, bridges, towns and the field;
cosmetic and never solid. Pinned by `tests/seasonal_road_lanterns.test.ts`; drawn by the
decor view in ranged runs (`src/render/seasonal_road_lanterns_core.ts`).

Fairness and replay rules:
- A trick body (bat, skeleton) hides class, weapon and casts, so the Jar refuses in
  combat and `updateSeasonal` strips a running trick the tick its body enters combat.
  Cosmetic auras stay off raid frames (`PARTY_FRAME_EXCLUDED_KINDS`).
- The worn head follows ownership: a character who no longer holds the item (bags or
  bank) loses the flag, so a destroyed head is never stuck on.
- Opening an event adds the keeper entity and cosmetic auras (draw-order inputs), so
  a recorded server trace that crosses an open or close only replays with the same
  `hostEventId` feed, the same contract as `resetDay`.

## Adding the next event
1. A content file with the event id, keeper `NpcDef` (dynamic, reserved id), items,
   quests (`seasonalEvent` + `repeatable` + `dailyReset`), decor rules.
2. A row in `EVENT_KEEPERS` (`seasonal_tick.ts`) and a window in
   `server/seasonal_calendar.ts`.
3. Everything stays cosmetic: no stat, no power, no consumable a fight can read.
