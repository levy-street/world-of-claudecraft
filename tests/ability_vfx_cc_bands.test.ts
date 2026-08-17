// The persistent crowd-control tells: a worn stun, fear, or root aura wears a
// held band for the aura's whole life. Matched by what the SIM says the victim
// is suffering (aura kind, plus the sim's own fear rule), never the spec
// table, so every source reads (player abilities, mob stomps, ensnare affixes)
// online and offline; the fx engine sweeps the band the frame the aura fades.
// Covers the sim-side fear rule, the pure core read (type precedence, per-type
// specs, band selection), the painter feed (dead gate, presentation gate), and
// the fx-side draw/sweep/sleep lifecycle with its fairness pins: first overlay
// slots, quality-tier immunity, the SHARED MAX_CC_BANDS cap, severity-major
// ranking, the alpha floor, and the sequencer handoff.
// Exhaustive shed set, for the record: the only paths that drop a live band
// are the frame-stamp sweep (aura faded or entity out of the renderer's sync
// range), sleepEntity via syncEntity(e, false) (a frustum-culled,
// non-actionable rig), the dead gate, and the ranked cap; no quality tier,
// budget tier, or governor state reaches it.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { OVERLAY_CELL } from '../src/render/ability_vfx/fx_textures';
import type { AbilityVfxDeps, AbilityVfxEntityState } from '../src/render/ability_vfx/painter';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import {
  CC_BAND_SPECS,
  type CcBandType,
  ccBandRankKey,
  insertCcBandPick,
  MAX_CC_BANDS,
  wornCcBand,
} from '../src/render/ability_vfx_core';
import { ABILITY_VFX_SPECS } from '../src/render/ability_vfx_specs';
// The fear arm resolves through the sim's own rule (pinned on its own in
// tests/combat_cc.test.ts); the id is imported here so the band cases stage
// the real aura rather than a look-alike string.
import { SHARED_FEAR_AURA_ID } from '../src/sim/combat/cc';
import { bareClient } from './helpers/bare_client';

