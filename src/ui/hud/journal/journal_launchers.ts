// The Adventure Journal's launchers, bound once at HUD construction: the side
// rail's micro button and the mobile More tray's button toggle the journal; the
// small book beside the target frame (shown by Hud's per-frame `has-journal`
// class while the target has a page) opens straight on the target's page. The
// book sits inside the target frame, whose own pointer gestures (the context
// menu, the double tap, the long press) must never see a press on it.

import type { Entity } from '../../../sim/types';

export interface JournalLauncherTarget {
  toggle(): void;
  openForMob(mobId: string): boolean;
}

export interface JournalLauncherWorld {
  readonly player: { readonly targetId: number | null };
  readonly entities: { get(id: number): Pick<Entity, 'templateId'> | undefined };
}

export function bindJournalLaunchers(
  doc: Pick<Document, 'getElementById'>,
  journal: JournalLauncherTarget,
  world: () => JournalLauncherWorld,
): void {
  for (const id of ['mm-journal', 'mobile-journal']) {
    doc.getElementById(id)?.addEventListener('click', () => journal.toggle());
  }
  const book = doc.getElementById('tf-journal');
  if (!book) return;
  for (const type of ['pointerdown', 'mousedown', 'touchstart', 'contextmenu', 'dblclick']) {
    book.addEventListener(type, (event) => event.stopPropagation());
  }
  book.addEventListener('click', (event) => {
    event.stopPropagation();
    const w = world();
    const targetId = w.player.targetId;
    const target = targetId !== null ? w.entities.get(targetId) : undefined;
    if (target) journal.openForMob(target.templateId);
  });
}
