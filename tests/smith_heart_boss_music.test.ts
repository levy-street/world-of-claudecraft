// The Smith's Heart's own boss score (src/game/smith_heart_boss_music.ts):
// every encounter its own committed cue, the final boss's cue following its
// stage (the quarter fight, the 15 percent climax, Mythic's hidden phase),
// a kill handing the mix back at once, and a stage change crossfading the two
// streamed loops (src/game/boss_music_loop.ts BossLoopTrack). The stage cases
// drive a REAL Sim through the final's dev verbs; the decision reads only
// entity fields the snapshot mirrors (the phase aura, dead, aggro), which the
// final's wire tests prove arrive online unchanged.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOSS_TRACK_CROSSFADE_MS,
  BOSS_TRACK_URLS,
  BossLoopTrack,
} from '../src/game/boss_music_loop';
import {
  InstanceMusicController,
  type InstanceMusicEntity,
  type InstanceMusicInput,
  instanceMusicDecision,
} from '../src/game/instance_music';
import {
  SMITH_HEART_BOSS_TRACK_URLS,
  smithHeartStageTrack,
  SMITH_HEART_BOSS_TRACKS as T,
} from '../src/game/smith_heart_boss_music';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import { MOBS, ZONES } from '../src/sim/data';
import { FINAL_BOSS } from '../src/sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS as A,
  FINAL_STAGE_CODES,
  type FinalStage,
} from '../src/sim/encounters/smith_heart/final_phase_ids';
import { type FinalFight, finalFight } from './helpers/final_fight';

const sec = (s: number) => Math.round(s * 20);
const zone = ZONES.find((z) => z.id === 'thornpeak_heights') ?? ZONES[0];

function input(
  f: FinalFight | null,
  overrides: Partial<InstanceMusicInput> = {},
): InstanceMusicInput {
  const pid = f?.pids[0] ?? 7;
  const pos = f ? f.sim.entities.get(pid)?.pos : undefined;
  return {
    now: 20000,
    lastCombatEventAt: -1e9,
    lastBossCombatEventAt: -1e9,
    inCombat: false,
    playerId: pid,
    playerPos: pos ? { x: pos.x, z: pos.z } : { x: 0, z: 0 },
    zone,
    inDungeon: true,
    entities: f ? f.sim.entities.values() : [],
    riftFloor: null,
    ...overrides,
  };
}

const staged = (stage: FinalStage | null, aggro: number | null = 7): InstanceMusicEntity => ({
  kind: 'mob',
  dead: false,
  templateId: FINAL_BOSS,
  aggroTargetId: aggro,
  auras: stage === null ? [] : [{ id: A.phase, value: FINAL_STAGE_CODES[stage] }],
});

const mob = (templateId: string, aggro: number | null, dead = false): InstanceMusicEntity => ({
  kind: 'mob',
  dead,
  templateId,
  aggroTargetId: aggro,
});

describe("the Smith's Heart's boss cues", () => {
  it('gives every encounter its own committed, hash-versioned cue (the Council one shared)', () => {
    const ids = Object.keys(SMITH_HEART_BOSS_TRACK_URLS);
    expect(ids.sort()).toEqual(
      [
        'heart_breath_guardian',
        'heart_hammer_guardian',
        'heart_heat_guardian',
        'heart_masterless_strength',
        'heart_quench_guardian',
        'heart_seam_singer',
      ].sort(),
    );
    for (const id of ids) {
      expect(MOBS[id], id).toBeDefined();
      expect(BOSS_TRACK_URLS[id], id).toBe(SMITH_HEART_BOSS_TRACK_URLS[id]);
    }
    expect(SMITH_HEART_BOSS_TRACK_URLS.heart_hammer_guardian).toBe(T.council);
    expect(SMITH_HEART_BOSS_TRACK_URLS.heart_seam_singer).toBe(T.council);
    expect(new Set(Object.values(T)).size).toBe(7);
    for (const url of Object.values(T)) {
      expect(url).toMatch(/^\/audio\/music\/boss_heart_[a-z_]+\.mp3\?v=[a-f0-9]{12}$/);
      const [asset, hash] = url.split('?v=');
      const bytes = readFileSync(path.join(__dirname, '..', 'public', asset));
      expect(createHash('sha256').update(bytes).digest('hex').slice(0, 12), url).toBe(hash);
      // In line with the other boss cues: a few MB, never a lossless master.
      expect(bytes.length, url).toBeLessThan(5 * 1024 * 1024);
    }
  });

  it('follows the final boss through its stages', () => {
    const want: Record<FinalStage, string> = {
      fight: T.final,
      leap: T.final,
      call: T.final,
      finalLeap: T.finalLast,
      final: T.finalLast,
      kneel: T.finalHidden,
      rebirth: T.finalHidden,
      collapse: T.finalHidden,
    };
    for (const stage of Object.keys(want) as FinalStage[]) {
      expect(smithHeartStageTrack(staged(stage)), stage).toBe(want[stage]);
      expect(instanceMusicDecision(input(null, { entities: [staged(stage)] })).bossTrackUrl).toBe(
        want[stage],
      );
    }
    // No phase aura yet (the pull's first frame): the opening cue.
    expect(smithHeartStageTrack(staged(null))).toBe(T.final);
    // Any other boss is not staged here.
    expect(smithHeartStageTrack(mob('heart_heat_guardian', 7))).toBeNull();
    expect(
      instanceMusicDecision(input(null, { entities: [mob('heart_heat_guardian', 7)] }))
        .bossTrackUrl,
    ).toBe(T.heat);
  });
});

