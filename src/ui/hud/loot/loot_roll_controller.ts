import { ITEMS } from '../../../sim/data';
import type { ItemDef, LootRollChoice, SimEvent } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { iconDataUrl, QUALITY_COLOR } from '../../icons';
import type { PainterHostWriters } from '../../painter_host';
import { reconcileLootRolls } from './loot_roll_reconcile';
import {
  computeLootRollStatusRows,
  type LootRollStatusRow,
  lootRollStatusFingerprint,
} from './loot_roll_status_view';

type LootRollEvent = Extract<SimEvent, { type: 'lootRoll' }>;
type MasterLootEvent = Extract<SimEvent, { type: 'masterLoot' }>;
type TimedRoll<T> = { event: T; receivedAt: number; durationMs: number };

type LootRollWorld = Pick<
  IWorld,
  'activeLootRolls' | 'assignMasterLoot' | 'lootRollGroupStatus' | 'playerId' | 'submitLootRoll'
>;

export interface LootRollControllerDeps {
  document: Document;
  world(): LootRollWorld;
  now(): number;
  isMobileLayout(): boolean;
  itemIcon(item: ItemDef): string;
  itemTooltip(item: ItemDef): string;
  attachTooltip(element: HTMLElement, html: () => string): void;
  writers: Pick<PainterHostWriters, 'setStyleProp'>;
}

const LOOT_ROLL_DURATION_MS = 60_000;
const MASTER_LOOT_DURATION_MS = 300_000;

/** Owns loot-roll prompt state, authoritative reconciliation, timers, and DOM. */
export class LootRollController {
  private readonly activeRolls = new Map<number, TimedRoll<LootRollEvent>>();
  private readonly dismissedRolls = new Map<number, number>();
  private confirmedRolls = new Set<number>();
  private statusRows: LootRollStatusRow[] = [];
  private statusFingerprint = '';
  private readonly watchTimers = new Map<number, number>();
  private readonly activeMasterRolls = new Map<number, TimedRoll<MasterLootEvent>>();

  constructor(private readonly deps: LootRollControllerDeps) {}

  showRoll(event: LootRollEvent): void {
    this.activeMasterRolls.delete(event.rollId);
    this.activeRolls.set(event.rollId, {
      event,
      receivedAt: this.deps.now(),
      durationMs: LOOT_ROLL_DURATION_MS,
    });
    this.render();
  }

  showMasterRoll(event: MasterLootEvent): void {
    this.activeMasterRolls.set(event.rollId, {
      event,
      receivedAt: this.deps.now(),
      durationMs: MASTER_LOOT_DURATION_MS,
    });
    this.render();
  }

  update(now: number): void {
    this.reconcileRolls();
    this.reconcileStatus(now);
    this.updateTimers(now);
  }

  closeForItem(text: string): void {
    const match =
      /^.+ wins \[\[i:([A-Za-z0-9_]+)\]\] \(\d+\)$/.exec(text) ??
      /^Everyone passed on \[\[i:([A-Za-z0-9_]+)\]\]\.$/.exec(text) ??
      /^.+ assigned \[\[i:([A-Za-z0-9_]+)\]\] to .+\.$/.exec(text) ??
      /^(.+) was not assigned and is free for all\.$/.exec(text);
    if (!match) return;
    const itemId = match[1];
    for (const [rollId, roll] of this.activeRolls) {
      if (roll.event.itemId === itemId || roll.event.itemName === itemId)
        this.activeRolls.delete(rollId);
    }
    for (const [rollId, roll] of this.activeMasterRolls) {
      if (roll.event.itemId === itemId || roll.event.itemName === itemId)
        this.activeMasterRolls.delete(rollId);
    }
    this.render();
  }

  private root(): HTMLElement {
    let root = this.deps.document.getElementById('loot-rolls');
    const uiRoot = this.deps.document.getElementById('ui');
    if (!root) {
      root = this.deps.document.createElement('div');
      root.id = 'loot-rolls';
      root.setAttribute('aria-live', 'polite');
    }
    if (uiRoot && root.parentElement !== uiRoot) uiRoot.appendChild(root);
    else if (!root.parentElement) this.deps.document.body.appendChild(root);
    return root;
  }

