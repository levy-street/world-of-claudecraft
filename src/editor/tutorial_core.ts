// Pure model for the first-run editor tutorial: the ordered step definitions
// (anchor selectors + i18n key names) and the advance/back/skip state machine
// with the seen-flag policy. No DOM and no i18n imports: the DOM shell
// (tutorial.ts) injects an anchor-visibility probe and a storage adapter, so a
// Vitest drives the whole tour headlessly.

/** localStorage flag: set once the tour completes or is skipped. */
export const TUTORIAL_SEEN_KEY = 'woc_editor_tutorial_seen';
export const TUTORIAL_SEEN_VALUE = '1';

export interface TutorialStepDef {
  id: string;
  /** CSS selector of the UI region this step highlights. */
  anchor: string;
  /** i18n keys (dotted paths into the editor.tutorial.steps catalog). */
  titleKey: string;
  bodyKey: string;
}

export const TUTORIAL_STEPS: readonly TutorialStepDef[] = [
  {
    id: 'toolbar',
    anchor: '.ed-toolbar',
    titleKey: 'editor.tutorial.steps.toolbar.title',
    bodyKey: 'editor.tutorial.steps.toolbar.body',
  },
  {
    id: 'stage',
    anchor: '.ed-stage',
    titleKey: 'editor.tutorial.steps.stage.title',
    bodyKey: 'editor.tutorial.steps.stage.body',
  },
  {
    id: 'inspector',
    anchor: '.ed-inspector',
    titleKey: 'editor.tutorial.steps.inspector.title',
    bodyKey: 'editor.tutorial.steps.inspector.body',
  },
  {
    id: 'viewToggle',
    anchor: '.ed-view-toggle',
    titleKey: 'editor.tutorial.steps.viewToggle.title',
    bodyKey: 'editor.tutorial.steps.viewToggle.body',
  },
  {
    id: 'save',
    anchor: '.ed-actions',
    titleKey: 'editor.tutorial.steps.save.title',
    bodyKey: 'editor.tutorial.steps.save.body',
  },
  {
    id: 'playtest',
    anchor: '.ed-playtest',
    titleKey: 'editor.tutorial.steps.playtest.title',
    bodyKey: 'editor.tutorial.steps.playtest.body',
  },
  {
    id: 'help',
    anchor: '.ed-help',
    titleKey: 'editor.tutorial.steps.help.title',
    bodyKey: 'editor.tutorial.steps.help.body',
  },
];

/** True when an anchor selector resolves to a visible element right now. */
export type AnchorProbe = (selector: string) => boolean;

/** Seen-flag storage seam (localStorage in the app, a stub in tests). */
export interface SeenStore {
  get(): string | null;
  set(value: string): void;
}

export function shouldAutoStart(stored: string | null): boolean {
  return stored !== TUTORIAL_SEEN_VALUE;
}

/**
 * The tour state machine. A step whose anchor probe fails is skipped in the
 * travel direction; running out of steps forward completes the tour. Both
 * completion and skip persist the seen flag, and the tour can always restart
 * afterwards (the "Begin tutorial" button).
 */
export class TutorialModel {
  private idx = -1;
  private running = false;

  constructor(
    private readonly steps: readonly TutorialStepDef[],
    private readonly store: SeenStore,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  get index(): number {
    return this.idx;
  }

  get step(): TutorialStepDef | null {
    return this.running ? (this.steps[this.idx] ?? null) : null;
  }

  /** 1-based step counter over the full step list (for "Step x of y"). */
  position(): { current: number; total: number } {
    return { current: this.idx + 1, total: this.steps.length };
  }

  shouldAutoStart(): boolean {
    return shouldAutoStart(this.store.get());
  }

  /** Begin (or restart) the tour; false when no step has a visible anchor. */
  start(anchorOk: AnchorProbe): boolean {
    const first = this.seek(0, 1, anchorOk);
    if (first < 0) {
      this.finish();
      return false;
    }
    this.running = true;
    this.idx = first;
    return true;
  }

  /** Advance past missing anchors; past the last step the tour completes. */
  next(anchorOk: AnchorProbe): void {
    if (!this.running) return;
    const to = this.seek(this.idx + 1, 1, anchorOk);
    if (to < 0) this.finish();
    else this.idx = to;
  }

  /** Step back past missing anchors; on the first visible step it stays put. */
  back(anchorOk: AnchorProbe): void {
    if (!this.running) return;
    const to = this.seek(this.idx - 1, -1, anchorOk);
    if (to >= 0) this.idx = to;
  }

  hasBack(anchorOk: AnchorProbe): boolean {
    return this.running && this.seek(this.idx - 1, -1, anchorOk) >= 0;
  }

  hasNext(anchorOk: AnchorProbe): boolean {
    return this.running && this.seek(this.idx + 1, 1, anchorOk) >= 0;
  }

  /** Skip is always available and marks the tour seen. */
  skip(): void {
    this.finish();
  }

  private seek(from: number, dir: 1 | -1, anchorOk: AnchorProbe): number {
    for (let i = from; i >= 0 && i < this.steps.length; i += dir) {
      if (anchorOk(this.steps[i].anchor)) return i;
    }
    return -1;
  }

  private finish(): void {
    this.running = false;
    this.idx = -1;
    this.store.set(TUTORIAL_SEEN_VALUE);
  }
}