describe('the final boss over a real Sim', () => {
  it('plays the opening cue, the climax from 15 percent, the dread through the hidden phase', () => {
    const f = finalFight(5, 41);
    f.dev('/dev heart final mythic');
    f.pullIn('heat');
    f.tick(sec(1));
    expect(instanceMusicDecision(input(f)).bossTrackUrl).toBe(T.final);
    f.dev('/dev heart final fill all 0');
    f.dev('/dev heart final last');
    f.gather(HEART_ROOM.x, HEART_ROOM.z, 5);
    f.tick(sec(0.5));
    // The stride into the centre already carries the climax.
    expect(instanceMusicDecision(input(f)).bossTrackUrl).toBe(T.finalLast);
    for (let i = 0; i < sec(5) && f.state()?.phase.stage !== 'final'; i++) f.tick(1);
    expect(f.state()?.phase.stage).toBe('final');
    expect(instanceMusicDecision(input(f)).bossTrackUrl).toBe(T.finalLast);
    f.dev('/dev heart final hidden');
    f.tick(sec(0.5));
    expect(f.state()?.phase.stage).toBe('kneel');
    expect(instanceMusicDecision(input(f)).bossTrackUrl).toBe(T.finalHidden);
    f.dev('/dev heart final collapse');
    f.tick(1);
    expect(f.state()?.phase.stage).toBe('collapse');
    expect(instanceMusicDecision(input(f)).bossTrackUrl).toBe(T.finalHidden);
  });

  it('hands the mix back at once on a kill, after the grace on a reset', () => {
    for (const end of ['kill', 'reset'] as const) {
      const f = finalFight(5, 41);
      f.pullIn('heat');
      f.tick(sec(1));
      const port = { resetForDungeonEntry: vi.fn(), update: vi.fn(), setBossCombat: vi.fn() };
      const controller = new InstanceMusicController(port);
      controller.update(input(f, { now: 20000 }));
      expect(port.setBossCombat, end).toHaveBeenLastCalledWith(true, T.final);
      if (end === 'kill') {
        // Past the intermissions' floors: into the final phase, then the blow.
        f.dev('/dev heart final fill all 0');
        f.dev('/dev heart final last');
        f.gather(HEART_ROOM.x, HEART_ROOM.z, 5);
        for (let i = 0; i < sec(5) && f.state()?.phase.stage !== 'final'; i++) f.tick(1);
        controller.update(input(f, { now: 20200 }));
        expect(port.setBossCombat, end).toHaveBeenLastCalledWith(true, T.finalLast);
        f.sim.ctx.dealDamage(
          f.players[1],
          f.boss(),
          f.boss().maxHp * 2,
          false,
          'physical',
          'Strike',
          'hit',
        );
        f.tick(2);
        expect(f.boss().dead).toBe(true);
        controller.update(input(f, { now: 20500 }));
        expect(port.setBossCombat, end).toHaveBeenLastCalledWith(false);
      } else {
        f.dev('/dev heart final reset');
        f.tick(2);
        // A dropped target holds the cue through the grace (an immune stride)...
        controller.update(input(f, { now: 20500 }));
        expect(port.setBossCombat, end).toHaveBeenLastCalledWith(true, T.final);
        // ...and the zone score returns once it has run out.
        controller.update(input(f, { now: 30500 }));
        expect(port.setBossCombat, end).toHaveBeenLastCalledWith(false);
      }
    }
  });
});

describe('a council sharing one cue', () => {
  it('keeps the cue while one member stands, releases it once both lie dead', () => {
    const port = { resetForDungeonEntry: vi.fn(), update: vi.fn(), setBossCombat: vi.fn() };
    const controller = new InstanceMusicController(port);
    controller.update(
      input(null, {
        entities: [mob('heart_hammer_guardian', 7), mob('heart_seam_singer', 7)],
      }),
    );
    expect(port.setBossCombat).toHaveBeenLastCalledWith(true, T.council);
    // The Singer falls; the Guardian's rush drops its target for a moment.
    controller.update(
      input(null, {
        now: 21000,
        entities: [mob('heart_hammer_guardian', null), mob('heart_seam_singer', 7, true)],
      }),
    );
    expect(port.setBossCombat).toHaveBeenLastCalledWith(true, T.council);
    controller.update(
      input(null, {
        now: 22000,
        entities: [mob('heart_hammer_guardian', 7, true), mob('heart_seam_singer', 7, true)],
      }),
    );
    expect(port.setBossCombat).toHaveBeenLastCalledWith(false);
  });

  it('a corpse of one dungeon boss never cuts another boss short', () => {
    const decision = instanceMusicDecision(
      input(null, {
        entities: [
          mob('morthen', 7, true),
          mob('heart_breath_guardian', 7, true),
          mob('heart_quench_guardian', null),
        ],
      }),
    );
    expect([...decision.slainBossTrackUrls]).toEqual([T.breath]);
  });
});

