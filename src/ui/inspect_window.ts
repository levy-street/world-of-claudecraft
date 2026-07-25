// Thin DOM painter for the inspect ("Profile") window.
//
// The consumer half of the inspect module pair: it paints #inspect-window from
// the structured model the inspect_view.ts pure core builds, for BOTH the rich
// in-range card (compact header, identity-flair badges, a live class-colored
// turntable of the inspected player, and their worn 6/6 paperdoll) and the thin
// out-of-range remote-profile card (visually unchanged from before the
// extraction). It owns no Sim reference and reaches Hud only through injected
// deps (item icon/tooltip, the shared turntable mount). Like char_window it marks
// the root a focus-trapped dialog (markDialogRoot) and restores focus to the
// opener on close, closing the WCAG gap the old inline path had.
//
// The socket rows reuse the shared .equip-slot / .equip-col family and the same
// quality-glow helper as the character sheet; the paperdoll columns come from
// char_view's arrays via the pure core, so inspect inherits the sheet's 6/6 split.

import { ITEMS } from '../sim/data';
import type { EquipSlot, ItemInstancePayload, PlayerClass, SkinCatalog } from '../sim/types';
import { attachAvatarFallback } from './avatar_fallback';
import type { PaperdollSlot } from './char_view';
import { deedTitleText } from './deed_i18n';
import {
  devCardBadgeClass,
  devTierBadgeDataUrl,
  devTierByIndex,
  devTierDisplayName,
} from './dev_tier';
import { markDialogRoot } from './dialog_root';
import { discordRoleTagLabel } from './discord_role_tag';
import { discordStatusBadgeDataUrl, discordStatusDisplayName } from './discord_tier';
import { classDisplayName, itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import {
  holderCardBadgeClass,
  holderTierBadgeDataUrl,
  holderTierByIndex,
  holderTierDisplayName,
} from './holder_tier';
import { formatNumber, t } from './i18n';
import { iconDataUrl, QUALITY_COLOR } from './icons';
import {
  buildInspectRemoteView,
  buildInspectView,
  type InspectDevModel,
  type InspectDiscordModel,
  type InspectHolderModel,
} from './inspect_view';
import type { PainterHostPresentation } from './painter_host';
import { hydratePortraits, portraitChipHtml } from './portrait_chip';
import { qualityGlowShadow } from './quality_glow';
import { svgIcon } from './ui_icons';

/** The inspected entity fields the painter reads (a structural subset of the
 *  live EntityView / ClientWorld mirror; all already client-side). */
export interface InspectEntity {
  templateId: string;
  name: string;
  level: number;
  skin?: number;
  /** Which catalog `skin` indexes into (the wire `cat` identity field). */
  skinCatalog?: SkinCatalog;
  /** Active Book of Deeds title (a deed id), if any. */
  title?: string | null;
  equippedItems: Partial<Record<EquipSlot, string>>;
  equippedInstances: Partial<Record<EquipSlot, ItemInstancePayload>>;
  /** The server-resolved active Armory weapon skin (wire wsk), render-only. */
  weaponSkinId?: string | null;
  holderTier?: number;
  holderBalance?: number;
  discordTier?: number;
  discordName?: string;
  discordAvatar?: string;
  discordJoined?: number;
  discordRole?: string;
  devTier?: number;
  devMergedPrs?: number;
  githubLogin?: string;
}

/** The out-of-range remote-profile inputs (the public character sheet subset). */
export interface InspectRemoteProfile {
  name: string;
  level: number;
  cls: PlayerClass;
  skin: number;
  guild: string | null;
}

/** Hud-supplied glue. The presentation bag (icon/tooltip) plus world-free window
 *  concerns: focus capture/return, and the shared turntable mount (Hud owns the
 *  single WebGL preview lifecycle, so it re-parents the canvas into the stage). */
export interface InspectWindowDeps extends PainterHostPresentation {
  root(): HTMLElement;
  closeOthers(): void;
  hideTooltip(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  slotName(slot: EquipSlot): string;
  /** Viewer's showDevBadges display preference (dev flair is gated on it). */
  showDevBadges(): boolean;
  /** Mount the shared turntable of the inspected player into `container`, with the
   *  pulled-back inspect framing (Hud-owned preview lifecycle). */
  mountPreview(
    container: HTMLElement,
    params: {
      cls: PlayerClass;
      skin: number;
      skinCatalog: SkinCatalog;
      mainhand: string | null;
      weaponSkinId: string | null;
      offhand: string | null;
    },
  ): void;
}

export class InspectWindow {
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: InspectWindowDeps) {}

  private captureOpener(): void {
    // Capture the opener only on a fresh open, so open->reopen (e.g. switching
    // from a remote card to a rich card) does not lose the original opener.
    if (this.deps.root().style.display !== 'block') {
      this.openerFocus = this.deps.captureFocus();
    }
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'block') return;
    el.style.display = 'none';
    this.deps.hideTooltip();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  /** Rich in-range inspect: compact header, identity badges, live class-colored
   *  turntable, and the worn 6/6 paperdoll. */
  openInspect(e: InspectEntity, now: number): void {
    const cls = e.templateId as PlayerClass;
    const el = this.deps.root();
    this.captureOpener();
    this.deps.closeOthers();
    const model = buildInspectView(
      {
        name: e.name,
        level: e.level,
        cls,
        skin: e.skin ?? 0,
        skinCatalog: e.skinCatalog ?? 'class',
        deedTitleText: e.title ? deedTitleText(e.title) : '',
        equippedItems: e.equippedItems,
        holderTier: e.holderTier ?? 0,
        holderBalance: e.holderBalance ?? null,
        discordTier: e.discordTier ?? 0,
        discordName: e.discordName ?? null,
        discordAvatar: e.discordAvatar ?? null,
        discordJoined: e.discordJoined ?? null,
        discordRole: e.discordRole ?? null,
        devTier: e.devTier ?? 0,
        devMergedPrs: e.devMergedPrs ?? null,
        githubLogin: e.githubLogin ?? null,
        showDevBadges: this.deps.showDevBadges(),
        now,
      },
      ITEMS,
    );
    markDialogRoot(el, { labelledBy: 'inspect-window-title' });
    const { header } = model;
    const titleHtml = header.deedTitle
      ? `<div class="inspect-title">${esc(header.deedTitle)}</div>`
      : '';
    el.innerHTML =
      this.panelTitleHtml() +
      `<div class="inspect-card">` +
      `<div class="inspect-name">${esc(header.name)}</div>` +
      titleHtml +
      `<div class="inspect-meta">${esc(
        t('itemUi.equipment.levelClass', {
          level: formatNumber(header.level, { maximumFractionDigits: 0 }),
          className: classDisplayName(cls),
        }),
      )}</div>` +
      this.holderHtml(model.badges.holder) +
      this.discordHtml(model.badges.discord) +
      this.devHtml(model.badges.dev) +
      `</div>` +
      // The class-colored model stage, delivered as a CSS custom property so the
      // stylesheet paints the border / glow / haze in the inspected player's hue.
      `<div class="inspect-equip">` +
      `<div class="inspect-equip-title">${esc(t('classDetails.sections.equipment'))}</div>` +
      `<div class="paperdoll inspect-paperdoll">` +
      `<div class="equip-col" id="inspect-equip-left"></div>` +
      `<div class="char-model-panel inspect-model-panel" style="--inspect-class-color:${header.classColor}">` +
      `<div id="inspect-model-preview" class="char-model-preview" role="img" aria-label="${esc(t('hudChrome.character.modelPreview'))}"></div>` +
      `</div>` +
      `<div class="equip-col equip-col-right" id="inspect-equip-right"></div>` +
      `</div></div>`;
    hydratePortraits(el);
    // Degrade a failed Discord avatar to the plain status badge (never the browser's
    // broken-image placeholder), exactly as the old inline card did.
    const inspectPfp = el.querySelector<HTMLImageElement>('.inspect-discord-pfp');
    if (inspectPfp) {
      attachAvatarFallback(inspectPfp, (img) => {
        img.classList.remove('inspect-discord-pfp');
        img.src = discordStatusBadgeDataUrl(e.discordTier ?? 0);
      });
    }
    const leftCol = el.querySelector('#inspect-equip-left');
    const rightCol = el.querySelector('#inspect-equip-right');
    for (const cell of model.gear.left)
      leftCol?.appendChild(this.buildSlotRow(cell, e.equippedInstances[cell.slot]));
    for (const cell of model.gear.right)
      rightCol?.appendChild(this.buildSlotRow(cell, e.equippedInstances[cell.slot]));
    const stage = el.querySelector<HTMLElement>('#inspect-model-preview');
    if (stage) {
      this.deps.mountPreview(stage, {
        cls,
        skin: model.skin,
        skinCatalog: model.skinCatalog,
        mainhand: e.equippedItems.mainhand ?? null,
        offhand: e.equippedItems.offhand ?? null,
        weaponSkinId: e.weaponSkinId ?? null,
      });
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    el.style.display = 'block';
  }

  /** The out-of-range remote-profile card: visually unchanged (portrait chip,
   *  name, level/class, optional guild), now behind the same focus trap. */
  openRemote(profile: InspectRemoteProfile): void {
    const el = this.deps.root();
    this.captureOpener();
    this.deps.closeOthers();
    const model = buildInspectRemoteView(profile);
    markDialogRoot(el, { labelledBy: 'inspect-window-title' });
    const guildHtml = model.guild ? `<div class="inspect-meta">${esc(model.guild)}</div>` : '';
    el.innerHTML =
      this.panelTitleHtml() +
      `<div class="inspect-card inspect-card-remote">` +
      portraitChipHtml({ cls: model.cls, skin: profile.skin, name: model.name, variant: 'lg' }) +
      `<div class="inspect-name">${esc(model.name)}</div>` +
      `<div class="inspect-meta">${esc(
        t('itemUi.equipment.levelClass', {
          level: formatNumber(model.level, { maximumFractionDigits: 0 }),
          className: classDisplayName(model.cls),
        }),
      )}</div>` +
      guildHtml +
      `</div>`;
    hydratePortraits(el);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    el.style.display = 'block';
  }

  private panelTitleHtml(): string {
    return (
      `<div class="panel-title"><span id="inspect-window-title">${esc(t('character.profile'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('character.closeProfile'))}">${svgIcon('close')}</button></div>`
    );
  }

  // One read-only equipment row for the inspect window: icon, slot name, and the
  // equipped item (quality-tinted, quality-glow socket) with its tooltip. No
  // unequip / drag affordances (another player's gear is view-only).
  private buildSlotRow(cell: PaperdollSlot, instance?: ItemInstancePayload): HTMLElement {
    const { slot, item } = cell;
    const row = document.createElement('div');
    row.className = 'equip-slot';
    const qColor = item ? (QUALITY_COLOR[item.quality ?? 'common'] ?? '') : '';
    const icon = item
      ? this.deps.itemIcon(item)
      : `<img class="item-icon" src="${iconDataUrl('item', 'slot_empty')}" alt="" draggable="false">`;
    row.innerHTML = `${icon}<div><div class="slot-name">${esc(this.deps.slotName(slot))}</div><div class="slot-item"${item ? ` style="color:${qColor}"` : ''}>${item ? esc(itemDisplayName(item)) : esc(t('itemUi.equipment.empty'))}</div></div>`;
    if (item) {
      const iconEl = row.querySelector<HTMLImageElement>('.item-icon');
      if (iconEl) iconEl.style.boxShadow = qualityGlowShadow(qColor);
      this.deps.attachTooltip(row, () => this.deps.itemTooltip(item, instance));
    }
    return row;
  }

  private holderHtml(holder: InspectHolderModel | null): string {
    if (!holder) return '';
    const tierDef = holderTierByIndex(holder.tierIndex);
    if (!tierDef) return '';
    const sub =
      holder.balance !== null
        ? esc(
            t('wallet.balanceAmount', {
              amount: formatNumber(holder.balance, { maximumFractionDigits: 0 }),
            }),
          )
        : esc(t('wallet.holder'));
    return (
      `<div class="inspect-holder">` +
      `<img class="${holderCardBadgeClass(tierDef)}" style="--holder-glow:${tierDef.glow}" src="${holderTierBadgeDataUrl(tierDef)}" alt="" draggable="false">` +
      `<div class="inspect-holder-text">` +
      `<div class="inspect-holder-name">${esc(holderTierDisplayName(tierDef))}</div>` +
      `<div class="inspect-holder-sub">${sub}</div>` +
      `</div></div>`
    );
  }

  private discordHtml(discord: InspectDiscordModel | null): string {
    if (!discord) return '';
    const img = discord.avatar
      ? `<img class="inspect-holder-badge inspect-discord-pfp" src="${esc(discord.avatar)}" referrerpolicy="no-referrer" alt="" draggable="false">`
      : `<img class="inspect-holder-badge" src="${discordStatusBadgeDataUrl(discord.tierIndex)}" alt="" draggable="false">`;
    const memberSinceHtml =
      discord.memberDays !== null
        ? `<div class="inspect-holder-sub">${esc(t('hudChrome.discord.memberSince'))}: ${esc(t('hudChrome.discord.memberSinceDays', { days: formatNumber(discord.memberDays, { maximumFractionDigits: 0 }) }))}</div>`
        : '';
    const roleLabel = discordRoleTagLabel(discord.role);
    const roleHtml = roleLabel
      ? `<div class="inspect-holder-sub inspect-discord-role">${esc(roleLabel)}</div>`
      : '';
    return (
      `<div class="inspect-holder">` +
      img +
      `<div class="inspect-holder-text">` +
      `<div class="inspect-holder-name">${esc(discord.name ? discord.name : discordStatusDisplayName(discord.tierIndex))}</div>` +
      `<div class="inspect-holder-sub">${esc(t('hudChrome.discord.title'))} · ${esc(discordStatusDisplayName(discord.tierIndex))}</div>` +
      memberSinceHtml +
      roleHtml +
      `</div></div>`
    );
  }

  private devHtml(dev: InspectDevModel | null): string {
    if (!dev) return '';
    const devTierDef = devTierByIndex(dev.tierIndex);
    if (!devTierDef) return '';
    const devSub = dev.mergedPrs
      ? t('hudChrome.devBadge.prsLanded', {
          count: formatNumber(dev.mergedPrs, { maximumFractionDigits: 0 }),
        })
      : t('hudChrome.devBadge.contributor');
    const devLoginHtml = dev.githubLogin
      ? `<div class="inspect-holder-sub inspect-dev-login">@${esc(dev.githubLogin)}</div>`
      : '';
    return (
      `<div class="inspect-holder">` +
      `<img class="${devCardBadgeClass(devTierDef)}" style="--dev-glow:${devTierDef.glow}" src="${devTierBadgeDataUrl(devTierDef)}" alt="" draggable="false">` +
      `<div class="inspect-holder-text">` +
      `<div class="inspect-holder-name">${esc(devTierDisplayName(devTierDef))}</div>` +
      `<div class="inspect-holder-sub">${esc(devSub)}</div>` +
      devLoginHtml +
      `</div></div>`
    );
  }
}
