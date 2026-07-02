# $WOC Token Feature Boundaries

This note records the default boundaries for wallet, token, marketplace, and
other money-adjacent contributions to World of ClaudeCraft. It is a contributor
and reviewer guide, not a product promise or legal review.

The project already supports an opt-in, non-custodial Solana wallet link for
read-only balance display and cosmetic holder treatment. See
[`docs/prd/woc/wallet-link.md`](prd/woc/wallet-link.md) for the implemented
wallet-link scope.

## Default Product Boundaries

- Gameplay must remain fully available without connecting a wallet, holding a
  token, making a payment, or joining an external market.
- Wallet and token features are opt-in. They should fail closed when wallet
  providers, RPC endpoints, database tables, or required environment variables
  are absent.
- Token utility must not grant combat power by default. Cosmetic identity,
  vanity, access, community tooling, realm operation, and reviewable economy
  plumbing are acceptable scopes; power, rewards, wagers, or payouts require an
  explicit design and risk pass.
- The client must display server-authoritative wallet, balance, ownership, and
  reward state. It must not decide eligibility, transfer outcomes, or settlement
  results on its own.
- Native store builds may need token, donate, sponsor, or external-market CTAs
  hidden to pass review. Keep store-distribution concerns in scope before adding
  visible token promotion to shared UI.

## Technical Boundaries

- `src/sim/` stays deterministic. Do not import wallet SDKs, network clients,
  RPC calls, host clocks, database adapters, or on-chain code into the sim.
- Secrets, treasury keys, wallet private keys, board IDs, internal service URLs,
  and deployment credentials must not appear in source, docs, logs, screenshots,
  fixtures, PR descriptions, or issue comments.
- Money-adjacent services must include account authorization, idempotency or
  replay protection, and fail-closed configuration tests where applicable.
- Fork PR workflows must not require repository secrets. Feature work that needs
  protected keys should be reviewable with mocks, disabled adapters, or
  credential-gated integration tests.
- On-chain or payment code should separate pure encoders, server orchestration,
  UI display, and deployment configuration so each layer can be reviewed on its
  own.

## Review Gates

Any PR that introduces or materially changes wallet, token, marketplace, wager,
reward, payout, staking, custody, or paid-access behavior needs a risk section in
the PR description covering:

- whether the feature is cosmetic, operational, or financial;
- whether players can spend, stake, lock, lose, earn, withdraw, transfer, or
  sell anything;
- custody assumptions and which keys can move or settle assets;
- chargeback, age, jurisdiction, gambling, securities, money-transmission, and
  consumer-protection concerns when relevant;
- what remains disabled, mocked, devnet-only, unaudited, or blocked on policy
  sign-off.

If that risk section cannot be written clearly, split the PR until the safe
foundation is reviewable on its own.

## Communication Boundaries

- Avoid price speculation, investment language, return expectations, or claims
  that players can earn money unless the mechanics, limits, and legal review are
  concrete and documented.
- Do not describe devnet proofs, mock mints, unaudited programs, or disabled
  flows as production-ready.
- Be explicit when a feature is cosmetic-only, read-only, credential-gated,
  devnet-only, or not wired into the live game.
- Prefer plain release notes over hype. The project should be understandable and
  playable for people who ignore wallet features entirely.
