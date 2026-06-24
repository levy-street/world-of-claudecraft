# Delve System Rebuild on upstream v0.8.0 — complete instructions

Author handoff for rebuilding the delve feature against the latest upstream
release instead of continuing to patch `feature/delves`.

Last updated: **2026-06-17**

---

## 0. The one thing to read before you start

**Delves are your own feature.** Upstream `origin` (`levy-street/world-of-claudecraft`)
has **zero** delve code, all the way through its latest release **v0.8.0** and
`origin/main`. So this is not "merge upstream's new delve system" — it is
"re-apply *your* delve feature on top of a codebase that moved 108 commits."

Branch topology (measured):

| Ref | What | Position |
|---|---|---|
| `6516fa41` | fork point (PR #462) | merge-base of your branch & upstream |
| `feature/delves` | your delve work | **17 commits ahead**, **108 behind** `origin/main` |
| `v0.8.0` (tag) | latest upstream **release** | the rebuild baseline you chose |
| `origin/main` `2456da98` | newest upstream (108 ahead of fork) | has post-v0.8.0 hotfixes |
| `release/v0.8.0-fixes` | upstream's post-release fix branch | between the two |

**Honest caveat about *why* you're rebuilding.** My evidence (offline puppeteer,
Chromium) shows the delve render path is *correct* — module 0 renders perfectly
once the interior GLBs finish loading. Your persistent black screen is on
**Firefox**, with **no asset-load errors** in the console (only a harmless
`/api/project-stats` 502 because no `npm run server`). That pattern says
**Firefox/GPU/shader**, not delve architecture. A rebuild reuses the *shared*
`DungeonInteriors` shader path, so:

- If the black is a Firefox shader bug in the shared dungeon renderer, the
  rebuild only helps **if v0.8.0's 108-commits-newer renderer happens to have
  fixed it.** That is plausible but **not guaranteed**.
- Therefore **Step 1 is a hard gate.** Do not port a single line until it passes.

---

## 1. Pre-flight diagnosis — GATE (do this first, ~15 min)

Prove the rebuild can even fix your symptom before investing days in it.

```bash
git fetch origin --tags
# scratch worktree on the clean release — your branch stays untouched
git worktree add ../woc-v0.8 v0.8.0
cd ../woc-v0.8
npm ci
npm run dev
```

In **Firefox** (your failing browser), with vanilla v0.8.0 (no delves yet):

1. Play Offline → walk into an **overworld dungeon** (Hollow Crypt / any dungeon
   door). It uses the **same** `DungeonInteriors` + shaders delves reuse.
   - **Black / void** → the shared dungeon renderer is broken on your
     Firefox/GPU even on the latest release. **STOP — rebuilding delves will not
     fix this.** Capture `about:support` (GPU, ANGLE/driver), try Chrome, try
     toggling `webgl.force-enabled` / hardware acceleration. Fix the renderer or
     switch browser/GPU first.
   - **Renders fine** → the newer renderer resolves it; the rebuild is worth
     doing. Proceed.
2. Cross-check: open your *current* `feature/delves` delve in **Chrome/Edge**. If
   it renders there, the bug is 100% Firefox-specific and Step 1.1's result is
   the deciding signal.

Record the outcome at the top of this doc before continuing.

---

## 2. Create the rebuild branch (worktree keeps the old one intact)

```bash
# from the main checkout
git fetch origin --tags
git worktree add ../woc-delves-v2 v0.8.0    # or origin/main for newest fixes
cd ../woc-delves-v2
git switch -c feature/delves-v2
npm ci
```

**Baseline choice:** you picked "latest release" = **`v0.8.0` tag** (stable,
reproducible). If you'd rather ride the newest hotfixes (turnstile/session
fixes landed post-release), base on `origin/main` instead — same steps.

---

## 3. Inventory — port vs re-author

Your 17 commits touched 38 files. Split them by nature:

### A. Clean, self-contained — copy almost verbatim
These are *new* files with few outward deps; `git checkout feature/delves -- <path>`
then fix imports:

- `src/sim/delve_layout.ts`
- `src/sim/content/delves/` (`index.ts`, `collapsed_reliquary.ts`, `_placeholder.ts`,
  `affixes.ts`, `companions.ts`, `mobs.ts`)
