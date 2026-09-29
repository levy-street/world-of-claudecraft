import { describe, expect, it, vi } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import {
  TURRET_BARREL_SFX,
  TURRET_BREACH_SFX,
  TURRET_FIRE_SFX,
  TURRET_IMPACT_SFX,
  TurretDefenseSfx,
  type TurretSfxCue,
  turretBlastSize,
  turretBreachCueInto,
  turretSfxCueInto,
} from '../src/game/turret_defense_sfx';
import {
  TURRET_KNOCK_SFX,
  TURRET_THUMP_HEAVY_SFX,
  TURRET_THUMP_LIGHT_SFX,
} from '../src/game/turret_monster_sfx';
import type { TurretEvent, TurretHit } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import type { TurretFeedback } from '../src/sim/minigames/turret_feedback';
import type { TurretSessionView } from '../src/world_api/vehicles';

const origin = { x: 100, y: 5, z: 200 };
const fired: TurretEvent = {
  type: 'fired',
  shotId: 1,
  fromX: 100,
  fromZ: 200,
  x: 100,
  y: 5,
  z: 230,
  flightTicks: 6,
  impactTick: 16,
};
const hit = (id: number, falloff: number, damage: number): TurretHit => ({
  id,
  falloff,
  damage,
  x: 100,
  y: 5,
  z: 230,
});
const impact = (hits: TurretHit[], z = 230): TurretEvent => ({
  type: 'impact',
  shotId: 1,
  x: 100,
  y: 5,
  z,
  hits,
});

function cue(): TurretSfxCue {
  return { key: '', x: 0, y: 0, z: 0, gain: 0, rate: 0, jitter: true };
}

const PLAN = resolveTurretPlan();
/** Monster 1 is a wolf (kind 0), monster 2 the plan's first huge kind. */
const HUGE = PLAN.kinds.findIndex((k) => k.sizeClass === 'huge');
const monsters = [
  { id: 1, kind: 0 },
  { id: 2, kind: HUGE },
];

function session(
  entries: TurretFeedback[],
  startTick = 0,
  bodies: readonly { id: number; kind: number }[] = monsters,
): TurretSessionView {
  return {
    origin,
    defense: { startTick, plan: PLAN, monsters: bodies } as unknown as TurretSessionView['defense'],
    waveCount: 6,
    monstersLeft: 0,
    feedback: entries,
  };
}

function entry(seq: number, tick: number, event: TurretEvent): TurretFeedback {
  return { seq, tick, event };
}

function sink() {
  return {
    playAt: vi.fn((_key: string, _x: number, _y: number, _z: number, _opts?: unknown) => true),
    preload: vi.fn((_key: string) => {}),
  };
}

