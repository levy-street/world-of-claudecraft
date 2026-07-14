# Character Equipment Screen - handoff to a fresh Codex session

You are picking up a large, in-progress feature. This doc is self-contained: read it top to
bottom and you have everything. Deep history (optional) is in the phase docs beside this file.

## 0. TL;DR

- Repo: World of ClaudeCraft. Branch: `feat/char-equipment` (cut from `origin/main` at `fa435903a`).
- HEAD: `6f2e63db0`. Working tree is CLEAN (only an untracked `.superpowers/` scratch dir - ignore it,
  never `git add` it).
- The feature (a full redesign of the character window, key `C`, `#char-window`) is COMPLETE and
  committed through a PR DRAFT. 56 commits, ~75 files, +7423/-447.
- Local verification is GREEN: `tsc` clean, `npm run ci:changed` green, `npm run build` green
  (5 entries), the whole-feature QA passed clean, and every feature test suite passes.
- What is NOT done (needs the human / your next steps): a possible final visual tweak, rebase onto
  the newest release branch (`release/v0.25.0`), push via the user's fork, open the PR, and optional
  teardown of this planning packet. Details in section 7.

## 1. What this feature is

Rebuilds `#char-window` into a full-screen, two-tab, dark-fantasy "AAA" character screen matching
three approved reference mockups the user supplied (a full desktop window, a paperdoll close-up, and
a mobile landscape layout). Pure client work: ZERO changes under `src/sim/`, `src/net/`, `server/`,
`src/world_api*`, the wire, or the DB. The only `src/render/` change is a procedural stone pedestal +
the preview equipment-visual seam under `src/render/characters/` (no new asset files).

Two tabs:
- EQUIPMENT: full-screen container (~80vw x 80dvh, resizeable, usable 1280-1920px); a radial
  ORBITING equipment stage (the 11 real equip slots on a symmetric arc around the character, who
  stands on a stone pedestal inside a carved stone arch); a full-width embedded bags panel below;
  and a tall right-hand stat column (Attributes, Combat, Defense, Progression + XP bar,
  Specialization + Choose/Change, Gathering).
- OVERVIEW: migrated identity strip, talent summary, prestige/milestones, share card.

## 2. THE GOVERNING DESIGN DECISION: "ornate look, HONEST data"

The user chose (mid-project) to match the mockups' STYLING and LAYOUT but show only stats and slots
the sim actually has. Do NOT add fictional content the mockups show:
- Slots: the sim has exactly 11 equip slots (helmet, neck, shoulder, chest, gloves, mainhand, waist,
  legs, feet, ring1, ring2) + 4 bag sockets. There is NO off-hand and NO trinket slot. The orbit
  leaves the mockup's "Off Hand" anchor empty on purpose.
- Stats: Combat = attackPower/dps/critChance/critRating/hasteRating/spellPower; Defense = armor/dodge.
  The mockups' Melee/Ranged split, Melee/Ranged Hit, and Block/Parry/Resistance rows do NOT exist as
  sim StatIds and are intentionally omitted.
Adding any of these would reverse the pure-client constraint (sim/server change) and is a Deferred
follow-up, not this PR.

## 3. Reference images (IMPORTANT - re-supply them to yourself)

This session had three pasted reference images that a fresh window does NOT have. Before doing any
visual work, ask the user to paste them again, OR compare against the committed AFTER screenshots
which already track them closely:
- `docs/screenshots/char-equipment-after-desktop.png`  (matches the full-window + paperdoll mockups)
- `docs/screenshots/char-equipment-after-mobile.png`   (matches the mobile-landscape mockup)
- `docs/screenshots/char-equipment-after-overview.png`
The exact design intent distilled from those mockups is captured in `docs/char-equipment/refs/`:
- `mockup-design-brief.md`      - the full-window ornate look
- `paperdoll-rework-brief.md`   - the beveled slot frames + stone arch + pedestal (close-up)
- `fullscreen-orbit-spec.md`    - the full-screen container + orbit anchor map + grid
- `visual-restraint-brief.md`   - "muted dark iron, glow only on selected, grey-blue arch, navy"
- `mobile-landscape-brief.md`   - the mobile landscape layout (icon rail / stage / bag sections)
Read these before touching the visuals; they ARE the acceptance criteria for the look.

## 4. Where the code lives (architecture)

- `src/ui/char_window.ts` (~1250 lines) - the PAINTER. Builds the equipment tab markup, the orbit
  slot placement (a data-driven anchor map + a half-sine arc; look for the `ORBIT_*` constants and
  the inset helper), the slot-cell builder, the bag sections, the overview tab, `charMoneyHtml`
  (char-local 3-coin display; deliberately NOT the shared `deps.moneyHtml`), and the tab wiring.
