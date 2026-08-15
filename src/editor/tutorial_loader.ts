// Defers loading the Help modal + first-run tour bundle (tutorial.ts,
// EditorTutorial) until it is actually needed. maybeAutoStart() reuses
// TutorialModel's own should-run check (tutorial_core.ts) to decide whether
// to dynamic-import the module at all: a returning-user session, where the
// seen flag is already set, is the large majority and never pays for it.
// openHelp() always imports it lazily on the user's first Help click. Either
// path caches the loaded instance so later calls resolve without importing
// again.

import type { EditorTutorial } from './tutorial';
import { shouldAutoStart, TUTORIAL_SEEN_KEY, TUTORIAL_SEEN_VALUE } from './tutorial_core';

function seenFlag(): string | null {
  try {
    return localStorage.getItem(TUTORIAL_SEEN_KEY);
  } catch {
    // Blocked storage: report seen, so a broken store never forces a load.
    return TUTORIAL_SEEN_VALUE;
  }
}

export class TutorialLoader {
  private instance: EditorTutorial | null = null;
  private pending: Promise<EditorTutorial> | null = null;

  constructor(private readonly root: HTMLElement) {}

  private load(): Promise<EditorTutorial> {
    if (this.instance) return Promise.resolve(this.instance);
    if (!this.pending) {
      this.pending = import('./tutorial').then(({ EditorTutorial: Ctor }) => {
        const tutorial = new Ctor(this.root);
        this.instance = tutorial;
        return tutorial;
      });
    }
    return this.pending;
  }

  maybeAutoStart(): void {
    if (!shouldAutoStart(seenFlag())) return;
    void this.load().then((tutorial) => tutorial.maybeAutoStart());
  }

  openHelp(): void {
    void this.load().then((tutorial) => tutorial.openHelp());
  }

  dispose(): void {
    this.instance?.dispose();
  }
}
