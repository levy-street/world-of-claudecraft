import { describe, expect, it } from 'vitest';
import {
  COURIER_FAREWELL_SECONDS,
  COURIER_FLIGHT_LIFT,
  COURIER_HOP_HEIGHTS,
  COURIER_SPIN_SECONDS,
  type CourierFarewellPose,
  type CourierVisualPose,
  courierDelivered,
  courierFacing,
  courierFarewellKind,
  courierFarewellPoseInto,
  courierFarewellSeconds,
  courierVisualPoseInto,
} from '../src/render/courier_visual_core';

const pose = (): CourierVisualPose => ({ lift: 0, flight: 0, moving: false, pitch: 0, stride: 1 });

describe('courier visual presentation', () => {
  it('runs before takeoff and after landing for a legacy distance-only server', () => {
    const out = pose();
    for (const phase of ['outbound', 'returning'] as const) {
      for (const [travelDistance, remainingDistance, lift] of [
        [0, 30, 0],
        [3, 30, 0],
        [5.5, 30, 1],
        [8, 30, 2],
        [8, 5.5, 1],
        [8, 3, 0],
      ]) {
        courierVisualPoseInto(out, { phase, x: 0, z: 0, travelDistance, remainingDistance }, false);
        expect(out.lift).toBe(lift);
        expect(out.moving).toBe(true);
      }
    }
    courierVisualPoseInto(out, { phase: 'returning', x: 0, z: 0 }, false);
    expect(out).toEqual({ lift: 0, flight: 0, moving: false, pitch: 0, stride: 1 });
  });
  it('idles on the ground while ready or waiting, but runs when following its owner', () => {
    const out = { lift: 2, flight: 1, moving: true, pitch: 1, stride: 0 };
    for (const phase of ['ready', 'waiting'] as const) {
      courierVisualPoseInto(
        out,
        { phase, x: 0, z: 0, travelTicks: 100, legTicks: 300, remainingDistance: 50 },
        false,
      );
      expect(out).toEqual({ lift: 0, flight: 0, moving: false, pitch: 0, stride: 1 });
      courierVisualPoseInto(out, { phase, x: 0, z: 0 }, true);
      expect(out.moving).toBe(true);
    }
  });
  it('runs, hops three rising arcs, takes off, cruises, descends and skids from leg ticks', () => {
    const out = pose();
    const at = (travelTicks: number, legTicks = 300) => {
      courierVisualPoseInto(
        out,
        { phase: 'outbound', x: 0, z: 0, travelTicks, legTicks, remainingDistance: 40 },
        false,
      );
      return { ...out };
    };
    expect(at(8)).toMatchObject({ lift: 0, flight: 0, moving: true });
    // Each hop peaks halfway through its 0.4 seconds (8 ticks), each higher than the last.
    const peaks = [20, 28, 36].map((ticks) => at(ticks).lift);
    for (const [hop, lift] of peaks.entries())
      expect(lift).toBeCloseTo(COURIER_HOP_HEIGHTS[hop], 9);
    expect(peaks[1]).toBeGreaterThan(peaks[0]);
    expect(peaks[2]).toBeGreaterThan(peaks[1]);
    for (const ticks of [16, 24, 32]) expect(at(ticks).lift).toBe(0);
    expect(at(18).pitch).toBeGreaterThan(0);
    expect(at(40)).toMatchObject({ lift: 0, flight: 0 });
    expect(at(52).flight).toBeCloseTo(0.5, 9);
    expect(at(64)).toMatchObject({ lift: COURIER_FLIGHT_LIFT, flight: 1, pitch: 0 });
    expect(at(200)).toMatchObject({ lift: COURIER_FLIGHT_LIFT, flight: 1 });
    expect(at(276).flight).toBeCloseTo(0.5, 9);
    // Skid: grounded, nose up, legs slowing to a stop.
    const touchdown = at(289);
    expect(touchdown).toMatchObject({ lift: 0, flight: 0, moving: true });
    expect(touchdown.pitch).toBeGreaterThan(0.2);
    expect(touchdown.stride).toBeGreaterThan(at(298).stride);
    expect(at(298).pitch).toBeLessThan(touchdown.pitch);
    // The same schedule fits a short five-second leg: the skid always ends it.
    expect(at(95, 100)).toMatchObject({ lift: 0, flight: 0 });
    expect(at(64, 100).flight).toBeGreaterThan(0);
  });
  it('rests grounded while a leg is paused, and falls back to legacy ten-second legs', () => {
    const out = pose();
    courierVisualPoseInto(
      out,
      { phase: 'returning', x: 0, z: 0, travelTicks: 100, legTicks: 300, remainingDistance: 0 },
      false,
    );
    expect(out).toEqual({ lift: 0, flight: 0, moving: false, pitch: 0, stride: 1 });
    courierVisualPoseInto(
      out,
      { phase: 'returning', x: 0, z: 0, travelTicks: 100, remainingDistance: 30 },
      false,
    );
    expect(out.lift).toBe(COURIER_FLIGHT_LIFT);
  });
  it('spins once with a hop after delivery, then shrinks away', () => {
    const out: CourierFarewellPose = { spin: 0, roll: 0, lift: 0, scale: 1, done: false };
    courierFarewellPoseInto(out, 0);
    expect(out).toEqual({ spin: 0, roll: 0, lift: 0, scale: 1, done: false });
    courierFarewellPoseInto(out, COURIER_SPIN_SECONDS / 2);
    expect(out.spin).toBeCloseTo(Math.PI, 9);
    expect(out.lift).toBeGreaterThan(0.4);
    courierFarewellPoseInto(out, COURIER_SPIN_SECONDS);
    expect(out.spin).toBeCloseTo(2 * Math.PI, 9);
    expect(out.scale).toBe(1);
    courierFarewellPoseInto(out, (COURIER_SPIN_SECONDS + COURIER_FAREWELL_SECONDS) / 2);
    expect(out.scale).toBeGreaterThan(0);
    expect(out.scale).toBeLessThan(1);
    expect(out.done).toBe(false);
    courierFarewellPoseInto(out, COURIER_FAREWELL_SECONDS);
    expect(out).toMatchObject({ scale: 0, done: true });
  });
  it('treats a vanished courier as delivered only after the return skid', () => {
    const base = { phase: 'returning' as const, x: 0, z: 0, legTicks: 300 };
    expect(courierDelivered({ ...base, travelTicks: 299 })).toBe(true);
    expect(courierDelivered({ ...base, travelTicks: 290 })).toBe(true);
    expect(courierDelivered({ ...base, travelTicks: 200 })).toBe(false);
    expect(courierDelivered({ ...base, phase: 'outbound', travelTicks: 299 })).toBe(false);
    expect(courierDelivered({ ...base, phase: 'ready', travelTicks: 299 })).toBe(false);
    expect(courierDelivered({ phase: 'returning', x: 0, z: 0, travelTicks: 299 })).toBe(false);
    expect(courierDelivered(null)).toBe(false);
  });
  it('faces observed movement and holds facing when stationary', () => {
    expect(courierFacing(0, 0, 1, 0, 0)).toBe(Math.PI / 2);
    expect(courierFacing(1, 2, 1, 2, 1.2)).toBe(1.2);
    expect(courierFacing(0, 1, 0, 0, 0)).toBe(Math.PI);
  });
  it('dances three bounces with a sway when dismissed, then shrinks away', () => {
    const out: CourierFarewellPose = { spin: 0, roll: 0, lift: 0, scale: 1, done: false };
    const dance = courierFarewellSeconds('dance');
    expect(dance).toBeGreaterThan(courierFarewellSeconds('spin'));
    const lifts: number[] = [];
    let maxRoll = 0;
    let maxSway = 0;
    for (let t = 0; t <= 1.2; t += 0.01) {
      courierFarewellPoseInto(out, t, 'dance');
      lifts.push(out.lift);
      maxRoll = Math.max(maxRoll, Math.abs(out.roll));
      maxSway = Math.max(maxSway, Math.abs(out.spin));
      expect(out.scale).toBe(1);
    }
    // Three bounce peaks, a visible hip sway, and never a full spin.
    const peaks = lifts.filter(
      (v, i) => i > 0 && i < lifts.length - 1 && v > lifts[i - 1] && v >= lifts[i + 1],
    );
    expect(peaks).toHaveLength(3);
    expect(maxRoll).toBeGreaterThan(0.15);
    expect(maxSway).toBeGreaterThan(0.3);
    expect(maxSway).toBeLessThan(1);
    courierFarewellPoseInto(out, dance - 0.1, 'dance');
    expect(out.scale).toBeGreaterThan(0);
    expect(out.scale).toBeLessThan(1);
    courierFarewellPoseInto(out, dance, 'dance');
    expect(out).toMatchObject({ scale: 0, done: true });
  });
  it('picks the spin after a delivery, the dance for a waiting courier, else nothing', () => {
    const base = { x: 0, z: 0, legTicks: 300 };
    expect(courierFarewellKind({ ...base, phase: 'returning', travelTicks: 299 })).toBe('spin');
    expect(courierFarewellKind({ ...base, phase: 'ready' })).toBe('dance');
    expect(courierFarewellKind({ ...base, phase: 'returning', travelTicks: 40 })).toBeNull();
    expect(courierFarewellKind({ ...base, phase: 'outbound', travelTicks: 299 })).toBeNull();
    expect(courierFarewellKind({ ...base, phase: 'waiting' })).toBeNull();
    expect(courierFarewellKind(null)).toBeNull();
  });
});
