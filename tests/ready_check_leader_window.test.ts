// ReadyCheckLeaderWindow tests (src/ui/hud/chat/ready_check_leader_window.ts)
// Verifies:
// - Renders each party member with correct state icon:
//   - ready: green check icon
//   - notready: red cross icon
//   - pending: nothing ("si no ha respondido que no salga nada")
// - Auto-close timer triggers on done: true
// - Close button dismisses window
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  READY_CHECK_AUTO_CLOSE_MS,
  ReadyCheckLeaderWindow,
} from '../src/ui/hud/chat/ready_check_leader_window';

interface FakeElement {
  hidden: boolean;
  style: { removeProperty: (p: string) => void };
  children: FakeElement[];
  textContent: string;
  innerHTML: string;
  className: string;
  classList: {
    add: (c: string) => void;
    contains: (c: string) => boolean;
  };
  querySelector: (sel: string) => FakeElement | null;
  replaceChildren: (...nodes: unknown[]) => void;
  appendChild: (kid: unknown) => void;
  append: (...kids: unknown[]) => void;
  addEventListener: (event: string, handler: () => void) => void;
}

function createFakeDom(): {
  root: FakeElement;
  closeBtn: FakeElement;
  roster: FakeElement;
  statusLine: FakeElement;
} {
  const listeners = new Map<string, (() => void)[]>();

  const makeEl = (cls = ''): FakeElement => {
    const elClasses = new Set<string>(cls ? cls.split(' ') : []);
    const el: FakeElement = {
      hidden: true,
      style: { removeProperty: vi.fn() },
      children: [],
      textContent: '',
      innerHTML: '',
      className: cls,
      classList: {
        add: (c) => elClasses.add(c),
        contains: (c) => elClasses.has(c),
      },
      querySelector: (sel: string) => {
        if (sel === '.rck-close') return closeBtn;
        if (sel === '.rck-roster') return roster;
        if (sel === '.rck-status-line') return statusLine;
        return null;
      },
      replaceChildren: (...nodes: unknown[]) => {
        el.children = nodes as FakeElement[];
      },
      appendChild: (kid: unknown) => {
        el.children.push(kid as FakeElement);
      },
      append: (...kids: unknown[]) => {
        el.children.push(...(kids as FakeElement[]));
      },
      addEventListener: (event: string, handler: () => void) => {
        const list = listeners.get(event) ?? [];
        list.push(handler);
        listeners.set(event, list);
      },
    };
    return el;
  };

  const closeBtn = makeEl('rck-close');
  const roster = makeEl('rck-roster');
  const statusLine = makeEl('rck-status-line');
  const root = makeEl('ready-check-leader-window');
  root.children = [closeBtn, roster, statusLine];

  return { root, closeBtn, roster, statusLine };
}

describe('ReadyCheckLeaderWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // stub document.createElement for window row construction
    vi.stubGlobal('document', {
      createElement: (_tag: string) => {
        const elClasses = new Set<string>();
        return {
          className: '',
          textContent: '',
          innerHTML: '',
          children: [] as unknown[],
          classList: {
            add: (c: string) => elClasses.add(c),
            contains: (c: string) => elClasses.has(c),
          },
          append(...kids: unknown[]) {
            this.children.push(...kids);
          },
        };
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders each party member with correct status icon', () => {
    const { root, roster } = createFakeDom();
    const window = new ReadyCheckLeaderWindow(root as unknown as HTMLElement);

    window.update({
      done: false,
      responses: [
        { pid: 1, name: 'Leader', state: 'ready' },
        { pid: 2, name: 'Alice', state: 'notready' },
        { pid: 3, name: 'Bob', state: 'pending' },
      ],
    });

    expect(root.hidden).toBe(false);
    expect(roster.children).toHaveLength(3);

    // Leader: ready -> green check icon
    const leaderRow = roster.children[0];
    const leaderName = leaderRow.children[0];
    const leaderStatus = leaderRow.children[1];
    expect(leaderName.textContent).toBe('Leader');
    expect(leaderStatus.innerHTML).toContain('ui-icon');
    expect(leaderStatus.classList.contains('rck-yes')).toBe(true);

    // Alice: notready -> red cross icon
    const aliceRow = roster.children[1];
    const aliceName = aliceRow.children[0];
    const aliceStatus = aliceRow.children[1];
    expect(aliceName.textContent).toBe('Alice');
    expect(aliceStatus.innerHTML).toContain('ui-icon');
    expect(aliceStatus.classList.contains('rck-no')).toBe(true);

    // Bob: pending -> empty string ("si no ha respondido que no salga nada")
    const bobRow = roster.children[2];
    const bobName = bobRow.children[0];
    const bobStatus = bobRow.children[1];
    expect(bobName.textContent).toBe('Bob');
    expect(bobStatus.textContent).toBe('');
    expect(bobStatus.classList.contains('rck-yes')).toBe(false);
    expect(bobStatus.classList.contains('rck-no')).toBe(false);
  });

  it('auto-closes after READY_CHECK_AUTO_CLOSE_MS when done is true', () => {
    const { root } = createFakeDom();
    const window = new ReadyCheckLeaderWindow(root as unknown as HTMLElement);

    window.update({
      done: true,
      responses: [
        { pid: 1, name: 'Leader', state: 'ready' },
        { pid: 2, name: 'Alice', state: 'ready' },
      ],
    });

    expect(root.hidden).toBe(false);

    vi.advanceTimersByTime(READY_CHECK_AUTO_CLOSE_MS - 1);
    expect(root.hidden).toBe(false);

    vi.advanceTimersByTime(1);
    expect(root.hidden).toBe(true);
  });

  it('hides immediately when hide() is called', () => {
    const { root } = createFakeDom();
    const window = new ReadyCheckLeaderWindow(root as unknown as HTMLElement);

    window.update({
      done: false,
      responses: [{ pid: 1, name: 'Leader', state: 'ready' }],
    });
    expect(root.hidden).toBe(false);

    window.hide();
    expect(root.hidden).toBe(true);
  });
});
