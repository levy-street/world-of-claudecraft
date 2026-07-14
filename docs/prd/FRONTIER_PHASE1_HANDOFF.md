# Implementation Handoff: Frostreach Frontier, Phase 1 (Skeleton)

| | |
|---|---|
| **Status** | Ready to implement (do not start slices without operator go-ahead) |
| **Source PRD** | `docs/prd/frontier-pvp-honor.md`, section 11 Phase 1 |
| **Scope** | Free loop skeleton ONLY: band, enter/leave via the G window, team assignment, auto-flagging, base graveyards, honor counter, honor on kills with DR, back banner, nameplate tint. NO cargo/nodes (Phase 2), NO events (Phase 3), NO $WOC (section 12, later). |
| **Verified against** | Repository snapshot on 2026-07-03. Revalidate every anchor against the active release branch before implementation; trust symbols, not line numbers. |
| **Executor routing** | Route by slice complexity and the active session model. Use `$woc-extract-and-test` for implementation and `$woc-qa` for each completed slice. UI and render work also receives `woc_frontend` review. No slice depends on a named model. |

---

## 0. Ground rules for every implementation prompt

1. `src/sim/` never imports from `render/`, `ui/`, `game/`, `net/`, or any DOM/Three
   API. Guarded by `tests/architecture.test.ts`.
2. All sim randomness goes through the sim's `Rng` (`ctx.rng` / `this.rng`). Never
   `Math.random`, `Date.now`, `performance.now` in sim logic. Timers use sim time
   (`this.time`, `DT = 1/20`).
3. Every player-visible string is i18n: sim/server emit stable event data or
   English literals that MUST have a matcher entry (`src/ui/sim_i18n.ts` /
   `src/ui/server_i18n.ts`); UI strings are `t()` keys added to
   `src/ui/i18n.catalog/` (English first). Do not edit `i18n.locales/` overlays except
   for M16: a new wordy English value also needs its five non-Latin fills in the same
   change; see `src/ui/CLAUDE.md`.
   The S3 guard is `tests/localization_fixes.test.ts`.
4. TypeScript strict, ESM, 2-space indent, match surrounding style. No em dashes,
   en dashes, or emojis anywhere, including comments and commit messages.
5. Conventional Commits with scope, e.g. `feat(frontier): ...`.
6. Anchor completion on the slice's acceptance commands, not on "looks done".

## 1. Shared design constants (used by every slice)

Defined once in S1; every other slice imports, never redefines.

```ts
// src/sim/data.ts (beside the arena/delve constants)
export const FRONTIER_X_MIN = 9000;            // band start; see gotcha G1
export const FRONTIER_ORIGIN = { x: 9200, z: 0 };
export const FRONTIER_HALF_W = 200;            // playfield x half-extent
export const FRONTIER_HALF_H = 300;            // playfield z half-extent
export const FRONTIER_MIN_LEVEL = 15;
export function isFrontierPos(x: number): boolean { return x >= FRONTIER_X_MIN; }

// src/sim/content/frontier.ts (content module, merged by data.ts)
export type FrontierTeam = 'azure' | 'crimson';
export const FRONTIER_BASES: Record<FrontierTeam, { x: number; z: number; facing: number }> = {
  azure:   { x: 9200, z: -280, facing: Math.PI / 2 },   // south base, faces north
  crimson: { x: 9200, z:  280, facing: -Math.PI / 2 },  // north base, faces south
};
```

Honor tuning (S5): kill base 20; level factor
`max(0, 1 - max(0, killerLevel - victimLevel) / 5)`; per killer-victim-pair DR
schedule 100% / 50% / 25% / 0%, window resets 3600 sim-seconds after the pair's
first kill. Assist honor is OUT of Phase 1 (deferred to Phase 2 with the
contributor tracking cargo needs anyway).

## 2. Verified hook-point map

