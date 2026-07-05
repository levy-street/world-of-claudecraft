// Pure live-region politeness picker for the chat + combat screen-reader regions
// wired in src/ui/hud.ts. DOM-free + deterministic (same input -> same
// output), so it is a registered UI pure core (tests/architecture.test.ts). The
// throttle STATE and the DOM text sink live in the wiring half (./combat_announcer.ts
// + hud.ts); this module owns only the per-type politeness decision and the named
// cadence + the pure throttle gate.
//
// The 3D world / game canvas is OUT of accessibility scope (not screen-readable);
// nothing here announces over it.

/** The kinds of event a HUD live region can carry. */
export type LiveRegionEventKind =
  | 'chat' // chat-pane messages (#chatlog): announced politely
  | 'combat' // routine combat-log lines (#combatlog): polite + throttled, never assertive
  | 'systemAlert' // genuinely urgent alerts already using role=alert (bug-report errors): assertive
  | 'silent'; // an event another live region already speaks: not re-announced

/** ARIA live politeness. 'off' means do not announce in this region at all. */
export type LiveRegionPoliteness = 'polite' | 'assertive' | 'off';

/**
 * ARIA politeness per live-region event kind. Routine chat and combat are 'polite'
 * (combat is additionally throttled by the announcer, see COMBAT_ANNOUNCE_INTERVAL_MS,
 * so a damage burst never floods the screen reader; it is NEVER escalated to
 * assertive). 'assertive' is reserved for the genuinely urgent system alerts that
 * already use role=alert (the bug-report validation errors in hud.ts / options_window).
 * 'silent' is an event another live region already speaks, so it is not re-announced
 * (the reconciliation that keeps a combat line from double-announcing).
 */
export function liveRegionPoliteness(kind: LiveRegionEventKind): LiveRegionPoliteness {
  switch (kind) {
    case 'chat':
      return 'polite';
    case 'combat':
      return 'polite';
    case 'systemAlert':
      return 'assertive';
    case 'silent':
      return 'off';
  }
}

/**
 * The kind for a routine combat-log line. Combat is always announced politely and
 * throttled, never escalated to assertive: the throttle (not politeness) is what
 * prevents screen-reader flooding during a damage burst. Online (the ClientWorld
 * mirror) and offline (the Sim) feed the SAME localized lines through the one
 * hud.combatLog funnel, so this kind -> politeness mapping is identical on both hosts
 * (parity).
 */
export function combatLineKind(): LiveRegionEventKind {
  return 'combat';
}

/**
 * The kind for a routine chat-pane line. Chat is always announced politely and throttled,
 * never escalated to assertive: the throttle (not politeness) is what prevents a chat
 * burst from flooding the screen reader, mirroring combat. Online (the ClientWorld mirror)
 * and offline (the Sim) feed the SAME localized lines through the one HUD chat funnel, so
 * this kind -> politeness mapping is identical on both hosts (parity).
 */
export function chatLineKind(): LiveRegionEventKind {
  return 'chat';
}

/**
 * The polite combat summary updates at most once per this interval, so a burst of
 * routine damage collapses to a single announcement instead of flooding the screen
 * reader (the cadence is a named constant, not a magic literal).
 */
export const COMBAT_ANNOUNCE_INTERVAL_MS = 1500;

/**
 * The polite chat summary updates at most once per this interval, so a burst of chat lines
 * collapses to a single announcement instead of flooding the screen reader. A SEPARATE
 * named constant from COMBAT_ANNOUNCE_INTERVAL_MS (the cadence is a named
 * constant, not a magic literal) so chat and combat can be tuned independently without
 * re-introducing a magic literal at either announcer.
 */
export const CHAT_ANNOUNCE_INTERVAL_MS = 1500;

/**
 * Pure throttle gate: true when enough time has elapsed since the last combat
 * announcement to flush a new summary. `now` is injected (the core stays free of
 * performance.now / Date.now per the UI-pure-core determinism guard); the wiring
 * passes the clock.
 */
export function combatAnnounceDue(
  now: number,
  lastAnnounce: number,
  interval: number = COMBAT_ANNOUNCE_INTERVAL_MS,
): boolean {
  return now - lastAnnounce >= interval;
}
