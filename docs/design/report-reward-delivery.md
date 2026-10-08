# Successful report feedback

`moderateAccount` creates rewards only when banning an account. Every human
reporter with an open or previously actioned report receives one reward per
reported account for the lifetime of the reporter account. Ignored reports,
self-reports, and automated reports do not qualify. The existing cheating report
category includes suspected bots.

The anonymous notice says "An account you reported has been banned". It follows
the reporter account across realms and remains pending while the reporter is
offline. Ravenpost mail thanks the reporter for keeping the game fair, with no
money or item attachments. Mail goes to an owned reporting character, falling back to
another owned character if the original character was deleted before delivery.

`report_rewards_db.ts` creates the permanent pair ledger inside the ban transaction.
`report_rewards.ts` drains bounded realm pages. Mailbox overflow remains pending.
Booking commits the ledger transition and custody parcel together before modifying
live mail. The existing custody overlay replays an interrupted booking at boot,
and the recipient partition save atomically removes the baked overlay.

New report mail grants no gold. Existing attachment recovery support remains for
legacy report letters: `VaultMailTakeGuard` pairs their character and mail saves,
and recovery preserves their stored attachments without granting vault progression.
The letter id and custody kind remain stable for persistence compatibility.

## Deployment and rollback

Deploy the updated server to every realm and moderation process before relying on
this feature. An older moderation process cannot create reward claims. The prior
release cannot replay the new `report_reward` custody kind, and its residue prune
does not preserve these parcels. It also lacks paired collection and recovery for
report reward letters. Use forward recovery while report reward custody parcels,
unclaimed report attachments or report collection recovery rows remain; rollback
to that older server is unsafe while any of those exist.
Do not substitute `vault_reward`: older servers would grant vault progression and
use an incompatible recovery reference contract.

`tests/report_rewards_pg_integration.test.ts` owns SQL deduplication, concurrency,
rollback and recipient routing proofs. `tests/report_reward_collection.test.ts`
pins attachment-free delivery plus legacy paired collection and restart behavior. The report-specific overlay test in
`tests/server/mail_custody_overlay.test.ts` pins replay and persisted-letter dedupe.

## Performance evidence

A local benchmark exercised the real Sim and delivery worker, with injected database
ports and 100 pending rewards, against 1,000 and 100,000 unrelated existing mail rows.
Mean booking time was 0.0030 ms and 0.0018 ms respectively. Each pass serialized only
100 affected recipient partitions (about 57 KB). A quiet pass made no claim, retry
or notice-acknowledgement writes.
This single warmed pass supports collection-size independence; it does not establish
an absolute latency guarantee or PostgreSQL query performance. Live database
concurrency, query plans and lock cancellation still require a disposable PostgreSQL
environment before release readiness can be claimed.

## Local verification

The following results describe the original 6 October 2026 implementation,
before removal of the gold reward. Follow-up verification is recorded below.
These focused checks passed (223 tests total):

```text
npx vitest run tests/report_rewards.test.ts tests/report_rewards_game.test.ts tests/report_reward_mail_load.test.ts tests/log_event_feedback_core.test.ts tests/monolith_budget.test.ts --maxWorkers=1
44 passed

npx vitest run tests/report_rewards_db.test.ts tests/report_reward_mail_admission.test.ts tests/report_reward_collection.test.ts tests/report_rewards_pg_integration.test.ts tests/moderation_db.test.ts tests/server/mail_custody_overlay.test.ts tests/server/vault_mail_take_guard.test.ts tests/server/vault_mail_take_recovery.test.ts --maxWorkers=1
122 passed; 7 PostgreSQL integration cases skipped (TEST_DATABASE_URL unavailable)

npx vitest run tests/localization_coverage.test.ts --maxWorkers=1
57 passed; 3 release-tier cases skipped
```

Browser verification exercised the real HUD: desktop and mobile landscape render
the exact banner; filtered System chat still announces it through `chat-live`;
the opened Ravenpost letter showed the original thank-you text and gold attachment.
The captured letter is `docs/screenshots/report-rewards/desktop-mail.png`.

`npm run gate` regenerated i18n, wiki and SFX artifacts successfully, then stopped
at i18n freshness: new generated translations differ from the Git index. This task
does not authorize staging. Remaining canonical steps were run separately using
the same `buildFullGateSteps` commands and environment:

