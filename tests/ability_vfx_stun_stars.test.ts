// The persistent stunned-star tell: a worn `kind: 'stun'` aura circles a star
// band over the victim's head for the aura's whole life. Matched by aura KIND,
// never the spec table, so every stun source reads (player abilities, mob
// stomps) online and offline; the fx engine sweeps the band the frame the
// aura fades. Covers the pure core read, the painter feed (color accent, dead
// gate, presentation gate), and the fx-side draw/sweep/sleep lifecycle with
// its fairness pins: first overlay slots, quality-tier immunity, the
// MAX_STUN_STAR_BANDS cap, the alpha floor, and the sequencer handoff.
// Exhaustive shed set, for the record: the only paths that drop a live band
// are the frame-stamp sweep (aura faded or entity out of the renderer's sync
// range), sleepEntity via syncEntity(e, false) (a frustum-culled,
// non-actionable rig), the dead gate, and the nearest-camera cap; no quality
// tier, budget tier, or governor state reaches it.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { OVERLAY_CELL } from '../src/render/ability_vfx/fx_textures';
import type { AbilityVfxDeps, AbilityVfxEntityState } from '../src/render/ability_vfx/painter';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import {
  insertStunBandPick,
  MAX_STUN_STAR_BANDS,
  STUN_STAR_ALPHA_FLOOR,
  STUN_STAR_BRIGHTNESS,
  STUN_STAR_COLOR,
  STUN_STAR_COUNT,
  stunBandRankKey,
  wornStunIndex,
} from '../src/render/ability_vfx_core';
import { ABILITY_VFX_SPECS } from '../src/render/ability_vfx_specs';
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
  stunStars: Map<number, { remaining: number; stamp: number }>;
  overlay: { count: number; alpha: Float32Array; cell: Float32Array; col: Float32Array };
  sequencer: {
    slots: { active: boolean; targetId: number; ccStars: number; impactDone: boolean }[];
  };
}

// The anchor spreads entities along x by id so the nearest-camera selection
// has real distances to rank (camera sits at the origin looking down -z).
function makeFx(anchor?: (id: number) => THREE.Vector3): { fx: AbilityVfxFx; probe: FxProbe } {
  installCanvasStub();
  // Identity rotation, so the camera sits at the origin looking down -z:
  // z < 0 is in front of it, z > 0 is behind.
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.updateMatrixWorld();
  const fx = new AbilityVfxFx(
    new THREE.Scene(),
    camera,
    anchor ?? ((id: number) => new THREE.Vector3(id, 1.8, -5)),
    () => 0,
  );
  return { fx, probe: fx as unknown as FxProbe };
}

