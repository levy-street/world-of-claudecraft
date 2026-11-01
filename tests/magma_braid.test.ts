import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { MagmaBraids } from '../src/render/ability_vfx/magma_braid';
import {
  BRAID_DRAIN_S,
  FIRE_RING_S,
  MAGMA_STRANDS,
  type MagmaBurstPlan,
} from '../src/render/ability_vfx/magma_braid_core';
import { MAGMA_BURST_ABILITY, playMagmaBurst } from '../src/render/ability_vfx/magma_burst';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { abilityVfxFullSpec, abilityVfxSpec } from '../src/render/ability_vfx_registry';
import type { TrackedLightHost } from '../src/render/light_pulses';
import { Vfx } from '../src/render/vfx';
import { createVfxAnchor } from '../src/render/vfx_anchor';
import { installCastVfxCanvasStub } from './helpers/cast_vfx_headless';

const FULL: MagmaBurstPlan = { strands: 3, drips: true, fireRing: true };
const DT = 1 / 60;

interface StripCall {
  count: number;
  width: number;
  color: number;
  light: number;
}
interface BurstCall {
  kind: string;
  delay: number;
  y: number;
}

function fakeLights() {
  const writes: Array<{ x: number; intensity: number; color: number }> = [];
  const released: number[] = [];
  const host: TrackedLightHost = {
    track: () => 7,
    setTracked: (_t, x, _y, _z, intensity, color) => {
      writes.push({ x, intensity, color });
      return true;
    },
    releaseTracked: (token) => {
      released.push(token);
    },
  };
  return { host, writes, released };
}

function harness(lights: TrackedLightHost | null = null) {
  const strips: StripCall[] = [];
  const bursts: BurstCall[] = [];
  const anchors = new Map<number, THREE.Vector3>([
    [1, new THREE.Vector3(0, 1.5, 0)],
    [2, new THREE.Vector3(14, 1.2, 0)],
  ]);
  const braids = new MagmaBraids({
    strip: (_pts, count, width, color, light) => {
      strips.push({ count, width, color: color.getHex(), light });
    },
    burst: (_x, y, _z, _c, _n, _p, kind, _d, delay) => {
      bursts.push({ kind, delay: delay ?? 0, y });
    },
    anchor: (id, _f, out) => {
      const a = anchors.get(id);
      return a ? (out ?? new THREE.Vector3()).copy(a) : null;
    },
    groundY: () => 0,
  });
  braids.setLightHost(lights);
  return { braids, strips, bursts, anchors };
}

function fly(braids: MagmaBraids, head: THREE.Vector3, to = new THREE.Vector3(14, 1.2, 0)) {
  let frames = 0;
  while (head.distanceTo(to) > 0.3 && frames < 600) {
    head.addScaledVector(to.clone().sub(head).normalize(), Math.min(26 * DT, head.distanceTo(to)));
    braids.advance(DT, false);
    frames++;
  }
}

describe('MagmaBraids: three strands ride the orb', () => {
  it('draws every strand as core, body and glow, core first, each ending on the orb', () => {
    const { braids, strips } = harness();
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = braids.spawn(1, 2, head, FULL);
    fly(braids, head);
    const tip = new THREE.Vector3();
    expect(braids.tipOf(handle, tip)).toBe(true);
    expect(tip.distanceTo(head)).toBeLessThan(1e-3);
    strips.length = 0;
    braids.draw();
    expect(strips.length).toBe(3 * 3);
    for (let k = 0; k < 3; k++) {
      const [core, body, glow] = strips.slice(k * 3, k * 3 + 3);
      expect(core.color).toBe(MAGMA_STRANDS[k].core);
      expect(body.color).toBe(MAGMA_STRANDS[k].body);
      expect(glow.color).toBe(MAGMA_STRANDS[k].glow);
      expect(core.width).toBeLessThan(body.width);
      expect(body.width).toBeLessThan(glow.width);
    }
  });

  it('drips lava in flight on the full plan, and not on the lean plan', () => {
    const full = harness();
    const h1 = new THREE.Vector3(0, 1.5, 0);
    full.braids.spawn(1, 2, h1, FULL);
    fly(full.braids, h1);
    expect(full.bursts.filter((b) => b.kind === 'embers').length).toBeGreaterThan(3);

    const lean = harness();
    const h2 = new THREE.Vector3(0, 1.5, 0);
    lean.braids.spawn(1, 2, h2, { strands: 2, drips: false, fireRing: false });
    fly(lean.braids, h2);
    expect(lean.bursts.length).toBe(0);
    lean.strips.length = 0;
    lean.braids.draw();
    expect(lean.strips.length).toBe(2 * 3);
  });
});

