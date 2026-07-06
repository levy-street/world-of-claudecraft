// The off-chain $WOC governance panel (PR #468): a self-contained HUD window the
// Hud composes (its own module, NOT a banner section in hud.ts). Advisory,
// Snapshot-style holder voting; it lists proposals, shows each weighted tally +
// quorum, and casts a vote through the injected challenge -> sign -> submit flow.
//
// Following the daily_rewards_window idiom: the window owns its DOM and focus, and
// every side effect (the REST reads, the wallet signature) is an INJECTED dep so
// this module never imports src/net or the wallet directly (the src/ui dependency
// rule). Every player-visible string is a t() key rendered through t(); interpolated
// text passes through esc(). No framework, no Tailwind. Nothing here touches src/sim.

import { esc } from './esc';
import { formatDateTime, formatNumber, type TranslationKey, t } from './i18n';

/** Localized category label (explicit map: t() keys are a strict literal union). */
function categoryLabel(category: GovernancePanelProposal['category']): string {
  switch (category) {
    case 'content':
      return t('hudChrome.governance.category.content');
    case 'cosmetic':
      return t('hudChrome.governance.category.cosmetic');
    case 'treasury':
      return t('hudChrome.governance.category.treasury');
  }
}

/** The proposal shape the panel renders (structural; mirrors the server JSON). */
export interface GovernancePanelProposal {
  id: number;
  category: 'content' | 'cosmetic' | 'treasury';
  title: string;
  body: string;
  closesAt: number;
  quorum: number;
  open: boolean;
}

/** The tally shape the panel renders (structural; mirrors the server JSON). */
export interface GovernancePanelTally {
  proposalId: number;
  for: number;
  against: number;
  abstain: number;
  totalWeight: number;
  voterCount: number;
  quorum: number;
  quorumReached: boolean;
  open: boolean;
}

export type GovernanceVoteChoice = 'for' | 'against' | 'abstain';

/** The result of a vote attempt, so the panel can show the outcome inline. */
export type GovernanceVoteResult =
  | { ok: true; choice: GovernanceVoteChoice }
  | { ok: false; message: string };

export interface GovernancePanelDeps {
  /** The pre-existing panel root element in index.html (lazy: resolved at use time). */
  root(): HTMLElement;
  /** Close sibling HUD windows when this one opens. */
  closeOthers(): void;
  /** Capture the currently focused element so it can be restored on close. */
  captureFocus(): HTMLElement | null;
  /** Restore focus to the opener on close (WCAG focus return). */
  restoreFocus(target: HTMLElement | null): void;
  /** Notify the HUD that this window's visibility changed (any-window-open state). */
  onVisibilityChange?(): void;
  /** True when a verified wallet is linked (voting requires one). */
  hasLinkedWallet(): boolean;
  /** Fetch the current proposals (newest first). Throws a localized-message Error. */
  listProposals(): Promise<GovernancePanelProposal[]>;
  /** Fetch one proposal's weighted tally. Throws a localized-message Error. */
  tally(proposalId: number): Promise<GovernancePanelTally>;
  /**
   * Run the full vote flow for a proposal + choice (challenge, wallet-sign, submit).
   * Never throws: it returns a result the panel renders inline (ok, or a localized
   * failure message).
   */
  castVote(proposalId: number, choice: GovernanceVoteChoice): Promise<GovernanceVoteResult>;
}

/** How often the open panel re-polls tallies (advisory data moves slowly). */
const POLL_INTERVAL_MS = 20_000;

export class GovernancePanel {
  private openerFocus: HTMLElement | null = null;
  private poll: number | null = null;
  private renderSeq = 0;
  private voting = false;
  private tallies = new Map<number, GovernancePanelTally>();

  constructor(private readonly deps: GovernancePanelDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    const root = this.deps.root();
    root.style.display = 'block';
    this.deps.onVisibilityChange?.();
    this.ensureShell();
    void this.render('open');
    this.poll = window.setInterval(() => {
      if (this.isOpen && !this.voting) void this.render(null);
    }, POLL_INTERVAL_MS);
  }

