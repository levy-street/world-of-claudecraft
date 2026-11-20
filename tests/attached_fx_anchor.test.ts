import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fxAnchor, installDrawnPositions } from '../src/render/attached_fx_anchor';
import {
  FX_REDRAPE_YD,
  type FxAnchorVec,
  needsRedrape,
  resolveFxAnchor,
} from '../src/render/attached_fx_anchor_core';

// An effect pinned to a unit (the Hammer's Weight stone and mark, a soak
// ring at a player's feet, a boss body drawn by the raid's effects) must ride
// the unit's DRAWN pose. The model is drawn at a smoothed pose every frame;
// `e.pos` only moves when a 20 Hz snapshot (or sim tick) lands, so an effect
// at `e.pos` stair-steps against the walking body (the reported shake).

const SNAPSHOT_DT = 1 / 20;
const FRAME_DT = 1 / 60;
const SPEED = 7; // yd/s, a walking player

/** A unit walking along +z for one second: what the renderer draws each
 *  frame (the interpolated pose) and what the snapshot says (`e.pos`). */
function walk(): { drawn: FxAnchorVec[]; snap: FxAnchorVec[] } {
  const drawn: FxAnchorVec[] = [];
  const snap: FxAnchorVec[] = [];
  for (let f = 0; f < 60; f++) {
    const t = f * FRAME_DT;
    const tick = Math.floor(t / SNAPSHOT_DT);
    const alpha = (t - tick * SNAPSHOT_DT) / SNAPSHOT_DT;
    const prev = (tick - 1) * SNAPSHOT_DT * SPEED;
    const pos = tick * SNAPSHOT_DT * SPEED;
    drawn.push({ x: 0, y: 0, z: prev + (pos - prev) * alpha });
    snap.push({ x: 0, y: 0, z: pos });
  }
  return { drawn, snap };
}

/** Frame-to-frame change of the effect's offset from the drawn body (yd). */
function offsetJitter(drawn: FxAnchorVec[], fx: FxAnchorVec[]): number {
  let worst = 0;
  for (let i = 1; i < drawn.length; i++) {
    const a = fx[i].z - drawn[i].z;
    const b = fx[i - 1].z - drawn[i - 1].z;
    worst = Math.max(worst, Math.abs(a - b));
  }
  return worst;
}

describe('resolveFxAnchor', () => {
  it('follows the drawn pose of a walking unit, so the effect never shakes', () => {
    const { drawn, snap } = walk();
    const anchored: FxAnchorVec[] = [];
    for (let i = 0; i < drawn.length; i++) {
      const view = drawn[i];
      anchored.push(
        resolveFxAnchor({ id: 7, pos: snap[i] }, (id) => (id === 7 ? view : undefined)),
      );
    }
    // The bug's source: pinned to the snapshot, the effect jumps a third of
    // a yard against the body every snapshot.
    expect(offsetJitter(drawn, snap)).toBeGreaterThan(0.2);
    // Anchored to the drawn pose it rides the body exactly.
    expect(offsetJitter(drawn, anchored)).toBe(0);
    for (let i = 0; i < drawn.length; i++) expect(anchored[i]).toBe(drawn[i]);
  });

  it('returns the view position by reference (no per-frame allocation)', () => {
    const view = { x: 1, y: 2, z: 3 };
    expect(resolveFxAnchor({ id: 1, pos: { x: 9, y: 9, z: 9 } }, () => view)).toBe(view);
  });

  it('falls back to the entity position with no view, no lookup, or a broken view', () => {
    const pos = { x: 4, y: 5, z: 6 };
    expect(resolveFxAnchor({ id: 1, pos }, null)).toBe(pos);
    expect(resolveFxAnchor({ id: 1, pos }, () => undefined)).toBe(pos);
    expect(resolveFxAnchor({ id: 1, pos }, () => ({ x: Number.NaN, y: 0, z: 0 }))).toBe(pos);
    expect(resolveFxAnchor({ id: 1, pos }, () => ({ x: 0, y: 0, z: Infinity }))).toBe(pos);
  });

  it('asks the lookup for the entity it was given', () => {
    const asked: number[] = [];
    resolveFxAnchor({ id: 42, pos: { x: 0, y: 0, z: 0 } }, (id) => {
      asked.push(id);
      return undefined;
    });
    expect(asked).toEqual([42]);
  });
});

