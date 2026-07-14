---
name: woc-file-issue
description: "Draft and create a focused GitHub issue for World of ClaudeCraft using the project issue format. Use only when the user explicitly asks to file, create, or open an issue. A request for a draft does not authorize creating the issue."
---

# File GitHub Issue

Create a clear, bounded issue in `levy-street/world-of-claudecraft`.

## Confirm authorization

Write to GitHub only when the user explicitly asks to file, create, or open the issue.
For draft, rewrite, or proposal requests, return text only. Do not add labels,
milestones, projects, or assignees unless requested or unambiguously specified.

## Research

1. Read the root and relevant local `CLAUDE.md` files.
2. Inspect enough current code or documentation to avoid stale assumptions.
3. Search open issues when duplicate risk is meaningful.
4. Ask one blocking question only when expected behavior or scope cannot be inferred.

Do not invent reproduction results, environment details, ownership, severity, or
implementation decisions.

## Write

Use a concise title with the affected area. Structure the body around the problem or
opportunity, current and expected behavior, scope, acceptance criteria, relevant
implementation context, and verification expectations.

For a bug, include reproduction steps, actual and expected results, and environment only
when known. Use unchecked tasks only for independently verifiable acceptance criteria.
Put unknown details in HTML comments instead of presenting guesses as facts.

Create with `gh issue create` only after the authorization condition is satisfied.
Return the final title, issue URL if created, assumptions, and confirmation that no extra
metadata changed unless requested.
