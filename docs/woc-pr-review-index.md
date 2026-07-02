# $WOC / WoC Pull Request Review Index

This guide turns the open tracker in issue #1157 into a maintainer-facing review
checklist for the large $WOC / World of ClaudeCraft pull request queue. It is a
snapshot, not a source of truth: always re-check the live PR list before merging.

## Review Principles

- Review stacked branches from the bottom up. A child branch can physically
  contain its parent's diff, so reviewing it first makes the change look larger
  and noisier than it really is.
- Treat stubs and RFCs as discussion artifacts, not merge-ready implementation.
- Prefer small, independently releasable foundations before UI, marketplace,
  or on-chain flows that depend on them.
- Keep flag-gated or credential-gated systems fail-closed until production
  secrets and policy sign-off exist.
- For money-adjacent work, review the technical diff and the product/risk model.
  Cosmetic sinks are different from player-to-player markets, wagers, or payouts.

## Stacked Chains

### Monetization Stack

Review and land in this order:

1. `#734` - $WOC rename and vanity names. This is the bottom of the stack and
   introduces the shared $WOC payment layer.
2. `#735` - SNS subdomains and tradeable characters. This builds on the payment
   layer from `#734`.
3. `#736` - character marketplace and buyback-burn. This is the largest and
   highest-risk branch in the chain.

Risk notes:

- `#736` should get a dedicated risk pass for money-transmission, securities,
  chargeback, custody, and market-manipulation concerns.
- Consider splitting `#736` if the code review surface is too large for one PR.
- Do not review `#735` or `#736` as standalone branches unless their parent
  branch is already settled.

### Skins And Marketplace

Review and land in this order:

1. `#897` - creator skin upload foundation. This is schema and decision logic.
2. `#937` - NFT profile-picture skins. This extends the upload foundation.

Adjacent work:

- `#739` - creator skins marketplace.
- `#474` - transmog skin marketplace stub.

Risk notes:

- Hosted or IPFS-backed upload flows remain blocked until the required pinning
  credentials and review workflow are configured.
- NFT and wallet-linking features should stay server-authoritative and
  continuously re-verified rather than trusting client state.

### Mounts And Player Economy

Review and land in this order:

1. `#924` - holder travel mounts, flight, courses, charters, and wager-race
   substrate.
2. `#923` - player tips and paid-bodyguard escrow, stacked on the mounts branch.

Risk notes:

- Separate travel and cosmetic holder benefits from real-money wager mechanics.
- Keep wager legs disabled unless policy and deployment sign-off are explicit.

### GameFi Economy

`#799` is the implementation branch for the GameFi economy core. It supersedes
the older roadmap stubs:

- `#478` - arena GambleFi.
- `#479` - arena championship.
- `#480` - seasonal leaderboard rewards.

Review notes:

- Check that emissions cannot exceed inflows.
- Review on-chain escrow assumptions separately from UI and leaderboard display.
- If `#799` lands, the superseded stubs can usually close with a pointer to it.

### Realms

Review foundation before customization:

1. `#475` - stake to provision a realm.
2. `#476` - realm customization stub.
3. `#477` - realm revenue share stub.

Related planning:

- `#977` - per-realm SPL Token-2022 launchpad plan.

Review notes:

- Keep realm creation, customization, and revenue sharing separate unless the
  base registry and ownership model are already stable.
- Treat launchpad work as design until anti-rug, moderation, and custody rules
  are explicit.

## Cross-Cutting Checks

### Security And Privacy

- No secrets, board IDs, treasury keys, wallet keys, or private service URLs in
  code, docs, logs, screenshots, or PR comments.
- New services must fail closed when required environment variables are absent.
- Fork PR workflows must not expose repository secrets to untrusted code.
- Any server endpoint that changes money, identity, ownership, or permissions
  needs account authorization tests and replay/idempotency coverage.

### Sim And Game Integrity

- `src/sim/` must remain deterministic: no wallet SDKs, network calls,
  non-deterministic clocks, or host-only services inside the sim.
- Money, market, and identity flows should not grant combat power unless that is
  an explicit and reviewed design decision.
- Client UI must display server-authoritative state rather than deciding
  ownership, balances, rewards, or transfer outcomes.

### Review Labeling

Use these buckets when triaging the queue:

- **Ready foundation**: small base layer with tests and no unresolved policy
  blocker.
- **Stack child**: depends on another open PR and should wait for its parent.
- **Stub/RFC**: useful for discussion, not ready to merge as implementation.
- **Credential gated**: technically reviewable, but blocked from production until
  secrets or external services are configured.
- **Risk pass required**: needs policy, legal, or economy review in addition to
  code review.

## Maintenance

When updating the tracker:

1. Re-fetch the open PR list and confirm each branch's target base.
2. Re-check which branches are stacked by comparing merge bases, not just PR
   titles.
3. Move merged foundations out of the dependency queue and update their children.
4. Keep PR numbers in this document as review landmarks, but prefer live GitHub
   state when there is a conflict.
