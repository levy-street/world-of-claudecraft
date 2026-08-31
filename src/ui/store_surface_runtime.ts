// Async ownership for one Store surface. Snapshot refreshes are ordered by a
// request generation; window/tab visits by a separate surface generation. The
// latter also owns the Store prompt controller, so invalidating a surface and
// cleaning its modal can never drift into two call sites.

import { formatNumber, t } from './i18n';
import { type StoreDecisionPromptOptions, StoreDecisionPrompts } from './store_decision_prompt';

export class StoreSurfaceRuntime {
  private requestGeneration = 0;
  private surfaceGeneration = 0;
  private readonly prompts: StoreDecisionPrompts;

  constructor(private readonly root: () => HTMLElement) {
    // Construction registers the prompts panel with the module Escape
    // registry, which holds it WEAKLY: the shipped owner (the daily-rewards
    // window) lives for the whole client session, and an owner that dies
    // without ceremony cannot be retained by the registry alone. A
    // shorter-lived owner would call prompts.unregister() from its destroy
    // path (the handle the prompts instance already carries); no dispose
    // wrapper exists here because no such owner does.
    this.prompts = new StoreDecisionPrompts(root);
  }

  beginRequest(): number {
    return ++this.requestGeneration;
  }

  requestIsCurrent(generation: number, visible: boolean): boolean {
    return generation === this.requestGeneration && visible;
  }

  captureSurface(): number {
    return this.surfaceGeneration;
  }

  surfaceIsCurrent(generation: number, visible: boolean): boolean {
    return generation === this.surfaceGeneration && visible;
  }

  invalidateSurface(): void {
    this.requestGeneration += 1;
    this.surfaceGeneration += 1;
    this.prompts.dismiss(false);
  }

  openDecision(options: Omit<StoreDecisionPromptOptions, 'closeText'>): boolean {
    return this.prompts.open({ ...options, closeText: t('hudChrome.wocStore.close') });
  }

  showResult(tone: 'success' | 'failure', text: string): void {
    this.prompts.showResult({ tone, text, closeText: t('hudChrome.wocStore.close') });
  }

  setLoading(loading: boolean): void {
    const indicator = this.root().querySelector<HTMLElement>('[data-woc-store-loading]');
    if (!indicator) return;
    indicator.classList.toggle('active', loading);
    indicator.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  needMoreText(
    itemName: string,
    cost: number,
    balance: number | null,
    fallback: number | null,
  ): string {
    const shortfall = formatNumber(Math.max(0, cost - (balance ?? fallback ?? 0)), {
      maximumFractionDigits: 0,
    });
    return t('hudChrome.wocStore.needMoreBody', { item: itemName, shortfall });
  }

  openTopUp(options: {
    itemName: string;
    cost: number;
    balance: number | null;
    fallbackBalance: number | null;
    generation: number;
    visible: boolean;
    onConfirm(): void;
    showDecision(options: Omit<StoreDecisionPromptOptions, 'closeText'>): void;
  }): void {
    const body = this.needMoreText(
      options.itemName,
      options.cost,
      options.balance,
      options.fallbackBalance,
    );
    if (!this.surfaceIsCurrent(options.generation, options.visible)) {
      this.showResult('failure', body);
      return;
    }
    options.showDecision({
      title: t('hudChrome.wocStore.needMoreTitle'),
      body,
      confirmText: t('hudChrome.wocStore.buyClaudium'),
      cancelText: t('hudChrome.wocStore.cancel'),
      onConfirm: options.onConfirm,
    });
  }
}