  private submit(rollId: number, choice: LootRollChoice): void {
    this.deps.world().submitLootRoll(rollId, choice);
    this.activeRolls.delete(rollId);
    this.dismissedRolls.set(rollId, this.deps.now());
    this.render();
  }

  private assign(rollId: number, targetPids: number[]): void {
    this.deps.world().assignMasterLoot(rollId, targetPids);
    this.activeMasterRolls.delete(rollId);
    this.render();
  }

  private reconcileRolls(): void {
    const open = this.deps.world().activeLootRolls();
    if (
      open.length === 0 &&
      this.activeRolls.size === 0 &&
      this.dismissedRolls.size === 0 &&
      this.confirmedRolls.size === 0
    ) {
      return;
    }
    const promptById = new Map(open.map((prompt) => [prompt.rollId, prompt] as const));
    const dismissedAt: Record<number, number> = {};
    for (const [rollId, at] of this.dismissedRolls) dismissedAt[rollId] = at;
    const decision = reconcileLootRolls({
      open: open.map((prompt) => prompt.rollId),
      shown: [...this.activeRolls.keys()],
      dismissed: [...this.dismissedRolls.keys()],
      confirmed: [...this.confirmedRolls],
      dismissedAt,
      nowMs: this.deps.now(),
    });
    this.confirmedRolls = new Set(decision.confirmed);
    for (const rollId of decision.toPrune) this.dismissedRolls.delete(rollId);
    let changed = false;
    for (const rollId of decision.toRetire) {
      this.activeRolls.delete(rollId);
      changed = true;
    }
    for (const rollId of decision.toShow) {
      const prompt = promptById.get(rollId);
      if (!prompt) continue;
      this.activeRolls.set(rollId, {
        event: { type: 'lootRoll', ...prompt },
        receivedAt: this.deps.now(),
        durationMs: LOOT_ROLL_DURATION_MS,
      });
      changed = true;
    }
    if (changed) this.render();
  }

  private reconcileStatus(now: number): void {
    const world = this.deps.world();
    const statuses = world.lootRollGroupStatus();
    if (statuses.length === 0 && this.statusRows.length === 0) return;
    const rows = computeLootRollStatusRows(
      statuses,
      [...this.activeRolls.keys()],
      world.playerId,
      !this.deps.isMobileLayout(),
    );
    const fingerprint = lootRollStatusFingerprint(rows);
    if (fingerprint === this.statusFingerprint) return;
    this.statusFingerprint = fingerprint;
    this.statusRows = rows;
    const live = new Set(rows.map((row) => row.rollId));
    for (const rollId of this.watchTimers.keys()) {
      if (!live.has(rollId)) this.watchTimers.delete(rollId);
    }
    for (const row of rows) {
      if (!this.watchTimers.has(row.rollId)) this.watchTimers.set(row.rollId, now);
    }
    this.render();
  }

  private updateTimers(now: number): void {
    if (
      this.activeRolls.size === 0 &&
      this.activeMasterRolls.size === 0 &&
      this.statusRows.length === 0
    ) {
      return;
    }
    let changed = false;
    for (const [rollId, roll] of this.activeRolls) {
      if (now - roll.receivedAt >= roll.durationMs) {
        this.activeRolls.delete(rollId);
        this.dismissedRolls.set(rollId, now);
        changed = true;
      }
    }
    for (const [rollId, roll] of this.activeMasterRolls) {
      if (now - roll.receivedAt >= roll.durationMs) {
        this.activeMasterRolls.delete(rollId);
        changed = true;
      }
    }
    if (changed) this.render();
    const root = this.deps.document.getElementById('loot-rolls');
    if (!root) return;
    for (const row of root.querySelectorAll<HTMLElement>('.loot-roll')) {
      const rollId = Number(row.dataset.rollId);
      if (row.dataset.watch) {
        const receivedAt = this.watchTimers.get(rollId);
        if (receivedAt === undefined) continue;
        const remaining = Math.max(0, 1 - (now - receivedAt) / LOOT_ROLL_DURATION_MS);
        this.deps.writers.setStyleProp(row, '--loot-roll-frac', remaining.toFixed(3));
        continue;
      }
      const roll = row.dataset.master
        ? this.activeMasterRolls.get(rollId)
        : this.activeRolls.get(rollId);
      if (!roll) continue;
      const remaining = Math.max(0, 1 - (now - roll.receivedAt) / roll.durationMs);
      this.deps.writers.setStyleProp(row, '--loot-roll-frac', remaining.toFixed(3));
    }
  }