  close(): void {
    const root = this.deps.root();
    if (root.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    if (this.poll !== null) {
      window.clearInterval(this.poll);
      this.poll = null;
    }
    root.style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.deps.onVisibilityChange?.();
  }

  /** Build the window chrome (title + close button + body host) once. */
  private ensureShell(): void {
    const root = this.deps.root();
    if (root.querySelector('[data-governance-body]')) return;
    root.innerHTML = [
      '<div class="governance-window" role="dialog" aria-modal="true" aria-labelledby="governance-title">',
      '  <header class="governance-header">',
      `    <div><h2 id="governance-title">${esc(t('hudChrome.governance.title'))}</h2>`,
      `    <p class="governance-subtitle">${esc(t('hudChrome.governance.subtitle'))}</p></div>`,
      `    <button type="button" class="governance-close" data-close aria-label="${esc(
        t('hudChrome.governance.close'),
      )}">&#215;</button>`,
      '  </header>',
      '  <div class="governance-body" data-governance-body></div>',
      '</div>',
    ].join('');
    (root.querySelector('[data-close]') as HTMLElement | null)?.addEventListener('click', () =>
      this.close(),
    );
  }

  async render(focus: 'open' | null = null): Promise<void> {
    const root = this.deps.root();
    const seq = ++this.renderSeq;
    this.ensureShell();
    if (focus === 'open') (root.querySelector('[data-close]') as HTMLElement | null)?.focus();
    const body = root.querySelector('[data-governance-body]') as HTMLElement | null;
    if (!body) return;
    if (this.tallies.size === 0 && focus === 'open') {
      body.innerHTML = `<p class="governance-status">${esc(t('hudChrome.governance.loading'))}</p>`;
    }
    let proposals: GovernancePanelProposal[];
    try {
      proposals = await this.deps.listProposals();
    } catch {
      if (seq === this.renderSeq && this.isOpen) {
        body.innerHTML = `<p class="governance-status governance-error">${esc(
          t('hudChrome.governance.error'),
        )}</p>`;
      }
      return;
    }
    if (!this.isOpen || seq !== this.renderSeq) return;
    // Fetch tallies for the visible proposals; a per-proposal failure is non-fatal
    // (that card just shows no counts), so the list still renders.
    await Promise.all(
      proposals.map(async (p) => {
        try {
          this.tallies.set(p.id, await this.deps.tally(p.id));
        } catch {
          // Leave any prior tally in place; the card renders without fresh counts.
        }
      }),
    );
    if (!this.isOpen || seq !== this.renderSeq) return;
    this.paint(body, proposals);
  }

  private paint(body: HTMLElement, proposals: GovernancePanelProposal[]): void {
    if (proposals.length === 0) {
      body.innerHTML = `<p class="governance-status">${esc(t('hudChrome.governance.empty'))}</p>`;
      return;
    }
    body.innerHTML = proposals.map((p) => this.cardHtml(p)).join('');
    for (const p of proposals) {
      if (!p.open) continue;
      for (const choice of ['for', 'against', 'abstain'] as const) {
        const btn = body.querySelector(
          `[data-vote="${p.id}:${choice}"]`,
        ) as HTMLButtonElement | null;
        btn?.addEventListener('click', () => void this.onVote(p.id, choice));
      }
    }
  }

  private cardHtml(p: GovernancePanelProposal): string {
    const tally = this.tallies.get(p.id);
    const closeLabel = p.open
      ? t('hudChrome.governance.closesAt', { date: formatDateTime(new Date(p.closesAt)) })
      : t('hudChrome.governance.closedAt', { date: formatDateTime(new Date(p.closesAt)) });
    const statusLabel = p.open ? t('hudChrome.governance.open') : t('hudChrome.governance.closed');
    return [
      `<article class="governance-card" data-proposal="${p.id}">`,
      '  <div class="governance-card-head">',
      `    <span class="governance-category governance-category-${esc(p.category)}">${esc(
        categoryLabel(p.category),
      )}</span>`,
      `    <span class="governance-state governance-state-${p.open ? 'open' : 'closed'}">${esc(
        statusLabel,
      )}</span>`,
      '  </div>',
      `  <h3 class="governance-card-title">${esc(p.title)}</h3>`,
      p.body ? `  <p class="governance-card-body">${esc(p.body)}</p>` : '',
      tally ? this.tallyHtml(tally) : '',
      `  <p class="governance-close-at">${esc(closeLabel)}</p>`,
      this.actionsHtml(p),
      '</article>',
    ].join('');
  }

  private tallyHtml(tally: GovernancePanelTally): string {
    const row = (labelKey: TranslationKey, value: number): string =>
      `<div class="governance-tally-row"><span>${esc(t(labelKey))}</span><span>${esc(
        formatNumber(value),
      )}</span></div>`;
    const quorumLabel = t('hudChrome.governance.quorum', {
      current: formatNumber(tally.totalWeight),
      needed: formatNumber(tally.quorum),
    });
    return [
      '<div class="governance-tally">',
      row('hudChrome.governance.tally.for', tally.for),
      row('hudChrome.governance.tally.against', tally.against),
      row('hudChrome.governance.tally.abstain', tally.abstain),
      `<div class="governance-tally-meta">${esc(
        t('hudChrome.governance.tally.voters', { count: formatNumber(tally.voterCount) }),
      )}</div>`,
      `<div class="governance-quorum${tally.quorumReached ? ' governance-quorum-met' : ''}">${esc(
        tally.quorumReached ? t('hudChrome.governance.quorumReached') : quorumLabel,
      )}</div>`,
      '</div>',
    ].join('');
  }

  private actionsHtml(p: GovernancePanelProposal): string {
    if (!p.open) return '';
    if (!this.deps.hasLinkedWallet()) {
      return `<p class="governance-need-wallet">${esc(
        t('hudChrome.governance.vote.needWallet'),
      )}</p>`;
    }
    const button = (choice: GovernanceVoteChoice, labelKey: TranslationKey): string =>
      `<button type="button" class="governance-vote-btn governance-vote-${choice}" data-vote="${p.id}:${choice}">${esc(
        t(labelKey),
      )}</button>`;
    return [
      '<div class="governance-actions">',
      button('for', 'hudChrome.governance.vote.for'),
      button('against', 'hudChrome.governance.vote.against'),
      button('abstain', 'hudChrome.governance.vote.abstain'),
      '</div>',
      `<p class="governance-vote-status" data-vote-status="${p.id}" role="status"></p>`,
    ].join('');
  }

  private setVoteStatus(proposalId: number, message: string, isError: boolean): void {
    const el = this.deps
      .root()
      .querySelector(`[data-vote-status="${proposalId}"]`) as HTMLElement | null;
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('governance-vote-status-error', isError);
  }

  private setActionsDisabled(proposalId: number, disabled: boolean): void {
    const card = this.deps
      .root()
      .querySelector(`[data-proposal="${proposalId}"]`) as HTMLElement | null;
    for (const btn of card?.querySelectorAll('.governance-vote-btn') ?? []) {
      (btn as HTMLButtonElement).disabled = disabled;
    }
  }

  private async onVote(proposalId: number, choice: GovernanceVoteChoice): Promise<void> {
    if (this.voting) return;
    this.voting = true;
    this.setActionsDisabled(proposalId, true);
    this.setVoteStatus(proposalId, t('hudChrome.governance.vote.signing'), false);
    const result = await this.deps.castVote(proposalId, choice);
    this.voting = false;
    if (result.ok) {
      this.setVoteStatus(proposalId, t('hudChrome.governance.vote.success'), false);
      // Refresh so the new weight appears in the tally.
      void this.render(null);
    } else {
      this.setVoteStatus(proposalId, result.message, true);
      this.setActionsDisabled(proposalId, false);
    }
  }
}
