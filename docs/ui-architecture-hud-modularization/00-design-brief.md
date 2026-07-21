# P0: UI Architecture and HUD Modularization Program

Status: Proposed (P0, top priority)
Owner: Fernando
Scope: `src/ui/` (primarily `hud.ts`), the client test/verification layer, and a quarantined `src/admin/` framework pilot
Non-goals: rewriting the renderer, the sim, or the netcode; adopting a frontend framework in the game HUD

---

## 0. How to read this document

This is an execution plan designed to be **split across many independent sessions**, possibly run by different agents concurrently on a shared worktree. It is not a design essay. It is a backlog of self-contained work items ("session cards"), each with its own goal, rationale, exact files and symbols, steps, and a runnable definition of done.

Every card is written so an agent (or person) can pick it up cold, with no memory of how we got here. The grounding facts are embedded on purpose so nobody re-derives them.

Three rules govern the whole program:

1. **The destination is correct; the sequence is the point.** Modularizing `hud.ts` is the right end state. But the first work is not extraction, it is building the test and gate scaffold that makes extraction verifiable. Skipping P0 and going straight to extraction is the single most dangerous thing we could do in this repo (see Section 3).
2. **Every card lands behind a check you can run.** `tsc`, `npx vitest run <file>`, `npm run build`, and the new gates this plan adds. Never "looks done."
3. **Small, leaf-first PRs.** One card, one PR, one reviewable diff. This is a deliberate optimization for an AI-authored, concurrent, shared-worktree repo (see Section 2).

A note on line numbers: every `file:NNN` reference below is an **approximate anchor as of this writing**. `hud.ts` is the highest-churn file in the tree, so line numbers will drift. **Anchor on the symbol name, not the number.** Re-grep before editing.

---

## 1. Executive summary

The codebase is healthy at its core (one deterministic sim, three hosts, a clean `IWorld` seam, a best-in-class i18n safety net). The pain you are feeling, "the vanilla approach isn't scaling," localizes almost entirely to one file: `src/ui/hud.ts`, a 6,280-line single `Hud` class holding ~16 windows, ~338 fields, ~172 methods, and 7 copy-pasted reactivity schemes.

A deep, multi-agent research pass (framework landscape) plus a grounded, adversarial pass (read the real code, then have three independent skeptics try to dethrone the recommendation) converged on this:

- **Do not adopt a frontend framework in the game HUD.** It would fight the rAF heartbeat, the read-only `IWorld` seam, and the hand-tuned per-frame gates, and it adds a second convention that hurts drive-by contributors. (Section 9 records why, so we never re-litigate it.)
- **Modularize `hud.ts` into per-window modules**, but **only after** building a verification scaffold, because the file is untested at runtime, hot-path, signature-fragile, the highest-churn file in the repo, and one of its "obvious" extractions is wired into a release gate by file path.
- **Performance is already well-tuned.** Treat perf as something to protect with a gate and harvest opportunistically, not as the headline initiative.
- **The admin SPA is the one safe place to pilot a framework.** Run it as an independent parallel track.

This plan turns that into an ordered, splittable backlog.

---

## 2. The core thesis: why an AI-authored open-source repo changes the calculus

The usual argument for tolerating a monolith is "a large-context model can just read the whole file." That is true and irrelevant. The tax of a 6,280-line hot file in this repo is not the cost to **read** it. It is:

- **Merge-conflict surface.** `hud.ts` was touched by roughly 155 of the last 200 commits, by ~16 to 20 distinct contributors, with dozens of live HUD-adjacent branches in flight. Human teams serialize through PR-review cadence; parallel agents on a shared worktree do not. Two agents adding two different windows collide in one file, inside hand-rolled `JSON.stringify` signature logic that does not auto-merge. In separate modules they never touch.
- **Per-change verification surface.** Every edit to `hud.ts` must re-prove the whole file's invariants: the i18n scanner parses it, the S3 localization guard reads its source text, and the >80% hot-write skip rate must still hold. Smaller modules shrink the blast radius each change must re-verify and let `npx vitest run <oneFile>` gate a change in seconds.
- **Targeted-edit reliability.** An exact-string edit on a unique anchor in a 200-line module is far more reliable for an agent than the same edit in a 6,280-line file containing seven near-duplicate signature blocks.

The conclusion: small, independently verifiable, low-conflict modules matter **more** in an AI-first repo, not less. And because there is no human reviewer holding a whole-file mental model, **the deterministic gates are the trust substrate that replaces that reviewer.** That is why building the gates (P0) precedes the refactor (P1+).

---

## 3. Ground truth (current state, so no session re-discovers it)

### 3.1 `src/ui/hud.ts`

- 6,280 lines. One `Hud` class. ~338 fields, ~172 methods, 538 `t()` calls, ~229 `this.sim` / `this.renderer` / `this.keybinds` coupling references.
- 119 hardcoded DOM queries coupling it to ~214 `id`s hardcoded in `index.html` (e.g. `#player-frame`, `#target-frame`, `#actionbar`, `#minimap`, `#spellbook`, `#bags`). These selectors are a contract; CSS and queries both depend on them.
- Constructor at `hud.ts:338` (clean dependency injection: renderer, keybinds, hooks are injected, not constructed internally). This is good news for testability.
- `update()` entry at `hud.ts:1556`. Three throttle tiers:
  - fast ~100ms (`hud.ts:1560`): includes `updateMinimap()` (canvas rasterization + entity pins, `hud.ts:1818`).
  - medium ~250ms (`hud.ts:1562`): quest tracker, party frames, trade window, arena status, map, vendor/loot distance checks (`hud.ts:1796-1809`).
  - slow ~500ms (`hud.ts:1564`): Social panel struct/content diff (`hud.ts:1819-1828`), Market refresh (`hud.ts:1830-1832`).
