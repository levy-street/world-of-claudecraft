// Cold DOM adapter for the Adventure Journal (#adventure-journal-window): the
// one encounter browser for every five-player dungeon and raid. The catalog
// (journal_catalog.ts) lists the instances and their journal sources, the
// navigation core (journal_nav_view.ts) decides the list, the landing page
// and the neighbours, the loot core (journal_loot_view.ts) reads the real
// drops, and journal_page_html.ts builds the markup. This class owns only the
// browsing state, the events, the tooltips and the focus.
//
// Cold window (src/ui/hud/CLAUDE.md): it rebuilds on open, on an interaction,
// on relocalize(), and when the run it shows changes while it is open
// (syncRun, polled from the party-frames tick behind an identity check of the
// reference-stable IWorld.dungeonRun / IWorld.raidRun and the room id, so an
// unchanged tick does nothing at all).

import { audio } from '../../../game/audio';
import type { LinkedProgramTouchQueue } from '../../../render/linked_program_touch_lane';
import { dungeonAt, ITEMS } from '../../../sim/data';
import type { DungeonDifficulty, ItemDef } from '../../../sim/types';
import type { DungeonRunView, RaidLockout, RaidRunView } from '../../../world_api/dungeons';
import { journalModelFor } from '../../boss_journal/journal_model_spec';
import type { JournalBossView } from '../../boss_journal/journal_view';
import { markDialogRoot } from '../../dialog_root';
import { captureFocusKey, FOCUS_KEY_ATTR, restoreFirstEnabled } from '../../focus_restore';
import { t } from '../../i18n';
import type { PainterHostPresentation } from '../../painter_host';
import { RaidBossGuideModelController } from '../../raid_boss_guide_model_controller';
import { bindRaidBossGuideScroll } from '../../raid_boss_guide_scroll';
import { rovingTarget } from '../../roving_index';
import { focusActiveTab, wireTabStrip } from '../../tab_strip_painter';
import { journalBackdropUrl } from './journal_backdrop_view';
import {
  type JournalInstance,
  type JournalTier,
  journalEntryForMob,
  journalInstance,
  journalInstanceForRoom,
  journalPageBodies,
  journalRoomBoss,
  visibleJournalInstances,
} from './journal_catalog';
import { bindJournalLaunchers, type JournalLauncherWorld } from './journal_launchers';
import { journalLoot } from './journal_loot_view';
import {
  adjacentJournalBoss,
  buildJournalNav,
  JOURNAL_TABS,
  type JournalProgress,
  type JournalTab,
  journalClampTier,
  journalLandingBoss,
  journalPageState,
  journalRunTier,
  journalTierDifficulty,
} from './journal_nav_view';
import {
  abilitiesHtml,
  bannerHtml,
  comingSoonHtml,
  frameCornersHtml,
  headHtml,
  lootHtml,
  mechanicTooltipHtml,
  mobileTopHtml,
  navHtml,
  overviewHtml,
  pageName,
  SECTION_TAB_ACTIVE,
  SECTION_TAB_CLASS,
  tabBarHtml,
} from './journal_page_html';
import { progressHtml, savedChipHtml } from './journal_progress_html';
import { journalPageProgress, journalSavedPages } from './journal_progress_view';

export interface AdventureJournalDeps
  extends Pick<PainterHostPresentation, 'itemIcon' | 'itemTooltip' | 'attachTooltip'> {
  root(): HTMLElement;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  hideTooltip(): void;
  /** The reference-stable run reads (IWorld.dungeonRun, IWorld.raidRun) and
   *  the local player's position (which instance room it stands in). */
  world(): JournalWorld;
  /** Whether a dev-gated instance may be listed (the client offers dev tools). */
  showUnreleased(): boolean;
  modelTouchQueue?(): LinkedProgramTouchQueue | null;
  /** The journal's sounds (the game's sampled UI cues by default, played like
   *  the other window cues, bag open and click, so the SFX volume applies). */
  sounds?: JournalSounds;
}

