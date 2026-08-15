# Guild Bank: planning packet

PR B of the guild customization initiative: a shared guild bank at the banker NPC, officer
and leader only in v1. One pooled item container (12 free slots, treasury-funded slot
expansions as a gold sink), a copper treasury with a hard cap, a 10 gold guild creation
fee, and full audit coverage through the existing `bank_ledger` (which already reserved
`container = 'guild'`). Lands AFTER PR A (`docs/guild-social-v1/` on
`feature/guild-social-v1`); rebase this branch over the release branch once PR A merges.

Branch: `feature/guild-bank`, based on `release/v0.34.0`.

## Index
- [brainstorm.md](brainstorm.md): vision, approved scope, architecture decision, reuse map.
- [implementation-plan.md](implementation-plan.md): team workflow, review dispatch matrix,
  phase summary table.
- [progress.md](progress.md): status table and per-phase deliverable checklists.
- [state.md](state.md): locked decisions, constants, validation matrix, cross-phase ledger.
- [qa-checklist.md](qa-checklist.md): whole-feature integration QA matrix.
- Phase files (each self-contained; paste into a fresh session):
  - [phase-01-foundation.md](phase-01-foundation.md) + [phase-01-qa.md](phase-01-qa.md)
  - [phase-02-ops-and-wire.md](phase-02-ops-and-wire.md) + [phase-02-qa.md](phase-02-qa.md)
  - [phase-03-persistence.md](phase-03-persistence.md) + [phase-03-qa.md](phase-03-qa.md)
  - [phase-04-ui.md](phase-04-ui.md) + [phase-04-qa.md](phase-04-qa.md)

## Phase order
1. Foundation: sim guild-bank module, membership stamp, `IWorldGuildBank` facet.
2. Ops and wire: command bodies, gating, `guild_bank_*` tokens end to end.
3. Persistence: `guild_banks` table, escrow transaction, ledger, creation fee, disband guard.
4. UI: the Guild tab in the bank window, i18n, mobile, screenshots.
Each phase is followed by its QA phase; Phase 4 QA closes the packet and offers teardown.
