// Owns both swing-timer bars (main-hand #swingbar and the off-hand
// #swingbar-offhand, for dual-wield melee weaving) as one small binding:
// resolves their DOM refs once, holds the two independent edge-tracking
// clocks, and drives both SwingTimerPainter instances from a single per-frame
// update() call. Extracted out of hud.ts (the monolith ratchet: root
// CLAUDE.md, "never GROW one") so the coordinator carries one call instead of
// a field-cache + edge-tracking-scalar + painter-instantiation cluster per
// bar; nothing here is new behavior, it is the same wiring hud.ts drove
// inline before, for both bars now instead of one.

import type { PainterHostWriters } from './painter_host';
import {
  type OffhandSwingPlayerInput,
  offhandSwingTimerState,
  type SwingPlayerInput,
  type SwingTargetInput,
  swingTimerState,
} from './swing_timer';
import { SwingTimerPainter } from './swing_timer_painter';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

function barPainter(writers: PainterHostWriters, barSelector: string): SwingTimerPainter {
  const bar = $(barSelector);
  return new SwingTimerPainter(
    writers,
    bar,
    bar.querySelector('.fill') as HTMLElement,
    bar.querySelector('.label') as HTMLElement,
  );
}

export class SwingTimerBars {
  private readonly mainPainter: SwingTimerPainter;
  private readonly offhandPainter: SwingTimerPainter;
  private swingPeriod = 0;
  private lastSwingTimer = 0;
  private offhandSwingPeriod = 0;
  private lastOffhandSwingTimer = 0;

  constructor(writers: PainterHostWriters) {
    this.mainPainter = barPainter(writers, '#swingbar');
    this.offhandPainter = barPainter(writers, '#swingbar-offhand');
  }

  update(
    player: SwingPlayerInput & OffhandSwingPlayerInput,
    target: SwingTargetInput | null,
  ): void {
    const swing = swingTimerState(player, target, this.swingPeriod, this.lastSwingTimer);
    this.swingPeriod = swing.nextPeriod;
    this.lastSwingTimer = swing.nextTimer;
    this.mainPainter.paint(swing);

    const offhandSwing = offhandSwingTimerState(
      player,
      target,
      this.offhandSwingPeriod,
      this.lastOffhandSwingTimer,
    );
    this.offhandSwingPeriod = offhandSwing.nextPeriod;
    this.lastOffhandSwingTimer = offhandSwing.nextTimer;
    this.offhandPainter.paint(offhandSwing);
  }
}
