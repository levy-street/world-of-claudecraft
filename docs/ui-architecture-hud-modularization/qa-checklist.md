# QA Checklist: UI Architecture and HUD Modularization (whole-packet gate)

Verified once at packet completion (Phase 25), and used per-phase for the
categories a phase touches. This is a refactor: behavior must be preserved, so the
overarching test is "the game looks and behaves identically, but the code is
modular and gate-protected."

## Behavior preservation (the headline for a refactor)
- [ ] Every window opens, closes, and updates exactly as before (Spellbook,
      Talents, QuestLog, Character, Options, Social, Trade, Bags, Market, Arena).
- [ ] Per-frame core unchanged: player/target frame, cast bar, action bar
      (cooldowns, keybind labels), auras, minimap render identically.
- [ ] Drag-drop (bags <-> action bar), form switching (druid/rogue hotbar), staged
      talent edits, trade staging, raid markers, emote wheel all still work.
- [ ] Playwright DOM visual baselines unchanged (or intentionally re-baselined with
      a reviewed diff). Desktop + mobile.
- [ ] Playwright MCP live-game walkthrough (per `mcp-qa-runbook.md`) shows no
      regression in labels, layout, i18n, or interaction.

## Architecture and seam
- [ ] `hud.ts` is persistent chrome + loop coordinator only; windows live in
      `src/ui/hud/<window>.ts`, each consuming `HudContext`.
- [ ] Every module imports only `IWorld` + its needed helpers; no `Sim`/
      `ClientWorld`/`net` imports; no cross-window imports.
- [ ] Exactly one `HotWriteGate` instance threaded by reference (grep proves it).
- [ ] No new `IWorld` member, `SimEvent`, wire field, endpoint, or table was added
      (this is client-only; any addition is justified in `state.md` or reverted).

## Determinism and perf
- [ ] No `Math.random`/`Date.now`/`performance.now` in `src/sim/`; sim DOM-free;
      `tests/architecture_boundaries.test.ts` green.
- [ ] Hot-write skip rate > 0.8 (`tests/hud_perf_budget.test.ts`); no per-frame
      allocations added to the core.
- [ ] Every signature migration has a fixture parity test (new sig flips iff old did).
- [ ] `npm run asset:budget` and `npm run perf:tour` within budget (perf phase).

## i18n completeness
- [ ] Every player- and operator-visible string resolves through `t()`; no
      literals in `setAttribute('aria-label'|'title'|'placeholder'|'alt')` /
      `document.title` / confirm/prompt/alert; numbers/money/dates via the formatters.
- [ ] `localization_fixes.test.ts` asserts runtime behavior (not hud.ts source
      shape) and drift coverage is intact; `npx tsc --noEmit` green (`: typeof en`).
- [ ] No new English-only strings introduced by the refactor (keys preserved verbatim).

## Tests and hygiene
- [ ] New code has tests (primitives, windows, harness, parity, boundary).
- [ ] `tests/client_shell.test.ts` no longer greps source as a string.
- [ ] No dead code, no unused imports, no orphaned tests, no commented-out code,
      no leftover TODO/FIXME from the refactor.

## Mobile
- [ ] Touch controls, safe-area insets, tap targets, mobile XP ring, community/More
      trays unchanged. Verified with a mobile screenshot script at a phone viewport.

## Build / deploy gate
- [ ] CI-equivalent green: `npm test && npx tsc --noEmit && npm run build:env &&
      npm run build:server && npm run build`.
- [ ] `npm run build` proves the game (`main`) bundle does not pull in the new
      dev-only deps (DOM env, Playwright).
- [ ] No deploy expected from this packet (client refactor). If deployed:
      `curl -s localhost:8787/api/status` returns ok with the expected build.

## Copy review
- [ ] No em dashes or emojis in player-facing text, comments, or docs (raw emojis
      as in-game icons remain disallowed by the aesthetic rule).