function installCanvasStub(): void {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const context = {
    arc: noop,
    beginPath: noop,
    clip: noop,
    closePath: noop,
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    ellipse: noop,
    fill: noop,
    fillRect: noop,
    lineTo: noop,
    moveTo: noop,
    putImageData: noop,
    rect: noop,
    restore: noop,
    rotate: noop,
    save: noop,
    scale: noop,
    stroke: noop,
    translate: noop,
  };
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

interface FxProbe {
  ccBands: Map<number, { type: CcBandType; remaining: number; stamp: number }>;
  overlay: {
    count: number;
    alpha: Float32Array;
    cell: Float32Array;
    col: Float32Array;
    pos: Float32Array;
  };
  sequencer: {
    slots: { active: boolean; targetId: number; ccStars: number; impactDone: boolean }[];
  };
}

// The anchor spreads entities along x by id so the nearest-camera selection
// has real distances to rank (camera sits at the origin looking down -z), and
// records every (id, frac) it was asked for so the per-type body anchor (head
// vs ankles) can be pinned.
function makeFx(anchor?: (id: number, frac: number) => THREE.Vector3): {
  fx: AbilityVfxFx;
  probe: FxProbe;
  anchorCalls: { id: number; frac: number }[];
} {
  installCanvasStub();
  // Identity rotation, so the camera sits at the origin looking down -z:
  // z < 0 is in front of it, z > 0 is behind.
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.updateMatrixWorld();
  const anchorCalls: { id: number; frac: number }[] = [];
  const base = anchor ?? ((id: number) => new THREE.Vector3(id, 1.8, -5));
  const fx = new AbilityVfxFx(
    new THREE.Scene(),
    camera,
    (id: number, frac: number) => {
      anchorCalls.push({ id, frac });
      return base(id, frac);
    },
    () => 0,
  );
  return { fx, probe: fx as unknown as FxProbe, anchorCalls };
}

function makePainter() {
  const fx = {
    setDelegates: vi.fn(),
    warmSpiritsForClass: vi.fn(),
    windup: vi.fn().mockReturnValue(false),
    holdShell: vi.fn(),
    holdGroundAura: vi.fn().mockReturnValue(true),
    holdCcBand: vi.fn(),
    orbit: vi.fn().mockReturnValue(true),
    bodyGlow: vi.fn(),
    sleepEntity: vi.fn(),
    update: vi.fn(),
  };
  const vfx = {
    projectile: vi.fn(),
    lightningProjectile: vi.fn(),
    burst: vi.fn(),
    nova: vi.fn(),
    tick: vi.fn(),
    shoutwave: vi.fn(),
    buffSwirl: vi.fn(),
    beam: vi.fn(),
  };
  const deps = {
    vfx,
    fx,
    anchor: () => ({ x: 0, y: 0, z: 0 }),
    spawnAoeRing: vi.fn(),
    triggerAttack: vi.fn(),
  } as unknown as AbilityVfxDeps;
  const painter = new AbilityVfx(deps, () => 12.5);
  return { painter, fx };
}

function ent(
  auras: { id: string; kind?: string; remaining?: number }[],
  id = 7,
  dead?: boolean,
): AbilityVfxEntityState {
  return { id, castingAbility: null, castRemaining: 0, castTotal: 0, auras, dead };
}

// Indices of the frame's overlay sprites drawn from the given band type's
// atlas cell near the given entity (a hand-cooked sequencer slot also draws
// other transients, including stray stars at its own impact point; the handoff
// pins care about the band around the victim). The test anchor puts entity id
// at x = id.
function bandSpriteIndices(probe: FxProbe, entityId: number, type: CcBandType): number[] {
  const spec = CC_BAND_SPECS[type];
  const cell = OVERLAY_CELL[spec.cell];
  // Tolerance comes from the band's own radius, since the sprites ring the
  // anchor: a fixed window narrower than the widest band silently drops half
  // its sprites and reads as a partial draw.
  const reach = spec.radius + 0.1;
  const pos = probe.overlay.pos;
  const out: number[] = [];
  for (let i = 0; i < probe.overlay.count; i++) {
    if (probe.overlay.cell[i] === cell && Math.abs(pos[i * 3] - entityId) <= reach) out.push(i);
  }
  return out;
}

const ALL_TYPES: CcBandType[] = ['stun', 'fear', 'root'];

describe('CC_BAND_SPECS (the authored per-type look)', () => {
  it('orders severity by how total the lockout is, with no ties', () => {
    expect(CC_BAND_SPECS.stun.severity).toBeLessThan(CC_BAND_SPECS.fear.severity);
    expect(CC_BAND_SPECS.fear.severity).toBeLessThan(CC_BAND_SPECS.root.severity);
  });

  it('pins each band to its own colour literal', () => {
    expect(CC_BAND_SPECS.stun.color).toBe(0xffd700);
    expect(CC_BAND_SPECS.fear.color).toBe(0x6a1bff);
    expect(CC_BAND_SPECS.root.color).toBe(0x28e63c);
  });

  it('separates the three on a second axis besides colour, so the tell survives colourblindness', () => {
    // Distinct atlas cells (shape), and the root band alone rides the ankles
    // while the head-space pair is split by the fear band's vertical bob.
    expect(new Set(ALL_TYPES.map((t) => CC_BAND_SPECS[t].cell)).size).toBe(3);
    expect(CC_BAND_SPECS.root.anchorFrac).toBe(0);
    expect(CC_BAND_SPECS.stun.anchorFrac).toBe(1);
    expect(CC_BAND_SPECS.fear.anchorFrac).toBe(1);
    expect(CC_BAND_SPECS.fear.wobble).toBeGreaterThan(0);
    expect(CC_BAND_SPECS.stun.wobble).toBe(0);
    expect(CC_BAND_SPECS.root.wobble).toBe(0);
  });

  it('keeps every colour dominant-channel readable after the overbright clamp', () => {
    // The swatch is not what ships: the additive draw multiplies by brightness
    // and clamps, so a colour whose OTHER channels also saturate washes to
    // white. Each band's dominant channel must clamp while the rest do not.
    const dominant: Record<CcBandType, 'r' | 'g' | 'b'> = { stun: 'g', fear: 'b', root: 'g' };
    for (const type of ALL_TYPES) {
      const spec = CC_BAND_SPECS[type];
      const lit = new THREE.Color().setHex(spec.color).multiplyScalar(spec.brightness);
      const channels = { r: lit.r, g: lit.g, b: lit.b };
      expect(
        channels[dominant[type]],
        `${type} dominant channel must saturate`,
      ).toBeGreaterThanOrEqual(1);
      const others = (['r', 'g', 'b'] as const).filter((c) => c !== dominant[type]);
      const saturated = others.filter((c) => channels[c] >= 1);
      // At most one other channel may reach the top (yellow is r+g by
      // definition); all three saturating IS white.
      expect(saturated.length, `${type} washes toward white`).toBeLessThanOrEqual(1);
    }
  });

  it('cannot exhaust the shared 128-sprite overlay batch even fully saturated', () => {
    const worst = Math.max(...ALL_TYPES.map((t) => CC_BAND_SPECS[t].count));
    expect(MAX_CC_BANDS * worst).toBeLessThanOrEqual(32);
  });

  it('keeps every band readable to the last tick (an alpha floor per type)', () => {
    for (const type of ALL_TYPES) {
      expect(CC_BAND_SPECS[type].alphaFloor).toBeGreaterThan(0);
    }
  });
});

describe('wornCcBand (pure core)', () => {
  it('returns null when no aura is hard CC, whatever the ids look like', () => {
    expect(wornCcBand([])).toBeNull();
    expect(
      wornCcBand([
        { id: 'hamstring_slow', kind: 'slow', remaining: 4 },
        { id: 'arcane_intellect', kind: 'buff', remaining: 300 },
        { id: 'storm_bolt_stun' },
      ]),
    ).toBeNull();
  });

  it('reads a stun, a root, and a fear each from what the sim says the victim wears', () => {
    expect(wornCcBand([{ id: 'war_stomp_stun', kind: 'stun', remaining: 2.5 }])).toEqual({
      type: 'stun',
      remaining: 2.5,
    });
    expect(wornCcBand([{ id: 'ensnare_bog_lurker', kind: 'root', remaining: 4 }])).toEqual({
      type: 'root',
      remaining: 4,
    });
    expect(wornCcBand([{ id: SHARED_FEAR_AURA_ID, kind: 'incapacitate', remaining: 6 }])).toEqual({
      type: 'fear',
      remaining: 6,
    });
  });

  it('wears NO band for a non-fear incapacitate (the documented scope gap)', () => {
    expect(wornCcBand([{ id: 'gouge_incap', kind: 'incapacitate', remaining: 4 }])).toBeNull();
  });

  it('draws the most severe control when a victim wears several, not the longest', () => {
    // A stunned entity is ALWAYS also isRooted() in the sim, so without the
    // precedence rule every stun would feed two bands. The root here outlasts
    // the stun by 5x and still loses.
    expect(
      wornCcBand([
        { id: 'entangling_roots_root', kind: 'root', remaining: 10 },
        { id: 'storm_bolt_stun', kind: 'stun', remaining: 2 },
      ]),
    ).toEqual({ type: 'stun', remaining: 2 });
    // fear outranks root, and is outranked by stun
    expect(
      wornCcBand([
        { id: 'entangling_roots_root', kind: 'root', remaining: 10 },
        { id: SHARED_FEAR_AURA_ID, kind: 'incapacitate', remaining: 3 },
      ]),
    ).toEqual({ type: 'fear', remaining: 3 });
  });

  it('takes the longest remaining WITHIN the winning type, whatever the aura order', () => {
    expect(
      wornCcBand([
        { id: 'a_stun', kind: 'stun', remaining: 1.5 },
        { id: 'buff', kind: 'buff', remaining: 300 },
        { id: 'b_stun', kind: 'stun', remaining: 2.75 },
      ]),
    ).toEqual({ type: 'stun', remaining: 2.75 });
    // and the reverse order picks the same winner
    expect(
      wornCcBand([
        { id: 'b_stun', kind: 'stun', remaining: 2.75 },
        { id: 'a_stun', kind: 'stun', remaining: 1.5 },
      ]),
    ).toEqual({ type: 'stun', remaining: 2.75 });
  });

  it('treats an aura with no remaining as 1s live, and one at exactly 0 as expired', () => {
    expect(wornCcBand([{ id: 'x_stun', kind: 'stun' }])).toEqual({ type: 'stun', remaining: 1 });
    expect(wornCcBand([{ id: 'x_stun', kind: 'stun', remaining: 0 }])).toBeNull();
    // an expired stun must not suppress a live root under it
    expect(
      wornCcBand([
        { id: 'x_stun', kind: 'stun', remaining: 0 },
        { id: 'y_root', kind: 'root', remaining: 3 },
      ]),
    ).toEqual({ type: 'root', remaining: 3 });
  });
});

describe('band selection (pure core)', () => {
  // Drive the ranking + bounded insertion directly, rather than only through
  // the frame path, so the ordering rules are pinned on their own.
  function pick(
    entries: { id: number; severity?: number; dist2: number; inFront: boolean }[],
    max: number,
  ): number[] {
    const ids: number[] = new Array(Math.max(max, 1)).fill(0);
    const keys: number[] = new Array(Math.max(max, 1)).fill(0);
    let count = 0;
    for (const e of entries) {
      const key = ccBandRankKey(e.severity ?? 0, e.dist2, e.inFront);
      count = insertCcBandPick(ids, keys, count, e.id, key, max);
    }
    return ids.slice(0, count);
  }

  it('orders by distance and drops the worst once full', () => {
    expect(
      pick(
        [
          { id: 1, dist2: 90, inFront: true },
          { id: 2, dist2: 10, inFront: true },
          { id: 3, dist2: 50, inFront: true },
        ],
        2,
      ),
    ).toEqual([2, 3]);
  });

  it('puts every in-front band ahead of every behind-camera band, however near', () => {
    expect(
      pick(
        [
          { id: 1, dist2: 0.01, inFront: false },
          { id: 2, dist2: 9000, inFront: true },
        ],
        2,
      ),
    ).toEqual([2, 1]);
    // and the behind-camera one loses outright when slots are scarce
    expect(
      pick(
        [
          { id: 1, dist2: 0.01, inFront: false },
          { id: 2, dist2: 9000, inFront: true },
        ],
        1,
      ),
    ).toEqual([2]);
  });

  it('keeps behind-camera bands ranked among themselves', () => {
    expect(
      pick(
        [
          { id: 1, dist2: 800, inFront: false },
          { id: 2, dist2: 40, inFront: false },
        ],
        2,
      ),
    ).toEqual([2, 1]);
  });

  it('ranks severity ahead of distance: a far stun beats a point-blank root', () => {
    const far = CC_BAND_SPECS.stun.severity;
    const near = CC_BAND_SPECS.root.severity;
    expect(
      pick(
        [
          { id: 1, severity: near, dist2: 0.01, inFront: true },
          { id: 2, severity: far, dist2: 14000, inFront: true },
        ],
        1,
      ),
    ).toEqual([2]);
    // even against the behind-camera penalty, severity still dominates
    expect(
      pick(
        [
          { id: 1, severity: near, dist2: 0.01, inFront: true },
          { id: 2, severity: far, dist2: 14000, inFront: false },
        ],
        1,
      ),
    ).toEqual([2]);
  });

  it('still ranks by distance among bands of the SAME severity', () => {
    const s = CC_BAND_SPECS.root.severity;
    expect(
      pick(
        [
          { id: 1, severity: s, dist2: 900, inFront: true },
          { id: 2, severity: s, dist2: 4, inFront: true },
        ],
        2,
      ),
    ).toEqual([2, 1]);
  });

  it('is a no-op at zero capacity and never exceeds max', () => {
    expect(pick([{ id: 1, dist2: 1, inFront: true }], 0)).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => ({ id: i, dist2: i, inFront: true }));
    expect(pick(many, MAX_CC_BANDS)).toHaveLength(MAX_CC_BANDS);
  });
});

