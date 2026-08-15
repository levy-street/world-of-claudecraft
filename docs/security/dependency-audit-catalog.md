<!-- docs/security/: security tooling reference. -->

# Dependency audit catalog

Reference for the dependency-vulnerability gate: `pnpm audit` over the installed
tree, run by `.github/workflows/audit.yml`. Sibling of the release malware gate
(`malware-scan-catalog.md`), and deliberately a different job: that one hunts
code deliberately planted in this tree, this one tracks published advisories
against code we pull in.

`package.json` (`pnpm.overrides`, `pnpm.auditConfig`) is the source of truth and
is pinned by `tests/dependency_audit_gate.test.ts`. This page explains the model
and records the accepted exceptions, so an entry can be reviewed or retired
without re-deriving the reasoning behind it.

## Why the gate is its own workflow, on scoped triggers

It fires on a pull request or push that actually changes `package.json` /
`pnpm-lock.yaml`, plus a weekly cron and manual dispatch.

Not on every PR, on purpose. An advisory published upstream is not caused by
whatever PR happens to be open when it lands, so a gate that reddens unrelated
work is a gate people learn to route around. Scoping it to dependency-changing
diffs puts the failure in front of the one author who can act on it; the weekly
cron is what catches a new advisory against an unchanged tree, on its own job
name, blocking nobody.

Not inside `ci.yml`, also on purpose. That workflow's job matrix is tuned around
`pull_request` / `push` / `workflow_dispatch`; adding a `schedule` trigger there
would newly fire `changes`, `lint`, and `browser-gate` on every cron tick.

The severity threshold stays at pnpm's default (`low`) rather than `high`.
That is only affordable because the overrides below bring the tree to zero
unignored advisories: from zero, any new advisory at any severity forces a
decision, instead of accumulating quietly under a threshold.

Two limits worth knowing, neither of which has a good fix today.

**The cron only sees the default branch.** GitHub runs a scheduled workflow
against the default branch, and here `main` trails the active `release/**`
integration base. So an advisory against a dependency that only exists on a
release branch is invisible to the weekly sweep until that release merges down;
until then it surfaces only through the path-triggered runs, when someone touches
the manifest. Widening this means either running the sweep against release refs
explicitly or accepting the lag; the lag is accepted for now because a
release-only dependency is, by definition, not in production yet.

**Never make this job a required status check.** The `pull_request` arm is
path-filtered, so on a PR that changes no dependency the job does not run at all,
and a required check that never reports leaves every such PR stuck on Expected.
The gate blocks by failing when it runs, not by being mandatory.

## Two levers, in this order

**1. `pnpm.overrides`.** Nearly every advisory here is against a transitive
package a direct dependency pulls in, where the fix is a patch or minor bump the
intermediate package has not picked up yet. Pin the fixed floor with a
version-scoped selector (`"undici@7": "^7.29.0"`), never a bare package name: a
bare selector rewrites every range of that package in the tree, including majors
the advisory never covered, which turns an override into an unreviewed
dependency bump. Prefer an override to bumping the direct dependency; it is a
far smaller change and keeps the direct dependency on the version its own
ecosystem tests against.

**2. `pnpm.auditConfig.ignoreGhsas`.** Only for an advisory with no fixed
version available, or one whose vulnerable code path this repo provably cannot
reach. Every entry needs a record in the register below, and the test fails if
one is added without it. pnpm still prints an ignored advisory in the report
(`1 high (1 ignored)`), so an exception stays visible in the job log rather than
swallowed.

`ignoreCves` is the same escape hatch keyed by CVE instead of GHSA. It is held
empty by the test, so exceptions cannot be split across two lists where only one
of them is reviewed.

## Accepted exceptions

### GHSA-3gc7-fjrx-p6mg: bigint-buffer buffer overflow in `toBigIntLE()`

**Severity** high (CVSS 7.5). **Path**
`@reown/appkit-adapter-solana > @solana/spl-token > @solana/buffer-layout-utils > bigint-buffer`.

**Unfixable upstream.** The advisory lists no patched version
(`patched_versions: <0.0.0`), and `@solana/buffer-layout-utils` still declares
`bigint-buffer@^1.1.5` at its latest release (0.3.0), so the wallet stack has
nothing to move to.

**Not reachable here.** The overflow is in the package's native C++ addon, on
the `converter.toBigInt` branch. The only consumer in this repo is
`src/net/wallet_connect.ts`, which loads the Solana stack in the browser through
a dynamic import. `bigint-buffer` declares a `browser` field remapping
`dist/node.js` to `dist/browser.js`, and the browser build never assigns
`converter`, so `toBigIntLE` always returns through the pure-JS path. Verified
against the built bundle: the emitted chunk contains no `bindings(` call and no
native loader.

**Retire this entry when** a patched `bigint-buffer` ships, or
`@solana/buffer-layout-utils` drops the dependency.

### GHSA-w5hq-g745-h8pq: uuid missing buffer bounds check in v3/v5/v6

**Severity** moderate. **Path**
`@reown/appkit-adapter-solana > @solana/web3.js > jayson > uuid` (uuid 8.3.2).

**Not reachable here.** The missing bounds check is only exercised when the
caller passes a `buf` argument to v3/v5/v6. The single consumer, `jayson`, calls
`uuid.v4()` with no arguments at all three of its call sites
(`lib/utils.js`, `lib/generateRequest.js`, `lib/client/browser/index.js`), so
the vulnerable branch is never entered.

**Not overridden** rather than ignored because `jayson` pins `uuid@^8.3.2` and
the patched floor is 11.1.1: forcing that selector across a major would be a
larger and riskier change than the advisory warrants, for a path that cannot
reach the defect.

**Retire this entry when** `jayson` (or `@solana/web3.js`) moves to uuid 11+.

## The re-mint chore any dependency change triggers

`pnpm-lock.yaml` is a fingerprinted source input of the Eastbrook and Fenbridge
asset pipelines, so a lockfile-only change invalidates their provenance seals and
reddens the asset suites. Use the size-preserving in-place re-mint
(`scripts/assets/remint_lockfile_fingerprints.mjs`, then
`eastbrook_grand_armoury/remint_polish_provenance.mjs`, then
`node scripts/build_media_manifest.mjs generate`) and re-pin the literals it
prints; see `scripts/assets/CLAUDE.md`. This is the real cost of a dependency
bump in this repo, and the reason to batch dependency updates deliberately
rather than take them as a drip.
