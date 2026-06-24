# Delve Lockpicking Minigame — "Tumbler's Path"

**Status:** Plan (feasible, repo-adapted). Supersedes the path proposals in the
original `PRD-lockpicking-minigame.md` draft; the *design* there stands, the
*file layout* here is the real one for this repo.

> A side-scrolling depth puzzle (borrowed from the OSRS balloon-flight mechanic,
> reskinned as a lock) replaces the generic cast-bar on a Delve's final-chapter
> chest. The marker only advances on player input, so the whole thing is
> turn-based and trivially server-authoritative — one action enum per step, the
> server owns all state and outcomes.

The design pillars, core mechanic, board math, ante-as-loot-tier model, and
difficulty dials are unchanged from the source PRD (see §2–§6 there). This
document is the **engineering plan**: where each piece lives in *this* codebase,
how it rides the existing seams, the milestone order, the test plan, and the
art-asset shopping list.

---

## 0. The one structural decision: no `shared/`, everything pure goes in `src/sim/`

The source PRD assumes a `shared/minigames/lockpick/` folder. This repo has no
such thing. Instead it has a hard invariant (`CLAUDE.md`, `src/CLAUDE.md`):

> **One sim, three hosts.** The exact same `src/sim/` code runs the offline
> browser world, the online server, and the RL env. `src/sim/` has zero
> DOM/Three/`net` imports and never reaches into `render/`/`ui/`.

That invariant *is* the "shared" layer. So:

