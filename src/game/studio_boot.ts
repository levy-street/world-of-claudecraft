// The authored-map (Studio) entry points of the game client: the published-map
// boot (?map=<slug>), offline Play into a published map (?offlineWorld=<slug>),
// Baldemar's portal handoff and its way home, the Deepglass arena's pinned hour
// and booked bout, and the audio plumbing those entries need. Moved out of
// main.ts (a firewall, root CLAUDE.md), which keeps one resolve call before its
// boot branches, one call in its offline Play handler and one call in
// startOffline.
//
// The built-in world never reaches any of it: with no ?map= slug and no portal
// handoff in storage, resolveStudioEntry returns null and the normal home flow
// boots exactly as before; offline Play boots the built-in world unless a map
// was asked for; startAuthoredOfflineSession is inert for any world that is not
// the Deepglass arena.

import { registerPageTeardown } from '../render/context_release';
import { setDayNightPhaseOverride } from '../render/day_night_clock';
import { CLASSES } from '../sim/data';
import { DEEPGLASS_DEFAULT_PER_SIDE, startDeepglassMatch } from '../sim/deepglass/match';
import { DEEPGLASS_MAP_ENTRY } from '../sim/deepglass/world';
import { type PublishedMapEntry, publishedMapBySlug } from '../sim/maps/index.generated';
import { DEEPGLASS_PORTAL_WIZARD_NPC_ID, portalWizardStop } from '../sim/portal_wizard';
import type { Sim } from '../sim/sim';
import type { PlayerClass, WorldContent } from '../sim/types';
import { audio } from './audio';
import { music } from './music';
import { takePortalHandoff } from './portal_travel';
import { sfx } from './sfx';

/** Late afternoon. See the pin in startAuthoredOfflineSession. */
export const DEEPGLASS_HOUR = 0.62;

/** main.ts's offline boot, as the studio entries call it. */
export type StartOfflineFn = (
  playerClass: PlayerClass,
  name: string,
  skin: number,
  world?: WorldContent,
  seedOverride?: number,
  playerStartOverride?: { x: number; z: number },
) => Promise<void>;

/** A resolved studio entry: boots its world through the caller's offline flow. */
export interface StudioEntry {
  boot(startOffline: StartOfflineFn, sanitizeName: (raw: string) => string): void;
}

/**
 * The town stop the current Deepglass session arrived FROM, read by the bell
 * self's gate to aim the way home. Set once at boot from the consumed portal
 * handoff; null for a session that arrived by URL (the return then lands at
 * the world start).
 */