describe('MagmaBraids: the impact', () => {
  it('drains the strands, crumbles them hand-end first, lights a ring of fire, then ends', () => {
    const lights = fakeLights();
    const { braids, strips, bursts } = harness(lights.host);
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = braids.spawn(1, 2, head, FULL);
    fly(braids, head);
    bursts.length = 0;
    braids.impact(handle, new THREE.Vector3(14, 1.2, 0));
    const flakes = bursts.filter((b) => b.kind === 'debris');
    const fire = bursts.filter((b) => b.kind === 'embers');
    expect(flakes.length).toBeGreaterThan(6);
    // staggered by the drain: from the hand end first, all within the drain
    const delays = flakes.map((b) => b.delay);
    expect(Math.max(...delays)).toBeLessThanOrEqual(BRAID_DRAIN_S + 1e-6);
    expect(Math.min(...delays)).toBeLessThan(0.05);
    expect(fire.length).toBeGreaterThanOrEqual(40); // the ring, in waves
    expect(new Set(fire.map((b) => b.delay)).size).toBeGreaterThan(1);
    for (const f of fire) expect(f.y).toBeCloseTo(0.1); // on the ground
    // a second impact is ignored
    const n = bursts.length;
    braids.impact(handle, new THREE.Vector3(14, 1.2, 0));
    expect(bursts.length).toBe(n);

    const drawnPoints = () => {
      strips.length = 0;
      braids.draw();
      return strips.reduce((a, s) => a + s.count, 0);
    };
    braids.advance(DT, false);
    const early = drawnPoints();
    braids.advance(BRAID_DRAIN_S * 0.6, false);
    const mid = drawnPoints();
    expect(mid).toBeLessThan(early); // the strands drain into the target
    braids.advance(BRAID_DRAIN_S, false);
    expect(drawnPoints()).toBe(0);
    expect(braids.activeCount()).toBe(1); // the ring of fire still burns (light)
    braids.advance(FIRE_RING_S, false);
    expect(braids.activeCount()).toBe(0);
    expect(lights.released).toEqual([7]);
  });

  it('the impact light floods from beside the target, brighter than the flight light', () => {
    const lights = fakeLights();
    const { braids } = harness(lights.host);
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = braids.spawn(1, 2, head, FULL);
    fly(braids, head);
    const flight = lights.writes[lights.writes.length - 1];
    braids.impact(handle, new THREE.Vector3(14, 1.2, 0));
    braids.advance(DT, false);
    const flash = lights.writes[lights.writes.length - 1];
    expect(flash.intensity).toBeGreaterThan(flight.intensity * 2);
    expect(flash.color).not.toBe(flight.color);
    expect(flash.x).toBeLessThan(14); // stood off toward the caster
    expect(flash.x).toBeGreaterThan(12);
  });

  it('a lost projectile drops the braid and its light; an orphan stands down on its own', () => {
    const lights = fakeLights();
    const { braids, bursts } = harness(lights.host);
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = braids.spawn(1, 2, head, FULL);
    braids.advance(DT, false);
    braids.lost(handle);
    expect(braids.activeCount()).toBe(0);
    expect(lights.released.length).toBe(1);
    bursts.length = 0;
    braids.impact(handle, head); // stale handle
    expect(bursts.length).toBe(0);

    braids.spawn(1, 2, new THREE.Vector3(0, 1.5, 0), FULL); // the head never moves
    for (let t = 0; t < 3.5; t += DT) braids.advance(DT, false);
    expect(braids.activeCount()).toBe(0);
  });

  it('reduced motion holds the flight light steady', () => {
    const lights = fakeLights();
    const { braids } = harness(lights.host);
    const head = new THREE.Vector3(0, 1.5, 0);
    braids.spawn(1, 2, head, FULL);
    const seen = new Set<number>();
    for (let f = 0; f < 20; f++) {
      head.x += 26 * DT;
      braids.advance(DT, true);
      seen.add(lights.writes[lights.writes.length - 1].intensity);
    }
    expect(seen.size).toBe(1);
  });
});

