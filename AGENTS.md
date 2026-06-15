# AGENTS.md — World of Claudecraft

Codex reads this file each turn. The repo also has per-area `CLAUDE.md` files
(`src/`, `src/sim/`, `src/sim/content/`, `src/ui/`, `server/`, `scripts/`, …) with
the deeper conventions — **open and follow the relevant one when you work in an area.**
Root invariants you must keep (summarized; see `CLAUDE.md`): `src/sim/` is DOM-free and
deterministic (randomness only via `Rng` — never `Math.random`/`Date.now`/`performance.now`
in sim logic); gameplay math follows real vanilla-WoW formulas; presentation talks only to
`IWorld` (`src/world_api.ts`), never to `Sim`/`ClientWorld` directly; i18n keys go into `en`
first then every locale in `src/ui/i18n.ts`; never hand-edit generated files; never enable
dev commands in committed prod code; never commit `.env`/secrets.

---

## QA Autoloop — context for the QA goal

You are running an autonomous QA loop (Codex Goal mode). Capture the live build's
behavior **once**, then fix and re-verify **entirely locally** until the goal's success
criteria are met. Keep a ledger at `tmp/qa-loop/LEDGER.md` (per-iteration verdicts +
fixes applied) and write the verification artifact `tmp/qa-loop/REPORT.md`.

**This release:** `<deployed>` = `release/v0.6`, `<base>` = `main`. The change set is
`main..release/v0.6` (~40 commits). Confirm the deployed ref still matches prod with
`ssh idyllic-games-prod 'sudo git -C /opt/eastbrook rev-parse --abbrev-ref HEAD'`.

### Environments
- PROD — use ONCE for the baseline, then never again (the prod deploy is a human step):
  https://dev.worldofclaudecraft.com (host idyllic-games-prod; runs the ref at
  /opt/eastbrook; dev cheats OFF).
