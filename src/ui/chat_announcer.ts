// Chat live-region announcer (WIRING, not a registered pure core): the chat sibling of
// ./combat_announcer. It buffers the chat lines that reach the visible #chatlog pane and
// flushes a single off-screen polite summary into the tab-independent #chat-live region at
// most once per CHAT_ANNOUNCE_INTERVAL_MS, so a chat burst never floods the screen reader.
// Like CombatAnnouncer it is DOM-free by construction (the text sink and the clock are
// injected) so a Vitest drives it without jsdom; hud.ts wires the sink to the #chat-live
// element's textContent and the clock to performance.now.
//
// WHY A DEDICATED REGION: chat's live region used to ride #chatlog
// itself, but #chatlog goes display:none whenever the combat tab is active, and a
// display:none live region is silent, so chat was not announced on the combat tab.
// #chat-live is a separate top-of-HUD off-screen region that is ALWAYS in the layout, so
// chat announces regardless of which chat tab is shown; #chatlog is set aria-live="off" so
// it no longer double-announces alongside #chat-live (role="log" implies an implicit
// polite, which the explicit off overrides).
//
// The per-type politeness decision lives in the pure ./live_region_politeness picker; this
// module owns only the buffer + throttle state. It shares that picker's pure
// combatAnnounceDue gate, which is parameterized by the injected interval (a host/kind
// agnostic time comparison), so chat reuses it rather than re-spelling the cadence math. It
// announces the latest chat line per interval (a burst collapses to the most recent), and
// never re-localizes: the line it relays is the already-rendered chat text built at the
// append site, so no new player-visible text is introduced here. An identical consecutive
// line is re-read via the shared ./live_region_reannounce marker, exactly as combat does.
import {
  CHAT_ANNOUNCE_INTERVAL_MS,
  chatLineKind,
  combatAnnounceDue,
  liveRegionPoliteness,
} from './live_region_politeness';
import { ReannounceMarker } from './live_region_reannounce';

export class ChatAnnouncer {
  // The latest buffered line awaiting announcement, or null when nothing is pending.
  private pending: string | null = null;
  // Last announcement time; -Infinity so the first line announces immediately.
  private lastAnnounce = Number.NEGATIVE_INFINITY;
  // Forces a byte-different sink write on an identical consecutive line (e.g. the same player
  // repeating the same message, which with chat timestamps off is byte-identical) so a screen
  // reader that suppresses unchanged live text still re-reads it, matching combat. DOM-free +
  // deterministic; the shared marker the combat + target-name regions also use.
  private readonly reannounce = new ReannounceMarker();

  constructor(
    private readonly setText: (summary: string) => void,
    private readonly interval: number = CHAT_ANNOUNCE_INTERVAL_MS,
  ) {}

  /**
   * Record a chat line, then attempt a throttled flush. Only lines whose kind resolves to
   * a polite announcement are buffered (chat is never assertive); the throttle is what
   * keeps a burst from flooding, not the politeness.
   */
  push(line: string, now: number): void {
    if (liveRegionPoliteness(chatLineKind()) !== 'polite') return;
    const text = line.trim();
    if (!text) return;
    this.pending = text;
    this.flush(now);
  }

  /**
   * Flush the buffered summary if the throttle interval has elapsed. Called from push()
   * and from the HUD per-frame tick so a trailing burst still drains.
   */
  flush(now: number): void {
    if (this.pending === null) return;
    if (!combatAnnounceDue(now, this.lastAnnounce, this.interval)) return;
    this.setText(this.reannounce.mark(this.pending));
    this.pending = null;
    this.lastAnnounce = now;
  }
}