/** The two cues the journal plays: a page turn when it opens, a soft click
 *  on a section tab or a difficulty change. */
export interface JournalSounds {
  pageTurn(): void;
  click(): void;
}

export interface JournalWorld extends JournalLauncherWorld {
  readonly dungeonRun: DungeonRunView | null;
  readonly raidRun: RaidRunView | null;
  /** The character's lifetime boss kills (IWorld.bossKills), reference-stable. */
  readonly bossKills: Readonly<Record<string, number>>;
  /** The still-running lockouts (IWorld.raidLockouts), read once per render. */
  raidLockouts(): RaidLockout[];
  readonly player: JournalLauncherWorld['player'] & { readonly pos: { readonly x: number } };
}

interface Selection {
  instanceId: string;
  bossKey: string;
}

export class AdventureJournalWindow {
  private selection: Selection | null = null;
  private tier: JournalTier = 'normal';
  private tab: JournalTab = 'abilities';
  private expandedMechanic: string | null = null;
  private readonly closedPhases = new Set<string>();
  private readonly expanded = new Set<string>();
  /** The phone drawer holding the navigation list is open. */
  private navOpen = false;
  private openerFocus: HTMLElement | null = null;
  /** The room and runs the last render read: an unchanged tick does nothing. */
  private seenRoom: string | null | undefined = undefined;
  private seenDungeonRun: DungeonRunView | null = null;
  private seenRaidRun: RaidRunView | null = null;
  private seenBossKills: Readonly<Record<string, number>> | null = null;
  /** Banner pictures held decoded once seen, so the innerHTML repaint of a
   *  tab, a tier or a pull finds them in memory and never blanks a frame. */
  private readonly heldBackdrops = new Map<string, HTMLImageElement>();
  /** The page the last render painted (instance:boss), for the scroll pair. */
  private renderedPage: string | null = null;

  constructor(
    private readonly deps: AdventureJournalDeps,
    private readonly doc: Document = document,
    private readonly modelController: RaidBossGuideModelController = new RaidBossGuideModelController(
      doc,
      undefined,
      undefined,
      undefined,
      deps.modelTouchQueue,
    ),
  ) {
    bindJournalLaunchers(doc, this, () => deps.world());
  }

  /** Where focus returns when the opener is gone: the launcher the player
   *  can see (the side rail's button, or the phone's More tray). */
  private contextFallback(): HTMLElement | null {
    const mobile = this.doc.body?.classList.contains('mobile-touch') ?? false;
    return this.doc.getElementById(mobile ? 'mobile-more' : 'mm-journal');
  }

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  /** The instance room the local player stands in, or null. */
  private room(): string | null {
    return dungeonAt(this.deps.world().player.pos.x)?.id ?? null;
  }

  private visible(): JournalInstance[] {
    return visibleJournalInstances(
      this.deps.showUnreleased(),
      journalInstanceForRoom(this.room())?.id ?? null,
    );
  }

  /** The run the player stands in, as the navigation core reads it. */
  private progress(): JournalProgress | null {
    const world = this.deps.world();
    return world.raidRun ?? world.dungeonRun ?? null;
  }

  /** Whether a mob has a page the player may open (the target frame's book).
   *  Read per frame while a target is held, so it allocates nothing: a map
   *  lookup, and for a dev-gated instance the gate and the room check. */
  covers(mobId: string): boolean {
    const entry = journalEntryForMob(mobId);
    if (!entry) return false;
    const instance = journalInstance(entry.instanceId);
    if (!instance) return false;
    if (instance.released || this.deps.showUnreleased()) return true;
    return journalInstanceForRoom(this.room())?.id === instance.id;
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.openLanding();
  }