| PRD proposed | Real home in this repo |
|---|---|
| `shared/minigames/lockpick/types.ts` | new types in **`src/sim/types.ts`** + a new **`src/sim/lockpick.ts`** module |
| generator + step logic + solver | **`src/sim/lockpick.ts`** (pure, deterministic, no DOM) |
| per-band difficulty presets (data-as-code) | **`src/sim/content/delves/lockpick_tiers.ts`** |
| server session state machine | methods on the existing `Sim` class in **`src/sim/sim.ts`**, driven from **`server/game.ts`** |
| `client/ui/minigames/lockpick/` | new **`src/ui/lockpick_panel.ts`** + DOM in `index.html`, wired from **`src/ui/hud.ts`** |
| protocol (`lockpick.engage` …) | flat command strings in the `server/game.ts` `switch (msg.cmd)`; `SimEvent` variants in `src/sim/types.ts` |
| Postgres `DelveChestState` | in-memory on **`DelveRun.objectState`** (it's per-run, never crosses runs) |

Because advancement is input-driven, the minigame does **not** touch the 20 Hz
movement/tick reconciliation path at all. It's request/response over the
existing command + per-player event channel.

---

## 1. How it slots into the *current* delve flow

The live chest flow today (`src/sim/sim.ts`):

```
onDelveBossDefeated(run)         spawns 'reward_chest' on the dais → sets run.rewardChestId
delveInteract(objectId, pid)     switch on object kind …
  case 'reward_chest':           grantDelveRewards(run); state.triggered = state.open = true;
                                 openDelveSurfaceExit(run);
```

We insert the minigame **between** "interact with chest" and "grant rewards":

```
onDelveBossDefeated(run)         spawn 'locked_chest' instead of 'reward_chest';
                                 set run.objectState[id].attemptAvailable = true
delveInteract(objectId, pid)
  case 'locked_chest':           // first touch only opens the ante selector UI
                                 emit { type: 'lockpickOffer', objectId, tiers, pid }
                                 // (no session yet — player picks an ante first)
lockpickEngage(objectId, ante, pid)   validate proximity / not looted / attemptAvailable
                                       generate lock (seed = run.seed ^ (objectId * 0x9e3779b1) >>> 0), open session
                                       emit { type: 'lockpickSession', … pid }   // fogged view only
lockpickAction(sessionId, action, pid) one step; emit { type: 'lockpickStep', … pid }
  … on SUCCESS:                   grantDelveRewards(run) using the tier-keyed loot table;
                                 state.open = true; attemptAvailable = false;
                                 openDelveSurfaceExit(run); emit lockpickEnd
  … on FAILED (lives→0):          attemptAvailable = false (chest lost; re-clear delve);
                                 emit lockpickEnd
```

`'reward_chest'` stays in the codebase as the legacy/fallback chest so we can
ship the minigame behind a per-delve flag (see §8) and A/B it; the finale that
gets the new chest is the vertical slice.

---

## 2. File-by-file work plan (real paths)

### 2.1 Pure core — `src/sim/` (no DOM, deterministic, runs everywhere)

**`src/sim/types.ts`** — add:
- `PickAction`, `ACTION_DELTA`, `Ante`, `LootTier`, `ANTE_TO_TIER`, `LockTierSpec`,
  `LockSpec`, `LockSession`, `StepResult`, `VisibleCell` (the §9 types from the
  source PRD, verbatim shapes).
- Extend `DelveObjectState.kind` union with `'locked_chest'`.
- Add the per-object lock fields to `DelveObjectState` (or a sibling record on
  `DelveRun`): `attemptAvailable: boolean`, `looted: boolean`,
  `lootedByCharId?: string`, `lootedTier?: LootTier`.
- Add new **`SimEvent`** variants (all `pid`-scoped / personal):
  ```ts
  | { type: 'lockpickOffer';   objectId: number; antes: Ante[] }
  | { type: 'lockpickSession'; sessionId: string; objectId: number;
      w: number; h: number; startRow: number; lives: number;
      lootTier: LootTier; visible: VisibleCell[] }
  | { type: 'lockpickStep';    sessionId: string; pos: { col: number; row: number };
      lives: number; result: StepResult; revealed: VisibleCell[] }
  | { type: 'lockpickEnd';     sessionId: string; outcome: 'success' | 'fail' | 'abandoned';
      lootTier?: LootTier }
  ```
  These carry **stable data, not prose** — the client builds all visible strings
  from `t()` keys, so no English crosses the sim boundary (satisfies the i18n
  invariant; see §6).
- Add transient session state to `PlayerMeta`: `lockpick: LockSession | null`
  (session-only, never serialized — init `null` in `createPlayer`).

**`src/sim/lockpick.ts`** (new, pure) — the heart of it:
- `generateLock(seed, tier): LockSpec` — reverse construction from §6 of the
  source PRD (carve a guaranteed solution path first, then wrap wards). Uses a
  child `Rng` (`src/sim/rng.ts`: `new Rng(seed)`, `.int(min,max)` inclusive,
  `.pick(arr)`).
- `solveLock(spec): boolean` — BFS from `(0, startRow)` to the bolt seat; used by
  the generator's assertion **and** by tests. Must return true for every
  generated spec (an ante of 1 / flawless must always be *possible*).
- `stepLock(spec, session, action): { result, pos, lives }` — the authoritative
  step function from §4.3 (clamp, ward → slip, gate mismatch → bind, seat → success).
- `visibleCells(spec, col, window): VisibleCell[]` — returns **only** cells inside
  the visibility window. This is the single source of truth for fog and the
  anti-cheat boundary; the server never serializes anything else.
- No `Sim` dependency — takes plain `LockSpec`/state in, returns results out, so
  it's unit-testable in isolation.

**`src/sim/content/delves/lockpick_tiers.ts`** (new, data-as-code) — the
`LockTierSpec` presets keyed to the existing `DelveDef` tier ids. Today only the
Collapsed Reliquary ships, so author presets for its real tier ids and leave a
clearly-marked TODO to add Mirefen/Thornpeak bands when those delves land. See
§7 for the starting numbers.

**`src/sim/sim.ts`** — the session state machine as `Sim` methods (mirrors how
`lootCorpse`, `enterDelve`, `delveInteract` already live here):
- `lockpickEngage(objectId, ante, pid)` — validate proximity, `attemptAvailable`,
  not `looted`, valid ante, no live session; `generateLock(run.seed ^ (objectId *
  0x9e3779b1) >>> 0, tierFor(run))` (objectId is Fibonacci-hashed so sequential
  per-run chest ids do not yield near-identical boards; matches the per-page
  derivation in `lockpick.ts`); build `LockSession` with `livesLeft = ante`,
  `lootTier = ANTE_TO_TIER[ante]`; store on `meta.lockpick`; emit `lockpickSession`
  with only the fogged `visibleCells(...)`.
- `lockpickAction(sessionId, action, pid)` — ownership + rate-limit (≥80 ms via
  the sim clock / tick count, generous since turn-based) + terminal-state guards;
  call `stepLock`; on success roll loot from the tier-keyed table and run the
  existing grant + surface-exit path; emit `lockpickStep` (+ `lockpickEnd` on
  terminal).
- `lockpickAbort(sessionId, pid)` — teardown; **preserve** `attemptAvailable`
  (default, disconnect-friendly — see §8 Q2).
- Hook disconnect/leave/zone-out (existing `leavePlayer`/leave-delve paths) to set
  the session `ABANDONED` and null `meta.lockpick`.
- `rollDelveChestLoot(run, tier)` — new, modeled on `rollLoot`; reads a
  tier-keyed `LootEntry[]` table (premium/medium/low) from the delve content,
  uses `this.rng`, and grants through the existing `addItem` / tap-rights path
  (`partyMembersForKey`). The client can never self-report loot or tier.

### 2.2 The seam — `src/world_api.ts` (extend first, then both worlds)

Per `src/CLAUDE.md`, new presentation data/actions go through `IWorld` **first**,
then get implemented in both `Sim` and `ClientWorld`.

- Add read state: `lockpick: LockpickViewState | null` (the fogged, render-safe
  projection: board dims, visible cells, pos, lives, tier, last result).
- Add actions: `lockpickEngage(objectId, ante)`, `lockpickAction(action)`,
  `lockpickAbort()`.
- Define `LockpickViewState` / `LockpickViewCell` in `world_api.ts` (it may import
  `sim/` *types* only).

### 2.3 Online client — `src/net/online.ts`

`ClientWorld implements IWorld` by mirroring snapshots + draining events:
- `lockpickEngage/action/abort` → send `{ cmd: 'lockpickEngage', … }` etc. over
  the existing WS send path (same pattern as `loot`/`use`).
- In `onMessage`'s `events` handling, the new `lockpick*` `SimEvent`s already flow
  into `eventQueue` and out via `drainEvents()` — no special-casing needed there.
- Maintain `this.lockpick: LockpickViewState | null`, updated from the
  `lockpickSession`/`lockpickStep`/`lockpickEnd` events as they're drained (or
  keep it event-only and let the HUD own the view — see §2.4). Expose it as the
  `IWorld.lockpick` field.

