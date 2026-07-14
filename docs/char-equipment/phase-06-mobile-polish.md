# Phase 6: Mobile, a11y, polish, screenshots, gate

Goal: the new window works on touch devices (portrait and landscape), passes the a11y and fairness contracts, ships its after-screenshots, and the branch passes the full pre-merge gate. This phase ends with the PR draft.

## Design contract

### 1. Mobile (`src/styles/hud.mobile.css`, char section at 2731-2806)

Rework the `body.mobile-touch #char-window` rules for the new structure:
- Full-screen (inset 0) stays; single-column vertical stack in this order: titlebar (with money accessory; verify the accessory does not crowd the close button at 390px), tab rail, then per tab: Equipment = paperdoll (model panel first, slot columns become a compact two-column grid below or beside it at the maintainer's judgment within tokens), bags section, stat panels stacked; Overview = its sections stacked.
- Landscape branch (existing pattern shrinks the model panel to 180px): keep the model visible but compact; slot columns flank it if width allows.
- Touch targets: every slot cell, tab, selector button, and button >= 40x40 px (`--touch-min`); inputs (none expected) >= 16px.
- Test on `body.mobile-touch` gating, not just width; verify with the mobile shots in BOTH orientations.

### 2. A11y + fairness regression sweep

- Focus trap on open, focus return on close, Esc via `closeAll` (existing wiring; verify it survived the rebuild).
- Tab rail keyboard operation (arrow keys / roving tabindex, from the frame; verify).
- `:focus-visible` steady token rings on all new interactive elements (slots, selector, buttons).
- `forced-colors: active`: window usable (borders/labels survive), rarity conveyed by more than color alone where the existing convention does so (match what the bags window does; do not invent a new affordance).
- `prefers-reduced-motion`: no new animation ignores it; the turntable's behavior stays as it was (Hud-owned, out of scope to change).
- `data-fx-level="low"`: corner ornaments drop (frame-inherited); confirm nothing in the new CSS re-adds cosmetic cost at low tier. The window shows no actionable-information difference across tiers (it is cold-path chrome; just confirm no tier knob was introduced).
- aria: dialog role + labelledby from the frame; slot cells have accessible names (slot + item); the counter and selector have labels; the XP bar has an accessible value text.

### 3. After-screenshots + PR

- Run `scripts/char_equipment_shot.mjs`; commit `docs/screenshots/char-equipment-after-desktop.png`, `-after-mobile.png`, plus one Overview-tab shot `-after-overview.png`.
- PR body per `.github/PULL_REQUEST_TEMPLATE.md`: summary, before/after image table (desktop + mobile), test plan, the deferred follow-ups list from `progress.md`.
- Base branch: check `git ls-remote origin 'refs/heads/release/*'` for the newest release branch; per root CLAUDE.md the release branch is the integration base (`main` trails it). If the newest release differs from what the branch was cut from, rebase `feat/char-equipment` onto it FIRST and rerun the full validation, then run the release-merge-audit skill if a release merge was involved.

### 4. Gate

- `npm run ci:changed` green.
- `npm run gate`: green EXCEPT the documented Windows-only `tests/server/new_endpoint.test.ts` failure (POSIX .bin/tsc spawn; pre-existing on this machine, see memory). Record the gate output summary in progress.md.
- Full targeted suite list from `qa-checklist.md` green.

## Starter Prompt

```
This is Phase 6 of the Character Equipment Screen feature: Mobile, a11y, polish, gate.

Model: Opus 4.8, xhigh effort. Harness: Claude Code. No ultracode.

Goal: mobile adaptation, a11y/fairness regression sweep, after-screenshots, full gate, PR draft.

STEP 0 - PRE-FLIGHT: git status clean, feat/char-equipment, Phase 5 QA PASS per progress.md.
Read docs/char-equipment/state.md yourself. Memory scan: browserslistrc CRLF, pre-push hook on
release-based branches, Windows gate quirk, verify-timing/sightline gotchas.

STEP 1 - LOAD CONTEXT:
Spawn one Explore agent to read and summarize:
- docs/char-equipment/phase-06-mobile-polish.md (this file) + docs/char-equipment/qa-checklist.md
- src/styles/hud.mobile.css lines 2700-2820 (current char rules) + the generic mobile window rules
- src/ui/CLAUDE.md mobile + a11y contract sections
- src/styles/CLAUDE.md
- .github/PULL_REQUEST_TEMPLATE.md
- scripts/char_equipment_shot.mjs (as landed)
Return: the current mobile rule inventory, the a11y contract checklist, the PR template sections.

STEP 2 - EXECUTE:
A. Mobile CSS rework per the contract; verify with node scripts/char_equipment_shot.mjs in both
   orientations plus manual npm run dev checks at 390x844 and 844x390 (body.mobile-touch).
B. A11y sweep per the contract list; fix findings.
C. After-screenshots; commit the three PNGs.
D. Base-branch check + rebase if needed (rerun validation after any rebase; dispatch the
   release-merge-audit skill if a release merge occurred).
E. npm run ci:changed, npm run gate; record results.
F. Draft the PR body (do not open the PR without the user's go-ahead if pushing to a remote
   requires it; check memory: push access goes via the user's fork with explicit authorization).

INVARIANTS IN PLAY:
- Touch targets >= 40px; no transform:scale on hover/focus; reduced-motion honored; forced-colors
  usable; steady token focus rings; graphics tiers stay gameplay-neutral.
- CSS tokens only; mobile rules gated on body.mobile-touch; ten-dash banners.
- No em/en dashes or emojis. Nothing under src/sim, src/net, server, src/world_api*.

OUT OF SCOPE: new features of any kind; only adaptation, fixes, evidence, and delivery prep.

STEP 3 - VALIDATION + REVIEW:
- The full suite list from docs/char-equipment/qa-checklist.md "Tests and build gate"
- npx tsc --noEmit; npm run ci:changed; npm run gate (documented Windows red allowed)
- qa-checklist agent over the WHOLE feature diff (git diff origin/main), COVERAGE prompt.

STEP 4 - COMMIT CADENCE:
- style(hud): mobile layout for the redesigned character window
- fix(ui): a11y polish for the character window (as needed)
- docs(char): after screenshots and phase 6 completion

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] Portrait + landscape usable, all targets >= 40px, nothing clipped
- [ ] A11y sweep items all verified (list them with pass/fail in your final message)
- [ ] Three after-screenshots committed; PR body drafted with before/after table
- [ ] Gate green (modulo the documented Windows red); full suite list green
- [ ] Branch based on the newest release branch (or rebase performed and revalidated)

STEP 6 - DOC UPDATES: progress.md (Phase 6 + gate output summary), state.md.

STEP 7 - FINAL RESPONSE: status, evidence links (screenshot paths), gate summary, PR draft
location, handoff for the final QA session.

STOPPING RULES:
- Stop and ask before any push or PR creation (delivery path goes via the user's fork with
  explicit authorization; see memory).
- Stop and ask if the rebase onto a newer release branch produces conflicts in files this packet
  does not own.
```

## QA Starter Prompt (final: closes the packet)

```
This is Phase 6 QA of the Character Equipment Screen feature: final audit and packet close.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

STEP 0: git status clean. Read docs/char-equipment/state.md AND docs/char-equipment/qa-checklist.md.

STEP 1: Explore agent: the full feature diff (git diff origin/main --stat + the char/bags/frame/
styles files), progress.md (all phases), the deferred-follow-ups list.

STEP 2 - RUN THE WHOLE-FEATURE MATRIX: execute docs/char-equipment/qa-checklist.md top to bottom,
checking every box with evidence (command outputs, app drives, screenshot inspection). Spawn the
qa-checklist agent over the full diff in parallel (COVERAGE prompt). Fix and re-verify anything
that fails; commit fixes.

STEP 3 - PACKET TEARDOWN OFFER: if every box checks, surface the deferred follow-ups from
progress.md, then ask the user explicitly: "All phases are complete and green. OK to delete
docs/char-equipment/ (the planning scaffolding) before the PR?" Delete ONLY on explicit
confirmation, ONLY that directory (git rm -r docs/char-equipment/, commit
"docs: remove char-equipment planning scaffolding"). If declined, leave it.

STEP 4 - FINAL RESPONSE: verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL), the checked matrix,
deferred items, teardown outcome, and "packet complete" plus what remains for the user (PR
review/merge).
```
