// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CinematicCameraCapture,
  createCinematicCameraCapture,
} from '../src/editor/cinematic_capture_core';
import { CinematicPanel } from '../src/editor/cinematic_panel';
import { registeredSceneIds, type SceneDef } from '../src/sim/scenes/registry';
import { WORLD_SEED } from '../src/world_seed.mjs';

beforeEach(() => {
  document.body.innerHTML = '<div id="viewport"></div>';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('editor Cinematic panel', () => {
  it('lists scenes, clears loading state, seeks on the fixed clock, and paints fade', () => {
    const evaluate = vi.fn((_scene, timeSec: number) => ({
      timeSec,
      camera: null,
      subject: null,
      propCues: [],
      overlay: {
        fadeOpacity: 0.5,
        letterbox: true,
        cinematic: true,
      },
      violations: [
        {
          sceneId: 'scene',
          check: 'support.entity' as const,
          opIndex: 7,
          opKind: 'actorMove',
          time: timeSec,
          threshold: 'supported',
          measured: 'actor is 1.25 yd above terrain',
        },
      ],
    }));
    const parent = requiredElement('viewport');
    const panel = new CinematicPanel(parent, {
      evaluate,
      setAuthoredCamera: vi.fn(),
      capture: vi.fn(() => null),
      saveCapture: vi.fn(() => Promise.resolve()),
    });

    expect(parent.querySelector('[role="status"]')?.textContent).toBe('3D viewport loading');
    panel.setReady(true);

    const select = requiredQuery<HTMLSelectElement>(parent, 'select');
    expect([...select.options].map((option) => option.value)).toEqual(registeredSceneIds());
    expect(parent.querySelector('[role="status"]')?.textContent).toBe('');
    expect(requiredQuery<HTMLElement>(parent, '.ed-cinematic-fade').style.opacity).toBe('0.5');
    expect(parent.textContent).toContain('Letterbox: on');
    expect(parent.textContent).toContain('support.entity | op 7 | actor is 1.25 yd above terrain');

    const range = requiredQuery<HTMLInputElement>(parent, 'input[type="range"]');
    range.value = '1.07';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    expect(evaluate.mock.calls.at(-1)?.[1]).toBeCloseTo(1.05);

    panel.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it('captures, copies, and saves the marked generated block from the selected scene', async () => {
    const sceneId = registeredSceneIds()[0];
    if (!sceneId) throw new Error('expected registered scene');
    const capture = createCinematicCameraCapture({
      sceneId,
      timeSec: 0,
      seed: WORLD_SEED,
      capturedAt: '2026-07-30T01:02:03.000Z',
      pose: {
        position: { x: 1, y: 3, z: 2 },
        target: { x: 4, y: 6, z: 5 },
      },
      groundY: () => 0,
    });
    if (!capture) throw new Error('expected capture');
    const writeText = vi.fn((_source: string) => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const saveCapture = vi.fn((_capture: CinematicCameraCapture) => Promise.resolve());
    const captureCurrent = vi.fn(
      (_scene: SceneDef, _timeSec: number, _capturedAt: string) => capture,
    );
    const parent = requiredElement('viewport');
    const panel = new CinematicPanel(parent, {
      evaluate: (_scene, timeSec) => ({
        timeSec,
        camera: null,
        subject: null,
        propCues: [],
        overlay: { fadeOpacity: 0, letterbox: false, cinematic: true },
        violations: [],
      }),
      setAuthoredCamera: vi.fn(),
      capture: captureCurrent,
      saveCapture,
    });
    panel.setReady(true);

    requiredButton(parent, 'Capture keyframe').click();
    await vi.waitFor(() => expect(saveCapture).toHaveBeenCalledWith(capture));

    expect(captureCurrent).toHaveBeenCalledOnce();
    expect(captureCurrent.mock.calls[0]?.[2]).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0]?.[0]).toContain('// BEGIN GENERATED CINEMATIC CAMERA CAPTURE');
    expect(requiredQuery<HTMLTextAreaElement>(parent, 'textarea').value).toContain(
      `seed: ${WORLD_SEED}`,
    );
    expect(parent.querySelector('[role="status"]')?.textContent).toBe('Saved and copied');
    panel.dispose();
  });
});

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element;
}

function requiredQuery<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
}

function requiredButton(parent: ParentNode, text: string): HTMLButtonElement {
  const button = [...parent.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!button) throw new Error(`missing button ${text}`);
  return button;
}
