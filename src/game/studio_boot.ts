// The authored-map (Studio) entry points of the game client: the published-map
// boot (?map=<slug>), offline Play into a published map (?offlineWorld=<slug>),
// and the audio plumbing those entries need. Moved out of main.ts (a firewall,
// root CLAUDE.md), which keeps one resolve call before its boot branches and
// one call in its offline Play handler.
//
// The built-in world never reaches any of it: with no ?map= slug,
// resolveStudioEntry returns null and the normal home flow boots exactly as
// before, and offline Play boots the built-in world unless a map was asked for.

import { registerPageTeardown } from '../render/context_release';
import { publishedMapBySlug } from '../sim/maps/index.generated';
import type { PlayerClass, WorldContent } from '../sim/types';
import { audio } from './audio';
import { music } from './music';
import { sfx } from './sfx';

/** main.ts's offline boot, as the studio entries call it. */
export type StartOfflineFn = (
  playerClass: PlayerClass,
  name: string,
  skin: number,
  world?: WorldContent,
  seedOverride?: number,
) => Promise<void>;

/** A resolved studio entry: boots its world through the caller's offline flow. */
export interface StudioEntry {
  boot(startOffline: StartOfflineFn): void;
}

/** `?offlineWorld=<slug>`: offline Play boots that published map. */
export const OFFLINE_WORLD_PARAM = 'offlineWorld';
/** The value that always means the built-in world, whatever the machine default. */
export const OFFLINE_BUILTIN_WORLD = 'builtin';

/**
 * The published map offline Play boots in place of the built-in world, or null
 * for the built-in world. The page asks with `?offlineWorld=<slug>`; a developer
 * makes one map their own machine's default with `VITE_OFFLINE_WORLD=<slug>` in
 * `.env.local` (the query wins, and `builtin` in either place is the built-in
 * world). Off by default on purpose: a published map is an authored world, so it
 * runs without what only the built-in world has (the ferry, the stations and
 * mailboxes, the graveyards), which is right for looking at a map and wrong as
 * everyone's offline game.
 */
export function offlineWorldSlug(
  params: URLSearchParams,
  machineDefault: string | undefined,
): string | null {
  const asked = params.get(OFFLINE_WORLD_PARAM) ?? machineDefault ?? '';
  return asked === '' || asked === OFFLINE_BUILTIN_WORLD ? null : asked;
}

export interface OfflineWorld {
  world: WorldContent;
  seed: number;
}

/**
 * Load the published map offline Play was asked for, or null for the built-in
 * world: when none was asked for, when this checkout publishes no such map, or
 * when the map fails to load (a Play button that does nothing is worse than the
 * built-in world). The last two say so in the console.
 */
export async function loadOfflineWorld(
  params: URLSearchParams,
  machineDefault: string | undefined,
  lookup: typeof publishedMapBySlug = publishedMapBySlug,
): Promise<OfflineWorld | null> {
  const slug = offlineWorldSlug(params, machineDefault);
  if (!slug) return null;
  const entry = lookup(slug);
  if (!entry) {
    console.warn(`Offline world "${slug}" is not a published map; using the built-in world`);
    return null;
  }
  try {
    return { world: await entry.load(), seed: entry.seed };
  } catch (err) {
    console.warn(`Offline world "${slug}" failed to load; using the built-in world`, err);
    return null;
  }
}

/**
 * The home screen's offline Play. The click IS the gesture the AudioContext
 * policy wants, so the engines start here. With no map asked for it reaches
 * startOffline in the same task as the click, exactly as the inline handler did;
 * a published map loads first and boots like a ?map= link, with the character
 * the player just made.
 */
export function bootOfflinePlay(
  startOffline: StartOfflineFn,
  playerClass: PlayerClass,
  name: string,
  skin: number,
  params: URLSearchParams = new URLSearchParams(window.location.search),
  machineDefault: string | undefined = import.meta.env.VITE_OFFLINE_WORLD,
): Promise<void> {
  startAudioEngines();
  if (!offlineWorldSlug(params, machineDefault)) return startOffline(playerClass, name, skin);
  return loadOfflineWorld(params, machineDefault).then((picked) =>
    startOffline(playerClass, name, skin, picked?.world, picked?.seed),
  );
}

/**
 * Close the audio engines with the page, exactly as the editor does: browsers
 * cap live AudioContexts the same way they cap GL contexts, and a playtest's
 * page hops (back to the editor and in again) would otherwise stack a fresh
 * music + sfx context pair on every trip. Teardowns run only through
 * retirePageAndReplace / retirePageAndClose, which only the studio playtest
 * paths call.
 */
export function registerStudioAudioTeardown(): void {
  registerPageTeardown(() => {
    music.close();
    audio.close();
  });
}

/**
 * Start the audio engines on the first user gesture.
 *
 * The launcher's Play button starts them from its own click (bootOfflinePlay
 * above for offline Play), because a click IS the gesture the AudioContext
 * policy wants. The URL entry points have no such click: `?map=<slug>` and the
 * editor playtest boot straight into the world on page load, so they never
 * called init at all and the whole session ran SILENT: no music, no footsteps,
 * no combat. Creating a context here at load would be worse than useless:
 * Chrome refuses to start it and logs a warning for every attempt.
 *
 * So: wait for the first real gesture and init then. `once` plus `capture` so it
 * costs one listener and fires no matter what swallows the event.
 */
export function initAudioOnFirstGesture(): void {
  if (typeof window === 'undefined') return;
  for (const type of ['pointerdown', 'keydown', 'touchend'] as const) {
    window.addEventListener(type, startAudioEngines, { once: true, capture: true });
  }
}

/** All three engines go together: one policy, one trigger. */
function startAudioEngines(): void {
  audio.init();
  music.init();
  sfx.init();
}

/**
 * Resolve the studio entry this page load asked for, or null for the normal
 * flow. Studio-published map boot: ?map=<slug> resolves through the generated
 * registry (src/sim/maps/index.generated.ts) and boots offline into that
 * world, exactly like a playtest but from committed repo content. An unknown
 * slug falls through to the normal home flow.
 */
export function resolveStudioEntry(
  params: URLSearchParams,
  editorPlaytestActive: boolean,
): StudioEntry | null {
  if (editorPlaytestActive) return null;
  const publishedMapSlug = params.get('map');
  const publishedMap = publishedMapSlug ? publishedMapBySlug(publishedMapSlug) : undefined;
  if (!publishedMap) return null;
  return {
    boot(startOffline) {
      void publishedMap.load().then((world) => {
        void startOffline(
          'warrior',
          publishedMap.name.slice(0, 24) || 'Maker',
          0,
          world,
          publishedMap.seed,
        );
      });
    },
  };
}