- `src/render/delve_interiors.ts`, `src/render/interior_kit.ts`
- `src/ui/delve_i18n.ts`
- `docs/prd/delves.md`, `docs/prd/PLAYTEST_OFFLINE.md`
- `scripts/delve_crypt.mjs`
- `tests/delve_*.test.ts`, `tests/delves.test.ts`

### B. Invasive edits into shared core — **re-author against v0.8.0**
These files moved upstream; do NOT blind-merge. Re-apply the delve hooks by hand:

| File | Your delta | Risk on v0.8.0 |
|---|---|---|
| `src/sim/sim.ts` | **+1069** (enterDelve/leaveDelve/advanceModule/companion/tombstone/run mgmt) | **Highest** — tick structure & regions likely moved |
| `src/ui/sim_i18n.ts` | +373 | i18n matcher; S3 guard |
| `src/ui/hud.ts` | +188 (board, tracker) | HUD is ~5k lines, churns |
| `src/sim/types.ts` | +164 (DelveRun, SimEvent variants, consts) | union/exports moved |
| `src/sim/data.ts` | +163 (origins, slot/module helpers, DELVES tables) | world-layout consts |
| `src/render/renderer.ts` | +155 (camera branch, prebuild, ambience) | **see §4 note — drop most of this** |
| `src/ui/i18n.ts` | +86 (keys) | `: typeof en` enforcement |
| `src/sim/colliders.ts` | +51 (delve collider derivation) | |
| `server/game.ts` | +41 (online run wiring) | |
| `src/world_api.ts` | +39 (IWorld delve seam) | the seam — do this first |
| `src/net/online.ts` | +24 (ClientWorld delve mirror) | snapshot wire |
| `src/ui/entity_i18n.ts` | +21 | |
| `src/render/dungeon.ts` | +18 | |
| `src/game/interactions.ts` | +12 | |
| `src/main.ts` | +14, `index.html` +27 | entry wiring |

---

## 4. Port order — sim core outward (respects the architecture)

Follow the repo rule: **extend `IWorld` first, implement in BOTH `Sim` and
`ClientWorld`.** Port + test one layer before the next.

1. `sim/types.ts` — delve types, `DelveRun`, `SimEvent` variants, tuning consts.
2. `sim/data.ts` — `DELVE_X_MIN`, `delveOrigin`/`delveSlotAt`/`delveModuleLocal`,
   `DELVES`/`DELVE_LIST`/`DELVE_MODULES` tables, `isDelvePos`/`delveAt`.
3. `sim/content/delves/*` — drop in (group A), register into the data.ts tables.
4. `sim/colliders.ts` — delve collider derivation (`layoutColliders` reuse).
5. `sim/delve_layout.ts` — drop in (group A).
6. `sim/sim.ts` — the big one: `enterDelve`/`leaveDelve`/`advanceDelveModule`,
   companion spawn, tombstone exit, `delveRuns` lifecycle, `delveRun` getter.
   Re-place each block into v0.8.0's current tick regions (read its
   `sim.ts navigation map` banner comments). **Run `tests/delves.test.ts` now.**
7. `world_api.ts` — `IWorld` delve members (`enterDelve`, `delveRun`, companion…).
8. `net/online.ts` + `server/game.ts` — mirror run/companion in snapshots; match
   v0.8.0 wire field names exactly (`tid`, `lv`, …). Re-run `snapshots.test.ts`.
9. `render/dungeon.ts`, `render/delve_interiors.ts`, `render/interior_kit.ts`.
10. `render/renderer.ts` — **port only the minimum:** build interiors on
    `delveEntered`, ambience/fog = dungeon for `isDelvePos`. **Do NOT port the
    camera churn** (`clampChaseCameraInModule`, fog-band hacks, `frustumCulled=false`,
    immediate-prebuild). Those were 5–6 commits chasing a bug that was never the
    camera (asset-load cache + Firefox). Start from v0.8.0's clean chase cam; add
    only a simple AABB clamp inside the module if the cam actually clips a wall in
    playtest. Less code, fewer regressions.
11. `ui/hud.ts` — delve board, tier select, tracker.
12. i18n: `ui/i18n.ts` + `sim_i18n.ts` + `entity_i18n.ts` + `delve_i18n.ts`. The
    original work **deferred real i18n** (English via the matcher). Decide now:
    do it properly (keys in every locale — see root `CLAUDE.md` i18n invariant +
    `tests/localization_fixes.test.ts`) or keep English-via-matcher and keep it
    out of `main`.
