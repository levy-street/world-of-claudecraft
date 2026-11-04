// The Masterless Strength rebuilds in its own model (Jose's playtest of
// 2026-11-04: the rebuild showed the pre-rework body, the Heart kit's
// floating rock pieces, then snapped to the new model): the model shows from
// the arrival's first frame, dormant until the shockwave; every rock piece
// flies into the model's own anchors and is drawn into it, never assembled
// into the old body (src/render/smith_heart_fx/final_arrival_core.ts; the
// painter final_fx.ts and final_body_fx.ts).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_ABSORB_FROM,
  arrivalAnchor,
  arrivalForming,
  arrivalModelShown,
  arrivalPieceScale,
} from '../src/render/smith_heart_fx/final_arrival_core';
import {
  FINAL_BODY_ANCHORS,
  FINAL_BODY_GESTURES,
} from '../src/render/smith_heart_fx/final_body_core';
import { FinalBodyFx, type FinalBodyHost } from '../src/render/smith_heart_fx/final_body_fx';
import {
  ARRIVAL_WAVE_AT,
  COLOSSUS_PIECES,
  colossusLockAt,
} from '../src/render/smith_heart_fx/final_fx_core';
import { EngineParticles } from '../src/render/trash_engine_fx/engine_particles';
import type { Entity } from '../src/sim/types';

describe('the rebuild in the model', () => {
  it('the model shows from the first frame of the waking; asleep it does not', () => {
    expect(arrivalModelShown(-1, false)).toBe(false);
    expect(arrivalModelShown(0, false)).toBe(true);
    expect(arrivalModelShown(0.05, false)).toBe(true);
    expect(arrivalModelShown(-1, true)).toBe(true);
    // Forming (dormant) until the shockwave, whole after it.
    expect(arrivalForming(0, ARRIVAL_WAVE_AT, false)).toBe(true);
    expect(arrivalForming(ARRIVAL_WAVE_AT - 0.01, ARRIVAL_WAVE_AT, false)).toBe(true);
    expect(arrivalForming(ARRIVAL_WAVE_AT, ARRIVAL_WAVE_AT, false)).toBe(false);
    expect(arrivalForming(2, ARRIVAL_WAVE_AT, true)).toBe(false);
  });

  it('every piece flies into a real anchor of the model', () => {
    COLOSSUS_PIECES.forEach((p, i) => {
      const a = arrivalAnchor(p.joint, p.side, i);
      expect(FINAL_BODY_ANCHORS[a]).toBeDefined();
    });
    expect(arrivalAnchor('head', 0, 0)).toBe('head');
    expect(arrivalAnchor('fist', 1, 0)).toBe('fistL');
    expect(arrivalAnchor('fist', -1, 0)).toBe('fistR');
  });

  it('a piece is drawn into the stone and gone at its lock (the old body never stands)', () => {
    expect(arrivalPieceScale(0)).toBe(1);
    expect(arrivalPieceScale(ARRIVAL_ABSORB_FROM)).toBe(1);
    expect(arrivalPieceScale(0.8)).toBeLessThan(1);
    expect(arrivalPieceScale(0.8)).toBeGreaterThan(0);
    expect(arrivalPieceScale(1)).toBe(0);
    // Monotone: it never grows back.
    let last = 1;
    for (let k = 0; k <= 1; k += 0.02) {
      const s = arrivalPieceScale(k);
      expect(s).toBeLessThanOrEqual(last + 1e-9);
      last = s;
    }
    // Every lock lands before the shockwave: nothing left to assemble.
    for (const p of COLOSSUS_PIECES) expect(colossusLockAt(p)).toBeLessThan(ARRIVAL_WAVE_AT);
  });
});

describe('the body through the rebuild (final_body_fx.ts)', () => {
  const host = (): FinalBodyHost => {
    const root = new THREE.Group();
    return {
      particles: new EngineParticles(
        root,
        { value: 0 },
        1,
        () => 0,
        () => 0.5,
        () => false,
        null,
      ),
      density: 1,
      flash: () => {},
      shakeNear: () => {},
      rand: () => 0.5,
      groundY: () => 0,
    };
  };
  const boss = { id: 7, pos: { x: 0, y: 0, z: 0 }, facing: 0, scale: 1 } as unknown as Entity;

  it('shows the model while forming, holds its aura, and roars as it stands whole', () => {
    const sent: string[] = [];
    const fx = new FinalBodyFx(new THREE.Group(), host(), (_id, g) => sent.push(g));
    const frame = (whole: boolean, forming: boolean, clock: number) =>
      fx.update({
        boss,
        zone: 'ring',
        whole,
        forming,
        dead: false,
        kneeling: false,
        clock,
        dt: 0.1,
      });
    frame(false, true, 0);
    expect(sent).toContain(FINAL_BODY_GESTURES.show);
    expect(sent).not.toContain(FINAL_BODY_GESTURES.hide);
    expect(sent).not.toContain(FINAL_BODY_GESTURES.shift);
    sent.length = 0;
    frame(false, true, 0.1);
    frame(true, false, 0.2);
    expect(sent).toContain(FINAL_BODY_GESTURES.shift);
    // Asleep (neither): hidden.
    const s2: string[] = [];
    const fx2 = new FinalBodyFx(new THREE.Group(), host(), (_id, g) => s2.push(g));
    fx2.update({
      boss,
      zone: 'ring',
      whole: false,
      forming: false,
      dead: false,
      kneeling: false,
      clock: 0,
      dt: 0.1,
    });
    expect(s2).toContain(FINAL_BODY_GESTURES.hide);
  });

  it('a lock flares the cracks', () => {
    const sent: string[] = [];
    const fx = new FinalBodyFx(new THREE.Group(), host(), (_id, g) => sent.push(g));
    fx.update({
      boss,
      zone: 'ring',
      whole: false,
      forming: true,
      dead: false,
      kneeling: false,
      clock: 0,
      dt: 0.1,
    });
    sent.length = 0;
    fx.pieceDrawnIn();
    expect(sent).toEqual([FINAL_BODY_GESTURES.charge]);
  });
});
