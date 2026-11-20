// The Guardian of the Heat's entrance (docs/design/raid/smith_heart.md section
// 7.4, "The entrance"; encounters/smith_heart/heat_intro.ts) over a REAL Sim:
// cold and out of reach until the raid first comes near, the scene's clock on
// its aura, its line said once on time, untargetable and unpullable through
// the scene even with a raider at its lip, handed back hostile at its end and
// pulled by the ordinary aggro (no pull line straight after it), a late joiner
// reading it burning, a forced pull spending it, the dev replay, determinism.

import { describe, expect, it } from 'vitest';
import {
  SMITH_HEART_DIRECTIONS,
  SMITH_HEART_INLINE_DIRECTIONS,
} from '../scripts/voices/smith_heart_voice_pack.mjs';
import { VOICE_LINES } from '../src/game/voice_manifest.generated';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { displacePlayerForDev } from '../src/sim/dev/dev_displace';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import {
  HEAT_AURAS,
  HEAT_INTRO,
  HEAT_INTRO_STAGES,
  HEAT_LINES,
  heatGuardian,
  heatIntroState,
  heatLineKey,
} from '../src/sim/encounters/smith_heart';
import { enterDungeon } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent, type WorldContent } from '../src/sim/types';
import { yellVoiceKey } from '../src/ui/hud_voice_cues';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

/** The casting floor east of the anvil bridge: out of the wake's reach. */
const FAR = { x: -140, z: 0 };
/** On the bridge: inside the wake's reach, far outside the aggro reach. */
const BRIDGE = { x: HEARTH_WELL.x + HEAT_INTRO.reach - 4, z: 0 };
/** At the wellspring's lip: inside the guardian's aggro reach. */
const LIP = { x: HEARTH_WELL.x + HEARTH_WELL.r + 3, z: 0 };

const ticks = (s: number) => Math.round(s / DT);

function claim(seed = 7) {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
  });
  const pids = [sim.addPlayer('warrior', 'Ember1'), sim.addPlayer('warrior', 'Ember2')];
  if (!enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pids[0])) throw new Error('enter');
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === SMITH_HEART_DUNGEON && i.partyKey !== null,
  ) as InstanceSlot;
  const o = instanceOrigin(DUNGEONS[SMITH_HEART_DUNGEON].index, inst.slot);
  const players = pids.map((pid) => sim.ctx.entities.get(pid) as Entity);
  const put = (e: Entity, at: { x: number; z: number }) =>
    displacePlayerForDev(sim.ctx, e, o.x + at.x, o.z + at.z);
  for (const p of players) {
    put(p, FAR);
    p.maxHp = 50000;
    p.hp = 50000;
  }
  const boss = () => heatGuardian(sim.ctx, inst) as Entity;
  const run = (n: number) => {
    const out: SimEvent[] = [];
    for (let i = 0; i < n; i++) out.push(...sim.tick());
    return out;
  };
  const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, pids[0]);
  return { sim, inst, players, put, boss, run, dev };
}

const intro = (e: Entity) => e.auras.find((a) => a.id === HEAT_AURAS.intro);
/** The `moment` lines in `ev` (one per listener: `pid` narrows to one). */
const said = (ev: SimEvent[], moment: keyof typeof HEAT_LINES, pid?: number) =>
  ev.filter(
    (e) =>
      e.type === 'chat' &&
      (e as { textKey?: string }).textKey === heatLineKey(moment) &&
      (pid === undefined || (e as { pid?: number }).pid === pid),
  );

describe('the Guardian of the Heat waits cold', () => {
  it('stands as cold coal, out of reach, until a raider comes within the wake reach', () => {
    const c = claim();
    c.run(ticks(3));
    const b = c.boss();
    expect(intro(b)).toMatchObject({ value: HEAT_INTRO_STAGES.dormant, permanent: true });
    expect(b.hostile).toBe(false);
    expect(b.damageImmune).toBe(true);
    expect(b.encounterHeld).toBe(true);
    expect(c.sim.isHostileTo(c.players[0], b)).toBe(false);
    expect(heatIntroState(b).stage).toBe('dormant');
    // A raider on the bridge wakes it (and is still far outside its aggro).
    c.put(c.players[0], BRIDGE);
    c.run(1);
    expect(heatIntroState(b).stage).toBe('waking');
    expect(intro(b)?.value).toBe(HEAT_INTRO_STAGES.waking);
  });
});

