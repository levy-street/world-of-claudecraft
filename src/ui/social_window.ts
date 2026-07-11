// Social panel painter: owns the #social-window DOM + the window-local state
// (current tab, the split structural/content signatures, the inline notice, the
// username typeahead). It reads socialInfo / partyInfo / realm from IWorld and
// dispatches every friend/guild/raid command through IWorld; the cross-window
// chrome (whisper, confirm prompts, close-others, focus return) comes through the
// injected deps. The pure row + signature decisions live in social_view.ts; this
// is the thin DOM consumer per the unit_portrait / talents_window template.
//
// Chrome comes from the shared window-frame builder (window_frame.ts): a titlebar
// with a close control, the friends/guild/ignore/raid modes on the frame's TAB
// RAIL, and a scrollable body holding the per-tab list + notice + add-row footer.
// Like the vendor / options windows the frame mounts on an INNER container
// (ensureFrame), so the shared #social-window root stays a pristine .window.panel.
// Visibility is STILL the '.open' CLASS on #social-window (not style.display),
// matching the window-manager (closeManagedWindow / topmostOpenWindow read '.open').
//
// LISTENER CHURN (social is NOT purely cold): the panel repaints on the
// slow-HUD divider (refreshIfChanged), so re-attaching a click handler to every
// row each tick would churn handlers. Instead the row actions use ONE delegated
// click listener on the persistent `.soc-body` container, wired once per full
// render; a content refresh only swaps the body's innerHTML, so no per-row handler
// is re-attached. The frame chrome (close + tab rail) is stamped cold once and
// reused; the footer/typeahead re-wire on a full render and survive a content refresh.
//
// No raw hex / magic numbers: the status dots are CSS-classed (no
// color literal here) and the two typeahead timings are named constants.

import { CLASSES } from '../sim/data';
import type { PlayerClass } from '../sim/types';
import type { IWorld } from '../world_api';
import { classDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatDateTime, formatNumber, t, tPlural } from './i18n';
import { rovingTarget } from './roving_index';
import { localizeZone } from './server_i18n';
import {
  friendRows,
  guildView,
  ignoreRows,
  raidView,
  type SocialTab,
  socialStructSig,
} from './social_view';
import { svgIcon } from './ui_icons';
import { renderWindowFrame, type WindowFrameParts } from './window_frame';
import type { WindowFrameDescriptor } from './window_frame_view';

// Typeahead timings (named, not bare literals): debounce a keystroke
// before searching, and clear the suggestion list shortly after blur so a pending
// mousedown on a suggestion can still fire first.
const SUGGEST_DEBOUNCE_MS = 160;
const SUGGEST_BLUR_CLEAR_MS = 150;

// A closable frame whose four modes ride the shared TAB RAIL (friends / guild /
// ignore / raid); the per-tab list + notice + add-row footer render into the
// scrolling body. Every key is reused from the existing social catalog (the close
// aria reuses hud.options.returnToGame, byte-faithful to the pre-frame window).
const SOCIAL_FRAME: WindowFrameDescriptor = {
  id: 'social-window',
  titleKey: 'hud.social.title',
  closeLabelKey: 'hud.options.returnToGame',
  tabs: [
    { id: 'friends', labelKey: 'hud.social.friendsTab' },
    { id: 'guild', labelKey: 'hud.social.guildTab' },
    { id: 'ignore', labelKey: 'hud.social.ignoreTab' },
    { id: 'raid', labelKey: 'hud.social.raidTab' },
  ],
};

/**
 * Hud-supplied glue. The social window renders no item rows (it uses CSS-classed
 * status dots and title= hovers, not the floating item tooltip), so it composes no
 * PainterHostPresentation bag; it just reads/commands IWorld and routes the shared
 * HUD chrome (whisper, confirm prompt, close-others, focus return) through these
 * closures. The module never reaches into Hud directly.
 */
