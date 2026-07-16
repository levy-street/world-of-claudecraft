# Implementation Handoff: The Frontier, Phase F1 (Factionless Zone Skeleton)

| | |
|---|---|
| **Status** | Ready to implement (do not start slices without operator go-ahead) |
| **Source PRD** | `docs/prd/frontier-pvp.md`, section 11 Phase F1 |
| **Prerequisite** | SATISFIED: `docs/prd/pvp-honor-and-quartermaster.md` SHIPPED in #1817 (release/v0.25.0). The `honor` currency, `grantHonor`, the honor DR machinery, the FURY Quartermaster, and the Warfare PvP stat (the Offense/Defense pair shipped as one combined player-facing stat) all exist on the release line. THIS handoff only wires the zone; re-anchor every symbol against release/v0.25.0 before starting a slice. |
| **Scope** | Factionless zone skeleton ONLY: the band, enter/leave via the G window, **everyone-hostile** auto-flagging (no teams), the single/multi-combat lock, one safe hub, the depth gradient, hub graveyard respawn, and the **2x honor on open-world kills** routed through the existing `grantHonor`. NO cargo/nodes (F2), NO events (F3), NO $WOC (section 12, later). |
| **Verified against** | Repository snapshot on 2026-07-03, re-anchor before implementation; trust symbols, not line numbers. |
| **Executor routing** | Route by slice complexity and the active session model. Use `$woc-extract-and-test` for implementation and `$woc-qa` for each completed slice. UI and render work also receives `woc_frontend` review. No slice depends on a named model. |

---

## 0. Ground rules for every implementation prompt

1. `src/sim/` never imports from `render/`, `ui/`, `game/`, `net/`, or any DOM/Three
   API. Guarded by `tests/architecture.test.ts`.
2. All sim randomness goes through the sim's `Rng` (`ctx.rng` / `this.rng`). Never
   `Math.random`, `Date.now`, `performance.now` in sim logic. Timers use sim time
   (`this.time`, `DT = 1/20`).
3. Every player-visible string is i18n: sim/server emit stable event data or English
   literals that MUST have a matcher entry (`src/ui/sim_i18n.ts` / `server_i18n.ts`);
   UI strings are `t()` keys added to `src/ui/i18n.catalog/` (English first). Do not
   edit `i18n.locales/` overlays except for M16: a new wordy English value also needs
   its five non-Latin fills in the same change; see `src/ui/CLAUDE.md`. The S3 guard is
   `tests/localization_fixes.test.ts`.
4. TypeScript strict, ESM, 2-space indent, match surrounding style. No em dashes, en
   dashes, or emojis anywhere, including comments and commit messages.
5. Conventional Commits with scope, e.g. `feat(frontier): ...`.
6. Anchor completion on the slice's acceptance commands, not on "looks done".
7. **No teams.** There is no `frontierTeam`, no per-team base, no team color. Hostility
   is positional (both players in-band). Do not reintroduce the Azure/Crimson design.

## 1. Shared design constants (used by every slice)

Defined once in S1; every other slice imports, never redefines.

```ts
// src/sim/data.ts (beside the arena/delve constants)
export const FRONTIER_X_MIN = 9000;            // band start; see gotcha G1
export const FRONTIER_ORIGIN = { x: 9200, z: 0 };
export const FRONTIER_HALF_W = 200;            // playfield x half-extent (depth axis)
export const FRONTIER_HALF_H = 300;            // playfield z half-extent
export const FRONTIER_MIN_LEVEL = 15;
export function isFrontierPos(x: number): boolean { return x >= FRONTIER_X_MIN; }

// src/sim/content/frontier.ts (content module, merged by data.ts)
// One neutral safe hub at the SHALLOW mouth of the band (no team bases).
export const FRONTIER_HUB = { x: 9020, z: 0, facing: Math.PI / 2 };
export const FRONTIER_HUB_SAFE_RADIUS = 24;    // no PvP damage inside this radius

// Depth: a pure function of how far past the hub mouth you are, bucketed. Drives
// node richness (F2), spawn danger (F4), and the single/multi-combat rule (S3b).
export const FRONTIER_MULTI_COMBAT_DEPTH = 90;  // x past FRONTIER_X_MIN where multi-combat begins
export function frontierDepth(x: number): number { return Math.max(0, x - FRONTIER_X_MIN); }
export function isMultiCombat(x: number): boolean { return frontierDepth(x) >= FRONTIER_MULTI_COMBAT_DEPTH; }
```

