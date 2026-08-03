# Task cache (Turborepo) for the local gate

Phase 8 of the local gate performance packet. Pure artifact steps skip work when
their declared inputs are unchanged. Tests never use a "passed" cache.

## Tool choice: turbo (not wireit)

| Option | Why chosen / not |
|---|---|
| **turbo** (kept) | Precise `inputs` / `outputs` per task, local disk cache, one CLI multi-task run for independent pure steps (`check:types` // `build:env` // `build:server`), Windows-safe via `npx turbo` + gate `shell` on win32. Future remote cache is optional and not required. |
| wireit | Lighter per-script incremental, but would rewrite many `package.json` scripts to `"wireit"` with a large config block and weaker multi-task parallel UX for the gate orchestrator. Dropped for this phase. |

Config: root `turbo.json`. Cache dir: `.turbo/` (gitignored). Install: `turbo` is a
devDependency (pnpm).

## Cacheable vs always-run

### Cacheable (turbo tasks)

| Task | Inputs (summary) | Outputs |
|---|---|---|
| `i18n:gen` | `src/ui/i18n.catalog/**`, locales, admin en/locales, `scripts/i18n_*.mjs` | resolved tables, `translation_keys.generated.ts`, status JSON |
| `wiki:content` | `src/sim/**`, deed/visual inputs, `scripts/wiki/**` | `src/guide/content.generated.ts` |
| `sfx:check` | `public/audio/sfx/**`, `scripts/sfx/**` | (pass/fail only) |
| `check:types` | `src/**`, `server/**`, `headless/**`, `tests/**`, tsconfigs | `node_modules/.cache/tsc/**` |
| `build:env` | `headless/**`, `src/sim/**` | `dist-env/**` |
| `build:server` | `server/**`, `src/**`, build script | `dist-server/**` |
| `build:bundle` | `src/**`, `public/**`, HTML entries, vite + manifest scripts | `dist/**` |

Inventory is also exported from `scripts/lib/gate_task_cache.mjs` and pinned by
`tests/gate_task_cache.test.ts` against `turbo.json`.

### Never cached as "green forever"

| Step | How gate runs it | Why |
|---|---|---|
| Full vitest | `npm test` (not turbo) | Source/test changes must re-run the suite |
| Browser regressions | `npm run test:browser` | Same |
| Malware scan | `npm run security:gate` | Cheap enough; always-run security bar |
| Biome changed files | `npm run ci:changed` | Depends on git changed set, not file hash alone |
| i18n freshness | `git diff --exit-code` on artifacts | Cache restore cannot hide committed drift |

`turbo.json` also sets `"cache": false` on `test`, `test:browser`, `security:gate`,
and `ci:changed` so an accidental `turbo run test` never stores a pass.

## How `pnpm run gate` uses it

`scripts/gate.mjs` builds steps from `scripts/lib/gate_steps.mjs`:

1. Preflights: dependency sync, ffmpeg/ffprobe (unchanged).
2. `npx turbo run i18n:gen` then **always** i18n freshness `git diff`.
3. `npx turbo run wiki:content`.
4. Malware + biome via npm (always).
5. `npx turbo run sfx:check`.
6. Full vitest with `WOC_SKIP_PRETEST=1` (Phase 2 generate-once; not turbo-cached).
7. Browser suite via npm.
8. `npx turbo run check:types build:env build:server` (parallel when independent).
9. `npx turbo run build:bundle`.

Phase 2 rules still hold: standalone `pnpm test` / `pnpm run build` regenerate i18n
and wiki; the gate does not triple-generate.

## Warm re-run evidence

On an unchanged tree, pure artifact multi-task:

```text
npx turbo run i18n:gen wiki:content sfx:check check:types build:env build:server build:bundle
# second run: Cached: 7 cached, 7 total  Time: ~87ms >>> FULL TURBO
```

A catalog edit (any file under `src/ui/i18n.catalog/**`) forces `i18n:gen` cache miss.

## Contributor notes

- Clear local cache: `rm -rf .turbo` (or `npx turbo run <task> --force`).
- Cache hits print in the gate log (`cache hit, replaying logs` / `FULL TURBO`).
- Windows: gate still sets `shell = true` for `npx`/`npm`; turbo binary is cross-platform.
- Do not add vitest to a cacheable turbo task. If a new pure step is added, declare
  precise `inputs`/`outputs` in `turbo.json` and extend `GATE_CACHE_TASK_INVENTORY`.