export interface SocialWindowDeps {
  /** The #social-window root (Hud owns the id; the painter stays instance-parameterized). */
  root(): HTMLElement;
  /** The live world (offline Sim or online ClientWorld mirror). */
  world(): IWorld;
  /** Close the other managed windows when this one opens. */
  closeOthers(): void;
  hideTooltip(): void;
  // Focus management (WCAG 2.2 AA): capture the opener on open, restore it on close.
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** The shared confirm prompt (guild leave / disband / transfer). */
  showPrompt(text: string, acceptLabel: string, onAccept: () => void, onDecline: () => void): void;
  /** Open the chat bar pre-filled with a whisper to this player. */
  startWhisper(name: string): void;
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function playerClassDisplayName(value: string): string {
  const cls = value as PlayerClass;
  return CLASSES[cls] ? classDisplayName(cls) : cap(value);
}

function statusLabel(status: string | undefined): string {
  switch (status) {
    case 'combat':
      return t('hud.social.status.combat');
    case 'dungeon':
      return t('hud.social.status.dungeon');
    case 'dead':
      return t('hud.social.status.dead');
    default:
      return t('hud.social.status.online');
  }
}

// Hover text spelling out what a status dot means, so the orange/grey circles
// aren't a mystery (issue 100).
function dotTitle(online: boolean, status: string | undefined, zone: string | undefined): string {
  if (!online) return t('hud.social.status.offline');
  const label = statusLabel(status);
  return zone ? t('hud.social.statusWithZone', { status: label, zone: localizeZone(zone) }) : label;
}

function rankLabel(rank: string): string {
  return rank === 'leader'
    ? t('hud.social.ranks.leader')
    : rank === 'officer'
      ? t('hud.social.ranks.officer')
      : t('hud.social.ranks.member');
}

export class SocialWindow {
  private tab: SocialTab = 'friends';
  // split signatures: structural changes (tab, guild membership, raid roster)
  // rebuild the whole panel; content-only changes (a friend's presence) refresh
  // just the list, so an open typeahead / half-typed name survives a snapshot
  private lastStruct = '';
  private lastContent = '';
  private notice: { text: string; error: boolean } | null = null;
  private suggestTimer: number | undefined;
  private suggest: {
    field: string;
    items: { name: string; cls: string; level: number }[];
    index: number;
  } = { field: '', items: [], index: -1 };
  // The element to refocus when the window closes (WCAG 2.2 AA focus return).
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly deps: SocialWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().classList.contains('open');
  }

  toggle(): void {
    const el = this.deps.root();
    if (el.classList.contains('open')) {
      this.close();
      return;
    }
    this.returnFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    el.classList.add('open');
    this.notice = null;
    this.lastStruct = this.structSig();
    this.lastContent = this.contentSig();
    this.render();
  }

  // Close path (toggle close + the window-manager's closeManagedWindow case): drop
  // the '.open' class + tooltip and return focus to the opener (WCAG 2.2 AA).
  close(): void {
    const el = this.deps.root();
    el.classList.remove('open');
    this.deps.hideTooltip();
    const target = this.returnFocus;
    this.returnFocus = null;
    this.deps.restoreFocus(target);
  }

  // The context-menu "convert to raid/party" path: switch to the raid tab (so the
  // next open shows it) and re-render the panel if it is currently open.
  selectRaidTab(): void {
    this.tab = 'raid';
    if (this.isOpen) this.render();
  }

  // Called each slow-HUD frame by the update loop: full rebuild on a structural
  // change, else an in-place list refresh on a content change.
  refreshIfChanged(): void {
    if (!this.isOpen) return;
    const struct = this.structSig();
    if (struct !== this.lastStruct) {
      this.lastStruct = struct;
      this.lastContent = this.contentSig();
      this.render();
    } else {
      const content = this.contentSig();
      if (content !== this.lastContent) {
        this.lastContent = content;
        this.refreshList();
      }
    }
  }

  private structSig(): string {
    const w = this.deps.world();
    return socialStructSig(this.tab, w.socialInfo, w.partyInfo);
  }

  private contentSig(): string {
    const w = this.deps.world();
    return JSON.stringify({ social: w.socialInfo, party: w.partyInfo });
  }

  // Stamp the shared window frame cold at first open, then reuse it. The frame
  // mounts on an inner container so the #social-window root stays a pristine
  // .window.panel; an intact mounted frame (its body present) is the reuse marker.
  // The tab-rail roving handler is wired once, at cold-mount time.
  private ensureFrame(): WindowFrameParts {
    const el = this.deps.root();
    const mounted = el.querySelector<HTMLElement>(':scope > .window-frame');
    const body = mounted?.querySelector<HTMLElement>('.window-body');
    if (mounted && body) {
      return {
        root: mounted,
        body,
        footer: mounted.querySelector<HTMLElement>('.window-footer'),
        tabButtons: Array.from(mounted.querySelectorAll<HTMLButtonElement>('[data-window-tab]')),
      };
    }
    const mount = document.createElement('div');
    const parts = renderWindowFrame(
      mount,
      SOCIAL_FRAME,
      { onClose: () => this.close(), onTabChange: (id) => this.onTabChange(id) },
      this.tab,
    );
    el.replaceChildren(mount);
    this.wireTabRoving(parts.tabButtons);
    return parts;
  }

