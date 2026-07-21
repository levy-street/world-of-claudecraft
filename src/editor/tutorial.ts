// The editor's Help modal and first-run tutorial tour. Owns both surfaces; the
// app only instantiates it and wires the topbar Help button to openHelp().
//
// Help modal: the tool list, keyboard shortcuts, mouse navigation, and the
// save/draft/playtest flow, plus the "Begin tutorial" entry. Reuses the shared
// editor modal classes (ed-modal-overlay / ed-modal) from toasts.ts styling.
//
// Tour: drives the pure TutorialModel (tutorial_core.ts) over real UI anchors,
// drawing a highlight ring plus a positioned callout card. It can never block:
// Skip is always available, a missing/hidden anchor step is skipped, and Esc
// bails out. The seen flag lives in localStorage (read/written here; a blocked
// store reports "seen" so a broken storage never loops the auto-start).

import { formatNumber, t } from '../ui/i18n';
import { button, el } from './dom';
import { TOOL_DEFS } from './toolbar';
import {
  type SeenStore,
  TUTORIAL_SEEN_KEY,
  TUTORIAL_SEEN_VALUE,
  TUTORIAL_STEPS,
  TutorialModel,
} from './tutorial_core';

type TKey = Parameters<typeof t>[0];

const RING_PAD = 6;
const CARD_GAP = 12;
const EDGE_PAD = 8;
const AUTO_START_DELAY_MS = 700;

function localSeenStore(): SeenStore {
  return {
    get(): string | null {
      try {
        return localStorage.getItem(TUTORIAL_SEEN_KEY);
      } catch {
        // Blocked storage: report seen, so a broken store never re-loops.
        return TUTORIAL_SEEN_VALUE;
      }
    },
    set(value: string): void {
      try {
        localStorage.setItem(TUTORIAL_SEEN_KEY, value);
      } catch {
        // Best effort; the flag just re-offers the tour next visit.
      }
    },
  };
}

/** An anchor counts when it resolves to an actually laid-out element. */
function anchorVisible(selector: string): boolean {
  const node = document.querySelector(selector);
  if (!(node instanceof HTMLElement)) return false;
  const r = node.getBoundingClientRect();
  return r.width > 4 && r.height > 4;
}

function num(v: number): string {
  return formatNumber(v, { useGrouping: false });
}

export class EditorTutorial {
  private readonly model: TutorialModel;
  // Help modal state.
  private helpOverlay: HTMLElement | null = null;
  private helpReturnFocus: HTMLElement | null = null;
  // Tour state.
  private ring: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private autoStartTimer = 0;

  constructor(private readonly root: HTMLElement) {
    this.model = new TutorialModel(TUTORIAL_STEPS, localSeenStore());
  }

  /** Start the tour automatically the FIRST time the editor opens. */
  maybeAutoStart(): void {
    if (!this.model.shouldAutoStart()) return;
    // Let the first layout settle so every anchor has a real rect.
    this.autoStartTimer = window.setTimeout(() => this.startTour(), AUTO_START_DELAY_MS);
  }

  dispose(): void {
    window.clearTimeout(this.autoStartTimer);
    this.closeHelp();
    if (this.model.isRunning) this.model.skip();
    this.teardownTour();
  }

  // ---- help modal -----------------------------------------------------------

  openHelp(): void {
    if (this.helpOverlay) return;
    if (this.model.isRunning) this.skipTour();
    this.helpReturnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const overlay = el('div', 'ed-modal-overlay');
    const panel = el('div', 'ed-modal ed-help-modal');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    const title = el('h2', 'ed-modal-title', t('editor.help.title'));
    title.id = 'ed-help-title';
    panel.setAttribute('aria-labelledby', title.id);
    panel.appendChild(title);

    // Tools: one line each, name + key + description.
    panel.appendChild(el('h3', 'ed-help-section-title', t('editor.help.toolsTitle')));
    const tools = el('ul', 'ed-help-list');
    for (const def of TOOL_DEFS) {
      const li = el('li');
      li.appendChild(
        el(
          'span',
          'ed-help-term',
          t('editor.tool.keyHint', { name: t(def.labelKey), key: def.key.toUpperCase() }),
        ),
      );
      li.appendChild(el('span', undefined, t(`editor.help.tool.${def.tool}` as TKey)));
      tools.appendChild(li);
    }
    panel.appendChild(tools);

    const section = (titleKey: TKey, lineKeys: TKey[]): void => {
      panel.appendChild(el('h3', 'ed-help-section-title', t(titleKey)));
      const list = el('ul', 'ed-help-list');
      for (const key of lineKeys) list.appendChild(el('li', undefined, t(key)));
      panel.appendChild(list);
    };
    section('editor.help.shortcutsTitle', [
      'editor.help.key.tools',
      'editor.help.key.brush',
      'editor.help.key.undo',
      'editor.help.key.save',
      'editor.help.key.duplicate',
      'editor.help.key.nudge',
      'editor.help.key.wheel',
      'editor.help.key.delete',
      'editor.help.key.escape',
    ]);
    section('editor.help.mouseTitle', [
      'editor.help.mouse.orbit3d',
      'editor.help.mouse.fly3d',
      'editor.help.mouse.move',
      'editor.help.mouse.pan2d',
    ]);
    section('editor.help.flowTitle', [
      'editor.help.flow.save',
      'editor.help.flow.draft',
      'editor.help.flow.playtest',
    ]);

    const actions = el('div', 'ed-modal-actions');
    const begin = button(
      t('editor.help.beginTutorial'),
      () => {
        this.closeHelp();
        this.startTour();
      },
      'primary',
    );
    const close = button(t('editor.help.close'), () => this.closeHelp());
    actions.append(begin, close);
    panel.appendChild(actions);

    overlay.appendChild(panel);
    overlay.addEventListener('pointerdown', (ev) => {
      if (ev.target === overlay) this.closeHelp();
    });
    window.addEventListener('keydown', this.onHelpKey, true);
    this.root.appendChild(overlay);
    this.helpOverlay = overlay;
    begin.focus();
  }

