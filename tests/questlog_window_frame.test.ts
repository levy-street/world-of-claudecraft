// @vitest-environment jsdom
//
// Behavioral guards for the quest-log window painter AFTER the AAA window-frame
// adoption (the pure list/detail decisions stay in questlog_view.test.ts). These
// render the real DOM through the shared window-frame builder and assert: the
// frame chrome is stamped on an inner mount (the root stays a pristine
// .window.panel), the titlebar is a Hud-recognized drag handle but the close is
// not, the body frames a bounded flex column, quest TRACKING (openWithQuest jumps
// to a quest's detail and Hud reads it back through selectedQuestId) is preserved,
// the abandon flow still routes through the confirm dialog, the footer surfaces
// the share action through the existing insertQuestChatLink dep, and a hostile
// quest title is escaped (no live injection).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUESTS } from '../src/sim/data';
import type { PlayerClass, QuestProgress } from '../src/sim/types';
import { QuestLogWindow, type QuestLogWindowDeps } from '../src/ui/questlog_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';
import type { IWorld } from '../src/world_api';

// A real quest with at least one objective so the detail pane is exercised.
const QUEST = Object.values(QUESTS).filter((q) => q.objectives.length >= 1)[0];
const CLASS_ID = 'warrior' as PlayerClass;

// Force a controllable quest title so the esc() path is testable without depending
// on the tEntity resolver internals. The other entity_i18n exports keep working.
vi.mock('../src/ui/entity_i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/entity_i18n')>();
  return {
    ...actual,
    tEntity: (arg: { kind: string; field: string }) =>
      arg.kind === 'quest' && arg.field === 'title'
        ? '<img src=x onerror=alert(1)>'
        : actual.tEntity(arg as never),
  };
});

function progress(questId: string, state: QuestProgress['state']): QuestProgress {
  const counts = QUESTS[questId].objectives.map(() => 0);
  return { questId, counts, state } as unknown as QuestProgress;
}

function fakeWorld(quests: QuestProgress[]): IWorld {
  const questLog = new Map(quests.map((q) => [q.questId, q]));
  return {
    questLog,
    questsDone: new Set<string>(),
    cfg: { playerClass: CLASS_ID },
    player: { name: 'Hero' },
    abandonQuest: vi.fn(),
  } as unknown as IWorld;
}

function fakeDeps(overrides: Partial<QuestLogWindowDeps> = {}): QuestLogWindowDeps {
  const el = document.createElement('div');
  el.id = 'quest-log-window';
  el.className = 'window panel';
  document.body.appendChild(el);
  return {
    root: () => el,
    world: () => fakeWorld([progress(QUEST.id, 'active')]),
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    hideTooltip: () => {},
    focusFirstInteractive: () => {},
    confirmDialog: () => {},
    insertQuestChatLink: () => {},
    itemIcon: () => '<img class="item-icon" alt="">',
    moneyHtml: (copper: number) => `<span class="money-inline">${copper}</span>`,
    itemTooltip: () => '<div>tt</div>',
    attachTooltip: () => {},
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('QuestLogWindow: frame adoption', () => {
  it('stamps the window-frame chrome on an INNER mount with titlebar, body, close', () => {
    const deps = fakeDeps();
    const w = new QuestLogWindow(deps);
    w.toggle();
    const root = deps.root();
    // The shared root never carries builder state; the frame lives on an inner mount.
    expect(root.classList.contains('window-frame')).toBe(false);
    expect(root.hasAttribute('role')).toBe(false);
    const frame = root.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.getAttribute('aria-labelledby')).toBe('quest-log-window-title');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
  });

  it('opens the window with display:flex so the frame grammar bounds it as a flex column', () => {
    const deps = fakeDeps();
    const w = new QuestLogWindow(deps);
    expect(w.isOpen).toBe(false);
    w.toggle();
    expect(w.isOpen).toBe(true);
    expect(deps.root().style.display).toBe('flex');
  });

  it('reuses the frame on a re-render instead of rebuilding it cold', () => {
    const deps = fakeDeps();
    const w = new QuestLogWindow(deps);
    w.toggle();
    const firstBody = deps.root().querySelector('.window-body');
    w.render();
    expect(deps.root().querySelector('.window-body')).toBe(firstBody);
    expect(deps.root().querySelectorAll('.window-titlebar').length).toBe(1);
  });
});

describe('QuestLogWindow: move / resize / fit parity', () => {
  it('makes the titlebar a Hud drag handle, but never the close control', () => {
    const deps = fakeDeps();
    const w = new QuestLogWindow(deps);
    w.toggle();
    const root = deps.root();
    const titlebar = root.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const closeBtn = root.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, root)).toBe(true);
    expect(isWindowDragHandle(closeBtn, root)).toBe(false);
  });

  it('frames a bounded flex column: pinned titlebar then a scrollable body then a footer', () => {
    const deps = fakeDeps();
    const w = new QuestLogWindow(deps);
    w.toggle();
    const frame = deps.root().querySelector<HTMLElement>(':scope > .window-frame');
    const order = Array.from(frame?.children ?? []).map((c) => (c as HTMLElement).className);
    expect(order).toEqual(['window-titlebar', 'window-body', 'window-footer']);
    expect(frame?.querySelectorAll('.window-body').length).toBe(1);
  });
});

