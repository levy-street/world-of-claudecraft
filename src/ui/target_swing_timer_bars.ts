// Owns both the target and target-of-target swing-timer bars (#swingbar-target
// and #swingbar-tot) as one small binding, mirroring src/ui/swing_timer_bars.ts's
// shape: resolves their DOM refs once, holds two independent edge-tracking
// clocks, and drives two SwingTimerPainter instances (the same class, reused a
// third and fourth time) from a single per-frame update() call.
//
// Resolves the target-of-target ENTITY itself via targetOfTargetId(), fully
// INDEPENDENT of the existing showTargetOfTarget mini-frame toggle: this
// module's own `enabled` flag (the new showTargetSwingTimer setting) is the
// only gate, so a player can see the tot swing bar without the tot portrait
// mini-frame, and vice versa.

import type { Entity } from '../sim/types';
import type { PainterHostWriters } from './painter_host';
import { type TargetSwingInput, targetSwingTimerState } from './swing_timer';
import { SwingTimerPainter } from './swing_timer_painter';
import { targetOfTargetId } from './target_of_target';

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

/** The entity lookup this module resolves the target-of-target through. A
 *  Map<number, Entity> (sim.entities on both the offline Sim and the online
 *  ClientWorld mirror) satisfies this structurally. */
export interface TargetSwingEntities {
  get(id: number): TargetSwingInput | undefined;
}

/** The target fields targetOfTargetId needs, plus the swing fields the target's
 *  OWN bar reads. A structural subset of Entity. `kind` stays TargetSwingInput's
 *  wider `string` (not narrowed to EntityKind) so plain test literals and the
 *  wire-mirrored ClientWorld entity both satisfy it structurally; the
 *  targetOfTargetId call below narrows it back for that one call. */
export type TargetSwingSourceInput = TargetSwingInput & {
  id: number;
  targetId: number | null;
  aggroTargetId: number | null;
};

export class TargetSwingTimerBars {
  private readonly targetPainter: SwingTimerPainter;
  private readonly totPainter: SwingTimerPainter;
  private targetPeriod = 0;
  private lastTargetTimer = 0;
  private currentTargetId: number | null = null;
  private totPeriod = 0;
  private lastTotTimer = 0;
  private currentTotId: number | null = null;

  constructor(writers: PainterHostWriters) {
    this.targetPainter = barPainter(writers, '#swingbar-target');
    this.totPainter = barPainter(writers, '#swingbar-tot');
  }

  update(
    target: TargetSwingSourceInput | null,
    entities: TargetSwingEntities,
    enabled: boolean,
  ): void {
    const targetId = enabled && target ? target.id : null;
    if (targetId !== this.currentTargetId) {
      this.targetPeriod = 0;
      this.lastTargetTimer = 0;
      this.currentTargetId = targetId;
    }
    const targetInput = enabled ? target : null;
    const targetSwing = targetSwingTimerState(targetInput, this.targetPeriod, this.lastTargetTimer);
    this.targetPeriod = targetSwing.nextPeriod;
    this.lastTargetTimer = targetSwing.nextTimer;
    this.targetPainter.paint(targetSwing);

    const totId =
      enabled && target
        ? targetOfTargetId(target as Pick<Entity, 'kind' | 'targetId' | 'aggroTargetId'>)
        : null;
    if (totId !== this.currentTotId) {
      this.totPeriod = 0;
      this.lastTotTimer = 0;
      this.currentTotId = totId;
    }
    const tot = totId !== null ? (entities.get(totId) ?? null) : null;
    const totSwing = targetSwingTimerState(tot, this.totPeriod, this.lastTotTimer);
    this.totPeriod = totSwing.nextPeriod;
    this.lastTotTimer = totSwing.nextTimer;
    this.totPainter.paint(totSwing);
  }
}