| Concern | Anchor (re-find before editing) |
|---|---|
| `CharacterState` | `src/sim/sim.ts:780` (interface); backfill on load in `addPlayer` ~`sim.ts:1260`; save in `serializeCharacter` ~`sim.ts:5635` |
| `isHostileTo` / `isFriendlyTo` | `src/sim/sim.ts:5861` (duel clause, then arena clause via `arenaMatches` + `isArenaCrossTeam`; `pvpController` resolves pets to owners) |
| Band constants + routing | `src/sim/data.ts:296-398` (`ARENA_X_MIN = 4200`, `isArenaPos`, `DELVE_BAND_X_MIN` ~4773, `isDelvePos`); collision routing in `src/sim/colliders.ts:359` `resolvePosition` |
| Death/respawn | `src/sim/entity_roster.ts:157` `releasePlayerSpirit` (arena early-return, delve branch, then overworld graveyard); frontier branch goes after the delve check |
| Arena teleport in/out | `src/sim/social/arena.ts:686` `placeInArena` (sets `e.pos` via `ctx.groundPos`, `rebucket`); `endArenaMatch` ~`arena.ts:550` restores position. NOTE gotcha G2 |
| Arena queue prereqs (copy the checks) | `src/sim/social/arena.ts:56-100` `arenaQueueJoin` (dead / in-match / duel / trade guards, `ctx.error(...)` pattern) |
| Sim command surface | public methods on `Sim` delegating to module fns with `ctx` (e.g. `queueArena1v1` -> `arenaQueueJoin(this.ctx, ...)`) |
| IWorld | `src/world_api.ts:341-510`; arena methods at 458-461, `arenaInfo` state at ~416; add frontier members beside them |
| ClientWorld | `src/net/online.ts`; `cmd()` helper ~918 sends `{t:'cmd', ...}`; command wrappers ~1665-1694; `applySnapshot` self-state mirror ~1266 (`s.arena` pattern) |
| Server dispatch | `server/game.ts:1351` `dispatchMessage` switch; `enter_dungeon` case ~1877 (validation-then-`sim.*` pattern); `arena_queue` ~1763 |
| Wire entity | `server/game.ts:248-261` `identityFields` (guild rides as `gd`; add `ft`); client decode in `src/net/online.ts:1049-1170` `applyWire`; self-only state via `selfWireJson` `maybe()` ~2149 |
| SimEvent union | `src/sim/types.ts:1393-1584`; server event routing `server/game.ts:2267-2308` (events with `pid` are personal; unanchored events broadcast) |
| Parity goldens | `tests/parity/scenarios.ts` + `UPDATE_PARITY=1 npx vitest run tests/parity` writes `tests/parity/golden/*.json`; never regenerate to hide a diff |
| Snapshot tests | `tests/snapshots.test.ts` (`DELTA_KEYS` ~23-36, `bareClient` helper ~79) |
| Arena window UI | `src/ui/hud.ts` `toggleArena` ~5268, `renderArenaWindow` ~5300-5486, wired from `src/main.ts:1037`; DOM shell `#arena-window` in `index.html` |
| Modular window template | `src/ui/vendor_view.ts` (pure view, unit-tested) + `src/ui/vendor_window.ts` (thin DOM consumer) + Hud orchestrates; recipe in `src/ui/CLAUDE.md` |
| Keybind label | `src/game/keybinds.ts:160-166` (id `arena`, label string) -> catalog key `hud.keybinds.actions.arena` in `src/ui/i18n.catalog/hud.ts` (mapping in `hud.ts:563`) |
| Character attachments | `src/render/characters/manifest.ts` `VisualDef.attach?: AttachDef[]` (`{url, bone, ...}`); runtime swap pattern `visual.ts:439` `setWeapon`. No cloak/tabard precedent exists; weapon attach is the template |
| Nameplates | `src/render/renderer.ts:4520-4646` (`setNameplateStatic`; player color hardcoded `'#7fb8ff'` ~4531; CSS-class pattern `np-threat` ~4610 is the preferred hook) |
| FCT | `src/ui/hud.ts` `handleEvents` ~6082 (XP case ~6165 is the template), `fct()` ~7258 |

## 3. Slices

Dependency order: S1 -> S2 -> S3 -> (S4, S5, S6 in any order) -> S7, S8 -> S9.
S4, S5, S6 are independent of each other once S1-S3 are merged.

### S1. Band, content module, and persisted state
- `src/sim/data.ts`: add the constants from section 1. **Bound the delve band**
  (gotcha G1): `isDelvePos(x)` becomes `x >= DELVE_BAND_X_MIN && x < FRONTIER_X_MIN`.
- `src/sim/content/frontier.ts`: new content module exporting `FrontierTeam`,
  `FRONTIER_BASES` (and nothing else yet); import/merge from `data.ts` like
  zone content.
- `src/sim/colliders.ts` `resolvePosition`: add an `isFrontierPos` branch BEFORE
  the delve branch that clamps to the playfield rectangle
  (`FRONTIER_ORIGIN +- FRONTIER_HALF_W/H`), flat ground `y = 0` (arena-style).
- `CharacterState` (`sim.ts:780` area): add `frontierTeam?: FrontierTeam`,
  `honor?: number`, `frontierReturnPos?: { x: number; z: number }`. Backfill in
  `addPlayer` (`honor` -> 0; others stay undefined); round-trip in
  `serializeCharacter`. Mirror onto `PlayerMeta` the same way `delveMarks` is.
