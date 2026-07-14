---
name: woc-release-merge-audit
description: "Audit a release merge into a long-lived World of ClaudeCraft branch for semantic conflict damage, legacy drift, missed inventory updates, and invalidated planning assumptions. Use after merging a release branch, when reviewing a release merge commit, or before resuming feature work after upstream integration."
---

# Release Merge Audit

Inspect the merge result for semantic damage that a clean textual merge can hide. This
workflow is read-only unless the user explicitly asks to fix confirmed findings.

## Establish the merge

1. Read the root and relevant local `CLAUDE.md` files.
2. Run `git status --short` and preserve unrelated work.
3. Identify the merge or integration range, both merge parents, and intended release base.
4. Separate release-side changes, pre-existing branch changes, and files or behavior both
   sides touched.

Do not assume branch names or `main`.

## Audit overlap

Compare meaningful overlaps with both parents and inspect the production path. Look for:

- branch behavior replaced by an older upstream form;
- release fixes omitted from branch-owned rewrites;
- migrated modules and legacy twins that now diverge;
- commands, routes, events, entities, or actions missing from registries and dispatch;
- injected helpers rebound to stale defaults or bypassed through direct imports;
- generated localization output resolved without canonical regeneration;
- persistence mocks, migrations, fixtures, or schema assumptions that no longer match;
- feature plans whose files, seam, or acceptance premise became stale;
- tests passing because the merged path no longer exercises intended behavior.

Use history to understand intent, but judge the final tree.

Run targeted checks only as needed. For authorized remediation, add or update focused
regression tests before changing the merge result, then run relevant changed-file checks
and `npm run gate`. Never edit, commit, push, or rewrite history in audit-only mode.

Report parent roles, overlap inventory, verified regressions, stale plans, checks,
recommended fixes in dependency order, and one verdict: `CLEAN`, `CLEAN WITH FOLLOW-UP`,
or `ACTION REQUIRED`.
