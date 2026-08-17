// Discord Rich Presence, seen from the renderer: the zone line the player's
// Discord profile shows while they play, plus the elapsed-session clock under
// it. The shell owns the RPC socket; this module owns WHAT is published, WHEN,
// and WHETHER at all.
//
// PRIVACY FLOOR: an activity carries the zone name and the app identity, and
// nothing else. Never the character name, never account or wallet anything,
// never party composition. The published object's key set is pinned exactly by
// tests/desktop_discord_presence.test.ts, so a field added here fails there
// before it can reach a public profile.
//
// Lives in src/game so main.ts stays a firewall and so both halves stay
// directly Node-testable: a pure activity builder and a pure coalescer core
// (all time passed in), with the module-scope armed latch mirroring
// src/game/desktop_notifications.ts. The frame hook no-ops until composition
// arms it, so neither the web build nor an older shell pays anything per frame.

import type { DesktopBridge, DesktopDiscordActivity } from '../runtime';
import { DUNGEON_X_THRESHOLD, zoneAt } from '../sim/data';
import { zoneDisplayName } from '../ui/entity_i18n';
import { Settings } from './settings';

/** The structural slice of IWorld this module reads. Both hosts satisfy it (the
 *  offline Sim and the online ClientWorld), and keeping it minimal is what lets
 *  the frame-feed arms run against a plain object in Vitest. The id is read for
 *  one reason only: telling a real local player from the online placeholder. */
export interface DiscordPresenceWorld {
  player: { id: number; pos: { x: number; z: number } };
}

export interface DiscordPresenceSnapshot {
  enabled: boolean;
  /** False when the fed world has no real local player (the online
   *  pre-snapshot placeholder, a session back out of the world): nothing may
   *  STAY published there, so the core owes a clear for anything it set. */
  inWorld: boolean;
  zoneId: string | null;
  zoneName: string | null;
  sessionStartSec: number;
}

export type DiscordPresenceCommand =
  | { kind: 'set'; activity: DesktopDiscordActivity }
  | { kind: 'clear' };

export interface DiscordPresenceCore {
  update(nowMs: number, snapshot: DiscordPresenceSnapshot): DiscordPresenceCommand | null;
}

/** Discord's own rate limit is one activity update every 15 seconds; sending
 *  faster is silently dropped, so the coalescer trails the boundary instead. */
const DEFAULT_INTERVAL_MS = 15_000;

/** At most one core poll per second, independent of the frame rate. */
const POLL_INTERVAL_MS = 1000;

/**
 * The published activity for one zone. Pure, and the ONLY place an activity is
 * constructed, so the key-set pin over this function covers everything the
 * shell can ever be handed. `details` is the zone line: the "Playing World of
 * ClaudeCraft" above it comes from the app registration, not from here.
 */
export function buildZoneActivity(
  zoneName: string,
  sessionStartSec: number,
): DesktopDiscordActivity {
  return { details: zoneName, timestamps: { start: sessionStartSec } };
}

/**
 * True when the installed shell exposes BOTH halves of the presence contract.
 * The options row and the frame feed are gated on this, never on
 * isNativeAppShell(): that flag is also true in the mobile Capacitor shells,
 * and a desktop shell installed before presence shipped exposes neither method.
 */
export function desktopDiscordPresenceSupported(bridge: DesktopBridge | null | undefined): boolean {
  return (
    typeof bridge?.setDiscordActivity === 'function' &&
    typeof bridge?.setDiscordPresenceEnabled === 'function'
  );
}

/**
 * The pure decision half: which polls become a bridge call. Stateful only in
 * what it has already published (the last pushed zone, when it was pushed, and
 * whether presence is currently live), so one core instance is one session.
 *
 * Rate limiting is TRAILING EDGE by design: zone flips inside a window collapse
 * to the last one, so a player crossing three zone borders in ten seconds
 * publishes where they ENDED, not where they were when the window opened. The
 * clear on a disable transition is deliberately not rate limited: the off
 * switch is user intent, and it must take effect the moment it is flipped.
 */
export function createDiscordPresenceCore({
  intervalMs = DEFAULT_INTERVAL_MS,
}: {
  intervalMs?: number;
} = {}): DiscordPresenceCore {
  let lastPushedZoneId: string | null = null;
  // -Infinity, not 0: the first emit of a session must be immediate at any
  // clock value, including a fake clock that starts at 0.
  let lastEmitAt = -Infinity;
  // Starts true so the FIRST poll of a disabled session still clears: nothing
  // here knows what a previous session left published on the shell's socket.
  let live = true;
  return {
    update(nowMs, snapshot) {
      if (!snapshot.enabled) {
        if (!live) return null;
        live = false;
        // Forget what was published so re-enabling resends the current zone
        // rather than deduping against a presence that no longer exists.
        lastPushedZoneId = null;
        return { kind: 'clear' };
      }
      live = true;
      if (!snapshot.inWorld) {
        // The world went away under the feed: a published zone would otherwise
        // sit on the profile, clock ticking, for as long as the app stays
        // open. Cleared once, and the dedup memory is forgotten so re-entering
        // the same zone republishes. lastEmitAt survives, like the disable
        // arm: the shell's own 15s send floor would drop an earlier resend.
        if (lastPushedZoneId === null) return null;
        lastPushedZoneId = null;
        return { kind: 'clear' };
      }
      if (snapshot.zoneId === null || snapshot.zoneName === null) return null;
      if (snapshot.zoneId === lastPushedZoneId) return null;
      if (nowMs - lastEmitAt < intervalMs) return null;
      lastEmitAt = nowMs;
      lastPushedZoneId = snapshot.zoneId;
      return {
        kind: 'set',
        activity: buildZoneActivity(snapshot.zoneName, snapshot.sessionStartSec),
      };
    },
  };
}

