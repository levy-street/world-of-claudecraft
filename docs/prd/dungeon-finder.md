# Dungeon Finder

## Objective

Add a realm-local dungeon group finder inspired by classic MMO group tools. It supports both
automatic role matchmaking and leader-managed group listings. It creates a party or raid only.
It never teleports players, moves characters, or enters an instance for them.

The feature must cover every authored dungeon activity in the current release, including normal
and heroic five-player dungeons, the Nythraxis raid, and the solo attunement crypt. The window is
a premium dark-fantasy surface that previews encounters, boss loot, level requirements, entrance
location, difficulty, and lockouts without adding a continuous rendering cost to gameplay.

## Product rules

### Activities and level eligibility

| Activity | Difficulty | Eligible levels | Automatic composition |
| --- | --- | --- | --- |
| The Hollow Crypt | Normal | 7 to 10 | 1 tank, 1 healer, 3 DPS |
| The Sunken Bastion | Normal | 12 to 13 | 1 tank, 1 healer, 3 DPS |
| The Drowned Temple | Normal | 16 to 18 | 1 tank, 1 healer, 3 DPS |
| Gravewyrm Sanctum | Normal | 19 to 20 | 1 tank, 1 healer, 3 DPS |
| Abandoned Crypt | Normal | 20 | No automatic queue |
| Nythraxis Raid Arena | Normal | 20 | 2 tanks, 2 healers, 6 DPS |
| Every supported heroic dungeon or raid | Heroic | 20 | Same size and role split as normal |

Eligibility is strict inside the finder. Every member of a queued partial group, every listing
member, and every applicant must be eligible for the selected activity. This prevents finder-made
boost groups. Existing manually created groups and physical dungeon entry rules remain unchanged.

### Roles

- At level 10 and above, selected roles must match the active talent specialization. A character
  without an active specialization cannot queue or apply.
- Below level 10, compatible roles come from a fixed class capability table:
  - Tank: warrior, paladin, druid.
  - Healer: paladin, priest, shaman, druid.
  - DPS: every class.
- A player may select multiple compatible roles. The matcher assigns one role for a proposal.
- The server-authoritative simulation validates every submitted role and never trusts the client.

### Automatic matchmaking

- A solo player or partial party may select one or more eligible activities.
- Only the party leader can enqueue or dequeue a partial party.
- Every current party member participates as one indivisible queue unit.
- Matching is deterministic and realm-local. It uses join order, activity intersection, party
  integrity, strict level eligibility, and exact role composition.
- A completed candidate opens a 30-second availability proposal for every participant.
- The party or raid is created only after every participant accepts.
- If a participant declines or times out, their premade unit leaves the queue and the offender
  receives a 60-second queue cooldown. Other accepted units return with their original join time.
- An existing partial-party leader remains leader. For all-solo matches, the longest-waiting
  participant becomes leader.
- Formation preserves normal group-loot defaults and does not change dungeon difficulty, player
  position, target, combat state, or instance state.

### Premade listings

- A party leader creates one listing for one activity and difficulty.
- A listing advertises its current roster, assigned or compatible roles, and missing role slots.
- It uses localized structured tags instead of free-form text: first run, quest run, full clear,
  learning welcome, and fast run.
- Eligible solo players apply with one or more compatible roles.
- The leader accepts or declines each application. Acceptance directly adds the applicant through
  the authoritative party machine after revalidating capacity, level, role fit, online state, and
  party state.
- A listing closes when full, when its leader closes it, when the leader disconnects, or when its
  party becomes invalid.
- The solo attunement crypt appears in the catalogue and supports manual listings with up to five
  players, but has no automatic queue.

### Travel and entry

- Group formation never teleports anyone.
- The completion state names the activity and explains that the group must travel to its entrance.
- The detail view provides a Show on Map action using the authored overworld entrance position.
- Existing dungeon entry, heroic selection, attunement, and lockout validation remain authoritative.

## Catalogue and presentation data

Finder presentation must come from explicit declarative metadata, not name or spawn heuristics.
Each activity record identifies:

- Dungeon id and supported difficulty.
- Strict finder level range.
- Group size and required role counts.
- Entrance zone and map position.
- Short localized summary and structured activity type.
- Ordered encounter records.
- For each encounter: mob template id, display order, summary, notable mechanics, and portrait id.
- Normal and heroic loot sources, with item ids and authored drop chances or roll-group semantics.

The UI resolves dungeon, creature, ability, and item names through existing localization helpers.
Item details use the canonical item definitions and item-level calculation. Percentages, levels,
money, and counts use locale-aware formatters.

## Architecture

### Simulation

