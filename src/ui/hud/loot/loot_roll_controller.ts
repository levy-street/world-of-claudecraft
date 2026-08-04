import { ITEMS } from '../../../sim/data';
import type { ItemDef, LootRollChoice, SimEvent } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { itemNameColor } from '../../item_name_color';
import { knownItemDef } from '../../known_item';
import type { PainterHostWriters } from '../../painter_host';
import { unknownItemIconHtml } from '../../unknown_item_icon';
import { reconcileLootRolls } from './loot_roll_reconcile';
import {
  computeLootRollStatusRows,
  type LootRollStatusRow,
  lootRollStatusFingerprint,
} from './loot_roll_status_view';

type LootRollEvent = Extract<SimEvent, { type: 'lootRoll' }>;
type MasterLootEvent = Extract<SimEvent, { type: 'masterLoot' }>;
type TimedRoll<T> = { event: T; receivedAt: number; durationMs: number };
// A master row cleared by a local intent (an assignment, or the local timer): when
// it was cleared, plus the clock the cleared row was running on so a restore can
// resume it rather than restart it.
type DismissedMasterRoll = { at: number; receivedAt: number; durationMs: number };

type LootRollWorld = Pick<
  IWorld,
  | 'activeLootRolls'
  | 'activeMasterLootRolls'
  | 'assignMasterLoot'
  | 'lootRollGroupStatus'
  | 'playerId'
  | 'submitLootRoll'
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

// Identity of a master roll's candidate list, for spotting a roster change on a row
// that is already up. Name included, not just pid: a candidate can be renamed by the
// live-roster lookup falling back to the roll's open-time snapshot.
function candidateKey(candidates: { pid: number; name: string }[]): string {
  return candidates.map((candidate) => `${candidate.pid}:${candidate.name}`).join('|');
}