- Pure view-cores (DOM/Three/i18n-free, tested against Sim- AND ClientWorld-shaped stubs, registered
  in `UI_PURE_CORES` in `tests/architecture.test.ts`): `src/ui/char_view.ts` (paperdoll model),
  `char_panels_view.ts` (locked stat lists + `buildProgressionPanel` reusing `xp_bar.ts` math +
  `buildSpecPanel`), `char_bags_view.ts` (container partition from `src/sim/bags.ts` helpers),
  `milestones_overview_view.ts` (the overview milestones/prestige renderer).
- `src/ui/window_frame.ts` / `window_frame_view.ts` - the SHARED window frame. The char window opts
  into `subtitle` + `titleAccessory` + `tabs`. The ornate look is achieved with `#char-window`-SCOPED
  CSS overrides, NOT by changing the shared frame's output (other windows must stay unchanged - the
  15 `*_frame.test.ts` suites prove it).
- `src/styles/components.css` - desktop ornate frame chrome, the orbit stage, slot frames (beveled
  dark iron + gold corner accents), the stone arch, stat panels, bags. Desktop rules are scoped
  `body:not(.mobile-touch)`. New sections use exactly-ten-dash banners (`/* ---------- x ---------- */`),
  registered in `tests/css_corpus.test.ts`. Colors are TOKENS only (no raw hex/px/color in TS).
- `src/styles/hud.mobile.css` - the SEPARATE mobile layout, gated `body.mobile-touch` (portrait
  stack + landscape icon-rail/stage/bag-sections/stats). Not a scaled desktop.
- `src/styles/tokens.css` - gold / navy / stone / dark-iron tokens (added under existing groups).
- `src/render/characters/pedestal.ts` (procedural stone dais), `preview.ts` (`setPedestal`, default
  off, char-window mount only; `captureCloseup` hides it), `preview_appearance.ts`
  (`equippedItems` in the signature), `visual.ts` (`setEquipment` - weapon-only base seam today).
- i18n: `src/ui/i18n.catalog/hud_chrome.ts` (`hudChrome.character.*` keys, English-only domain);
  `src/ui/i18n.locales/{zh_CN,zh_TW,ja_JP,ko_KR,ru_RU}.ts` (M16 non-Latin fills only); regenerated
  `src/ui/i18n.resolved.generated/*` + `src/ui/i18n.resolved.sha256` (see gotcha 5).
- `scripts/char_equipment_shot.mjs` - the screenshot driver (puppeteer-core; needs `npm run dev`).
- Hud glue: `src/ui/hud.ts` has only thin mount/toggle/deps wiring (`mountCharPreview`, `toggleChar`,
  the `CharWindowDeps` construction, `openTalents`/`openBags`/`unequipBag`/`dragUnequipSlot`/
  `renderBagsIfOpen` deps). No new banner sections were added to the monolith.

## 5. How to verify (commands)

- `npx tsc --noEmit` (must be clean; node_modules is already synced - see gotcha 2).
- Feature suites (fast): `npx vitest run tests/char_view.test.ts tests/char_panels_view.test.ts
  tests/char_bags_view.test.ts tests/char_window.test.ts tests/char_window_frame.test.ts
  tests/window_frame_view.test.ts tests/window_frame.test.ts tests/pedestal.test.ts
  tests/preview_appearance.test.ts tests/character_visual_equipment.test.ts
  tests/milestones_overview_view.test.ts tests/architecture.test.ts tests/css_corpus.test.ts
  tests/css_value_validity.test.ts tests/localization_fixes.test.ts tests/i18n_completeness.test.ts
  tests/i18n_resolved_equivalence.test.ts`
