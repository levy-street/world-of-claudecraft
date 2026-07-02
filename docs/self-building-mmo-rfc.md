# Self-Building MMO RFC

Issue #203 sketches an in-game path from player suggestions to actual game
changes. This RFC narrows that idea into a staged architecture that can be
reviewed safely before any automation, voting, funding, or merge behavior is
built.

The guiding principle is simple: the game may surface community intent, but code
still moves through the same public repository, human review, tests, and release
gates as every other contribution.

## Goals

- Let players express feature requests, server preferences, and PR feedback from
  inside the world without replacing GitHub as the source of truth.
- Preserve ordinary open-source contribution paths. A human-authored PR should
  never be disadvantaged because it did not originate from an in-game NPC.
- Make every stage auditable: who proposed it, what server or realm it came from,
  what players supported it, which PR implements it, and which release included
  it.
- Keep the first implementation read-only or advisory so it can ship without
  risking autonomous merges, secret exposure, or accidental paid development
  loops.

## Non-Goals

- No autonomous merging.
- No repository-secret access from player-triggered workflows.
- No paid voting, token-weighted governance, API-credit escrow, refunds, or
  contributor payouts in the first implementation.
- No server-specific forks that silently change shared client or account data.
- No generated code path that bypasses lint, tests, review, or release branches.

## Suggested Stages

### Stage 0: Public Design Log

Create a durable design log for meta-development proposals. Entries can be
copied from GitHub issues, Discord summaries, or future in-game suggestion
surfaces, but each entry must link back to a public issue or discussion.

Required fields:

- proposal title and public URL;
- proposer identity as displayed in the source system;
- affected realm or "global";
- current status: idea, needs design, accepted for PR, implemented, rejected, or
  superseded;
- links to implementation PRs and release notes when they exist.

This stage is documentation-only and can land before any game UI exists.

### Stage 1: In-Game Suggestion Export

Add a non-binding suggestion surface in the game, such as a steward NPC or a
realm notice board. It should export structured text for a GitHub issue or
discussion rather than opening PRs directly.

Guardrails:

- rate-limit submissions per account and per realm;
- require an authenticated account with a character on that realm;
- store only the suggestion text, realm, character display name, and timestamps;
- moderate or redact abusive content before it leaves the game server;
- make clear to players that suggestions are advisory and public once exported.

### Stage 2: PR Feedback And Realm Polls

Allow players to view a small, curated list of open PRs or proposals from inside
the game and record non-binding support, concern, or "needs more design" votes.

Guardrails:

- votes are advisory signals for maintainers, not merge authority;
- use one account, one vote per proposal unless a future design explicitly
  chooses another rule;
- expose aggregate counts, not private account identifiers;
- keep GitHub labels, checks, reviews, and branch status authoritative.

### Stage 3: Human-Triggered AI Assistance

Use the existing PR AI assist pattern as the model: humans trigger review or
suggestion jobs, jobs are informational, and missing credentials make the job
skip safely. See [`docs/ai-pr-bot.md`](ai-pr-bot.md) for the current
non-blocking review and screenshot workflow. Player input may become prompt
context, but it must never execute untrusted code or receive repository secrets.

Any generated patch must appear as an ordinary branch and PR with:

- a human-visible diff;
- a filled PR template;
- tests appropriate to the changed surface;
- screenshots or recordings for UI changes;
- maintainer review before merge.

### Stage 4: Realm Experiments

Realm-specific experiments can be considered only after shared-account,
inventory, progression, and migration rules are explicit.

Open questions before this stage:

- Can a character move between realms that run different rules?
- Which data is global, realm-local, or experimental?
- How are incompatible inventory, achievement, quest, or economy changes handled?
- How can players preview, leave, or roll back from a realm experiment?
- Who operates and moderates a realm-specific fork?

## Safety Requirements

- Player-triggered workflows must never run with repository secrets available to
  untrusted code or untrusted prompt content.
- The server should treat in-game proposals as content, not commands.
- Development actions must be idempotent and auditable. A repeated vote,
  suggestion, webhook, or export must not duplicate side effects.
- Any workflow touching money, tokens, sponsorship, paid API credits, refunds, or
  contributor compensation requires a separate risk review before implementation.
- Public communication must avoid promising that votes, payments, or generated
  suggestions will be accepted or merged.

## First Viable Slice

The first shippable slice should be Stage 0 only: a documented design log and a
manual process for linking issues, proposals, PRs, and releases. That gives
maintainers a place to evaluate the self-building MMO idea while keeping all
development authority in the current GitHub review process.
