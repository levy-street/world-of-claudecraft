# QA Checklist: Character Equipment Screen (packet completion)

Run once, in the final Phase 6 QA session, after all phases report complete. Every row must pass before the PR.

## Scope guard

- [ ] `git diff origin/main --name-only` touches ONLY: `src/ui/`, `src/styles/`, `src/render/characters/` (Phase 2b files only), `scripts/`, `docs/`, `tests/`. Zero changes under `src/sim/`, `src/net/`, `server/`, `src/world_api*`, `headless/`, `python/`. (Locked decision 11; this also justifies skipping the sim/server/wire review agents.)
- [ ] Phase 2b render additions: pedestal off by default at every `CharacterPreview` consumer except the char-window mount; no new asset files (media manifest diff empty); `setEquipment` renders weapon-only.

## Three-host parity

- [ ] The window renders identically from the offline `Sim` and the online `ClientWorld` because every read goes through existing `IWorld` members (`player`, `equipment`, `inventory`, `bags`, `bagCapacity`, `copper`, `xp`, `lifetimeXp`, `prestigeRank`, `talentSpec`, `gatheringProficiency`, `professionsState`). Pure-core tests cover both world-shaped stubs.
- [ ] No new data displayed that ClientWorld does not mirror (specifically: `craftSkills` is NOT shown).

## Determinism / sim purity

- [ ] No `src/sim/` changes at all; `npx vitest run tests/architecture.test.ts` green (also proves the new pure cores are registered and clean).

## i18n completeness

- [ ] Every new player-visible string is a `t()` key in `hud_chrome.ts`; wordy values carry their five non-Latin fills (M16). `npx vitest run tests/localization_fixes.test.ts tests/i18n_completeness.test.ts` green.
- [ ] All numbers via `formatNumber`, money via `moneyHtml`/`formatMoney`; names escaped with `esc()`.
- [ ] `state.md`'s final i18n key list matches the diff.

## Interaction fidelity (the sacred flows)

- [ ] Corner-x unequip, right-click unequip, drag-to-unequip all work, into BOTH the embedded grid and the standalone `#bags` window.
- [ ] Equip from the embedded grid works (click behavior matches the standalone bags window's default mode).
- [ ] KeyC, minimap `#mm-char`, and mobile `mobile-char` all toggle the window; Esc closes via `closeAll`; focus is trapped while open and returned on close.
- [ ] Tab switch preserves the 3D preview (single WebGL context, no second context created; preview re-mounts when returning to the Equipment tab).
- [ ] Specialization Choose/Change opens the talents window; BAGS open-full button opens `#bags`.

## Visual / a11y

- [ ] Desktop layouts at 1600x740 and 1280x800; mobile portrait and landscape (`body.mobile-touch` full-screen mode) all usable, no clipped content, tap targets >= 40px.
- [ ] `:focus-visible` rings steady and token-drawn; `forced-colors: active` usable; `prefers-reduced-motion` honored; no `transform: scale()` on hover/focus.
- [ ] `data-fx-level="low"` still drops the corner ornaments and nothing else breaks.
- [ ] No raw hex/px/color in painter TS (`tests/char_window.test.ts` scan green); CSS token-only, ten-dash banners (`tests/css_corpus.test.ts` green).

## Tests and build gate

- [ ] Full targeted suites green: `npx vitest run tests/char_view.test.ts tests/char_panels_view.test.ts tests/char_bags_view.test.ts tests/char_window.test.ts tests/char_window_frame.test.ts tests/window_frame_view.test.ts tests/window_frame.test.ts tests/architecture.test.ts tests/bags_view.test.ts tests/bags_window.test.ts`
- [ ] `npx tsc --noEmit` green; `npm run ci:changed` green.
- [ ] `npm run gate` green (modulo the documented Windows-only `tests/server/new_endpoint.test.ts` red).

## Copy review

- [ ] No em dashes, en dashes, or emojis anywhere in the diff (code, CSS comments, docs, commits).

## Deliverable

- [ ] Before/after screenshots (desktop + mobile + overview tab) committed under `docs/screenshots/` and referenced in the PR body.
- [ ] PR follows `.github/PULL_REQUEST_TEMPLATE.md`, based on the correct integration branch (check for the latest `release/**`).
- [ ] Deferred follow-ups from `progress.md` listed in the PR body.
- [ ] Packet teardown offered to the user (delete `docs/char-equipment/`) with explicit confirmation before executing.
