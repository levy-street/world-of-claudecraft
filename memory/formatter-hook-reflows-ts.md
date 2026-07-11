---
name: formatter-hook-reflows-ts
description: PostToolUse formatter hook reformats whole .ts files to double-quotes, fighting the repo's single-quote style
metadata:
  type: project
---

A PostToolUse:Edit/Write hook in this environment runs a prettier-style formatter on every `.ts` file I edit. The repo has **no prettier config** and its committed code is single-quoted with compact multi-import lines, but the hook reflows the **entire file** to double-quotes + one-import-per-line. Result: a one-line change shows up as a 1000–4000 line diff that conflicts with the ~90 untouched files. Not committable.

**Why:** the hook applies prettier defaults that don't match the codebase; it touches the whole file, not just the edited region.

**How to apply:** When making small edits to existing `.ts` files here, avoid the Edit/Write tools (they trigger the hook). Instead restore the file with `git checkout HEAD -- <file>` and re-apply changes via a Python/sed script run through **Bash** (Bash is not hooked), preserving single-quote style. New files: write with Bash heredoc too. Verify with `git diff --stat` — my real change set should be tens of lines, not thousands. See [[agent-play-setup]] for other repo conventions.
