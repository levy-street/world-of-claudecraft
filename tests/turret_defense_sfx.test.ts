import { describe, expect, it, vi } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import {
  TURRET_BARREL_SFX,
  TURRET_BOMBLET_GAP_MS,
  TURRET_BOMBLET_SFX,
  TURRET_BOMBLET_VOICE_MS,
  TURRET_BOMBLET_VOICES,
  TURRET_BREACH_SFX,
  TURRET_FIRE_SFX,
  TURRET_FRAG_BURST_SFX,
  TURRET_FRAG_TAIL_SFX,
  TURRET_IMPACT_SFX,
  TURRET_ROLL_SFX,
  TURRET_SLAM_SFX,
  TurretBombletVoices,
  TurretDefenseSfx,
  type TurretSfxCue,
  type TurretSfxOwnShot,
  type TurretSfxShots,
  turretBlastSize,
  turretBombletDraw,
  turretBreachCueInto,
  turretFragTailCueInto,
  turretHeardInto,
  turretSfxCueInto,
  turretSlamCueInto,
} from '../src/game/turret_defense_sfx';
import {
  TURRET_KNOCK_SFX,
  TURRET_THUMP_HEAVY_SFX,
  TURRET_THUMP_LIGHT_SFX,
} from '../src/game/turret_monster_sfx';
import { fireAndFlyLookTemplate } from '../src/sim/content/fire_and_fly_looks';
import type { TurretEvent, TurretHit } from '../src/sim/minigames/turret_defense';
import type { TurretFeedback } from '../src/sim/minigames/turret_feedback';
import { TURRET_BOMBLETS, turretFragBomblets } from '../src/sim/minigames/turret_fragmentation';
import { TurretOwnShotLedger } from '../src/ui/hud/vehicle/turret_own_shot_core';
import type { TurretSessionView } from '../src/world_api/vehicles';
import { resolveArmedTurretPlan } from './helpers/turret_armed_plan';

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

