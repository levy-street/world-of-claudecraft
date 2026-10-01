// Thin DOM consumer for the mob inspect window (#mob-inspect-window): a
// targeted creature's live combat stats and its loot table. The model comes
// from the pure core (mob_inspect_view.ts); this module only paints it and
// wires callbacks through injected deps, never imports Hud, never hardcodes
// the window id (Hud owns it).
//
// Cold window (src/ui/hud/CLAUDE.md): Hud.update() never touches it. It
// rebuilds on open, once more when the live stat read settles (only if the
// window still shows that same mob), and on relocalize(). Every row is an
// HTML string inserted via innerHTML (no bare document/window global);
// item tooltips are wired AFTER the string lands, over the parsed nodes.

import { ITEMS } from '../../../sim/data';
import type { MobInspectInfo } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { mobDisplayName } from '../../entity_display_core';
import { itemDisplayName, tEntity } from '../../entity_i18n';
import { esc } from '../../esc';
import { captureFocusKey, findFocusKey, restoreFirstEnabled } from '../../focus_restore';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import { QUALITY_COLOR } from '../../icons';
import type { PainterHostPresentation } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import {
  buildMobInspectModel,
  type MobInspectCoinRow,
  type MobInspectDropRow,
  type MobInspectLootTable,
  type MobInspectModel,
  type MobInspectSubject,
  type MobInspectTrait,
} from './mob_inspect_view';

const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)';

const TRAIT_KEYS: Record<MobInspectTrait, TranslationKey> = {
  ccImmune: 'hudChrome.mobInspect.traitCcImmune',
  slowImmune: 'hudChrome.mobInspect.traitSlowImmune',
  harvestable: 'hudChrome.mobInspect.traitHarvestable',
};