describe("the immediate stop is the raid's own", () => {
  it('every other boss keeps its cue through the 10 s grace after its kill', () => {
    for (const boss of ['morthen', 'korzul_the_gravewyrm', 'mere_hydra_head_left']) {
      const url = BOSS_TRACK_URLS[boss];
      expect(url, boss).toBeTruthy();
      const port = { resetForDungeonEntry: vi.fn(), update: vi.fn(), setBossCombat: vi.fn() };
      const controller = new InstanceMusicController(port);
      controller.update(input(null, { now: 20000, entities: [mob(boss, 7)] }));
      expect(port.setBossCombat, boss).toHaveBeenLastCalledWith(true, url);
      // Killed: the corpse never releases the cue early...
      const dead = { entities: [mob(boss, null, true)] };
      expect(instanceMusicDecision(input(null, dead)).slainBossTrackUrls.size, boss).toBe(0);
      controller.update(input(null, { now: 20500, ...dead }));
      expect(port.setBossCombat, boss).toHaveBeenLastCalledWith(true, url);
      controller.update(input(null, { now: 29900, ...dead }));
      expect(port.setBossCombat, boss).toHaveBeenLastCalledWith(true, url);
      // ...the grace runs out as it always did.
      controller.update(input(null, { now: 30000, ...dead }));
      expect(port.setBossCombat, boss).toHaveBeenLastCalledWith(false);
    }
  });

  it("every Smith's Heart boss releases its cue the moment it falls", () => {
    for (const [boss, url] of Object.entries(SMITH_HEART_BOSS_TRACK_URLS)) {
      const port = { resetForDungeonEntry: vi.fn(), update: vi.fn(), setBossCombat: vi.fn() };
      const controller = new InstanceMusicController(port);
      controller.update(input(null, { now: 20000, entities: [mob(boss, 7)] }));
      expect(port.setBossCombat, boss).toHaveBeenLastCalledWith(true, url);
      controller.update(input(null, { now: 20500, entities: [mob(boss, null, true)] }));
      expect(port.setBossCombat, boss).toHaveBeenLastCalledWith(false);
    }
  });
});

/** A stand-in media element: play/pause and a volume, nothing decoded. */
class FakeAudio {
  static made: FakeAudio[] = [];
  paused = true;
  volume = 1;
  loop = false;
  preload = '';
  src: string | null;
  constructor(src: string) {
    this.src = src;
    FakeAudio.made.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  removeAttribute(name: string): void {
    if (name === 'src') this.src = null;
  }
  load(): void {}
}

describe('a stage change crossfades the two loops', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeAudio.made = [];
  });

  it('fades the outgoing cue down while the next fades up, then lets it go', () => {
    vi.stubGlobal('Audio', FakeAudio);
    let now = 0;
    const loop = new BossLoopTrack(() => now);
    loop.retarget(T.final);
    const first = loop.element() as unknown as FakeAudio;
    void first.play();
    loop.setVolume(0.6);
    expect(first.volume).toBeCloseTo(0.6);

    loop.retarget(T.finalLast);
    const next = loop.element() as unknown as FakeAudio;
    expect(next).not.toBe(first);
    expect(next.src).toBe(T.finalLast);
    expect(loop.fadingCount).toBe(1);
    loop.setVolume(0.6);
    expect(next.volume).toBeCloseTo(0);
    expect(first.volume).toBeCloseTo(0.6);
    expect(first.paused).toBe(false);

    now = BOSS_TRACK_CROSSFADE_MS / 2;
    loop.setVolume(0.6);
    // Equal power at the midpoint: both at 0.6 * cos(45 degrees).
    expect(next.volume).toBeCloseTo(0.6 * Math.SQRT1_2);
    expect(first.volume).toBeCloseTo(0.6 * Math.SQRT1_2);

    now = BOSS_TRACK_CROSSFADE_MS;
    loop.setVolume(0.6);
    expect(next.volume).toBeCloseTo(0.6);
    expect(first.paused).toBe(true);
    expect(first.src).toBeNull();
    expect(loop.fadingCount).toBe(0);
  });

  it('cuts straight over when nothing was sounding, and drops a fade on pause', () => {
    vi.stubGlobal('Audio', FakeAudio);
    let now = 0;
    const loop = new BossLoopTrack(() => now);
    loop.retarget(T.council);
    loop.element();
    // Never played (a menu was open): no fade, the next cue starts at level.
    loop.retarget(T.breath);
    expect(loop.fadingCount).toBe(0);
    const breath = loop.element() as unknown as FakeAudio;
    loop.setVolume(0.5);
    expect(breath.volume).toBeCloseTo(0.5);

    void breath.play();
    loop.retarget(T.quench);
    expect(loop.fadingCount).toBe(1);
    now = 100;
    loop.pause();
    expect(loop.fadingCount).toBe(0);
    expect(breath.paused).toBe(true);
  });
});
