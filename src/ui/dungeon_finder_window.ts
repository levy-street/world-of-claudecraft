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
import type { FinderListingTag } from '../sim/content/dungeon_finder';
import type { Role } from '../sim/content/talents';
import { ITEMS } from '../sim/data';
import type { DungeonDifficulty } from '../sim/types';
import type { DungeonFinderApplicantView, IWorld } from '../world_api';
import { markDialogRoot } from './dialog_root';
import {
  buildDungeonFinderView,
  type DungeonFinderViewModel,
  type FinderActivityDetailView,
  type FinderActivityRowView,
  type FinderBoardPanelView,
  type FinderClocksView,
  type FinderEncounterViewModel,
  type FinderListingRowView,
  type FinderLootGroupView,
  type FinderLootItemView,
  type FinderQueuePanelView,
  type FinderTab,
} from './dungeon_finder_view';
import { classDisplayName, dungeonDisplayName, tEntity, zoneDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t, tPlural } from './i18n';
import { QUALITY_COLOR } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { svgIcon } from './ui_icons';

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
  // Close the finder, open the world map, and ping the given overworld point
  // (the activity entrance). Never teleports.
  showOnMap(x: number, z: number): void;
}

export class DungeonFinderWindow {
  private tab: FinderTab = 'catalogue';
  private selectedActivityId: string | null = null;
  private stagedActivityIds = new Set<string>();
  private stagedTags = new Set<FinderListingTag>();
  private stagedListingActivity: string | null = null;
  // Mobile master-detail: which pane the single column shows.
  private pane: 'list' | 'detail' = 'list';
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  // Clock slots refreshed in place between structural rebuilds.
  private clockSlots = new Map<string, HTMLElement>();
  private lastClockText = new Map<string, string>();

  constructor(private readonly deps: DungeonFinderWindowDeps) {}

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
    if (tab) this.tab = tab;
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
    const view = buildDungeonFinderView({
      info: world.dungeonFinderInfo,
      board: world.dungeonFinderBoard,
      playerLevel: world.player.level,
      playerClass: world.cfg.playerClass,
      playerId: world.playerId,
      specRole: world.talentRole,
      party: party ? { leader: party.leader, size: party.members.length } : null,
      lockouts: world.raidLockouts(),
      tab: this.tab,
      selectedActivityId: this.selectedActivityId,
      stagedActivityIds: [...this.stagedActivityIds],
    });

    if (view.kind === 'loading') {
      if (this.lastSig === FINDER_LOADING_SIG) return;
      this.lastSig = FINDER_LOADING_SIG;
      el.innerHTML =
        this.titleHtml() + `<div class="df-note">${esc(t('hudChrome.finder.syncing'))}</div>`;
      el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
      return;
    }

