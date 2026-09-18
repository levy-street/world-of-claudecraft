// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { WorldQuestConfectionFxController } from '../src/ui/world_quest_confection_fx_controller';
import {
  prepareWorldQuestConfectionMove,
  type WorldQuestConfectionMove,
} from '../src/ui/world_quest_confection_view';

const quest = WORLD_QUESTS_BY_ID.wq_palmreach_confections;
if (quest.objective.type !== 'match3') throw new Error('Expected match-three fixture');
const move = prepareWorldQuestConfectionMove(
  quest.id,
  {
    questId: quest.id,
    state: 'active',
    count: 0,
    puzzleVariant: 0,
    match3Board: [...quest.objective.levels[0].board],
    match3Moves: 0,
    match3RefillIndex: 0,
  },
  2,
  3,
)!;

interface RecordedAnimation {
  element: Element;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
}

function translatedPoints(frames: Keyframe[]): Array<{ x: number; y: number }> {
  return frames.map((frame) => {
    const match = String(frame.transform).match(
      /translate\(calc\(-50% \+ ([^)]+)px\), calc\(-50% \+ ([^)]+)px\)\)/,
    );
    if (!match) throw new Error(`Expected a centered numeric trajectory: ${frame.transform}`);
    const point = { x: Number(match[1]), y: Number(match[2]) };
    expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    return point;
  });
}

function clearReceipt(total: number, cells = [0, 1, 2]): WorldQuestConfectionMove {
  const cascade = move.trace.stages.find((stage) => stage.kind === 'cascade');
  if (!cascade) throw new Error('Expected a resolved cascade');
  return {
    ...move,
    trace: {
      ...move.trace,
      result: { ...move.trace.result, cleared: total },
      stages: [
        move.trace.stages[0],
        ...Array.from({ length: Math.ceil(total / cells.length) }, () => ({
          ...cascade,
          matchedIndices: cells,
          falls: [],
          refills: [],
        })),
      ],
    },
  };
}

function setup() {
  const root = document.createElement('section');
  const frame = document.createElement('div');
  const grid = document.createElement('div');
  const cells = Array.from({ length: 36 }, (_, index) => {
    const cell = document.createElement('button');
    cell.textContent = String(index);
    cell.dataset.match3Cell = String(index);
    grid.appendChild(cell);
    return cell;
  });
  frame.appendChild(grid);
  root.appendChild(frame);
  document.body.appendChild(root);
  const fx = new WorldQuestConfectionFxController(root, document);
  fx.bind(frame, grid, cells);
  return { root, frame, grid, cells, fx };
}

