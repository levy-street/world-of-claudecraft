import {
  worldQuestConfectionFxProfile,
  worldQuestConfectionSparkPath,
} from './world_quest_confection_fx_view';
import type { WorldQuestConfectionMove } from './world_quest_confection_view';

const MAX_EFFECTS = 120;

/** Finite, decorative sugar magic over the already-confirmed board. */
export class WorldQuestConfectionFxController {
  private layer: HTMLElement | null = null;
  private cells: readonly HTMLButtonElement[] = [];
  private effects = new Map<HTMLElement, Animation>();
  private media: MediaQueryList | null = null;
  private observer: MutationObserver | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly document: Document,
  ) {}

  bind(frame: HTMLElement, grid: HTMLElement, cells: readonly HTMLButtonElement[]): void {
    this.dispose();
    if (!frame.contains(grid)) return;
    this.cells = cells;
    this.layer = this.document.createElement('div');
    this.layer.className = 'wqm-fx-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    grid.appendChild(this.layer);
    this.media =
      this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    this.media?.addEventListener('change', this.onMotionChange);
    const Observer = this.document.defaultView?.MutationObserver;
    if (Observer) {
      this.observer = new Observer(this.onMotionChange);
      this.observer.observe(this.document.body, { attributes: true, attributeFilter: ['class'] });
      this.observer.observe(this.document.documentElement, {
        attributes: true,
        attributeFilter: ['data-fx-level'],
      });
    }
  }

  playMove(move: WorldQuestConfectionMove, columns: number): void {
    this.cancel();
    if (!this.motionAllowed() || !Number.isInteger(columns) || columns < 1) return;
    const rows = Math.ceil(this.cells.length / columns);
    const point = (index: number): [number, number] => [
      ((index % columns) + 0.5) * (100 / columns),
      (Math.floor(index / columns) + 0.5) * (100 / rows),
    ];
    const swap = move.trace.stages[0];
    if (swap?.kind === 'swap') {
      for (const [from, to] of [
        [swap.fromIndex, swap.toIndex],
        [swap.toIndex, swap.fromIndex],
      ]) {
        if (!this.cells[from] || !this.cells[to]) continue;
        const start = point(from);
        const end = point(to);
        const dx = Math.sign(end[0] - start[0]) * 44;
        const dy = Math.sign(end[1] - start[1]) * 44;
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        this.effect(
          'wqm-effect-trail',
          [
            { opacity: 0, transform: `translate(-50%, -50%) rotate(${angle}deg) scale(0.2)` },
            {
              opacity: 0.9,
              offset: 0.2,
              transform: `translate(calc(-50% + ${dx * 0.16 - dy * 0.1}px), calc(-50% + ${dy * 0.16 + dx * 0.1}px)) rotate(${angle - 15}deg) scale(0.8, 0.6)`,
            },
            {
              opacity: 1,
              offset: 0.55,
              transform: `translate(calc(-50% + ${dx * 0.62 - dy * 0.16}px), calc(-50% + ${dy * 0.62 + dx * 0.16}px)) rotate(${angle}deg) scale(1.15, 0.7)`,
            },
            {
              opacity: 0,
              transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${angle + 12}deg) scale(0.15)`,
            },
          ],
          320,
          0,
          ...start,
        );
      }
    }
    const cleared = new Set<number>();
    const settled = new Set<number>();
    for (const stage of move.trace.stages) {
      if (stage.kind !== 'cascade') continue;
      for (const index of stage.matchedIndices) if (this.cells[index]) cleared.add(index);
      for (const fall of stage.falls) if (this.cells[fall.toIndex]) settled.add(fall.toIndex);
      for (const refill of stage.refills) if (this.cells[refill.index]) settled.add(refill.index);
    }
    // Intensity follows all resolved clears, even when cascades revisit the same cells.
    const profile = worldQuestConfectionFxProfile(move.trace.result.cleared);
    const clearedCells = [...cleared];
    const sparkCount = Math.min(
      clearedCells.length > 0 ? profile.sparksPerCell * move.trace.result.cleared : 0,
      profile.sparkBudget,
      MAX_EFFECTS - 2 - clearedCells.length - 10 - profile.rings - profile.rays,
    );
    for (let order = 0; order < clearedCells.length; order++) {
      const [x, y] = point(clearedCells[order]);
      this.effect(
        'wqm-effect-burst',
        [
          { opacity: 0, transform: 'translate(-50%, -50%) scale(0.12) rotate(-10deg)' },
          {
            opacity: 0.95,
            offset: 0.14,
            transform: 'translate(-50%, -50%) scale(0.75) rotate(0deg)',
          },
          {
            opacity: 0.45,
            offset: 0.5,
            transform: `translate(-50%, -50%) scale(${profile.burstScale * 0.7}) rotate(12deg)`,
          },
          {
            opacity: 0,
            transform: `translate(-50%, -50%) scale(${profile.burstScale}) rotate(24deg)`,
          },
        ],
        560,
        80 + (order % 4) * 28,
        x,
        y,
      );
    }
    for (let spark = 0; spark < sparkCount; spark++) {
      const order = spark % clearedCells.length;
      const index = clearedCells[order];
      const [x, y] = point(index);
      const angle =
        ((Math.floor(spark / clearedCells.length) / Math.ceil(sparkCount / clearedCells.length)) *
          2 +
          index * 0.17) *
        Math.PI;
      this.spark(
        x,
        y,
        Math.cos(angle) * profile.sparkDistance,
        Math.sin(angle) * (profile.sparkDistance - 4) - 12,
        profile.sparkDuration,
        100 + (order % 4) * 24 + (Math.floor(spark / clearedCells.length) % 3) * 10,
        index + spark,
        false,
        profile.sparkSize,
      );
    }
    if (clearedCells.length > 0) {
      const center = clearedCells.reduce(
        (sum, index) => {
          const [x, y] = point(index);
          return [sum[0] + x / clearedCells.length, sum[1] + y / clearedCells.length];
        },
        [0, 0],
      );
      for (let ring = 0; ring < profile.rings; ring++)
        this.effect(
          'wqm-match-ring',
          [
            { opacity: 0, transform: 'translate(-50%, -50%) scale(0.12) rotate(-12deg)' },
            {
              opacity: 0.8,
              offset: 0.2,
              transform: 'translate(-50%, -50%) scale(0.75) rotate(0deg)',
            },
            {
              opacity: 0.32,
              offset: 0.6,
              transform: 'translate(-50%, -50%) scale(1.25) rotate(14deg)',
            },
            { opacity: 0, transform: 'translate(-50%, -50%) scale(1.6) rotate(22deg)' },
          ],
          940,
          100 + ring * 160,
          center[0],
          center[1],
        );
      for (let ray = 0; ray < profile.rays; ray++) {
        const angle = (ray / profile.rays) * 360;
        this.effect(
          'wqm-match-ray',
          [
            { opacity: 0, transform: `translate(-50%, -100%) rotate(${angle}deg) scaleY(0.15)` },
            {
              opacity: 0.7,
              offset: 0.22,
              transform: `translate(-50%, -100%) rotate(${angle + 4}deg) scaleY(0.9)`,
            },
            {
              opacity: 0.25,
              offset: 0.58,
              transform: `translate(-50%, -100%) rotate(${angle + 9}deg) scaleY(1.12)`,
            },
            {
              opacity: 0,
              transform: `translate(-50%, -100%) rotate(${angle + 12}deg) scaleY(1.2)`,
            },
          ],
          900,
          160 + (ray % 3) * 50,
          center[0],
          center[1],
        );
      }
    }
    for (const index of [...settled].slice(0, 10)) {
      const [x, y] = point(index);
      this.effect(
        'wqm-effect-settle',
        [
          { opacity: 0, transform: 'translate(-50%, -100%) scale(0.15) rotate(-30deg)' },
          { opacity: 0.9, offset: 0.3, transform: 'translate(-50%, -55%) scale(0.9) rotate(0deg)' },
          {
            opacity: 0.55,
            offset: 0.62,
            transform: 'translate(-50%, -50%) scale(1.1) rotate(25deg)',
          },
          { opacity: 0, transform: 'translate(-50%, -58%) scale(0.3) rotate(48deg)' },
        ],
        380,
        420 + (index % 4) * 35,
        x,
        y,
      );
    }
  }

  playOutcome(outcome: 'won' | 'lost'): void {
    this.cancel();
    if (!this.motionAllowed()) return;
    if (outcome === 'won') this.victory();
    else this.loss();
  }

  cancel(): void {
    for (const [element, animation] of this.effects) {
      animation.onfinish = null;
      animation.oncancel = null;
      animation.cancel();
      element.remove();
    }
    this.effects.clear();
  }

  dispose(): void {
    this.cancel();
    this.media?.removeEventListener('change', this.onMotionChange);
    this.media = null;
    this.observer?.disconnect();
    this.observer = null;
    this.layer?.remove();
    this.layer = null;
    this.cells = [];
  }

  private victory(): void {
    for (let wave = 0; wave < 2; wave++)
      this.effect(
        'wqm-outcome-wave',
        [
          { opacity: 0, transform: 'translate(-50%, 65%) scaleY(0.2)' },
          { opacity: 0.55, offset: 0.32, transform: 'translate(-50%, -40%) scaleY(0.65)' },
          { opacity: 0.2, offset: 0.65, transform: 'translate(-50%, -100%) scaleY(0.9)' },
          { opacity: 0, transform: 'translate(-50%, -140%) scaleY(1)' },
        ],
        1700,
        80 + wave * 2200,
      );
    for (let ring = 0; ring < 3; ring++)
      this.effect(
        'wqm-outcome-ring',
        [
          { opacity: 0, transform: 'translate(-50%, -50%) scale(0.15) rotate(-10deg)' },
          { opacity: 0.8, offset: 0.2, transform: 'translate(-50%, -50%) scale(0.8) rotate(0deg)' },
          {
            opacity: 0.35,
            offset: 0.56,
            transform: 'translate(-50%, -50%) scale(1.03) rotate(12deg)',
          },
          { opacity: 0, transform: 'translate(-50%, -50%) scale(1.15) rotate(25deg)' },
        ],
        2000,
        ring * 1200,
      );
    for (let ray = 0; ray < 18; ray++) {
      const angle = ray * 20;
      this.effect(
        'wqm-outcome-ray',
        [
          { opacity: 0, transform: `translate(-50%, -100%) rotate(${angle}deg) scaleY(0.15)` },
          {
            opacity: 0.5,
            offset: 0.1,
            transform: `translate(-50%, -100%) rotate(${angle + 3}deg) scaleY(0.85)`,
          },
          {
            opacity: 0.3,
            offset: 0.65,
            transform: `translate(-50%, -100%) rotate(${angle + 8}deg) scaleY(1)`,
          },
          { opacity: 0, transform: `translate(-50%, -100%) rotate(${angle + 12}deg) scaleY(1.1)` },
        ],
        4000,
        (ray % 3) * 90,
      );
    }
    for (let spark = 0; spark < 48; spark++) {
      const angle = ((spark * 137.5) / 180) * Math.PI;
      const distance = 70 + ((spark * 29) % 140);
      this.spark(
        22 + ((spark * 17) % 57),
        68 + ((spark * 11) % 24),
        Math.cos(angle) * distance,
        -100 - ((spark * 31) % 160),
        1900,
        Math.floor(spark / 16) * 1650 + (spark % 6) * 65,
        spark,
        true,
      );
    }
    for (let foil = 0; foil < 24; foil++)
      this.effect(
        'wqm-victory-confetti',
        [
          { opacity: 0, transform: 'translate(-50%, -50%) rotate(0deg) scale(0.6)' },
          {
            opacity: 0.85,
            offset: 0.12,
            transform: `translate(calc(-50% + ${(foil % 3) * 12 - 12}px), calc(-50% + 16px)) rotate(55deg) scale(1)`,
          },
          {
            opacity: 0.78,
            offset: 0.38,
            transform: `translate(calc(-50% + ${(foil % 2 === 0 ? 1 : -1) * 28}px), calc(-50% + 54px)) rotate(110deg) scaleX(0.18)`,
          },
          {
            opacity: 0.6,
            offset: 0.68,
            transform: `translate(calc(-50% + ${(foil % 2 === 0 ? -1 : 1) * 18}px), calc(-50% + 112px)) rotate(185deg) scaleX(-0.65)`,
          },
          {
            opacity: 0,
            transform: `translate(calc(-50% + ${(foil % 3) * 20 - 20}px), calc(-50% + 190px)) rotate(265deg) scale(0.5)`,
          },
        ],
        2400,
        2000 + (foil % 6) * 160,
        8 + ((foil * 29) % 84),
        5 + ((foil * 17) % 24),
      );
    for (let glint = 0; glint < 18; glint++)
      this.effect(
        'wqm-spark wqm-spark-gold',
        [
          { opacity: 0, transform: 'translate(-50%, -50%) scale(0.1) rotate(0deg)' },
          {
            opacity: 0.95,
            offset: 0.24,
            transform: 'translate(-50%, -50%) scale(1) rotate(30deg)',
          },
          {
            opacity: 0.5,
            offset: 0.55,
            transform: 'translate(-50%, -56%) scale(0.7) rotate(60deg)',
          },
          { opacity: 0, transform: 'translate(-50%, -70%) scale(0.1) rotate(90deg)' },
        ],
        900,
        3000 + (glint % 8) * 220,
        5 + ((glint * 31) % 90),
        4 + ((glint * 19) % 92),
        10 + (glint % 3) * 3,
      );
  }

  private loss(): void {
    this.effect(
      'wqm-outcome-veil',
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1.08)' },
        { opacity: 0.4, offset: 0.18, transform: 'translate(-50%, -50%) scale(1)' },
        { opacity: 0.2, offset: 0.58, transform: 'translate(-50%, -48%) scale(0.94)' },
        { opacity: 0, transform: 'translate(-50%, -46%) scale(0.9)' },
      ],
      1400,
      0,
    );
    for (let ember = 0; ember < 18; ember++)
      this.effect(
        'wqm-outcome-ember',
        [
          { opacity: 0, transform: 'translate(-50%, -50%) scale(0.2) rotate(0deg)' },
          {
            opacity: 0.75,
            offset: 0.16,
            transform: `translate(calc(-50% + ${(ember % 2 === 0 ? 1 : -1) * 5}px), calc(-50% - 5px)) scale(0.85) rotate(24deg)`,
          },
          {
            opacity: 0.38,
            offset: 0.56,
            transform: `translate(calc(-50% + ${(ember % 2 === 0 ? -1 : 1) * 10}px), calc(-50% + 12px)) scale(0.55) rotate(60deg)`,
          },
          {
            opacity: 0,
            transform: `translate(calc(-50% + ${(ember % 3) * 6 - 6}px), calc(-50% + 38px)) scale(0.08) rotate(95deg)`,
          },
        ],
        1000,
        (ember % 5) * 70,
        12 + ((ember * 23) % 76),
        10 + ((ember * 37) % 75),
      );
  }

  private spark(
    x: number,
    y: number,
    dx: number,
    dy: number,
    duration: number,
    delay: number,
    index: number,
    fountain = false,
    baseSize = fountain ? 10 : 7,
  ): void {
    this.effect(
      `wqm-spark ${index % 4 === 0 ? 'wqm-spark-mint' : 'wqm-spark-gold'}`,
      worldQuestConfectionSparkPath(dx, dy, index, fountain).map((point) => ({
        offset: point.offset,
        opacity: point.opacity,
        transform: `translate(calc(-50% + ${point.x}px), calc(-50% + ${point.y}px)) scale(${point.scale}) rotate(${point.rotation}deg)`,
      })),
      duration,
      delay,
      x,
      y,
      baseSize + (index % 4) * 2,
      'linear',
    );
  }

  private effect(
    kind: string,
    frames: Keyframe[],
    duration: number,
    delay: number,
    x = 50,
    y = 50,
    size?: number,
    easing = 'cubic-bezier(0.2, 0.75, 0.3, 1)',
  ): void {
    if (!this.layer || this.effects.size >= MAX_EFFECTS || typeof this.layer.animate !== 'function')
      return;
    const element = this.document.createElement('span');
    element.className = `wqm-effect ${kind}`;
    element.setAttribute('aria-hidden', 'true');
    element.style.left = `${x}%`;
    element.style.top = `${y}%`;
    if (size !== undefined) element.style.setProperty('--wqm-spark-size', `${size}px`);
    this.layer.appendChild(element);
    let animation: Animation;
    try {
      animation = element.animate(frames, { duration, delay, easing, fill: 'both' });
    } catch {
      element.remove();
      return;
    }
    this.effects.set(element, animation);
    const clean = () => {
      animation.onfinish = null;
      animation.oncancel = null;
      this.effects.delete(element);
      element.remove();
      animation.cancel();
    };
    animation.onfinish = clean;
    animation.oncancel = clean;
  }

  private readonly onMotionChange = (): void => {
    if (!this.motionAllowed()) this.cancel();
  };

  private motionAllowed(): boolean {
    return (
      !!this.layer &&
      this.root.isConnected &&
      !this.media?.matches &&
      !this.document.body.classList.contains('reduce-motion') &&
      this.document.documentElement.dataset.fxLevel !== 'low'
    );
  }
}
