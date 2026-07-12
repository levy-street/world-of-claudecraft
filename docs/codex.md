<!-- docs/ - operator guidance for repository Codex support. -->

# Codex in World of ClaudeCraft

The checked-in Codex layer makes a root-launched session productive without copying or
changing the Claude Code architecture. Root and local `CLAUDE.md` files own repository
truth. `AGENTS.md`, `.codex/`, and `.agents/` add only Codex discovery, orchestration,
permissions, and workflow guidance.

## Start a session

1. Start from the requested release branch. Use an isolated worktree when another
   session may share the checkout.
2. Launch Codex at the worktree root and trust the project only after reviewing
   `AGENTS.md`, `.codex/config.toml`, and `.codex/hooks.json`.
3. Restart Codex after pulling changes to project instructions, agents, skills, or hooks.
   Codex builds its instruction chain at session start.
4. Use `/hooks` to review and trust changed project hooks.
5. Run `$woc-qa` before calling implementation work complete.

`project_doc_fallback_filenames = ["CLAUDE.md"]` makes a local `CLAUDE.md` discoverable
when Codex starts inside a nested directory. A session launched at the root does not
dynamically load local instructions when it later opens a nested file, so `AGENTS.md`
also requires an explicit local read.

## Models stay selectable

The repository does not pin a model or reasoning effort. The active user or session
selection flows into custom agents, so new models do not require an architecture edit.
Use `/model` to select for the task.

Current public model guidance is:

| Model | Best fit |
|---|---|
| `gpt-5.6-sol` | Ambiguous architecture, security, research, and high-value implementation |
| `gpt-5.6-terra` | Balanced everyday engineering |
| `gpt-5.6-luna` | Clear, repeatable, latency-sensitive work |

The public name is Terra. `terrace` is not a documented model name. Names and availability
can change, so verify them on the [official Codex models page](https://learn.chatgpt.com/docs/models).
Correctness, tests, and review requirements never change with model selection.

## Checked-in surfaces

| Surface | Purpose |
|---|---|
| `AGENTS.md` | Thin Codex bootstrap, safety boundaries, routing, and completion contract |
| `.codex/config.toml` | Canonical-doc fallback, instruction budget, and bounded parallelism |
| `.codex/hooks.json` | Fast session and stop hooks that reuse shared project scripts |
| `.codex/agents/*.toml` | Narrow read-only reviewers that inherit the active model |
| `.agents/skills/*/SKILL.md` | Repeatable project workflows with precise triggers |
| `docs/codex.md` | Operator setup and maintenance guidance |

Personal profiles, auth, provider settings, caches, sessions, and worktrees stay ignored.
The project config deliberately does not set model, effort, sandbox, approval policy,
network access, provider, or credentials.

## Skills

- `$woc-qa` coordinates checks once and dispatches matching reviewers.
- `$woc-extract-and-test` implements behavior through a focused tested seam.
- `$woc-feature-plan` creates model-neutral vertical slices for large work.
- `$woc-review-pr` reviews and drafts by default; posting needs explicit authorization.
- `$woc-file-issue` creates an issue only after an explicit request to file it.
- `$woc-release-merge-audit` finds semantic damage after release integration.
- `$woc-release-malware-audit` combines the deterministic scanner with contextual triage.
- `$woc-codex-audit` checks this architecture against current official guidance.

Skills contain workflow decisions and sequencing, not facts that a targeted search can
recover. High-impact planning and GitHub issue creation disable implicit invocation.

## Specialist agents

The read-only roles are `woc_sim_architecture`, `woc_cross_platform`,
`woc_persistence`, `woc_security`, `woc_test_coverage`, `woc_frontend`,
`woc_release_malware`, and `woc_docs_researcher`. The main agent owns edits,
integration, and deterministic commands. Review agents inspect the established diff and
shared results so the same gate is not run eight times.

The documentation researcher has only the official OpenAI Developer Docs MCP configured.
It is optional and holds no credential. Add broader MCP servers only for a demonstrated
workflow, with narrow tools and environment-backed authentication. See the
[official MCP guide](https://learn.chatgpt.com/docs/extend/mcp).

## Hooks and QA

Codex and Claude Code reuse the same fast hook scripts without changing `.claude/**`:

- `SessionStart` runs `.claude/hooks/ensure-hooks.sh` to enable `.githooks/pre-push`.
- `Stop` runs `.codex/hooks/qa-stop.sh`, which delegates to the shared Claude script and
  adds untracked Codex TOML and declaration files to the same copy checks.

Hooks are an edit-loop aid, not a security boundary or completion gate. The canonical QA
layers and commands are in `docs/qa-gate.md`; the full local gate is `npm run gate`.

## Parallel work and worktrees

Use native subagents for bounded exploration, logs, tests, and independent review. Keep
one implementation owner for overlapping paths and let the main agent integrate every
result. The checked-in maximum is six threads with one delegation level, which permits
useful breadth without recursive coordination sprawl.

When sessions overlap, create a worktree outside the shared checkout from the requested
release branch. Never infer permission to commit, push, post, or modify another session's
work.

## Pull request automation

`.github/workflows/pr-ai.yml` uses `openai/codex-action@v1` with an API-key proxy,
read-only permission profile, `drop-sudo`, an empty Codex home, and structured output.
The PR checkout is nested untrusted data and no PR code is executed. A separate fresh job
with no OpenAI credential validates, redacts, and posts the review.

Configure:

- Repository secret `OPENAI_API_KEY`.
- Optional repository variables `CODEX_REVIEW_MODEL`, `CODEX_REVIEW_EFFORT`, and
  `CODEX_CLI_VERSION`.

Never store a ChatGPT `auth.json` in CI. See `docs/ai-pr-bot.md` and the
[official action security guide](https://github.com/openai/codex-action/blob/main/docs/security.md).

## Maintenance

Run `$woc-codex-audit` when Codex surfaces change or on a periodic read-only schedule.
It should compare configuration with the published schema and official docs, then report
drift before changing anything. A plugin is intentionally absent because repository
skills auto-discover; package this as a plugin only when it must install across projects.
Experimental command rules and managed `requirements.toml` are also absent until a real
policy need justifies them.

Useful validation:

```sh
npx vitest run tests/codex_setup.test.ts tests/ai_review.test.ts tests/malware_scan.test.ts
npx tsc --noEmit
npm run gate
```

Primary references: [AGENTS.md discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[skills](https://learn.chatgpt.com/docs/build-skills),
[custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[hooks](https://learn.chatgpt.com/docs/hooks), and
[configuration](https://learn.chatgpt.com/docs/config-file/config-reference).