  /** Open where the player is: the room's instance on its engaged boss, else
   *  its next boss standing, on the run's difficulty. Outside an instance the
   *  page the player last read stays (the first dungeon's first boss at first). */
  openLanding(): void {
    const instance = journalInstanceForRoom(this.room());
    if (instance && this.visible().some((entry) => entry.id === instance.id)) {
      const progress = this.progress();
      const bossKey = journalLandingBoss(instance, progress, journalRoomBoss(this.room()));
      this.select(instance, bossKey, journalRunTier(instance, progress));
    } else if (!this.selection) {
      const first = this.visible()[0];
      if (!first) return;
      this.select(first, first.source.bossKeys[0], null);
    }
    this.show();
  }

  /** Open one instance's page (the Dungeon Finder, the target frame). False
   *  when the instance has no journal or that boss no page. */
  openJournal(dungeonId: string, bossMobId?: string, difficulty?: DungeonDifficulty): boolean {
    const instance = journalInstanceForRoom(dungeonId);
    // A dev-gated instance opens only where the list would show it.
    if (!instance || !this.visible().some((entry) => entry.id === instance.id)) return false;
    const bossKey =
      instance.source.bossKeys.find(
        (key) => !bossMobId || journalPageBodies(instance.source, key).includes(bossMobId),
      ) ?? instance.source.bossKeys[0];
    this.select(instance, bossKey, difficulty ?? null);
    if (this.isOpen) this.render(`boss:${instance.id}:${bossKey}`);
    else this.show();
    return true;
  }

  /** Open straight on a mob's page (the book beside the target frame). */
  openForMob(mobId: string): boolean {
    const entry = journalEntryForMob(mobId);
    if (!entry || !this.covers(mobId)) return false;
    const instance = journalInstance(entry.instanceId);
    if (!instance) return false;
    const progress = this.progress();
    this.select(instance, entry.bossKey, journalRunTier(instance, progress));
    if (this.isOpen) this.render(`boss:${instance.id}:${entry.bossKey}`);
    else this.show();
    return true;
  }

  private select(instance: JournalInstance, bossKey: string, tier: JournalTier | null): void {
    const changed =
      this.selection?.instanceId !== instance.id || this.selection.bossKey !== bossKey;
    this.selection = { instanceId: instance.id, bossKey };
    if (tier) this.tier = tier;
    this.tier = journalClampTier(instance, this.tier);
    // An accordion: landing on a page opens its instance and folds the rest,
    // so the selected boss is always in view in the list.
    if (changed) this.expanded.clear();
    this.expanded.add(instance.id);
    if (changed) {
      this.expandedMechanic = null;
      this.closedPhases.clear();
    }
  }

  private get sounds(): JournalSounds {
    return this.deps.sounds ?? audio;
  }

  private show(): void {
    this.sounds.pageTurn();
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus() ?? this.contextFallback();
    const root = this.deps.root();
    markDialogRoot(root, { labelledBy: 'aj-title' });
    root.style.display = 'block';
    this.navOpen = false;
    const selection = this.selection;
    this.render(selection ? `boss:${selection.instanceId}:${selection.bossKey}` : undefined);
  }

  close(focusFallback: HTMLElement | null = null): void {
    const root = this.deps.root();
    if (root.style.display !== 'block') return;
    this.deps.hideTooltip();
    this.modelController.destroy();
    root.style.display = 'none';
    this.deps.restoreFocus(focusFallback ?? this.openerFocus);
    this.openerFocus = null;
  }

  /** Repaint an open journal when the run it shows changed (a boss fell, a
   *  pull began or ended, the player moved rooms). Identity checks only: the
   *  run views are reference-stable, so an unchanged tick touches nothing. */
  syncRun(): void {
    if (!this.isOpen) return;
    const world = this.deps.world();
    const room = this.room();
    if (
      room === this.seenRoom &&
      world.dungeonRun === this.seenDungeonRun &&
      world.raidRun === this.seenRaidRun &&
      world.bossKills === this.seenBossKills
    ) {
      return;
    }
    this.render();
  }

  relocalize(): void {
    if (this.isOpen) this.render();
  }

  resetGraphicsPreviewContext(): void {
    this.modelController.destroy();
  }

  restoreGraphicsPreviewContext(): void {
    if (this.isOpen) this.render();
  }

