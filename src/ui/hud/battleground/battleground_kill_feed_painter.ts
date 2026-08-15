// Thin DOM painter for the Thornhollow Fields kill feed: a short top-right stack of
// death calls, event-pushed and expiry-pruned through the pure core
// (battleground_kill_feed_view.ts). The per-frame update is a no-op unless a
// line actually expired (the core returns the same array otherwise), so the
// frame budget only ever pays on a death or an expiry, never per tick.
//
// Fairness: paints identically on every graphics tier; a kill call is
// actionable information and is never tier-gated. Colors live in the
// stylesheet (components.css), keyed by the KILLER's team class.

import { esc } from '../../esc';
import { t } from '../../i18n';
import {
  type BgKillFeedLine,
  pruneBgKillLines,
  pushBgKillLine,
} from './battleground_kill_feed_view';

export interface BattlegroundKillFeedDeps {
  /** The HUD layer the feed mounts into (the #ui element). */
  layer(): HTMLElement | null;
}

export class BattlegroundKillFeed {
  private root: HTMLElement | null = null;
  private lines: BgKillFeedLine[] = [];

  constructor(private readonly deps: BattlegroundKillFeedDeps) {}

  /** A death landed (the bgKill event): stack its line now. */
  push(kill: Omit<BgKillFeedLine, 'expiresAt'>, now: number): void {
    this.lines = pushBgKillLine(this.lines, kill, now);
    this.render();
  }

  /** Per-frame expiry sweep; elided unless a line actually lapsed. */
  update(now: number): void {
    const pruned = pruneBgKillLines(this.lines, now);
    if (pruned === this.lines) return;
    this.lines = pruned;
    this.render();
  }

  /** Match over (or left): drop the stack immediately. */
  clear(): void {
    if (this.lines.length === 0) return;
    this.lines = [];
    this.render();
  }

  private render(): void {
    const root = this.ensureRoot();
    if (!root) return;
    root.innerHTML = this.lines.map((l) => this.lineHtml(l)).join('');
  }

  // Big team-voiced entries (owner direction): the names render as bold
  // team-colored spans inside the localized sentence. Word order is locale-
  // owned, so the template resolves with SENTINEL characters and the painter
  // splits around them, never around English words.
  private lineHtml(l: BgKillFeedLine): string {
    const K = '\u0001';
    const V = '\u0002';
    const teamCls = (team: number | null): string =>
      team === 0 ? 'crimson' : team === 1 ? 'azure' : 'plain';
    const tpl =
      l.killerName === null
        ? t('hudChrome.bg.killFeedFallen', { victim: V })
        : t('hudChrome.bg.killFeed', { killer: K, victim: V });
    const nameSpan = (name: string, team: number | null): string =>
      `<span class="bgkf-name ${teamCls(team)}">${esc(name)}</span>`;
    const segs: string[] = [];
    let buf = '';
    for (const ch of tpl) {
      if (ch !== K && ch !== V) {
        buf += ch;
        continue;
      }
      if (buf) segs.push(`<span class="bgkf-verb">${esc(buf)}</span>`);
      buf = '';
      segs.push(
        ch === K
          ? nameSpan(l.killerName ?? '', l.killerTeam)
          : nameSpan(l.victimName, l.victimTeam),
      );
    }
    if (buf) segs.push(`<span class="bgkf-verb">${esc(buf)}</span>`);
    const parts = segs.join('');
    // A crossed-swords mark leads the entry (inline SVG: no fonts, no images).
    // Both blades run the FULL diagonal and the two crossguards sit square
    // across their hilts, so the mark is mirror-symmetric about the box centre.
    // The first cut drew one blade corner to corner and bent the other's hilt
    // to stay inside the viewBox, which read as a clipped, broken glyph.
    const mark =
      '<svg class="bgkf-mark" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M4 4 L20 20 M20 4 L4 20 M16 20 L20 16 M4 16 L8 20" ' +
      'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';
    return `<div class="bgkf-line ${teamCls(l.killerTeam)}">${mark}${parts}</div>`;
  }

  private ensureRoot(): HTMLElement | null {
    if (this.root) return this.root;
    const layer = this.deps.layer();
    if (!layer) return null;
    const el = document.createElement('div');
    el.id = 'bg-killfeed';
    // Transient combat chatter: never a live region (the combat log carries
    // the same lines durably for assistive tech and scrollback).
    el.setAttribute('aria-hidden', 'true');
    layer.appendChild(el);
    this.root = el;
    return el;
  }
}
