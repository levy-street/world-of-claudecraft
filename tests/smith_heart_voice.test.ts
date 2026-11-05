// The Smith's Heart's voices (docs/design/raid/smith_heart.md section 7, the
// voice pack): the kill lines' watch (voice_slain.ts) pure and over a REAL
// fight, the Masterless Strength's lines (final_voice.ts) over a real Sim
// from the arrival to its fall, every line a catalog key with the same
// English and a shipped, manifest-listed clip in its own voice, and the
// client's mix (src/ui/voice_events.ts voicedYellMix, src/game/voice.ts): a
// raid line over the score, queued behind the one before it, fading with its
// speaker's distance; every other yell as before.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { yellKey } from '../scripts/voices/extra_lines.mjs';
import {
  packLine,
  SMITH_HEART_DIRECTIONS,
  SMITH_HEART_SPEAKERS,
} from '../scripts/voices/smith_heart_voice_pack.mjs';
import {
  GameVoice,
  VOICE_FULL_DIST,
  VOICE_QUEUE_STALE_MS,
  voiceDistanceGain,
  voiceFadeGain,
} from '../src/game/voice';
import { VOICE_LINES } from '../src/game/voice_manifest.generated';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import { finalBoss } from '../src/sim/encounters/smith_heart/final';
import {
  ARRIVAL_LINE_AT,
  DRINK_EVERY,
  FINAL_LINES,
  type FinalMoment,
  finalLineKey,
} from '../src/sim/encounters/smith_heart/final_voice';
import { QUENCH_LINES } from '../src/sim/encounters/smith_heart/quench_voice';
import {
  SMITH_HEART_VOICE_LINES,
  SMITH_HEART_VOICES,
} from '../src/sim/encounters/smith_heart/voice_lines';
import {
  freshSlainWatch,
  SLAY_EVERY,
  slayMoment,
  watchSlain,
} from '../src/sim/encounters/smith_heart/voice_slain';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { t } from '../src/ui/i18n';
import {
  NYTHRAXIS_VOICE_GAIN,
  SMITH_HEART_VOICE_FADE,
  SMITH_HEART_VOICE_GAIN,
  voicedYellMix,
} from '../src/ui/voice_events';
import { type FinalFight, finalFight } from './helpers/final_fight';
import { quenchFight } from './helpers/quench_fight';

type Yell = Extract<SimEvent, { type: 'chat' }>;
const sec = (s: number) => Math.round(s * 20);
const repoRoot = join(__dirname, '..');

/** The yells among `events` that key on `prefix`, once each (the copy sent
 *  to `pid`). */
function said(events: readonly SimEvent[], prefix: string, pid: number): string[] {
  return events
    .filter(
      (e): e is Yell =>
        e.type === 'chat' &&
        e.channel === 'yell' &&
        (e as Yell).textKey?.startsWith(prefix) === true &&
        (e as Yell & { pid?: number }).pid === pid,
    )
    .map((y) => (y.textKey ?? '').slice(prefix.length));
}

function slay(killer: Entity, p: Entity, sim: Sim): void {
  sim.ctx.dealDamage(killer, p, p.hp * 10 + 100000, false, 'frost', 'Test', 'hit');
}