  render(focusKey?: string): void {
    const selection = this.selection;
    const instance = selection ? journalInstance(selection.instanceId) : null;
    if (!selection || !instance) return;
    const root = this.deps.root();
    const restoreKey = focusKey ?? captureFocusKey(root) ?? undefined;
    // The scroll pair (the vendor family's): a repaint of the SAME page (a boss
    // falling mid-read, a tab, a tier) keeps the reader where they were; a new
    // page starts at its top. The list always keeps its place.
    const pageKey = `${selection.instanceId}:${selection.bossKey}`;
    const keepPage = pageKey === this.renderedPage;
    const pageTop = keepPage ? (root.querySelector<HTMLElement>('.aj-page')?.scrollTop ?? 0) : 0;
    const navTop = root.querySelector<HTMLElement>('.aj-nav')?.scrollTop ?? 0;
    this.renderedPage = pageKey;
    const world = this.deps.world();
    this.seenRoom = this.room();
    this.seenDungeonRun = world.dungeonRun;
    this.seenRaidRun = world.raidRun;
    this.seenBossKills = world.bossKills;
    const progress = this.progress();
    const currentId = journalInstanceForRoom(this.seenRoom)?.id ?? null;
    // The personal layer: kills per difficulty and the lockouts, on the tier
    // being read (journal_progress_view.ts). The lockout clock is the same
    // epoch the IWorld countdown subtracts from.
    const lockouts = world.raidLockouts();
    const visible = this.visible();
    const savedPages = new Map(
      visible.map((entry) => [entry.id, journalSavedPages(entry, this.tier, lockouts)]),
    );
    const groups = buildJournalNav(
      visible,
      selection,
      this.expanded,
      progress,
      currentId,
      savedPages,
    );
    const personal = journalPageProgress(
      instance,
      selection.bossKey,
      this.tier,
      world.bossKills,
      lockouts,
      Date.now(),
    );

    const difficulty = journalTierDifficulty(this.tier);
    // Mythic has no numbers yet: the header still reads the Heroic page.
    const view = difficulty ? instance.source.view(selection.bossKey, difficulty) : null;
    const headerView = view ?? instance.source.view(selection.bossKey, 'heroic');
    const members = headerView.members ?? [headerView.mobId];
    const keys = instance.source.bossKeys;
    const step = (dir: -1 | 1) => {
      const key = adjacentJournalBoss(instance, selection.bossKey, dir);
      if (!key) return null;
      const nameKey = instance.source.view(key, 'normal').nameKey;
      return {
        key,
        members: journalPageBodies(instance.source, key),
        ...(nameKey ? { nameKey } : {}),
      };
    };
    const state = journalPageState(instance, selection.bossKey, progress);
    const bossName = pageName(members, headerView.nameKey);

    const panel = view
      ? `<div class="aj-panel" id="aj-panel" role="tabpanel" aria-labelledby="aj-tab-${this.tab}">${this.panelHtml(
          instance,
          view,
          members,
        )}</div>`
      : comingSoonHtml(instance);

    root.innerHTML =
      frameCornersHtml() +
      headHtml(instance) +
      `<div class="aj-shell${this.navOpen ? ' aj-nav-open' : ''}">${navHtml(groups)}<section class="aj-page" tabindex="0" data-focus-key="journal" aria-labelledby="aj-boss-name">${mobileTopHtml(
        groups,
        this.navOpen,
      )}${bannerHtml({
        instance,
        members,
        view: headerView,
        state,
        index: keys.indexOf(selection.bossKey),
        total: keys.length,
        tier: this.tier,
        modelButton: view !== null,
        backdropUrl: this.holdBackdrop(journalBackdropUrl(instance.id, selection.bossKey)),
        progressHtml: progressHtml(personal),
        savedChipHtml: savedChipHtml(personal.pageSaved),
      })}${tabBarHtml(this.tab, view ? JOURNAL_TABS : null, step(-1), step(1))}${panel}</section></div>`;

    const freshPage = root.querySelector<HTMLElement>('.aj-page');
    const freshNav = root.querySelector<HTMLElement>('.aj-nav');
    if (freshPage && pageTop > 0) freshPage.scrollTop = pageTop;
    if (freshNav && navTop > 0) freshNav.scrollTop = navTop;
    this.mountModel(root, instance, headerView, bossName);
    this.wire(root, instance, view);
    if (restoreKey) {
      const keyed = [...root.querySelectorAll<HTMLElement>(`[${FOCUS_KEY_ATTR}]`)];
      const byKey = (key: string) => keyed.find((candidate) => candidate.dataset.focusKey === key);
      // On a phone with the drawer shut, a list boss is hidden: its twin in
      // the portrait row takes the focus instead.
      const phone = this.doc.body?.classList.contains('mobile-touch') ?? false;
      const stripTwin =
        phone && !this.navOpen && restoreKey.startsWith('boss:')
          ? byKey(`strip:${restoreKey.slice('boss:'.length)}`)
          : undefined;
      restoreFirstEnabled([
        stripTwin,
        byKey(restoreKey),
        root.querySelector<HTMLElement>('.aj-page'),
        root.querySelector<HTMLElement>('[data-close]'),
      ]);
    }
  }