describe('Confection sugar magic lifecycle', () => {
  let animations: RecordedAnimation[];
  let media: EventTarget & { matches: boolean };
  let originalAnimate: PropertyDescriptor | undefined;
  let controllers: WorldQuestConfectionFxController[];
  const build = () => {
    const state = setup();
    controllers.push(state.fx);
    return state;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
    document.documentElement.dataset.fxLevel = 'high';
    animations = [];
    controllers = [];
    media = Object.assign(new EventTarget(), { matches: false });
    vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
    originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
        const animation = {
          element: this,
          frames,
          options,
          cancel: vi.fn(),
          onfinish: null,
          oncancel: null,
        };
        animations.push(animation);
        return animation as unknown as Animation;
      },
    });
  });

  afterEach(() => {
    for (const controller of controllers) controller.dispose();
    vi.restoreAllMocks();
    if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
    else Reflect.deleteProperty(Element.prototype, 'animate');
    delete document.documentElement.dataset.fxLevel;
  });

  it('uses only hidden decorations and leaves the current board, focus and hit targets in place', () => {
    const { cells, grid, root, fx } = build();
    cells[2].focus();
    fx.playMove(move, 6);
    expect(root.querySelector('.wqm-effect-trail')).not.toBeNull();
    expect(root.querySelector('.wqm-effect-burst')).not.toBeNull();
    expect(root.querySelector('.wqm-spark')).not.toBeNull();
    expect([...grid.querySelectorAll('button')]).toEqual(cells);
    expect(cells.every((cell, index) => !cell.disabled && cell.textContent === String(index))).toBe(
      true,
    );
    expect(document.activeElement).toBe(cells[2]);
    expect(root.querySelectorAll('.wqm-effect[aria-hidden="true"]')).toHaveLength(
      animations.length,
    );
    expect(
      animations.every(({ element }) => element.parentElement?.className === 'wqm-fx-layer'),
    ).toBe(true);
    expect(animations.every(({ element }) => element.tagName === 'SPAN')).toBe(true);
  });

  it.each(['move', 'won', 'lost'] as const)(
    '%s effects have one finite short lifetime and animate only opacity and transform',
    (event) => {
      const { fx } = build();
      if (event === 'move') fx.playMove(move, 6);
      else fx.playOutcome(event);
      expect(animations.length).toBeGreaterThan(0);
      expect(animations.length).toBeLessThanOrEqual(120);
      for (const { frames, options } of animations) {
        expect(Number(options.duration)).toBeGreaterThan(0);
        expect(Number.isFinite(Number(options.duration))).toBe(true);
        expect(options.delay ?? 0).toBeGreaterThanOrEqual(0);
        expect(options.iterations ?? 1).toBe(1);
        expect(Number(options.duration) + (options.delay ?? 0)).toBeLessThanOrEqual(
          event === 'move' ? 1250 : event === 'won' ? 5600 : 1400,
        );
        expect(options.endDelay ?? 0).toBe(0);
        for (const frame of frames)
          expect(
            Object.keys(frame).every((key) => ['opacity', 'transform', 'offset'].includes(key)),
          ).toBe(true);
      }
    },
  );

  it('caps even repeated whole-board cascade traces and replaces the previous move flourish', () => {
    const { root, fx } = build();
    const cascade = move.trace.stages.find((stage) => stage.kind === 'cascade')!;
    const crowdedMove = {
      ...move,
      trace: {
        ...move.trace,
        result: { ...move.trace.result, cleared: 1080 },
        stages: Array.from({ length: 30 }, () => ({
          ...cascade,
          matchedIndices: Array.from({ length: 36 }, (_, index) => index),
        })),
      },
    };
    fx.playMove(crowdedMove, 6);
    expect(animations.length).toBeGreaterThan(36);
    expect(root.querySelectorAll('.wqm-effect').length).toBeLessThanOrEqual(120);
    const old = [...animations];
    fx.playMove(move, 6);
    expect(
      old.every(({ cancel, element }) => cancel.mock.calls.length === 1 && !element.isConnected),
    ).toBe(true);
    expect(root.querySelectorAll('.wqm-effect').length).toBeLessThanOrEqual(120);
  });

  it('celebrates a win with rays, a wave and a fountain, and gives loss a distinct gentle ember finish', () => {
    const { root, fx } = build();
    fx.playOutcome('won');
    expect(root.querySelectorAll('.wqm-outcome-ray').length).toBeGreaterThan(8);
    expect(root.querySelector('.wqm-outcome-ring')).not.toBeNull();
    expect(root.querySelector('.wqm-outcome-wave')).not.toBeNull();
    expect(root.querySelectorAll('.wqm-spark').length).toBeGreaterThan(30);
    fx.playOutcome('lost');
    expect(root.querySelector('.wqm-outcome-ray')).toBeNull();
    expect(root.querySelector('.wqm-outcome-veil')).not.toBeNull();
    expect(root.querySelector('.wqm-outcome-ember')).not.toBeNull();
  });

  it('keeps three clears restrained, then adds materially richer stars and radiance at five and large cascades', () => {
    const { root, fx } = build();
    const read = (total: number) => {
      const start = animations.length;
      fx.playMove(
        clearReceipt(
          total,
          Array.from({ length: total }, (_, index) => index),
        ),
        6,
      );
      return {
        sparks: root.querySelectorAll('.wqm-spark').length,
        rings: root.querySelectorAll('.wqm-match-ring').length,
        rays: root.querySelectorAll('.wqm-match-ray').length,
        finish: Math.max(
          ...animations
            .slice(start)
            .map(({ options }) => Number(options.duration) + (options.delay ?? 0)),
        ),
      };
    };
    const three = read(3);
    const four = read(4);
    const five = read(5);
    const nine = read(9);
    expect(three.sparks).toBe(15);
    expect(three.rings + three.rays).toBe(0);
    expect(three.finish).toBeLessThanOrEqual(905);
    expect(four.sparks).toBeGreaterThan(three.sparks);
    expect(four.rings + four.rays).toBe(0);
    expect(five.sparks).toBeGreaterThanOrEqual(three.sparks * 3);
    expect(five.rings).toBeGreaterThan(0);
    expect(five.rays).toBeGreaterThan(0);
    expect(nine.sparks).toBeGreaterThan(five.sparks);
    expect(nine.rings).toBeGreaterThan(five.rings);
    expect(nine.rays).toBeGreaterThan(five.rays);
    expect(nine.finish).toBeGreaterThan(five.finish);
    expect(nine.finish).toBeLessThanOrEqual(1250);
  });

  it('staggers sparks at the same candy and preserves their centered origin along the shaped trajectory', () => {
    const { fx } = build();
    fx.playMove(clearReceipt(3), 6);
    const sparks = animations.filter(({ element }) => element.classList.contains('wqm-spark'));
    const first = sparks[0].element as HTMLElement;
    const sameCandy = sparks.filter(({ element }) => {
      const node = element as HTMLElement;
      return node.style.left === first.style.left && node.style.top === first.style.top;
    });
    expect(new Set(sameCandy.map(({ options }) => options.delay)).size).toBeGreaterThan(1);
    for (const { frames, options } of sparks) {
      expect(options.easing).toBe('linear');
      expect(frames.length).toBeGreaterThanOrEqual(5);
      expect(
        frames.every((frame) => String(frame.transform).includes('translate(calc(-50% +')),
      ).toBe(true);
      expect(frames.every((frame) => !String(frame.transform).includes('NaN'))).toBe(true);
    }
  });

  it('emits fountain transforms that travel sideways, rise to an apex and fall back down', () => {
    const { fx } = build();
    fx.playOutcome('won');
    const fountains = animations.filter(
      ({ element, options }) =>
        element.classList.contains('wqm-spark') && options.easing === 'linear',
    );
    expect(fountains.length).toBeGreaterThan(30);
    for (const { frames } of fountains) {
      const points = translatedPoints(frames);
      const first = points[0];
      const last = points[points.length - 1];
      expect(first.x).toBe(0);
      expect(first.y).toBe(0);
      expect(Math.min(...points.slice(1, -1).map((point) => point.y))).toBeLessThan(-50);
      expect(last.y).toBeGreaterThan(0);
      expect(Math.abs(last.x)).toBeGreaterThan(0);
    }
  });

  it('carries alternating match curvature through the emitted x and y transforms', () => {
    const { fx } = build();
    fx.playMove(clearReceipt(3), 6);
    const sparks = animations.filter(({ element }) => element.classList.contains('wqm-spark'));
    const first = sparks[0].element as HTMLElement;
    const sameCandy = sparks.filter(({ element }) => {
      const node = element as HTMLElement;
      return node.style.left === first.style.left && node.style.top === first.style.top;
    });
    expect(sameCandy.length).toBeGreaterThan(1);
    const curvature = (animation: RecordedAnimation) => {
      const points = translatedPoints(animation.frames);
      const middle = points[Math.floor(points.length / 2)];
      const last = points[points.length - 1];
      // Signed area distinguishes opposite bends from a straight or collapsed trajectory.
      return last.x * middle.y - last.y * middle.x;
    };
    expect(curvature(sameCandy[0])).toBeGreaterThan(0);
    expect(curvature(sameCandy[1])).toBeLessThan(0);
  });

  it('gives every clear and ending an ignition, shaped middle and quiet finish without adding nodes', () => {
    const { fx } = build();
    fx.playMove(move, 6);
    const check = (className: string) => {
      const sequence = animations.filter(({ element }) => element.classList.contains(className));
      expect(sequence.length).toBeGreaterThan(0);
      for (const { frames } of sequence) {
        expect(frames.length).toBeGreaterThanOrEqual(4);
        expect(frames[0].opacity).toBe(0);
        expect(frames.at(-1)?.opacity).toBe(0);
        expect(frames.every((frame) => typeof frame.transform === 'string')).toBe(true);
      }
    };
    check('wqm-effect-trail');
    check('wqm-effect-burst');
    check('wqm-effect-settle');
    const startVictory = animations.length;
    fx.playOutcome('won');
    expect(animations.length - startVictory).toBeLessThanOrEqual(113);
    check('wqm-outcome-ring');
    check('wqm-victory-confetti');
    const startLoss = animations.length;
    fx.playOutcome('lost');
    expect(animations.length - startLoss).toBeLessThanOrEqual(19);
    check('wqm-outcome-veil');
    check('wqm-outcome-ember');
  });

  it('counts repeated clears of the same cells across cascades toward the grand effect', () => {
    const { root, fx } = build();
    const sameCells = [0, 1, 2];
    fx.playMove(clearReceipt(3, sameCells), 6);
    const ordinarySparks = root.querySelectorAll('.wqm-spark').length;
    expect(root.querySelector('.wqm-match-ring')).toBeNull();
    fx.playMove(clearReceipt(9, sameCells), 6);
    const repeated = {
      sparks: root.querySelectorAll('.wqm-spark').length,
      rings: root.querySelectorAll('.wqm-match-ring').length,
      rays: root.querySelectorAll('.wqm-match-ray').length,
    };
    expect(repeated.sparks).toBeGreaterThan(ordinarySparks * 3);
    expect(repeated.rings).toBeGreaterThan(1);
    fx.playMove(
      clearReceipt(
        9,
        Array.from({ length: 9 }, (_, index) => index),
      ),
      6,
    );
    expect(root.querySelectorAll('.wqm-spark')).toHaveLength(repeated.sparks);
    expect(root.querySelectorAll('.wqm-match-ring')).toHaveLength(repeated.rings);
    expect(root.querySelectorAll('.wqm-match-ray')).toHaveLength(repeated.rays);
  });

  it('sustains a layered victory for over five seconds while loss remains brief', () => {
    const { root, fx } = build();
    fx.playOutcome('won');
    const victory = [...animations];
    const finish = (items: RecordedAnimation[]) =>
      Math.max(...items.map(({ options }) => Number(options.duration) + (options.delay ?? 0)));
    expect(finish(victory)).toBeGreaterThanOrEqual(5400);
    expect(finish(victory)).toBeLessThanOrEqual(5600);
    expect(root.querySelectorAll('.wqm-outcome-wave').length).toBeGreaterThan(1);
    expect(root.querySelector('.wqm-victory-confetti')).not.toBeNull();
    expect(victory.some(({ options }) => (options.delay ?? 0) >= 4000)).toBe(true);
    fx.playOutcome('lost');
    const loss = animations.slice(victory.length);
    expect(finish(loss)).toBeLessThanOrEqual(1400);
    expect(finish(victory)).toBeGreaterThan(finish(loss) * 3);
    expect(
      victory.every(
        ({ cancel, element }) => cancel.mock.calls.length === 1 && !element.isConnected,
      ),
    ).toBe(true);
  });

  it.each(['cancel', 'move', 'dispose'] as const)(
    'interrupts every delayed victory wave on %s',
    (action) => {
      const { fx } = build();
      fx.playOutcome('won');
      const victory = [...animations];
      expect(victory.some(({ options }) => (options.delay ?? 0) >= 4000)).toBe(true);
      if (action === 'move') fx.playMove(move, 6);
      else fx[action]();
      expect(
        victory.every(
          ({ cancel, element, onfinish, oncancel }) =>
            cancel.mock.calls.length === 1 &&
            !element.isConnected &&
            onfinish === null &&
            oncancel === null,
        ),
      ).toBe(true);
    },
  );

  it('removes every element and releases its animation when it naturally finishes', () => {
    const { root, fx } = build();
    fx.playOutcome('won');
    for (const animation of animations) animation.onfinish?.();
    expect(root.querySelector('.wqm-effect')).toBeNull();
    fx.cancel();
    expect(animations.every(({ cancel }) => cancel.mock.calls.length === 1)).toBe(true);
  });

  it('cleans interrupted and cancelled animations, and tolerates repeated disposal and rebinding', () => {
    const state = build();
    state.fx.playMove(move, 6);
    const first = animations[0];
    first.oncancel?.();
    expect(first.element.isConnected).toBe(false);
    state.fx.dispose();
    state.fx.dispose();
    expect(state.root.querySelector('.wqm-fx-layer')).toBeNull();
    expect(animations.every(({ cancel }) => cancel.mock.calls.length === 1)).toBe(true);
    const count = animations.length;
    state.fx.playOutcome('won');
    expect(animations.length).toBe(count);
    state.fx.bind(state.frame, state.grid, state.cells);
    state.fx.playOutcome('won');
    expect(animations.length).toBeGreaterThan(count);
    expect(state.root.querySelectorAll('.wqm-fx-layer')).toHaveLength(1);
  });

  it.each(['system', 'setting', 'low'] as const)(
    'suppresses all flourishes initially and cancels live flourishes for %s motion settings',
    async (mode) => {
      const { root, fx } = build();
      fx.playOutcome('won');
      expect(animations.length).toBeGreaterThan(0);
      if (mode === 'system') {
        media.matches = true;
        media.dispatchEvent(new Event('change'));
      } else if (mode === 'setting') document.body.classList.add('reduce-motion');
      else document.documentElement.dataset.fxLevel = 'low';
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(root.querySelector('.wqm-effect')).toBeNull();
      expect(animations.every(({ cancel }) => cancel.mock.calls.length === 1)).toBe(true);
      const count = animations.length;
      fx.playMove(move, 6);
      fx.playOutcome('lost');
      const second = build();
      second.fx.playOutcome('won');
      expect(animations.length).toBe(count);
    },
  );

  it('releases settings listeners on disposal and resumes normally after a reduced-motion setting is disabled', () => {
    const remove = vi.spyOn(media, 'removeEventListener');
    const { fx } = build();
    media.matches = true;
    fx.playMove(move, 6);
    expect(animations).toHaveLength(0);
    media.matches = false;
    media.dispatchEvent(new Event('change'));
    fx.playMove(move, 6);
    expect(animations.length).toBeGreaterThan(0);
    fx.dispose();
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('degrades to the intact board if animation support is absent or throws', () => {
    const { cells, root, fx } = build();
    Reflect.deleteProperty(Element.prototype, 'animate');
    fx.playOutcome('won');
    expect(root.querySelector('.wqm-effect')).toBeNull();
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: () => {
        throw new Error('Unavailable animation backend');
      },
    });
    expect(() => fx.playMove(move, 6)).not.toThrow();
    expect(root.querySelector('.wqm-effect')).toBeNull();
    expect(cells.every((cell) => !cell.disabled)).toBe(true);
  });
});