The **2x kill premium** and all honor DR/level-gating are NOT re-tuned here; they are
the honor PRD's constants. S5 passes a zone multiplier of `2` into `grantHonor` and
lets the existing DR apply. Assist honor rides the same 2x. (Exact base honor, level
factor, and DR schedule live in `pvp-honor-and-quartermaster.md` and its slice 2.)

## 2. Verified hook-point map (re-anchor before editing)

| Concern | Anchor |
|---|---|
| `CharacterState` | `src/sim/sim.ts:780` (interface); backfill on load in `addPlayer` ~`sim.ts:1260`; save in `serializeCharacter` ~`sim.ts:5635`. (`honor` field itself is added by the honor PRD, not here.) |
| `isHostileTo` / `isFriendlyTo` | `src/sim/sim.ts:5861` (duel clause, then arena clause via `arenaMatches` + `isArenaCrossTeam`; `pvpController` resolves pets to owners). The frontier clause goes in the `target.kind === 'player'` block |
| Band constants + routing | `src/sim/data.ts:296-398` (`ARENA_X_MIN`, `isArenaPos`, `DELVE_BAND_X_MIN`, `isDelvePos`); collision routing in `src/sim/colliders.ts:359` `resolvePosition` |
| Death/respawn | `src/sim/entity_roster.ts:157` `releasePlayerSpirit` (arena early-return, delve branch, then overworld graveyard); the frontier branch goes after the delve check |
| Arena teleport in/out | `src/sim/social/arena.ts:686` `placeInArena` (`ctx.groundPos`, `rebucket`); the enter/leave teleport copies this pattern. NOTE gotcha G2 |
| Arena queue prereqs (copy the guards) | `src/sim/social/arena.ts:56-100` `arenaQueueJoin` (dead / in-match / duel / trade guards, `ctx.error(...)` pattern) |
| grantHonor + honor DR | Added by the honor PRD (a `src/sim/pvp/` module behind `SimContext`). S5 calls `ctx.grantHonor(meta, amount, reason)` with the zone 2x multiplier folded into `amount` |
| Kill attribution | The player-death path where a player killing blow is attributed; `pvpController` resolves pet kills to owners (same place the honor PRD's Fiesta/arena honor hooks read) |
| IWorld | `src/world_api.ts:341-510`; arena methods ~458-461, `arenaInfo` state ~416; add frontier members beside them |
| ClientWorld | `src/net/online.ts`; `cmd()` ~918; command wrappers ~1665-1694; `applySnapshot` self-state mirror ~1266 (`s.arena` pattern) |
| Server dispatch | `server/game.ts:1351` `dispatchMessage` switch; `enter_dungeon` case ~1877; `arena_queue` ~1763 |
| Wire entity | `server/game.ts:248-261` `identityFields`; client decode `src/net/online.ts:1049-1170` `applyWire`; self-only state via `selfWireJson` `maybe()` ~2149. (No `ft` team field; instead a positional in-band flag if the client needs the hostile tint.) |
| SimEvent union | `src/sim/types.ts:1393-1584`; server event routing `server/game.ts:2267-2308` |
| Parity goldens | `tests/parity/scenarios.ts` + `UPDATE_PARITY=1 npx vitest run tests/parity`; never regenerate to hide a diff |
| Snapshot tests | `tests/snapshots.test.ts` (`DELTA_KEYS` ~23-36, `bareClient` ~79) |
| Arena window UI | `src/ui/hud.ts` `toggleArena` ~5268, `renderArenaWindow` ~5300-5486, wired from `src/main.ts:1037`; DOM shell `#arena-window` in `index.html` |
| Modular window template | `src/ui/vendor_view.ts` + `src/ui/vendor_window.ts` + Hud orchestrates; recipe in `src/ui/CLAUDE.md` |
| Keybind label | `src/game/keybinds.ts:160-166` (id `arena`) -> catalog key `hud.keybinds.actions.arena` in `src/ui/i18n.catalog/hud.ts` (mapping `hud.ts:563`) |
| Nameplates | `src/render/renderer.ts:4520-4646` (`setNameplateStatic`; player color ~4531; CSS-class pattern `np-threat` ~4610 is the preferred hook) |
| FCT | `src/ui/hud.ts` `handleEvents` ~6082 (XP case ~6165 is the template); the honor PRD already adds the honor float, reuse it |

## 3. Slices

Dependency order: S1 -> S2 -> S3 -> (S4, S5, S6 in any order) -> S7 -> S8.

### S1. Band, content module, and persisted state
- `src/sim/data.ts`: add the constants from section 1. **Bound the delve band**
  (gotcha G1): `isDelvePos(x)` becomes `x >= DELVE_BAND_X_MIN && x < FRONTIER_X_MIN`.
- `src/sim/content/frontier.ts`: new content module exporting `FRONTIER_HUB`,
  `FRONTIER_HUB_SAFE_RADIUS`, and the depth helpers; merged from `data.ts` like zone
  content.
- `src/sim/colliders.ts` `resolvePosition`: an `isFrontierPos` branch BEFORE the delve
  branch, clamping to the playfield rectangle (`FRONTIER_ORIGIN +- HALF_W/H`), flat
  ground `y = 0` (arena-style).
- `CharacterState` (`sim.ts:780`): add `frontierReturnPos?: { x: number; z: number }`
  (the honor field is the honor PRD's). Round-trip in `serializeCharacter` /
  `addPlayer`. Mirror onto `PlayerMeta` the `delveMarks` way.
- Tests: `tests/frontier_band.test.ts`: band predicates disjoint (`isArenaPos` /
  `isDelvePos` / `isFrontierPos` never overlap for any x in [0, 12000]);
  `resolvePosition` clamps inside the rect; `frontierDepth` / `isMultiCombat`
  monotonic; save/load round-trips `frontierReturnPos`.
- Acceptance: `npx vitest run tests/frontier_band.test.ts tests/architecture.test.ts tests/entity_roster.test.ts && npx vitest run tests/parity`.

### S2. Enter and leave (no team assignment)
- New `src/sim/frontier/` directory: `index.ts` barrel + `frontier.ts` + a local
  `CLAUDE.md`. Module functions take `ctx: SimContext` first, arena-module style.
- `enterFrontier(ctx, pid?)`:
  - Guards (copy the `arenaQueueJoin` block + `ctx.error`): dead, in arena match or
    queue, in duel, in trade, already in frontier, inside a dungeon or delve band,
    level below `FRONTIER_MIN_LEVEL`. Error texts in section 4.
  - Save `frontierReturnPos = { x, z }`, then teleport to `FRONTIER_HUB` via the
    `placeInArena` pattern (`ctx.groundPos`, `prevPos = {...pos}`, `rebucket`, facing).
    **No team assignment. No per-team base. Everyone lands at the one hub.**
  - Emit `{ type: 'frontierEntered', pid }`.
- `leaveFrontier(ctx, pid?)`: valid only in-band; a **10 s channel** reusing the
  cast/channel machinery (interrupted by damage; refused while in combat with
  `ctx.error`); on completion teleport to `frontierReturnPos ?? zone1 graveyard`, clear
  it, emit `{ type: 'frontierLeft', pid }`.
- `Sim` public delegates: `enterFrontier(pid?)`, `leaveFrontier(pid?)`.
- New SimEvent variants: `frontierEntered { pid }`, `frontierLeft { pid }` (no team).
- Tests: `tests/frontier_enter.test.ts`: level gate; leave channel interrupted by
  damage; teleport restores return pos; determinism (two same-seed sims identical). No
  team assignment cases (there are none).
- Acceptance: `npx vitest run tests/frontier_enter.test.ts tests/architecture.test.ts && npx vitest run tests/parity`.

### S3. Hostility (everyone-hostile) + single/multi-combat + seam
- **S3a hostility.** `isHostileTo` (`sim.ts:5861`), in the `target.kind === 'player'`
  block, after the duel clause and before the arena clause: if both `attackerPlayer`
  and `target` positions satisfy `isFrontierPos` **and neither is inside the hub safe
  radius**, return `true`. No team comparison. Pets inherit via `pvpController`.
- **S3b single-combat lock.** In the shallow (single-combat) tiers, a player already in
  an active player-vs-player fight cannot be targeted by a third player until that fight
  ends. Model "in-fight" as the most-recent-PvP-damage pair within a short window
  (sim-time, session state on `PlayerMeta`, like threat, NOT persisted). The lock is a
  pure predicate evaluated alongside hostility: `isMultiCombat(pos.x)` bypasses it. Deep
  tiers have no lock (pile-ons allowed).
- Duels: refuse a duel request with `ctx.error` if either party is in the band (PRD
  4.1: everyone is already hostile there).
- `src/world_api.ts`: add beside the arena members:
  `frontierInfo: FrontierInfo | null` where
  `FrontierInfo = { inZone: boolean; honor: number; depthTier: number; multiCombat: boolean; leaveChannelRemaining: number | null }`
  (`honor` read from the honor PRD's balance), plus `enterFrontier()`, `leaveFrontier()`.
- `src/net/online.ts`: `enterFrontier()` -> `cmd({ cmd: 'enter_frontier' })`, likewise
  leave; mirror `frontierInfo` in `applySnapshot` (`s.arena` pattern).
- `server/game.ts`: `dispatchMessage` cases `enter_frontier` / `leave_frontier`; self
  snapshot gains `frontier` via `maybe()`; a positional **in-band** flag on the wire
  entity (only while in-band) so the client can tint hostile players (one hostile color,
  not per-team).
- Tests: extend `tests/snapshots.test.ts` with the frontier self-state mirror; new
  `tests/frontier_hostility.test.ts`: two in-band players hostile both directions;
  out-of-band not; inside the hub radius not; pet of an in-band player hostile to
  another in-band player; the single-combat lock blocks a third attacker shallow and
  allows it deep; duel refused in-band. New parity scenario `frontier_skirmish` in
  `tests/parity/scenarios.ts` (two players enter, fight to a kill, leave) recorded with
  `UPDATE_PARITY=1`.
- Acceptance: `npx vitest run tests/frontier_hostility.test.ts tests/snapshots.test.ts && npx vitest run tests/parity`.

### S4. Death and respawn at the hub graveyard
- `releasePlayerSpirit` (`entity_roster.ts:157`): after the delve branch, add
  `if (isFrontierPos(r.e.pos.x)) { releaseSpiritInFrontier(ctx, ...); return; }`,
  modeled on `releaseSpiritInDelve` but respawn at `FRONTIER_HUB` (full HP, standard
  reset), no run-fail semantics, standard respawn emit. Equipped gear untouched (cargo
  drop is F2).
- Tests: `tests/frontier_respawn.test.ts`: die in-band -> respawn at the hub, not the
  overworld graveyard; auras cleared; equipped gear untouched.
- Acceptance: `npx vitest run tests/frontier_respawn.test.ts tests/entity_roster.test.ts && npx vitest run tests/parity`.

### S5. 2x honor on open-world kills (reuses the honor PRD)
- At the player-kill attribution point, when `isHostileTo(killer, victim)` held via the
  **frontier** clause (not duel/arena), call the honor PRD's `ctx.grantHonor(killerMeta,
  base * 2, 'frontierKill')` where `base` and the per-victim DR + level gating are the
  honor PRD's (S5 does NOT re-implement them; it passes the 2x multiplier and lets the
  shared DR apply). Assist honor, if wired, rides the same 2x.
- No new currency, DR map, or event here: the `honor` counter, DR state, and the honor
  gain float all belong to the honor PRD. This slice is only the zone source + the 2x.
- Tests: `tests/frontier_honor.test.ts`: a frontier kill grants exactly 2x the honor
  PRD's Fiesta base at equal level; 0 at 5+ levels below; the shared per-victim DR still
  applies (2x of 100/50/25/0); a pet killing blow credits the owner; a duel/arena kill
  is unaffected (still the honor PRD's non-2x path).
- Acceptance: `npx vitest run tests/frontier_honor.test.ts && npx vitest run tests/parity`.

### S6. Guide/wiki content + docs sync
- Run `npm run wiki:content`; add any `guide.*` prose keys the generator demands for the
  frontier zone entry (English only, spoiler-safe).
- Acceptance: `npx vitest run tests/guide.test.ts`.

### S7. PvP window: Frontier section in the G window
- Modular recipe (`src/ui/CLAUDE.md`, vendor template): new
  `src/ui/frontier_panel_view.ts` (pure view from `FrontierInfo` + level; unit-tested) +
  `src/ui/frontier_panel.ts` (thin DOM consumer). `renderArenaWindow` (`hud.ts:5300`)
  composes it under the existing queue UI; do NOT grow a new banner section.
- Content: honor balance (from the honor PRD), Enter button (disabled with reason below
  level 15 or offline-dead), Leave button with channel countdown when in-zone, and (when
  in-zone) the depth tier + a single/multi-combat indicator. No team crest, no
  "Unassigned".
- Keybind label: change the `arena` keybind label to `'PvP (Arena & Frontier)'` and the
  English value of `hud.keybinds.actions.arena`; window title likewise. New UI keys go in
  `hud.frontier.*` in `src/ui/i18n.catalog/hud.ts`. Then `npm run i18n:scan && npm run
  i18n:build`, commit the regenerated `i18n.resolved.generated/` slices (the status
  summary is gitignored, never committed), run the completeness test (gotcha G4).
- FCT + events: the honor float is the honor PRD's; handle `frontierEntered` /
  `frontierLeft` as system lines.
- Acceptance: `npx vitest run tests/frontier_panel_view.test.ts tests/i18n_completeness.test.ts tests/localization_fixes.test.ts`; manual: `npm run dev`, press G, enter, kill, see honor float (screenshot per the headless screenshot workflow).

### S8. Integration pass
- Run `npm run gate` once from the coordinator. Diagnose any full-suite load flake
  against a clean baseline before changing production behavior.
- Run `$woc-qa` on the combined diff with `woc_sim_architecture`, `woc_cross_platform`,
  `woc_persistence`, `woc_security`, `woc_test_coverage`, and `woc_frontend` in scope.

*(There is no separate back-banner / nameplate-team-tint slice: with no teams, the only
render change is a single hostile tint on in-band enemy players via the existing
`np-threat`-style CSS-class hook, folded into S7. Team banners are gone.)*

## 4. New player-facing strings (complete list; the S3 i18n guard checks)

Sim `ctx.error` literals (each needs a `sim_i18n.ts` matcher entry in the SAME slice):
- `Reach level 15 to enter the Frontier.` (S2)
- `You are already in the Frontier.` (S2)
- `You cannot enter the Frontier right now.` (S2; covers dungeon/delve/arena/duel/trade)
- `You cannot leave the Frontier while in combat.` (S2)
- `You cannot duel in the Frontier.` (S3)

UI keys (S7, `hud.frontier.*`): window section title, `enter`, `leave`, `leaveChannel`
(with `{seconds}`), `honorLabel`, `levelGate` (with `{level}`), `depthTier`,
`singleCombat` / `multiCombat` labels, system lines for entered/left; plus the updated
`hud.keybinds.actions.arena` English value. (No team names, no `unassigned`.)

Deliberately NOT in F1: the Honor Quartermaster stock (that is the honor PRD's slice 5,
with its full item i18n and exact level-20 stat budgets).

## 5. Gotchas (read before every slice)

- **G1, delve band is open-ended.** `isDelvePos(x)` is `x >= DELVE_BAND_X_MIN` today. S1
  MUST bound it with `x < FRONTIER_X_MIN` and prove disjointness, or frontier players get
  delve collision/respawn routing.
- **G2, do not copy arena's return-position trick.** Arena reuses entity position state
  and restores in `endArenaMatch`. Frontier uses the explicit `frontierReturnPos` on
  `CharacterState` (S1) because players can log out mid-zone.
- **G3, parity goldens.** Any new `ctx.rng` draw on a shared code path shifts draw order
  and reds every golden. Frontier draws happen only inside frontier code paths. If a
  golden reds, fix the code, never `UPDATE_PARITY=1` on an existing scenario.
- **G4, i18n gates bite.** New catalog keys have failed `tests/i18n_completeness` when the
  generated files were not rebuilt and committed (`npm run i18n:scan && npm run
  i18n:build`, commit the `i18n.resolved.generated/` slices;
  `i18n.status.summary.json` is gitignored, not committed). Run it
  locally before pushing. Do not hand-edit locale overlays except the M16 five non-Latin
  fills for new wordy English values.
- **G5, `hostile` flag vs `isHostileTo`.** Mob hostility is a template flag; player
  hostility is ONLY the `isHostileTo` clauses. Do not set any `hostile`-like flag on
  players; the frontier clause is positional.
- **G6, worktree discipline.** Other sessions may carry uncommitted work. Build each
  slice in a fresh worktree outside the shared checkout, based on the active release
  branch, branch `feature/frontier-f1-s<N>`.
- **G7, honor lives in the honor PRD.** Do not add the `honor` currency, `grantHonor`, or
  the DR machinery here. If they are not yet merged, F1 is blocked on
  `pvp-honor-and-quartermaster.md`. This handoff only wires the zone source (S5) at 2x.

## 6. Agent dispatch template (for later; do not dispatch yet)

Give one implementation owner the slice outcome, acceptance criteria, relevant files,
section 0 ground rules, section 1 constants, applicable hook-map rows and gotchas, the
authorized actions, and validation commands. Use the active model and reasoning setting;
do not bake a model name into the packet. Require a diff summary, exact command results,
remaining manual verification, and a clean handoff. Run `$woc-qa` before merging each
slice, then use S8 for the combined gate.
