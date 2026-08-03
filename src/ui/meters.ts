// Party combat meters: damage / healing / threat, segmented into encounters.
// An encounter starts on the first party damage/heal event and ends after a
// few seconds with no party combat activity AND no visible mob holding aggro
// on a party member. Finished encounters land in a small history and fold
// into the session "All" segment; the panel pages between them.
//
// "Threat" shows the engaged mob's REAL hate table (entity.threat, classic
// rules: damage x stance modifiers, flat ability threat, split healing
// threat — synced online as the top entries) and marks who the mob is
// actually targeting (aggroTargetId). For finished encounters whose mob is
// gone, it falls back to each member's damage on that mob.
//
// A controlled pet (hunter, warlock, mage) is NOT its own row: its output folds
// into its owner's, the way a real damage meter reports a hunter. The pet's
// name survives on the per-ability breakdown entries, and that split is painted
// INTO the panel under the owner's bar ("Emberkin: Firebolt"), not only into the
// hover tooltip: your own bar starts open, so a solo pet class reads what the
// pet contributed without knowing to hover. Any bar opens and closes on press.

import { CLASSES } from '../sim/data';
import type { SimEvent } from '../sim/types';
import type { IWorld } from '../world_api';
import { abilityDisplayNameFromSource } from './ability_display_name';
import { tEntity } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import {
  type BreakdownEntry,
  type BreakdownRow,
  breakdownKey,
  buildMeterBreakdown,
} from './meters_breakdown_view';
import { MeterFrame } from './meters_frame';
import { METER_FRAME_LIMITS, TABBED_METER_FRAME_LIMITS } from './meters_frame_core';
import { buildMeterList } from './meters_list_view';
import { buildMeterTabMenu, type MeterMenuRow } from './meters_menu_view';
import { buildMeterRows, type MeterPet, type MeterTab } from './meters_rows_view';
import type { SimpleMenuItem } from './simple_context_menu';

const ENCOUNTER_END_SECONDS = 5;
const HISTORY_CAP = 8;

export interface MemberTally {
  pid: number;
  name: string;
  cls: string | null;
  dmg: number;
  heal: number;
  /** damage per mob entity id (current/previous encounters only) */
  dmgByMob: Map<number, number>;
  /** damage per ability (pet output keyed under the pet's name) */
  dmgByAbility: Map<string, BreakdownEntry>;
  /** healing per ability */
  healByAbility: Map<string, BreakdownEntry>;
}

/** Who a combat event's damage/healing belongs to once pets fold into owners. */
interface Attribution {
  pid: number;
  name: string;
  cls: string | null;
  /** display name of the acting pet, or null when the member acted directly */
  petName: string | null;
}

function addBreakdown(
  map: Map<string, BreakdownEntry>,
  petName: string | null,
  ability: string | null,
  amount: number,
): void {
  const key = breakdownKey(petName, ability);
  const entry = map.get(key);
  if (entry) {
    entry.amount += amount;
    return;
  }
  map.set(key, { ability, petName, amount });
}

export interface Encounter {
  /** English name of the beefiest mob fought: the segment's IDENTITY */
  label: string;
  /** template id behind `label`, so the segment name localizes at render time */
  labelTemplateId: string | null;
  /** ms epoch of first activity */
  startedAt: number;
  /** seconds of combat (live encounters: now - startedAt) */
  duration: number;
  tallies: Map<number, MemberTally>;
  /** mob entity id the Threat tab reports on */
  mainMobId: number | null;
  mainMobName: string;
  /** template id of the threat-subject mob, so its name localizes at render time */
  mainMobTemplateId: string | null;
  /** maxHp of the biggest mob damaged — used to pick the label */
  biggestMobHp: number;
  /** maxHp of the current threat subject, so a boss still outranks its adds */
  subjectMaxHp: number;
}

function newEncounter(now: number): Encounter {
  return {
    label: 'Combat',
    labelTemplateId: null,
    startedAt: now,
    duration: 0,
    tallies: new Map(),
    mainMobId: null,
    mainMobName: '',
    mainMobTemplateId: null,
    biggestMobHp: -1,
    subjectMaxHp: -1,
  };
}

export class MeterData {
  current: Encounter | null = null;
  history: Encounter[] = [];
  allTime: Encounter;
  private lastActivity = 0;

  constructor(now: number) {
    this.allTime = { ...newEncounter(now), label: 'All (session)' };
  }

  private tally(
    enc: Encounter,
    pid: number,
    name: string,
    cls: string | null,
    partyPids: Set<number>,
  ): MemberTally {
    let t = enc.tallies.get(pid);
    if (t) return t;
    // a reconnect issues the same character a new entity id mid-encounter; find
    // its previous row by name and re-key it instead of starting a duplicate.
    // Only treat a name match as a reconnect when the old pid is no longer a
    // live party member: pet names come from their template/tamed-target name
    // and are not unique, so two live same-named pets must stay separate
    // rows instead of ping-ponging the merge back and forth.
    for (const [oldPid, existing] of enc.tallies) {
      if (existing.name === name && oldPid !== pid && !partyPids.has(oldPid)) {
        enc.tallies.delete(oldPid);
        existing.pid = pid;
        existing.cls = cls ?? existing.cls;
        enc.tallies.set(pid, existing);
        return existing;
      }
    }
    t = {
      pid,
      name,
      cls,
      dmg: 0,
      heal: 0,
      dmgByMob: new Map(),
      dmgByAbility: new Map(),
      healByAbility: new Map(),
    };
    enc.tallies.set(pid, t);
    return t;
  }