- Tests: new `tests/frontier_band.test.ts`: band predicates disjoint
  (`isArenaPos` / `isDelvePos` / `isFrontierPos` never overlap for any x in
  [0, 12000]); `resolvePosition` clamps inside the frontier rect; save/load
  round-trips the three new fields and old saves (fields absent) load with
  `honor === 0`.
- Acceptance: `npx vitest run tests/frontier_band.test.ts tests/architecture.test.ts tests/entity_roster.test.ts`
  and `npx vitest run tests/parity` (must be untouched: no draws added outside
  the band).

### S2. Enter, leave, team assignment
- New `src/sim/frontier/` directory: `index.ts` barrel + `frontier.ts` + a local
  `CLAUDE.md` (one paragraph: what lives here, the invariants). Module functions
  take `ctx: SimContext` first, arena-module style.
- `enterFrontier(ctx, pid?)`:
  - Guards (copy the `arenaQueueJoin` guard block + `ctx.error` pattern): dead,
    in arena match or queue, in duel, in trade, already in frontier
    (`isFrontierPos(e.pos.x)`), inside a dungeon or delve band, level below
    `FRONTIER_MIN_LEVEL`. Error texts listed in section 4.
  - Team: if `meta.frontierTeam` set, keep it (permanent). Else assign: count
    in-zone players per team; if the player is in a party with an in-zone or
    already-assigned member, take that member's team unless it would make the
    team sizes differ by more than 2; otherwise smaller team; tie ->
    `ctx.rng.chance(0.5)`. Persisted via S1 fields.
  - Save `frontierReturnPos = { x, z }` of current pos, then teleport to
    `FRONTIER_BASES[team]` via the `placeInArena` pattern (`ctx.groundPos`,
    `prevPos = {...pos}`, `rebucket`, set facing).
  - Emit `{ type: 'frontierEntered', pid, team }`.
- `leaveFrontier(ctx, pid?)`: only valid in-band; starts a **10 s channel**
  reusing the existing cast/channel machinery (interrupted by damage; refused
  while in combat with `ctx.error`); on completion teleport to
  `frontierReturnPos ?? zone1 graveyard`, clear `frontierReturnPos`, emit
  `{ type: 'frontierLeft', pid }`.
- `Sim` public delegates: `enterFrontier(pid?)`, `leaveFrontier(pid?)`.
- New SimEvent variants in `types.ts`: `frontierEntered { pid, team }`,
  `frontierLeft { pid }`.
- Tests: `tests/frontier_enter.test.ts`: level gate; permanence (leave and
  re-enter keeps team); balance assignment (3 azure 1 crimson in zone -> next
  solo entrant is crimson); party override within tolerance; leave channel
  interrupted by damage; teleport restores return pos. Deterministic: two sims
  with the same seed and drive produce identical assignments.
- Acceptance: `npx vitest run tests/frontier_enter.test.ts tests/architecture.test.ts && npx vitest run tests/parity`.

### S3. Hostility clause + seam (IWorld, wire, server dispatch)
- `isHostileTo` (`sim.ts:5861`): in the `target.kind === 'player'` block, after
  the duel clause and before the arena clause, add: both `attackerPlayer` and
  `target` positions satisfy `isFrontierPos`, both have `frontierTeam` set, and
  the teams differ -> `true`. Pets already inherit via `pvpController` /
  the mob-owner clause; do not duplicate.
- Duels: in the duel-request path, refuse with `ctx.error` if either party is
  in the frontier band (PRD 5.2).
- `src/world_api.ts`: add beside the arena members:
  `frontierInfo: FrontierInfo | null` where
  `FrontierInfo = { team: FrontierTeam | null; honor: number; inZone: boolean; leaveChannelRemaining: number | null }`,
  plus `enterFrontier(): void`, `leaveFrontier(): void`. Offline `Sim` computes
  it from live state.
- `src/net/online.ts`: `enterFrontier()` -> `this.cmd({ cmd: 'enter_frontier' })`,
  `leaveFrontier()` -> `this.cmd({ cmd: 'leave_frontier' })`; mirror
  `frontierInfo` in `applySnapshot` following the `s.arena` pattern (~1266).
- `server/game.ts`: `dispatchMessage` cases `enter_frontier` / `leave_frontier`
  (no geo-gate; the G window is global like arena queueing); self snapshot
  gains `frontier` via the `maybe()` pattern; `identityFields` gains
  `ft: e.frontierTeam` ONLY while the entity is in-band (spare the wire
  elsewhere); `applyWire` decodes it onto the entity.