describe('fxAnchor (the installed drawn-position source)', () => {
  it('reads the installed lookup and falls back once it is removed', () => {
    const pos = { x: 1, y: 0, z: 1 };
    const view = { x: 2, y: 0, z: 2 };
    expect(fxAnchor({ id: 3, pos })).toBe(pos);
    const remove = installDrawnPositions(() => view);
    try {
      expect(fxAnchor({ id: 3, pos })).toBe(view);
    } finally {
      remove();
    }
    expect(fxAnchor({ id: 3, pos })).toBe(pos);
  });

  it('a stale uninstall never removes a newer source', () => {
    const pos = { x: 0, y: 0, z: 0 };
    const older = { x: 1, y: 0, z: 0 };
    const newer = { x: 2, y: 0, z: 0 };
    const removeOlder = installDrawnPositions(() => older);
    const removeNewer = installDrawnPositions(() => newer);
    removeOlder();
    expect(fxAnchor({ id: 1, pos })).toBe(newer);
    removeNewer();
    expect(fxAnchor({ id: 1, pos })).toBe(pos);
  });
});

describe('needsRedrape', () => {
  it('always drapes a never-draped footprint', () => {
    expect(needsRedrape(0, 0, Number.NaN, Number.NaN)).toBe(true);
  });

  it('slides within the redrape step and re-drapes past it, on either axis', () => {
    expect(needsRedrape(FX_REDRAPE_YD, 0, 0, 0)).toBe(false);
    expect(needsRedrape(0, -FX_REDRAPE_YD, 0, 0)).toBe(false);
    expect(needsRedrape(FX_REDRAPE_YD + 0.01, 0, 0, 0)).toBe(true);
    expect(needsRedrape(0, -(FX_REDRAPE_YD + 0.01), 0, 0)).toBe(true);
  });

  it('a walking unit re-drapes a few times a second, not every frame', () => {
    const { drawn } = walk();
    let dx = Number.NaN;
    let dz = Number.NaN;
    let drapes = 0;
    for (const p of drawn) {
      if (needsRedrape(p.x, p.z, dx, dz)) {
        drapes++;
        dx = p.x;
        dz = p.z;
      }
    }
    expect(drapes).toBeGreaterThan(1);
    expect(drapes).toBeLessThan(drawn.length / 3);
  });
});

describe('the pinned effects ride the drawn pose', () => {
  // Source pins: each follower below drew at the unit's snapshot position.
  const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const method = (src: string, name: string) => {
    const start = src.indexOf(`  private ${name}(`);
    expect(start, name).toBeGreaterThanOrEqual(0);
    const next = src.indexOf('\n  private ', start + 1);
    return src.slice(start, next < 0 ? undefined : next);
  };

  it("Hammer's Weight, the marks, the soak rock and the Resonance ring", () => {
    const src = read('src/render/smith_heart_fx/council_fx.ts');
    for (const name of ['updateWeights', 'updateMarks', 'updateRocks', 'updateRings']) {
      const body = method(src, name);
      expect(body, name).toContain('fxAnchor(p)');
      expect(body, name).not.toMatch(/\bp\.pos\.[xz]/);
    }
  });

  it('the raid bodies drawn by the effects', () => {
    for (const f of ['breath_body', 'heat_body', 'quench_body', 'council_bodies']) {
      const body = method(read(`src/render/smith_heart_fx/${f}.ts`), 'pose');
      expect(body, f).toContain('fxAnchor(e)');
      expect(body, f).not.toMatch(/position\.set\(e\.pos/);
    }
  });

  it('the encounter host installs the renderer view lookup', () => {
    expect(read('src/render/rift_death_zone.ts')).toContain('installDrawnPositions(');
    expect(read('src/render/renderer.ts')).toContain('(id) => this.views.get(id)?.group.position');
  });
});