  /**
   * Resolve the row a combat event belongs to. A controlled pet reports its
   * OWNER (folding hunter/warlock/mage pet output into the player's row) and
   * keeps its own name for the breakdown; anything else reports itself.
   */
  private attribute(world: IWorld, sourceId: number, partyPids: Set<number>): Attribution {
    const src = world.entities.get(sourceId);
    const ownerId = src?.kind === 'mob' ? (src.ownerId ?? null) : null;
    const owned = ownerId !== null && partyPids.has(ownerId);
    const pid = owned && ownerId !== null ? ownerId : sourceId;
    const petName = owned ? (src?.name ?? null) : null;
    const member = world.partyInfo?.members.find((m) => m.pid === pid);
    const entity = world.entities.get(pid);
    return {
      pid,
      name: member?.name ?? entity?.name ?? `#${pid}`,
      cls: member?.cls ?? (pid === world.player.id ? world.player.templateId : null),
      petName,
    };
  }

  /** party membership check is supplied by the caller (self + party pids) */
  onEvent(ev: SimEvent, world: IWorld, partyPids: Set<number>, now: number): void {
    if (ev.type !== 'damage' && ev.type !== 'heal2') return;
    // The HoT-application sound cue (Sim.applyAura, cueOnly:true) is audio-only
    // and must not open or keep alive an otherwise-idle encounter segment. Gated
    // on the explicit flag, not amount === 0: a genuine direct heal (applyHeal)
    // can also legitimately land at amount 0 (full HP, fully absorbed) and that
    // real cast should still count as party activity.
    if (ev.type === 'heal2' && ev.cueOnly) return;
    const sourceInParty = partyPids.has(ev.sourceId);
    const targetInParty = partyPids.has(ev.targetId);
    if (!sourceInParty && !targetInParty) return;

    // any party-involved combat keeps the encounter alive (tanking without
    // dealing damage must not end the segment)
    if (!this.current) this.current = newEncounter(now);
    this.lastActivity = now;

    if (ev.type === 'damage' && sourceInParty && ev.kind === 'hit' && ev.amount > 0) {
      const target = world.entities.get(ev.targetId);
      if (target && target.kind === 'mob') {
        const who = this.attribute(world, ev.sourceId, partyPids);
        for (const enc of [this.current, this.allTime]) {
          const t = this.tally(enc, who.pid, who.name, who.cls, partyPids);
          t.dmg += ev.amount;
          addBreakdown(t.dmgByAbility, who.petName, ev.ability, ev.amount);
          if (enc === this.current) {
            t.dmgByMob.set(ev.targetId, (t.dmgByMob.get(ev.targetId) ?? 0) + ev.amount);
          }
        }
        // Segment IDENTITY: the beefiest mob the party fought, and nothing
        // re-points it afterwards. A pull routinely outlives its boss (adds
        // keep swinging, the party grabs the next group inside the same
        // segment), so letting a later mob claim the name would file a boss
        // kill in the history under a trash mob.
        if (target.maxHp > this.current.biggestMobHp) {
          this.current.biggestMobHp = target.maxHp;
          this.current.label = target.name;
          this.current.labelTemplateId = target.templateId;
        }
        // Threat SUBJECT: tracked SEPARATELY from the identity above, because
        // the tab needs a mob that is still there. Kill the pull and grab the
        // next one (or lose the old one out of the interest-scoped entity map)
        // and a size-only rule leaves the subject pinned to a corpse: the
        // Threat tab then has no live hate table, silently falls back to the
        // damage dealt to that corpse, and reads FROZEN for the rest of the
        // segment while the party fights something else. Once the subject is
        // dead or gone, the next mob damaged takes over regardless of size;
        // while it is alive the beefiest-mob rule is untouched, so a boss still
        // outranks its adds.
        if (this.subjectLost(world) || target.maxHp > this.current.subjectMaxHp) {
          this.current.subjectMaxHp = target.maxHp;
          this.current.mainMobName = target.name;
          this.current.mainMobTemplateId = target.templateId;
          this.current.mainMobId = ev.targetId;
        }
      }
    } else if (ev.type === 'heal2' && sourceInParty && ev.amount > 0) {
      const who = this.attribute(world, ev.sourceId, partyPids);
      for (const enc of [this.current, this.allTime]) {
        const t = this.tally(enc, who.pid, who.name, who.cls, partyPids);
        t.heal += ev.amount;
        addBreakdown(t.healByAbility, who.petName, ev.ability, ev.amount);
      }
    }
  }

  /**
   * True when the live segment's threat subject can no longer carry the Threat
   * tab: it died, or it is no longer in the world view at all (the entity map
   * is interest-scoped online, and a despawn drops it offline).
   */
  private subjectLost(world: IWorld): boolean {
    const id = this.current?.mainMobId ?? null;
    if (id === null) return true;
    const mob = world.entities.get(id);
    return !mob || mob.dead;
  }

  /** advance clocks + close the encounter once combat has clearly ended */
  update(world: IWorld, partyPids: Set<number>, now: number): void {
    if (!this.current) return;
    this.current.duration = Math.max(1, (now - this.current.startedAt) / 1000);
    if ((now - this.lastActivity) / 1000 < ENCOUNTER_END_SECONDS) return;
    // quiet for a while — but a mob still chasing a member keeps it open
    for (const e of world.entities.values()) {
      if (
        e.kind === 'mob' &&
        !e.dead &&
        e.aggroTargetId !== null &&
        partyPids.has(e.aggroTargetId)
      ) {
        return;
      }
    }
    this.endEncounter(now);
  }