describe('playMagmaBurst: the cue routing', () => {
  function fakes(head: THREE.Vector3 | null) {
    let captured: { onImpact?: (p: THREE.Vector3) => void; onLost?: () => void } = {};
    const launches: unknown[] = [];
    const vfx = {
      moltenOrbProjectile: (_s: number, _t: number, _c?: number, opts?: typeof captured) => {
        launches.push(opts);
        captured = opts ?? {};
        return head;
      },
    };
    const fx = {
      magmaBraid: vi.fn(
        (
          _a: string,
          _spec: unknown,
          _s: number,
          _t: number,
          _h: THREE.Vector3,
          _p: MagmaBurstPlan,
          _c: number,
          _tier: number,
        ) => 9,
      ),
      magmaBraidImpact: vi.fn(),
      magmaBraidLost: vi.fn(),
    };
    return { vfx, fx, launches, captured: () => captured };
  }

  it('launches a molten orb and rides it with a braid; impact and loss route by handle', () => {
    const head = new THREE.Vector3(1, 2, 3);
    const f = fakes(head);
    expect(playMagmaBurst(f.vfx, f.fx, undefined, 1, 2, 0xff7a1a, 0)).toBe(true);
    expect(f.fx.magmaBraid.mock.calls[0][0]).toBe(MAGMA_BURST_ABILITY);
    expect(f.fx.magmaBraid.mock.calls[0][4]).toBe(head);
    expect(f.fx.magmaBraid.mock.calls[0][5]).toEqual(FULL);
    const at = new THREE.Vector3(5, 5, 5);
    f.captured().onImpact?.(at);
    expect(f.fx.magmaBraidImpact).toHaveBeenCalledWith(9, at);
    f.captured().onLost?.();
    expect(f.fx.magmaBraidLost).toHaveBeenCalledWith(9);
  });

  it('declines on the spam-floor tier and on a host with no molten-orb head', () => {
    const f = fakes(new THREE.Vector3());
    expect(playMagmaBurst(f.vfx, f.fx, undefined, 1, 2, 0xff7a1a, 2)).toBe(false);
    expect(f.launches.length).toBe(0);
    expect(playMagmaBurst({}, f.fx, undefined, 1, 2, 0xff7a1a, 0)).toBe(false);
  });

  it('a caster with no anchor launches nothing and starts no braid, yet the cue is handled', () => {
    const f = fakes(null);
    expect(playMagmaBurst(f.vfx, f.fx, undefined, 1, 2, 0xff7a1a, 0)).toBe(true);
    expect(f.fx.magmaBraid).not.toHaveBeenCalled();
  });
});

describe('the registry gives Magma Burst its Shaman identity', () => {
  it('resolves an orb-windup fire bolt with a scorching impact stack', () => {
    expect(abilityVfxSpec('lava_burst')).toMatchObject({ p: 'fire', a: 'bolt', wu: 2 });
    expect(abilityVfxFullSpec('lava_burst')).toMatchObject({
      archetype: 'bolt',
      palette: 'fire',
      windupStyle: 'orb',
      decal: 'scorch',
    });
  });
});

describe('the real painter routes Magma Burst onto the braid', () => {
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
    const orbs: unknown[] = [];
    const comets: unknown[] = [];
    const noop = () => () => {};
    const painter = new AbilityVfx(
      {
        fx,
        vfx: {
          projectile: (...a: unknown[]) => {
            comets.push(a);
          },
          lightningProjectile: () => null,
          moltenOrbProjectile: (...a: unknown[]) => {
            orbs.push(a);
            return new THREE.Vector3(0, 1.2, 0);
          },
          burst: noop(),
          nova: noop(),
          tick: noop(),
          shoutwave: noop(),
          buffSwirl: noop(),
          beam: noop(),
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
    return { fx, painter, orbs, comets };
  }
  const cue = (ability: string) => ({
    type: 'spellfx' as const,
    sourceId: 1,
    targetId: 2,
    school: 'fire',
    fx: 'heavyBolt',
    ability,
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the Magma Burst cue launches a molten orb ridden by the braid', () => {
    const { fx, painter, orbs, comets } = rig();
    expect(painter.handleSpellfx(cue('lava_burst'))).toBe(true);
    expect(orbs.length).toBe(1);
    expect(comets.length).toBe(0);
    expect(fx.magmaBraidCount()).toBe(1);
  });

  it("another ability's heavy bolt (Pyroblast) keeps its own look: no braid, no orb", () => {
    const { fx, painter, orbs } = rig();
    painter.handleSpellfx(cue('pyroblast'));
    expect(orbs.length).toBe(0);
    expect(fx.magmaBraidCount()).toBe(0);
  });
});

describe('Vfx: the molten orb projectile the braid rides', () => {
  function vfxRig() {
    installCastVfxCanvasStub();
    const at = new Map<number, THREE.Vector3>([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(10, 1, 0)],
    ]);
    const vfx = new Vfx(new THREE.Scene(), (id, _f, out) => {
      const p = at.get(id);
      return p ? (out ?? new THREE.Vector3()).copy(p) : null;
    });
    return { vfx, at };
  }
  afterEach(() => vi.unstubAllGlobals());

  it('returns the live head and calls onImpact once on arrival', () => {
    const { vfx } = vfxRig();
    const onImpact = vi.fn();
    const onLost = vi.fn();
    const head = vfx.moltenOrbProjectile(1, 2, 0xff7a1a, { onImpact, onLost });
    expect(head).toBeInstanceOf(THREE.Vector3);
    const x0 = head?.x ?? 0;
    vfx.update(DT);
    expect(head?.x).toBeGreaterThan(x0);
    for (let i = 0; i < 120 && onImpact.mock.calls.length === 0; i++) vfx.update(DT);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(onLost).not.toHaveBeenCalled();
  });

  it('calls onLost when the target vanishes, and returns null with no caster anchor', () => {
    const { vfx, at } = vfxRig();
    const onLost = vi.fn();
    vfx.moltenOrbProjectile(1, 2, 0xff7a1a, { onLost });
    vfx.update(DT);
    at.delete(2);
    vfx.update(DT);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(vfx.moltenOrbProjectile(9, 2)).toBeNull();
  });
});