- **Per-frame core** (runs every frame, `hud.ts:1578-1741`): player HP/resource scales, target frame, cast bar (`setText`/`setTransform`), action bar with cooldown overlay and text, auras. This is the latency-critical path and must stay imperative.
- **Write-side dedup:** `hotWriteCache` (a `Map<HTMLElement,string>`, `hud.ts:270`) gates every DOM write through `setText`/`setDisplay`/`setTransform`/`setWidth` (~`hud.ts:482-505`, ~38 to 48 call sites). Tracks `hotDomWrites` vs `hotDomSkippedWrites`. **The skip rate must stay above ~80%.**
- **Recompute gating (the 7 copy-pasted schemes):** `lastTradeSig` (`hud.ts:287`), `lastPartySig` (`hud.ts:288`), `lastArenaSig` (`hud.ts:289`), `lastMarketSig` (`hud.ts:297`), `lastSocialStruct`/`lastSocialContent` (`hud.ts:317-318`, a dual struct-vs-content model that preserves typeahead), `lastPetBarSig` (`hud.ts:331`), and the aura signature (`hud.ts:1838`, an `id + ceil(remaining)` join cached as `__sig` on the element). Panel signature bodies: Market `hud.ts:3461`, Party `hud.ts:4747`, Trade `hud.ts:5471`, Social `hud.ts:1820-1828`.
- **Windows (each a self-contained render + toggle unit):** Spellbook `hud.ts:4191-4259`, Talents `hud.ts:4269+` (staged-edit model, loadouts, import/export), Market `hud.ts:3419+` (browse/sell/collect tabs), Social `hud.ts:5090+`, Trade `hud.ts:5435+`, Bags `hud.ts:2752+`, Character `hud.ts:3830+` (preview canvas), Arena `hud.ts:2064+`, QuestLog `hud.ts:3714+`, Minimap/Map `hud.ts:1875-2059`, Options/Keybinds `hud.ts:5549+`.
- **Client i18n matchers:** `localizeErrorText` (`hud.ts:2821`), `localizeSystemText` (`hud.ts:2928`), `localizeLootText` (`hud.ts:3012`). Each maps server/sim English to `t()` keys and falls back to `localizeServerText`.

### 3.2 The render loop and the seam

- Frame loop: `main.ts:901-978`, a recursive `requestAnimationFrame`. Per-frame sequence: input -> `sim.tick()` (fixed 50ms steps offline) -> `hud.handleEvents(events)` -> `renderer.sync(alpha, dt, facing)` -> `hud.update()` -> `perf.tick()`.
- The loop owns the tempo. The HUD never owns or pauses it. Modal state gates input only: `input.suspendMovement = hud.isModalOpen()` (`main.ts:910`).
- `IWorld` is the only seam: `src/world_api.ts:185-307`. Both `Renderer` and `Hud` take `private sim: IWorld` and never import `Sim`/`ClientWorld`/`net` internals. `renderer.sync()` is `renderer.ts:1019` and is strictly read-only on the world.

### 3.3 i18n safety net (the most mature subsystem; do not weaken it)

- `t()` is the sole runtime render sink. Keys are typed `TranslationKey = Leaves<typeof en, 6>`, so `tsc` rejects invalid keys. (2026-07-14: TranslationKey is now the build-generated flat union `src/ui/i18n.catalog/translation_keys.generated.ts` per toolchain-modernization decision D2; the tsc-rejects-invalid-keys guarantee is unchanged and strictly stronger.)
- The dense resolved table `src/ui/i18n.resolved.generated.ts` types every locale `: typeof en` (`EnTranslations`), so a missing or renamed key red-fails `tsc`.
- Source-agnostic layers stay English (`src/sim/`, `server/`) and are re-localized at the client boundary via the matchers plus `sim_i18n.ts` and `server_i18n.ts` mirrors.
- Registry `src/ui/i18n.status.json` (currently 0 pending, 46 blocked cognates). Two-tier CI: PR-tier permits English-only; release-tier (`I18N_RELEASE_TIER=1`) hard-fails on any pending key.
- **The landmine:** the S3/B1 guard in `tests/localization_fixes.test.ts` does `fs.readFileSync('src/ui/hud.ts')` and **regex-matches the matcher method bodies in that file by name and shape.** Extracting those matchers into a module red-fails the gate even when runtime behavior is identical. This must be decoupled before the matchers can move (card P0-3).

### 3.4 Performance reality

The per-frame core is already strategically tuned: write-dedup cache, 100/250/500ms tiers, distance-tiered animation mixer (`renderer.ts:1216-1218`), nameplate throttle 15Hz mobile / 24Hz desktop (`renderer.ts:1328`), pooled fire lights, and a ~473-line `perf.ts` that wraps each subsystem with `perf.time()` and exposes p95/max plus an overlay.

