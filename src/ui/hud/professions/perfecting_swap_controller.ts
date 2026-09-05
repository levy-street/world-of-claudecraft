// A second owned-piece selection inside Perfecting, with one shared prompt.
// No timer or gameplay decisions: the window polls the pure model and the
// authoritative command answers through its correlated personal result event.
import { ITEMS } from '../../../sim/data';
import { PERFECTING_SKILL_REQ } from '../../../sim/professions/perfecting';
import {
  type PerfectItemRef,
  perfectingCopyMatches,
} from '../../../sim/professions/perfecting_copy';
import type { PerfectingSwapRequest } from '../../../sim/professions/perfecting_swap';
import type { SimEvent } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { FOCUS_KEY_ATTR } from '../../focus_restore';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import { installPromptDialog, type PromptDialogHandle } from '../../prompt_dialog';
import { rovingTarget } from '../../roving_index';
import { perfectingCandidateLocation, perfectingCandidateRank } from './perfecting_candidate_view';
import {
  buildPerfectingSwapView,
  type PerfectingRankChange,
  type PerfectingSwapUiReason,
  type PerfectingSwapView,
  perfectingSwapViewSignature,
  samePerfectingSwapRequest,
} from './perfecting_swap_view';
import type { PerfectingCandidate, PerfectingViewModel } from './perfecting_view';

interface PerfectingSwapDeps {
  world(): IWorld;
  root(): HTMLElement;
  current(): boolean;
  blocked(): boolean;
  repaint(): void;
  pending(value: boolean): void;
  announce(text: string): void;
  returnFocus(): void;
}

const reasonKeys: Record<PerfectingSwapUiReason, TranslationKey> = {
  dead: 'hudChrome.perfecting.swapDead',
  busy: 'hudChrome.perfecting.swapBusy',
  no_item: 'hudChrome.perfecting.swapChanged',
  same_item: 'hudChrome.perfecting.swapChoose',
  different_collection: 'hudChrome.perfecting.swapChanged',
  invalid_progress: 'hudChrome.perfecting.swapInvalid',
  same_rank: 'hudChrome.perfecting.swapSameRank',
  insufficient_skill: 'hudChrome.perfecting.swapSkill',
  out_of_range: 'hudChrome.perfecting.swapStation',
  locked: 'hudChrome.perfecting.swapLocked',
  choose_target: 'hudChrome.perfecting.swapChoose',
  changed: 'hudChrome.perfecting.swapChanged',
  syncing: 'hudChrome.perfecting.skillSyncing',
};

function skillText(key: TranslationKey): string {
  return t(key, { skill: formatNumber(PERFECTING_SKILL_REQ, { maximumFractionDigits: 0 }) });
}

function nameOf(itemId: string): string {
  const def = ITEMS[itemId];
  return def ? itemDisplayName(def) : t('hudChrome.perfecting.unknownItem');
}

function changeText(change: PerfectingRankChange): string {
  return t('hudChrome.perfecting.swapRank', {
    name: change.name ?? nameOf(change.itemId),
    before: formatNumber(change.from, { maximumFractionDigits: 0 }),
    after: formatNumber(change.to, { maximumFractionDigits: 0 }),
  });
}

function changesHtml(
  model: PerfectingSwapView,
  candidates: readonly PerfectingCandidate[],
): string {
  const refs = model.request ? [model.request.source, model.request.target] : [];
  return model.changes
    .map((change, index) => {
      const ref = refs[index];
      const location = ref ? perfectingCandidateLocation(ref, candidates) : null;
      return `<li>${esc(changeText(change))}${location ? `<div class="pf-cand-sub">${esc(location)}</div>` : ''}${change.enchantChange ? `<p>${esc(t(change.enchantChange === 'inactive' ? 'hudChrome.perfecting.swapEnchantInactive' : 'hudChrome.perfecting.swapEnchantActive'))}</p>` : ''}</li>`;
    })
    .join('');
}