- Tests: extend `tests/snapshots.test.ts` with the frontier self-state mirror
  (follow the `bareClient` pattern); new `tests/frontier_hostility.test.ts`:
  cross-team in-band hostile both directions, same-team not, cross-team
  OUT-of-band not, pet of azure player hostile to crimson player in-band, duel
  refused in-band. New parity scenario `frontier_skirmish` in
  `tests/parity/scenarios.ts` (enter two players, opposite teams via seeded
  assignment, fight to a kill, leave) recorded with `UPDATE_PARITY=1`.
- Acceptance: `npx vitest run tests/frontier_hostility.test.ts tests/snapshots.test.ts && npx vitest run tests/parity`.

### S4. Death and respawn at team base
- `releasePlayerSpirit` (`entity_roster.ts:157`): after the delve branch, add
  `if (isFrontierPos(r.e.pos.x)) { releaseSpiritInFrontier(ctx, ...); return; }`
  modeled on `releaseSpiritInDelve` but: respawn at `FRONTIER_BASES[team]`
  (full HP, standard reset), no run-fail semantics, keep the standard respawn
  emit. Players with no team somehow in-band (teleport cheats in dev) fall
  through to the overworld graveyard.
- Tests: `tests/frontier_respawn.test.ts`: die in-band -> respawn at own base,
  not the enemy base, not the overworld graveyard; auras cleared; equipped gear
  untouched.
- Acceptance: `npx vitest run tests/frontier_respawn.test.ts tests/entity_roster.test.ts && npx vitest run tests/parity`.

### S5. Honor on kills with DR
- New `src/sim/frontier/honor.ts`: `grantKillHonor(ctx, killer, victim)` applying
  section 1 tuning; DR state lives on `PlayerMeta` as
  `honorDr?: Map<victimPid, { kills: number; windowStart: number }>` (sim-time
  window, NOT persisted; it is session state like threat).
- Hook: the player-death path where a player kill is attributed (follow how
  duel/arena resolve the killing blow; `pvpController` resolves pet kills to
  owners). Grant only when `isHostileTo(killer, victim)` held via the frontier
  clause (duel and arena kills stay honor-free).
- `honor` increments on `PlayerMeta` and persists via S1. Emit
  `{ type: 'honorGain', pid, amount, victimName }` (personal event).
- Tests: `tests/frontier_honor.test.ts`: base 20 at equal level; 0 at 5+ levels
  below; DR sequence 20/10/5/0 on the same victim; window reset after 3600
  sim-seconds; pet killing blow credits the owner; duel kill grants nothing;
  honor survives serialize/load round-trip.
- Acceptance: `npx vitest run tests/frontier_honor.test.ts && npx vitest run tests/parity`.

### S6. Guide/wiki content + docs sync
- Run `npm run wiki:content`; add any new `guide.*` prose keys the generator
  demands for the frontier zone entry (English only, per `src/guide/CLAUDE.md`),
  spoiler-safe.
- Acceptance: `npx vitest run tests/guide.test.ts`.

### S7. PvP window: Frontier section in the G window
- Follow the modular recipe (`src/ui/CLAUDE.md`, vendor template): new
  `src/ui/frontier_panel_view.ts` (pure view: derives labels/state from
  `FrontierInfo` + level; unit-tested) + `src/ui/frontier_panel.ts` (thin DOM
  consumer). `renderArenaWindow` (`hud.ts:5300`) composes the section under the
  existing queue UI; do NOT grow a new banner section.
- Content: team crest + name (or "Unassigned"), honor balance, Enter button
  (disabled with reason below level 15 or offline-dead), Leave button with
  channel countdown when in-zone.
- Keybind label: change `keybinds.ts:162` label to `'PvP (Arena & Frontier)'`
  and update the English value of `hud.keybinds.actions.arena`; window title key
  likewise. All new UI keys go in `src/ui/i18n.catalog/hud.ts` under a
  `hud.frontier.*` block. Then `npm run i18n:scan && npm run i18n:build`,
  commit the regenerated `i18n.resolved.generated/` + status files, and run
  the completeness test (gotcha G4).
- FCT + events: handle `honorGain` (gold `+N Honor` float on self, XP-case
  template at `hud.ts:6165`), `frontierEntered`/`frontierLeft` as system lines.
- Acceptance: `npx vitest run tests/frontier_panel_view.test.ts tests/i18n_completeness.test.ts tests/localization_fixes.test.ts`; manual: `npm run dev`, press G, enter, kill, see honor float (screenshot per the headless screenshot workflow).