export interface MobInspectWindowDeps extends PainterHostPresentation {
  /** The #mob-inspect-window root (Hud owns the id). */
  root(): HTMLElement;
  closeOthers(): void;
  hideTooltip(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** The mirrored mob for `id`, or null when it is not a mob in view. */
  subject(id: number): MobInspectSubject | null;
  /** The viewer's level, for the armor mitigation line. */
  viewerLevel(): number;
  /** The live stat read (IWorld.mobInspectInfo). */
  requestStats(id: number): MobInspectInfo | null | Promise<MobInspectInfo | null>;
}

function pct(fraction: number): string {
  return formatNumber(fraction * 100, { maximumFractionDigits: 1 });
}

function statRow(label: string, value: string, sub?: string): string {
  // The note is its own line under the row: .ui-stat-row has a fixed height.
  const note = sub ? `<div class="mob-inspect-stat-sub ui-muted">${esc(sub)}</div>` : '';
  return (
    `<div class="mob-inspect-stat ui-stat-row"><span class="mob-inspect-stat-label">${esc(label)}</span>` +
    `<span class="mob-inspect-stat-value ui-num">${esc(value)}</span></div>${note}`
  );
}

function statsHtml(m: MobInspectModel): string {
  let rows = statRow(t('hudChrome.mobInspect.health'), formatNumber(m.maxHp));
  const s = m.stats;
  if (s) {
    rows += statRow(
      t('hudChrome.mobInspect.damage'),
      t('hudChrome.mobInspect.damageRange', {
        min: formatNumber(s.weaponMin),
        max: formatNumber(s.weaponMax),
      }),
    );
    rows += statRow(
      t('hudChrome.mobInspect.attackSpeed'),
      t('hudChrome.mobInspect.seconds', {
        seconds: formatNumber(s.attackSpeed, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      }),
    );
    rows += statRow(
      t('hudChrome.mobInspect.dps'),
      formatNumber(s.dps, { maximumFractionDigits: 1 }),
    );
    rows += statRow(
      t('hudChrome.mobInspect.armor'),
      formatNumber(s.armor),
      t('hudChrome.mobInspect.armorReduction', { pct: pct(s.armorReduction) }),
    );
  } else {
    const key =
      m.statsState === 'pending'
        ? 'hudChrome.mobInspect.statsPending'
        : 'hudChrome.mobInspect.statsUnavailable';
    rows += `<div class="mob-inspect-stats-note ui-muted" role="status">${esc(t(key))}</div>`;
  }
  return (
    `<section class="mob-inspect-section ui-card"><h3 class="mob-inspect-heading ui-h">${esc(t('hudChrome.mobInspect.statsHeading'))}</h3>` +
    `${rows}</section>`
  );
}

function traitsHtml(m: MobInspectModel): string {
  if (m.traits.length === 0) return '';
  const items = m.traits
    .map((trait) => `<li class="mob-inspect-trait">${esc(t(TRAIT_KEYS[trait]))}</li>`)
    .join('');
  return (
    `<section class="mob-inspect-section ui-card"><h3 class="mob-inspect-heading ui-h">${esc(t('hudChrome.mobInspect.traitsHeading'))}</h3>` +
    `<ul class="mob-inspect-traits">${items}</ul></section>`
  );
}

function coinRowHtml(row: MobInspectCoinRow, deps: MobInspectWindowDeps): string {
  return (
    `<div class="mob-inspect-drop mob-inspect-coins"><span class="mob-inspect-drop-name">${esc(t('hudChrome.mobInspect.money'))}</span>` +
    `<span class="mob-inspect-coin-range">${deps.moneyHtml(row.min)} <span class="ui-muted">${esc(t('hudChrome.mobInspect.rangeTo'))}</span> ${deps.moneyHtml(row.max)}</span>` +
    `<span class="mob-inspect-drop-chance ui-num">${esc(t('hudChrome.mobInspect.chance', { pct: pct(row.chance) }))}</span></div>`
  );
}

function dropRowHtml(row: MobInspectDropRow, deps: MobInspectWindowDeps): string {
  const def = ITEMS[row.itemId];
  if (!def) return '';
  const color = QUALITY_COLOR[def.quality ?? 'common'] ?? QUALITY_DEFAULT_COLOR;
  const notes: string[] = [];
  if (row.questId) {
    notes.push(
      t('hudChrome.mobInspect.questOnly', {
        quest: tEntity({ kind: 'quest', id: row.questId, field: 'title' }),
      }),
    );
  }
  if (row.normalOnly) notes.push(t('hudChrome.mobInspect.normalOnly'));
  const note = notes.length
    ? `<span class="mob-inspect-drop-note ui-muted">${esc(notes.join(' · '))}</span>`
    : '';
  return (
    // No aria-label override: the accessible name computes from the visible
    // text (name, chance, notes), reachable in one focus stop.
    `<div class="mob-inspect-drop" tabindex="0" role="group" data-item-id="${esc(row.itemId)}" data-focus-key="drop:${esc(row.itemId)}">` +
    `${deps.itemIcon(def)}<span class="mob-inspect-drop-body"><span class="mob-inspect-drop-name" style="color:${color}">${esc(itemDisplayName(def))}</span>${note}</span>` +
    `<span class="mob-inspect-drop-chance ui-num">${esc(t('hudChrome.mobInspect.chance', { pct: pct(row.chance) }))}</span></div>`
  );
}

function lootTableHtml(table: MobInspectLootTable, deps: MobInspectWindowDeps): string {
  let html = table.coins.map((row) => coinRowHtml(row, deps)).join('');
  for (const group of table.groups) {
    const rows = group.rows.map((row) => dropRowHtml(row, deps)).join('');
    if (!group.exclusive) {
      html += rows;
      continue;
    }
    // One draw: at most one row drops. Several draws over a shared list: up to
    // that many DIFFERENT rows drop (a later roll skips an already-won item).
    const label =
      group.rolls > 1
        ? t('hudChrome.mobInspect.sharedRolls', { count: formatNumber(group.rolls) })
        : t('hudChrome.mobInspect.exclusiveGroup');
    html += `<div class="mob-inspect-group ui-well"><div class="mob-inspect-group-label ui-meta">${esc(label)}</div>${rows}</div>`;
  }
  return html;
}

function dropsHtml(m: MobInspectModel, deps: MobInspectWindowDeps): string {
  const base = lootTableHtml(m.loot, deps);
  let html =
    `<section class="mob-inspect-section ui-card"><h3 class="mob-inspect-heading ui-h">${esc(t('hudChrome.mobInspect.dropsHeading'))}</h3>` +
    (base ||
      `<div class="mob-inspect-empty ui-muted">${esc(t('hudChrome.mobInspect.noDrops'))}</div>`) +
    `</section>`;
  if (m.heroicLoot) {
    html +=
      `<section class="mob-inspect-section ui-card"><h3 class="mob-inspect-heading ui-h">${esc(t('hudChrome.mobInspect.heroicDropsHeading'))}</h3>` +
      `${lootTableHtml(m.heroicLoot, deps)}</section>`;
  }
  return html;
}

function subtitle(m: MobInspectModel): string {
  const parts = [
    t('hudChrome.mobTooltip.levelFamily', {
      level: formatNumber(m.level),
      family: m.familyLabel,
    }),
  ];
  if (m.rank === 'boss') parts.push(t('hudChrome.mobTooltip.boss'));
  else if (m.rank === 'elite') parts.push(t('hudChrome.mobTooltip.elite'));
  if (m.worldBoss) parts.push(t('hudChrome.mobInspect.worldBoss'));
  else if (m.rare) parts.push(t('hudChrome.mobInspect.rare'));
  return parts.join(' · ');
}

export class MobInspectWindow {
  private opened = false;
  private subject: MobInspectSubject | null = null;
  private info: MobInspectInfo | null = null;
  private pending = false;
  /** Bumped per open, so a late answer for an earlier open never paints. */
  private generation = 0;
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: MobInspectWindowDeps) {}

  get isOpen(): boolean {
    return this.opened;
  }

  /** The mob currently shown, or null while closed. */
  get mobId(): number | null {
    return this.opened ? (this.subject?.id ?? null) : null;
  }

  /** Open (or re-point) the window on mob `id`. Returns false, opening
   *  nothing, when `id` is not a mob with a template. */
  open(id: number): boolean {
    const subject = this.deps.subject(id);
    if (!subject || !buildMobInspectModel({ subject, viewerLevel: 1, info: null, pending: true })) {
      return false;
    }
    if (!this.opened) {
      this.deps.closeOthers();
      this.openerFocus = this.deps.captureFocus();
    }
    this.opened = true;
    this.subject = subject;
    this.info = null;
    this.pending = true;
    const generation = ++this.generation;
    // Ask first: the offline Sim answers synchronously and settle() paints
    // the live card once; only a still-pending (online) read paints here.
    this.request(id, generation);
    if (this.pending) this.render();
    const el = this.deps.root();
    el.style.display = 'flex';
    (el.querySelector('[data-close]') as HTMLElement | null)?.focus();
    return true;
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.generation++;
    this.deps.hideTooltip();
    this.deps.root().style.display = 'none';
    this.subject = null;
    this.info = null;
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  /** Language switch: a no-op while closed, else a full rebuild that carries
   *  the focused control across by data-focus-key. */
  relocalize(): void {
    if (!this.opened) return;
    const el = this.deps.root();
    const focusKey = captureFocusKey(el);
    this.render();
    if (focusKey) {
      restoreFirstEnabled([findFocusKey(el, focusKey), findFocusKey(el, 'close')]);
    }
  }

  private request(id: number, generation: number): void {
    let answer: MobInspectInfo | null | Promise<MobInspectInfo | null>;
    try {
      answer = this.deps.requestStats(id);
    } catch {
      answer = null;
    }
    if (answer instanceof Promise) {
      answer.then(
        (info) => this.settle(generation, info),
        () => this.settle(generation, null),
      );
    } else {
      this.settle(generation, answer);
    }
  }

  private settle(generation: number, info: MobInspectInfo | null): void {
    if (!this.opened || generation !== this.generation) return;
    this.info = info;
    this.pending = false;
    const el = this.deps.root();
    const focusKey = captureFocusKey(el);
    this.render();
    if (focusKey) {
      restoreFirstEnabled([findFocusKey(el, focusKey), findFocusKey(el, 'close')]);
    }
  }

  private render(): void {
    const subject = this.subject;
    if (!subject) return;
    const model = buildMobInspectModel({
      subject,
      viewerLevel: this.deps.viewerLevel(),
      info: this.info,
      pending: this.pending,
    });
    if (!model) return;
    this.deps.hideTooltip();
    const el = this.deps.root();
    const name = mobDisplayName(model.templateId);
    // The dialog's one accessible name says what it is ("Inspect <name>");
    // the visible title is the bare name.
    markDialogRoot(el, { label: t('hudChrome.mobInspect.titleAria', { name }) });
    el.innerHTML =
      `<div class="panel-title ui-win-head"><span class="ui-win-title">${esc(name)}</span>` +
      `<button type="button" class="x-btn ui-x-btn" data-close data-focus-key="close" aria-label="${esc(t('hudChrome.mobInspect.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="mob-inspect-body ui-win-body">` +
      `<div class="mob-inspect-sub ui-meta">${esc(subtitle(model))}</div>` +
      statsHtml(model) +
      traitsHtml(model) +
      dropsHtml(model, this.deps) +
      `</div>`;
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    for (const drop of el.querySelectorAll<HTMLElement>('.mob-inspect-drop[data-item-id]')) {
      const def = ITEMS[drop.dataset.itemId ?? ''];
      if (def) this.deps.attachTooltip(drop, () => this.deps.itemTooltip(def));
    }
  }
}