describe('Fire and Fly sound cues', () => {
  it('ships both samples through the SFX manifest', () => {
    const clips: Record<string, { variants: readonly unknown[]; playbackRate: number }> = SFX_CLIPS;
    expect(clips[TURRET_FIRE_SFX]?.variants).toHaveLength(3);
    expect(clips[TURRET_FIRE_SFX]?.playbackRate).toBe(0.6);
    expect(clips[TURRET_IMPACT_SFX]?.variants).toHaveLength(1);
  });

  it('plays the cannon report at the muzzle, toward the shot', () => {
    const out = turretSfxCueInto(fired, origin, cue());
    expect(out).toMatchObject({ key: TURRET_FIRE_SFX, x: 100, y: 7.2, z: 202, jitter: false });
    expect(out?.gain).toBeGreaterThan(1);
  });

  it('plays the blast louder and deeper-to-brighter with its size, from a pulled-in point', () => {
    const miss = turretSfxCueInto(impact([]), origin, cue());
    const direct = turretSfxCueInto(impact([hit(1, 1, 10)]), origin, cue());
    expect(miss?.key).toBe(TURRET_IMPACT_SFX);
    expect(direct?.gain).toBeGreaterThan(miss?.gain ?? 0);
    expect(direct?.rate).toBeGreaterThan(miss?.rate ?? 0);
    // 30 yd out is heard from 8 + 22 * 0.35 = 15.7 yd, on the same bearing.
    expect(direct?.x).toBeCloseTo(100, 12);
    expect(direct?.z).toBeCloseTo(200 + 15.7, 9);
    const near = turretSfxCueInto(impact([], 204), origin, cue());
    expect(near?.z).toBeCloseTo(204, 12);
  });

  it("booms a barrel's blast heavier than a shell's, from a pulled-in point", () => {
    const clips: Record<string, { spatial: boolean }> = SFX_CLIPS;
    expect(TURRET_BARREL_SFX).not.toBe(TURRET_IMPACT_SFX);
    expect(clips[TURRET_BARREL_SFX]?.spatial).toBe(true);
    const blast = (hits: TurretHit[]): TurretEvent => ({
      type: 'barrelExploded',
      id: 3,
      x: 100,
      y: 5,
      z: 230,
      hits,
    });
    const empty = turretSfxCueInto(blast([]), origin, cue());
    const crowd = turretSfxCueInto(blast([hit(1, 1, 120), hit(2, 0.5, 60)]), origin, cue());
    expect(empty).toMatchObject({ key: TURRET_BARREL_SFX, x: 100, jitter: true });
    expect(empty?.z).toBeCloseTo(200 + 15.7, 9);
    expect(crowd?.gain).toBeGreaterThan(empty?.gain ?? 0);
    const shell = turretSfxCueInto(impact([hit(1, 1, 10)]), origin, cue());
    expect(empty?.gain).toBeGreaterThan(shell?.gain ?? 0);
    const lit: TurretEvent = { type: 'barrelLit', id: 3, x: 0, y: 0, z: 0, fuseTicks: 5 };
    expect(turretSfxCueInto(lit, origin, cue())).toBeNull();
  });

  it('sizes a blast by its strongest hit plus the extra bodies it caught', () => {
    expect(turretBlastSize([])).toBe(0);
    expect(turretBlastSize([{ falloff: 0.4 }])).toBeCloseTo(0.4, 12);
    expect(turretBlastSize([{ falloff: 0.4 }, { falloff: 0.2 }])).toBeCloseTo(0.55, 12);
    expect(turretBlastSize(Array.from({ length: 9 }, () => ({ falloff: 1 })))).toBe(1);
  });

  it('crunches the turret where the strike landed, louder and deeper the more it cost', () => {
    const clips: Record<string, { spatial: boolean; variants: readonly unknown[] }> = SFX_CLIPS;
    expect(clips[TURRET_BREACH_SFX]?.spatial).toBe(true);
    expect(clips[TURRET_BREACH_SFX]?.variants.length).toBeGreaterThan(1);
    const at = { x: 103, y: 5, z: 200 };
    const light = turretBreachCueInto(1, at, cue());
    expect(light).toMatchObject({ key: TURRET_BREACH_SFX, x: 103, y: 5, z: 200, jitter: true });
    const lightGain = light.gain;
    const lightRate = light.rate;
    const heavy = turretBreachCueInto(12, at, cue());
    expect(heavy.gain).toBeGreaterThan(lightGain);
    expect(heavy.rate).toBeLessThan(lightRate);
    expect(heavy.rate).toBeGreaterThan(0.5);
  });

  it('keeps every other event silent', () => {
    const quiet: TurretEvent[] = [
      { type: 'waveStart', wave: 0, count: 3 },
      { type: 'landed', id: 1, x: 0, y: 0, z: 0 },
      { type: 'windupStart', id: 1, x: 0, z: 0 },
      { type: 'breach', id: 1, points: 4, integrity: 96, x: 3, y: 0, z: 0 },
    ];
    for (const event of quiet) expect(turretSfxCueInto(event, origin, cue())).toBeNull();
  });
});

const voices = (templateId: string, action: string) => `${templateId}_${action}`;
const player = (s: ReturnType<typeof sink>, clock = () => 0) =>
  new TurretDefenseSfx(s, voices, clock);

