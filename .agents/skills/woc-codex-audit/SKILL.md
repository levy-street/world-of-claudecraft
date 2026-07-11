---
name: woc-codex-audit
description: "Audit World of ClaudeCraft Codex support for current conventions, model neutrality, instruction quality, agent safety, skill design, hooks, CI integration, and documentation drift. Use when reviewing or modernizing AGENTS.md, .codex, .agents, Codex workflows, Codex-facing scripts, or the repository AI architecture."
---

# Codex Architecture Audit

Evaluate whether Codex receives concise, safe, current, and scalable operating context
without altering the Claude Code architecture. An audit request is read-only. Apply fixes
only when the user explicitly requests implementation.

## Preserve boundaries

1. Read the root `CLAUDE.md`, `AGENTS.md`, and relevant local `CLAUDE.md` files.
2. Run `git status --short` and preserve unrelated work.
3. Treat root and local `CLAUDE.md` files as canonical repository truth.
4. Do not edit `CLAUDE.md` or `.claude/**` as part of Codex support work.

Codex files should point to canonical instructions and add only Codex runtime guidance.

## Research current behavior

Use current official OpenAI documentation for Codex configuration, skills, agents,
hooks, permissions, model selection, and CI. Clearly separate documented facts from
inference. Keep repository guidance model-neutral unless a task has an evidence-backed
capability requirement, and prefer inheritance over project model pins.

Use the `woc_docs_researcher` custom agent for a bounded official-documentation pass when
it is available. Verify consequential recommendations against the cited primary source.

## Inventory

Inspect `AGENTS.md`, `.codex/**`, `.agents/skills/**`, custom agents, hooks, Codex GitHub
workflows, AI-facing scripts and tests, documentation, ignore rules, and malware scanner
coverage. Identify duplicated, abandoned, shadowed, untracked, or conflicting settings.

## Assess

Verify that:

- canonical instructions are referenced instead of copied;
- guidance encodes decisions that a simple search cannot recover;
- skill triggers and implicit-invocation policy match risk;
- external writes require explicit authorization;
- review-only workflows remain read-only;
- the coordinator owns command execution and reviewers are scoped;
- models, effort, permissions, and providers are not unnecessarily pinned;
- hooks are fast, deterministic, local, and secret-safe;
- CI isolates untrusted input, uses least privilege, and protects credentials;
- worktree, dirty-tree, branch, and commit rules protect concurrent sessions;
- shared and personal Codex state have deliberate tracking rules;
- tests and scanners cover instruction-bearing Codex files;
- documentation matches effective configuration.

Classify findings as `P0` immediate credential or destructive risk, `P1` architecture or
reliability defect, or `P2` drift and maintainability. Include evidence, impact, and the
smallest change. Also report active surfaces, intentional Claude-only items, redundancy,
missing verification, implementation order, and one verdict: `CURRENT`, `NEEDS
MAINTENANCE`, or `NEEDS REDESIGN`.