> Note: the offline `Sim` path can satisfy `IWorld.lockpick` directly off
> `meta.lockpick` + `visibleCells(...)`; the online path rebuilds it from events.
> Either way the UI reads only `world.lockpick` — never the full `LockSpec`.

### 2.4 Client UI — `src/ui/`

- **`src/ui/lockpick_panel.ts`** (new) — the panel, modeled on the existing
  on-demand modal pattern in `hud.ts` (`inputDialog()` ~L3101 for the chrome +
  interactive surface; `toggleArena()`/`renderArenaWindow()` for a panel that
  re-renders on input). Renders the visible board slice as chunky `.window.panel`
  cells (wards = carved metal, channel = keyway shadow, gates highlighted, bolt
  seat marked), fog plate beyond the window, lives pips, tier readout, five action
  buttons (disabled when not in `allowedActions`). Pure-ish view helpers (board →
  draw primitives) can live here and be snapshot-tested like `delve_map.ts` /
  `xp_bar.ts` do.
- **`src/ui/hud.ts`** — wire it: on `lockpickOffer` event open the **ante
  selector** ("Play with 1 / 2 / 3 picks", each showing its loot tier + margin);
  on `lockpickSession` open the board; on `lockpickStep` update cells/pips/feedback;
  on `lockpickEnd` close with success/fail juice. All dispatch goes through
  `world.lockpick*`. Follow the existing `// ----` banner + `onEvent` structure.
- **`src/game/keybinds.ts` + `src/game/input.ts` + `src/main.ts`** — add the five
  pick keys (Hard set / Set / Steady / Ease / Drop) + Withdraw as `BIND_ACTIONS`
  entries (category "Action Bar" or a new "Lockpick" category), extend the
  `InputCallbacks.onUiKey` union, add `case`s in `dispatchEdge`, wire callbacks in
  `main.ts`. Default binds from the source PRD §4.2 (W/E/Space/D/S, Esc). Keys
  only do anything while the panel is open; otherwise pass through.
