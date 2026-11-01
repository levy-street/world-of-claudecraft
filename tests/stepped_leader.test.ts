import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphicsSettingsSnapshot } from '../src/game/graphics_rebuild_core';
import { ARC_BOLT_ABILITY, playArcBolt } from '../src/render/ability_vfx/arc_bolt';
import { SteppedLeaderBolts } from '../src/render/ability_vfx/stepped_leader';
import {
  AFTERGLOW_END_S,
  type ArcBoltLeaderPlan,
  LEADER_STEP_S,
  RESTRIKE_AT_S,
} from '../src/render/ability_vfx/stepped_leader_core';
import {
  activateGfxProfile,
  GFX,
  type GfxCapabilities,
  type GfxProfile,
  getActiveGfxProfile,
  resolveGfxProfile,
} from '../src/render/gfx';
import { LightPulses, type TrackedLightHost } from '../src/render/light_pulses';

const FULL: ArcBoltLeaderPlan = { scale: 1, branches: true, restrike: true };
const DT = 1 / 60;

interface StripCall {
  count: number;
  width: number;
  color: number;
  light: number;
}

function harness(lights: TrackedLightHost | null = null) {
  const strips: StripCall[] = [];
  const crawls: number[] = [];
  const rings: Array<{ x: number; radius: number; color: number }> = [];
  const anchors = new Map<number, THREE.Vector3>([
    [1, new THREE.Vector3(0, 1.5, 0)],
    [2, new THREE.Vector3(14, 1.2, 0)],
  ]);
  const bolts = new SteppedLeaderBolts({
    strip: (_pts, count, width, color, light) => {
      strips.push({ count, width, color: color.getHex(), light });
    },
    crack: (...args: unknown[]) => {
      crawls.push(args.length);
    },
    anchor: (id, _frac, out) => {
      const a = anchors.get(id);
      if (!a) return null;
      return (out ?? new THREE.Vector3()).copy(a);
    },
    ring: (x, _y, _z, radius, color) => rings.push({ x, radius, color }),
  });
  bolts.setLightHost(lights);
  return { bolts, strips, crawls, rings, anchors };
}

function fakeLights() {
  const writes: Array<{ token: number; x: number; intensity: number; color: number }> = [];
  const released: Array<{ token: number; fade: number }> = [];
  let next = 100;
  let stale = false;
  const host: TrackedLightHost = {
    track: () => next++,
    setTracked: (token, x, _y, _z, intensity, color) => {
      if (stale) return false;
      writes.push({ token, x, intensity, color });
      return true;
    },
    releaseTracked: (token, fade) => released.push({ token, fade }),
  };
  return {
    host,
    writes,
    released,
    goStale: () => {
      stale = true;
    },
  };
}

/** Fly the head from the caster to the target at 26 yd/s, advancing each frame. */
function flyTo(
  bolts: SteppedLeaderBolts,
  head: THREE.Vector3,
  to: THREE.Vector3,
  onFrame?: () => void,
): number {
  let frames = 0;
  while (head.distanceTo(to) > 0.3 && frames < 600) {
    const step = Math.min(26 * DT, head.distanceTo(to));
    head.addScaledVector(to.clone().sub(head).normalize(), step);
    bolts.advance(DT, false);
    onFrame?.();
    frames++;
  }
  return frames;
}