describe('the kill lines watch', () => {
  it('counts each new death once, forgets the revived, and turns its variants in order', () => {
    const w = freshSlainWatch();
    const a = { id: 1, dead: false } as Entity;
    const b = { id: 2, dead: false } as Entity;
    expect(watchSlain(w, [a, b])).toBe(0);
    a.dead = true;
    expect(watchSlain(w, [a, b])).toBe(1);
    expect(watchSlain(w, [a, b])).toBe(0);
    a.dead = false;
    expect(watchSlain(w, [a, b])).toBe(0);
    a.dead = true;
    b.dead = true;
    expect(watchSlain(w, [a, b])).toBe(2);
    expect(w.kills).toBe(3);
    expect([1, 2, 3, 4].map((k) => slayMoment(k, 3))).toEqual([
      'slay_a',
      'slay_b',
      'slay_c',
      'slay_a',
    ]);
    expect([1, 2, 3].map((k) => slayMoment(k, 2))).toEqual(['slay_a', 'slay_b', 'slay_a']);
  });

  it('over a real fight: one line per fall, never two inside SLAY_EVERY, the variants in turn', () => {
    const f = quenchFight(6);
    expect(f.dev('/dev heart quench pull')).toBe(true);
    f.tick(sec(3));
    const st = f.state();
    if (!st) throw new Error('no fight');
    const pid = f.pids[0];
    slay(f.boss(), f.players[5], f.sim);
    let ev = f.tick(2, false);
    expect(said(ev, 'hudChrome.quenchGuardian.say.', pid)).toEqual(['slay_a']);
    const line = ev.find((e) => e.type === 'chat' && (e as Yell).textKey?.endsWith('slay_a'));
    expect((line as Yell).text).toBe(QUENCH_LINES.slay_a);
    // A second fall inside the clock says nothing...
    slay(f.boss(), f.players[4], f.sim);
    ev = f.tick(sec(SLAY_EVERY - 2));
    expect(said(ev, 'hudChrome.quenchGuardian.say.slay', pid)).toEqual([]);
    // ...the next one past it says the next line.
    f.tick(sec(3));
    slay(f.boss(), f.players[3], f.sim);
    ev = f.tick(2);
    expect(said(ev, 'hudChrome.quenchGuardian.say.', pid)).toEqual(['slay_c']);
  });
});

/** Strike the boss as a raider would (its floors and its shield hold). */
function strike(f: FinalFight, amount: number): void {
  f.sim.ctx.dealDamage(f.players[1], f.boss(), amount, false, 'physical', 'Strike', 'hit');
}

describe('the Masterless Strength speaks', () => {
  const P = 'hudChrome.finalBoss.say.';

  it('pulls, drinks a new quarter, calls at 70, breaks with its Splinters, falls', () => {
    const f = finalFight(6);
    const pid = f.pids[0];
    f.pullIn('heat');
    // The pull's line was said; the first quarter is the pull's own (no
    // drink line).
    const voice = f.state()?.voice;
    expect(voice?.said.pull).toBeDefined();
    expect(Object.keys(voice?.said ?? {}).filter((k) => k.startsWith('drink'))).toEqual([]);
    let ev: SimEvent[];
    // Dragged into a new quarter: it drinks it.
    f.dev('/dev heart final quarter hammer');
    ev = f.tick(sec(2));
    expect(said(ev, P, pid)).toContain('drinkHammer');
    // 70 percent: the stride and the call.
    strike(f, f.boss().maxHp);
    ev = f.tick(sec(3.5));
    expect(said(ev, P, pid)).toContain('call');
    f.tick(sec(3));
    f.dev('/dev heart final killadds');
    ev = f.tick(2);
    expect(said(ev, P, pid)).toEqual(['shattered']);
    // Its fall.
    f.dev('/dev heart final fill all 0');
    f.dev('/dev heart final last');
    for (let i = 0; i < sec(6) && f.state()?.phase.stage !== 'final'; i++) f.tick(1);
    f.sim.ctx.dealDamage(
      f.players[1],
      f.boss(),
      f.boss().maxHp * 2,
      false,
      'physical',
      'Strike',
      'hit',
    );
    ev = f.tick(2);
    expect(f.boss().dead).toBe(true);
    expect(said(ev, P, pid)).toContain('death');
  });

  it('a quarter drunk again inside DRINK_EVERY is said once', () => {
    const f = finalFight(6);
    const pid = f.pids[0];
    f.pullIn('heat');
    f.tick(2);
    const heard: string[] = [];
    for (const q of ['hammer', 'quench', 'hammer']) {
      f.dev(`/dev heart final quarter ${q}`);
      heard.push(...said(f.tick(sec(12)), P, pid));
    }
    expect(heard.filter((m) => m === 'drinkHammer')).toHaveLength(1);
    expect(heard).toContain('drinkQuench');
    expect(DRINK_EVERY).toBeGreaterThan(24);
  });

  it('the raid lying still on the Anvil hears its wipe line', () => {
    const f = finalFight(5);
    const pid = f.pids[0];
    f.pullIn('heat');
    f.tick(2);
    for (const p of f.players) slay(f.boss(), p, f.sim);
    const ev = f.tick(sec(8), false);
    expect(said(ev, P, pid)).toContain('wipe');
  });

  it('every line is its catalog key, with the same English', () => {
    for (const [moment, text] of Object.entries(FINAL_LINES)) {
      expect(t(finalLineKey(moment as FinalMoment) as never), moment).toBe(text);
    }
  });
});

