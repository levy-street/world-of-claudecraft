import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GuildRow } from '../src/ui/social_view';
import { guildMemberRowHtml } from '../src/ui/social_window';

// Source-level guards for the social painter. The pure row + signature decisions are
// unit-tested in social_view.test.ts; here we pin the no-magic-values
// contract (no raw hex, no bare cadence literal) and the load-bearing listener
// delegation: social repaints on the slow-HUD divider, so a content refresh must NOT
// re-attach per-row handlers (one delegated listener on the persistent body does it).
const painter = readFileSync(new URL('../src/ui/social_window.ts', import.meta.url), 'utf8');
const componentsCss = readFileSync(
  new URL('../src/styles/components.css', import.meta.url),
  'utf8',
);
const hudChromeCatalog = readFileSync(
  new URL('../src/ui/i18n.catalog/hud_chrome.ts', import.meta.url),
  'utf8',
);
const mobileCss = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');

describe('social_window: .soc-body layout never uses CSS multicol', () => {
  // Regression for a review finding on the wide-landscape relayout: `.soc-body` is a
  // flex item inside `#social-window`, which has a DEFINED height (`height: 480px`). A
  // multicol container (`columns:`/`column-count:`) with a bounded, non-auto block size
  // does not grow vertically: it spills rows past the box into extra INLINE columns
  // instead, and `overflow-x: hidden` (also set here) clips them with no scroll path to
  // reach them, so friends/guild/ignored/blocked rows past roughly the first two columns
  // silently vanish and are unreachable. `overflow-y: auto` on a grid, by contrast, keeps
  // working because grid rows wrap and grow the scrollable block axis. Pin the fix as
  // grid, not multicol, so this cannot regress back to `columns:`.
  const body = (() => {
    const start = componentsCss.indexOf('.soc-body {');
    expect(start, '.soc-body rule not found in components.css').toBeGreaterThan(-1);
    const end = componentsCss.indexOf('}', start);
    return componentsCss.slice(start, end);
  })();

  it('lays friend/guild/ignore/block rows out with CSS grid', () => {
    expect(body).toContain('display: grid');
    expect(body).toContain('grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))');
  });

  it('never declares columns or column-count (the bug: overflow columns get clipped, not scrolled)', () => {
    expect(body).not.toMatch(/(?:^|[;{\s])columns\s*:/);
    expect(body).not.toMatch(/(?:^|[;{\s])column-count\s*:/);
  });

  it('keeps overflow-y auto so the grid rows remain reachable by scroll', () => {
    expect(body).toContain('overflow-y: auto');
  });
});

describe('social_window: no magic values', () => {
  it('carries no literal hex color in TS (status dots are CSS-classed)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens/CSS: ${hex.join(', ')}`).toEqual([]);
  });

  it('contains no bare 500 cadence literal (the slow-HUD divider lives in hud.ts)', () => {
    expect(painter).not.toMatch(/\b500\b/);
  });

  it('names the typeahead timing constants instead of bare literals', () => {
    expect(painter).toContain('SUGGEST_DEBOUNCE_MS');
    expect(painter).toContain('SUGGEST_BLUR_CLEAR_MS');
  });

  it('uses no em or en dashes (ASCII separators only)', () => {
    expect(painter.includes('—'), 'em dash found').toBe(false);
    expect(painter.includes('–'), 'en dash found').toBe(false);
  });
});

describe('social_window: WAI-ARIA tabs', () => {
  // The tab-strip markup (role=tablist/tab, aria-selected, roving tabindex) and the
  // roving Arrow/Home/End wiring both moved onto the shared tab_strip_view.ts /
  // tab_strip_painter.ts building blocks (their own contracts are pinned in
  // tab_strip_view.test.ts / tab_strip_painter.test.ts); this file now pins that
  // social_window composes them with its five real tabs (friends / guild / ignore /
  // block / raid: ignore and block are two distinct tiers and get a tab each) instead
  // of hand-rolling the markup or the keyboard handler itself.
  it('builds its tab strip from the shared tab_strip_view / tab_strip_painter modules', () => {
    expect(painter).toContain("from './tab_strip_view'");
    expect(painter).toContain("from './tab_strip_painter'");
    expect(painter).toContain('tabStripHtml(');
    expect(painter).toContain('tabStripModel(');
    expect(painter).toContain('wireTabStrip(');
    expect(painter).toContain("panelId: 'soc-body-panel'");
    expect(painter).toContain("stripClass: 'soc-tabs'");
    expect(painter).toContain("tabClass: 'soc-tab'");
    expect(painter).toContain("selectedClass: 'on'");
    for (const id of ['friends', 'guild', 'ignore', 'block', 'raid']) {
      expect(painter).toContain(`{ id: '${id}',`);
    }
  });

  it('makes .soc-body the labelled tabpanel (refreshList still queries it by class)', () => {
    expect(painter).toContain('id="soc-body-panel"');
    expect(painter).toContain('role="tabpanel"');
    expect(painter).toContain('class="soc-body"');
  });

  it('never puts aria-pressed on a tab (tabs use aria-selected, built by the shared strip)', () => {
    // The tab strip is aria-selected, not aria-pressed. The ONLY aria-pressed in the
    // painter is the guild-tab hide-offline TOGGLE button (a real two-state control),
    // so aria-pressed must appear exactly once, glued to the soc-hide-offline button.
    const pressed = painter.match(/aria-pressed/g) ?? [];
    expect(pressed.length).toBe(1);
    expect(painter).toContain('class="soc-hide-offline');
    expect(painter).toMatch(/aria-pressed="\$\{this\.hideOffline/);
  });

  it('refocuses the newly active tab only on a keyboard move, matching the shared wiring contract', () => {
    expect(painter).toContain('(id, focusFollow) => {');
    expect(painter).toContain('if (focusFollow) focusActiveTab(el,');
  });
});

describe('social_window: delegated row listeners (no per-tick churn)', () => {
  it('wires ONE delegated click listener on the body in render(), dispatched by onBodyClick', () => {
    expect(painter).toMatch(/body\.addEventListener\('click'/);
    expect(painter).toContain('private onBodyClick(');
  });

  it('the content refresh only swaps innerHTML and re-attaches no row handlers', () => {
    // Isolate refreshList(): it must not addEventListener (the delegated body listener
    // from render() keeps working across the innerHTML swap, so a cadence tick that
    // only refreshes the list never churns per-row handlers).
    const start = painter.indexOf('private refreshList(): void {');
    expect(start).toBeGreaterThan(-1);
    const next = painter.indexOf('private onBodyClick(', start);
    expect(next).toBeGreaterThan(start);
    const body = painter.slice(start, next);
    expect(body).toContain('body.innerHTML');
    expect(body).not.toContain('addEventListener');
  });
});

describe('social_window: guild roster grouping + hide-offline toggle', () => {
  // The grouping + filter decisions are unit-tested in social_view.test.ts and the
  // persistence in guild_hide_offline.test.ts; here we pin that the thin painter
  // actually composes them: renders through the grouped core, localizes the count
  // headers, and wires the toggle to persist + refresh in place.
  it('renders the roster through the grouped pure core, gated on the persisted toggle', () => {
    expect(painter).toContain('guildRosterItems(g.rows, this.hideOffline)');
    // the toggle is seeded from the persisted choice on construction
    expect(painter).toContain('private hideOffline = loadGuildHideOffline();');
  });

  it('localizes the online/offline group headers with the formatted count', () => {
    expect(painter).toContain("'hudChrome.social.onlineHeader'");
    expect(painter).toContain("'hudChrome.social.offlineHeader'");
    expect(painter).toContain('formatNumber(item.count,');
  });

  it('flips + persists the choice from the delegated handler and refreshes in place', () => {
    expect(painter).toContain("node.dataset.act === 'toggle-hide-offline'");
    expect(painter).toContain('this.hideOffline = !this.hideOffline;');
    expect(painter).toContain('saveGuildHideOffline(this.hideOffline);');
    // refresh in place (no structural change), so the delegated body listener is not re-churned
    expect(painter).toContain('this.refreshList();');
  });

  it('restores keyboard focus to the re-rendered toggle after the innerHTML swap (WCAG focus)', () => {
    // refreshList() destroys the just-activated button, so focus must be put back on the
    // fresh toggle or repeated keyboard toggling would drop to the document body.
    expect(painter).toMatch(
      /querySelector\('\[data-act="toggle-hide-offline"\]'\)[\s\S]{0,80}\?\.focus\(\)/,
    );
  });
});

describe('social_window: Book of Deeds title spans (both roster surfaces)', () => {
  // The pure row model carries the deed ID (social_view.test.ts); these pins
  // hold the RENDER arm: each surface localizes through deedTitleText, hides
  // entirely on '' (untitled/stale, never an empty decorated span), and emits
  // the muted .soc-title INSIDE the ellipsized name cell. Deleting either
  // span emission, either hide guard, or the localization call reds here.
  it('friends rows localize the id, gate on it, and emit .soc-title inside the name', () => {
    expect(painter).toContain(
      "const titleText = f.activeTitle ? deedTitleText(f.activeTitle) : '';",
    );
    expect(painter).toContain(
      'const titleSpan = titleText ? `<span class="soc-title">${esc(titleText)}</span>` : \'\';',
    );
    expect(painter).toContain('${esc(f.name)}${titleSpan}');
  });

  it('guild rows localize the id, gate on it, and place the title AFTER the role chip', () => {
    expect(painter).toContain(
      "const memberTitle = m.activeTitle ? deedTitleText(m.activeTitle) : '';",
    );
    expect(painter).toContain('<span class="soc-title">${esc(memberTitle)}</span>');
    // name, then the ONE role chip, then title: a long title trims off the
    // tail and can never push the chip out of the ellipsized cell.
    expect(painter).toContain(
      '${esc(m.name)}<span class="rank">${esc(roleLabel(role))}</span>${memberTitleSpan}',
    );
  });
});

describe('social_window: guild displayed-role chip (source pins)', () => {
  // The role decision (rank passthrough + 7/30-day tenure thresholds) is
  // pure and unit-tested in social_view.test.ts; the behavioral render cases
  // live in the next describe. These pins hold the contracts a rendered
  // string cannot prove: the role comes from the pure core with ONE hoisted
  // clock read per rebuild (never a per-row date computation), every label is
  // a t() key, and every splice passes esc().
  it('derives the role from the pure core with one clock read per rebuild', () => {
    expect(painter).toContain('const now = Date.now();');
    expect(painter).toContain(
      'const role = guildDisplayedRole(m.rank, tenureTier(m.joinedAt, now));',
    );
    // The row builder itself must stay clock-free (the caller threads `now`),
    // so a per-row Date.now() cannot sneak back in behind the hoisted read.
    const rowBuilder = painter.slice(
      painter.indexOf('export function guildMemberRowHtml'),
      painter.indexOf('export class SocialWindow'),
    );
    expect(rowBuilder.length).toBeGreaterThan(0);
    expect(rowBuilder).not.toContain('Date.now()');
  });

  it('escapes the localized chip text into the ONE shared .rank chip (no tier class)', () => {
    // User call: all five role labels share the rank-chip treatment; the
    // label alone distinguishes the tiers. A soc-tenure-* class or a
    // role-derived class sneaking back in must fail here.
    expect(painter).toContain('<span class="rank">${esc(roleLabel(role))}</span>');
    expect(painter).not.toContain('soc-tenure');
  });

  it('localizes every role label through t() keys (tiers + ranks via rankLabel)', () => {
    expect(painter).toContain("t('hud.social.tenure.recruit')");
    expect(painter).toContain("t('hud.social.tenure.veteran')");
    expect(painter).toContain("t('hud.social.ranks.member')");
    expect(painter).toContain('return rankLabel(role);');
  });
});

describe('social_window: guild displayed-role chip (rendered rows)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  // Deliberately YEARS away from the real clock: an implementation that
  // ignored the `now` parameter and read Date.now() inside the row builder
  // would flip the recruit (3d) and member (15d) cases below to veteran.
  const NOW = Date.UTC(2021, 0, 1);
  const row = (over: Partial<GuildRow> = {}): GuildRow => ({
    name: 'Gorak',
    cls: 'warrior',
    level: 10,
    online: false,
    dot: 'off',
    status: undefined,
    zone: undefined,
    lastLogin: null,
    activeTitle: null,
    rank: 'member',
    self: false,
    canWhisper: false,
    canTransfer: false,
    canPromote: false,
    canDemote: false,
    canKick: false,
    joinedAt: null,
    ...over,
  });
  // EVERY role/rank/tenure chip in the row, in order. Exact-array asserts on
  // this are the regression teeth for the one-chip model: a tenure chip
  // reappearing beside a member rank chip (two entries) or an officer gaining
  // a tenure label (wrong entry) fails decisively.
  const chips = (html: string): string[] =>
    html.match(/<span class="rank[^"]*">[^<]*<\/span>/g) ?? [];

  it('renders ONE chip, the Recruit tier as the role, for a 3-day member', () => {
    const html = guildMemberRowHtml(row({ joinedAt: NOW - 3 * DAY }), NOW);
    expect(chips(html)).toEqual(['<span class="rank">Recruit</span>']);
    expect(html).not.toContain('>Member<');
  });

  it('renders ONE chip, the Veteran tier as the role, for a 200-day member', () => {
    const html = guildMemberRowHtml(row({ joinedAt: NOW - 200 * DAY }), NOW);
    expect(chips(html)).toEqual(['<span class="rank">Veteran</span>']);
    expect(html).not.toContain('>Member<');
  });

  it('renders the plain Member rank chip for a 15-day member (no tenure class)', () => {
    const html = guildMemberRowHtml(row({ joinedAt: NOW - 15 * DAY }), NOW);
    expect(chips(html)).toEqual(['<span class="rank">Member</span>']);
    expect(html).not.toContain('soc-tenure');
  });

  it('renders the plain Member rank chip when joinedAt is unknown', () => {
    const html = guildMemberRowHtml(row(), NOW);
    expect(chips(html)).toEqual(['<span class="rank">Member</span>']);
    expect(html).not.toContain('soc-tenure');
  });

  it('an officer keeps the rank label and NEVER gains a tenure label, at any tenure', () => {
    for (const joinedAt of [NOW - 3 * DAY, NOW - 200 * DAY, null]) {
      const html = guildMemberRowHtml(row({ rank: 'officer', joinedAt }), NOW);
      expect(chips(html)).toEqual(['<span class="rank">Officer</span>']);
      expect(html).not.toContain('soc-tenure');
    }
  });

  it('the leader keeps the rank label and NEVER gains a tenure label', () => {
    const html = guildMemberRowHtml(row({ rank: 'leader', joinedAt: NOW - 3 * DAY }), NOW);
    expect(chips(html)).toEqual(['<span class="rank">Guild Master</span>']);
    expect(html).not.toContain('soc-tenure');
  });

  it('escapes the member name around the chip', () => {
    const html = guildMemberRowHtml(row({ name: 'Bad<img src=x>', joinedAt: NOW - 3 * DAY }), NOW);
    expect(html).not.toContain('<img');
    expect(html).toContain('Bad&lt;img');
  });
});

describe('social_window: guild billboard', () => {
  // The billboard is player-controlled text on a phishing/XSS surface, so the
  // render arm is pinned: the message goes through esc() as plain text, never
  // through any linkifier or raw-HTML path (deliberate; do not "improve" it).
  it('renders the message + attribution through esc() only (plain escaped text)', () => {
    expect(painter).toContain('${esc(g.motd)}');
    const section = painter.slice(
      painter.indexOf('private billboardHtml'),
      // billboardHtml is the last method before raidHtml now that the roster
      // row builder is a module-level function (exported for behavior tests).
      painter.indexOf('private raidHtml'),
    );
    expect(section.length).toBeGreaterThan(0);
    expect(section).not.toContain('<a ');
    expect(section).not.toContain('innerHTML');
  });

  it('renders the edit row (input + save) only for editors, never a disabled duplicate', () => {
    // The message div is the read view; a member must not get a grayed-out
    // copy of it in an input. UX only: the server enforces the real rank gate.
    expect(painter).toContain('const edit = g.canEditMotd');
    expect(painter).toContain('data-act="gmotd-save"');
    expect(painter).not.toContain("' disabled'");
  });

  it('renders no billboard box at all for a member when no message is set', () => {
    // With no motd there is nothing to read; only editors keep the box (the
    // empty-state line + input) so the first message can be written.
    expect(painter).toContain("if (!g.motd && !g.canEditMotd) return '';");
  });

  it('names the input cap after the server clamp instead of a bare literal', () => {
    expect(painter).toContain('const GUILD_MOTD_MAX = 240;');
    expect(painter).toContain('maxlength="${GUILD_MOTD_MAX}"');
  });

  it('preserves an in-progress draft across the refreshList innerHTML swap', () => {
    // The panel repaints on the slow-HUD divider whenever any social/party
    // content changes; the draft capture keys off defaultValue (the motd
    // rendered at the last paint) so an untouched input takes server updates
    // while a touched or focused one survives the swap.
    expect(painter).toContain('prevMotd.value !== prevMotd.defaultValue');
    expect(painter).toContain('document.activeElement === prevMotd');
    expect(painter).toContain('next.setSelectionRange(draft.selStart, draft.selEnd)');
  });

  it('dispatches the save through the delegated body handlers (click + Enter), no per-row handler', () => {
    expect(painter).toContain("if (node.dataset.act === 'gmotd-save') {");
    expect(painter).toContain(`input[data-field="gmotd"]`);
    expect(painter).toContain('this.saveBillboard()');
  });

  it('the edit input joins the mobile 40px touch floor (with .soc-add input)', () => {
    // The mobile min-height/16px group in hud.mobile.css covers the footer
    // inputs; the billboard edit input lives in the body and must be listed
    // there too or it renders ~28px tall under coarse pointers.
    expect(mobileCss).toContain('body.mobile-touch .soc-billboard-edit input');
  });

  it('keeps the read-only billboard message selectable and non-actionable', () => {
    const messageRuleStart = componentsCss.indexOf('.soc-billboard-msg {');
    expect(messageRuleStart).toBeGreaterThan(-1);
    const messageRule = componentsCss.slice(
      messageRuleStart,
      componentsCss.indexOf('}', messageRuleStart),
    );
    expect(messageRule).toContain('user-select: text');
    expect(messageRule).toContain('-webkit-user-select: text');

    const section = painter.slice(
      painter.indexOf('private billboardHtml'),
      painter.indexOf('private raidHtml'),
    );
    expect(section.length).toBeGreaterThan(0);
    expect(section).toContain('<div class="soc-billboard-msg">$' + '{esc(g.motd)}</div>');
    expect(section).not.toContain('class="soc-billboard-msg" data-');
  });
});

describe('social_window: guild header copy', () => {
  it('renders the guild name without decorative angle brackets', () => {
    expect(painter).toContain('<div class="soc-guild-head">$' + '{esc(g.name)} <span class="gm">');
    expect(painter).not.toContain('&lt;$' + '{esc(g.name)}&gt;');
  });

  it('uses localized membership copy that avoids the broken rank article sentence', () => {
    expect(hudChromeCatalog).toContain("one: 'your guild rank is {rank}; {count} member'");
    expect(hudChromeCatalog).toContain("other: 'your guild rank is {rank}; {count} members'");
  });
});
