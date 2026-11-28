// @vitest-environment happy-dom
// The shared encounter alert painter (src/ui/hud/dungeon/encounter_alert_painter.ts):
// a view with no line hides the line's row (the Smith's Heart's short alerts,
// the owner's rule of 2026-11-03, kept on 2026-11-09), a view with one shows
// it again, and a repeat paint of the same frame writes nothing.

import { describe, expect, it } from 'vitest';
import { EncounterAlert } from '../src/ui/hud/dungeon/encounter_alert_painter';
import type { EncounterAlertLive } from '../src/ui/hud/dungeon/encounter_alert_view';
import { makeWriterFacet } from '../src/ui/painter_host';

function view(line: string): EncounterAlertLive {
  return {
    visible: true,
    kind: 'rock',
    title: 'Falling Rock!',
    line,
    hint: '',
    key: '',
    progress: 0.5,
    progressAria: '3 seconds left',
    barLabel: '3s',
    pressable: false,
    buttonAria: 'Falling Rock!',
  };
}

describe('encounter alert painter: the line row', () => {
  it('hides an empty line, shows a real one, and elides a repeat frame', () => {
    const layer = document.createElement('div');
    document.body.appendChild(layer);
    const counts = { writes: 0 };
    const writers = makeWriterFacet(
      new Map(),
      new WeakMap(),
      new WeakMap(),
      new WeakMap(),
      () => {
        counts.writes++;
      },
      () => {},
    );
    const alert = new EncounterAlert(
      { layer: () => layer, writers, onPress: () => {} },
      { id: 'test-alert', className: 'test-alert', kinds: ['rock'] },
    );
    const line = () => layer.querySelector<HTMLElement>('#test-alert .fa-line');
    const label = () => layer.querySelector<HTMLElement>('#test-alert .fa-bar-label');

    alert.paint(view(''));
    expect(line()?.style.display).toBe('none');
    expect(label()?.textContent).toBe('3s');
    expect(label()?.style.display).toBe('block');

    alert.paint(view('Stand together'));
    expect(line()?.style.display).toBe('block');
    expect(line()?.textContent).toBe('Stand together');

    alert.paint(view(''));
    expect(line()?.style.display).toBe('none');

    const before = counts.writes;
    alert.paint(view(''));
    expect(counts.writes).toBe(before);
    alert.dispose();
  });
});