describe('painter feeds the tell from the sim state, not the spec table', () => {
  it('holds a band for a stun aura whose id has no vfx spec (a mob stomp)', () => {
    const { painter, fx } = makePainter();
    const auraId = 'war_stomp_stun';
    expect(ABILITY_VFX_SPECS[auraId]).toBeUndefined();

    painter.syncEntity(ent([{ id: auraId, kind: 'stun', remaining: 2.5 }]));

    expect(fx.holdCcBand).toHaveBeenCalledWith(7, 'stun', 2.5);
  });

  it('holds a root band for a mob ensnare, which carries neither a spec nor the _root id convention', () => {
    // ensnare_<templateId> (src/sim/mob/mob_swing.ts): the exact gap the
    // spec-driven worn-debuff band cannot cover, since it keys off the _root
    // suffix and a base ability with an authored spec.
    const { painter, fx } = makePainter();
    const auraId = 'ensnare_bog_lurker';
    expect(ABILITY_VFX_SPECS[auraId]).toBeUndefined();
    expect(auraId.endsWith('_root')).toBe(false);

    painter.syncEntity(ent([{ id: auraId, kind: 'root', remaining: 4 }]));

    expect(fx.holdCcBand).toHaveBeenCalledWith(7, 'root', 4);
  });

  it('holds a fear band for the shared fear aura, every frame it is worn', () => {
    const { painter, fx } = makePainter();
    const e = ent([{ id: SHARED_FEAR_AURA_ID, kind: 'incapacitate', remaining: 6 }]);

    painter.syncEntity(e);
    painter.syncEntity(e);

    expect(fx.holdCcBand).toHaveBeenCalledTimes(2);
    expect(fx.holdCcBand).toHaveBeenLastCalledWith(7, 'fear', 6);
  });

  it('holds nothing for non-hard-CC debuffs, buffs, or an expired stun', () => {
    const { painter, fx } = makePainter();

    painter.syncEntity(
      ent([
        { id: 'hamstring_slow', kind: 'slow', remaining: 8 },
        { id: 'arcane_intellect', kind: 'buff', remaining: 1800 },
        { id: 'storm_bolt_stun', kind: 'stun', remaining: 0 },
      ]),
    );

    expect(fx.holdCcBand).not.toHaveBeenCalled();
  });

  it('holds exactly ONE band for a victim wearing both a stun and a root', () => {
    const { painter, fx } = makePainter();

    painter.syncEntity(
      ent([
        { id: 'entangling_roots_root', kind: 'root', remaining: 10 },
        { id: 'storm_bolt_stun', kind: 'stun', remaining: 2 },
      ]),
    );

    expect(fx.holdCcBand).toHaveBeenCalledTimes(1);
    expect(fx.holdCcBand).toHaveBeenCalledWith(7, 'stun', 2);
  });

  it('holds nothing on a dead body, even under a death-surviving stun aura', () => {
    const { painter, fx } = makePainter();

    painter.syncEntity(
      ent([{ id: 'nythraxis_transition_stun', kind: 'stun', remaining: 9 }], 7, true),
    );

    expect(fx.holdCcBand).not.toHaveBeenCalled();
  });

  it('holds nothing at 0 hp before the dead flag has landed', () => {
    const { painter, fx } = makePainter();
    const e = ent([{ id: 'storm_bolt_stun', kind: 'stun', remaining: 3 }]);

    painter.syncEntity({ ...e, hp: 0 });

    expect(fx.holdCcBand).not.toHaveBeenCalled();
  });

  it('sleeps instead of holding when presentation is gated off', () => {
    const { painter, fx } = makePainter();

    painter.syncEntity(ent([{ id: 'storm_bolt_stun', kind: 'stun', remaining: 3 }]), false);

    expect(fx.sleepEntity).toHaveBeenCalledWith(7);
    expect(fx.holdCcBand).not.toHaveBeenCalled();
  });
});

