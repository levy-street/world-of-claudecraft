# Referral armour verification

Scope: referral armour changes after PR #4281 commit `e099911494`.
See [behavior and storage](membership-referral-armour.md).

## Results

- Focused simulation, server admission, tooltip, authority, storage-size,
  architecture and localization guards: 18 files passed, 436 tests passed,
  three existing skips.
- Expanded localization coverage: 57 passed, three existing release-tier skips.
- Disposable PostgreSQL 16 referral migration/concurrency/planner suite: seven
  passed, no skips. The storage/join companion group also passed all 12 tests.
- Browser component checks: five passed across desktop, portrait and landscape.
  The screenshots combine the shipping claim pane and tooltip text in a harness;
  they are not a complete multiplayer signup/session capture.
- Item icon/provenance/catalog checks: 43 passed. Seven separately generated
  paintings reviewed at master size, shipping size, small sizes, grayscale and
  circular crop. The item-ID inventory change is additions-only.
- Types, environment/server/bot/client builds: seven Turbo tasks passed.
- Changed-file Biome and diff whitespace checks passed. Existing lint warnings
  remain warnings.

Commands used:

```powershell
npx --no-install vitest run tests/referral_armour.test.ts tests/referral_item_tooltip.test.ts tests/membership_armour.test.ts tests/membership_item_tooltip.test.ts tests/player_identity_wire.test.ts tests/account_bank_window.test.ts tests/player_card_server.test.ts tests/player_card_db.test.ts tests/server/auth.register.test.ts tests/server/ws_auth.test.ts tests/server/account_player_join.test.ts tests/server/referral_armour_db.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts tests/i18n_completeness.test.ts tests/localization_fixes.test.ts tests/item_catalog_positional.test.ts tests/professions_blob_growth.test.ts --maxWorkers=2
npx --no-install vitest run tests/localization_coverage.test.ts --maxWorkers=2
# TEST_DATABASE_URL targets a disposable local PostgreSQL 16 database.
npx --no-install vitest run tests/server/referral_armour_pg_integration.test.ts --maxWorkers=2
npx --no-install vitest run --config vitest.browser.config.ts tests/browser/referral_armour.browser.test.ts tests/browser/membership_bank.browser.test.ts
npx --no-install turbo run check:types build:env build:server build:bot build:bundle
npm run ci:changed
git diff --check
```

The parent ran `npm run gate` with `GATE_MAX_WORKERS=2`, an 8 GiB Node heap,
and the disposable PostgreSQL URL. Generation/freshness, SFX, malware and
changed-file formatting stages passed. The full test stage found three
feature-related guard failures (bank coordinator size, maximal discovery-list
bytes and the new inviter interpolation fixture); each was corrected and its
complete affected suite passed in the focused results above.

The full run also failed the unchanged `woc_market_bond_pg_integration.test.ts`
case `an idle-stalled guard transaction surfaces as contended, never a raw 500`
with `Connection terminated unexpectedly`. It reproduced independently with:

```powershell
npx --no-install vitest run tests/woc_market_bond_pg_integration.test.ts -t 'an idle-stalled guard transaction' --maxWorkers=1
```

The failing test and `server/woc_market_db.ts` are unchanged by this contribution.
The already-failed full run was stopped; no successful complete repository gate
is claimed. Verdict: feature checks pass, complete pre-merge gate remains blocked.

## Bounded work evidence

PostgreSQL normal-planner checks used over 10,000 rows: referee lookup used its
primary key, returned one row and touched fewer than ten shared blocks; card
lookup used the slug index followed by the character primary key, returned one
row and touched fewer than twelve shared blocks. Migration replay, old-writer
defaults and first-writer conflict behavior passed.

A local 250,000-iteration probe used 1,010 players and a ten-member party. The
inviter-last and inviter-absent cases each read nine other player entries and
took about 0.67 microseconds per call. Identity encoding plus JSON serialization
measured about 0.055 microseconds before and 0.071 after the display-name field.
This is a leaf benchmark, not a complete broadcast measurement. Code inspection
confirms no SQL in the XP or identity paths.

Read-only reviews covered account authority and simulation boundaries, database
cost and compatibility, server recurring-work bounds, frontend behavior and
regression coverage. The stale-bank-after-expiry finding and two test precision
findings were fixed and re-reviewed. Live signup through deployed billing and
the complete multiplayer flow remain deployment verification.
