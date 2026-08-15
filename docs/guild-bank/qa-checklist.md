# Guild Bank: whole-feature QA matrix

Run once at packet completion (Phase 4 QA), on top of the per-phase QA passes.

- **Three-host parity**: offline `Sim` treats every guild bank surface as a clean no-op
  (no crash, no tab); online `ClientWorld` mirrors the sim behavior; headless env
  unaffected; `tests/world_api_parity.test.ts` and the parity trace green.
- **Determinism**: all sim logic through `Rng`/tick time; same-seed tests pass;
  `tests/architecture.test.ts` green.
- **Server authority**: every price from the sim's table, never the packet; shape-only
  dispatch checks; a modified client cannot deposit/withdraw as a member, from range, or
  while dead (negative tests exist for each).
- **Dupe safety**: deposit/withdraw persist character + book in one fenced transaction;
  kill-the-process crash shapes covered by tests; ledger reconciles via
  `scripts/bank_audit.mjs` on a scripted session.
- **Economy**: creation fee and expansion purchases destroy copper (ledger `copper_delta`
  agrees); treasury cap refuses, never truncates; no path mints copper.
- **Persistence**: guilds and characters saved before this feature load unchanged; a guild
  with no `guild_banks` row gets an empty bank; unknown item ids survive load dormant.
- **i18n**: S3 guard green; every UI string an English catalog key; money through the
  right `formatMoney` on each side; no overlay edits beyond the sanctioned M16 fills.
- **UI/mobile**: Guild tab correct on a phone viewport; tap targets comfortable; no
  hover-only information; graphics-settings fairness untouched.
- **Performance**: snapshot field is proximity + rank gated and delta-guarded
  (`tests/bandwidth.test.ts`); no per-tick allocation in the new sim paths; boot load is
  one query per realm.
- **Copy**: no em dashes, en dashes, or emojis anywhere in the diff.
- **Gate**: `npm run gate` green; PR per `.github/PULL_REQUEST_TEMPLATE.md` with
  screenshots; branch rebased over the release branch after PR A merged.
