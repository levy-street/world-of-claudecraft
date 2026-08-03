// @vitest-environment jsdom
// DOM-level painter test for the Last Bell scene overlay window (C0 cinematic
// mode): the painter toggles the `cinematic-mode` HUD-root class on <body> from
// the model's `cinematic` flag, through the elided PainterHost writer. A recording
// facet captures every writer call so we assert the toggle targets document.body
// with the right on/off state (the class lands on <body> because #nameplates and
// the mobile controls are siblings of #ui, not descendants).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneOverlayModel } from '../src/ui/hud/scene/scene_overlay_view';
import { SceneOverlayWindow } from '../src/ui/hud/scene/scene_overlay_window';
import type { PainterHostWriters } from '../src/ui/painter_host';

type Call = { m: keyof PainterHostWriters; args: unknown[] };

function recordingFacet() {
  const calls: Call[] = [];
  const writers: PainterHostWriters = {
    setText: (el, text) => {
      calls.push({ m: 'setText', args: [el, text] });
    },
    setDisplay: (el, display) => {
      calls.push({ m: 'setDisplay', args: [el, display] });
    },
    setTransform: (el, transform) => {
      calls.push({ m: 'setTransform', args: [el, transform] });
    },
    setWidth: (el, width) => {
      calls.push({ m: 'setWidth', args: [el, width] });
    },
    setStyleProp: (el, prop, value) => {
      calls.push({ m: 'setStyleProp', args: [el, prop, value] });
    },
    toggleClass: (el, cls, on) => {
      calls.push({ m: 'toggleClass', args: [el, cls, on] });
    },
    setAttr: (el, name, value) => {
      calls.push({ m: 'setAttr', args: [el, name, value] });
    },
  };
  return { calls, writers };
}

function model(over: Partial<SceneOverlayModel> = {}): SceneOverlayModel {
  return {
    letterbox: false,
    skipHintVisible: false,
    speakerKey: null,
    lineKey: null,
    announcementId: 0,
    fadeOpacity: 0,
    cinematic: false,
    ...over,
  };
}

describe('SceneOverlayWindow: cinematic-mode class toggle (C0 HUD hide)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    container = document.createElement('div');
    container.id = 'ui';
    document.body.appendChild(container);
  });

  function makeWindow() {
    const { calls, writers } = recordingFacet();
    const window = new SceneOverlayWindow({
      document,
      container,
      writers,
      onSkip: () => {},
    });
    // Drop the construction-time calls (there are none through the facet today,
    // but keep the assertion about paint-time writes honest regardless).
    calls.length = 0;
    return { window, calls };
  }

  function cinematicToggle(calls: Call[]) {
    return calls.filter((c) => c.m === 'toggleClass' && c.args[1] === 'cinematic-mode');
  }

  it('toggles cinematic-mode ON on <body> while the scene is active', () => {
    const { window, calls } = makeWindow();
    window.paint(model({ cinematic: true }));
    const toggles = cinematicToggle(calls);
    expect(toggles).toHaveLength(1);
    expect(toggles[0].args[0]).toBe(document.body);
    expect(toggles[0].args[2]).toBe(true);
  });

  it('toggles cinematic-mode OFF on <body> when the scene is not active (end/idle)', () => {
    const { window, calls } = makeWindow();
    window.paint(model({ cinematic: false }));
    const toggles = cinematicToggle(calls);
    expect(toggles).toHaveLength(1);
    expect(toggles[0].args[0]).toBe(document.body);
    expect(toggles[0].args[2]).toBe(false);
  });

  it('targets <body>, never the #ui container (the hidden roots are siblings of #ui)', () => {
    const { window, calls } = makeWindow();
    window.paint(model({ cinematic: true }));
    const toggles = cinematicToggle(calls);
    expect(toggles[0].args[0]).not.toBe(container);
  });

  it('exposes dialogue through a polite atomic live region', () => {
    makeWindow();
    const live = container.querySelector('.scene-subtitle-live');
    expect(live?.classList.contains('visually-hidden')).toBe(true);
    expect(live?.getAttribute('role')).toBe('status');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.getAttribute('aria-atomic')).toBe('true');
    expect(container.querySelector('.scene-subtitle')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('announces each occurrence once and byte-marks repeated identical dialogue', () => {
    const { window, calls } = makeWindow();
    const line = model({
      lineKey: 'hudChrome.scene.skipHint',
      announcementId: 1,
    });
    window.paint(line);
    window.paint(line);
    window.paint({ ...line, announcementId: 2 });

    const live = container.querySelector('.scene-subtitle-live');
    const announcements = calls.filter((call) => call.m === 'setText' && call.args[0] === live);
    expect(announcements).toHaveLength(2);
    expect(announcements[0].args[1]).toBe('Skip scene (Esc)');
    expect(announcements[1].args[1]).not.toBe(announcements[0].args[1]);
    expect(String(announcements[1].args[1]).trim()).toBe('Skip scene (Esc)');
  });

  it('formats fade opacity only when the numeric opacity changes', () => {
    const { window, calls } = makeWindow();
    const toFixed = vi.spyOn(Number.prototype, 'toFixed');
    try {
      const idle = model();
      window.paint(idle);
      window.paint(idle);
      window.paint(model({ fadeOpacity: 0.5 }));
      expect(toFixed).toHaveBeenCalledTimes(2);
    } finally {
      toFixed.mockRestore();
    }

    const fade = container.querySelector('.scene-fade');
    const writes = calls.filter(
      (call) => call.m === 'setStyleProp' && call.args[0] === fade && call.args[1] === 'opacity',
    );
    expect(writes.map((call) => call.args[2])).toEqual(['0.000', '0.500']);
  });

  it('owns the fade layer display inline: hidden at rest, revealed while fading', () => {
    const { window, calls } = makeWindow();
    const fade = container.querySelector('.scene-fade') as HTMLElement;
    // Resting state is an INLINE none set at construction, never a stylesheet
    // rule: setDisplay('') clears the inline value to reveal, so a class-level
    // display:none would win forever (the bug that shipped the voyage with no
    // fades at all).
    expect(fade.style.display).toBe('none');
    window.paint(model({ fadeOpacity: 0.5 }));
    const displays = calls.filter((call) => call.m === 'setDisplay' && call.args[0] === fade);
    expect(displays.map((call) => call.args[1])).toEqual(['']);
    window.paint(model({ fadeOpacity: 0 }));
    const after = calls.filter((call) => call.m === 'setDisplay' && call.args[0] === fade);
    expect(after.map((call) => call.args[1])).toEqual(['', 'none']);
  });

  it('the stylesheet never declares display for the painter-owned scene layers', () => {
    // The reveal contract above only works if the class rules leave display
    // alone. jsdom never loads the stylesheet, so pin the source directly.
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/styles/hud.css'),
      'utf8',
    );
    const withoutComments = css.replace(/\/\*[^]*?\*\//g, '');
    for (const selector of ['.scene-fade', '.scene-subtitle']) {
      const start = withoutComments.indexOf(`${selector} {`);
      expect(start, `${selector} rule present`).toBeGreaterThan(-1);
      const body = withoutComments.slice(start, withoutComments.indexOf('}', start));
      expect(body.includes('display:'), `${selector} must not declare display`).toBe(false);
    }
  });
});