describe('Fire and Fly sound player', () => {
  it('preloads every clip a seat can play once, at the first seat it sees', () => {
    const s = sink();
    const sounds = player(s);
    sounds.update(null);
    expect(s.preload).not.toHaveBeenCalled();
    sounds.update(session([]));
    sounds.update(session([], 40));
    const templates = [...new Set(PLAN.kinds.map((k) => k.templateId))];
    expect(s.preload.mock.calls.map((c) => c[0]).sort()).toEqual(
      [
        TURRET_FIRE_SFX,
        TURRET_IMPACT_SFX,
        TURRET_BARREL_SFX,
        TURRET_BREACH_SFX,
        TURRET_THUMP_LIGHT_SFX,
        TURRET_THUMP_HEAVY_SFX,
        TURRET_KNOCK_SFX,
        ...templates.flatMap((id) => [`${id}_hurt`, `${id}_death`]),
      ].sort(),
    );
  });

  it('resolves the real cries of every planned monster by default', () => {
    const s = sink();
    new TurretDefenseSfx(s).update(session([]));
    const preloaded = s.preload.mock.calls.map((c) => c[0]);
    expect(preloaded).toContain('mob_beast_wolf_hurt');
    expect(preloaded).toContain('mob_ogre_death');
    const clips: Record<string, unknown> = SFX_CLIPS;
    for (const key of preloaded) expect(clips[key], key).toBeDefined();
  });

  it('plays the monsters from a point pulled toward the turret, like the blast', () => {
    const s = sink();
    const sounds = player(s);
    sounds.update(session([entry(1, 10, { type: 'landed', id: 2, x: 100, y: 5, z: 230 })]), 10);
    expect(s.playAt).toHaveBeenCalledTimes(1);
    const [key, x, y, z] = s.playAt.mock.calls[0];
    expect(key).toBe(TURRET_THUMP_HEAVY_SFX);
    expect(x).toBeCloseTo(100, 12);
    expect(y).toBe(5);
    expect(z).toBeCloseTo(200 + 15.7, 9);
  });

  it('keeps the monster gaps on its own clock, read once per batch', () => {
    const s = sink();
    let now = 1000;
    const clock = vi.fn(() => now);
    const sounds = player(s, clock);
    const ring = [entry(1, 10, { type: 'landed', id: 1, x: 100, y: 5, z: 205 })];
    sounds.update(session(ring), 10);
    sounds.update(session(ring), 10);
    expect(clock).toHaveBeenCalledTimes(1);
    now += 50;
    ring.push(entry(2, 11, { type: 'landed', id: 2, x: 100, y: 5, z: 205 }));
    sounds.update(session(ring), 11);
    now += 50;
    ring.push(entry(3, 12, { type: 'landed', id: 2, x: 100, y: 5, z: 205 }));
    sounds.update(session(ring), 12);
    expect(s.playAt.mock.calls.map((c) => c[0])).toEqual([
      TURRET_THUMP_LIGHT_SFX,
      TURRET_THUMP_HEAVY_SFX,
    ]);
  });

  it('plays each feedback entry once, by sequence number, and restarts with a new seat', () => {
    const s = sink();
    const sounds = player(s);
    const ring = [entry(1, 10, fired)];
    sounds.update(session(ring), 10);
    sounds.update(session(ring), 11);
    expect(s.playAt).toHaveBeenCalledTimes(1);
    expect(s.playAt.mock.calls[0][0]).toBe(TURRET_FIRE_SFX);
    ring.push(entry(2, 16, impact([])), entry(3, 16, { type: 'windupStart', id: 1, x: 0, z: 0 }));
    sounds.update(session(ring), 16);
    expect(s.playAt).toHaveBeenCalledTimes(2);
    expect(s.playAt.mock.calls[1][0]).toBe(TURRET_IMPACT_SFX);
    sounds.update(session(ring), 17);
    expect(s.playAt).toHaveBeenCalledTimes(2);
    // A new seat numbers its entries from 1 again.
    sounds.update(session([entry(1, 50, fired)], 45), 50);
    expect(s.playAt).toHaveBeenCalledTimes(3);
  });

  it('restarts when the seat is taken again on the same start tick, its sequence back at 1', () => {
    const s = sink();
    const sounds = player(s);
    sounds.update(session([entry(1, 10, fired), entry(2, 10, fired), entry(3, 10, fired)]), 10);
    expect(s.playAt).toHaveBeenCalledTimes(3);
    sounds.update(session([entry(1, 12, fired)]), 12);
    expect(s.playAt).toHaveBeenCalledTimes(4);
  });

  it('plays every entry of a new seat, even one whose ring already runs past the old sequence', () => {
    const s = sink();
    const sounds = player(s);
    sounds.update(session([entry(1, 10, fired), entry(2, 10, fired), entry(3, 10, fired)]), 10);
    s.playAt.mockClear();
    const next = [1, 2, 3, 4].map((seq) => entry(seq, 50, fired));
    sounds.update(session(next, 45), 50);
    expect(s.playAt).toHaveBeenCalledTimes(4);
  });

  it('still plays an entry exactly ten ticks old at its first read, not eleven', () => {
    const fresh = sink();
    player(fresh).update(session([entry(1, 50, fired)]), 60);
    expect(fresh.playAt).toHaveBeenCalledTimes(1);
    const late = sink();
    player(late).update(session([entry(1, 49, fired)]), 60);
    expect(late.playAt).not.toHaveBeenCalled();
  });

  it('plays nothing for entries already stale when first read', () => {
    const s = sink();
    const sounds = player(s);
    const stale = [
      entry(1, 10, fired),
      entry(2, 16, impact([])),
      entry(3, 16, { type: 'launched', id: 1, x: 100, y: 5, z: 205, vx: 0, vy: 5, vz: 0 }),
      entry(4, 16, { type: 'landed', id: 2, x: 100, y: 5, z: 205 }),
    ];
    sounds.update(session(stale), 60);
    expect(s.playAt).not.toHaveBeenCalled();
    sounds.update(session([...stale, entry(5, 60, fired)]), 60);
    expect(s.playAt).toHaveBeenCalledTimes(1);
  });

  it('plays one crunch for the strikes of a frame, at the strongest, and skips stale ones', () => {
    const s = sink();
    const sounds = player(s);
    const strike = (id: number, points: number, x: number): TurretEvent => ({
      type: 'breach',
      id,
      points,
      integrity: 100 - points,
      x,
      y: 5,
      z: 200,
    });
    sounds.update(session([entry(1, 40, strike(1, 8, 90))]), 60);
    expect(s.playAt).not.toHaveBeenCalled();
    const ring = [entry(1, 40, strike(1, 8, 90)), entry(2, 60, strike(1, 2, 97))];
    ring.push(entry(3, 60, strike(2, 10, 103)));
    sounds.update(session(ring), 60);
    expect(s.playAt).toHaveBeenCalledTimes(1);
    const [key, x, , , opts] = s.playAt.mock.calls[0];
    expect(key).toBe(TURRET_BREACH_SFX);
    expect(x).toBe(103);
    expect(opts).toMatchObject({ gain: turretBreachCueInto(12, { x: 0, y: 0, z: 0 }, cue()).gain });
    sounds.update(session(ring), 61);
    expect(s.playAt).toHaveBeenCalledTimes(1);
  });

  it("forgets the last seat's monsters when a new seat reuses their ids", () => {
    const s = sink();
    let now = 0;
    const sounds = player(s, () => now);
    sounds.update(session([entry(1, 10, { type: 'killed', id: 1, x: 100, y: 5, z: 205 })]), 10);
    expect(s.playAt.mock.calls.map((c) => c[0])).toEqual([`${PLAN.kinds[0].templateId}_death`]);
    now += 5000;
    const reborn: TurretEvent = {
      type: 'launched',
      id: 1,
      x: 100,
      y: 5,
      z: 205,
      vx: 0,
      vy: 5,
      vz: 0,
    };
    sounds.update(session([entry(1, 50, reborn)], 40, [{ id: 1, kind: HUGE }]), 50);
    expect(s.playAt.mock.calls.map((c) => c[0])).toEqual([
      `${PLAN.kinds[0].templateId}_death`,
      `${PLAN.kinds[HUGE].templateId}_hurt`,
    ]);
  });
});
