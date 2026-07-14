// Thin DOM consumer for the Discord HUD window (#discord-window).
//
// Mirrors src/ui/vendor_window.ts: it imports t/esc/svgIcon + the formatters and
// the pure tier presentation directly, but takes Hud's shared painters
// (attachTooltip/hideTooltip) and the action callbacks via an injected `deps`
// object. It owns no state and never imports Hud. The branching logic lives in
// the pure view (discord_widget_view.ts); this just paints + wires clicks.

import { attachAvatarFallback } from './avatar_fallback';
import type {
  DiscordAccountStatus,
  DiscordPresenceState,
  DiscordVoiceMember,
} from './discord_status';
import {
  DISCORD_STATUS_TIERS,
  discordStatusBadgeDataUrl,
  discordStatusDisplayName,
} from './discord_tier';
import { buildDiscordWidgetView, type DiscordTierRow } from './discord_widget_view';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

export interface DiscordWidgetDeps {
  attachTooltip: (el: HTMLElement, html: () => string) => void;
  hideTooltip: () => void;
  onLink: () => void;
  onUnlink: () => void;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}

function voiceMemberHtml(m: DiscordVoiceMember): string {
  const dot = m.speaking ? 'is-speaking' : m.selfMute ? 'is-muted' : '';
  const state = m.speaking
    ? t('hudChrome.discord.voice.speaking')
    : m.selfMute
      ? t('hudChrome.discord.voice.muted')
      : '';
  return (
    `<li class="dc-voice-row">` +
    `<span class="dc-voice-dot ${dot}" aria-hidden="true"></span>` +
    `<span class="dc-voice-name">${esc(m.name || '...')}</span>` +
    (state ? `<span class="dc-voice-state">${esc(state)}</span>` : '') +
    `</li>`
  );
}

// One rung of the status-tier ladder: its accent-colored badge, localized name,
// the lifetime-points threshold, and a Current/Locked state chip.
function tierRowHtml(row: DiscordTierRow): string {
  const accent = DISCORD_STATUS_TIERS[row.index - 1];
  const ring = accent ? accent.ring : '#888';
  const name = discordStatusDisplayName(row.index);
  const badge = discordStatusBadgeDataUrl(row.index, 40);
  const state = row.current
    ? `<span class="dc-tier-chip is-current">${esc(t('hudChrome.discord.tierCurrent'))}</span>`
    : row.reached
      ? ''
      : `<span class="dc-tier-chip is-locked">${esc(t('hudChrome.discord.tierLocked'))}</span>`;
  // Requirement line is the lifetime-points threshold (e.g. "2,000 pts").
  const reqText =
    row.threshold > 0
      ? t('hudChrome.discord.swag.cost', { points: formatNumber(row.threshold) })
      : '';
  return (
    `<li class="dc-tier-row${row.current ? ' is-current' : ''}${row.reached ? ' is-reached' : ' is-locked'}" style="--dc-tier:${ring}">` +
    `<img class="dc-tier-badge" src="${badge}" alt="" draggable="false" />` +
    `<span class="dc-tier-name">${esc(name)}</span>` +
    `<span class="dc-tier-req">${esc(reqText)}</span>` +
    state +
    `</li>`
  );
}

