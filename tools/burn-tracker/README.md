# $WOC Burn Tracker

Single-file static page (`/burn.html`, sibling of `admin.html` and `guide.html`)
showing $WOC that has actually been destroyed on-chain by the ecosystem's burn
mechanics.

## Data sources

- **Total burned** is exact math, independent of any indexer: 1,000,000,000
  (fixed pump.fun mint, matches `WOC_MAX_SUPPLY` in `src/sim/holder_tier.ts`)
  minus the mint's live `getTokenSupply`.
- **USD value** uses the same fail-closed price chain as the economy service:
  Pyth Hermes v2 when `PYTH_WOC_USD_FEED_ID` is configured, otherwise the
  Jupiter price API for the pinned mint.
- **Burn ledger** parses `burn` / `burnChecked` instructions of the $WOC mint
  out of `getSignaturesForAddress` + `getTransaction (jsonParsed)`. The feed is
  labeled by scan coverage; the headline total never depends on it.

The page seeds from build-time snapshots (so it renders under a strict CSP with
no network) and upgrades to live data on hosts that allow fetches. Append
`#p.rpc=https://your-rpc` to use a private RPC; the default public endpoint
rate-limits history hydration.

## Build

```
node tools/burn-tracker/build.cjs
```

Fetches the live price, the live supply, scans recent mint history for burns
(budget via `BUILD_SCAN_TX`, default 120; private RPC via `BUILD_RPC_URL`),
stamps both snapshots into `burn_model.cjs`, and emits `/burn.html`. The build
fails if the price or supply fetch fails (`ALLOW_STALE_PRICE=1` /
`ALLOW_STALE_CHAIN=1` to ship the previous snapshot instead).

## Test

```
node tools/burn-tracker/test_burn_model.cjs
```

Zero-dependency suite: parser fixtures captured from real mainnet responses,
two live endpoint tests (Jupiter price, `getTokenSupply`), and a parity test
that asserts `burn.html` embeds `burn_model.cjs` byte-for-byte.

## Files

- `burn_model.cjs`: pure model (parsers, snapshots, mechanics provenance,
  formatters). Single source of truth; UMD, runs in node and the page.
- `page-template.html`: page shell; `build.cjs` injects the model at a marker.
- `build.cjs` / `test_burn_model.cjs`: build and test entry points.

The `ATTRIBUTION` map in `burn_model.cjs` (burn authority -> label) is empty on
purpose; fill it as mainnet keeper and treasury addresses become public so feed
rows name the mechanic that burned.