describe('the entrance', () => {
  it('runs its clock on the aura, says its line once at speakAt, and holds the guardian out of every pull', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], BRIDGE);
    // The second raider charges straight to the lip, inside the aggro reach.
    c.put(c.players[1], LIP);
    const ev: SimEvent[] = [];
    const b = c.boss();
    let lastLeft = Number.POSITIVE_INFINITY;
    let spokeAt = -1;
    // The waking tick (t 0), then the scene to its last tick.
    for (let i = 0; i < ticks(HEAT_INTRO.seconds); i++) {
      const e = c.run(1);
      ev.push(...e);
      if (spokeAt < 0 && said(e, 'intro').length > 0) spokeAt = heatIntroState(b).t;
      const a = intro(b);
      expect(a?.value).toBe(HEAT_INTRO_STAGES.waking);
      expect(a?.duration).toBe(HEAT_INTRO.seconds);
      expect(a?.remaining).toBeLessThan(lastLeft);
      expect((a?.remaining ?? 0) + heatIntroState(b).t).toBeCloseTo(HEAT_INTRO.seconds, 6);
      lastLeft = a?.remaining ?? 0;
      // Never pulled, never touchable, never in a fight.
      expect(b.inCombat).toBe(false);
      expect(b.smithHeartHeat).toBeUndefined();
      expect(b.hostile).toBe(false);
      expect(b.damageImmune).toBe(true);
      expect(c.sim.isHostileTo(c.players[1], b)).toBe(false);
    }
    // One line to each listener, its catalog key and English, on its beat.
    expect(said(ev, 'intro')).toHaveLength(2);
    expect(said(ev, 'intro')[0]).toMatchObject({
      channel: 'yell',
      text: HEAT_LINES.intro,
      entityId: b.id,
    });
    expect(spokeAt).toBeGreaterThanOrEqual(HEAT_INTRO.speakAt - 1e-9);
    expect(spokeAt).toBeLessThan(HEAT_INTRO.speakAt + DT + 1e-9);
    // The scene ends: handed back, no aura (a late joiner sees it burning).
    c.run(1);
    expect(heatIntroState(b).stage).toBe('done');
    expect(intro(b)).toBeUndefined();
    expect(b.hostile).toBe(true);
    expect(b.damageImmune).toBe(false);
    expect(b.encounterHeld).toBe(false);
    // The raider at its lip pulls it the ordinary way, and its pull line
    // stays quiet (the entrance has just said it).
    const after = c.run(3);
    expect(b.smithHeartHeat).toBeDefined();
    expect(b.inCombat).toBe(true);
    expect(said(after, 'pull')).toHaveLength(0);
  });

  it('plays once: a wipe sends it home burning, and the next pull says its pull line', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], LIP);
    c.run(ticks(HEAT_INTRO.seconds) + 4);
    const b = c.boss();
    expect(b.smithHeartHeat).toBeDefined();
    // The fight resets (as at a wipe) with the raid gone from the Hearth.
    for (const p of c.players) c.put(p, FAR);
    c.dev('/dev heart heat reset');
    c.run(ticks(2));
    expect(b.smithHeartHeat).toBeUndefined();
    expect(intro(b)).toBeUndefined();
    expect(heatIntroState(b).stage).toBe('done');
    // Long after the entrance, the next pull speaks its own line.
    c.run(ticks(HEAT_INTRO.pullQuiet));
    c.put(c.players[0], LIP);
    const ev = c.run(4);
    expect(b.smithHeartHeat).toBeDefined();
    expect(said(ev, 'pull', c.players[0].id)).toHaveLength(1);
    expect(said(ev, 'intro')).toHaveLength(0);
  });

  it('a fight begun before it woke spends it (the pull says its line)', () => {
    const c = claim();
    // Raiders already at the lip on the claim's first tick: the ordinary
    // aggro takes the guardian before the encounter ever held it.
    c.put(c.players[0], LIP);
    const ev = c.run(2);
    const b = c.boss();
    expect(heatIntroState(b).stage).toBe('done');
    expect(intro(b)).toBeUndefined();
    expect(b.smithHeartHeat).toBeDefined();
    expect(said(ev, 'pull', c.players[0].id)).toHaveLength(1);
    expect(said(ev, 'intro')).toHaveLength(0);
  });

  it('a dev mechanic forced mid-scene spends it and starts the fight', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], BRIDGE);
    c.run(ticks(3));
    expect(heatIntroState(c.boss()).stage).toBe('waking');
    expect(c.dev('/dev heart heat flare')).toBe(true);
    expect(heatIntroState(c.boss()).stage).toBe('done');
    expect(c.boss().smithHeartHeat).toBeDefined();
    expect(intro(c.boss())).toBeUndefined();
  });
});

