import { describe, expect, it } from 'vitest';
import {
  type SeenStore,
  shouldAutoStart,
  TUTORIAL_SEEN_VALUE,
  TUTORIAL_STEPS,
  TutorialModel,
  type TutorialStepDef,
} from '../src/editor/tutorial_core';

// Pure tour state machine: auto-start policy, advance/back/skip, the
// missing-anchor skip, the seen flag, and restart after completion.

function makeStore(initial: string | null = null): SeenStore & { value: string | null } {
  return {
    value: initial,
    get() {
      return this.value;
    },
    set(v: string) {
      this.value = v;
    },
  };
}

const STEPS: TutorialStepDef[] = [
  { id: 'a', anchor: '.a', titleKey: 't.a', bodyKey: 'b.a' },
  { id: 'b', anchor: '.b', titleKey: 't.b', bodyKey: 'b.b' },
  { id: 'c', anchor: '.c', titleKey: 't.c', bodyKey: 'b.c' },
];

const allOk = (): boolean => true;

describe('auto-start policy', () => {
  it('starts on first run and never again once seen', () => {
    expect(shouldAutoStart(null)).toBe(true);
    expect(shouldAutoStart('')).toBe(true);
    expect(shouldAutoStart(TUTORIAL_SEEN_VALUE)).toBe(false);
    const model = new TutorialModel(STEPS, makeStore(TUTORIAL_SEEN_VALUE));
    expect(model.shouldAutoStart()).toBe(false);
  });
});

describe('TutorialModel', () => {
  it('advancing past the last step completes the tour and sets seen', () => {
    const store = makeStore();
    const model = new TutorialModel(STEPS, store);
    expect(model.start(allOk)).toBe(true);
    expect(model.isRunning).toBe(true);
    expect(model.step?.id).toBe('a');
    model.next(allOk);
    expect(model.step?.id).toBe('b');
    model.next(allOk);
    expect(model.step?.id).toBe('c');
    expect(model.hasNext(allOk)).toBe(false);
    model.next(allOk);
    expect(model.isRunning).toBe(false);
    expect(model.step).toBeNull();
    expect(store.value).toBe(TUTORIAL_SEEN_VALUE);
  });

  it('skip completes immediately and sets seen', () => {
    const store = makeStore();
    const model = new TutorialModel(STEPS, store);
    model.start(allOk);
    model.skip();
    expect(model.isRunning).toBe(false);
    expect(store.value).toBe(TUTORIAL_SEEN_VALUE);
  });

  it('skips steps whose anchor is missing, in both directions', () => {
    const store = makeStore();
    const model = new TutorialModel(STEPS, store);
    const noB = (sel: string): boolean => sel !== '.b';
    expect(model.start(noB)).toBe(true);
    expect(model.step?.id).toBe('a');
    model.next(noB);
    expect(model.step?.id).toBe('c'); // b skipped forward
    model.back(noB);
    expect(model.step?.id).toBe('a'); // b skipped backward
  });

  it('a missing first anchor starts on the next visible step', () => {
    const model = new TutorialModel(STEPS, makeStore());
    const noA = (sel: string): boolean => sel !== '.a';
    expect(model.start(noA)).toBe(true);
    expect(model.step?.id).toBe('b');
    expect(model.hasBack(noA)).toBe(false);
  });

  it('never blocks: with every anchor missing, start finishes and sets seen', () => {
    const store = makeStore();
    const model = new TutorialModel(STEPS, store);
    expect(model.start(() => false)).toBe(false);
    expect(model.isRunning).toBe(false);
    expect(store.value).toBe(TUTORIAL_SEEN_VALUE);
  });

  it('back on the first visible step stays put', () => {
    const model = new TutorialModel(STEPS, makeStore());
    model.start(allOk);
    expect(model.hasBack(allOk)).toBe(false);
    model.back(allOk);
    expect(model.step?.id).toBe('a');
  });

  it('restart works after completion', () => {
    const store = makeStore();
    const model = new TutorialModel(STEPS, store);
    model.start(allOk);
    model.skip();
    expect(store.value).toBe(TUTORIAL_SEEN_VALUE);
    expect(model.start(allOk)).toBe(true);
    expect(model.isRunning).toBe(true);
    expect(model.step?.id).toBe('a');
    expect(model.position()).toEqual({ current: 1, total: 3 });
  });

  it('position reports a 1-based counter over the full list', () => {
    const model = new TutorialModel(STEPS, makeStore());
    model.start(allOk);
    model.next(allOk);
    expect(model.position()).toEqual({ current: 2, total: 3 });
  });
});

describe('shipped step definitions', () => {
  it('every step has an anchor and editor.tutorial i18n keys', () => {
    expect(TUTORIAL_STEPS.length).toBeGreaterThanOrEqual(6);
    expect(TUTORIAL_STEPS.length).toBeLessThanOrEqual(9);
    for (const step of TUTORIAL_STEPS) {
      expect(step.anchor.startsWith('.')).toBe(true);
      expect(step.titleKey).toMatch(/^editor\.tutorial\.steps\.[A-Za-z]+\.title$/);
      expect(step.bodyKey).toMatch(/^editor\.tutorial\.steps\.[A-Za-z]+\.body$/);
    }
    const ids = new Set(TUTORIAL_STEPS.map((s) => s.id));
    expect(ids.size).toBe(TUTORIAL_STEPS.length);
  });
});
