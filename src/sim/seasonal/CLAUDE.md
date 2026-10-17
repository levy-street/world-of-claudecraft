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
| `trick_or_treat.ts` | the knock: once per NPC per reset day, treat (sweets) or trick (cosmetic aura + one sweet), credits the rounds quest's `event` objective. Draws world rng only on an accepted knock |
| `seasonal_cosmetics.ts` | the `seasonal_cosmetic` auras (pumpkin head, tricks): no sim effect at all, `undispellable` so only their own item / timer removes them |
| `seasonal_items.ts` | item use arms: pumpkin head toggle, Jar of Mischief, the treat pouch |
| `seasonal_quests.ts` | seasonal quests close with their event through the shared repeat-blocked set |
| `seasonal_dev.ts` | `/dev season [on [event]|off|auto|knocks]` (ALLOW_DEV_COMMANDS only) |

City decorations are presentation: the anchor rules live in
`src/sim/content/gourdlight_eve_decor.ts`, the placement resolver (anchors to lamps,
NPCs and town hubs, rejects or nudges anything overlapping a collider or standing
on a road) in `src/sim/seasonal_decor_layout.ts`, pinned against the live world by
`tests/seasonal_decor_layout.test.ts`; the renderer draws the resolved list.

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