describe('SteppedLeaderBolts: the leader rides the projectile', () => {
  it('carves steps while the head flies and draws a three-layer channel', () => {
    const { bolts, strips } = harness();
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = bolts.spawn(1, 2, head, FULL);
    expect(handle).toBeGreaterThanOrEqual(0);
    flyTo(bolts, head, new THREE.Vector3(14, 1.2, 0));
    const tip = new THREE.Vector3();
    expect(bolts.tipOf(handle, tip)).toBe(true);
    expect(tip.distanceTo(head)).toBeLessThan(1e-4);
    strips.length = 0;
    bolts.draw();
    // aura + glow + core over the same, many-pointed channel
    const main = strips.filter((s) => s.count > 10);
    expect(main.length).toBe(3);
    expect(new Set(main.map((s) => s.color)).size).toBe(3);
    expect(main[0].width).toBeGreaterThan(main[1].width);
    expect(main[1].width).toBeGreaterThan(main[2].width);
  });

  it('a stepped leader is carved at the step cadence, not every frame', () => {
    const { bolts, strips } = harness();
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = bolts.spawn(1, 2, head, FULL);
    const channelPoints = (): number => {
      strips.length = 0;
      bolts.draw();
      return Math.max(...strips.map((s) => s.count));
    };
    const framesPerStep = Math.round(LEADER_STEP_S / DT);
    const seen: number[] = [];
    const tip = new THREE.Vector3();
    for (let f = 0; f < framesPerStep * 4; f++) {
      head.x += 26 * DT;
      bolts.advance(DT, false);
      seen.push(channelPoints());
      // between steps the tip still rides the head exactly (it never lags)
      bolts.tipOf(handle, tip);
      expect(tip.x).toBeCloseTo(head.x, 4);
    }
    // the point count only grows on step frames, never every frame
    const growths = seen.filter((n, i) => i > 0 && n > seen[i - 1]).length;
    expect(growths).toBeGreaterThanOrEqual(3);
    expect(growths).toBeLessThanOrEqual(4);
  });

  it('forks branches on the full tier and none on the reduced tier', () => {
    const full = harness();
    const h1 = new THREE.Vector3(0, 1.5, 0);
    full.bolts.spawn(1, 2, h1, FULL);
    vi.spyOn(Math, 'random').mockReturnValue(0.2); // always fork
    flyTo(full.bolts, h1, new THREE.Vector3(14, 1.2, 0));
    full.strips.length = 0;
    full.bolts.draw();
    expect(full.strips.filter((s) => s.count > 1 && s.count <= 6).length).toBeGreaterThan(0);

    const lean = harness();
    const h2 = new THREE.Vector3(0, 1.5, 0);
    lean.bolts.spawn(1, 2, h2, { scale: 1, branches: false, restrike: false });
    flyTo(lean.bolts, h2, new THREE.Vector3(14, 1.2, 0));
    lean.strips.length = 0;
    lean.bolts.draw();
    expect(lean.strips.filter((s) => s.count <= 6).length).toBe(0);
  });

  afterEach(() => vi.restoreAllMocks());
});

describe('SteppedLeaderBolts: the impact sequence', () => {
  it('impact stages the ring and crawl arcs, then stroke, restrike, afterglow, release', () => {
    const lights = fakeLights();
    const { bolts, strips, crawls, rings } = harness(lights.host);
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = bolts.spawn(1, 2, head, FULL);
    flyTo(bolts, head, new THREE.Vector3(14, 1.2, 0));
    const at = new THREE.Vector3(14, 1.2, 0);
    bolts.impact(handle, at);
    expect(rings.length).toBe(1);
    expect(crawls.length).toBe(3);
    // a second impact for the same bolt is ignored
    bolts.impact(handle, at);
    expect(rings.length).toBe(1);

    const peakCore = (): number => {
      strips.length = 0;
      bolts.draw();
      return Math.max(0, ...strips.map((s) => s.light));
    };
    bolts.advance(DT, false);
    const stroke = peakCore();
    expect(stroke).toBeGreaterThan(3); // the blazing return stroke
    let t = DT;
    while (t < RESTRIKE_AT_S + 0.02) {
      bolts.advance(DT, false);
      t += DT;
    }
    expect(peakCore()).toBeGreaterThan(2); // the restrike blazes again
    while (t < AFTERGLOW_END_S - 0.1) {
      bolts.advance(DT, false);
      t += DT;
    }
    const glow = peakCore();
    expect(glow).toBeGreaterThan(0);
    expect(glow).toBeLessThan(1.1); // only the dim violet afterglow remains
    while (t < AFTERGLOW_END_S + 0.05) {
      bolts.advance(DT, false);
      t += DT;
    }
    expect(bolts.activeCount()).toBe(0);
    expect(lights.released).toEqual([{ token: 100, fade: expect.any(Number) }]);
  });

  it('reduced motion never restrikes', () => {
    const { bolts, strips } = harness();
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = bolts.spawn(1, 2, head, FULL);
    flyTo(bolts, head, new THREE.Vector3(14, 1.2, 0));
    bolts.impact(handle, head.clone());
    let t = 0;
    while (t < RESTRIKE_AT_S + 0.02) {
      bolts.advance(DT, true);
      t += DT;
    }
    strips.length = 0;
    bolts.draw();
    expect(Math.max(...strips.map((s) => s.light))).toBeLessThan(1.1);
  });

  it('a lost projectile drops the leader and its light with no stroke', () => {
    const lights = fakeLights();
    const { bolts, rings } = harness(lights.host);
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = bolts.spawn(1, 2, head, FULL);
    bolts.advance(DT, false);
    bolts.lost(handle);
    expect(bolts.activeCount()).toBe(0);
    expect(rings.length).toBe(0);
    expect(lights.released.length).toBe(1);
    // a stale handle is inert
    bolts.impact(handle, head);
    expect(rings.length).toBe(0);
  });

  it('recycles the oldest bolt when every slot is busy', () => {
    const { bolts } = harness();
    const handles: number[] = [];
    for (let i = 0; i < 5; i++) {
      handles.push(bolts.spawn(1, 2, new THREE.Vector3(0, 1.5, 0), FULL));
      bolts.advance(DT, false);
    }
    expect(bolts.activeCount()).toBe(4);
    const tip = new THREE.Vector3();
    expect(bolts.tipOf(handles[0], tip)).toBe(false); // the first was recycled
    expect(bolts.tipOf(handles[4], tip)).toBe(true);
  });
});

