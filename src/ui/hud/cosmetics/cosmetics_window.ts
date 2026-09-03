// The Cosmetics window painter: a cold window on the shared shell where a
// player manages what the account owns and what this character wears (mount
// skins, Season 1 Armory weapon skins, the Combat Mech chromas). Every read
// and every change crosses the IWorld seam; the painter owns no optimistic
// state of its own (both worlds mutate synchronously and the identity wire
// reconciles). The card decisions live in cosmetics_view.ts (pure), the
// markup in cosmetics_cards_view.ts; this file is the DOM lifecycle the
// sibling cold windows (social, reliquary) share: open/close with WCAG focus
// return, a delegated body listener, the shared WAI-ARIA tab strip, and a
// signature-gated refresh for the slow HUD band.

import { audio } from '../../../game/audio';
import { skinnableWeaponTypesFor } from '../../../sim/content/weapon_skin_rules';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { esc } from '../../esc';
import { t } from '../../i18n';
import { focusActiveTab, wireTabStrip } from '../../tab_strip_painter';
import { tabStripHtml } from '../../tab_strip_view';
import { svgIcon } from '../../ui_icons';
import {
  type CosmeticsAction,
  cosmeticsActionFrom,
  cosmeticsPanelHtml,
} from './cosmetics_cards_view';
import {
  type CosmeticsSnapshot,
  type CosmeticsTab,
  cosmeticsSig,
  cosmeticsTabStrip,
  isCosmeticsTab,
} from './cosmetics_view';

export interface CosmeticsWindowDeps {
  /** The #cosmetics-window root (Hud owns the id; the painter stays instance-parameterized). */
  root(): HTMLElement;
  /** The live world (offline Sim or online ClientWorld mirror). */
  world(): IWorld;
  /** Close the other managed windows when this one opens. */
  closeOthers(): void;
  hideTooltip(): void;
  // Focus management (WCAG 2.2 AA): capture the opener on open, restore it on close.
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

const TAB_CLASS = 'cos-tab';
const SELECTED_CLASS = 'on';

export class CosmeticsWindow {
  private tab: CosmeticsTab = 'mounts';
  private lastSig = '';
  // The element to refocus when the window closes (WCAG 2.2 AA focus return).
  private returnFocus: HTMLElement | null = null;
  private wired = false;

  constructor(private readonly deps: CosmeticsWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().classList.contains('open');
  }

  open(tab?: CosmeticsTab): void {
    if (tab) this.tab = tab;
    if (this.isOpen) {
      this.render();
      return;
    }
    this.returnFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    this.deps.root().classList.add('open');
    this.render();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
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

  /** Slow-HUD band + the account-cosmetics push: repaint only when an input moved. */
  refreshIfChanged(): void {
    if (!this.isOpen) return;
    const sig = cosmeticsSig(this.snapshot());
    if (sig === this.lastSig) return;
    this.render();
  }

  /** A language switch repaints the open window (every label is a t() key). */
  relocalize(): void {
    if (this.isOpen) this.render();
  }

  private snapshot(): CosmeticsSnapshot {
    const w = this.deps.world();
    const p = w.player;
    const c = w.accountCosmetics;
    return {
      tab: this.tab,
      ownedMountSkins: c.mountSkinIds,
      wornMountSkin: p?.mountSkinId ?? null,
      ownsAnyMount: w.ownedMounts().length > 0,
      weaponSkinIds: c.weaponSkinIds,
      weaponSkinLoadout: c.weaponSkinLoadout,
      applicableWeaponTypes: p
        ? skinnableWeaponTypesFor(p.templateId, p.mainhandItemId, p.skinCatalog ?? 'class')
        : [],
      mechChromaIds: c.mechChromaIds,
      wornMech: { catalog: p?.skinCatalog ?? 'class', skin: p?.skin ?? 0 },
    };
  }

  // Full rebuild: title, tabs, legend, and the selected tab's panel. Used on
  // open, tab switch, every action, and a changed snapshot.
  private render(focusTab = false): void {
    const el = this.deps.root();
    if (!el.classList.contains('open')) return;
    // WCAG 2.2 AA: name the focus-trapped root so AT users entering the trap
    // land on a labeled dialog (the sibling cold windows all set this).
    markDialogRoot(el, { label: t('hudChrome.cosmetics.title') });
    const s = this.snapshot();
    this.lastSig = cosmeticsSig(s);
    const strip = cosmeticsTabStrip(
      this.tab,
      {
        mounts: t('hudChrome.cosmetics.tabMounts'),
        skins: t('hudChrome.cosmetics.tabSkins'),
        mech: t('hudChrome.cosmetics.tabMech'),
      },
      t('hudChrome.cosmetics.tabsLabel'),
    );
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('hudChrome.cosmetics.title'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.cosmetics.close'))}">${svgIcon('close')}</button></div>` +
      `<p class="cos-legend">${esc(t('hudChrome.cosmetics.legend'))}</p>` +
      tabStripHtml(strip) +
      `<div class="cos-body" id="cosmetics-panel" role="tabpanel">${cosmeticsPanelHtml(s)}</div>`;
    wireTabStrip(el, TAB_CLASS, (id, focusFollow) => this.selectTab(id, focusFollow));
    if (focusTab) focusActiveTab(el, TAB_CLASS, SELECTED_CLASS);
    this.wire(el);
  }

  private selectTab(id: string, focusFollow: boolean): void {
    if (!isCosmeticsTab(id) || id === this.tab) return;
    this.tab = id;
    audio.click();
    this.render(focusFollow);
  }

  // One delegated listener on the root (bound once; the root element is
  // persistent while its innerHTML is rebuilt on every render).
  private wire(el: HTMLElement): void {
    if (this.wired) return;
    this.wired = true;
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-close]')) {
        this.close();
        return;
      }
      const button = target.closest<HTMLElement>('.cos-action');
      if (!button || button.hasAttribute('disabled')) return;
      const action = cosmeticsActionFrom(button.dataset);
      if (!action) return;
      this.apply(action);
    });
  }

  private apply(action: CosmeticsAction): void {
    const w = this.deps.world();
    switch (action.kind) {
      case 'wear-mount':
        w.changeMountSkin(action.id);
        break;
      case 'takeoff-mount':
        w.changeMountSkin(null);
        break;
      case 'apply-skin':
        w.changeWeaponSkin(action.id);
        break;
      case 'detach-skin':
        w.changeWeaponSkin(null, action.weaponType);
        break;
      case 'wear-mech':
        w.changeSkin(action.index, 'mech');
        break;
      case 'takeoff-mech':
        w.unequipMechChroma(action.id);
        break;
    }
    audio.click();
    this.render();
  }
}
