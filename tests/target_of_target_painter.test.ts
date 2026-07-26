import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PainterHostWriters } from '../src/ui/painter_host';
import { TargetOfTargetPainter } from '../src/ui/target_of_target_painter';
import { targetOfTargetView } from '../src/ui/target_of_target_view';

type Call = { method: keyof PainterHostWriters; args: unknown[] };

function recordingWriters(): { calls: Call[]; writers: PainterHostWriters } {
  const calls: Call[] = [];
  const record =
    (method: keyof PainterHostWriters) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  return {
    calls,
    writers: {
      setText: record('setText') as PainterHostWriters['setText'],
      setDisplay: record('setDisplay') as PainterHostWriters['setDisplay'],
      setTransform: record('setTransform') as PainterHostWriters['setTransform'],
      setWidth: record('setWidth') as PainterHostWriters['setWidth'],
      setStyleProp: record('setStyleProp') as PainterHostWriters['setStyleProp'],
      toggleClass: record('toggleClass') as PainterHostWriters['toggleClass'],
      setAttr: record('setAttr') as PainterHostWriters['setAttr'],
    },
  };
}

const FRAME = { id: 'frame' } as unknown as HTMLElement;
const NAME = { id: 'name' } as unknown as HTMLElement;
const HP = { id: 'hp' } as unknown as HTMLElement;

describe('TargetOfTargetPainter', () => {
  it('reuses UnitFramePainter and preserves the localized role context', () => {
    const { calls, writers } = recordingWriters();
    const repaintPortrait = vi.fn();
    const painter = new TargetOfTargetPainter(
      writers,
      { frame: FRAME, name: NAME, hpFill: HP },
      {
        resolveAccent: (accent, classId) => `${accent}:${classId}`,
        repaintPortrait,
      },
    );
    const view = targetOfTargetView(
      {
        id: 7,
        kind: 'mob',
        templateId: 'forest_wolf',
        hostile: true,
        dead: false,
        hp: 33,
        maxHp: 100,
      },
      1,
      {
        name: 'Forest Wolf',
        accessibleLabel: "Mark's Mark: Forest Wolf",
        portraitKey: '7:base',
      },
    );

    painter.paint(view);

    expect(calls).toContainEqual({ method: 'setText', args: [NAME, 'Forest Wolf'] });
    expect(calls).toContainEqual({ method: 'setTransform', args: [HP, 'scaleX(0.33)'] });
    expect(calls).toContainEqual({
      method: 'setStyleProp',
      args: [FRAME, '--tot-accent', 'hostile:forest_wolf'],
    });
    expect(calls).toContainEqual({
      method: 'setAttr',
      args: [FRAME, 'aria-label', "Mark's Mark: Forest Wolf"],
    });
    expect(calls).toContainEqual({
      method: 'setAttr',
      args: [FRAME, 'title', "Mark's Mark: Forest Wolf"],
    });
    expect(repaintPortrait).toHaveBeenCalledWith(7);
  });

  it('uses the shared hidden-frame path and removes the button from tab order', () => {
    const { calls, writers } = recordingWriters();
    const painter = new TargetOfTargetPainter(
      writers,
      { frame: FRAME, name: NAME, hpFill: HP },
      { resolveAccent: () => '', repaintPortrait: () => {} },
    );

    painter.paint(targetOfTargetView(null, 1, null));

    expect(calls).toContainEqual({ method: 'setDisplay', args: [FRAME, 'none'] });
    expect(calls).toContainEqual({ method: 'setAttr', args: [FRAME, 'aria-hidden', 'true'] });
    expect(calls).toContainEqual({ method: 'setAttr', args: [FRAME, 'tabindex', '-1'] });
  });

  it('routes hot writes through the painter family without raw DOM writes', () => {
    const source = readFileSync(
      new URL('../src/ui/target_of_target_painter.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('new UnitFramePainter');
    expect(source).not.toMatch(/\.textContent\b|\.style\b|\.classList\b|\.setAttribute\b/);
  });
});
