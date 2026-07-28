// @vitest-environment jsdom
// DOM-level painter test for the Last Bell scene overlay window (C0 cinematic
// mode): the painter toggles the `cinematic-mode` HUD-root class on <body> from
// the model's `cinematic` flag, through the elided PainterHost writer. A recording
// facet captures every writer call so we assert the toggle targets document.body
// with the right on/off state (the class lands on <body> because #nameplates and
// the mobile controls are siblings of #ui, not descendants).

import { beforeEach, describe, expect, it } from 'vitest';
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
});
