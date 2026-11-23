# Membership verification

Base: PR #4281 at `7eef16c0b11ef6cb5828bacc5ee0e7af220df3d4`.
The implementation was verified in the `feature/membership-benefits` worktree
before publication to PR #4281.
See [membership design and deployment contract](membership.md) and
[desktop/mobile evidence](../screenshots/membership/README.md).

## Currency reward removal

The current offers preserve USD 5 monthly and USD 50 annual pricing, the trial,
and the paid annual mount. The store no longer advertises a currency reward, and
legacy service reward fields are discarded by the validated game contract.
The companion service removes future credits while preserving historical payment
identities and existing balances. Verified refunds can still reverse actual old
credits; deploying the new code alone does not debit them.

Current checks:

- `npx --no-install vitest run tests/subscription_contract.test.ts tests/subscription_sdk.test.ts tests/subscription_checkout_intents.test.ts tests/store_subscription.test.ts tests/store_subscription_offers.test.ts tests/server/subscription.test.ts tests/server/subscription_annual_proxy.test.ts tests/i18n_completeness.test.ts --maxWorkers=2`: 71 passed.
- `npx --no-install tsc --noEmit`: passed.
- `npx --no-install turbo run check:types build:env build:server build:bot build:bundle`: all seven tasks passed.
- Final offer/localization/CI regression (`subscription_contract`,
  `store_subscription_offers`, `i18n_completeness`, `ci_workflow`): 52 passed.
  Includes the CI checkout entry missing for the earlier referral-armour screenshots.
- `npx --no-install vitest run --config vitest.browser.config.ts tests/browser/membership_bank.browser.test.ts tests/browser/store_purchase_prompt_stacking.browser.test.ts`: five passed.
- Companion service `npm test` with disposable PostgreSQL 16.15: 746 passed,
  zero failures or skips. Includes both historical reward amounts, migration,
  replay, refunds, annual mounts, and bounded invoice-history persistence.
- Refreshed desktop, portrait, landscape and forced-colors component screenshots.
  Both checkout controls remain 40px high; no horizontal overflow or page errors.

## Focused verification

The 2026-10-06 extension adds the seven-day trial and the
annual tank-mount bundle. Its final focused command is recorded below; all
18 files passed, with 571 tests passed and three existing skips:

```powershell
$env:WOC_SKIP_PRETEST='1'
# TEST_DATABASE_URL points to the disposable local PostgreSQL instance.
npx vitest run tests/subscription_contract.test.ts tests/subscription_sdk.test.ts tests/subscription_checkout_intents.test.ts tests/store_subscription.test.ts tests/store_subscription_offers.test.ts tests/server/membership_annual_store.test.ts tests/reliquary_content.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts tests/localization_coverage.test.ts tests/membership_token_delivery.test.ts tests/membership_token_delivery_pg_integration.test.ts tests/server/mail_custody_overlay.test.ts tests/mounts.test.ts tests/server/subscription.test.ts tests/server/subscription_annual_proxy.test.ts tests/membership_service.test.ts tests/server/http/completeness.test.ts --maxWorkers=2
```

These checks cover account-scoped checkout recovery, explicit retries after
confirmed expiry, cross-device mount claims, trusted recipient validation,
durable mail replay, trial expiry, content inventories and localized offer copy.
The companion service's final `npm test` passed 738 tests with no failures or
skips, including real PostgreSQL settlement and 10,000-row receipt discovery.

Extension checks also passed: `npm run check:types` (including Svelte and bot),
`npm run build:bundle`, `npm run ci:changed` (warnings only),
`npm run security:gate` (zero high findings), `npm run i18n:gen`, and
`npm run wiki:content`. The environment, server and bot builds succeeded in
`npx turbo run check:types build:env build:server build:bot --ui=stream`; its
initial contract type error was fixed before the successful separate type run.
Explicit scoped Biome checking included untracked source files. Desktop, portrait,
landscape and forced-colors component screenshots were inspected. Database,
security, hot-path, frontend and test-coverage reviews passed after fixes.
The 2026-10-06 `npm run gate` retry still stops at unstaged i18n freshness, as
described under remaining release conditions below.
`npx vitest run --config vitest.browser.config.ts tests/browser/membership_bank.browser.test.ts tests/browser/store_purchase_prompt_stacking.browser.test.ts`
also passed both files and all five browser tests after the extension.

- `npx vitest run` over every membership suite plus subscription SDK/store,
  character HTTP/WS/database, player identity, snapshots, architecture, monolith,
  localization, world/command parity, equipment inspection, legendary display and
  Discord top-character regression suites, with `--maxWorkers=2`: 38 files and
  1,495 tests passed. Database integration suites ran against a disposable local
  PostgreSQL 16.15 instance using `TEST_DATABASE_URL`.
- `npm run test:browser`: 65 files and 522 tests passed. The two additional
  membership mobile-target tests passed in their scoped run after the full run.
- `npx turbo run check:types build:env build:server build:bot --ui=stream` passed.
- `npm run build:bundle` passed.
- `npm run security:gate` passed with no high findings after existing priors.
- `npm run ci:changed` passed with warnings. An additional explicit Biome check
  included all changed and untracked source files, since branch-diff selection
  alone omits newly created files.
- `npm run i18n:gen` and `npm run wiki:content` passed. Required non-Latin
  translations cover the new membership copy. Generated outputs are not edited
  manually.
