// Thin DOM painter for the Dungeon Finder window (docs/prd/dungeon-finder.md).
//
// The consumer half of the pure-core + thin-painter split: it paints
// #dungeon-finder-window from the structured DungeonFinderViewModel
// (dungeon_finder_view.ts) and owns the window's view-state (active tab,
// selected catalogue activity, the staged pre-join activity checklist, the
// staged listing form, the mobile list/detail pane, the render-skip signature,
// the WCAG focus opener). The pure core decides WHAT each section shows; this
// module renders that and wires every action back through IWorld + injected
// callbacks. It holds no Sim reference and reaches into Hud only through deps.
//
// Perf contract (PRD): the window is cold. Closed it does no work at all; open
// it redraws from hud.update()'s mediumHud band and skips the DOM rebuild when
// the structural signature is unchanged. The 1 Hz countdown numbers (queue
// wait, proposal timer, cooldown) live OUTSIDE the signature and refresh in
// place through cached text slots, so a ticking clock never rebuilds the DOM.
// Boss portraits are prerendered WebP files with fixed dimensions and lazy
// decoding; no live Three.js scene ever renders here.

import { audio } from '../game/audio';
import {
  FINDER_GUILD_TAG,
  type FinderListingTag,
  finderActivity,
  isFinderRole,
} from '../sim/content/dungeon_finder';
import type { Role } from '../sim/content/talents';
import { DELVES, ITEMS } from '../sim/data';
import { ALL_CLASSES, type DungeonDifficulty, type PlayerClass } from '../sim/types';
import type { IWorld } from '../world_api';
import { clockSeconds } from './clock_seconds_core';
import { markDialogRoot } from './dialog_root';
import { quickMatchHtml } from './dungeon_activity_chrome';
import { premadeBoardHtml } from './dungeon_board_chrome';
import {
  type BoardContentFilter,
  filterBoardListings,
  isBoardContentFilter,
} from './dungeon_board_filter';
import {
  adventureName,
  adventureToolbarHtml,
  catalogueHeroArtHtml,
  lootPreviewControlsHtml,
} from './dungeon_catalogue_chrome';
import { type AdventureCategory, filterAdventureRows } from './dungeon_catalogue_view';
import {
  createFormState,
  createGroupFormHtml,
  type GroupDraft,
  publishGroupDraft,
} from './dungeon_create_form';
import { encounterGuideHtml } from './dungeon_encounter_guide';
import { finderNavigationHtml, finderTitle } from './dungeon_finder_navigation';
import {
  buildDungeonFinderView,
  type DungeonFinderViewModel,
  type FinderActivityDetailView,
  type FinderActivityRowView,
  type FinderBoardPanelView,
  type FinderClocksView,
  type FinderEncounterViewModel,
  type FinderLootGroupView,
  type FinderLootItemView,
  type FinderQueuePanelView,
  type FinderTab,
} from './dungeon_finder_view';
import { DungeonGroupControls } from './dungeon_group_controls';
import {
  filterEncounterLoot,
  type LootPreviewSelection,
  validLootPreviewSpec,
} from './dungeon_loot_preview_view';
import { dungeonDisplayName, tEntity, zoneDisplayName } from './entity_i18n';
import { esc } from './esc';
import { captureFocusKey, FOCUS_KEY_ATTR, restoreFirstEnabled } from './focus_restore';
import { formatNumber, type TranslationKey, t, tPlural } from './i18n';
import type { InspectRemoteProfile } from './inspect_window';
import type { PainterHostPresentation } from './painter_host';
import { svgIcon } from './ui_icons';
import { createWeeklyRewardsTab, type WeeklyRewardsTab } from './weekly_rewards_window';

// Render-skip sentinel for the pre-sync note (online, before the first `df`
// snapshot lands). A live sig is always JSON (starts with '['), so this token
// can never collide with one.
const FINDER_LOADING_SIG = 'dfinder-loading';

export interface DungeonFinderWindowDeps extends PainterHostPresentation {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  hideTooltip(): void;
  maskPlayerText?(text: string): string;
  // Close the finder, open the world map, and ping the given overworld point
  // (the activity entrance). Never teleports.
  showOnMap(x: number, z: number): void;
  // The dungeon's boss guide page for one encounter, when the dungeon ships one
  // (raid_boss_guide_window.ts openJournal). Absent: no guide buttons.
  hasBossGuide?(dungeonId: string, mobId: string): boolean;
  openBossGuide?(dungeonId: string, mobId: string, difficulty: DungeonDifficulty): void;
  // Open Player Info for a group applicant: the live card when they are in
  // view, else the applicant snapshot (class, spec, worn gear).
  inspectPlayer?(pid: number, profile: InspectRemoteProfile): void;
}

export class DungeonFinderWindow {
  private readonly groupControls = new DungeonGroupControls();
  private tab: FinderTab = 'board';
  private creatingGroup = false;
  private selectedActivityId: string | null = null;
  private category: AdventureCategory = 'dungeons';
  private search = '';
  private eligibleOnly = false;
  private lootPreview: LootPreviewSelection | null = null;
  private renderedDetailId: string | null = null;
  private openEncounterGuides = new Set<string>();
  private stagedActivityIds = new Set<string>();
  private stagedTags = new Set<FinderListingTag>();
  private stagedListingActivity: string | null = null;
  private createKind: 'dungeon' | 'raid' = 'dungeon';
  private stagedCreateRole: Role | null = null;
  private stagedGuildOnly = false;
  private stagedPartyRoles = new Map<number, Role>();
  // Picks sent for my published listing but maybe not yet in a snapshot, so
  // two quick picks never resend the first member's stale role (null = theirs).
  private listingRoleEdits = new Map<number, Role | null>();
  private listingRoleEditsFor: number | null = null;
  private boardFilter: BoardContentFilter = 'all';
  // Mobile master-detail: which pane the single column shows.
  private pane: 'list' | 'detail' = 'list';
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  // Clock slots refreshed in place between structural rebuilds.
  private clockSlots = new Map<string, HTMLElement>();
  private lastClockText = new Map<string, string>();