describe('the arrival', () => {
  const DUNGEON = DUNGEONS[SMITH_HEART_DUNGEON];

  function arrive(seed = 17) {
    const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
    const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, sim.player.id);
    dev('/dev heart enter');
    const inst = sim.ctx.instances.find((i) => {
      if (i.dungeonId !== SMITH_HEART_DUNGEON || i.partyKey === null || i.exitId === null)
        return false;
      const o = instanceOrigin(DUNGEON.index, i.slot);
      return Math.abs(sim.player.pos.x - o.x) < 300 && Math.abs(sim.player.pos.z - o.z) < 250;
    });
    if (!inst) throw new Error('no claim');
    for (let i = 0; i < 3; i++) sim.tick();
    return { sim, dev, inst };
  }

  /** The arrival's lines heard over `seconds`, with the second each came. */
  function listen(sim: Sim, seconds: number): { moment: string; at: number }[] {
    const out: { moment: string; at: number }[] = [];
    for (let i = 0; i < sec(seconds); i++) {
      for (const m of said(sim.tick(), 'hudChrome.finalBoss.say.', sim.player.id))
        out.push({ moment: m, at: (i + 1) / 20 });
    }
    return out;
  }

  // Fifty-five sim seconds of a whole world: slow on a loaded runner, so a
  // generous timeout (the assertion is the order and timing, not the speed).
  it('the heart speaks three lines over its rebuild, in order and on time, once', () => {
    const { sim, dev, inst } = arrive();
    expect(finalBoss(sim.ctx, inst)).not.toBeNull();
    dev('/dev heart tp heartroom');
    const heard = listen(sim, 20);
    expect(heard.map((h) => h.moment)).toEqual(ARRIVAL_LINE_AT.map((l) => l.moment));
    heard.forEach((h, i) => {
      expect(h.at).toBeGreaterThanOrEqual(ARRIVAL_LINE_AT[i].at);
      expect(h.at).toBeLessThan(ARRIVAL_LINE_AT[i].at + 0.2);
    });
    // Staying in the Heart, it never repeats.
    expect(listen(sim, 15)).toEqual([]);
    // A dev replay of the arrival hears them again.
    dev('/dev heart arrival');
    expect(listen(sim, 20).map((h) => h.moment)).toEqual(ARRIVAL_LINE_AT.map((l) => l.moment));
    expect(Math.hypot(HEART_ROOM.x, HEART_ROOM.z)).toBeGreaterThan(0);
  }, 120_000);
});

describe('the voice pack', () => {
  const manifestKeys = new Set(Object.keys(VOICE_LINES));

  it('every line is directed, spoken in its own voice, shipped and listed in the manifest', () => {
    const ids: Record<string, string> = JSON.parse(
      readFileSync(join(repoRoot, 'scripts/voices/voice_ids.json'), 'utf8'),
    );
    expect(SMITH_HEART_VOICE_LINES.length).toBeGreaterThanOrEqual(100);
    for (const line of SMITH_HEART_VOICE_LINES) {
      const packed = packLine(line);
      expect(packed.key, line.id).toBe(yellKey(line.text));
      expect(ids[line.voiceNpc], line.voiceNpc).toBeTruthy();
      expect(
        existsSync(join(repoRoot, 'public/audio/voice', line.voiceNpc, `${packed.key}.mp3`)),
        line.id,
      ).toBe(true);
      expect(manifestKeys.has(packed.key), line.id).toBe(true);
      expect(VOICE_LINES[packed.key], line.id).toContain(`/audio/voice/${line.voiceNpc}/`);
    }
    // No stale direction for a line that no longer exists.
    const live = new Set(SMITH_HEART_VOICE_LINES.map((l) => l.id));
    expect(Object.keys(SMITH_HEART_DIRECTIONS).filter((id) => !live.has(id))).toEqual([]);
  });

  it('gives every boss its own voice, the two Council members two different ones', () => {
    const voices = Object.values(SMITH_HEART_VOICES);
    expect(new Set(voices).size).toBe(voices.length);
    for (const v of voices) expect(Object.hasOwn(SMITH_HEART_SPEAKERS, v), v).toBe(true);
    const ids: Record<string, string> = JSON.parse(
      readFileSync(join(repoRoot, 'scripts/voices/voice_ids.json'), 'utf8'),
    );
    expect(ids[SMITH_HEART_VOICES.guardian]).not.toBe(ids[SMITH_HEART_VOICES.singer]);
    expect(new Set(voices.map((v) => ids[v])).size).toBe(voices.length);
  });

  it('keeps the kill lines short barks a raid can hear often', () => {
    for (const line of SMITH_HEART_VOICE_LINES) {
      if (!line.id.includes('.slay_')) continue;
      expect(line.text.split(/\s+/).length, line.id).toBeLessThanOrEqual(8);
    }
  });
});

