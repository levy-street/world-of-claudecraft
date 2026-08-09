import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TUTORIAL_SEEN_KEY, TUTORIAL_SEEN_VALUE } from '../src/editor/tutorial_core';

// TutorialLoader defers the ~300-line Help modal + first-run tour bundle
// (tutorial.ts) behind a dynamic import: maybeAutoStart() must never import
// it for a returning-user session (the seen flag already set), and any path
// that DOES load it must import the real module exactly once, however many
// times its methods are called afterward.

const ctorCalls: unknown[] = [];
const openHelp = vi.fn();
const maybeAutoStart = vi.fn();

vi.mock('../src/editor/tutorial', () => ({
  EditorTutorial: class {
    constructor(root: unknown) {
      ctorCalls.push(root);
    }
    openHelp = openHelp;
    maybeAutoStart = maybeAutoStart;
  },
}));

import { TutorialLoader } from '../src/editor/tutorial_loader';

// minimal localStorage stub (the test env is plain node, no DOM)
function installStorage(initial: Record<string, string> = {}): Map<string, string> {
  const map = new Map(Object.entries(initial));
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
  return map;
}

// Real dynamic import() resolves over more than one microtask tick even when
// the module is already cached, so wait a macrotask turn before asserting.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const fakeRoot = {} as HTMLElement;

beforeEach(() => {
  ctorCalls.length = 0;
  openHelp.mockClear();
  maybeAutoStart.mockClear();
});

describe('TutorialLoader.maybeAutoStart', () => {
  it('never imports the tutorial module for a returning-user session', async () => {
    installStorage({ [TUTORIAL_SEEN_KEY]: TUTORIAL_SEEN_VALUE });
    const loader = new TutorialLoader(fakeRoot);
    loader.maybeAutoStart();
    // Give any accidental import a turn to resolve before asserting it did not fire.
    await flush();
    expect(ctorCalls.length).toBe(0);
    expect(maybeAutoStart).not.toHaveBeenCalled();
  });

  it('imports the module and starts the tour on a first-run session', async () => {
    installStorage(); // no seen flag stored
    const loader = new TutorialLoader(fakeRoot);
    loader.maybeAutoStart();
    await flush();
    expect(ctorCalls).toEqual([fakeRoot]);
    expect(maybeAutoStart).toHaveBeenCalledTimes(1);
  });

  it('a blocked storage read reports seen, so it never forces a load', async () => {
    (globalThis as any).localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    const loader = new TutorialLoader(fakeRoot);
    loader.maybeAutoStart();
    await flush();
    expect(ctorCalls.length).toBe(0);
  });
});

describe('TutorialLoader.openHelp', () => {
  it('lazily imports the module regardless of the seen flag', async () => {
    installStorage({ [TUTORIAL_SEEN_KEY]: TUTORIAL_SEEN_VALUE });
    const loader = new TutorialLoader(fakeRoot);
    loader.openHelp();
    await flush();
    expect(ctorCalls).toEqual([fakeRoot]);
    expect(openHelp).toHaveBeenCalledTimes(1);
  });

  it('reuses the same loaded instance across repeated calls (imports once)', async () => {
    installStorage();
    const loader = new TutorialLoader(fakeRoot);
    loader.openHelp();
    await flush();
    loader.openHelp();
    loader.openHelp();
    await flush();
    expect(ctorCalls.length).toBe(1);
    expect(openHelp).toHaveBeenCalledTimes(3);
  });

  it('a concurrent maybeAutoStart + openHelp share one import', async () => {
    installStorage(); // first-run session: both paths would load
    const loader = new TutorialLoader(fakeRoot);
    loader.maybeAutoStart();
    loader.openHelp();
    await flush();
    expect(ctorCalls.length).toBe(1);
    expect(maybeAutoStart).toHaveBeenCalledTimes(1);
    expect(openHelp).toHaveBeenCalledTimes(1);
  });
});