describe('QuestLogWindow: quest tracking (the sacred flow)', () => {
  it('openWithQuest selects the quest, opens the log, and exposes it via selectedQuestId', () => {
    const deps = fakeDeps({
      world: () => fakeWorld([progress(QUEST.id, 'active')]),
    });
    const w = new QuestLogWindow(deps);
    w.openWithQuest(QUEST.id);
    expect(w.isOpen).toBe(true);
    // Hud's /share command reads the selection back through this getter.
    expect(w.selectedQuestId).toBe(QUEST.id);
    // The detail pane renders for the tracked quest.
    expect(deps.root().querySelector('.ql-detail')?.textContent ?? '').not.toBe('');
  });

  it('a quest-row click re-selects and repaints the detail', () => {
    const q2 = Object.values(QUESTS).filter((q) => q.objectives.length >= 1)[1];
    const deps = fakeDeps({
      world: () => fakeWorld([progress(QUEST.id, 'active'), progress(q2.id, 'active')]),
    });
    const w = new QuestLogWindow(deps);
    w.toggle();
    const rows = deps.root().querySelectorAll<HTMLButtonElement>('.ql-item');
    expect(rows.length).toBe(2);
    rows[1].click();
    expect(w.selectedQuestId).toBe(q2.id);
  });

  it('shift-clicking a quest row links it into chat instead of selecting', () => {
    const insertQuestChatLink = vi.fn();
    const deps = fakeDeps({
      world: () => fakeWorld([progress(QUEST.id, 'active')]),
      insertQuestChatLink,
    });
    const w = new QuestLogWindow(deps);
    w.toggle();
    const row = deps.root().querySelector<HTMLButtonElement>('.ql-item') as HTMLButtonElement;
    row.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    expect(insertQuestChatLink).toHaveBeenCalledWith(QUEST.id);
  });
});

describe('QuestLogWindow: footer actions + callbacks', () => {
  it('routes the abandon action through the confirm dialog to world.abandonQuest', () => {
    const world = fakeWorld([progress(QUEST.id, 'active')]);
    // Object holder, not a `let` local: TS narrows a closure-assigned `let` back to
    // its initializer, so it would type the deferred call as `never`.
    const captured: { onOk: (() => void) | null } = { onOk: null };
    const deps = fakeDeps({
      world: () => world,
      confirmDialog: (_t, _b, _ok, _cancel, ok) => {
        captured.onOk = ok;
      },
    });
    const w = new QuestLogWindow(deps);
    w.toggle();
    const abandon = deps
      .root()
      .querySelector<HTMLButtonElement>('.window-footer [data-quest-abandon]');
    expect(abandon).not.toBeNull();
    abandon?.click();
    expect(captured.onOk).not.toBeNull();
    captured.onOk?.();
    expect(world.abandonQuest).toHaveBeenCalledWith(QUEST.id);
  });

  it('routes the close control to close(): display none + hidden window', () => {
    const restoreFocus = vi.fn();
    const deps = fakeDeps({ restoreFocus });
    const w = new QuestLogWindow(deps);
    w.toggle();
    deps.root().querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(w.isOpen).toBe(false);
    expect(deps.root().style.display).toBe('none');
    expect(restoreFocus).toHaveBeenCalled();
  });
});

describe('QuestLogWindow: hostile-string escaping', () => {
  it('escapes an injected quest title through esc() (no live img element)', () => {
    const deps = fakeDeps();
    const w = new QuestLogWindow(deps);
    w.toggle();
    const list = deps.root().querySelector('.ql-list') as HTMLElement;
    expect(list.querySelector('img')).toBeNull();
    expect(list.innerHTML).toContain('&lt;img');
  });
});
