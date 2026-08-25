# Phase 15 QA: The beautify pass

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.39.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Dedicated QA session for phase 15. Canonical QA workflow in `implementation-plan.md`.
Repo: game, worktree `/Users/fernando/Documents/wocc-marketplace`.

## What was promised (audit every item)

The DESIGN.md audit applied across every marketplace surface; stress-content
robustness (truncation, formatting, images, zero states); tooltip quality; mobile
correctness; a fresh lowest-preset screenshot set including stress captures; zero
behavior change.

## Phase-specific probes

- Open the screenshots and LOOK at them (Read the image files): alignment, padding
  rhythm, contrast, readable icons, fee lines with real values; a screenshot nobody
  looked at is not evidence. Check the stress captures specifically for silent
  truncation and width jumps.
- Re-run the raw-formatting grep yourself (`toFixed`, concatenated currency symbols or
  unit strings, hand-built date strings) over the market UI modules; one hit is a
  finding.
- Fairness invariant: diff the styles/tier changes for anything that sheds actionable
  information (own debuffs, cast bars, HP granularity); cosmetic-only is the rule.
- CSS reach: new selectors must actually reach the new DOM (the class-presence trap in
  the test-pin memory); verify one deep selector per surface in a rendered probe.
- Behavior freeze: re-run the phase 14 view-core tests unchanged; any assertion edit in
  this phase's diff is a finding.
- Mobile: captures include a small-phone width; no control under the thumb-zone or
  safe-area insets.

## Fernando sign-off gate

Before the verdict: present the screenshot set to Fernando (paths, organized per
surface, before/after pairs) and ask for his eyeball sign-off on the look. The beautify
bar is his call, not the reviewer's. PASS requires his sign-off (or his named change
list applied and re-presented).

## Reviewers

`frontend-seam-reviewer`; `qa-checklist` last.

## Exit

Verdict, counts, deferrals; push per the cadence on PASS. Update progress.md and
state.md. Next file: `docs/woc-marketplace-hardening/phase-16-hot-path-scale.md`.
