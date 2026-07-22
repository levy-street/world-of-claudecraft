import { describe, expect, it } from 'vitest';
import {
  createTargetFocus,
  FOCUS_LEAN_MAX,
  selectionPulse,
  stepTargetFocus,
  TARGET_PULSE_DURATION,
} from '../src/render/target_focus_core';

// Target-acquisition presentation: the selection flourish pulse and the
// camera's micro focus lean toward the held target.

const DT = 1 / 60;

describe('selection flourish pulse', () => {
  it('pulses on acquire and settles within the pulse duration', () => {
    const s = createTargetFocus();
    stepTargetFocus(s, 7, 5, 0, 0, DT, true);
    const start = selectionPulse(s);
    expect(start.scale).toBeGreaterThan(1.3);
    expect(start.glow).toBeGreaterThan(0.7);
    expect(start.spin).toBeGreaterThan(5);
    for (let i = 0; i < Math.ceil(TARGET_PULSE_DURATION / DT) + 2; i++) {
      stepTargetFocus(s, 7, 5, 0, 0, DT, true);
    }
    const settled = selectionPulse(s);
    expect(settled.scale).toBe(1);
    expect(settled.glow).toBe(0);
    expect(settled.spin).toBe(0);
  });

  it('re-pulses on a target SWITCH, never for the held target', () => {
    const s = createTargetFocus();
    for (let i = 0; i < 30; i++) stepTargetFocus(s, 7, 5, 0, 0, DT, true);
    expect(selectionPulse(s).glow).toBe(0);
    stepTargetFocus(s, 7, 5, 0, 0, DT, true); // same target: still settled
    expect(selectionPulse(s).glow).toBe(0);
    stepTargetFocus(s, 9, 5, 0, 0, DT, true); // tab to a new target
    expect(selectionPulse(s).glow).toBeGreaterThan(0.7);
  });

  it('a frame hitch at acquisition cannot swallow the pulse', () => {
    const s = createTargetFocus();
    stepTargetFocus(s, 7, 5, 0, 0, 0.25, true); // one clamped hitch frame
    expect(selectionPulse(s).glow).toBeGreaterThan(0.5);
  });

  it('never pulses under reduced motion', () => {
    const s = createTargetFocus();
    stepTargetFocus(s, 7, 5, 0, 0, DT, false);
    const p = selectionPulse(s);
    expect(p.scale).toBe(1);
    expect(p.glow).toBe(0);
    expect(p.spin).toBe(0);
  });
});

describe('focus lean', () => {
  it('leans toward a flanking target and stays capped', () => {
    const s = createTargetFocus();
    // Camera faces +z (yaw 0); target due +x (90 degrees off center).
    for (let i = 0; i < 300; i++) stepTargetFocus(s, 7, 10, 0, 0, DT, true);
    expect(s.focusX).toBeGreaterThan(FOCUS_LEAN_MAX * 0.6);
    expect(s.focusX).toBeLessThanOrEqual(FOCUS_LEAN_MAX + 1e-9);
    expect(Math.abs(s.focusZ)).toBeLessThan(1e-6);
  });

  it('gives a dead-centered target no lean', () => {
    const s = createTargetFocus();
    // Camera faces +z; target straight ahead.
    for (let i = 0; i < 300; i++) stepTargetFocus(s, 7, 0, 10, 0, DT, true);
    expect(Math.hypot(s.focusX, s.focusZ)).toBeLessThan(1e-3);
  });

  it('eases home on deselect and under reduced motion', () => {
    const s = createTargetFocus();
    for (let i = 0; i < 120; i++) stepTargetFocus(s, 7, 10, 0, 0, DT, true);
    expect(s.focusX).toBeGreaterThan(0.1);
    for (let i = 0; i < 240; i++) stepTargetFocus(s, null, 0, 0, 0, DT, true);
    expect(Math.hypot(s.focusX, s.focusZ)).toBeLessThan(0.01);

    const r = createTargetFocus();
    for (let i = 0; i < 120; i++) stepTargetFocus(r, 7, 10, 0, 0, DT, true);
    for (let i = 0; i < 240; i++) stepTargetFocus(r, 7, 10, 0, 0, DT, false);
    expect(Math.hypot(r.focusX, r.focusZ)).toBeLessThan(0.01);
  });

  it('tab-spam is stable: rapid switches just re-aim the one eased vector', () => {
    const s = createTargetFocus();
    let maxLean = 0;
    for (let i = 0; i < 200; i++) {
      // A new target id every 3 frames, alternating sides.
      const id = Math.floor(i / 3);
      const side = id % 2 === 0 ? 10 : -10;
      stepTargetFocus(s, id, side, 2, 0, DT, true);
      maxLean = Math.max(maxLean, Math.hypot(s.focusX, s.focusZ));
    }
    expect(maxLean).toBeLessThanOrEqual(FOCUS_LEAN_MAX + 1e-9);
  });
});
