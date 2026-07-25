# src/ui/plugins/: the community plugin store and runtime

Client side of the plugin store (docs/prd/plugins-store.md): the in-game store
window, the REST client, and the runtime host that executes approved community
mods without a redeploy. Composed by `Hud` (window, event tap) and `main.ts`
(the authed `PluginsClient`), through the `index.ts` barrel only.

## Modules
- `plugins_client.ts`: REST SDK (the `economy_sdk` shape). Reads fall back to
  empty states; mutations throw `PluginsApiError` carrying the stable
  `plugins.*` code, localized via `userFacingApiError`.
- `plugin_events_core.ts`: PURE (in `UI_PURE_CORES`). Maps `SimEvent`s to the
  versioned plugin event vocabulary and builds the read-only player snapshot.
  The vocabulary is append-only: never repurpose or remove an event or field.
- `plugin_api.ts`: builds the frozen `woc` object one instance sees: events,
  `player()`, contained panels/toasts/sound cues, namespaced size-capped
  storage, locale formatters. Read-and-render only, NO gameplay actions and no
  network members, ever. It is containment for honest mistakes, not a security
  boundary: the human review gate (server side) is the boundary.
- `plugin_host.ts`: instance lifecycle + containment. Executes approved source
  in a strict-mode function scope, try/catches every handler, auto-disables a
  plugin after repeated errors, hot-swaps on version change (`syncInstalled`).
- `plugins_store_view.ts`: PURE (in `UI_PURE_CORES`) render model for the
  window (tabs, filters, sort, status label keys).
- `plugins_store_window.ts`: the cold `#plugins-window` painter (deeds/bank
  shape): full rebuild per interaction, `markDialogRoot`, every community
  string through `esc()`.

## Invariants
- Community text (names, summaries, notes, sources) is DATA: always `esc()`ed
  into HTML, never a `t()` key. Store chrome is always `t()`.
- Plugins run ONLY from `/api/plugins/installed` rows (server-approved
  versions). Never execute source from any other field or endpoint.
- The `woc` API surface may only grow behind `apiVersion` checks; removing or
  changing a member breaks live community plugins.
