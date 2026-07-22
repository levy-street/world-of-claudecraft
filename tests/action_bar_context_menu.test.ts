// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { ActionBarContextMenu } from '../src/ui/hud/action_bar/action_bar_context_menu';

describe('ActionBarContextMenu', () => {
  it('uses the shared context-menu seam and toggles the live setting', () => {
    const element = document.createElement('div');
    const opener = document.createElement('button');
    let locked = false;
    let activate: ((action: string) => void) | undefined;
    const setLocked = vi.fn((value: boolean) => {
      locked = value;
    });
    const place = vi.fn();
    const setOpener = vi.fn();
    const menu = new ActionBarContextMenu({
      element: () => element,
      locked: () => locked,
      setLocked,
      setOpener,
      place,
      bind: (handler) => {
        activate = handler;
      },
    });

    menu.open(120, 240, opener);

    expect(element.style.display).toBe('block');
    expect(element.textContent).toContain('Lock Action Bars');
    expect(setOpener).toHaveBeenCalledWith(opener);
    expect(place).toHaveBeenCalledWith(element, 120, 240, 220, 120);

    activate?.('toggle-lock');
    expect(setLocked).toHaveBeenCalledWith(true);
  });

  it('closes when the same opener is invoked again', () => {
    const element = document.createElement('div');
    const opener = document.createElement('button');
    const menu = new ActionBarContextMenu({
      element: () => element,
      locked: () => false,
      setLocked: vi.fn(),
      setOpener: vi.fn(),
      place: vi.fn(),
      bind: vi.fn(),
    });

    menu.open(120, 240, opener);
    menu.open(120, 240, opener);

    expect(element.style.display).toBe('none');
  });

  it('does not leave the opener focused after mouse activation', () => {
    const element = document.createElement('div');
    const opener = document.createElement('button');
    document.body.append(opener, element);
    let activate: ((action: string) => void) | undefined;
    const menu = new ActionBarContextMenu({
      element: () => element,
      locked: () => false,
      setLocked: vi.fn(),
      setOpener: vi.fn(),
      place: vi.fn(),
      bind: (handler) => {
        activate = handler;
      },
    });

    menu.open(120, 240, opener);
    activate?.('toggle-lock');

    expect(document.activeElement).not.toBe(opener);
  });

  it.each([
    { key: 'ContextMenu', shiftKey: false },
    { key: 'F10', shiftKey: true },
  ])('opens from $key, focuses the action, and restores the opener focus', ({ key, shiftKey }) => {
    const element = document.createElement('div');
    const opener = document.createElement('button');
    document.body.append(opener, element);
    let activate: ((action: string) => void) | undefined;
    const setLocked = vi.fn();
    const menu = new ActionBarContextMenu({
      element: () => element,
      locked: () => true,
      setLocked,
      setOpener: vi.fn(),
      place: vi.fn(),
      bind: (handler) => {
        activate = handler;
        const item = element.querySelector<HTMLElement>('.ctx-item');
        if (item) item.tabIndex = 0;
      },
    });

    const event = {
      key,
      shiftKey,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    expect(menu.openForKeyboardEvent(event, opener)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(element.textContent).toContain('Unlock Action Bars');
    expect(document.activeElement).toBe(element.querySelector('.ctx-item'));

    activate?.('toggle-lock');
    expect(setLocked).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(opener);
  });

  it('restores keyboard focus when the shared Escape path closes the menu', () => {
    const element = document.createElement('div');
    const opener = document.createElement('button');
    document.body.append(opener, element);
    const menu = new ActionBarContextMenu({
      element: () => element,
      locked: () => false,
      setLocked: vi.fn(),
      setOpener: vi.fn(),
      place: vi.fn(),
      bind: (handler) => {
        void handler;
        const item = element.querySelector<HTMLElement>('.ctx-item');
        if (item) item.tabIndex = 0;
      },
    });
    const event = {
      key: 'ContextMenu',
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    menu.openForKeyboardEvent(event, opener);
    expect(document.activeElement).not.toBe(opener);

    menu.onSharedClose();

    expect(document.activeElement).toBe(opener);
  });

  it('ignores unrelated keys', () => {
    const menu = new ActionBarContextMenu({
      element: () => document.createElement('div'),
      locked: () => false,
      setLocked: vi.fn(),
      setOpener: vi.fn(),
      place: vi.fn(),
      bind: vi.fn(),
    });
    const event = {
      key: 'Enter',
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    expect(menu.openForKeyboardEvent(event, document.createElement('button'))).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