/** Standing Watch's waves with both limited weapons. */
const PLAN = resolveArmedTurretPlan();
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
      { type: 'shockwaveHit', id: 1, hits: [hit(1, 1, 10)] },
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
    const templates = [
      ...new Set(PLAN.kinds.map((k) => fireAndFlyLookTemplate(k.templateId, PLAN.scenarioId))),
    ];
    expect(s.preload.mock.calls.map((c) => c[0]).sort()).toEqual(
      [
        ...new Set([
          TURRET_FIRE_SFX,
          TURRET_IMPACT_SFX,
          TURRET_BARREL_SFX,
          TURRET_BREACH_SFX,
          TURRET_THUMP_LIGHT_SFX,
          TURRET_THUMP_HEAVY_SFX,
          TURRET_KNOCK_SFX,
          TURRET_SLAM_SFX,
          TURRET_ROLL_SFX,
          TURRET_FRAG_BURST_SFX,
          TURRET_BOMBLET_SFX,
          TURRET_FRAG_TAIL_SFX,
        ]),
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
    expect(s.playAt.mock.calls.map((c) => c[0])).toEqual([
      `${fireAndFlyLookTemplate(PLAN.kinds[0].templateId, PLAN.scenarioId)}_death`,
    ]);
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
      `${fireAndFlyLookTemplate(PLAN.kinds[0].templateId, PLAN.scenarioId)}_death`,
      `${fireAndFlyLookTemplate(PLAN.kinds[HUGE].templateId, PLAN.scenarioId)}_hurt`,
    ]);
  });

  it("reports the player's own shot on the click, then plays its fired entry no more", () => {
    const shots = new TurretOwnShotLedger();
    const out = sink();
    const sounds = new TurretDefenseSfx(
      out,
      () => null,
      () => 0,
      shots,
    );
    const seated = (entries: TurretFeedback[]): TurretSessionView => {
      const base = session(entries, 0);
      return {
        ...base,
        defense: { ...base.defense, cx: 100, cz: 200, phase: 'wave', readyTick: 0 },
      };
    };
    const reports = () => out.playAt.mock.calls.filter((call) => call[0] === TURRET_FIRE_SFX);
    sounds.update(seated([]), 10);
    shots.mark(seated([]), 10, { x: 100, z: 230, dirX: 0, dirZ: 1, range: 30 });
    sounds.update(seated([]), 10);
    expect(reports()).toHaveLength(1);
    const heard = turretSfxCueInto(fired, origin, cue());
    expect(reports()[0].slice(1, 4)).toEqual([heard?.x, heard?.y, heard?.z]);
    sounds.update(seated([]), 11);
    expect(reports()).toHaveLength(1);
    // Its entry comes a round trip later: latched. Another shot's entry plays as usual.
    const own = entry(1, 13, fired);
    sounds.update(seated([own]), 13);
    expect(reports()).toHaveLength(1);
    const other = entry(2, 22, { ...fired, shotId: 2, x: 120 });
    sounds.update(seated([own, other]), 22);
    expect(reports()).toHaveLength(2);
  });

  it("never reports the player's own shot twice: late, or from a rebuilt player", () => {
    const shots = new TurretOwnShotLedger();
    const out = sink();
    const sounds = new TurretDefenseSfx(
      out,
      () => null,
      () => 0,
      shots,
    );
    const seated = (entries: TurretFeedback[]): TurretSessionView => {
      const base = session(entries, 0);
      return {
        ...base,
        defense: { ...base.defense, cx: 100, cz: 200, phase: 'wave', readyTick: 0 },
      };
    };
    const reports = (to: ReturnType<typeof sink>) =>
      to.playAt.mock.calls.filter((call) => call[0] === TURRET_FIRE_SFX);
    sounds.update(seated([]), 10);
    const serial = shots.mark(seated([]), 10, { x: 100, z: 230, dirX: 0, dirZ: 1, range: 30 });
    sounds.update(seated([]), 10);
    expect(reports(out)).toHaveLength(1);
    // A player built later on the page (a rebuild) starts past the shots already reported.
    const rebuiltOut = sink();
    const rebuilt = new TurretDefenseSfx(
      rebuiltOut,
      () => null,
      () => 0,
      shots,
    );
    rebuilt.update(seated([]), 11);
    expect(reports(rebuiltOut)).toHaveLength(0);
    // No entry inside the window, then the server's comes late: its report already played.
    const lapsed = 10 + shots.confirmWindow + 1;
    // The render and the reticle lapse the marks every frame.
    shots.update(seated([]), lapsed);
    sounds.update(seated([]), lapsed);
    expect(shots.status(serial)).toBe('refused');
    const late = entry(1, lapsed, fired);
    sounds.update(seated([late]), lapsed);
    expect(shots.status(serial)).toBe('confirmed');
    expect(reports(out)).toHaveLength(1);
  });
});

const fragFired: TurretEvent = { ...fired, shotId: 4, weapon: 'frag' };
const shockwave: TurretEvent = {
  type: 'shockwave',
  id: 1,
  x: 100,
  y: 5,
  z: 200,
  startTick: 20,
  reach: 12,
};
const fragBurst: TurretEvent = {
  type: 'fragBurst',
  shotId: 4,
  x: 100,
  y: 9,
  z: 230,
  bomblets: [],
};
const bomblet = (index: number, hits: TurretHit[] = [], x = 100, z = 230): TurretEvent => ({
  type: 'bomblet',
  shotId: 4,
  index,
  x,
  y: 5,
  z,
  hits,
});

