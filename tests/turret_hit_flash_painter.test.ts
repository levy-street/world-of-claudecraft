import { describe, expect, it, vi } from 'vitest';
import type { TurretHitFrame } from '../src/ui/hud/vehicle/turret_hit_feedback_core';
import { TurretHitFlashPainter } from '../src/ui/hud/vehicle/turret_hit_flash_painter';
import type { PainterHostWriters } from '../src/ui/painter_host';

function spyWriters() {
  const writers = {
    setText: vi.fn(),
    setDisplay: vi.fn(),
    setTransform: vi.fn(),
    setWidth: vi.fn(),
    setStyleProp: vi.fn(),
    toggleClass: vi.fn(),
    setAttr: vi.fn(),
  } satisfies PainterHostWriters;
  const calls = () => Object.values(writers).reduce((n, spy) => n + spy.mock.calls.length, 0);
  const clear = () => {
    for (const spy of Object.values(writers)) spy.mockClear();
  };
  return { writers, calls, clear };
}

const overlay = { id: 'overlay' } as unknown as HTMLElement;
const gauge = { id: 'gauge' } as unknown as HTMLElement;

const idle = (): TurretHitFrame => ({
  active: false,
  flash: 0,
  glow: 0,
  shake: 0,
  cameraShake: 0,
});

const flashing = (): TurretHitFrame => ({
  active: true,
  flash: 0.45,
  glow: 0.5,
  shake: -0.25,
  cameraShake: 0,
});

describe('turret hit flash painter', () => {
  it('writes nothing before the first strike', () => {
    const { writers, calls } = spyWriters();
    const painter = new TurretHitFlashPainter(writers, overlay, gauge);
    for (let i = 0; i < 10; i++) painter.paint(idle());
    expect(calls()).toBe(0);
  });

  it('shows the overlay and drives the flash, glow and swing while a strike flashes', () => {
    const { writers } = spyWriters();
    new TurretHitFlashPainter(writers, overlay, gauge).paint(flashing());
    expect(writers.setDisplay.mock.calls).toEqual([[overlay, '']]);
    expect(writers.setStyleProp.mock.calls).toEqual([
      [overlay, '--turret-hit-flash', '0.450'],
      [gauge, '--turret-hit-glow', '0.500'],
      [gauge, '--turret-hit-shake', '-0.250'],
    ]);
  });

  it('clears everything on the frame the flash ends, then writes nothing until the next strike', () => {
    const { writers, calls, clear } = spyWriters();
    const painter = new TurretHitFlashPainter(writers, overlay, gauge);
    painter.paint(flashing());
    clear();
    painter.paint(idle());
    expect(writers.setDisplay.mock.calls).toEqual([[overlay, 'none']]);
    expect(writers.setStyleProp.mock.calls).toEqual([
      [overlay, '--turret-hit-flash', '0.000'],
      [gauge, '--turret-hit-glow', '0.000'],
      [gauge, '--turret-hit-shake', '0.000'],
    ]);
    clear();
    for (let i = 0; i < 10; i++) painter.paint(idle());
    expect(calls()).toBe(0);
    painter.paint(flashing());
    expect(writers.setDisplay.mock.calls).toEqual([[overlay, '']]);
  });
});
