// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { Settings } from '../src/game/settings';
import { FrameContextMenu } from '../src/ui/frame_context_menu';
import { chatFrameContextTargets, frameEditorMenuDeps } from '../src/ui/frame_editor_deps';
import { frameMenuGroup, frameSettingRelated } from '../src/ui/frame_menu_core';
import { interfaceResetKeys } from '../src/ui/interface_reset_keys';
import { InterfaceUnlock, type UnlockEntry } from '../src/ui/interface_unlock';
import type { MovableFrame } from '../src/ui/movable_frame';
import { OptionsFrameSections } from '../src/ui/options_frame_settings';
import type { OptionsControl } from '../src/ui/options_view';

function entry(id: string): UnlockEntry {
  const frame = document.createElement('div');
  const handle = document.createElement('button');
  handle.className = 'tf-move-btn';
  frame.appendChild(handle);
  document.getElementById('ui')!.appendChild(frame);
  return {
    id,
    isActive: () => true,
    mover: {
      frameElement: frame,
      labelText: () => id,
      isUserHidden: false,
      setLockState: vi.fn(),
      setUserHidden: vi.fn(),
      resetSize: vi.fn(),
    } as unknown as MovableFrame,
  };
}

describe('frame menus', () => {
  it('offers frame controls without the general health text choices', () => {
    const settings = new Settings();
    const onSettingChange = vi.fn();
    const deps = frameEditorMenuDeps(
      () => ({ settings, onSettingChange }),
      () => {},
    );
    const toggles = deps.settingToggles!();
    for (const id of [
      'showTargetOfTarget',
      'showTargetSwingTimer',
      'aurasOnPlayerFrame',
      'auraBarBelowFrame',
      'alwaysShowAllBuffs',
    ])
      expect(toggles.some((row) => row.id === id)).toBe(true);
    expect(deps.settingSelects!().some((row) => row.id === 'playerFrameHealthText')).toBe(false);
    expect(deps.settingSelects!().some((row) => row.id === 'targetFrameHealthText')).toBe(false);
    expect(frameSettingRelated('playerFrame', 'playerFrameHealthText')).toBe(false);
    expect(frameSettingRelated('targetFrame', 'targetFrameHealthText')).toBe(false);
    expect(settings.get('showEmptyFocusFrames')).toBe(false);
    toggles.find((row) => row.id === 'showEmptyFocusFrames')!.set(true);
    expect(settings.get('showEmptyFocusFrames')).toBe(true);
    expect(
      [...toggles, ...deps.settingSelects!()].some((row) => row.id.startsWith('partyFrame')),
    ).toBe(false);
    toggles.find((row) => row.id === 'showTargetOfTarget')!.set(false);
    expect(settings.get('showTargetOfTarget')).toBe(false);
    expect(onSettingChange).toHaveBeenCalledWith('showTargetOfTarget', false);
  });

  it('hides frames through their context menu and restores chat through the visibility menu', () => {
    document.body.innerHTML = '<div id="ui"><div id="chatlog-wrap"></div></div>';
    const targets = () =>
      chatFrameContextTargets(
        document,
        () => {},
        () => true,
      );
    const unlock = new InterfaceUnlock({
      document,
      contextTargets: targets,
      openFrameOptions: () => {},
    });
    const row = entry('targetFrame');
    unlock.register(row);
    unlock.setUnlocked(true);
    row.mover.frameElement.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    const hide = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent === 'Hide Frame',
    )!;
    hide.click();
    expect(row.mover.setUserHidden).toHaveBeenCalledWith(true);
    const chat = document.getElementById('chatlog-wrap')!;
    chat.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((el) => el.textContent === 'Hide Frame')!
      .click();
    expect(localStorage.getItem('woc_chat_frame_hidden')).toBe('1');
    document.getElementById('interface-visibility-toggle')!.click();
    document.querySelector<HTMLInputElement>('[data-focus-key="chat"]')!.click();
    expect(chat.classList.contains('frame-user-hidden')).toBe(false);
    expect(localStorage.getItem('woc_chat_frame_hidden')).toBeNull();
    unlock.setUnlocked(false);
  });

  it('keeps visibility separate from settings and preserves collapsed groups through refresh', () => {
    document.body.innerHTML = '<div id="ui"></div>';
    const unlock = new InterfaceUnlock({ document });
    for (const id of [
      'targetFrame',
      'actionBar1',
      'questTracker',
      'auraTrack_buffs',
      'damageMeter',
      'minimap',
    ])
      unlock.register(entry(id));
    unlock.setUnlocked(true);
    document.getElementById('interface-visibility-toggle')!.click();
    const menu = document.getElementById('interface-visibility-menu')!;
    expect(menu.hidden).toBe(false);
    expect(document.getElementById('interface-frames-menu')!.hidden).toBe(true);
    expect([...menu.querySelectorAll('summary')].map((el) => el.textContent)).toEqual([
      'Unit Frames',
      'Action Bars',
      'Trackers',
      'Auras',
      'Combat Displays',
      'Other HUD Elements',
    ]);
    menu.querySelector('details')!.open = false;
    unlock.refresh();
    expect(menu.querySelector('details')!.open).toBe(false);
    document.getElementById('interface-frames-toggle')!.click();
    expect(menu.hidden).toBe(true);
    expect(document.getElementById('interface-frames-menu')!.hidden).toBe(false);
    unlock.setUnlocked(false);
    expect(document.getElementById('interface-edit-controls')!.hidden).toBe(true);
  });

  it('routes mouse and keyboard shortcuts to the innermost frame only in edit mode', () => {
    document.body.innerHTML = '<div id="ui"></div>';
    const outer = entry('targetFrame');
    const inner = entry('targetOfTarget');
    outer.mover.frameElement.appendChild(inner.mover.frameElement);
    let unlocked = false;
    const reset = vi.fn();
    const options = vi.fn();
    const social = vi.fn();
    inner.mover.frameElement.addEventListener('contextmenu', social);
    const menu = new FrameContextMenu({
      document,
      targets: () =>
        [outer, inner].map((row) => ({
          id: row.id,
          element: row.mover.frameElement,
          label: () => row.mover.labelText(),
          isActive: row.isActive,
          resetSize: () => reset(row),
        })),
      unlocked: () => unlocked,
      options,
    });
    const context = () =>
      inner.mover.frameElement.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    context();
    expect(social).toHaveBeenCalledTimes(1);
    expect(document.getElementById('frame-context-menu')).toBeNull();
    unlocked = true;
    context();
    expect(social).toHaveBeenCalledTimes(1);
    expect(document.getElementById('frame-context-menu')!.getAttribute('aria-label')).toBe(
      'targetOfTarget',
    );
    (document.activeElement as HTMLElement).click();
    expect(reset).toHaveBeenCalledWith(inner);
    expect(document.activeElement).toBe(inner.mover.frameElement.firstChild);
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }),
    );
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    (document.activeElement as HTMLElement).click();
    expect(options).toHaveBeenCalledWith('targetOfTarget');
    context();
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(document.getElementById('frame-context-menu')).toBeNull();
    inner.isActive = () => false;
    context();
    expect(document.getElementById('frame-context-menu')!.getAttribute('aria-label')).toBe(
      'targetFrame',
    );
    unlocked = false;
    menu.close();
  });

  it('collapses all party controls together and shares live settings including combined orientation', () => {
    document.body.innerHTML = '<div id="ui"><div id="body"></div></div>';
    const body = document.getElementById('body')!;
    const values: Record<string, number | boolean> = { partyFrameColumns: 2, partyFrameSpacing: 4 };
    const changed = vi.fn();
    const hooks = {
      settings: {
        get: (key: string) => values[key],
        set: (key: string, value: number | boolean) => (values[key] = value),
      },
      onSettingChange: changed,
    };
    const controls: OptionsControl[] = [
      {
        control: 'boolToggle',
        key: 'partyFrameShowPets',
        labelKey: 'hudChrome.partyFrames.optionsSection',
        on: true,
      },
      {
        control: 'boolToggle',
        key: 'mouseoverCast',
        labelKey: 'hudChrome.options.mouseoverCast',
        on: true,
      },
    ];
    const sections = new OptionsFrameSections();
    const render = (id: string | null = null) => {
      body.replaceChildren();
      sections.render(
        body,
        controls,
        hooks,
        id,
        (root, rows) => {
          for (const row of rows) {
            const div = document.createElement('div');
            if ('key' in row) div.dataset.settingKey = row.key;
            root.appendChild(div);
          }
        },
        () => {},
      );
    };
    render();
    const party = body.querySelector<HTMLDetailsElement>('.interface-party-options')!;
    expect(party.open).toBe(false);
    expect(party.parentElement).toBe(body);
    expect(body.querySelector('.interface-frame-options')!.contains(party)).toBe(false);
    expect(party.querySelector('[data-setting-key="partyFrameShowPets"]')).toBeTruthy();
    expect(party.querySelector('[data-focus-key="partyFrameColumns"]')).toBeTruthy();
    expect(party.querySelector('[data-setting-key="mouseoverCast"]')).toBeNull();
    expect(
      body.querySelector('.interface-frame-options [data-setting-key="mouseoverCast"]'),
    ).toBeTruthy();
    party.open = true;
    render();
    expect(body.querySelector<HTMLDetailsElement>('.interface-party-options')!.open).toBe(true);
    const combine = body.querySelector<HTMLInputElement>('[data-focus-key="combineActionBars"]')!;
    combine.click();
    expect(values.combineActionBars).toBe(true);
    body.querySelector<HTMLInputElement>('[data-focus-key="actionBarsVertical"]')!.click();
    expect([
      values.actionBar1Vertical,
      values.actionBar2Vertical,
      values.actionBar3Vertical,
    ]).toEqual([true, true, true]);
    render('targetOfTarget');
    expect(body.querySelector('[data-focus-key="moveTargetOfTargetIndependently"]')).toBeTruthy();
    expect(body.querySelector('[data-focus-key="combineActionBars"]')).toBeNull();
    expect(changed).toHaveBeenCalledWith('actionBar3Vertical', true);
  });

  it('maps frame families and excludes unrelated reset settings', () => {
    expect(frameMenuGroup('focusTarget2')).toBe('units');
    expect(frameMenuGroup('reliquaryTracker')).toBe('trackers');
    expect(frameSettingRelated('targetFrame', 'moveTargetOfTargetIndependently')).toBe(true);
    expect(frameSettingRelated('targetFrame', 'partyFrameWidth')).toBe(false);
    expect(interfaceResetKeys('frames', 'targetOfTarget', ['showTargetOfTarget'])).toEqual([
      'showTargetOfTarget',
      'frameSnapToGrid',
      'moveTargetOfTargetIndependently',
    ]);
    expect(frameMenuGroup('swingBarOffhand')).toBe('combat');
    expect(frameSettingRelated('actionBarGroup', 'showSecondaryActionBar')).toBe(true);
    expect(frameSettingRelated('auraGroup', 'showTargetDots')).toBe(true);
    expect(frameSettingRelated('trackerGroup', 'showDelveTracker')).toBe(true);
  });
});
