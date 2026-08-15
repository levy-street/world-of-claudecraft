# Guild Social v1: planning packet

PR A of the guild customization initiative: surface the existing guild billboard (MOTD) as a
login notice, add cosmetic tenure badges (New / Veteran) to the guild roster, and close the
moderation gap where guild names skip offensive-name screening. Small, client-heavy, ships
ahead of the guild bank PR (`docs/guild-bank/` on the `feature/guild-bank` branch).

Branch: `feature/guild-social-v1`, based on `release/v0.34.0`.

## Index
- [brainstorm.md](brainstorm.md): vision, approved scope, current-state findings, reuse map.
- [implementation-plan.md](implementation-plan.md): team workflow, review dispatch matrix,
  and the phase starter prompts (Phase 1, Phase 1 QA, Phase 2, Phase 2 QA).
- [progress.md](progress.md): status table and per-phase deliverable checklists.
- [state.md](state.md): locked decisions, validation matrix, key paths, cross-phase ledger.
- [qa-checklist.md](qa-checklist.md): whole-feature integration QA matrix.

## Phase order
1. Phase 1: guild billboard shown at login (client-side decision module + HUD wiring + i18n).
2. Phase 1 QA.
3. Phase 2: tenure badges on the roster + offensive-name screening for guild creation.
4. Phase 2 QA (closes the packet; offers packet teardown before the PR).