describe('fx engine draws and sweeps the held band', () => {
  it('draws each type at its own sprite count, cell, and colour', () => {
    for (const type of ALL_TYPES) {
      const { fx, probe } = makeFx();
      const spec = CC_BAND_SPECS[type];
      // Expected channels come from the spec through the same conversion
      // OverlaySprites.push applies, so a hardcoded colour at the push site
      // fails this even though the spec is untouched. The buffer holds the
      // RAW overbright product (the shader is what clamps it), so these are
      // the unclamped values; the clamped read is pinned by the CC_BAND_SPECS
      // washout test above.
      const want = new THREE.Color().setHex(spec.color).multiplyScalar(spec.brightness);

      fx.holdCcBand(7, type, 3);
      fx.update(0.05);

      expect(probe.overlay.count, `${type} sprite count`).toBe(spec.count);
      for (let i = 0; i < probe.overlay.count; i++) {
        expect(probe.overlay.cell[i], `${type} atlas cell`).toBe(OVERLAY_CELL[spec.cell]);
        expect(probe.overlay.col[i * 3]).toBeCloseTo(want.r, 5);
        expect(probe.overlay.col[i * 3 + 1]).toBeCloseTo(want.g, 5);
        expect(probe.overlay.col[i * 3 + 2]).toBeCloseTo(want.b, 5);
      }
    }
  });

  it('anchors the root band at the ankles and the head-space bands at the head', () => {
    for (const type of ALL_TYPES) {
      const { fx, anchorCalls } = makeFx();
      fx.holdCcBand(7, type, 3);
      fx.update(0.05);

      const forEntity = anchorCalls.filter((c) => c.id === 7);
      expect(forEntity.length, `${type} resolved no anchor`).toBeGreaterThan(0);
      for (const call of forEntity) {
        expect(call.frac, `${type} body anchor`).toBe(CC_BAND_SPECS[type].anchorFrac);
      }
    }
  });

  it('bobs the fear band vertically and holds the other two on a flat ring', () => {
    for (const type of ALL_TYPES) {
      const { fx, probe } = makeFx();
      const ys: number[] = [];
      // Sample across several frames: a flat ring holds one height for every
      // sprite in every frame, the fear band does not.
      for (let f = 0; f < 6; f++) {
        fx.holdCcBand(7, type, 3);
        fx.update(0.05);
        for (let i = 0; i < probe.overlay.count; i++) ys.push(probe.overlay.pos[i * 3 + 1]);
      }
      const spread = Math.max(...ys) - Math.min(...ys);
      if (CC_BAND_SPECS[type].wobble > 0) {
        expect(spread, `${type} must bob`).toBeGreaterThan(0);
      } else {
        expect(spread, `${type} must stay on a flat ring`).toBeCloseTo(0, 6);
      }
    }
  });

  it('drives alpha off the remaining time, clamped to 1 and floored near expiry', () => {
    const { fx, probe } = makeFx();

    fx.holdCcBand(7, 'stun', 3);
    fx.update(0.05);
    expect(probe.overlay.alpha[0]).toBe(1);

    fx.holdCcBand(7, 'stun', 0.5);
    fx.update(0.05);
    expect(probe.overlay.alpha[0]).toBeCloseTo(0.5);

    fx.holdCcBand(7, 'stun', 0.05);
    fx.update(0.05);
    expect(probe.overlay.alpha[0]).toBeCloseTo(CC_BAND_SPECS.stun.alphaFloor);
  });

  it('swaps a live band in place when the victim takes a more severe control', () => {
    const { fx, probe } = makeFx();

    fx.holdCcBand(7, 'root', 8);
    fx.update(0.05);
    expect(probe.ccBands.get(7)?.type).toBe('root');

    fx.holdCcBand(7, 'stun', 2);
    fx.update(0.05);

    expect(probe.ccBands.size).toBe(1);
    expect(probe.ccBands.get(7)?.type).toBe('stun');
    expect(probe.overlay.count).toBe(CC_BAND_SPECS.stun.count);
    expect(probe.overlay.cell[0]).toBe(OVERLAY_CELL[CC_BAND_SPECS.stun.cell]);
  });

  it('occupies the FIRST overlay slots, ahead of a windup fed in the same frame', () => {
    const { fx, probe } = makeFx();

    fx.windup(3, 0xff0000, 0.5);
    fx.holdCcBand(7, 'stun', 3);
    fx.update(0.05);

    expect(probe.overlay.count).toBeGreaterThan(CC_BAND_SPECS.stun.count);
    for (let k = 0; k < CC_BAND_SPECS.stun.count; k++) {
      expect(probe.overlay.cell[k]).toBe(OVERLAY_CELL.star);
      expect(probe.overlay.alpha[k]).toBe(1);
    }
  });

  it('ignores the quality tier entirely: tier 0 sheds nothing from any band type', () => {
    for (const type of ALL_TYPES) {
      const { fx, probe } = makeFx();
      fx.setQuality(0);

      fx.holdCcBand(7, type, 3);
      fx.update(0.05);

      expect(probe.overlay.count, `${type} at tier 0`).toBe(CC_BAND_SPECS[type].count);
      expect(probe.overlay.alpha[0]).toBe(1);
    }
  });

  it('caps mass CC at MAX_CC_BANDS bands SHARED across the types, not per type', () => {
    const { fx, probe } = makeFx();

    // Anchor x = id, camera at origin: lower ids are nearer. Mix all three
    // types so a per-type cap would let 3x through.
    const total = MAX_CC_BANDS + 6;
    for (let id = 1; id <= total; id++) fx.holdCcBand(id, ALL_TYPES[id % 3], 3);
    fx.update(0.05);

    let drawn = 0;
    for (let id = 1; id <= total; id++) if (fx.heldCcBand(id)) drawn++;
    expect(drawn).toBe(MAX_CC_BANDS);
    // Every held entry survives the cap; only the draw is bounded.
    expect(probe.ccBands.size).toBe(total);
  });

  it('gives the scarce slots to the most severe control, not the nearest', () => {
    const { fx } = makeFx();

    // Roots at point-blank range, one stun far away: the stun must survive.
    for (let id = 1; id <= MAX_CC_BANDS; id++) fx.holdCcBand(id, 'root', 3);
    const farStun = 900;
    fx.holdCcBand(farStun, 'stun', 3);
    fx.update(0.05);

    expect(fx.heldCcBand(farStun)).toBe(true);
    // and exactly one of the nearer roots was displaced
    let roots = 0;
    for (let id = 1; id <= MAX_CC_BANDS; id++) if (fx.heldCcBand(id)) roots++;
    expect(roots).toBe(MAX_CC_BANDS - 1);
  });

  it('does not claim the read for a band the cap dropped, so its cast-moment stars still draw', () => {
    const { fx, probe } = makeFx();

    // Saturate the cap with nearer victims of the SAME severity, then a far
    // one that loses its slot.
    for (let id = 1; id <= MAX_CC_BANDS; id++) fx.holdCcBand(id, 'stun', 3);
    const dropped = 900;
    fx.holdCcBand(dropped, 'stun', 3);
    fx.update(0.05);

    // It is held and fed, but it did not win a slot, so the sequencer must NOT
    // stand down for it: answering "was fed" here left the 9th victim with no
    // overhead read at all, which is worse than before the feature existed.
    expect(probe.ccBands.has(dropped)).toBe(true);
    expect(fx.heldCcBand(dropped)).toBe(false);
    expect(fx.heldCcBand(1)).toBe(true);
  });

  it('keeps a FAR on-screen victim over a NEAR one behind the camera', () => {
    // Negative ids sit close behind the camera (z > 0); the rest sit far in
    // front. Ranking on raw camera distance would evict an on-screen band for
    // the much nearer behind-camera one, which is the preset-dependent
    // unfairness: on low, offscreen non-actionable rigs are culled before
    // they ever compete, on medium and above they all do.
    const { fx } = makeFx((id) =>
      id < 0 ? new THREE.Vector3(0, 1.8, 2) : new THREE.Vector3(0, 1.8, -50),
    );

    for (let id = 1; id <= MAX_CC_BANDS; id++) fx.holdCcBand(id, 'stun', 3);
    fx.holdCcBand(-1, 'stun', 3);
    fx.update(0.05);

    // Every far in-front victim keeps its slot; the near behind-camera one
    // loses, despite being 25x closer.
    for (let id = 1; id <= MAX_CC_BANDS; id++) expect(fx.heldCcBand(id)).toBe(true);
    expect(fx.heldCcBand(-1)).toBe(false);
  });

  it('still ranks by distance among bands on the same side of the camera', () => {
    const { fx } = makeFx((id) => new THREE.Vector3(0, 1.8, -id));

    // ids 1..N+2 all in front at increasing distance; the two farthest lose.
    for (let id = 1; id <= MAX_CC_BANDS + 2; id++) fx.holdCcBand(id, 'stun', 3);
    fx.update(0.05);

    for (let id = 1; id <= MAX_CC_BANDS; id++) expect(fx.heldCcBand(id)).toBe(true);
    expect(fx.heldCcBand(MAX_CC_BANDS + 1)).toBe(false);
    expect(fx.heldCcBand(MAX_CC_BANDS + 2)).toBe(false);
  });

  it('the held band OWNS the read over a live cast-moment ccStars slot: one band, full alpha', () => {
    const { fx, probe } = makeFx();
    // Hand-cook an otherwise-inert live sequence slot mid-ccStars-tail for
    // the same victim (all one-shot phases done; only the star branch runs).
    const slot = probe.sequencer.slots[0];
    slot.active = true;
    slot.targetId = 7;
    slot.ccStars = 0.2;
    slot.impactDone = true;

    fx.holdCcBand(7, 'stun', 3);
    fx.update(0.05);

    // One band, not two, and the HELD band's full alpha, not the sequencer
    // tail's 0.2: the dip where the cast band's fade hid the stun tell is the
    // regression this pins.
    const stars = bandSpriteIndices(probe, 7, 'stun');
    expect(stars).toHaveLength(CC_BAND_SPECS.stun.count);
    for (const i of stars) expect(probe.overlay.alpha[i]).toBe(1);
  });

  it('a ROOT band stands the cast-moment yellow stars down, so a rooted victim never reads as stunned', () => {
    // The 'cc' archetype flashes the same yellow stars for every control
    // ability (entangling_roots is authored a: 'cc'), so without the any-type
    // handoff a rooted victim wore a stun tell for the burst's length.
    const { fx, probe } = makeFx();
    const slot = probe.sequencer.slots[0];
    slot.active = true;
    slot.targetId = 7;
    slot.ccStars = 1.2;
    slot.impactDone = true;

    fx.holdCcBand(7, 'root', 6);
    fx.update(0.05);

    expect(fx.heldCcBand(7)).toBe(true);
    expect(bandSpriteIndices(probe, 7, 'stun')).toHaveLength(0);
    expect(bandSpriteIndices(probe, 7, 'root')).toHaveLength(CC_BAND_SPECS.root.count);
  });

  it('the cast-moment ccStars still draw alone when no aura band is held (strike flourish)', () => {
    const { fx, probe } = makeFx();
    const slot = probe.sequencer.slots[0];
    slot.active = true;
    slot.targetId = 7;
    slot.ccStars = 1.2;
    slot.impactDone = true;

    fx.update(0.05);

    expect(bandSpriteIndices(probe, 7, 'stun')).toHaveLength(CC_BAND_SPECS.stun.count);
  });

  it('sweeps the band the first frame the feed stops', () => {
    const { fx, probe } = makeFx();

    fx.holdCcBand(7, 'root', 3);
    fx.update(0.05);
    expect(probe.ccBands.has(7)).toBe(true);

    fx.update(0.05);

    expect(probe.ccBands.has(7)).toBe(false);
    expect(probe.overlay.count).toBe(0);
  });

  it('sleepEntity releases only the sleeping entity; clear releases all', () => {
    const { fx, probe } = makeFx();
    fx.holdCcBand(7, 'stun', 3);
    fx.holdCcBand(8, 'fear', 3);
    fx.update(0.05);
    expect(probe.overlay.count).toBe(CC_BAND_SPECS.stun.count + CC_BAND_SPECS.fear.count);

    fx.holdCcBand(7, 'stun', 3);
    fx.holdCcBand(8, 'fear', 3);
    fx.sleepEntity(7);
    expect(probe.ccBands.has(7)).toBe(false);
    expect(probe.ccBands.has(8)).toBe(true);

    fx.clear();
    expect(probe.ccBands.size).toBe(0);
  });
});