  private readonly vaultPane: WeeklyRewardsTab;

  constructor(private readonly deps: DungeonFinderWindowDeps) {
    this.vaultPane = createWeeklyRewardsTab(
      { ...deps, onInventoryChanged: () => {} },
      { readOnly: true },
    );
  }

  get isOpen(): boolean {
    return this.deps.root().style.display === 'flex';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.open();
  }

  open(tab?: FinderTab): void {
    const wasOpen = this.isOpen;
    this.tab = tab ?? 'board';
    if (!tab) this.creatingGroup = false;
    if (!wasOpen) {
      this.deps.closeOthers();
      this.openerFocus = this.deps.captureFocus();
      const root = this.deps.root();
      // Dialog identity is a static property of the stable root node: set once
      // on open, never inside render() (which mediumHud repeats while open).
      markDialogRoot(root, { labelledBy: 'dfinder-title' });
      root.style.display = 'flex';
    }
    this.lastSig = '';
    this.render();
    if (!wasOpen) {
      (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
    }
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'flex') {
      this.openerFocus = null;
      return;
    }
    this.deps.hideTooltip();
    this.vaultPane.close();
    el.style.display = 'none';
    this.clockSlots.clear();
    this.lastClockText.clear();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  // Re-localize after an in-game language switch: the signature is
  // text-independent, so clear it to force exactly one rebuild with fresh t().
  relocalize(): void {
    if (!this.isOpen) return;
    this.lastSig = '';
    this.render();
  }

  render(): void {
    const world = this.deps.world();
    const el = this.deps.root();
    const party = world.partyInfo;
    const input = {
      info: world.dungeonFinderInfo,
      board: world.dungeonFinderBoard,
      playerLevel: world.player.level,
      playerClass: world.cfg.playerClass,
      playerId: world.playerId,
      specRole: world.talentRole,
      party: party
        ? {
            leader: party.leader,
            size: party.members.length,
            members: party.members.map(({ pid, name, cls, level }) => ({ pid, name, cls, level })),
          }
        : null,
      partyLeaderName: party
        ? (party.members.find((m) => m.pid === party.leader)?.name ?? null)
        : null,
      lockouts: world.raidLockouts(),
      playerGuild: world.player.guild,
      tab: this.tab,
      selectedActivityId: this.selectedActivityId,
      stagedActivityIds: [...this.stagedActivityIds],
      includeDelves: true,
    };
    let view = buildDungeonFinderView(input);

    if (view.kind === 'loading') {
      if (this.lastSig === FINDER_LOADING_SIG) return;
      this.lastSig = FINDER_LOADING_SIG;
      el.innerHTML = `${this.titleHtml()}<div class="df-note">${esc(t('hudChrome.finder.syncing'))}</div>`;
      el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
      return;
    }

    if (!view.board.canCreate) this.creatingGroup = false;
    const allRows = view.rows;
    const labels = new Map(allRows.map((r) => [r.id, adventureName(r)]));
    const rows = filterAdventureRows(
      allRows,
      this.category,
      this.search,
      this.eligibleOnly,
      labels,
    );
    if (this.tab === 'catalogue' && rows.length > 0 && !rows.some((r) => r.selected)) {
      this.selectedActivityId = rows[0].id;
      const selectedView = buildDungeonFinderView({
        ...input,
        selectedActivityId: this.selectedActivityId,
      });
      if (selectedView.kind === 'live') view = selectedView;
    }
    const preview = this.lootPreview ?? { cls: world.cfg.playerClass, spec: world.talentSpec };
    const selection = { ...preview, spec: validLootPreviewSpec(preview.cls, preview.spec) };
    const groups = this.tab === 'board' ? this.groupControls.sync(world) : null;
    const sig = `${view.sig}|${groups?.sig ?? ''}|${this.pane}|${JSON.stringify([this.category, this.search, this.eligibleOnly, selection, this.creatingGroup, this.boardFilter, this.stagedGuildOnly])}`;
    if (sig === this.lastSig) {
      this.updateClocks(view.clocks);
      if (this.tab === 'vault')
        this.vaultPane.refreshIfChanged(() => {
          this.lastSig = '';
          this.render();
        });
      return;
    }
    this.lastSig = sig;
    this.deps.hideTooltip();
    // Native disclosures need no repaint on toggle. Snapshot their state only
    // before a structural rebuild, including loot filters and real world updates.
    if (this.renderedDetailId === view.detail?.id) {
      this.openEncounterGuides = new Set(
        [...el.querySelectorAll<HTMLDetailsElement>('details[data-encounter-guide][open]')].map(
          (node) => node.dataset.encounterGuide ?? '',
        ),
      );
    } else {
      this.openEncounterGuides.clear();
    }
    // .df-rail (not #dungeon-finder-window) is the catalogue's scroll container; it
    // is recreated on every rebuild, so capture its scroll offset and reapply it to
    // the fresh one, else selecting a row near the bottom snaps the list back to the
    // top and scrolls the just-picked dungeon out of view (the bank/spellbook idiom).
    const prevRailScrollTop = el.querySelector('.df-rail')?.scrollTop ?? 0;
    const prevDetailScrollTop =
      this.renderedDetailId === view.detail?.id
        ? (el.querySelector('.df-detail')?.scrollTop ?? 0)
        : 0;
    this.renderedDetailId = view.detail?.id ?? null;
    const focused = captureFocusKey(el);
    const openGroupDetails = [
      ...el.querySelectorAll<HTMLDetailsElement>(
        'details[data-group-disclosure][open], details[data-shop-rules][open]',
      ),
    ].map((node) => node.dataset.groupDisclosure ?? 'rules');
    const bodyScroll = el.querySelector('.df-body')?.scrollTop ?? 0;
    const vaultScroll = el.querySelector('#weekly-rewards-panel')?.scrollTop ?? 0;
    const caret =
      focused === 'guide-search'
        ? el.querySelector<HTMLInputElement>('[data-guide-search]')?.selectionStart
        : null;
    const noteInput =
      focused === 'group:note' ? el.querySelector<HTMLInputElement>('[data-group-note]') : null;
    const noteCaret = noteInput
      ? { start: noteInput.selectionStart, end: noteInput.selectionEnd }
      : null;
    const visibleRows = filterAdventureRows(
      view.rows,
      this.category,
      this.search,
      this.eligibleOnly,
      labels,
    );
    el.classList.toggle('df-vault-mode', view.tab === 'vault');
    el.innerHTML = this.liveHtml(
      { ...view, rows: visibleRows, detail: visibleRows.length > 0 ? view.detail : null },
      allRows,
      selection,
    );
    this.wire(el, view);
    if (view.tab === 'vault') {
      const container = el.querySelector<HTMLElement>('#df-vault-container');
      if (container) this.vaultPane.renderInto(container);
      const panel = el.querySelector('#weekly-rewards-panel');
      if (panel) panel.scrollTop = vaultScroll;
    } else this.vaultPane.close();
    for (const node of el.querySelectorAll<HTMLDetailsElement>(
      'details[data-group-disclosure], details[data-shop-rules]',
    ))
      node.open = openGroupDetails.includes(node.dataset.groupDisclosure ?? 'rules');
    const body = el.querySelector('.df-body');
    if (body) body.scrollTop = bodyScroll;
    const rail = el.querySelector('.df-rail');
    if (rail) rail.scrollTop = prevRailScrollTop;
    const detailPane = el.querySelector('.df-detail');
    if (detailPane) detailPane.scrollTop = prevDetailScrollTop;
    if (focused) {
      const target =
        focused.startsWith('data-row:') && this.pane === 'detail' && el.closest('body.mobile-touch')
          ? el.querySelector<HTMLElement>('[data-back]')
          : [...el.querySelectorAll<HTMLElement>(`[${FOCUS_KEY_ATTR}]`)].find(
              (node) => node.getAttribute(FOCUS_KEY_ATTR) === focused,
            );
      restoreFirstEnabled([target, el.querySelector<HTMLElement>('[data-close]')]);
      if (caret != null)
        el.querySelector<HTMLInputElement>('[data-guide-search]')?.setSelectionRange(caret, caret);
      if (noteCaret?.start != null && noteCaret.end != null)
        el.querySelector<HTMLInputElement>('[data-group-note]')?.setSelectionRange(
          noteCaret.start,
          noteCaret.end,
        );
    }
    this.cacheClockSlots(el);
    this.lastClockText.clear();
    this.updateClocks(view.clocks);
  }

  // ---- 1 Hz clock slots (no DOM rebuild) -----------------------------------

  private cacheClockSlots(el: HTMLElement): void {
    this.clockSlots.clear();
    for (const node of el.querySelectorAll<HTMLElement>('[data-df-clock]')) {
      const key = node.dataset.dfClock;
      if (key) this.clockSlots.set(key, node);
    }
  }

  private setClock(key: string, text: string): void {
    const node = this.clockSlots.get(key);
    if (!node || this.lastClockText.get(key) === text) return;
    this.lastClockText.set(key, text);
    node.textContent = text;
  }

  private updateClocks(clocks: FinderClocksView): void {
    if (clocks.queueWaited !== null) {
      this.setClock('waited', t('hudChrome.finder.waited', { time: mmss(clocks.queueWaited) }));
    }
    if (clocks.cooldown > 0) {
      this.setClock(
        'cooldown',
        t('hudChrome.finder.cooldownNote', { seconds: num(clocks.cooldown) }),
      );
    }
    if (clocks.proposalRemaining !== null) {
      this.setClock(
        'remaining',
        t('hudChrome.finder.remaining', { seconds: num(clocks.proposalRemaining) }),
      );
    }
    if (clocks.proposalAccepted !== null && clocks.proposalSize !== null) {
      this.setClock(
        'accepted',
        t('hudChrome.finder.accepted', {
          accepted: num(clocks.proposalAccepted),
          size: num(clocks.proposalSize),
        }),
      );
    }
  }

  // ---- event wiring ----------------------------------------------------------

  private wire(el: HTMLElement, view: Extract<DungeonFinderViewModel, { kind: 'live' }>): void {
    const world = () => this.deps.world();
    const rerender = () => {
      this.lastSig = '';
      this.render();
    };
    this.groupControls.wire(el, world, rerender);
    el.querySelectorAll<HTMLElement>('[data-category]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.category = btn.dataset.category as AdventureCategory;
        this.selectedActivityId = null;
        this.pane = 'list';
        rerender();
      });
    });
    el.querySelector<HTMLInputElement>('[data-guide-search]')?.addEventListener(
      'input',
      (event) => {
        this.search = (event.currentTarget as HTMLInputElement).value;
        this.pane = 'list';
        rerender();
      },
    );
    el.querySelector<HTMLInputElement>('[data-guide-eligible]')?.addEventListener(
      'change',
      (event) => {
        this.eligibleOnly = (event.currentTarget as HTMLInputElement).checked;
        rerender();
      },
    );
    el.querySelector('[data-guide-reset]')?.addEventListener('click', () => {
      this.search = '';
      this.eligibleOnly = false;
      rerender();
    });
    el.querySelector<HTMLSelectElement>('[data-loot-class]')?.addEventListener(
      'change',
      (event) => {
        const cls = (event.currentTarget as HTMLSelectElement).value as PlayerClass;
        if (!ALL_CLASSES.includes(cls)) return;
        this.lootPreview = {
          cls,
          spec: cls === world().cfg.playerClass ? world().talentSpec : null,
        };
        rerender();
      },
    );
    el.querySelector<HTMLSelectElement>('[data-loot-spec]')?.addEventListener('change', (event) => {
      const cls = this.lootPreview?.cls ?? world().cfg.playerClass;
      this.lootPreview = {
        cls,
        spec: validLootPreviewSpec(cls, (event.currentTarget as HTMLSelectElement).value || null),
      };
      rerender();
    });
    el.querySelector('[data-guide-group]')?.addEventListener('click', () => {
      if (!view.detail || view.detail.kind === 'delve') return;
      const canCreateSelected =
        view.board.canCreate &&
        view.board.createOptions.some((option) => option.id === view.detail?.id);
      this.stagedListingActivity = canCreateSelected ? view.detail.id : null;
      this.creatingGroup = false;
      this.tab = 'board';
      rerender();
    });
    el.querySelector('[data-start-create]')?.addEventListener('click', () => {
      this.creatingGroup = true;
      const activity = this.stagedListingActivity
        ? finderActivity(this.stagedListingActivity)
        : null;
      if (activity?.kind === 'raid' || activity?.kind === 'dungeon')
        this.createKind = activity.kind;
      rerender();
      el.querySelector<HTMLElement>('[data-createopt][aria-checked="true"]')?.focus();
    });
    el.querySelector('[data-cancel-create]')?.addEventListener('click', () => {
      this.creatingGroup = false;
      rerender();
      el.querySelector<HTMLElement>('[data-start-create]')?.focus();
    });
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    el.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tab = (btn as HTMLElement).dataset.tab as FinderTab;
        if (this.tab === 'board') this.creatingGroup = false;
        this.pane = 'list';
        audio.click();
        rerender();
      });
    });
    el.querySelectorAll('[data-row]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedActivityId = (btn as HTMLElement).dataset.row ?? null;
        this.pane = 'detail';
        audio.click();
        rerender();
      });
    });
    el.querySelector('[data-back]')?.addEventListener('click', () => {
      this.pane = 'list';
      audio.click();
      rerender();
    });
    for (const btn of el.querySelectorAll<HTMLButtonElement>('[data-bossguide]')) {
      btn.addEventListener('click', () => {
        const detail = view.detail;
        const mobId = btn.dataset.bossguide;
        if (!detail || !mobId || !this.deps.openBossGuide) return;
        audio.click();
        this.deps.openBossGuide(detail.dungeonId, mobId, detail.difficulty);
      });
    }
    el.querySelector('[data-showmap]')?.addEventListener('click', () => {
      const detail = view.detail;
      if (!detail) return;
      audio.click();
      this.close();
      this.deps.showOnMap(detail.entrance.x, detail.entrance.z);
    });
    // Quick Match: role toggles resolve to a full lfg role selection send.
    el.querySelectorAll('[data-role]:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        const role = (btn as HTMLElement).dataset.role as Role;
        const next = view.queue.roles
          .filter((r) => (r.role === role ? !r.selected : r.selected))
          .map((r) => r.role);
        world().dungeonFinderSetRoles(next);
        audio.click();
      });
    });
    el.querySelectorAll('[data-opt]:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.opt ?? '';
        if (this.stagedActivityIds.has(id)) this.stagedActivityIds.delete(id);
        else this.stagedActivityIds.add(id);
        audio.click();
        rerender();
      });
    });
    el.querySelector('[data-act="join"]:not([disabled])')?.addEventListener('click', () => {
      world().dungeonFinderQueueJoin([...this.stagedActivityIds]);
      audio.click();
    });
    el.querySelector('[data-act="leavequeue"]')?.addEventListener('click', () => {
      world().dungeonFinderQueueLeave();
      audio.click();
    });
    el.querySelector('[data-act="accept"]')?.addEventListener('click', () => {
      world().dungeonFinderRespond(true);
      audio.click();
    });
    el.querySelector('[data-act="decline"]')?.addEventListener('click', () => {
      world().dungeonFinderRespond(false);
      audio.click();
    });
    // Premade board.
    el.querySelector<HTMLSelectElement>('[data-create-kind]')?.addEventListener(
      'change',
      (event) => {
        const kind = (event.currentTarget as HTMLSelectElement).value;
        if (kind !== 'dungeon' && kind !== 'raid') return;
        this.createKind = kind;
        this.stagedListingActivity = null;
        rerender();
      },
    );
    el.querySelector<HTMLSelectElement>('[data-board-filter]')?.addEventListener(
      'change',
      (event) => {
        const value = (event.currentTarget as HTMLSelectElement).value;
        if (!isBoardContentFilter(value)) return;
        this.boardFilter = value;
        rerender();
      },
    );
    el.querySelector<HTMLInputElement>('[data-create-guild]')?.addEventListener(
      'change',
      (event) => {
        this.stagedGuildOnly = (event.currentTarget as HTMLInputElement).checked;
        rerender();
      },
    );
    // Party member roles: staged while creating, sent whole for my listing.
    el.querySelectorAll<HTMLSelectElement>('[data-party-role]').forEach((select) => {
      select.addEventListener('change', () => {
        const pid = Number(select.dataset.partyRole);
        const role = isFinderRole(select.value) ? select.value : null;
        if (!view.board.myListing) {
          if (role) this.stagedPartyRoles.set(pid, role);
          else this.stagedPartyRoles.delete(pid);
          rerender();
          return;
        }
        if (this.listingRoleEditsFor !== view.board.myListing.id) {
          this.listingRoleEdits.clear();
          this.listingRoleEditsFor = view.board.myListing.id;
        }
        this.listingRoleEdits.set(pid, role);
        const roles = view.board.partyMembers.flatMap((member) => {
          const next = this.listingRoleEdits.has(member.pid)
            ? this.listingRoleEdits.get(member.pid)
            : member.assigned;
          return next ? [{ pid: member.pid, role: next }] : [];
        });
        world().dungeonFinderExpeditionConfigure({ kind: 'party_roles', roles });
        audio.click();
      });
    });
    el.querySelectorAll<HTMLButtonElement>('[data-listing-difficulty]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const activityId = btn.dataset.listingDifficulty;
        if (btn.disabled || !activityId) return;
        world().dungeonFinderExpeditionConfigure({ kind: 'difficulty', activityId });
        audio.click();
      });
    });
    el.querySelectorAll<HTMLButtonElement>('[data-advert]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.advert;
        if (btn.disabled || (target !== 'general' && target !== 'discord')) return;
        world().dungeonFinderExpeditionConfigure({ kind: 'advertise', target });
        audio.click();
      });
    });
    el.querySelectorAll<HTMLElement>('[data-appinspect]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = Number(btn.dataset.appinspect);
        const applicant = view.board.myListing?.applicants.find((a) => a.pid === pid);
        if (!applicant) return;
        this.deps.inspectPlayer?.(pid, {
          name: applicant.name,
          level: applicant.level,
          cls: applicant.cls,
          skin: 0,
          guild: null,
          specId: applicant.spec ?? null,
          gear: applicant.gear ?? {},
        });
        audio.click();
      });
    });
    el.querySelectorAll<HTMLElement>('[data-create-role]:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.stagedCreateRole = btn.dataset.createRole as Role;
        rerender();
      });
    });
    el.querySelectorAll('[data-createopt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.stagedListingActivity = (btn as HTMLElement).dataset.createopt ?? null;
        audio.click();
        rerender();
      });
    });
    el.querySelectorAll('[data-tag]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tag = (btn as HTMLElement).dataset.tag as FinderListingTag;
        if (this.stagedTags.has(tag)) this.stagedTags.delete(tag);
        else this.stagedTags.add(tag);
        audio.click();
        rerender();
      });
    });
    el.querySelector('[data-act="create"]:not([disabled])')?.addEventListener('click', () => {
      const state = createFormState(view.board, view.queue, this.createDraft());
      const tags = new Set(this.stagedTags);
      if (state.guildOnly) tags.add(FINDER_GUILD_TAG);
      if (
        !state.canPublish ||
        !publishGroupDraft(world(), state.activity, state.role, tags, this.stagedPartyRoles)
      ) {
        rerender();
        return;
      }
      audio.click();
    });
    el.querySelector('[data-act="closelisting"]')?.addEventListener('click', () => {
      world().dungeonFinderListingClose();
      audio.click();
    });
    el.querySelectorAll<HTMLElement>('[data-withdraw]').forEach((button) => {
      button.addEventListener('click', () => {
        world().dungeonFinderExpeditionConfigure({
          kind: 'cancel_application',
          listingId: Number(button.dataset.withdraw),
        });
        audio.click();
      });
    });
    el.querySelectorAll('[data-apply]:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        const listing = view.board.listings.find(
          (row) => row.id === Number((btn as HTMLElement).dataset.apply),
        );
        if (!listing?.canApply) return;
        if (listing.expedition && listing.applicationRole)
          world().dungeonFinderExpeditionApply(listing.id, listing.applicationRole);
        else world().dungeonFinderApply(listing.id);
        audio.click();
      });
    });
    el.querySelectorAll('[data-appacc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        world().dungeonFinderApplicationRespond(Number((btn as HTMLElement).dataset.appacc), true);
        audio.click();
      });
    });
    el.querySelectorAll('[data-appdec]').forEach((btn) => {
      btn.addEventListener('click', () => {
        world().dungeonFinderApplicationRespond(Number((btn as HTMLElement).dataset.appdec), false);
        audio.click();
      });
    });
    // Loot rows: the shared lazily-built item tooltip.
    el.querySelectorAll<HTMLElement>('[data-df-item]').forEach((node) => {
      const item = ITEMS[node.dataset.dfItem ?? ''];
      if (item) this.deps.attachTooltip(node, () => this.deps.itemTooltip(item));
    });
    // Stable identities for the existing queue/board controls as well as catalogue rows.
    for (const node of el.querySelectorAll<HTMLElement>(
      'button, summary, select, [data-df-item]',
    )) {
      const identity = [...node.attributes].find(
        (attr) => attr.name.startsWith('data-') && attr.name !== FOCUS_KEY_ATTR,
      );
      if (identity && !node.hasAttribute(FOCUS_KEY_ATTR))
        node.setAttribute(FOCUS_KEY_ATTR, `${identity.name}:${identity.value}`);
    }
  }

  // ---- HTML builders ----------------------------------------------------------

  private titleHtml(): string {
    return (
      `<div class="panel-title ui-win-head"><span id="dfinder-title" class="ui-win-title">${esc(finderTitle(this.tab, this.creatingGroup))}</span>` +
      `<button type="button" class="x-btn ui-x-btn" data-close aria-label="${esc(t('hudChrome.finder.close'))}">${svgIcon('close')}</button></div>`
    );
  }

  private liveHtml(
    view: Extract<DungeonFinderViewModel, { kind: 'live' }>,
    allRows: FinderActivityRowView[],
    selection: LootPreviewSelection,
  ): string {
    const navigation = finderNavigationHtml(
      view.tab,
      view.queue.queued,
      view.tab === 'board' &&
        !view.board.myListing &&
        !this.creatingGroup &&
        view.board.canCreate &&
        view.board.createOptions.length > 0,
      !this.creatingGroup,
    );
    const proposal = view.queue.proposal ? this.proposalHtml(view.queue) : '';
    const body =
      view.tab === 'catalogue'
        ? this.catalogueHtml(view.rows, view.detail, selection)
        : view.tab === 'queue'
          ? quickMatchHtml(view.queue)
          : view.tab === 'vault'
            ? '<div class="df-vault-container" id="df-vault-container"></div>'
            : this.boardHtml(view.board, view.queue);
    const toolbar =
      view.tab === 'catalogue'
        ? adventureToolbarHtml(allRows, this.category, this.search, this.eligibleOnly)
        : '';
    return `${this.titleHtml() + navigation + proposal + toolbar}<div class="df-body${view.tab === 'catalogue' ? ' df-body-catalogue' : ''}${view.tab === 'vault' ? ' df-body-vault' : ''}">${body}</div>`;
  }

  // --- catalogue -----------------------------------------------------------

  private catalogueHtml(
    rows: FinderActivityRowView[],
    detail: FinderActivityDetailView | null,
    selection: LootPreviewSelection,
  ): string {
    if (rows.length === 0)
      return `<div class="df-empty"><p>${esc(t('hudChrome.adventureGuide.empty'))}</p><button class="ui-btn" type="button" data-guide-reset>${esc(t('hudChrome.adventureGuide.reset'))}</button></div>`;
    const rail = `<div class="df-rail ui-panel-soft" role="group" aria-label="${esc(
      t('hudChrome.finder.tabCatalogue'),
    )}"><div class="df-rail-count">${esc(tPlural('hudChrome.adventureGuide.catalogueCountPlural', rows.length, { count: num(rows.length) }))}</div>${rows.map((r) => this.rowHtml(r)).join('')}</div>`;
    const detailHtml = `<div class="df-detail">${detail ? this.detailHtml(detail, selection) : ''}</div>`;
    return `<div class="df-cols df-pane-${this.pane}">${rail}${detailHtml}</div>`;
  }

  private rowHtml(r: FinderActivityRowView): string {
    const name = adventureName(r);
    const badge = r.kind === 'delve' ? '' : this.difficultyBadge(r.difficulty);
    const lock =
      r.lockedMinutes > 0
        ? `<span class="df-lock">${esc(t('hudChrome.finder.lockedFor', { minutes: num(r.lockedMinutes) }))}</span>`
        : '';
    const blocked = r.blocked
      ? `<span class="df-blocked">${esc(t('hudChrome.finder.levelUnavailable'))}</span>`
      : '';
    return (
      `<button type="button" class="df-row ui-card ui-card-tile${r.selected ? ' active' : ''}${r.eligible ? '' : ' ineligible'}" data-row="${esc(r.id)}" aria-pressed="${r.selected ? 'true' : 'false'}">` +
      (r.portraitUrl
        ? `<img class="df-row-icon" src="${esc(r.portraitUrl)}" width="64" height="64" loading="lazy" decoding="async" alt="">`
        : `<span class="df-row-icon df-glyph">${svgIcon('chest')}</span>`) +
      `<span class="df-row-text"><span class="df-row-name">${esc(name)} ${badge}</span>` +
      `<span class="df-row-meta">${esc(this.levelsLabel(r.minLevel, r.maxLevel))} &middot; ${esc(
        tPlural('hudChrome.plurals.finderPartySize', r.size, { count: num(r.size) }),
      )}</span>${lock}${blocked}</span></button>`
    );
  }

  private detailHtml(d: FinderActivityDetailView, selection: LootPreviewSelection): string {
    const name = adventureName(d);
    const back = `<button type="button" class="btn df-back ui-btn" data-back>${esc(t('hudChrome.finder.back'))}</button>`;
    const finalEnc = d.encounters.find((e) => e.final) ?? d.encounters[d.encounters.length - 1];
    const headIcon = finalEnc?.portraitUrl
      ? `<img class="df-detail-icon" src="${esc(finalEnc.portraitUrl)}" width="40" height="40" loading="lazy" decoding="async" alt="">`
      : '';
    const head =
      `<div class="df-detail-head">${back}${headIcon}<span class="df-detail-name">${esc(name)}</span>` +
      `${d.kind === 'delve' ? '' : this.difficultyBadge(d.difficulty)}<span class="df-kind">${esc(this.kindLabel(d.kind))}</span></div>`;
    const comp = d.composition
      ? (
          [
            ['tank', d.composition.tank],
            ['healer', d.composition.healer],
            ['dps', d.composition.dps],
          ] as const
        )
          .map(([role, n]) => this.roleCountHtml(role, n))
          .join(' ')
      : esc(t('hudChrome.finder.freeRoles'));
    const lockLine =
      d.lockedMinutes > 0
        ? esc(t('hudChrome.finder.lockedFor', { minutes: num(d.lockedMinutes) }))
        : esc(
            d.lockout === 'daily'
              ? t('hudChrome.finder.lockoutDaily')
              : d.lockout === 'weekly'
                ? t('hudChrome.finder.lockoutWeekly')
                : t('hudChrome.finder.lockoutNone'),
          );
    const attunement = d.attunementQuestId
      ? `<div class="df-meta-row">${esc(
          t('hudChrome.finder.attunement', {
            quest: tEntity({ kind: 'quest', id: d.attunementQuestId, field: 'title' }),
          }),
        )}</div>`
      : '';
    const marks =
      d.heroicMarks > 0
        ? `<div class="df-meta-row">${esc(t('hudChrome.finder.heroicMarks', { count: num(d.heroicMarks) }))}</div>`
        : '';
    const meta =
      `<div class="df-meta ui-card ui-card-tile">` +
      `<div class="df-meta-row">${esc(this.levelsLabel(d.minLevel, d.maxLevel))} &middot; ${esc(
        tPlural('hudChrome.plurals.finderPartySize', d.size, { count: num(d.size) }),
      )}</div>` +
      `<div class="df-meta-row">${comp}</div>` +
      `<div class="df-meta-row">${lockLine}</div>` +
      attunement +
      marks +
      `<div class="df-meta-row df-entrance">${esc(
        t('hudChrome.finder.entrance', { zone: zoneDisplayName(d.entrance.zoneId) }),
      )} <button type="button" class="btn df-map-btn ui-btn" data-showmap>${esc(t('hudChrome.finder.showOnMap'))}</button></div>` +
      `</div>`;
    const encounters =
      `<div class="df-sub">${esc(t('hudChrome.finder.encounters'))}</div>` +
      d.encounters
        .map((e) =>
          this.encounterHtml(filterEncounterLoot(e, selection), d.difficulty, d.dungeonId),
        )
        .join('');
    const travelKey =
      d.kind === 'delve'
        ? 'delveTravel'
        : d.kind === 'raid'
          ? 'raidTravel'
          : d.kind === 'solo'
            ? 'soloTravel'
            : 'dungeonTravel';
    const intro = `<p class="df-guide-description">${esc(t(`hudChrome.adventureGuide.${travelKey}`))}</p>`;
    const group =
      d.kind !== 'delve' && d.kind !== 'solo'
        ? `<button class="ui-btn ui-btn--gold df-group-btn" type="button" data-guide-group>${esc(t('hudChrome.adventureGuide.findGroup'))}</button>`
        : '';
    const tiers =
      d.kind === 'delve'
        ? `<div class="df-note">${esc(t('hudChrome.adventureGuide.tiers', { tiers: DELVES[d.dungeonId].tiers.map((tier) => t(tier.id === 'heroic' ? 'delveUi.board.tier.heroic' : 'delveUi.board.tier.normal')).join(', ') }))}</div>`
        : '';
    return `<div class="df-detail-hero">${catalogueHeroArtHtml(d)}<div class="df-detail-hero-copy">${head}${intro}${group}</div></div>${meta}${tiers}${lootPreviewControlsHtml(selection)}${encounters}`;
  }

  private encounterHtml(
    e: FinderEncounterViewModel,
    difficulty: DungeonDifficulty,
    dungeonId: string,
  ): string {
    const name = tEntity({ kind: 'mob', id: e.mobId, field: 'name' });
    const journalButton = this.deps.hasBossGuide?.(dungeonId, e.mobId)
      ? `<button type="button" class="btn df-guide-btn ui-btn" data-bossguide="${esc(e.mobId)}" aria-label="${esc(
          t('hudChrome.raidBossGuide.finderOpenLabel', { boss: name }),
        )}">${esc(t('hudChrome.raidBossGuide.finderOpen'))}</button>`
      : '';
    const flags = [
      e.final ? t('hudChrome.finder.finalBoss') : null,
      e.summoned ? t('hudChrome.finder.summoned') : null,
    ]
      .filter((f): f is string => f !== null)
      .map((f) => `<span class="df-flag ui-chip">${esc(f)}</span>`)
      .join('');
    const guide =
      e.mechanics.length > 0
        ? `<details class="df-encounter-guide" data-encounter-guide="${esc(e.mobId)}"${this.openEncounterGuides.has(e.mobId) ? ' open' : ''}><summary class="ui-btn" tabindex="0" data-guide-toggle="${esc(e.mobId)}">${svgIcon('book')}<span class="df-guide-show">${esc(t('hudChrome.finder.showGuide'))}</span><span class="df-guide-hide">${esc(t('hudChrome.finder.hideGuide'))}</span></summary><div class="df-guide-content">${encounterGuideHtml(e, difficulty)}</div></details>`
        : '';
    const lootSections = [
      ...e.groups.map((g) =>
        this.lootGroupHtml(
          g,
          g.guaranteed ? 'hudChrome.finder.lootGuaranteed' : 'hudChrome.finder.lootMaybe',
        ),
      ),
      e.singles.length > 0
        ? `<div class="df-loot-sub">${esc(t('hudChrome.finder.lootChance'))}</div>${e.singles
            .map((i) => this.lootItemHtml(i, true))
            .join('')}`
        : '',
      ...e.heroicGroups.map((g) =>
        this.lootGroupHtml(
          g,
          g.guaranteed ? 'hudChrome.finder.lootHeroic' : 'hudChrome.finder.lootHeroicMaybe',
        ),
      ),
      e.heroicSingles.length > 0
        ? `<div class="df-loot-sub">${esc(t('hudChrome.finder.lootHeroicChance'))}</div>${e.heroicSingles
            .map((i) => this.lootItemHtml(i, true))
            .join('')}`
        : '',
    ].join('');
    const money =
      e.copper > 0
        ? `<div class="df-loot-money ui-money">${this.deps.moneyHtml(e.copper)}</div>`
        : '';
    return (
      `<div class="df-encounter ui-card ui-card-tile">` +
      (e.portraitUrl
        ? `<img class="df-portrait" src="${esc(e.portraitUrl)}" width="64" height="64" loading="lazy" decoding="async" alt="">`
        : `<span class="df-portrait df-glyph">${svgIcon('skull')}</span>`) +
      `<div class="df-encounter-body"><div class="df-encounter-name">${esc(name)}${flags}${journalButton}</div>` +
      guide +
      `<div class="df-loot">${lootSections || `<p class="df-note">${esc(t('hudChrome.adventureGuide.lootEmpty'))}</p>`}${money}</div></div></div>`
    );
  }

  private lootGroupHtml(group: FinderLootGroupView, labelKey: TranslationKey): string {
    return (
      `<div class="df-loot-sub">${esc(t(group.previewFiltered && group.guaranteed ? 'hudChrome.adventureGuide.fullTableRoll' : labelKey))}</div>` +
      group.items
        .map((i) => this.lootItemHtml(i, !group.guaranteed || !!group.previewFiltered))
        .join('')
    );
  }

  private lootItemHtml(i: FinderLootItemView, showChance: boolean): string {
    const item = ITEMS[i.itemId];
    if (!item) return '';
    const name = `<span class="df-loot-name df-quality-${i.quality}">${esc(
      itemName(i.itemId),
    )}</span>`;
    const chance = showChance
      ? `<span class="df-loot-chance">${esc(
          t('hudChrome.finder.pct', {
            pct: formatNumber(i.chance * 100, { maximumFractionDigits: 0 }),
          }),
        )}</span>`
      : '';
    return `<div class="df-loot-row" data-df-item="${esc(i.itemId)}" tabindex="0">${this.deps.itemIcon(item)}${name}${chance}</div>`;
  }

  // --- quick match -----------------------------------------------------------

  private proposalHtml(queue: FinderQueuePanelView): string {
    const p = queue.proposal;
    if (!p) return '';
    const name = dungeonDisplayName(p.dungeonId);
    const answer =
      p.myResponse === 'pending'
        ? `<div class="df-proposal-actions">` +
          `<button type="button" class="btn df-accept ui-btn ui-btn--red" data-act="accept">${esc(t('hudChrome.finder.accept'))}</button>` +
          `<button type="button" class="btn df-decline ui-btn" data-act="decline">${esc(t('hudChrome.finder.decline'))}</button></div>`
        : `<div class="df-note">${esc(t('hudChrome.finder.acceptedWait'))}</div>`;
    return (
      `<div class="df-proposal ui-panel" role="alert">` +
      `<div class="df-proposal-title">${esc(t('hudChrome.finder.proposalTitle', { name }))} ${this.difficultyBadge(p.difficulty)}</div>` +
      `<div class="df-proposal-meta">${this.roleIcon(p.role)}${esc(t('hudChrome.finder.proposalRole', { role: this.roleLabel(p.role) }))}` +
      ` &middot; <span data-df-clock="accepted"></span> &middot; <span data-df-clock="remaining"></span></div>` +
      answer +
      `</div>`
    );
  }

  // --- premade board -----------------------------------------------------------

  private boardHtml(b: FinderBoardPanelView, q: FinderQueuePanelView): string {
    if (this.creatingGroup && !b.myListing) {
      return `<div class="df-board-shell df-board-shell--browse df-board-shell--create">${createGroupFormHtml(b, q, this.createDraft())}</div>`;
    }
    const groups = this.groupControls.sync(this.deps.world());
    const roles =
      !q.inParty && !b.myListing
        ? `<div class="df-browse-roles" role="group" aria-label="${esc(t('hudChrome.finder.yourRoles'))}"><span>${esc(t('hudChrome.finder.yourRoles'))}</span><div class="df-roles">${q.roles.map((r) => `<button type="button" class="df-role ui-card ui-card-tile${r.selected ? ' active' : ''}" data-role="${r.role}" aria-pressed="${r.selected}"${r.eligible ? '' : ' disabled'}>${this.roleIcon(r.role)}<span>${esc(this.roleLabel(r.role))}</span></button>`).join('')}</div></div>`
        : '';
    return (
      premadeBoardHtml(
        b,
        '',
        this.groupControls.ownHtml(groups),
        roles,
        this.deps.maskPlayerText,
        this.boardFilter,
        filterBoardListings(b.listings, this.boardFilter),
      ) +
      this.groupControls.toolsHtml(
        groups,
        b.listings.map((listing) => listing.id),
      )
    );
  }

  private createDraft(): GroupDraft {
    return {
      kind: this.createKind,
      activity: this.stagedListingActivity,
      role: this.stagedCreateRole,
      tags: this.stagedTags,
      guildOnly: this.stagedGuildOnly,
      partyRoles: this.stagedPartyRoles,
    };
  }

  // --- shared label helpers -----------------------------------------------------

  private difficultyBadge(d: DungeonDifficulty): string {
    return `<span class="df-badge ui-chip${d === 'heroic' ? ' heroic' : ''}">${esc(this.difficultyLabel(d))}</span>`;
  }

  private difficultyLabel(d: DungeonDifficulty): string {
    return d === 'heroic' ? t('hudChrome.finder.heroic') : t('hudChrome.finder.normal');
  }

  private kindLabel(kind: 'dungeon' | 'raid' | 'solo' | 'delve'): string {
    if (kind === 'delve') return t('hudChrome.adventureGuide.delve');
    if (kind === 'raid') return t('hudChrome.finder.kindRaid');
    if (kind === 'solo') return t('hudChrome.finder.kindSolo');
    return t('hudChrome.finder.kindDungeon');
  }

  // Count plus role label through one token template, so the ORDER belongs to the
  // locale (the icon is decoration and sits outside the localized run).
  private roleCountHtml(role: Role, n: number): string {
    return (
      `<span class="df-role-count" data-combat-role="${role}">${this.roleIcon(role)}` +
      `${esc(t('hudChrome.finder.roleCount', { count: num(n), role: this.roleLabel(role) }))}</span>`
    );
  }

  private roleLabel(role: Role): string {
    if (role === 'tank') return t('hudChrome.finder.roleTank');
    if (role === 'healer') return t('hudChrome.finder.roleHealer');
    return t('hudChrome.finder.roleDps');
  }

  // Decorative role glyph (aria-hidden inside svgIcon); the localized label
  // always rides beside it, so no accessible name is lost.
  private roleIcon(role: Role): string {
    return svgIcon(role === 'tank' ? 'tank' : role === 'healer' ? 'healer' : 'attack');
  }

  private levelsLabel(min: number, max: number): string {
    return min === max
      ? t('hudChrome.finder.levelOne', { level: num(min) })
      : t('hudChrome.finder.levels', { min: num(min), max: num(max) });
  }
}

function num(v: number): string {
  return formatNumber(v, { maximumFractionDigits: 0, useGrouping: false });
}

/** mm:ss through the same token pattern every other HUD clock uses. */
function mmss(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return t('hudChrome.finder.clock', {
    minutes: num(minutes),
    seconds: clockSeconds(seconds, true),
  });
}

function itemName(itemId: string): string {
  const item = ITEMS[itemId];
  return item ? tEntity({ kind: 'item', id: itemId, field: 'name' }) : itemId;
}
