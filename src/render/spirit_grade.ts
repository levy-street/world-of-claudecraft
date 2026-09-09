// The thin consumer of spirit_grade_core.ts: pushes the eased ghost grade into
// the post chain's output grade pass, and decides which of the two arms paints
// it at all.
//
// Composer and grade-only tiers (high/ultra and medium) grade every pixel in
// OutputGradePass already, so the spirit drain is one extra mix there and costs
// no compositor surface. The LOW tier has no post chain, so it keeps the CSS
// filter that used to serve every tier; the canvas is stamped
// data-spirit-grade="css" for it and base.css arms the rule on that stamp
// alone. Exactly one arm is ever live.

import {
  advanceSpiritGrade,
  createSpiritGradeState,
  type SpiritGradeState,
} from './spirit_grade_core';

/** The post chain as this consumer needs it (src/render/post.ts PostPipeline). */
export interface SpiritGradeSink {
  setSpiritGrade(amount: number): void;
}

/** The canvas attribute base.css keys the fallback filter off. */
export const SPIRIT_GRADE_ATTRIBUTE = 'spiritGrade';
export const SPIRIT_GRADE_SHADER = 'shader';
export const SPIRIT_GRADE_CSS = 'css';

export class SpiritGrade {
  private readonly state: SpiritGradeState = createSpiritGradeState();

  constructor(
    canvas: HTMLElement,
    private readonly sink: SpiritGradeSink | null,
    private readonly reducedMotion: () => boolean = () => false,
  ) {
    canvas.dataset[SPIRIT_GRADE_ATTRIBUTE] = sink ? SPIRIT_GRADE_SHADER : SPIRIT_GRADE_CSS;
  }

  /** Advance one frame and publish the amount. Returns it for tests/telemetry. */
  update(dtSec: number, ghost: boolean): number {
    const amount = advanceSpiritGrade(this.state, dtSec, ghost, this.reducedMotion());
    this.sink?.setSpiritGrade(amount);
    return amount;
  }
}