- **Procedural feedback** — reuse `src/game/audio.ts` for soft tick / gate
  "click" / scrape / lid-pop SFX (no new audio assets needed; it's procedural
  WebAudio). Honor `prefers-reduced-motion`; gates/seat get an icon/pattern, not
  color alone (a11y per `src/ui/CLAUDE.md`).

### 2.5 Server — `server/game.ts`

- Add cases to the `switch (msg.cmd)` (~L781), each calling the matching `Sim`
  method, exactly like `case 'loot': sim.lootCorpse(msg.id, pid)`:
  - `case 'lockpickEngage': sim.lockpickEngage(msg.id, msg.ante, pid)`
  - `case 'lockpickAction': sim.lockpickAction(msg.sid, msg.action, pid)`
  - `case 'lockpickAbort':  sim.lockpickAbort(msg.sid, pid)`
- Validate `msg.ante ∈ {1,2,3}` and `msg.action` is a known `PickAction` at the
  boundary (defense in depth; the sim re-validates).
- `routeEvents` already personal-routes `pid`-scoped events — the `lockpick*`
  events ride it for free, delivered only to the acting player (+ optional
  spectators, stretch).

### 2.6 Persistence — `server/db.ts` / `src/sim/sim.ts`

**No schema migration.** Lock attempts are per-run and never cross runs, so:
- The live `LockSession` is **in-memory only** on `meta.lockpick` (like other
  transient combat state) — torn down on end/disconnect.
- The "fail → must re-clear the delve" gate is the in-memory
  `DelveRun.objectState[id].attemptAvailable`, set true on boss-defeat / chest
  spawn and false on SUCCESS *or* FAILED.