describe("the raid voices' mix", () => {
  it('a raid line sits over the score, queues and fades; every other yell as before', () => {
    const raid = voicedYellMix('Guardian of the Quench', QUENCH_LINES.pull);
    expect(raid.play).toEqual({ gain: SMITH_HEART_VOICE_GAIN, queue: true });
    expect(raid.fade).toEqual(SMITH_HEART_VOICE_FADE);
    expect(SMITH_HEART_VOICE_GAIN).toBeGreaterThan(1);
    const other = voicedYellMix('Brother Aldric', 'Champions, listen carefully!');
    expect(other).toEqual({ play: { gain: 1 }, fade: null });
    expect(voicedYellMix('Nythraxis, Scourge of Thornpeak', 'Kneel before your king').play).toEqual(
      {
        gain: NYTHRAXIS_VOICE_GAIN,
      },
    );
  });

  it('fades with its speaker over a raid arena, never silent inside the fight', () => {
    const [full, silent] = SMITH_HEART_VOICE_FADE;
    expect(voiceFadeGain(null, SMITH_HEART_VOICE_FADE)).toBe(0);
    expect(voiceFadeGain(full, SMITH_HEART_VOICE_FADE)).toBe(1);
    expect(voiceFadeGain((full + silent) / 2, SMITH_HEART_VOICE_FADE)).toBeCloseTo(0.5, 5);
    // The farthest listener of any fight (the Quarry's 120 yd) still hears it.
    expect(voiceFadeGain(120, SMITH_HEART_VOICE_FADE)).toBeGreaterThan(0.3);
    // A talked-to NPC keeps its own curve.
    expect(voiceFadeGain(VOICE_FULL_DIST + 4)).toBe(voiceDistanceGain(VOICE_FULL_DIST + 4));
  });

  it('a raid line waits for the one before it; a stale one is dropped; others still cut', () => {
    class FakeAudio {
      currentTime = 0;
      ended = false;
      onended: (() => void) | null = null;
      paused = true;
      src = '';
      volume = 1;
      pause(): void {
        this.paused = true;
      }
      play(): Promise<void> {
        this.ended = false;
        this.paused = false;
        return Promise.resolve();
      }
      finish(): void {
        this.ended = true;
        this.paused = true;
        this.onended?.();
      }
    }
    const previous = globalThis.Audio;
    const made: FakeAudio[] = [];
    Object.defineProperty(globalThis, 'Audio', {
      configurable: true,
      value: class extends FakeAudio {
        constructor() {
          super();
          made.push(this);
        }
      },
    });
    try {
      let now = 0;
      const v = new GameVoice(() => now);
      const death = yellKey(
        SMITH_HEART_VOICE_LINES.find((l) => l.id === 'breath.death')?.text ?? '',
      );
      const cheer = yellKey(
        SMITH_HEART_VOICE_LINES.find((l) => l.id === 'thessaly.victory')?.text ?? '',
      );
      v.play(death, { gain: 1.2, queue: true });
      v.play(cheer, { gain: 1.2, queue: true });
      const el = made[0];
      expect(el.src).toContain(`/${death}.mp3`);
      el.finish();
      expect(el.src).toContain(`/${cheer}.mp3`);
      v.stop();
      // A line left waiting past the stale window is dropped.
      v.play(death, { queue: true });
      v.play(cheer, { queue: true });
      now += VOICE_QUEUE_STALE_MS + 1;
      el.finish();
      expect(el.src).toContain(`/${death}.mp3`);
      expect(v.isPlaying()).toBe(false);
      // A line that does not queue cuts as it always did.
      v.play(death, { queue: true });
      v.play(cheer);
      expect(el.src).toContain(`/${cheer}.mp3`);
      v.stop();
    } finally {
      Object.defineProperty(globalThis, 'Audio', { configurable: true, value: previous });
    }
  });
});