function makePainter() {
  const fx = {
    setDelegates: vi.fn(),
    warmSpiritsForClass: vi.fn(),
    windup: vi.fn().mockReturnValue(false),
    holdShell: vi.fn(),
    holdGroundAura: vi.fn().mockReturnValue(true),
    holdStunStars: vi.fn(),
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

// Indices of the frame's star-cell overlay sprites orbiting the given
// entity's head (a hand-cooked sequencer slot also draws other transients,
// including stray stars at its own impact point; the handoff pins care about
// the band around the victim). The test anchor puts entity id at x = id.
function bandStarIndices(probe: FxProbe, entityId: number): number[] {
  const pos = (probe.overlay as unknown as { pos: Float32Array }).pos;
  const out: number[] = [];
  for (let i = 0; i < probe.overlay.count; i++) {
    if (probe.overlay.cell[i] === OVERLAY_CELL.star && Math.abs(pos[i * 3] - entityId) <= 0.5) {
      out.push(i);
    }
  }
  return out;
}

describe('wornStunIndex (pure core)', () => {
  it('returns -1 when no aura is a stun, whatever the ids look like', () => {
    expect(wornStunIndex([])).toBe(-1);
    expect(
      wornStunIndex([
        { kind: 'slow', remaining: 4 },
        { kind: 'root', remaining: 2 },
        { id: 'storm_bolt_stun' } as { kind?: string; remaining?: number },
      ]),
    ).toBe(-1);
  });

  it('returns the index of the longest-remaining worn stun aura', () => {
    expect(
      wornStunIndex([
        { kind: 'stun', remaining: 1.5 },
        { kind: 'buff', remaining: 300 },
        { kind: 'stun', remaining: 2.75 },
      ]),
    ).toBe(2);
  });

  it('treats a stun with no remaining as 1s live, and one at exactly 0 as expired', () => {
    expect(wornStunIndex([{ kind: 'stun' }])).toBe(0);
    expect(wornStunIndex([{ kind: 'stun', remaining: 0 }])).toBe(-1);
  });

  it('pins the constant itself to the classic dizzy-stars yellow', () => {
    expect(STUN_STAR_COLOR).toBe(0xffd700);
  });
});

describe('band selection (pure core)', () => {
  // Drive the ranking + bounded insertion directly, rather than only through
  // the frame path, so the ordering rules are pinned on their own.
  function pick(entries: { id: number; dist2: number; inFront: boolean }[], max: number): number[] {
    const ids: number[] = new Array(Math.max(max, 1)).fill(0);
    const keys: number[] = new Array(Math.max(max, 1)).fill(0);
    let count = 0;
    for (const e of entries) {
      count = insertStunBandPick(ids, keys, count, e.id, stunBandRankKey(e.dist2, e.inFront), max);
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

  it('is a no-op at zero capacity and never exceeds max', () => {
    expect(pick([{ id: 1, dist2: 1, inFront: true }], 0)).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => ({ id: i, dist2: i, inFront: true }));
    expect(pick(many, MAX_STUN_STAR_BANDS)).toHaveLength(MAX_STUN_STAR_BANDS);
  });
});

describe('painter feeds the stun tell from the aura KIND, not the spec table', () => {
  it('holds stars for a stun aura whose id has no vfx spec (a mob stomp)', () => {
    const { painter, fx } = makePainter();
    const auraId = 'war_stomp_stun';
    expect(ABILITY_VFX_SPECS[auraId]).toBeUndefined();

    painter.syncEntity(ent([{ id: auraId, kind: 'stun', remaining: 2.5 }]));

    expect(fx.holdStunStars).toHaveBeenCalledWith(7, 2.5);
  });

  it('holds stars for a spec-suffixed player stun too, every frame it is worn', () => {
    const { painter, fx } = makePainter();
    const e = ent([{ id: 'storm_bolt_stun', kind: 'stun', remaining: 3 }]);

    painter.syncEntity(e);
    painter.syncEntity(e);

    expect(fx.holdStunStars).toHaveBeenCalledTimes(2);
    expect(fx.holdStunStars).toHaveBeenLastCalledWith(7, 3);
  });

  it('holds nothing for non-stun debuffs, buffs, or an expired stun', () => {
    const { painter, fx } = makePainter();

    painter.syncEntity(
      ent([
        { id: 'hamstring_slow', kind: 'slow', remaining: 8 },
        { id: 'arcane_intellect', kind: 'buff', remaining: 1800 },
        { id: 'storm_bolt_stun', kind: 'stun', remaining: 0 },
      ]),
    );

    expect(fx.holdStunStars).not.toHaveBeenCalled();
  });

  it('holds nothing on a dead body, even under a death-surviving stun aura', () => {
    const { painter, fx } = makePainter();

    painter.syncEntity(
      ent([{ id: 'nythraxis_transition_stun', kind: 'stun', remaining: 9 }], 7, true),
    );

    expect(fx.holdStunStars).not.toHaveBeenCalled();
  });

  it('holds nothing at 0 hp before the dead flag has landed', () => {
    const { painter, fx } = makePainter();
    const e = ent([{ id: 'storm_bolt_stun', kind: 'stun', remaining: 3 }]);

    painter.syncEntity({ ...e, hp: 0 });

    expect(fx.holdStunStars).not.toHaveBeenCalled();
  });

  it('sleeps instead of holding when presentation is gated off', () => {
    const { painter, fx } = makePainter();

    painter.syncEntity(ent([{ id: 'storm_bolt_stun', kind: 'stun', remaining: 3 }]), false);

    expect(fx.sleepEntity).toHaveBeenCalledWith(7);
    expect(fx.holdStunStars).not.toHaveBeenCalled();
  });
});

describe('fx engine draws and sweeps the held star band', () => {
  it('draws STUN_STAR_COUNT star sprites while fed, at the remaining-driven alpha', () => {
    const { fx, probe } = makeFx();

    fx.holdStunStars(7, 0.5);
    fx.update(0.05);

    expect(probe.overlay.count).toBe(STUN_STAR_COUNT);
    for (let k = 0; k < STUN_STAR_COUNT; k++) expect(probe.overlay.alpha[k]).toBeCloseTo(0.5);
  });

  it('draws the band in STUN_STAR_COLOR, identically for a spec-backed and an unspec-backed stun', () => {
    const { fx, probe } = makeFx();
    // Expected channels come from the constant through the same conversion
    // OverlaySprites.push applies, so a hardcoded colour at the push site
    // fails this even though the constant is untouched.
    const want = new THREE.Color().setHex(STUN_STAR_COLOR).multiplyScalar(STUN_STAR_BRIGHTNESS);

    // id 7 stands in for a spec-backed stun (storm_bolt_stun), id 8 for one
    // with no vfx spec at all (a mob stomp): the painter passes no colour for
    // either, so the drawn channels must be byte-identical.
    fx.holdStunStars(7, 3);
    fx.holdStunStars(8, 3);
    fx.update(0.05);

    expect(probe.overlay.count).toBe(2 * STUN_STAR_COUNT);
    for (let i = 0; i < probe.overlay.count; i++) {
      expect(probe.overlay.col[i * 3]).toBeCloseTo(want.r, 5);
      expect(probe.overlay.col[i * 3 + 1]).toBeCloseTo(want.g, 5);
      // no blue: the additive overbright must clamp toward yellow, not white
      expect(probe.overlay.col[i * 3 + 2]).toBeCloseTo(0, 5);
    }
  });

  it('clamps alpha to 1 above a second remaining and to the floor near expiry', () => {
    const { fx, probe } = makeFx();

    fx.holdStunStars(7, 3);
    fx.update(0.05);
    expect(probe.overlay.alpha[0]).toBe(1);

    fx.holdStunStars(7, 0.05);
    fx.update(0.05);
    expect(probe.overlay.alpha[0]).toBeCloseTo(STUN_STAR_ALPHA_FLOOR);
  });

  it('occupies the FIRST overlay slots, ahead of a windup fed in the same frame', () => {
    const { fx, probe } = makeFx();

    fx.windup(3, 0xff0000, 0.5);
    fx.holdStunStars(7, 3);
    fx.update(0.05);

    expect(probe.overlay.count).toBeGreaterThan(STUN_STAR_COUNT);
    for (let k = 0; k < STUN_STAR_COUNT; k++) {
      expect(probe.overlay.cell[k]).toBe(OVERLAY_CELL.star);
      expect(probe.overlay.alpha[k]).toBe(1);
    }
  });

  it('ignores the quality tier entirely: tier 0 sheds nothing from the tell', () => {
    const { fx, probe } = makeFx();
    fx.setQuality(0);

    fx.holdStunStars(7, 3);
    fx.update(0.05);

    expect(probe.overlay.count).toBe(STUN_STAR_COUNT);
    expect(probe.overlay.alpha[0]).toBe(1);
  });

  it('caps a mass stun at the MAX_STUN_STAR_BANDS nearest entities', () => {
    const { fx, probe } = makeFx();

    // Anchor x = id, camera at origin: lower ids are nearer.
    for (let id = 1; id <= MAX_STUN_STAR_BANDS + 6; id++) fx.holdStunStars(id, 3);
    fx.update(0.05);

    expect(probe.overlay.count).toBe(MAX_STUN_STAR_BANDS * STUN_STAR_COUNT);
    // Every held entry survives the cap; only the draw is bounded.
    expect(probe.stunStars.size).toBe(MAX_STUN_STAR_BANDS + 6);
  });

  it('does not claim the read for a band the cap dropped, so its cast-moment stars still draw', () => {
    const { fx, probe } = makeFx();

    // Saturate the cap with nearer victims, then a far one that loses its slot.
    for (let id = 1; id <= MAX_STUN_STAR_BANDS; id++) fx.holdStunStars(id, 3);
    const dropped = 900;
    fx.holdStunStars(dropped, 3);
    fx.update(0.05);

    // It is held and fed, but it did not win a slot, so the sequencer must NOT
    // stand down for it: answering "was fed" here left the 9th victim with no
    // overhead read at all, which is worse than before the feature existed.
    expect(probe.stunStars.has(dropped)).toBe(true);
    expect(fx.heldStunStars(dropped)).toBe(false);
    expect(fx.heldStunStars(1)).toBe(true);
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

    for (let id = 1; id <= MAX_STUN_STAR_BANDS; id++) fx.holdStunStars(id, 3);
    fx.holdStunStars(-1, 3);
    fx.update(0.05);

    // Every far in-front victim keeps its slot; the near behind-camera one
    // loses, despite being 25x closer.
    for (let id = 1; id <= MAX_STUN_STAR_BANDS; id++) {
      expect(fx.heldStunStars(id)).toBe(true);
    }
    expect(fx.heldStunStars(-1)).toBe(false);
  });

  it('still ranks by distance among bands on the same side of the camera', () => {
    const { fx } = makeFx((id) => new THREE.Vector3(0, 1.8, -id));

    // ids 1..N+2 all in front at increasing distance; the two farthest lose.
    for (let id = 1; id <= MAX_STUN_STAR_BANDS + 2; id++) fx.holdStunStars(id, 3);
    fx.update(0.05);

    for (let id = 1; id <= MAX_STUN_STAR_BANDS; id++) expect(fx.heldStunStars(id)).toBe(true);
    expect(fx.heldStunStars(MAX_STUN_STAR_BANDS + 1)).toBe(false);
    expect(fx.heldStunStars(MAX_STUN_STAR_BANDS + 2)).toBe(false);
  });

  it('the held band OWNS the read over a live cast-moment ccStars slot: 4 sprites, full alpha, never 8', () => {
    const { fx, probe } = makeFx();
    // Hand-cook an otherwise-inert live sequence slot mid-ccStars-tail for
    // the same victim (all one-shot phases done; only the star branch runs).
    const slot = probe.sequencer.slots[0];
    slot.active = true;
    slot.targetId = 7;
    slot.ccStars = 0.2;
    slot.impactDone = true;

    fx.holdStunStars(7, 3);
    fx.update(0.05);

    // One band, not two, and the HELD band's full alpha, not the sequencer
    // tail's 0.2: the dip where the cast band's fade hid the stun tell is the
    // regression this pins.
    const stars = bandStarIndices(probe, 7);
    expect(stars).toHaveLength(STUN_STAR_COUNT);
    for (const i of stars) expect(probe.overlay.alpha[i]).toBe(1);
  });

  it('the cast-moment ccStars still draw alone when no aura band is held (strike flourish)', () => {
    const { fx, probe } = makeFx();
    const slot = probe.sequencer.slots[0];
    slot.active = true;
    slot.targetId = 7;
    slot.ccStars = 1.2;
    slot.impactDone = true;

    fx.update(0.05);

    expect(bandStarIndices(probe, 7)).toHaveLength(STUN_STAR_COUNT);
  });

  it('sweeps the band the first frame the feed stops', () => {
    const { fx, probe } = makeFx();

    fx.holdStunStars(7, 3);
    fx.update(0.05);
    expect(probe.stunStars.has(7)).toBe(true);

    fx.update(0.05);

    expect(probe.stunStars.has(7)).toBe(false);
    expect(probe.overlay.count).toBe(0);
  });

  it('sleepEntity releases only the sleeping entity; clear releases all', () => {
    const { fx, probe } = makeFx();
    fx.holdStunStars(7, 3);
    fx.holdStunStars(8, 3);
    fx.update(0.05);
    expect(probe.overlay.count).toBe(2 * STUN_STAR_COUNT);

    fx.holdStunStars(7, 3);
    fx.holdStunStars(8, 3);
    fx.sleepEntity(7);
    expect(probe.stunStars.has(7)).toBe(false);
    expect(probe.stunStars.has(8)).toBe(true);

    fx.clear();
    expect(probe.stunStars.size).toBe(0);
  });
});

describe('online mirror parity', () => {
  it('feeds the band from a wire-decoded stun aura on a ClientWorld entity', () => {
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
          auras: [{ id: 'storm_bolt_stun', name: 'Storm Bolt', kind: 'stun', rem: 2.5, dur: 3 }],
        },
      ],
    });
    const mirrored = client.entities.get(9);
    expect(mirrored).toBeDefined();
    expect(mirrored?.auras[0]?.kind).toBe('stun');

    const { painter, fx } = makePainter();
    painter.syncEntity(mirrored as unknown as AbilityVfxEntityState);

    expect(fx.holdStunStars).toHaveBeenCalledTimes(1);
    const [id, remaining] = (fx.holdStunStars as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe(9);
    expect(remaining).toBeCloseTo(2.5, 1);
  });
});

describe('sequencer handoff surface', () => {
  it('heldStunStars reports the drawn pick set, for that entity only, and lapses on release', () => {
    const { fx } = makeFx();

    // Nothing is claimed until a frame has actually chosen its picks.
    fx.holdStunStars(7, 3);
    expect(fx.heldStunStars(7)).toBe(false);

    fx.update(0.05);
    expect(fx.heldStunStars(7)).toBe(true);
    expect(fx.heldStunStars(8)).toBe(false);

    // A frame with no feed drops the band, and the claim with it.
    fx.update(0.05);
    expect(fx.heldStunStars(7)).toBe(false);
  });
});
