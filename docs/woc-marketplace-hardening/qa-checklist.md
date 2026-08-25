# Whole-feature QA matrix (run once, in phase 22)

This is the packet-completion matrix, verified after all phases are DONE (QA PASS). Each
row needs recorded evidence (test file, command output, or screenshot path), not a claim.

## The review's acceptance bar (mirrors review.md; every box needs evidence)

- [ ] B1 to B7 closed with tests that fail on the old behavior
- [ ] Full bond cycle on devnet with a double-release balance assert (phase 21 record)
- [ ] Confirming settlements have a bounded resolution path (H15)
- [ ] Buy-now and directed rails both enforce the wallet-twin self-deal guard (H14)
- [ ] Listing step-up auth decision implemented or explicitly accepted (R1 ruling record)
- [ ] Dashboard cannot show 1000x-wrong balances; an overview outage does not hide listings
- [ ] Counsel-approved Terms plus PRD/marketing language (R6; may remain an external gate)
- [ ] Ops runbook for pause, force-release, unbooked claims, and stranded settling

## Game repo

- [ ] `node scripts/gate_select.mjs` green on the final tip (committed tree)
- [ ] Sim purity and determinism guards green (`tests/architecture.test.ts`); no sim
      token-firewall regression; no new `Rng` draws in marketplace paths
- [ ] IWorld parity pins current (`tests/world_api_parity.test.ts`, `tests/command_schema.test.ts`)
- [ ] Monolith ratchet green with the LOWERED hud.ts ceiling (phase 01)
- [ ] S3 localization guard green; every new player string is an English catalog key;
      zero hand-edited overlay files in the packet diff
- [ ] Real-SQL suites green against Postgres (phases 02 to 06, 17, 20)
- [ ] Marketplace hot GETs rate-limited and cache-backed (phase 16 evidence)
- [ ] Fresh desktop + mobile screenshots at lowest preset committed (phase 15)
- [ ] Beautify bar held (phase 15): DESIGN.md conformance, no silent truncation at
      stress lengths, all numbers/money/dates/times through the formatters, readable
      icons and images, and Fernando's sign-off on the screenshot set recorded

## Service repo

- [ ] `npm run build` + `npm test` green in `service/`
- [ ] Query-string admin bypass regression test green (B5)
- [ ] Releaser wired in production bootstrap; `release_not_wired` unreachable when
      configured (B3); crash-safe protocol tests green
- [ ] Verifier rejects burn-redirect and unexplained third-party credits (B4)
- [ ] Oracle heartbeat warms the priced instance (H3)

## Dashboard repo

- [ ] `npm test` + `npm run check` + `npm run build` green
- [ ] Game proxy role check enforced; non-privileged role exercised in a test (H1)
- [ ] Token decimals sourced from mint config; a 6-decimal figure renders correctly (H2)
- [ ] `npm audit` clean or every remaining advisory explicitly accepted by Fernando

## Cross-repo

- [ ] Wire fields complete end to end: fee split renders, signatureRequired flows (H8)
- [ ] Env vars documented in `.env.example`; health rail keys on real config (phase 12)
- [ ] Doc staleness cluster resolved; docs match shipped behavior (phase 07)
- [ ] No em dashes, en dashes, or emojis anywhere in the packet's diffs
- [ ] The word "phase" appears nowhere in code, comments, commit messages, or PR text
- [ ] Every CLAUDE.md a packet change made stale was updated (concise, anchor rule);
      spot-check the game server, hud, and sim files plus the service and dashboard
      top-level docs