- Add a dedicated `src/sim/social/dungeon_finder.ts` system behind `SimContext`.
- Keep queue units, proposals, cooldowns, listings, applications, and monotonic ids as per-Sim
  state. The system draws no RNG and reads only simulation time.
- Put role compatibility, activity eligibility, role assignment, and deterministic candidate
  selection in pure exported functions with direct Vitest coverage.
- Extend `PartyMachine` with the smallest authoritative formation seam needed to merge solos and
  partial parties without synthesizing invite events.
- Clean finder state when a player disconnects, a party changes, or a proposal expires.

### World API and network

- Add a `dungeon_finder` IWorld facet containing the local finder snapshot and actions.
- Append stable command tokens for role selection, automatic queue join/leave, proposal response,
  listing create/close, application create/cancel, and application accept/decline.
- Validate every command field in `server/game.ts` before calling the Sim.
- Add one delta-encoded heavy self snapshot field. Mirror it in `ClientWorld` without defaulting an
  omitted field.
- The public listing projection contains only data needed by the window and remains realm-local.
- Offline Sim implements the same interface and can exercise matching with multiple local players.

### UI

- Add `src/ui/dungeon_finder_view.ts`, a DOM-free pure view builder registered in the UI pure-core
  guard and tested with Sim-shaped and ClientWorld-shaped inputs.
- Add `src/ui/dungeon_finder_window.ts`, a thin painter composed by `Hud`.
- The window has Catalogue, Quick Match, and Premade Groups modes. Desktop uses a two-column
  master-detail layout. Mobile uses one navigable pane with a stable back action and bottom action
  bar.
- Add a desktop micro button, a mobile More button, and a rebindable `Shift+I` default action.
  Existing `I` calendar behavior remains unchanged.
- Opening traps focus and closing restores it. All controls meet mobile target sizes, support
  keyboard navigation, forced colors, reduced motion, and localized accessible names.
- The detail surface shows range, size, roles, difficulty, entrance, lockout, ordered encounters,
  static boss portraits, mechanics, and normal or heroic loot cards.

### Performance

- The finder is a cold window. Closed state performs no DOM work, catalogue building, image decode,
  timers, polling, or per-frame iteration.
- Static catalogue models are built once and reused. Boss portraits are prerendered WebP assets,
  not live Three.js scenes.
- While open, the painter rebuilds only when a stable state signature, selected activity, tab, or
  locale changes. Countdown text is the only time-driven update and is bounded to one update per
  second.
- Lists use bounded keyed reconciliation or whole-panel replacement only on signature changes.
  They never rebuild from `Hud.update()` on an unchanged snapshot.
- Portrait images use fixed dimensions, lazy decoding, and no layout shift.
- No new runtime dependency is permitted.

## Test plan

### Pure and simulation tests

- Activity level boundaries, including every minimum and maximum.
- Pre-level-10 class role compatibility and level-10 specialization enforcement.
- Exact 1/1/3 and 2/2/6 role assignment, multi-role selection, and impossible compositions.
- FIFO deterministic activity intersection and partial-party preservation.
- Proposal accept, decline, timeout, cooldown, and original-join-time restoration.
- All-solo and premade leadership.
- Listing creation, filtering, application lifecycle, acceptance, capacity, and invalidation.
- Disconnect and party mutation cleanup.
- No teleport, automatic dungeon entry, difficulty mutation, or loot-setting mutation.

### Wire and parity tests

- Command vocabulary and dispatch validation.
- Self snapshot encode/decode delta preservation.
- Sim and ClientWorld IWorld parity.
- Offline and online finder view parity.
- Payload size regression for the listing projection.

### UI, accessibility, and performance tests

- Catalogue and detail completeness for every activity, encounter, and loot source.
- Quick Match and Premade Groups state transitions.
- Focus trap, focus return, keyboard reachability, accessible names, and mobile target floors.
- Render signature skips unchanged DOM work and closed state performs zero work.
- Desktop, mobile portrait, and mobile landscape browser screenshots.
- Reduced-motion, forced-colors, narrow-height scrolling, and long-localized-copy checks.

## Acceptance criteria

1. Eligible players can form strict-composition five-player and ten-player groups automatically.
2. Partial parties remain together and every participant confirms before formation.
3. Leaders can publish structured listings and approve eligible applicants.
4. Finder-created groups never include an out-of-range player.
5. Every release dungeon activity is discoverable with bosses, mechanics, loot, range, difficulty,
   lockout, and entrance information.
6. Formation never teleports or enters an instance.
7. Closed finder cost is effectively zero and unchanged open state causes no repeated DOM rebuild.
8. Desktop and mobile flows meet the repository accessibility and visual QA contracts.
9. Focused tests, architecture and localization guards, typecheck, builds, and `npm run gate` pass.