  private holdBackdrop(url: string | null): string | null {
    if (url && !this.heldBackdrops.has(url) && typeof Image !== 'undefined') {
      const image = new Image();
      image.src = url;
      image.decode?.().catch(() => {});
      this.heldBackdrops.set(url, image);
    }
    return url;
  }

  private panelHtml(
    instance: JournalInstance,
    view: JournalBossView,
    members: readonly string[],
  ): string {
    if (this.tab === 'overview') return overviewHtml(instance, view);
    if (this.tab === 'loot') {
      const difficulty = journalTierDifficulty(this.tier) ?? 'normal';
      return lootHtml(journalLoot(members, difficulty), members, this.tier, (item: ItemDef) =>
        this.deps.itemIcon(item),
      );
    }
    return abilitiesHtml(instance, view, this.closedPhases, this.expandedMechanic, this.tier);
  }

  private mountModel(
    root: HTMLElement,
    instance: JournalInstance,
    view: JournalBossView,
    bossName: string,
  ): void {
    const slot = root.querySelector<HTMLElement>('[data-model-slot]');
    // Only the Overview holds the model: any other tab (and Mythic's panel)
    // releases the viewer and its WebGL context.
    if (!slot) {
      this.modelController.destroy();
      return;
    }
    const model = instance.legacyFormat ? undefined : journalModelFor(view.mobId);
    this.modelController.mount(slot, {
      boss: view.key,
      ...(instance.legacyFormat ? {} : { spec: model?.spec ?? null, tint: model?.tint ?? null }),
      name: bossName,
      posterUrl: view.portraitUrl,
      canvasLabel: t('guide.viewer.canvasLabel', { name: bossName }),
      loadingText: t('guide.viewer.loading'),
      errorText: t('guide.viewer.error', { name: bossName }),
      hintText: t('guide.viewer.dragHint'),
      viewButtonText: t('guide.viewer.view3dShort'),
      viewButtonLabel: t('guide.viewer.view3d', { name: bossName }),
    });
  }

  private goTo(instance: JournalInstance, bossKey: string, focusKey: string): void {
    this.deps.hideTooltip();
    this.select(instance, bossKey, null);
    // A pick from the phone drawer closes it, and a closed drawer's buttons are
    // hidden: focus returns to Browse, the control that reopens it.
    const fromDrawer = this.navOpen;
    this.navOpen = false;
    this.render(fromDrawer ? 'browse' : focusKey);
  }