  private votesHtml(status: LootRollStatusRow): string {
    const votes = status.entries
      .map(
        (entry) => `
        <span class="loot-roll-vote${entry.self ? ' self' : ''}">
          <span class="loot-roll-vote-name">${esc(entry.name)}</span>
          <span class="loot-roll-vote-chip ${entry.choice ?? 'undecided'}">${entry.choice ? esc(t(`itemUi.lootRoll.${entry.choice}`)) : ''}</span>
        </span>`,
      )
      .join('');
    const count = t('itemUi.lootRoll.rolled', {
      answered: formatNumber(status.answered, { maximumFractionDigits: 0 }),
      total: formatNumber(status.total, { maximumFractionDigits: 0 }),
    });
    return `<div class="loot-roll-votes" aria-hidden="true">
      <div class="loot-roll-votes-count">${esc(count)}</div>
      <div class="loot-roll-votes-list">${votes}</div>
    </div>`;
  }

  private render(): void {
    const root = this.root();
    if (
      this.activeRolls.size === 0 &&
      this.activeMasterRolls.size === 0 &&
      this.statusRows.length === 0
    ) {
      root.style.display = 'none';
      root.innerHTML = '';
      return;
    }
    root.style.display = 'flex';
    root.innerHTML = '';
    const statusByRoll = new Map(this.statusRows.map((row) => [row.rollId, row]));
    for (const [rollId, roll] of this.activeMasterRolls) {
      this.renderMasterRow(root, rollId, roll.event);
    }
    for (const [rollId, roll] of this.activeRolls) {
      const event = roll.event;
      const item = ITEMS[event.itemId];
      const itemName = item ? itemDisplayName(item) : event.itemName;
      const quality = item?.quality ?? event.quality ?? 'common';
      const status = statusByRoll.get(rollId);
      const row = this.deps.document.createElement('div');
      row.className = 'loot-roll panel';
      row.dataset.rollId = String(rollId);
      this.deps.writers.setStyleProp(row, '--loot-roll-frac', '1.000');
      row.innerHTML = `
        <div class="loot-roll-item">
          ${item ? this.deps.itemIcon(item) : `<img class="item-icon q-${quality}" src="${iconDataUrl('item', event.itemId)}" alt="" draggable="false">`}
          <div class="loot-roll-copy">
            <div class="loot-roll-title">${esc(t('itemUi.lootRoll.title'))}</div>
            <div class="loot-roll-name" style="color:${QUALITY_COLOR[quality] ?? '#fff'}">${esc(itemName)}</div>
          </div>
        </div>
        <div class="loot-roll-timer" aria-hidden="true"><span></span></div>
        ${status ? this.votesHtml(status) : ''}
        <div class="loot-roll-actions">
          <button type="button" class="loot-roll-btn need" data-choice="need">${esc(t('itemUi.lootRoll.need'))}</button>
          <button type="button" class="loot-roll-btn greed" data-choice="greed">${esc(t('itemUi.lootRoll.greed'))}</button>
          <button type="button" class="loot-roll-btn pass" data-choice="pass">${esc(t('itemUi.lootRoll.pass'))}</button>
        </div>`;
      const itemElement = row.querySelector<HTMLElement>('.loot-roll-item');
      if (item && itemElement) {
        this.deps.attachTooltip(itemElement, () => this.deps.itemTooltip(item));
      }
      row.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((button) => {
        const choice = button.dataset.choice as LootRollChoice;
        button.setAttribute('aria-label', t(`itemUi.lootRoll.${choice}Aria`, { item: itemName }));
        button.addEventListener('click', () => this.submit(rollId, choice));
      });
      root.appendChild(row);
    }
    for (const status of this.statusRows) {
      if (this.activeRolls.has(status.rollId) || this.activeMasterRolls.has(status.rollId))
        continue;
      const item = ITEMS[status.itemId];
      const itemName = item ? itemDisplayName(item) : status.itemName;
      const quality = item?.quality ?? status.quality ?? 'common';
      const row = this.deps.document.createElement('div');
      row.className = 'loot-roll panel watch';
      row.dataset.rollId = String(status.rollId);
      row.dataset.watch = '1';
      this.deps.writers.setStyleProp(row, '--loot-roll-frac', '1.000');
      row.innerHTML = `
        <div class="loot-roll-item">
          ${item ? this.deps.itemIcon(item) : `<img class="item-icon q-${quality}" src="${iconDataUrl('item', status.itemId)}" alt="" draggable="false">`}
          <div class="loot-roll-copy">
            <div class="loot-roll-title">${esc(t('itemUi.lootRoll.title'))}</div>
            <div class="loot-roll-name" style="color:${QUALITY_COLOR[quality] ?? '#fff'}">${esc(itemName)}</div>
          </div>
        </div>
        <div class="loot-roll-timer" aria-hidden="true"><span></span></div>
        ${this.votesHtml(status)}`;
      const itemElement = row.querySelector<HTMLElement>('.loot-roll-item');
      if (item && itemElement) {
        this.deps.attachTooltip(itemElement, () => this.deps.itemTooltip(item));
      }
      root.appendChild(row);
    }
  }