export class PerfectingSwapController {
  private target: PerfectItemRef | null = null;
  private sending: PerfectingSwapRequest | null = null;
  private prompt: PromptDialogHandle | null = null;
  private promptRefresh: (() => void) | null = null;
  private notice: TranslationKey | null = null;
  // cprof is replaced wholesale on the first post-hello self snapshot. Keep
  // this receipt witness across close/open; stale mirrors must not re-arm it.
  private reconnectIdentity: IWorld['craftingIdentity'] | null = null;

  constructor(private readonly deps: PerfectingSwapDeps) {}

  get pending(): boolean {
    return this.sending !== null;
  }
  get confirming(): boolean {
    return this.prompt !== null;
  }
  get waitingForSnapshot(): boolean {
    const identity = this.deps.world().craftingIdentity;
    return (
      this.reconnectIdentity !== null && (identity === this.reconnectIdentity || !identity.synced)
    );
  }
  get outcomeUnconfirmed(): boolean {
    return this.notice === 'hudChrome.perfecting.swapInterrupted';
  }

  signature(view: PerfectingViewModel): string {
    return perfectingSwapViewSignature(
      buildPerfectingSwapView(this.deps.world(), view, this.target),
    );
  }

  html(view: PerfectingViewModel): string {
    const model = buildPerfectingSwapView(this.deps.world(), view, this.target);
    if (!model) return '';
    const selected = Math.max(
      0,
      model.rows.findIndex((row) => row.selected),
    );
    const rows = model.rows
      .map(
        (row, index) =>
          `<li role="none"><button type="button" class="pf-cand" role="radio" data-swap-target="${index}" ${FOCUS_KEY_ATTR}="swap:${esc(row.candidate.identity)}" aria-checked="${row.selected}" tabindex="${index === selected ? 0 : -1}"${this.pending || this.waitingForSnapshot ? ' disabled' : ''}><span class="pf-cand-names">${esc(row.candidate.chosenName ?? nameOf(row.candidate.itemId))}<span class="pf-cand-sub">${esc(perfectingCandidateLocation(row.ref, view.candidates) ?? '')}</span></span><span class="pf-cand-state">${esc(perfectingCandidateRank(row.candidate.rank, row.candidate.ranks))}</span></button></li>`,
      )
      .join('');
    const preview = model.changes.length
      ? `<ul class="pf-swap-preview" data-swap-preview>${changesHtml(model, view.candidates)}</ul>`
      : '';
    const reason = this.notice ?? (model.reason ? reasonKeys[model.reason] : null);
    return `<section class="pf-swap-section" data-swap-section aria-labelledby="pf-swap-title"><h3 id="pf-swap-title">${esc(t('hudChrome.perfecting.swapTitle'))}</h3><p>${esc(skillText('hudChrome.perfecting.swapIntro'))}</p><ul class="pf-list" role="radiogroup" aria-labelledby="pf-swap-title">${rows}</ul>${preview}${reason ? `<p class="pf-warning" role="note">${esc(skillText(reason))}</p>` : ''}<button type="button" class="pf-action" data-swap-action ${FOCUS_KEY_ATTR}="pfSwapAction"${!model.enabled || this.deps.blocked() || this.waitingForSnapshot ? ' disabled' : ''}>${esc(t(this.pending ? 'hudChrome.perfecting.swapPending' : 'hudChrome.perfecting.swapAction'))}</button></section>`;
  }