export function renderDiscordWidget(
  el: HTMLElement,
  input: {
    enabled: boolean;
    status: DiscordAccountStatus;
    presence: DiscordPresenceState;
    inviteUrl: string;
    characterName?: string | null;
  },
  deps: DiscordWidgetDeps,
): void {
  const view = buildDiscordWidgetView({ ...input, origin: location.origin });
  const header =
    `<div class="panel-title"><span>${esc(t('hudChrome.discord.panelTitle'))}</span>` +
    `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.discord.close'))}">${svgIcon('close')}</button></div>`;

  let account = '';
  if (view.mode === 'unlinked') {
    // The Discord (U) panel is the game HUD's single Discord entry point (the
    // corner community tray's separate invite link was removed as a
    // duplicate), so an unlinked player still gets a one-click plain "join
    // the server" path alongside the account-linking CTA.
    account =
      `<div class="dc-link-cta">` +
      `<p class="dc-benefits">${esc(t('hudChrome.discord.link.benefits'))}</p>` +
      `<button type="button" class="dc-btn dc-btn-primary" data-action="link">${esc(t('hudChrome.discord.link.cta'))}</button>` +
      `<button type="button" class="dc-btn dc-btn-ghost" data-action="join-server">${esc(t('hudChrome.discord.link.joinServer'))}</button>` +
      `</div>`;
  } else if (view.mode === 'linked') {
    const tierName = discordStatusDisplayName(view.tierIndex);
    const tierBadge = discordStatusBadgeDataUrl(view.tierIndex);
    const progress =
      view.pointsToNext === null
        ? esc(t('hudChrome.discord.maxRank'))
        : esc(t('hudChrome.discord.toNext', { points: formatNumber(view.pointsToNext) }));
    const member = view.guildMember
      ? `<span class="dc-member-ok">${esc(t('hudChrome.discord.guildMember'))}</span>`
      : `<span class="dc-member-no">${esc(t('hudChrome.discord.notMember'))}</span>`;
    // Discord profile picture with the status-rank badge as a corner overlay; fall
    // back to just the rank badge when the Discord account has no custom avatar.
    const avatarHtml = view.avatar
      ? `<div class="dc-avatar-wrap"><img class="dc-pfp" src="${esc(view.avatar)}" alt="" referrerpolicy="no-referrer" />` +
        `<img class="dc-tier-corner" src="${esc(tierBadge)}" alt="" aria-hidden="true" /></div>`
      : `<img class="dc-tier-badge" src="${esc(tierBadge)}" alt="" aria-hidden="true" />`;
    account =
      `<div class="dc-account">` +
      avatarHtml +
      `<div class="dc-account-info">` +
      `<div class="dc-account-name">${esc(t('hudChrome.discord.linkedAs', { name: view.username ?? '' }))}</div>` +
      `<div class="dc-tier-name">${esc(tierName)}</div>` +
      `<div class="dc-member-line">${member}</div>` +
      `</div>` +
      `<button type="button" class="dc-btn dc-visit" data-action="visit" title="${esc(t('hudChrome.discord.visit'))}" aria-label="${esc(t('hudChrome.discord.visit'))}">` +
      `<svg viewBox="0 0 127.14 96.36" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15zM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69z"/></svg>` +
      `</button>` +
      `<button type="button" class="dc-btn dc-btn-ghost dc-unlink" data-action="unlink">${esc(t('hudChrome.discord.unlink'))}</button>` +
      `</div>` +
      `<div class="dc-stats">` +
      `<span class="dc-stat"><b>${esc(formatNumber(view.points))}</b> ${esc(t('hudChrome.discord.points'))}</span>` +
      `<span class="dc-stat-sep">·</span>` +
      `<span class="dc-stat-progress">${progress}</span>` +
      `</div>` +
      (view.showJoinCta
        ? `<button type="button" class="dc-btn dc-btn-primary dc-join" data-action="join">${esc(t('hudChrome.discord.joinCta'))}</button>`
        : '');
  }

  const ladder =
    view.mode === 'linked' && view.tiers.length
      ? `<section class="dc-section dc-tiers"><h3 class="dc-h3">${esc(t('hudChrome.discord.tiersTitle'))}</h3>` +
        `<ul class="dc-tier-ladder">${view.tiers.map(tierRowHtml).join('')}</ul>` +
        `<p class="dc-earn"><b>${esc(t('hudChrome.discord.earnTitle'))}:</b> ${esc(t('hudChrome.discord.earnBody'))}</p>` +
        `</section>`
      : '';

  const voiceMembers = view.voice.length
    ? `<ul class="dc-voice-list">${view.voice.map(voiceMemberHtml).join('')}</ul>`
    : `<p class="dc-voice-empty">${esc(t('hudChrome.discord.voice.empty'))}</p>`;
  const voiceHead = view.voiceChannelName
    ? esc(t('hudChrome.discord.voice.channel', { channel: view.voiceChannelName }))
    : esc(t('hudChrome.discord.voice.title'));
  const community =
    `<section class="dc-section dc-community">` +
    `<h3 class="dc-h3">${esc(t('hudChrome.discord.community'))} <span class="dc-online">${esc(t('hudChrome.discord.online', { count: formatNumber(view.onlineCount) }))}</span></h3>` +
    `<div class="dc-voice"><div class="dc-voice-head">${voiceHead}</div>${voiceMembers}</div>` +
    `</section>`;

  el.innerHTML = `${header}<div class="dc-body">${account}${ladder}${community}</div>`;

  // If the linked Discord avatar fails to load from the CDN, degrade to exactly the
  // no-avatar rendering (a single clean tier badge, replacing the pfp + corner-badge
  // wrap) instead of the browser's broken-image placeholder.
  if (view.mode === 'linked') {
    const wrap = el.querySelector<HTMLElement>('.dc-avatar-wrap');
    const pfp = wrap?.querySelector<HTMLImageElement>('.dc-pfp');
    if (wrap && pfp) {
      const tierIndex = view.tierIndex;
      attachAvatarFallback(pfp, () => {
        wrap.outerHTML = `<img class="dc-tier-badge" src="${esc(discordStatusBadgeDataUrl(tierIndex))}" alt="" aria-hidden="true" />`;
      });
    }
  }

  // ── wire clicks ────────────────────────────────────────────────────────────
  el.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.querySelector<HTMLElement>('[data-action="link"]')?.addEventListener('click', () =>
    deps.onLink(),
  );
  el.querySelector<HTMLElement>('[data-action="unlink"]')?.addEventListener('click', () =>
    deps.onUnlink(),
  );
  el.querySelector<HTMLElement>('[data-action="visit"]')?.addEventListener('click', () =>
    deps.onOpenUrl(input.inviteUrl),
  );
  el.querySelector<HTMLElement>('[data-action="join"]')?.addEventListener('click', () =>
    deps.onOpenUrl(input.inviteUrl),
  );
  el.querySelector<HTMLElement>('[data-action="join-server"]')?.addEventListener('click', () =>
    deps.onOpenUrl(input.inviteUrl),
  );
}
