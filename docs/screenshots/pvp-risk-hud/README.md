# PvP risk HUD verification

The previews use the shipped HTML and CSS in a stationary browser fixture, with
placeholder portrait and minimap pixels. They demonstrate the HUD treatment, not
a running world. `safe-*` and `risk-*` compare the inactive and active states;
`reduced-motion-*` and `forced-colors-*` show the accessibility variants.

The implementation is based on `origin/release/v0.45.0`, on branch
`codex/pvp-risk-hud`. The existing unit-frame painter receives the pure
`playerPvpRisk` decision and writes both surfaces through the shared writer facet.
No simulation, networking, database, or dependency behavior changed.

Commands and results:

- `pnpm exec vitest run tests/pvp_risk_core.test.ts tests/unit_frame.test.ts tests/unit_frame_painter.test.ts --maxWorkers=1`: passed, 78 tests.
- `pnpm exec vitest run --config vitest.browser.config.ts tests/browser/pvp_risk.browser.test.ts`: passed, 3 tests covering both entry documents and desktop, landscape phone, and portrait phone at the low effect tier.
- `pnpm exec tsc --noEmit`: passed on the final regenerated artifacts.
- `npm run build`: passed, including production client bundles, backdrop-filter checks, and hashed media emission.
- `pnpm exec biome check src/ui/pvp_risk_core.ts src/ui/unit_frame.ts src/ui/unit_frame_painter.ts src/ui/hud.ts src/styles/hud.css tests/pvp_risk_core.test.ts tests/unit_frame.test.ts tests/architecture.test.ts tests/browser/pvp_risk.browser.test.ts`: passed with warnings.
- `npm run ci:changed`: exited successfully but selected no files on the uncommitted branch; the explicit Biome command above covered the changed sources.
- `npm run security:gate`: passed, zero high-severity findings after existing priors.
- `pnpm exec vitest run tests/architecture.test.ts --maxWorkers=1 --testTimeout=120000`: passed, 112 tests. This diagnostic used a longer timeout because the earlier default-timeout run hit three source-scan timeouts.
- `pnpm exec vitest run tests/affliction.test.ts -t 'spends the full pool with Sentence and scales its damage' --maxWorkers=1`: passed in isolation with the default timeout.
- `node scripts/gate_select.mjs`: did not pass. The unchanged Affliction test exceeded its 20-second limit during the first floor batch. The remaining batch was stopped after that failure, so the later floor batches, full browser suite, server build, and headless build remain unverified.

The full gate is still required before merge. These focused results do not replace it.