describe('online mirror parity', () => {
  // The wire carries every aura's id AND kind (server/game.ts wireAura), which
  // is exactly what the band rule reads, so all three types resolve online
  // with no wire field of their own.
  const CASES: { type: CcBandType; aura: Record<string, unknown>; remaining: number }[] = [
    {
      type: 'stun',
      aura: { id: 'storm_bolt_stun', name: 'Storm Bolt', kind: 'stun', rem: 2.5, dur: 3 },
      remaining: 2.5,
    },
    {
      type: 'root',
      aura: { id: 'ensnare_bog_lurker', name: 'Ensnare', kind: 'root', rem: 4, dur: 4 },
      remaining: 4,
    },
    {
      type: 'fear',
      aura: { id: SHARED_FEAR_AURA_ID, name: 'Harrow', kind: 'incapacitate', rem: 6, dur: 8 },
      remaining: 6,
    },
  ];

  it.each(CASES)('feeds a $type band from a wire-decoded aura on a ClientWorld entity', (c) => {
    const client = bareClient(1);
    const internals = client as unknown as { applySnapshot(snapshot: unknown): void };
    internals.applySnapshot({
      t: 'snap',
      self: { id: 1, k: 'player', tid: 'warrior', nm: 'Thorgar', lv: 12, x: 0, y: 0, z: 0, f: 0 },
      ents: [
        {
          id: 9,
          k: 'mob',
          tid: 'wild_boar',
          nm: 'Wild Boar',
          lv: 2,
          x: 5,
          y: 0,
          z: 5,
          f: 0,
          hp: 100,
          mhp: 100,
          auras: [c.aura],
        },
      ],
    });
    const mirrored = client.entities.get(9);
    expect(mirrored).toBeDefined();
    expect(mirrored?.auras[0]?.kind).toBe(c.aura.kind);

    const { painter, fx } = makePainter();
    painter.syncEntity(mirrored as unknown as AbilityVfxEntityState);

    expect(fx.holdCcBand).toHaveBeenCalledTimes(1);
    const [id, type, remaining] = (fx.holdCcBand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe(9);
    expect(type).toBe(c.type);
    expect(remaining).toBeCloseTo(c.remaining, 1);
  });
});

describe('sequencer handoff surface', () => {
  it('heldCcBand reports the drawn pick set, for that entity only, and lapses on release', () => {
    const { fx } = makeFx();

    // Nothing is claimed until a frame has actually chosen its picks.
    fx.holdCcBand(7, 'stun', 3);
    expect(fx.heldCcBand(7)).toBe(false);

    fx.update(0.05);
    expect(fx.heldCcBand(7)).toBe(true);
    expect(fx.heldCcBand(8)).toBe(false);

    // A frame with no feed drops the band, and the claim with it.
    fx.update(0.05);
    expect(fx.heldCcBand(7)).toBe(false);
  });
});
