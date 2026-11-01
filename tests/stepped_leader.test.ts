import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Vfx's sprite atlas loads through the asset loader; the contract tests below
// build a real Vfx, so stub the loader the way cast_vfx_engine_family does.
vi.mock('../src/render/assets/loader', () => ({
  loadTexture: vi.fn(async () => ({ image: null })),
  releaseTexture: vi.fn(),
}));
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn(),
}));

import type { GraphicsSettingsSnapshot } from '../src/game/graphics_rebuild_core';
import { ARC_BOLT_ABILITY, playArcBolt } from '../src/render/ability_vfx/arc_bolt';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
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
import { Vfx } from '../src/render/vfx';
import { createVfxAnchor } from '../src/render/vfx_anchor';
import { installCastVfxCanvasStub } from './helpers/cast_vfx_headless';

const FULL: ArcBoltLeaderPlan = { scale: 1, branches: true, restrike: true, aura: true };
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
    // core first, then glow, then the wide aura: the shared pool refuses a
    // strip whole, so under vertex pressure the dim outer layer is what drops
    expect(main[0].width).toBeLessThan(main[1].width);
    expect(main[1].width).toBeLessThan(main[2].width);
    expect(main[0].light).toBeGreaterThan(main[2].light);
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
    lean.bolts.spawn(1, 2, h2, { scale: 1, branches: false, restrike: false, aura: true });
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
      steppedLeaderStrike: vi.fn((_s: number, _t: number, _plan: ArcBoltLeaderPlan) => true),
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
      aura: true,
    });
    const at = new THREE.Vector3(9, 9, 9);
    f.captured().onImpact?.(at);
    expect(f.fx.steppedLeaderImpact).toHaveBeenCalledWith(42, at);
    f.captured().onLost?.();
    expect(f.fx.steppedLeaderLost).toHaveBeenCalledWith(42);
  });

  it('the overload echo strikes at once (its damage lands on the cast tick), smaller', () => {
    const f = fakes(new THREE.Vector3());
    expect(playArcBolt(f.vfx, f.fx, 1, 2, 0x8fd0ff, 0, true)).toBe(true);
    expect(f.calls.length).toBe(0); // no flying projectile for the echo
    expect(f.fx.steppedLeader).not.toHaveBeenCalled();
    expect(f.fx.steppedLeaderStrike.mock.calls[0][2]).toEqual({
      scale: 0.7,
      branches: true,
      restrike: false,
      aura: true,
    });
  });

  it('low VFX quality reaches the plan: branches go first, then the aura', () => {
    const f = fakes(new THREE.Vector3());
    playArcBolt(f.vfx, f.fx, 1, 2, 0x8fd0ff, 0, false, 0.4);
    expect(f.fx.steppedLeader.mock.calls[0][3]).toMatchObject({ branches: false, aura: true });
    playArcBolt(f.vfx, f.fx, 1, 2, 0x8fd0ff, 0, false, 0.1);
    expect(f.fx.steppedLeader.mock.calls[1][3]).toMatchObject({ branches: false, aura: false });
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

describe('the real painter routes Arc Bolt onto the stepped leader', () => {
  function rig() {
    installCastVfxCanvasStub();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
    const place = (id: number) => ({ x: id * 6, z: 0 });
    const anchor = createVfxAnchor((id, pose) => {
      const at = place(id);
      pose.x = at.x;
      pose.y = 0;
      pose.z = at.z;
      pose.height = 2;
      return true;
    });
    const fx = new AbilityVfxFx(
      scene,
      camera,
      anchor,
      () => 0,
      () => 0,
    );
    const launches: Array<{ args: unknown[] }> = [];
    const record = () => () => {};
    const painter = new AbilityVfx(
      {
        fx,
        vfx: {
          projectile: record(),
          lightningProjectile: (...args: unknown[]) => {
            launches.push({ args });
            return new THREE.Vector3(0, 1.2, 0);
          },
          burst: record(),
          nova: record(),
          tick: record(),
          shoutwave: record(),
          buffSwirl: record(),
          beam: record(),
        },
        anchor: (id, heightFrac) => ({ ...place(id), y: heightFrac * 2 }),
        spawnAoeRing: () => {},
        triggerAttack: () => {},
        localPlayerId: () => 1,
        isWarrior: () => false,
        isLivingWarrior: () => false,
        isMob: () => false,
        castingAbilityOf: () => null,
        castVfxAdmit: () => true,
        castVfxReady: () => true,
      },
      () => 0,
    );
    return { fx, painter, launches };
  }
  const cue = (fx: string, ability: string) => ({
    type: 'spellfx' as const,
    sourceId: 1,
    targetId: 2,
    school: 'nature',
    fx,
    ability,
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the Arc Bolt cast cue launches a tipped projectile ridden by a leader', () => {
    const { fx, painter, launches } = rig();
    expect(painter.handleSpellfx(cue('lightning', 'lightning_bolt'))).toBe(true);
    expect(launches.length).toBe(1);
    expect((launches[0].args[3] as { tip?: boolean } | undefined)?.tip).toBe(true);
    expect(fx.steppedLeaderCount()).toBe(1);
  });

  it('the Arc Overload echo (a projectile cue) strikes at once with a leader', () => {
    const { fx, painter, launches } = rig();
    expect(painter.handleSpellfx(cue('projectile', 'lightning_bolt'))).toBe(true);
    expect(launches.length).toBe(0);
    expect(fx.steppedLeaderCount()).toBe(1);
  });

  it("another ability's lightning cue keeps the old look: no leader, no tip", () => {
    const { fx, painter, launches } = rig();
    painter.handleSpellfx(cue('lightning', 'chain_lightning'));
    expect(fx.steppedLeaderCount()).toBe(0);
    for (const l of launches) expect(l.args[3]).toBeUndefined();
  });
});

describe('SteppedLeaderBolts: failsafes and the instant strike', () => {
  it('an orphan leader (its projectile went without a callback) stands down with its light', () => {
    const lights = fakeLights();
    const { bolts } = harness(lights.host);
    bolts.spawn(1, 2, new THREE.Vector3(0, 1.5, 0), FULL); // the head never moves
    for (let t = 0; t < 3.5; t += DT) bolts.advance(DT, false);
    expect(bolts.activeCount()).toBe(0);
    expect(lights.released.length).toBe(1);
  });

  it('strike() carves the whole path to the target and strokes at once', () => {
    const lights = fakeLights();
    const { bolts, strips, rings } = harness(lights.host);
    expect(bolts.strike(1, 2, { ...FULL, scale: 0.7, restrike: false })).toBe(true);
    expect(rings.length).toBe(1);
    bolts.advance(DT, false);
    strips.length = 0;
    bolts.draw();
    const channel = strips.filter((st) => st.count > 10);
    expect(channel.length).toBeGreaterThan(0);
    expect(Math.max(...strips.map((st) => st.light))).toBeGreaterThan(2); // stroke, not leader
    const lit = lights.writes[lights.writes.length - 1];
    expect(lit.x).toBeGreaterThan(10); // the flash stands at the far (target) end
  });

  it('strike() refuses a target with no anchor and claims nothing', () => {
    const lights = fakeLights();
    const { bolts, anchors } = harness(lights.host);
    anchors.delete(2);
    expect(bolts.strike(1, 2, FULL)).toBe(false);
    expect(bolts.activeCount()).toBe(0);
    expect(lights.writes.length).toBe(0);
  });

  it('reduced motion: a steady flight light and a stroke light held to the engine clamp', () => {
    const lights = fakeLights();
    const { bolts } = harness(lights.host);
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = bolts.spawn(1, 2, head, FULL);
    const seen = new Set<number>();
    for (let f = 0; f < 20; f++) {
      head.x += 26 * DT;
      bolts.advance(DT, true);
      seen.add(lights.writes[lights.writes.length - 1].intensity);
    }
    expect(seen.size).toBe(1); // no flicker
    bolts.impact(handle, head.clone());
    let peak = 0;
    for (let t = 0; t < 0.6; t += DT) {
      bolts.advance(DT, true);
      peak = Math.max(peak, lights.writes[lights.writes.length - 1].intensity);
    }
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(0);
  });
});

describe('LightPulses: moving lights never take the last ordinary slot', () => {
  it('on a pool of four, at most three slots can be tracked', () => {
    const lp = new LightPulses(new THREE.Scene());
    const cap = lp.lights.length;
    const tokens: number[] = [];
    for (let i = 0; i < cap + 1; i++) tokens.push(lp.track());
    const held = tokens.filter((t) => t >= 0).length;
    expect(held).toBe(cap > 1 ? cap - 1 : 1);
  });
});

describe('Vfx: the lightning projectile contract the leader rides', () => {
  function rig() {
    installCastVfxCanvasStub();
    const at = new Map<number, THREE.Vector3>([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(10, 1, 0)],
    ]);
    const vfx = new Vfx(new THREE.Scene(), (id, _frac, out) => {
      const p = at.get(id);
      return p ? (out ?? new THREE.Vector3()).copy(p) : null;
    });
    return { vfx, at };
  }
  afterEach(() => vi.unstubAllGlobals());

  it('returns the live head, moved in place, and calls onImpact once on arrival', () => {
    const { vfx } = rig();
    const onImpact = vi.fn();
    const onLost = vi.fn();
    const head = vfx.lightningProjectile(1, 2, 0x8fd0ff, { tip: true, onImpact, onLost });
    expect(head).toBeInstanceOf(THREE.Vector3);
    const x0 = head?.x ?? 0;
    vfx.update(DT);
    expect(head?.x).toBeGreaterThan(x0);
    for (let i = 0; i < 120 && onImpact.mock.calls.length === 0; i++) vfx.update(DT);
    expect(onImpact).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) vfx.update(DT);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(onLost).not.toHaveBeenCalled();
  });

  it('calls onLost when the target vanishes mid-flight', () => {
    const { vfx, at } = rig();
    const onImpact = vi.fn();
    const onLost = vi.fn();
    vfx.lightningProjectile(1, 2, 0x8fd0ff, { tip: true, onImpact, onLost });
    vfx.update(DT);
    at.delete(2);
    vfx.update(DT);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onImpact).not.toHaveBeenCalled();
  });

  it('calls onLost when cleared mid-flight', () => {
    const { vfx } = rig();
    const onLost = vi.fn();
    vfx.lightningProjectile(1, 2, 0x8fd0ff, { tip: true, onLost });
    vfx.clear();
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('returns null and launches nothing for a caster with no anchor', () => {
    const { vfx } = rig();
    expect(vfx.lightningProjectile(9, 2, 0x8fd0ff, { tip: true })).toBeNull();
  });
});
