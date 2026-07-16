# Toolchain Modernization: whole-packet integration QA matrix

Verified once at packet completion (Phase 5 QA), on top of the per-phase QA passes.
This packet is toolchain work, so the game-feature rows reduce to behavior-preservation
proofs.

- Behavior preservation: the resolved i18n output is byte-identical to before the packet
  (npm run i18n:gen twice leaves a clean tree; the committed locale slices carry no
  diff attributable to this packet). No runtime module changed except the TranslationKey
  type source, which is erased at build time.
- Determinism of generators: every generated artifact (locale slices, pending, loaders,
  the new translation_keys.generated.ts, the gitignored summary) regenerates
  byte-identically under the perturbed-env determinism tests.
- Type safety is stronger, not weaker: the canonical probe pair (a bogus overlay key
  entities.itemSets.bogus_zzz.name and a bogus t() literal, the same pair Phase 2 and
  Phase 2 QA used) both fail npx tsc --noEmit (they did not both fail before Phase 2).
- Conflict elimination proof: two scratch branches each adding a key in different
  catalog domains, both regenerated, merge with ZERO conflicts (the Phase 1 acceptance
  experiment, re-run at packet close).
- CI: three consecutive PR runs green with wall time at or under 4 minutes; the
  freshness step still fails legibly on a deliberately staled slice; the audit counts
  appear in the job summary; release-gate green on a release/** push.
- Toolchain: npm run check:types green with node_modules/.bin/tsc reporting the 7.0.x
  version Phase 5 recorded in progress.md and svelte-check on the TS6 wrapper;
  tests/server/new_endpoint.test.ts green (golden child tsc through the extends chain);
  .githooks/pre-push dry run green; a tsc --checkers 8 run is clean.
- Local gate: npm run gate fully green on a non-release branch AND release-tier
  (I18N_RELEASE_TIER=1) green on the release branch before the final merge.
  (Clause updated 2026-07-15 by Phase 3 QA: the v0.26.0 fill emptied pending, so
  pending-row locale reds are NO LONGER an expected mid-cycle state; a red
  release tier is a real regression unless a new post-fill catalog key
  legitimately reintroduced pending rows, in which case record exactly which.)
- Verdict preservation: this filled matrix is pasted into the final PR body or the
  issue #1868 summary before any packet teardown.
- Pinned tests all green and still meaningful: tests/ci_workflow.test.ts,
  tests/sfx_gate_preflight.test.ts, tests/i18n_resolved_equivalence.test.ts,
  tests/i18n_status_registry.test.ts, tests/localization_fixes.test.ts (S3 guard),
  tests/architecture.test.ts.
- Copy review: no em dashes, en dashes, or emojis introduced anywhere by this packet.
- Docs: every doc/skill that referenced the removed artifacts or the old typescript
  version is updated (the Phase 1 and Phase 5 sweeps); CONTRIBUTING.md matches the new
  contributor workflow; re-evaluation triggers are recorded in state.md.
- Dependency hygiene: the dependency set gained nothing beyond the typescript aliases;
  package-lock.json diff reviewed; no install scripts added.
- Deploy: not applicable (no server or client runtime change ships from this packet);
  the production Docker build consumes the same vite/esbuild outputs as before.