```text
npm run security:gate
PASS: 10,943 files scanned, zero high findings after priors

pnpm exec biome check <all 37 changed, nongenerated TypeScript files>
PASS: no errors; 36 warnings

git diff --check
PASS

npm test -- --maxWorkers=2 (WOC_SKIP_PRETEST=1)
INCOMPLETE: stopped after approximately 115 minutes; failures had already appeared
in repository tooling/platform fixtures and gameplay timeouts. No full-suite pass claimed.

npm run test:browser
PASS: 521 tests in 64 files

node_modules/.bin/turbo run check:types build:env build:server build:bot --ui=stream
PASS: client, admin and bot types; environment, server and bot builds

node_modules/.bin/turbo run build:bundle --ui=stream
PASS: production client bundle, backdrop survival and hashed media emission
```

The broad run exposed a task-owned authored-letter count pin, corrected from eight
to nine; the full localization suite subsequently passed as recorded above.
Other broad-run failures were not all triaged. Confirmed Windows path assumptions
include the `server/` source guards in `professions_farming_state` and
`server/auth_guard_bust_coverage`; neither test normalizes native backslashes.
Do not treat the interrupted run as a clean baseline or a complete regression result.
The gameplay timeout cases passed with a single worker and no concurrent browser:

```text
npx vitest run tests/corpse_harvest_sim.test.ts tests/professions_fishing.test.ts tests/varkhul_forge_encounter.test.ts tests/gather_node_placement.test.ts tests/bags.test.ts tests/necromancy.test.ts --maxWorkers=1 -t 'every family a harvest|an empty-hook reel|keeps exposure until|replays Warden and Artificer|bottom-map gathering circuit|a fresh character has the 16-slot|regenerates one Soul Fragment|spends fragments to make every undead|Army of the Dead preserves|Sacrifice Undead consumes'
PASS: 13 matching tests; 430 filtered out
```

SFX/media manifest regeneration, trackedness and freshness checks passed.
The browser regression run's unrelated screenshot rewrites were restored; only
the report-reward screenshots belong to this contribution.

QA verdict: **NOT READY for release**. The implementation and scoped checks are
complete, but a clean canonical gate and disposable PostgreSQL runtime evidence
remain outstanding. These results preceded PR preparation.

## Gold removal, 8 October 2026

The authored report letter, delivery confirmation and SQL custody insert now all
carry zero copper and no items. The English body, five non-Latin translations and
guide text no longer promise gold. The ban notice and thank-you message remain.
Legacy attachment recovery tests still use explicit historical gold fixtures;
they do not represent the current letter template.

Follow-up checks:

```text
npm run i18n:gen
npm run wiki:content
PASS: generated translations and guide content

npx vitest run tests/report_rewards.test.ts tests/report_rewards_db.test.ts tests/report_rewards_game.test.ts tests/report_reward_collection.test.ts tests/report_reward_mail_admission.test.ts tests/report_reward_mail_load.test.ts tests/report_rewards_pg_integration.test.ts tests/server/mail_custody_overlay.test.ts tests/log_event_feedback_core.test.ts tests/localization_coverage.test.ts --maxWorkers=1
122 passed; one obsolete gold expectation failed and was corrected

npx vitest run tests/log_event_feedback_core.test.ts --maxWorkers=1
4 passed after correction; 123 distinct focused tests passed across both runs
7 PostgreSQL cases and 3 release-tier cases remained skipped

pnpm exec tsc --noEmit
PASS

pnpm exec biome check --write <changed nongenerated TypeScript files>
PASS: no errors

node scripts/gate_select.mjs
BLOCKED at i18n freshness: regenerated translations differ from the Git index

npm run security:gate
PASS: zero high findings after priors

git diff --check
PASS
```

The new real-Sim test verifies attachment-free mail, unchanged player copper and
restart behavior. The overlay test verifies that replay also carries zero copper.
Real-browser verification opened the current letter in the actual mailbox and
confirmed the thank-you text, no money or item attachments, and no collection
button. `docs/screenshots/report-rewards/desktop-mail.png` shows this updated mail.

## CI facade correction

CI exposed a direct server read of `sim.postOffice` for report-mail admission.
`server/main.ts` now calls `Sim.canBookReportRewardMail`; the mailbox admission
tests exercise this facade, retaining indexed counts and the existing limit.

```text
npx vitest run tests/server_sim_facade.test.ts tests/report_reward_mail_admission.test.ts tests/monolith_budget.test.ts --maxWorkers=1
PASS: 27 tests
pnpm exec tsc --noEmit
PASS
pnpm exec biome check server/main.ts src/sim/sim.ts tests/report_reward_mail_admission.test.ts
PASS: no errors
```
