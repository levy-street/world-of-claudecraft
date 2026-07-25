// The plugin host: starts, stops, and contains every installed community
// plugin. Each plugin is an approved source string executed once inside a
// strict-mode function scope that receives ONLY the frozen `woc` API
// (plugin_api.ts); every handler call is try/caught, and a plugin that throws
// MAX_INSTANCE_ERRORS times is locally auto-disabled (its panels and handlers
// torn down, the player toasted) so one broken mod can never take the HUD
// down with it. Install/enable/update all land here at runtime: no reload,
// no redeploy (docs/prd/plugins-store.md).

import type { SimEvent } from '../../sim/types';
import { buildPluginApi, type PluginApiDeps, PluginInstanceState } from './plugin_api';
import { mapSimEventForPlugins, type PluginEvent } from './plugin_events_core';
import type { InstalledRowWire } from './plugins_client';

const MAX_INSTANCE_ERRORS = 5;
const TICK_INTERVAL_MS = 1000;

export interface PluginHostDeps extends PluginApiDeps {
  /** A plugin was locally auto-disabled after repeated errors. */
  onAutoDisabled(name: string): void;
}

interface RunningPlugin {
  state: PluginInstanceState;
  version: number;
}

export class PluginHost {
  private readonly running = new Map<string, RunningPlugin>();
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: PluginHostDeps) {}

  /** Slugs currently running (enabled and started without a boot error). */
  runningSlugs(): string[] {
    return [...this.running.keys()];
  }

  isRunning(slug: string): boolean {
    return this.running.has(slug);
  }

  /**
   * Reconcile the running set against the authoritative installed list:
   * start enabled plugins that are not running, restart on a version change
   * (an approved update goes live on the next sync, no reload), stop rows
   * now disabled or gone. Instant activation after an install click is just
   * this method with the fresh list.
   */
  syncInstalled(rows: InstalledRowWire[]): void {
    const wanted = new Map(rows.filter((row) => row.enabled).map((row) => [row.slug, row]));
    for (const [slug, instance] of this.running) {
      const row = wanted.get(slug);
      if (!row || row.version !== instance.version) this.stopOne(slug);
    }
    for (const row of wanted.values()) {
      if (!this.running.has(row.slug)) this.startOne(row);
    }
    this.syncTicker();
  }

  /** Start one plugin from its approved source. False = the source threw on boot. */
  startOne(row: InstalledRowWire): boolean {
    this.stopOne(row.slug);
    const state = new PluginInstanceState(row.slug, row.name, row.version);
    const api = buildPluginApi(state, this.deps);
    try {
      // Parse + run the reviewed source with `woc` as its only name. Strict
      // mode keeps sloppy globals from leaking; this is containment for
      // honest mistakes, not a sandbox (the review gate is the boundary).
      const boot = new Function('woc', `'use strict';\n${row.source}\n`) as (api: object) => void;
      boot(api);
    } catch {
      state.dispose();
      return false;
    }
    this.running.set(row.slug, { state, version: row.version });
    this.emitTo(state, { type: 'enable', data: {} });
    this.syncTicker();
    return true;
  }

  stopOne(slug: string): void {
    const instance = this.running.get(slug);
    if (!instance) return;
    this.emitTo(instance.state, { type: 'disable', data: {} });
    instance.state.dispose();
    this.running.delete(slug);
    this.syncTicker();
  }

  stopAll(): void {
    for (const slug of [...this.running.keys()]) this.stopOne(slug);
  }

  /** The HUD event tap: fan the frame's SimEvents out to every plugin. */
  dispatchSimEvents(events: SimEvent[]): void {
    if (this.running.size === 0 || events.length === 0) return;
    for (const ev of events) {
      const mapped = mapSimEventForPlugins(ev);
      if (mapped) this.broadcast(mapped);
    }
  }

  private broadcast(event: PluginEvent): void {
    for (const instance of [...this.running.values()]) {
      this.emitTo(instance.state, event);
    }
  }

  private emitTo(state: PluginInstanceState, event: PluginEvent): void {
    const handlers = state.handlers.get(event.type);
    if (!handlers || handlers.size === 0) return;
    for (const handler of [...handlers]) {
      try {
        handler(event.data);
      } catch {
        state.errorCount++;
        if (state.errorCount >= MAX_INSTANCE_ERRORS && this.running.has(state.slug)) {
          const name = state.name;
          this.stopOne(state.slug);
          this.deps.onAutoDisabled(name);
          return;
        }
      }
    }
  }

  /** The 1 Hz tick rides one shared interval, alive only while plugins run. */
  private syncTicker(): void {
    if (this.running.size > 0 && this.ticker === null) {
      this.ticker = setInterval(() => {
        const snapshot = this.deps.playerSnapshot();
        if (snapshot) this.broadcast({ type: 'tick', data: { ...snapshot } });
      }, TICK_INTERVAL_MS);
    } else if (this.running.size === 0 && this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }
}
