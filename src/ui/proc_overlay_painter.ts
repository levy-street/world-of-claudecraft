// Thin painter for the spell-activation proc overlay (the curved proc arcs
// beside the character). The pure state rule lives in proc_overlay_view.ts;
// this routes EVERY per-frame write through the host's elided writers, so an
// unchanged state costs zero DOM work. The overlay element and all themed
// children are built ONCE by the Hud (creation-time markup, not per-frame).

import type { PainterHostWriters } from './painter_host';
import type { ProcOverlayState } from './proc_overlay_view';

export class ProcOverlayPainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly root: HTMLElement, // #proc-overlay
  ) {}

  private clearDestruction(): void {
    this.writers.toggleClass(this.root, 'destruction', false);
    this.writers.toggleClass(this.root, 'r1', false);
    this.writers.toggleClass(this.root, 'r2', false);
    this.writers.toggleClass(this.root, 'r3', false);
    this.writers.toggleClass(this.root, 'r4', false);
    this.writers.toggleClass(this.root, 'r5', false);
  }

  paint(state: ProcOverlayState, combustion = false): void {
    this.writers.setAttr(this.root, 'aria-hidden', 'true');
    this.writers.setAttr(this.root, 'tabindex', '-1');
    // Fire path: clear any Chronomancy theme/charge classes so a spec swap never
    // leaves the violet bird behind (all writes elided when unchanged).
    this.writers.toggleClass(this.root, 'chrono', false);
    this.writers.toggleClass(this.root, 'c1', false);
    this.writers.toggleClass(this.root, 'c2', false);
    this.writers.toggleClass(this.root, 'c3', false);
    this.writers.toggleClass(this.root, 'c4', false);
    this.writers.toggleClass(this.root, 'frost', false);
    this.writers.toggleClass(this.root, 'f1', false);
    this.writers.toggleClass(this.root, 'f2', false);
    this.writers.toggleClass(this.root, 'f3', false);
    this.writers.toggleClass(this.root, 'f4', false);
    this.writers.toggleClass(this.root, 'f5', false);
    this.writers.toggleClass(this.root, 'necromancy', false);
    this.writers.toggleClass(this.root, 'n1', false);
    this.writers.toggleClass(this.root, 'n2', false);
    this.writers.toggleClass(this.root, 'n3', false);
    this.writers.toggleClass(this.root, 'n4', false);
    this.writers.toggleClass(this.root, 'n5', false);
    this.clearDestruction();
    this.writers.toggleClass(this.root, 'combustion', combustion);
    this.writers.toggleClass(this.root, 'combustion-enter', combustion);
    this.writers.toggleClass(this.root, 'heating', state === 'heating');
    this.writers.toggleClass(this.root, 'hot', state === 'hot');
  }

  // Chronomancy variant: light one quarter of the arcane-violet bird per held
  // Aether Surge charge (n = 0..4); n === 4 whitens the core and beats the wings
  // like the fire streak; n === 0 (Aether Darts spent them) fades it out.
  paintChronoCharges(n: number): void {
    this.writers.setAttr(this.root, 'aria-hidden', 'true');
    this.writers.setAttr(this.root, 'tabindex', '-1');
    this.writers.toggleClass(this.root, 'heating', false);
    this.writers.toggleClass(this.root, 'hot', false);
    this.writers.toggleClass(this.root, 'combustion', false);
    this.writers.toggleClass(this.root, 'combustion-enter', false);
    this.writers.toggleClass(this.root, 'frost', false);
    this.writers.toggleClass(this.root, 'f1', false);
    this.writers.toggleClass(this.root, 'f2', false);
    this.writers.toggleClass(this.root, 'f3', false);
    this.writers.toggleClass(this.root, 'f4', false);
    this.writers.toggleClass(this.root, 'f5', false);
    this.writers.toggleClass(this.root, 'necromancy', false);
    this.writers.toggleClass(this.root, 'n1', false);
    this.writers.toggleClass(this.root, 'n2', false);
    this.writers.toggleClass(this.root, 'n3', false);
    this.writers.toggleClass(this.root, 'n4', false);
    this.writers.toggleClass(this.root, 'n5', false);
    this.clearDestruction();
    this.writers.toggleClass(this.root, 'chrono', true);
    this.writers.toggleClass(this.root, 'c1', n >= 1);
    this.writers.toggleClass(this.root, 'c2', n >= 2);
    this.writers.toggleClass(this.root, 'c3', n >= 3);
    this.writers.toggleClass(this.root, 'c4', n >= 4);
  }

  // Frost variant: the two tail feathers, left wing, right wing, and body form
  // over stacks one to four. The fifth Icicle overlays the crystalline ready
  // flare, making Glacial Spike readiness unmistakable without a number label.
  paintFrostCharges(n: number): void {
    this.writers.setAttr(this.root, 'aria-hidden', 'true');
    this.writers.setAttr(this.root, 'tabindex', '-1');
    this.writers.toggleClass(this.root, 'heating', false);
    this.writers.toggleClass(this.root, 'hot', false);
    this.writers.toggleClass(this.root, 'combustion', false);
    this.writers.toggleClass(this.root, 'combustion-enter', false);
    this.writers.toggleClass(this.root, 'chrono', false);
    this.writers.toggleClass(this.root, 'c1', false);
    this.writers.toggleClass(this.root, 'c2', false);
    this.writers.toggleClass(this.root, 'c3', false);
    this.writers.toggleClass(this.root, 'c4', false);
    this.writers.toggleClass(this.root, 'necromancy', false);
    this.writers.toggleClass(this.root, 'n1', false);
    this.writers.toggleClass(this.root, 'n2', false);
    this.writers.toggleClass(this.root, 'n3', false);
    this.writers.toggleClass(this.root, 'n4', false);
    this.writers.toggleClass(this.root, 'n5', false);
    this.clearDestruction();
    this.writers.toggleClass(this.root, 'frost', true);
    this.writers.toggleClass(this.root, 'f1', n >= 1);
    this.writers.toggleClass(this.root, 'f2', n >= 2);
    this.writers.toggleClass(this.root, 'f3', n >= 3);
    this.writers.toggleClass(this.root, 'f4', n >= 4);
    this.writers.toggleClass(this.root, 'f5', n >= 5);
  }

  // Necromancy variant: keep the empty bank visible as a dim placement guide,
  // then light one violet crystal per held Soul Fragment. `status` is the live
  // "N of max" valuetext (see paintDestructionMarks below); `label` is the
  // stable meter name and stays on aria-label only, never duplicated onto
  // aria-valuetext (that masked aria-valuenow for screen-reader users).
  paintNecromancyCharges(n: number, label: string, status: string): void {
    this.writers.setAttr(this.root, 'aria-hidden', 'false');
    this.writers.setAttr(this.root, 'tabindex', '0');
    this.writers.setAttr(this.root, 'aria-valuenow', String(n));
    this.writers.setAttr(this.root, 'aria-valuetext', status);
    this.writers.setAttr(this.root, 'aria-label', label);
    this.writers.toggleClass(this.root, 'heating', false);
    this.writers.toggleClass(this.root, 'hot', false);
    this.writers.toggleClass(this.root, 'combustion', false);
    this.writers.toggleClass(this.root, 'combustion-enter', false);
    this.writers.toggleClass(this.root, 'chrono', false);
    this.writers.toggleClass(this.root, 'c1', false);
    this.writers.toggleClass(this.root, 'c2', false);
    this.writers.toggleClass(this.root, 'c3', false);
    this.writers.toggleClass(this.root, 'c4', false);
    this.writers.toggleClass(this.root, 'frost', false);
    this.writers.toggleClass(this.root, 'f1', false);
    this.writers.toggleClass(this.root, 'f2', false);
    this.writers.toggleClass(this.root, 'f3', false);
    this.writers.toggleClass(this.root, 'f4', false);
    this.writers.toggleClass(this.root, 'f5', false);
    this.clearDestruction();
    this.writers.toggleClass(this.root, 'necromancy', true);
    this.writers.toggleClass(this.root, 'n1', n >= 1);
    this.writers.toggleClass(this.root, 'n2', n >= 2);
    this.writers.toggleClass(this.root, 'n3', n >= 3);
    this.writers.toggleClass(this.root, 'n4', n >= 4);
    this.writers.toggleClass(this.root, 'n5', n >= 5);
  }

  // Destruction variant: five forged marks stay visible as an empty ritual
  // bank, then ignite one at a time as the caster gathers Ruin.
  paintDestructionMarks(n: number, label: string, status: string): void {
    this.writers.setAttr(this.root, 'aria-hidden', 'false');
    this.writers.setAttr(this.root, 'tabindex', '0');
    this.writers.setAttr(this.root, 'aria-valuenow', String(n));
    this.writers.setAttr(this.root, 'aria-valuetext', status);
    this.writers.setAttr(this.root, 'aria-label', label);
    this.writers.toggleClass(this.root, 'heating', false);
    this.writers.toggleClass(this.root, 'hot', false);
    this.writers.toggleClass(this.root, 'combustion', false);
    this.writers.toggleClass(this.root, 'combustion-enter', false);
    this.writers.toggleClass(this.root, 'chrono', false);
    this.writers.toggleClass(this.root, 'c1', false);
    this.writers.toggleClass(this.root, 'c2', false);
    this.writers.toggleClass(this.root, 'c3', false);
    this.writers.toggleClass(this.root, 'c4', false);
    this.writers.toggleClass(this.root, 'frost', false);
    this.writers.toggleClass(this.root, 'f1', false);
    this.writers.toggleClass(this.root, 'f2', false);
    this.writers.toggleClass(this.root, 'f3', false);
    this.writers.toggleClass(this.root, 'f4', false);
    this.writers.toggleClass(this.root, 'f5', false);
    this.writers.toggleClass(this.root, 'necromancy', false);
    this.writers.toggleClass(this.root, 'n1', false);
    this.writers.toggleClass(this.root, 'n2', false);
    this.writers.toggleClass(this.root, 'n3', false);
    this.writers.toggleClass(this.root, 'n4', false);
    this.writers.toggleClass(this.root, 'n5', false);
    this.writers.toggleClass(this.root, 'destruction', true);
    this.writers.toggleClass(this.root, 'r1', n >= 1);
    this.writers.toggleClass(this.root, 'r2', n >= 2);
    this.writers.toggleClass(this.root, 'r3', n >= 3);
    this.writers.toggleClass(this.root, 'r4', n >= 4);
    this.writers.toggleClass(this.root, 'r5', n >= 5);
  }
}
