---
name: file-issue
description: Create a GitHub issue for World of ClaudeCraft in the maintainer's house format. Use when asked to file, open, or create a GitHub issue or bug report from a description, a screenshot, or a rough placeholder. Rewrites the input into a clean, professional issue (Problem, Steps to reproduce, Expected, Actual, Scope, Acceptance criteria) and includes a Screenshot section only for UI/UX issues. Posts to levy-street/world-of-claudecraft via gh.
user-invocable: true
---

# File an issue (World of ClaudeCraft house style)

Turn a rough description, screenshot, or placeholder into a clean, professional GitHub
issue that matches how the maintainer writes them, then create it on the canonical repo.
Reference issues for the voice and shape: `#1050` (feature/behavior) and `#1051`
(UI/UX bug with a screenshot section).

## Voice and rules

- Plain, professional, calm. No marketing, no preamble, no AI voice.
- **No em dashes, en dashes, or emojis** anywhere in the title or body. Use commas,
  colons, parentheses, or "to" for ranges. (This repo bans them; do not introduce them.)
- Be specific and factual. Rewrite vague placeholder copy into concrete, testable
  statements. If a detail is unknown, leave a clearly marked HTML comment rather than
  guessing a fact.
- Title: short and descriptive, stating the problem (for example, "Unable to scroll the
  world market UI on mobile"). A severity prefix ("Critical: ...") is optional and only
  for genuinely high-severity issues, matching the maintainer's style in `#1050`.

## Step 1: Gather and classify

From the user's input work out:

- The core problem in one or two sentences.
- Whether it is a **bug** (something is broken) or a **request** (new or changed
  behavior). Bugs get Steps to reproduce plus Actual behavior; requests usually do not.
- Whether it is **UI/UX related** (visual, layout, HUD, mobile, input, rendering). Only
  UI/UX issues get the Screenshot section.
- Whether it is **platform or device specific** (mobile, landscape, a browser). If so,
  include an Environment section.

If the core problem or the expected behavior is genuinely unclear, ask one short
clarifying question before drafting. Do not stall on details you can reasonably infer
from a screenshot or the description, note inferred specifics back to the user instead.

## Step 2: Draft the body

Use this section set. Include the core sections always; include the situational ones
only when they apply. Keep each section tight.

Core (always):

```
## Problem

<One to three short paragraphs: what is wrong or missing, and why it matters.>

## Expected behavior

- <Bulleted, concrete, observable statements of what should happen.>

## Scope

<What to investigate or change. A short bulleted list of the affected areas/tabs/flows.>

## Acceptance criteria

- <Checkable conditions that mean this is done. Mirror the Expected behavior, made testable.>
- <For UI/mobile bugs, include "the desktop experience is unchanged" or the equivalent.>
```

Situational (include only when they apply):

```
## Steps to reproduce        # bugs only

1. <step>
2. <step>
3. <observe the failure>

## Actual behavior           # bugs only

- <What actually happens today, the mirror of Expected behavior.>

## Environment               # platform/device-specific only

- Platform: <mobile web landscape / desktop / etc.>
- Surface: <in-game HUD window, guide page, admin, etc.>

## Notes                     # optional: likely root cause, non-goals, related work
```

## Step 3: Screenshot section (UI/UX issues only)

If, and only if, the issue is UI/UX related, append a Screenshot section as a placeholder
the user fills in later. If the user already provided an image, still leave the
placeholder (issues are created from text via `gh`; the user attaches the image in the
GitHub web UI afterward) and tell them where to drop it.

```
## Screenshot

<!-- Only add a screenshot if this issue is UI/UX related. Drag the image in here. -->
```

For a non-UI issue (logic, server, balance, content), omit the Screenshot section
entirely.

## Step 4: Create it

Write the body to a temp file and create the issue on the canonical repo. Always
`levy-street/world-of-claudecraft`, never a fork.

```
gh issue create \
  --repo levy-street/world-of-claudecraft \
  --title "<title>" \
  --body-file <path-to-body.md>
```

Use `--body-file` (not `--body`) so headings, lists, and the HTML comment survive shell
quoting. Add `--label`/`--assignee` only if the user asked for them.

Creating an issue is outward-facing, but invoking this skill IS the request to create it,
so create directly. Then report back: the issue URL, the title, and a one-line note of
any specifics you inferred (so the user can correct them) plus, for UI/UX issues, a
reminder that the Screenshot section is waiting for their image.