- Nothing new persists to `characters.state` JSONB. (`delveClears` etc. already
  record the *clear*; the chest outcome doesn't need to survive a relog because an
  abandoned run's live state is gone anyway and the delve must be re-cleared.)

---

## 3. Protocol summary (concrete shapes)

**Client → server** (flat `cmd` strings, the repo convention):
```
{ cmd:'lockpickEngage', id:<objectId>, ante:1|2|3 }
{ cmd:'lockpickAction', sid:<sessionId>, action:'hardSet'|'set'|'steady'|'ease'|'drop' }
{ cmd:'lockpickAbort',  sid:<sessionId> }
```
**Server → client**: the `lockpick*` `SimEvent` variants in §2.1, personal-routed.

Anti-cheat (enforced server-side, never weakened): server holds the full
`LockSpec`; only `visibleCells(...)` inside the window is ever serialized; every
action is validated for legal delta / bounds / ownership / live session / rate;
loot + tier are derived server-side from the recorded ante and are immutable;
terminal-state actions rejected; one live session per (player, chest).

---

## 4. State machine

Unchanged from source PRD §8. Mapped to real teardown hooks: `ABANDONED` fires
from the existing `leavePlayer` / leave-delve / zone-out paths nulling
`meta.lockpick`. Default: `ABANDONED` **preserves** `attemptAvailable`;
`SUCCESS`/`FAILED` consume it.

---

## 5. Test plan (Vitest, repo conventions)

Tests follow the repo's "each file has its own tiny local `makeSim` helper, poke
internals via `(sim as any)`, assert on `SimEvent[]` from `tick()`" pattern.

- **`tests/lockpick_gen.test.ts`** (pure, no `Sim`) — for N seeds per tier:
  `solveLock(spec)` is true; gate columns have exactly one open row; start/seat
  rows are open; every post-trim open cell is reachable from the previous column.
  Determinism: same `(seed, tier)` ⇒ identical `LockSpec`.
- **`tests/lockpick_step.test.ts`** (pure) — table-driven `stepLock` cases:
  advance / slip / bind / success across mistake modes and edge clamping.
- **`tests/lockpick_command.test.ts`** (sim) — modeled on
  `tests/dungeons_command.test.ts` / `delves.test.ts`: enter the reliquary finale,
  kill boss, spawn `'locked_chest'`, `lockpickEngage` at each ante, drive
  `lockpickAction` through a known-solvable path → assert loot granted exactly
  once at the right tier, `attemptAvailable` flips correctly, ante-1 slip ⇒ FAILED
  ⇒ re-engage rejected, abandon preserves the attempt. Determinism assertion
  (same seed twice ⇒ same result).
- **Fog boundary** (server-ish) — assert no out-of-window cell is ever present in
  any emitted `lockpickSession`/`lockpickStep` payload (serialize and scan).
- **`tests/localization_fixes.test.ts`** (the S3 i18n guard) — must stay green:
  the sim/server emit only keys+data, the client matcher (`src/ui/delve_i18n.ts` /
  `sim_i18n.ts`) resolves any English. New UI strings go in `en` first, then all
  14 locales (see §6).
- **E2E (stretch, `scripts/*.mjs`)** — engage→flawless→premium; one-slip→continue
  →medium; ante-1 slip→fail→locked-out; disconnect→abandoned→re-engage. Needs
  `npm run dev` + `npm run server` (+ `ALLOW_DEV_COMMANDS=1` to teleport/clear in
  dev only).

Run a single file while iterating: `npx vitest run tests/lockpick_gen.test.ts`.

---

## 6. i18n (the invariant that bites)

Every player-visible string is a `t()` key in **all 14 locales**
(`Object.keys(translations)` in `src/ui/i18n.ts` — author against that, not a
printed list). For this feature:
- **All board/ante/feedback prose lives client-side** as new `t()` keys (group
  them under a `lockpick.*` namespace in `en` first, then translate to every
  locale). The board itself is symbols/cells, not text — but the ante labels,
  tier names, margin descriptions ("flawless required" / "1 slip" / "2 slips"),
  slip/success/fail toasts, and the "this lock won't budge — re-clear the delve"
  diegetic message are all keys.
- **The sim/server emit zero prose** — only the structured `lockpick*` events
  (§2.1). That keeps `src/sim/` language-agnostic and means there's no English to
  re-localize through `sim_i18n.ts`. If any English string *does* leak from the
  sim (e.g. a reused `log` event), register it in `src/ui/sim_i18n.ts` /
  `server_i18n.ts` in the same change or the S3 guard fails.
- Numbers (lives, tier counts) go through `formatNumber`; no raw concatenation.

---

## 7. Difficulty presets (starting numbers — tune via telemetry §14)

`LockTierSpec` dials (source PRD §5). Lock *difficulty* scales with the delve's
level band; *lives* are the player's ante, not a difficulty dial. **Default
(behind a flag, §8 Q1): layout is identical across antes** — the ante is a pure
error-margin gamble, premium is skill-gated on the same puzzle.

| Dial | Easy band | Mid band | Hard band |
|---|---|---|---|
| `rows` (H) | 6 | 6 | 7 |
| `cols` (W) | 11 | 14 | 18 |
| `width` (channel band) | 2 | 1 | 1 |
| `gateCount` | 1 | 3 | 4 |
| `visibilityWindow` | full (≥W) | 6 | 3 |
| `allowedActions` | all 5 | all 5 | no ±2 |
| `noiseThreshold` | — (off) | — (off) | — (off, v1) |
| `stepTimeoutMs` | — (no clock) | — | — |

Author these in `src/sim/content/delves/lockpick_tiers.ts` keyed to the real
Collapsed Reliquary tier ids (check `src/sim/content/delves/collapsed_reliquary.ts`
for the exact ids). Map "Easy/Mid/Hard band" onto whatever tiers that delve
exposes; add Mirefen/Thornpeak presets when those delves ship.

---

## 8. Open questions — resolved defaults (all reversible / flagged)

1. **Layout identical across antes, or scales with ante?** → **Default: identical
   across antes**, behind a flag `LOCKPICK_ANTE_SCALES_DIFFICULTY = false` in the
   tiers module. Premium is skill-gated, not a harder board. Flip later if
   telemetry shows the ante mix is degenerate.
2. **ABANDONED preserves or burns the attempt?** → **Preserves** (disconnect-
   friendly). The whole delve must still be re-cleared after a *FAILED*.
3. **Ante chosen once, or re-pickable after re-engage?** → **Re-pickable** on
   re-engage (since abandon preserves the attempt; you anted nothing).
4. **Lockpicking skill / Skeleton Key item?** → **Out of v1.** Difficulty = delve
   band only. Future hook: such an item could only ever *widen
   `visibilityWindow`*, never add lives or bypass server authority.
5. **Noise meter behavior?** → **v1: omit** (`noiseThreshold` unset). The field
   exists in `LockTierSpec` so it's a data-only switch to enable later (cosmetic
   first, then add-spawn).

