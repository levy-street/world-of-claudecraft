---
name: qa
description: Run the full end-of-contribution QA review over the current change (the qa-checklist gate plus a coverage fan-out and the domain reviewers it names).
user-invocable: true
---

You are running the project's end-of-contribution QA gate. Do this now, before the change is
called done.

1. Scope the review from the diff: `git diff --name-only` for uncommitted work. For committed
   work, merge-base against the branch's own base, never `main` (work is based off the latest
   release branch and `main` trails it, so a merge-base against `main` sweeps the whole release
   into scope). Fallback chain: the upstream, else the newest `origin/release/*` branch, else
   `origin/main`:

   ```sh
   base=$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null) ||
     base=$(git for-each-ref --sort=-creatordate --format='%(refname:short)' \
       'refs/remotes/origin/release/*' | head -1)
   git diff --name-only "$(git merge-base HEAD "${base:-origin/main}")"..HEAD
   ```

   If the user passed an argument (a feature name, phase, or file list), use it to focus the
   scope.

2. Dispatch the `qa-checklist` agent over that scope. It is the read-only gate: it scales its
   own depth to the size of the change, checks every repo invariant in play, and ends with an
   adversarial "what is missing" pass. Let it run; do not duplicate its work inline.

3. If the change is more than a trivial single-surface edit, also fan out a small coverage
   pass in parallel: one agent for correctness, one for test coverage, one for dead code, each
   prompted for COVERAGE (report every gap with confidence and severity), not filtering.

4. Dispatch the domain reviewer agents that `qa-checklist` names for the surfaces this diff
   touches (for example `privacy-security-review`, `migration-safety`, `cross-platform-sync`,
   `architecture-reviewer`, and on a release branch `release-malware-audit`). Spawn them fresh;
   never have the implementer review its own work.

5. Run the deterministic floor yourself so the verdict rests on green checks, not only agent
   reasoning: `npm run ci:changed` (Biome on the changed files), `npx tsc --noEmit`, and
   `npx vitest run tests/architecture.test.ts tests/localization_fixes.test.ts`. Report any red.

6. Adversarially confirm each consequential finding before acting on it (about half of raw
   findings do not survive a second look). Then fix every BLOCKING and SHOULD-FIX finding, in
   focused commits. Report what you fixed and what remains as VERIFY (needs a run or E2E) or
   NICE-TO-HAVE.

End with a one-line verdict: READY or NOT READY, and the list of any VERIFY items the maintainer
still has to run by hand (for example `npm run perf:tour`, `npm run test:browser`, or the mobile
E2E scripts). READY is advisory judgment; `npm run gate` is the deterministic pre-merge contract
(release tier on `release/**`), so if it has not run green this session, list it as the first
VERIFY item.