  wire(view: PerfectingViewModel): void {
    const model = buildPerfectingSwapView(this.deps.world(), view, this.target);
    if (!model) return;
    const root = this.deps.root();
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-swap-target]')];
    const pick = (index: number, focus: boolean) => {
      if (this.deps.blocked() || this.prompt || !this.deps.current() || this.waitingForSnapshot)
        return;
      const row = model.rows[index];
      if (!row) return;
      if (focus) buttons[index]?.focus();
      this.target = row.ref;
      this.notice = null;
      this.deps.repaint();
    };
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => pick(index, false));
      button.addEventListener('keydown', (event) => {
        const next = rovingTarget(event.key, index, buttons.length, 'both');
        if (next === null) return;
        event.preventDefault();
        pick(next, true);
      });
    });
    root.querySelector('[data-swap-action]')?.addEventListener('click', () => {
      if (
        model.enabled &&
        !this.deps.blocked() &&
        !this.prompt &&
        this.deps.current() &&
        !this.waitingForSnapshot
      )
        this.confirm(model, view.candidates);
    });
  }

  relocalize(): void {
    this.promptRefresh?.();
  }

  clearSelection(): void {
    this.target = null;
    this.notice = null;
  }

  close(): void {
    this.prompt?.dismiss();
    this.sending = null;
    this.clearSelection();
  }

  onReconnected(): void {
    this.reconnectIdentity = this.deps.world().craftingIdentity;
    if (!this.deps.current()) return;
    const interrupted = this.pending;
    this.close();
    if (interrupted) {
      this.deps.pending(false);
      this.notice = 'hudChrome.perfecting.swapInterrupted';
    }
    this.deps.repaint();
    if (this.notice) this.deps.announce(skillText(this.notice));
  }

  onResult(event: Extract<SimEvent, { type: 'perfectingSwapResult' }>): void {
    const sent = this.sending;
    if (
      !sent ||
      !this.deps.current() ||
      event.pid !== this.deps.world().player.id ||
      !samePerfectingSwapRequest(sent, event.request)
    )
      return;
    this.sending = null;
    this.deps.pending(false);
    this.target = null;
    this.notice = event.ok
      ? 'hudChrome.perfecting.swapSuccess'
      : reasonKeys[event.reason ?? 'changed'];
    this.deps.repaint();
    this.deps.announce(skillText(this.notice));
  }

  private confirm(model: PerfectingSwapView, candidates: readonly PerfectingCandidate[]): void {
    const request = model.request;
    const stack = document.getElementById('prompt-stack');
    if (!request || !stack) return;
    const prompt = document.createElement('div');
    prompt.className = 'prompt panel pf-swap-prompt';
    // Mouse activation parks focus on the dialog root through Input's shared
    // focus release. Keep Escape and subsequent Tab presses inside this modal.
    prompt.tabIndex = -1;
    const text = document.createElement('div');
    text.className = 'prompt-text';
    const actions = document.createElement('div');
    actions.className = 'pf-name-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn pf-bind-cancel';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn pf-bind-confirm';
    confirm.dataset.swapConfirm = '';
    const refresh = () => {
      text.innerHTML = `<p>${esc(t('hudChrome.perfecting.swapConfirm'))}</p><ul>${changesHtml(model, candidates)}</ul><p>${esc(t('hudChrome.perfecting.swapPreserve'))}</p>`;
      cancel.textContent = t('hudChrome.perfecting.bindConfirmCancel');
      confirm.textContent = t('hudChrome.perfecting.swapConfirmAccept');
    };
    refresh();
    actions.append(cancel, confirm);
    prompt.append(text, actions);
    const handle = installPromptDialog(
      prompt,
      this.deps.root().querySelector('[data-swap-action]'),
      () => {
        this.prompt = null;
        this.promptRefresh = null;
        prompt.remove();
        this.deps.returnFocus();
      },
      { inertRoot: this.deps.root(), idPrefix: 'pf-swap-confirm-title' },
    );
    this.prompt = handle;
    this.promptRefresh = refresh;
    cancel.addEventListener('click', () => handle.dismissAndReturn());
    confirm.addEventListener('click', () => {
      if (
        this.prompt !== handle ||
        !this.deps.current() ||
        this.deps.blocked() ||
        this.waitingForSnapshot
      )
        return;
      const world = this.deps.world();
      const current =
        perfectingCopyMatches(world, request.source) &&
        perfectingCopyMatches(world, request.target);
      const info = current ? world.perfectingSwapInfo(request) : null;
      handle.dismissAndReturn();
      if (!current || !info || info.reason) {
        this.notice = reasonKeys[info?.reason ?? 'changed'];
        this.deps.repaint();
        this.deps.announce(skillText(this.notice));
        return;
      }
      this.sending = request;
      this.deps.pending(true);
      this.deps.repaint();
      world.swapPerfectingRanks(request);
    });
    stack.append(prompt);
    cancel.focus();
  }
}