/** The frag's real star from the tower at origin toward (100, 230), burst at tick 16. */
const STAR = turretFragBomblets(100, 230, 0, 1, 16);
/** The whole frag as the engine's feedback: the burst, then each bomblet on its landing tick. */
function fragRing(firstSeq: number): TurretFeedback[] {
  return [
    entry(firstSeq, 16, fragBurst),
    ...STAR.map((b, i) => entry(firstSeq + 1 + i, b.landTick, bomblet(b.index, [], b.x, b.z))),
  ];
}
/** Feeds `ring` one sim tick (50 ms) at a time from `from` to `to`; returns every play. */
function playTicks(
  sounds: TurretDefenseSfx,
  s: ReturnType<typeof sink>,
  ring: TurretFeedback[],
  from: number,
  to: number,
  clockMs: { now: number },
  view: (entries: TurretFeedback[]) => TurretSessionView = session,
) {
  for (let tick = from; tick <= to; tick++) {
    clockMs.now = tick * 50;
    sounds.update(view(ring.filter((e) => e.tick <= tick)), tick);
  }
  return s.playAt.mock.calls;
}

describe('Fire and Fly weapon sound cues', () => {
  it("ships every weapon clip as a spatial manifest key; the slam is never the breach's", () => {
    const clips: Record<string, { spatial: boolean }> = SFX_CLIPS;
    for (const key of [
      TURRET_SLAM_SFX,
      TURRET_ROLL_SFX,
      TURRET_FRAG_BURST_SFX,
      TURRET_BOMBLET_SFX,
      TURRET_FRAG_TAIL_SFX,
    ]) {
      expect(clips[key]?.spatial, key).toBe(true);
    }
    expect(TURRET_SLAM_SFX).not.toBe(TURRET_BREACH_SFX);
    expect(TURRET_SLAM_SFX).not.toContain('faultline');
  });

  it("reports a frag shell from the shell's muzzle, the same cannon a little lighter", () => {
    const shell = { ...(turretSfxCueInto(fired, origin, cue()) as TurretSfxCue) };
    const frag = turretSfxCueInto(fragFired, origin, cue());
    expect(frag).toMatchObject({ key: TURRET_FIRE_SFX, x: shell.x, y: shell.y, z: shell.z });
    expect(frag?.rate).toBeCloseTo(1.1, 12);
    expect(frag?.gain).toBeLessThan(shell.gain);
  });

  it('slams the tower at its foot on its own cooldown, and rolls the ring from the entry', () => {
    const slam = turretSlamCueInto(100, 5, 200, cue());
    expect(slam).toMatchObject({ key: TURRET_SLAM_SFX, x: 100, y: 5, z: 200, jitter: true });
    expect(slam.cooldownKey).toBeTruthy();
    expect(slam.cooldownKey).not.toBe(TURRET_SLAM_SFX);
    const roll = turretSfxCueInto(shockwave, origin, cue());
    expect(roll).toMatchObject({ key: TURRET_ROLL_SFX, x: 100, y: 5, z: 200 });
    expect(roll?.gain).toBeLessThan(slam.gain);
  });

  it('cracks a frag open at its burst point in the air, pulled toward the turret', () => {
    const burst = turretSfxCueInto(fragBurst, origin, cue());
    expect(burst).toMatchObject({ key: TURRET_FRAG_BURST_SFX, x: 100, y: 9 });
    expect(burst?.z).toBeCloseTo(200 + 15.7, 9);
  });

  it('ships the frag as its own three black-powder layers, loaded with the seat only', () => {
    const clips: Record<string, { preload: string; category: string; gain: number }> = SFX_CLIPS;
    const keys = [TURRET_FRAG_BURST_SFX, TURRET_BOMBLET_SFX, TURRET_FRAG_TAIL_SFX];
    expect(new Set([...keys, TURRET_IMPACT_SFX, 'impact_warrior_shieldcrack']).size).toBe(5);
    for (const key of keys) {
      expect(clips[key], key).toMatchObject({ preload: 'lazy', category: 'combat' });
    }
    expect(clips[TURRET_FRAG_BURST_SFX].gain).toBeGreaterThan(clips[TURRET_BOMBLET_SFX].gain);
    expect(clips[TURRET_BOMBLET_SFX].gain).toBeGreaterThan(clips[TURRET_FRAG_TAIL_SFX].gain);
  });

  it('pops each bomblet where it lands, whole, on its own cooldown, with its own stable level and pitch', () => {
    const first = { ...(turretSfxCueInto(bomblet(0), origin, cue()) as TurretSfxCue) };
    expect(first).toMatchObject({ key: TURRET_BOMBLET_SFX, x: 100, jitter: false, release: 0 });
    expect(first.z).toBeCloseTo(200 + 15.7, 9);
    expect(first.cooldownKey).toBeTruthy();
    expect(first.cooldownKey).not.toBe(TURRET_BOMBLET_SFX);
    expect(first.cooldown).toBe(0);
    const again = turretSfxCueInto(bomblet(0), origin, cue());
    expect(again).toMatchObject({ gain: first.gain, rate: first.rate });
    const looks = new Set<string>();
    for (let index = 0; index < TURRET_BOMBLETS; index++) {
      const one = turretSfxCueInto(bomblet(index), origin, cue()) as TurretSfxCue;
      expect(20 * Math.log10(one.gain)).toBeGreaterThanOrEqual(-1);
      expect(20 * Math.log10(one.gain)).toBeLessThan(1);
      expect(one.rate).toBeGreaterThanOrEqual(0.9);
      expect(one.rate).toBeLessThan(1.1);
      looks.add(`${one.gain}:${one.rate}`);
    }
    expect(looks.size).toBe(TURRET_BOMBLETS);
  });

  it('draws each bomblet from its shot and index only, spread over the whole range', () => {
    expect(turretBombletDraw(4, 3, 1)).toBe(turretBombletDraw(4, 3, 1));
    expect(turretBombletDraw(4, 3, 1)).not.toBe(turretBombletDraw(5, 3, 1));
    expect(turretBombletDraw(4, 3, 1)).not.toBe(turretBombletDraw(4, 3, 2));
    let low = 1;
    let high = -1;
    for (let shot = 1; shot <= 200; shot++) {
      for (let index = 0; index < TURRET_BOMBLETS; index++) {
        const draw = turretBombletDraw(shot, index, 1);
        expect(draw).toBeGreaterThanOrEqual(-1);
        expect(draw).toBeLessThan(1);
        low = Math.min(low, draw);
        high = Math.max(high, draw);
      }
    }
    expect(low).toBeLessThan(-0.9);
    expect(high).toBeGreaterThan(0.9);
  });

  it('settles the dirt and rumble of a frag at its burst point', () => {
    expect(turretFragTailCueInto(100, 9, 230, cue())).toMatchObject({
      key: TURRET_FRAG_TAIL_SFX,
      x: 100,
      y: 9,
      z: 230,
      gain: 1,
      rate: 1,
      jitter: true,
      cooldownKey: '',
      release: 0,
    });
  });

  it('a reused cue drops the bomblet cooldown for the next sound', () => {
    const out = cue();
    turretSfxCueInto(bomblet(0), origin, out);
    turretSfxCueInto(impact([]), origin, out);
    expect(out.cooldownKey).toBe('');
    expect(out.cooldown).toBeUndefined();
  });
});