- All 15 frame suites: `npx vitest run tests/*_frame.test.ts` (proves other windows unaffected).
- `npm run ci:changed` (biome, changed files only), `npm run build`, `npm run gate`.
- Screenshots: start the dev server (`npm run dev`), then `node scripts/char_equipment_shot.mjs`
  (writes tmp/*.png at desktop + mobile viewports). The shot script does NOT capture the Overview
  tab; a temp variant is needed for that (used for the committed after-overview shot).

## 6. Known gotchas (read before you trust a red)

1. THREE gate reds are PRE-EXISTING and ENVIRONMENTAL on this Windows machine, NOT this branch (git
   diff confirms these files are untouched). They fail via a `node`/`tsc` subprocess spawn, not
   assertions: `tests/server/new_endpoint.test.ts` (documented in the repo), `tests/ai_review.test.ts`,
   `tests/codex_setup.test.ts`. `npm run gate` will show them red - that is expected here.
2. node_modules can drift vs the committed lockfile (missing `@capacitor/*`, `@aws-sdk/*`). If `tsc`
   suddenly shows ~6 errors about those, run `npm install` (NEVER edit package.json/lock). It is
   synced as of this handoff.
3. Dev server / puppeteer flakes under sustained headless load. If a screenshot hangs, restart
   `npm run dev` and retry. A cold `npm run dev` re-optimizes deps and reloads once - wait for it to
   settle before the first screenshot.
4. The feature DEPARTS from an early "locked decision" that `#char-window` stays a centered
   `.window.panel` - the user explicitly asked for a full-screen resizeable interface instead. That
   is intentional. Open state is still `#char-window.style.display === 'block'` (Hud reads it).
5. i18n: after ANY change to `hudChrome.character.*` keys, run `npm run i18n:gen` then
   `npm run i18n:hash -- --write`, and confirm `node scripts/i18n_resolved_hash.mjs --check` says OK,
   or `tests/i18n_resolved_equivalence.test.ts` will red. (One such drift was found and fixed in
   `8f772e11a`.) Contributors add ENGLISH only; wordy new values also need the 5 non-Latin M16 fills.
6. Never delete a "(sacred)" unequip assertion in `tests/char_window_frame.test.ts` (corner-x,
   right-click, drag-to-unequip onto BOTH the embedded grid and the standalone `#bags`). Update
   selectors, never assertions.
7. Shared checkout: commit with EXPLICIT paths, never `git add -A` (it would grab `.superpowers/`).
8. No em dashes, en dashes, or emojis anywhere (a Stop hook and the copy scan enforce it). Use
   commas/colons/parentheses/"to".

## 7. What remains (your next steps, in order)

1. (Optional) Final visual tweak: the desktop orbit + mobile now track the references closely, but
   the user may want small adjustments. Re-supply the reference images, screenshot the current build,
   compare, and iterate on `char_window.ts` (orbit constants) + `components.css`/`hud.mobile.css`.
   Keep it honest-data, tokens-only, tests green.
2. Rebase onto the newest release branch. The PR base should be `release/v0.25.0` (this branch was
   cut from `main`). Fetch it, rebase `feat/char-equipment` onto `release/v0.25.0`, re-run the
   verification, and if the rebase pulls in a release merge, run the repo's release-merge-audit
   checks. Watch for i18n `pending` count rises (expected/fine at PR tier) and re-run i18n:gen if the
   generated artifacts conflict (take either side, regenerate, the output is deterministic).
3. Push + open the PR. DELIVERY GOES VIA THE USER'S FORK WITH THEIR EXPLICIT AUTHORIZATION (the user
   has no write access to the upstream). Do not push or open the PR without the user's go-ahead. The
   PR body is drafted at `docs/char-equipment/pr-draft.md` (summary, before/after table, test plan,
   deferred follow-ups). Title: `feat(ui): redesigned two-tab character equipment screen`.
4. (Optional, on EXPLICIT user confirmation ONLY) Packet teardown: `git rm -r docs/char-equipment/`
   (this whole planning packet, including this handoff + refs) before the PR, commit
   `docs: remove char-equipment planning scaffolding`. Do NOT do this unless the user says so.

## 8. Deferred follow-ups (already in the PR draft; file as issues)

Armor-on-model meshes (base seam shipped, weapon-only today); ranged attack power display (new
StatId); off-hand/trinket equip slots (sim feature); the mockups' fictional stat rows (need real sim
mechanics); crafting-skills on the sheet (blocked on ClientWorld mirroring `craftSkills`);
embedded-grid overflow display for legacy over-capacity saves (standalone `#bags` still shows it);
quest-item discard from the embedded grid (deliberate no-op); harden the pedestal restore guard in
`preview.ts captureCloseup` (`!this.destroyed`); `char_window.ts` size watch-item.

## 9. Key commits (for orientation)

- Branch base: `fa435903a` (off origin/main). Packet base commit: `d63950b9e`.
- Phases 1-5 + QA, then the redesign rounds (orbit, paperdoll, restraint, mobile), then:
  `8f772e11a` fix(i18n) SHA re-baseline; `bbc983967` after-screenshots; `6f2e63db0` PR draft + gate
  summary (HEAD).
- Full per-phase history: `docs/char-equipment/progress.md`. Locked decisions + constraints:
  `docs/char-equipment/state.md`. Whole-feature QA matrix: `docs/char-equipment/qa-checklist.md`.