### S8. Back banner + nameplate team tint
- Banner: extend the attach path so player visuals in-band get a team banner.
  No tabard precedent exists; pattern-match the weapon attach
  (`manifest.ts` `AttachDef`, swap machinery `visual.ts:439`). If no suitable
  GLB exists in `public/`, build a small procedural plane+pole mesh in a new
  `src/render/team_banner.ts` the visual composes (repo norm: procedural
  geometry is fine). Tint azure `#2e6fd0` / crimson `#c03030`; driven by the
  wire `ft` field, attached only while present (S3 scopes it to in-band).
- Nameplates: CSS-class pattern (like `np-threat`): `np-team-azure` /
  `np-team-crimson` on enemy-team players in-band; style in `index.html`.
  Do not fork `setNameplateStatic` color logic.
- Acceptance: `npm run build` green; two-client manual check on the dev server
  (banners visible at distance, enemy nameplate tinted); screenshot committed
  under `docs/screenshots/` if it is README-worthy, else attached to the PR.

### S9. Integration pass
- Run `npm run gate` once from the coordinator. Diagnose any full-suite load flake
  against a clean baseline before changing production behavior.
- Run `$woc-qa` on the combined diff with `woc_sim_architecture`,
  `woc_cross_platform`, `woc_persistence`, `woc_security`, `woc_test_coverage`, and
  `woc_frontend` in scope. Reviewers inspect shared command output rather than rerunning
  the full gate.

## 4. New player-facing strings (complete list; the S3 i18n guard will check)

Sim `ctx.error` literals (each needs a `sim_i18n.ts` matcher entry in the SAME
slice that adds it):
- `Reach level 15 to enter the Frontier.` (S2)
- `You are already in the Frontier.` (S2)
- `You cannot enter the Frontier right now.` (S2; covers dungeon/delve/arena/duel/trade guards)
- `You cannot leave the Frontier while in combat.` (S2)
- `You cannot duel in the Frontier.` (S3)

UI keys (S7, `hud.frontier.*` unless noted): window section title, team names
(`azure`, `crimson`), `unassigned`, `enter`, `leave`, `leaveChannel` (with
`{seconds}`), `honorLabel`, `levelGate` (with `{level}`), FCT `honorFloat`
(with `{amount}`), system lines for entered/left; plus the updated
`hud.keybinds.actions.arena` English value.

Deliberately NOT in Phase 1: honor vendor stock (needs full item i18n in all
locales plus exact level-20 stat budgets; that lands with Phase 2 economy).

## 5. Gotchas (read before every slice)

- **G1, delve band is open-ended.** `isDelvePos(x)` is `x >= DELVE_BAND_X_MIN`
  today and `delveOrigin` grows along x per delve index. S1 MUST bound it with
  `x < FRONTIER_X_MIN` and the band test must prove disjointness, or frontier
  players get delve collision/respawn routing.
- **G2, do not copy arena's return-position trick.** Arena reuses entity
  position state and restores in `endArenaMatch`; there is no persisted
  return-pos precedent. Frontier uses the explicit `frontierReturnPos` on
  `CharacterState` (S1) because players can log out mid-zone.
- **G3, parity goldens.** Any new `ctx.rng` draw on a shared code path shifts
  draw order and reds every golden. Frontier draws (team tiebreak) happen only
  inside frontier code paths. If a golden reds, the fix is the code, never
  `UPDATE_PARITY=1` on an existing scenario.
- **G4, i18n gates bite.** Known from prior work: new catalog keys have failed
  `tests/i18n_completeness` when the generated files were not rebuilt and
  committed (`npm run i18n:scan && npm run i18n:build`, commit
  `i18n.resolved.generated/` + `i18n.status.summary.json`). Run the test
  locally before pushing. Do not hand-edit locale overlays except for the M16 five
  non-Latin fills required alongside new wordy English values.
- **G5, `hostile` flag vs `isHostileTo`.** Mob hostility is a template flag;
  player hostility is ONLY the `isHostileTo` clauses. Do not set any
  `hostile`-like flag on players; the frontier clause is positional.
- **G6, worktree discipline.** Other sessions may carry uncommitted work. Build each
  slice in a fresh worktree outside the shared checkout, based on the active release
  branch, with branch `feature/frontier-p1-s<N>`.

## 6. Agent dispatch template (for later; do not dispatch yet)

Give one implementation owner the slice outcome, acceptance criteria, relevant files,
section 0 ground rules, section 1 constants, applicable hook-map rows and gotchas, the
authorized actions, and validation commands. Use the active model and reasoning setting;
do not bake a model name into the packet. Require a diff summary, exact command results,
remaining manual verification, and a clean handoff. Run `$woc-qa` before merging each
slice, then use S9 for the combined gate.
