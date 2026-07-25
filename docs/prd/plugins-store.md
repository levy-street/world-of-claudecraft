# Plugin Store: community client-side mods

Status: shipped with v0.29.0 (feature/plugins-store).

## What it is

A browser-extension-style store for client-side mods, inside the game. Anyone
can write a plugin against a small public API (`woc`), submit it from the
in-game Develop tab, and, once a human operator approves it, every player can
install it from the store and have it running instantly. Nothing in this loop
redeploys the app: submissions, approvals, installs, updates, and the
moderation kill switch are all data served at runtime.

Plugins are read-and-render only. They observe the event stream the HUD
already renders and draw their own overlay panels; there is deliberately no
API member that sends a game command, so the server-authority invariant is
untouched (a plugin can never fight, loot, trade, or move for you).

## Lifecycle

1. An author submits metadata + JavaScript source from the Develop tab
   (`POST /api/plugins`, or `POST /api/plugins/:id/versions` for an update).
   The server validates shape and size, parses the source (parse only, never
   executed server-side), runs the static pre-screen, and stores the version
   as `pending`.
2. An operator with `content.moderate` reviews the queue in the admin
   dashboard (Plugins page): full source, proposed metadata, author notes,
   and the pre-screen flags. Approve makes that exact version live (and
   applies its metadata); reject records a note the author sees in-game.
3. Players browse `GET /api/plugins` (cached, viewer-identical) and install.
   The client refetches `GET /api/plugins/installed` (which carries approved
   sources) and the runtime host starts the plugin immediately.
4. An approved update becomes the live version on approval; clients pick it
   up on their next installed-list fetch (login or store interaction) and the
   host hot-swaps the running instance.
5. Moderation: delist is the kill switch. A delisted plugin leaves the
   catalog (cache busted immediately) and drops out of every player's
   installed payload, so it stops loading everywhere without a deploy.
   Relist restores it deliberately.

Plugin status: `pending` (never listed) / `listed` / `delisted`. Version
status: `pending` / `approved` / `rejected`; the live version is the highest
approved one.

## Threat model (read this before touching the review flow)

Approved plugin source executes with page privileges on OTHER players'
clients. There is no browser sandbox in front of it (the repo ships no CSP),
and the `woc` API is containment for honest mistakes, not a security
boundary. The security boundary is the human review:

- Nothing a client submits is ever served to another player until an operator
  approves that exact version. Updates re-enter review; the previously
  approved version stays live meanwhile.
- The pre-screen (`server/plugin_screen.ts`) is a high-recall reading guide
  for reviewers (dynamic code, network egress, browser storage, global DOM,
  credential text, obfuscation), NOT a gate. An empty flag list means
  "nothing to jump to", never "safe". Review the whole source; it is capped
  at 128 KiB precisely so that stays feasible.
- Review guidance: reject network egress and global DOM/storage access unless
  the notes justify them convincingly; reject anything obfuscated outright
  (honest mods have nothing to hide); treat credential-shaped strings as
  disqualifying.
- The kill switch (delist) is the incident response: it propagates within the
  catalog TTL (30 s) for the store and on next fetch for running clients.
- First-party seeds must screen clean (`tests/seed_plugins.test.ts` pins it),
  so the flag list stays meaningful.

Client-side containment (defense in depth, not the boundary): strict-mode
function scope with `woc` as the only injected name, per-handler try/catch,
auto-disable after 5 handler errors, frozen API objects, capped handlers,
panels, toast length, and namespaced storage (8 KiB/key, 64 KiB/plugin).

## The `woc` API (v1, append-only)

- `woc.apiVersion` (1), `woc.meta` ({ slug, name, version })
- `woc.on(event, handler)` / `woc.off(event, handler)` with events:
  `combat`, `chat`, `loot`, `xp`, `levelup`, `quest`, `death`, `respawn`,
  `deed`, `tick` (1 Hz player snapshot), `enable`, `disable`
- `woc.player()`: read-only snapshot ({ id, name, level, hp, hpMax, xp,
  xpNext, copper, x, z })
- `woc.ui.panel({ id, title })`: a draggable, position-remembering overlay
  panel (max 4); `woc.ui.toast(text)`; `woc.ui.sound(cue)` from a small
  allowlist (`click`, `coin`, `chime`, `level`, `quest`, `alert`)
- `woc.storage.get/set/remove`: JSON storage namespaced per plugin
- `woc.util.esc/formatNumber/formatMoney/formatDuration`: the canonical HTML
  escaper (any player text a plugin interpolates goes through it) and the
  locale-aware formatters

The event mapping lives in `src/ui/plugins/plugin_events_core.ts` and is the
compatibility contract with every published plugin: additions only.

## Caps and hygiene

- 8 plugins per account, 32 installs per account, 128 KiB source,
  192 KiB submit body, catalog capped at 200 listed rows (one cached page).
- `plugin_versions` prunes at submit time to the newest 20 per plugin and
  never drops the live approved version; all three tables are bounded by
  construction (see the DDL header in `server/plugins_db.ts`).
- Mutations ride `PLUGIN_MUTATION_POLICY` (20/min, ip+account fused);
  catalog and detail reads ride the public-read budget.

## Where things live

- Server: `server/plugins.ts` (rules) / `plugins_db.ts` (SQL + schema) /
  `plugins_routes.ts` (registry-only RouteDefs) / `plugin_screen.ts`
  (pre-screen); admin arms + RouteDefs in `server/admin.ts` gated by
  `content.moderate` (`server/admin_routes.ts`).
- Client: `src/ui/plugins/` (store window, REST client, runtime host, the
  `woc` API); wired by `Hud.enablePlugins` from `main.ts` (online only).
- Admin UI: `src/admin/pages/Plugins.svelte` (review queue + moderation
  table).
- Seeds: `server/plugins_seed/` + `scripts/seed_plugins.ts`
  (`npm run db:seed-plugins`, idempotent; run once per environment after
  deploy, and again whenever a seed changes).

## Seed catalog

Battle Scribe (combat meter), Loot Ledger (session economy), Wayfarer
Waypoints (saved positions with live distance), Chat Chimes (mention and
whisper pings), XP Forecast (time to level), Adventure Journal (session
diary). Each is authored purely against `woc` v1 and doubles as API
documentation and an integration fixture.