describe('Fire and Fly bomblet voices', () => {
  it('spaces the bomblet starts and caps those sounding at once', () => {
    const voices = new TurretBombletVoices();
    expect(voices.ready(0)).toBe(true);
    voices.start(0);
    expect(voices.ready(TURRET_BOMBLET_GAP_MS - 1)).toBe(false);
    let at = 0;
    for (let i = 1; i < TURRET_BOMBLET_VOICES; i++) {
      at += TURRET_BOMBLET_GAP_MS;
      expect(voices.ready(at)).toBe(true);
      voices.start(at);
    }
    expect(voices.ready(at + TURRET_BOMBLET_GAP_MS)).toBe(false);
    expect(voices.ready(TURRET_BOMBLET_VOICE_MS)).toBe(true);
    expect(voices.ready(at)).toBe(false);
    voices.reset();
    expect(voices.ready(at)).toBe(true);
  });

  const FRAME_MS = 1000 / 60;

  /** Drives the player at 60 fps, bomblet i arriving at arrive(i) ms; each boom's start time. */
  function ripple(count: number, arrive: (i: number) => number, s = sink()): number[] {
    let now = 0;
    const sounds = player(s, () => now);
    const ring: TurretFeedback[] = [];
    const starts: number[] = [];
    for (let frame = 0; frame < 60; frame++) {
      now = frame * FRAME_MS;
      while (ring.length < count && arrive(ring.length) <= now) {
        ring.push(entry(ring.length + 1, 30, bomblet(ring.length % TURRET_BOMBLETS)));
      }
      const before = s.playAt.mock.calls.length;
      sounds.update(session([...ring]), 30);
      for (const call of s.playAt.mock.calls.slice(before)) {
        if (call[0] === TURRET_BOMBLET_SFX) starts.push(now);
      }
    }
    return starts;
  }

  function expectSpaced(starts: readonly number[]): void {
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(TURRET_BOMBLET_GAP_MS);
    }
    for (let i = TURRET_BOMBLET_VOICES; i < starts.length; i++) {
      expect(starts[i] - starts[i - TURRET_BOMBLET_VOICES]).toBeGreaterThanOrEqual(
        TURRET_BOMBLET_VOICE_MS,
      );
    }
  }

  it("plays every bomblet of a frag's ripple on its own frame, a frame of jitter included", () => {
    const s = sink();
    const arrive = (i: number) => 50 * i + (i % 2 === 1 ? FRAME_MS : 0);
    const starts = ripple(TURRET_BOMBLETS, arrive, s);
    expect(starts).toHaveLength(TURRET_BOMBLETS);
    for (let i = 0; i < starts.length; i++) expect(starts[i] - arrive(i)).toBeLessThan(FRAME_MS);
    const opts = s.playAt.mock.calls
      .filter((c) => c[0] === TURRET_BOMBLET_SFX)
      .map((c) => c[4] as { release?: number; cooldownKey?: string; jitter?: boolean });
    expect(opts.every((o) => o.release === undefined && o.jitter === false)).toBe(true);
    expect(new Set(opts.map((o) => o.cooldownKey)).size).toBe(1);
  });

  it("never holds a whole frag's eight-bomblet ripple at its own spacing", () => {
    expect(TURRET_BOMBLETS).toBe(8);
    const voices = new TurretBombletVoices();
    for (let i = 0; i < TURRET_BOMBLETS; i++) {
      const at = 50 * i - (i % 2 === 1 ? FRAME_MS : 0);
      expect(voices.ready(at), `bomblet ${i}`).toBe(true);
      voices.start(at);
    }
  });

  it('plays every bomblet a read bunched into one frame, one at a time within the cap', () => {
    const starts = ripple(TURRET_BOMBLETS, () => 100);
    expect(starts).toHaveLength(TURRET_BOMBLETS);
    expect(starts[0]).toBeCloseTo(100, 6);
    expectSpaced(starts);
  });

  it('keeps two overlapping bursts within the cap', () => {
    const starts = ripple(2 * TURRET_BOMBLETS, (i) => 25 * i);
    expect(starts.length).toBeGreaterThanOrEqual(TURRET_BOMBLETS);
    expectSpaced(starts);
  });

  /** The whole frag read in one frame, then 60 fps frames; each play with its frame time. */
  function bunchedFrag(ring: TurretFeedback[], clocks: (frame: number) => number) {
    const s = sink();
    let now = 0;
    const sounds = player(s, () => now);
    const plays: { key: string; at: number }[] = [];
    for (let frame = 0; frame < 30; frame++) {
      now = frame * FRAME_MS;
      const before = s.playAt.mock.calls.length;
      sounds.update(session(ring), clocks(frame));
      for (const call of s.playAt.mock.calls.slice(before)) plays.push({ key: call[0], at: now });
    }
    return plays;
  }
  const wholeFrag = () => [
    entry(1, 30, fragBurst),
    ...STAR.map((b, i) => entry(2 + i, 30, bomblet(b.index, [], b.x, b.z))),
  ];

  it("settles a frag's tail after its last pop, even when a bunched read holds the pops", () => {
    const plays = bunchedFrag(wholeFrag(), () => 30);
    const keys = plays.map((p) => p.key);
    expect(keys.filter((k) => k === TURRET_BOMBLET_SFX)).toHaveLength(TURRET_BOMBLETS);
    expect(keys.filter((k) => k === TURRET_FRAG_TAIL_SFX)).toHaveLength(1);
    expect(keys[keys.length - 1]).toBe(TURRET_FRAG_TAIL_SFX);
    const lastPop = plays.filter((p) => p.key === TURRET_BOMBLET_SFX).pop();
    expect(lastPop?.at).toBeGreaterThan(0);
    expect(plays[plays.length - 1].at).toBe(lastPop?.at);
  });

  it('drops the tail with a held last bomblet gone stale before its turn', () => {
    const plays = bunchedFrag(wholeFrag(), (frame) => (frame === 0 ? 30 : 41));
    expect(plays.map((p) => p.key)).not.toContain(TURRET_FRAG_TAIL_SFX);
  });

  it('holds no voice for a boom the sink refused', () => {
    const s = sink();
    s.playAt.mockImplementationOnce(() => false);
    const starts = ripple(2, (i) => 10 * i, s);
    expect(starts).toEqual([0, FRAME_MS]);
  });

  it('drops a waiting bomblet once its entry is stale', () => {
    const s = sink();
    let now = 0;
    const sounds = player(s, () => now);
    const ring = [entry(1, 30, bomblet(0)), entry(2, 30, bomblet(1))];
    sounds.update(session(ring), 30);
    now = 100;
    sounds.update(session(ring), 41);
    expect(s.playAt.mock.calls.filter((c) => c[0] === TURRET_BOMBLET_SFX)).toHaveLength(1);
  });
});