- LOCAL — the fix loop (assume already running; (re)start as needed):
  - Client http://localhost:5173 (vite; HMR; proxies /api,/admin/api,/ws → :8787).
  - Server http://localhost:8787 (authoritative REST+WS+world; also serves built client).
  - Postgres 127.0.0.1:5433 (postgres://eastbrook:<pw>@127.0.0.1:5433/eastbrook).
  - Which process picks up a fix:
    - Client/UI/render/input (src/ui, src/render, src/game, index.html) → vite :5173
      hot-reloads; just reload the page. (Best target for UI tests like talents.)
    - Server/sim/content/net (server/, src/sim, src/sim/content, src/net,
      src/world_api.ts) → the server runs its OWN esbuild bundle; restart
      `npm run server` (re-bundles on start) before re-testing online play.
  - Easy high-level state (LOCAL ONLY): run `ALLOW_DEV_COMMANDS=1 npm run server`, then
    WS dev commands: {t:'cmd',cmd:'dev_level',level:N} / {cmd:'dev_teleport',x,z} /
    {cmd:'dev_give',item,count}. Or seed `characters.state` JSONB via psql on :5433.

### Parallelism — two layers
1. **Test-matrix parallelism (Codex subagents):** spawn an `explorer` to map the
   `main..release/v0.6` change set, then one `worker` per slice (a feature / PR /
   regression group) to test + fix + re-verify concurrently — cap = `[agents]
   max_threads` in ~/.codex/config.toml (default 6). For a structured batch, represent
   the matrix as a CSV (one row per scenario) and fan out with `spawn_agents_on_csv`
   (instruction templated on `{scenario}`; each worker calls `report_agent_job_result`
   once → merged results CSV → REPORT.md).
2. **In-world client parallelism (a driver script):** any scenario needing 2+ players in
   the world at once (trade/duel/party/combat-visibility/raids) is run by a small
   concurrent driver the owning worker invokes — reuse puppeteer-core + the
   `window.__game` hook (UI/DOM) and raw `ws`+`fetch` bots (scale); see
   scripts/mp_integration.mjs and scripts/crypt_raid.mjs. Drivers can be ad-hoc/throwaway
   — no committed harness is required.

Each subagent/driver: creates its own namespaced accounts/characters; targets LOCAL by
default (GAME_URL=http://localhost:5173, SERVER_URL=http://localhost:8787), PROD only for
the one baseline; records per-scenario PASS/FAIL + evidence into tmp/qa-loop/REPORT.md.

### Accounts / auth (same shape local + prod; base URL differs)
- POST <base>/api/register {username,password} → {token}  (user 3–24 [A-Za-z0-9_], pw ≥6; 409 if taken)
- POST <base>/api/characters (Authorization: Bearer <token>) {name,class} → {id}
  - name `^[A-Za-z][A-Za-z' -]{1,15}$` (LETTERS ONLY, no digits), unique per realm.
  - class ∈ warrior|paladin|hunter|rogue|priest|shaman|mage|warlock|druid; ≤10/account.
- WS: open <ws-base>/ws; first frame {t:'auth',token,character:<id>} → {t:'hello',pid};
  then {t:'snap',self,ents}/{t:'events',list}; send {t:'input',mi,facing} ~20Hz and {t:'cmd',...}.
  LOCAL <base>=http://localhost:8787 (ws://…); PROD <base>=https://dev.worldofclaudecraft.com (wss://…).
- Rate limit 20/min/IP on register+login — stagger ~1 per 1–2s; locally prefer dev
  commands / DB seeding over mass registration. Namespace users `qa_<rununix>_<n>`, chars
  `Qa<Role><N>` (letters only). Clean all `qa_*` data up at the end (DELETE /api/characters/{id} or DB).

### Observability (for assertions)
- `window.__game = {world, hud, online, renderer, input, sim}` (set in src/main.ts):
  world.player.{hp,level,pos}, world.entities (Map), hud state, online.cmd(...).
- DOM HUD is plain DOM; real selectors (talents window `#talents-window`, tree
  `.tal-tree`, node `.tal-node`). Screenshot every pass/fail. A thrown browser console
  error during a core flow is a FAIL.
- Raw-WS: assert on the `events` stream + merged self/ents snapshots.
- REST: GET <base>/api/status, /api/leaderboard, /api/characters.

### The change set & three test modes
Enumerate units: `git log --oneline main..release/v0.6` + `git diff --stat` (PRs land as
commits like `bundle(#223): … [qol]`, `feat(...)`, `fix(...)`). For each, map changed
files → game system → an observable in-game scenario (use docs/prd/, docs/design/, area
CLAUDE.md). Always include the baseline REGRESSION set: login, character creation, enter
world, movement, target+autoattack+cast, loot, quest accept/turn-in, chat
(say/yell/whisper/party), party invite, trade, duel, market browse/sell/buy, talents.
- NEW-FEATURE: drive the feature end-to-end; assert the new behavior per docs/prd.
- BUG-FIX: reconstruct the original broken condition; confirm it's fixed, not over-corrected.
- REGRESSION: anything that used to work and now doesn't.

### Fix rules
Follow the root invariants above. Add/update a vitest in `tests/` for each bug. Run
`npm test` (focused while iterating: `npx vitest run tests/<file>`); don't proceed past a
red suite. Commit each fix to `release/v0.6` with Conventional Commits + scope
(e.g. `fix(net): …`). Do NOT `git push` or deploy inside the loop.

### KNOWN ISSUE — talent modal
Blank for 8 of 9 classes BY DESIGN: `src/sim/content/talents.ts` registers only `warrior`
in `TALENTS`, so `talentsFor(non-warrior)` → null and `renderTalents()`
(src/ui/hud.ts ~2790) shows a title + "—". Content gap, not a render bug. Verify:
warrior → `#talents-window .tal-tree .tal-node` count > 0 (if a WARRIOR's modal is blank,
that IS a real bug → fix it). The other 8 → do NOT auto-author the trees; instead make
the modal degrade gracefully (clear per-class "Talents coming soon" placeholder) and log
full tree authoring as a human follow-up in REPORT.md.

### Reporting & prod handoff
Per iteration: update LEDGER.md. At convergence: REPORT.md = a prod-baseline-vs-local
comparison + per-scenario {id, mode, system, accounts, steps, expected/actual, verdict,
evidence} + fixes-with-shas + prioritized human follow-ups. End with one line: "CONVERGED
— all in-scope green locally on <commit>" or "STOPPED — <reason>".
**Prod deploy is HUMAN-GATED — do NOT do it.** Write the plan into REPORT.md for a human:
`git push origin release/v0.6`, then from ~/Documents/levy-street/ansible-scripts:
`ansible-playbook playbooks/setup_server.yml -e target_host=idyllic-games-prod -e eastbrook_branch=release/v0.6`.
Note: that playbook ends `failed=1` at a certbot dry-run UNRELATED to the game — not a
failed deploy; verify via /opt/eastbrook HEAD + `curl localhost:8787/api/status` ({"ok":true}),
not the ansible exit code.

### Guardrails
PROD: namespaced `qa_*` accounts, clean up, respect rate limits, never ALLOW_DEV_COMMANDS,
never touch non-qa DB rows, don't grief real players. LOCAL: dev commands fine. Never
force-push / rewrite history / commit secrets. Stop and ask before: a substantial new
feature, a destructive/non-qa DB write, an infra/ansible change, deploying to prod, or a
product/UX call.
