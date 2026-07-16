# Project hooks

World of ClaudeCraft enforces its quality bar in layers so the bar holds without slowing the
Claude Code edit loop. These two hooks are the local, always-on part. They are checked in, so
they run for every contributor.

## What runs, and when

| Layer | Mechanism | When | Cost | Blocks? |
|---|---|---|---|---|
| Instant copy gate | `Stop` hook -> `qa-stop.sh` | end of every turn | milliseconds | yes, on a hit |
| Deterministic floor | `.githooks/pre-push` | once per `git push` | seconds | yes, on red |
| Full review | the `/qa` skill + the `qa-checklist` agent | when you finish a unit of work | an agent run | no (advisory) |

- **`qa-stop.sh`** scans the uncommitted added lines in the working tree (the unstaged tracked
  diff plus untracked text files), for hard invariants that are detectable instantly: an em
  dash, en dash, or emoji; a stray `.only(` that would silently disable a test suite; a
  leftover `debugger`. On a hit it asks Claude to fix those lines before finishing; otherwise
  it is silent. It never runs `tsc`, `vitest`, `biome`, or any agent. A Stop hook fires every
  turn, so anything heavier here would tax every iteration, and a hook is a shell command that
  cannot spawn an agent anyway.
- **`pre-push`** runs the heavier deterministic checks once, at the push boundary (infrequent,
  so it does not slow the inner loop): `tsc --noEmit`, the determinism/purity and i18n-matcher
  guard tests, `biome` scoped to the branch's changed files, and a copy-rule scan of the push
  diff. The copy scan diffs against the branch's upstream (else `origin/main`), so if it flags
  lines you did not write, set the upstream to the PR base
  (`git branch --set-upstream-to origin/<base>`) so it scans only your commits; do not reach
  for `--no-verify`. Bypass in a genuine emergency with `git push --no-verify`.
- **`ensure-hooks.sh`** (a `SessionStart` hook) points this clone's `core.hooksPath` at
  `.githooks` so the pre-push floor actually runs. It is idempotent and only acts when nothing
  already owns the hook path, so it never clobbers husky or your own setup.

The judgment layer (coverage, parity, security, content fidelity) is not in a hook because a
hook cannot reason. Run it with `/qa`, or invoke the `qa-checklist` agent directly, when you
finish a feature. The cross-runtime QA contract (including the Codex mirror under `.codex/`
and `.agents/skills/woc-qa/`) is `docs/qa-gate.md`.

## Trust and safety

These scripts run shell on your machine with your permissions, so treat them like any other
checked-in tooling. They are deliberately small and auditable: bash plus `git` and `perl`
(both already required to work on this repo), they read only `git diff` and `git config`, write
nothing outside `.git/config`'s `core.hooksPath`, and make no network calls. Claude Code does
not run project hooks until you have confirmed trust for the repo, and the hook registration in
`.claude/settings.json` is snapshotted at startup; the script files themselves are read when a
hook fires, so a mid-session edit to `qa-stop.sh` takes effect on the very next Stop. Review
any change to these scripts like any other executable, with the same care as a CI script; the
repo's own `release-malware-audit` scanner also scans `.claude/**`.

## Opting out

- Skip the pre-push floor for one push: `git push --no-verify`.
- Disable the checked-in hooks entirely for your clone: `git config --unset core.hooksPath`.
- Disable the Claude Code hooks: set `"disableAllHooks": true` in your
  `.claude/settings.local.json` (which is not checked in), or remove the `Stop` /
  `SessionStart` entries there.