  private renderMasterRow(root: HTMLElement, rollId: number, event: MasterLootEvent): void {
    const item = ITEMS[event.itemId];
    const itemName = item ? itemDisplayName(item) : event.itemName;
    const quality = item?.quality ?? event.quality ?? 'common';
    const row = this.deps.document.createElement('div');
    row.className = 'loot-roll panel master';
    row.dataset.rollId = String(rollId);
    row.dataset.master = '1';
    this.deps.writers.setStyleProp(row, '--loot-roll-frac', '1.000');
    const picks = event.candidates
      .map(
        (candidate) =>
          `<label><input type="checkbox" class="ml-pick" value="${candidate.pid}"><span>${esc(candidate.name)}</span></label>`,
      )
      .join('');
    row.innerHTML = `
      <div class="loot-roll-item">
        ${item ? this.deps.itemIcon(item) : `<img class="item-icon q-${quality}" src="${iconDataUrl('item', event.itemId)}" alt="" draggable="false">`}
        <div class="loot-roll-copy">
          <div class="loot-roll-title">${esc(t('hudChrome.masterLoot.assignPrompt', { item: itemName }))}</div>
          <div class="loot-roll-name" style="color:${QUALITY_COLOR[quality] ?? '#fff'}">${esc(itemName)}</div>
        </div>
      </div>
      <div class="loot-roll-timer" aria-hidden="true"><span></span></div>
      <div class="master-loot-picks">
        <label class="ml-all-row"><input type="checkbox" class="ml-all"><span>${esc(t('hudChrome.masterLoot.selectAll'))}</span></label>
        ${picks}
      </div>
      <div class="loot-roll-actions"><button type="button" class="loot-roll-btn assign ml-roll" disabled>${esc(t('hudChrome.masterLoot.rollButton'))}</button></div>`;
    const itemElement = row.querySelector<HTMLElement>('.loot-roll-item');
    if (item && itemElement) {
      this.deps.attachTooltip(itemElement, () => this.deps.itemTooltip(item));
    }
    const selectAll = row.querySelector<HTMLInputElement>('.ml-all');
    const pickElements = [...row.querySelectorAll<HTMLInputElement>('.ml-pick')];
    const rollButton = row.querySelector<HTMLButtonElement>('.ml-roll');
    if (!selectAll || !rollButton) {
      root.appendChild(row);
      return;
    }
    const syncRoll = (): void => {
      const checked = pickElements.filter((pick) => pick.checked).length;
      rollButton.disabled = checked === 0;
      selectAll.checked = pickElements.length > 0 && checked === pickElements.length;
    };
    selectAll.addEventListener('change', () => {
      for (const pick of pickElements) pick.checked = selectAll.checked;
      syncRoll();
    });
    for (const pick of pickElements) pick.addEventListener('change', syncRoll);
    rollButton.addEventListener('click', () => {
      const targetPids = pickElements
        .filter((pick) => pick.checked)
        .map((pick) => Number(pick.value));
      if (targetPids.length > 0) this.assign(rollId, targetPids);
    });
    root.appendChild(row);
  }
}