---

## 9. Milestones (vertical slice = one reliquary finale chest end-to-end)

- **M0 — pure core + tests (offline, no server).** `src/sim/lockpick.ts`
  (`generateLock`/`solveLock`/`stepLock`/`visibleCells`), types in
  `src/sim/types.ts`, presets in `lockpick_tiers.ts`,
  `tests/lockpick_gen.test.ts` + `tests/lockpick_step.test.ts` green. Wire the
  offline `Sim` path + a throwaway local UI playing a fixed seed.
- **M1 — server-authoritative.** `Sim` session methods, `server/game.ts` command
  cases, fog enforcement, loot grant at tier on SUCCESS, `attemptAvailable`
  gating, `tests/lockpick_command.test.ts` + fog-boundary test green.
- **M2 — tiers in-world.** Presets wired to the reliquary's real tier ids;
  `IWorld.lockpick` implemented in both `Sim` and `ClientWorld`; ante→difficulty
  coupling left behind the default-false flag.
- **M3 — polish + UX.** `src/ui/lockpick_panel.ts` final art/juice, keybinds,
  all 14-locale strings, a11y pass (keyboard, reduced-motion, non-color cues),
  telemetry, tuning. Spectators + noise meter as tracked stretch.

Out of scope v1 (source PRD §17): co-op alternating control, affixes beyond fog
+ gate density, active hazards during the run, cosmetic pick/lock skins.

---

## 10. 3D / art assets needed (for later — Meshy MCP)

The minigame **board** is 2D procedural HUD (canvas/DOM, drawn in
`lockpick_panel.ts`) and needs **no 3D assets** — wards/channel/gates/seat are
drawn primitives, and SFX are procedural WebAudio. The renderer only needs the
chest itself to read as a *locked* chest in the world. So the asset list is short:

**Needed (hand to Meshy later):**
1. **Locked delve chest — closed state** — an ornate, heavy, banded chest with a
   prominent diegetic lock/keyhole plate, sized to sit on the existing reliquary
   `dais`. Should read clearly as "locked / not yet opened" at gameplay camera
   distance. (Replaces/augments the current `reward_chest` mesh for the finale.)
2. **Locked delve chest — opened state** (lid up + glow), or a separate lid mesh
   that animates, for the success "lid pop." Match the closed chest's silhouette.

**Optional / nice-to-have (skip for v1 unless cheap):**
3. A small **tension-wrench + pick** prop for the panel header art (could instead
   be a procedural `icons.ts` recipe — no 3D needed).
4. Per-band lock-plate variants (Reliquary / Mirefen / Thornpeak) for visual
   tiering — pure cosmetic, defer until those bands exist.

Everything else (board cells, fog plate, lives pips, tier readout, action button
glyphs) is procedural 2D and built in code — **no art order required**. Confirm
the current `reward_chest` mesh/material source in `src/render/delve_interiors.ts`
before ordering #1/#2 so the new chest matches the reliquary's material palette.

---

## 11. Verification checklist before "done"

- `npx vitest run tests/lockpick_gen.test.ts tests/lockpick_step.test.ts tests/lockpick_command.test.ts` green.
- `npm test` green (esp. `tests/localization_fixes.test.ts` S3 guard, `tests/delves.test.ts`).
- `npm run build` green (TS strict; all 14 locales compile — a missing key fails `tsc`).
- Determinism: same `(seed, tier)` ⇒ identical lock; same input sequence ⇒
  identical outcome (asserted in tests).
- Manual: ante selector → board → flawless solve → premium loot, exit opens;
  ante-1 slip → chest locked out until delve re-clear; disconnect mid-run →
  attempt preserved.
- Per `CLAUDE.md` Opus workflow: a fresh review subagent diffs the change for
  correctness/requirement gaps (fog never leaks full board; client never computes
  outcome or tier) before declaring done.