describe('/dev heart heat intro', () => {
  it('puts it cold again (held a moment) and the next waker replays the whole scene', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], BRIDGE);
    c.run(ticks(HEAT_INTRO.seconds) + 2);
    const b = c.boss();
    expect(heatIntroState(b).stage).toBe('done');
    expect(c.dev('/dev heart heat intro')).toBe(true);
    expect(intro(b)?.value).toBe(HEAT_INTRO_STAGES.dormant);
    expect(b.hostile).toBe(false);
    // Held cold for the replay hold even with the raider in reach.
    c.run(ticks(HEAT_INTRO.replayHold) - 1);
    expect(heatIntroState(b).stage).toBe('dormant');
    const ev = c.run(ticks(HEAT_INTRO.seconds) + 4);
    expect(said(ev, 'intro', c.players[0].id)).toHaveLength(1);
    expect(heatIntroState(b).stage).toBe('done');
  });

  it('replays from inside the fight too: the fight resets first', () => {
    const c = claim();
    c.put(c.players[0], LIP);
    c.run(4);
    const b = c.boss();
    expect(b.smithHeartHeat).toBeDefined();
    c.dev('/dev heart heat intro');
    c.run(1);
    expect(b.smithHeartHeat).toBeUndefined();
    expect(b.inCombat).toBe(false);
    expect(intro(b)?.value).toBe(HEAT_INTRO_STAGES.dormant);
  });
});

describe('the dev pull', () => {
  it('pulls a cold guardian at once (its entrance spent) and keeps it fighting', () => {
    const c = claim();
    c.run(2);
    expect(heatIntroState(c.boss()).stage).toBe('dormant');
    expect(c.dev('/dev heart heat pull')).toBe(true);
    c.run(3);
    expect(heatIntroState(c.boss()).stage).toBe('done');
    expect(c.boss().smithHeartHeat).toBeDefined();
    expect(c.boss().inCombat).toBe(true);
  });

  it('a mechanic forced on a cold guardian starts its fight and keeps it', () => {
    const c = claim();
    c.run(2);
    c.dev('/dev heart heat flare');
    c.run(2);
    expect(c.boss().smithHeartHeat).toBeDefined();
    expect(c.boss().inCombat).toBe(true);
  });
});

describe('determinism', () => {
  it('two runs of the same claim say and hold the same on the same ticks', () => {
    const trace = () => {
      const c = claim(11);
      c.run(2);
      c.put(c.players[0], BRIDGE);
      const out: string[] = [];
      for (let i = 0; i < ticks(HEAT_INTRO.seconds) + 6; i++) {
        const ev = c.run(1);
        const a = intro(c.boss());
        out.push(
          `${i}:${a?.value ?? '-'}:${a?.remaining.toFixed(3) ?? '-'}:${said(ev, 'intro').length}`,
        );
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });
});

describe('the entrance line', () => {
  it('is directed in three turns and shipped in the voice manifest', () => {
    expect(SMITH_HEART_DIRECTIONS['heat.intro']).toBe('[contemptuous]');
    expect(SMITH_HEART_INLINE_DIRECTIONS['heat.intro']).toEqual({
      'I was burning': '[angrier]',
      'Then burn with it!': '[furious shout]',
    });
    expect(VOICE_LINES[yellVoiceKey(HEAT_LINES.intro)]).toMatch(
      /^\/audio\/voice\/heart_heat_guardian\/yell__insects_you_crawl/,
    );
  });
});
