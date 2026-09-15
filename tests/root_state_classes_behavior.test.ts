// @vitest-environment happy-dom
//
// Behaviour of the state classes that replaced the root-anchored :has() rules
// (src/ui/root_state_classes.ts), each driven through the REAL owner over real
// DOM, both ways: the class must appear at the exact moment the old selector
// would have matched, and vanish when it would have stopped. The selector side
// is pinned in tests/css_root_anchored_has.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { paintClickMoveMarker } from '../src/game/click_move_marker';
import {
  bindChatComposerFocusState,
  resetChatComposer,
} from '../src/ui/chat_composer_focus_controller';
import { TutorialOverlay } from '../src/ui/tutorial';
import { syncWindowOpenBodyClasses } from '../src/ui/window_open_state';

const isVisible = (el: HTMLElement): boolean =>
  !el.hidden && getComputedStyle(el).display !== 'none';
const sync = (): void => syncWindowOpenBodyClasses(isVisible);

describe('window-open mirror: #ui.options-open', () => {
  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML =
      '<div id="ui"><div id="options-menu" class="window panel" style="display: none"></div>' +
      '<div id="trade-window" class="window panel" style="display: none"></div>' +
      '<div id="bags" class="window panel" style="display: none"></div></div>';
  });

  const ui = (): HTMLElement => document.getElementById('ui') as HTMLElement;
  const menu = (): HTMLElement => document.getElementById('options-menu') as HTMLElement;

  it('follows the options menu display flex/none, the inline values the window writes', () => {
    sync();
    expect(ui().classList.contains('options-open')).toBe(false);
    menu().style.display = 'flex';
    sync();
    expect(ui().classList.contains('options-open')).toBe(true);
    menu().style.display = 'none';
    sync();
    expect(ui().classList.contains('options-open')).toBe(false);
  });

  it('keys on visibility, deliberately wider than the old inline block|flex match', () => {
    // The old selector matched only an inline `display: block|flex` on a DIRECT
    // child of #ui; the mirror reads computed visibility, so a menu shown any
    // other way still gets its scrim. The window only ever writes flex/none
    // today, so the two agree on every live path; the widening is the intent.
    menu().style.display = 'grid';
    sync();
    expect(ui().classList.contains('options-open')).toBe(true);
  });

  it('a hidden attribute counts as closed even with an inline display', () => {
    menu().style.display = 'block';
    menu().hidden = true;
    sync();
    expect(ui().classList.contains('options-open')).toBe(false);
  });

  it('tolerates a page without #ui (the options scrim is an index/play concern)', () => {
    document.body.innerHTML = '<div id="x" class="window panel" style="display: none"></div>';
    expect(() => sync()).not.toThrow();
  });
});

describe('window-open mirror: body.trade-and-bags-open', () => {
  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML =
      '<div id="ui"><div id="trade-window" class="window panel"></div>' +
      '<div id="bags" class="window panel"></div></div>';
  });

  const mark = (id: string, open: boolean): void => {
    const el = document.getElementById(id) as HTMLElement;
    if (open) el.dataset.windowOpen = '1';
    else delete el.dataset.windowOpen;
  };

  it('is stamped only while BOTH windows carry the open marker', () => {
    sync();
    expect(document.body.classList.contains('trade-and-bags-open')).toBe(false);
    mark('trade-window', true);
    sync();
    expect(document.body.classList.contains('trade-and-bags-open')).toBe(false);
    mark('bags', true);
    sync();
    expect(document.body.classList.contains('trade-and-bags-open')).toBe(true);
    mark('trade-window', false);
    sync();
    expect(document.body.classList.contains('trade-and-bags-open')).toBe(false);
    mark('trade-window', true);
    mark('bags', false);
    sync();
    expect(document.body.classList.contains('trade-and-bags-open')).toBe(false);
  });

  it('reads the marker value, not its presence', () => {
    mark('trade-window', true);
    (document.getElementById('bags') as HTMLElement).dataset.windowOpen = '0';
    sync();
    expect(document.body.classList.contains('trade-and-bags-open')).toBe(false);
  });
});

