// @vitest-environment happy-dom
// The death screen's PvP Resurrect painter (src/ui/hud/death/pvp_resurrect_painter.ts):
// while the wait runs the button is disabled and counts down and the note line names
// the wait and the graveyard; once it is over the button is plain and pressable and
// the note says it is ready. Hidden with the offer. Writes ride the elided writers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDeathPromptView,
  PvpResurrectPrompt,
  updateDeathPromptView,
} from '../src/ui/hud/death';
import type { PainterHostWriters } from '../src/ui/painter_host';

function mount() {
  document.body.innerHTML =
    '<button id="pvp-resurrect-btn" style="display: none">PvP Resurrect</button>' +
    '<p id="pvp-resurrect-note" style="display: none"></p>';
  const writes: string[] = [];
  const writers: Pick<PainterHostWriters, 'setAttr' | 'setStyleProp' | 'setText'> = {
    setText: (el, text) => {
      if (el.textContent === text) return;
      el.textContent = text;
      writes.push(`text:${el.id}`);
    },
    setStyleProp: (el, prop, value) => {
      if (el.style.getPropertyValue(prop) === value) return;
      el.style.setProperty(prop, value);
      writes.push(`style:${el.id}:${prop}`);
    },
    setAttr: (el, name, value) => {
      if (el.getAttribute(name) === value) return;
      if (value === null) el.removeAttribute(name);
      else el.setAttribute(name, value);
      writes.push(`attr:${el.id}:${name}`);
    },
  };
  const press = vi.fn();
  const prompt = new PvpResurrectPrompt(writers, press);
  const button = document.getElementById('pvp-resurrect-btn') as HTMLButtonElement;
  const note = document.getElementById('pvp-resurrect-note') as HTMLElement;
  return { prompt, button, note, writes, press };
}

const at = { x: 0, z: 0 };

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PvpResurrectPrompt', () => {
  it('counts the wait down on a disabled button and names the graveyard', () => {
    const { prompt, button, note } = mount();
    const view = createDeathPromptView();
    prompt.paint(updateDeathPromptView(view, true, false, false, false, at, null, true, 15));
    expect(button.style.display).toBe('');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('PvP Resurrect (15 seconds)');
    expect(note.style.display).toBe('');
    expect(note.textContent).toBe(
      'You can PvP Resurrect in 15 seconds: you will rise at the nearest graveyard.',
    );
    prompt.paint(updateDeathPromptView(view, true, false, false, false, at, null, true, 0.4));
    expect(button.textContent).toBe('PvP Resurrect (1 second)');
  });

  it('enables the button once the wait is over, and the press reaches the world', () => {
    const { prompt, button, note, press } = mount();
    const view = createDeathPromptView();
    prompt.paint(updateDeathPromptView(view, true, false, false, false, at, null, true, 3));
    button.click();
    expect(press, 'a press mid-wait goes nowhere').not.toHaveBeenCalled();
    prompt.paint(updateDeathPromptView(view, true, false, false, false, at, null, true, 0));
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('PvP Resurrect');
    expect(note.textContent).toBe(
      'PvP Resurrect is ready: you will rise at the nearest graveyard.',
    );
    button.click();
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('hides both with the offer, and a repeated frame writes nothing', () => {
    const { prompt, button, note, writes } = mount();
    const view = createDeathPromptView();
    prompt.paint(updateDeathPromptView(view, true, false, false, false, at, null, true, 7));
    writes.length = 0;
    prompt.paint(updateDeathPromptView(view, true, false, false, false, at, null, true, 6.6));
    expect(writes, 'the same whole second').toEqual([]);
    prompt.paint(updateDeathPromptView(view, true, false, false, false, at, null, false));
    expect(button.style.display).toBe('none');
    expect(note.style.display).toBe('none');
  });
});