let arrivalOrigin: string | null = null;
export function portalArrivalOrigin(): string | null {
  return arrivalOrigin;
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

/**
 * A published map by slug, the way both studio entries look one up. The
 * registry is consulted FIRST, including for the arena's own slug: opening the
 * Deepglass in Studio and publishing it back has to be what actually boots, or
 * every tweak a maker makes is silently ignored. The programmatic arena is the
 * FALLBACK, so an unpublished install still gets the built-in venue and a
 * Studio republish of some other map can never clobber it.
 */
export function studioMapBySlug(slug: string): PublishedMapEntry | undefined {
  return (
    publishedMapBySlug(slug) ??
    (slug === DEEPGLASS_MAP_ENTRY.slug ? DEEPGLASS_MAP_ENTRY : undefined)
  );
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
  lookup: typeof publishedMapBySlug = studioMapBySlug,
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
 * cap live AudioContexts the same way they cap GL contexts, and the portal's
 * world swaps (overworld <-> Deepglass, see src/game/portal_travel.ts) would
 * otherwise stack a fresh music + sfx context pair on every trip. Teardowns run
 * only through retirePageAndReplace / retirePageAndClose, which only the
 * studio travel and playtest paths call.
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
 * no combat, and (the way this was found) no deepball whistle. Creating a
 * context here at load would be worse than useless:
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
 * flow. Consumes Baldemar's one-shot handoff (written immediately before the
 * page swap, src/game/portal_travel.ts) exactly once, whatever branch boots,
 * so a plain reload never replays a stale trip. It carries the character
 * (offline characters are not otherwise persisted) and the town the outbound
 * trip left from, so the round trip keeps both.
 */
export function resolveStudioEntry(
  params: URLSearchParams,
  editorPlaytestActive: boolean,
): StudioEntry | null {
  const portalHandoff = takePortalHandoff();
  const handoffClass: PlayerClass | null =
    portalHandoff && CLASSES[portalHandoff.cls as PlayerClass]
      ? (portalHandoff.cls as PlayerClass)
      : null;
  if (portalHandoff?.originStopId) arrivalOrigin = portalHandoff.originStopId;
  // Studio-published map boot: ?map=<slug> resolves through the generated
  // registry (src/sim/maps/index.generated.ts) and boots offline into that
  // world, exactly like a playtest but from committed repo content. An unknown
  // slug falls through to the normal home flow.
  const publishedMapSlug = editorPlaytestActive ? null : params.get('map');
  // Registry first, the programmatic arena as the fallback (studioMapBySlug).
  const publishedMap = publishedMapSlug ? studioMapBySlug(publishedMapSlug) : undefined;
  if (editorPlaytestActive) return null;
  if (publishedMap) {
    const viaPortal = portalHandoff?.dest === 'deepglass' && handoffClass !== null;
    return {
      boot(startOffline, sanitizeName) {
        void publishedMap.load().then((world) => {
          // A portal arrival lands beside Baldemar's self in THIS world, at the
          // Wardens' Fountain in the middle of Tidehold, rather than at the
          // arena arrival point half a map away. Read from the world's own npcs
          // table so moving him in data moves the landing with him.
          const wizardPos = viaPortal
            ? world.npcs?.[DEEPGLASS_PORTAL_WIZARD_NPC_ID]?.pos
            : undefined;
          void startOffline(
            viaPortal && handoffClass ? handoffClass : 'warrior',
            viaPortal && portalHandoff
              ? sanitizeName(portalHandoff.name)
              : publishedMap.name.slice(0, 24) || 'Maker',
            0,
            world,
            publishedMap.seed,
            wizardPos ? { x: wizardPos.x + 2.5, z: wizardPos.z + 2.5 } : undefined,
          );
        });
      },
    };
  }
  if (portalHandoff?.dest === 'overworld' && handoffClass !== null) {
    // The way home: boot straight into the offline overworld, no start screen,
    // landing beside the wizard whose town the trip left from (or the world
    // start if the outbound leg began from a URL rather than a town).
    const stop = portalHandoff.originStopId ? portalWizardStop(portalHandoff.originStopId) : null;
    return {
      boot(startOffline, sanitizeName) {
        void startOffline(
          handoffClass,
          sanitizeName(portalHandoff.name),
          0,
          undefined,
          undefined,
          stop ? { x: stop.x + 2.5, z: stop.z + 2.5 } : undefined,
        );
      },
    };
  }
  return null;
}

/** The bout size booked on the URL, or null when this is not the arena or no
 *  booking was made. Clamped to the roster the layout can actually seat. */
export function boutSizeFromUrl(world: WorldContent | undefined, search: string): number | null {
  if (world?.presentationMode !== 'deepglass') return null;
  const raw = new URLSearchParams(search).get('bout');
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEEPGLASS_DEFAULT_PER_SIDE;
  return Math.max(1, Math.min(5, n));
}

/**
 * The authored-world tail of an offline boot, run once the Sim exists.
 *
 * The Deepglass keeps its own hour. It is an event venue with a stadium, a lit
 * bell and sixteen crystal pylons; what it must never be is whatever the real
 * UTC clock happens to say, because half of that clock is a night that renders
 * the whole arena as a black shape against a black sky. Pinned to late
 * afternoon: the sun is low enough to rim the pylons and the cornice, and high
 * enough to read the architecture. The dev `/time` command still overrides this
 * afterwards for anyone who wants to look at it at midnight.
 *
 * The steward's booking: ?bout=N alongside ?map=deepglass calls the whistle the
 * moment the arena is up, so her passage lands you IN a match rather than on
 * the plaza next to a chat hint. Deliberately NOT routed through the
 * /deepglass dev command: that is gated on a DEV build, and the steward is
 * shipped content.
 */
export function startAuthoredOfflineSession(sim: Sim, world: WorldContent | undefined): void {
  if (world?.presentationMode === 'deepglass') setDayNightPhaseOverride(DEEPGLASS_HOUR);
  const bout = boutSizeFromUrl(world, window.location.search);
  if (bout !== null) startDeepglassMatch(sim.ctx, sim.playerId, bout);
}