- Item-art audit accepted eight distinct paintings. Item consistency, historical
  art ownership, inspect tooltip and localization regression suites passed.
- Final subscription, resume and inspection follow-up:
  `npx vitest run tests/store_subscription.test.ts tests/subscription_contract.test.ts tests/subscription_sdk.test.ts tests/resume_play.test.ts tests/inspect_instances.test.ts tests/companion_read_api.test.ts --maxWorkers=2`:
  six files, 92 tests passed. Canceled subscribers can start checkout again even
  when a billing-portal link is also available. Type checks and client build were
  repeated successfully after this change.
- Final bank, item catalog and shared-client-fixture follow-up:
  `npx vitest run tests/membership_bank_db.test.ts tests/membership_item_tooltip.test.ts tests/account_bank_window.test.ts tests/item_catalog_positional.test.ts tests/bare_client_defaults.test.ts tests/account_bank_wire.test.ts tests/snapshots.test.ts --maxWorkers=2`:
  seven files, 306 tests passed. The shared fixture now mirrors the new bank field;
  the positional catalog guard explicitly pins the eight new named items.
- `npx vitest run tests/bag_filter.test.ts tests/material_taxonomy.test.ts --maxWorkers=2`:
  two files, 71 tests passed after registering the non-vendor membership token in
  the exact item-category inventories. The taxonomy guard now uses the native
  path separator for its existing recursive-scan assertions.

## Durability and scale

The focused command, run in PowerShell with a disposable `TEST_DATABASE_URL`, was:

```powershell
$membershipTests = @(rg --files tests -g '*membership*.test.ts')
npx vitest run @membershipTests tests/subscription_sdk.test.ts tests/store_subscription.test.ts tests/server/characters.test.ts tests/server/ws_auth.test.ts tests/character_db.test.ts tests/player_identity_wire.test.ts tests/snapshots.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts tests/i18n_completeness.test.ts tests/world_api_parity.test.ts tests/command_schema.test.ts tests/command_facets.test.ts tests/legendary_regalia.test.ts tests/discord_db.test.ts tests/inspect_equipment.test.ts tests/inspect_window.test.ts --maxWorkers=2
```

The real PostgreSQL suites cover concurrent additive redemption, atomic rollback,
ownership and live lease fences, two-character bank transfers with audit effects,
paid-receipt deduplication, and COMMIT-success/lost-reply recovery. A held account
lock exercises the two-second lock timeout, verifies no partial writes, and then
proves the pool and transfer path remain usable.

A simulated 5,000-account realm with five-second batch latency maintains
continuous authorization across repeated refreshes, with at most four concurrent
250-account requests. Stable renewals are checked against a 10,000-row bank that
throws on traversal. Transfer reconciliation has a 1,000-row linear-work pin.

Local warm-Node diagnostic timings, collected alongside the full test run
([raw measurements](membership-performance.json)):

| Operation | Mean | Maximum |
| --- | ---: | ---: |
| Bank projection and JSON, 1,000 rows | 0.358 ms | 0.896 ms |
| Inventory reconciliation, 1,000 rows | 2.584 ms | 5.280 ms |
| Unchanged membership renewal, 10,000 bank rows | 0.000177 ms | 0.0131 ms |

These measurements are not production latency guarantees. Database/persistence,
security and server hot-path reviews found no remaining actionable local defects.

## Remaining release conditions

`npm run gate` was attempted and stopped at generated-i18n freshness because its
check compares the working files with the Git index. Verification was performed
before staging or committing changes. The individual remaining checks were run separately; this is
not recorded as a successful full gate.

The broad `npx vitest run --maxWorkers=4` run was interrupted when its execution
session ended, without a final summary. Its local `membership-full-tests.log`
contains observed failures and incomplete suites. Membership-related fixture and
source-pin failures were repaired and rerun in the focused checks above. Other
failures remain untriaged. A seven-file adjacent-system run passed 329 tests but
failed six: two token inventory pins (now repaired), the taxonomy path assertion
(now repaired), a separate farming test's Windows path assertion, a portrait test
requiring unavailable `grep`, and a subprocess test unable to create a Windows
symlink (`EPERM`). Guild-bank and vault-window suites passed in that run.
This is not a passing full-suite result. The full gate must pass on the final
staged change before merge. QA verdict: **NOT READY for merge or activation**.

The companion implementation is now present in
`levy-street/woc-daily-rewards-service`, locally on `codex/membership-billing`
based on master `d5e3bcfda6c95f640e19dd05e52fd4727354fcfe`. It implements recurring
checkout/portal, bounded subscription batches, token checkout/settled receipts,
signed webhooks and durable audited recovery. Its extended `npm test` passed all
738 tests, including real PostgreSQL integration with no skips.
Database-performance, security and server-hot-path
reviews passed. See that repository's `service/docs/MEMBERSHIP_VERIFICATION.md`.

Both implementations still require deployment with flags off, Stripe test-mode
configuration and actual payment/renewal/refund/webhook/return-flow verification
before activation. No live payment or remote deployment was performed. The user
subsequently authorized committing, pushing and posting the implementation summary
to PR #4281, with a companion payment-service PR.

The disposable PostgreSQL process was stopped after testing. Automatic approval
review rejected deletion of its temporary files with `blocked by policy`; the
ignored `tmp/membership-pg` and `tmp/membership-economy-pgdata` directories remain
available for manual cleanup.
