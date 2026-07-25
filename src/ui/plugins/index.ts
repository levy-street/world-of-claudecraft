// Public surface of the plugin store subsystem (src/ui/plugins/). Hud and
// main.ts compose through this barrel only; the internals (API construction,
// event mapping, panel plumbing) stay private to the directory.

export type { PluginApiDeps, PluginSoundCue } from './plugin_api';
export type {
  PluginEvent,
  PluginEventType,
  PluginPlayerSnapshot,
  PluginPlayerSource,
} from './plugin_events_core';
export { buildPlayerSnapshot } from './plugin_events_core';
export { PluginHost, type PluginHostDeps } from './plugin_host';
export {
  type CatalogRowWire,
  type InstalledRowWire,
  type MineRowWire,
  PluginsApiError,
  PluginsClient,
  type PluginsClientConfig,
} from './plugins_client';
export { PluginsStoreWindow, type PluginsStoreWindowDeps } from './plugins_store_window';