/** A ledger with one own mark, confirming the entries whose seq it names. */
function fakeShots(mark: TurretSfxOwnShot, confirms: readonly number[]): TurretSfxShots {
  return {
    newestSerial: 0,
    launchAfter: (_session, serial) => (serial < mark.serial ? mark : null),
    ownShotOf: (_session, e) => (confirms.includes(e.seq) ? mark.serial : 0),
  };
}

describe('Fire and Fly weapon sound player', () => {
  const calls = (s: ReturnType<typeof sink>) => s.playAt.mock.calls.map((c) => c[0]);
  /** A seat the ledger reads as running a wave, every weapon ready and charged. */
  const seated = (entries: TurretFeedback[]): TurretSessionView => {
    const base = session(entries, 0);
    return {
      ...base,
      defense: {
        ...base.defense,
        cx: 100,
        cz: 200,
        phase: 'wave',
        readyTick: 0,
        shockReadyTick: 0,
        phaseEndTick: 0,
        stats: { shockwaves: 0, frags: 0, resupplies: 0 },
      } as unknown as TurretSessionView['defense'],
    };
  };

  it('slams and rolls a Shockwave no click played, from its entry', () => {
    const s = sink();
    player(s).update(session([entry(1, 20, shockwave)]), 20);
    expect(calls(s)).toEqual([TURRET_SLAM_SFX, TURRET_ROLL_SFX]);
    expect(s.playAt.mock.calls[0].slice(1, 4)).toEqual([100, 5, 200]);
    expect(s.playAt.mock.calls[0][4]).toMatchObject({ cooldownKey: 'turret_slam' });
  });

  it('slams an own Shockwave on the click, then rolls its ring from the entry, never slamming twice', () => {
    const s = sink();
    const mark = {
      serial: 1,
      clock: 18,
      fromX: 100,
      fromZ: 200,
      x: 0,
      z: 0,
      weapon: 'shock' as const,
    };
    const sounds = new TurretDefenseSfx(
      s,
      () => null,
      () => 0,
      fakeShots(mark, [1]),
    );
    sounds.update(session([]), 18);
    expect(calls(s)).toEqual([TURRET_SLAM_SFX]);
    expect(s.playAt.mock.calls[0].slice(1, 4)).toEqual([100, origin.y, 200]);
    sounds.update(session([entry(1, 20, shockwave)]), 20);
    expect(calls(s)).toEqual([TURRET_SLAM_SFX, TURRET_ROLL_SFX]);
  });

  it('reports an own frag on the click, lighter, then its fired entry no more; burst and bomblets from theirs', () => {
    const s = sink();
    const mark = {
      serial: 1,
      clock: 10,
      fromX: 100,
      fromZ: 200,
      x: 100,
      z: 230,
      weapon: 'frag' as const,
    };
    const sounds = new TurretDefenseSfx(
      s,
      () => null,
      () => 0,
      fakeShots(mark, [1]),
    );
    sounds.update(session([]), 10);
    expect(calls(s)).toEqual([TURRET_FIRE_SFX]);
    expect(s.playAt.mock.calls[0][4]).toMatchObject({ rate: 1.1 });
    const ring = [entry(1, 12, fragFired), entry(2, 16, fragBurst), entry(3, 20, bomblet(0))];
    sounds.update(session(ring), 20);
    expect(calls(s)).toEqual([TURRET_FIRE_SFX, TURRET_FRAG_BURST_SFX, TURRET_BOMBLET_SFX]);
  });

  it('sounds a frag as its burst, its eight bomblets where they land, then its tail once at the burst point', () => {
    const s = sink();
    const clock = { now: 0 };
    const sounds = player(s, () => clock.now);
    const played = playTicks(sounds, s, fragRing(1), 15, 40, clock);
    expect(played.map((c) => c[0])).toEqual([
      TURRET_FRAG_BURST_SFX,
      ...STAR.slice(0, -1).map(() => TURRET_BOMBLET_SFX),
      TURRET_BOMBLET_SFX,
      TURRET_FRAG_TAIL_SFX,
    ]);
    const pops = played.filter((c) => c[0] === TURRET_BOMBLET_SFX);
    STAR.forEach((b, i) => {
      const heard = { x: b.x, z: b.z };
      turretHeardInto(origin, heard);
      expect(pops[i][1]).toBeCloseTo(heard.x, 9);
      expect(pops[i][2]).toBe(5);
      expect(pops[i][3]).toBeCloseTo(heard.z, 9);
    });
    const burstHeard = { x: 100, z: 230 };
    turretHeardInto(origin, burstHeard);
    for (const key of [TURRET_FRAG_BURST_SFX, TURRET_FRAG_TAIL_SFX]) {
      const at = played.find((c) => c[0] === key) as (typeof played)[number];
      expect(at[1]).toBeCloseTo(burstHeard.x, 9);
      expect(at[2]).toBe(9);
      expect(at[3]).toBeCloseTo(burstHeard.z, 9);
    }
  });

  it("settles a frag's tail at its last bomblet when its burst went unread", () => {
    const s = sink();
    const last = STAR[STAR.length - 1];
    player(s).update(session([entry(1, 30, bomblet(last.index, [], last.x, last.z))]), 30);
    const heard = { x: last.x, z: last.z };
    turretHeardInto(origin, heard);
    expect(s.playAt.mock.calls.map((c) => c[0])).toEqual([
      TURRET_BOMBLET_SFX,
      TURRET_FRAG_TAIL_SFX,
    ]);
    expect(s.playAt.mock.calls[1][1]).toBeCloseTo(heard.x, 9);
    expect(s.playAt.mock.calls[1][3]).toBeCloseTo(heard.z, 9);
  });

  it('settles the tail of a frag whose kept burst was overwritten at its last bomblet', () => {
    const s = sink();
    const burstOf = (shotId: number): TurretEvent => ({
      type: 'fragBurst',
      shotId,
      x: 100 + shotId,
      y: 9,
      z: 230,
      bomblets: [],
    });
    const lastOf = (shotId: number): TurretEvent => ({
      type: 'bomblet',
      shotId,
      index: TURRET_BOMBLETS - 1,
      x: 90,
      y: 5,
      z: 250,
      hits: [],
    });
    const ring = [1, 2, 3, 4, 5].map((shot) => entry(shot, 30, burstOf(shot)));
    ring.push(entry(6, 30, lastOf(1)));
    let now = 0;
    const sounds = player(s, () => now);
    sounds.update(session(ring), 30);
    now = 1000;
    sounds.update(session([...ring, entry(7, 30, lastOf(2))]), 30);
    const tails = s.playAt.mock.calls.filter((c) => c[0] === TURRET_FRAG_TAIL_SFX);
    expect(tails).toHaveLength(2);
    const bombletHeard = { x: 90, z: 250 };
    turretHeardInto(origin, bombletHeard);
    expect(tails[0][1]).toBeCloseTo(bombletHeard.x, 9);
    expect(tails[0][2]).toBe(5);
    const burstHeard = { x: 102, z: 230 };
    turretHeardInto(origin, burstHeard);
    expect(tails[1][1]).toBeCloseTo(burstHeard.x, 9);
    expect(tails[1][2]).toBe(9);
  });

  it("reports someone else's frag from its entry, lighter", () => {
    const s = sink();
    player(s).update(session([entry(1, 10, fragFired)]), 10);
    expect(calls(s)).toEqual([TURRET_FIRE_SFX]);
    expect(s.playAt.mock.calls[0][4]).toMatchObject({ rate: 1.1 });
  });

  it("with the page's ledger, a frag click's report plays once and its fired entry is latched", () => {
    const shots = new TurretOwnShotLedger();
    const out = sink();
    const clock = { now: 0 };
    const sounds = new TurretDefenseSfx(
      out,
      () => null,
      () => clock.now,
      shots,
    );
    sounds.update(seated([]), 10);
    shots.markWeapon(seated([]), 10, { x: 100, z: 230, dirX: 0, dirZ: 1, range: 30 }, 'frag');
    sounds.update(seated([]), 10);
    expect(calls(out)).toEqual([TURRET_FIRE_SFX]);
    expect(out.playAt.mock.calls[0][4]).toMatchObject({ rate: 1.1 });
    sounds.update(seated([entry(1, 12, fragFired)]), 12);
    expect(calls(out)).toEqual([TURRET_FIRE_SFX]);
    const ring = [entry(1, 12, fragFired), ...fragRing(2)];
    playTicks(sounds, out, ring, 12, 40, clock, seated);
    expect(calls(out)).toEqual([
      TURRET_FIRE_SFX,
      TURRET_FRAG_BURST_SFX,
      ...STAR.map(() => TURRET_BOMBLET_SFX),
      TURRET_FRAG_TAIL_SFX,
    ]);
  });

  it("with the page's ledger, an own Shockwave slams once on the click and rolls from its entry", () => {
    const shots = new TurretOwnShotLedger();
    const out = sink();
    const sounds = new TurretDefenseSfx(
      out,
      () => null,
      () => 0,
      shots,
    );
    sounds.update(seated([]), 18);
    shots.markWeapon(seated([]), 18, { x: 100, z: 200, dirX: 0, dirZ: 1, range: 0 }, 'shock');
    sounds.update(seated([]), 18);
    expect(calls(out)).toEqual([TURRET_SLAM_SFX]);
    sounds.update(seated([entry(1, 20, shockwave)]), 20);
    expect(calls(out)).toEqual([TURRET_SLAM_SFX, TURRET_ROLL_SFX]);
  });
});