  closeHelp(): void {
    if (!this.helpOverlay) return;
    window.removeEventListener('keydown', this.onHelpKey, true);
    this.helpOverlay.remove();
    this.helpOverlay = null;
    this.helpReturnFocus?.focus();
    this.helpReturnFocus = null;
  }

  private onHelpKey = (ev: KeyboardEvent): void => {
    if (!this.helpOverlay) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.closeHelp();
      return;
    }
    if (ev.key === 'Tab') {
      // Keep Tab inside the dialog (wrap at the ends).
      const focusables = this.helpOverlay.querySelectorAll<HTMLElement>('button, a[href]');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (ev.shiftKey && active === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && active === last) {
        ev.preventDefault();
        first.focus();
      }
    }
  };

  // ---- tour -------------------------------------------------------------------

  startTour(): void {
    if (this.model.isRunning) return;
    window.clearTimeout(this.autoStartTimer);
    if (!this.model.start(anchorVisible)) return;
    this.buildTourSurfaces();
    window.addEventListener('keydown', this.onTourKey, true);
    window.addEventListener('resize', this.onTourResize);
    this.renderStep();
  }

  private skipTour(): void {
    if (!this.model.isRunning) return;
    this.model.skip();
    this.teardownTour();
  }

  private nextStep(): void {
    this.model.next(anchorVisible);
    if (this.model.isRunning) this.renderStep();
    else this.teardownTour();
  }

  private backStep(): void {
    this.model.back(anchorVisible);
    if (this.model.isRunning) this.renderStep();
  }

  private buildTourSurfaces(): void {
    this.ring = el('div', 'ed-tour-ring');
    this.card = el('div', 'ed-tour-card');
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-label', t('editor.tutorial.title'));
    this.root.append(this.ring, this.card);
  }

  private teardownTour(): void {
    window.removeEventListener('keydown', this.onTourKey, true);
    window.removeEventListener('resize', this.onTourResize);
    this.ring?.remove();
    this.card?.remove();
    this.ring = null;
    this.card = null;
  }

  private onTourKey = (ev: KeyboardEvent): void => {
    if (!this.model.isRunning) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.skipTour();
    } else if (ev.key === 'Enter' || ev.key === 'ArrowRight') {
      ev.preventDefault();
      ev.stopPropagation();
      this.nextStep();
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      ev.stopPropagation();
      this.backStep();
    }
  };

  private onTourResize = (): void => {
    if (this.model.isRunning) this.renderStep();
  };

  private renderStep(): void {
    const step = this.model.step;
    const ring = this.ring;
    const card = this.card;
    if (!step || !ring || !card) return;
    const anchor = document.querySelector(step.anchor);
    if (!(anchor instanceof HTMLElement)) {
      // The anchor vanished between the probe and the paint: skip forward.
      this.nextStep();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    ring.style.left = `${rect.left - RING_PAD}px`;
    ring.style.top = `${rect.top - RING_PAD}px`;
    ring.style.width = `${rect.width + RING_PAD * 2}px`;
    ring.style.height = `${rect.height + RING_PAD * 2}px`;

    card.textContent = '';
    card.appendChild(el('h3', 'ed-tour-title', t(step.titleKey as TKey)));
    card.appendChild(el('p', 'ed-tour-body', t(step.bodyKey as TKey)));
    const pos = this.model.position();
    const actions = el('div', 'ed-tour-actions');
    actions.appendChild(
      el(
        'span',
        'ed-tour-count',
        t('editor.tutorial.counter', { current: num(pos.current), total: num(pos.total) }),
      ),
    );
    actions.appendChild(el('span', 'ed-tour-spacer'));
    const back = button(t('editor.tutorial.back'), () => this.backStep(), 'small');
    back.disabled = !this.model.hasBack(anchorVisible);
    const nextLabel = this.model.hasNext(anchorVisible)
      ? t('editor.tutorial.next')
      : t('editor.tutorial.finish');
    const next = button(nextLabel, () => this.nextStep(), 'primary small');
    const skip = button(t('editor.tutorial.skip'), () => this.skipTour(), 'small');
    actions.append(back, next, skip);
    card.appendChild(actions);

    this.positionCard(card, rect);
    next.focus();
  }

  /** Place the callout near the highlighted rect, clamped into the viewport. */
  private positionCard(card: HTMLElement, rect: DOMRect): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    let left = rect.left + rect.width / 2 - cw / 2;
    let top = rect.bottom + CARD_GAP;
    if (rect.height > vh * 0.7 && rect.width > vw * 0.5) {
      // Anchors that cover most of the screen (the stage): center the card.
      left = vw / 2 - cw / 2;
      top = vh / 2 - ch / 2;
    } else if (top + ch > vh - EDGE_PAD) {
      top = rect.top - CARD_GAP - ch;
      if (top < EDGE_PAD) {
        // No room above or below: sit beside the rect instead.
        top = Math.min(Math.max(rect.top, EDGE_PAD), vh - ch - EDGE_PAD);
        left = rect.right + CARD_GAP;
        if (left + cw > vw - EDGE_PAD) left = rect.left - CARD_GAP - cw;
      }
    }
    left = Math.min(Math.max(left, EDGE_PAD), Math.max(EDGE_PAD, vw - cw - EDGE_PAD));
    top = Math.min(Math.max(top, EDGE_PAD), Math.max(EDGE_PAD, vh - ch - EDGE_PAD));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }
}