describe('SteppedLeaderBolts: the moving light', () => {
  it('follows the head in flight, then floods the impact, standing off the body', () => {
    const lights = fakeLights();
    const { bolts } = harness(lights.host);
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = bolts.spawn(1, 2, head, FULL);
    const xs: number[] = [];
    flyTo(bolts, head, new THREE.Vector3(14, 1.2, 0), () => xs.push(lights.writes.at(-1)?.x ?? -1));
    // the light rode the head across the whole flight
    expect(xs[0]).toBeLessThan(1);
    expect(xs.at(-1)).toBeGreaterThan(12);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 1e-6);
    const flight = lights.writes[lights.writes.length - 1];
    bolts.impact(handle, new THREE.Vector3(14, 1.2, 0));
    bolts.advance(DT, false);
    const strike = lights.writes[lights.writes.length - 1];
    expect(strike.intensity).toBeGreaterThan(flight.intensity * 2);
    expect(strike.color).not.toBe(flight.color);
    expect(strike.x).toBeLessThan(14); // back toward the caster, not inside the mob
    expect(strike.x).toBeGreaterThan(12);
  });

  it('stops writing once its slot was taken by a higher-priority pulse', () => {
    const lights = fakeLights();
    const { bolts } = harness(lights.host);
    const head = new THREE.Vector3(0, 1.5, 0);
    bolts.spawn(1, 2, head, FULL);
    bolts.advance(DT, false);
    const n = lights.writes.length;
    lights.goStale();
    bolts.advance(DT, false);
    bolts.advance(DT, false);
    expect(lights.writes.length).toBe(n);
  });

  it('draws fine with no light host at all', () => {
    const { bolts } = harness(null);
    const head = new THREE.Vector3(0, 1.5, 0);
    bolts.spawn(1, 2, head, FULL);
    expect(() => flyTo(bolts, head, new THREE.Vector3(14, 1.2, 0))).not.toThrow();
  });
});

describe('LightPulses: tracked lights borrow the pulse pool', () => {
  // The goblin_rocket_sled_fx.test.ts rig: a desktop capability set, a tier
  // forced through the URL, the prior profile restored after each case.
  const capabilities: GfxCapabilities = Object.freeze({
    deviceMemory: 8,
    hardwareConcurrency: 12,
    maxTouchPoints: 0,
    coarsePointer: false,
    narrowViewport: false,
    gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)',
    nativeApp: false,
    tightMemory: false,
    platform: 'other',
    softwareRendering: false,
  });
  const preferences: GraphicsSettingsSnapshot = {
    graphicsPreset: 2,
    terrainDetail: 1,
    foliageDensity: 1,
    surfaceDetail: 1,
    effectsQuality: 1,
    shadowQuality: 1,
    antiAliasing: 1,
    bloomQuality: 1,
    ambientOcclusion: 1,
    viewDistance: 1,
    waterQuality: 1,
    characterDetail: 1,
    dynamicLights: 1,
    particleEffects: 1,
    ghostFade: 0,
  };
  let restore: GfxProfile | null = null;
  beforeEach(() => {
    restore = getActiveGfxProfile();
  });
  afterEach(() => {
    if (restore) activateGfxProfile(restore);
    restore = null;
  });

  function pool(rich: boolean): LightPulses {
    activateGfxProfile(
      resolveGfxProfile(capabilities, preferences, rich ? '?gfx=ultra' : '?gfx=low'),
    );
    expect(GFX.composer).toBe(rich);
    return new LightPulses(new THREE.Scene());
  }

  it('creates no new light: the tracked slot is one of the pooled lights', () => {
    const lp = pool(true);
    expect(lp.lights.length).toBe(4);
    const token = lp.track();
    expect(token).toBeGreaterThanOrEqual(0);
    expect(lp.setTracked(token, 1, 2, 3, 7, 0x123456, 9)).toBe(true);
    const lit = lp.lights.filter((l) => l.intensity > 0);
    expect(lit.length).toBe(1);
    expect(lit[0].position.toArray()).toEqual([1, 2, 3]);
    expect(lit[0].color.getHex()).toBe(0x123456);
    expect(lit[0].distance).toBe(9);
  });

  it('the per-frame decay leaves a tracked light alone; a release fades it out', () => {
    const lp = pool(true);
    const token = lp.track();
    lp.setTracked(token, 0, 0, 0, 8, 0xffffff, 9);
    lp.update(0.5);
    expect(lp.lights.find((l) => l.intensity > 0)?.intensity).toBe(8);
    lp.releaseTracked(token, 0.2);
    expect(lp.setTracked(token, 0, 0, 0, 8, 0xffffff, 9)).toBe(false); // stale now
    lp.update(0.1);
    const mid = Math.max(...lp.lights.map((l) => l.intensity));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(8);
    lp.update(0.2);
    expect(Math.max(...lp.lights.map((l) => l.intensity))).toBe(0);
  });

  it('a tracked light never steals; ordinary pulses prefer free and decaying slots', () => {
    const lp = pool(true);
    const tokens = [lp.track(), lp.track()];
    lp.pulse(new THREE.Vector3(), 'fire');
    lp.pulse(new THREE.Vector3(), 'fire');
    expect(lp.track()).toBe(-1); // all four busy: no steal
    lp.pulse(new THREE.Vector3(), 'frost'); // saturated: steals a decaying pulse
    for (const t of tokens) expect(lp.setTracked(t, 0, 0, 0, 1, 0xffffff, 5)).toBe(true);
  });

  it('on the one-light tier a pulse may take the tracked slot, and the owner sees it', () => {
    const lp = pool(false);
    expect(lp.lights.length).toBe(1);
    const token = lp.track();
    expect(lp.setTracked(token, 0, 0, 0, 5, 0xffffff, 5)).toBe(true);
    lp.pulse(new THREE.Vector3(), 'holy', 6, 0.4, 7);
    expect(lp.setTracked(token, 0, 0, 0, 5, 0xffffff, 5)).toBe(false);
    lp.update(0.01);
    expect(lp.lights[0].intensity).toBeGreaterThan(0); // the pulse owns it now
  });
});