  private wire(root: HTMLElement, instance: JournalInstance, view: JournalBossView | null): void {
    const page = root.querySelector<HTMLElement>('.aj-page');
    if (page) bindRaidBossGuideScroll(page);
    const nav = root.querySelector<HTMLElement>('.aj-nav');
    if (nav) {
      bindRaidBossGuideScroll(nav);
      nav.addEventListener('keydown', (event) => this.navKey(nav, event));
    }
    root.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', () => this.close());
    // The banner portrait's 3D button: the model lives on the Overview tab.
    root.querySelector<HTMLElement>('[data-show-model]')?.addEventListener('click', () => {
      this.deps.hideTooltip();
      if (this.tab !== 'overview') {
        this.tab = 'overview';
        this.render('show-model');
      }
      root.querySelector<HTMLElement>('[data-model-slot]')?.scrollIntoView?.({ block: 'nearest' });
    });
    // A tap on the dimmed page beside the phone drawer closes the drawer.
    const shell = root.querySelector<HTMLElement>('.aj-shell');
    shell?.addEventListener('click', (event) => {
      if (event.target !== shell || !this.navOpen) return;
      this.navOpen = false;
      this.render('browse');
    });
    root.querySelector<HTMLElement>('[data-browse]')?.addEventListener('click', () => {
      this.navOpen = !this.navOpen;
      this.render(
        this.navOpen && this.selection
          ? `boss:${this.selection.instanceId}:${this.selection.bossKey}`
          : 'browse',
      );
    });
    for (const toggle of root.querySelectorAll<HTMLButtonElement>('[data-instance]')) {
      toggle.addEventListener('click', () => {
        const id = toggle.dataset.instance ?? '';
        if (this.expanded.has(id)) this.expanded.delete(id);
        else this.expanded.add(id);
        this.render(`instance:${id}`);
      });
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-boss]')) {
      button.addEventListener('click', () => {
        const target = journalInstance(button.dataset.bossInstance ?? '');
        const key = button.dataset.boss ?? '';
        if (!target || !target.source.bossKeys.includes(key)) return;
        this.goTo(target, key, `boss:${target.id}:${key}`);
      });
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-step]')) {
      button.addEventListener('click', () => {
        const selection = this.selection;
        if (!selection) return;
        const dir = button.dataset.step === '-1' ? -1 : 1;
        const key = adjacentJournalBoss(instance, selection.bossKey, dir);
        if (key) this.goTo(instance, key, `step:${dir}`);
      });
    }
    const tiers = [...root.querySelectorAll<HTMLButtonElement>('.rbg-segmented [data-difficulty]')];
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-difficulty]')) {
      button.addEventListener('click', () => this.chooseTier(button.dataset.difficulty, true));
    }
    tiers.forEach((button, index) => {
      button.addEventListener('keydown', (event) => {
        const next = rovingTarget(event.key, index, tiers.length, 'horizontal');
        if (next === null) return;
        event.preventDefault();
        this.chooseTier(tiers[next]?.dataset.difficulty, true);
      });
    });
    const tabs = root.querySelector<HTMLElement>('.aj-tabs');
    if (tabs) {
      wireTabStrip(tabs, SECTION_TAB_CLASS, (id, focusFollow) => {
        if (!(JOURNAL_TABS as readonly string[]).includes(id) || id === this.tab) {
          if (focusFollow) focusActiveTab(tabs, SECTION_TAB_CLASS, SECTION_TAB_ACTIVE);
          return;
        }
        this.deps.hideTooltip();
        this.sounds.click();
        this.tab = id as JournalTab;
        this.render(`tab:${id}`);
        if (focusFollow) {
          const fresh = root.querySelector<HTMLElement>('.aj-tabs');
          if (fresh) focusActiveTab(fresh, SECTION_TAB_CLASS, SECTION_TAB_ACTIVE);
        }
      });
    }
    for (const toggle of root.querySelectorAll<HTMLButtonElement>('[data-phase-toggle]')) {
      toggle.addEventListener('click', () => {
        const id = toggle.dataset.phaseToggle ?? '';
        if (this.closedPhases.has(id)) this.closedPhases.delete(id);
        else this.closedPhases.add(id);
        this.render(`phase:${id}`);
      });
    }
    for (const link of root.querySelectorAll<HTMLButtonElement>('[data-jump]')) {
      link.addEventListener('click', () => this.jumpTo(view, link.dataset.jump ?? ''));
    }
    if (view) this.wireMechanics(root, instance, view);
    for (const row of root.querySelectorAll<HTMLElement>('[data-item-id]')) {
      const item = this.itemDef(row.dataset.itemId ?? '');
      if (item) this.deps.attachTooltip(row, () => this.deps.itemTooltip(item));
    }
  }

  private itemDef(id: string): ItemDef | null {
    return ITEMS[id] ?? null;
  }

  private wireMechanics(root: HTMLElement, instance: JournalInstance, view: JournalBossView): void {
    const touch = this.doc.body?.classList.contains('mobile-touch') ?? false;
    for (const phase of view.phases) {
      for (const mechanic of phase.mechanics) {
        const control = root.querySelector<HTMLButtonElement>(`[data-mechanic="${mechanic.id}"]`);
        if (!control) continue;
        control.addEventListener('click', () => {
          this.deps.hideTooltip();
          this.expandedMechanic = this.expandedMechanic === mechanic.id ? null : mechanic.id;
          this.render(`mechanic:${mechanic.id}`);
        });
        // A phone shows the whole line inline already, and so does an opened
        // row: a hover card there only covers the page it repeats.
        if (!touch && mechanic.id !== this.expandedMechanic) {
          this.deps.attachTooltip(control, () =>
            mechanicTooltipHtml(instance, phase, mechanic, this.tier),
          );
        }
      }
    }
  }

  /** The Strategy cards' ability links: open the Abilities tab on that line. */
  private jumpTo(view: JournalBossView | null, mechanicId: string): void {
    if (!view) return;
    const phase = view.phases.find((entry) => entry.mechanics.some((m) => m.id === mechanicId));
    if (!phase) return;
    this.deps.hideTooltip();
    this.tab = 'abilities';
    this.closedPhases.delete(phase.id);
    this.expandedMechanic = mechanicId;
    this.render(`mechanic:${mechanicId}`);
  }

  private chooseTier(value: string | undefined, keepFocus: boolean): void {
    const selection = this.selection;
    const instance = selection ? journalInstance(selection.instanceId) : null;
    if (!instance || !value || !instance.tiers.includes(value as JournalTier)) return;
    if (value === this.tier) return;
    this.sounds.click();
    this.deps.hideTooltip();
    this.tier = value as JournalTier;
    this.expandedMechanic = null;
    // Leaving Mythic's panel lands on its tier button, not on a gone control.
    this.render(keepFocus ? `difficulty:${value}` : undefined);
  }

  /** Arrow keys walk the list (Up/Down, Home/End); Right opens an instance or
   *  steps into it, Left closes it or steps back out to it. */
  private navKey(nav: HTMLElement, event: KeyboardEvent): void {
    const items = [...nav.querySelectorAll<HTMLElement>('[data-nav-item]')];
    const current = event.target instanceof HTMLElement ? event.target : null;
    const at = current ? items.indexOf(current) : -1;
    if (at < 0) return;
    const move = (index: number) => {
      event.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, index))]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        move(at + 1);
        return;
      case 'ArrowUp':
        move(at - 1);
        return;
      case 'Home':
        move(0);
        return;
      case 'End':
        move(items.length - 1);
        return;
      case 'ArrowRight': {
        const id = current?.dataset.instance;
        if (!id) return;
        event.preventDefault();
        if (!this.expanded.has(id)) {
          this.expanded.add(id);
          this.render(`instance:${id}`);
        } else items[at + 1]?.focus();
        return;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        const own = current?.dataset.instance ?? current?.dataset.bossInstance;
        if (!own) return;
        if (current?.dataset.instance && this.expanded.has(own)) {
          this.expanded.delete(own);
          this.render(`instance:${own}`);
          return;
        }
        nav.querySelector<HTMLElement>(`[data-instance="${own}"]`)?.focus();
        return;
      }
    }
  }
}