    const sig = `${view.sig}|${this.pane}`;
    if (sig === this.lastSig) {
      this.updateClocks(view.clocks);
      return;
    }
    this.lastSig = sig;
    this.deps.hideTooltip();
    el.innerHTML = this.liveHtml(view);
    this.wire(el, view);
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
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    el.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tab = (btn as HTMLElement).dataset.tab as FinderTab;
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
      const activityId = this.stagedListingActivity ?? view.board.createOptions[0]?.id;
      if (!activityId) return;
      world().dungeonFinderListingCreate(activityId, [...this.stagedTags]);
      audio.click();
    });
    el.querySelector('[data-act="closelisting"]')?.addEventListener('click', () => {
      world().dungeonFinderListingClose();
      audio.click();
    });
    el.querySelector('[data-act="withdraw"]')?.addEventListener('click', () => {
      world().dungeonFinderApplyCancel();
      audio.click();
    });
    el.querySelectorAll('[data-apply]:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        world().dungeonFinderApply(Number((btn as HTMLElement).dataset.apply));
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
  }

  // ---- HTML builders ----------------------------------------------------------

  private titleHtml(): string {
    return (
      `<div class="panel-title"><span id="dfinder-title">${esc(t('hudChrome.finder.title'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.finder.close'))}">${svgIcon('close')}</button></div>`
    );
  }

  private liveHtml(view: Extract<DungeonFinderViewModel, { kind: 'live' }>): string {
    // A plain toggle-button group, deliberately NOT role=tablist: these are
    // aria-pressed buttons with no role=tab / aria-selected children and no
    // arrow-key roving focus, and a half-applied tablist reads worse to a screen
    // reader than none. Same reasoning for the catalogue rail below.
    const tabs = `<div class="df-tabs" role="group" aria-label="${esc(t('hudChrome.finder.title'))}">${(
      [
        ['catalogue', 'hudChrome.finder.tabCatalogue', 'skull'],
        ['queue', 'hudChrome.finder.tabQueue', 'social'],
        ['board', 'hudChrome.finder.tabBoard', 'chest'],
      ] as const
    )
      .map(
        ([tab, key, icon]) =>
          `<button type="button" class="df-tab${view.tab === tab ? ' active' : ''}" data-tab="${tab}" aria-pressed="${view.tab === tab ? 'true' : 'false'}">${svgIcon(icon)}${esc(t(key))}</button>`,
      )
      .join('')}</div>`;
    const proposal = view.queue.proposal ? this.proposalHtml(view.queue) : '';
    const body =
      view.tab === 'catalogue'
        ? this.catalogueHtml(view.rows, view.detail)
        : view.tab === 'queue'
          ? this.queueHtml(view.queue)
          : this.boardHtml(view.board);
    return `${this.titleHtml() + tabs + proposal}<div class="df-body${view.tab === 'catalogue' ? ' df-body-catalogue' : ''}">${body}</div>`;
  }

  // --- catalogue -----------------------------------------------------------

  private catalogueHtml(
    rows: FinderActivityRowView[],
    detail: FinderActivityDetailView | null,
  ): string {
    const rail = `<div class="df-rail" role="group" aria-label="${esc(
      t('hudChrome.finder.tabCatalogue'),
    )}">${rows.map((r) => this.rowHtml(r)).join('')}</div>`;
    const detailHtml = `<div class="df-detail">${detail ? this.detailHtml(detail) : ''}</div>`;
    return `<div class="df-cols df-pane-${this.pane}">${rail}${detailHtml}</div>`;
  }

  private rowHtml(r: FinderActivityRowView): string {
    const name = dungeonDisplayName(r.dungeonId);
    const badge = this.difficultyBadge(r.difficulty);
    const lock =
      r.lockedMinutes > 0
        ? `<span class="df-lock">${esc(t('hudChrome.finder.lockedFor', { minutes: num(r.lockedMinutes) }))}</span>`
        : '';
    const blocked = r.blocked ? `<span class="df-blocked">${esc(this.blockedLabel(r))}</span>` : '';
    return (
      `<button type="button" class="df-row${r.selected ? ' active' : ''}${r.eligible ? '' : ' ineligible'}" data-row="${esc(r.id)}" aria-pressed="${r.selected ? 'true' : 'false'}">` +
      `<img class="df-row-icon" src="${esc(r.portraitUrl)}" width="30" height="30" loading="lazy" decoding="async" alt="">` +
      `<span class="df-row-text"><span class="df-row-name">${esc(name)} ${badge}</span>` +
      `<span class="df-row-meta">${esc(this.levelsLabel(r.minLevel, r.maxLevel))} · ${esc(
        tPlural('hudChrome.plurals.finderPartySize', r.size, { count: num(r.size) }),
      )}</span>${lock}${blocked}</span></button>`
    );
  }

  private detailHtml(d: FinderActivityDetailView): string {
    const name = dungeonDisplayName(d.dungeonId);
    const back = `<button type="button" class="btn df-back" data-back>${esc(t('hudChrome.finder.back'))}</button>`;
    const finalEnc = d.encounters.find((e) => e.final) ?? d.encounters[d.encounters.length - 1];
    const headIcon = finalEnc
      ? `<img class="df-detail-icon" src="${esc(finalEnc.portraitUrl)}" width="40" height="40" loading="lazy" decoding="async" alt="">`
      : '';
    const head =
      `<div class="df-detail-head">${back}${headIcon}<span class="df-detail-name">${esc(name)}</span>` +
      `${this.difficultyBadge(d.difficulty)}<span class="df-kind">${esc(this.kindLabel(d.kind))}</span></div>`;
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
      `<div class="df-meta">` +
      `<div class="df-meta-row">${esc(this.levelsLabel(d.minLevel, d.maxLevel))} · ${esc(
        tPlural('hudChrome.plurals.finderPartySize', d.size, { count: num(d.size) }),
      )}</div>` +
      `<div class="df-meta-row">${comp}</div>` +
      `<div class="df-meta-row">${lockLine}</div>` +
      attunement +
      marks +
      `<div class="df-meta-row df-entrance">${esc(
        t('hudChrome.finder.entrance', { zone: zoneDisplayName(d.entrance.zoneId) }),
      )} <button type="button" class="btn df-map-btn" data-showmap>${esc(t('hudChrome.finder.showOnMap'))}</button></div>` +
      `</div>`;
    const encounters =
      `<div class="df-sub">${esc(t('hudChrome.finder.encounters'))}</div>` +
      d.encounters.map((e) => this.encounterHtml(e)).join('');
    return head + meta + encounters;
  }

  private encounterHtml(e: FinderEncounterViewModel): string {
    const name = tEntity({ kind: 'mob', id: e.mobId, field: 'name' });
    const flags = [
      e.final ? t('hudChrome.finder.finalBoss') : null,
      e.summoned ? t('hudChrome.finder.summoned') : null,
    ]
      .filter((f): f is string => f !== null)
      .map((f) => `<span class="df-flag">${esc(f)}</span>`)
      .join('');
    const mechanics =
      e.mechanics.length > 0
        ? `<div class="df-mechanics">${e.mechanics
            .map(
              (m) =>
                `<span class="df-chip">${esc(t(`hudChrome.finder.mech.${m}` as TranslationKey))}</span>`,
            )
            .join('')}</div>`
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
      ...e.heroicGroups.map((g) => this.lootGroupHtml(g, 'hudChrome.finder.lootHeroic')),
    ].join('');
    const money =
      e.copper > 0 ? `<div class="df-loot-money">${this.deps.moneyHtml(e.copper)}</div>` : '';
    return (
      `<div class="df-encounter">` +
      `<img class="df-portrait" src="${esc(e.portraitUrl)}" width="64" height="64" loading="lazy" decoding="async" alt="">` +
      `<div class="df-encounter-body"><div class="df-encounter-name">${esc(name)}${flags}</div>` +
      mechanics +
      `<div class="df-loot">${lootSections}${money}</div></div></div>`
    );
  }

  private lootGroupHtml(group: FinderLootGroupView, labelKey: TranslationKey): string {
    return (
      `<div class="df-loot-sub">${esc(t(labelKey))}</div>` +
      group.items.map((i) => this.lootItemHtml(i, !group.guaranteed)).join('')
    );
  }

  private lootItemHtml(i: FinderLootItemView, showChance: boolean): string {
    const item = ITEMS[i.itemId];
    if (!item) return '';
    const name = `<span class="df-loot-name" style="color: ${QUALITY_COLOR[i.quality]}">${esc(
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
          `<button type="button" class="btn df-accept" data-act="accept">${esc(t('hudChrome.finder.accept'))}</button>` +
          `<button type="button" class="btn df-decline" data-act="decline">${esc(t('hudChrome.finder.decline'))}</button></div>`
        : `<div class="df-note">${esc(t('hudChrome.finder.acceptedWait'))}</div>`;
    return (
      `<div class="df-proposal" role="alert">` +
      `<div class="df-proposal-title">${esc(t('hudChrome.finder.proposalTitle', { name }))} ${this.difficultyBadge(p.difficulty)}</div>` +
      `<div class="df-proposal-meta">${this.roleIcon(p.role)}${esc(t('hudChrome.finder.proposalRole', { role: this.roleLabel(p.role) }))}` +
      ` · <span data-df-clock="accepted"></span> · <span data-df-clock="remaining"></span></div>` +
      answer +
      `</div>`
    );
  }

  private queueHtml(q: FinderQueuePanelView): string {
    if (q.needsSpec) {
      return `<div class="df-note">${esc(t('hudChrome.finder.needsSpec'))}</div>`;
    }
    const roles =
      `<div class="df-sub">${esc(t('hudChrome.finder.yourRoles'))}</div><div class="df-roles">` +
      q.roles
        .map(
          (r) =>
            `<button type="button" class="df-role${r.selected ? ' active' : ''}" data-role="${r.role}" aria-pressed="${r.selected ? 'true' : 'false'}"${r.eligible ? '' : ' disabled'}>${this.roleIcon(r.role)}${esc(this.roleLabel(r.role))}</button>`,
        )
        .join('') +
      `</div>`;
    const leaderNote =
      q.inParty && !q.isLeader
        ? `<div class="df-note">${esc(t('hudChrome.finder.leaderNote'))}</div>`
        : '';
    const options =
      `<div class="df-sub">${esc(t('hudChrome.finder.chooseActivities'))}</div><div class="df-options">` +
      q.options
        .map((o) => {
          const name = dungeonDisplayName(o.dungeonId);
          const disabled = !o.eligible || q.queued;
          return `<button type="button" class="df-opt${o.checked ? ' active' : ''}" data-opt="${esc(o.id)}" role="checkbox" aria-checked="${o.checked ? 'true' : 'false'}"${disabled ? ' disabled' : ''}>${esc(name)} ${this.difficultyBadge(o.difficulty)}</button>`;
        })
        .join('') +
      `</div>`;
    const status = q.queued
      ? `<div class="df-queue-status">${svgIcon('social')} <span data-df-clock="waited"></span></div>` +
        `<button type="button" class="btn leave" data-act="leavequeue">${esc(t('hudChrome.finder.leaveQueue'))}</button>`
      : q.onCooldown
        ? `<div class="df-note df-warn" data-df-clock="cooldown"></div>`
        : `<button type="button" class="btn df-join" data-act="join"${q.canQueue ? '' : ' disabled'}>${esc(t('hudChrome.finder.joinQueue'))}</button>`;
    const travel = `<div class="df-note">${esc(t('hudChrome.finder.travelNote'))}</div>`;
    return roles + leaderNote + options + `<div class="df-footer">${status}</div>` + travel;
  }

  // --- premade board -----------------------------------------------------------

  private boardHtml(b: FinderBoardPanelView): string {
    const mine = b.myListing ? this.myListingHtml(b) : '';
    const create = !b.myListing ? this.createHtml(b) : '';
    const rows =
      b.listings.length > 0
        ? b.listings.map((l) => this.listingHtml(l)).join('')
        : `<div class="df-note">${esc(t('hudChrome.finder.boardEmpty'))}</div>`;
    return (
      mine +
      create +
      `<div class="df-sub">${esc(t('hudChrome.finder.openListings'))}</div><div class="df-listings">${rows}</div>`
    );
  }

  private createHtml(b: FinderBoardPanelView): string {
    if (!b.canCreate) {
      return b.createGate === 'leader'
        ? `<div class="df-note">${esc(t('hudChrome.finder.boardLeaderGate'))}</div>`
        : '';
    }
    if (b.createOptions.length === 0) return '';
    const selected = this.stagedListingActivity ?? b.createOptions[0].id;
    const options = b.createOptions
      .map(
        (o) =>
          `<button type="button" class="df-opt df-createopt${o.id === selected ? ' active' : ''}" data-createopt="${esc(o.id)}" role="radio" aria-checked="${o.id === selected ? 'true' : 'false'}">${esc(dungeonDisplayName(o.dungeonId))} ${this.difficultyBadge(o.difficulty)}</button>`,
      )
      .join('');
    const tags = b.tags
      .map(
        (tag) =>
          `<button type="button" class="df-chip df-tag${this.stagedTags.has(tag) ? ' active' : ''}" data-tag="${tag}" role="checkbox" aria-checked="${this.stagedTags.has(tag) ? 'true' : 'false'}">${esc(this.tagLabel(tag))}</button>`,
      )
      .join('');
    return (
      `<div class="df-create"><div class="df-sub">${esc(t('hudChrome.finder.publishListing'))}</div>` +
      `<div class="df-sub">${esc(t('hudChrome.finder.activity'))}</div>` +
      `<div class="df-options" role="radiogroup">${options}</div>` +
      `<div class="df-create-tags">${tags}</div>` +
      `<button type="button" class="btn df-create-btn" data-act="create">${esc(t('hudChrome.finder.publish'))}</button></div>`
    );
  }

  private myListingHtml(b: FinderBoardPanelView): string {
    const mine = b.myListing;
    if (!mine) return '';
    const applicants =
      mine.applicants.length > 0
        ? mine.applicants.map((a) => this.applicantHtml(a)).join('')
        : `<div class="df-note">${esc(t('hudChrome.finder.noApplicants'))}</div>`;
    return (
      `<div class="df-mine"><div class="df-sub">${esc(t('hudChrome.finder.yourListing'))}</div>` +
      `<div class="df-mine-tags">${mine.tags.map((tag) => `<span class="df-chip">${esc(this.tagLabel(tag))}</span>`).join('')}</div>` +
      `<div class="df-sub">${esc(t('hudChrome.finder.applicants'))}</div>${applicants}` +
      `<button type="button" class="btn leave" data-act="closelisting">${esc(t('hudChrome.finder.closeListing'))}</button></div>`
    );
  }

  private applicantHtml(a: DungeonFinderApplicantView): string {
    const roles = a.roles.map((r) => `${this.roleIcon(r)}${esc(this.roleLabel(r))}`).join(' / ');
    return (
      `<div class="df-applicant"><span class="df-app-name">${esc(a.name)}</span>` +
      `<span class="df-app-meta">${esc(
        t('hudChrome.finder.levelClass', {
          level: num(a.level),
          className: classDisplayName(a.cls),
        }),
      )} · ${roles}</span>` +
      `<span class="df-app-actions">` +
      `<button type="button" class="btn df-accept" data-appacc="${a.pid}" aria-label="${esc(t('hudChrome.finder.acceptApplicantAria', { name: a.name }))}">${esc(t('hudChrome.finder.accept'))}</button>` +
      `<button type="button" class="btn df-decline" data-appdec="${a.pid}" aria-label="${esc(t('hudChrome.finder.declineApplicantAria', { name: a.name }))}">${esc(t('hudChrome.finder.decline'))}</button>` +
      `</span></div>`
    );
  }

  private listingHtml(l: FinderListingRowView): string {
    const name = dungeonDisplayName(l.dungeonId);
    const neededRoles = l.needed
      ? (
          [
            ['tank', l.needed.tank],
            ['healer', l.needed.healer],
            ['dps', l.needed.dps],
          ] as const
        )
          .filter(([, n]) => n > 0)
          .map(([role, n]) => this.roleCountHtml(role, n))
          .join(' ')
      : '';
    // The prefix is part of the template ('Needs {roles}'), never a concat: a locale
    // owns where the roles sit in the sentence.
    const needed = neededRoles
      ? `<span class="df-needed">${htmlTemplate('hudChrome.finder.needs', { roles: neededRoles })}</span>`
      : '';
    const members = l.members
      .map(
        (m) =>
          `<span class="df-member" title="${esc(
            t('hudChrome.finder.levelClass', {
              level: num(m.level),
              className: classDisplayName(m.cls),
            }),
          )}">${m.role ? this.roleIcon(m.role) : ''}${esc(classDisplayName(m.cls))}</span>`,
      )
      .join('');
    const tags = l.tags
      .map((tag) => `<span class="df-chip">${esc(this.tagLabel(tag))}</span>`)
      .join('');
    const action = l.mine
      ? `<span class="df-chip">${esc(t('hudChrome.finder.yourListing'))}</span>`
      : l.applied
        ? `<button type="button" class="btn leave" data-act="withdraw">${esc(t('hudChrome.finder.withdraw'))}</button>`
        : `<button type="button" class="btn df-apply" data-apply="${l.id}"${l.canApply ? '' : ' disabled'}>${esc(t('hudChrome.finder.apply'))}</button>`;
    return (
      `<div class="df-listing"><div class="df-listing-head"><span class="df-listing-name">${esc(name)} ${this.difficultyBadge(l.difficulty)}</span>` +
      `<span class="df-listing-size">${esc(
        t('hudChrome.finder.slots', { size: num(l.size), capacity: num(l.capacity) }),
      )}</span></div>` +
      `<div class="df-listing-meta">${esc(t('hudChrome.finder.leader', { name: l.leaderName }))}${needed ? ` · ${needed}` : ''}</div>` +
      `<div class="df-listing-members">${members}</div>` +
      (tags ? `<div class="df-listing-tags">${tags}</div>` : '') +
      `<div class="df-listing-action">${action}</div></div>`
    );
  }

  // --- shared label helpers -----------------------------------------------------

  private difficultyBadge(d: DungeonDifficulty): string {
    return `<span class="df-badge${d === 'heroic' ? ' heroic' : ''}">${esc(this.difficultyLabel(d))}</span>`;
  }

  private difficultyLabel(d: DungeonDifficulty): string {
    return d === 'heroic' ? t('hudChrome.finder.heroic') : t('hudChrome.finder.normal');
  }

  private kindLabel(kind: 'dungeon' | 'raid' | 'solo'): string {
    if (kind === 'raid') return t('hudChrome.finder.kindRaid');
    if (kind === 'solo') return t('hudChrome.finder.kindSolo');
    return t('hudChrome.finder.kindDungeon');
  }

  // Count plus role label through one token template, so the ORDER belongs to the
  // locale (the icon is decoration and sits outside the localized run).
  private roleCountHtml(role: Role, n: number): string {
    return (
      `<span class="df-role-count">${this.roleIcon(role)}` +
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

  private tagLabel(tag: FinderListingTag): string {
    const keys: Record<FinderListingTag, TranslationKey> = {
      first_run: 'hudChrome.finder.tagFirstRun',
      quest_run: 'hudChrome.finder.tagQuestRun',
      full_clear: 'hudChrome.finder.tagFullClear',
      learning: 'hudChrome.finder.tagLearning',
      fast_run: 'hudChrome.finder.tagFastRun',
    };
    return t(keys[tag]);
  }

  private levelsLabel(min: number, max: number): string {
    return min === max
      ? t('hudChrome.finder.levelOne', { level: num(min) })
      : t('hudChrome.finder.levels', { min: num(min), max: num(max) });
  }

  private blockedLabel(r: FinderActivityRowView): string {
    return r.blocked === 'spec'
      ? t('hudChrome.finder.blockedSpec')
      : t('hudChrome.finder.blockedLevel', { min: num(r.minLevel), max: num(r.maxLevel) });
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
    seconds: String(seconds).padStart(2, '0'),
  });
}

/**
 * A t() template whose values are already-built, trusted HTML fragments (an icon plus an
 * escaped label). The template TEXT is escaped and the fragments are spliced after, so a
 * locale still owns the sentence order and our own markup is not double-escaped.
 */
function htmlTemplate(key: TranslationKey, parts: Record<string, string>): string {
  // A control character no localized value can contain, so the splice can never
  // collide with a real word of the template.
  const mark = String.fromCharCode(1);
  const values: Record<string, string> = {};
  for (const name of Object.keys(parts)) values[name] = `${mark}${name}${mark}`;
  return esc(t(key, values)).replace(
    new RegExp(`${mark}(\\w+)${mark}`, 'g'),
    (_m, name: string) => parts[name] ?? '',
  );
}

function itemName(itemId: string): string {
  const item = ITEMS[itemId];
  return item ? tEntity({ kind: 'item', id: itemId, field: 'name' }) : itemId;
}