The remaining wins are real but micro and bounded (single-digit to low-tens of microseconds per frame):

- `AnimState` object literal allocated per visible entity per frame (`renderer.ts:1201`, ~9 fields). Poolable.
- Aura signature `e.auras.map().join()` every frame (`hud.ts:1838`), already gated behind a diff. Cheapen to a count plus rolling hash.
- Three `Set`s rebuilt from social/party lists every 100ms in the minimap (`hud.ts:1952-1954`). Cache behind a changed-flag.

### 3.5 The admin SPA (the safe framework sandbox)

- 4,644 LOC, separate `admin.html` Vite rollup input. `main.ts` 648 lines (auth, fetchers, delegated handlers), `tables.ts` 354 lines of HTML-string renderers, plus `api.ts`, `types.ts`, `charts.ts`, `format.ts`.
- Zero imports from `src/sim`/`render`/`ui`/`net` or `IWorld`. No rAF loop; only two timers (`LIVE_REFRESH_MS=5000`, `ACTIVITY_REFRESH_MS=60000`).
- Its own i18n pipeline with an **untyped** `t(key: string)` (no `typeof en` guard to break). ~34 hand-written `escapeHtml()` calls (an XSS-footgun class a framework's auto-escaping would retire).

### 3.6 The verification gaps (what P0 fills)

- **No DOM test environment installed at all** (no `jsdom`/`happy-dom`/`@vitest/browser` in `package.json`). The `Hud` class is never instantiated in a test. The existing `tests/client_shell.test.ts` does `expect(hudSource).toContain('...literal...')`, i.e. it greps the source as a string. This breaks on any reformat and verifies nothing about behavior.
- **No per-frame perf-budget assertion.** The >80% skip rate, the tier cadence, and the GC hot spots have zero regression protection.
- **`IWorld` parity is only half-covered.** `snapshots.test.ts` / `interest.test.ts` compare Sim vs ClientWorld for sim/net state, but nothing asserts the two worlds expose an identical **read surface** to render/ui, which is the exact contract a HUD refactor leans on.
- **No ESLint config and no test** enforcing the load-bearing sim-purity invariant. CLAUDE.md admits it is "enforced by convention only."

---

## 4. Invariants every card must preserve

These are non-negotiable. Any card that risks one of these names it explicitly under "Landmines."

1. **`IWorld`-only access.** Modules read the world through `IWorld`, never `Sim`/`ClientWorld` concretely.
2. **`t()`-only render sink.** Every player-visible (and operator-visible) string resolves through `t()`. No concat, fallback literals, `setAttribute('aria-label'|'title'|...)` literals, or `document.title` literals.
3. **DOM id/class contract.** The ~214 `id`s and the classes `index.html` and CSS depend on must stay byte-identical through any extraction.
4. **One shared `hotWriteCache`.** Extraction must thread the single cache instance through a context, never duplicate it per module, or the skip rate regresses.
5. **Signature stability.** Recompute signatures must keep exact diff semantics: they fire iff real state changed. A signature that silently stops detecting a change ships a stale-UI bug with no compile guard.
6. **Per-frame core stays imperative under rAF.** Player/target frame, cast bar, action bar, auras, minimap. No frameworkization, no per-frame allocations added.
7. **Determinism.** No `Math.random`/`Date.now`/`performance.now` creeping into sim-adjacent logic; sim stays DOM-free.
8. **Shared-worktree commit hygiene.** Stage only your card's files. Never `git add -A`. Commit nothing unrelated.

---

## 5. The roadmap at a glance

| ID | Card | Phase | Effort | Risk | Depends on |
|----|------|-------|--------|------|------------|
| P0-1 | DOM test harness (instantiate `Hud` against a fake `IWorld`) | P0 unlock | M | low | none |
| P0-2 | Perf-budget gate (hot-write skip rate >80%) | P0 unlock | S | low | P0-1 |
| P0-3 | Decouple i18n S3/B1 guard from `hud.ts` source text | P0 unlock | S | med | none |
| P0-4 | `IWorld` read-surface parity test | P0 unlock | S | low | none |
| P0-5 | Sim-purity import-boundary test + minimal ESLint rule | P0 orthogonal | S | low | none |
| P1-A | Extract `HotWriteGate` (wrap `hotWriteCache` + setters) | P1 primitives | M | med | P0-1, P0-2 |
| P1-B | Extract `ReactiveDiff<T>` / `StructuralDiff<S,C>` helper | P1 primitives | M | med | P0-1 |
| P1-C | Extract `IconService` | P1 primitives | S | low | P0-1 |
| P2-* | Extract on-demand windows, one per PR | P2 windows | L (sum) | med | P1-A, P1-B, P0-3 |
| P3-1 | Per-frame core perf hardening (GC micro-wins) | P3 perf | M | med | P0-2 |
| ADM-* | Svelte 5 admin pilot (parallel track) | parallel | M | low | i18n scan teaches `.svelte` |

Critical path: **P0-1 -> P0-2 -> P1-A -> P2-windows**. P0-3 unblocks the matcher-touching windows. ADM-* and P0-5 run anytime, in parallel, conflict with nothing in `hud.ts`.

---

## 6. Phase P0: make the HUD machine-checkable (the unlock)

Goal of the phase: turn the HUD's load-bearing invariants (render correctness, skip rate, i18n, seam parity) from "convention" into "failing test." Nothing downstream is safe until these exist.

### Card P0-1: DOM test harness

- Phase: P0 unlock. Effort: M. Risk: low. Depends on: none. Blast radius: additive (new dev dep + new test files + `vitest.config.ts`); does not modify `hud.ts`.

**Goal.** Be able to instantiate `Hud` against a fake `IWorld` in a DOM environment and assert rendered output.

**Why.** Today `Hud` is never constructed in a test; `client_shell.test.ts` greps the source string. There is no `jsdom`/`happy-dom` in `package.json`. Without a real harness, every later card is unverifiable.

**Files and symbols.**
- `package.json` (add `jsdom` or `happy-dom` as a devDependency).
- `vitest.config.ts` (opt specific files into the DOM env; keep the ~150 pure sim tests on the default node env for speed, via per-file `// @vitest-environment jsdom`).
- New `tests/helpers/fake_world.ts` (a hand-rolled `IWorld` stub: player, target, entities, inventory, equipment, known abilities, marketInfo, socialInfo, with mutators so a test can change state between frames).
- New `tests/hud_harness.test.ts`.
- Replace the string-scraping assertions in `tests/client_shell.test.ts`.
- Constructor anchor: `hud.ts:338`.

**Steps.**
1. Add the DOM dev dependency and wire `vitest.config.ts` so only opted-in files get the DOM env.
2. Build the minimal HUD DOM skeleton the constructor expects (mirror the `id`s from `index.html`) inside the harness, or load the relevant fragment.
3. Write `fake_world.ts` implementing the `IWorld` read surface render/ui consume.
4. Instantiate `Hud` against the fake world and a stub renderer/keybinds; drive `hud.update()` across the 100/250/500ms tiers with a controllable clock.
5. Assert that `#player-frame`, `#actionbar`, `#bags` etc. render text that came from `t()` (no raw English literals).

**Definition of done.** `npx vitest run tests/hud_harness.test.ts` is green; `Hud` is really instantiated (not grepped); the pure sim suite still runs on the node env at full speed; `npm run build` stays green.

**Landmines.** Do not flip the global vitest env to DOM (it slows the sim suite). Keep the fake world behind `IWorld` so the harness cannot accidentally depend on `Sim` internals.

### Card P0-2: perf-budget gate (hot-write skip rate)

- Phase: P0 unlock. Effort: S. Risk: low. Depends on: P0-1. Blast radius: additive test; reads existing `perfStats()`.

**Goal.** Fail CI if the `hotWriteCache` skip rate drops below ~80% over a steady-state frame sequence.

**Why.** The skip rate is a load-bearing perf invariant with zero protection. Any later extraction that fragments the cache or duplicates signature state would silently regress it while `tsc` stays green. This gate also protects the "performance" priority generally.

**Files and symbols.** `hotWriteCache` (`hud.ts:270`), `hotDomWrites`/`hotDomSkippedWrites` counters, `perfStats()`/`perfStats().hotDomSkipRate`. New `tests/hud_perf_budget.test.ts`.

**Steps.**
1. Ensure the skip-rate counters are readable from a test (expose via `perfStats()` if not already).
2. In the harness, run N frames on a busy fake world where most state is unchanged frame to frame.
3. Assert skip rate > 0.8 and that total write count is stable across identical frames.

**Definition of done.** `npx vitest run tests/hud_perf_budget.test.ts` green; deliberately introducing a redundant per-frame `el.textContent =` write (a scratch experiment) makes it fail. Wire it into the PR-tier `npm test` (no new CI job).

**Landmines.** Keep the threshold a single named constant with a comment so future tuning is one edit. Avoid asserting exact write counts that are brittle to legitimate UI additions; assert the rate and stability.

### Card P0-3: decouple the i18n S3/B1 guard from `hud.ts` source text

- Phase: P0 unlock. Effort: S. Risk: med (touches a release gate). Depends on: none. Blast radius: `tests/localization_fixes.test.ts` only.

**Goal.** Make the localization guard assert **runtime behavior** (the matchers localize a representative corpus across all `supportedLanguages`) instead of regex-matching the matcher method bodies inside `hud.ts`.

**Why.** Today the guard does `fs.readFileSync('src/ui/hud.ts')` and matches `private localizeSystemText/ErrorText/LootText(` plus their literal body. That means the "obvious" extraction of the matcher trio into a module red-fails the gate even though behavior is unchanged. The matchers cannot move until this is fixed.

**Files and symbols.** `tests/localization_fixes.test.ts` (the B1 and S3 groups). The matchers `localizeErrorText` (`hud.ts:2821`), `localizeSystemText` (`hud.ts:2928`), `localizeLootText` (`hud.ts:3012`).

**Steps.**
1. Identify every assertion in the guard that depends on `hud.ts`'s literal source shape.
2. Replace each with a behavioral assertion: feed known sim/server English strings through the public localization entry point and assert the output is the correctly localized `t()` result for each locale (and that an unrecognized string falls through deterministically).
3. Keep the S3 drift coverage intact (every sim/server emit still has a matcher or registered key); only change *how* it is checked, from source regex to runtime behavior.

**Definition of done.** `npx vitest run tests/localization_fixes.test.ts` green; moving the matcher trio into a new file in a throwaway branch does **not** break the guard (prove it locally, then revert the move; the actual move happens later as a window card).

**Landmines.** Do not reduce drift coverage. This card changes the assertion mechanism, not the contract. Coordinate loudly if another session is mid-edit on the matchers.

### Card P0-4: `IWorld` read-surface parity test

- Phase: P0 unlock. Effort: S. Risk: low. Depends on: none. Blast radius: additive test.

**Goal.** Assert that the offline `Sim` and the online `ClientWorld` expose the identical read surface that render/ui consume.

**Why.** A HUD refactor assumes panels are pure functions of `IWorld`. If the two worlds diverge on the client-facing surface, a panel correct offline can break online. Existing parity tests cover sim/net state, not this surface.

**Files and symbols.** `src/world_api.ts:185-307` (`IWorld`), the accessors render/ui read (`player`, `entities`, `known`, `equipment`, `inventory`, `marketInfo`, `socialInfo`, ...). Extend the pattern in `tests/snapshots.test.ts` / `tests/interest.test.ts`.

**Steps.**
1. Enumerate the accessor surface render/ui actually consume (grep `this.sim.` usages in `src/render/` and `src/ui/`).
2. On an identical seeded scenario, assert both `Sim` and `ClientWorld` expose the same shape/presence for that surface.

**Definition of done.** `npx vitest run` for the parity file is green; deleting an accessor from one world fails it.

### Card P0-5: sim-purity import-boundary test plus minimal ESLint rule (orthogonal)

- Phase: P0 orthogonal. Effort: S. Risk: low. Depends on: none. Blast radius: new test + new `eslint.config.js`; conflicts with nothing.

**Goal.** Convert two "convention only" invariants into machine checks: (a) `src/sim/**` imports nothing from the DOM, `three`, or `render`/`ui`/`game`/`net`; (b) no `Math.random`/`Date.now`/`performance.now` in `src/sim/**`.

**Why.** CLAUDE.md states the sim-purity rule is enforced by convention only. In an AI repo, a convention the compiler cannot see is one an agent will eventually break. This is the cheapest durable guardrail available.

**Files and symbols.** New `tests/architecture_boundaries.test.ts` (static scan of `src/sim/**/*.ts`). New flat `eslint.config.js` with a single `no-restricted-globals`/`no-restricted-syntax` rule scoped to `src/sim/**`; add `npm run lint` (or fold into `npm test`).

**Definition of done.** Both checks green on the current tree; a deliberately added `import 'three'` in a sim file or a `Math.random()` in sim logic fails.

---

## 7. Phase P1: extract the shared primitives (leaf-first)

Goal: define **once** the patterns currently duplicated across the file, as standalone unit-tested modules that `hud.ts` imports. These are additive and low-conflict; every `id` and the single cache stay in place. Do these before windows so windows consume the primitives instead of re-copying them.

Create a new folder `src/ui/hud/` to hold extracted modules.

### Card P1-A: extract `HotWriteGate`

- Phase: P1. Effort: M. Risk: med. Depends on: P0-1, P0-2.

**Goal.** Move `hotWriteCache` plus `setText`/`setDisplay`/`setTransform`/`setWidth` and the `hotDomWrites`/`hotDomSkippedWrites` counters into a standalone `HotWriteGate` class with its own unit test.

**Why.** It is the write-side dedup every panel needs. Extracting it first gives every later module one shared, injectable, individually testable gate, and locks the skip-rate invariant in a unit test.

**Files.** New `src/ui/hud/hot_write_gate.ts`; `hud.ts:270`, `hud.ts:482-505`. New `tests/hot_write_gate.test.ts`.

**Steps.**
1. Create `HotWriteGate` owning one `Map<HTMLElement,string>` and the four setters plus counters and a `stats()` method.
2. In `Hud`, construct exactly one `HotWriteGate` and replace `this.setText(...)` with `this.gate.setText(...)` (or keep thin `this.setText` delegators to minimize churn).
3. Unit-test: repeated identical writes are skipped; changed writes go through; skip rate computed correctly.

**Definition of done.** `npx vitest run tests/hot_write_gate.test.ts tests/hud_perf_budget.test.ts` green; one instance only (grep proves no duplicate cache); `npm run build` green.

**Landmines.** Invariant 4: exactly one instance, threaded by reference. Do not change write semantics or string formatting (signatures depend on byte-identical output).

### Card P1-B: extract `ReactiveDiff<T>` / `StructuralDiff<S,C>`

- Phase: P1. Effort: M. Risk: med. Depends on: P0-1.

**Goal.** Formalize the existing signature pattern in one helper: `{ computeSig(snapshot) => string; render(snapshot) => void }` with an internal `lastSig`, plus a split-signature variant generalizing the Social dual struct/content model.

**Why.** Seven panels copy-paste this. One definition stops the copies from drifting across sessions and gives windows a tested base to build on. This is also the real, non-dependency answer to "should we adopt a signals library" (no: see Section 9).

**Files.** New `src/ui/hud/reactive_diff.ts`; pattern sources Market `hud.ts:3461`, Party `hud.ts:4747`, Trade `hud.ts:5471`, Social `hud.ts:1820-1828`, PetBar `hud.ts:1475`, aura `hud.ts:1838`, Arena. New `tests/reactive_diff.test.ts`.

**Steps.**
1. Implement `ReactiveDiff<T>` and `StructuralDiff<S,C>` preserving exact diff semantics (fires iff signature changed).
2. Migrate the 7 sites **one at a time, each its own commit**, each guarded by the harness plus the skip-rate gate.
3. Unit-test that the new signature flips iff the old one did, across fixed fixtures (especially the aura set and the Social struct-vs-content split).

**Definition of done.** Each migrated panel: `npx vitest run` green, skip rate still >80%, signature parity test green.

**Landmines.** Invariant 5. A signature that stops detecting a change is invisible to `tsc`. The fixture-based "new sig changes iff old sig changed" test is mandatory for each migration.

### Card P1-C: extract `IconService`

- Phase: P1. Effort: S. Risk: low. Depends on: P0-1.

**Goal.** Wrap procedural icon generation/caching (`iconDataUrl`, `iconCanvas`, `QUALITY_COLOR`, used 50+ times) behind a small service, decoupling `Hud` from `icons.ts` specifics.

**Definition of done.** `Hud` and future window modules call `IconService`; `npm run build` and the harness green.

---

## 8. Phase P2: extract the on-demand windows (one card, one PR each)

Goal: peel each non-per-frame window out of `hud.ts` into `src/ui/hud/<window>.ts`, leaving `hud.ts` as persistent-chrome plus loop coordinator. Each window becomes a small module taking a shared `HudContext` (the `HotWriteGate`, window manager, `IconService`, tooltip/money helpers, `sim: IWorld`, renderer-pick, keybinds, and `t`) and exposing `render()`/`toggle()`/`update()`.

This is the bulk of the structural win and the part most amenable to parallel sessions, because after P1 the windows share primitives but own disjoint files and disjoint `id` roots.

**Extraction order (low risk to higher risk; each is a card `P2-<Window>`):**

1. `P2-Spellbook` (`hud.ts:4191-4259`): read-mostly, no per-frame update, single `#spellbook` root. This is the template card; do it first and document the seam.
2. `P2-Talents` (`hud.ts:4269+`): staged-edit, loadouts, import/export.
3. `P2-QuestLog` (`hud.ts:3714+`).
4. `P2-Character` (`hud.ts:3830+`): owns a preview canvas; verify the `CharacterPreview` sync still fires.
5. `P2-Options` (`hud.ts:5549+`): keybinds capture lives here; keep it on the modal gate.
6. `P2-Social` (`hud.ts:5090+`): consumes the `StructuralDiff` from P1-B; touches the matcher area, so it depends on P0-3.
7. `P2-Trade` (`hud.ts:5435+`).
8. `P2-Bags` (`hud.ts:2752+`).
9. `P2-Market` (`hud.ts:3419+`): browse/sell/collect tabs.
10. `P2-Arena` (`hud.ts:2064+`).

**Per-card template (applies to every `P2-*`).**

- Goal: move one window verbatim into `src/ui/hud/<window>.ts` as a class taking `HudContext`.
- Steps: (1) define/extend `HudContext` if a needed helper is missing; (2) move the `toggle*`/`render*`/`update*` methods verbatim; (3) replace `this.setText` -> `ctx.gate.setText`, `this.closeOtherWindows` -> `ctx.windows.closeOtherWindows`, etc.; (4) keep every `#id`/`.class` selector and every signature string byte-identical; (5) `Hud` instantiates the module and delegates.
- Definition of done: `npx vitest run` (harness + the window's own new test) green; skip rate >80%; `npm run build` green; the S3 i18n guard green; the window still opens/closes/updates in `npm run dev`.
- Landmines: Invariants 3, 4, 5. Do not touch the per-frame core. Do not duplicate the `HotWriteGate`. One window per PR so concurrent sessions never collide.

**What stays in `hud.ts`.** The persistent chrome and loop coordinator: player/target frame, action bar, cast bar, auras, minimap, the `update()` tier dispatcher (`hud.ts:1556-1834`), window manager, event dispatch, and the (now behaviorally-tested) i18n matchers. This is explicitly **not** modularized for its own sake.

---

## 9. Phase P3: per-frame core perf hardening (last, behind the gate)

- Phase: P3. Effort: M. Risk: med. Depends on: P0-2 (the skip-rate gate must exist first).

**Goal.** Harvest the three known GC micro-wins without regressing the hot path.

**Why this is last and small.** The core is already well-tuned; expected gain is smoothing the GC sawtooth on busy scenes, not raising floor FPS. On most scenes WebGL draw-call/CPU dominates. These changes also add subtle aliasing/stale-signature risk into the least-tested code, so they only happen once the gate and harness exist.

**Steps.**
1. **Measure first.** Enable the `/perf` overlay on a deliberately busy scene (50+ entities, active VFX) on desktop and a throttled mobile profile. Only proceed with allocation work if GC is actually visible in the trace.
2. If confirmed: pool the `AnimState` literal (`renderer.ts:1201`) into a per-`EntityView` scratch object mutated in place (confirm `renderer.ts:1219` consumes it synchronously and does not retain the reference).
3. Cache the three minimap `Set`s (`hud.ts:1952-1954`) behind a social/party-changed flag.
4. Cheapen the aura signature (`hud.ts:1838`) from `.map().join()` to a count plus rolling numeric hash, with the P1-B signature-parity test extended to cover it.
5. Have a fresh subagent review the diff specifically for object aliasing across entities/frames and for any signature that could stop detecting a real change.

**Definition of done.** `/perf` overlay shows reduced GC on the busy scene; skip rate still >80%; all signature-parity tests green.

---

## 10. Parallel track: Svelte 5 admin pilot

- Phase: parallel (independent of all `hud.ts` work; cannot conflict). Effort: M. Risk: low.

**Goal.** Prove or disprove a declarative framework in the one quarantined surface where it is safe, with an explicit keep/kill gate.

**Why admin and not the HUD.** Admin has no `IWorld`, no rAF, no per-frame budget, its own Vite input, its own i18n pipeline, and an **untyped** `t()` (so no `typeof en` guard to break). It is HTML-string rendering driven by two timers. Svelte's auto-escaping also retires the ~34 `escapeHtml()` XSS footguns.

**Cards.**
- `ADM-0`: teach `scripts/i18n_scan.mjs` (and the admin S3-equivalent gate) to parse `t()` sites inside `.svelte` files. Do this **before** writing any component, or keys leak silently. Definition of done: a key used only in a `.svelte` template is registered and flagged pending.
- `ADM-1`: spike one self-contained panel (e.g. the chat-filter page) as a `.svelte` component, wiring Svelte into the `admin` rollup input only (`vite.config.ts`); leave the game `main` input untouched. Author against the existing untyped admin `t()`; do not fork i18n.
- `ADM-2`: replace one `render*Table`'s manual `escapeHtml()` chain with Svelte `{}` interpolation; add a test asserting a malicious username (`<img onerror>`) is escaped.
- `ADM-3`: `npm run build` proves both inputs emit, the game bundle does **not** pull in Svelte, and the bundle-size delta is acceptable. Write the explicit keep/kill criteria (LOC reduction, merge-conflict surface, AI-edit ergonomics, bundle delta) into `src/admin/CLAUDE.md`.

**Landmine.** This introduces the repo's first framework dependency. Confine it to admin; document that the game HUD remains raw imperative DOM so contributors learn one convention per surface, not two everywhere.

---

## 11. How to split this into sessions

The cards are the unit of work. A session is one or a few cards that share a file footprint. Suggested groupings:

- **Session A (P0 foundation):** P0-1 + P0-2. One agent, sequential. This unblocks everything.
- **Session B (gates, parallel with A):** P0-3, P0-4, P0-5. Disjoint files from A; safe to run concurrently.
- **Session C (primitives):** P1-A, then P1-B, then P1-C. Sequential within the session; depends on A.
- **Sessions D..M (windows):** one window card each (`P2-Spellbook` first as the template, then the rest). These can run **concurrently across sessions** once P1 lands, because each owns a disjoint new file and disjoint `id` roots. P2-Social waits on P0-3.
- **Session N (perf):** P3, after the skip-rate gate exists.
- **Session X (admin, fully parallel from day one):** ADM-0 then ADM-1..3. Shares nothing with `hud.ts`.

**Concurrency rules for the shared worktree (every session obeys):**

- Stage only your card's files. Never `git add -A`. Often the right outcome is committing nothing.
- One card, one branch, one PR. Branch naming `feature/<card-id>-<slug>` (e.g. `feature/p2-spellbook-extract`).
- Before extracting a window, re-grep its symbols (line numbers in this doc have drifted).
- If two sessions must touch `hud.ts` simultaneously (e.g. two window delegations), prefer landing the lower-`id` card first and rebasing the other; the delegation edits are tiny and rebase cleanly when the windows are disjoint.

**Per-card self-verify loop (the trust substrate):**
`tsc` (via `npm run build`) + `npx vitest run <the card's test file>` + the HUD harness + the skip-rate gate + the S3 i18n guard. Green across all of these is the merge bar. For Opus-4.8 sessions: have a fresh subagent review the diff for correctness and requirement gaps (not style) before declaring done.

---

## 12. How this maps to the three stated priorities

Be honest about this, because the three are not equally addressable here.

- **Clean scalable architecture: the real prize.** Modularization (P1 + P2) is the 5/5 win and the thing actually hurting throughput. This is where the budget goes.
- **Performance: largely already solved.** The per-frame core is well-tuned; the ceiling on new perf work is low. Do not lead with it. Protect it with the P0-2 gate; harvest the P3 micro-wins opportunistically and only if profiling justifies them.
- **User experience: mostly downstream of the other two.** None of this is directly player-facing. The UX dividend is indirect: fewer regressions, no English-leak or empty-panel bugs reaching players, faster safe feature delivery. The one direct UX win is operator experience via the admin pilot, and operators are not players.

The open-source / 100%-AI lens does not just confirm "refactor `hud.ts`." It dictates **how**: many small, individually gate-checkable PRs, with deterministic tests standing in for a human reviewer's whole-file mental model. That is precisely why P0 (the gates) precedes P1+ (the extraction).

---

## 13. Decisions we are explicitly not revisiting

Recording these so future sessions do not reopen settled questions.

- **No frontend framework in the game HUD.** It would fight the rAF heartbeat (`main.ts:901`), the read-only `IWorld` seam, and the deterministic per-frame gates; a vdom diff actively fights the hand-tuned signature gates; and a second convention is a liability for drive-by AI contributors. The HUD stays raw imperative DOM.
- **No signals library (e.g. `@preact/signals-core`) in the HUD.** The HUD is a snapshot-pull system: it reads an `IWorld` snapshot synchronously each tier, then diffs. Signals only fire on reads of observable cells, but the source data is plain server-driven/sim state the UI does not own (the seam forbids owning it). To make signals fire you would mirror every field into a signal and write it every frame from the snapshot, reintroducing the exact per-frame compare the signatures already do, plus subscription bookkeeping and allocation. Net complexity and perf loss, no functional gain, and a second reactivity paradigm coexisting with the first. The real benefit people reach for (deduping the 7 copy-pasted diff sites) is captured by the dependency-free `ReactiveDiff<T>` in P1-B. If declarative reactivity is ever wanted, it is piloted in admin (Section 10), never the per-frame HUD.
- **No big-bang `hud.ts` rewrite.** Leaf-first, one card per PR, behind gates. The reasons are in Sections 2 and 3.

---

## 14. Program-level definition of done

- `src/ui/hud.ts` is reduced to persistent chrome plus the loop coordinator; each on-demand window lives in its own `src/ui/hud/<window>.ts` module consuming a shared `HudContext`.
- The shared primitives (`HotWriteGate`, `ReactiveDiff`/`StructuralDiff`, `IconService`) are defined once and unit-tested.
- The HUD has real behavioral tests, a skip-rate perf gate, an `IWorld` read-surface parity test, a sim-purity boundary check, and the i18n guard asserts runtime behavior rather than `hud.ts` source shape. All ride the PR-tier `npm test`.
- The per-frame core is untouched in behavior, still imperative, still above the skip-rate floor.
- The admin Svelte pilot has reached an explicit keep-or-kill decision recorded in `src/admin/CLAUDE.md`.
- The invariants in Section 4 hold throughout, verified by gates, not by eyeball.

---

## Appendix A: symbol and file index (re-grep before editing; line numbers drift)

- `src/ui/hud.ts`: `Hud` ctor `:338`; `update()` `:1556`; tiers `:1560/1562/1564`; per-frame core `:1578-1741`; `hotWriteCache` `:270`; setters `:482-505`; signatures `lastTradeSig :287`, `lastPartySig :288`, `lastArenaSig :289`, `lastMarketSig :297`, `lastSocialStruct/Content :317-318`, `lastPetBarSig :331`, aura sig `:1838`; matchers `localizeErrorText :2821`, `localizeSystemText :2928`, `localizeLootText :3012`; windows Spellbook `:4191`, Talents `:4269`, Market `:3419`, Social `:5090`, Trade `:5435`, Bags `:2752`, Character `:3830`, Arena `:2064`, QuestLog `:3714`, Map `:1875`, Options `:5549`; minimap Sets `:1952-1954`.
- `src/main.ts`: frame loop `:901-978`; modal gate `:910`.
- `src/world_api.ts`: `IWorld` `:185-307`.
- `src/render/renderer.ts`: `sync()` `:1019`; `AnimState` literal `:1201`; distance-tiered mixer `:1216-1218`; nameplate throttle `:1328`.
- `src/game/perf.ts`: `perf.time()` wrappers and overlay.
- `src/ui/i18n.resolved.generated.ts`: dense table typed `: typeof en`.
- `src/ui/i18n.status.json`: registry.
- `tests/localization_fixes.test.ts`: S3/B1 guard (currently source-coupled; see P0-3).
- `tests/client_shell.test.ts`: string-scraping HUD test (replace in P0-1).
- `src/admin/`: `main.ts` (648), `tables.ts` (354), `api.ts`, `types.ts`, `charts.ts`, `format.ts`; `admin.html` rollup input in `vite.config.ts`.

## Appendix B: glossary

- **Per-frame core:** the HUD elements updated every rAF frame (player/target frame, cast bar, action bar, auras, minimap). Latency-critical; stays imperative.
- **Hot-write cache / skip rate:** the `Map`-backed dedup that skips no-op DOM writes; skip rate is skipped/(written+skipped), must stay above ~80%.
- **Signature / recompute gate:** a cheap string/hash summarizing a panel's state; the panel re-renders only when it changes.
- **HudContext:** the shared service bag passed to each extracted window (gate, window manager, icon/tooltip/money helpers, `sim: IWorld`, renderer-pick, keybinds, `t`).
- **Render sink:** the single function (`t()`) through which all user-visible text must resolve.
- **Seam:** `IWorld`, the only interface render/ui depend on.

## Appendix C: provenance

This plan synthesizes two research passes: a multi-agent framework-landscape study (web research plus adversarial verification) and a codebase-grounded, adversarial priority review (six readers over the real `hud.ts`/loop/i18n/admin/perf surfaces, six scored initiatives, three independent skeptics). The skeptics agreed on the destination (modularize, no HUD framework, admin pilot) and converged on the sequence correction that defines P0: build the verification scaffold and decouple the i18n guard from `hud.ts` source before extracting anything.