  // A frame tab-rail click (or a roving keyboard move that clicks it) lands here:
  // the frame builder already re-pointed aria-selected / the body panel id, so this
  // just commits the tab and repaints. Mirrors the pre-frame switchTab.
  private onTabChange(tabId: string): void {
    this.tab = tabId as SocialTab;
    this.notice = null;
    this.lastStruct = this.structSig();
    this.render();
  }

  // Roving Arrow/Home/End across the frame's tab rail (the builder wires click +
  // aria; it does NOT wire keyboard). A roving move clicks the target so the
  // builder's own aria/panel update + onTabChange fire, then follows focus.
  private wireTabRoving(tabButtons: HTMLButtonElement[]): void {
    tabButtons.forEach((tab, i) => {
      tab.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const next = rovingTarget(ke.key, i, tabButtons.length, 'horizontal');
        if (next !== null) {
          ke.preventDefault();
          const target = tabButtons[next];
          if (target && target !== tab) {
            target.click();
            target.focus();
          }
          return;
        }
        if (ke.key === 'Enter' || ke.key === ' ') {
          ke.preventDefault();
          tab.click();
          tab.focus();
        }
      });
    });
  }

  // Sync the tab rail's aria-selected + roving tabindex + the body's panel id to
  // this.tab. Covers the open / reopen / programmatic (selectRaidTab, convert)
  // paths the frame's own click handler does not; a click-driven switch already
  // matches, so this is idempotent there.
  private syncTabState(tabButtons: HTMLButtonElement[], body: HTMLElement): void {
    for (const b of tabButtons) {
      const sel = b.dataset.windowTab === this.tab;
      b.setAttribute('aria-selected', String(sel));
      b.tabIndex = sel ? 0 : -1;
      if (sel) {
        const panelId = b.getAttribute('aria-controls');
        if (panelId) body.id = panelId;
      }
    }
  }

  // Full rebuild: title/realm, body list, notice, and the tab's add-row footer
  // (with its typeahead). Used on open, tab switch, and guild-membership changes.
  private render(): void {
    const el = this.deps.root();
    if (!el.classList.contains('open')) return;
    const { root: frame, body, tabButtons } = this.ensureFrame();
    this.syncTabState(tabButtons, body);
    const w = this.deps.world();
    const tab = this.tab;
    const online = w.socialInfo !== null;
    const realmTag =
      online && w.realm ? ` <span class="soc-realm-tag">- ${esc(w.realm)}</span>` : '';
    // The frame builder resolves the title key WITHOUT interpolation; the social
    // title carries the realm tag, so paint it here onto the frame's title.
    const titleEl = frame.querySelector<HTMLElement>('.window-title');
    if (titleEl) titleEl.innerHTML = `${esc(t('hud.social.title'))}${realmTag}`;
    // The per-tab list + notice + add-row footer render into the frame body (the
    // active tab's tabpanel). The old inline soc-tabs strip is gone (the frame rail
    // replaces it); .soc-body keeps its class (refreshList queries it) but no longer
    // needs its own id/role, which the frame's .window-body tabpanel now carries.
    body.innerHTML =
      `<div class="soc-body"></div>` +
      `<div class="soc-notice"></div>` +
      (tab === 'raid' ? '' : online ? this.footer() : '');
    this.wireFooterAndSuggest(el);
    // Delegate every row action to ONE listener on the persistent body, so a
    // content refresh (innerHTML swap) never re-attaches per-row handlers.
    const socBody = el.querySelector('.soc-body') as HTMLElement | null;
    if (socBody) socBody.addEventListener('click', (e) => this.onBodyClick(e));
    this.refreshList();
    this.renderNotice();
  }

  // Lighter refresh: just the list inside the current tab, leaving the footer
  // (and any half-typed name / open suggestions) untouched. No re-wiring: the
  // delegated body listener wired in render() keeps working across the swap.
  private refreshList(): void {
    const body = this.deps.root().querySelector('.soc-body') as HTMLElement | null;
    if (!body) return;
    const online = this.deps.world().socialInfo !== null;
    body.innerHTML =
      this.tab === 'raid'
        ? this.raidHtml()
        : !online
          ? `<div class="soc-empty">${esc(t('hud.social.offlineEmpty'))}</div>`
          : this.tab === 'friends'
            ? this.friendsHtml()
            : this.tab === 'guild'
              ? this.guildHtml()
              : this.ignoreHtml();
  }

  // The single delegated row handler (click + whisper). Resolves the nearest
  // actionable ancestor so a click on an icon inside a button still dispatches.
  private onBodyClick(e: Event): void {
    const node = (e.target as HTMLElement).closest(
      '[data-act],[data-whisper]',
    ) as HTMLElement | null;
    if (!node) return;
    if (node.dataset.whisper !== undefined) {
      this.deps.startWhisper(node.dataset.whisper ?? '');
      return;
    }
    const w = this.deps.world();
    const act = node.dataset.act;
    const name = node.dataset.name ?? '';
    if (act === 'unfriend') w.friendRemove(name);
    else if (act === 'unblock') w.blockRemove(name);
    else if (act === 'gkick') w.guildKick(name);
    else if (act === 'promote') w.guildPromote(name);
    else if (act === 'demote') w.guildDemote(name);
    else if (act === 'gtransfer')
      this.deps.showPrompt(
        t('hud.social.transferPrompt', { name: `<b>${esc(name)}</b>` }),
        t('hud.social.transferConfirm'),
        () => w.guildTransfer(name),
        () => {
          /* keep */
        },
      );
    else if (act === 'raid-move') {
      const pid = Number(node.dataset.pid);
      const group = Number(node.dataset.group);
      if (Number.isFinite(pid) && (group === 1 || group === 2)) w.moveRaidMember(pid, group);
    } else if (act === 'convert-raid') {
      w.convertPartyToRaid();
      this.tab = 'raid';
      this.render();
    } else if (act === 'convert-party') {
      w.convertRaidToParty();
      this.tab = 'raid';
      this.render();
    }
  }

  private friendsHtml(): string {
    const rows = friendRows(this.deps.world().socialInfo);
    if (rows.length === 0)
      return `<div class="soc-empty">${esc(t('hud.social.friendsEmpty'))}</div>`;
    return rows
      .map((f) => {
        const meta = f.online
          ? `<span class="zone">${esc(f.zone ? localizeZone(f.zone) : '')}</span><br>${esc(statusLabel(f.status))}`
          : esc(t('hud.social.status.offline'));
        const name = f.online
          ? `<button type="button" class="soc-name soc-link" data-whisper="${esc(f.name)}" title="${esc(t('hud.social.whisperTitle', { name: f.name }))}">${esc(f.name)}</button>`
          : `<span class="soc-name">${esc(f.name)}</span>`;
        const whisper = f.online
          ? `<button type="button" class="soc-x" data-whisper="${esc(f.name)}" title="${esc(t('hud.social.whisperTitle', { name: f.name }))}">${svgIcon('whisper')}</button>`
          : '';
        const tip = esc(dotTitle(f.online, f.status, f.zone));
        return (
          `<div class="soc-row">` +
          `<span class="soc-dot ${f.dot === 'off' ? '' : f.dot}" title="${tip}"></span>` +
          `<span class="soc-id">${name}<span class="soc-sub">${esc(t('hud.social.levelClass', { level: formatNumber(f.level, { maximumFractionDigits: 0 }), className: playerClassDisplayName(f.cls) }))}</span></span>` +
          `<span class="soc-meta" title="${tip}">${meta}</span>` +
          `<span class="soc-actions">${whisper}<button type="button" class="soc-x" data-act="unfriend" data-name="${esc(f.name)}" title="${esc(t('hud.social.removeFriendTitle', { name: f.name }))}">${svgIcon('close')}</button></span>` +
          `</div>`
        );
      })
      .join('');
  }

  private ignoreHtml(): string {
    const rows = ignoreRows(this.deps.world().socialInfo);
    if (rows.length === 0)
      return `<div class="soc-empty">${esc(t('hud.social.ignoreEmpty'))}</div>`;
    return rows
      .map(
        (b) =>
          `<div class="soc-row">` +
          `<span class="soc-name">${esc(b.name)}</span>` +
          `<span class="soc-actions" style="margin-left:auto"><button type="button" class="soc-x" data-act="unblock" data-name="${esc(b.name)}" title="${esc(t('hud.social.stopIgnoringTitle', { name: b.name }))}">${svgIcon('close')}</button></span>` +
          `</div>`,
      )
      .join('');
  }

  private guildHtml(): string {
    const w = this.deps.world();
    const view = guildView(w.socialInfo, w.player.name);
    if (!view.guild) return `<div class="soc-empty">${esc(t('hud.social.noGuild'))}</div>`;
    const g = view.guild;
    const guildCount = formatNumber(g.memberCount, { maximumFractionDigits: 0 });
    const head = `<div class="soc-guild-head">&lt;${esc(g.name)}&gt; <span class="gm">${esc(tPlural('hudChrome.plurals.guildMembers', g.memberCount, { rank: rankLabel(g.rank), count: guildCount }))}</span></div>`;
    const rows = g.rows
      .map((m) => {
        // Offline rows carry a "last seen" line: a locale-formatted date/time,
        // or the localized "never" when no login has been recorded.
        const lastSeenWhen = m.lastLogin
          ? formatDateTime(new Date(m.lastLogin), { dateStyle: 'medium', timeStyle: 'short' })
          : t('hudChrome.social.lastSeenNever');
        const meta = m.online
          ? `<span class="zone">${esc(m.zone ? localizeZone(m.zone) : '')}</span><br>${esc(statusLabel(m.status))}`
          : `${esc(t('hud.social.status.offline'))}<br>${esc(t('hudChrome.social.lastSeen', { when: lastSeenWhen }))}`;
        const nameInner = `${esc(m.name)}<span class="rank">${esc(rankLabel(m.rank))}</span>`;
        const name =
          m.online && !m.self
            ? `<button type="button" class="soc-name soc-link" data-whisper="${esc(m.name)}" title="${esc(t('hud.social.whisperTitle', { name: m.name }))}">${nameInner}</button>`
            : `<span class="soc-name">${nameInner}</span>`;
        let actions = m.canWhisper
          ? `<button type="button" class="soc-x" data-whisper="${esc(m.name)}" title="${esc(t('hud.social.whisperTitle', { name: m.name }))}">${svgIcon('whisper')}</button>`
          : '';
        if (m.canTransfer)
          actions += `<button type="button" class="soc-x" data-act="gtransfer" data-name="${esc(m.name)}" title="${esc(t('hud.social.makeGuildMasterTitle', { name: m.name }))}">${svgIcon('crown')}</button>`;
        if (m.canPromote)
          actions += `<button type="button" class="soc-x" data-act="promote" data-name="${esc(m.name)}" title="${esc(t('hud.social.promoteTitle', { name: m.name }))}">▲</button>`;
        if (m.canDemote)
          actions += `<button type="button" class="soc-x" data-act="demote" data-name="${esc(m.name)}" title="${esc(t('hud.social.demoteTitle', { name: m.name }))}">▼</button>`;
        if (m.canKick)
          actions += `<button type="button" class="soc-x" data-act="gkick" data-name="${esc(m.name)}" title="${esc(t('hud.social.removeGuildTitle', { name: m.name }))}">${svgIcon('close')}</button>`;
        const tip = esc(dotTitle(m.online, m.status, m.zone));
        return (
          `<div class="soc-row">` +
          `<span class="soc-dot ${m.dot === 'off' ? '' : m.dot}" title="${tip}"></span>` +
          `<span class="soc-id">${name}<span class="soc-sub">${esc(t('hud.social.levelClass', { level: formatNumber(m.level, { maximumFractionDigits: 0 }), className: playerClassDisplayName(m.cls) }))}</span></span>` +
          `<span class="soc-meta" title="${tip}">${meta}</span>` +
          (actions ? `<span class="soc-actions">${actions}</span>` : '') +
          `</div>`
        );
      })
      .join('');
    return head + rows;
  }

  private raidHtml(): string {
    const w = this.deps.world();
    const view = raidView(w.partyInfo, w.playerId);
    if (!view.raid) {
      return `<div class="soc-empty">${esc(t('hud.social.raidEmpty'))}${view.canConvert ? `<div class="soc-empty-action"><button type="button" class="soc-x" data-act="convert-raid">${esc(t('hud.chat.context.convertToRaid'))}</button></div>` : ''}</div>`;
    }
    const groupHtml = (grp: NonNullable<typeof view.groups>[number]): string => {
      const rows =
        grp.members
          .map((m) => {
            const move =
              m.moveTo !== null
                ? `<button type="button" class="soc-x" data-act="raid-move" data-pid="${m.pid}" data-group="${m.moveTo}" title="${esc(t('hud.social.raidMoveToGroup', { group: formatNumber(m.moveTo, { maximumFractionDigits: 0 }) }))}">${esc(formatNumber(m.moveTo, { maximumFractionDigits: 0 }))}</button>`
                : '';
            return (
              `<div class="soc-row raid-row">` +
              `<span class="soc-id"><span class="soc-name">${esc(m.name)}${m.isLead ? `<span class="rank">${esc(t('hud.social.raidLeader'))}</span>` : ''}</span><span class="soc-sub">${esc(t('hud.social.levelClass', { level: formatNumber(m.level, { maximumFractionDigits: 0 }), className: playerClassDisplayName(m.cls) }))}</span></span>` +
              `<span class="soc-meta">${esc(formatNumber(m.hpPct, { maximumFractionDigits: 0 }))}%</span>` +
              (move ? `<span class="soc-actions">${move}</span>` : '') +
              `</div>`
            );
          })
          .join('') || `<div class="soc-empty">${esc(t('hud.social.raidGroupEmpty'))}</div>`;
      return `<div class="raid-group"><div class="soc-guild-head">${esc(t('hud.social.raidGroupTitle', { position: formatNumber(grp.group, { maximumFractionDigits: 0 }), count: formatNumber(grp.count, { maximumFractionDigits: 0 }) }))}</div>${rows}</div>`;
    };
    if (!view.groups) return '';
    const [g1, g2] = view.groups;
    const footer = view.canUnconvert
      ? `<div class="soc-empty-action"><button type="button" class="soc-x" data-act="convert-party">${esc(t('hud.chat.context.convertToParty'))}</button></div>`
      : '';
    return `<div class="raid-groups">${groupHtml(g1)}${groupHtml(g2)}</div>${footer}`;
  }

  // The add/action row changes with the tab (and guild membership). Inputs
  // tagged data-suggest get the username typeahead.
  private footer(): string {
    if (this.tab === 'friends')
      return this.addRow(
        'friend',
        'friend-add',
        t('hud.social.friendSearchPlaceholder'),
        t('hud.social.add'),
        16,
        true,
      );
    if (this.tab === 'ignore')
      return this.addRow(
        'ignore',
        'block-add',
        t('hud.social.ignoreSearchPlaceholder'),
        t('hud.social.ignoreAction'),
        16,
        true,
      );
    const guild = this.deps.world().socialInfo?.guild ?? null;
    if (!guild)
      return this.addRow(
        'gname',
        'guild-create',
        t('hud.social.guildNamePlaceholder'),
        t('hud.social.found'),
        24,
        false,
      );
    let foot = '';
    if (guild.rank !== 'member')
      foot += this.addRow(
        'ginvite',
        'guild-invite',
        t('hud.social.guildInvitePlaceholder'),
        t('hud.social.invite'),
        16,
        true,
      );
    // classic MMOs: a Guild Master with other members can't just leave (they disband,
    // or hand over leadership via the crown action). Everyone else can leave.
    foot +=
      guild.rank === 'leader' && guild.members.length > 1
        ? `<div class="soc-add soc-leave"><button class="btn" data-act="guild-disband">${esc(t('hud.social.disbandGuild'))}</button></div>`
        : `<div class="soc-add soc-leave"><button class="btn" data-act="guild-leave">${esc(t('hud.social.leaveGuild'))}</button></div>`;
    return foot;
  }

  private addRow(
    field: string,
    act: string,
    placeholder: string,
    label: string,
    maxlen: number,
    suggest: boolean,
  ): string {
    // The typeahead is an ARIA 1.2 combobox: the input owns the .soc-suggest listbox
    // via aria-controls, toggles aria-expanded as suggestions appear, and points
    // aria-activedescendant at the highlighted option as the arrow keys move.
    const listId = `soc-suggest-${field}`;
    return (
      `<div class="soc-add">` +
      (suggest
        ? `<div class="soc-suggest" id="${listId}" data-for="${field}" role="listbox"></div>`
        : '') +
      `<input maxlength="${maxlen}" aria-label="${esc(placeholder)}" placeholder="${esc(placeholder)}" data-field="${field}"${suggest ? ` data-suggest="1" role="combobox" aria-autocomplete="list" aria-controls="${listId}" aria-expanded="false"` : ''} autocomplete="off" spellcheck="false"/>` +
      `<button class="btn" data-act="${act}">${esc(label)}</button></div>`
    );
  }

  /** The typeahead input for a field, for combobox aria state (expanded / activedescendant). */
  private suggestInput(field: string): HTMLInputElement | null {
    return this.deps
      .root()
      .querySelector(`input[data-field="${field}"]`) as HTMLInputElement | null;
  }

  // Wire the per-tab add-row footer + typeahead (re-attached on every full render;
  // the close control and tab rail are the frame's, wired once at cold-mount time).
  private wireFooterAndSuggest(el: HTMLElement): void {
    const w = this.deps.world();
    const field = (sel: string): string =>
      (el.querySelector(`input[data-field="${sel}"]`) as HTMLInputElement | null)?.value.trim() ??
      '';
    const submit = (act: string | undefined): void => {
      if (act === 'friend-add') void this.resolveAndAct('friend', field('friend'));
      else if (act === 'block-add') void this.resolveAndAct('ignore', field('ignore'));
      else if (act === 'guild-invite') void this.resolveAndAct('ginvite', field('ginvite'));
      else if (act === 'guild-create') {
        const n = field('gname');
        if (n) {
          w.guildCreate(n);
          this.clearInput('gname');
        }
      } else if (act === 'guild-leave')
        this.deps.showPrompt(
          esc(t('hud.social.leavePrompt')),
          t('hud.social.leaveGuild'),
          () => w.guildLeave(),
          () => {},
        );
      else if (act === 'guild-disband')
        this.deps.showPrompt(
          esc(t('hud.social.disbandPrompt')),
          t('hud.social.disbandConfirm'),
          () => w.guildDisband(),
          () => {
            /* keep */
          },
        );
    };
    el.querySelectorAll('.soc-add .btn').forEach((b) => {
      b.addEventListener('click', () => submit((b as HTMLElement).dataset.act));
    });
    // Enter-to-submit only for plain inputs (the guild name). Search inputs get
    // richer keyboard handling (arrows + Enter to pick a suggestion) below.
    el.querySelectorAll('.soc-add input:not([data-suggest])').forEach((inp) => {
      inp.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key !== 'Enter') return;
        submit((inp.parentElement?.querySelector('.btn') as HTMLElement | null)?.dataset.act);
      });
    });
    this.wireSuggest(el);
  }

  private suggestKind(field: string): 'friend' | 'ignore' | 'ginvite' {
    return field === 'friend' ? 'friend' : field === 'ignore' ? 'ignore' : 'ginvite';
  }

  // Username typeahead: debounced search against same-realm characters, with
  // arrow-key navigation and Enter to pick the highlighted name.
  private wireSuggest(el: HTMLElement): void {
    el.querySelectorAll('input[data-suggest]').forEach((node) => {
      const input = node as HTMLInputElement;
      const field = input.dataset.field ?? '';
      input.addEventListener('input', () => {
        const q = input.value.trim();
        window.clearTimeout(this.suggestTimer);
        if (!q) {
          this.renderSuggest(field, []);
          return;
        }
        this.suggestTimer = window.setTimeout(async () => {
          const results = await this.deps.world().searchCharacters(q);
          this.renderSuggest(
            field,
            results.filter((r) => r.name !== this.deps.world().player.name).slice(0, 8),
          );
        }, SUGGEST_DEBOUNCE_MS);
      });
      input.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const open = this.suggest.field === field && this.suggest.items.length > 0;
        if (ke.key === 'ArrowDown' && open) {
          ke.preventDefault();
          this.moveSuggest(field, 1);
        } else if (ke.key === 'ArrowUp' && open) {
          ke.preventDefault();
          this.moveSuggest(field, -1);
        } else if (ke.key === 'Escape' && open) {
          ke.preventDefault();
          this.renderSuggest(field, []);
        } else if (ke.key === 'Enter') {
          ke.preventDefault();
          const picked =
            open && this.suggest.index >= 0
              ? this.suggest.items[this.suggest.index].name
              : input.value;
          void this.resolveAndAct(this.suggestKind(field), picked);
        }
      });
      // let a suggestion's mousedown fire before blur clears the list
      input.addEventListener('blur', () =>
        window.setTimeout(() => this.renderSuggest(field, []), SUGGEST_BLUR_CLEAR_MS),
      );
    });
  }

  private renderSuggest(
    field: string,
    results: { name: string; cls: string; level: number }[],
  ): void {
    const box = this.deps
      .root()
      .querySelector(`.soc-suggest[data-for="${field}"]`) as HTMLElement | null;
    if (!box) return;
    this.suggest = { field, items: results, index: -1 };
    const input = this.suggestInput(field);
    if (results.length === 0) {
      box.style.display = 'none';
      box.innerHTML = '';
      input?.setAttribute('aria-expanded', 'false');
      input?.removeAttribute('aria-activedescendant');
      return;
    }
    const kind = this.suggestKind(field);
    box.innerHTML = results
      .map((r, i) => {
        const meta = t('hud.social.levelClass', {
          level: formatNumber(r.level, { maximumFractionDigits: 0 }),
          className: playerClassDisplayName(r.cls),
        });
        // A non-focusable <div role=option>, not a <button>: in an
        // aria-activedescendant combobox the DOM focus stays on the input while the
        // arrow keys move the active option, so the options must NOT be in the tab
        // order (a focusable button would also be pulled into the window's focus-trap
        // cycle). Mirrors the .ui-dd-item listbox; the mousedown/mousemove handlers
        // below key off .soc-sugg-item, so a div keeps them working.
        return `<div id="soc-sugg-${field}-${i}" class="soc-sugg-item" data-i="${i}" data-name="${esc(r.name)}" role="option" aria-selected="false"><span class="soc-name">${esc(r.name)}</span><span class="soc-meta">${esc(meta)}</span></div>`;
      })
      .join('');
    box.style.display = 'block';
    input?.setAttribute('aria-expanded', 'true');
    input?.removeAttribute('aria-activedescendant');
    box.querySelectorAll('.soc-sugg-item').forEach((it) => {
      it.addEventListener('mousedown', (e) => {
        e.preventDefault();
        void this.resolveAndAct(kind, (it as HTMLElement).dataset.name ?? '');
      });
      it.addEventListener('mousemove', () => {
        this.suggest.index = Number((it as HTMLElement).dataset.i);
        this.highlightSuggest(field);
      });
    });
  }

  private moveSuggest(field: string, delta: number): void {
    const n = this.suggest.items.length;
    if (n === 0) return;
    // start at the top when nothing is highlighted yet, then wrap
    this.suggest.index =
      this.suggest.index < 0 ? (delta > 0 ? 0 : n - 1) : (this.suggest.index + delta + n) % n;
    this.highlightSuggest(field);
  }

  private highlightSuggest(field: string): void {
    const box = this.deps
      .root()
      .querySelector(`.soc-suggest[data-for="${field}"]`) as HTMLElement | null;
    if (!box) return;
    box.querySelectorAll('.soc-sugg-item').forEach((it) => {
      const on = Number((it as HTMLElement).dataset.i) === this.suggest.index;
      it.classList.toggle('active', on);
      it.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) (it as HTMLElement).scrollIntoView({ block: 'nearest' });
    });
    const input = this.suggestInput(field);
    if (this.suggest.index >= 0)
      input?.setAttribute('aria-activedescendant', `soc-sugg-${field}-${this.suggest.index}`);
    else input?.removeAttribute('aria-activedescendant');
  }

  // Authoritative existence check (realm-scoped) before acting, so we can give
  // clear inline "no such player" feedback instead of a silent failure.
  private async resolveAndAct(
    kind: 'friend' | 'ignore' | 'ginvite',
    rawName: string,
  ): Promise<void> {
    const name = rawName.trim();
    if (!name) return;
    const w = this.deps.world();
    const results = await w.searchCharacters(name);
    const exact = results.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (!exact) {
      this.setNotice(
        t('hud.social.noPlayerNamed', {
          name,
          realm: w.realm || t('hud.social.currentRealm'),
        }),
        true,
      );
      return;
    }
    if (exact.name === w.player.name) {
      this.setNotice(t('hud.social.selfNotice'), true);
      return;
    }
    if (kind === 'friend') {
      w.friendAdd(exact.name);
      this.setNotice(t('hud.social.friendAdded', { name: exact.name }), false);
      this.clearInput('friend');
    } else if (kind === 'ignore') {
      w.blockAdd(exact.name);
      this.setNotice(t('hud.social.nowIgnoring', { name: exact.name }), false);
      this.clearInput('ignore');
    } else {
      w.guildInvite(exact.name);
      this.setNotice(t('hud.social.guildInvited', { name: exact.name }), false);
      this.clearInput('ginvite');
    }
    this.renderSuggest(kind, []);
  }

  private clearInput(field: string): void {
    const inp = this.deps
      .root()
      .querySelector(`input[data-field="${field}"]`) as HTMLInputElement | null;
    if (inp) inp.value = '';
  }

  private setNotice(text: string, error: boolean): void {
    this.notice = { text, error };
    this.renderNotice();
  }

  private renderNotice(): void {
    const box = this.deps.root().querySelector('.soc-notice') as HTMLElement | null;
    if (!box) return;
    if (!this.notice) {
      box.style.display = 'none';
      box.textContent = '';
      return;
    }
    box.textContent = this.notice.text;
    box.className = `soc-notice${this.notice.error ? ' err' : ' ok'}`;
    box.style.display = 'block';
  }
}
