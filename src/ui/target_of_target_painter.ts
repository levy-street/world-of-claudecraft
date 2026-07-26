// Thin target-of-target adapter over the shared UnitFramePainter family. The
// family owns presence, name, health, danger state, and portrait invalidation;
// this adapter adds only the satellite-specific accent, self/dead hooks, and
// localized interactive name.

import type { PainterHostWriters } from './painter_host';
import type { TargetOfTargetAccent, TargetOfTargetView } from './target_of_target_view';
import { UnitFramePainter } from './unit_frame_painter';

const SHOWN_DISPLAY = 'flex';
const HIDDEN_TAB_INDEX = '-1';
const SHOWN_TAB_INDEX = '0';
const ACCENT_PROPERTY = '--tot-accent';

export interface TargetOfTargetElements {
  frame: HTMLElement;
  name: HTMLElement;
  hpFill: HTMLElement;
}

export interface TargetOfTargetPainterDeps {
  resolveAccent(accent: TargetOfTargetAccent, classId: string): string;
  repaintPortrait(entityId: number): void;
}

export class TargetOfTargetPainter {
  private portraitEntityId: number | null = null;
  private readonly framePainter: UnitFramePainter;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly el: TargetOfTargetElements,
    private readonly deps: TargetOfTargetPainterDeps,
  ) {
    this.framePainter = new UnitFramePainter(
      writers,
      {
        frame: el.frame,
        name: el.name,
        hpFill: el.hpFill,
      },
      {
        shownDisplay: SHOWN_DISPLAY,
        animatedPresence: true,
        healthFeedback: true,
        repaintPortrait: () => {
          if (this.portraitEntityId !== null) this.deps.repaintPortrait(this.portraitEntityId);
        },
      },
    );
  }

  paint(view: TargetOfTargetView): void {
    this.portraitEntityId = view.entityId;
    this.framePainter.paint(view.frame);
    this.writers.toggleClass(this.el.frame, 'is-self', view.isSelf);
    this.writers.toggleClass(this.el.frame, 'is-dead', view.frame.dead);
    if (!view.frame.present) {
      this.writers.setAttr(this.el.frame, 'tabindex', HIDDEN_TAB_INDEX);
      return;
    }
    this.writers.setStyleProp(
      this.el.frame,
      ACCENT_PROPERTY,
      this.deps.resolveAccent(view.accent, view.classId),
    );
    this.writers.setAttr(this.el.frame, 'aria-label', view.accessibleLabel);
    this.writers.setAttr(this.el.frame, 'title', view.accessibleLabel);
    this.writers.setAttr(this.el.frame, 'tabindex', SHOWN_TAB_INDEX);
  }

  invalidatePortrait(): void {
    this.framePainter.invalidatePortrait();
  }
}