describe('chat composer focus state', () => {
  let input: HTMLTextAreaElement;
  let wrap: HTMLElement;
  let onFocus: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML =
      '<div id="ui"><div id="chatlog-wrap"><div id="chatlog-frame"></div></div></div>' +
      '<textarea id="chat-input"></textarea>';
    input = document.getElementById('chat-input') as HTMLTextAreaElement;
    wrap = document.getElementById('chatlog-wrap') as HTMLElement;
    onFocus = vi.fn();
    bindChatComposerFocusState(input, { body: document.body, wrap, onFocus });
  });

  it('mirrors hover onto the wrap and off again', () => {
    input.dispatchEvent(new Event('mouseenter'));
    expect(wrap.classList.contains('chat-composer-hover')).toBe(true);
    expect(wrap.classList.contains('chat-composer-focus')).toBe(false);
    input.dispatchEvent(new Event('mouseleave'));
    expect(wrap.classList.contains('chat-composer-hover')).toBe(false);
  });

  it('mirrors focus onto the wrap and body, runs the focus work, and clears on blur', () => {
    input.dispatchEvent(new Event('focus'));
    expect(wrap.classList.contains('chat-composer-focus')).toBe(true);
    expect(document.body.classList.contains('mobile-chat-reply')).toBe(true);
    expect(onFocus).toHaveBeenCalledTimes(1);
    input.dispatchEvent(new Event('blur'));
    expect(wrap.classList.contains('chat-composer-focus')).toBe(false);
    expect(document.body.classList.contains('mobile-chat-reply')).toBe(false);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('keeps hover and focus independent (blur does not drop hover)', () => {
    input.dispatchEvent(new Event('mouseenter'));
    input.dispatchEvent(new Event('focus'));
    input.dispatchEvent(new Event('blur'));
    expect(wrap.classList.contains('chat-composer-hover')).toBe(true);
    expect(wrap.classList.contains('chat-composer-focus')).toBe(false);
  });

  it('the close reset drops hover, focus and the reply class together', () => {
    input.dispatchEvent(new Event('mouseenter'));
    input.dispatchEvent(new Event('focus'));
    resetChatComposer(document.body, wrap);
    expect(wrap.className).toBe('');
    expect(document.body.classList.contains('mobile-chat-reply')).toBe(false);
    expect(() => resetChatComposer(document.body, null)).not.toThrow();
  });

  it('still drives the body class and the focus work without a wrap', () => {
    const lone = document.createElement('textarea');
    const work = vi.fn();
    bindChatComposerFocusState(lone, { body: document.body, wrap: null, onFocus: work });
    lone.dispatchEvent(new Event('mouseenter'));
    lone.dispatchEvent(new Event('focus'));
    expect(document.body.classList.contains('mobile-chat-reply')).toBe(true);
    expect(work).toHaveBeenCalledTimes(1);
    lone.dispatchEvent(new Event('blur'));
    expect(document.body.classList.contains('mobile-chat-reply')).toBe(false);
  });
});

