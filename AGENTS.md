# AGENTS.md

Any non-Claude coding agent (Codex and similar) can treat this file as root project guidance for World of ClaudeCraft. **`CLAUDE.md` (root + per-directory) is the canonical source of truth** — kept current for Claude Code (Claude Opus 4.8); this file mirrors it for other agents, and when they disagree, `CLAUDE.md` wins. Keep this file concise and defer detailed, temporary, or model-specific guidance to the linked files.

## Startup Checklist

1. Run `git status --short` before edits.
2. Preserve unrelated user work. Do not revert, discard, stage, or commit changes unless the user explicitly asks.
3. If `GEMINI.md` exists, read it for supplemental local project context before substantial planning or source edits.
4. Use `rg` and targeted file reads for discovery.
5. Read existing code before editing and follow local patterns.

## Project Map

- `src/sim/`: deterministic simulation core shared by client and server. No DOM, rendering, i18n, or browser dependencies.
- `server/`: authoritative Node WebSocket and REST server (`http.createServer` + `ws`, no Express).
- `src/render/`: Three.js renderer and asset loading.
- `src/ui/`: vanilla DOM HUD and UI components.
- `src/game/`: input, keybinds, settings, audio, and mobile controls.
- `tests/`: Vitest unit and integration tests.
- `scripts/`: browser, integration, visual, and automation scripts.

## Core Engineering Rules

- Keep TypeScript strict and avoid `any` casts.
- Module-first for new behavior: prefer a new, focused, testable module behind an existing seam (`IWorld`, a `src/sim/content/` record, a `src/render/<thing>.ts`) over appending a block of logic to a large file. Do not split a monolith just to hit a line count. See the Modularity section in `CLAUDE.md`.
- Use standard ES modules and relative imports.
- Do not add placeholder code or TODO-driven implementations.
- Do not import Tailwind or new UI frameworks.
- For external library/API usage, fetch current docs with Context7 or official docs when available.
- Do not use em dashes, en dashes, or emojis anywhere: code, comments, docs, commits, PR text, or player copy. Use commas, colons, parentheses, or "to" for ranges.
- Do not use raw emojis for in-game UI icons.

## Simulation Rules

- Never mutate simulation state directly from rendering, UI, or client glue code.
- All state mutations must happen through simulation actions/ticks.
- Use seeded RNG from `src/sim/rng.ts`; never `Math.random()`, `Date.now()`, or `performance.now()` in `src/sim/`. `tests/architecture.test.ts` enforces sim purity (no DOM or render/ui/game/net/three imports, no nondeterminism).
- Maintain classic-era-MMO-style stat formulas and deterministic combat behavior.
- Use existing collision, spatial, and pathfinding helpers.

## Frontend And UI Rules

- Use vanilla DOM APIs and existing component/style patterns.
- Use design tokens or CSS custom properties for colors, spacing, typography, radius, shadows, and timing when a token exists.
- Ensure layout stability. Avoid clipping, overlap, horizontal overflow, and parent resizing caused by dynamic content.
- Inputs and selects must be at least `16px` on mobile.
- Interactive touch targets must be at least `40px` tall.
- Use semantic markup and accessible labels.
- Custom interactive elements must support keyboard navigation and activation with Tab, Shift+Tab, Enter, and Space.
- Use high-contrast `:focus-visible` states.
- Respect `prefers-reduced-motion`.
- Do not use scale transforms on hover or focus.
- Never hardcode `KeyboardEvent.code` values in UI logic. Use `keybinds.ts` and the existing input abstractions.

## Mobile Touch And Zoom Rules

- All visible mobile form controls, including `input`, `select`, and `textarea`, must use at least `16px` font size to prevent iOS Safari input zoom.
- All mobile interactive targets, including buttons, links, selects, tabs, icon controls, and custom elements with `role="button"`, `role="tab"`, or `role="option"`, must provide at least a `40px` by `40px` tappable area.
- Apply mobile sizing by touch capability or mobile runtime state when possible, not only narrow viewport width, so landscape phones keep safe control sizes.
- Verify mobile portrait and landscape for no accidental zoom triggers, missed tap targets, clipping, overlap, or horizontal overflow.

## Localization Rules

