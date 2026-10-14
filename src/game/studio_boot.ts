// The authored-map (Studio) entry points of the game client: the published-map
// boot (?map=<slug>) and the audio plumbing that URL entry needs. Moved out of
// main.ts (a firewall, root CLAUDE.md), which keeps one resolve call before its
// boot branches.
//
// The built-in world never reaches any of it: with no ?map= slug,
// resolveStudioEntry returns null and the normal home flow boots exactly as
// before.

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
 * The launcher's Play button calls audio/music/sfx `init()` directly, because a
 * click IS the gesture the AudioContext policy wants. The URL entry points have
 * no such click: `?map=<slug>` and the editor playtest boot straight into the
 * world on page load, so they never called init at all and the whole session ran
 * SILENT: no music, no footsteps, no combat. Creating a context here at load
 * would be worse than useless: Chrome refuses to start it and logs a warning
 * for every attempt.
 *
 * So: wait for the first real gesture and init then. `once` plus `capture` so it
 * costs one listener and fires no matter what swallows the event, and all three
 * engines go together because they share the same policy and the same trigger.
 */
export function initAudioOnFirstGesture(): void {
  if (typeof window === 'undefined') return;
  const start = (): void => {
    audio.init();
    music.init();
    sfx.init();
  };
  for (const type of ['pointerdown', 'keydown', 'touchend'] as const) {
    window.addEventListener(type, start, { once: true, capture: true });
  }
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