  endEncounter(now: number): void {
    const enc = this.current;
    if (!enc) return;
    this.current = null;
    if (enc.tallies.size === 0) return; // nothing measured — drop it
    enc.duration = Math.max(1, (this.lastActivity - enc.startedAt) / 1000);
    this.history.unshift(enc);
    if (this.history.length > HISTORY_CAP) this.history.pop();
    this.allTime.duration += enc.duration;
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

// The three meters; the canonical union lives with the row model core.
type Tab = MeterTab;

const TAB_LABEL_KEY: Record<Tab, TranslationKey> = {
  dmg: 'hud.meters.damage',
  heal: 'hud.meters.healing',
  threat: 'hud.meters.threat',
};
const TAB_SHORT_LABEL_KEY: Record<Tab, TranslationKey> = {
  dmg: 'hud.meters.damageShort',
  heal: 'hud.meters.healingShort',
  threat: 'hud.meters.threat',
};
/** Hud's shared tooltip painter plus the browser surfaces the frames need. */
export interface MetersDeps {
  attachTooltip: (el: HTMLElement, html: () => string) => void;
  /** Live UI zoom factor; the frame controller divides by it for author px. */
  uiScale?: () => number;
  /** Mobile-touch probe: the stylesheet owns panel placement there. */
  isMobileLayout?: () => boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Hud's shared right-click menu, injected so meters.ts never imports Hud. */
  openMenu?: (
    items: readonly SimpleMenuItem[],
    x: number,
    y: number,
    onSelect: (act: string) => void,
  ) => void;
}

/** A live controlled pet, resolved from the world for the threat tab. */
type Pet = MeterPet;

/**
 * One pooled line: a member's bar, or one row of an open member's split. Lines
 * are reused across renders (never rebuilt from innerHTML) so the tooltip can be
 * attached ONCE per node: rebuilding the row under the cursor at the 4Hz render
 * cadence would drop the hover and make the breakdown flicker. The tooltip
 * closure and the click handler read `pid`/`name`/`kind` LIVE off this record
 * instead of capturing them.
 */
interface MeterRowNodes {
  el: HTMLElement;
  fill: HTMLElement;
  label: HTMLElement;
  num: HTMLElement;
  /** the member this line belongs to (an ability line carries its owner) */
  pid: number;
  name: string;
  kind: 'member' | 'ability';
}

/** What a panel needs from its owner: the shared data and the live world. */
interface PanelHost {
  world: IWorld;
  data: MeterData;
  /** Live pets per owner, scanned once per render by the owner. */
  petsByOwner(): Map<number, Pet[]>;
  attachTooltip(el: HTMLElement, html: () => string): void;
  /** Fired by a detached panel's close button. */
  onDock(tab: DetachableTab): void;
  /** Whether `tab` currently has its own window. */
  isDetached(tab: MeterTab): boolean;
  /** Open the tab's right-click menu at a viewport point. */
  openTabMenu(rows: MeterMenuRow[], x: number, y: number): void;
}

export interface PanelSpec {
  root: HTMLElement;
  /** null = the tabbed damage window; a tab = a detached single-meter window. */
  lockedTab: DetachableTab | null;
  /** localStorage key this panel's box persists under. */
  frameStorageKey: string;
}

/**
 * One meter panel: the bar list plus its own segment paging, tooltip pool and
 * movable/resizable frame. Instance-parameterized so the tabbed damage window
 * and each detached Threat / Healing window are the SAME painter over the one
 * shared MeterData, rather than three drifting copies.
 */
export class MetersPanel {
  private tab: Tab;
  /** 0 = current/latest, 1..N = history entries, N+1 = all-time */
  private viewIdx = 0;
  private lastRender = 0;
  private readonly root: HTMLElement;
  private readonly rowsEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private rowPool: MeterRowNodes[] = [];
  private frame: MeterFrame | null = null;
  /**
   * Explicit expand/collapse choices; anything absent takes the default. Keyed
   * by pid and kept for the panel's LIFETIME on purpose: a player who opened a
   * raid member's split wants it open on the next pull too, and paging back
   * through history must not silently re-collapse what they opened.
   */
  private readonly expandOverride = new Map<number, boolean>();

  constructor(
    private readonly spec: PanelSpec,
    private readonly host: PanelHost,
    deps?: MetersDeps,
  ) {
    this.tab = spec.lockedTab ?? 'dmg';
    this.root = spec.root;
    this.rowsEl = this.root.querySelector('.mt-rows') as HTMLElement;
    this.titleEl = this.root.querySelector('.mt-view') as HTMLElement;
    this.subEl = this.root.querySelector('.mt-sub') as HTMLElement;
    this.hintEl = this.root.querySelector('.mt-hint') as HTMLElement;

    if (!spec.lockedTab) {
      for (const tab of ['dmg', 'heal', 'threat'] as Tab[]) {
        const tabButton = this.root.querySelector(`.mt-tab[data-tab="${tab}"]`) as HTMLElement;
        tabButton.textContent = t(TAB_SHORT_LABEL_KEY[tab]);
        tabButton.addEventListener('click', () => {
          this.tab = tab;
          this.refreshTabs();
          this.render(true);
        });
        // Right-clicking a tab NAME offers that meter's own window: "Separate"
        // while it is docked, "Regroup" once it has one. Damage is the home
        // meter and yields no rows, so its right-click is left alone rather
        // than opening an inert menu.
        tabButton.addEventListener('contextmenu', (ev) => {
          const rows = buildMeterTabMenu({
            tab,
            detached: host.isDetached(tab),
            detachable: DETACHABLE,
          });
          if (rows.length === 0) return;
          ev.preventDefault();
          ev.stopPropagation();
          host.openTabMenu(rows, ev.clientX, ev.clientY);
        });
      }
      this.refreshTabs();
    } else {
      const label = this.root.querySelector('.mt-title-label') as HTMLElement | null;
      if (label) label.textContent = t(TAB_LABEL_KEY[spec.lockedTab]);
    }

    const prev = this.root.querySelector('.mt-prev') as HTMLElement;
    const next = this.root.querySelector('.mt-next') as HTMLElement;
    const close = this.root.querySelector('.mt-close') as HTMLElement;
    prev.setAttribute('title', t('hud.meters.olderSegment'));
    next.setAttribute('title', t('hud.meters.newerSegment'));
    const closeKey: TranslationKey = spec.lockedTab ? 'hudChrome.meters.dock' : 'hud.meters.close';
    close.setAttribute('title', t(closeKey));
    close.setAttribute('aria-label', t(closeKey));
    prev.addEventListener('click', () => this.page(1));
    next.addEventListener('click', () => this.page(-1));
    close.addEventListener('click', () => {
      if (spec.lockedTab) host.onDock(spec.lockedTab);
      else this.setOpen(false);
    });

    // The panel title doubles as the move handle (the chat box uses its tab
    // strip the same way); a press on any button inside it stays that button's.
    const title = this.root.querySelector('.panel-title') as HTMLElement | null;
    if (title && deps?.storage && deps.uiScale && deps.isMobileLayout) {
      this.frame = new MeterFrame(
        {
          el: this.root,
          handles: [title, this.titleEl],
          storageKey: spec.frameStorageKey,
          fallbackSize: { w: METERS_DEFAULT_WIDTH, h: METERS_DEFAULT_HEIGHT },
          // The tabbed window cannot shrink past its own chrome; a detached
          // window carries far less and may go narrower.
          limits: spec.lockedTab ? METER_FRAME_LIMITS : TABBED_METER_FRAME_LIMITS,
        },
        {
          document,
          window,
          storage: deps.storage,
          isMobileLayout: deps.isMobileLayout,
          uiScale: deps.uiScale,
        },
      );
      this.frame.init();
    }
  }

  get element(): HTMLElement {
    return this.root;
  }

  get isOpen(): boolean {
    // A framed panel lays out as a column, an unframed one as a plain block;
    // either value means open, and only 'none' / '' mean closed.
    const { display } = this.root.style;
    return display === 'block' || display === 'flex';
  }

  setOpen(on: boolean): void {
    this.root.style.display = on ? (this.frame?.isFramed ? 'flex' : 'block') : 'none';
    if (!this.spec.lockedTab) document.body.classList.toggle('meters-open', on);
    if (on) {
      // A box saved at another viewport must be re-clamped before it paints.
      this.frame?.refresh();
      this.render(true);
    }
  }

  /** Switch the tabbed window's meter (used when a tab pops out). */
  showTab(tab: Tab): void {
    if (this.spec.lockedTab) return;
    this.tab = tab;
    this.refreshTabs();
    this.render(true);
  }

  get activeTab(): Tab {
    return this.tab;
  }

  /** Drop this panel's custom box, returning it to the stylesheet anchor. */
  resetFrame(): void {
    this.frame?.reset();
  }

  private page(dir: number): void {
    const max = this.host.data.history.length + 1; // + all-time slot
    this.viewIdx = Math.max(0, Math.min(max, this.viewIdx + dir));
    this.render(true);
  }

  private refreshTabs(): void {
    this.root.querySelectorAll('.mt-tab').forEach((el) => {
      el.classList.toggle('on', (el as HTMLElement).dataset.tab === this.tab);
    });
  }

  /** Called on the hud frame; repaints at ~4Hz while open. */
  update(now: number): void {
    if (!this.isOpen || now - this.lastRender < 250) return;
    this.render();
  }

  private viewedEncounter(): { enc: Encounter | null; viewName: string } {
    const h = this.host.data.history;
    if (this.viewIdx === h.length + 1 || (this.viewIdx > 0 && h.length === 0)) {
      return { enc: this.host.data.allTime, viewName: t('hud.meters.allSession') };
    }
    if (this.viewIdx === 0) {
      const enc = this.host.data.current ?? h[0] ?? null;
      return {
        enc,
        viewName: this.host.data.current
          ? t('hud.meters.current')
          : enc
            ? t('hud.meters.lastFight')
            : t('hud.meters.current'),
      };
    }
    return {
      enc: h[this.viewIdx - 1] ?? null,
      viewName: t('hud.meters.fightIndex', { index: this.viewIdx }),
    };
  }

  render(force = false): void {
    if (!this.isOpen && !force) return;
    this.lastRender = performance.now();
    const { enc, viewName } = this.viewedEncounter();
    this.titleEl.textContent = t('hud.meters.title', {
      tab: t(TAB_LABEL_KEY[this.tab]),
      view: viewName,
    });

    if (!enc || enc.tallies.size === 0) {
      this.subEl.textContent = t('hud.meters.noCombat');
      // The auto-show hint only makes sense on the live "current" segment of the
      // damage/healing tabs: on the Threat tab, or on a finished History / All
      // (session) segment, the copy ("rows appear once your party deals damage",
      // "this segment closes after combat ends") is wrong. Its own element (its
      // own single t() key), never concatenated into subEl.
      const showHint = this.viewIdx === 0 && this.tab !== 'threat';
      this.hintEl.textContent = showHint ? t('hudChrome.meters.autoShowHint') : '';
      this.hintEl.style.display = showHint ? 'block' : 'none';
      // Hide, never innerHTML='': the pooled rows own their attached tooltips.
      for (const row of this.rowPool) row.el.style.display = 'none';
      return;
    }
    this.hintEl.textContent = '';
    this.hintEl.style.display = 'none';

    const isThreat = this.tab === 'threat';
    const world = this.host.world;
    const mob = isThreat && enc.mainMobId !== null ? world.entities.get(enc.mainMobId) : null;
    const aggroPid = mob && !mob.dead ? mob.aggroTargetId : null;
    // Two different mobs once a boss dies mid-segment: the segment keeps the
    // boss's name, the Threat tab follows whatever is still alive.
    const subjectName = enc.mainMobTemplateId
      ? tEntity({ kind: 'mob', id: enc.mainMobTemplateId, field: 'name' })
      : enc.mainMobName;
    const segmentName = enc.labelTemplateId
      ? tEntity({ kind: 'mob', id: enc.labelTemplateId, field: 'name' })
      : enc.label;
    const encounterLabel =
      enc.label === 'Combat' || enc.label === 'All (session)' ? viewName : segmentName;
    this.subEl.textContent = isThreat
      ? enc.mainMobName
        ? t('hud.meters.target', { name: subjectName })
        : t('hud.meters.noTargetEngaged')
      : t('hud.meters.segmentSummary', {
          label: encounterLabel,
          duration: fmtDuration(enc.duration),
        });

    const liveThreat = mob && !mob.dead && mob.threat.size > 0 ? mob.threat : null;
    // Scanned ONCE per render, not once per row: the threat column and the
    // aggro marker both need every member's pets, and re-walking the entity map
    // per bar is the one part of this render that scales with the world.
    const petsByOwner = isThreat ? this.host.petsByOwner() : null;
    const rows = buildMeterRows({
      tallies: enc.tallies.values(),
      tab: this.tab,
      liveThreat,
      petsByOwner,
      mainMobId: enc.mainMobId,
      aggroPid,
    });

    // A member's split is painted INTO the panel under their bar, not only into
    // the hover tooltip: a pet has no bar of its own, so on the tooltip alone a
    // solo pet class saw one bar with their own name and no trace of the pet.
    const byContributor = isThreat && liveThreat !== null;
    // On the Threat tab with no live hate table the bar falls back to the
    // damage dealt to the SUBJECT mob, while the per-ability map is
    // segment-wide and scoped to no mob at all: painting it under that bar
    // would stack rows summing to a different number than the bar above them.
    // So the panel paints no split there, which also leaves those bars
    // non-expandable. (The hover tooltip keeps its own long-standing fallback,
    // which relabels itself "Damage" precisely because it reports that other
    // figure.)
    const splitInPanel = !isThreat || byContributor;
    const lines = buildMeterList(
      rows.map((row) => ({
        row,
        // buildMeterRows narrows the tally to what the bar model reads; the
        // split needs the per-ability maps, which live on the record itself.
        entries: splitInPanel
          ? this.entriesFor(
              enc.tallies.get(row.tally.pid),
              liveThreat,
              byContributor,
              petsByOwner ?? EMPTY_PETS,
            )
          : [],
        expanded: this.isExpanded(row.tally.pid),
      })),
      enc.duration,
    );

    this.syncRowPool(lines.length);
    // An ability line inherits its owner's bar color (dimmed) so the member and
    // their split read as one block; carried down the list rather than looked up
    // again, since the core emits every split directly under its own bar.
    let ownerColor = MEMBER_FALLBACK_COLOR;
    let ownerName = '';
    lines.forEach((line, i) => {
      const node = this.rowPool[i];
      node.el.style.display = 'block';
      if (line.kind === 'member') {
        const { tally, value, fill, hasAggro } = line.row;
        ownerColor = classColor(tally.cls);
        ownerName = tally.name;
        node.kind = 'member';
        node.pid = tally.pid;
        node.name = tally.name;
        // A bar is the tab stop (it carries the breakdown tooltip and the
        // toggle); the split rows under it are read-only, so keyboard travel
        // stays one stop per member instead of one per spell.
        if (node.el.tabIndex !== 0) node.el.tabIndex = 0;
        node.el.classList.remove('mt-arow');
        node.el.classList.toggle('aggro', hasAggro);
        node.el.classList.toggle('mt-expandable', line.expandable);
        node.el.classList.toggle('mt-open', line.expanded);
        // Only a bar that HAS a split is a toggle. Announcing "collapsed" on a
        // bar with nothing to open would promise an action that does nothing.
        if (line.expandable) {
          node.el.setAttribute('role', 'button');
          node.el.setAttribute('aria-expanded', line.expanded ? 'true' : 'false');
        } else {
          node.el.removeAttribute('role');
          node.el.removeAttribute('aria-expanded');
        }
        node.fill.style.width = `${Math.max(4, fill * 100)}%`;
        node.fill.style.background = `${ownerColor}cc`;
        node.label.textContent = tally.name;
        node.num.textContent = isThreat
          ? fmtNum(value)
          : fmtPerSecondRow(value, value / enc.duration);
        return;
      }
      node.kind = 'ability';
      node.pid = line.ownerPid;
      node.name = ownerName;
      // Read-only: out of the tab order, and carrying no tooltip of its own.
      if (node.el.tabIndex !== -1) node.el.tabIndex = -1;
      node.el.classList.add('mt-arow');
      node.el.classList.remove('aggro', 'mt-expandable', 'mt-open');
      node.el.removeAttribute('role');
      node.el.removeAttribute('aria-expanded');
      node.fill.style.width = `${Math.max(2, line.row.fill * 100)}%`;
      node.fill.style.background = `${ownerColor}55`;
      node.label.textContent = breakdownRowLabel(line.row, ownerName, byContributor);
      node.num.textContent = breakdownRowValue(line.row);
    });
    for (let i = lines.length; i < this.rowPool.length; i++) {
      this.rowPool[i].el.style.display = 'none';
    }
  }

  /**
   * The raw contributions behind one member's bar: their per-ability split on
   * the damage/healing tabs, or, while a live hate table is driving the threat
   * tab, one entry per contributor (the member plus each of their pets), which
   * is what that column actually sums.
   */
  private entriesFor(
    tally: MemberTally | undefined,
    liveThreat: Map<number, number> | null,
    byContributor: boolean,
    // Passed in rather than re-read: render() already scanned the entity map
    // once for this frame, and this now runs per MEMBER, not per hover.
    petsByOwner: Map<number, Pet[]>,
  ): BreakdownEntry[] {
    if (!tally) return [];
    if (byContributor && liveThreat) {
      return [
        { ability: null, petName: null, amount: liveThreat.get(tally.pid) ?? 0 },
        ...(petsByOwner.get(tally.pid) ?? []).map((pet) => ({
          ability: null,
          petName: pet.name,
          amount: liveThreat.get(pet.pid) ?? 0,
        })),
      ];
    }
    return [...(this.tab === 'heal' ? tally.healByAbility : tally.dmgByAbility).values()];
  }

  /** Whether this panel has `pid`'s split open. */
  private isExpanded(pid: number): boolean {
    const chosen = this.expandOverride.get(pid);
    if (chosen !== undefined) return chosen;
    // Default: your OWN bar starts open. Solo (the case where the folded pet is
    // invisible, since the owner is then the only bar) that is the whole point;
    // in a party every other member stays one line until asked.
    return pid === this.host.world.player.id;
  }

  /** Open/close one member's split. Bound to the bar, so it is a player choice. */
  private toggleExpanded(pid: number): void {
    this.expandOverride.set(pid, !this.isExpanded(pid));
    this.render(true);
  }

  /** Grow the pooled lines to `count`, attaching each line's tooltip once. */
  private syncRowPool(count: number): void {
    while (this.rowPool.length < count) {
      const el = document.createElement('div');
      el.className = 'mt-row';
      // Focusable so the breakdown is reachable by keyboard, not hover only
      // (attachTooltip shows on focusin and on a mobile long-press), and so the
      // expand toggle has a keyboard path.
      el.tabIndex = 0;
      const fill = document.createElement('div');
      fill.className = 'mt-fill';
      const label = document.createElement('span');
      label.className = 'mt-label';
      const num = document.createElement('span');
      num.className = 'mt-num';
      el.append(fill, label, num);
      const row: MeterRowNodes = { el, fill, label, num, pid: -1, name: '', kind: 'member' };
      this.rowPool.push(row);
      this.rowsEl.appendChild(el);
      // Member bars only: a split row IS the breakdown, so re-showing the whole
      // owner tooltip over it would repeat what the row already says. Empty
      // means "no tooltip" (the host shows nothing rather than an empty box).
      this.host.attachTooltip(el, () => (row.kind === 'member' ? this.breakdownHtml(row) : ''));
      // Pooled node, so the handler reads the record LIVE: which member this
      // line carries changes every render. Only a bar toggles; a line inside a
      // split is a readout, not a control.
      el.addEventListener('click', () => {
        if (row.kind === 'member') this.toggleExpanded(row.pid);
      });
      el.addEventListener('keydown', (ev) => {
        if (row.kind !== 'member' || (ev.key !== 'Enter' && ev.key !== ' ')) return;
        ev.preventDefault();
        this.toggleExpanded(row.pid);
      });
    }
  }

  /**
   * Hover panel for one bar: the member's per-ability damage/healing split (pet
   * output labeled with the pet's name), or, on the threat tab, the split
   * between the member and their pets. A finished encounter has no live hate
   * table, so its threat number falls back to damage and the panel shows the
   * damage breakdown that produced it.
   */
  private breakdownHtml(row: MeterRowNodes): string {
    const { enc } = this.viewedEncounter();
    const tally = enc?.tallies.get(row.pid);
    const title = `<div class="tt-title">${esc(tally?.name ?? row.name)}</div>`;
    if (!enc || !tally) return title;

    const isThreat = this.tab === 'threat';
    const world = this.host.world;
    const mob = isThreat && enc.mainMobId !== null ? world.entities.get(enc.mainMobId) : null;
    const liveThreat = mob && !mob.dead && mob.threat.size > 0 ? mob.threat : null;
    const byContributor = isThreat && liveThreat !== null;

    // A hover is a one-off, so this is the one place that pays for its own pet
    // scan; the per-frame path hands render()'s single scan down instead.
    const model = buildMeterBreakdown(
      this.entriesFor(tally, liveThreat, byContributor, this.host.petsByOwner()),
      enc.duration,
    );
    const summary = t('hudChrome.meters.breakdownSummary', {
      tab: t(TAB_LABEL_KEY[isThreat && !byContributor ? 'dmg' : this.tab]),
      value: isThreat ? fmtNum(model.total) : fmtPerSecondRow(model.total, model.perSecond),
    });
    const body = model.rows
      .map((r) => this.breakdownRowHtml(r, tally.name, byContributor))
      .join('');
    return `${title}<div class="mt-tip-sub">${esc(summary)}</div><div class="mt-tip-rows">${body}</div>`;
  }

  private breakdownRowHtml(row: BreakdownRow, memberName: string, byContributor: boolean): string {
    const label = breakdownRowLabel(row, memberName, byContributor);
    const value = breakdownRowValue(row);
    return (
      `<div class="mt-tip-row">` +
      `<span class="mt-tip-bar" style="width:${Math.max(2, row.fill * 100)}%"></span>` +
      `<span class="mt-tip-name">${esc(label)}</span>` +
      `<span class="mt-tip-val">${esc(value)}</span>` +
      `</div>`
    );
  }
}

/** Storage keys: one box per panel, plus which meters are popped out. */
/** The meters that can leave the main window; damage is always its home. */
type DetachableTab = Exclude<Tab, 'dmg'>;

const FRAME_KEYS: Record<'main' | DetachableTab, string> = {
  main: 'woc_meters_frame',
  heal: 'woc_meters_frame_heal',
  threat: 'woc_meters_frame_threat',
};
const DETACHED_KEY = 'woc_meters_detached';
const METERS_DEFAULT_WIDTH = 240;
const METERS_DEFAULT_HEIGHT = 160;

const DETACHABLE: readonly DetachableTab[] = ['heal', 'threat'];

/**
 * Owns the shared MeterData and the three panels: the tabbed damage window plus
 * the detachable Healing and Threat windows. Every panel is movable and
 * resizable on its own, and each remembers where it was left.
 */
export class Meters {
  readonly data: MeterData;
  private readonly main: MetersPanel;
  private readonly detached = new Map<DetachableTab, MetersPanel>();
  /** Detached windows hidden along with the tabbed one, to restore on reopen. */
  private reopenDetached: DetachableTab[] = [];

  constructor(
    private world: IWorld,
    private deps?: MetersDeps,
  ) {
    this.data = new MeterData(performance.now());
    const host: PanelHost = {
      world,
      data: this.data,
      petsByOwner: () => this.livePetsByOwner(),
      attachTooltip: (el, html) => deps?.attachTooltip(el, html),
      onDock: (tab) => this.dock(tab),
      isDetached: (tab) => tab !== 'dmg' && this.isDetached(tab),
      openTabMenu: (rows, x, y) => this.openTabMenu(rows, x, y),
    };
    this.main = new MetersPanel(
      {
        root: document.querySelector('#meters-window') as HTMLElement,
        lockedTab: null,
        frameStorageKey: FRAME_KEYS.main,
      },
      host,
      deps,
    );
    for (const tab of DETACHABLE) {
      const root = document.querySelector(
        tab === 'heal' ? '#heal-window' : '#threat-window',
      ) as HTMLElement | null;
      if (!root) continue;
      this.detached.set(
        tab,
        new MetersPanel({ root, lockedTab: tab, frameStorageKey: FRAME_KEYS[tab] }, host, deps),
      );
    }
    this.restoreDetached();
  }

  toggle(): void {
    const open = !this.main.isOpen;
    this.main.setOpen(open);
    // The keybind clears the whole meters surface, not just the tabbed window: a
    // separated Threat or Healing window is part of that surface, and leaving two
    // panels floating over the HUD is not what "close the meters" means. Which
    // ones were up is remembered so reopening restores that exact arrangement.
    // The PERSISTED set is deliberately left alone: closing the meters is not the
    // player docking a meter, so a reload still comes back to their layout.
    if (open) {
      for (const tab of this.reopenDetached) this.detached.get(tab)?.setOpen(true);
      this.reopenDetached = [];
    } else {
      this.reopenDetached = DETACHABLE.filter((tab) => this.isDetached(tab));
      for (const panel of this.detached.values()) panel.setOpen(false);
    }
  }

  get isOpen(): boolean {
    return this.main.isOpen;
  }

  /** Open `tab` in its own window and hand the main window back to damage. */
  popOut(tab: DetachableTab): void {
    const panel = this.detached.get(tab);
    if (!panel) return;
    panel.setOpen(true);
    this.main.showTab('dmg');
    this.persistDetached();
  }

  /** Close a detached window and select its meter back in the main window. */
  dock(tab: DetachableTab): void {
    const panel = this.detached.get(tab);
    if (!panel) return;
    panel.setOpen(false);
    if (this.main.isOpen) this.main.showTab(tab);
    this.persistDetached();
  }

  /** True while `tab` has its own window open. */
  isDetached(tab: DetachableTab): boolean {
    return this.detached.get(tab)?.isOpen ?? false;
  }

  /**
   * Paint a tab's right-click menu through Hud's shared popup box. Localizing
   * the rows here keeps the pure core (which decides WHICH row) string-free.
   */
  private openTabMenu(rows: MeterMenuRow[], x: number, y: number): void {
    const open = this.deps?.openMenu;
    if (!open || rows.length === 0) return;
    const items = rows.map((row) => ({
      act: row.act,
      label: t(row.act === 'separate' ? 'hudChrome.meters.separate' : 'hudChrome.meters.regroup', {
        meter: t(TAB_LABEL_KEY[row.tab]),
      }),
    }));
    open(items, x, y, (act) => {
      const row = rows.find((candidate) => candidate.act === act);
      if (!row || row.tab === 'dmg') return;
      if (row.act === 'separate') this.popOut(row.tab);
      else this.dock(row.tab);
    });
  }

  /** Return every panel to its stylesheet anchor (the layout reset path). */
  resetFrames(): void {
    this.main.resetFrame();
    for (const panel of this.detached.values()) panel.resetFrame();
  }

  private restoreDetached(): void {
    let raw: string | null = null;
    try {
      raw = this.deps?.storage?.getItem(DETACHED_KEY) ?? null;
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
    if (!raw) return;
    const open = new Set(raw.split(',').filter(Boolean));
    for (const tab of DETACHABLE) {
      if (open.has(tab)) this.detached.get(tab)?.setOpen(true);
    }
  }

  private persistDetached(): void {
    const open = DETACHABLE.filter((tab) => this.isDetached(tab)).join(',');
    try {
      this.deps?.storage?.setItem(DETACHED_KEY, open);
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  private partyPids(): Set<number> {
    const pids = new Set<number>([this.world.player.id]);
    for (const m of this.world.partyInfo?.members ?? []) pids.add(m.pid);
    for (const e of this.world.entities.values()) {
      if (e.kind === 'mob' && e.ownerId !== null && pids.has(e.ownerId)) pids.add(e.id);
    }
    return pids;
  }

  /**
   * Live pets per owner, read from the world rather than the tallies: a pet can
   * hold hate without ever landing a hit (a taunt, or a fresh summon), so the
   * threat tab must see it even when it has no damage recorded.
   */
  private livePetsByOwner(): Map<number, Pet[]> {
    const byOwner = new Map<number, Pet[]>();
    for (const e of this.world.entities.values()) {
      if (e.kind !== 'mob' || e.ownerId === null) continue;
      const pets = byOwner.get(e.ownerId);
      if (pets) pets.push({ pid: e.id, name: e.name });
      else byOwner.set(e.ownerId, [{ pid: e.id, name: e.name }]);
    }
    return byOwner;
  }

  onEvent(ev: SimEvent): void {
    this.data.onEvent(ev, this.world, this.partyPids(), performance.now());
  }

  /** called every hud frame; each open panel renders at ~4Hz */
  update(): void {
    const now = performance.now();
    this.data.update(this.world, this.partyPids(), now);
    this.main.update(now);
    for (const panel of this.detached.values()) panel.update(now);
  }

  render(force = false): void {
    this.main.render(force);
    for (const panel of this.detached.values()) {
      if (panel.isOpen || force) panel.render(force && panel.isOpen);
    }
  }
}

// Bar color for a member with no class (an unresolved row), kept next to the
// class lookup so the two cannot drift.
const MEMBER_FALLBACK_COLOR = '#888888';

// Stand-in for the pet scan the damage and healing tabs never make: those tabs
// split by ability, so no lookup is ever performed against it.
const EMPTY_PETS: Map<number, Pet[]> = new Map();

/** `#rrggbb` for a class id, alpha left to the caller. */
function classColor(cls: string | null): string {
  const color = cls && (CLASSES as Record<string, { color: number }>)[cls]?.color;
  return color ? `#${color.toString(16).padStart(6, '0')}` : MEMBER_FALLBACK_COLOR;
}

// "{value} ({percent}%)" cell for one split row, shared by the in-panel line and
// the hover tooltip so the two readouts of the same number cannot disagree.
function breakdownRowValue(row: BreakdownRow): string {
  return t('hudChrome.meters.breakdownRow', {
    value: fmtNum(row.amount),
    percent: t('hudChrome.meters.percent', {
      value: formatNumber(Math.round(row.share * 100), {
        maximumFractionDigits: 0,
        useGrouping: false,
      }),
    }),
  });
}

// Row label: the folded tail, a threat contributor (the member or one of their
// pets), or an ability, prefixed with the pet's name when a pet cast it.
function breakdownRowLabel(row: BreakdownRow, memberName: string, byContributor: boolean): string {
  if (row.folded > 0) {
    return t('hudChrome.meters.breakdownOther', {
      count: formatNumber(row.folded, { maximumFractionDigits: 0, useGrouping: false }),
    });
  }
  if (byContributor) return row.petName ?? memberName;
  const ability = row.ability
    ? abilityDisplayNameFromSource(row.ability)
    : t('hudChrome.meters.melee');
  return row.petName ? t('hudChrome.meters.petAbility', { pet: row.petName, ability }) : ability;
}

// Compact damage/heal/threat number. Digits route through formatNumber so the
// numerals/decimal mark follow the active locale, while the classic English
// k/m suffixes + thresholds are preserved (useGrouping:false keeps the readout
// byte-identical to the historical `toFixed(1)`/`Math.round` form in en).
function fmtNum(v: number): string {
  if (v >= 1_000_000)
    return `${formatNumber(v / 1_000_000, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })}m`;
  if (v >= 10_000)
    return `${formatNumber(v / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })}k`;
  return formatNumber(Math.round(v), { maximumFractionDigits: 0, useGrouping: false });
}

// "{rate}/s" cell, e.g. "1.2k/s" — the /s unit comes from the localizable key.
function fmtPerSecond(v: number): string {
  return t('hudChrome.meters.perSecond', { value: fmtNum(v) });
}

// "{total} ({rate}/s)" cell, e.g. "12.3k (1.2k/s)". Defined at module scope so
// the imported t() is in view (the render loop shadows `t` with a tally row).
function fmtPerSecondRow(total: number, rate: number): string {
  return t('hudChrome.meters.perSecondRow', { total: fmtNum(total), rate: fmtPerSecond(rate) });
}

// "Xm Ys" / "Ys" duration; the m/s units come from localizable keys, digits via
// formatNumber.
function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const num = (n: number) => formatNumber(n, { maximumFractionDigits: 0, useGrouping: false });
  return m > 0
    ? t('hudChrome.meters.minutesSeconds', { m: num(m), s: num(Math.round(s % 60)) })
    : t('hudChrome.meters.seconds', { s: num(Math.round(s)) });
}