- All player-facing strings render through `t(key)`. Add the English key to the matching per-domain module under `src/ui/i18n.catalog/<domain>.ts` (new HUD chrome goes in `hud_chrome.ts`). `src/ui/i18n.ts` is the thin runtime (`t`, formatters, locale resolution) and imports the generated `en`; you do not author strings there.
- Per-PR, English-only is correct: the PR-tier gate permits it. Contributors add ENGLISH only; the maintainer batch-fills the 13 non-English locales before release via the `src/ui/i18n.locales/<lang>.ts` overlays (do not hand-edit those overlays). Completeness is enforced by the release-tier gate, not per-PR. The authoritative locale set is `supportedLanguages` (derived from the generated `SUPPORTED_LANGUAGES`); author against the code, never a printed list. See `docs/i18n-scaling/translation-workflow.md`.
- Do not fake coverage with placeholder markers, empty strings, `// TODO`, or machine-looking output, and never put English copy or a placeholder into a non-English overlay as a stand-in translation.
- The final rendered text, however it is assembled, must come from `t()`. The following are defects when the result is user-facing: string concatenation, template-literal English parts, English default function parameters (`title = 'Notice'`), optional fallbacks like `value ?? 'English'`, English-valued lookup or enum maps (`const LABELS = {...}`), any non-`t()` wrapper, and passing English literals to `setAttribute('aria-label'|'title'|'placeholder'|'alt', ...)`, to `el.title` / `el.alt` / `document.title`, or to native `confirm` / `prompt` / `alert`.
- All user-facing numbers, money, percentages, units, dates, and times must go through the locale-aware helpers (`formatNumber`, `formatDateTime`, `formatMoney`, `languageTag`, or `Intl` with the player SupportedLanguage). Never raw `String(n)`, default-locale `toLocaleString()`, hard-coded separators, or `n + 'g'`-style concatenation.
- Classify a string by its actual render sink, not by the statement it sits in. If any code path can render it to a person it is player-facing, even when it originates in a `throw`, `catch`, or `console.*`. If one string feeds both a log and the UI, split it: a translated `t()` key for the user, a separate English literal for the log.
- Accessibility text, ARIA labels, accessible names, placeholders, metadata, `document.title`, status text, user-shown error and validation text (validation, "connection lost"), tooltips, toasts, dialogs, empty-state copy, public static pages, overlays, server-sent player text, and the entire admin dashboard UI all count as player-facing. Admin operators are users: admin labels, status, and error copy are player-facing no matter how technical.
- Exempt (stays English, do not translate or key): text whose only sink is a developer channel: `console.*`, assertion messages, internal ids, code comments, and a `throw new Error(...)` whose value no catch path surfaces to a user. A thrown error that is caught and displayed is player-facing and must be translated.
- Keep `src/sim` and `server` runtime code language-agnostic: no `t()`, no DOM. They are not thereby exempt. Any player-shown text they emit (combat, loot, system, chat, guild/party notices, ban/suspension notices in `server/social.ts`, `server/admin.ts`, and similar) must be either a stable key plus interpolation values, or English that is re-localized at the client boundary by adding a matching entry to `src/ui/sim_i18n.ts` and its `src/ui/server_i18n.ts` mirror (consumed via `localizeSimText` / `localizeServerText`) in the same change. Emitting new English player text without its matcher entry is a defect, not an exemption. The S3 drift test (`tests/localization_fixes.test.ts`) guards sim emits.
- Emojis and language-neutral symbols need no translation entry and may appear inline or stand alone as decoration, but must never replace a required translation: the accessible name behind an emoji control is still a translated `t()` key. This is about translation coverage only and does not override the separate no-raw-emoji-as-in-game-icon rule.
- Enforcement gap to own yourself: every locale is typed `: typeof en`, so `tsc` catches a missing or renamed key but cannot see a hard-coded literal that never became a key, nor a new sim/server English emit that lacks a matcher entry. Both compile clean and ship English to a translated player. No human reviewer reliably catches this, so route every player-facing string through `t()` (or the matcher) at creation time.

## Verification Commands

Use the smallest validation set that gives confidence for the change. Common commands:

```bash
npm test
npm run build
node scripts/homepage_verify.mjs
node scripts/seo_audit.mjs
node scripts/mp_integration.mjs
node scripts/crypt_raid.mjs
node scripts/smoke_mage.mjs
node scripts/smoke_rogue.mjs
```

Browser or visual UI changes should be verified with a running dev server and browser automation when feasible.

## Git And Commit Rules

- Do not commit unless the user explicitly asks.
- If committing, stage only files relevant to the requested change.
- Commit format: `<type>(scope): <short description>` with a detailed body (matches root `CLAUDE.md`).
- Do not add `GEMINI.md` to `.gitignore`.