// Armed by initDiscordPresence, and only on a shell that can publish at all.
let publish: ((activity: DesktopDiscordActivity | null) => void) | null = null;
let core: DiscordPresenceCore | null = null;
let sessionStartSec = 0;
let lastPollAt = -Infinity;
// The zone the presence is describing. Held (not recomputed) inside instances,
// see the dungeon gate in desktopPresenceOnFrame.
let zoneId: string | null = null;
let zoneName: string | null = null;
// The player's stored choice, cached so the 1 Hz poll never rebuilds a Settings
// (its constructor parses the whole localStorage blob). Seeded by the one read
// initDiscordPresence does, and refreshed by pushDiscordPresenceEnabled below,
// which every write passes through: the options row, the Interface panel's
// Reset to Defaults, and the world-entry apply-all loop all reach the setting
// through main.ts applySetting, and that arm is the only caller of the push.
let presenceEnabled = true;

/**
 * Compose the presence feed onto the bridge. A no-op on any bridge missing
 * either half (older installed shell, plain browser build), which leaves the
 * latch disarmed and the frame path free.
 */
export function initDiscordPresence(bridge: DesktopBridge): void {
  publish = null;
  core = null;
  sessionStartSec = 0;
  lastPollAt = -Infinity;
  zoneId = null;
  zoneName = null;
  if (!desktopDiscordPresenceSupported(bridge)) return;
  const setActivity = bridge.setDiscordActivity as (a: DesktopDiscordActivity | null) => void;
  publish = (activity: DesktopDiscordActivity | null) => {
    setActivity.call(bridge, activity);
  };
  // Captured once, so the elapsed clock counts this session rather than
  // restarting on every zone change (Discord restarts it whenever `start`
  // changes). Seconds, which is the unit the RPC payload wants.
  sessionStartSec = Math.floor(Date.now() / 1000);
  // The ONE settings read of the session, and it does double duty: it seeds the
  // cache the poll reads, and the push reconciles a shell whose own store
  // disagrees (a cleared localStorage, a reset prefs file, a shell that was
  // told "off" by a previous install). Without it the off switch would only
  // hold from the first toggle rather than from startup.
  pushDiscordPresenceEnabled(bridge, new Settings().get('discordPresence'));
  // The one boot-time clear. The leave-world path is a location.reload() (the
  // options-menu logout), so the shell process outlives the page while holding
  // whatever the previous page published; a fresh page is not in any world, so
  // its correct presence is nothing. On a shell with no connection this dials
  // nothing (the manager only connects for a non-null activity), and on a live
  // socket the clear rides the shell's own send floor.
  publish(null);
  core = createDiscordPresenceCore();
}

/**
 * Feed one frame's world state to the presence coalescer. Called from the frame
 * path in both modes; self-throttled to one poll per second, so the per-frame
 * cost on an armed desktop shell is a Date.now() and a comparison, and on every
 * other host a single null check.
 */
export function desktopPresenceOnFrame(world: DiscordPresenceWorld): void {
  if (publish === null || core === null) return;
  const now = Date.now();
  if (now - lastPollAt < POLL_INTERVAL_MS) return;
  lastPollAt = now;
  const p = world.player;
  // Online, ClientWorld.player answers blankEntity(-1) at the world origin until
  // the first snapshot lands (src/net/online.ts), and the same shape is what a
  // session that LEFT the world feeds. Both hosts number real local players
  // from 1 up (the offline Sim allocates from nextId = 1; online ids are server
  // pids), so a non-positive id means "no player here", never a real location.
  // The core is still polled on those frames, because it owes a clear when a
  // zone was published before the world went away; publishing zoneAt(0,0) in
  // the pre-snapshot window stays impossible because the zone is never
  // resolved while out of the world.
  const inWorld = p.id > 0;
  if (!inWorld) {
    // Forget the held zone so re-entry resolves it fresh.
    zoneId = null;
    zoneName = null;
  } else if (p.pos.x <= DUNGEON_X_THRESHOLD) {
    // Dungeons have no zone row (the instance strip sits past this x), so the
    // presence HOLDS the region the player entered from: phase 10 is
    // zone-only, and naming the instance is a separate design call.
    const id = zoneAt(p.pos.x, p.pos.z).id;
    if (id !== zoneId) {
      zoneId = id;
      // Resolved on change only: the core dedupes by zone id, so re-resolving
      // every poll could not publish a language switch any sooner anyway. The
      // visible consequence: after an in-session language switch the published
      // zone name stays in the previous language until the player crosses a
      // zone border.
      zoneName = zoneDisplayName(id);
    }
  }
  const command = core.update(now, {
    enabled: presenceEnabled,
    inWorld,
    zoneId,
    zoneName,
    sessionStartSec,
  });
  if (command === null) return;
  publish(command.kind === 'set' ? command.activity : null);
}

/**
 * Push the player's options-row choice to the shell, which owns the RPC
 * connection. Fire and forget: nothing in the running session depends on the
 * answer. NO inversion at this crossing (unlike the GPU preference next to it
 * in the options list): the setting and the wire value have the SAME polarity,
 * so presence enabled is `true` on both sides. Do not add a `!` here.
 *
 * Also the cache refresh for the frame poll, which is why it updates the cached
 * value BEFORE the capability check: the renderer-side belief must follow the
 * player's choice even on a shell that cannot be told about it.
 */
export function pushDiscordPresenceEnabled(
  bridge: DesktopBridge | null | undefined,
  enabled: boolean,
): void {
  presenceEnabled = enabled;
  const write = bridge?.setDiscordPresenceEnabled;
  if (typeof write !== 'function') return;
  write.call(bridge, enabled);
}