describe('playArcBolt: Arc Bolt routes its cue onto the stepped leader', () => {
  function fakes(headOut: THREE.Vector3 | null) {
    const calls: Array<{ opts: unknown }> = [];
    const fx = {
      steppedLeader: vi.fn(
        (_s: number, _t: number, _head: THREE.Vector3, _plan: ArcBoltLeaderPlan) => 42,
      ),
      steppedLeaderImpact: vi.fn(),
      steppedLeaderLost: vi.fn(),
    };
    let captured: { onImpact?: (p: THREE.Vector3) => void; onLost?: () => void; tip?: boolean } =
      {};
    const vfx = {
      lightningProjectile: (_s: number, _t: number, _c?: number, opts?: typeof captured) => {
        calls.push({ opts });
        captured = opts ?? {};
        return headOut;
      },
    };
    return { calls, fx, vfx, captured: () => captured };
  }

  it('is keyed to the lightning_bolt ability id', () => {
    expect(ARC_BOLT_ABILITY).toBe('lightning_bolt');
  });

  it('launches a tipped projectile and rides it with a leader; impact and loss route by handle', () => {
    const head = new THREE.Vector3(1, 2, 3);
    const f = fakes(head);
    expect(playArcBolt(f.vfx, f.fx, 1, 2, 0x8fd0ff, 0, false)).toBe(true);
    expect(f.calls.length).toBe(1);
    expect(f.captured().tip).toBe(true);
    expect(f.fx.steppedLeader).toHaveBeenCalledWith(1, 2, head, {
      scale: 1,
      branches: true,
      restrike: true,
    });
    const at = new THREE.Vector3(9, 9, 9);
    f.captured().onImpact?.(at);
    expect(f.fx.steppedLeaderImpact).toHaveBeenCalledWith(42, at);
    f.captured().onLost?.();
    expect(f.fx.steppedLeaderLost).toHaveBeenCalledWith(42);
  });

  it('the overload echo rides a smaller leader', () => {
    const f = fakes(new THREE.Vector3());
    playArcBolt(f.vfx, f.fx, 1, 2, 0x8fd0ff, 0, true);
    expect(f.fx.steppedLeader.mock.calls[0][3]).toEqual({
      scale: 0.7,
      branches: true,
      restrike: false,
    });
  });

  it('the spam-floor tier declines, so the painter keeps its color-only projectile', () => {
    const f = fakes(new THREE.Vector3());
    expect(playArcBolt(f.vfx, f.fx, 1, 2, 0x8fd0ff, 2, false)).toBe(false);
    expect(f.calls.length).toBe(0);
    expect(f.fx.steppedLeader).not.toHaveBeenCalled();
  });

  it('a caster with no anchor launches nothing and starts no leader, yet the cue is handled', () => {
    const f = fakes(null);
    expect(playArcBolt(f.vfx, f.fx, 1, 2, 0x8fd0ff, 0, false)).toBe(true);
    expect(f.fx.steppedLeader).not.toHaveBeenCalled();
  });
});
