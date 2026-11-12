// The open-world PvP map markers (src/ui/hill_map_marker_painter.ts): the
// pulse breathes between 0 and 1 over its period, the King of the Hill crown
// and the skill event badge draw in the colors they are handed, and both carry
// the extra warning ring before their event starts.

import { describe, expect, it } from 'vitest';
import {
  drawHillMapMarker,
  drawSkillEventMapMarker,
  MAP_PVP_PULSE_PERIOD_MS,
  mapPvpPulse,
} from '../src/ui/hill_map_marker_painter';

interface Rec {
  fills: { style: string; arcs: number[]; points: number }[];
  strokes: { style: string; arcs: number[] }[];
}

function recorder(): { ctx: CanvasRenderingContext2D; rec: Rec } {
  const rec: Rec = { fills: [], strokes: [] };
  let arcs: number[] = [];
  let points = 0;
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {
      arcs = [];
      points = 0;
    },
    closePath() {},
    arc(_x: number, _y: number, r: number) {
      arcs.push(r);
    },
    moveTo() {
      points++;
    },
    lineTo() {
      points++;
    },
    fill() {
      rec.fills.push({ style: String(ctx.fillStyle), arcs: [...arcs], points });
    },
    stroke() {
      rec.strokes.push({ style: String(ctx.strokeStyle), arcs: [...arcs] });
    },
    fillRect() {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rec };
}

describe('PvP map marker pulse', () => {
  it('breathes from 0 to 1 and back over one period', () => {
    expect(mapPvpPulse(0)).toBeCloseTo(0, 6);
    expect(mapPvpPulse(MAP_PVP_PULSE_PERIOD_MS / 2)).toBeCloseTo(1, 6);
    expect(mapPvpPulse(MAP_PVP_PULSE_PERIOD_MS)).toBeCloseTo(0, 6);
    for (let t = 0; t < 5000; t += 37) {
      const v = mapPvpPulse(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('grows the glow with the pulse', () => {
    const quiet = recorder();
    drawHillMapMarker(quiet.ctx, { mx: 0, my: 0, phase: 'active' }, 10, 'red', 'dark', 0);
    const full = recorder();
    drawHillMapMarker(full.ctx, { mx: 0, my: 0, phase: 'active' }, 10, 'red', 'dark', 1);
    expect(full.rec.fills[0].arcs[0]).toBeGreaterThan(quiet.rec.fills[0].arcs[0]);
  });
});

describe('King of the Hill crown', () => {
  it('is a red crown on a dark badge with a red rim, not a skull', () => {
    const { ctx, rec } = recorder();
    drawHillMapMarker(ctx, { mx: 5, my: 5, phase: 'active' }, 10, 'red', 'dark', 0.5);
    const badge = rec.fills.find((f) => f.style === 'dark' && f.arcs.includes(10));
    expect(badge).toBeDefined();
    expect(rec.strokes.some((s) => s.style === 'red' && s.arcs.includes(10))).toBe(true);
    const crown = rec.fills.filter((f) => f.style === 'red' && f.points === 9);
    expect(crown).toHaveLength(1);
    // No warning ring while active.
    expect(rec.strokes.some((s) => s.arcs.includes(13))).toBe(false);
  });

  it('adds the warning ring before the hill rises', () => {
    const { ctx, rec } = recorder();
    drawHillMapMarker(ctx, { mx: 5, my: 5, phase: 'warning' }, 10, 'red', 'dark', 0.5);
    expect(rec.strokes.some((s) => s.style === 'red' && s.arcs.includes(13))).toBe(true);
  });
});

describe('skill event badge', () => {
  it('is the world quest emblem in red: a red ring, a dark centre and a red star', () => {
    const { ctx, rec } = recorder();
    drawSkillEventMapMarker(ctx, { mx: 0, my: 0, phase: 'running' }, 10, 'red', 'dark', 0.5);
    expect(rec.fills.some((f) => f.style === 'red' && f.arcs.includes(10))).toBe(true);
    expect(rec.fills.some((f) => f.style === 'dark' && f.arcs.length === 1 && f.arcs[0] < 10)).toBe(
      true,
    );
    expect(rec.fills.filter((f) => f.style === 'red' && f.points === 8)).toHaveLength(1);
    expect(rec.strokes.some((s) => s.arcs.includes(13))).toBe(false);
  });

  it('adds the warning ring before the event starts', () => {
    const { ctx, rec } = recorder();
    drawSkillEventMapMarker(ctx, { mx: 0, my: 0, phase: 'warning' }, 10, 'red', 'dark', 0.5);
    expect(rec.strokes.some((s) => s.style === 'red' && s.arcs.includes(13))).toBe(true);
  });
});