13. `index.html`, `main.ts` — entry wiring (delve board open hook, globals).
14. Port `tests/delve_*` + `tests/delve_companion.test.ts`; fix
    `interactions.test.ts` / `localization_coverage.test.ts` deltas.

---

## 5. Carry the two real bug fixes I already made

Independent of the rebuild, these are genuine latent bugs (a rejected asset
promise poisons the cache for the whole session — permanent black void with no
retry). Apply the same two edits to v0.8.0's copies of these files:

- `src/render/assets/loader.ts` — in `loadGltf`, evict the `gltfCache` entry on
  reject so a later call re-fetches (mirrors `releaseGltf`).
- `src/render/dungeon.ts` — in `ensureDungeonAssets`, `.catch` → set
  `dungeonAssetsPromise = null` and rethrow, so the memo doesn't cache rejection.

Regression harness: `scripts/delve_assetfail.mjs` (aborts each dungeon GLB's
first load; asserts the room still appears via retry). Keep it.

---

## 6. Fix the pre-existing type errors while you're in here

`tsc --noEmit` on `feature/delves` already fails (independent of my changes):

- `src/sim/content/delves/*` + `_placeholder.ts`: `readonly` spawn tuples not
  assignable to mutable `DungeonSpawn[]` — drop `as const` or widen the type.
- `src/sim/sim.ts:8339`: `"heal"` not in `"nova" | "projectile" | "tick"` (an
  FCT/event kind). Add `"heal"` to the union or map it.

Don't carry these into v2 — fix at port time.

---

## 7. Verification gates (don't defer browser testing — that's how you got here)

Run at every milestone, not just the end:

```bash
npx vitest run tests/delves.test.ts tests/delve_render.test.ts \
  tests/delve_colliders.test.ts tests/delve_companion.test.ts
npx tsc --noEmit
npm run build
node scripts/delve_assetfail.mjs        # asset-resilience regression (needs dev)
```

Manual, **in BOTH Firefox and Chrome**, after §4 step 10 (first time geometry
renders) and again at the end:

1. Play Offline → `/dev level 12` → enter Collapsed Reliquary.
2. Walk the east wall + orbit. Confirm floor/walls render, no void.
3. Clear room → tombstone → next module. Reach finale.

If Firefox is black but Chrome is fine at step 10, **stop and fix the renderer**
— the delve logic is done and the problem is the shared shader path, exactly the
§1 gate result. Capture the shader info log + `about:support`.

---

## 8. Faster alternative: replay your commits, drop the bad ones

Instead of a manual re-author you can rebase your history onto v0.8.0:

```bash
git switch -c feature/delves-v2 feature/delves
git rebase --onto v0.8.0 6516fa41
```

Expect heavy conflicts in `sim.ts` / `hud.ts` / `renderer.ts` (108-commit drift).
When resolving, **deliberately drop** these render/camera commits (they fixed a
non-bug and add complexity):

- `4d6b0471`, `7ef19368`, `76499f2e` (camera bounds / align / prebuild churn)
- `a532674c` (handoff doc for the render fix)
- the camera-clamp parts of `5cdee1ca`, `2a126df2`

Keep the feature commits (`0875a089`, `bcd16558`, `90c3e4f6`, `d66d9f18`,
`e99dd373`, `efbb557b`, `e1f0ba69`, `3c218e94`, `11959e4f`, `0ecde560`). Then
re-add a *minimal* delve camera clamp + the §5 asset fixes as fresh commits.

Recommendation: **§4 manual port for `sim.ts`/`hud.ts`/`renderer.ts`** (cleaner
against drifted code) + **cherry-pick group-A files**. Pure `git rebase --onto`
tends to produce sim.ts conflict soup at +1069 lines.

---

## 9. When done

- Squash-or-curate history, PR `feature/delves-v2` → your `fork`, not upstream
  (delves aren't an upstream feature).
- Update `docs/prd/delves.md` if behavior changed; delete the stale
  `DELVE_CONTINUE_HANDOFF.md` (it chased the wrong layer).
- Clean up worktrees: `git worktree remove ../woc-v0.8 ../woc-delves-v2`.
