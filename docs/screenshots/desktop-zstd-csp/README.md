# Desktop zstd CSP hang: before/after evidence

Both captures drive real offline world entry (`scripts/enter_offline_game.mjs`) through a
headless Chromium with the Electron shell's real `Content-Security-Policy` header attached
to the document response (the same interception technique
`scripts/csp_shell_smoke.mjs` uses), waited on for the same duration (up to 120s boot poll
plus a 4s settle), on the same machine, same build, same seed.

- `before.png`: `connect-src` missing `data:` (the pre-fix policy). Loading stalls at
  `5/100` for the full wait: every shipped Zstandard-supercompressed KTX2 GLB throws
  "Refused to connect" when `KTX2Loader`'s `ZSTDDecoder` tries to boot its WASM via
  `fetch("data:application/wasm;base64,...")`, so nothing after the first zstd texture
  ever loads.
- `after.png`: `connect-src` includes `data:` (this PR). The same wait reaches `85/100`
  with zero first-party CSP violations and zero page errors.

The deterministic, CI-enforced proof is the unit-level contract test
(`tests/gltf_decoder_csp.test.ts`, `tests/electron_shell_guards.test.ts`): it welds
`buildContentSecurityPolicy` to the vendored three.js decoder sources so a future CSP edit
or three.js upgrade that drops `data:` from `connect-src` fails in every `vitest run`
instead of only in a packaged desktop build.
