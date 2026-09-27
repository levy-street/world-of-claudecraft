import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OVERLAY_CELL } from '../src/render/ability_vfx/fx_textures';
import type { OverlaySprites } from '../src/render/ability_vfx/overlay_sprites';
import type { BakedKind } from '../src/render/ability_vfx/production_assets';
import type { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import { WarriorReadiness } from '../src/render/ability_vfx/warrior_readiness';
import { WARRIOR_READINESS as R, warriorReadinessBit } from '../src/render/warrior_readiness_core';
import type { WeaponAnchorSampler } from '../src/render/weapon_trail_anchor';

// --- Typed fakes --------------------------------------------------------

// Structural match for Pick<AbilityVfxFx, 'anchorOf' | 'groundYAt' | 'bakedAt'>.
type ReadinessHost = {
  anchorOf(
    id: number,
    frac: number,
    out?: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } | null;
  groundYAt(x: number, z: number): number;
  bakedAt(
    kind: BakedKind,
    x: number,
    y: number,
    z: number,
    size: number,
    tint: number,
    hot: number,
    duration: number,
    delay: number,
    heat: number,
    angle?: number,
    reverse?: boolean,
    roll?: number,
    aspect?: number,
  ): boolean;
};

interface RibbonCall {
  points: THREE.Vector3[];
  count: number;
  color: number;
}

interface FakeRibbons {
  calls: RibbonCall[];
  appendHeld(
    points: THREE.Vector3[],
    count: number,
    width: number,
    color: number,
    light: number,
  ): void;
}

function makeRibbons(): FakeRibbons {
  const calls: RibbonCall[] = [];
  return {
    calls,
    appendHeld(
      points: THREE.Vector3[],
      count: number,
      _width: number,
      color: number,
      _light: number,
    ): void {
      calls.push({
        points: Array.from({ length: count }, (_, i) => points[i].clone()),
        count,
        color,
      });
    },
  };
}

interface FakeOverlay {
  starCount: number;
  push(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    size: number,
    cell: number,
    alpha: number,
    brightness?: number,
    priority?: 0 | 1,
  ): void;
}

function makeOverlay(): FakeOverlay {
  let starCount = 0;
  const ov: FakeOverlay = {
    get starCount() {
      return starCount;
    },
    push(_x: number, _y: number, _z: number, _col: number, _sz: number, cell: number): void {
      if (cell === OVERLAY_CELL.star) starCount++;
    },
  };
  return ov;
}

interface BakedCall {
  kind: BakedKind;
  x: number;
  z: number;
}

function makeHost(
  entityId: number,
  pos: THREE.Vector3,
): { host: ReadinessHost; bakedCalls: BakedCall[] } {
  const bakedCalls: BakedCall[] = [];
  return {
    host: {
      anchorOf(id: number, _frac: number, out?: { x: number; y: number; z: number }) {
        if (id !== entityId || !out) return null;
        out.x = pos.x;
        out.y = pos.y;
        out.z = pos.z;
        return out;
      },
      groundYAt: () => 0,
      bakedAt(kind: BakedKind, x: number, _y: number, z: number) {
        bakedCalls.push({ kind, x, z });
        return false;
      },
    },
    bakedCalls,
  };
}

// WeaponAnchorSampler whose tip/frame track mutable THREE vectors.
function makeSampler(tip: THREE.Vector3, center: THREE.Vector3): WeaponAnchorSampler {
  return Object.assign(
    (out: THREE.Vector3): boolean => {
      out.copy(tip);
      return true;
    },
    {
      frame: (out: THREE.Matrix4): boolean => {
        out.identity().setPosition(center);
        return true;
      },
    },
  ) as unknown as WeaponAnchorSampler;
}

// Null sampler: visible to the equipment callback but always returns false.
function makeHiddenSampler(): WeaponAnchorSampler {
  return Object.assign((_out: THREE.Vector3): boolean => false, {
    frame: (_out: THREE.Matrix4): boolean => false,
  }) as unknown as WeaponAnchorSampler;
}

// --- warriorReadinessBit -----------------------------------------------

describe('warriorReadinessBit', () => {
  it('returns correct bit for each id + matching kind + positive remaining', () => {
    expect(warriorReadinessBit({ id: 'battle_stance', kind: 'battle_stance', remaining: 1 })).toBe(
      R.battle,
    );
    expect(
      warriorReadinessBit({ id: 'berserker_stance', kind: 'berserker_stance', remaining: 1 }),
    ).toBe(R.berserker);
    expect(
      warriorReadinessBit({ id: 'defensive_stance', kind: 'defensive_stance', remaining: 1 }),
    ).toBe(R.guarded);
    expect(warriorReadinessBit({ id: 'sudden_death', kind: 'sudden_death', remaining: 1 })).toBe(
      R.suddenDeath,
    );
    expect(warriorReadinessBit({ id: 'battle_trance', kind: 'battle_trance', remaining: 1 })).toBe(
      R.battleTrance,
    );
    expect(warriorReadinessBit({ id: 'revenge_free', kind: 'revenge_free', remaining: 1 })).toBe(
      R.revenge,
    );
    expect(
      warriorReadinessBit({ id: 'sweeping_strikes', kind: 'sweeping_strikes', remaining: 1 }),
    ).toBe(R.wideningArc);
    expect(
      warriorReadinessBit({ id: 'pursuit', kind: 'buff_speed', remaining: 1, value: 1.5 }),
    ).toBe(R.pursuit);
  });

  it('returns 0 for wrong kind on each id', () => {
    expect(
      warriorReadinessBit({ id: 'battle_stance', kind: 'berserker_stance', remaining: 1 }),
    ).toBe(0);
    expect(
      warriorReadinessBit({ id: 'berserker_stance', kind: 'battle_stance', remaining: 1 }),
    ).toBe(0);
    expect(
      warriorReadinessBit({ id: 'defensive_stance', kind: 'battle_stance', remaining: 1 }),
    ).toBe(0);
    expect(warriorReadinessBit({ id: 'sudden_death', kind: 'battle_stance', remaining: 1 })).toBe(
      0,
    );
    expect(warriorReadinessBit({ id: 'battle_trance', kind: 'battle_stance', remaining: 1 })).toBe(
      0,
    );
    expect(warriorReadinessBit({ id: 'revenge_free', kind: 'battle_stance', remaining: 1 })).toBe(
      0,
    );
    expect(
      warriorReadinessBit({ id: 'sweeping_strikes', kind: 'battle_stance', remaining: 1 }),
    ).toBe(0);
    expect(
      warriorReadinessBit({ id: 'pursuit', kind: 'battle_stance', remaining: 1, value: 1.5 }),
    ).toBe(0);
  });

  it('returns 0 for remaining <= 0 or undefined', () => {
    expect(warriorReadinessBit({ id: 'battle_stance', kind: 'battle_stance', remaining: 0 })).toBe(
      0,
    );
    expect(warriorReadinessBit({ id: 'battle_stance', kind: 'battle_stance', remaining: -1 })).toBe(
      0,
    );
    expect(warriorReadinessBit({ id: 'battle_stance', kind: 'battle_stance' })).toBe(0);
  });

  it('returns 0 for unknown id', () => {
    expect(warriorReadinessBit({ id: 'shield_bash', kind: 'battle_stance', remaining: 1 })).toBe(0);
  });

  it('pursuit: requires value strictly > 1; value === 1 or undefined or < 1 returns 0', () => {
    expect(warriorReadinessBit({ id: 'pursuit', kind: 'buff_speed', remaining: 1, value: 1 })).toBe(
      0,
    );
    expect(
      warriorReadinessBit({ id: 'pursuit', kind: 'buff_speed', remaining: 1, value: 0.5 }),
    ).toBe(0);
    expect(warriorReadinessBit({ id: 'pursuit', kind: 'buff_speed', remaining: 1 })).toBe(0);
    expect(
      warriorReadinessBit({ id: 'pursuit', kind: 'buff_speed', remaining: 1, value: 1.01 }),
    ).toBe(R.pursuit);
  });
});

// --- WarriorReadiness state -------------------------------------------

const ID = 42;

// Center at (4,0,0), tip at (4,1,0.1) gives along=(0,1,0), normal=(0,0,1) via identity frame.
function makeStdSampler(): {
  tip: THREE.Vector3;
  center: THREE.Vector3;
  sampler: WeaponAnchorSampler;
} {
  const tip = new THREE.Vector3(4, 1, 0.1);
  const center = new THREE.Vector3(4, 0, 0);
  return { tip, center, sampler: makeSampler(tip, center) };
}

describe('WarriorReadiness simultaneous states and lifecycle', () => {
  it('battle + suddenDeath both draw; sudden death emits a star overlay', () => {
    const rdy = new WarriorReadiness();
    const pos = new THREE.Vector3(0, 0, 0);
    const { host } = makeHost(ID, pos);
    const { sampler } = makeStdSampler();
    const ribbons = makeRibbons();
    const overlay = makeOverlay();
    const equipment = (_id: number, hand: 0 | 1): WeaponAnchorSampler | null =>
      hand === 0 ? sampler : null;

    rdy.hold(ID, R.battle | R.suddenDeath, 0, false);
    rdy.draw(
      0,
      0,
      false,
      0.8,
      host,
      ribbons as unknown as AbilityVfxRibbons,
      overlay as unknown as OverlaySprites,
      equipment,
    );

    // At least one ribbon for battle and at least one for suddenDeath
    expect(ribbons.calls.length).toBeGreaterThanOrEqual(2);
    expect(overlay.starCount).toBe(1);
  });

  it('next frame without suddenDeath drops the star but keeps battle ribbons', () => {
    const rdy = new WarriorReadiness();
    const pos = new THREE.Vector3(0, 0, 0);
    const { host } = makeHost(ID, pos);
    const { sampler } = makeStdSampler();
    const equipment = (_id: number, hand: 0 | 1): WeaponAnchorSampler | null =>
      hand === 0 ? sampler : null;

    // Frame 0: both bits
    rdy.hold(ID, R.battle | R.suddenDeath, 0, false);
    rdy.draw(
      0,
      0,
      false,
      0.8,
      host,
      makeRibbons() as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
      equipment,
    );

    // Frame 1: only battle (new frame resets bits)
    const ribbons1 = makeRibbons();
    const overlay1 = makeOverlay();
    rdy.hold(ID, R.battle, 1, false);
    rdy.draw(
      1,
      0.05,
      false,
      0.8,
      host,
      ribbons1 as unknown as AbilityVfxRibbons,
      overlay1 as unknown as OverlaySprites,
      equipment,
    );

    expect(ribbons1.calls.length).toBeGreaterThan(0);
    expect(overlay1.starCount).toBe(0);
  });

  it('unseen frame clears the entry; next draw emits no ribbons', () => {
    const rdy = new WarriorReadiness();
    const pos = new THREE.Vector3(0, 0, 0);
    const { host } = makeHost(ID, pos);
    const { sampler } = makeStdSampler();
    const equipment = (_id: number, hand: 0 | 1): WeaponAnchorSampler | null =>
      hand === 0 ? sampler : null;

    // Frame 0: hold + draw to register entry
    rdy.hold(ID, R.battle, 0, false);
    rdy.draw(
      0,
      0,
      false,
      0.8,
      host,
      makeRibbons() as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
      equipment,
    );

    // Frame 1: skip hold; draw purges stale entry
    const ribbons1 = makeRibbons();
    rdy.draw(
      1,
      0.05,
      false,
      0.8,
      host,
      ribbons1 as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
      equipment,
    );

    expect(ribbons1.calls.length).toBe(0);
  });

  it('bits from multiple hold() on the same frame are OR-ed together', () => {
    const rdy = new WarriorReadiness();
    const pos = new THREE.Vector3(0, 0, 0);
    const { host } = makeHost(ID, pos);
    const { sampler } = makeStdSampler();
    const overlay = makeOverlay();
    const equipment = (_id: number, hand: 0 | 1): WeaponAnchorSampler | null =>
      hand === 0 ? sampler : null;

    // Two separate hold() calls in the same frame
    rdy.hold(ID, R.battle, 0, false);
    rdy.hold(ID, R.suddenDeath, 0, false);
    rdy.draw(
      0,
      0,
      false,
      0.8,
      host,
      makeRibbons() as unknown as AbilityVfxRibbons,
      overlay as unknown as OverlaySprites,
      equipment,
    );

    expect(overlay.starCount).toBe(1);
  });
});

describe('WarriorReadiness equipment sampling', () => {
  it('points shift when equipment sampler moves', () => {
    const rdy = new WarriorReadiness();
    const pos = new THREE.Vector3(0, 0, 0);
    const { host } = makeHost(ID, pos);
    const { tip, center, sampler } = makeStdSampler();
    const equipment = (_id: number, hand: 0 | 1): WeaponAnchorSampler | null =>
      hand === 0 ? sampler : null;

    const ribbons0 = makeRibbons();
    rdy.hold(ID, R.battle, 0, false);
    rdy.draw(
      0,
      0,
      false,
      0.8,
      host,
      ribbons0 as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
      equipment,
    );
    expect(ribbons0.calls.length).toBeGreaterThan(0);
    const firstX = ribbons0.calls[0].points[0].x;

    // Move tip and center 3 units along X
    tip.x += 3;
    center.x += 3;

    const ribbons1 = makeRibbons();
    rdy.hold(ID, R.battle, 1, false);
    rdy.draw(
      1,
      0.05,
      false,
      0.8,
      host,
      ribbons1 as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
      equipment,
    );
    expect(ribbons1.calls.length).toBeGreaterThan(0);
    const secondX = ribbons1.calls[0].points[0].x;

    expect(Math.abs(secondX - firstX)).toBeGreaterThan(2.5);
  });

  it('missing equipment produces no ribbons (no floating body substitute)', () => {
    const rdy = new WarriorReadiness();
    const pos = new THREE.Vector3(0, 0, 0);
    const { host } = makeHost(ID, pos);
    const ribbons = makeRibbons();

    rdy.hold(ID, R.battle, 0, false);
    rdy.draw(
      0,
      0,
      false,
      0.8,
      host,
      ribbons as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );

    expect(ribbons.calls.length).toBe(0);
  });

  it('hidden sampler (returns false) produces no ribbons', () => {
    const rdy = new WarriorReadiness();
    const pos = new THREE.Vector3(0, 0, 0);
    const { host } = makeHost(ID, pos);
    const hidden = makeHiddenSampler();
    const equipment = (_id: number, hand: 0 | 1): WeaponAnchorSampler | null =>
      hand === 0 ? hidden : null;
    const ribbons = makeRibbons();

    rdy.hold(ID, R.battle, 0, false);
    rdy.draw(
      0,
      0,
      false,
      0.8,
      host,
      ribbons as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
      equipment,
    );

    expect(ribbons.calls.length).toBe(0);
  });

  it('retries equipment lookup after exactly 0.25 s; does not retry early', () => {
    const rdy = new WarriorReadiness();
    const pos = new THREE.Vector3(0, 0, 0);
    const { host } = makeHost(ID, pos);
    const { sampler } = makeStdSampler();
    let providesampler = false;
    const equipment = (_id: number, hand: 0 | 1): WeaponAnchorSampler | null =>
      hand === 0 && providesampler ? sampler : null;

    // Frame 0, time=0: equipment returns null -> retryAt set to 0.25
    rdy.hold(ID, R.battle, 0, false);
    rdy.draw(
      0,
      0,
      false,
      0.8,
      host,
      makeRibbons() as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
      equipment,
    );

    // time=0.24: retry not yet due; even with sampler provided, no ribbons
    providesampler = true;
    const ribbonsEarly = makeRibbons();
    rdy.hold(ID, R.battle, 1, false);
    rdy.draw(
      1,
      0.24,
      false,
      0.8,
      host,
      ribbonsEarly as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
      equipment,
    );
    expect(ribbonsEarly.calls.length).toBe(0);

    // time=0.25: retry fires; sampler now available -> ribbons emitted
    const ribbonsReady = makeRibbons();
    rdy.hold(ID, R.battle, 2, false);
    rdy.draw(
      2,
      0.25,
      false,
      0.8,
      host,
      ribbonsReady as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
      equipment,
    );
    expect(ribbonsReady.calls.length).toBeGreaterThan(0);
  });
});

describe('WarriorReadiness capacity', () => {
  it.each([
    {
      existingPriority: false,
      incomingPriority: false,
      expected: Array.from({ length: 64 }, (_, i) => i),
    },
    {
      existingPriority: false,
      incomingPriority: true,
      expected: [64, ...Array.from({ length: 63 }, (_, i) => i + 1)],
    },
    {
      existingPriority: true,
      incomingPriority: true,
      expected: Array.from({ length: 64 }, (_, i) => i),
    },
  ])(
    'keeps a bounded draw set with existingPriority=$existingPriority and incomingPriority=$incomingPriority',
    ({ existingPriority, incomingPriority, expected }) => {
      const rdy = new WarriorReadiness();
      for (let id = 0; id < 64; id++) rdy.hold(id, R.battle, 0, existingPriority);
      rdy.hold(64, R.battle, 0, incomingPriority);
      const drawn: number[] = [];
      const host: ReadinessHost = {
        anchorOf(id, _fraction, out) {
          drawn.push(id);
          if (!out) throw new Error('Readiness must supply retained anchor scratch');
          out.x = id;
          out.y = 0;
          out.z = 0;
          return out;
        },
        groundYAt: () => 0,
        bakedAt: () => false,
      };
      rdy.draw(
        0,
        0,
        false,
        0.8,
        host,
        makeRibbons() as unknown as AbilityVfxRibbons,
        makeOverlay() as unknown as OverlaySprites,
      );
      expect(drawn).toEqual(expected);
      expect(drawn).toHaveLength(64);
    },
  );
});

describe('WarriorReadiness pursuit wake and dust', () => {
  it('real movement emits two wake ribbon calls and dust at quality > 0.55', () => {
    const rdy = new WarriorReadiness();
    const pos = new THREE.Vector3(0, 0, 0);
    const { host, bakedCalls } = makeHost(ID, pos);

    // Frame 0 at t=0 -- seeds previousTime
    rdy.hold(ID, R.pursuit, 0, false);
    rdy.draw(
      0,
      0,
      false,
      0.8,
      host,
      makeRibbons() as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );

    // Move entity 0.5 units over 0.05 s -> speed = 10 (in [0.75, 30])
    pos.x = 0.5;
    const ribbons1 = makeRibbons();
    rdy.hold(ID, R.pursuit, 1, false);
    rdy.draw(
      1,
      0.05,
      false,
      0.8,
      host,
      ribbons1 as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );

    // Two appendHeld calls (one per side)
    expect(ribbons1.calls.length).toBe(2);
    expect(ribbons1.calls[0].color).toBe(0xba9675);
    // Dust emitted: nextDust starts at 0, time 0.05 >= 0
    expect(bakedCalls.length).toBeGreaterThan(0);
    expect(bakedCalls[0].kind).toBe('shout_dust');
  });

  it('stationary entity does not emit wake or dust', () => {
    const rdy = new WarriorReadiness();
    const pos = new THREE.Vector3(0, 0, 0);
    const { host, bakedCalls } = makeHost(ID, pos);

    // Frame 0 seeds previousTime
    rdy.hold(ID, R.pursuit, 0, false);
    rdy.draw(
      0,
      0,
      false,
      0.8,
      host,
      makeRibbons() as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );

    // Frame 1: pos unchanged -> distance=0 -> speed=0 < 0.75
    const ribbons1 = makeRibbons();
    rdy.hold(ID, R.pursuit, 1, false);
    rdy.draw(
      1,
      0.05,
      false,
      0.8,
      host,
      ribbons1 as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );

    expect(ribbons1.calls.length).toBe(0);
    expect(bakedCalls.length).toBe(0);
  });

  it('first frame (previousTime < 0) does not emit pursuit wake', () => {
    const rdy = new WarriorReadiness();
    const pos = new THREE.Vector3(0, 0, 0);
    const { host, bakedCalls } = makeHost(ID, pos);
    const ribbons = makeRibbons();

    // Only one hold+draw with no prior frame to compare against
    rdy.hold(ID, R.pursuit, 0, false);
    rdy.draw(
      0,
      0,
      false,
      0.8,
      host,
      ribbons as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );

    expect(ribbons.calls.length).toBe(0);
    expect(bakedCalls.length).toBe(0);
  });

  it('teleport (large dt > 0.2) is skipped', () => {
    const rdy = new WarriorReadiness();
    const pos = new THREE.Vector3(0, 0, 0);
    const { host, bakedCalls } = makeHost(ID, pos);

    // Frame 0 seeds previousTime=0
    rdy.hold(ID, R.pursuit, 0, false);
    rdy.draw(
      0,
      0,
      false,
      0.8,
      host,
      makeRibbons() as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );

    // Jump 5 units in 0.3 s (dt > 0.2)
    pos.x = 5;
    const ribbons1 = makeRibbons();
    rdy.hold(ID, R.pursuit, 1, false);
    rdy.draw(
      1,
      0.3,
      false,
      0.8,
      host,
      ribbons1 as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );

    expect(ribbons1.calls.length).toBe(0);
    expect(bakedCalls.length).toBe(0);
  });

  it('speed out of range (< 0.75 or > 30) produces no wake', () => {
    const rdy = new WarriorReadiness();
    const pos = new THREE.Vector3(0, 0, 0);
    const { host } = makeHost(ID, pos);

    // Frame 0 seeds previousTime
    rdy.hold(ID, R.pursuit, 0, false);
    rdy.draw(
      0,
      0,
      false,
      0.8,
      host,
      makeRibbons() as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );

    // Move only 0.001 units in 0.05 s -> speed ~ 0.02 < 0.75
    pos.x = 0.001;
    const ribbonsSlow = makeRibbons();
    rdy.hold(ID, R.pursuit, 1, false);
    rdy.draw(
      1,
      0.05,
      false,
      0.8,
      host,
      ribbonsSlow as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );
    expect(ribbonsSlow.calls.length).toBe(0);

    // Move 2 more units in 0.001 s -> speed > 30
    pos.x = 2.001;
    const ribbonsFast = makeRibbons();
    rdy.hold(ID, R.pursuit, 2, false);
    rdy.draw(
      2,
      0.051,
      false,
      0.8,
      host,
      ribbonsFast as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );
    expect(ribbonsFast.calls.length).toBe(0);
  });

  it('dust is suppressed when quality <= 0.55', () => {
    const rdy = new WarriorReadiness();
    const pos = new THREE.Vector3(0, 0, 0);
    const { host, bakedCalls } = makeHost(ID, pos);

    // Frame 0 seeds previousTime
    rdy.hold(ID, R.pursuit, 0, false);
    rdy.draw(
      0,
      0,
      false,
      0.5,
      host,
      makeRibbons() as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );

    // Move at valid speed, quality 0.5 (<= 0.55) -> wake ribbons yes, dust no
    pos.x = 0.5;
    const ribbons1 = makeRibbons();
    rdy.hold(ID, R.pursuit, 1, false);
    rdy.draw(
      1,
      0.05,
      false,
      0.5,
      host,
      ribbons1 as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );

    expect(ribbons1.calls.length).toBe(2);
    expect(bakedCalls.length).toBe(0);
  });

  it('expired pursuit state (bit not held) clears and does not emit wake on next hold', () => {
    const rdy = new WarriorReadiness();
    const pos = new THREE.Vector3(0, 0, 0);
    const { host } = makeHost(ID, pos);

    // Frame 0 at t=0: hold with pursuit, seed previousTime
    rdy.hold(ID, R.pursuit, 0, false);
    rdy.draw(
      0,
      0,
      false,
      0.8,
      host,
      makeRibbons() as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );

    // Frame 1: entity moves but pursuit bit NOT held -> entry evicted
    pos.x = 0.5;
    rdy.draw(
      1,
      0.05,
      false,
      0.8,
      host,
      makeRibbons() as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );

    // Frame 2: hold pursuit again -> fresh entry (previousTime resets to -1) -> no wake
    pos.x = 1.0;
    const ribbons2 = makeRibbons();
    rdy.hold(ID, R.pursuit, 2, false);
    rdy.draw(
      2,
      0.1,
      false,
      0.8,
      host,
      ribbons2 as unknown as AbilityVfxRibbons,
      makeOverlay() as unknown as OverlaySprites,
    );

    expect(ribbons2.calls.length).toBe(0);
  });
});