/** Owns loot-roll prompt state, authoritative reconciliation, timers, and DOM. */
export class LootRollController {
  private readonly activeRolls = new Map<number, TimedRoll<LootRollEvent>>();
  private readonly dismissedRolls = new Map<number, number>();
  private confirmedRolls = new Set<number>();
  private statusRows: LootRollStatusRow[] = [];
  private statusFingerprint = '';
  private readonly watchTimers = new Map<number, number>();
  private readonly activeMasterRolls = new Map<number, TimedRoll<MasterLootEvent>>();
  // The master-loot twin of dismissedRolls/confirmedRolls, kept SEPARATE from them
  // on purpose: a master roll keeps its id when the sim converts it to need/greed,
  // so one shared dismissed set would let the assignment that opened the roll
  // suppress the need/greed prompt the same id then arrives as.
  //
  // It carries the row's ORIGINAL clock alongside the dismissal time, unlike the
  // need/greed map, so a restored row resumes its countdown instead of restarting
  // it. That asymmetry is deliberate: a need/greed row is only ever restored a
  // couple of seconds into a 60s window, while a master row can be refused and
  // restored at any point in a 300s one, so restarting there would show a bar that
  // is wrong by up to five minutes.
  private readonly dismissedMasterRolls = new Map<number, DismissedMasterRoll>();
  private confirmedMasterRolls = new Set<number>();

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
    this.reconcileMasterRolls();
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
    const cleared = this.activeMasterRolls.get(rollId);
    this.activeMasterRolls.delete(rollId);
    // Clearing the row is a LOCAL intent, exactly as in submit() above, so record
    // when it happened rather than forgetting the roll: the sim refuses an
    // assignment whose every named pid is no longer a candidate and deliberately
    // leaves the roll in its curate phase, and a plain delete stranded the looter
    // there until the 300s timeout (#2526). reconcileMasterRolls restores the row
    // from the authoritative surface once the roll has stayed open past the grace.
    this.rememberDismissedMaster(rollId, this.deps.now(), cleared);
    this.render();
  }

  // Record a locally cleared master row: when it went, and the clock it was on, so
  // a restore of the SAME roll picks the countdown back up where it left off. A
  // roll with no record (the reconnect case, where the client never saw the row)
  // legitimately falls back to a fresh full window on restore.
  private rememberDismissedMaster(
    rollId: number,
    at: number,
    cleared: TimedRoll<MasterLootEvent> | undefined,
  ): void {
    this.dismissedMasterRolls.set(rollId, {
      at,
      receivedAt: cleared?.receivedAt ?? at,
      durationMs: cleared?.durationMs ?? MASTER_LOOT_DURATION_MS,
    });
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

  // The master-looter arm of the same three-way reconcile (open vs shown vs
  // dismissed), against IWorld.activeMasterLootRolls instead of activeLootRolls.
  // Same pure core, same grace, separate state; the rows it drives are the master
  // curate prompt, which only ever reaches the master looter because the surface
  // itself is filtered server-side to `masterLooter === pid`.
  //
  // The re-shown row is rebuilt from the PROMPT, never from the retained event, so
  // a candidate who left during the window is gone from the checkbox list and the
  // looter cannot re-pick the pid that was just refused. A row that is ALREADY up
  // is refreshed the same way whenever the roster moves, which is what keeps the
  // looter from having to eat a refusal at all; render() carries the surviving
  // checked pids across that repaint.
  private reconcileMasterRolls(): void {
    const open = this.deps.world().activeMasterLootRolls();
    if (
      open.length === 0 &&
      this.activeMasterRolls.size === 0 &&
      this.dismissedMasterRolls.size === 0 &&
      this.confirmedMasterRolls.size === 0
    ) {
      return;
    }
    const promptById = new Map(open.map((prompt) => [prompt.rollId, prompt] as const));
    const dismissedAt: Record<number, number> = {};
    for (const [rollId, entry] of this.dismissedMasterRolls) dismissedAt[rollId] = entry.at;
    const decision = reconcileLootRolls({
      open: open.map((prompt) => prompt.rollId),
      shown: [...this.activeMasterRolls.keys()],
      dismissed: [...this.dismissedMasterRolls.keys()],
      confirmed: [...this.confirmedMasterRolls],
      dismissedAt,
      nowMs: this.deps.now(),
    });
    this.confirmedMasterRolls = new Set(decision.confirmed);
    for (const rollId of decision.toPrune) this.dismissedMasterRolls.delete(rollId);
    let changed = false;
    for (const rollId of decision.toRetire) {
      this.activeMasterRolls.delete(rollId);
      changed = true;
    }
    for (const rollId of decision.toShow) {
      const prompt = promptById.get(rollId);
      if (!prompt) continue;
      // Resume the cleared row's clock rather than restarting it, so a row restored
      // four minutes into a curate window does not paint a full five-minute bar.
      //
      // A clock that has ALREADY run out is not resumable: that is the row the
      // local timer retired while the sim still lists the roll open, so the local
      // estimate was simply wrong and carries no information. Resuming it there
      // would expire the row again inside this same update() and leave the two
      // halves trading the roll back and forth every grace period forever.
      const dismissed = this.dismissedMasterRolls.get(rollId);
      const prior =
        dismissed && dismissed.receivedAt + dismissed.durationMs > this.deps.now()
          ? dismissed
          : null;
      this.activeMasterRolls.set(rollId, {
        event: { type: 'masterLoot', ...prompt },
        receivedAt: prior?.receivedAt ?? this.deps.now(),
        durationMs: prior?.durationMs ?? MASTER_LOOT_DURATION_MS,
      });
      changed = true;
    }
    // A shown row the pure core deliberately leaves alone (it only decides
    // show/retire/prune) still has to follow the roster: the surface rebuilds
    // `candidates` from the roll's live candidate list, so a candidate who logs out
    // mid-window must leave the checkbox list while the row is up. Keep the row's
    // existing clock; only the payload moves.
    for (const [rollId, shown] of this.activeMasterRolls) {
      const prompt = promptById.get(rollId);
      if (!prompt || candidateKey(prompt.candidates) === candidateKey(shown.event.candidates))
        continue;
      shown.event = { type: 'masterLoot', ...prompt };
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
    this.statusRows = rows;
    const live = new Set(rows.map((row) => row.rollId));
    for (const rollId of this.watchTimers.keys()) {
      if (!live.has(rollId)) this.watchTimers.delete(rollId);
    }
    for (const row of rows) {
      if (!this.watchTimers.has(row.rollId)) this.watchTimers.set(row.rollId, now);
    }
    // The CATCH is the fix (R34 review): an uncontained render throw (a
    // canvas-exhausted host is enough) used to abort the whole event batch,
    // eating every concurrent need/greed prompt. The finally commits the
    // fingerprint on the throwing path too, which is the last-complete-paint
    // trade, deliberately NOT a retry: identical data never re-renders (so a
    // persistently-throwing host cannot become a per-frame throw storm), and
    // the next DATA change re-renders because the committed fingerprint
    // differs. tests/loot_roll_controller.test.ts pins both halves.
    try {
      this.render();
    } catch (err) {
      console.error('[hud] loot roll render failed', err);
    } finally {
      this.statusFingerprint = fingerprint;
    }
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
        // Recorded for the same reason the need/greed loop directly above records
        // its own local expiry: the local clock only estimates the sim's deadline,
        // so a row retired here while the sim still lists the roll open must wait
        // out the grace before the mirror is allowed to bring it back.
        this.rememberDismissedMaster(rollId, now, roll);
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

  // The pids currently checked on each master row, keyed by rollId. render() tears
  // the whole loot-roll root down and rebuilds it, so without this any repaint (a
  // vote-strip change, another roll opening, a roster refresh) silently clears a
  // half-made selection the looter is still working on.
  private checkedMasterPids(): Map<number, Set<number>> {
    const out = new Map<number, Set<number>>();
    const root = this.deps.document.getElementById('loot-rolls');
    if (!root) return out;
    for (const row of root.querySelectorAll<HTMLElement>('.loot-roll')) {
      if (!row.dataset.master) continue;
      const checked = new Set<number>();
      for (const pick of row.querySelectorAll<HTMLInputElement>('.ml-pick')) {
        if (pick.checked) checked.add(Number(pick.value));
      }
      if (checked.size > 0) out.set(Number(row.dataset.rollId), checked);
    }
    return out;
  }

  private render(): void {
    const root = this.root();
    const checkedByRoll = this.checkedMasterPids();
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
      this.renderMasterRow(root, rollId, roll.event, checkedByRoll.get(rollId));
    }
    for (const [rollId, roll] of this.activeRolls) {
      const event = roll.event;
      const item = knownItemDef(ITEMS, event.itemId);
      const itemName = item ? itemDisplayName(item) : event.itemName;
      const quality = item?.quality ?? event.quality ?? 'common';
      const nameColor = itemNameColor({ kind: item?.kind, quality });
      const status = statusByRoll.get(rollId);
      const row = this.deps.document.createElement('div');
      row.className = 'loot-roll panel';
      row.dataset.rollId = String(rollId);
      this.deps.writers.setStyleProp(row, '--loot-roll-frac', '1.000');
      row.innerHTML = `
        <div class="loot-roll-item">
          ${item ? this.deps.itemIcon(item) : unknownItemIconHtml(event.itemId, quality)}
          <div class="loot-roll-copy">
            <div class="loot-roll-title">${esc(t('itemUi.lootRoll.title'))}</div>
            <div class="loot-roll-name" style="color:${nameColor}">${esc(itemName)}</div>
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
      const item = knownItemDef(ITEMS, status.itemId);
      const itemName = item ? itemDisplayName(item) : status.itemName;
      const quality = item?.quality ?? status.quality ?? 'common';
      const nameColor = itemNameColor({ kind: item?.kind, quality });
      const row = this.deps.document.createElement('div');
      row.className = 'loot-roll panel watch';
      row.dataset.rollId = String(status.rollId);
      row.dataset.watch = '1';
      this.deps.writers.setStyleProp(row, '--loot-roll-frac', '1.000');
      row.innerHTML = `
        <div class="loot-roll-item">
          ${item ? this.deps.itemIcon(item) : unknownItemIconHtml(status.itemId, quality)}
          <div class="loot-roll-copy">
            <div class="loot-roll-title">${esc(t('itemUi.lootRoll.title'))}</div>
            <div class="loot-roll-name" style="color:${nameColor}">${esc(itemName)}</div>
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

  private renderMasterRow(
    root: HTMLElement,
    rollId: number,
    event: MasterLootEvent,
    checked?: Set<number>,
  ): void {
    const item = knownItemDef(ITEMS, event.itemId);
    const itemName = item ? itemDisplayName(item) : event.itemName;
    const quality = item?.quality ?? event.quality ?? 'common';
    const nameColor = itemNameColor({ kind: item?.kind, quality });
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
        ${item ? this.deps.itemIcon(item) : unknownItemIconHtml(event.itemId, quality)}
        <div class="loot-roll-copy">
          <div class="loot-roll-title">${esc(t('hudChrome.masterLoot.assignPrompt', { item: itemName }))}</div>
          <div class="loot-roll-name" style="color:${nameColor}">${esc(itemName)}</div>
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
    // Carry a selection made before this repaint. Only pids still on the roster
    // survive: a candidate the sim has dropped must not come back checked, which is
    // the whole reason the roster refresh exists.
    if (checked) {
      for (const pick of pickElements) pick.checked = checked.has(Number(pick.value));
    }
    const syncRoll = (): void => {
      const picked = pickElements.filter((pick) => pick.checked).length;
      rollButton.disabled = picked === 0;
      selectAll.checked = pickElements.length > 0 && picked === pickElements.length;
    };
    // A carried selection has to re-derive the button and select-all state, or the
    // row comes back with boxes ticked and Roll still greyed out.
    if (checked) syncRoll();
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
