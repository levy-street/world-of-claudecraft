// The prompt's DOM half: one line, restyled by tone, written only when it changes.
//
// Built once and re-stated through the shared PainterHost writers. The signature gate is
// load-bearing rather than an optimization: the prompt is evaluated every frame and two of
// its lines carry a live countdown, so an ungated painter would write text and toggle four
// classes sixty times a second for a string that changes once a second.

import { t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import {
  type ShardpikePromptState,
  type ShardpikePromptTone,
  shardpikePromptSignature,
} from './shardpike_prompt_view';

const TONES: readonly ShardpikePromptTone[] = ['urgent', 'active', 'directive', 'idle', 'success'];

export class ShardpikePromptPainter {
  private body: HTMLElement | null = null;
  private tally: HTMLElement | null = null;
  private last = '';

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly root: HTMLElement,
  ) {}

  paint(state: ShardpikePromptState): void {
    const sig = shardpikePromptSignature(state);
    if (sig === this.last) return;
    this.last = sig;
    this.writers.setDisplay(this.root, state.visible ? 'flex' : 'none');
    if (!state.visible) return;
    if (!this.body) this.build();
    if (!this.body || !this.tally) return;
    for (const tone of TONES) {
      this.writers.toggleClass(this.root, `tone-${tone}`, tone === state.tone);
    }
    this.writers.setText(this.body, t(state.bodyKey, state.values));
    // The tally is the "+1, +2" running count: the only thing on screen telling a low-level
    // player that the windows the raid spent were opened by them.
    //
    // Visibility goes through setStyleProp, NOT setDisplay, because the tally also takes
    // setText below. The four single-slot writers share ONE cache entry per element, so two
    // of them on one node flip that entry on every call and BOTH writes bypass elision
    // forever (see painter_host.ts, "THE GUARANTEE IS PER (ELEMENT, KIND)"). setStyleProp is
    // multi-slot, keyed (element, 'display'), and writes the identical inline display.
    this.writers.setStyleProp(this.tally, 'display', state.thrusts === null ? 'none' : 'block');
    if (state.thrusts !== null) {
      this.writers.setText(
        this.tally,
        t('hudChrome.shardpike.promptTally', { count: String(state.thrusts) }),
      );
    }
  }

  hide(): void {
    this.writers.setDisplay(this.root, 'none');
    this.last = 'hidden';
  }

  /**
   * One-time build, deferred to the first visible paint.
   *
   * Same reason the bar defers: almost no session ever carries this quest tool, and a
   * player who never takes the quest should not have the element in their document.
   */
  private build(): void {
    const doc = this.root.ownerDocument;
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('aria-label', t('hudChrome.shardpike.promptLabel'));
    const body = doc.createElement('div');
    body.className = 'pike-prompt-body';
    const tally = doc.createElement('div');
    tally.className = 'pike-prompt-tally';
    this.root.append(body, tally);
    this.body = body;
    this.tally = tally;
  }
}
