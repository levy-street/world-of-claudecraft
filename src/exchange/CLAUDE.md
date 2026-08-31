# Standalone Exchange SPA

- This directory is a same-origin browser SPA. Do not import the world mirror, renderer, HUD, live bags, or game entrypoint.
- New listing creation, wallet step-up, and directed offers are out of scope. Keep those operations in the browser game.
- Reuse the existing market SDK and server-built wallet quotes. Never derive a transaction, recipient, token amount, or memo here.
- Render untrusted values with DOM text APIs. All player-visible prose uses existing i18n keys.
- Keep network orchestration out of DOM rendering where practical. Suppress stale UI work, but always record a wallet-broadcast payment signature with the existing confirm API first.