describe('click-move marker paint', () => {
  const shown = {
    x: 100.4,
    y: 200.6,
    entity: true,
    blocked: false,
    pulse: 3,
    pulseChanged: false,
  };

  it('paints the shown state and drops the right classes when hidden or offscreen', () => {
    const el = document.createElement('div');
    paintClickMoveMarker(el, shown);
    expect(el.className.split(' ').sort()).toEqual(['active', 'entity', 'pulse']);
    expect(el.style.transform).toBe('translate(100px, 201px) translate(-50%, -50%)');
    expect(el.dataset.pulse).toBe('3');
    paintClickMoveMarker(el, { ...shown, blocked: true });
    expect(el.classList.contains('blocked')).toBe(true);
    paintClickMoveMarker(el, 'offscreen');
    // Offscreen keeps the entity tint (the old branch removed only active/pulse/blocked).
    expect(el.className.split(' ').sort()).toEqual(['entity']);
    paintClickMoveMarker(el, shown);
    paintClickMoveMarker(el, 'hidden');
    expect(el.className).toBe('');
  });

  it('re-pulses on a pulse change and otherwise leaves the pulse alone', () => {
    const el = document.createElement('div');
    paintClickMoveMarker(el, shown);
    el.classList.remove('pulse');
    paintClickMoveMarker(el, shown);
    expect(el.classList.contains('pulse')).toBe(false);
    paintClickMoveMarker(el, { ...shown, pulse: 4 });
    expect(el.classList.contains('pulse')).toBe(true);
    expect(el.dataset.pulse).toBe('4');
    el.classList.remove('pulse');
    paintClickMoveMarker(el, { ...shown, pulse: 4, pulseChanged: true });
    expect(el.classList.contains('pulse')).toBe(true);
  });

  it('flips the steady classes only through toggle with a force flag', () => {
    // The point of the extraction: add/remove rewrote the class attribute every
    // frame even when nothing changed (happy-dom does the same, so the mechanism
    // is pinned on a fake token list rather than on attribute mutation counts).
    const calls: string[] = [];
    const cls = {
      toggle: (name: string, force?: boolean) => {
        calls.push(`toggle:${name}:${force}`);
        return !!force;
      },
      add: (name: string) => calls.push(`add:${name}`),
      remove: (name: string) => calls.push(`remove:${name}`),
    };
    const el = { classList: cls, style: {}, dataset: {}, offsetWidth: 0 } as unknown as HTMLElement;
    paintClickMoveMarker(el, 'hidden');
    expect(calls).toEqual([
      'toggle:active:false',
      'toggle:pulse:false',
      'toggle:blocked:false',
      'toggle:entity:false',
    ]);
    calls.length = 0;
    paintClickMoveMarker(el, 'offscreen');
    expect(calls).toEqual(['toggle:active:false', 'toggle:pulse:false', 'toggle:blocked:false']);
    calls.length = 0;
    paintClickMoveMarker(el, shown);
    expect(calls).toEqual([
      'toggle:entity:true',
      'toggle:blocked:false',
      'toggle:active:true',
      // The pulse restart is the one add/remove pair, and only when the pulse changes.
      'remove:pulse',
      'add:pulse',
    ]);
    calls.length = 0;
    paintClickMoveMarker(el, shown);
    expect(calls).toEqual(['toggle:entity:true', 'toggle:blocked:false', 'toggle:active:true']);
  });
});

describe('tutorial arrow writes', () => {
  type Arrowed = {
    arrow: HTMLElement | null;
    arrowShown: boolean;
    arrowTransform: string;
    step: string | null;
    findEntity: () => { pos: { x: number; y: number; z: number } } | null;
    updateArrow: (world: unknown, renderer: unknown) => void;
  };

  const rig = () => {
    const writes: string[] = [];
    const style = new Proxy({} as Record<string, string>, {
      set(target, prop, value) {
        writes.push(`${String(prop)}=${value}`);
        target[String(prop)] = value;
        return true;
      },
    });
    const tut = Object.create(TutorialOverlay.prototype) as Arrowed;
    tut.arrow = { style } as unknown as HTMLElement;
    tut.arrowShown = false;
    tut.arrowTransform = '';
    tut.step = 'seek';
    let target: { x: number; y: number; z: number } | null = { x: 1, y: 0, z: 1 };
    tut.findEntity = () => (target ? { pos: target } : null);
    // Straight right of the screen centre: angle 0, well inside the clamp margin.
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const screen = { x: cx + 100, y: cy, behind: false };
    const renderer = { worldToScreen: () => screen };
    return {
      cx,
      cy,
      writes,
      style,
      tick: () => tut.updateArrow({}, renderer),
      move: (x: number, y: number) => {
        screen.x = x;
        screen.y = y;
      },
      lose: () => {
        target = null;
      },
    };
  };

  it('positions through one transform, written only when it changes', () => {
    const r = rig();
    r.tick();
    expect(r.writes).toEqual([
      'display=block',
      `transform=translate(${r.cx + 100}px, ${r.cy}px) translate(-50%, -50%) rotate(0rad)`,
    ]);
    r.tick();
    r.tick();
    expect(r.writes).toHaveLength(2);
    r.move(r.cx + 200, r.cy);
    r.tick();
    expect(r.writes).toHaveLength(3);
    expect(r.writes[2]).toBe(
      `transform=translate(${r.cx + 200}px, ${r.cy}px) translate(-50%, -50%) rotate(0rad)`,
    );
    expect(r.style.left).toBeUndefined();
    expect(r.style.top).toBeUndefined();
  });

  it('hides once and stays quiet while hidden, then shows again', () => {
    const r = rig();
    r.tick();
    r.lose();
    r.tick();
    r.tick();
    expect(r.writes.slice(2)).toEqual(['display=none']);
  });
});
